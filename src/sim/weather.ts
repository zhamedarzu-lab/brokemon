import type { Rng } from "./rng";

export type WeatherId = "clear" | "overcast" | "rain" | "storm" | "cold";

export interface WeatherDef {
  id: WeatherId;
  name: string;
  /** Wets you through if you're outdoors without a poncho. */
  wet: boolean;
  /** Multiplier on outdoor job pay — nobody tips in a downpour. */
  payScale: number;
  /** Added chance per hour outdoors of falling ill. */
  sickness: number;
  moralePerHourOutdoors: number;
  tint: string;
  tintAlpha: number;
}

export const WEATHER: Record<WeatherId, WeatherDef> = {
  clear: { id: "clear", name: "Clear", wet: false, payScale: 1.0, sickness: 0, moralePerHourOutdoors: 0, tint: "#ffd9a0", tintAlpha: 0.05 },
  overcast: { id: "overcast", name: "Overcast", wet: false, payScale: 0.9, sickness: 0, moralePerHourOutdoors: -0.3, tint: "#8d96a8", tintAlpha: 0.12 },
  rain: { id: "rain", name: "Rain", wet: true, payScale: 0.6, sickness: 0.07, moralePerHourOutdoors: -1.6, tint: "#4d6076", tintAlpha: 0.24 },
  storm: { id: "storm", name: "Storm", wet: true, payScale: 0.35, sickness: 0.16, moralePerHourOutdoors: -2.8, tint: "#2f3b4d", tintAlpha: 0.36 },
  cold: { id: "cold", name: "Cold Snap", wet: false, payScale: 0.8, sickness: 0.06, moralePerHourOutdoors: -1.1, tint: "#9fc0dd", tintAlpha: 0.18 },
};

const TRANSITIONS: Array<[WeatherId, number]> = [
  ["clear", 42],
  ["overcast", 27],
  ["rain", 17],
  ["cold", 9],
  ["storm", 5],
];

export function rollWeather(rng: Rng): WeatherId {
  const total = TRANSITIONS.reduce((s, [, w]) => s + w, 0);
  let roll = rng.next() * total;
  for (const [id, w] of TRANSITIONS) {
    roll -= w;
    if (roll <= 0) return id;
  }
  return "clear";
}

/** How long the next front sticks around, in minutes. */
export function weatherDuration(rng: Rng): number {
  return rng.int(120, 420);
}
