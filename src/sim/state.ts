import { spawnPoint, STARTING_TOWN, townById, TOWNS, type Town, type TownId, type Vec2 } from "../world/map";
import type { EmploymentId, GigId, JobId, Requirements } from "./jobs";
import { EMPLOYMENT, GIGS } from "./jobs";
import { countOf, type Inventory, type ItemId } from "./items";
import { appearance, housingRank, outfitRank, OUTFITS, type HousingId, type OutfitId } from "./social";
import type { Meters } from "./meters";
import type { WeatherId } from "./weather";

export type Facing = "up" | "down" | "left" | "right";

/** One value per town. Anything you can hold in two places at once lives in one of these. */
export type PerTown<T> = Record<TownId, T>;

export function perTown<T>(value: T): PerTown<T> {
  const out = {} as PerTown<T>;
  for (const id of Object.keys(TOWNS) as TownId[]) out[id] = value;
  return out;
}

export interface LogLine {
  time: number;
  text: string;
  tone: "plain" | "good" | "bad" | "money" | "system";
}

/** A gig you've accepted that needs you to physically go somewhere. */
export interface Assignment {
  gig: GigId;
  label: string;
  /** Remaining stops, in map coordinates. */
  targets: Vec2[];
  /** Set once every stop is done and you go back to the board to get paid. */
  ready: boolean;
  pay: number;
  /** Absolute game-minute at which the job expires. 0 = no deadline. */
  deadlineMin: number;
}

export interface Player {
  /** Which town the body is in. Positions mean nothing without it. */
  town: TownId;
  pos: Vec2;
  facing: Facing;
  /** Sub-tile progress 0..1 while stepping between cells. */
  moveProgress: number;
  moveFrom: Vec2 | null;
}

export type Phase = 1 | 2 | 3 | 4;

export interface GameState {
  /** Absolute in-game minutes. Day 1 starts at 07:00. */
  time: number;
  seed: number;
  player: Player;
  meters: Meters;

  cash: number;
  bank: number;
  debt: number;
  /** 300-850. Gates the apartment lease and the business loan. */
  credit: number;
  investments: number;
  /** Dollar change in investments from the most recent daily swing (positive = gain). */
  investmentLastDelta: number;

  inventory: Inventory;
  wearing: OutfitId;
  wardrobe: OutfitId[];

  /**
   * Where you live, per town. You can hold a room in more than one place; the
   * commute is the thing you are buying out of.
   */
  housing: PerTown<HousingId>;
  /** Absolute day on which each town's rent is next taken. */
  rentDueDay: PerTown<number>;
  /** Nights the bed in each town is paid up for. */
  nightsPaid: PerTown<number>;

  employment: EmploymentId | null;
  shiftsWorked: Record<string, number>;
  /** Per-job pay overrides accumulated from 10-shift raises. */
  employmentPayOverride: Record<string, number>;
  /** Shifts missed at the current job. Three and you're let go. */
  strikes: number;
  lastShiftDay: number;
  /**
   * The last day a strike was issued. A clean week (7 days without a new
   * strike) earns one back — being tired occasionally is not a pattern.
   */
  lastStrikeDay: number;

  /**
   * Cups of coffee since you last slept. Each one is worth less than the last,
   * and a night on top of a stack of them is not a proper night.
   */
  caffeine: number;

  education: number;
  /** What your name is worth, per town. You arrive somewhere new unknown. */
  reputation: PerTown<number>;

  assignment: Assignment | null;
  gigsToday: Record<string, number>;

  weather: WeatherId;
  weatherUntil: number;
  sick: boolean;

  fines: number;
  /** Warnings from the current patrol encounter. */
  policeWarnings: number;
  lastPoliceCheck: number;
  /** Game-time minute of the most recent step — used to detect idleness for loitering. */
  lastMovedTime: number;

  businessOwned: boolean;
  mayor: boolean;
  /**
   * A pitch at the night market, let to somebody who trades on it.
   *
   * Brokedale's only compounding asset, and a deliberate rehearsal for the
   * ending: the first time you make money from a thing rather than a shift is
   * the first time somebody pays you for standing where they stand.
   */
  stallOwned: boolean;
  /** The building on St Giles Row. Brokedale's apex. */
  blockOwned: boolean;
  won: boolean;
  /**
   * Which apexes you have reached. `won` stays as "at all", because a hundred
   * places ask that question and none of them care how; this says which, and
   * a run can collect both.
   */
  endings: Ending[];
  /**
   * Persisted flag: true once the victory screen has been shown and
   * acknowledged. Distinct from `won` so that a save written right after
   * winning (but before the screen appears) will still show the popup on
   * the next load.
   */
  victoryAcknowledged: boolean;

  /** Days remaining on the weekly bus pass. 0 means none purchased or already expired. */
  busPassDaysLeft: number;

  /** One-shot narrative flags. */
  flags: Record<string, number>;
  log: LogLine[];
  /** Meter thresholds already warned about, so we nag once each. */
  warned: Record<string, number>;

  daysSurvived: number;
  peakPhase: Phase;
  collapses: number;

  /** Cumulative cash received from work, gigs, events, etc. */
  totalEarned: number;
  /**
   * Net-worth target set after winning. 0 means no goal active.
   * Surfaced in the journal so the player has something to chase post-win.
   */
  postWinGoal: number;
}

export function createState(seed = Date.now() >>> 0): GameState {
  const spawn = spawnPoint();
  return {
    time: 7 * 60,
    seed,
    player: { town: STARTING_TOWN, pos: { ...spawn }, facing: "down", moveProgress: 0, moveFrom: null },
    meters: { hunger: 42, thirst: 38, hygiene: 22, energy: 55, morale: 40, health: 72 },

    cash: 3,
    bank: 0,
    debt: 0,
    credit: 480,
    investments: 0,
    investmentLastDelta: 0,

    inventory: {},
    wearing: "rags",
    wardrobe: ["rags"],

    housing: perTown<HousingId>("street"),
    rentDueDay: perTown(0),
    nightsPaid: perTown(0),

    employment: null,
    shiftsWorked: {},
    employmentPayOverride: {},
    strikes: 0,
    lastShiftDay: 0,
    lastStrikeDay: 0,

    caffeine: 0,

    education: 0,
    reputation: perTown(0),

    assignment: null,
    gigsToday: {},

    weather: "overcast",
    weatherUntil: 7 * 60 + 180,
    sick: false,

    fines: 0,
    policeWarnings: 0,
    lastPoliceCheck: 0,
    lastMovedTime: 7 * 60,

    businessOwned: false,
    mayor: false,
    stallOwned: false,
    blockOwned: false,
    won: false,
    endings: [],
    victoryAcknowledged: false,

    busPassDaysLeft: 0,

    flags: {},
    log: [],
    warned: {},

    daysSurvived: 0,
    peakPhase: 1,
    collapses: 0,

    totalEarned: 0,
    postWinGoal: 0,
  };
}

/** The town the player is standing in. Every map query needs one. */
export function townOf(s: GameState): Town {
  return townById(s.player.town);
}

/**
 * Put the body down in another town.
 *
 * A position means nothing without the town it is in, so the two move
 * together, and the half-finished step between two tiles is thrown away —
 * otherwise the renderer would animate you sliding out of a tile forty
 * minutes down the road.
 */
export function arriveIn(s: GameState, town: TownId, pos: Vec2): void {
  s.player.town = town;
  s.player.pos = { ...pos };
  s.player.moveFrom = null;
  s.player.moveProgress = 0;
  // You have not loitered here yet; the local police start their clock now.
  s.lastMovedTime = s.time;
}

export function netWorth(s: GameState): number {
  return s.cash + s.bank + s.investments - s.debt;
}

export function currentAppearance(s: GameState): number {
  return appearance(s.meters.hygiene, s.wearing);
}

/* -------------------------------------------------------- per-town access */

/** Where you live in a given town. Defaults to the one you are standing in. */
export function housingIn(s: GameState, town: TownId = s.player.town): HousingId {
  return s.housing[town] ?? "street";
}

export function setHousing(s: GameState, where: HousingId, town: TownId = s.player.town): void {
  s.housing[town] = where;
}

/** The best address you hold anywhere. What phase you are in follows this. */
export function bestHousing(s: GameState): HousingId {
  let best: HousingId = "street";
  for (const id of Object.keys(s.housing) as TownId[]) {
    const here = s.housing[id];
    if (here && housingRank(here) > housingRank(best)) best = here;
  }
  return best;
}

/** What your name is worth in a given town. */
export function reputationIn(s: GameState, town: TownId = s.player.town): number {
  return s.reputation[town] ?? 0;
}

export function phaseOf(s: GameState): Phase {
  // Your standing is set by the best door you hold, in any town — you do not
  // drop back to phase 1 by taking the coach somewhere you have no room.
  const home = bestHousing(s);
  if (home === "estate" || s.mayor || s.businessOwned || s.blockOwned) return 4;
  // A let of your own plus a career. The apartment used to be the only door
  // to phase 3, which was fine while Brokemon was the only town — a Brokedale
  // depot manager on St Giles Row would otherwise have topped out at phase 2
  // with a tier-4 job.
  if ((home === "apartment" || home === "room") && s.employment && EMPLOYMENT[s.employment].tier >= 3) return 3;
  // Any address with a door on it is out of phase 1, career or not.
  if (home === "hostel" || home === "room" || home === "trailer" || home === "apartment") return 2;
  return 1;
}

export const PHASE_NAMES: Record<Phase, string> = {
  1: "The Streets",
  2: "Odd Jobs",
  3: "The Career Track",
  4: "The Apex",
};

export interface RequirementCheck {
  ok: boolean;
  /** Human-readable reasons you were turned away, worst first. */
  reasons: string[];
}

export function checkRequirements(s: GameState, req: Requirements): RequirementCheck {
  const reasons: string[] = [];

  if (req.hygiene !== undefined && s.meters.hygiene < req.hygiene) {
    reasons.push(`you need to be a lot cleaner (${Math.floor(s.meters.hygiene)}/${req.hygiene})`);
  }
  if (req.outfit !== undefined && outfitRank(s.wearing) < outfitRank(req.outfit)) {
    reasons.push(`you'd need ${OUTFITS[req.outfit].name.toLowerCase()} at minimum`);
  }
  if (req.appearance !== undefined && currentAppearance(s) < req.appearance) {
    reasons.push(`you don't look the part (${currentAppearance(s)}/${req.appearance})`);
  }
  if (req.education !== undefined && s.education < req.education) {
    reasons.push(`${req.education} night-class credit${req.education === 1 ? "" : "s"} required, you have ${s.education}`);
  }
  if (req.item !== undefined && countOf(s.inventory, req.item) < 1) {
    reasons.push(`you need a ${req.item === "phone" ? "phone they can call back on" : req.item}`);
  }
  if (req.energy !== undefined && s.meters.energy < req.energy) {
    reasons.push(`you're too worn out for this right now`);
  }
  if (req.morale !== undefined && s.meters.morale < req.morale) {
    reasons.push(`you cannot make yourself do this today`);
  }
  if (req.reputation !== undefined && reputationIn(s) < req.reputation) {
    reasons.push(`your name is worth less around here than that`);
  }
  if (req.experience !== undefined) {
    const have = s.shiftsWorked[req.experience.job] ?? 0;
    if (have < req.experience.shifts) {
      reasons.push(
        `${req.experience.shifts} shifts as ${EMPLOYMENT[req.experience.job].name} required, you have ${have}`,
      );
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function gigsDoneToday(s: GameState, id: GigId): number {
  return s.gigsToday[id] ?? 0;
}

export function canDoGig(s: GameState, id: GigId): RequirementCheck {
  const gig = GIGS[id];
  const check = checkRequirements(s, gig.requires);
  if (gig.dailyLimit !== undefined && gigsDoneToday(s, id) >= gig.dailyLimit) {
    check.reasons.unshift("that's all the work there is today");
    check.ok = false;
  }
  return check;
}

export function hasItem(s: GameState, id: ItemId, n = 1): boolean {
  return countOf(s.inventory, id) >= n;
}

export function jobName(id: JobId): string {
  return id in EMPLOYMENT ? EMPLOYMENT[id as EmploymentId].name : GIGS[id as GigId].name;
}

export function pushLog(s: GameState, text: string, tone: LogLine["tone"] = "plain"): void {
  s.log.push({ time: s.time, text, tone });
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
}

/**
 * The one place a reputation number becomes a word. Highest threshold first;
 * the last entry is the floor and must stay at -Infinity so the lookup is
 * total.
 */
export const REPUTATION_TIERS = [
  { at: 60, label: "Respected" },
  { at: 30, label: "Reliable" },
  { at: 0, label: "Neutral" },
  { at: -30, label: "Spotty" },
  { at: -Infinity, label: "Infamous" },
] as const;

export type ReputationLabel = (typeof REPUTATION_TIERS)[number]["label"];

export function reputationLabel(rep: number): ReputationLabel {
  for (const tier of REPUTATION_TIERS) if (rep >= tier.at) return tier.label;
  return "Infamous";
}

/**
 * What the player is told when they cross into a tier. These are total records
 * rather than partial ones on purpose: add a tier to REPUTATION_TIERS without
 * writing its two lines and this stops compiling, instead of silently
 * swallowing the notification at runtime.
 *
 * The bottom tier cannot be entered from below and the top cannot be entered
 * from above, so those two entries are unreachable while the tiers stand as
 * they are. They are written anyway — the point is that a future threshold
 * change cannot open a hole.
 */
const REP_CROSS_UP: Record<ReputationLabel, string> = {
  Infamous:  "Even by your own standards this counts as clawing upward. Infamous, still.",
  Spotty:    "You've clawed back a little ground. People round here would call you Spotty — still rough, but not Infamous.",
  Neutral:   "The slate clears a little. People round here would call you Neutral — no stain on your name.",
  Reliable:  "Word gets around. People are starting to call you Reliable.",
  Respected: "Your name means something in this town now. You've earned the word Respected.",
};

const REP_CROSS_DOWN: Record<ReputationLabel, string> = {
  Respected: "Whatever that was, it did not stick to you. Still Respected.",
  Reliable:  "The shine came off. You're Reliable now, nothing more.",
  Neutral:   "You slipped. Back to Neutral — the goodwill is spent.",
  Spotty:    "People are talking, and not kindly. Your name is Spotty around here.",
  Infamous:  "You're known now, for all the wrong reasons. Infamous.",
};

/**
 * How well known you can get, and how badly.
 *
 * The tiers stop at "Respected" (60), so every point past that was inflating
 * numbers while meaning nothing new — and reputation only ever went up. Runs
 * were ending at 546-723, which put the franchise on $1,000+ a day and pushed
 * every interview past certainty, so the last third of a game had no failure
 * mode left in it.
 *
 * Gains now shrink as your name gets bigger; losses land in full. Being known
 * is easy at first and increasingly hard to improve on, which is both truer
 * and keeps the endgame's arithmetic somewhere near the rest of the game's.
 */
export const REPUTATION_CEILING = 100;
export const REPUTATION_FLOOR = -60;

/**
 * Apply a reputation delta and log a message if the descriptor tier changes.
 * Use this instead of mutating s.reputation directly.
 */
export function changeReputation(s: GameState, delta: number, town: TownId = s.player.town): void {
  const now = reputationIn(s, town);
  const before = reputationLabel(now);
  // A good turn is worth less to someone everybody already knows. Bad news
  // travels at full speed whoever you are.
  const headroom = Math.max(0.15, 1 - now / REPUTATION_CEILING);
  const scaled = delta > 0 ? delta * headroom : delta;
  // Kept whole — it is shown to the player as a number.
  s.reputation[town] = Math.round(Math.max(REPUTATION_FLOOR, Math.min(REPUTATION_CEILING, now + scaled)));
  const after = reputationLabel(reputationIn(s, town));
  if (after !== before) {
    const msg = delta > 0 ? REP_CROSS_UP[after] : REP_CROSS_DOWN[after];
    if (msg) pushLog(s, msg, delta > 0 ? "good" : "bad");
  }
}

/**
 * Add cash to the player's wallet and credit it toward the lifetime total.
 * Use this for all income (wages, gigs, events, panhandling, recycling, etc.)
 * rather than assigning s.cash directly, so totalEarned stays accurate.
 */
export function earnCash(s: GameState, amount: number): void {
  s.cash += amount;
  s.totalEarned += amount;
  checkPostWinGoal(s);
}
const POST_WIN_GOAL = 10_000;

/**
 * Mark the run as won. Safe to call multiple times — only acts the first time.
 * Sets the post-win net-worth challenge atomically, skipping it if the player
 * is already above the threshold.
 */
/**
 * The two ways a run can end, and they are meant to mean opposite things.
 *
 * The estate is getting *out*: a view of the town that moved you on. The block
 * is staying, and owning the door you first paid rent through. A game about
 * housing precarity where one ending is becoming the landlord ought to be
 * uncomfortable, and this is where that lands.
 */
export type Ending = "estate" | "block";

export const ENDING_NAMES: Record<Ending, string> = {
  estate: "The estate on the hill",
  block: "The block on St Giles Row",
};

/**
 * Mark an apex reached. Safe to call repeatedly — each ending lands once, and
 * a run that collects both keeps them both.
 */
export function setWon(s: GameState, ending: Ending): void {
  if (s.endings.includes(ending)) return;
  s.endings.push(ending);
  pushLog(
    s,
    ending === "estate" ? "You made it all the way out." : "The building is yours. You still live in it.",
    "good",
  );
  if (s.won) return;
  s.won = true;
  const nw = netWorth(s);
  if (nw < POST_WIN_GOAL) {
    s.postWinGoal = POST_WIN_GOAL;
    pushLog(s, `New challenge: reach a net worth of $${POST_WIN_GOAL.toLocaleString()}.`, "system");
  }
}

/**
 * Resolve the post-win net-worth challenge if the threshold has been reached.
 * Safe to call at any time; no-ops when not applicable.
 * Called from earnCash, payPassiveIncome, and onNewDay (as fallback).
 */
export function checkPostWinGoal(s: GameState): void {
  if (!s.won || s.postWinGoal === 0) return;
  if (netWorth(s) >= s.postWinGoal) {
    pushLog(s, `Net worth hit $${s.postWinGoal.toLocaleString()}. The numbers say you have arrived.`, "good");
    s.postWinGoal = 0;
  }
}
