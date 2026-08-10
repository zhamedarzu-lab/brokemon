/**
 * Things that have to be true of a town, checked against every town there is.
 *
 * Brokedale was written after all of Brokemon's tests, and it inherited the
 * type but not the scrutiny: it shipped with a recycling depot that was a
 * marker standing in a gravel field with no building around it, two districts
 * whose sign text had no signpost to read it on, a working district with no
 * drinking water in it, and two zones that fined you and then "escorted" you
 * to a tile inside themselves.
 *
 * None of those were catchable by anything that only ever looked at Brokemon.
 * Every check here runs over `TOWNS`, so the third town gets them for free.
 */
import { describe, expect, it } from "vitest";
import { TOWNS } from "./map";
import { TILES, type Glyph } from "./tiles";
import type { Town, Zone } from "./town";

const towns = Object.values(TOWNS) as Town[];

/** Markers that are street furniture and are not supposed to have a building. */
const OUTDOORS = new Set([
  "panhandleSpot",
  "spawn",
  "busStop",
  "outskirtsBusStop",
]);

function glyphAt(town: Town, x: number, y: number): Glyph | undefined {
  return town.grid[y]?.[x] as Glyph | undefined;
}

function isBuilt(g: Glyph | undefined): boolean {
  return g === "#" || g === "^" || g === "W";
}

function zoneRows(town: Town, zone: Zone): [number, number] {
  return [zone.from, zone.to ?? town.height - 1];
}

function interactionsIn(town: Town, zone: Zone): Map<string, number> {
  const [from, to] = zoneRows(town, zone);
  const counts = new Map<string, number>();
  for (let y = from; y <= to; y++) {
    for (let x = 0; x < town.width; x++) {
      const kind = TILES[glyphAt(town, x, y)!]?.interaction;
      if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  return counts;
}

describe.each(towns.map((t) => [t.name, t] as const))("%s", (_name, town) => {
  it("puts a building around every door", () => {
    // A marker is a doorway: you stand on it, and the building is the wall it
    // is cut into. Brokedale's recycling depot was a bare glyph on gravel —
    // the venue existed, the map did not.
    for (const [id, at] of Object.entries(town.markers)) {
      if (OUTDOORS.has(id)) continue;
      const around = {
        left: glyphAt(town, at.x - 1, at.y),
        right: glyphAt(town, at.x + 1, at.y),
        above: glyphAt(town, at.x, at.y - 1),
      };
      expect(
        isBuilt(around.left) && isBuilt(around.right) && isBuilt(around.above),
        `${town.id}: "${id}" at (${at.x},${at.y}) has no building around it — ${JSON.stringify(around)}`,
      ).toBe(true);
    }
  });

  it("gives every district a signpost to read its sign on", () => {
    // Every zone carries `sign` text. Two of Brokedale's four had nowhere to
    // read it, which is written content the player can never reach.
    for (const zone of town.zones) {
      expect(
        zone.sign.length,
        `${town.id}/${zone.id} has no sign text`,
      ).toBeGreaterThan(0);
      expect(
        interactionsIn(town, zone).get("sign") ?? 0,
        `${town.id}/${zone.id} has sign text and no signpost to read it on`,
      ).toBeGreaterThan(0);
    }
  });

  it("puts drinking water in every district", () => {
    // Thirst is the fastest meter in the game and water is the only free
    // answer to it. Brokedale's high street — the district with the depot, the
    // exchange and the pawnbrokers in it — had none at all.
    for (const zone of town.zones) {
      expect(
        interactionsIn(town, zone).get("water") ?? 0,
        `${town.id}/${zone.id} has nowhere to drink`,
      ).toBeGreaterThan(0);
    }
  });

  it("escorts you somewhere other than where it moved you on from", () => {
    /**
     * Being moved on has to move you. Brokedale's high street escorted to the
     * first row of the high street and Riverside to the first row of Riverside
     * — which is not being moved on, it is being told to stand up, and the same
     * officer checks you again on the next tick.
     *
     * Brokemon's downtown is the one exception and it is deliberate: it is a
     * 35-row band, the escort crosses 28 rows of it, and the zone below is the
     * one place in town that does not fine you — escorting anybody there would
     * make a police check a free ride home.
     */
    const DEEP_BAND_EXCEPTION = new Set(["brokemon/downtown"]);
    for (const zone of town.zones) {
      if (zone.fineScale === 0) continue;
      const to = zone.escortTo!;
      const landing = town.zones.find((z) => {
        const [from, until] = zoneRows(town, z);
        return to.y >= from && to.y <= until;
      });
      if (DEEP_BAND_EXCEPTION.has(`${town.id}/${zone.id}`)) continue;
      expect(
        landing?.id,
        `${town.id}/${zone.id} escorts you back into ${zone.id}`,
      ).not.toBe(zone.id);
    }
  });

  it("gives every district somewhere to be moved on to", () => {
    for (const zone of town.zones) {
      if (zone.fineScale === 0) continue;
      expect(
        zone.escortTo,
        `${town.id}/${zone.id} fines you with nowhere to put you`,
      ).toBeTruthy();
    }
  });

  it("covers every row with exactly one district", () => {
    for (let y = 0; y < town.height; y++) {
      const owning = town.zones.filter((z) => {
        const [from, to] = zoneRows(town, z);
        return y >= from && y <= to;
      });
      expect(
        owning.length,
        `${town.id}: row ${y} is in ${owning.length} districts`,
      ).toBe(1);
    }
  });
});
