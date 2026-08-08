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
  /* 00 */ "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
  /* 01 */ "WTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTW",
  /* 02 */ "WT.HHHHHHHHHHHHHH.....HHHHHHHHHHHHHHHHHHHHHHH.....HHHHHHHHHHHHHH.......W",
  /* 03 */ "WT.H^^^^^^^^^^^^H.....H^^^^^^^^^^^^^^^^^^^^^H.....H^^^^^^^^^^^^H.......W",
  /* 04 */ "WT.H############H.....H#####################H.....H############H.......W",
  /* 05 */ "WT.H############H.....H#####################H.....H############H.......W",
  /* 06 */ "WT.H############H.....H#####################H.....H############H.......W",
  /* 07 */ "WT.H############H.....H#####################H.....H############H.......W",
  /* 08 */ "WT.H############H.....H#####################H.....H############H.......W",
  /* 09 */ "WT.H#####7######H.....H##########3##########H.....H############H.......W",
  /* 10 */ "WT.HHHHHH.HHHHHHH.....HHHHHHHHHHH.HHHHHHHHHHH.....HHHHHHHHHHHHHH.......W",
  /* 11 */ "W...............T...........L..................L...........T...........W",
  /* 12 */ "W......................................................................W",
  /* 13 */ "W.....b.....T................................................T.....b...W",
  /* 14 */ "WHHHHHHHHHHHHHHHHHHHHHHGGHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHW",
  /* 15 */ "W___________________________________cc_________________________________W",
  /* 16 */ "W===================================cc=================================W",
  /* 17 */ "W===================================cc=================================W",
  /* 18 */ "W___________________________________cc_________________________________W",
  /* 19 */ "W___________________MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM___________________W",
  /* 20 */ "W_________________L_MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM_L_________________W",
  /* 21 */ "W___________________MMMMMMMMMM~~~~~~~~~~~~MMMMMMMMMM___________________W",
  /* 22 */ "W___________________MMMMMMMMMM~~~~~~~~~~~~MMMMMMMMMM___________________W",
  /* 23 */ "W___________________MMMMMMMMMM~~~~~~~~~~~~MMMMMMMMMM___________________W",
  /* 24 */ "W___________________MMMMMMMMMM~~~~~~~~~~~~MMMMMMMMMM___________________W",
  /* 25 */ "W___________________MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM___________________W",
  /* 26 */ "W___________________MMMMMMMMMMMMMMM$MMMMMMMMMMMMMMMM___________________W",
  /* 27 */ "W_________________L_MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM_L_________________W",
  /* 28 */ "W___________________________________n__________________________________W",
  /* 29 */ "W^^^^^^^^^^^^^^^^^____^^^^^^^^^^^^^^^^^^^^^^^^^____^^^^^^^^^^^^^^^^^^__W",
  /* 30 */ "W#################____#########################____##################__W",
  /* 31 */ "W#################____#########################____##################__W",
  /* 32 */ "W#################____#########################____##################__W",
  /* 33 */ "W#################____#########################____##################__W",
  /* 34 */ "W#################____#########################____##################__W",
  /* 35 */ "W#################____############2############____##################__W",
  /* 36 */ "W########1########_________________________________########8#########__W",
  /* 37 */ "W______________________________________________________________________W",
  /* 38 */ "W____n____________________________________________________________n____W",
  /* 39 */ "W^^^^^^^^^^^^^^^_______________________________________________________W",
  /* 40 */ "W###############_______________________________________________________W",
  /* 41 */ "W###############_______________________________________________________W",
  /* 42 */ "W###############_______________________________________________________W",
  /* 43 */ "W###############_______________________________________________________W",
  /* 44 */ "W#######&#######____________________0___________________?______________W",
  /* 45 */ "W___________________________________cc_________________________________W",
  /* 46 */ "W===================================cc=================================W",
  /* 47 */ "W===================================cc=================================W",
  /* 48 */ "W===================================cc=================================W",
  /* 49 */ "W___________________________________cc_________________________________W",
  /* 50 */ "W^^^^^^^^^^^^^^^^^____^^^^^^^^^^^^^^^^^^^^^^____^^^^^^^^^^^^^^^^^______W",
  /* 51 */ "W#################____######################____#################______W",
  /* 52 */ "W#################____######################____#################______W",
  /* 53 */ "W#################____######################____#################______W",
  /* 54 */ "W#################____######################____#################______W",
  /* 55 */ "W#################____######################____#################______W",
  /* 56 */ "W#################____######################____#################______W",
  /* 57 */ "W########D########____###########9##########____########6########______W",
  /* 58 */ "W______________________________________________________________________W",
  /* 59 */ "W^^^^^^^^^^^^^^^_________^^^^^^^^^^^^^^^^^^^^^_________^^^^^^^^^^^^^^^^W",
  /* 60 */ "W###############_________#####################_________################W",
  /* 61 */ "W###############_________#####################_________################W",
  /* 62 */ "W###############_________#####################_________################W",
  /* 63 */ "W###############_________#####################_________################W",
  /* 64 */ "W###############_________#####################_________################W",
  /* 65 */ "W###############_________#####################_________################W",
  /* 66 */ "W#######4#######_________##########B##########_________########5#######W",
  /* 67 */ "W___________________________________cc_________________________________W",
  /* 68 */ "W=================A=================cc=================================W",
  /* 69 */ "W....b........%..............%..............%..............%......x....W",
  /* 70 */ "W.....T.....T....@.....!...........................................T...W",
  /* 71 */ "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
];

export const MAP_WIDTH = 72;
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
    to: 49,
    hygieneWatch: 30,
    requiresAttire: false,
    fineScale: 1,
  },
  {
    id: "slums",
    name: "The Outskirts",
    sign: "ROUTE 1 SOUTH — town limits. Services not maintained past this point.",
    from: 50,
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
