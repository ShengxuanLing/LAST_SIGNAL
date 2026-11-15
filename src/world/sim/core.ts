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

import { GAME, basePlayerData } from '../../config/game';
import { WEAPONS } from '../../config/weapons';
import { UPGRADES, applyUpgrade } from '../../config/upgrades';
import { buildEnemyData } from '../../config/enemies';
import {
  applySupply, isSupplyOfferKey, isValidTransactionId, PURCHASE_LEDGER_CAP,
  roomAt, supplyOfferPurchaseBlocker, supplyPrice, terminalRooms
} from '../../config/supplies';
import { RNG } from '../../core/random';
import type { EnemyData, MapData, PlayerData, ProjectileData, Tile, Vec2 } from '../../types';
import type { GridPoint } from './rules';
import { canonicalJson, payloadFingerprint } from '../../ai-native/protocol';
import {
  createSignalDevice, commitSignalScan, commitSignalJam, commitToggleRelay,
  commitSignalPower, tickSignalDevice, type SimSignalDevice, type SignalActorKind,
  type SignalLegality
} from './signalState';
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

export interface SimEchoState {
  /** Independent actor identity; never the player id (0). */
  actorId: number;
  x: number;
  y: number;
  /** Base player-shaped stats + pulse only: no upgrades, no shared player data. */
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

export type SimLootKind = 'health' | 'currency' | 'upgrade' | 'weapon' | 'ability' | 'restore';

export interface SimLoot {
  id: number;
  x: number;
  y: number;
  kind: SimLootKind;
  key: string;
  amount: number;
  bob: number;
}

export type SimCommand =
  | { type: 'move-target'; targetId: number; x: number; y: number }
  | { type: 'spawn-loot'; x: number; y: number; kind: SimLootKind; key: string; amount: number; bob?: number }
  | { type: 'spawn-enemy-projectile'; ownerId: number; x: number; y: number; damage: number; vel: Vec2; lifetime?: number }
  | { type: 'teleport-player'; x: number; y: number; healToFull: boolean }
  | { type: 'room-enter'; roomId: number; roomKind: string; gx: number; gy: number; w: number; h: number; depth: number; savedPortalTarget: number | null; neighbors: number[]; enemyCount: number; enemyPositions: Vec2[]; resourceCount: number; resourcePositions: Vec2[]; firstEnemyId: number }
  | { type: 'set-target-hp'; targetId: number; hp: number }
  | { type: 'heal-player'; amount: number }
  | { type: 'add-currency'; amount: number }
  | { type: 'add-xp'; base: number }
  | { type: 'apply-upgrade'; key: string; level: number }
  | { type: 'equip-weapon'; key: string }
  | { type: 'purchase-supply'; transactionId: string; offerKey: string; roomId: number }
  | { type: 'set-player-data'; data: PlayerData }
  | { type: 'spawn-echo'; x: number; y: number }
  | { type: 'remove-echo' }
  | { type: 'echo-hit'; damage: number; fromX: number; fromY: number }
  | { type: 'spawn-signal-device'; deviceId: string; roomId: number; x: number; y: number }
  | { type: 'signal-scan'; actor: SignalActorKind }
  | { type: 'signal-jam'; actor: SignalActorKind }
  | { type: 'toggle-relay'; enabled: boolean }
  | { type: 'signal-power'; powered: boolean };

export interface SimProjectile {
  id: number;
  ownerId: number;
  side: 'player' | 'enemy';
  source: 'player' | 'echo' | 'enemy';
  /** Echo shots carry their actor id; never inferred from a numeric drone id. */
  actorId?: number;
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
  /** Optional independent companion actor (P3-a). Absent = unchanged C1/C2. */
  echo?: SimEchoState;
  /** Optional ONE real Relay device (P3-b B). Absent = unchanged C1/C2/C3c. */
  signal?: SimSignalDevice;
  drones: SimDroneState[];
  /** Legacy non-drone enemies and Boss; HP/position are core-owned. */
  targets: SimTarget[];
  projectiles: SimProjectile[];
  pendingPlayerHits: Array<{ damage: number; fromX: number; fromY: number }>;
  pendingCommands: SimCommand[];
  /** Recently committed supply transactions (session dedup ledger, not persisted). */
  purchaseTransactions: string[];
  loot: SimLoot[];
  nextLootId: number;
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
  | { type: 'enemy-hit'; enemyId: number; damage: number; crit: boolean; hit: EnemyHitResult; byActorId?: number }
  | { type: 'enemy-died'; enemyId: number; x: number; y: number }
  | { type: 'player-hurt'; damage: number; hit: PlayerHitResult }
  | { type: 'player-death' }
  | { type: 'echo-moved'; actorId: number; position: Vec2; velocity: Vec2; dashTimer: number; dashStarted: boolean }
  | { type: 'echo-fired'; actorId: number; spec: WeaponFireSpec }
  | { type: 'echo-hurt'; actorId: number; damage: number; hit: PlayerHitResult }
  | { type: 'echo-death'; actorId: number }
  | { type: 'echo-spawned'; actorId: number; x: number; y: number }
  | { type: 'echo-despawned'; actorId: number }
  | { type: 'player-healed'; amount: number; hp: number }
  | { type: 'currency-gained'; amount: number; currency: number }
  | { type: 'xp-gained'; amount: number; xp: number; level: number }
  | { type: 'player-levelup'; level: number }
  | { type: 'player-upgraded'; key: string; level: number }
  | { type: 'player-equipped'; key: string }
  | { type: 'supply-purchase-result'; transactionId: string; offerKey: string; roomId: number; ok: boolean; reason?: string; price: number; currency: number; hp: number; weaponKey: string }
  | { type: 'player-reset'; data: PlayerData }
  | { type: 'loot-dropped'; loot: SimLoot }
  | { type: 'loot-collected'; id: number; kind: SimLootKind; key: string; amount: number; x: number; y: number }
  | { type: 'enemy-spawned'; id: number; kind: string; x: number; y: number; room: number; isBoss: boolean }
  | { type: 'room-generated'; roomId: number; portalTarget: number | null }
  | { type: 'projectile-wall'; x: number; y: number }
  | { type: 'signal-device-spawned'; deviceId: string; roomId: number; x: number; y: number }
  | { type: 'signal-scanned'; actorId: number; found: boolean; energy: number; cooldownTicks: number; evidence: unknown[] }
  | { type: 'signal-jammed'; actorId: number; energy: number; cooldownTicks: number; relay: string; jamExpiresAtTick: number }
  | { type: 'signal-relay-changed'; relay: string; manualEnabled: boolean; powered: boolean }
  | { type: 'signal-evidence-expired'; deviceId: string }
  | { type: 'signal-energy'; actorId: number; energy: number; scanCooldownTicks: number; jamCooldownTicks: number };

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
    purchaseTransactions: [],
    loot: [],
    nextLootId: 1,
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

/** The echo is a separate actor: same pure combat rules, its own base stats. */
export const ECHO_ACTOR_ID = 1;

/** Base stats + pulse only. No upgrades/abilities/currency from the player. */
export function echoPlayerData(): PlayerData {
  const base = basePlayerData();
  const pulse = WEAPONS.pulse;
  const data: PlayerData = {
    ...base,
    level: 1,
    xp: 0,
    xpToNext: 30,
    currency: 0,
    weaponKey: 'pulse',
    weapons: [{
      key: 'pulse', level: 1,
      ammo: pulse.magazine ?? -1,
      magazine: pulse.magazine ?? -1,
      reloading: false, reloadTimer: 0
    }],
    upgrades: [],
    abilities: []
  };
  return data;
}

export function registerEcho(state: SimulationState, x: number, y: number): SimEchoState {
  const echo: SimEchoState = {
    actorId: ECHO_ACTOR_ID,
    x,
    y,
    data: echoPlayerData(),
    dashTimer: 0,
    invuln: 0,
    hurtTimer: 0,
    fireTimer: 0,
    aimYaw: 0
  };
  state.echo = echo;
  return echo;
}

export function removeEcho(state: SimulationState): boolean {
  if (!state.echo) return false;
  delete state.echo;
  return true;
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

export function enqueueCoreTargetMove(state: SimulationState, targetId: number, x: number, y: number): void {
  const target = state.targets.find((t) => t.id === targetId && t.hp > 0);
  if (target) { target.x = x; target.y = y; }
}

export function enqueueCoreTargetHp(state: SimulationState, targetId: number, hp: number): void {
  const target = state.targets.find((t) => t.id === targetId);
  if (target) target.hp = hp;
}

export function spawnCoreLoot(
  state: SimulationState,
  x: number, y: number, kind: SimLootKind, key: string, amount: number, bob = 0
): SimLoot {
  const loot: SimLoot = { id: state.nextLootId++, x, y, kind, key, amount, bob };
  state.loot.push(loot);
  return loot;
}

export function enqueueSpawnLoot(
  state: SimulationState, x: number, y: number, kind: SimLootKind, key: string, amount: number, bob = 0
): void {
  state.pendingCommands.push({ type: 'spawn-loot', x, y, kind, key, amount, bob });
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
  state: SimulationState, xpValue: number, isBoss: boolean, _rng: RNG, events: SimEvent[],
  x: number, y: number
): void {
  if (isBoss) {
    grantXp(state, xpValue, events);
    // C1 boss loot was 12 visible currency drops. Use a deterministic ring so the
    // gameplay RNG stream stays exactly crit -> regular kill loot -> next crit.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const loot = spawnCoreLoot(state, x + Math.cos(a) * 1.5, y + Math.sin(a) * 1.5,
        'currency', 'currency', 10, a);
      events.push({ type: 'loot-dropped', loot: cloneEventValue(loot) });
    }
    return;
  }
  // C1 order: roll currency, roll health, then award XP. Currency/health are
  // only settled when the visible loot is collected by stepLoot.
  const currencyRoll = _rng.float();
  const healthRoll = _rng.float();
  if (currencyRoll < 0.6) {
    const loot = spawnCoreLoot(state, x, y, 'currency', 'currency', KILL_CURRENCY_AMOUNT);
    events.push({ type: 'loot-dropped', loot: cloneEventValue(loot) });
  }
  if (healthRoll < 0.25) {
    const loot = spawnCoreLoot(state, x, y, 'health', 'health', KILL_HEALTH_AMOUNT);
    events.push({ type: 'loot-dropped', loot: cloneEventValue(loot) });
  }
  grantXp(state, xpValue, events);
}

/** Core-owned bounded LOS for the ONE Signal device (no map/seed exposure). */
function signalLegality(state: SimulationState, actor: SignalActorKind, device: SimSignalDevice): SignalLegality {
  const origin = actor === 'echo'
    ? (state.echo && state.echo.data.hp > 0 ? { x: state.echo.x, y: state.echo.y } : null)
    : { x: state.player.x, y: state.player.y };
  return {
    actorPosition: () => origin,
    hasLineOfSight: () => {
      if (!origin) return false;
      const distance = Math.hypot(device.x - origin.x, device.y - origin.y);
      const samples = Math.max(1, Math.ceil(distance / 0.25));
      for (let i = 1; i <= samples; i += 1) {
        const t = i / samples;
        if (!isWalkableFromState(state, origin.x + (device.x - origin.x) * t,
          origin.y + (device.y - origin.y) * t, 0.5)) return false;
      }
      return true;
    }
  };
}
function signalEnergyEvent(device: SimSignalDevice, actor: SignalActorKind): SimEvent {
  const r = device.actors[actor];
  return {
    type: 'signal-energy', actorId: actor === 'echo' ? ECHO_ACTOR_ID : 0,
    energy: r.energy.energy,
    scanCooldownTicks: r.cooldowns.scanCooldownTicks,
    jamCooldownTicks: r.cooldowns.jamCooldownTicks
  };
}

export function processCommands(state: SimulationState, events: SimEvent[], rngCandidate: RNG): void {
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
      case 'spawn-loot': {
        const loot = spawnCoreLoot(state, command.x, command.y, command.kind, command.key, command.amount, command.bob ?? 0);
        events.push({ type: 'loot-dropped', loot: cloneEventValue(loot) });
        break;
      }
      case 'spawn-echo': {
        registerEcho(state, command.x, command.y);
        events.push({ type: 'echo-spawned', actorId: ECHO_ACTOR_ID, x: command.x, y: command.y });
        break;
      }
      case 'remove-echo': {
        if (removeEcho(state)) events.push({ type: 'echo-despawned', actorId: ECHO_ACTOR_ID });
        break;
      }
      case 'spawn-signal-device': {
        state.signal = createSignalDevice({
          deviceId: command.deviceId, roomId: command.roomId,
          x: command.x, y: command.y, tick: state.tick
        });
        events.push({
          type: 'signal-device-spawned', deviceId: command.deviceId,
          roomId: command.roomId, x: command.x, y: command.y
        });
        break;
      }
      case 'signal-scan': {
        const device = state.signal;
        if (!device) break;
        const actor = command.actor;
        const validActor = actor === 'player' || actor === 'echo';
        const result = commitSignalScan(device, actor, state.tick, false, signalLegality(state, actor, device));
        const actorRes = validActor ? device.actors[actor] : null;
        events.push({
          type: 'signal-scanned', actorId: actor === 'echo' ? ECHO_ACTOR_ID : 0,
          found: result.found === true,
          energy: result.energy ?? (actorRes ? actorRes.energy.energy : 0),
          cooldownTicks: result.cooldownTicks ?? (actorRes ? actorRes.cooldowns.scanCooldownTicks : 0),
          evidence: result.ok ? cloneEventValue(device.evidence.filter((e) => e.observerActorId === actor)) : []
        });
        if (validActor) events.push(signalEnergyEvent(device, actor));
        break;
      }
      case 'signal-jam': {
        const device = state.signal;
        if (!device) break;
        const actor = command.actor;
        const validActor = actor === 'player' || actor === 'echo';
        const result = commitSignalJam(device, actor, state.tick, false, signalLegality(state, actor, device));
        const actorRes = validActor ? device.actors[actor] : null;
        events.push({
          type: 'signal-jammed', actorId: actor === 'echo' ? ECHO_ACTOR_ID : 0,
          energy: result.energy ?? (actorRes ? actorRes.energy.energy : 0),
          cooldownTicks: result.cooldownTicks ?? (actorRes ? actorRes.cooldowns.jamCooldownTicks : 0),
          relay: device.relay, jamExpiresAtTick: device.jammedUntilTick
        });
        if (validActor) events.push(signalEnergyEvent(device, actor));
        break;
      }
      case 'toggle-relay': {
        const device = state.signal;
        if (!device) break;
        const result = commitToggleRelay(device, command.enabled, state.tick);
        events.push({
          type: 'signal-relay-changed', relay: device.relay,
          manualEnabled: device.manualEnabled, powered: device.powered
        });
        void result;
        break;
      }
      case 'signal-power': {
        const device = state.signal;
        if (!device) break;
        commitSignalPower(device, command.powered, state.tick);
        events.push({
          type: 'signal-relay-changed', relay: device.relay,
          manualEnabled: device.manualEnabled, powered: device.powered
        });
        break;
      }
      case 'echo-hit': {
        // Legal legacy melee damage is committed by the tick, never by the adapter.
        if (state.echo) applyActorHit(state, state.echo, command.fromX, command.fromY, command.damage, events, 'echo');
        break;
      }
      case 'teleport-player': {
        // State was changed synchronously by enqueueTeleport+setPlayerPosition (Player.reset)
        // or needs to be changed now (tryInteract). Apply here — idempotent.
        const recovered = ensureWalkableFromState(state, { x: command.x, y: command.y });
        state.player.x = recovered.x;
        state.player.y = recovered.y;
        if (command.healToFull) {
          state.player.data.hp = state.player.data.maxHp;
          state.player.invuln = 1.0;
        }
        state.player.fireTimer = 0;
        events.push({ type: 'player-moved', position: recovered, velocity: { x: 0, y: 0 }, dashTimer: state.player.dashTimer, dashStarted: false });
        break;
      }
      case 'room-enter': {
        // Exact C1 order: enemy kinds, then resource-loot kinds, then portal.
        const bounds = { gx: command.gx, gy: command.gy, w: command.w, h: command.h };
        for (let i = 0; i < command.enemyCount; i++) {
          const kind = pickEnemyKindForRoom(command.roomKind, command.roomId, command.depth, rngCandidate);
          const id = command.firstEnemyId + i;
          const pos = command.enemyPositions[i] ?? { x: command.gx + 3, y: command.gy + 3 };
          const data = buildEnemyData(kind as any, command.roomId, command.depth, bounds);
          if (kind === 'drone') {
            state.drones.push({ id, x: pos.x, y: pos.y, hp: data.stats.maxHp, data, attackTimer: 0, wanderTimer: 1 });
          } else {
            state.targets.push({
              id, kind, x: pos.x, y: pos.y, hp: data.stats.maxHp, maxHp: data.stats.maxHp,
              armor: data.stats.armor, radius: 0.5, isBoss: false,
              xpValue: data.stats.xpValue, currencyValue: data.stats.currencyValue
            });
          }
          events.push({ type: 'enemy-spawned', id, kind, x: pos.x, y: pos.y, room: command.roomId, isBoss: false });
        }
        for (let i = 0; i < command.resourceCount; i++) {
          const kind: SimLootKind = rngCandidate.int(0, 1) === 0 ? 'currency' : 'health';
          const pos = command.resourcePositions[i] ?? { x: command.gx + 2, y: command.gy + 2 };
          const loot = spawnCoreLoot(state, pos.x, pos.y, kind, kind, kind === 'currency' ? 10 : 0);
          events.push({ type: 'loot-dropped', loot: cloneEventValue(loot) });
        }
        const portalTarget = command.savedPortalTarget
          ?? (command.neighbors.length > 0 ? rngCandidate.pick(command.neighbors) : null);
        events.push({ type: 'room-generated', roomId: command.roomId, portalTarget });
        break;
      }
      case 'spawn-enemy-projectile': {
        const projectile = spawnEnemyProjectile(
          state, command.ownerId, command.x, command.y, command.damage, command.vel, command.lifetime
        );
        events.push({ type: 'projectile-spawned', projectile: cloneEventValue(projectile) });
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
      case 'add-xp': {
        const { gained, levels } = addPlayerXp(state, command.base);
        events.push({ type: 'xp-gained', amount: gained, xp: state.player.data.xp, level: state.player.data.level });
        for (const level of levels) events.push({ type: 'player-levelup', level });
        break;
      }
      case 'apply-upgrade': {
        const def = UPGRADES[command.key];
        if (!def) break;
        // The core owns BOTH the effect and the recorded upgrade progress, so
        // the committed state and the saved checkpoint stay in sync.
        applyUpgrade(def, state.player.data, command.level);
        const data = state.player.data;
        const prog = data.upgrades.find((u) => u.key === command.key);
        if (prog) prog.level = command.level;
        else data.upgrades.push({ key: command.key, level: command.level });
        events.push({ type: 'player-upgraded', key: command.key, level: command.level });
        break;
      }
      case 'equip-weapon': {
        if (state.player.data.weapons.some((w) => w.key === command.key)) {
          state.player.data.weaponKey = command.key;
          events.push({ type: 'player-equipped', key: command.key });
        }
        break;
      }
      case 'purchase-supply': {
        const tx = command.transactionId;
        const key = command.offerKey;
        const price = isSupplyOfferKey(key) ? supplyPrice(key) : 0;
        const reject = (reason: string): void => {
          events.push({
            type: 'supply-purchase-result', transactionId: tx, offerKey: key,
            roomId: command.roomId, ok: false, reason, price,
            currency: state.player.data.currency, hp: state.player.data.hp,
            weaponKey: state.player.data.weaponKey
          });
        };
        // Idempotency: a recorded transaction id never re-executes. A repeated
        // id is a stable duplicate regardless of the supplied offer/room, and
        // the original record is never overwritten.
        if (state.purchaseTransactions.includes(tx)) { reject('Duplicate transaction'); break; }
        if (!isValidTransactionId(tx)) { reject('Invalid transaction id'); break; }
        // Bounded hard quota: at the cap new transactions are rejected. Old
        // records are NEVER evicted, so replay of an old id stays rejected.
        if (state.purchaseTransactions.length >= PURCHASE_LEDGER_CAP) { reject('Supply ledger full'); break; }
        if (!isSupplyOfferKey(key)) { reject('Unknown offer'); break; }
        // Commit-time validation uses the real live state, not an adapter snapshot.
        const playerRoom = roomAt(state.map.rooms, state.player.x, state.player.y);
        if (!playerRoom || playerRoom.id !== command.roomId) { reject('Not in this terminal'); break; }
        if (!terminalRooms(state.map.rooms).has(playerRoom.id)) { reject('Not a supply terminal'); break; }
        if (!playerRoom.cleared) { reject('Room not cleared'); break; }
        if (state.map.rooms.some((r) => r.spawned && !r.cleared)) { reject('Clear remaining rooms first'); break; }
        if (state.player.data.hp <= 0) { reject('Player is down'); break; }
        if (state.drones.some((d) => d.hp > 0) || state.targets.some((t) => t.hp > 0)) { reject('Clear remaining threats'); break; }
        const blocker = supplyOfferPurchaseBlocker(key, state.player.data, state.seed, playerRoom.id);
        // Every processed transaction (success or rejection) consumes ledger
        // capacity exactly once, so the ledger is strictly bounded by the cap.
        state.purchaseTransactions.push(tx);
        if (blocker) { reject(blocker); break; }
        // Atomic commit: deduct + apply on a candidate, then swap.
        const candidate = JSON.parse(JSON.stringify(state.player.data)) as PlayerData;
        candidate.currency -= price;
        applySupply(key, candidate, state.seed, playerRoom.id);
        state.player.data = candidate;
        events.push({
          type: 'supply-purchase-result', transactionId: tx, offerKey: key,
          roomId: playerRoom.id, ok: true, price,
          currency: candidate.currency, hp: candidate.hp, weaponKey: candidate.weaponKey
        });
        break;
      }
      case 'set-player-data': {
        // Restore player data & position from the checkpoint.
        state.player.data = JSON.parse(JSON.stringify(command.data)) as PlayerData;
        events.push({ type: 'player-reset', data: cloneEventValue(command.data) });
        break;
      }
    }
  }
}

export function enqueueEchoHit(
  state: SimulationState, damage: number, fromX: number, fromY: number
): void {
  state.pendingCommands.push({ type: 'echo-hit', damage, fromX, fromY });
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

/**
 * EVENT IMMUTABILITY: events are plain, value-only DTOs. Any reference to a
 * mutable part of `SimulationState` (a projectile that will move, a loot drop
 * that will bob, player data that will change) is detached at EMIT time with a
 * deep copy. History stored in a snapshot/replay therefore never changes when
 * the live state evolves. JSON copy preserves full IEEE-754 double precision
 * (round-trip), so canonical comparisons are exact, not rounded.
 */
function cloneEventValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toSimProjectile(data: ProjectileData, source: 'player' | 'echo' | 'enemy', kind: string): SimProjectile {
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

interface SimActor {
  x: number;
  y: number;
  data: PlayerData;
  dashTimer: number;
  invuln: number;
  hurtTimer: number;
  fireTimer: number;
  aimYaw: number;
}

/** Shared actor timers (fire cooldown, invuln, hurt flash, reload, regen). */
function tickActorTimers(actor: SimActor, dt: number): void {
  const p = actor;
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

/** Shared actor fire rule (cooldown, magazine/reload, projectile + event). */
function fireActor(
  state: SimulationState, p: SimActor, ownerId: number,
  source: 'player' | 'echo', kind: 'player' | 'echo',
  intent: SimulationIntent, rng: RNG, events: SimEvent[]
): void {
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
    ownerId,
    side: 'player',
    origin: { x: p.x, y: p.y },
    angle: p.aimYaw,
    spec,
    rng,
    shotIndex: 0,
    shotCount: spec.shots,
    pixelToTile: GAME.PIXEL_TO_TILE
  });
  const projectile = toSimProjectile(data, source, spec.kind);
  if (source === 'echo') projectile.actorId = ECHO_ACTOR_ID;
  state.projectiles.push(projectile);
  events.push({ type: kind === 'player' ? 'player-fired' : 'echo-fired', ...(kind === 'echo' ? { actorId: ECHO_ACTOR_ID } : {}), spec } as SimEvent);
  events.push({ type: 'projectile-spawned', projectile: cloneEventValue(projectile) });
}

function stepPlayerFire(state: SimulationState, intent: SimulationIntent, rng: RNG, events: SimEvent[]): void {
  fireActor(state, state.player, 0, 'player', 'player', intent, rng, events);
}

function stepEchoFire(state: SimulationState, intent: SimulationIntent, rng: RNG, events: SimEvent[]): void {
  if (!state.echo) return;
  fireActor(state, state.echo, ECHO_ACTOR_ID, 'echo', 'echo', intent, rng, events);
}


/** C1 pickEnemyForRoom algorithm, consuming the shared core RNG. */
function pickEnemyKindForRoom(roomKind: string, roomId: number, depth: number, rng: RNG): string {
  if (roomKind === 'elite') return rng.pick(['sentinel', 'hunter', 'stalker', 'drone']);
  const roll = (roomId * 53 + depth * 11) % 4;
  const all = ['drone', 'stalker', 'hunter', 'sentinel'];
  return rng.pick([all[roll], all[(roll + 1) % 4]]);
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

/** Shared actor movement/aim rule; event type is actor-specific. */
function stepActorMovement(
  state: SimulationState, p: SimActor, intent: SimulationIntent,
  events: SimEvent[], kind: 'player' | 'echo'
): void {
  const tickDt = SIM_TUNING.TICK_MS / 1000;
  const movedType = kind === 'player' ? 'player-moved' : 'echo-moved';
  // Preserve the existing recovery from a stuck/knockback position.
  const recovered = ensureWalkableFromState(state, { x: p.x, y: p.y });
  if (recovered.x !== p.x || recovered.y !== p.y) {
    p.x = recovered.x;
    p.y = recovered.y;
    events.push({
      type: movedType, ...(kind === 'echo' ? { actorId: ECHO_ACTOR_ID } : {}),
      position: recovered, velocity: { x: 0, y: 0 }, dashTimer: p.dashTimer, dashStarted: false
    } as SimEvent);
  }
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
      type: movedType, ...(kind === 'echo' ? { actorId: ECHO_ACTOR_ID } : {}),
      position: step.position, velocity: step.velocity,
      dashTimer: step.dashTimer, dashStarted: step.dashStarted
    } as SimEvent);
  }
}

function stepPlayer(state: SimulationState, intent: SimulationIntent, rng: RNG, events: SimEvent[]): void {
  const p = state.player;
  const tickDt = SIM_TUNING.TICK_MS / 1000;
  applyPendingPlayerHits(state, events);
  tickActorTimers(p, tickDt);
  stepActorMovement(state, p, intent, events, 'player');
  stepPlayerFire(state, intent, rng, events);
}

/** Echo runs through the same pure rules, on its own actor state. */
function stepEcho(state: SimulationState, intent: SimulationIntent, rng: RNG, events: SimEvent[]): void {
  const e = state.echo;
  if (!e || e.data.hp <= 0) return;
  const tickDt = SIM_TUNING.TICK_MS / 1000;
  tickActorTimers(e, tickDt);
  stepActorMovement(state, e, intent, events, 'echo');
  stepEchoFire(state, intent, rng, events);
}

/** Nearest living actor (player or echo) is the legal drone target. */
function chooseActorTarget(state: SimulationState, x: number, y: number): SimActor {
  const actor = state.echo && state.echo.data.hp > 0 ? state.echo : null;
  if (!actor) return state.player;
  if (state.player.data.hp <= 0) return actor;
  const dPlayer = (state.player.x - x) ** 2 + (state.player.y - y) ** 2;
  const dEcho = (actor.x - x) ** 2 + (actor.y - y) ** 2;
  return dEcho < dPlayer ? actor : state.player;
}

function stepDrones(state: SimulationState, dt: number, events: SimEvent[]): void {
  for (const drone of state.drones) {
    if (drone.hp <= 0) continue;
    const target = chooseActorTarget(state, drone.x, drone.y);
    // Exact pre-step timer decrements from Enemy.update(), now on the core.
    drone.data.hitFlash = Math.max(0, drone.data.hitFlash - dt);
    drone.attackTimer = Math.max(0, drone.attackTimer - dt);
    drone.wanderTimer -= dt;
    drone.data.stateTimer -= dt;
    const step = stepDroneAi({
      dt,
      position: { x: drone.x, y: drone.y },
      player: { x: target.x, y: target.y },
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
    drone.attackTimer = step.attackTimer;
    // Keep the diagnostic target id honest when the drone locked the echo.
    if (target === state.echo) step.targetId = ECHO_ACTOR_ID;
    drone.data.targetId = step.targetId;
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
        events.push({ type: 'projectile-spawned', projectile: cloneEventValue(projectile) });
      } else if (step.attack.kind === 'melee') {
        applyActorHit(state, target, drone.x, drone.y, step.attack.damage, events, target === state.echo ? 'echo' : 'player');
      }
    }
  }
}

/** Shared actor hit rule; blocked hits produce no canonical hurt fact. */
function applyActorHit(
  state: SimulationState, p: SimActor, fromX: number, fromY: number,
  damage: number, events: SimEvent[], kind: 'player' | 'echo'
): void {
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
  events.push({ type: kind === 'player' ? 'player-hurt' : 'echo-hurt', ...(kind === 'echo' ? { actorId: ECHO_ACTOR_ID } : {}), damage, hit } as SimEvent);
  p.data.hp = hit.hp;
  p.x = hit.position.x;
  p.y = hit.position.y;
  p.invuln = hit.invuln;
  p.hurtTimer = hit.hurtTimer;
  if (p.data.hp <= 0) {
    events.push(kind === 'player' ? { type: 'player-death' } : { type: 'echo-death', actorId: ECHO_ACTOR_ID });
  }
}

function applyCorePlayerHit(state: SimulationState, fromX: number, fromY: number, damage: number, events: SimEvent[]): void {
  applyActorHit(state, state.player, fromX, fromY, damage, events, 'player');
}

function stepLoot(state: SimulationState, dt: number, events: SimEvent[]): void {
  const p = state.player;
  const remaining: SimLoot[] = [];
  // `pickupRange` is configured in PIXELS; loot/player positions are grid tiles.
  // Convert with the game's real scale so the magnet is a bounded local pull,
  // not a map-wide vacuum (the C1 code compared pixels against tile distance).
  const pickupRadius = (p.data.pickupRange ?? 3) / GAME.PIXEL_TO_TILE;
  for (const loot of state.loot) {
    loot.bob += dt * 4;
    const dx = p.x - loot.x, dy = p.y - loot.y;
    const d = Math.hypot(dx, dy);
    if (d > 0 && d < pickupRadius) {
      const pull = 120 * (1 - d / pickupRadius);
      loot.x += (dx / d) * pull * dt;
      loot.y += (dy / d) * pull * dt;
    }
    // C1 pickup threshold: player radius + 12 world units.
    if (d < PLAYER_RADIUS + 12) {
      if (loot.kind === 'health') {
        const hp = healPlayer(state, 30);
        events.push({ type: 'player-healed', amount: 30, hp });
      } else if (loot.kind === 'restore') {
        const hp = healPlayer(state, p.data.maxHp);
        events.push({ type: 'player-healed', amount: p.data.maxHp, hp });
      } else if (loot.kind === 'currency') {
        const amount = loot.amount || 10;
        const currency = addCurrency(state, amount);
        events.push({ type: 'currency-gained', amount, currency });
      }
      events.push({ type: 'loot-collected', id: loot.id, kind: loot.kind, key: loot.key, amount: loot.amount, x: loot.x, y: loot.y });
      continue;
    }
    remaining.push(loot);
  }
  state.loot = remaining;
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
        events.push({
          type: 'enemy-hit', enemyId: drone.id, damage: projectile.damage, crit: projectile.crit, hit,
          ...(projectile.source === 'echo' ? { byActorId: ECHO_ACTOR_ID } : {})
        } as SimEvent);
        drone.hp = hit.hp;
        drone.x = hit.position.x;
        drone.y = hit.position.y;
        drone.data.hitFlash = hit.hitFlash;
        if (drone.hp <= 0) {
          events.push({ type: 'enemy-died', enemyId: drone.id, x: drone.x, y: drone.y });
          awardEnemyKill(state, drone.data.stats.xpValue, false, rng, events, drone.x, drone.y);
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
        events.push({
          type: 'enemy-hit', enemyId: target.id, damage: projectile.damage, crit: projectile.crit, hit,
          ...(projectile.source === 'echo' ? { byActorId: ECHO_ACTOR_ID } : {})
        } as SimEvent);
        if (target.hp <= 0) {
          events.push({ type: 'enemy-died', enemyId: target.id, x: target.x, y: target.y });
          awardEnemyKill(state, target.xpValue, target.isBoss, rng, events, target.x, target.y);
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
      const targets: SimActor[] = [state.player];
      if (state.echo && state.echo.data.hp > 0) targets.push(state.echo);
      for (const actor of targets) {
        if (actor.data.hp <= 0) continue;
        if (!projectileHitsTarget(previous, projectile.pos, { x: actor.x, y: actor.y }, PLAYER_RADIUS, projectile.radius)) continue;
        applyActorHit(state, actor, projectile.pos.x, projectile.pos.y, projectile.damage, events, actor === state.echo ? 'echo' : 'player');
        alive = false;
        break;
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
  intent: SimulationIntent,
  echoIntent?: SimulationIntent
): SimEvent[] {
  const events: SimEvent[] = [];
  const dt = SIM_TUNING.TICK_MS / 1000;
  const rng = new RNG(0);
  rng.restore(state.rngState);
  for (let i = 0; i < ticks; i++) {
    // Legal adapter/FSM commands are committed by the tick, before movement.
    processCommands(state, events, rng);
    if (state.signal) {
      const changed = tickSignalDevice(state.signal, state.tick, false);
      if (changed) {
        events.push({
          type: 'signal-relay-changed', relay: state.signal.relay,
          manualEnabled: state.signal.manualEnabled, powered: state.signal.powered
        });
      }
    }
    stepPlayer(state, intent, rng, events);
    if (echoIntent) stepEcho(state, echoIntent, rng, events);
    stepDrones(state, dt, events);
    stepProjectiles(state, dt, rng, events);
    stepLoot(state, dt, events);
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
  echo?: SimEchoState;
  signal?: SimSignalDevice;
  drones: SimDroneState[];
  targets: SimTarget[];
  projectiles: SimProjectile[];
  pendingPlayerHits: Array<{ damage: number; fromX: number; fromY: number }>;
  pendingCommands: SimCommand[];
  purchaseTransactions: string[];
  loot: SimLoot[];
  nextLootId: number;
  nextProjectileId: number;
}

export function canonicalSimulationState(state: SimulationState): string {
  // STABLE canonical projection: recursive key sorting (`canonicalJson`) so a
  // value-identical object reconstructed in a different insertion order (e.g.
  // restored from a JSON transport) hashes identically. Arrays keep their order
  // and numbers keep full precision; nothing is rounded or re-sequenced.
  return canonicalJson({
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
    ...(state.echo ? { echo: state.echo } : {}),
    ...(state.signal ? { signal: state.signal } : {}),
    drones: state.drones,
    targets: state.targets,
    projectiles: state.projectiles,
    pendingPlayerHits: state.pendingPlayerHits,
    pendingCommands: state.pendingCommands,
    purchaseTransactions: state.purchaseTransactions,
    loot: state.loot,
    nextLootId: state.nextLootId,
    nextProjectileId: state.nextProjectileId
  } as CanonicalSimulationState);
}

/** Ordered exact event projection for gameplay parity. `faceAngle` is sprite
 *  orientation only and is excluded; all damage/velocity/position/tick facts stay
 *  exact (no rounding). */
export function canonicalSimulationEvents(events: SimEvent[]): string {
  return canonicalJson(events.map((event) => {
    if (event.type !== 'drone-step') return event;
    const { faceAngle: _faceAngle, ...step } = event.step;
    return { ...event, step };
  }));
}
