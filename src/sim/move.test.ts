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
import { cameraFor, facingOnScreen, playerTile, screenPushToStep, screenStepLength, screenX, screenY, stepPacing } from "../engine/render";
import { createState } from "./state";

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
   * The camera looks straight down the grid, so this is now the identity — and
   * these checks are what says so. They are written against the projection
   * rather than against a table somebody typed out, so they went on holding
   * when the town stopped being isometric, and they would catch a future
   * projection that reintroduced a twist without rotating the input to match.
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
      const sx = screenX(step.x, step.y);
      const sy = screenY(step.x, step.y);
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

  it("charges a single key for one tile and two keys for root two", () => {
    /**
     * The camera looks straight down the grid, so a single key is a grid
     * cardinal worth one tile and two keys make a diagonal worth 1.41. That is
     * the right way round and it was not always: while the town was isometric
     * the controls had to be rotated 45 degrees, which made every single key a
     * grid *diagonal* and charged root two for pressing one button.
     */
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const step = screenPushToStep(dx, dy);
      expect(stepCost(step.x, step.y)).toBe(1);
    }
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const step = screenPushToStep(dx, dy);
      expect(stepCost(step.x, step.y)).toBeCloseTo(Math.SQRT2, 10);
    }
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
   * step is worth 15, 20 or 25 *pixels*, because a tile is 20 across and 15
   * deep; the animation is paced by that, or walking down the screen looks
   * slower than walking across it.
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
    // Guard against somebody "simplifying" the pacing back to one number. A
    // tile is 20 across and 15 deep, so the eight steps are 15px (up/down),
    // 20px (left/right) and 25px (the diagonals) — genuinely different lengths,
    // and no single scale can satisfy both invariants above.
    //
    // The bound is the longest step over the shortest, 25/15, not the tile's
    // own 20/15 anisotropy. Those are 5:3 and 4:3 and it is easy to write the
    // wrong one: this assertion used to read `20 / 12`, which passes only
    // because 20/12 and 25/15 are both 5/3, while describing a tile size the
    // game has never had.
    const lengths = STEPS.map((s) => screenStepLength(s.x, s.y));
    expect(Math.min(...lengths)).toBeCloseTo(15, 6);
    expect(Math.max(...lengths)).toBeCloseTo(25, 6);
    expect(Math.max(...lengths) / Math.min(...lengths)).toBeCloseTo(25 / 15, 6);
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

describe("the player does not jitter on the spot while walking", () => {
  /**
   * Reported as "walking north/south is choppy; east/west is smooth", and it
   * was real — but not for the reason it first looked like.
   *
   * The tempting explanation is that the camera covers 15px a tile vertically
   * against 20 horizontally, so vertical movement must advance fewer pixels
   * per frame. It does not: `stepPacing` shortens a vertical step to 135ms
   * against a horizontal step's 180ms precisely so that both cross 0.111px
   * per millisecond — 1.85px a frame at 60fps, in every direction, which the
   * two tests above pin to ten decimal places.
   *
   * The real cause is half a pixel. `cameraFor` centres on the player with
   * `+ TD / 2`, and TD is 15, so `cam.py` carries a permanent .5 — which puts
   * the player's *drawn* position exactly on a rounding boundary, where it
   * flips between two integers as the fraction drifts. `TW / 2` is 10, an
   * integer, so the horizontal axis never had the problem. Traced across one
   * step with the camera rounded: 127 128 128 128 128 127 127 127 127.
   *
   * This asserts the symptom rather than the mechanism, so it still holds if
   * the projection constants ever move.
   */
  function drawnAt(from: Vec2, to: Vec2, k: number): { x: number; y: number } {
    const s = createState(1);
    // Well away from every edge, so the camera is centring rather than clamped.
    s.player.pos = { ...to };
    s.player.moveFrom = { ...from };
    s.player.moveProgress = k;
    const cam = cameraFor(s);
    const at = playerTile(s);
    return {
      x: Math.round(screenX(at.x, at.y) - cam.px + 20 / 2),
      y: Math.round(screenY(at.x, at.y) - cam.py + 15),
    };
  }

  for (const step of STEPS) {
    const name = facingFor(step.x, step.y)!;
    it(`holds still on screen while stepping ${name}`, () => {
      const from = { x: 30, y: 40 };
      const to = { x: from.x + step.x, y: from.y + step.y };
      // Sample the step far more finely than any frame rate would.
      const seen = new Set<string>();
      for (let i = 0; i <= 60; i++) {
        const p = drawnAt(from, to, i / 60);
        seen.add(`${p.x},${p.y}`);
      }
      expect(
        [...seen],
        `the player's sprite moves ${seen.size} different places on screen during one ${name} step — ` +
          `it should stay put while the world slides underneath`,
      ).toHaveLength(1);
    });
  }

  it("keeps the camera fractional, because that is what fixes it", () => {
    // Guards against somebody "tidying" the rounding back into `cameraFor`.
    // Nothing is *drawn* at these coordinates without snapping — see `snap`.
    const s = createState(1);
    s.player.pos = { x: 30, y: 40 };
    const cam = cameraFor(s);
    expect(Number.isInteger(cam.py), "cam.py rounded — the vertical chop is back").toBe(false);
  });
});
