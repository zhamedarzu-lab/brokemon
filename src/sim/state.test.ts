import { describe, expect, it } from "vitest";
import { EMPLOYMENT } from "./jobs";
import { addItem } from "./items";
import { appearance, outfitRank, OUTFIT_ORDER } from "./social";
import { checkRequirements, createState, currentAppearance, netWorth, phaseOf } from "./state";

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
