// ART-RENAISSANCE AR-02 — combat VFX for Direction A.
// Two per-frame Graphics (03 §10 budget <= 3 incl. HUD):
//   floor (depth 60): bullet ground ticks, perception / aim lines, reach arcs,
//                      wreck ink, dash drag marks;
//   air   (depth 400): pulse bolts + trails, hostile bolts, muzzle flash, impact ink.
// Visual-only: reads World state, owns its own deterministic visual RNG, never calls
// World.rng or Math.random. All lifetimes advance with the dt that World.update gets.
import Phaser from 'phaser';
import { DEPTH, FX, INK } from './tokens';
import { RNG } from '../../core/random';

export const BOLT_HEIGHT = 26; // px: bolts fly at chest height (sprite origin offset)

interface Impact { x: number; y: number; t: number; life: number; color: number; rays: Array<[number, number, number]>; crit: boolean }
interface Muzzle { x: number; y: number; dx: number; dy: number; t: number }
interface Wreck { x: number; y: number; t: number; w: number; kind: string }
interface Drag { x0: number; y0: number; x1: number; y1: number; t: number }

export interface BoltView { x: number; y: number; vx: number; vy: number; enemy: boolean; kind: string }
export interface TelegraphView { ax: number; ay: number; tx: number; ty: number; strength: number; melee: boolean; reach: number; detect: boolean }

export class CombatVfx {
  readonly floor: Phaser.GameObjects.Graphics;
  readonly air: Phaser.GameObjects.Graphics;
  private impacts: Impact[] = [];
  private muzzles: Muzzle[] = [];
  private wrecks: Wreck[] = [];
  private drags: Drag[] = [];
  private rng: RNG;
  /** Global visual-disturbance switch (03 §10): false hides particles / flashes. */
  enabled = true;

  constructor(private readonly scene: Phaser.Scene, seed: number) {
    this.floor = scene.add.graphics().setDepth(DEPTH.decal);
    this.air = scene.add.graphics().setDepth(DEPTH.fx);
    this.rng = new RNG((seed ^ 0x51ed27) >>> 0);
  }

  get liveParticles(): number {
    return this.impacts.reduce((n, i) => n + i.rays.length, 0) + this.muzzles.length * 3;
  }

  muzzle(x: number, y: number, dx: number, dy: number): void {
    this.muzzles.push({ x, y, dx, dy, t: 0 });
    if (this.muzzles.length > 6) this.muzzles.shift();
  }

  /** Bullet hit: ink debris rays (3..6), white flash, survey hit brackets. */
  impact(x: number, y: number, color: number, crit = false, count = 4): void {
    if (this.liveParticles > FX.maxLiveParticles) return;
    const n = Math.max(3, Math.min(FX.maxParticlesPerHit, count));
    const rays: Array<[number, number, number]> = [];
    for (let i = 0; i < n; i++) {
      const a = this.rng.float() * Math.PI * 2;
      rays.push([Math.cos(a), Math.sin(a) * 0.6, 6 + this.rng.float() * 8]);
    }
    this.impacts.push({ x, y, t: 0, life: 0.26, color, rays, crit });
  }

  wreck(x: number, y: number, w: number, kind: string): void {
    this.wrecks.push({ x, y, t: 0, w, kind });
    if (this.wrecks.length > 24) this.wrecks.shift();
  }

  drag(x0: number, y0: number, x1: number, y1: number): void {
    this.drags.push({ x0, y0, x1, y1, t: 0 });
    if (this.drags.length > 8) this.drags.shift();
  }

  update(dt: number, bolts: BoltView[], telegraphs: TelegraphView[]): void {
    const f = this.floor, a = this.air;
    f.clear(); a.clear();

    // ---- floor: wrecks (solid 2 s = "observed", then dotted = "history", 03 §8)
    this.wrecks = this.wrecks.filter((w) => (w.t += dt) < 3.4);
    for (const w of this.wrecks) {
      const hist = w.t > 2;
      const alpha = hist ? 0.45 * (1 - (w.t - 2) / 1.4) : 0.55;
      const hw = w.w * 0.5;
      if (hist) {
        f.fillStyle(INK.known, alpha);
        for (let k = -hw; k <= hw; k += 4) f.fillRect(w.x + k - 0.6, w.y - 0.6 - Math.abs(k) * 0.25, 1.2, 1.2);
      } else {
        f.lineStyle(1, INK.known, alpha);
        f.beginPath(); f.moveTo(w.x - hw, w.y); f.lineTo(w.x - hw * 0.3, w.y - 4); f.lineTo(w.x + hw * 0.4, w.y - 2); f.lineTo(w.x + hw, w.y + 1); f.strokePath();
        f.lineBetween(w.x - hw * 0.6, w.y + 3, w.x + hw * 0.2, w.y + 4);
      }
      // extinguished aperture -> grey dot
      f.fillStyle(0x6a6e72, hist ? alpha : 0.9); f.fillCircle(w.x + 2, w.y - 3, 1.8);
      f.lineStyle(1, INK.known, alpha * 0.8);
      f.lineBetween(w.x + hw + 3, w.y - 6, w.x + hw + 12, w.y - 12);
    }

    // ---- floor: dash drag marks
    this.drags = this.drags.filter((d) => (d.t += dt) < 0.45);
    for (const d of this.drags) {
      f.lineStyle(2, INK.known, 0.28 * (1 - d.t / 0.45));
      f.lineBetween(d.x0, d.y0, d.x1, d.y1);
    }

    // ---- floor: hostile perception / aim / reach (vermilion ONLY here and on shots)
    for (const t of telegraphs) {
      if (t.strength <= 0) continue;
      if (t.melee) {
        // reach arc on the ground, centred on the hostile, facing the target
        const ang = Math.atan2((t.ty - t.ay) * 2, t.tx - t.ax);
        f.lineStyle(1.5, INK.hostile, 0.25 + 0.55 * t.strength);
        const r = t.reach;
        f.beginPath();
        for (let i = 0; i <= 10; i++) {
          const q = ang - 0.7 + (1.4 * i) / 10;
          const px = t.ax + Math.cos(q) * r, py = t.ay + Math.sin(q) * r * 0.5;
          if (i % 2 === 0) f.moveTo(px, py); else f.lineTo(px, py);
        }
        f.strokePath();
      } else {
        // dashed line aperture -> target; dash density increases as the shot nears
        const dx = t.tx - t.ax, dy = t.ty - t.ay;
        const len = Math.hypot(dx, dy) || 1;
        const seg = t.detect ? 6 : 9, gap = t.detect ? 7 : Math.max(2, 7 - 5 * t.strength);
        const ux = dx / len, uy = dy / len;
        // 02 §1.8: hostile perception = vermilion dashed line (thin while only detecting).
        f.lineStyle(t.detect ? 1 : 1.4, INK.hostile, t.detect ? 0.4 : 0.35 + 0.6 * t.strength);
        for (let s = 0; s < len; s += seg + gap) {
          const e = Math.min(len, s + seg);
          f.lineBetween(t.ax + ux * s, t.ay + uy * s, t.ax + ux * e, t.ay + uy * e);
        }
        if (!t.detect) {
          // target reticle ticks at the end of the line
          f.lineStyle(1.2, INK.hostile, 0.5 + 0.5 * t.strength);
          const r = 7 - 3 * t.strength;
          f.lineBetween(t.tx - r - 4, t.ty, t.tx - r, t.ty); f.lineBetween(t.tx + r, t.ty, t.tx + r + 4, t.ty);
          f.lineBetween(t.tx, t.ty - r - 4, t.tx, t.ty - r); f.lineBetween(t.tx, t.ty + r, t.tx, t.ty + r + 4);
        }
      }
    }

    // ---- bolts: ground tick (floor) + bolt + trail (air)
    for (const b of bolts) {
      f.fillStyle(INK.ao, 0.55); f.fillEllipse(b.x, b.y, 7, 3);
      const len = Math.hypot(b.vx, b.vy) || 1;
      const ux = b.vx / len, uy = b.vy / len;
      const hx = b.x, hy = b.y - BOLT_HEIGHT;
      if (b.enemy) {
        a.lineStyle(4, INK.shadow, 0.7); a.lineBetween(hx, hy, hx - ux * 12, hy - uy * 12);
        a.lineStyle(2.2, INK.hostile, 0.95); a.lineBetween(hx, hy, hx - ux * 12, hy - uy * 12);
      } else {
        const tl = b.kind === 'plasma' ? 18 : 30;
        a.lineStyle(5, INK.interact, 0.12); a.lineBetween(hx, hy, hx - ux * tl * 1.4, hy - uy * tl * 1.4);
        a.lineStyle(3, INK.known, 0.45); a.lineBetween(hx, hy, hx - ux * tl, hy - uy * tl);
        a.lineStyle(1.4, INK.priority, 1); a.lineBetween(hx, hy, hx - ux * tl * 0.55, hy - uy * tl * 0.55);
      }
    }
    if (!this.enabled) { this.impacts = []; this.muzzles = []; return; }

    // ---- air: muzzle flash (1-2 frames, bone)
    this.muzzles = this.muzzles.filter((m) => (m.t += dt) < 0.05);
    for (const m of this.muzzles) {
      const px = -m.dy, py = m.dx;
      a.fillStyle(INK.priority, 0.95); a.fillCircle(m.x, m.y, 3);
      a.lineStyle(2, INK.known, 0.9);
      a.lineBetween(m.x, m.y, m.x + m.dx * 11, m.y + m.dy * 11);
      a.lineStyle(1.2, INK.known, 0.7);
      a.lineBetween(m.x, m.y, m.x + (m.dx + px) * 5, m.y + (m.dy + py) * 5);
      a.lineBetween(m.x, m.y, m.x + (m.dx - px) * 5, m.y + (m.dy - py) * 5);
    }

    // ---- air: impacts (flash 60 ms, rays, brackets)
    this.impacts = this.impacts.filter((i) => (i.t += dt) < i.life);
    for (const i of this.impacts) {
      const k = i.t / i.life;
      if (i.t < 0.06) { a.fillStyle(INK.priority, 0.85); a.fillCircle(i.x, i.y, i.crit ? 7 : 5); }
      a.lineStyle(1.2, i.color, 1 - k);
      for (const [rx, ry, l] of i.rays) {
        const s0 = 3 + k * l, s1 = s0 + 4;
        a.lineBetween(i.x + rx * s0, i.y + ry * s0, i.x + rx * s1, i.y + ry * s1);
      }
      if (i.crit || k < 0.5) {
        const r = 6 + k * 6, c = 3;
        a.lineStyle(1, INK.priority, 0.9 * (1 - k));
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          a.lineBetween(i.x + sx * r, i.y + sy * r, i.x + sx * (r - c), i.y + sy * r);
          a.lineBetween(i.x + sx * r, i.y + sy * r, i.x + sx * r, i.y + sy * (r - c));
        }
      }
    }
  }

  destroy(): void { this.floor.destroy(); this.air.destroy(); }
}
