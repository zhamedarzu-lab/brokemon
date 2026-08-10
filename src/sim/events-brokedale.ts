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
import { changeReputation, currentAppearance, earnCash, housingIn, pushLog, reputationIn, type GameState } from "./state";
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
            label: "Ask him where people sleep for nothing",
            run: () => {
              changeReputation(s, -1);
              applyDelta(s.meters, { morale: -3 });
              s.flags.bd_askedTheTout = 1;
              return menu(
                "A man by the barriers",
                [
                  "The friendliness goes out of him like a light going off.",
                  `"Concourse. They don't move you till six." He is already looking past you at the next one off the coach.`,
                  "It is worth knowing and it cost you nothing but the way he said it.",
                ],
                [close],
              );
            },
          },
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
            label: "Ask him what else is worth knowing",
            hint: "20 min",
            run: () => {
              ctx.advance(20, { sheltered: true });
              applyDelta(s.meters, { morale: +8, energy: -2 });
              changeReputation(s, 3);
              s.flags.bd_learnedTheCity = 1;
              pushLog(s, "Sat with somebody who knows Brokedale.", "good");
              return menu(
                "Somebody who has been here longer",
                [
                  `"Depot takes anyone Tuesdays. Don't sit on the high street after eight, they've got a thing about it."`,
                  `"And the yard behind St Giles pays cash for cans. That's the one nobody tells you."`,
                  "Twenty minutes and you know more about this city than the coach timetable told you.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Ask what he wants for it",
            run: () => {
              applyDelta(s.meters, { morale: -4 });
              changeReputation(s, -2);
              return menu(
                "Somebody who has been here longer",
                [
                  "He looks at you for a second longer than is comfortable.",
                  `"Nothing. I wanted nothing." He turns back to the board and that is the end of it.`,
                ],
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
          {
            label: "Offer to break the stall down for it",
            hint: "30 min",
            run: () => {
              ctx.advance(30, { exertion: 1.3 });
              applyDelta(s.meters, { energy: -8, hunger: +30, morale: +6 });
              changeReputation(s, 2);
              s.flags.bd_brokeDownTheStall = (s.flags.bd_brokeDownTheStall ?? 0) + 1;
              pushLog(s, "Broke down a night market stall for the last of the tray.", "good");
              return menu(
                "The night market at two",
                [
                  "Trestles, crates, the awning poles, and the tray goes in your hands at the end of it.",
                  s.flags.bd_brokeDownTheStall >= 2
                    ? "She has stopped asking. She just leaves the tray on the crate and starts on the poles."
                    : `"You've done this," she says, which you have not.`,
                ],
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

  /* ------------------------------- Terminal Quarter, second helping */

  {
    id: "bd_ticketMachine",
    weight: only("terminal", 3),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The ticket machine",
        [
          "A woman with a card that has been declined twice and a coach in eleven minutes, reading the screen like it might change.",
          `"It's fourteen. I've got nine and a bit in change. I've counted it about six times."`,
        ],
        [
          s.cash >= 5
            ? {
                label: "Make up the difference",
                hint: "$5",
                run: () => {
                  s.cash -= 5;
                  changeReputation(s, 3);
                  applyDelta(s.meters, { morale: +8 });
                  pushLog(s, "Made up a stranger's coach fare.", "good");
                  return menu(
                    "The ticket machine",
                    ["She gets on it. She looks back once from the step and you have already turned away, which you regret for about an hour."],
                    [close],
                    "good",
                  );
                },
              }
            : { label: "Make up the difference", hint: "$5", locked: "You have not got five dollars" },
          {
            label: "Show her the half-fare button",
            hint: "5 min",
            run: () => {
              ctx.advance(5, { sheltered: true });
              changeReputation(s, 2);
              applyDelta(s.meters, { morale: +5 });
              return menu(
                "The ticket machine",
                [
                  "It is two menus deep and it is not signposted anywhere on the machine.",
                  `"Nine forty," she says, to the screen rather than to you. "Nine forty."`,
                ],
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

  {
    id: "bd_leftLuggage",
    weight: (s, z) => (z === "terminal" && countOf(s.inventory, "sleepingBag") + countOf(s.inventory, "recyclables") > 0 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const fee = 3;
      return menu(
        "Left luggage",
        [
          "A hatch, a laminated price list, and a man who has already decided what you are.",
          `"Three dollars a day. And it's a locker, not a bed, before you ask."`,
        ],
        [
          s.cash >= fee
            ? {
                label: "Take a locker for the day",
                hint: `$${fee}`,
                run: () => {
                  s.cash -= fee;
                  s.flags.bd_lockerUntil = s.time + 24 * 60;
                  applyDelta(s.meters, { morale: +6, energy: +3 });
                  pushLog(s, "Put your bag in a locker for the day.", "money");
                  return menu(
                    "Left luggage",
                    [
                      "Three dollars, and for the rest of the day you are a man walking about rather than a man carrying everything he owns.",
                      "It is a surprisingly large difference and you resent how large it is.",
                    ],
                    [close],
                  );
                },
              }
            : { label: "Take a locker for the day", hint: `$${fee}`, locked: "Three dollars you have not got" },
          {
            label: "Carry it",
            run: () => {
              applyDelta(s.meters, { energy: -3 });
              return menu("Left luggage", ["You carry it. You have carried it this far."], [close]);
            },
          },
        ],
      );
    },
  },

  {
    id: "bd_platformSleeper",
    weight: (s, z) => (z === "terminal" && (hourOf(s.time) >= 23 || hourOf(s.time) < 5) ? 4 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Stand four, half past three",
        [
          "Somebody is asleep across three seats with a coat over their head, and the cleaner is working up the row with a mop and a decision to make.",
          "He looks at you. You are the only other person awake in the building.",
        ],
        [
          {
            label: "Wake them before he gets there",
            hint: "5 min",
            run: () => {
              ctx.advance(5, { sheltered: true });
              changeReputation(s, 3);
              applyDelta(s.meters, { morale: +6 });
              s.flags.bd_wokeTheSleeper = 1;
              return menu(
                "Stand four, half past three",
                [
                  "They are upright and holding a cup of nothing by the time he arrives, which is all the rule actually requires.",
                  "The cleaner mops round them without a word. Everybody here knows exactly where the line is.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Let it happen",
            run: () => {
              applyDelta(s.meters, { morale: -5 });
              return menu(
                "Stand four, half past three",
                ["He does it by the book and he is not unkind about it, and they are outside in the cold by twenty to four.", "You keep your seat."],
                [close],
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "bd_arrivalsBoard",
    weight: (s, z) => (z === "terminal" && reputationIn(s, "brokedale") < 20 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Under the arrivals board",
        [
          "Two lads off the same coach as you, nineteen at most, working out from a phone whether the agency opens at six or seven.",
          "They are about to walk to St Giles, which is the wrong direction, and they have not asked anybody.",
        ],
        [
          {
            label: "Point them the right way",
            hint: "10 min",
            run: () => {
              ctx.advance(10);
              changeReputation(s, 3);
              applyDelta(s.meters, { morale: +6 });
              return menu(
                "Under the arrivals board",
                [
                  "Six, and it is the other way, and the queue starts before it opens.",
                  "One of them writes it on his hand. You did that too, the first week.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Let them find out",
            run: () => {
              applyDelta(s.meters, { morale: -3 });
              return menu(
                "Under the arrivals board",
                ["They will be back here by eight, having walked two miles and missed the muster.", "Somebody let you find out, once."],
                [close],
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "bd_forecourtPitch",
    weight: only("terminal", 3),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "On the forecourt",
        [
          "A busker with an amp the size of a lunchbox, playing to a rank of coaches and about four people.",
          "NO TRADING ON THE FORECOURT, says the sign directly above his head, and there is a man in a hi-vis coming out of the office.",
        ],
        [
          {
            label: "Tell him he's about to be moved",
            run: () => {
              changeReputation(s, 2);
              applyDelta(s.meters, { morale: +5 });
              return menu(
                "On the forecourt",
                [
                  "He is packed and thirty feet down the pavement before the hi-vis is through the door, which suggests practice.",
                  `"Cheers. He's alright, that one, he just has to." He sets up again outside the line and nobody minds.`,
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Stand and listen a while",
            hint: "15 min",
            run: () => {
              ctx.advance(15);
              applyDelta(s.meters, { morale: +7, energy: -1 });
              return menu(
                "On the forecourt",
                [
                  "Fifteen minutes, and having one person actually stop changes what he is doing to the point where two more do.",
                  "The hi-vis comes out, sees a crowd of four, and goes back in. That is apparently the threshold.",
                ],
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

  /* -------------------------------------------- The Blocks, filling out */

  {
    id: "bd_meter",
    weight: (s, z) => (z === "blocks" && housingIn(s, "brokedale") === "room" ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const top = 6;
      return menu(
        "The meter cupboard",
        [
          "The key meter on the landing has gone, and the woman in the next room is standing in front of it in a coat, indoors.",
          `"It eats it. Aldiss says it's the meter, the meter says it's Aldiss."`,
        ],
        [
          s.cash >= top
            ? {
                label: "Put six on it",
                hint: `$${top}`,
                run: () => {
                  s.cash -= top;
                  changeReputation(s, 4);
                  applyDelta(s.meters, { morale: +8 });
                  s.flags.bd_toppedTheMeter = (s.flags.bd_toppedTheMeter ?? 0) + 1;
                  pushLog(s, "Put six dollars on the landing meter.", "good");
                  return menu(
                    "The meter cupboard",
                    [
                      "The hall light comes on and so does her radiator, and yours, because it is one meter for the whole side.",
                      "She does not offer to split it and you do not ask. It is understood that it goes round.",
                    ],
                    [close],
                    "good",
                  );
                },
              }
            : { label: "Put six on it", hint: `$${top}`, locked: "You are as short as she is" },
          {
            label: "Go up to your room",
            run: () => {
              applyDelta(s.meters, { morale: -4 });
              return menu("The meter cupboard", ["Your room is the same temperature as the landing, which is the answer to the question you did not ask."], [close]);
            },
          },
        ],
      );
    },
  },

  {
    id: "bd_washingLine",
    weight: only("blocks", 2),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The drying green",
        [
          "It has come on to rain and there is a full line out, and whoever hung it is at work until six.",
          "Four shirts, a set of sheets, and a child's coat.",
        ],
        [
          {
            label: "Get it in",
            hint: "15 min",
            run: () => {
              ctx.advance(15, { exertion: 1.1 });
              changeReputation(s, 4);
              applyDelta(s.meters, { morale: +8, energy: -3, hygiene: -2 });
              s.flags.bd_gotTheWashingIn = 1;
              pushLog(s, "Got somebody's washing in before the rain.", "good");
              return menu(
                "The drying green",
                [
                  "It goes over the bannister on the second landing, which is where everybody puts it, and it is dry by seven.",
                  "Nobody finds out it was you for about a fortnight, and then everybody does.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "It's not yours",
            run: () =>
              menu("The drying green", ["It is not yours. It rains for two hours and it is still out there at six."], [close]),
          },
        ],
      );
    },
  },

  {
    id: "bd_stairwellKids",
    weight: (s, z) => (z === "blocks" && hourOf(s.time) >= 15 && hourOf(s.time) < 21 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The stairwell",
        [
          "Three of them on the half-landing with a speaker, and the whole stair is theirs from four until it gets dark.",
          "The woman on the second has been past twice and said nothing both times.",
        ],
        [
          {
            label: "Ask them to move it down a floor",
            run: () => {
              applyDelta(s.meters, { morale: +2 });
              changeReputation(s, 1);
              return menu(
                "The stairwell",
                [
                  "They move. There is a certain amount of theatre about it but they move.",
                  "It goes on downstairs at the same volume and that is somebody else's landing now, which is not a solution so much as a relocation.",
                ],
                [close],
              );
            },
          },
          {
            label: "Squeeze past",
            run: () => {
              applyDelta(s.meters, { morale: -3 });
              return menu("The stairwell", ["You go up the side of them. Nobody says anything and the speaker does not go down."], [close]);
            },
          },
          {
            label: "Sit down on the step",
            hint: "20 min",
            run: () => {
              ctx.advance(20);
              changeReputation(s, 2);
              applyDelta(s.meters, { morale: +7, energy: -2 });
              s.flags.bd_satWithTheKids = 1;
              return menu(
                "The stairwell",
                [
                  "Twenty minutes of an argument about a footballer you have never heard of, in which you are asked to adjudicate.",
                  "The speaker goes off at nine every night after that, which nobody asked them to do.",
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

  /* ---------------------------------------- The High Street, filling out */

  {
    id: "bd_shutters",
    weight: (s, z) => (z === "highStreet" && (hourOf(s.time) >= 20 || hourOf(s.time) < 7) ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A shutter half down",
        [
          "The bakery's shutter is a foot off the ground and the lights are off, which means it has been like that since closing.",
          "Anybody could get a hand under it. You are the one standing here.",
        ],
        [
          {
            label: "Wait until somebody comes",
            hint: "40 min",
            run: () => {
              ctx.advance(40);
              changeReputation(s, 5);
              applyDelta(s.meters, { morale: +6, energy: -5 });
              s.flags.bd_mindedTheShutter = 1;
              pushLog(s, "Stood by an open shutter until the owner came back.", "good");
              return menu(
                "A shutter half down",
                [
                  "Forty minutes, and it is the owner's son at twenty past, and he is white about it.",
                  "They know your face on this street after that, which turns out to matter more than the forty minutes cost.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Pull it down for them",
            hint: "5 min",
            run: () => {
              ctx.advance(5, { exertion: 1.1 });
              applyDelta(s.meters, { morale: +3 });
              changeReputation(s, 1);
              return menu(
                "A shutter half down",
                ["It comes down and locks itself, and nobody will ever know it was open.", "That is the whole of it, and it is fine."],
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
    id: "bd_bigIssue",
    weight: only("highStreet", 3),
    build: (ctx) => {
      const s = ctx.state;
      const price = 4;
      return menu(
        "Outside the chemist",
        [
          "A vendor with a pitch, a badge and a stack, and he is working — greeting, not asking.",
          `"Four dollars. Half of it's mine and I paid for these up front, which is the bit nobody believes."`,
        ],
        [
          s.cash >= price
            ? {
                label: "Buy one",
                hint: `$${price}`,
                run: () => {
                  s.cash -= price;
                  changeReputation(s, 3);
                  applyDelta(s.meters, { morale: +7 });
                  pushLog(s, "Bought a magazine off a street vendor.", "money");
                  return menu(
                    "Outside the chemist",
                    [
                      "He gives you the top one and the change out of his own pocket without being asked.",
                      "You read about six pages of it and leave it on a bench for whoever is next.",
                    ],
                    [close],
                    "good",
                  );
                },
              }
            : { label: "Buy one", hint: `$${price}`, locked: `You are short of $${price}` },
          {
            label: "Ask him how the pitch works",
            hint: "15 min",
            run: () => {
              ctx.advance(15);
              changeReputation(s, 2);
              s.flags.bd_learnedThePitch = 1;
              applyDelta(s.meters, { morale: +4 });
              return menu(
                "Outside the chemist",
                [
                  "A badge, a pitch you are assigned, and you buy the stock. It is a job with a barrier to entry, which is the part that surprises you.",
                  `"You want one, you go to the office Tuesday. Don't come Monday, everyone comes Monday."`,
                ],
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

  {
    id: "bd_marketDay",
    weight: (s, z) => (z === "highStreet" && hourOf(s.time) >= 8 && hourOf(s.time) < 15 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Packing up early",
        [
          "A fruit stall going in at one o'clock because it has not been worth standing there since eleven.",
          `"You want this? It's going in the bin, it won't see tomorrow." He is holding out a box of something soft.`,
        ],
        [
          {
            label: "Take the box",
            hint: "dignity",
            run: () => {
              addItem(s.inventory, "trashFood", 2);
              applyDelta(s.meters, { morale: -4 });
              return menu(
                "Packing up early",
                [
                  "Two days of eating, if you are not fussy, and you are not.",
                  "He hands it over like it is nothing, which it is to him, and that is the part that stings.",
                ],
                [close],
              );
            },
          },
          {
            label: "Give him a hand instead",
            hint: "30 min",
            run: () => {
              ctx.advance(30, { exertion: 1.3 });
              applyDelta(s.meters, { energy: -8, morale: +6 });
              addItem(s.inventory, "sandwich");
              earnCash(s, 6);
              changeReputation(s, 3);
              pushLog(s, "Helped a market trader pack up — $6 and something to eat.", "money");
              return menu(
                "Packing up early",
                [
                  "Half an hour of trestles and crates and six dollars out of the float, and he puts something decent in a bag on top of it.",
                  `"Tuesdays and Fridays. I'm always short Tuesdays."`,
                ],
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

  {
    id: "bd_chuggers",
    weight: (s, z) => (z === "highStreet" && currentAppearance(s) >= 40 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A tabard and a clipboard",
        [
          "He has picked you out of the whole pavement and he is walking backwards in front of you, which is a skill.",
          `"Eight dollars a month. That's two coffees. Do you drink coffee?"`,
        ],
        [
          {
            label: "Tell him the truth about your month",
            run: () => {
              applyDelta(s.meters, { morale: -2 });
              changeReputation(s, 1);
              return menu(
                "A tabard and a clipboard",
                [
                  "He stops walking backwards. He is about twenty-two and on commission and he has clearly not had this answer before.",
                  `"Right. Sorry, mate. Genuinely." He lets you past and does not pick the next one for a while.`,
                ],
                [close],
              );
            },
          },
          {
            label: "Say you'll think about it",
            run: () =>
              menu("A tabard and a clipboard", ["He knows what that means and he says have a good day anyway, and means about half of it."], [close]),
          },
          {
            label: "Ask if they're hiring tabards",
            hint: "10 min",
            run: () => {
              ctx.advance(10);
              s.flags.bd_askedAboutTabards = 1;
              applyDelta(s.meters, { morale: +3 });
              return menu(
                "A tabard and a clipboard",
                [
                  `"Agency. Everyone here's agency." He gives you a name and a street and says to mention him, which he does not have to do.`,
                  "It is the first time in this city that somebody in a uniform has treated you as somebody who might have one.",
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

  /* --------------------------------------------- Riverside, which was bare */

  {
    id: "bd_towpath",
    weight: only("riverside", 3),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The towpath",
        [
          "A woman running, and she has clocked you from forty feet and crossed to the far side of the path without appearing to decide to.",
          "There is nobody else on it in either direction.",
        ],
        [
          {
            label: "Stand aside and look at the water",
            run: () => {
              applyDelta(s.meters, { morale: -4 });
              return menu(
                "The towpath",
                [
                  "You give her the whole path and you look at the canal until she is past, because that is the arrangement.",
                  "She says thanks. You have done nothing to be thanked for and you both know what the thanks is about.",
                ],
                [close],
              );
            },
          },
          {
            label: "Carry on as you were",
            run: () => {
              applyDelta(s.meters, { morale: -2 });
              changeReputation(s, -1);
              return menu(
                "The towpath",
                ["She goes past at a distance and at a speed, and looks back twice before the bend.", "You have not done anything. It does not appear to matter."],
                [close],
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "bd_terrace",
    weight: (s, z) => (z === "riverside" && hourOf(s.time) >= 12 && hourOf(s.time) < 23 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The terrace tables",
        [
          "Forty covers on the river side, all of them full, and a rope across the pavement so the path goes round.",
          "A table of six has left most of two bottles and a bread basket, and it is nine feet away on the other side of a rope.",
        ],
        [
          {
            label: "Ask the waiter for the bread",
            hint: "risky",
            run: () => {
              ctx.advance(8);
              if (ctx.rng.chance(0.45)) {
                addItem(s.inventory, "sandwich");
                changeReputation(s, 1);
                applyDelta(s.meters, { morale: +6 });
                return menu(
                  "The terrace tables",
                  [
                    "He looks at the table, and at the kitchen door, and hands the whole basket over the rope in a napkin.",
                    `"Go round the corner with it." Which you do.`,
                  ],
                  [close],
                  "good",
                );
              }
              applyDelta(s.meters, { morale: -8 });
              changeReputation(s, -3);
              return menu(
                "The terrace tables",
                [
                  "He does not answer you. He goes inside and says something, and a second man comes out and stands with his arms folded until you leave.",
                  "Six people at the near table have watched all of it over their shoulders.",
                ],
                [close],
                "bad",
              );
            },
          },
          {
            label: "Go round the rope",
            run: () => {
              applyDelta(s.meters, { morale: -3 });
              return menu("The terrace tables", ["You take the long way, on the road side of the rope, which is what the rope is for."], [close]);
            },
          },
        ],
      );
    },
  },

  {
    id: "bd_boatyard",
    weight: only("riverside", 3),
    build: (ctx) => {
      const s = ctx.state;
      const pay = 22;
      return menu(
        "The boatyard gate",
        [
          "A man scraping the bottom of a hull on a cradle, on his own, with about four hours of it left and the tide against him.",
          `"You done any? Doesn't matter. It's a scraper and an arm."`,
        ],
        [
          {
            label: "Take the scraper",
            hint: `2 hrs, $${pay}`,
            run: () => {
              ctx.advance(120, { exertion: 1.4 });
              applyDelta(s.meters, { energy: -16, hygiene: -12, hunger: -10, morale: +4 });
              earnCash(s, pay);
              changeReputation(s, 3);
              s.flags.bd_workedTheBoatyard = (s.flags.bd_workedTheBoatyard ?? 0) + 1;
              pushLog(s, `Two hours scraping a hull for $${pay}.`, "money");
              return menu(
                "The boatyard gate",
                [
                  `Two hours, both arms, $${pay} out of a tin, and a forearm you will feel tomorrow.`,
                  s.flags.bd_workedTheBoatyard >= 2
                    ? "He has stopped asking whether you have done any."
                    : `"There's a hull a week down here if you want them."`,
                ],
                [close],
                "money",
              );
            },
          },
          {
            label: "You haven't got two hours",
            run: () =>
              menu("The boatyard gate", ["He shrugs and goes back to it, and he is still at it when you come past the other way."], [close]),
          },
        ],
      );
    },
  },

  {
    id: "bd_residents",
    weight: (s, z) => (z === "riverside" && currentAppearance(s) < 55 ? 4 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A residents' committee of one",
        [
          "A man in a gilet has come out of a gate to ask whether you are looking for a particular address.",
          "He is being very polite about it and he is not going back in until you have gone.",
        ],
        [
          {
            label: "Give him a house number",
            hint: "risky",
            run: () => {
              if (ctx.rng.chance(0.5)) {
                applyDelta(s.meters, { morale: +4 });
                return menu(
                  "A residents' committee of one",
                  ["You say a number. He points you at it and goes in, and you walk to a door you have no business at and then past it."],
                  [close],
                );
              }
              applyDelta(s.meters, { morale: -8 });
              changeReputation(s, -3);
              return menu(
                "A residents' committee of one",
                [
                  `"That's mine," he says. He is not even angry, which is worse.`,
                  "He watches you the whole length of the street with a phone in his hand and does not use it.",
                ],
                [close],
                "bad",
              );
            },
          },
          {
            label: "Tell him you're walking",
            run: () => {
              applyDelta(s.meters, { morale: -5 });
              return menu(
                "A residents' committee of one",
                [`"Right. It's just that it's private frontage." It is not, and there is a public path sign nine feet behind his head.`],
                [close],
              );
            },
          },
          {
            label: "Point at the footpath sign",
            run: () => {
              changeReputation(s, -2);
              applyDelta(s.meters, { morale: +6 });
              s.flags.bd_stoodYourGround = 1;
              return menu(
                "A residents' committee of one",
                [
                  "He reads it as though he has never seen it, which after eleven years on this street he certainly has.",
                  "He goes in. You are checked by a patrol car twice in the next fortnight and you cannot prove those are related.",
                ],
                [close],
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "bd_lostDog",
    weight: only("riverside", 2),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A dog with a lead on",
        [
          "Trailing its own lead along the railings, well fed, collar with a disc on it, and about as lost as an animal can look.",
          "There is a number on the disc and forty feet of river with no fence between it and the water.",
        ],
        [
          {
            label: "Get hold of the lead and ring the number",
            hint: "25 min",
            run: () => {
              ctx.advance(25);
              changeReputation(s, 4);
              applyDelta(s.meters, { morale: +10, energy: -3 });
              s.flags.bd_foundTheDog = 1;
              pushLog(s, "Caught a loose dog on the riverside and rang its owner.", "good");
              return menu(
                "A dog with a lead on",
                [
                  "Twenty-five minutes on a wall with a dog leaning on your leg, and a woman who arrives at a run and cannot speak for a moment.",
                  "She offers you money and you do not take it, and you think about that for the rest of the week.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Walk it to the address on the disc",
            hint: "40 min",
            run: () => {
              ctx.advance(40, { exertion: 1.1 });
              changeReputation(s, 5);
              applyDelta(s.meters, { morale: +8, energy: -6 });
              earnCash(s, 10);
              s.flags.bd_foundTheDog = 1;
              pushLog(s, "Walked a lost dog home along the riverside — $10.", "money");
              return menu(
                "A dog with a lead on",
                [
                  "Forty minutes and one of the big houses, and a man who puts ten dollars in your hand at the gate and shuts it.",
                  "The dog watches you go from the window. You are on that street legitimately for once and it does not feel any different.",
                ],
                [close],
                "money",
              );
            },
          },
          {
            label: "Somebody will be along",
            run: () => {
              applyDelta(s.meters, { morale: -4 });
              return menu("A dog with a lead on", ["You keep walking. You listen for a car all the way to the bridge and do not hear one."], [close]);
            },
          },
        ],
      );
    },
  },
];
