/**
 * Playtest rig. Not part of the test suite — run it with:
 *   npm run playtest            (a default spread of seeds)
 *   npm run playtest -- 7 99    (specific ones)
 *
 * The difference from progression.test.ts is that this bot *walks*. It
 * pathfinds on the real grid at the real per-tile cost, takes police checks
 * and random encounters on the way, and records where the day actually goes.
 * Every bug worth finding so far has been one the teleporting bot could not
 * see, because it never paid for the distance between two places.
 */

/** Declared rather than typed in: this file runs under vite-node, not the app. */
declare const process: { argv: string[] };

import { isSolid, markerPos, townById, STARTING_TOWN, type Town, type Vec2 } from "../world/map";
import { approaches, sleepableBenches, type Approach } from "../world/landmarks";
import { interact } from "./actions";
import { EVENT_STEP_INTERVAL, rollEvent } from "./events";
import { countOf, type ItemId } from "./items";
import { EMPLOYMENT, EMPLOYMENT_ORDER, type EmploymentId } from "./jobs";
import type { Choice, Prompt } from "./prompt";
import { Rng } from "./rng";
import {
  bestHousing,
  createState,
  currentAppearance,
  housingIn,
  phaseOf,
  reputationIn,
  townOf,
  type Facing,
  type GameState,
} from "./state";
import { advance, policeCheck } from "./tick";
import { dayOf, formatClock, hourOf, minuteOfDay } from "./time";
import { consume, shiftWindow, type ActionCtx } from "./work";

/* --------------------------------------------------------------- walking */

const STEP_MS = 180;
const BIKE_STEP_MS = 95;
const MS_PER_MINUTE = 260;

/** The town the rig walks. Phase 1 will make this follow the player. */
const TOWN: Town = townById(STARTING_TOWN);

/** BFS from a tile to every reachable tile. Cached — the grid never changes. */
const pathCache = new Map<string, number[][]>();

function distanceField(from: Vec2): number[][] {
  const k = `${from.x},${from.y}`;
  const hit = pathCache.get(k);
  if (hit) return hit;

  const dist: number[][] = Array.from({ length: TOWN.height }, () => new Array<number>(TOWN.width).fill(-1));
  const queue: Vec2[] = [from];
  dist[from.y]![from.x] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const d = dist[cur.y]![cur.x]!;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= TOWN.width || ny >= TOWN.height) continue;
      if (dist[ny]![nx] !== -1) continue;
      if (isSolid(TOWN, nx, ny)) continue;
      dist[ny]![nx] = d + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  pathCache.set(k, dist);
  return dist;
}

/** Tiles between two walkable cells, or -1 if there is no route at all. */
export function tileDistance(a: Vec2, b: Vec2): number {
  if (isSolid(TOWN, a.x, a.y) || isSolid(TOWN, b.x, b.y)) return -1;
  return distanceField(a)[b.y]![b.x]!;
}

/* ------------------------------------------------------------------ bot */

interface DayLog {
  day: number;
  cashStart: number;
  cashEnd: number;
  walkMinutes: number;
  workMinutes: number;
  worked: boolean;
  low: Record<string, number>;
  notes: string[];
}

class Player {
  readonly s: GameState;
  readonly rng: Rng;
  readonly ctx: ActionCtx;

  notes: string[] = [];
  days: DayLog[] = [];
  /** Minutes spent walking, per day. */
  walkMinutes = 0;
  workMinutes = 0;
  blocked = new Map<string, number>();
  stepsSinceEvent = 0;
  low = { hunger: 100, thirst: 100, hygiene: 100, energy: 100, morale: 100, health: 100 };

  constructor(seed: number) {
    this.s = createState(seed);
    this.rng = new Rng(seed);
    this.ctx = {
      state: this.s,
      rng: this.rng,
      advance: (m, o) => {
        const c0 = this.s.collapses;
        const snap = { ...this.s.meters, sick: this.s.sick, weather: this.s.weather };
        advance(this.s, this.rng, { minutes: m, ...o });
        for (const k of ["hunger", "thirst", "hygiene", "energy", "morale", "health"] as const) {
          this.low[k] = Math.min(this.low[k], this.s.meters[k]);
        }
        if (this.s.collapses > c0) {
          this.note(
            `COLLAPSE (before: hun ${snap.hunger.toFixed(0)} thi ${snap.thirst.toFixed(0)} ` +
              `hea ${snap.health.toFixed(0)} sick ${snap.sick} ${snap.weather}) over ${m.toFixed(0)}min`,
          );
        }
      },
      teleport: (x, y) => {
        this.s.player.pos = { x, y };
      },
    };
  }

  /* ---- movement -------------------------------------------------------- */

  private stepMinutes(): number {
    return (countOf(this.s.inventory, "bicycle") > 0 ? BIKE_STEP_MS : STEP_MS) / MS_PER_MINUTE;
  }

  /**
   * The Heights are sealed off by a hedge with one security gate in it. The
   * gate tile is solid, so pathfinding cannot cross it — you have to stand at
   * it and be let through. Everything above row 14 is on the far side.
   */
  walkTo(dest: Vec2): void {
    const upThere = (v: Vec2) => v.y <= 13;
    if (upThere(dest) !== upThere(this.s.player.pos)) {
      const goingUp = upThere(dest);
      this.walkStraight({ x: 23, y: goingUp ? 15 : 13 });
      this.s.player.facing = goingUp ? "up" : "down";
      const before = this.s.player.pos.y;
      this.press();
      if (this.s.player.pos.y === before) {
        this.blocked.set("heights gate: turned away", (this.blocked.get("heights gate: turned away") ?? 0) + 1);
        return;
      }
    }
    this.walkStraight(dest);
  }

  private walkStraight(dest: Vec2): void {
    const tiles = tileDistance(this.s.player.pos, dest);
    if (tiles < 0) {
      this.note(`UNREACHABLE ${dest.x},${dest.y} from ${this.s.player.pos.x},${this.s.player.pos.y}`);
      this.s.player.pos = { ...dest };
      return;
    }
    const per = this.stepMinutes();
    for (let i = 0; i < tiles; i++) {
      this.ctx.advance(per, { exertion: 1.35 });
      this.walkMinutes += per;
      this.stepsSinceEvent += 1;
      // The renderer runs these on every completed step; so do we.
      policeCheck(this.s, this.rng);
      if (this.stepsSinceEvent >= EVENT_STEP_INTERVAL) {
        this.stepsSinceEvent = 0;
        if (this.rng.chance(0.4)) this.resolve(rollEvent(this.ctx));
      }
    }
    this.s.player.pos = { ...dest };
  }

  goto(marker: string): void {
    this.walkTo(markerPos(townOf(this.s), marker));
  }

  standAt(x: number, y: number, f: Facing): void {
    this.walkTo({ x, y });
    this.s.player.facing = f;
  }

  /** Walk to the tile beside a piece of scenery and face it. */
  approach(a: Approach): void {
    this.standAt(a.pos.x, a.pos.y, a.facing);
  }

  /* ---- prompts --------------------------------------------------------- */

  press(): Prompt | null {
    return interact(this.ctx);
  }

  /** Auto-answer an interrupt/event prompt by taking its first live choice. */
  private resolve(p: Prompt | null): void {
    let cur = p;
    for (let i = 0; i < 6 && cur?.choices?.length; i++) {
      const c = cur.choices.find((q) => !q.locked);
      if (!c) break;
      cur = c.run?.() ?? null;
    }
  }

  /**
   * Follow a chain of choices. Returns the prompt the last choice produced,
   * which is null for terminal choices like "Get up" — so never test this for
   * truthiness. Use `took` for "did the option exist".
   */
  drive(p: Prompt | null, ...path: string[]): Prompt | null {
    let cur = p;
    for (const step of path) {
      const c = this.choiceFor(cur, step);
      if (!c) return null;
      cur = c.run?.() ?? null;
    }
    return cur;
  }

  /** True if every step in the path was available and taken. */
  took(p: Prompt | null, ...path: string[]): boolean {
    let cur = p;
    for (const step of path) {
      const c = this.choiceFor(cur, step);
      if (!c) return false;
      cur = c.run?.() ?? null;
    }
    return true;
  }

  private choiceFor(p: Prompt | null, step: string): Choice | undefined {
    const c = p?.choices?.find((q) => !q.locked && q.label.toLowerCase().includes(step.toLowerCase()));
    if (!c) {
      const why = this.lockReason(p, step);
      if (why) this.blocked.set(`${step}: ${why}`, (this.blocked.get(`${step}: ${why}`) ?? 0) + 1);
    }
    return c;
  }

  can(p: Prompt | null, label: string): boolean {
    return Boolean(p?.choices?.some((c) => !c.locked && c.label.toLowerCase().includes(label.toLowerCase())));
  }

  lockReason(p: Prompt | null, label: string): string | null {
    const c = p?.choices?.find((q) => q.label.toLowerCase().includes(label.toLowerCase()));
    return c?.locked ?? null;
  }

  /* ---- upkeep ---------------------------------------------------------- */

  waitUntil(hour: number): boolean {
    const now = minuteOfDay(this.s.time) / 60;
    if (now >= hour) return false;
    this.ctx.advance((hour - now) * 60, { sheltered: true });
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

  note(t: string): void {
    this.notes.push(`d${dayOf(this.s.time)} ${formatClock(this.s.time)}  ${t}`);
  }
}

/* --------------------------------------------------------- day routines */

const FOUNTAINS = approaches(TOWN, "water");
const DUMPSTERS = approaches(TOWN, "dumpster");
const LEGAL_BENCHES = sleepableBenches(TOWN);

for (const [what, found] of [["water", FOUNTAINS], ["dumpsters", DUMPSTERS], ["a sleepable bench", LEGAL_BENCHES]] as const) {
  if (found.length === 0) throw new Error(`the map has no ${what} — the playtest cannot model a phase-1 day without it`);
}

function drink(p: Player): void {
  for (let i = 0; i < 3 && p.s.meters.thirst < 85; i++) {
    p.approach(nearest(p.s.player.pos, FOUNTAINS));
    if (!p.took(p.press(), "drink")) break;
  }
}

/** Whichever of these is fewest tiles away on foot. */
function nearest(from: Vec2, options: Approach[]): Approach {
  let best = options[0]!;
  let bestDist = Infinity;
  for (const option of options) {
    const d = tileDistance(from, option.pos);
    if (d >= 0 && d < bestDist) {
      bestDist = d;
      best = option;
    }
  }
  return best;
}

function wash(p: Player, target = 65): void {
  if (p.s.meters.hygiene >= target) return;
  if (housingIn(p.s) === "apartment" || housingIn(p.s) === "estate") {
    p.goto(housingIn(p.s));
    if (p.took(p.press(), "shower and change")) return;
  }
  if (housingIn(p.s) === "trailer") {
    p.goto("trailer");
    if (p.took(p.press(), "wash")) return;
  }
  p.goto("communityCenter");
  p.drive(p.press(), "wash up");
}

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
  p.goto("panhandleSpot");
  for (let i = 0; i < n; i++) p.drive(p.press(), "sit down and ask", "get up");
}

function gigs(p: Player): void {
  const s = p.s;
  p.goto("jobBoard");
  let board = p.press();
  if (p.can(board, "Yard work")) {
    p.drive(board, "Yard work", "Take the job");
    const a = s.assignment;
    if (a && a.targets[0]) {
      const t = a.targets[0];
      p.walkTo({ x: t.x, y: t.y });
      p.drive(p.press(), "done", "keep going");
      p.goto("jobBoard");
      p.drive(p.press(), "collect", "take it");
    }
  }
  p.goto("jobBoard");
  board = p.press();
  if (p.can(board, "Deliver flyers")) {
    p.drive(board, "Deliver flyers", "Take the job");
    const a = s.assignment;
    if (a) {
      for (let i = 0; i < 6 && a.targets.length > 0; i++) {
        const t = a.targets[0]!;
        p.walkTo({ x: t.x, y: t.y });
        p.drive(p.press(), "keep going");
        p.drive(p.press(), "done");
      }
      p.goto("jobBoard");
      p.drive(p.press(), "collect", "take it");
    }
  }
}

function shop(p: Player): void {
  const s = p.s;
  const look = currentAppearance(s);

  if (!s.wardrobe.includes("thrift") && s.cash >= 15 && look >= 28) {
    p.goto("mart");
    if (p.took(p.press(), "thrift")) p.note("BOUGHT thrift clothes");
  }
  // The bicycle halves every walk for the rest of the run. It pays for itself
  // faster than anything else on the shelf.
  if (countOf(s.inventory, "bicycle") === 0 && s.cash >= 110 && look >= 28) {
    p.goto("mart");
    if (p.took(p.press(), "buy something", "Bicycle")) p.note("BOUGHT a bicycle");
  }
  if (countOf(s.inventory, "phone") === 0 && s.cash >= 60 && look >= 28) {
    p.goto("mart");
    if (p.took(p.press(), "buy something", "Prepaid Phone")) p.note("BOUGHT phone");
  }
  if (countOf(s.inventory, "poncho") === 0 && s.cash >= 30 && look >= 28) {
    p.goto("mart");
    p.drive(p.press(), "buy something", "Rain Poncho");
  }

  const outfits: Array<[string, string, number]> = [
    ["smartCasual", "buy smart casual", 80],
    ["professional", "buy interview suit", 230],
    ["tailored", "buy tailored", 1100],
  ];
  for (const [id, label, need] of outfits) {
    if (!s.wardrobe.includes(id as never) && s.cash >= need && hourOf(s.time) >= 7 && hourOf(s.time) < 21) {
      p.goto("laundromat");
      if (p.took(p.press(), label)) p.note(`BOUGHT ${id}`);
    }
  }
}

function groceries(p: Player): void {
  const s = p.s;
  if (s.cash < 45 || countOf(s.inventory, "sandwich") >= 3) return;
  if (hourOf(s.time) < 6 || hourOf(s.time) >= 23) return;
  p.goto("mart");
  let m = p.drive(p.press(), "buy something");
  for (let i = 0; i < 3 && s.cash > 30; i++) {
    if (!p.can(m, "Deli Sandwich")) break;
    m = p.drive(m, "Deli Sandwich");
  }
  for (let i = 0; i < 2 && s.cash > 30; i++) {
    if (!p.can(m, "Bottled Water")) break;
    m = p.drive(m, "Bottled Water");
  }
}

function jobHunt(p: Player): void {
  const s = p.s;
  if (hourOf(s.time) < 8 || hourOf(s.time) >= 17) return;
  const currentPay = s.employment ? EMPLOYMENT[s.employment].pay : 0;
  const wanted = EMPLOYMENT_ORDER.filter((id) => EMPLOYMENT[id].pay > currentPay).sort(
    (a, b) => EMPLOYMENT[b].pay - EMPLOYMENT[a].pay,
  );
  if (wanted.length === 0) return;

  // The job board carries the same listings without the dress code on the door.
  p.goto("jobBoard");
  const list = p.drive(p.press(), "career listings");

  const owed = new Set<EmploymentId>();
  for (const id of EMPLOYMENT_ORDER) {
    const exp = EMPLOYMENT[id].requires.experience;
    if (exp && (s.shiftsWorked[exp.job] ?? 0) < exp.shifts) owed.add(exp.job);
  }
  if (s.employment && owed.has(s.employment)) return;

  for (const id of wanted) {
    if (p.can(list, EMPLOYMENT[id].name)) {
      const before = s.employment;
      p.drive(list, EMPLOYMENT[id].name);
      p.note(s.employment !== before ? `HIRED as ${EMPLOYMENT[id].name}` : `interview failed: ${EMPLOYMENT[id].name}`);
      return;
    }
    const why = p.lockReason(list, EMPLOYMENT[id].name);
    if (why) p.blocked.set(`job ${EMPLOYMENT[id].name}: ${why}`, (p.blocked.get(`job ${EMPLOYMENT[id].name}: ${why}`) ?? 0) + 1);
  }

  // Nothing better is open. Take the pay cut that earns the reference.
  const stepDown = EMPLOYMENT_ORDER.find((id) => owed.has(id) && p.can(list, EMPLOYMENT[id].name));
  if (stepDown) {
    p.drive(list, EMPLOYMENT[stepDown].name);
    p.note(`stepped down to ${EMPLOYMENT[stepDown].name} for the reference`);
  }
}

function school(p: Player): void {
  const s = p.s;
  if (s.education >= 6 || s.cash < 55) return;
  if (hourOf(s.time) >= 21) return;
  p.waitUntil(19);
  p.goto("college");
  const c = p.press();
  if (p.can(c, "attend")) {
    p.drive(c, "attend");
    p.note(`CLASS ${s.education}/6`);
  } else {
    const why = p.lockReason(c, "attend");
    if (why) p.blocked.set(`class: ${why}`, (p.blocked.get(`class: ${why}`) ?? 0) + 1);
  }
}

function housing(p: Player): void {
  const s = p.s;
  if (housingIn(s) === "estate") return;
  if (housingIn(s) !== "apartment") {
    p.goto("apartment");
    const a = p.press();
    if (p.can(a, "sign the lease")) {
      p.drive(a, "sign the lease");
      p.note("SIGNED apartment lease");
      return;
    }
    const why = p.lockReason(a, "sign the lease");
    if (why) p.blocked.set(`lease: ${why}`, (p.blocked.get(`lease: ${why}`) ?? 0) + 1);
  }
  if (housingIn(s) === "street" && s.cash >= 110) {
    p.goto("trailer");
    if (p.took(p.press(), "take it")) p.note("RENTED trailer");
  }
}

function endgame(p: Player): void {
  const s = p.s;
  if (hourOf(s.time) < 8 || hourOf(s.time) >= 18) return;
  if (phaseOf(s) < 3 && !s.businessOwned) return;

  if (!s.businessOwned) {
    p.goto("corporatePlaza");
    if (p.took(p.press(), "franchise")) p.note("BOUGHT the franchise");
  }
  if (s.businessOwned && !s.mayor) {
    p.goto("corporatePlaza");
    const l = p.press();
    if (p.can(l, "run for mayor")) {
      p.drive(l, "run for mayor");
      p.note(s.mayor ? "ELECTED MAYOR" : "lost the election");
    }
  }
  if (housingIn(s) !== "estate") {
    p.goto("estate");
    if (p.took(p.press(), "make an offer")) p.note("BOUGHT THE ESTATE");
  }
}

function banking(p: Player): void {
  const s = p.s;
  if (hourOf(s.time) < 9 || hourOf(s.time) >= 17) return;
  if (s.cash < 300) return;
  p.goto("bank");
  const b = p.press();
  if (s.debt > 0 && p.can(b, "pay down")) p.drive(b, "pay down the debt");
  else if (p.can(b, "deposit")) p.drive(b, "deposit cash");
}

function sleep(p: Player): void {
  const s = p.s;
  if (housingIn(s) === "apartment" || housingIn(s) === "estate" || housingIn(s) === "trailer") {
    p.goto(housingIn(s));
    if (p.took(p.press(), "sleep", "get up")) return;
  }
  if (s.cash >= 12) {
    p.goto("hostel");
    if (p.took(p.press(), "pay for a cot", "get up")) return;
  }
  // The shelter is free but only opens at 6PM.
  if (hourOf(s.time) >= 18 || hourOf(s.time) < 8) {
    p.goto("communityCenter");
    if (p.took(p.press(), "take a bed", "get up")) return;
  }
  // Last resort: a bench in the outskirts, where camping is not an offence.
  p.approach(nearest(s.player.pos, LEGAL_BENCHES));
  if (p.took(p.press(), "sleep here", "get up")) return;
  p.note("NOWHERE TO SLEEP");
  p.ctx.advance(60 * 8, { asleep: true });
}

function workShift(p: Player): boolean {
  const s = p.s;
  const job = s.employment;
  if (!job) return false;
  const d = EMPLOYMENT[job];
  const w = shiftWindow(s, job);
  if (w === "closed") return false;

  // Turn up as clean as the town will let you be — the walk to work costs
  // hygiene, and arriving one point short is a strike.
  wash(p, Math.max(65, (d.requires.hygiene ?? 0) + 20));
  p.eat();

  p.goto(d.location);
  if (shiftWindow(s, job) === "early") p.waitUntil(d.shiftStart);

  const before = s.shiftsWorked[job] ?? 0;
  const prompt = p.press();
  const t0 = s.time;
  if (p.can(prompt, "clock in")) p.drive(prompt, "clock in", "clock out");
  else if (p.can(prompt, "go up to your floor")) p.drive(prompt, "go up to your floor", "clock out");
  p.workMinutes += s.time - t0;

  const after = s.shiftsWorked[job] ?? 0;
  if (after === before) {
    p.note(`MISSED ${d.name} (window ${shiftWindow(s, job)}, hyg ${s.meters.hygiene.toFixed(0)}, strikes ${s.strikes})`);
  }
  return after > before;
}

function playDay(p: Player): void {
  const s = p.s;
  const day = dayOf(s.time);
  const cashStart = s.cash + s.bank + s.investments;
  p.walkMinutes = 0;
  p.workMinutes = 0;
  p.low = { hunger: 100, thirst: 100, hygiene: 100, energy: 100, morale: 100, health: 100 };
  const notesBefore = p.notes.length;

  p.waitUntil(7);

  // Food bank first: free calories, and it is the whole safety net on day one.
  p.goto("communityCenter");
  p.drive(p.press(), "food bank");
  if (s.sick || s.meters.health < 45) p.drive(p.press(), "nurse") ?? p.drive(p.press(), "checked over");
  p.eat();
  drink(p);

  const worked = workShift(p);

  wash(p);
  shop(p);
  groceries(p);
  if (!worked) jobHunt(p);
  housing(p);
  endgame(p);
  p.eat();
  drink(p);

  if (!worked) {
    p.goto("mart");
    p.drive(p.press(), "unloading");
    gigs(p);
    scavenge(p);
    if (hourOf(s.time) < 18) beg(p, 3);
  }

  p.eat();
  drink(p);
  school(p);
  banking(p);
  p.eat();
  wash(p);
  sleep(p);

  p.days.push({
    day,
    cashStart,
    cashEnd: s.cash + s.bank + s.investments,
    walkMinutes: p.walkMinutes,
    workMinutes: p.workMinutes,
    worked,
    low: { ...p.low },
    notes: p.notes.slice(notesBefore),
  });
}

/* ------------------------------------------------------------------ runs */

export function playThrough(seed: number, maxDays: number) {
  const p = new Player(seed);
  const s = p.s;
  const reached: Record<string, number> = {};
  let minMorale = 100;
  let maxMorale = 0;

  for (let d = 0; d < maxDays; d++) {
    playDay(p);
    minMorale = Math.min(minMorale, s.meters.morale);
    maxMorale = Math.max(maxMorale, s.meters.morale);
    reached[`phase${phaseOf(s)}`] ??= dayOf(s.time);
    if (s.employment) reached[`job:${s.employment}`] ??= dayOf(s.time);
    if (s.education >= 2) reached.edu2 ??= dayOf(s.time);
    if (s.businessOwned) reached.business ??= dayOf(s.time);
    if (s.mayor) reached.mayor ??= dayOf(s.time);
    if (s.won) {
      reached.won = dayOf(s.time);
      break;
    }
  }
  return { p, s, reached, minMorale, maxMorale };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function report(seed: number, days: number): void {
  const { p, s, reached, minMorale, maxMorale } = playThrough(seed, days);

  console.log(`\n${"=".repeat(72)}\nSEED ${seed} — ${dayOf(s.time)} days\n${"=".repeat(72)}`);
  console.log(
    `phase ${phaseOf(s)} · ${bestHousing(s)} · ${s.employment ?? "unemployed"} · ` +
      `cash $${fmt(s.cash)} bank $${fmt(s.bank)} inv $${fmt(s.investments)} debt $${fmt(s.debt)} credit ${s.credit}`,
  );
  console.log(
    `edu ${s.education}/6 · rep ${reputationIn(s)} · collapses ${s.collapses} · fines $${fmt(s.fines)} · ` +
      `morale ${minMorale.toFixed(0)}–${maxMorale.toFixed(0)} · won ${s.won}`,
  );
  console.log(`shifts: ${JSON.stringify(s.shiftsWorked)}`);
  console.log(`milestones: ${JSON.stringify(reached)}`);

  const workedDays = p.days.filter((d) => d.worked).length;
  const avgWalk = p.days.reduce((a, d) => a + d.walkMinutes, 0) / Math.max(1, p.days.length);
  const avgWork = p.days.reduce((a, d) => a + d.workMinutes, 0) / Math.max(1, p.days.length);
  console.log(`worked ${workedDays}/${p.days.length} days · avg ${avgWalk.toFixed(0)} min walking, ${avgWork.toFixed(0)} min on shift`);

  const top = [...p.blocked.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (top.length) {
    console.log(`\nmost common blocks:`);
    for (const [why, n] of top) console.log(`  ${String(n).padStart(4)}x  ${why}`);
  }

  console.log(`\nfirst ${TRACE_DAYS} days:`);
  console.log(`  day   money  walk work  | low: hun thi hyg ene mor hea`);
  for (const d of p.days.slice(0, TRACE_DAYS)) {
    const l = d.low;
    console.log(
      `  ${String(d.day).padStart(3)} ${String("$" + fmt(d.cashEnd)).padStart(7)}` +
        ` ${String(Math.round(d.walkMinutes)).padStart(5)}${String(Math.round(d.workMinutes)).padStart(5)}  |` +
        ` ${[l.hunger, l.thirst, l.hygiene, l.energy, l.morale, l.health].map((v) => String(Math.round(v!)).padStart(4)).join("")}` +
        (d.notes.length ? `   ${d.notes.map((n) => n.replace(/^d\d+ [\d:]+ [AP]M\s+/, "")).join(" | ")}` : ""),
    );
  }

  const kinds = new Map<string, number>();
  for (const n of p.notes) {
    const kind = n.replace(/^d\d+ [\d:]+ [AP]M\s+/, "").split(" ")[0]!;
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  console.log(`\nnote counts: ${JSON.stringify(Object.fromEntries(kinds))}`);

  console.log(`\nmilestone log:`);
  for (const n of p.notes.filter((n) => /BOUGHT|HIRED|SIGNED|RENTED|ELECTED|CLASS |UNREACHABLE/.test(n))) {
    console.log(`  ${n}`);
  }
}

const TRACE_DAYS = 25;
const seeds = process.argv.slice(2).map(Number).filter((n: number) => !Number.isNaN(n));
for (const seed of seeds.length ? seeds : [2026, 7, 11, 99]) report(seed, 400);
