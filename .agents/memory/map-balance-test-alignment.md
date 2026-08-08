---
name: Map changes and the test rigs
description: How the test rigs find scenery. Do not write tile coordinates into test files — they go stale silently.
---

## The rule

**Never hardcode a tile coordinate.** Ask `src/world/landmarks.ts` for the kind
of thing you want:

```ts
import { approaches, sleepableBenches } from "../world/landmarks";

const FOUNTAIN = approaches("water")[0]!;   // { target, pos, facing }
const DUMPSTERS = approaches("dumpster");
const BENCH = sleepableBenches()[0]!;       // only zones with fineScale === 0
```

Each returns an `Approach`: the scenery tile, a walkable tile beside it, and
the direction to face. Feed it to the rig's `approach()` helper.

**Why it matters.** Dumpsters, water and benches are terrain, not named
markers, so nothing refers to them by name. Twice now a map change has left
coordinates pointing at open pavement, and *nothing failed* — the bot walked to
where a dumpster used to be, `interact()` returned null, and the run was
reported as healthy despite never having scavenged, drunk or slept. A rig that
lies quietly is worse than no rig.

The most recent case was the 48x50 → 72x72 expansion. `balance.test.ts` and
`events.test.ts` were updated by hand; `playtest.ts` and `progression.test.ts`
were not, and both went on passing.

`world/map.test.ts` now guards this: it asserts the town still has water,
dumpsters and a legally sleepable bench, that free water exists in the
outskirts and not only downtown, and that all three are reachable on foot
without passing the Heights gate.

## What still has to move by hand

- `inZone()` in `events.test.ts` — representative y per zone. Update if the
  zone bands in `ZONES` change.
- Gate tests in `balance.test.ts` — the gate must stay at row 14, cols 23-24,
  or update `standAt(23, 15/13, ...)` and the `y <= 13` check in `playtest.ts`.

## After any map change

Run the walking rig, not just the suite:

```
npm run playtest
```

The suite teleports and pays a flat 10 minutes per move, so it cannot see
distance at all. The expansion pushed average walking from ~95 to ~170 minutes
a day and sent one seed from 126 days to 320; every test passed throughout.

## Building facade design (thin buildings)

Buildings are 2 rows deep — 1 row roof (`^`) + 1 row wall (`#`) with a door
marker that becomes an `I` floor tile. The player stands in the doorway. Do NOT
make buildings taller unless intentional; tall buildings were the original bug.

## Map layout summary (72x72)

- Row 0/71: outer walls
- Heights gate: row 14, `G` at cols 23-24 — the only way in or out of the hill
- Heights: rows 0-14. Downtown: rows 15-49. Outskirts: rows 50-71
- Free water: the lake at rows 21-24 (downtown) and a standpipe at 12-13,62
  (outskirts). Thirst drains 120/day, so both matter
- Markers: communityCenter (7,30), college (64,30), laundromat (5,36),
  mart (32,36), diner (61,36), jobBoard (8,41), busStop (27,41),
  hostel (7,52), recycling (33,52), apartment (62,52), trailer (6,60),
  bikeShop (42,60), bank (35,26), estate (9,3), corporatePlaza (33,3)
