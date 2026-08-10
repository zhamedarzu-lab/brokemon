/**
 * The five biological meters plus health, and the rules that grind them down.
 *
 * Everything in the game is priced in these. Money is only ever the means of
 * converting one meter into another.
 */

export type MeterId = "hunger" | "thirst" | "hygiene" | "energy" | "morale" | "health";

export type Meters = Record<MeterId, number>;
export type MeterDelta = Partial<Meters>;

export const METER_ORDER: MeterId[] = ["hunger", "thirst", "hygiene", "energy", "morale", "health"];

export const METER_LABEL: Record<MeterId, string> = {
  hunger: "Fed",
  thirst: "Hydrated",
  hygiene: "Clean",
  energy: "Energy",
  morale: "Dignity",
  health: "Health",
};

/** Points lost per in-game hour while awake and idle. */
export const DECAY_PER_HOUR: Record<MeterId, number> = {
  hunger: 3.6,
  thirst: 5.0,
  hygiene: 1.9,
  // A 15-hour day at light exertion burned 61 of a 100-point bar, against the
  // 75 a hostel bed gives back — so energy slid downhill no matter what you
  // did. Work also charges its own lump cost on top of this.
  energy: 2.6,
  // Deliberately small. At 0.9 the base drain was 17/day, which exactly
  // cancelled every free morale source in the game combined, so Dignity sat
  // at zero forever and the breakdown gate never lifted. The bite is meant
  // to come from the penalty terms below, not from simply existing.
  morale: 0.45,
  health: 0,
};

/**
 * Dignity regained per hour once you are fed, watered, clean, dry and well.
 * This is the only thing standing between the meter and a permanent zero.
 */
export const MORALE_RECOVERY_PER_HOUR = 1.3;

export function clamp(v: number, lo = 0, hi = 100): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function applyDelta(meters: Meters, delta: MeterDelta): void {
  for (const key of METER_ORDER) {
    const d = delta[key];
    if (d !== undefined) meters[key] = clamp(meters[key] + d);
  }
}

/**
 * The two halves of cleanliness. Body is restored by showering; clothes by
 * laundry or buying new. Clothes decay slower with a better outfit.
 * `meters.hygiene` is always derived: Math.round((bodyClean + clothesClean) / 2).
 */
export interface HygieneSub {
  bodyClean: number;
  clothesClean: number;
}

/** Clothes-cleanliness points lost per in-game hour, indexed by outfit rank (0=rags … 4=tailored). */
const CLOTHES_DECAY_BY_RANK = [3.0, 1.8, 1.2, 0.8, 0.5];

/**
 * What running on empty does to the other half.
 *
 * These two are the only feedback loop between meters, and they are deliberate:
 * exhaustion and dehydration are the same hole from different ends. Neither one
 * kills you on its own — energy has no direct health cost and thirst at zero
 * already bleeds health — but together they close a circuit, so a day that ends
 * with nothing left in you is a day that costs something tomorrow rather than a
 * meter sitting harmlessly at the bottom of its bar.
 *
 * Both are gentler than the meters' own decay (thirst 5.0/hr, energy 2.6/hr), so
 * a drink or an hour's sleep still climbs out faster than the loop pulls down.
 */
const EXHAUSTION_THIRST_PER_HOUR = 3.0;
const DEHYDRATION_ENERGY_PER_HOUR = 2.0;

export interface DecayContext {
  /** In-game minutes elapsed. */
  minutes: number;
  /** Asleep bodies burn less of everything except hunger. */
  asleep: boolean;
  /** Physical work multiplies hygiene and energy burn. */
  exertion: number;
  /** Standing in the rain without a poncho. */
  soaked: boolean;
  sick: boolean;
  /** Outfit rank 0 (rags) – 4 (tailored). Governs clothes-cleanliness decay. */
  outfitRank: number;
}

/**
 * Advance the meters. Returns the delta actually applied so callers can
 * report "you are starving" only on the tick where it first bites.
 */
export function decay(meters: Meters, ctx: DecayContext, hygieneSub: HygieneSub): MeterDelta {
  const hours = ctx.minutes / 60;
  const before: Meters = { ...meters };

  const restMul = ctx.asleep ? 0.45 : 1;
  meters.hunger = clamp(meters.hunger - DECAY_PER_HOUR.hunger * hours * (ctx.asleep ? 0.7 : 1));
  meters.thirst = clamp(meters.thirst - DECAY_PER_HOUR.thirst * hours * restMul);
  // Body cleanliness: sweat, exertion, and soaking all hit the skin.
  const bodyDecayRate = DECAY_PER_HOUR.hygiene * (ctx.asleep ? 0.6 : ctx.exertion) + (ctx.soaked ? 2.5 : 0);
  hygieneSub.bodyClean = clamp(hygieneSub.bodyClean - bodyDecayRate * hours);
  // Clothes cleanliness: quality determines how quickly they pick up dirt.
  const clothesDecayRate =
    (CLOTHES_DECAY_BY_RANK[Math.min(4, ctx.outfitRank)] ?? 3.0) * (ctx.asleep ? 0.4 : 1) + (ctx.soaked ? 1.0 : 0);
  hygieneSub.clothesClean = clamp(hygieneSub.clothesClean - clothesDecayRate * hours);
  // Combined display meter — average of the two halves.
  meters.hygiene = Math.round((hygieneSub.bodyClean + hygieneSub.clothesClean) / 2);
  if (!ctx.asleep) {
    meters.energy = clamp(meters.energy - DECAY_PER_HOUR.energy * hours * ctx.exertion);
  }

  // Empty pulls on empty. A body with nothing left in it sweats out what water
  // it has and stops thinking to drink; a body with no water in it cannot make
  // energy out of anything. Read both from the values *before* the coupling so
  // the two sides are symmetrical and one tick cannot cascade through itself.
  const flatOut = meters.energy <= 0;
  const driedOut = meters.thirst <= 0;
  if (flatOut) meters.thirst = clamp(meters.thirst - EXHAUSTION_THIRST_PER_HOUR * hours * restMul);
  if (driedOut) meters.energy = clamp(meters.energy - DEHYDRATION_ENERGY_PER_HOUR * hours * restMul);

  // Dignity tracks the state of the body, and it has to move both ways.
  // Filthy, starving and exhausted is not a mood, it's a slope — but fed,
  // watered and clean has to climb back, or the meter is a one-way ratchet
  // to zero that pins the breakdown gate on for the whole game.
  const lookingAfterYourself =
    meters.hygiene >= 50 && meters.hunger >= 40 && meters.thirst >= 35 && !ctx.soaked && !ctx.sick;

  let moraleRate = lookingAfterYourself ? -MORALE_RECOVERY_PER_HOUR : DECAY_PER_HOUR.morale;
  if (meters.hygiene < 30) moraleRate += 1.6;
  if (meters.hunger < 25) moraleRate += 1.4;
  // Exhaustion stalls the climb even when everything else is in order.
  if (meters.energy < 20) moraleRate += 1.2;
  if (ctx.soaked) moraleRate += 2.0;
  if (ctx.sick) moraleRate += 1.0;
  meters.morale = clamp(meters.morale - moraleRate * hours * restMul);

  // Health only moves when something is actually wrong, or when you finally rest.
  let healthRate = 0;
  if (meters.hunger <= 0) healthRate -= 5.5;
  if (meters.thirst <= 0) healthRate -= 8.0;
  if (meters.hygiene <= 5) healthRate -= 1.0;
  if (ctx.soaked) healthRate -= 2.5;
  if (ctx.sick) healthRate -= 2.0;
  if (healthRate === 0 && ctx.asleep && meters.hunger > 20) healthRate += 4.0;
  if (healthRate === 0 && !ctx.asleep && meters.hunger > 50 && meters.thirst > 50) healthRate += 0.8;
  meters.health = clamp(meters.health + healthRate * hours);

  const delta: MeterDelta = {};
  for (const key of METER_ORDER) delta[key] = meters[key] - before[key];
  return delta;
}

/** Crossing one of these downward is worth telling the player about. */
export const WARN_THRESHOLDS: Array<{ meter: MeterId; at: number; text: string }> = [
  { meter: "hunger", at: 25, text: "Your stomach has stopped asking politely." },
  { meter: "hunger", at: 0, text: "You are starving. This is costing you health now." },
  { meter: "thirst", at: 25, text: "Your mouth is dry and your head is starting to pound." },
  { meter: "thirst", at: 0, text: "You are dangerously dehydrated." },
  { meter: "hygiene", at: 35, text: "You can smell yourself. So can everyone else." },
  { meter: "hygiene", at: 15, text: "People are crossing the street to avoid you." },
  { meter: "energy", at: 20, text: "You are running on nothing. You need to sleep." },
  { meter: "morale", at: 25, text: "It is getting hard to see the point of any of this." },
  { meter: "health", at: 30, text: "You feel genuinely ill. See a clinic." },
];

/** Below this the player refuses work and stumbles. */
export const MORALE_BREAKDOWN = 12;
