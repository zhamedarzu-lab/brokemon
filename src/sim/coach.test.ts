import { beforeEach, describe, expect, it } from "vitest";
import { markerPos, townById, zoneAt } from "../world/map";

import { interact } from "./actions";
import {
  boardingReasons,
  firstDeparture,
  fmtDeparture,
  lastDeparture,
  nextDeparture,
  serviceFrom,
  waitFor,
  type CoachService,
} from "./coach";
import type { Choice, Prompt } from "./prompt";
import { Rng } from "./rng";
import { loadGame, saveGame } from "./save";
import { ITEMS } from "./items";
import { EMPLOYMENT, employmentIn } from "./jobs";
import { HOUSING } from "./social";
import { createState, housingIn, phaseOf, REPUTATION_CEILING, reputationIn, setWon, type GameState } from "./state";
import { advance, BLOCK_RENT_ROLL, STALL_BASE, STALL_PER_REPUTATION } from "./tick";
import { rollEvent } from "./events";
import { BLOCK_PRICE, BLOCK_REPUTATION, PITCH_PRICE } from "./venues";
import { minuteOfDay } from "./time";
import { type ActionCtx } from "./work";

const BROKEMON = townById("brokemon");
const BROKEDALE = townById("brokedale");

const OUT = serviceFrom("brokemon")!;
const BACK = serviceFrom("brokedale")!;

/**
 * A bot that teleports around one town and rides the coach between two. It
 * cannot see what the crossing costs in walking — that is the playtest rig's
 * job, in Phase 4 — but it can see the timetable, the fare and the clock.
 */
class Player {
  readonly s: GameState;
  readonly rng: Rng;
  readonly ctx: ActionCtx;

  constructor(seed = 1) {
    this.s = createState(seed);
    this.rng = new Rng(seed);
    this.ctx = {
      state: this.s,
      rng: this.rng,
      advance: (m, o) => void advance(this.s, this.rng, { minutes: m, ...o }),
      teleport: (x, y) => {
        this.s.player.pos = { x, y };
      },
    };
  }

  /** Stand on a marker in whichever town the player is currently in. */
  goto(marker: string): void {
    const p = markerPos(townById(this.s.player.town), marker);
    this.s.player.pos = { x: p.x, y: p.y };
  }

  /** Move the clock to a given hour today; never rolls over into tomorrow. */
  setClock(hour: number, minute = 0): void {
    this.s.time = this.s.time - minuteOfDay(this.s.time) + hour * 60 + minute;
  }

  press(): Prompt | null {
    return interact(this.ctx);
  }

  drive(p: Prompt | null, ...path: string[]): Prompt | null {
    let cur = p;
    for (const step of path) {
      const c = this.choiceFor(cur, step);
      if (!c) return null;
      cur = c.run?.() ?? null;
    }
    return cur;
  }

  took(p: Prompt | null, ...path: string[]): boolean {
    let cur = p;
    for (const step of path) {
      const c = this.choiceFor(cur, step);
      if (!c) return false;
      cur = c.run?.() ?? null;
    }
    return true;
  }

  private choiceFor(p: Prompt | null, step: string): Choice | undefined {
    return p?.choices?.find((q) => !q.locked && q.label.toLowerCase().includes(step.toLowerCase()));
  }

  lockReason(p: Prompt | null, label: string): string | null {
    return p?.choices?.find((q) => q.label.toLowerCase().includes(label.toLowerCase()))?.locked ?? null;
  }

  /** Ride out to Brokedale with enough money and time to be sure it works. */
  rideOut(hour = 9): void {
    this.setClock(hour);
    this.s.cash = 200;
    this.goto("busStop");
    this.drive(this.press(), "Brokedale", "Get off");
  }
}

/* ---------------------------------------------------------- the timetable */

describe("the timetable", () => {
  it("runs both ways, out early and back late", () => {
    // The last coach out is early enough that taking it commits you to the
    // night; the last one back is late enough to be a real deadline.
    expect(lastDeparture(OUT)).toBeLessThan(lastDeparture(BACK));
    expect(firstDeparture(OUT)).toBeLessThanOrEqual(firstDeparture(BACK));
  });

  it("keeps its departures in ascending order", () => {
    for (const service of [OUT, BACK]) {
      const sorted = [...service.departures].sort((a, b) => a - b);
      expect(service.departures).toEqual(sorted);
    }
  });

  it("finds the next departure, not one that has gone", () => {
    const p = new Player();
    p.setClock(10, 17);
    expect(nextDeparture(OUT, p.s.time)).toBe(11 * 60);
    expect(waitFor(OUT, p.s.time)).toBe(43);
  });

  it("lets you straight on if you turn up on the minute", () => {
    const p = new Player();
    p.setClock(11, 0);
    expect(waitFor(OUT, p.s.time)).toBe(0);
  });

  it("has nothing left once the last one has gone", () => {
    const p = new Player();
    p.setClock(23, 30);
    expect(nextDeparture(OUT, p.s.time)).toBeNull();
    expect(waitFor(OUT, p.s.time)).toBeNull();
  });

  it("prints departures the way a timetable does", () => {
    expect(fmtDeparture(6 * 60)).toBe("6AM");
    expect(fmtDeparture(6 * 60 + 30)).toBe("6:30AM");
    expect(fmtDeparture(12 * 60)).toBe("12PM");
    expect(fmtDeparture(23 * 60)).toBe("11PM");
  });
});

/* ---------------------------------------------------------- getting there */

describe("riding out to Brokedale", () => {
  it("charges the fare, waits for the coach, and takes forty minutes on top", () => {
    const p = new Player();
    p.setClock(10, 30);
    p.s.cash = 50;
    const t0 = p.s.time;

    p.goto("busStop");
    expect(p.took(p.press(), "Brokedale", "Get off")).toBe(true);

    expect(p.s.cash).toBe(50 - OUT.fare);
    // Thirty minutes on the stand for the eleven o'clock, then the journey.
    expect(p.s.time - t0).toBe(30 + OUT.minutes);
  });

  it("puts you down at the Brokedale coach stand", () => {
    const p = new Player();
    p.rideOut();
    expect(p.s.player.town).toBe("brokedale");
    expect(p.s.player.pos).toEqual(markerPos(BROKEDALE, "coachTerminal"));
  });

  it("will not sell you a ticket you cannot pay for", () => {
    const p = new Player();
    p.setClock(9);
    p.s.cash = OUT.fare - 1;
    p.goto("busStop");
    const stop = p.press();
    expect(p.took(stop, "Brokedale")).toBe(false);
    expect(p.lockReason(stop, "Brokedale")).toMatch(/fare/i);
  });

  it("stops running for the night, and says when the next one is", () => {
    const p = new Player();
    p.setClock(22, 0);
    p.s.cash = 200;
    p.goto("busStop");
    const stop = p.press();
    expect(p.took(stop, "Brokedale")).toBe(false);
    expect(p.lockReason(stop, "Brokedale")).toMatch(/last one/i);
    expect(p.lockReason(stop, "Brokedale")).toMatch(/tomorrow/i);
  });

  it("costs more to come back than to go", () => {
    // Deliberate. Getting stranded on the far side should be possible early,
    // survivable, and remembered.
    expect(BACK.fare).toBeGreaterThan(OUT.fare);
  });
});

/* ------------------------------------------------------------ and back */

describe("getting home again", () => {
  it("runs a service the other way from the terminal", () => {
    const p = new Player();
    p.rideOut(8);
    p.setClock(12, 0);
    p.s.cash = 100;

    p.goto("coachTerminal");
    expect(p.took(p.press(), "Brokemon Town", "Get off")).toBe(true);

    expect(p.s.player.town).toBe("brokemon");
    expect(p.s.player.pos).toEqual(markerPos(BROKEMON, "busStop"));
    expect(p.s.cash).toBe(100 - BACK.fare);
  });

  it("strands you overnight if you spent the return fare", () => {
    const p = new Player();
    p.rideOut(9);
    p.s.cash = 2;
    p.goto("coachTerminal");
    const terminal = p.press();

    expect(p.took(terminal, "Brokemon Town")).toBe(false);
    // ...but the concourse is open, which is the whole point of it.
    expect(p.took(terminal, "concourse", "Get up")).toBe(true);
    expect(p.s.player.town).toBe("brokedale");
  });
});

/* ------------------------------------------------- what stays behind */

describe("what a town keeps when you leave it", () => {
  it("does not carry your name across", () => {
    const p = new Player();
    p.s.reputation.brokemon = 55;
    p.rideOut();
    expect(reputationIn(p.s, "brokemon")).toBe(55);
    expect(reputationIn(p.s)).toBe(0);
  });

  it("does not carry your address across either", () => {
    const p = new Player();
    p.s.housing.brokemon = "trailer";
    p.rideOut();
    expect(housingIn(p.s, "brokemon")).toBe("trailer");
    expect(housingIn(p.s)).toBe("street");
  });

  it("still takes the rent on a room you are nowhere near", () => {
    const p = new Player();
    p.s.housing.brokemon = "trailer";
    p.s.rentDueDay.brokemon = 2;
    p.rideOut(8);

    // Stay over, and let the day turn while you are on the wrong side of it.
    p.setClock(23, 50);
    p.s.cash = 500;
    p.ctx.advance(20, { sheltered: true, asleep: true });

    expect(p.s.player.town).toBe("brokedale");
    expect(p.s.cash).toBe(500 - HOUSING.trailer.rent);
    expect(p.s.log.some((l) => /Rent taken/.test(l.text) && /Brokemon Town/.test(l.text))).toBe(true);
  });
});

/* -------------------------------------------------------- across a save */

/** localStorage does not exist under vitest's default environment. */
function useMemoryStorage(): void {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe("saving across the link", () => {
  beforeEach(() => useMemoryStorage());

  it("brings you back in the town you left off in", () => {
    const p = new Player();
    p.rideOut();
    expect(saveGame(p.s)).toBe(true);

    const loaded = loadGame()!;
    expect(loaded.player.town).toBe("brokedale");
    expect(loaded.player.pos).toEqual(markerPos(BROKEDALE, "coachTerminal"));
  });

  it("keeps both towns' reputations apart through a round trip", () => {
    const p = new Player();
    p.s.reputation.brokemon = 40;
    p.s.reputation.brokedale = -12;
    saveGame(p.s);

    const loaded = loadGame()!;
    expect(loaded.reputation.brokemon).toBe(40);
    expect(loaded.reputation.brokedale).toBe(-12);
  });
});

/* ------------------------------------------------------- boarding checks */

describe("boardingReasons", () => {
  const reasons = (s: GameState, service: CoachService) => boardingReasons(s, service).join(" | ");

  it("names both problems when both apply", () => {
    const p = new Player();
    p.setClock(23, 45);
    p.s.cash = 0;
    expect(reasons(p.s, OUT)).toMatch(/fare/);
    expect(reasons(p.s, OUT)).toMatch(/last one/);
  });

  it("says nothing when you can simply get on", () => {
    const p = new Player();
    p.setClock(9);
    p.s.cash = 100;
    expect(boardingReasons(p.s, OUT)).toEqual([]);
  });
});

/* --------------------------------------------------------- living there */

describe("Brokedale, as somewhere to live", () => {
  it("takes anyone at the agency muster, and only in the morning", () => {
    const p = new Player();
    p.rideOut(7);
    p.goto("agency");
    // Deliberately wretched: no clothes, no reputation, morale on the floor.
    p.s.meters.morale = 1;
    p.s.meters.energy = 60;
    p.setClock(8);
    expect(p.took(p.press(), "put your name down", "leave"), "turned away at 8AM").toBe(true);

    const later = new Player(2);
    later.rideOut(9);
    later.setClock(15);
    later.goto("agency");
    expect(later.press()?.lines.join(" ")).toMatch(/vans have gone/i);
  });

  it("pays site work in cash and knows your face a little better for it", () => {
    const p = new Player();
    p.rideOut(7);
    p.setClock(8);
    p.s.cash = 0;
    p.s.meters.energy = 80;
    p.goto("agency");
    p.drive(p.press(), "put your name down");
    expect(p.s.cash).toBeGreaterThan(50);
    expect(reputationIn(p.s, "brokedale")).toBeGreaterThan(0);
    // Six hours of it, and it takes six hours off you.
    expect(p.s.meters.energy).toBeLessThan(40);
  });

  it("lets a room by the week, two weeks up front, without running your credit", () => {
    const p = new Player();
    p.rideOut(9);
    p.s.credit = 300;
    p.s.cash = HOUSING.room.rent * 2;
    p.goto("weeklyRooms");
    expect(p.took(p.press(), "take it")).toBe(true);
    expect(housingIn(p.s, "brokedale")).toBe("room");
    // And it is a Brokedale address, not a Brokemon one.
    expect(housingIn(p.s, "brokemon")).toBe("street");
  });

  it("charges that rent every week, in Brokedale, wherever you are standing", () => {
    const p = new Player();
    p.rideOut(9);
    p.s.cash = HOUSING.room.rent * 2;
    p.goto("weeklyRooms");
    expect(p.took(p.press(), "take it")).toBe(true);
    p.goto("coachTerminal");
    p.s.cash = 500;
    p.drive(p.press(), "Brokemon Town", "Get off");
    expect(p.s.player.town).toBe("brokemon");

    const before = p.s.cash;
    // Sit at home in Brokemon until the rent day comes round.
    for (let i = 0; i < 9; i++) p.ctx.advance(24 * 60, { sheltered: true, asleep: true });
    expect(p.s.cash).toBeLessThan(before);
    expect(p.s.log.some((l) => /Rent taken/.test(l.text) && /Brokedale/.test(l.text))).toBe(true);
  });

  it("has no free wash — the cheapest way to be clean costs money", () => {
    const p = new Player();
    p.rideOut(9);
    p.s.meters.hygiene = 10;
    p.s.cash = 0;
    p.goto("washhouse");
    expect(p.took(p.press(), "buy a token")).toBe(false);

    p.s.cash = 20;
    expect(p.took(p.press(), "buy a token")).toBe(true);
    expect(p.s.meters.hygiene).toBeGreaterThan(50);
  });

  it("buys your things back at a loss, and will not take your lunch", () => {
    const p = new Player();
    p.rideOut(9);
    p.setClock(12);
    p.s.inventory = { bicycle: 1, sandwich: 2 };
    p.s.cash = 0;
    p.goto("pawnShop");
    const counter = p.press();
    expect(p.took(counter, "sell mountain bike")).toBe(true);
    expect(p.s.cash).toBeGreaterThan(0);
    expect(p.s.cash).toBeLessThan(ITEMS.bicycle.price!);
    // Consumables are not stock.
    expect(p.took(p.press(), "sell deli sandwich")).toBe(false);
  });
});

/* ------------------------------------------------------------- the ladder */

describe("the depot ladder", () => {
  const LADDER = employmentIn("brokedale");

  it("never asks how you look, at any rung", () => {
    // This is the whole reason it exists. Brokemon's career is worked inside a
    // gate that wants appearance 70 every morning, so a player who cannot hold
    // that number had nowhere to go. A dress code anywhere on this track would
    // rebuild the wall it was cut to route around.
    for (const id of LADDER) {
      const req = EMPLOYMENT[id].requires;
      expect(req.appearance, `${id} judges appearance`).toBeUndefined();
      expect(req.outfit, `${id} has a dress code`).toBeUndefined();
    }
  });

  it("climbs on hours and credits instead", () => {
    const rungs = LADDER.map((id) => EMPLOYMENT[id]);
    // Each rung pays more and asks for more of what you have actually done.
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i]!.pay, `${rungs[i]!.id} pays no better`).toBeGreaterThan(rungs[i - 1]!.pay);
      const exp = rungs[i]!.requires.experience;
      expect(exp?.job, `${rungs[i]!.id} does not build on the rung below`).toBe(rungs[i - 1]!.id);
    }
  });

  it("is worked outside the district that wants a dress code", () => {
    // Riverside has requiresAttire. Putting the depot there would have been
    // finding 1 all over again, in a new town.
    const where = markerPos(BROKEDALE, "depot");
    expect(zoneAt(BROKEDALE, where.y).requiresAttire).toBe(false);
  });

  it("hires you tired — that is a question for the door, not the interview", () => {
    const p = new Player();
    p.rideOut(9);
    p.setClock(10);
    p.s.meters = { hunger: 60, thirst: 60, hygiene: 60, energy: 1, morale: 1, health: 60 };
    p.goto("jobCentre");
    const list = p.drive(p.press(), "take a ticket");
    expect(p.lockReason(list, "Warehouse Picker")).toBeNull();
  });

  it("still sends you home from the shift itself when you cannot stand up", () => {
    const p = new Player();
    p.rideOut(9);
    p.s.employment = "picker";
    p.setClock(EMPLOYMENT.picker.shiftStart);
    p.s.meters.energy = 2;
    p.goto("depot");
    p.drive(p.press(), "clock in");
    expect(p.s.strikes).toBeGreaterThan(0);
    expect(p.s.shiftsWorked.picker ?? 0).toBe(0);
  });

  it("can be clocked into on time from a bed that wakes you at seven", () => {
    // A 6AM start was unworkable: every bed in the game wakes you at 7, so the
    // shift was already an hour gone and every day was a written warning.
    for (const id of LADDER) {
      expect(EMPLOYMENT[id].shiftStart, `${id} starts before you can be awake`).toBeGreaterThanOrEqual(7);
    }
  });

  it("does not advertise itself in the other town", () => {
    const p = new Player();
    p.setClock(11);
    p.goto("jobBoard");
    const board = p.drive(p.press(), "career listings");
    const labels = (board?.choices ?? []).map((c) => c.label);
    for (const id of LADDER) expect(labels, `Market Square is advertising ${id}`).not.toContain(EMPLOYMENT[id].name);
    expect(labels).toContain(EMPLOYMENT.martClerk.name);
  });

  it("does not advertise Brokemon's jobs at the Exchange either", () => {
    const p = new Player();
    p.rideOut(9);
    p.setClock(11);
    p.goto("jobCentre");
    const list = p.drive(p.press(), "take a ticket");
    const labels = (list?.choices ?? []).map((c) => c.label);
    expect(labels).not.toContain(EMPLOYMENT.martClerk.name);
    expect(labels).toContain(EMPLOYMENT.picker.name);
  });

  it("turns you away at the yard gate if you do not work there", () => {
    const p = new Player();
    p.rideOut(9);
    p.goto("depot");
    expect(p.press()?.lines.join(" ")).toMatch(/staff only/i);
  });

  it("counts a room plus a career as phase 3", () => {
    // The apartment used to be the only door to phase 3. A depot manager on St
    // Giles Row would otherwise have held a tier-4 job at phase 2.
    const p = new Player();
    p.s.housing.brokedale = "room";
    p.s.employment = "dispatcher";
    expect(phaseOf(p.s)).toBe(3);
  });
});

/* -------------------------------------------------------- the other apex */

describe("the block on St Giles Row", () => {
  function moveIn(p: Player): void {
    p.s.cash = HOUSING.room.rent * 2;
    p.goto("weeklyRooms");
    p.drive(p.press(), "take it");
  }

  it("is not for sale to somebody who has never lived in it", () => {
    const p = new Player();
    p.rideOut(9);
    p.s.cash = 60_000;
    p.s.reputation.brokedale = 90;
    p.goto("weeklyRooms");
    expect(p.took(p.press(), "Aldiss")).toBe(false);
  });

  it("is not for sale to somebody he does not know, however rich", () => {
    const p = new Player();
    p.rideOut(9);
    moveIn(p);
    p.s.cash = 60_000;
    p.s.reputation.brokedale = BLOCK_REPUTATION - 1;
    const room = p.press();
    expect(p.took(room, "Aldiss")).toBe(false);
    expect(p.lockReason(room, "Aldiss")).toMatch(/knows/i);
  });

  it("takes the money, ends the run, and stops charging you rent", () => {
    const p = new Player();
    p.rideOut(9);
    moveIn(p);
    p.s.bank = BLOCK_PRICE;
    p.s.reputation.brokedale = BLOCK_REPUTATION;

    expect(p.took(p.press(), "Aldiss")).toBe(true);
    expect(p.s.blockOwned).toBe(true);
    expect(p.s.endings).toContain("block");
    expect(p.s.won).toBe(true);
    expect(phaseOf(p.s)).toBe(4);
    expect(p.s.bank).toBe(0);

    // A week passes: rents arrive, and none of it is yours to pay.
    const before = p.s.bank;
    for (let i = 0; i < 7; i++) p.ctx.advance(24 * 60, { sheltered: true, asleep: true });
    expect(p.s.bank).toBeGreaterThan(before + BLOCK_RENT_ROLL * 6);
    expect(p.s.log.some((l) => /Rent taken/.test(l.text) && /Brokedale/.test(l.text))).toBe(false);
  });

  it("is a different ending from the estate, and a run can hold both", () => {
    const p = new Player();
    p.s.endings = [];
    setWon(p.s, "estate");
    setWon(p.s, "block");
    setWon(p.s, "block");
    expect(p.s.endings).toEqual(["estate", "block"]);
  });

  it("credits a save from before there were two endings to the only one there was", () => {
    useMemoryStorage();
    const legacy = JSON.parse(JSON.stringify(createState(2))) as Record<string, any>;
    legacy.won = true;
    delete legacy.endings;
    localStorage.setItem("brokemon.save.v1", JSON.stringify(legacy));
    expect(loadGame()!.endings).toEqual(["estate"]);
  });
});

/* ---------------------------------------------------------- encounters */

describe("Brokedale's encounters", () => {
  /** Every distinct encounter that fires standing in one district all day. */
  function pool(y: number, seed = 3): Set<string> {
    const p = new Player(seed);
    p.rideOut(9);
    p.s.player.pos = { x: 19, y };
    p.s.cash = 300;
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      p.s.time += 190;
      p.s.inventory.phone = 1;
      p.s.meters.hygiene = 30;
      const prompt = rollEvent(p.ctx);
      if (prompt) seen.add(prompt.title);
    }
    return seen;
  }

  it("does not borrow Brokemon's", () => {
    // The weight functions only ever saw a zone. Once Brokedale had districts
    // of its own, sixteen Brokemon encounters fell through their ternaries and
    // fired there — a bin lorry on Route 1, the lads outside the chip shop.
    const here = pool(4);
    expect(here.size).toBeGreaterThan(2);
    for (const title of here) {
      expect(title, `${title} is a Brokemon encounter`).not.toMatch(/bin lorry|chip shop|Route 1/i);
    }
  });

  it("gives each district something of its own", () => {
    const districts = [4, 15, 30, 36].map((y) => pool(y));
    for (const [i, set] of districts.entries()) {
      expect(set.size, `district ${i} has nothing to run into`).toBeGreaterThan(2);
    }
    // And they are not the same four everywhere.
    const [terminal, blocks] = districts;
    const shared = [...terminal!].filter((t) => blocks!.has(t));
    expect(shared.length, "the terminal and the blocks feel identical").toBeLessThan(terminal!.size - 1);
  });

  it("leaves Brokemon's own pool alone", () => {
    const p = new Player(9);
    p.goto("busStop");
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      p.s.time += 190;
      const prompt = rollEvent(p.ctx);
      if (prompt) seen.add(prompt.title);
    }
    expect(seen.size).toBeGreaterThan(20);
  });
});

/* ------------------------------------------------------------- the pitch */

describe("a pitch at the night market", () => {
  it("is not let to somebody with no address in the city", () => {
    const p = new Player();
    p.rideOut(9);
    p.s.cash = 10_000;
    p.s.reputation.brokedale = 90;
    p.goto("nightMarket");
    const stalls = p.press();
    expect(p.took(stalls, "take on a pitch")).toBe(false);
    expect(p.lockReason(stalls, "take on a pitch")).toMatch(/address/i);
  });

  it("pays every night once it is yours, and scales with your name here", () => {
    const p = new Player();
    p.rideOut(9);
    p.s.housing.brokedale = "room";
    p.s.reputation.brokedale = 50;
    p.s.cash = PITCH_PRICE;
    p.goto("nightMarket");
    expect(p.took(p.press(), "take on a pitch")).toBe(true);
    expect(p.s.stallOwned).toBe(true);

    const before = p.s.bank;
    p.ctx.advance(24 * 60, { sheltered: true, asleep: true });
    const oneNight = p.s.bank - before;
    expect(oneNight).toBeGreaterThanOrEqual(STALL_BASE);
    // Taking on the pitch is worth 5 reputation, so the payout is above the
    // floor by roughly what the name is worth.
    expect(oneNight).toBeCloseTo(STALL_BASE + Math.round(reputationIn(p.s, "brokedale") * STALL_PER_REPUTATION), 0);
  });

  it("is much smaller than the franchise, because it is one stall", () => {
    // Brokemon's franchise is 350 + rep*3. If the pitch ever approaches that,
    // Brokedale stops being the slower, smaller road and the fork collapses.
    const atCeiling = STALL_BASE + REPUTATION_CEILING * STALL_PER_REPUTATION;
    expect(atCeiling).toBeLessThan(200);
  });

  it("does not pay anything to somebody who never took one on", () => {
    const p = new Player();
    const before = p.s.bank;
    p.ctx.advance(24 * 60, { sheltered: true, asleep: true });
    expect(p.s.bank).toBe(before);
  });
});
