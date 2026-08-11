/**
 * How a body moves across the grid, in one place.
 *
 * The renderer walks the player a step at a time from held keys; the walking
 * rig walks it a step at a time from a distance field. They have to agree about
 * three things or the rig reports a game nobody is playing: which steps are
 * legal, which way you end up facing, and what a step costs.
 *
 * Diagonals are the reason this file exists. They are worth having — the town
 * is drawn isometrically and its streets run diagonally on screen, so being
 * unable to walk down one was the first thing that felt wrong — but they are
 * only honest if a diagonal step costs what a diagonal step is: root two.
 * Charging one step for 1.41 tiles of ground would have handed every route in
 * the game a 41% discount and quietly invalidated every walking number in
 * `docs/playtest-findings.md`.
 */
import { isSolid, type Town, type Vec2 } from "../world/map";
import type { Facing } from "./state";

/** The eight ways to face, and the step each one takes. */
export const FACING_DELTA: Record<Facing, Vec2> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  upLeft: { x: -1, y: -1 },
  upRight: { x: 1, y: -1 },
  downLeft: { x: -1, y: 1 },
  downRight: { x: 1, y: 1 },
};

/** Every step a body can take from a tile, diagonals last. */
export const STEPS: Vec2[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: 1, y: 1 },
];

export const DIAGONAL_COST = Math.SQRT2;

/** What a step costs, in whole-tile equivalents. */
export function stepCost(dx: number, dy: number): number {
  return dx !== 0 && dy !== 0 ? DIAGONAL_COST : 1;
}

/** Which way a body ends up facing after a step. Zero means unchanged. */
export function facingFor(dx: number, dy: number): Facing | null {
  if (dx === 0 && dy === 0) return null;
  const vertical = dy < 0 ? "up" : dy > 0 ? "down" : "";
  const horizontal = dx < 0 ? "left" : dx > 0 ? "right" : "";
  if (!vertical) return horizontal as Facing;
  if (!horizontal) return vertical as Facing;
  return (vertical + horizontal[0]!.toUpperCase() + horizontal.slice(1)) as Facing;
}

/**
 * Whether a step out of `from` is legal.
 *
 * A diagonal needs **both** of the squares it passes between to be clear, not
 * just the destination. The looser rule lets you cut the corner of a building,
 * and worse, slip diagonally between two wall tiles that meet at a point — a
 * town whose doorways are one tile wide would have had a second, invisible way
 * into every building in it.
 */
export function canStep(town: Town, from: Vec2, dx: number, dy: number): boolean {
  const nx = from.x + dx;
  const ny = from.y + dy;
  if (isSolid(town, nx, ny)) return false;
  if (dx !== 0 && dy !== 0) {
    if (isSolid(town, from.x + dx, from.y)) return false;
    if (isSolid(town, from.x, from.y + dy)) return false;
  }
  return true;
}

/**
 * The tiles a diagonal facing could reasonably mean.
 *
 * Facing north-east at a door that is due north, you are standing next to it
 * and looking past it. Interaction checks the tile you are pointed at and then
 * the two it sits between, so the door opens instead of the player shuffling
 * to line up with a grid they can no longer see.
 */
export function facingCandidates(pos: Vec2, facing: Facing): Vec2[] {
  const d = FACING_DELTA[facing];
  const out = [{ x: pos.x + d.x, y: pos.y + d.y }];
  if (d.x !== 0 && d.y !== 0) {
    out.push({ x: pos.x + d.x, y: pos.y }, { x: pos.x, y: pos.y + d.y });
  }
  return out;
}
