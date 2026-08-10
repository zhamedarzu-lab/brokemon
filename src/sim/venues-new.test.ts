import { describe, expect, it } from "vitest";
import { STARTING_TOWN, markerPos, townById } from "../world/map";
/** These bots only ever walk Brokemon Town. */
const TOWN = townById(STARTING_TOWN);

import { interact } from "./actions";
import { countOf } from "./items";
import type { Choice, Prompt } from "./prompt";
import { Rng } from "./rng";
import { createState, type GameState } from "./state";
import { advance } from "./tick";
import { minutesUntilHour } from "./time";
import { type ActionCtx } from "./work";

class Player {
  readonly s: GameState;
  readonly rng: Rng;
  readonly ctx: ActionCtx;

  constructor(seed = 1) {
    this.s = createState(seed);
    this.rng = new Rng(seed);
    this.ctx = {
      state: this.s,
      rng: this.rng,
      advance: (m, o) => void advance(this.s, this.rng, { minutes: m, ...o }),
      teleport: (x, y) => { this.s.player.pos = { x, y }; },
    };
  }

  goto(marker: string) {
    const p = markerPos(TOWN, marker);
    this.s.player.pos = { x: p.x, y: p.y };
  }

  waitUntil(hour: number) {
    const m = minutesUntilHour(this.s.time, hour);
    if (m > 0 && m < 24 * 60) this.ctx.advance(m);
  }

  press(): Prompt | null { return interact(this.ctx); }

  drive(p: Prompt | null, ...path: string[]): Prompt | null {
    let cur = p;
    for (const step of path) {
      if (!cur?.choices) return cur;
      const c: Choice | undefined = cur.choices.find(
        (q) => !q.locked && q.label.toLowerCase().includes(step.toLowerCase()));
      if (!c) return null;
      cur = c.run?.() ?? null;
    }
    return cur;
  }

  can(p: Prompt | null, label: string): boolean {
    return Boolean(p?.choices?.some(c => !c.locked && c.label.toLowerCase().includes(label.toLowerCase())));
  }
}

/* ------------------------------------------------------------------ diner */

/** Options a shut door still offers: the bins outside it, and the way out. */
function waysIn(prompt: Prompt | null): string[] {
  return (prompt?.choices ?? [])
    .filter((c) => !c.locked)
    .map((c) => c.label)
    .filter((label) => !/bins|leave|walk on|close the lid/i.test(label));
}

describe("diner venue", () => {
  it("is closed before 6AM", () => {
    const bot = new Player(1);
    // Start at 7AM, advance back… easier: set time to 3AM
    bot.s.time = 3 * 60;
    bot.goto("diner");
    const p = bot.press();
    expect(p?.title).toBe("Route 1 Diner");
    expect(p?.lines[0]).toMatch(/closed/i);
    // The bins out back are outside the building, so a shut door still leaves
    // them — but nothing that is a way in.
    expect(waysIn(p)).toEqual([]);
  });

  it("is closed after 10PM", () => {
    const bot = new Player(2);
    bot.s.time = 23 * 60; // 11PM
    bot.goto("diner");
    const p = bot.press();
    expect(p?.lines[0]).toMatch(/closed/i);
  });

  it("shows hot meal, coffee, and tap water when open", () => {
    const bot = new Player(3);
    bot.s.cash = 50;
    bot.s.bodyClean = 70;
    bot.s.clothesClean = 70;
    bot.waitUntil(9);
    bot.goto("diner");
    const p = bot.press();
    expect(bot.can(p, "hot meal")).toBe(true);
    expect(bot.can(p, "coffee")).toBe(true);
    expect(bot.can(p, "tap water")).toBe(true);
  });

  it("hot meal is locked when player can't afford it", () => {
    const bot = new Player(4);
    bot.s.cash = 0;
    bot.s.bodyClean = 70;
    bot.s.clothesClean = 70;
    bot.waitUntil(9);
    bot.goto("diner");
    const p = bot.press();
    const hotMealChoice = p?.choices?.find(c => c.label.toLowerCase().includes("hot meal"));
    expect(hotMealChoice).toBeDefined();
    expect(hotMealChoice?.locked).toBeTruthy();
  });

  it("eating a hot meal raises hunger and morale", () => {
    const bot = new Player(5);
    bot.s.cash = 50;
    bot.s.bodyClean = 70;
    bot.s.clothesClean = 70;
    bot.s.meters.hunger = 30;
    bot.s.meters.morale = 30;
    bot.waitUntil(9);
    bot.goto("diner");
    bot.drive(bot.press(), "hot meal");
    expect(bot.s.meters.hunger).toBeGreaterThan(30);
    expect(bot.s.meters.morale).toBeGreaterThan(30);
    expect(bot.s.cash).toBe(34); // 50 - 16
  });

  it("getting coffee raises energy", () => {
    const bot = new Player(6);
    bot.s.cash = 10;
    bot.s.bodyClean = 70;
    bot.s.clothesClean = 70;
    bot.s.meters.energy = 40;
    bot.waitUntil(9);
    bot.goto("diner");
    bot.drive(bot.press(), "coffee");
    expect(bot.s.meters.energy).toBeGreaterThan(40);
    expect(bot.s.cash).toBe(7); // 10 - 3
  });

  it("tap water is free and raises thirst", () => {
    const bot = new Player(7);
    bot.s.cash = 0;
    bot.s.bodyClean = 70;
    bot.s.clothesClean = 70;
    bot.s.meters.thirst = 20;
    bot.waitUntil(9);
    bot.goto("diner");
    bot.drive(bot.press(), "tap water");
    expect(bot.s.meters.thirst).toBeGreaterThan(20);
    expect(bot.s.cash).toBe(0); // free
  });

  it("logs the purchase", () => {
    const bot = new Player(8);
    bot.s.cash = 20;
    bot.s.bodyClean = 70;
    bot.s.clothesClean = 70;
    bot.waitUntil(9);
    bot.goto("diner");
    bot.drive(bot.press(), "hot meal");
    expect(bot.s.log.some(l => l.text.includes("Hot meal"))).toBe(true);
  });
});

/* --------------------------------------------------- outskirts bus stop */

describe("outskirts bus stop", () => {
  it("shows Market Square ride option", () => {
    const bot = new Player(10);
    bot.s.cash = 10;
    bot.goto("outskirtsBusStop");
    const p = bot.press();
    expect(p?.title).toContain("Outskirts");
    expect(bot.can(p, "market square")).toBe(true);
  });

  it("Market Square ride is locked without fare or pass", () => {
    const bot = new Player(11);
    bot.s.cash = 0;
    bot.goto("outskirtsBusStop");
    const p = bot.press();
    const msChoice = p?.choices?.find(c => c.label.toLowerCase().includes("market square") && !c.locked?.includes("here"));
    expect(msChoice?.locked).toBeTruthy();
  });

  it("riding to Market Square teleports the player and costs $3", () => {
    const bot = new Player(12);
    bot.s.cash = 10;
    bot.goto("outskirtsBusStop");
    bot.drive(bot.press(), "market square");
    const busPos = markerPos(TOWN, "busStop");
    expect(bot.s.player.pos.x).toBe(busPos.x);
    expect(bot.s.player.pos.y).toBe(busPos.y);
    expect(bot.s.cash).toBe(7); // 10 - 3
  });

  it("pass holder rides for free", () => {
    const bot = new Player(13);
    bot.s.cash = 0;
    bot.s.inventory.busPass = 1;
    bot.s.busPassDaysLeft = 7;
    bot.goto("outskirtsBusStop");
    const cashBefore = bot.s.cash;
    bot.drive(bot.press(), "market square");
    expect(bot.s.cash).toBe(cashBefore);
  });

  it("Wait option advances time", () => {
    const bot = new Player(14);
    bot.goto("outskirtsBusStop");
    const timeBefore = bot.s.time;
    bot.drive(bot.press(), "wait");
    expect(bot.s.time).toBeGreaterThan(timeBefore);
  });

  it("Market Square bus drops you at the outskirts stop", () => {
    const bot = new Player(15);
    bot.s.cash = 10;
    bot.goto("busStop");
    bot.drive(bot.press(), "the outskirts");
    const stopPos = markerPos(TOWN, "outskirtsBusStop");
    expect(bot.s.player.pos.x).toBe(stopPos.x);
    expect(bot.s.player.pos.y).toBe(stopPos.y);
  });
});

/* ------------------------------------------------- bus pass expiry */

describe("bus pass expiry", () => {
  it("pass disappears from inventory after 7 days", () => {
    const bot = new Player(20);
    bot.s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    bot.s.inventory.busPass = 1;
    bot.s.busPassDaysLeft = 1; // expires after the next day rollover
    bot.ctx.advance(24 * 60); // advance one full day
    expect(countOf(bot.s.inventory, "busPass")).toBe(0);
    expect(bot.s.busPassDaysLeft).toBe(0);
  });

  it("logs expiry message", () => {
    const bot = new Player(21);
    bot.s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    bot.s.inventory.busPass = 1;
    bot.s.busPassDaysLeft = 1;
    bot.ctx.advance(24 * 60);
    expect(bot.s.log.some(l => l.text.includes("bus pass has expired"))).toBe(true);
  });

  it("pass stays if not yet expired", () => {
    const bot = new Player(22);
    bot.s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    bot.s.inventory.busPass = 1;
    bot.s.busPassDaysLeft = 5; // expires in 5 days
    bot.ctx.advance(24 * 60); // only 1 day
    expect(countOf(bot.s.inventory, "busPass")).toBe(1);
  });

  it("buying a bus pass at the Mart sets the expiry counter", () => {
    const bot = new Player(23);
    bot.s.cash = 50;
    bot.s.meters = { hunger: 80, thirst: 80, hygiene: 70, energy: 80, morale: 70, health: 80 };
    bot.s.bodyClean = 70;
    bot.s.clothesClean = 70;
    bot.s.wearing = "thrift";
    bot.s.wardrobe.push("thrift");
    bot.waitUntil(9);
    bot.goto("mart");
    bot.drive(bot.press(), "buy something", "weekly bus pass");
    expect(countOf(bot.s.inventory, "busPass")).toBe(1);
    expect(bot.s.busPassDaysLeft).toBe(7);
  });

  it("diner marker exists on the map", () => {
    expect(() => markerPos(TOWN, "diner")).not.toThrow();
  });

  it("outskirtsBusStop marker exists on the map", () => {
    expect(() => markerPos(TOWN, "outskirtsBusStop")).not.toThrow();
  });
});
