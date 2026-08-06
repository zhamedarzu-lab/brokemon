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
  energy: 3.4,
  morale: 0.9,
  health: 0,
};

export function clamp(v: number, lo = 0, hi = 100): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function applyDelta(meters: Meters, delta: MeterDelta): void {
  for (const key of METER_ORDER) {
    const d = delta[key];
    if (d !== undefined) meters[key] = clamp(meters[key] + d);
  }
}

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
}

/**
 * Advance the meters. Returns the delta actually applied so callers can
 * report "you are starving" only on the tick where it first bites.
 */
export function decay(meters: Meters, ctx: DecayContext): MeterDelta {
  const hours = ctx.minutes / 60;
  const before: Meters = { ...meters };

  const restMul = ctx.asleep ? 0.45 : 1;
  meters.hunger = clamp(meters.hunger - DECAY_PER_HOUR.hunger * hours * (ctx.asleep ? 0.7 : 1));
  meters.thirst = clamp(meters.thirst - DECAY_PER_HOUR.thirst * hours * restMul);
  meters.hygiene = clamp(
    meters.hygiene - DECAY_PER_HOUR.hygiene * hours * (ctx.asleep ? 0.6 : ctx.exertion) - (ctx.soaked ? 1.5 * hours : 0),
  );
  if (!ctx.asleep) {
    meters.energy = clamp(meters.energy - DECAY_PER_HOUR.energy * hours * ctx.exertion);
  }

  // Dignity tracks the state of the body. Filthy, starving and exhausted is
  // not a mood, it's a slope.
  let moraleRate = DECAY_PER_HOUR.morale;
  if (meters.hygiene < 30) moraleRate += 1.6;
  if (meters.hunger < 25) moraleRate += 1.4;
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
