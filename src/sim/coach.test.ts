import { beforeEach, describe, expect, it } from "vitest";
import { markerPos, townById } from "../world/map";

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
import { HOUSING } from "./social";
import { createState, housingIn, reputationIn, type GameState } from "./state";
import { advance } from "./tick";
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
