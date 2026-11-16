// AI-NATIVE-02 P3-b A — Companion gateway (bounded suggestion/dedup/epoch).
//
// This is a TRANSPORT-SIDE owner of `CompanionFacet` per session. It reuses the
// C3 `WorldGateway` session/epoch and `AgentLeaseRegistry` (in the bridge),
// not a second protocol. Agent routes can only OBSERVE / SUGGEST; confirmations
// are a browser-only route that RECORDS a decision. The browser then enqueues
// the legal core command locally; this module never executes anything.

import { WorldGateway } from './worldGateway';
import {
  COMPANION_LIMITS, CompanionFacet, COMPANION_ID_PATTERN, validateOwnerDecision,
  type CompanionObservation, type CompanionObservationView,
  type CompanionOwnerMode, type CompanionSuggestion, type CompanionSuggestionKind,
  type CompanionReason
} from './companionFacet';
import type { ErrorCodeV1 } from './protocol';

export interface CompanionGatewayError {
  readonly ok: false;
  readonly code: ErrorCodeV1;
  readonly messageKey: string;
}
type Result<T> = { readonly ok: true; readonly value: T } | CompanionGatewayError;
const err = <T>(code: ErrorCodeV1, messageKey: string): Result<T> => ({ ok: false, code, messageKey });
const bad = (code: ErrorCodeV1, messageKey: string): CompanionGatewayError => ({ ok: false, code, messageKey });

export interface CompanionDecisionRecord {
  readonly suggestionId: string;
  readonly decision: 'confirm' | 'reject';
  readonly epoch: number;
  readonly decidedAtTick: number;
  readonly applied: boolean;
  /** Real post-commit tick, set only by markApplied. */
  readonly appliedTick: number | null;
}

/** Read-only truthful receipt for one suggestion (no Owner secret). */
export interface CompanionReceipt {
  readonly suggestionId: string;
  readonly status: 'confirmed' | 'rejected' | 'applied' | 'expired' | 'cancelled';
  /** Present when the suggestion was retired without a human decision. */
  readonly reason?: 'room_changed' | 'expired';
  readonly decidedAtTick: number | null;
  readonly appliedTick: number | null;
}

interface CompanionSession {
  readonly facet: CompanionFacet;
  readonly decisions: Map<string, CompanionDecisionRecord>;
  observation: CompanionObservation | null;
  ownerMode: CompanionOwnerMode;
  /** Monotonic request-id dedup (hard 512 bound), separated from facet ids. */
  readonly requests: Map<string, { suggestionId: string; fingerprint: string }>;
  requestRecords: number;
}

export interface CompanionSuggestInput {
  readonly session: string;
  readonly epoch: number;
  readonly requestId: string;
  readonly suggestionId: string;
  readonly kind: CompanionSuggestionKind;
  readonly reason: CompanionReason;
  readonly target?: { x: number; y: number };
  readonly confidence?: number;
  readonly ttlTicks?: number;
}

export class CompanionGateway {
  private readonly sessions = new Map<string, CompanionSession>();

  constructor(private readonly gateway: WorldGateway) {}

  private session(sessionId: string, epoch: number): CompanionSession | CompanionGatewayError {
    const view = this.gateway.listSessions().find((s) => s.session === sessionId);
    if (!view) return bad('E_SESSION_NOT_FOUND', 'world.session_unknown');
    if (view.epoch !== epoch) return bad('E_STALE_EPOCH', 'world.stale_epoch');
    if (view.status !== 'connected') return bad('E_PERMISSION', 'world.not_authorized');
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created: CompanionSession = {
      facet: new CompanionFacet({ session: sessionId, epoch }),
      decisions: new Map(),
      observation: null,
      ownerMode: 'human',
      requests: new Map(),
      requestRecords: 0
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  /**
   * Human AUTHORIZE inside the real game (renderer-only route). A
   * re-authorization atomically invalidates the previous owner's unconfirmed
   * work and published observation before the bridge issues a NEW capability.
   */
  authorize(sessionId: string, epoch: number, ownerMode: CompanionOwnerMode, reauthorize = false): Result<{ session: string; epoch: number }> {
    const s = this.session(sessionId, epoch);
    if ('ok' in s && s.ok === false) return s;
    const state = s as CompanionSession;
    if (reauthorize) {
      state.facet.reauthorize(epoch);
      state.observation = null;
      state.decisions.clear();
      state.requests.clear();
      state.requestRecords = 0;
    }
    state.ownerMode = ownerMode;
    state.facet.setOwnerMode(ownerMode);
    state.facet.setLink('connected');
    return { ok: true, value: { session: sessionId, epoch } };
  }

  /** Browser pushes the echo's own cropped observation (renderer-only route). */
  pushObservation(sessionId: string, epoch: number, value: unknown): Result<CompanionObservation> {
    const s = this.session(sessionId, epoch);
    if ('ok' in s && s.ok === false) return s;
    const state = s as CompanionSession;
    const view = value as CompanionObservationView;
    if (!view || typeof view !== 'object' || !Number.isFinite(view.tick) ||
        !view.echo || !view.player || !Array.isArray(view.drones)) {
      return err('E_SCHEMA', 'companion.observation_invalid');
    }
    // Server-side allowlist: no seed/map/RNG/hidden fields may enter.
    const allowedTop = new Set(['epoch', 'tick', 'echo', 'player', 'drones', 'targets', 'relay', 'objectiveBlocked', 'energy', 'cooldowns', 'schema', 'perception']);
    for (const key of Object.keys(view)) if (!allowedTop.has(key)) return err('E_SCHEMA', 'companion.observation_invalid');
    const observed = state.facet.observe({ ...view, epoch });
    if (!observed.ok) return err(observed.code, observed.messageKey);
    state.observation = observed.value;
    return { ok: true, value: observed.value };
  }

  /** `echo_observe` (agent). */
  observe(sessionId: string, epoch: number): Result<CompanionObservation> {
    const s = this.session(sessionId, epoch);
    if ('ok' in s && s.ok === false) return s;
    const state = s as CompanionSession;
    if (!state.observation) return err('E_LINK_UNAVAILABLE', 'companion.no_observation');
    return { ok: true, value: state.observation };
  }

  /** `echo_suggest` (agent): propose only, bounded dedup, TTL and epoch. */
  suggest(input: CompanionSuggestInput): Result<{ suggestion: CompanionSuggestion; replayed: boolean; requestId: string }> {
    const s = this.session(input.session, input.epoch);
    if ('ok' in s && s.ok === false) return s;
    const state = s as CompanionSession;
    // A proposal retired by a room change stays retired: replaying its request
    // (or reusing its id) can never resurrect it, and the reason is explicit.
    // This gate runs BEFORE the observation gate so the agent learns the real
    // reason instead of a generic "no observation".
    if (state.facet.roomCancellation(input.suggestionId) === 'room_changed') {
      return err('E_STALE_GENERATION', 'companion.suggestion_room_changed');
    }
    if (!state.observation) return err('E_LINK_UNAVAILABLE', 'companion.no_observation');
    state.facet.advanceTo(state.observation.tick);
    if (!COMPANION_ID_PATTERN.test(input.suggestionId)) return err('E_SCHEMA', 'companion.suggestion_id_invalid');
    if (!/^req_[0-9a-f]{24}$/.test(input.requestId)) return err('E_SCHEMA', 'companion.request_id_invalid');
    if (state.decisions.has(input.suggestionId)) return err('E_RETRYABLE', 'companion.decision_exists');
    const fingerprint = JSON.stringify({
      kind: input.kind, reason: input.reason, target: input.target ?? null,
      confidence: input.confidence ?? null, ttlTicks: input.ttlTicks ?? null
    });
    const cached = state.requests.get(input.requestId);
    if (cached !== undefined) {
      if (cached.suggestionId !== input.suggestionId || cached.fingerprint !== fingerprint) {
        return err('E_ID_PAYLOAD_MISMATCH', 'companion.request_payload_mismatch');
      }
      const live = state.facet.pendingSuggestions().find((p) => p.suggestionId === input.suggestionId);
      if (!live) return err('E_RETRY_AFTER_EVICTION', 'companion.suggestion_evicted');
      return { ok: true, value: { suggestion: live, replayed: true, requestId: input.requestId } };
    }
    if (state.requestRecords >= COMPANION_LIMITS.MAX_DEDUP_RECORDS) {
      return err('E_RESOURCE_LIMIT', 'companion.dedup_limit');
    }
    const proposed = state.facet.suggest({
      suggestionId: input.suggestionId,
      kind: input.kind,
      reason: input.reason,
      target: input.target,
      confidence: input.confidence,
      ttlTicks: input.ttlTicks
    });
    if (!proposed.ok) return err(proposed.code, proposed.messageKey);
    if (cached === undefined) {
      state.requests.set(input.requestId, { suggestionId: input.suggestionId, fingerprint });
      state.requestRecords += 1;
    }
    return { ok: true, value: { suggestion: proposed.value, replayed: false, requestId: input.requestId } };
  }

  /** `echo_status` / `echo_memory` (agent, bounded). */
  /** Truthful status: `pending` is only the UNDECIDED proposals, and the
   *  read-only `receipts` report the real production ledger (confirmed /
   *  rejected / applied / expired) with real ticks. No Owner secret. */
  status(sessionId: string, epoch: number): Result<{
    status: ReturnType<CompanionFacet['status']>;
    pending: readonly CompanionSuggestion[];
    receipts: readonly CompanionReceipt[];
  }> {
    const s = this.session(sessionId, epoch);
    if ('ok' in s && s.ok === false) return s;
    const state = s as CompanionSession;
    const pending = state.facet.pendingSuggestions().filter((p) => !state.decisions.has(p.suggestionId));
    const base = state.facet.status();
    const cancelledIds = new Set(state.facet.cancelledSuggestionIds());
    const receipts: CompanionReceipt[] = [
      ...[...state.decisions.values()].map((d): CompanionReceipt => ({
        suggestionId: d.suggestionId,
        status: d.applied ? 'applied' : d.decision === 'confirm' ? 'confirmed' : 'rejected',
        decidedAtTick: d.decidedAtTick,
        appliedTick: d.appliedTick
      })),
      ...[...cancelledIds]
        .filter((id) => !state.decisions.has(id))
        .map((id): CompanionReceipt => ({
          suggestionId: id, status: 'cancelled', reason: 'room_changed', decidedAtTick: null, appliedTick: null
        })),
      ...state.facet.expiredSuggestionIds()
        .filter((id) => !state.decisions.has(id) && !cancelledIds.has(id))
        .map((id): CompanionReceipt => ({
          suggestionId: id, status: 'expired', reason: 'expired', decidedAtTick: null, appliedTick: null
        }))
    ];
    return { ok: true, value: { status: { ...base, pendingSuggestions: pending.length }, pending, receipts } };
  }

  /**
   * Browser-only mutation: the rendered game COMMITTED a room change.
   * Everything proposed in the previous room is cancelled with a real
   * tombstone, the published observation is dropped (the agent must observe the
   * new room before proposing again) and the generation is bumped. Same-room
   * repeats are idempotent, so pause/resume never cancels a live proposal.
   */
  roomChanged(sessionId: string, epoch: number, roomId: number, tick: number): Result<{
    cancelled: readonly string[]; generation: number; roomId: number;
  }> {
    const s = this.session(sessionId, epoch);
    if ('ok' in s && s.ok === false) return s;
    const state = s as CompanionSession;
    if (!Number.isInteger(roomId) || roomId < 0) return err('E_SCHEMA', 'companion.room_invalid');
    if (!Number.isFinite(tick) || tick < 0) return err('E_SCHEMA', 'companion.tick_invalid');
    const generationBefore = state.facet.currentGeneration;
    // A decision that was confirmed but never reached a core tick belongs to the
    // room it was made in: cancel it (and tombstone it) instead of letting a
    // late markApplied/applied receipt report a phantom execution.
    const confirmedUnapplied = [...state.decisions.entries()]
      .filter(([, record]) => record.applied !== true)
      .map(([id]) => id);
    for (const id of confirmedUnapplied) state.decisions.delete(id);
    const outcome = state.facet.applyRoomChange(roomId, tick, confirmedUnapplied);
    // A REAL change (generation bumped) invalidates the published observation;
    // an idempotent same-room notification leaves it untouched.
    if (outcome.generation !== generationBefore) state.observation = null;
    return { ok: true, value: { cancelled: outcome.cancelled, generation: outcome.generation, roomId } };
  }

  /** Browser-only: list unconfirmed proposals for the human UI. */
  pending(sessionId: string, epoch: number): Result<readonly CompanionSuggestion[]> {
    const s = this.session(sessionId, epoch);
    if ('ok' in s && s.ok === false) return s;
    const state = s as CompanionSession;
    if (state.observation) state.facet.advanceTo(state.observation.tick);
    return { ok: true, value: state.facet.pendingSuggestions().filter((p) => !state.decisions.has(p.suggestionId)) };
  }

  /**
   * Browser-only confirmation. Records a post-commit fact; it does NOT enqueue
   * a core command (the browser does that locally with its owner capability).
   * An agent token or a forged Origin can never reach this method: the bridge
   * exposes it only on the Origin-checked renderer route.
   */
  decide(input: { session: string; epoch: number; suggestionId: string; decision: 'confirm' | 'reject'; tick: number; maxEpochSeen?: number }): Result<CompanionDecisionRecord> {
    const s = this.session(input.session, input.epoch);
    if ('ok' in s && s.ok === false) return s;
    const state = s as CompanionSession;
    // Shared pure validator: identical rules to CompanionOwnerLedger. The
    // suggestion is read BEFORE advanceTo so an expired proposal reports
    // E_ACTION_EXPIRED instead of being silently reclassified.
    const validated = validateOwnerDecision(input, {
      status: state.facet.status(),
      suggestion: state.facet.pendingSuggestions().find((p) => p.suggestionId === input.suggestionId),
      alreadyDecided: state.decisions.has(input.suggestionId),
      maxEpochSeen: input.maxEpochSeen ?? input.epoch,
      roomCancelled: state.facet.roomCancellation(input.suggestionId) === 'room_changed'
    });
    if (!validated.ok) return err(validated.code, validated.messageKey);
    state.facet.advanceTo(input.tick);
    const record: CompanionDecisionRecord = Object.freeze({
      suggestionId: input.suggestionId,
      decision: validated.value.decision,
      epoch: input.epoch,
      decidedAtTick: validated.value.decidedAtTick,
      applied: false,
      appliedTick: null
    });
    state.decisions.set(input.suggestionId, record);
    return { ok: true, value: record };
  }

  /**
   * Post-commit receipt. Only a CONFIRM that really reached the core tick may
   * become applied; a rejected decision can never be reported as executed.
   */
  markApplied(sessionId: string, suggestionId: string, appliedTick: number): Result<CompanionDecisionRecord> {
    const state = this.sessions.get(sessionId);
    if (state && state.facet.roomCancellation(suggestionId) === 'room_changed') {
      return err('E_STALE_GENERATION', 'companion.suggestion_room_changed');
    }
    const record = state?.decisions.get(suggestionId);
    if (!state || !record) return err('E_TARGET_DESTROYED', 'companion.decision_unknown');
    if (record.decision !== 'confirm') return err('E_PERMISSION', 'companion.decision_not_confirmed');
    if (record.applied) return err('E_RETRYABLE', 'companion.decision_already_applied');
    if (!Number.isInteger(appliedTick) || appliedTick < record.decidedAtTick) {
      return err('E_STALE_TICK', 'companion.applied_tick_invalid');
    }
    const updated = { ...record, applied: true, appliedTick };
    state.decisions.set(suggestionId, updated);
    return { ok: true, value: updated };
  }

  /** Owner mode change (AI/External protagonist control => read-only). */
  setOwnerMode(sessionId: string, epoch: number, ownerMode: CompanionOwnerMode): Result<{ readOnly: boolean }> {
    const s = this.session(sessionId, epoch);
    if ('ok' in s && s.ok === false) return s;
    const state = s as CompanionSession;
    state.ownerMode = ownerMode;
    state.facet.setOwnerMode(ownerMode);
    return { ok: true, value: { readOnly: ownerMode !== 'human' } };
  }

  /** Lease expiry / disconnect: cancel ALL unconfirmed work, explicit fallback. */
  disconnect(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.facet.setLink('fallback');
    state.observation = null;
    state.decisions.clear();
    state.requests.clear();
    state.requestRecords = 0;
  }

  onLeaseExpired(sessionId: string): void { this.disconnect(sessionId); }

  close(sessionId: string): void { this.sessions.delete(sessionId); }

  stats(): { sessions: number; pending: number; decisions: number } {
    let pending = 0;
    let decisions = 0;
    for (const s of this.sessions.values()) {
      pending += s.facet.pendingSuggestions().length;
      decisions += s.decisions.size;
    }
    return { sessions: this.sessions.size, pending, decisions };
  }
}
