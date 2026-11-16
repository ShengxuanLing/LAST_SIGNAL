// AI-NATIVE-02 C1 — shared pure rules for the real World.
//
// This is NOT a complete SimulationCore / authoritative state owner: C1 only
// extracts the rule bodies that Phaser currently executes inline and rewires
// Player / Enemy / World to call these single implementations. Mutable state
// still lives on those Phaser-facing objects; centralised SimulationState,
// fixed tick, event queue and RNG ownership are C2 work.
//
// Pure module contract: no Phaser, no DOM, no wall clock, no unseeded randomness.
// Real behaviour is preserved by reusing the real config (WEAPONS / ENEMY_STATS
// / GAME / IsoMath) and by accepting the World's RNG and collision predicate.

import { GAME } from '../../config/game';
import { IsoMath } from '../../core/iso';
import type { RNG } from '../../core/random';
import type { EnemyStateName, ProjectileData, Tile, Vec2, WeaponDef } from '../../types';

export interface GridPoint { x: number; y: number; }

// ---------------------------------------------------------------------------
// Movement / collision / aim (real anisotropic screen -> grid budget, F-09)
// ---------------------------------------------------------------------------

export function screenVelocityToGridVelocity(
  move: Vec2,
  speed: number,
  tileW = IsoMath.TILE_W,
  tileH = IsoMath.TILE_H
): Vec2 {
  const mag = Math.hypot(move.x, move.y);
  if (mag <= 1e-9) return { x: 0, y: 0 };
  const sx = move.x / mag;
  const sy = move.y / mag;
  const tx = sx / (tileW / 2);
  const ty = sy / (tileH / 2);
  return { x: (tx + ty) / 2 * speed, y: (ty - tx) / 2 * speed };
}

export function gridDirectionToScreenDirection(
  dx: number,
  dy: number,
  tileW = IsoMath.TILE_W,
  tileH = IsoMath.TILE_H
): Vec2 {
  const sx = (dx - dy) * (tileW / 2);
  const sy = (dx + dy) * (tileH / 2);
  const mag = Math.hypot(sx, sy);
  if (mag <= 1e-9) return { x: 0, y: 0 };
  return { x: sx / mag, y: sy / mag };
}

export function axisSlide(
  position: GridPoint,
  velocity: Vec2,
  dt: number,
  isWalkable: (x: number, y: number) => boolean
): GridPoint {
  let x = position.x;
  let y = position.y;
  const nx = x + velocity.x * dt;
  if (isWalkable(nx, y)) x = nx;
  const ny = y + velocity.y * dt;
  if (isWalkable(x, ny)) y = ny;
  return { x, y };
}

export interface PlayerMoveInput {
  position: GridPoint;
  move: Vec2;
  dash: boolean;
  speed: number;
  dt: number;
  dashTimer: number;
  dashDuration: number;
  isWalkable: (x: number, y: number) => boolean;
}

export interface PlayerMoveResult {
  position: GridPoint;
  velocity: Vec2;
  dashTimer: number;
  dashStarted: boolean;
}

export function stepPlayerMovement(input: PlayerMoveInput): PlayerMoveResult {
  const mag = Math.hypot(input.move.x, input.move.y);
  let speed = input.speed;
  let dashTimer = input.dashTimer;
  if (dashTimer > 0) {
    speed = input.speed * 2.6;
    dashTimer -= input.dt;
  }
  const velocity = mag > 0 ? screenVelocityToGridVelocity(input.move, speed) : { x: 0, y: 0 };
  const position = axisSlide(input.position, velocity, input.dt, input.isWalkable);
  const dashStarted = input.dash && dashTimer <= 0 && mag > 0;
  if (dashStarted) dashTimer = input.dashDuration;
  return { position, velocity, dashTimer, dashStarted };
}

export function aimYawFromGrid(from: GridPoint, to: GridPoint): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) <= 1e-4) return null;
  return Math.atan2(dy, dx);
}

export function gridDistance(a: GridPoint, b: GridPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceWithin(a: GridPoint, b: GridPoint, range: number): boolean {
  return gridDistance(a, b) <= range;
}

export function axisSlideToward(
  position: GridPoint,
  target: GridPoint,
  speed: number,
  dt: number,
  isWalkable: (x: number, y: number) => boolean
): GridPoint {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const d = Math.hypot(dx, dy) || 1;
  return axisSlide(position, { x: dx / d * speed, y: dy / d * speed }, dt, isWalkable);
}

// ---------------------------------------------------------------------------
// Damage / weapon spec / projectile creation (real WEAPONS config + real RNG)
// ---------------------------------------------------------------------------

export function damageAfterArmor(amount: number, armor: number): number {
  const reduction = 1 - Math.min(0.75, armor / (armor + 80));
  return Math.max(1, amount * reduction);
}

export interface WeaponFireSpec {
  damage: number; speed: number; critBase: number; critDamage: number;
  critChance: number; pierce: number; lifetime: number; kind: string;
  magazine: number; shots: number; spread: number;
}

export interface WeaponSpecInput {
  weapon: WeaponDef;
  damageMultiplier: number;
  critChance: number;
  critDamage: number;
  pierceCount: number;
  magazine: number;
  pixelToTile?: number;
}

/** Same spec Player.tryFire() used to assemble inline; now the single source. */
export function buildWeaponSpec(input: WeaponSpecInput): WeaponFireSpec {
  const w = input.weapon;
  const pixelToTile = input.pixelToTile ?? GAME.PIXEL_TO_TILE;
  return {
    damage: w.baseDamage * input.damageMultiplier,
    speed: w.baseProjectileSpeed / pixelToTile,
    critBase: w.critBase,
    critDamage: input.critDamage,
    critChance: input.critChance,
    pierce: input.pierceCount + (w.kind === 'plasma' ? 2 : 0),
    lifetime: w.baseRange / w.baseProjectileSpeed,
    kind: w.kind,
    magazine: input.magazine,
    shots: w.kind === 'scatter' ? 5 : 1,
    spread: w.baseSpread
  };
}

export interface ProjectileSpawnInput {
  id: number;
  ownerId: number;
  side: 'player' | 'enemy';
  origin: GridPoint;
  angle: number;
  spec: WeaponFireSpec;
  rng: RNG;
  shotIndex: number;
  shotCount: number;
  pixelToTile?: number;
}

/** Crit / damage / velocity / lifetime / radius, exactly as World.spawnProjectile(). */
export function createProjectileData(input: ProjectileSpawnInput): ProjectileData {
  const pixelToTile = input.pixelToTile ?? GAME.PIXEL_TO_TILE;
  const spread = input.spec.spread ?? 0;
  const a = input.angle + (input.shotCount > 1
    ? (input.shotIndex / (input.shotCount - 1) - 0.5) * spread * input.shotCount
    : 0);
  const px = input.origin.x + Math.cos(a) * 16 / pixelToTile;
  const py = input.origin.y + Math.sin(a) * 16 / pixelToTile;
  const crit = input.rng.float() < input.spec.critChance;
  const dmg = (crit ? input.spec.critDamage : 1) * input.spec.damage;
  return {
    id: input.id,
    ownerId: input.ownerId,
    side: input.side,
    pos: { x: px, y: py },
    vel: { x: Math.cos(a) * input.spec.speed, y: Math.sin(a) * input.spec.speed },
    damage: dmg,
    lifetime: input.spec.lifetime,
    radius: Math.max((input.spec.magazine > 0 && input.spec.kind === 'scatter' ? 5 : 6) / pixelToTile, 0.2),
    crit,
    pierce: input.spec.pierce ?? 0,
    hitSet: new Set<number>()
  };
}

// ---------------------------------------------------------------------------
// Projectile sweep / hit / damage application
// ---------------------------------------------------------------------------

export function segmentPointDistance(
  ax: number, ay: number, bx: number, by: number, px: number, py: number
): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 <= 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function projectileHitsTarget(
  previous: GridPoint,
  current: GridPoint,
  target: GridPoint,
  targetRadius: number,
  projectileRadius: number
): boolean {
  return segmentPointDistance(previous.x, previous.y, current.x, current.y, target.x, target.y)
    <= targetRadius + projectileRadius;
}

export interface ProjectileAdvanceInput {
  pos: GridPoint;
  vel: Vec2;
  lifetime: number;
  dt: number;
  tileAt: (x: number, y: number) => Tile;
  mapWidth: number;
  mapHeight: number;
}

export interface ProjectileAdvanceResult {
  pos: GridPoint;
  lifetime: number;
  expired: boolean;
  hitWall: boolean;
}

export function advanceProjectile(input: ProjectileAdvanceInput): ProjectileAdvanceResult {
  const pos = { x: input.pos.x + input.vel.x * input.dt, y: input.pos.y + input.vel.y * input.dt };
  const lifetime = input.lifetime - input.dt;
  const hitWall = input.tileAt(pos.x, pos.y).type === 'wall';
  const expired = lifetime <= 0 || hitWall ||
    pos.x < -40 || pos.x > input.mapWidth + 40 ||
    pos.y < -40 || pos.y > input.mapHeight + 40;
  return { pos, lifetime, expired, hitWall };
}

export interface EnemyHitInput {
  hp: number;
  position: GridPoint;
  armor: number;
  stunTimer: number;
  damage: number;
  source: GridPoint;
  isWalkable: (x: number, y: number, radius: number) => boolean;
  pixelToTile?: number;
}

export interface EnemyHitResult {
  blocked: boolean;
  hp: number;
  position: GridPoint;
  hitFlash: number;
  knockbackApplied: boolean;
}

/** Enemy.hit() damage / knockback rule; Boss.hit() keeps its own legacy formula. */
export function resolveEnemyHit(input: EnemyHitInput): EnemyHitResult {
  if (input.stunTimer > 0) {
    return { blocked: true, hp: input.hp, position: { ...input.position }, hitFlash: 0, knockbackApplied: false };
  }
  const dmg = damageAfterArmor(input.damage, input.armor);
  const hp = input.hp - dmg;
  const dx = input.position.x - input.source.x;
  const dy = input.position.y - input.source.y;
  const d = Math.hypot(dx, dy) || 1;
  const kb = 16 / (input.pixelToTile ?? GAME.PIXEL_TO_TILE);
  const nx = input.position.x + (dx / d) * kb;
  const ny = input.position.y + (dy / d) * kb;
  const ok = input.isWalkable(nx, ny, 0.4);
  return {
    blocked: false,
    hp,
    position: ok ? { x: nx, y: ny } : { ...input.position },
    hitFlash: 0.15,
    knockbackApplied: ok
  };
}

export function weaponCooldown(baseRate: number, cooldownReduced: number): number {
  const red = Math.min(0.9, Math.max(0, cooldownReduced));
  return (1 / baseRate) / (1 - red);
}

export interface EnemyProjectileInput {
  id: number;
  ownerId: number;
  pos: GridPoint;
  damage: number;
  vel: Vec2;
  pixelToTile?: number;
}

/** Exact World.spawnEnemyProjectile() data (no 16px muzzle offset, no crit). */
export function createEnemyProjectileData(input: EnemyProjectileInput): ProjectileData {
  const pixelToTile = input.pixelToTile ?? GAME.PIXEL_TO_TILE;
  return {
    id: input.id,
    ownerId: input.ownerId,
    side: 'enemy',
    pos: { x: input.pos.x, y: input.pos.y },
    vel: { x: input.vel.x, y: input.vel.y },
    damage: input.damage,
    lifetime: 2.5,
    radius: Math.max(6 / pixelToTile, 0.2),
    crit: false,
    pierce: 0,
    hitSet: new Set<number>()
  };
}

export function resolveBossHit(input: {
  hp: number; armor: number; damage: number;
}): { hp: number; hitFlash: number } {
  const reduction = 1 - Math.min(0.6, input.armor / (input.armor + 120));
  return { hp: input.hp - Math.max(2, input.damage * reduction), hitFlash: 0.15 };
}

export interface PlayerHitInput {
  hp: number;
  position: GridPoint;
  armor: number;
  invuln: number;
  damage: number;
  source: GridPoint;
  isWalkable: (x: number, y: number) => boolean;
  pixelToTile?: number;
}

export interface PlayerHitResult {
  blocked: boolean;
  hp: number;
  position: GridPoint;
  hurtTimer: number;
  invuln: number;
}

/** Player.hurt() damage / knockback rule; shared by core and legacy enemies. */
export function resolvePlayerHit(input: PlayerHitInput): PlayerHitResult {
  if (input.invuln > 0 || input.hp <= 0) {
    return { blocked: true, hp: input.hp, position: { ...input.position }, hurtTimer: 0, invuln: input.invuln };
  }
  const dmg = damageAfterArmor(input.damage, input.armor);
  const hp = Math.max(0, input.hp - dmg);
  const hurtTimer = 0.2;
  const invuln = Math.max(input.invuln, 0.3);
  const dx = input.position.x - input.source.x;
  const dy = input.position.y - input.source.y;
  const d = Math.hypot(dx, dy) || 1;
  const kb = 24 / (input.pixelToTile ?? GAME.PIXEL_TO_TILE);
  let x = input.position.x;
  let y = input.position.y;
  const nx = x + (dx / d) * kb;
  if (input.isWalkable(nx, y)) x = nx;
  const ny = y + (dy / d) * kb;
  if (input.isWalkable(x, ny)) y = ny;
  return { blocked: false, hp, position: { x, y }, hurtTimer, invuln };
}

export function rangedAttackDescriptor(
  from: GridPoint,
  to: GridPoint,
  pixelToTile?: number
): { angle: number; velocity: Vec2 } {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const speed = 160 / (pixelToTile ?? GAME.PIXEL_TO_TILE);
  return { angle, velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed } };
}

// ---------------------------------------------------------------------------
// Drone FSM (first C1 slice). Other enemy kinds still use Enemy's legacy FSM.
// ---------------------------------------------------------------------------

export interface DroneStats {
  speed: number;
  aggroRange: number;
  attackRange: number;
  attackCooldown: number;
  damage: number;
  ranged: boolean;
  reachEnemy: boolean;
}

export interface DroneAiInput {
  dt: number;
  position: GridPoint;
  player: GridPoint;
  stats: DroneStats;
  /** Already decremented by Enemy.update() before calling this step. */
  state: EnemyStateName;
  stateTimer: number;
  wanderTimer: number;
  attackTimer: number;
  patrolPoints: Vec2[];
  patrolIndex: number;
  targetId: number | null;
  isWalkable: (x: number, y: number) => boolean;
  pixelToTile?: number;
}

export interface DroneAttackDescriptor {
  kind: 'ranged' | 'melee';
  damage: number;
  angle?: number;
  velocity?: Vec2;
}

export interface DroneAiResult {
  position: GridPoint;
  state: EnemyStateName;
  stateTimer: number;
  wanderTimer: number;
  patrolIndex: number;
  targetId: number | null;
  attackTimer: number;
  faceAngle: number | null;
  attack: DroneAttackDescriptor | null;
}

/**
 * Exact port of Enemy.stateMachine() + its movement/attack helpers for drone.
 * Enemy.update() still decrements hitFlash / attackTimer / wanderTimer /
 * stateTimer first; the extra -dt in 'detect'/'stun' below reproduces the
 * original double decrement.
 */
export function stepDroneAi(input: DroneAiInput): DroneAiResult {
  const { dt, stats } = input;
  let position: GridPoint = { ...input.position };
  let state = input.state;
  let stateTimer = input.stateTimer;
  let wanderTimer = input.wanderTimer;
  let patrolIndex = input.patrolIndex;
  let targetId = input.targetId;
  let attackTimer = input.attackTimer;
  let faceAngle: number | null = null;
  let attack: DroneAttackDescriptor | null = null;
  const detects = () => distanceWithin(position, input.player, stats.aggroRange);
  const inRange = (range: number) => distanceWithin(position, input.player, range);

  switch (state) {
    case 'idle':
      if (stateTimer <= 0 || wanderTimer <= 0) state = 'patrol';
      break;
    case 'patrol': {
      if (input.patrolPoints.length > 0) {
        const target = input.patrolPoints[patrolIndex];
        const d = gridDistance(position, target);
        if (d < 6) {
          patrolIndex = (patrolIndex + 1) % input.patrolPoints.length;
          wanderTimer = 1.2;
          stateTimer = 1.2;
        } else {
          position = axisSlideToward(position, target, stats.speed * 0.5, dt, input.isWalkable);
        }
      }
      if (stateTimer <= 0) state = 'idle';
      if (detects()) {
        targetId = 0;
        state = 'detect';
        stateTimer = 0.5;
      }
      break;
    }
    case 'detect':
      stateTimer -= dt;
      targetId = 0;
      if (stateTimer <= 0) state = 'chase';
      if (!detects()) state = 'idle';
      break;
    case 'chase':
      if (!detects()) {
        state = 'patrol';
        stateTimer = 1.5;
        break;
      }
      position = axisSlideToward(position, input.player, stats.speed, dt, input.isWalkable);
      faceAngle = Math.atan2(input.player.y - position.y, input.player.x - position.x);
      if (inRange(stats.attackRange)) state = 'attack';
      break;
    case 'attack':
      if (detects()) {
        faceAngle = Math.atan2(input.player.y - position.y, input.player.x - position.x);
        if (attackTimer <= 0) {
          attackTimer = stats.attackCooldown;
          if (stats.reachEnemy) {
            if (inRange(stats.attackRange + 1.5)) attack = { kind: 'melee', damage: stats.damage };
          } else if (stats.ranged) {
            const shot = rangedAttackDescriptor(position, input.player, input.pixelToTile);
            attack = { kind: 'ranged', damage: stats.damage, angle: shot.angle, velocity: shot.velocity };
          }
        }
        stateTimer = 0.4;
        if (stateTimer <= 0) state = 'chase';
      } else {
        state = 'chase';
      }
      break;
    case 'reposition':
      position = axisSlideToward(
        position,
        { x: 2 * position.x - input.player.x, y: 2 * position.y - input.player.y },
        stats.speed, dt, input.isWalkable
      );
      faceAngle = Math.atan2(input.player.y - position.y, input.player.x - position.x);
      if (stateTimer <= 0) state = detects() ? 'chase' : 'patrol';
      break;
    case 'stun':
      stateTimer -= dt;
      if (stateTimer <= 0) state = 'chase';
      break;
    case 'dead':
      break;
  }
  return { position, state, stateTimer, wanderTimer, patrolIndex, targetId, attackTimer, faceAngle, attack };
}
