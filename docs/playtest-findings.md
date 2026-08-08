# Playtest findings

From a headless bot that walks the real grid at the real per-tile rate, takes
police checks and street encounters on the way, and records where each day
actually goes (`npm run playtest`). Numbers below are from four seeds run to a
win.

Everything under **Fixed** is merged to `main`, with the commit and the test
that guards it. Check there before picking up a follow-up task — two items on
this list were reported again after they had already been done.

Everything under **Open** is scope, not work in progress. Nothing there has been
changed.

---

## Fixed

All in `3551a76`.

| # | Fault | Effect | Guarded by |
|---|---|---|---|
| 1 | `sleep()` read "until 7AM" literally at 8AM | 23 hours gone, woke starving on the far side of an unplayed day | `tick` — gives you a nap, not a lost day |
| 2 | Sleep paid a full night's rest for any duration | Lying down at 7:00 for the half hour left on the clock returned a whole night, repeatably | `tick` — pays back rest by the hour |
| 3 | Overnight shift stamped with the day it *ended* | The stocker could only work every other night | `tick` — lets the overnight crew work every night |
| 4 | Mart shut its own staff out at 11PM | The 10PM–3AM shift was clockable only in its first hour | `balance` — lets the overnight stocker in when the shutters are down |
| 5 | Yard work could send a phase-1 player to the estate | Behind a gate wanting appearance 70; burned the day's only yard slot on an impossible job | `balance` — does not send a phase-1 player up the hill to mow a lawn |
| 6 | Index fund did not count toward credit | Estate wants 720, debt-free ceiling is 700 — taking the bank's own advice locked the ending | `tick` — counts the index fund as savings |
| 7 | Lease and estate blamed the credit score | The real levers (the debt, the savings) were never named | text only, no test |

### Second pass

All in `4b44b36`.

| # | Fault | Effect | Guarded by |
|---|---|---|---|
| 8 | Night class wanted 20 energy and cost 18 | A shift left you at ~12, so earning and studying could not happen on the same day. Now 10 and 12 — you can attend on fumes and have nothing left after | `balance` — lets you sit the class on fumes |
| 9 | Marble drew a two-tone 8px checker | The fountain plaza is a solid 13x7 field of it and read as a transparency hole in the map. Polished slabs with grout and veining now | visual, no test |
| 10 | Every building was the same brown wall | Nameplates over every door — the only way to find the hostel was to open all of them | `map` — puts a name over every door you can walk into |
| 11 | Filler encounters drowned out the zone ones | `change` + `cans` were two encounters in five everywhere, including a gated private road. Weighted by zone, and eighteen new situations added | `events` — gives each zone a spread; does not put a split bin bag on a private road |
| 12 | The same encounter could come up twice running | The cooldown discounted repeats but never barred them. The last two are now excluded outright | `events` — never shows the same event twice running |
| 13 | The interview hired you into a dress code you might not meet | Hired in rags as Mart Clerk, every shift a strike, three strikes and the lead was gone. It says so now | `events` — warns when the dress code is beyond you |
| 14 | A pending interview existed only as a flag | Set up, never mentioned again, then fired days later as a random encounter. It sits in the HUD task line now | UI only, no test |
| 15 | `repDescriptor` in `main.ts` duplicated `reputationLabel` | Two copies of the same thresholds. One source of truth, and the crossing-message tables are total records so a new tier cannot compile without its lines | `state` — has a crossing message for every tier; plus the compiler |

### Third pass

| # | Fault | Effect | Guarded by |
|---|---|---|---|
| 16 | Test rigs wrote tile coordinates down | The town grew 48x50 → 72x72 and two rigs silently walked to tiles where scenery used to be, reporting healthy runs that never scavenged, drank or slept. `world/landmarks.ts` finds scenery by what it is | `map` — the scenery a phase-1 day needs |
| 17 | All free water was one lake in downtown | A 52–58 tile round trip from spawn and the hostel, for a meter that empties three times a day. A standpipe in the outskirts took it to 11–18; collapses went to zero and seed 11 came back from 320 days to 187 | `map` — puts free water within reach of the outskirts |
| 19 | Reputation had no ceiling | It only ever went up, ending runs at 546–723. That put the franchise on $1,000+ a day and `+reputation/200` past certainty on every interview, so the last third of a run had no failure mode. Gains now shrink as your name grows and stop at 100; losses land in full. The franchise gets its own base rather than borrowing one from a runaway number. Runs settle at 68–83 reputation and 138–210 days | `state` — never gets past the ceiling |
| 18 | Coffee had no ceiling | Not a price problem — at $3 for +12 it is dearer per point than a bed. The hole was that nothing capped it: seven cups was $21 and 35 minutes and bought back a night worth $88–680 of shift time, so once employed you could stop sleeping. Each cup now does less than the last, and a night on top of a stack of them is not a proper night | `tick` — cannot replace a night's sleep |

### Already done, if a follow-up task says otherwise

Two items came back round as fresh tasks after they had been fixed. Both are
closed by `4b44b36`:

- **Deduplicate the reputation label.** Done. `repDescriptor` and its threshold
  table are gone from `main.ts`; `REPUTATION_TIERS` in `src/sim/state.ts` is the
  only definition, and `main.ts`, `journal.ts` and `changeReputation` all read
  from it.
- **Let the interview unlock the Mart Clerk shift for a player in a lower job.**
  There is nothing to do here as written, and it is worth knowing why. The hire
  path compares tiers, so it already declines to demote a night stocker,
  landscaper or technician — and no employment sits below tier 2, so the case
  the task describes cannot occur. The real defect was next to it: the interview
  reads you on appearance, which a clean face in rags passes, while the till has
  a dress code. You were hired, sent home from every shift, fired, and the
  once-only lead was spent. That is item 13, and it is fixed. If the task's
  acceptance criteria are written against the original framing they will not
  match the code.

---

## Open — ranked by how much they cost the player

### 1. Every career job is worked inside the gated zone

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

### 2. The mid-game is one day on a loop

From the moment you hold a tier-3 job to the moment you can afford the
franchise, every day is identical: wake, wash, walk, eight-hour shift, walk,
sleep. In the traces, days 5 through 23 differ only in the cash column. The
franchise buy-in alone blocked 32–41 days per run.

Options: weekly events; a rent/bills rhythm that forces decisions; relationships
or a named NPC with a thread; workplace incidents; something to spend money on
between $200 and $12,000.

### 3. Walking still dominates the day, and the town just doubled

The map went from 48x50 to 72x72 — 2.16x the area. Average walking went from
90–100 minutes a day to **154–173**, time actually on shift fell, and one seed
went from 126 days to 320. The whole suite passed throughout; only the walking
rig could see it.

Adding a standpipe to the outskirts (water was a 52–58 tile round trip from
spawn and the hostel; now 11–18) recovered most of it — collapses across three
seeds went to zero, fines fell by up to 90%, and the 320-day seed came back to
187. Walking is still ~160 minutes a day, which is inherent to a map this size.

What is left:
- The community center is still the **only** free wash, 50 tiles from spawn.
  The hostel's $2 shower and the trailer are the paid alternatives.
- The college is 87 tiles from spawn (~60 minutes each way) and night class is
  mandatory for phase 3. This self-corrects once you hold the apartment at
  (62,52), which is close to it — arguably good design, but brutal before then.

Options: a second free wash in the outskirts; make the bicycle discoverable
(see below) since it halves every walk; more bus stops.

### 4. Strikes fire for conditions that lapse on their own

Grounds Crew wants energy 35 at the door, Overnight Stocker 30. Energy bottoms
out near zero on most working days. Turning up tired is a disciplinary strike,
and three strikes fires you — after which you fall all the way down the ladder,
because the plaza jobs need clothes and credits you may have sold or spent.

Observed: the bot was fired and dropped back to Mart Clerk mid-run on two seeds.

Options: separate "sent home" from "written up"; let a strike decay after a
clean week; warn at two; or drop energy from the door check and let a tired
shift just pay less.

### 5. Smaller items

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

The "guarded by" column names the file and the test. To check one item:

```
npx vitest run -t "lets you sit the class on fumes"
```
