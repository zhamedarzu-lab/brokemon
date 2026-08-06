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
      const button = BINDINGS[e.code];
      if (!button) return;
      e.preventDefault();
      if (!this.held.has(button)) this.pressed.add(button);
      this.held.add(button);
    };
    const up = (raw: Event) => {
      const e = raw as KeyboardEvent;
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

  /** Direction currently held, most recent axis wins ties. */
  heldDirection(): "up" | "down" | "left" | "right" | null {
    for (const d of ["up", "down", "left", "right"] as const) {
      if (this.held.has(d)) return d;
    }
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

  dispose(): void {
    this.detach();
  }
}
