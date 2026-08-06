/**
 * A prompt is one screen of dialogue plus optional choices. Choices return
 * the next prompt, or null to close the box and give the player back control.
 */

export interface Choice {
  label: string;
  /** Right-aligned hint — a price, a duration, a payout. */
  hint?: string;
  /** If set, the choice renders greyed out and says why when selected. */
  locked?: string;
  run?: () => Prompt | null;
}

export interface Prompt {
  /** Who is talking, or what you're standing in front of. */
  title: string;
  lines: string[];
  choices?: Choice[];
  /** Tints the box — used for police, illness, payouts. */
  tone?: "plain" | "good" | "bad" | "money";
}

export function say(title: string, lines: string | string[], tone: Prompt["tone"] = "plain"): Prompt {
  return { title, lines: Array.isArray(lines) ? lines : [lines], tone };
}

export function menu(title: string, lines: string[], choices: Choice[], tone: Prompt["tone"] = "plain"): Prompt {
  return { title, lines, choices, tone };
}

/** A choice that just shows another line of dialogue and then closes. */
export function tell(label: string, title: string, lines: string | string[], tone?: Prompt["tone"]): Choice {
  return { label, run: () => say(title, lines, tone) };
}

export const BACK: Choice = { label: "Leave" };
