/**
 * Tile vocabulary for the town map.
 *
 * Every map cell is one ASCII character. Characters fall into two groups:
 *  - terrain glyphs (grass, road, wall...) which repeat freely across the map
 *  - marker glyphs (digits, punctuation) which appear exactly once and pin a
 *    named location — doors, the job board, the bus stop, the player spawn.
 *
 * Markers are erased from the terrain layer at load time and replaced by the
 * terrain they sit on (a door becomes a doorway you can stand in), so the
 * renderer never has to know they exist.
 */

export type Glyph = string;

export interface TileDef {
  /** Human-readable name, used in the "you can't get through" nudges. */
  name: string;
  /** Blocks walking. */
  solid: boolean;
  /** Base fill colour. */
  color: string;
  /** Secondary colour used by the tile's detail pass. */
  accent?: string;
  /** How the renderer decorates the cell beyond a flat fill. */
  detail?:
    | "grass"
    | "weeds"
    | "tree"
    | "wall"
    | "roof"
    | "road"
    | "crosswalk"
    | "pavement"
    | "marble"
    | "water"
    | "fence"
    | "hedge"
    | "bench"
    | "dumpster"
    | "bin"
    | "lamp"
    | "sign"
    | "flowers"
    | "gravel"
    | "cliff"
    | "gate"
    | "door";
  /** Interaction handled generically by tile type (benches, dumpsters, bins). */
  interaction?: "bench" | "dumpster" | "bin" | "sign" | "gate" | "water";
  /** Standing here counts as outdoors for weather/police purposes. */
  outdoor?: boolean;
}

export const TILES: Record<Glyph, TileDef> = {
  ".": { name: "grass", solid: false, color: "#3f6b3a", detail: "grass", outdoor: true },
  ",": { name: "weeds", solid: false, color: "#375c33", detail: "weeds", outdoor: true },
  "+": { name: "flower bed", solid: false, color: "#446f3d", detail: "flowers", outdoor: true },
  T: { name: "tree", solid: true, color: "#24422a", accent: "#2f5c34", detail: "tree", outdoor: true },
  W: { name: "retaining wall", solid: true, color: "#4a4640", accent: "#5d574e", detail: "cliff" },
  "#": { name: "wall", solid: true, color: "#7a5c46", accent: "#937054", detail: "wall" },
  "^": { name: "roof", solid: true, color: "#8f4038", accent: "#a94d43", detail: "roof" },
  "=": { name: "road", solid: false, color: "#3b3b40", accent: "#c9c05a", detail: "road", outdoor: true },
  c: { name: "crosswalk", solid: false, color: "#3b3b40", accent: "#d8d8d0", detail: "crosswalk", outdoor: true },
  _: { name: "pavement", solid: false, color: "#6d6b66", accent: "#7c7a74", detail: "pavement", outdoor: true },
  M: { name: "marble", solid: false, color: "#a9a8a2", accent: "#bcbbb4", detail: "marble", outdoor: true },
  s: { name: "dirt path", solid: false, color: "#7a6647", accent: "#8a7452", detail: "gravel", outdoor: true },
  r: { name: "gravel", solid: false, color: "#615c54", accent: "#6f6960", detail: "gravel", outdoor: true },
  "~": { name: "water", solid: true, color: "#2b5578", accent: "#3d7099", detail: "water", interaction: "water", outdoor: true },
  f: { name: "fence", solid: true, color: "#6a5638", accent: "#8a7148", detail: "fence", outdoor: true },
  H: { name: "hedge", solid: true, color: "#2c5230", accent: "#3a6b3c", detail: "hedge", outdoor: true },
  L: { name: "lamp post", solid: true, color: "#6d6b66", accent: "#3a3a3e", detail: "lamp", outdoor: true },
  b: { name: "bench", solid: true, color: "#6d6b66", accent: "#7a5c32", detail: "bench", interaction: "bench", outdoor: true },
  "%": { name: "dumpster", solid: true, color: "#5f6b52", accent: "#3f4838", detail: "dumpster", interaction: "dumpster", outdoor: true },
  x: { name: "recycling bin", solid: true, color: "#2f5c7a", accent: "#4a86ad", detail: "bin", interaction: "bin", outdoor: true },
  n: { name: "sign", solid: true, color: "#6a5638", accent: "#cfc9b4", detail: "sign", interaction: "sign", outdoor: true },
  G: { name: "security gate", solid: true, color: "#57544d", accent: "#8e8a80", detail: "gate", interaction: "gate", outdoor: true },
  I: { name: "floor", solid: false, color: "#8a7a63", accent: "#9a8a72", detail: "pavement" },
};

/** Marker glyph -> location id. Each of these appears exactly once in the map. */
export const MARKERS: Record<Glyph, string> = {
  "1": "communityCenter",
  "2": "mart",
  "3": "corporatePlaza",
  "4": "hostel",
  "5": "trailer",
  "6": "apartment",
  "7": "estate",
  "8": "college",
  "9": "recycling",
  "0": "busStop",
  "?": "jobBoard",
  $: "bank",
  "!": "panhandleSpot",
  "&": "laundromat",
  "@": "spawn",
};

/**
 * Terrain that replaces a marker glyph once its position has been recorded.
 * Doors sit in a building's front wall; you stand *on* the doorway tile.
 */
export const MARKER_FLOOR: Record<Glyph, Glyph> = {
  "1": "I",
  "2": "I",
  "3": "I",
  "4": "I",
  "5": "I",
  "6": "I",
  "7": "I",
  "8": "I",
  "9": "r",
  "0": "_",
  "?": "_",
  $: "I",
  "!": "_",
  "&": "I",
  "@": "_",
};

export function tileAt(glyph: Glyph | undefined): TileDef {
  return (glyph && TILES[glyph]) || TILES["."]!;
}
