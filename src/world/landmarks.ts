/**
 * Scenery, found by reading the map.
 *
 * Dumpsters, water and benches are terrain rather than named markers, so
 * anything that wants to use one has historically written its coordinates
 * down. That has now gone stale twice — most recently when the town grew from
 * 48x50 to 72x72 and every hardcoded tile in the test rigs quietly became open
 * pavement. Nothing failed: the bot walked to where a dumpster used to be, got
 * a null prompt, and reported a healthy run in which it had never scavenged,
 * drunk or slept.
 *
 * A rig that lies quietly is worse than no rig, so nothing writes a coordinate
 * down any more. Ask for the kind of thing you want and get where it actually
 * is.
 */

import { glyphAt, isSolid, zoneAt, type Town, type Vec2 } from "./map";
import { tileAt, type TileDef } from "./tiles";

export type Interaction = NonNullable<TileDef["interaction"]>;

/** Structurally the same as the simulation's Facing; kept local so world/ does not depend on sim/. */
export type Direction = "up" | "down" | "left" | "right";

/** Where you stand to use a piece of scenery, and which way you face to do it. */
export interface Approach {
  /** The scenery itself. Usually solid — you interact with it, you don't stand on it. */
  target: Vec2;
  /** A walkable tile beside it. */
  pos: Vec2;
  facing: Direction;
}

export function tilesWithInteraction(town: Town, kind: Interaction): Vec2[] {
  const found: Vec2[] = [];
  for (let y = 0; y < town.height; y++) {
    for (let x = 0; x < town.width; x++) {
      const glyph = glyphAt(town, x, y);
      if (glyph !== undefined && tileAt(glyph).interaction === kind) found.push({ x, y });
    }
  }
  return found;
}

const NEIGHBOURS: Array<[number, number, Direction]> = [
  [0, 1, "up"],
  [0, -1, "down"],
  [1, 0, "left"],
  [-1, 0, "right"],
];

/** A walkable tile beside `target`, and the way to face from it. Null if it is walled in. */
export function approachTo(town: Town, target: Vec2): Approach | null {
  for (const [dx, dy, facing] of NEIGHBOURS) {
    const pos = { x: target.x + dx, y: target.y + dy };
    if (!isSolid(town, pos.x, pos.y)) return { target, pos, facing };
  }
  return null;
}

/** Every usable piece of scenery of a kind, optionally restricted to a zone. */
export function approaches(town: Town, kind: Interaction, inZone?: string): Approach[] {
  return tilesWithInteraction(town, kind)
    .filter((t) => inZone === undefined || zoneAt(town, t.y).id === inZone)
    .map((t) => approachTo(town, t))
    .filter((a): a is Approach => a !== null);
}

/**
 * Benches you are allowed to sleep on. Downtown and the Heights both carry an
 * overnight camping ordinance, so only the zone that does not fine you counts.
 */
export function sleepableBenches(town: Town): Approach[] {
  return tilesWithInteraction(town, "bench")
    .filter((t) => zoneAt(town, t.y).fineScale === 0)
    .map((t) => approachTo(town, t))
    .filter((a): a is Approach => a !== null);
}
