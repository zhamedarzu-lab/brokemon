import { zoneAt, type ZoneId } from "../world/map";
import { addItem } from "./items";
import { EMPLOYMENT } from "./jobs";
import { applyDelta } from "./meters";
import { menu, type Choice, type Prompt } from "./prompt";
import { changeReputation, currentAppearance, earnCash, phaseOf, pushLog, type GameState } from "./state";
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
      const repOk = s.reputation >= 20;
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
          "Your name is on a rota. That hasn\'t happened in a long time.",
        ];
        if (previous) lines.push(`You send a message to ${previous === "nightStock" ? "the night supervisor" : "your old employer"}. Short. Professional.`);
        return menu("The interview", lines, [close], "good");
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
    weight: (s) => (phaseOf(s) <= 2 ? 2 : 1),
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
    weight: (s, z) => (z === "downtown" && phaseOf(s) <= 2 ? 2 : 1),
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

  {
    id: "change",
    weight: () => 4,
    build: (ctx) => {
      const s = ctx.state;
      const found = ctx.rng.int(1, 4);
      earnCash(s, found);
      return menu("Loose change", [`Coins in the gutter by the drain. $${found}.`, "You take it without breaking stride. You are good at this now."], [close], "money");
    },
  },

  {
    id: "cans",
    weight: (_s, z) => (z === "slums" ? 5 : 2),
    build: (ctx) => {
      const s = ctx.state;
      const n = ctx.rng.int(2, 5);
      addItem(s.inventory, "recyclables", n);
      return menu("A split bin bag", [`${n} cans and bottles, still with the deposit on them.`], [close]);
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
    weight: () => 3,
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

export function rollEvent(ctx: ActionCtx): Prompt | null {
  const s = ctx.state;
  const zone = zoneAt(s.player.pos.y).id;
  const fired: Record<string, number> = s.flags;

  const entries = EVENTS.filter((e) => !(e.once && fired[`ev:${e.id}`])).map(
    (e) => [e, e.weight(s, zone)] as const,
  );
  const picked = ctx.rng.weighted(entries);
  if (!picked) return null;
  if (picked.once) fired[`ev:${picked.id}`] = 1;
  return picked.build(ctx);
}
