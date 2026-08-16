# Defect Report — Vertical Movement Choppiness

**Date:** 2026-08-16
**Status:** Fixed, with a regression test that fails on the original code
**Area:** `src/engine/render.ts` — camera, shadow, and every consumer of the camera

> **Revision note.** The first version of this report diagnosed the cause as
> vertical movement advancing fewer pixels per frame than horizontal. That is
> not what was happening — the two rates are identical and are pinned by a test
> — and the fix it proposed under "Remaining Risk" (raise `TD` to 16, or slow
> the step animation) would have traded a real property away to chase a cause
> that does not exist. The applied fix was nevertheless the right one, for the
> reason set out below. The shadow analysis was correct as written and is kept.

---

## Description

Walking with any north/south component produces visibly choppy movement. The
player appears to twitch one pixel up and back during the step.

It affects **six of the eight directions**, not two: north, south, and all four
diagonals. Only due east and due west are clean. The original report described
it as "vertical is choppy, horizontal is smooth", which is true as far as it
goes but understates the reach — a diagonal has a vertical component and chops
exactly like a vertical step.

A secondary symptom, reported first: the player's shadow flickered and appeared
half-clipped while walking vertically.

---

## Root cause: half a pixel, not a slower frame rate

### What it is not

The projection uses two tile dimensions — `TW` 20 across, `TD` 15 deep — so it
is tempting to conclude that the camera advances fewer pixels per frame
vertically and therefore stutters. Measured:

| direction | px/step | animScale | duration | px/ms | **px/frame @60fps** |
|---|---|---|---|---|---|
| east | 20 | 1.00 | 180 ms | 0.1111 | **1.852** |
| south | 15 | 0.75 | 135 ms | 0.1111 | **1.852** |
| south-east | 25 | 1.25 | 225 ms | 0.1111 | **1.852** |

The rates are identical, because `stepPacing` shortens a vertical step to 135 ms
against a horizontal step's 180 ms for exactly this purpose. `move.test.ts` has
asserted "the same number of pixels a second in every direction" to ten decimal
places since the projection changed.

The figures 1.11 and 0.83 in the first version of this report are `20 / 180` and
`15 / 180` — pixels per *millisecond*, computed as though both steps ran the
full 180 ms. That drops `animScale`, which is the one mechanism in the file
written to prevent this exact asymmetry.

### What it is

`cameraFor` centres the player:

```ts
const px = screenX(at.x, at.y) + TW / 2 - CANVAS_W / 2;
const py = screenY(at.x, at.y) + TD / 2 - CANVAS_H / 2;
```

`TW / 2` is **10**, an integer. `TD / 2` is **7.5**. So `cam.py` carries half a
pixel permanently — at rest, mid-step, always — and `cam.px` never does.

The player is then drawn at `Math.round(screenY(...) - cam.py + TD)`. With the
half in place that expression sits exactly on a rounding boundary, so it flips
between two integers as the fractional part drifts across it. Traced across one
southward step with the camera rounded:

```
east   168 168 168 168 168 168 168 168 168 168 168 168   <- 0 jumps
south  127 128 128 128 128 127 127 127 127               <- 2 jumps
```

The world slid smoothly; the sprite twitched on top of it. That is the chop.

---

## Shadow flicker (related, and correctly diagnosed first time)

The shadow was drawn with `ctx.ellipse`, which the browser anti-aliases
regardless of `imageSmoothingEnabled` — so its sub-pixel centre shifted every
frame and read as flicker.

Separately, its bottom pixel landed exactly where the next tile row begins
painting. The painter draws row by row and inserts the player after their own
row, so the row below painted *over* the lower half of the shadow.

Fixed by replacing the ellipse with three `fillRect` rows, and anchoring the
shadow to the integer `playerRow` rather than the fractional `footY`.

---

## Fix

**1. Sub-pixel camera.** `Math.round` removed from `cameraFor`'s return, so the
camera tracks the player continuously. The player's drawn position is then
constant — 128 every frame — instead of alternating.

Worth being precise about what this did *not* change: tile positions. The old
code computed `int - round(c)` and the new one computes `round(int - c)`, which
are the same number except at an exact `.5` tie — measured at 840 of 16,040
sampled row positions, about 5%. The tiles were never the problem.

**2. Everything drawn snaps.** A fractional camera is only safe if no consumer
draws at those coordinates raw, and five did. The worst was the facing cursor:

```ts
ctx.strokeRect(screenX(...) - cam.px + 0.5, screenY(...) - cam.py + 0.5, ...)
```

`+ 0.5` is the standard crisp-hairline trick and it needs an **integer** base.
With the half already in `cam.py` it landed on a pixel boundary and drew as two
half-lit rows. Measured off the canvas, cursor at (32,37):

| | before | after |
|---|---|---|
| vertical edge (`cam.px` integer) | one column, 140 vs 119 background | unchanged |
| horizontal edge (`cam.py` + .5) | **two rows, +9.3 each** | **one row, +19.7** |

All world-to-screen conversions now go through `snap(cam, x, y)`, which rounds.
The camera stays fractional; nothing is drawn at a fraction.

---

## The second defect: the legs were being painted over

Fixing the sprite's *position* left a visible chop, because position was only
half of it. The camera tracks `at.y` exactly, so the sprite holds still on
screen while the world scrolls under it — which means **the tile row one south
sweeps up through the sprite's legs** on every southward step. Whether it
erases them is purely a question of the painter's sort order.

`playerRow` was `Math.round(at.y)`. While `round` still returned `floor`, the
row below sorted *after* the player and painted over the legs; at the halfway
point `round` flipped to `floor + 1` and they snapped back. Measured over a
step: **overdrawn for 45% of it, then not**, which is a hard flip mid-stride.

Measured off the canvas — dark pixels in the leg band, frame by frame, walking
south:

| sort | frames | verdict |
|---|---|---|
| `Math.round(at.y)` | `28 0 64 64 46 28 0 64 64 46 …` | legs **fully erased**, ~1 frame in 5 |
| `Math.floor(at.y) + 1` | `64 64 64 64 56 64 64 64 64 56 …` | steady; the dip to 56 is the leg animation |

The sort row is now `playerSortRow(y)`, exported so the invariant is testable
rather than inferred. `inFrontRow` stays at `Math.floor(at.y)` for the
transparency test, so tall tiles immediately south still fade.

A residue was measured and left alone: the row *two* south reaches the shadow's
bottom pixel for 6.6% of a southward step. That is one pixel of a 28%-alpha
shadow, below perception, and the frame-by-frame counts above show no
disruption. Anchoring the shadow a pixel higher to dodge it would trade an
invisible clip for a visible 1px wobble.

## Regression test

`move.test.ts` — "the player does not jitter on the spot while walking". For
each of the eight steps it samples the animation at 60 points and asserts the
sprite's drawn position takes exactly **one** value. On the pre-fix camera it
fails for six directions with `expected [ '168,127', '168,128' ] to have a
length of 1`.

It asserts the symptom rather than the mechanism, so it still holds if the
projection constants move. A companion test pins `cam.py` as non-integer, to
stop the rounding being tidied back into `cameraFor`.

That test could not see the second defect at all — the sprite never moved a
pixel while its legs were being erased — so there is a second one beside it:
"the row in front of the player is painted before the player", which samples
201 points across a step and fails on `Math.round` at 101 of them. A third
keeps the player sorted *behind* anything two rows south, because one row of
slack is what the legs need and more would walk them through the front of
buildings.

**The lesson worth keeping: a test that a sprite holds still says nothing about
whether it is still being drawn.**

---

## Remaining risk

Low, and not what the first version of this report suggested.

`TD = 15` is **not** the underlying constraint, and raising it to 16 would cost
the whole-pixel diagonals (20/15/25 is a 3-4-5 triangle) to fix nothing — the
half-pixel comes from `TD / 2` in the centring term, not from `TD` itself.
Slowing the step animation would not help either, for the same reason.

The live constraint is the discipline in fix 2: **any new draw call that
consumes `cam.px`/`cam.py` must snap.** The two legitimate exceptions are
`visibleBounds` and the minimap's `screenToTile`, which do bounds arithmetic
rather than drawing.
