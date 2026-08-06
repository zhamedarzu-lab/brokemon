import { describe, expect, it } from "vitest";
import { Rng } from "./rng";
import { createState } from "./state";
import { advance, policeCheck } from "./tick";
import { markerPos } from "../world/map";

const HOUR = 60;

/** A player who has eaten and drunk, so a full day passes without a collapse. */
function fed(seed = 1) {
  const s = createState(seed);
  s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
  return s;
}

describe("advance", () => {
  it("moves the clock forward", () => {
    const s = createState(1);
    const before = s.time;
    advance(s, new Rng(1), { minutes: 90 });
    expect(s.time).toBe(before + 90);
  });

  it("wears the body down over a day of walking", () => {
    const s = createState(1);
    s.meters.hunger = 100;
    s.meters.thirst = 100;
    advance(s, new Rng(1), { minutes: 8 * HOUR });
    expect(s.meters.hunger).toBeLessThan(100);
    expect(s.meters.thirst).toBeLessThan(100);
  });

  it("compounds interest on the debt each day", () => {
    const s = fed();
    s.debt = 1000;
    advance(s, new Rng(1), { minutes: 24 * HOUR });
    expect(s.debt).toBeGreaterThan(1000);
  });

  it("collapses you into the clinic when health runs out", () => {
    const s = createState(1);
    s.meters.health = 1;
    s.meters.hunger = 0;
    s.meters.thirst = 0;
    const interrupts = advance(s, new Rng(1), { minutes: 6 * HOUR });
    expect(interrupts.some((i) => i.kind === "collapse")).toBe(true);
    expect(s.collapses).toBe(1);
    expect(s.meters.health).toBeGreaterThan(0);
  });

  it("charges rent on the due day and evicts when you can't pay", () => {
    const s = fed();
    s.housing = "trailer";
    s.rentDueDay = 2;
    s.cash = 0;
    s.bank = 0;
    const interrupts = advance(s, new Rng(1), { minutes: 24 * HOUR });
    expect(interrupts.some((i) => i.kind === "rent" && !i.paid)).toBe(true);
    expect(s.housing).toBe("street");
    expect(s.debt).toBeGreaterThan(createState(1).debt);
  });

  it("takes rent out of savings when cash is short", () => {
    const s = fed();
    s.housing = "trailer";
    s.rentDueDay = 2;
    s.cash = 10;
    s.bank = 500;
    advance(s, new Rng(1), { minutes: 24 * HOUR });
    expect(s.housing).toBe("trailer");
    expect(s.cash + s.bank).toBeLessThan(510);
  });

  it("resets the daily gig allowance overnight", () => {
    const s = fed();
    s.gigsToday.dayLabor = 1;
    advance(s, new Rng(1), { minutes: 24 * HOUR });
    expect(s.gigsToday.dayLabor ?? 0).toBe(0);
  });

  it("logs the first time a meter crosses a warning line", () => {
    const s = createState(1);
    s.meters.thirst = 26;
    advance(s, new Rng(1), { minutes: 30 });
    const warnings = s.log.filter((l) => l.tone === "bad");
    expect(warnings.length).toBeGreaterThan(0);
    const count = warnings.length;
    advance(s, new Rng(1), { minutes: 30 });
    expect(s.log.filter((l) => l.text === warnings[0]!.text)).toHaveLength(1);
    expect(count).toBeGreaterThan(0);
  });
});

describe("policeCheck", () => {
  const heightsTile = { x: 20, y: 12 };

  it("ignores you in the outskirts however you look", () => {
    const s = createState(1);
    s.meters.hygiene = 0;
    s.player.pos = { ...markerPos("spawn") };
    for (let i = 0; i < 20; i++) {
      s.lastPoliceCheck = -10_000;
      expect(policeCheck(s, new Rng(i))).toBeNull();
    }
  });

  it("stops a filthy player up in the Heights", () => {
    const s = createState(1);
    s.meters.hygiene = 5;
    s.player.pos = { ...heightsTile };

    let stopped = false;
    for (let i = 0; i < 30 && !stopped; i++) {
      s.lastPoliceCheck = -10_000;
      stopped = policeCheck(s, new Rng(i)) !== null;
    }
    expect(stopped).toBe(true);
  });

  it("leaves a well-turned-out player alone in the Heights", () => {
    const s = createState(1);
    s.meters.hygiene = 100;
    s.wearing = "tailored";
    s.player.pos = { ...heightsTile };
    for (let i = 0; i < 30; i++) {
      s.lastPoliceCheck = -10_000;
      expect(policeCheck(s, new Rng(i))).toBeNull();
    }
  });

  it("has a cooldown so one walk isn't a stack of tickets", () => {
    const s = createState(1);
    s.meters.hygiene = 0;
    s.player.pos = { ...heightsTile };
    s.lastPoliceCheck = s.time;
    expect(policeCheck(s, new Rng(3))).toBeNull();
  });
});
