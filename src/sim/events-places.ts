/**
 * Encounters that belong to a doorway.
 *
 * A zone is thirty rows deep, which is the right grain for "the police here
 * are worse" and much too coarse for "there is a shop". Everything in this
 * file fires *at* a named place — the kids are outside the Mart, the queue is
 * outside the food bank, the man with the letter is on the bank steps — so
 * walking past somewhere means something rather than being the same street
 * anywhere in the band.
 *
 * Two rules, both testable and both enforced in `events.test.ts`:
 *
 *  1. **Every one is a decision.** If the only thing to do is press Move on,
 *     it is not an encounter, it is a pop-up, and it gets cut. The one licence
 *     is a consequence you could not have avoided — those live elsewhere.
 *  2. **Nothing hands you money.** Cash always costs something: an hour, a
 *     risk, your name, or a thing you owned. Free money makes every earlier
 *     decision about money retroactively pointless.
 */

import { countOf, ITEMS, removeItem } from "./items";
import { applyDelta } from "./meters";
import { menu, type Choice } from "./prompt";
import { changeReputation, currentAppearance, earnCash, phaseOf, pushLog, type GameState } from "./state";
import { hourOf, withinHours } from "./time";
import type { EventDef, NearBy } from "./events";

const away: Choice = { label: "Walk on" };

/**
 * Fires only within a short walk of that door, and heavily favoured when it
 * does.
 *
 * The general pool is eighty encounters deep, so a place event at the same
 * weight as everything else is one in eighty — standing outside the Mart made
 * the kids on the wall barely likelier than a busker three streets away. The
 * point of tying an encounter to a door is that the door decides, so being
 * there outranks the ambient pool rather than joining it.
 */
const NEAR_WEIGHT = 5;

function at(marker: string, weight: number, when?: (s: GameState) => boolean) {
  return (s: GameState, _z: unknown, near: NearBy) =>
    near.has(marker) && (when?.(s) ?? true) ? weight * NEAR_WEIGHT : 0;
}

/** Every entry here happens outside a named door; this records which. */
function placed(marker: string, e: Omit<EventDef, "place">): EventDef {
  return { ...e, place: marker };
}

export const PLACE_EVENTS: EventDef[] = [
  /* ------------------------------------------------------------ the Mart */

  placed("mart", {
    id: "pl_beerRun",
    weight: at("mart", 4, (s) => currentAppearance(s) >= 30 && hourOf(s.time) >= 15),
    build: (ctx) => {
      const s = ctx.state;
      const cost = 10;
      return menu(
        "Outside the Mart",
        [
          "Four of them on the low wall, about fifteen, and one has been elected to ask.",
          `"Ten quid. You keep the change off it. We're not gonna be weird about it."`,
        ],
        [
          s.cash >= cost
            ? {
                label: "Take their money and go in",
                hint: `$${cost}, keeps ~$3`,
                run: () => {
                  ctx.advance(12, { sheltered: true });
                  // You are up three dollars and the clerk knows your face now.
                  earnCash(s, 3);
                  changeReputation(s, -4);
                  s.flags.boughtForKids = (s.flags.boughtForKids ?? 0) + 1;
                  pushLog(s, "Bought drink for a group of kids outside the Mart.", "bad");
                  return menu(
                    "Outside the Mart",
                    [
                      "The clerk looks at you, and then at the window, and says nothing at all.",
                      "You keep three dollars. It is the least profitable thing you have ever been talked into.",
                      s.flags.boughtForKids >= 2 ? "They will be here tomorrow. They know you now." : "",
                    ].filter(Boolean),
                    [away],
                    "bad",
                  );
                },
              }
            : { label: "Take their money and go in", hint: `$${cost}`, locked: "You'd need the tenner in hand first" },
          {
            label: "Tell them no",
            run: () => {
              applyDelta(s.meters, { morale: -2 });
              return menu(
                "Outside the Mart",
                ["They call you something on the way past and it is not even inventive.", "Thirty seconds later they have stopped somebody else."],
                [away],
              );
            },
          },
        ],
      );
    },
  }),

  placed("mart", {
    id: "pl_trolley",
    weight: at("mart", 3),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The trolley bay",
        ["Somebody has left a pound in a trolley and walked off, and there is a queue of nobody."],
        [
          {
            label: "Take the coin and return the trolley",
            hint: "5 min",
            run: () => {
              ctx.advance(5, { exertion: 1.1 });
              earnCash(s, 1);
              return menu("The trolley bay", ["A dollar. You walk the trolley back for it, which is the deal."], [away]);
            },
          },
          {
            label: "Leave it for whoever's next",
            run: () => {
              applyDelta(s.meters, { morale: +2 });
              return menu("The trolley bay", ["Somebody will be glad of it. You are not sure it is you."], [away]);
            },
          },
        ],
      );
    },
  }),

  /* -------------------------------------------------- the community center */

  placed("communityCenter", {
    id: "pl_queueJump",
    weight: at("communityCenter", 4, (s) => phaseOf(s) <= 2 && withinHours(s.time, 8, 18)),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The food bank queue",
        [
          "Forty minutes of it, in the rain, and a woman near the front is holding a place for somebody who is not here.",
          "The man behind you has noticed and is deciding whether to make it your problem.",
        ],
        [
          {
            label: "Say nothing",
            run: () => {
              ctx.advance(8);
              applyDelta(s.meters, { morale: -3 });
              return menu(
                "The food bank queue",
                ["Her friend turns up with a pushchair and an apology nobody needed.", "The man behind you says it to you instead, at length."],
                [away],
              );
            },
          },
          {
            label: "Back her up",
            run: () => {
              ctx.advance(10);
              changeReputation(s, 3);
              applyDelta(s.meters, { morale: +6 });
              pushLog(s, "Stood up for somebody in the food bank queue.", "good");
              return menu(
                "The food bank queue",
                ["You say she was here at eight, which is true, and that settles it.", "She does not thank you in words. You are on nodding terms for the rest of the run."],
                [away],
                "good",
              );
            },
          },
        ],
      );
    },
  }),

  /* --------------------------------------------------------------- the bank */

  placed("bank", {
    id: "pl_bankLetter",
    weight: at("bank", 4, (s) => s.debt > 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "On the bank steps",
        [
          "A man about sixty is standing at the doors with a letter he has clearly read a great many times.",
          `"They shut at five. I finish at five." He is not really talking to you.`,
        ],
        [
          {
            label: "Tell him about the extra hour",
            run: () => {
              changeReputation(s, 2);
              applyDelta(s.meters, { morale: +5 });
              return menu(
                "On the bank steps",
                [`"Six? Since when?" Since somebody noticed, you do not say.`, "He goes in. You know exactly how long he has been carrying that letter."],
                [away],
                "good",
              );
            },
          },
          away,
        ],
      );
    },
  }),

  /* ------------------------------------------------------------ the college */

  placed("college", {
    id: "pl_classmate",
    weight: at("college", 4, (s) => s.education >= 1 && s.education < 6),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Outside the college",
        [
          "Somebody from the Tuesday class, smoking in the doorway before it starts.",
          `"You did the accounts one, didn't you. I'm three weeks behind and I've stopped understanding it."`,
        ],
        [
          {
            label: "Go through it with them",
            hint: "40 min",
            run: () => {
              ctx.advance(40, { sheltered: true });
              applyDelta(s.meters, { energy: -6, morale: +10 });
              changeReputation(s, 3);
              s.flags.taughtClassmate = (s.flags.taughtClassmate ?? 0) + 1;
              pushLog(s, "Talked a classmate through the coursework.", "good");
              return menu(
                "Outside the college",
                [
                  "Forty minutes on a windowsill and they get it, and you find you knew it better than you thought.",
                  "It is the first time in a year anybody has needed something you have.",
                ],
                [away],
                "good",
              );
            },
          },
          {
            label: "Say you're late",
            run: () =>
              menu("Outside the college", ["You are not late. They say no problem and go back to the cigarette."], [away]),
          },
        ],
      );
    },
  }),

  /* ------------------------------------------------------------- the hostel */

  placed("hostel", {
    id: "pl_hostelBed",
    weight: at("hostel", 4, (s) => phaseOf(s) <= 2 && hourOf(s.time) >= 19),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The hostel desk",
        [
          "One cot left and two of you at the desk. The other one got here a minute after you and knows it.",
          "He is about nineteen and has a bin bag rather than a rucksack, which tells you how long he has been at this.",
        ],
        [
          {
            label: "Take the bed",
            run: () => {
              applyDelta(s.meters, { morale: -6 });
              s.flags.tookTheLastBed = 1;
              return menu(
                "The hostel desk",
                ["You take it. He says fair enough and means it, which does not help.", "You are warm and you think about it for a while before you sleep."],
                [away],
              );
            },
          },
          {
            label: "Let him have it",
            run: () => {
              changeReputation(s, 5);
              applyDelta(s.meters, { morale: +8 });
              s.flags.gaveUpTheBed = 1;
              pushLog(s, "Gave up the last cot at the hostel.", "good");
              return menu(
                "The hostel desk",
                [
                  "The man on the desk looks up for the first time in the conversation and writes something down.",
                  "You are outside again with the whole night in front of you, and you would do it again.",
                ],
                [away],
                "good",
              );
            },
          },
        ],
      );
    },
  }),

  /* ------------------------------------------------------- the corporate plaza */

  placed("corporatePlaza", {
    id: "pl_plazaSmokers",
    weight: at("corporatePlaza", 4, (s) => phaseOf(s) >= 3),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The smoking shelter",
        [
          "Two from the fourth floor, and the conversation stops half a syllable late when you come round the corner.",
          "It was about the restructure. It is always about the restructure.",
        ],
        [
          {
            label: "Ask what they've heard",
            hint: "15 min",
            run: () => {
              ctx.advance(15, { sheltered: true });
              s.flags.heardTheRumour = 1;
              applyDelta(s.meters, { morale: -4 });
              return menu(
                "The smoking shelter",
                [
                  "Two floors are going and neither of them knows which, and both of them have a theory about you.",
                  "You go back up knowing three things that are probably not true.",
                ],
                [away],
              );
            },
          },
          {
            label: "Keep walking",
            run: () => {
              applyDelta(s.meters, { morale: +2 });
              return menu("The smoking shelter", ["Whatever it is, it will be an email by Thursday."], [away]);
            },
          },
        ],
      );
    },
  }),

  /* ---------------------------------------------------------- the laundromat */

  placed("laundromat", {
    id: "pl_dryerCoins",
    weight: at("laundromat", 3, (s) => withinHours(s.time, 7, 21)),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Wash & Wear",
        [
          "Somebody's wash finished twenty minutes ago and they are not here, and the machine is the only free one.",
        ],
        [
          {
            label: "Take their things out and fold them",
            hint: "10 min",
            run: () => {
              ctx.advance(10, { sheltered: true });
              changeReputation(s, 2);
              applyDelta(s.meters, { morale: +4 });
              return menu(
                "Wash & Wear",
                ["You fold somebody's washing on the side and use the machine.", "They come back while you are still there and are extremely embarrassed about all of it."],
                [away],
                "good",
              );
            },
          },
          {
            label: "Dump them on the side",
            run: () => {
              changeReputation(s, -1);
              return menu("Wash & Wear", ["Out on the counter in a heap. It is their own fault and you are still not proud of it."], [away]);
            },
          },
        ],
      );
    },
  }),

  /* ------------------------------------------------------- Brokedale places */

  placed("depot", {
    id: "pl_depotGate",
    weight: at("depot", 4, (s) => s.employment !== null),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The weighbridge",
        [
          "A driver is twenty minutes out of hours and one signature short of going home.",
          `"You're staff. Just initial it. It's nothing, it's a formality."`,
        ],
        [
          {
            label: "Sign it",
            run: () => {
              changeReputation(s, 2);
              s.flags.signedTheSheet = 1;
              applyDelta(s.meters, { morale: -2 });
              return menu(
                "The weighbridge",
                ["You initial it. He is gone inside a minute and you have his phone number for no reason you can name.", "It is a formality right up until it is not."],
                [away],
              );
            },
          },
          {
            label: "Send him to the office",
            run: () => {
              changeReputation(s, -2);
              return menu(
                "The weighbridge",
                ["He goes to the office. It takes him forty minutes and he does not look at you on the way out."],
                [away],
              );
            },
          },
        ],
      );
    },
  }),

  placed("nightMarket", {
    id: "pl_marketPitch",
    weight: at("nightMarket", 4, (s) => !s.stallOwned),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Behind the stalls",
        [
          "The woman on the end pitch is packing a crate she cannot lift on her own and is going to try anyway.",
        ],
        [
          {
            label: "Take one end",
            hint: "10 min",
            run: () => {
              ctx.advance(10, { exertion: 1.8 });
              applyDelta(s.meters, { energy: -5, morale: +5 });
              changeReputation(s, 3);
              s.flags.helpedNadia = (s.flags.helpedNadia ?? 0) + 1;
              pushLog(s, "Gave Nadia a hand with the crates.", "good");
              return menu(
                "Behind the stalls",
                [
                  "Two minutes with two people instead of twenty with one. She is called Nadia and has been here six years.",
                  "She gives you the end of the tray that did not sell, which is not payment and you both know it.",
                ],
                [away],
                "good",
              );
            },
          },
          away,
        ],
      );
    },
  }),

  placed("washhouse", {
    id: "pl_washhouseQueue",
    weight: at("washhouse", 3, (s) => s.meters.hygiene < 40),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The Eastgate, half nine",
        [
          "Six cubicles and eleven people, and the machine that sells the tokens takes notes only.",
          "A man is breaking a twenty for people one at a time and taking nothing for it.",
        ],
        [
          {
            label: "Wait your turn",
            hint: "20 min",
            run: () => {
              ctx.advance(20);
              applyDelta(s.meters, { morale: +3 });
              return menu(
                "The Eastgate, half nine",
                ["Twenty minutes standing up. Somebody explains the trick with the third cubicle, which is that there isn't one."],
                [away],
              );
            },
          },
          {
            label: "Come back later",
            run: () => menu("The Eastgate, half nine", ["You will come back later. It will be exactly like this later."], [away]),
          },
        ],
      );
    },
  }),

  placed("pawnShop", {
    id: "pl_pawnRegular",
    weight: at("pawnShop", 3, (s) => countOf(s.inventory, "bicycle") > 0 || countOf(s.inventory, "phone") > 0),
    build: (ctx) => {
      const s = ctx.state;
      // Whichever you actually have. Reading "phone or else bicycle" without
      // checking meant somebody with neither was paid $28 for removing nothing
      // — free money, which is the one thing this file is not allowed to do.
      const has = countOf(s.inventory, "phone") > 0 ? "phone" : countOf(s.inventory, "bicycle") > 0 ? "bicycle" : null;
      return menu(
        "Outside Vance & Son",
        [
          "A man comes out holding a ticket and no wedding ring and stands there a moment working out which way to walk.",
          `He sees you looking. "Don't. Whatever it is, don't."`,
        ],
        [
          has === null
            ? { label: "Go in anyway", locked: "You have nothing he would take" }
            : {
            label: `Go in and pawn your ${ITEMS[has].name.toLowerCase()}`,
            run: () => {
              const paid = has === "phone" ? 24 : 28;
              removeItem(s.inventory, has, 1);
              earnCash(s, paid);
              applyDelta(s.meters, { morale: -10 });
              pushLog(s, `Pawned your ${has} for $${paid}.`, "money");
              return menu(
                "Vance & Son",
                [`He gives you $${paid} and a ticket, and you understand the man outside completely.`],
                [away],
                "money",
              );
            },
          },
          {
            label: "Take the advice",
            run: () => {
              applyDelta(s.meters, { morale: +4 });
              return menu("Outside Vance & Son", ["You keep walking. It is a small thing and you are glad of it later."], [away]);
            },
          },
        ],
      );
    },
  }),

  placed("coachTerminal", {
    id: "pl_terminalPhone",
    weight: at("coachTerminal", 3, (s) => phaseOf(s) >= 2),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The concourse payphone",
        [
          "It still works, which is the surprising part. A number is written on the wall beside it in three different hands.",
        ],
        [
          {
            label: "Ring the number",
            hint: "10 min",
            run: () => {
              ctx.advance(10, { sheltered: true });
              applyDelta(s.meters, { morale: -6 });
              return menu(
                "The concourse payphone",
                [
                  "A hostel two towns over. Full, and the woman is sorry about it, and asks if you have anywhere tonight.",
                  "You say yes. It is even true.",
                ],
                [away],
              );
            },
          },
          away,
        ],
      );
    },
  }),

  placed("weeklyRooms", {
    id: "pl_roomsLandlord",
    weight: at("weeklyRooms", 3, (s) => s.housing.brokedale === "room" && !s.blockOwned),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The stairwell",
        [
          "Aldiss is on the second landing with a torch and a look of a man doing sums.",
          `"Damp on this side. Always has been. I keep meaning to."`,
        ],
        [
          {
            label: "Ask what he'd want for the place",
            run: () => {
              s.flags.bd_askedWhoOwns = 1;
              applyDelta(s.meters, { morale: +3 });
              return menu(
                "The stairwell",
                [
                  "He laughs, and then does not. \"You're the first one to ask in eleven years.\"",
                  "\"I'd want to know it was going to somebody off the Row. That's all I'd want.\"",
                ],
                [away],
              );
            },
          },
          {
            label: "Mention the damp",
            run: () => {
              changeReputation(s, 1);
              return menu("The stairwell", ["He writes it on the back of an envelope. Something may even happen."], [away]);
            },
          },
        ],
      );
    },
  }),
];
