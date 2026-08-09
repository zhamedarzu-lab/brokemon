import "./styles.css";

import { Input, type Button } from "./engine/input";
import { CANVAS_H, CANVAS_W, render } from "./engine/render";
import { interact } from "./sim/actions";
import { EVENT_CHANCE, EVENT_STEP_INTERVAL, rollEvent } from "./sim/events";
import type { ItemId } from "./sim/items";
import { menu, say, type Prompt } from "./sim/prompt";
import { EMPLOYMENT } from "./sim/jobs";
import { Rng } from "./sim/rng";
import { clearSave, hasSave, loadGame, saveGame } from "./sim/save";
import { createState, netWorth, pushLog, reputationIn, reputationLabel, townOf, type Ending, type GameState } from "./sim/state";
import { advance, escortDestination, policeCheck, type Interrupt, type TickOptions } from "./sim/tick";
import { MS_PER_MINUTE } from "./sim/time";
import { cap, consume, type ActionCtx } from "./sim/work";
import { Dialogue } from "./ui/dialogue";
import { Hud } from "./ui/hud";
import { Journal } from "./ui/journal";
import { isSolid, markerPos } from "./world/map";

const STEP_MS = 180;
const ROLLER_SKATES_STEP_MS = 162;
const KICK_SCOOTER_STEP_MS = 150;
const FOLDING_BIKE_STEP_MS = 140;
const BMX_STEP_MS = 108;
const BIKE_STEP_MS = 95;
const ROAD_BIKE_STEP_MS = 58;
const AUTOSAVE_EVERY_MS = 20_000;

class Game {
  private state: GameState;

  private rng: Rng;

  private input: Input;

  private ctx2d: CanvasRenderingContext2D;

  private hud: Hud;

  private dialogue: Dialogue;

  private journal: Journal;

  private queue: Prompt[] = [];

  private stepsTaken = 0;

  private stepsSinceEvent = 0;

  private lastFrame = 0;

  private sinceAutosave = 0;

  private running = false;

  private padEl: HTMLElement | null = null;

  private padHidden = false;

  /**
   * Tracks whether the victory screen has already been shown for this run.
   * Initialised to `state.victoryAcknowledged` so that a loaded save that was
   * already won does not re-show the victory prompt on launch, but a save
   * written right after winning still does.
   */
  private wonAcknowledged: boolean;

  constructor(state: GameState, private titleEl: HTMLElement) {
    this.state = state;
    this.wonAcknowledged = state.victoryAcknowledged;
    this.rng = new Rng(state.seed);
    this.input = new Input();

    const canvas = document.querySelector<HTMLCanvasElement>("#screen")!;
    const dpr = Math.round(window.devicePixelRatio || 1);
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    this.ctx2d = canvas.getContext("2d", { alpha: false })!;
    this.ctx2d.scale(dpr, dpr);

    this.hud = new Hud(document.querySelector<HTMLElement>("#hud")!);
    this.dialogue = new Dialogue(document.querySelector<HTMLElement>("#dialogue")!, () => this.input.clearHeld());
    this.journal = new Journal(document.querySelector<HTMLElement>("#journal")!, (id) => this.useItem(id));

    this.wireTouchControls();
    this.wireLifecycle();
  }

  private actionCtx(): ActionCtx {
    return {
      state: this.state,
      rng: this.rng,
      advance: (minutes, opts) => this.tick(minutes, opts),
      teleport: (x, y) => {
        this.state.player.pos = { x, y };
        this.state.player.moveFrom = null;
        this.state.player.moveProgress = 0;
      },
    };
  }

  private tick(minutes: number, opts?: Partial<TickOptions>): void {
    const interrupts = advance(this.state, this.rng, { minutes, ...opts });
    for (const i of interrupts) this.enqueue(interruptPrompt(i, this.actionCtx()));
  }

  private enqueue(prompt: Prompt | null): void {
    if (prompt) this.queue.push(prompt);
  }

  private openNext(): void {
    if (this.dialogue.isOpen()) return;
    // Check for a newly-won state and prepend the victory screen before
    // anything else in the queue. This fires after any dialogue chain closes,
    // so the purchase confirmation prompt always resolves before the victory
    // screen appears — never mid-menu.
    if (this.state.won && !this.wonAcknowledged) {
      this.wonAcknowledged = true;
      this.state.victoryAcknowledged = true; // persist so reload doesn't re-show
      const ending = this.state.endings[this.state.endings.length - 1] ?? "estate";
      const victory = interruptPrompt({ kind: "victory", ending }, this.actionCtx());
      if (victory) this.queue.unshift(victory);
    }
    const next = this.queue.shift();
    if (next) this.dialogue.open(next, () => this.openNext());
  }

  start(): void {
    this.running = true;
    this.titleEl.classList.add("hidden");
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    if (!this.running) return;
    const dt = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;

    this.handleInput();
    if (!this.paused()) this.updateMovement(dt);

    const busy = this.paused();
    this.hud.update(this.state, !busy && this.state.player.moveFrom === null);
    // Hide the pad only while the journal is open (it's full-screen and the
    // pad would sit on top of scrollable content). During dialogue the pad
    // stays visible — up/down/A already route to dialogue.move/confirm, and
    // hiding it leaves the player with no visible controls.
    this.setPadHidden(this.journal.isOpen());
    render(this.ctx2d, this.state, now);

    this.sinceAutosave += dt;
    if (this.sinceAutosave >= AUTOSAVE_EVERY_MS) {
      this.sinceAutosave = 0;
      saveGame(this.state);
    }

    this.input.endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  private paused(): boolean {
    return this.dialogue.isOpen() || this.journal.isOpen() || this.queue.length > 0;
  }

  private handleInput(): void {
    const i = this.input;

    if (this.dialogue.isOpen()) {
      if (i.justPressed("up")) this.dialogue.move(-1);
      if (i.justPressed("down")) this.dialogue.move(1);
      if (i.justPressed("confirm")) this.dialogue.confirm();
      if (i.justPressed("cancel")) this.dialogue.cancel();
      return;
    }

    if (this.queue.length > 0) {
      this.openNext();
      return;
    }

    if (this.journal.isOpen()) {
      if (i.justPressed("menu") || i.justPressed("cancel")) this.journal.close();
      if (i.justPressed("left")) this.journal.nextTab(-1);
      if (i.justPressed("right")) this.journal.nextTab(1);
      if (i.justPressed("up")) this.journal.moveCursor(-1);
      if (i.justPressed("down")) this.journal.moveCursor(1);
      if (i.justPressed("confirm")) this.journal.confirm();
      return;
    }

    if (i.justPressed("menu")) {
      this.journal.toggle(this.state);
      return;
    }
    if (i.justPressed("log")) {
      this.journal.open(this.state);
      this.journal.nextTab(3);
      return;
    }
    if (i.justPressed("save")) {
      const ok = saveGame(this.state);
      pushLog(this.state, ok ? "Game saved." : "Could not save — storage is unavailable.", "system");
      return;
    }
    if (i.justPressed("confirm") && this.state.player.moveFrom === null) {
      this.enqueue(interact(this.actionCtx()));
      this.openNext();
    }
  }

  private updateMovement(dt: number): void {
    const s = this.state;
    const p = s.player;

    // Time flows whether or not you are going anywhere.
    if (p.moveFrom === null) this.tick(dt / MS_PER_MINUTE, { exertion: 0.75 });
    if (this.paused()) return;

    const stepMs =
      (s.inventory.roadBike    ?? 0) > 0 ? ROAD_BIKE_STEP_MS :
      (s.inventory.bicycle     ?? 0) > 0 ? BIKE_STEP_MS :
      (s.inventory.bmxBike     ?? 0) > 0 ? BMX_STEP_MS :
      (s.inventory.foldingBike ?? 0) > 0 ? FOLDING_BIKE_STEP_MS :
      (s.inventory.kickScooter ?? 0) > 0 ? KICK_SCOOTER_STEP_MS :
      (s.inventory.rollerSkates ?? 0) > 0 ? ROLLER_SKATES_STEP_MS :
      STEP_MS;

    if (p.moveFrom !== null) {
      p.moveProgress += dt / stepMs;
      this.tick(dt / MS_PER_MINUTE, { exertion: 1.35 });
      if (p.moveProgress >= 1) {
        p.moveProgress = 0;
        p.moveFrom = null;
        this.onStepComplete();
      }
      return;
    }

    const dir = this.input.heldDirection();
    if (!dir) return;

    p.facing = dir;
    if (s.meters.energy <= 0 && this.rng.chance(0.35)) {
      // Running on empty: you keep stopping.
      return;
    }

    const d = dir === "up" ? [0, -1] : dir === "down" ? [0, 1] : dir === "left" ? [-1, 0] : [1, 0];
    const nx = p.pos.x + d[0]!;
    const ny = p.pos.y + d[1]!;
    if (isSolid(townOf(s), nx, ny)) return;

    p.moveFrom = { ...p.pos };
    p.pos = { x: nx, y: ny };
    p.moveProgress = 0;
  }

  private onStepComplete(): void {
    this.stepsTaken += 1;
    this.stepsSinceEvent += 1;
    this.state.lastMovedTime = this.state.time;

    const police = policeCheck(this.state, this.rng);
    if (police) {
      this.enqueue(interruptPrompt(police, this.actionCtx()));
      this.openNext();
      return;
    }

    if (this.stepsSinceEvent >= EVENT_STEP_INTERVAL) {
      this.stepsSinceEvent = 0;
      if (this.rng.chance(EVENT_CHANCE)) {
        this.enqueue(rollEvent(this.actionCtx()));
        this.openNext();
      }
    }
  }

  private useItem(id: ItemId): void {
    this.enqueue(consume(this.actionCtx(), id));
    this.journal.render();
    if (this.queue.length > 0) {
      this.journal.close();
      this.openNext();
    }
  }

  /**
   * On-screen controls. A d-pad is only usable if you can roll your thumb from
   * one direction into the next without lifting it, so buttons also arm on
   * pointerenter while a finger is already down, and everything disarms on
   * leave, up and cancel.
   */
  /** Fades the pad out while a panel is open, and releases anything held. */
  private setPadHidden(hidden: boolean): void {
    if (hidden === this.padHidden || !this.padEl) return;
    this.padHidden = hidden;
    this.padEl.classList.toggle("overlaid", hidden);
    if (!hidden) return;
    for (const el of this.padEl.querySelectorAll<HTMLElement>("[data-btn].pressed")) {
      this.input.virtualRelease(el.dataset.btn as Button);
      el.classList.remove("pressed");
    }
  }

  private wireTouchControls(): void {
    const pad = document.querySelector<HTMLElement>("#touch");
    if (!pad) return;
    this.padEl = pad;

    pad.querySelectorAll<HTMLElement>("[data-btn]").forEach((el) => {
      const button = el.dataset.btn as Button;

      const press = () => {
        this.input.virtualPress(button);
        el.classList.add("pressed");
      };
      const release = () => {
        this.input.virtualRelease(button);
        el.classList.remove("pressed");
      };

      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        press();
      });
      el.addEventListener("pointerenter", (e) => {
        // Only when a finger or button is already down — otherwise a mouse
        // hovering the pad would walk the player across the map.
        if (e.pressure > 0 || e.buttons > 0) press();
      });
      for (const type of ["pointerup", "pointerleave", "pointercancel"] as const) {
        el.addEventListener(type, (e) => {
          e.preventDefault();
          release();
        });
      }
      // Stops iPadOS turning a quick double tap on a button into a page zoom.
      el.addEventListener("dblclick", (e) => e.preventDefault());
    });
  }

  /** iPadOS discards backgrounded tabs without warning. Save before it does. */
  private wireLifecycle(): void {
    const flush = () => {
      if (this.running) saveGame(this.state);
    };
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) flush();
    });
    window.addEventListener("pagehide", flush);
  }
}

/* ----------------------------------------------------- interrupt prompts */

function interruptPrompt(i: Interrupt, ctx: ActionCtx): Prompt | null {
  switch (i.kind) {
    case "collapse": {
      const cc = markerPos(townOf(ctx.state), "communityCenter");
      ctx.teleport(cc.x, cc.y);
      return menu(
        "The clinic",
        [
          "You do not remember going down.",
          "A nurse tells you it was dehydration and exhaustion, in that order, and that you were lucky someone called it in.",
          i.cost > 0 ? `They take $${i.cost} off you on the way out.` : "They write you down as unable to pay. It goes on the tab.",
        ],
        [{ label: "Get up" }],
        "bad",
      );
    }

    case "police": {
      if (i.escorted) {
        const dest = escortDestination(townOf(ctx.state), i.zone);
        ctx.teleport(dest.x, dest.y);
      }
      return menu(
        "Officer Jenny",
        i.fine > 0
          ? [
              `"${cap(i.reason)}."`,
              `A citation for $${i.fine}, and she waits while you walk.`,
              i.escorted ? "She watches you all the way to the boundary." : "",
            ].filter(Boolean)
          : [`"${cap(i.reason)}. Move along."`, "No ticket this time."],
        [{ label: i.fine > 0 ? "Take the ticket" : "Move along" }],
        "bad",
      );
    }

    case "sick":
      return say(
        "You don't feel right",
        ["Your head is hot and your joints ache.", "The clinic at the community center can sort it, or cold medicine from the Mart."],
        "bad",
      );

    case "rent":
      return i.paid ? null : say("Notice", [`You couldn't cover $${i.amount} in rent.`, "It goes on the debt, with a late fee."], "bad");

    case "newDay":
      return null;

    case "income":
      return menu("Overnight", i.lines, [{ label: "Good" }], "money");

    case "weather":
      return say("Weather", i.text);

    case "fired":
      return say(
        "Let go",
        [`You are no longer employed at ${EMPLOYMENT[i.job as keyof typeof EMPLOYMENT]?.employer ?? i.job}.`],
        "bad",
      );

    case "victory":
      return victoryPrompt(ctx.state, i.ending);
  }
}

/**
 * Two endings, and they are supposed to sit differently.
 *
 * The estate closes with the bench you slept on, seen from a long way up. The
 * block closes with the same fact from the other side: you did not get out,
 * you got the keys, and somebody else is where you were. Neither is presented
 * as the correct one.
 */
function victoryPrompt(s: GameState, ending: Ending): Prompt {
  const day = s.daysSurvived;
  const nw = netWorth(s);
  const both = s.endings.length > 1;

  const how =
    ending === "block"
      ? "Landlord, St Giles Row"
      : s.mayor && s.businessOwned
        ? "Franchise owner and mayor"
        : s.mayor
          ? "Mayor of Brokemon Town"
          : "Franchise owner";

  const closing =
    ending === "block"
      ? [
          "You keep the fourth-floor room. You could take any of them and you keep that one.",
          "Somebody new moves into the back on the second, and pays you on a Friday,",
          "and you know exactly what the walk to the washhouse costs them.",
        ]
      : [
          "From up here Market Square is about the size of your hand.",
          "The bench is still there. Somebody is on it.",
        ];

  return menu(
    ending === "block" ? "The Block — the door is yours" : "The Apex — you made it out",
    [
      `Day ${day}. ${how}.`,
      `Reputation: ${reputationLabel(reputationIn(s, ending === "block" ? "brokedale" : "brokemon"))}`,
      "",
      `Days on the street: ${day}`,
      `Total earned: $${s.totalEarned.toLocaleString()}`,
      `Times collapsed: ${s.collapses}`,
      `Net worth: $${nw.toLocaleString()}`,
      "",
      ...closing,
      "",
      both
        ? "— You have reached both. There is nothing left to buy and you are still here."
        : "— Keep playing. The other ending is still out there.",
    ],
    [{ label: "Continue" }],
    "good",
  );
}


/* ------------------------------------------------------------ title menu */

function boot(): void {
  const title = document.querySelector<HTMLElement>("#title")!;
  const newBtn = title.querySelector<HTMLButtonElement>("#new-game")!;
  const contBtn = title.querySelector<HTMLButtonElement>("#continue")!;

  contBtn.disabled = !hasSave();
  if (contBtn.disabled) contBtn.title = "No save found";

  const launch = (state: GameState) => {
    const game = new Game(state, title);
    // Surface the opening beat once the loop is running.
    game.start();
    if (state.daysSurvived === 0 && state.log.length === 0) {
      pushLog(state, "Day 1. You wake up on the grass in the park with three dollars.", "system");
    }
  };

  newBtn.addEventListener("click", () => {
    clearSave();
    launch(createState());
  });
  contBtn.addEventListener("click", () => {
    const loaded = loadGame();
    launch(loaded ?? createState());
  });

  document.addEventListener(
    "keydown",
    (e) => {
      if (title.classList.contains("hidden")) return;
      if (e.code === "Enter" || e.code === "Space" || e.code === "KeyZ") {
        e.preventDefault();
        (contBtn.disabled ? newBtn : contBtn).click();
      }
    },
    { once: false },
  );
}

boot();
