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

import { addItem, countOf, ITEMS, removeItem } from "./items";
import { applyDelta } from "./meters";
import { menu, type Choice } from "./prompt";
import { changeReputation, currentAppearance, earnCash, housingIn, phaseOf, pushLog, type GameState } from "./state";
import { hourOf, withinHours } from "./time";
import type { EventDef, NearBy } from "./events";

const away: Choice = { label: "Walk on" };

/**
 * Fires only when that door is the nearest one, and heavily favoured when it
 * is.
 *
 * The general pool is eighty encounters deep, so a place event at the same
 * weight as everything else is one in eighty — standing outside the Mart made
 * the kids on the wall barely likelier than a busker three streets away. The
 * point of tying an encounter to a door is that the door decides, so being
 * there outranks the ambient pool rather than joining it.
 *
 * *Nearest*, not merely within range, because the town is dense: the bank is
 * five tiles from the hospital and the church backs onto the recycling yard,
 * so `has()` alone fired the A&E encounter at the bank counter and the bin run
 * in a pew. One doorway owns the pavement outside it, and the fiction of every
 * one of these says where you are standing.
 */
const NEAR_WEIGHT = 5;

function at(marker: string, weight: number, when?: (s: GameState) => boolean) {
  return (s: GameState, _z: unknown, near: NearBy) =>
    near.closest === marker && (when?.(s) ?? true) ? weight * NEAR_WEIGHT : 0;
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

  /* ---------------------------------------------------------------- the diner */

  placed("diner", {
    id: "pl_dinerDeclined",
    weight: at("diner", 4, (s) => s.cash >= 10),
    build: (ctx) => {
      const s = ctx.state;
      const short = 7;
      return menu(
        "At the diner counter",
        [
          "The card reader says declined, and then says it again louder, and the woman holding the card has gone very still.",
          "Two coffees and a plate of eggs for a boy who is about six and has already started eating.",
        ],
        [
          s.cash >= short
            ? {
                label: "Put the rest on yours",
                hint: `$${short}`,
                run: () => {
                  s.cash -= short;
                  changeReputation(s, 3);
                  applyDelta(s.meters, { morale: +8 });
                  pushLog(s, "Covered somebody's breakfast at the diner.", "good");
                  return menu(
                    "At the diner counter",
                    [
                      "She wants your name and address to send it back and you do not have either, so you say forget it.",
                      "The boy has not looked up once. That is the part you take with you.",
                    ],
                    [away],
                    "good",
                  );
                },
              }
            : { label: "Put the rest on yours", hint: `$${short}`, locked: "You haven't got it either" },
          {
            label: "Look at the menu board",
            run: () => {
              applyDelta(s.meters, { morale: -3 });
              return menu(
                "At the diner counter",
                ["You read the specials very carefully until it is over.", "She leaves the eggs. The boy is walked out still chewing."],
                [away],
              );
            },
          },
        ],
      );
    },
  }),

  placed("diner", {
    id: "pl_dinerBackDoor",
    weight: at("diner", 4, (s) => s.meters.hunger <= 45 && hourOf(s.time) >= 20),
    build: (ctx) => {
      const s = ctx.state;
      const price = 6;
      return menu(
        "The diner back door",
        [
          "The cook is scraping the last tray into a bin and stops when he sees you, which is its own kind of answer.",
          `"It's going out anyway. I'm not allowed to give it you. I am allowed to be paid for it, and I'm allowed to be short-handed."`,
        ],
        [
          {
            label: "Wash up for it",
            hint: "35 min",
            run: () => {
              ctx.advance(35, { sheltered: true, exertion: 1.1 });
              applyDelta(s.meters, { energy: -6 });
              addItem(s.inventory, "hotMeal");
              changeReputation(s, 2);
              pushLog(s, "Washed up at the diner for the end of the tray.", "good");
              return menu(
                "The diner back door",
                ["Thirty-five minutes at a sink and a plate that is still hot in the middle.", "He tells you what nights he is on his own. That is worth more than the meal."],
                [away],
                "good",
              );
            },
          },
          s.cash >= price
            ? {
                label: "Just pay him",
                hint: `$${price}`,
                run: () => {
                  s.cash -= price;
                  addItem(s.inventory, "hotMeal");
                  return menu("The diner back door", ["Six dollars and no questions, in a box that is too hot to hold properly."], [away]);
                },
              }
            : { label: "Just pay him", hint: `$${price}`, locked: `You're short of $${price}` },
          {
            label: "Leave him to it",
            run: () => menu("The diner back door", ["The bin lid goes down. You hear it from the end of the alley."], [away]),
          },
        ],
      );
    },
  }),

  /* --------------------------------------------------------------- the church */

  placed("church", {
    id: "pl_churchSoupRun",
    weight: at("church", 4, (s) => hourOf(s.time) >= 17 && phaseOf(s) <= 3),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The church side door",
        [
          "The soup run is one urn, forty cups and a woman doing all of it, and the queue is longer than the woman.",
          `"You look like you can pour. I'm not proud, I'm just on my own."`,
        ],
        [
          {
            label: "Pour for an hour",
            hint: "60 min",
            run: () => {
              ctx.advance(60, { exertion: 1.05 });
              applyDelta(s.meters, { energy: -8, morale: +14, hunger: +18, thirst: +15 });
              changeReputation(s, 4);
              s.flags.pouredAtTheSoupRun = (s.flags.pouredAtTheSoupRun ?? 0) + 1;
              pushLog(s, "Worked the soup run at the church.", "good");
              return menu(
                "The church side door",
                [
                  "An hour of cups and names, and the last of the urn is yours because there is nobody left to give it to.",
                  s.flags.pouredAtTheSoupRun >= 3
                    ? "She has stopped asking whether you are coming. She just leaves a ladle out."
                    : "She asks if you are about on Thursdays.",
                ],
                [away],
                "good",
              );
            },
          },
          {
            label: "Get in the queue instead",
            hint: "20 min",
            run: () => {
              ctx.advance(20);
              applyDelta(s.meters, { hunger: +16, thirst: +12, morale: -2 });
              return menu(
                "The church side door",
                ["Twenty minutes and a cup of something orange. She thanks you for waiting, which somehow makes it worse."],
                [away],
              );
            },
          },
        ],
      );
    },
  }),

  placed("church", {
    id: "pl_churchPlate",
    weight: at("church", 3, (s) => phaseOf(s) >= 3 && s.cash >= 60),
    build: (ctx) => {
      const s = ctx.state;
      const give = 20;
      return menu(
        "The back pew",
        [
          "The plate is coming down the row and you are the only one in the pew, so there is no arithmetic to hide behind.",
          "You have eaten here. Not recently. Recently enough.",
        ],
        [
          s.cash >= give
            ? {
                label: `Put in $${give}`,
                run: () => {
                  s.cash -= give;
                  changeReputation(s, 4);
                  applyDelta(s.meters, { morale: +10 });
                  s.flags.gaveBackAtTheChurch = 1;
                  pushLog(s, `Put $${give} in the plate at the church.`, "good");
                  return menu(
                    "The back pew",
                    ["Nobody sees you do it, which is the only way it counts.", "The urn is the same urn."],
                    [away],
                    "good",
                  );
                },
              }
            : { label: `Put in $${give}`, locked: "Not this week" },
          {
            label: "Pass it along",
            run: () => {
              applyDelta(s.meters, { morale: -4 });
              return menu("The back pew", ["You pass it along. It is not a large thing and it sits there anyway."], [away]);
            },
          },
        ],
      );
    },
  }),

  /* ------------------------------------------------------------- the hospital */

  placed("hospital", {
    id: "pl_hospitalSlippers",
    weight: at("hospital", 4, (s) => hourOf(s.time) >= 21 || hourOf(s.time) <= 4),
    build: (ctx) => {
      const s = ctx.state;
      const fare = 4;
      return menu(
        "Outside A&E",
        [
          "A man in paper slippers has been discharged into the middle of the night with a cannula plaster still on his hand.",
          `"They said there's a bus. I've not got it on me. I've not got anything on me, they cut the trousers off."`,
        ],
        [
          s.cash >= fare
            ? {
                label: "Give him the fare",
                hint: `$${fare}`,
                run: () => {
                  s.cash -= fare;
                  changeReputation(s, 2);
                  applyDelta(s.meters, { morale: +6 });
                  return menu("Outside A&E", ["Four dollars and he is somebody's problem other than the pavement's.", "He asks your name twice and will not remember it."], [away], "good");
                },
              }
            : { label: "Give him the fare", hint: `$${fare}`, locked: "You've nothing on you either" },
          {
            label: "Walk him to the stop",
            hint: "20 min",
            run: () => {
              ctx.advance(20);
              applyDelta(s.meters, { energy: -3, morale: +7 });
              changeReputation(s, 3);
              pushLog(s, "Walked a discharged patient to the bus stop.", "good");
              return menu(
                "Outside A&E",
                ["Twenty minutes at the pace of a man in paper slippers, and the driver lets him on for nothing once he has seen the plaster."],
                [away],
                "good",
              );
            },
          },
          {
            label: "You've nothing to give",
            run: () => menu("Outside A&E", ["You say sorry, and mean it, and it is worth exactly what it costs."], [away]),
          },
        ],
      );
    },
  }),

  placed("hospital", {
    id: "pl_hospitalWait",
    weight: at("hospital", 5, (s) => s.meters.health <= 45),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The triage window",
        [
          "The nurse takes one look and does not argue with you about whether you should be seen.",
          `"Four hours. I can't make it less and I'm not going to pretend. Or come back at seven and it's the same four hours."`,
        ],
        [
          {
            label: "Sit it out",
            hint: "4 hrs",
            run: () => {
              ctx.advance(240, { sheltered: true });
              applyDelta(s.meters, { health: +30, energy: -10, morale: -6, hunger: -10 });
              pushLog(s, "Sat out four hours at A&E and got seen.", "good");
              return menu(
                "The triage window",
                ["Four hours of a strip light and a television with no sound, and then eleven minutes that fix most of it."],
                [away],
                "good",
              );
            },
          },
          {
            label: "You haven't got four hours",
            run: () => {
              applyDelta(s.meters, { morale: -4 });
              return menu(
                "The triage window",
                ["She writes something down without looking up. You have seen that exact movement in three buildings this month."],
                [away],
              );
            },
          },
        ],
      );
    },
  }),

  /* ------------------------------------------------------------ the bike shop */

  placed("bikeShop", {
    id: "pl_bikeOutBack",
    weight: at("bikeShop", 4, (s) => countOf(s.inventory, "bicycle") === 0),
    build: (ctx) => {
      const s = ctx.state;
      const price = 25;
      return menu(
        "Round the back of the bike shop",
        [
          "A man with a bike he is not riding. It is a good bike and he is holding it by the saddle like a wheelbarrow.",
          "There is a child's name stickered along the crossbar and a hacksawed stub of lock still on the frame.",
        ],
        [
          s.cash >= price
            ? {
                label: `Buy it — $${price}`,
                run: () => {
                  s.cash -= price;
                  addItem(s.inventory, "bicycle");
                  changeReputation(s, -6);
                  s.flags.boughtTheStolenBike = 1;
                  pushLog(s, "Bought a bike with somebody else's name on it.", "bad");
                  return menu(
                    "Round the back of the bike shop",
                    [
                      "Twenty-five dollars and a bike, and a sticker you will spend a week deciding whether to peel off.",
                      "The shop has a board of photos in the window. You do not look at it on the way past.",
                    ],
                    [away],
                    "bad",
                  );
                },
              }
            : { label: `Buy it — $${price}`, locked: `You're short of $${price}` },
          {
            label: "Tell the shop",
            hint: "15 min",
            run: () => {
              ctx.advance(15, { sheltered: true });
              changeReputation(s, 4);
              applyDelta(s.meters, { morale: +5 });
              s.flags.reportedTheBike = 1;
              pushLog(s, "Told the bike shop about the one being sold out back.", "good");
              return menu(
                "Round the back of the bike shop",
                ["The owner is out the door before you have finished the sentence, and the alley is empty.", "He remembers your face after that, which turns out to be worth something."],
                [away],
                "good",
              );
            },
          },
          {
            label: "Not your business",
            run: () => menu("Round the back of the bike shop", ["You keep walking. It is somebody's bike either way."], [away]),
          },
        ],
      );
    },
  }),

  placed("bikeShop", {
    id: "pl_bikePuncture",
    weight: at("bikeShop", 4, (s) => countOf(s.inventory, "bicycle") > 0),
    build: (ctx) => {
      const s = ctx.state;
      const price = 9;
      return menu(
        "The pavement outside the bike shop",
        [
          "Flat, and flat in the way that means glass rather than a slow one. The shop will do it while you wait.",
          "The lad on the step has a puncture kit open on his knee and no particular hurry.",
        ],
        [
          s.cash >= price
            ? {
                label: `Let the shop do it — $${price}`,
                hint: "10 min",
                run: () => {
                  s.cash -= price;
                  ctx.advance(10, { sheltered: true });
                  return menu("The pavement outside the bike shop", ["Nine dollars, ten minutes, and a wheel that holds air."], [away]);
                },
              }
            : { label: `Let the shop do it — $${price}`, locked: `You're short of $${price}` },
          {
            label: "Borrow his levers",
            hint: "30 min",
            run: () => {
              ctx.advance(30, { exertion: 1.1 });
              applyDelta(s.meters, { energy: -4, morale: +4, hygiene: -3 });
              changeReputation(s, 1);
              return menu(
                "The pavement outside the bike shop",
                ["Half an hour, both thumbs, and a patch that will probably hold.", "He talks the whole time and none of it is about bicycles."],
                [away],
              );
            },
          },
        ],
      );
    },
  }),

  /* ------------------------------------------------------------ the job board */

  placed("jobBoard", {
    id: "pl_boardScam",
    weight: at("jobBoard", 4, (s) => phaseOf(s) <= 2 && countOf(s.inventory, "phone") > 0),
    build: (ctx) => {
      const s = ctx.state;
      const fee = 40;
      return menu(
        "The job board",
        [
          "Hand-written, in marker, over the top of two council notices: $300 A DAY. NO EXPERIENCE. CASH SAME DAY. RING MARK.",
          "Nothing else on this board pays a third of that.",
        ],
        [
          {
            label: "Ring Mark",
            hint: "15 min",
            run: () => {
              ctx.advance(15);
              return menu(
                "The job board",
                [
                  `Mark is delighted. Mark has vans going out Monday. Mark needs $${fee} for the registration and the vest, today, in cash.`,
                  `"Everyone pays it. It comes off your first day."`,
                ],
                [
                  s.cash >= fee
                    ? {
                        label: `Pay the $${fee}`,
                        run: () => {
                          s.cash -= fee;
                          applyDelta(s.meters, { morale: -12 });
                          s.flags.paidMark = 1;
                          pushLog(s, `Paid $${fee} up front to a number off the job board.`, "bad");
                          return menu(
                            "The job board",
                            [
                              "The number rings out on Monday and every day after it.",
                              "The card is still on the board a week later in different marker. You are not the first.",
                            ],
                            [away],
                            "bad",
                          );
                        },
                      }
                    : { label: `Pay the $${fee}`, locked: `You haven't got $${fee}` },
                  {
                    label: "Nobody pays to work",
                    run: () => {
                      applyDelta(s.meters, { morale: +3 });
                      return menu("The job board", ["Mark's tone changes so fast it is almost impressive. You hang up on the second sentence."], [away]);
                    },
                  },
                ],
              );
            },
          },
          {
            label: "Take the card down",
            hint: "5 min",
            run: () => {
              ctx.advance(5);
              changeReputation(s, 2);
              applyDelta(s.meters, { morale: +4 });
              s.flags.tookDownMarksCard = 1;
              return menu(
                "The job board",
                ["You put it in the bin and the two council notices underneath turn out to be a housing number and a bus timetable."],
                [away],
                "good",
              );
            },
          },
        ],
      );
    },
  }),

  placed("jobBoard", {
    id: "pl_boardSmallPrint",
    weight: at("jobBoard", 3, (s) => phaseOf(s) <= 3),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The job board",
        [
          "A woman holding a card at arm's length, then close, then at arm's length again.",
          `"Does that say five thirty or five thirteen? I've left my glasses at my sister's and I'm not going back for them."`,
        ],
        [
          {
            label: "Read the whole card to her",
            hint: "10 min",
            run: () => {
              ctx.advance(10);
              changeReputation(s, 2);
              applyDelta(s.meters, { morale: +5 });
              return menu(
                "The job board",
                [
                  "Five thirty. And a shift pattern that would take her four buses, which she works out before you do.",
                  `"Well," she says. "That's that one off the list." She writes it down anyway.`,
                ],
                [away],
                "good",
              );
            },
          },
          {
            label: "Squint at it once and guess",
            run: () => {
              applyDelta(s.meters, { morale: -2 });
              return menu("The job board", ["You say five thirty and hope. She thanks you and you watch her go and hope harder."], [away]);
            },
          },
        ],
      );
    },
  }),

  /* -------------------------------------------------------------- the bus stop */

  placed("busStop", {
    id: "pl_stopBags",
    weight: at("busStop", 3),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The bus stop",
        [
          "Four carrier bags, a woman, and a ticket machine forty feet away that only takes coins.",
          `"Would you watch these? The bus is eight minutes. I'll run."`,
        ],
        [
          {
            label: "Watch the bags",
            hint: "12 min",
            run: () => {
              ctx.advance(12);
              changeReputation(s, 3);
              applyDelta(s.meters, { morale: +5 });
              return menu(
                "The bus stop",
                [
                  "She is back in six and out of breath and counts the bags without meaning to, and catches herself doing it.",
                  `"Sorry. Sorry. Habit."`,
                ],
                [away],
                "good",
              );
            },
          },
          {
            label: "Say you've got somewhere to be",
            run: () => {
              applyDelta(s.meters, { morale: -2 });
              return menu("The bus stop", ["She takes all four to the machine, one handle at a time, and misses the bus by about ten seconds."], [away]);
            },
          },
        ],
      );
    },
  }),

  placed("outskirtsBusStop", {
    id: "pl_lastBusPass",
    weight: at("outskirtsBusStop", 4, (s) => hourOf(s.time) >= 20),
    build: (ctx) => {
      const s = ctx.state;
      const fare = 3;
      return menu(
        "The last bus out",
        [
          "The driver has the door open and the engine running and a pass in his hand that expired on Friday.",
          "The woman it belongs to is not arguing. She has already stepped back off the step, which is the worst part.",
        ],
        [
          s.cash >= fare
            ? {
                label: "Put her fare in",
                hint: `$${fare}`,
                run: () => {
                  s.cash -= fare;
                  changeReputation(s, 3);
                  applyDelta(s.meters, { morale: +7 });
                  pushLog(s, "Paid a stranger's fare on the last bus.", "good");
                  return menu(
                    "The last bus out",
                    ["Three dollars. The driver shuts the door before anybody can say anything else about it, which is his way of helping."],
                    [away],
                    "good",
                  );
                },
              }
            : { label: "Put her fare in", hint: `$${fare}`, locked: "You're counting your own coins" },
          {
            label: "Ask the driver to let it go",
            run: () => {
              changeReputation(s, 1);
              applyDelta(s.meters, { morale: +2 });
              return menu(
                "The last bus out",
                [
                  `"It's not me, it's the machine," he says, and then looks at the machine, and then at the road.`,
                  "He lets her on. He does not look at either of you again.",
                ],
                [away],
                "good",
              );
            },
          },
          {
            label: "Get on and sit down",
            run: () => {
              applyDelta(s.meters, { morale: -5 });
              return menu("The last bus out", ["You take a seat near the back. The doors close on a woman standing very still at a stop with no shelter."], [away]);
            },
          },
        ],
      );
    },
  }),

  /* ------------------------------------------------------------- the recycling */

  placed("recycling", {
    id: "pl_binsRegular",
    weight: at("recycling", 4, (s) => phaseOf(s) <= 2),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The bin run",
        [
          "Somebody is already three bins in, working them properly — lid, sweep, lid — and he has seen you.",
          "He is sixty-odd and this is plainly his round. There are eleven bins and about four bins' worth of anything.",
        ],
        [
          {
            label: "Start at the other end",
            hint: "25 min",
            run: () => {
              ctx.advance(25, { exertion: 1.2 });
              applyDelta(s.meters, { energy: -7, hygiene: -6 });
              addItem(s.inventory, "recyclables", 2);
              changeReputation(s, 2);
              return menu(
                "The bin run",
                [
                  "You work towards each other and meet in the middle with two bins spare, and neither of you takes them.",
                  `"Tuesdays and Fridays," he says. "The rest is students, it's all pizza." It is the most useful thing anybody has told you this week.`,
                ],
                [away],
                "good",
              );
            },
          },
          {
            label: "Work back the way he's coming",
            hint: "35 min",
            run: () => {
              ctx.advance(35, { exertion: 1.25 });
              applyDelta(s.meters, { energy: -10, hygiene: -8, morale: -5 });
              addItem(s.inventory, "recyclables", 4);
              changeReputation(s, -5);
              s.flags.tookTheBinRun = 1;
              pushLog(s, "Stripped the bin run out from under the man who works it.", "bad");
              return menu(
                "The bin run",
                ["Four bins' worth and you are quicker than he is, which is the whole of it.", "He does not say anything. He stands with a lid in his hand until you have gone."],
                [away],
                "bad",
              );
            },
          },
        ],
      );
    },
  }),

  /* --------------------------------------------------------- the panhandle spot */

  placed("panhandleSpot", {
    id: "pl_spotTaken",
    weight: at("panhandleSpot", 4, (s) => phaseOf(s) <= 2),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Your pitch",
        [
          "Someone is sitting in it. Not aggressively — a woman with a dog and a cardboard sign, set up properly, cup out.",
          "It is the only doorway on this street that is out of the wind and both of you know it.",
        ],
        [
          {
            label: "Take the corner opposite",
            hint: "worse pitch",
            run: () => {
              applyDelta(s.meters, { morale: -3 });
              s.flags.gaveUpThePitch = (s.flags.gaveUpThePitch ?? 0) + 1;
              return menu(
                "Your pitch",
                [
                  "The corner opposite is in the wind and in the sun and nobody stops on that side.",
                  "She raises a hand at you about an hour in. It is not nothing.",
                ],
                [away],
              );
            },
          },
          {
            label: "Tell her it's yours",
            run: () => {
              changeReputation(s, -4);
              applyDelta(s.meters, { morale: -6 });
              s.flags.tookThePitchBack = 1;
              return menu(
                "Your pitch",
                [
                  "She moves. She does not argue, which is worse, and she is slow about the dog's blanket.",
                  "You have the doorway and the wind is off you and you sit in it for four hours feeling exactly as you expected to feel.",
                ],
                [away],
                "bad",
              );
            },
          },
          {
            label: "Sit alongside her",
            hint: "splits the take",
            run: () => {
              ctx.advance(20);
              changeReputation(s, 3);
              applyDelta(s.meters, { morale: +6 });
              s.flags.sharedThePitch = 1;
              return menu(
                "Your pitch",
                [
                  "Two people in a doorway does worse than one and you both know it before you sit down.",
                  "She knows which cafés put the trays out and when. You do the sums later and it comes out about even.",
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

  /* ------------------------------------------------------------ the laundromat */

  placed("laundromat", {
    id: "pl_laundryLeft",
    weight: at("laundromat", 3),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The laundromat",
        [
          "Every machine is on and the one that has finished has been finished for forty minutes, going by the log book.",
          "There is a queue behind you of one man who is looking at his watch about it.",
        ],
        [
          {
            label: "Fold it out onto the table",
            hint: "12 min",
            run: () => {
              ctx.advance(12, { sheltered: true });
              changeReputation(s, 2);
              applyDelta(s.meters, { morale: +4 });
              return menu(
                "The laundromat",
                [
                  "Somebody's work shirts, folded properly, in a stack on the end table where they will be found.",
                  "The woman comes back at a run twenty minutes later and cannot work out why they are folded.",
                ],
                [away],
                "good",
              );
            },
          },
          {
            label: "Pile it on the side and get on",
            hint: "3 min",
            run: () => {
              ctx.advance(3, { sheltered: true });
              changeReputation(s, -2);
              return menu("The laundromat", ["It goes on the side in a heap, half of it on the floor by the time you have loaded yours."], [away]);
            },
          },
        ],
      );
    },
  }),

  /* -------------------------------------------------------------- the trailer */

  placed("trailer", {
    id: "pl_trailerGenerator",
    weight: at("trailer", 4, (s) => housingIn(s, "brokemon") === "trailer" && hourOf(s.time) >= 21),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Outside your trailer",
        [
          "The generator two doors down has been running since eight and will run until four, and it is nine feet from where your head goes.",
          "He works nights off it. That is the thing that makes it complicated.",
        ],
        [
          {
            label: "Ask him to move it round",
            run: () => {
              ctx.advance(15);
              changeReputation(s, -3);
              s.flags.generatorMoved = 1;
              applyDelta(s.meters, { morale: -2 });
              return menu(
                "Outside your trailer",
                [
                  "He moves it. He is not gracious about it and he is not wrong not to be.",
                  "You sleep. He is short with you for a fortnight and then it goes back to normal, mostly.",
                ],
                [away],
              );
            },
          },
          {
            label: "Sleep through it",
            run: () => {
              applyDelta(s.meters, { energy: -8, morale: -4 });
              return menu("Outside your trailer", ["You do not sleep through it. You lie there doing the arithmetic on how many hours are left of it."], [away]);
            },
          },
          {
            label: "Go and see what he's running",
            hint: "25 min",
            run: () => {
              ctx.advance(25);
              applyDelta(s.meters, { energy: -3, morale: +6 });
              changeReputation(s, 2);
              s.flags.metTheGeneratorMan = 1;
              return menu(
                "Outside your trailer",
                [
                  "A chest freezer and a sewing machine. He does alterations for half the park and everything in the freezer is somebody else's.",
                  "He puts a board up on your side that night. It takes about a third off it and costs him an hour.",
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

  /* ------------------------------------------------------------ the apartment */

  placed("apartment", {
    id: "pl_apartmentParcel",
    weight: at("apartment", 3, (s) => housingIn(s, "brokemon") === "apartment" || housingIn(s, "brokemon") === "estate"),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The lobby",
        [
          "A courier with a box for 4B and a scanner he is already holding out, because he has thirty more of these and eleven minutes each.",
          "You do not know 4B. You know the noise 4B makes at half past six.",
        ],
        [
          {
            label: "Sign for it",
            hint: "8 min",
            run: () => {
              ctx.advance(8, { sheltered: true });
              changeReputation(s, 2);
              applyDelta(s.meters, { morale: +3 });
              s.flags.signedFor4B = 1;
              return menu(
                "The lobby",
                [
                  "The box is heavier than a box that size has any business being and it lives by your door for two days.",
                  "4B turns out to be a nurse on nights, and after that the noise at half six is somebody coming home.",
                ],
                [away],
                "good",
              );
            },
          },
          {
            label: "Tell him to leave a card",
            run: () =>
              menu("The lobby", ["He leaves the card and the box goes back on the van. It will be here again tomorrow at the same time."], [away]),
          },
        ],
      );
    },
  }),

  /* --------------------------------------------------------------- the estate */

  placed("estate", {
    id: "pl_estateMistaken",
    weight: at("estate", 4, (s) => !s.won && phaseOf(s) >= 3),
    build: (ctx) => {
      const s = ctx.state;
      const pay = 18;
      return menu(
        "The estate gates",
        [
          "The gardener holds out a leaf blower without looking up. He has assumed you are the agency lad, and he has assumed it on the strength of one glance.",
          `"Bottom of the drive up. Hour, hour and a half. Cash at the end, I don't do the forms."`,
        ],
        [
          {
            label: "Do the hour",
            hint: `60 min, $${pay}`,
            run: () => {
              ctx.advance(60, { exertion: 1.2 });
              applyDelta(s.meters, { energy: -10, hygiene: -6, morale: -4 });
              earnCash(s, pay);
              return menu(
                "The estate gates",
                [
                  `An hour of somebody else's leaves and $${pay} out of a tin, and he never does look up properly.`,
                  "You know what the house is worth. You have looked it up. That is the part that costs you.",
                ],
                [away],
              );
            },
          },
          {
            label: "Tell him who you are",
            run: () => {
              applyDelta(s.meters, { morale: +4 });
              changeReputation(s, 1);
              return menu(
                "The estate gates",
                [
                  "He apologises about four times more than is comfortable and then talks to you completely differently, which is not better.",
                  "The agency lad turns up nine minutes later and is nineteen.",
                ],
                [away],
              );
            },
          },
        ],
      );
    },
  }),

  /* ---------------------------------------------------- Brokedale: the agency */

  placed("agency", {
    id: "pl_agencyTout",
    weight: at("agency", 4, (s) => withinHours(s.time, 6, 11) && phaseOf(s) <= 3),
    build: (ctx) => {
      const s = ctx.state;
      const cash = 40;
      return menu(
        "Outside the agency",
        [
          "A man beside the door with a clipboard he is not writing on, picking people off the queue before they reach it.",
          `"Four hours, cash today, no forms, no ID. Van's there. Or you can go in and be number thirty-one."`,
        ],
        [
          {
            label: "Get in the van",
            hint: `4 hrs, $${cash}`,
            run: () => {
              ctx.advance(240, { exertion: 1.25 });
              applyDelta(s.meters, { energy: -22, hygiene: -10, hunger: -18, morale: -3 });
              earnCash(s, cash);
              s.flags.workedForTheTout = (s.flags.workedForTheTout ?? 0) + 1;
              pushLog(s, `Four hours off the books for $${cash}.`, "plain");
              return menu(
                "Outside the agency",
                [
                  `Four hours of somebody's yard and $${cash} in notes, and nobody wrote your name down anywhere at any point.`,
                  "Which means nobody can say you worked, either. It does nothing for your standing here and it never will.",
                ],
                [away],
              );
            },
          },
          {
            label: "Go in and be number thirty-one",
            hint: "45 min",
            run: () => {
              ctx.advance(45, { sheltered: true });
              changeReputation(s, 2);
              applyDelta(s.meters, { morale: -2 });
              return menu(
                "Outside the agency",
                [
                  "Forty-five minutes of plastic chair and a form with your name on it, and a woman who says they will call.",
                  "They do call, eventually, and the calls are worth more than the van because they add up.",
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

  /* ------------------------------------------------ Brokedale: the job centre */

  placed("jobCentre", {
    id: "pl_jobCentreWitness",
    weight: at("jobCentre", 4, () => true),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The job centre doors",
        [
          "A woman on the step with a letter, sanctioned four weeks for missing an appointment she says she was early for.",
          `"You were behind me. Were you behind me? Someone was behind me."`,
        ],
        [
          {
            label: "Go back in and say so",
            hint: "30 min",
            run: () => {
              ctx.advance(30, { sheltered: true });
              changeReputation(s, 4);
              applyDelta(s.meters, { morale: +8, energy: -3 });
              s.flags.witnessedTheSanction = 1;
              pushLog(s, "Went back in to witness somebody's appointment time.", "good");
              return menu(
                "The job centre doors",
                [
                  "Thirty minutes to say one sentence to a man who writes it down and says it will be reviewed.",
                  "It gets reviewed. She finds you on the Row six weeks later to tell you so.",
                ],
                [away],
                "good",
              );
            },
          },
          {
            label: "You weren't behind her",
            run: () => {
              applyDelta(s.meters, { morale: -4 });
              return menu(
                "The job centre doors",
                ["You were, though, and you both know it, and she says thanks anyway which is the thing that sticks."],
                [away],
              );
            },
          },
        ],
      );
    },
  }),

  /* ------------------------------------------------------- Brokedale: the gym */

  placed("gym", {
    id: "pl_gymSpot",
    weight: at("gym", 3, (s) => s.meters.energy >= 35),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The free weights",
        [
          "A man under a bar with more on it than there ought to be, catching your eye in the mirror.",
          `"Two minutes. I've got three left in me and I've got nobody."`,
        ],
        [
          {
            label: "Spot him",
            hint: "15 min",
            run: () => {
              ctx.advance(15, { sheltered: true, exertion: 1.1 });
              applyDelta(s.meters, { energy: -4, morale: +7 });
              changeReputation(s, 2);
              return menu(
                "The free weights",
                [
                  "Three reps, and the third one you take about a quarter of, and he does not mention it.",
                  "He spots you back. Nobody here has asked you a single thing about where you sleep.",
                ],
                [away],
                "good",
              );
            },
          },
          {
            label: "You're on the clock",
            run: () => menu("The free weights", ["He racks it without the third rep and puts a plate back on each side, quietly."], [away]),
          },
        ],
      );
    },
  }),

  /* ------------------------------------------------- Brokedale: the doss house */

  placed("dossHouse", {
    id: "pl_dossDoorman",
    weight: at("dossHouse", 4, (s) => hourOf(s.time) >= 20),
    build: (ctx) => {
      const s = ctx.state;
      const kettle = 2;
      return menu(
        "The doss house door",
        [
          "Doors at eleven, says the sign, and it is twenty past ten, and the man on the door has a kettle behind him and a way of standing.",
          `"Two dollars for the kettle and you're in now. Or you're out there till eleven, which is up to you, isn't it."`,
        ],
        [
          s.cash >= kettle
            ? {
                label: `Pay the two dollars`,
                run: () => {
                  s.cash -= kettle;
                  s.flags.paidTheDoorman = (s.flags.paidTheDoorman ?? 0) + 1;
                  applyDelta(s.meters, { morale: -3 });
                  return menu(
                    "The doss house door",
                    [
                      "There is no kettle. There has never been a kettle. You are inside and it is warm and it cost two dollars.",
                      s.flags.paidTheDoorman >= 3 ? "He has stopped explaining what it is for." : "",
                    ].filter(Boolean),
                    [away],
                  );
                },
              }
            : { label: "Pay the two dollars", locked: "You haven't got two dollars" },
          {
            label: "Wait out the forty minutes",
            hint: "40 min",
            run: () => {
              ctx.advance(40);
              applyDelta(s.meters, { energy: -5, morale: -4 });
              return menu(
                "The doss house door",
                ["Forty minutes against a wall in the cold, and at eleven exactly he opens it and does not look at you."],
                [away],
              );
            },
          },
        ],
      );
    },
  }),
];
