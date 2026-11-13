import Phaser from 'phaser';
import { EnemyData, EnemyStateName, Vec2 } from '../types';
import { ENEMY_STATS, EnemyKind } from '../config/enemies';
import { GAME } from '../config/game';
import { clamp, unit, angleDiff } from '../core/random';
import { isoToScreen } from '../core/iso';
import { World } from '../world/World';
import { Player } from './Player';
import {
  axisSlideToward, distanceWithin, rangedAttackDescriptor, resolveEnemyHit, stepDroneAi,
  type DroneAiResult, type EnemyHitResult
} from '../world/sim/rules';

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
      hunter: 'enemy_hunter', boss_warden: 'enemy_hunter'
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
  /** C1 evidence: last pure drone FSM / hit results applied by this Phaser enemy. */
  lastDroneStep: DroneAiResult | null = null;
  lastHitResult: EnemyHitResult | null = null;

  initHp(): void { this._hp = this.data.stats.maxHp; }

  update(dt: number, player: Player): void {
    if (this._hp <= 0) return;
    this.data.hitFlash = Math.max(0, this.data.hitFlash - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.wanderTimer -= dt;
    this.data.stateTimer -= dt;
    // C1: drone rules come from the single pure FSM; every other enemy kind
    // still uses the legacy generic FSM below (no duplicate drone authority).
    if (this.data.kind === 'drone') {
      const step = stepDroneAi({
        dt,
        position: { x: this.wx, y: this.wy },
        player: { x: player.x, y: player.y },
        stats: {
          speed: this.data.stats.speed,
          aggroRange: this.data.stats.aggroRange,
          attackRange: this.data.stats.attackRange,
          attackCooldown: this.data.stats.attackCooldown,
          damage: this.data.stats.damage,
          ranged: this.data.stats.ranged,
          reachEnemy: this.data.stats.reachEnemy
        },
        state: this.data.state,
        stateTimer: this.data.stateTimer,
        wanderTimer: this.wanderTimer,
        attackTimer: this.attackTimer,
        patrolPoints: this.data.patrolPoints,
        patrolIndex: this.data.patrolIndex,
        targetId: this.data.targetId,
        isWalkable: (x, y) => this.world.isWalkable(x, y),
        pixelToTile: GAME.PIXEL_TO_TILE
      });
      this.lastDroneStep = step;
      this.applyDroneStep(step, player);
    } else {
      this.legacyStateMachine(dt, player);
    }
  }

  /** Adapter side of the pure drone step: sprites, projectiles, hurt calls. */
  private applyDroneStep(step: DroneAiResult, player: Player): void {
    this.wx = step.position.x;
    this.wy = step.position.y;
    this.data.state = step.state;
    this.data.stateTimer = step.stateTimer;
    this.wanderTimer = step.wanderTimer;
    this.data.patrolIndex = step.patrolIndex;
    this.data.targetId = step.targetId;
    this.attackTimer = step.attackTimer;
    if (step.faceAngle !== null) this.sprite.setRotation(step.faceAngle);
    if (step.attack) {
      if (step.attack.kind === 'ranged' && step.attack.velocity) {
        this.world.spawnEnemyProjectile(this.id, this.x, this.y, step.attack.damage, step.attack.velocity);
      } else if (step.attack.kind === 'melee') {
        player.hurt(step.attack.damage, this.x, this.y);
      }
    }
    this.project();
  }

  private inRange(player: Player, range: number): boolean {
    return distanceWithin({ x: this.x, y: this.y }, { x: player.x, y: player.y }, range);
  }

  /** Non-drone kinds only; drone is dispatched to stepDroneAi() above. */
  private legacyStateMachine(dt: number, player: Player): void {
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
    return distanceWithin({ x: this.x, y: this.y }, { x: player.x, y: player.y }, this.data.stats.aggroRange);
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

  private moveToPlayer(dt: number, player: Player): void {
    const stats = this.data.stats;
    const next = axisSlideToward({ x: this.wx, y: this.wy }, { x: player.x, y: player.y }, stats.speed, dt,
      (x, y) => this.world.isWalkable(x, y));
    this.wx = next.x; this.wy = next.y;
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
    const next = axisSlideToward({ x: this.wx, y: this.wy }, target, stats.speed * 0.5, dt,
      (x, y) => this.world.isWalkable(x, y));
    this.wx = next.x; this.wy = next.y;
    this.project();
  }

  private reposition(dt: number): void {
    const stats = this.data.stats;
    const player = this.world.player;
    const away = { x: 2 * this.x - player.x, y: 2 * this.y - player.y };
    const next = axisSlideToward({ x: this.wx, y: this.wy }, away, stats.speed, dt,
      (x, y) => this.world.isWalkable(x, y));
    this.wx = next.x; this.wy = next.y;
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
      const shot = rangedAttackDescriptor({ x: this.x, y: this.y }, { x: player.x, y: player.y }, GAME.PIXEL_TO_TILE);
      this.world.spawnEnemyProjectile(this.id, this.x, this.y, stats.damage, shot.velocity);
    }
  }

  get id(): number { return this._id; }
  _id = 0;

  hit(damage: number, source: Vec2): boolean {
    const result = resolveEnemyHit({
      hp: this._hp,
      position: { x: this.wx, y: this.wy },
      armor: this.data.stats.armor,
      stunTimer: this.data.stunTimer,
      damage,
      source,
      isWalkable: (x, y, radius) => this.world.isWalkable(x, y, radius),
      pixelToTile: GAME.PIXEL_TO_TILE
    });
    this.lastHitResult = result;
    if (result.blocked) return false;
    this._hp = result.hp;
    this.data.hitFlash = result.hitFlash;
    this.wx = result.position.x;
    this.wy = result.position.y;
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
