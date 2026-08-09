import { glyphAt, isOutdoors, townById, TOWNS, zoneAt, type Town, type TownId, type Zone } from "../world/map";
import { housingIn, reputationIn, setHousing, townOf, type Ending } from "./state";
import { changeReputation, checkPostWinGoal, hasItem, phaseOf, pushLog, setWon, type GameState, type Phase } from "./state";
import { decay, WARN_THRESHOLDS, type MeterId } from "./meters";
import { dayOf, minuteOfDay, MINUTES_PER_DAY } from "./time";
import { rollWeather, WEATHER, weatherDuration } from "./weather";
import { HOUSING, outfitRank } from "./social";
import type { Rng } from "./rng";
import { currentAppearance } from "./state";
import { addItem, removeItem } from "./items";

/**
 * Something that has to stop the player and be acknowledged. The renderer
 * drains these into dialogue boxes; the simulation never blocks on the UI.
 */
export type Interrupt =
  | { kind: "collapse"; cost: number }
  | { kind: "headInjury"; cost: number }
  | { kind: "police"; zone: Zone; reason: string; fine: number; escorted: boolean }
  | { kind: "sick" }
  | { kind: "rent"; amount: number; paid: boolean }
  | { kind: "fired"; job: string }
  | { kind: "newDay"; day: number }
  | { kind: "income"; lines: string[] }
  | { kind: "weather"; text: string }
  | { kind: "victory"; ending: Ending }
  | { kind: "jobExpired"; label: string }
  | { kind: "carHit"; cost: number };

export interface TickOptions {
  /** In-game minutes to advance. */
  minutes: number;
  asleep?: boolean;
  /** Physical effort multiplier for hygiene/energy burn. */
  exertion?: number;
  /** Skip police and random encounters — you're mid-shift or indoors. */
  sheltered?: boolean;
}

const CHUNK = 15;

export function advance(s: GameState, rng: Rng, opts: TickOptions): Interrupt[] {
  const interrupts: Interrupt[] = [];
  let remaining = Math.max(0, opts.minutes);
  const asleep = opts.asleep ?? false;
  const exertion = opts.exertion ?? 1;

  while (remaining > 0) {
    const step = Math.min(CHUNK, remaining);
    remaining -= step;

    const dayBefore = dayOf(s.time);
    s.time += step;
    const dayAfter = dayOf(s.time);

    const outdoors = !opts.sheltered && !asleep && isOutdoors(townOf(s), s.player.pos.x, s.player.pos.y);
    const weather = WEATHER[s.weather];
    const soaked = outdoors && weather.wet && !hasItem(s, "poncho") && !hasItem(s, "raincoat") && !hasItem(s, "umbrella");

    decay(s.meters, { minutes: step, asleep, exertion, soaked, sick: s.sick, outfitRank: outfitRank(s.wearing) }, s);

    if (outdoors && weather.moralePerHourOutdoors !== 0) {
      s.meters.morale = Math.max(0, s.meters.morale + (weather.moralePerHourOutdoors * step) / 60);
    }

    // Head injury: riding without a suitable helmet.
    if (outdoors && !asleep) {
      const risk = bareheadRisk(s);
      const injuryDay = s.flags.headInjuryDay ?? -1;
      if (risk > 0 && injuryDay !== dayOf(s.time) && rng.chance(risk * (step / 60))) {
        s.flags.headInjuryDay = dayOf(s.time);
        const inj = headInjury(s, rng, interrupts);
        interrupts.push(inj);
        remaining = 0;
        break;
      }
    }

    // Hit by a car: walking on road tiles.
    if (outdoors && !asleep) {
      const town = townOf(s);
      const tile = glyphAt(town, s.player.pos.x, s.player.pos.y);
      const hitDay = s.flags.carHitDay ?? -1;
      if (
        (tile === "=" || tile === "c") &&
        hitDay !== dayOf(s.time) &&
        rng.chance(0.04 * (step / 60))
      ) {
        s.flags.carHitDay = dayOf(s.time);
        const hit = carHit(s, rng, interrupts);
        interrupts.push(hit);
        remaining = 0;
        break;
      }
    }

    // Falling ill: exposure now, fever later.
    if (!s.sick && outdoors && weather.sickness > 0) {
      const p = weather.sickness * (step / 60) * (soaked ? 1.8 : 0.5) * (s.meters.health < 50 ? 1.6 : 1);
      if (rng.chance(p)) {
        s.sick = true;
        pushLog(s, "You've picked something up. Your chest feels tight and your head is hot.", "bad");
        interrupts.push({ kind: "sick" });
      }
    }
    if (s.sick && s.meters.health > 80 && rng.chance(0.05 * (step / 60))) {
      s.sick = false;
      pushLog(s, "Whatever it was, you've shaken it off.", "good");
    }

    // Assignment deadline: fire once when the clock crosses the window.
    if (s.assignment && !s.assignment.ready) {
      const dl = s.assignment.deadlineMin ?? 0;
      if (dl > 0 && s.time >= dl) {
        const label = s.assignment.label;
        pushLog(s, `${label} — time's up. The board reassigned it.`, "bad");
        removeItem(s.inventory, "flyers", 1);
        s.assignment = null;
        interrupts.push({ kind: "jobExpired", label });
      }
    }

    maybeChangeWeather(s, rng, interrupts);
    checkWarnings(s);

    if (dayAfter !== dayBefore) onNewDay(s, rng, dayAfter, interrupts);

    if (s.meters.health <= 0) {
      interrupts.push(collapse(s, rng, interrupts));
      remaining = 0;
      break;
    }
  }

  return interrupts;
}

function maybeChangeWeather(s: GameState, rng: Rng, out: Interrupt[]): void {
  if (s.time < s.weatherUntil) return;
  const before = s.weather;
  s.weather = rollWeather(rng);
  s.weatherUntil = s.time + weatherDuration(rng);
  if (s.weather !== before) {
    const def = WEATHER[s.weather];
    const text =
      s.weather === "rain"
        ? "It starts to rain."
        : s.weather === "storm"
          ? "The sky opens up. This is not weather to be outside in."
          : s.weather === "cold"
            ? "The temperature drops hard."
            : s.weather === "clear"
              ? "The clouds break."
              : "The sky goes flat and grey.";
    pushLog(s, text, def.wet ? "bad" : "plain");
    if (def.wet || s.weather === "cold") out.push({ kind: "weather", text });
  }
}

function checkWarnings(s: GameState): void {
  for (const w of WARN_THRESHOLDS) {
    const value = s.meters[w.meter as MeterId];
    const key = `${w.meter}:${w.at}`;
    if (value <= w.at) {
      // Only nag once per crossing; re-arms when you climb 12 points clear.
      if (!s.warned[key]) {
        s.warned[key] = 1;
        pushLog(s, w.text, "bad");
      }
    } else if (value > w.at + 12 && s.warned[key]) {
      delete s.warned[key];
    }
  }
}

function onNewDay(s: GameState, rng: Rng, day: number, out: Interrupt[]): void {
  s.daysSurvived = day - 1;
  s.gigsToday = {};
  s.policeWarnings = 0;
  // You can fall back down the ladder; the high-water mark stays on the record.
  s.peakPhase = Math.max(s.peakPhase, phaseOf(s)) as Phase;
  out.push({ kind: "newDay", day });

  // Interest on whatever you still owe, compounding daily because of course it does.
  if (s.debt > 0) {
    const interest = Math.max(1, Math.round(s.debt * 0.004));
    s.debt += interest;
    if (day % 7 === 0) pushLog(s, `Debt has grown to $${s.debt}. The interest does not sleep.`, "bad");
  }

  if (s.investments > 0) {
    const before = s.investments;
    const swing = rng.float(-0.018, 0.026);
    s.investments = Math.max(0, Math.round(s.investments * (1 + swing)));
    s.investmentLastDelta = s.investments - before;
    if (Math.abs(s.investmentLastDelta) > 5) {
      const sign = s.investmentLastDelta > 0 ? "▲" : "▼";
      out.push({
        kind: "income",
        lines: [`Index fund: ${sign} $${Math.abs(s.investmentLastDelta)} overnight. Now at $${s.investments.toLocaleString()}.`],
      });
    }
  } else {
    s.investmentLastDelta = 0;
  }

  // Credit score drifts towards how you're actually living. Savings count
  // whether they sit in the account or the index fund — the estate wants 720
  // and the debt-free ceiling is only 700, so reading `bank` alone meant
  // moving your money into the fund quietly locked the endgame.
  const saved = s.bank + s.investments;
  const target = s.debt > 400 ? 430 : s.debt > 0 ? 600 : saved > 2000 ? 790 : 700;
  s.credit = Math.round(s.credit + Math.sign(target - s.credit) * Math.min(6, Math.abs(target - s.credit)));

  // Bus pass expiry: count down daily and remove when exhausted.
  if (s.busPassDaysLeft > 0) {
    s.busPassDaysLeft -= 1;
    if (s.busPassDaysLeft === 0) {
      removeItem(s.inventory, "busPass");
      pushLog(s, "Your weekly bus pass has expired.", "plain");
    }
  }

  chargeRent(s, day, out);
  payPassiveIncome(s, out);

  // A cot is paid for one night at a time. Come morning it isn't yours —
  // in whichever town you paid for it, whether or not you are standing in it.
  for (const town of Object.keys(TOWNS) as TownId[]) {
    if (housingIn(s, town) !== "hostel") continue;
    if (s.nightsPaid[town] > 0) s.nightsPaid[town] -= 1;
    else {
      setHousing(s, "street", town);
      pushLog(s, "Your cot was paid to this morning. Everyone is out by eight.", "plain");
    }
  }

  // Safety net: fire victory on the next new day if the player somehow reached
  // the win condition without triggering the immediate check (e.g. a loaded
  // save that already meets conditions).
  // `bestHousing`, not the town you happen to be standing in — you do not stop
  // owning the estate by being forty minutes up the road when the day turns.
  if (housingIn(s, "brokemon") === "estate" && (s.businessOwned || s.mayor)) {
    const had = s.endings.length;
    setWon(s, "estate");
    if (s.endings.length > had) out.push({ kind: "victory", ending: "estate" });
  }
  if (s.blockOwned) {
    const had = s.endings.length;
    setWon(s, "block");
    if (s.endings.length > had) out.push({ kind: "victory", ending: "block" });
  }

  // Post-win goal progress (also checked in earnCash and payPassiveIncome;
  // this catches any remaining edge cases at day boundary).
  checkPostWinGoal(s);
}

/**
 * What the franchise and the mayor's office pay you while you sleep. This is
 * economy, not presentation — it belongs on the clock with rent and interest,
 * not in the renderer, where nothing could test it.
 */
function payPassiveIncome(s: GameState, out: Interrupt[]): void {
  const lines: string[] = [];
  if (s.businessOwned) {
    // Mostly the shop, partly your name. This used to be
    // `180 + (reputation + 40) * 1.5` against an uncapped reputation, which
    // reached $1,200 a day and made the last third of a run a formality. With
    // reputation ceilinged the endgame needs its own base rather than
    // borrowing one from a number that no longer runs away.
    const take = 350 + Math.round(reputationIn(s) * 3);
    s.bank += take;
    lines.push(`The franchise cleared $${take} yesterday.`);
  }
  if (s.mayor) {
    s.bank += MAYOR_SALARY;
    lines.push(`Your mayoral salary landed: $${MAYOR_SALARY}.`);
  }
  if (s.stallOwned) {
    // A pitch you do not stand on. It is a small number and it arrives every
    // night, which is the entire difference between Brokedale's economy and
    // Brokemon's — see open finding 1.
    const take = STALL_BASE + Math.round(reputationIn(s, "brokedale") * STALL_PER_REPUTATION);
    s.bank += take;
    lines.push(`Nadia's takings from the pitch: $${take}.`);
  }
  if (s.blockOwned) {
    // Eleven doors, and it arrives whether or not anybody could spare it.
    s.bank += BLOCK_RENT_ROLL;
    lines.push(`Rents on St Giles Row: $${BLOCK_RENT_ROLL}. Nine of the eleven paid on time.`);
  }
  if (lines.length === 0) return;
  pushLog(s, lines.join(" "), "money");
  out.push({ kind: "income", lines });
  // Passive income goes to bank; check goal here since earnCash isn't used.
  checkPostWinGoal(s);
}

export const MAYOR_SALARY = 320;

/** What eleven doors on St Giles Row bring in overnight. */
export const BLOCK_RENT_ROLL = 245;

/**
 * What a let pitch at the night market returns a night.
 *
 * Sized against the measured gap rather than picked: the block was landing
 * around day 280 against the estate's 165, because Brokemon compounds three
 * ways — franchise, mayoral salary, index fund — and Brokedale compounded not
 * at all. This is the city's one answer to that, and it is deliberately much
 * smaller than the franchise, because it is one stall.
 *
 * First pass was 95 + rep*1.2, about $190 a night, and it took the block from
 * day 280 to day 137 — past the estate rather than level with it, and reliably
 * so on every seed, which would have made Brokemon the long way round to a
 * smaller number. Half of that lands the two apexes in the same family.
 */
export const STALL_BASE = 45;
export const STALL_PER_REPUTATION = 0.6;

/**
 * Rent, in every town you hold a key to.
 *
 * This used to read the town you were standing in, which was the same thing
 * while there was only one. It is not any more: a landlord does not stop
 * wanting the money because you took the coach somewhere else, and reading
 * `s.player.town` would have made a day trip the cheapest rent holiday in the
 * game.
 */
function chargeRent(s: GameState, day: number, out: Interrupt[]): void {
  for (const town of Object.keys(TOWNS) as TownId[]) chargeRentIn(s, town, day, out);
}

function chargeRentIn(s: GameState, town: TownId, day: number, out: Interrupt[]): void {
  // You do not pay rent to yourself.
  if (town === "brokedale" && s.blockOwned) return;
  const def = HOUSING[housingIn(s, town)];
  if (def.rentEvery <= 0 || def.rent <= 0) return;
  if (day < s.rentDueDay[town]) return;

  const amount = def.rent;
  s.rentDueDay[town] = day + def.rentEvery;
  // Only worth naming the place when you are not in it.
  const where = town === s.player.town ? "" : ` in ${townById(town).name}`;

  if (s.cash >= amount) {
    s.cash -= amount;
    pushLog(s, `Rent taken: $${amount} for ${def.name.toLowerCase()}${where}.`, "money");
    out.push({ kind: "rent", amount, paid: true });
  } else if (s.bank >= amount - s.cash) {
    const fromBank = amount - s.cash;
    s.bank -= fromBank;
    s.cash = 0;
    pushLog(s, `Rent taken: $${amount}, $${fromBank} of it out of savings.`, "money");
    out.push({ kind: "rent", amount, paid: true });
  } else {
    s.debt += amount + 40;
    s.credit = Math.max(300, s.credit - 35);
    pushLog(s, `You couldn't make rent${where}. $${amount} plus a $40 late fee goes on the debt.`, "bad");
    out.push({ kind: "rent", amount, paid: false });
    if (housingIn(s, town) === "apartment" || housingIn(s, town) === "trailer") {
      setHousing(s, "street", town);
      s.flags.evicted = (s.flags.evicted ?? 0) + 1;
      pushLog(s, `You've been served notice${where} and the locks are changed. Back to the street.`, "bad");
    }
  }
}

/**
 * Per-hour probability of a head injury while riding without a suitable helmet.
 * Returns 0 when the player has no vehicle or is properly protected.
 *
 * Suitable helmet by vehicle:
 *   rollerSkates / kickScooter — skateHelmet OR cyclingHelmet
 *   bmxBike                    — skateHelmet OR cyclingHelmet
 *   foldingBike / bicycle / roadBike — cyclingHelmet only
 */
function carHit(s: GameState, rng: Rng, out: Interrupt[]): Interrupt {
  // Generous: bystanders helped, hospital fed you, bill is small or nothing.
  const cost = rng.chance(0.55) ? 0 : Math.min(s.cash, rng.int(10, 45));
  s.cash -= cost;
  s.meters.health = Math.min(s.meters.health, 48);
  s.meters.morale = Math.max(0, s.meters.morale - 14);
  s.meters.energy = Math.max(0, s.meters.energy - 18);
  // Hospital gave you something to eat and drink.
  s.meters.hunger = Math.max(s.meters.hunger, 58);
  s.meters.thirst = Math.max(s.meters.thirst, 62);
  addItem(s.inventory, "sandwich", 1); // bystander left it on the chair

  // Skip 2 hours of hospital time.
  const dayBefore = dayOf(s.time);
  s.time += 120;
  const dayAfter = dayOf(s.time);
  for (let d = dayBefore + 1; d <= dayAfter; d++) onNewDay(s, rng, d, out);

  pushLog(s, "A car clipped you crossing the road. You come round in the hospital, two hours gone.", "bad");
  return { kind: "carHit", cost };
}

function bareheadRisk(s: GameState): number {
  const hasSk = hasItem(s, "skateHelmet");
  const hasCy = hasItem(s, "cyclingHelmet");
  const inv = s.inventory;
  if ((inv.rollerSkates ?? 0) > 0 && !hasSk && !hasCy) return 0.006;
  if ((inv.kickScooter  ?? 0) > 0 && !hasSk && !hasCy) return 0.008;
  if ((inv.foldingBike  ?? 0) > 0 && !hasCy)           return 0.010;
  if ((inv.bmxBike      ?? 0) > 0 && !hasSk && !hasCy) return 0.015;
  if ((inv.bicycle      ?? 0) > 0 && !hasCy)           return 0.012;
  if ((inv.roadBike     ?? 0) > 0 && !hasCy)           return 0.018;
  return 0;
}

function headInjury(s: GameState, rng: Rng, out: Interrupt[]): Interrupt {
  const cost = Math.min(s.cash, rng.int(60, 140));
  s.cash -= cost;
  if (cost < 60) s.debt += 140 - cost;
  s.meters.health = Math.min(s.meters.health, 32);
  s.meters.morale = Math.max(0, s.meters.morale - 24);
  s.sick = true; // concussion counts as sick

  // Skip forward 3 hours (hospital time).
  const dayBefore = dayOf(s.time);
  s.time += 180;
  const dayAfter = dayOf(s.time);
  for (let d = dayBefore + 1; d <= dayAfter; d++) onNewDay(s, rng, d, out);

  pushLog(s, "You go down hard. You wake up in the emergency room, hours gone.", "bad");
  return { kind: "headInjury", cost };
}

function collapse(s: GameState, rng: Rng, out: Interrupt[]): Interrupt {
  const cost = 0;
  s.debt += 100;
  s.collapses += 1;
  s.meters.health = 45;
  s.meters.hunger = Math.max(s.meters.hunger, 40);
  s.meters.thirst = Math.max(s.meters.thirst, 55);
  s.meters.energy = Math.max(s.meters.energy, 45);
  s.meters.morale = Math.max(0, s.meters.morale - 18);
  s.sick = false;

  // You wake up the next morning, wherever they took you. The skipped hours
  // still have to settle the day's rent and reset the day's work.
  const toMorning = (MINUTES_PER_DAY - minuteOfDay(s.time) + 8 * 60) % MINUTES_PER_DAY;
  const dayBefore = dayOf(s.time);
  s.time += toMorning === 0 ? MINUTES_PER_DAY : toMorning;
  const dayAfter = dayOf(s.time);
  for (let d = dayBefore + 1; d <= dayAfter; d++) onNewDay(s, rng, d, out);
  pushLog(s, "You went down in the street. You wake up on a cot in the clinic, hours gone.", "bad");
  return { kind: "collapse", cost };
}

/** Minimum in-game minutes standing still before a loitering check can fire. */
const LOITER_IDLE_MINUTES = 30;

/**
 * Zone enforcement. Only fires after the player has been stationary for at
 * least LOITER_IDLE_MINUTES game-minutes, so walking through a zone never
 * triggers a loitering warning.
 */
export function policeCheck(s: GameState, rng: Rng): Interrupt | null {
  const zone = zoneAt(townOf(s), s.player.pos.y);
  if (zone.fineScale === 0) return null;
  if (!isOutdoors(townOf(s), s.player.pos.x, s.player.pos.y)) return null;
  if (s.time - s.lastMovedTime < LOITER_IDLE_MINUTES) return null;
  if (s.time - s.lastPoliceCheck < 45) return null;

  const look = currentAppearance(s);
  const failsHygiene = s.meters.hygiene < zone.hygieneWatch;
  const failsDress = zone.requiresAttire && look < 70;
  if (!failsHygiene && !failsDress) return null;

  // The nicer the street, the shorter the odds.
  const severity = failsDress && failsHygiene ? 0.75 : 0.4;
  if (!rng.chance(severity * (zone.fineScale >= 3 ? 1.4 : 0.7))) return null;

  s.lastPoliceCheck = s.time;
  s.policeWarnings += 1;

  const reason = failsDress
    ? "you do not look like you live here"
    : "you have been reported loitering";

  if (s.policeWarnings <= 1 && zone.fineScale < 3) {
    pushLog(s, `An officer moves you along: "${reason}."`, "bad");
    return { kind: "police", zone, reason, fine: 0, escorted: false };
  }

  const fine = Math.round(rng.int(15, 45) * zone.fineScale);
  if (s.cash >= fine) {
    s.cash -= fine;
  } else {
    s.debt += fine;
  }
  s.fines += fine;
  changeReputation(s, -3);
  s.meters.morale = Math.max(0, s.meters.morale - 10);
  pushLog(s, `Citation issued — $${fine}. Reason on the ticket: "${reason}".`, "bad");
  return { kind: "police", zone, reason, fine, escorted: true };
}

/**
 * Where you get put down when the police walk you out of a zone.
 *
 * The two coordinates this used to hold lived in `tick.ts`, a thousand tiles
 * from the grid they referred to. They belong to the zone now, beside the rows
 * they point at, and `buildTown` refuses to build a town whose escort tile has
 * ended up inside a wall.
 */
export function escortDestination(town: Town, zone: Zone): { x: number; y: number } {
  return zone.escortTo ?? anyLanding(town);
}

/** A zone with no escort tile cannot issue fines, so this is unreachable — but
 * putting the player nowhere is worse than putting them somewhere. */
function anyLanding(town: Town): { x: number; y: number } {
  const first = Object.values(town.markers)[0];
  return first ?? { x: 1, y: 1 };
}
