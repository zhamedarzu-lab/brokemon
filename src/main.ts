import "./styles.css";

import { Input, type Button } from "./engine/input";
import { CANVAS_H, CANVAS_W, render, screenPushToStep, stepPacing } from "./engine/render";
import { canStep, facingFor } from "./sim/move";
import { interact } from "./sim/actions";

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
import { hasMarker, markerPos } from "./world/map";

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
  /**
   * How the current step is paced, and what it costs.
   *
   * These are two different numbers and used to be one. The step takes as long
   * as it needs to move the player a constant number of *pixels* per second,
   * and it charges as much game time as the *ground* it covers — see the note
   * on `beginStep`.
   */
  private stepAnimScale = 1;
  private stepTimeRate = 1;

  private input: Input;

  private ctx2d: CanvasRenderingContext2D;

  private hud: Hud;

  private dialogue: Dialogue;

  private journal: Journal;

  private queue: Prompt[] = [];

  private stepsTaken = 0;

  private lastFrame = 0;

  private sinceAutosave = 0;

  private running = false;

  private padEl: HTMLElement | null = null;
  private mapBtn: HTMLButtonElement | null = null;

  private padHidden = false;
  private minimapOpen = false;

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
    this.wireMapToggle();
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
    this.mapBtn?.classList.remove("hidden");
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
    render(this.ctx2d, this.state, now, this.minimapOpen);

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

    if (i.justPressed("map")) {
      this.toggleMinimap();
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
      p.moveProgress += dt / (stepMs * this.stepAnimScale);
      this.tick((dt * this.stepTimeRate) / MS_PER_MINUTE, { exertion: 1.35 });
      if (p.moveProgress >= 1) {
        p.moveProgress = 0;
        p.moveFrom = null;
        this.onStepComplete();
      }
      return;
    }

    // What the player asked for is a direction on screen; what the grid needs
    // is a step. In an isometric view those are 45 degrees apart — see
    // `screenPushToStep`, which is the only place that difference lives.
    const push = this.input.heldVector();
    const step = screenPushToStep(push.x, push.y);
    const facing = facingFor(step.x, step.y);
    if (!facing) return;

    p.facing = facing;
    if (s.meters.energy <= 0 && this.rng.chance(0.35)) {
      // Running on empty: you keep stopping.
      return;
    }

    const town = townOf(s);
    let dx = step.x;
    let dy = step.y;
    if (!canStep(town, p.pos, dx, dy)) {
      // Blocked head-on, keep whichever half is clear. With screen-relative
      // controls this is what makes walking into a building slide you along its
      // frontage instead of stopping you dead against it — a single key is a
      // grid diagonal, and both of its halves run along the walls you can see.
      if (dx !== 0 && dy !== 0 && canStep(town, p.pos, dx, 0)) dy = 0;
      else if (dx !== 0 && dy !== 0 && canStep(town, p.pos, 0, dy)) dx = 0;
      else return;
    }

    this.beginStep(dx, dy);
    p.moveFrom = { ...p.pos };
    p.pos = { x: p.pos.x + dx, y: p.pos.y + dy };
    p.moveProgress = 0;
  }

  /**
   * Pace the step by the screen and charge it by the ground.
   *
   * These pulled apart the moment the controls were rotated to the screen. A
   * step is worth 1 or root-two *tiles*, and the clock has to charge that or
   * the map gets cheaper depending on the route you take. But the same step is
   * worth 16 or 32 *pixels*, because the projection squashes the vertical by
   * two to one — so pacing the animation by ground made walking down the screen
   * look like half the speed of walking across it.
   *
   * So: the animation runs for as long as it takes to cover its pixels at one
   * constant rate, and the clock is scaled to spend exactly the game time that
   * step's ground is worth, however long the animation took. Constant apparent
   * speed in every direction, and a minute of walking still buys the same
   * distance whichever way you went — which is what every balance figure in
   * `docs/playtest-findings.md` is denominated in.
   */
  private beginStep(dx: number, dy: number): void {
    const pacing = stepPacing(dx, dy);
    this.stepAnimScale = pacing.animScale;
    this.stepTimeRate = pacing.timeRate;
  }

  private onStepComplete(): void {
    this.stepsTaken += 1;
    this.state.lastMovedTime = this.state.time;

    const police = policeCheck(this.state, this.rng);
    if (police) {
      this.enqueue(interruptPrompt(police, this.actionCtx()));
      this.openNext();
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

    this.wireStick();
  }

  /**
   * The thumbstick.
   *
   * A d-pad can only ask for four directions, and this town's streets run
   * diagonally on screen — so the pad was the control fighting the projection.
   * The stick reports one of eight neighbours, not an angle, because the player
   * still moves a tile at a time; `Input.setStick` does that reduction and the
   * dead zone that makes the thing holdable.
   *
   * It follows the finger from wherever it lands rather than from the centre of
   * the pad, which is what stops your thumb drifting off the control while you
   * are looking at the game instead of at your hand.
   */
  private wireStick(): void {
    const stick = document.querySelector<HTMLElement>("#stick");
    const knob = document.querySelector<HTMLElement>("#stick-knob");
    if (!stick || !knob) return;

    const RADIUS = 42;
    let pointer: number | null = null;
    let origin = { x: 0, y: 0 };

    const move = (dx: number, dy: number) => {
      const mag = Math.hypot(dx, dy);
      const clamp = mag > RADIUS ? RADIUS / mag : 1;
      knob.style.transform = `translate(${dx * clamp}px, ${dy * clamp}px)`;
      this.input.setStick(dx / RADIUS, dy / RADIUS);
    };
    const release = () => {
      pointer = null;
      stick.classList.remove("active");
      knob.style.transform = "";
      this.input.clearStick();
    };

    stick.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pointer = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      stick.classList.add("active");
      origin = { x: e.clientX, y: e.clientY };
      this.input.clearStick();
    });
    stick.addEventListener("pointermove", (e) => {
      if (pointer !== e.pointerId) return;
      e.preventDefault();
      move(e.clientX - origin.x, e.clientY - origin.y);
    });
    // Only a real lift releases the stick. `lostpointercapture` is not one — it
    // fires as a *consequence* of taking the capture on some engines, and
    // treating it as a release killed the drag on its very first frame.
    for (const type of ["pointerup", "pointercancel"] as const) {
      stick.addEventListener(type, (e) => {
        if (pointer !== e.pointerId) return;
        release();
      });
    }
  }

  private toggleMinimap(): void {
    this.minimapOpen = !this.minimapOpen;
    if (this.mapBtn) this.mapBtn.textContent = this.minimapOpen ? "×" : "MAP";
  }

  private wireMapToggle(): void {
    this.mapBtn = document.querySelector<HTMLButtonElement>("#map-toggle");
    this.mapBtn?.addEventListener("click", () => this.toggleMinimap());
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
          "$100 goes on the debt. They hand you a discharge slip and point you to the door.",
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

    case "headInjury": {
      const cc = markerPos(townOf(ctx.state), "communityCenter");
      ctx.teleport(cc.x, cc.y);
      return menu(
        "Emergency Room",
        [
          "You don't remember the fall. Just the sound.",
          "You come round under fluorescent lights with a bag of ice where your head was and a nurse asking if you know what day it is.",
          i.cost > 0
            ? `Emergency treatment: $${i.cost}. They hand you a leaflet about helmets on the way out.`
            : "No cash on you. The bill goes on a ledger somewhere.",
        ],
        [{ label: "Get up slowly" }],
        "bad",
      );
    }

    case "sick":
      // Once. The remedy is not obvious the first time and is not news the
      // fourth; the Log says it every time either way.
      if (ctx.state.flags.seenFever) return null;
      ctx.state.flags.seenFever = 1;
      return say(
        "You don't feel right",
        [
          "Your head is hot and your joints ache.",
          "The clinic at the community center can sort it, or cold medicine off a shelf. It will not clear on its own while you are run down.",
        ],
        "bad",
      );

    case "rent":
      return i.paid ? null : say("Notice", [`You couldn't cover $${i.amount} in rent.`, "It goes on the debt, with a late fee."], "bad");

    case "newDay":
      return null;

    case "income": {
      // Money that arrives while you sleep is worth a box the first time it
      // ever happens, because it is the moment the game changes shape. After
      // that it is a daily interruption saying "Good" — the HUD carries the
      // balance and the Log carries the line.
      if (ctx.state.flags.seenPassiveIncome) return null;
      ctx.state.flags.seenPassiveIncome = 1;
      return menu("Overnight", [...i.lines, "This arrives every night now, and it is in the Log."], [{ label: "Good" }], "money");
    }

    case "weather":
      // The HUD names it, the screen tints for it and the Log records it.
      // A box you dismiss adds nothing to any of that.
      return null;

    case "fired":
      return say(
        "Let go",
        [`You are no longer employed at ${EMPLOYMENT[i.job as keyof typeof EMPLOYMENT]?.employer ?? i.job}.`],
        "bad",
      );

    case "carHit": {
      const town = townOf(ctx.state);
      const dest = hasMarker(town, "hospital")
        ? markerPos(town, "hospital")
        : markerPos(town, "communityCenter");
      ctx.teleport(dest.x, dest.y);
      return menu(
        "A&E",
        [
          "You don't remember the impact. Just the horn, very close, and then the ground.",
          "You wake up on a gurney. A nurse tells you it was a glancing blow — you were lucky.",
          i.cost > 0
            ? `They hand you a discharge form and take $${i.cost}. Less than it could have been.`
            : "The driver stopped. There's nothing to pay. Someone called it in.",
          "Two hours gone, and you are put out of the door in the same state you came in.",
        ],
        [{ label: "Get up carefully" }],
        "bad",
      );
    }

    case "jobExpired":
      return menu(
        "Job Board",
        [
          `"${i.label}" — window closed.`,
          "The board doesn't hold slots. It's already been reassigned to someone else.",
        ],
        [{ label: "Got it" }],
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
