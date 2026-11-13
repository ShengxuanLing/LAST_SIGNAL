// ART-02 Station Zero visual layer.
//
// Contract with the host scene (see docs/art/ART_02_FINAL_REPORT.md §Integration):
//   * reads ONLY the immutable `SliceSnapshot` the scene already produces;
//   * never calls SliceModel, never touches ticks, RNG, input, saves or HUD DOM;
//   * owns every Phaser object/texture it creates and releases them in destroy().
// Quality `off` leaves the original renderer untouched (used for before/after).
import Phaser from 'phaser';
import type { SliceSnapshot, DoorState } from '../slice/rules';
import type { BridgeState } from '../slice/corridor';
import { SLICE } from '../slice/tuning';
import { ROOM } from '../slice/room';
import { CORRIDOR } from '../slice/corridorRoom';
import { SIGNAL, MATERIAL, mix } from './palette';
import { QUALITY, FrameGovernor, lowerTier, resolveQuality, QUALITY_STORAGE_KEY, type QualityProfile, type VisualQuality } from './quality';
import { THEMES, type RoomId, type Pt, type RoomTheme } from './themes';
import { EnvironmentBaker, bakeBackdrop, bakeGlow, bakeVignette, type RoomGeometry } from './EnvironmentBaker';
import { diffSnapshots, playerPos, revealFreshness, type SignalEvent } from './signalEvents';
import { EffectList, ParticlePool, visualRng } from './pool';
import { isoEllipse, lerpPt, makeProjector, prismFaces, rectAt, type Projector } from './iso2d';

export interface SliceVisualHost {
  readonly scene: Phaser.Scene;
  /** World cell coords -> screen px, as the host scene draws (includes room scale/offset). */
  project(x: number, y: number): Pt;
  /** Current room scale used by the host projection. */
  roomScale(): number;
  /** Original renderer objects, hidden while the art layer is active. */
  readonly legacy: readonly { setVisible(v: boolean): unknown }[];
  /** Geometry of the active room (read-only; same tables the rules use). */
  geometry(room: RoomId): RoomGeometry;
}

type Effect =
  | { kind: 'scan'; origin: Pt; age: number; duration: number }
  | { kind: 'ping'; at: Pt; z: number; delay: number; color: number; age: number; duration: number }
  | { kind: 'beam'; from: Pt; fromZ: number; to: Pt; toZ: number; age: number; duration: number }
  | { kind: 'flash'; at: Pt; z: number; color: number; radius: number; age: number; duration: number }
  | { kind: 'sweep'; color: number; age: number; duration: number };

const W = 1280;
const H = 720;
const GLOW_SIZE = 128;
const TEX = {
  backdrop: 'art02:backdrop',
  vignette: 'art02:vignette',
  hurt: 'art02:vignette:hurt',
  env: (room: RoomId, q: VisualQuality) => `art02:env:${room}:${q}`,
  glow: (c: number) => `art02:glow:${c.toString(16)}`,
};

const DOOR_LEAF = { x0: 7.1, x1: 7.9, y0: 4, y1: 6 };
const LINTEL_Z = 34;
const RELAY_Z = 24;
const GUARD_Z = 26;

export interface Art02Stats {
  quality: VisualQuality;
  forced: boolean;
  room: RoomId | null;
  textures: number;
  particles: number;
  effects: number;
  lights: number;
  objects: number;
  fps: number;
  events: number;
  degradations: number;
}

declare global {
  interface Window {
    __art02?: Art02Stats & { setQuality(q: VisualQuality): void };
  }
}

function readStoredQuality(): string | null {
  try { return localStorage.getItem(QUALITY_STORAGE_KEY); } catch { return null; }
}

export class SliceVisuals {
  private q: QualityProfile;
  private forced: boolean;
  private room: RoomId | null = null;
  private prev: SliceSnapshot | null = null;
  private clock = 0;
  private frame = 0;
  private hurt = 0;
  private hitFlash = 0;
  private eventCount = 0;
  private degradations = 0;
  private fpsAvg = 60;
  private readonly governor = new FrameGovernor();

  private backdrop: Phaser.GameObjects.Image | null = null;
  private env: Phaser.GameObjects.Image | null = null;
  private vignette: Phaser.GameObjects.Image | null = null;
  private hurtImg: Phaser.GameObjects.Image | null = null;
  private fxFloor: Phaser.GameObjects.Graphics | null = null;
  private fxTop: Phaser.GameObjects.Graphics | null = null;
  private lights: Phaser.GameObjects.Image[] = [];
  private lightCursor = 0;
  private readonly particles = new ParticlePool(QUALITY.high.maxParticles);
  private readonly dust = new ParticlePool(QUALITY.high.ambientDust);
  private readonly effects = new EffectList<Effect>(QUALITY.high.maxEffects);
  private P: Projector = (x, y) => ({ x, y });
  private scale = 1;
  private destroyed = false;

  constructor(private readonly host: SliceVisualHost) {
    const search = typeof location !== 'undefined' ? location.search : '';
    const resolved = resolveQuality(search, readStoredQuality());
    this.q = QUALITY[resolved.quality];
    this.forced = resolved.forced;
    this.applyQuality();
    this.publishStats();
  }

  get quality(): VisualQuality { return this.q.id; }

  setQuality(q: VisualQuality): void {
    if (this.destroyed || q === this.q.id) return;
    this.q = QUALITY[q];
    this.forced = true;
    this.applyQuality();
    if (this.room) this.onRoomLayout(this.room);
  }

  /** Call after the host (re)computes its projection for a room. */
  onRoomLayout(room: RoomId): void {
    if (this.destroyed) return;
    const changed = this.room !== room;
    this.room = room;
    this.scale = this.host.roomScale();
    this.P = makeProjector((x, y) => this.host.project(x, y), this.scale);
    for (const l of this.host.legacy) l.setVisible(this.q.id === 'off');
    this.releaseRoom();
    if (this.q.id === 'off') { this.publishStats(); return; }
    this.ensureShared();
    const scene = this.host.scene;
    const key = TEX.env(room, this.q.id);
    const tex = scene.textures.createCanvas(key, W, H);
    if (tex) {
      const ctx = tex.getContext();
      new EnvironmentBaker(ctx, this.P, this.scale, this.host.geometry(room), THEMES[room], this.q).bake();
      tex.refresh();
      this.env = scene.add.image(0, 0, key).setOrigin(0, 0).setDepth(5);
    }
    this.fxFloor = scene.add.graphics().setDepth(30);
    this.fxTop = scene.add.graphics().setDepth(1500);
    if (changed) { this.particles.clear(); this.effects.clear(); }
    this.dust.clear();
    this.publishStats();
  }

  /** Per-frame presentation update from a read-only snapshot. */
  update(s: SliceSnapshot, deltaMs: number): void {
    if (this.destroyed) return;
    const events = diffSnapshots(this.prev, s);
    this.prev = s;
    if (this.q.id === 'off' || !this.fxFloor || !this.fxTop) { this.publishStats(); return; }
    const dt = s.paused ? 0 : Math.min(0.1, Math.max(0, deltaMs / 1000));
    this.clock += dt;
    this.frame++;
    if (deltaMs > 0) this.fpsAvg = this.fpsAvg * 0.95 + (1000 / deltaMs) * 0.05;
    if (!this.forced && !s.paused && this.governor.push(deltaMs)) this.degrade();
    for (const e of events) this.onEvent(e, s);
    this.particles.step(dt);
    this.dust.step(dt);
    this.effects.step(dt);
    this.hurt = Math.max(0, this.hurt - dt * 1.8);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);

    this.fxFloor.clear();
    this.fxTop.clear();
    this.lightCursor = 0;
    this.drawAmbient(THEMES[this.room ?? 'lab']);
    if (s.corridor) this.drawCorridor(s);
    else this.drawLab(s);
    this.drawEffects();
    this.spawnDust(s);
    this.drawParticles();
    for (let i = this.lightCursor; i < this.lights.length; i++) this.lights[i].setVisible(false);
    if (this.hurtImg) this.hurtImg.setAlpha(this.hurt * 0.85).setVisible(this.hurt > 0.01);
    this.publishStats();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.releaseRoom();
    this.backdrop?.destroy();
    this.vignette?.destroy();
    this.hurtImg?.destroy();
    this.backdrop = this.vignette = this.hurtImg = null;
    const tm = this.host.scene.textures;
    for (const key of tm.getTextureKeys()) if (key.startsWith('art02:')) tm.remove(key);
    this.particles.clear();
    this.dust.clear();
    this.effects.clear();
    for (const l of this.host.legacy) l.setVisible(true);
    if (typeof window !== 'undefined' && window.__art02) delete window.__art02;
  }

  // ------------------------------------------------------------ lifecycle

  private applyQuality(): void {
    this.particles.setLimit(this.q.maxParticles);
    this.dust.setLimit(this.q.ambientDust);
    this.effects.setCap(this.q.maxEffects);
    if (typeof document !== 'undefined') document.body.dataset.art02Quality = this.q.id;
    if (this.q.id === 'off') {
      this.backdrop?.setVisible(false);
      this.vignette?.setVisible(false);
    }
  }

  private degrade(): void {
    const next = lowerTier(this.q.id);
    if (next === this.q.id) return;
    this.degradations++;
    this.q = QUALITY[next];
    this.applyQuality();
    if (this.room) this.onRoomLayout(this.room);
  }

  private ensureShared(): void {
    const scene = this.host.scene;
    const tm = scene.textures;
    const canvas = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void => {
      if (tm.exists(key)) return;
      const t = tm.createCanvas(key, w, h);
      if (!t) return;
      draw(t.getContext());
      t.refresh();
    };
    canvas(TEX.backdrop, W, H, (ctx) => bakeBackdrop(ctx, W, H, 0x5e_0001, this.q.id !== 'low'));
    canvas(TEX.vignette, W, H, (ctx) => bakeVignette(ctx, W, H, MATERIAL.void, 0.62));
    canvas(TEX.hurt, W, H, (ctx) => bakeVignette(ctx, W, H, SIGNAL.hostile, 0.55));
    if (!this.backdrop) this.backdrop = scene.add.image(0, 0, TEX.backdrop).setOrigin(0, 0).setDepth(-99);
    if (!this.vignette) this.vignette = scene.add.image(0, 0, TEX.vignette).setOrigin(0, 0).setDepth(3000);
    if (!this.hurtImg) this.hurtImg = scene.add.image(0, 0, TEX.hurt).setOrigin(0, 0).setDepth(3001).setVisible(false);
    this.backdrop.setVisible(true);
    this.vignette.setVisible(true).setAlpha(0.55 + (this.room ? THEMES[this.room].config.fogDensity : 0.2));
  }

  private releaseRoom(): void {
    this.env?.destroy();
    this.fxFloor?.destroy();
    this.fxTop?.destroy();
    this.env = null;
    this.fxFloor = this.fxTop = null;
    for (const l of this.lights) l.destroy();
    this.lights = [];
    const tm = this.host.scene.textures;
    for (const key of tm.getTextureKeys()) if (key.startsWith('art02:env:')) tm.remove(key);
  }

  private publishStats(): void {
    if (typeof window === 'undefined') return;
    const tm = this.host.scene.textures;
    const stats: Art02Stats = {
      quality: this.q.id,
      forced: this.forced,
      room: this.room,
      textures: tm.getTextureKeys().filter((k) => k.startsWith('art02:')).length,
      particles: this.particles.live + this.dust.live,
      effects: this.effects.items.length,
      lights: this.lights.length,
      objects: [this.backdrop, this.env, this.vignette, this.hurtImg, this.fxFloor, this.fxTop].filter(Boolean).length + this.lights.length,
      fps: Math.round(this.fpsAvg),
      events: this.eventCount,
      degradations: this.degradations,
    };
    window.__art02 = Object.assign(stats, { setQuality: (q: VisualQuality) => this.setQuality(q) });
  }

  // ------------------------------------------------------------ events

  private onEvent(e: SignalEvent, s: SliceSnapshot): void {
    this.eventCount++;
    const fx = this.effects;
    switch (e.type) {
      case 'roomChanged':
        this.effects.clear();
        this.particles.clear();
        break;
      case 'scan': {
        fx.push({ kind: 'scan', origin: e.origin, age: 0, duration: 1.2 });
        for (const h of e.hits) {
          const d = Math.hypot(h.at.x - e.origin.x, h.at.y - e.origin.y);
          const z = h.id === 'sealSource' || h.id === 'doorReceiver' ? LINTEL_Z : h.id === 'relay' ? RELAY_Z : h.id === 'perceptionPort' ? GUARD_Z : 4;
          fx.push({ kind: 'ping', at: h.at, z, delay: Math.min(0.7, (d / SLICE.SCAN_RADIUS) * 0.7), color: SIGNAL.observe, age: 0, duration: 1.6 });
        }
        break;
      }
      case 'jam': {
        const toZ = e.target === 'doorReceiver' ? LINTEL_Z : e.target === 'relay' ? RELAY_Z : GUARD_Z;
        fx.push({ kind: 'beam', from: e.origin, fromZ: 18, to: e.at, toZ, age: 0, duration: 0.55 });
        fx.push({ kind: 'flash', at: e.at, z: toZ, color: SIGNAL.jammed, radius: 0.9, age: 0, duration: 0.6 });
        this.burst(e.at, toZ, SIGNAL.jammed, 14, 70);
        break;
      }
      case 'door':
        if (e.to === 'SEALED' || e.to === 'CLOSED') this.burst({ x: 7.95, y: 5 }, 14, SIGNAL.unstableHi, 10, 50);
        fx.push({ kind: 'flash', at: { x: 7.5, y: 5 }, z: 16, color: this.doorColor(e.to), radius: 0.8, age: 0, duration: 0.5 });
        break;
      case 'relaySwitch':
        fx.push({ kind: 'flash', at: e.at, z: RELAY_Z, color: SIGNAL.protocol, radius: 0.6, age: 0, duration: 0.45 });
        break;
      case 'bridge':
        if (e.from === 'UNSTABLE' && e.to === 'STABLE') fx.push({ kind: 'sweep', color: SIGNAL.feedHi, age: 0, duration: 0.7 });
        if (e.to === 'STABLE' && e.from === 'TRANSITIONING') fx.push({ kind: 'sweep', color: SIGNAL.feed, age: 0, duration: 0.6 });
        if (e.from === 'UNSTABLE' && e.to === 'UNAVAILABLE') this.collapse();
        break;
      case 'guardHit':
        this.hitFlash = 1;
        this.burst(e.at, GUARD_Z - 6, e.cleared ? SIGNAL.unstableHi : SIGNAL.observe, e.cleared ? 34 : 12, e.cleared ? 140 : 90);
        if (e.cleared) fx.push({ kind: 'flash', at: e.at, z: GUARD_Z - 6, color: SIGNAL.unstable, radius: 1.2, age: 0, duration: 0.7 });
        if (this.q.cameraFeedback) this.host.scene.cameras.main.shake(90, e.cleared ? 0.006 : 0.003);
        break;
      case 'playerHurt':
        this.hurt = Math.min(1, this.hurt + (e.rescued ? 1 : 0.6));
        if (this.q.cameraFeedback) this.host.scene.cameras.main.shake(140, e.rescued ? 0.008 : 0.004);
        break;
      default:
        break;
    }
    void s;
  }

  // ------------------------------------------------------------ helpers

  private light(at: Pt, z: number, color: number, radiusWorld: number, alpha: number): void {
    if (!this.q.lights || alpha <= 0.01) return;
    const scene = this.host.scene;
    const key = TEX.glow(color);
    if (!scene.textures.exists(key)) {
      const t = scene.textures.createCanvas(key, GLOW_SIZE, GLOW_SIZE);
      if (!t) return;
      bakeGlow(t.getContext(), GLOW_SIZE, color);
      t.refresh();
    }
    let img = this.lights[this.lightCursor];
    if (!img) {
      if (this.lights.length >= 40) return;
      img = scene.add.image(0, 0, key).setBlendMode(Phaser.BlendModes.ADD).setDepth(20);
      this.lights.push(img);
    }
    this.lightCursor++;
    const p = this.P(at.x, at.y, z);
    const e = isoEllipse(radiusWorld, this.scale);
    if (img.texture.key !== key) img.setTexture(key);
    img.setVisible(true).setPosition(p.x, p.y).setAlpha(Math.min(1, alpha))
      .setDisplaySize(e.rx * 2, e.ry * 2.6);
  }

  private burst(at: Pt, z: number, color: number, n: number, speed: number): void {
    const p = this.P(at.x, at.y, z);
    const r = visualRng(this.frame * 7919 + n);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const v = speed * (0.4 + r() * 0.8);
      this.particles.spawn({
        x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 30, ay: 160,
        maxLife: 0.35 + r() * 0.45, size: 1.2 + r() * 1.6, color, alpha: 1, shape: 1,
      });
    }
  }

  private collapse(): void {
    const r = visualRng(this.frame * 104729);
    const { left, right, top, bottom } = CORRIDOR.bridge;
    for (let i = 0; i < 40; i++) {
      const p = this.P(left + r() * (right - left), top + r() * (bottom - top), 0);
      this.particles.spawn({
        x: p.x, y: p.y, vx: (r() - 0.5) * 40, vy: 10 + r() * 30, ay: 260,
        maxLife: 0.9 + r() * 0.6, size: 2 + r() * 3, color: r() < 0.3 ? SIGNAL.unstable : MATERIAL.steelLit, alpha: 1, shape: 0,
      });
    }
  }

  private spawnDust(s: SliceSnapshot): void {
    if (s.paused) return;
    const room = this.room ?? 'lab';
    const theme = THEMES[room];
    const g = this.host.geometry(room);
    const want = Math.round(this.q.ambientDust * (0.5 + theme.config.particleDensity));
    const r = visualRng(this.frame * 31 + 7);
    let guard = 4;
    while (this.dust.live < Math.min(want, this.q.ambientDust) && guard-- > 0) {
      const x = 1 + r() * (g.width - 2);
      const y = 1 + r() * (g.height - 2);
      const chasm = g.tileAt(Math.floor(x), Math.floor(y)) === 'chasm';
      const p = this.P(x, y, chasm ? -40 : 10 + r() * 50);
      this.dust.spawn({
        x: p.x, y: p.y, vx: (r() - 0.5) * 6, vy: chasm ? -22 - r() * 18 : -3 - r() * 4, ay: 0,
        maxLife: 3 + r() * 4, size: chasm ? 1.6 : 1.1, color: chasm ? SIGNAL.feed : MATERIAL.plateText, alpha: chasm ? 0.4 : 0.22, shape: 0,
      });
    }
  }

  private drawParticles(): void {
    const g = this.fxTop!;
    for (const pool of [this.dust, this.particles]) {
      for (const p of pool.items) {
        if (!p.alive) continue;
        const t = p.life / p.maxLife;
        const a = p.alpha * (pool === this.dust ? Math.min(1, t * 3) * Math.min(1, (1 - t) * 4) : t);
        if (p.shape === 1) {
          g.lineStyle(p.size, p.color, a);
          g.lineBetween(p.x, p.y, p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        } else {
          g.fillStyle(p.color, a);
          g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
      }
    }
  }

  private isoRing(g: Phaser.GameObjects.Graphics, at: Pt, z: number, r: number, width: number, color: number, alpha: number): void {
    const c = this.P(at.x, at.y, z);
    const e = isoEllipse(r, this.scale);
    g.lineStyle(width, color, alpha);
    g.strokeEllipse(c.x, c.y, e.rx * 2, e.ry * 2);
  }

  private arc(g: Phaser.GameObjects.Graphics, at: Pt, z: number, r: number, frac: number, color: number, alpha: number, width = 2): void {
    if (frac <= 0) return;
    const c = this.P(at.x, at.y, z);
    const e = isoEllipse(r, this.scale);
    g.lineStyle(width, color, alpha);
    g.beginPath();
    const n = Math.max(4, Math.ceil(40 * frac));
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i / n) * frac * Math.PI * 2;
      const x = c.x + Math.cos(a) * e.rx;
      const y = c.y + Math.sin(a) * e.ry;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokePath();
  }

  /** Signal line with an explicit style: flowing pulses, static dashes, or broken interference. */
  private signalLine(
    g: Phaser.GameObjects.Graphics, a: Pt, b: Pt, color: number, alpha: number,
    style: 'flow' | 'dashed' | 'broken', breakAt = 0.7,
  ): void {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) return;
    if (style === 'dashed') {
      const n = Math.max(2, Math.floor(len / 9));
      // Dormant links must stay legible on dark floors: lift toward the HUD grey.
      g.lineStyle(1.6, color === SIGNAL.dormant ? 0x8fb8c8 : color, alpha * 0.85);
      for (let i = 0; i < n; i += 2) g.lineBetween(...this.seg(a, b, i / n, (i + 1) / n));
      return;
    }
    if (style === 'broken') {
      g.lineStyle(2, color, alpha * 0.55);
      g.lineBetween(...this.seg(a, b, 0, breakAt));
      // Interference: jagged segment that re-rolls every frame.
      const r = visualRng(this.frame * 13 + Math.floor(a.x));
      g.lineStyle(1.6, SIGNAL.jammed, alpha);
      g.beginPath();
      const steps = 7;
      for (let i = 0; i <= steps; i++) {
        const p = lerpPt(a, b, breakAt + (1 - breakAt) * (i / steps));
        const jx = (r() - 0.5) * 9;
        const jy = (r() - 0.5) * 9;
        if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x + jx, p.y + jy);
      }
      g.strokePath();
      return;
    }
    g.lineStyle(4, color, alpha * 0.16);
    g.lineBetween(a.x, a.y, b.x, b.y);
    g.lineStyle(1.4, color, alpha * 0.75);
    g.lineBetween(a.x, a.y, b.x, b.y);
    // Pulses travel source -> sink: direction is part of the meaning.
    const n = Math.max(2, Math.round(len / 38));
    for (let i = 0; i < n; i++) {
      const t = ((this.clock * 0.9) + i / n) % 1;
      const p = lerpPt(a, b, t);
      g.fillStyle(mix(color, 0xffffff, 0.4), alpha);
      g.fillCircle(p.x, p.y, 2.2);
    }
  }

  private seg(a: Pt, b: Pt, t0: number, t1: number): [number, number, number, number] {
    return [a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0, a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1];
  }

  private fillPrism(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number, h: number,
    colors: { top: number; east: number; south: number }, alpha = 1, base = 0, faces: ('top' | 'east' | 'south')[] = ['south', 'east', 'top']): void {
    const f = prismFaces(this.P, x0, y0, x1, y1, h, base);
    for (const k of faces) {
      g.fillStyle(colors[k], alpha);
      g.fillPoints(f[k], true);
    }
  }

  /** Expiry styling: fade with freshness; the last quarter flickers and dashes. */
  private freshnessStyle(fresh: number): { alpha: number; ageing: boolean } {
    const ageing = fresh < 0.25;
    const flick = ageing ? (Math.sin(this.clock * 26) > -0.2 ? 1 : 0.25) : 1;
    return { alpha: (0.35 + 0.65 * Math.min(1, fresh * 2)) * flick, ageing };
  }

  // ------------------------------------------------------------ ambient

  private drawAmbient(theme: RoomTheme): void {
    const g = this.fxFloor!;
    const ms = this.clock * 1000;
    for (const a of theme.ambient) {
      if (a.kind === 'flicker') {
        const idx = Math.floor(((ms % a.periodMs) / a.periodMs) * a.pattern.length);
        const on = a.pattern[idx] === '1';
        const p = this.P(a.at.x, a.at.y, a.height);
        g.fillStyle(on ? a.color : MATERIAL.steelDark, on ? 0.9 : 1);
        g.fillRect(p.x - 7 * this.scale, p.y - 1 * this.scale, 14 * this.scale, 2 * this.scale);
        if (on) this.light({ x: a.at.x + 0.6, y: a.at.y + 0.6 }, 0, a.color, 1.6, 0.22 * (0.6 + THEMES[theme.room].config.ambientIntensity));
      } else if (a.kind === 'blink') {
        const on = (ms % a.periodMs) / a.periodMs < a.duty;
        const p = this.P(a.at.x, a.at.y, a.height);
        g.fillStyle(on ? a.color : MATERIAL.steelDark, 1);
        g.fillCircle(p.x, p.y, 1.8 * this.scale);
        if (on) this.light(a.at, a.height, a.color, 0.5, 0.5);
      } else if (a.kind === 'abyssLight') {
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 0.8 + a.at.x);
        this.light(a.at, -30, a.color, 1.0, 0.12 + 0.12 * pulse);
      }
    }
  }

  // ------------------------------------------------------------ lab

  private doorColor(state: DoorState): number {
    switch (state) {
      case 'SEALED': return SIGNAL.hostile;
      case 'JAMMED_OPEN': return SIGNAL.jammed;
      case 'OPEN': return SIGNAL.protocol;
      case 'SAFE_PENDING_CLOSE': return SIGNAL.unstable;
      default: return SIGNAL.dormant;
    }
  }

  private drawLab(s: SliceSnapshot): void {
    const g = this.fxFloor!;
    const top = this.fxTop!;
    const P = this.P;
    // Exit: a floor-projected target, the only always-on protocol marker.
    const exit = ROOM.exit;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 2.4);
    g.fillStyle(SIGNAL.protocol, 0.08 + 0.06 * pulse);
    g.fillPoints(rectAt(P, exit.x - 0.42, exit.y - 0.42, exit.x + 0.42, exit.y + 0.42), true);
    g.lineStyle(2, SIGNAL.protocol, 0.75);
    g.strokePoints(rectAt(P, exit.x - 0.42, exit.y - 0.42, exit.x + 0.42, exit.y + 0.42), true);
    for (let i = 0; i < 3; i++) {
      const t = ((this.clock * 0.6) + i / 3) % 1;
      const x = exit.x - 0.25 + t * 0.5;
      g.lineStyle(1.5, SIGNAL.protocol, 0.6 * (1 - t));
      g.strokePoints([P(x - 0.1, exit.y - 0.15), P(x + 0.05, exit.y), P(x - 0.1, exit.y + 0.15)], false);
    }
    this.light(exit, 0, SIGNAL.protocol, 0.9, 0.25 + 0.15 * pulse);

    // Door leaf.
    const color = this.doorColor(s.doorState);
    const closed = !s.doorPassable;
    const { x0, x1, y0, y1 } = DOOR_LEAF;
    if (closed) {
      this.fillPrism(g, x0, y0, x1, y1, 30, { top: MATERIAL.steelLit, east: MATERIAL.steel, south: MATERIAL.steel }, 1, 0, ['east', 'top']);
      // Seam + status band on the visible (east) face.
      g.lineStyle(2, color, 0.9);
      g.lineBetween(P(x1, 5, 2).x, P(x1, 5, 2).y, P(x1, 5, 28).x, P(x1, 5, 28).y);
      g.lineStyle(3, color, 0.65);
      g.lineBetween(P(x1, y0 + 0.1, 24).x, P(x1, y0 + 0.1, 24).y, P(x1, y1 - 0.1, 24).x, P(x1, y1 - 0.1, 24).y);
      if (s.doorState === 'SEALED') {
        // Hostile carrier holding the leaf: hazard bars on the face.
        for (let i = 0; i < 4; i++) {
          const yy = y0 + 0.2 + i * 0.45;
          g.lineStyle(2, SIGNAL.hostile, 0.35);
          g.lineBetween(P(x1, yy, 6).x, P(x1, yy, 6).y, P(x1, yy + 0.25, 16).x, P(x1, yy + 0.25, 16).y);
        }
      }
      this.light({ x: 8.2, y: 5 }, 10, color, 1.0, 0.35);
    } else {
      // Leaf retracted into the floor track; edge lights carry the state.
      this.fillPrism(g, x0, y0, x1, y1, 3, { top: MATERIAL.steel, east: MATERIAL.steelDark, south: MATERIAL.steelDark });
      const blink = s.doorState === 'SAFE_PENDING_CLOSE' ? (Math.sin(this.clock * 18) > 0 ? 1 : 0.2) : 1;
      const jam = s.doorState === 'JAMMED_OPEN';
      for (const xx of [x0, x1]) {
        const a = P(xx, y0, 3);
        const b = P(xx, y1, 3);
        if (jam) this.signalLine(g, a, b, SIGNAL.jammed, 0.9, 'broken', 0);
        else { g.lineStyle(2, color, 0.9 * blink); g.lineBetween(a.x, a.y, b.x, b.y); }
      }
      if (s.doorState === 'SAFE_PENDING_CLOSE' && s.occupancy) {
        // Occupancy hold: the leaf will not close on a body.
        for (const yy of [y0 + 0.15, y1 - 0.15]) {
          g.lineStyle(3, SIGNAL.unstable, 0.8 * blink);
          g.lineBetween(P(x0, yy, 3).x, P(x0, yy, 3).y, P(x1, yy, 3).x, P(x1, yy, 3).y);
        }
      }
      this.light({ x: 7.5, y: 5 }, 4, color, 1.0, 0.3 * blink);
    }

    // Jam on the receiver: interference + remaining-duration arc (player-caused, always visible).
    const rx = ROOM.receiver;
    if (s.jamActive) {
      const frac = s.jamRemainingTicks / SLICE.JAM_DURATION_TICKS;
      this.arc(top, rx, LINTEL_Z, 0.42, frac, SIGNAL.jammed, 0.95, 2.5);
      const r = visualRng(this.frame * 3);
      const c = P(rx.x, rx.y, LINTEL_Z);
      top.lineStyle(1, SIGNAL.jammed, 0.7);
      for (let i = 0; i < 5; i++) {
        const a = r() * Math.PI * 2;
        const d = 8 + r() * 10;
        top.lineBetween(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d * 0.5, c.x + Math.cos(a + 0.5) * (d + 5), c.y + Math.sin(a + 0.5) * (d + 5) * 0.5);
      }
      this.light(rx, LINTEL_Z, SIGNAL.jammed, 0.6, 0.45);
    }

    // Scan-revealed knowledge only. Nothing here is drawn before a legal scan.
    const reveal = s.reveal;
    if (!reveal) return;
    const fresh = revealFreshness(s, SLICE.SCAN_REVEAL_TICKS);
    const { alpha, ageing } = this.freshnessStyle(fresh);
    const src = P(ROOM.source.x, ROOM.source.y, LINTEL_Z);
    const rec = P(rx.x, rx.y, LINTEL_Z);
    if (reveal.link) {
      const style = s.jamActive ? 'broken' : ageing ? 'dashed' : 'flow';
      this.signalLine(top, src, rec, SIGNAL.hostile, alpha, style, 0.45);
    }
    if (reveal.sealSource) {
      top.fillStyle(SIGNAL.hostile, alpha);
      top.fillCircle(src.x, src.y, 4);
      const rip = (this.clock * 0.8) % 1;
      this.isoRing(top, ROOM.source, LINTEL_Z, 0.15 + rip * 0.5, 1.2, SIGNAL.hostile, alpha * (1 - rip));
      this.light(ROOM.source, LINTEL_Z, SIGNAL.hostile, 0.5, 0.35 * alpha);
    }
    if (reveal.doorReceiver) {
      this.isoRing(top, rx, LINTEL_Z, 0.22, 2, SIGNAL.protocol, alpha);
      top.fillStyle(SIGNAL.protocol, alpha);
      top.fillCircle(rec.x, rec.y, 2.2);
    }
  }

  // ------------------------------------------------------------ corridor

  private bridgeColor(b: BridgeState): number {
    switch (b) {
      case 'STABLE': return SIGNAL.feed;
      case 'UNSTABLE': return SIGNAL.unstable;
      case 'TRANSITIONING': return SIGNAL.unstableHi;
      case 'DISABLED': return SIGNAL.dormant;
      default: return SIGNAL.dormant;
    }
  }

  private drawCorridor(s: SliceSnapshot): void {
    const c = s.corridor!;
    const g = this.fxFloor!;
    const top = this.fxTop!;
    const P = this.P;
    this.drawBridge(c.bridge, c.bridgeRemainingTicks);

    // Safe shore anchors (recovery points, not checkpoints).
    for (const shore of Object.values(CORRIDOR.shores)) {
      g.lineStyle(1.5, SIGNAL.protocol, 0.45);
      g.strokePoints(rectAt(P, shore.x - 0.3, shore.y - 0.3, shore.x + 0.3, shore.y + 0.3), true);
    }

    // Relay housing + far control. Lamp colour is physically visible state.
    const relayLamp = c.relay === 'ACTIVE' ? SIGNAL.feed : c.relay === 'JAMMED' ? SIGNAL.jammed : SIGNAL.dormant;
    for (const [at, size, h] of [[CORRIDOR.relay, 0.28, 22], [CORRIDOR.farControl, 0.22, 16]] as const) {
      this.fillPrism(g, at.x - size, at.y - size, at.x + size, at.y + size, h, { top: MATERIAL.steelLit, east: MATERIAL.steelDark, south: MATERIAL.steel }, 1, 7);
      const lamp = P(at.x, at.y, 7 + h + 3);
      const on = c.relay === 'ACTIVE' || (c.relay === 'JAMMED' && Math.sin(this.clock * 30) > 0);
      g.fillStyle(relayLamp, on ? 1 : 0.5);
      g.fillCircle(lamp.x, lamp.y, 3.2 * this.scale);
      // Manual switch position (intent persists through jam/power loss).
      const sw = P(at.x + size, at.y, 7 + h * (c.manualEnabled ? 0.75 : 0.35));
      g.fillStyle(c.manualEnabled ? SIGNAL.protocol : SIGNAL.dormant, 1);
      g.fillRect(sw.x - 1, sw.y - 2, 4, 4);
      if (c.relay === 'ACTIVE') this.light(at, 7 + h, SIGNAL.feed, 0.9, 0.4);
    }
    if (c.relay === 'ACTIVE') {
      // Emitter head spins while transmitting.
      const head = P(CORRIDOR.relay.x, CORRIDOR.relay.y, 7 + 22 + 8);
      const a = this.clock * 4;
      g.lineStyle(1.5, SIGNAL.feedHi, 0.8);
      g.lineBetween(head.x - Math.cos(a) * 7, head.y - Math.sin(a) * 3, head.x + Math.cos(a) * 7, head.y + Math.sin(a) * 3);
    }
    if (c.canInteract) {
      const near = Math.hypot(c.position.x - CORRIDOR.relay.x, c.position.y - CORRIDOR.relay.y) <
        Math.hypot(c.position.x - CORRIDOR.farControl.x, c.position.y - CORRIDOR.farControl.y) ? CORRIDOR.relay : CORRIDOR.farControl;
      const pul = (this.clock * 1.2) % 1;
      this.isoRing(g, near, 0, 0.45 + pul * 0.2, 1.5, SIGNAL.protocol, 0.8 * (1 - pul));
    }
    if (c.relay === 'JAMMED') {
      this.arc(top, CORRIDOR.relay, RELAY_Z + 8, 0.45, s.jamRemainingTicks / SLICE.JAM_DURATION_TICKS, SIGNAL.jammed, 0.95, 2.5);
      this.light(CORRIDOR.relay, RELAY_Z, SIGNAL.jammed, 0.7, 0.4);
    }

    this.drawGuard(s);

    // Revealed connections: one source, two consequences (bridge support vs hostile perception).
    const reveal = s.corridorReveal;
    if (!reveal?.relay) return;
    const fresh = revealFreshness(s, SLICE.SCAN_REVEAL_TICKS);
    const { alpha, ageing } = this.freshnessStyle(fresh);
    const relayTop = P(CORRIDOR.relay.x, CORRIDOR.relay.y, RELAY_Z + 6);
    this.isoRing(top, CORRIDOR.relay, RELAY_Z + 6, 0.3, 2, SIGNAL.protocol, alpha);
    const lineStyle = (active: boolean): 'flow' | 'dashed' | 'broken' =>
      c.relay === 'JAMMED' ? 'broken' : !active || ageing ? 'dashed' : 'flow';
    if (reveal.bridge) {
      const port = P(CORRIDOR.bridgePort.x, CORRIDOR.bridgePort.y, 6);
      this.signalLine(top, relayTop, port, c.bridgeFeed ? SIGNAL.feed : SIGNAL.dormant, alpha, lineStyle(c.bridgeFeed), 0.4);
      this.isoRing(top, CORRIDOR.bridgePort, 6, 0.2, 1.5, c.bridgeFeed ? SIGNAL.feed : SIGNAL.dormant, alpha);
    }
    if (reveal.perceptionPort && c.guardHp > 0) {
      const gp = P(c.guard.position.x, c.guard.position.y, GUARD_Z);
      const guardJammed = c.guard.link === 'JAMMED';
      const style = guardJammed ? 'broken' : lineStyle(c.perceptionFeed);
      this.signalLine(top, relayTop, gp, c.perceptionFeed ? SIGNAL.hostile : SIGNAL.dormant, alpha, style, guardJammed ? 0.75 : 0.4);
    }
  }

  private drawBridge(state: BridgeState, remaining: number): void {
    const g = this.fxFloor!;
    const P = this.P;
    const { left, right, top, bottom } = CORRIDOR.bridge;
    const color = this.bridgeColor(state);
    const T = CORRIDOR.transitionTicks;
    const lensFrac = state === 'TRANSITIONING' || state === 'UNSTABLE' ? remaining / T : state === 'STABLE' ? 1 : 0;
    // Emitter lenses on the four posts.
    for (const [ex, ey] of [[left, top], [left, bottom], [right, top], [right, bottom]]) {
      const p = P(ex, ey, 16);
      const lit = state === 'STABLE' || state === 'UNSTABLE' || state === 'TRANSITIONING';
      g.fillStyle(lit ? color : MATERIAL.steelDark, lit ? 0.95 : 1);
      g.fillCircle(p.x, p.y, 3 * this.scale);
      if (state === 'TRANSITIONING' || state === 'UNSTABLE') this.arc(g, { x: ex, y: ey }, 16, 0.22, lensFrac, color, 0.9, 2);
    }
    if (state === 'UNAVAILABLE' || state === 'DISABLED') {
      // Only the broken stubs at each shore remain.
      for (const [x0, x1] of [[left, left + 0.35], [right - 0.35, right]]) {
        this.fillPrism(g, x0, top, x1, bottom, 2, { top: MATERIAL.steel, east: MATERIAL.steelDark, south: MATERIAL.steelDark }, 0.9, -4);
      }
      return;
    }
    const cols = right - left;
    if (state === 'TRANSITIONING') {
      // Segments assemble from both shores; wireframe = not yet walkable.
      const progress = 1 - remaining / T;
      for (let i = 0; i < cols; i++) {
        const fromEdge = Math.min(i, cols - 1 - i) / Math.ceil(cols / 2);
        if (fromEdge > progress) continue;
        const quad = rectAt(P, left + i + 0.04, top + 0.04, left + i + 0.96, bottom - 0.04);
        g.lineStyle(1.2, color, 0.85);
        g.strokePoints(quad, true);
        const scanY = top + ((this.clock * 2 + i * 0.3) % 1) * (bottom - top);
        g.lineStyle(1, color, 0.5);
        g.lineBetween(P(left + i, scanY).x, P(left + i, scanY).y, P(left + i + 1, scanY).x, P(left + i + 1, scanY).y);
      }
      return;
    }
    // Solid deck (walkable).
    const unstable = state === 'UNSTABLE';
    const urgency = unstable ? 1 - remaining / T : 0;
    const flick = unstable ? (Math.sin(this.clock * (8 + urgency * 30)) > -0.3 ? 1 : 0.45) : 1;
    if (unstable) {
      // State residue: a displaced ghost of the deck, jitter grows as the deadline nears.
      const j = 0.06 + urgency * 0.22;
      const r = visualRng(this.frame);
      const ox = (r() - 0.5) * j;
      const oy = (r() - 0.5) * j;
      g.lineStyle(1, SIGNAL.unstable, 0.35);
      g.strokePoints(rectAt(P, left + ox, top + oy, right + ox, bottom + oy, -3), true);
    }
    this.fillPrism(g, left, top, right, bottom, 4, {
      top: mix(MATERIAL.steel, color, 0.12), east: MATERIAL.steelDark, south: MATERIAL.steelDark,
    }, unstable ? 0.65 + 0.35 * flick : 0.95, -4);
    for (let i = 0; i <= cols; i++) {
      g.lineStyle(1, MATERIAL.floorSeam, 0.8);
      g.lineBetween(P(left + i, top).x, P(left + i, top).y, P(left + i, bottom).x, P(left + i, bottom).y);
    }
    // Edge rails carry the support state.
    for (const yy of [top + 0.06, bottom - 0.06]) {
      const a = P(left, yy);
      const b = P(right, yy);
      if (unstable) {
        g.lineStyle(2, SIGNAL.unstable, 0.9 * flick);
        g.lineBetween(a.x, a.y, b.x, b.y);
      } else this.signalLine(g, a, b, SIGNAL.feed, 0.9, 'flow');
    }
    if (unstable) {
      // Cracks multiply as failure approaches.
      const r = visualRng(4242);
      const n = 3 + Math.floor(urgency * 9);
      g.lineStyle(1.2, SIGNAL.unstableHi, 0.7 * flick);
      for (let i = 0; i < n; i++) {
        let x = left + 0.3 + r() * (cols - 0.6);
        let y = top + 0.3 + r() * (bottom - top - 0.6);
        const pts = [P(x, y)];
        for (let k = 0; k < 4; k++) {
          x += (r() - 0.5) * 0.35;
          y += (r() - 0.3) * 0.25;
          pts.push(P(x, y));
        }
        g.strokePoints(pts, false);
      }
    }
    this.light({ x: (left + right) / 2, y: (top + bottom) / 2 }, 0, color, 2.4, (unstable ? 0.25 * flick : 0.18));
  }

  private drawGuard(s: SliceSnapshot): void {
    const c = s.corridor!;
    if (c.guardHp <= 0) return;
    const g = this.fxFloor!;
    const top = this.fxTop!;
    const gp = c.guard.position;
    const head = this.P(gp.x, gp.y, GUARD_Z + 4);
    const jammed = c.guard.link === 'JAMMED';
    const behavior = c.guard.behavior;
    // Ground contact ring.
    const watching = behavior === 'WATCHING' && !jammed;
    this.isoRing(g, gp, 0, 0.45, watching ? 2 : 1.2, watching ? SIGNAL.hostile : MATERIAL.steelLit, watching ? 0.7 : 0.4);
    let lamp: number = SIGNAL.unstable;
    let lampAlpha = 0.55;
    if (jammed) {
      lamp = SIGNAL.jammed;
      lampAlpha = Math.sin(this.clock * 40) > 0 ? 0.9 : 0.2;
      this.arc(top, gp, GUARD_Z + 10, 0.5, c.guard.jamRemainingTicks / SLICE.JAM_DURATION_TICKS, SIGNAL.jammed, 0.95, 2.5);
      const r = visualRng(this.frame * 5 + 1);
      top.lineStyle(1, SIGNAL.jammed, 0.65);
      for (let i = 0; i < 6; i++) {
        const a = r() * Math.PI * 2;
        const d = 10 + r() * 12;
        top.lineBetween(head.x + Math.cos(a) * d, head.y + Math.sin(a) * d * 0.6, head.x + Math.cos(a + 0.4) * (d + 6), head.y + Math.sin(a + 0.4) * (d + 6) * 0.6);
      }
    } else if (watching) {
      lamp = SIGNAL.hostile;
      lampAlpha = 1;
      // It is visibly pointed at you (ordinary sight, not hidden state).
      const pp = playerPos(s);
      const tgt = this.P(pp.x, pp.y, 16);
      top.lineStyle(1, SIGNAL.hostile, 0.35);
      top.lineBetween(head.x, head.y, tgt.x, tgt.y);
    } else if (behavior === 'INVESTIGATING') {
      lampAlpha = Math.sin(this.clock * 10) > 0 ? 1 : 0.3;
      const a = this.clock * 3;
      const e = isoEllipse(0.9, this.scale);
      const base = this.P(gp.x, gp.y, 0);
      g.lineStyle(1.5, SIGNAL.unstable, 0.5);
      g.beginPath();
      g.moveTo(base.x, base.y);
      g.lineTo(base.x + Math.cos(a) * e.rx, base.y + Math.sin(a) * e.ry);
      g.lineTo(base.x + Math.cos(a + 0.5) * e.rx, base.y + Math.sin(a + 0.5) * e.ry);
      g.closePath();
      g.strokePath();
    }
    top.fillStyle(lamp, lampAlpha);
    top.fillCircle(head.x, head.y, 3.5 * this.scale);
    this.light(gp, GUARD_Z, lamp, 0.6, 0.4 * lampAlpha);
    if (this.hitFlash > 0) {
      top.fillStyle(0xffffff, this.hitFlash * 0.7);
      top.fillCircle(head.x, head.y + 6, 14 * this.scale * this.hitFlash + 4);
    }
  }

  // ------------------------------------------------------------ transient effects

  private drawEffects(): void {
    const top = this.fxTop!;
    for (const e of this.effects.items) {
      const t = e.age / e.duration;
      switch (e.kind) {
        case 'scan': {
          const grow = Math.min(1, e.age / 0.75);
          const r = SLICE.SCAN_RADIUS * (1 - (1 - grow) ** 3);
          const fade = 1 - t;
          this.isoRing(top, e.origin, 2, r, 2, SIGNAL.protocol, 0.75 * fade);
          if (r > 1) this.isoRing(top, e.origin, 2, r * 0.82, 1, SIGNAL.protocol, 0.3 * fade);
          if (t < 0.15) this.isoRing(top, e.origin, 8, 0.3 + t * 3, 3, SIGNAL.observe, 1 - t / 0.15);
          break;
        }
        case 'ping': {
          if (e.age < e.delay) break;
          const k = (e.age - e.delay) / (e.duration - e.delay);
          const c = this.P(e.at.x, e.at.y, e.z);
          this.isoRing(top, e.at, e.z, 0.15 + k * 0.6, 2, e.color, 1 - k);
          top.lineStyle(1.5, e.color, 1 - k);
          top.lineBetween(c.x - 8, c.y, c.x + 8, c.y);
          top.lineBetween(c.x, c.y - 8, c.x, c.y + 8);
          if (k < 0.2) this.light(e.at, e.z, SIGNAL.observe, 0.6, 0.6 * (1 - k / 0.2));
          break;
        }
        case 'beam': {
          const a = this.P(e.from.x, e.from.y, e.fromZ);
          const b = this.P(e.to.x, e.to.y, e.toZ);
          const reach = Math.min(1, t * 3);
          const end = lerpPt(a, b, reach);
          const r = visualRng(this.frame * 17);
          top.lineStyle(2, SIGNAL.jammed, 1 - t);
          top.beginPath();
          top.moveTo(a.x, a.y);
          const steps = 9;
          for (let i = 1; i <= steps; i++) {
            const p = lerpPt(a, end, i / steps);
            top.lineTo(p.x + (r() - 0.5) * 8, p.y + (r() - 0.5) * 8);
          }
          top.strokePath();
          top.lineStyle(6, SIGNAL.jammed, 0.18 * (1 - t));
          top.lineBetween(a.x, a.y, end.x, end.y);
          break;
        }
        case 'flash': {
          this.isoRing(top, e.at, e.z, e.radius * (0.3 + t), 2.5, e.color, 1 - t);
          this.light(e.at, e.z, e.color, e.radius, 0.6 * (1 - t));
          break;
        }
        case 'sweep': {
          const { left, right, top: y0, bottom: y1 } = CORRIDOR.bridge;
          const x = left + (right - left) * t;
          const a = this.P(x, y0, 0);
          const b = this.P(x, y1, 0);
          top.lineStyle(4, e.color, 0.8 * (1 - t));
          top.lineBetween(a.x, a.y, b.x, b.y);
          break;
        }
      }
    }
  }
}
