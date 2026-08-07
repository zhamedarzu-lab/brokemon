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

---

## Open — ranked by how much they cost the player

### 1. Night school is unreachable on any day you work

The single loudest signal in every run: **"You would sleep through it" fired
15–110 times per playthrough.**

The arithmetic. You wake with 75 energy off a hostel cot. Twelve waking hours to
19:00 at walking exertion costs ~37. A shift's lump cost is another 14–26. You
arrive at the college with about 12 against the 20 the class wants.

So working and studying are mutually exclusive on a given day — but night class
is the *only* door to phase 3 (Field Technician wants 1 credit, Office
Administrator 2, Regional Director 5). The player must alternate work days and
school days, roughly doubling the mid-game, and nothing in the game says so.

Options: drop the class energy floor to ~12; make classes restore a little
morale-and-energy rather than costing 18; give a hot meal or coffee an explicit
"ready for class" framing; or move classes to a weekend block so they compete
with gigs instead of shifts.

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

### 3. Coffee is the cheapest energy in the game, and unlimited

| Source | Cost | Energy | Time |
|---|---|---|---|
| Gas-station coffee | $2 | +22 | 5 min |
| Hostel cot | $9 | +75 | ~9 h |

$0.09 per point versus $0.12, and no time cost worth the name. There is no cap,
no tolerance, no crash. Once you have income, the intended sleep economy stops
binding — and the playtest bot needs coffee to attend class at all, so it is
currently load-bearing for a broken system rather than a choice.

Options: diminishing returns per day; a crash that borrows against tomorrow; a
health cost that scales with count; or leave it, and treat it as the intended
answer to (1).

### 4. Reputation has no ceiling, and the endgame scales off it

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

### 5. The mid-game is one day on a loop

From the moment you hold a tier-3 job to the moment you can afford the
franchise, every day is identical: wake, wash, walk, eight-hour shift, walk,
sleep. In the traces, days 5 through 23 differ only in the cash column. The
franchise buy-in alone blocked 32–41 days per run.

Options: weekly events; a rent/bills rhythm that forces decisions; relationships
or a named NPC with a thread; workplace incidents; something to spend money on
between $200 and $12,000.

### 6. Two upkeep chores dominate the walking

Thirst decays 120 points a day and there is exactly **one** free water source on
the map (the fountain at 26,32). Hygiene decays 46+/day and there is exactly
**one** free wash (the community center at 7,24) — at the opposite corner.

Average 90–100 minutes a day is spent walking, much of it between those two
points. It reads as tedium rather than hardship.

Options: a second fountain in the Outskirts; a standpipe near the hostel; make
bottled water cheap enough to be the obvious buy; let the trailer's shower count
for more.

### 7. Strikes fire for conditions that lapse on their own

Grounds Crew wants energy 35 at the door, Overnight Stocker 30. Energy bottoms
out near zero on most working days. Turning up tired is a disciplinary strike,
and three strikes fires you — after which you fall all the way down the ladder,
because the plaza jobs need clothes and credits you may have sold or spent.

Observed: the bot was fired and dropped back to Mart Clerk mid-run on two seeds.

Options: separate "sent home" from "written up"; let a strike decay after a
clean week; warn at two; or drop energy from the door check and let a tired
shift just pay less.

### 8. Smaller items

- **The trailer is never worth renting.** $70/week is $10/night against the
  hostel's $9, with eviction risk and a rent clock attached. Its real advantages
  (shower, storage, rest quality) are never surfaced.
- **Police fines swing wildly by seed** — $337 to $1,834 across four runs of
  broadly the same play. Early fines feed the debt that caps credit at 600,
  which is the thing that gates the apartment.
- **Nothing happens after you win.** `checkVictory` says "keep playing" and
  there is nothing to keep playing for.
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
