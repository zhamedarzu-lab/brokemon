import { describe, expect, it } from "vitest";
import { glyphAt, isSolid, MAP_HEIGHT, MAP_WIDTH, markerPos, spawnPoint, TOWN, zoneAt, ZONES } from "./map";
import { MARKERS, TILES } from "./tiles";
import { approaches, sleepableBenches } from "./landmarks";
import { DOOR_SIGNS } from "../sim/actions";
import { VENUES } from "../sim/venues";

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

  it("places every marker exactly once", () => {
    const ids = Object.values(MARKERS);
    for (const id of ids) expect(TOWN.markers[id], `marker ${id}`).toBeDefined();
    const positions = new Set(Object.values(TOWN.markers).map((p) => `${p.x},${p.y}`));
    expect(positions.size).toBe(ids.length);
  });

  it("is walled in on every edge", () => {
    for (let x = 0; x < MAP_WIDTH; x++) {
      expect(isSolid(x, 0), `top ${x}`).toBe(true);
      expect(isSolid(x, MAP_HEIGHT - 1), `bottom ${x}`).toBe(true);
    }
    for (let y = 0; y < MAP_HEIGHT; y++) {
      expect(isSolid(0, y), `left ${y}`).toBe(true);
      expect(isSolid(MAP_WIDTH - 1, y), `right ${y}`).toBe(true);
    }
  });

  it("spawns the player on a walkable tile", () => {
    const spawn = spawnPoint();
    expect(isSolid(spawn.x, spawn.y)).toBe(false);
  });

  it("puts every marker on a walkable tile", () => {
    for (const [id, p] of Object.entries(TOWN.markers)) {
      expect(isSolid(p.x, p.y), `${id} at ${p.x},${p.y}`).toBe(false);
    }
  });

  it("covers every row with exactly one zone", () => {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      const matches = ZONES.filter((z) => y >= z.from && y <= z.to);
      expect(matches, `row ${y}`).toHaveLength(1);
      expect(zoneAt(y)).toBe(matches[0]);
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
      if (glyphAt(nx, ny) === "G") {
        seen.add(key);
        const beyondY = ny + Math.sign(ny - cur.y);
        const beyond = `${nx},${beyondY}`;
        if (!seen.has(beyond) && !isSolid(nx, beyondY)) {
          seen.add(beyond);
          queue.push({ x: nx, y: beyondY });
        }
        continue;
      }
      if (isSolid(nx, ny)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

describe("connectivity", () => {
  const reachable = reachableFromSpawn();

  it.each(Object.values(MARKERS).filter((id) => id !== "spawn"))("can walk from the park to %s", (id) => {
    const p = markerPos(id);
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
        const g = glyphAt(x + dx, y + dy);
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

  it("only signs places that actually exist on the map", () => {
    for (const id of Object.keys(DOOR_SIGNS)) {
      expect(() => markerPos(id), `${id} has a sign but no marker`).not.toThrow();
    }
  });

  it("has every marker glyph standing on ground you can walk on", () => {
    for (const [id, pos] of Object.entries(TOWN.markers)) {
      expect(isSolid(pos.x, pos.y), `${id} at ${pos.x},${pos.y} is inside a wall`).toBe(false);
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
        if (seen.has(key) || isSolid(next.x, next.y)) continue;
        seen.add(key);
        queue.push(next);
      }
    }
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (isSolid(x, y) || seen.has(`${x},${y}`)) continue;
        expect(zoneAt(y).id, `${x},${y} is walkable but cut off from spawn`).toBe("heights");
      }
    }
  });
});

describe("the scenery a phase-1 day needs", () => {
  it("has water, dumpsters and somewhere legal to sleep", () => {
    // These are terrain, not named markers, so nothing points at them by name.
    // Twice now a map change has left the test rigs walking to a tile where a
    // dumpster used to be, getting a null prompt, and reporting a healthy run
    // in which nothing had been scavenged. Assert the town still has them.
    expect(approaches("water").length, "nowhere to drink for free").toBeGreaterThan(0);
    expect(approaches("dumpster").length, "nothing to scavenge").toBeGreaterThan(0);
    expect(sleepableBenches().length, "nowhere to sleep rough without a fine").toBeGreaterThan(0);
  });

  it("puts free water within reach of the outskirts, not only downtown", () => {
    // Thirst drains 120 points a day and the outskirts are where you start,
    // sleep and scavenge. An ornamental lake on the far side of downtown is a
    // two-hour round trip for a meter you empty three times a day.
    const outskirts = ZONES.find((z) => z.fineScale === 0)!;
    const nearby = approaches("water").filter((a) => zoneAt(a.target.y).id === outskirts.id);
    expect(nearby.length, `no free water in ${outskirts.name}`).toBeGreaterThan(0);
  });

  it("only counts benches you would not be fined for sleeping on", () => {
    for (const bench of sleepableBenches()) {
      expect(zoneAt(bench.target.y).fineScale).toBe(0);
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
        if (seen.has(key) || isSolid(next.x, next.y)) continue;
        seen.add(key);
        queue.push(next);
      }
    }
    const reachable = (list: ReturnType<typeof approaches>) =>
      list.filter((a) => seen.has(`${a.pos.x},${a.pos.y}`)).length;
    expect(reachable(approaches("water")), "all the water is behind the gate").toBeGreaterThan(0);
    expect(reachable(approaches("dumpster")), "all the dumpsters are behind the gate").toBeGreaterThan(0);
    expect(reachable(sleepableBenches()), "every sleepable bench is behind the gate").toBeGreaterThan(0);
  });
});
