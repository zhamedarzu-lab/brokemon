# Brokedale — scope

A second place, reachable by coach. Dense, well supplied, and expensive in
every way that matters.

Phases 0, 0b, 1 and 2 are done and merged. The coach runs, Brokedale is four
districts deep, and it has a career ladder of its own that nobody is judged on
their clothes for. Phase 3 — the encounters and the second apex — is still a
plan.

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

**Save migration is nearly free, but not quite — and Phase 0 proved it.** The
claim was that `loadGame` merging over a fresh state handles everything. It
does not: the spread is *shallow*, so a stored `player` object replaces the
fresh one whole, and a save written before `player.town` existed came back with
it `undefined` — every map lookup then asking for a town that is not there. The
fix is a per-object merge plus a sanity check, now in `loadGame` beside the
bus-pass migration and covered by `save.test.ts`.

Phase 0b will hit the same shape twice more, with `housing` and `reputation`
going from scalars to records. Those are worse: a stored scalar is not merely
missing a field, it is the wrong *type*, so the merge has to detect and convert
rather than fill in. Budget for it.

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

### Phase 0 — make the world plural, change no gameplay ✅ DONE

- A `Town` record: id, display name, grid, markers, zones, dimensions.
- `TOWNS: Record<TownId, Town>` with `brokemon` the only entry.
- Zones move **inside** the town; they stop being global row bands.
- Every map function takes a town, or reads `s.player.town`.
- `player.town` added to state and save.
- Renderer, landmarks and both rigs made town-aware.

**Gate passed.** 248 tests (up from 244 — four new save-migration tests) and
playtest output byte-identical to a baseline captured beforehand.
`world/town.ts` holds the type and the queries, `world/towns/brokemon.ts` holds
the grid, and `world/map.ts` is the registry. Zones live inside a town.

### Phase 0b — pluralise the player, still no new content

Housing, rent, hostel nights and reputation become per-town, with Brokedale not
yet reachable. Doing this before the city exists means the migration is
testable against a game that already works.

**Split in two.** The original plan said to fold open finding #2 (reputation has
no ceiling) in here *and* gate the phase on no number moving. Those contradict
each other — capping reputation changes the franchise payout, which changes the
endgame economy. The value of the gate is that it proves the refactor is
behaviour-preserving, and that proof is worth more than the convenience of
doing both at once.

- **0b-1, the refactor.** ✅ **DONE.** `housing`, `rentDueDay`, `nightsPaid` and
  `reputation` are `PerTown<T>` records, reached through `housingIn`,
  `setHousing`, `bestHousing` and `reputationIn`. `phaseOf` reads the best
  address in any town, so taking the coach somewhere you have no room will not
  knock you back to phase 1. 251 tests and byte-identical playtest output.

  The predicted migration pain was real: a stored scalar is the wrong *type*,
  not a missing field. `spreadToTowns` handles all three shapes — a record, a
  bare scalar, or nothing — and reputation earned before Brokedale existed is
  credited to Brokemon rather than spread across both.
- **0b-2, the ceiling.** ✅ **DONE.** Gains shrink as your name grows and stop
  at 100; losses land in full. The franchise payout gets its own base rather
  than borrowing one from a number that no longer runs away. Measured
  before-and-after: reputation goes from 546–723 to 68–83, and runs from
  126–187 days to 138–210 — longer, but the endgame is no longer a formality.

### Phase 1 — the coach, and a stub Brokedale ✅ DONE

The link exists and you can ride it.

- **The coach.** Leaves Brokemon from the Market Square stop on the hour, 6AM
  to 9PM; leaves Brokedale at half past, 6:30AM to 10:30PM, and one last one at
  11PM. Forty minutes each way. **$6 out, $14 back** — deliberately lopsided, so
  the fare out is affordable long before the fare home is comfortable (§8.3).
  Turn up at 10:17 and you stand on the stand until eleven; the wait is real
  minutes on the real clock, which is the entire point of having a timetable
  rather than a button.
- **Brokedale**, 40x24: the coach station and St Giles Row. A night market that
  never shuts and is never cheap, rooms at $14, a standpipe, bins, a corner.
  No food bank, no free wash, and no bench you can legally sleep on — the
  concourse is the only free bed in the city and it barely counts. That is the
  city's whole character in one screen: **a ceiling and no floor**.
- **Save/load across the link**, plus the migration fix it exposed: a legacy
  scalar `housing` was being spread to *every* town, which would have handed
  every existing save a free room in a city it had never visited.
- **Rent is now charged per town**, not for the town you happen to be standing
  in. Without that, a day trip was the cheapest rent holiday in the game.
- **Escort tiles moved into the zones that own them**, and `buildTown` rejects
  one that has ended up inside a wall — the third instance of the stale-
  coordinate problem, closed by construction this time.

**Gate passed.** 293 tests (up from 273 — twenty new coach and world tests) and
playtest output byte-identical to a baseline captured beforehand: nothing about
a Brokemon-only run changed.

Left for later on purpose: the weekly intercity pass (§8.2), and the walking
rig does not ride the coach yet — that is Phase 4, and until then every number
it prints is a number about Brokemon.

### Phase 2 — Brokedale proper

**2a — the move. ✅ DONE.** The city is 40x40 and four districts deep: Terminal
Quarter, The Blocks, The High Street, Riverside. Policed harder the further you
walk from the coach station, and Riverside wants a dress code — Brokedale's
Heights, except the prices do the work instead of a gate.

What you can do there now:

| | |
|---|---|
| **Ardwell Labour** (Terminal) | Site work, six hours, ~$88, cash in hand. Muster 6–11AM: turn up or the vans have gone. The only job in the city, and the only one anywhere that asks nothing at all |
| **St Giles Row rooms** (Blocks) | $95 a week, two weeks up front, no credit check. Fourth floor, no lift, no shower. The decision the whole city is built around |
| **Eastgate Washhouse** (Blocks) | $5 for 30 minutes of hot water, 24 hours. There is no free wash in Brokedale |
| **Vance & Son** (High Street) | Pawn — four in ten of what you paid, and he will not take your lunch |
| **The Wharf Club** (Riverside) | $12 a day: a session, and as long as you like in the showers |

**Measured, and it works.** A bot arriving with $54 takes a room on day two,
works 21/21 days on site, ends 21 days later with $1,200–1,300, no collapses,
and — the number the whole design rests on — **93 minutes a day walking against
Brokemon's 164**. Density is doing what it was supposed to do.

Two things the rig found on the way, both of which would have shipped:

- **All the water was at the wrong end of town.** A standpipe at the coach
  station and a river at the far edge, with nowhere to drink between them.
  Exactly finding 17 in Brokemon, repeated at full size. There is a standpipe on
  St Giles Row now.
- **The morale floor on site work was a death spiral.** Every other gig has one
  because Brokemon has a food bank and a free wash to climb back with. Brokedale
  has neither, so one bad day compounded: 13 "you cannot make yourself do this
  today" in a row, 8 collapses, reputation on the floor. Site work asks for
  energy and nothing else now, which is what "no questions" is supposed to mean.

**2b — the ladder. ✅ DONE.** Three rungs at the Eastgate Depot, hired at the
Employment Exchange on the High Street:

| | | |
|---|---|---|
| **Warehouse Picker** | $118, 8AM–4PM | hygiene 25 |
| **Dispatch Coordinator** | $210, 8AM–5PM | 12 picker shifts, 2 credits, a phone |
| **Depot Manager** | $420, 7AM–5PM | 18 dispatch shifts, 4 credits |

**Not one requirement on the track is about how you look** — no outfit, no
appearance, and the hygiene numbers are about being safe on a yard rather than
presentable in a lobby. That is the point of it, and there is a test that fails
if anyone adds a dress code to any rung. It pays less at the top than Silph's
director does and gets there with far less ceremony, which is the fork: **the
estate is more money and a longer road through a gate; the depot is a decent
life you can actually reach.**

**The two towns need each other, on purpose.** Dispatch wants night-class
credits and a phone. There is no college in Brokedale and no Mart, so the
credits mean going back — and the last coach home leaves before the class lets
out, so every credit costs a day, two fares and a night on the far side. The
rig does the trip and gets there: hired as Dispatch Coordinator on day 22 of a
three-week run that started with $54.

Four things it found on the way, in the order it found them:

- **The hire roll was appearance-based even for jobs with no appearance
  requirement.** A hidden dice roll on your looks quietly rebuilt the wall the
  whole track was cut to route around — and made nonsense of the overnight
  stocker, whose pitch is that nobody sees you. Those jobs hire on your name
  and the fact you turned up. Brokemon shifted 164 → 165 days across ten
  seeds, well inside the noise.
- **The interview asked whether you were tired.** Energy and morale are right
  at the door on the morning of a shift and wrong at an interview; the rig was
  told it was "too worn out for this right now" twenty days running, applying
  after a shift. Same family as finding 13 — the check that gets you hired and
  the check that gets you through the door are not the same question.
- **A 6AM shift is unworkable.** Every bed in the game wakes you at 7, so the
  picker was hired, written up three times for lateness, fired, and rehired,
  six times in three weeks. It starts at 8 now, and a test refuses any rung
  starting before 7.
- **The board in Market Square was advertising jobs in Brokedale**, which
  would have cost 250 minutes and $26 a day to turn up to. Listings are
  filtered by town.

Phase 3's second apex still needs writing. Everything else from section 7 —
university, hospital, auction house, the $200–$12,000 gap — is open.

Still to come from section 7: the university, the hospital, the auction house,
the night bus, and something to spend money on between $200 and $12,000.

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
