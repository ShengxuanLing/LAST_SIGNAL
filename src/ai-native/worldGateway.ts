// AI-NATIVE-02 C3-a — World link gateway.
//
// This is a session/authorization/idempotency layer ONLY. It never imports the
// simulation core and never advances ticks. For a rendered session it stores
// the latest post-commit observation and pending PlayerIntents; the browser
// remains the sole authority and must ACK before an action counts as applied.
//
// No token/credential is stored here. Bridge authentication belongs to
// worldBridgeServer.ts; this class only sees an already-authorized handshake.

import { randomBytes } from 'node:crypto';
import {
  WORLD_LIMITS, parseWorldActionBatch, parseWorldObservation, worldActionFingerprint,
  worldBatchFingerprint, type WorldActionBatchV1, type WorldActionV1, type WorldObservationV1
} from './worldProtocol';
import type { ErrorCodeV1 } from './protocol';
import { canonicalJson, payloadFingerprint } from './protocol';

export type WorldSessionStatus = 'connected' | 'yielded' | 'lost' | 'closed';

export interface WorldGatewayError {
  readonly ok: false;
  readonly code: ErrorCodeV1;
  readonly messageKey: string;
  readonly path?: string;
}

export interface WorldSessionView {
  readonly session: string;
  readonly epoch: number;
  readonly status: WorldSessionStatus;
  readonly tick: number | null;
  readonly origin: string;
  readonly lastSeenMs: number;
}

export type WorldActionStatus = 'queued' | 'applied' | 'rejected' | 'expired';
export interface WorldActionReceipt {
  readonly actionId: string;
  readonly status: WorldActionStatus;
  readonly applyByTick: number;
  readonly code?: ErrorCodeV1;
}
export interface WorldBatchReceipt {
  readonly session: string;
  readonly epoch: number;
  readonly requestId: string;
  readonly acceptedTick: number;
  readonly applyByTick: number;
  readonly replayed: boolean;
  readonly actions: readonly WorldActionReceipt[];
}

export interface WorldNextAction {
  readonly session: string;
  readonly epoch: number;
  readonly actionId: string;
  readonly requestId: string;
  readonly applyByTick: number;
  readonly action: WorldActionV1;
}

export interface WorldAcknowledgement {
  readonly session: string;
  readonly epoch: number;
  readonly actionId: string;
  readonly status: 'applied' | 'rejected' | 'expired';
  readonly appliedTick?: number;
  readonly code?: ErrorCodeV1;
}

interface PendingAction {
  readonly actionId: string;
  readonly requestId: string;
  readonly fingerprint: string;
  readonly acceptedTick: number;
  readonly applyByTick: number;
  readonly queuedAtMs: number;
  readonly action: WorldActionV1;
}

interface CachedAction {
  readonly fingerprint: string;
  receipt: WorldActionReceipt;
}

interface CachedRequest {
  readonly fingerprint: string;
  readonly actionIds: readonly string[];
}

interface SessionState {
  readonly session: string;
  epoch: number;
  status: WorldSessionStatus;
  readonly origin: string;
  lastSeenMs: number;
  lastObservation: WorldObservationV1 | null;
  lastObservationFingerprint: string | null;
  /** Hard bound accounting: distinct request/action ids recorded in this session. */
  dedupRecords: number;
  pending: PendingAction[];
  requestCache: Map<string, CachedRequest>;
  actionCache: Map<string, CachedAction>;
  // F2: ids evicted from the bounded idempotency cache stay rejected, so a
  // retried request/action that fell out of the cache can never re-execute.
  evictedRequestIds: Set<string>;
  evictedRequestRing: string[];
  evictedActionIds: Set<string>;
  evictedActionRing: string[];
}

export interface WorldGatewayOptions {
  maxSessions?: number;
  maxPendingActions?: number;
  maxCacheEntries?: number;
  /** Hard per-session bound for request/action dedup records (cache + evicted). */
  maxDedupRecords?: number;
  lostAfterMs?: number;
  sessionIdFactory?: () => string;
}

export class WorldGateway {
  private readonly sessions = new Map<string, SessionState>();
  private readonly maxSessions: number;
  private readonly maxPendingActions: number;
  private readonly maxCacheEntries: number;
  private readonly maxDedupRecords: number;
  private readonly lostAfterMs: number;
  private readonly sessionIdFactory: () => string;

  constructor(options: WorldGatewayOptions = {}) {
    this.maxSessions = options.maxSessions ?? WORLD_LIMITS.MAX_SESSIONS;
    this.maxPendingActions = options.maxPendingActions ?? WORLD_LIMITS.MAX_PENDING_ACTIONS;
    this.maxCacheEntries = options.maxCacheEntries ?? WORLD_LIMITS.MAX_CACHE_ENTRIES;
    this.maxDedupRecords = options.maxDedupRecords ?? WORLD_LIMITS.MAX_DEDUP_RECORDS;
    this.lostAfterMs = options.lostAfterMs ?? WORLD_LIMITS.LOST_AFTER_MS;
    this.sessionIdFactory = options.sessionIdFactory
      ?? (() => `ses_${randomBytes(12).toString('hex')}`);
  }

  /** Human-authorized handshake only; `authorized` must be explicit. */
  linkSession(input: {
    authorized: boolean;
    origin: string;
    nowMs: number;
  }): { ok: true; session: string; epoch: number } | WorldGatewayError {
    if (input.authorized !== true) {
      return { ok: false, code: 'E_PERMISSION', messageKey: 'world.authorization_required' };
    }
    if (this.sessions.size >= this.maxSessions) {
      return { ok: false, code: 'E_RESOURCE_LIMIT', messageKey: 'world.session_limit' };
    }
    const session = this.sessionIdFactory();
    this.sessions.set(session, {
      session,
      epoch: 1,
      status: 'connected',
      origin: input.origin,
      lastSeenMs: input.nowMs,
      lastObservation: null,
      lastObservationFingerprint: null,
      dedupRecords: 0,
      pending: [],
      requestCache: new Map(),
      actionCache: new Map(),
      evictedRequestIds: new Set(),
      evictedRequestRing: [],
      evictedActionIds: new Set(),
      evictedActionRing: []
    });
    return { ok: true, session, epoch: 1 };
  }

  listSessions(): WorldSessionView[] {
    return [...this.sessions.values()].map((s) => ({
      session: s.session,
      epoch: s.epoch,
      status: s.status,
      tick: s.lastObservation?.tick ?? null,
      origin: s.origin,
      lastSeenMs: s.lastSeenMs
    }));
  }

  /** Human re-authorization after YIELDED/LOST; never automatic. */
  authorize(sessionId: string, epoch: number, nowMs: number): { ok: true; epoch: number } | WorldGatewayError {
    const s = this.sessions.get(sessionId);
    if (!s) return this.err('E_SESSION_NOT_FOUND', 'world.session_unknown');
    if (epoch !== s.epoch) return this.err('E_STALE_EPOCH', 'world.stale_epoch');
    if (s.status === 'closed') return this.err('E_SESSION_CLOSED', 'world.session_closed');
    s.status = 'connected';
    s.lastSeenMs = nowMs;
    return { ok: true, epoch: s.epoch };
  }

  pushObservation(sessionId: string, epoch: number, value: unknown, nowMs: number): { ok: true; tick: number } | WorldGatewayError {
    const s = this.sessions.get(sessionId);
    if (!s) return this.err('E_SESSION_NOT_FOUND', 'world.session_unknown');
    if (epoch !== s.epoch) return this.err('E_STALE_EPOCH', 'world.stale_epoch');
    if (s.status !== 'connected') return this.err('E_PERMISSION', 'world.not_authorized');
    const parsed = parseWorldObservation(value);
    if (!parsed.ok) return parsed;
    if (parsed.value.epoch !== epoch) return this.err('E_STALE_EPOCH', 'world.stale_epoch');
    // F1: observations must be monotonic per session/epoch. A stale (lower-tick)
    // observation must not roll back the authoritative white-list state nor
    // extend the action TTL baseline.
    if (s.lastObservation && parsed.value.tick < s.lastObservation.tick) {
      return this.err('E_STALE_TICK', 'world.stale_tick');
    }
    const fingerprint = payloadFingerprint(canonicalJson(parsed.value));
    if (s.lastObservation && parsed.value.tick === s.lastObservation.tick) {
      // Same tick is only idempotent when the committed content is identical.
      // A content conflict must be rejected and must not overwrite the latest
      // authoritative observation (no last-write-wins).
      if (fingerprint === s.lastObservationFingerprint) {
        s.lastSeenMs = nowMs;
        return { ok: true, tick: parsed.value.tick };
      }
      return this.err('E_TICK_CONFLICT', 'world.observation_conflict');
    }
    s.lastObservation = parsed.value;
    s.lastObservationFingerprint = fingerprint;
    s.lastSeenMs = nowMs;
    this.expireByWall(s, nowMs);
    this.expireByTick(s, parsed.value.tick);
    return { ok: true, tick: parsed.value.tick };
  }

  /** Queue-only: this never advances a tick and never claims applied. */
  submitActions(input: {
    sessionId: string;
    epoch: number;
    requestId: string;
    actions: unknown;
    nowMs: number;
  }): WorldBatchReceipt | WorldGatewayError {
    const s = this.sessions.get(input.sessionId);
    if (!s) return this.err('E_SESSION_NOT_FOUND', 'world.session_unknown');
    if (input.epoch !== s.epoch) return this.err('E_STALE_EPOCH', 'world.stale_epoch');
    if (s.status !== 'connected') return this.err('E_PERMISSION', 'world.not_authorized');
    if (!s.lastObservation) return this.err('E_LINK_UNAVAILABLE', 'world.no_observation');
    this.expireByWall(s, input.nowMs);
    const parsed = parseWorldActionBatch(input.actions);
    if (!parsed.ok) return parsed;
    const batch = parsed.value;
    const ttl = batch.ttlTicks ?? WORLD_LIMITS.DEFAULT_TTL_TICKS;
    const acceptedTick = s.lastObservation.tick;
    const applyByTick = acceptedTick + ttl;
    // F2: a request id evicted from the idempotency window is permanently
    // rejected (not re-queued) — retrying it after eviction must not execute.
    if (s.evictedRequestIds.has(input.requestId)) {
      return this.err('E_RETRY_AFTER_EVICTION', 'world.request_evicted');
    }
    const batchFingerprint = worldBatchFingerprint(batch);

    const cachedRequest = s.requestCache.get(input.requestId);
    if (cachedRequest) {
      if (cachedRequest.fingerprint !== batchFingerprint) {
        return this.err('E_ID_PAYLOAD_MISMATCH', 'world.request_payload_mismatch');
      }
      return this.composeReceipt(s, input.requestId, cachedRequest.actionIds, acceptedTick, applyByTick, true);
    }

    // Retries of an already-recorded action must keep returning the eviction
    // rejection even when the session quota is exhausted.
    for (const action of batch.actions) {
      if (s.evictedActionIds.has(action.actionId)) {
        return this.err('E_RETRY_AFTER_EVICTION', 'world.action_evicted');
      }
    }
    // Quota is checked before any batch billing/enqueue. A batch that would
    // exceed the hard per-session dedup bound is rejected atomically; no
    // action is partially queued and no id is partially charged.
    const newActionCount = batch.actions.filter((action) =>
      !s.actionCache.has(action.actionId) && !s.pending.some((p) => p.actionId === action.actionId)
    ).length;
    const newRecordCount = 1 + newActionCount;
    if (s.dedupRecords + newRecordCount > this.maxDedupRecords) {
      return this.err('E_RESOURCE_LIMIT', 'world.session_quota');
    }

    if (s.pending.length + batch.actions.length > this.maxPendingActions) {
      return this.err('E_RESOURCE_LIMIT', 'world.pending_limit');
    }

    const actionIds: string[] = [];
    const replayed: WorldActionReceipt[] = [];
    const toQueue: Array<{ action: WorldActionV1; fingerprint: string }> = [];
    for (const action of batch.actions) {
      const fingerprint = worldActionFingerprint(action);
      if (s.evictedActionIds.has(action.actionId)) {
        return this.err('E_RETRY_AFTER_EVICTION', 'world.action_evicted');
      }
      const cached = s.actionCache.get(action.actionId);
      const pending = s.pending.find((p) => p.actionId === action.actionId);
      if (cached) {
        if (cached.fingerprint !== fingerprint) return this.err('E_ID_PAYLOAD_MISMATCH', 'world.action_payload_mismatch');
        replayed.push({ ...cached.receipt });
        actionIds.push(action.actionId);
        continue;
      }
      if (pending) {
        if (pending.fingerprint !== fingerprint) return this.err('E_ID_PAYLOAD_MISMATCH', 'world.action_payload_mismatch');
        replayed.push({ actionId: action.actionId, status: 'queued', applyByTick: pending.applyByTick });
        actionIds.push(action.actionId);
        continue;
      }
      actionIds.push(action.actionId);
      toQueue.push({ action, fingerprint });
    }

    for (const entry of toQueue) {
      s.pending.push({
        actionId: entry.action.actionId,
        requestId: input.requestId,
        fingerprint: entry.fingerprint,
        acceptedTick,
        applyByTick,
        queuedAtMs: input.nowMs,
        action: entry.action
      });
      s.actionCache.set(entry.action.actionId, {
        fingerprint: entry.fingerprint,
        receipt: { actionId: entry.action.actionId, status: 'queued', applyByTick }
      });
    }
    this.trimCache(s, s.requestCache, 'request');
    s.requestCache.set(input.requestId, { fingerprint: batchFingerprint, actionIds });
    this.trimCache(s, s.requestCache, 'request');
    // Charge the accepted new ids only after the whole batch has been queued.
    s.dedupRecords += 1 + toQueue.length;
    const receipt = this.composeReceipt(s, input.requestId, actionIds, acceptedTick, applyByTick, false);
    if (replayed.length > 0) {
      // queued action cache is already reflected by composeReceipt.
    }
    return receipt;
  }

  nextAction(input: {
    sessionId: string;
    epoch: number;
    afterActionId?: string;
    nowMs: number;
  }): WorldNextAction | null | WorldGatewayError {
    const s = this.sessions.get(input.sessionId);
    if (!s) return this.err('E_SESSION_NOT_FOUND', 'world.session_unknown');
    if (input.epoch !== s.epoch) return this.err('E_STALE_EPOCH', 'world.stale_epoch');
    if (s.status !== 'connected') return this.err('E_PERMISSION', 'world.not_authorized');
    s.lastSeenMs = input.nowMs;
    this.expireByWall(s, input.nowMs);
    this.expireByTick(s, s.lastObservation?.tick ?? 0);
    const start = input.afterActionId
      ? Math.max(0, s.pending.findIndex((p) => p.actionId === input.afterActionId) + 1)
      : 0;
    const pending = s.pending[start];
    if (!pending) return null;
    return {
      session: s.session,
      epoch: s.epoch,
      actionId: pending.actionId,
      requestId: pending.requestId,
      applyByTick: pending.applyByTick,
      action: pending.action
    };
  }

  ackAction(input: {
    sessionId: string;
    epoch: number;
    requestId: string;
    actionId: string;
    result: 'applied' | 'rejected';
    appliedTick?: number;
    code?: ErrorCodeV1;
    nowMs: number;
  }): WorldAcknowledgement | WorldGatewayError {
    const s = this.sessions.get(input.sessionId);
    if (!s) return this.err('E_SESSION_NOT_FOUND', 'world.session_unknown');
    if (input.epoch !== s.epoch) return this.err('E_STALE_EPOCH', 'world.stale_epoch');
    if (s.status !== 'connected') return this.err('E_PERMISSION', 'world.not_authorized');
    const cached = s.actionCache.get(input.actionId);
    if (cached && cached.receipt.status !== 'queued') {
      return {
        session: s.session, epoch: s.epoch, actionId: input.actionId,
        status: cached.receipt.status as 'applied' | 'rejected' | 'expired',
        ...(cached.receipt.code ? { code: cached.receipt.code } : {})
      };
    }
    this.expireByWall(s, input.nowMs);
    const index = s.pending.findIndex((p) => p.actionId === input.actionId);
    if (index < 0) return this.err('E_ACTION_EXPIRED', 'world.action_unknown');
    const pending = s.pending[index];
    if (pending.requestId !== input.requestId) return this.err('E_ID_PAYLOAD_MISMATCH', 'world.request_payload_mismatch');
    if (input.result === 'applied' && finalTickInvalid(input.appliedTick)) {
      return this.err('E_SCHEMA', 'world.applied_tick_invalid');
    }
    // F3: a fake ACK cannot claim an appliedTick below the accepted tick or
    // above applyByTick. The browser is the authority, but the contract bounds
    // what a plausible ACK may assert.
    if (input.result === 'applied' && input.appliedTick! < pending.acceptedTick) {
      return this.err('E_SCHEMA', 'world.applied_tick_invalid');
    }
    if (input.result === 'applied' && input.appliedTick! > pending.applyByTick) {
      s.pending.splice(index, 1);
      const expired: WorldActionReceipt = {
        actionId: pending.actionId, status: 'expired', applyByTick: pending.applyByTick,
        code: 'E_ACTION_EXPIRED'
      };
      this.recordActionCache(s, pending.actionId, pending.fingerprint, expired);
      this.trimCache(s, s.actionCache, 'action');
      return {
        session: s.session, epoch: s.epoch, actionId: input.actionId,
        status: 'expired', code: 'E_ACTION_EXPIRED'
      };
    }
    s.pending.splice(index, 1);
    s.lastSeenMs = input.nowMs;
    const status = input.result === 'applied' ? 'applied' : 'rejected';
    const receipt: WorldActionReceipt = {
      actionId: input.actionId,
      status,
      applyByTick: pending.applyByTick,
      ...(input.code ? { code: input.code } : {})
    };
    this.recordActionCache(s, input.actionId, pending.fingerprint, receipt);
    this.trimCache(s, s.actionCache, 'action');
    return {
      session: s.session,
      epoch: s.epoch,
      actionId: input.actionId,
      status,
      ...(input.appliedTick !== undefined ? { appliedTick: input.appliedTick } : {}),
      ...(input.code ? { code: input.code } : {})
    };
  }

  heartbeat(sessionId: string, epoch: number, nowMs: number): { ok: true } | WorldGatewayError {
    const s = this.sessions.get(sessionId);
    if (!s) return this.err('E_SESSION_NOT_FOUND', 'world.session_unknown');
    if (epoch !== s.epoch) return this.err('E_STALE_EPOCH', 'world.stale_epoch');
    if (s.status === 'closed') return this.err('E_SESSION_CLOSED', 'world.session_closed');
    s.lastSeenMs = nowMs;
    return { ok: true };
  }

  /** Human takeover / pause / explicit stop: invalidate all old actions. */
  yieldSession(sessionId: string, epoch: number, reason: string, nowMs: number): { ok: true; epoch: number } | WorldGatewayError {
    const s = this.sessions.get(sessionId);
    if (!s) return this.err('E_SESSION_NOT_FOUND', 'world.session_unknown');
    if (epoch !== s.epoch) return this.err('E_STALE_EPOCH', 'world.stale_epoch');
    if (s.status === 'closed') return this.err('E_SESSION_CLOSED', 'world.session_closed');
    s.epoch += 1;
    s.status = 'yielded';
    s.lastSeenMs = nowMs;
    s.pending = [];
    // YIELD must retain the dedup records (so an old request cannot execute in
    // the next epoch) without allowing the id sets to grow past the quota.
    // Move cache records into the evicted sets; the total count is unchanged.
    this.archiveCaches(s);
    s.lastObservation = null;
    s.lastObservationFingerprint = null;
    // reason is metadata only; never echoed to Player actions.
    void reason;
    return { ok: true, epoch: s.epoch };
  }

  closeSession(sessionId: string, nowMs: number): { ok: true; session: string } | WorldGatewayError {
    const s = this.sessions.get(sessionId);
    if (!s) return this.err('E_SESSION_NOT_FOUND', 'world.session_unknown');
    s.status = 'closed';
    s.lastSeenMs = nowMs;
    s.pending = [];
    s.requestCache.clear();
    s.actionCache.clear();
    this.sessions.delete(sessionId);
    return { ok: true, session: sessionId };
  }

  /** Missing heartbeat => LOST; no auto reconnect, no automatic control. */
  reapExpired(nowMs: number): string[] {
    const lost: string[] = [];
    for (const s of this.sessions.values()) {
      if (s.status !== 'connected') continue;
      if (nowMs - s.lastSeenMs <= this.lostAfterMs) continue;
      s.status = 'lost';
      s.epoch += 1;
      s.pending = [];
      // LOST retains dedup records for the same reason as YIELD.
      this.archiveCaches(s);
      s.lastObservation = null;
      s.lastObservationFingerprint = null;
      lost.push(s.session);
    }
    return lost;
  }

  sessionOrigin(sessionId: string): string | null {
    const s = this.sessions.get(sessionId);
    return s ? s.origin : null;
  }

  dispose(): void {
    for (const s of this.sessions.values()) {
      s.status = 'closed';
      s.pending = [];
      s.requestCache.clear();
      s.actionCache.clear();
    }
    this.sessions.clear();
  }

  private expireByWall(s: SessionState, nowMs: number): void {
    const still: PendingAction[] = [];
    for (const p of s.pending) {
      if (nowMs - p.queuedAtMs > WORLD_LIMITS.MAX_ACTION_WALL_MS) {
        this.recordActionCache(s, p.actionId, p.fingerprint, {
          actionId: p.actionId, status: 'expired', applyByTick: p.applyByTick, code: 'E_ACTION_EXPIRED'
        });
      } else still.push(p);
    }
    s.pending = still;
    this.trimCache(s, s.actionCache, 'action');
  }

  private expireByTick(s: SessionState, tick: number): void {
    const still: PendingAction[] = [];
    for (const p of s.pending) {
      if (tick > p.applyByTick) {
        this.recordActionCache(s, p.actionId, p.fingerprint, {
          actionId: p.actionId, status: 'expired', applyByTick: p.applyByTick, code: 'E_ACTION_EXPIRED'
        });
      } else still.push(p);
    }
    s.pending = still;
    this.trimCache(s, s.actionCache, 'action');
  }

  private composeReceipt(
    s: SessionState,
    requestId: string,
    actionIds: readonly string[],
    acceptedTick: number,
    applyByTick: number,
    replayed: boolean
  ): WorldBatchReceipt {
    return {
      session: s.session,
      epoch: s.epoch,
      requestId,
      acceptedTick,
      applyByTick,
      replayed,
      actions: actionIds.map((id) => {
        const cached = s.actionCache.get(id);
        return cached?.receipt ?? { actionId: id, status: 'queued', applyByTick };
      })
    };
  }

  private archiveCaches(s: SessionState): void {
    for (const requestId of [...s.requestCache.keys()]) this.recordEviction(s, 'request', requestId);
    for (const actionId of [...s.actionCache.keys()]) this.recordEviction(s, 'action', actionId);
    s.requestCache.clear();
    s.actionCache.clear();
  }

  private trimCache<T>(s: SessionState, cache: Map<string, T>, kind: 'request' | 'action'): void {
    while (cache.size > this.maxCacheEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
      this.recordEviction(s, kind, oldest as string);
    }
  }

  private recordActionCache(s: SessionState, id: string, fingerprint: string, receipt: WorldActionReceipt): void {
    // If this action id was evicted while still pending, re-adding its receipt
    // must move it back (not duplicate it) so cache+evicted stays one record.
    s.evictedActionIds.delete(id);
    s.actionCache.set(id, { fingerprint, receipt });
  }

  private recordEviction(s: SessionState, kind: 'request' | 'action', id: string): void {
    const set = kind === 'request' ? s.evictedRequestIds : s.evictedActionIds;
    const ring = kind === 'request' ? s.evictedRequestRing : s.evictedActionRing;
    // An id that left the bounded idempotency cache must stay rejected for the
    // rest of the session, so this set is not capped by maxCacheEntries. Its
    // total is bounded by the per-session maxDedupRecords quota instead.
    // The ring is kept only as a bounded audit trail.
    if (!set.has(id)) {
      set.add(id);
      ring.push(id);
      if (ring.length > this.maxCacheEntries * 4) ring.shift();
    }
  }

  private err(code: ErrorCodeV1, messageKey: string): WorldGatewayError {
    return { ok: false, code, messageKey };
  }
}

function finalTickInvalid(value: number | undefined): boolean {
  return value === undefined || !Number.isInteger(value) || value < 0;
}
