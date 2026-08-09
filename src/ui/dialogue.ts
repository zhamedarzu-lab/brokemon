import type { Choice, Prompt } from "../sim/prompt";

/**
 * The dialogue box. Owns keyboard focus while a prompt is open; the game
 * loop asks `isOpen()` before letting the player walk.
 */
export class Dialogue {
  private root: HTMLElement;
  private box: HTMLElement;
  private titleEl: HTMLElement;
  private bodyEl: HTMLElement;
  private choicesEl: HTMLElement;
  private lockEl: HTMLElement;

  private prompt: Prompt | null = null;
  private index = 0;
  private onClose: (() => void) | null = null;
  private onAmountFocus: (() => void) | null = null;

  constructor(root: HTMLElement, onAmountFocus?: () => void) {
    this.onAmountFocus = onAmountFocus ?? null;
    this.root = root;
    root.innerHTML = `
      <div class="dialogue" role="dialog" aria-live="polite">
        <div class="dialogue-title"></div>
        <div class="dialogue-body"></div>
        <div class="dialogue-choices"></div>
        <div class="dialogue-lock"></div>
      </div>
    `;
    this.box = root.querySelector(".dialogue")!;
    this.titleEl = root.querySelector(".dialogue-title")!;
    this.bodyEl = root.querySelector(".dialogue-body")!;
    this.choicesEl = root.querySelector(".dialogue-choices")!;
    this.lockEl = root.querySelector(".dialogue-lock")!;
    root.classList.add("hidden");

    // With no choices there is nothing to aim at, so the whole box is the
    // button. Without this a touch player cannot dismiss a plain line of prose.
    // numberInput prompts have no choices but must NOT be dismissed by a click —
    // the input field and its buttons handle interaction themselves.
    this.box.addEventListener("click", (e) => {
      if (this.prompt?.choices?.length) return;
      if (this.prompt?.numberInput) return;
      e.stopPropagation();
      this.confirm();
    });
  }

  isOpen(): boolean {
    return this.prompt !== null;
  }

  open(prompt: Prompt, onClose?: () => void): void {
    this.prompt = prompt;
    this.onClose = onClose ?? null;
    this.index = this.firstSelectable(prompt);
    this.render();
    this.root.classList.remove("hidden");
  }

  close(): void {
    this.prompt = null;
    // Ensure any focused number-input field relinquishes focus before hiding,
    // otherwise Input ignores all keyboard events while it stays active.
    const focused = this.root.querySelector<HTMLElement>(":focus");
    focused?.blur();
    this.root.classList.add("hidden");
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  private choices(): Choice[] {
    return this.prompt?.choices ?? [];
  }

  private firstSelectable(prompt: Prompt): number {
    const list = prompt.choices ?? [];
    const i = list.findIndex((c) => !c.locked);
    return i >= 0 ? i : 0;
  }

  move(delta: number): void {
    const list = this.choices();
    if (list.length === 0) return;
    let next = this.index;
    for (let i = 0; i < list.length; i++) {
      next = (next + delta + list.length) % list.length;
      if (!list[next]!.locked) break;
    }
    this.index = next;
    this.render();
  }

  /** Returns the follow-up prompt, or null when the box should close. */
  confirm(): void {
    if (!this.prompt) return;
    const list = this.choices();

    if (list.length === 0) {
      this.close();
      return;
    }

    const choice = list[this.index];
    if (!choice) {
      this.close();
      return;
    }
    if (choice.locked) {
      this.flashLock(choice.locked);
      return;
    }

    const next = choice.run?.() ?? null;
    if (next) {
      this.prompt = next;
      this.index = this.firstSelectable(next);
      this.render();
    } else {
      this.close();
    }
  }

  cancel(): void {
    if (!this.prompt) return;
    const list = this.choices();
    // Escape picks the trailing "leave" choice if the prompt has one.
    const leave = list.findIndex((c) => !c.locked && !c.run);
    if (leave >= 0) {
      this.index = leave;
      this.confirm();
    } else {
      this.close();
    }
  }

  private flashLock(reason: string): void {
    this.lockEl.textContent = reason;
    this.lockEl.classList.add("visible");
    window.setTimeout(() => this.lockEl.classList.remove("visible"), 2200);
  }

  private render(): void {
    const p = this.prompt;
    if (!p) return;
    this.box.dataset.tone = p.tone ?? "plain";
    this.titleEl.textContent = p.title;
    this.bodyEl.innerHTML = p.lines.map((l) => (l === "" ? "<br>" : `<p>${escapeHtml(l)}</p>`)).join("");

    this.choicesEl.innerHTML = "";

    // Number-input prompt: render a text field + confirm button instead of choices.
    if (p.numberInput) {
      const ni = p.numberInput;
      const field = document.createElement("input");
      field.type = "number";
      field.className = "amount-input";
      field.min = String(ni.min);
      field.max = String(ni.max);
      field.step = "1";
      field.placeholder = ni.placeholder ?? `${ni.min}–${ni.max}`;
      field.setAttribute("inputmode", "numeric");

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "choice selected";
      confirmBtn.innerHTML = `<span class="choice-label">Confirm</span>`;

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "choice";
      cancelBtn.innerHTML = `<span class="choice-label">Cancel</span>`;

      const tryConfirm = () => {
        const raw = field.value.trim();
        // Reject empty, decimals, scientific notation, and anything non-integer.
        const val = /^\d+$/.test(raw) ? Number(raw) : NaN;
        if (isNaN(val) || val < ni.min || val > ni.max) {
          this.flashLock(`Enter a whole number between $${ni.min} and $${ni.max}`);
          return;
        }
        const next = ni.onConfirm(val);
        if (next) {
          this.prompt = next;
          this.index = this.firstSelectable(next);
          this.render();
        } else {
          this.close();
        }
      };

      confirmBtn.addEventListener("click", tryConfirm);
      cancelBtn.addEventListener("click", () => this.close());
      field.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); tryConfirm(); }
        if (e.key === "Escape") { e.preventDefault(); this.close(); }
      });

      this.choicesEl.appendChild(field);
      this.choicesEl.appendChild(confirmBtn);
      this.choicesEl.appendChild(cancelBtn);

      // When the field gains focus, clear any held game keys so movement
      // doesn't stay latched while keyboard events are suppressed.
      field.addEventListener("focus", () => this.onAmountFocus?.());

      // Focus the field on next tick (after DOM is attached).
      setTimeout(() => field.focus(), 0);
      this.box.classList.remove("tappable");
      return;
    }

    const list = this.choices();
    this.box.classList.toggle("tappable", list.length === 0);
    if (list.length === 0) {
      const hint = document.createElement("div");
      hint.className = "dialogue-continue";
      hint.innerHTML = `<span class="key-only"><kbd>Z</kbd> continue</span><span class="touch-only">Tap to continue</span>`;
      this.choicesEl.appendChild(hint);
      return;
    }

    const buttons: HTMLButtonElement[] = [];
    list.forEach((choice, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "choice";
      el.classList.toggle("selected", i === this.index);
      el.classList.toggle("locked", Boolean(choice.locked));
      el.innerHTML = `
        <span class="choice-label">${escapeHtml(choice.label)}</span>
        ${choice.hint ? `<span class="choice-hint">${escapeHtml(choice.hint)}</span>` : ""}
      `;
      // Click: confirm immediately without a full re-render first.
      el.addEventListener("click", () => {
        if (choice.locked) { this.flashLock(choice.locked); return; }
        this.index = i;
        this.confirm();
      });
      // Hover: just toggle the CSS class; no DOM rebuild needed.
      el.addEventListener("mouseenter", () => {
        if (choice.locked) return;
        this.index = i;
        buttons.forEach((b, bi) => b.classList.toggle("selected", bi === i));
      });
      buttons.push(el);
      this.choicesEl.appendChild(el);
    });

    const selected = list[this.index];
    if (selected?.locked) this.lockEl.textContent = selected.locked;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
