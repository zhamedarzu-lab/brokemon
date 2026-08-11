# Brokemon

A top-down grid town where the only thing you're catching is a break.

## Workflow

**Always merge finished work into `main` and push it.** Do not leave it sitting
on a feature branch waiting to be asked. Work on the designated branch, then
fast-forward `main` onto it and push both. No pull request unless one is
explicitly requested.

Before merging, all three must be clean:

```
npx tsc --noEmit
npx vitest run
npm run build
```

If `main` has moved ahead, rebase onto it rather than merging backwards —
another agent works on this repo and lands commits between sessions, so always
`git fetch --prune` first and check.

## Testing the game itself

Two harnesses, and the difference between them matters:

- `npx vitest run` — `src/sim/progression.test.ts` drives the real prompt tree
  with a bot that *teleports*. Fast and deterministic. It is the regression net,
  and it cannot see anything that costs time or distance.
- `npm run playtest` (optionally `-- 7 99` for seeds) — `src/sim/playtest.ts`
  drives the same tree with a bot that *walks*: real pathfinding at the real
  per-tile rate, police checks on the way, and the coach when a
  routine asks for it. Every balance bug found so far was one the teleporting
  bot could not see.
- `npm run playtest -- --crossing` — what a Brokedale day trip actually costs,
  and whether a bot stranded there with nothing can get home.

The playtest prints, per seed: the day each milestone landed, shifts by job,
minutes per day spent walking versus working, meter low-water marks, and a
frequency table of every option the bot found locked and why. That last table is
where the findings come from — a wall shows up as the same lock reason repeating
eighty times.

Run the playtest after any change to meters, jobs, prices or venue hours. A
change can pass all 233 tests and still make the game unwinnable.

**Read the spread line before believing a number.** Run length swings 114–284
days on identical code, so the last line of the run tells you what is inside the
noise — currently about 22 days. One seed moving is not a finding. That mistake
has already been made once, on ten minutes of evidence.

## Where things live

- `src/sim/` — the simulation. No DOM, no rendering. `tick.ts` owns the clock
  and everything that happens on it (rent, interest, credit, passive income);
  economy belongs here, not in the renderer, or nothing can test it.
- `src/world/` — the world. `town.ts` holds the `Town` type and every query
  that reads one; `towns/*.ts` hold the ASCII grids; `map.ts` is just the
  registry (`TOWNS`, `STARTING_TOWN`). Markers are single glyphs stripped at
  load time into `town.markers`, and the glyph vocabulary is shared, so a
  second town writing `!` gets the same corner for free.
- `src/sim/coach.ts` — the intercity link. Timetable, fares, journey time.
- `src/engine/render.ts`, `src/ui/` — presentation only. **The town is drawn
  isometrically.** The simulation never knew what projection it was in and still
  does not: it is a grid and a `{x, y}`, and the whole change lives in
  `render.ts`. Three things there are worth knowing before touching it:
  - Tile art is still authored as 16x16 squares. `inTileSpace` skews the unit
    square onto the ground diamond and `inWallSpace` stands it up on a box face,
    so a hundred and forty lines of speckles, brickwork and marble veining came
    through the change unedited. Write new tile art the same way.
  - Draw order is **painter's by `x + y`**, not row-major. A plain nested loop
    puts (5,0) before (0,1) and walls end up drawn over what is standing in
    front of them.
  - Anything tall between the camera and the player is drawn at 0.32 alpha, and
    its *floor* stays solid — `globalAlpha` composites against what is already
    painted, so fading a whole tile at the edge of the view makes a black hole
    rather than something you can see past. The spawn is two rows from the
    southern retaining wall, which is the tallest thing in the game, so without
    this the first frame of a new game hides the player completely.
- `docs/playtest-findings.md` — open balance and design items, ranked, with the
  numbers behind each. Keep it current when something on the list gets fixed.

## There are no random events any more

The encounter system — `events.ts`, `events-places.ts`, `events-brokedale.ts`,
`events-work.ts` and their tests, about 8,600 lines — was deleted deliberately.
Nothing now interrupts a walk. **Do not add it back**, and do not add anything
shaped like it: no pop-up while walking, nothing that hands the player money or
goods they did not choose and work for.

Two things survived the cull because they never lived in that module, and both
are worth knowing about:

- **Interrupts in `tick.ts` are not encounters, but one was behaving like one.**
  `carHit` topped hunger to 58 and thirst to 62 and put a sandwich in your bag,
  so for a starving player walking into traffic was a meal and a packed lunch.
  Everything still in `interruptPrompt` is a consequence of something the player
  did — a citation, a fall, a fever, a missed deadline — and each one costs.
- **The encounters were carrying reputation.** Brokedale's standing came almost
  entirely from helping people in the street, and when that went the only
  positive source left was +2 every tenth shift against -3 for every citation in
  a city that fines you in all four districts. The rig sat at reputation 7 after
  four hundred days and could never buy the block, which wants 40. Standing is
  now paid by **rent settled on time (+2)** and **every shift worked without
  being late (+1)** — deliberate, repeatable, and the two things a landlord and
  an employer actually measure you by.

A dialogue that fires without the player pressing anything needs a reason. The
Log tab and the HUD carry weather, overnight income and meter warnings; none of
those needs a box. `income` and `sick` open once per run and are silent after.

## Things worth knowing before changing balance

- The Heights (rows 0–13) are sealed behind one security gate that wants
  appearance 70 — **or a staff pass**, which any employer up there issues you on
  hire and takes back when you lose the job. Without the pass the gate was
  stricter than every job behind it, which made those jobs' own appearance
  requirements dead text.
- **Anything that costs a little energy can cost a run 150 days.** Arriving
  under a job's door requirement is a strike, three strikes drop you the length
  of the ladder, and the climb back is most of a run. Ninety minutes of overtime
  at -16 energy moved the worst of twenty seeds from 217 days to 368. Measure
  energy costs against the whole distribution, not one seed. See open finding 2.
- Credit is capped at 600 while any debt is outstanding, and the apartment lease
  wants 620. Clearing the debt is the real lever; say so in any new gate text.
- **The bank is the only place a debt can be paid, so its hours gate the
  endgame.** It opens 9–6 against a career that works 9–5; at 9–5 it kept
  exactly the hours of the top two jobs and a Regional Director could never
  walk in, which locked the estate behind a scheduling impossibility. Check
  this whenever a shift or an opening time moves.
- **Panhandling has a plateau, not a peak.** Sympathy is flat across appearance
  28–50 and falls away on both sides. It used to be a single point at 32, which
  priced *washing*: a shelter shower moves a phase-1 player from ~32 to ~50 and
  took a third off the only income they had. Flattening the bottom too is the
  other mistake — it handed 2.4x to a bot sitting at appearance 2.
- **Hunger, thirst and hygiene are sized to a cadence, and the rig prints it.** The
  target is two meals, three drinks, one wash a day and laundry every few;
  `npm run playtest` ends with all four measured. At the old rates it ran 2.3 and
  3.1 — the target hit exactly, with no headroom, so every meter was one you
  nursed. 3.0/hr and 4.2/hr put it at 2.0 and 3.0 with room to spare. Hygiene at
  1.5/hr body and rags at 2.0/hr costs 36 and 38 a day against a +70 shower and
  a +80 laundry, so one wash covers two days.
- **A meter that decays slower can still cost you a run, through the rig.** The
  hygiene change looked like it cost 11 days until the cause turned out to be
  `wash()`'s trigger: at a target of 65 the bot lived in the band just above its
  job's hygiene door, and every shift or downpour put it under one and cost a
  strike — 407 re-hires a run against 337 at a target of 80. Compared fairly,
  slower decay costs 3 days, inside the noise. **A/B the rig's policy before
  believing a meter change.**
- **Bins are a round, not a button.** `TRASH` in `venues.ts` gives fourteen
  doors their own bins, each with its own can/food mix and its own refill clock;
  `searchTrash` in `work.ts` runs all of them and the loose street dumpsters.
  A rummage yields cans *or* food, never both, and food is **offered** — taking
  it costs dignity, and more of it once you have an address. Bins are priced to
  be worth opening when you are already at the door: a dedicated five-door tour
  of the good ones was measured at four days a run *worse*, because a bin holds
  a dollar or two and crossing town for it costs more clock than that is worth.
  Keep the rig's `BIN_ROUND` to doors it already stands at.
- **Exhaustion and dehydration feed each other** (`meters.ts`). Energy at zero
  drains thirst, thirst at zero drains energy, both gentler than the meters' own
  decay so a drink or an hour's sleep still climbs out faster than the loop
  pulls down. Measured at zero cost across ten seeds; check it again if either
  rate moves.
- Night class is the only door to phase 3. Anything that costs energy in the
  evening competes with it directly.
- **Every rule about a town is tested over `TOWNS`, not over Brokemon.**
  `src/world/towns.test.ts` holds the ones that are structural: every door has a
  building around it, every district has a signpost for its own sign text and
  somewhere to drink, every zone that fines you escorts you *out* of itself, and
  every row belongs to exactly one district. Brokedale was written after all of
  Brokemon's tests and inherited the type but not the scrutiny — it shipped with
  a recycling depot that was a bare glyph on gravel and two districts that
  escorted you to a tile inside themselves. Writing those checks over both towns
  then found the same two holes in Brokemon's Heights. Brokemon's `downtown` is
  the one allow-listed escort exception, and the reason is in the test.
- **"Nothing here is free" is about charity, not supply.** Brokedale is meant to
  have no food bank, no free wash and no bench you can sleep on. It is not meant
  to have nowhere to *buy* things, and that kept being read across: the night
  market's tray was eaten at the stall so a resident could not carry food to a
  shift, and nothing in the whole city cleared a fever, so being ill ended in a
  collapse every time — 25 across five runs, every one with hunger and thirst
  fine and `sick` true. `src/sim/town-services.test.ts` checks every town sells
  carriable food, water and medicine, by running the menus and looking in the
  bag rather than by matching button text.
- **There are two towns now.** Housing, rent, hostel nights and reputation are
  one value per town (`PerTown<T>`); reach them through `housingIn`,
  `setHousing`, `bestHousing` and `reputationIn`, never by indexing directly on
  the town you happen to be standing in. Anything charged on the clock — rent
  especially — loops over `TOWNS`, because a landlord does not stop wanting the
  money because you took the coach somewhere else.
- **A Brokedale day trip costs 250 minutes and $26**, of which the coach alone
  is 144 minutes and $20 (`npm run playtest -- --crossing`). Nothing you can
  pay someone for a day's work in Brokedale beats a Brokemon shift plus that,
  so Brokedale is somewhere you move to, not somewhere you commute to. Price
  the rooms, not the wages.
