import { describe, expect, it } from "vitest";
import { daylight, dayOf, dayPart, formatClock, hourOf, minutesUntilHour, minuteOfDay, withinHours } from "./time";

const H = (h: number, m = 0) => h * 60 + m;

describe("clock", () => {
  it("counts days from one", () => {
    expect(dayOf(0)).toBe(1);
    expect(dayOf(H(23, 59))).toBe(1);
    expect(dayOf(H(24))).toBe(2);
    expect(dayOf(H(24 * 9))).toBe(10);
  });

  it("wraps the minute of day", () => {
    expect(minuteOfDay(H(25))).toBe(H(1));
    expect(hourOf(H(49))).toBe(1);
  });

  it("formats a twelve-hour clock", () => {
    expect(formatClock(0)).toBe("12:00 AM");
    expect(formatClock(H(7, 5))).toBe("7:05 AM");
    expect(formatClock(H(12))).toBe("12:00 PM");
    expect(formatClock(H(13, 30))).toBe("1:30 PM");
    expect(formatClock(H(24) + H(23, 59))).toBe("11:59 PM");
  });

  it("floors the fractional minutes that accumulate while walking", () => {
    expect(formatClock(H(7, 8) + 0.17)).toBe("7:08 AM");
    expect(formatClock(H(9) - 0.001)).toBe("8:59 AM");
  });
});

describe("withinHours", () => {
  it("handles a normal daytime window", () => {
    expect(withinHours(H(10), 9, 17)).toBe(true);
    expect(withinHours(H(9), 9, 17)).toBe(true);
    expect(withinHours(H(17), 9, 17)).toBe(false);
    expect(withinHours(H(3), 9, 17)).toBe(false);
  });

  it("handles a window that crosses midnight", () => {
    expect(withinHours(H(23), 18, 8)).toBe(true);
    expect(withinHours(H(2), 18, 8)).toBe(true);
    expect(withinHours(H(8), 18, 8)).toBe(false);
    expect(withinHours(H(12), 18, 8)).toBe(false);
  });
});

describe("minutesUntilHour", () => {
  it("counts forward to today's occurrence", () => {
    expect(minutesUntilHour(H(7), 9)).toBe(120);
  });

  it("rolls over midnight when the hour has passed", () => {
    expect(minutesUntilHour(H(22), 7)).toBe(9 * 60);
  });

  it("returns a full day when standing exactly on the hour", () => {
    expect(minutesUntilHour(H(9), 9)).toBe(24 * 60);
  });
});

describe("daylight", () => {
  it("is dark overnight and bright at noon", () => {
    expect(daylight(H(2))).toBe(0);
    expect(daylight(H(12))).toBe(1);
    expect(daylight(H(23))).toBe(0);
  });

  it("ramps through dawn and dusk", () => {
    expect(daylight(H(6))).toBeGreaterThan(0);
    expect(daylight(H(6))).toBeLessThan(1);
    expect(daylight(H(20))).toBeGreaterThan(0);
    expect(daylight(H(20))).toBeLessThan(1);
  });

  it("names the part of the day", () => {
    expect(dayPart(H(1))).toBe("night");
    expect(dayPart(H(6))).toBe("dawn");
    expect(dayPart(H(13))).toBe("day");
    expect(dayPart(H(19))).toBe("dusk");
  });
});
