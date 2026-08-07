import { createState, type GameState } from "./state";
import { countOf } from "./items";

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
    const merged = { ...createState(parsed.seed), ...parsed } as GameState;
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
