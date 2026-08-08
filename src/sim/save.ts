import { createState, type GameState } from "./state";
import { countOf } from "./items";
import { STARTING_TOWN, TOWNS } from "../world/map";

const KEY = "brokemon.save.v1";

export function saveGame(s: GameState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GameState>;
    if (typeof parsed.time !== "number" || !parsed.player || !parsed.meters) return null;
    // Merge over a fresh state so saves from an older build still load.
    const fresh = createState(parsed.seed);
    const merged = { ...fresh, ...parsed } as GameState;

    // The spread is shallow, so `parsed.player` replaces the fresh one whole.
    // A save written before towns were plural has no `player.town`, which would
    // leave every map lookup asking for a town that does not exist.
    merged.player = { ...fresh.player, ...parsed.player };
    if (!merged.player.town || !(merged.player.town in TOWNS)) {
      merged.player.town = STARTING_TOWN;
    }

    // Migration: old saves with a bus pass but no counter get a fresh 7-day term.
    if (countOf(merged.inventory, "busPass") > 0 && merged.busPassDaysLeft === 0) {
      merged.busPassDaysLeft = 7;
    }
    return merged;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private browsing, nothing to clear */
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}
