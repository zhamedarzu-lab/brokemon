import { describe, expect, it } from "vitest";
import { markerPos, townById, zoneAt } from "../world/map";

import { interact } from "./actions";
import { rollWorkEvent, WORK_EVENTS, WORK_EVENT_CHANCE } from "./events-work";
import { countOf } from "./items";
import { EMPLOYMENT, EMPLOYMENT_ORDER, worksBehindTheGate } from "./jobs";
import type { Prompt } from "./prompt";
import { Rng } from "./rng";
import { HEIGHTS_GATE_LOOK } from "./social";
import { createState, type GameState } from "./state";
import { advance } from "./tick";
import { grantOrTakeBadge, type ActionCtx } from "./work";

function bot(seed = 1): { s: GameState; ctx: ActionCtx } {
  const s = createState(seed);
  const rng = new Rng(seed);
  return {
    s,
    ctx: {
      state: s,
      rng,
      advance: (m, o) => void advance(s, rng, { minutes: m, ...o }),
      teleport: (x, y) => {
        s.player.pos = { x, y };
      },
    },
  };
}

/* ------------------------------------------------------------- the pass */

describe("the staff pass", () => {
  it("knows which jobs are worked behind the barrier, from the map", () => {
    // Derived rather than written down, so moving a job or redrawing the hill
    // cannot leave this asserting something that was true a year ago.
    for (const id of EMPLOYMENT_ORDER) {
      const def = EMPLOYMENT[id];
      const town = townById(def.town);
      const expected = zoneAt(town, markerPos(town, def.location).y).id === "heights";
      expect(worksBehindTheGate(id), `${id}`).toBe(expected);
    }
    // And at least one job really is up there, or the whole fix is untested.
    expect(EMPLOYMENT_ORDER.some(worksBehindTheGate)).toBe(true);
  });

  it("opens the gate for somebody who would never pass the dress code", () => {
    const { s, ctx } = bot();
    s.wearing = "rags";
    s.meters.hygiene = 5;
    grantOrTakeBadge(s, "officeAdmin");

    // Stand below the barrier, facing up at it.
    s.player.pos = { x: 23, y: 15 };
    s.player.facing = "up";
    const prompt = interact(ctx) as Prompt;
    expect(prompt.lines.join(" ")).toMatch(/lanyard/i);
    expect(s.player.pos.y).toBeLessThan(15);
  });

  it("still turns away somebody with neither the look nor a pass", () => {
    const { s, ctx } = bot();
    s.wearing = "rags";
    s.meters.hygiene = 5;
    s.player.pos = { x: 23, y: 15 };
    s.player.facing = "up";
    const prompt = interact(ctx) as Prompt;
    expect(prompt.lines.join(" ")).toMatch(/Residents and guests/);
    expect(s.player.pos.y).toBe(15);
  });

  it("goes back when the job does", () => {
    const { s } = bot();
    grantOrTakeBadge(s, "technician");
    expect(countOf(s.inventory, "staffBadge")).toBe(1);
    grantOrTakeBadge(s, "martClerk");
    expect(countOf(s.inventory, "staffBadge")).toBe(0);
    grantOrTakeBadge(s, "executive");
    expect(countOf(s.inventory, "staffBadge")).toBe(1);
    grantOrTakeBadge(s, null);
    expect(countOf(s.inventory, "staffBadge")).toBe(0);
  });

  it("makes the plaza jobs' own appearance requirements mean something again", () => {
    // The gate wanted 70 every morning and Field Technician wants 60, so the
    // job's own bar was dead text — you could never be standing at the desk
    // without already clearing a higher one.
    const behind = EMPLOYMENT_ORDER.filter(worksBehindTheGate).map((id) => EMPLOYMENT[id]);
    expect(behind.length).toBeGreaterThan(0);
    expect(behind.some((d) => (d.requires.appearance ?? 0) < HEIGHTS_GATE_LOOK)).toBe(true);
  });
});

/* ------------------------------------------------------ what happens at work */

describe("workplace incidents", () => {
  it("fires on about a third of shifts, not every one", () => {
    const { s, ctx } = bot(7);
    let hits = 0;
    for (let i = 0; i < 600; i++) {
      s.flags = {};
      if (rollWorkEvent(ctx, "officeAdmin")) hits += 1;
    }
    const rate = hits / 600;
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(WORK_EVENT_CHANCE + 0.05);
  });

  it("has something for every rung of both ladders", () => {
    for (const id of EMPLOYMENT_ORDER) {
      const def = EMPLOYMENT[id];
      const { s } = bot();
      const total = WORK_EVENTS.reduce((a, e) => a + e.weight(s, def), 0);
      expect(total, `nothing ever happens to a ${def.name}`).toBeGreaterThan(0);
    }
  });

  it("aims itself at the tiers where the day is on a loop", () => {
    // The finding was that days 5-23 of a tier-3 career differ only in the
    // cash column. A phase-1 player already has a different day every day.
    const { s } = bot();
    const at = (tier: 2 | 3 | 4) =>
      WORK_EVENTS.reduce((a, e) => a + e.weight(s, { ...EMPLOYMENT.officeAdmin, tier }), 0);
    expect(at(3)).toBeGreaterThan(0);
    expect(at(4)).toBeGreaterThan(0);
  });

  it("keeps its once-only beats to once", () => {
    const { s, ctx } = bot(3);
    s.flags.owedAFavour = 5;
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const p = rollWorkEvent(ctx, "officeAdmin");
      if (p) seen.add(p.title);
    }
    for (const e of WORK_EVENTS.filter((x) => x.once)) {
      expect(s.flags[`wk:${e.id}`] === 1 || !seen.size).toBeTruthy();
    }
    // Firing them a second time would need the flag cleared, which nothing does.
    const onceIds = WORK_EVENTS.filter((x) => x.once).map((x) => x.id);
    expect(onceIds.length).toBeGreaterThan(0);
    for (const id of onceIds) expect([undefined, 1]).toContain(s.flags[`wk:${id}`]);
  });
});
