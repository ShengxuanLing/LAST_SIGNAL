/**
 * AI-NATIVE-01 / P2 — Observation / Action / Session Gateway (headless).
 *
 * Gateway layer over the P1 `HeadlessGame` (single authoritative engine). It is
 * allowed to use timers, `Date.now()` and `node:crypto` (process-edge concerns);
 * it never imports Phaser/DOM and never weakens a P0 closed schema.
 *
 * Trust model (resolved by the server, captured in closures):
 *  - `PlayerSessionHandle`  : the AI player. It can start/close its own session,
 *    send actions, observe, read events and cancel its own advanced action.
 *    It has NO pause/resume/reset and no snapshot/restore/replay/inspect.
 *  - `OwnerSessionHandle`   : a separate trusted human/Gateway capability for
 *    pause/resume/reset/close. It cannot be obtained from a Player handle.
 *  - `TestSessionHandle`    : Player + dev/test facet (snapshot/restore/replay/
 *    inspectState/injectFixture). It is not reachable from Player/Owner handles.
 *  - `CompanionSessionHandle`: independent binding, explicit E_NOT_APPLICABLE
 *    (no ECHO entity in P0); never aliases the player.
 *
 * StepRequest is parsed with the P0 closed-schema validator. `fromTick` must be
 * the authoritative tick, `targetTick` must be `fromTick + 1`, and each action's
 * `sessionId`/`epoch`/`actorId` is bound to this session.
 *
 * Request-level idempotency: the SAME requestId + fully identical request is a
 * network retry -> the original StepResult is returned with NO tick advance and
 * NO resource charge. A different payload under the same requestId is rejected.
 * Action-level idempotency: a repeated actionId (even under a new requestId)
 * never re-executes or re-charges; it returns the original receipt with
 * `replayed: true`. Same-batch duplicates are deduped and mapped by index.
 */
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { createGame, withHashes, type HeadlessGame, type RuntimeSnapshot, type InternalRuntimeState } from './runtime';
import {
  AI_NATIVE_PROTOCOL_VERSION, AI_NATIVE_DTO_SCHEMA_V1, AI_NATIVE_EVENT_SCHEMA_V1,
  AI_NATIVE_KERNEL_VERSION_V1, AI_NATIVE_SCENARIO_ID_V1, AI_NATIVE_LIMITS_V1,
  payloadFingerprint, hasHiddenField, validateStepRequestDetailed,
  validateObservationDetailed, validateStepResultDetailed,
  type ActionRequestV1, type StepRequestV1, type ObservationV1, type EventV1,
  type ActionResultV1, type StepResultV1, type ErrorV1, type ErrorCodeV1,
  type RoleV1, type SessionKindV1, type ActorId, type SessionId, type ActionId,
  type RequestId, type TargetId, type Epoch, type Tick, type ModeV1,
  type SessionStatusV1, type ActionTypeV1, type WxWyV1, type RunEndReasonV1,
  type ResourceLimitsV1, type SessionDescriptorV1, type StepResultCodeV1, type ActorBindingV1,
  AI_NATIVE_EVENT_GROUP_V1, AI_NATIVE_EVENT_PAYLOAD_KEYS_V1,
} from './protocol';

/** Hard budgets fixed by the Lead: at most 10 sessions / 2 concurrent steps. */
const HARD_MAX_SESSIONS = 10;
const HARD_MAX_CONCURRENT_STEPS = 2;
const BATCH_TICKS = 25; // small batches so cancellation can land between them
const MAX_IDEMPOTENCY_ENTRIES = 1024;
const MAX_REQUEST_CACHE = 256;
const MAX_CANCELLED_IDS = 256;
const ADVANCED_ID = /^aid_[0-9a-f]{24}$/;
const ACTION_FP_FIELDS = ['actorId', 'epoch', 'type', 'payload'] as const;

function hexChars(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}
function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}
function defaultSeed(): number {
  return randomInt(0, 0xffffffff) >>> 0;
}
function now(): number {
  return Date.now();
}
function isFiniteInt(value: unknown, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max;
}

export class SessionError extends Error {
  constructor(public readonly code: ErrorCodeV1, message: string, public readonly messageKey: string) {
    super(message);
    this.name = 'SessionError';
  }
}

function makeError(
  code: ErrorCodeV1,
  messageKey: string,
  opts: { sessionId?: SessionId; epoch?: Epoch; tick?: Tick; requestId?: RequestId; correlationId?: RequestId | ActionId } = {},
): ErrorV1 {
  return Object.freeze({
    schema: AI_NATIVE_DTO_SCHEMA_V1,
    protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    ...(opts.epoch !== undefined ? { epoch: opts.epoch } : {}),
    ...(opts.tick !== undefined ? { tick: opts.tick } : {}),
    ...(opts.requestId ? { requestId: opts.requestId } : {}),
    ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
    code,
    messageKey,
    retryable: code === 'E_RETRYABLE' || code === 'E_RATE_LIMIT',
  });
}

export interface SessionManagerOptions {
  maxSessions?: number;
  maxConcurrentSteps?: number;
  idleTimeoutMs?: number;
  maxSessionWallMs?: number;
  maxTicksPerStep?: number;
  maxActionsPerStep?: number;
  maxObservationEvents?: number;
  maxEventsPerPage?: number;
  maxSnapshotBytes?: number;
  maxActionDurationTicks?: number;
  clock?: () => number;
  seedProvider?: () => number;
  hasher?: (canonical: string) => string;
}

export interface ProductionSessionOptions {
  readonly resourceLimits?: Partial<ResourceLimitsV1>;
}
export interface TestSessionOptions {
  readonly seed: number;
  readonly resourceLimits?: Partial<ResourceLimitsV1>;
}
export interface CompanionSessionOptions {
  readonly resourceLimits?: Partial<ResourceLimitsV1>;
}

export interface PaginatedEvents {
  readonly events: readonly EventV1[];
  readonly nextCursor: number;
  readonly total: number;
  readonly truncated: boolean;
  readonly droppedEvents: number;
}

export type SessionResponse<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ErrorV1 };

export interface AdvancedActionOptions {
  readonly maxTicks?: number;
  readonly maxWallMs?: number;
  readonly signal?: AbortSignal;
  /** Caller-supplied legal aid_<24hex>; lets `cancelAction` hit before completion. */
  readonly actionId?: ActionId;
}
export interface WaitUntilOptions extends AdvancedActionOptions {
  readonly until?: 'passed' | 'crossed' | 'finished';
}
export interface AdvancedActionHandle extends Promise<SessionResponse<ActionResultV1>> {
  readonly actionId: ActionId;
  readonly result: Promise<SessionResponse<ActionResultV1>>;
}

/** The AI player: legal actions/observation/self-cancel, start/close own session. */
export interface PlayerSessionHandle {
  readonly sessionId: SessionId;
  readonly actorId: ActorId;
  readonly role: 'PLAYER';
  start(): SessionResponse<SessionDescriptorV1>;
  close(): SessionResponse<{ sessionId: SessionId }>;
  step(request: StepRequestV1): SessionResponse<StepResultV1>;
  observe(detail?: 'summary' | 'standard'): SessionResponse<ObservationV1>;
  getEvents(cursor: number, limit: number): SessionResponse<PaginatedEvents>;
  cancelAction(actionId: ActionId, reason?: 'client_cancel' | 'human_takeover' | 'timeout' | 'session_close'): SessionResponse<{ actionId: ActionId }>;
  moveTo(target: WxWyV1, opts?: AdvancedActionOptions): AdvancedActionHandle;
  approach(targetId: TargetId, opts?: AdvancedActionOptions): AdvancedActionHandle;
  scanTarget(opts?: AdvancedActionOptions): AdvancedActionHandle;
  interactWith(targetId: TargetId, opts?: AdvancedActionOptions): AdvancedActionHandle;
  waitUntil(opts?: WaitUntilOptions): AdvancedActionHandle;
}

/** Trusted human/Gateway lifecycle capability (NOT an AI actor). */
export interface OwnerSessionHandle {
  readonly sessionId: SessionId;
  readonly capability: 'OWNER';
  start(): SessionResponse<SessionDescriptorV1>;
  pause(): SessionResponse<SessionDescriptorV1>;
  resume(): SessionResponse<SessionDescriptorV1>;
  reset(): SessionResponse<SessionDescriptorV1>;
  close(): SessionResponse<{ sessionId: SessionId }>;
}

/** Player + dev/test facet. Not reachable from Player/Owner handles. */
export interface TestSessionHandle extends PlayerSessionHandle {
  readonly kind: 'test';
  snapshot(): SessionResponse<RuntimeSnapshot>;
  restore(frame: RuntimeSnapshot): SessionResponse<{ tick: number; status: string; epoch: number }>;
  replay(steps: ReadonlyArray<{ readonly actions?: readonly unknown[]; readonly ticks: number }>): SessionResponse<{ canonicalState: string; canonicalEvents: string }>;
  inspectState(): SessionResponse<{ fullState: unknown; seed: number; rngState: number | null }>;
  injectFixture(fixtureId: string): SessionResponse<{ status: 'unavailable' }>;
}

export interface CompanionSessionHandle {
  readonly sessionId: SessionId;
  readonly actorId: ActorId;
  readonly role: 'COMPANION';
  observe(detail?: 'summary' | 'standard'): SessionResponse<ObservationV1>;
  act(request: StepRequestV1): SessionResponse<StepResultV1>;
  close(): SessionResponse<{ sessionId: SessionId }>;
}

interface IdempotencyEntry {
  readonly fingerprint: string;
  readonly result: ActionResultV1;
}
interface RequestCacheEntry {
  readonly fingerprint: string;
  readonly response: SessionResponse<StepResultV1>;
}
interface SessionRollback {
  readonly game: InternalRuntimeState;
  readonly status: SessionStatusV1;
  readonly runEndReason: RunEndReasonV1;
  readonly events: EventV1[];
  readonly eventSeq: number;
  readonly lastGameEventSeq: number;
  readonly droppedEvents: number;
  readonly idempotency: Map<ActionId, IdempotencyEntry>;
}

function actionFingerprint(action: ActionRequestV1): string {
  const record: Record<string, unknown> = {};
  for (const field of ACTION_FP_FIELDS) record[field] = action[field];
  return payloadFingerprint(record);
}

export function createSessionManager(options: SessionManagerOptions = {}): SessionManager {
  return new SessionManager(options);
}

const MANAGER_NUMERIC_KEYS = [
  'maxSessions', 'maxConcurrentSteps', 'idleTimeoutMs', 'maxSessionWallMs', 'maxTicksPerStep',
  'maxActionsPerStep', 'maxObservationEvents', 'maxEventsPerPage', 'maxSnapshotBytes', 'maxActionDurationTicks',
] as const;
const MANAGER_FN_KEYS = ['clock', 'seedProvider', 'hasher'] as const;

function validateManagerOptions(options: unknown): asserts options is SessionManagerOptions {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new SessionError('E_SCHEMA', 'session manager options must be an object', 'schema');
  }
  const allowed = new Set<string>([...MANAGER_NUMERIC_KEYS, ...MANAGER_FN_KEYS]);
  for (const key of Object.keys(options as Record<string, unknown>)) {
    if (!allowed.has(key)) throw new SessionError('E_SCHEMA', `unknown session manager option: ${key}`, 'schema');
  }
  for (const key of MANAGER_NUMERIC_KEYS) {
    const value = (options as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (!isFiniteInt(value, 1)) throw new SessionError('E_SCHEMA', `${key} must be a finite positive integer`, 'schema');
  }
  for (const key of MANAGER_FN_KEYS) {
    const value = (options as Record<string, unknown>)[key];
    if (value !== undefined && typeof value !== 'function') throw new SessionError('E_SCHEMA', `${key} must be a function`, 'schema');
  }
  const opts = options as SessionManagerOptions;
  if ((opts.maxSessions ?? 10) > HARD_MAX_SESSIONS) {
    throw new SessionError('E_RESOURCE_LIMIT', `maxSessions exceeds hard cap ${HARD_MAX_SESSIONS}`, 'resource_limit');
  }
  if ((opts.maxConcurrentSteps ?? 2) > HARD_MAX_CONCURRENT_STEPS) {
    throw new SessionError('E_RESOURCE_LIMIT', `maxConcurrentSteps exceeds hard cap ${HARD_MAX_CONCURRENT_STEPS}`, 'resource_limit');
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly usedIds = new Set<string>();
  private readonly clock: () => number;
  private readonly seedProvider: () => number;
  private readonly hasher: (canonical: string) => string;
  readonly maxSessions: number;
  readonly maxConcurrentSteps: number;
  readonly idleTimeoutMs: number;
  readonly maxSessionWallMs: number;
  readonly maxTicksPerStep: number;
  readonly maxActionsPerStep: number;
  readonly maxObservationEvents: number;
  readonly maxEventsPerPage: number;
  readonly maxSnapshotBytes: number;
  readonly maxActionDurationTicks: number;
  private concurrentSteps = 0;
  private disposed = false;

  constructor(options: SessionManagerOptions = {}) {
    validateManagerOptions(options);
    this.maxSessions = options.maxSessions ?? 10;
    this.maxConcurrentSteps = options.maxConcurrentSteps ?? 2;
    this.idleTimeoutMs = options.idleTimeoutMs ?? AI_NATIVE_LIMITS_V1.IDLE_TIMEOUT_MS;
    this.maxSessionWallMs = options.maxSessionWallMs ?? AI_NATIVE_LIMITS_V1.MAX_SESSION_WALL_MS;
    this.maxTicksPerStep = options.maxTicksPerStep ?? AI_NATIVE_LIMITS_V1.MAX_TICKS_PER_STEP;
    this.maxActionsPerStep = options.maxActionsPerStep ?? AI_NATIVE_LIMITS_V1.MAX_ACTIONS_PER_TICK;
    this.maxObservationEvents = options.maxObservationEvents ?? AI_NATIVE_LIMITS_V1.MAX_OBSERVATION_EVENTS;
    this.maxEventsPerPage = options.maxEventsPerPage ?? AI_NATIVE_LIMITS_V1.MAX_EVENTS_PER_PAGE;
    this.maxSnapshotBytes = options.maxSnapshotBytes ?? AI_NATIVE_LIMITS_V1.MAX_SNAPSHOT_BYTES;
    this.maxActionDurationTicks = options.maxActionDurationTicks ?? AI_NATIVE_LIMITS_V1.MAX_ACTION_DURATION_TICKS;
    this.clock = options.clock ?? now;
    this.seedProvider = options.seedProvider ?? defaultSeed;
    this.hasher = options.hasher ?? sha256;
  }

  get size(): number {
    return this.sessions.size;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** Trusted owner capability for lifecycle control (human/Gateway only). */
  createOwnerHandle(sessionId: string): OwnerSessionHandle | null {
    const session = this.sessions.get(sessionId);
    return session ? session.ownerHandle() : null;
  }

  private newSessionId(): SessionId {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const id = `ses_${hexChars(12)}` as SessionId;
      if (!this.usedIds.has(id) && !this.sessions.has(id)) {
        this.usedIds.add(id);
        return id;
      }
    }
    throw new SessionError('E_INTERNAL_TRANSACTION', 'could not allocate a unique session id', 'internal');
  }

  createProductionSession(options: ProductionSessionOptions = {}): PlayerSessionHandle {
    if (this.disposed) throw new SessionError('E_SESSION_CLOSED', 'manager disposed', 'session_closed');
    if (this.sessions.size >= this.maxSessions) throw new SessionError('E_RESOURCE_LIMIT', 'session limit reached', 'resource_limit');
    const session = new Session(this, {
      id: this.newSessionId(), kind: 'production', role: 'PLAYER', seed: this.seedProvider(),
      resourceLimits: options.resourceLimits, clock: this.clock, hasher: this.hasher,
      idleTimeoutMs: this.idleTimeoutMs, maxSessionWallMs: this.maxSessionWallMs,
    });
    this.register(session);
    session.startIdleWatcher();
    return session.playerHandle();
  }

  createTestSession(options: TestSessionOptions): TestSessionHandle {
    if (this.disposed) throw new SessionError('E_SESSION_CLOSED', 'manager disposed', 'session_closed');
    if (this.sessions.size >= this.maxSessions) throw new SessionError('E_RESOURCE_LIMIT', 'session limit reached', 'resource_limit');
    if (!isFiniteInt(options.seed, 0, 0xffffffff)) throw new SessionError('E_SCHEMA', 'test seed must be an integer in 0..0xffffffff', 'schema');
    const session = new Session(this, {
      id: this.newSessionId(), kind: 'test', role: 'PLAYER', seed: options.seed,
      resourceLimits: options.resourceLimits, clock: this.clock, hasher: this.hasher,
      idleTimeoutMs: this.idleTimeoutMs, maxSessionWallMs: this.maxSessionWallMs,
    });
    this.register(session);
    session.startIdleWatcher();
    return session.testHandle();
  }

  createCompanionSession(options: CompanionSessionOptions = {}): CompanionSessionHandle {
    if (this.disposed) throw new SessionError('E_SESSION_CLOSED', 'manager disposed', 'session_closed');
    if (this.sessions.size >= this.maxSessions) throw new SessionError('E_RESOURCE_LIMIT', 'session limit reached', 'resource_limit');
    const session = new Session(this, {
      id: this.newSessionId(), kind: 'production', role: 'COMPANION', seed: this.seedProvider(),
      resourceLimits: options.resourceLimits, clock: this.clock, hasher: this.hasher,
      idleTimeoutMs: this.idleTimeoutMs, maxSessionWallMs: this.maxSessionWallMs, companion: true,
    });
    this.register(session);
    session.startIdleWatcher();
    return session.companionHandle();
  }

  private register(session: Session): void {
    if (this.sessions.has(session.id)) {
      throw new SessionError('E_INTERNAL_TRANSACTION', 'session id collision', 'internal');
    }
    this.sessions.set(session.id, session);
  }

  dispose(): void {
    this.disposed = true;
    for (const session of [...this.sessions.values()]) session.forceClose();
    this.sessions.clear();
    this.usedIds.clear();
  }

  acquireStepSlot(): boolean {
    if (this.concurrentSteps >= this.maxConcurrentSteps) return false;
    this.concurrentSteps += 1;
    return true;
  }
  releaseStepSlot(): void {
    this.concurrentSteps = Math.max(0, this.concurrentSteps - 1);
  }
  remove(id: string): void {
    this.sessions.delete(id);
  }
}

interface SessionInit {
  id: SessionId;
  kind: SessionKindV1;
  role: RoleV1;
  seed: number;
  resourceLimits?: Partial<ResourceLimitsV1>;
  clock: () => number;
  hasher: (canonical: string) => string;
  idleTimeoutMs: number;
  maxSessionWallMs: number;
  companion?: boolean;
}

export class Session {
  readonly id: SessionId;
  readonly kind: SessionKindV1;
  readonly role: RoleV1;
  readonly mode: ModeV1 = 'headless';
  private game: HeadlessGame | null = null;
  private status: SessionStatusV1 = 'created';
  private epoch: Epoch = 0;
  private generation = 0;
  private runId = `run_${hexChars(8)}`;
  private runEndReason: RunEndReasonV1 = null;
  private readonly actorId: ActorId;
  private readonly isCompanion: boolean;
  private readonly clock: () => number;
  private readonly hasher: (canonical: string) => string;
  private readonly manager: SessionManager;
  private readonly idleTimeoutMs: number;
  private readonly maxSessionWallMs: number;
  private readonly resourceLimits: ResourceLimitsV1;

  private events: EventV1[] = [];
  private eventSeq = 0;
  private lastGameEventSeq = -1;
  private droppedEvents = 0;
  private readonly idempotency = new Map<ActionId, IdempotencyEntry>();
  private readonly requestCache = new Map<RequestId, RequestCacheEntry>();
  private readonly aborts = new Map<ActionId, { aborted: boolean }>();
  private readonly advancedInFlight = new Set<ActionId>();
  private readonly cancelledIds = new Map<ActionId, true>();

  private readonly createdAtMs: number;
  private lastActivityMs: number;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private wallTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(manager: SessionManager, init: SessionInit) {
    this.manager = manager;
    this.id = init.id;
    this.kind = init.kind;
    this.role = init.role;
    this.isCompanion = init.companion === true;
    this.clock = init.clock;
    this.hasher = init.hasher;
    this.idleTimeoutMs = init.idleTimeoutMs;
    this.maxSessionWallMs = init.maxSessionWallMs;
    this.resourceLimits = sanitizeLimits(init.resourceLimits);
    this.createdAtMs = this.clock();
    this.lastActivityMs = this.createdAtMs;
    // Actor identity is scoped to this session; the engine derives the same
    // opaque actor id from the seed so observation evidence stays consistent.
    this.actorId = `act_${deriveActorHex(init.seed)}`;
    this.game = this.isCompanion ? null : createGame({ scenario: 'station-zero', seed: init.seed, mode: 'headless' });
  }

  // --- lifecycle (owner/player split) --------------------------------------

  start(): SessionResponse<SessionDescriptorV1> {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.status === 'created') {
      this.status = 'running';
      this.syncEvents();
      this.touch();
    }
    return this.ok(this.descriptor());
  }

  pause(): SessionResponse<SessionDescriptorV1> {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.status !== 'running') return this.fail('E_PAUSED', 'session not running', { sessionId: this.id, epoch: this.epoch });
    const r = this.game!.pause();
    if (!r.ok) return this.fail('E_PAUSED', 'cannot pause', { sessionId: this.id, epoch: this.epoch });
    this.cancelAllAdvanced();
    this.status = 'paused';
    this.syncEvents();
    this.touch();
    return this.ok(this.descriptor());
  }

  resume(): SessionResponse<SessionDescriptorV1> {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.status !== 'paused') return this.fail('E_PAUSED', 'session not paused', { sessionId: this.id, epoch: this.epoch });
    const r = this.game!.resume();
    if (!r.ok) return this.fail('E_PAUSED', 'cannot resume', { sessionId: this.id, epoch: this.epoch });
    this.status = 'running';
    this.syncEvents();
    this.touch();
    return this.ok(this.descriptor());
  }

  /** Trusted owner only: death/new-run = new runId + new epoch + R0. */
  reset(): SessionResponse<SessionDescriptorV1> {
    if (this.closedOrDisposed()) return this.closedError();
    this.cancelAllAdvanced();
    this.generation += 1;
    if (this.game) this.game.dispose();
    this.game = createGame({ scenario: 'station-zero', seed: this.seedOf(), mode: 'headless' });
    this.epoch += 1;
    this.status = 'running';
    this.runId = `run_${hexChars(8)}`;
    this.runEndReason = null;
    this.events = [];
    this.eventSeq = 0;
    this.lastGameEventSeq = -1;
    this.droppedEvents = 0;
    this.idempotency.clear();
    this.requestCache.clear();
    this.emit('SESSION_RESET', {});
    this.syncEvents();
    this.touch();
    return this.ok(this.descriptor());
  }

  close(): SessionResponse<{ sessionId: SessionId }> {
    if (this.status === 'closed') return this.ok({ sessionId: this.id });
    this.cancelAllAdvanced();
    this.forceClose();
    return this.ok({ sessionId: this.id });
  }

  // --- step ----------------------------------------------------------------

  step(request: StepRequestV1): SessionResponse<StepResultV1> {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.isCompanion) return this.fail('E_NOT_APPLICABLE', 'companion has no ECHO entity in P0', { sessionId: this.id, epoch: this.epoch });

    // 1) P0 closed-schema entry. Unknown fields / non-array actions / null /
    //    NaN / undefined are rejected without touching the engine.
    const parsed = validateStepRequestDetailed(request);
    if (!parsed.ok) {
      return this.fail(parsed.issue.code, 'step request rejected', { sessionId: this.id, epoch: this.epoch });
    }
    const v = parsed.value;

    // 2) Session binding.
    if (v.sessionId !== this.id) {
      return this.fail('E_SESSION_NOT_FOUND', 'step request session does not match this session', { sessionId: this.id, epoch: this.epoch });
    }
    // 3) Epoch binding.
    if (v.epoch !== this.epoch) {
      return this.fail('E_STALE_EPOCH', 'epoch does not match active session', { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
    // 4) Request-level idempotency: same requestId + identical request = retry.
    const requestFp = payloadFingerprint(v);
    const cachedRequest = this.requestCache.get(v.requestId);
    if (cachedRequest) {
      if (cachedRequest.fingerprint === requestFp) return cachedRequest.response;
      return this.fail('E_ID_PAYLOAD_MISMATCH', 'same requestId reused with a different request', {
        sessionId: this.id, epoch: this.epoch, requestId: v.requestId,
      });
    }
    // 5) Execution state + authoritative tick.
    if (this.status === 'created') return this.fail('E_PAUSED', 'session not started', { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    if (this.status === 'paused') return this.fail('E_PAUSED', 'session is paused', { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    if (this.status === 'finished') return this.fail('E_PAUSED', 'run finished; reset required', { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    const currentTick = this.game!.tick;
    if (v.fromTick !== currentTick) {
      const code: ErrorCodeV1 = v.fromTick < currentTick ? 'E_STALE_TICK' : 'E_FUTURE_TICK';
      return this.fail(code, 'fromTick does not match the authoritative tick', { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
    if (v.actions.length > this.manager.maxActionsPerStep) {
      return this.fail('E_RESOURCE_LIMIT', 'too many actions per step', { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
    if (v.ticks > this.manager.maxTicksPerStep) {
      return this.fail('E_RESOURCE_LIMIT', 'ticks exceed step budget', { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
    if (!this.manager.acquireStepSlot()) {
      return this.fail('E_RESOURCE_LIMIT', 'concurrent step limit reached', { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
    try {
      const result = this.executeStep(v);
      this.cacheRequest(v.requestId, requestFp, result);
      return result;
    } finally {
      this.manager.releaseStepSlot();
    }
  }

  /**
   * Transactional step: capture a NON-issuing internal rollback state, commit,
   * then validate the outbound StepResult. Any validation failure or thrown
   * dependency (e.g. a bad hasher) atomically restores the game and all
   * session-derived state, without changing the epoch or evicting issued
   * frames. The sanitized failure is returned (never a fake success) and is
   * cached per requestId by `step`.
   */
  private executeStep(v: StepRequestV1): SessionResponse<StepResultV1> {
    const rollback = this.captureRollback();
    try {
      const result = this.commitStep(v);
      if (!result.ok) this.applyRollback(rollback);
      return result;
    } catch {
      this.safeRollback(rollback);
      return this.fail('E_INTERNAL_TRANSACTION', 'step result invalid', { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
  }

  private commitStep(v: StepRequestV1): SessionResponse<StepResultV1> {
    const startedAt = this.clock();
    const fromTick = this.game!.tick;
    const currentTick = fromTick;
    const actionResults: Array<ActionResultV1 | undefined> = new Array(v.actions.length);
    const executable: Array<{ runtime: RuntimeActionInput; index: number; actionId: ActionId; fingerprint: string }> = [];
    const duplicates: Array<{ index: number; actionId: ActionId }> = [];
    const seen = new Map<ActionId, { fingerprint: string; index: number }>();

    for (let i = 0; i < v.actions.length; i += 1) {
      const action = v.actions[i];
      const fingerprint = actionFingerprint(action);
      // Cross-batch idempotency (checked before stale/binding so retries work).
      const cached = this.idempotency.get(action.actionId);
      if (cached) {
        actionResults[i] = cached.fingerprint === fingerprint
          ? { ...cached.result, replayed: true, resourceWritesThisCall: 0 }
          : this.rejected(action.actionId, action.actorId, 'E_ID_PAYLOAD_MISMATCH', 'same action id reused with different execution semantics');
        continue;
      }
      // Same-batch duplicate: only one execution; the duplicate resolves to the
      // first action's receipt (filled after execution).
      const batchSeen = seen.get(action.actionId);
      if (batchSeen) {
        actionResults[i] = batchSeen.fingerprint === fingerprint
          ? undefined
          : this.rejected(action.actionId, action.actorId, 'E_ID_PAYLOAD_MISMATCH', 'same action id reused with different execution semantics');
        if (batchSeen.fingerprint === fingerprint) duplicates.push({ index: i, actionId: action.actionId });
        continue;
      }
      seen.set(action.actionId, { fingerprint, index: i });

      if (action.sessionId !== this.id) {
        this.rejectAction(actionResults, i, action, fingerprint, 'E_SESSION_NOT_FOUND', 'action session does not match');
        continue;
      }
      if (action.epoch !== this.epoch) {
        this.rejectAction(actionResults, i, action, fingerprint, 'E_STALE_EPOCH', 'action epoch is stale');
        continue;
      }
      if (action.actorId !== this.actorId) {
        this.rejectAction(actionResults, i, action, fingerprint, 'E_UNKNOWN_ACTOR', 'actor not registered in this session');
        continue;
      }
      if (!this.allowedActions.includes(action.type)) {
        this.rejectAction(actionResults, i, action, fingerprint, 'E_PERMISSION', 'actor not permitted this action');
        continue;
      }
      const adapted = adaptAction(action, currentTick, this.allowedActions);
      if (!adapted.ok) {
        this.rejectAction(actionResults, i, action, fingerprint, adapted.error.code, adapted.error.messageKey);
        continue;
      }
      executable.push({ runtime: adapted.value, index: i, actionId: action.actionId, fingerprint });
    }

    const runResult = this.game!.step({ actions: executable.map((e) => e.runtime), ticks: v.ticks });
    if (!runResult.ok) {
      return this.fail('E_INTERNAL_TRANSACTION', 'step failed', { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
    this.syncEvents();
    this.touch();

    const byRuntimeId = new Map<string, RuntimeActionResultLike>();
    for (const rr of runResult.value.actionResults) byRuntimeId.set(rr.id, rr);
    for (const exec of executable) {
      const rr = byRuntimeId.get(exec.runtime.id);
      const result: ActionResultV1 = rr
        ? {
          schema: AI_NATIVE_DTO_SCHEMA_V1, protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
          sessionId: this.id, epoch: this.epoch, tick: this.game!.tick,
          actionId: exec.actionId, actorId: this.actorId,
          status: rr.code === 'OK' ? 'completed' : 'rejected',
          code: rr.code as ActionResultV1['code'], cost: rr.cost,
          resourceWritesThisCall: rr.code === 'OK' && rr.cost > 0 ? 1 : 0,
          replayed: false, correlationId: v.requestId,
        }
        : this.rejected(exec.actionId, this.actorId, 'E_INTERNAL_TRANSACTION', 'action result missing');
      actionResults[exec.index] = result;
      this.cacheAction(exec.actionId, exec.fingerprint, result);
    }
    for (const dup of duplicates) {
      const first = this.idempotency.get(dup.actionId);
      actionResults[dup.index] = first
        ? { ...first.result, replayed: true, resourceWritesThisCall: 0 }
        : this.rejected(dup.actionId, this.actorId, 'E_INTERNAL_TRANSACTION', 'missing replay receipt');
    }

    const toTick = this.game!.tick;
    if (this.game!.finished) {
      this.status = 'finished';
      const terminal = [...this.events].reverse().find((e) => e.type === 'RUN_COMPLETED' || e.type === 'RUN_FAILED');
      this.runEndReason = terminal?.type === 'RUN_COMPLETED' ? 'completed' : 'died';
    }

    const page = this.pageEvents(0, this.manager.maxObservationEvents);
    const observation = v.includeObservation ? this.buildObservation(v.observationDetail ?? 'standard', page.events) : undefined;
    const stepStatus: StepResultV1['status'] = this.status === 'finished' ? 'finished' : 'completed';
    const finalResults = actionResults.map((r, i) => r ?? this.rejected(v.actions[i].actionId, this.actorId, 'E_INTERNAL_TRANSACTION', 'missing action result'));
    const result: StepResultV1 = {
      schema: AI_NATIVE_DTO_SCHEMA_V1, protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      sessionId: this.id, epoch: this.epoch, fromTick, toTick, status: stepStatus,
      actionResults: finalResults, events: page.events, eventCursor: page.nextCursor,
      observation,
      postStateHash: this.hasher(this.game!.canonicalStateInternal()),
      resourceUsage: {
        wallMs: this.clock() - startedAt,
        ticksAdvanced: runResult.value.advanced,
        eventsEmitted: runResult.value.events.length,
        peakActionsPerTick: executable.length,
        droppedEvents: this.droppedEvents,
        truncatedObservation: page.truncated,
      },
    };
    const validated = validateStepResultDetailed(result);
    if (!validated.ok) {
      return this.fail('E_INTERNAL_TRANSACTION', 'step result invalid', { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
    return this.ok(result);
  }

  private rejectAction(
    results: Array<ActionResultV1 | undefined>,
    index: number,
    action: ActionRequestV1,
    fingerprint: string,
    code: ErrorCodeV1,
    messageKey: string,
  ): void {
    const result = this.rejected(action.actionId, action.actorId, code, messageKey);
    results[index] = result;
    this.cacheAction(action.actionId, fingerprint, result);
  }

  private cacheAction(actionId: ActionId, fingerprint: string, result: ActionResultV1): void {
    this.idempotency.set(actionId, { fingerprint, result });
    while (this.idempotency.size > MAX_IDEMPOTENCY_ENTRIES) {
      const oldest = this.idempotency.keys().next().value as ActionId | undefined;
      if (oldest === undefined) break;
      this.idempotency.delete(oldest);
    }
  }

  private cacheRequest(requestId: RequestId, fingerprint: string, response: SessionResponse<StepResultV1>): void {
    this.requestCache.set(requestId, { fingerprint, response });
    while (this.requestCache.size > MAX_REQUEST_CACHE) {
      const oldest = this.requestCache.keys().next().value as RequestId | undefined;
      if (oldest === undefined) break;
      this.requestCache.delete(oldest);
    }
  }

  /** Capture everything a step can mutate, without issuing a snapshot. */
  private captureRollback(): SessionRollback {
    return {
      game: this.game!.captureInternalState(),
      status: this.status,
      runEndReason: this.runEndReason,
      events: this.events.slice(),
      eventSeq: this.eventSeq,
      lastGameEventSeq: this.lastGameEventSeq,
      droppedEvents: this.droppedEvents,
      idempotency: new Map(this.idempotency),
    };
  }

  /** Atomic restore of game + session-derived state; no epoch change, no issuance. */
  private applyRollback(rollback: SessionRollback): void {
    this.game!.restoreInternalState(rollback.game);
    this.status = rollback.status;
    this.runEndReason = rollback.runEndReason;
    this.events = rollback.events;
    this.eventSeq = rollback.eventSeq;
    this.lastGameEventSeq = rollback.lastGameEventSeq;
    this.droppedEvents = rollback.droppedEvents;
    this.idempotency.clear();
    for (const [actionId, entry] of rollback.idempotency) this.idempotency.set(actionId, entry);
  }

  private safeRollback(rollback: SessionRollback): void {
    try {
      this.applyRollback(rollback);
    } catch {
      // Rollback of our own just-captured state is deterministic; if it ever
      // fails we still return a failure (never a fake success).
    }
  }

  // --- observation / events ------------------------------------------------

  observe(detail: 'summary' | 'standard' = 'standard'): SessionResponse<ObservationV1> {
    if (this.closedOrDisposed()) return this.closedError();
    if ((detail as string) === 'debug') {
      return this.fail('E_PERMISSION', 'debug observation is dev-only', { sessionId: this.id, epoch: this.epoch });
    }
    if (this.isCompanion) return this.fail('E_NOT_APPLICABLE', 'companion has no observation scope in P0', { sessionId: this.id, epoch: this.epoch });
    const page = this.pageEvents(0, this.manager.maxObservationEvents);
    const obs = this.buildObservation(detail, detail === 'standard' ? page.events : []);
    const validated = validateObservationDetailed(obs);
    if (!validated.ok) {
      return this.fail(validated.issue.code, 'observation invalid', { sessionId: this.id, epoch: this.epoch });
    }
    if (hasHiddenField(obs, ['role']) !== null) {
      return this.fail('E_INTERNAL_TRANSACTION', 'observation leaked a hidden field', { sessionId: this.id, epoch: this.epoch });
    }
    this.touch();
    return this.ok(obs);
  }

  getEvents(cursor: number, limit: number): SessionResponse<PaginatedEvents> {
    if (this.closedOrDisposed()) return this.closedError();
    const safeCursor = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
    const safeLimit = Math.min(Math.max(1, limit | 0), this.manager.maxEventsPerPage);
    const page = this.pageEvents(safeCursor, safeLimit);
    this.touch();
    return this.ok(page);
  }

  // --- bounded advanced actions -------------------------------------------

  moveTo(target: WxWyV1, opts: AdvancedActionOptions = {}): AdvancedActionHandle {
    return this.startAdvanced('move_to', opts, async (abort, bound) => {
      let guard = 0;
      while (!abort.aborted && this.isBound(bound) && guard < 4096) {
        guard += 1;
        const pos = this.currentPosition();
        if (!pos) return 'stop';
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return 'stop';
        const dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north');
        const ran = await this.execBatch([{ type: 'move', direction: dir, ticks: BATCH_TICKS }], BATCH_TICKS, abort, bound);
        if (!ran) return 'stop';
        const after = this.currentPosition();
        if (after && Math.abs(after.x - pos.x) < 0.01 && Math.abs(after.y - pos.y) < 0.01) return 'blocked';
      }
      return 'stop';
    });
  }

  approach(targetId: TargetId, opts: AdvancedActionOptions = {}): AdvancedActionHandle {
    const target = this.visibleTargetPosition(targetId);
    if (!target) {
      const id = opts.actionId ?? `aid_${hexChars(12)}`;
      return immediateAdvanced(id, this.fail('E_ILLEGAL_TARGET', 'target not visible', { sessionId: this.id, epoch: this.epoch }) as SessionResponse<ActionResultV1>);
    }
    return this.moveTo(target, opts);
  }

  scanTarget(opts: AdvancedActionOptions = {}): AdvancedActionHandle {
    return this.startAdvanced('scan_target', opts, async (abort, bound) => {
      const ran = await this.execBatch([{ type: 'scan' }], 1, abort, bound);
      return ran ? 'stop' : 'stop';
    });
  }

  interactWith(targetId: TargetId, opts: AdvancedActionOptions = {}): AdvancedActionHandle {
    if (!this.visibleTargetPosition(targetId)) {
      const id = opts.actionId ?? `aid_${hexChars(12)}`;
      return immediateAdvanced(id, this.fail('E_ILLEGAL_TARGET', 'target not visible', { sessionId: this.id, epoch: this.epoch }) as SessionResponse<ActionResultV1>);
    }
    return this.startAdvanced('interact_with', opts, async (abort, bound) => {
      const ran = await this.execBatch([{ type: 'interact' }], 1, abort, bound);
      return ran ? 'stop' : 'stop';
    });
  }

  waitUntil(opts: WaitUntilOptions = {}): AdvancedActionHandle {
    const until = opts.until;
    return this.startAdvanced('wait_until', opts, async (abort, bound) => {
      const ran = await this.execBatch([{ type: 'wait', ticks: BATCH_TICKS }], BATCH_TICKS, abort, bound);
      if (!ran) return 'stop';
      if (until === 'finished' && this.game?.finished) return 'stop';
      if (until === 'passed' && this.game?.passed) return 'stop';
      if (until === 'crossed' && this.game?.crossed) return 'stop';
      return 'continue';
    });
  }

  cancelAction(actionId: ActionId, _reason: 'client_cancel' | 'human_takeover' | 'timeout' | 'session_close' = 'client_cancel'): SessionResponse<{ actionId: ActionId }> {
    if (this.closedOrDisposed()) return this.closedError();
    if (typeof actionId !== 'string' || !ADVANCED_ID.test(actionId)) {
      return this.fail('E_SCHEMA', 'actionId must match aid_<24hex>', { sessionId: this.id, epoch: this.epoch });
    }
    const entry = this.aborts.get(actionId);
    if (entry) {
      entry.aborted = true;
      this.rememberCancelled(actionId);
      return this.ok({ actionId });
    }
    // Idempotent repeat of an already-cancelled action (bounded history).
    if (this.cancelledIds.has(actionId)) return this.ok({ actionId });
    return this.fail('E_NOT_APPLICABLE', 'no in-flight action with this id', { sessionId: this.id, epoch: this.epoch, correlationId: actionId });
  }

  private startAdvanced(
    type: string,
    opts: AdvancedActionOptions,
    body: (abort: { aborted: boolean }, bound: BoundRun) => Promise<'stop' | 'blocked' | 'continue'>,
  ): AdvancedActionHandle {
    const actionId = opts.actionId ?? (`aid_${hexChars(12)}` as ActionId);
    if (typeof actionId !== 'string' || !ADVANCED_ID.test(actionId)) {
      return immediateAdvanced(`aid_${hexChars(12)}` as ActionId, this.fail('E_SCHEMA', 'advanced actionId invalid', { sessionId: this.id, epoch: this.epoch }) as SessionResponse<ActionResultV1>);
    }
    if (this.closedOrDisposed()) return immediateAdvanced(actionId, this.closedError() as SessionResponse<ActionResultV1>);
    if (this.status === 'created') return immediateAdvanced(actionId, this.fail('E_PAUSED', 'session not started', { sessionId: this.id, epoch: this.epoch }) as SessionResponse<ActionResultV1>);
    if (this.status === 'paused') return immediateAdvanced(actionId, this.fail('E_PAUSED', 'session paused', { sessionId: this.id, epoch: this.epoch }) as SessionResponse<ActionResultV1>);
    if (this.status === 'finished') return immediateAdvanced(actionId, this.fail('E_PAUSED', 'run finished', { sessionId: this.id, epoch: this.epoch }) as SessionResponse<ActionResultV1>);
    if (!this.allowedActions.includes('move') && type !== 'scan_target' && type !== 'interact_with') {
      return immediateAdvanced(actionId, this.fail('E_NOT_APPLICABLE', `${type} unsupported`, { sessionId: this.id, epoch: this.epoch }) as SessionResponse<ActionResultV1>);
    }
    // Re-entry policy: one advanced action per session at a time (explicit).
    if (this.advancedInFlight.size > 0) {
      return immediateAdvanced(actionId, this.fail('E_RETRYABLE', 'another advanced action is already in flight', { sessionId: this.id, epoch: this.epoch }) as SessionResponse<ActionResultV1>);
    }

    const abort = { aborted: false };
    const bound: BoundRun = { game: this.game!, runId: this.runId, epoch: this.epoch, generation: this.generation };
    // Register SYNCHRONOUSLY so cancelAction can hit before the loop starts.
    this.aborts.set(actionId, abort);
    this.advancedInFlight.add(actionId);
    const maxTicks = Math.min(opts.maxTicks ?? this.resourceLimits.maxActionDurationTicks, this.resourceLimits.maxActionDurationTicks);
    const maxWallMs = opts.maxWallMs ?? this.maxSessionWallMs;
    const startedAt = this.clock();
    const onAbort = () => { abort.aborted = true; };
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
    const promise = this.runAdvanced(actionId, abort, bound, maxTicks, maxWallMs, startedAt, body, opts.signal, onAbort);
    (promise as unknown as { actionId: ActionId; result: Promise<SessionResponse<ActionResultV1>> }).actionId = actionId;
    (promise as unknown as { result: Promise<SessionResponse<ActionResultV1>> }).result = promise;
    return promise as AdvancedActionHandle;
  }

  private async runAdvanced(
    actionId: ActionId,
    abort: { aborted: boolean },
    bound: BoundRun,
    maxTicks: number,
    maxWallMs: number,
    startedAt: number,
    body: (abort: { aborted: boolean }, bound: BoundRun) => Promise<'stop' | 'blocked' | 'continue'>,
    signal: AbortSignal | undefined,
    onAbort: () => void,
  ): Promise<SessionResponse<ActionResultV1>> {
    let used = 0;
    try {
      await macrotask(); // let an already-signalled abort land before any write
      while (!abort.aborted && used < maxTicks && this.clock() - startedAt < maxWallMs && this.isBound(bound)) {
        const outcome = await body(abort, bound);
        used += BATCH_TICKS;
        await macrotask();
        if (this.game?.finished) break;
        if (outcome !== 'continue') break;
      }
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
      this.aborts.delete(actionId);
      this.advancedInFlight.delete(actionId);
    }
    let code: StepResultCodeV1 = 'OK';
    if (abort.aborted || !this.isBound(bound)) code = 'E_CANCELLED';
    else if (used >= maxTicks || this.clock() - startedAt >= maxWallMs) code = 'E_TIMEOUT';
    const status = code === 'OK' ? 'completed' : (code === 'E_CANCELLED' ? 'cancelled' : 'timeout');
    const result: ActionResultV1 = {
      schema: AI_NATIVE_DTO_SCHEMA_V1, protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      sessionId: this.id, epoch: this.epoch, tick: this.game ? this.game.tick : 0,
      actionId, actorId: this.actorId, status, code, cost: 0, resourceWritesThisCall: 0, replayed: false,
    };
    this.touch();
    return this.ok(result);
  }

  private async execBatch(
    actions: readonly ExecAction[],
    ticks: number,
    abort: { aborted: boolean },
    bound: BoundRun,
  ): Promise<boolean> {
    if (abort.aborted || !this.isBound(bound) || this.status !== 'running' || !this.game) return false;
    if (!this.manager.acquireStepSlot()) return false;
    try {
      const res = this.game.step({ actions, ticks });
      if (!res.ok) return false;
      this.syncEvents();
      this.touch();
      return true;
    } finally {
      this.manager.releaseStepSlot();
    }
  }

  private isBound(bound: BoundRun): boolean {
    return this.game === bound.game && this.runId === bound.runId &&
      this.epoch === bound.epoch && this.generation === bound.generation;
  }

  private cancelAllAdvanced(): void {
    for (const id of this.advancedInFlight) {
      const abort = this.aborts.get(id);
      if (abort) abort.aborted = true;
      this.rememberCancelled(id);
    }
    this.advancedInFlight.clear();
    this.generation += 1;
  }

  private rememberCancelled(actionId: ActionId): void {
    this.cancelledIds.set(actionId, true);
    while (this.cancelledIds.size > MAX_CANCELLED_IDS) {
      const oldest = this.cancelledIds.keys().next().value as ActionId | undefined;
      if (oldest === undefined) break;
      this.cancelledIds.delete(oldest);
    }
  }

  // --- trusted dev/test facet ---------------------------------------------

  snapshot(): SessionResponse<RuntimeSnapshot> {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.kind !== 'test') return this.fail('E_PERMISSION', 'snapshot is dev/test only', { sessionId: this.id, epoch: this.epoch });
    const frame = withHashes(this.game!.snapshot(), this.hasher);
    if (Buffer.byteLength(JSON.stringify(frame), 'utf8') > this.manager.maxSnapshotBytes) {
      return this.fail('E_PAYLOAD_TOO_LARGE', 'snapshot exceeds size budget', { sessionId: this.id, epoch: this.epoch });
    }
    return this.ok(frame);
  }

  restore(frame: RuntimeSnapshot): SessionResponse<{ tick: number; status: string; epoch: number }> {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.kind !== 'test') return this.fail('E_PERMISSION', 'restore is dev/test only', { sessionId: this.id, epoch: this.epoch });
    this.cancelAllAdvanced();
    const result = this.game!.restore(frame);
    if (!result.ok) return this.fail('E_SNAPSHOT_INVALID', 'restore rejected', { sessionId: this.id, epoch: this.epoch });
    this.epoch = result.value.epoch;
    this.status = result.value.status;
    this.syncEvents();
    this.idempotency.clear();
    this.requestCache.clear();
    if (this.status === 'finished') this.runEndReason = 'closed';
    this.touch();
    return this.ok({ tick: result.value.tick, status: result.value.status, epoch: result.value.epoch });
  }

  replay(steps: ReadonlyArray<{ readonly actions?: readonly unknown[]; readonly ticks: number }>): SessionResponse<{ canonicalState: string; canonicalEvents: string }> {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.kind !== 'test') return this.fail('E_PERMISSION', 'replay is dev/test only', { sessionId: this.id, epoch: this.epoch });
    const result = this.game!.replay(this.game!.snapshot(), steps);
    if (!result.ok) return this.fail('E_REPLAY_INCOMPATIBLE', 'replay failed', { sessionId: this.id, epoch: this.epoch });
    this.touch();
    return this.ok({ canonicalState: result.value.canonicalState, canonicalEvents: result.value.canonicalEvents });
  }

  inspectState(): SessionResponse<{ fullState: unknown; seed: number; rngState: number | null }> {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.kind !== 'test') return this.fail('E_PERMISSION', 'inspect is dev/test only', { sessionId: this.id, epoch: this.epoch });
    const snap = this.game!.getState();
    return this.ok({ fullState: snap.model, seed: this.seedOf(), rngState: snap.rngState });
  }

  injectFixture(_fixtureId: string): SessionResponse<{ status: 'unavailable' }> {
    return this.ok({ status: 'unavailable' });
  }

  // --- internals -----------------------------------------------------------

  private currentPosition(): WxWyV1 | null {
    if (!this.game) return null;
    const pos = this.game.observe().current.self.position;
    return { x: pos.x, y: pos.y };
  }

  private visibleTargetPosition(targetId: TargetId): WxWyV1 | null {
    if (!this.game) return null;
    const found = this.game.observe().current.visibleTargets.find((t) => t.targetId === targetId);
    return found && 'position' in found && found.position ? found.position : null;
  }

  private buildObservation(detail: 'summary' | 'standard', events: readonly EventV1[]): ObservationV1 {
    const base = this.game!.observe() as ObservationV1;
    return {
      ...base,
      sessionId: this.id,
      epoch: this.epoch,
      actorId: this.actorId,
      role: this.role,
      detail,
      events: detail === 'standard' ? events.slice() : [],
      ...(detail === 'summary' ? { evidence: [], knowledge: [], hypotheses: [] } : {}),
    };
  }

  private pageEvents(cursor: number, limit: number): PaginatedEvents {
    const slice = this.events.slice(cursor, cursor + limit);
    const nextCursor = cursor + slice.length;
    const truncated = nextCursor < this.events.length || this.droppedEvents > 0;
    return Object.freeze({ events: slice, nextCursor, total: this.events.length, truncated, droppedEvents: this.droppedEvents });
  }

  private syncEvents(): void {
    if (!this.game) return;
    const all = this.game.eventLog();
    for (let i = this.lastGameEventSeq + 1; i < all.length; i += 1) {
      this.appendEvent(all[i]);
      this.lastGameEventSeq = all[i].eventSeq;
    }
  }

  private appendEvent(e: RuntimeEventLike): void {
    const eventId = `evt_${hexChars(8)}` as EventV1['eventId'];
    const ev: EventV1 = {
      schema: AI_NATIVE_EVENT_SCHEMA_V1, protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      eventId, sessionId: this.id, epoch: this.epoch, tick: e.tick, phase: e.phase,
      ordinal: e.ordinal, eventSeq: this.eventSeq,
      ...(eventActionId(e.payload.actionId) ? { actionId: eventActionId(e.payload.actionId) as ActionId } : {}),
      ...(typeof e.payload.actor === 'string' ? { actorId: this.actorId } : {}),
      type: e.type as EventV1['type'],
      payload: toProtocolPayload(e.type, e.payload),
    };
    this.events.push(ev);
    this.eventSeq += 1;
    if (this.events.length > AI_NATIVE_LIMITS_V1.MAX_EVENT_LOG_EVENTS) {
      this.events.shift();
      this.droppedEvents += 1;
    }
  }

  private emit(type: string, payload: Record<string, string | number | boolean>): void {
    this.appendEvent({ eventSeq: this.eventSeq, tick: this.game ? this.game.tick : 0, phase: 0, ordinal: 0, type, payload });
  }

  private descriptor(): SessionDescriptorV1 {
    return Object.freeze({
      schema: AI_NATIVE_DTO_SCHEMA_V1, protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      sessionId: this.id, kind: this.kind, mode: this.mode, status: this.status,
      epoch: this.epoch, tick: this.game ? this.game.tick : 0,
      scenarioId: AI_NATIVE_SCENARIO_ID_V1, kernelVersion: AI_NATIVE_KERNEL_VERSION_V1,
      runId: this.runId, runEndReason: this.runEndReason,
      actorRegistry: {
        [this.actorId]: {
          actorId: this.actorId, role: this.role,
          priority: (this.role === 'PLAYER' ? 0 : 2) as 0 | 1 | 2,
          allowedActions: this.allowedActions, observationScope: 'self',
        } as ActorBindingV1,
      },
      createdAtMs: this.createdAtMs, lastActivityMs: this.lastActivityMs,
      expiresAtMs: this.lastActivityMs + this.idleTimeoutMs, resourceLimits: this.resourceLimits,
    });
  }

  private get allowedActions(): readonly ActionTypeV1[] {
    if (this.isCompanion) return [];
    const base: ActionTypeV1[] = ['move', 'scan', 'wait', 'jam', 'interact'];
    if (this.game?.inCorridor) base.push('shoot_guard');
    return base;
  }

  private seedOf(): number {
    return this.game ? this.game.seed : 0;
  }

  private touch(): void {
    this.lastActivityMs = this.clock();
    this.armIdle();
  }

  private armIdle(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.timers.delete(this.idleTimer); this.idleTimer = null; }
    const remaining = this.idleTimeoutMs - (this.clock() - this.lastActivityMs);
    if (remaining <= 0) { this.scheduleClose(); return; }
    const t = setTimeout(() => this.scheduleClose(), remaining);
    t.unref?.();
    this.idleTimer = t;
    this.timers.add(t);
  }

  startIdleWatcher(): void {
    this.armIdle();
    const wall = setTimeout(() => this.scheduleClose(), this.maxSessionWallMs);
    wall.unref?.();
    this.wallTimer = wall;
    this.timers.add(wall);
  }

  private scheduleClose(): void {
    if (this.status === 'closed') return;
    this.emit('SESSION_CLOSED', { reason: 'idle' });
    this.forceClose();
  }

  forceClose(): void {
    if (this.status === 'closed') return;
    this.cancelAllAdvanced();
    this.status = 'closed';
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.idleTimer = null;
    this.wallTimer = null;
    this.game?.dispose();
    this.game = null;
    this.manager.remove(this.id);
  }

  private closedOrDisposed(): boolean {
    return this.status === 'closed';
  }

  private closedError(): SessionResponse<never> {
    return this.fail('E_SESSION_CLOSED', 'session closed', { sessionId: this.id, epoch: this.epoch });
  }

  private fail(code: ErrorCodeV1, messageKey: string, extra: Record<string, unknown> = {}): SessionResponse<never> {
    return {
      ok: false,
      error: makeError(code, messageKey, {
        sessionId: extra.sessionId as SessionId | undefined,
        epoch: extra.epoch as Epoch | undefined,
        tick: extra.tick as Tick | undefined,
        requestId: extra.requestId as RequestId | undefined,
        correlationId: extra.correlationId as RequestId | ActionId | undefined,
      }),
    };
  }

  private ok<T>(value: T): SessionResponse<T> {
    return { ok: true, value };
  }

  private rejected(actionId: ActionId, actorId: ActorId, code: ErrorCodeV1, messageKey: string): ActionResultV1 {
    return {
      schema: AI_NATIVE_DTO_SCHEMA_V1, protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      sessionId: this.id, epoch: this.epoch, tick: this.game ? this.game.tick : 0,
      actionId, actorId, status: 'rejected', code, cost: 0, resourceWritesThisCall: 0, replayed: false,
    };
  }

  // --- capability narrowings ----------------------------------------------

  playerHandle(): PlayerSessionHandle {
    const self = this;
    return {
      sessionId: this.id, actorId: this.actorId, role: 'PLAYER',
      start: () => self.start(), close: () => self.close(),
      step: (r) => self.step(r), observe: (d) => self.observe(d),
      getEvents: (c, l) => self.getEvents(c, l), cancelAction: (a, r) => self.cancelAction(a, r),
      moveTo: (t, o) => self.moveTo(t, o), approach: (t, o) => self.approach(t, o),
      scanTarget: (o) => self.scanTarget(o), interactWith: (t, o) => self.interactWith(t, o),
      waitUntil: (o) => self.waitUntil(o),
    };
  }

  ownerHandle(): OwnerSessionHandle {
    const self = this;
    return {
      sessionId: this.id, capability: 'OWNER',
      start: () => self.start(), pause: () => self.pause(), resume: () => self.resume(),
      reset: () => self.reset(), close: () => self.close(),
    };
  }

  testHandle(): TestSessionHandle {
    const player = this.playerHandle();
    const self = this;
    return {
      ...player, kind: 'test',
      snapshot: () => self.snapshot(), restore: (f) => self.restore(f),
      replay: (s) => self.replay(s), inspectState: () => self.inspectState(),
      injectFixture: (f) => self.injectFixture(f),
    };
  }

  companionHandle(): CompanionSessionHandle {
    const self = this;
    return {
      sessionId: this.id, actorId: this.actorId, role: 'COMPANION',
      observe: () => self.observe(), act: (r) => self.step(r), close: () => self.close(),
    };
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface BoundRun { readonly game: HeadlessGame; readonly runId: string; readonly epoch: Epoch; readonly generation: number }
interface RuntimeActionInput { type: string; direction?: string; ticks?: number; target?: string; id: string; actor: 'player' }
interface ExecAction { type: string; direction?: string; ticks?: number; target?: string }
interface RuntimeActionResultLike { id: string; type: string; code: string; cost: number }
interface RuntimeEventLike { eventSeq: number; tick: number; phase: number; ordinal: number; type: string; payload: Record<string, string | number | boolean> }

function macrotask(): Promise<void> {
  return new Promise((resolve) => { const t = setTimeout(resolve, 0); t.unref?.(); });
}

function immediateAdvanced(actionId: ActionId, response: SessionResponse<ActionResultV1>): AdvancedActionHandle {
  const p = Promise.resolve(response);
  (p as unknown as { actionId: ActionId }).actionId = actionId;
  (p as unknown as { result: Promise<SessionResponse<ActionResultV1>> }).result = p;
  return p as AdvancedActionHandle;
}

const UNSUPPORTED = new Set(['aim', 'fire', 'decoy']);

function adaptAction(
  req: ActionRequestV1,
  currentTick: number,
  allowed: readonly ActionTypeV1[],
): SessionResponse<RuntimeActionInput> {
  if (UNSUPPORTED.has(req.type)) return { ok: false, error: makeError('E_NOT_APPLICABLE', 'action not implemented in P0', { correlationId: req.actionId }) };
  if (!allowed.includes(req.type)) return { ok: false, error: makeError('E_PERMISSION', 'action not permitted', { correlationId: req.actionId }) };
  if (req.targetTick !== currentTick + 1) {
    const code: ErrorCodeV1 = req.targetTick < currentTick + 1 ? 'E_STALE_TICK' : 'E_FUTURE_TICK';
    return { ok: false, error: makeError(code, 'targetTick must equal the next authoritative tick', { correlationId: req.actionId }) };
  }
  const id = `player-${req.actionId}`;
  const out: RuntimeActionInput = { id, actor: 'player', type: req.type };
  if (req.type === 'move') {
    const dir = vectorToCardinal(req.payload as { direction: WxWyV1 });
    if (!dir) return { ok: false, error: makeError('E_SCHEMA', 'move direction invalid', { correlationId: req.actionId }) };
    out.direction = dir;
    out.ticks = (req.payload as { durationTicks: number }).durationTicks;
  } else if (req.type === 'wait') {
    out.ticks = (req.payload as { durationTicks: number }).durationTicks;
  } else if (req.type === 'jam' || req.type === 'interact') {
    const targetId = (req.payload as { targetId: TargetId }).targetId;
    out.target = targetId.includes('guard') ? 'guard' : 'relay';
  }
  return { ok: true, value: out };
}

function vectorToCardinal(vec: { direction: WxWyV1 }): string | null {
  const { x, y } = vec.direction;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return null;
  if (Math.abs(x) >= Math.abs(y)) return x > 0 ? 'east' : 'west';
  return y > 0 ? 'south' : 'north';
}

function eventActionId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const bare = value.startsWith('player-') ? value.slice('player-'.length) : value;
  return ADVANCED_ID.test(bare) ? bare : null;
}

function toProtocolPayload(
  type: string,
  payload: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const group = AI_NATIVE_EVENT_GROUP_V1[type];
  const allowed = group ? AI_NATIVE_EVENT_PAYLOAD_KEYS_V1[group] : undefined;
  const out: Record<string, string | number | boolean> = {};
  if (!allowed) return out;
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'actor') continue;
    const mapped = key === 'roomId' ? 'stateLabel' : key;
    if (allowed.includes(mapped) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
      out[mapped] = value;
    }
  }
  if (type === 'SESSION_CREATED' && allowed.includes('status')) out.status = 'created';
  if (type === 'SESSION_RESET' && allowed.includes('reason')) out.reason = 'reset';
  return out;
}

function sanitizeLimits(limits?: Partial<ResourceLimitsV1>): ResourceLimitsV1 {
  const base: ResourceLimitsV1 = {
    maxTicksPerStep: AI_NATIVE_LIMITS_V1.MAX_TICKS_PER_STEP,
    maxActionsPerTick: AI_NATIVE_LIMITS_V1.MAX_ACTIONS_PER_TICK,
    maxActiveIntentsPerActor: 1,
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
  if (!limits) return base;
  if (typeof limits !== 'object' || Array.isArray(limits)) throw new SessionError('E_SCHEMA', 'resourceLimits must be an object', 'schema');
  const allowedKeys = new Set(Object.keys(base));
  const merged: Record<string, number> = { ...base };
  for (const key of Object.keys(limits)) {
    if (!allowedKeys.has(key)) throw new SessionError('E_SCHEMA', `unknown resource limit: ${key}`, 'schema');
    const value = (limits as Record<string, unknown>)[key];
    if (!isFiniteInt(value, 1)) throw new SessionError('E_SCHEMA', `${key} must be a finite positive integer`, 'schema');
    merged[key] = value;
  }
  return merged as unknown as ResourceLimitsV1;
}

function deriveActorHex(seed: number): string {
  let state = (seed >>> 0) ^ 0x85ebca6b;
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35) >>> 0;
    out += (state & 0xf).toString(16);
  }
  return out;
}

export { AI_NATIVE_LIMITS_V1 };
