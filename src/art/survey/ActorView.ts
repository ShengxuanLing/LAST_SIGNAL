// ART-RENAISSANCE AR-02 — read-only visual controllers for the executor and hostiles.
// They consume entity state (position, facing, FSM state, timers) every frame and
// never write gameplay state back. Animation time is World.clock, which only advances
// through GameScene.update -> game.step, so fixed-clock captures are reproducible.
import Phaser from 'phaser';
import { DEPTH, actorDepth } from './tokens';
import { ENEMY_ART, EXECUTOR, SHEETS, type ArtKind } from './SurveyTextures';

export interface ScreenProjector { worldToScreen(x: number, y: number): { x: number; y: number } }

function makeShadow(scene: Phaser.Scene, width: number): Phaser.GameObjects.Image {
  return scene.add.image(0, 0, 'ink_shadow').setDepth(DEPTH.shadow).setScale(width / 64, width / 64);
}

function makeLight(scene: Phaser.Scene, key: string, radius: number, alpha: number): Phaser.GameObjects.Image {
  return scene.add.image(0, 0, key).setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(DEPTH.light).setScale(radius / 64).setAlpha(alpha);
}

/** Screen-space unit direction for a grid-space angle at (x, y). */
export function screenDir(p: ScreenProjector, x: number, y: number, angle: number): { x: number; y: number } {
  const a = p.worldToScreen(x, y);
  const b = p.worldToScreen(x + Math.cos(angle), y + Math.sin(angle));
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

// ---------------------------------------------------------------------------

export interface ExecutorState {
  wx: number; wy: number; aimYaw: number; hurt: number; dashing: boolean; alive: boolean;
}

/** Executor (OPERATOR appearance) — 2 views x (idle 4 + move 6) frames, flipped for left/right. */
export class ExecutorView {
  readonly shadow: Phaser.GameObjects.Image | null;
  readonly lamp: Phaser.GameObjects.Image | null;
  view: 'f' | 'b' = 'f';
  flip = false;
  private lastX = 0;
  private lastY = 0;
  private moveT = 0;
  private recoil = 0;

  constructor(private readonly sprite: Phaser.GameObjects.Sprite, private readonly animated: boolean,
              opts: { shadow: boolean; lamp: boolean } = { shadow: true, lamp: true }) {
    const scene = sprite.scene;
    this.shadow = opts.shadow ? makeShadow(scene, 38) : null;
    this.lamp = opts.lamp ? makeLight(scene, 'light_interact', 60, 0.32) : null;
    if (animated) {
      const info = SHEETS.executor;
      sprite.setTexture('executor', 'f_idle_0').setOrigin(info.originX, info.originY);
    }
    sprite.once('destroy', () => { this.shadow?.destroy(); this.lamp?.destroy(); });
  }

  /** Called by Player after it fires (visual only). */
  fired(): void { this.recoil = 0.05; }

  /** Update view/flip from the aim immediately (so the muzzle matches this frame's art). */
  syncFacing(p: ScreenProjector, wx: number, wy: number, aimYaw: number): void {
    if (!this.animated) return;
    const d = screenDir(p, wx, wy, aimYaw);
    this.view = d.y < -0.2 ? 'b' : 'f';
    this.flip = d.x < 0;
  }

  update(dt: number, clock: number, s: ExecutorState, p: ScreenProjector): void {
    const sp = this.sprite;
    const moved = Math.hypot(sp.x - this.lastX, sp.y - this.lastY);
    this.lastX = sp.x; this.lastY = sp.y;
    this.moveT = moved > 0.05 ? 0.12 : Math.max(0, this.moveT - dt);
    this.recoil = Math.max(0, this.recoil - dt);
    sp.setDepth(actorDepth(s.wx, s.wy));
    this.shadow?.setPosition(sp.x, sp.y + 1).setVisible(sp.visible);
    // Mast lamp: slow 2 s breathe (03 §8 Idle).
    this.lamp?.setPosition(sp.x, sp.y).setVisible(sp.visible && s.alive).setAlpha(0.26 + 0.06 * Math.sin(clock * Math.PI));
    if (!this.animated) return;
    this.syncFacing(p, s.wx, s.wy, s.aimYaw);
    const moving = this.moveT > 0;
    const frame = moving
      ? `${this.view}_move_${Math.floor(clock / (0.5 / EXECUTOR.moveFrames)) % EXECUTOR.moveFrames}`
      : `${this.view}_idle_${Math.floor(clock / 0.3) % EXECUTOR.idleFrames}`;
    // Hurt: vermilion rim for the first 60 ms of the 200 ms hurt window.
    sp.setFrame(s.hurt > 0.14 ? `${frame}_rim` : frame);
    sp.setFlipX(this.flip);
    // Recoil 2 px along the gun axis, applied through the origin so the sprite's
    // position stays exactly worldToScreen(grid) (audit.spec spriteErr < 1).
    const info = SHEETS.executor;
    const k = this.recoil > 0 ? 2 : 0;
    sp.setOrigin(info.originX + (this.flip ? -k : k) / info.cellW, info.originY);
  }

  /** Muzzle point in display space for the current frame. */
  muzzle(): { x: number; y: number } {
    const m = EXECUTOR.muzzle[this.view];
    return { x: this.sprite.x + (this.flip ? -m.x : m.x), y: this.sprite.y + m.y };
  }
}

// ---------------------------------------------------------------------------

export interface HostileState {
  kind: string; wx: number; wy: number; facing: number; state: string;
  hitFlash: number; attackCharge: number; ranged: boolean; alive: boolean;
}

export class HostileView {
  readonly shadow: Phaser.GameObjects.Image;
  readonly glow: Phaser.GameObjects.Image;
  readonly art: (typeof ENEMY_ART)[ArtKind];
  private lastX = 0;
  private lastY = 0;
  private moveT = 0;
  flip = false;
  /** 0..1 telegraph strength exposed to CombatVfx (aim / reach lines). */
  telegraph = 0;
  phase: number;

  constructor(private readonly sprite: Phaser.GameObjects.Sprite, kind: string, seedPhase: number) {
    const k = (kind in ENEMY_ART ? kind : 'drone') as ArtKind;
    this.art = ENEMY_ART[k];
    const info = SHEETS[this.art.key];
    sprite.setTexture(this.art.key, 'idle_0').setOrigin(info.originX, info.originY);
    this.shadow = makeShadow(sprite.scene, this.art.shadowW);
    this.glow = makeLight(sprite.scene, 'light_hostile', 26, 0.28);
    this.phase = seedPhase;
    sprite.once('destroy', () => { this.shadow.destroy(); this.glow.destroy(); });
  }

  update(dt: number, clock: number, s: HostileState, p: ScreenProjector): void {
    const sp = this.sprite;
    const moved = Math.hypot(sp.x - this.lastX, sp.y - this.lastY);
    this.lastX = sp.x; this.lastY = sp.y;
    this.moveT = moved > 0.05 ? 0.1 : Math.max(0, this.moveT - dt);
    const d = screenDir(p, s.wx, s.wy, s.facing);
    if (Math.abs(d.x) > 0.15) this.flip = d.x < 0;
    sp.setDepth(actorDepth(s.wx, s.wy));
    // Telegraph: detect (0.5 s perception lock) or the last 300 ms of the existing
    // attack cooldown. Drawn strictly inside timers the FSM already has.
    const charging = s.state === 'attack' && s.attackCharge > 0 && s.attackCharge <= 0.3;
    this.telegraph = s.state === 'detect' ? 0.6 : charging ? 1 - s.attackCharge / 0.3 : 0;
    const t = clock + this.phase;
    let frame: string;
    if (this.telegraph > 0) frame = 'tele_0';
    else if (this.moveT > 0) frame = `move_${Math.floor(t / 0.11) % this.art.move}`;
    else frame = `idle_${Math.floor(t / 0.35) % this.art.idle}`;
    sp.setFrame(s.hitFlash > 0.09 ? `${frame}_flash` : frame);
    sp.setFlipX(this.flip);
    const hover = this.art.key === 'enemy_hunter';
    this.shadow.setPosition(sp.x, sp.y + 1).setScale((this.art.shadowW / 64) * (hover ? 0.85 : 1), (this.art.shadowW / 64) * (hover ? 0.85 : 1));
    const ax = this.flip ? -this.art.apertureX : this.art.apertureX;
    this.glow.setPosition(sp.x + ax * 0.5, sp.y).setAlpha(0.22 + this.telegraph * 0.25);
  }

  /** Aperture (sensor) point in display space. */
  aperture(): { x: number; y: number } {
    const ax = this.flip ? -this.art.apertureX : this.art.apertureX;
    return { x: this.sprite.x + ax, y: this.sprite.y + this.art.apertureY };
  }
}
