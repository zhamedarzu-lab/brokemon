import { describe, expect, it } from "vitest";
import { markerPos } from "../world/map";
import { interact } from "./actions";
import { countOf, type ItemId } from "./items";
import type { Choice, Prompt } from "./prompt";
import { Rng } from "./rng";
import { createState, currentAppearance, phaseOf, type Facing, type GameState } from "./state";
import { advance } from "./tick";
import { hourOf, minutesUntilHour } from "./time";
import { consume, type ActionCtx } from "./work";

/**
 * A headless player. It walks nowhere — it teleports to a tile, faces a thing,
 * presses the interact button, and picks options off the real prompt tree. That
 * exercises the actual venue and gig code rather than a parallel model of it.
 */
class Bot {
  readonly state: GameState;
  readonly rng: Rng;
  readonly ctx: ActionCtx;

  constructor(seed: number) {
    this.state = createState(seed);
    this.rng = new Rng(seed);
    this.ctx = {
      state: this.state,
      rng: this.rng,
      advance: (minutes, opts) => void advance(this.state, this.rng, { minutes, ...opts }),
      teleport: (x, y) => {
        this.state.player.pos = { x, y };
      },
    };
  }

  standOn(marker: string): void {
    const p = markerPos(marker);
    this.state.player.pos = { x: p.x, y: p.y };
  }

  standAt(x: number, y: number, facing: Facing): void {
    this.state.player.pos = { x, y };
    this.state.player.facing = facing;
  }

  press(): Prompt | null {
    return interact(this.ctx);
  }

  /** Follow a chain of choices by case-insensitive label fragment. */
  drive(prompt: Prompt | null, ...path: string[]): Prompt | null {
    let current = prompt;
    for (const step of path) {
      if (!current?.choices) return current;
      const choice: Choice | undefined = current.choices.find(
        (c) => !c.locked && c.label.toLowerCase().includes(step.toLowerCase()),
      );
      if (!choice) return null;
      current = choice.run?.() ?? null;
    }
    return current;
  }

  /** True if the option exists and isn't greyed out. */
  canChoose(prompt: Prompt | null, label: string): boolean {
    return Boolean(prompt?.choices?.some((c) => !c.locked && c.label.toLowerCase().includes(label.toLowerCase())));
  }

  waitUntilHour(hour: number): void {
    const minutes = minutesUntilHour(this.state.time, hour);
    if (minutes > 0 && minutes < 24 * 60) this.ctx.advance(minutes);
  }

  eatIfHungry(): void {
    const s = this.state;
    const order: ItemId[] = ["sandwich", "hotMeal", "instantNoodles", "trashFood"];
    while (s.meters.hunger < 60) {
      const pick = order.find((id) => countOf(s.inventory, id) > 0);
      if (!pick) break;
      consume(this.ctx, pick);
    }
    while (s.meters.thirst < 60 && countOf(s.inventory, "waterBottle") > 0) {
      consume(this.ctx, "waterBottle");
    }
  }

  /** The fountain sits in the Market Square plaza; marble tiles to its left. */
  drinkAtFountain(): void {
    for (let i = 0; i < 3 && this.state.meters.thirst < 85; i++) {
      this.standAt(25, 32, "right");
      this.drive(this.press(), "drink");
    }
  }

  /** Free shower at the community center, which is the only way back up. */
  washAtShelter(): void {
    if (this.state.meters.hygiene >= 60) return;
    this.standOn("communityCenter");
    this.drive(this.press(), "wash up");
  }
}

const DUMPSTERS: Array<[number, number, Facing]> = [
  [14, 26, "up"],
  [29, 26, "up"],
  [24, 43, "up"],
  [35, 43, "up"],
];

function scavengeRound(bot: Bot): void {
  for (const [x, y, facing] of DUMPSTERS) {
    bot.standAt(x, y, facing);
    bot.drive(bot.press(), "close the lid");
  }
  if (countOf(bot.state.inventory, "recyclables") > 0) {
    bot.standOn("recycling");
    bot.drive(bot.press(), "feed it in");
  }
}

function panhandleRound(bot: Bot, sessions: number): void {
  for (let i = 0; i < sessions; i++) {
    bot.standOn("panhandleSpot");
    bot.drive(bot.press(), "sit down and ask", "get up");
  }
}

/** One day of scraping by with no job, no bed and no money. */
function survivalDay(bot: Bot): void {
  bot.waitUntilHour(8);

  // The free shower and the food parcel are the whole of the safety net.
  bot.washAtShelter();
  bot.standOn("communityCenter");
  bot.drive(bot.press(), "food bank");

  bot.eatIfHungry();
  bot.drinkAtFountain();

  scavengeRound(bot);
  panhandleRound(bot, 3);

  bot.eatIfHungry();
  bot.drinkAtFountain();

  // Afternoon: the bins have had time to fill again.
  bot.waitUntilHour(17);
  scavengeRound(bot);
  panhandleRound(bot, 2);

  bot.eatIfHungry();
  bot.drinkAtFountain();
  bot.washAtShelter();

  // Bed down in the outskirts, where there's no camping ordinance.
  bot.waitUntilHour(20);
  bot.standAt(27, 42, "up");
  bot.drive(bot.press(), "sleep here");
}

describe("phase 1 — the streets", () => {
  it("lets a careful player survive two weeks with nothing", () => {
    const bot = new Bot(7);
    for (let day = 0; day < 14; day++) survivalDay(bot);

    const s = bot.state;
    expect(s.meters.health).toBeGreaterThan(0);
    expect(s.daysSurvived).toBeGreaterThanOrEqual(13);
    // Scraping by is survivable, but it should never be comfortable.
    expect(s.collapses).toBeLessThanOrEqual(2);
  });

  it("earns enough over two weeks to buy in to phase 2", () => {
    const bot = new Bot(11);
    for (let day = 0; day < 14; day++) survivalDay(bot);
    // Soap ($4) + thrift clothes ($15) + a hostel cot ($9) is the way off the street.
    expect(bot.state.cash).toBeGreaterThan(28);
  });

  it("does not let panhandling alone make anyone rich", () => {
    const bot = new Bot(3);
    let total = 0;
    for (let i = 0; i < 40; i++) {
      const before = bot.state.cash;
      bot.standOn("panhandleSpot");
      bot.drive(bot.press(), "sit down and ask", "get up");
      total += bot.state.cash - before;
      bot.state.meters.morale = 80;
      bot.state.meters.energy = 80;
    }
    // Twenty hours on the corner. It should read as grim, not as a strategy.
    expect(total).toBeLessThan(200);
  });

  it("pays out from an untouched dumpster on the first morning", () => {
    const bot = new Bot(21);
    const [x, y, facing] = DUMPSTERS[0]!;
    bot.standAt(x, y, facing);
    const prompt = bot.press();
    expect(prompt?.lines.join(" ")).toContain("You find");
    expect(countOf(bot.state.inventory, "recyclables")).toBeGreaterThan(0);
  });

  it("will not let you strip the same dumpster twice in a row", () => {
    const bot = new Bot(21);
    const [x, y, facing] = DUMPSTERS[0]!;
    bot.standAt(x, y, facing);
    bot.press();
    bot.standAt(x, y, facing);
    expect(bot.press()?.lines.join(" ")).toContain("already been through");
  });

  it("refills a dumpster after eight hours", () => {
    const bot = new Bot(21);
    const [x, y, facing] = DUMPSTERS[0]!;
    bot.standAt(x, y, facing);
    bot.press();
    bot.ctx.advance(9 * 60);
    bot.standAt(x, y, facing);
    expect(bot.press()?.lines.join(" ")).toContain("You find");
  });

  it("keeps you out of the Mart while you look like that", () => {
    const bot = new Bot(5);
    bot.state.meters.hygiene = 5;
    expect(currentAppearance(bot.state)).toBeLessThan(28);
    bot.standOn("mart");
    const prompt = bot.press();
    expect(prompt?.choices ?? []).toHaveLength(0);
    expect(prompt?.tone).toBe("bad");
  });

  it("lets you shop once you've washed and changed", () => {
    const bot = new Bot(5);
    bot.state.meters.hygiene = 70;
    bot.state.cash = 50;
    bot.standOn("mart");
    const prompt = bot.press();
    expect(bot.canChoose(prompt, "buy something")).toBe(true);

    const shopping = bot.drive(prompt, "buy something");
    expect(bot.canChoose(shopping, "soap")).toBe(true);
    bot.drive(shopping, "soap");
    expect(countOf(bot.state.inventory, "soap")).toBe(1);
    expect(bot.state.cash).toBe(46);
  });
});

describe("phase 2 — off the street", () => {
  it("opens the hostel as soon as you have the nightly rate", () => {
    const bot = new Bot(9);
    bot.state.meters = { hunger: 90, thirst: 90, hygiene: 60, energy: 40, morale: 60, health: 90 };
    bot.state.cash = 3;
    bot.standOn("hostel");
    expect(bot.canChoose(bot.press(), "pay for a cot")).toBe(false);

    bot.waitUntilHour(21);
    bot.state.cash = 20;
    bot.standOn("hostel");
    bot.drive(bot.press(), "pay for a cot", "get up");
    expect(bot.state.housing).toBe("hostel");
    expect(phaseOf(bot.state)).toBe(2);
    expect(bot.state.cash).toBe(11);
  });

  it("rents the trailer for a week and sets the rent clock", () => {
    const bot = new Bot(9);
    bot.state.cash = 100;
    bot.standOn("trailer");
    bot.drive(bot.press(), "take it");
    expect(bot.state.housing).toBe("trailer");
    expect(bot.state.cash).toBe(30);
    expect(bot.state.rentDueDay).toBeGreaterThan(1);
  });

  it("pays better for a mart shift than for a day on the corner", () => {
    const bot = new Bot(13);
    const s = bot.state;
    s.meters = { hunger: 90, thirst: 90, hygiene: 85, energy: 90, morale: 70, health: 90 };
    s.wearing = "thrift";
    s.wardrobe.push("thrift");
    s.employment = "martClerk";
    bot.waitUntilHour(10);

    const before = s.cash;
    bot.standOn("mart");
    bot.drive(bot.press(), "clock in", "clock out");
    expect(s.cash - before).toBeGreaterThan(30);
    expect(s.shiftsWorked.martClerk).toBe(1);
  });

  it("sends you home unpaid if you turn up in the state you slept in", () => {
    const bot = new Bot(13);
    const s = bot.state;
    // Clean enough to be let through the door, nowhere near clean enough to work.
    s.meters = { hunger: 90, thirst: 90, hygiene: 55, energy: 90, morale: 70, health: 90 };
    s.employment = "martClerk";
    bot.waitUntilHour(10);

    const before = s.cash;
    bot.standOn("mart");
    bot.drive(bot.press(), "clock in");
    expect(s.cash).toBe(before);
    expect(s.strikes).toBeGreaterThan(0);
  });
});

describe("phase 3 and 4 — the ladder", () => {
  it("refuses the plaza to anyone who looks like phase 1", () => {
    const bot = new Bot(2);
    bot.state.meters.hygiene = 20;
    bot.standOn("corporatePlaza");
    const prompt = bot.press();
    expect(prompt?.tone).toBe("bad");
    expect(prompt?.choices ?? []).toHaveLength(0);
  });

  it("locks the apartment behind credit, deposit and a career job", () => {
    const bot = new Bot(2);
    const s = bot.state;
    bot.standOn("apartment");
    expect(bot.canChoose(bot.press(), "sign the lease")).toBe(false);

    s.credit = 700;
    s.cash = 2000;
    s.employment = "officeAdmin";
    bot.standOn("apartment");
    bot.drive(bot.press(), "sign the lease");
    expect(s.housing).toBe("apartment");
    expect(phaseOf(s)).toBe(3);
  });

  it("only sells the estate to someone who can actually pay for it", () => {
    const bot = new Bot(2);
    const s = bot.state;
    s.cash = 84_000;
    s.credit = 800;
    bot.standOn("estate");
    expect(bot.canChoose(bot.press(), "make an offer")).toBe(false);

    s.bank = 5_000;
    bot.standOn("estate");
    bot.drive(bot.press(), "make an offer");
    expect(s.housing).toBe("estate");
    expect(s.cash + s.bank).toBe(4_000);
    expect(phaseOf(s)).toBe(4);
  });

  it("declares victory on the estate plus a business", () => {
    const bot = new Bot(2);
    const s = bot.state;
    s.housing = "apartment";
    s.employment = "officeAdmin";
    s.cash = 20_000;
    s.credit = 750;
    s.meters.hygiene = 95;
    s.wearing = "professional";
    bot.waitUntilHour(10);

    bot.standOn("corporatePlaza");
    bot.drive(bot.press(), "buy the mart franchise");
    expect(s.businessOwned).toBe(true);
    expect(s.won).toBe(false);

    s.cash = 90_000;
    s.credit = 800;
    bot.standOn("estate");
    bot.drive(bot.press(), "make an offer");
    expect(s.won).toBe(true);
  });

  it("charges for night classes and hands out one credit at a time", () => {
    const bot = new Bot(4);
    const s = bot.state;
    s.cash = 200;
    s.meters = { hunger: 90, thirst: 90, hygiene: 70, energy: 90, morale: 70, health: 90 };
    bot.waitUntilHour(19);

    bot.standOn("college");
    bot.drive(bot.press(), "attend");
    expect(s.education).toBe(1);
    expect(s.cash).toBe(155);
    // Three hours gone: the class runs you past closing.
    expect(hourOf(s.time)).toBeGreaterThanOrEqual(22);
  });
});

describe("the gate on the hill", () => {
  it("turns you back when you don't look like you belong", () => {
    const bot = new Bot(6);
    bot.state.meters.hygiene = 30;
    bot.standAt(23, 15, "up");
    const prompt = bot.press();
    expect(prompt?.tone).toBe("bad");
    expect(bot.state.player.pos.y).toBe(15);
  });

  it("waves through anyone dressed for it", () => {
    const bot = new Bot(6);
    bot.state.meters.hygiene = 95;
    bot.state.wearing = "professional";
    bot.standAt(23, 15, "up");
    bot.press();
    expect(bot.state.player.pos.y).toBe(13);
  });

  it("always lets you back down the hill", () => {
    const bot = new Bot(6);
    bot.state.meters.hygiene = 5;
    bot.standAt(23, 13, "down");
    bot.press();
    expect(bot.state.player.pos.y).toBe(15);
  });
});
