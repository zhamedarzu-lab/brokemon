import { markerPos } from "../world/map";
import {
  boardingReasons,
  firstDeparture,
  fmtDeparture,
  lastDeparture,
  nextDeparture,
  rideCoach,
  serviceFrom,
  waitFor,
} from "./coach";
import { addItem, countOf, ITEMS, removeItem, SHOP_STOCK, type ItemId } from "./items";
import {
  CLASS_COST,
  CLASS_END,
  CLASS_ENERGY_COST,
  CLASS_MIN_ENERGY,
  CLASS_NAMES,
  CLASS_START,
  EMPLOYMENT,
  employmentIn,
  hiringRequirements,
  worksBehindTheGate,
  GIGS,
  MAX_CREDITS,
  type EmploymentDef,
  type EmploymentId,
} from "./jobs";
import { applyDelta } from "./meters";
import { menu, say, type Choice, type Prompt } from "./prompt";
import { HEIGHTS_GATE_LOOK, HOUSING, OUTFITS, OUTFIT_ORDER, outfitRank, type OutfitId } from "./social";
import {
  canDoGig,
  changeReputation,
  checkRequirements,
  currentAppearance,
  earnCash,
  hasItem,
  phaseOf,
  pushLog,
  housingIn,
  reputationIn,
  restoreBody,
  restoreClothes,
  setHousing,
  setWon,
  syncHygiene,
  townOf,
  type GameState,
} from "./state";
import { withinHours } from "./time";
import {
  caffeineCup,
  clockInHint,
  collectAssignment,
  grantOrTakeBadge,
  fmtHour,
  lockedChoice,
  shiftWindow,
  sleep,
  startAssignment,
  workShift,
  type ActionCtx,
} from "./work";

const BACK: Choice = { label: "Leave" };

type Venue = (ctx: ActionCtx) => Prompt;

/* ------------------------------------------------------- community center */

const communityCenter: Venue = (ctx) => {
  const s = ctx.state;
  const shelterOpen = withinHours(s.time, 18, 8);
  const clinicOpen = withinHours(s.time, 8, 18);
  const lines = ["A strip light, a noticeboard, and a queue that moves slowly."];
  const choices: Choice[] = [];

  if (clinicOpen) {
    const fee = s.cash >= 25 ? 25 : 0;
    choices.push({
      label: s.sick ? "See the nurse about the fever" : "Get checked over",
      hint: fee ? `$${fee}` : "sliding scale",
      run: () => {
        ctx.advance(60, { sheltered: true });
        s.cash -= fee;
        s.sick = false;
        s.meters.health = Math.min(100, s.meters.health + 45);
        s.meters.morale = Math.min(100, s.meters.morale + 6);
        pushLog(s, "Seen at the clinic.", "good");
        return menu(
          "Clinic",
          fee
            ? ["An hour in a plastic chair, then eight minutes with a nurse who is kind and in a hurry.", `Paid $${fee}.`]
            : ["They put you down as unable to pay and treat you anyway.", "It costs you an hour and some dignity you didn't have."],
          [BACK],
          "good",
        );
      },
    });
  } else {
    lines.push("The clinic desk is dark. The shelter side is open.");
  }

  // The washroom is the one thing here that never closes, and the only reason
  // anyone in phase one can get clean enough to be served in a shop.
  choices.push({
    label: "Wash up in the bathroom",
    hint: "20 min, free",
    run: () => {
      ctx.advance(20, { sheltered: true });
      restoreBody(s, 70);
      applyDelta(s.meters, { morale: +8 });
      pushLog(s, "Washed up at the community center.", "good");
      return menu(
        "Community Center",
        ["Hot water, a paper towel dispenser, and nobody hurrying you.", "You come out looking like a person."],
        [BACK],
        "good",
      );
    },
  });

  const foodBankKey = "foodBankDay";
  const today = Math.floor(s.time / 1440);
  choices.push(
    (s.flags[foodBankKey] ?? -1) === today
      ? { label: "Food bank", hint: "one per day", locked: "You've already collected today" }
      : {
          label: "Food bank",
          hint: "free, 25 min",
          run: () => {
            ctx.advance(25, { sheltered: true });
            s.flags[foodBankKey] = today;
            addItem(s.inventory, "instantNoodles", 2);
            addItem(s.inventory, "waterBottle", 2);
            if (ctx.rng.chance(0.35)) addItem(s.inventory, "sandwich", 1);
            pushLog(s, "Collected a food parcel.", "good");
            return menu(
              "Food Bank",
              ["A carrier bag: noodles, a bottle of water, and whatever the shop couldn't sell.", "The volunteer remembers your name. You wish she didn't."],
              [BACK],
              "good",
            );
          },
        },
  );

  if (shelterOpen) {
    choices.push({
      label: "Take a bed for the night",
      hint: "free, curfew 8AM",
      run: () => {
        const before = housingIn(s);
        setHousing(s, "hostel");
        const result = sleep(ctx, "hostel", 7);
        setHousing(s, before);
        s.meters.morale = Math.min(100, s.meters.morale + 4);
        pushLog(s, "Slept at the shelter.");
        const extraLines = s.employment === "nightStock"
          ? ["Night shift workers often crash here after 3 AM — doors open early."]
          : [];
        return {
          ...result,
          title: "Shelter",
          lines: ["Lights out at eleven. Everyone up and out by eight.", ...extraLines, ...result.lines],
        };
      },
    });
  } else {
    choices.push({ label: "Take a bed for the night", locked: "The shelter opens at 6PM", hint: "6PM–8AM" });
  }

  choices.push(BACK);
  return menu("Community Center", lines, choices);
};

/* -------------------------------------------------------------------- mart */

const mart: Venue = (ctx) => {
  const s = ctx.state;
  const open = withinHours(s.time, 6, 23);
  const staffJob = s.employment === "martClerk" || s.employment === "nightStock" ? s.employment : null;
  const staffWindow = staffJob ? shiftWindow(s, staffJob) : "closed";
  const onShift = staffWindow === "open" || staffWindow === "late";

  if (!open) {
    // The shop shuts at eleven; the overnight stocker's shift runs to three.
    // Without a staff door the whole job was unreachable after 11PM.
    if (!onShift) return say("Brokemon Mart", "Shutters down. Opens at 6AM.");
    return menu(
      "Brokemon Mart — staff entrance",
      ["The shop floor is dark and the shutters are down.", "You let yourself in round the back."],
      [
        { label: "Clock in", hint: staffWindow === "late" ? "late" : "on time", run: () => workShift(ctx, staffJob!) },
        BACK,
      ],
    );
  }

  const look = currentAppearance(s);
  if (look < 28) {
    s.meters.morale = Math.max(0, s.meters.morale - 6);
    pushLog(s, "Refused service at the Mart.", "bad");
    return say(
      "Brokemon Mart",
      [
        `The clerk comes out from behind the counter before you're two steps in.`,
        `"Not today. Come back when you've cleaned yourself up."`,
      ],
      "bad",
    );
  }

  const choices: Choice[] = [
    { label: "Buy something", run: () => shop(ctx, "Brokemon Mart", SHOP_STOCK) },
    {
      label: "Buy thrift-store clothes",
      hint: `$${OUTFITS.thrift.price}`,
      locked: s.wardrobe.includes("thrift") ? "You already own a set" : undefined,
      run: () => buyOutfit(ctx, "thrift"),
    },
  ];

  if (staffJob) {
    choices.push({
      label: "Clock in",
      hint: clockInHint(s, staffJob),
      run: () => workShift(ctx, staffJob),
    });
  }

  const dayLabor = canDoGig(s, "dayLabor");
  choices.push(
    dayLabor.ok
      ? {
          label: "Ask about unloading the truck",
          hint: `3h, $${GIGS.dayLabor.basePay}`,
          run: () => doDayLabor(ctx),
        }
      : lockedChoice("Ask about unloading the truck", dayLabor.reasons, "3h"),
  );

  choices.push(BACK);
  return menu(
    "Brokemon Mart",
    ["Fluorescent light, a hot-food cabinet, and a lottery display by the till."],
    choices,
  );
};

function doDayLabor(ctx: ActionCtx): Prompt {
  const s = ctx.state;
  const def = GIGS.dayLabor;
  ctx.advance(def.minutes, { exertion: def.exertion, sheltered: true });
  applyDelta(s.meters, def.cost);
  const pay = def.basePay + ctx.rng.int(-6, 10);
  earnCash(s, pay);
  s.gigsToday.dayLabor = (s.gigsToday.dayLabor ?? 0) + 1;
  pushLog(s, `Day labour at the Mart — $${pay}.`, "money");
  return menu(
    "Loading bay",
    [
      "Three hours of boxes. Nobody asks your name and nobody writes anything down.",
      `Cash in hand: $${pay}.`,
    ],
    [BACK],
    "money",
  );
}

/* ------------------------------------------------------------------- shop */

function shop(ctx: ActionCtx, title: string, stock: ItemId[]): Prompt {
  const s = ctx.state;
  const choices: Choice[] = stock.map((id) => {
    const def = ITEMS[id];
    const price = def.price ?? 0;
    if (s.cash < price) return { label: def.name, hint: `$${price}`, locked: "You can't afford it" };
    return {
      label: def.name,
      hint: `$${price}`,
      run: () => {
        s.cash -= price;
        if (id === "lotteryTicket") return scratchCard(ctx);
        if (id === "busPass") {
          // Renewal: don't stack a second pass in inventory; just reset the counter.
          if (countOf(s.inventory, "busPass") === 0) addItem(s.inventory, id);
          s.busPassDaysLeft = 7;
        } else {
          addItem(s.inventory, id);
        }
        pushLog(s, `Bought ${def.name} for $${price}.`, "money");
        return shop(ctx, title, stock);
      },
    };
  });
  choices.push(BACK);
  return menu(title, [`You have $${s.cash}.`], choices);
}

function scratchCard(ctx: ActionCtx): Prompt {
  const s = ctx.state;
  ctx.advance(3, { sheltered: true });
  const roll = ctx.rng.next();
  let win = 0;
  if (roll > 0.995) win = 500;
  else if (roll > 0.96) win = 20;
  else if (roll > 0.82) win = 4;
  if (win > 0) earnCash(s, win);
  if (win === 0) {
    s.meters.morale = Math.max(0, s.meters.morale - 3);
    return menu("Scratch Ticket", ["Three lemons, a bell, and nothing."], [{ label: "Bin it" }]);
  }
  pushLog(s, `Scratch ticket paid $${win}.`, "money");
  s.meters.morale = Math.min(100, s.meters.morale + (win >= 500 ? 25 : 6));
  return menu(
    "Scratch Ticket",
    win >= 500
      ? ["Five hundred dollars.", "You read it four times standing in the doorway."]
      : [`$${win}. Enough for another ticket and something to eat.`],
    [{ label: "Cash it in" }],
    "money",
  );
}

/* -------------------------------------------------------------- laundromat */

const laundromat: Venue = (ctx) => {
  const s = ctx.state;
  if (!withinHours(s.time, 7, 21)) return say("Wash & Wear", "Closed. Open 7AM to 9PM.");

  const choices: Choice[] = [
    s.cash >= 6
      ? {
          label: "Wash everything you own",
          hint: "$6, 45 min",
          run: () => {
            s.cash -= 6;
            ctx.advance(45, { sheltered: true });
            restoreClothes(s, 80);
            applyDelta(s.meters, { morale: +10 });
            pushLog(s, "Did laundry.", "good");
            return menu(
              "Wash & Wear",
              ["Forty-five minutes watching a drum turn.", "You put on clothes that are warm and smell of nothing at all."],
              [BACK],
              "good",
            );
          },
        }
      : { label: "Wash everything you own", hint: "$6", locked: "You can't afford it" },
  ];

  for (const id of OUTFIT_ORDER) {
    if (id === "rags") continue;
    const def = OUTFITS[id];
    if (s.wardrobe.includes(id)) {
      choices.push({
        label: `Change into ${def.name}`,
        hint: `look ${def.presentation}`,
        locked: s.wearing === id ? "Already wearing it" : undefined,
        run: () => {
          s.wearing = id;
          pushLog(s, `Changed into ${def.name}.`);
          return menu("Wash & Wear", [def.desc], [BACK]);
        },
      });
    } else if (id !== "thrift") {
      choices.push(
        s.cash >= def.price
          ? { label: `Buy ${def.name}`, hint: `$${def.price}`, run: () => buyOutfit(ctx, id) }
          : { label: `Buy ${def.name}`, hint: `$${def.price}`, locked: "You can't afford it" },
      );
    }
  }

  choices.push(BACK);
  return menu(
    "Wash & Wear — Laundromat & Outfitters",
    ["Six washers, four dryers, and a rail of other people's suits at the back."],
    choices,
  );
};

function buyOutfit(ctx: ActionCtx, id: OutfitId): Prompt {
  const s = ctx.state;
  const def = OUTFITS[id];
  if (s.cash < def.price) return say("Wash & Wear", "You can't afford that.");
  s.cash -= def.price;
  s.wardrobe.push(id);
  s.wearing = id;
  s.clothesClean = 90; // Brand-new clothes are clean.
  syncHygiene(s);
  s.meters.morale = Math.min(100, s.meters.morale + (outfitRank(id) >= 3 ? 18 : 8));
  pushLog(s, `Bought ${def.name} for $${def.price}.`, "money");
  return menu(
    "Wash & Wear",
    [def.desc, "You change in the back and leave the old set in the bin."],
    [BACK],
    "money",
  );
}

/* -------------------------------------------------------------- recycling */

const recycling: Venue = (ctx) => {
  const s = ctx.state;
  const cans = countOf(s.inventory, "recyclables");
  if (cans === 0) {
    return say("Recycling Depot", "The machine wants cans and bottles. You have neither.");
  }
  const rate = 1;
  const pay = Math.floor(cans * rate);
  return menu(
    "Recycling Depot",
    [`${cans} container${cans === 1 ? "" : "s"} in the bag.`, `The machine offers $${pay}.`],
    [
      {
        label: "Feed it in",
        hint: `$${pay}`,
        run: () => {
          ctx.advance(15, { exertion: 1.2 });
          removeItem(s.inventory, "recyclables", cans);
          earnCash(s, pay);
          pushLog(s, `Cashed in ${cans} containers for $${pay}.`, "money");
          return menu(
            "Recycling Depot",
            [`The machine counts them one at a time and prints a slip. $${pay}.`],
            [BACK],
            "money",
          );
        },
      },
      BACK,
    ],
  );
};

/* ------------------------------------------------------------------ hostel */

const hostel: Venue = (ctx) => {
  const s = ctx.state;
  const rate = HOUSING.hostel.rent;
  const choices: Choice[] = [];

  choices.push(
    s.cash >= rate
      ? {
          label: "Pay for a cot",
          hint: `$${rate}/night`,
          run: () => {
            s.cash -= rate;
            setHousing(s, "hostel");
            s.nightsPaid[s.player.town] = 1;
            pushLog(s, `Paid $${rate} for a hostel cot.`, "money");
            return sleep(ctx, "hostel", 7);
          },
        }
      : { label: "Pay for a cot", hint: `$${rate}/night`, locked: `You're $${rate - s.cash} short` },
  );

  // The shower is always available — you don't need a cot to wash up.
  choices.push(
    s.cash >= 2
      ? {
          label: "Use the showers",
          hint: "$2, 20 min",
          run: () => {
            s.cash -= 2;
            ctx.advance(20, { sheltered: true });
            restoreBody(s, 55);
            applyDelta(s.meters, { morale: +6 });
            return menu("Hostel", ["Two dollars for eight minutes of hot water. Worth it."], [BACK], "good");
          },
        }
      : { label: "Use the showers", hint: "$2", locked: "You can't afford it" },
  );

  choices.push(BACK);
  return menu(
    "Route 1 Hostel",
    ["A desk, a laminated price list, and the smell of industrial bleach.", `Cots are $${rate} a night, cash up front.`],
    choices,
  );
};

/* ----------------------------------------------------------------- trailer */

const trailer: Venue = (ctx) => {
  const s = ctx.state;
  const def = HOUSING.trailer;
  if (housingIn(s) === "trailer") {
    return menu(
      "Your trailer",
      [def.desc, `Rent of $${def.rent} is due on day ${s.rentDueDay[s.player.town]}.`],
      [
        { label: "Sleep until morning", run: () => sleep(ctx, "trailer", 7) },
        {
          label: "Wash",
          hint: "25 min",
          run: () => {
            ctx.advance(25, { sheltered: true });
            restoreBody(s, 60);
            applyDelta(s.meters, { morale: +6 });
            return menu("Your trailer", ["The water runs brown for a second and then it's fine."], [BACK], "good");
          },
        },
        BACK,
      ],
    );
  }

  const deposit = def.rent;
  return menu(
    "Trailer — TO LET",
    ["A single-wide at the end of Route 1. The door locks. That is the entire pitch.", `$${def.rent} a week, first week up front.`],
    [
      s.cash >= deposit
        ? {
            label: "Take it",
            hint: `$${deposit}`,
            run: () => {
              s.cash -= deposit;
              setHousing(s, "trailer");
              s.rentDueDay[s.player.town] = Math.floor(s.time / 1440) + 1 + def.rentEvery;
              s.meters.morale = Math.min(100, s.meters.morale + 22);
              pushLog(s, "Rented the trailer on Route 1.", "good");
              return menu(
                "Your trailer",
                ["He hands you one key on a loop of string.", "You lock the door from the inside and stand there for a minute."],
                [BACK],
                "good",
              );
            },
          }
        : { label: "Take it", hint: `$${deposit}`, locked: `You're $${deposit - s.cash} short` },
      BACK,
    ],
  );
};

/* --------------------------------------------------------------- apartment */

const apartment: Venue = (ctx) => {
  const s = ctx.state;
  const def = HOUSING.apartment;
  if (housingIn(s) === "apartment" || housingIn(s) === "estate") {
    return menu(
      "Your apartment",
      [def.desc, `Rent of $${def.rent} is due on day ${s.rentDueDay[s.player.town]}.`],
      [
        { label: "Sleep until morning", run: () => sleep(ctx, "apartment", 7) },
        {
          label: "Shower and change",
          hint: "30 min",
          run: () => {
            ctx.advance(30, { sheltered: true });
            restoreBody(s, 75);
            restoreClothes(s, 50);
            applyDelta(s.meters, { morale: +8 });
            return menu("Your apartment", ["Your own bathroom. You take your time."], [BACK], "good");
          },
        },
        {
          label: "Cook a proper meal",
          hint: "45 min",
          run: () => {
            ctx.advance(45, { sheltered: true });
            applyDelta(s.meters, { hunger: +60, thirst: +20, morale: +14, health: +6 });
            return menu("Your apartment", ["You cook, badly, and eat sitting down at a table."], [BACK], "good");
          },
        },
        BACK,
      ],
    );
  }

  const deposit = def.rent * 2;
  const creditNeeded = 620;
  const reasons: string[] = [];
  if (s.credit < creditNeeded) {
    // The score is capped at 600 while anything is outstanding, so pointing at
    // the number alone sends the player off to earn money they cannot spend on
    // the problem. Name the debt instead.
    reasons.push(
      s.debt > 0
        ? `your credit score is ${s.credit} and they want ${creditNeeded} — it will not climb past 600 while you still owe $${s.debt}`
        : `your credit score is ${s.credit}, they want ${creditNeeded}`,
    );
  }
  if (s.cash + s.bank < deposit) reasons.push(`the deposit is $${deposit} and you have $${s.cash + s.bank}`);
  if (!s.employment || EMPLOYMENT[s.employment].tier < 3) reasons.push("they want to see three months of professional payslips");

  return menu(
    "Market Square Apartments — VACANCY",
    [
      "One bedroom, furnished, second floor at the back.",
      `$${def.rent} a month. Two months up front. They will run your credit.`,
    ],
    [
      reasons.length === 0
        ? {
            label: "Sign the lease",
            hint: `$${deposit}`,
            run: () => {
              const fromCash = Math.min(s.cash, deposit);
              s.cash -= fromCash;
              s.bank -= deposit - fromCash;
              setHousing(s, "apartment");
              s.rentDueDay[s.player.town] = Math.floor(s.time / 1440) + 1 + def.rentEvery;
              s.meters.morale = 100;
              s.peakPhase = 3;
              pushLog(s, "Signed a lease on an apartment in Market Square.", "good");
              return menu(
                "Your apartment",
                [
                  "She photocopies your ID, hands you two keys and a fob, and tells you the bins go out Tuesday.",
                  "The door closes behind you and the room is completely silent.",
                ],
                [BACK],
                "good",
              );
            },
          }
        : lockedChoice("Sign the lease", reasons, `$${deposit}`),
      BACK,
    ],
  );
};

/* ------------------------------------------------------------------ estate */

export const ESTATE_PRICE = 38000;

const estate: Venue = (ctx) => {
  const s = ctx.state;
  if (housingIn(s) === "estate") {
    return menu(
      "The estate",
      [HOUSING.estate.desc],
      [
        { label: "Sleep", run: () => sleep(ctx, "estate", 7) },
        {
          label: "Stand at the window and look down at the town",
          run: () => {
            ctx.advance(30, { sheltered: true });
            applyDelta(s.meters, { morale: +10 });
            return menu(
              "The estate",
              [
                "From up here Market Square is about the size of your hand.",
                "You can see the bench. You can see the dumpster behind the Mart.",
                "You know exactly how long it takes to walk between them.",
              ],
              [BACK],
            );
          },
        },
        BACK,
      ],
    );
  }

  const funds = s.cash + s.bank + s.investments;
  const reasons: string[] = [];
  if (funds < ESTATE_PRICE) reasons.push(`the asking price is $${ESTATE_PRICE.toLocaleString()} and you have $${funds.toLocaleString()}`);
  if (s.credit < 720) {
    reasons.push(
      s.bank + s.investments <= 2000
        ? `they will not take an offer from a ${s.credit} credit score, and it stops at 700 until you are holding more than $2,000 in savings`
        : `they will not take an offer from a ${s.credit} credit score`,
    );
  }

  return menu(
    "The estate on the hill — FOR SALE",
    [
      "Six bedrooms, a gravel drive, and a view of the entire town.",
      `Asking $${ESTATE_PRICE.toLocaleString()}.`,
    ],
    [
      reasons.length === 0
        ? {
            label: "Make an offer",
            hint: `$${ESTATE_PRICE.toLocaleString()}`,
            run: () => {
              let owed = ESTATE_PRICE;
              const fromCash = Math.min(s.cash, owed);
              s.cash -= fromCash;
              owed -= fromCash;
              const fromBank = Math.min(s.bank, owed);
              s.bank -= fromBank;
              owed -= fromBank;
              s.investments -= owed;
              setHousing(s, "estate");
              s.peakPhase = 4;
              s.meters.morale = 100;
              pushLog(s, "Bought the estate on the hill.", "good");
              if (s.businessOwned || s.mayor) setWon(s, "estate");
              return menu(
                "The estate",
                [
                  "The agent hands over the keys in the drive and says it's a wonderful property.",
                  "You walk through six empty rooms. In the last one you sit down on the floor out of habit.",
                ],
                [BACK],
                "good",
              );
            },
          }
        : lockedChoice("Make an offer", reasons, `$${ESTATE_PRICE.toLocaleString()}`),
      BACK,
    ],
  );
};

/* ----------------------------------------------------------------- college */

const college: Venue = (ctx) => {
  const s = ctx.state;
  const open = withinHours(s.time, CLASS_START, CLASS_END);
  const nextName = CLASS_NAMES[Math.min(s.education, CLASS_NAMES.length - 1)] ?? "Independent Study";

  if (s.education >= MAX_CREDITS) {
    return say("Community College", ["You've taken everything they offer at night.", "The rest is on you."]);
  }
  if (!open) {
    return say("Community College", [`Night classes run ${fmtHour(CLASS_START)} to ${fmtHour(CLASS_END)}.`, `Next up: ${nextName}.`]);
  }

  const reasons: string[] = [];
  if (s.cash < CLASS_COST) reasons.push(`the class is $${CLASS_COST} and you have $${s.cash}`);
  if (s.meters.energy < CLASS_MIN_ENERGY) reasons.push("you would sleep through it");

  return menu(
    "Community College — Night School",
    [`Tonight: ${nextName}.`, `$${CLASS_COST} for the session. ${s.education}/${MAX_CREDITS} credits so far.`],
    [
      reasons.length === 0
        ? {
            label: "Attend",
            hint: `$${CLASS_COST}, 3h`,
            run: () => {
              s.cash -= CLASS_COST;
              ctx.advance(180, { sheltered: true, exertion: 0.6 });
              const spent = s.meters.energy <= CLASS_ENERGY_COST + 6;
              applyDelta(s.meters, { energy: -CLASS_ENERGY_COST, hunger: -12, thirst: -14, morale: +8 });
              s.education += 1;
              pushLog(s, `Completed ${nextName}. ${s.education} credits.`, "good");
              return menu(
                "Community College",
                [
                  "Three hours in a room with eleven other people who came straight from work.",
                  spent ? "You take almost none of it in. The credit counts anyway." : "",
                  `Credit earned. ${s.education}/${MAX_CREDITS}.`,
                ].filter(Boolean),
                [BACK],
                "good",
              );
            },
          }
        : lockedChoice("Attend", reasons, `$${CLASS_COST}`),
      BACK,
    ],
  );
};

/* -------------------------------------------------------------------- bank */

const bank: Venue = (ctx) => {
  const s = ctx.state;
  // Open until six, and the hour matters more than it looks.
  //
  // At 9-to-5 the bank kept exactly the hours of the two jobs at the top of
  // the career track, so a Regional Director could never once walk into their
  // own bank. The estate wants a 720 credit score, the score is pinned at 430
  // while any debt is outstanding, and the only place to pay a debt is here —
  // so reaching the best job in the game permanently locked the ending it was
  // meant to lead to. A run finished with $244,495 in savings, $1,678 of debt
  // it could not hand over, and a hundred and fifty-two refused offers.
  if (!withinHours(s.time, 9, 18)) return say("Route 1 Savings & Loan", "Closed. Open 9AM to 6PM, every day.");

  const choices: Choice[] = [];

  if (s.cash > 0) {
    choices.push({
      label: "Deposit amount…",
      hint: `up to $${s.cash}`,
      run: () => ({
        title: "Deposit",
        lines: [`You have $${s.cash} in hand. How much do you want to put in?`],
        tone: "money" as const,
        numberInput: {
          min: 1,
          max: s.cash,
          placeholder: `1–${s.cash}`,
          onConfirm: (amount: number) => {
            s.bank += amount;
            s.cash -= amount;
            pushLog(s, `Deposited $${amount}. Savings: $${s.bank}.`, "money");
            return menu("Bank", [`$${amount} in. Savings now $${s.bank}.`], [BACK], "money");
          },
        },
      }),
    });
  }
  if (s.bank > 0) {
    choices.push({
      label: "Withdraw amount…",
      hint: `up to $${s.bank}`,
      run: () => ({
        title: "Withdraw",
        lines: [`You have $${s.bank} in savings. How much do you want to take out?`],
        tone: "money" as const,
        numberInput: {
          min: 1,
          max: s.bank,
          placeholder: `1–${s.bank}`,
          onConfirm: (amount: number) => {
            s.cash += amount;
            s.bank -= amount;
            pushLog(s, `Withdrew $${amount}. Savings: $${s.bank}.`, "money");
            return menu("Bank", [`$${amount} out. Cash in hand: $${s.cash}.`], [BACK], "money");
          },
        },
      }),
    });
  }
  if (s.debt > 0) {
    const pay = Math.min(s.cash + s.bank, s.debt);
    choices.push(
      pay > 0
        ? {
            label: "Pay down the debt",
            hint: `$${pay} of $${s.debt}`,
            run: () => {
              const fromCash = Math.min(s.cash, pay);
              s.cash -= fromCash;
              s.bank -= pay - fromCash;
              s.debt -= pay;
              s.credit = Math.min(850, s.credit + Math.round(pay / 20));
              pushLog(s, `Paid $${pay} off the debt. $${s.debt} left.`, "money");
              return menu(
                "Bank",
                s.debt === 0
                  ? ["The balance reads zero.", "You ask her to print it. She does, without comment."]
                  : [`$${pay} against the balance. $${s.debt} remaining.`],
                [BACK],
                "money",
              );
            },
          }
        : { label: "Pay down the debt", hint: `$${s.debt} owed`, locked: "You have nothing to pay it with" },
    );
  }

  if (s.bank >= 100) {
    choices.push({
      label: "Move savings into the index fund",
      hint: `$${s.bank}`,
      run: () => {
        const amount = s.bank;
        s.investments += amount;
        s.bank = 0;
        pushLog(s, `Invested $${amount}.`, "money");
        return menu(
          "Bank",
          ["She explains the risk twice and has you initial it twice.", `$${amount} invested. It will move on its own now.`],
          [BACK],
          "money",
        );
      },
    });
  }
  if (s.investments > 0) {
    choices.push({
      label: "Liquidate the fund",
      hint: `$${s.investments}`,
      run: () => {
        const amount = s.investments;
        s.bank += amount;
        s.investments = 0;
        return menu("Bank", [`$${amount} back into savings.`], [BACK], "money");
      },
    });
  }

  choices.push({
    label: "Ask about your credit",
    run: () =>
      say("Bank", [
        `Score: ${s.credit}.`,
        s.credit < 550
          ? "\"Frankly, nobody is lending to you at the moment.\""
          : s.credit < 680
            ? '"You\'re improving. Keep the balance falling and come back."'
            : '"That is a good number. Doors open on that number."',
      ]),
  });

  choices.push(BACK);
  return menu(
    "Route 1 Savings & Loan",
    [`Cash $${s.cash} · Savings $${s.bank} · Invested $${s.investments} · Debt $${s.debt} · Credit ${s.credit}`],
    choices,
  );
};

/* -------------------------------------------------------- corporate plaza */

export const BUSINESS_PRICE = 12000;
export const CAMPAIGN_PRICE = 12000;

const corporatePlaza: Venue = (ctx) => {
  const s = ctx.state;
  const look = currentAppearance(s);
  if (look < 55) {
    pushLog(s, "Turned away at the plaza doors.", "bad");
    return say(
      "Silph Regional — Reception",
      [
        "The security desk stands up before the door has finished closing.",
        `"Deliveries are round the back. This is the lobby."`,
      ],
      "bad",
    );
  }
  if (!withinHours(s.time, 8, 18)) return say("Silph Regional", "Reception is staffed 8AM to 6PM.");

  const choices: Choice[] = [];

  if (s.employment && EMPLOYMENT[s.employment].location === "corporatePlaza") {
    choices.push({
      label: "Go up to your floor",
      hint: clockInHint(s, s.employment),
      run: () => workShift(ctx, s.employment as EmploymentId),
    });
  }

  choices.push({ label: "Ask about openings", run: () => jobApplications(ctx) });

  if (s.businessOwned) {
    choices.push({
      label: "Check on the business",
      run: () =>
        say("Your holdings", [
          "The franchise runs itself now, mostly.",
          "Somebody else does the six-to-two and thinks about you the way you thought about your supervisor.",
        ]),
    });
  } else if (phaseOf(s) >= 3) {
    const reasons: string[] = [];
    if (s.cash + s.bank < BUSINESS_PRICE) reasons.push(`the buy-in is $${BUSINESS_PRICE.toLocaleString()} and you have $${(s.cash + s.bank).toLocaleString()}`);
    if (s.credit < 700) reasons.push(`they want a 700 credit score, you have ${s.credit}`);
    choices.push(
      reasons.length === 0
        ? {
            label: "Buy the Mart franchise",
            hint: `$${BUSINESS_PRICE.toLocaleString()}`,
            run: () => {
              const fromCash = Math.min(s.cash, BUSINESS_PRICE);
              s.cash -= fromCash;
              s.bank -= BUSINESS_PRICE - fromCash;
              s.businessOwned = true;
              changeReputation(s, 15);
              s.peakPhase = 4;
              pushLog(s, "Bought the Mart franchise.", "good");
              if (housingIn(s, "brokemon") === "estate") setWon(s, "estate");
              return menu(
                "Silph Regional",
                [
                  "You sign for the franchise on the same counter you once got moved away from.",
                  "It pays out daily now, whether you get up or not.",
                ],
                [BACK],
                "good",
              );
            },
          }
        : lockedChoice("Buy the Mart franchise", reasons, `$${BUSINESS_PRICE.toLocaleString()}`),
    );
  }

  if (s.businessOwned && !s.mayor) {
    const reasons: string[] = [];
    if (s.cash + s.bank < CAMPAIGN_PRICE) reasons.push(`a campaign costs $${CAMPAIGN_PRICE.toLocaleString()}`);
    if (reputationIn(s) < 40) reasons.push(`nobody knows your name yet (reputation ${reputationIn(s)}/40)`);
    choices.push(
      reasons.length === 0
        ? {
            label: "Run for mayor",
            hint: `$${CAMPAIGN_PRICE.toLocaleString()}`,
            run: () => runForMayor(ctx),
          }
        : lockedChoice("Run for mayor", reasons, `$${CAMPAIGN_PRICE.toLocaleString()}`),
    );
  }

  choices.push(BACK);
  return menu(
    "Silph Regional — Corporate Plaza",
    ["Marble, a turnstile, and a receptionist who has decided in advance how this goes."],
    choices,
  );
};

function jobApplications(ctx: ActionCtx): Prompt {
  const s = ctx.state;
  const phase = phaseOf(s);
  const choices: Choice[] = [];

  // Only what is advertised in the town you are standing in. A board in Market
  // Square listing a depot shift in Brokedale would be offering you a job that
  // costs 250 minutes and $26 a day to turn up to.
  for (const id of employmentIn(s.player.town)) {
    const def = EMPLOYMENT[id];
    if (s.employment === id) continue;
    // Hide jobs more than one tier beyond the player's current phase.
    if (def.tier > phase + 1) continue;
    const gate = checkRequirements(s, hiringRequirements(def));
    choices.push(
      gate.ok
        ? {
            label: def.name,
            hint: `$${def.pay}/shift`,
            run: () => hire(ctx, id),
          }
        : lockedChoice(def.name, gate.reasons, `$${def.pay}/shift`),
    );
  }
  choices.push(BACK);
  return menu(
    "Openings",
    ["The board lists what's available for someone at your level, and what it will take from you."],
    choices,
  );
}

/**
 * Whether they take you.
 *
 * A job that names an appearance requirement is judging you on it, so the
 * margin above that bar is what moves the odds. A job that names none is not
 * judging you on it at all, and rolling against your looks anyway was a
 * contradiction sitting in plain sight: the depot ladder exists so that a
 * player who cannot hold appearance 70 has somewhere to go, and a hidden
 * appearance roll on the way in quietly rebuilt the wall it was meant to route
 * around. It also made a nonsense of the overnight stocker, whose entire pitch
 * is that nobody sees you.
 *
 * Those jobs hire on your name and the fact that you turned up.
 */
export function hireOdds(s: GameState, def: EmploymentDef): number {
  const name = reputationIn(s) / 200;
  if (def.requires.appearance === undefined) return Math.min(0.95, 0.7 + name);
  return Math.min(0.95, 0.25 + (currentAppearance(s) - def.requires.appearance) / 60 + name);
}

function hire(ctx: ActionCtx, id: EmploymentId): Prompt {
  const s = ctx.state;
  const def = EMPLOYMENT[id];
  ctx.advance(45, { sheltered: true });

  if (!ctx.rng.chance(hireOdds(s, def))) {
    s.meters.morale = Math.max(0, s.meters.morale - 10);
    pushLog(s, `Interview for ${def.name} — no offer.`, "bad");
    return menu(
      "Interview",
      [
        "Forty-five minutes. They are polite the entire time.",
        `"We'll be in touch." They will not be in touch.`,
      ],
      [BACK],
      "bad",
    );
  }

  const previous = s.employment;
  s.employment = id;
  s.strikes = 0;
  grantOrTakeBadge(s, id);
  changeReputation(s, 3);
  s.meters.morale = Math.min(100, s.meters.morale + 25);
  if (def.tier >= 3) s.peakPhase = Math.max(s.peakPhase, 3) as 3 | 4;
  pushLog(s, `Hired: ${def.name} at ${def.employer}.`, "good");

  const lines = [
    def.desc,
    `Shift: ${fmtHour(def.shiftStart)}–${fmtHour(def.shiftEnd)} at ${def.employer}. $${def.pay} a shift.`,
  ];
  if (previous) lines.push(`You hand in your notice at ${EMPLOYMENT[previous].employer}.`);
  if (worksBehindTheGate(id)) {
    lines.push("They photograph you against a white wall and hand you a pass on a blue lanyard.");
    lines.push("It gets you through the barrier on the hill. You are staff now, and staff go up.");
  }
  return menu("You're hired", lines, [BACK], "good");
}

function runForMayor(ctx: ActionCtx): Prompt {
  const s = ctx.state;
  const fromCash = Math.min(s.cash, CAMPAIGN_PRICE);
  s.cash -= fromCash;
  s.bank -= CAMPAIGN_PRICE - fromCash;
  ctx.advance(600, { sheltered: true });

  const odds = Math.min(0.95, 0.3 + reputationIn(s) / 120);
  if (!ctx.rng.chance(odds)) {
    changeReputation(s, 5);
    pushLog(s, "Lost the mayoral election.", "bad");
    return menu(
      "Election night",
      ["You lose by four hundred votes.", "The money is gone. The name recognition is not."],
      [BACK],
      "bad",
    );
  }

  s.mayor = true;
  s.peakPhase = 4;
  changeReputation(s, 20);
  pushLog(s, "Elected mayor of Brokemon Town.", "good");
  if (housingIn(s, "brokemon") === "estate") setWon(s, "estate");
  return menu(
    "Election night",
    [
      "You win it on the outskirts. The Heights broke against you three to one and it did not matter.",
      "Your first act repeals the overnight camping ordinance. It takes eleven minutes.",
    ],
    [BACK],
    "good",
  );
}

/* ---------------------------------------------------------------- job board */

const jobBoard: Venue = (ctx) => {
  const s = ctx.state;
  const a = s.assignment;
  const choices: Choice[] = [];

  // The parks office crew muster here. Without this the job is a dead end:
  // you get hired, there is nowhere to clock in, and because firing only
  // happens inside a worked shift you are never even let go — just employed
  // forever at nothing a day.
  if (s.employment && EMPLOYMENT[s.employment].location === "jobBoard") {
    choices.push({
      label: "Clock in",
      hint: clockInHint(s, s.employment),
      run: () => workShift(ctx, s.employment as EmploymentId),
    });
  }

  if (a?.ready) {
    choices.push({ label: `Collect payment — ${a.label}`, hint: `$${a.pay}`, run: () => collectAssignment(ctx) });
  } else if (a) {
    choices.push({ label: `In progress: ${a.label}`, locked: `${a.targets.length} stop(s) left` });
  } else {
    const flyers = canDoGig(s, "flyers");
    choices.push(
      flyers.ok
        ? {
            label: GIGS.flyers.name,
            hint: `4 stops, $${GIGS.flyers.basePay}`,
            run: () => startAssignment(ctx, "flyers", flyerRoute(ctx), "Deliver flyers to four addresses"),
          }
        : lockedChoice(GIGS.flyers.name, flyers.reasons, `$${GIGS.flyers.basePay}`),
    );

    const yard = canDoGig(s, "yardWork");
    choices.push(
      yard.ok
        ? {
            label: GIGS.yardWork.name,
            hint: `1 stop, $${GIGS.yardWork.basePay}`,
            run: () => {
              const spot = ctx.rng.pick(yardSpotsFor(s));
              const p = markerPos(townOf(s), spot.marker);
              return startAssignment(ctx, "yardWork", [{ x: p.x + spot.dx, y: p.y + spot.dy }], `Yard work — ${spot.name}`);
            },
          }
        : lockedChoice(GIGS.yardWork.name, yard.reasons, `$${GIGS.yardWork.basePay}`),
    );
  }

  choices.push({ label: "Read the career listings", run: () => jobApplications(ctx) });
  choices.push(BACK);

  return menu(
    "Job Board",
    [
      "A corkboard under perspex outside the parks office.",
      "Index cards, phone numbers torn into fringes, and one laminated sheet for the council jobs.",
    ],
    choices,
  );
};

interface YardSpot {
  marker: string;
  dx: number;
  dy: number;
  name: string;
  /** Up past the security gate, so only worth offering to someone who'll be let through. */
  heights?: boolean;
}

const YARD_SPOTS: YardSpot[] = [
  { marker: "estate", dx: 0, dy: 1, name: "the estate on the hill", heights: true },
  { marker: "hostel", dx: 0, dy: 1, name: "behind the hostel" },
  { marker: "trailer", dx: 0, dy: 1, name: "the trailer park" },
  { marker: "college", dx: 0, dy: 1, name: "the college grounds" },
  { marker: "apartment", dx: 0, dy: 1, name: "the apartment block" },
];

/**
 * The board will not send you somewhere the gate won't let you reach. Yard
 * work only asks for a strong back, so without this filter a phase-1 player
 * could take the estate job, be turned away at the barrier, and lose the day's
 * only yard slot to a job they could never finish.
 */
function yardSpotsFor(s: GameState): YardSpot[] {
  const canGetUp = currentAppearance(s) >= HEIGHTS_GATE_LOOK || countOf(s.inventory, "staffBadge") > 0;
  const usable = YARD_SPOTS.filter((spot) => !spot.heights || canGetUp);
  return usable.length > 0 ? usable : YARD_SPOTS.filter((spot) => !spot.heights);
}

function flyerRoute(ctx: ActionCtx): { x: number; y: number }[] {
  const doors = ["communityCenter", "mart", "college", "bank", "laundromat", "apartment", "hostel"];
  return ctx.rng
    .shuffled(doors)
    .slice(0, 4)
    .map((id) => {
      const p = markerPos(townOf(ctx.state), id);
      return { x: p.x, y: p.y + 1 };
    });
}

/* ---------------------------------------------------------------- bus stop */

const busStop: Venue = (ctx) => {
  const s = ctx.state;
  const hasPass = countOf(s.inventory, "busPass") > 0;
  const fare = 3;

  const choices: Choice[] = [
    {
      label: "Market Square",
      hint: "you're here",
      locked: "You are already at this stop",
    },
    makeRide(ctx, "The Outskirts", markerPos(townOf(s), "outskirtsBusStop"), hasPass, fare),
    makeRide(ctx, "The Heights gate", { x: 23, y: 15 }, hasPass, fare),
    coachChoice(ctx),
    {
      label: "Wait",
      run: () => {
        ctx.advance(15);
        return say("Bus Stop", "You find a bench and kill some time. The next bus will come when it comes.");
      },
    },
  ];

  return menu(
    "Bus Stop — Market Square",
    [
      hasPass
        ? "You have a weekly pass. Show it and get on."
        : `$${fare} a ride, exact change, or $${ITEMS.busPass.price} for a weekly pass at the Mart.`,
      ...coachTimetableLines(s),
    ],
    choices,
  );
};

/* ------------------------------------------------------------ the coach */

/**
 * The intercity coach, offered wherever a service starts. The weekly bus pass
 * is for the town buses and says so on it — the coach is a separate operator
 * and wants cash every time.
 */
function coachChoice(ctx: ActionCtx): Choice {
  const s = ctx.state;
  const service = serviceFrom(s.player.town);
  if (!service) return { label: "Intercity coach", locked: "No coach runs from here" };

  const reasons = boardingReasons(s, service);
  const wait = waitFor(service, s.time);
  const hint = wait === null ? "last one gone" : wait <= 0 ? `$${service.fare}, now` : `$${service.fare}, ${Math.round(wait)} min wait`;

  if (reasons.length > 0) return lockedChoice(`${service.destination} — intercity coach`, reasons, hint);

  return {
    label: `${service.destination} — intercity coach`,
    hint,
    run: () => {
      const ride = rideCoach(ctx, service);
      return menu(service.destination, ride.lines, [{ label: "Get off" }]);
    },
  };
}

/** The two lines of timetable printed on the shelter. */
function coachTimetableLines(s: GameState): string[] {
  const service = serviceFrom(s.player.town);
  if (!service) return [];
  const next = nextDeparture(service, s.time);
  return [
    `Intercity coach to ${service.destination}: $${service.fare}, ${service.minutes} minutes. ` +
      `Last one ${fmtDeparture(lastDeparture(service))}.`,
    next === null
      ? `Nothing else tonight. First one back is ${fmtDeparture(firstDeparture(service))}.`
      : `Next departure ${fmtDeparture(next)}.`,
  ];
}

/* ------------------------------------------------------- Brokedale: coach */

const coachTerminal: Venue = (ctx) => {
  const s = ctx.state;
  const choices: Choice[] = [coachChoice(ctx)];

  // The concourse is the only thing in Brokedale that costs nothing, and it is
  // not generosity — the station is open all night because the coaches are.
  // Without it, arriving with the return fare spent would be a dead end rather
  // than a bad night.
  choices.push({
    label: "Sit up in the concourse until morning",
    hint: "free, poor rest",
    run: () => {
      const result = sleep(ctx, "bench", 7);
      return {
        ...result,
        title: "Terminal concourse",
        lines: [
          "Moulded plastic seats with armrests every two feet, strip lights that never go off,",
          "and the departure board resetting itself every few minutes.",
          ...result.lines,
        ],
      };
    },
  });

  choices.push(BACK);
  return menu(
    "Brokedale Coach Station",
    [
      "A concourse the size of the Brokemon Mart, open to the road at both ends.",
      ...coachTimetableLines(s),
    ],
    choices,
  );
};

/* ------------------------------------------------ Brokedale: night market */

const nightMarket: Venue = (ctx) => {
  const s = ctx.state;
  const noodles = 6;
  const water = 3;
  const brew = 4;

  const choices: Choice[] = [
    s.cash >= noodles
      ? {
          label: "Noodles from the stall",
          hint: `$${noodles}, 15 min`,
          run: () => {
            s.cash -= noodles;
            ctx.advance(15, { sheltered: true });
            applyDelta(s.meters, { hunger: +38, thirst: -6, morale: +7, health: +1 });
            pushLog(s, `Ate at the night market — $${noodles}.`, "money");
            return menu(
              "Night Market",
              ["Served in a paper tray, eaten standing up, too hot to taste for the first minute."],
              [BACK],
              "good",
            );
          },
        }
      : { label: "Noodles from the stall", hint: `$${noodles}`, locked: "You can't afford it" },
    s.cash >= water
      ? {
          label: "Bottle of water",
          hint: `$${water}`,
          run: () => {
            s.cash -= water;
            addItem(s.inventory, "waterBottle");
            return menu("Night Market", ["Three dollars. It is a dollar at home and you pay it anyway."], [BACK]);
          },
        }
      : { label: "Bottle of water", hint: `$${water}`, locked: "You can't afford it" },
    s.cash >= brew
      ? {
          label: "Coffee, black",
          hint: `$${brew}, 5 min`,
          run: () => {
            s.cash -= brew;
            ctx.advance(5, { sheltered: true });
            const cup = caffeineCup(s);
            applyDelta(s.meters, cup.delta);
            s.caffeine += 1;
            return menu("Night Market", [cup.flavor], [BACK]);
          },
        }
      : { label: "Coffee, black", hint: `$${brew}`, locked: "You can't afford it" },
    pitchChoice(ctx),
    ...(countOf(s.inventory, "phone") === 0
      ? [
          s.cash >= 55
            ? {
                label: "Second-hand phone",
                hint: "$55",
                run: (): Prompt => {
                  s.cash -= 55;
                  addItem(s.inventory, "phone");
                  return menu(
                    "Night Market",
                    [
                      `"Unlocked, works fine, charger included."`,
                      "Forty-five at home. You pay fifty-five because it is two in the morning and this is the only one.",
                    ],
                    [BACK],
                  );
                },
              }
            : ({ label: "Second-hand phone", hint: "$55", locked: "You can't afford it" } as Choice),
        ]
      : []),
    BACK,
  ];

  return menu(
    "Night Market — St Giles Row",
    [
      "Six stalls under one awning, running off a generator. It never shuts and it never gets cheaper.",
      `You have $${s.cash}.`,
    ],
    choices,
  );
};

/* ----------------------------------------------------- Brokedale: agency */

/** You have to be at the door in the morning. That is the whole cost of it. */
const AGENCY_OPEN = 6;
const AGENCY_CLOSE = 11;

const agency: Venue = (ctx) => {
  const s = ctx.state;
  const def = GIGS.siteWork;

  if (!withinHours(s.time, AGENCY_OPEN, AGENCY_CLOSE)) {
    return say("Ardwell Labour", [
      `The muster is ${fmtHour(AGENCY_OPEN)} to ${fmtHour(AGENCY_CLOSE)}. The vans have gone.`,
      "Whatever was going today went to whoever was standing here at seven.",
    ]);
  }

  const gate = canDoGig(s, "siteWork");
  return menu(
    "Ardwell Labour — same day, cash",
    [
      "A counter, a whiteboard of sites, and thirty people who got here before you.",
      `Six hours, about $${def.basePay}, and nobody writes your name down.`,
    ],
    [
      gate.ok
        ? { label: "Put your name down", hint: `6h, ~$${def.basePay}`, run: () => doSiteWork(ctx) }
        : lockedChoice("Put your name down", gate.reasons, `6h, ~$${def.basePay}`),
      BACK,
    ],
  );
};

function doSiteWork(ctx: ActionCtx): Prompt {
  const s = ctx.state;
  const def = GIGS.siteWork;
  ctx.advance(def.minutes, { exertion: def.exertion });
  applyDelta(s.meters, def.cost);
  const pay = def.basePay + ctx.rng.int(-14, 18);
  earnCash(s, pay);
  s.gigsToday.siteWork = (s.gigsToday.siteWork ?? 0) + 1;
  // A day's graft in a town that does not know you is how it starts knowing you.
  changeReputation(s, 1);
  pushLog(s, `Site work through the agency — $${pay}.`, "money");
  return menu(
    "The site",
    [
      "Lifting, carrying, and standing in the way of a man who is shouting.",
      `Cash in hand at the gate: $${pay}.`,
    ],
    [BACK],
    "money",
  );
}

/* ------------------------------------------------ Brokedale: weekly rooms */

const weeklyRooms: Venue = (ctx) => {
  const s = ctx.state;
  const def = HOUSING.room;

  if (housingIn(s) === "room") {
    return menu(
      s.blockOwned ? "Your building" : "Your room",
      s.blockOwned
        ? [def.desc, "The rent from the other eleven doors comes to you now."]
        : [def.desc, `Rent of $${def.rent} is due on day ${s.rentDueDay[s.player.town]}.`],
      [
        { label: "Sleep until morning", run: () => sleep(ctx, "room", 7) },
        {
          label: "Wash at the sink",
          hint: "15 min",
          run: () => {
            ctx.advance(15, { sheltered: true });
            restoreBody(s, 25);
            applyDelta(s.meters, { morale: +2 });
            return menu("Your room", ["Cold tap, one flannel. It is not a wash and you know it."], [BACK]);
          },
        },
        blockChoice(ctx),
        BACK,
      ],
    );
  }

  // Two weeks up front is the whole barrier. It is deliberately more than a
  // stranded player can scrape and less than a fortnight of site work.
  const deposit = def.rent * 2;
  return menu(
    "St Giles Row — ROOM TO LET",
    [
      "Fourth floor, no lift. Shared bathroom, shared kitchen, your own lock.",
      `$${def.rent} a week. Two weeks up front and they do not run your credit.`,
      "Miss a week and the lock changes. There is no notice period in this building.",
    ],
    [
      s.cash + s.bank >= deposit
        ? {
            label: "Take it",
            hint: `$${deposit}`,
            run: () => {
              const fromCash = Math.min(s.cash, deposit);
              s.cash -= fromCash;
              s.bank -= deposit - fromCash;
              setHousing(s, "room");
              // Remembered for good. The block is only for sale to somebody
              // who has paid rent through that door.
              s.flags.livedOnStGiles = 1;
              s.rentDueDay[s.player.town] = Math.floor(s.time / 1440) + 1 + def.rentEvery;
              s.meters.morale = Math.min(100, s.meters.morale + 20);
              changeReputation(s, 4);
              pushLog(s, "Took a room on St Giles Row.", "good");
              return menu(
                "Your room",
                [
                  "He counts the notes twice, writes nothing down, and gives you a key on a bit of wire.",
                  "The window looks at another window. You are eleven minutes from everything in this city.",
                ],
                [BACK],
                "good",
              );
            },
          }
        : lockedChoice("Take it", [`they want $${deposit} up front and you have $${s.cash + s.bank}`], `$${deposit}`),
      BACK,
    ],
  );
};

/* ------------------------------------------------- Brokedale: the block */

export const BLOCK_PRICE = 28000;
/** What the landlord wants to know about you, which is not your credit score. */
export const BLOCK_REPUTATION = 40;

/**
 * The other apex.
 *
 * The estate is getting out — a view of the town that moved you on. This is
 * staying, and owning the door you first paid rent through. Aldiss is
 * seventy-one and has nobody, and he will not sell to a company, and he does
 * not run anyone's credit; he sells to somebody he knows, which is why the
 * gate here is reputation and cash rather than a score.
 *
 * It costs less than the estate because Brokedale's ladder pays less. What it
 * costs instead is that you become the person collecting.
 */
function blockChoice(ctx: ActionCtx): Choice {
  const s = ctx.state;
  if (s.blockOwned) {
    return {
      label: "Look at the rent book",
      run: () =>
        say("Your building", [
          "Eleven doors, nine of them paying, and two you have not had the conversation about yet.",
          "The man who used to knock for Aldiss knocks for you. He is perfectly pleasant about it.",
        ]),
    };
  }

  const funds = s.cash + s.bank + s.investments;
  const reasons: string[] = [];
  if (!s.flags.livedOnStGiles) reasons.push("he does not sell to people who have not lived in it");
  if (funds < BLOCK_PRICE) {
    reasons.push(`he wants $${BLOCK_PRICE.toLocaleString()} and you have $${funds.toLocaleString()}`);
  }
  if (reputationIn(s, "brokedale") < BLOCK_REPUTATION) {
    reasons.push(`he sells to people he knows (your name is worth ${reputationIn(s, "brokedale")} here, he wants ${BLOCK_REPUTATION})`);
  }

  if (reasons.length > 0) return lockedChoice("Ask Aldiss what he wants for the building", reasons, `$${BLOCK_PRICE.toLocaleString()}`);

  return {
    label: "Ask Aldiss what he wants for the building",
    hint: `$${BLOCK_PRICE.toLocaleString()}`,
    run: () => {
      let owed = BLOCK_PRICE;
      const fromCash = Math.min(s.cash, owed);
      s.cash -= fromCash;
      owed -= fromCash;
      const fromBank = Math.min(s.bank, owed);
      s.bank -= fromBank;
      owed -= fromBank;
      s.investments -= owed;

      s.blockOwned = true;
      s.peakPhase = 4;
      s.meters.morale = 100;
      changeReputation(s, 10, "brokedale");
      pushLog(s, "You bought the building on St Giles Row.", "good");
      setWon(s, "block");
      return menu(
        "St Giles Row",
        [
          "He does it at the table in the corner shop with a solicitor who is his nephew.",
          "You get twelve keys on a ring, a folder of certificates, and a list of who is behind and by how much.",
          "",
          "Your own name is on the list. Somebody has written PAID beside it in a different pen.",
        ],
        [BACK],
        "good",
      );
    },
  };
}

/* -------------------------------------------------- Brokedale: washhouse */

export const WASHHOUSE_PRICE = 5;

const washhouse: Venue = (ctx) => {
  const s = ctx.state;
  return menu(
    "Eastgate Washhouse — 24 HOURS",
    [
      "Six cubicles, a token machine, and a man asleep on the bench by the radiator.",
      `$${WASHHOUSE_PRICE} a token. It is the cheapest way to be clean in this city.`,
    ],
    [
      s.cash >= WASHHOUSE_PRICE
        ? {
            label: "Buy a token and get clean",
            hint: `$${WASHHOUSE_PRICE}, 30 min`,
            run: () => {
              s.cash -= WASHHOUSE_PRICE;
              ctx.advance(30, { sheltered: true });
              restoreBody(s, 75);
              applyDelta(s.meters, { morale: +9 });
              pushLog(s, `Washed at the Eastgate — $${WASHHOUSE_PRICE}.`, "good");
              return menu(
                "Eastgate Washhouse",
                ["Hot water for as long as the token lasts, which is eleven minutes.", "You come out looking like a person."],
                [BACK],
                "good",
              );
            },
          }
        : { label: "Buy a token and get clean", hint: `$${WASHHOUSE_PRICE}`, locked: `You're $${WASHHOUSE_PRICE - s.cash} short` },
      BACK,
    ],
  );
};

/* -------------------------------------------------- Brokedale: pawn shop */

/** What you get back for something you paid full price for. */
const PAWN_RATE = 0.4;

function pawnValue(id: ItemId): number {
  return Math.max(1, Math.floor((ITEMS[id].price ?? 0) * PAWN_RATE));
}

const pawnShop: Venue = (ctx) => {
  const s = ctx.state;
  if (!withinHours(s.time, 9, 19)) return say("Vance & Son", "Grille down. Open 9AM to 7PM.");

  const sellable = (Object.keys(s.inventory) as ItemId[])
    .filter((id) => countOf(s.inventory, id) > 0 && (ITEMS[id].price ?? 0) > 0 && !ITEMS[id].consumable)
    .sort((a, b) => pawnValue(b) - pawnValue(a));

  const choices: Choice[] = sellable.map((id) => ({
    label: `Sell ${ITEMS[id].name}`,
    hint: `$${pawnValue(id)}`,
    run: () => {
      const paid = pawnValue(id);
      removeItem(s.inventory, id, 1);
      earnCash(s, paid);
      ctx.advance(10, { sheltered: true });
      pushLog(s, `Pawned ${ITEMS[id].name} for $${paid}.`, "money");
      return menu(
        "Vance & Son",
        [`He turns it over once, names a number, and does not move when you hesitate.`, `$${paid}.`],
        [BACK],
        "money",
      );
    },
  }));

  if (choices.length === 0) {
    return say("Vance & Son", ["Guitars, drills, three wedding rings and a saxophone.", "You have nothing he wants."]);
  }

  choices.push(BACK);
  return menu(
    "Vance & Son — Pawnbrokers",
    ["Guitars on the wall, drills in the case, and a man who has heard every story once already.", "He pays about four in ten."],
    choices,
  );
};

/* ------------------------------------------------- Brokedale: job centre */

const jobCentre: Venue = (ctx) => {
  const s = ctx.state;
  if (!withinHours(s.time, 9, 17)) return say("Brokedale Employment Exchange", "Closed. Open 9AM to 5PM.");

  return menu(
    "Brokedale Employment Exchange",
    [
      "Numbered tickets, a screen of vacancies, and eleven plastic chairs bolted to a rail.",
      "Nobody here has looked at your shoes.",
    ],
    [
      { label: "Take a ticket and see what's going", run: () => jobApplications(ctx) },
      {
        label: "Ask what it takes to get on",
        run: () =>
          say("Employment Exchange", [
            "\"Depot start you on the floor. Twelve shifts and they'll look at you for dispatch.\"",
            "\"Dispatch wants two night-class credits. We don't run them here — that's a Brokemon thing.\"",
            "\"After that it's the yard, if you want it. Nobody's going to ask you for a suit.\"",
          ]),
      },
      BACK,
    ],
  );
};

/* ----------------------------------------------------- Brokedale: the depot */

const depot: Venue = (ctx) => {
  const s = ctx.state;
  const job = s.employment && EMPLOYMENT[s.employment].location === "depot" ? s.employment : null;

  if (!job) {
    return say("Eastgate Depot", [
      "Roller shutters, a weighbridge, and a gatehouse with a hatch in it.",
      "\"Staff only. If you're after work it's the Exchange on the High Street.\"",
    ]);
  }

  return menu(
    "Eastgate Depot",
    [`${EMPLOYMENT[job].name}. Shift ${fmtHour(EMPLOYMENT[job].shiftStart)}–${fmtHour(EMPLOYMENT[job].shiftEnd)}.`],
    [
      {
        label: "Clock in",
        hint: clockInHint(s, job),
        run: () => workShift(ctx, job),
      },
      BACK,
    ],
  );
};

/* -------------------------------------------------------- Brokedale: gym */

export const GYM_PRICE = 12;

const gym: Venue = (ctx) => {
  const s = ctx.state;
  if (!withinHours(s.time, 6, 22)) return say("The Wharf Club", "Closed. Members 6AM to 10PM.");

  return menu(
    "The Wharf Club",
    [
      "Glass, river light, and towels folded by somebody whose job that is.",
      `$${GYM_PRICE} on the door. Nobody here has ever asked what you do.`,
    ],
    [
      s.cash >= GYM_PRICE
        ? {
            label: "Pay the day rate",
            hint: `$${GYM_PRICE}, 90 min`,
            run: () => {
              s.cash -= GYM_PRICE;
              ctx.advance(90, { sheltered: true, exertion: 2 });
              restoreBody(s, 80);
              applyDelta(s.meters, { health: +9, morale: +14, energy: -14 });
              pushLog(s, `A session and a shower at the Wharf Club — $${GYM_PRICE}.`, "good");
              return menu(
                "The Wharf Club",
                [
                  "An hour on the machines and as long as you like in the showers afterwards.",
                  "You are tired in the way people choose to be tired.",
                ],
                [BACK],
                "good",
              );
            },
          }
        : { label: "Pay the day rate", hint: `$${GYM_PRICE}`, locked: `You're $${GYM_PRICE - s.cash} short` },
      BACK,
    ],
  );
};

/* ------------------------------------------------- Brokedale: the pitch */

export const PITCH_PRICE = 1400;
/** The committee sells to a name it knows, same as everything else here. */
export const PITCH_REPUTATION = 25;

/**
 * A pitch at the night market, and the person already standing on it.
 *
 * This exists because the measurement said it had to: the block was landing
 * around day 280 against the estate's 165, and the reason was not the price.
 * Brokemon compounds three ways — the franchise, the mayor's salary, the index
 * fund — and Brokedale compounded not at all, so every dollar toward the
 * building was earned by turning up to a shift. This is the city's answer, and
 * it is the right shape for the city: not a business you run, a thing you own
 * that somebody else stands behind.
 *
 * It is also the ending in miniature, on purpose. The first money you make
 * without working for it comes out of Nadia's night, and the game does not
 * pretend otherwise.
 */
function pitchChoice(ctx: ActionCtx): Choice {
  const s = ctx.state;
  if (s.stallOwned) {
    return {
      label: "Look in on the pitch",
      run: () =>
        say("Your pitch", [
          "Nadia has it laid out better than you would have. She has traded here six years.",
          "She counts your share off before her own without being asked, and asks after your room.",
        ]),
    };
  }

  const reasons: string[] = [];
  if (housingIn(s, "brokedale") === "street") reasons.push("the committee lets pitches to residents, and you have no address here");
  if (s.cash + s.bank < PITCH_PRICE) reasons.push(`the pitch is $${PITCH_PRICE.toLocaleString()} and you have $${(s.cash + s.bank).toLocaleString()}`);
  if (reputationIn(s, "brokedale") < PITCH_REPUTATION) {
    reasons.push(`the committee lets to names it knows (yours is worth ${reputationIn(s, "brokedale")}, they want ${PITCH_REPUTATION})`);
  }

  if (reasons.length > 0) return lockedChoice("Take on a pitch", reasons, `$${PITCH_PRICE.toLocaleString()}`);

  return {
    label: "Take on a pitch",
    hint: `$${PITCH_PRICE.toLocaleString()}`,
    run: () => {
      const fromCash = Math.min(s.cash, PITCH_PRICE);
      s.cash -= fromCash;
      s.bank -= PITCH_PRICE - fromCash;
      s.stallOwned = true;
      changeReputation(s, 5, "brokedale");
      pushLog(s, `Took on a pitch at the night market — $${PITCH_PRICE}.`, "money");
      return menu(
        "Night Market",
        [
          "The committee takes the money and gives you a laminated number.",
          "Nadia has traded on that number for six years and has never once been able to buy it.",
          "She shakes your hand and says it is good it went to somebody off the Row.",
          "",
          "You will take a cut of every night from now on, and you will not be standing here for any of them.",
        ],
        [BACK],
        "money",
      );
    },
  };
}

/* --------------------------------------------------- Brokedale: doss house */

export const DOSS_HOUSE_RATE = 14;

const dossHouse: Venue = (ctx) => {
  const s = ctx.state;
  const choices: Choice[] = [
    s.cash >= DOSS_HOUSE_RATE
      ? {
          label: "Pay for a room",
          hint: `$${DOSS_HOUSE_RATE}/night`,
          run: () => {
            s.cash -= DOSS_HOUSE_RATE;
            setHousing(s, "hostel");
            s.nightsPaid[s.player.town] = 1;
            pushLog(s, `Paid $${DOSS_HOUSE_RATE} for a room at the doss house.`, "money");
            return sleep(ctx, "hostel", 7);
          },
        }
      : {
          label: "Pay for a room",
          hint: `$${DOSS_HOUSE_RATE}/night`,
          locked: `You're $${DOSS_HOUSE_RATE - s.cash} short`,
        },
    s.cash >= 4
      ? {
          label: "Use the shower",
          hint: "$4, 20 min",
          run: () => {
            s.cash -= 4;
            ctx.advance(20, { sheltered: true });
            restoreBody(s, 60);
            applyDelta(s.meters, { morale: +6 });
            return menu("St Giles Rooms", ["Four dollars, and the door does not lock."], [BACK], "good");
          },
        }
      : { label: "Use the shower", hint: "$4", locked: "You can't afford it" },
    BACK,
  ];

  return menu(
    "St Giles Rooms",
    [
      "A hatch with a grille in it and a stairwell that smells of bleach over something else.",
      `$${DOSS_HOUSE_RATE} a night, paid in advance, no questions and no receipt.`,
    ],
    choices,
  );
};

/* ------------------------------------------------------------------ diner */

const diner: Venue = (ctx) => {
  const s = ctx.state;
  if (!withinHours(s.time, 6, 22)) return say("Route 1 Diner", "Closed. Open 6AM to 10PM.");

  if (s.meters.hygiene < 30) {
    applyDelta(s.meters, { morale: -5 });
    pushLog(s, "Turned away from the diner.", "bad");
    return say(
      "Route 1 Diner",
      [
        "She comes out from behind the counter before you reach a stool.",
        '"I\'m sorry, love. You\'ll have to clean up first."',
        s.bodyClean < s.clothesClean
          ? "You can smell yourself. She definitely can."
          : "The state of your clothes. She's got other customers.",
      ],
      "bad",
    );
  }

  const hotMeal = ITEMS.hotMeal;
  const coffee = ITEMS.coffee;
  const choices: Choice[] = [];

  choices.push(
    s.cash >= hotMeal.price!
      ? {
          label: hotMeal.name,
          hint: `$${hotMeal.price}`,
          run: () => {
            s.cash -= hotMeal.price!;
            ctx.advance(hotMeal.minutes!, { sheltered: true });
            applyDelta(s.meters, hotMeal.effect!);
            pushLog(s, `Hot meal at the diner — $${hotMeal.price}.`, "good");
            return menu(
              "Route 1 Diner",
              ["A plate of food. Actual food, hot, on a table.", hotMeal.flavor!],
              [BACK],
              "good",
            );
          },
        }
      : { label: hotMeal.name, hint: `$${hotMeal.price}`, locked: "You can't afford it" },
  );

  choices.push(
    s.cash >= coffee.price!
      ? {
          label: coffee.name,
          hint: `$${coffee.price}`,
          run: () => {
            s.cash -= coffee.price!;
            ctx.advance(coffee.minutes!, { sheltered: true });
            applyDelta(s.meters, coffee.effect!);
            pushLog(s, `Coffee at the diner — $${coffee.price}.`, "money");
            return menu(
              "Route 1 Diner",
              ["A mug arrives without ceremony.", coffee.flavor!],
              [BACK],
            );
          },
        }
      : { label: coffee.name, hint: `$${coffee.price}`, locked: "You can't afford it" },
  );

  choices.push({
    label: "Ask for tap water",
    hint: "free, 5 min",
    run: () => {
      ctx.advance(5, { sheltered: true });
      applyDelta(s.meters, { thirst: +18, morale: +2 });
      return menu(
        "Route 1 Diner",
        ["She puts it on the table without being asked. The glass is clean."],
        [BACK],
        "good",
      );
    },
  });

  choices.push(BACK);
  return menu(
    "Route 1 Diner",
    ["Twelve stools, a counter, and a laminated menu that hasn't changed in thirty years."],
    choices,
  );
};

/* --------------------------------------------------- outskirts bus stop */

const outskirtsBusStop: Venue = (ctx) => {
  const s = ctx.state;
  const hasPass = countOf(s.inventory, "busPass") > 0;
  const fare = 3;

  const choices: Choice[] = [
    {
      label: "The Outskirts",
      hint: "you're here",
      locked: "You are already at this stop",
    },
    makeRide(ctx, "Market Square", markerPos(townOf(s), "busStop"), hasPass, fare),
    {
      label: "Wait",
      run: () => {
        ctx.advance(15);
        return say("Bus Stop", "You find a place to sit and wait. The bus runs on its own schedule.");
      },
    },
  ];

  return menu(
    "Bus Stop — The Outskirts",
    hasPass
      ? ["You have a weekly pass. Show it and get on."]
      : [`$${fare} a ride, exact change. Pick up a weekly pass at the Mart for $${ITEMS.busPass.price}.`],
    choices,
  );
};

function makeRide(ctx: ActionCtx, name: string, dest: { x: number; y: number }, hasPass: boolean, fare: number): Choice {
  const s = ctx.state;
  if (!hasPass && s.cash < fare) return { label: name, hint: `$${fare}`, locked: "You don't have the fare" };
  return {
    label: name,
    hint: hasPass ? "pass" : `$${fare}`,
    run: () => {
      if (!hasPass) s.cash -= fare;
      ctx.advance(12, { sheltered: true });
      ctx.teleport(dest.x, dest.y);
      return menu("Bus", [`Twelve minutes and you're at ${name}.`], [BACK]);
    },
  };
}

/* ---------------------------------------------------------------- bikeShop */

interface FleetEntry { id: ItemId; label: string; tradeIn: number; buyLog: string; swapLog: string }

const FLEET: FleetEntry[] = [
  {
    id: "rollerSkates",
    label: "Roller skates",
    tradeIn: 8,
    buyLog:  "Four wheels on your feet. It works.",
    swapLog: "You lace up the skates and roll out.",
  },
  {
    id: "kickScooter",
    label: "Kick scooter",
    tradeIn: 14,
    buyLog:  "You kick off and the scooter finds its rhythm. Honest transport.",
    swapLog: "The scooter folds under your arm in seconds.",
  },
  {
    id: "foldingBike",
    label: "Folding bike",
    tradeIn: 16,
    buyLog:  "The folder goes under any bed. Beats walking.",
    swapLog: "You click the folder shut and tuck it under your arm.",
  },
  {
    id: "bmxBike",
    label: "BMX",
    tradeIn: 25,
    buyLog:  "Low, fast, built for the street. More bike than it looks.",
    swapLog: "You drop onto the BMX and feel the difference immediately.",
  },
  {
    id: "bicycle",
    label: "Mountain bike",
    tradeIn: 35,
    buyLog:  "You wheel the mountain bike out. Every walk just got shorter.",
    swapLog: "You swap into the mountain bike. Every walk just got shorter again.",
  },
  {
    id: "roadBike",
    label: "Road bike",
    tradeIn: 72,
    buyLog:  "The road bike slides into traffic like it was born there.",
    swapLog: "The road bike is lighter than you expected. Everything else feels slow now.",
  },
];

const bikeShop: Venue = (ctx) => {
  const s = ctx.state;
  const owned = FLEET.find(v => (s.inventory[v.id] ?? 0) > 0) ?? null;

  // ── helmet helper ──────────────────────────────────────────────
  const addHelmetChoices = (choices: Choice[]) => {
    const hasSk = hasItem(s, "skateHelmet");
    const hasCy = hasItem(s, "cyclingHelmet");
    const mkHelmet = (id: ItemId, label: string, hint: string): Choice => {
      const price = ITEMS[id]!.price!;
      return s.cash >= price
        ? {
            label: `${label} — $${price}`,
            hint,
            run: () => {
              s.cash -= price;
              addItem(s.inventory, id);
              pushLog(s, `${label} on. Cheaper than the emergency room.`, "good");
              return null;
            },
          }
        : { label: `${label} — $${price}`, hint, locked: `Need $${price - s.cash} more` };
    };
    if (!hasSk) choices.push(mkHelmet("skateHelmet",  "Skate helmet",   "skates / scooter / BMX"));
    if (!hasCy) choices.push(mkHelmet("cyclingHelmet", "Cycling helmet", "all bikes, BMX"));
  };

  // ── owns something ─────────────────────────────────────────────
  if (owned) {
    const ownedName = ITEMS[owned.id]!.name;
    const choices: Choice[] = FLEET
      .filter(v => v.id !== owned.id)
      .map(v => {
        const price = ITEMS[v.id]!.price!;
        const net   = price - owned.tradeIn;
        if (net <= 0) {
          const credit = -net;
          return {
            label: `Trade for ${v.label} — get $${credit} back`,
            run: () => {
              removeItem(s.inventory, owned.id);
              addItem(s.inventory, v.id);
              s.cash += credit;
              pushLog(s, v.swapLog, "good");
              return null;
            },
          } satisfies Choice;
        }
        return s.cash >= net
          ? {
              label: `Swap for ${v.label} — $${net} (trade-in)`,
              run: () => {
                s.cash -= net;
                removeItem(s.inventory, owned.id);
                addItem(s.inventory, v.id);
                pushLog(s, v.swapLog, "good");
                return null;
              },
            } satisfies Choice
          : { label: `${v.label} — $${net} after trade-in`, locked: `Need $${net - s.cash} more` } satisfies Choice;
      });

    choices.push({
      label: `Sell the ${ownedName} — $${owned.tradeIn}`,
      run: () => {
        removeItem(s.inventory, owned.id);
        s.cash += owned.tradeIn;
        pushLog(s, `Bob takes the ${ownedName}. $${owned.tradeIn} in your hand.`, "plain");
        return null;
      },
    });
    addHelmetChoices(choices);
    choices.push(BACK);

    return menu("Bob's Bikes", [
      `Your ${ownedName.toLowerCase()} is outside.`,
      "Bob can swap you into anything else on the floor.",
    ], choices);
  }

  // ── no vehicle ─────────────────────────────────────────────────
  const choices: Choice[] = FLEET.map(v => {
    const price = ITEMS[v.id]!.price!;
    return s.cash >= price
      ? {
          label: `${v.label} — $${price}`,
          run: () => {
            s.cash -= price;
            addItem(s.inventory, v.id);
            pushLog(s, v.buyLog, "good");
            return null;
          },
        } satisfies Choice
      : { label: `${v.label} — $${price}`, locked: `Need $${price - s.cash} more` } satisfies Choice;
  });
  addHelmetChoices(choices);
  choices.push(BACK);

  return menu("Bob's Bikes", [
    "Six options on the floor, none of them new.",
    "Skates at $15. Scooter at $28. Folder at $32. BMX at $50. Mountain at $70. Road at $145.",
  ], choices);
};

/* --------------------------------------------------------------- church */

const church: Venue = (ctx) => {
  const s = ctx.state;
  const choices: Choice[] = [];

  // Soup kitchen — once per day, same pattern as the food bank
  const soupKey = "churchSoupDay";
  const today = Math.floor(s.time / 1440);
  const hadSoup = (s.flags[soupKey] ?? -1) === today;
  const kitchenOpen = withinHours(s.time, 10, 20);

  if (kitchenOpen) {
    choices.push(
      hadSoup
        ? { label: "Soup kitchen", hint: "one meal a day", locked: "You've already eaten here today" }
        : {
            label: "Soup kitchen",
            hint: "free, 20 min",
            run: () => {
              ctx.advance(20, { sheltered: true });
              s.flags[soupKey] = today;
              applyDelta(s.meters, { hunger: +55, thirst: +25, morale: +10, health: +4 });
              if (ctx.rng.chance(0.4)) addItem(s.inventory, "sandwich", 1);
              pushLog(s, "Had a meal at St. Jude's soup kitchen.", "good");
              return menu(
                "St. Jude's",
                [
                  "A fold-out table, a ladle, and someone who looks you in the eye.",
                  "You sit with three others. Nobody asks anything.",
                ],
                [BACK],
                "good",
              );
            },
          },
    );
  } else {
    choices.push({ label: "Soup kitchen", hint: "10AM–8PM", locked: "The kitchen is closed right now" });
  }

  // Prayer — always available, small morale and health restore
  choices.push({
    label: "Sit quietly for a while",
    hint: "20 min, free",
    run: () => {
      ctx.advance(20, { sheltered: true });
      applyDelta(s.meters, { morale: +14, health: +5, energy: +6 });
      pushLog(s, "Rested at St. Jude's.", "good");
      return menu(
        "St. Jude's",
        [
          "The pews are hard but dry. Nobody comes to move you on.",
          "You stay until you feel slightly less like you're losing.",
        ],
        [BACK],
      );
    },
  });

  // Donate — optional, available when you have something to give
  const canDonate = s.cash >= 5;
  choices.push(
    canDonate
      ? {
          label: "Leave a donation",
          hint: "$5",
          run: () => {
            s.cash -= 5;
            applyDelta(s.meters, { morale: +10 });
            pushLog(s, "Donated $5 at St. Jude's.", "money");
            return menu(
              "St. Jude's",
              ["You drop a five into the box by the door.", "It's not much. It still counts."],
              [BACK],
              "money",
            );
          },
        }
      : { label: "Leave a donation", locked: "You don't have $5 to spare" },
  );

  choices.push(BACK);
  return menu(
    "St. Jude's",
    ["A stone building that has been absorbing people's worst days for a hundred years.", "The door is open."],
    choices,
  );
};

/* ------------------------------------------------------------- hospital */

const hospital: Venue = (ctx) => {
  const s = ctx.state;
  const healthy = s.meters.health >= 80 && !s.sick;

  if (healthy) {
    return menu(
      "Brokemon General",
      [
        "The A&E waiting room smells of disinfectant and old coffee.",
        "A triage nurse glances at you. \"You look fine. We're busy.\"",
      ],
      [BACK],
    );
  }

  const choices: Choice[] = [];

  // Cost tiers: full ($80), reduced ($30), free stabilisation (adds $60 debt)
  const fullCost = 80;
  const reducedCost = 30;

  if (s.cash >= fullCost) {
    choices.push({
      label: "Get treated",
      hint: `$${fullCost}`,
      run: () => {
        ctx.advance(120, { sheltered: true });
        s.cash -= fullCost;
        s.sick = false;
        s.meters.health = Math.min(100, Math.max(s.meters.health, 85));
        applyDelta(s.meters, { morale: +8 });
        pushLog(s, `Treated at Brokemon General. Paid $${fullCost}.`, "good");
        return menu(
          "Brokemon General",
          [
            "Two hours, a curtained bay, a drip, and a doctor who explains nothing.",
            `Paid $${fullCost}. You leave feeling like a person again.`,
          ],
          [BACK],
          "good",
        );
      },
    });
  } else if (s.cash >= reducedCost) {
    choices.push({
      label: "Get treated — sliding scale",
      hint: `$${reducedCost}`,
      run: () => {
        ctx.advance(120, { sheltered: true });
        s.cash -= reducedCost;
        s.sick = false;
        s.meters.health = Math.min(100, Math.max(s.meters.health, 68));
        pushLog(s, `Treated at Brokemon General (sliding scale). Paid $${reducedCost}.`, "good");
        return menu(
          "Brokemon General",
          [
            "You tell the desk you can't afford full price. They put you down for sliding scale.",
            `$${reducedCost} and three hours. You come out stable.`,
          ],
          [BACK],
          "good",
        );
      },
    });
  } else {
    choices.push({
      label: "Emergency treatment — can't pay",
      hint: "+$60 debt",
      run: () => {
        ctx.advance(120, { sheltered: true });
        s.sick = false;
        s.debt += 60;
        s.meters.health = Math.min(100, Math.max(s.meters.health, 50));
        pushLog(s, "Stabilised at Brokemon General. $60 added to your debt.", "bad");
        return menu(
          "Brokemon General",
          [
            "They stabilise you. They have to — it's the law.",
            "A letter will follow. It always does.",
          ],
          [BACK],
          "bad",
        );
      },
    });
  }

  choices.push(BACK);

  const conditionLines = s.sick
    ? ["You're running a fever. The triage nurse waves you through quickly."]
    : ["Your health stats have the nurse frowning at her clipboard."];

  return menu("Brokemon General", conditionLines, choices);
};

/* --------------------------------------------------------------- registry */

export const VENUES: Record<string, Venue> = {
  communityCenter,
  mart,
  laundromat,
  recycling,
  hostel,
  trailer,
  apartment,
  estate,
  college,
  bank,
  corporatePlaza,
  jobBoard,
  busStop,
  diner,
  outskirtsBusStop,
  bikeShop,
  church,
  hospital,
  coachTerminal,
  agency,
  nightMarket,
  weeklyRooms,
  washhouse,
  dossHouse,
  pawnShop,
  jobCentre,
  depot,
  gym,
};
