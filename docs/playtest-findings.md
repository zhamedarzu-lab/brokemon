# Playtest findings

From a headless bot that walks the real grid at the real per-tile rate, takes
police checks and street encounters on the way, and records where each day
actually goes (`npm run playtest`). Numbers below are from ten seeds run to a
win — four was not enough to tell a change from the noise, which is finding 20.

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
| 20 | Four seeds could not see anything | Run length swings 114–284 days on identical code, sd ≈ 43. Any change smaller than about 22 days is invisible in that spread, and one nearly got tuned on: the encounter roll moving 0.4 → 0.28 looked like it had doubled a run, and across ten seeds it moves the mean by a single day (163 → 164). The rig runs ten seeds by default now and prints the spread with a line saying what is inside the noise | the rig itself — `npm run playtest` |
| 21 | The rig and the renderer each kept their own copy of the encounter chance | The game moved to 0.28 and the rig stayed on 0.4, so every encounter figure it printed described a game nobody was playing. One `EVENT_CHANCE` in `events.ts`, imported by both | shared constant; the compiler |
| 23 | All Brokedale's water was at the wrong end of town | A standpipe at the coach station and a river at the far edge, nothing in the ten rows where you live and work. Finding 17 again, at full size, in a city with no free wash to go with it. A standpipe on St Giles Row | `map` — keeps water within reach of the rooms |
| 24 | The morale floor on site work was a spiral, not a speed bump | Every other gig has one, and that is fine in Brokemon, which has a food bank and a free wash to climb back with. Brokedale has neither: one bad day compounded into thirteen "you cannot make yourself do this today" in a row, eight collapses and reputation on the floor across two seeds. Site work asks for energy and nothing else now — an agency whose pitch is that it asks no questions does not get to ask that one. 21/21 days worked afterwards | `coach` — takes anyone at the agency muster |
| 25 | The hire roll judged your looks even for jobs that do not | `0.25 + (look - (requires.appearance ?? 30)) / 60` ran for every job, including the ones with no appearance requirement at all. That put a hidden dress code on the whole Brokedale ladder, which exists precisely so a player who cannot hold appearance 70 has somewhere to go, and made nonsense of the overnight stocker, whose pitch is that nobody sees you. Those hire on reputation and turning up. Brokemon moved 164 → 165 days over ten seeds, inside the noise | `coach` — never asks how you look, at any rung |
| 26 | The interview asked whether you were tired | Energy and morale belong at the door on the morning of a shift, not at an interview. The rig applied after a six-hour shift and was told it was "too worn out for this right now", twenty days running. `hiringRequirements` strips both. Same family as 13: the check that gets you hired and the check that gets you through the door are not the same question | `coach` — hires you tired |
| 27 | A 6AM shift could not be clocked into on time | Every bed wakes you at 7. The picker was hired, written up for lateness three times, fired and rehired six times in three weeks before anyone noticed the start time was an hour before the earliest possible wake | `coach` — can be clocked into from a bed that wakes you at seven |
| 39 | Nine encounters were pop-ups, not decisions | "A paper bag on the bench", "A dog", "A split bin bag" — a thing happened, the effects were already applied, and the only button meant "yes". Two are cut and seven are decisions now. The root cause was structural: all nine applied their effects inside `build()`, before the box appeared, so the choice could only ever be an acknowledgement | `events-quality` — every encounter is a decision; nothing is given before you decide |
| 40 | Encounters knew the district but not the doorway | A zone is thirty rows deep, which is right for "the police here are worse" and useless for "there is a shop". Fourteen encounters now fire *at* a named door — the kids outside the Mart, the queue at the food bank, the man with the letter on the bank steps — and being there outranks the ambient pool five to one, because at equal weight standing outside the Mart made the kids one in eighty | `events-quality` — fires outside the door it belongs to; names a door that exists |
| 41 | The same stranger could stop you again two encounters later | The no-repeat window barred the last two. That stops the literal back-to-back repeat and does nothing about the *feeling* of repetition. Eight deep now, against a pool ninety encounters wide | `events` — never shows the same event twice running |
| 42 | Doors within six tiles of each other borrowed one another's encounters | `at()` fired on "within a short walk", and the town is dense: the bank is five tiles from the hospital and the church backs onto the recycling yard, so the A&E discharge scene played at the bank counter and the bin run played in a pew. The nearest door owns the pavement now — `near.closest`, not `near.has` | `events-quality` — owns the pavement outside its own door |
| 43 | Fourteen doors had nothing behind them | The diner, the church, A&E, the bike shop, the job board, both bus stops, the recycling yard, the panhandle pitch, the trailer park, the lobby, the estate gates, the agency, the job centre, the gym and the doss house door were all just walls you walked past. Twenty-two more encounters, place-tied: the declined card at the counter, the soup run that needs a pourer, the bike with a child's name still on the crossbar, `RING MARK` and his $40 registration fee, somebody already sitting in your pitch. Ten seeds: mean 177 → 176, sd 3, 10/10 winning | `events-quality` — has no encounter written so tightly it can never happen |
| 44 | The two starter jobs paid the wrong way round | Delivering flyers is four addresses at four corners of the map and the walking between them is the job; yard work is ninety minutes standing still in one garden. The board paid $22 for the first and $35 for the second. Flipped to $35 and $20 | `balance` — pays the harder job more |
| 45 | The board never said what a job would take out of you | You could accept a flyer round on fumes, walk to the third address, and find the door requirement checked again at every stop — stack of paper still in the bag when the window closed. Each gig now shows the energy needed to *finish*, and says "you'd run dry" when you haven't got it | `balance` — shows the energy you need to finish; warns you when you would run dry |
| 46 | Every bin in town was the same bin | One dumpster, pressed forty times, paying cans and food and sometimes cash all at once. Fourteen doors have their own bins now, each with its own mix and its own refill clock — the plaza is the best cans in either town and has nothing edible, the night market is the reverse. A rummage gives cans *or* food, food is offered rather than given, and the coat-pocket dollar is gone. Measured: a dedicated tour of the good bins costs **four days a run**, so they are priced to be worth opening when you are already at the door | `trash` — a bin holds one thing; never hands over money; refills on its own clock |
| 47 | Empty meters sat harmlessly at the bottom of the bar | Energy at zero cost you a morale trickle and nothing else. It drains thirst now, and thirst at zero drains energy — the only feedback loop between meters, deliberately gentler than their own decay so a drink or an hour's sleep still climbs out faster than the loop pulls down. Ten seeds, A/B: no measurable cost | `meters` — pulls gentler than a drink or an hour of sleep can push back |
| 48 | Two meters were being nursed rather than managed | The design target is two meals and three drinks a day, and the walking rig measured 2.3 and 3.1 — the target hit exactly, on the edge, with nothing in hand. Hunger 3.6→3.0/hr and thirst 5.0→4.2/hr puts it at **2.0 and 3.0 with headroom**. The rig prints both figures at the end of every run now, so the cadence is a number rather than a feeling. Ten seeds: 179 → 173 days, 10/10 winning | `balance` — survives two weeks with nothing, across ten seeds |
| 49 | A balance bound was a fact about one seed | `collapses <= 3` over a fortnight on the street had been true of seed 7 and of nothing else — at the same rates, seeds 3 and 42 collapsed 5 and 4 times, and seed 1 seven times. The test runs ten seeds and asserts on the mean (3.0, was 3.9) with a worst-case ceiling. The lesson is the one already at the top of this file, applied to a unit test rather than to the rig | `balance` — the test itself |
| 50 | The bins were too thin to be a living | Cans are the bottom rung of the economy and a rummage was paying one to five of them. Every bin's range is up about 60% — the plaza 3–8 → 5–12, the Mart 2–7 → 4–10, the street dumpster 1–5 → 2–7 | `trash` — a bin holds one thing |
| 51 | Hygiene was a bar you topped up, not one you kept | A day cost 46 body against a +70 shower and 58 clothes in rags against an +80 laundry — a wash every day and a half, laundry every thirty-four hours. Body 1.9→1.5/hr and rags 3.0→2.0/hr costs 36 and 38, so one of each covers two days, and better clothes still need less looking after | `meters` — one wash lasts a day |
| 52 | The rig lived on the edge of its own job requirement | Slower hygiene decay appeared to cost 11 days and 8 of 10 seeds. It was `wash()`'s trigger, not the rates: at a target of 65 the bot spent the run in the band just above the hygiene door of the job it held, so every shift or downpour put it under and cost a strike — **407 re-hires a run against 337** at a target of 80. Compared fairly at the same policy, the decay change costs 3 days, inside the noise. Fifth time the rig has been the thing that moved | the rig — `wash()` |
| 53 | The game paid you for being dirty | Panhandling sympathy was a point at appearance 32 falling away in both directions, so a shelter shower — 32 to about 50 — took a third off a phase-1 player's only income. Invisible until hygiene was made easier to hold, at which point a fortnight on the street stopped covering the $28 to get off it. It is a plateau across 28–50 now. A first pass flattened the bottom too and handed **2.4x** to a bot at appearance 2, which is the same bug pointing the other way | `balance` — does not charge you for washing before you sit down; still pays nothing to somebody who visibly does not need it |
| 54 | Three more bounds were facts about one seed | `cash > $28 after a fortnight` was measuring the bot's *spending policy* — purses swing $12–$514 across ten seeds while earnings sit in a tight $582–716 band — so it asserts on earnings now. `panhandling < $200` was three times slack against a measured $52–72. The yard-work "never behind the gate" check sampled thirty draws on one seed | `balance` — all three |
| 55 | Brokedale's recycling depot had no building | The venue existed, the map did not — a bare `9` standing in a gravel field, and it is the only way a penniless arrival makes money in that city. Brokemon draws the same door as `#####9#####`. Every marker in every town is now checked for a building around it | `world/towns` — puts a building around every door |
| 56 | Two districts fined you and then escorted you to themselves | The High Street escorted to row 24, which is the first row of the High Street; Riverside to row 32, the first row of Riverside. That is not being moved on, it is being told to stand up, and the same officer checks you again on the next tick | `world/towns` — escorts you somewhere other than where it moved you on from |
| 57 | Written sign text with no signpost, and a district with nowhere to drink | Two of Brokedale's four districts had `sign` text no player could ever read, and the High Street — the district with the depot, the exchange and the pawnbrokers — had no water in it at all, against thirst being the fastest meter in the game. Writing the check over both towns found the same two holes in Brokemon's Heights | `world/towns` — gives every district a signpost; puts drinking water in every district |
| 58 | Riverside was 56% one encounter | The zone-spread test — eight distinct encounters, none above 25% — had only ever looked at Brokemon's three zones. Brokedale ran 4/6/4/3 distinct, and over half of everything that happened on the riverside was the same man telling you to stand away from the same car. Fifteen new encounters bring all four districts to 8 distinct at 17–23% | `events` — gives each Brokedale district a spread too |
| 59 | Three encounters were pop-ups for a player with no money | The decision check ran one bot with $120 in its pocket, which can afford every option. `bd_tout` and `bd_twoAM` greyed out their only real choice for somebody broke — a man off the coach at 3AM, or somebody starving outside a stall of food about to be binned, with nothing to press but "Move on" — and `bd_showers` was the pure archetype, a man tells you something and the only button is "Thank him". The check now runs a destitute save across five times of day | `events-quality` — leaves you something to do even when you have nothing |
| 60 | Brokedale's water was called "the fountain" | One glyph, two towns, and not the same thing behind it: Brokemon has an ornamental fountain in Market Square, Brokedale has a canal through the Blocks and the river along its southern edge. You drank from a decorative basin on the towpath | none — `waterName` in `actions.ts` |
| 61 | You could not carry food out of any shop in Brokedale | The night market's tray is eaten standing at the stall, and it was the only food in the city — so a resident went out on an eight-hour depot shift with an empty bag and bottomed out at hunger 0 in the middle of it, most days of a 248-day run. Queuing on the way *to* work is not the answer; that was tried, and forty-five minutes in a queue made the bot chronically late and demoted every fifth day. The stall sells a packet you can carry now, and the rig buys tomorrow's out of tonight's trip. Seed 7: **248 days and 9 collapses → 187 and 0** | `town-services` — sells food you can carry out of the shop |
| 62 | Nothing in Brokedale treated being ill | Being ill has three ways out: medicine, a clinic, or collapsing. Brokedale had no clinic, no hospital and nothing on a shelf, so it had only the third — which costs $100 of debt and a day and does not stop it happening again. **25 collapses across five runs, every one with hunger and thirst perfectly fine and `sick` true**; the meter columns read like starvation and were nothing of the kind. The market sells tablets at $18 against $12 at home. Five seeds: **25 collapses → 0** | `town-services` — sells something that clears a fever |
| 36 | A Regional Director could never enter their own bank | The bank opened 9AM–5PM. Office Administrator and Regional Director work 9AM–5PM. The estate wants a 720 credit score, the score is pinned at 430 while any debt is outstanding, and the only place to pay a debt is the bank — so reaching the best job in the game permanently locked the ending it leads to. A run finished with $244,495 in savings, $1,678 of debt it could not hand over, and 152 refused offers. Open until six now | the numbers: 3/10 seeds winning → 10/10 |
| 37 | The rig had never heard of a launderette | Hygiene became the average of how clean *you* are and how clean your *clothes* are. The bot only ever washed itself, so it capped at 49 and spent 97 applications being told it needed to be a lot cleaner (49/70) — which read as an impossible job requirement and was an instrument that did not know the mechanic had changed. Fourth time the rigs have gone blind to a change; see 16, 17, 21 | `playtest` — washes both halves |
| 38 | The rig banked after the bank shut | `banking()` ran at the end of the errand list, so a 9-to-5 always arrived after closing. Two seeds finished with eighty thousand in cash and a few hundred of debt they never handed over. Moving one call to straight after the shift took the ten-seed spread from mean 252 (8/10 winning) to **mean 181, sd 8, 10/10** — the tightest the game has measured | `playtest` — banks on the way out of work |
| 33 | Sixteen minutes early read as "not your hours" | The clock-in hint said the same thing to somebody a quarter of an hour early and somebody sixteen hours out, which reads as "you cannot work today" — on the one button the whole mid-game is spent pressing. It says how long until the shift starts now | `work-events` — tells somebody sixteen minutes early that they are early |
| 34 | The journal was still a one-town, one-ending game | Phase 4 offered only the estate, so a player who had moved to Brokedale was told the way out was a hill in a town they no longer lived in. The job ladder listed all nine rungs flat, telling a Brokemon player they did not qualify for a warehouse job in a city they had never visited — and read them against the *shift* requirements, so it gave "you are too worn out for this right now" as a reason you do not qualify for a career. Grouped by town, read against the hiring requirements, and both endings named | UI; found by playing it |
| 35 | Small text ones, found by reading the screens | "Corner of The Outskirts" (zone names carry their own article); the franchise lock said "the buy-in is $12,000" without saying what you have, unlike the estate and the block next to it | text only |
| 30 | Every tier-3 job was worked behind a gate stricter than the job | Field Technician, Office Administrator and Regional Director all clock in at the Corporate Plaza, above the hedge, behind a barrier wanting appearance 70 **every morning**. The technician's own appearance 60 was dead text — you could not be at the desk without already clearing a higher bar, and nothing warned you when you took the job. An employer up there issues staff a pass, because that is what employers do, and the guard is not being asked to judge somebody who works there. Lose the job and the lanyard goes back. Derived from where the workplace sits, so redrawing the hill cannot leave it stale | `work-events` — knows which jobs are worked behind the barrier, from the map |
| 31 | The mid-game was one day on a loop | Days 5–23 of a tier-3 career differed only in the cash column, and the street encounters could not reach it because by then you are indoors and on shift. Ten workplace incidents now fire after the wage on **30–38% of shifts**: overtime, covering for somebody, a mistake you can own or bury, a reference, a coat on a chair. Twenty seeds, A/B: mean 159 → 157, median 150 → 148, sd 30 → 30 — the days vary and the run length does not | `work-events` — fires on about a third of shifts, not every one |
| 32 | Two hours of overtime opened a 150-day tail | The first cut cost 2h and −16 energy. Twenty seeds went mean 159 → 179 and the worst run 217 → 368 days: overtime dropped you under the *next* morning's door requirement, which is a strike, and three strikes drop you the length of the ladder. Ninety minutes at −9 puts the whole distribution back on top of the baseline. Worth knowing that open finding 4 will turn any small energy cost into a run-length tail | measured; the A/B above |
| 29 | Brokedale had no compounding, so its apex took 1.7x as long | The block landed around day 280 against the estate's 165 — outside the noise floor, so real. Not the price: Brokemon has a franchise, a mayoral salary and an index fund, and Brokedale had none of them, so every dollar toward the building came from turning up. A let pitch at the night market fixes it in the fiction. Sized by measuring twice — the first pass at $190 a night did not level the two apexes, it inverted them, on every seed. At half that: 119, 145, 189, 194, 217, 237, mean 184 against 165 | `coach` — is much smaller than the franchise |
| 28 | Brokemon's whole encounter pool fired in Brokedale | The weight functions only ever saw a zone, so once Brokedale had districts of its own every Brokemon event fell through their ternaries: sixteen distinct ones on a measured run, including a bin lorry on Route 1 and the lads outside the chip shop, forty minutes up the road. One pool per town | `coach` — does not borrow Brokemon's |
| 22 | Stranded in Brokedale was a soft lock | The scope wants stranding "possible, survivable and memorable". Rode out with the fare and nothing else: eight days, never above $9, health on the floor, never got home. Cans were the only earnable thing and there was nowhere to sell them. A scrap yard on the back lot turns two days of bins and begging into the fare home — no collapses, no charity | `map` — gives a penniless arrival some way to earn the fare home |
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

## The encounter system was removed

`events.ts`, `events-places.ts`, `events-brokedale.ts`, `events-work.ts` and
their tests — about 8,600 lines — were deleted on request. Findings 11, 12, 28,
31, 39, 40, 41, 42, 43, 58 and 59 below are all about that system and are kept
only as history; the code they describe is gone. Do not act on them.

What the removal cost and what it exposed:

| # | Item | What was found |
|---|------|----------------|
| 63 | Getting hit by a car fed you | `carHit` topped hunger to 58 and thirst to 62 and put a sandwich in your bag, so for a starving player walking into traffic was a meal and a packed lunch. It survived the cull because it is an interrupt in `tick.ts`, not an encounter. It costs you now and gives nothing |
| 64 | Reputation had almost no positive source left | Brokedale's standing came from helping people in the street. With that gone the only positive was +2 every tenth shift against -3 per citation, in a city that fines you in all four districts — the rig sat at reputation 7 after 400 days and could never buy the block, which wants 40. Rent paid on time is +2 and every shift worked without being late is +1. Four of five Brokedale seeds go from never finishing to 193–241 days |
| 65 | Three dialogues fired without the player doing anything | Weather changes opened a box on every turn to wet or cold; overnight income opened one every single day once you owned anything; the fever notice opened every time you caught one. All three are in the HUD or the Log already. Weather is silent now, income and fever open once per run |
| 66 | Run length, with no events at all | Ten seeds: **169 → 206 days** before the reputation fix, **193** after, 10/10 winning, sd 4. The encounters were a net income source; losing them makes the run about a seventh longer and considerably quieter |

## Diagonal movement

| # | Item | What was found |
|---|------|----------------|
| 67 | You could not walk down a diagonal street | The town is drawn isometrically and its streets run diagonally on screen, so a four-direction grid had the control fighting the projection. Movement is eight-way now — two keys at once on a keyboard, an eight-sector thumbstick on touch, replacing a d-pad that could only ever ask for four. Brokedale's walking drops **91 → 77 minutes a day**; run length moves 193 → 192 across ten seeds, which is inside a noise floor of 2 |
| 68 | The rig would have priced diagonals at zero | Its pathfinder was a breadth-first search counting steps, which is right only while every step is worth one tile. It is a Dijkstra over `move.ts` now. Left alone it would have reported a town 30% smaller than the one being played, in the same walking figure this document is built on |
| 69 | The Brokedale report compared against a number nothing computed | `164 min a day in Brokemon` was a literal in a template string. Measured over ten seeds it is **303**. It had been wrong by a factor of nearly two for an unknown length of time, in the line that exists to justify the whole second town |

## Open — ranked by how much they cost the player

- **One Brokedale seed loses its job 93 times.** Seed 7 re-hires 93 times across
  400 days against seed 11's 2, with zero missed shifts — so it is being struck
  out on a door requirement rather than failing to turn up, and it never holds a
  job long enough to build standing. It is the only one of five seeds that does
  not finish. This is the top open item and it is the same family as the strikes
  finding below.



### 1. Walking still dominates the day, and the town just doubled

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

### 2. Strikes fire for conditions that lapse on their own

Grounds Crew wants energy 35 at the door, Overnight Stocker 30. Energy bottoms
out near zero on most working days. Turning up tired is a disciplinary strike,
and three strikes fires you — after which you fall all the way down the ladder,
because the plaza jobs need clothes and credits you may have sold or spent.

Observed: the bot was fired and dropped back to Mart Clerk mid-run on two seeds.

Options: separate "sent home" from "written up"; let a strike decay after a
clean week; warn at two; or drop energy from the door check and let a tired
shift just pay less.

**This is now the top item.** It is the amplifier behind finding 32: any change
that costs a little energy turns into a run-length tail, because the punishment
for arriving tired is a strike and three strikes drop you the whole ladder. It
cost 150 days on the worst seed of a twenty-seed sweep, from ninety minutes of
overtime.

### 3. Smaller items

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

**The rig rides the coach.** `commuteTo` walks to the stand, pays the fare and
waits on the stand for the departure, and every minute and dollar of it lands in
the day's log. `goto` deliberately *refuses* to cross towns and records a block
instead, so a routine naming a place in the wrong town shows up in the blocks
table rather than quietly riding forty minutes to a dumpster.

`npm run playtest -- --crossing` measures the link on its own:

```
spawn to the Market Square stand: 27 min on foot
and out to Brokedale:             73 min (wait included), $6
back again:                       88 min, $14
round trip: 250 min of a 1440-minute day, $26 gone
coach alone: 144 min and $20
```

**Read that before pricing anything in Brokedale.** A day trip costs a sixth of
the day and $26 before you have earned a penny, so a job over there has to beat
a Brokemon shift *plus* 144 minutes and $20 — which it will not. Brokedale is
somewhere you move to, not somewhere you commute to, and the Phase 2 room
prices are the real decision, not the wages.

The same command then strands a bot with the fare and nothing else and reports
whether it gets home. That check found the item 22 soft lock.

`npm run playtest -- --brokedale` lives there instead: the agency muster, the
washhouse, the night market, and a room when the deposit is in reach. It reports
**93 minutes a day walking against Brokemon's 164**, which is the whole reason
the city is dense, and it found both of the items below.

The "guarded by" column names the file and the test. To check one item:

```
npx vitest run -t "lets you sit the class on fumes"
```
