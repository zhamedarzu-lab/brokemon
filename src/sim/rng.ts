/**
 * Seeded RNG so a save resumes the same world and tests are deterministic.
 * mulberry32 — small, fast, good enough for deciding whether a stranger
 * gives you a dollar.
 */
export class Rng {
  private s: number;

  constructor(seed = Date.now() >>> 0) {
    this.s = seed >>> 0;
  }

  get seed(): number {
    return this.s;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inclusive on both ends. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick from empty list");
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Weighted pick. Entries with weight <= 0 are ignored. */
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T | null {
    const usable = entries.filter(([, w]) => w > 0);
    const total = usable.reduce((s, [, w]) => s + w, 0);
    if (total <= 0) return null;
    let roll = this.next() * total;
    for (const [item, w] of usable) {
      roll -= w;
      if (roll <= 0) return item;
    }
    return usable[usable.length - 1]![0];
  }

  shuffled<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const a = out[i]!;
      out[i] = out[j]!;
      out[j] = a;
    }
    return out;
  }
}
