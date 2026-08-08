import { describe, expect, it, beforeEach } from "vitest";
import { createState, housingIn, reputationIn } from "./state";
import { loadGame, saveGame } from "./save";
import { STARTING_TOWN } from "../world/map";

/** localStorage does not exist under vitest's default environment. */
function useMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  return store;
}

describe("save migration", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = useMemoryStorage();
  });

  it("round-trips a current save", () => {
    const s = createState(4);
    s.cash = 123;
    expect(saveGame(s)).toBe(true);
    const loaded = loadGame();
    expect(loaded?.cash).toBe(123);
    expect(loaded?.player.town).toBe(STARTING_TOWN);
  });

  it("puts a save written before towns were plural into the starting town", () => {
    // The merge is shallow, so a stored `player` replaces the fresh one whole.
    // Without a migration this left `player.town` undefined and every map
    // lookup asking for a town that does not exist.
    const legacy = JSON.parse(JSON.stringify(createState(9))) as Record<string, any>;
    const player = { ...legacy.player };
    delete player.town;
    legacy.player = player;
    store.set("brokemon.save.v1", JSON.stringify(legacy));

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.player.town).toBe(STARTING_TOWN);
  });

  it("repairs a save naming a town that no longer exists", () => {
    const legacy = JSON.parse(JSON.stringify(createState(9))) as Record<string, any>;
    legacy.player.town = "atlantis";
    store.set("brokemon.save.v1", JSON.stringify(legacy));
    expect(loadGame()!.player.town).toBe(STARTING_TOWN);
  });

  it("converts a save whose housing was a bare string", () => {
    // These four went from scalars to one-value-per-town. A stored scalar is
    // not a missing field, it is the wrong type, so the merge has to convert.
    const legacy = JSON.parse(JSON.stringify(createState(9))) as Record<string, any>;
    legacy.housing = "trailer";
    legacy.rentDueDay = 12;
    legacy.nightsPaid = 1;
    store.set("brokemon.save.v1", JSON.stringify(legacy));

    const loaded = loadGame()!;
    expect(housingIn(loaded, STARTING_TOWN)).toBe("trailer");
    expect(loaded.rentDueDay[STARTING_TOWN]).toBe(12);
    expect(loaded.nightsPaid[STARTING_TOWN]).toBe(1);
  });

  it("credits an old reputation to the town it was earned in", () => {
    const legacy = JSON.parse(JSON.stringify(createState(9))) as Record<string, any>;
    legacy.reputation = 64;
    store.set("brokemon.save.v1", JSON.stringify(legacy));

    const loaded = loadGame()!;
    expect(reputationIn(loaded, STARTING_TOWN)).toBe(64);
    for (const town of Object.keys(loaded.reputation) as Array<keyof typeof loaded.reputation>) {
      if (town !== STARTING_TOWN) expect(loaded.reputation[town]).toBe(0);
    }
  });

  it("leaves a save that already has records alone", () => {
    const s = createState(3);
    s.housing[STARTING_TOWN] = "apartment";
    s.reputation[STARTING_TOWN] = 40;
    saveGame(s);
    const loaded = loadGame()!;
    expect(housingIn(loaded, STARTING_TOWN)).toBe("apartment");
    expect(reputationIn(loaded, STARTING_TOWN)).toBe(40);
  });

  it("keeps the rest of the player when it migrates", () => {
    const legacy = JSON.parse(JSON.stringify(createState(9))) as Record<string, any>;
    const player = { ...legacy.player, pos: { x: 12, y: 34 }, facing: "left" };
    delete player.town;
    legacy.player = player;
    store.set("brokemon.save.v1", JSON.stringify(legacy));

    const loaded = loadGame()!;
    expect(loaded.player.pos).toEqual({ x: 12, y: 34 });
    expect(loaded.player.facing).toBe("left");
  });
});
