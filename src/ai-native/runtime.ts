/**
 * AI-NATIVE-01 P1 — HEADLESS shared simulation runtime.
 *
 * A pure-TypeScript core over the authoritative `SliceModel` / `Corridor` /
 * `CorridorGuard` / geometry rules. It does NOT copy any door, relay, bridge,
 * guard or collision rule: movement goes through `sharedCore.stepMovement`, and
 * every action calls the existing model methods.
 *
 * Boundaries:
 *  - no Phaser / DOM / Canvas / window / localStorage / node:crypto;
 *  - no wall clock: `step()` advances an explicit number of FIXED ticks;
 *  - seed / RNG state owned per instance (the fixed scenario has no random
 *    gameplay, so the seed stays isolated and is never forced into randomness);
 *  - internal full snapshot/restore/replay includes live Guard decision state,
 *    bridge transition, timers, regen remainder and movement intent;
 *  - `aim` / `fire` / `decoy` are explicitly UNSUPPORTED (`E_NOT_APPLICABLE`);
 *    `shoot_guard` is the only limited combat capability and still obeys the
 *    existing corridor range/cooldown model;
 *  - there is no "set position" action. `__testSetPosition` exists only for
 *    unit tests and is never reachable from a player action or the CLI.
 */
import { RNG } from '../core/random';
import { SliceModel, SLICE, type ActionResult, type ResultCode } from '../slice/rules';
import type { FullSliceState, SliceEvidenceV1 } from '../slice/fullState';
import { isFullSliceState } from '../slice/fullState';
import {
  NO_MOVEMENT, directionToIntent, resolveTransitions, stepMovement,
  type MovementDirection, type MovementIntent, type SliceTransitions,
} from '../slice/sharedCore';
import { canonicalJson, AI_NATIVE_OBSERVATION_SCHEMA_V1, AI_NATIVE_PROTOCOL_VERSION, type ObservationV1 } from './protocol';
import { ROOM, canFit, isWalkableCell, isOccupyingDoor } from '../slice/room';
import { canStandInCorridor, occupiesBridge } from '../slice/corridorRoom';

export const RUNTIME_SCHEMA = 'last_signal.ai-native.runtime-snapshot.v1' as const;
export const RUNTIME_VERSION = 1 as const;
export const RUNTIME_KERNEL_VERSION = 'station-zero-r1-r2@1' as const;
export const RUNTIME_SCENARIO = 'station-zero' as const;
export const RUNTIME_SESSION_ID_PREFIX = 'ses_' as const;
export const RUNTIME_ACTOR_ID_PREFIX = 'act_' as const;

/** Deterministic lowercase-hex ID derived from a seed (no randomness). */
function fixedHex(seed: number, length: number): string {
  let state = (seed >>> 0) ^ 0x9e3779b9;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;
    out += (state & 0xf).toString(16);
  }
  return out;
}

export function sessionIdForSeed(seed: number): string {
  return `${RUNTIME_SESSION_ID_PREFIX}${fixedHex(seed, 24)}`;
}
export function actorIdForSeed(seed: number): string {
  return `${RUNTIME_ACTOR_ID_PREFIX}${fixedHex(seed, 16)}`;
}

export const RUNTIME_LIMITS = Object.freeze({
  MAX_TICKS_PER_STEP: 1000,
  MAX_ACTIONS_PER_STEP: 32,
  MAX_INTENT_TICKS: 3600,
  MAX_TOTAL_TICKS: 1_000_000,
  MAX_EVENTS: 10_000,
  MAX_ACTION_LOG: 10_000,
  MAX_ISSUED_SNAPSHOTS: 64,
  MAX_TOTAL_REPLAY_TICKS: 100_000,
  TICK_HZ: SLICE.TICK_HZ,
});

export type RuntimeStatus = 'running' | 'paused' | 'finished';
export type RuntimeActor = 'player' | 'echo';
export type RuntimeActionType = 'move' | 'scan' | 'jam' | 'interact' | 'shoot_guard' | 'wait';
export type RuntimeDirection = MovementDirection;

export interface RuntimeAction {
  readonly id?: string;
  readonly actor?: RuntimeActor;
  readonly type: string;
  readonly direction?: string;
  readonly ticks?: number;
  readonly target?: string;
}

export interface RuntimeActionInput {
  readonly id?: string;
  readonly actor?: RuntimeActor;
  readonly type: string;
  readonly direction?: string;
  readonly ticks?: number;
  readonly target?: string;
}

export interface RuntimeEvent {
  readonly eventSeq: number;
  readonly tick: number;
  /** 0 lifecycle, 1 protocol, 2 action, 3 domain-precommit, 4 domain-commit, 5 observation, 6 dev-audit */
  readonly phase: number;
  readonly ordinal: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, string | number | boolean>>;
}

export interface RuntimeStepOutcome {
  readonly tick: number;
  readonly advanced: number;
  readonly actionResults: readonly RuntimeActionResult[];
  readonly events: readonly RuntimeEvent[];
  readonly status: RuntimeStatus;
  readonly droppedEvents: number;
}

export interface RuntimeActionResult {
  readonly id: string;
  readonly actor: RuntimeActor;
  readonly type: RuntimeActionType;
  readonly code: ResultCode;
  readonly cost: number;
}

export type RuntimeRejectionCode =
  | 'E_SCHEMA' | 'E_NOT_APPLICABLE' | 'E_PAUSED' | 'E_RESOURCE_LIMIT'
  | 'E_STALE_TICK' | 'E_UNKNOWN_ACTOR' | 'E_SNAPSHOT_INVALID' | 'E_ILLEGAL_TARGET';

export interface RuntimeFailure {
  readonly ok: false;
  readonly code: RuntimeRejectionCode;
  readonly message: string;
}

export type RuntimeResult<T> = { readonly ok: true; readonly value: T } | RuntimeFailure;

export interface RuntimeSnapshot {
  readonly schema: typeof RUNTIME_SCHEMA;
  readonly protocolVersion: typeof RUNTIME_VERSION;
  readonly kernelVersion: typeof RUNTIME_KERNEL_VERSION;
  readonly scenario: typeof RUNTIME_SCENARIO;
  /** This instance's private issued-frame handle (required by restore). */
  readonly snapshotId: string;
  /** Instance-issued private handle; restore binds the frame to its source. */
  readonly sessionId: string;
  readonly seed: number;
  readonly rngState: number;
  readonly status: RuntimeStatus;
  readonly epoch: number;
  readonly tick: number;
  readonly movement: { readonly intent: MovementIntent; readonly remainingTicks: number };
  readonly model: FullSliceState;
  readonly events: readonly RuntimeEvent[];
  readonly eventSeq: number;
  readonly droppedEvents: number;
  readonly actionSeq: number;
  readonly actionLog: readonly RuntimeAction[];
  /** sha256 of the canonical state (computed at the Node boundary). */
  readonly stateHash?: string;
  /** sha256 of the canonical ordered events (computed at the Node boundary). */
  readonly eventsHash?: string;
}

/** Public observation is the P0 ObservationV1 whitelist projection. */
export type RuntimeObservation = ObservationV1;

/** Internal fields never present in the public projection (count only, no names). */
const OMITTED_INTERNAL_FIELDS = [
  'seed', 'rngState', 'actionLog', 'events', 'manualOpenIntent', 'sealSourcePresent',
  'occupancy', 'pendingSafeClose', 'regenAcc', 'accumulatorMs', 'lastRelayInteractTick',
  'revealDoorReceiver', 'revealSealSource', 'corridorReveal', 'guard.evidence',
  'guard.attackAt', 'guard.jamUntil', 'guard.watching', 'deadline',
];

/** Strict value type guard for an action object (no unknown fields). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const ACTION_FIELDS = ['id', 'actor', 'type', 'direction', 'ticks', 'target'] as const;
const DIRECTIONS: readonly RuntimeDirection[] = ['up', 'down', 'left', 'right', 'north', 'south', 'east', 'west'];
const SUPPORTED: readonly RuntimeActionType[] = ['move', 'scan', 'jam', 'interact', 'shoot_guard', 'wait'];
const UNSUPPORTED = new Set(['aim', 'fire', 'decoy']);
const JAM_TARGETS = new Set(['door', 'relay', 'guard']);

function failure(code: RuntimeRejectionCode, message: string): RuntimeFailure {
  return Object.freeze({ ok: false as const, code, message });
}
function success<T>(value: T): RuntimeResult<T> {
  return Object.freeze({ ok: true as const, value });
}

function isFiniteInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) &&
    value >= min && value <= max;
}

export interface ValidatedAction {
  readonly id: string;
  readonly actor: RuntimeActor;
  readonly type: RuntimeActionType;
  readonly direction?: RuntimeDirection;
  readonly ticks?: number;
  readonly target?: 'door' | 'relay' | 'guard';
}

/** Strict closed-schema validation for one low-level action. */
export function validateRuntimeAction(input: unknown, index = 0): RuntimeResult<ValidatedAction> {
  if (!isPlainObject(input)) return failure('E_SCHEMA', `action[${index}] must be an object`);
  const keys = Object.keys(input);
  if (keys.some((key) => !(ACTION_FIELDS as readonly string[]).includes(key))) {
    return failure('E_SCHEMA', `action[${index}] has an unknown field`);
  }
  const type = input.type;
  if (typeof type !== 'string') return failure('E_SCHEMA', `action[${index}].type must be a string`);
  if (UNSUPPORTED.has(type)) {
    return failure('E_NOT_APPLICABLE', `action[${index}] '${type}' is not implemented in Station Zero P0/P1`);
  }
  if (!(SUPPORTED as readonly string[]).includes(type)) {
    return failure('E_SCHEMA', `action[${index}] has an unknown type`);
  }
  const actor = input.actor ?? 'player';
  if (actor !== 'player' && actor !== 'echo') {
    return failure('E_UNKNOWN_ACTOR', `action[${index}].actor is not registered`);
  }
  const id = input.id ?? `${actor}-${index}`;
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
    return failure('E_SCHEMA', `action[${index}].id must be a non-empty string <= 64 chars`);
  }
  const actionType = type as RuntimeActionType;
  if (actionType === 'move') {
    const direction = input.direction;
    if (typeof direction !== 'string' || !(DIRECTIONS as readonly string[]).includes(direction)) {
      return failure('E_SCHEMA', `action[${index}].direction must be up/down/left/right/north/south/east/west`);
    }
    const ticks = input.ticks;
    if (!isFiniteInt(ticks, 1, RUNTIME_LIMITS.MAX_INTENT_TICKS)) {
      return failure('E_SCHEMA', `action[${index}].ticks must be an integer in 1..${RUNTIME_LIMITS.MAX_INTENT_TICKS}`);
    }
    return success({ id, actor, type: actionType, direction: direction as RuntimeDirection, ticks });
  }
  if (actionType === 'wait') {
    const ticks = input.ticks ?? 0;
    if (!isFiniteInt(ticks, 0, RUNTIME_LIMITS.MAX_INTENT_TICKS)) {
      return failure('E_SCHEMA', `action[${index}].ticks must be an integer in 0..${RUNTIME_LIMITS.MAX_INTENT_TICKS}`);
    }
    return success({ id, actor, type: actionType, ticks });
  }
  if (actionType === 'jam') {
    const target = input.target ?? 'relay';
    if (typeof target !== 'string' || !JAM_TARGETS.has(target)) {
      return failure('E_SCHEMA', `action[${index}].target must be door/relay/guard`);
    }
    return success({ id, actor, type: actionType, target: target as 'door' | 'relay' | 'guard' });
  }
  return success({ id, actor, type: actionType });
}

function actorPriority(actor: RuntimeActor): number {
  return actor === 'player' ? 0 : 1;
}

/** Deterministic action order: actor priority, actor, id, then input index. */
function compareActions(a: ValidatedAction, b: ValidatedAction, ai: number, bi: number): number {
  const pa = actorPriority(a.actor);
  const pb = actorPriority(b.actor);
  if (pa !== pb) return pa - pb;
  if (a.actor !== b.actor) return a.actor < b.actor ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return ai - bi;
}

function moveIntent(action: ValidatedAction): MovementIntent {
  return action.type === 'move' && action.direction
    ? directionToIntent(action.direction)
    : NO_MOVEMENT;
}

export interface CreateGameOptions {
  readonly scenario: 'station-zero';
  readonly seed: number;
  readonly mode: 'headless';
}

export interface StepOptions {
  readonly actions?: readonly unknown[];
  readonly ticks: number;
}

export class HeadlessGame {
  readonly scenario = RUNTIME_SCENARIO;
  readonly seed: number;
  readonly sessionId: string;
  readonly actorId: string;
  readonly mode: 'headless' = 'headless';
  private readonly rng: RNG;
  private model: SliceModel;
  private status: RuntimeStatus = 'running';
  private epoch = 0;
  private movement: MovementIntent = NO_MOVEMENT;
  private movementRemainingTicks = 0;
  private events: RuntimeEvent[] = [];
  private eventSeq = 0;
  private droppedEvents = 0;
  private actionSeq = 0;
  private actionLog: RuntimeAction[] = [];
  /** Bounded private issuance table: snapshotId -> canonical full-payload fingerprint. */
  private readonly issuedSnapshots = new Map<string, string>();
  private snapshotCounter = 0;

  constructor(options: CreateGameOptions) {
    if (!options || options.scenario !== RUNTIME_SCENARIO || options.mode !== 'headless') {
      throw new TypeError('createGame requires { scenario:"station-zero", mode:"headless" }');
    }
    if (!isFiniteInt(options.seed, 0, 0xffffffff)) {
      throw new TypeError('seed must be an integer in 0..0xffffffff');
    }
    this.seed = options.seed;
    this.sessionId = sessionIdForSeed(options.seed);
    this.actorId = actorIdForSeed(options.seed);
    this.rng = new RNG(options.seed);
    this.model = new SliceModel();
    this.emit(0, 0, 'SESSION_CREATED', { scenario: RUNTIME_SCENARIO, seed: options.seed });
  }

  get tick(): number { return this.model.tick; }
  get paused(): boolean { return this.status === 'paused'; }
  get finished(): boolean { return this.status === 'finished'; }

  pause(): RuntimeResult<{ status: RuntimeStatus }> {
    if (this.status === 'finished') return failure('E_PAUSED', 'run is already finished');
    this.status = 'paused';
    this.model.setPaused(true);
    this.emit(this.model.tick, 0, 'SESSION_PAUSED', { status: 'paused' });
    return success({ status: this.status });
  }

  resume(): RuntimeResult<{ status: RuntimeStatus }> {
    if (this.status === 'finished') return failure('E_PAUSED', 'run is already finished');
    this.status = 'running';
    this.model.setPaused(false);
    this.emit(this.model.tick, 0, 'SESSION_RESUMED', { status: 'running' });
    return success({ status: this.status });
  }

  /**
   * Apply actions (deterministically ordered) then advance exactly `ticks`
   * fixed logic ticks. No wall-clock delta is consulted.
   */
  step(options: StepOptions): RuntimeResult<RuntimeStepOutcome> {
    if (this.status === 'paused') return failure('E_PAUSED', 'session is paused');
    if (this.status === 'finished') return failure('E_PAUSED', 'run is finished; reset required');
    if (!isPlainObject(options)) return failure('E_SCHEMA', 'step options must be an object');
    if (!isFiniteInt(options.ticks, 1, RUNTIME_LIMITS.MAX_TICKS_PER_STEP)) {
      return failure('E_RESOURCE_LIMIT', `ticks must be an integer in 1..${RUNTIME_LIMITS.MAX_TICKS_PER_STEP}`);
    }
    if (this.model.tick + options.ticks > RUNTIME_LIMITS.MAX_TOTAL_TICKS) {
      return failure('E_RESOURCE_LIMIT', 'total tick budget exceeded');
    }
    const rawActions = options.actions ?? [];
    if (!Array.isArray(rawActions)) return failure('E_SCHEMA', 'actions must be an array');
    if (rawActions.length > RUNTIME_LIMITS.MAX_ACTIONS_PER_STEP) {
      return failure('E_RESOURCE_LIMIT', `at most ${RUNTIME_LIMITS.MAX_ACTIONS_PER_STEP} actions per step`);
    }

    const validated: Array<{ action: ValidatedAction; index: number }> = [];
    for (let i = 0; i < rawActions.length; i += 1) {
      const parsed = validateRuntimeAction(rawActions[i], i);
      if (!parsed.ok) return parsed;
      validated.push({ action: parsed.value, index: i });
    }
    validated.sort((a, b) => compareActions(a.action, b.action, a.index, b.index));

    const firstEventIndex = this.events.length;
    const actionResults: RuntimeActionResult[] = [];
    for (const { action } of validated) {
      const result = this.applyAction(action);
      actionResults.push(result);
      this.emit(this.model.tick, 2, result.code === 'OK' ? 'ACTION_ACCEPTED' : 'ACTION_REJECTED', {
        actionId: action.id,
        actor: action.actor,
        type: action.type,
        code: result.code,
        cost: result.cost,
      });
    }

    let advanced = 0;
    for (let i = 0; i < options.ticks; i += 1) {
      if (this.finished) break;
      const beforeEvidence = new Set(this.model.evidenceSnapshot.map((e) => e.targetId));
      // Same per-tick commit hook the browser Scene uses (sharedCore). No
      // frame-end sampling: transitions resolve at the exact tick boundary.
      let transitions: SliceTransitions = {
        passedDoor: false, enteredCorridor: false, crossedEast: false,
        failed: false, canCheckpoint: false, guardHp: 0,
      };
      this.model.advanceTicks(1, () => {
        if (this.movementRemainingTicks > 0) {
          stepMovement(this.model, this.movement);
          this.movementRemainingTicks -= 1;
          if (this.movementRemainingTicks === 0) this.movement = NO_MOVEMENT;
        }
      }, (before) => {
        transitions = resolveTransitions(this.model, before);
        this.emitTickChanges(before, beforeEvidence, transitions.passedDoor, transitions.enteredCorridor,
          transitions.crossedEast, transitions.failed);
      });
      advanced += 1;
      if (this.model.failed) { this.finish('RUN_FAILED', 'died'); break; }
      if (transitions.crossedEast) { this.finish('RUN_COMPLETED', 'completed'); break; }
    }

    const newEvents = this.events.slice(firstEventIndex);
    return success({
      tick: this.model.tick,
      advanced,
      actionResults: Object.freeze(actionResults.slice()),
      events: Object.freeze(newEvents),
      status: this.status,
      droppedEvents: this.droppedEvents,
    });
  }

  /** Full internal state (dev/test boundary); never returned by observe(). */
  getState(): RuntimeSnapshot {
    return this.snapshot();
  }

  /**
   * PUBLIC observation: a P0 `ObservationV1` whitelist projection. It passes
   * `validateObservationDetailed()` and contains NO Guard FSM `behavior`, raw
   * `reveal`/`corridorReveal`, hidden timers, seed/RNG or undiscovered targets.
   * `visibleTargets` is derived only from legally observed Scan evidence;
   * `availableActions` comes from the model's current-state capability query,
   * not a fixed "always legal" list; `completed` excludes failed runs.
   */
  observe(): RuntimeObservation {
    const snapshot = this.model.snapshot();
    const corridor = snapshot.corridor;
    const roomId = corridor ? 'station-zero-r2' : 'station-zero-r1';
    const observed = this.model.evidenceSnapshot;
    const targetKind: Record<string, string> = {
      tgt_lab_door_receiver: 'receiver',
      tgt_lab_seal_source: 'source',
      tgt_corridor_relay: 'relay',
      tgt_corridor_bridge: 'bridge',
      tgt_corridor_guard: 'guard',
    };
    const evidenceIdOf = (targetId: string, at: number): string =>
      `ev_${fixedHex((hashString(targetId) ^ at) >>> 0, 16)}`;
    const sourceActionIdOf = (targetId: string, at: number): string =>
      `aid_${fixedHex((hashString(`${targetId}|${at}`)) >>> 0, 24)}`;
    const evidence = observed.map((item) => ({
      schema: AI_NATIVE_OBSERVATION_SCHEMA_V1,
      protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      evidenceId: evidenceIdOf(item.targetId, item.observedAtTick),
      sceneEpoch: this.epoch,
      roomId: item.roomId,
      sourceActionId: sourceActionIdOf(item.targetId, item.observedAtTick),
      source: 'player-scan' as const,
      observerActorId: this.actorId,
      observerPosition: { x: item.position.x, y: item.position.y },
      targetId: item.targetId,
      ...(item.relationId ? { relationId: item.relationId } : {}),
      observedAtTick: item.observedAtTick,
      expiresAtTick: item.expiresAtTick,
      observedState: Object.freeze({ stateLabel: item.stateLabel }),
    }));
    const visibleTargets = observed.map((item) => ({
      targetId: item.targetId,
      kind: targetKind[item.targetId] ?? 'receiver',
      publicState: item.stateLabel,
      visibility: 'scan-revealed' as const,
    }));
    const labLink = observed.find((e) => e.relationId === 'rel_lab_seal_link');
    const knownConnections = labLink
      ? [{
        relationId: 'rel_lab_seal_link',
        fromTargetId: 'tgt_lab_seal_source',
        toTargetId: 'tgt_lab_door_receiver',
        stateLabel: 'link-visible',
        evidenceId: evidenceIdOf(labLink.targetId, labLink.observedAtTick),
      }]
      : [];
    const availableActions = this.model.actionAvailability().map((a) => ({
      type: a.type,
      status: a.status,
      ...(a.reasonCode ? { reasonCode: a.reasonCode } : {}),
    }));
    const device: Record<string, string | number | boolean> = {
      door: snapshot.doorState,
      doorPassable: snapshot.doorPassable,
    };
    const timers: Record<string, number> = {
      scanCooldownTicks: snapshot.scanCooldownTicks,
      jamCooldownTicks: snapshot.jamCooldownTicks,
      scanRevealRemainingTicks: snapshot.scanRevealTicks,
      jamRemainingTicks: snapshot.jamRemainingTicks,
      safeClearRemainingTicks: snapshot.safeClearTicks,
    };
    if (corridor) {
      device.relay = corridor.relay;
      device.effectiveOutput = corridor.effectiveOutput;
      device.bridge = corridor.bridge;
      device.bridgePassable = corridor.bridgePassable;
      device.guardLink = corridor.guard.link;
      device.guardHp = corridor.guardHp;
      device.canInteract = corridor.canInteract;
      timers.guardJamRemainingTicks = corridor.guard.jamRemainingTicks;
      timers.bridgeRemainingTicks = corridor.bridgeRemainingTicks;
    }
    const terminal = [...this.events].reverse().find((e) => e.type === 'RUN_COMPLETED' || e.type === 'RUN_FAILED');
    const failed = this.model.failed || terminal?.type === 'RUN_FAILED';
    const self = {
      position: { x: this.model.position.x, y: this.model.position.y },
      energy: snapshot.energy,
      ...(corridor ? { hp: corridor.hp, maxHp: 100 } : {}),
      alive: corridor ? corridor.hp > 0 : !failed,
      paused: snapshot.paused,
      passed: snapshot.passed,
      crossed: corridor?.crossed ?? false,
      failed,
      completed: terminal?.type === 'RUN_COMPLETED' && !failed,
    };
    return Object.freeze({
      schema: AI_NATIVE_OBSERVATION_SCHEMA_V1,
      protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      epoch: this.epoch,
      tick: snapshot.tick,
      actorId: this.actorId,
      role: 'PLAYER' as const,
      detail: 'standard' as const,
      roomId,
      current: {
        self,
        publicDeviceState: device,
        publicTimers: timers,
        visibleTargets,
        knownConnections,
      },
      evidence,
      knowledge: [],
      hypotheses: [],
      events: [],
      availableActions,
      omittedFieldCount: OMITTED_INTERNAL_FIELDS.length,
    }) as unknown as RuntimeObservation;
  }

  /**
   * Full internal snapshot (private/test/dev only). Every call ISSUES a new
   * bounded private handle and records a canonical fingerprint of the complete
   * authoritative payload (including `model.position`, `accumulatorMs`,
   * `lastResult`, events and actionLog). `restore` requires that exact issued
   * payload; a modified frame is rejected even if its public hashes are
   * recomputed.
   */
  snapshot(): RuntimeSnapshot {
    const snapshotId = this.nextSnapshotId();
    const frame: RuntimeSnapshot = {
      schema: RUNTIME_SCHEMA,
      protocolVersion: RUNTIME_VERSION,
      kernelVersion: RUNTIME_KERNEL_VERSION,
      scenario: RUNTIME_SCENARIO,
      snapshotId,
      sessionId: this.sessionId,
      seed: this.seed,
      rngState: this.rng.snapshot(),
      status: this.status,
      epoch: this.epoch,
      tick: this.model.tick,
      movement: { intent: { ...this.movement }, remainingTicks: this.movementRemainingTicks },
      model: this.model.captureFull(),
      events: this.events.slice(),
      eventSeq: this.eventSeq,
      droppedEvents: this.droppedEvents,
      actionSeq: this.actionSeq,
      actionLog: this.actionLog.slice(),
    };
    this.issuedSnapshots.set(snapshotId, snapshotIdentity(frame));
    while (this.issuedSnapshots.size > RUNTIME_LIMITS.MAX_ISSUED_SNAPSHOTS) {
      const oldest = this.issuedSnapshots.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.issuedSnapshots.delete(oldest);
    }
    return frame;
  }

  private nextSnapshotId(): string {
    const counter = this.snapshotCounter;
    this.snapshotCounter += 1;
    return `snap_${fixedHex(this.seed, 8)}${counter.toString(36)}`;
  }

  /**
   * Restore a snapshot that THIS instance issued. ATOMIC: the frame is fully
   * validated into a candidate model before any state is replaced. Requires
   * the private issued handle plus an exact canonical match of the complete
   * authoritative payload, so changing even a legal ground coordinate (or
   * recomputing the public hash) is rejected. No scan, no TTL extension,
   * no cross-session / cross-seed writes.
   */
  restore(input: unknown): RuntimeResult<{ tick: number; status: RuntimeStatus; epoch: number }> {
    return this.restoreFrame(input, true);
  }

  private restoreFrame(
    input: unknown,
    requireIssued: boolean,
  ): RuntimeResult<{ tick: number; status: RuntimeStatus; epoch: number }> {
    const problem = validateRestoreFrame(input, this.seed, this.sessionId, this.rng.snapshot());
    if (problem) return failure('E_SNAPSHOT_INVALID', problem);
    const frame = input as RuntimeSnapshot;
    if (requireIssued) {
      const issued = this.issuedProblem(frame);
      if (issued) return failure('E_SNAPSHOT_INVALID', issued);
    }

    // Build the candidate first; nothing on `this` is touched until it is valid.
    const candidate = new SliceModel();
    candidate.restoreFull(frame.model);

    this.model.dispose();
    this.model = candidate;
    this.status = frame.status;
    // Do NOT call setPaused(): it would zero the restored accumulatorMs.
    this.epoch = frame.epoch + 1; // gateway isolation only; excluded from canonical hash
    this.movement = { ...frame.movement.intent };
    this.movementRemainingTicks = frame.movement.remainingTicks;
    this.events = frame.events.map((event) => Object.freeze({ ...event, payload: { ...event.payload } }));
    this.eventSeq = frame.eventSeq;
    this.droppedEvents = frame.droppedEvents;
    this.actionSeq = frame.actionSeq;
    this.actionLog = frame.actionLog.map((action) => ({ ...action }));
    this.rng.restore(frame.rngState);
    // No synthetic event: replay must reproduce the recorded event stream exactly.
    return success({ tick: this.model.tick, status: this.status, epoch: this.epoch });
  }

  /** Private issuance check: exact handle + exact complete payload. */
  private issuedProblem(frame: RuntimeSnapshot): string | null {
    const expected = this.issuedSnapshots.get(frame.snapshotId);
    if (expected === undefined) {
      return `snapshot was not issued by this instance or was evicted (max ${RUNTIME_LIMITS.MAX_ISSUED_SNAPSHOTS})`;
    }
    if (expected !== snapshotIdentity(frame)) {
      return 'snapshot content does not match the issued frame';
    }
    return null;
  }

  /**
   * Deterministic replay: restore the snapshot into a fresh instance and apply
   * the same ordered steps. `steps` MUST be an array (no silent [] fallback).
   * A zero-step replay reproduces the source canonical state exactly.
   */
  replay(
    input: unknown,
    steps: readonly { readonly actions?: readonly unknown[]; readonly ticks: number }[],
  ): RuntimeResult<{ readonly snapshot: RuntimeSnapshot; readonly canonicalState: string; readonly canonicalEvents: string }> {
    if (!Array.isArray(steps)) return failure('E_SCHEMA', 'replay steps must be an array');
    if (steps.length > RUNTIME_LIMITS.MAX_TICKS_PER_STEP) {
      return failure('E_RESOURCE_LIMIT', 'too many replay steps');
    }
    let totalTicks = 0;
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (!isPlainObject(step)) return failure('E_SCHEMA', `steps[${i}] must be an object`);
      if (step.actions !== undefined && !Array.isArray(step.actions)) {
        return failure('E_SCHEMA', `steps[${i}].actions must be an array`);
      }
      if (!isFiniteInt(step.ticks, 1, RUNTIME_LIMITS.MAX_TICKS_PER_STEP)) {
        return failure('E_SCHEMA', `steps[${i}].ticks is out of range`);
      }
      totalTicks += step.ticks;
    }
    if (totalTicks > RUNTIME_LIMITS.MAX_TOTAL_REPLAY_TICKS) {
      return failure('E_RESOURCE_LIMIT', 'replay total tick budget exceeded');
    }
    if (!isRuntimeSnapshot(input)) return failure('E_SNAPSHOT_INVALID', 'snapshot shape is invalid');
    const issued = this.issuedProblem(input);
    if (issued) return failure('E_SNAPSHOT_INVALID', issued);
    // Isolated deterministic copy: the source was verified as issued by THIS
    // instance, so the fresh game may load it without an external-frame bypass.
    const game = new HeadlessGame({ scenario: RUNTIME_SCENARIO, seed: input.seed, mode: 'headless' });
    const restored = game.restoreFrame(input, false);
    if (!restored.ok) return restored;
    for (const step of steps) {
      const outcome = game.step({ actions: step.actions, ticks: step.ticks });
      if (!outcome.ok) return outcome;
    }
    const snapshot = game.snapshot();
    return success({
      snapshot,
      canonicalState: canonicalState(snapshot),
      canonicalEvents: canonicalEvents(snapshot),
    });
  }

  /** Internal test-only teleport. NEVER exposed as an action or via the CLI. */
  __testSetPosition(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('position must be finite');
    this.model.setPlayerPos(x, y);
  }

  private applyAction(action: ValidatedAction): RuntimeActionResult {
    let result: ActionResult;
    if (action.type === 'move') {
      this.movement = moveIntent(action);
      this.movementRemainingTicks = action.ticks ?? 0;
      // The intent takes effect on the next fixed tick, not as an instant move.
      result = { code: 'OK', message: 'move intent registered', cost: 0 };
    } else if (action.type === 'wait') {
      this.movement = NO_MOVEMENT;
      this.movementRemainingTicks = 0;
      result = { code: 'OK', message: 'wait', cost: 0 };
    } else if (action.type === 'scan') {
      result = this.model.scan();
    } else if (action.type === 'jam') {
      // 'door' and 'relay' both use the model's default relay/door-receiver path.
      result = action.target === 'guard' ? this.model.jam('guard') : this.model.jam('relay');
    } else if (action.type === 'interact') {
      result = this.model.interact();
    } else {
      result = this.model.shootGuard();
    }
    this.actionSeq += 1;
    this.actionLog.push({
      id: action.id,
      actor: action.actor,
      type: action.type,
      ...(action.direction ? { direction: action.direction } : {}),
      ...(action.ticks !== undefined ? { ticks: action.ticks } : {}),
      ...(action.target ? { target: action.target } : {}),
    });
    return { id: action.id, actor: action.actor, type: action.type, code: result.code, cost: result.cost };
  }

  private emitTickChanges(
    before: ReturnType<SliceModel['snapshot']>,
    beforeEvidence: ReadonlySet<string>,
    passedDoor: boolean,
    enteredCorridor: boolean,
    crossedEast: boolean,
    failed: boolean,
  ): void {
    const after = this.model.snapshot();
    const tick = after.tick;
    if (enteredCorridor) this.emit(tick, 0, 'ROOM_ENTERED', { roomId: 'station-zero-r2' });
    if (passedDoor) this.emit(tick, 0, 'DOOR_PASSED', { roomId: 'station-zero-r1' });
    if (before.jamActive && !after.jamActive) this.emit(tick, 4, 'JAM_EXPIRED', {});
    if (!before.jamActive && after.jamActive) this.emit(tick, 4, 'JAM_APPLIED', { remainingTicks: after.jamRemainingTicks });
    if (before.doorState !== after.doorState) {
      this.emit(tick, 4, 'DOOR_STATE_CHANGED', { stateLabel: after.doorState });
    }
    const bc = before.corridor;
    const ac = after.corridor;
    if (ac) {
      if (!bc || bc.relay !== ac.relay) this.emit(tick, 4, 'RELAY_STATE_CHANGED', { stateLabel: ac.relay });
      if (!bc || bc.bridge !== ac.bridge) this.emit(tick, 4, 'BRIDGE_STATE_CHANGED', { stateLabel: ac.bridge });
      if (!bc || bc.guard.link !== ac.guard.link) this.emit(tick, 4, 'GUARD_LINK_CHANGED', { stateLabel: ac.guard.link });
      if (bc && ac.guardHp < bc.guardHp) {
        this.emit(tick, 4, 'GUARD_HIT', { hp: ac.guardHp });
        if (ac.guardHp === 0) this.emit(tick, 4, 'GUARD_CLEARED', {});
      }
      if (ac.hp < (bc?.hp ?? ac.hp)) this.emit(tick, 4, 'PLAYER_DAMAGED', { hp: ac.hp });
    }
    if (crossedEast) this.emit(tick, 0, 'EAST_CROSSED', { roomId: 'station-zero-r2' });
    void failed; // RUN_FAILED is emitted once by finish().
    // R9 evidence lifecycle (created by Scan, expired by TTL) is observable but
    // never re-generated by restore/replay.
    const afterEvidence = this.model.evidenceSnapshot;
    for (const item of afterEvidence) {
      if (!beforeEvidence.has(item.targetId)) {
        this.emit(tick, 5, 'SCAN_EVIDENCE_CREATED', {
          targetId: item.targetId, observedAtTick: item.observedAtTick, expiresAtTick: item.expiresAtTick,
        });
      }
    }
    if (afterEvidence.length === 0 && beforeEvidence.size > 0) {
      this.emit(tick, 5, 'SCAN_EVIDENCE_EXPIRED', {});
    }
  }

  private finish(type: 'RUN_COMPLETED' | 'RUN_FAILED', reason: string): void {
    if (this.status === 'finished') return;
    this.status = 'finished';
    this.emit(this.model.tick, 0, type, { reason });
  }

  private availableActions(): string[] {
    const actions: string[] = ['move', 'scan', 'wait', 'jam', 'interact'];
    if (this.model.inCorridor) actions.push('shoot_guard');
    return actions;
  }

  private emit(tick: number, phase: number, type: string, payload: Record<string, string | number | boolean>): void {
    // Ordinal is per (tick, phase) in emission order.
    let ordinal = 0;
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const event = this.events[i];
      if (event.tick !== tick || event.phase !== phase) break;
      ordinal = event.ordinal + 1;
      break;
    }
    const event: RuntimeEvent = Object.freeze({
      eventSeq: this.eventSeq,
      tick,
      phase,
      ordinal,
      type,
      payload: Object.freeze({ ...payload }),
    });
    this.eventSeq += 1;
    this.events.push(event);
    if (this.events.length > RUNTIME_LIMITS.MAX_EVENTS) {
      this.events.shift();
      this.droppedEvents += 1;
    }
  }
}

function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Canonical AUTHORITATIVE state projection. Transport/log metadata
 * (`epoch`, `eventSeq`, `actionLog`, events, `droppedEvents`) and
 * UI/transport-only model fields (`accumulatorMs`, `lastResult`) are excluded,
 * so `snapshot -> restore -> 0-step replay` reproduces the same hash.
 */
export function canonicalState(snapshot: RuntimeSnapshot): string {
  const { accumulatorMs, lastResult, ...authoritativeModel } = snapshot.model;
  void accumulatorMs;
  void lastResult;
  return canonicalJson({
    schema: snapshot.schema,
    protocolVersion: snapshot.protocolVersion,
    kernelVersion: snapshot.kernelVersion,
    scenario: snapshot.scenario,
    sessionId: snapshot.sessionId,
    seed: snapshot.seed,
    rngState: snapshot.rngState,
    status: snapshot.status,
    tick: snapshot.tick,
    movement: snapshot.movement,
    model: authoritativeModel,
  });
}

/** Canonical identity of the COMPLETE issued payload (public hashes excluded). */
function snapshotIdentity(frame: RuntimeSnapshot): string {
  const { stateHash, eventsHash, ...rest } = frame;
  void stateHash;
  void eventsHash;
  return canonicalJson(rest);
}

/** Canonical ordered-event projection. */
export function canonicalEvents(snapshot: RuntimeSnapshot): string {
  return canonicalJson(snapshot.events);
}

export interface RuntimeHasher {
  (canonical: string): string;
}

/** Attach real sha256 hashes at the Node boundary (hasher is injected). */
export function withHashes(snapshot: RuntimeSnapshot, hasher: RuntimeHasher): RuntimeSnapshot {
  return Object.freeze({
    ...snapshot,
    stateHash: hasher(canonicalState(snapshot)),
    eventsHash: hasher(canonicalEvents(snapshot)),
  });
}

const SNAPSHOT_KEYS = [
  'schema', 'protocolVersion', 'kernelVersion', 'scenario', 'snapshotId', 'sessionId', 'seed',
  'rngState', 'status', 'epoch', 'tick', 'movement', 'model', 'events',
  'eventSeq', 'droppedEvents', 'actionSeq', 'actionLog', 'stateHash', 'eventsHash',
] as const;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SESSION_PATTERN = /^ses_[0-9a-f]{24}$/;
const SNAPSHOT_ID_PATTERN = /^snap_[a-z0-9]{1,64}$/;
const EVENT_KEYS = ['eventSeq', 'tick', 'phase', 'ordinal', 'type', 'payload'];

function isFiniteNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function validateFullSliceRanges(model: FullSliceState): string | null {
  const ranges: ReadonlyArray<readonly [string, number, number, number]> = [
    ['energy', model.energy, 0, 100],
    ['tick', model.tick, 0, RUNTIME_LIMITS.MAX_TOTAL_TICKS],
    ['jamRemainingTicks', model.jamRemainingTicks, 0, SLICE.JAM_DURATION_TICKS],
    ['jamCooldownTicks', model.jamCooldownTicks, 0, SLICE.JAM_CD_TICKS],
    ['scanCooldownTicks', model.scanCooldownTicks, 0, SLICE.SCAN_CD_TICKS],
    ['scanRevealTicks', model.scanRevealTicks, 0, SLICE.SCAN_REVEAL_TICKS],
    ['safeClearTicks', model.safeClearTicks, 0, SLICE.SAFE_CLEAR_DELAY_TICKS],
    ['regenAcc', model.regenAcc, 0, SLICE.REGEN_TICKS - 1],
    ['accumulatorMs', model.accumulatorMs, 0, SLICE.MAX_FRAME_DELTA_MS],
  ];
  for (const [name, value, lo, hi] of ranges) {
    if (!isFiniteNumber(value, lo, hi)) return `model.${name} out of range`;
  }
  if (!isFiniteInt(model.lastRelayInteractTick, -1, RUNTIME_LIMITS.MAX_TOTAL_TICKS)) {
    return 'model.lastRelayInteractTick out of range';
  }
  if (!Number.isFinite(model.playerX) || !Number.isFinite(model.playerY)) return 'model position not finite';
  for (const evidence of model.evidence) {
    if (evidence.observedAtTick > model.tick || model.tick >= evidence.expiresAtTick) {
      return 'model evidence outside TTL window';
    }
  }
  if (model.scanRevealTicks === 0 && model.evidence.length > 0) return 'active evidence without reveal TTL';
  if (model.scanRevealTicks > 0 && model.evidence.length === 0) return 'reveal TTL without evidence';
  if (model.corridor) {
    const c = model.corridor;
    if (!isFiniteNumber(c.health, 0, 100) || !isFiniteNumber(c.deadline, 0, Number.MAX_SAFE_INTEGER) ||
        !isFiniteNumber(c.nextShotTick, 0, Number.MAX_SAFE_INTEGER)) return 'corridor numbers out of range';
    if (!isFiniteNumber(c.guard.health, 0, 1000) || !isFiniteNumber(c.guard.jamUntil, 0, Number.MAX_SAFE_INTEGER) ||
        !isFiniteNumber(c.guard.attackAt, 0, Number.MAX_SAFE_INTEGER)) return 'guard numbers out of range';
    if (!isFiniteNumber(c.location.x, -1e6, 1e6) || !isFiniteNumber(c.location.y, -1e6, 1e6) ||
        !isFiniteNumber(c.guard.location.x, -1e6, 1e6) || !isFiniteNumber(c.guard.location.y, -1e6, 1e6)) {
      return 'corridor position out of range';
    }
    const bridgePassable = c.bridge === 'STABLE' || c.bridge === 'UNSTABLE';
    if (!canStandInCorridor(c.location.x, c.location.y, bridgePassable)) return 'corridor position not standable';
    if (!canStandInCorridor(c.guard.location.x, c.guard.location.y, false)) return 'guard position not standable';
    if (!model.passed) return 'corridor present without passed door';
  } else {
    const doorPassable = model.jamRemainingTicks > 0 || model.door === 'JAMMED_OPEN' ||
      model.door === 'OPEN' || model.door === 'SAFE_PENDING_CLOSE';
    if (!canFit(model.playerX, model.playerY, (cx, cy) => isWalkableCell(cx, cy, doorPassable))) {
      return 'lab position not standable';
    }
    if (model.occupancy !== isOccupyingDoor(model.playerX, model.playerY)) return 'lab occupancy inconsistent';
  }
  return null;
}

/** Closed-schema structural validation of a private runtime frame. */
export function isRuntimeSnapshot(value: unknown): value is RuntimeSnapshot {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => !(SNAPSHOT_KEYS as readonly string[]).includes(key))) return false;
  const required = SNAPSHOT_KEYS.filter((k) => k !== 'stateHash' && k !== 'eventsHash');
  if (required.some((k) => !Object.prototype.hasOwnProperty.call(value, k))) return false;
  if (value.schema !== RUNTIME_SCHEMA || value.protocolVersion !== RUNTIME_VERSION ||
      value.kernelVersion !== RUNTIME_KERNEL_VERSION || value.scenario !== RUNTIME_SCENARIO) return false;
  if (typeof value.snapshotId !== 'string' || !SNAPSHOT_ID_PATTERN.test(value.snapshotId)) return false;
  if (typeof value.sessionId !== 'string' || !SESSION_PATTERN.test(value.sessionId)) return false;
  if (!isFiniteInt(value.seed, 0, 0xffffffff) || !isFiniteInt(value.rngState, 0, 0xffffffff)) return false;
  if (value.status !== 'running' && value.status !== 'paused' && value.status !== 'finished') return false;
  if (!isFiniteInt(value.epoch, 0, Number.MAX_SAFE_INTEGER) ||
      !isFiniteInt(value.tick, 0, RUNTIME_LIMITS.MAX_TOTAL_TICKS)) return false;
  if (value.stateHash !== undefined && (typeof value.stateHash !== 'string' || !HASH_PATTERN.test(value.stateHash))) return false;
  if (value.eventsHash !== undefined && (typeof value.eventsHash !== 'string' || !HASH_PATTERN.test(value.eventsHash))) return false;
  if (!isFullSliceState(value.model)) return false;
  if (validateFullSliceRanges(value.model)) return false;
  if (value.model.tick !== value.tick) return false;
  if (value.model.paused !== (value.status === 'paused')) return false;
  const movement = value.movement;
  if (!isPlainObject(movement) || !isFiniteInt(movement.remainingTicks, 0, RUNTIME_LIMITS.MAX_INTENT_TICKS)) return false;
  const intent = movement.intent;
  if (!isPlainObject(intent) || !['up', 'down', 'left', 'right'].every((k) => typeof intent[k] === 'boolean')) return false;
  if (!Array.isArray(value.events) || value.events.length > RUNTIME_LIMITS.MAX_EVENTS) return false;
  if (!Array.isArray(value.actionLog) || value.actionLog.length > RUNTIME_LIMITS.MAX_ACTION_LOG) return false;
  if (!isFiniteInt(value.eventSeq, 0, Number.MAX_SAFE_INTEGER) ||
      !isFiniteInt(value.droppedEvents, 0, Number.MAX_SAFE_INTEGER) ||
      !isFiniteInt(value.actionSeq, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (value.actionSeq !== value.actionLog.length) return false;
  if (value.eventSeq !== value.events.length + value.droppedEvents) return false;
  // Full total order is `eventSeq` (contiguous, monotonic); tick is
  // non-decreasing and ordinals are contiguous within each (tick, phase) run.
  let previousEventSeq = -1;
  let lastTick = -1;
  let lastPhase = -1;
  let expectedOrdinal = 0;
  for (let i = 0; i < value.events.length; i += 1) {
    const event = value.events[i];
    if (!isPlainObject(event) || Object.keys(event).length !== EVENT_KEYS.length ||
        EVENT_KEYS.some((k) => !Object.prototype.hasOwnProperty.call(event, k))) return false;
    if (!isFiniteInt(event.eventSeq, 0, Number.MAX_SAFE_INTEGER) ||
        !isFiniteInt(event.tick, 0, RUNTIME_LIMITS.MAX_TOTAL_TICKS) ||
        !isFiniteInt(event.phase, 0, 6) || !isFiniteInt(event.ordinal, 0, Number.MAX_SAFE_INTEGER)) return false;
    if (typeof event.type !== 'string' || !isPlainObject(event.payload)) return false;
    if (i > 0 && event.eventSeq !== previousEventSeq + 1) return false;
    if (event.tick < lastTick) return false;
    if (event.tick === lastTick && event.phase === lastPhase) {
      if (event.ordinal !== expectedOrdinal) return false;
      expectedOrdinal += 1;
    } else {
      if (event.ordinal !== 0) return false;
      lastTick = event.tick;
      lastPhase = event.phase;
      expectedOrdinal = 1;
    }
    previousEventSeq = event.eventSeq;
    for (const payloadValue of Object.values(event.payload)) {
      if (payloadValue === null) continue;
      if (typeof payloadValue === 'number' && !Number.isFinite(payloadValue)) return false;
      if (typeof payloadValue !== 'string' && typeof payloadValue !== 'number' && typeof payloadValue !== 'boolean') return false;
    }
  }
  if (value.events.length > 0 && value.events[value.events.length - 1].eventSeq !== value.eventSeq - 1) return false;
  for (let i = 0; i < value.actionLog.length; i += 1) {
    if (!validateRuntimeAction(value.actionLog[i], i).ok) return false;
  }
  return true;
}

/** Source binding + provenance checks performed before any state is replaced. */
export function validateRestoreFrame(
  value: unknown,
  seed: number,
  sessionId: string,
  rngState: number,
): string | null {
  if (!isRuntimeSnapshot(value)) return 'snapshot shape is invalid';
  if (value.seed !== seed) return 'snapshot source seed mismatch';
  if (value.sessionId !== sessionId) return 'snapshot source session mismatch';
  if (value.rngState !== rngState) return 'snapshot rng/source state mismatch';
  if (value.status === 'finished' &&
      !value.events.some((event) => event.type === 'RUN_COMPLETED' || event.type === 'RUN_FAILED')) {
    return 'finished status without a terminal event';
  }
  if (value.model.passed &&
      !value.events.some((event) => event.type === 'DOOR_PASSED' && event.tick <= value.tick)) {
    return 'passed flag set but no DOOR_PASSED event is bound to this frame';
  }
  return null;
}

export function createGame(options: CreateGameOptions): HeadlessGame {
  return new HeadlessGame(options);
}
