/**
 * Brokedale — the city, forty minutes up the road.
 *
 * This is the Phase 1 stub: the coach terminal and one street off it. Enough
 * to prove the link works — you can arrive, walk, buy something, sleep, and
 * get back — and no more. The districts in `docs/brokedale-scope.md` land in
 * Phase 2 and will grow out of this grid rather than replace it.
 *
 * What is already true of the place, and should stay true as it grows:
 * Brokemon Town has a floor and no ceiling; Brokedale has a ceiling and no
 * floor. There is no food bank here, no free wash and no free bed. There is a
 * concourse that stays open all night and does not ask you anything, which is
 * the whole character of the Terminal Quarter.
 */

import { buildTown, type Town } from "../town";

// prettier-ignore
const ROWS = [
  /* 00 */ "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
  /* 01 */ "W^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^W",
  /* 02 */ "W##################C###################W",
  /* 03 */ "W______________________________________W",
  /* 04 */ "W______b_______________________b_______W",
  /* 05 */ "W____L____________________________!____W",
  /* 06 */ "W__________~~_______n__________________W",
  /* 07 */ "W________%___________________x_________W",
  /* 08 */ "W______________________________________W",
  /* 09 */ "W==================cc==================W",
  /* 10 */ "W==================cc==================W",
  /* 11 */ "W______________________________________W",
  /* 12 */ "W__^^^^^^^^^^^^^________^^^^^^^^^^^^^__W",
  /* 13 */ "W__######K######________######E######__W",
  /* 14 */ "W______________________________________W",
  /* 15 */ "W____________b____________L____________W",
  /* 16 */ "W_____%__________________________%_____W",
  /* 17 */ "W______________________________________W",
  /* 18 */ "W___________________n__________________W",
  /* 19 */ "WrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrW",
  /* 20 */ "Wrrrrrrrrrrrrrr%rrrrrrrrrxrrrrrrrrrrrrrW",
  /* 21 */ "Wrrrrrrrrrrrrrrrrrrrr9rrrrrrrrrrrrrrrrrW",
  /* 22 */ "W,,,,,T,,,,,,,,,,,,,,,,,,,,,,,,,,,,T,,,W",
  /* 23 */ "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
];

export const BROKEDALE: Town = buildTown({
  id: "brokedale",
  name: "Brokedale",
  rows: ROWS,
  // `recycling` and `panhandleSpot` are Brokemon's glyphs reused: the venues
  // behind them are generic, and a scrap yard is a scrap yard. They are also
  // the only two ways to make money here, which is deliberate — the walking
  // rig showed that without the yard, riding out with the fare and nothing
  // else was not a bad night, it was a soft lock.
  requires: ["coachTerminal", "dossHouse", "nightMarket", "panhandleSpot", "recycling"],
  zones: [
    {
      id: "terminal",
      name: "Terminal Quarter",
      sign: "BROKEDALE COACH STATION — concourse open 24 hours. No trading on the forecourt.",
      from: 0,
      to: 10,
      // Grimier than anywhere downtown in Brokemon and it still fines you.
      // Brokedale's whole pitch is that nothing here is free, including being
      // left alone.
      hygieneWatch: 25,
      requiresAttire: false,
      fineScale: 1,
      // Moved on, out of the station and down the street. Nobody's problem.
      escortTo: { x: 19, y: 14 },
    },
    {
      id: "blocks",
      name: "The Blocks",
      sign: "ST GILES ROW — residents' parking only. Rooms let by the week, no exceptions.",
      from: 11,
      hygieneWatch: 20,
      requiresAttire: false,
      fineScale: 1,
      // Walked back to the station, which is where they assume you came from.
      escortTo: { x: 19, y: 3 },
    },
  ],
});
