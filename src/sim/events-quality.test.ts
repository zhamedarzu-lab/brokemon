import { describe, expect, it } from "vitest";
import { BROKEMON_EVENTS, nearBy, NEAR_TILES, type EventDef } from "./events";
import { BROKEDALE_EVENTS } from "./events-brokedale";
import { PLACE_EVENTS } from "./events-places";
import { Rng } from "./rng";
import { createState, type GameState } from "./state";
import { addItem } from "./items";
import { advance } from "./tick";
import { markerPos, townById } from "../world/map";
import type { ActionCtx } from "./work";

const ALL: Array<[string, EventDef]> = [
  ...BROKEMON_EVENTS.map((e) => [`brokemon/${e.id}`, e] as [string, EventDef]),
  ...BROKEDALE_EVENTS.map((e) => [`brokedale/${e.id}`, e] as [string, EventDef]),
  ...PLACE_EVENTS.map((e) => [`place/${e.id}`, e] as [string, EventDef]),
];

function bot(seed = 5): { s: GameState; ctx: ActionCtx } {
  const s = createState(seed);
  const rng = new Rng(seed);
  s.cash = 120;
  s.meters = { hunger: 60, thirst: 60, hygiene: 55, energy: 60, morale: 55, health: 80 };
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

/**
 * Encounters that are a thing happening *to* you rather than a decision.
 *
 * The bar for being on this list is that no reasonable person would have a
 * choice: the sprinklers come on, the police stop you, somebody hands you
 * something and is gone. Everything else must be a decision, because an
 * encounter you answer by pressing the only button is a pop-up, and a game
 * made of pop-ups teaches the player to stop reading.
 */
const CONSEQUENCES = new Set([
  "brokemon/sprinklers",
  "brokemon/cyclistNearMiss",
  "brokedale/bd_showers",
]);

describe("every encounter is a decision", () => {
  it.each(ALL.filter(([name]) => !CONSEQUENCES.has(name)))("%s offers a real choice", (name, e) => {
    const { s, ctx } = bot();
    const prompt = e.build(ctx);
    const live = (prompt.choices ?? []).filter((c) => !c.locked);
    const total = prompt.choices?.length ?? 0;
    void s;
    // Either two ways to answer, or one live and one you cannot currently
    // afford — which is still a decision, just one you have already lost.
    expect(total, `${name} — "${prompt.title}" has nothing to decide`).toBeGreaterThan(1);
    expect(live.length, `${name} — "${prompt.title}" has no live choice at all`).toBeGreaterThan(0);
  });

  it("has no encounter whose only option is to acknowledge it", () => {
    // The archetype: "a paper bag blew past you" / "Move on". If it cannot
    // change anything, it is not worth stopping the player for.
    const popups = ALL.filter(([name, e]) => {
      if (CONSEQUENCES.has(name)) return false;
      const { ctx } = bot();
      return (e.build(ctx).choices ?? []).length <= 1;
    });
    expect(popups.map(([n]) => n)).toEqual([]);
  });
});

describe("no free money", () => {
  it.each(ALL)("%s never hands out cash for nothing", (name, e) => {
    const { s, ctx } = bot();
    const prompt = e.build(ctx);
    for (const choice of prompt.choices ?? []) {
      if (choice.locked || !choice.run) continue;
      const cash0 = s.cash;
      const t0 = s.time;
      const inv0 = JSON.stringify(s.inventory);
      const rep0 = JSON.stringify(s.reputation);
      try {
        choice.run();
      } catch {
        continue;
      }
      const gained = s.cash - cash0;
      if (gained <= 0) continue;
      const spentTime = s.time - t0 >= 5;
      const spentSomething = JSON.stringify(s.inventory) !== inv0 || JSON.stringify(s.reputation) !== rep0;
      expect(
        spentTime || spentSomething,
        `${name} — "${choice.label}" pays $${gained} and costs nothing: no time, no goods, no standing`,
      ).toBe(true);
    }
  });
});

describe("place encounters know where they are", () => {
  const BROKEMON = townById("brokemon");

  it("fires nothing when you are nowhere near the door", () => {
    const { s } = bot();
    const far = nearBy(BROKEMON, markerPos(BROKEMON, "spawn"));
    const live = PLACE_EVENTS.filter((e) => e.weight(s, "slums", far) > 0).map((e) => e.id);
    // The spawn corner is not outside the Mart, the bank or the college.
    for (const id of ["pl_beerRun", "pl_bankLetter", "pl_classmate"]) {
      expect(live, `${id} fired from the far side of town`).not.toContain(id);
    }
  });

  it("fires outside the door it belongs to", () => {
    const { s } = bot();
    s.time = 16 * 60;
    const outsideTheMart = nearBy(BROKEMON, markerPos(BROKEMON, "mart"));
    const live = PLACE_EVENTS.filter((e) => e.weight(s, "downtown", outsideTheMart) > 0).map((e) => e.id);
    expect(live).toContain("pl_beerRun");
  });

  it("counts near as a short walk, not the whole district", () => {
    const mart = markerPos(BROKEMON, "mart");
    const near = nearBy(BROKEMON, { x: mart.x + NEAR_TILES, y: mart.y });
    expect(near.has("mart")).toBe(true);
    const far = nearBy(BROKEMON, { x: mart.x + NEAR_TILES + 4, y: mart.y });
    expect(far.has("mart")).toBe(false);
  });

  it("owns the pavement outside its own door", () => {
    // Since a place event fires only when its marker is the *nearest* one, a
    // door standing next to a busier door would never get its own encounter.
    // Standing on the doorstep must always resolve to that door.
    for (const town of [townById("brokemon"), townById("brokedale")]) {
      for (const e of PLACE_EVENTS) {
        const p = town.markers[e.place!];
        if (!p) continue;
        expect(nearBy(town, p).closest, `${e.id}: standing at ${e.place} resolves to another door`).toBe(e.place);
      }
    }
  });

  it("has no encounter written so tightly it can never happen", () => {
    // A guard like "phase 3 and owns a bike and after nine" is easy to write
    // and impossible to satisfy. Sweep a spread of plausible saves across every
    // doorway in both towns; anything that never fires is dead text.
    const saves: Array<[string, (s: GameState) => void, number]> = [
      ["broke, morning", (s) => void (s.cash = 8), 9],
      ["broke, ill, night", (s) => {
        s.cash = 8;
        s.meters.hunger = 30;
        s.meters.health = 40;
      }, 21],
      ["trailer, night", (s) => {
        s.cash = 60;
        s.housing.brokemon = "trailer";
      }, 22],
      ["studying, phone and bike", (s) => {
        s.cash = 150;
        s.education = 2;
        s.debt = 300;
        addItem(s.inventory, "phone");
        addItem(s.inventory, "bicycle");
      }, 16],
      ["presentable", (s) => {
        s.cash = 150;
        s.wardrobe.push("smartCasual");
        s.wearing = "smartCasual";
        s.meters.hygiene = 80;
      }, 16],
      ["career, evening", (s) => {
        s.cash = 900;
        s.education = 6;
        s.housing.brokemon = "apartment";
        s.employment = "executive";
      }, 19],
      ["career, morning", (s) => {
        s.cash = 900;
        s.education = 6;
        s.housing.brokemon = "apartment";
        s.employment = "executive";
      }, 8],
      ["the estate", (s) => {
        s.cash = 5000;
        s.housing.brokemon = "estate";
        s.employment = "executive";
      }, 14],
      ["a room on the Row", (s) => {
        s.cash = 200;
        s.housing.brokedale = "room";
      }, 19],
    ];

    const fired = new Set<string>();
    for (const [, mutate, hour] of saves) {
      for (const town of [townById("brokemon"), townById("brokedale")]) {
        for (const marker of Object.keys(town.markers)) {
          const s = createState(3);
          s.player.town = town.id;
          s.player.pos = town.markers[marker]!;
          s.time = hour * 60;
          mutate(s);
          const near = nearBy(town, s.player.pos);
          for (const e of PLACE_EVENTS) if (e.weight(s, "downtown", near) > 0) fired.add(e.id);
        }
      }
    }
    const dead = PLACE_EVENTS.filter((e) => !fired.has(e.id)).map((e) => `${e.id} (at ${e.place})`);
    expect(dead, "written but unreachable under any plausible save").toEqual([]);
  });

  it("names a door that exists in one of the towns", () => {
    // Declared, not inferred: a guard like "only if you owe money" makes the
    // weight zero for a fresh save, so probing weights cannot tell a place
    // that does not exist from a condition that is not met today.
    const towns = [townById("brokemon"), townById("brokedale")];
    const placedMarkers = new Set(towns.flatMap((t) => Object.keys(t.markers)));
    for (const e of PLACE_EVENTS) {
      expect(e.place, `${e.id} does not say which door it happens at`).toBeTruthy();
      expect(placedMarkers.has(e.place!), `${e.id} points at "${e.place}", which no town draws`).toBe(true);
    }
  });
});

describe("nothing is given before you decide", () => {
  /**
   * Showing an encounter may set up a situation — you have already been
   * refused service, the sprinklers have already come on — but it may never
   * *give* you anything. That was the root of the pop-up problem rather than a
   * symptom of it: the nine encounters with a single "Move on" all put the
   * food in your bag inside `build()`, so the box was an acknowledgement of
   * something that had already happened and the button could only mean "yes".
   *
   * Setup can cost you. Only a choice can pay you.
   */
  it.each(ALL)("%s hands out nothing just by being shown", (name, e) => {
    const { s, ctx } = bot(9);
    const cash = s.cash;
    const inv = JSON.stringify(s.inventory);
    const wardrobe = JSON.stringify(s.wardrobe);
    e.build(ctx);
    expect(s.cash, `${name} pays you before you have chosen anything`).toBeLessThanOrEqual(cash);
    expect(JSON.stringify(s.inventory), `${name} fills your bag before you have chosen anything`).toBe(inv);
    expect(JSON.stringify(s.wardrobe), `${name} dresses you before you have chosen anything`).toBe(wardrobe);
  });
});
