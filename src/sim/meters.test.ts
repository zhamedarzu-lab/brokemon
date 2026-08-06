import { describe, expect, it } from "vitest";
import { applyDelta, clamp, decay, METER_ORDER, type Meters } from "./meters";

function fresh(over: Partial<Meters> = {}): Meters {
  return { hunger: 80, thirst: 80, hygiene: 80, energy: 80, morale: 80, health: 80, ...over };
}

const IDLE = { minutes: 60, asleep: false, exertion: 1, soaked: false, sick: false };

describe("clamp", () => {
  it("keeps values inside 0-100", () => {
    expect(clamp(-40)).toBe(0);
    expect(clamp(140)).toBe(100);
    expect(clamp(42)).toBe(42);
  });
});

describe("applyDelta", () => {
  it("adds and clamps in one pass", () => {
    const m = fresh({ hunger: 95 });
    applyDelta(m, { hunger: +20, morale: -200 });
    expect(m.hunger).toBe(100);
    expect(m.morale).toBe(0);
  });

  it("leaves unmentioned meters alone", () => {
    const m = fresh();
    applyDelta(m, { hunger: -10 });
    expect(m.thirst).toBe(80);
  });
});

describe("decay", () => {
  it("burns the meters down over an idle hour", () => {
    const m = fresh();
    decay(m, IDLE);
    expect(m.hunger).toBeLessThan(80);
    expect(m.thirst).toBeLessThan(80);
    expect(m.energy).toBeLessThan(80);
  });

  it("burns thirst faster than hunger", () => {
    const m = fresh();
    decay(m, IDLE);
    expect(80 - m.thirst).toBeGreaterThan(80 - m.hunger);
  });

  it("does not drain energy while asleep", () => {
    const m = fresh({ energy: 40 });
    decay(m, { ...IDLE, asleep: true, minutes: 480 });
    expect(m.energy).toBe(40);
  });

  it("heals a fed sleeper", () => {
    const m = fresh({ health: 50, hunger: 60 });
    decay(m, { ...IDLE, asleep: true, minutes: 480 });
    expect(m.health).toBeGreaterThan(50);
  });

  it("costs health once hunger and thirst bottom out", () => {
    const m = fresh({ hunger: 0, thirst: 0, health: 60 });
    decay(m, IDLE);
    expect(m.health).toBeLessThan(60);
  });

  it("drains morale faster when the body is failing", () => {
    const healthy = fresh();
    const wrecked = fresh({ hygiene: 10, hunger: 10, energy: 10 });
    decay(healthy, IDLE);
    decay(wrecked, IDLE);
    expect(80 - wrecked.morale).toBeGreaterThan(80 - healthy.morale);
  });

  it("makes exertion cost energy and hygiene", () => {
    const easy = fresh();
    const hard = fresh();
    decay(easy, IDLE);
    decay(hard, { ...IDLE, exertion: 2.5 });
    expect(hard.energy).toBeLessThan(easy.energy);
    expect(hard.hygiene).toBeLessThan(easy.hygiene);
  });

  it("punishes standing in the rain without cover", () => {
    const dry = fresh();
    const wet = fresh();
    decay(dry, IDLE);
    decay(wet, { ...IDLE, soaked: true });
    expect(wet.health).toBeLessThan(dry.health);
    expect(wet.morale).toBeLessThan(dry.morale);
  });

  it("never leaves a meter out of range", () => {
    const m = fresh({ hunger: 1, thirst: 1, hygiene: 1, energy: 1, morale: 1, health: 1 });
    for (let i = 0; i < 50; i++) decay(m, { ...IDLE, soaked: true, sick: true });
    for (const id of METER_ORDER) {
      expect(m[id]).toBeGreaterThanOrEqual(0);
      expect(m[id]).toBeLessThanOrEqual(100);
    }
  });

  it("reports the delta it applied", () => {
    const m = fresh();
    const d = decay(m, IDLE);
    expect(d.thirst).toBeLessThan(0);
    expect(m.thirst).toBeCloseTo(80 + d.thirst!, 5);
  });
});
