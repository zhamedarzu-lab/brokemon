import { glyphAt, TOWN, zoneAt, type Vec2 } from "../world/map";
import { tileAt } from "../world/tiles";
import { applyDelta } from "./meters";
import { menu, say, type Choice, type Prompt } from "./prompt";
import { currentAppearance, pushLog, type GameState } from "./state";
import { HEIGHTS_GATE_LOOK, HOUSING } from "./social";
import { VENUES } from "./venues";
import { panhandle, scavenge, sleep, workAssignmentStop, type ActionCtx } from "./work";

const BACK: Choice = { label: "Leave" };

/** position key -> marker id, for O(1) "what is this tile" lookups. */
const MARKER_AT: Map<string, string> = new Map(
  Object.entries(TOWN.markers).map(([id, p]) => [key(p.x, p.y), id]),
);

function key(x: number, y: number): string {
  return `${x},${y}`;
}

export function markerAt(x: number, y: number): string | undefined {
  return MARKER_AT.get(key(x, y));
}

export function facingTile(s: GameState): Vec2 {
  const { pos, facing } = s.player;
  const d = facing === "up" ? { x: 0, y: -1 } : facing === "down" ? { x: 0, y: 1 } : facing === "left" ? { x: -1, y: 0 } : { x: 1, y: 0 };
  return { x: pos.x + d.x, y: pos.y + d.y };
}

/**
 * One button does everything. It checks, in order: an active job stop, the
 * tile you're standing on, then the tile you're facing.
 */
export function interact(ctx: ActionCtx): Prompt | null {
  const s = ctx.state;
  const here = s.player.pos;
  const there = facingTile(s);

  for (const cell of [here, there]) {
    const stop = assignmentStopAt(s, cell);
    if (stop >= 0) return workAssignmentStop(ctx, stop);
  }

  for (const cell of [here, there]) {
    const marker = markerAt(cell.x, cell.y);
    if (marker) {
      const prompt = markerAction(ctx, marker);
      if (prompt) return prompt;
    }
  }

  return tileAction(ctx, there);
}

export function assignmentStopAt(s: GameState, cell: Vec2): number {
  const a = s.assignment;
  if (!a || a.ready) return -1;
  return a.targets.findIndex((t) => t.x === cell.x && t.y === cell.y);
}

function markerAction(ctx: ActionCtx, marker: string): Prompt | null {
  const venue = VENUES[marker];
  if (venue) return venue(ctx);
  if (marker === "panhandleSpot") return panhandleSpot(ctx);
  if (marker === "spawn") return null;
  return null;
}

function panhandleSpot(ctx: ActionCtx): Prompt {
  const s = ctx.state;
  const zone = zoneAt(s.player.pos.y);
  return menu(
    "The corner",
    [
      "Foot traffic both ways, a bin to sit on, and a clear line of sight to the crossing.",
      zone.fineScale > 0 ? "There is a no-soliciting notice on the lamp post behind you." : "",
    ].filter(Boolean),
    [
      { label: "Sit down and ask", hint: "30 min", run: () => panhandle(ctx) },
      BACK,
    ],
  );
}

function tileAction(ctx: ActionCtx, cell: Vec2): Prompt | null {
  const s = ctx.state;
  const glyph = glyphAt(cell.x, cell.y);
  const tile = tileAt(glyph);

  switch (tile.interaction) {
    case "bench":
      return benchPrompt(ctx);

    case "dumpster":
      return scavenge(ctx, `dump:${key(cell.x, cell.y)}`);

    case "bin":
      return recycleBin(ctx);

    case "sign":
      return say("Sign", zoneAt(cell.y).sign);

    case "water":
      return menu(
        "The fountain",
        ["It is decorative, but the water is water."],
        [
          {
            label: "Drink",
            hint: "5 min, free",
            run: () => {
              ctx.advance(5);
              applyDelta(s.meters, { thirst: +42, morale: -1 });
              if (ctx.rng.chance(0.06)) {
                applyDelta(s.meters, { health: -5 });
                return menu("The fountain", ["You drink until your stomach hurts.", "Something in it disagrees with you later."], [BACK]);
              }
              return menu("The fountain", ["Cold, metallic, and free. You drink until your stomach hurts."], [BACK]);
            },
          },
          {
            label: "Wash your face and hands",
            hint: "10 min",
            run: () => {
              ctx.advance(10);
              applyDelta(s.meters, { hygiene: +8, morale: +2 });
              return menu("The fountain", ["It is not a wash. It is better than nothing and people watch you do it."], [BACK]);
            },
          },
          BACK,
        ],
      );

    case "gate":
      return heightsGate(ctx, cell);

    default:
      return null;
  }
}

function benchPrompt(ctx: ActionCtx): Prompt {
  const s = ctx.state;
  const zone = zoneAt(s.player.pos.y);
  const lines = ["Three slats and an armrest in the middle so you cannot lie flat."];
  const choices: Choice[] = [
    {
      label: "Sit for a while",
      hint: "30 min",
      run: () => {
        ctx.advance(30);
        applyDelta(s.meters, { energy: +6, morale: +2 });
        return menu("Bench", ["You sit. Your feet stop hurting. Nothing else changes."], [BACK]);
      },
    },
  ];

  if (zone.fineScale === 0) {
    choices.push({
      label: "Sleep here until morning",
      hint: HOUSING.bench.risk > 0 ? "risky" : "",
      run: () => {
        s.housing = s.housing === "street" ? "street" : s.housing;
        return sleep(ctx, "bench", 7);
      },
    });
  } else {
    choices.push({
      label: "Sleep here until morning",
      locked: "There is a no-camping ordinance in this zone",
      hint: "risky",
    });
    lines.push("A sticker on the armrest lists the overnight camping ordinance and the fine.");
  }

  choices.push(BACK);
  return menu("Bench", lines, choices);
}

function recycleBin(ctx: ActionCtx): Prompt {
  const s = ctx.state;
  ctx.advance(8, { exertion: 1.3 });
  applyDelta(s.meters, { hygiene: -2, energy: -2 });
  const n = ctx.rng.int(0, 4);
  if (n === 0) return say("Recycling bin", "Cardboard, junk mail, and nothing with a deposit on it.");
  s.inventory.recyclables = (s.inventory.recyclables ?? 0) + n;
  pushLog(s, `Pulled ${n} containers out of a bin.`);
  return menu("Recycling bin", [`${n} container${n === 1 ? "" : "s"} with the deposit still on them.`], [BACK]);
}

function heightsGate(ctx: ActionCtx, cell: Vec2): Prompt {
  const s = ctx.state;
  const look = currentAppearance(s);
  const goingUp = s.player.pos.y > cell.y;

  if (!goingUp) {
    ctx.teleport(cell.x, cell.y + 1);
    return say("Security gate", "The gate opens outward without asking anything of you.");
  }

  if (look >= HEIGHTS_GATE_LOOK) {
    ctx.teleport(cell.x, cell.y - 1);
    pushLog(s, "Passed the Heights security gate.");
    return say("Security gate", [
      "The guard looks up, looks at your clothes, and looks back down.",
      "The barrier lifts.",
    ]);
  }

  s.meters.morale = Math.max(0, s.meters.morale - 6);
  pushLog(s, "Turned back at the Heights gate.", "bad");
  return say(
    "Security gate",
    [
      "The guard steps out of the box before you reach the barrier.",
      `"Residents and guests. Are you either?"`,
      `You look like a ${look}. The gate wants a ${HEIGHTS_GATE_LOOK}.`,
    ],
    "bad",
  );
}

/** Short label for the tile you're facing, shown as the A-button hint. */
export function interactionLabel(s: GameState): string | null {
  const here = s.player.pos;
  const there = facingTile(s);

  for (const cell of [here, there]) {
    if (assignmentStopAt(s, cell) >= 0) return s.assignment?.gig === "yardWork" ? "Start work" : "Deliver";
  }
  for (const cell of [here, there]) {
    const marker = markerAt(cell.x, cell.y);
    if (marker && (VENUES[marker] || marker === "panhandleSpot")) return VENUE_LABELS[marker] ?? "Enter";
  }
  const tile = tileAt(glyphAt(there.x, there.y));
  switch (tile.interaction) {
    case "bench":
      return "Bench";
    case "dumpster":
      return "Search";
    case "bin":
      return "Search";
    case "sign":
      return "Read";
    case "water":
      return "Fountain";
    case "gate":
      return "Gate";
    default:
      return null;
  }
}

/** Long names, for the A-button hint. Also the source for the map nameplates. */
export const VENUE_LABELS: Record<string, string> = {
  communityCenter: "Community Center",
  mart: "Mart",
  corporatePlaza: "Corporate Plaza",
  hostel: "Hostel",
  trailer: "Trailer",
  apartment: "Apartments",
  estate: "The Estate",
  college: "College",
  bank: "Bank",
  laundromat: "Laundromat",
  recycling: "Recycling",
  busStop: "Bus stop",
  outskirtsBusStop: "Bus stop",
  diner: "Diner",
  jobBoard: "Job board",
  panhandleSpot: "The corner",
};

/**
 * What goes on the sign over the door. Short enough to sit inside a couple of
 * tiles at 16px, because a player standing in the street should be able to
 * tell a hostel from a laundromat without walking into either.
 */
export const DOOR_SIGNS: Record<string, string> = {
  communityCenter: "COMMUNITY",
  mart: "MART",
  corporatePlaza: "SILPH",
  hostel: "HOSTEL",
  trailer: "TO LET",
  apartment: "APARTMENTS",
  estate: "FOR SALE",
  college: "COLLEGE",
  bank: "BANK",
  laundromat: "LAUNDRY",
  recycling: "DEPOT",
  diner: "DINER",
  busStop: "BUS",
  outskirtsBusStop: "BUS",
  jobBoard: "JOBS",
};

