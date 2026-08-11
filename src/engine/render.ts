import { glyphAt, type Town } from "../world/map";
import { tileAt, type TileDef } from "../world/tiles";
import { daylight } from "../sim/time";
import { WEATHER } from "../sim/weather";
import { townOf, type GameState } from "../sim/state";
import { OUTFITS } from "../sim/social";
import { assignmentStopAt, DOOR_SIGNS, facingTile } from "../sim/actions";

/**
 * The town is isometric.
 *
 * The simulation never knew what projection it was drawn in — it is a grid of
 * tiles and a `{x, y}` for the player, and that has not changed. Everything
 * here is the difference between looking straight down at that grid and looking
 * at it from a corner.
 *
 * `TILE` is still 16 and still the unit every piece of tile art is drawn in.
 * A tile now occupies a 32x16 diamond on screen, and the art is painted into it
 * through a skew transform rather than being redrawn — which is why a hundred
 * and forty lines of speckles, brickwork and marble veining survived the change
 * untouched.
 */
export const TILE = 16;
/** A tile's diamond on screen: 2:1, the standard isometric ratio. */
export const TW = 32;
export const TH = 16;
export const CANVAS_W = 336;
export const CANVAS_H = 240;

/**
 * How far a tile stands up off the ground, in pixels.
 *
 * Zero means it is floor and gets a flat diamond. Anything else is drawn as a
 * box: two side faces and a raised top. This is the whole reason to be
 * isometric — in a top-down view a wall and a pavement are both a square, and
 * here a wall is a thing you cannot see past.
 */
const STANDS: Record<string, number> = {
  wall: 15,
  roof: 22,
  cliff: 20,
  tree: 24,
  hedge: 11,
  fence: 9,
  lamp: 20,
  sign: 13,
  gate: 13,
  dumpster: 10,
  bin: 9,
  bench: 6,
};

/** Screen position of a tile's top vertex, before the camera is subtracted. */
export function isoX(x: number, y: number): number {
  return (x - y) * (TW / 2);
}
export function isoY(x: number, y: number): number {
  return (x + y) * (TH / 2);
}

/** The tile under a screen point — the inverse of the pair above. */
export function screenToTile(sx: number, sy: number): { x: number; y: number } {
  return { x: Math.floor(sx / TW + sy / TH), y: Math.floor(sy / TH - sx / TW) };
}

/**
 * Paint the next drawing into this tile's diamond.
 *
 * The transform maps the unit square (0,0)-(TILE,TILE) onto the diamond whose
 * top vertex is (ox, oy), so anything written for the old top-down view lands
 * on the ground plane correctly and needs no edits.
 */
function inTileSpace(ctx: CanvasRenderingContext2D, ox: number, oy: number, paint: () => void): void {
  ctx.save();
  ctx.transform(TW / 2 / TILE, TH / 2 / TILE, -TW / 2 / TILE, TH / 2 / TILE, ox, oy);
  paint();
  ctx.restore();
}

/**
 * Paint into one of the two vertical faces of a box.
 *
 * Brickwork and windows belong on the side of a wall, not on the top of it.
 * Painting every tile's art onto the top face was the first thing that looked
 * wrong about the isometric view: buildings came out as plain slabs with a
 * brick pattern lying flat across the roof of each one.
 *
 * The same unit square, mapped onto a parallelogram standing up instead of a
 * diamond lying down — art written for the old view still needs no edits.
 */
function inWallSpace(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  h: number,
  side: "left" | "right",
  paint: () => void,
): void {
  const hw = TW / 2;
  const hh = TH / 2;
  ctx.save();
  if (side === "right") {
    // From the right corner, running to the near corner and downward.
    ctx.transform(-hw / TILE, hh / TILE, 0, h / TILE, ox + hw, oy + hh - h);
  } else {
    ctx.transform(hw / TILE, hh / TILE, 0, h / TILE, ox - hw, oy + hh - h);
  }
  paint();
  ctx.restore();
}

/** Details that are a vertical surface, and so want their art on the faces. */
const FACED = new Set(["wall", "cliff"]);

function diamondPath(ctx: CanvasRenderingContext2D, ox: number, oy: number, grow = 0): void {
  const w = TW / 2 + grow;
  const h = TH / 2 + grow;
  ctx.beginPath();
  ctx.moveTo(ox, oy - grow);
  ctx.lineTo(ox + w, oy + h);
  ctx.lineTo(ox, oy + TH + grow);
  ctx.lineTo(ox - w, oy + h);
  ctx.closePath();
}

/** Darken or lighten a `#rrggbb`, for the two side faces of a box. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `rgb(${r},${g},${b})`;
}

/**
 * A tile that stands up: the two faces you can see, then the top.
 *
 * Light comes from the upper right, so the right face keeps most of the colour
 * and the left face goes dark. Without the split every building read as one
 * flat silhouette.
 */
function drawBox(ctx: CanvasRenderingContext2D, ox: number, oy: number, h: number, color: string): void {
  const hw = TW / 2;
  const hh = TH / 2;
  // Right face.
  ctx.fillStyle = shade(color, 0.72);
  ctx.beginPath();
  ctx.moveTo(ox + hw, oy + hh - h);
  ctx.lineTo(ox, oy + TH - h);
  ctx.lineTo(ox, oy + TH);
  ctx.lineTo(ox + hw, oy + hh);
  ctx.closePath();
  ctx.fill();
  // Left face.
  ctx.fillStyle = shade(color, 0.48);
  ctx.beginPath();
  ctx.moveTo(ox - hw, oy + hh - h);
  ctx.lineTo(ox, oy + TH - h);
  ctx.lineTo(ox, oy + TH);
  ctx.lineTo(ox - hw, oy + hh);
  ctx.closePath();
  ctx.fill();
}

/** Stable per-tile pseudo-noise so scenery doesn't shimmer as you walk. */
function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface Camera {
  /** Top-left of the viewport in world pixels. */
  px: number;
  py: number;
}

/** Where the player is standing, in fractional tiles, mid-step included. */
export function playerTile(s: GameState): { x: number; y: number } {
  const p = s.player;
  if (!p.moveFrom) return { x: p.pos.x, y: p.pos.y };
  const k = p.moveProgress;
  return {
    x: p.moveFrom.x + (p.pos.x - p.moveFrom.x) * k,
    y: p.moveFrom.y + (p.pos.y - p.moveFrom.y) * k,
  };
}

/**
 * The camera simply centres the player.
 *
 * The top-down camera clamped to the town rectangle so you never saw past the
 * edge. A grid seen from a corner is a diamond, not a rectangle, so there is no
 * rectangle to clamp to — the corners of the screen are always outside the map
 * and the void colour behind them is the honest answer.
 */
export function cameraFor(state: GameState): Camera {
  const at = playerTile(state);
  return {
    px: Math.round(isoX(at.x, at.y) - CANVAS_W / 2),
    py: Math.round(isoY(at.x, at.y) - CANVAS_H / 2 + TH / 2),
  };
}

/**
 * Which tiles can reach the screen.
 *
 * Corners of the viewport, unprojected, then padded — generously downward,
 * because a tall tile several rows below the bottom edge still pokes up into
 * view, and stingily is how you get buildings popping in at the bottom.
 */
function visibleBounds(cam: Camera): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [sx, sy] of [
    [0, 0],
    [CANVAS_W, 0],
    [0, CANVAS_H],
    [CANVAS_W, CANVAS_H],
  ] as const) {
    const at = screenToTile(sx + cam.px, sy + cam.py);
    x0 = Math.min(x0, at.x);
    x1 = Math.max(x1, at.x);
    y0 = Math.min(y0, at.y);
    y1 = Math.max(y1, at.y);
  }
  return { x0: x0 - 2, x1: x1 + 3, y0: y0 - 2, y1: y1 + 3 };
}

export function render(ctx: CanvasRenderingContext2D, state: GameState, timeMs: number, minimapOpen = false): void {
  const town = townOf(state);
  const cam = cameraFor(state);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#101014";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const b = visibleBounds(cam);
  const at = playerTile(state);
  const playerDepth = Math.round(at.x) + Math.round(at.y);
  let playerDrawn = false;

  /**
   * Painter's algorithm, by depth.
   *
   * Everything on screen is sorted by `x + y`, because that is the axis running
   * away from the camera: a tile with a larger sum is nearer and paints over
   * one behind it. A plain row-major loop does not do this — (5,0) and (0,1)
   * come out in the wrong order — and getting it wrong means walls drawn on top
   * of the things standing in front of them.
   */
  const px = isoX(at.x, at.y) - cam.px;
  const py = isoY(at.x, at.y) - cam.py + TH / 2;

  for (let d = b.x0 + b.y0; d <= b.x1 + b.y1; d++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const y = d - x;
      if (y < b.y0 || y > b.y1) continue;
      const ox = isoX(x, y) - cam.px;
      const oy = isoY(x, y) - cam.py;
      /**
       * Anything tall standing between you and the camera goes translucent.
       *
       * This is not a nicety. The spawn is two rows from the southern retaining
       * wall, which is the tallest thing in the game and painted last because
       * it is nearest — so the first frame of a new game had the player
       * completely hidden behind it. Walking south past any building did the
       * same thing.
       */
      const stands = (STANDS[tileAt(glyphAt(town, x, y) ?? "_").detail ?? ""] ?? 0) > 0;
      const inFront =
        stands && d > playerDepth && Math.abs(ox - px) < TW * 0.75 && oy - py > -TH * 3 && oy - py < TH * 2;
      drawTile(ctx, town, x, y, ox, oy, timeMs, inFront ? 0.32 : 1);
    }
    // The player belongs in the sort, not on top of it — otherwise you walk
    // through the front wall of every building you pass.
    if (!playerDrawn && d >= playerDepth) {
      drawFacingCursor(ctx, state, cam, timeMs);
      drawPlayer(ctx, state, cam, timeMs);
      playerDrawn = true;
    }
  }
  if (!playerDrawn) {
    drawFacingCursor(ctx, state, cam, timeMs);
    drawPlayer(ctx, state, cam, timeMs);
  }

  drawDoorSigns(ctx, town, cam);
  drawAssignmentMarkers(ctx, state, cam, timeMs);
  drawLighting(ctx, state, cam);
  drawWeather(ctx, state, timeMs);
  if (minimapOpen) drawMinimap(ctx, state, cam, timeMs);
}

/* ------------------------------------------------------------------ tiles */

/**
 * Land beyond the map.
 *
 * A top-down camera clamped to the town rectangle and you never saw the edge.
 * From a corner the world is a diamond, so the screen corners are always past
 * it — and at the spawn, two rows from the southern wall, half the view was a
 * black hole. This is not walkable and nothing is drawn on it; it is there so
 * the town reads as sitting in a landscape rather than floating in a void.
 */
function drawOutside(ctx: CanvasRenderingContext2D, x: number, y: number, ox: number, oy: number): void {
  ctx.fillStyle = hash(x, y, 91) > 0.5 ? "#23291f" : "#202619";
  diamondPath(ctx, ox, oy, 0.5);
  ctx.fill();
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  town: Town,
  x: number,
  y: number,
  ox: number,
  oy: number,
  t: number,
  fade: number,
): void {
  const glyph = glyphAt(town, x, y);
  if (glyph === undefined) {
    drawOutside(ctx, x, y, ox, oy);
    return;
  }

  const tile = tileAt(glyph);
  const stands = STANDS[tile.detail ?? ""] ?? 0;

  // Ghosting has to leave the floor behind. `globalAlpha` composites against
  // whatever has already been painted, and behind a tile at the edge of the
  // view that is the background colour — so fading the whole tile turned it
  // into a black hole rather than something you could see past. The base of
  // the tile stays solid and only what stands up goes translucent.
  if (fade < 1) {
    ctx.fillStyle = shade(tile.color, 0.5);
    diamondPath(ctx, ox, oy, 0.5);
    ctx.fill();
    ctx.globalAlpha = fade;
  }

  if (stands > 0) drawBox(ctx, ox, oy, stands, tile.color);

  // The top face — ground level for floor, `stands` pixels up for everything
  // else — and then the art, painted into the diamond by the transform.
  const top = oy - stands;
  ctx.fillStyle = stands > 0 ? shade(tile.color, 1.06) : tile.color;
  // A hair of overlap: neighbouring diamonds share an edge and antialiasing
  // leaves a lit seam along every one of them otherwise.
  diamondPath(ctx, ox, top, 0.5);
  ctx.fill();

  if (stands > 0 && FACED.has(tile.detail ?? "")) {
    // The top of a wall is its cap: flat, plain, and slightly lit. Everything
    // that makes it a wall goes on the two faces you can actually see.
    inWallSpace(ctx, ox, oy, stands, "right", () => paintDetail(ctx, tile, x, y, t));
    inWallSpace(ctx, ox, oy, stands, "left", () => paintDetail(ctx, tile, x, y, t));
    // Re-shade the faces after the art, so the lighting survives it.
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.beginPath();
    ctx.moveTo(ox + TW / 2, oy + TH / 2 - stands);
    ctx.lineTo(ox, oy + TH - stands);
    ctx.lineTo(ox, oy + TH);
    ctx.lineTo(ox + TW / 2, oy + TH / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.52)";
    ctx.beginPath();
    ctx.moveTo(ox - TW / 2, oy + TH / 2 - stands);
    ctx.lineTo(ox, oy + TH - stands);
    ctx.lineTo(ox, oy + TH);
    ctx.lineTo(ox - TW / 2, oy + TH / 2);
    ctx.closePath();
    ctx.fill();
  } else {
    inTileSpace(ctx, ox, top, () => paintDetail(ctx, tile, x, y, t));
  }
  if (fade < 1) ctx.globalAlpha = 1;
}

/**
 * The tile art, drawn in tile space.
 *
 * Every case here predates the isometric view and none of them needed changing:
 * they draw into a 16x16 square at the origin and the caller's transform lands
 * that square on the right diamond. The two names it used to take for its
 * screen position are pinned to zero for exactly that reason.
 */
function paintDetail(ctx: CanvasRenderingContext2D, tile: TileDef, x: number, y: number, t: number): void {
  const sx = 0;
  const sy = 0;
  switch (tile.detail) {
    case "grass":
      speckle(ctx, x, y, sx, sy, "#4a7c43", 3);
      if (hash(x, y, 7) > 0.86) {
        ctx.fillStyle = "#568a4c";
        ctx.fillRect(sx + 5, sy + 9, 2, 3);
        ctx.fillRect(sx + 9, sy + 6, 2, 3);
      }
      break;

    case "weeds":
      speckle(ctx, x, y, sx, sy, "#2e5029", 4);
      ctx.fillStyle = "#4c7040";
      for (let i = 0; i < 4; i++) {
        const hx = Math.floor(hash(x, y, i) * 13) + 1;
        const hy = Math.floor(hash(x, y, i + 40) * 10) + 4;
        ctx.fillRect(sx + hx, sy + hy, 1, 3);
      }
      break;

    case "flowers":
      speckle(ctx, x, y, sx, sy, "#4a7c43", 3);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = ["#d8687f", "#e0c052", "#c9a2d8"][i % 3]!;
        const hx = Math.floor(hash(x, y, i * 3) * 12) + 2;
        const hy = Math.floor(hash(x, y, i * 3 + 1) * 12) + 2;
        ctx.fillRect(sx + hx, sy + hy, 2, 2);
      }
      break;

    case "tree": {
      ctx.fillStyle = "#3f6b3a";
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = "#5a3f28";
      ctx.fillRect(sx + 7, sy + 10, 3, 6);
      const sway = Math.sin(t / 900 + x * 1.7 + y) * 0.6;
      ctx.fillStyle = tile.accent!;
      ctx.beginPath();
      ctx.arc(sx + 8 + sway, sy + 7, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = tile.color;
      ctx.beginPath();
      ctx.arc(sx + 6.5 + sway, sy + 8.5, 4.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "wall":
      ctx.fillStyle = tile.accent!;
      for (let row = 0; row < 4; row++) {
        const off = row % 2 === 0 ? 0 : 4;
        for (let bx = -4; bx < TILE; bx += 8) {
          ctx.fillRect(sx + bx + off + 1, sy + row * 4 + 1, 6, 3);
        }
      }
      if (hash(x, y, 3) > 0.72) {
        ctx.fillStyle = "#c8d6e8";
        ctx.fillRect(sx + 4, sy + 4, 8, 7);
        ctx.fillStyle = "#5b6a80";
        ctx.fillRect(sx + 4, sy + 4, 8, 3);
      }
      break;

    case "roof":
      ctx.fillStyle = tile.accent!;
      for (let row = 0; row < TILE; row += 4) {
        ctx.fillRect(sx, sy + row, TILE, 2);
      }
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(sx, sy + TILE - 2, TILE, 2);
      break;

    case "road":
      speckle(ctx, x, y, sx, sy, "#45454b", 3);
      if (x % 3 === 1) {
        ctx.fillStyle = tile.accent!;
        ctx.fillRect(sx + 6, sy + 7, 5, 2);
      }
      break;

    case "crosswalk":
      ctx.fillStyle = tile.accent!;
      ctx.fillRect(sx + 2, sy, 5, TILE);
      ctx.fillRect(sx + 10, sy, 4, TILE);
      break;

    case "pavement":
      ctx.strokeStyle = "rgba(0,0,0,0.16)";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
      speckle(ctx, x, y, sx, sy, tile.accent!, 2);
      break;

    case "marble": {
      // This used to be two light greys in an 8px checker, which is exactly
      // the pattern every image editor uses to mean "nothing here" — the
      // fountain plaza is a solid 13x7 field of it and read as a hole in the
      // map. Polished slabs instead: one flat tone per tile, a grout line, and
      // a little veining.
      const tone = hash(x, y, 31);
      if (tone > 0.72) {
        ctx.fillStyle = tile.accent!;
        ctx.fillRect(sx, sy, TILE, TILE);
      }
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(sx, sy, TILE, 1);
      ctx.fillStyle = "rgba(0,0,0,0.13)";
      ctx.fillRect(sx, sy + TILE - 1, TILE, 1);
      ctx.fillRect(sx + TILE - 1, sy, 1, TILE);

      if (tone < 0.34) {
        // A vein wandering across the slab, fixed per tile so it never crawls.
        ctx.fillStyle = "rgba(120,124,132,0.34)";
        let vx = Math.floor(hash(x, y, 32) * (TILE - 4)) + 2;
        for (let vy = 3; vy < TILE - 2; vy++) {
          ctx.fillRect(sx + vx, sy + vy, 1, 1);
          vx += hash(x, y, 40 + vy) > 0.5 ? 1 : -1;
          vx = vx < 2 ? 2 : vx > TILE - 3 ? TILE - 3 : vx;
        }
      }
      break;
    }

    case "gravel":
      speckle(ctx, x, y, sx, sy, tile.accent!, 6);
      break;

    case "cliff":
      ctx.fillStyle = tile.accent!;
      ctx.fillRect(sx, sy, TILE, 4);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      for (let i = 0; i < 3; i++) {
        const hx = Math.floor(hash(x, y, i) * 12);
        ctx.fillRect(sx + hx, sy + 6 + i * 3, 4, 2);
      }
      break;

    case "water": {
      const wob = Math.sin(t / 400 + x + y) * 1.5;
      ctx.fillStyle = tile.accent!;
      ctx.fillRect(sx + 2, sy + 4 + wob, 12, 2);
      ctx.fillRect(sx + 4, sy + 10 - wob, 8, 2);
      break;
    }

    case "fence":
      ctx.fillStyle = tile.accent!;
      ctx.fillRect(sx + 2, sy + 4, 2, 11);
      ctx.fillRect(sx + 11, sy + 4, 2, 11);
      ctx.fillRect(sx, sy + 6, TILE, 2);
      ctx.fillRect(sx, sy + 11, TILE, 2);
      break;

    case "hedge":
      ctx.fillStyle = tile.accent!;
      for (let i = 0; i < 5; i++) {
        const hx = Math.floor(hash(x, y, i) * 12);
        const hy = Math.floor(hash(x, y, i + 20) * 12);
        ctx.beginPath();
        ctx.arc(sx + hx + 2, sy + hy + 2, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;

    case "bench":
      ctx.fillStyle = "#6d6b66";
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = tile.accent!;
      ctx.fillRect(sx + 1, sy + 6, 14, 3);
      ctx.fillRect(sx + 1, sy + 10, 14, 2);
      ctx.fillStyle = "#4a4844";
      ctx.fillRect(sx + 2, sy + 12, 2, 3);
      ctx.fillRect(sx + 12, sy + 12, 2, 3);
      break;

    case "dumpster":
      ctx.fillStyle = tile.color;
      ctx.fillRect(sx + 1, sy + 4, 14, 11);
      ctx.fillStyle = tile.accent!;
      ctx.fillRect(sx + 1, sy + 3, 14, 3);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(sx + 3, sy + 8, 10, 1);
      break;

    case "bin":
      ctx.fillStyle = tile.color;
      ctx.fillRect(sx + 3, sy + 4, 10, 11);
      ctx.fillStyle = tile.accent!;
      ctx.fillRect(sx + 2, sy + 3, 12, 2);
      ctx.fillStyle = "#e8e8e0";
      ctx.fillRect(sx + 6, sy + 8, 4, 4);
      break;

    case "lamp":
      ctx.fillStyle = "#3a3a3e";
      ctx.fillRect(sx + 7, sy + 4, 2, 12);
      ctx.fillStyle = "#d8cf9a";
      ctx.fillRect(sx + 5, sy + 1, 6, 4);
      break;

    case "sign":
      ctx.fillStyle = "#5a4830";
      ctx.fillRect(sx + 7, sy + 8, 2, 8);
      ctx.fillStyle = tile.accent!;
      ctx.fillRect(sx + 2, sy + 2, 12, 7);
      ctx.fillStyle = "#6b6250";
      ctx.fillRect(sx + 4, sy + 4, 8, 1);
      ctx.fillRect(sx + 4, sy + 6, 6, 1);
      break;

    case "gate":
      ctx.fillStyle = tile.color;
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = tile.accent!;
      for (let i = 1; i < TILE; i += 4) ctx.fillRect(sx + i, sy + 2, 2, 12);
      ctx.fillRect(sx, sy + 3, TILE, 2);
      break;

    default:
      break;
  }
}

function speckle(ctx: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number, color: string, n: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const hx = Math.floor(hash(x, y, i * 11) * TILE);
    const hy = Math.floor(hash(x, y, i * 11 + 5) * TILE);
    ctx.fillRect(sx + hx, sy + hy, 1, 1);
  }
}

/* ----------------------------------------------------------------- player */

function drawPlayer(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera, t: number): void {
  const p = s.player;
  const at = playerTile(s);
  // Feet at the middle of the tile's diamond; the sprite itself stays upright.
  // Skewing the player the way the ground is skewed would lay them flat on it.
  const footX = Math.round(isoX(at.x, at.y) - cam.px);
  const footY = Math.round(isoY(at.x, at.y) - cam.py + TH / 2);
  const sx = footX - TILE / 2;
  const sy = footY - TILE + 2;

  const walking = p.moveFrom !== null;
  const bob = walking ? (Math.floor(t / 110) % 2 === 0 ? 0 : 1) : 0;

  // Shadow, flattened onto the ground plane.
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(footX, footY, 6, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  const outfit = OUTFITS[s.wearing];
  const body = outfitColor(s.wearing);
  const grimy = s.meters.hygiene < 35;

  // Legs
  ctx.fillStyle = grimy ? "#4a4038" : "#39404f";
  ctx.fillRect(sx + 5, sy + 11 - bob, 2, 4);
  ctx.fillRect(sx + 9, sy + 11 + bob, 2, 4);

  // Torso
  ctx.fillStyle = body;
  ctx.fillRect(sx + 4, sy + 6 - bob, 8, 6);
  if (outfit.presentation >= 60) {
    ctx.fillStyle = "#e8e8e4";
    ctx.fillRect(sx + 7, sy + 6 - bob, 2, 5);
  }
  if (grimy) {
    ctx.fillStyle = "rgba(60,45,30,0.45)";
    ctx.fillRect(sx + 4, sy + 9 - bob, 8, 3);
  }

  // Head
  ctx.fillStyle = "#d9a97e";
  ctx.fillRect(sx + 5, sy + 1 - bob, 6, 6);
  ctx.fillStyle = grimy ? "#4a3a28" : "#37302a";
  ctx.fillRect(sx + 5, sy + 1 - bob, 6, 2);
  if (s.meters.hygiene < 25) {
    ctx.fillStyle = "#5a4a38";
    ctx.fillRect(sx + 5, sy + 5 - bob, 6, 2);
  }

  // Eyes, if we're facing the camera at all
  ctx.fillStyle = "#20181a";
  if (p.facing === "down") {
    ctx.fillRect(sx + 6, sy + 4 - bob, 1, 1);
    ctx.fillRect(sx + 9, sy + 4 - bob, 1, 1);
  } else if (p.facing === "left") {
    ctx.fillRect(sx + 5, sy + 4 - bob, 1, 1);
  } else if (p.facing === "right") {
    ctx.fillRect(sx + 10, sy + 4 - bob, 1, 1);
  }

  if (s.sick) {
    ctx.fillStyle = `rgba(120,190,120,${0.25 + Math.sin(t / 400) * 0.1})`;
    ctx.fillRect(sx + 4, sy, 8, 8);
  }
}

function outfitColor(id: GameState["wearing"]): string {
  switch (id) {
    case "rags":
      return "#6b5a48";
    case "thrift":
      return "#4a6b78";
    case "smartCasual":
      return "#3d5a86";
    case "professional":
      return "#2c3550";
    case "tailored":
      return "#1d2233";
  }
}

/* ------------------------------------------------------- overlays & light */

function drawLighting(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera): void {
  const light = daylight(s.time);
  const weather = WEATHER[s.weather];

  if (light < 1) {
    const darkness = (1 - light) * 0.72;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(10,14,34,${darkness})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Street lamps punch back through the dark.
    if (darkness > 0.15) {
      ctx.globalCompositeOperation = "lighter";
      const b = visibleBounds(cam);
      for (let y = b.y0; y <= b.y1; y++) {
        for (let x = b.x0; x <= b.x1; x++) {
          if (glyphAt(townOf(s), x, y) !== "L") continue;
          // At the top of the lamp post, not at its foot.
          const cx = isoX(x, y) - cam.px;
          const cy = isoY(x, y) - cam.py + TH / 2 - STANDS.lamp!;
          const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 46);
          g.addColorStop(0, `rgba(255,214,140,${0.55 * darkness})`);
          g.addColorStop(1, "rgba(255,214,140,0)");
          ctx.fillStyle = g;
          ctx.fillRect(cx - 48, cy - 48, 96, 96);
        }
      }
    }
    ctx.restore();
  }

  if (weather.tintAlpha > 0) {
    ctx.fillStyle = weather.tint;
    ctx.globalAlpha = weather.tintAlpha * (0.4 + light * 0.6);
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.globalAlpha = 1;
  }
}

function drawWeather(ctx: CanvasRenderingContext2D, s: GameState, t: number): void {
  const w = WEATHER[s.weather];
  if (!w.wet) return;
  const drops = s.weather === "storm" ? 150 : 80;
  const speed = s.weather === "storm" ? 0.9 : 0.55;
  const slant = s.weather === "storm" ? 4 : 2;
  ctx.strokeStyle = s.weather === "storm" ? "rgba(190,215,255,0.55)" : "rgba(180,205,235,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < drops; i++) {
    const seed = hash(i, 1) * 1000;
    const x = (hash(i, 2) * CANVAS_W + seed * 0.1) % CANVAS_W;
    const y = (hash(i, 3) * CANVAS_H + t * speed) % CANVAS_H;
    ctx.moveTo(x, y);
    ctx.lineTo(x - slant, y + 6);
  }
  ctx.stroke();

  if (s.weather === "storm" && Math.sin(t / 2000) > 0.995) {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
}

/**
 * A nameplate over every door in view. Without these the town is a wall of
 * identical brown buildings and the only way to learn which is the hostel is
 * to walk into all of them.
 */
// ---------------------------------------------------------------------------
// 3×5 pixel bitmap font — drawn entirely with fillRect, zero antialiasing.
// Each entry is 5 row masks; bit2=left col, bit1=mid col, bit0=right col.
// ---------------------------------------------------------------------------
const BITMAP_FONT: Record<string, number[]> = {
  A: [2, 5, 7, 5, 5],
  B: [6, 5, 6, 5, 6],
  C: [3, 4, 4, 4, 3],
  D: [6, 5, 5, 5, 6],
  E: [7, 4, 6, 4, 7],
  F: [7, 4, 6, 4, 4],
  G: [3, 4, 5, 5, 3],
  H: [5, 5, 7, 5, 5],
  I: [7, 2, 2, 2, 7],
  J: [7, 1, 1, 5, 2],
  K: [5, 6, 4, 6, 5],
  L: [4, 4, 4, 4, 7],
  M: [5, 7, 5, 5, 5],
  N: [6, 5, 5, 5, 5],
  O: [2, 5, 5, 5, 2],
  P: [6, 5, 6, 4, 4],
  Q: [2, 5, 5, 7, 3],
  R: [6, 5, 6, 5, 5],
  S: [3, 4, 2, 1, 6],
  T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 2],
  V: [5, 5, 5, 2, 2],
  W: [5, 5, 7, 7, 5],
  X: [5, 5, 2, 5, 5],
  Y: [5, 5, 2, 2, 2],
  Z: [7, 1, 2, 4, 7],
  " ": [0, 0, 0, 0, 0],
};

/** Draw a string using the bitmap font. fillStyle must be set by caller. */
function drawBitmapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): void {
  let cx = x;
  for (const ch of text) {
    const rows: number[] = BITMAP_FONT[ch] ?? BITMAP_FONT[" "] ?? [];
    for (let row = 0; row < 5; row++) {
      const bits = rows[row] ?? 0;
      if (bits & 4) ctx.fillRect(cx,     y + row, 1, 1);
      if (bits & 2) ctx.fillRect(cx + 1, y + row, 1, 1);
      if (bits & 1) ctx.fillRect(cx + 2, y + row, 1, 1);
    }
    cx += 4; // 3px glyph + 1px gap
  }
}

/** Width of a string in the bitmap font (pixels). */
function bitmapTextWidth(text: string): number {
  return text.length * 4 - 1; // no trailing gap
}

function drawDoorSigns(ctx: CanvasRenderingContext2D, town: Town, cam: Camera): void {
  for (const [id, pos] of Object.entries(town.markers)) {
    const sign = DOOR_SIGNS[id];
    if (!sign) continue;

    const cx = isoX(pos.x, pos.y) - cam.px;
    // Above the top face of the wall the door is cut into, where a real sign
    // would be — the door tile stands up now, so this has to clear it.
    const cy = isoY(pos.x, pos.y) - cam.py + TH / 2 - STANDS.wall! - 7;
    if (cx < -40 || cy < -8 || cx > CANVAS_W + 40 || cy > CANVAS_H + 8) continue;

    const tw = bitmapTextWidth(sign);
    const x = Math.round(cx - tw / 2);
    const y = Math.round(cy - 2); // vertically centre the 5-tall glyph in the 8px band

    // Dark backing pill
    ctx.fillStyle = "rgba(16,16,20,0.85)";
    ctx.fillRect(x - 2, y - 1, tw + 4, 7);

    // Crisp bitmap text — pure fillRect, no antialiasing
    ctx.fillStyle = "rgba(240,232,200,0.95)";
    drawBitmapText(ctx, sign, x, y);
  }
}

function drawAssignmentMarkers(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera, t: number): void {
  const a = s.assignment;
  if (!a || a.ready) return;
  for (const target of a.targets) {
    const sx = isoX(target.x, target.y) - cam.px;
    const sy = isoY(target.x, target.y) - cam.py + TH / 2;
    if (sx < -TW || sy < -TH || sx > CANVAS_W + TW || sy > CANVAS_H + TH) continue;
    const bounce = Math.sin(t / 260) * 2;
    const tip = sy - 20 + bounce;
    ctx.fillStyle = "#f0c85a";
    ctx.beginPath();
    ctx.moveTo(sx, tip + 6);
    ctx.lineTo(sx - 5, tip);
    ctx.lineTo(sx + 5, tip);
    ctx.closePath();
    ctx.fill();
  }
}

function drawFacingCursor(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera, t: number): void {
  if (s.player.moveFrom) return;
  const cell = facingTile(s);
  const highlight = assignmentStopAt(s, cell) >= 0;
  ctx.strokeStyle = highlight ? "rgba(240,200,90,0.9)" : `rgba(255,255,255,${0.20 + Math.sin(t / 500) * 0.08})`;
  ctx.lineWidth = 1;
  diamondPath(ctx, isoX(cell.x, cell.y) - cam.px, isoY(cell.x, cell.y) - cam.py, -1);
  ctx.stroke();
}

/* ----------------------------------------------------------------- minimap */

/**
 * Minimap colours tuned for small scale — needs higher contrast than the
 * full-size tile palette because detail decoration never fires at this scale.
 */
const MINIMAP_COLOR: Record<string, string> = {
  W:   "#131318", // outer retaining wall
  "#": "#5e4636", // building wall
  "^": "#7c3a32", // roof
  "=": "#2d2d34", // road
  c:   "#2d2d34", // crosswalk
  _:   "#4e4c48", // pavement
  M:   "#4e4c48", // marble
  s:   "#5a4e3a", // dirt path
  r:   "#484440", // gravel
  ".": "#2c4e28", // grass
  ",": "#253e23", // weeds
  "+": "#2e5029", // flower bed
  T:   "#1c3820", // tree
  H:   "#1e3622", // hedge
  "~": "#1a3855", // water
  I:   "#5e5040", // indoor floor
  b:   "#4a4038", // bench
  "%": "#3c4830", // dumpster
  x:   "#1e3e52", // recycling bin
  f:   "#3e3020", // fence
  G:   "#2e2e28", // gate
  L:   "#3a3838", // lamp post
  n:   "#3c3020", // sign
};

function minimapTileColor(glyph: string | undefined): string {
  if (glyph === undefined) return "#0b0b0f";
  return MINIMAP_COLOR[glyph] ?? tileAt(glyph).color;
}

function drawMinimap(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera, timeMs: number): void {
  const town = townOf(s);
  const mapW = town.width;
  const mapH = town.height;

  // Scale to fit within the canvas with a margin, max 3px per tile.
  const MARGIN = 8;
  const SCALE = Math.min(3, Math.floor(
    Math.min((CANVAS_W - MARGIN * 2) / mapW, (CANVAS_H - MARGIN * 2) / mapH),
  ));

  const mw = mapW * SCALE;
  const mh = mapH * SCALE;
  const cx = Math.round((CANVAS_W - mw) / 2);
  const cy = Math.round((CANVAS_H - mh) / 2);

  // Full-canvas dim overlay
  ctx.fillStyle = "rgba(0,0,0,0.82)";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Map panel border
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(cx - 2, cy - 2, mw + 4, mh + 4);

  // Tile pixels
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      ctx.fillStyle = minimapTileColor(glyphAt(town, x, y));
      ctx.fillRect(cx + x * SCALE, cy + y * SCALE, SCALE, SCALE);
    }
  }

  // Venue dots — white pixel at every marker door
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  for (const pos of Object.values(town.markers)) {
    ctx.fillRect(cx + pos.x * SCALE, cy + pos.y * SCALE, SCALE, SCALE);
  }

  // Active assignment: blinking gold stop markers
  const asgn = s.assignment;
  if (asgn && !asgn.ready && asgn.targets.length > 0) {
    const blink = Math.floor(timeMs / 500) % 2 === 0;
    if (blink) {
      ctx.fillStyle = "#f0c85a";
      for (const stop of asgn.targets) {
        ctx.fillRect(cx + stop.x * SCALE - 1, cy + stop.y * SCALE - 1, SCALE + 2, SCALE + 2);
      }
    }
    // Always draw a cross-hair centre so the dot is legible even when dark
    ctx.fillStyle = blink ? "#fffbe0" : "#f0c85a";
    for (const stop of asgn.targets) {
      ctx.fillRect(cx + stop.x * SCALE, cy + stop.y * SCALE, SCALE, SCALE);
    }
  }

  // What the screen can see, which on a top-down minimap of an isometric view
  // is a diamond rather than a rectangle.
  const corners = (
    [
      [0, 0],
      [CANVAS_W, 0],
      [CANVAS_W, CANVAS_H],
      [0, CANVAS_H],
    ] as const
  ).map(([sx, sy]) => screenToTile(sx + cam.px, sy + cam.py));
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  corners.forEach((c, i) => {
    const px = cx + c.x * SCALE + 0.5;
    const py = cy + c.y * SCALE + 0.5;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.stroke();

  // Player dot
  const pdx = cx + s.player.pos.x * SCALE;
  const pdy = cy + s.player.pos.y * SCALE;
  ctx.fillStyle = "#f5e642";
  ctx.fillRect(pdx - 1, pdy - 1, SCALE + 2, SCALE + 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(pdx, pdy, SCALE, SCALE);

  // Town name above the panel (with deadline if active)
  const townLabel = s.player.town.toUpperCase();
  const labelW = bitmapTextWidth(townLabel);
  ctx.fillStyle = "rgba(240,232,200,0.75)";
  drawBitmapText(ctx, townLabel, cx + Math.round((mw - labelW) / 2), cy - 18);

  if (asgn && !asgn.ready && (asgn.deadlineMin ?? 0) > 0) {
    const minsLeft = Math.max(0, Math.ceil((asgn.deadlineMin ?? 0) - s.time));
    const hh = Math.floor(minsLeft / 60);
    const mm = minsLeft % 60;
    const timeStr = hh > 0 ? `${hh}H ${mm < 10 ? "0" : ""}${mm}M` : `${mm}M`;
    const deadlineLabel = `${timeStr} LEFT`;
    const dlW = bitmapTextWidth(deadlineLabel);
    // Red when < 30 min, amber otherwise
    ctx.fillStyle = minsLeft < 30 ? "rgba(240,80,60,0.95)" : "rgba(240,200,80,0.9)";
    drawBitmapText(ctx, deadlineLabel, cx + Math.round((mw - dlW) / 2), cy - 10);
  }

  // "M · CLOSE" hint below the panel
  const hint = "M  CLOSE";
  const hintW = bitmapTextWidth(hint);
  ctx.fillStyle = "rgba(180,170,145,0.55)";
  drawBitmapText(ctx, hint, cx + Math.round((mw - hintW) / 2), cy + mh + 6);
}
