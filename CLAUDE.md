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
  per-tile rate, police checks and encounters on the way. Every balance bug
  found so far was one the teleporting bot could not see.

The playtest prints, per seed: the day each milestone landed, shifts by job,
minutes per day spent walking versus working, meter low-water marks, and a
frequency table of every option the bot found locked and why. That last table is
where the findings come from — a wall shows up as the same lock reason repeating
eighty times.

Run the playtest after any change to meters, jobs, prices or venue hours. A
change can pass all 233 tests and still make the game unwinnable.

## Where things live

- `src/sim/` — the simulation. No DOM, no rendering. `tick.ts` owns the clock
  and everything that happens on it (rent, interest, credit, passive income);
  economy belongs here, not in the renderer, or nothing can test it.
- `src/world/` — the map, as an ASCII grid in `map.ts`. Markers are single
  glyphs stripped at load time into `TOWN.markers`.
- `src/engine/render.ts`, `src/ui/` — presentation only.
- `docs/playtest-findings.md` — open balance and design items, ranked, with the
  numbers behind each. Keep it current when something on the list gets fixed.

## Things worth knowing before changing balance

- The Heights (rows 0–13) are sealed behind one security gate that wants
  appearance 70. The corporate plaza — where every tier-3+ job is worked — is up
  there, so that gate is a daily tax on the whole career track.
- Credit is capped at 600 while any debt is outstanding, and the apartment lease
  wants 620. Clearing the debt is the real lever; say so in any new gate text.
- Night class is the only door to phase 3. Anything that costs energy in the
  evening competes with it directly.
