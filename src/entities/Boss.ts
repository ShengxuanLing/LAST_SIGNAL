import Phaser from 'phaser';
import { Vec2 } from '../types';
import { ENEMY_STATS } from '../config/enemies';
import { GAME } from '../config/game';
import { World } from '../world/World';
import { audio } from '../systems/AudioSystem';
import { isoToScreen } from '../core/iso';

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
  _hp = 0;
  phase = 1;
  stateTimer = 0;
  attackTimer = 0;
  hitFlash = 0;
  spawnRoom: number;
  wx: number;
  wy: number;

  constructor(public world: World, x: number, y: number, room: number, _depth: number) {
    this.spawnRoom = room;
    // AR-02 restyled 'enemy_hunter'; the Warden is outside the slice and keeps its
    // pre-AR-02 look under its own key until AR-04 designs the armillary Warden.
    this.sprite = this.world.scene.add.sprite(x, y, 'enemy_warden_legacy');
    // Keep the Boss below the player (depth 100) so an overlap never hides the
    // player sprite. Grid y is not a display depth and can exceed HUD depth.
    this.sprite.setDepth(95);
    this.sprite.setScale(2.4);
    this.wx = x;
    this.wy = y;
    this._hp = ENEMY_STATS.boss_warden.maxHp;
    // Project to display space immediately so the sprite does not flash at (x, y).
    this.project();
  }

  get x(): number { return this.wx; }
  get y(): number { return this.wy; }
  get alive(): boolean { return this._hp > 0; }
  getRadius(): number { return 3.0; }
  maxHp(): number { return ENEMY_STATS.boss_warden.maxHp; }

  project(): void {
    const s = this.world.worldToScreen(this.wx, this.wy);
    this.sprite.setPosition(s.x, s.y);
  }

  private stats() { return ENEMY_STATS.boss_warden; }

  initHp(): void { this._hp = this.maxHp(); }

  update(dt: number, player: PlayerLike): void {
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.stateTimer -= dt;

    // movement depends on phase
    const dx = player.x - this.x, dy = player.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const stats = this.stats();
    let speed = stats.speed / 64;
    if (this.phase === 1 && d > 10) {
      const vx = dx / d * speed, vy = dy / d * speed;
      if (this.world.isWalkable(this.wx + vx * dt, this.wy)) this.wx += vx * dt;
      if (this.world.isWalkable(this.wx, this.wy + vy * dt)) this.wy += vy * dt;
    } else if (this.phase === 2) {
      // circle at medium range
      const desired = 6;
      const factor = d < desired ? -1 : 1;
      const vx = dx / d * speed * factor, vy = dy / d * speed * factor;
      if (this.world.isWalkable(this.wx + vx * dt, this.wy)) this.wx += vx * dt;
      if (this.world.isWalkable(this.wx, this.wy + vy * dt)) this.wy += vy * dt;
    }
    this.sprite.setRotation(Math.atan2(dy, dx));
    this.project();
    if (this.hitFlash > 0) this.sprite.setTint(0xffffff);
    else this.sprite.clearTint();

    // attacks
    if (this.attackTimer <= 0) this.doAttack(player, d);
  }

  private doAttack(player: PlayerLike, d: number): void {
    if (this.phase === 1) {
      // phase 1: chase and fire a shockwave ring; bite if the player gets too close
      if (d < 3) {
        player.hurt(this.stats().damage * 0.5, this.x, this.y);
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

  private fireLaser(player: PlayerLike): void {
    const a = Math.atan2(player.y - this.y, player.x - this.x);
    for (let i = -1; i <= 1; i++) {
      this.world.spawnEnemyProjectile(this._id, this.x, this.y, 8);
      const proj = this.world.projectiles[this.world.projectiles.length - 1];
      if (proj) {
        const spread = a + i * 0.25;
        proj.data.vel = { x: Math.cos(spread) * toTilesPerSecond(BOSS_LASER_SPEED_PX), y: Math.sin(spread) * toTilesPerSecond(BOSS_LASER_SPEED_PX) };
      }
    }
    audio.hurt();
  }

  private shockwave(): void {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const p = this.world.spawnEnemyProjectile(this._id, this.x, this.y, 8);
      p.vel = { x: Math.cos(a) * toTilesPerSecond(BOSS_SHOCKWAVE_SPEED_PX), y: Math.sin(a) * toTilesPerSecond(BOSS_SHOCKWAVE_SPEED_PX) };
      p.lifetime = 3;
    }
    audio.bossroar();
    this.world.addShake(12);
  }

  private summonDrones(): void {
    for (let i = 0; i < 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const ex = this.x + Math.cos(angle) * 6;
      const ey = this.y + Math.sin(angle) * 6;
      if (this.world.isWalkable(ex, ey)) {
        const e = this.world.spawnEnemy('drone', ex, ey, this.spawnRoom, 3);
        e._id = this._id + 100 + i;
      }
    }
    audio.wave();
  }

  hit(damage: number, source: Vec2): boolean {
    const reduction = 1 - Math.min(0.6, this.stats().armor / (this.stats().armor + 120));
    this._hp -= Math.max(2, damage * reduction);
    this.hitFlash = 0.15;
    if (this._hp <= 0) return true;
    // phase transitions
    const ratio = this._hp / this.maxHp();
    const newPhase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
    if (newPhase !== this.phase) {
      this.phase = newPhase;
      this.world.scene.events.emit('boss-phase', this.phase);
      this.stateTimer = 0;
      audio.bossroar();
      this.world.addShake(16);
    }
    return false;
  }
}

interface PlayerLike {
  x: number; y: number; hurt(amount: number, fromX: number, fromY: number): boolean;
  getRadius(): number;
}
