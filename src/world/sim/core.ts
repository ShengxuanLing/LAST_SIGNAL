// AI-NATIVE-02 C2 — first-slice authoritative SimulationState.
//
// One state owns the player, drone enemies and all player/drone projectiles for
// the first slice (`drone + pulse`). The Phaser adapters read/write this state
// through getters and present it; they do not keep independently mutable HP /
// position / projectile rule copies.
//
// Explicit 60Hz integer ticks, no wall clock in the core. A controlled intent
// sequence plus the same initial state/seed/ticks produces the same canonical
// state/events in Node and in the rendered World.
//
// Not a full-game core: boss, other enemy kinds, loot, rooms, Signal and
// checkpoint policy remain adapter/legacy. Visual RNG never enters this state.

import { GAME } from '../../config/game';
import { WEAPONS } from '../../config/weapons';
import { UPGRADES, applyUpgrade } from '../../config/upgrades';
import { RNG } from '../../core/random';
import type { EnemyData, MapData, PlayerData, ProjectileData, Tile, Vec2 } from '../../types';
import type { GridPoint } from './rules';
import { payloadFingerprint } from '../../ai-native/protocol';
import {
  advanceProjectile, aimYawFromGrid, buildWeaponSpec, createEnemyProjectileData,
  createProjectileData, projectileHitsTarget, resolveBossHit, resolveEnemyHit,
  resolvePlayerHit, stepDroneAi, stepPlayerMovement, weaponCooldown,
  type DroneAiResult, type EnemyHitResult, type PlayerHitResult, type WeaponFireSpec
} from './rules';

export const SIM_TUNING = {
  TICK_HZ: 60,
  TICK_MS: 1000 / 60,
  MAX_FRAME_DELTA_MS: 250,
  MAX_TICKS_PER_FRAME: 15
} as const;

const PLAYER_RADIUS = 0.5;

export interface SimPlayerState {
  x: number;
  y: number;
  data: PlayerData;
  dashTimer: number;
  invuln: number;
  hurtTimer: number;
  fireTimer: number;
  aimYaw: number;
}

export interface SimDroneState {
  id: number;
  x: number;
  y: number;
  hp: number;
  data: EnemyData;
  attackTimer: number;
  wanderTimer: number;
}

export interface SimTarget {
  id: number;
  kind: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  armor: number;
  radius: number;
  isBoss: boolean;
  xpValue: number;
  currencyValue: number;
}

export type SimCommand =
  | { type: 'move-target'; targetId: number; x: number; y: number }
  | { type: 'set-target-hp'; targetId: number; hp: number }
  | { type: 'heal-player'; amount: number }
  | { type: 'add-currency'; amount: number }
  | { type: 'add-xp'; base: number }
  | { type: 'apply-upgrade'; key: string; level: number };

export interface SimProjectile {
  id: number;
  ownerId: number;
  side: 'player' | 'enemy';
  source: 'player' | 'enemy';
  kind: string;
  pos: Vec2;
  vel: Vec2;
  damage: number;
  lifetime: number;
  radius: number;
  crit: boolean;
  pierce: number;
  hitIds: number[];
}

export interface SimulationState {
  seed: number;
  tick: number;
  rngState: number;
  map: MapData;
  mapMinX: number;
  mapMinY: number;
  player: SimPlayerState;
  drones: SimDroneState[];
  /** Legacy non-drone enemies and Boss; HP/position are core-owned. */
  targets: SimTarget[];
  projectiles: SimProjectile[];
  pendingPlayerHits: Array<{ damage: number; fromX: number; fromY: number }>;
  pendingCommands: SimCommand[];
  nextProjectileId: number;
}

export interface SimulationIntent {
  move: Vec2;
  dash: boolean;
  fire: boolean;
  aim: Vec2 | null;
  interact: boolean;
}

export type SimEvent =
  | { type: 'player-moved'; position: Vec2; velocity: Vec2; dashTimer: number; dashStarted: boolean }
  | { type: 'player-fired'; spec: WeaponFireSpec }
  | { type: 'projectile-spawned'; projectile: SimProjectile }
  | { type: 'drone-step'; droneId: number; step: DroneAiResult }
  | { type: 'enemy-hit'; enemyId: number; damage: number; crit: boolean; hit: EnemyHitResult }
  | { type: 'enemy-died'; enemyId: number; x: number; y: number }
  | { type: 'player-hurt'; damage: number; hit: PlayerHitResult }
  | { type: 'player-death' }
  | { type: 'player-healed'; amount: number; hp: number }
  | { type: 'currency-gained'; amount: number; currency: number }
  | { type: 'xp-gained'; amount: number; xp: number; level: number }
  | { type: 'player-levelup'; level: number }
  | { type: 'player-upgraded'; key: string; level: number }
  | { type: 'projectile-wall'; x: number; y: number };

export interface CreateSimulationInput {
  seed: number;
  map: MapData;
  playerData: PlayerData;
  playerX: number;
  playerY: number;
  nextProjectileId?: number;
}

export function createSimulationState(input: CreateSimulationInput): SimulationState {
  let minX = Infinity;
  let minY = Infinity;
  for (const row of input.map.tiles) {
    for (const tile of row) {
      minX = Math.min(minX, tile.x);
      minY = Math.min(minY, tile.y);
    }
  }
  // Same initial RNG seed as the C1 World.rng, but a separate continuous stream
  // so legacy loot/portal RNG cannot silently change crit state.
  const rng = new RNG(input.seed * 7919 + 1);
  return {
    seed: input.seed,
    tick: 0,
    rngState: rng.snapshot(),
    map: input.map,
    mapMinX: minX,
    mapMinY: minY,
    player: {
      x: input.playerX,
      y: input.playerY,
      data: input.playerData,
      dashTimer: 0,
      invuln: 0,
      hurtTimer: 0,
      fireTimer: 0,
      aimYaw: 0
    },
    drones: [],
    targets: [],
    projectiles: [],
    pendingPlayerHits: [],
    pendingCommands: [],
    nextProjectileId: input.nextProjectileId ?? 1
  };
}

/** Add the core-owned drone state used by Enemy for the first slice. */
export function registerDrone(
  state: SimulationState,
  input: { id: number; x: number; y: number; hp: number; data: EnemyData; attackTimer: number; wanderTimer: number }
): SimDroneState {
  const drone: SimDroneState = { ...input, data: input.data };
  state.drones.push(drone);
  return drone;
}

export function registerTarget(state: SimulationState, target: SimTarget): SimTarget {
  // Deep copy: the caller's object must never be the authoritative target.
  const stored: SimTarget = { ...target };
  state.targets.push(stored);
  return stored;
}

export function enqueueCommand(state: SimulationState, command: SimCommand): void {
  state.pendingCommands.push(command);
}

export function enqueueTargetMove(state: SimulationState, targetId: number, x: number, y: number): void {
  state.pendingCommands.push({ type: 'move-target', targetId, x, y });
}

export function enqueueTargetHp(state: SimulationState, targetId: number, hp: number): void {
  state.pendingCommands.push({ type: 'set-target-hp', targetId, hp });
}

/** Core-owned XP/level transaction. Returns gained XP and every level reached. */
export function addPlayerXp(state: SimulationState, base: number): { gained: number; levels: number[] } {
  const p = state.player.data;
  const gained = Math.round(base * p.xpGain);
  p.xp += gained;
  const levels: number[] = [];
  while (p.xp >= p.xpToNext) {
    p.xp -= p.xpToNext;
    p.level++;
    p.xpToNext = Math.round(30 * Math.pow(p.level, 1.3));
    levels.push(p.level);
  }
  return { gained, levels };
}

export function healPlayer(state: SimulationState, amount: number): number {
  const p = state.player.data;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  return p.hp;
}

export function addCurrency(state: SimulationState, amount: number): number {
  state.player.data.currency += amount;
  return state.player.data.currency;
}

export function applyUpgradeToPlayer(state: SimulationState, key: string, level: number): boolean {
  const def = UPGRADES[key];
  if (!def) return false;
  const data = state.player.data;
  applyUpgrade(def, data, level);
  const prog = data.upgrades.find((u) => u.key === key);
  if (prog) prog.level = level;
  else data.upgrades.push({ key, level });
  return true;
}

function grantXp(state: SimulationState, base: number, events: SimEvent[]): void {
  const { gained, levels } = addPlayerXp(state, base);
  events.push({ type: 'xp-gained', amount: gained, xp: state.player.data.xp, level: state.player.data.level });
  for (const level of levels) events.push({ type: 'player-levelup', level });
}

const KILL_CURRENCY_AMOUNT = 4;
const KILL_HEALTH_AMOUNT = 30;

/** C1 kill-reward order: two loot rolls, then XP. Boss uses no RNG (C1 used
 *  an unseeded visual RNG only for cosmetic loot positions). */
function awardEnemyKill(
  state: SimulationState, xpValue: number, isBoss: boolean, rng: RNG, events: SimEvent[]
): void {
  if (isBoss) {
    grantXp(state, xpValue, events);
    const currency = addCurrency(state, 120);
    events.push({ type: 'currency-gained', amount: 120, currency });
    return;
  }
  const currencyRoll = rng.float();
  const healthRoll = rng.float();
  if (currencyRoll < 0.6) {
    const currency = addCurrency(state, KILL_CURRENCY_AMOUNT);
    events.push({ type: 'currency-gained', amount: KILL_CURRENCY_AMOUNT, currency });
  }
  if (healthRoll < 0.25) {
    const hp = healPlayer(state, KILL_HEALTH_AMOUNT);
    events.push({ type: 'player-healed', amount: KILL_HEALTH_AMOUNT, hp });
  }
  grantXp(state, xpValue, events);
}

function processCommands(state: SimulationState, events: SimEvent[]): void {
  if (state.pendingCommands.length === 0) return;
  const commands = state.pendingCommands;
  state.pendingCommands = [];
  for (const command of commands) {
    switch (command.type) {
      case 'move-target': {
        const target = state.targets.find((t) => t.id === command.targetId && t.hp > 0);
        if (target) { target.x = command.x; target.y = command.y; }
        break;
      }
      case 'set-target-hp': {
        const target = state.targets.find((t) => t.id === command.targetId);
        if (target) target.hp = command.hp;
        break;
      }
      case 'heal-player': {
        const hp = healPlayer(state, command.amount);
        events.push({ type: 'player-healed', amount: command.amount, hp });
        break;
      }
      case 'add-currency': {
        const currency = addCurrency(state, command.amount);
        events.push({ type: 'currency-gained', amount: command.amount, currency });
        break;
      }
      case 'add-xp':
        grantXp(state, command.base, events);
        break;
      case 'apply-upgrade':
        if (applyUpgradeToPlayer(state, command.key, command.level)) {
          events.push({ type: 'player-upgraded', key: command.key, level: command.level });
        }
        break;
    }
  }
}

export function enqueuePlayerHit(
  state: SimulationState,
  damage: number,
  fromX: number,
  fromY: number
): void {
  state.pendingPlayerHits.push({ damage, fromX, fromY });
}

export function spawnEnemyProjectile(
  state: SimulationState,
  ownerId: number,
  x: number,
  y: number,
  damage: number,
  vel: Vec2,
  lifetime?: number
): SimProjectile {
  const data = createEnemyProjectileData({
    id: state.nextProjectileId++, ownerId, pos: { x, y }, damage, vel,
    pixelToTile: GAME.PIXEL_TO_TILE
  });
  if (lifetime !== undefined) data.lifetime = lifetime;
  const projectile = toSimProjectile(data, 'enemy', 'plasma');
  state.projectiles.push(projectile);
  return projectile;
}

export function tileAtFromState(state: SimulationState, x: number, y: number): Tile {
  const gx = Math.floor(x) - state.mapMinX;
  const gy = Math.floor(y) - state.mapMinY;
  if (gy < 0 || gy >= state.map.tiles.length) return { x: gx, y: gy, type: 'wall', height: 0 };
  const row = state.map.tiles[gy];
  if (!row || gx < 0 || gx >= row.length) return { x: gx, y: gy, type: 'wall', height: 0 };
  return row[gx];
}

export function ensureWalkableFromState(
  state: SimulationState,
  position: GridPoint = { x: state.player.x, y: state.player.y },
  radius = PLAYER_RADIUS,
  maxRadius = 6
): GridPoint {
  if (isWalkableFromState(state, position.x, position.y, radius)) return { ...position };
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = position.x + dx, ny = position.y + dy;
        if (isWalkableFromState(state, nx, ny, radius)) return { x: nx, y: ny };
      }
    }
  }
  return { ...position };
}

export function isWalkableFromState(
  state: SimulationState,
  x: number,
  y: number,
  radius = PLAYER_RADIUS
): boolean {
  const blocked = (sx: number, sy: number): boolean => {
    const t = tileAtFromState(state, sx, sy);
    return t.type === 'wall' || t.type === 'lava' || t.type === 'water';
  };
  return !(
    blocked(x - radius, y - radius) || blocked(x + radius, y - radius) ||
    blocked(x - radius, y + radius) || blocked(x + radius, y + radius)
  );
}

function toSimProjectile(data: ProjectileData, source: 'player' | 'enemy', kind: string): SimProjectile {
  return {
    id: data.id,
    ownerId: data.ownerId,
    side: data.side,
    source,
    kind,
    pos: { ...data.pos },
    vel: { ...data.vel },
    damage: data.damage,
    lifetime: data.lifetime,
    radius: data.radius,
    crit: data.crit,
    pierce: data.pierce,
    hitIds: [...data.hitSet]
  };
}

function tickPlayerTimers(state: SimulationState, dt: number): void {
  const p = state.player;
  p.fireTimer = Math.max(0, p.fireTimer - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.hurtTimer = Math.max(0, p.hurtTimer - dt);
  for (const ws of p.data.weapons) {
    if (!ws.reloading) continue;
    ws.reloadTimer -= dt;
    if (ws.reloadTimer <= 0) {
      ws.reloading = false;
      ws.reloadTimer = 0;
      ws.ammo = ws.magazine;
    }
  }
  if (p.data.hpRegen > 0 && p.data.hp < p.data.maxHp) {
    p.data.hp = Math.min(p.data.maxHp, p.data.hp + p.data.hpRegen * dt);
  }
}

function stepPlayerFire(state: SimulationState, intent: SimulationIntent, rng: RNG, events: SimEvent[]): void {
  const p = state.player;
  if (!intent.fire || p.data.hp <= 0 || p.fireTimer > 0) return;
  const weapon = WEAPONS[p.data.weaponKey] ?? WEAPONS.pulse;
  let ws = p.data.weapons.find((w) => w.key === p.data.weaponKey);
  if (!ws) {
    ws = {
      key: p.data.weaponKey, level: 1, ammo: weapon.magazine ?? -1,
      magazine: weapon.magazine ?? -1, reloading: false, reloadTimer: 0
    };
    p.data.weapons.push(ws);
  }
  if (ws.magazine > 0) {
    if (ws.reloading) return;
    if (ws.ammo <= 0) {
      ws.reloading = true;
      ws.reloadTimer = weapon.reloadTime ?? 1;
      return;
    }
  }
  p.fireTimer = weaponCooldown(weapon.baseRate, p.data.cooldownReduced);
  if (ws.magazine > 0) ws.ammo--;
  const spec = buildWeaponSpec({
    weapon,
    damageMultiplier: p.data.damage,
    critChance: p.data.critChance,
    critDamage: p.data.critDamage,
    pierceCount: p.data.pierceCount,
    magazine: ws.magazine,
    pixelToTile: GAME.PIXEL_TO_TILE
  });
  const data = createProjectileData({
    id: state.nextProjectileId++,
    ownerId: 0,
    side: 'player',
    origin: { x: p.x, y: p.y },
    angle: p.aimYaw,
    spec,
    rng,
    shotIndex: 0,
    shotCount: spec.shots,
    pixelToTile: GAME.PIXEL_TO_TILE
  });
  const projectile = toSimProjectile(data, 'player', spec.kind);
  state.projectiles.push(projectile);
  events.push({ type: 'player-fired', spec });
  events.push({ type: 'projectile-spawned', projectile });
}

function applyPendingPlayerHits(state: SimulationState, events: SimEvent[]): void {
  if (state.pendingPlayerHits.length === 0) return;
  const pending = state.pendingPlayerHits;
  state.pendingPlayerHits = [];
  for (const hit of pending) {
    // B4: after the first lethal hit, later queued hits are discarded. A dead
    // player cannot be hurt or killed again in the same tick.
    if (state.player.data.hp <= 0) break;
    applyCorePlayerHit(state, hit.fromX, hit.fromY, hit.damage, events);
  }
}

function stepPlayer(state: SimulationState, intent: SimulationIntent, rng: RNG, events: SimEvent[]): void {
  const p = state.player;
  const tickDt = SIM_TUNING.TICK_MS / 1000;
  applyPendingPlayerHits(state, events);
  // Preserve the existing recovery from a stuck/knockback position.
  const recovered = ensureWalkableFromState(state, { x: p.x, y: p.y });
  if (recovered.x !== p.x || recovered.y !== p.y) {
    p.x = recovered.x;
    p.y = recovered.y;
    events.push({ type: 'player-moved', position: recovered, velocity: { x: 0, y: 0 }, dashTimer: p.dashTimer, dashStarted: false });
  }
  tickPlayerTimers(state, tickDt);
  if (intent.aim) {
    const yaw = aimYawFromGrid({ x: p.x, y: p.y }, intent.aim);
    if (yaw !== null) p.aimYaw = yaw;
  }
  if (p.data.hp > 0) {
    const step = stepPlayerMovement({
      position: { x: p.x, y: p.y },
      move: intent.move,
      dash: intent.dash,
      speed: p.data.speed,
      dt: tickDt,
      dashTimer: p.dashTimer,
      dashDuration: p.data.dashDuration,
      isWalkable: (x, y) => isWalkableFromState(state, x, y, PLAYER_RADIUS)
    });
    p.x = step.position.x;
    p.y = step.position.y;
    p.dashTimer = step.dashTimer;
    if (step.dashStarted) p.invuln = Math.max(p.invuln, p.data.dashDuration + 0.05);
    events.push({
      type: 'player-moved', position: step.position, velocity: step.velocity,
      dashTimer: step.dashTimer, dashStarted: step.dashStarted
    });
    stepPlayerFire(state, intent, rng, events);
  }
}

function stepDrones(state: SimulationState, dt: number, events: SimEvent[]): void {
  for (const drone of state.drones) {
    if (drone.hp <= 0) continue;
    // Exact pre-step timer decrements from Enemy.update(), now on the core.
    drone.data.hitFlash = Math.max(0, drone.data.hitFlash - dt);
    drone.attackTimer = Math.max(0, drone.attackTimer - dt);
    drone.wanderTimer -= dt;
    drone.data.stateTimer -= dt;
    const step = stepDroneAi({
      dt,
      position: { x: drone.x, y: drone.y },
      player: { x: state.player.x, y: state.player.y },
      stats: {
        speed: drone.data.stats.speed,
        aggroRange: drone.data.stats.aggroRange,
        attackRange: drone.data.stats.attackRange,
        attackCooldown: drone.data.stats.attackCooldown,
        damage: drone.data.stats.damage,
        ranged: drone.data.stats.ranged,
        reachEnemy: drone.data.stats.reachEnemy
      },
      state: drone.data.state,
      stateTimer: drone.data.stateTimer,
      wanderTimer: drone.wanderTimer,
      attackTimer: drone.attackTimer,
      patrolPoints: drone.data.patrolPoints,
      patrolIndex: drone.data.patrolIndex,
      targetId: drone.data.targetId,
      isWalkable: (x, y) => isWalkableFromState(state, x, y, PLAYER_RADIUS),
      pixelToTile: GAME.PIXEL_TO_TILE
    });
    drone.x = step.position.x;
    drone.y = step.position.y;
    drone.data.state = step.state;
    drone.data.stateTimer = step.stateTimer;
    drone.wanderTimer = step.wanderTimer;
    drone.data.patrolIndex = step.patrolIndex;
    drone.data.targetId = step.targetId;
    drone.attackTimer = step.attackTimer;
    events.push({ type: 'drone-step', droneId: drone.id, step });
    if (step.attack) {
      if (step.attack.kind === 'ranged' && step.attack.velocity) {
        const data = createEnemyProjectileData({
          id: state.nextProjectileId++, ownerId: drone.id,
          pos: { x: drone.x, y: drone.y }, damage: step.attack.damage,
          vel: step.attack.velocity, pixelToTile: GAME.PIXEL_TO_TILE
        });
        const projectile = toSimProjectile(data, 'enemy', 'plasma');
        state.projectiles.push(projectile);
        events.push({ type: 'projectile-spawned', projectile });
      } else if (step.attack.kind === 'melee') {
        applyCorePlayerHit(state, drone.x, drone.y, step.attack.damage, events);
      }
    }
  }
}

function applyCorePlayerHit(state: SimulationState, fromX: number, fromY: number, damage: number, events: SimEvent[]): void {
  const p = state.player;
  if (p.data.hp <= 0) return;
  const hit = resolvePlayerHit({
    hp: p.data.hp,
    position: { x: p.x, y: p.y },
    armor: p.data.armor,
    invuln: p.invuln,
    damage,
    source: { x: fromX, y: fromY },
    isWalkable: (x, y) => isWalkableFromState(state, x, y, PLAYER_RADIUS),
    pixelToTile: GAME.PIXEL_TO_TILE
  });
  // Blocked hits are not hurt facts: no player-hurt event, no audio/shake, no
  // HP/position write. Only real damage becomes canonical.
  if (hit.blocked) return;
  events.push({ type: 'player-hurt', damage, hit });
  p.data.hp = hit.hp;
  p.x = hit.position.x;
  p.y = hit.position.y;
  p.invuln = hit.invuln;
  p.hurtTimer = hit.hurtTimer;
  if (p.data.hp <= 0) events.push({ type: 'player-death' });
}

function stepProjectiles(state: SimulationState, dt: number, rng: RNG, events: SimEvent[]): void {
  const tickDt = dt;
  const remaining: SimProjectile[] = [];
  for (const projectile of state.projectiles) {
    const previous = { ...projectile.pos };
    const advance = advanceProjectile({
      pos: projectile.pos,
      vel: projectile.vel,
      lifetime: projectile.lifetime,
      dt: tickDt,
      tileAt: (x, y) => tileAtFromState(state, x, y),
      mapWidth: state.map.width,
      mapHeight: state.map.height
    });
    projectile.pos = advance.pos;
    projectile.lifetime = advance.lifetime;
    if (advance.expired) {
      if (advance.hitWall) events.push({ type: 'projectile-wall', x: projectile.pos.x, y: projectile.pos.y });
      continue;
    }
    let alive = true;
    if (projectile.side === 'player') {
      for (const drone of state.drones) {
        if (drone.hp <= 0 || projectile.hitIds.includes(drone.id)) continue;
        if (!projectileHitsTarget(previous, projectile.pos, { x: drone.x, y: drone.y }, PLAYER_RADIUS, projectile.radius)) continue;
        const hit = resolveEnemyHit({
          hp: drone.hp,
          position: { x: drone.x, y: drone.y },
          armor: drone.data.stats.armor,
          stunTimer: drone.data.stunTimer,
          damage: projectile.damage,
          source: projectile.pos,
          isWalkable: (x, y, radius) => isWalkableFromState(state, x, y, radius),
          pixelToTile: GAME.PIXEL_TO_TILE
        });
        events.push({ type: 'enemy-hit', enemyId: drone.id, damage: projectile.damage, crit: projectile.crit, hit });
        drone.hp = hit.hp;
        drone.x = hit.position.x;
        drone.y = hit.position.y;
        drone.data.hitFlash = hit.hitFlash;
        if (drone.hp <= 0) {
          events.push({ type: 'enemy-died', enemyId: drone.id, x: drone.x, y: drone.y });
          awardEnemyKill(state, drone.data.stats.xpValue, false, rng, events);
        }
        if (projectile.pierce > 0) {
          projectile.pierce--;
          projectile.hitIds.push(drone.id);
        } else {
          alive = false;
          break;
        }
      }
      if (!alive) {
        if (alive) remaining.push(projectile);
        continue;
      }
      for (const target of state.targets) {
        if (target.hp <= 0 || projectile.hitIds.includes(target.id)) continue;
        if (!projectileHitsTarget(previous, projectile.pos, { x: target.x, y: target.y }, target.radius, projectile.radius)) continue;
        let hit: EnemyHitResult;
        if (target.isBoss) {
          const result = resolveBossHit({ hp: target.hp, armor: target.armor, damage: projectile.damage });
          hit = { blocked: false, hp: result.hp, position: { x: target.x, y: target.y }, hitFlash: result.hitFlash, knockbackApplied: false };
          target.hp = result.hp;
        } else {
          hit = resolveEnemyHit({
            hp: target.hp,
            position: { x: target.x, y: target.y },
            armor: target.armor,
            stunTimer: 0,
            damage: projectile.damage,
            source: projectile.pos,
            isWalkable: (x, y, radius) => isWalkableFromState(state, x, y, radius),
            pixelToTile: GAME.PIXEL_TO_TILE
          });
          target.hp = hit.hp;
          target.x = hit.position.x;
          target.y = hit.position.y;
        }
        events.push({ type: 'enemy-hit', enemyId: target.id, damage: projectile.damage, crit: projectile.crit, hit });
        if (target.hp <= 0) {
          events.push({ type: 'enemy-died', enemyId: target.id, x: target.x, y: target.y });
          awardEnemyKill(state, target.xpValue, target.isBoss, rng, events);
        }
        if (projectile.pierce > 0) {
          projectile.pierce--;
          projectile.hitIds.push(target.id);
        } else {
          alive = false;
          break;
        }
      }
    } else {
      const p = state.player;
      if (p.data.hp > 0 && projectileHitsTarget(previous, projectile.pos, { x: p.x, y: p.y }, PLAYER_RADIUS, projectile.radius)) {
        applyCorePlayerHit(state, projectile.pos.x, projectile.pos.y, projectile.damage, events);
        alive = false;
      }
    }
    if (alive) remaining.push(projectile);
  }
  state.projectiles = remaining;
  state.drones = state.drones.filter((drone) => drone.hp > 0);
  state.targets = state.targets.filter((target) => target.hp > 0);
}

export function stepSimulationTicks(
  state: SimulationState,
  ticks: number,
  intent: SimulationIntent
): SimEvent[] {
  const events: SimEvent[] = [];
  const dt = SIM_TUNING.TICK_MS / 1000;
  const rng = new RNG(0);
  rng.restore(state.rngState);
  for (let i = 0; i < ticks; i++) {
    // Legal adapter/FSM commands are committed by the tick, before movement.
    processCommands(state, events);
    stepPlayer(state, intent, rng, events);
    stepDrones(state, dt, events);
    stepProjectiles(state, dt, rng, events);
    state.tick++;
  }
  state.rngState = rng.snapshot();
  return events;
}

/** Deep serializable copy (no live object references). */
export function cloneSimulationState(state: SimulationState): SimulationState {
  return JSON.parse(JSON.stringify(state)) as SimulationState;
}

/** Canonical first-slice projection. Includes every core-owned field that can
 *  affect future evolution; legacy loot/portal content is still adapter-side. */
export interface CanonicalSimulationState {
  seed: number;
  tick: number;
  rngState: number;
  mapSeed: number;
  mapMinX: number;
  mapMinY: number;
  mapHash: string;
  player: {
    x: number; y: number;
    data: PlayerData;
    dashTimer: number; invuln: number; hurtTimer: number; fireTimer: number; aimYaw: number;
  };
  drones: SimDroneState[];
  targets: SimTarget[];
  projectiles: SimProjectile[];
  pendingPlayerHits: Array<{ damage: number; fromX: number; fromY: number }>;
  pendingCommands: SimCommand[];
  nextProjectileId: number;
}

export function canonicalSimulationState(state: SimulationState): string {
  return JSON.stringify({
    seed: state.seed,
    tick: state.tick,
    rngState: state.rngState,
    mapSeed: state.map.seed,
    mapMinX: state.mapMinX,
    mapMinY: state.mapMinY,
    mapHash: payloadFingerprint(state.map),
    player: {
      x: state.player.x, y: state.player.y,
      data: JSON.parse(JSON.stringify(state.player.data)),
      dashTimer: state.player.dashTimer, invuln: state.player.invuln,
      hurtTimer: state.player.hurtTimer, fireTimer: state.player.fireTimer, aimYaw: state.player.aimYaw
    },
    drones: state.drones,
    targets: state.targets,
    projectiles: state.projectiles,
    pendingPlayerHits: state.pendingPlayerHits,
    pendingCommands: state.pendingCommands,
    nextProjectileId: state.nextProjectileId
  } as CanonicalSimulationState);
}

/** Ordered exact event projection for gameplay parity. `faceAngle` is sprite
 *  orientation only and is excluded; all damage/velocity/position/tick facts stay
 *  exact (no rounding). */
export function canonicalSimulationEvents(events: SimEvent[]): string {
  return JSON.stringify(events.map((event) => {
    if (event.type !== 'drone-step') return event;
    const { faceAngle: _faceAngle, ...step } = event.step;
    return { ...event, step };
  }));
}
