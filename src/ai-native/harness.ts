/**
 * AI-NATIVE-01 / P3 — Developer Harness over the P2 SessionManager.
 *
 * The harness is a trusted, server-side layer used by the MCP DEV process and
 * tests. It owns opaque session handles (the internal Session.id never leaves
 * this process), a bounded snapshot-handle registry, closed dev fixtures, and
 * background scenario/batch/compare execution. It never duplicates game rules:
 * every action goes through Session.step / the Session advanced actions.
 *
 * Player-mode harness instances must never reach dev capabilities: the MCP
 * server simply does not register those tools, and the harness checks the mode
 * again as defence in depth.
 */
import { randomBytes, createHash } from 'node:crypto';
import {
  SessionManager, type Session, type PlayerSessionHandle, type TestSessionHandle,
  type OwnerSessionHandle, type SessionResponse, type DevFixture, type FixtureAudit,
  type PaginatedEvents, type AdvancedActionHandle,
} from './sessions';
import { canonicalJson, payloadFingerprint, type ActionRequestV1, type StepRequestV1, type StepResultV1, type ObservationV1, type EventV1, type ActionResultV1, type ErrorCodeV1, type ActionId, type RequestId } from './protocol';
import type { RuntimeSnapshot } from './runtime';

const DTO = 'last_signal.ai-native.dto.v1';
const MAX_SNAPSHOTS = 64; // aligns with the P1 issued-frame bound
const MAX_RUNS = 32;
const MAX_AUDIT = 256;
const MAX_REQUEST_CACHE = 256;
const MAX_BATCH_SEEDS = 8;

export const PLAYER_TOOLS = [
  'game_create_session', 'game_observe', 'game_step', 'game_execute_action',
  'game_get_events', 'game_close_session',
] as const;
export const DEV_ONLY_TOOLS = [
  'game_snapshot', 'game_restore', 'game_run_scenario',
  'game_inspect_state', 'game_inject_fixture', 'game_load_scenario',
  'game_replay', 'game_run_batch', 'game_compare_runs', 'game_cancel_action',
] as const;
export function toolMatrix(dev: boolean): readonly string[] {
  return dev ? [...PLAYER_TOOLS, ...DEV_ONLY_TOOLS] : [...PLAYER_TOOLS];
}

const MAX_RUN_STEPS = 64;

function hexChars(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}
function handle(prefix: string): string {
  return `${prefix}${hexChars(12)}`;
}
function isFiniteInt(value: unknown, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Deterministic gameplay-event projection for compare_runs: excludes random
 * event ids, session ids, seed-derived actor ids, and random action ids so a
 * deterministic strategy compares by gameplay, not by incidental identifiers.
 */
function gameplayEvents(events: readonly EventV1[]): Array<Record<string, unknown>> {
  return events.map((e) => ({
    tick: e.tick, phase: e.phase, ordinal: e.ordinal, eventSeq: e.eventSeq, type: e.type,
    payload: Object.fromEntries(Object.entries(e.payload).filter(([k]) => k !== 'actionId' && k !== 'actorId')),
  }));
}
function gameplayEventsHash(events: readonly EventV1[]): string {
  return `sha256:${createHash('sha256').update(canonicalJson(gameplayEvents(events))).digest('hex')}`;
}

export type HarnessResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCodeV1; readonly messageKey: string };

function ok<T>(value: T): HarnessResult<T> { return { ok: true, value }; }
function fail<T>(code: ErrorCodeV1, messageKey: string): HarnessResult<T> { return { ok: false, code, messageKey }; }

export type HarnessMode = 'player' | 'dev';

export interface HarnessSessionInfo {
  readonly session: string;
  readonly kind: 'production' | 'test';
  readonly tick: number;
  readonly epoch: number;
  readonly seed?: number;
}

export interface DevAuditEntry {
  readonly op: string;
  readonly atMs: number;
  readonly tick: number;
  readonly epoch: number;
  readonly detail?: Record<string, unknown>;
}

export interface SnapshotInfo {
  readonly snapshot: string;
  readonly tick: number;
  readonly epoch: number;
  readonly stateHash?: string;
  readonly sizeBytes: number;
  readonly provenance: { readonly kind: string; readonly devTampered: boolean; readonly fixtures: number };
  readonly evicted: readonly string[];
}

export interface RunTraceStep {
  readonly step: number;
  readonly tickBefore: number;
  readonly tickAfter: number;
  readonly actionCodes: readonly string[];
  readonly status: string;
}

export interface RunSummary {
  readonly runId: string;
  readonly ok: boolean;
  readonly code?: ErrorCodeV1;
  readonly seed: number;
  readonly strategy: string;
  readonly ticks: number;
  readonly completed: boolean;
  readonly passed: boolean;
  readonly crossed: boolean;
  readonly failed: boolean;
  readonly stateHash?: string;
  readonly eventsHash?: string;
  readonly eventCount: number;
  readonly snapshot?: string;
  readonly steps: number;
  readonly elapsedMs: number;
  readonly trace: readonly RunTraceStep[];
  readonly provenance: { readonly dev: true; readonly devTampered: boolean; readonly fixtures: number; readonly playerLegal: false };
  readonly stats: { readonly steps: number; readonly ticks: number; readonly actions: number; readonly events: number };
}

export interface CompareResult {
  readonly sameState: boolean;
  readonly sameEvents: boolean;
  readonly stateHashA?: string;
  readonly stateHashB?: string;
  readonly eventsHashA?: string;
  readonly eventsHashB?: string;
  readonly eventCountA: number;
  readonly eventCountB: number;
  readonly firstDivergence: { readonly index: number; readonly tickA?: number; readonly tickB?: number; readonly typeA?: string; readonly typeB?: string } | null;
}

interface HarnessRecord {
  readonly handle: string;
  readonly session: Session;
  readonly player: PlayerSessionHandle;
  readonly test: TestSessionHandle | null;
  readonly owner: OwnerSessionHandle;
  readonly kind: 'production' | 'test';
  readonly seed: number | null;
  readonly audit: DevAuditEntry[];
}

interface SnapshotEntry {
  readonly frame: RuntimeSnapshot;
  readonly sessionHandle: string;
  readonly tick: number;
  readonly epoch: number;
  readonly stateHash?: string;
  readonly sizeBytes: number;
  readonly provenance: SnapshotInfo['provenance'];
}

interface RunRecord {
  readonly summary: RunSummary;
  readonly events: readonly EventV1[];
}

type RequestDomain = 'step' | 'execute_action';
interface RequestCacheEntry {
  readonly session: string;
  readonly epoch: number;
  readonly requestId: string;
  readonly domain: RequestDomain;
  readonly argsFp: string;
  readonly response: HarnessResult<StepResultV1>;
}

/** Stable fingerprint of the ORIGINAL tool arguments (undefined keys omitted). */
function fingerprintArgs(value: Record<string, unknown>): string {
  try {
    const clean: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) if (item !== undefined) clean[key] = item;
    return payloadFingerprint(clean);
  } catch {
    return '__invalid__';
  }
}

/**
 * The harness caches by the ORIGINAL client requestId plus tool domain. The
 * internal Session also keeps a request cache keyed by requestId, so feed it a
 * domain-scoped id to prevent game_step and game_execute_action from colliding
 * on the same client id. Deterministic: the same (domain, client id) maps to the
 * same internal id.
 */
function deriveSessionRequestId(domain: RequestDomain, requestId: RequestId): RequestId {
  const digest = createHash('sha256').update(`${domain}|${requestId}`).digest('hex').slice(0, 24);
  return `req_${digest}` as RequestId;
}

interface StepParams {
  readonly ticks: number;
  readonly actions: ReadonlyArray<{ readonly actionId?: string; readonly type: ActionRequestV1['type']; readonly payload: ActionRequestV1['payload'] }>;
  readonly includeObservation?: boolean;
  readonly detail?: 'summary' | 'standard';
  readonly requestId?: string;
  /** Required session epoch (from create/observe). Validated before cache replay/defaults. */
  readonly epoch: number;
  /** Optional scheduling fields: a retry may resend the identical request. Session validates them. */
  readonly fromTick?: number;
  readonly targetTick?: number;
}

interface AdvancedParams {
  /** Required session epoch (from create/observe). Validated before the action starts. */
  readonly epoch: number;
  readonly actionId?: string;
  readonly type: 'move_to' | 'approach' | 'scan_target' | 'interact_with' | 'wait_until';
  readonly target?: { readonly x: number; readonly y: number };
  readonly targetId?: string;
  readonly until?: 'passed' | 'crossed' | 'finished';
  readonly maxTicks?: number;
  readonly maxWallMs?: number;
  readonly wait?: boolean;
}

const ROUTE_A: ReadonlyArray<{ readonly type: ActionRequestV1['type'] | null; readonly payload: ActionRequestV1['payload'] | null; readonly ticks: number }> = [
  { type: 'move', payload: { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 60 }, ticks: 60 },
  { type: 'scan', payload: { type: 'scan' }, ticks: 1 },
  { type: 'jam', payload: { type: 'jam', targetId: 'tgt_lab_door_receiver' as never }, ticks: 1 },
  { type: 'move', payload: { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 40 }, ticks: 40 },
  { type: 'move', payload: { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 100 }, ticks: 100 },
  { type: null, payload: null, ticks: 1 },
  { type: 'move', payload: { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 61 }, ticks: 61 },
  { type: 'move', payload: { type: 'move', direction: { x: 0, y: -1 }, durationTicks: 17 }, ticks: 17 },
  { type: 'interact', payload: { type: 'interact', targetId: 'tgt_corridor_relay' as never }, ticks: 1 },
  { type: null, payload: null, ticks: 95 },
  { type: 'move', payload: { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 150 }, ticks: 150 },
];

export class Harness {
  private readonly records = new Map<string, HarnessRecord>();
  private readonly snapshots = new Map<string, SnapshotEntry>();
  private readonly snapshotOrder: string[] = [];
  private readonly runs = new Map<string, RunRecord>();
  private readonly runOrder: string[] = [];
  private readonly pending = new Map<string, AdvancedActionHandle>();
  private readonly requestCache = new Map<string, RequestCacheEntry>();
  readonly mode: HarnessMode;
  readonly manager: SessionManager;

  constructor(manager: SessionManager, mode: HarnessMode) {
    this.manager = manager;
    this.mode = mode;
  }

  get size(): number {
    return this.records.size;
  }

  private touch(record: HarnessRecord, op: string, detail?: Record<string, unknown>): void {
    record.audit.push({
      op, atMs: Date.now(), tick: record.session.tickValue, epoch: record.session.epochValue,
      ...(detail ? { detail } : {}),
    });
    while (record.audit.length > MAX_AUDIT) record.audit.shift();
  }

  private record(handle: string): HarnessRecord | HarnessResult<never> {
    const record = this.records.get(handle);
    if (!record) return fail('E_SESSION_NOT_FOUND', 'unknown session handle');
    return record;
  }

  private isRecord(value: HarnessRecord | HarnessResult<never>): value is HarnessRecord {
    return (value as HarnessRecord).session !== undefined;
  }

  /** Create a session. Player mode only production; dev mode only test. */
  createSession(seed?: number): HarnessResult<HarnessSessionInfo> {
    if (this.mode === 'player') {
      if (seed !== undefined) return fail('E_PERMISSION', 'seed is not accepted on the player surface');
      if (this.records.size >= this.manager.maxSessions) return fail('E_RESOURCE_LIMIT', 'session limit reached');
      const player = this.manager.createProductionSession();
      const session = this.manager.get(player.sessionId);
      if (!session) return fail('E_INTERNAL_TRANSACTION', 'session unavailable');
      const owner = session.ownerHandle();
      owner.start();
      const handleValue = handle('ses_');
      const record: HarnessRecord = {
        handle: handleValue, session, player, test: null, owner,
        kind: 'production', seed: null, audit: [],
      };
      this.records.set(handleValue, record);
      this.touch(record, 'create', { kind: 'production' });
      return ok({ session: handleValue, kind: 'production', tick: session.tickValue, epoch: session.epochValue });
    }
    if (!isFiniteInt(seed, 0, 0xffffffff)) return fail('E_SCHEMA', 'dev create requires a seed in 0..0xffffffff');
    if (this.records.size >= this.manager.maxSessions) return fail('E_RESOURCE_LIMIT', 'session limit reached');
    const test = this.manager.createTestSession({ seed });
    const session = this.manager.get(test.sessionId);
    if (!session) return fail('E_INTERNAL_TRANSACTION', 'session unavailable');
    const owner = session.ownerHandle();
    owner.start();
    const handleValue = handle('ses_');
    const record: HarnessRecord = {
      handle: handleValue, session, player: test, test, owner,
      kind: 'test', seed, audit: [],
    };
    this.records.set(handleValue, record);
    this.touch(record, 'create', { kind: 'test', seed });
    return ok({ session: handleValue, kind: 'test', tick: session.tickValue, epoch: session.epochValue, seed });
  }

  closeSession(sessionHandle: string): HarnessResult<{ session: string }> {
    const record = this.record(sessionHandle);
    if (!this.isRecord(record)) return record;
    this.touch(record, 'close');
    this.clearSessionRequests(sessionHandle);
    record.owner.close();
    this.records.delete(sessionHandle);
    for (const [key, value] of this.pending) {
      if (key.startsWith(`${sessionHandle}:`)) this.pending.delete(key);
    }
    return ok({ session: sessionHandle });
  }

  observe(sessionHandle: string, detail: 'summary' | 'standard' = 'standard'): HarnessResult<ObservationV1> {
    const record = this.record(sessionHandle);
    if (!this.isRecord(record)) return record;
    const res = record.player.observe(detail);
    this.touch(record, 'observe', { detail });
    return res.ok ? ok(res.value) : fail(res.error.code, res.error.messageKey);
  }

  getEvents(sessionHandle: string, cursor = 0, limit = 64): HarnessResult<PaginatedEvents> {
    const record = this.record(sessionHandle);
    if (!this.isRecord(record)) return record;
    const res = record.player.getEvents(cursor, limit);
    this.touch(record, 'get_events', { cursor, limit });
    return res.ok ? ok(res.value) : fail(res.error.code, res.error.messageKey);
  }

  step(sessionHandle: string, params: StepParams): HarnessResult<StepResultV1> {
    const record = this.record(sessionHandle);
    if (!this.isRecord(record)) return record;
    const argsFp = fingerprintArgs({
      ticks: params.ticks, actions: params.actions, includeObservation: params.includeObservation,
      detail: params.detail, fromTick: params.fromTick, targetTick: params.targetTick, epoch: params.epoch,
    });
    return this.stepWithCache(record, 'step', params, argsFp);
  }

  /**
   * Harness-level request idempotency. The ORIGINAL tool arguments are fingerprinted
   * and cached by (session, epoch, requestId, tool domain) BEFORE any default
   * fromTick/actionId is filled, so a retry of the same MCP tool call returns the
   * first receipt and never advances ticks or re-charges resources. Different
   * arguments under the same id conflict; the Session's own validation is untouched.
   */
  private stepWithCache(
    record: HarnessRecord,
    domain: RequestDomain,
    params: StepParams,
    argsFp: string,
  ): HarnessResult<StepResultV1> {
    // Epoch is mandatory and is checked BEFORE any cache replay/default fill.
    if (!isFiniteInt(params.epoch, 0, 4_294_967_295)) {
      return fail('E_SCHEMA', 'epoch is required and must be an integer in 0..4294967295');
    }
    const currentEpoch = record.session.epochValue;
    if (params.epoch !== currentEpoch) {
      return fail('E_STALE_EPOCH', 'request epoch is stale; re-read epoch and use a new requestId');
    }
    if (!isFiniteInt(params.ticks, 1, 1000)) return fail('E_SCHEMA', 'ticks must be an integer in 1..1000');
    if (!Array.isArray(params.actions)) return fail('E_SCHEMA', 'actions must be an array');
    const requestId = (params.requestId ?? `req_${hexChars(12)}`) as RequestId;
    const key = `${record.handle}|${currentEpoch}|${domain}|${requestId}`;
    const cached = this.requestCache.get(key);
    if (cached) {
      if (cached.argsFp === argsFp) return cached.response;
      return fail('E_ID_PAYLOAD_MISMATCH', 'same requestId reused with different arguments for this tool');
    }
    const sessionRequestId = deriveSessionRequestId(domain, requestId);
    const result = this.executeStepCore(record, params, sessionRequestId);
    this.rememberRequest(key, record.handle, currentEpoch, requestId, domain, argsFp, result);
    return result;
  }

  private executeStepCore(record: HarnessRecord, params: StepParams, requestId: RequestId): HarnessResult<StepResultV1> {
    const tick = params.fromTick ?? record.session.tickValue;
    const epoch = params.epoch;
    const targetTick = params.targetTick ?? tick + 1;
    const actions: ActionRequestV1[] = [];
    for (const action of params.actions) {
      if (!action || typeof action.type !== 'string' || !action.payload || typeof action.payload !== 'object') {
        return fail('E_SCHEMA', 'each action needs type and payload');
      }
      actions.push({
        schema: DTO, protocolVersion: 1,
        actionId: (action.actionId ?? `aid_${hexChars(12)}`) as ActionRequestV1['actionId'],
        actorId: record.session.actorId, sessionId: record.session.id as ActionRequestV1['sessionId'],
        epoch, targetTick, type: action.type, payload: action.payload,
        clientSeq: 0, issuedAtMs: 0, deadlineTick: targetTick,
      });
    }
    const request: StepRequestV1 = {
      schema: DTO, protocolVersion: 1,
      requestId,
      sessionId: record.session.id as StepRequestV1['sessionId'], epoch,
      fromTick: tick, ticks: params.ticks, actions,
      includeObservation: params.includeObservation === true,
      observationDetail: params.detail ?? 'standard',
    };
    const res = record.session.step(request);
    this.touch(record, 'step', { ticks: params.ticks, actions: actions.length });
    return res.ok ? ok(res.value) : fail(res.error.code, res.error.messageKey);
  }

  executeAction(sessionHandle: string, params: StepParams & { readonly action?: { readonly actionId?: string; readonly type: ActionRequestV1['type']; readonly payload: ActionRequestV1['payload'] } }): HarnessResult<{ readonly step: StepResultV1; readonly result: ActionResultV1 | null }> {
    const record = this.record(sessionHandle);
    if (!this.isRecord(record)) return record;
    const argsFp = fingerprintArgs({
      ticks: params.ticks, action: params.action, actions: params.action ? undefined : params.actions,
      includeObservation: params.includeObservation, detail: params.detail,
      fromTick: params.fromTick, targetTick: params.targetTick, epoch: params.epoch,
    });
    const res = this.stepWithCache(record, 'execute_action', {
      ticks: params.ticks,
      actions: params.action ? [params.action] : params.actions,
      includeObservation: params.includeObservation,
      detail: params.detail,
      requestId: params.requestId,
      ...(params.fromTick !== undefined ? { fromTick: params.fromTick } : {}),
      ...(params.targetTick !== undefined ? { targetTick: params.targetTick } : {}),
      epoch: params.epoch,
    }, argsFp);
    if (!res.ok) return res;
    return ok({ step: res.value, result: res.value.actionResults[0] ?? null });
  }

  private rememberRequest(
    key: string, session: string, epoch: number, requestId: string,
    domain: RequestDomain, argsFp: string, response: HarnessResult<StepResultV1>,
  ): void {
    this.requestCache.set(key, { session, epoch, requestId, domain, argsFp, response });
    while (this.requestCache.size > MAX_REQUEST_CACHE) {
      const oldest = this.requestCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.requestCache.delete(oldest);
    }
  }

  private clearSessionRequests(sessionHandle: string): void {
    for (const [key, entry] of this.requestCache) {
      if (entry.session === sessionHandle) this.requestCache.delete(key);
    }
  }

  async executeAdvanced(sessionHandle: string, params: AdvancedParams): Promise<HarnessResult<{ readonly actionId: ActionId; readonly status: string; readonly result?: ActionResultV1 }>> {
    const record = this.record(sessionHandle);
    if (!this.isRecord(record)) return record;
    if (this.mode !== 'dev') return fail('E_PERMISSION', 'advanced actions are dev-only');
    if (!isFiniteInt(params.epoch, 0, 4_294_967_295)) {
      return fail('E_SCHEMA', 'epoch is required and must be an integer in 0..4294967295');
    }
    if (params.epoch !== record.session.epochValue) {
      return fail('E_STALE_EPOCH', 'request epoch is stale; re-read epoch and use a new requestId');
    }
    const opts = {
      ...(params.actionId ? { actionId: params.actionId as ActionId } : {}),
      ...(params.maxTicks !== undefined ? { maxTicks: params.maxTicks } : {}),
      ...(params.maxWallMs !== undefined ? { maxWallMs: params.maxWallMs } : {}),
    };
    let advanced: AdvancedActionHandle;
    switch (params.type) {
      case 'move_to':
        if (!params.target) return fail('E_SCHEMA', 'move_to requires target');
        advanced = record.player.moveTo(params.target, opts);
        break;
      case 'approach':
        if (!params.targetId) return fail('E_SCHEMA', 'approach requires targetId');
        advanced = record.player.approach(params.targetId as never, opts);
        break;
      case 'scan_target':
        advanced = record.player.scanTarget(opts);
        break;
      case 'interact_with':
        if (!params.targetId) return fail('E_SCHEMA', 'interact_with requires targetId');
        advanced = record.player.interactWith(params.targetId as never, opts);
        break;
      case 'wait_until':
        advanced = record.player.waitUntil({ ...opts, ...(params.until ? { until: params.until } : {}) });
        break;
      default:
        return fail('E_NOT_APPLICABLE', 'unknown advanced action');
    }
    const actionId = advanced.actionId;
    this.touch(record, 'advanced', { actionId, type: params.type });
    if (params.wait === false) {
      this.pending.set(`${sessionHandle}:${actionId}`, advanced);
      void advanced.then(() => this.pending.delete(`${sessionHandle}:${actionId}`));
      return ok({ actionId, status: 'started' });
    }
    const res = await advanced;
    this.pending.delete(`${sessionHandle}:${actionId}`);
    if (!res.ok) return fail(res.error.code, res.error.messageKey);
    return ok({ actionId, status: res.value.status, result: res.value });
  }

  cancelAdvanced(sessionHandle: string, actionId: ActionId): HarnessResult<{ readonly actionId: ActionId }> {
    const record = this.record(sessionHandle);
    if (!this.isRecord(record)) return record;
    const res = record.player.cancelAction(actionId);
    this.touch(record, 'cancel', { actionId });
    return res.ok ? ok({ actionId }) : fail(res.error.code, res.error.messageKey);
  }

  // --- dev-only capabilities ----------------------------------------------

  private requireDev<T>(value: T): HarnessResult<T> {
    return this.mode === 'dev' ? ok(value) : fail<T>('E_PERMISSION', 'dev tool is not registered on the player surface');
  }

  saveSnapshot(sessionHandle: string): HarnessResult<SnapshotInfo> {
    const record = this.record(sessionHandle);
    if (!this.isRecord(record)) return record;
    if (this.mode !== 'dev' || !record.test) return fail('E_PERMISSION', 'snapshot is dev/test only');
    const res = record.test.snapshot();
    if (!res.ok) return fail(res.error.code, res.error.messageKey);
    const frame = res.value;
    const sizeBytes = Buffer.byteLength(JSON.stringify(frame), 'utf8');
    const evicted: string[] = [];
    while (this.snapshots.size >= MAX_SNAPSHOTS) {
      const oldest = this.snapshotOrder.shift();
      if (!oldest) break;
      this.snapshots.delete(oldest);
      evicted.push(oldest);
    }
    const snapshotHandle = handle('snapref_');
    const provenance = { kind: record.kind, devTampered: record.session.devTamperedFlag, fixtures: record.session.fixtureAudit.length };
    this.snapshots.set(snapshotHandle, {
      frame, sessionHandle, tick: frame.tick, epoch: frame.epoch,
      ...(frame.stateHash ? { stateHash: frame.stateHash } : {}), sizeBytes, provenance,
    });
    this.snapshotOrder.push(snapshotHandle);
    this.touch(record, 'snapshot', { snapshot: snapshotHandle, sizeBytes });
    return ok({ snapshot: snapshotHandle, tick: frame.tick, epoch: frame.epoch, ...(frame.stateHash ? { stateHash: frame.stateHash } : {}), sizeBytes, provenance, evicted });
  }

  restoreSnapshot(sessionHandle: string, snapshotHandle: string): HarnessResult<{ readonly tick: number; readonly status: string; readonly epoch: number; readonly provenance: SnapshotInfo['provenance'] }> {
    const record = this.record(sessionHandle);
    if (!this.isRecord(record)) return record;
    if (this.mode !== 'dev' || !record.test) return fail('E_PERMISSION', 'restore is dev/test only');
    const entry = this.snapshots.get(snapshotHandle);
    if (!entry) return fail('E_SNAPSHOT_INVALID', 'snapshot handle is unknown or from another process');
    if (entry.sessionHandle !== sessionHandle) return fail('E_SNAPSHOT_INVALID', 'snapshot belongs to a different session');
    const res = record.test.restore(entry.frame);
    this.touch(record, 'restore', { snapshot: snapshotHandle });
    if (!res.ok) return fail(res.error.code, res.error.messageKey);
    this.clearSessionRequests(sessionHandle);
    return ok({ tick: res.value.tick, status: res.value.status, epoch: res.value.epoch, provenance: entry.provenance });
  }

  replay(sessionHandle: string, steps: ReadonlyArray<{ readonly actions?: readonly unknown[]; readonly ticks: number }>): HarnessResult<{ readonly canonicalState: string; readonly canonicalEvents: string }> {
    const record = this.record(sessionHandle);
    if (!this.isRecord(record)) return record;
    if (this.mode !== 'dev' || !record.test) return fail('E_PERMISSION', 'replay is dev/test only');
    const res = record.test.replay(steps);
    this.touch(record, 'replay', { steps: steps.length });
    return res.ok ? ok({ canonicalState: res.value.canonicalState, canonicalEvents: res.value.canonicalEvents }) : fail(res.error.code, res.error.messageKey);
  }

  inspect(sessionHandle: string): HarnessResult<Record<string, unknown>> {
    const record = this.record(sessionHandle);
    if (!this.isRecord(record)) return record;
    if (this.mode !== 'dev') return fail('E_PERMISSION', 'inspect is dev-only');
    const res = record.session.inspectDevState();
    this.touch(record, 'inspect');
    return res.ok ? ok(res.value as unknown as Record<string, unknown>) : fail(res.error.code, res.error.messageKey);
  }

  injectFixture(sessionHandle: string, fixture: DevFixture): HarnessResult<{ readonly epoch: number; readonly tick: number; readonly tampered: true; readonly audit: readonly FixtureAudit[] }> {
    const record = this.record(sessionHandle);
    if (!this.isRecord(record)) return record;
    if (this.mode !== 'dev') return fail('E_PERMISSION', 'fixture is dev/test only');
    const res = record.session.applyDevFixture(fixture);
    this.touch(record, 'fixture', { fixture: (fixture as { kind?: string }).kind ?? 'unknown' });
    if (!res.ok) return fail(res.error.code, res.error.messageKey);
    this.clearSessionRequests(sessionHandle);
    return ok({ epoch: res.value.epoch, tick: res.value.tick, tampered: true, audit: record.session.fixtureAudit });
  }

  loadScenario(scenarioId: string): HarnessResult<{ readonly scenarioId: string; readonly kernelVersion: string; readonly rooms: readonly string[]; readonly strategies: readonly string[] }> {
    if (this.mode !== 'dev') return fail('E_PERMISSION', 'scenario loading is dev-only');
    if (scenarioId !== 'station-zero') return fail('E_NOT_APPLICABLE', 'only the registered Station Zero template is available');
    return ok({ scenarioId: 'station-zero', kernelVersion: 'station-zero-r1-r2@1', rooms: ['station-zero-r1', 'station-zero-r2'], strategies: ['route-a', 'idle'] });
  }

  async runScenario(params: { readonly seed: number; readonly strategy?: string; readonly maxTicks?: number; readonly maxWallMs?: number; readonly maxEvents?: number }): Promise<HarnessResult<RunSummary>> {
    if (this.mode !== 'dev') return fail('E_PERMISSION', 'run_scenario is dev-only');
    if (!isFiniteInt(params.seed, 0, 0xffffffff)) return fail('E_SCHEMA', 'seed must be an integer in 0..0xffffffff');
    const strategy = params.strategy ?? 'route-a';
    if (strategy !== 'route-a' && strategy !== 'idle') return fail('E_NOT_APPLICABLE', 'unknown deterministic strategy');
    const maxTicks = isFiniteInt(params.maxTicks, 1, 1_000_000) ? params.maxTicks : 2000;
    const maxWallMs = isFiniteInt(params.maxWallMs, 1, 3_600_000) ? params.maxWallMs : 15000;
    const maxEvents = isFiniteInt(params.maxEvents, 1, 10000) ? params.maxEvents : 512;
    const startedAt = Date.now();
    // A scenario run occupies a real session slot: it must respect the shared
    // per-process budget and fail cleanly when the process is full.
    let test;
    try {
      test = this.manager.createTestSession({ seed: params.seed });
    } catch (error) {
      const code = (error as { code?: ErrorCodeV1 }).code;
      if (code === 'E_RESOURCE_LIMIT') return fail('E_RESOURCE_LIMIT', 'process session budget exhausted');
      return fail('E_INTERNAL_TRANSACTION', 'scenario session unavailable');
    }
    const session = this.manager.get(test.sessionId);
    if (!session) return fail('E_INTERNAL_TRANSACTION', 'session unavailable');
    const owner = session.ownerHandle();
    owner.start();
    const actorId = session.actorId;
    const runId = handle('run_');
    const trace: RunTraceStep[] = [];
    let tickBudget = maxTicks;
    let done = false;
    let failure: ErrorCodeV1 | null = null;
    let steps = 0;
    const script = strategy === 'idle'
      ? Array.from({ length: 4 }, () => ({ type: null, payload: null, ticks: Math.max(1, Math.floor(maxTicks / 4)) }))
      : ROUTE_A;
    try {
      for (const segment of script) {
        if (done || tickBudget <= 0 || Date.now() - startedAt >= maxWallMs || steps >= MAX_RUN_STEPS) break;
        const ticks = Math.min(segment.ticks, tickBudget);
        const before = session.tickValue;
        const epoch = session.epochValue;
        const actions: ActionRequestV1[] = segment.type && segment.payload
          ? [{
            schema: DTO, protocolVersion: 1, actionId: `aid_${hexChars(12)}` as ActionRequestV1['actionId'],
            actorId, sessionId: session.id as ActionRequestV1['sessionId'],
            epoch, targetTick: before + 1, type: segment.type, payload: segment.payload,
            clientSeq: 0, issuedAtMs: 0, deadlineTick: before + 1,
          }]
          : [];
        const res = session.step({
          schema: DTO, protocolVersion: 1, requestId: `req_${hexChars(12)}` as RequestId,
          sessionId: session.id as StepRequestV1['sessionId'], epoch, fromTick: before, ticks, actions,
          includeObservation: false,
        });
        steps += 1;
        if (!res.ok) { failure = res.error.code; break; }
        tickBudget -= ticks;
        trace.push({ step: steps, tickBefore: before, tickAfter: res.value.toTick, actionCodes: res.value.actionResults.map((r) => r.code), status: res.value.status });
        const summary = session.observe('summary');
        if (summary.ok && (summary.value.current.self.completed || summary.value.current.self.failed)) done = true;
        const events = session.getEvents(0, maxEvents);
        if (events.ok && events.value.total >= maxEvents) break;
        await new Promise<void>((r) => setTimeout(r, 0)); // real yield: other sessions/requests proceed
      }
      const frame = session.snapshot();
      const events = session.getEvents(0, maxEvents);
      const summaryObs = session.observe('summary');
      const self = summaryObs.ok ? summaryObs.value.current.self : null;
      const stateHash = frame.ok ? frame.value.stateHash : undefined;
      const sessionEvents = events.ok ? events.value.events : [];
      const eventsHash = gameplayEventsHash(sessionEvents);
      let snapshotHandle: string | undefined;
      if (frame.ok) {
        const saved = this.saveSnapshotFromFrame(session, frame.value, runId);
        snapshotHandle = saved;
      }
      const finalTick = session.tickValue;
      // close before returning; the snapshot frame is already registered
      owner.close();
      const summary: RunSummary = {
        runId, ok: failure === null && self !== null, ...(failure ? { code: failure } : {}),
        seed: params.seed, strategy, ticks: finalTick, completed: self?.completed ?? false,
        passed: self?.passed ?? false, crossed: self?.crossed ?? false, failed: self?.failed ?? false,
        ...(stateHash ? { stateHash } : {}), ...(eventsHash ? { eventsHash } : {}),
        eventCount: events.ok ? events.value.total : 0,
        ...(snapshotHandle ? { snapshot: snapshotHandle } : {}),
        steps, elapsedMs: Date.now() - startedAt, trace,
        provenance: { dev: true, devTampered: session.devTamperedFlag, fixtures: session.fixtureAudit.length, playerLegal: false },
        stats: { steps, ticks: finalTick, actions: trace.reduce((n, t) => n + t.actionCodes.length, 0), events: events.ok ? events.value.total : 0 },
      };
      this.rememberRun(summary, sessionEvents);
      return ok(summary);
    } catch {
      owner.close();
      return fail('E_INTERNAL_TRANSACTION', 'scenario execution failed');
    }
  }

  private saveSnapshotFromFrame(session: Session, frame: RuntimeSnapshot, runId: string): string | undefined {
    const sizeBytes = Buffer.byteLength(JSON.stringify(frame), 'utf8');
    while (this.snapshots.size >= MAX_SNAPSHOTS) {
      const oldest = this.snapshotOrder.shift();
      if (!oldest) break;
      this.snapshots.delete(oldest);
    }
    const snapshotHandle = handle('snapref_');
    this.snapshots.set(snapshotHandle, {
      frame, sessionHandle: runId, tick: frame.tick, epoch: frame.epoch,
      ...(frame.stateHash ? { stateHash: frame.stateHash } : {}), sizeBytes,
      provenance: { kind: session.kind, devTampered: session.devTamperedFlag, fixtures: session.fixtureAudit.length },
    });
    this.snapshotOrder.push(snapshotHandle);
    return snapshotHandle;
  }

  private rememberRun(summary: RunSummary, events: readonly EventV1[]): void {
    this.runs.set(summary.runId, { summary, events: events.slice(0, 512) });
    this.runOrder.push(summary.runId);
    while (this.runOrder.length > MAX_RUNS) {
      const oldest = this.runOrder.shift();
      if (oldest) this.runs.delete(oldest);
    }
  }

  async runBatch(params: { readonly seeds: readonly number[]; readonly strategy?: string; readonly maxTicks?: number; readonly maxWallMs?: number; readonly maxEvents?: number }): Promise<HarnessResult<readonly RunSummary[]>> {
    if (this.mode !== 'dev') return fail('E_PERMISSION', 'run_batch is dev-only');
    if (!Array.isArray(params.seeds) || params.seeds.length < 1 || params.seeds.length > MAX_BATCH_SEEDS) {
      return fail('E_SCHEMA', `seeds must contain 1..${MAX_BATCH_SEEDS} entries`);
    }
    if (params.seeds.some((s) => !isFiniteInt(s, 0, 0xffffffff))) return fail('E_SCHEMA', 'each seed must be an integer in 0..0xffffffff');
    const results: RunSummary[] = new Array(params.seeds.length);
    let index = 0;
    const worker = async (): Promise<void> => {
      while (index < params.seeds.length) {
        const current = index;
        index += 1;
        try {
          const res = await this.runScenario({
            seed: params.seeds[current], strategy: params.strategy,
            maxTicks: params.maxTicks, maxWallMs: params.maxWallMs, maxEvents: params.maxEvents,
          });
          results[current] = res.ok ? res.value : {
            runId: handle('run_'), ok: false, code: res.code, seed: params.seeds[current], strategy: params.strategy ?? 'route-a',
            ticks: 0, completed: false, passed: false, crossed: false, failed: true, eventCount: 0,
            steps: 0, elapsedMs: 0, trace: [], provenance: { dev: true, devTampered: false, fixtures: 0, playerLegal: false },
            stats: { steps: 0, ticks: 0, actions: 0, events: 0 },
          };
        } catch {
          results[current] = {
            runId: handle('run_'), ok: false, code: 'E_INTERNAL_TRANSACTION', seed: params.seeds[current], strategy: params.strategy ?? 'route-a',
            ticks: 0, completed: false, passed: false, crossed: false, failed: true, eventCount: 0,
            steps: 0, elapsedMs: 0, trace: [], provenance: { dev: true, devTampered: false, fixtures: 0, playerLegal: false },
            stats: { steps: 0, ticks: 0, actions: 0, events: 0 },
          };
        }
      }
    };
    await Promise.all([worker(), worker()]);
    return ok(results);
  }

  compareRuns(runA: string, runB: string): HarnessResult<CompareResult> {
    if (this.mode !== 'dev') return fail('E_PERMISSION', 'compare_runs is dev-only');
    const a = this.runs.get(runA);
    const b = this.runs.get(runB);
    if (!a || !b) return fail('E_NOT_APPLICABLE', 'unknown run handle');
    const sameState = a.summary.stateHash === b.summary.stateHash;
    const evA = gameplayEvents(a.events);
    const evB = gameplayEvents(b.events);
    const sameEvents = canonicalJson(evA) === canonicalJson(evB);
    let firstDivergence: CompareResult['firstDivergence'] = null;
    const n = Math.max(evA.length, evB.length);
    for (let i = 0; i < n; i += 1) {
      const ea = evA[i];
      const eb = evB[i];
      if (!ea || !eb || canonicalJson(ea) !== canonicalJson(eb)) {
        firstDivergence = {
          index: i,
          ...(ea ? { tickA: ea.tick as number, typeA: ea.type as string } : {}),
          ...(eb ? { tickB: eb.tick as number, typeB: eb.type as string } : {}),
        };
        break;
      }
    }
    return ok({
      sameState, sameEvents,
      ...(a.summary.stateHash ? { stateHashA: a.summary.stateHash } : {}),
      ...(b.summary.stateHash ? { stateHashB: b.summary.stateHash } : {}),
      ...(a.summary.eventsHash ? { eventsHashA: a.summary.eventsHash } : {}),
      ...(b.summary.eventsHash ? { eventsHashB: b.summary.eventsHash } : {}),
      eventCountA: a.summary.eventCount, eventCountB: b.summary.eventCount, firstDivergence,
    });
  }

  auditTail(sessionHandle: string, limit = 16): readonly DevAuditEntry[] {
    const record = this.records.get(sessionHandle);
    if (!record || this.mode !== 'dev') return [];
    return record.audit.slice(-Math.max(1, Math.min(limit, MAX_AUDIT)));
  }

  dispose(): void {
    for (const record of [...this.records.values()]) {
      try { record.owner.close(); } catch { /* ignore */ }
    }
    this.records.clear();
    this.snapshots.clear();
    this.snapshotOrder.length = 0;
    this.runs.clear();
    this.runOrder.length = 0;
    this.pending.clear();
    this.requestCache.clear();
    this.manager.dispose();
  }
}
