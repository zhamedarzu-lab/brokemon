import { describe, expect, it } from "vitest";
import { Rng } from "./rng";
import { createState } from "./state";
import { advance, policeCheck } from "./tick";
import { markerPos } from "../world/map";
import { sleep as sleepIn, workShift } from "./work";
import { minutesUntilHour } from "./time";

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

  it("pays the franchise and the mayor's salary overnight", () => {
    // This used to live in the renderer, where no test could reach it and a
    // headless run earned nothing from either.
    const s = fed();
    s.businessOwned = true;
    s.mayor = true;
    const before = s.bank;
    const interrupts = advance(s, new Rng(1), { minutes: 24 * HOUR });
    expect(s.bank).toBeGreaterThan(before);
    expect(interrupts.some((i) => i.kind === "income")).toBe(true);
  });

  it("pays nothing overnight when you own nothing", () => {
    const s = fed();
    const before = s.bank;
    const interrupts = advance(s, new Rng(1), { minutes: 24 * HOUR });
    expect(s.bank).toBe(before);
    expect(interrupts.some((i) => i.kind === "income")).toBe(false);
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

describe("bus pass expiry", () => {
  it("decrements busPassDaysLeft each day", () => {
    const s = fed();
    s.inventory.busPass = 1;
    s.busPassDaysLeft = 7;
    advance(s, new Rng(1), { minutes: 24 * HOUR });
    expect(s.busPassDaysLeft).toBe(6);
    expect(s.inventory.busPass).toBe(1);
  });

  it("removes the bus pass from inventory when the counter hits zero", () => {
    const s = fed();
    s.inventory.busPass = 1;
    s.busPassDaysLeft = 1;
    advance(s, new Rng(1), { minutes: 24 * HOUR });
    expect(s.busPassDaysLeft).toBe(0);
    expect(s.inventory.busPass).toBeUndefined();
  });

  it("logs a message when the pass expires", () => {
    const s = fed();
    s.inventory.busPass = 1;
    s.busPassDaysLeft = 1;
    advance(s, new Rng(1), { minutes: 24 * HOUR });
    expect(s.log.some((l) => l.text.toLowerCase().includes("expired"))).toBe(true);
  });

  it("does not touch inventory when busPassDaysLeft is already zero", () => {
    const s = fed();
    s.busPassDaysLeft = 0;
    advance(s, new Rng(1), { minutes: 24 * HOUR });
    expect(s.inventory.busPass).toBeUndefined();
  });
});

describe("credit score", () => {
  function drift(setup: (s: ReturnType<typeof fed>) => void, days = 120): number {
    const s = fed();
    s.debt = 0;
    setup(s);
    const rng = new Rng(1);
    // Hour at a time, topping up as we go — a collapse would put a clinic bill
    // on the debt and drag the score down to the in-arrears ceiling.
    for (let h = 0; h < days * 24; h++) {
      s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
      advance(s, rng, { minutes: 60, sheltered: true });
    }
    return s.credit;
  }

  it("stops at 700 for someone debt-free with nothing put by", () => {
    expect(drift(() => {})).toBe(700);
  });

  it("counts the index fund as savings", () => {
    // The estate wants 720 and the ceiling without savings is 700, so reading
    // the current account alone meant taking the bank's own investment advice
    // locked you out of the ending.
    expect(drift((s) => void (s.bank = 5_000))).toBe(790);
    expect(drift((s) => void (s.investments = 5_000))).toBe(790);
  });

  it("keeps the estate reachable for someone fully invested", () => {
    expect(drift((s) => void (s.investments = 40_000))).toBeGreaterThanOrEqual(720);
  });
});

describe("sleep", () => {
  function bedded(hour: number) {
    const s = fed();
    s.time = hour * 60;
    s.meters.energy = 20;
    const rng = new Rng(1);
    const ctx = {
      state: s,
      rng,
      advance: (m: number, o?: Parameters<typeof advance>[2]) => void advance(s, rng, { ...o, minutes: m }),
      teleport: () => {},
    };
    const t0 = s.time;
    sleepIn(ctx, "hostel", 7);
    return { s, slept: (s.time - t0) / 60 };
  }

  it("sleeps through the night when there is a night left to sleep", () => {
    expect(bedded(22).slept).toBe(9);
    expect(bedded(2).slept).toBe(5);
  });

  it("gives you a nap, not a lost day, when you lie down after morning", () => {
    // "Until 7AM" once meant twenty-three hours if you lay down at eight, and
    // you woke up starving on the far side of a day you never played.
    const morning = bedded(8);
    expect(morning.slept).toBeLessThanOrEqual(4);
    expect(morning.s.meters.hunger).toBeGreaterThan(70);
    expect(bedded(13).slept).toBeLessThanOrEqual(4);
  });

  it("pays back rest by the hour, so a nap is not a night", () => {
    // Lying down at 7AM used to buy a whole night's energy for thirty minutes.
    const nap = bedded(6.5);
    const night = bedded(22);
    expect(nap.slept).toBeLessThan(1);
    expect(nap.s.meters.energy - 20).toBeLessThan((night.s.meters.energy - 20) / 4);
  });
});

describe("shift rota", () => {
  function nightlyStocker() {
    const s = fed();
    s.employment = "nightStock";
    s.wearing = "thrift";
    s.wardrobe.push("thrift");
    const rng = new Rng(1);
    const ctx = {
      state: s,
      rng,
      advance: (m: number, o?: Parameters<typeof advance>[2]) => {
        advance(s, rng, { ...o, minutes: m });
        s.meters = { hunger: 100, thirst: 100, hygiene: 90, energy: 100, morale: 80, health: 100 };
      },
      teleport: () => {},
    };
    const wind = (h: number) => ctx.advance(minutesUntilHour(s.time, h));
    wind(22);
    let worked = 0;
    for (let n = 0; n < 6; n++) {
      const before = s.shiftsWorked.nightStock ?? 0;
      workShift(ctx, "nightStock");
      if ((s.shiftsWorked.nightStock ?? 0) > before) worked += 1;
      wind(22);
    }
    return worked;
  }

  it("lets the overnight crew work every night, not every other one", () => {
    // The 10PM–3AM shift finishes on the next calendar day, and stamping it
    // with that day made the following night read as "already worked today".
    expect(nightlyStocker()).toBe(6);
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
      s.lastMovedTime = -10_000; // simulate the player standing still for a long time
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
