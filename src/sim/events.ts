import { zoneAt, type ZoneId } from "../world/map";
import { addItem } from "./items";
import { EMPLOYMENT } from "./jobs";
import { applyDelta } from "./meters";
import { menu, type Choice, type Prompt } from "./prompt";
import { changeReputation, checkRequirements, currentAppearance, earnCash, phaseOf, pushLog, reputationIn, townOf, type GameState } from "./state";
import { hourOf } from "./time";
import type { ActionCtx } from "./work";

interface EventDef {
  id: string;
  /** Relative weight, or 0 to exclude. */
  weight(s: GameState, zone: ZoneId): number;
  build(ctx: ActionCtx): Prompt;
  /** Fire at most once per run. */
  once?: boolean;
}

const close: Choice = { label: "Move on" };

const EVENTS: EventDef[] = [
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
                earnCash(s, 20);
                s.flags.colleagueNumberGiven = 1;
                return menu("Someone says your name", ['"God. Right."', "They give you twenty dollars and their number, and mean both."], [close]);
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
              earnCash(s, 10);
              pushLog(s, "Colleague job lead — interview lined up.", "good");
              return menu(
                "Your phone buzzes",
                [
                  '"Done. You\'ll hear from them — probably Thursday."',
                  "Ten dollars lands in your account. A token. The real thing is the name in the right room.",
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
      const tip = ctx.rng.int(2, 8);
      return menu(
        "A couple with a map",
        [
          "They've got the map upside down. You can tell from ten feet.",
          "They look up and they've already decided you're safe to ask.",
        ],
        [
          {
            label: "Point them the right way",
            hint: `~$${tip} tip`,
            run: () => {
              ctx.advance(5);
              applyDelta(s.meters, { morale: +10 });
              earnCash(s, tip);
              pushLog(s, `Helped some tourists. $${tip} tip.`, "money");
              return menu(
                "A couple with a map",
                [
                  "They get there. Two minutes later the man comes jogging back.",
                  `He presses $${tip} into your hand and won't hear a no.`,
                ],
                [close],
                "money",
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
    id: "change",
    weight: (_s, z) => (z === "slums" ? 2 : z === "downtown" ? 2 : 1),
    build: (ctx) => {
      const s = ctx.state;
      const found = ctx.rng.int(1, 4);
      earnCash(s, found);
      return menu("Loose change", [`Coins in the gutter by the drain. $${found}.`, "You take it without breaking stride. You are good at this now."], [close], "money");
    },
  },

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

  {
    id: "heightsResident",
    weight: (_s, z) => (z === "heights" ? 4 : 0),
    build: (ctx) => {
      const s = ctx.state;
      const look = currentAppearance(s);
      if (look >= 80) {
        changeReputation(s, 2);
        return menu("On the hill", ['A man walking a whippet says good morning as though you live here.', "You say it back. Nobody checks."], [close]);
      }
      applyDelta(s.meters, { morale: -8 });
      return menu(
        "On the hill",
        ["A woman crosses to the far pavement and stays there until you are past.", "She does it smoothly, like it is a manoeuvre she has practised."],
        [close],
        "bad",
      );
    },
  },
];

/** Steps between encounter rolls. */
export const EVENT_STEP_INTERVAL = 26;

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

export function rollEvent(ctx: ActionCtx): Prompt | null {
  const s = ctx.state;
  const zone = zoneAt(townOf(s), s.player.pos.y).id;
  const fired: Record<string, number> = s.flags;

  const available = EVENTS.filter((e) => !(e.once && fired[`ev:${e.id}`]));
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
