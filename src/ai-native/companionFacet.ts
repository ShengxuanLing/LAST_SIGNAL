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

import { AI_NATIVE_LIMITS_V1, type ErrorCodeV1 } from './protocol';
import { WORLD_LIMITS } from './worldProtocol';
import { isEchoObservation, ECHO_OBSERVATION_SCHEMA } from '../world/echoView';
import { ECHO_LIMITS, type EchoView } from './echo';

import { SIGNAL_TUNING } from '../signal/signalTuning';

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
  'move', 'aim', 'fire', 'scan', 'jam', 'toggle-relay'
] as const);
export type CompanionSuggestionKind = (typeof COMPANION_SUGGESTION_KINDS)[number];

export type CompanionOwnerMode = 'human' | 'ai' | 'external';
export type CompanionLinkState = 'connected' | 'fallback';
export type CompanionFallbackLabel = 'NO_MODEL' | null;

/** Perception may contain a target at <=12 tiles, but jam needs STRICT <6.
 *  Availability honours the echo's CURRENT energy/cooldowns AND the perceived
 *  Signal device: scan/jam legitimately apply to the relay too (that is how the
 *  real cooperation chain opens the exit), so the status must not claim
 *  "out_of_range" when the relay is right next to the echo. */
export function companionAvailableActions(observation: CompanionObservation | null): Array<{
  kind: CompanionSuggestionKind; available: boolean; reason: string;
}> {
  const hostiles = [...(observation?.drones ?? []), ...((observation as unknown as { targets?: unknown[] })?.targets ?? [])] as Array<{ x: number; y: number }>;
  const center = observation?.echo ?? { x: 0, y: 0 };
  const nearestHostile = hostiles.reduce((best, actor) => Math.min(best, Math.hypot(actor.x - center.x, actor.y - center.y)), Infinity);
  const relay = observation?.relay ?? null;
  const relayDistance = relay ? Math.hypot(relay.x - center.x, relay.y - center.y) : Infinity;
  const hostileScanRange = Number.isFinite(nearestHostile) && nearestHostile < COMPANION_LIMITS.PERCEPTION_TILES;
  const relayScanRange = relayDistance < COMPANION_LIMITS.PERCEPTION_TILES;
  const hostileJamRange = Number.isFinite(nearestHostile) && nearestHostile < 6;
  const relayJamRange = relayDistance < 6;
  const inScanRange = hostileScanRange || relayScanRange;
  const inJamRange = hostileJamRange || relayJamRange;
  const energy = observation?.energy?.current;
  const scanTicks = observation?.cooldowns?.scanTicks ?? 0;
  const jamTicks = observation?.cooldowns?.jamTicks ?? 0;
  const scanBlock = scanTicks > 0
    ? 'cooldown'
    : typeof energy === 'number' && energy < SIGNAL_TUNING.SCAN_COST ? 'insufficient_energy' : null;
  const jamBlock = jamTicks > 0
    ? 'cooldown'
    : typeof energy === 'number' && energy < SIGNAL_TUNING.JAM_COST ? 'insufficient_energy' : null;
  const scanReason = !inScanRange
    ? 'out_of_range'
    : (scanBlock ?? (relayScanRange && !hostileScanRange ? 'perceived_relay' : 'perceived_target'));
  const jamReason = !inJamRange ? 'out_of_range' : (jamBlock ?? 'in_jam_range');
  return [
    { kind: 'scan', available: inScanRange && scanBlock === null, reason: scanReason },
    { kind: 'jam', available: inJamRange && jamBlock === null, reason: jamReason }
  ];
}

/** Browser + Node safe entropy (no node:crypto, so the rendered bundle works). */
function randomHex(bytes = 12): string {
  const values = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(values);
  return [...values].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export const COMPANION_ID_PATTERN = /^sug_[0-9a-f]{24}$/;

export interface CompanionObservationView extends EchoView {
  /** Stale-epoch guard: the adapter passes the gateway's current epoch. */
  epoch: number;
  /** Crop attestation produced by buildEchoObservation (survives JSON). */
  schema?: typeof ECHO_OBSERVATION_SCHEMA;
  perception?: {
    center: { x: number; y: number };
    radiusTiles: number;
    requiresExplored: true;
    requiresLineOfSight: true;
  };
  targets?: ReadonlyArray<{ id: number; kind: string; x: number; y: number; hp: number; isBoss: boolean }>;
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
  /** `target` = a cropped non-drone enemy (kind preserved in the id);
   *  `relay` = the perceived Signal device. Never conflate the two. */
  kind: 'drone' | 'relay' | 'target';
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
  /** Echo-perceived non-drone / Boss public state (bounded, no hidden). */
  targets: Array<{ id: number; kind: string; x: number; y: number; hp: number; isBoss: boolean }>;
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
  availableActions: ReturnType<typeof companionAvailableActions>;
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
      ?? (() => `sug_${randomHex()}`);
    this.maxUnconfirmed = options.maxUnconfirmed ?? COMPANION_LIMITS.MAX_UNCONFIRMED;
    this.maxDedupRecords = options.maxDedupRecords ?? COMPANION_LIMITS.MAX_DEDUP_RECORDS;
  }

  get epoch(): number { return this.currentEpoch; }
  get memory(): readonly CompanionMemoryEntry[] { return cloneAndFreeze(this.memoryValue); }

  /** `echo_observe`: only the echo's own perception; never hidden state. */
  observe(view: CompanionObservationView): CompanionResult<CompanionObservation> {
    // Only a REAL cropped echo observation may be recorded; a raw sim/EchoView
    // without the crop attestation (or with hidden fields) is rejected.
    const { epoch: _epoch, ...cropped } = view;
    const attested = { ...cropped, drones: view.drones, targets: view.targets ?? [] };
    if (!isEchoObservation(attested)) return fail('E_SCHEMA', 'companion.observation_not_cropped');
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
      targets: (view.targets ?? []).map((target) => ({
        id: target.id, kind: target.kind, x: target.x, y: target.y, hp: target.hp, isBoss: target.isBoss
      })),
      relay,
      objectiveBlocked: view.objectiveBlocked === true,
      ...(view.energy ? { energy: { current: view.energy.current, max: view.energy.max } } : {}),
      ...(view.cooldowns ? { cooldowns: { scanTicks: view.cooldowns.scanTicks, jamTicks: view.cooldowns.jamTicks } } : {}),
      memory: []
    };
    this.recordMemory(view.tick, drones, relay, view.targets ?? []);
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

  /** Diagnostic snapshot (no restore: policy authority must never be re-armed). */
  snapshot(): CompanionSnapshot {
    return cloneAndFreeze({
      schema: COMPANION_SCHEMA,
      session: this.session,
      epoch: this.currentEpoch,
      actorId: COMPANION_ACTOR_ID,
      link: this.link,
      fallbackLabel: this.fallbackLabel,
      ownerMode: this.ownerMode,
      lastObservationTick: this.lastObservationTick,
      memory: this.memoryValue.map((entry) => ({ ...entry })),
      pending: [...this.suggestions.values()].map((entry) => entry.suggestion),
      dedupRecords: this.dedupRecords,
      dedupLimit: this.maxDedupRecords,
      suggestionLimit: this.maxUnconfirmed,
      suggestionTtlTicks: COMPANION_LIMITS.SUGGESTION_TTL_TICKS,
      memoryTtlTicks: COMPANION_LIMITS.MEMORY_TTL_TICKS
    });
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
      dedupLimit: this.maxDedupRecords,
      availableActions: companionAvailableActions(this.lastObservation)
    });
  }

  /** Read-only view for the owner UI; it is NOT a confirmation surface. */
  pendingSuggestions(): readonly CompanionSuggestion[] {
    return cloneAndFreeze([...this.suggestions.values()].map((entry) => entry.suggestion));
  }

  /** Read-only ids that can no longer be confirmed (TTL expiry or cancellation).
   *  Used ONLY to aggregate truthful status receipts; it never re-arms a
   *  decision or changes the dedup semantics. */
  expiredSuggestionIds(): readonly string[] {
    return Object.freeze([...this.evicted]);
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

  /**
   * Human re-authorization: atomically drop the previous authority's
   * unconfirmed work and published observation. The new session capability is
   * issued by the bridge in the SAME request, so an old capability cannot
   * consume a proposal after the swap.
   */
  reauthorize(epoch: number): void {
    if (epoch !== this.currentEpoch) return;
    this.cancelUnconfirmed();
    this.lastObservation = null;
    this.lastObservationTick = null;
  }

  cancelUnconfirmed(): void {
    for (const id of this.suggestions.keys()) this.evicted.add(id);
    this.suggestions.clear();
  }

  private recordMemory(
    tick: number,
    drones: ReadonlyArray<{ id: number; x: number; y: number }>,
    relay: { id: string; x: number; y: number } | null,
    targets: ReadonlyArray<{ id: number; kind: string; x: number; y: number }>
  ): void {
    for (const drone of drones) {
      this.memoryValue.push({ tick, kind: 'drone', id: drone.id, x: drone.x, y: drone.y });
    }
    for (const target of targets) {
      this.memoryValue.push({ tick, kind: 'target', id: `target_${target.id}_${target.kind}`, x: target.x, y: target.y });
    }
    if (relay) this.memoryValue.push({ tick, kind: 'relay', id: relay.id, x: relay.x, y: relay.y });
    const cutoff = tick - COMPANION_LIMITS.MEMORY_TTL_TICKS;
    this.memoryValue = this.memoryValue.filter((entry) => entry.tick >= cutoff);
    if (this.memoryValue.length > COMPANION_LIMITS.MEMORY_ENTRIES) {
      this.memoryValue = this.memoryValue.slice(-COMPANION_LIMITS.MEMORY_ENTRIES);
    }
  }
}

// ---------------------------------------------------------------------------
// Owner decision contract (NO exported factory, NO exported symbol)
// ---------------------------------------------------------------------------

/**
 * The browser-only Owner controller injects this validator. It closes over a
 * private WeakSet of exact object identities minted by the human UI. There is
 * deliberately NO public `createOwnerCapability` here: shared modules, MCP,
 * gateway and bridge cannot construct an owner proof. Spread, Object.create,
 * symbol copying and JSON round-trips all fail the WeakSet identity check.
 */
export type OwnerAuthorityValidator = (proof: unknown) => boolean;

export interface OwnerDecision {
  readonly suggestionId: string;
  readonly decision: 'confirm' | 'reject';
  readonly session: string;
  readonly epoch: number;
  readonly actorId: typeof COMPANION_ACTOR_ID;
  readonly decidedAtTick: number;
}

/** Owner-only decision ledger: records a human decision, never executes. */
export class CompanionOwnerLedger {
  private readonly decisions = new Map<string, OwnerDecision>();
  private maxEpochSeen = 0;

  constructor(
    private readonly facet: CompanionFacet,
    private readonly isOwner: OwnerAuthorityValidator
  ) {
    this.maxEpochSeen = facet.status().epoch;
  }

  decide(input: {
    capability: unknown;
    suggestionId: string;
    decision: 'confirm' | 'reject';
    epoch: number;
    tick: number;
  }): CompanionResult<OwnerDecision> {
    if (!this.isOwner(input.capability)) {
      return fail('E_PERMISSION', 'companion.owner_capability_required');
    }
    const decided = validateOwnerDecision({ ...input, session: this.facet.session }, {
      status: this.facet.status(),
      suggestion: this.facet.pendingSuggestions().find((p) => p.suggestionId === input.suggestionId),
      alreadyDecided: this.decisions.has(input.suggestionId),
      maxEpochSeen: this.maxEpochSeen
    });
    if (!decided.ok) return decided;
    this.decisions.set(input.suggestionId, decided.value);
    this.maxEpochSeen = Math.max(this.maxEpochSeen, input.epoch);
    return decided;
  }

  list(): readonly OwnerDecision[] { return Object.freeze([...this.decisions.values()]); }
}

/**
 * ONE pure validator shared by CompanionOwnerLedger AND CompanionGateway.
 * It is the only place that decides whether a human confirmation is legal:
 * strict enum, current/monotonic epoch, connected human mode, tick bounds,
 * TTL, no duplicate execution. No transport may reimplement this logic.
 */
export function validateOwnerDecision(
  input: { suggestionId: string; decision: unknown; epoch: unknown; tick: unknown; session: string },
  context: {
    readonly status: CompanionStatus;
    readonly suggestion: CompanionSuggestion | undefined;
    readonly alreadyDecided: boolean;
    readonly maxEpochSeen: number;
  }
): CompanionResult<OwnerDecision> {
  if (input.decision !== 'confirm' && input.decision !== 'reject') {
    return fail('E_SCHEMA', 'companion.decision_invalid');
  }
  if (typeof input.suggestionId !== 'string' || !COMPANION_ID_PATTERN.test(input.suggestionId)) {
    return fail('E_SCHEMA', 'companion.suggestion_id_invalid');
  }
  if (!Number.isInteger(input.epoch)) return fail('E_STALE_EPOCH', 'companion.stale_epoch');
  const epoch = input.epoch as number;
  if (epoch !== context.status.epoch || epoch < context.maxEpochSeen) {
    return fail('E_STALE_EPOCH', 'companion.stale_epoch');
  }
  if (context.status.link !== 'connected') return fail('E_LINK_UNAVAILABLE', 'companion.link_fallback');
  if (context.status.ownerMode !== 'human' || context.status.readOnly) {
    return fail('E_PERMISSION', 'companion.owner_mode_readonly');
  }
  if (!Number.isFinite(input.tick) || (input.tick as number) < 0) return fail('E_SCHEMA', 'companion.tick_invalid');
  const tick = input.tick as number;
  if (context.alreadyDecided) return fail('E_RETRYABLE', 'companion.decision_exists');
  const suggestion = context.suggestion;
  if (!suggestion) return fail('E_TARGET_DESTROYED', 'companion.suggestion_expired');
  if (tick >= suggestion.expiresAtTick) return fail('E_ACTION_EXPIRED', 'companion.suggestion_expired');
  if (tick < suggestion.createdAtTick) return fail('E_STALE_TICK', 'companion.tick_before_creation');
  return ok(Object.freeze({
    suggestionId: input.suggestionId,
    decision: input.decision,
    session: input.session,
    epoch,
    actorId: COMPANION_ACTOR_ID,
    decidedAtTick: tick
  }));
}

/** Diagnostic snapshot: necessary state only, never hidden state or auth. */
export interface CompanionSnapshot {
  readonly schema: typeof COMPANION_SCHEMA;
  readonly session: string;
  readonly epoch: number;
  readonly actorId: typeof COMPANION_ACTOR_ID;
  readonly link: CompanionLinkState;
  readonly fallbackLabel: CompanionFallbackLabel;
  readonly ownerMode: CompanionOwnerMode;
  readonly lastObservationTick: number | null;
  readonly memory: readonly CompanionMemoryEntry[];
  readonly pending: readonly CompanionSuggestion[];
  readonly dedupRecords: number;
  readonly dedupLimit: number;
  readonly suggestionLimit: number;
  readonly suggestionTtlTicks: number;
  readonly memoryTtlTicks: number;
}
