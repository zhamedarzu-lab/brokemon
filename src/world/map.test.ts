import { describe, expect, it } from "vitest";
import { glyphAt, isSolid, MAP_HEIGHT, MAP_WIDTH, markerPos, spawnPoint, TOWN, zoneAt, ZONES } from "./map";
import { MARKERS, TILES } from "./tiles";

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
