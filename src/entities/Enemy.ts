import Phaser from 'phaser';
import { EnemyData, EnemyStateName, Vec2 } from '../types';
import { ENEMY_STATS, EnemyKind } from '../config/enemies';
import { GAME } from '../config/game';
import { clamp, unit, angleDiff } from '../core/random';
import { isoToScreen } from '../core/iso';
import { World } from '../world/World';
import { Player } from './Player';

export interface EnemySpec {
  kind: EnemyKind; x: number; y: number; room: number; depth: number;
}

// General enemy FSM. Boss is handled in a subclass for phased attacks.
export class Enemy {
  sprite: Phaser.GameObjects.Sprite;
  data: EnemyData;
  wx: number;
  wy: number;
  // per-enemy attack timer
  private attackTimer = 0;
  private wanderTimer = 0;
  private hitDir = { x: 0, y: 0 };

  constructor(public world: World, kind: EnemyKind, x: number, y: number, room: number, depth: number) {
    const base = ENEMY_STATS[kind];
    const stats = { ...base };
    // deterministic scale from depth+room id
    const scale = 1 + depth * 0.12 + (kind === 'boss_warden' ? 0 : ((room * 31 + depth * 17) % 12) / 100);
    stats.maxHp = Math.round(stats.maxHp * scale);
    stats.damage = Math.round(stats.damage * scale);
    stats.armor += Math.floor(depth / 4);
    // Combat speed/range fields are authored in screen-px; convert to tile-world units.
    const TILE = 64;
    stats.speed /= TILE;
    stats.aggroRange /= TILE;
    stats.attackRange /= TILE;
    this.sprite = world.scene.add.sprite(x, y, this.texture(kind));
    this.sprite.setDepth(90);
    this.wx = x;
    this.wy = y;
    this.data = {
      kind, stats, state: 'idle', stateTimer: 0, targetId: null,
      patrolPoints: [], patrolIndex: 0, hitFlash: 0, stunTimer: 0, spawnRoom: room
    };
    // set up patrol points (interior points of spawn room)
    if (room >= 0 && room < world.map.rooms.length) {
      const r = world.map.rooms[room];
      this.data.patrolPoints = [
        { x: r.gx + 6, y: r.gy + 6 },
        { x: r.gx + r.w - 6, y: r.gy + 6 },
        { x: r.gx + r.w - 6, y: r.gy + r.h - 6 },
        { x: r.gx + 6, y: r.gy + r.h - 6 }
      ];
    }
    // Project to display space immediately so the sprite does not flash at (x, y).
    this.project();
  }

  private texture(kind: EnemyKind): string {
    const map: Record<string, string> = {
      drone: 'enemy_drone', stalker: 'enemy_stalker', sentinel: 'enemy_sentinel',
      hunter: 'enemy_hunter', boss_warden: 'enemy_hunter',
      sentry: 'enemy_sentry', shiver: 'enemy_shiver', slag: 'enemy_slag'
    };
    return map[kind] ?? 'enemy_drone';
  }

  get x(): number { return this.wx; }
  get y(): number { return this.wy; }
  get alive(): boolean { return this._hp > 0; }
  getRadius(): number { return 0.5; }

  project(): void {
    const s = this.world.worldToScreen(this.wx, this.wy);
    this.sprite.setPosition(s.x, s.y);
    this.sprite.setDepth(Math.floor(this.wy));
  }

  // HP stored on sprite? We'll keep hp in a parallel field.
  get hp(): number { return this._hp; }
  _hp = 0;

  initHp(): void { this._hp = this.data.stats.maxHp; }

  update(dt: number, player: Player): void {
    if (this._hp <= 0) return;
    this.data.hitFlash = Math.max(0, this.data.hitFlash - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.wanderTimer -= dt;
    this.data.stateTimer -= dt;
    this.stateMachine(dt, player);
  }

  private distanceTo(player: Player): number {
    const dx = player.x - this.x, dy = player.y - this.y;
    return Math.hypot(dx, dy);
  }

  private inRange(player: Player, range: number): boolean {
    return this.distanceTo(player) <= range;
  }

  private stateMachine(dt: number, player: Player): void {
    switch (this.data.state) {
      case 'idle':
        if (this.data.stateTimer <= 0 || this.wanderTimer <= 0) this.data.state = 'patrol';
        break;
      case 'patrol':
        this.moveAlongPatrol(dt);
        if (this.data.stateTimer <= 0) this.data.state = 'idle';
        if (this.detects(player)) this.enterDetect(player);
        break;
      case 'detect':
        this.data.stateTimer -= dt;
        this.data.targetId = 0;
        if (this.data.stateTimer <= 0) this.data.state = 'chase';
        if (!this.detects(player)) this.data.state = 'idle';
        break;
      case 'chase':
        if (!this.detects(player)) { this.data.state = 'patrol'; this.data.stateTimer = 1.5; break; }
        this.moveToPlayer(dt, player);
        if (this.inRange(player, this.data.stats.attackRange)) this.data.state = 'attack';
        break;
      case 'attack':
        if (this.detects(player)) {
          this.facePlayer(player);
          this.doAttack(player);
          this.data.stateTimer = 0.4;
          if (this.data.stateTimer <= 0) this.data.state = 'chase';
        } else {
          this.data.state = 'chase';
        }
        break;
      case 'reposition':
        this.reposition(dt);
        if (this.data.stateTimer <= 0) this.data.state = this.detects(player) ? 'chase' : 'patrol';
        break;
      case 'stun':
        this.data.stateTimer -= dt;
        if (this.data.stateTimer <= 0) this.data.state = 'chase';
        break;
    }
  }

  private detects(player: Player): boolean {
    return this.distanceTo(player) <= this.data.stats.aggroRange;
  }

  private enterDetect(player: Player): void {
    this.data.targetId = 0;
    this.data.state = 'detect';
    this.data.stateTimer = 0.5;
  }

  private facePlayer(player: Player): void {
    const a = Math.atan2(player.y - this.y, player.x - this.x);
    this.sprite.setRotation(a);
  }

  private canMove(x: number, y: number, radius = this.getRadius()): boolean {
    return this.world.canMoveInRoom(x, y, radius, this.data.spawnRoom);
  }

  private moveToPlayer(dt: number, player: Player): void {
    const stats = this.data.stats;
    const dx = player.x - this.x, dy = player.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    let vx = dx / d * stats.speed, vy = dy / d * stats.speed;
    if (this.canMove(this.wx + vx * dt, this.wy)) this.wx += vx * dt;
    if (this.canMove(this.wx, this.wy + vy * dt)) this.wy += vy * dt;
    this.facePlayer(player);
    this.project();
  }

  private moveAlongPatrol(dt: number): void {
    if (this.data.patrolPoints.length === 0) return;
    const stats = this.data.stats;
    const target = this.data.patrolPoints[this.data.patrolIndex];
    const dx = target.x - this.x, dy = target.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 6) {
      this.data.patrolIndex = (this.data.patrolIndex + 1) % this.data.patrolPoints.length;
      this.wanderTimer = 1.2;
      this.data.stateTimer = 1.2;
      return;
    }
    let vx = dx / d * stats.speed * 0.5, vy = dy / d * stats.speed * 0.5;
    if (this.canMove(this.wx + vx * dt, this.wy)) this.wx += vx * dt;
    if (this.canMove(this.wx, this.wy + vy * dt)) this.wy += vy * dt;
    this.project();
  }

  private reposition(dt: number): void {
    const stats = this.data.stats;
    // move away from player, perpendicular preferred
    const player = this.world.player;
    const dx = this.x - player.x, dy = this.y - player.y;
    const d = Math.hypot(dx, dy) || 1;
    let vx = dx / d * stats.speed, vy = dy / d * stats.speed;
    if (this.canMove(this.wx + vx * dt, this.wy)) this.wx += vx * dt;
    if (this.canMove(this.wx, this.wy + vy * dt)) this.wy += vy * dt;
    this.facePlayer(player);
    this.project();
  }

  private doAttack(player: Player): void {
    if (this.attackTimer > 0) return;
    const stats = this.data.stats;
    this.attackTimer = stats.attackCooldown;
    if (stats.reachEnemy) {
      // melee
      if (this.inRange(player, stats.attackRange + 1.5)) {
        player.hurt(stats.damage, this.x, this.y);
      }
    } else if (stats.ranged) {
      // ranged projectile: spawn at the enemy and travel toward the player in grid space
      const a = Math.atan2(player.y - this.y, player.x - this.x);
      const speed = 160 / GAME.PIXEL_TO_TILE;
      const offsets = this.data.kind === 'sentry' ? [-0.22, 0.22] : this.data.kind === 'shiver' ? [-0.3, 0, 0.3] : [0];
      for (const offset of offsets) {
        this.world.spawnEnemyProjectile(this.id, this.x, this.y, stats.damage,
          { x: Math.cos(a + offset) * speed, y: Math.sin(a + offset) * speed });
      }
    }
  }

  get id(): number { return this._id; }
  _id = 0;

  hit(damage: number, source: Vec2): boolean {
    if (this.data.stunTimer > 0) return false;
    const reduction = 1 - Math.min(0.75, this.data.stats.armor / (this.data.stats.armor + 80));
    const dmg = Math.max(1, damage * reduction);
    this._hp -= dmg;
    this.data.hitFlash = 0.15;
    // Knockback is a small grid-space nudge (16px), not a 3-tile teleport.
    // Do not push the enemy into a wall.
    const dx = this.wx - source.x, dy = this.wy - source.y;
    const d = Math.hypot(dx, dy) || 1;
    const kb = 16 / GAME.PIXEL_TO_TILE;
    const nx = this.wx + (dx / d) * kb;
    const ny = this.wy + (dy / d) * kb;
    if (this.canMove(nx, ny, 0.4)) { this.wx = nx; this.wy = ny; }
    this.project();
    return true;
  }

  stun(seconds: number): void {
    this.data.stunTimer = seconds;
    this.data.state = 'stun';
    this.data.stateTimer = seconds;
  }

  applyVisual(): void {
    if (this.data.hitFlash > 0) this.sprite.setTint(0xffffff);
    else this.sprite.clearTint();
    this.project();
  }

  getDepth(): number { return Math.floor(this.wy); }
}
