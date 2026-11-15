// AI-NATIVE-02 P3-b — Companion facet (pure module).
//
// This is the ONLY surface an external LLM may use for the ECHO companion:
//   echo_observe / echo_suggest / echo_status / bounded memory.
// It deliberately has NO confirm, NO owner action, NO player step, NO Dev tool.
// The human owner confirms inside the real game UI; this module cannot execute
// anything, cannot read hidden state, and cannot manufacture its own authority.
//
// It reuses the existing C3 budget/shape conventions (WORLD_LIMITS / ECHO_LIMITS)
// so the later gateway/bridge adapter is a thin transport, not a second protocol.

import { randomBytes } from 'node:crypto';
import { AI_NATIVE_LIMITS_V1, type ErrorCodeV1 } from './protocol';
import { WORLD_LIMITS } from './worldProtocol';
import { ECHO_LIMITS, type EchoView } from './echo';

export const COMPANION_SCHEMA = 'last_signal.companion.v1' as const;
export const COMPANION_ACTOR_ID = 1 as const;

export const COMPANION_LIMITS = Object.freeze({
  /** Bounded memory: entries and TTL, same numbers as the P3-a echo controller. */
  MEMORY_ENTRIES: ECHO_LIMITS.memoryEntries,
  MEMORY_TTL_TICKS: ECHO_LIMITS.memoryTtlTicks,
  /** Unconfirmed suggestions are a small queue, never a replay buffer. */
  MAX_UNCONFIRMED: 8,
  SUGGESTION_TTL_TICKS: WORLD_LIMITS.MAX_TTL_TICKS,
  DEFAULT_SUGGESTION_TTL_TICKS: WORLD_LIMITS.DEFAULT_TTL_TICKS,
  /** Monotonic session-wide id budget; the same hard bound the C3 gateway uses. */
  MAX_DEDUP_RECORDS: WORLD_LIMITS.MAX_DEDUP_RECORDS,
  PERCEPTION_TILES: ECHO_LIMITS.perceptionTiles,
  MAX_OBSERVED_ACTORS: WORLD_LIMITS.MAX_OBSERVATION_DRONES,
  MAX_COORDINATE_ABS: AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS
});

export const COMPANION_REASONS = Object.freeze([
  'perceived_hostile', 'perceived_relay', 'no_perceived_target', 'objective_blocked'
] as const);
export type CompanionReason = (typeof COMPANION_REASONS)[number];

export const COMPANION_SUGGESTION_KINDS = Object.freeze([
  'move', 'aim', 'fire', 'scan', 'jam'
] as const);
export type CompanionSuggestionKind = (typeof COMPANION_SUGGESTION_KINDS)[number];

export type CompanionOwnerMode = 'human' | 'ai' | 'external';
export type CompanionLinkState = 'connected' | 'fallback';
export type CompanionFallbackLabel = 'NO_MODEL' | null;

export const COMPANION_ID_PATTERN = /^sug_[0-9a-f]{24}$/;

export interface CompanionObservationView extends EchoView {
  /** Stale-epoch guard: the adapter passes the gateway's current epoch. */
  epoch: number;
  /** Echo-only observed device (absent when not perceived). */
  relay?: { id: string; x: number; y: number; state: string };
  /** Echo-only observed objective flag; never hidden state. */
  objectiveBlocked?: boolean;
  /** The echo's OWN resource account (separate from the player's). */
  energy?: { current: number; max: number };
  cooldowns?: { scanTicks: number; jamTicks: number };
}

export interface CompanionMemoryEntry {
  tick: number;
  kind: 'drone' | 'relay';
  id: number | string;
  x: number;
  y: number;
}

export interface CompanionObservation {
  schema: typeof COMPANION_SCHEMA;
  epoch: number;
  tick: number;
  echo: { x: number; y: number; hp: number; maxHp: number; aimYaw: number };
  player: { x: number; y: number };
  drones: Array<{ id: number; x: number; y: number; hp: number }>;
  relay: { id: string; x: number; y: number; state: string } | null;
  objectiveBlocked: boolean;
  energy?: { current: number; max: number };
  cooldowns?: { scanTicks: number; jamTicks: number };
  memory: CompanionMemoryEntry[];
}

export interface CompanionSuggestionInput {
  suggestionId?: string;
  kind: CompanionSuggestionKind;
  reason: CompanionReason;
  target?: { x: number; y: number };
  confidence?: number;
  ttlTicks?: number;
}

export interface CompanionSuggestion {
  schema: typeof COMPANION_SCHEMA;
  session: string;
  epoch: number;
  suggestionId: string;
  actorId: typeof COMPANION_ACTOR_ID;
  kind: CompanionSuggestionKind;
  reason: CompanionReason;
  target: { x: number; y: number } | null;
  confidence: number | null;
  createdAtTick: number;
  expiresAtTick: number;
  /** Always 'proposed': only the human owner can move it forward. */
  status: 'proposed';
}

export interface CompanionStatus {
  schema: typeof COMPANION_SCHEMA;
  session: string;
  epoch: number;
  actorId: typeof COMPANION_ACTOR_ID;
  role: 'COMPANION';
  link: CompanionLinkState;
  fallbackLabel: CompanionFallbackLabel;
  ownerMode: CompanionOwnerMode;
  readOnly: boolean;
  lastObservationTick: number | null;
  memoryEntries: number;
  pendingSuggestions: number;
  dedupRecords: number;
  dedupLimit: number;
}

export type CompanionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCodeV1; readonly messageKey: string };

function ok<T>(value: T): CompanionResult<T> { return { ok: true, value }; }
function fail<T>(code: ErrorCodeV1, messageKey: string): CompanionResult<T> {
  return { ok: false, code, messageKey };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function cloneAndFreeze<T>(value: T): T {
  return deepFreeze(JSON.parse(JSON.stringify(value)) as T);
}

function finiteCoordinate(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.x === 'number' && Number.isFinite(v.x) && Math.abs(v.x) <= COMPANION_LIMITS.MAX_COORDINATE_ABS
    && typeof v.y === 'number' && Number.isFinite(v.y) && Math.abs(v.y) <= COMPANION_LIMITS.MAX_COORDINATE_ABS;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A reason is legal only when the CURRENT observation actually shows it. */
function reasonObserved(reason: CompanionReason, obs: CompanionObservation): boolean {
  switch (reason) {
    case 'perceived_hostile': return obs.drones.length > 0;
    case 'perceived_relay': return obs.relay !== null;
    case 'no_perceived_target': return obs.drones.length === 0 && obs.relay === null;
    case 'objective_blocked': return obs.objectiveBlocked === true;
  }
}

export interface CompanionFacetOptions {
  readonly session: string;
  readonly epoch: number;
  /** Deterministic id source for tests; production default is `sug_<24hex>`. */
  readonly suggestionIdFactory?: () => string;
  readonly maxUnconfirmed?: number;
  readonly maxDedupRecords?: number;
}

/**
 * Pure companion capability. It holds only bounded memory and unconfirmed
 * suggestions; it has no executor and no confirmation path.
 */
export class CompanionFacet {
  readonly session: string;
  private currentEpoch: number;
  private readonly suggestionIdFactory: () => string;
  private readonly maxUnconfirmed: number;
  private readonly maxDedupRecords: number;

  private ownerMode: CompanionOwnerMode = 'human';
  private link: CompanionLinkState = 'connected';
  private fallbackLabel: CompanionFallbackLabel = null;

  private memoryValue: CompanionMemoryEntry[] = [];
  private lastObservation: CompanionObservation | null = null;
  private lastObservationTick: number | null = null;

  private readonly suggestions = new Map<string, { suggestion: CompanionSuggestion; fingerprint: string }>();
  /** Every accepted id ever (monotonic budget): replay vs mismatch is decidable. */
  private readonly seen = new Map<string, string>();
  private readonly evicted = new Set<string>();
  private dedupRecords = 0;

  constructor(options: CompanionFacetOptions) {
    this.session = options.session;
    this.currentEpoch = options.epoch;
    this.suggestionIdFactory = options.suggestionIdFactory
      ?? (() => `sug_${randomBytes(12).toString('hex')}`);
    this.maxUnconfirmed = options.maxUnconfirmed ?? COMPANION_LIMITS.MAX_UNCONFIRMED;
    this.maxDedupRecords = options.maxDedupRecords ?? COMPANION_LIMITS.MAX_DEDUP_RECORDS;
  }

  get epoch(): number { return this.currentEpoch; }
  get memory(): readonly CompanionMemoryEntry[] { return cloneAndFreeze(this.memoryValue); }

  /** `echo_observe`: only the echo's own perception; never hidden state. */
  observe(view: CompanionObservationView): CompanionResult<CompanionObservation> {
    if (view.epoch !== this.currentEpoch) return fail('E_STALE_EPOCH', 'companion.stale_epoch');
    if (!Number.isFinite(view.tick) || view.tick < 0) return fail('E_SCHEMA', 'companion.tick_invalid');
    if (this.lastObservationTick !== null && view.tick < this.lastObservationTick) {
      return fail('E_STALE_TICK', 'companion.stale_tick');
    }
    const center = { x: view.echo.x, y: view.echo.y };
    const drones = view.drones
      .filter((drone) => drone.hp > 0 && distance(center, drone) <= COMPANION_LIMITS.PERCEPTION_TILES)
      .slice(0, COMPANION_LIMITS.MAX_OBSERVED_ACTORS)
      .map((drone) => ({ id: drone.id, x: drone.x, y: drone.y, hp: drone.hp }));
    const relay = view.relay && distance(center, view.relay) <= COMPANION_LIMITS.PERCEPTION_TILES
      ? { id: view.relay.id, x: view.relay.x, y: view.relay.y, state: view.relay.state }
      : null;
    const observed: CompanionObservation = {
      schema: COMPANION_SCHEMA,
      epoch: view.epoch,
      tick: view.tick,
      echo: {
        x: view.echo.x, y: view.echo.y, hp: view.echo.hp,
        maxHp: view.echo.maxHp, aimYaw: view.echo.aimYaw
      },
      player: { x: view.player.x, y: view.player.y },
      drones,
      relay,
      objectiveBlocked: view.objectiveBlocked === true,
      ...(view.energy ? { energy: { current: view.energy.current, max: view.energy.max } } : {}),
      ...(view.cooldowns ? { cooldowns: { scanTicks: view.cooldowns.scanTicks, jamTicks: view.cooldowns.jamTicks } } : {}),
      memory: []
    };
    this.recordMemory(view.tick, drones, relay);
    observed.memory = this.memoryValue.map((entry) => ({ ...entry }));
    this.lastObservation = cloneAndFreeze(observed);
    this.lastObservationTick = view.tick;
    this.advanceTo(view.tick);
    return ok(cloneAndFreeze(observed));
  }

  /** `echo_suggest`: propose only. It never executes and cannot confirm itself. */
  suggest(input: CompanionSuggestionInput): CompanionResult<CompanionSuggestion & { replayed: boolean }> {
    if (this.link !== 'connected') return fail('E_LINK_UNAVAILABLE', 'companion.link_fallback');
    if (this.ownerMode !== 'human') return fail('E_PERMISSION', 'companion.owner_mode_readonly');
    if (!this.lastObservation) return fail('E_LINK_UNAVAILABLE', 'companion.no_observation');
    this.advanceTo(this.lastObservation.tick);

    const kind = input.kind;
    if (!(COMPANION_SUGGESTION_KINDS as readonly string[]).includes(kind)) {
      return fail('E_SCHEMA', 'companion.kind_invalid');
    }
    if (!(COMPANION_REASONS as readonly string[]).includes(input.reason)) {
      return fail('E_SCHEMA', 'companion.reason_invalid');
    }
    if (!reasonObserved(input.reason, this.lastObservation)) {
      return fail('E_SCHEMA', 'companion.reason_unobserved');
    }
    if (input.confidence !== undefined &&
        (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) ||
         input.confidence < 0 || input.confidence > 1)) {
      return fail('E_SCHEMA', 'companion.confidence_invalid');
    }
    if (input.target !== undefined && !finiteCoordinate(input.target)) {
      return fail('E_SCHEMA', 'companion.target_invalid');
    }
    // A suggestion must stay inside the echo's own perception: no blind orders.
    if (input.target && distance(this.lastObservation.echo, input.target) > COMPANION_LIMITS.PERCEPTION_TILES) {
      return fail('E_ILLEGAL_TARGET', 'companion.target_unperceived');
    }
    const ttl = input.ttlTicks ?? COMPANION_LIMITS.DEFAULT_SUGGESTION_TTL_TICKS;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > COMPANION_LIMITS.SUGGESTION_TTL_TICKS) {
      return fail('E_SCHEMA', 'companion.ttl_invalid');
    }

    const suggestionId = input.suggestionId ?? this.suggestionIdFactory();
    if (!COMPANION_ID_PATTERN.test(suggestionId)) return fail('E_SCHEMA', 'companion.suggestion_id_invalid');

    const createdAtTick = this.lastObservation.tick;
    const candidate: CompanionSuggestion = cloneAndFreeze({
      schema: COMPANION_SCHEMA,
      session: this.session,
      epoch: this.currentEpoch,
      suggestionId,
      actorId: COMPANION_ACTOR_ID,
      kind,
      reason: input.reason,
      target: input.target ? { x: input.target.x, y: input.target.y } : null,
      confidence: input.confidence ?? null,
      createdAtTick,
      expiresAtTick: createdAtTick + ttl,
      status: 'proposed'
    });
    const fingerprint = JSON.stringify({ kind, reason: input.reason, target: candidate.target, ttl });

    // Idempotent retry / hard eviction / payload mismatch, same rules as C3.
    if (this.evicted.has(suggestionId)) return fail('E_RETRY_AFTER_EVICTION', 'companion.suggestion_evicted');
    const seenFingerprint = this.seen.get(suggestionId);
    if (seenFingerprint !== undefined) {
      if (seenFingerprint !== fingerprint) return fail('E_ID_PAYLOAD_MISMATCH', 'companion.suggestion_payload_mismatch');
      const live = this.suggestions.get(suggestionId);
      if (!live) return fail('E_RETRY_AFTER_EVICTION', 'companion.suggestion_evicted');
      return ok({ ...live.suggestion, replayed: true });
    }
    // Capacity is checked BEFORE any record is written; never evict-and-execute.
    if (this.suggestions.size + 1 > this.maxUnconfirmed) {
      return fail('E_RESOURCE_LIMIT', 'companion.suggestion_limit');
    }
    if (this.dedupRecords + 1 > this.maxDedupRecords) {
      return fail('E_RESOURCE_LIMIT', 'companion.dedup_limit');
    }

    this.seen.set(suggestionId, fingerprint);
    this.dedupRecords += 1;
    this.suggestions.set(suggestionId, { suggestion: candidate, fingerprint });
    return ok({ ...candidate, replayed: false });
  }

  /** `echo_status`: bounded, truthful link/owner state (never a fake connected). */
  status(): CompanionStatus {
    return cloneAndFreeze({
      schema: COMPANION_SCHEMA,
      session: this.session,
      epoch: this.currentEpoch,
      actorId: COMPANION_ACTOR_ID,
      role: 'COMPANION' as const,
      link: this.link,
      fallbackLabel: this.fallbackLabel,
      ownerMode: this.ownerMode,
      readOnly: this.ownerMode !== 'human',
      lastObservationTick: this.lastObservationTick,
      memoryEntries: this.memoryValue.length,
      pendingSuggestions: this.suggestions.size,
      dedupRecords: this.dedupRecords,
      dedupLimit: this.maxDedupRecords
    });
  }

  /** Read-only view for the owner UI; it is NOT a confirmation surface. */
  pendingSuggestions(): readonly CompanionSuggestion[] {
    return cloneAndFreeze([...this.suggestions.values()].map((entry) => entry.suggestion));
  }

  /** Tick-driven expiry only; no timers, no auto-reconnect, no auto-takeover. */
  advanceTo(tick: number): void {
    if (!Number.isFinite(tick)) return;
    const cutoff = tick - COMPANION_LIMITS.MEMORY_TTL_TICKS;
    this.memoryValue = this.memoryValue.filter((entry) => entry.tick >= cutoff);
    if (this.memoryValue.length > COMPANION_LIMITS.MEMORY_ENTRIES) {
      this.memoryValue = this.memoryValue.slice(-COMPANION_LIMITS.MEMORY_ENTRIES);
    }
    for (const [id, entry] of [...this.suggestions]) {
      if (tick >= entry.suggestion.expiresAtTick) {
        this.suggestions.delete(id);
        this.evicted.add(id);
      }
    }
  }

  /**
   * Explicit owner/link changes. A fallback/disconnect cancels every unconfirmed
   * suggestion; it never reconnects or takes over by itself.
   */
  setLink(link: CompanionLinkState): void {
    this.link = link;
    this.fallbackLabel = link === 'connected' ? null : 'NO_MODEL';
    if (link !== 'connected') this.cancelUnconfirmed();
  }

  setOwnerMode(mode: CompanionOwnerMode): void {
    if (mode === this.ownerMode) return;
    this.ownerMode = mode;
    // AI/External protagonist control is mutually exclusive with companion
    // authority: a later confirm must not execute a suggestion proposed earlier.
    if (mode !== 'human') this.cancelUnconfirmed();
  }

  /** Stale epoch (reconnect/takeover) invalidates every unconfirmed proposal. */
  rebindEpoch(epoch: number): void {
    if (epoch === this.currentEpoch) return;
    this.currentEpoch = epoch;
    this.cancelUnconfirmed();
  }

  private cancelUnconfirmed(): void {
    for (const id of this.suggestions.keys()) this.evicted.add(id);
    this.suggestions.clear();
  }

  private recordMemory(
    tick: number,
    drones: ReadonlyArray<{ id: number; x: number; y: number }>,
    relay: { id: string; x: number; y: number } | null
  ): void {
    for (const drone of drones) {
      this.memoryValue.push({ tick, kind: 'drone', id: drone.id, x: drone.x, y: drone.y });
    }
    if (relay) this.memoryValue.push({ tick, kind: 'relay', id: relay.id, x: relay.x, y: relay.y });
    const cutoff = tick - COMPANION_LIMITS.MEMORY_TTL_TICKS;
    this.memoryValue = this.memoryValue.filter((entry) => entry.tick >= cutoff);
    if (this.memoryValue.length > COMPANION_LIMITS.MEMORY_ENTRIES) {
      this.memoryValue = this.memoryValue.slice(-COMPANION_LIMITS.MEMORY_ENTRIES);
    }
  }
}
