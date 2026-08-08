import { describe, expect, it, beforeEach } from "vitest";
import { createState } from "./state";
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
