# Defect Report — Vertical Movement Choppiness

**Date:** 2026-08-16  
**Status:** Partially mitigated; root cause addressed but may warrant further observation  
**Area:** `src/engine/render.ts` — camera and shadow rendering

---

## Description

Walking vertically (north/south) produces visibly choppy movement. Walking horizontally (east/west) is smooth. The chop manifests as the player appearing to pause for a frame then jump one pixel, repeating throughout the step animation.

A secondary symptom reported first: the player shadow flickered and appeared half-clipped while walking vertically.

---

## Root Cause

The projection uses two different tile dimensions:

| Axis | Constant | Value |
|------|----------|-------|
| Horizontal | `TW` | 20 px |
| Vertical (depth) | `TD` | 15 px |

The 20×15 ratio was chosen deliberately — it is a 4:3 scaling of the standard 3-4-5 right triangle, which guarantees every diagonal is a whole number of pixels. At true 45° (16×12 or 32×24) the same property holds; 20×15 was chosen because it shows roughly the same number of tiles as the original top-down view while giving each tile enough pixels to carry its art.

The consequence: the camera advances **15 px per tile vertically** but **20 px per tile horizontally**. At the animation speed used for a single step, the camera moves approximately:

- **Horizontal:** ~1.11 screen pixels per frame → always advances ≥ 1 px, smooth
- **Vertical:** ~0.83 screen pixels per frame → advances < 1 px, holds the same integer for 1–2 frames then jumps

The original camera code rounded its output to the nearest integer pixel:

```ts
return {
  px: Math.round(...),
  py: Math.round(...),
};
```

With vertical advancement at 0.83 px/frame, `Math.round` collapses multiple frames to the same integer value, then releases a 1 px jump — the classic sub-pixel stutter pattern.

An additional contributing factor: `TD / 2 = 7.5`, so the camera's vertical offset always carried a persistent 0.5-pixel fractional component, causing `Math.round` to round in alternating directions as the player moved. This made the stutter slightly worse than it would have been with a clean integer offset.

---

## Shadow Flicker (Related Symptom)

The player shadow was drawn as `ctx.ellipse(...)`, which is anti-aliased by the browser regardless of `ctx.imageSmoothingEnabled`. As the player moved vertically, the sub-pixel centre position changed each frame, causing the anti-aliasing pattern to shift and read as flicker.

A second problem: the shadow's bottom pixel landed exactly at the screen Y coordinate where the next tile row begins painting. Because the painter's algorithm draws tiles in row order and the player is inserted after their current row, the row below paints *after* the player — overwriting the lower half of the shadow each frame.

---

## Fixes Applied

### 1. Shadow flicker — `ctx.ellipse` → `fillRect` (first attempt)

Replaced the anti-aliased ellipse with three `fillRect` rows forming a pixelated oval. Eliminated the anti-aliasing flicker but the half-clip issue remained.

### 2. Shadow clip — anchor to integer row boundary

Stopped deriving the shadow's vertical position from `footY` (which tracks `at.y`, a fractional value during movement). Instead, anchored it to `playerRow` (the integer row used by the painter's sort):

```ts
const playerRow = Math.round(at.y);
const rowBottom = Math.round(playerRow * TD - cam.py + TD - 1);
```

This keeps the shadow's bottom pixel one pixel above the boundary where the next tile row begins, so tiles painted afterward no longer overwrite it.

### 3. Vertical choppiness — sub-pixel camera

Removed `Math.round` from the camera return value so the camera tracks the player continuously in floating-point:

```ts
// Before
return {
  px: Math.round(Math.min(Math.max(px, -overscanX), maxX + overscanX)),
  py: Math.round(Math.min(Math.max(py, -overscanY), maxY + overscanY)),
};

// After
return {
  px: Math.min(Math.max(px, -overscanX), maxX + overscanX),
  py: Math.min(Math.max(py, -overscanY), maxY + overscanY),
};
```

Each tile's screen position is then rounded individually at draw time:

```ts
const ox = Math.round(screenX(x, y) - cam.px);
const oy = Math.round(screenY(x, y) - cam.py);
```

Because all tiles in a given row share the same fractional component from `cam.py`, they all round in the same direction — consistent 15 px spacing is preserved and no seams appear between tiles. The camera now advances the full fractional amount each frame rather than holding a rounded integer, which removes the stutter.

---

## Remaining Risk

The 15 px vertical tile depth is the underlying constraint. The fixes above remove the rounding amplification of the problem, but at sufficiently low frame rates (or very fast step animations) the sub-pixel movement could become perceptible again. If the chop reappears under different conditions, options to explore are:

- Increasing `TD` to 16 (loses the clean-diagonal property but matches `TILE` exactly)
- Reducing step animation speed so each frame advances more pixels
- Storing camera position in a higher-precision accumulator and applying a proper pixel-snapping scheme per-draw
