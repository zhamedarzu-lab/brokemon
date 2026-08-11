/**
 * The movement rules, which the game loop and the walking rig both read.
 *
 * They have to agree about three things or the rig reports a game nobody is
 * playing: which steps are legal, which way you end up facing, and what a step
 * costs. The last one is the one with teeth — a diagonal covers root two tiles
 * of ground, and charging it as one would have handed every route in the game a
 * 41% discount the moment diagonals existed.
 */
import { describe, expect, it } from "vitest";
import { townById } from "../world/map";
import { isSolid } from "../world/map";
import { canStep, DIAGONAL_COST, facingFor, FACING_DELTA, stepCost, STEPS } from "./move";

const town = townById("brokemon");

describe("what a step costs", () => {
  it("charges root two for a diagonal and one for a straight", () => {
    expect(stepCost(1, 0)).toBe(1);
    expect(stepCost(0, -1)).toBe(1);
    expect(stepCost(1, 1)).toBeCloseTo(Math.SQRT2, 10);
    expect(stepCost(-1, 1)).toBeCloseTo(Math.SQRT2, 10);
  });

  it("never makes a diagonal cheaper than going round the corner", () => {
    // Two straights cover the same ground as one diagonal and cost more. If
    // that ever inverts, every path in the game becomes a zigzag.
    expect(DIAGONAL_COST).toBeLessThan(2);
    expect(DIAGONAL_COST).toBeGreaterThan(1);
  });
});

describe("which way you end up facing", () => {
  it("names all eight directions", () => {
    expect(facingFor(0, -1)).toBe("up");
    expect(facingFor(0, 1)).toBe("down");
    expect(facingFor(-1, 0)).toBe("left");
    expect(facingFor(1, 0)).toBe("right");
    expect(facingFor(-1, -1)).toBe("upLeft");
    expect(facingFor(1, -1)).toBe("upRight");
    expect(facingFor(-1, 1)).toBe("downLeft");
    expect(facingFor(1, 1)).toBe("downRight");
  });

  it("stays put when nothing is pushed", () => {
    expect(facingFor(0, 0)).toBeNull();
  });

  it("agrees with the table the interaction code reads", () => {
    for (const step of STEPS) {
      const facing = facingFor(step.x, step.y)!;
      expect(FACING_DELTA[facing]).toEqual(step);
    }
  });
});

describe("cutting corners", () => {
  /** A tile with a solid neighbour east and a clear one north. */
  function findCorner(): { x: number; y: number; dx: number; dy: number } | null {
    for (let y = 1; y < town.height - 1; y++) {
      for (let x = 1; x < town.width - 1; x++) {
        if (isSolid(town, x, y)) continue;
        for (const [dx, dy] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ] as const) {
          if (isSolid(town, x + dx, y + dy)) continue;
          if (isSolid(town, x + dx, y) && !isSolid(town, x, y + dy)) return { x, y, dx, dy };
        }
      }
    }
    return null;
  }

  it("refuses a diagonal that squeezes past a corner", () => {
    /**
     * A diagonal needs *both* squares it passes between to be clear. The looser
     * rule lets you clip the corner of a building, and worse, slip between two
     * wall tiles that meet at a point — in a town whose doorways are one tile
     * wide that would be a second, invisible way into every building.
     */
    const corner = findCorner();
    expect(corner, "the map has no corner to test against").not.toBeNull();
    const { x, y, dx, dy } = corner!;
    expect(canStep(town, { x, y }, dx, dy)).toBe(false);
    // …and the two halves of it are still walkable one at a time.
    expect(canStep(town, { x, y }, 0, dy)).toBe(true);
  });

  it("still refuses to walk into something solid", () => {
    for (let y = 1; y < town.height - 1; y++) {
      for (let x = 1; x < town.width - 1; x++) {
        if (isSolid(town, x, y)) continue;
        for (const step of STEPS) {
          if (isSolid(town, x + step.x, y + step.y)) {
            expect(canStep(town, { x, y }, step.x, step.y)).toBe(false);
          }
        }
      }
    }
  });

  it("allows a diagonal across open ground", () => {
    let found = false;
    for (let y = 1; y < town.height - 1 && !found; y++) {
      for (let x = 1; x < town.width - 1 && !found; x++) {
        if (isSolid(town, x, y)) continue;
        if (canStep(town, { x, y }, 1, 1)) found = true;
      }
    }
    expect(found, "no diagonal is legal anywhere in the town").toBe(true);
  });
});
