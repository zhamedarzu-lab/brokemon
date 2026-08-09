import { describe, expect, it } from "vitest";
import { glyphAt, isSolid, markerPos, spawnPoint, STARTING_TOWN, townById, TOWNS, zoneAt, type Town } from "./map";

/** Everything in here is about Brokemon Town specifically. */
const TOWN = townById(STARTING_TOWN);
const { width: MAP_WIDTH, height: MAP_HEIGHT, zones: ZONES } = TOWN;
import { MARKERS, TILES } from "./tiles";
import { approaches, sleepableBenches } from "./landmarks";
import { DOOR_SIGNS } from "../sim/actions";
import { VENUES } from "../sim/venues";

const ALL_TOWNS: Town[] = Object.values(TOWNS);

/** Every marker id placed anywhere in the world, whichever town drew it. */
const PLACED = new Set(ALL_TOWNS.flatMap((t) => Object.keys(t.markers)));

describe("town map", () => {
  it("is a complete rectangle", () => {
    expect(TOWN.grid).toHaveLength(MAP_HEIGHT);
    for (const [y, row] of TOWN.grid.entries()) {
      expect(row, `row ${y}`).toHaveLength(MAP_WIDTH);
    }
  });

  it("uses only known glyphs after markers are stripped", () => {
    for (const row of TOWN.grid) {
      for (const glyph of row) expect(TILES[glyph]).toBeDefined();
    }
  });

  it("places each of its markers on exactly one tile", () => {
    const positions = new Set(Object.values(TOWN.markers).map((p) => `${p.x},${p.y}`));
    expect(positions.size).toBe(Object.keys(TOWN.markers).length);
  });

  it("is walled in on every edge", () => {
    for (let x = 0; x < MAP_WIDTH; x++) {
      expect(isSolid(TOWN, x, 0), `top ${x}`).toBe(true);
      expect(isSolid(TOWN, x, MAP_HEIGHT - 1), `bottom ${x}`).toBe(true);
    }
    for (let y = 0; y < MAP_HEIGHT; y++) {
      expect(isSolid(TOWN, 0, y), `left ${y}`).toBe(true);
      expect(isSolid(TOWN, MAP_WIDTH - 1, y), `right ${y}`).toBe(true);
    }
  });

  it("spawns the player on a walkable tile", () => {
    const spawn = spawnPoint();
    expect(isSolid(TOWN, spawn.x, spawn.y)).toBe(false);
  });

  it("puts every marker on a walkable tile", () => {
    for (const [id, p] of Object.entries(TOWN.markers)) {
      expect(isSolid(TOWN, p.x, p.y), `${id} at ${p.x},${p.y}`).toBe(false);
    }
  });

  it("covers every row with exactly one zone", () => {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      const matches = ZONES.filter((z) => y >= z.from && y <= z.to);
      expect(matches, `row ${y}`).toHaveLength(1);
      expect(zoneAt(TOWN, y)).toBe(matches[0]);
    }
  });
});

/**
 * Walk the map the way the player can: over open tiles, and through the
 * security gate, which the guard opens for you rather than being a wall.
 */
function reachableFromSpawn(): Set<string> {
  const seen = new Set<string>();
  const spawn = spawnPoint();
  const queue = [spawn];
  seen.add(`${spawn.x},${spawn.y}`);

  while (queue.length) {
    const cur = queue.shift()!;
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
      // The gate is solid, but interacting with it moves you to the far side.
      if (glyphAt(TOWN, nx, ny) === "G") {
        seen.add(key);
        const beyondY = ny + Math.sign(ny - cur.y);
        const beyond = `${nx},${beyondY}`;
        if (!seen.has(beyond) && !isSolid(TOWN, nx, beyondY)) {
          seen.add(beyond);
          queue.push({ x: nx, y: beyondY });
        }
        continue;
      }
      if (isSolid(TOWN, nx, ny)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

describe("connectivity", () => {
  const reachable = reachableFromSpawn();

  it.each(Object.keys(TOWN.markers).filter((id) => id !== "spawn"))("can walk from the park to %s", (id) => {
    const p = markerPos(TOWN, id);
    expect(reachable.has(`${p.x},${p.y}`)).toBe(true);
  });

  it("reaches both sides of the Heights gate", () => {
    // Marker for the plaza sits above the gate; the park spawn sits below it.
    expect(reachable.has("23,15")).toBe(true);
    expect(reachable.has("23,13")).toBe(true);
  });

  it("reaches at least one bench, dumpster and recycling bin", () => {
    const kinds = { b: 0, "%": 0, x: 0 };
    for (const key of reachable) {
      const [xs, ys] = key.split(",");
      const x = Number(xs);
      const y = Number(ys);
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ] as const) {
        const g = glyphAt(TOWN, x + dx, y + dy);
        if (g === "b" || g === "%" || g === "x") kinds[g] += 1;
      }
    }
    expect(kinds.b).toBeGreaterThan(0);
    expect(kinds["%"]).toBeGreaterThan(0);
    expect(kinds.x).toBeGreaterThan(0);
  });
});

describe("the town is legible from the street", () => {
  it("puts a name over every door you can walk into", () => {
    // Every building on the map is the same brown wall. Without a sign the
    // only way to learn which one is the hostel is to open all of them.
    for (const id of Object.keys(VENUES)) {
      expect(DOOR_SIGNS[id], `no sign over ${id}`).toBeTruthy();
    }
  });

  it("keeps the signs short enough to sit over a doorway", () => {
    for (const [id, sign] of Object.entries(DOOR_SIGNS)) {
      expect(sign.length, `${id} sign "${sign}" is too long to read at 16px`).toBeLessThanOrEqual(11);
      expect(sign).toBe(sign.toUpperCase());
    }
  });

  it("only signs places that actually exist somewhere in the world", () => {
    for (const id of Object.keys(DOOR_SIGNS)) {
      expect(PLACED.has(id), `${id} has a sign but no town draws it`).toBe(true);
    }
  });

  it("uses every marker glyph in the vocabulary in at least one town", () => {
    // The glyph table is shared between towns now. An id nobody draws is either
    // a place that got deleted or a door somebody forgot to cut.
    for (const id of Object.values(MARKERS)) {
      expect(PLACED.has(id), `nothing in the world is marked "${id}"`).toBe(true);
    }
  });

  it("has every marker glyph standing on ground you can walk on", () => {
    for (const [id, pos] of Object.entries(TOWN.markers)) {
      expect(isSolid(TOWN, pos.x, pos.y), `${id} at ${pos.x},${pos.y} is inside a wall`).toBe(false);
    }
  });

  it("leaves nothing walkable stranded except the Heights behind the gate", () => {
    // The security gate is a solid tile you interact with, so the hill is
    // deliberately unreachable by pathfinding. Anything else cut off from
    // spawn is a hole somebody punched in the map by accident.
    const start = spawnPoint();
    const seen = new Set([`${start.x},${start.y}`]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i]!;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        const next = { x: cell.x + dx, y: cell.y + dy };
        const key = `${next.x},${next.y}`;
        if (seen.has(key) || isSolid(TOWN, next.x, next.y)) continue;
        seen.add(key);
        queue.push(next);
      }
    }
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (isSolid(TOWN, x, y) || seen.has(`${x},${y}`)) continue;
        expect(zoneAt(TOWN, y).id, `${x},${y} is walkable but cut off from spawn`).toBe("heights");
      }
    }
  });
});

/**
 * Everything true of any town, checked against all of them. Brokemon had these
 * as one-off assertions; a second grid is exactly when they stop being about
 * one map and start being about the shape of a map.
 */
describe.each(ALL_TOWNS.map((t) => [t.id, t] as const))("%s, as a town", (_id, town) => {
  it("is a complete rectangle of known glyphs", () => {
    expect(town.grid).toHaveLength(town.height);
    for (const [y, row] of town.grid.entries()) {
      expect(row, `row ${y}`).toHaveLength(town.width);
      for (const glyph of row) expect(TILES[glyph], `row ${y} glyph "${glyph}"`).toBeDefined();
    }
  });

  it("is walled in on every edge", () => {
    for (let x = 0; x < town.width; x++) {
      expect(isSolid(town, x, 0), `top ${x}`).toBe(true);
      expect(isSolid(town, x, town.height - 1), `bottom ${x}`).toBe(true);
    }
    for (let y = 0; y < town.height; y++) {
      expect(isSolid(town, 0, y), `left ${y}`).toBe(true);
      expect(isSolid(town, town.width - 1, y), `right ${y}`).toBe(true);
    }
  });

  it("covers every row with exactly one zone", () => {
    for (let y = 0; y < town.height; y++) {
      const matches = town.zones.filter((z) => y >= z.from && y <= z.to);
      expect(matches, `row ${y}`).toHaveLength(1);
      expect(zoneAt(town, y)).toBe(matches[0]);
    }
  });

  it("puts every marker on a tile you can stand on", () => {
    for (const [id, p] of Object.entries(town.markers)) {
      expect(isSolid(town, p.x, p.y), `${id} at ${p.x},${p.y} is inside a wall`).toBe(false);
    }
  });

  it("has a venue behind every door it draws", () => {
    // A marker with no venue is a door that opens onto nothing. `spawn` and
    // `panhandleSpot` are places rather than premises and are handled in
    // actions.ts directly.
    for (const id of Object.keys(town.markers)) {
      if (id === "spawn" || id === "panhandleSpot") continue;
      expect(VENUES[id], `${id} is on the map but has no venue`).toBeDefined();
    }
  });

  it("escorts out of every zone that fines people, onto ground they can stand on", () => {
    for (const zone of town.zones) {
      if (zone.fineScale === 0) continue;
      expect(zone.escortTo, `${zone.id} fines but does not say where it puts you`).toBeDefined();
      const to = zone.escortTo!;
      expect(isSolid(town, to.x, to.y), `${zone.id} escorts into a wall at ${to.x},${to.y}`).toBe(false);
    }
  });
});

describe("Brokedale", () => {
  const BROKEDALE = townById("brokedale");

  it("can be walked end to end from where the coach drops you", () => {
    const start = markerPos(BROKEDALE, "coachTerminal");
    const seen = new Set([`${start.x},${start.y}`]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i]!;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        const next = { x: cell.x + dx, y: cell.y + dy };
        const key = `${next.x},${next.y}`;
        if (seen.has(key) || isSolid(BROKEDALE, next.x, next.y)) continue;
        seen.add(key);
        queue.push(next);
      }
    }
    for (const [id, p] of Object.entries(BROKEDALE.markers)) {
      expect(seen.has(`${p.x},${p.y}`), `${id} is cut off from the coach stand`).toBe(true);
    }
    // Nothing walkable stranded, either: Brokedale has no gate to justify it.
    for (let y = 0; y < BROKEDALE.height; y++) {
      for (let x = 0; x < BROKEDALE.width; x++) {
        if (isSolid(BROKEDALE, x, y)) continue;
        expect(seen.has(`${x},${y}`), `${x},${y} is walkable but cut off`).toBe(true);
      }
    }
  });

  it("has water and something to scavenge, but nowhere free to lie down", () => {
    // Brokemon has a floor and no ceiling; Brokedale has a ceiling and no
    // floor. Water and bins keep a stranded player alive; a bed costs money
    // everywhere here, which is why the concourse exists.
    expect(approaches(BROKEDALE, "water").length, "nothing to drink").toBeGreaterThan(0);
    expect(approaches(BROKEDALE, "dumpster").length, "nothing to scavenge").toBeGreaterThan(0);
    expect(sleepableBenches(BROKEDALE)).toHaveLength(0);
  });

  it("gives a penniless arrival some way to earn the fare home", () => {
    // The walking rig rode out with the fare and nothing else and never got
    // back: eight days, never above $9, health on the floor. Cans are the only
    // thing a stranded player can turn into money here, and without somewhere
    // to sell them, "you can get stranded" stops being a bad night and becomes
    // a soft lock. Bins, a buyer, and a corner — that is the whole floor, and
    // it is meant to be exactly this thin.
    expect(approaches(BROKEDALE, "dumpster").length, "nothing to scavenge").toBeGreaterThan(0);
    expect(BROKEDALE.markers.recycling, "nowhere to sell what you scavenge").toBeDefined();
    expect(BROKEDALE.markers.panhandleSpot, "nowhere to ask").toBeDefined();
  });

  it("polices every district — there is no free corner", () => {
    for (const zone of BROKEDALE.zones) {
      expect(zone.fineScale, `${zone.id} lets you camp`).toBeGreaterThan(0);
    }
  });
});

describe("the scenery a phase-1 day needs", () => {
  it("has water, dumpsters and somewhere legal to sleep", () => {
    // These are terrain, not named markers, so nothing points at them by name.
    // Twice now a map change has left the test rigs walking to a tile where a
    // dumpster used to be, getting a null prompt, and reporting a healthy run
    // in which nothing had been scavenged. Assert the town still has them.
    expect(approaches(TOWN, "water").length, "nowhere to drink for free").toBeGreaterThan(0);
    expect(approaches(TOWN, "dumpster").length, "nothing to scavenge").toBeGreaterThan(0);
    expect(sleepableBenches(TOWN).length, "nowhere to sleep rough without a fine").toBeGreaterThan(0);
  });

  it("puts free water within reach of the outskirts, not only downtown", () => {
    // Thirst drains 120 points a day and the outskirts are where you start,
    // sleep and scavenge. An ornamental lake on the far side of downtown is a
    // two-hour round trip for a meter you empty three times a day.
    const outskirts = ZONES.find((z) => z.fineScale === 0)!;
    const nearby = approaches(TOWN, "water").filter((a) => zoneAt(TOWN, a.target.y).id === outskirts.id);
    expect(nearby.length, `no free water in ${outskirts.name}`).toBeGreaterThan(0);
  });

  it("only counts benches you would not be fined for sleeping on", () => {
    for (const bench of sleepableBenches(TOWN)) {
      expect(zoneAt(TOWN, bench.target.y).fineScale).toBe(0);
    }
  });

  it("can reach its scenery on foot without going through the gate", () => {
    const start = spawnPoint();
    const seen = new Set([`${start.x},${start.y}`]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i]!;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        const next = { x: cell.x + dx, y: cell.y + dy };
        const key = `${next.x},${next.y}`;
        if (seen.has(key) || isSolid(TOWN, next.x, next.y)) continue;
        seen.add(key);
        queue.push(next);
      }
    }
    const reachable = (list: ReturnType<typeof approaches>) =>
      list.filter((a) => seen.has(`${a.pos.x},${a.pos.y}`)).length;
    expect(reachable(approaches(TOWN, "water")), "all the water is behind the gate").toBeGreaterThan(0);
    expect(reachable(approaches(TOWN, "dumpster")), "all the dumpsters are behind the gate").toBeGreaterThan(0);
    expect(reachable(sleepableBenches(TOWN)), "every sleepable bench is behind the gate").toBeGreaterThan(0);
  });
});
