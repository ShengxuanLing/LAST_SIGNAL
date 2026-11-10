// Deterministic PRNG (Mulberry32). Given a seed, produces the same sequence.
// Critical for reproducible procedural map generation.

export class RNG {
  private state: number;

  constructor(seed: number) {
    this.state = this._hashSeed(seed);
  }

  static fromSeed(seed: number): RNG {
    return new RNG(seed);
  }

  private _hashSeed(seed: number): number {
    // SplitMix64-style finalizer to disperse low-entropy seeds.
    let z = (seed >>> 0) + 0x9e3779b97f4a7c15 >>> 0;
    z = (z ^ (z >>> 30)) * 0xbf58476d1ce4e5b9 >>> 0;
    z = (z ^ (z >>> 27)) * 0x94d049bb133111eb >>> 0;
    return (z ^ (z >>> 31)) >>> 0;
  }

  private _next(): number {
    // Mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this._next() / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) [min, max] = [max, min];
    const range = max - min + 1;
    return min + Math.floor(this._next() / 4294967296 * range);
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  boolean(prob: number): boolean {
    return this.float() < prob;
  }

  pick<T>(items: T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  pickWeighted<T>(items: { item: T; weight: number }[]): T {
    let total = 0;
    for (const it of items) total += it.weight;
    let r = this.float() * total;
    for (const it of items) {
      r -= it.weight;
      if (r <= 0) return it.item;
    }
    return items[items.length - 1].item;
  }

  shuffle<T>(arr: T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Reset to a specific seed without constructing a new object. */
  seed(seed: number): void {
    this.state = this._hashSeed(seed);
  }
}

export const TAU = Math.PI * 2;

export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d < -Math.PI) d += TAU;
  if (d > Math.PI) d -= TAU;
  return d;
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function distSq(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

export function normalize(a: { x: number; y: number }): { x: number; y: number } {
  const len = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / len, y: a.y / len };
}

export function unit(angle: number): { x: number; y: number } {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDiff(a, b) * t;
}

export function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

export function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

export function nowMs(): number {
  return performance.now();
}
