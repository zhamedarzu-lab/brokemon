import { markerPos } from "../world/map";
import { addItem, countOf, ITEMS, removeItem, SHOP_STOCK, type ItemId } from "./items";
import {
  CLASS_COST,
  CLASS_END,
  CLASS_NAMES,
  CLASS_START,
  EMPLOYMENT,
  EMPLOYMENT_ORDER,
  GIGS,
  MAX_CREDITS,
  type EmploymentId,
} from "./jobs";
import { applyDelta } from "./meters";
import { menu, say, type Choice, type Prompt } from "./prompt";
import { HOUSING, OUTFITS, OUTFIT_ORDER, outfitRank, type OutfitId } from "./social";
import { canDoGig, checkRequirements, currentAppearance, earnCash, phaseOf, pushLog, setWon } from "./state";
import { withinHours } from "./time";
import {
  collectAssignment,
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
      applyDelta(s.meters, { hygiene: +42, morale: +8 });
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
        const before = s.housing;
        s.housing = "hostel";
        const result = sleep(ctx, "hostel", 7);
        s.housing = before === "street" ? "street" : before;
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
  if (!open) return say("Brokemon Mart", "Shutters down. Opens at 6AM.");

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

  if (s.employment === "martClerk" || s.employment === "nightStock") {
    const w = shiftWindow(s, s.employment);
    choices.push({
      label: "Clock in",
      hint: w === "open" ? "on time" : w === "late" ? "late" : "not your hours",
      run: () => workShift(ctx, s.employment as EmploymentId),
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
            applyDelta(s.meters, { hygiene: +30, morale: +10 });
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
            s.housing = "hostel";
            s.nightsPaid = 1;
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
            applyDelta(s.meters, { hygiene: +28, morale: +6 });
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
  if (s.housing === "trailer") {
    return menu(
      "Your trailer",
      [def.desc, `Rent of $${def.rent} is due on day ${s.rentDueDay}.`],
      [
        { label: "Sleep until morning", run: () => sleep(ctx, "trailer", 7) },
        {
          label: "Wash",
          hint: "25 min",
          run: () => {
            ctx.advance(25, { sheltered: true });
            applyDelta(s.meters, { hygiene: +32, morale: +6 });
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
              s.housing = "trailer";
              s.rentDueDay = Math.floor(s.time / 1440) + 1 + def.rentEvery;
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
  if (s.housing === "apartment" || s.housing === "estate") {
    return menu(
      "Your apartment",
      [def.desc, `Rent of $${def.rent} is due on day ${s.rentDueDay}.`],
      [
        { label: "Sleep until morning", run: () => sleep(ctx, "apartment", 7) },
        {
          label: "Shower and change",
          hint: "30 min",
          run: () => {
            ctx.advance(30, { sheltered: true });
            applyDelta(s.meters, { hygiene: +45, morale: +8 });
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
  if (s.credit < creditNeeded) reasons.push(`your credit score is ${s.credit}, they want ${creditNeeded}`);
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
              s.housing = "apartment";
              s.rentDueDay = Math.floor(s.time / 1440) + 1 + def.rentEvery;
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
  if (s.housing === "estate") {
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
  if (s.credit < 720) reasons.push(`they will not take an offer from a ${s.credit} credit score`);

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
              s.housing = "estate";
              s.peakPhase = 4;
              s.meters.morale = 100;
              pushLog(s, "Bought the estate on the hill.", "good");
              if (s.businessOwned || s.mayor) setWon(s);
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
  if (s.meters.energy < 20) reasons.push("you would sleep through it");

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
              applyDelta(s.meters, { energy: -18, hunger: -12, thirst: -14, morale: +8 });
              s.education += 1;
              pushLog(s, `Completed ${nextName}. ${s.education} credits.`, "good");
              return menu(
                "Community College",
                [
                  "Three hours in a room with eleven other people who came straight from work.",
                  `Credit earned. ${s.education}/${MAX_CREDITS}.`,
                ],
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
  if (!withinHours(s.time, 9, 17)) return say("Route 1 Savings & Loan", "Closed. Open 9AM to 5PM, weekdays and every day here.");

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
    const w = shiftWindow(s, s.employment);
    choices.push({
      label: "Go up to your floor",
      hint: w === "open" ? "on time" : w === "late" ? "late" : "not your hours",
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
    if (s.cash + s.bank < BUSINESS_PRICE) reasons.push(`the buy-in is $${BUSINESS_PRICE.toLocaleString()}`);
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
              s.reputation += 15;
              s.peakPhase = 4;
              pushLog(s, "Bought the Mart franchise.", "good");
              if (s.housing === "estate") setWon(s);
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
    if (s.reputation < 40) reasons.push(`nobody knows your name yet (reputation ${s.reputation}/40)`);
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

  for (const id of EMPLOYMENT_ORDER) {
    const def = EMPLOYMENT[id];
    if (s.employment === id) continue;
    // Hide jobs more than one tier beyond the player's current phase.
    if (def.tier > phase + 1) continue;
    const gate = checkRequirements(s, def.requires);
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

function hire(ctx: ActionCtx, id: EmploymentId): Prompt {
  const s = ctx.state;
  const def = EMPLOYMENT[id];
  ctx.advance(45, { sheltered: true });

  const look = currentAppearance(s);
  const odds = Math.min(0.95, 0.25 + (look - (def.requires.appearance ?? 30)) / 60 + s.reputation / 200);
  if (!ctx.rng.chance(odds)) {
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
  s.reputation += 3;
  s.meters.morale = Math.min(100, s.meters.morale + 25);
  if (def.tier >= 3) s.peakPhase = Math.max(s.peakPhase, 3) as 3 | 4;
  pushLog(s, `Hired: ${def.name} at ${def.employer}.`, "good");

  const lines = [
    def.desc,
    `Shift: ${fmtHour(def.shiftStart)}–${fmtHour(def.shiftEnd)} at ${def.employer}. $${def.pay} a shift.`,
  ];
  if (previous) lines.push(`You hand in your notice at ${EMPLOYMENT[previous].employer}.`);
  return menu("You're hired", lines, [BACK], "good");
}

function runForMayor(ctx: ActionCtx): Prompt {
  const s = ctx.state;
  const fromCash = Math.min(s.cash, CAMPAIGN_PRICE);
  s.cash -= fromCash;
  s.bank -= CAMPAIGN_PRICE - fromCash;
  ctx.advance(600, { sheltered: true });

  const odds = Math.min(0.95, 0.3 + s.reputation / 120);
  if (!ctx.rng.chance(odds)) {
    s.reputation += 5;
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
  s.reputation += 20;
  pushLog(s, "Elected mayor of Brokemon Town.", "good");
  if (s.housing === "estate") setWon(s);
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
    const w = shiftWindow(s, s.employment);
    choices.push({
      label: "Clock in",
      hint: w === "open" ? "on time" : w === "late" ? "late" : "not your hours",
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
              const spot = ctx.rng.pick(YARD_SPOTS);
              const p = markerPos(spot.marker);
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

const YARD_SPOTS: Array<{ marker: string; dx: number; dy: number; name: string }> = [
  { marker: "estate", dx: 0, dy: 1, name: "the estate on the hill" },
  { marker: "hostel", dx: 0, dy: 1, name: "behind the hostel" },
  { marker: "trailer", dx: 0, dy: 1, name: "the trailer park" },
  { marker: "college", dx: 0, dy: 1, name: "the college grounds" },
  { marker: "apartment", dx: 0, dy: 1, name: "the apartment block" },
];

function flyerRoute(ctx: ActionCtx): { x: number; y: number }[] {
  const doors = ["communityCenter", "mart", "college", "bank", "laundromat", "apartment", "hostel"];
  return ctx.rng
    .shuffled(doors)
    .slice(0, 4)
    .map((id) => {
      const p = markerPos(id);
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
    makeRide(ctx, "The Outskirts", markerPos("outskirtsBusStop"), hasPass, fare),
    makeRide(ctx, "The Heights gate", { x: 23, y: 15 }, hasPass, fare),
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
    hasPass
      ? ["You have a weekly pass. Show it and get on."]
      : [`$${fare} a ride, exact change, or $${ITEMS.busPass.price} for a weekly pass at the Mart.`],
    choices,
  );
};

/* ------------------------------------------------------------------ diner */

const diner: Venue = (ctx) => {
  const s = ctx.state;
  if (!withinHours(s.time, 6, 22)) return say("Route 1 Diner", "Closed. Open 6AM to 10PM.");

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
    makeRide(ctx, "Market Square", markerPos("busStop"), hasPass, fare),
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
};
