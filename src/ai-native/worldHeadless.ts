// AI-NATIVE-02 C3-c — HEADLESS same-core world runtime.
//
// This is NOT a second simulation. It drives the SAME authoritative
// `src/world/sim/core.ts` state machine (`createSimulationState` /
// `stepSimulationTicks` / `processCommands`) that the rendered Phaser World
// uses, with the REAL `MapGenerator` + `config/game` + `config/enemies` +
// `config/weapons`. No Phaser, no DOM, no window, no localStorage, no camera,
// no renderer, no wall clock.
//
// Boundaries:
//  - the only state writer is the core tick, exactly like the rendered game;
//  - observations use the SAME legal perception crop as the rendered link
//    (bounded grid radius + explored rooms + line of sight), never a full map;
//  - seed / map / RNG / pending commands / purchase ledger are present in the
//    OWNER frame (Dev-only) and NEVER in a Player observation;
//  - a headless session starts in a REAL generated combat room with a REAL
//    `drone` built from `buildEnemyData` and the REAL `pulse` weapon. Empty
//    scenes are not used to fake throughput.

import { basePlayerData } from '../config/game';
import { buildEnemyData } from '../config/enemies';
import { roomAt } from '../config/supplies';
import { canonicalJson, payloadFingerprint } from './protocol';
import {
  assignRoles, guaranteeReachable, MapGenerator, roomDepth
} from '../world/MapGenerator';
import {
  canonicalSimulationEvents, canonicalSimulationState, cloneSimulationState,
  createSimulationState, registerDrone, stepSimulationTicks, tileAtFromState,
  isWalkableFromState,
  type SimEvent, type SimulationIntent, type SimulationState
} from '../world/sim/core';
import type { EnemyKind, MapData, PlayerData, Room } from '../types';
import { buildWorldObservation } from './worldObservation';
import { gridLineOfSight, WORLD_PERCEPTION } from './worldPerception';
import {
  WORLD_LIMITS, WORLD_PROTOCOL_VERSION, WORLD_SCHEMA_V1,
  type WorldObservationV1
} from './worldProtocol';

export const HEADLESS_FRAME_SCHEMA = 'last_signal.world-headless.frame.v1' as const;
export const HEADLESS_FRAME_VERSION = 1 as const;
/** Legal tick budget for one headless step (also the C3-a TTL ceiling). */
export const HEADLESS_MAX_TICKS_PER_STEP = 1000;
export const HEADLESS_MAX_SESSIONS = WORLD_LIMITS.MAX_SESSIONS;
export const HEADLESS_MAX_EVENTS = 20_000;
export const HEADLESS_MAX_ACTION_LOG = 4_096;
export const HEADLESS_MAX_FRAME_BYTES = 2 * 1024 * 1024;

export type HeadlessStatus = 'running' | 'cleared' | 'dead';

export interface HeadlessMapIdentity {
  seed: number;
  mapHash: string;
  roomCount: number;
  startRoomId: number | null;
  combatRoomId: number | null;
}

export interface HeadlessActionLogEntry {
  tick: number;
  actionId: string;
  requestId: string;
  appliedTick: number;
}

/** A full OWNER reproduction frame. Dev-only; never handed to a Player tool. */
export interface HeadlessWorldFrame {
  schema: typeof HEADLESS_FRAME_SCHEMA;
  version: typeof HEADLESS_FRAME_VERSION;
  epoch: number;
  sim: SimulationState;
  events: SimEvent[];
  actionLog: HeadlessActionLogEntry[];
  enteredRooms: number[];
  status: HeadlessStatus;
  kills: number;
  shots: number;
  damageTaken: number;
  mapIdentity: HeadlessMapIdentity;
}

export interface HeadlessRunStep {
  ticks: number;
  intent: SimulationIntent;
}

export const NEUTRAL_INTENT: SimulationIntent = {
  move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false
};

export function neutralIntent(): SimulationIntent {
  return { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
}

/** Pure WorldActionV1 -> core SimulationIntent. Mirrors the rendered C3-b
 *  conversion without importing any rendered/browser controller module. */
export function intentFromWorldAction(action: {
  type: 'move' | 'stop' | 'aim' | 'fire' | 'interact';
  dir?: { x: number; y: number };
  target?: { x: number; y: number };
  ticks?: number;
}): { intent: SimulationIntent; ticks: number } {
  const ticks = Math.max(1, Math.min(WORLD_LIMITS.MAX_ACTION_TICKS, Math.floor(action.ticks ?? 1)));
  if (action.type === 'move') {
    const dir = action.dir ?? { x: 0, y: 0 };
    const len = Math.hypot(dir.x, dir.y) || 1;
    return {
      intent: { move: { x: dir.x / len, y: dir.y / len }, dash: false, fire: false, aim: null, interact: false },
      ticks
    };
  }
  if (action.type === 'fire') {
    return {
      intent: { move: { x: 0, y: 0 }, dash: false, fire: true, aim: action.target ?? null, interact: false },
      ticks
    };
  }
  if (action.type === 'aim') {
    return {
      intent: { move: { x: 0, y: 0 }, dash: false, fire: false, aim: action.target ?? null, interact: false },
      ticks
    };
  }
  if (action.type === 'interact') {
    return {
      intent: { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: true },
      ticks
    };
  }
  return { intent: neutralIntent(), ticks };
}

function playerData(): PlayerData {
  const base = basePlayerData();
  return {
    ...base,
    level: 1, xp: 0, xpToNext: 30, currency: 0,
    weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: []
  } as PlayerData;
}

/** REAL map: same generator + role assignment + reachability fix as the game. */
export function generateRealMap(seed: number): MapData {
  const gen = new MapGenerator(seed);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  return map;
}

function chooseCombatRoom(map: MapData): Room {
  const start = map.rooms.find((r) => r.kind === 'start');
  const combat = start?.connectedTo
    .map((id) => map.rooms[id])
    .find((r) => r && r.kind === 'combat')
    ?? map.rooms.find((r) => r.kind === 'combat')
    ?? map.rooms.find((r) => r.kind === 'start')
    ?? map.rooms[0];
  if (!combat) throw new Error('generated map has no rooms');
  return combat;
}

/** Find two walkable grid cells inside a real room with a clear straight line. */
function findPlacement(sim: SimulationState, room: Room): { player: { x: number; y: number }; drone: { x: number; y: number } } {
  const gap = 3;
  const walkable = (x: number, y: number): boolean => isWalkableFromState(sim, x, y, 0.5);
  for (let gy = room.gy + 1; gy < room.gy + room.h - 1; gy += 1) {
    for (let gx = room.gx + 1; gx < room.gx + room.w - 1; gx += 1) {
      if (!walkable(gx, gy)) continue;
      let clear = true;
      for (let d = 1; d <= gap; d += 1) {
        if (!walkable(gx + d, gy)) { clear = false; break; }
      }
      if (!clear) continue;
      return { player: { x: gx + 0.5, y: gy + 0.5 }, drone: { x: gx + gap + 0.5, y: gy + 0.5 } };
    }
  }
  throw new Error(`combat room ${room.id} has no walkable player/drone pair`);
}

export interface HeadlessWorldOptions {
  seed: number;
}

export class HeadlessWorld {
  private sim: SimulationState;
  private entered = new Set<number>();
  private events: SimEvent[] = [];
  private actionLog: HeadlessActionLogEntry[] = [];
  private status: HeadlessStatus = 'running';
  private kills = 0;
  private shots = 0;
  private damageTaken = 0;
  /** Monotonic event counter (the retained `events` array is bounded). */
  private totalEventCount = 0;
  private epoch: number;
  private mapIdentity: HeadlessMapIdentity;

  constructor(options: HeadlessWorldOptions) {
    const seed = options.seed >>> 0;
    const map = generateRealMap(seed);
    const combatRoom = chooseCombatRoom(map);
    const startRoom = map.rooms.find((r) => r.kind === 'start');
    const sim = createSimulationState({
      seed, map, playerData: playerData(), playerX: 0, playerY: 0
    });
    const placement = findPlacement(sim, combatRoom);
    sim.player.x = placement.player.x;
    sim.player.y = placement.player.y;

    const depths = roomDepth(map, startRoom?.id ?? 0);
    const depth = depths.get(combatRoom.id) ?? 0;
    const data = buildEnemyData('drone', combatRoom.id, depth, {
      gx: combatRoom.gx, gy: combatRoom.gy, w: combatRoom.w, h: combatRoom.h
    });
    registerDrone(sim, {
      id: 1, x: placement.drone.x, y: placement.drone.y,
      hp: data.stats.maxHp, data, attackTimer: 0, wanderTimer: 1000
    });

    this.sim = sim;
    this.epoch = 1;
    if (startRoom) this.entered.add(startRoom.id);
    this.entered.add(combatRoom.id);
    this.mapIdentity = {
      seed,
      mapHash: payloadFingerprint(canonicalJson(map)),
      roomCount: map.rooms.length,
      startRoomId: startRoom?.id ?? null,
      combatRoomId: combatRoom.id
    };
  }

  get state(): SimulationState { return cloneSimulationState(this.sim); }
  get tick(): number { return this.sim.tick; }
  get currentEpoch(): number { return this.epoch; }
  get runStatus(): HeadlessStatus { return this.status; }
  get identity(): HeadlessMapIdentity { return { ...this.mapIdentity }; }
  get seed(): number { return this.sim.seed; }

  /** Cheap live counters for hot loops (inspect() hashes the whole state). */
  get liveDrones(): number { return this.sim.drones.reduce((n, d) => n + (d.hp > 0 ? 1 : 0), 0); }
  get liveTargets(): number { return this.sim.targets.reduce((n, t) => n + (t.hp > 0 ? 1 : 0), 0); }
  get eventsCount(): number { return this.events.length; }
  get eventTotal(): number { return this.totalEventCount; }
  get killCount(): number { return this.kills; }
  get shotCount(): number { return this.shots; }
  get damageTotal(): number { return this.damageTaken; }
  get playerHp(): number { return this.sim.player.data.hp; }

  private roomIdAt(x: number, y: number): number | null {
    return roomAt(this.sim.map.rooms, x, y)?.id ?? null;
  }

  /** Same legal perception predicate as the rendered World (F-01/F-02). */
  private isPerceivable(x: number, y: number): boolean {
    return gridLineOfSight({ x, y }, {
      center: { x: this.sim.player.x, y: this.sim.player.y },
      radiusTiles: WORLD_PERCEPTION.radiusTiles,
      isExplored: (sx, sy) => {
        const id = this.roomIdAt(sx, sy);
        return id !== null && this.entered.has(id);
      },
      isOpaque: (sx, sy) => tileAtFromState(this.sim, Math.floor(sx), Math.floor(sy)).type === 'wall',
      stepTiles: WORLD_PERCEPTION.losStepTiles
    });
  }

  /** C3-a `WorldObservationV1`: identical shape to the rendered `--world` tool. */
  observation(epoch = this.epoch): WorldObservationV1 {
    const s = this.sim;
    const enemies = [
      ...s.drones.filter((d) => d.hp > 0).map((d) => ({
        id: d.id, kind: d.data.kind, x: d.x, y: d.y, alive: true, roomId: d.data.spawnRoom
      })),
      ...s.targets.filter((t) => t.hp > 0).map((t) => ({
        id: t.id, kind: t.kind, x: t.x, y: t.y, alive: true, roomId: this.roomIdAt(t.x, t.y) ?? -1
      }))
    ];
    const view = buildWorldObservation({
      player: {
        x: s.player.x, y: s.player.y, alive: s.player.data.hp > 0,
        hp: s.player.data.hp, maxHp: s.player.data.maxHp
      },
      roomId: this.roomIdAt(s.player.x, s.player.y),
      enemies,
      boss: null,
      portal: null,
      perception: {
        basis: 'grid-radius+explored+line-of-sight',
        center: { x: s.player.x, y: s.player.y },
        radiusTiles: WORLD_PERCEPTION.radiusTiles,
        probeRadiusTiles: WORLD_PERCEPTION.probeRadiusTiles,
        requiresExplored: true, requiresLineOfSight: true
      },
      isPerceivable: (x, y) => this.isPerceivable(x, y)
    });
    const perceived = new Set(view.perceivedActors.map((a) => a.id));
    const weapon = s.player.data.weapons.find((w) => w.key === s.player.data.weaponKey);
    const drones = s.drones
      .filter((d) => d.hp > 0 && perceived.has(d.id))
      .map((d) => ({ id: d.id, kind: d.data.kind, x: d.x, y: d.y, hp: d.hp, state: d.data.state }));
    return {
      schema: WORLD_SCHEMA_V1,
      protocolVersion: WORLD_PROTOCOL_VERSION,
      epoch,
      tick: s.tick,
      roomId: view.roomId,
      player: {
        x: s.player.x, y: s.player.y, hp: s.player.data.hp, maxHp: s.player.data.maxHp,
        aimYaw: s.player.aimYaw, weaponKey: s.player.data.weaponKey,
        ammo: weapon?.ammo ?? -1, magazine: weapon?.magazine ?? -1
      },
      drones,
      projectiles: s.projectiles.map((p) => ({
        id: p.id, side: p.side, kind: p.kind, x: p.pos.x, y: p.pos.y,
        vx: p.vel.x, vy: p.vel.y, damage: p.damage, lifetime: p.lifetime
      })),
      availableActions: ['move', 'stop', 'aim', 'fire', 'interact']
    };
  }

  /** Legal core ticks. Only `stepSimulationTicks` mutates the state. */
  runSteps(steps: readonly HeadlessRunStep[], tickCap = HEADLESS_MAX_TICKS_PER_STEP): SimEvent[] {
    const collected: SimEvent[] = [];
    let used = 0;
    for (const step of steps) {
      const ticks = Math.max(0, Math.min(Math.floor(step.ticks), tickCap - used));
      if (ticks <= 0) break;
      used += ticks;
      const events = stepSimulationTicks(this.sim, ticks, step.intent);
      for (const event of events) this.accountForEvent(event);
      collected.push(...events);
      this.totalEventCount += events.length;
      this.events.push(...events);
      if (this.events.length > HEADLESS_MAX_EVENTS) {
        this.events = this.events.slice(-HEADLESS_MAX_EVENTS);
      }
      const id = this.roomIdAt(this.sim.player.x, this.sim.player.y);
      if (id !== null) this.entered.add(id);
      if (used >= tickCap) break;
    }
    return collected;
  }

  private accountForEvent(event: SimEvent): void {
    if (event.type === 'enemy-died') this.kills += 1;
    if (event.type === 'player-fired') this.shots += 1;
    if (event.type === 'player-hurt') this.damageTaken += event.damage ?? 0;
    if (event.type === 'player-death' || this.sim.player.data.hp <= 0) this.status = 'dead';
  }

  refreshStatus(): HeadlessStatus {
    if (this.sim.player.data.hp <= 0) this.status = 'dead';
    else if (this.sim.drones.every((d) => d.hp <= 0) && this.sim.targets.every((t) => t.hp <= 0)) {
      this.status = 'cleared';
    }
    return this.status;
  }

  recordApplied(actionId: string, requestId: string, appliedTick: number): void {
    this.actionLog.push({ tick: this.sim.tick, actionId, requestId, appliedTick });
    if (this.actionLog.length > HEADLESS_MAX_ACTION_LOG) this.actionLog.shift();
  }

  /** Canonical state/event projections (the SAME functions Node parity uses). */
  canonicalState(): string { return canonicalSimulationState(this.sim); }
  canonicalEvents(): string { return canonicalSimulationEvents(this.events); }

  /**
   * Build a headless world from a RAW `SimulationState` (e.g. a rendered owner
   * snapshot) for Rendered<->Headless canonical parity. Deterministic: the
   * replay uses the same core tick function, not a second rule set.
   */
  static fromSimulationState(sim: SimulationState, enteredRooms: readonly number[] = []): HeadlessWorld {
    const world = Object.create(HeadlessWorld.prototype) as HeadlessWorld;
    (world as any).sim = cloneSimulationState(sim);
    (world as any).events = [];
    (world as any).actionLog = [];
    (world as any).entered = new Set(enteredRooms);
    (world as any).status = 'running';
    (world as any).kills = 0;
    (world as any).shots = 0;
    (world as any).damageTaken = 0;
    (world as any).totalEventCount = 0;
    (world as any).epoch = 1;
    const map = sim.map;
    const startRoom = map.rooms.find((r) => r.kind === 'start');
    (world as any).mapIdentity = {
      seed: sim.seed,
      mapHash: payloadFingerprint(canonicalJson(map)),
      roomCount: map.rooms.length,
      startRoomId: startRoom?.id ?? null,
      combatRoomId: roomAt(map.rooms, sim.player.x, sim.player.y)?.id ?? null
    };
    return world;
  }

  /** Bounded debug projection. Dev/OWNER only; never returned by Player tools. */
  inspect(): Record<string, unknown> {
    this.refreshStatus();
    return {
      tick: this.sim.tick,
      epoch: this.epoch,
      status: this.status,
      seed: this.sim.seed,
      mapHash: this.mapIdentity.mapHash,
      roomId: this.roomIdAt(this.sim.player.x, this.sim.player.y),
      player: { x: this.sim.player.x, y: this.sim.player.y, hp: this.sim.player.data.hp },
      liveDrones: this.sim.drones.filter((d) => d.hp > 0).length,
      liveTargets: this.sim.targets.filter((t) => t.hp > 0).length,
      projectiles: this.sim.projectiles.length,
      pendingCommands: this.sim.pendingCommands.length,
      rngState: this.sim.rngState,
      purchaseLedger: this.sim.purchaseTransactions.length,
      enteredRooms: [...this.entered],
      kills: this.kills, shots: this.shots, damageTaken: this.damageTaken,
      eventCount: this.totalEventCount,
      canonicalStateHash: payloadFingerprint(canonicalSimulationState(this.sim)),
      canonicalEventsHash: payloadFingerprint(canonicalSimulationEvents(this.events))
    };
  }

  /** Full owner frame: state + commands + RNG + ledger + map identity + events. */
  snapshot(): HeadlessWorldFrame {
    this.refreshStatus();
    return {
      schema: HEADLESS_FRAME_SCHEMA,
      version: HEADLESS_FRAME_VERSION,
      epoch: this.epoch,
      sim: cloneSimulationState(this.sim),
      events: this.events.slice(-HEADLESS_MAX_EVENTS) as SimEvent[],
      actionLog: this.actionLog.slice(),
      enteredRooms: [...this.entered],
      status: this.status,
      kills: this.kills,
      shots: this.shots,
      damageTaken: this.damageTaken,
      mapIdentity: { ...this.mapIdentity }
    };
  }

  /** Owner restore. Bumps the epoch; rejects malformed / oversized frames. */
  restore(frame: unknown): { ok: true; epoch: number } | { ok: false; code: string; messageKey: string } {
    if (!isHeadlessFrame(frame)) {
      return { ok: false, code: 'E_SNAPSHOT_INVALID', messageKey: 'world.headless_frame_invalid' };
    }
    if (canonicalJson(frame).length > HEADLESS_MAX_FRAME_BYTES) {
      return { ok: false, code: 'E_RESOURCE_LIMIT', messageKey: 'world.headless_frame_too_large' };
    }
    this.sim = cloneSimulationState(frame.sim);
    this.events = (frame.events as SimEvent[]).slice(-HEADLESS_MAX_EVENTS);
    this.actionLog = (frame.actionLog as HeadlessActionLogEntry[]).slice(-HEADLESS_MAX_ACTION_LOG);
    this.entered = new Set(frame.enteredRooms as number[]);
    this.status = frame.status as HeadlessStatus;
    this.kills = frame.kills as number;
    this.shots = frame.shots as number;
    this.damageTaken = frame.damageTaken as number;
    this.mapIdentity = frame.mapIdentity as HeadlessMapIdentity;
    // A restore invalidates the old epoch, exactly like C3-a yield/restore.
    this.epoch = Math.max(this.epoch + 1, (frame.epoch as number) + 1);
    return { ok: true, epoch: this.epoch };
  }

  /**
   * Deterministic replay: restore the given START frame, re-run the same
   * ordered steps, and compare with THIS session's real canonical state and
   * event stream. Returns REAL divergence information, never a canned PASS.
   */
  replay(frame: unknown, steps: readonly HeadlessRunStep[]): {
    ok: boolean; sameState: boolean; sameEvents: boolean;
    expectedStateHash: string; actualStateHash: string;
    expectedEventsHash: string; actualEventsHash: string;
    firstDivergence: number | null;
  } {
    if (!isHeadlessFrame(frame)) {
      return {
        ok: false, sameState: false, sameEvents: false,
        expectedStateHash: '', actualStateHash: '', expectedEventsHash: '', actualEventsHash: '',
        firstDivergence: null
      };
    }
    const replayWorld = HeadlessWorld.fromFrame(frame, false);
    const replayEvents = replayWorld.runSteps(steps);
    const expectedStateHash = payloadFingerprint(canonicalSimulationState(this.sim));
    const actualStateHash = payloadFingerprint(canonicalSimulationState(replayWorld.sim));
    const expectedEventsHash = payloadFingerprint(canonicalSimulationEvents(this.events));
    const actualEventsHash = payloadFingerprint(canonicalSimulationEvents(replayEvents));
    let firstDivergence: number | null = null;
    for (let i = 0; i < Math.min(this.events.length, replayEvents.length); i += 1) {
      if (canonicalJson(this.events[i]) !== canonicalJson(replayEvents[i])) { firstDivergence = i; break; }
    }
    if (firstDivergence === null && this.events.length !== replayEvents.length) {
      firstDivergence = Math.min(this.events.length, replayEvents.length);
    }
    return {
      ok: true,
      sameState: actualStateHash === expectedStateHash,
      sameEvents: actualEventsHash === expectedEventsHash,
      expectedStateHash, actualStateHash, expectedEventsHash, actualEventsHash,
      firstDivergence
    };
  }

  /** Dev/OWNER fixture: load a REAL generated room and spawn REAL enemies. */
  loadRoom(roomId: number, kinds: readonly EnemyKind[]): { ok: true; roomId: number; spawned: number } | { ok: false; code: string; messageKey: string } {
    const room = this.sim.map.rooms.find((r) => r.id === roomId);
    if (!room) return { ok: false, code: 'E_SCHEMA', messageKey: 'world.headless_room_unknown' };
    let placement: { player: { x: number; y: number }; drone: { x: number; y: number } };
    try { placement = findPlacement(this.sim, room); }
    catch { return { ok: false, code: 'E_NOT_APPLICABLE', messageKey: 'world.headless_room_blocked' }; }
    this.sim.player.x = placement.player.x;
    this.sim.player.y = placement.player.y;
    this.sim.drones = [];
    this.sim.targets = [];
    this.sim.projectiles = [];
    this.entered.add(room.id);
    const depths = roomDepth(this.sim.map, this.mapIdentity.startRoomId ?? 0);
    const depth = depths.get(room.id) ?? 0;
    let spawned = 0;
    kinds.slice(0, WORLD_LIMITS.MAX_ACTIONS_PER_BATCH).forEach((kind, i) => {
      const data = buildEnemyData(kind, room.id, depth, { gx: room.gx, gy: room.gy, w: room.w, h: room.h });
      registerDrone(this.sim, {
        id: 10 + i, x: placement.drone.x + i * 0.35, y: placement.drone.y,
        hp: data.stats.maxHp, data, attackTimer: 0, wanderTimer: 1000
      });
      spawned += 1;
    });
    this.status = 'running';
    this.epoch += 1;
    return { ok: true, roomId, spawned };
  }

  /**
   * Dev/OWNER fixture: spawn MORE real enemies near the player (real enemy
   * config + real core registration). Used to sustain a real combat wave for
   * perf/regression; never used to fabricate throughput on an empty scene.
   */
  spawnEnemies(kinds: readonly EnemyKind[]): { ok: true; spawned: number; epoch: number } | { ok: false; code: string; messageKey: string } {
    const room = roomAt(this.sim.map.rooms, this.sim.player.x, this.sim.player.y)
      ?? this.sim.map.rooms.find((r) => r.id === this.mapIdentity.combatRoomId);
    if (!room) return { ok: false, code: 'E_SCHEMA', messageKey: 'world.headless_room_unknown' };
    const spots: Array<{ x: number; y: number }> = [];
    for (let r = 1; r <= 6 && spots.length < kinds.length * 3; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = Math.floor(this.sim.player.x) + dx + 0.5;
          const y = Math.floor(this.sim.player.y) + dy + 0.5;
          if (!isWalkableFromState(this.sim, x, y, 0.5)) continue;
          if (tileAtFromState(this.sim, Math.floor(x), Math.floor(y)).type === 'wall') continue;
          spots.push({ x, y });
        }
      }
    }
    if (spots.length === 0) return { ok: false, code: 'E_NOT_APPLICABLE', messageKey: 'world.headless_no_spawn_space' };
    const depths = roomDepth(this.sim.map, this.mapIdentity.startRoomId ?? 0);
    const depth = depths.get(room.id) ?? 0;
    let nextId = Math.max(0, ...this.sim.drones.map((d) => d.id), ...this.sim.targets.map((t) => t.id)) + 1;
    let spawned = 0;
    kinds.slice(0, WORLD_LIMITS.MAX_ACTIONS_PER_BATCH).forEach((kind) => {
      const spot = spots[spawned % spots.length];
      const data = buildEnemyData(kind, room.id, depth, { gx: room.gx, gy: room.gy, w: room.w, h: room.h });
      registerDrone(this.sim, {
        id: nextId++, x: spot.x, y: spot.y,
        hp: data.stats.maxHp, data, attackTimer: 0, wanderTimer: 1000
      });
      spawned += 1;
    });
    this.entered.add(room.id);
    this.status = 'running';
    this.epoch += 1;
    return { ok: true, spawned, epoch: this.epoch };
  }

  /** Export a failure reproduction bundle (no credentials, no Phaser objects). */
  exportFailure(reason: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    this.refreshStatus();
    return {
      schema: 'last_signal.world-headless.failure.v1',
      version: 1,
      reason,
      atTick: this.sim.tick,
      status: this.status,
      observation: this.observation(),
      inspect: this.inspect(),
      tailEvents: this.events.slice(-64),
      actionLog: this.actionLog.slice(-64),
      frame: this.snapshot(),
      ...extra
    };
  }

  static fromFrame(frame: unknown, bumpEpoch = true): HeadlessWorld {
    if (!isHeadlessFrame(frame)) throw new Error('invalid headless frame');
    const world = Object.create(HeadlessWorld.prototype) as HeadlessWorld;
    (world as any).sim = cloneSimulationState(frame.sim as SimulationState);
    (world as any).events = (frame.events as SimEvent[]).slice(-HEADLESS_MAX_EVENTS);
    (world as any).actionLog = (frame.actionLog as HeadlessActionLogEntry[]).slice(-HEADLESS_MAX_ACTION_LOG);
    (world as any).entered = new Set(frame.enteredRooms as number[]);
    (world as any).status = frame.status as HeadlessStatus;
    (world as any).kills = frame.kills as number;
    (world as any).shots = frame.shots as number;
    (world as any).damageTaken = frame.damageTaken as number;
    (world as any).epoch = bumpEpoch ? (frame.epoch as number) + 1 : (frame.epoch as number);
    (world as any).mapIdentity = frame.mapIdentity as HeadlessMapIdentity;
    return world;
  }
}

/** Structural validation of an owner frame (no simulation writes). */
export function isHeadlessFrame(value: unknown): value is HeadlessWorldFrame {
  if (!value || typeof value !== 'object') return false;
  const f = value as Record<string, unknown>;
  if (f.schema !== HEADLESS_FRAME_SCHEMA || f.version !== HEADLESS_FRAME_VERSION) return false;
  const sim = f.sim as Record<string, unknown> | undefined;
  if (!sim || typeof sim !== 'object') return false;
  if (typeof sim.tick !== 'number' || typeof sim.seed !== 'number' || typeof sim.rngState !== 'number') return false;
  if (!Array.isArray(sim.pendingCommands) || !Array.isArray(sim.purchaseTransactions)) return false;
  if (!Array.isArray(sim.drones) || !Array.isArray(sim.projectiles)) return false;
  const map = sim.map as { rooms?: unknown } | undefined;
  if (!map || !Array.isArray(map.rooms)) return false;
  if (!Array.isArray(f.events) || !Array.isArray(f.actionLog) || !Array.isArray(f.enteredRooms)) return false;
  if (typeof f.epoch !== 'number' || typeof f.status !== 'string') return false;
  if (!f.mapIdentity || typeof f.mapIdentity !== 'object') return false;
  return true;
}
