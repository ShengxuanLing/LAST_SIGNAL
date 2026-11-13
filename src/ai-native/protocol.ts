/**
 * LAST SIGNAL — AI-NATIVE-01 / P0 `protocol.ts`
 *
 * Pure TypeScript DTO schema v1: types, constants, canonicalization and
 * side-effect-free validation ONLY. Implements the landed contract
 *   docs/AI_NATIVE_PROTOCOL.md, docs/AI_NATIVE_ARCHITECTURE.md,
 *   docs/AI_NATIVE_PERMISSION_MODEL.md
 * as far as a *schema* module can; Gateway/Runtime/Session-Manager behaviour
 * (caches, rate limiters, event logs, snapshot stores, MCP, WebSocket) is P1+
 * and is deliberately NOT implemented or faked here.
 *
 * HARD BOUNDARIES
 *  - no `phaser` import, no DOM / localStorage, no Node `crypto`/`Buffer`,
 *    no `Date.now()` / `performance.now()` / `Math.random()`, no timers;
 *  - no global mutable Session / cache / rate-limit singleton;
 *  - no import of gameplay *logic*; the only slice reference is a type-only
 *    import of `PersistedSliceState` (erased at runtime) so Snapshot.state
 *    reuses the authoritative shape instead of copying it;
 *  - every v1 object has a CLOSED schema: unknown top-level or nested fields,
 *    NaN/Infinity, undefined, symbol, bigint, function, class instance, Set,
 *    Map, Date, accessor property, cycle and hidden-field names are rejected,
 *    never silently stripped and never "passed through as-is".
 *
 * EXPLICIT IMPLEMENTATION STATUS
 *  - `aim` / `fire` / `decoy` ARE part of `ActionTypeV1` as *wire shapes*, but
 *    the Station Zero P0 game has NO implementation. `validateActionSupport()`
 *    returns `E_NOT_APPLICABLE` for them; a validated wire shape is never
 *    evidence that the game implements it. See GAME_IMPLEMENTATION_STATUS and
 *    AI_NATIVE_UNSUPPORTED_ACTIONS_V1.
 *  - `pause` / `resume` are `SessionCommandV1` commands in the landed contract,
 *    not `ActionRequestV1` types (see AI_NATIVE_SESSION_COMMANDS_V1).
 *  - actor identity in v1 DTOs is an opaque `actorId` + registry `role`
 *    (PLAYER / COMPANION / DEVELOPER). No `player` / `echo` legacy aliases are
 *    exported; role is never carried inside a v1 request.
 *  - structural validation of Snapshot/Replay is NOT authorization. Internal
 *    production snapshots are valid private storage frames; only a separate
 *    pure audience check (`authorizeRawFrame`) decides external delivery.
 *
 * P1 SEAM (suggestions; do not implement here)
 *  1. `SessionDescriptorV1.tick` <- `SliceModel.tick`; `epoch` is owned by the
 *     Gateway and changes on slice load / restore / reset / new run.
 *  2. ActionRequest dispatch must call `SliceModel.scan()/jam(target)/
 *     interact()/shootGuard()/setPlayerPos()+canStand()/setPaused()` and
 *     `step(SLICE.TICK_MS, onTick)`, plus `Corridor` geometry. Never copy the
 *     door/bridge/guard resolvers into the protocol layer.
 *  3. `ObservationV1` is a whitelist PROJECTION of `SliceModel.snapshot()` and
 *     `Corridor.snapshot(tick)`; never `JSON.stringify(scene/world/model)`.
 *     `SliceSnapshot` internals (manualOpenIntent, reveal*, occupancy,
 *     regenAcc, deadline, ...) are in AI_NATIVE_HIDDEN_FIELD_NAMES_V1.
 *  4. R9: `ObservationEvidenceV1` must be produced only inside a successful
 *     Scan transaction; `restore()` must only validate+deep-copy the saved
 *     array, never re-run scan/LOS, never extend TTL. Old
 *     `last_signal_station_zero_vs00_v1` saves have no evidence -> clear and
 *     ask for a fresh scan.
 *  5. Death = `finished(died)` -> explicit `reset` -> new runId + new epoch +
 *     R0 (never a checkpoint continuation). Only exit/refresh restores the
 *     most recent safe checkpoint. Main World variable dt / Math.random is NOT
 *     covered by any determinism promise.
 *  6. Snapshot/Replay/Envelope validation below is structural. Hashing of
 *     `stateHash`/`eventsHash` with sha256 belongs to Gateway/Runtime (P1);
 *     this module only validates the string shape (no Node crypto).
 */

import type { PersistedSliceState } from '../slice/rules';

// ---------------------------------------------------------------------------
// 1. Version / schema constants (protocol §1, §3)
// ---------------------------------------------------------------------------

export const AI_NATIVE_PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof AI_NATIVE_PROTOCOL_VERSION;

export const AI_NATIVE_DTO_SCHEMA_V1 = 'last_signal.ai-native.dto.v1' as const;
export const AI_NATIVE_ENVELOPE_SCHEMA_V1 = 'last_signal.ai-native.envelope.v1' as const;
export const AI_NATIVE_OBSERVATION_SCHEMA_V1 = 'last_signal.ai-native.observation.v1' as const;
export const AI_NATIVE_DEBUG_SCHEMA_V1 = 'last_signal.ai-native.debug.v1' as const;
export const AI_NATIVE_EVENT_SCHEMA_V1 = 'last_signal.ai-native.event.v1' as const;
export const AI_NATIVE_SNAPSHOT_SCHEMA_V1 = 'last_signal.ai-native.snapshot.v1' as const;
export const AI_NATIVE_REPLAY_SCHEMA_V1 = 'last_signal.ai-native.replay.v1' as const;

export const AI_NATIVE_SCHEMA_V1 = Object.freeze({
  dto: AI_NATIVE_DTO_SCHEMA_V1,
  envelope: AI_NATIVE_ENVELOPE_SCHEMA_V1,
  observation: AI_NATIVE_OBSERVATION_SCHEMA_V1,
  debug: AI_NATIVE_DEBUG_SCHEMA_V1,
  event: AI_NATIVE_EVENT_SCHEMA_V1,
  snapshot: AI_NATIVE_SNAPSHOT_SCHEMA_V1,
  replay: AI_NATIVE_REPLAY_SCHEMA_V1,
});
export type AiNativeSchemaV1 = (typeof AI_NATIVE_SCHEMA_V1)[keyof typeof AI_NATIVE_SCHEMA_V1];

export const AI_NATIVE_KERNEL_VERSION_V1 = 'station-zero-r1-r2@1' as const;
export const AI_NATIVE_SCENARIO_ID_V1 = 'station-zero-r1-r2' as const;
export const AI_NATIVE_ROOM_IDS_V1 = Object.freeze(['station-zero-r1', 'station-zero-r2'] as const);
export type RoomIdV1 = (typeof AI_NATIVE_ROOM_IDS_V1)[number];

// ---------------------------------------------------------------------------
// 2. Error codes (protocol §6.2), limits (§11), status enums
// ---------------------------------------------------------------------------

export const AI_NATIVE_ERROR_CODES_V1 = Object.freeze([
  'E_SCHEMA', 'E_VERSION_UNSUPPORTED', 'E_PAYLOAD_TOO_LARGE',
  'E_SESSION_NOT_FOUND', 'E_SESSION_CLOSED', 'E_STALE_EPOCH',
  'E_STALE_GENERATION', 'E_TARGET_DESTROYED', 'E_STALE_TICK', 'E_FUTURE_TICK',
  'E_UNKNOWN_ACTOR', 'E_ID_PAYLOAD_MISMATCH', 'E_ACTION_EXPIRED',
  'E_PERMISSION', 'E_PAUSED', 'E_NOT_APPLICABLE', 'E_ILLEGAL_TARGET',
  'E_LINK_UNAVAILABLE', 'E_RETRYABLE', 'E_ENERGY_INSUFFICIENT', 'E_COOLDOWN',
  'E_RATE_LIMIT', 'E_RESOURCE_LIMIT', 'E_CANCELLED', 'E_PREEMPTED', 'E_TIMEOUT',
  'E_SNAPSHOT_INVALID', 'E_REPLAY_INCOMPATIBLE', 'E_SAVE_FAILED',
  'E_INTERNAL_TRANSACTION',
] as const);
export type ErrorCodeV1 = (typeof AI_NATIVE_ERROR_CODES_V1)[number];
export type StepResultCodeV1 = 'OK' | ErrorCodeV1;

/** Wire/engineering guardrails — NOT gameplay tuning values. */
export const AI_NATIVE_LIMITS_V1 = Object.freeze({
  MAX_SESSIONS: 16,
  MAX_CONCURRENT_STEPS: 4,
  MAX_TICKS_PER_STEP: 1000,
  MAX_TICKS_PER_STEP_HARD: 10000,
  MAX_ACTIONS_PER_TICK: 32,
  MAX_ACTIVE_INTENTS_PER_ACTOR: 1,
  MAX_ACTION_DURATION_TICKS: 3600,
  MAX_PAYLOAD_BYTES: 4096,
  MAX_OBSERVATION_EVENTS: 64,
  MAX_EVENT_LOG_EVENTS: 10000,
  MAX_EVENTS_PER_PAGE: 256,
  MAX_SNAPSHOT_BYTES: 262144,
  MAX_REPLAY_ACTIONS: 100000,
  MAX_REPLAY_BYTES: 8388608,
  REQUEST_TIMEOUT_MS: 30000,
  HEARTBEAT_MS: 5000,
  IDLE_TIMEOUT_MS: 300000,
  MAX_SESSION_WALL_MS: 3600000,
  MAX_REQUESTS_PER_SECOND: 20,
  MAX_OBSERVE_PER_SECOND: 10,
  MAX_STEP_TICKS_PER_SECOND: 6000,
  /** schema-layer bounds, not the transport table above */
  MAX_TICK: 2_147_483_647,
  MAX_COORDINATE_ABS: 1_000_000,
  MAX_STRING_LENGTH: 128,
  /** default per-DTO array ceiling (explicit per-field ceilings override) */
  MAX_ARRAY_LENGTH: 64,
  MAX_OBJECT_KEYS: 4096,
  MAX_DEPTH: 32,
  MAX_NODES: 200000,
  /** raw JSON purity walk ceilings: must not constrain replay-length arrays */
  WALK_MAX_ARRAY_LENGTH: 100000,
});

export const AI_NATIVE_ROLES_V1 = Object.freeze(['PLAYER', 'COMPANION', 'DEVELOPER'] as const);
export type RoleV1 = (typeof AI_NATIVE_ROLES_V1)[number];
export const AI_NATIVE_SESSION_KINDS_V1 = Object.freeze(['production', 'test'] as const);
export type SessionKindV1 = (typeof AI_NATIVE_SESSION_KINDS_V1)[number];
export const AI_NATIVE_MODES_V1 = Object.freeze(['headless', 'rendered'] as const);
export type ModeV1 = (typeof AI_NATIVE_MODES_V1)[number];
export const AI_NATIVE_SESSION_STATUSES_V1 = Object.freeze([
  'created', 'running', 'paused', 'finished', 'closed', 'failed',
] as const);
export type SessionStatusV1 = (typeof AI_NATIVE_SESSION_STATUSES_V1)[number];
export const AI_NATIVE_RUN_END_REASONS_V1 = Object.freeze([
  'completed', 'died', 'cancelled', 'timeout', 'closed',
] as const);
export type RunEndReasonV1 = (typeof AI_NATIVE_RUN_END_REASONS_V1)[number] | null;

export const AI_NATIVE_ACTION_TYPES_V1 = Object.freeze([
  'move', 'aim', 'fire', 'scan', 'jam', 'interact', 'shoot_guard', 'decoy', 'wait',
] as const);
export type ActionTypeV1 = (typeof AI_NATIVE_ACTION_TYPES_V1)[number];

/** Wire-valid but NOT implemented in Station Zero P0 (must be E_NOT_APPLICABLE). */
export const AI_NATIVE_UNSUPPORTED_ACTIONS_V1 = Object.freeze(['aim', 'fire', 'decoy'] as const);
export type UnsupportedActionV1 = (typeof AI_NATIVE_UNSUPPORTED_ACTIONS_V1)[number];

/** pause/resume live here in the landed contract, NOT in ActionTypeV1. */
export const AI_NATIVE_SESSION_COMMANDS_V1 = Object.freeze([
  'pause', 'resume', 'reset', 'close', 'snapshot', 'restore', 'replay',
  'inspect_state', 'inject_fixture',
] as const);
export type SessionCommandNameV1 = (typeof AI_NATIVE_SESSION_COMMANDS_V1)[number];

export const AI_NATIVE_ACTION_STATUSES_V1 = Object.freeze([
  'pending', 'active', 'completed', 'rejected', 'timeout', 'cancelled', 'preempted',
] as const);
export type ActionStatusV1 = (typeof AI_NATIVE_ACTION_STATUSES_V1)[number];
export const AI_NATIVE_STEP_STATUSES_V1 = Object.freeze([
  'completed', 'paused', 'finished', 'rejected', 'cancelled',
] as const);
export type StepStatusV1 = (typeof AI_NATIVE_STEP_STATUSES_V1)[number];
export const AI_NATIVE_EVENT_PHASES_V1 = Object.freeze([
  'lifecycle', 'protocol', 'action', 'domain-precommit', 'domain-commit',
  'observation', 'dev-audit',
] as const);
export type EventPhaseV1 = (typeof AI_NATIVE_EVENT_PHASES_V1)[number];

/** Machine-readable statement: schema validation is not an implementation. */
export const GAME_IMPLEMENTATION_STATUS = Object.freeze({
  runtime: 'NOT_IMPLEMENTED_P0',
  adapter: 'NOT_IMPLEMENTED_P0',
  mcpServer: 'NOT_IMPLEMENTED_P0',
  phaserInputLayer: 'NOT_IMPLEMENTED_P0',
  protocolOnly: true,
  statement:
    'P0 = versioned DTOs + pure schema validation. aim/fire/decoy are unsupported ' +
    '(E_NOT_APPLICABLE) and must not be reported as game-implemented.',
});

/**
 * Hidden-field blacklist (protocol §5.3). Checked case-insensitively on every
 * public DTO key at every depth. `private` scopes (DebugInspection.fullState,
 * Snapshot.state) intentionally bypass this blacklist.
 */
export const AI_NATIVE_HIDDEN_FIELD_NAMES_V1: readonly string[] = Object.freeze([
  'seed', 'bestseed', 'best_seed', 'rng', 'rngstate', 'rng_state', 'rng.state',
  'gamescene.seed', 'mapdata.seed', 'mapdata', 'tiles', 'doorways', 'roomsorder',
  'enteredrooms', 'hiddenmap', 'fullmap', 'hidden_map', 'unexplored',
  'statetimer', 'state_timer', 'patrolpoints', 'patrolindex', 'stuntimer',
  'aggrorange', 'fsm', 'detects', 'hitset', 'state',
  'savedata', 'saveversion', 'save_version', 'version',
  'createdat', 'updatedat', 'permanent', 'settings', 'stats',
  'unlockedweapons', 'unlockedabilities',
  'scene', 'world', 'renderer', 'sprite', 'camera', 'phaser', '__game',
  'window', 'localstorage', 'document', 'process', 'env',
  'apikey', 'token', 'password', 'secret', 'credential', 'authorization',
  'aimyaw', 'dashtimer', 'invuln', 'reloadtimer',
  'manualopenintent', 'sealsourcepresent', 'pendingsafeclose', 'occupancy',
  'revealdoorreceiver', 'revealsealsource', 'reveal', 'revealraw',
  'deadline', 'regenacc', 'listeners', 'nextshottick', 'attackat', 'watching',
  'guard.evidence', 'enemies', 'projectiles', 'loot', 'fx', 'raw', 'internal',
  'hidden', 'hypothesis', 'canonical', 'enemydata', 'playerdata', 'weaponstate',
  'role', 'permission', 'asactor', 'impersonate', 'asactorid', 'debug', 'test',
  'fixture', 'fixtureref', 'fixturelog', 'fixturevalue',
  'prototype', 'constructor', '__proto__',
]);

// ---------------------------------------------------------------------------
// 3. Primitive ID / value types (protocol §2)
// ---------------------------------------------------------------------------

export type SessionId = `ses_${string}`;
export type ActorId = `act_${string}`;
export type ActionId = `aid_${string}`;
export type RequestId = `req_${string}`;
export type TargetId = `tgt_${string}`;
export type EvidenceId = `ev_${string}`;
export type EventId = `evt_${string}`;
export type SnapshotId = `snap_${string}`;
export type Epoch = number;
export type Tick = number;
export type ClientSeq = number;
export type Ms = number;

export interface WxWyV1 { readonly x: number; readonly y: number }

const ID_PATTERNS = {
  sessionId: /^ses_[0-9a-f]{24}$/,
  actorId: /^act_[0-9a-f]{16}$/,
  actionId: /^aid_[0-9a-f]{24}$/,
  requestId: /^req_[0-9a-f]{24}$/,
  targetId: /^tgt_[a-z0-9_]{1,64}$/,
  evidenceId: /^ev_[a-z0-9]{1,64}$/,
  eventId: /^evt_[a-z0-9]{1,64}$/,
  snapshotId: /^snap_[a-z0-9]{1,64}$/,
} as const;
export const AI_NATIVE_ID_PATTERNS_V1: Readonly<typeof ID_PATTERNS> = Object.freeze(ID_PATTERNS);

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const SHA256_HASH = /^sha256:[0-9a-f]{64}$/;
const FNV_HASH = /^fnv1a32:[0-9a-f]{8}$/;

// ---------------------------------------------------------------------------
// 4. DTO types (protocol §3–§9)
// ---------------------------------------------------------------------------

export interface ActorBindingV1 {
  readonly actorId: ActorId;
  readonly role: RoleV1;
  readonly priority: 0 | 1 | 2;
  readonly allowedActions: readonly ActionTypeV1[];
  readonly observationScope: 'self' | 'shared';
}
export interface ResourceLimitsV1 {
  readonly maxTicksPerStep: number;
  readonly maxActionsPerTick: number;
  readonly maxActiveIntentsPerActor: number;
  readonly maxActionDurationTicks: number;
  readonly maxPayloadBytes: number;
  readonly maxObservationEvents: number;
  readonly maxEventsPerPage: number;
  readonly maxRequestsPerSecond: number;
  readonly maxObservePerSecond: number;
  readonly maxStepTicksPerSecond: number;
  readonly requestTimeoutMs: number;
  readonly heartbeatMs: number;
  readonly idleTimeoutMs: number;
  readonly maxSessionWallMs: number;
}
export interface SessionDescriptorV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly sessionId: SessionId;
  readonly kind: SessionKindV1;
  readonly mode: ModeV1;
  readonly status: SessionStatusV1;
  readonly epoch: Epoch;
  readonly tick: Tick;
  readonly scenarioId: typeof AI_NATIVE_SCENARIO_ID_V1;
  readonly kernelVersion: typeof AI_NATIVE_KERNEL_VERSION_V1;
  readonly runId: string;
  readonly runEndReason: RunEndReasonV1;
  readonly actorRegistry: Readonly<Record<string, ActorBindingV1>>;
  readonly createdAtMs: Ms;
  readonly lastActivityMs: Ms;
  readonly expiresAtMs: Ms;
  readonly resourceLimits: ResourceLimitsV1;
}
export interface CreateSessionRequestV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly requestId: RequestId;
  readonly kind: SessionKindV1;
  readonly mode: ModeV1;
  readonly scenarioId: typeof AI_NATIVE_SCENARIO_ID_V1;
  readonly actorSpecs: readonly {
    readonly role: RoleV1;
    readonly observationScope: 'self' | 'shared';
    readonly allowedActions: readonly ActionTypeV1[];
  }[];
  readonly seed?: number;
  readonly fixtureRef?: string;
  readonly resourceLimits?: Partial<ResourceLimitsV1>;
}
export type ActionPayloadV1 =
  | { readonly type: 'move'; readonly direction: WxWyV1; readonly durationTicks: number }
  | { readonly type: 'aim'; readonly direction: WxWyV1 }
  | { readonly type: 'fire'; readonly held: boolean; readonly durationTicks: number }
  | { readonly type: 'scan' }
  | { readonly type: 'jam'; readonly targetId: TargetId }
  | { readonly type: 'interact'; readonly targetId: TargetId }
  | { readonly type: 'shoot_guard'; readonly targetId: TargetId }
  | { readonly type: 'decoy'; readonly position: WxWyV1 }
  | { readonly type: 'wait'; readonly durationTicks: number };
export interface ActionRequestV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly actionId: ActionId;
  readonly actorId: ActorId;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly targetTick: Tick;
  readonly type: ActionTypeV1;
  readonly payload: ActionPayloadV1;
  readonly clientSeq: ClientSeq;
  readonly issuedAtMs: Ms;
  readonly deadlineTick: Tick;
}
export interface StepRequestV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly requestId: RequestId;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly fromTick: Tick;
  readonly ticks: number;
  readonly actions: readonly ActionRequestV1[];
  readonly includeObservation: boolean;
  readonly observationDetail?: 'summary' | 'standard';
}
export interface SessionCommandV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly requestId: RequestId;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly actorId: ActorId;
  readonly command: SessionCommandNameV1 | 'observe' | 'get_events' | 'cancel_action' | 'step';
}
export interface CancelActionRequestV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly requestId: RequestId;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly actorId: ActorId;
  readonly actionId: ActionId;
  readonly reason: 'client_cancel' | 'human_takeover' | 'timeout' | 'session_close';
}
export interface ActionResultV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly tick: Tick;
  readonly actionId: ActionId;
  readonly actorId: ActorId;
  readonly status: ActionStatusV1;
  readonly code: StepResultCodeV1;
  readonly cost: number;
  readonly resourceWritesThisCall: 0 | 1;
  readonly replayed: boolean;
  readonly durationRemainingTicks?: number;
  readonly correlationId?: RequestId;
  readonly messageKey?: string;
}
export interface ResourceUsageV1 {
  readonly wallMs: number;
  readonly ticksAdvanced: number;
  readonly eventsEmitted: number;
  readonly peakActionsPerTick: number;
  readonly droppedEvents: number;
  readonly truncatedObservation: boolean;
}
export interface StepResultV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly fromTick: Tick;
  readonly toTick: Tick;
  readonly status: StepStatusV1;
  readonly actionResults: readonly ActionResultV1[];
  readonly events: readonly EventV1[];
  readonly eventCursor: number;
  readonly observation?: ObservationV1;
  readonly postStateHash: string;
  readonly resourceUsage: ResourceUsageV1;
}
export interface ErrorV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly sessionId?: SessionId;
  readonly epoch?: Epoch;
  readonly tick?: Tick;
  readonly requestId?: RequestId;
  readonly correlationId?: RequestId | ActionId;
  readonly code: ErrorCodeV1;
  readonly messageKey: string;
  readonly retryable: boolean;
}
export interface ObservationEvidenceV1 {
  readonly schema: typeof AI_NATIVE_OBSERVATION_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly evidenceId: EvidenceId;
  readonly sceneEpoch: Epoch;
  readonly roomId: RoomIdV1;
  readonly sourceActionId: ActionId;
  readonly source: 'player-scan';
  readonly observerActorId: ActorId;
  readonly observerPosition: WxWyV1;
  readonly targetId: TargetId;
  readonly relationId?: string;
  readonly observedAtTick: Tick;
  readonly expiresAtTick: Tick;
  readonly observedState: Readonly<Record<string, string | number | boolean>>;
}
export interface ActionCapabilityV1 {
  readonly type: ActionTypeV1;
  readonly status: 'available' | 'unavailable' | 'cooldown' | 'insufficient_energy' | 'permission_denied';
  readonly reasonCode?: ErrorCodeV1;
  readonly targetIds?: readonly TargetId[];
  readonly maxDurationTicks?: number;
}
export interface CurrentFactsV1 {
  readonly self: {
    readonly position: WxWyV1;
    readonly energy: number;
    readonly hp?: number;
    readonly maxHp?: number;
    readonly alive: boolean;
    readonly paused: boolean;
    readonly passed: boolean;
    readonly crossed: boolean;
    readonly failed: boolean;
    readonly completed: boolean;
  };
  readonly publicDeviceState: {
    readonly door: 'SEALED' | 'JAMMED_OPEN' | 'OPEN' | 'CLOSED' | 'SAFE_PENDING_CLOSE';
    readonly doorPassable: boolean;
    readonly relay?: 'ACTIVE' | 'INACTIVE' | 'JAMMED' | 'DISABLED';
    readonly effectiveOutput?: boolean;
    readonly bridge?: 'UNAVAILABLE' | 'TRANSITIONING' | 'STABLE' | 'UNSTABLE' | 'DISABLED';
    readonly bridgePassable?: boolean;
    readonly guardLink?: 'DEAD' | 'JAMMED' | 'LINKED' | 'DISCONNECTED';
    readonly guardHp?: number;
    readonly canInteract?: boolean;
    readonly onBridge?: boolean;
    readonly lastShore?: 'west' | 'east';
  };
  readonly publicTimers: {
    readonly scanCooldownTicks: number;
    readonly jamCooldownTicks: number;
    readonly scanRevealRemainingTicks: number;
    readonly jamRemainingTicks: number;
    readonly safeClearRemainingTicks: number;
    readonly guardJamRemainingTicks?: number;
    readonly bridgeRemainingTicks?: number;
  };
  readonly visibleTargets: readonly {
    readonly targetId: TargetId;
    readonly kind: 'door' | 'receiver' | 'source' | 'relay' | 'bridge' | 'guard' | 'control';
    readonly publicState: string;
    readonly position?: WxWyV1;
    readonly visibility: 'ordinary' | 'scan-revealed' | 'echo-shared';
  }[];
  readonly knownConnections: readonly {
    readonly relationId: string;
    readonly fromTargetId: TargetId;
    readonly toTargetId: TargetId;
    readonly stateLabel: string;
    readonly evidenceId: EvidenceId;
  }[];
}
export interface ObservationV1 {
  readonly schema: typeof AI_NATIVE_OBSERVATION_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly tick: Tick;
  readonly actorId: ActorId;
  readonly role: RoleV1;
  readonly detail: 'summary' | 'standard';
  readonly roomId: RoomIdV1;
  readonly current: CurrentFactsV1;
  readonly evidence: readonly ObservationEvidenceV1[];
  readonly knowledge: readonly unknown[];
  readonly hypotheses: readonly unknown[];
  readonly events: readonly EventV1[];
  readonly availableActions: readonly ActionCapabilityV1[];
  readonly omittedFieldCount: number;
}
export interface DebugInspectionV1 {
  readonly schema: typeof AI_NATIVE_DEBUG_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly tick: Tick;
  readonly actorId: ActorId;
  readonly role: 'DEVELOPER';
  readonly fullState: unknown;
  readonly seed?: number;
  readonly rngState?: number | null;
  readonly fixtureLog: readonly unknown[];
  readonly rawEvents: readonly EventV1[];
  readonly hiddenMap?: unknown;
}
export type EventTypeV1 =
  | 'SESSION_CREATED' | 'SESSION_PAUSED' | 'SESSION_RESUMED' | 'SESSION_RESET' | 'SESSION_CLOSED'
  | 'ACTION_ACCEPTED' | 'ACTION_REJECTED' | 'ACTION_COMPLETED'
  | 'ACTION_CANCELLED' | 'ACTION_PREEMPTED' | 'ACTION_TIMEOUT' | 'ACTION_REPLAYED'
  | 'SCAN_EVIDENCE_CREATED' | 'SCAN_EVIDENCE_EXPIRED'
  | 'JAM_APPLIED' | 'JAM_EXPIRED' | 'DOOR_STATE_CHANGED'
  | 'RELAY_STATE_CHANGED' | 'BRIDGE_STATE_CHANGED' | 'GUARD_LINK_CHANGED'
  | 'GUARD_HIT' | 'GUARD_CLEARED' | 'PLAYER_RESCUED' | 'PLAYER_DAMAGED'
  | 'ROOM_ENTERED' | 'DOOR_PASSED' | 'EAST_CROSSED'
  | 'RUN_COMPLETED' | 'RUN_FAILED'
  | 'SNAPSHOT_SAVED' | 'SNAPSHOT_RESTORED' | 'REPLAY_STARTED' | 'REPLAY_FINISHED'
  | 'DEV_FIXTURE_INJECTED'
  | 'PERMISSION_DENIED' | 'RATE_LIMITED' | 'SCHEMA_REJECTED';
export const AI_NATIVE_EVENT_TYPES_V1 = Object.freeze([
  'SESSION_CREATED', 'SESSION_PAUSED', 'SESSION_RESUMED', 'SESSION_RESET', 'SESSION_CLOSED',
  'ACTION_ACCEPTED', 'ACTION_REJECTED', 'ACTION_COMPLETED',
  'ACTION_CANCELLED', 'ACTION_PREEMPTED', 'ACTION_TIMEOUT', 'ACTION_REPLAYED',
  'SCAN_EVIDENCE_CREATED', 'SCAN_EVIDENCE_EXPIRED',
  'JAM_APPLIED', 'JAM_EXPIRED', 'DOOR_STATE_CHANGED',
  'RELAY_STATE_CHANGED', 'BRIDGE_STATE_CHANGED', 'GUARD_LINK_CHANGED',
  'GUARD_HIT', 'GUARD_CLEARED', 'PLAYER_RESCUED', 'PLAYER_DAMAGED',
  'ROOM_ENTERED', 'DOOR_PASSED', 'EAST_CROSSED',
  'RUN_COMPLETED', 'RUN_FAILED',
  'SNAPSHOT_SAVED', 'SNAPSHOT_RESTORED', 'REPLAY_STARTED', 'REPLAY_FINISHED',
  'DEV_FIXTURE_INJECTED',
  'PERMISSION_DENIED', 'RATE_LIMITED', 'SCHEMA_REJECTED',
] as const);
export interface EventV1 {
  readonly schema: typeof AI_NATIVE_EVENT_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly eventId: EventId;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly tick: Tick;
  readonly phase: number;
  readonly ordinal: number;
  readonly eventSeq: number;
  readonly actorId?: ActorId;
  readonly actionId?: ActionId;
  readonly correlationId?: RequestId;
  readonly type: EventTypeV1;
  readonly payload: Readonly<Record<string, string | number | boolean>>;
}
/** Strict reuse of the authoritative slice shape (type-only import). */
export type SlicePersistedStateV1 = PersistedSliceState;
export interface SnapshotV1 {
  readonly schema: typeof AI_NATIVE_SNAPSHOT_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly kernelVersion: typeof AI_NATIVE_KERNEL_VERSION_V1;
  readonly snapshotId: SnapshotId;
  readonly sessionId: SessionId;
  readonly sessionKind: SessionKindV1;
  readonly epoch: Epoch;
  readonly tick: Tick;
  readonly scenarioId: typeof AI_NATIVE_SCENARIO_ID_V1;
  readonly runStatus: 'active' | 'finished';
  readonly runEndReason: RunEndReasonV1;
  readonly createdAtMs: Ms;
  readonly state: SlicePersistedStateV1;
  readonly observationEvidence: readonly ObservationEvidenceV1[];
  readonly idempotencyCache: readonly {
    readonly actionId: ActionId;
    readonly actorId: ActorId;
    readonly payloadHash: string;
    readonly result: ActionResultV1;
  }[];
  readonly eventCursor: number;
  readonly rngState: null;
  readonly snapshotHash: string;
  readonly dev?: { readonly seed?: number; readonly fixtureLog?: readonly unknown[] };
}
export interface ReplayV1 {
  readonly schema: typeof AI_NATIVE_REPLAY_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly kernelVersion: typeof AI_NATIVE_KERNEL_VERSION_V1;
  readonly sessionId: SessionId;
  readonly sessionKind: SessionKindV1;
  readonly initialSnapshot: SnapshotV1;
  readonly actions: readonly ActionRequestV1[];
  readonly actionResults: readonly ActionResultV1[];
  readonly events: readonly EventV1[];
  readonly finalStateHash: string;
  readonly eventsHash: string;
  readonly resourceUsage: ResourceUsageV1;
  readonly dev?: { readonly seed?: number; readonly fixtureLog?: readonly unknown[] };
}
export type EnvelopeKindV1 = 'request' | 'response' | 'event';
export interface AiNativeEnvelopeV1 {
  readonly schema: typeof AI_NATIVE_ENVELOPE_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly transportSeq: ClientSeq;
  readonly kind: EnvelopeKindV1;
  readonly requestId?: RequestId;
  readonly correlationId?: RequestId | ActionId;
  readonly issuedAtMs: Ms;
  readonly payload: unknown;
}
export type RequestV1 =
  | CreateSessionRequestV1 | StepRequestV1 | ObserveRequestV1 | GetEventsRequestV1
  | SessionCommandV1 | CancelActionRequestV1 | ActionRequestV1 | SnapshotRequestV1
  | RestoreRequestV1 | ReplayRequestV1 | InspectStateRequestV1 | InjectFixtureRequestV1;
export interface ObserveRequestV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly requestId: RequestId;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly actorId: ActorId;
  readonly detail: 'summary' | 'standard' | 'debug';
}
export interface GetEventsRequestV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly requestId: RequestId;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly actorId: ActorId;
  readonly cursor: number;
  readonly limit: number;
}
export interface SnapshotRequestV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly requestId: RequestId;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly actorId: ActorId;
}
export interface RestoreRequestV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly requestId: RequestId;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly actorId: ActorId;
  readonly snapshot: SnapshotV1;
}
export interface ReplayRequestV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly requestId: RequestId;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly actorId: ActorId;
  readonly replay: ReplayV1;
}
export interface InspectStateRequestV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly requestId: RequestId;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly actorId: ActorId;
}
export interface InjectFixtureRequestV1 {
  readonly schema: typeof AI_NATIVE_DTO_SCHEMA_V1;
  readonly protocolVersion: ProtocolVersion;
  readonly requestId: RequestId;
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly actorId: ActorId;
  readonly fixtureId: string;
  readonly tick: Tick;
  readonly targetId?: TargetId;
}
/**
 * Public response union. SnapshotV1 / ReplayV1 are server-private storage
 * frames and MUST NOT be embedded in a public AiNativeEnvelopeV1 response;
 * they keep their own independent structural validators + authorizeRawFrame.
 */
export type ResponseV1 =
  | StepResultV1 | ObservationV1 | DebugInspectionV1 | ActionResultV1 | ErrorV1;

// ---------------------------------------------------------------------------
// 5. Validation engine (pure, closed schemas)
// ---------------------------------------------------------------------------

export interface AiNativeValidationIssue {
  readonly code: ErrorCodeV1;
  /** DTO-relative field path; never contains input values. */
  readonly path: string;
  readonly message: string;
}
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: AiNativeValidationIssue };

const HIDDEN_SET: ReadonlySet<string> = new Set(
  AI_NATIVE_HIDDEN_FIELD_NAMES_V1.map((name) => name.toLowerCase()),
);
const SCHEMA_SET: ReadonlySet<string> = new Set<string>(Object.values(AI_NATIVE_SCHEMA_V1));
const ERROR_CODE_SET: ReadonlySet<string> = new Set<string>(AI_NATIVE_ERROR_CODES_V1);
const POLLUTION_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Fixed, sanitized messages: no input values, stack, file path or internal state. */
export const AI_NATIVE_ERROR_MESSAGES_V1: Readonly<Record<ErrorCodeV1, string>> = Object.freeze({
  E_SCHEMA: 'DTO shape, field type or range is invalid.',
  E_VERSION_UNSUPPORTED: 'Protocol version or schema identifier is not supported.',
  E_PAYLOAD_TOO_LARGE: 'Request payload exceeds the byte limit.',
  E_SESSION_NOT_FOUND: 'Session does not exist.',
  E_SESSION_CLOSED: 'Session is closed.',
  E_STALE_EPOCH: 'Epoch does not match the active session.',
  E_STALE_GENERATION: 'Target instance generation is stale.',
  E_TARGET_DESTROYED: 'Target has been destroyed.',
  E_STALE_TICK: 'Tick is older than the authoritative tick.',
  E_FUTURE_TICK: 'Tick is in the future.',
  E_UNKNOWN_ACTOR: 'Actor is not registered in this session.',
  E_ID_PAYLOAD_MISMATCH: 'The same action id was reused with a different payload.',
  E_ACTION_EXPIRED: 'The request expired before entering the core.',
  E_PERMISSION: 'The actor is not permitted to perform this operation.',
  E_PAUSED: 'The session is paused.',
  E_NOT_APPLICABLE: 'This action is not implemented in the P0 Station Zero scenario.',
  E_ILLEGAL_TARGET: 'Target is not visible or not authorised.',
  E_LINK_UNAVAILABLE: 'The link is currently unavailable.',
  E_RETRYABLE: 'The operation is already in effect; retry with a new id.',
  E_ENERGY_INSUFFICIENT: 'Not enough energy.',
  E_COOLDOWN: 'The ability is cooling down.',
  E_RATE_LIMIT: 'Request rate limit exceeded.',
  E_RESOURCE_LIMIT: 'Resource limit exceeded.',
  E_CANCELLED: 'The action was cancelled.',
  E_PREEMPTED: 'The action was preempted by human takeover.',
  E_TIMEOUT: 'The action timed out.',
  E_SNAPSHOT_INVALID: 'The snapshot is invalid.',
  E_REPLAY_INCOMPATIBLE: 'The snapshot or replay is incompatible with this reader.',
  E_SAVE_FAILED: 'Persistence write failed.',
  E_INTERNAL_TRANSACTION: 'The atomic transaction failed; no state was committed.',
});

function issue(code: ErrorCodeV1, path: string): AiNativeValidationIssue {
  return Object.freeze({ code, path, message: AI_NATIVE_ERROR_MESSAGES_V1[code] });
}
function bad<T>(code: ErrorCodeV1, path: string): ValidationResult<T> {
  return Object.freeze({ ok: false as const, issue: issue(code, path) });
}
function good<T>(value: T): ValidationResult<T> {
  return Object.freeze({ ok: true as const, value });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

type Spec =
  | { readonly t: 'const'; readonly value: string | number | boolean | null }
  | { readonly t: 'enum'; readonly values: readonly string[] }
  | { readonly t: 'id'; readonly pattern: RegExp }
  | { readonly t: 'string'; readonly max?: number; readonly pattern?: RegExp }
  | { readonly t: 'number'; readonly min?: number; readonly max?: number; readonly int?: boolean }
  | { readonly t: 'bool' }
  | { readonly t: 'null' }
  | { readonly t: 'hash'; readonly prefix: 'sha256' | 'fnv1a32' }
  | { readonly t: 'code' }
  | { readonly t: 'resultCode' }
  | { readonly t: 'object'; readonly fields: Readonly<Record<string, Spec>>; readonly optional?: readonly string[] }
  | { readonly t: 'array'; readonly item: Spec; readonly max?: number }
  | { readonly t: 'record'; readonly keyPattern: RegExp; readonly value: Spec; readonly maxKeys?: number }
  | { readonly t: 'primitiveRecord'; readonly values?: readonly string[] }
  | { readonly t: 'json' }
  | { readonly t: 'scope'; readonly blacklist: boolean; readonly inner: Spec }
  | { readonly t: 'oneOf'; readonly variants: readonly Spec[] }
  | { readonly t: 'byKey'; readonly key: string; readonly variants: Readonly<Record<string, Spec>> }
  | { readonly t: 'custom'; readonly name: string; readonly check: (value: unknown, path: string, ctx: WalkContext) => AiNativeValidationIssue | null };

interface WalkContext {
  nodes: number;
  readonly seen: WeakSet<object>;
  blacklist: boolean;
  depth: number;
}

const C = (value: string | number | boolean | null): Spec => ({ t: 'const', value });
const ENUM = (values: readonly string[]): Spec => ({ t: 'enum', values });
const ID = (pattern: RegExp): Spec => ({ t: 'id', pattern });
const STR = (max = AI_NATIVE_LIMITS_V1.MAX_STRING_LENGTH, pattern?: RegExp): Spec =>
  ({ t: 'string', max, pattern });
const NUM = (min: number = 0, max: number = AI_NATIVE_LIMITS_V1.MAX_TICK, int: boolean = true): Spec =>
  ({ t: 'number', min, max, int });
const BOOL: Spec = { t: 'bool' };
const NULL: Spec = { t: 'null' };
const OBJ = (fields: Readonly<Record<string, Spec>>, optional: readonly string[] = []): Spec =>
  ({ t: 'object', fields, optional });
const ARR = (item: Spec, max: number = AI_NATIVE_LIMITS_V1.MAX_ARRAY_LENGTH): Spec =>
  ({ t: 'array', item, max });
const JSON_ONLY: Spec = { t: 'json' };
const PRIVATE = (inner: Spec): Spec => ({ t: 'scope', blacklist: false, inner });
const HASH = (prefix: 'sha256' | 'fnv1a32'): Spec => ({ t: 'hash', prefix });

function walkPureJson(value: unknown, path: string, ctx: WalkContext): AiNativeValidationIssue | null {
  ctx.nodes += 1;
  if (ctx.nodes > AI_NATIVE_LIMITS_V1.MAX_NODES || ctx.depth > AI_NATIVE_LIMITS_V1.MAX_DEPTH) {
    return issue('E_SCHEMA', path);
  }
  if (value === null) return null;
  const kind = typeof value;
  if (kind === 'undefined' || kind === 'symbol' || kind === 'bigint' || kind === 'function') {
    return issue('E_SCHEMA', path);
  }
  if (kind === 'number') return Number.isFinite(value) ? null : issue('E_SCHEMA', path);
  if (kind === 'boolean') return null;
  if (kind === 'string') {
    const text = value as string;
    return text.length <= AI_NATIVE_LIMITS_V1.MAX_STRING_LENGTH && !CONTROL_CHARS.test(text)
      ? null : issue('E_SCHEMA', path);
  }
  const object = value as object;
  if (ctx.seen.has(object)) return issue('E_SCHEMA', path);
  if (Array.isArray(object)) {
    if (object.length > AI_NATIVE_LIMITS_V1.WALK_MAX_ARRAY_LENGTH) return issue('E_SCHEMA', path);
    ctx.seen.add(object);
    ctx.depth += 1;
    for (let index = 0; index < object.length; index += 1) {
      const child = `${path}[${index}]`;
      if (!(index in object)) return issue('E_SCHEMA', child);
      const problem = walkPureJson(object[index], child, ctx);
      if (problem) return problem;
    }
    ctx.depth -= 1;
    ctx.seen.delete(object);
    return null;
  }
  if (!isPlainObject(object)) return issue('E_SCHEMA', path);
  const record = object as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.length > AI_NATIVE_LIMITS_V1.MAX_OBJECT_KEYS) return issue('E_SCHEMA', path);
  ctx.seen.add(object);
  ctx.depth += 1;
  for (const key of keys) {
    const child = `${path}.${String(key)}`;
    if (typeof key !== 'string') return issue('E_SCHEMA', child);
    if (POLLUTION_KEYS.has(key)) return issue('E_SCHEMA', child);
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !('value' in descriptor)) return issue('E_SCHEMA', child);
    const problem = walkPureJson(record[key], child, ctx);
    if (problem) return problem;
  }
  ctx.depth -= 1;
  ctx.seen.delete(object);
  return null;
}

function checkVersion(record: Record<string, unknown>, path: string, schema: string): AiNativeValidationIssue | null {
  if (!('schema' in record) || !('protocolVersion' in record)) return issue('E_SCHEMA', path);
  // Wrong TYPES are shape errors (§13.2); wrong VALUES are version mismatches (§1).
  if (typeof record.schema !== 'string' || typeof record.protocolVersion !== 'number' ||
      !Number.isFinite(record.protocolVersion)) {
    return issue('E_SCHEMA', `${path}.protocolVersion`);
  }
  if (record.protocolVersion !== AI_NATIVE_PROTOCOL_VERSION || record.schema !== schema) {
    return issue('E_VERSION_UNSUPPORTED', `${path}.protocolVersion`);
  }
  return null;
}

function validateSpec(value: unknown, spec: Spec, path: string, ctx: WalkContext): AiNativeValidationIssue | null {
  ctx.nodes += 1;
  if (ctx.nodes > AI_NATIVE_LIMITS_V1.MAX_NODES || ctx.depth > AI_NATIVE_LIMITS_V1.MAX_DEPTH) {
    return issue('E_SCHEMA', path);
  }
  switch (spec.t) {
    case 'const':
      return value === spec.value ? null : issue('E_SCHEMA', path);
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value) ? null : issue('E_SCHEMA', path);
    case 'id':
      return typeof value === 'string' && spec.pattern.test(value) ? null : issue('E_SCHEMA', path);
    case 'string':
      if (typeof value !== 'string' || value.length > (spec.max ?? AI_NATIVE_LIMITS_V1.MAX_STRING_LENGTH) ||
          CONTROL_CHARS.test(value) || (spec.pattern && !spec.pattern.test(value))) {
        return issue('E_SCHEMA', path);
      }
      return null;
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return issue('E_SCHEMA', path);
      if (spec.int && !Number.isSafeInteger(value)) return issue('E_SCHEMA', path);
      if (Object.is(value, -0) || value < (spec.min ?? 0) || value > (spec.max ?? AI_NATIVE_LIMITS_V1.MAX_TICK)) {
        return issue('E_SCHEMA', path);
      }
      return null;
    }
    case 'bool':
      return typeof value === 'boolean' ? null : issue('E_SCHEMA', path);
    case 'null':
      return value === null ? null : issue('E_SCHEMA', path);
    case 'hash': {
      const pattern = spec.prefix === 'sha256' ? SHA256_HASH : FNV_HASH;
      return typeof value === 'string' && pattern.test(value) ? null : issue('E_SCHEMA', path);
    }
    case 'code':
      return typeof value === 'string' && ERROR_CODE_SET.has(value) ? null : issue('E_SCHEMA', path);
    case 'resultCode':
      return typeof value === 'string' && (value === 'OK' || ERROR_CODE_SET.has(value))
        ? null : issue('E_SCHEMA', path);
    case 'json':
      return walkPureJson(value, path, ctx);
    case 'scope': {
      const saved = ctx.blacklist;
      ctx.blacklist = spec.blacklist;
      const problem = validateSpec(value, spec.inner, path, ctx);
      ctx.blacklist = saved;
      return problem;
    }
    case 'array': {
      if (!Array.isArray(value)) return issue('E_SCHEMA', path);
      if (value.length > (spec.max ?? AI_NATIVE_LIMITS_V1.MAX_ARRAY_LENGTH)) return issue('E_SCHEMA', path);
      ctx.depth += 1;
      for (let index = 0; index < value.length; index += 1) {
        const child = `${path}[${index}]`;
        if (!(index in value)) return issue('E_SCHEMA', child);
        const problem = validateSpec(value[index], spec.item, child, ctx);
        if (problem) return problem;
      }
      ctx.depth -= 1;
      return null;
    }
    case 'object':
    case 'primitiveRecord':
    case 'record': {
      if (!isPlainObject(value)) return issue('E_SCHEMA', path);
      const record = value as Record<string, unknown>;
      const keys = Reflect.ownKeys(record);
      if (keys.length > (spec.t === 'record'
        ? (spec.maxKeys ?? AI_NATIVE_LIMITS_V1.MAX_OBJECT_KEYS)
        : AI_NATIVE_LIMITS_V1.MAX_OBJECT_KEYS)) return issue('E_SCHEMA', path);
      const allowed = spec.t === 'object'
        ? new Set<string>([...Object.keys(spec.fields), ...(spec.optional ?? [])])
        : null;
      const required = spec.t === 'object'
        ? Object.keys(spec.fields).filter((key) => !(spec.optional ?? []).includes(key))
        : [];
      for (const key of keys) {
        const child = `${path}.${String(key)}`;
        if (typeof key !== 'string') return issue('E_SCHEMA', child);
        const lowered = key.toLowerCase();
        // Closed schemas already reject hidden names as unknown fields.
        // An explicit blacklist sweep is applied to public DTOs separately
        // (hasHiddenField), so Dev-private scopes stay legitimate.
        void lowered;
        if (POLLUTION_KEYS.has(key)) return issue('E_SCHEMA', child);
        if (allowed && !allowed.has(key)) return issue('E_SCHEMA', child);
        if (spec.t === 'record' && !spec.keyPattern.test(key)) return issue('E_SCHEMA', child);
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || !('value' in descriptor)) return issue('E_SCHEMA', child);
      }
      for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) return issue('E_SCHEMA', `${path}.${key}`);
      }
      ctx.depth += 1;
      for (const key of keys as string[]) {
        const child = `${path}.${key}`;
        if (spec.t === 'object') {
          if (!Object.prototype.hasOwnProperty.call(spec.fields, key)) continue;
          const problem = validateSpec(record[key], spec.fields[key], child, ctx);
          if (problem) return problem;
        } else if (spec.t === 'record') {
          const problem = validateSpec(record[key], spec.value, child, ctx);
          if (problem) return problem;
        } else {
          if (spec.values && !spec.values.includes(key)) return issue('E_SCHEMA', child);
          const item = record[key];
          if (item !== null && typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
            return issue('E_SCHEMA', child);
          }
          if (typeof item === 'number' && !Number.isFinite(item)) return issue('E_SCHEMA', child);
        }
      }
      ctx.depth -= 1;
      return null;
    }
    case 'oneOf': {
      let first: AiNativeValidationIssue | null = null;
      for (const variant of spec.variants) {
        const attempt: WalkContext = {
          nodes: ctx.nodes,
          seen: new WeakSet<object>(),
          blacklist: ctx.blacklist,
          depth: ctx.depth,
        };
        const problem = validateSpec(value, variant, path, attempt);
        if (!problem) {
          ctx.nodes = attempt.nodes;
          return null;
        }
        if (!first) first = problem;
      }
      return first ?? issue('E_SCHEMA', path);
    }
    case 'byKey': {
      if (!isPlainObject(value)) return issue('E_SCHEMA', path);
      const key = value[spec.key];
      if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(spec.variants, key)) {
        return issue('E_SCHEMA', `${path}.${spec.key}`);
      }
      return validateSpec(value, spec.variants[key], path, ctx);
    }
    case 'custom':
      return spec.check(value, path, ctx);
  }
}

function newContext(blacklist: boolean): WalkContext {
  return { nodes: 0, seen: new WeakSet<object>(), blacklist, depth: 0 };
}

/**
 * Explicit hidden-field terminal check for public DTOs (§5.3). Walks every key
 * at every depth, case-insensitively. `allowed` lists legitimate v1 keys that
 * collide with a blacklist word (e.g. ObservationV1.role).
 */
export function hasHiddenField(value: unknown, allowed: readonly string[] = []): string | null {
  const allow = new Set(allowed.map((name) => name.toLowerCase()));
  const seen = new WeakSet<object>();
  const scan = (current: unknown, path: string, depth: number): string | null => {
    if (current === null || typeof current !== 'object') return null;
    if (seen.has(current) || depth > AI_NATIVE_LIMITS_V1.MAX_DEPTH) return path;
    seen.add(current);
    for (const key of Reflect.ownKeys(current)) {
      const child = `${path}.${String(key)}`;
      if (typeof key !== 'string') return child;
      if ((HIDDEN_SET.has(key.toLowerCase()) && !allow.has(key.toLowerCase())) ||
          POLLUTION_KEYS.has(key)) return child;
      const nested = (current as Record<string, unknown>)[key];
      if (nested !== null && typeof nested === 'object') {
        const problem = scan(nested, child, depth + 1);
        if (problem) return problem;
      }
    }
    return null;
  };
  return scan(value, '$', 0);
}

function runSpec<T>(input: unknown, spec: Spec, versionCheck?: (record: Record<string, unknown>) => AiNativeValidationIssue | null): ValidationResult<T> {
  const ctx = newContext(true);
  const pure = walkPureJson(input, '$', newContext(false));
  if (pure) return bad<T>(pure.code, pure.path);
  if (versionCheck && isPlainObject(input)) {
    const problem = versionCheck(input);
    if (problem) return bad<T>(problem.code, problem.path);
  }
  const problem = validateSpec(input, spec, '$', ctx);
  if (problem) return bad<T>(problem.code, problem.path);
  return good(input as T);
}

// ---------------------------------------------------------------------------
// 6. Specs
// ---------------------------------------------------------------------------

const WXWY: Spec = OBJ({
  x: NUM(-AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, false),
  y: NUM(-AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, false),
});
const VERSION_FIELDS = (schema: string): Record<string, Spec> => ({
  schema: C(schema),
  protocolVersion: C(AI_NATIVE_PROTOCOL_VERSION),
});
const versionGuard = (schema: string) => (record: Record<string, unknown>) => checkVersion(record, '$', schema);

const SESSION_ID = ID(ID_PATTERNS.sessionId);
const ACTOR_ID = ID(ID_PATTERNS.actorId);
const ACTION_ID = ID(ID_PATTERNS.actionId);
const REQUEST_ID = ID(ID_PATTERNS.requestId);
const TARGET_ID = ID(ID_PATTERNS.targetId);
const EVIDENCE_ID = ID(ID_PATTERNS.evidenceId);
const EVENT_ID = ID(ID_PATTERNS.eventId);
const SNAPSHOT_ID = ID(ID_PATTERNS.snapshotId);
const EPOCH = NUM(0, 4_294_967_295);
const TICK = NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK);
const MS = NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK);
const ACTION_TYPE = ENUM(AI_NATIVE_ACTION_TYPES_V1);
const ROLE = ENUM(AI_NATIVE_ROLES_V1);
const DURATION_TICKS = NUM(1, AI_NATIVE_LIMITS_V1.MAX_ACTION_DURATION_TICKS);

const ACTOR_BINDING: Spec = OBJ({
  actorId: ACTOR_ID,
  role: ROLE,
  priority: NUM(0, 2),
  allowedActions: ARR(ACTION_TYPE),
  observationScope: ENUM(['self', 'shared']),
});

const RESOURCE_LIMIT_KEYS: readonly (keyof ResourceLimitsV1)[] = [
  'maxTicksPerStep', 'maxActionsPerTick', 'maxActiveIntentsPerActor',
  'maxActionDurationTicks', 'maxPayloadBytes', 'maxObservationEvents',
  'maxEventsPerPage', 'maxRequestsPerSecond', 'maxObservePerSecond',
  'maxStepTicksPerSecond', 'requestTimeoutMs', 'heartbeatMs', 'idleTimeoutMs',
  'maxSessionWallMs',
];
const RESOURCE_LIMITS: Spec = OBJ(Object.fromEntries(
  RESOURCE_LIMIT_KEYS.map((key) => [key, NUM(1, AI_NATIVE_LIMITS_V1.MAX_TICK)]),
) as Record<string, Spec>);

const ACTION_PAYLOAD_SPECS: Readonly<Record<ActionTypeV1, Spec>> = Object.freeze({
  move: OBJ({ type: C('move'), direction: WXWY, durationTicks: DURATION_TICKS }),
  aim: OBJ({ type: C('aim'), direction: WXWY }),
  fire: OBJ({ type: C('fire'), held: BOOL, durationTicks: DURATION_TICKS }),
  scan: OBJ({ type: C('scan') }),
  jam: OBJ({ type: C('jam'), targetId: TARGET_ID }),
  interact: OBJ({ type: C('interact'), targetId: TARGET_ID }),
  shoot_guard: OBJ({ type: C('shoot_guard'), targetId: TARGET_ID }),
  decoy: OBJ({ type: C('decoy'), position: WXWY }),
  wait: OBJ({ type: C('wait'), durationTicks: DURATION_TICKS }),
});

const ACTION_REQUEST_SHAPE: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  actionId: ACTION_ID,
  actorId: ACTOR_ID,
  sessionId: SESSION_ID,
  epoch: EPOCH,
  targetTick: TICK,
  type: ACTION_TYPE,
  payload: {
    t: 'custom',
    name: 'discriminatedPayload',
    check: (value, path, ctx) => {
      if (!isPlainObject(value)) return issue('E_SCHEMA', path);
      const type = value.type;
      if (typeof type !== 'string' || !isSupportedActionType(type)) {
        return issue('E_SCHEMA', `${path}.type`);
      }
      return validateSpec(value, ACTION_PAYLOAD_SPECS[type], path, ctx);
    },
  },
  clientSeq: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  issuedAtMs: MS,
  deadlineTick: TICK,
});

/** payload.type MUST equal outer type; deadlineTick >= targetTick (§4.2). */
const ACTION_REQUEST: Spec = {
  t: 'custom',
  name: 'actionRequest',
  check: (value, path, ctx) => {
    const problem = validateSpec(value, ACTION_REQUEST_SHAPE, path, ctx);
    if (problem) return problem;
    if (!isPlainObject(value)) return issue('E_SCHEMA', path);
    if (!isPlainObject(value.payload) || value.payload.type !== value.type) {
      return issue('E_SCHEMA', `${path}.payload.type`);
    }
    if (typeof value.targetTick === 'number' && typeof value.deadlineTick === 'number' &&
        value.deadlineTick < value.targetTick) {
      return issue('E_SCHEMA', `${path}.deadlineTick`);
    }
    return null;
  },
};

// Contract §5.4 (revised): ObservationEvidenceV1 carries schema + protocolVersion.
const OBSERVATION_EVIDENCE: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_OBSERVATION_SCHEMA_V1),
  evidenceId: EVIDENCE_ID,
  sceneEpoch: EPOCH,
  roomId: ENUM(AI_NATIVE_ROOM_IDS_V1),
  sourceActionId: ACTION_ID,
  source: C('player-scan'),
  observerActorId: ACTOR_ID,
  observerPosition: WXWY,
  targetId: TARGET_ID,
  relationId: STR(128, SAFE_TOKEN),
  observedAtTick: TICK,
  expiresAtTick: TICK,
  observedState: {
    t: 'primitiveRecord',
    values: Object.freeze([
      'stateLabel', 'signalPresent', 'suppressed', 'bridgePassable',
      'effectiveOutput', 'guardLink', 'discovered', 'linkVisible',
    ]),
  },
}, ['relationId']);

const ACTION_CAPABILITY: Spec = OBJ({
  type: ACTION_TYPE,
  status: ENUM(['available', 'unavailable', 'cooldown', 'insufficient_energy', 'permission_denied']),
  reasonCode: { t: 'code' },
  targetIds: ARR(TARGET_ID),
  maxDurationTicks: DURATION_TICKS,
}, ['reasonCode', 'targetIds', 'maxDurationTicks']);

const CURRENT_FACTS: Spec = OBJ({
  self: OBJ({
    position: WXWY,
    energy: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
    hp: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
    maxHp: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
    alive: BOOL, paused: BOOL, passed: BOOL, crossed: BOOL, failed: BOOL, completed: BOOL,
  }, ['hp', 'maxHp']),
  publicDeviceState: OBJ({
    door: ENUM(['SEALED', 'JAMMED_OPEN', 'OPEN', 'CLOSED', 'SAFE_PENDING_CLOSE']),
    doorPassable: BOOL,
    relay: ENUM(['ACTIVE', 'INACTIVE', 'JAMMED', 'DISABLED']),
    effectiveOutput: BOOL,
    bridge: ENUM(['UNAVAILABLE', 'TRANSITIONING', 'STABLE', 'UNSTABLE', 'DISABLED']),
    bridgePassable: BOOL,
    guardLink: ENUM(['DEAD', 'JAMMED', 'LINKED', 'DISCONNECTED']),
    guardHp: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
    canInteract: BOOL,
    onBridge: BOOL,
    lastShore: ENUM(['west', 'east']),
  }, ['relay', 'effectiveOutput', 'bridge', 'bridgePassable', 'guardLink', 'guardHp',
    'canInteract', 'onBridge', 'lastShore']),
  publicTimers: OBJ({
    scanCooldownTicks: TICK,
    jamCooldownTicks: TICK,
    scanRevealRemainingTicks: TICK,
    jamRemainingTicks: TICK,
    safeClearRemainingTicks: TICK,
    guardJamRemainingTicks: TICK,
    bridgeRemainingTicks: TICK,
  }, ['guardJamRemainingTicks', 'bridgeRemainingTicks']),
  visibleTargets: ARR(OBJ({
    targetId: TARGET_ID,
    kind: ENUM(['door', 'receiver', 'source', 'relay', 'bridge', 'guard', 'control']),
    publicState: STR(128, SAFE_TOKEN),
    position: WXWY,
    visibility: ENUM(['ordinary', 'scan-revealed', 'echo-shared']),
  }, ['position'])),
  knownConnections: ARR(OBJ({
    relationId: STR(128, SAFE_TOKEN),
    fromTargetId: TARGET_ID,
    toTargetId: TARGET_ID,
    stateLabel: STR(128, SAFE_TOKEN),
    evidenceId: EVIDENCE_ID,
  })),
});

const EVENT_PAYLOAD_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  lifecycle: Object.freeze(['status', 'reason', 'newEpoch']),
  actionResult: Object.freeze(['actionId', 'actorId', 'code', 'cost', 'resourceWritesThisCall']),
  actionCancel: Object.freeze(['actionId', 'actorId', 'reason', 'replayed']),
  evidence: Object.freeze(['evidenceId', 'targetId', 'observedAtTick', 'expiresAtTick', 'sourceActionId']),
  device: Object.freeze(['targetId', 'stateLabel', 'remainingTicks', 'code']),
  downstream: Object.freeze(['targetId', 'stateLabel', 'effectiveOutput', 'bridgePassable']),
  guard: Object.freeze(['targetId', 'hp', 'shore', 'cost']),
  run: Object.freeze(['reason', 'tick']),
  snapshot: Object.freeze(['snapshotId', 'epoch', 'stateHash', 'eventsHash']),
  devFixture: Object.freeze(['fixtureId', 'actorId', 'tick', 'targetId']),
  denial: Object.freeze(['code', 'requestId']),
});
export const AI_NATIVE_EVENT_GROUP_V1: Readonly<Record<string, string>> = Object.freeze({
  SESSION_CREATED: 'lifecycle', SESSION_PAUSED: 'lifecycle', SESSION_RESUMED: 'lifecycle',
  SESSION_RESET: 'lifecycle', SESSION_CLOSED: 'lifecycle',
  ACTION_ACCEPTED: 'actionResult', ACTION_REJECTED: 'actionResult', ACTION_COMPLETED: 'actionResult',
  ACTION_CANCELLED: 'actionCancel', ACTION_PREEMPTED: 'actionCancel',
  ACTION_TIMEOUT: 'actionCancel', ACTION_REPLAYED: 'actionCancel',
  SCAN_EVIDENCE_CREATED: 'evidence', SCAN_EVIDENCE_EXPIRED: 'evidence',
  JAM_APPLIED: 'device', JAM_EXPIRED: 'device', DOOR_STATE_CHANGED: 'device',
  RELAY_STATE_CHANGED: 'downstream', BRIDGE_STATE_CHANGED: 'downstream', GUARD_LINK_CHANGED: 'downstream',
  GUARD_HIT: 'guard', GUARD_CLEARED: 'guard', PLAYER_RESCUED: 'guard', PLAYER_DAMAGED: 'guard',
  ROOM_ENTERED: 'downstream', DOOR_PASSED: 'device', EAST_CROSSED: 'downstream',
  RUN_COMPLETED: 'run', RUN_FAILED: 'run',
  SNAPSHOT_SAVED: 'snapshot', SNAPSHOT_RESTORED: 'snapshot',
  REPLAY_STARTED: 'snapshot', REPLAY_FINISHED: 'snapshot',
  DEV_FIXTURE_INJECTED: 'devFixture',
  PERMISSION_DENIED: 'denial', RATE_LIMITED: 'denial', SCHEMA_REJECTED: 'denial',
});
export const AI_NATIVE_EVENT_PAYLOAD_KEYS_V1 = EVENT_PAYLOAD_KEYS;

const EVENT_SHAPE: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_EVENT_SCHEMA_V1),
  eventId: EVENT_ID,
  sessionId: SESSION_ID,
  epoch: EPOCH,
  tick: TICK,
  phase: NUM(0, 6),
  ordinal: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  eventSeq: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  actorId: ACTOR_ID,
  actionId: ACTION_ID,
  correlationId: REQUEST_ID,
  type: ENUM(AI_NATIVE_EVENT_TYPES_V1),
  payload: { t: 'primitiveRecord' },
}, ['actorId', 'actionId', 'correlationId']);

/** Event payload keys are whitelisted per event TYPE (§8 table). */
const EVENT: Spec = {
  t: 'custom',
  name: 'event',
  check: (value, path, ctx) => {
    const problem = validateSpec(value, EVENT_SHAPE, path, ctx);
    if (problem) return problem;
    if (!isPlainObject(value) || typeof value.type !== 'string') return issue('E_SCHEMA', path);
    const group = AI_NATIVE_EVENT_GROUP_V1[value.type];
    const keys = group ? EVENT_PAYLOAD_KEYS[group] : undefined;
    if (!keys || !isPlainObject(value.payload)) return issue('E_SCHEMA', `${path}.payload`);
    for (const key of Object.keys(value.payload)) {
      if (!keys.includes(key)) return issue('E_SCHEMA', `${path}.payload.${key}`);
    }
    return null;
  },
};

const OBSERVATION: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_OBSERVATION_SCHEMA_V1),
  sessionId: SESSION_ID,
  epoch: EPOCH,
  tick: TICK,
  actorId: ACTOR_ID,
  role: ROLE,
  detail: ENUM(['summary', 'standard']),
  roomId: ENUM(AI_NATIVE_ROOM_IDS_V1),
  current: CURRENT_FACTS,
  evidence: ARR(OBSERVATION_EVIDENCE),
  knowledge: ARR(JSON_ONLY, 0),
  hypotheses: ARR(JSON_ONLY, 0),
  events: ARR(EVENT, AI_NATIVE_LIMITS_V1.MAX_OBSERVATION_EVENTS),
  availableActions: ARR(ACTION_CAPABILITY),
  omittedFieldCount: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
});

const DEBUG_INSPECTION: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DEBUG_SCHEMA_V1),
  sessionId: SESSION_ID,
  epoch: EPOCH,
  tick: TICK,
  actorId: ACTOR_ID,
  role: C('DEVELOPER'),
  fullState: PRIVATE(JSON_ONLY),
  seed: NUM(0, 4_294_967_295, false),
  rngState: { t: 'oneOf', variants: [NULL, NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK)] },
  fixtureLog: PRIVATE(ARR(JSON_ONLY)),
  rawEvents: ARR(EVENT),
  hiddenMap: PRIVATE(JSON_ONLY),
}, ['seed', 'rngState', 'hiddenMap']);

const ACTION_RESULT: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  sessionId: SESSION_ID,
  epoch: EPOCH,
  tick: TICK,
  actionId: ACTION_ID,
  actorId: ACTOR_ID,
  status: ENUM(AI_NATIVE_ACTION_STATUSES_V1),
  code: { t: 'resultCode' },
  cost: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
  resourceWritesThisCall: NUM(0, 1),
  replayed: BOOL,
  durationRemainingTicks: TICK,
  correlationId: REQUEST_ID,
  messageKey: STR(128, SAFE_TOKEN),
}, ['durationRemainingTicks', 'correlationId', 'messageKey']);

const RESOURCE_USAGE: Spec = OBJ({
  wallMs: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
  ticksAdvanced: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  eventsEmitted: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  peakActionsPerTick: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  droppedEvents: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  truncatedObservation: BOOL,
});

/** Strict shape of the existing PersistedSliceState (no gameplay logic copied). */
const SLICE_STATE: Spec = PRIVATE(OBJ({
  schema: C('last_signal_station_zero_vs00_v1'),
  version: C(1),
  roomId: C('station-zero-r1'),
  energy: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
  tick: TICK,
  doorState: ENUM(['SEALED', 'JAMMED_OPEN', 'OPEN', 'CLOSED', 'SAFE_PENDING_CLOSE']),
  manualOpenIntent: BOOL,
  sealSourcePresent: BOOL,
  passed: BOOL,
  position: OBJ({
    x: NUM(-AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, false),
    y: NUM(-AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, false),
  }),
  corridor: OBJ({
    template: JSON_ONLY,
    position: OBJ({
      x: NUM(-AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, false),
      y: NUM(-AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, false),
    }),
    hp: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
    relayEnabled: BOOL,
    powered: BOOL,
    bridge: ENUM(['STABLE', 'UNAVAILABLE']),
    guardCleared: C(true),
    crossed: BOOL,
    jamRemaining: TICK,
    scanRemaining: TICK,
    reveal: { t: 'oneOf', variants: [NULL, OBJ({ relay: BOOL, bridge: BOOL, perceptionPort: BOOL })] },
  }),
  remaining: OBJ({
    jam: TICK, jamCooldown: TICK, scanCooldown: TICK,
    scanReveal: TICK, safeClear: TICK, regenAcc: TICK,
  }),
}, ['corridor']));

const SNAPSHOT_DEV: Spec = OBJ({
  seed: NUM(0, 4_294_967_295, false),
  fixtureLog: PRIVATE(ARR(JSON_ONLY)),
}, ['seed', 'fixtureLog']);

const SNAPSHOT: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_SNAPSHOT_SCHEMA_V1),
  kernelVersion: C(AI_NATIVE_KERNEL_VERSION_V1),
  snapshotId: SNAPSHOT_ID,
  sessionId: SESSION_ID,
  sessionKind: ENUM(AI_NATIVE_SESSION_KINDS_V1),
  epoch: EPOCH,
  tick: TICK,
  scenarioId: C(AI_NATIVE_SCENARIO_ID_V1),
  runStatus: ENUM(['active', 'finished']),
  runEndReason: { t: 'oneOf', variants: [NULL, ENUM(AI_NATIVE_RUN_END_REASONS_V1)] },
  createdAtMs: MS,
  state: SLICE_STATE,
  observationEvidence: ARR(OBSERVATION_EVIDENCE),
  idempotencyCache: ARR(OBJ({
    actionId: ACTION_ID,
    actorId: ACTOR_ID,
    payloadHash: HASH('fnv1a32'),
    result: ACTION_RESULT,
  })),
  eventCursor: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  rngState: NULL,
  snapshotHash: HASH('sha256'),
  dev: SNAPSHOT_DEV,
}, ['dev']);

const REPLAY: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_REPLAY_SCHEMA_V1),
  kernelVersion: C(AI_NATIVE_KERNEL_VERSION_V1),
  sessionId: SESSION_ID,
  sessionKind: ENUM(AI_NATIVE_SESSION_KINDS_V1),
  initialSnapshot: SNAPSHOT,
  actions: ARR(ACTION_REQUEST, AI_NATIVE_LIMITS_V1.MAX_REPLAY_ACTIONS),
  actionResults: ARR(ACTION_RESULT, AI_NATIVE_LIMITS_V1.MAX_REPLAY_ACTIONS),
  events: ARR(EVENT, AI_NATIVE_LIMITS_V1.MAX_EVENT_LOG_EVENTS),
  finalStateHash: HASH('sha256'),
  eventsHash: HASH('sha256'),
  resourceUsage: RESOURCE_USAGE,
  dev: SNAPSHOT_DEV,
}, ['dev']);

const STEP_RESULT: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  sessionId: SESSION_ID,
  epoch: EPOCH,
  fromTick: TICK,
  toTick: TICK,
  status: ENUM(AI_NATIVE_STEP_STATUSES_V1),
  actionResults: ARR(ACTION_RESULT, AI_NATIVE_LIMITS_V1.MAX_ACTIONS_PER_TICK),
  events: ARR(EVENT, AI_NATIVE_LIMITS_V1.MAX_OBSERVATION_EVENTS),
  eventCursor: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  observation: OBSERVATION,
  postStateHash: HASH('sha256'),
  resourceUsage: RESOURCE_USAGE,
}, ['observation']);

const ERROR: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  sessionId: SESSION_ID,
  epoch: EPOCH,
  tick: TICK,
  requestId: REQUEST_ID,
  correlationId: { t: 'oneOf', variants: [REQUEST_ID, ACTION_ID] },
  code: { t: 'code' },
  messageKey: STR(128, SAFE_TOKEN),
  retryable: BOOL,
}, ['sessionId', 'epoch', 'tick', 'requestId', 'correlationId']);

const CREATE_SESSION_REQUEST: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  requestId: REQUEST_ID,
  kind: ENUM(AI_NATIVE_SESSION_KINDS_V1),
  mode: ENUM(AI_NATIVE_MODES_V1),
  scenarioId: C(AI_NATIVE_SCENARIO_ID_V1),
  actorSpecs: ARR(OBJ({
    role: ROLE,
    observationScope: ENUM(['self', 'shared']),
    allowedActions: ARR(ACTION_TYPE),
  })),
  seed: NUM(0, 4_294_967_295, false),
  fixtureRef: STR(128, SAFE_TOKEN),
  resourceLimits: {
    t: 'custom',
    name: 'tightenOnlyResourceLimits',
    check: (value, path, ctx) => {
      const problem = validateSpec(value, {
        t: 'record', keyPattern: /^[a-z][A-Za-z]+$/, value: NUM(1, AI_NATIVE_LIMITS_V1.MAX_TICK),
      }, path, ctx);
      if (problem) return problem;
      if (!isPlainObject(value)) return issue('E_SCHEMA', path);
      const candidates: Readonly<Record<string, number>> = {
        maxTicksPerStep: AI_NATIVE_LIMITS_V1.MAX_TICKS_PER_STEP,
        maxActionsPerTick: AI_NATIVE_LIMITS_V1.MAX_ACTIONS_PER_TICK,
        maxActiveIntentsPerActor: AI_NATIVE_LIMITS_V1.MAX_ACTIVE_INTENTS_PER_ACTOR,
        maxActionDurationTicks: AI_NATIVE_LIMITS_V1.MAX_ACTION_DURATION_TICKS,
        maxPayloadBytes: AI_NATIVE_LIMITS_V1.MAX_PAYLOAD_BYTES,
        maxObservationEvents: AI_NATIVE_LIMITS_V1.MAX_OBSERVATION_EVENTS,
        maxEventsPerPage: AI_NATIVE_LIMITS_V1.MAX_EVENTS_PER_PAGE,
        maxRequestsPerSecond: AI_NATIVE_LIMITS_V1.MAX_REQUESTS_PER_SECOND,
        maxObservePerSecond: AI_NATIVE_LIMITS_V1.MAX_OBSERVE_PER_SECOND,
        maxStepTicksPerSecond: AI_NATIVE_LIMITS_V1.MAX_STEP_TICKS_PER_SECOND,
        requestTimeoutMs: AI_NATIVE_LIMITS_V1.REQUEST_TIMEOUT_MS,
        heartbeatMs: AI_NATIVE_LIMITS_V1.HEARTBEAT_MS,
        idleTimeoutMs: AI_NATIVE_LIMITS_V1.IDLE_TIMEOUT_MS,
        maxSessionWallMs: AI_NATIVE_LIMITS_V1.MAX_SESSION_WALL_MS,
      };
      for (const key of Object.keys(value)) {
        const hard = candidates[key];
        const actual = value[key];
        if (hard === undefined || typeof actual !== 'number' || actual > hard) {
          return issue('E_SCHEMA', `${path}.${key}`);
        }
      }
      return null;
    },
  },
}, ['seed', 'fixtureRef', 'resourceLimits']);

const STEP_REQUEST: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  requestId: REQUEST_ID,
  sessionId: SESSION_ID,
  epoch: EPOCH,
  fromTick: TICK,
  ticks: NUM(1, AI_NATIVE_LIMITS_V1.MAX_TICKS_PER_STEP),
  actions: ARR(ACTION_REQUEST, AI_NATIVE_LIMITS_V1.MAX_ACTIONS_PER_TICK),
  includeObservation: BOOL,
  observationDetail: ENUM(['summary', 'standard']),
}, ['observationDetail']);

const SESSION_COMMAND: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  requestId: REQUEST_ID,
  sessionId: SESSION_ID,
  epoch: EPOCH,
  actorId: ACTOR_ID,
  command: ENUM([...AI_NATIVE_SESSION_COMMANDS_V1, 'observe', 'get_events', 'cancel_action', 'step']),
});
const CANCEL_ACTION_REQUEST: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  requestId: REQUEST_ID,
  sessionId: SESSION_ID,
  epoch: EPOCH,
  actorId: ACTOR_ID,
  actionId: ACTION_ID,
  reason: ENUM(['client_cancel', 'human_takeover', 'timeout', 'session_close']),
});
const OBSERVE_REQUEST: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  requestId: REQUEST_ID, sessionId: SESSION_ID, epoch: EPOCH, actorId: ACTOR_ID,
  detail: ENUM(['summary', 'standard', 'debug']),
});
const GET_EVENTS_REQUEST: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  requestId: REQUEST_ID, sessionId: SESSION_ID, epoch: EPOCH, actorId: ACTOR_ID,
  cursor: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  limit: NUM(1, AI_NATIVE_LIMITS_V1.MAX_EVENTS_PER_PAGE),
});
const SIMPLE_REQUEST: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  requestId: REQUEST_ID, sessionId: SESSION_ID, epoch: EPOCH, actorId: ACTOR_ID,
});
const RESTORE_REQUEST: Spec = OBJ({
  ...SIMPLE_REQUEST_FIELDS(),
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  snapshot: SNAPSHOT,
});
function SIMPLE_REQUEST_FIELDS(): Record<string, Spec> {
  return { requestId: REQUEST_ID, sessionId: SESSION_ID, epoch: EPOCH, actorId: ACTOR_ID };
}
const REPLAY_REQUEST: Spec = OBJ({
  ...SIMPLE_REQUEST_FIELDS(),
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  replay: REPLAY,
});
const INJECT_FIXTURE_REQUEST: Spec = OBJ({
  ...SIMPLE_REQUEST_FIELDS(),
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  fixtureId: STR(128, SAFE_TOKEN),
  tick: TICK,
  targetId: TARGET_ID,
}, ['targetId']);

const REQUEST_UNION: Spec = {
  t: 'oneOf',
  variants: Object.freeze([
    ACTION_REQUEST, STEP_REQUEST, CREATE_SESSION_REQUEST, SESSION_COMMAND,
    CANCEL_ACTION_REQUEST, OBSERVE_REQUEST, GET_EVENTS_REQUEST, SIMPLE_REQUEST,
    RESTORE_REQUEST, REPLAY_REQUEST, INJECT_FIXTURE_REQUEST,
  ]),
};
const RESPONSE_UNION: Spec = {
  t: 'oneOf',
  variants: Object.freeze([STEP_RESULT, OBSERVATION, DEBUG_INSPECTION, ACTION_RESULT, ERROR]),
};
const ENVELOPE: Spec = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_ENVELOPE_SCHEMA_V1),
  sessionId: SESSION_ID,
  epoch: EPOCH,
  transportSeq: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  kind: ENUM(['request', 'response', 'event']),
  requestId: REQUEST_ID,
  correlationId: { t: 'oneOf', variants: [REQUEST_ID, ACTION_ID] },
  issuedAtMs: MS,
  payload: { t: 'oneOf', variants: Object.freeze([REQUEST_UNION, RESPONSE_UNION, EVENT]) },
}, ['requestId', 'correlationId']);

// ---------------------------------------------------------------------------
// 7. Detailed validators (with error codes) + fixed-name type guards (§3)
// ---------------------------------------------------------------------------

/** Cross-field checks that a pure Spec tree cannot express. */
function actionRequestExtras(record: Record<string, unknown>): AiNativeValidationIssue | null {
  if (!isPlainObject(record.payload)) return issue('E_SCHEMA', '$.payload');
  if (record.payload.type !== record.type) return issue('E_SCHEMA', '$.payload.type');
  if (typeof record.targetTick === 'number' && typeof record.deadlineTick === 'number' &&
      record.deadlineTick < record.targetTick) {
    return issue('E_SCHEMA', '$.deadlineTick');
  }
  return null;
}
function stepRequestExtras(record: Record<string, unknown>): AiNativeValidationIssue | null {
  if (!Array.isArray(record.actions)) return issue('E_SCHEMA', '$.actions');
  const fromTick = record.fromTick;
  if (typeof fromTick !== 'number') return issue('E_SCHEMA', '$.fromTick');
  for (let index = 0; index < record.actions.length; index += 1) {
    const action = record.actions[index];
    const targetTick = isPlainObject(action) ? action.targetTick : undefined;
    if (typeof targetTick !== 'number' || !Number.isSafeInteger(targetTick)) {
      return issue('E_SCHEMA', `$.actions[${index}].targetTick`);
    }
    if (targetTick < fromTick + 1) return issue('E_STALE_TICK', `$.actions[${index}].targetTick`);
    if (targetTick > fromTick + 1) return issue('E_FUTURE_TICK', `$.actions[${index}].targetTick`);
  }
  return null;
}
function observationExtras(record: Record<string, unknown>): AiNativeValidationIssue | null {
  const evidence = record.evidence;
  if (Array.isArray(evidence)) {
    for (let index = 0; index < evidence.length; index += 1) {
      const item = evidence[index];
      if (!isPlainObject(item)) return issue('E_SCHEMA', `$.evidence[${index}]`);
      if (typeof item.observedAtTick === 'number' && typeof item.expiresAtTick === 'number' &&
          item.observedAtTick >= item.expiresAtTick) {
        return issue('E_SCHEMA', `$.evidence[${index}].expiresAtTick`);
      }
    }
  }
  return null;
}
function eventExtras(record: Record<string, unknown>): AiNativeValidationIssue | null {
  const type = record.type;
  if (typeof type !== 'string') return issue('E_SCHEMA', '$.type');
  const group = AI_NATIVE_EVENT_GROUP_V1[type];
  const keys = group ? EVENT_PAYLOAD_KEYS[group] : undefined;
  if (!keys || !isPlainObject(record.payload)) return issue('E_SCHEMA', '$.payload');
  for (const key of Object.keys(record.payload)) {
    if (!keys.includes(key)) return issue('E_SCHEMA', `$.payload.${key}`);
  }
  return null;
}
function snapshotExtras(record: Record<string, unknown>): AiNativeValidationIssue | null {
  if (record.runStatus === 'finished' && record.runEndReason === null) {
    return issue('E_SNAPSHOT_INVALID', '$.runEndReason');
  }
  return null;
}

function withExtras<T>(
  input: unknown,
  spec: Spec,
  schema: string,
  extras?: (record: Record<string, unknown>) => AiNativeValidationIssue | null,
): ValidationResult<T> {
  const result = runSpec<T>(input, spec, versionGuard(schema));
  if (!result.ok) return result;
  if (extras && isPlainObject(input)) {
    const problem = extras(input);
    if (problem) return bad<T>(problem.code, problem.path);
  }
  return result;
}

export function validateActionRequestDetailed(input: unknown): ValidationResult<ActionRequestV1> {
  return withExtras<ActionRequestV1>(input, ACTION_REQUEST, AI_NATIVE_DTO_SCHEMA_V1, actionRequestExtras);
}
export function validateStepRequestDetailed(input: unknown): ValidationResult<StepRequestV1> {
  return withExtras<StepRequestV1>(input, STEP_REQUEST, AI_NATIVE_DTO_SCHEMA_V1, stepRequestExtras);
}
export function validateObservationDetailed(input: unknown): ValidationResult<ObservationV1> {
  // Player/Companion detail:"debug" is a permission error, not a shape error (§5.5).
  if (isPlainObject(input) && input.detail === 'debug') {
    return bad<ObservationV1>('E_PERMISSION', '$.detail');
  }
  const result = withExtras<ObservationV1>(input, OBSERVATION, AI_NATIVE_OBSERVATION_SCHEMA_V1, observationExtras);
  if (!result.ok) return result;
  const hidden = hasHiddenField(input, ['role']);
  if (hidden) return bad<ObservationV1>('E_SCHEMA', hidden);
  return result;
}
export function validateEventDetailed(input: unknown): ValidationResult<EventV1> {
  const result = withExtras<EventV1>(input, EVENT, AI_NATIVE_EVENT_SCHEMA_V1, eventExtras);
  if (!result.ok) return result;
  const hidden = hasHiddenField(input);
  if (hidden) return bad<EventV1>('E_SCHEMA', hidden);
  return result;
}
export function validateSnapshotDetailed(input: unknown): ValidationResult<SnapshotV1> {
  // Structural validation only: internal production snapshots are legitimate
  // private storage frames. External delivery is gated by authorizeRawFrame.
  return withExtras<SnapshotV1>(input, SNAPSHOT, AI_NATIVE_SNAPSHOT_SCHEMA_V1, snapshotExtras);
}
export function validateReplayDetailed(input: unknown): ValidationResult<ReplayV1> {
  const result = withExtras<ReplayV1>(input, REPLAY, AI_NATIVE_REPLAY_SCHEMA_V1);
  if (!result.ok) return result;
  if (isPlainObject(input)) {
    // Structural hidden-field sweep only; NOT an audience/authorization check.
    for (let index = 0; index < (result.value.events as readonly unknown[]).length; index += 1) {
      const hidden = hasHiddenField(result.value.events[index]);
      if (hidden) return bad<ReplayV1>('E_SCHEMA', `$.events[${index}]${hidden.slice(1)}`);
    }
  }
  return result;
}
export function validateDebugInspectionDetailed(input: unknown): ValidationResult<DebugInspectionV1> {
  return withExtras<DebugInspectionV1>(input, DEBUG_INSPECTION, AI_NATIVE_DEBUG_SCHEMA_V1);
}
function envelopeExtras(record: Record<string, unknown>): AiNativeValidationIssue | null {
  const payload = record.payload;
  const kind = record.kind;
  if (kind === 'request') return validateRequestDetailed(payload).ok ? null : issue('E_SCHEMA', '$.payload');
  if (kind === 'response') {
    const responses: ReadonlyArray<() => ValidationResult<unknown>> = [
      () => validateStepResultDetailed(payload),
      () => validateObservationDetailed(payload),
      () => validateDebugInspectionDetailed(payload),
      () => validateActionResultDetailed(payload),
      () => validateErrorDetailed(payload),
    ];
    for (const check of responses) {
      if (check().ok) return null;
    }
    return issue('E_SCHEMA', '$.payload');
  }
  if (kind === 'event') {
    return validateEventDetailed(payload).ok ? null : issue('E_SCHEMA', '$.payload');
  }
  return issue('E_SCHEMA', '$.kind');
}

export function validateEnvelopeDetailed(input: unknown): ValidationResult<AiNativeEnvelopeV1> {
  return withExtras<AiNativeEnvelopeV1>(input, ENVELOPE, AI_NATIVE_ENVELOPE_SCHEMA_V1, envelopeExtras);
}
export function validateRequestDetailed(input: unknown): ValidationResult<RequestV1> {
  return withExtras<RequestV1>(input, REQUEST_UNION, AI_NATIVE_DTO_SCHEMA_V1);
}
export function validateSessionDescriptorDetailed(input: unknown): ValidationResult<SessionDescriptorV1> {
  const spec: Spec = OBJ({
    ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
    sessionId: SESSION_ID,
    kind: ENUM(AI_NATIVE_SESSION_KINDS_V1),
    mode: ENUM(AI_NATIVE_MODES_V1),
    status: ENUM(AI_NATIVE_SESSION_STATUSES_V1),
    epoch: EPOCH,
    tick: TICK,
    scenarioId: C(AI_NATIVE_SCENARIO_ID_V1),
    kernelVersion: C(AI_NATIVE_KERNEL_VERSION_V1),
    runId: STR(128, SAFE_TOKEN),
    runEndReason: { t: 'oneOf', variants: [NULL, ENUM(AI_NATIVE_RUN_END_REASONS_V1)] },
    actorRegistry: { t: 'record', keyPattern: ID_PATTERNS.actorId, value: ACTOR_BINDING },
    createdAtMs: MS,
    lastActivityMs: MS,
    expiresAtMs: MS,
    resourceLimits: RESOURCE_LIMITS,
  });
  return withExtras<SessionDescriptorV1>(input, spec, AI_NATIVE_DTO_SCHEMA_V1, (record) => {
    if (!isPlainObject(record.actorRegistry)) return issue('E_SCHEMA', '$.actorRegistry');
    for (const [actorId, binding] of Object.entries(record.actorRegistry)) {
      if (!isPlainObject(binding)) return issue('E_SCHEMA', `$.actorRegistry.${actorId}`);
      if (binding.actorId !== actorId) return issue('E_UNKNOWN_ACTOR', `$.actorRegistry.${actorId}.actorId`);
      const expected = binding.role === 'PLAYER' ? 0 : binding.role === 'COMPANION' ? 1 : 2;
      if (binding.priority !== expected) return issue('E_PERMISSION', `$.actorRegistry.${actorId}.priority`);
      if (record.kind === 'production' && binding.role === 'DEVELOPER') {
        return issue('E_PERMISSION', `$.actorRegistry.${actorId}.role`);
      }
      if (binding.role === 'COMPANION' && binding.observationScope !== 'shared') {
        return issue('E_PERMISSION', `$.actorRegistry.${actorId}.observationScope`);
      }
      if (binding.role === 'COMPANION' && Array.isArray(binding.allowedActions) && binding.allowedActions.length > 0) {
        return issue('E_PERMISSION', `$.actorRegistry.${actorId}.allowedActions`);
      }
    }
    return null;
  });
}
export function validateCreateSessionRequestDetailed(input: unknown): ValidationResult<CreateSessionRequestV1> {
  return withExtras<CreateSessionRequestV1>(input, CREATE_SESSION_REQUEST, AI_NATIVE_DTO_SCHEMA_V1, (record) => {
    if (record.kind === 'production' && ('seed' in record || 'fixtureRef' in record)) {
      return issue('E_PERMISSION', '$.seed');
    }
    if (Array.isArray(record.actorSpecs)) {
      for (let index = 0; index < record.actorSpecs.length; index += 1) {
        const item = record.actorSpecs[index];
        if (!isPlainObject(item)) return issue('E_SCHEMA', `$.actorSpecs[${index}]`);
        if (record.kind === 'production' && item.role === 'DEVELOPER') {
          return issue('E_PERMISSION', `$.actorSpecs[${index}].role`);
        }
        if (item.role === 'COMPANION' && item.observationScope !== 'shared') {
          return issue('E_PERMISSION', `$.actorSpecs[${index}].observationScope`);
        }
      }
    }
    return null;
  });
}
export function validateErrorDetailed(input: unknown): ValidationResult<ErrorV1> {
  const result = withExtras<ErrorV1>(input, ERROR, AI_NATIVE_DTO_SCHEMA_V1);
  if (!result.ok) return result;
  const hidden = hasHiddenField(input);
  if (hidden) return bad<ErrorV1>('E_SCHEMA', hidden);
  return result;
}
/** observe detail policy (§3.2 / §5.5); role comes from the immutable registry. */
export function validateObserveDetail(role: RoleV1, detail: string): ValidationResult<string> {
  if (detail === 'debug') {
    if (role !== 'DEVELOPER') return bad<string>('E_PERMISSION', '$.detail');
    return bad<string>('E_SCHEMA', '$.detail');
  }
  if (detail !== 'summary' && detail !== 'standard') return bad<string>('E_SCHEMA', '$.detail');
  return good(detail);
}
export function validateStepResultDetailed(input: unknown): ValidationResult<StepResultV1> {
  return withExtras<StepResultV1>(input, STEP_RESULT, AI_NATIVE_DTO_SCHEMA_V1);
}
export function validateActionResultDetailed(input: unknown): ValidationResult<ActionResultV1> {
  return withExtras<ActionResultV1>(input, ACTION_RESULT, AI_NATIVE_DTO_SCHEMA_V1, (record) =>
    record.status === 'completed' && record.code !== 'OK'
      ? issue('E_SCHEMA', '$.code')
      : null);
}
export function validateObservationEvidenceDetailed(input: unknown): ValidationResult<ObservationEvidenceV1> {
  return withExtras<ObservationEvidenceV1>(input, OBSERVATION_EVIDENCE, AI_NATIVE_OBSERVATION_SCHEMA_V1);
}

/** Fixed-name type guards required by protocol §3. */
export function validateEnvelope(input: unknown): input is AiNativeEnvelopeV1 {
  return validateEnvelopeDetailed(input).ok;
}
export function validateRequest(input: unknown): input is RequestV1 {
  return validateRequestDetailed(input).ok;
}
export function validateActionRequest(input: unknown): input is ActionRequestV1 {
  return validateActionRequestDetailed(input).ok;
}
export function validateObservation(input: unknown): input is ObservationV1 {
  return validateObservationDetailed(input).ok;
}
export function validateDebugInspection(input: unknown): input is DebugInspectionV1 {
  return validateDebugInspectionDetailed(input).ok;
}
export function validateSessionDescriptor(input: unknown): input is SessionDescriptorV1 {
  return validateSessionDescriptorDetailed(input).ok;
}
export function validateCreateSessionRequest(input: unknown): input is CreateSessionRequestV1 {
  return validateCreateSessionRequestDetailed(input).ok;
}
export function validateStepRequest(input: unknown): input is StepRequestV1 {
  return validateStepRequestDetailed(input).ok;
}
export function validateStepResult(input: unknown): input is StepResultV1 {
  return validateStepResultDetailed(input).ok;
}
export function validateEvent(input: unknown): input is EventV1 {
  return validateEventDetailed(input).ok;
}
export function validateSnapshot(input: unknown): input is SnapshotV1 {
  return validateSnapshotDetailed(input).ok;
}
export function validateReplay(input: unknown): input is ReplayV1 {
  return validateReplayDetailed(input).ok;
}

/** Acceptance of a bare `1` or an exact `{protocolVersion:1, schema:...}`. */
export function isCompatibleVersion(input: unknown): boolean {
  if (input === AI_NATIVE_PROTOCOL_VERSION) return true;
  if (!isPlainObject(input)) return false;
  return input.protocolVersion === AI_NATIVE_PROTOCOL_VERSION &&
    typeof input.schema === 'string' && SCHEMA_SET.has(input.schema);
}

// ---------------------------------------------------------------------------
// 8. canonicalJson / payloadFingerprint (protocol §2.2)
// ---------------------------------------------------------------------------

export class AiNativeProtocolError extends Error {
  readonly code: ErrorCodeV1;
  constructor(code: ErrorCodeV1, message: string) {
    super(message);
    this.name = 'AiNativeProtocolError';
    this.code = code;
    Object.freeze(this);
  }
}

function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let codePoint = text.charCodeAt(index);
    if (codePoint >= 0xD800 && codePoint <= 0xDBFF && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xDC00 && low <= 0xDFFF) {
        codePoint = 0x10000 + ((codePoint - 0xD800) << 10) + (low - 0xDC00);
        index += 1;
      }
    }
    if (codePoint <= 0x7F) bytes.push(codePoint);
    else if (codePoint <= 0x7FF) {
      bytes.push(0xC0 | (codePoint >> 6), 0x80 | (codePoint & 0x3F));
    } else if (codePoint <= 0xFFFF) {
      bytes.push(0xE0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3F), 0x80 | (codePoint & 0x3F));
    } else {
      bytes.push(
        0xF0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3F),
        0x80 | ((codePoint >> 6) & 0x3F), 0x80 | (codePoint & 0x3F),
      );
    }
  }
  return bytes;
}

/** Code-point-wise ascending comparison (unlike default UTF-16 code-unit sort). */
function compareByCodePoint(left: string, right: string): number {
  const a = Array.from(left, (char) => char.codePointAt(0) ?? 0);
  const b = Array.from(right, (char) => char.codePointAt(0) ?? 0);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function canonicalize(value: unknown, path: string, seen: WeakSet<object>): string {
  if (value === null) return 'null';
  const kind = typeof value;
  if (kind === 'undefined' || kind === 'symbol' || kind === 'bigint' || kind === 'function') {
    throw new AiNativeProtocolError('E_SCHEMA', `canonicalJson rejected ${kind} at ${path}`);
  }
  if (kind === 'number') {
    if (!Number.isFinite(value)) {
      throw new AiNativeProtocolError('E_SCHEMA', `canonicalJson rejected non-finite number at ${path}`);
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (kind === 'boolean') return value ? 'true' : 'false';
  if (kind === 'string') return JSON.stringify(value);
  const object = value as object;
  if (seen.has(object)) throw new AiNativeProtocolError('E_SCHEMA', `canonicalJson rejected cycle at ${path}`);
  if (Array.isArray(object)) {
    seen.add(object);
    const parts: string[] = [];
    for (let index = 0; index < object.length; index += 1) {
      if (!(index in object)) {
        throw new AiNativeProtocolError('E_SCHEMA', `canonicalJson rejected sparse array at ${path}[${index}]`);
      }
      parts.push(canonicalize(object[index], `${path}[${index}]`, seen));
    }
    seen.delete(object);
    return `[${parts.join(',')}]`;
  }
  if (!isPlainObject(object)) {
    throw new AiNativeProtocolError('E_SCHEMA', `canonicalJson rejected non-plain object at ${path}`);
  }
  const record = object as Record<string, unknown>;
  const keys = Reflect.ownKeys(record).filter((key): key is string => {
    if (typeof key !== 'string') {
      throw new AiNativeProtocolError('E_SCHEMA', `canonicalJson rejected symbol key at ${path}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !('value' in descriptor)) {
      throw new AiNativeProtocolError('E_SCHEMA', `canonicalJson rejected accessor at ${path}.${key}`);
    }
    return true;
  });
  keys.sort(compareByCodePoint); // Unicode code-point ascending (UTF-16 aware)
  seen.add(object);
  const body = keys.map((key) =>
    `${JSON.stringify(key)}:${canonicalize(record[key], `${path}.${key}`, seen)}`);
  seen.delete(object);
  return `{${body.join(',')}}`;
}

/** Deterministic canonical JSON: sorted keys, finite numbers, plain JSON only. */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, '$', new WeakSet<object>());
}

/** FNV-1a 32 over canonical UTF-8 bytes => "fnv1a32:" + 8 lowercase hex. */
export function payloadFingerprint(value: unknown): string {
  const text = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (const byte of utf8Bytes(text)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// 9. redactError (protocol §4.4, §5.3, §3)
// ---------------------------------------------------------------------------

const SAFE_MESSAGE_KEY = 'error.generic';
const FORBIDDEN_MESSAGE_FRAGMENTS = Object.freeze([
  'seed', 'rng', 'password', 'token', 'secret', 'credential', 'stack', 'path',
  'fixture', 'save', 'map', 'world', 'scene', 'phaser', 'internal', 'hitsset', 'hitset',
]);

/** Re-validate, strip unknowns and replace any unsafe messageKey. Never echoes values. */
export function redactError(error: ErrorV1): ErrorV1 {
  // Whitelist-strip FIRST: hidden/extra fields are dropped, never echoed.
  const raw = (isPlainObject(error) ? error : {}) as Record<string, unknown>;
  const stripped: Record<string, unknown> = {};
  for (const key of ['schema', 'protocolVersion', 'sessionId', 'epoch', 'tick', 'requestId',
    'correlationId', 'code', 'messageKey', 'retryable']) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) stripped[key] = raw[key];
  }
  const result = validateErrorDetailed(stripped);
  if (!result.ok) throw new AiNativeProtocolError(result.issue.code, result.issue.message);
  const record = stripped;
  const key = record.messageKey;
  const lowered = typeof key === 'string' ? key.toLowerCase() : '';
  const unsafe = typeof key !== 'string' ||
    FORBIDDEN_MESSAGE_FRAGMENTS.some((fragment) => lowered.includes(fragment)) ||
    HIDDEN_SET.has(lowered) || !SAFE_TOKEN.test(key);
  const sanitized: Record<string, unknown> = {
    schema: AI_NATIVE_DTO_SCHEMA_V1,
    protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
    code: record.code,
    messageKey: unsafe ? SAFE_MESSAGE_KEY : key,
    retryable: record.retryable,
  };
  for (const optional of ['sessionId', 'epoch', 'tick', 'requestId', 'correlationId']) {
    if (Object.prototype.hasOwnProperty.call(record, optional)) sanitized[optional] = record[optional];
  }
  // Final blacklist sweep on the emitted object (keys only, never values).
  const sweep = (value: unknown, seen: WeakSet<object>): boolean => {
    if (value === null || typeof value !== 'object') return true;
    if (seen.has(value)) return false;
    seen.add(value);
    for (const childKey of Reflect.ownKeys(value)) {
      if (typeof childKey !== 'string' || HIDDEN_SET.has(childKey.toLowerCase()) || POLLUTION_KEYS.has(childKey)) {
        return false;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, childKey);
      if (!descriptor || !('value' in descriptor)) return false;
      const child = (value as Record<string, unknown>)[childKey];
      if (child !== null && typeof child === 'object' && !sweep(child, seen)) return false;
    }
    return true;
  };
  if (!sweep(sanitized, new WeakSet<object>())) {
    throw new AiNativeProtocolError('E_SCHEMA', AI_NATIVE_ERROR_MESSAGES_V1.E_SCHEMA);
  }
  return Object.freeze(sanitized) as unknown as ErrorV1;
}

// ---------------------------------------------------------------------------
// 10. Pure policy / ordering helpers (validation only, no execution)
// ---------------------------------------------------------------------------

export function isSupportedActionType(value: unknown): value is ActionTypeV1 {
  return typeof value === 'string' && (AI_NATIVE_ACTION_TYPES_V1 as readonly string[]).includes(value);
}
export function isUnsupportedAction(value: unknown): value is UnsupportedActionV1 {
  return typeof value === 'string' &&
    (AI_NATIVE_UNSUPPORTED_ACTIONS_V1 as readonly string[]).includes(value);
}

export type RawFrameKindV1 = 'snapshot' | 'replay';

/**
 * Minimal PURE audience gate for private storage frames (SnapshotV1 / ReplayV1).
 * Structural validation is NOT authorization: a structurally valid production
 * frame is still private. Only DEVELOPER + kind:'test' may export raw frames;
 * PLAYER / COMPANION are always denied, including when the `dev` segment has
 * been stripped (contract §9: "不能删 dev 后给 Player"). The server-internal
 * restore path is deliberately NOT modelled here: P0 adds no public restore
 * credential. This function holds no state and delivers nothing.
 */
export function authorizeRawFrame(
  context: unknown,
  kind: RawFrameKindV1,
): ValidationResult<{ readonly role: RoleV1; readonly sessionKind: SessionKindV1; readonly kind: RawFrameKindV1 }> {
  if (!isPlainObject(context)) return bad('E_SCHEMA', '$.role');
  const role = context.role;
  const sessionKind = context.sessionKind;
  if (typeof role !== 'string' || !(AI_NATIVE_ROLES_V1 as readonly string[]).includes(role)) {
    return bad('E_SCHEMA', '$.role');
  }
  if (typeof sessionKind !== 'string' || !(AI_NATIVE_SESSION_KINDS_V1 as readonly string[]).includes(sessionKind)) {
    return bad('E_SCHEMA', '$.sessionKind');
  }
  if (kind !== 'snapshot' && kind !== 'replay') return bad('E_SCHEMA', '$.kind');
  if ('devSegmentRemoved' in context && typeof context.devSegmentRemoved !== 'boolean') {
    return bad('E_SCHEMA', '$.devSegmentRemoved');
  }
  if (role !== 'DEVELOPER' || sessionKind !== 'test') return bad('E_PERMISSION', '$.role');
  return good(Object.freeze({
    role: role as RoleV1,
    sessionKind: sessionKind as SessionKindV1,
    kind,
  }));
}

/** Stage 7 support gate: aim/fire/decoy are wire-valid but NOT implemented. */
export function validateActionSupport(type: unknown): ValidationResult<ActionTypeV1> {
  if (!isSupportedActionType(type)) return bad<ActionTypeV1>('E_SCHEMA', '$.type');
  if (isUnsupportedAction(type)) return bad<ActionTypeV1>('E_NOT_APPLICABLE', '$.type');
  return good(type);
}

/** Permission-model §1 / §3.2: pure check, no registry mutation. */
export function validateActionPermission(
  binding: ActorBindingV1,
  type: ActionTypeV1,
  sessionKind: SessionKindV1,
): ValidationResult<ActionTypeV1> {
  if (!isPlainObject(binding) || (sessionKind === 'production' && binding.role === 'DEVELOPER')) {
    return bad<ActionTypeV1>('E_PERMISSION', '$.actorRegistry.role');
  }
  if (binding.role === 'DEVELOPER') {
    return bad<ActionTypeV1>('E_PERMISSION', '$.actorRegistry.role');
  }
  if (binding.role === 'COMPANION') {
    return bad<ActionTypeV1>('E_PERMISSION', '$.allowedActions');
  }
  if (!binding.allowedActions.includes(type)) {
    return bad<ActionTypeV1>('E_PERMISSION', '$.type');
  }
  return validateActionSupport(type);
}

/** Stage 5: targetTick MUST be currentTick+1 (protocol §4.2 / §6.1). */
export function validateActionTargetTick(
  action: Pick<ActionRequestV1, 'targetTick'>,
  currentTick: number,
): ValidationResult<number> {
  if (!Number.isSafeInteger(currentTick) || currentTick < 0) return bad<number>('E_SCHEMA', '$.currentTick');
  if (action.targetTick < currentTick + 1) return bad<number>('E_STALE_TICK', '$.targetTick');
  if (action.targetTick > currentTick + 1) return bad<number>('E_FUTURE_TICK', '$.targetTick');
  return good(action.targetTick);
}

/** Protocol §6.1 validation pipeline stage names (Gateway owns execution). */
export const AI_NATIVE_VALIDATION_STAGES_V1 = Object.freeze([
  'payload', 'schema', 'session', 'epoch', 'actor', 'tick', 'permission',
  'support', 'target', 'state', 'energy', 'cooldown', 'resource', 'transaction',
] as const);
export type ValidationStageV1 = (typeof AI_NATIVE_VALIDATION_STAGES_V1)[number];
/** First-cause-only: returns the earliest staged issue, never aggregates. */
export function firstErrorByStage<T extends { stage: number; code: ErrorCodeV1 }>(issues: readonly T[]): T | null {
  let first: T | null = null;
  for (const candidate of issues) {
    if (!first || candidate.stage < first.stage) first = candidate;
  }
  return first;
}

/** §7 action total order: (targetTick, priority, actorId, actionId). */
export function compareActionOrder(
  a: Pick<ActionRequestV1, 'targetTick' | 'actorId' | 'actionId'>,
  b: Pick<ActionRequestV1, 'targetTick' | 'actorId' | 'actionId'>,
  priorityOf: (actorId: ActorId) => number,
): number {
  if (a.targetTick !== b.targetTick) return a.targetTick - b.targetTick;
  const priority = priorityOf(a.actorId) - priorityOf(b.actorId);
  if (priority !== 0) return priority;
  if (a.actorId !== b.actorId) return a.actorId < b.actorId ? -1 : 1;
  if (a.actionId === b.actionId) return 0;
  return a.actionId < b.actionId ? -1 : 1;
}

/** §8 event total order: (tick, phase, ordinal, actorId ?? '', eventId). */
export function compareEventOrder(a: EventV1, b: EventV1): number {
  if (a.tick !== b.tick) return a.tick - b.tick;
  if (a.phase !== b.phase) return a.phase - b.phase;
  if (a.ordinal !== b.ordinal) return a.ordinal - b.ordinal;
  const left = a.actorId ?? '';
  const right = b.actorId ?? '';
  if (left !== right) return left < right ? -1 : 1;
  if (a.eventId === b.eventId) return 0;
  return a.eventId < b.eventId ? -1 : 1;
}

/** §6.3 idempotency CHECK only — this module holds no cache / mutable state. */
export interface IdempotencyEntryV1 {
  readonly sessionId: SessionId;
  readonly epoch: Epoch;
  readonly actorId: ActorId;
  readonly actionId: ActionId;
  readonly payloadHash: string;
}
export function checkIdempotency(
  cached: IdempotencyEntryV1,
  request: IdempotencyEntryV1,
): ValidationResult<{ replayed: true }> {
  if (cached.sessionId !== request.sessionId || cached.epoch !== request.epoch) {
    return bad<{ replayed: true }>('E_STALE_EPOCH', '$.epoch');
  }
  if (cached.actorId !== request.actorId || cached.actionId !== request.actionId) {
    return bad<{ replayed: true }>('E_UNKNOWN_ACTOR', '$.actionId');
  }
  if (cached.payloadHash !== request.payloadHash) {
    return bad<{ replayed: true }>('E_ID_PAYLOAD_MISMATCH', '$.payloadHash');
  }
  return good({ replayed: true as const });
}

/** §11 single-request byte ceiling, computed over canonical JSON. */
export function validatePayloadSize(value: unknown, maxBytes = AI_NATIVE_LIMITS_V1.MAX_PAYLOAD_BYTES): ValidationResult<number> {
  const bytes = utf8Bytes(canonicalJson(value)).length;
  return bytes <= maxBytes ? good(bytes) : bad<number>('E_PAYLOAD_TOO_LARGE', '$');
}

/** R9 restore validation: no re-scan, no TTL extension, old saves clear evidence. */
export function validateRestoredEvidence(
  evidence: readonly ObservationEvidenceV1[],
  savedTick: number,
  sceneEpoch: number,
): ValidationResult<readonly ObservationEvidenceV1[]> {
  if (!Number.isSafeInteger(savedTick) || savedTick < 0) return bad('E_SNAPSHOT_INVALID', '$.tick');
  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index];
    const parsed = validateObservationEvidenceDetailed(item);
    if (!parsed.ok) return bad(parsed.issue.code, `$.observationEvidence[${index}]`);
    if (item.sceneEpoch !== sceneEpoch || item.observedAtTick > savedTick || savedTick >= item.expiresAtTick) {
      return bad('E_SNAPSHOT_INVALID', `$.observationEvidence[${index}]`);
    }
  }
  return good(Object.freeze(evidence.slice()));
}

/** §9.2: only an `active` snapshot may be restored; `finished(died)` is a new run. */
export function validateRestoreEligibility(snapshot: SnapshotV1): ValidationResult<SnapshotV1> {
  if (snapshot.runStatus !== 'active') {
    return bad<SnapshotV1>('E_SNAPSHOT_INVALID', '$.runStatus');
  }
  if (snapshot.runEndReason !== null) {
    return bad<SnapshotV1>('E_SNAPSHOT_INVALID', '$.runEndReason');
  }
  return good(snapshot);
}

/** §11 pagination guard; `droppedEvents` must be explicit when truncating. */
export function validateEventPage(cursor: number, limit: number): ValidationResult<{ cursor: number; limit: number }> {
  if (!Number.isSafeInteger(cursor) || cursor < 0) return bad('E_SCHEMA', '$.cursor');
  if (!Number.isSafeInteger(limit) || limit < 1) return bad('E_SCHEMA', '$.limit');
  if (limit > AI_NATIVE_LIMITS_V1.MAX_EVENTS_PER_PAGE) return bad('E_RESOURCE_LIMIT', '$.limit');
  return good(Object.freeze({ cursor, limit }));
}
export function truncateEventLog(count: number): { kept: number; droppedEvents: number } {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new AiNativeProtocolError('E_SCHEMA', AI_NATIVE_ERROR_MESSAGES_V1.E_SCHEMA);
  }
  const kept = Math.min(count, AI_NATIVE_LIMITS_V1.MAX_EVENT_LOG_EVENTS);
  return Object.freeze({ kept, droppedEvents: count - kept });
}

/** §10 terminal-state cancellation/timeout is idempotent, zero resource writes. */
export function validateCancelTerminal(status: ActionStatusV1): ValidationResult<{ idempotent: boolean; resourceWrites: 0 }> {
  const terminal: readonly ActionStatusV1[] = ['completed', 'rejected', 'timeout', 'cancelled', 'preempted'];
  if (!terminal.includes(status)) return bad('E_SCHEMA', '$.status');
  return good(Object.freeze({ idempotent: true, resourceWrites: 0 as const }));
}
export function validateActionDeadline(currentTick: number, deadlineTick: number): ValidationResult<number> {
  if (!Number.isSafeInteger(currentTick) || !Number.isSafeInteger(deadlineTick)) {
    return bad<number>('E_SCHEMA', '$.currentTick');
  }
  if (currentTick > deadlineTick) return bad<number>('E_TIMEOUT', '$.deadlineTick');
  return good(deadlineTick);
}

/** §9.3 replay compatibility: exact version/kernel/session/kind, no overwrite. */
export function validateReplayCompatibility(
  replay: ReplayV1,
  expected: { sessionId: SessionId; sessionKind: SessionKindV1 },
): ValidationResult<ReplayV1> {
  if (replay.protocolVersion !== AI_NATIVE_PROTOCOL_VERSION ||
      replay.kernelVersion !== AI_NATIVE_KERNEL_VERSION_V1 ||
      replay.sessionId !== expected.sessionId || replay.sessionKind !== expected.sessionKind ||
      replay.initialSnapshot.sessionId !== expected.sessionId ||
      replay.initialSnapshot.sessionKind !== expected.sessionKind ||
      replay.initialSnapshot.kernelVersion !== AI_NATIVE_KERNEL_VERSION_V1) {
    return bad<ReplayV1>('E_REPLAY_INCOMPATIBLE', '$.kernelVersion');
  }
  return good(replay);
}
