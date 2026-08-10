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
  per-tile rate, police checks and encounters on the way, and the coach when a
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
- `src/engine/render.ts`, `src/ui/` — presentation only.
- `docs/playtest-findings.md` — open balance and design items, ranked, with the
  numbers behind each. Keep it current when something on the list gets fixed.

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
- Night class is the only door to phase 3. Anything that costs energy in the
  evening competes with it directly.
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
