/**
 * What happens to you in Brokedale.
 *
 * Its own pool, not a share of Brokemon's. A town's encounters are a large part
 * of what the town *is*, and these are written against the one thing that is
 * true of everywhere in this city: nothing here is free, including being left
 * alone. Nobody offers you a bed out of kindness. The generosity that does turn
 * up comes from people with no more than you have.
 *
 * Weighted by district. The Terminal Quarter takes you as you are and charges
 * you for it; The Blocks is where people live and therefore where people
 * notice you; the High Street has standards; Riverside has money and would
 * rather you were somewhere else.
 */

import { addItem, countOf, removeItem } from "./items";
import { applyDelta } from "./meters";
import { menu, type Choice } from "./prompt";
import { changeReputation, currentAppearance, earnCash, pushLog, reputationIn, type GameState } from "./state";
import { hourOf } from "./time";
import type { ZoneId } from "../world/map";
import type { EventDef } from "./events";

const close: Choice = { label: "Move on" };

/** Weight helper: `only("terminal", 4)` — nothing anywhere else. */
function only(zone: ZoneId, weight: number): (s: GameState, z: ZoneId) => number {
  return (_s, z) => (z === zone ? weight : 0);
}

export const BROKEDALE_EVENTS: EventDef[] = [
  /* ------------------------------------------------- Terminal Quarter */

  {
    id: "bd_tout",
    weight: only("terminal", 4),
    build: (ctx) => {
      const s = ctx.state;
      const price = 20;
      return menu(
        "A man by the barriers",
        [
          "He falls into step with you before you are past the barriers, which means he was waiting.",
          `"You want a bed? Twenty. Clean sheets, ten minutes' walk. You won't do better off the coach."`,
        ],
        [
          s.cash >= price
            ? {
                label: "Pay him",
                hint: `$${price}`,
                run: () => {
                  s.cash -= price;
                  ctx.advance(25);
                  // Two in three it is a real room, and dearer than the doss
                  // house for the privilege of not having to find it.
                  if (ctx.rng.chance(0.66)) {
                    applyDelta(s.meters, { energy: +14, morale: +6 });
                    pushLog(s, `Paid a tout $${price} for a bed.`, "money");
                    return menu(
                      "A man by the barriers",
                      ["It is a real room, above a shop, and the sheets are clean.", "He takes his cut at the door and does not introduce you."],
                      [close],
                    );
                  }
                  applyDelta(s.meters, { morale: -14 });
                  pushLog(s, `The tout took $${price} and walked.`, "bad");
                  return menu(
                    "A man by the barriers",
                    [
                      "He walks you four streets and points at a door that is not a hostel.",
                      "When you turn round he is already back at the barriers, talking to somebody else.",
                    ],
                    [close],
                    "bad",
                  );
                },
              }
            : { label: "Pay him", hint: `$${price}`, locked: "You don't have it" },
          {
            label: "Keep walking",
            run: () => {
              applyDelta(s.meters, { morale: -1 });
              return menu(
                "A man by the barriers",
                ["He drops back without a word and starts again on the next person off the coach."],
                [close],
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "bd_lifted",
    weight: (s, z) => (z === "terminal" ? 3 : 0) * (countOf(s.inventory, "phone") > 0 ? 1 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The concourse, shoulder to shoulder",
        [
          "The 6:30 empties and for ninety seconds the concourse is solid people.",
          "A hand goes into your coat with the confidence of somebody doing their job.",
        ],
        [
          {
            label: "Grab the wrist",
            hint: "risky",
            run: () => {
              ctx.advance(10);
              if (ctx.rng.chance(0.6)) {
                applyDelta(s.meters, { morale: +8, energy: -6 });
                return menu(
                  "The concourse",
                  ["You have him by the wrist and he is about nineteen and does not fight.", "He is gone into the crowd the second you let go. You still have your phone."],
                  [close],
                );
              }
              applyDelta(s.meters, { health: -10, morale: -10 });
              removeItem(s.inventory, "phone", 1);
              pushLog(s, "Your phone went on the concourse.", "bad");
              return menu(
                "The concourse",
                ["He twists out of it and puts an elbow through your guard on the way past.", "By the time you are upright the crowd has closed and so has the gap where your phone was."],
                [close],
                "bad",
              );
            },
          },
          {
            label: "Let it go",
            run: () => {
              removeItem(s.inventory, "phone", 1);
              applyDelta(s.meters, { morale: -8 });
              pushLog(s, "Your phone went on the concourse.", "bad");
              return menu(
                "The concourse",
                ["You do nothing, and the weight leaves your pocket, and that is that.", "Nobody on the concourse saw anything at all."],
                [close],
                "bad",
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "bd_showers",
    weight: (s, z) => (z === "terminal" && s.meters.hygiene < 45 ? 3 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Somebody who has been here longer",
        [
          "He is sitting where the heating vent comes out, and he has the good spot, which tells you something.",
          `"You're new. Washhouse on St Giles does a token for five. Don't pay the doss house four for that shower, it's cold after ten."`,
        ],
        [
          {
            label: "Thank him",
            run: () => {
              applyDelta(s.meters, { morale: +6 });
              changeReputation(s, 2);
              pushLog(s, "Somebody told you where to wash.", "good");
              return menu(
                "Somebody who has been here longer",
                [
                  `"S'alright. Everyone gets told once."`,
                  "He goes back to watching the departure board, which has not changed.",
                ],
                [close],
                "good",
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "bd_lastCoach",
    weight: (s, z) => (z === "terminal" && hourOf(s.time) >= 22 ? 4 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The last coach in",
        [
          "It comes in at eleven and puts thirty people onto a concourse built for a hundred.",
          "For about four minutes there is more foot traffic here than anywhere in the city.",
        ],
        [
          {
            label: "Work the crowd",
            hint: "20 min",
            run: () => {
              ctx.advance(20, { exertion: 1.1 });
              // A crowd off a late coach is tired, and tired people either
              // give or look straight through you. Rarely anything between.
              const take = ctx.rng.chance(0.55) ? ctx.rng.int(6, 22) : 0;
              applyDelta(s.meters, { morale: take > 0 ? +3 : -6, energy: -4 });
              if (take > 0) {
                earnCash(s, take);
                pushLog(s, `Worked the late coach for $${take}.`, "money");
                return menu(
                  "The last coach in",
                  [`Four minutes and $${take}. Two of them apologise for not having change and mean it.`],
                  [close],
                  "money",
                );
              }
              return menu(
                "The last coach in",
                ["Thirty people go past you at speed, all of them looking at their phones or the exit."],
                [close],
              );
            },
          },
          close,
        ],
      );
    },
  },

  /* ------------------------------------------------------- The Blocks */

  {
    id: "bd_landing",
    weight: (s, z) => (z === "blocks" ? 3 : 0) * (reputationIn(s) >= 10 ? 1.6 : 1),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The woman on the landing",
        [
          "Third floor, propping her door open with a foot while the kettle goes.",
          `"You're the new one in the back. There's a knack to that window, come here."`,
        ],
        [
          {
            label: "Let her show you",
            hint: "15 min",
            run: () => {
              ctx.advance(15, { sheltered: true });
              applyDelta(s.meters, { morale: +12, thirst: +18 });
              changeReputation(s, 3);
              pushLog(s, "The woman on the landing showed you the knack to the window.", "good");
              return menu(
                "The woman on the landing",
                [
                  "It is a knack. You would never have found it.",
                  "She makes you a cup of tea you did not ask for and tells you which of the meters is a lie.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Say you're alright",
            run: () => {
              changeReputation(s, -1);
              return menu(
                "The woman on the landing",
                [`"Suit yourself." The door closes and the landing light goes off on its timer.`],
                [close],
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "bd_locks",
    weight: only("blocks", 2),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Somebody else's door",
        [
          "Two men and a drill on the second floor, and a bin bag of somebody's things on the walkway.",
          "One of them nods at you the way you nod at a colleague.",
        ],
        [
          {
            label: "Ask what happened",
            run: () => {
              ctx.advance(10);
              applyDelta(s.meters, { morale: -10 });
              return menu(
                "Somebody else's door",
                [
                  `"Four weeks. Landlord's within his rights."`,
                  "You go up one more flight and put your own key in your own lock and stand there for a second.",
                ],
                [close],
                "bad",
              );
            },
          },
          {
            label: "Go up past it",
            run: () => {
              applyDelta(s.meters, { morale: -4 });
              return menu("Somebody else's door", ["You do not look at the bin bag on the way past. It is right there."], [close]);
            },
          },
        ],
      );
    },
  },

  {
    id: "bd_twoAM",
    weight: (s, z) => (z === "blocks" && (hourOf(s.time) >= 23 || hourOf(s.time) < 4) ? 4 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const price = 2;
      return menu(
        "The night market at two",
        [
          "One stall still lit, and the woman running it wants to go home more than she wants your money.",
          `"Two dollars, whatever's left. I'm not carrying it back."`,
        ],
        [
          s.cash >= price
            ? {
                label: "Take whatever's left",
                hint: `$${price}`,
                run: () => {
                  s.cash -= price;
                  ctx.advance(12, { sheltered: true });
                  applyDelta(s.meters, { hunger: +34, morale: +8, thirst: -4 });
                  pushLog(s, "Ate the end of the night at the market — $2.", "money");
                  return menu(
                    "The night market at two",
                    ["It is a full tray of what did not sell, and it is still hot underneath.", "She is pulling the shutter down before you have finished."],
                    [close],
                    "good",
                  );
                },
              }
            : { label: "Take whatever's left", hint: `$${price}`, locked: "You don't have two dollars" },
          close,
        ],
      );
    },
  },

  {
    id: "bd_collector",
    weight: only("blocks", 2),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The man who collects",
        [
          "A softcase and a lanyard, working the walkway door by door.",
          `"You're in the back on the fourth. You're not behind. I like that. Remember I said it."`,
        ],
        [
          {
            label: "Say nothing",
            run: () => {
              applyDelta(s.meters, { morale: -3 });
              return menu(
                "The man who collects",
                ["He writes something anyway, and moves along, and knocks in a way you can hear two floors up."],
                [close],
              );
            },
          },
          {
            label: "Ask who owns the building",
            run: () => {
              s.flags.bd_askedWhoOwns = 1;
              return menu(
                "The man who collects",
                [
                  `"Mr Aldiss. Owns this one, the one behind, and the corner shop."`,
                  `"He's seventy-one and he's got no one. Ask him yourself, he's in the corner shop most mornings."`,
                ],
                [close],
              );
            },
          },
        ],
      );
    },
  },

  /* ---------------------------------------------------- The High Street */

  {
    id: "bd_inspector",
    weight: (s, z) => (z === "highStreet" && currentAppearance(s) < 45 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A clipboard and a lanyard",
        [
          "Not police. Something to do with the business improvement district, which is worse in one specific way:",
          "he does not have to give you a reason.",
        ],
        [
          {
            label: "Move along",
            run: () => {
              applyDelta(s.meters, { morale: -8 });
              return menu(
                "A clipboard and a lanyard",
                ["You move along. He watches you all the way to the crossing and writes nothing down."],
                [close],
                "bad",
              );
            },
          },
          {
            label: "Ask what you've done",
            hint: "risky",
            run: () => {
              if (ctx.rng.chance(0.5)) {
                applyDelta(s.meters, { morale: +4 });
                return menu(
                  "A clipboard and a lanyard",
                  [`"Nothing. It's a Tuesday thing." He is almost apologetic about it.`],
                  [close],
                );
              }
              const fine = 20;
              if (s.cash >= fine) s.cash -= fine;
              else s.debt += fine;
              s.fines += fine;
              changeReputation(s, -2);
              applyDelta(s.meters, { morale: -12 });
              pushLog(s, `Fixed penalty on the High Street — $${fine}.`, "bad");
              return menu(
                "A clipboard and a lanyard",
                [`He calls someone who does have to give you a reason. The reason costs $${fine}.`],
                [close],
                "bad",
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "bd_delivery",
    weight: (s, z) => (z === "highStreet" && hourOf(s.time) >= 7 && hourOf(s.time) < 19 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A van on the double yellows",
        [
          "The driver is one man against forty boxes and a warden two streets away.",
          `"Ten minutes. Twenty quid. You look like you can lift."`,
        ],
        [
          {
            label: "Lift",
            hint: "15 min, $20",
            run: () => {
              ctx.advance(15, { exertion: 2.4 });
              applyDelta(s.meters, { energy: -12, hygiene: -6, hunger: -6, thirst: -8 });
              const pay = 20;
              earnCash(s, pay);
              changeReputation(s, 1);
              pushLog(s, `Helped unload a van — $${pay}.`, "money");
              return menu(
                "A van on the double yellows",
                ["Forty boxes in eleven minutes and he is gone before the warden turns the corner.", `Twenty in your hand, and he says "same time Thursday" without waiting for an answer.`],
                [close],
                "money",
              );
            },
          },
          close,
        ],
      );
    },
  },

  {
    id: "bd_window",
    weight: only("highStreet", 2),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Your reflection in a shop window",
        [
          "Not on purpose. It is a wide window and you are walking past it and there you are.",
        ],
        [
          {
            label: "Look properly",
            run: () => {
              const look = currentAppearance(s);
              applyDelta(s.meters, { morale: look >= 55 ? +8 : -8 });
              return menu(
                "Your reflection in a shop window",
                look >= 55
                  ? ["You look like somebody on their way somewhere.", "It is a small thing and you carry it for about an hour."]
                  : ["You look like what the last few weeks have been.", "You start walking before you have finished looking."],
                [close],
                look >= 55 ? "good" : "bad",
              );
            },
          },
          close,
        ],
      );
    },
  },

  /* -------------------------------------------------------- Riverside */

  {
    id: "bd_valet",
    weight: (s, z) => (z === "riverside" && currentAppearance(s) < 60 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Too near a car",
        [
          "You are on a public pavement and the car is on a private forecourt and the man in the waistcoat",
          "has decided the difference is your problem.",
        ],
        [
          {
            label: "Cross the road",
            run: () => {
              ctx.advance(6);
              applyDelta(s.meters, { morale: -6 });
              return menu("Too near a car", ["You cross. He watches. The car is not even that nice."], [close]);
            },
          },
          {
            label: "Stand where you are",
            hint: "risky",
            run: () => {
              ctx.advance(10);
              if (ctx.rng.chance(0.55)) {
                applyDelta(s.meters, { morale: +10 });
                return menu(
                  "Too near a car",
                  ["He waits. You wait. Somebody comes out for the car and he has to go and be pleasant to them instead."],
                  [close],
                );
              }
              changeReputation(s, -3);
              applyDelta(s.meters, { morale: -14 });
              pushLog(s, "Moved on from Riverside.", "bad");
              return menu(
                "Too near a car",
                ["He makes a call, and two minutes later somebody with a radio explains the difference to you at length."],
                [close],
                "bad",
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "bd_charity",
    weight: (s, z) => (z === "riverside" && currentAppearance(s) >= 55 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const ask = 15;
      return menu(
        "Someone with a card reader",
        [
          "She steps into your path with the confidence of somebody who has read you as a donor.",
          `"Fifteen a month keeps a bed open at the night shelter. You'd be amazed how many people need one."`,
        ],
        [
          s.cash >= ask
            ? {
                label: "Give her fifteen",
                hint: `$${ask}`,
                run: () => {
                  s.cash -= ask;
                  ctx.advance(8);
                  applyDelta(s.meters, { morale: +14 });
                  changeReputation(s, 2);
                  pushLog(s, `Gave $${ask} to a night shelter.`, "money");
                  return menu(
                    "Someone with a card reader",
                    [
                      "You do not tell her why you know how many people need one.",
                      "She thanks you by your first name off the card and you walk on feeling strange about it.",
                    ],
                    [close],
                    "good",
                  );
                },
              }
            : { label: "Give her fifteen", hint: `$${ask}`, locked: "You can't afford it" },
          {
            label: "Tell her you've used one",
            run: () => {
              applyDelta(s.meters, { morale: +2 });
              return menu(
                "Someone with a card reader",
                ["She is decent about it, which somehow makes it worse.", "She asks if the one on Route 1 is still open. You say it is."],
                [close],
              );
            },
          },
          close,
        ],
      );
    },
  },

  {
    id: "bd_river",
    weight: (s, z) => (z === "riverside" && (hourOf(s.time) >= 19 || hourOf(s.time) < 6) ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The river at night",
        [
          "The frontage lights go all the way along and the water takes all of them and moves them about.",
          "It is genuinely beautiful and it is free, which in this city is nearly against the rules.",
        ],
        [
          {
            label: "Stay a while",
            hint: "20 min",
            run: () => {
              ctx.advance(20);
              applyDelta(s.meters, { morale: +16, energy: +4 });
              pushLog(s, "Stood at the river for twenty minutes.", "good");
              return menu(
                "The river at night",
                ["Twenty minutes. Nobody asks you to move and nothing costs anything.", "You go back up the hill lighter than you came down it."],
                [close],
                "good",
              );
            },
          },
          close,
        ],
      );
    },
  },

  /* ------------------------------------------------------- everywhere */

  {
    id: "bd_cans",
    weight: (_s, z) => (z === "terminal" || z === "blocks" ? 2 : 0.5),
    build: (ctx) => {
      const s = ctx.state;
      const n = ctx.rng.int(2, 5);
      return menu(
        "A crate by a back door",
        [`Somebody has stacked the empties neatly, which in this city means they are somebody's.`],
        [
          {
            label: "Take them anyway",
            run: () => {
              ctx.advance(6, { exertion: 1.2 });
              addItem(s.inventory, "recyclables", n);
              return menu(
                "A crate by a back door",
                [`${n} containers, and nobody comes out.`, "The scrap yard on the back lot pays a dollar each and asks nothing."],
                [close],
              );
            },
          },
          close,
        ],
      );
    },
  },
];
