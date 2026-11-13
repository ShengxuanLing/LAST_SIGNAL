// VS-00 storage adapter. Writes ONLY the prototype's own key; never touches
// last_signal_save_v1 / SAVE_VERSION / the future full-slice save key.
import { canFit, isWalkableCell } from './room';
import { CORRIDOR, canStandInCorridor, occupiesBridge } from './corridorRoom';
import { SLICE } from './tuning';
import type { PersistedSliceState } from './rules';
import { isSliceEvidenceArray } from './fullState';

export const SLICE_STORAGE_KEY = 'last_signal_station_zero_vs00_v1';
export const SLICE_SCHEMA = 'last_signal_station_zero_vs00_v1';

export type StorageStatus = 'ok' | 'missing' | 'rejected' | 'unavailable';

const DOOR_STATES = ['SEALED', 'JAMMED_OPEN', 'OPEN', 'CLOSED', 'SAFE_PENDING_CLOSE'];

// A rejected/unavailable load locks writes for the session. Only an explicit
// Restart that successfully removes the key unlocks it. This prevents a Save or
// an auto-save on passing the door from overwriting a bad/high-schema original.
let sessionWriteLocked = false;
let observedRaw: string | null = null;

export function isSliceWriteLocked(): boolean {
  return sessionWriteLocked;
}

const isInt = (n: unknown, lo: number, hi: number): boolean =>
  typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;

function isValidPosition(p: unknown, doorPassable: boolean): boolean {
  if (!p || typeof p !== 'object') return false;
  const v = p as Record<string, unknown>;
  if (typeof v.x !== 'number' || typeof v.y !== 'number') return false;
  // Same 5-point footprint as Scene.canStand; door passability comes from the save
  // (jam / JAMMED_OPEN / OPEN / SAFE_PENDING_CLOSE). This rejects a centre-legal
  // position whose body would intersect a wall, e.g. (12.9,5.5) or (6.7,1.5).
  return canFit(v.x, v.y, (x, y) => isWalkableCell(x, y, doorPassable));
}

function isCorridorCheckpoint(value: unknown, savedTick: number): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.template !== CORRIDOR.template || v.guardCleared !== true ||
      typeof v.relayEnabled !== 'boolean' || typeof v.powered !== 'boolean' ||
      typeof v.crossed !== 'boolean' || !isInt(v.hp, 1, CORRIDOR.maxHp) ||
      !isInt(v.jamRemaining, 0, SLICE.JAM_DURATION_TICKS) ||
      !isInt(v.scanRemaining, 0, SLICE.SCAN_REVEAL_TICKS)) return false;
  const expected = v.relayEnabled && v.powered && v.jamRemaining === 0 ? 'STABLE' : 'UNAVAILABLE';
  if (v.bridge !== expected || !v.position || typeof v.position !== 'object') return false;
  const { x, y } = v.position as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' ||
      !canStandInCorridor(x, y, false) || occupiesBridge({ x, y })) return false;
  const scanRemaining = v.scanRemaining as number;
  if (scanRemaining === 0) {
    return v.reveal === null && (v.evidence === undefined || (Array.isArray(v.evidence) && v.evidence.length === 0));
  }
  if (!v.reveal || typeof v.reveal !== 'object') return false;
  const { relay, bridge, perceptionPort } = v.reveal as Record<string, unknown>;
  if (![relay, bridge, perceptionPort].every((field) => typeof field === 'boolean')) return false;
  if (v.evidence === undefined) return true; // legacy corridor save without evidence
  if (!isSliceEvidenceArray(v.evidence) || v.evidence.length === 0) return false;
  for (const item of v.evidence) {
    if (item.roomId !== 'station-zero-r2') return false;
    if (item.observedAtTick > savedTick || savedTick >= item.expiresAtTick) return false;
    if (item.expiresAtTick !== savedTick + scanRemaining) return false;
  }
  return true;
}

function isPersistedSliceState(value: unknown): value is PersistedSliceState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.schema !== SLICE_SCHEMA || v.version !== 1 || v.roomId !== 'station-zero-r1') return false;
  if (!isInt(v.energy, 0, 100)) return false;
  if (!isInt(v.tick, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (!DOOR_STATES.includes(String(v.doorState))) return false;
  if (typeof v.manualOpenIntent !== 'boolean') return false;
  if (typeof v.sealSourcePresent !== 'boolean') return false;
  if (typeof v.passed !== 'boolean') return false;
  const r = v.remaining;
  if (!r || typeof r !== 'object') return false;
  const rem = r as Record<string, unknown>;
  if (!isInt(rem.jam, 0, 360)) return false;
  if (!isInt(rem.jamCooldown, 0, 480)) return false;
  if (!isInt(rem.scanCooldown, 0, 120)) return false;
  if (!isInt(rem.scanReveal, 0, 480)) return false;
  if (!isInt(rem.safeClear, 0, 60)) return false;
  if (!isInt(rem.regenAcc, 0, 11)) return false;
  const doorPassable =
    (rem.jam as number) > 0 ||
    v.doorState === 'JAMMED_OPEN' ||
    v.doorState === 'OPEN' ||
    v.doorState === 'SAFE_PENDING_CLOSE';
  if (!isValidPosition(v.position, doorPassable)) return false;
  if (v.corridor !== undefined &&
      (v.passed !== true || rem.jam !== 0 || rem.scanReveal !== 0 || !isCorridorCheckpoint(v.corridor, v.tick as number))) return false;
  // P1 R9 compatible extension: present => target/relationship/stateLabel enum
  // whitelist + room binding + no FUTURE evidence. Expired evidence is still
  // shape-valid here but SliceModel.restore() safely discards it and asks for a
  // fresh Scan; it can never become a free Scan.
  if (v.evidence !== undefined) {
    if (!isSliceEvidenceArray(v.evidence)) return false;
    for (const item of v.evidence) {
      if (item.roomId !== v.roomId) return false;
      if (item.observedAtTick > (v.tick as number)) return false;
    }
  }
  return true;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Load the prototype state.
 * - `missing`: no value yet (writes allowed).
 * - `rejected`: bad/unknown schema. The raw value is left untouched and writes
 *   are locked until an explicit Restart clears the key successfully.
 * - `unavailable`: localStorage is blocked; the game stays playable in memory.
 */
export function loadSlice(): { state: PersistedSliceState | null; status: StorageStatus } {
  const ls = storage();
  if (!ls) {
    sessionWriteLocked = true;
    return { state: null, status: 'unavailable' };
  }
  let raw: string | null;
  try {
    raw = ls.getItem(SLICE_STORAGE_KEY);
  } catch {
    sessionWriteLocked = true;
    return { state: null, status: 'unavailable' };
  }
  observedRaw = raw;
  if (raw == null) {
    sessionWriteLocked = false;
    return { state: null, status: 'missing' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sessionWriteLocked = true;
    return { state: null, status: 'rejected' };
  }
  if (!isPersistedSliceState(parsed)) {
    sessionWriteLocked = true;
    return { state: null, status: 'rejected' };
  }
  sessionWriteLocked = false;
  return { state: parsed, status: 'ok' };
}

export function saveSlice(state: PersistedSliceState): boolean {
  if (sessionWriteLocked || !isPersistedSliceState(state)) return false;
  const ls = storage();
  if (!ls) return false;
  // Defence in depth: never overwrite an existing unknown/invalid value, even if
  // the session lock was somehow bypassed.
  try {
    const raw = ls.getItem(SLICE_STORAGE_KEY);
    if (raw !== observedRaw) return false;
    if (raw != null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        sessionWriteLocked = true;
        return false;
      }
      if (!isPersistedSliceState(parsed)) {
        sessionWriteLocked = true;
        return false;
      }
    }
  } catch {
    return false;
  }
  try {
    const next = JSON.stringify(state);
    ls.setItem(SLICE_STORAGE_KEY, next);
    observedRaw = next;
    return true;
  } catch {
    return false;
  }
}

/** Explicit restart can clear rejected data. Automatic failure only clears valid saves. */
export function clearSlice(preserveRejected = false): boolean {
  const ls = storage();
  if (!ls) return false;
  try {
    if (ls.getItem(SLICE_STORAGE_KEY) !== observedRaw || (preserveRejected && sessionWriteLocked)) return false;
    ls.removeItem(SLICE_STORAGE_KEY);
    observedRaw = null;
    sessionWriteLocked = false;
    return true;
  } catch {
    return false;
  }
}
