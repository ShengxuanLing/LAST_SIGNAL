import { ENEMY_STATS } from '../config/enemies';
import { GAME } from '../config/game';
import type { Cell } from './room';
import { CORRIDOR, canStandInCorridor, corridorLineOfSight, shoreOf } from './corridorRoom';
import { SLICE } from './tuning';

const DRONE = ENEMY_STATS.drone;
const VISION_RANGE = DRONE.aggroRange / GAME.PIXEL_TO_TILE;
const ATTACK_RANGE = DRONE.attackRange / GAME.PIXEL_TO_TILE;
const ATTACK_WINDUP = Math.ceil(DRONE.attackCooldown * SLICE.TICK_HZ);
const MOVE_STEP = DRONE.speed / GAME.PIXEL_TO_TILE / SLICE.TICK_HZ;
const EVIDENCE_TTL = 8 * SLICE.TICK_HZ;

interface PositionEvidence extends Cell {
  observedAtTick: number;
  expiresAtTick: number;
}

export interface GuardSnapshot {
  position: Cell;
  link: 'DEAD' | 'JAMMED' | 'LINKED' | 'DISCONNECTED';
  sharedConnected: boolean;
  jamRemainingTicks: number;
  behavior: 'IDLE' | 'WATCHING' | 'INVESTIGATING';
  evidence: PositionEvidence | null;
}

function distance(a: Cell, b: Cell): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class CorridorGuard {
  private location: Cell = { ...CORRIDOR.guard };
  private evidence: PositionEvidence | null = null;
  private jamUntil = 0;
  private attackAt = 0;
  private watching = false;
  private health: number;

  constructor(cleared: boolean) {
    this.health = cleared ? 0 : DRONE.maxHp;
  }

  get hp(): number { return this.health; }
  get position(): Cell { return { ...this.location }; }

  takeHit(damage: number): void {
    this.health = Math.max(0, this.health - damage);
    if (this.health > 0) return;
    this.evidence = null;
    this.jamUntil = this.attackAt = 0;
    this.watching = false;
  }

  jam(tick: number): void {
    this.jamUntil = tick + SLICE.JAM_DURATION_TICKS;
    this.attackAt = 0;
    this.watching = false;
  }

  isJammed(tick: number): boolean { return tick < this.jamUntil; }

  /** Returns damage only if the guard still has a legal shot when the windup ends. */
  advance(tick: number, player: Cell, shared: boolean, bridgePassable: boolean): number {
    if (this.health === 0) return 0;
    if (this.evidence && tick >= this.evidence.expiresAtTick) this.evidence = null;
    const receive = !this.isJammed(tick);
    this.watching = receive && distance(this.location, player) <= VISION_RANGE &&
      corridorLineOfSight(this.location, player, bridgePassable);
    const sharedObservation = receive && shared && distance(CORRIDOR.relay, player) <= VISION_RANGE &&
      corridorLineOfSight(CORRIDOR.relay, player, bridgePassable);
    if (this.watching || sharedObservation) {
      this.evidence = { ...player, observedAtTick: tick, expiresAtTick: tick + EVIDENCE_TTL };
    }
    if (!this.watching) this.moveToward(this.evidence ?? CORRIDOR.guard);
    if (!this.watching || distance(this.location, player) >= ATTACK_RANGE) {
      this.attackAt = 0;
      return 0;
    }
    if (this.attackAt === 0) this.attackAt = tick + ATTACK_WINDUP;
    if (tick < this.attackAt) return 0;
    this.attackAt = tick + ATTACK_WINDUP;
    return DRONE.damage;
  }

  snapshot(tick: number, shared: boolean): GuardSnapshot {
    const live = this.health > 0;
    const sharedConnected = live && shared;
    const jammed = live && this.isJammed(tick);
    return {
      position: this.position,
      link: !live ? 'DEAD' : jammed ? 'JAMMED' : sharedConnected ? 'LINKED' : 'DISCONNECTED',
      sharedConnected,
      jamRemainingTicks: jammed ? this.jamUntil - tick : 0,
      behavior: this.watching ? 'WATCHING' : this.evidence ? 'INVESTIGATING' : 'IDLE',
      evidence: this.evidence && { ...this.evidence },
    };
  }

  private moveToward(target: Cell): void {
    const remaining = distance(this.location, target);
    if (remaining === 0) return;
    const fraction = Math.min(1, MOVE_STEP / remaining);
    const x = this.location.x + (target.x - this.location.x) * fraction;
    const y = this.location.y + (target.y - this.location.y) * fraction;
    // The R2 guard patrols the western platform, independent of bridge footing.
    if (shoreOf({ x, y }) === 'west' && canStandInCorridor(x, y, false)) this.location = { x, y };
  }
}
