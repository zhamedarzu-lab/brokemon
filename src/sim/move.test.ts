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
import { isSolid, TOWNS, townById, type Vec2 } from "../world/map";
import { canStep, DIAGONAL_COST, facingFor, FACING_DELTA, stepCost, STEPS } from "./move";
import { facingOnScreen, isoX, isoY, screenPushToStep, screenStepLength, stepPacing } from "../engine/render";

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

describe("screen-relative controls", () => {
  /**
   * The controls are wired to the screen, not to the grid.
   *
   * Under this projection the grid's cardinals point at the screen's diagonals,
   * so a scheme wired straight to the grid sends the player towards the bottom
   * *left* when they press down. Everything here checks the 45-degree rotation
   * that fixes it, against the projection itself rather than against a table
   * somebody typed out — if `isoX`/`isoY` ever change, these fail.
   */
  const PUSHES = [
    ["down", 0, 1],
    ["down-right", 1, 1],
    ["right", 1, 0],
    ["up-right", 1, -1],
    ["up", 0, -1],
    ["up-left", -1, -1],
    ["left", -1, 0],
    ["down-left", -1, 1],
  ] as const;

  it("sends the player where they pushed, on screen", () => {
    for (const [name, dx, dy] of PUSHES) {
      const step = screenPushToStep(dx, dy);
      // Where that step actually lands, in screen pixels.
      const sx = isoX(step.x, step.y);
      const sy = isoY(step.x, step.y);
      expect(Math.sign(sx), `pushing ${name} moves the wrong way horizontally`).toBe(dx);
      expect(Math.sign(sy), `pushing ${name} moves the wrong way vertically`).toBe(dy);
    }
  });

  it("maps the eight pushes onto the eight steps, one to one", () => {
    const seen = new Set(PUSHES.map(([, dx, dy]) => JSON.stringify(screenPushToStep(dx, dy))));
    expect(seen.size).toBe(8);
    for (const step of STEPS) expect(seen.has(JSON.stringify(step))).toBe(true);
  });

  it("stands still for no push", () => {
    expect(screenPushToStep(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("costs root two to walk straight down the screen", () => {
    // Straight down the screen is a grid diagonal, and it covers 1.41 tiles of
    // ground. Rotating the controls must not quietly make that free.
    const down = screenPushToStep(0, 1);
    expect(stepCost(down.x, down.y)).toBeCloseTo(Math.SQRT2, 10);
    const downRight = screenPushToStep(1, 1);
    expect(stepCost(downRight.x, downRight.y)).toBe(1);
  });

  it("draws the face pointing the way the player is walking", () => {
    // Press down, walk down, look down. The grid facing underneath is south-east.
    const lookAfterPushing = (dx: number, dy: number) => {
      const step = screenPushToStep(dx, dy);
      return facingOnScreen(facingFor(step.x, step.y)!);
    };
    expect(lookAfterPushing(0, 1)).toBe("down");
    expect(lookAfterPushing(0, -1)).toBe("up");
    expect(lookAfterPushing(1, 0)).toBe("right");
    expect(lookAfterPushing(-1, 0)).toBe("left");
  });
});

describe("how a step is paced against what it costs", () => {
  /**
   * Two numbers that used to be one, and had to come apart when the controls
   * were rotated to the screen.
   *
   * A step is worth 1 or root-two *tiles* of ground; the clock charges that, or
   * crossing the map gets cheaper depending on which way you walked. The same
   * step is worth 16 or 32 *pixels*, because the projection squashes the
   * vertical two to one; the animation is paced by that, or walking down the
   * screen looks like half the speed of walking across it.
   */
  it("spends exactly the game time the ground is worth, whichever way you go", () => {
    for (const step of STEPS) {
      const { animScale, timeRate } = stepPacing(step.x, step.y);
      expect(
        animScale * timeRate,
        `a step of (${step.x},${step.y}) charges the wrong amount of time`,
      ).toBeCloseTo(stepCost(step.x, step.y), 10);
    }
  });

  it("moves the player the same number of pixels a second in every direction", () => {
    const rates = STEPS.map((step) => {
      const { animScale } = stepPacing(step.x, step.y);
      // Pixels covered per unit of step duration.
      return screenStepLength(step.x, step.y) / animScale;
    });
    for (const rate of rates) expect(rate).toBeCloseTo(rates[0]!, 10);
  });

  it("was not already uniform, which is why this exists", () => {
    // Guard against somebody "simplifying" the pacing back to one number: the
    // pixel lengths genuinely differ two to one, so a single scale cannot
    // satisfy both invariants above.
    const lengths = STEPS.map((s) => screenStepLength(s.x, s.y));
    expect(Math.max(...lengths) / Math.min(...lengths)).toBeCloseTo(2, 6);
  });
});

describe("the town is still fully walkable", () => {
  /**
   * The corner rule is the kind of thing that strands tiles.
   *
   * It refuses a diagonal unless both squares it passes between are clear,
   * which is right — otherwise you clip through the corner of a building — but
   * tighten it a notch further and alcoves, doorways and one-tile gaps start
   * cutting themselves off from the map. Nothing else in the suite would
   * notice: the game would still run, and a venue would simply have become
   * impossible to walk to.
   */
  function reachableFrom(town: (typeof TOWNS)[keyof typeof TOWNS], start: Vec2): Set<string> {
    const seen = new Set([`${start.x},${start.y}`]);
    const queue: Vec2[] = [start];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i]!;
      for (const step of STEPS) {
        if (!canStep(town, cur, step.x, step.y)) continue;
        const next = { x: cur.x + step.x, y: cur.y + step.y };
        const key = `${next.x},${next.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push(next);
      }
    }
    return seen;
  }

  it.each(Object.values(TOWNS).map((t) => [t.name, t] as const))("%s has no tile you cannot leave", (_name, town) => {
    const trapped: string[] = [];
    for (let y = 0; y < town.height; y++) {
      for (let x = 0; x < town.width; x++) {
        if (isSolid(town, x, y)) continue;
        if (!STEPS.some((s) => canStep(town, { x, y }, s.x, s.y))) trapped.push(`${x},${y}`);
      }
    }
    expect(trapped).toEqual([]);
  });

  it.each(Object.values(TOWNS).map((t) => [t.name, t] as const))("%s can be walked door to door", (_name, town) => {
    /**
     * Brokemon's Heights are the one exception and they are deliberate: rows
     * 0–14 sit behind a security gate, which is a solid tile you are let
     * through rather than walk through, so no flood fill can cross it.
     */
    const start = town.markers.spawn ?? town.markers.coachTerminal!;
    const seen = reachableFrom(town, start);
    const gated = (v: Vec2) => town.id === "brokemon" && v.y <= 14;

    const stranded: string[] = [];
    for (let y = 0; y < town.height; y++) {
      for (let x = 0; x < town.width; x++) {
        if (isSolid(town, x, y) || gated({ x, y })) continue;
        if (!seen.has(`${x},${y}`)) stranded.push(`${x},${y}`);
      }
    }
    expect(stranded.slice(0, 20)).toEqual([]);

    for (const [id, at] of Object.entries(town.markers)) {
      if (gated(at)) continue;
      expect(seen.has(`${at.x},${at.y}`), `${town.id}: cannot walk to ${id}`).toBe(true);
    }
  });
});
