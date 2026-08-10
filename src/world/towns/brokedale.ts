/**
 * Brokedale — the city, forty minutes up the road.
 *
 * Four districts, top to bottom, and the order is the argument: the coach puts
 * you down in the one part of town that takes you as you are, and everything
 * below it costs more the further you walk.
 *
 * What stays true as it grows: Brokemon Town has a floor and no ceiling;
 * Brokedale has a ceiling and no floor. There is no food bank here, no free
 * wash, and no bench you can legally sleep on. The station concourse is open
 * all night because the coaches are, not out of kindness.
 *
 * The measured crossing is why the city is shaped this way. A day trip costs
 * 250 minutes and $26 (`npm run playtest -- --crossing`), so nothing here can
 * be priced for a commuter — there are no commuters. Brokedale is somewhere
 * you move to, and the rooms on St Giles Row are the decision the whole place
 * is built around.
 */

import { buildTown, type Town } from "../town";

// prettier-ignore
const ROWS = [
  /* 00 */ "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
  /* 01 */ "W^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^W",
  /* 02 */ "W########Y#########C###################W",
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
  /* 15 */ "W____________b____n_______L____________W",
  /* 16 */ "W_____%__________________________%_____W",
  /* 17 */ "W______________________________________W",
  /* 18 */ "W___^^^^^^^^^^^^________^^^^^^^^^^^^___W",
  /* 19 */ "W___#####R######________#####U######___W",
  /* 20 */ "W________________~~____________________W",
  /* 21 */ "Wrrrrrrrrrrrrrrrrr^^^^^rrrrrrrrrrrrrrrrW",
  /* 22 */ "Wrrrrrrrrrrrrrr%rrr##9##rrxrrrrrrrrrrrrW",
  /* 23 */ "WrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrW",
  /* 24 */ "W______________________________________W",
  /* 25 */ "W==================cc==================W",
  /* 26 */ "W==================cc==================W",
  /* 27 */ "W______________________________________W",
  /* 28 */ "W_^^^^^^^^^^^___^^^^^^^^^^___^^^^^^^^^_W",
  /* 29 */ "W_#####P#####___####J#####___####V####_W",
  /* 30 */ "W_________________~~___________________W",
  /* 31 */ "W_______________n______________________W",
  /* 32 */ "W______________________________________W",
  /* 33 */ "W____________________^^^^^^^^^^^^^^____W",
  /* 34 */ "W____________________######Z#######____W",
  /* 35 */ "W______________________________________W",
  /* 36 */ "W________b__________n_________b________W",
  /* 37 */ "W______________________________________W",
  /* 38 */ "W~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~W",
  /* 39 */ "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
];

export const BROKEDALE: Town = buildTown({
  id: "brokedale",
  name: "Brokedale",
  rows: ROWS,
  // `recycling` and `panhandleSpot` are Brokemon's glyphs reused: the venues
  // behind them are generic, and a scrap yard is a scrap yard. They are also
  // the only two ways a penniless arrival can make money here, which is
  // deliberate — the walking rig showed that without the yard, riding out with
  // the fare and nothing else was not a bad night, it was a soft lock.
  requires: [
    "coachTerminal",
    "agency",
    "panhandleSpot",
    "nightMarket",
    "dossHouse",
    "weeklyRooms",
    "washhouse",
    "recycling",
    "pawnShop",
    "jobCentre",
    "depot",
    "gym",
  ],
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
      to: 23,
      hygieneWatch: 20,
      requiresAttire: false,
      fineScale: 1,
      // Walked back to the station, which is where they assume you came from.
      escortTo: { x: 19, y: 3 },
    },
    {
      id: "highStreet",
      name: "The High Street",
      sign: "BROKEDALE HIGH STREET — trading hours 8AM to 8PM. No street collections.",
      from: 24,
      to: 31,
      // Where the work is, and where the standards start.
      hygieneWatch: 40,
      requiresAttire: false,
      fineScale: 2,
      // Off the high street entirely, onto the gravel behind St Giles. Escorting
      // somebody to row 24 was escorting them to the top of the street they had
      // just been moved off, where the same officer checks them again.
      escortTo: { x: 12, y: 22 },
    },
    {
      id: "riverside",
      name: "Riverside",
      sign: "RIVERSIDE — private frontage. Patrons and residents only beyond this point.",
      from: 32,
      // Brokedale's Heights, except there is no gate: the prices do the work,
      // and the police do the rest.
      hygieneWatch: 55,
      requiresAttire: true,
      fineScale: 3,
      // Back up to the high street. This used to be row 32 — the first row of
      // Riverside itself, which is not being moved on, it is being told to
      // stand up.
      escortTo: { x: 10, y: 30 },
    },
  ],
});
