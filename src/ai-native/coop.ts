/**
 * AI-NATIVE-01 / P5 — isolated minimal ECHO co-op runtime (tightened contract).
 *
 * ISOLATED test scenario (`echo-coop-test`), not the formal story/world. Hard
 * boundaries:
 *  - ONE authoritative `SliceModel` and ONE shared tick; no second game per
 *    actor, no clone, no `__testSetPosition`, no fixture faking an ECHO action;
 *  - Human and ECHO act only through shared capability entries
 *    (`SliceModel.scanFrom` / `jamFrom` / `canStandAt`,
 *    `sharedCore.stepMovementAt` / `resolveTransitions`);
 *  - ECHO sees only its OWN position/range/LOS evidence plus evidence the human
 *    explicitly shared through a REAL field whitelist (unselected fields are not
 *    projected at all; empty/unknown fields are rejected);
 *  - the COMPANION handle is actor-scoped: it never returns human private
 *    position/goal/evidence/memory;
 *  - hypotheses are deep-cloned and deep-frozen; an unconfirmed/rejected plan has
 *    ZERO side effects and external mutation cannot change a confirmed action;
 *  - the isolated coop snapshot is signed by this instance and fully validated
 *    before ANY state is touched (atomic); the Player save schema is untouched.
 */
import { randomBytes } from 'node:crypto';
import { SliceModel, SLICE, type ActionResult } from '../slice/rules';
import { isFullSliceState, type SliceEvidenceV1, type FullRoomId } from '../slice/fullState';
import {
  NO_MOVEMENT, resolveTransitions, stepMovementAt, directionToIntent,
  type MovementDirection, type MovementIntent,
} from '../slice/sharedCore';
import {
  AI_NATIVE_OBSERVATION_SCHEMA_V1, AI_NATIVE_PROTOCOL_VERSION,
  validateObservationDetailed, hasHiddenField, canonicalJson, payloadFingerprint,
  type ObservationV1, type ObservationEvidenceV1, type ActionCapabilityV1, type ErrorCodeV1,
} from './protocol';

export const COOP_SCHEMA = 'last_signal.ai-native.echo-coop-snapshot.v1' as const;
export const COOP_VERSION = 1 as const;
export const COOP_SCENARIO = 'echo-coop-test' as const;
export const COOP_ROOM_ID = 'station-zero-r1' as const;

export type CoopActorKind = 'human' | 'echo';
export type ShareField = 'relationId' | 'stateLabel' | 'position';
const SHARE_FIELDS: readonly ShareField[] = Object.freeze(['relationId', 'stateLabel', 'position']);

export interface CoopFixture {
  readonly test: true;
  readonly human: { readonly x: number; readonly y: number };
  readonly echo: { readonly x: number; readonly y: number };
}

export type CoopResponse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCodeV1; readonly messageKey: string };

function coopOk<T>(value: T): CoopResponse<T> { return { ok: true, value }; }
function coopFail<T>(code: ErrorCodeV1, messageKey: string): CoopResponse<T> { return { ok: false, code, messageKey }; }

function deepClone<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

export interface CoopMemoryEntry {
  readonly kind: 'scan' | 'share' | 'hypothesis' | 'confirm' | 'reject' | 'action' | 'device';
  readonly tick: number;
  readonly detail: string;
  readonly confidence?: number;
}

export type CoopPlan =
  | { readonly kind: 'scan' }
  | { readonly kind: 'move'; readonly direction: MovementDirection; readonly ticks: number }
  | { readonly kind: 'jam' }
  | { readonly kind: 'share'; readonly targetIds: readonly string[] };

export interface CoopHypothesis {
  readonly id: `hyp_${string}`;
  readonly statement: string;
  readonly confidence: number;
  readonly uncertainty: number;
  readonly basedOn: readonly string[];
  readonly status: 'proposed' | 'confirmed' | 'rejected';
  readonly proposedAtTick: number;
  readonly action: CoopPlan;
}

export interface CoopEvent {
  readonly tick: number;
  readonly actor: CoopActorKind;
  readonly kind: string;
  readonly detail: string;
}

/** A field-trimmed projection of evidence at the moment it was shared. */
export interface SharedEvidenceProjection {
  readonly targetId: string;
  readonly observedAtTick: number;
  readonly expiresAtTick: number;
  readonly roomId: FullRoomId;
  readonly sourceActionId?: string;
  readonly observerActorId?: string;
  readonly relationId?: string | null;
  readonly stateLabel?: string;
  readonly position?: { readonly x: number; readonly y: number };
}
export interface SharedEvidence {
  readonly projection: SharedEvidenceProjection;
  readonly sharedBy: string;
  readonly sharedAtTick: number;
  readonly fields: readonly ShareField[];
}

export interface CoopActorState {
  readonly actorId: string;
  readonly role: 'PLAYER' | 'COMPANION';
  position: { x: number; y: number };
  sensorRange: number;
  goal: string | null;
  memory: CoopMemoryEntry[];
  evidence: SliceEvidenceV1[];
  shared: SharedEvidence[];
}

export interface CoopStatus {
  readonly scenario: typeof COOP_SCENARIO;
  readonly testFixture: boolean;
  readonly tick: number;
  readonly epoch: number;
  readonly paused: boolean;
  readonly takenOver: boolean;
  readonly echoCancelled: boolean;
  readonly echoLinkLost: boolean;
  readonly echoBudget: number;
  readonly human: { actorId: string; position: { x: number; y: number }; goal: string | null; evidenceTargets: string[]; sharedTargets: string[]; memory: number };
  readonly echo: { actorId: string; position: { x: number; y: number }; goal: string | null; evidenceTargets: string[]; sharedTargets: string[]; memory: number; hypotheses: Array<{ id: string; status: string; statement: string }> };
}

/** Actor-scoped status for the COMPANION handle: no human private fields. */
export interface EchoStatus {
  readonly scenario: typeof COOP_SCENARIO;
  readonly testFixture: boolean;
  readonly tick: number;
  readonly epoch: number;
  readonly paused: boolean;
  readonly takenOver: boolean;
  readonly echoCancelled: boolean;
  readonly echoLinkLost: boolean;
  readonly echoBudget: number;
  readonly humanActorId: string;
  readonly echo: { actorId: string; position: { x: number; y: number }; sensorRange: number; goal: string | null; evidenceTargets: string[]; sharedTargets: string[]; memory: number; hypotheses: Array<{ id: string; status: string; statement: string }> };
}

const MAX_MEMORY = 64;
const MAX_SHARED = 32;
const MAX_EVENTS = 256;
const ECHO_BUDGET_DEFAULT = 12;
const MAX_ISSUED = 64;

function hex24(seed: number, salt: number): string {
  // FNV-1a over the seed/salt bytes, then 24 hex nibbles. Deterministic but with
  // far fewer small-input collisions than a single LCG step.
  let h = 0x811c9dc5;
  const mix = (byte: number): void => { h ^= byte & 0xff; h = Math.imul(h, 0x01000193) >>> 0; };
  for (let i = 0; i < 4; i += 1) mix(seed >>> (i * 8));
  for (let i = 0; i < 4; i += 1) mix(salt >>> (i * 8));
  let out = '';
  for (let i = 0; i < 24; i += 1) {
    mix(i + 1);
    out += ((h >>> ((i % 8) * 4)) & 0xf).toString(16);
  }
  return out;
}
function actorId(seed: number, salt: number): string { return `act_${hex24(seed, salt).slice(0, 16)}`; }
function hypothesisId(instanceSalt: string, n: number): `hyp_${string}` { return `hyp_${hex24(n, parseInt(instanceSalt.slice(0, 8), 16) + n).slice(0, 16)}`; }
function ttlAlive(observedAtTick: number, expiresAtTick: number, tick: number): boolean {
  return observedAtTick <= tick && tick < expiresAtTick;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

function validPlan(value: unknown): value is CoopPlan {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'scan' || value.kind === 'jam') return true;
  if (value.kind === 'move') {
    return ['up', 'down', 'left', 'right', 'north', 'south', 'east', 'west'].includes(value.direction as string) &&
      Number.isInteger(value.ticks) && (value.ticks as number) >= 1 && (value.ticks as number) <= 1000;
  }
  if (value.kind === 'share') return Array.isArray(value.targetIds) && value.targetIds.every((x) => typeof x === 'string');
  return false;
}
function validMemory(value: unknown): value is CoopMemoryEntry {
  return isRecord(value) && typeof value.kind === 'string' && isFiniteNumber(value.tick) && typeof value.detail === 'string' &&
    (value.confidence === undefined || isFiniteNumber(value.confidence));
}
function validProjection(value: unknown): value is SharedEvidenceProjection {
  if (!isRecord(value)) return false;
  if (typeof value.targetId !== 'string' || !isFiniteNumber(value.observedAtTick) || !isFiniteNumber(value.expiresAtTick)) return false;
  if (value.roomId !== 'station-zero-r1' && value.roomId !== 'station-zero-r2') return false;
  if (value.relationId !== undefined && value.relationId !== null && typeof value.relationId !== 'string') return false;
  if (value.stateLabel !== undefined && typeof value.stateLabel !== 'string') return false;
  if (value.position !== undefined && (!isRecord(value.position) || !isFiniteNumber(value.position.x) || !isFiniteNumber(value.position.y))) return false;
  if (value.sourceActionId !== undefined && typeof value.sourceActionId !== 'string') return false;
  if (value.observerActorId !== undefined && typeof value.observerActorId !== 'string') return false;
  return true;
}
function validShared(value: unknown): value is SharedEvidence {
  return isRecord(value) && validProjection(value.projection) && typeof value.sharedBy === 'string' &&
    isFiniteNumber(value.sharedAtTick) && Array.isArray(value.fields) &&
    value.fields.every((f) => (SHARE_FIELDS as readonly string[]).includes(f as string));
}
function validHypothesis(value: unknown): value is CoopHypothesis {
  return isRecord(value) && typeof value.id === 'string' && value.id.startsWith('hyp_') &&
    typeof value.statement === 'string' && isFiniteNumber(value.confidence) && value.confidence >= 0 && value.confidence <= 1 &&
    isFiniteNumber(value.uncertainty) && value.uncertainty >= 0 && value.uncertainty <= 1 &&
    ['proposed', 'confirmed', 'rejected'].includes(value.status as string) &&
    Array.isArray(value.basedOn) && value.basedOn.every((x) => typeof x === 'string') &&
    isFiniteNumber(value.proposedAtTick) && validPlan(value.action);
}

/**
 * Pure deterministic ECHO policy over a LEGAL observation only (no getState,
 * hidden state, RNG or external LLM). The same observation always yields the same
 * proposal.
 */
export function offlineEchoPolicy(observation: ObservationV1, memory: readonly CoopMemoryEntry[]): CoopPlan & { statement: string; confidence: number; uncertainty: number } {
  const targets = new Set(observation.evidence.map((e) => e.targetId));
  const confirmedJam = memory.some((m) => m.kind === 'confirm' && m.detail.includes('jam'));
  const seenReceiver = targets.has('tgt_lab_door_receiver');
  const seenSource = targets.has('tgt_lab_seal_source');
  if (confirmedJam && seenReceiver) {
    return { kind: 'move', direction: 'east', ticks: 12, statement: 'Move within jam range of the receiver and hold.', confidence: 0.8, uncertainty: 0.2 };
  }
  if (seenReceiver || seenSource) {
    return { kind: 'share', targetIds: [...targets], statement: 'Share the observed devices so the human can confirm a door plan.', confidence: 0.7, uncertainty: 0.3 };
  }
  return { kind: 'scan', statement: 'Scan locally to find a device before proposing anything.', confidence: 0.5, uncertainty: 0.5 };
}

export class CoopSession {
  readonly scenario = COOP_SCENARIO;
  /** Per-instance identity (secure random at the server boundary); never reused or global. */
  readonly instanceId: string;
  readonly sessionId: string;
  readonly testFixture: boolean;
  private readonly model: SliceModel;
  private readonly human: CoopActorState;
  private readonly echo: CoopActorState;
  private readonly hypotheses = new Map<string, CoopHypothesis>();
  private eventLog: CoopEvent[] = [];
  private epoch = 0;
  private pausedFlag = false;
  private takenOverFlag = false;
  private echoCancelledFlag = false;
  private echoLinkLostFlag = false;
  private echoBudget = ECHO_BUDGET_DEFAULT;
  private echoMoveIntent: MovementIntent = NO_MOVEMENT;
  private echoMoveRemaining = 0;
  private humanMoveIntent: MovementIntent = NO_MOVEMENT;
  private humanMoveRemaining = 0;
  private hypothesisCounter = 0;
  private nextActionSeq = 0;
  private readonly instanceSalt: string;
  private readonly issued = new Map<string, string>();
  private snapshotCounter = 0;

  constructor(options: { readonly seed: number; readonly fixture?: CoopFixture; readonly echoBudget?: number; readonly humanSensorRange?: number; readonly echoSensorRange?: number }) {
    const capability = randomBytes(12).toString('hex');
    this.instanceId = `inst_${capability.slice(0, 16)}`;
    this.sessionId = `ses_${capability}`;
    const instSeed = ((options.seed ^ parseInt(capability.slice(0, 8), 16)) >>> 0);
    this.instanceSalt = capability;
    this.model = new SliceModel();
    this.testFixture = options.fixture?.test === true;
    this.human = {
      actorId: actorId(instSeed, 0x11), role: 'PLAYER',
      position: { x: 0, y: 0 }, sensorRange: options.humanSensorRange ?? 1.5,
      goal: null, memory: [], evidence: [], shared: [],
    };
    this.echo = {
      actorId: actorId(instSeed, 0x22), role: 'COMPANION',
      position: { x: 0, y: 0 }, sensorRange: options.echoSensorRange ?? 1.5,
      goal: null, memory: [], evidence: [], shared: [],
    };
    if (options.fixture?.test) {
      this.model.setPlayerPos(options.fixture.human.x, options.fixture.human.y);
      this.echo.position = { x: options.fixture.echo.x, y: options.fixture.echo.y };
    } else {
      this.echo.position = { x: 3.5, y: 5.5 };
    }
    this.human.position = { x: this.model.position.x, y: this.model.position.y };
    if (typeof options.echoBudget === 'number') this.echoBudget = Math.max(0, Math.floor(options.echoBudget));
  }

  // --- shared helpers ------------------------------------------------------

  private nextActionId(salt: number): string {
    this.nextActionSeq += 1;
    return `aid_${hex24(this.nextActionSeq, salt).slice(0, 24)}`;
  }
  private record(actor: CoopActorKind, kind: string, detail: string): void {
    this.eventLog.push({ tick: this.model.tick, actor, kind, detail });
    while (this.eventLog.length > MAX_EVENTS) this.eventLog.shift();
  }
  private remember(actor: CoopActorState, entry: CoopMemoryEntry): void {
    actor.memory.push(entry);
    while (actor.memory.length > MAX_MEMORY) actor.memory.shift();
  }
  private echoBlocked(): CoopResponse<never> | null {
    if (this.pausedFlag) return coopFail('E_PAUSED', 'human paused the session');
    if (this.takenOverFlag) return coopFail('E_PERMISSION', 'human has taken over; ECHO is stopped');
    if (this.echoCancelledFlag) return coopFail('E_CANCELLED', 'ECHO action was cancelled');
    if (this.echoLinkLostFlag) return coopFail('E_LINK_UNAVAILABLE', 'ECHO link is lost');
    if (this.echoBudget <= 0) return coopFail('E_RESOURCE_LIMIT', 'ECHO action budget exhausted');
    return null;
  }
  private spendEchoBudget(): void { this.echoBudget = Math.max(0, this.echoBudget - 1); }

  private advance(ticks: number): number {
    if (this.pausedFlag) return 0;
    let advanced = 0;
    for (let i = 0; i < ticks; i += 1) {
      if (this.model.failed) break;
      const before = this.model.snapshot();
      const doorBefore = before.doorState;
      this.model.advanceTicks(1, () => {
        if (this.humanMoveRemaining > 0) {
          const p = stepMovementAt(this.model, this.humanMoveIntent, this.model.position.x, this.model.position.y);
          this.model.setPlayerPos(p.x, p.y);
          this.humanMoveRemaining -= 1;
          if (this.humanMoveRemaining === 0) this.humanMoveIntent = NO_MOVEMENT;
        }
        if (this.echoMoveRemaining > 0 && !this.takenOverFlag && !this.pausedFlag) {
          const p = stepMovementAt(this.model, this.echoMoveIntent, this.echo.position.x, this.echo.position.y);
          this.echo.position = { x: p.x, y: p.y };
          this.echoMoveRemaining -= 1;
          if (this.echoMoveRemaining === 0) this.echoMoveIntent = NO_MOVEMENT;
        }
      }, () => { resolveTransitions(this.model, before); });
      advanced += 1;
      this.human.position = { x: this.model.position.x, y: this.model.position.y };
      if (this.model.doorState !== doorBefore) this.record('human', 'device', `door ${doorBefore}->${this.model.doorState}`);
    }
    return advanced;
  }

  // --- human actions -------------------------------------------------------

  humanScan(): CoopResponse<ActionResult> {
    const provenance = { sourceActionId: this.nextActionId(0x01), observerActorId: this.human.actorId, sceneEpoch: this.epoch };
    const out = this.model.scanFrom(this.human.position.x, this.human.position.y, provenance, this.human.sensorRange);
    if (out.result.code === 'OK') this.human.evidence = out.evidence.map((e) => ({ ...e, position: { ...e.position } }));
    this.remember(this.human, { kind: 'scan', tick: this.model.tick, detail: out.result.code });
    this.record('human', 'scan', out.evidence.map((e) => e.targetId).join(',') || 'none');
    return coopOk(out.result);
  }

  humanMove(direction: MovementDirection, ticks: number): CoopResponse<{ readonly advanced: number; readonly position: { x: number; y: number } }> {
    if (this.pausedFlag) return coopFail('E_PAUSED', 'session is paused');
    this.humanMoveIntent = directionToIntent(direction);
    this.humanMoveRemaining = Math.max(0, Math.floor(ticks));
    const advanced = this.advance(this.humanMoveRemaining);
    this.human.position = { x: this.model.position.x, y: this.model.position.y };
    return coopOk({ advanced, position: { ...this.human.position } });
  }

  humanJam(): CoopResponse<ActionResult> {
    const result = this.model.jam('relay');
    this.remember(this.human, { kind: 'action', tick: this.model.tick, detail: `jam ${result.code}` });
    this.record('human', 'jam', result.code);
    return coopOk(result);
  }

  advanceTicks(ticks: number): CoopResponse<{ readonly advanced: number }> {
    if (this.pausedFlag) return coopFail('E_PAUSED', 'session is paused');
    return coopOk({ advanced: this.advance(Math.max(0, Math.floor(ticks))) });
  }

  // --- ECHO actions --------------------------------------------------------

  echoScan(): CoopResponse<{ readonly result: ActionResult; readonly evidenceTargets: string[] }> {
    const blocked = this.echoBlocked();
    if (blocked) return blocked;
    const provenance = { sourceActionId: this.nextActionId(0x02), observerActorId: this.echo.actorId, sceneEpoch: this.epoch };
    const out = this.model.scanFrom(this.echo.position.x, this.echo.position.y, provenance, this.echo.sensorRange);
    if (out.result.code === 'OK') {
      this.echo.evidence = out.evidence.map((e) => ({ ...e, position: { ...e.position } }));
      this.spendEchoBudget();
      this.remember(this.echo, { kind: 'scan', tick: this.model.tick, detail: out.evidence.map((e) => e.targetId).join(',') });
      this.record('echo', 'scan', out.evidence.map((e) => e.targetId).join(',') || 'none');
    }
    return coopOk({ result: out.result, evidenceTargets: out.evidence.map((e) => e.targetId) });
  }

  echoMove(direction: MovementDirection, ticks: number): CoopResponse<{ readonly advanced: number; readonly position: { x: number; y: number } }> {
    const blocked = this.echoBlocked();
    if (blocked) return blocked;
    this.spendEchoBudget();
    this.echoMoveIntent = directionToIntent(direction);
    this.echoMoveRemaining = Math.max(0, Math.floor(ticks));
    const advanced = this.advance(this.echoMoveRemaining);
    this.record('echo', 'move', `${direction}:${advanced}`);
    return coopOk({ advanced, position: { ...this.echo.position } });
  }

  echoJam(): CoopResponse<ActionResult> {
    const blocked = this.echoBlocked();
    if (blocked) return blocked;
    const result = this.model.jamFrom(this.echo.position.x, this.echo.position.y, 'relay');
    this.spendEchoBudget();
    this.remember(this.echo, { kind: 'action', tick: this.model.tick, detail: `jam ${result.code}` });
    this.record('echo', 'jam', result.code);
    return coopOk(result);
  }

  private trimEvidence(e: SliceEvidenceV1, fields: readonly ShareField[]): SharedEvidenceProjection {
    return {
      targetId: e.targetId,
      observedAtTick: e.observedAtTick,
      expiresAtTick: e.expiresAtTick,
      roomId: e.roomId,
      ...(e.sourceActionId !== undefined ? { sourceActionId: e.sourceActionId } : {}),
      ...(e.observerActorId !== undefined ? { observerActorId: e.observerActorId } : {}),
      ...(fields.includes('relationId') ? { relationId: e.relationId } : {}),
      ...(fields.includes('stateLabel') ? { stateLabel: e.stateLabel } : {}),
      ...(fields.includes('position') ? { position: { x: e.position.x, y: e.position.y } } : {}),
    };
  }

  private shareOwned(source: CoopActorState, recipient: CoopActorState, targetIds: readonly string[], fields: readonly string[]): CoopResponse<{ readonly shared: number }> {
    if (fields.length === 0) return coopFail('E_SCHEMA', 'share fields must not be empty');
    const unknown = fields.filter((f) => !(SHARE_FIELDS as readonly string[]).includes(f));
    if (unknown.length > 0) return coopFail('E_SCHEMA', 'unknown share fields are rejected');
    const whitelist = fields as ShareField[];
    const chosen = source.evidence.filter((e) => targetIds.includes(e.targetId));
    if (chosen.length === 0) return coopFail('E_ILLEGAL_TARGET', 'no owned evidence matches the requested targets');
    for (const evidence of chosen) {
      recipient.shared.push({
        projection: this.trimEvidence(evidence, whitelist), // deep, field-trimmed, no alias
        sharedBy: source.actorId,
        sharedAtTick: this.model.tick,
        fields: [...whitelist],
      });
    }
    while (recipient.shared.length > MAX_SHARED) recipient.shared.shift();
    return coopOk({ shared: chosen.length });
  }

  /** ECHO shares a field-whitelisted subset of its OWN evidence to the human. */
  echoShare(targetIds: readonly string[], fields: readonly string[]): CoopResponse<{ readonly shared: number }> {
    const blocked = this.echoBlocked();
    if (blocked) return blocked;
    const res = this.shareOwned(this.echo, this.human, targetIds, fields);
    if (!res.ok) return res;
    this.spendEchoBudget();
    this.remember(this.echo, { kind: 'share', tick: this.model.tick, detail: targetIds.join(',') });
    this.record('echo', 'share', `${targetIds.join(',')}:${fields.join('+')}`);
    return res;
  }

  /** Human shares a field-whitelisted subset of its OWN evidence to ECHO. */
  humanShare(targetIds: readonly string[], fields: readonly string[]): CoopResponse<{ readonly shared: number }> {
    const res = this.shareOwned(this.human, this.echo, targetIds, fields);
    if (!res.ok) return res;
    this.record('human', 'share', `${targetIds.join(',')}:${fields.join('+')}`);
    return res;
  }

  // --- hypotheses (never auto-canonical) -----------------------------------

  proposeHypothesis(plan: CoopPlan, statement: string, confidence: number, uncertainty: number): CoopResponse<CoopHypothesis> {
    if (this.takenOverFlag || this.pausedFlag || this.echoCancelledFlag) return coopFail('E_PERMISSION', 'ECHO cannot propose while stopped');
    if (!validPlan(plan)) return coopFail('E_SCHEMA', 'hypothesis plan is invalid');
    this.hypothesisCounter += 1;
    const frozenPlan = deepFreeze(deepClone(plan));
    const hypothesis: CoopHypothesis = deepFreeze({
      id: hypothesisId(this.instanceSalt, this.hypothesisCounter),
      statement: String(statement).slice(0, 200),
      confidence: Math.max(0, Math.min(1, confidence)),
      uncertainty: Math.max(0, Math.min(1, uncertainty)),
      basedOn: this.echo.evidence.map((e) => e.targetId),
      status: 'proposed',
      proposedAtTick: this.model.tick,
      action: frozenPlan,
    });
    this.hypotheses.set(hypothesis.id, hypothesis);
    this.remember(this.echo, { kind: 'hypothesis', tick: this.model.tick, detail: hypothesis.statement, confidence: hypothesis.confidence });
    this.record('echo', 'hypothesis', `${hypothesis.id}:${hypothesis.statement}`);
    return coopOk(hypothesis);
  }

  humanConfirm(id: string): CoopResponse<CoopHypothesis> {
    const h = this.hypotheses.get(id);
    if (!h) return coopFail('E_TARGET_DESTROYED', 'unknown hypothesis');
    if (h.status !== 'proposed') return coopFail('E_RETRYABLE', 'hypothesis already resolved');
    const updated = deepFreeze({ ...h, status: 'confirmed' as const });
    this.hypotheses.set(id, updated);
    this.echo.goal = h.statement;
    this.remember(this.human, { kind: 'confirm', tick: this.model.tick, detail: h.statement });
    this.remember(this.echo, { kind: 'confirm', tick: this.model.tick, detail: h.statement });
    this.record('human', 'confirm', id);
    return coopOk(updated);
  }

  humanReject(id: string): CoopResponse<CoopHypothesis> {
    const h = this.hypotheses.get(id);
    if (!h) return coopFail('E_TARGET_DESTROYED', 'unknown hypothesis');
    if (h.status !== 'proposed') return coopFail('E_RETRYABLE', 'hypothesis already resolved');
    const updated = deepFreeze({ ...h, status: 'rejected' as const });
    this.hypotheses.set(id, updated);
    this.remember(this.human, { kind: 'reject', tick: this.model.tick, detail: h.statement });
    this.record('human', 'reject', id);
    return coopOk(updated);
  }

  /** Only a CONFIRMED hypothesis may execute; otherwise zero side effects. */
  executeHypothesis(id: string): CoopResponse<{ readonly plan: CoopPlan; readonly result: unknown }> {
    const h = this.hypotheses.get(id);
    if (!h) return coopFail('E_TARGET_DESTROYED', 'unknown hypothesis');
    if (h.status !== 'confirmed') return coopFail('E_PERMISSION', 'hypothesis is not confirmed; ECHO must not act');
    const blocked = this.echoBlocked();
    if (blocked) return blocked;
    const plan = h.action; // deep-frozen at propose/confirm time
    if (plan.kind === 'scan') { const r = this.echoScan(); return r.ok ? coopOk({ plan, result: r.value }) : r; }
    if (plan.kind === 'move') { const r = this.echoMove(plan.direction, plan.ticks); return r.ok ? coopOk({ plan, result: r.value }) : r; }
    if (plan.kind === 'jam') { const r = this.echoJam(); return r.ok ? coopOk({ plan, result: r.value }) : r; }
    const r = this.echoShare(plan.targetIds, ['targetId', 'stateLabel', 'relationId', 'position'].filter((f) => (SHARE_FIELDS as readonly string[]).includes(f)));
    return r.ok ? coopOk({ plan, result: r.value }) : r;
  }

  // --- offline policy ------------------------------------------------------

  offlineEchoStep(): CoopResponse<{ readonly observation: ObservationV1; readonly hypothesis: CoopHypothesis }> {
    const obs = this.observe('echo');
    if (!obs.ok) return obs;
    const decision = offlineEchoPolicy(obs.value, this.echo.memory);
    const plan: CoopPlan = decision.kind === 'move'
      ? { kind: 'move', direction: decision.direction, ticks: decision.ticks }
      : decision.kind === 'share'
        ? { kind: 'share', targetIds: [...decision.targetIds] }
        : { kind: decision.kind };
    const proposed = this.proposeHypothesis(plan, decision.statement, decision.confidence, decision.uncertainty);
    return proposed.ok ? coopOk({ observation: obs.value, hypothesis: proposed.value }) : proposed;
  }

  // --- human owner management (ECHO calls rejected) ------------------------

  pause(): CoopResponse<{ readonly paused: true }> { this.pausedFlag = true; this.echoMoveRemaining = 0; this.echoMoveIntent = NO_MOVEMENT; this.record('human', 'pause', 'echo stopped'); return coopOk({ paused: true }); }
  resume(): CoopResponse<{ readonly paused: false }> { this.pausedFlag = false; this.record('human', 'resume', ''); return coopOk({ paused: false }); }
  takeover(): CoopResponse<{ readonly takenOver: true }> { this.takenOverFlag = true; this.echoMoveRemaining = 0; this.echoMoveIntent = NO_MOVEMENT; this.record('human', 'takeover', 'echo stopped'); return coopOk({ takenOver: true }); }
  release(): CoopResponse<{ readonly takenOver: false }> { this.takenOverFlag = false; this.record('human', 'release', ''); return coopOk({ takenOver: false }); }
  echoManagementAttempt(action: 'pause' | 'resume' | 'takeover' | 'release'): CoopResponse<never> { return coopFail('E_PERMISSION', `ECHO may not call owner action ${action}`); }
  cancelEcho(): CoopResponse<{ readonly cancelled: true }> { this.echoCancelledFlag = true; this.echoMoveRemaining = 0; this.echoMoveIntent = NO_MOVEMENT; this.record('human', 'cancel-echo', ''); return coopOk({ cancelled: true }); }
  loseEchoLink(): CoopResponse<{ readonly linkLost: true }> { this.echoLinkLostFlag = true; this.record('human', 'link-lost', ''); return coopOk({ linkLost: true }); }
  restoreEchoLink(): CoopResponse<{ readonly linkLost: false }> { this.echoLinkLostFlag = false; this.record('human', 'link-restored', ''); return coopOk({ linkLost: false }); }

  // --- observation projection ---------------------------------------------

  observe(actor: CoopActorKind, detail: 'summary' | 'standard' = 'standard'): CoopResponse<ObservationV1> {
    const source = actor === 'human' ? this.human : this.echo;
    const tick = this.model.tick;
    const own = (actor === 'human' ? this.human.evidence : this.echo.evidence).filter((e) => ttlAlive(e.observedAtTick, e.expiresAtTick, tick));
    const shared = source.shared.filter((s) => ttlAlive(s.projection.observedAtTick, s.projection.expiresAtTick, tick));
    const evidence: ObservationEvidenceV1[] = [
      ...own.map((e) => this.fullEvidenceToObs(e, source.actorId)),
      ...shared.map((s) => this.sharedToObs(s, source.actorId)),
    ];
    const visibleTargets = [
      ...own.map((e) => ({
        targetId: e.targetId, kind: this.targetKind(e.targetId), publicState: e.stateLabel,
        position: { x: e.position.x, y: e.position.y }, visibility: 'scan-revealed' as const,
      })),
      ...shared.map((s) => ({
        targetId: s.projection.targetId, kind: this.targetKind(s.projection.targetId),
        publicState: s.projection.stateLabel ?? 'shared',
        ...(s.projection.position ? { position: { x: s.projection.position.x, y: s.projection.position.y } } : {}),
        visibility: 'echo-shared' as const,
      })),
    ];
    const relationTargets: Readonly<Record<string, { readonly from: string; readonly to: string }>> = {
      rel_lab_seal_link: { from: 'tgt_lab_seal_source', to: 'tgt_lab_door_receiver' },
      rel_corridor_relay_bridge: { from: 'tgt_corridor_relay', to: 'tgt_corridor_bridge' },
      rel_corridor_relay_perception: { from: 'tgt_corridor_relay', to: 'tgt_corridor_guard' },
    };
    const connections: Array<{ relationId: string; fromTargetId: string; toTargetId: string; stateLabel: string; evidenceId: string }> = [];
    const addRelation = (relationId: string | null | undefined, targetId: string, at: number): void => {
      if (!relationId) return;
      const map = relationTargets[relationId];
      if (!map || connections.some((c) => c.relationId === relationId)) return;
      connections.push({ relationId, fromTargetId: map.from, toTargetId: map.to, stateLabel: 'link-visible', evidenceId: `ev_${hex24(at, 0x33).slice(0, 16)}` });
    };
    for (const e of own) addRelation(e.relationId, e.targetId, e.observedAtTick);
    for (const s of shared) addRelation(s.projection.relationId, s.projection.targetId, s.projection.observedAtTick);
    const position = actor === 'human' ? { x: this.model.position.x, y: this.model.position.y } : { ...this.echo.position };
    const snapshot = this.model.snapshot();
    const obs: ObservationV1 = {
      schema: AI_NATIVE_OBSERVATION_SCHEMA_V1,
      protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      sessionId: this.sessionId as ObservationV1['sessionId'],
      epoch: this.epoch,
      tick,
      actorId: source.actorId as ObservationV1['actorId'],
      role: source.role,
      detail,
      roomId: COOP_ROOM_ID,
      current: {
        self: { position, energy: this.model.energy, alive: !this.model.failed, paused: this.pausedFlag, passed: this.model.passed, crossed: false, failed: this.model.failed, completed: false },
        publicDeviceState: { door: this.model.doorState, doorPassable: this.model.doorPassable },
        publicTimers: {
          scanCooldownTicks: snapshot.scanCooldownTicks, jamCooldownTicks: snapshot.jamCooldownTicks,
          scanRevealRemainingTicks: snapshot.scanRevealTicks, jamRemainingTicks: snapshot.jamRemainingTicks,
          safeClearRemainingTicks: snapshot.safeClearTicks,
        },
        visibleTargets,
        knownConnections: connections,
      },
      evidence,
      knowledge: [],
      hypotheses: [], // P0 schema caps this at 0; hypotheses are exposed by the coop surface
      events: [],
      availableActions: this.availableActions(actor),
      omittedFieldCount: 0,
    } as unknown as ObservationV1;
    const validated = validateObservationDetailed(obs);
    if (!validated.ok) return coopFail(validated.issue.code, 'observation invalid');
    if (hasHiddenField(obs, ['role']) !== null) return coopFail('E_INTERNAL_TRANSACTION', 'observation leaked a hidden field');
    return coopOk(obs);
  }

  private targetKind(targetId: string): 'receiver' | 'source' | 'relay' | 'bridge' | 'guard' | 'control' {
    if (targetId.includes('receiver')) return 'receiver';
    if (targetId.includes('source')) return 'source';
    if (targetId.includes('relay')) return 'relay';
    if (targetId.includes('bridge')) return 'bridge';
    if (targetId.includes('guard')) return 'guard';
    return 'control';
  }
  private fullEvidenceToObs(e: SliceEvidenceV1, fallbackActor: string): ObservationEvidenceV1 {
    return {
      schema: AI_NATIVE_OBSERVATION_SCHEMA_V1, protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      evidenceId: `ev_${hex24(e.observedAtTick, 0x44).slice(0, 16)}` as ObservationEvidenceV1['evidenceId'],
      sceneEpoch: e.sceneEpoch ?? this.epoch, roomId: e.roomId,
      sourceActionId: (e.sourceActionId ?? `aid_${hex24(e.observedAtTick, 0x55).slice(0, 24)}`) as ObservationEvidenceV1['sourceActionId'],
      source: 'player-scan',
      observerActorId: (e.observerActorId ?? fallbackActor) as ObservationEvidenceV1['observerActorId'],
      observerPosition: { x: e.position.x, y: e.position.y },
      targetId: e.targetId as ObservationEvidenceV1['targetId'],
      ...(e.relationId ? { relationId: e.relationId } : {}),
      observedAtTick: e.observedAtTick, expiresAtTick: e.expiresAtTick,
      observedState: Object.freeze({ stateLabel: e.stateLabel }),
    };
  }
  private sharedToObs(s: SharedEvidence, recipientActor: string): ObservationEvidenceV1 {
    const p = s.projection;
    return {
      schema: AI_NATIVE_OBSERVATION_SCHEMA_V1, protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      evidenceId: `ev_${hex24(p.observedAtTick, 0x66).slice(0, 16)}` as ObservationEvidenceV1['evidenceId'],
      sceneEpoch: this.epoch, roomId: p.roomId,
      sourceActionId: (p.sourceActionId ?? `aid_${hex24(p.observedAtTick, 0x77).slice(0, 24)}`) as ObservationEvidenceV1['sourceActionId'],
      source: 'player-scan',
      observerActorId: (p.observerActorId ?? s.sharedBy ?? recipientActor) as ObservationEvidenceV1['observerActorId'],
      observerPosition: p.position ? { x: p.position.x, y: p.position.y } : { x: 0, y: 0 }, // redacted: real position not shared
      targetId: p.targetId as ObservationEvidenceV1['targetId'],
      ...(typeof p.relationId === 'string' && p.relationId.length > 0 ? { relationId: p.relationId } : {}),
      observedAtTick: p.observedAtTick, expiresAtTick: p.expiresAtTick,
      observedState: Object.freeze((p.stateLabel !== undefined ? { stateLabel: p.stateLabel } : {}) as Record<string, string | number | boolean>),
    };
  }

  private availableActions(actor: CoopActorKind): ActionCapabilityV1[] {
    const snapshot = this.model.snapshot();
    const out: ActionCapabilityV1[] = [
      { type: 'move', status: this.pausedFlag ? 'unavailable' : 'available', maxDurationTicks: 3600 },
      { type: 'scan', status: snapshot.scanCooldownTicks > 0 ? 'cooldown' : snapshot.energy < SLICE.SCAN_COST ? 'insufficient_energy' : 'available', ...(snapshot.scanCooldownTicks > 0 ? { reasonCode: 'E_COOLDOWN' as const } : {}) },
      { type: 'wait', status: this.pausedFlag ? 'unavailable' : 'available' },
    ];
    if (actor === 'human') out.push({ type: 'jam', status: snapshot.energy < SLICE.JAM_COST ? 'insufficient_energy' : 'available' });
    else if ([...this.hypotheses.values()].some((h) => h.status === 'confirmed')) out.push({ type: 'jam', status: snapshot.energy < SLICE.JAM_COST ? 'insufficient_energy' : 'available' });
    return out;
  }

  // --- status / handles ----------------------------------------------------

  /** Trusted full status (owner/Dev only). */
  status(): CoopStatus {
    return {
      scenario: COOP_SCENARIO, testFixture: this.testFixture, tick: this.model.tick, epoch: this.epoch,
      paused: this.pausedFlag, takenOver: this.takenOverFlag,
      echoCancelled: this.echoCancelledFlag, echoLinkLost: this.echoLinkLostFlag, echoBudget: this.echoBudget,
      human: { actorId: this.human.actorId, position: { ...this.human.position }, goal: this.human.goal, evidenceTargets: this.human.evidence.map((e) => e.targetId), sharedTargets: this.human.shared.map((s) => s.projection.targetId), memory: this.human.memory.length },
      echo: {
        actorId: this.echo.actorId, position: { ...this.echo.position }, goal: this.echo.goal,
        evidenceTargets: this.echo.evidence.map((e) => e.targetId), sharedTargets: this.echo.shared.map((s) => s.projection.targetId),
        memory: this.echo.memory.length,
        hypotheses: [...this.hypotheses.values()].map((h) => ({ id: h.id, status: h.status, statement: h.statement })),
      },
    };
  }

  /** Actor-scoped ECHO status: never exposes human private fields. */
  echoStatus(): EchoStatus {
    return {
      scenario: COOP_SCENARIO, testFixture: this.testFixture, tick: this.model.tick, epoch: this.epoch,
      paused: this.pausedFlag, takenOver: this.takenOverFlag, echoCancelled: this.echoCancelledFlag,
      echoLinkLost: this.echoLinkLostFlag, echoBudget: this.echoBudget, humanActorId: this.human.actorId,
      echo: {
        actorId: this.echo.actorId, position: { ...this.echo.position }, sensorRange: this.echo.sensorRange, goal: this.echo.goal,
        evidenceTargets: this.echo.evidence.map((e) => e.targetId), sharedTargets: this.echo.shared.map((s) => s.projection.targetId),
        memory: this.echo.memory.length,
        hypotheses: [...this.hypotheses.values()].map((h) => ({ id: h.id, status: h.status, statement: h.statement })),
      },
    };
  }

  events(): readonly CoopEvent[] { return this.eventLog.slice(); }

  humanHandle(): HumanCoopHandle {
    return {
      actorId: this.human.actorId, role: 'PLAYER',
      observe: (d) => this.observe('human', d),
      scan: () => this.humanScan(),
      move: (dir, ticks) => this.humanMove(dir, ticks),
      jam: () => this.humanJam(),
      pause: () => this.pause(),
      resume: () => this.resume(),
      takeover: () => this.takeover(),
      release: () => this.release(),
      share: (targetIds, fields) => this.humanShare(targetIds, fields),
      confirm: (id) => this.humanConfirm(id),
      reject: (id) => this.humanReject(id),
      cancelEcho: () => this.cancelEcho(),
      status: () => this.status(),
      events: () => this.events(),
    };
  }

  companionHandle(): CompanionCoopHandle {
    return {
      actorId: this.echo.actorId, role: 'COMPANION',
      observe: (d) => this.observe('echo', d),
      scan: () => this.echoScan(),
      move: (dir, ticks) => this.echoMove(dir, ticks),
      share: (targetIds, fields) => this.echoShare(targetIds, fields),
      propose: (plan, statement, confidence, uncertainty) => this.proposeHypothesis(plan, statement, confidence, uncertainty),
      execute: (id) => this.executeHypothesis(id),
      offlineStep: () => this.offlineEchoStep(),
      management: (action) => this.echoManagementAttempt(action),
      status: () => this.echoStatus(),
    };
  }

  // --- isolated signed test snapshot (does not touch the Player schema) ----

  private nextSnapshotId(): string {
    const id = `csnap_${this.instanceSalt.slice(0, 12)}${this.snapshotCounter.toString(36)}`;
    this.snapshotCounter += 1;
    return id;
  }

  private snapshotPayload(): Record<string, unknown> {
    const human = deepClone(this.human);
    const echo = deepClone(this.echo);
    return {
      schema: COOP_SCHEMA, version: COOP_VERSION, instanceId: this.instanceId, sessionId: this.sessionId,
      tick: this.model.tick, epoch: this.epoch,
      model: this.model.captureFull(),
      state: {
        human, echo,
        hypotheses: [...this.hypotheses.values()].map((h) => deepClone(h)),
        paused: this.pausedFlag, takenOver: this.takenOverFlag, echoCancelled: this.echoCancelledFlag,
        echoLinkLost: this.echoLinkLostFlag, echoBudget: this.echoBudget,
        humanMoveIntent: { ...this.humanMoveIntent }, humanMoveRemaining: this.humanMoveRemaining,
        echoMoveIntent: { ...this.echoMoveIntent }, echoMoveRemaining: this.echoMoveRemaining,
        nextActionSeq: this.nextActionSeq, hypothesisCounter: this.hypothesisCounter,
      },
    };
  }

  snapshot(): Record<string, unknown> & { readonly snapshotId: string; readonly publicHash: string } {
    const payload = this.snapshotPayload();
    const snapshotId = this.nextSnapshotId();
    // Authorization uses the FULL canonical payload, not a short fingerprint.
    this.issued.set(snapshotId, canonicalJson(payload));
    while (this.issued.size > MAX_ISSUED) {
      const oldest = this.issued.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.issued.delete(oldest);
    }
    return { ...payload, snapshotId, publicHash: payloadFingerprint(payload) };
  }

  restore(frame: unknown): CoopResponse<{ readonly tick: number; readonly epoch: number }> {
    if (!isRecord(frame)) return coopFail('E_SCHEMA', 'coop snapshot must be an object');
    if (frame.schema !== COOP_SCHEMA) return coopFail('E_REPLAY_INCOMPATIBLE', 'unknown coop snapshot schema');
    if (frame.version !== COOP_VERSION) return coopFail('E_VERSION_UNSUPPORTED', 'unsupported coop snapshot version');
    // Instance identity binding: a frame from another (even same-seed) instance is never accepted.
    if (frame.instanceId !== this.instanceId) return coopFail('E_SNAPSHOT_INVALID', 'snapshot instance does not match this instance');
    if (frame.sessionId !== this.sessionId) return coopFail('E_SNAPSHOT_INVALID', 'snapshot session does not match this instance');
    if (typeof frame.snapshotId !== 'string') return coopFail('E_SNAPSHOT_INVALID', 'snapshot lacks an issued handle');
    const expected = this.issued.get(frame.snapshotId);
    if (expected === undefined) return coopFail('E_SNAPSHOT_INVALID', 'snapshot was not issued by this instance or was evicted');
    const { snapshotId: _ignored, publicHash: _public, ...payload } = frame;
    void _ignored;
    void _public;
    let actualIdentity: string;
    try { actualIdentity = canonicalJson(payload); } catch { return coopFail('E_SNAPSHOT_INVALID', 'snapshot payload is not canonical'); }
    if (actualIdentity !== expected) return coopFail('E_SNAPSHOT_INVALID', 'snapshot content does not match the issued frame');
    // ---- validate EVERYTHING into a candidate before touching this ----
    const state = frame.state as Record<string, unknown>;
    if (!isRecord(state)) return coopFail('E_SCHEMA', 'coop snapshot state is missing');
    const human = state.human as Record<string, unknown>;
    const echo = state.echo as Record<string, unknown>;
    if (!isRecord(human) || !isRecord(echo)) return coopFail('E_SCHEMA', 'coop snapshot actors are missing');
    if (!isFullSliceState(frame.model)) return coopFail('E_SNAPSHOT_INVALID', 'coop snapshot model is invalid');
    if (!isFiniteNumber(frame.tick) || !isFiniteNumber(frame.epoch)) return coopFail('E_SCHEMA', 'coop snapshot tick/epoch invalid');
    const humanPos = human.position as Record<string, unknown>;
    const echoPos = echo.position as Record<string, unknown>;
    if (!isRecord(humanPos) || !isFiniteNumber(humanPos.x) || !isFiniteNumber(humanPos.y)) return coopFail('E_SNAPSHOT_INVALID', 'human position invalid');
    if (!isRecord(echoPos) || !isFiniteNumber(echoPos.x) || !isFiniteNumber(echoPos.y)) return coopFail('E_SNAPSHOT_INVALID', 'echo position invalid');
    const candidate = new SliceModel();
    candidate.restoreFull(frame.model as never);
    if (Math.abs(candidate.position.x - humanPos.x) > 1e-6 || Math.abs(candidate.position.y - humanPos.y) > 1e-6) {
      return coopFail('E_SNAPSHOT_INVALID', 'human position does not match the model');
    }
    if (!candidate.canStandAt(echoPos.x, echoPos.y)) return coopFail('E_SNAPSHOT_INVALID', 'echo position is not standable');
    if (![human.memory, human.evidence, human.shared, echo.memory, echo.evidence, echo.shared].every(Array.isArray)) {
      return coopFail('E_SCHEMA', 'coop snapshot actor arrays missing');
    }
    if (!(human.memory as unknown[]).every(validMemory) || !(echo.memory as unknown[]).every(validMemory)) return coopFail('E_SNAPSHOT_INVALID', 'coop snapshot memory invalid');
    if (!(human.shared as unknown[]).every(validShared) || !(echo.shared as unknown[]).every(validShared)) return coopFail('E_SNAPSHOT_INVALID', 'coop snapshot shared evidence invalid');
    if (!isFiniteNumber(state.echoBudget) || (state.echoBudget as number) < 0 || (state.echoBudget as number) > 1000) return coopFail('E_SNAPSHOT_INVALID', 'coop snapshot budget invalid');
    const hypotheses = state.hypotheses;
    if (!Array.isArray(hypotheses) || !hypotheses.every(validHypothesis)) return coopFail('E_SNAPSHOT_INVALID', 'coop snapshot hypotheses invalid');
    // ---- commit atomically ----
    this.model.restoreFull(frame.model as never);
    this.epoch = Math.max(this.epoch + 1, (frame.epoch as number) + 1);
    this.human.position = { x: candidate.position.x, y: candidate.position.y };
    this.human.goal = (human.goal as string | null) ?? null;
    this.human.memory = deepClone(human.memory as CoopMemoryEntry[]);
    this.human.evidence = deepClone(human.evidence as SliceEvidenceV1[]);
    this.human.shared = deepClone(human.shared as SharedEvidence[]);
    this.echo.position = { x: echoPos.x, y: echoPos.y };
    this.echo.goal = (echo.goal as string | null) ?? null;
    this.echo.memory = deepClone(echo.memory as CoopMemoryEntry[]);
    this.echo.evidence = deepClone(echo.evidence as SliceEvidenceV1[]);
    this.echo.shared = deepClone(echo.shared as SharedEvidence[]);
    this.hypotheses.clear();
    for (const h of hypotheses as CoopHypothesis[]) this.hypotheses.set(h.id, deepFreeze(deepClone(h)));
    this.pausedFlag = state.paused === true;
    this.takenOverFlag = state.takenOver === true;
    this.echoCancelledFlag = state.echoCancelled === true;
    this.echoLinkLostFlag = state.echoLinkLost === true;
    this.echoBudget = state.echoBudget as number;
    const hmi = state.humanMoveIntent as MovementIntent | undefined;
    this.humanMoveIntent = hmi ? { ...hmi } : NO_MOVEMENT;
    this.echoMoveIntent = (state.echoMoveIntent as MovementIntent | undefined) ? { ...(state.echoMoveIntent as MovementIntent) } : NO_MOVEMENT;
    this.humanMoveRemaining = isFiniteNumber(state.humanMoveRemaining) ? (state.humanMoveRemaining as number) : 0;
    this.echoMoveRemaining = isFiniteNumber(state.echoMoveRemaining) ? (state.echoMoveRemaining as number) : 0;
    this.nextActionSeq = isFiniteNumber(state.nextActionSeq) ? (state.nextActionSeq as number) : 0;
    this.hypothesisCounter = isFiniteNumber(state.hypothesisCounter) ? (state.hypothesisCounter as number) : 0;
    return coopOk({ tick: this.model.tick, epoch: this.epoch });
  }
}

export class CoopManager {
  private readonly sessions = new Map<string, CoopSession>();
  private counter = 0;
  constructor(private readonly maxSessions = 10) {}
  get size(): number { return this.sessions.size; }
  create(options: { readonly seed: number; readonly fixture?: CoopFixture; readonly echoBudget?: number; readonly humanSensorRange?: number; readonly echoSensorRange?: number }): CoopResponse<{ readonly handle: string; readonly session: CoopSession }> {
    if (this.sessions.size >= this.maxSessions) return coopFail('E_RESOURCE_LIMIT', `at most ${this.maxSessions} coop sessions`);
    this.counter += 1;
    const handle = `coop_${this.counter.toString(16).padStart(24, '0').slice(-24)}`;
    const session = new CoopSession(options);
    this.sessions.set(handle, session);
    return coopOk({ handle, session });
  }
  get(handle: string): CoopSession | undefined { return this.sessions.get(handle); }
  close(handle: string): boolean { return this.sessions.delete(handle); }
  dispose(): void { this.sessions.clear(); }
}

export interface HumanCoopHandle {
  readonly actorId: string;
  readonly role: 'PLAYER';
  observe(detail?: 'summary' | 'standard'): CoopResponse<ObservationV1>;
  scan(): CoopResponse<ActionResult>;
  move(direction: MovementDirection, ticks: number): CoopResponse<{ readonly advanced: number; readonly position: { x: number; y: number } }>;
  jam(): CoopResponse<ActionResult>;
  pause(): CoopResponse<{ readonly paused: true }>;
  resume(): CoopResponse<{ readonly paused: false }>;
  takeover(): CoopResponse<{ readonly takenOver: true }>;
  release(): CoopResponse<{ readonly takenOver: false }>;
  share(targetIds: readonly string[], fields: readonly string[]): CoopResponse<{ readonly shared: number }>;
  confirm(id: string): CoopResponse<CoopHypothesis>;
  reject(id: string): CoopResponse<CoopHypothesis>;
  cancelEcho(): CoopResponse<{ readonly cancelled: true }>;
  status(): CoopStatus;
  events(): readonly CoopEvent[];
}

export interface CompanionCoopHandle {
  readonly actorId: string;
  readonly role: 'COMPANION';
  observe(detail?: 'summary' | 'standard'): CoopResponse<ObservationV1>;
  scan(): CoopResponse<{ readonly result: ActionResult; readonly evidenceTargets: string[] }>;
  move(direction: MovementDirection, ticks: number): CoopResponse<{ readonly advanced: number; readonly position: { x: number; y: number } }>;
  share(targetIds: readonly string[], fields: readonly string[]): CoopResponse<{ readonly shared: number }>;
  propose(plan: CoopPlan, statement: string, confidence: number, uncertainty: number): CoopResponse<CoopHypothesis>;
  execute(id: string): CoopResponse<{ readonly plan: CoopPlan; readonly result: unknown }>;
  offlineStep(): CoopResponse<{ readonly observation: ObservationV1; readonly hypothesis: CoopHypothesis }>;
  management(action: 'pause' | 'resume' | 'takeover' | 'release'): CoopResponse<never>;
  status(): EchoStatus;
}

export function createCoopSession(options: { readonly seed: number; readonly fixture?: CoopFixture; readonly echoBudget?: number; readonly humanSensorRange?: number; readonly echoSensorRange?: number }): CoopSession {
  return new CoopSession(options);
}
