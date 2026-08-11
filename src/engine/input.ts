export type Button = "up" | "down" | "left" | "right" | "confirm" | "cancel" | "menu" | "log" | "save" | "map";

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
  KeyM: "map",
};

export class Input {
  private held = new Set<Button>();
  private pressed = new Set<Button>();
  private stick = { x: 0, y: 0 };
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
   * Where the player is pushing, as a step of -1, 0 or 1 on each axis.
   *
   * Two keys at once make a diagonal, which is the whole point: the town is
   * drawn isometrically and its streets run diagonally on screen, so W and A
   * together walk *along* one instead of stepping around it.
   *
   * Held keys win, but a press that arrived and released between two frames
   * still counts — otherwise a quick tap does nothing at all. Opposite keys
   * cancel, so rolling a thumb across the pad never freezes you.
   */
  heldVector(): { x: number; y: number } {
    const on = (b: Button) => this.held.has(b) || this.pressed.has(b);
    let x = (on("right") ? 1 : 0) - (on("left") ? 1 : 0);
    let y = (on("down") ? 1 : 0) - (on("up") ? 1 : 0);
    // An analogue stick beats the buttons when it is off centre.
    if (this.stick.x !== 0 || this.stick.y !== 0) {
      x = this.stick.x;
      y = this.stick.y;
    }
    return { x, y };
  }

  /**
   * The on-screen joystick, in steps rather than degrees.
   *
   * A thumbstick that reports a continuous angle is no use to a grid: the
   * player still moves one tile at a time. What it reports is which of the
   * eight neighbours they are leaning towards, and the dead zone is the
   * difference between a stick you can hold still and one that walks you into
   * a wall while you think.
   */
  setStick(dx: number, dy: number): void {
    const mag = Math.hypot(dx, dy);
    if (mag < 0.34) {
      this.stick = { x: 0, y: 0 };
      return;
    }
    // Eight sectors, so a diagonal is as easy to hold as a cardinal.
    const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    const steps = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ] as const;
    const [x, y] = steps[((sector % 8) + 8) % 8]!;
    this.stick = { x, y };
  }

  clearStick(): void {
    this.stick = { x: 0, y: 0 };
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
    this.stick = { x: 0, y: 0 };
  }

  dispose(): void {
    this.detach();
  }
}
