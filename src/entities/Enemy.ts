import Phaser from 'phaser';
import { EnemyData, EnemyStateName } from '../types';
import { ENEMY_STATS, EnemyKind } from '../config/enemies';
import { GAME } from '../config/game';
import { clamp, unit, angleDiff } from '../core/random';
import { isoToScreen } from '../core/iso';
import { World } from '../world/World';
import { axisSlideToward, distanceWithin, rangedAttackDescriptor } from '../world/sim/rules';
import type { SimDroneState, SimTarget } from '../world/sim/core';
import type { ActorCombatPort, ActorTargetView } from '../world/actorTarget';

export interface EnemySpec {
  kind: EnemyKind; x: number; y: number; room: number; depth: number;
}

// General enemy FSM. Boss is handled in a subclass for phased attacks.
export class Enemy {
  sprite: Phaser.GameObjects.Sprite;
  private _data!: EnemyData;
  private _wx: number;
  private _wy: number;
  private __hp = 0;
  private _attackTimer = 0;
  private _wanderTimer = 0;
  private hitDir = { x: 0, y: 0 };
  /** C2: drone state is owned by World.sim.drones; other kinds stay legacy. */
  private simDrone: SimDroneState | null = null;
  private simTarget: SimTarget | null = null;

  get data(): EnemyData { return this.simDrone ? this.simDrone.data : this._data; }
  set data(value: EnemyData) { if (this.simDrone) this.simDrone.data = value; else this._data = value; }
  get wx(): number { return this.simDrone ? this.simDrone.x : this.simTarget ? this.simTarget.x : this._wx; }
  get wy(): number { return this.simDrone ? this.simDrone.y : this.simTarget ? this.simTarget.y : this._wy; }
  get _hp(): number { return this.simDrone ? this.simDrone.hp : this.simTarget ? this.simTarget.hp : this.__hp; }
  get attackTimer(): number { return this.simDrone ? this.simDrone.attackTimer : this._attackTimer; }
  set attackTimer(value: number) { if (this.simDrone) this.simDrone.attackTimer = value; else this._attackTimer = value; }
  get wanderTimer(): number { return this.simDrone ? this.simDrone.wanderTimer : this._wanderTimer; }
  set wanderTimer(value: number) { if (this.simDrone) this.simDrone.wanderTimer = value; else this._wanderTimer = value; }

  attachSimDrone(state: SimDroneState): void {
    state.data = this._data;
    state.x = this._wx;
    state.y = this._wy;
    state.hp = this.__hp;
    state.attackTimer = this._attackTimer;
    state.wanderTimer = this._wanderTimer;
    this.simDrone = state;
  }

  /** Attach an already-created core state (room-enter command); no core writes. */
  attachExistingSimDrone(state: SimDroneState): void {
    this.simDrone = state;
    this.simTarget = null;
  }

  attachExistingSimTarget(state: SimTarget): void {
    this.simTarget = state;
    this.simDrone = null;
  }

  attachSimTarget(state: SimTarget): void {
    // Read-only authority reference: initial x/y/hp were passed to registerTarget.
    this.simTarget = state;
  }

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
    this._wx = x;
    this._wy = y;
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

  initHp(): void { this.__hp = this.data.stats.maxHp; }

  update(dt: number, combat: ActorCombatPort): void {
    // C2: drone timers/FSM/projectiles are owned by World.sim (fixed ticks).
    if (this.data.kind === 'drone') return;
    if (this._hp <= 0) return;
    this.data.targetActorKind = combat.target.kind;
    this.data.hitFlash = Math.max(0, this.data.hitFlash - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.wanderTimer -= dt;
    this.data.stateTimer -= dt;
    this.legacyStateMachine(dt, combat);
  }

  private inRange(player: ActorTargetView, range: number): boolean {
    return distanceWithin({ x: this.x, y: this.y }, { x: player.x, y: player.y }, range);
  }

  /** Non-drone kinds only; drone FSM is owned by World.sim/core. */
  private legacyStateMachine(dt: number, combat: ActorCombatPort): void {
    const player = combat.target;
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
        this.data.targetId = player.actorId;
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
          this.doAttack(combat);
          this.data.stateTimer = 0.4;
          if (this.data.stateTimer <= 0) this.data.state = 'chase';
        } else {
          this.data.state = 'chase';
        }
        break;
      case 'reposition':
        this.reposition(dt, player);
        if (this.data.stateTimer <= 0) this.data.state = this.detects(player) ? 'chase' : 'patrol';
        break;
      case 'stun':
        this.data.stateTimer -= dt;
        if (this.data.stateTimer <= 0) this.data.state = 'chase';
        break;
    }
  }

  private detects(player: ActorTargetView): boolean {
    return distanceWithin({ x: this.x, y: this.y }, { x: player.x, y: player.y }, this.data.stats.aggroRange);
  }

  private enterDetect(player: ActorTargetView): void {
    this.data.targetId = player.actorId;
    this.data.state = 'detect';
    this.data.stateTimer = 0.5;
  }

  private facePlayer(player: ActorTargetView): void {
    const a = Math.atan2(player.y - this.y, player.x - this.x);
    this.sprite.setRotation(a);
  }

  private moveToPlayer(dt: number, player: ActorTargetView): void {
    const stats = this.data.stats;
    const next = axisSlideToward({ x: this.wx, y: this.wy }, { x: player.x, y: player.y }, stats.speed, dt,
      (x, y) => this.world.isWalkable(x, y));
    this.world.enqueueTargetMove(this._id, next.x, next.y);
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
    this.world.enqueueTargetMove(this._id, next.x, next.y);
    this.project();
  }

  private reposition(dt: number, player: ActorTargetView): void {
    const stats = this.data.stats;
    const away = { x: 2 * this.x - player.x, y: 2 * this.y - player.y };
    const next = axisSlideToward({ x: this.wx, y: this.wy }, away, stats.speed, dt,
      (x, y) => this.world.isWalkable(x, y));
    this.world.enqueueTargetMove(this._id, next.x, next.y);
    this.facePlayer(player);
    this.project();
  }

  private doAttack(combat: ActorCombatPort): void {
    const player = combat.target;
    if (this.attackTimer > 0) return;
    const stats = this.data.stats;
    this.attackTimer = stats.attackCooldown;
    if (stats.reachEnemy) {
      // melee
      if (this.inRange(player, stats.attackRange + 1.5)) {
        combat.hurtTarget(stats.damage, this.x, this.y);
      }
    } else if (stats.ranged) {
      const shot = rangedAttackDescriptor({ x: this.x, y: this.y }, { x: player.x, y: player.y }, GAME.PIXEL_TO_TILE);
      this.world.spawnEnemyProjectile(this.id, this.x, this.y, stats.damage, shot.velocity);
    }
  }

  get id(): number { return this._id; }
  _id = 0;

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
