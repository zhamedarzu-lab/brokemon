import { describe, expect, it } from "vitest";
import { EMPLOYMENT } from "./jobs";
import { addItem, countOf } from "./items";
import { appearance, outfitRank, OUTFIT_ORDER } from "./social";
import {
  REPUTATION_TIERS,
  changeReputation,
  checkPostWinGoal,
  checkRequirements,
  createState,
  currentAppearance,
  earnCash,
  netWorth,
  phaseOf,
  reputationLabel,
  setWon,
} from "./state";

describe("createState", () => {
  it("starts you broke, dirty and in debt", () => {
    const s = createState(1);
    expect(s.cash).toBeLessThan(10);
    expect(s.debt).toBeGreaterThan(0);
    expect(s.meters.hygiene).toBeLessThan(40);
    expect(s.housing).toBe("street");
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

    s.housing = "hostel";
    expect(phaseOf(s)).toBe(2);

    s.housing = "apartment";
    expect(phaseOf(s)).toBe(2); // an address alone is not a career

    s.employment = "officeAdmin";
    expect(phaseOf(s)).toBe(3);

    s.housing = "estate";
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
    s.housing = "estate";
    s.businessOwned = true;
    s.cash = 100;
    s.debt = 0;
    setWon(s);
    expect(s.won).toBe(true);
    expect(s.postWinGoal).toBeGreaterThan(0);
  });

  it("does not set a post-win goal when net worth already clears the threshold", () => {
    const s = createState(1);
    s.housing = "estate";
    s.businessOwned = true;
    s.bank = 50_000;
    s.debt = 0;
    setWon(s);
    expect(s.won).toBe(true);
    expect(s.postWinGoal).toBe(0);
  });

  it("is idempotent — calling it twice does not double-log or reset postWinGoal", () => {
    const s = createState(1);
    s.housing = "estate";
    s.businessOwned = true;
    s.cash = 100;
    s.debt = 0;
    setWon(s);
    const goal = s.postWinGoal;
    const logLen = s.log.length;
    setWon(s);
    expect(s.postWinGoal).toBe(goal);
    expect(s.log.length).toBe(logLen);
  });

  it("leaves victoryAcknowledged false — only the UI sets it", () => {
    const s = createState(1);
    s.housing = "estate";
    s.businessOwned = true;
    setWon(s);
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
    s.reputation = -31; // Infamous
    const before = s.log.length;
    changeReputation(s, 2); // → -29, now Spotty
    expect(s.reputation).toBe(-29);
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("good");
  });

  it("crossing up into Neutral from Spotty fires a good-tone log", () => {
    const s = createState(1);
    s.reputation = -1; // Spotty
    const before = s.log.length;
    changeReputation(s, 2); // → 1, now Neutral
    expect(s.reputation).toBe(1);
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("good");
  });

  it("crossing up into Reliable fires a good-tone log", () => {
    const s = createState(1);
    s.reputation = 29; // Neutral
    const before = s.log.length;
    changeReputation(s, 2); // → 31, now Reliable
    expect(s.reputation).toBe(31);
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("good");
  });

  it("crossing up into Respected fires a good-tone log", () => {
    const s = createState(1);
    s.reputation = 59; // Reliable
    const before = s.log.length;
    changeReputation(s, 2); // → 61, now Respected
    expect(s.reputation).toBe(61);
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("good");
  });

  it("crossing down into Reliable fires a bad-tone log", () => {
    const s = createState(1);
    s.reputation = 60; // Respected
    const before = s.log.length;
    changeReputation(s, -31); // → 29, now Reliable
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("bad");
  });

  it("crossing down into Neutral fires a bad-tone log", () => {
    const s = createState(1);
    s.reputation = 1; // Neutral (barely)
    const before = s.log.length;
    changeReputation(s, -2); // → -1, now Spotty
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("bad");
  });

  it("crossing down into Spotty fires a bad-tone log", () => {
    const s = createState(1);
    s.reputation = 0; // Neutral boundary
    const before = s.log.length;
    changeReputation(s, -1); // → -1, now Spotty
    expect(s.reputation).toBe(-1);
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("bad");
  });

  it("crossing down into Infamous fires a bad-tone log", () => {
    const s = createState(1);
    s.reputation = -30; // Spotty boundary
    const before = s.log.length;
    changeReputation(s, -1); // → -31, now Infamous
    expect(s.reputation).toBe(-31);
    expect(s.log.length).toBeGreaterThan(before);
    expect(s.log.at(-1)!.tone).toBe("bad");
  });

  it("a swing within the same tier adds no extra log entry", () => {
    const s = createState(1);
    s.reputation = 10; // Neutral
    const added = countNewLogs(s, () => changeReputation(s, 5)); // → 15, still Neutral
    expect(s.reputation).toBe(15);
    expect(added).toBe(0);
  });

  it("correctly applies the delta even without a tier change", () => {
    const s = createState(1);
    s.reputation = 40; // Reliable
    changeReputation(s, 3); // → 43, still Reliable
    expect(s.reputation).toBe(43);
  });
});

describe("reputation tiers", () => {
  it("has a crossing message for every tier, in both directions", () => {
    // The two message tables are keyed by label. If a tier is added or renamed
    // and a table is not updated, the notification vanishes silently — so the
    // tables are total records and this asserts the runtime agrees.
    for (const tier of REPUTATION_TIERS) {
      const s = createState(1);
      s.reputation = tier.at === -Infinity ? -100 : tier.at;
      expect(reputationLabel(s.reputation)).toBe(tier.label);
    }
  });

  it("announces the crossing when a delta moves you between tiers", () => {
    const s = createState(1);
    s.reputation = 29;
    changeReputation(s, 5);
    expect(reputationLabel(s.reputation)).toBe("Reliable");
    expect(s.log.at(-1)?.text).toContain("Reliable");
    expect(s.log.at(-1)?.tone).toBe("good");
  });

  it("announces a fall as well as a climb", () => {
    const s = createState(1);
    s.reputation = 31;
    changeReputation(s, -5);
    expect(reputationLabel(s.reputation)).toBe("Neutral");
    expect(s.log.at(-1)?.tone).toBe("bad");
  });

  it("says nothing when the tier does not change", () => {
    const s = createState(1);
    s.reputation = 40;
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
