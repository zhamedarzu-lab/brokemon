import { EMPLOYMENT, GIGS, type EmploymentId, type GigId } from "./jobs";
import { applyDelta, type MeterDelta } from "./meters";
import { menu, say, type Choice, type Prompt } from "./prompt";
import type { Rng } from "./rng";
import { HOUSING, type HousingId } from "./social";
import { canDoGig, changeReputation, checkRequirements, currentAppearance, earnCash, pushLog, townOf, type GameState } from "./state";
import { zoneAt } from "../world/map";
import { dayOf, hourOf, minuteOfDay, MINUTES_PER_DAY, minutesUntilHour, withinHours } from "./time";
import { WEATHER } from "./weather";
import { ITEMS, removeItem, type ItemId } from "./items";

export interface ActionCtx {
  state: GameState;
  rng: Rng;
  /** Advance the clock; interrupts are collected by the caller. */
  advance(minutes: number, opts?: { asleep?: boolean; exertion?: number; sheltered?: boolean }): void;
  /** Move the player without a walk animation (sleep, escort, bus). */
  teleport(x: number, y: number): void;
}

/* ------------------------------------------------------------------ shifts */

export function shiftLength(job: EmploymentId): number {
  const d = EMPLOYMENT[job];
  const raw = d.shiftEnd - d.shiftStart;
  return (raw <= 0 ? raw + 24 : raw) * 60;
}

export type ShiftWindow = "early" | "open" | "late" | "closed";

export function shiftWindow(s: GameState, job: EmploymentId): ShiftWindow {
  const d = EMPLOYMENT[job];
  if (withinHours(s.time, d.shiftStart, d.shiftEnd)) {
    const start = d.shiftStart * 60;
    const now = minuteOfDay(s.time);
    const since = (now - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    return since <= d.grace * 60 ? "open" : "late";
  }
  const until = minutesUntilHour(s.time, d.shiftStart);
  return until <= 120 ? "early" : "closed";
}

/**
 * Which day's rota a clock-in belongs to. A shift that runs past midnight —
 * the 10PM–3AM stocker — still belongs to the evening it started on. Stamping
 * it with the calendar day it *finished* on meant the overnight crew could
 * only ever work every other night.
 */
export function rotaDay(s: GameState, job: EmploymentId): number {
  const def = EMPLOYMENT[job];
  const crossesMidnight = def.shiftEnd <= def.shiftStart;
  const beforeSunrise = crossesMidnight && hourOf(s.time) < def.shiftEnd;
  return dayOf(s.time) - (beforeSunrise ? 1 : 0);
}

export function workShift(ctx: ActionCtx, job: EmploymentId): Prompt {
  const s = ctx.state;
  const def = EMPLOYMENT[job];
  const window = shiftWindow(s, job);
  const rota = rotaDay(s, job);

  if (window === "closed" || window === "early") {
    const until = minutesUntilHour(s.time, def.shiftStart);
    return say(
      def.employer,
      `Your shift runs ${fmtHour(def.shiftStart)} to ${fmtHour(def.shiftEnd)}. That's ${fmtDuration(until)} from now.`,
    );
  }

  if (s.lastShiftDay === rota) {
    return say(def.employer, "You've already worked today. Go home.");
  }

  const gate = checkRequirements(s, def.requires);
  if (!gate.ok) {
    s.strikes += 1;
    pushLog(s, `Sent home from ${def.employer}: ${gate.reasons[0]}.`, "bad");
    return maybeFire(
      s,
      say(def.employer, [`Your supervisor takes one look and sends you home.`, `"${cap(gate.reasons[0]!)}."`], "bad"),
    );
  }

  if (s.meters.energy < 10) {
    s.strikes += 1;
    return maybeFire(s, say(def.employer, "You cannot keep your eyes open. You call in and lose the shift.", "bad"));
  }

  const late = window === "late";
  const minutes = shiftLength(job) * (late ? 0.75 : 1);
  ctx.advance(minutes, { exertion: def.exertion, sheltered: true });

  const weather = WEATHER[s.weather];
  const weatherScale = def.salaried ? 1 : weather.payScale * 0.35 + 0.65;
  const basePay = s.employmentPayOverride[job] ?? def.pay;
  let pay = Math.round(basePay * weatherScale * (late ? 0.7 : 1));

  applyDelta(s.meters, def.cost);
  earnCash(s, pay);
  s.shiftsWorked[job] = (s.shiftsWorked[job] ?? 0) + 1;
  s.lastShiftDay = rota;

  const lines = [`${fmtDuration(minutes)} on the clock.`];
  if (late) {
    s.strikes += 1;
    lines.push("You turned up late. They docked you and wrote it down.");
  }
  if (!def.salaried && weather.payScale < 0.8) lines.push("Quiet day. The weather kept people home.");

  const shifts = s.shiftsWorked[job] ?? 0;
  if (shifts % 10 === 0) {
    const oldBase = s.employmentPayOverride[job] ?? def.pay;
    const newBase = Math.round(oldBase * 1.05);
    s.employmentPayOverride[job] = newBase;
    changeReputation(s, 2);
    lines.push(`Ten shifts in. Your pay rate goes up to $${newBase} a shift.`);
  }

  lines.push(`Paid: $${pay}.`);
  pushLog(s, `Worked ${def.name} — $${pay}.`, "money");
  return maybeFire(s, menu(def.employer, lines, [{ label: "Clock out" }], "money"));
}

function maybeFire(s: GameState, prompt: Prompt): Prompt {
  if (s.strikes < 3 || !s.employment) return prompt;
  const job = EMPLOYMENT[s.employment];
  s.employment = null;
  s.strikes = 0;
  changeReputation(s, -5);
  s.meters.morale = Math.max(0, s.meters.morale - 15);
  pushLog(s, `You were let go from ${job.employer}.`, "bad");
  return {
    title: job.employer,
    lines: [...prompt.lines, "", `"This isn't working out. Hand in the badge."`, `You are no longer employed.`],
    tone: "bad",
    choices: [{ label: "Leave" }],
  };
}

/* -------------------------------------------------------------------- gigs */

export function panhandle(ctx: ActionCtx): Prompt {
  const s = ctx.state;
  const gig = GIGS.panhandle;
  const look = currentAppearance(s);

  ctx.advance(gig.minutes, { exertion: 1 });
  applyDelta(s.meters, gig.cost);

  // Sympathy peaks in the middle. Too clean and you look fine; filthy and
  // people look at their phones until they are past you.
  const sympathy = clamp01(1 - Math.abs(look - 32) / 52);
  const hour = hourOf(s.time);
  const traffic = hour >= 8 && hour < 20 ? 1 : 0.35;
  const weather = WEATHER[s.weather].payScale;
  const take = Math.max(0, Math.round(ctx.rng.float(0, 9) * sympathy * traffic * weather));

  earnCash(s, take);
  s.gigsToday.panhandle = (s.gigsToday.panhandle ?? 0) + 1;

  const lines: string[] = [];
  if (take === 0) lines.push("Thirty minutes. Nobody stops. A man tells you to get a job and keeps walking.");
  else if (take < 4) lines.push(`Thirty minutes, ${describeCoins(take)}. Mostly coins.`);
  else lines.push(`Thirty minutes. Someone folds a note into your hand without breaking stride. $${take}.`);

  if (look > 60) lines.push("Dressed like that, people assume you're doing fine.");
  if (traffic < 1) lines.push("The street is empty at this hour.");

  pushLog(s, `Panhandled for $${take}.`, take > 0 ? "money" : "plain");
  // Titled by where you actually are — there is a corner in Brokedale too.
  return menu(`Corner of ${zoneAt(townOf(s), s.player.pos.y).name}`, lines, [{ label: "Get up" }], take > 0 ? "money" : "plain");
}

export function scavenge(ctx: ActionCtx, key: string): Prompt {
  const s = ctx.state;
  ctx.advance(12, { exertion: 1.6 });
  applyDelta(s.meters, { hygiene: -3, energy: -3, morale: -3 });

  // A bin you emptied refills after about eight hours. One you have never
  // touched is always worth opening — including on the morning of day one,
  // when `time` is still smaller than that window.
  const lastEmptied = s.flags[key];
  if (lastEmptied !== undefined && lastEmptied > s.time - 8 * 60) {
    return say("Dumpster", "Somebody has already been through this one today.");
  }
  s.flags[key] = s.time;

  const cans = ctx.rng.int(1, 6);
  const found: string[] = [];
  s.inventory.recyclables = (s.inventory.recyclables ?? 0) + cans;
  found.push(cans === 1 ? "one can with the deposit still on it" : `${cans} cans and bottles`);

  if (ctx.rng.chance(0.22)) {
    s.inventory.trashFood = (s.inventory.trashFood ?? 0) + 1;
    found.push("something wrapped that still smells fine");
  }
  if (ctx.rng.chance(0.06)) {
    const cash = ctx.rng.int(1, 8);
    earnCash(s, cash);
    found.push(`$${cash} in a coat pocket`);
  }
  if (ctx.rng.chance(0.04)) {
    s.meters.health = Math.max(0, s.meters.health - 8);
    found.push("a cut on your hand from broken glass");
  }

  pushLog(s, `Scavenged: ${found.join(", ")}.`);
  return menu("Dumpster", [`You find ${listSentence(found)}.`], [{ label: "Close the lid" }]);
}

export function startAssignment(ctx: ActionCtx, gig: GigId, targets: { x: number; y: number }[], label: string): Prompt {
  const s = ctx.state;
  const def = GIGS[gig];
  s.assignment = {
    gig,
    label,
    targets: targets.slice(0, def.stops),
    ready: false,
    pay: def.basePay,
    expiresAtDay: Math.floor(s.time / MINUTES_PER_DAY) + 2,
  };
  if (gig === "flyers") s.inventory.flyers = 1;
  pushLog(s, `Took a job: ${label}.`);
  return menu(
    "Job Board",
    [label, `${targets.length} stop${targets.length === 1 ? "" : "s"}. Pays $${def.basePay} on completion.`,
     "The board marks the addresses on your map."],
    [{ label: "Take the job" }],
  );
}

/** Called when the player interacts with a tile that is an assignment stop. */
export function workAssignmentStop(ctx: ActionCtx, index: number): Prompt | null {
  const s = ctx.state;
  const a = s.assignment;
  if (!a) return null;

  // Expire stale assignments so they can't be completed days later.
  const currentDay = Math.floor(s.time / MINUTES_PER_DAY) + 1;
  if (currentDay > a.expiresAtDay) {
    pushLog(s, `The ${a.label} job expired. The board has moved on.`, "bad");
    removeItem(s.inventory, "flyers", 1);
    s.assignment = null;
    return say("Job Board", "That job's window has passed. The board has reassigned it.");
  }

  const def = GIGS[a.gig];
  const gate = canDoGig(s, a.gig);
  if (!gate.ok) return say("You can't", cap(gate.reasons[0] ?? "not right now") + ".");

  const perStop = def.stops > 0 ? 1 / def.stops : 1;
  const minutes = a.gig === "yardWork" ? def.minutes : 14;
  ctx.advance(minutes, { exertion: def.exertion });
  applyDelta(s.meters, scaleDelta(def.cost, perStop));

  a.targets.splice(index, 1);

  if (a.targets.length === 0) {
    a.ready = true;
    const weather = WEATHER[s.weather].payScale;
    a.pay = Math.max(1, Math.round(def.basePay * (weather * 0.4 + 0.6)));
    pushLog(s, `${a.label} — finished. Collect at the job board.`, "good");
    return menu(
      a.gig === "yardWork" ? "Yard work" : "Deliveries",
      ["That's the last one.", `Go back to the job board on Market Square to get paid.`],
      [{ label: "Done" }],
      "good",
    );
  }

  return menu(
    a.gig === "yardWork" ? "Yard work" : "Deliveries",
    [`Done. ${a.targets.length} stop${a.targets.length === 1 ? "" : "s"} left.`],
    [{ label: "Keep going" }],
  );
}

export function collectAssignment(ctx: ActionCtx): Prompt {
  const s = ctx.state;
  const a = s.assignment;
  if (!a || !a.ready) return say("Job Board", "Nothing to collect yet.");
  earnCash(s, a.pay);
  changeReputation(s, 1);
  s.gigsToday[a.gig] = (s.gigsToday[a.gig] ?? 0) + 1;
  removeItem(s.inventory, "flyers", 1);
  s.assignment = null;
  pushLog(s, `${a.label} paid out $${a.pay}.`, "money");
  return menu("Job Board", [`"Nice work."`, `Paid: $${a.pay}.`], [{ label: "Take it" }], "money");
}

/* ------------------------------------------------------------------- sleep */

/** The longest run at morning that still counts as going to bed for the night. */
const LONGEST_NIGHT = 13 * 60;
/** What you get instead when you lie down in the middle of the day. */
const NAP = 4 * 60;
/** A full night. Rest is scaled against this, so a nap is not a night. */
const FULL_NIGHT = 8 * 60;

export function sleep(ctx: ActionCtx, where: HousingId, untilHour = 7): Prompt {
  const s = ctx.state;
  const def = HOUSING[where];
  // Once the wake hour is behind you, `minutesUntilHour` wraps to tomorrow.
  // Taken literally that meant lying down at 8AM cost twenty-three hours and
  // woke you starving. Past a plausible bedtime it is a nap, not a night.
  const raw = minutesUntilHour(s.time, untilHour);
  const overnight = raw <= LONGEST_NIGHT;
  const minutes = overnight ? raw : NAP;
  const lines: string[] = [];

  ctx.advance(minutes, { asleep: true, sheltered: where !== "bench" && where !== "street" });
  const wokeAt = Math.floor(minuteOfDay(s.time) / 60);

  // Rest is paid by the hour. Without this, lying down at 7:00 for the half
  // hour the clock had left handed back a whole night's energy, over and over.
  const share = Math.min(1, minutes / FULL_NIGHT);
  // Coffee is the other half of this. A night on top of five cups is not a
  // night — otherwise you could stay wired all day and sleep it off for free.
  const wired = clamp01(1 - s.caffeine * 0.08, 0.55);
  const restored = Math.round(100 * def.restQuality * share * wired * (s.sick ? 0.7 : 1));
  s.meters.energy = Math.min(100, s.meters.energy + restored);
  if (s.caffeine >= 4) lines.push("You lie there wide awake for a long time with your heart going.");
  s.caffeine = 0;
  s.meters.morale = Math.min(100, s.meters.morale + (def.restQuality >= 0.7 ? 10 : 2) * share);
  if (def.hasShower) s.meters.hygiene = Math.min(100, s.meters.hygiene + 8 * share);

  lines.push(
    overnight
      ? `You sleep until ${fmtHour(wokeAt)}.`
      : `It is the middle of the day. You get four hours and wake at ${fmtHour(wokeAt)}, no better off.`,
  );

  if (def.risk > 0 && ctx.rng.chance(def.risk)) {
    const roll = ctx.rng.next();
    if (roll < 0.5 && s.cash > 0) {
      const stolen = Math.min(s.cash, Math.max(1, Math.round(s.cash * ctx.rng.float(0.4, 1))));
      s.cash -= stolen;
      s.meters.morale = Math.max(0, s.meters.morale - 14);
      lines.push(`You wake up with your pockets turned out. $${stolen} gone.`);
      pushLog(s, `Robbed in the night — $${stolen}.`, "bad");
    } else if (roll < 0.75) {
      s.meters.energy = Math.max(10, s.meters.energy - 35);
      lines.push("You were moved on twice in the night. You barely slept.");
    } else {
      const bag = s.inventory.sleepingBag ?? 0;
      if (bag > 0) {
        removeItem(s.inventory, "sleepingBag", 1);
        lines.push("Your sleeping bag is gone. Someone needed it more, or sold it faster.");
      } else {
        s.meters.health = Math.max(0, s.meters.health - 10);
        lines.push("You wake up soaked to the skin and shaking.");
      }
    }
  } else if (where === "bench" || where === "street") {
    if ((s.inventory.sleepingBag ?? 0) > 0) {
      s.meters.energy = Math.min(100, s.meters.energy + 18);
      lines.push("The sleeping bag makes the difference between rest and merely lying down.");
    } else {
      lines.push("Slats, cold, and the six o'clock sprinklers.");
    }
  }

  if (def.restQuality >= 0.9) lines.push("You wake up properly rested. It is still a strange feeling.");
  return menu(def.name, lines, [{ label: "Get up" }]);
}

/* ------------------------------------------------------------------- items */

/**
 * Eat it, drink it, wash with it. Returns the flavour prompt if the item has
 * one, so the UI can show it; the effects have already been applied.
 */
export function consume(ctx: ActionCtx, id: ItemId): Prompt | null {
  const s = ctx.state;
  const def = ITEMS[id];
  if (!def.consumable) return null;
  if (!removeItem(s.inventory, id, 1)) return null;

  ctx.advance(def.minutes ?? 5, { sheltered: true });

  if (id === "coffee") {
    const cup = caffeineCup(s);
    applyDelta(s.meters, cup.delta);
    s.caffeine += 1;
    pushLog(s, `Used ${def.name}.`);
    return say(def.name, cup.flavor);
  }

  if (def.effect) applyDelta(s.meters, def.effect);

  // Medicine specifically breaks the fever; the clinic does the same but costs money.
  if (id === "medicine" && s.sick) {
    s.sick = false;
    pushLog(s, "The fever breaks. Your head clears.", "good");
  }

  pushLog(s, `Used ${def.name}.`);
  return def.flavor ? say(def.name, def.flavor) : null;
}

/**
 * What the next cup is actually worth.
 *
 * Coffee is priced fine — dearer per point of energy than a hostel cot. The
 * hole was that nothing capped it: seven cups is $21 and thirty-five minutes,
 * and it bought back a night worth several hundred dollars of an executive's
 * time. You could simply stop sleeping.
 *
 * So each cup does less than the one before, and none of it is free. Six cups
 * come to about 29 energy against a bed's 75, which makes coffee what it
 * should be — the thing that gets you through this evening, not a substitute
 * for the night.
 */
export function caffeineCup(s: GameState): { delta: MeterDelta; flavor: string } {
  const n = s.caffeine;
  const energy = Math.max(1, Math.round(12 * Math.pow(0.6, n)));
  // The first is a small pleasure. The fourth is maintenance.
  const morale = n === 0 ? +10 : n <= 2 ? +3 : -2;
  const health = n <= 1 ? 0 : -(n - 1);

  const flavor =
    n === 0
      ? "Small pleasure. It counts."
      : n <= 2
        ? "Your hands stop shaking. That is either the coffee or the caffeine debt."
        : n <= 4
          ? "It is not doing much now. You drink it for something to hold."
          : "You cannot taste it any more and your heart is going like a bird's.";

  return { delta: { energy, morale, health, thirst: +30 }, flavor };
}

/* ------------------------------------------------------------------ helpers */

export function scaleDelta<T extends Record<string, number | undefined>>(d: T, k: number): T {
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(d)) if (v !== undefined) out[key] = v * k;
  return out as T;
}

export function fmtHour(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  const suffix = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}${suffix}`;
}

export function fmtDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clamp01(v: number, lo = 0): number {
  return v < lo ? lo : v > 1 ? 1 : v;
}

function describeCoins(n: number): string {
  return `$${n}`;
}

export function listSentence(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "nothing";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function lockedChoice(label: string, reasons: string[], hint?: string): Choice {
  return { label, hint, locked: cap(reasons[0] ?? "not available") };
}
