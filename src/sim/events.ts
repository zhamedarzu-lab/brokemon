import { zoneAt, type TownId, type ZoneId } from "../world/map";
import { BROKEDALE_EVENTS } from "./events-brokedale";
import { addItem } from "./items";
import { EMPLOYMENT } from "./jobs";
import { applyDelta } from "./meters";
import { menu, type Choice, type Prompt } from "./prompt";
import { changeReputation, checkRequirements, currentAppearance, earnCash, phaseOf, pushLog, reputationIn, townOf, type GameState } from "./state";
import { hourOf } from "./time";
import type { ActionCtx } from "./work";

export interface EventDef {
  id: string;
  /** Relative weight, or 0 to exclude. */
  weight(s: GameState, zone: ZoneId): number;
  build(ctx: ActionCtx): Prompt;
  /** Fire at most once per run. */
  once?: boolean;
}

const close: Choice = { label: "Move on" };

const BROKEMON_EVENTS: EventDef[] = [
  {
    id: "wallet",
    weight: (s, z) => (z === "slums" ? 1 : 3) * (s.flags.walletDone ? 0.2 : 1),
    build: (ctx) => {
      const s = ctx.state;
      const cash = ctx.rng.int(40, 120);
      return menu(
        "A wallet on the pavement",
        [
          "Brown leather, worn soft, half under the kerb.",
          `Inside: $${cash} in notes, a bus pass, and a driving licence with a photo of a tired woman.`,
        ],
        [
          {
            label: "Hand it in",
            hint: "reputation",
            run: () => {
              s.flags.walletDone = 1;
              changeReputation(s, 12);
              applyDelta(s.meters, { morale: +14 });
              ctx.advance(25);
              if (ctx.rng.chance(0.5)) {
                const reward = ctx.rng.int(10, 30);
                earnCash(s, reward);
                pushLog(s, `Returned a lost wallet. Reward: $${reward}.`, "good");
                return menu(
                  "A wallet on the pavement",
                  [
                    "She meets you outside the police station and does not know where to put her hands.",
                    `She presses $${reward} on you and you take it because refusing would be a second favour.`,
                  ],
                  [close],
                  "good",
                );
              }
              pushLog(s, "Returned a lost wallet.", "good");
              return menu(
                "A wallet on the pavement",
                ["The desk sergeant writes your name down.", "Nothing else happens. You feel better than the money would have made you."],
                [close],
                "good",
              );
            },
          },
          {
            label: "Take the cash and drop the wallet in a postbox",
            hint: `$${cash}`,
            run: () => {
              s.flags.walletDone = 1;
              earnCash(s, cash);
              changeReputation(s, -6);
              applyDelta(s.meters, { morale: -12 });
              ctx.advance(10);
              pushLog(s, `Took $${cash} from a found wallet.`, "money");
              if (ctx.rng.chance(0.18)) {
                const fine = 60;
                s.debt += fine;
                changeReputation(s, -10);
                return menu(
                  "A wallet on the pavement",
                  [
                    "There is a camera on the shopfront. There is always a camera on the shopfront.",
                    `A caution and a $${fine} penalty on your record.`,
                  ],
                  [close],
                  "bad",
                );
              }
              return menu(
                "A wallet on the pavement",
                [`$${cash}. You eat tonight.`, "You think about the photo for longer than you want to."],
                [close],
                "money",
              );
            },
          },
          { label: "Leave it where it is", run: () => menu("A wallet on the pavement", ["You keep walking. Someone else's problem, someone else's luck."], [close]) },
        ],
      );
    },
  },

  {
    id: "oldMan",
    weight: (s, z) => (z === "downtown" && phaseOf(s) <= 2 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      applyDelta(s.meters, { morale: -4 });
      return menu(
        "An old man at his gate",
        [
          '"You know what this does to property values? Do you? People like you, on the benches."',
          "He says it to your face as though you are not on the other end of the sentence.",
        ],
        [
          {
            label: '"Sorry."',
            run: () => menu("An old man at his gate", ['He nods, satisfied, and goes back inside.', "You are still standing on the pavement."], [close]),
          },
          {
            label: '"Yeah. It\'s terrible for you."',
            run: () => {
              applyDelta(s.meters, { morale: +8 });
              changeReputation(s, -1);
              return menu("An old man at his gate", ["He blinks. He has never been answered before.", "It costs you nothing and it is the best thing that happens all day."], [close]);
            },
          },
        ],
      );
    },
  },

  {
    id: "teens",
    weight: (s) => (currentAppearance(s) < 30 && hourOf(s.time) >= 19 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Three lads outside the chip shop",
        ["They have decided you are the evening's entertainment.", "One of them is filming."],
        [
          {
            label: "Walk away fast",
            run: () => {
              ctx.advance(15, { exertion: 1.5 });
              applyDelta(s.meters, { energy: -8, morale: -10 });
              return menu("Three lads", ["You get round the corner and they lose interest.", "You are shaking and furious and there is nowhere to put it."], [close], "bad");
            },
          },
          {
            label: "Stand your ground",
            run: () => {
              if (ctx.rng.chance(0.45)) {
                applyDelta(s.meters, { morale: +10 });
                return menu("Three lads", ["You look at the one with the phone until he puts it down.", "They go and find something else."], [close]);
              }
              const lost = Math.min(s.cash, ctx.rng.int(3, 20));
              s.cash -= lost;
              applyDelta(s.meters, { health: -14, morale: -16 });
              pushLog(s, "Jumped outside the chip shop.", "bad");
              const lostLine = lost > 0
                ? `It goes badly. You lose $${lost} and the skin off one hand.`
                : "It goes badly. Nothing to take, so they settle for leaving you on the pavement.";
              return menu("Three lads", [lostLine, "Nobody in the queue looks up."], [close], "bad");
            },
          },
        ],
      );
    },
  },

  {
    id: "shopkeeper",
    weight: (s, z) => (z === "downtown" && currentAppearance(s) >= 30 && hourOf(s.time) >= 20 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      addItem(s.inventory, "sandwich", 2);
      applyDelta(s.meters, { morale: +12 });
      pushLog(s, "Given day-old food at closing time.", "good");
      return menu(
        "Closing time",
        [
          "The woman locking up the deli holds out a paper bag without making it a thing.",
          '"They only go in the bin."',
          "Two sandwiches.",
        ],
        [close],
        "good",
      );
    },
  },

  {
    id: "colleague",
    weight: (s) => (phaseOf(s) === 1 && !s.flags.colleagueDone ? 2 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.colleagueDone = 1;
      return menu(
        "Someone says your name",
        [
          "It's somebody you used to work with. They are carrying a coffee and a lanyard.",
          "They have already done the arithmetic on how you look.",
        ],
        [
          {
            label: "Tell them the truth",
            run: () => {
              applyDelta(s.meters, { morale: -6 });
              changeReputation(s, 4);
              if (ctx.rng.chance(0.4)) {
                s.flags.colleagueNumberGiven = 1;
                return menu("Someone says your name", ['"God. Right."', "They give you their number and mean it."], [close]);
              }
              return menu("Someone says your name", ['"God. Right."', "They say to call them. They do not give you a number."], [close]);
            },
          },
          {
            label: "Say you're between things",
            run: () => {
              applyDelta(s.meters, { morale: -12 });
              return menu("Someone says your name", ['"Between things. Sure."', "They let you have it. That is somehow worse."], [close], "bad");
            },
          },
        ],
      );
    },
  },

  /* --------------------------------------------------- colleague follow-up */
  {
    id: "colleagueCall",
    weight: (s) => (phaseOf(s) === 2 && s.flags.colleagueNumberGiven && !s.flags.colleagueCallDone ? 3 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.colleagueCallDone = 1;
      return menu(
        "Your phone buzzes",
        [
          "It's the colleague. They remembered.",
          '"There\'s a position. Entry-level, but the manager owes me one. Interested?"',
        ],
        [
          {
            label: "Yes — pass on my details",
            run: () => {
              s.flags.colleagueInterviewPending = 1;
              changeReputation(s, 5);
              pushLog(s, "Colleague job lead — interview lined up.", "good");
              return menu(
                "Your phone buzzes",
                [
                  '"Done. You\'ll hear from them — probably Thursday."',
                  "You have an interview. It has been a while since you had one of those.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Thank them and leave it",
            run: () => {
              applyDelta(s.meters, { morale: +6 });
              return menu("Your phone buzzes", ["They understand. Or they say they do.", "Either way, somebody thought of you."], [close]);
            },
          },
        ],
      );
    },
  },

  /* --------------------------------------------------- colleague interview */
  {
    id: "colleagueInterview",
    weight: (s) => (s.flags.colleagueInterviewPending && !s.flags.colleagueInterviewDone ? 4 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.colleagueInterviewDone = 1;
      const look = currentAppearance(s);
      const repOk = reputationIn(s) >= 20;
      const lookOk = look >= 50;

      function onHired(): Prompt {
        const martTier = EMPLOYMENT.martClerk.tier; // 2
        const currentTier = s.employment ? (EMPLOYMENT[s.employment]?.tier ?? 0) : 0;

        if (currentTier >= martTier) {
          // Player is already at this tier or higher — reward without downgrading.
          changeReputation(s, 12);
          applyDelta(s.meters, { morale: +20 });
          earnCash(s, 30);
          pushLog(s, "Interview went well — reputation boost, no job change needed.", "good");
          return menu(
            "The interview",
            [
              '"You\'re clearly already on your feet. Still, it\'s good to know people."',
              "Thirty dollars in expenses, and a handshake that means something.",
              "You are ahead of where this lead was pointing. That is not a bad thing to discover.",
            ],
            [close],
            "good",
          );
        }

        const previous = s.employment;
        s.employment = "martClerk";
        s.strikes = 0;
        changeReputation(s, 12);
        applyDelta(s.meters, { morale: +28 });
        earnCash(s, 30);
        pushLog(s, "Got the job — Mart Clerk. Interview paid off.", "good");
        const lines: string[] = [
          '"We\'ll start you Monday. The badge says TRAINEE, but don\'t let that bother you."',
          "Thirty dollars in expenses and a shift card.",
          "Your name is on a rota. That hasn't happened in a long time.",
        ];

        // The interview reads you on appearance, which a clean face in rags can
        // pass. The till itself has a dress code, and turning up without it is
        // a strike — so say it now rather than let the player find out three
        // strikes later, with the lead already spent.
        const gate = checkRequirements(s, EMPLOYMENT.martClerk.requires);
        if (!gate.ok) {
          pushLog(s, `Mart Clerk starts Monday, but ${gate.reasons[0]}.`, "bad");
          lines.push(
            '"One thing — turn up looking like staff. Thrift shop does a set for fifteen."',
            `You cannot work the shift as you are: ${gate.reasons[0]}.`,
          );
        }
        if (previous) lines.push(`You send a message to ${previous === "nightStock" ? "the night supervisor" : "your old employer"}. Short. Professional.`);
        return menu("The interview", lines, [close], gate.ok ? "good" : "plain");
      }

      function onNearMiss(): Prompt {
        changeReputation(s, 8);
        applyDelta(s.meters, { morale: -6 });
        pushLog(s, "Interview — no offer, but left a decent impression.", "plain");
        return menu(
          "The interview",
          [
            '"We\'re still seeing people. We\'ll be in touch."',
            "The polite version of no.",
            "Your name is known there now. It is not nothing.",
          ],
          [close],
        );
      }

      function onFail(): Prompt {
        changeReputation(s, 3);
        applyDelta(s.meters, { morale: -14 });
        pushLog(s, "Interview went badly.", "bad");
        return menu(
          "The interview",
          [
            "It goes badly from the second question.",
            '"We\'ll keep your details on file." They will not.',
            "You walk out into the street and stand there for a moment.",
            "You showed up. That counts for something, even now.",
          ],
          [close],
          "bad",
        );
      }

      return menu(
        "The interview",
        [
          "A small office above the Mart. The manager has the colleague\'s message open on her phone.",
          "She puts it face-down and looks at you.",
          '"So. Tell me about yourself."',
        ],
        [
          {
            label: lookOk || repOk ? "Come in confident — you know how this works" : "Try to come in confident",
            hint: lookOk || repOk ? "best odds" : "appearance or reputation low",
            run: () => {
              ctx.advance(45, { sheltered: true });
              applyDelta(s.meters, { energy: -6 });
              const baseOdds = 0.55 + (lookOk ? 0.2 : 0) + (repOk ? 0.15 : 0);
              if (ctx.rng.chance(Math.min(0.9, baseOdds))) return onHired();
              return onNearMiss();
            },
          },
          {
            label: "Go in honest — nervous but prepared",
            hint: "moderate odds",
            run: () => {
              ctx.advance(45, { sheltered: true });
              applyDelta(s.meters, { energy: -6, morale: -4 });
              if (ctx.rng.chance(0.52)) return onHired();
              return onNearMiss();
            },
          },
          {
            label: "Wing it — you've got nothing to lose",
            hint: "long shot",
            run: () => {
              ctx.advance(30, { sheltered: true });
              applyDelta(s.meters, { energy: -4 });
              const roll = ctx.rng.next();
              if (roll > 0.72) return onHired();
              if (roll > 0.35) return onNearMiss();
              return onFail();
            },
          },
        ],
      );
    },
  },

  /* --------------------------------------------------- street musician */
  {
    id: "streetMusician",
    // Nobody busks on a private road with a barrier across it.
    weight: (s, z) => (z === "heights" ? 0 : z === "downtown" ? 3 : 2) * (phaseOf(s) <= 2 ? 1 : 0.6),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A man with a guitar case",
        [
          "He's set up outside the library. No hat out, no sign. Just playing.",
          "The kind of old song that assumes you know the words.",
        ],
        [
          {
            label: "Drop a dollar in his case",
            hint: "$1",
            locked: s.cash < 1 ? "You don't have a dollar to spare" : undefined,
            run: () => {
              s.cash -= 1;
              applyDelta(s.meters, { morale: +14 });
              pushLog(s, "Gave a dollar to a street musician.", "plain");
              return menu("A man with a guitar case", ["He nods without breaking the chord.", "Something releases in your chest. It cost a dollar."], [close], "good");
            },
          },
          {
            label: "Stand and listen a while",
            hint: "5 min",
            run: () => {
              ctx.advance(5);
              applyDelta(s.meters, { morale: +8 });
              return menu("A man with a guitar case", ["You stay for one song.", "It's enough."], [close]);
            },
          },
          { label: "Keep walking", run: () => null },
        ],
      );
    },
  },

  /* --------------------------------------------------- overheard tip */
  {
    id: "overheardTip",
    weight: (s, z) => (z === "downtown" && phaseOf(s) <= 2 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const cashGain = ctx.rng.int(5, 18);
      return menu(
        "Two women at a café table",
        [
          "They're talking about a pop-up sale — clothes, household stuff, half price.",
          '"…ends at noon, apparently. Behind the community centre."',
        ],
        [
          {
            label: "Go check it out",
            hint: "15 min",
            run: () => {
              ctx.advance(15, { exertion: 1.1 });
              if (ctx.rng.chance(0.55)) {
                earnCash(s, cashGain);
                applyDelta(s.meters, { morale: +6 });
                pushLog(s, `Pop-up sale find — sold on for $${cashGain}.`, "money");
                return menu("Pop-up sale", [`The tip was good. You flip a jacket for $${cashGain}.`], [close], "money");
              }
              applyDelta(s.meters, { hygiene: +10, morale: +4 });
              return menu("Pop-up sale", ["Too late for the good stuff.", "You get a bar of soap and a towel for nothing, which is not nothing."], [close], "good");
            },
          },
          { label: "Not worth the walk", run: () => null },
        ],
      );
    },
  },

  /* --------------------------------------------------- lost tourist */
  {
    id: "lostTourist",
    // Visitors get as far as the square. Nobody is sightseeing on Route 1.
    weight: (_s, z) => (z === "downtown" ? 3 : z === "heights" ? 1 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A couple with a map",
        [
          "They've got the map upside down. You can tell from ten feet.",
          "They look up and they've already decided you're safe to ask.",
        ],
        [
          {
            label: "Point them the right way",
            run: () => {
              ctx.advance(5);
              applyDelta(s.meters, { morale: +10 });
              pushLog(s, "Helped some tourists find their way.", "good");
              return menu(
                "A couple with a map",
                [
                  "They get there. Two minutes later the man comes jogging back.",
                  '"Thank you so much. Really."',
                  "He means it. That's all.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Shrug and keep moving",
            run: () => menu("A couple with a map", ["They look at their map again. You look at the pavement. Everyone's fine."], [close]),
          },
        ],
      );
    },
  },

  /* --------------------------------------------------- rain shelter */
  {
    id: "rainShelter",
    weight: (s) => (s.weather === "rain" || s.weather === "storm" ? 4 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The sky opens",
        ["It comes down hard and fast, the kind that soaks you before you've registered it's raining."],
        [
          {
            label: "Duck into the nearest doorway",
            hint: "10 min",
            run: () => {
              ctx.advance(10, { sheltered: true });
              applyDelta(s.meters, { morale: +4 });
              return menu("The sky opens", ["You make it. Barely.", "You watch the street empty out from under the awning. Good spot."], [close], "good");
            },
          },
          {
            label: "Keep moving — you're already wet",
            run: () => {
              applyDelta(s.meters, { hygiene: -14, health: -6, morale: -10 });
              return menu("The sky opens", ["By the time it stops you're soaked through.", "Everything feels heavier."], [close], "bad");
            },
          },
        ],
      );
    },
  },

  /* --------------------------------------------------- old boss */
  {
    id: "oldBoss",
    weight: (s, z) => (z === "downtown" && phaseOf(s) >= 2 && phaseOf(s) <= 3 && !s.flags.oldBossDone ? 2 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.oldBossDone = 1;
      const look = currentAppearance(s);
      if (look >= 60) {
        changeReputation(s, 8);
        applyDelta(s.meters, { morale: +10 });
        pushLog(s, "Ran into your old boss. Made a decent impression.", "good");
        return menu(
          "Someone you used to work for",
          [
            "Your old manager. Coming out of a coffee shop.",
            "They look at you, then look again.",
            '"You look well. Things working out?"',
            "You are presentable enough that they mean it.",
          ],
          [
            {
              label: '"Getting there."',
              run: () => {
                changeReputation(s, 4);
                return menu("Someone you used to work for", ["They nod and trade cards.", '"Good. Keep at it."', "They say it like they remember you were worth something."], [close], "good");
              },
            },
            {
              label: "Keep it brief and move on",
              run: () => menu("Someone you used to work for", ["Clean exit. Your name is still intact there."], [close], "good"),
            },
          ],
          "good",
        );
      }
      changeReputation(s, -5);
      applyDelta(s.meters, { morale: -12 });
      pushLog(s, "Ran into your old boss. Awkward.", "bad");
      return menu(
        "Someone you used to work for",
        [
          "Your old manager. Coming out of a coffee shop.",
          "The moment they register you, something crosses their face and is quickly managed.",
          '"Oh. Right. Well —"',
          "There is a lot of pavement between you and they find it fast.",
        ],
        [
          {
            label: "Let them go",
            run: () => menu("Someone you used to work for", ["They go.", "You had forgotten how small that particular feeling was."], [close], "bad"),
          },
        ],
        "bad",
      );
    },
  },

  /* -------------------------------------------- networking happy hour */
  {
    id: "networkingHappyHour",
    weight: (s, z) => (z === "downtown" && phaseOf(s) >= 2 && phaseOf(s) <= 3 && hourOf(s.time) >= 17 && hourOf(s.time) <= 20 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Happy hour",
        [
          "A bar has its doors open and someone is doing a round.",
          '"Come in, come in — it\'s on the house until seven."',
        ],
        [
          {
            label: "Go in for one",
            hint: "30 min",
            run: () => {
              ctx.advance(30, { sheltered: true });
              applyDelta(s.meters, { morale: +18, thirst: +20, energy: -12 });
              changeReputation(s, 2);
              pushLog(s, "Networking happy hour. Two drinks and a business card.", "good");
              return menu(
                "Happy hour",
                [
                  "The drinks are cheap, the company is expensive.",
                  "You leave with a business card you'll probably never use and a name that might ring a bell somewhere.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Not tonight",
            run: () => menu("Happy hour", ["You've got things to do. You don't, but still."], [close]),
          },
        ],
      );
    },
  },

  /* --------------------------------------------------- profile piece */
  {
    id: "profilePiece",
    weight: (s) => (phaseOf(s) >= 3 && !s.flags.profilePieceDone ? 2 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.profilePieceDone = 1;
      return menu(
        "A journalist",
        [
          "A woman with a recorder and a press lanyard steps into your path.",
          '"The paper is running a piece on self-made — would you have five minutes?"',
        ],
        [
          {
            label: "Give her the quote",
            hint: "reputation++",
            run: () => {
              ctx.advance(20);
              changeReputation(s, 20);
              applyDelta(s.meters, { morale: +14 });
              pushLog(s, "Profile piece in the local paper. Reputation up.", "good");
              return menu(
                "A journalist",
                [
                  "You give her four sentences and a handshake.",
                  "Next morning your name is in print above the fold.",
                  "People you have never met know who you are.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Decline — not ready",
            run: () => {
              applyDelta(s.meters, { morale: -4 });
              return menu("A journalist", ["She nods and finds someone else.", "Maybe next time."], [close]);
            },
          },
        ],
      );
    },
  },

  /* --------------------------------------------------- stock tip */
  {
    id: "stockTip",
    weight: (s) => (phaseOf(s) >= 3 && s.cash >= 50 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Anonymous tip",
        [
          "A folded note left on your table at the diner.",
          "A ticker, a time, and the words: \"Trust me.\"",
          "Fifty dollars could triple. Or disappear.",
        ],
        [
          {
            label: "Put $50 in",
            hint: "50/50 · ×3 or lose it",
            locked: s.cash < 50 ? "You need at least $50 to play" : undefined,
            run: () => {
              s.cash -= 50;
              if (ctx.rng.chance(0.5)) {
                const gain = 150;
                earnCash(s, gain);
                applyDelta(s.meters, { morale: +16 });
                pushLog(s, `Stock tip paid off — $${gain}.`, "money");
                return menu("Anonymous tip", ["It triples.", "You sit with the number for a minute before you move on."], [close], "money");
              }
              applyDelta(s.meters, { morale: -10 });
              pushLog(s, "Stock tip — lost $50.", "bad");
              return menu("Anonymous tip", ["It tanks.", "The note is gone. So is the fifty."], [close], "bad");
            },
          },
          {
            label: "Bin it",
            run: () => menu("Anonymous tip", ["You fold it back up and put it in the nearest bin.", "Probably wise."], [close]),
          },
        ],
      );
    },
  },

  /* ------------------------------------------------------------ the filler
   *
   * These three are the connective tissue — short, always-available, no
   * decision to make. They used to carry flat weights and between them took
   * roughly two encounters in five everywhere on the map, including a gated
   * private road where a split bin bag has no business being. They are scarcer
   * now, and scarcer still where they make no sense.
   */

  {
    id: "cans",
    weight: (_s, z) => (z === "slums" ? 3 : z === "downtown" ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const n = ctx.rng.int(2, 5);
      addItem(s.inventory, "recyclables", n);
      return menu("A split bin bag", [`${n} cans and bottles, still with the deposit on them.`], [close]);
    },
  },

  /* ------------------------------------------------------- the outskirts */

  {
    id: "soupRun",
    weight: (s, z) => (z === "slums" && hourOf(s.time) >= 18 && hourOf(s.time) <= 21 && phaseOf(s) <= 2 ? 4 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A van with the back doors open",
        [
          "Two women and an urn, parked where the gravel meets the road.",
          "There is a line, and the line is polite in the way lines here always are.",
        ],
        [
          {
            label: "Join the queue",
            hint: "20 min",
            run: () => {
              ctx.advance(20);
              applyDelta(s.meters, { hunger: +34, thirst: +18, morale: +10 });
              addItem(s.inventory, "sandwich", 1);
              pushLog(s, "Soup run. Hot food and one for the morning.", "good");
              return menu(
                "A van with the back doors open",
                [
                  "Oxtail soup, white bread, tea with three sugars whether you asked or not.",
                  "One of them puts a wrapped sandwich in your pocket for the morning and does not make a thing of it.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Not tonight",
            run: () => menu("A van with the back doors open", ["You walk past close enough to smell it.", "Some nights the queue is the part you cannot do."], [close]),
          },
        ],
      );
    },
  },

  {
    id: "tentCleared",
    weight: (s, z) => (z === "slums" && phaseOf(s) <= 2 && !s.flags.tentClearedDone ? 2 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.tentClearedDone = 1;
      applyDelta(s.meters, { morale: -10 });
      addItem(s.inventory, "recyclables", 3);
      pushLog(s, "The camp under the overpass has been cleared.", "bad");
      return menu(
        "Under the overpass",
        [
          "The camp is gone. Not moved — gone, and the ground swept, and a new sign bolted to the pillar.",
          "Somebody's boots are still there, set neatly side by side against the concrete.",
          "You take the cans out of the bin bag nobody came back for.",
        ],
        [close],
        "bad",
      );
    },
  },

  {
    id: "outreachVan",
    weight: (s, z) => (z === "slums" && (s.sick || s.meters.health < 60) ? 4 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Outreach",
        [
          "A man in a fleece with a lanyard and a clipboard, working the row of benches.",
          '"No forms. I can look at that cough if you want."',
        ],
        [
          {
            label: "Let him look",
            hint: "25 min, free",
            run: () => {
              ctx.advance(25, { sheltered: true });
              s.sick = false;
              applyDelta(s.meters, { health: +26, morale: +8 });
              addItem(s.inventory, "medicine", 1);
              pushLog(s, "Seen by an outreach worker.", "good");
              return menu(
                "Outreach",
                [
                  "He listens to your chest through the fleece, which cannot be regulation.",
                  "A blister pack, a bottle of water, and a number written on the back of a card.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Tell him you're fine",
            run: () => {
              applyDelta(s.meters, { morale: -4 });
              return menu("Outreach", ['"Right you are." He writes something down anyway.', "He leaves the card on the bench beside you."], [close]);
            },
          },
        ],
      );
    },
  },

  {
    id: "sharedBench",
    weight: (s, z) => (z === "slums" && phaseOf(s) <= 2 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The other end of the bench",
        [
          "A woman about sixty, coat over three jumpers, working through a bag of chips.",
          '"You want these? I can never finish them and they go to waste."',
        ],
        [
          {
            label: "Take some and sit a while",
            hint: "20 min",
            run: () => {
              ctx.advance(20);
              applyDelta(s.meters, { hunger: +16, morale: +16, energy: +4 });
              pushLog(s, "Shared a bag of chips with a stranger.", "good");
              return menu(
                "The other end of the bench",
                [
                  "She talks about a son in Carrickfergus and a dog that died in 2019.",
                  "You do not have to say anything, which is the point of it.",
                  "Twenty minutes and neither of you is anybody's problem.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Say no thanks",
            run: () => menu("The other end of the bench", ['"Suit yourself, love."', "She eats the rest and you both watch the road."], [close]),
          },
        ],
      );
    },
  },

  /* ---------------------------------------------------------- market square */

  {
    id: "lunchRush",
    weight: (s, z) => (z === "downtown" && hourOf(s.time) >= 14 && hourOf(s.time) <= 16 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Behind the sandwich place",
        [
          "Three o'clock, and the lad on the afternoon shift is carrying a tray out to the bins.",
          "He sees you see him. Neither of you says anything for a second.",
        ],
        [
          {
            label: "Wait until he's gone back in",
            hint: "10 min",
            run: () => {
              ctx.advance(10);
              addItem(s.inventory, "sandwich", 2);
              applyDelta(s.meters, { morale: -4 });
              pushLog(s, "Two sandwiches off the afternoon tray.", "good");
              return menu(
                "Behind the sandwich place",
                [
                  "He sets the tray on the lid instead of tipping it in, and goes back inside without looking.",
                  "Two, still cold. You are grateful and you would rather not have been.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Just ask him",
            run: () => {
              ctx.advance(5);
              if (ctx.rng.chance(0.6)) {
                addItem(s.inventory, "sandwich", 2);
                addItem(s.inventory, "waterBottle", 1);
                applyDelta(s.meters, { morale: +10 });
                changeReputation(s, 1);
                pushLog(s, "Asked outright, and got fed.", "good");
                return menu("Behind the sandwich place", ['"Take what you want, they only bin it."', "He holds the door with his foot while you fill your hands."], [close], "good");
              }
              applyDelta(s.meters, { morale: -12 });
              return menu("Behind the sandwich place", ['"I\'m not allowed, mate. Sorry."', "He tips the tray in and pulls the lid down, and he is sorry, and that changes nothing."], [close], "bad");
            },
          },
        ],
      );
    },
  },

  {
    id: "library",
    weight: (s, z) => (z === "downtown" && (s.meters.energy < 45 || s.weather === "rain" || s.weather === "storm" || s.weather === "cold") ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The public library",
        [
          "Warm, quiet, and the only building on the square that does not want anything from you.",
          "There is a rack of newspapers on poles and a chair nobody is using.",
        ],
        [
          {
            label: "Sit with a paper for an hour",
            hint: "1h, free",
            run: () => {
              ctx.advance(60, { sheltered: true, exertion: 0.4 });
              applyDelta(s.meters, { energy: +16, morale: +12 });
              pushLog(s, "An hour in the library.", "good");
              return menu(
                "The public library",
                [
                  "Nobody asks you for anything. Nobody asks you to leave.",
                  "You read four pages about a bypass consultation and fall asleep for ten minutes and no alarm goes off.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Use the computers",
            hint: "45 min",
            run: () => {
              ctx.advance(45, { sheltered: true, exertion: 0.4 });
              applyDelta(s.meters, { energy: +6, morale: +6 });
              changeReputation(s, 2);
              pushLog(s, "Forty-five minutes on a library computer.", "good");
              return menu(
                "The public library",
                [
                  "Forty-five minutes on a machine with a keyboard worn blank in the usual places.",
                  "You put your name into three application forms and one of them even has a box for an address you do not have.",
                ],
                [close],
                "good",
              );
            },
          },
          { label: "Keep walking", run: () => null },
        ],
      );
    },
  },

  {
    id: "marketTrader",
    weight: (s, z) => (z === "downtown" && phaseOf(s) <= 2 && hourOf(s.time) >= 7 && hourOf(s.time) <= 11 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const pay = ctx.rng.int(14, 26);
      return menu(
        "A man setting up a stall",
        [
          "Crates of fruit, a van half-unloaded, and a back that has clearly had enough.",
          `"Hour of your time and I'll see you right. ${`$${pay}`}, cash, now."`,
        ],
        [
          {
            label: "Take it",
            hint: `1h, $${pay}`,
            run: () => {
              ctx.advance(60, { exertion: 2.0 });
              applyDelta(s.meters, { energy: -14, hygiene: -8, thirst: -12, hunger: -8, morale: +6 });
              earnCash(s, pay);
              changeReputation(s, 2);
              addItem(s.inventory, "trashFood", 1);
              pushLog(s, `An hour on the market stall — $${pay}.`, "money");
              return menu(
                "A man setting up a stall",
                [
                  "An hour of crates. He talks the whole time and expects nothing back.",
                  `$${pay} and a bag of the apples that will not last the day.`,
                  '"Same time Thursday, if you\'re about."',
                ],
                [close],
                "money",
              );
            },
          },
          { label: "Pass", run: () => menu("A man setting up a stall", ['"Fair enough." He goes back to the crates.'], [close]) },
        ],
      );
    },
  },

  {
    id: "chugger",
    weight: (s, z) => (z === "downtown" && currentAppearance(s) >= 45 && hourOf(s.time) >= 10 && hourOf(s.time) <= 17 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A clipboard, coming your way",
        [
          "Bright tabard, practised smile, already angling to cut you off at the crossing.",
          '"Have you got two minutes for children\'s hospices?"',
        ],
        [
          {
            label: '"I have got about four pounds to my name."',
            run: () => {
              applyDelta(s.meters, { morale: +6 });
              return menu(
                "A clipboard, coming your way",
                [
                  "The smile drops into something that is actually a smile.",
                  '"God, sorry. Have a good one, yeah?"',
                  "Being taken for someone worth asking is not nothing.",
                ],
                [close],
              );
            },
          },
          {
            label: "Sign up for £3 a month",
            hint: "$3",
            locked: s.cash < 3 ? "You do not have it" : undefined,
            run: () => {
              s.cash -= 3;
              applyDelta(s.meters, { morale: +14 });
              changeReputation(s, 2);
              pushLog(s, "Signed up to a direct debit you cannot really afford.", "plain");
              return menu(
                "A clipboard, coming your way",
                [
                  "You give a name and an address that is a hostel and she writes both down without a flicker.",
                  "Three pounds a month. You will notice it. You do it anyway.",
                ],
                [close],
                "good",
              );
            },
          },
          { label: "Cross the road", run: () => null },
        ],
      );
    },
  },

  {
    id: "pitchDispute",
    weight: (s, z) => (z === "downtown" && phaseOf(s) === 1 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Somebody is on your corner",
        [
          "A lad, maybe twenty, sleeping bag round his shoulders like a cape, sitting exactly where you sit.",
          "He has clocked you and he is not moving.",
        ],
        [
          {
            label: "Tell him it's your spot",
            run: () => {
              if (ctx.rng.chance(0.4)) {
                applyDelta(s.meters, { morale: -6 });
                changeReputation(s, -2);
                return menu("Somebody is on your corner", ["He goes, swearing, slowly, making sure you watch him do it.", "You get the corner. It does not feel like winning."], [close]);
              }
              applyDelta(s.meters, { morale: -14, energy: -6 });
              return menu("Somebody is on your corner", ['"There\'s no your spot, mate."', "He is right, and you both know he is right, and you walk on."], [close], "bad");
            },
          },
          {
            label: "Sit down the other end and split the traffic",
            run: () => {
              ctx.advance(15);
              applyDelta(s.meters, { morale: +8 });
              changeReputation(s, 2);
              pushLog(s, "Shared the corner.", "plain");
              return menu(
                "Somebody is on your corner",
                [
                  "You take the far end by the bins. Neither of you does as well as one of you would have.",
                  "He tells you which of the shops will let you use the toilet. You tell him about the community centre showers.",
                  "That trade is worth more than the corner was.",
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

  /* ---------------------------------------------------------- the heights */

  {
    id: "gardenCrew",
    weight: (_s, z) => (z === "heights" ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const pay = ctx.rng.int(20, 40);
      return menu(
        "A landscaping crew",
        [
          "Three men and a chipper, taking a hedge down to the wood at the top of the drive.",
          "The foreman looks at you and decides you are with the agency.",
          '"You on the leaves? Go on then, an hour."',
        ],
        [
          {
            label: "Don't correct him",
            hint: `1h, $${pay}`,
            run: () => {
              ctx.advance(60, { exertion: 2.1 });
              applyDelta(s.meters, { energy: -16, hygiene: -12, thirst: -14, morale: +4 });
              earnCash(s, pay);
              pushLog(s, `An hour on somebody else's hedge — $${pay}.`, "money");
              return menu(
                "A landscaping crew",
                [
                  "An hour of leaves into bags, and one of them shares a flask with you without being asked.",
                  `The foreman pays you out of a tin and does not write your name anywhere. $${pay}.`,
                ],
                [close],
                "money",
              );
            },
          },
          {
            label: "Tell him you're not with anyone",
            run: () => {
              changeReputation(s, 1);
              applyDelta(s.meters, { morale: -4 });
              return menu(
                "A landscaping crew",
                ['"Ah. Right you are."', "He goes back to the hedge. It costs you an hour's pay and you are not certain why you did it."],
                [close],
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "doorbellCamera",
    weight: (s, z) => (z === "heights" && currentAppearance(s) < 80 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      applyDelta(s.meters, { morale: -6 });
      return menu(
        "A doorbell that talks",
        [
          "You are four steps past the gate when the little camera above it swivels and a voice comes out of it.",
          '"Can I help you? I can see you. I have recorded this."',
          "There is nobody home. There is nobody anywhere. The house is talking to you from an app.",
        ],
        [
          {
            label: "Keep walking",
            run: () => menu("A doorbell that talks", ["You keep walking. It says it again to your back, slightly louder."], [close], "bad"),
          },
          {
            label: "Wave at it",
            run: () => {
              applyDelta(s.meters, { morale: +10 });
              return menu("A doorbell that talks", ["You wave.", "It has nothing for that. The little light goes off."], [close]);
            },
          },
        ],
      );
    },
  },

  {
    id: "galaLetOut",
    weight: (s, z) => (z === "heights" && hourOf(s.time) >= 21 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const smart = currentAppearance(s) >= 75;
      return menu(
        "A house emptying out",
        [
          "Cars on the verge for two hundred yards and a marquee lit up behind the hedge.",
          "People are coming out in twos, laughing at the temperature.",
          smart ? "Dressed as you are, nobody looks twice." : "A man glances at you and then very deliberately does not.",
        ],
        [
          {
            label: smart ? "Go in the way they're coming out" : "Try walking in",
            hint: smart ? "good odds" : "long shot",
            run: () => {
              if (!smart && !ctx.rng.chance(0.2)) {
                applyDelta(s.meters, { morale: -12 });
                changeReputation(s, -2);
                return menu("A house emptying out", ["You get eleven feet up the drive.", "Somebody in a headset is very polite and very immovable."], [close], "bad");
              }
              ctx.advance(40, { sheltered: true });
              applyDelta(s.meters, { hunger: +40, thirst: +25, morale: +18 });
              changeReputation(s, 6);
              pushLog(s, "Walked into a charity gala on the way out.", "good");
              return menu(
                "A house emptying out",
                [
                  "Forty minutes of canapés off a tray and a conversation about a marina.",
                  "You say almost nothing and three people give you a card.",
                  "Nobody asks who invited you. It does not occur to them that it is a question.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Watch from the verge and move on",
            run: () => {
              applyDelta(s.meters, { morale: -4 });
              return menu("A house emptying out", ["You stand across the road for a minute in the cold.", "Then you go, because standing there is the sort of thing that gets a van sent out."], [close]);
            },
          },
        ],
      );
    },
  },

  /* ------------------------------------------------- once you are somebody */

  {
    id: "oldFriendAsks",
    weight: (s, z) => (z !== "heights" && phaseOf(s) >= 3 && !s.flags.oldFriendAsksDone ? 3 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.oldFriendAsksDone = 1;
      const ask = 200;
      return menu(
        "Somebody from the shelter",
        [
          "You know him from the shelter. He knows you from the shelter.",
          "He has clocked the coat and the shoes and the fact that you are coming out of a building rather than standing beside one.",
          '"I would not ask. You know I would not ask."',
        ],
        [
          {
            label: `Give him $${ask}`,
            hint: `$${ask}`,
            locked: s.cash < ask ? `You are not carrying $${ask}` : undefined,
            run: () => {
              s.cash -= ask;
              applyDelta(s.meters, { morale: +20 });
              changeReputation(s, 10);
              pushLog(s, `Gave $${ask} to someone from the shelter.`, "money");
              return menu(
                "Somebody from the shelter",
                [
                  "He takes it and puts it away fast, the way you used to.",
                  '"I\'ll get it back to you." He will not, and you both know that, and it is not the point.',
                  "You remember the exact bench you were sitting on when somebody did this for you.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Buy him a hot meal instead",
            hint: "$16",
            locked: s.cash < 16 ? "You cannot even do that" : undefined,
            run: () => {
              s.cash -= 16;
              ctx.advance(45, { sheltered: true });
              applyDelta(s.meters, { hunger: +30, morale: +12 });
              changeReputation(s, 5);
              pushLog(s, "Bought an old shelter acquaintance a meal.", "good");
              return menu(
                "Somebody from the shelter",
                [
                  "You sit down opposite him for forty-five minutes, which is worth more to him than the meal and less than the money.",
                  "He talks about a hostel place coming up. You listen, and you know exactly how likely it is.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Tell him you can't",
            run: () => {
              applyDelta(s.meters, { morale: -18 });
              changeReputation(s, -4);
              pushLog(s, "Turned down someone from the shelter.", "bad");
              return menu(
                "Somebody from the shelter",
                [
                  '"No, course. Course."',
                  "He is out of your way before you have finished the sentence, and he is careful not to make it awkward, which is the worst part.",
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
    id: "coldCall",
    weight: (s) => (phaseOf(s) >= 3 && s.bank + s.investments >= 500 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const stake = Math.min(400, Math.max(100, Math.round((s.bank + s.cash) * 0.2)));
      return menu(
        "A number you don't recognise",
        [
          "A young man with a headset voice and your name already in his mouth.",
          '"We are only approaching a small number of people in your bracket."',
          `He would like $${stake} to start.`,
        ],
        [
          {
            label: `Put $${stake} in`,
            hint: "he is very confident",
            locked: s.cash + s.bank < stake ? "Not liquid enough" : undefined,
            run: () => {
              const fromCash = Math.min(s.cash, stake);
              s.cash -= fromCash;
              s.bank -= stake - fromCash;
              if (ctx.rng.chance(0.3)) {
                const back = Math.round(stake * 1.8);
                s.bank += back;
                applyDelta(s.meters, { morale: +10 });
                pushLog(s, `The cold-call investment actually paid — $${back}.`, "money");
                return menu("A number you don't recognise", [`It comes back at $${back}.`, "He rings again a week later and you let it go to voicemail."], [close], "money");
              }
              changeReputation(s, -2);
              pushLog(s, `Lost $${stake} to a cold caller.`, "bad");
              return menu(
                "A number you don't recognise",
                ["The number stops working on the Thursday.", `$${stake}, gone the way it was always going to go.`, "You knew. You did it anyway, which is its own kind of information."],
                [close],
                "bad",
              );
            },
          },
          {
            label: "Hang up",
            run: () => {
              applyDelta(s.meters, { morale: +4 });
              return menu("A number you don't recognise", ["You hang up in the middle of his second sentence.", "Money you have kept is money you have made."], [close]);
            },
          },
        ],
      );
    },
  },

  {
    id: "councilNotice",
    weight: (s, z) => (z === "downtown" && (s.mayor || s.businessOwned) ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A notice on the lamp post",
        [
          "A planning application, cable-tied to the post at eye height, weather already getting into it.",
          "PROPOSED: removal of benches, Market Square, on grounds of antisocial behaviour.",
          s.mayor ? "It is your council. Your name is at the bottom of it." : "It has the look of a thing that will go through unopposed.",
        ],
        [
          {
            label: "Object",
            hint: "20 min",
            run: () => {
              ctx.advance(20);
              changeReputation(s, s.mayor ? 8 : 4);
              applyDelta(s.meters, { morale: +14 });
              pushLog(s, "Objected to the removal of the benches.", "good");
              return menu(
                "A notice on the lamp post",
                [
                  "You write four lines on the form and give an address that has a door on it, which is the reason they will read it.",
                  "You know precisely which bench. You know how the armrest sits.",
                ],
                [close],
                "good",
              );
            },
          },
          {
            label: "Leave it",
            run: () => {
              applyDelta(s.meters, { morale: -12 });
              return menu("A notice on the lamp post", ["You read it twice and walk on.", "The benches come out in March."], [close], "bad");
            },
          },
        ],
      );
    },
  },

  /* -------------------------------------------------------- weather & hour */

  {
    id: "coldSnapCoat",
    weight: (s) => (s.weather === "cold" && phaseOf(s) <= 2 && !s.flags.coatDone ? 5 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.coatDone = 1;
      applyDelta(s.meters, { morale: +18, health: +8 });
      addItem(s.inventory, "poncho", 1);
      pushLog(s, "Given a coat in the cold snap.", "good");
      return menu(
        "A carrier bag held out at arm's length",
        [
          "A man in a parked car with the engine running winds the window down and holds out a bag.",
          '"It does not fit me any more. Genuinely."',
          "It is a good coat. It fits.",
        ],
        [close],
        "good",
      );
    },
  },

  {
    id: "bakeryBack",
    weight: (s, z) => (z === "downtown" && hourOf(s.time) >= 4 && hourOf(s.time) <= 7 ? 4 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The back of the bakery",
        [
          "Half five, and the extractor is pushing out heat and the smell of the first batch.",
          "You could stand in that for a while and nobody would say anything.",
        ],
        [
          {
            label: "Stand in the warm air",
            hint: "15 min",
            run: () => {
              ctx.advance(15, { sheltered: true });
              applyDelta(s.meters, { morale: +10, energy: +6 });
              return menu("The back of the bakery", ["Fifteen minutes of somebody else's heat.", "Your hands come back. It is the best part of the day and it is free."], [close], "good");
            },
          },
          {
            label: "Knock",
            run: () => {
              ctx.advance(5);
              if (ctx.rng.chance(0.5)) {
                addItem(s.inventory, "sandwich", 1);
                applyDelta(s.meters, { hunger: +20, morale: +12 });
                pushLog(s, "The baker handed something out the back door.", "good");
                return menu("The back of the bakery", ["She hands out yesterday's, in a bag, and shuts the door before you can do the thanking.", "Still warm from the room, not the oven. It counts."], [close], "good");
              }
              applyDelta(s.meters, { morale: -8 });
              return menu("The back of the bakery", ["Nobody comes.", "You stand in the heat a minute longer and then you go."], [close]);
            },
          },
        ],
      );
    },
  },

  {
    id: "offer",
    weight: (s, z) => (z === "slums" && phaseOf(s) <= 2 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const pay = ctx.rng.int(60, 140);
      return menu(
        "A man with a van",
        [
          '"Two hours. Moving boxes. Cash."',
          "He does not say what is in the boxes and you do not ask, which is the arrangement.",
          `$${pay}.`,
        ],
        [
          {
            label: "Get in",
            hint: `$${pay}`,
            run: () => {
              ctx.advance(120, { exertion: 2.2 });
              applyDelta(s.meters, { energy: -30, hygiene: -15, hunger: -18, thirst: -20 });
              if (ctx.rng.chance(0.22)) {
                changeReputation(s, -8);
                const fine = 120;
                s.debt += fine;
                pushLog(s, "The van job went wrong.", "bad");
                return menu("A man with a van", ["There is a police car at the second address.", `You are not charged, but you are known now, and it costs you $${fine}.`], [close], "bad");
              }
              earnCash(s, pay);
              pushLog(s, `Cash job — $${pay}.`, "money");
              return menu("A man with a van", [`Two hours, no questions, $${pay} in twenties.`, "He does not offer you a lift back."], [close], "money");
            },
          },
          { label: "Pass", run: () => menu("A man with a van", ["He shrugs and drives to the next corner along."], [close]) },
        ],
      );
    },
  },

  {
    id: "dog",
    weight: (_s, z) => (z === "downtown" ? 3 : 2),
    build: (ctx) => {
      const s = ctx.state;
      applyDelta(s.meters, { morale: +9 });
      return menu(
        "A dog",
        [
          "A dog comes over, leans its whole weight against your leg, and stays there.",
          "Its owner apologises. You tell them it's fine.",
          "It is the only thing all day that came towards you.",
        ],
        [close],
      );
    },
  },

  {
    id: "sprinklers",
    weight: (s, z) => (z === "downtown" && hourOf(s.time) === 6 ? 6 : 0),
    build: (ctx) => {
      const s = ctx.state;
      applyDelta(s.meters, { hygiene: +6, morale: -8, health: -3 });
      return menu("Six AM", ["The sprinklers come on. They are timed for exactly this.", "You are soaked to the knee before you are properly awake."], [close], "bad");
    },
  },

  {
    id: "recruiter",
    weight: (s, z) => (z === "downtown" && phaseOf(s) >= 2 && s.education >= 1 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      changeReputation(s, 3);
      return menu(
        "A card in your hand",
        [
          "A woman from a staffing agency works the square with a lanyard and a fistful of cards.",
          "She gives you one and actually looks at you while she does it.",
          "Your name is worth slightly more in this town than it was this morning.",
        ],
        [close],
        "good",
      );
    },
  },

  /* --------------------------------------------------------- fire barrel */
  {
    id: "fireBarrel",
    weight: (s, z) => (z === "slums" && (s.weather === "cold" || hourOf(s.time) < 7 || hourOf(s.time) >= 21) ? 4 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A barrel fire in the lot",
        ["Three men and a woman standing around a cut oil drum, doing the maths on how cold it is.", "Nobody invited you. Nobody didn't."],
        [
          {
            label: "Join them",
            hint: "30 min",
            run: () => {
              ctx.advance(30);
              applyDelta(s.meters, { morale: +16, energy: +8, health: +4 });
              pushLog(s, "Stood around a fire with strangers.", "good");
              return menu("A barrel fire in the lot", ["You stand with your hands out and say nothing for half an hour.", "Neither does anyone else. That is the whole thing."], [close], "good");
            },
          },
          { label: "Keep walking", run: () => null },
        ],
      );
    },
  },

  /* -------------------------------------------------------- church meal */
  {
    id: "churchMeal",
    weight: (s, z) => (z === "slums" && phaseOf(s) <= 2 && hourOf(s.time) >= 12 && hourOf(s.time) <= 14 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A sign: HOT LUNCH, FREE, ALL WELCOME",
        ["A Baptist church with the doors propped open and the smell of mashed potato coming out.", "No forms. No sermon. Just food."],
        [
          {
            label: "Go in",
            hint: "30 min, free",
            run: () => {
              ctx.advance(30, { sheltered: true });
              applyDelta(s.meters, { hunger: +48, thirst: +20, morale: +14, energy: +8 });
              addItem(s.inventory, "sandwich", 1);
              pushLog(s, "Hot lunch at the church hall. Free and no questions.", "good");
              return menu("A sign: HOT LUNCH, FREE, ALL WELCOME", ["Mash, beef gravy, green beans from a tin, tea, a slice of white bread.", "The woman who serves you calls you love and means it.", "A sandwich for later, wrapped in foil."], [close], "good");
            },
          },
          { label: "Not today", run: () => null },
        ],
      );
    },
  },

  /* ------------------------------------------------ transit card found */
  {
    id: "foundTransitCard",
    weight: (s, z) => ((z === "downtown" || z === "slums") && !s.flags.foundTransitDone ? 2 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.foundTransitDone = 1;
      const credit = ctx.rng.int(8, 28);
      return menu(
        "A transit card on the pavement",
        ["Tapped out of someone's pocket. The balance display reads when you hold it under the reader."],
        [
          {
            label: `Keep it — $${credit} credit on there`,
            hint: "free rides",
            run: () => {
              applyDelta(s.meters, { morale: +6 });
              pushLog(s, `Found a transit card with $${credit} in credit. Rides sorted for a while.`, "good");
              return menu("A transit card on the pavement", [`$${credit} of someone else's commute.`, "You ride for free until it runs out."], [close], "good");
            },
          },
          {
            label: "Hand it in to the station",
            hint: "reputation",
            run: () => {
              ctx.advance(20);
              changeReputation(s, 6);
              applyDelta(s.meters, { morale: +10 });
              pushLog(s, "Handed in a found transit card.", "good");
              return menu("A transit card on the pavement", ["The man at the desk looks at you like you have done something unusual.", "You have."], [close], "good");
            },
          },
        ],
      );
    },
  },

  /* --------------------------------------------------- lost dog reunite */
  {
    id: "lostDog",
    weight: (_s, z) => (z === "slums" || z === "downtown" ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A dog without a person",
        ["Collar on, lead trailing, looking at you like you might be the one."],
        [
          {
            label: "Catch it and find the owner",
            hint: "25 min",
            run: () => {
              ctx.advance(25, { exertion: 1.3 });
              applyDelta(s.meters, { energy: -6, morale: +18 });
              if (ctx.rng.chance(0.7)) {
                const reward = ctx.rng.int(10, 35);
                earnCash(s, reward);
                changeReputation(s, 4);
                pushLog(s, `Returned a lost dog — $${reward} reward.`, "money");
                return menu("A dog without a person", ["The owner is half a street away in a panic.", `They press $${reward} on you and you take it.`, '"She does this every time," they say, not to you, to the dog.'], [close], "money");
              }
              changeReputation(s, 4);
              pushLog(s, "Returned a lost dog.", "good");
              return menu("A dog without a person", ["You find a woman on the next street calling a name.", '"God. Thank you."', "No money. The thank-you is real."], [close], "good");
            },
          },
          { label: "Leave it — it knows where it lives", run: () => menu("A dog without a person", ["It watches you go. You watch it back.", "Someone else's problem and someone else's dog."], [close]) },
        ],
      );
    },
  },

  /* ---------------------------------------------------- alley shortcut */
  {
    id: "alleyShortcut",
    weight: (s, z) => (z === "slums" && phaseOf(s) <= 2 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A cut-through",
        ["A gap between two buildings you've never gone down. Probably saves five minutes. Probably."],
        [
          {
            label: "Take it",
            run: () => {
              if (ctx.rng.chance(0.7)) {
                applyDelta(s.meters, { energy: +4, morale: +6 });
                return menu("A cut-through", ["It goes straight through. There's a mural on one wall you've never seen before.", "Five minutes saved and something new in your day."], [close], "good");
              }
              const lost = Math.min(s.cash, ctx.rng.int(5, 20));
              s.cash -= lost;
              applyDelta(s.meters, { morale: -14, energy: -8 });
              if (lost > 0) pushLog(s, `Lost $${lost} in a bad shortcut.`, "bad");
              return menu("A cut-through", [lost > 0 ? `Two of them. $${lost} lighter.` : "Two of them. Nothing to take.", "You get out the other end and keep moving."], [close], "bad");
            },
          },
          { label: "Go around", run: () => null },
        ],
      );
    },
  },

  /* ---------------------------------------------------- food truck sample */
  {
    id: "foodTruckSample",
    weight: (s, z) => (z === "downtown" && hourOf(s.time) >= 11 && hourOf(s.time) <= 15 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      applyDelta(s.meters, { hunger: +14, morale: +8 });
      return menu(
        "Free samples",
        ["A food truck is doing a launch. The lad out front has a tray and no pride left."],
        [
          {
            label: "Take one. Take two.",
            run: () => {
              applyDelta(s.meters, { hunger: +10, morale: +4 });
              return menu("Free samples", ["He doesn't even clock you. You are just someone with a hand out.", "That is the whole pitch."], [close], "good");
            },
          },
          { label: "Take one, move on", run: () => menu("Free samples", ["A small square of something. It's good. Doesn't matter what it is."], [close], "good") },
        ],
      );
    },
  },

  /* -------------------------------------------------- hold a sign */
  {
    id: "holdSign",
    weight: (s, z) => (z === "downtown" && phaseOf(s) <= 2 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const pay = ctx.rng.int(10, 18);
      return menu(
        "A man with a sandwich board",
        ['"I need someone for an hour. Cash now."', `$${pay} to stand outside a shop with a sign. He does not look like he has a plan B.`],
        [
          {
            label: `Take it — $${pay}, 1h`,
            hint: `1h, $${pay}`,
            run: () => {
              ctx.advance(60, { exertion: 0.7 });
              applyDelta(s.meters, { energy: -4, morale: -6 });
              earnCash(s, pay);
              pushLog(s, `An hour holding a sign — $${pay}.`, "money");
              return menu("A man with a sandwich board", [`Sixty minutes of holding a board and being looked through.`, `$${pay} cash, no receipt.`, '"Same time next week?" You say sure, knowing you will not be there.'], [close], "money");
            },
          },
          { label: "Pass", run: () => null },
        ],
      );
    },
  },

  /* --------------------------------------------------- street chess */
  {
    id: "chessTable",
    weight: (s, z) => (z === "downtown" && hourOf(s.time) >= 9 && hourOf(s.time) <= 18 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The chess tables",
        ["An old man is sitting alone at the permanent board with the pieces already out.", "He looks up."],
        [
          {
            label: "Sit across from him",
            hint: "45 min",
            run: () => {
              ctx.advance(45, { sheltered: false, exertion: 0.3 });
              applyDelta(s.meters, { morale: +14, energy: +4 });
              if (ctx.rng.chance(0.4)) {
                earnCash(s, 5);
                pushLog(s, "Won $5 at the chess table.", "money");
                return menu("The chess tables", ["He plays fast and says nothing.", "You win by attrition. He puts a five-dollar note on the board.", '"Tomorrow," he says. It means he will be here. It means you could be too.'], [close], "money");
              }
              return menu("The chess tables", ["He takes you apart in thirty moves without looking particularly interested.", '"Again?"', "He means it as a compliment."], [close]);
            },
          },
          { label: "Not today", run: () => null },
        ],
      );
    },
  },

  /* --------------------------------------------------- paper bag on bench */
  {
    id: "paperBagBench",
    weight: (s, z) => ((z === "slums" || z === "downtown") && phaseOf(s) <= 2 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      addItem(s.inventory, "sandwich", 2);
      applyDelta(s.meters, { morale: +10 });
      pushLog(s, "Food left on a bench — 'for anyone'.", "good");
      return menu(
        "A paper bag on the bench",
        ["A brown paper bag with a folded note on top.", '"For anyone who needs it."', "Two sandwiches, a packet of crisps, a small orange juice. Still cold."],
        [close],
        "good",
      );
    },
  },

  /* ----------------------------------------------- shared umbrella */
  {
    id: "umbrellaShare",
    weight: (s) => (s.weather === "rain" || s.weather === "storm" ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Caught in it",
        ["A woman under a large umbrella at the bus stop tilts it sideways without being asked."],
        [
          {
            label: "Step under",
            hint: "5 min",
            run: () => {
              ctx.advance(5, { sheltered: true });
              applyDelta(s.meters, { morale: +16 });
              return menu("Caught in it", ["You stand just close enough not to be wet.", "Neither of you says anything. The bus comes. She goes. That's all it was."], [close], "good");
            },
          },
          { label: "Walk on in the rain", run: () => { applyDelta(s.meters, { hygiene: -8, morale: -6 }); return menu("Caught in it", ["You're wet before the end of the road."], [close], "bad"); } },
        ],
      );
    },
  },

  /* ----------------------------------------------- window washing offer */
  {
    id: "windowWashing",
    weight: (s, z) => (z === "downtown" && phaseOf(s) <= 2 && hourOf(s.time) >= 8 && hourOf(s.time) <= 11 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const pay = ctx.rng.int(12, 22);
      return menu(
        "A shop owner with a bucket",
        ['"I\'ve got three storefronts and a bad back. Twenty minutes a window."', `He names $${pay} for all three like it's an opening offer.`],
        [
          {
            label: `Take it — $${pay}, ~1h`,
            hint: `$${pay}`,
            run: () => {
              ctx.advance(55, { exertion: 1.6 });
              applyDelta(s.meters, { energy: -10, hygiene: -6, morale: +6 });
              earnCash(s, pay);
              pushLog(s, `Window washing — $${pay}.`, "money");
              return menu("A shop owner with a bucket", [`Three windows, squeegee and a chamois, $${pay} cash.`, '"Same deal Fridays, if you want."'], [close], "money");
            },
          },
          { label: "Pass", run: () => null },
        ],
      );
    },
  },

  /* ------------------------------------------- bus driver waves you on */
  {
    id: "busDriverKind",
    weight: (s, z) => ((z === "slums" || z === "downtown") && phaseOf(s) <= 2 && !s.flags.busDriverDone ? 2 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.busDriverDone = 1;
      applyDelta(s.meters, { morale: +18, energy: +12 });
      pushLog(s, "Bus driver waved you on without paying.", "good");
      return menu(
        "The number nine",
        ["You step on and start explaining.", "He waves his hand at the machine.", '"Sit down, mate."', "You take a seat. You ride for forty minutes. Nobody says anything."],
        [close],
        "good",
      );
    },
  },

  /* --------------------------------------------- marathon / charity run */
  {
    id: "marathonRoute",
    weight: (_s, z) => (z === "downtown" && !_s.flags.marathonDone ? 1 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.marathonDone = 1;
      return menu(
        "Road closed",
        ["The square is blocked off with barriers. A charity run is coming through.", "Volunteers at a table have too many bananas and isotonic drinks."],
        [
          {
            label: "Grab a drink and a banana",
            run: () => {
              applyDelta(s.meters, { hunger: +20, thirst: +28, morale: +10 });
              addItem(s.inventory, "waterBottle", 1);
              return menu("Road closed", ["They're giving it to every jogger who passes.", "You are not jogging.", "Nobody checks."], [close], "good");
            },
          },
          {
            label: "Volunteer for an hour",
            hint: "1h",
            run: () => {
              ctx.advance(60, { exertion: 0.8, sheltered: false });
              applyDelta(s.meters, { morale: +22, thirst: +15, hunger: +15 });
              changeReputation(s, 4);
              addItem(s.inventory, "sandwich", 1);
              pushLog(s, "Volunteered at a charity run.", "good");
              return menu("Road closed", ["You hand out cups for an hour.", "At the end the team lead gives you a lunch box and says you were great.", "You were. You handed out cups perfectly."], [close], "good");
            },
          },
          { label: "Find a way around", run: () => null },
        ],
      );
    },
  },

  /* -------------------------------------------- free health screening */
  {
    id: "popupClinic",
    weight: (s, z) => (z === "downtown" && (s.sick || s.meters.health < 70) ? 4 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Free health screening",
        ["A folding table outside the pharmacy. A nurse with a blood pressure cuff and a stack of leaflets.", '"No appointment. Two minutes."'],
        [
          {
            label: "Stop",
            hint: "15 min, free",
            run: () => {
              ctx.advance(15, { sheltered: false });
              s.sick = false;
              applyDelta(s.meters, { health: +18, morale: +10 });
              pushLog(s, "Free health screening on the street.", "good");
              return menu("Free health screening", ['"Blood pressure\'s a bit up. Drink more water, eat if you can."', "She gives you a leaflet and a bottle of water from under the table.", "You walk away knowing slightly more about your body than you did."], [close], "good");
            },
          },
          { label: "Keep walking", run: () => null },
        ],
      );
    },
  },

  /* ----------------------------------------------- refused entry café */
  {
    id: "cafeRefusal",
    weight: (s, z) => (z === "downtown" && currentAppearance(s) < 35 && phaseOf(s) <= 2 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      applyDelta(s.meters, { morale: -12 });
      return menu(
        "The café",
        ['"Sorry — customers only."', "You are not carrying a drink. You have not sat down. You are standing in the doorway out of the cold.", "He means it."],
        [
          {
            label: "Go",
            run: () => menu("The café", ["You go.", "You stand in the doorway for one more second, which is the wrong call, and then you go."], [close], "bad"),
          },
          {
            label: '"I was just checking the menu."',
            run: () => {
              applyDelta(s.meters, { morale: +6 });
              return menu("The café", ['"The menu\'s outside."', "He's right. You take the small victory anyway."], [close]);
            },
          },
        ],
        "bad",
      );
    },
  },

  /* ---------------------------------------------- protest passes through */
  {
    id: "protestPasses",
    weight: (_s, z) => (z === "downtown" ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A march coming down the road",
        ["Two hundred people, a sound system on a flatbed, banners about housing and rents.", "They fill the whole road. Cars stopped. People watching from windows."],
        [
          {
            label: "Join in for a few blocks",
            hint: "20 min",
            run: () => {
              ctx.advance(20, { exertion: 1.1 });
              applyDelta(s.meters, { morale: +20, energy: -8 });
              changeReputation(s, 3);
              pushLog(s, "Marched with the housing protest.", "good");
              return menu("A march coming down the road", ["You fall in at the back.", "Someone gives you a banner to carry.", "It says HOMES NOT PROFITS.", "You carry it for twenty minutes and mean it."], [close], "good");
            },
          },
          {
            label: "Watch from the pavement",
            run: () => {
              applyDelta(s.meters, { morale: +8 });
              return menu("A march coming down the road", ["You stand and watch it go by.", "It is the noisiest thing that happens all week."], [close]);
            },
          },
          { label: "Cross the road when there's a gap", run: () => null },
        ],
      );
    },
  },

  /* ---------------------------------------------- busker you recognize */
  {
    id: "buskerRequest",
    weight: (_s, z) => (z === "downtown" ? 2 : 1),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A woman with a violin",
        ["She's outside the post office with the case open.", "She looks up and says she'll play anything you want."],
        [
          {
            label: "Name something",
            hint: "5 min",
            run: () => {
              ctx.advance(5);
              applyDelta(s.meters, { morale: +20 });
              return menu("A woman with a violin", ["She plays it.", "You did not expect her to actually know it.", "You stand there the whole way through and people walk around you."], [close], "good");
            },
          },
          {
            label: "Drop whatever you have",
            hint: s.cash >= 2 ? "$2" : "nothing",
            run: () => {
              const gave = Math.min(s.cash, 2);
              s.cash -= gave;
              applyDelta(s.meters, { morale: +12 });
              return menu("A woman with a violin", ["She nods without stopping.", "It costs you what it costs you."], [close]);
            },
          },
          { label: "Keep walking", run: () => null },
        ],
      );
    },
  },

  /* ----------------------------------------- giveDirections to stranger */
  {
    id: "giveDirections",
    weight: (s, z) => (z !== "heights" && currentAppearance(s) >= 25 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Excuse me",
        ['"Do you know where the bus station is?"', "They've asked you. They've chosen you."],
        [
          {
            label: "Point them right",
            run: () => {
              applyDelta(s.meters, { morale: +10 });
              return menu("Excuse me", ['"Thank you so much."', "They go. You watch them get it right.", "Small thing. Right thing."], [close], "good");
            },
          },
          { label: "Tell them you don't know", run: () => menu("Excuse me", ["They smile and try the next person.", "You know where it is."], [close]) },
        ],
      );
    },
  },

  /* ---------------------------------------------- half-finished coffee */
  {
    id: "halfCoffee",
    weight: (s, z) => (z === "downtown" && phaseOf(s) <= 2 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A coffee cup on a wall",
        ["A takeaway cup, still steaming, left balanced on a low wall.", "Somebody's name on it in marker. Not yours."],
        [
          {
            label: "Drink it",
            run: () => {
              applyDelta(s.meters, { thirst: +18, morale: +10, energy: +10 });
              return menu("A coffee cup on a wall", ["Flat white, one sugar. Still hot.", "Somebody had good taste and somewhere to be."], [close], "good");
            },
          },
          { label: "Leave it", run: () => menu("A coffee cup on a wall", ["You walk past it.", "It takes something."], [close]) },
        ],
      );
    },
  },

  /* ----------------------------------------------- scratch card found */
  {
    id: "scratchCard",
    weight: (s, z) => ((z === "slums" || z === "downtown") && phaseOf(s) <= 3 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A scratch card on the ground",
        ["Face-down, unscratched. One of the two-dollar ones from the newsagent."],
        [
          {
            label: "Scratch it",
            run: () => {
              const roll = ctx.rng.next();
              if (roll < 0.1) {
                applyDelta(s.meters, { morale: +22 });
                pushLog(s, "Scratch card — winner. Non-cashable promo.", "good");
                return menu("A scratch card on the ground", ["Winner.", "You check it twice. You check it a third time.", "Non-cashable promotional ticket. Of course."], [close], "good");
              }
              if (roll < 0.45) {
                applyDelta(s.meters, { morale: +6 });
                return menu("A scratch card on the ground", ["Breakeven — a free ticket.", "You are oddly pleased.", "You leave it on the rack for someone else."], [close]);
              }
              applyDelta(s.meters, { morale: -4 });
              return menu("A scratch card on the ground", ["Nothing.", "It never had anything on it. You knew that."], [close]);
            },
          },
          { label: "Leave it", run: () => null },
        ],
      );
    },
  },

  /* -------------------------------------------- film crew on the street */
  {
    id: "movieShoot",
    weight: (_s, z) => (z === "downtown" && !_s.flags.movieShootDone ? 1 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.movieShootDone = 1;
      return menu(
        "Lights and a camera rig",
        ["A film crew has taken over half the square.", "A runner with a clipboard asks if you want to be a background extra. Twenty dollars for two hours."],
        [
          {
            label: "Say yes",
            hint: "2h, $20",
            run: () => {
              ctx.advance(120, { sheltered: true, exertion: 0.5 });
              applyDelta(s.meters, { energy: +6, morale: +22 });
              earnCash(s, 20);
              changeReputation(s, 2);
              pushLog(s, "Background extra on a film shoot — $20.", "money");
              return menu("Lights and a camera rig", ["They put you in a jacket and tell you to walk past the camera like you live here.", "You do.", "Twenty dollars and craft services. You eat three of the small pastries.", "Somewhere in a film nobody will see, you are crossing a road."], [close], "money");
            },
          },
          { label: "Ignore it", run: () => null },
        ],
      );
    },
  },

  /* ----------------------------------------- bus stop tea share */
  {
    id: "busStopTea",
    weight: (s, z) => ((z === "slums" || z === "downtown") && (s.weather === "cold" || s.weather === "rain") ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The bus shelter",
        ["A man about seventy with a thermos flask and no bus to wait for.", '"Have a cup. It\'s no trouble."'],
        [
          {
            label: "Sit with him",
            hint: "15 min",
            run: () => {
              ctx.advance(15, { sheltered: true });
              applyDelta(s.meters, { thirst: +20, morale: +18, energy: +6 });
              return menu("The bus shelter", ["Strong tea, powdered milk, one sugar.", "He talks about the road when it was unpaved.", "You listen. It costs nothing. He needed to tell someone."], [close], "good");
            },
          },
          {
            label: "Take a cup and move on",
            run: () => {
              applyDelta(s.meters, { thirst: +14, morale: +10 });
              return menu("The bus shelter", ['"Take it warm."', "You do."], [close], "good");
            },
          },
        ],
      );
    },
  },

  /* ------------------------------------------- package at wrong address */
  {
    id: "packageWrongDoor",
    weight: (s, z) => (z === "heights" && !s.flags.packageDone ? 2 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.packageDone = 1;
      return menu(
        "A parcel on the wrong step",
        ["Number 14, addressed to number 41.", "Nobody home at either. You're the only one who's noticed."],
        [
          {
            label: "Move it to the right address",
            hint: "reputation",
            run: () => {
              ctx.advance(15);
              changeReputation(s, 8);
              applyDelta(s.meters, { morale: +12 });
              pushLog(s, "Moved a misdelivered parcel to the right house.", "good");
              return menu("A parcel on the wrong step", ["Nobody sees you do it.", "That's not why you do it."], [close], "good");
            },
          },
          { label: "None of your business", run: () => menu("A parcel on the wrong step", ["You keep walking.", "It will sort itself out. They always do."], [close]) },
        ],
      );
    },
  },

  /* ----------------------------------------- dog walker needs extra hand */
  {
    id: "dogWalkExtra",
    weight: (_s, z) => (z === "heights" ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const pay = ctx.rng.int(14, 28);
      return menu(
        "Five dogs and one woman",
        ["She has a lead in each hand and one round her wrist and she is losing.", '"I just need someone to take two of them to the park. It\'s five minutes."'],
        [
          {
            label: `Do it — $${pay}`,
            hint: `$${pay}`,
            run: () => {
              ctx.advance(30, { exertion: 1.2 });
              applyDelta(s.meters, { morale: +16, energy: -6 });
              earnCash(s, pay);
              pushLog(s, `Walked two dogs in the Heights — $${pay}.`, "money");
              return menu("Five dogs and one woman", ["Two large labradors who want to go in different directions.", `$${pay} and she asks if you can do Tuesdays.`], [close], "money");
            },
          },
          { label: "No thanks", run: () => null },
        ],
      );
    },
  },

  /* -------------------------------------------- estate agent / for sale */
  {
    id: "estateAgentBoard",
    weight: (s, z) => (z === "heights" && phaseOf(s) <= 2 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      applyDelta(s.meters, { morale: -6 });
      return menu(
        "FOR SALE",
        ["Seven bedrooms. Gravel drive.", "A number in the window with more digits than you've seen in one place.", "There is a picture of the kitchen on the sign."],
        [
          {
            label: "Look at it",
            run: () => {
              applyDelta(s.meters, { morale: -4 });
              return menu("FOR SALE", ["You look at it for a long time.", "The kitchen has an island and a wine rack and a door to a garden.", "You've eaten out of bins this week.", "Both of those things are true at the same time."], [close], "bad");
            },
          },
          {
            label: "Walk on fast",
            run: () => menu("FOR SALE", ["You don't look at it.", "You still know what it said."], [close]),
          },
        ],
      );
    },
  },

  /* ----------------------------------------- street preacher */
  {
    id: "streetPreacher",
    weight: (_s, z) => (z === "downtown" ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A man with a sign",
        ['"THE ANSWER IS LOVE," it says, in red paint.', "He is not aggressive about it. He is just standing there with his sign, which is the whole argument."],
        [
          {
            label: '"Agree to disagree."',
            run: () => {
              applyDelta(s.meters, { morale: +6 });
              return menu("A man with a sign", ["He smiles. You smile back.", '"God bless you."', "He means it. You walk on."], [close]);
            },
          },
          {
            label: "Stop and talk",
            hint: "15 min",
            run: () => {
              ctx.advance(15);
              applyDelta(s.meters, { morale: +14 });
              return menu("A man with a sign", ["He talks about forgiveness for twenty minutes.", "Not fire. Not blame. Just the possibility that things can be set right.", "You don't believe everything he says.", "You believe the part about things being set right."], [close], "good");
            },
          },
          { label: "Keep walking", run: () => null },
        ],
      );
    },
  },

  /* ----------------------------------------- cyclist near miss */
  {
    id: "cyclistNearMiss",
    weight: (_s, z) => (z === "downtown" ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "On the pavement",
        ["A cyclist doing about twenty, on the pavement, looking at their phone.", "They swerve at the last second."],
        [
          {
            label: '"Oi!"',
            run: () => {
              applyDelta(s.meters, { morale: -4 });
              return menu("On the pavement", ["They do not look back.", "You stand in the middle of the pavement with your heart going.", "Nothing happened. Something nearly did."], [close], "bad");
            },
          },
          { label: "Don't react", run: () => { applyDelta(s.meters, { morale: -6 }); return menu("On the pavement", ["You let it go.", "You let everything go eventually."], [close]); } },
        ],
      );
    },
  },

  /* ---------------------------------------- skip full of stuff */
  {
    id: "skipTreasure",
    weight: (s, z) => ((z === "downtown" || z === "slums") && phaseOf(s) <= 2 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A skip outside a flat",
        ["Someone is clearing out. The skip is full and some of it is still good.", "A duvet. A chair. A box of kitchen stuff."],
        [
          {
            label: "Have a look",
            hint: "10 min",
            run: () => {
              ctx.advance(10, { exertion: 1.2 });
              applyDelta(s.meters, { hygiene: -4 });
              if (ctx.rng.chance(0.6)) {
                const cash = ctx.rng.int(5, 22);
                earnCash(s, cash);
                addItem(s.inventory, "recyclables", 2);
                pushLog(s, `Skip find — sold for $${cash}.`, "money");
                return menu("A skip outside a flat", [`A small lamp, some tools, a jacket in decent condition.`, `You take what you can carry and sell the rest for $${cash}.`], [close], "money");
              }
              addItem(s.inventory, "recyclables", 2);
              applyDelta(s.meters, { morale: -4 });
              return menu("A skip outside a flat", ["A lot of damp cardboard and broken flatpack.", "Two recyclables worth keeping.", "You take them."], [close]);
            },
          },
          { label: "Keep moving", run: () => null },
        ],
      );
    },
  },

  /* ----------------------------------------- birthday party on the street */
  {
    id: "birthdayParty",
    weight: (s, z) => ((z === "slums" || z === "downtown") && hourOf(s.time) >= 14 && hourOf(s.time) <= 18 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Balloons on a lamp post",
        ["A kid's birthday in the front garden, spilling onto the pavement.", "A table of food, a paddling pool, someone's mum with too much cake."],
        [
          {
            label: "Walk through — they won't mind",
            run: () => {
              applyDelta(s.meters, { morale: +12, hunger: +10 });
              return menu("Balloons on a lamp post", ["Nobody minds. Someone\'s gran pushes a slice of cake into your hand.", '"Go on, there\'s loads."', "There is loads. It is good cake."], [close], "good");
            },
          },
          { label: "Go around", run: () => null },
        ],
      );
    },
  },

  /* ----------------------------------------- payphone still works */
  {
    id: "payphone",
    weight: (s, z) => ((z === "downtown" || z === "slums") && !s.flags.payphoneDone ? 2 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.payphoneDone = 1;
      return menu(
        "A phone box",
        ["Still working. The light is on.", "You cannot remember the last time you saw one of these that worked."],
        [
          {
            label: "Pick it up",
            run: () => {
              applyDelta(s.meters, { morale: +6 });
              return menu("A phone box", ["The dial tone.", "You hold it for a moment.", "You can call anyone. You do not call anyone.", "You hang it back up and walk out."], [close]);
            },
          },
          {
            label: "Call someone",
            hint: "free",
            run: () => {
              applyDelta(s.meters, { morale: +16 });
              return menu("A phone box", ["You think of someone and you call them.", "It rings four times and goes to voicemail.", '"Hey, it\'s me. I\'m okay. Just wanted to say."', "You hang up. That was enough."], [close], "good");
            },
          },
        ],
      );
    },
  },

  /* ---------------------------------------- watching someone else refused */
  {
    id: "witnessRefusal",
    weight: (s, z) => (z === "downtown" && phaseOf(s) >= 2 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "In the queue",
        ["The man at the counter looks at the person in front of you, then at the machine, then back.", '"I need to ask you to step aside."', "The person steps aside.", "You know that look. You have been that person."],
        [
          {
            label: "Say nothing",
            run: () => {
              applyDelta(s.meters, { morale: -10 });
              return menu("In the queue", ["You say nothing.", "They take your order. You walk out with it.", "You think about it for the rest of the afternoon."], [close], "bad");
            },
          },
          {
            label: "Offer to buy them something",
            hint: "$8",
            locked: s.cash < 8 ? "You don't have it" : undefined,
            run: () => {
              s.cash -= 8;
              applyDelta(s.meters, { morale: +16 });
              changeReputation(s, 5);
              pushLog(s, "Bought something for a stranger who was turned away.", "good");
              return menu("In the queue", ['"I\'ll get one for both of us."', "They look at you. You look at the menu.", "You know exactly what it's like to be them. That is the whole reason."], [close], "good");
            },
          },
        ],
      );
    },
  },

  /* ------------------------------------------- coworker sympathy */
  {
    id: "coworkerSympathy",
    weight: (s) => (s.employment !== null && s.employment !== undefined && phaseOf(s) >= 2 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "After the shift",
        ["A coworker you barely know stops you on the way out.", '"Hey — you doing alright? You seem like you\'ve got a lot on."'],
        [
          {
            label: "Tell them a bit",
            run: () => {
              applyDelta(s.meters, { morale: +14 });
              changeReputation(s, 3);
              return menu("After the shift", ["You say enough.", "They listen properly — no phone, no nodding off into the distance.", '"That\'s a lot. Let me know if you need anything."', "They mean it. Maybe they can't deliver it. They mean it."], [close], "good");
            },
          },
          {
            label: '"I\'m fine, thanks."',
            run: () => {
              applyDelta(s.meters, { morale: +4 });
              return menu("After the shift", ['"Sure. See you tomorrow."', "You meant to say more.", "Tomorrow."], [close]);
            },
          },
        ],
      );
    },
  },

  /* -------------------------------------------- someone drops groceries */
  {
    id: "droppedGroceries",
    weight: (_s, z) => (z !== "heights" ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Bag splits",
        ["A woman with too many bags. The bottom goes and it all goes.", "Tins rolling into the road. An egg situation developing."],
        [
          {
            label: "Help her",
            hint: "5 min",
            run: () => {
              ctx.advance(5);
              applyDelta(s.meters, { morale: +12 });
              if (ctx.rng.chance(0.4)) {
                addItem(s.inventory, "trashFood", 1);
                return menu("Bag splits", ['"God, you\'re a lifesaver."', "She presses a tin of soup on you. You take it.", '"I got three of them, I don\'t need three."', "You do need three. One of you does."], [close], "good");
              }
              changeReputation(s, 2);
              return menu("Bag splits", ['"Thank you so much."', "You get it all back into the bag.", "She goes. You go.", "There was an egg. It survived."], [close], "good");
            },
          },
          { label: "Keep walking", run: () => null },
        ],
      );
    },
  },

  /* ----------------------------------------- early morning bin lorry */
  {
    id: "binLorry",
    weight: (s) => (hourOf(s.time) >= 6 && hourOf(s.time) <= 9 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "The bin lorry",
        ["It turns the corner and you are the only other person on the street.", "Two men on the back, fluorescent jackets, moving faster than you'd think.", "One of them nods at you."],
        [
          {
            label: "Nod back",
            run: () => {
              applyDelta(s.meters, { morale: +10 });
              return menu("The bin lorry", ["You nod back.", "That was it.", "It was enough."], [close]);
            },
          },
          { label: "Keep your head down", run: () => null },
        ],
      );
    },
  },

  /* ----------------------------------------- shop offers cash for help */
  {
    id: "shopHelp",
    weight: (s, z) => (z === "downtown" && phaseOf(s) <= 3 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const pay = ctx.rng.int(10, 20);
      return menu(
        "A delivery arrived",
        ['"Whoever you are — I need someone to shift boxes for half an hour."', `The shop owner is blocking the pavement with pallets. $${pay}.`],
        [
          {
            label: `Do it — $${pay}`,
            hint: `30 min, $${pay}`,
            run: () => {
              ctx.advance(30, { exertion: 1.8 });
              applyDelta(s.meters, { energy: -8, hygiene: -4, morale: +8 });
              earnCash(s, pay);
              pushLog(s, `Shifted boxes for a shop — $${pay}.`, "money");
              return menu("A delivery arrived", [`Thirty minutes, eighteen boxes.`, `$${pay} cash and a bottle of water.`, '"You free tomorrow?" You say you\'ll see.'], [close], "money");
            },
          },
          { label: "Not now", run: () => null },
        ],
      );
    },
  },

  /* ----------------------------------------- overheard argument - useful info */
  {
    id: "overheardArgument",
    weight: (s, z) => (z === "downtown" && phaseOf(s) >= 2 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Two men outside a café",
        ["They're arguing about the rent on a unit above the laundromat.", "One of them doesn\'t want it.", '"It\'s going begging," the other one says.', "You file it away."],
        [
          {
            label: "Go ask about it",
            hint: "might lead somewhere",
            run: () => {
              ctx.advance(20);
              if (ctx.rng.chance(0.5)) {
                changeReputation(s, 6);
                applyDelta(s.meters, { morale: +8 });
                pushLog(s, "Overheard lead — useful contact made.", "good");
                return menu("Two men outside a café", ["The man is still there.", "You introduce yourself and he shakes your hand.", "He writes a name on a receipt and tells you to use it."], [close], "good");
              }
              applyDelta(s.meters, { morale: -4 });
              return menu("Two men outside a café", ["He's already gone.", "The other one looks at you.", '"Private conversation, mate."', "You go."], [close]);
            },
          },
          { label: "Keep it to yourself", run: () => null },
        ],
      );
    },
  },

  /* ---------------------------------------- security camera follows you */
  {
    id: "cameraFollows",
    weight: (s, z) => ((z === "heights" || z === "downtown") && currentAppearance(s) < 45 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      applyDelta(s.meters, { morale: -10 });
      return menu(
        "The camera",
        ["You look up.", "The council camera on the lamp post is pointing at you.", "You didn't do anything.", "It doesn't care."],
        [
          {
            label: "Walk on normally",
            run: () => menu("The camera", ["You walk on.", "It turns to follow you.", "You walk faster."], [close], "bad"),
          },
          {
            label: "Look right at it",
            run: () => {
              applyDelta(s.meters, { morale: +8 });
              return menu("The camera", ["You stop and look directly into it for five seconds.", "Then you go.", "It cannot make anything of that."], [close]);
            },
          },
        ],
      );
    },
  },

  /* ---------------------------------------- someone's cooking outside */
  {
    id: "outdoorGrill",
    weight: (s, z) => (z === "slums" && hourOf(s.time) >= 16 && hourOf(s.time) <= 20 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "Someone grilling in the lot",
        ["A man with a portable grill and a folding table has claimed the corner of the lot.", "He is cooking chicken and he is not being quiet about it."],
        [
          {
            label: "Ask if he\'s selling",
            run: () => {
              if (ctx.rng.chance(0.5)) {
                const cost = 4;
                if (s.cash >= cost) {
                  s.cash -= cost;
                  applyDelta(s.meters, { hunger: +40, morale: +18 });
                  pushLog(s, `$${cost} for a plate of chicken.`, "money");
                  return menu("Someone grilling in the lot", ['"Four dollars, one plate."', "Jerk chicken, rice, coleslaw from a plastic tub.", "It\'s the best thing you\'ve eaten all week and it was four dollars."], [close], "good");
                }
                applyDelta(s.meters, { morale: -8 });
                return menu("Someone grilling in the lot", ['"Four dollars."', "You don\'t have four dollars.", "You walk away from the smell."], [close], "bad");
              }
              applyDelta(s.meters, { hunger: +24, morale: +16 });
              pushLog(s, "Given food from a grill in the lot.", "good");
              return menu("Someone grilling in the lot", ['"Nah, just go. Have a plate."', "He loads one up and hands it over without making eye contact.", "You eat it standing up. It\'s perfect."], [close], "good");
            },
          },
          { label: "Keep moving", run: () => { applyDelta(s.meters, { morale: -4 }); return menu("Someone grilling in the lot", ["You walk past it.", "The smell follows you for three streets."], [close]); } },
        ],
      );
    },
  },

  /* ----------------------------------------- water from a standpipe */
  {
    id: "outdoorSpigot",
    weight: (s, z) => (z === "slums" && s.meters.thirst < 50 ? 3 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "An outside tap",
        ["On the side of a building. The kind attached to a garden around back.", "Unlocked. Running cold."],
        [
          {
            label: "Drink",
            hint: "free",
            run: () => {
              applyDelta(s.meters, { thirst: +38, hygiene: +4 });
              return menu("An outside tap", ["Cold and clean and free.", "You drink until it hurts and then a bit more."], [close], "good");
            },
          },
          {
            label: "Drink and wash your hands",
            hint: "5 min",
            run: () => {
              ctx.advance(5);
              applyDelta(s.meters, { thirst: +38, hygiene: +14, morale: +6 });
              return menu("An outside tap", ["Cold and clean.", "Your hands are warmer after than before, which makes no sense and is true anyway."], [close], "good");
            },
          },
        ],
      );
    },
  },

  /* ----------------------------------------- photo of you requested */
  {
    id: "photographerAsk",
    weight: (s, z) => (z === "downtown" && phaseOf(s) <= 2 && !s.flags.photographerDone ? 1 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.photographerDone = 1;
      return menu(
        "A photographer",
        [`"I'm doing a project on the neighbourhood. Could I take your portrait?"`, "She has a proper camera. She's already looked at you properly, which is different from being looked at."],
        [
          {
            label: "Yes",
            run: () => {
              ctx.advance(15);
              applyDelta(s.meters, { morale: +18 });
              changeReputation(s, 4);
              pushLog(s, "Had your portrait taken for a photography project.", "good");
              return menu("A photographer", ["She takes three shots.", '"Can I get your first name?"', "You tell her.", '"Thank you. Really."', "Somewhere you exist in a photograph taken by someone who asked your name first."], [close], "good");
            },
          },
          {
            label: "No",
            run: () => {
              applyDelta(s.meters, { morale: -4 });
              return menu("A photographer", ['"Of course. No worries."', "She moves on. You watch her ask someone else.", "Some days you do not want to be documented. This is one of them."], [close]);
            },
          },
        ],
      );
    },
  },

  /* ------------------------------------------ found a library card */
  {
    id: "foundLibraryCard",
    weight: (s, z) => (z === "downtown" && !s.flags.libraryCardDone ? 1 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.libraryCardDone = 1;
      return menu(
        "A library card on the pavement",
        ["It has a name on it.", "You could hand it in, or you could use it — the library doesn\'t check photo ID for the computers."],
        [
          {
            label: "Use it at the library",
            run: () => {
              ctx.advance(60, { sheltered: true, exertion: 0.4 });
              applyDelta(s.meters, { morale: +14, energy: +10 });
              changeReputation(s, 2);
              pushLog(s, "An hour in the library on a borrowed card.", "good");
              return menu("A library card on the pavement", ["An hour of warm and free internet.", "Three job applications and a news article you actually finish.", "You put the card back on the desk on your way out."], [close], "good");
            },
          },
          {
            label: "Hand it in",
            hint: "reputation",
            run: () => {
              changeReputation(s, 5);
              applyDelta(s.meters, { morale: +8 });
              pushLog(s, "Handed in a lost library card.", "good");
              return menu("A library card on the pavement", ["The librarian notes it down and smiles.", '"That was kind of you."', "It was. You needed to do something kind today."], [close], "good");
            },
          },
        ],
      );
    },
  },

  /* ----------------------------------------- job board tip from stranger */
  {
    id: "strangerJobTip",
    weight: (s, z) => (z !== "heights" && phaseOf(s) <= 2 && !s.flags.strangerJobTipDone ? 2 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.strangerJobTipDone = 1;
      return menu(
        "A tip",
        ['"The recycling depot is taking people on. Cash, no questions, seven till noon."', "A man you have never met, saying it to you like he\'s been asked to pass it on."],
        [
          {
            label: "Thank him and note it",
            run: () => {
              changeReputation(s, 3);
              applyDelta(s.meters, { morale: +12 });
              pushLog(s, "A stranger passed on a work tip.", "good");
              return menu("A tip", ["He nods and goes. You\'ve got somewhere to be in the morning.", "That is not a small thing."], [close], "good");
            },
          },
          { label: "Nod and move on", run: () => menu("A tip", ["You take it in.", "You\'ll see if it pans out."], [close]) },
        ],
      );
    },
  },

  /* ---------------------------------------- charity collection dispute */
  {
    id: "charityDisp",
    weight: (s, z) => (z === "downtown" && phaseOf(s) >= 3 ? 2 : 0),
    build: (ctx) => {
      const s = ctx.state;
      return menu(
        "A collection box",
        ["A young woman rattling a tin outside the community centre.", '"Anything helps."', "She\'s been there four hours. You can tell."],
        [
          {
            label: "Put in $5",
            hint: "$5",
            locked: s.cash < 5 ? "You can\'t cover it" : undefined,
            run: () => {
              s.cash -= 5;
              applyDelta(s.meters, { morale: +14 });
              changeReputation(s, 3);
              pushLog(s, "Donated $5 to a street collection.", "good");
              return menu("A collection box", ['"Thank you so much."', "She looks at you like you\'ve solved something.", "You haven\'t. Five dollars.", "It still counts."], [close], "good");
            },
          },
          {
            label: '"I\'ve been where you\'re collecting for."',
            run: () => {
              applyDelta(s.meters, { morale: +10 });
              changeReputation(s, 2);
              return menu("A collection box", ["She stops rattling the tin.", '"Oh."', "She looks at you properly.", '"I didn\'t know — thank you for telling me that."', "You don\'t give money. You give it the weight it deserves."], [close], "good");
            },
          },
          { label: "Walk past", run: () => null },
        ],
      );
    },
  },

  /* ---------------------------------------- overheard: a room going free */
  {
    id: "overheardRoom",
    weight: (s, z) => (z === "slums" && phaseOf(s) === 1 && !s.flags.overheardRoomDone ? 2 : 0),
    once: true,
    build: (ctx) => {
      const s = ctx.state;
      s.flags.overheardRoomDone = 1;
      return menu(
        "Two women at a gate",
        ["One of them says the bloke in the top flat has done a runner.", '"Landlord doesn\'t know yet. It\'ll be up Friday."', "She says it to her friend but she\'s looking at you."],
        [
          {
            label: "Ask about it",
            run: () => {
              applyDelta(s.meters, { morale: +14 });
              changeReputation(s, 4);
              pushLog(s, "Got a tip on a room going free.", "good");
              return menu("Two women at a gate", ["The first woman gives you the landlord\'s name.", '"He\'s alright. Not the worst."', "You have a name. That\'s more than you had."], [close], "good");
            },
          },
          { label: "Say nothing", run: () => null },
        ],
      );
    },
  },

];

/** Steps between encounter rolls. */
/**
 * Odds that a step which has earned an encounter actually produces one.
 *
 * Lives here rather than in the renderer because the walking rig has to roll
 * the same number: it was written down twice, the game moved to 0.28, the rig
 * stayed on 0.4, and every encounter figure the rig printed was a figure about
 * a game nobody was playing.
 */
export const EVENT_CHANCE = 0.28;

export const EVENT_STEP_INTERVAL = 40;

/**
 * Recency-cooldown constants.
 * An event seen within COOLDOWN_FULL_MIN minutes has its weight multiplied by
 * COOLDOWN_DECAY_FACTOR.  The multiplier recovers linearly to 1.0 by
 * COOLDOWN_RECOVER_MIN minutes after the last sighting.
 */
export const COOLDOWN_FULL_MIN = 60;
export const COOLDOWN_RECOVER_MIN = 180;
export const COOLDOWN_DECAY_FACTOR = 0.2;

/**
 * Return the weight multiplier (0.2 → 1.0) for an event based on how recently
 * it was last seen.  The last-seen timestamp is stored in s.flags as
 * `ev_last:<id>` (absolute in-game minute).
 */
function cooldownMultiplier(s: GameState, id: string): number {
  const lastSeen = s.flags[`ev_last:${id}`];
  if (!lastSeen) return 1;
  const elapsed = s.time - lastSeen;
  if (elapsed >= COOLDOWN_RECOVER_MIN) return 1;
  if (elapsed <= COOLDOWN_FULL_MIN) return COOLDOWN_DECAY_FACTOR;
  // Linear recovery between COOLDOWN_FULL_MIN and COOLDOWN_RECOVER_MIN.
  const t = (elapsed - COOLDOWN_FULL_MIN) / (COOLDOWN_RECOVER_MIN - COOLDOWN_FULL_MIN);
  return COOLDOWN_DECAY_FACTOR + t * (1 - COOLDOWN_DECAY_FACTOR);
}

/**
 * How many of the most recent encounters are barred outright. The cooldown
 * multiplier alone still let a cheap filler event come up twice running, which
 * is the repetition a player actually notices — two split bin bags in a row
 * reads as a broken game however good the long-run distribution is.
 */
export const NO_REPEAT_WINDOW = 2;

/**
 * The last few events seen, most recent first — but only those still inside
 * the full-decay window. Something you ran into three hours ago is handled by
 * the multiplier; it does not need barring as well.
 */
function recentIds(s: GameState, n: number): string[] {
  const seen: Array<[string, number]> = [];
  for (const key of Object.keys(s.flags)) {
    if (!key.startsWith("ev_last:")) continue;
    const at = s.flags[key]!;
    if (s.time - at <= COOLDOWN_FULL_MIN) seen.push([key.slice("ev_last:".length), at]);
  }
  return seen
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id]) => id);
}

/**
 * One pool per town, and no sharing.
 *
 * The weight functions only ever saw a zone, so once Brokedale had districts
 * of its own every Brokemon encounter fell through their ternaries and fired
 * there: a bin lorry on Route 1, the lads outside the chip shop, and the man
 * with the guitar case, all in a city forty minutes away. Sixteen of them, on
 * a measured run.
 *
 * A town's encounters are part of what the town *is*, so they live with it.
 */
const POOLS: Record<TownId, EventDef[]> = {
  brokemon: BROKEMON_EVENTS,
  brokedale: BROKEDALE_EVENTS,
};

export function rollEvent(ctx: ActionCtx): Prompt | null {
  const s = ctx.state;
  const zone = zoneAt(townOf(s), s.player.pos.y).id;
  const fired: Record<string, number> = s.flags;

  const available = POOLS[s.player.town].filter((e) => !(e.once && fired[`ev:${e.id}`]));
  const barred = new Set(recentIds(s, NO_REPEAT_WINDOW));

  const weigh = (pool: EventDef[]) =>
    pool.map((e) => [e, e.weight(s, zone) * cooldownMultiplier(s, e.id)] as const);

  // Try without the last couple of encounters first. If that leaves nothing
  // this zone can offer, fall back to the full pool rather than show nothing.
  const fresh = available.filter((e) => !barred.has(e.id));
  const picked = ctx.rng.weighted(weigh(fresh)) ?? ctx.rng.weighted(weigh(available));
  if (!picked) return null;

  if (picked.once) fired[`ev:${picked.id}`] = 1;
  // Record the last-seen time for cooldown tracking (skip once-only events —
  // they can never repeat, so cooldown is irrelevant).
  if (!picked.once) fired[`ev_last:${picked.id}`] = s.time;
  return picked.build(ctx);
}