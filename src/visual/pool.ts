// ART-02 fixed-capacity pools. Pure, allocation-free after construction, so
// effect bursts can never grow memory without bound.

export interface Particle {
  alive: boolean;
  x: number; y: number;      // screen px
  vx: number; vy: number;    // px / s
  ay: number;                // px / s^2 (gravity-like, can be negative)
  life: number; maxLife: number; // s
  size: number;
  color: number;
  alpha: number;
  /** 0 = dot, 1 = streak (drawn along velocity). */
  shape: 0 | 1;
}

export class ParticlePool {
  readonly items: Particle[];
  private cursor = 0;
  private liveCount = 0;
  private limit: number;

  constructor(readonly capacity: number) {
    this.items = Array.from({ length: capacity }, () => ({
      alive: false, x: 0, y: 0, vx: 0, vy: 0, ay: 0, life: 0, maxLife: 1, size: 1, color: 0xffffff, alpha: 1, shape: 0 as const,
    }));
    this.limit = capacity;
  }

  get live(): number { return this.liveCount; }

  /** Lower the active cap at runtime (quality change). Excess particles die. */
  setLimit(limit: number): void {
    this.limit = Math.max(0, Math.min(this.capacity, Math.floor(limit)));
    if (this.liveCount <= this.limit) return;
    for (const p of this.items) {
      if (this.liveCount <= this.limit) break;
      if (p.alive) { p.alive = false; this.liveCount--; }
    }
  }

  /** Returns the particle or null when the cap is reached (burst is clipped, never queued). */
  spawn(init: Omit<Particle, 'alive' | 'life'> & { life?: number }): Particle | null {
    if (this.liveCount >= this.limit) return null;
    for (let i = 0; i < this.capacity; i++) {
      const idx = (this.cursor + i) % this.capacity;
      const p = this.items[idx];
      if (p.alive) continue;
      this.cursor = (idx + 1) % this.capacity;
      Object.assign(p, init);
      p.life = init.life ?? init.maxLife;
      p.alive = true;
      this.liveCount++;
      return p;
    }
    return null;
  }

  step(dt: number): void {
    for (const p of this.items) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; this.liveCount--; continue; }
      p.vy += p.ay * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  clear(): void {
    for (const p of this.items) p.alive = false;
    this.liveCount = 0;
  }
}

/** Bounded list of timed effects; the oldest is evicted when full. */
export class EffectList<T extends { age: number; duration: number }> {
  readonly items: T[] = [];
  constructor(private cap: number) {}

  setCap(cap: number): void {
    this.cap = Math.max(0, cap);
    while (this.items.length > this.cap) this.items.shift();
  }

  push(effect: T): void {
    if (this.cap === 0) return;
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push(effect);
  }

  step(dt: number): void {
    for (const e of this.items) e.age += dt;
    let w = 0;
    for (let r = 0; r < this.items.length; r++) {
      if (this.items[r].age < this.items[r].duration) this.items[w++] = this.items[r];
    }
    this.items.length = w;
  }

  clear(): void { this.items.length = 0; }
}

/** Deterministic visual-only RNG (mulberry32). Never shared with gameplay RNG. */
export function visualRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
