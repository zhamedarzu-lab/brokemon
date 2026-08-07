import { ITEMS, type ItemId } from "../sim/items";
import { EMPLOYMENT, EMPLOYMENT_ORDER, MAX_CREDITS } from "../sim/jobs";
import { METER_LABEL, METER_ORDER } from "../sim/meters";
import { HOUSING, OUTFITS } from "../sim/social";
import { checkRequirements, currentAppearance, netWorth, phaseOf, PHASE_NAMES, type GameState } from "../sim/state";
import { formatClock } from "../sim/time";

function reputationLabel(rep: number): string {
  if (rep >= 60) return "Respected";
  if (rep >= 30) return "Reliable";
  if (rep >= 0) return "Neutral";
  if (rep >= -30) return "Spotty";
  return "Infamous";
}

function investmentDisplay(s: GameState): string {
  if (s.investments === 0) return "—";
  const base = `$${s.investments.toLocaleString()}`;
  if (s.investmentLastDelta === 0) return base;
  const sign = s.investmentLastDelta > 0 ? "▲" : "▼";
  return `${base} ${sign} $${Math.abs(s.investmentLastDelta)}`;
}

type Tab = "status" | "bag" | "ladder" | "log";
const TABS: Tab[] = ["status", "bag", "ladder", "log"];
const TAB_LABEL: Record<Tab, string> = { status: "Status", bag: "Bag", ladder: "The Ladder", log: "Log" };

export class Journal {
  private root: HTMLElement;
  private tabsEl: HTMLElement;
  private paneEl: HTMLElement;
  private tab: Tab = "status";
  private cursor = 0;
  private state: GameState | null = null;
  private useItem: (id: ItemId) => void;

  constructor(root: HTMLElement, useItem: (id: ItemId) => void) {
    this.root = root;
    this.useItem = useItem;
    root.innerHTML = `
      <div class="journal">
        <div class="journal-tabs"></div>
        <div class="journal-pane"></div>
        <div class="journal-foot">
          <span class="key-only"><kbd>←</kbd><kbd>→</kbd> tabs · <kbd>↑</kbd><kbd>↓</kbd> select · <kbd>Z</kbd> use · <kbd>Tab</kbd> close</span>
          <span class="touch-only">Tap a tab to switch · tap an item to use it</span>
        </div>
      </div>
    `;
    this.tabsEl = root.querySelector(".journal-tabs")!;
    this.paneEl = root.querySelector(".journal-pane")!;
    root.classList.add("hidden");
  }

  isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }

  open(s: GameState): void {
    this.state = s;
    this.cursor = 0;
    this.root.classList.remove("hidden");
    this.render();
  }

  close(): void {
    this.root.classList.add("hidden");
  }

  toggle(s: GameState): void {
    if (this.isOpen()) this.close();
    else this.open(s);
  }

  nextTab(delta: number): void {
    const i = TABS.indexOf(this.tab);
    this.tab = TABS[(i + delta + TABS.length) % TABS.length]!;
    this.cursor = 0;
    this.render();
  }

  moveCursor(delta: number): void {
    const n = this.usableItems().length;
    if (this.tab !== "bag" || n === 0) return;
    this.cursor = (this.cursor + delta + n) % n;
    this.render();
  }

  confirm(): void {
    if (this.tab !== "bag") return;
    const items = this.usableItems();
    const pick = items[this.cursor];
    if (!pick) return;
    this.useItem(pick);
    this.cursor = Math.min(this.cursor, Math.max(0, this.usableItems().length - 1));
    this.render();
  }

  private usableItems(): ItemId[] {
    const s = this.state;
    if (!s) return [];
    return (Object.keys(s.inventory) as ItemId[])
      .filter((id) => (s.inventory[id] ?? 0) > 0 && ITEMS[id].consumable)
      .sort();
  }

  render(): void {
    const s = this.state;
    if (!s) return;

    this.tabsEl.innerHTML =
      TABS.map(
        (t) => `<button type="button" class="journal-tab ${t === this.tab ? "active" : ""}" data-tab="${t}">${TAB_LABEL[t]}</button>`,
      ).join("") + `<button type="button" class="journal-close" aria-label="Close">✕</button>`;

    this.tabsEl.querySelectorAll<HTMLElement>(".journal-tab").forEach((el) => {
      el.addEventListener("click", () => {
        this.tab = el.dataset.tab as Tab;
        this.cursor = 0;
        this.render();
      });
    });
    this.tabsEl.querySelector<HTMLElement>(".journal-close")?.addEventListener("click", () => this.close());

    this.paneEl.innerHTML =
      this.tab === "status"
        ? this.renderStatus(s)
        : this.tab === "bag"
          ? this.renderBag(s)
          : this.tab === "ladder"
            ? this.renderLadder(s)
            : this.renderLog(s);

    if (this.tab === "bag") {
      this.paneEl.querySelectorAll<HTMLElement>(".bag-row").forEach((el, i) => {
        el.addEventListener("click", () => {
          this.cursor = i;
          this.confirm();
        });
      });
    }
  }

  private renderStatus(s: GameState): string {
    const phase = phaseOf(s);
    const meters = METER_ORDER.map(
      (id) => `<div class="stat"><span>${METER_LABEL[id]}</span><b>${Math.round(s.meters[id])}</b></div>`,
    ).join("");

    return `
      <h3>Phase ${phase} — ${PHASE_NAMES[phase]}</h3>
      <div class="stat-grid">${meters}</div>
      <h3>Standing</h3>
      <div class="stat-grid">
        <div class="stat"><span>Appearance</span><b>${currentAppearance(s)}</b></div>
        <div class="stat"><span>Wearing</span><b>${OUTFITS[s.wearing].name}</b></div>
        <div class="stat"><span>Sleeping</span><b>${HOUSING[s.housing].name}</b></div>
        <div class="stat"><span>Job</span><b>${s.employment ? EMPLOYMENT[s.employment].name : "None"}</b></div>
        <div class="stat"><span>Credits</span><b>${s.education}/${MAX_CREDITS}</b></div>
        <div class="stat"><span>Reputation</span><b>${reputationLabel(s.reputation)}</b></div>
      </div>
      <h3>Money</h3>
      <div class="stat-grid">
        <div class="stat"><span>Cash</span><b>$${s.cash.toLocaleString()}</b></div>
        <div class="stat"><span>Savings</span><b>$${s.bank.toLocaleString()}</b></div>
        <div class="stat"><span>Invested</span><b>${investmentDisplay(s)}</b></div>
        <div class="stat"><span>Debt</span><b class="bad">$${s.debt.toLocaleString()}</b></div>
        <div class="stat"><span>Credit score</span><b>${s.credit}</b></div>
        <div class="stat"><span>Net worth</span><b>$${netWorth(s).toLocaleString()}</b></div>
      </div>
      <h3>Record</h3>
      <div class="stat-grid">
        <div class="stat"><span>Days survived</span><b>${s.daysSurvived}</b></div>
        <div class="stat"><span>Highest phase</span><b>${s.peakPhase} — ${PHASE_NAMES[s.peakPhase]}</b></div>
        <div class="stat"><span>Fines paid</span><b>$${s.fines.toLocaleString()}</b></div>
        <div class="stat"><span>Times collapsed</span><b>${s.collapses}</b></div>
        <div class="stat"><span>Shifts worked</span><b>${Object.values(s.shiftsWorked).reduce((a, b) => a + b, 0)}</b></div>
      </div>
    `;
  }

  private renderBag(s: GameState): string {
    const usable = this.usableItems();
    const gear = (Object.keys(s.inventory) as ItemId[]).filter((id) => (s.inventory[id] ?? 0) > 0 && !ITEMS[id].consumable);

    const rows = usable.length
      ? usable
          .map((id, i) => {
            const def = ITEMS[id];
            const effects = def.effect
              ? Object.entries(def.effect)
                  .map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${METER_LABEL[k as keyof typeof METER_LABEL] ?? k}`)
                  .join("  ")
              : "";
            return `
              <div class="bag-row ${i === this.cursor ? "selected" : ""}">
                <span class="bag-name">${def.name} <em>×${s.inventory[id]}</em></span>
                <span class="bag-effect">${effects}</span>
                <span class="bag-desc">${def.desc}</span>
              </div>`;
          })
          .join("")
      : `<p class="muted">Nothing you can eat, drink or wash with.</p>`;

    const gearRows = gear.length
      ? gear
          .map((id) => `<div class="bag-row gear"><span class="bag-name">${ITEMS[id].name} <em>×${s.inventory[id]}</em></span><span class="bag-desc">${ITEMS[id].desc}</span></div>`)
          .join("")
      : `<p class="muted">No gear.</p>`;

    return `<h3>Consumables</h3>${rows}<h3>Gear &amp; salvage</h3>${gearRows}`;
  }

  private renderLadder(s: GameState): string {
    const phase = phaseOf(s);
    const steps = [
      { n: 1, name: "The Streets", done: phase > 1, goal: "Soap, clean clothes, and a bed with a door — rent the trailer or take a hostel cot." },
      { n: 2, name: "Odd Jobs", done: phase > 2, goal: "A steady job, a phone employers can call, and night-class credits." },
      { n: 3, name: "The Career Track", done: phase > 3, goal: "A professional job and the apartment lease. Clear the debt, build the credit score." },
      { n: 4, name: "The Apex", done: s.won, goal: "The estate on the hill, plus the franchise or the mayor's office." },
    ]
      .map(
        (st) => `
        <div class="ladder-step ${st.n === phase ? "current" : ""} ${st.done ? "done" : ""}">
          <b>Phase ${st.n} — ${st.name}</b>
          <span>${st.goal}</span>
        </div>`,
      )
      .join("");

    const jobs = EMPLOYMENT_ORDER.map((id) => {
      const def = EMPLOYMENT[id];
      const gate = checkRequirements(s, def.requires);
      const worked = s.shiftsWorked[id] ?? 0;
      return `
        <div class="ladder-job ${gate.ok ? "open" : "shut"} ${s.employment === id ? "current" : ""}">
          <b>${def.name}</b>
          <span class="pay">$${def.pay}/shift</span>
          <span class="req">${gate.ok ? "You qualify." : gate.reasons.join("; ")}</span>
          ${worked ? `<span class="req">${worked} shift${worked === 1 ? "" : "s"} worked</span>` : ""}
        </div>`;
    }).join("");

    return `<h3>Where you are</h3>${steps}<h3>What's hiring</h3>${jobs}`;
  }

  private renderLog(s: GameState): string {
    if (s.log.length === 0) return `<p class="muted">Nothing has happened yet.</p>`;
    return s.log
      .slice()
      .reverse()
      .slice(0, 80)
      .map((l) => `<div class="log-line log-${l.tone}"><span class="log-time">${formatClock(l.time)}</span>${l.text}</div>`)
      .join("");
  }
}
