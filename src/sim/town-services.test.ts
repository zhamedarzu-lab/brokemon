/**
 * The services a town has to have somewhere in it, checked over every town.
 *
 * Brokedale's whole design is that nothing in it is free — no food bank, no
 * free wash, no bench you can legally sleep on. That is a statement about
 * *charity*, and it kept being read as a statement about supply. The city
 * shipped with nowhere to buy food you could carry out of the shop and nowhere
 * at all that treated being ill, and both are the kind of hole you only see by
 * living there:
 *
 *  - The night market's tray is eaten standing at the stall, so a resident went
 *    out on an eight-hour depot shift with an empty bag and bottomed out at
 *    hunger 0 in the middle of it, most days of a 248-day run.
 *  - Nothing in the city cleared a fever. Health bled out until you collapsed,
 *    and collapsing was the only thing that cleared it — 25 collapses across
 *    five runs, every one of them with hunger and thirst perfectly fine.
 *
 * Checked by *doing* rather than by reading labels: run each choice and see
 * what ends up in the bag. The Mart hides its shelves behind "Buy something"
 * and behind a dress code, so anything that matches on button text either
 * misses it or has to know too much about it.
 */
import { describe, expect, it } from "vitest";
import { markerPos, TOWNS, townById } from "../world/map";
import { ITEMS, type ItemId } from "./items";
import type { Choice, Prompt } from "./prompt";
import { Rng } from "./rng";
import { createState, type GameState } from "./state";
import { advance } from "./tick";
import { VENUES } from "./venues";
import type { ActionCtx } from "./work";

/** Somebody with money, presentable enough to be served, and running a fever. */
function shopper(
  townId: string,
  marker: string,
  hour: number,
): { s: GameState; ctx: ActionCtx } {
  const town = townById(townId as never);
  const s = createState(4);
  s.player.town = townId as never;
  s.cash = 500;
  s.time = hour * 60;
  s.sick = true;
  s.meters.hygiene = 85;
  s.bodyClean = 85;
  s.clothesClean = 85;
  s.wardrobe.push("thrift");
  s.wearing = "thrift";
  s.player.pos = markerPos(town, marker);
  const rng = new Rng(4);
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

/** Food you can put in a bag and eat later. Bin food is not shopping. */
const CARRIABLE_FOOD = (Object.keys(ITEMS) as ItemId[]).filter(
  (id) => (ITEMS[id].effect?.hunger ?? 0) > 0 && id !== "trashFood",
);

/** Everything obtainable from a town's doors, within two menus of the street. */
function whatYouCanBuyIn(townId: string): Set<ItemId> {
  const town = townById(townId as never);
  const got = new Set<ItemId>();
  for (const marker of Object.keys(town.markers)) {
    if (!VENUES[marker]) continue;
    for (const hour of [9, 13, 19, 23]) {
      const follow = (path: number[]) => {
        const { s, ctx } = shopper(townId, marker, hour);
        let prompt: Prompt | null;
        try {
          prompt = VENUES[marker]!(ctx);
        } catch {
          return;
        }
        for (const index of path) {
          const choice: Choice | undefined = prompt?.choices?.[index];
          if (!choice || choice.locked || !choice.run) return;
          try {
            prompt = choice.run();
          } catch {
            return;
          }
        }
        for (const [id, n] of Object.entries(s.inventory))
          if ((n ?? 0) > 0) got.add(id as ItemId);
      };
      for (let first = 0; first < 14; first++) {
        follow([first]);
        for (let second = 0; second < 20; second++) follow([first, second]);
      }
    }
  }
  return got;
}

describe.each(Object.values(TOWNS).map((t) => [t.name, t.id] as const))(
  "%s",
  (_name, townId) => {
    const stock = whatYouCanBuyIn(townId);

    it("sells food you can carry out of the shop", () => {
      const carriable = CARRIABLE_FOOD.filter((id) => stock.has(id));
      expect(
        carriable.length,
        `${townId} sells nothing you can take to work — everything edible is eaten where you buy it`,
      ).toBeGreaterThan(0);
    });

    it("sells something that clears a fever", () => {
      // Being ill has exactly three ways out: medicine, a clinic, or collapsing.
      // A town with none of the first two leaves only the third, which costs
      // $100 of debt and a day, and does not stop it happening again next week.
      expect(
        stock.has("medicine"),
        `${townId} has nowhere to treat a fever`,
      ).toBe(true);
    });

    it("sells water", () => {
      expect(stock.has("waterBottle"), `${townId} sells nothing to drink`).toBe(
        true,
      );
    });
  },
);
