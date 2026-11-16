import Phaser from 'phaser';
import { ENEMY_STATS } from '../config/enemies';
import { GAME } from '../config/game';
import { World } from '../world/World';
import { audio } from '../systems/AudioSystem';
import { isoToScreen } from '../core/iso';
import type { SimTarget } from '../world/sim/core';
import { toCombatPort, type ActorCombatPort, type ActorTargetView, type PlayerLikeCombat } from '../world/actorTarget';
import { sectorFor } from '../config/dungeon';

// Boss projectile speeds are authored in screen-px/s (same convention as the
// weapon configs). World.updateProjectiles advances pos in tile coords, so they
// must be converted to tile/s or the bullets cross the whole map in one frame
// and can never be seen or collide. Player/Enemy already divide by PIXEL_TO_TILE.
const BOSS_LASER_SPEED_PX = 160;      // 160 / 64 = 2.5 tile/s
const BOSS_SHOCKWAVE_SPEED_PX = 120;  // 120 / 64 = 1.875 tile/s
const toTilesPerSecond = (px: number): number => px / GAME.PIXEL_TO_TILE;

export class Boss {
  sprite: Phaser.GameObjects.Sprite;
  _id = 0;
  private __hp = 0;
  private _wx: number;
  private _wy: number;
  private simTarget: SimTarget | null = null;
  phase = 1;
  stateTimer = 0;
  attackTimer = 0;
  hitFlash = 0;
  spawnRoom: number;
  private readonly variant;

  get _hp(): number { return this.simTarget ? this.simTarget.hp : this.__hp; }
  get wx(): number { return this.simTarget ? this.simTarget.x : this._wx; }
  get wy(): number { return this.simTarget ? this.simTarget.y : this._wy; }

  constructor(public world: World, x: number, y: number, room: number, _depth: number) {
    this.spawnRoom = room;
    this.variant = world.map.deck === undefined ? undefined : sectorFor(world.map.deck).boss;
    // AR-02 restyled 'enemy_hunter'; the Warden is outside the slice and keeps its
    // pre-AR-02 look under its own key until AR-04 designs the armillary Warden.
    this.sprite = this.world.scene.add.sprite(x, y, this.variant?.texture ?? 'enemy_warden_legacy');
    // Keep the Boss below the player (depth 100) so an overlap never hides the
    // player sprite. Grid y is not a display depth and can exceed HUD depth.
    this.sprite.setDepth(95);
    this.sprite.setScale(2.4);
    this._wx = x;
    this._wy = y;
    this.__hp = this.maxHp();
    // Project to display space immediately so the sprite does not flash at (x, y).
    this.project();
  }

  get x(): number { return this.wx; }
  get y(): number { return this.wy; }
  get alive(): boolean { return this._hp > 0; }
  getRadius(): number { return 3.0; }
  maxHp(): number { return this.variant?.hp ?? ENEMY_STATS.boss_warden.maxHp; }
  get name(): string { return this.variant?.name ?? 'THE WARDEN'; }

  project(): void {
    const s = this.world.worldToScreen(this.wx, this.wy);
    this.sprite.setPosition(s.x, s.y);
  }

  private stats() { return ENEMY_STATS.boss_warden; }

  private canMove(x: number, y: number): boolean {
    return this.world.canMoveInRoom(x, y, 0.5, this.spawnRoom);
  }

  initHp(): void { this.__hp = this.maxHp(); }

  attachSimTarget(target: SimTarget): void {
    // Read-only authority reference: initial x/y/hp were passed to registerTarget.
    this.simTarget = target;
  }

  /** Core owns HP; adapter only reflects phase transitions after a core hit. */
  syncPhaseFromHp(): void {
    const ratio = this._hp / this.maxHp();
    const newPhase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
    if (newPhase === this.phase) return;
    this.phase = newPhase;
    this.world.scene.events.emit('boss-phase', this.phase);
    this.stateTimer = 0;
    audio.bossroar();
    this.world.addShake(16);
  }

  update(dt: number, combat: ActorCombatPort | PlayerLikeCombat): void {
    const port = toCombatPort(combat);
    const player = port.target;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.stateTimer -= dt;

    // movement depends on phase
    const dx = player.x - this.x, dy = player.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const stats = this.stats();
    const speed = stats.speed / 64;
    let bx = this.wx, by = this.wy;
    if (this.phase === 1 && d > 10) {
      const vx = dx / d * speed, vy = dy / d * speed;
      if (this.canMove(bx + vx * dt, by)) bx += vx * dt;
      if (this.canMove(bx, by + vy * dt)) by += vy * dt;
    } else if (this.phase === 2) {
      // circle at medium range
      const desired = 6;
      const factor = d < desired ? -1 : 1;
      const vx = dx / d * speed * factor, vy = dy / d * speed * factor;
      if (this.canMove(bx + vx * dt, by)) bx += vx * dt;
      if (this.canMove(bx, by + vy * dt)) by += vy * dt;
    }
    if (bx !== this.wx || by !== this.wy) this.world.enqueueTargetMove(this._id, bx, by);
    this.sprite.setRotation(Math.atan2(dy, dx));
    this.project();
    if (this.hitFlash > 0) this.sprite.setTint(0xffffff);
    else this.sprite.clearTint();

    // attacks
    if (this.attackTimer <= 0) this.doAttack(port, d);
  }

  private doAttack(combat: ActorCombatPort | PlayerLikeCombat, d: number): void {
    const port = toCombatPort(combat);
    const player = port.target;
    if (this.variant) {
      const { pattern } = this.variant;
      if (pattern === 'ring' || (pattern === 'mixed' && this.phase > 1)) this.shockwave();
      if (pattern !== 'ring' || this.phase > 1) this.fireLaser(player);
      if (this.phase > 1 && this.stateTimer <= 0) {
        this.summonDrones();
        this.stateTimer = 9;
      }
      this.attackTimer = 2 - this.phase * 0.35;
      return;
    }
    if (this.phase === 1) {
      // phase 1: chase and fire a shockwave ring; bite if the player gets too close
      if (d < 3) {
        port.hurtTarget(this.stats().damage * 0.5, this.x, this.y);
        this.world.addShake(10);
        this.attackTimer = 1.4;
        this.shockwave();
      } else {
        this.attackTimer = 0.5;
      }
    } else if (this.phase === 2) {
      if (this.stateTimer <= 0) {
        this.summonDrones();
        this.stateTimer = 6;
      }
      this.fireLaser(player);
      this.attackTimer = 0.8;
    } else {
      // phase 3: rapid patterns
      this.fireLaser(player);
      if ((this._id % 3) === 0) this.shockwave();
      this.attackTimer = 0.5;
    }
  }

  private fireLaser(player: ActorTargetView): void {
    const a = Math.atan2(player.y - this.y, player.x - this.x);
    for (let i = -1; i <= 1; i++) {
      const spread = a + i * 0.25;
      this.world.spawnEnemyProjectile(this._id, this.x, this.y, 8, {
        x: Math.cos(spread) * toTilesPerSecond(BOSS_LASER_SPEED_PX),
        y: Math.sin(spread) * toTilesPerSecond(BOSS_LASER_SPEED_PX)
      });
    }
    audio.hurt();
  }

  private shockwave(): void {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.world.spawnEnemyProjectile(this._id, this.x, this.y, 8, {
        x: Math.cos(a) * toTilesPerSecond(BOSS_SHOCKWAVE_SPEED_PX),
        y: Math.sin(a) * toTilesPerSecond(BOSS_SHOCKWAVE_SPEED_PX)
      }, 3);
    }
    audio.bossroar();
    this.world.addShake(12);
  }

  private summonDrones(): void {
    // Deterministic ring; the spawn is queued and committed by the next tick.
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 + this.phase;
      const ex = this.x + Math.cos(angle) * 6;
      const ey = this.y + Math.sin(angle) * 6;
      if (this.canMove(ex, ey)) {
        this.world.enqueueSpawnEnemy(this.variant?.summon ?? 'drone', ex, ey, this.spawnRoom, 3);
      }
    }
    audio.wave();
  }


}
