/**
 * The intercity coach.
 *
 * One road, two towns, and a timetable. The timetable is the whole point: a
 * bus you can summon is a menu option, a bus that leaves at eleven is a
 * decision. Turn up at 10:17 and you stand on the forecourt for forty-three
 * minutes; turn up after the last one and you are staying wherever you are.
 *
 * The fares are deliberately lopsided. Getting *to* Brokedale is affordable
 * long before getting back is comfortable, so the first trip out is a thing
 * you can do too early and regret — which is the intended shape of it, not a
 * balance bug. See docs/brokedale-scope.md §8.
 */

import { markerPos, townById, type TownId, type Vec2 } from "../world/map";
import { arriveIn, pushLog, type GameState } from "./state";
import { minuteOfDay } from "./time";
import { fmtHour, type ActionCtx } from "./work";

export interface CoachService {
  from: TownId;
  to: TownId;
  /** Marker you board at, in `from`. */
  stop: string;
  /** Marker you are put down at, in `to`. */
  arrival: string;
  /** Minute-of-day departures, ascending. */
  departures: number[];
  fare: number;
  /** Time on the coach. */
  minutes: number;
  /** Whether waiting for it keeps the weather off you. */
  shelteredWait: boolean;
  /** What the destination is called on the front of the coach. */
  destination: string;
}

/** Departures every hour from `first` to `last` inclusive, `past` minutes past. */
function everyHour(first: number, last: number, past = 0): number[] {
  const out: number[] = [];
  for (let h = first; h <= last; h++) out.push(h * 60 + past);
  return out;
}

export const COACH_JOURNEY_MINUTES = 40;

export const SERVICES: CoachService[] = [
  {
    from: "brokemon",
    to: "brokedale",
    stop: "busStop",
    arrival: "coachTerminal",
    // On the hour, all day. The last one out is early enough that riding it is
    // a commitment to spending the night.
    departures: everyHour(6, 21),
    fare: 6,
    minutes: COACH_JOURNEY_MINUTES,
    shelteredWait: false,
    destination: "Brokedale",
  },
  {
    from: "brokedale",
    to: "brokemon",
    stop: "coachTerminal",
    arrival: "busStop",
    // Half past, and one more at eleven for the people coming off late shifts.
    departures: [...everyHour(6, 22, 30), 23 * 60],
    fare: 14,
    minutes: COACH_JOURNEY_MINUTES,
    shelteredWait: true,
    destination: "Brokemon Town",
  },
];

export function serviceFrom(town: TownId): CoachService | undefined {
  return SERVICES.find((s) => s.from === town);
}

/** Minute-of-day of the next departure today, or null once the last has gone. */
export function nextDeparture(service: CoachService, time: number): number | null {
  const now = minuteOfDay(time);
  return service.departures.find((d) => d >= now) ?? null;
}

/** How long you would stand there, or null if there is nothing left today. */
export function waitFor(service: CoachService, time: number): number | null {
  const next = nextDeparture(service, time);
  return next === null ? null : next - minuteOfDay(time);
}

export function firstDeparture(service: CoachService): number {
  return service.departures[0]!;
}

export function lastDeparture(service: CoachService): number {
  return service.departures[service.departures.length - 1]!;
}

/** Where this service puts you down, in the town it goes to. */
export function arrivalPoint(service: CoachService): Vec2 {
  return markerPos(townById(service.to), service.arrival);
}

/** Clock time as the timetable prints it — "6:30AM", not "390". */
export function fmtDeparture(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const min = total % 60;
  if (min === 0) return fmtHour(h24);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, "0")}${h24 < 12 ? "AM" : "PM"}`;
}

/**
 * Why you cannot get on, if you cannot. Same shape as the requirement checks
 * everywhere else, so the venue can hand it straight to `lockedChoice`.
 */
export function boardingReasons(s: GameState, service: CoachService): string[] {
  const reasons: string[] = [];
  if (s.cash < service.fare) reasons.push(`the fare is $${service.fare} and you have $${s.cash}`);
  if (nextDeparture(service, s.time) === null) {
    reasons.push(
      `the ${fmtDeparture(lastDeparture(service))} was the last one — the next is ${fmtDeparture(firstDeparture(service))} tomorrow`,
    );
  }
  return reasons;
}

/**
 * Pay, wait, ride, arrive. The wait is real time on the clock in the town you
 * are leaving, which is what makes a timetable cost anything.
 */
export function rideCoach(ctx: ActionCtx, service: CoachService): { waited: number; lines: string[] } {
  const s = ctx.state;
  const departure = nextDeparture(service, s.time);
  const wait = departure === null ? 0 : departure - minuteOfDay(s.time);

  s.cash -= service.fare;
  if (wait > 0) ctx.advance(wait, { sheltered: service.shelteredWait });
  ctx.advance(service.minutes, { sheltered: true });
  arriveIn(s, service.to, arrivalPoint(service));

  pushLog(s, `Took the coach to ${service.destination} — $${service.fare}.`, "money");

  const lines = [
    wait >= 5 && departure !== null
      ? `You wait ${Math.round(wait)} minutes on the stand for the ${fmtDeparture(departure)}.`
      : "It is already pulling in.",
    `${service.minutes} minutes of dual carriageway and a window that does not open.`,
  ];
  return { waited: wait, lines };
}
