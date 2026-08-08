/**
 * The world: every town in it, and the queries that read one.
 *
 * This file used to *be* Brokemon Town — one grid, one set of row-band zones,
 * and free functions that took a bare `x, y`. The grid now lives in
 * `towns/brokemon.ts` and the queries take the town they are asking about, so
 * a second place can exist without row 30 having to mean two things at once.
 *
 * Simulation code should call `townOf(state)` (sim/state.ts) rather than
 * reaching for a specific town by name.
 */

import { BROKEMON } from "./towns/brokemon";
import type { Town, TownId, Vec2 } from "./town";

export {
  buildTown,
  glyphAt,
  hasMarker,
  isOutdoors,
  isSolid,
  markerPos,
  zoneAt,
  type Town,
  type TownId,
  type TownSpec,
  type Vec2,
  type Zone,
  type ZoneId,
} from "./town";

export const TOWNS: Record<TownId, Town> = {
  brokemon: BROKEMON,
};

/** Where a new run starts. */
export const STARTING_TOWN: TownId = "brokemon";

export function townById(id: TownId): Town {
  return TOWNS[id];
}

/** Where a new game begins, in the starting town. */
export function spawnPoint(): Vec2 {
  return TOWNS[STARTING_TOWN].markers.spawn!;
}
