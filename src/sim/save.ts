import { createState, type GameState, type PerTown } from "./state";
import { countOf } from "./items";
import { STARTING_TOWN, TOWNS, type TownId } from "../world/map";

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

    // Housing, rent, hostel nights and reputation used to be single values and
    // are now one per town. A save from before that holds a *scalar* where a
    // record belongs — the wrong type, not merely a missing field — so these
    // have to be converted rather than filled in.
    merged.housing = spreadToTowns(parsed.housing, fresh.housing, "street");
    merged.rentDueDay = spreadToTowns(parsed.rentDueDay, fresh.rentDueDay, 0);
    merged.nightsPaid = spreadToTowns(parsed.nightsPaid, fresh.nightsPaid, 0);
    // Reputation is the one where it matters which town gets the old value:
    // everything you built up before Brokedale existed you built in Brokemon.
    merged.reputation = spreadToTowns(parsed.reputation, fresh.reputation, 0, STARTING_TOWN);

    // Migration: old saves with a bus pass but no counter get a fresh 7-day term.
    if (countOf(merged.inventory, "busPass") > 0 && merged.busPassDaysLeft === 0) {
      merged.busPassDaysLeft = 7;
    }
    return merged;
  } catch {
    return null;
  }
}

/**
 * Turn whatever a save holds into a full per-town record.
 *
 * Three shapes turn up: a proper record (keep it, filling any town it does not
 * mention), a bare scalar from before towns were plural, and nothing at all.
 * A scalar goes to `landsIn` if one is named — reputation you earned before
 * Brokedale existed you earned in Brokemon — or to every town otherwise, which
 * is right for housing, since the room you had is the room you still have.
 */
function spreadToTowns<T>(stored: unknown, fresh: PerTown<T>, empty: T, landsIn?: TownId): PerTown<T> {
  const out = { ...fresh };
  if (stored !== null && typeof stored === "object") {
    const record = stored as Partial<PerTown<T>>;
    for (const id of Object.keys(out) as TownId[]) out[id] = record[id] ?? out[id];
    return out;
  }
  if (stored === undefined) return out;

  const scalar = stored as T;
  for (const id of Object.keys(out) as TownId[]) {
    out[id] = landsIn === undefined ? scalar : id === landsIn ? scalar : empty;
  }
  return out;
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
