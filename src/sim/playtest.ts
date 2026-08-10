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

import { hasMarker, isSolid, markerPos, townById, STARTING_TOWN, type Town, type TownId, type Vec2 } from "../world/map";
import { approaches, sleepableBenches, type Approach } from "../world/landmarks";
import { interact } from "./actions";
import { boardingReasons, rideCoach, serviceFrom } from "./coach";
import { EVENT_CHANCE, EVENT_STEP_INTERVAL, rollEvent } from "./events";
import { countOf, type ItemId } from "./items";
import { EMPLOYMENT, EMPLOYMENT_ORDER, employmentIn, MAX_CREDITS, type EmploymentId } from "./jobs";
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
import type { HousingId } from "./social";
import { dayOf, formatClock, hourOf, minuteOfDay, withinHours } from "./time";
import { consume, shiftWindow, type ActionCtx } from "./work";

/* --------------------------------------------------------------- walking */

const STEP_MS = 180;
const BIKE_STEP_MS = 95;
const MS_PER_MINUTE = 260;

/**
 * The town a day starts and ends in. The bot can ride the coach — see
 * `commuteTo` — but it does so because a routine asked, never by accident:
 * `goto` refuses to leave town and records a block instead. That way a routine
 * that names a place in the wrong town shows up in the blocks table rather
 * than quietly spending forty minutes and $6 on a trip to a dumpster.
 */
const TOWN: Town = townById(STARTING_TOWN);

/** BFS from a tile to every reachable tile. Cached — the grids never change. */
const pathCache = new Map<string, number[][]>();

function distanceField(town: Town, from: Vec2): number[][] {
  const k = `${town.id}:${from.x},${from.y}`;
  const hit = pathCache.get(k);
  if (hit) return hit;

  const dist: number[][] = Array.from({ length: town.height }, () => new Array<number>(town.width).fill(-1));
  const queue: Vec2[] = [from];
  dist[from.y]![from.x] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const d = dist[cur.y]![cur.x]!;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= town.width || ny >= town.height) continue;
      if (dist[ny]![nx] !== -1) continue;
      if (isSolid(town, nx, ny)) continue;
      dist[ny]![nx] = d + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  pathCache.set(k, dist);
  return dist;
}

/** Tiles between two walkable cells of one town, or -1 if there is no route. */
export function tileDistance(town: Town, a: Vec2, b: Vec2): number {
  if (isSolid(town, a.x, a.y) || isSolid(town, b.x, b.y)) return -1;
  return distanceField(town, a)[b.y]![b.x]!;
}

/* ------------------------------------------------------------------ bot */

interface DayLog {
  day: number;
  cashStart: number;
  cashEnd: number;
  walkMinutes: number;
  workMinutes: number;
  /** Minutes lost to the coach — the wait on the stand as well as the ride. */
  coachMinutes: number;
  coachFares: number;
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
  coachMinutes = 0;
  coachFares = 0;
  blocked = new Map<string, number>();
  /** What turned up on shift, by the venue it turned up at. */
  workEvents = new Map<string, number>();
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
   *
   * Brokemon's hill only; no other town has a barrier like it.
   */
  walkTo(dest: Vec2): void {
    const upThere = (v: Vec2) => v.y <= 13;
    if (townOf(this.s).id === "brokemon" && upThere(dest) !== upThere(this.s.player.pos)) {
      const goingUp = upThere(dest);
      this.walkStraight({ x: 23, y: goingUp ? 15 : 13 });
      this.s.player.facing = goingUp ? "up" : "down";
      const before = this.s.player.pos.y;
      this.press();
      if (this.s.player.pos.y === before) {
        this.blockedBy("heights gate", "turned away");
        return;
      }
    }
    this.walkStraight(dest);
  }

  private walkStraight(dest: Vec2): void {
    const tiles = tileDistance(townOf(this.s), this.s.player.pos, dest);
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
        if (this.rng.chance(EVENT_CHANCE)) this.resolve(rollEvent(this.ctx));
      }
    }
    this.s.player.pos = { ...dest };
  }

  /**
   * Walk to a named place in the town you are standing in.
   *
   * Deliberately refuses to cross towns. Making this commute automatically
   * reads well until the bot rides forty minutes and $6 each way to cash in
   * four dollars of cans, because `recycling` happens to be a Brokemon marker.
   * A routine that wants the other town says so.
   */
  goto(marker: string): boolean {
    const town = townOf(this.s);
    if (!hasMarker(town, marker)) {
      this.blockedBy(marker, `there is no ${marker} in ${town.name}`);
      return false;
    }
    this.walkTo(markerPos(town, marker));
    return true;
  }

  /**
   * Ride the coach, paying for it the way a player does: walk to the stand,
   * find the fare, and stand there until the coach comes. The wait is the
   * expensive part and the part a teleporting bot cannot see.
   *
   * One hop, because there are two towns and one direct service each way. A
   * third town would need routing, and would announce itself here.
   */
  commuteTo(town: TownId): boolean {
    if (this.s.player.town === town) return true;

    const service = serviceFrom(this.s.player.town);
    if (!service || service.to !== town) {
      this.blockedBy(`coach to ${town}`, "nothing runs there from here");
      return false;
    }
    if (!this.goto(service.stop)) return false;

    const why = boardingReasons(this.s, service);
    if (why.length > 0) {
      this.blockedBy(`coach to ${town}`, why[0]!);
      return false;
    }

    const t0 = this.s.time;
    const cash0 = this.s.cash;
    rideCoach(this.ctx, service);
    this.coachMinutes += this.s.time - t0;
    this.coachFares += cash0 - this.s.cash;
    return this.s.player.town === town;
  }

  /**
   * Answer whatever the shift threw up on the way out. Same first-live-choice
   * policy the street encounters get — the bot is not trying to play well, it
   * is trying to pay for everything a player would pay for.
   */
  atWork(p: Prompt | null): void {
    if (!p) return;
    // Counted rather than read back out of the log: `pushLog` keeps the last
    // two hundred lines, so anything that happened before the final fortnight
    // of a two-hundred-day run is not there to count.
    this.workEvents.set(p.title, (this.workEvents.get(p.title) ?? 0) + 1);

    // One piece of judgement the blind first-live-choice policy does not have:
    // two hours of overtime finishes at seven, and night class starts at seven
    // and is the only door to phase 3. A player with credits still to earn
    // turns the overtime down. A bot that never does spends a run's worth of
    // evenings earning $60 instead of the thing the run is gated on.
    // ...and it turns overtime down when it has nothing left to give it. Two
    // hours on an empty tank is how you arrive under the door requirement
    // tomorrow, get sent home, and start the strike spiral of open finding 4.
    const tooTired = this.s.meters.energy < 45;
    if ((this.s.education < MAX_CREDITS || tooTired) && this.choiceFor(p, "go home")) {
      this.resolve(this.drive(p, "go home"));
      return;
    }
    this.resolve(p);
  }

  blockedBy(what: string, why: string): void {
    const key = `${what}: ${why}`;
    this.blocked.set(key, (this.blocked.get(key) ?? 0) + 1);
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
  resolve(p: Prompt | null): void {
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

  choiceFor(p: Prompt | null, step: string): Choice | undefined {
    const c = p?.choices?.find((q) => !q.locked && q.label.toLowerCase().includes(step.toLowerCase()));
    if (!c) {
      const why = this.lockReason(p, step);
      if (why) this.blockedBy(step, why);
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
      TOPUPS.meals++;
    }
    while (this.s.meters.thirst < 62 && countOf(this.s.inventory, "waterBottle") > 0) {
      consume(this.ctx, "waterBottle");
      TOPUPS.drinks++;
    }
  }

  note(t: string): void {
    this.notes.push(`d${dayOf(this.s.time)} ${formatClock(this.s.time)}  ${t}`);
  }
}

/* --------------------------------------------------------- day routines */

/** The unnamed things a day runs on. Found by what they are, per town. */
interface Scenery {
  water: Approach[];
  dumpsters: Approach[];
  /** Benches in a zone with no camping ordinance. Brokedale has none by design. */
  benches: Approach[];
}

const SCENERY = new Map<TownId, Scenery>();

function scenery(town: Town): Scenery {
  let found = SCENERY.get(town.id);
  if (!found) {
    found = {
      water: approaches(town, "water"),
      dumpsters: approaches(town, "dumpster"),
      benches: sleepableBenches(town),
    };
    SCENERY.set(town.id, found);
  }
  return found;
}

// Only the starting town has to support a phase-1 day — that is where one
// happens. Brokedale deliberately has nowhere free to lie down.
{
  const home = scenery(TOWN);
  for (const [what, found] of [["water", home.water], ["dumpsters", home.dumpsters], ["a sleepable bench", home.benches]] as const) {
    if (found.length === 0) throw new Error(`${TOWN.name} has no ${what} — the playtest cannot model a phase-1 day without it`);
  }
}

/**
 * Where a town lets you wash and sleep. Written down per town because the
 * answers are genuinely different: Brokemon's shelter is free and Brokedale
 * has nothing free but a plastic chair in the coach station.
 */
interface Amenities {
  /** A bought bed, and the cash the bot wants in hand before walking there. */
  bed: { marker: string; take: string[]; need: number } | null;
  /** The cheapest bed of last resort, if the town has one, and when it is open. */
  refuge: { marker: string; take: string[]; fromHour: number; toHour: number } | null;
  wash: { marker: string; take: string[] } | null;
  /** Where clothes get cleaned, which is a different question and a paid one. */
  laundry: { marker: string; take: string[]; need: number; fromHour: number; toHour: number } | null;
}

const AMENITIES: Record<TownId, Amenities> = {
  brokemon: {
    bed: { marker: "hostel", take: ["pay for a cot", "get up"], need: 12 },
    refuge: { marker: "communityCenter", take: ["take a bed", "get up"], fromHour: 18, toHour: 8 },
    wash: { marker: "communityCenter", take: ["wash up"] },
    laundry: { marker: "laundromat", take: ["wash everything"], need: 8, fromHour: 7, toHour: 21 },
  },
  brokedale: {
    bed: { marker: "dossHouse", take: ["pay for a room", "get up"], need: 18 },
    // The concourse never shuts, which is the only thing in the city that
    // doesn't want money off you.
    refuge: { marker: "coachTerminal", take: ["concourse", "get up"], fromHour: 0, toHour: 24 },
    // $5 for +46 hygiene beats the doss house shower on both counts, and it
    // never closes.
    // The Eastgate token does both at once, which is most of why it is worth
    // five dollars in a city with nothing free in it.
    wash: { marker: "washhouse", take: ["buy a token"] },
    laundry: { marker: "washhouse", take: ["buy a token"], need: 6, fromHour: 0, toHour: 24 },
  },
};

/**
 * The door you sleep behind, for an address that has one. Housing ids and
 * marker ids happen to match in Brokemon and do not in Brokedale, which is
 * exactly the sort of thing that quietly stops working.
 */
const HOME_MARKER: Partial<Record<HousingId, string>> = {
  trailer: "trailer",
  apartment: "apartment",
  estate: "estate",
  room: "weeklyRooms",
};

export const TOPUPS = { meals: 0, drinks: 0, washes: 0, laundry: 0 };

function drink(p: Player): void {
  const water = scenery(townOf(p.s)).water;
  if (water.length === 0) return;
  for (let i = 0; i < 3 && p.s.meters.thirst < 85; i++) {
    p.approach(nearest(p, water));
    if (!p.took(p.press(), "drink")) break;
    TOPUPS.drinks++;
  }
}

/** Whichever of these is fewest tiles away on foot, from where the bot stands. */
function nearest(p: Player, options: Approach[]): Approach {
  const town = townOf(p.s);
  let best = options[0]!;
  let bestDist = Infinity;
  for (const option of options) {
    const d = tileDistance(town, p.s.player.pos, option.pos);
    if (d >= 0 && d < bestDist) {
      bestDist = d;
      best = option;
    }
  }
  return best;
}

/**
 * Get clean — both halves of it.
 *
 * Hygiene is the average of how clean you are and how clean your clothes are,
 * so scrubbing yourself raw in the community center bathroom tops out at 50
 * while you are still wearing the week. The bot did exactly that and then
 * spent ninety-seven applications being told it needed to be a lot cleaner
 * (49/70), which read as an impossible job requirement and was actually an
 * instrument that had never heard of a launderette.
 */
/**
 * The threshold is a trigger, not a dose — a shower restores 70-odd points
 * whenever you take one, so `target` only decides how far you let yourself
 * drift first.
 *
 * At 65 the bot spent its whole run in the band just above the door
 * requirements of the job it held, and every lump of dirt — a shift, a downpour
 * — put it under one and cost it a strike. Three strikes drop you the length of
 * the ladder. It was being re-hired every four days for a hundred and fifty
 * days: 407 hires a run against 337 at a target of 80, and seventeen days of
 * run length, for a tenth of a wash a day more. A competent player who knows
 * their job has a hygiene door does not live on the edge of it.
 */
function wash(p: Player, target = 80): void {
  const s = p.s;
  if (s.meters.hygiene >= target) return;
  const bodyBefore = s.bodyClean;
  try {
    washBody(p, target);
  } finally {
    if (s.bodyClean > bodyBefore) TOPUPS.washes++;
  }
}

function washBody(p: Player, target: number): void {
  const s = p.s;

  // Clothes first when they are the half that is dragging: they are the
  // expensive half to fix and the one with opening hours.
  if (s.clothesClean < s.bodyClean && s.clothesClean < target) washClothes(p);
  if (s.meters.hygiene >= target) return;

  const home = HOME_MARKER[housingIn(s)];
  if (home && (housingIn(s) === "apartment" || housingIn(s) === "estate")) {
    p.goto(home);
    if (p.took(p.press(), "shower and change")) return;
  }
  if (housingIn(s) === "trailer") {
    p.goto("trailer");
    if (p.took(p.press(), "wash")) return;
  }
  const here = AMENITIES[s.player.town].wash;
  if (!here) return;
  p.goto(here.marker);
  p.drive(p.press(), ...here.take);

  // And if the body is clean but the clothes still are not, that is what is
  // holding the number down.
  if (s.meters.hygiene < target && s.clothesClean < target) washClothes(p);
}

/** The launderette, which is the only thing in either town that cleans clothes. */
function washClothes(p: Player): void {
  const s = p.s;
  const at = AMENITIES[s.player.town].laundry;
  if (!at || s.cash < at.need) return;
  if (!withinHours(s.time, at.fromHour, at.toHour)) return;
  p.goto(at.marker);
  const before = s.clothesClean;
  p.drive(p.press(), ...at.take);
  if (s.clothesClean > before) TOPUPS.laundry++;
}

/**
 * Open a bin and answer it.
 *
 * Food in a bin is a decision now rather than a payout, so a rig that only
 * knows how to press "close the lid" walks away from every meal it finds and
 * reports a hungrier game than the one being played. Take it while you are on
 * the street and hungry; leave it once you have a bed, which is when the
 * dignity costs more than the calories are worth.
 */
function openBin(p: Player): void {
  answerBin(p, p.press());
}

function answerBin(p: Player, prompt: Prompt | null): void {
  if (p.can(prompt, "take it")) {
    const takeIt = p.s.meters.hunger < 55 && bestHousing(p.s) === "street";
    p.drive(prompt, takeIt ? "take it" : "leave it");
    return;
  }
  p.drive(prompt, "close the lid");
}

/**
 * The bin round, in the order a player who knew the town would walk it.
 *
 * Street dumpsters are the poorest bins in either town, and a rig that only
 * knows about those measures a game where fourteen doors' worth of bins do not
 * exist. Which door you open is now most of what phase 1 is: the plaza has the
 * best cans and nothing you could eat, the night market is the reverse, and
 * each one refills on its own clock so the round is a round rather than one
 * dumpster forty times.
 *
 * Kept to doors on the way to somewhere — a bin is not worth a special trip
 * across town, and a rig that made one would report an income no player earns.
 */
const BIN_ROUND: Record<TownId, string[]> = {
  // Only doors this bot already stands at on a phase-1 day: the food bank and
  // the wash are at the community center, the unloading is behind the Mart.
  // A five-door tour of the good bins was measured and it is a bad idea — it
  // cost four days a run, because a bin holds a dollar or two and crossing
  // town for it costs more of the clock than that is worth. Bins pay when you
  // are already there, which is the whole design of the table.
  brokemon: ["mart", "communityCenter"],
  brokedale: ["coachTerminal", "washhouse"],
};

function scavenge(p: Player): void {
  const town = townOf(p.s);
  for (const d of scenery(town).dumpsters) {
    p.approach(d);
    openBin(p);
  }
  for (const marker of BIN_ROUND[town.id]) {
    if (!hasMarker(town, marker)) continue;
    p.goto(marker);
    answerBin(p, p.drive(p.press(), "bins out back"));
  }
  // Only worth emptying the bag where there is a depot to empty it into. The
  // cans keep until you are back in a town that has one.
  if (countOf(p.s.inventory, "recyclables") > 0 && hasMarker(townOf(p.s), "recycling")) {
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
  // faster than anything else on the shelf — but riding it bareheaded is a
  // 1.2%-per-hour concussion, and each one is up to $140 with the balance
  // going on the debt. Seventeen of them across one run held the credit score
  // at 430 and locked the estate permanently. Buy the helmet with the bike.
  if (countOf(s.inventory, "bicycle") === 0 && s.cash >= 110 && look >= 28) {
    p.goto("mart");
    if (p.took(p.press(), "buy something", "Bicycle")) p.note("BOUGHT a bicycle");
  }
  if (countOf(s.inventory, "bicycle") > 0 && countOf(s.inventory, "cyclingHelmet") === 0 && s.cash >= 40) {
    p.goto("bikeShop");
    if (p.took(p.press(), "cycling helmet")) p.note("BOUGHT a helmet");
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
  // The bank shuts at six, and that last hour is the only one a 9-to-5 has.
  if (hourOf(s.time) < 9 || hourOf(s.time) >= 18) return;
  if (s.cash < 300) return;
  p.goto("bank");
  const b = p.press();
  if (s.debt > 0 && p.can(b, "pay down")) p.drive(b, "pay down the debt");
  else if (p.can(b, "deposit")) p.drive(b, "deposit cash");
}

function sleep(p: Player): void {
  const s = p.s;
  const home = HOME_MARKER[housingIn(s)];
  if (home) {
    p.goto(home);
    if (p.took(p.press(), "sleep", "get up")) return;
  }

  const here = AMENITIES[s.player.town];
  if (here.bed && s.cash >= here.bed.need) {
    p.goto(here.bed.marker);
    if (p.took(p.press(), ...here.bed.take)) return;
  }
  // Brokemon's shelter is free but only opens at 6PM; Brokedale's concourse
  // never shuts and is barely a bed.
  if (here.refuge && withinHours(s.time, here.refuge.fromHour, here.refuge.toHour)) {
    p.goto(here.refuge.marker);
    if (p.took(p.press(), ...here.refuge.take)) return;
  }
  // Last resort: a bench somewhere camping is not an offence. There is no such
  // bench in Brokedale, which is the point of the place.
  const benches = scenery(townOf(s)).benches;
  if (benches.length > 0) {
    p.approach(nearest(p, benches));
    if (p.took(p.press(), "sleep here", "get up")) return;
  }
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
  if (p.can(prompt, "clock in")) p.atWork(p.drive(prompt, "clock in", "clock out"));
  else if (p.can(prompt, "go up to your floor")) p.atWork(p.drive(prompt, "go up to your floor", "clock out"));
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
  p.coachMinutes = 0;
  p.coachFares = 0;
  p.low = { hunger: 100, thirst: 100, hygiene: 100, energy: 100, morale: 100, health: 100 };
  const notesBefore = p.notes.length;

  p.waitUntil(7);

  // Everything below this line is a Brokemon day, because Brokedale has no
  // work, no food bank and no free wash yet. A bot that woke up over there
  // gets itself home first, and pays the fare and the wait to do it. When
  // Phase 2 gives it a reason to stay, the decision goes here.
  if (s.player.town !== STARTING_TOWN && !p.commuteTo(STARTING_TOWN)) {
    p.note(`STRANDED in ${townOf(s).name}`);
    strandedDay(p);
    p.days.push(dayLog(p, day, cashStart, false, notesBefore));
    return;
  }

  // Food bank first: free calories, and it is the whole safety net on day one.
  p.goto("communityCenter");
  p.drive(p.press(), "food bank");
  if (s.sick || s.meters.health < 45) p.drive(p.press(), "nurse") ?? p.drive(p.press(), "checked over");
  p.eat();
  drink(p);

  const worked = workShift(p);

  // Straight from the shift to the bank, while the last hour of opening is
  // still there. Doing it at the end of the errand list meant a 9-to-5 always
  // arrived after closing, and two seeds finished with eighty thousand in
  // cash, a few hundred of debt they could never hand over, and the estate
  // refusing them on a credit score the debt was pinning down.
  banking(p);

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
  // Banking *before* school. `school` waits until 7PM to sit the class, and the
  // bank shuts at 5 — so on every day the bot still wanted a credit, banking
  // was attempted after closing and silently did nothing. A run that stalled
  // at five of six credits therefore never paid a penny off its starting $240,
  // which compounded to $1,678, pinned the credit score at 430 and locked the
  // estate for good. The order of two calls was worth a hundred and fifty days.
  school(p);
  p.eat();
  wash(p);
  sleep(p);

  p.days.push(dayLog(p, day, cashStart, worked, notesBefore));
}

function dayLog(p: Player, day: number, cashStart: number, worked: boolean, notesBefore: number): DayLog {
  const s = p.s;
  return {
    day,
    cashStart,
    cashEnd: s.cash + s.bank + s.investments,
    walkMinutes: p.walkMinutes,
    workMinutes: p.workMinutes,
    coachMinutes: p.coachMinutes,
    coachFares: p.coachFares,
    worked,
    low: { ...p.low },
    notes: p.notes.slice(notesBefore),
  };
}

/**
 * A day in a town you cannot afford to leave. Scrape the fare together and
 * survive the night — this is the shape a stranded player's day has, and the
 * rig has to be able to live it or "you can get stuck over there" is a claim
 * nobody has checked.
 */
function strandedDay(p: Player): void {
  const s = p.s;
  drink(p);
  p.eat();
  scavenge(p);
  buyFood(p);
  if (hourOf(s.time) < 20) beg(p, 4);
  p.eat();
  buyFood(p);
  drink(p);
  sleep(p);
}

/**
 * Buy something to eat where the town sells it. Brokemon has a food bank and
 * the Mart; Brokedale has a stall and a price. Without this the bot starved on
 * a full wallet, which said more about the bot than the city.
 */
/**
 * Eat at the stall, and buy tomorrow's while you are standing there.
 *
 * The hot tray is eaten where you buy it, so a bot that only ever visited the
 * market when it was already hungry went out on an eight-hour depot shift with
 * an empty bag and bottomed out at hunger 0 in the middle of it, most days of a
 * 248-day run. Queuing on the way *to* work is not the answer — that was tried,
 * and forty-five minutes in a queue made the bot chronically late, written up
 * every day and demoted every fifth. The answer is what a person actually does:
 * carry the next day's out of tonight's trip.
 */
const PACKETS_TO_CARRY = 2;

/**
 * A fever in Brokedale used to end in a collapse, because nothing in the city
 * treated one. The market sells tablets now and the bot buys them, which is
 * what a player would do the second time it happened to them.
 */
function treatFever(p: Player): void {
  const s = p.s;
  if (!s.sick) return;
  if (countOf(s.inventory, "medicine") === 0) {
    if (!hasMarker(townOf(s), "nightMarket") || s.cash < 18) return;
    p.goto("nightMarket");
    if (!p.took(p.press(), "Cold and flu tablets")) return;
  }
  consume(p.ctx, "medicine");
}

function buyFood(p: Player): void {
  const s = p.s;
  if (!hasMarker(townOf(s), "nightMarket")) return;
  const carrying = countOf(s.inventory, "instantNoodles");
  if (s.meters.hunger >= 55 && carrying >= PACKETS_TO_CARRY) return;
  // Leave the fare alone once it is nearly in reach — going hungry one more
  // night to get out is the trade a stranded player actually makes.
  const service = serviceFrom(s.player.town);
  const keep = service && s.cash >= service.fare - 6 ? service.fare : 0;
  p.goto("nightMarket");
  // One tray does not cover an eight-hour shift.
  for (let i = 0; i < 3 && s.meters.hunger < 55 && s.cash - keep >= 6; i++) {
    if (!p.took(p.press(), "noodles")) break;
  }
  for (let i = carrying; i < PACKETS_TO_CARRY && s.cash - keep >= 4; i++) {
    if (!p.took(p.press(), "packet for later")) break;
  }
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

function report(seed: number, days: number): number {
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

  const incidents = [...p.workEvents.values()].reduce((a, b) => a + b, 0);
  const shifts = Object.values(s.shiftsWorked).reduce((a, b) => a + b, 0);
  if (shifts > 0) {
    console.log(
      `on shift: ${incidents} incidents over ${shifts} shifts (${((incidents / shifts) * 100).toFixed(0)}% of days had one)`,
    );
  }

  const coachDays = p.days.filter((d) => d.coachMinutes > 0);
  if (coachDays.length > 0) {
    const mins = coachDays.reduce((a, d) => a + d.coachMinutes, 0);
    const fares = coachDays.reduce((a, d) => a + d.coachFares, 0);
    console.log(
      `coach: ${coachDays.length} days travelling · ${fmt(mins)} min and $${fmt(fares)} total ` +
        `(${(mins / coachDays.length).toFixed(0)} min, $${(fares / coachDays.length).toFixed(0)} a travelling day)`,
    );
  }

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

  return dayOf(s.time);
}

/* ------------------------------------------------------ living over there */

/**
 * A day lived in Brokedale rather than survived in it: the agency muster in
 * the morning, the washhouse, the night market, and a room if the deposit is
 * in reach.
 *
 * There is no career here yet — site work is the whole economy until the jobs
 * ladder lands. What this measures is whether the floor holds: can you eat,
 * stay clean enough, and hold a room on $88 a day, in a city with no food bank
 * and no free wash?
 */
function brokedaleDay(p: Player): void {
  const s = p.s;
  const day = dayOf(s.time);
  const cashStart = s.cash + s.bank;
  p.walkMinutes = 0;
  p.workMinutes = 0;
  p.coachMinutes = 0;
  p.coachFares = 0;
  p.low = { hunger: 100, thirst: 100, hygiene: 100, energy: 100, morale: 100, health: 100 };
  const notesBefore = p.notes.length;

  // A class trip leaves you in Brokemon overnight — the last coach back goes
  // before the class lets out. Get home first.
  if (s.player.town !== "brokedale") {
    p.waitUntil(6);
    // Brokemon has a food bank and free water; use them before a forty-minute
    // ride. Coming back from a class trip on an empty stomach was collapsing
    // the bot on arrival and costing it the job it went for the credits for.
    p.goto("communityCenter");
    p.drive(p.press(), "food bank");
    p.eat();
    drink(p);
    if (!p.commuteTo("brokedale")) {
      p.note("STRANDED in Brokemon");
      p.days.push(dayLog(p, day, cashStart, false, notesBefore));
      return;
    }
  }

  // The depot wants night-class credits and there is no night class in
  // Brokedale. That is on purpose: the two towns are supposed to need each
  // other, and this is the seam where it shows.
  if (wantsCredits(p) && s.cash > 200 && hourOf(s.time) < 15) {
    p.note(`CLASS TRIP (edu ${s.education})`);
    classTrip(p);
    p.days.push(dayLog(p, day, cashStart, false, notesBefore));
    return;
  }

  const job = s.employment && EMPLOYMENT[s.employment].town === "brokedale" ? s.employment : null;
  p.waitUntil(job ? Math.max(6, EMPLOYMENT[job].shiftStart - 1) : 7);
  drink(p);
  p.eat();

  // A depot shift if you hold one; the agency muster if you do not. The muster
  // is 6AM–11AM, so a day that starts late has already lost.
  const t0 = s.time;
  let worked: boolean;
  if (job) {
    const d = EMPLOYMENT[job];
    // Wash, and eat only what is already in your bag. Queuing at the night
    // market first cost forty-five minutes and made the bot chronically late:
    // it worked every day, was written up every day, and was fired and
    // demoted back to picker every fifth day for three hundred days.
    wash(p, Math.max(50, (d.requires.hygiene ?? 0) + 20));
    p.eat();
    p.goto("depot");
    if (shiftWindow(s, job) === "early") p.waitUntil(d.shiftStart);
    const before = s.shiftsWorked[job] ?? 0;
    p.atWork(p.drive(p.press(), "clock in", "clock out"));
    worked = (s.shiftsWorked[job] ?? 0) > before;
    if (!worked) p.note(`MISSED ${d.name} (${shiftWindow(s, job)}, hyg ${s.meters.hygiene.toFixed(0)})`);
  } else {
    p.goto("agency");
    worked = p.took(p.press(), "put your name down", "leave");
    if (!worked) p.note(`NO WORK (${formatClock(s.time)})`);
  }
  p.workMinutes += s.time - t0;

  // Wash *first*. Applying straight off a site with hygiene 0 was twenty-one
  // "you need to be a lot cleaner (0/25)" in a row — nobody would do that,
  // and it made a hireable bot look unhireable.
  wash(p);
  brokedaleJobHunt(p);

  // A phone unlocks Dispatch Coordinator — the step up from Warehouse Picker.
  // The night market is the only place in Brokedale that sells one.
  if (countOf(s.inventory, "phone") === 0 && s.cash >= 75) {
    p.goto("nightMarket");
    if (p.took(p.press(), "Second-hand phone")) p.note("BOUGHT a phone");
  }

  buyFood(p);

  // Two weeks up front, the moment it is in reach. This is the decision the
  // whole city is built around.
  if (housingIn(s) !== "room") {
    p.goto("weeklyRooms");
    if (p.took(p.press(), "take it")) p.note("TOOK a room on St Giles Row");
  }

  // Only on a day with no shift. Begging costs morale, site work has a morale
  // floor, and a bot that begged on working days too talked itself out of the
  // only job in the city inside a week — 14 collapses and reputation on the
  // floor. Filling an empty afternoon is not the same as filling every one.
  if (!worked) {
    scavenge(p);
    beg(p, 3);
  }

  // The pitch pays every night from the night it is bought, so it is worth
  // buying the moment it is affordable — which is what the block is waiting on.
  if (!s.stallOwned && housingIn(s) === "room" && s.cash + s.bank >= 1600) {
    p.goto("nightMarket");
    if (p.took(p.press(), "take on a pitch")) p.note("TOOK ON a pitch");
  }

  // The block, the moment Aldiss will hear it. Everything above this line is
  // how you get to be somebody he will sell to.
  if (!s.blockOwned && housingIn(s) === "room" && s.cash + s.bank >= 28_000) {
    p.goto("weeklyRooms");
    if (p.took(p.press(), "Aldiss")) p.note("BOUGHT THE BLOCK");
  }
  bankBrokedale(p);

  buyFood(p);
  treatFever(p);
  drink(p);
  p.eat();
  p.waitUntil(20);
  sleep(p);

  p.days.push(dayLog(p, day, cashStart, worked, notesBefore));
}

/**
 * Brokedale has no bank. Money you are saving for the building has to be
 * carried, or banked on a class trip — another seam where the two towns need
 * each other, and one the rig has to model or the block is unreachable.
 */
function bankBrokedale(p: Player): void {
  const s = p.s;
  if (s.player.town !== "brokemon") return;
  if (s.cash < 400 || !withinHours(s.time, 9, 17)) return;
  p.goto("bank");
  const b = p.press();
  if (s.debt > 0 && p.can(b, "pay down")) p.drive(b, "pay down the debt");
  else if (p.can(b, "deposit")) p.drive(b, "deposit amount");
}

/** How many credits the next rung of the depot ladder is waiting on. */
function wantsCredits(p: Player): boolean {
  const s = p.s;
  const needed = employmentIn("brokedale")
    .filter((id) => EMPLOYMENT[id].pay > (s.employment ? EMPLOYMENT[s.employment].pay : 0))
    .map((id) => EMPLOYMENT[id].requires.education ?? 0);
  return needed.some((n) => n > s.education) && s.education < 6;
}

/**
 * Go and sit a night class in Brokemon, and lose a day and a night to it.
 *
 * The last coach back leaves before the class lets out, so this is always an
 * overnight: two fares, a bed on the far side, and a morning gone. Whether
 * that price is worth two credits is the question Phase 2b exists to ask.
 */
function classTrip(p: Player): void {
  const s = p.s;
  buyFood(p);
  drink(p);
  if (!p.commuteTo("brokemon")) return;
  wash(p);
  p.eat();
  drink(p);
  school(p);
  // Keep the fare home. Spending it on a phone stranded the bot in Brokemon
  // for a week on one seed, which is survivable there and still a week.
  if (countOf(s.inventory, "phone") === 0 && s.cash >= 60 + 40 && hourOf(s.time) < 23) {
    p.goto("mart");
    if (p.took(p.press(), "buy something", "Prepaid Phone")) p.note("BOUGHT a phone");
  }
  p.eat();
  sleep(p);
}

/**
 * Climb the depot ladder. Same shape as the Brokemon job hunt, except the
 * listings are at the Employment Exchange and nothing on them asks what you
 * are wearing.
 */
function brokedaleJobHunt(p: Player): void {
  const s = p.s;
  if (!withinHours(s.time, 9, 17)) return;
  const currentPay = s.employment ? EMPLOYMENT[s.employment].pay : 0;
  const wanted = employmentIn("brokedale")
    .filter((id) => EMPLOYMENT[id].pay > currentPay)
    .sort((a, b) => EMPLOYMENT[b].pay - EMPLOYMENT[a].pay);
  if (wanted.length === 0) return;

  p.goto("jobCentre");
  const list = p.drive(p.press(), "take a ticket");
  for (const id of wanted) {
    if (p.can(list, EMPLOYMENT[id].name)) {
      const before = s.employment;
      p.drive(list, EMPLOYMENT[id].name);
      p.note(s.employment !== before ? `HIRED as ${EMPLOYMENT[id].name}` : `interview failed: ${EMPLOYMENT[id].name}`);
      return;
    }
    const why = p.lockReason(list, EMPLOYMENT[id].name);
    if (why) p.blockedBy(`job ${EMPLOYMENT[id].name}`, why);
  }
}

/** Can you actually live in Brokedale? Run with `npm run playtest -- --brokedale`. */
function brokedaleReport(seed: number, days: number): void {
  const p = new Player(seed);
  const s = p.s;

  // Arrive the way a player would: with the fare and a bit of a stake.
  s.cash = 60;
  p.waitUntil(8);
  p.goto("busStop");
  p.commuteTo("brokedale");

  console.log(`\n${"=".repeat(72)}\nLIVING IN BROKEDALE — seed ${seed}\n${"=".repeat(72)}`);
  console.log(`arrived ${formatClock(s.time)} on day ${dayOf(s.time)} with $${s.cash}`);
  console.log(`  day   cash  walk work  | low: hun thi hyg ene mor hea   notes`);

  for (let d = 0; d < days; d++) {
    brokedaleDay(p);
    if (s.blockOwned) {
      console.log(`  day ${dayOf(s.time)}: BOUGHT THE BLOCK`);
      break;
    }
    const l = p.days[p.days.length - 1]!;
    if (p.days.length > 30 && l.notes.length === 0) continue;
    console.log(
      `  ${String(l.day).padStart(3)} ${String("$" + fmt(s.cash + s.bank)).padStart(7)}` +
        ` ${String(Math.round(l.walkMinutes)).padStart(4)}${String(Math.round(l.workMinutes)).padStart(5)}  |` +
        ` ${[l.low.hunger, l.low.thirst, l.low.hygiene, l.low.energy, l.low.morale, l.low.health]
          .map((v) => String(Math.round(v!)).padStart(4))
          .join("")}` +
        (l.notes.length ? `   ${l.notes.map((n) => n.replace(/^d\d+ [\d:]+ [AP]M\s+/, "")).join(" | ")}` : ""),
    );
  }

  const shifts = p.days.filter((d) => d.worked).length;
  console.log(
    `\n  ${shifts}/${p.days.length} days on site · housing ${housingIn(s)} · ` +
      `$${fmt(s.cash + s.bank)} · ${s.collapses} collapse(s) · rep ${reputationIn(s)}`,
  );
  const walk = p.days.reduce((a, d) => a + d.walkMinutes, 0) / Math.max(1, p.days.length);
  console.log(`  ${walk.toFixed(0)} min a day walking — against ${164} in Brokemon, which is the point of moving.`);
  const blocks = [...p.blocked.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (blocks.length) {
    console.log(`\n  most common blocks:`);
    for (const [why, n] of blocks) console.log(`    ${String(n).padStart(4)}x  ${why}`);
  }
}

/* -------------------------------------------------------- the crossing */

/**
 * What a day trip to Brokedale actually costs, walked rather than assumed.
 *
 * There is nothing over there worth going for yet, which is exactly why this
 * is worth measuring now: Phase 2 is about to price a second economy, and the
 * fare and the wait are the floor any Brokedale wage has to clear. Run it with
 * `npm run playtest -- --crossing`.
 */
function crossingReport(seed: number): void {
  const p = new Player(seed);
  const s = p.s;
  s.cash = 200;
  p.waitUntil(8);

  console.log(`\n${"=".repeat(72)}\nTHE CROSSING — seed ${seed}\n${"=".repeat(72)}`);

  const t0 = s.time;
  const cash0 = s.cash;
  p.goto("busStop");
  const atStop = s.time;
  console.log(`  spawn to the Market Square stand: ${Math.round(atStop - t0)} min on foot`);

  p.commuteTo("brokedale");
  console.log(`  and out to Brokedale: ${Math.round(s.time - atStop)} min (wait included), $${cash0 - s.cash}`);

  // A round of the errands the city can actually do for you today.
  const errands = s.time;
  drink(p);
  p.goto("nightMarket");
  p.drive(p.press(), "noodles");
  p.goto("dossHouse");
  p.press();
  console.log(`  a drink, a meal and a look at the rooms: ${Math.round(s.time - errands)} min`);

  const home = s.time;
  const cashThere = s.cash;
  p.commuteTo("brokemon");
  console.log(`  back again: ${Math.round(s.time - home)} min, $${cashThere - s.cash}`);

  console.log(
    `\n  round trip: ${Math.round(s.time - t0)} min of a ${24 * 60}-minute day, ` +
      `$${cash0 - s.cash} gone, and you are standing at the bus stop.`,
  );
  console.log(`  coach alone: ${Math.round(p.coachMinutes)} min and $${p.coachFares}.`);
  const blocks = [...p.blocked.entries()];
  if (blocks.length) {
    console.log(`  blocked on the way:`);
    for (const [why, n] of blocks) console.log(`    ${String(n).padStart(3)}x  ${why}`);
  }

  strandedReport(seed);
}

/**
 * Ride out with the fare and nothing else, and see how long it takes to scrape
 * the way home together. "Getting stranded should be possible, survivable and
 * memorable" is a design claim in the scope; this is the part that checks the
 * middle word.
 */
function strandedReport(seed: number): void {
  const p = new Player(seed + 1);
  const s = p.s;
  s.cash = 40;
  p.waitUntil(8);
  p.goto("busStop");
  p.commuteTo("brokedale");
  // Everything but the shirt on your back.
  s.cash = 0;
  s.inventory = {};

  console.log(`\n  stranded in Brokedale at ${formatClock(s.time)} with nothing:`);

  const arrived = dayOf(s.time);
  let home = false;
  for (let d = 0; d < 8 && !home; d++) {
    playDay(p);
    home = s.player.town === STARTING_TOWN;
    const last = p.days[p.days.length - 1]!;
    console.log(
      `    day ${last.day}: $${Math.round(s.cash)} in hand · ` +
        `low hun ${Math.round(last.low.hunger!)} thi ${Math.round(last.low.thirst!)} hea ${Math.round(last.low.health!)} · ` +
        `${home ? "got home" : "still there"}`,
    );
  }
  console.log(
    home
      ? `  home after ${dayOf(s.time) - arrived} day(s), ${s.collapses} collapse(s).`
      : `  STILL STRANDED after 8 days — that is a soft lock, not a bad night.`,
  );
}

const TRACE_DAYS = 25;
const args = process.argv.slice(2);
const seeds = args.map(Number).filter((n: number) => !Number.isNaN(n));

/**
 * Ten, not four.
 *
 * Run length swings from 114 to 284 days on identical code depending only on
 * the seed — a standard deviation near 40. Four seeds cannot see a change
 * smaller than that, and one nearly did real damage: the encounter roll moving
 * from 0.4 to 0.28 looked like it had doubled a run, and across ten seeds it
 * moves the mean by a single day. Four seconds of compute is a cheap price for
 * not tuning the game against noise.
 */
const DEFAULT_SEEDS = [2026, 7, 11, 99, 3, 42, 77, 500, 1234, 8888];

if (args.includes("--crossing")) {
  for (const seed of seeds.length ? seeds : [2026]) crossingReport(seed);
} else if (args.includes("--brokedale")) {
  for (const seed of seeds.length ? seeds : [2026, 7]) brokedaleReport(seed, 400);
} else {
  const runs = seeds.length ? seeds : DEFAULT_SEEDS;
  const lengths = runs.map((seed) => report(seed, 400));
  if (lengths.length > 1) summarise(lengths);
}

/** The line that says whether a change moved anything, or moved one seed. */
function summarise(lengths: number[]): void {
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const sorted = [...lengths].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const sd = Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length);
  console.log(`\n${"=".repeat(72)}`);
  console.log(
    `ACROSS ${lengths.length} SEEDS — mean ${mean.toFixed(0)} days, median ${median}, ` +
      `range ${sorted[0]}–${sorted[sorted.length - 1]}, sd ${sd.toFixed(0)}`,
  );
  console.log(`Anything smaller than about ${(sd / 2).toFixed(0)} days is inside the noise. Do not tune on it.`);
  // How often the bot actually had to stop and see to itself. The design
  // target is roughly two meals and three drinks a day; anything much above
  // that is a meter the player is nursing rather than managing.
  const days = lengths.reduce((a, b) => a + b, 0);
  console.log(
    `Per day: ${(TOPUPS.meals / days).toFixed(1)} meals, ${(TOPUPS.drinks / days).toFixed(1)} drinks, ` +
      `${(TOPUPS.washes / days).toFixed(1)} washes, ${(TOPUPS.laundry / days).toFixed(1)} laundry.`,
  );
}
