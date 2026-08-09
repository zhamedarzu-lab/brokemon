import type { TownId } from "../world/map";
import type { ItemId } from "./items";
import { MORALE_BREAKDOWN, type MeterDelta } from "./meters";
import type { OutfitId } from "./social";

export type GigId = "panhandle" | "flyers" | "yardWork" | "dayLabor" | "siteWork";
export type EmploymentId =
  // Brokemon Town — the ladder that runs on how you look.
  | "martClerk"
  | "nightStock"
  | "landscaper"
  | "technician"
  | "officeAdmin"
  | "executive"
  // Brokedale — the ladder that runs on hours put in.
  | "picker"
  | "dispatcher"
  | "depotManager";
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
  siteWork: {
    id: "siteWork",
    name: "Site work",
    desc: "A van at seven, a site somewhere, and cash in your hand at the end of it.",
    // Six hours, and you have to be at the agency door in the morning to get
    // it — the muster is the cost. Pays better than anything in Brokemon that
    // does not ask for clothes, which is the whole reason to be in this city
    // without an address yet.
    minutes: 360,
    // Energy only, and deliberately. Every other gig has a morale floor,
    // because Brokemon has a food bank and a free wash to climb back out with.
    // Brokedale has neither, so a morale floor on the only job in the city is
    // a spiral rather than a speed bump: the walking rig lost a fortnight to
    // it on both seeds, thirteen "you cannot make yourself do this today" in a
    // row. An agency whose entire pitch is that it asks no questions does not
    // get to ask that one.
    requires: { energy: 30 },
    cost: { energy: -55, hygiene: -34, thirst: -44, hunger: -38, morale: -4 },
    exertion: 2.8,
    stops: 0,
    basePay: 88,
    fromJobBoard: false,
    dailyLimit: 1,
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
  /**
   * Which town the job is in. Listings are filtered by it, so the Market
   * Square board does not offer you a shift forty minutes up the road that
   * would cost more to reach than it pays.
   */
  town: TownId;
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
    town: "brokemon",
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
    town: "brokemon",
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
    town: "brokemon",
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
    town: "brokemon",
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
    town: "brokemon",
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
    town: "brokemon",
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

  /* ------------------------------------------------------------ Brokedale */

  /**
   * The other ladder.
   *
   * Not one requirement on this track is about how you look — no outfit, no
   * appearance, and the hygiene numbers are about being safe on a yard rather
   * than presentable in a lobby. That is the whole point of it: Brokemon's
   * career runs through a security gate that wants appearance 70 every single
   * morning, so a player who cannot hold that number has, until now, had
   * nowhere to go. What Brokedale asks for instead is hours and credits.
   *
   * It pays less at the top than Silph does and gets there with far less
   * ceremony. The two towns still need each other: the credits come from night
   * class, and night class is in Brokemon.
   */
  picker: {
    id: "picker",
    town: "brokedale",
    name: "Warehouse Picker",
    employer: "Eastgate Depot",
    location: "depot",
    tier: 2,
    // 8AM, not the 6AM a real picking shift would start at. Every bed in the
    // game wakes you at 7, so a 6AM start with half an hour of grace was a
    // shift you could not clock into on time from any address — the walking
    // rig was hired, written up for lateness three times, fired, and rehired,
    // six times over three weeks.
    shiftStart: 8,
    shiftEnd: 16,
    grace: 0.5,
    // Eight hours at about what the agency pays by the hour. You are buying
    // a rota rather than a raise: shifts here count, and the agency's do not.
    pay: 118,
    requires: { hygiene: 25, energy: 30 },
    cost: { energy: -34, hygiene: -20, hunger: -28, thirst: -32, morale: -3 },
    exertion: 2.2,
    salaried: false,
    desc: "A handheld scanner, a numbered aisle, and a target on a screen that goes up every quarter.",
  },
  dispatcher: {
    id: "dispatcher",
    town: "brokedale",
    name: "Dispatch Coordinator",
    employer: "Eastgate Depot",
    location: "depot",
    tier: 3,
    shiftStart: 8,
    shiftEnd: 17,
    grace: 0.75,
    pay: 210,
    requires: { hygiene: 40, education: 2, item: "phone", experience: { job: "picker", shifts: 12 } },
    cost: { energy: -20, hygiene: -10, hunger: -24, thirst: -28 },
    exertion: 1.2,
    salaried: true,
    desc: "You are the voice on the other end of the handheld now. Nine hours, and a chair.",
  },
  depotManager: {
    id: "depotManager",
    town: "brokedale",
    name: "Depot Manager",
    employer: "Eastgate Depot",
    location: "depot",
    tier: 4,
    shiftStart: 7,
    shiftEnd: 17,
    grace: 1,
    // Less than Silph's director, and it wants no suit, no lobby and nobody's
    // permission to walk up a hill.
    pay: 420,
    requires: { hygiene: 50, education: 4, item: "phone", experience: { job: "dispatcher", shifts: 18 } },
    cost: { energy: -16, hunger: -22, thirst: -26, morale: +2 },
    exertion: 1.0,
    salaried: true,
    desc: "Ten hours, the keys to the yard, and the rota is yours to write. You remember reading it.",
  },
};

export const EMPLOYMENT_ORDER: EmploymentId[] = [
  "martClerk",
  "nightStock",
  "landscaper",
  "technician",
  "officeAdmin",
  "executive",
  "picker",
  "dispatcher",
  "depotManager",
];

/** The ladder available in a given town, worst-paid first. */
export function employmentIn(town: TownId): EmploymentId[] {
  return EMPLOYMENT_ORDER.filter((id) => EMPLOYMENT[id].town === town);
}

export function isEmployment(id: JobId): id is EmploymentId {
  return id in EMPLOYMENT;
}

/**
 * What an employer asks at the interview, as opposed to at the door on the
 * morning of a shift.
 *
 * Energy and morale are the difference. They are right on the door — a
 * supervisor sends home someone who cannot keep their eyes open — and wrong at
 * the interview, where being tired this afternoon says nothing about whether
 * you can do the job. The walking rig hit this twenty days running: it applied
 * for the warehouse after a six-hour shift and was told it was "too worn out
 * for this right now", which is not a hiring decision anyone makes.
 *
 * Same family of bug as the dress-code one (finding 13): the check that gets
 * you hired and the check that gets you through the door were the same object,
 * and they are not the same question.
 */
export function hiringRequirements(def: EmploymentDef): Requirements {
  const { energy: _energy, morale: _morale, ...durable } = def.requires;
  return durable;
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
