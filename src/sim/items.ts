import type { MeterDelta } from "./meters";

export type ItemId =
  | "trashFood"
  | "instantNoodles"
  | "sandwich"
  | "hotMeal"
  | "waterBottle"
  | "coffee"
  | "soap"
  | "razor"
  | "medicine"
  | "poncho"
  | "raincoat"
  | "umbrella"
  | "sleepingBag"
  | "lotteryTicket"
  | "busPass"
  | "rollerSkates"
  | "kickScooter"
  | "foldingBike"
  | "bmxBike"
  | "bicycle"
  | "roadBike"
  | "skateHelmet"
  | "cyclingHelmet"
  | "phone"
  | "recyclables"
  | "staffBadge"
  | "flyers";

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Shelf price. Items with no price are never sold over a counter. */
  price?: number;
  /** What the recycling depot pays per unit. */
  sellPrice?: number;
  desc: string;
  /** Consumed on use. Non-consumable items are gear you keep. */
  consumable: boolean;
  /** Minutes the use takes. */
  minutes?: number;
  effect?: MeterDelta;
  /** Shown after using it, if anything worth saying happened. */
  flavor?: string;
  /** Long-lived gear is not shown in the "use" list. */
  gear?: boolean;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  trashFood: {
    id: "trashFood",
    name: "Dumpster Find",
    desc: "Somebody else's mistake, still mostly wrapped.",
    consumable: true,
    minutes: 5,
    effect: { hunger: +22, health: -6, hygiene: -3, morale: -8, energy: -2 },
    flavor: "It goes down. You decide not to think about it.",
  },
  instantNoodles: {
    id: "instantNoodles",
    name: "Instant Noodles",
    price: 3,
    desc: "Salt, starch, and a flavour sachet. 400% of your daily sodium.",
    consumable: true,
    minutes: 10,
    effect: { hunger: +30, thirst: -8, health: -2, morale: +2 },
  },
  sandwich: {
    id: "sandwich",
    name: "Deli Sandwich",
    price: 7,
    desc: "Refrigerated, unremarkable, actual food.",
    consumable: true,
    minutes: 10,
    effect: { hunger: +42, health: +2, morale: +4 },
  },
  hotMeal: {
    id: "hotMeal",
    name: "Hot Meal",
    price: 16,
    desc: "Served on a plate. Somebody asks how you're doing and waits for the answer.",
    consumable: true,
    minutes: 40,
    effect: { hunger: +65, thirst: +15, health: +8, morale: +22, energy: +5 },
    flavor: "For forty minutes you are a customer and not a problem.",
  },
  waterBottle: {
    id: "waterBottle",
    name: "Bottled Water",
    price: 2,
    desc: "The same water as the fountain, in a bottle, for two dollars.",
    consumable: true,
    minutes: 2,
    effect: { thirst: +45, health: +1 },
  },
  coffee: {
    id: "coffee",
    name: "Coffee",
    price: 3,
    desc: "Hot, real, and served in an actual mug.",
    consumable: true,
    minutes: 5,
    effect: { thirst: +30, morale: +10, energy: +12 },
    flavor: "Small pleasure. It counts.",
  },
  soap: {
    id: "soap",
    name: "Bar of Soap",
    price: 4,
    desc: "The difference between 'down on his luck' and 'get him out of here'.",
    consumable: true,
    minutes: 15,
    effect: { hygiene: +30, morale: +6 },
    flavor: "You wash up properly for the first time in a while.",
  },
  razor: {
    id: "razor",
    name: "Disposable Razor",
    price: 5,
    desc: "Clean-shaven reads as employable. It shouldn't matter. It does.",
    consumable: true,
    minutes: 15,
    effect: { hygiene: +18, morale: +10 },
  },
  medicine: {
    id: "medicine",
    name: "Cold Medicine",
    price: 12,
    desc: "Clears a fever. Does nothing about why you got one.",
    consumable: true,
    minutes: 10,
    effect: { health: +30, energy: +8 },
  },
  poncho: {
    id: "poncho",
    name: "Rain Poncho",
    price: 9,
    desc: "A bag with a hood. Keeps the rain from turning into a fever.",
    consumable: false,
    gear: true,
  },
  raincoat: {
    id: "raincoat",
    name: "Raincoat",
    price: 38,
    desc: "Waxed canvas, full-length. You stop being soaked and start being someone who planned ahead.",
    consumable: false,
    gear: true,
  },
  umbrella: {
    id: "umbrella",
    name: "Umbrella",
    price: 14,
    desc: "Keeps the rain off your shoulders. Doesn't help much with the wind.",
    consumable: false,
    gear: true,
  },
  sleepingBag: {
    id: "sleepingBag",
    name: "Sleeping Bag",
    price: 25,
    desc: "Rolls up small. Makes a bench survivable instead of merely legal-adjacent.",
    consumable: false,
    gear: true,
  },
  lotteryTicket: {
    id: "lotteryTicket",
    name: "Scratch Ticket",
    price: 2,
    desc: "A tax on hope. Occasionally hope pays out.",
    consumable: true,
    minutes: 2,
  },
  busPass: {
    id: "busPass",
    name: "Weekly Bus Pass",
    price: 18,
    desc: "Crosses town in ten minutes instead of forty.",
    consumable: false,
    gear: true,
  },
  rollerSkates: {
    id: "rollerSkates",
    name: "Roller Skates",
    price: 15,
    desc: "Four wheels and no dignity. Faster than walking, cheaper than everything else.",
    consumable: false,
    gear: true,
  },
  kickScooter: {
    id: "kickScooter",
    name: "Kick Scooter",
    price: 28,
    desc: "Folds flat and goes under your arm on the bus. Honest transport.",
    consumable: false,
    gear: true,
  },
  foldingBike: {
    id: "foldingBike",
    name: "Folding Bike",
    price: 32,
    desc: "Collapses into an awkward lump. Faster than walking, slower than a proper bike — but it fits under any bed.",
    consumable: false,
    gear: true,
  },
  bmxBike: {
    id: "bmxBike",
    name: "BMX",
    price: 50,
    desc: "Low gears, fat tyres, built for the street. More bike than it looks.",
    consumable: false,
    gear: true,
  },
  bicycle: {
    id: "bicycle",
    name: "Mountain Bike",
    price: 70,
    desc: "One gear, both brakes. Halves every walk you'll ever take again.",
    consumable: false,
    gear: true,
  },
  roadBike: {
    id: "roadBike",
    name: "Road Bike",
    price: 145,
    desc: "Dropped handlebars, 21 gears, tyres thin as patience. Three times faster than walking.",
    consumable: false,
    gear: true,
  },
  skateHelmet: {
    id: "skateHelmet",
    name: "Skate Helmet",
    price: 18,
    desc: "Round shell, thick foam. Covers roller skates, kick scooter, and BMX. Cheaper than one night in the emergency room.",
    consumable: false,
    gear: true,
  },
  cyclingHelmet: {
    id: "cyclingHelmet",
    name: "Cycling Helmet",
    price: 25,
    desc: "Ventilated shell, snug fit. Required for any proper bike. Also works on a BMX.",
    consumable: false,
    gear: true,
  },
  phone: {
    id: "phone",
    name: "Prepaid Phone",
    price: 45,
    desc: "A number employers can call back. This is what a job application is.",
    consumable: false,
    gear: true,
  },
  recyclables: {
    id: "recyclables",
    name: "Recyclables",
    sellPrice: 1,
    desc: "Cans and bottles. A dollar each at the depot.",
    consumable: false,
    gear: true,
  },
  staffBadge: {
    id: "staffBadge",
    name: "Staff Pass",
    desc: "A photograph of you looking startled, laminated, on a blue lanyard. It opens the Heights barrier.",
    consumable: false,
    gear: true,
  },
  flyers: {
    id: "flyers",
    name: "Stack of Flyers",
    desc: "GRAND OPENING. GRAND OPENING. GRAND OPENING.",
    consumable: false,
    gear: true,
  },
};

export const SHOP_STOCK: ItemId[] = [
  "instantNoodles",
  "sandwich",
  "waterBottle",
  "coffee",
  "soap",
  "razor",
  "medicine",
  "poncho",
  "raincoat",
  "umbrella",
  "sleepingBag",
  "busPass",
  "bicycle",
  "phone",
  "lotteryTicket",
];

export type Inventory = Partial<Record<ItemId, number>>;

export function countOf(inv: Inventory, id: ItemId): number {
  return inv[id] ?? 0;
}

export function addItem(inv: Inventory, id: ItemId, n = 1): void {
  inv[id] = countOf(inv, id) + n;
}

export function removeItem(inv: Inventory, id: ItemId, n = 1): boolean {
  const have = countOf(inv, id);
  if (have < n) return false;
  const left = have - n;
  if (left === 0) delete inv[id];
  else inv[id] = left;
  return true;
}
