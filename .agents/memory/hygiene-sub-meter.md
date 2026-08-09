---
name: Hygiene sub-meter pattern
description: How bodyClean/clothesClean feed meters.hygiene, and the test pitfall when both are out of sync.
---

## The rule

`meters.hygiene` is a **derived display value** — always `Math.round((bodyClean + clothesClean) / 2)`.
Never write to `meters.hygiene` directly in game code; use the helpers in `state.ts`:
- `restoreBody(s, amount)` — showering
- `restoreClothes(s, amount)` — laundry / buying new clothes
- `syncHygiene(s)` — after any direct write to bodyClean or clothesClean
- `dirtySelf(s, total, clothesFraction=0.65)` — work, rain, events

`decay()` in `meters.ts` also recomputes `meters.hygiene` from the sub-values every tick.

## Test pitfall

Any test that does:
```ts
s.meters = { ..., hygiene: 85 };
// then advances time (waitUntilHour, ctx.advance, etc.)
```
will have `meters.hygiene` overwritten by `decay()` because `bodyClean` and `clothesClean` are still at their initial values (22 each).

**Fix:** Always set both sub-values alongside:
```ts
s.meters = { ..., hygiene: 85 };
s.bodyClean = 85;
s.clothesClean = 85;
```

The same applies to `s.meters.hygiene = X` standalone assignments when a decay tick follows.

**Why:** `decay()` is called every `advance()` and recomputes `meters.hygiene` from the sub-values, ignoring any direct write to `meters.hygiene`.

## How to apply

- Whenever writing a new test that sets hygiene AND advances time, add the two sub-value lines.
- When the wash helpers in test files (e.g. `washAtShelter`, `wash()`) call a shower venue, also manually nudge `clothesClean` up if it's low — the venue only restores body, so the combined meter may not reach the threshold the helper is checking.
- The cooldown tests use the `cans` event ("A split bin bag", slums only) as the canonical repeatable test event, not `change` (deleted).
