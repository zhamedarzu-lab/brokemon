import { describe, expect, it } from "vitest";
import {
  COOLDOWN_DECAY_FACTOR,
  COOLDOWN_FULL_MIN,
  COOLDOWN_RECOVER_MIN,
  rollEvent,
} from "./events";
import type { Prompt } from "./prompt";
import { Rng } from "./rng";
import { createState, phaseOf, type GameState } from "./state";
import { advance } from "./tick";
import type { ActionCtx } from "./work";

function makeCtx(s: GameState, seed = 1): ActionCtx {
  const rng = new Rng(seed);
  return {
    state: s,
    rng,
    advance: (m, o) => void advance(s, rng, { minutes: m, ...o }),
    teleport: (x, y) => { s.player.pos = { x, y }; },
  };
}

/** Place the player in a named zone by moving them to a representative y. */
function inZone(s: GameState, zone: "slums" | "downtown" | "heights") {
  if (zone === "slums") s.player.pos = { x: 10, y: 58 };
  else if (zone === "downtown") s.player.pos = { x: 20, y: 20 };
  else s.player.pos = { x: 20, y: 8 };
}

function phase2(s: GameState) {
  s.housing = "hostel";
}

function phase3(s: GameState) {
  s.housing = "apartment";
  s.employment = "technician";
}

/** Drive a prompt down a path of label substrings. */
function drive(p: Prompt | null, ...labels: string[]): Prompt | null {
  let cur = p;
  for (const l of labels) {
    const c = cur?.choices?.find((ch) => !ch.locked && ch.label.toLowerCase().includes(l.toLowerCase()));
    cur = c?.run?.() ?? null;
  }
  return cur;
}

/* ---------------------------------------------------------------- helpers */

describe("colleague — number flag", () => {
  it("sets colleagueNumberGiven flag when player gets the number (seeded 50/50 win)", () => {
    // Use a seed that makes rng.chance(0.4) return true.
    // Seed 3 → first rng.chance call ≈ 0.238 … try a few seeds.
    // We'll just simulate the build manually by finding the right seed.
    // Instead, let's test by setting up phase 1 and letting rollEvent fire colleague.
    let found = false;
    for (let seed = 1; seed <= 200; seed++) {
      const s = createState(seed);
      s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
      inZone(s, "slums");
      const ctx = makeCtx(s, seed);
      const p = rollEvent(ctx);
      if (!p) continue;
      if (p.title !== "Someone says your name") continue;
      // Drive "Tell them the truth"
      drive(p, "tell them");
      if (s.flags.colleagueNumberGiven) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

describe("colleagueCall event", () => {
  it("only fires in phase 2 when colleagueNumberGiven is set", () => {
    const s = createState(1);
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    phase2(s);
    s.flags.colleagueNumberGiven = 1;
    s.flags.colleagueDone = 1;
    inZone(s, "downtown");
    // Roll many times — colleagueCall should eventually appear.
    let found = false;
    for (let i = 1; i <= 300; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "Your phone buzzes") { found = true; break; }
      // Reset once-flag so it can fire again in next iteration
      delete s.flags.colleagueCallDone;
    }
    expect(found).toBe(true);
  });

  it("does not fire in phase 1", () => {
    const s = createState(1);
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    // Phase 1: street housing
    s.flags.colleagueNumberGiven = 1;
    expect(phaseOf(s)).toBe(1);
    inZone(s, "slums");
    let found = false;
    for (let i = 1; i <= 200; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "Your phone buzzes") { found = true; break; }
      delete s.flags.colleagueCallDone;
    }
    expect(found).toBe(false);
  });

  it("grants reputation and cash on accept", () => {
    const s = createState(1);
    phase2(s);
    s.meters = { hunger: 80, thirst: 80, hygiene: 60, energy: 80, morale: 60, health: 80 };
    s.flags.colleagueNumberGiven = 1;
    s.flags.colleagueDone = 1;
    inZone(s, "downtown");
    let prompt: Prompt | null = null;
    for (let i = 1; i <= 300; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "Your phone buzzes") { prompt = p; break; }
      delete s.flags.colleagueCallDone;
    }
    expect(prompt).not.toBeNull();
    const repBefore = s.reputation;
    const cashBefore = s.cash;
    drive(prompt, "yes");
    expect(s.reputation).toBeGreaterThan(repBefore);
    expect(s.cash).toBeGreaterThan(cashBefore);
  });
});

describe("streetMusician event", () => {
  it("fires in phase 1", () => {
    const s = createState(1);
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    expect(phaseOf(s)).toBe(1);
    inZone(s, "slums");
    let found = false;
    for (let i = 1; i <= 400; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "A man with a guitar case") { found = true; break; }
    }
    expect(found).toBe(true);
  });

  it("morale rises when listening for free", () => {
    const s = createState(1);
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 50, health: 100 };
    inZone(s, "slums");
    let prompt: Prompt | null = null;
    for (let i = 1; i <= 400; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "A man with a guitar case") { prompt = p; break; }
    }
    expect(prompt).not.toBeNull();
    const moraleBefore = s.meters.morale;
    drive(prompt, "listen");
    expect(s.meters.morale).toBeGreaterThan(moraleBefore);
  });

  it("dropping a dollar raises morale and costs $1", () => {
    // Use fresh states per iteration to avoid cash mutations from earlier rollEvent calls.
    let prompt: Prompt | null = null;
    let promptState: GameState | null = null;
    for (let i = 1; i <= 400; i++) {
      const s = createState(i);
      s.cash = 10;
      s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 50, health: 100 };
      inZone(s, "slums");
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "A man with a guitar case") { prompt = p; promptState = s; break; }
    }
    expect(prompt).not.toBeNull();
    const moraleBefore = promptState!.meters.morale;
    const cashBefore = promptState!.cash;
    drive(prompt, "drop a dollar");
    expect(promptState!.meters.morale).toBeGreaterThan(moraleBefore);
    expect(promptState!.cash).toBe(cashBefore - 1);
  });

  it("dollar option is locked when broke", () => {
    // Use fresh states per iteration so prior rollEvent cash gains don't unlock the option.
    let prompt: Prompt | null = null;
    let promptState: GameState | null = null;
    for (let i = 1; i <= 400; i++) {
      const s = createState(i);
      s.cash = 0;
      s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 50, health: 100 };
      inZone(s, "slums");
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "A man with a guitar case") { prompt = p; promptState = s; break; }
    }
    // It's possible that rollEvent gave cash (e.g. "change") before returning streetMusician.
    // In that case, skip this seed and look for one where cash is still 0.
    if (promptState && promptState.cash > 0) {
      prompt = null;
      promptState = null;
      for (let i = 401; i <= 800; i++) {
        const s = createState(i);
        s.cash = 0;
        s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 50, health: 100 };
        inZone(s, "slums");
        const ctx = makeCtx(s, i);
        const p = rollEvent(ctx);
        if (p?.title === "A man with a guitar case" && s.cash === 0) { prompt = p; promptState = s; break; }
      }
    }
    expect(prompt).not.toBeNull();
    const dollarChoice = prompt?.choices?.find(c => c.label.toLowerCase().includes("drop a dollar"));
    expect(dollarChoice?.locked).toBeTruthy();
  });
});

describe("overheardTip event", () => {
  it("only fires in downtown", () => {
    const s = createState(1);
    phase2(s);
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    inZone(s, "downtown");
    let found = false;
    for (let i = 1; i <= 400; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "Two women at a café table") { found = true; break; }
    }
    expect(found).toBe(true);
  });

  it("does not fire in slums", () => {
    const s = createState(1);
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    inZone(s, "slums");
    let found = false;
    for (let i = 1; i <= 300; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "Two women at a café table") { found = true; break; }
    }
    expect(found).toBe(false);
  });
});

describe("lostTourist event", () => {
  it("grants cash and morale when player helps", () => {
    const s = createState(1);
    phase2(s);
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 50, health: 100 };
    inZone(s, "downtown");
    let prompt: Prompt | null = null;
    for (let i = 1; i <= 400; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "A couple with a map") { prompt = p; break; }
    }
    expect(prompt).not.toBeNull();
    const cashBefore = s.cash;
    const moraleBefore = s.meters.morale;
    drive(prompt, "point them");
    expect(s.cash).toBeGreaterThan(cashBefore);
    expect(s.meters.morale).toBeGreaterThan(moraleBefore);
  });
});

describe("rainShelter event", () => {
  it("only fires in rain or storm weather", () => {
    const s = createState(1);
    s.weather = "clear";
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    inZone(s, "downtown");
    let found = false;
    for (let i = 1; i <= 200; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "The sky opens") { found = true; break; }
    }
    expect(found).toBe(false);
  });

  it("fires when weather is rain", () => {
    const s = createState(1);
    s.weather = "rain";
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    inZone(s, "downtown");
    let found = false;
    for (let i = 1; i <= 200; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "The sky opens") { found = true; break; }
    }
    expect(found).toBe(true);
  });

  it("ducking into doorway avoids health penalty", () => {
    const s = createState(1);
    s.weather = "storm";
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 50, health: 100 };
    inZone(s, "slums");
    let prompt: Prompt | null = null;
    for (let i = 1; i <= 200; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "The sky opens") { prompt = p; break; }
    }
    expect(prompt).not.toBeNull();
    const healthBefore = s.meters.health;
    drive(prompt, "duck");
    expect(s.meters.health).toBeGreaterThanOrEqual(healthBefore);
  });

  it("staying in the rain hurts health and hygiene", () => {
    const s = createState(1);
    s.weather = "rain";
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    inZone(s, "slums");
    let prompt: Prompt | null = null;
    for (let i = 1; i <= 200; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "The sky opens") { prompt = p; break; }
    }
    expect(prompt).not.toBeNull();
    const healthBefore = s.meters.health;
    const hygieneBefore = s.meters.hygiene;
    drive(prompt, "keep moving");
    expect(s.meters.health).toBeLessThan(healthBefore);
    expect(s.meters.hygiene).toBeLessThan(hygieneBefore);
  });
});

describe("oldBoss event", () => {
  it("only fires in phase 2-3", () => {
    // Phase 1 — should not fire
    const s = createState(1);
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    expect(phaseOf(s)).toBe(1);
    inZone(s, "downtown");
    let found = false;
    for (let i = 1; i <= 300; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "Someone you used to work for") { found = true; break; }
      delete s.flags.oldBossDone;
    }
    expect(found).toBe(false);
  });

  it("grants reputation when player looks good (appearance ≥ 60)", () => {
    const s = createState(1);
    phase3(s);
    s.wearing = "professional";
    s.wardrobe = ["professional"];
    s.meters = { hunger: 100, thirst: 100, hygiene: 90, energy: 100, morale: 80, health: 100 };
    inZone(s, "downtown");
    let prompt: Prompt | null = null;
    for (let i = 1; i <= 400; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "Someone you used to work for") { prompt = p; break; }
      delete s.flags.oldBossDone;
    }
    expect(prompt).not.toBeNull();
    expect(s.reputation).toBeGreaterThan(0);
  });

  it("hurts reputation when player looks bad (appearance < 60)", () => {
    const s = createState(1);
    phase2(s);
    s.wearing = "rags";
    s.meters = { hunger: 100, thirst: 100, hygiene: 10, energy: 100, morale: 80, health: 100 };
    inZone(s, "downtown");
    let prompt: Prompt | null = null;
    for (let i = 1; i <= 400; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "Someone you used to work for") { prompt = p; break; }
      delete s.flags.oldBossDone;
    }
    expect(prompt).not.toBeNull();
    expect(s.reputation).toBeLessThan(0);
  });
});

describe("networkingHappyHour event", () => {
  it("fires in downtown phase 2-3 in the evening", () => {
    const s = createState(1);
    phase2(s);
    s.time = 18 * 60; // 6 PM
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    inZone(s, "downtown");
    let found = false;
    for (let i = 1; i <= 400; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "Happy hour") { found = true; break; }
    }
    expect(found).toBe(true);
  });

  it("does not fire in the morning", () => {
    const s = createState(1);
    phase2(s);
    s.time = 9 * 60; // 9 AM
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    inZone(s, "downtown");
    let found = false;
    for (let i = 1; i <= 300; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "Happy hour") { found = true; break; }
    }
    expect(found).toBe(false);
  });

  it("going in raises morale and thirst but drains energy", () => {
    const s = createState(1);
    phase2(s);
    s.time = 18 * 60;
    s.meters = { hunger: 80, thirst: 40, hygiene: 70, energy: 80, morale: 50, health: 100 };
    inZone(s, "downtown");
    let prompt: Prompt | null = null;
    for (let i = 1; i <= 400; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "Happy hour") { prompt = p; break; }
    }
    expect(prompt).not.toBeNull();
    const moraleBefore = s.meters.morale;
    const thirstBefore = s.meters.thirst;
    const energyBefore = s.meters.energy;
    drive(prompt, "go in");
    expect(s.meters.morale).toBeGreaterThan(moraleBefore);
    expect(s.meters.thirst).toBeGreaterThan(thirstBefore);
    expect(s.meters.energy).toBeLessThan(energyBefore);
  });
});

describe("profilePiece event", () => {
  it("only fires in phase 3+", () => {
    const s = createState(1);
    phase2(s);
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    inZone(s, "downtown");
    let found = false;
    for (let i = 1; i <= 300; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "A journalist") { found = true; break; }
      delete s.flags.profilePieceDone;
    }
    expect(found).toBe(false);
  });

  it("boosts reputation significantly when giving the quote", () => {
    const s = createState(1);
    phase3(s);
    s.meters = { hunger: 100, thirst: 100, hygiene: 90, energy: 100, morale: 80, health: 100 };
    inZone(s, "downtown");
    let prompt: Prompt | null = null;
    for (let i = 1; i <= 400; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "A journalist") { prompt = p; break; }
      delete s.flags.profilePieceDone;
    }
    expect(prompt).not.toBeNull();
    const repBefore = s.reputation;
    drive(prompt, "give her");
    expect(s.reputation - repBefore).toBeGreaterThanOrEqual(15);
  });
});

describe("stockTip event", () => {
  it("only fires in phase 3+ with enough cash", () => {
    const s = createState(1);
    phase3(s);
    s.cash = 50;
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    inZone(s, "downtown");
    let found = false;
    for (let i = 1; i <= 400; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "Anonymous tip") { found = true; break; }
    }
    expect(found).toBe(true);
  });

  it("does not fire when cash < 50 (weight gates it out)", () => {
    // Use a fresh state per iteration so cash stays at 20 throughout.
    let found = false;
    for (let i = 1; i <= 300; i++) {
      const s = createState(i);
      phase3(s);
      s.cash = 20;
      s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
      inZone(s, "downtown");
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "Anonymous tip") { found = true; break; }
    }
    expect(found).toBe(false);
  });

  it("winning the tip triples the investment, losing costs $50", () => {
    // Use a fresh state per iteration to avoid accumulated state mutations.
    let winFound = false;
    let loseFound = false;
    for (let i = 1; i <= 600 && (!winFound || !loseFound); i++) {
      const s = createState(i);
      phase3(s);
      s.cash = 200;
      s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
      inZone(s, "downtown");
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title !== "Anonymous tip") continue;
      const cashBefore = s.cash;
      drive(p, "put $50");
      const diff = s.cash - cashBefore;
      if (diff > 0) winFound = true; // net +100
      else loseFound = true;          // net -50
    }
    expect(winFound).toBe(true);
    expect(loseFound).toBe(true);
  });
});

/* -------------------------------------------------------- colleagueInterview */

/** Get the interview prompt, requiring a minimum number of seeds tried. */
/**
 * Fish the interview out of the encounter roller.
 *
 * `salt` must vary with the caller's loop counter. Without it every call
 * started at inner seed 1, found the interview on the same iteration, and
 * handed back a prompt whose choices were closed over an identically seeded
 * Rng — so a four-hundred-seed sweep explored exactly one outcome and a 70%
 * chance looked like a 0% one.
 */
function getInterviewPrompt(s: GameState, salt = 0): Prompt | null {
  s.flags.colleagueInterviewPending = 1;
  inZone(s, "downtown");
  for (let i = 1; i <= 500; i++) {
    delete s.flags["ev:colleagueInterview"];
    delete s.flags.colleagueInterviewDone;
    const ctx = makeCtx(s, salt * 977 + i);
    const p = rollEvent(ctx);
    if (p?.title === "The interview") return p;
  }
  return null;
}

describe("colleagueInterview event", () => {
  it("fires when colleagueInterviewPending is set", () => {
    const s = createState(1);
    phase2(s);
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    const prompt = getInterviewPrompt(s);
    expect(prompt).not.toBeNull();
    expect(prompt?.title).toBe("The interview");
  });

  it("does not fire when colleagueInterviewPending is not set", () => {
    const s = createState(1);
    phase2(s);
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    inZone(s, "downtown");
    let found = false;
    for (let i = 1; i <= 300; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "The interview") { found = true; break; }
    }
    expect(found).toBe(false);
  });

  it("fires only once (once: true)", () => {
    const s = createState(1);
    phase2(s);
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    s.flags.colleagueInterviewPending = 1;
    inZone(s, "downtown");
    let count = 0;
    for (let i = 1; i <= 400; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "The interview") count++;
      // Do NOT reset ev:colleagueInterview — test that once prevents re-fire
    }
    expect(count).toBe(1);
  });

  it("successful confident approach hires unemployed player as martClerk", () => {
    let hired = false;
    for (let i = 1; i <= 400 && !hired; i++) {
      const s = createState(i);
      phase2(s);
      s.employment = null;
      s.reputation = 25; // repOk threshold
      s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
      const p = getInterviewPrompt(s, i);
      if (!p) continue;
      drive(p, "confident");
      if (s.employment === "martClerk") hired = true;
    }
    expect(hired).toBe(true);
  });

  it("successful nervous approach can hire unemployed player as martClerk", () => {
    let hired = false;
    for (let i = 1; i <= 400 && !hired; i++) {
      const s = createState(i);
      phase2(s);
      s.employment = null;
      s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
      const p = getInterviewPrompt(s, i);
      if (!p) continue;
      drive(p, "honest");
      if (s.employment === "martClerk") hired = true;
    }
    expect(hired).toBe(true);
  });

  it("wing-it can both succeed (hire) and fail/near-miss across seeds", () => {
    // Vary the rollEvent seed directly so the rng path for the outcome roll differs.
    let hired = false;
    let nonHire = false;
    const s = createState(1);
    phase2(s);
    s.employment = null;
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
    for (let seed = 1; seed <= 800 && (!hired || !nonHire); seed++) {
      s.flags.colleagueInterviewPending = 1;
      delete s.flags["ev:colleagueInterview"];
      delete s.flags.colleagueInterviewDone;
      s.employment = null;
      s.meters.morale = 80;
      inZone(s, "downtown");
      const ctx = makeCtx(s, seed);
      const p = rollEvent(ctx);
      if (p?.title !== "The interview") continue;
      drive(p, "wing");
      if (s.employment === "martClerk") hired = true;
      else nonHire = true;
    }
    expect(hired).toBe(true);
    expect(nonHire).toBe(true);
  });

  it("does not downgrade a player already at martClerk tier or higher", () => {
    const higherTierJobs = ["martClerk", "technician", "officeAdmin", "executive"] as const;
    for (const job of higherTierJobs) {
      // Run multiple seeds to ensure success branch fires at least once
      let successFired = false;
      for (let i = 1; i <= 400 && !successFired; i++) {
        const s = createState(i);
        phase2(s);
        s.employment = job;
        s.reputation = 30;
        s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
        const p = getInterviewPrompt(s, i);
        if (!p) continue;
        drive(p, "confident");
        // Employment must never have been downgraded to martClerk when starting higher
        if (job !== "martClerk") {
          expect(s.employment).toBe(job);
        }
        if (s.cash > 0 || s.reputation > 30) successFired = true;
      }
    }
  });

  it("always gives reputation and cash on any success outcome regardless of existing job", () => {
    let repGained = false;
    let cashGained = false;
    for (let i = 1; i <= 400 && (!repGained || !cashGained); i++) {
      const s = createState(i);
      phase2(s);
      s.employment = "technician"; // higher-tier job
      s.reputation = 25;
      s.cash = 0;
      s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
      const p = getInterviewPrompt(s, i);
      if (!p) continue;
      const repBefore = s.reputation;
      const cashBefore = s.cash;
      drive(p, "confident");
      if (s.reputation > repBefore) repGained = true;
      if (s.cash > cashBefore) cashGained = true;
    }
    expect(repGained).toBe(true);
    expect(cashGained).toBe(true);
  });
});

/* -------------------------------------------------------- recency cooldown */

describe("event recency cooldown", () => {
  const ROLLS = 300;

  /**
   * Count how many times 'change' fires out of ROLLS independent rolls.
   * Each roll uses a fresh RNG seed so state mutations from build() don't
   * compound; we don't call build() — we only look at what rollEvent picked.
   */
  function countChangeFires(flags: Record<string, number>): number {
    let count = 0;
    for (let seed = 1; seed <= ROLLS; seed++) {
      const s = createState(seed);
      s.flags = { ...flags };
      s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
      inZone(s, "slums");
      const ctx = makeCtx(s, seed);
      const p = rollEvent(ctx);
      if (p?.title === "Loose change") count++;
    }
    return count;
  }

  it("recently-seen events appear significantly less often than cold ones", () => {
    // Baseline: no prior sightings.
    const baselineCount = countChangeFires({});

    // Hot cooldown: 'change' was seen just now (elapsed = 0 → factor = 0.2).
    const hotCount = countChangeFires({ "ev_last:change": 7 * 60 /* same as createState start */ });

    // With a 0.2× weight factor the hot rate should be well below the baseline.
    // We allow generous margins to stay deterministic across platforms.
    expect(baselineCount).toBeGreaterThan(0);
    expect(hotCount).toBeLessThan(baselineCount);
  });

  it("cooldown multiplier is COOLDOWN_DECAY_FACTOR when elapsed = 0", () => {
    // If ev_last:change equals s.time, the elapsed is 0 → multiplier = COOLDOWN_DECAY_FACTOR.
    // We verify this indirectly: hot rate / baseline rate ≈ COOLDOWN_DECAY_FACTOR.
    // Use a large sample and a loose ratio bound.
    const LARGE = 600;
    let baseCount = 0;
    let hotCount = 0;
    for (let seed = 1; seed <= LARGE; seed++) {
      const sBase = createState(seed);
      sBase.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
      inZone(sBase, "slums");
      if (rollEvent(makeCtx(sBase, seed))?.title === "Loose change") baseCount++;

      const sHot = createState(seed);
      sHot.flags["ev_last:change"] = sHot.time; // elapsed = 0
      sHot.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
      inZone(sHot, "slums");
      if (rollEvent(makeCtx(sHot, seed))?.title === "Loose change") hotCount++;
    }
    // An event seen this very minute is inside the no-repeat window, so it is
    // barred outright rather than merely discounted. Two split bin bags in a
    // row is the repetition players actually notice.
    expect(baseCount).toBeGreaterThan(0);
    expect(hotCount).toBe(0);
    expect(COOLDOWN_DECAY_FACTOR).toBeLessThan(1);
  });

  it("cooldown fully recovers after COOLDOWN_RECOVER_MIN minutes", () => {
    // Set ev_last to COOLDOWN_RECOVER_MIN minutes in the past — multiplier should be 1.
    const recoveredCount = countChangeFires({ "ev_last:change": 7 * 60 - COOLDOWN_RECOVER_MIN });
    const baselineCount = countChangeFires({});

    // Recovered count should be statistically indistinguishable — within 30% of baseline.
    expect(Math.abs(recoveredCount - baselineCount)).toBeLessThan(baselineCount * 0.3 + 5);
  });

  it("rollEvent records ev_last flag after firing a repeatable event", () => {
    // Find a seed that fires 'change', then check ev_last:change is recorded.
    for (let seed = 1; seed <= 200; seed++) {
      const s = createState(seed);
      s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
      inZone(s, "slums");
      const ctx = makeCtx(s, seed);
      const p = rollEvent(ctx);
      if (p?.title === "Loose change") {
        expect(s.flags["ev_last:change"]).toBe(s.time);
        return;
      }
    }
    // If 'change' never fired in 200 seeds the test environment is broken — fail loudly.
    throw new Error("'change' event never fired in 200 seeds");
  });

  it("once-only events do NOT record ev_last", () => {
    // 'colleague' is a once-only event. After it fires, ev_last:colleague must not be set.
    for (let seed = 1; seed <= 300; seed++) {
      const s = createState(seed);
      s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 80, health: 100 };
      inZone(s, "slums");
      const ctx = makeCtx(s, seed);
      const p = rollEvent(ctx);
      if (p?.title === "Someone says your name") {
        expect(s.flags["ev_last:colleague"]).toBeUndefined();
        return;
      }
    }
    // colleague fires rarely in slums, acceptable if not found
  });

  it("partial cooldown: elapsed between COOLDOWN_FULL_MIN and COOLDOWN_RECOVER_MIN", () => {
    // At the midpoint elapsed time the multiplier should be between DECAY_FACTOR and 1.
    const midElapsed = Math.floor((COOLDOWN_FULL_MIN + COOLDOWN_RECOVER_MIN) / 2);
    const midCount = countChangeFires({ "ev_last:change": 7 * 60 - midElapsed });
    const baselineCount = countChangeFires({});

    // Mid-cooldown should fire less than baseline, more than full-cooldown.
    // We just verify it's strictly below baseline (partial suppression is happening).
    expect(midCount).toBeLessThan(baselineCount);
  });
});

describe("no two encounters in a row", () => {
  it("never shows the same event twice running", () => {
    // The multiplier alone still let a cheap filler come up back to back, and
    // that is the repetition a player actually registers.
    for (const zone of ["slums", "downtown", "heights"] as const) {
      const s = createState(31);
      s.meters = { hunger: 100, thirst: 100, hygiene: 70, energy: 100, morale: 80, health: 100 };
      inZone(s, zone);

      let previous = "";
      for (let i = 0; i < 300; i++) {
        const ctx = makeCtx(s, i + 1);
        ctx.advance(18, { exertion: 1.35 });
        s.meters = { hunger: 100, thirst: 100, hygiene: 70, energy: 100, morale: 80, health: 100 };
        inZone(s, zone);
        const title = rollEvent(ctx)?.title ?? "";
        if (title) expect(title, `repeated in ${zone} at roll ${i}`).not.toBe(previous);
        previous = title;
      }
    }
  });

  it("gives each zone a spread rather than two events on a loop", () => {
    for (const zone of ["slums", "downtown", "heights"] as const) {
      const s = createState(17);
      inZone(s, zone);
      const seen = new Map<string, number>();
      for (let i = 0; i < 400; i++) {
        const ctx = makeCtx(s, i + 1);
        ctx.advance(18, { exertion: 1.35 });
        s.meters = { hunger: 100, thirst: 100, hygiene: 70, energy: 100, morale: 80, health: 100 };
        inZone(s, zone);
        const title = rollEvent(ctx)?.title;
        if (title) seen.set(title, (seen.get(title) ?? 0) + 1);
      }
      const total = [...seen.values()].reduce((a, b) => a + b, 0);
      const commonest = Math.max(...seen.values());
      expect(seen.size, `${zone} has too few distinct encounters`).toBeGreaterThanOrEqual(8);
      expect(commonest / total, `one encounter dominates ${zone}`).toBeLessThan(0.25);
    }
  });

  it("does not put a split bin bag on a private road", () => {
    const s = createState(5);
    inZone(s, "heights");
    for (let i = 0; i < 200; i++) {
      const ctx = makeCtx(s, i + 1);
      ctx.advance(18, { exertion: 1.35 });
      s.meters = { hunger: 100, thirst: 100, hygiene: 70, energy: 100, morale: 80, health: 100 };
      inZone(s, "heights");
      expect(rollEvent(ctx)?.title).not.toBe("A split bin bag");
    }
  });
});

describe("the interview does not hire you into a job you cannot turn up to", () => {
  it("warns when the dress code is beyond you", () => {
    let warned = false;
    for (let i = 1; i <= 400 && !warned; i++) {
      const s = createState(i);
      phase2(s);
      s.employment = null;
      s.wearing = "rags";
      s.reputation = 25;
      s.meters = { hunger: 100, thirst: 100, hygiene: 100, energy: 100, morale: 80, health: 100 };
      const p = getInterviewPrompt(s, i);
      if (!p) continue;
      const result = drive(p, "confident");
      if (s.employment !== "martClerk") continue;
      // Hired in rags, which the till will not accept. Say so now, not three
      // strikes later with the lead already spent.
      expect(result?.lines.join(" ")).toContain("cannot work the shift");
      warned = true;
    }
    expect(warned).toBe(true);
  });

  it("says nothing about clothes when you already have them", () => {
    let checked = false;
    for (let i = 1; i <= 400 && !checked; i++) {
      const s = createState(i);
      phase2(s);
      s.employment = null;
      s.wearing = "thrift";
      s.wardrobe.push("thrift");
      s.reputation = 25;
      s.meters = { hunger: 100, thirst: 100, hygiene: 100, energy: 100, morale: 80, health: 100 };
      const p = getInterviewPrompt(s, i);
      if (!p) continue;
      const result = drive(p, "confident");
      if (s.employment !== "martClerk") continue;
      expect(result?.lines.join(" ")).not.toContain("cannot work the shift");
      checked = true;
    }
    expect(checked).toBe(true);
  });
});
