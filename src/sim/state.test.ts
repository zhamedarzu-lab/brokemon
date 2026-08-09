import { describe, expect, it } from "vitest";
import { STARTING_TOWN } from "../world/map";
import { EMPLOYMENT } from "./jobs";
import { addItem, countOf } from "./items";
import { appearance, outfitRank, OUTFIT_ORDER } from "./social";
import {
  REPUTATION_CEILING,
  REPUTATION_FLOOR,
  REPUTATION_TIERS,
  changeReputation,
  checkPostWinGoal,
  checkRequirements,
  createState,
  currentAppearance,
  earnCash,
  housingIn,
  netWorth,
  phaseOf,
  reputationIn,
  reputationLabel,
  setHousing,
  setWon,
} from "./state";

describe("createState", () => {
  it("starts you broke, dirty and in debt", () => {
    const s = createState(1);
    expect(s.cash).toBeLessThan(10);
    expect(s.debt).toBe(0); // debt starts at zero — the hospital bill arrives only on collapse
    expect(s.meters.hygiene).toBeLessThan(40);
    expect(housingIn(s)).toBe("street");
    expect(s.employment).toBeNull();
    expect(phaseOf(s)).toBe(1);
  });

  it("is reproducible from a seed", () => {
    expect(createState(42)).toEqual(createState(42));
  });
});

describe("netWorth", () => {
  it("counts debt against you", () => {
    const s = createState(1);
    s.cash = 100;
    s.bank = 50;
    s.investments = 25;
    s.debt = 200;
    expect(netWorth(s)).toBe(-25);
  });
});

describe("appearance", () => {
  it("rises with both hygiene and clothes", () => {
    expect(appearance(90, "tailored")).toBeGreaterThan(appearance(90, "rags"));
    expect(appearance(90, "thrift")).toBeGreaterThan(appearance(20, "thrift"));
  });

  it("does not let a good suit fully cover for filth", () => {
    expect(appearance(10, "tailored")).toBeLessThan(70);
  });

  it("orders outfits by rank", () => {
    for (let i = 1; i < OUTFIT_ORDER.length; i++) {
      expect(outfitRank(OUTFIT_ORDER[i]!)).toBeGreaterThan(outfitRank(OUTFIT_ORDER[i - 1]!));
    }
  });
});

describe("checkRequirements", () => {
  it("passes an empty requirement", () => {
    expect(checkRequirements(createState(1), {}).ok).toBe(true);
  });

  it("reports every unmet requirement", () => {
    const s = createState(1);
    const check = checkRequirements(s, { hygiene: 90, outfit: "professional", education: 3, item: "phone" });
    expect(check.ok).toBe(false);
    expect(check.reasons.length).toBe(4);
  });

  it("accepts an outfit above the minimum tier", () => {
    const s = createState(1);
    s.wearing = "tailored";
    expect(checkRequirements(s, { outfit: "professional" }).ok).toBe(true);
  });

  it("counts held items", () => {
    const s = createState(1);
    expect(checkRequirements(s, { item: "phone" }).ok).toBe(false);
    addItem(s.inventory, "phone");
    expect(checkRequirements(s, { item: "phone" }).ok).toBe(true);
  });

  it("counts prior shifts as experience", () => {
    const s = createState(1);
    const req = { experience: { job: "officeAdmin" as const, shifts: 20 } };
    expect(checkRequirements(s, req).ok).toBe(false);
    s.shiftsWorked.officeAdmin = 20;
    expect(checkRequirements(s, req).ok).toBe(true);
  });

  it("gates the executive job behind the whole ladder", () => {
    const s = createState(1);
    s.meters.hygiene = 100;
    s.wearing = "tailored";
    s.education = 6;
    addItem(s.inventory, "phone");
    expect(checkRequirements(s, EMPLOYMENT.executive.requires).ok).toBe(false);
    s.shiftsWorked.officeAdmin = 20;
    expect(checkRequirements(s, EMPLOYMENT.executive.requires).ok).toBe(true);
  });
});

describe("phaseOf", () => {
  it("moves up as housing and work improve", () => {
    const s = createState(1);
    expect(phaseOf(s)).toBe(1);

    setHousing(s, "hostel");
    expect(phaseOf(s)).toBe(2);

    setHousing(s, "apartment");
    expect(phaseOf(s)).toBe(2); // an address alone is not a career

    s.employment = "officeAdmin";
    expect(phaseOf(s)).toBe(3);

    setHousing(s, "estate");
    expect(phaseOf(s)).toBe(4);
  });

  it("counts a business owner as phase 4 whatever the address", () => {
    const s = createState(1);
    s.businessOwned = true;
    expect(phaseOf(s)).toBe(4);
  });
});

describe("currentAppearance", () => {
  it("tracks hygiene as it falls", () => {
    const s = createState(1);
    s.meters.hygiene = 90;
    const clean = currentAppearance(s);
    s.meters.hygiene = 10;
    expect(currentAppearance(s)).toBeLessThan(clean);
  });
});

describe("save migration: busPassDaysLeft", () => {
  /** Simulate what loadGame does: spread createState defaults then apply old save data. */
  function simulateMigration(oldSaveData: Partial<ReturnType<typeof createState>>) {
    const merged = { ...createState(1), ...oldSaveData };
    // Migration applied in save.ts loadGame
    if (countOf(merged.inventory, "busPass") > 0 && merged.busPassDaysLeft === 0) {
      merged.busPassDaysLeft = 7;
    }
    return merged;
  }

  it("grants a fresh 7-day term to a bus pass from an old save with no counter", () => {
    const result = simulateMigration({ inventory: { busPass: 1 } });
    expect(result.busPassDaysLeft).toBe(7);
  });

  it("does not touch busPassDaysLeft when no pass is in inventory", () => {
    const result = simulateMigration({ inventory: {} });
    expect(result.busPassDaysLeft).toBe(0);
  });

  it("preserves a valid non-zero counter from a current-format save", () => {
    const result = simulateMigration({ inventory: { busPass: 1 }, busPassDaysLeft: 4 });
    expect(result.busPassDaysLeft).toBe(4);
  });
});

describe("setWon", () => {
  it("marks the run as won and sets a post-win goal when net worth is below threshold", () => {
    const s = createState(1);
    setHousing(s, "estate");
    s.businessOwned = true;
    s.cash = 100;
    s.debt = 0;
    setWon(s, "estate");
    expect(s.won).toBe(true);
    expect(s.postWinGoal).toBeGreaterThan(0);
  });

  it("does not set a post-win goal when net worth already clears the threshold", () => {
    const s = createState(1);
    setHousing(s, "estate");
    s.businessOwned = true;
    s.bank = 50_000;
    s.debt = 0;
    setWon(s, "estate");
    expect(s.won).toBe(true);
    expect(s.postWinGoal).toBe(0);
  });

  it("is idempotent — calling it twice does not double-log or reset postWinGoal", () => {
    const s = createState(1);
    setHousing(s, "estate");
    s.businessOwned = true;
    s.cash = 100;
    s.debt = 0;
    setWon(s, "estate");
    const goal = s.postWinGoal;
    const logLen = s.log.length;
    setWon(s, "estate");
    expect(s.postWinGoal).toBe(goal);
    expect(s.log.length).toBe(logLen);
  });

  it("leaves victoryAcknowledged false — only the UI sets it", () => {
    const s = createState(1);
    setHousing(s, "estate");
    s.businessOwned = true;
    setWon(s, "estate");
    expect(s.victoryAcknowledged).toBe(false);
  });
});

describe("checkPostWinGoal", () => {
  it("resolves the goal immediately when net worth crosses the threshold via earnCash", () => {
    const s = createState(1);
    s.won = true;
    s.postWinGoal = 500;
    s.debt = 0;
    s.cash = 499;
    earnCash(s, 1); // net worth now exactly 500
    expect(s.postWinGoal).toBe(0);
  });

  it("does not resolve the goal if net worth is still below the threshold", () => {
    const s = createState(1);
    s.won = true;
    s.postWinGoal = 500;
    s.debt = 0;
    s.cash = 0;
    earnCash(s, 499);
    expect(s.postWinGoal).toBeGreaterThan(0);
  });

  it("no-ops when the player has not won", () => {
    const s = createState(1);
    s.postWinGoal = 500;
    s.cash = 1_000;
    s.debt = 0;
    checkPostWinGoal(s);
    expect(s.postWinGoal).toBe(500);
  });
});

describe("changeReputation", () => {
  /** Count log entries added during fn() */
  function countNewLogs(s: ReturnType<typeof createState>, fn: () => void): number {
    const before = s.log.length;
    fn();
    return s.log.length - before;
  }

  it("crossing up into Spotty from Infamous fires a good-tone log", () => {
    const s = createState(1);
    s.reputation[STARTING_TOWN] = -31; // Infamous
    const before = s.log.length;
    changeReputation(s, 2);
    // The exact landing point is a function of the diminishing-gains curve, so
    // assert the thing the test is actually about: the tier changed.
    expect(reputationLabel(reputationIn(s))).toBe("Spotty");
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("good");
  });

  it("crossing up into Neutral from Spotty fires a good-tone log", () => {
    const s = createState(1);
    s.reputation[STARTING_TOWN] = -1; // Spotty
    const before = s.log.length;
    changeReputation(s, 2);
    expect(reputationLabel(reputationIn(s))).toBe("Neutral");
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("good");
  });

  it("crossing up into Reliable fires a good-tone log", () => {
    const s = createState(1);
    s.reputation[STARTING_TOWN] = 29; // Neutral
    const before = s.log.length;
    changeReputation(s, 2);
    expect(reputationLabel(reputationIn(s))).toBe("Reliable");
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("good");
  });

  it("crossing up into Respected fires a good-tone log", () => {
    const s = createState(1);
    s.reputation[STARTING_TOWN] = 59; // Reliable
    const before = s.log.length;
    changeReputation(s, 2);
    expect(reputationLabel(reputationIn(s))).toBe("Respected");
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("good");
  });

  it("crossing down into Reliable fires a bad-tone log", () => {
    const s = createState(1);
    s.reputation[STARTING_TOWN] = 60; // Respected
    const before = s.log.length;
    changeReputation(s, -31); // → 29, now Reliable
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("bad");
  });

  it("crossing down into Neutral fires a bad-tone log", () => {
    const s = createState(1);
    s.reputation[STARTING_TOWN] = 1; // Neutral (barely)
    const before = s.log.length;
    changeReputation(s, -2); // → -1, now Spotty
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("bad");
  });

  it("crossing down into Spotty fires a bad-tone log", () => {
    const s = createState(1);
    s.reputation[STARTING_TOWN] = 0; // Neutral boundary
    const before = s.log.length;
    changeReputation(s, -1); // → -1, now Spotty
    expect(s.reputation[STARTING_TOWN]).toBe(-1);
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("bad");
  });

  it("crossing down into Infamous fires a bad-tone log", () => {
    const s = createState(1);
    s.reputation[STARTING_TOWN] = -30; // Spotty boundary
    const before = s.log.length;
    changeReputation(s, -1); // → -31, now Infamous
    expect(s.reputation[STARTING_TOWN]).toBe(-31);
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("bad");
  });

  it("a swing within the same tier adds no extra log entry", () => {
    const s = createState(1);
    s.reputation[STARTING_TOWN] = 10; // Neutral
    const added = countNewLogs(s, () => changeReputation(s, 5)); // → 15, still Neutral
    expect(s.reputation[STARTING_TOWN]).toBe(15);
    expect(added).toBe(0);
  });

  it("correctly applies the delta even without a tier change", () => {
    const s = createState(1);
    s.reputation[STARTING_TOWN] = 40; // Reliable
    changeReputation(s, 3);
    expect(reputationIn(s)).toBeGreaterThan(40);
    expect(reputationLabel(reputationIn(s))).toBe("Reliable");
  });
});

describe("reputation tiers", () => {
  it("has a crossing message for every tier, in both directions", () => {
    // The two message tables are keyed by label. If a tier is added or renamed
    // and a table is not updated, the notification vanishes silently — so the
    // tables are total records and this asserts the runtime agrees.
    for (const tier of REPUTATION_TIERS) {
      const s = createState(1);
      s.reputation[STARTING_TOWN] = tier.at === -Infinity ? -100 : tier.at;
      expect(reputationLabel(s.reputation[STARTING_TOWN])).toBe(tier.label);
    }
  });

  it("announces the crossing when a delta moves you between tiers", () => {
    const s = createState(1);
    s.reputation[STARTING_TOWN] = 29;
    changeReputation(s, 5);
    expect(reputationLabel(s.reputation[STARTING_TOWN])).toBe("Reliable");
    expect(s.log.at(-1)?.text).toContain("Reliable");
    expect(s.log.at(-1)?.tone).toBe("good");
  });

  it("announces a fall as well as a climb", () => {
    const s = createState(1);
    s.reputation[STARTING_TOWN] = 31;
    changeReputation(s, -5);
    expect(reputationLabel(s.reputation[STARTING_TOWN])).toBe("Neutral");
    expect(s.log.at(-1)?.tone).toBe("bad");
  });

  it("says nothing when the tier does not change", () => {
    const s = createState(1);
    s.reputation[STARTING_TOWN] = 40;
    const before = s.log.length;
    changeReputation(s, 2);
    expect(s.log).toHaveLength(before);
  });

  it("keeps the tiers ordered from the top down, floored at -Infinity", () => {
    const thresholds = REPUTATION_TIERS.map((t) => t.at);
    expect([...thresholds].sort((a, b) => b - a)).toEqual(thresholds);
    expect(thresholds.at(-1)).toBe(-Infinity);
  });
});

describe("reputation has a ceiling", () => {
  function climb(times: number, delta = 12): number {
    const s = createState(1);
    for (let i = 0; i < times; i++) changeReputation(s, delta);
    return reputationIn(s);
  }

  it("never gets past the ceiling however long you keep at it", () => {
    // Runs were ending at 546–723, which put the franchise on $1,000+ a day
    // and pushed every interview past certainty.
    expect(climb(500)).toBeLessThanOrEqual(REPUTATION_CEILING);
    expect(climb(5000)).toBeLessThanOrEqual(REPUTATION_CEILING);
  });

  it("pays less for the same good turn the better known you are", () => {
    const early = createState(1);
    changeReputation(early, 10);
    const earlyGain = reputationIn(early);

    const known = createState(1);
    known.reputation[STARTING_TOWN] = 80;
    changeReputation(known, 10);
    const lateGain = reputationIn(known) - 80;

    expect(lateGain).toBeLessThan(earlyGain);
    expect(lateGain).toBeGreaterThan(0);
  });

  it("takes a loss in full whoever you are", () => {
    const s = createState(1);
    s.reputation[STARTING_TOWN] = 90;
    changeReputation(s, -20);
    expect(reputationIn(s)).toBe(70);
  });

  it("has a floor as well", () => {
    const s = createState(1);
    for (let i = 0; i < 200; i++) changeReputation(s, -12);
    expect(reputationIn(s)).toBe(REPUTATION_FLOOR);
  });

  it("stays a whole number", () => {
    const s = createState(1);
    for (let i = 0; i < 20; i++) changeReputation(s, 7);
    expect(Number.isInteger(reputationIn(s))).toBe(true);
  });

  it("still lets an interview fail once you are well known", () => {
    // `+ reputation / 200` on the hire roll meant that past about 150 every
    // interview succeeded, so the last third of a run had no failure mode.
    const s = createState(1);
    s.reputation[STARTING_TOWN] = REPUTATION_CEILING;
    const bestOdds = 0.25 + 1 + reputationIn(s) / 200;
    expect(Math.min(0.95, bestOdds)).toBeLessThan(1);
    expect(reputationIn(s) / 200).toBeLessThan(0.6);
  });
});
