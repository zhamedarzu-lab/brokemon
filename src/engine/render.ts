import { glyphAt, MAP_HEIGHT, MAP_WIDTH, TOWN } from "../world/map";
import { tileAt } from "../world/tiles";
import { daylight } from "../sim/time";
import { WEATHER } from "../sim/weather";
import type { GameState } from "../sim/state";
import { OUTFITS } from "../sim/social";
import { assignmentStopAt, DOOR_SIGNS, facingTile } from "../sim/actions";

export const TILE = 16;
export const VIEW_W = 21;
export const VIEW_H = 15;
export const CANVAS_W = VIEW_W * TILE;
export const CANVAS_H = VIEW_H * TILE;

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

export function cameraFor(state: GameState): Camera {
  const p = state.player;
  let wx = p.pos.x * TILE;
  let wy = p.pos.y * TILE;
  if (p.moveFrom) {
    const t = p.moveProgress;
    wx = (p.moveFrom.x + (p.pos.x - p.moveFrom.x) * t) * TILE;
    wy = (p.moveFrom.y + (p.pos.y - p.moveFrom.y) * t) * TILE;
  }
  const px = clamp(Math.round(wx + TILE / 2 - CANVAS_W / 2), 0, MAP_WIDTH * TILE - CANVAS_W);
  const py = clamp(Math.round(wy + TILE / 2 - CANVAS_H / 2), 0, MAP_HEIGHT * TILE - CANVAS_H);
  return { px, py };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function render(ctx: CanvasRenderingContext2D, state: GameState, timeMs: number): void {
  const cam = cameraFor(state);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#101014";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const x0 = Math.floor(cam.px / TILE);
  const y0 = Math.floor(cam.py / TILE);

  for (let y = y0; y <= y0 + VIEW_H; y++) {
    for (let x = x0; x <= x0 + VIEW_W; x++) {
      const sx = x * TILE - cam.px;
      const sy = y * TILE - cam.py;
      drawTile(ctx, x, y, sx, sy, timeMs);
    }
  }

  drawDoorSigns(ctx, cam);
  drawAssignmentMarkers(ctx, state, cam, timeMs);
  drawPlayer(ctx, state, cam, timeMs);
  drawLighting(ctx, state, cam);
  drawWeather(ctx, state, timeMs);
  drawFacingCursor(ctx, state, cam, timeMs);
}

/* ------------------------------------------------------------------ tiles */

function drawTile(ctx: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number, t: number): void {
  const glyph = glyphAt(x, y);
  if (glyph === undefined) {
    ctx.fillStyle = "#0b0b0f";
    ctx.fillRect(sx, sy, TILE, TILE);
    return;
  }
  const tile = tileAt(glyph);
  ctx.fillStyle = tile.color;
  ctx.fillRect(sx, sy, TILE, TILE);

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
  let wx = p.pos.x * TILE;
  let wy = p.pos.y * TILE;
  if (p.moveFrom) {
    const k = p.moveProgress;
    wx = (p.moveFrom.x + (p.pos.x - p.moveFrom.x) * k) * TILE;
    wy = (p.moveFrom.y + (p.pos.y - p.moveFrom.y) * k) * TILE;
  }
  const sx = Math.round(wx - cam.px);
  const sy = Math.round(wy - cam.py);

  const walking = p.moveFrom !== null;
  const bob = walking ? (Math.floor(t / 110) % 2 === 0 ? 0 : 1) : 0;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(sx + 8, sy + 14, 5, 2, 0, 0, Math.PI * 2);
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
      const x0 = Math.floor(cam.px / TILE) - 1;
      const y0 = Math.floor(cam.py / TILE) - 1;
      for (let y = y0; y <= y0 + VIEW_H + 2; y++) {
        for (let x = x0; x <= x0 + VIEW_W + 2; x++) {
          if (glyphAt(x, y) !== "L") continue;
          const cx = x * TILE - cam.px + 8;
          const cy = y * TILE - cam.py + 3;
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
function drawDoorSigns(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.font = "6px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const [id, pos] of Object.entries(TOWN.markers)) {
    const sign = DOOR_SIGNS[id];
    if (!sign) continue;

    const cx = pos.x * TILE - cam.px + TILE / 2;
    // Sits in the wall above the doorway, where a real sign would be.
    const cy = pos.y * TILE - cam.py - 4;
    if (cx < -40 || cy < -8 || cx > CANVAS_W + 40 || cy > CANVAS_H + 8) continue;

    const w = ctx.measureText(sign).width + 4;
    ctx.fillStyle = "rgba(16,16,20,0.82)";
    ctx.fillRect(Math.round(cx - w / 2), cy - 4, Math.round(w), 8);
    ctx.fillStyle = "rgba(240,232,200,0.94)";
    ctx.fillText(sign, Math.round(cx), cy);
  }

  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawAssignmentMarkers(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera, t: number): void {
  const a = s.assignment;
  if (!a || a.ready) return;
  for (const target of a.targets) {
    const sx = target.x * TILE - cam.px;
    const sy = target.y * TILE - cam.py;
    if (sx < -TILE || sy < -TILE || sx > CANVAS_W || sy > CANVAS_H) continue;
    const bounce = Math.sin(t / 260) * 2;
    ctx.fillStyle = "#f0c85a";
    ctx.beginPath();
    ctx.moveTo(sx + 8, sy - 2 + bounce + 6);
    ctx.lineTo(sx + 3, sy - 2 + bounce);
    ctx.lineTo(sx + 13, sy - 2 + bounce);
    ctx.closePath();
    ctx.fill();
  }
}

function drawFacingCursor(ctx: CanvasRenderingContext2D, s: GameState, cam: Camera, t: number): void {
  if (s.player.moveFrom) return;
  const cell = facingTile(s);
  const sx = cell.x * TILE - cam.px;
  const sy = cell.y * TILE - cam.py;
  const highlight = assignmentStopAt(s, cell) >= 0;
  ctx.strokeStyle = highlight ? "rgba(240,200,90,0.9)" : `rgba(255,255,255,${0.16 + Math.sin(t / 500) * 0.06})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
}
