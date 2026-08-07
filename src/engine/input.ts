export type Button = "up" | "down" | "left" | "right" | "confirm" | "cancel" | "menu" | "log" | "save";

const BINDINGS: Record<string, Button> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
  Enter: "confirm",
  Space: "confirm",
  KeyZ: "confirm",
  KeyE: "confirm",
  Escape: "cancel",
  KeyX: "cancel",
  Backspace: "cancel",
  Tab: "menu",
  KeyC: "menu",
  KeyL: "log",
  KeyP: "save",
};

export class Input {
  private held = new Set<Button>();
  private pressed = new Set<Button>();
  private detach: () => void;

  constructor(target: EventTarget = window) {
    const down = (raw: Event) => {
      const e = raw as KeyboardEvent;
      // Let typed input fields handle their own keys.
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
      const button = BINDINGS[e.code];
      if (!button) return;
      e.preventDefault();
      if (!this.held.has(button)) this.pressed.add(button);
      this.held.add(button);
    };
    const up = (raw: Event) => {
      const e = raw as KeyboardEvent;
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
      const button = BINDINGS[e.code];
      if (!button) return;
      e.preventDefault();
      this.held.delete(button);
    };
    const blur = () => {
      this.held.clear();
      this.pressed.clear();
    };
    target.addEventListener("keydown", down);
    target.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    this.detach = () => {
      target.removeEventListener("keydown", down);
      target.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }

  isHeld(b: Button): boolean {
    return this.held.has(b);
  }

  /** True once per physical press. */
  justPressed(b: Button): boolean {
    return this.pressed.has(b);
  }

  /**
   * Direction to walk this frame. Held keys win, but a press that arrived and
   * released between two frames still counts — otherwise a quick tap on the
   * on-screen d-pad does nothing at all.
   */
  heldDirection(): "up" | "down" | "left" | "right" | null {
    const dirs = ["up", "down", "left", "right"] as const;
    for (const d of dirs) if (this.held.has(d)) return d;
    for (const d of dirs) if (this.pressed.has(d)) return d;
    return null;
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
  }

  /** Lets on-screen controls feed the same pipeline as the keyboard. */
  virtualPress(b: Button): void {
    this.pressed.add(b);
    this.held.add(b);
  }

  virtualRelease(b: Button): void {
    this.held.delete(b);
  }

  /** Release all held state — call when focus leaves the game surface. */
  clearHeld(): void {
    this.held.clear();
    this.pressed.clear();
  }

  dispose(): void {
    this.detach();
  }
}
