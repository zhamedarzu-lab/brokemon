/**
 * Things that happen at work.
 *
 * Open finding 2 was that the mid-game is one day on a loop: from the moment
 * you hold a tier-3 job to the moment you can afford the franchise, days 5
 * through 23 differ only in the cash column. The street encounters could not
 * reach it, because by then you are not on the street — you are on shift,
 * indoors and sheltered, and the shift was a single line of arithmetic.
 *
 * So the shift is where the variety has to go. These fire *after* the hours
 * are worked and the wage is paid, on rather less than half of shifts, and
 * they are about the job rather than the town: a colleague, a mistake, an
 * hour of overtime, a supervisor who has noticed something. Several move
 * numbers that matter — a reference is worth more than a day's pay, and a
 * written warning costs you a strike you cannot see coming.
 *
 * They are deliberately weighted towards the tiers where the loop bites. A
 * phase-1 player has a different day every day already.
 */

import { applyDelta } from "./meters";
import { menu, type Choice, type Prompt } from "./prompt";
import { changeReputation, earnCash, pushLog, type GameState } from "./state";
import { EMPLOYMENT, type EmploymentDef, type EmploymentId } from "./jobs";
import type { ActionCtx } from "./work";

const on: Choice = { label: "Get on with it" };

export interface WorkEvent {
  id: string;
  /** Relative weight for this job, or 0 to exclude. */
  weight(s: GameState, def: EmploymentDef): number;
  build(ctx: ActionCtx, job: EmploymentId): Prompt;
  once?: boolean;
}

/** How often a worked shift turns up something worth a dialogue box. */
export const WORK_EVENT_CHANCE = 0.38;

/** Shorthand: only at these tiers, at this weight. */
function tiers(weight: number, ...at: Array<2 | 3 | 4>): (s: GameState, def: EmploymentDef) => number {
  return (_s, def) => (at.includes(def.tier) ? weight : 0);
}

export const WORK_EVENTS: WorkEvent[] = [
  {
    id: "wk_overtime",
    weight: tiers(4, 2, 3, 4),
    build: (ctx, job) => {
      const s = ctx.state;
      const def = EMPLOYMENT[job];
      const extra = Math.round((s.employmentPayOverride[job] ?? def.pay) * 0.25);
      return menu(
        def.employer,
        [
          "They are short for the back half and somebody has to stay.",
          `Ninety minutes. It is worth about $${extra} and you have been on your feet since this morning.`,
        ],
        [
          {
            label: "Stay on",
            hint: `90 min, $${extra}`,
            run: () => {
              // Ninety minutes, and the meter cost on top of the hour and a
              // half's own drain is deliberately light. At two hours and -16
              // the tail of the twenty-seed spread reached 368 days: overtime
              // dropped you under tomorrow's door requirement, which is a
              // strike, and three of those drop you the length of the ladder.
              ctx.advance(90, { exertion: def.exertion, sheltered: true });
              applyDelta(s.meters, { energy: -9, hunger: -9, thirst: -11, morale: -3 });
              earnCash(s, extra);
              changeReputation(s, 1);
              pushLog(s, `Ninety minutes' overtime — $${extra}.`, "money");
              return menu(def.employer, [`Another ninety minutes. $${extra}, and they remember who stayed.`], [on], "money");
            },
          },
          {
            label: "Go home",
            run: () => {
              applyDelta(s.meters, { morale: +3 });
              return menu(def.employer, ["Somebody else stays. You are out of the door at the hour and the sky is still light."], [on]);
            },
          },
        ],
      );
    },
  },

  {
    id: "wk_cover",
    weight: tiers(3, 2, 3),
    build: (ctx, job) => {
      const s = ctx.state;
      const def = EMPLOYMENT[job];
      return menu(
        def.employer,
        [
          "The one who trained you has their kid off school and no way to say so upstairs.",
          `"Half an hour. I'd owe you."`,
        ],
        [
          {
            label: "Cover for them",
            hint: "30 min",
            run: () => {
              ctx.advance(30, { exertion: def.exertion, sheltered: true });
              applyDelta(s.meters, { energy: -6, morale: +6 });
              changeReputation(s, 3);
              s.flags.owedAFavour = (s.flags.owedAFavour ?? 0) + 1;
              pushLog(s, "Covered for a colleague.", "good");
              return menu(
                def.employer,
                ["Half an hour and nobody upstairs is any the wiser.", "It gets round the floor by Thursday, the way these things do."],
                [on],
                "good",
              );
            },
          },
          {
            label: "Say you can't",
            run: () => {
              changeReputation(s, -1);
              applyDelta(s.meters, { morale: -4 });
              return menu(def.employer, [`"No, course. Forget I asked."`, "They do not bring it up again, which is somehow worse."], [on]);
            },
          },
        ],
      );
    },
  },

  {
    id: "wk_reference",
    weight: (s, def) => (def.tier >= 2 && (s.flags.owedAFavour ?? 0) >= 2 ? 6 : 0),
    once: true,
    build: (ctx, job) => {
      const s = ctx.state;
      const def = EMPLOYMENT[job];
      return menu(
        def.employer,
        [
          "The one you covered for catches you in the corridor with a folded bit of paper.",
          `"Wrote you a reference. Didn't ask me to, don't say anything."`,
        ],
        [
          {
            label: "Take it",
            run: () => {
              s.flags.hasReference = 1;
              changeReputation(s, 8);
              applyDelta(s.meters, { morale: +18 });
              pushLog(s, "Somebody wrote you a reference.", "good");
              return menu(
                def.employer,
                [
                  "It is one paragraph and it is about you and it is not a complaint.",
                  "You read it twice in the stairwell and then put it somewhere safe.",
                ],
                [on],
                "good",
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "wk_mistake",
    weight: (s, def) => (def.tier >= 2 && s.meters.energy < 35 ? 4 : 1),
    build: (ctx, job) => {
      const s = ctx.state;
      const def = EMPLOYMENT[job];
      return menu(
        def.employer,
        [
          "You have done something wrong and it is going to be noticed in about ten minutes.",
          "Nobody has seen yet.",
        ],
        [
          {
            label: "Own it now",
            run: () => {
              applyDelta(s.meters, { morale: -6 });
              changeReputation(s, 2);
              return menu(
                def.employer,
                [
                  "You go and say it before anybody finds it, and it is a bad ten minutes.",
                  "Your supervisor is short with you and writes nothing down.",
                ],
                [on],
              );
            },
          },
          {
            label: "Fix it quietly",
            hint: "risky",
            run: () => {
              ctx.advance(25, { exertion: def.exertion, sheltered: true });
              applyDelta(s.meters, { energy: -8 });
              if (ctx.rng.chance(0.62)) {
                applyDelta(s.meters, { morale: +6 });
                return menu(def.employer, ["Twenty-five minutes and it is as though it never happened."], [on]);
              }
              s.strikes += 1;
              changeReputation(s, -3);
              applyDelta(s.meters, { morale: -14 });
              pushLog(s, `Written up at ${def.employer}.`, "bad");
              return menu(
                def.employer,
                [
                  "They find it while you are still fixing it, which is the worst of the available orders.",
                  `That is a written warning. You have ${s.strikes}.`,
                ],
                [on],
                "bad",
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "wk_tip",
    weight: tiers(3, 2),
    build: (ctx, job) => {
      const s = ctx.state;
      const def = EMPLOYMENT[job];
      const tip = ctx.rng.int(4, 14);
      return menu(
        def.employer,
        ["A customer comes back in specifically to find you, which never happens and is never good."],
        [
          {
            label: "Brace",
            run: () => {
              earnCash(s, tip);
              applyDelta(s.meters, { morale: +12 });
              changeReputation(s, 2);
              pushLog(s, `A customer came back to tip you $${tip}.`, "money");
              return menu(
                def.employer,
                [
                  `They wanted to say you were helpful yesterday, and to give you $${tip}, and then they leave.`,
                  "You stand there holding it for a second.",
                ],
                [on],
                "money",
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "wk_restructure",
    weight: tiers(3, 3, 4),
    build: (ctx, job) => {
      const s = ctx.state;
      const def = EMPLOYMENT[job];
      return menu(
        def.employer,
        [
          "There is a meeting about the shape of the department and it uses the word 'shape' eleven times.",
          "Nobody says the other word.",
        ],
        [
          {
            label: "Sit through it",
            hint: "45 min",
            run: () => {
              ctx.advance(45, { sheltered: true });
              applyDelta(s.meters, { morale: -8, energy: -4 });
              return menu(
                def.employer,
                [
                  "Forty-five minutes and one slide you will think about at three in the morning.",
                  "Afterwards everybody is very normal with each other in the lift.",
                ],
                [on],
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "wk_recognised",
    weight: (s, def) => (def.tier >= 3 && s.peakPhase <= 2 ? 5 : 0),
    once: true,
    build: (ctx, job) => {
      const s = ctx.state;
      const def = EMPLOYMENT[job];
      return menu(
        def.employer,
        [
          "Somebody in the lift has been trying to place you since the second floor.",
          `"I know you. You used to be outside the Mart."`,
        ],
        [
          {
            label: "Yes",
            run: () => {
              changeReputation(s, 4);
              applyDelta(s.meters, { morale: +10 });
              return menu(
                def.employer,
                [
                  `You say yes, that was you, and watch them decide what to do with it.`,
                  `They say "good for you" and mean it, and get out on the fourth.`,
                ],
                [on],
                "good",
              );
            },
          },
          {
            label: "Say they're mistaken",
            run: () => {
              applyDelta(s.meters, { morale: -12 });
              return menu(
                def.employer,
                [
                  "You say they must be thinking of somebody else, and they apologise, and you both watch the numbers.",
                  "It costs you nothing at all and you feel it all afternoon.",
                ],
                [on],
                "bad",
              );
            },
          },
        ],
      );
    },
  },

  {
    id: "wk_kettle",
    weight: tiers(2, 2, 3, 4),
    build: (ctx, job) => {
      const s = ctx.state;
      const def = EMPLOYMENT[job];
      return menu(
        def.employer,
        ["Ten minutes at the kettle with two people who have worked here longer than you have been alive."],
        [
          {
            label: "Stay for the whole story",
            hint: "10 min",
            run: () => {
              ctx.advance(10, { sheltered: true });
              applyDelta(s.meters, { morale: +9, thirst: +14, energy: +3 });
              return menu(
                def.employer,
                ["It is a long story about a fire door in 1998 and it is genuinely funny.", "Somebody makes you one without asking how you take it."],
                [on],
                "good",
              );
            },
          },
          on,
        ],
      );
    },
  },

  {
    id: "wk_advance",
    weight: (s, def) => (def.tier >= 2 && s.cash < 25 ? 4 : 0),
    build: (ctx, job) => {
      const s = ctx.state;
      const def = EMPLOYMENT[job];
      const advance = 40;
      return menu(
        def.employer,
        [
          "Payroll can do a sub against next week if you ask, and asking is the whole cost of it.",
          `Forty dollars now, and forty less later.`,
        ],
        [
          {
            label: "Ask for a sub",
            hint: `$${advance} now`,
            run: () => {
              earnCash(s, advance);
              s.debt += advance;
              applyDelta(s.meters, { morale: -4 });
              pushLog(s, `Took a $${advance} advance against your wages.`, "money");
              return menu(
                def.employer,
                [`She does it without looking up, which you decide to be grateful for.`, `$${advance}, and it comes off the top of the next one.`],
                [on],
                "money",
              );
            },
          },
          {
            label: "Manage",
            run: () => {
              applyDelta(s.meters, { morale: +2 });
              return menu(def.employer, ["You do not ask. It is four days."], [on]);
            },
          },
        ],
      );
    },
  },

  {
    id: "wk_lostProperty",
    weight: tiers(2, 2, 3, 4),
    build: (ctx, job) => {
      const s = ctx.state;
      const def = EMPLOYMENT[job];
      return menu(
        def.employer,
        ["Somebody has left a good coat on the back of a chair and it has been there two days."],
        [
          {
            label: "Hand it in",
            run: () => {
              changeReputation(s, 2);
              applyDelta(s.meters, { morale: +4 });
              return menu(def.employer, ["It goes in the box behind reception with everything else nobody comes back for."], [on]);
            },
          },
          {
            label: "Take it",
            run: () => {
              applyDelta(s.meters, { morale: -6 });
              if (ctx.rng.chance(0.75)) {
                if (!s.wardrobe.includes("smartCasual")) s.wardrobe.push("smartCasual");
                pushLog(s, "Took a coat from the back of a chair.", "plain");
                return menu(
                  def.employer,
                  ["It fits. You wear it out of the building and nobody says anything and nobody ever does.", "You have something smart to wear now."],
                  [on],
                );
              }
              s.strikes += 1;
              changeReputation(s, -6);
              pushLog(s, `Caught taking a coat at ${def.employer}.`, "bad");
              return menu(
                def.employer,
                ["It turns out somebody had come back for it, and they are standing at reception describing it.", "That is a written warning and a conversation you will not forget."],
                [on],
                "bad",
              );
            },
          },
          on,
        ],
      );
    },
  },
];

/**
 * Roll for something to happen on a shift just worked. Returns null most of
 * the time, which is the point — a workplace where something happens every day
 * is not a workplace.
 */
export function rollWorkEvent(ctx: ActionCtx, job: EmploymentId): Prompt | null {
  const s = ctx.state;
  if (!ctx.rng.chance(WORK_EVENT_CHANCE)) return null;

  const def = EMPLOYMENT[job];
  const pool = WORK_EVENTS.filter((e) => !(e.once && s.flags[`wk:${e.id}`]));
  const picked = ctx.rng.weighted(pool.map((e) => [e, e.weight(s, def)] as const));
  if (!picked) return null;

  if (picked.once) s.flags[`wk:${picked.id}`] = 1;
  return picked.build(ctx, job);
}
