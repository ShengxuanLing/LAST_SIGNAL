/**
 * AI-NATIVE-01 P1 — FULL internal simulation state shapes.
 *
 * These are NOT the published browser checkpoint (`PersistedSliceState`, schema
 * `last_signal_station_zero_vs00_v1`). The browser save only stores a SAFE
 * checkpoint (guard cleared, bridge idle, no dangerous transition). The full
 * state below is a private runtime frame used by the headless core's
 * snapshot / restore / replay; it carries live Guard decision state, bridge
 * transitions, all timers, regen remainder and movement intent.
 *
 * Pure TypeScript data shapes only. No Phaser / DOM / node:crypto here.
 */
import type { ActionResult, DoorState } from './rules';

export type FullRoomId = 'station-zero-r1' | 'station-zero-r2';

export interface PositionEvidenceState {
  x: number;
  y: number;
  observedAtTick: number;
  expiresAtTick: number;
}

/** R9: scan evidence is produced ONLY inside a successful Scan transaction. */
export interface SliceEvidenceV1 {
  readonly targetId: string;
  readonly relationId: string | null;
  readonly position: { readonly x: number; readonly y: number };
  readonly observedAtTick: number;
  readonly expiresAtTick: number;
  readonly stateLabel: string;
  readonly roomId: FullRoomId;
}

export interface GuardFullState {
  location: { x: number; y: number };
  evidence: PositionEvidenceState | null;
  jamUntil: number;
  attackAt: number;
  watching: boolean;
  health: number;
}

export interface CorridorFullState {
  manualEnabled: boolean;
  powered: boolean;
  relay: 'ACTIVE' | 'INACTIVE' | 'JAMMED' | 'DISABLED';
  bridge: 'UNAVAILABLE' | 'TRANSITIONING' | 'STABLE' | 'UNSTABLE' | 'DISABLED';
  deadline: number;
  disposed: boolean;
  location: { x: number; y: number };
  lastShore: 'west' | 'east';
  health: number;
  guard: GuardFullState;
  crossed: boolean;
  crossedAtTick: number | null;
  nextShotTick: number;
}

/** Full mirror of every SliceModel private field. */
export interface FullSliceState {
  energy: number;
  tick: number;
  door: DoorState;
  manualOpenIntent: boolean;
  sealSourcePresent: boolean;
  jamRemainingTicks: number;
  jamCooldownTicks: number;
  scanCooldownTicks: number;
  scanRevealTicks: number;
  revealDoorReceiver: boolean;
  revealSealSource: boolean;
  pendingSafeClose: boolean;
  safeClearTicks: number;
  regenAcc: number;
  accumulatorMs: number;
  playerX: number;
  playerY: number;
  occupancy: boolean;
  passed: boolean;
  paused: boolean;
  lastRelayInteractTick: number;
  lastResult: ActionResult;
  corridorReveal: { relay: boolean; bridge: boolean; perceptionPort: boolean } | null;
  corridor: CorridorFullState | null;
  evidence: SliceEvidenceV1[];
  evidenceRescanRequired: boolean;
}

/**
 * P1 R9 evidence target/relationship/state label whitelist. A save can only
 * carry the labels this build itself emits, so an attacker cannot encode
 * arbitrary coordinates/state into `stateLabel`.
 */
export const EVIDENCE_TARGET_RULES: Readonly<Record<string, {
  readonly roomId: FullRoomId;
  readonly stateLabels: readonly string[];
  readonly relationIds: readonly (string | null)[];
}>> = Object.freeze({
  tgt_lab_door_receiver: Object.freeze({
    roomId: 'station-zero-r1', stateLabels: Object.freeze(['receiver-visible']),
    relationIds: Object.freeze([null, 'rel_lab_seal_link']),
  }),
  tgt_lab_seal_source: Object.freeze({
    roomId: 'station-zero-r1', stateLabels: Object.freeze(['carrier-visible']),
    relationIds: Object.freeze([null, 'rel_lab_seal_link']),
  }),
  tgt_corridor_relay: Object.freeze({
    roomId: 'station-zero-r2', stateLabels: Object.freeze(['relay-visible']),
    relationIds: Object.freeze([null]),
  }),
  tgt_corridor_bridge: Object.freeze({
    roomId: 'station-zero-r2', stateLabels: Object.freeze(['bridge-visible']),
    relationIds: Object.freeze([null, 'rel_corridor_relay_bridge']),
  }),
  tgt_corridor_guard: Object.freeze({
    roomId: 'station-zero-r2', stateLabels: Object.freeze(['perception-visible']),
    relationIds: Object.freeze([null, 'rel_corridor_relay_perception']),
  }),
});

const RELAY_STATES = ['ACTIVE', 'INACTIVE', 'JAMMED', 'DISABLED'];
const BRIDGE_STATES = ['UNAVAILABLE', 'TRANSITIONING', 'STABLE', 'UNSTABLE', 'DISABLED'];
const DOOR_STATES = ['SEALED', 'JAMMED_OPEN', 'OPEN', 'CLOSED', 'SAFE_PENDING_CLOSE'];

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const obj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(v);
  return own.length === keys.length && own.every((k) => keys.includes(k));
};

export function isPositionEvidenceState(v: unknown): v is PositionEvidenceState {
  return obj(v) && exactKeys(v, ['x', 'y', 'observedAtTick', 'expiresAtTick']) &&
    finite(v.x) && finite(v.y) && finite(v.observedAtTick) && finite(v.expiresAtTick);
}

/** Strict validator for the optional browser-save evidence extension. */
export function isSliceEvidenceArray(v: unknown): v is SliceEvidenceV1[] {
  if (!Array.isArray(v)) return false;
  for (const item of v) {
    if (!obj(item) || !exactKeys(item, [
      'targetId', 'relationId', 'position', 'observedAtTick', 'expiresAtTick', 'stateLabel', 'roomId',
    ])) return false;
    if (typeof item.targetId !== 'string' || !item.targetId.startsWith('tgt_')) return false;
    const rule = EVIDENCE_TARGET_RULES[item.targetId];
    if (!rule) return false;
    if (item.relationId !== null && (typeof item.relationId !== 'string' || !item.relationId.startsWith('rel_'))) return false;
    if (!obj(item.position) || !finite(item.position.x) || !finite(item.position.y) ||
        !exactKeys(item.position, ['x', 'y'])) return false;
    if (!finite(item.observedAtTick) || !finite(item.expiresAtTick) ||
        item.observedAtTick < 0 || item.expiresAtTick <= item.observedAtTick) return false;
    if (typeof item.stateLabel !== 'string' || !rule.stateLabels.includes(item.stateLabel)) return false;
    if (item.roomId !== 'station-zero-r1' && item.roomId !== 'station-zero-r2') return false;
    if (item.roomId !== rule.roomId) return false;
    if (!rule.relationIds.includes(item.relationId as string | null)) return false;
    if (Object.values(item).some((x) => x === undefined)) return false;
  }
  return true;
}

/** Strict validator for a full runtime frame (rejects NaN/Infinity/unknown fields). */
export function isFullSliceState(v: unknown): v is FullSliceState {
  if (!obj(v) || !exactKeys(v, [
    'energy', 'tick', 'door', 'manualOpenIntent', 'sealSourcePresent',
    'jamRemainingTicks', 'jamCooldownTicks', 'scanCooldownTicks', 'scanRevealTicks',
    'revealDoorReceiver', 'revealSealSource', 'pendingSafeClose', 'safeClearTicks',
    'regenAcc', 'accumulatorMs', 'playerX', 'playerY', 'occupancy', 'passed', 'paused',
    'lastRelayInteractTick', 'lastResult', 'corridorReveal', 'corridor', 'evidence',
    'evidenceRescanRequired',
  ])) return false;
  const numbers = [
    'energy', 'tick', 'jamRemainingTicks', 'jamCooldownTicks', 'scanCooldownTicks',
    'scanRevealTicks', 'safeClearTicks', 'regenAcc', 'accumulatorMs', 'playerX', 'playerY',
    'lastRelayInteractTick',
  ];
  if (numbers.some((k) => !finite(v[k]))) return false;
  const booleans = [
    'manualOpenIntent', 'sealSourcePresent', 'revealDoorReceiver', 'revealSealSource',
    'pendingSafeClose', 'occupancy', 'passed', 'paused', 'evidenceRescanRequired',
  ];
  if (booleans.some((k) => typeof v[k] !== 'boolean')) return false;
  if (typeof v.door !== 'string' || !DOOR_STATES.includes(v.door)) return false;
  const lr = v.lastResult;
  if (!obj(lr) || typeof lr.code !== 'string' || typeof lr.message !== 'string' || !finite(lr.cost) ||
      !exactKeys(lr, ['code', 'message', 'cost'])) return false;
  const cr = v.corridorReveal;
  if (cr !== null) {
    if (!obj(cr) || !exactKeys(cr, ['relay', 'bridge', 'perceptionPort'])) return false;
    if (['relay', 'bridge', 'perceptionPort'].some((k) => typeof cr[k] !== 'boolean')) return false;
  }
  if (!isSliceEvidenceArray(v.evidence)) return false;
  if (!isFullCorridorState(v.corridor)) return false;
  return true;
}

export function isFullCorridorState(v: unknown): v is CorridorFullState | null {
  if (v === null) return true;
  if (!obj(v) || !exactKeys(v, [
    'manualEnabled', 'powered', 'relay', 'bridge', 'deadline', 'disposed', 'location',
    'lastShore', 'health', 'guard', 'crossed', 'crossedAtTick', 'nextShotTick',
  ])) return false;
  if (typeof v.manualEnabled !== 'boolean' || typeof v.powered !== 'boolean' ||
      typeof v.disposed !== 'boolean' || typeof v.crossed !== 'boolean') return false;
  if (typeof v.relay !== 'string' || !RELAY_STATES.includes(v.relay)) return false;
  if (typeof v.bridge !== 'string' || !BRIDGE_STATES.includes(v.bridge)) return false;
  if (!finite(v.deadline) || !finite(v.health) || !finite(v.nextShotTick)) return false;
  if (v.lastShore !== 'west' && v.lastShore !== 'east') return false;
  if (v.crossedAtTick !== null && !finite(v.crossedAtTick)) return false;
  if (!obj(v.location) || !exactKeys(v.location, ['x', 'y']) ||
      !finite(v.location.x) || !finite(v.location.y)) return false;
  return isGuardFullState(v.guard);
}

export function isGuardFullState(v: unknown): v is GuardFullState {
  if (!obj(v) || !exactKeys(v, ['location', 'evidence', 'jamUntil', 'attackAt', 'watching', 'health'])) return false;
  if (!finite(v.jamUntil) || !finite(v.attackAt) || !finite(v.health) || typeof v.watching !== 'boolean') return false;
  if (!obj(v.location) || !exactKeys(v.location, ['x', 'y']) ||
      !finite(v.location.x) || !finite(v.location.y)) return false;
  if (v.evidence !== null && !isPositionEvidenceState(v.evidence)) return false;
  return true;
}
