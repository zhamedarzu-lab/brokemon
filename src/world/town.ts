/**
 * A place, as data.
 *
 * Everything used to be one module-level grid with free functions hanging off
 * it — `glyphAt(x, y)`, `zoneAt(y)` — which works exactly as long as there is
 * only ever one town. Zones in particular were global row bands, so row 30
 * could only ever mean one thing.
 *
 * A town now carries its own grid, markers and zones, and the queries take one.
 * Nothing here knows about the simulation; ask `townOf(state)` in sim/state.ts
 * for the one the player is standing in.
 */

import { MARKERS, MARKER_FLOOR, TILES, tileAt, type Glyph } from "./tiles";

export interface Vec2 {
  x: number;
  y: number;
}

export type TownId = "brokemon" | "brokedale";

/**
 * Social strata. Each band of a town behaves differently towards you.
 *
 * Brokemon's three run top to bottom by money. Brokedale's are districts
 * rather than altitudes — the terminal takes you as you are, the blocks do not
 * much care, and everything else there is priced rather than gated.
 */
export type ZoneId = "heights" | "downtown" | "slums" | "terminal" | "blocks" | "highStreet" | "riverside";

export interface Zone {
  id: ZoneId;
  name: string;
  /** Flavour shown on the zone signposts. */
  sign: string;
  /** Rows [from, to] inclusive, within this town. */
  from: number;
  to: number;
  /** Minimum hygiene before the local police take an interest. */
  hygieneWatch: number;
  /** Dress code required to avoid being escorted out. */
  requiresAttire: boolean;
  /** Multiplier on fines issued here. */
  fineScale: number;
  /**
   * Where an officer puts you down when they walk you out of this zone. Lives
   * beside the rows it refers to rather than in a table in `tick.ts`, so it
   * cannot go stale when a grid is redrawn; `buildTown` rejects one that has
   * ended up inside a wall. Only zones that issue fines need it.
   */
  escortTo?: Vec2;
}

export interface Town {
  id: TownId;
  name: string;
  width: number;
  height: number;
  /** Terrain, with markers stripped out and replaced by the floor beneath them. */
  grid: Glyph[][];
  /** Where each named location ended up. */
  markers: Record<string, Vec2>;
  zones: Zone[];
}

export interface TownSpec {
  id: TownId;
  name: string;
  /** One string per row. Every row must be the same length. */
  rows: string[];
  zones: Array<Omit<Zone, "to"> & { to?: number }>;
  /** Marker ids this town is required to define. */
  requires: string[];
}

export function buildTown(spec: TownSpec): Town {
  const height = spec.rows.length;
  const width = spec.rows[0]?.length ?? 0;
  const grid: Glyph[][] = [];
  const markers: Record<string, Vec2> = {};

  spec.rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`${spec.id} row ${y} is ${row.length} tiles wide, expected ${width}`);
    }
    const cells: Glyph[] = [];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      const marker = MARKERS[ch];
      if (marker) {
        if (markers[marker]) throw new Error(`${spec.id}: marker "${marker}" appears more than once`);
        markers[marker] = { x, y };
        cells.push(MARKER_FLOOR[ch] ?? ".");
      } else {
        if (!TILES[ch]) throw new Error(`${spec.id}: unknown glyph "${ch}" at ${x},${y}`);
        cells.push(ch);
      }
    }
    grid.push(cells);
  });

  for (const id of spec.requires) {
    if (!markers[id]) throw new Error(`${spec.id} is missing marker "${id}"`);
  }

  // The last band runs to the bottom edge unless it says otherwise, so a town
  // cannot end up with rows that belong to no zone.
  const zones: Zone[] = spec.zones.map((z) => ({ ...z, to: z.to ?? height - 1 }));
  for (let y = 0; y < height; y++) {
    if (!zones.some((z) => y >= z.from && y <= z.to)) {
      throw new Error(`${spec.id} row ${y} is in no zone`);
    }
  }

  const town: Town = { id: spec.id, name: spec.name, width, height, grid, markers, zones };

  // A zone that fines people also escorts them, and the tile it escorts them to
  // has to be one they can stand on. Checked here so a redrawn grid fails at
  // load rather than teleporting the player into a wall months later.
  for (const zone of zones) {
    if (zone.fineScale === 0) continue;
    if (!zone.escortTo) throw new Error(`${spec.id} zone "${zone.id}" issues fines but has no escortTo`);
    if (isSolid(town, zone.escortTo.x, zone.escortTo.y)) {
      throw new Error(`${spec.id} zone "${zone.id}" escorts to ${zone.escortTo.x},${zone.escortTo.y}, which is solid`);
    }
  }

  return town;
}

/* --------------------------------------------------------------- queries */

export function zoneAt(town: Town, y: number): Zone {
  for (const z of town.zones) if (y >= z.from && y <= z.to) return z;
  return town.zones[Math.min(1, town.zones.length - 1)]!;
}

export function glyphAt(town: Town, x: number, y: number): Glyph | undefined {
  return town.grid[y]?.[x];
}

export function isSolid(town: Town, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= town.width || y >= town.height) return true;
  return tileAt(glyphAt(town, x, y)).solid;
}

export function isOutdoors(town: Town, x: number, y: number): boolean {
  return tileAt(glyphAt(town, x, y)).outdoor === true;
}

export function markerPos(town: Town, id: string): Vec2 {
  const p = town.markers[id];
  if (!p) throw new Error(`${town.id} has no such marker: ${id}`);
  return p;
}

export function hasMarker(town: Town, id: string): boolean {
  return town.markers[id] !== undefined;
}
