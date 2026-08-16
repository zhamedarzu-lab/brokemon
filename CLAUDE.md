# Brokemon

A grid town seen from above and a little to the side, where the only thing you're catching is a break.

## Workflow

**Work on `main`. Commit to `main`. Push to `main`.** No feature branch, no pull
request unless one is explicitly requested.

This is worth saying plainly because an agent's harness may hand it a branch
name like `claude/some-task` and tell it to develop there. Ignore that and use
`main` — the owner asked for it directly after a session's worth of work landed
on two identical refs, which is two things to keep track of and one line of
history. If a branch like that appears on the remote, it is a harness default
rather than a decision anybody made; delete it.

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
change can pass all 346 tests and still make the game unwinnable.

**When a venue's hours move, check where it sits in `playDay`.** The rig's day
is ordered by which doors shut — shift, bank, plaza, letting agent — with the
all-day stops (food bank, shops, job board) filling the gaps. Putting a
discretionary stop in front of a closing one has broken this file three times:
banking behind school, the plaza behind the shopping, and the food bank wedged
between a 5PM clock-out and a bank that shuts at 6. That last one cost 388 of
400 days' banking and left the bot holding $2,726 it could not use to clear
$621 of debt that was pinning its credit below the lease it needed.

**Read the spread line before believing a number.** The last line of the run
tells you what is inside the noise. One seed moving is not a finding. That
mistake has already been made once, on ten minutes of evidence.

The noise floor used to be about 22 days on a 114–284 day run. It is now about
2 days on an 82–93 day run, because most of that spread was the rig being fired
at random rather than the game being variable — see below. A change of five
days is now a real signal; it did not used to be.

**The rig's *policy* is part of the measurement, and it had three compensating
bugs.** It ran its morning errands before walking to work and clocked in 105
minutes late on 78% of shifts, so it was sacked every fifth day all run. It
only job-hunted on days it had *not* worked, so the sackings were the only
reason it ever got promoted. And it only reached the corporate plaza before
closing on those same free days, so the sackings were also the only reason it
ever bought the franchise. Fixing the lateness alone froze every seed at Field
Technician for 400 days; all three had to go together. A run is now 84 days
mean where it was 191, and that is the instrument getting better, not the game
getting easier. **Do not compare any number recorded before this against one
recorded after it.**

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
  straight-on and tilted**, like a bird looking down at about 49 degrees. The
  simulation has never known what projection it is in — it is a grid and a
  `{x, y}` — and this is the third one it has survived without a line changing.
  Four things there are worth knowing before touching it:
  - `sx = x * TW`, `sy = y * TD - z * TZ`, with **TW 20, TD 15, TZ 15**. The 4:3
    ratio is not cosmetic: it makes every diagonal a whole number of pixels
    (20, 15, 25 is a 3-4-5 triangle), which a true 45 degrees would not, and in
    pixel art that is a clean edge against a shimmering one.
  - **There is no rotation.** The town used to be isometric, which put the
    grid's cardinals at 45 degrees to the screen's and meant pressing down
    walked you towards the bottom left. `screenPushToStep` is the identity now
    and is kept only so the tests still have something to check and a future
    projection has one obvious place to put its rotation back.
  - Draw order is **row-major, north to south**. Depth is the row, because the
    camera looks straight down the grid. The isometric version had to sort by
    `x + y` and iterate diamonds; this is the simpler thing a straight-on
    camera buys.
  - **One visible side means the edge does the work.** Face and top are pushed
    well apart (0.58 against 1.14) and the eave gets a dark line, because with
    only one face there is nothing else to say where the geometry turns. The
    corners are only drawn on boxes 12px or taller — outlining all four sides of
    an 11px hedge leaves two pixels of hedge and a black brick. `STANDS` did
    *not* need retuning for this projection: a tile was 16px of screen depth
    isometric and is 15px now, so a 15px wall is about one tile either way.
  - Tile art is still authored as 16x16 squares. `inTileSpace` is now a plain
    vertical squash and `inWallSpace` a plain upright rectangle — no skew at
    all, so the art is crisper than it was isometric. You see **one** side of a
    box, not two, which is flatter; the contrast between the front face and the
    top is doing all the work of making it read solid.
  - Anything tall in the rows *in front of* you is drawn at 0.32 alpha with its
    floor left solid. `globalAlpha` composites against what is already painted,
    so fading a whole tile makes a black hole rather than something you can see
    past.
- `src/sim/move.ts` — **the movement rules, read by both the game loop and the
  walking rig.** Which steps are legal, which way a step leaves you facing, and
  what a step costs. Movement is eight-way: two keys at once on a keyboard, an
  eight-sector thumbstick on touch.

  **The controls are wired straight to the grid, and that is deliberate.** The
  camera looks down the grid rather than across it, so pressing down walks you
  down the screen with no rotation in between. `screenPushToStep` is the
  identity; it survives as a function so `move.test.ts` can keep checking
  "pushing down moves you down the screen" against `screenX`/`screenY` rather
  than against a table, which is what made the change from isometric safe.

  **A step is paced by pixels and charged by ground, and those are two numbers**
  (`stepPacing`). A step is worth 1 or root-two tiles and the clock must charge
  that, or crossing the map gets cheaper depending on the route. The same step
  is worth 15, 20 or 25 *pixels*, because a tile is 20 across and 15 deep — so
  pacing the animation by ground alone makes walking north-south look slower
  than walking east-west. `animScale` stretches the duration so apparent speed
  is constant; `timeRate` scales the clock during it so the ground still costs
  what it costs. The invariant `animScale * timeRate === ground` is tested, as
  is "same pixels per second in all eight directions"; do not collapse them
  into one number, because the step lengths genuinely differ **five to three**
  (25px diagonal against 15px vertical) and no single scale satisfies both.
  Note that 5:3 is the spread of the *steps*; the *tile* is 4:3. Writing one
  where the other belongs passes anyway, because 20/12 and 25/15 are the same
  number — `move.test.ts` says so at the point it would happen.

  Two things in `move.ts` itself are load-bearing:
  - **A diagonal costs root two.** It covers 1.41 tiles of ground and takes
    1.41x as long, so ground covered per second is the same in every direction
    and diagonals buy shorter *routes*, not speed. Charging one would have given
    every path in the game a 41% discount.
  - **A diagonal needs both squares it passes between to be clear.** The looser
    rule lets you clip a corner, and in a town whose doorways are one tile wide
    it would be a second, invisible way into every building.
  The rig's pathfinder is a Dijkstra over the same rules, not a BFS — a rig that
  walked diagonals for free would report a town 30% smaller than the one being
  played, in the same walking figure the findings are built on.
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
