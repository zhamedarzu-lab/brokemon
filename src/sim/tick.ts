import { isOutdoors, zoneAt, type Zone } from "../world/map";
import { hasItem, phaseOf, pushLog, type GameState, type Phase } from "./state";
import { decay, WARN_THRESHOLDS, type MeterId } from "./meters";
import { dayOf, minuteOfDay, MINUTES_PER_DAY } from "./time";
import { rollWeather, WEATHER, weatherDuration } from "./weather";
import { HOUSING } from "./social";
import type { Rng } from "./rng";
import { currentAppearance } from "./state";
import { removeItem } from "./items";

/**
 * Something that has to stop the player and be acknowledged. The renderer
 * drains these into dialogue boxes; the simulation never blocks on the UI.
 */
export type Interrupt =
  | { kind: "collapse"; cost: number }
  | { kind: "police"; zone: Zone; reason: string; fine: number; escorted: boolean }
  | { kind: "sick" }
  | { kind: "rent"; amount: number; paid: boolean }
  | { kind: "fired"; job: string }
  | { kind: "newDay"; day: number }
  | { kind: "income"; lines: string[] }
  | { kind: "weather"; text: string };

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

    const outdoors = !opts.sheltered && !asleep && isOutdoors(s.player.pos.x, s.player.pos.y);
    const weather = WEATHER[s.weather];
    const soaked = outdoors && weather.wet && !hasItem(s, "poncho");

    decay(s.meters, { minutes: step, asleep, exertion, soaked, sick: s.sick });

    if (outdoors && weather.moralePerHourOutdoors !== 0) {
      s.meters.morale = Math.max(0, s.meters.morale + (weather.moralePerHourOutdoors * step) / 60);
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

  // Credit score drifts towards how you're actually living.
  const target = s.debt > 400 ? 430 : s.debt > 0 ? 600 : s.bank > 2000 ? 790 : 700;
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

  // A cot is paid for one night at a time. Come morning it isn't yours.
  if (s.housing === "hostel") {
    if (s.nightsPaid > 0) s.nightsPaid -= 1;
    else {
      s.housing = "street";
      pushLog(s, "Your cot was paid to this morning. Everyone is out by eight.", "plain");
    }
  }
}

/**
 * What the franchise and the mayor's office pay you while you sleep. This is
 * economy, not presentation — it belongs on the clock with rent and interest,
 * not in the renderer, where nothing could test it.
 */
function payPassiveIncome(s: GameState, out: Interrupt[]): void {
  const lines: string[] = [];
  if (s.businessOwned) {
    const take = 180 + Math.round((s.reputation + 40) * 1.5);
    s.bank += take;
    lines.push(`The franchise cleared $${take} yesterday.`);
  }
  if (s.mayor) {
    s.bank += MAYOR_SALARY;
    lines.push(`Your mayoral salary landed: $${MAYOR_SALARY}.`);
  }
  if (lines.length === 0) return;
  pushLog(s, lines.join(" "), "money");
  out.push({ kind: "income", lines });
}

export const MAYOR_SALARY = 320;

function chargeRent(s: GameState, day: number, out: Interrupt[]): void {
  const def = HOUSING[s.housing];
  if (def.rentEvery <= 0 || def.rent <= 0) return;
  if (day < s.rentDueDay) return;

  const amount = def.rent;
  s.rentDueDay = day + def.rentEvery;

  if (s.cash >= amount) {
    s.cash -= amount;
    pushLog(s, `Rent taken: $${amount} for ${def.name.toLowerCase()}.`, "money");
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
    pushLog(s, `You couldn't make rent. $${amount} plus a $40 late fee goes on the debt.`, "bad");
    out.push({ kind: "rent", amount, paid: false });
    if (s.housing === "apartment" || s.housing === "trailer") {
      s.housing = "street";
      s.flags.evicted = (s.flags.evicted ?? 0) + 1;
      pushLog(s, "You've been served notice and the locks are changed. Back to the street.", "bad");
    }
  }
}

function collapse(s: GameState, rng: Rng, out: Interrupt[]): Interrupt {
  const cost = Math.min(s.cash, rng.int(30, 90));
  s.cash -= cost;
  if (cost < 30) s.debt += 90 - cost;
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

/**
 * Zone enforcement. Called on movement rather than on the clock — you get
 * noticed when you go somewhere, not when you stand still.
 */
export function policeCheck(s: GameState, rng: Rng): Interrupt | null {
  const zone = zoneAt(s.player.pos.y);
  if (zone.fineScale === 0) return null;
  if (!isOutdoors(s.player.pos.x, s.player.pos.y)) return null;
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
  s.reputation -= 3;
  s.meters.morale = Math.max(0, s.meters.morale - 10);
  pushLog(s, `Citation issued — $${fine}. Reason on the ticket: "${reason}".`, "bad");
  return { kind: "police", zone, reason, fine, escorted: true };
}

/** Where you get put down when the police walk you out of a zone. */
export function escortDestination(zone: Zone): { x: number; y: number } {
  return zone.id === "heights" ? { x: 23, y: 18 } : { x: 26, y: 43 };
}
