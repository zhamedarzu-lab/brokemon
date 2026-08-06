# Brokemon

> The only thing you're catching is a break.

A top-down, grid-based town RPG in the shape of a classic monster-collecting
game, played straight as a survival sim about being broke. The Community Center
is a clinic and an overnight shelter. The Mart sells rations, soap and scratch
tickets, and will throw you out if you smell. The gym on the hill is a corporate
plaza behind a security gate that reads your clothes before it reads your name.

You wake up in the park on Route 1 with three dollars and $240 of debt. The loop
is **survive → clean up → earn → upgrade → ascend**, and every rung of it is
priced in hours and biology rather than experience points.

Runs entirely in the browser. No engine, no art assets, no network — the town is
48×50 hand-authored ASCII tiles and everything you see is drawn with canvas
primitives.

---

## Running it

```sh
npm install
npm run dev        # vite dev server
npm run build      # typecheck + production bundle into dist/
npm test           # 95 simulation tests
```

Controls: **arrows/WASD** move · **Z/Enter** interact · **X/Esc** back ·
**Tab** status, bag and the career ladder · **L** log · **P** save.
It autosaves to `localStorage` every 20 seconds. Touch controls appear on
coarse-pointer devices.

---

## The six meters

Everything you do is paid for out of these, and money is only ever the means of
converting one into another.

| Meter | Falls | Bites when low |
|---|---|---|
| **Fed** | ~3.6/hr | health drains at zero |
| **Hydrated** | ~5/hr | health drains hard at zero — the fastest way to collapse |
| **Clean** | ~1.9/hr, faster working | shops refuse service, police take an interest, interviews end early |
| **Energy** | ~3.4/hr awake | you stop being able to work, then to walk straight |
| **Dignity** | drifts, and accelerates when the rest of you is failing | below 12 you refuse the harder jobs outright |
| **Health** | only moves when something is wrong | at zero you go down in the street and wake in the clinic hours later |

Hit zero on health and you lose the rest of the day, some money, and whatever
was on the schedule.

## Appearance is the real currency

`appearance = hygiene × 0.55 + clothes × 0.45`, and being genuinely filthy caps
what a good suit can do for you. It is checked at almost every door:

| Gate | Wants |
|---|---|
| Brokemon Mart | 28 — below it the clerk walks you back out |
| Corporate plaza lobby | 55 |
| The Heights security gate | 70 |
| Office Administrator interview | 72 |

The free shower at the Community Center is the one rung everybody gets. Without
it there is no route from the park to the shop counter, which is the whole
design in one mechanic.

## The ladder

**Phase 1 — The Streets.** No fixed address. Scavenge the dumpsters behind the
Mart, cash containers at the recycling depot, work the corner. Panhandling pays
best at a *middling* appearance: too filthy and people cross the street, too
clean and they assume you're fine. It costs you Dignity every time.

**Phase 2 — Odd Jobs.** A hostel cot ($9, paid nightly — it isn't yours in the
morning) or the trailer on Route 1 ($70/week, and the door locks). Flyer routes
and yard work from the job board send you to real addresses on the map. Mart
clerk, overnight stocker, grounds crew.

**Phase 3 — The Career Track.** Night classes, a prepaid phone employers can
call back, an interview suit, and a lease that runs your credit. Field
technician or office administrator, salaried, indoors, paid whatever the weather
does.

**Phase 4 — The Apex.** The Mart franchise, the mayor's office, the estate on
the hill. Winning is the estate plus one of the other two. Your first act as
mayor repeals the overnight camping ordinance.

You can fall back down. Miss rent and you're evicted; miss three shifts and
you're let go. The journal keeps your high-water mark either way.

## The town

```
rows  0–14   THE HEIGHTS      hedges, marble, the estate, the corporate plaza
row     14   the security gate
rows 15–39   MARKET SQUARE    Mart, Community Center, college, bank, laundromat,
                              apartments, the fountain, the job board, the corner
rows 40–49   THE OUTSKIRTS    hostel, recycling lot, the park, the trailer
```

Zones behave differently towards you. The Outskirts never issue a fine. Market
Square has a no-camping ordinance on the benches and moves you along if you're
under 30 Clean. The Heights want 60 Clean *and* the right clothes, and fine at
triple rate.

Weather is live: rain and storms soak you without a poncho, which costs health
and Dignity, risks a fever, and cuts what outdoor work pays.

## Layout

```
src/
  world/     tiles.ts, map.ts          the ASCII town, zones, collision
  sim/       meters, time, weather, rng, jobs, social, items   — rules
             state.ts                  the save-shaped GameState
             tick.ts                   decay, day rollover, rent, police, collapse
             actions.ts                what the interact button does
             venues.ts                 every building's interior
             work.ts, events.ts        shifts, gigs, sleep, encounters
  engine/    render.ts, input.ts       canvas painting, key bindings
  ui/        hud.ts, dialogue.ts, journal.ts    DOM over the canvas
  main.ts                              the loop that joins them
```

The simulation has no reference to the DOM and returns *interrupts* rather than
blocking on dialogue, which is why almost all of it is testable headlessly.

## Tests

```sh
npm test
```

95 tests. The interesting ones aren't the unit tests:

- **`world/map.test.ts`** flood-fills the town from the spawn point and asserts
  every marker is reachable on foot. It caught the estate being sealed inside
  its own hedge ring.
- **`sim/balance.test.ts`** runs a headless bot that stands on tiles, presses
  the interact button and picks options off the *real* prompt tree — then plays
  fourteen days of phase 1 and asserts you survive it and come out with enough
  to buy soap, clothes and a bed. It caught the phase-1 hygiene death spiral
  (the free shower was locked behind clinic hours, so there was no way back up),
  and the fact that dumpsters reported as already-emptied for the whole of the
  first morning.
