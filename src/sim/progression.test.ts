import { describe, expect, it } from "vitest";
import { STARTING_TOWN, markerPos, townById } from "../world/map";
/** These bots only ever walk Brokemon Town. */
const TOWN = townById(STARTING_TOWN);

import { approaches, sleepableBenches, type Approach } from "../world/landmarks";
import { interact } from "./actions";
import { countOf, type ItemId } from "./items";
import type { Choice, Prompt } from "./prompt";
import { Rng } from "./rng";
import {
  type Facing,
  type GameState,
  createState,
  currentAppearance,
  housingIn,
  phaseOf,
} from "./state";
import { advance } from "./tick";
import { dayOf, formatClock, hourOf, minuteOfDay, minutesUntilHour } from "./time";
import { consume, type ActionCtx } from "./work";
import { EMPLOYMENT, EMPLOYMENT_ORDER, type EmploymentId } from "./jobs";
import { shiftWindow } from "./work";

class Player {
  readonly s: GameState;
  readonly rng: Rng;
  readonly ctx: ActionCtx;
  notes: string[] = [];

  constructor(seed: number) {
    this.s = createState(seed);
    this.rng = new Rng(seed);
    this.ctx = {
      state: this.s,
      rng: this.rng,
      advance: (m, o) => void advance(this.s, this.rng, { minutes: m, ...o }),
      teleport: (x, y) => { this.s.player.pos = { x, y }; },
    };
  }

  /** Walking across town costs real time; don't let the bot cheat it. */
  goto(marker: string): void {
    const p = markerPos(TOWN, marker);
    this.ctx.advance(10, { exertion: 1.35 });
    this.s.player.pos = { x: p.x, y: p.y };
  }

  standAt(x: number, y: number, f: Facing): void {
    this.ctx.advance(10, { exertion: 1.35 });
    this.s.player.pos = { x, y };
    this.s.player.facing = f;
  }

  press(): Prompt | null { return interact(this.ctx); }

  drive(p: Prompt | null, ...path: string[]): Prompt | null {
    let cur = p;
    for (const step of path) {
      if (!cur?.choices) return cur;
      const c: Choice | undefined = cur.choices.find(
        (q) => !q.locked && q.label.toLowerCase().includes(step.toLowerCase()));
      if (!c) return null;
      cur = c.run?.() ?? null;
    }
    return cur;
  }

  can(p: Prompt | null, label: string): boolean {
    return Boolean(p?.choices?.some((c) => !c.locked && c.label.toLowerCase().includes(label.toLowerCase())));
  }

  /** Why is this option unavailable? */
  lockReason(p: Prompt | null, label: string): string | null {
    const c = p?.choices?.find((q) => q.label.toLowerCase().includes(label.toLowerCase()));
    return c?.locked ?? null;
  }

  /** Wait only if `hour` is still ahead of us today. Never rolls to tomorrow. */
  waitUntil(hour: number): boolean {
    const now = minuteOfDay(this.s.time) / 60;
    if (now >= hour) return false;
    this.ctx.advance((hour - now) * 60);
    return true;
  }

  eat(): void {
    const order: ItemId[] = ["hotMeal", "sandwich", "instantNoodles", "trashFood"];
    while (this.s.meters.hunger < 62) {
      const pick = order.find((i) => countOf(this.s.inventory, i) > 0);
      if (!pick) break;
      consume(this.ctx, pick);
    }
    while (this.s.meters.thirst < 62 && countOf(this.s.inventory, "waterBottle") > 0) {
      consume(this.ctx, "waterBottle");
    }
  }

  drink(): void {
    for (let i = 0; i < 3 && this.s.meters.thirst < 85; i++) {
      this.approach(FOUNTAIN);
      this.drive(this.press(), "drink");
    }
  }

  /** Stand beside a piece of scenery and face it. */
  approach(a: Approach): void {
    this.standAt(a.pos.x, a.pos.y, a.facing);
  }

  wash(): void {
    if (this.s.meters.hygiene >= 65) return;
    this.goto("communityCenter");
    this.drive(this.press(), "wash up");
  }

  note(t: string): void {
    this.notes.push(`d${dayOf(this.s.time)} ${formatClock(this.s.time)}  ${t}`);
  }
}

// Read off the map rather than written down — see world/landmarks.ts for why.
const FOUNTAIN = approaches(TOWN, "water")[0]!;
const DUMPSTERS = approaches(TOWN, "dumpster");
const BENCH = sleepableBenches(TOWN)[0]!;

function scavenge(p: Player): void {
  for (const d of DUMPSTERS) {
    p.approach(d);
    p.drive(p.press(), "close the lid");
  }
  if (countOf(p.s.inventory, "recyclables") > 0) {
    p.goto("recycling");
    p.drive(p.press(), "feed it in");
  }
}

function beg(p: Player, n: number): void {
  for (let i = 0; i < n; i++) {
    p.goto("panhandleSpot");
    p.drive(p.press(), "sit down and ask", "get up");
  }
}

/** Buy the next rung of the ladder whenever it becomes affordable. */
function shop(p: Player): void {
  const s = p.s;

  if (!s.wardrobe.includes("thrift") && s.cash >= 15 && currentAppearance(s) >= 28) {
    p.goto("mart");
    if (p.drive(p.press(), "thrift")) p.note("BOUGHT thrift clothes");
  }
  if (countOf(s.inventory, "phone") === 0 && s.cash >= 45 && currentAppearance(s) >= 28) {
    p.goto("mart");
    const m = p.press();
    if (p.can(m, "buy something")) { p.drive(m, "buy something", "Prepaid Phone"); p.note("BOUGHT phone"); }
  }
  if (!s.wardrobe.includes("smartCasual") && s.cash >= 60 && hourOf(s.time) >= 7 && hourOf(s.time) < 21) {
    p.goto("laundromat");
    if (p.drive(p.press(), "buy smart casual")) p.note("BOUGHT smart casual");
  }
  if (!s.wardrobe.includes("professional") && s.cash >= 180 && hourOf(s.time) >= 7 && hourOf(s.time) < 21) {
    p.goto("laundromat");
    if (p.drive(p.press(), "buy interview suit")) p.note("BOUGHT interview suit");
  }
  if (!s.wardrobe.includes("tailored") && s.cash >= 900 && hourOf(s.time) >= 7 && hourOf(s.time) < 21) {
    p.goto("laundromat");
    if (p.drive(p.press(), "buy tailored")) p.note("BOUGHT tailored suit");
  }
}

/**
 * Take the best job we now qualify for — and, when nothing better is open,
 * take a pay cut into whichever rung the next one wants on your record. The
 * ladder is not sorted by wage: Grounds Crew pays more than Mart Clerk and
 * asks for shifts behind a Mart Clerk till before it will look at you.
 */
function jobHunt(p: Player): void {
  const s = p.s;
  if (hourOf(s.time) < 8 || hourOf(s.time) >= 17) return;

  // The board outside the parks office carries the same listings as the plaza
  // lobby, and does not have a security desk in front of it.
  p.goto("jobBoard");
  const list = p.drive(p.press(), "career listings");
  const open = EMPLOYMENT_ORDER.filter((id) => id !== s.employment && p.can(list, EMPLOYMENT[id].name));
  const currentPay = s.employment ? EMPLOYMENT[s.employment].pay : 0;

  const apply = (id: EmploymentId) => {
    const before = s.employment;
    p.drive(list, EMPLOYMENT[id].name);
    p.note(s.employment !== before ? `HIRED as ${EMPLOYMENT[id].name}` : `interview failed: ${EMPLOYMENT[id].name}`);
  };

  // Rungs that are held up only by shifts we have not put in anywhere yet.
  const owed = new Set<EmploymentId>();
  for (const id of EMPLOYMENT_ORDER) {
    const exp = EMPLOYMENT[id].requires.experience;
    if (exp && (s.shiftsWorked[exp.job] ?? 0) < exp.shifts) owed.add(exp.job);
  }
  // Never walk out of a job we are only holding for the reference — chasing
  // the extra sixteen dollars a shift costs more than it pays.
  if (s.employment && owed.has(s.employment)) return;

  const raise = open
    .filter((id) => EMPLOYMENT[id].pay > currentPay)
    .sort((a, b) => EMPLOYMENT[b].pay - EMPLOYMENT[a].pay)[0];
  if (raise) return apply(raise);

  const stepDown = open.find((id) => owed.has(id));
  if (stepDown) {
    p.note(`stepping down to ${EMPLOYMENT[stepDown].name} for the reference`);
    return apply(stepDown);
  }

  const next = EMPLOYMENT_ORDER.filter((id) => EMPLOYMENT[id].pay > currentPay)[0];
  if (next) p.note(`no job open. ${EMPLOYMENT[next].name} blocked: ${p.lockReason(list, EMPLOYMENT[next].name)}`);
}

/** Stock up on food. The food bank alone does not cover a day's hunger. */
function groceries(p: Player): void {
  const s = p.s;
  if (s.cash < 40 || countOf(s.inventory, "sandwich") >= 3) return;
  if (hourOf(s.time) < 6 || hourOf(s.time) >= 23) return;
  p.goto("mart");
  const m = p.press();
  if (!p.can(m, "buy something")) return;
  let shopMenu = p.drive(m, "buy something");
  for (let i = 0; i < 3 && s.cash > 25; i++) {
    if (!p.can(shopMenu, "Deli Sandwich")) break;
    shopMenu = p.drive(shopMenu, "Deli Sandwich");
  }
}

/** Drink up to `target` energy on gas-station coffee, if the Mart is open. */
function caffeinate(p: Player, target: number): void {
  const s = p.s;
  if (s.meters.energy >= target || s.cash < 10) return;
  if (hourOf(s.time) < 6 || hourOf(s.time) >= 23) return;
  p.goto("mart");
  let m = p.press();
  if (!p.can(m, "buy something")) return;
  m = p.drive(m, "buy something");
  for (let i = 0; i < 3 && s.meters.energy < target && s.cash >= 4; i++) {
    if (!p.can(m, "Coffee")) break;
    m = p.drive(m, "Coffee");
    consume(p.ctx, "coffee");
  }
}

/** A hot meal is the only reliable way to buy Dignity back. */
function morale(p: Player): void {
  const s = p.s;
  if (s.meters.morale >= 35 || s.cash < 40) return;
  if (hourOf(s.time) < 6 || hourOf(s.time) >= 23) return;
  p.goto("mart");
  const m = p.press();
  if (p.can(m, "buy something")) {
    p.drive(m, "buy something", "Hot Meal");
    consume(p.ctx, "hotMeal");
  }
}

function upgradeHousing(p: Player): void {
  const s = p.s;
  if (housingIn(s) === "estate") return;
  if (housingIn(s) !== "apartment") {
    p.goto("apartment");
    const a = p.press();
    if (p.can(a, "sign the lease")) { p.drive(a, "sign the lease"); p.note("SIGNED apartment lease"); return; }
  }
  if (housingIn(s) === "street" && s.cash >= 90) {
    p.goto("trailer");
    const t = p.press();
    if (p.can(t, "take it")) { p.drive(t, "take it"); p.note("RENTED trailer"); }
  }
}

function endgame(p: Player): void {
  const s = p.s;
  if (hourOf(s.time) < 8 || hourOf(s.time) >= 18) return;
  if (!s.businessOwned && phaseOf(s) >= 3) {
    p.goto("corporatePlaza");
    const l = p.press();
    if (p.can(l, "franchise")) { p.drive(l, "buy the mart franchise"); p.note("BOUGHT the franchise"); }
  }
  if (s.businessOwned && !s.mayor) {
    p.goto("corporatePlaza");
    const l = p.press();
    if (p.can(l, "run for mayor")) { p.drive(l, "run for mayor"); p.note(s.mayor ? "ELECTED MAYOR" : "lost the election"); }
  }
  if (housingIn(s) !== "estate") {
    p.goto("estate");
    const e = p.press();
    if (p.can(e, "make an offer")) { p.drive(e, "make an offer"); p.note("BOUGHT THE ESTATE"); }
  }
}

function bank(p: Player): void {
  const s = p.s;
  if (hourOf(s.time) < 9 || hourOf(s.time) >= 17) return;
  // Keep a float for rent/food, bank the rest, clear debt first.
  if (s.cash > 400) {
    p.goto("bank");
    const b = p.press();
    if (s.debt > 0 && p.can(b, "pay down")) { p.drive(b, "pay down the debt"); }
    else if (p.can(b, "deposit")) p.drive(b, "deposit cash");
  }
}

function sleep(p: Player): void {
  const s = p.s;
  if (housingIn(s) === "estate" || housingIn(s) === "apartment") {
    p.goto(housingIn(s));
    p.drive(p.press(), "sleep");
    return;
  }
  if (housingIn(s) === "trailer") {
    p.goto("trailer");
    p.drive(p.press(), "sleep");
    return;
  }
  if (s.cash >= 12) {
    p.goto("hostel");
    if (p.drive(p.press(), "pay for a cot")) return;
  }
  p.approach(BENCH);
  if (!p.drive(p.press(), "sleep here")) {
    // Ordinance zone or no bench: ride it out on the street.
    p.ctx.advance(minutesUntilHour(p.s.time, 7), { asleep: true });
    p.s.meters.energy = Math.min(100, p.s.meters.energy + 30);
  }
}

function workShiftIfDue(p: Player): boolean {
  const s = p.s;
  const job = s.employment;
  if (!job) return false;
  const d = EMPLOYMENT[job];
  const w = shiftWindow(s, job);
  if (w === "closed") return false;
  if (w === "early") p.waitUntil(d.shiftStart);

  // Turn up clean enough not to be sent home.
  const need = d.requires.hygiene ?? 0;
  if (s.meters.hygiene < need + 5) p.wash();

  p.goto(d.location);
  const before = s.shiftsWorked[job] ?? 0;
  const prompt = p.press();
  if (p.can(prompt, "clock in")) p.drive(prompt, "clock in", "clock out");
  else if (p.can(prompt, "go up to your floor")) p.drive(prompt, "go up to your floor", "clock out");
  const after = s.shiftsWorked[job] ?? 0;
  if (after === before) p.note(`MISSED shift (${d.name}, window ${w}, hyg ${s.meters.hygiene.toFixed(0)}, strikes ${s.strikes})`);
  return after > before;
}

function playDay(p: Player): void {
  const s = p.s;
  p.waitUntil(7);

  // Food and water first — everything else fails if these are empty.
  p.goto("communityCenter");
  p.drive(p.press(), "food bank");
  p.eat();
  p.drink();

  if (s.meters.health < 40 || s.sick) {
    p.goto("communityCenter");
    const c = p.press();
    if (p.can(c, "nurse")) p.drive(c, "nurse");
    else if (p.can(c, "checked over")) p.drive(c, "checked over");
  }

  const worked = workShiftIfDue(p);

  p.wash();
  shop(p);
  groceries(p);
  morale(p);
  // Check the board whether or not we have a job. Holding one is no reason to
  // stop looking, and a bot that only looked while unemployed sat on the same
  // rung for two hundred shifts.
  jobHunt(p);
  // Clear the debt while the bank is still open — the score will not climb
  // past 600 until it is gone, and 620 is what the lease wants.
  bank(p);
  upgradeHousing(p);
  endgame(p);

  p.eat();
  p.drink();

  // Fill whatever is left of the day with paid work.
  if (!worked) {
    p.goto("mart");
    const m = p.press();
    if (p.can(m, "unloading")) p.drive(m, "ask about unloading");
    scavenge(p);
    beg(p, 3);
  } else if (hourOf(s.time) < 18) {
    scavenge(p);
  }

  p.eat();
  p.drink();

  // Night school is the only door to phase 3, so it outranks saving.
  if (s.education < 5 && s.cash >= 55 && hourOf(s.time) < 21) {
    // A shift plus a day on your feet leaves you under the twenty energy the
    // class wants. Gas-station coffee is the only thing that closes the gap.
    caffeinate(p, 26);
    p.waitUntil(19);
    p.goto("college");
    const c = p.press();
    if (p.can(c, "attend")) { p.drive(c, "attend"); p.note(`CLASS ${s.education}/6`); }
    else p.note(`class blocked: ${p.lockReason(c, "attend")}`);
  }

  p.eat();
  p.wash();
  // The overnight shift starts at 10PM, after everything else has shut.
  if (!worked) workShiftIfDue(p);
  sleep(p);
}

/** Play until the run ends, recording the day each milestone was reached. */
function playThrough(seed: number, days: number) {
  const p = new Player(seed);
  const s = p.s;
  const reached: Record<string, number> = {};
  let peakMorale = 0;

  for (let d = 0; d < days; d++) {
    playDay(p);
    peakMorale = Math.max(peakMorale, s.meters.morale);
    const ph = phaseOf(s);
    reached[`phase${ph}`] ??= dayOf(s.time);
    if (s.businessOwned) reached.business ??= dayOf(s.time);
    if (s.mayor) reached.mayor ??= dayOf(s.time);
    if (s.won) { reached.won = dayOf(s.time); break; }
  }
  return { p, s, reached, peakMorale };
}

describe("the ladder is climbable", () => {
  const { s, reached, peakMorale } = playThrough(2026, 260);

  it("gets off the street in the first week", () => {
    expect(reached.phase2).toBeDefined();
    expect(reached.phase2!).toBeLessThan(10);
  });

  it("reaches a career and an apartment", () => {
    expect(reached.phase3, "phase 3 never reached").toBeDefined();
    expect(reached.phase3!).toBeLessThan(140);
  });

  it("reaches the apex", () => {
    expect(reached.phase4, "phase 4 never reached").toBeDefined();
    expect(reached.business, "the franchise was never affordable").toBeDefined();
  });

  it("can actually be won", () => {
    expect(reached.won, "the estate stayed out of reach for the whole run").toBeDefined();
  });

  it("works real shifts on the way up", () => {
    const total = Object.values(s.shiftsWorked).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(50);
  });

  it("lets Dignity climb, not just fall", () => {
    // It used to be a one-way ratchet that sat on zero for entire runs.
    expect(peakMorale).toBeGreaterThan(60);
  });
});

describe("every job can actually be worked", () => {
  // Grounds Crew was once a dead end: hired at a location whose venue had no
  // way to clock in, and never fired either, since firing only happens inside
  // a worked shift.
  it.each(EMPLOYMENT_ORDER)("%s has somewhere to clock in", (id) => {
    const def = EMPLOYMENT[id];
    const p = new Player(5);
    const s = p.s;
    s.employment = id;
    s.meters = { hunger: 90, thirst: 90, hygiene: 95, energy: 90, morale: 80, health: 95 };
    s.wearing = "tailored";
    s.wardrobe.push("tailored");
    s.education = 6;
    s.inventory.phone = 1;
    s.shiftsWorked.officeAdmin = 20;
    p.waitUntil(def.shiftStart);

    p.goto(def.location);
    const prompt = p.press();
    const clockIn = prompt?.choices?.some((c) =>
      /clock in|go up to your floor/i.test(c.label));
    expect(clockIn, `no way to work ${def.name} at ${def.location}`).toBe(true);
  });
});
