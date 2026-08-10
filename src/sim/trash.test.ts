/**
 * The bins.
 *
 * Cans are a dollar each at the depot, which makes this the bottom rung of the
 * whole economy: a player with no job they can pass the door requirement for
 * still has a round to walk. Two things have to hold or it stops being a
 * decision and goes back to being a payout screen.
 */
import { describe, expect, it } from "vitest";
import { markerPos, townById } from "../world/map";
import { countOf } from "./items";
import type { Prompt } from "./prompt";
import { Rng } from "./rng";
import { createState, type GameState } from "./state";
import { advance } from "./tick";
import { VENUES, TRASH_DOORS } from "./venues";
import { searchTrash, STREET_DUMPSTER, venueTrashKey, type ActionCtx, type TrashSpec } from "./work";

function bot(seed = 5): { s: GameState; ctx: ActionCtx } {
  const s = createState(seed);
  const rng = new Rng(seed);
  s.cash = 40;
  return {
    s,
    ctx: {
      state: s,
      rng,
      advance: (m, o) => void advance(s, rng, { minutes: m, ...o }),
      teleport: (x, y) => {
        s.player.pos = { x, y };
      },
    },
  };
}

function labels(p: Prompt | null): string[] {
  return (p?.choices ?? []).map((c) => c.label);
}

/** Force the roll: a bin that is all food, or a bin that is all cans. */
const ALL_FOOD: TrashSpec = { ...STREET_DUMPSTER, food: 1, cans: [3, 3] };
const ALL_CANS: TrashSpec = { ...STREET_DUMPSTER, food: 0, cans: [3, 3] };

describe("food out of a bin is a decision", () => {
  it("offers it rather than putting it in your bag", () => {
    const { s, ctx } = bot();
    const before = countOf(s.inventory, "trashFood");
    const prompt = searchTrash(ctx, "bin:test", ALL_FOOD);
    expect(countOf(s.inventory, "trashFood"), "the bin filled your bag before you answered").toBe(before);
    expect(labels(prompt)).toContain("Take it");
    expect(labels(prompt)).toContain("Leave it");
  });

  it("costs dignity when you take it", () => {
    const { s, ctx } = bot();
    s.meters.morale = 80;
    const prompt = searchTrash(ctx, "bin:test", ALL_FOOD);
    prompt.choices!.find((c) => c.label === "Take it")!.run!();
    expect(countOf(s.inventory, "trashFood")).toBe(1);
    expect(s.meters.morale).toBeLessThan(80);
  });

  it("costs more dignity once you have somewhere to sleep", () => {
    const onTheStreet = bot(5);
    onTheStreet.s.meters.morale = 80;
    const a = searchTrash(onTheStreet.ctx, "bin:test", ALL_FOOD);
    a.choices!.find((c) => c.label === "Take it")!.run!();

    const housed = bot(5);
    housed.s.meters.morale = 80;
    housed.s.housing.brokemon = "apartment";
    const b = searchTrash(housed.ctx, "bin:test", ALL_FOOD);
    b.choices!.find((c) => c.label === "Take it")!.run!();

    // The further you have climbed, the further this is back down.
    expect(housed.s.meters.morale).toBeLessThan(onTheStreet.s.meters.morale);
  });

  it("costs nothing but the walk if you leave it", () => {
    const { s, ctx } = bot();
    const cash = s.cash;
    const prompt = searchTrash(ctx, "bin:test", ALL_FOOD);
    prompt.choices!.find((c) => c.label === "Leave it")!.run!();
    expect(countOf(s.inventory, "trashFood")).toBe(0);
    expect(s.cash).toBe(cash);
  });
});

describe("a bin holds one thing", () => {
  it("gives cans without asking, because opening the lid was the decision", () => {
    const { s, ctx } = bot();
    searchTrash(ctx, "bin:test", ALL_CANS);
    expect(countOf(s.inventory, "recyclables")).toBe(3);
  });

  it("never pays out cans and food from the same rummage", () => {
    // Both at once made every search a payout screen rather than a find.
    for (let seed = 1; seed <= 40; seed++) {
      const { s, ctx } = bot(seed);
      const prompt = searchTrash(ctx, "bin:test", STREET_DUMPSTER);
      const offeredFood = labels(prompt).includes("Take it");
      const gotCans = countOf(s.inventory, "recyclables") > 0;
      expect(offeredFood && gotCans, `seed ${seed} found both at once`).toBe(false);
    }
  });

  it("never hands over money", () => {
    // A coin in a coat pocket is free money, and free money makes every
    // earlier decision about money retroactively pointless.
    for (let seed = 1; seed <= 40; seed++) {
      const { s, ctx } = bot(seed);
      const cash = s.cash;
      const prompt = searchTrash(ctx, "bin:test", STREET_DUMPSTER);
      for (const c of prompt.choices ?? []) c.run?.();
      expect(s.cash, `seed ${seed} found cash in a bin`).toBeLessThanOrEqual(cash);
    }
  });
});

describe("a bin refills on its own clock", () => {
  it("is not worth opening twice running", () => {
    const { ctx } = bot();
    searchTrash(ctx, "bin:test", ALL_CANS);
    const again = searchTrash(ctx, "bin:test", ALL_CANS);
    expect(again.lines.join(" ")).toContain("already been through");
  });

  it("is worth opening again once its own window has passed", () => {
    const { ctx } = bot();
    const slow: TrashSpec = { ...ALL_CANS, refillHours: 4 };
    searchTrash(ctx, "bin:test", slow);
    ctx.advance(5 * 60);
    expect(searchTrash(ctx, "bin:test", slow).lines.join(" ")).not.toContain("already been through");
  });

  it("keeps one clock per town, so the coach is not a way to double a round", () => {
    const { s } = bot();
    s.player.town = "brokemon";
    const here = venueTrashKey(s, "recycling");
    s.player.town = "brokedale";
    expect(venueTrashKey(s, "recycling")).not.toBe(here);
  });
});

describe("the doors with bins behind them", () => {
  it("all exist in one of the towns", () => {
    const drawn = new Set([...Object.keys(townById("brokemon").markers), ...Object.keys(townById("brokedale").markers)]);
    for (const marker of TRASH_DOORS) {
      expect(drawn.has(marker), `${marker} has bins but no town draws it`).toBe(true);
    }
  });

  it("offers the bins even when the door itself is shut", () => {
    // Refused at the counter or arriving after close is exactly when you want
    // what is round the back, and a rejection screen with something you can
    // still do on it is a better screen than one with no buttons.
    const { s, ctx } = bot();
    s.time = 3 * 60;
    s.player.pos = markerPos(townById("brokemon"), "diner");
    const prompt = VENUES.diner!(ctx);
    expect(labels(prompt)).toContain("Check the bins out back");
  });

  it("puts the bins below whatever the building itself offers", () => {
    const { s, ctx } = bot();
    s.time = 10 * 60;
    s.player.pos = markerPos(townById("brokemon"), "communityCenter");
    const shown = labels(VENUES.communityCenter!(ctx));
    expect(shown.indexOf("Check the bins out back")).toBeGreaterThan(shown.indexOf("Food bank"));
    expect(shown.indexOf("Check the bins out back")).toBeLessThan(shown.length - 1);
  });
});
