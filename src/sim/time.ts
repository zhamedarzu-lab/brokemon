/** Absolute in-game time is a single minute counter. Everything derives from it. */

export const MINUTES_PER_DAY = 24 * 60;

/** Real milliseconds per in-game minute while simply walking around. */
export const MS_PER_MINUTE = 260;

export function dayOf(time: number): number {
  return Math.floor(time / MINUTES_PER_DAY) + 1;
}

export function minuteOfDay(time: number): number {
  return ((time % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function hourOf(time: number): number {
  return Math.floor(minuteOfDay(time) / 60);
}

export function formatClock(time: number): string {
  // Time accumulates in fractional minutes as you walk, so floor before display.
  const m = Math.floor(minuteOfDay(time));
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${suffix}`;
}

/** Inclusive-start, exclusive-end window that may wrap past midnight. */
export function withinHours(time: number, startHour: number, endHour: number): boolean {
  const h = minuteOfDay(time) / 60;
  if (startHour <= endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour;
}

/** Minutes from `time` forward to the next occurrence of `hour`:00. */
export function minutesUntilHour(time: number, hour: number): number {
  const target = hour * 60;
  const now = minuteOfDay(time);
  return now < target ? target - now : MINUTES_PER_DAY - now + target;
}

export type DayPart = "night" | "dawn" | "day" | "dusk";

export function dayPart(time: number): DayPart {
  const h = hourOf(time);
  if (h >= 21 || h < 5) return "night";
  if (h < 7) return "dawn";
  if (h < 18) return "day";
  return "dusk";
}

/** 0 = pitch dark, 1 = full daylight. Used for the ambient light wash. */
export function daylight(time: number): number {
  const h = minuteOfDay(time) / 60;
  if (h < 4.5 || h >= 21.5) return 0;
  if (h < 7) return (h - 4.5) / 2.5;
  if (h < 18.5) return 1;
  return 1 - (h - 18.5) / 3;
}
