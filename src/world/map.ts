import { MARKERS, MARKER_FLOOR, TILES, tileAt, type Glyph } from "./tiles";

/**
 * Brokemon Town.
 *
 * Read it top to bottom and the whole premise is in the layout: the money
 * lives on the hill behind a hedge and a security gate, the shops and offices
 * sit in the middle where the police are, and everything that will actually
 * take you in tonight is down in the gravel at the bottom of the map.
 */
// prettier-ignore
const RAW = [
  /* 00 */ "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
  /* 01 */ "WTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTW",
  /* 02 */ "W.++........................................++.W",
  /* 03 */ "W.HHHHHHHHHH....MMMMMMMMMMMMMM....HHHHHHHHHHH..W",
  /* 04 */ "W.H^^^^^^^^H....M^^^^^^^^^^^^M....H^^^^^^^^^H..W",
  /* 05 */ "W.H########H....M############M....H#########H..W",
  /* 06 */ "W.H########H....M############M....H#########H..W",
  /* 07 */ "W.H########H....M############M....H#########H..W",
  /* 08 */ "W.H###7####H....M############M....H#########H..W",
  /* 09 */ "W.HHHH.HHHHH....M############M....HHHHHHHHHHH..W",
  /* 10 */ "W...............M######3#####M.................W",
  /* 11 */ "W...............MMMMMMMMMMMMMM.................W",
  /* 12 */ "W...................L..__..L...................W",
  /* 13 */ "W......................__......................W",
  /* 14 */ "WHHHHHHHHHHHHHHHHHHHHHHGGHHHHHHHHHHHHHHHHHHHHHHW",
  /* 15 */ "W_________n____________cc______________________W",
  /* 16 */ "W======================cc======================W",
  /* 17 */ "W======================cc======================W",
  /* 18 */ "W______________________cc______________________W",
  /* 19 */ "W_^^^^^^^^^^^____^^^^^^^^^^^____^^^^^^^^^^^^^__W",
  /* 20 */ "W_###########____###########____#############__W",
  /* 21 */ "W_###########____###########____#############__W",
  /* 22 */ "W_###########____###########____#############__W",
  /* 23 */ "W_###########____#####2#####____#############__W",
  /* 24 */ "W_#####1#####___________________######8######__W",
  /* 25 */ "W_____________%____n________%L_________________W",
  /* 26 */ "W______________________________________________W",
  /* 27 */ "W======cc============================cc========W",
  /* 28 */ "W======cc============================cc========W",
  /* 29 */ "W______________________________________________W",
  /* 30 */ "W_^^^^^^^^__^^^^^^^__MMMMMMMMMMMMM__^^^^^^^^^^_W",
  /* 31 */ "W_########__#######__MMMMMMMMMMMMM__##########_W",
  /* 32 */ "W_########__#######__MMMMM~~MMMMMM__##########_W",
  /* 33 */ "W_###$####__###&###__MMMMM~~MMMMMM__##########_W",
  /* 34 */ "W_________________________MMMMMMMM__##########_W",
  /* 35 */ "W_________________________MMMMMMMM__####6#####_W",
  /* 36 */ "W___________?_______LMMMMMMMMMMMMM_____________W",
  /* 37 */ "W_____________________________0________________W",
  /* 38 */ "W=====================cc================cc=====W",
  /* 39 */ "W___________n__________________________________W",
  /* 40 */ "Wr^^^^^^^^^rrrrrrrrrr!..TT......TT.....,,,,,,,,W",
  /* 41 */ "Wr#########rrrxxrrrrr_.....b......b....,,,,,,,,W",
  /* 42 */ "Wr#########rrrrr9rrrrr..%..........%...,,,,,,,,W",
  /* 43 */ "Wr####4####rrrrrrrrrrr....@............,,,,,,,,W",
  /* 44 */ "Wrrrrrrrrrrrrrrrrrrrrr...T.........T...,,^^^^^^W",
  /* 45 */ "Wrrrrrrrrrrrrrrrrrrrrr.....bb..........,,######W",
  /* 46 */ "W,,,,,,,,,,,,,,,,,,,,,.................,,##5###W",
  /* 47 */ "W,,,,,,,,,,,,,,,,,,,,,.................,,,,,,,,W",
  /* 48 */ "WTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTW",
  /* 49 */ "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
];

export const MAP_WIDTH = 48;
export const MAP_HEIGHT = RAW.length;

export interface Vec2 {
  x: number;
  y: number;
}

/** Social strata. Each band of the map behaves differently towards you. */
export type ZoneId = "heights" | "downtown" | "slums";

export interface Zone {
  id: ZoneId;
  name: string;
  /** Flavour shown on the zone signposts. */
  sign: string;
  /** Rows [from, to] inclusive. */
  from: number;
  to: number;
  /** Minimum hygiene before the local police take an interest. */
  hygieneWatch: number;
  /** Dress code required to avoid being escorted out. */
  requiresAttire: boolean;
  /** Multiplier on fines issued here. */
  fineScale: number;
}

export const ZONES: Zone[] = [
  {
    id: "heights",
    name: "The Heights",
    sign: "THE HEIGHTS — private community. Residents and invited guests only.",
    from: 0,
    to: 14,
    hygieneWatch: 60,
    requiresAttire: true,
    fineScale: 3,
  },
  {
    id: "downtown",
    name: "Market Square",
    sign: "DOWNTOWN MARKET SQUARE — no loitering, no soliciting, no overnight camping.",
    from: 15,
    to: 39,
    hygieneWatch: 30,
    requiresAttire: false,
    fineScale: 1,
  },
  {
    id: "slums",
    name: "The Outskirts",
    sign: "ROUTE 1 SOUTH — town limits. Services not maintained past this point.",
    from: 40,
    to: MAP_HEIGHT - 1,
    hygieneWatch: 0,
    requiresAttire: false,
    fineScale: 0,
  },
];

export function zoneAt(y: number): Zone {
  for (const z of ZONES) if (y >= z.from && y <= z.to) return z;
  return ZONES[1]!;
}

/** Terrain grid with markers stripped out, plus where each marker was. */
export interface TownMap {
  grid: Glyph[][];
  markers: Record<string, Vec2>;
}

function buildMap(): TownMap {
  const grid: Glyph[][] = [];
  const markers: Record<string, Vec2> = {};

  RAW.forEach((row, y) => {
    if (row.length !== MAP_WIDTH) {
      throw new Error(`map row ${y} is ${row.length} tiles wide, expected ${MAP_WIDTH}`);
    }
    const cells: Glyph[] = [];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      const marker = MARKERS[ch];
      if (marker) {
        if (markers[marker]) throw new Error(`marker "${marker}" appears more than once`);
        markers[marker] = { x, y };
        cells.push(MARKER_FLOOR[ch] ?? ".");
      } else {
        if (!TILES[ch]) throw new Error(`unknown glyph "${ch}" at ${x},${y}`);
        cells.push(ch);
      }
    }
    grid.push(cells);
  });

  for (const id of Object.values(MARKERS)) {
    if (!markers[id]) throw new Error(`map is missing marker "${id}"`);
  }
  return { grid, markers };
}

export const TOWN: TownMap = buildMap();

export function glyphAt(x: number, y: number): Glyph | undefined {
  return TOWN.grid[y]?.[x];
}

export function isSolid(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return true;
  return tileAt(glyphAt(x, y)).solid;
}

export function isOutdoors(x: number, y: number): boolean {
  return tileAt(glyphAt(x, y)).outdoor === true;
}

export function markerPos(id: string): Vec2 {
  const p = TOWN.markers[id];
  if (!p) throw new Error(`no such marker: ${id}`);
  return p;
}

/** Where the marker's location is entered from — the tile you stand on. */
export function spawnPoint(): Vec2 {
  return markerPos("spawn");
}
