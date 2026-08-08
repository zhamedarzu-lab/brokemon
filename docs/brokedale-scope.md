# Brokedale — scope

A second place, reachable by coach. Bigger, busier, better supplied, and more
expensive in every way that matters.

This is a plan, not work in progress. Nothing here is implemented.

---

## 1. What Brokedale is for

The danger with "a city that has everything the player needs and then some" is
that it makes the first town pointless. Get the fare together on day two, ride
over, never come back, and Brokemon Town becomes a tutorial you did once.

So the two places should not be better and worse. They should be **expensive
and cheap**:

| | Brokemon Town | Brokedale |
|---|---|---|
| **What it costs you** | time | money |
| Layout | sprawling — 72x72, ~160 min a day walking | dense — everything within a few minutes |
| Safety net | food bank, free wash, free shelter | none, or paid |
| Prices | low | high |
| Standards | the Mart turns you away below look 28 | most doors want a good deal more |
| Police | fines scale by zone, outskirts are free | stricter everywhere, no free zone |
| Work | six jobs, slow ladder | more work, better paid, harder to hold |

That is the spine of the whole thing. **Brokemon Town has a floor and no
ceiling. Brokedale has a ceiling and no floor.** Phase 1 belongs in Brokemon,
because Brokedale will not feed you. The moment you have income, Brokedale buys
back the thing Brokemon takes — your day.

It also turns the walking cost we just measured from a complaint into a
mechanic. Brokemon's sprawl stops being tedium and becomes the reason to leave.

---

## 2. What this retires from the open findings list

Worth doing this way partly because it closes three things already on the list:

- **#2 Every career job is behind the Heights gate.** Brokedale gets its own
  career track with no appearance checkpoint on the commute. The Heights become
  one route up rather than the only one.
- **#4 The mid-game is one day on a loop.** A second city with its own
  encounters, its own jobs and a commute decision is exactly the variety the
  loop is missing — and it gives money somewhere to go between $200 and
  $12,000.
- **#5 Walking dominates the day.** Not fixed so much as given a point.

It does **not** fix #1 (coffee) or #3 (runaway reputation). Those stay open and
should probably be done first, since both get harder to reason about once there
are two economies.

---

## 3. Architecture — the real work

The codebase assumes one map everywhere. Nothing is hard; there is just a lot
of it, and it all has to land before any content does.

What is coupled today:

| Thing | Problem | Where |
|---|---|---|
| `zoneAt(y)` | Zones are **row bands** and the function takes only a `y`. Row 30 has to mean two different things | `actions`, `tick`, `events`, `hud`, `landmarks` |
| `markerPos(id)` | Flat global lookup, ids unique across the whole game. Two towns both want a `busStop`, a `mart`, a `bank` | `venues` (5), `main` (2), `playtest` (2) |
| `TOWN` | Module-level const, built at import | `actions`, `render` |
| `glyphAt` / `isSolid` / `isOutdoors` / `MAP_WIDTH` / `MAP_HEIGHT` | Global, no world argument | `render`, `actions`, `tick`, `landmarks`, `playtest` |
| `GameState.player` | No map id. A save would load a Brokedale position onto the Brokemon grid | `state` |
| `VENUES` | Flat registry of 16, keyed by marker id | `venues` |
| `HOUSING` | One `housing` field. Where do you live if you can live in either place? | `state`, `social`, `tick` |

**Save migration is free.** `loadGame` already merges over a fresh state, so a
new `player.map` field defaulting to `"brokemon"` loads every existing save
correctly. Worth keeping `brokemon.save.v1` and not bumping the key.

### Phase 0 — make the world plural, change no gameplay

- A `World` record: id, display name, grid, markers, zones, dimensions.
- `WORLDS: Record<WorldId, World>` with `brokemon` as the only entry.
- Zones move **inside** the world and stop being global row bands.
- Every map function takes a world, or reads `s.player.map`.
- `player.map` added to state and save.
- Renderer, landmarks and both test rigs made world-aware.

**Gate: all 238 tests pass and the playtest produces the same results.** If
Phase 0 changes any number, something is wrong. This is the phase where the
project either stays honest or quietly breaks, and it is worth doing on its own
and merging before anything else starts.

### Phase 1 — the coach, and a stub Brokedale

- Intercity coach from the Market Square stop. Real fare, real journey time,
  real timetable, a last coach.
- Brokedale as a **single street with a terminal** — enough to prove you can
  arrive, walk around, interact and come back.
- Save/load across the link.

### Phase 2 — Brokedale proper

Districts, venues, jobs, housing. See section 4.

### Phase 3 — encounters and threads

Its own event pool, weighted by district, plus at least one named thread.

### Phase 4 — balance

The walking rig has to model the commute or it will lie to us again, exactly as
it did through the 48x50 → 72x72 expansion.

---

## 4. Content scope

### Districts

Four, each with a different relationship to you:

- **Terminal Quarter** — where the coach puts you down. Grimy, opportunistic,
  open at all hours. Cheap food, a tout, a pawn shop, day work with no
  questions. The one part of Brokedale that will take you as you are.
- **The High Street** — retail and offices. Where the work is. Standards.
- **Riverside** — money. Restaurants, the good gym, the auction house.
  Effectively Brokedale's Heights, but gated by price rather than a barrier.
- **The Blocks** — housing. Cheap rooms, high risk, a launderette, a corner
  shop that is open when nothing else is.

### Venues worth having

Grouped by what they solve:

- **Upkeep, but paid**: 24-hour launderette, public baths, a gym (hygiene and
  energy for money), a night market for cheap food.
- **Money**: pawn shop (sell gear back, at a loss), an agency that hands out
  same-day site work, an auction house, a proper job centre.
- **Progress**: a university with day courses that beat night class but cost
  the day; a hospital that is better and dearer than the clinic.
- **Spending**: somewhere for money between $200 and $12,000 — a market stall
  of your own, a van, a room deposit.

### Jobs

A second career track, roughly parallel in pay, different in shape — shift
work, agency work, something with unsociable hours that pays for them. The
point is that Brokedale's ladder does not run through an appearance
checkpoint, so it is a genuine alternative rather than a reskin.

### Encounters

The current pool is 30-odd and tuned by zone. Brokedale should get its own set
weighted by district, not a share of Brokemon's — a night market at 2am, a
market inspector, a hostel tout, a phone lifted on the concourse, someone who
knows the city offering to show you where the free showers are.

---

## 5. Ideas worth arguing about

Things I would put in, flagged as opinions rather than requirements:

1. **A real timetable.** The coach leaves on the hour, takes 40 minutes, and
   the last one back is at 23:00. Miss it and you are in a strange city with no
   shelter you have a claim on. This makes a bus ride a decision instead of a
   menu item, and it is the cheapest tension in the whole design.
2. **The pass pays for itself.** A weekly intercity pass at a price that only
   makes sense if you commute most days — a real commitment, not a convenience.
3. **You can live in either place.** Rent in Brokedale is dearer but kills the
   commute. That is a genuine strategic call and it needs `housing` to know
   which town it is in.
4. **Brokedale does not know you.** Reputation is per-town, or at least starts
   discounted there. Everything you built in Brokemon buys you nothing on
   arrival, which gives the city its own arc rather than a continuation.
5. **A commuter's day is a different day.** Two hours of coach means the
   Brokemon upkeep loop has to be done before you leave or after you get back.
   That is where the interesting scheduling pressure lives.
6. **One-way at first.** The fare out is affordable long before the fare back
   is comfortable. Getting stranded in Brokedale on day one should be possible
   and survivable and memorable.
7. **The estate stays the ending.** Brokedale is the better place to earn, not
   a second win condition — otherwise the two towns compete for the same finish
   and neither feels like the point.

---

## 6. Risks

- **Phase 0 is invisible work.** A week of refactoring with nothing to show. It
  is also the phase that decides whether the rest is pleasant or miserable. Do
  not skip it and bolt a second grid on beside the first.
- **The rigs go blind again.** They already have, twice. The playtest must
  model the coach or every balance number it prints after this is fiction.
- **Two economies is much harder to tune than one.** Every existing balance
  finding gets a second set of numbers.
- **Content volume.** "More going on" is a lot of writing. The district split
  exists partly so it can be delivered one district at a time.
- **Another agent works on this repo.** A refactor this wide will conflict with
  anything landing in parallel. Worth agreeing who owns `src/world/` for the
  duration.

---

## 7. Questions that change the plan

1. **Can you live in Brokedale, or is it commute-only?** Commute-only is much
   smaller — no second housing ladder, no per-town rent, no eviction in a place
   you cannot walk home from.
2. **Is the estate still the ending?** If Brokedale gets its own apex, that is
   a second endgame to design and balance.
3. **Is reputation shared or per-town?** Per-town is better drama and more
   bookkeeping.
4. **How big?** A district-sized place that is dense and rich, or another 72x72
   sprawl? I would argue hard for dense — sprawl is the thing we just measured
   as the game's biggest tax.
