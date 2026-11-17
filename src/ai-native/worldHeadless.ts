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
  createSimulationState, enqueueCommand, registerDrone, stepSimulationTicks, tileAtFromState,
  isWalkableFromState,
  type SimCommand, type SimEvent, type SimulationIntent, type SimulationState
} from '../world/sim/core';
import type { EnemyKind, MapData, PlayerData, Room } from '../types';
import { buildWorldObservation } from './worldObservation';
import { buildExternalObservation } from './externalObservation';
import { gridLineOfSight, WORLD_PERCEPTION } from './worldPerception';
import { buildEchoObservation, type EchoObservation } from '../world/echoView';
import { EchoController, ECHO_LIMITS, type EchoLocalProposalKind, type EchoView } from './echo';
import { EchoAuditRing } from './echoAudit';
import { SIGNAL_TUNING } from '../signal/signalTuning';
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
// In-process owner frame cap (NOT a transport limit): a full 20k-event frame
// is ~5 MiB and is restored via a ref/file, never inline over MCP.
export const HEADLESS_MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** Conservative raw-restore classifier: only echo signal commands and relay
 *  toggles can collide with a new local proposal. Other actors/commands are left
 *  untouched and are not labeled human-local. */
function findRestoredSignal(commands: readonly SimCommand[]): { kind: EchoLocalProposalKind; command: SimCommand } | null {
  for (const command of commands) {
    if (command.type === 'signal-scan' && command.actor === 'echo') return { kind: 'scan', command };
    if (command.type === 'signal-jam' && command.actor === 'echo') return { kind: 'jam', command };
    if (command.type === 'toggle-relay') return { kind: 'toggle-relay', command };
  }
  return null;
}

/**
 * Immutable-history helper: the owner frame must never share nested objects
 * with the live world (or with the caller). JSON round-trip keeps full
 * IEEE-754 precision and detaches events/commands/ledger/actionLog.
 */
function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

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
  /**
   * Set ONLY by the Dev MCP `snapshot` tool, and only when the session is at an
   * action boundary (no active execution, no queued action). A frame produced
   * mid-execution is NOT a boundary frame and `restore` refuses it.
   */
  boundary?: 'action';
  epoch: number;
  sim: SimulationState;
  events: SimEvent[];
  /** Monotonic total events ever produced (the retained `events` array is bounded). */
  eventTotal?: number;
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
  /** Null for V2 Signal actions (scan/jam) which are committed directly, not
   *  through intents. The caller must enqueue them via `enqueueSignalCommand`
   *  before or after the step. */
  intent: SimulationIntent | null;
  /**
   * P3-a owner/dev-only echo intent for the SAME core ticks. The Player MCP
   * surface never builds this field; only the Node parity driver / Dev do.
   */
  echoIntent?: SimulationIntent;
}

export const NEUTRAL_INTENT: SimulationIntent = {
  move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false
};

export function neutralIntent(): SimulationIntent {
  return { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
}

/** Pure WorldActionV1/V2 -> core SimulationIntent. Mirrors the rendered C3-b
 *  conversion without importing any rendered/browser controller module.
 *  Signal actions (scan/jam) are returned as null intents — they are handled
 *  separately by the caller via `enqueueSignalCommand`. */
export function intentFromWorldAction(action: {
  type: 'move' | 'stop' | 'aim' | 'fire' | 'interact' | 'scan' | 'jam';
  dir?: { x: number; y: number };
  target?: { x: number; y: number };
  ticks?: number;
  actor?: 'player' | 'echo';
}): { intent: SimulationIntent | null; ticks: number } {
  if (action.type === 'scan' || action.type === 'jam') {
    // Signal commands are committed directly, not through intents.
    return { intent: null, ticks: Math.max(1, Math.min(WORLD_LIMITS.MAX_ACTION_TICKS, Math.floor(action.ticks ?? 1))) };
  }
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
  /** P2 low-risk ECHO cooperation switch (default false, saved human preference). */
  echoAutonomy?: boolean;
}

export class HeadlessWorld {
  private sim: SimulationState;
  private entered = new Set<number>();
  private events: SimEvent[] = [];
  private actionLog: HeadlessActionLogEntry[] = [];
  private status: HeadlessStatus = 'running';
  private kills = 0;
  private shots = 0;
  private echoShots = 0;
  private damageTaken = 0;
  /** Monotonic event counter (the retained `events` array is bounded). */
  private totalEventCount = 0;
  private epoch: number;
  private mapIdentity: HeadlessMapIdentity;
  /** Same pure policy the rendered World uses; drives the tick when no override. */
  readonly echoController = new EchoController();
  /** Bounded local audit; ties human-local receipts to the proposal id. */
  readonly echoAudit = new EchoAuditRing();
  private echoRoomGeneration = 0;
  /** Exact raw-restored command that produced the conservative busy marker. */
  private restoredSignalCommand: SimCommand | null = null;
  /** One in-flight human-local signal action; a second confirm must fail closed. */
  private pendingLocalAction: {
    proposalId: string;
    acceptedTick: number;
    kind: 'scan' | 'jam' | 'toggle-relay';
    target: { x: number; y: number } | null;
    roomGeneration: number;
    originRoomId: number;
    command: SimCommand | null;
  } | null = null;
  private lastEnqueuedSignalCommand: SimCommand | null = null;

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
    this.echoController.setAutonomy(!!options.echoAutonomy);
    this.echoController.setRoomGeneration(this.echoRoomGeneration);
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
  /** Owner/dev observability: committed echo shots. */
  get echoShotCount(): number { return this.echoShots; }
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

  /** Same legal perception predicate the rendered link uses. */
  isPerceivablePosition(x: number, y: number): boolean {
    return this.isPerceivable(x, y);
  }

  // ---------- P3-a echo companion (owner/dev only) ----------

  /** Queue the echo spawn; committed by the next legal tick. */
  enableEcho(x?: number, y?: number): { ok: true; x: number; y: number } {
    if (this.sim.echo) return { ok: true, x: this.sim.echo.x, y: this.sim.echo.y };
    let spawn = { x: x ?? this.sim.player.x + 1, y: y ?? this.sim.player.y };
    if (!isWalkableFromState(this.sim, spawn.x, spawn.y, 0.5)) spawn = { x: this.sim.player.x, y: this.sim.player.y };
    enqueueCommand(this.sim, { type: 'spawn-echo', x: spawn.x, y: spawn.y });
    return { ok: true, x: spawn.x, y: spawn.y };
  }

  /**
   * Echo's own bounded perception, identical to the rendered World: centred on
   * the echo, 12 tiles, entered rooms and line of sight. Never the player crop.
   */
  echoView(): EchoObservation | null {
    const echo = this.sim.echo;
    if (!echo) return null;
    const signal = this.sim.signal;
    const echoAccount = signal?.actors.echo;
    return buildEchoObservation({
      echo,
      player: { x: this.sim.player.x, y: this.sim.player.y },
      tick: this.sim.tick,
      drones: this.sim.drones.map((drone) => ({ id: drone.id, x: drone.x, y: drone.y, hp: drone.hp })),
      targets: this.sim.targets.map((target) => ({
        id: target.id, kind: target.kind, x: target.x, y: target.y, hp: target.hp, isBoss: target.isBoss
      })),
      isExplored: (x, y) => {
        const id = this.roomIdAt(x, y);
        return id !== null && this.entered.has(id);
      },
      isOpaque: (x, y) => tileAtFromState(this.sim, Math.floor(x), Math.floor(y)).type === 'wall',
      signal: signal
        ? {
            deviceId: signal.deviceId, x: signal.x, y: signal.y, relay: signal.relay,
            powered: signal.powered, manualEnabled: signal.manualEnabled,
            jammedUntilTick: signal.jammedUntilTick
          }
        : null,
      energy: echoAccount
        ? { current: echoAccount.energy.energy, max: SIGNAL_TUNING.ENERGY_MAX }
        : undefined,
      cooldowns: echoAccount
        ? { scanTicks: echoAccount.cooldowns.scanCooldownTicks, jamTicks: echoAccount.cooldowns.jamCooldownTicks }
        : undefined
    });
  }
  /** Same pure policy view as the rendered World: observation + bounded canWalk. */
  echoPolicyView(): EchoView | null {
    const view = this.echoView();
    const echo = this.sim.echo;
    if (!view || !echo) return null;
    const canWalk = (x: number, y: number): boolean => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      if (Math.hypot(x - echo.x, y - echo.y) >= ECHO_LIMITS.perceptionTiles) return false;
      const id = this.roomIdAt(x, y);
      if (id === null || !this.entered.has(id)) return false;
      if (!isWalkableFromState(this.sim, x, y, 0.5)) return false;
      return gridLineOfSight({ x, y }, {
        center: { x: echo.x, y: echo.y },
        radiusTiles: ECHO_LIMITS.perceptionTiles,
        isExplored: (sx, sy) => {
          const rid = this.roomIdAt(sx, sy);
          return rid !== null && this.entered.has(rid);
        },
        isOpaque: (sx, sy) => tileAtFromState(this.sim, Math.floor(sx), Math.floor(sy)).type === 'wall',
        stepTiles: WORLD_PERCEPTION.losStepTiles
      });
    };
    return { ...view, canWalk, autonomyEnabled: this.echoController.autonomyEnabled, roomGeneration: this.echoRoomGeneration };
  }

  proposeLocalEcho(): ReturnType<EchoController['propose']> {
    const view = this.echoPolicyView();
    return view ? this.echoController.propose(view) : null;
  }

  /** Same local-confirm validation + core command as the rendered boundary. */
  confirmLocalEchoProposal(id: string, ownerHuman = true): boolean {
    // One in-flight human-local action only; a second direct/UI confirm fails
    // closed without touching the queued command or the pending record.
    if (this.pendingLocalAction || this.echoController.restoredPendingKind) {
      this.echoAudit.record({
        tick: this.sim.tick, provenance: 'human-local', action: 'local-confirm', target: null,
        result: 'rejected', code: 'E_ALREADY_PENDING', proposalId: id
      });
      return false;
    }
    const echo = this.sim.echo;
    if (!echo || echo.data.hp <= 0) return false;
    const validation = this.echoController.validateLocalProposal(id, this.sim.tick, this.echoRoomGeneration, ownerHuman);
    if (!validation.ok) return false;
    const proposal = this.echoController.localProposal;
    const view = this.echoView();
    if (!proposal || !view || !view.relay) return false;
    const distance = Math.hypot(view.relay.x - echo.x, view.relay.y - echo.y);
    const energy = view.energy?.current ?? 0;
    const scanTicks = view.cooldowns?.scanTicks ?? 0;
    if (proposal.kind === 'scan' && !(distance < SIGNAL_TUNING.SCAN_RADIUS && energy >= SIGNAL_TUNING.SCAN_COST && scanTicks <= 0)) return false;
    if (proposal.kind === 'toggle-relay' && !(distance < SIGNAL_TUNING.JAM_RANGE)) return false;
    const roomId = this.roomIdAt(this.sim.player.x, this.sim.player.y) ?? undefined;
    this.lastEnqueuedSignalCommand = null;
    if (proposal.kind === 'scan') this.enqueueSignalCommand({ type: 'signal-scan', actor: 'echo' });
    else if (proposal.kind === 'toggle-relay') this.enqueueSignalCommand({
      type: 'toggle-relay', enabled: !(this.sim.signal?.manualEnabled ?? false),
      ...(roomId !== undefined ? { originRoomId: roomId } : {})
    });
    else return false;
    this.pendingLocalAction = {
      proposalId: proposal.id, acceptedTick: this.sim.tick, kind: proposal.kind,
      target: proposal.target, roomGeneration: this.echoRoomGeneration,
      originRoomId: roomId ?? 0, command: this.lastEnqueuedSignalCommand
    };
    this.lastEnqueuedSignalCommand = null;
    this.echoAudit.record({
      tick: this.sim.tick, provenance: 'human-local', action: proposal.kind,
      target: proposal.target, result: 'enqueued', proposalId: proposal.id
    });
    this.echoController.markLocalPending(proposal);
    this.echoController.consumeLocalProposal(id);
    return true;
  }

  /** The single in-flight local action, or a raw-restored queued signal.
   *  A restored row has no proposalId and must not be presented as a local receipt. */
  get echoPendingLocal(): { proposalId: string | null; kind: 'scan' | 'jam' | 'toggle-relay'; target: { x: number; y: number } | null; acceptedTick: number | null; roomGeneration: number; restored: boolean } | null {
    const pending = this.pendingLocalAction;
    if (pending) {
      return {
        proposalId: pending.proposalId, kind: pending.kind,
        target: pending.target ? { ...pending.target } : null,
        acceptedTick: pending.acceptedTick, roomGeneration: pending.roomGeneration,
        restored: false
      };
    }
    const restored = this.echoController.restoredPendingKind;
    if (restored) {
      return { proposalId: null, kind: restored, target: null, acceptedTick: null, roomGeneration: this.echoRoomGeneration, restored: true };
    }
    return null;
  }

  /** Explicit local cancel: remove the exact queued command, record it, then clear. */
  cancelPendingLocalEcho(reason: 'E_ROOM_CHANGED' | 'E_ECHO_DISABLED' | 'E_LOCAL_REVOKED' | 'E_ECHO_DEAD'): boolean {
    const pending = this.pendingLocalAction;
    if (!pending) return false;
    if (pending.command) {
      const index = this.sim.pendingCommands.indexOf(pending.command);
      if (index >= 0) this.sim.pendingCommands.splice(index, 1);
    }
    this.echoAudit.record({
      tick: this.sim.tick, provenance: 'human-local', action: pending.kind,
      target: pending.target, result: 'cancelled', code: reason, proposalId: pending.proposalId
    });
    this.pendingLocalAction = null;
    this.echoController.clearLocalPending();
    return true;
  }

  rejectLocalEchoProposal(id: string): boolean {
    const proposal = this.echoController.localProposal;
    if (!proposal || proposal.id !== id) return false;
    this.echoController.rejectLocalProposal(id, this.sim.tick);
    return true;
  }

  /**
   * P3-b B: spawn ONE real Relay device through the SAME core command the
   * rendered World uses. Committed by the next legal tick.
   */
  enableSignalDevice(input: { deviceId: string; roomId: number; x: number; y: number }): { ok: true } {
    enqueueCommand(this.sim, {
      type: 'spawn-signal-device', deviceId: input.deviceId,
      roomId: input.roomId, x: input.x, y: input.y
    });
    return { ok: true };
  }

  /** Owner/dev-only legal Signal command; core commits it on the next tick. */
  enqueueSignalCommand(command: {
    type: 'signal-scan' | 'signal-jam' | 'toggle-relay' | 'signal-power';
    actor?: 'player' | 'echo'; enabled?: boolean; powered?: boolean; originRoomId?: number;
  }): { ok: true } {
    let queued: SimCommand;
    if (command.type === 'toggle-relay') queued = {
      type: 'toggle-relay', enabled: command.enabled === true,
      ...(command.originRoomId !== undefined ? { originRoomId: command.originRoomId } : {})
    };
    else if (command.type === 'signal-power') queued = { type: 'signal-power', powered: command.powered === true };
    else queued = { type: command.type, actor: command.actor ?? 'player' };
    enqueueCommand(this.sim, queued);
    this.lastEnqueuedSignalCommand = queued;
    return { ok: true };
  }

  /** Bounded, real Signal state (no hidden fields). Byte-parity with the
   *  rendered World.signalView(): separate player/echo cooldowns.
   *  `scanCooldown`/`jamCooldown` are kept as echo-cooldown aliases for
   *  existing consumers; `echoScanCD`/`echoJamCD` are the canonical names. */
  signalView(): Record<string, unknown> | null {
    const s = this.sim.signal;
    if (!s) return null;
    return {
      deviceId: s.deviceId, roomId: s.roomId, x: s.x, y: s.y,
      relay: s.relay, manualEnabled: s.manualEnabled, powered: s.powered,
      jammedUntilTick: s.jammedUntilTick,
      playerEnergy: s.actors.player.energy.energy,
      echoEnergy: s.actors.echo.energy.energy,
      playerScanCD: s.actors.player.cooldowns.scanCooldownTicks,
      playerJamCD: s.actors.player.cooldowns.jamCooldownTicks,
      echoScanCD: s.actors.echo.cooldowns.scanCooldownTicks,
      echoJamCD: s.actors.echo.cooldowns.jamCooldownTicks,
      scanCooldown: s.actors.echo.cooldowns.scanCooldownTicks,
      jamCooldown: s.actors.echo.cooldowns.jamCooldownTicks,
      evidence: s.evidence.length,
      exitOpen: s.relay === 'ACTIVE'
    };
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
    // SAME projection as the rendered link: `buildExternalObservation` filters
    // actors by `perceivedActors` AND projectiles by the shared perception
    // predicate. No parallel hand-written crop lives here.
    const projected = buildExternalObservation({
      epoch,
      tick: s.tick,
      view,
      playerData: {
        weaponKey: s.player.data.weaponKey,
        weapons: s.player.data.weapons
      },
      aimYaw: s.player.aimYaw,
      drones: s.drones.filter((d) => d.hp > 0).map((d) => ({
        id: d.id, kind: d.data.kind, x: d.x, y: d.y, hp: d.hp, state: d.data.state
      })),
      targets: s.targets.filter((t) => t.hp > 0).map((t) => ({
        id: t.id, kind: t.kind, x: t.x, y: t.y, hp: t.hp
      })),
      projectiles: s.projectiles.map((p) => ({
        id: p.id, side: p.side, kind: p.kind, pos: p.pos, vel: p.vel,
        damage: p.damage, lifetime: p.lifetime
      })),
      isPerceivable: (x, y) => this.isPerceivablePosition(x, y)
    });
    return {
      schema: WORLD_SCHEMA_V1,
      protocolVersion: WORLD_PROTOCOL_VERSION,
      epoch: projected.epoch,
      tick: projected.tick,
      roomId: projected.roomId,
      player: { ...projected.player },
      drones: projected.drones.map((d) => ({ ...d })),
      projectiles: projected.projectiles.map((p) => ({ ...p })),
      availableActions: [...projected.availableActions]
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
      const policyView = this.echoPolicyView();
      const echoIntent = step.echoIntent ?? (policyView ? this.echoController.decide(policyView) : undefined);
      const events = stepSimulationTicks(this.sim, ticks, step.intent ?? neutralIntent(), echoIntent);
      for (const event of events) this.accountForEvent(event);
      for (const event of events) {
        if (event.type === 'signal-scanned') this.settlePendingLocalSignal('scan', event.ok !== false, event.code);
        else if (event.type === 'signal-jammed') this.settlePendingLocalSignal('jam', event.ok !== false, event.code);
        else if (event.type === 'signal-relay-changed') this.settlePendingLocalSignal('toggle-relay', true, undefined);
      }
      collected.push(...events);
      this.totalEventCount += events.length;
      this.events.push(...events);
      if (this.events.length > HEADLESS_MAX_EVENTS) {
        this.events = this.events.slice(-HEADLESS_MAX_EVENTS);
      }
      const id = this.roomIdAt(this.sim.player.x, this.sim.player.y);
      if (id !== null && !this.entered.has(id)) {
        // Cancel the exact queued local command before dropping the guard.
        this.cancelPendingLocalEcho('E_ROOM_CHANGED');
        this.entered.add(id);
        this.echoRoomGeneration += 1;
        this.echoController.setRoomGeneration(this.echoRoomGeneration);
        this.echoController.clearForRoomTransition();
      } else if (id !== null) this.entered.add(id);
      // A raw-restored command with no matching event must not deadlock the
      // guard; clear only after the core queue no longer contains it. A dead
      // echo can only clear an actually-local pending row (never a restored one).
      this.reapDrainedGuards();
      if (used >= tickCap) break;
    }
    return collected;
  }

  private reapDrainedGuards(): void {
    const restored = this.restoredSignalCommand;
    if (restored && this.echoController.restoredPendingKind && !this.sim.pendingCommands.includes(restored)) {
      this.echoController.clearRestoredPending();
      this.restoredSignalCommand = null;
    }
    const local = this.pendingLocalAction;
    if (local?.command && this.echoController.pendingLocalProposal && !this.sim.pendingCommands.includes(local.command)) {
      const echo = this.sim.echo;
      if (!echo || echo.data.hp <= 0) {
        this.echoAudit.record({
          tick: this.sim.tick, provenance: 'human-local', action: local.kind,
          target: local.target, result: 'cancelled', code: 'E_ECHO_DEAD', proposalId: local.proposalId
        });
        this.pendingLocalAction = null;
        this.echoController.clearLocalPending();
      }
    }
  }

  private accountForEvent(event: SimEvent): void {
    if (event.type === 'enemy-died') this.kills += 1;
    if (event.type === 'player-fired') this.shots += 1;
    if (event.type === 'echo-fired') this.echoShots += 1;
    if (event.type === 'player-hurt') this.damageTaken += event.damage ?? 0;
    if (event.type === 'player-death' || this.sim.player.data.hp <= 0) this.status = 'dead';
  }

  private settlePendingLocalSignal(kind: 'scan' | 'jam' | 'toggle-relay', ok: boolean, code?: string): void {
    if (this.echoController.restoredPendingKind === kind) {
      // Unknown restored command: clear the busy marker on its real receipt but
      // never fabricate a human-local audit row/proposal id for it.
      this.echoController.clearRestoredPending();
      this.restoredSignalCommand = null;
      return;
    }
    const pending = this.pendingLocalAction;
    if (!pending || pending.kind !== kind) return;
    this.echoAudit.record({
      tick: this.sim.tick, provenance: 'human-local', action: pending.kind,
      target: pending.target, result: ok ? 'applied' : 'rejected',
      proposalId: pending.proposalId, ...(code ? { code } : {})
    });
    this.pendingLocalAction = null;
    this.echoController.clearLocalPending();
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
  canonicalStateHash(): string { return payloadFingerprint(canonicalSimulationState(this.sim)); }
  canonicalEventsHash(): string { return payloadFingerprint(canonicalSimulationEvents(this.events)); }
  /** Bounded page over the RETAINED event window (index 0 = oldest retained). */
  eventsSlice(start: number, count: number): SimEvent[] {
    const from = Math.max(0, Math.min(this.events.length, Math.floor(start)));
    return this.events.slice(from, from + Math.max(0, Math.floor(count)));
  }

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
    // Object.create bypasses class-field init; the P2 policy controller must
    // exist on every restored HeadlessWorld (including old P1 parity states).
    (world as any).echoController = new EchoController();
    (world as any).echoAudit = new EchoAuditRing();
    (world as any).echoRoomGeneration = 0;
    (world as any).pendingLocalAction = null;
    (world as any).lastEnqueuedSignalCommand = null;
    (world as any).restoredSignalCommand = null;
    // A raw-sim restore keeps the core queue. If it already contains an echo
    // scan/jam or a relay toggle, rebuild a conservative busy marker instead of
    // dropping the command or pretending it is a human-local receipt. Other
    // actors' commands are preserved and do not mark a local guard.
    const restored = findRestoredSignal(sim.pendingCommands);
    if (restored) {
      (world as any).echoController.setRestoredPending(restored.kind);
      (world as any).restoredSignalCommand = restored.command;
    }
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
      events: deepCopy(this.events.slice(-HEADLESS_MAX_EVENTS)) as SimEvent[],
      eventTotal: this.totalEventCount,
      actionLog: deepCopy(this.actionLog.slice()),
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
    this.events = deepCopy((frame.events as SimEvent[]).slice(-HEADLESS_MAX_EVENTS));
    this.totalEventCount = typeof frame.eventTotal === 'number'
      ? frame.eventTotal
      : this.events.length;
    this.actionLog = deepCopy((frame.actionLog as HeadlessActionLogEntry[]).slice(-HEADLESS_MAX_ACTION_LOG));
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
    expectedNewEventsHash?: string; actualNewEventsHash?: string;
    baselineEvents?: number;
    historyPreserved?: boolean;
    eventsTruncated?: boolean;
    firstDivergence: number | null;
  } {
    if (!isHeadlessFrame(frame)) {
      return {
        ok: false, sameState: false, sameEvents: false,
        expectedStateHash: '', actualStateHash: '', expectedEventsHash: '', actualEventsHash: '',
        firstDivergence: null
      };
    }
    const frameEvents = frame.events as SimEvent[];
    const baselineEvents = frameEvents.length;
    const replayWorld = HeadlessWorld.fromFrame(frame, false);
    // `runSteps` appends to the replay world's history, so `replayWorld.events`
    // = frame.events (baseline) + the new segment. Compare the SAME interval.
    replayWorld.runSteps(steps);
    const expected = this.events;
    const actual = replayWorld.events;
    const expectedStateHash = payloadFingerprint(canonicalSimulationState(this.sim));
    const actualStateHash = payloadFingerprint(canonicalSimulationState(replayWorld.sim));

    // 1) The preserved history must still match the frame baseline. A lost
    //    prefix (20k truncation) is NEVER silently accepted as consistent.
    let firstDivergence: number | null = null;
    let historyPreserved = expected.length >= baselineEvents;
    if (historyPreserved) {
      for (let i = 0; i < baselineEvents; i += 1) {
        if (canonicalJson(expected[i]) !== canonicalJson(frameEvents[i])) {
          firstDivergence = i;
          historyPreserved = false;
          break;
        }
      }
    } else {
      firstDivergence = expected.length;
    }

    // 2) The newly produced segment (after the frame baseline) must match.
    const expectedNew = expected.slice(baselineEvents);
    const actualNew = actual.slice(baselineEvents);
    const newEqual = expectedNew.length === actualNew.length;
    if (firstDivergence === null) {
      if (!newEqual) {
        firstDivergence = baselineEvents + Math.min(expectedNew.length, actualNew.length);
      } else {
        for (let i = 0; i < expectedNew.length; i += 1) {
          if (canonicalJson(expectedNew[i]) !== canonicalJson(actualNew[i])) {
            firstDivergence = baselineEvents + i;
            break;
          }
        }
      }
    }

    const expectedEventsHash = payloadFingerprint(canonicalSimulationEvents(expected));
    const actualEventsHash = payloadFingerprint(canonicalSimulationEvents(actual));
    const expectedNewEventsHash = payloadFingerprint(canonicalSimulationEvents(expectedNew));
    const actualNewEventsHash = payloadFingerprint(canonicalSimulationEvents(actualNew));
    return {
      ok: true,
      sameState: actualStateHash === expectedStateHash,
      sameEvents: historyPreserved && newEqual && firstDivergence === null,
      expectedStateHash, actualStateHash,
      expectedEventsHash, actualEventsHash,
      expectedNewEventsHash, actualNewEventsHash,
      baselineEvents,
      historyPreserved,
      // Exact: a frame whose eventTotal exceeds its retained events lost history.
      eventsTruncated: isHistoryTruncated(
        typeof frame.eventTotal === 'number' ? frame.eventTotal : baselineEvents,
        baselineEvents
      ),
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
      tailEvents: deepCopy(this.events.slice(-64)),
      actionLog: deepCopy(this.actionLog.slice(-64)),
      frame: this.snapshot(),
      ...extra
    };
  }

  static fromFrame(frame: unknown, bumpEpoch = true): HeadlessWorld {
    if (!isHeadlessFrame(frame)) throw new Error('invalid headless frame');
    const world = Object.create(HeadlessWorld.prototype) as HeadlessWorld;
    (world as any).sim = cloneSimulationState(frame.sim as SimulationState);
    (world as any).events = deepCopy((frame.events as SimEvent[]).slice(-HEADLESS_MAX_EVENTS));
    (world as any).totalEventCount = typeof frame.eventTotal === 'number'
      ? frame.eventTotal
      : ((frame.events as SimEvent[]).length);
    (world as any).actionLog = deepCopy((frame.actionLog as HeadlessActionLogEntry[]).slice(-HEADLESS_MAX_ACTION_LOG));
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
/**
 * EXACT history-truncation predicate: the retained event array is a WINDOW of
 * the true history. `eventTotal === retained` is NOT truncated (the array can
 * hold exactly HEADLESS_MAX_EVENTS); only `eventTotal > retained` lost a prefix.
 */
export function isHistoryTruncated(eventTotal: number, retained: number): boolean {
  return Number.isFinite(eventTotal) && eventTotal > retained;
}

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
