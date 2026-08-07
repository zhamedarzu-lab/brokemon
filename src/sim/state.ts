import { spawnPoint, type Vec2 } from "../world/map";
import type { EmploymentId, GigId, JobId, Requirements } from "./jobs";
import { EMPLOYMENT, GIGS } from "./jobs";
import { countOf, type Inventory, type ItemId } from "./items";
import { appearance, outfitRank, OUTFITS, type HousingId, type OutfitId } from "./social";
import type { Meters } from "./meters";
import type { WeatherId } from "./weather";

export type Facing = "up" | "down" | "left" | "right";

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
  expiresAtDay: number;
}

export interface Player {
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

  housing: HousingId;
  /** Absolute day on which rent is next taken. */
  rentDueDay: number;
  /** Nights the current bed is paid up for. */
  nightsPaid: number;

  employment: EmploymentId | null;
  shiftsWorked: Record<string, number>;
  /** Per-job pay overrides accumulated from 10-shift raises. */
  employmentPayOverride: Record<string, number>;
  /** Shifts missed at the current job. Three and you're let go. */
  strikes: number;
  lastShiftDay: number;

  education: number;
  reputation: number;

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
  won: boolean;

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
}

export function createState(seed = Date.now() >>> 0): GameState {
  const spawn = spawnPoint();
  return {
    time: 7 * 60,
    seed,
    player: { pos: { ...spawn }, facing: "down", moveProgress: 0, moveFrom: null },
    meters: { hunger: 42, thirst: 38, hygiene: 22, energy: 55, morale: 40, health: 72 },

    cash: 3,
    bank: 0,
    debt: 240,
    credit: 480,
    investments: 0,
    investmentLastDelta: 0,

    inventory: {},
    wearing: "rags",
    wardrobe: ["rags"],

    housing: "street",
    rentDueDay: 0,
    nightsPaid: 0,

    employment: null,
    shiftsWorked: {},
    employmentPayOverride: {},
    strikes: 0,
    lastShiftDay: 0,

    education: 0,
    reputation: 0,

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
    won: false,

    busPassDaysLeft: 0,

    flags: {},
    log: [],
    warned: {},

    daysSurvived: 0,
    peakPhase: 1,
    collapses: 0,
  };
}

export function netWorth(s: GameState): number {
  return s.cash + s.bank + s.investments - s.debt;
}

export function currentAppearance(s: GameState): number {
  return appearance(s.meters.hygiene, s.wearing);
}

export function phaseOf(s: GameState): Phase {
  if (s.housing === "estate" || s.mayor || s.businessOwned) return 4;
  if (s.housing === "apartment" && s.employment && EMPLOYMENT[s.employment].tier >= 3) return 3;
  // Any address with a door on it is out of phase 1, career or not.
  if (s.housing === "hostel" || s.housing === "trailer" || s.housing === "apartment") return 2;
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
  if (req.reputation !== undefined && s.reputation < req.reputation) {
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
