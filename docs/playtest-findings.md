# Playtest findings

From a headless bot that walks the real grid at the real per-tile rate, takes
police checks and street encounters on the way, and records where each day
actually goes (`npm run playtest`). Numbers below are from four seeds run to a
win.

The **Fixed** section is done and on the branch. Everything under **Open** is
scope, not work in progress — nothing here has been changed.

---

## Fixed

| # | Fault | Effect |
|---|---|---|
| 1 | `sleep()` read "until 7AM" literally at 8AM | 23 hours gone, woke starving on the far side of an unplayed day |
| 2 | Sleep paid a full night's rest for any duration | Lying down at 7:00 for the half hour left on the clock returned a whole night, repeatably |
| 3 | Overnight shift stamped with the day it *ended* | The stocker could only work every other night |
| 4 | Mart shut its own staff out at 11PM | The 10PM–3AM shift was clockable only in its first hour |
| 5 | Yard work could send a phase-1 player to the estate | Behind a gate wanting appearance 70; burned the day's only yard slot on an impossible job |
| 6 | Index fund did not count toward credit | Estate wants 720, debt-free ceiling is 700 — taking the bank's own advice locked the ending |
| 7 | Lease and estate blamed the credit score | The real levers (the debt, the savings) were never named |

### Second pass

| # | Fault | Effect |
|---|---|---|
| 8 | Night class wanted 20 energy and cost 18 | A shift left you at ~12, so earning and studying could not happen on the same day. Now 10 and 12 — you can attend on fumes and have nothing left after |
| 9 | Marble drew a two-tone 8px checker | The fountain plaza is a solid 13x7 field of it and read as a transparency hole in the map. Polished slabs with grout and veining now |
| 10 | Every building was the same brown wall | Nameplates over every door — the only way to find the hostel was to open all of them |
| 11 | Filler encounters drowned out the zone ones | `change` + `cans` were two encounters in five everywhere, including a gated private road. Weighted by zone, and eighteen new situations added |
| 12 | The same encounter could come up twice running | The cooldown discounted repeats but never barred them. The last two are now excluded outright |
| 13 | The interview hired you into a dress code you might not meet | Hired in rags as Mart Clerk, every shift a strike, three strikes and the lead was gone. It says so now |
| 14 | A pending interview existed only as a flag | Set up, never mentioned again, then fired days later as a random encounter. It sits in the HUD task line now |
| 15 | `repDescriptor` in `main.ts` duplicated `reputationLabel` | Two copies of the same thresholds. One source of truth, and the crossing-message tables are total records so a new tier cannot compile without its lines |

---

## Open — ranked by how much they cost the player

### 1. Coffee is the cheapest energy in the game, and unlimited

| Source | Cost | Energy | Time |
|---|---|---|---|
| Gas-station coffee | $2 | +22 | 5 min |
| Hostel cot | $9 | +75 | ~9 h |

$0.09 per point against $0.12, and no time cost worth the name. No cap, no
tolerance, no crash. Once you have income the sleep economy stops binding.

This was previously entangled with the night-school squeeze — coffee was the
only thing making class attendance possible on a working day. That is fixed, so
coffee can now be balanced on its own merits.

Options: diminishing returns per day; a crash that borrows against tomorrow; a
health cost that scales with count.

### 2. Every career job is worked inside the gated zone

Field Technician, Office Administrator and Regional Director all clock in at the
Corporate Plaza — which sits at row 10, above the hedge, behind the one security
gate. The gate wants appearance 70 **every single morning**.

Consequences:
- Field Technician's own appearance requirement of 60 is dead. The gate is
  stricter than the job.
- A technician in smart casual (presentation 60) needs hygiene 78+ *daily* just
  to reach their desk.
- Nothing warns you when you accept the job that its address is behind a
  checkpoint.

Options: a staff badge item that passes the gate; a side/service entrance;
lowering the gate for anyone with a tier-3 employer; or moving one tier-3 job
down into Market Square so the tier is not all-or-nothing.

### 3. Reputation has no ceiling, and the endgame scales off it

`franchise payout = 180 + (reputation + 40) × 1.5`, and reputation only ever
goes up — every ten shifts, every wallet returned, every election.

| Reputation | Franchise pays |
|---|---|
| 0 | $240/day |
| 200 | $540/day |
| 750 | $1,365/day |

Observed end-of-run reputation across seeds: 486–864. Hiring odds also carry
`+reputation/200`, so past ~150 every interview succeeds. The last third of a
run has no failure mode left.

Options: cap reputation; decay it; or make the franchise payout a flat figure
with reputation affecting something social instead.

### 4. The mid-game is one day on a loop

From the moment you hold a tier-3 job to the moment you can afford the
franchise, every day is identical: wake, wash, walk, eight-hour shift, walk,
sleep. In the traces, days 5 through 23 differ only in the cash column. The
franchise buy-in alone blocked 32–41 days per run.

Options: weekly events; a rent/bills rhythm that forces decisions; relationships
or a named NPC with a thread; workplace incidents; something to spend money on
between $200 and $12,000.

### 5. Two upkeep chores dominate the walking

Thirst decays 120 points a day and there is exactly **one** free water source on
the map (the fountain at 26,32). Hygiene decays 46+/day and there is exactly
**one** free wash (the community center at 7,24) — at the opposite corner.

Average 90–100 minutes a day is spent walking, much of it between those two
points. It reads as tedium rather than hardship.

Options: a second fountain in the Outskirts; a standpipe near the hostel; make
bottled water cheap enough to be the obvious buy; let the trailer's shower count
for more.

### 6. Strikes fire for conditions that lapse on their own

Grounds Crew wants energy 35 at the door, Overnight Stocker 30. Energy bottoms
out near zero on most working days. Turning up tired is a disciplinary strike,
and three strikes fires you — after which you fall all the way down the ladder,
because the plaza jobs need clothes and credits you may have sold or spent.

Observed: the bot was fired and dropped back to Mart Clerk mid-run on two seeds.

Options: separate "sent home" from "written up"; let a strike decay after a
clean week; warn at two; or drop energy from the door check and let a tired
shift just pay less.

### 7. Smaller items

- **The trailer is never worth renting.** $70/week is $10/night against the
  hostel's $9, with eviction risk and a rent clock attached. Its real advantages
  (shower, storage, rest quality) are never surfaced.
- **Police fines swing wildly by seed** — $337 to $1,834 across four runs of
  broadly the same play. Early fines feed the debt that caps credit at 600,
  which is the thing that gates the apartment.
- **The bicycle halves every walk for the rest of the run** and nothing tells
  you. At $70 it is the strongest purchase in the game.
- **The `hostel` housing state flickers.** You are phase 2 in the evening and
  phase 1 the morning after the cot lapses, so the phase readout and the
  milestone log jitter.
- **Panhandling pays best at appearance ~32**, which means the optimal beggar
  keeps themselves half-clean on purpose. Probably intended; worth confirming.

---

## The rig

`npm run playtest` — optionally `npm run playtest -- 7 99` for specific seeds.

It reports, per seed: the day each milestone landed, shifts by job, minutes per
day spent walking versus on shift, the meter low-water marks for the first 25
days, and a frequency table of every option the bot found locked and why. That
last table is where most of the findings above came from — a wall shows up as
the same lock reason repeating eighty times.

The teleporting bot in `progression.test.ts` is still the regression net; it is
fast and deterministic. It cannot find anything that costs time or distance,
which is what the walking rig is for.
