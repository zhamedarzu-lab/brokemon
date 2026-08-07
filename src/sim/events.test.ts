import { describe, expect, it } from "vitest";
import { rollEvent } from "./events";
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
  if (zone === "slums") s.player.pos = { x: 10, y: 42 };
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
    const s = createState(1);
    s.cash = 10;
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
    drive(prompt, "drop a dollar");
    expect(s.meters.morale).toBeGreaterThan(moraleBefore);
    expect(s.cash).toBe(9);
  });

  it("dollar option is locked when broke", () => {
    const s = createState(1);
    s.cash = 0;
    s.meters = { hunger: 100, thirst: 100, hygiene: 80, energy: 100, morale: 50, health: 100 };
    inZone(s, "slums");
    let prompt: Prompt | null = null;
    for (let i = 1; i <= 400; i++) {
      const ctx = makeCtx(s, i);
      const p = rollEvent(ctx);
      if (p?.title === "A man with a guitar case") { prompt = p; break; }
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
function getInterviewPrompt(s: GameState): Prompt | null {
  s.flags.colleagueInterviewPending = 1;
  inZone(s, "downtown");
  for (let i = 1; i <= 500; i++) {
    delete s.flags["ev:colleagueInterview"];
    delete s.flags.colleagueInterviewDone;
    const ctx = makeCtx(s, i);
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
      const p = getInterviewPrompt(s);
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
      const p = getInterviewPrompt(s);
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
        const p = getInterviewPrompt(s);
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
      const p = getInterviewPrompt(s);
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
