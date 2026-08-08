# Brokedale — scope

A second place, reachable by coach. Dense, well supplied, and expensive in
every way that matters.

This is a plan, not work in progress. Nothing here is implemented.

---

## 1. Decisions taken

| Question | Answer |
|---|---|
| Can you live there? | **Yes.** Rent is dearer but it kills the commute. |
| Endgame | **Brokedale gets its own apex**, alongside the estate. |
| Reputation | **Per-town.** You arrive unknown. |
| Size | **Dense — smaller than Brokemon.** ~40x40, packed. |

Each of those is the more ambitious option except the last, and they compound:
per-town housing plus per-town reputation plus a second win condition is most
of a state refactor on its own. Sections 4 and 5 cost it out honestly.

---

## 2. What Brokedale is for

The danger with "a city that has everything the player needs and then some" is
that it makes the first town pointless. Get the fare together on day two, ride
over, never come back, and Brokemon Town becomes a tutorial you did once.

So the two places should not be better and worse. They should be **expensive
and cheap**:

| | Brokemon Town | Brokedale |
|---|---|---|
| **What it costs you** | time | money |
| Layout | sprawling — 72x72, ~160 min a day walking | dense — ~40x40, everything minutes apart |
| Safety net | food bank, free wash, free shelter | none, or paid |
| Prices | low | high |
| Standards | the Mart turns you away below look 28 | most doors want a good deal more |
| Police | fines scale by zone, outskirts are free | stricter everywhere, no free zone |
| Work | six jobs, slow ladder | more work, better paid, harder to hold |

**Brokemon Town has a floor and no ceiling. Brokedale has a ceiling and no
floor.** Phase 1 belongs in Brokemon, because Brokedale will not feed you. The
moment you have income, Brokedale buys back the thing Brokemon takes — your
day.

It also turns the walking cost we measured from a complaint into a mechanic.
Brokemon's sprawl stops being tedium and becomes the reason to leave.

---

## 3. The two endings

Since Brokedale gets its own apex, the two should mean opposite things. This is
the strongest idea in the document and the rest can be argued with:

- **Brokemon — the estate on the hill.** You leave. Six bedrooms, a gravel
  drive, and a view of the town that moved you on. You get *out*.
- **Brokedale — the block.** You stay, and you buy the building you rented your
  first room in. Not a view: a door you now control for other people.

A game about housing precarity where one ending is becoming the landlord is
uncomfortable in exactly the right way, and it gives the player a real question
rather than a bigger number. Both remain winnable in one run — nothing stops
you owning both — but either alone ends the run.

Practically this needs `won` to record *which* ending, a second victory screen,
and `postWinGoal` to cope with a run that has one apex left.

---

## 4. What this changes in state

The per-town decisions are the expensive ones. Current shape versus needed:

| Field | Today | Needed |
|---|---|---|
| `player.pos` | `Vec2` | plus `player.town: TownId` |
| `housing` | one `HousingId` | `Record<TownId, HousingId>` — you can hold a room in both |
| `rentDueDay` | one number | per town |
| `reputation` | one number | `Record<TownId, number>` |
| `won` | `boolean` | which ending, or a set |
| `flags`, `shiftsWorked` | flat | fine as-is, ids stay unique |

Knock-on effects worth knowing before starting:

- **`phaseOf(s)`** reads `housing` directly. With two towns it needs a rule —
  probably "best address in either town", but that is a design call, not a
  mechanical one.
- **`chargeRent`** runs once per day off a single `rentDueDay`. It becomes a
  loop over towns, and eviction has to name which room you lost.
- **`changeReputation`** has ~20 call sites, none of which currently say where
  they happened. Every one needs a town, which is mostly `s.player.town` but
  not always — a Brokemon employer hearing about you is Brokemon reputation
  wherever you are standing.
- **The franchise payout scales on reputation.** With two numbers it has to
  pick one, which is a good moment to fix open finding #3 (runaway reputation)
  rather than duplicating it.

**Save migration stays free.** `loadGame` merges over a fresh state, so
defaulting `town: "brokemon"`, `housing: { brokemon: <old value>, brokedale:
"street" }` and `reputation: { brokemon: <old>, brokedale: 0 }` loads every
existing save correctly. Keep the `brokemon.save.v1` key; write the migration
in `loadGame` where the bus-pass one already lives.

---

## 5. What this changes in the world

The codebase assumes one map everywhere. Nothing is hard; there is just a lot
of it, and it must land before any content.

| Thing | Problem | Where |
|---|---|---|
| `zoneAt(y)` | Zones are **row bands** keyed on a bare `y`. Row 30 cannot mean two things | `actions`, `tick`, `events`, `hud`, `landmarks` |
| `markerPos(id)` | Flat global lookup. Both towns want a `busStop`, a `mart`, a `bank` | `venues` (5), `main` (2), `playtest` (2) |
| `TOWN` | Module-level const built at import | `actions`, `render` |
| `glyphAt` / `isSolid` / `isOutdoors` / `MAP_WIDTH` / `MAP_HEIGHT` | Global, no town argument | `render`, `actions`, `tick`, `landmarks`, `playtest` |
| `VENUES` | Flat registry of 16 keyed by marker id | `venues` |

---

## 6. Phases

### Phase 0 — make the world plural, change no gameplay

- A `Town` record: id, display name, grid, markers, zones, dimensions.
- `TOWNS: Record<TownId, Town>` with `brokemon` the only entry.
- Zones move **inside** the town; they stop being global row bands.
- Every map function takes a town, or reads `s.player.town`.
- `player.town` added to state and save.
- Renderer, landmarks and both rigs made town-aware.

**Gate: all 238 tests pass and `npm run playtest` prints identical numbers.**
If Phase 0 changes any result, something is wrong. Merge it on its own.

### Phase 0b — pluralise the player, still no new content

Housing, rent and reputation become per-town, with Brokedale not yet reachable.
Same gate: no number moves. Doing this before the city exists means the
migration is testable against a game that already works.

Fold open finding #3 (reputation has no ceiling) in here, since every call site
is being touched anyway.

### Phase 1 — the coach, and a stub Brokedale

- Intercity coach from the Market Square stop. Real fare, real journey time, a
  timetable, a last coach.
- Brokedale as a **terminal and one street** — enough to prove you can arrive,
  walk, interact, sleep and come back.
- Save/load across the link.

### Phase 2 — Brokedale proper

Districts, venues, jobs, rooms. See section 7.

### Phase 3 — encounters, threads, and the second apex

Its own event pool weighted by district, at least one named thread, and the
block ending.

### Phase 4 — balance

The walking rig must model the coach and both towns, or every number it prints
after this is fiction — exactly as it was through the 48x50 → 72x72 expansion.

---

## 7. Content scope

### Districts

Four, dense, each with a different relationship to you:

- **Terminal Quarter** — where the coach puts you down. Grimy, opportunistic,
  open at all hours. Cheap food, a tout, a pawn shop, day work with no
  questions. The one part of Brokedale that takes you as you are.
- **The High Street** — retail and offices. Where the work is. Standards.
- **Riverside** — money. Restaurants, the good gym, the auction house.
  Brokedale's Heights, gated by price rather than a barrier.
- **The Blocks** — housing. Cheap rooms, high risk, a launderette, a corner
  shop open when nothing else is. Also where the second ending lives.

### Venues, grouped by what they solve

- **Upkeep, but paid**: 24-hour launderette, public baths, a gym (hygiene and
  energy for money), a night market for cheap food.
- **Money**: pawn shop (sell gear back at a loss), an agency handing out
  same-day site work, an auction house, a proper job centre.
- **Progress**: a university with day courses that beat night class but cost
  the day; a hospital, better and dearer than the clinic.
- **Spending**: somewhere for money between $200 and $12,000 — a market stall
  of your own, a van, a room deposit.

### Jobs

A second career track, roughly parallel in pay, different in shape — shift
work, agency work, unsociable hours that pay for themselves. The point is that
Brokedale's ladder does not run through an appearance checkpoint, so it is a
genuine alternative rather than a reskin. This also retires open finding #2.

### Encounters

Its own set weighted by district, not a share of Brokemon's — a night market at
2am, a market inspector, a hostel tout, a phone lifted on the concourse,
someone who knows the city offering to show you where the free showers are.

---

## 8. Ideas worth arguing about

1. **A real timetable.** The coach leaves on the hour, takes 40 minutes, last
   one back at 23:00. Miss it and you are in a strange city with no bed you
   have a claim on. Cheapest tension in the whole design — and with rooms
   available in Brokedale it becomes a real decision rather than a punishment.
2. **The pass pays for itself.** A weekly intercity pass priced so it only
   makes sense if you commute most days.
3. **One-way at first.** The fare out is affordable long before the fare back
   is comfortable. Getting stranded on day one should be possible, survivable
   and memorable.
4. **A commuter's day is a different day.** Two hours of coach means the
   Brokemon upkeep loop happens before you leave or after you get back. That is
   where the scheduling pressure lives.
5. **Rooms in Brokedale are weekly and unforgiving.** Miss rent in a town you
   cannot walk home from and the eviction has teeth the trailer never had.

---

## 9. Risks

- **Phase 0 and 0b are invisible work** — a lot of refactoring with nothing to
  show, and they decide whether the rest is pleasant or miserable. Do not skip
  them and bolt a second grid on beside the first.
- **The rigs go blind again.** They already have, twice. The playtest must
  model the coach.
- **Two economies is much harder to tune than one**, and per-town reputation
  makes it two of those too.
- **Content volume.** The district split exists partly so it can ship one
  district at a time.
- **Another agent works on this repo.** A refactor this wide will conflict with
  anything landing in parallel. Worth agreeing who owns `src/world/` and
  `src/sim/state.ts` for the duration.

---

## 10. Recommended order

Coffee is **done** — it was the old finding #1 and is now fixed. Reputation's
missing ceiling is folded into Phase 0b, since every call site is being touched
there anyway. Nothing else on the open list blocks this work.
