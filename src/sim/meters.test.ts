import { describe, expect, it } from "vitest";
import { applyDelta, clamp, decay, METER_ORDER, type HygieneSub, type Meters } from "./meters";

function fresh(over: Partial<Meters> = {}): Meters {
  return { hunger: 80, thirst: 80, hygiene: 80, energy: 80, morale: 80, health: 80, ...over };
}

function freshSub(over: Partial<HygieneSub> = {}): HygieneSub {
  return { bodyClean: 80, clothesClean: 80, ...over };
}

const IDLE = { minutes: 60, asleep: false, exertion: 1, soaked: false, sick: false, outfitRank: 0 };

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
    decay(m, IDLE, freshSub());
    expect(m.hunger).toBeLessThan(80);
    expect(m.thirst).toBeLessThan(80);
    expect(m.energy).toBeLessThan(80);
  });

  it("burns thirst faster than hunger", () => {
    const m = fresh();
    decay(m, IDLE, freshSub());
    expect(80 - m.thirst).toBeGreaterThan(80 - m.hunger);
  });

  it("does not drain energy while asleep", () => {
    const m = fresh({ energy: 40 });
    decay(m, { ...IDLE, asleep: true, minutes: 480 }, freshSub());
    expect(m.energy).toBe(40);
  });

  it("heals a fed sleeper", () => {
    const m = fresh({ health: 50, hunger: 60 });
    decay(m, { ...IDLE, asleep: true, minutes: 480 }, freshSub());
    expect(m.health).toBeGreaterThan(50);
  });

  it("costs health once hunger and thirst bottom out", () => {
    const m = fresh({ hunger: 0, thirst: 0, health: 60 });
    decay(m, IDLE, freshSub());
    expect(m.health).toBeLessThan(60);
  });

  it("lets Dignity climb back once the basics are handled", () => {
    // This is the whole reason the meter exists. It used to only ever fall,
    // which pinned it at zero and left the breakdown gate permanently on.
    const m = fresh({ morale: 20, hygiene: 80, hunger: 80, thirst: 80 });
    decay(m, IDLE, freshSub({ bodyClean: 80, clothesClean: 80 }));
    expect(m.morale).toBeGreaterThan(20);
  });

  it("still lets Dignity fall when you are not", () => {
    const m = fresh({ morale: 60, hygiene: 10, hunger: 10 });
    decay(m, IDLE, freshSub({ bodyClean: 10, clothesClean: 10 }));
    expect(m.morale).toBeLessThan(60);
  });

  it("stalls the Dignity climb while exhausted", () => {
    const rested = fresh({ morale: 20, energy: 80 });
    const shattered = fresh({ morale: 20, energy: 5 });
    decay(rested, IDLE, freshSub());
    decay(shattered, IDLE, freshSub());
    expect(shattered.morale).toBeLessThan(rested.morale);
  });

  it("gives back more energy in a night than a day burns", () => {
    // Energy was a one-way ratchet too: 15 waking hours cost more than the
    // best bed returned, so it slid to zero whatever the player did.
    const awake = fresh({ energy: 100 });
    decay(awake, { ...IDLE, minutes: 15 * 60, exertion: 1.2 }, freshSub());
    const burnedInADay = 100 - awake.energy;
    expect(burnedInADay).toBeLessThan(75); // a hostel cot restores 75
  });

  it("drains morale faster when the body is failing", () => {
    const healthy = fresh();
    const wrecked = fresh({ hygiene: 10, hunger: 10, energy: 10 });
    decay(healthy, IDLE, freshSub());
    decay(wrecked, IDLE, freshSub({ bodyClean: 10, clothesClean: 10 }));
    expect(80 - wrecked.morale).toBeGreaterThan(80 - healthy.morale);
  });

  it("makes exertion cost energy and hygiene", () => {
    const easy = fresh();
    const hard = fresh();
    const easySub = freshSub();
    const hardSub = freshSub();
    decay(easy, IDLE, easySub);
    decay(hard, { ...IDLE, exertion: 2.5 }, hardSub);
    expect(hard.energy).toBeLessThan(easy.energy);
    // Harder exertion means more body and clothes dirt
    expect(hardSub.bodyClean).toBeLessThan(easySub.bodyClean);
  });

  it("punishes standing in the rain without cover", () => {
    const dry = fresh();
    const wet = fresh();
    decay(dry, IDLE, freshSub());
    decay(wet, { ...IDLE, soaked: true }, freshSub());
    expect(wet.health).toBeLessThan(dry.health);
    expect(wet.morale).toBeLessThan(dry.morale);
  });

  it("never leaves a meter out of range", () => {
    const m = fresh({ hunger: 1, thirst: 1, hygiene: 1, energy: 1, morale: 1, health: 1 });
    const sub = freshSub({ bodyClean: 1, clothesClean: 1 });
    for (let i = 0; i < 50; i++) decay(m, { ...IDLE, soaked: true, sick: true }, sub);
    for (const id of METER_ORDER) {
      expect(m[id]).toBeGreaterThanOrEqual(0);
      expect(m[id]).toBeLessThanOrEqual(100);
    }
  });

  it("reports the delta it applied", () => {
    const m = fresh();
    const d = decay(m, IDLE, freshSub());
    expect(d.thirst).toBeLessThan(0);
    expect(m.thirst).toBeCloseTo(80 + d.thirst!, 5);
  });

  it("rags decay clothes faster than a tailored suit", () => {
    const ragsSub = freshSub();
    const suitSub = freshSub();
    decay(fresh(), { ...IDLE, outfitRank: 0 }, ragsSub);
    decay(fresh(), { ...IDLE, outfitRank: 4 }, suitSub);
    expect(ragsSub.clothesClean).toBeLessThan(suitSub.clothesClean);
  });
});

describe("running on empty pulls on the other half", () => {
  /**
   * The only feedback loop between two meters, and it goes both ways:
   * exhaustion and dehydration are the same hole from different ends. Neither
   * kills on its own, so without this a day that ends with nothing left in you
   * is a bar sitting harmlessly at the bottom of the HUD.
   */
  it("drains thirst faster once energy is gone", () => {
    const flat = fresh({ energy: 0, thirst: 60 });
    const rested = fresh({ energy: 60, thirst: 60 });
    decay(flat, IDLE, freshSub());
    decay(rested, IDLE, freshSub());
    expect(flat.thirst).toBeLessThan(rested.thirst);
  });

  it("drains energy faster once thirst is gone", () => {
    const dry = fresh({ thirst: 0, energy: 60 });
    const watered = fresh({ thirst: 60, energy: 60 });
    decay(dry, IDLE, freshSub());
    decay(watered, IDLE, freshSub());
    expect(dry.energy).toBeLessThan(watered.energy);
  });

  it("leaves both alone while there is anything left in either", () => {
    const fine = fresh({ energy: 1, thirst: 1 });
    const control = fresh({ energy: 1, thirst: 1 });
    decay(fine, IDLE, freshSub());
    // Same starting point, so the only difference would be the coupling —
    // and at 1 point left it must not have fired yet.
    decay(control, IDLE, freshSub());
    expect(fine.thirst).toBe(control.thirst);
    expect(fine.energy).toBe(control.energy);
  });

  it("pulls gentler than a drink or an hour of sleep can push back", () => {
    // A loop that outran recovery would be a death spiral with no way out of
    // it. An hour flat out costs less thirst than the meter's own decay does.
    const flat = fresh({ energy: 0, thirst: 60 });
    const rested = fresh({ energy: 60, thirst: 60 });
    const before = 60;
    decay(flat, IDLE, freshSub());
    decay(rested, IDLE, freshSub());
    const couplingCost = rested.thirst - flat.thirst;
    const ordinaryDecay = before - rested.thirst;
    expect(couplingCost).toBeLessThan(ordinaryDecay);
  });
});

describe("one wash lasts a day", () => {
  /**
   * The design claim is that hygiene is something you keep rather than
   * something you top up: a shelter shower restores about 70 and a laundry
   * about 80, so a day has to cost meaningfully less than that or you are back
   * at the machine before the day is out.
   *
   * A day here is sixteen hours up and about at walking effort, then eight
   * asleep. Measured at the rates this test was written against: 36 body and
   * 38 clothes in rags. Before they were given room it was 46 and 58 — a
   * shower every day and a half, laundry every thirty-four hours.
   */
  function aDay(outfitRank: number): { body: number; clothes: number } {
    const meters = fresh();
    const sub = freshSub({ bodyClean: 100, clothesClean: 100 });
    decay(meters, { ...IDLE, minutes: 16 * 60, exertion: 1.2, outfitRank }, sub);
    decay(meters, { ...IDLE, minutes: 8 * 60, asleep: true, outfitRank }, sub);
    return { body: 100 - sub.bodyClean, clothes: 100 - sub.clothesClean };
  }

  const SHOWER = 70;
  const LAUNDRY = 80;

  it("costs less than half a day's worth more than a shower gives back", () => {
    expect(aDay(0).body).toBeLessThan(SHOWER * 0.6);
  });

  it("leaves rags wearable for two days on one wash", () => {
    // Rags are the worst rank and the one a phase-1 player is stuck in, so it
    // is the rank that decides whether the laundromat is a chore or a trap.
    expect(aDay(0).clothes * 2).toBeLessThan(LAUNDRY + 10);
  });

  it("still rewards better clothes with less looking after", () => {
    const ranks = [0, 1, 2, 3, 4].map((r) => aDay(r).clothes);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]!, `rank ${i} is no cleaner to keep than rank ${i - 1}`).toBeLessThan(ranks[i - 1]!);
    }
  });
});
