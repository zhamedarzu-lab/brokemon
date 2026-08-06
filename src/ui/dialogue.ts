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

  constructor(root: HTMLElement) {
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
    const list = this.choices();
    if (list.length === 0) {
      const hint = document.createElement("div");
      hint.className = "dialogue-continue";
      hint.innerHTML = `<kbd>Z</kbd> continue`;
      this.choicesEl.appendChild(hint);
      return;
    }

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
      el.addEventListener("click", () => {
        this.index = i;
        this.render();
        this.confirm();
      });
      el.addEventListener("mouseenter", () => {
        if (choice.locked) return;
        this.index = i;
        this.render();
      });
      this.choicesEl.appendChild(el);
    });

    const selected = list[this.index];
    if (selected?.locked) this.lockEl.textContent = selected.locked;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
