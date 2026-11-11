// VS-00 storage adapter. Writes ONLY the prototype's own key; never touches
// last_signal_save_v1 / SAVE_VERSION / the future full-slice save key.
import { ROOM, isWalkableCell } from './room';
import type { PersistedSliceState } from './rules';

export const SLICE_STORAGE_KEY = 'last_signal_station_zero_vs00_v1';
export const SLICE_SCHEMA = 'last_signal_station_zero_vs00_v1';

export type StorageStatus = 'ok' | 'missing' | 'rejected' | 'unavailable';

const DOOR_STATES = ['SEALED', 'JAMMED_OPEN', 'OPEN', 'CLOSED', 'SAFE_PENDING_CLOSE'];

// A rejected/unavailable load locks writes for the session. Only an explicit
// Restart that successfully removes the key unlocks it. This prevents a Save or
// an auto-save on passing the door from overwriting a bad/high-schema original.
let sessionWriteLocked = false;

export function isSliceWriteLocked(): boolean {
  return sessionWriteLocked;
}

const isInt = (n: unknown, lo: number, hi: number): boolean =>
  typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;

function isValidPosition(p: unknown, doorPassable: boolean): boolean {
  if (!p || typeof p !== 'object') return false;
  const v = p as Record<string, unknown>;
  if (typeof v.x !== 'number' || typeof v.y !== 'number') return false;
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return false;
  const r = ROOM.playerRadius;
  const samples: Array<[number, number]> = [
    [v.x, v.y],
    [v.x - r, v.y - r],
    [v.x + r, v.y - r],
    [v.x - r, v.y + r],
    [v.x + r, v.y + r],
  ];
  // Same 5-point footprint as Scene.canStand; door passability comes from the save
  // (jam / JAMMED_OPEN / OPEN / SAFE_PENDING_CLOSE). This rejects a centre-legal
  // position whose body would intersect a wall, e.g. (12.9,5.5) or (6.7,1.5).
  return samples.every(([sx, sy]) => isWalkableCell(Math.floor(sx), Math.floor(sy), doorPassable));
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
  if (sessionWriteLocked) return false;
  const ls = storage();
  if (!ls) return false;
  // Defence in depth: never overwrite an existing unknown/invalid value, even if
  // the session lock was somehow bypassed.
  try {
    const raw = ls.getItem(SLICE_STORAGE_KEY);
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
    ls.setItem(SLICE_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Explicit restart clears only this prototype's key; success unlocks writes. */
export function clearSlice(): boolean {
  const ls = storage();
  if (!ls) return false;
  try {
    ls.removeItem(SLICE_STORAGE_KEY);
    sessionWriteLocked = false;
    return true;
  } catch {
    return false;
  }
}
