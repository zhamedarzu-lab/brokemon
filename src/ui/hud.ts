import { zoneAt } from "../world/map";
import { interactionLabel } from "../sim/actions";
import { METER_LABEL, METER_ORDER, type MeterId } from "../sim/meters";
import { currentAppearance, netWorth, phaseOf, PHASE_NAMES, townOf, type GameState } from "../sim/state";
import { dayOf, dayPart, formatClock } from "../sim/time";
import { WEATHER } from "../sim/weather";
import { EMPLOYMENT } from "../sim/jobs";
import { HOUSING } from "../sim/social";

const METER_COLOR: Record<MeterId, string> = {
  hunger: "#d98f4a",
  thirst: "#4aa8d9",
  hygiene: "#6fc4a8",
  energy: "#d9c44a",
  morale: "#b47ad9",
  health: "#d95a5a",
};

/**
 * Everything the player has outstanding, for the one line at the bottom of the
 * screen. A lead that exists only as a flag is a lead the player forgets they
 * have — the colleague's interview was set up, never mentioned again, and then
 * fired as a random encounter days later.
 */
function openTasks(s: GameState): string[] {
  const tasks: string[] = [];

  const a = s.assignment;
  if (a) {
    tasks.push(
      a.ready
        ? `<span class="good">${a.label} — collect at the job board</span>`
        : `${a.label} — ${a.targets.length} stop${a.targets.length === 1 ? "" : "s"} left`,
    );
  }

  if (s.flags.colleagueInterviewPending && !s.flags.colleagueInterviewDone) {
    tasks.push(`<span class="good">Interview lined up — keep yourself presentable</span>`);
  } else if (s.flags.colleagueNumberGiven && !s.flags.colleagueCallDone) {
    tasks.push(`A number to call back — they said they'd be in touch`);
  }

  if (s.won && s.postWinGoal > 0) {
    tasks.push(`Net worth $${netWorth(s).toLocaleString()} of $${s.postWinGoal.toLocaleString()}`);
  }

  return tasks;
}

export class Hud {
  private root: HTMLElement;
  private bars = new Map<MeterId, { fill: HTMLElement; value: HTMLElement; row: HTMLElement }>();
  private clockEl: HTMLElement;
  private dayEl: HTMLElement;
  private weatherEl: HTMLElement;
  private zoneEl: HTMLElement;
  private cashEl: HTMLElement;
  private ledgerEl: HTMLElement;
  private phaseEl: HTMLElement;
  private statusEl: HTMLElement;
  private hintEl: HTMLElement;
  private taskEl: HTMLElement;
  private toastsEl: HTMLElement;
  private lastLogIndex = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="hud-top">
        <div class="hud-chip" id="hud-day">Day 1</div>
        <div class="hud-chip" id="hud-clock">7:00 AM</div>
        <div class="hud-chip" id="hud-weather">Overcast</div>
        <div class="hud-chip hud-zone" id="hud-zone">The Outskirts</div>
      </div>
      <div class="hud-left">
        <div class="meters" id="hud-meters"></div>
      </div>
      <div class="hud-right">
        <div class="hud-cash" id="hud-cash">$0</div>
        <div class="hud-ledger" id="hud-ledger"></div>
        <div class="hud-phase" id="hud-phase"></div>
        <div class="hud-status" id="hud-status"></div>
      </div>
      <div class="hud-bottom">
        <div class="hud-task" id="hud-task"></div>
        <div class="hud-hint" id="hud-hint"></div>
      </div>
      <div class="toasts" id="hud-toasts"></div>
    `;

    const meters = root.querySelector<HTMLElement>("#hud-meters")!;
    for (const id of METER_ORDER) {
      const row = document.createElement("div");
      row.className = "meter";
      row.innerHTML = `
        <span class="meter-label">${METER_LABEL[id]}</span>
        <span class="meter-track"><span class="meter-fill"></span></span>
        <span class="meter-value">0</span>
      `;
      const fill = row.querySelector<HTMLElement>(".meter-fill")!;
      fill.style.background = METER_COLOR[id];
      meters.appendChild(row);
      this.bars.set(id, { fill, value: row.querySelector<HTMLElement>(".meter-value")!, row });
    }

    this.clockEl = root.querySelector("#hud-clock")!;
    this.dayEl = root.querySelector("#hud-day")!;
    this.weatherEl = root.querySelector("#hud-weather")!;
    this.zoneEl = root.querySelector("#hud-zone")!;
    this.cashEl = root.querySelector("#hud-cash")!;
    this.ledgerEl = root.querySelector("#hud-ledger")!;
    this.phaseEl = root.querySelector("#hud-phase")!;
    this.statusEl = root.querySelector("#hud-status")!;
    this.hintEl = root.querySelector("#hud-hint")!;
    this.taskEl = root.querySelector("#hud-task")!;
    this.toastsEl = root.querySelector("#hud-toasts")!;
  }

  update(s: GameState, interactive: boolean): void {
    for (const id of METER_ORDER) {
      const bar = this.bars.get(id)!;
      const v = Math.round(s.meters[id]);
      bar.fill.style.width = `${v}%`;
      bar.value.textContent = String(v);
      bar.row.classList.toggle("critical", v <= 20);
      bar.row.classList.toggle("warning", v > 20 && v <= 40);
    }

    this.dayEl.textContent = `Day ${dayOf(s.time)}`;
    this.clockEl.textContent = formatClock(s.time);
    this.clockEl.dataset.part = dayPart(s.time);
    this.weatherEl.textContent = WEATHER[s.weather].name;
    this.weatherEl.classList.toggle("wet", WEATHER[s.weather].wet);
    this.zoneEl.textContent = zoneAt(townOf(s), s.player.pos.y).name;

    this.cashEl.textContent = `$${s.cash.toLocaleString()}`;
    const ledger: string[] = [];
    if (s.bank > 0) ledger.push(`bank $${s.bank.toLocaleString()}`);
    if (s.investments > 0) ledger.push(`invested $${s.investments.toLocaleString()}`);
    if (s.debt > 0) ledger.push(`<span class="bad">debt $${s.debt.toLocaleString()}</span>`);
    ledger.push(`net $${netWorth(s).toLocaleString()}`);
    this.ledgerEl.innerHTML = ledger.join(" · ");

    const phase = phaseOf(s);
    this.phaseEl.textContent = `Phase ${phase} — ${PHASE_NAMES[phase]}`;

    const status: string[] = [HOUSING[s.housing].name];
    status.push(s.employment ? EMPLOYMENT[s.employment].name : "Unemployed");
    status.push(`look ${currentAppearance(s)}`);
    if (s.sick) status.push(`<span class="bad">ill</span>`);
    this.statusEl.innerHTML = status.join(" · ");

    this.taskEl.innerHTML = openTasks(s).join(" · ");

    const label = interactive ? interactionLabel(s) : null;
    this.hintEl.innerHTML = label ? `<kbd>Z</kbd> ${label}` : "";
    this.hintEl.classList.toggle("visible", label !== null);

    this.drainLog(s);
  }

  private drainLog(s: GameState): void {
    if (s.log.length < this.lastLogIndex) this.lastLogIndex = 0;
    for (let i = this.lastLogIndex; i < s.log.length; i++) {
      const line = s.log[i]!;
      const el = document.createElement("div");
      el.className = `toast toast-${line.tone}`;
      el.textContent = line.text;
      this.toastsEl.appendChild(el);
      setTimeout(() => el.classList.add("out"), 4200);
      setTimeout(() => el.remove(), 5000);
    }
    this.lastLogIndex = s.log.length;
    while (this.toastsEl.childElementCount > 5) this.toastsEl.firstElementChild?.remove();
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle("hidden", !visible);
  }
}
