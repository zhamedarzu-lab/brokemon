import { zoneAt, type ZoneId } from "../world/map";
import { addItem } from "./items";
import { applyDelta } from "./meters";
import { menu, type Choice, type Prompt } from "./prompt";
import { currentAppearance, phaseOf, pushLog, type GameState } from "./state";
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
              s.reputation += 12;
              applyDelta(s.meters, { morale: +14 });
              ctx.advance(25);
              if (ctx.rng.chance(0.5)) {
                const reward = ctx.rng.int(10, 30);
                s.cash += reward;
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
              s.cash += cash;
              s.reputation -= 6;
              applyDelta(s.meters, { morale: -12 });
              ctx.advance(10);
              pushLog(s, `Took $${cash} from a found wallet.`, "money");
              if (ctx.rng.chance(0.18)) {
                const fine = 60;
                s.debt += fine;
                s.reputation -= 10;
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
              s.reputation -= 1;
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
              s.reputation += 4;
              if (ctx.rng.chance(0.4)) {
                s.cash += 20;
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

  {
    id: "change",
    weight: () => 4,
    build: (ctx) => {
      const s = ctx.state;
      const found = ctx.rng.int(1, 4);
      s.cash += found;
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
                s.reputation -= 8;
                const fine = 120;
                s.debt += fine;
                pushLog(s, "The van job went wrong.", "bad");
                return menu("A man with a van", ["There is a police car at the second address.", `You are not charged, but you are known now, and it costs you $${fine}.`], [close], "bad");
              }
              s.cash += pay;
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
      s.reputation += 3;
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
        s.reputation += 2;
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
