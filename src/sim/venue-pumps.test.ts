/**
 * Nothing you can stand in front of and click.
 *
 * St. Jude's paid +14 morale, +5 health and +6 energy for twenty minutes with
 * no daily limit, and took $5 for +10 morale with no clock cost at all. The
 * first was worth about +15 energy an hour, free and forever, against the +75
 * over eight hours that a hostel bed *charges* for — a pew was 1.6x a bed. The
 * second was a vending machine: ten clicks, no minutes, a full dignity bar.
 *
 * Neither harness caught it. The walking rig has no reason to visit a church
 * and no test named the place, so it sat in the game for as long as the church
 * has existed. Reading the file would not reliably catch the next one either —
 * there are two towns, thirty-odd doors and menus two deep — so this checks it
 * by *doing*: take every option ten times over and compare against simply
 * letting the same number of game-minutes pass.
 *
 * Anything that leaves you better off than idling, for no money, and can be
 * repeated to the end of the trial, has to be on the list below with a reason.
 */
import { describe, expect, it } from "vitest";
import { markerPos, TOWNS, townById } from "../world/map";
import type { Choice, Prompt } from "./prompt";
import { Rng } from "./rng";
import { createState, type GameState } from "./state";
import { advance } from "./tick";
import { VENUES } from "./venues";
import type { ActionCtx } from "./work";

const METERS = ["hunger", "thirst", "hygiene", "energy", "morale", "health"] as const;
const meterSum = (s: GameState) => METERS.reduce((a, k) => a + s.meters[k], 0);

const REPEATS = 10;
const HOURS = [9, 13, 19, 23];
/** Meter points above idling that count as a free lunch rather than noise. */
const NOISE = 15;

/**
 * Free and unlimited on purpose, each for a stated reason.
 *
 * Being on this list is not a pass mark for the number — it says the option is
 * *meant* to be repeatable and free. All four are bounded by a meter ceiling or
 * by the clock, which is what stops them being taps.
 */
const DELIBERATE: Record<string, string> = {
  "brokemon/communityCenter :: Wash up in the bathroom":
    "The free shower is the whole safety net, and hygiene caps at 100 — washing twice running does nothing the second time.",
  "brokemon/diner :: Ask for tap water":
    "Water is free everywhere by design; every district is required to have somewhere to drink. Thirst caps at 100.",
  "brokemon/church :: Sit quietly for a while":
    "The door is always open because shelter is the character of the place. The lift is once a day, so ten sits buy one — and the rate is negative, you lose meters sitting there all afternoon.",
  "brokedale/coachTerminal :: Sit up in the concourse until morning":
    "Brokedale's only bed, and it costs the entire night: ten of them is 55 hours.",
};

function actor(townId: string, marker: string, hour: number): { s: GameState; ctx: ActionCtx } {
  const town = townById(townId as never);
  const s = createState(4);
  s.player.town = townId as never;
  s.cash = 400;
  s.time = hour * 60;
  // Mid-range, so a restore has room to climb and a cost has room to fall.
  s.meters = { hunger: 50, thirst: 50, hygiene: 50, energy: 50, morale: 50, health: 60 };
  s.bodyClean = 50;
  s.clothesClean = 50;
  s.wardrobe.push("thrift");
  s.wearing = "thrift";
  s.player.pos = markerPos(town, marker);
  const rng = new Rng(4);
  return {
    s,
    ctx: {
      state: s,
      rng,
      advance: (m, o) => void advance(s, rng, { minutes: m, ...o }),
      teleport: (x, y) => { s.player.pos = { x, y }; },
    },
  };
}

/**
 * Walk a path of labels from the front door.
 *
 * By label rather than by index, because menus reshuffle as you use them —
 * buy a bike and the bike rows change, so repeating "the fourth option" ends
 * up pressing a different button each time and reports a blend of both.
 */
function follow(ctx: ActionCtx, marker: string, path: string[]): Prompt | null {
  let prompt: Prompt | null = VENUES[marker]!(ctx);
  for (const label of path) {
    const choice: Choice | undefined = prompt?.choices?.find((c) => c.label === label);
    if (!choice || choice.locked || !choice.run) return null;
    prompt = choice.run();
  }
  return prompt;
}

interface Trial {
  key: string; where: string; path: string;
  takes: number; minutes: number; cash: number; gain: number;
}

function runTrial(townId: string, marker: string, hour: number, path: string[]): Trial | null {
  const town = townById(townId as never);
  const probe = actor(townId, marker, hour);
  const t0 = probe.s.time, c0 = probe.s.cash;
  let takes = 0;
  for (let r = 0; r < REPEATS; r++) {
    let landed: Prompt | null;
    try { landed = follow(probe.ctx, marker, path); } catch { break; }
    if (landed === null) break;
    takes++;
    // Stay at the door: some options move you (a bus, an escort, a collapse).
    probe.s.player.pos = markerPos(town, marker);
    probe.s.player.town = townId as never;
  }
  if (takes === 0) return null;
  const minutes = probe.s.time - t0;
  const idle = actor(townId, marker, hour);
  if (minutes > 0) idle.ctx.advance(minutes);
  return {
    key: `${townId}/${marker} :: ${path.join(" > ")}`,
    where: `${townId}/${marker}@${hour}`,
    path: path.join(" > "),
    takes, minutes,
    cash: probe.s.cash - c0,
    gain: meterSum(probe.s) - meterSum(idle.s),
  };
}

/** Every option in both towns, at four hours, one and two menus deep. */
function everyOption(): Trial[] {
  const out: Trial[] = [];
  for (const townId of Object.keys(TOWNS)) {
    const town = townById(townId as never);
    for (const marker of Object.keys(town.markers)) {
      if (!VENUES[marker]) continue;
      for (const hour of HOURS) {
        let top: Prompt | null = null;
        try { top = VENUES[marker]!(actor(townId, marker, hour).ctx); } catch { continue; }
        for (const c of top?.choices ?? []) {
          if (c.locked || !c.run) continue;
          const one = runTrial(townId, marker, hour, [c.label]);
          if (one) out.push(one);
          let sub: Prompt | null = null;
          try { sub = follow(actor(townId, marker, hour).ctx, marker, [c.label]); } catch { continue; }
          for (const s2 of sub?.choices ?? []) {
            if (s2.locked || !s2.run) continue;
            const two = runTrial(townId, marker, hour, [c.label, s2.label]);
            if (two) out.push(two);
          }
        }
      }
    }
  }
  return out;
}

const TRIALS = everyOption();

describe("no venue is a tap you can leave running", () => {
  it("actually opened a useful number of doors", () => {
    // A guard that silently stopped exercising anything would pass everything
    // below it. This is the tripwire for that.
    expect(TRIALS.length).toBeGreaterThan(250);
  });

  it("has nothing repeatable and free that beats simply waiting", () => {
    const pumps = TRIALS.filter(
      (t) => t.takes >= REPEATS && t.cash >= 0 && t.gain > NOISE && !(t.key in DELIBERATE),
    );
    expect(
      pumps.map((p) => `${p.where} "${p.path}" — ${p.gain.toFixed(0)} meter points above idling for $${-p.cash}`),
      "an option can be taken over and over, costs nothing, and leaves you better off than the clock alone",
    ).toEqual([]);
  });

  it("has nothing repeatable that moves a meter without costing time", () => {
    // The donation's exact shape: $5 for +10 morale and no minutes at all, so
    // ten clicks filled the bar between two footsteps.
    const instant = TRIALS.filter((t) => t.takes >= REPEATS && t.minutes === 0 && t.gain > 0);
    expect(
      instant.map((t) => `${t.where} "${t.path}" — ${t.gain.toFixed(0)} meter points in zero minutes`),
      "a meter moved with no clock cost, repeatably",
    ).toEqual([]);
  });

  it("keeps the deliberate ones bounded rather than merely allow-listed", () => {
    // Being on the list means "meant to be repeatable", not "exempt". Each one
    // has to be held down by a meter ceiling or by the clock, so ten takes
    // cannot pay ten times over.
    for (const key of Object.keys(DELIBERATE)) {
      const seen = TRIALS.filter((t) => t.key === key && t.takes >= REPEATS);
      expect(seen.length, `${key} is allow-listed but no trial exercises it`).toBeGreaterThan(0);
      for (const t of seen) {
        // One take's worth of headroom is 100 - 50 = 50 per meter. Anything
        // above two meters' worth means repetition is still paying.
        expect(
          t.gain,
          `${key} pays ${t.gain.toFixed(0)} over ten takes — that is no longer bounded. ${DELIBERATE[key]}`,
        ).toBeLessThanOrEqual(100);
      }
    }
  });

  it("leaves the church paying for one sit however many times you sit", () => {
    // The regression this whole file exists for, pinned directly.
    const sits = TRIALS.filter(
      (t) => t.key === "brokemon/church :: Sit quietly for a while" && t.takes >= REPEATS,
    );
    expect(sits.length).toBeGreaterThan(0);
    for (const t of sits) {
      // 25 is one lift (+14 morale, +5 health, +6 energy). Sitting across
      // midnight legitimately buys a second day's, hence the allowance.
      expect(t.gain, `ten sits paid ${t.gain.toFixed(0)}, which is more than two lifts`).toBeLessThanOrEqual(55);
    }
  });
});
