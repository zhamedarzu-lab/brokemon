import type { ItemId } from "./items";
import { MORALE_BREAKDOWN, type MeterDelta } from "./meters";
import type { OutfitId } from "./social";

export type GigId = "panhandle" | "flyers" | "yardWork" | "dayLabor";
export type EmploymentId = "martClerk" | "nightStock" | "landscaper" | "technician" | "officeAdmin" | "executive";
export type JobId = GigId | EmploymentId;

/** Everything the town can ask you to prove before it lets you earn. */
export interface Requirements {
  hygiene?: number;
  appearance?: number;
  /** Minimum outfit tier. */
  outfit?: OutfitId;
  /** Night-class credits. */
  education?: number;
  energy?: number;
  morale?: number;
  item?: ItemId;
  /** Shifts already worked in another job, i.e. a reference. */
  experience?: { job: EmploymentId; shifts: number };
  reputation?: number;
}

export interface GigDef {
  id: GigId;
  name: string;
  desc: string;
  /** Minutes per attempt. */
  minutes: number;
  requires: Requirements;
  cost: MeterDelta;
  /** Multiplier on hygiene/energy burn during the work. */
  exertion: number;
  /** How many separate places you have to physically get to. */
  stops: number;
  /** Base payout before weather, appearance and luck. */
  basePay: number;
  /** Gigs you take from the job board rather than just doing on the spot. */
  fromJobBoard: boolean;
  /** Once per day. */
  dailyLimit?: number;
}

export const GIGS: Record<GigId, GigDef> = {
  panhandle: {
    id: "panhandle",
    name: "Ask for change",
    desc: "Half an hour on the corner with your hand out and your eyes down.",
    minutes: 30,
    requires: {},
    cost: { morale: -4, energy: -2 },
    exertion: 1,
    stops: 0,
    basePay: 4,
    fromJobBoard: false,
  },
  flyers: {
    id: "flyers",
    name: "Deliver flyers",
    desc: "Four addresses, one stack of paper, twenty-two dollars cash.",
    minutes: 0,
    requires: { energy: 15 },
    cost: { energy: -14, hygiene: -5, thirst: -10, hunger: -6 },
    exertion: 1.4,
    stops: 4,
    basePay: 22,
    fromJobBoard: true,
    dailyLimit: 2,
  },
  yardWork: {
    id: "yardWork",
    name: "Yard work",
    desc: "Somebody's hedge, somebody's leaves, ninety minutes, thirty-five dollars.",
    minutes: 90,
    requires: { energy: 25, hygiene: 15, morale: MORALE_BREAKDOWN },
    cost: { energy: -26, hygiene: -14, thirst: -18, hunger: -12, morale: +3 },
    exertion: 2.2,
    stops: 1,
    basePay: 35,
    fromJobBoard: true,
    dailyLimit: 2,
  },
  dayLabor: {
    id: "dayLabor",
    name: "Day labour",
    desc: "Unloading a truck behind the Mart. Cash at the end, no questions at the start.",
    minutes: 180,
    requires: { energy: 35, hygiene: 10, morale: MORALE_BREAKDOWN },
    cost: { energy: -42, hygiene: -22, thirst: -30, hunger: -24, morale: -2 },
    exertion: 2.6,
    stops: 0,
    basePay: 54,
    fromJobBoard: true,
    dailyLimit: 1,
  },
};

export interface EmploymentDef {
  id: EmploymentId;
  name: string;
  employer: string;
  /** Marker id where the shift is worked. */
  location: string;
  /** Which phase of the ladder this belongs to. */
  tier: 2 | 3 | 4;
  shiftStart: number;
  shiftEnd: number;
  /** Grace in hours before you're counted late. */
  grace: number;
  pay: number;
  requires: Requirements;
  cost: MeterDelta;
  exertion: number;
  desc: string;
  /** Salaried roles pay whether or not the weather cooperates. */
  salaried: boolean;
}

export const EMPLOYMENT: Record<EmploymentId, EmploymentDef> = {
  martClerk: {
    id: "martClerk",
    name: "Mart Clerk (part-time)",
    employer: "Brokemon Mart",
    location: "mart",
    tier: 2,
    shiftStart: 10,
    shiftEnd: 15,
    grace: 1,
    pay: 52,
    requires: { hygiene: 45, outfit: "thrift", appearance: 40 },
    cost: { energy: -14, hygiene: -8, hunger: -16, thirst: -20, morale: -2 },
    exertion: 1.2,
    salaried: false,
    desc: "Five hours on the register. The badge says TRAINEE and will for a year.",
  },
  nightStock: {
    id: "nightStock",
    name: "Overnight Stocker",
    employer: "Brokemon Mart",
    location: "mart",
    tier: 2,
    shiftStart: 22,
    shiftEnd: 3,
    grace: 1,
    pay: 68,
    requires: { hygiene: 30, energy: 30, outfit: "thrift" },
    cost: { energy: -26, hygiene: -14, hunger: -20, thirst: -22, morale: -8 },
    exertion: 2.0,
    salaried: false,
    desc: "Nobody sees you, nobody smells you, and it pays better than daylight. Clean clothes required to get past the door.",
  },
  landscaper: {
    id: "landscaper",
    name: "Grounds Crew",
    employer: "Market Square Parks Dept.",
    location: "jobBoard",
    tier: 2,
    shiftStart: 8,
    shiftEnd: 13,
    grace: 1,
    pay: 74,
    // This asked for zero shifts once, which is a requirement no check can
    // fail — the best-paid job of the tier was open on the first morning and
    // the two beneath it were content nobody had a reason to touch.
    requires: { hygiene: 30, energy: 35, experience: { job: "martClerk", shifts: 3 } },
    cost: { energy: -20, hygiene: -26, hunger: -26, thirst: -34, morale: +2 },
    exertion: 2.4,
    salaried: false,
    desc: "Six hours of other people's grass. Your back learns the schedule.",
  },
  technician: {
    id: "technician",
    name: "Field Technician",
    employer: "Route 1 Utilities",
    location: "corporatePlaza",
    tier: 3,
    shiftStart: 8,
    shiftEnd: 16,
    grace: 1,
    pay: 168,
    requires: { hygiene: 60, outfit: "smartCasual", education: 1, item: "phone", appearance: 60 },
    cost: { energy: -18, hygiene: -14, hunger: -22, thirst: -26 },
    exertion: 1.5,
    salaried: true,
    desc: "A van, a toolkit, and a dispatcher who calls you by your surname.",
  },
  officeAdmin: {
    id: "officeAdmin",
    name: "Office Administrator",
    employer: "Silph Regional",
    location: "corporatePlaza",
    tier: 3,
    shiftStart: 9,
    shiftEnd: 17,
    grace: 0.75,
    pay: 196,
    requires: { hygiene: 70, outfit: "professional", education: 2, item: "phone", appearance: 72 },
    cost: { energy: -14, hygiene: -6, hunger: -20, thirst: -24, morale: +1 },
    exertion: 1.0,
    salaried: true,
    desc: "A desk with your name on a printed strip of card. It is not nothing.",
  },
  executive: {
    id: "executive",
    name: "Regional Director",
    employer: "Silph Regional",
    location: "corporatePlaza",
    tier: 4,
    shiftStart: 9,
    shiftEnd: 17,
    grace: 1,
    pay: 640,
    requires: {
      hygiene: 80,
      outfit: "tailored",
      education: 5,
      item: "phone",
      appearance: 85,
      experience: { job: "officeAdmin", shifts: 20 },
    },
    cost: { energy: -10, hunger: -18, thirst: -22, morale: +4 },
    exertion: 0.8,
    salaried: true,
    desc: "You approve other people's overtime now. You remember asking for it.",
  },
};

export const EMPLOYMENT_ORDER: EmploymentId[] = [
  "martClerk",
  "nightStock",
  "landscaper",
  "technician",
  "officeAdmin",
  "executive",
];

export function isEmployment(id: JobId): id is EmploymentId {
  return id in EMPLOYMENT;
}

/** Night classes at the community college. */
export const CLASS_COST = 45;
export const CLASS_START = 19;
export const CLASS_END = 22;
export const MAX_CREDITS = 6;

/**
 * Energy needed to sit through a class, and what sitting through it costs.
 *
 * These were 20 and 18. A shift plus a day on your feet lands you at the
 * college door with about 12, so working and studying were mutually exclusive
 * — and night school is the only way into phase 3, which made the whole
 * mid-game a forced alternation of earning days and learning days. Coming
 * straight from work should be hard, not impossible: you can attend on
 * fumes now, and you will have nothing left afterwards.
 */
export const CLASS_MIN_ENERGY = 10;
export const CLASS_ENERGY_COST = 12;

export const CLASS_NAMES = [
  "Intro to Bookkeeping",
  "Business Communication",
  "Spreadsheets for Work",
  "Applied Logistics",
  "Management Principles",
  "Regional Commerce Law",
];
