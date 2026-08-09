/**
 * Clothes and addresses — the two things the town actually reads you by.
 */

export type OutfitId = "rags" | "thrift" | "smartCasual" | "professional" | "tailored";

export interface OutfitDef {
  id: OutfitId;
  name: string;
  price: number;
  /** How presentable you look regardless of how clean you are, 0-100. */
  presentation: number;
  desc: string;
}

export const OUTFITS: Record<OutfitId, OutfitDef> = {
  rags: {
    id: "rags",
    name: "What You Slept In",
    price: 0,
    presentation: 5,
    desc: "Three days past the point where anyone asks if you're alright.",
  },
  thrift: {
    id: "thrift",
    name: "Thrift Store Clothes",
    price: 15,
    presentation: 35,
    desc: "Clean, ill-fitting, and enough to get served in a shop.",
  },
  smartCasual: {
    id: "smartCasual",
    name: "Smart Casual",
    price: 60,
    presentation: 60,
    desc: "A collar. It is amazing what a collar does.",
  },
  professional: {
    id: "professional",
    name: "Interview Suit",
    price: 180,
    presentation: 85,
    desc: "Off the rack, pressed, entirely convincing from six feet away.",
  },
  tailored: {
    id: "tailored",
    name: "Tailored Suit",
    price: 900,
    presentation: 100,
    desc: "Fitted. People you have never met begin the conversation deferentially.",
  },
};

export const OUTFIT_ORDER: OutfitId[] = ["rags", "thrift", "smartCasual", "professional", "tailored"];

export function outfitRank(id: OutfitId): number {
  return OUTFIT_ORDER.indexOf(id);
}

/**
 * How you read to a stranger: mostly hygiene, partly clothes, and clothes
 * cannot fully cover for being filthy.
 */
/**
 * What the guard on the Heights barrier wants to see. Everything up the hill
 * is behind this one number — the estate, and the corporate plaza where every
 * career job is actually worked.
 */
export const HEIGHTS_GATE_LOOK = 70;

export function appearance(hygiene: number, outfit: OutfitId): number {
  const dress = OUTFITS[outfit].presentation;
  const raw = hygiene * 0.55 + dress * 0.45;
  return Math.round(hygiene < 25 ? raw * 0.7 : raw);
}

export type HousingId = "street" | "bench" | "hostel" | "room" | "trailer" | "apartment" | "estate";

/**
 * Worst address to best. Once you can hold a room in more than one town, the
 * phase you are in is set by the best one you have anywhere — so the ordering
 * has to be explicit rather than inferred from rest quality, where the
 * apartment and the estate tie.
 */
export const HOUSING_ORDER: HousingId[] = ["street", "bench", "hostel", "room", "trailer", "apartment", "estate"];

export function housingRank(id: HousingId): number {
  return HOUSING_ORDER.indexOf(id);
}

export interface HousingDef {
  id: HousingId;
  name: string;
  /** Charged every `rentEvery` days. Nightly beds charge on use instead. */
  rent: number;
  rentEvery: number;
  /** Fraction of energy restored by a full night. */
  restQuality: number;
  /** Chance per night of being robbed or moved on. */
  risk: number;
  /** You can wash here without paying anyone. */
  hasShower: boolean;
  /** Somewhere to keep things that isn't your arms. */
  storage: boolean;
  desc: string;
}

export const HOUSING: Record<HousingId, HousingDef> = {
  street: {
    id: "street",
    name: "No fixed address",
    rent: 0,
    rentEvery: 0,
    restQuality: 0.35,
    risk: 0.35,
    hasShower: false,
    storage: false,
    desc: "Wherever you can lie down without being asked to move.",
  },
  bench: {
    id: "bench",
    name: "A park bench",
    rent: 0,
    rentEvery: 0,
    restQuality: 0.5,
    risk: 0.3,
    hasShower: false,
    storage: false,
    desc: "Slats, dew, and the six o'clock sprinklers.",
  },
  hostel: {
    id: "hostel",
    name: "Hostel cot",
    rent: 9,
    // Paid at the desk, night by night — never billed on the rent clock.
    rentEvery: 0,
    restQuality: 0.75,
    risk: 0.08,
    hasShower: true,
    storage: false,
    desc: "Nine dollars, lights out at eleven, twelve other people breathing.",
  },
  room: {
    id: "room",
    name: "A room on St Giles Row",
    // Dearer than the trailer and worse, and it is still the best decision in
    // the game once you work in Brokedale: it buys back the 250 minutes and
    // $26 the crossing takes off a commuter every single day.
    rent: 95,
    rentEvery: 7,
    restQuality: 0.82,
    risk: 0.06,
    // The bathroom is two floors down and shared with eleven people. The
    // washhouse across the road is what you actually use, and it charges.
    hasShower: false,
    storage: true,
    desc: "Fourth floor, no lift, and a window that looks at another window.",
  },
  trailer: {
    id: "trailer",
    name: "Trailer on Route 1",
    rent: 70,
    rentEvery: 7,
    restQuality: 0.88,
    risk: 0.03,
    hasShower: true,
    storage: true,
    desc: "Yours until Friday. The door locks. That is the entire luxury.",
  },
  apartment: {
    id: "apartment",
    name: "1-bed apartment, Market Square",
    rent: 520,
    rentEvery: 30,
    restQuality: 1.0,
    risk: 0,
    hasShower: true,
    storage: true,
    desc: "Furnished. A kitchen. A door you are allowed to close.",
  },
  estate: {
    id: "estate",
    name: "The estate on the hill",
    rent: 0,
    rentEvery: 0,
    restQuality: 1.0,
    risk: 0,
    hasShower: true,
    storage: true,
    desc: "Six bedrooms. You sleep in the smallest one out of habit.",
  },
};
