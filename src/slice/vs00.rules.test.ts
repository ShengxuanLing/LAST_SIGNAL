import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SliceModel, SLICE, type PersistedSliceState, type DoorState } from './rules';
import { SLICE_STORAGE_KEY, SLICE_SCHEMA, loadSlice, saveSlice, clearSlice } from './storage';
import { ROOM } from './room';

const MAIN_KEY = 'last_signal_save_v1';

function makePersisted(over: Partial<PersistedSliceState> = {}): PersistedSliceState {
  return {
    schema: 'last_signal_station_zero_vs00_v1',
    version: 1,
    roomId: 'station-zero-r1',
    energy: 100,
    tick: 0,
    doorState: 'SEALED',
    manualOpenIntent: false,
    sealSourcePresent: true,
    passed: false,
    position: { x: ROOM.spawn.x, y: ROOM.spawn.y },
    remaining: { jam: 0, jamCooldown: 0, scanCooldown: 0, scanReveal: 0, safeClear: SLICE.SAFE_CLEAR_DELAY_TICKS, regenAcc: 0 },
    ...over,
  };
}

/** Advance exactly `ticks` logic ticks using the public fixed-step API. */
function advanceTicks(model: SliceModel, ticks: number): void {
  let left = ticks;
  while (left > 0) {
    const n = Math.min(SLICE.MAX_TICKS_PER_FRAME, left);
    model.step(n * SLICE.TICK_MS);
    left -= n;
  }
}

describe('VS-00 door / energy / scan rules', () => {
  it('starts SEALED with full energy and an impassable door', () => {
    const m = new SliceModel();
    expect(m.energy).toBe(SLICE.ENERGY_MAX);
    expect(m.doorState).toBe('SEALED');
    expect(m.jamActive).toBe(false);
    expect(m.doorPassable).toBe(false);
  });

  it('Scan only reveals: it costs 10, does not open the door, and is not a Jam precondition', () => {
    const m = new SliceModel();
    const before = m.energy;
    const r = m.scan();
    expect(r.code).toBe('OK');
    expect(r.cost).toBe(SLICE.SCAN_COST);
    expect(m.energy).toBe(before - SLICE.SCAN_COST);
    expect(m.doorState).toBe('SEALED');
    expect(m.jamActive).toBe(false);
    expect(m.snapshot().reveal?.doorReceiver).toBe(true);
  });

  it('charges every Scan pulse (re-scan is not free)', () => {
    const m = new SliceModel();
    expect(m.scan().cost).toBe(SLICE.SCAN_COST);
    advanceTicks(m, SLICE.SCAN_CD_TICKS);
    const before = m.energy;
    const r = m.scan();
    expect(r.code).toBe('OK');
    expect(r.cost).toBe(SLICE.SCAN_COST);
    expect(m.energy).toBe(before - SLICE.SCAN_COST);
  });

  it('Scan exposes the receiver, source and link once LOS/radius allow', () => {
    const m = new SliceModel();
    m.scan();
    const reveal = m.snapshot().reveal;
    expect(reveal?.doorReceiver).toBe(true);
    expect(reveal?.sealSource).toBe(true);
    expect(reveal?.link).toBe(true);
  });

  it('uses strict d < radius for Scan reveal: exactly 12 is an empty pulse, not an error', () => {
    const m = new SliceModel();
    // receiver is (7.5, 5.0); distance exactly 12.
    m.setPlayerPos(ROOM.receiver.x, ROOM.receiver.y - SLICE.SCAN_RADIUS);
    const r = m.scan();
    expect(r.code).toBe('OK');
    expect(r.cost).toBe(SLICE.SCAN_COST);
    expect(m.snapshot().reveal?.doorReceiver).toBe(false);
  });

  it('a legal Jam costs 25, opens the door, and keeps the read-only source', () => {
    const m = new SliceModel();
    m.setPlayerPos(ROOM.receiver.x, ROOM.receiver.y);
    const r = m.jam();
    expect(r.code).toBe('OK');
    expect(r.cost).toBe(SLICE.JAM_COST);
    expect(m.energy).toBe(SLICE.ENERGY_MAX - SLICE.JAM_COST);
    expect(m.doorState).toBe('JAMMED_OPEN');
    expect(m.doorPassable).toBe(true);
    expect(m.jamActive).toBe(true);
  });

  it('re-Jam while active is E_RETRYABLE, free, and does not refresh', () => {
    const m = new SliceModel();
    m.setPlayerPos(ROOM.receiver.x, ROOM.receiver.y);
    m.jam();
    const energy = m.energy;
    const remaining = m.snapshot().jamRemainingTicks;
    const r = m.jam();
    expect(r.code).toBe('E_RETRYABLE');
    expect(r.cost).toBe(0);
    expect(m.energy).toBe(energy);
    expect(m.snapshot().jamRemainingTicks).toBe(remaining);
  });

  it('uses strict d < radius for Jam and Interact (exactly 6 is out of range)', () => {
    const jamModel = new SliceModel();
    jamModel.setPlayerPos(ROOM.receiver.x, ROOM.receiver.y - SLICE.JAM_RANGE);
    expect(jamModel.jam().code).toBe('E_ILLEGAL_TARGET');

    const interactModel = new SliceModel();
    interactModel.setPlayerPos(ROOM.receiver.x, ROOM.receiver.y - SLICE.INTERACT_RANGE);
    expect(interactModel.interact().code).toBe('E_ILLEGAL_TARGET');
  });

  it('reports E_ENERGY_INSUFFICIENT with zero cost, then recovers by natural regen', () => {
    const m = new SliceModel(makePersisted({ energy: 10 }));
    // Restore keeps the player at spawn, which is within Jam range.
    const r = m.jam();
    expect(r.code).toBe('E_ENERGY_INSUFFICIENT');
    expect(r.cost).toBe(0);
    expect(m.energy).toBe(10);

    // 5 energy / logic-second => +15 energy in 3 s (180 ticks).
    advanceTicks(m, 200);
    expect(m.energy).toBeGreaterThanOrEqual(SLICE.JAM_COST);
    const r2 = m.jam();
    expect(r2.code).toBe('OK');
    expect(m.doorState).toBe('JAMMED_OPEN');
  });

  it('on Jam expiry re-solves from current conditions: SAFE_PENDING_CLOSE then SEALED', () => {
    const m = new SliceModel();
    m.setPlayerPos(ROOM.receiver.x, ROOM.receiver.y);
    m.jam();
    m.setPlayerPos(ROOM.spawn.x, ROOM.spawn.y); // step out of the doorway
    advanceTicks(m, SLICE.JAM_DURATION_TICKS);
    expect(m.jamActive).toBe(false);
    expect(m.doorState).toBe('SAFE_PENDING_CLOSE');
    advanceTicks(m, SLICE.SAFE_CLEAR_DELAY_TICKS);
    expect(m.doorState).toBe('SEALED');
  });

  it('never closes on an occupant: SAFE_PENDING_CLOSE holds until they leave', () => {
    const m = new SliceModel();
    m.setPlayerPos(ROOM.receiver.x, ROOM.receiver.y);
    m.jam();
    advanceTicks(m, SLICE.JAM_DURATION_TICKS);
    expect(m.doorState).toBe('SAFE_PENDING_CLOSE');
    // Stay in the doorway far past the delay: the door must not close (no clamp).
    advanceTicks(m, 600);
    expect(m.doorState).toBe('SAFE_PENDING_CLOSE');
    m.setPlayerPos(ROOM.spawn.x, ROOM.spawn.y);
    advanceTicks(m, SLICE.SAFE_CLEAR_DELAY_TICKS);
    expect(m.doorState).toBe('SEALED');
  });

  it('re-occupying resets the safe-clear delay', () => {
    const m = new SliceModel();
    m.setPlayerPos(ROOM.receiver.x, ROOM.receiver.y);
    m.jam();
    advanceTicks(m, SLICE.JAM_DURATION_TICKS);
    m.setPlayerPos(ROOM.spawn.x, ROOM.spawn.y);
    advanceTicks(m, 30);
    // Re-enter the doorway: delay restarts.
    m.setPlayerPos(ROOM.receiver.x, ROOM.receiver.y);
    advanceTicks(m, 30);
    m.setPlayerPos(ROOM.spawn.x, ROOM.spawn.y);
    advanceTicks(m, 50);
    expect(m.doorState).toBe('SAFE_PENDING_CLOSE');
    advanceTicks(m, 20);
    expect(m.doorState).toBe('SEALED');
  });

  it('pause freezes tick, energy, cooldowns and Jam remaining; resume does not catch up', () => {
    const m = new SliceModel();
    m.setPlayerPos(ROOM.receiver.x, ROOM.receiver.y);
    m.jam();
    const frozen = m.snapshot();
    m.setPaused(true);
    advanceTicks(m, 600);
    const paused = m.snapshot();
    expect(paused.tick).toBe(frozen.tick);
    expect(paused.energy).toBe(frozen.energy);
    expect(paused.jamRemainingTicks).toBe(frozen.jamRemainingTicks);
    expect(paused.jamCooldownTicks).toBe(frozen.jamCooldownTicks);
    expect(paused.scanCooldownTicks).toBe(frozen.scanCooldownTicks);
    expect(paused.scanRevealTicks).toBe(frozen.scanRevealTicks);
    expect(paused.safeClearTicks).toBe(frozen.safeClearTicks);

    m.setPaused(false);
    advanceTicks(m, SLICE.MAX_TICKS_PER_FRAME);
    expect(m.snapshot().tick).toBe(frozen.tick + SLICE.MAX_TICKS_PER_FRAME);
  });

  it('is deterministic for the same fixed-step input sequence', () => {
    const run = (): PersistedSliceState => {
      const m = new SliceModel();
      m.setPlayerPos(ROOM.receiver.x, ROOM.receiver.y);
      m.scan();
      m.jam();
      advanceTicks(m, 400);
      m.setPlayerPos(ROOM.spawn.x, ROOM.spawn.y);
      advanceTicks(m, 120);
      return m.serialize();
    };
    expect(run()).toEqual(run());
  });

  it('an empty scan is legal and still costs one pulse', () => {
    const m = new SliceModel();
    m.setPlayerPos(30, 30); // far outside every radius/LOS
    const r = m.scan();
    expect(r.code).toBe('OK');
    expect(r.cost).toBe(SLICE.SCAN_COST);
    expect(m.energy).toBe(SLICE.ENERGY_MAX - SLICE.SCAN_COST);
    const reveal = m.snapshot().reveal;
    expect(reveal).not.toBeNull();
    expect(reveal?.doorReceiver).toBe(false);
    expect(reveal?.sealSource).toBe(false);
  });

  it('solves from current source + manual intent (no hardcoded SEALED)', () => {
    const m = new SliceModel();
    // Near the door receiver but NOT occupying the door AABB.
    m.setPlayerPos(6.5, 5.5);
    m.setSealSourcePresent(false);
    expect(m.doorState).toBe('CLOSED');

    const open = m.interact();
    expect(open.code).toBe('OK');
    expect(m.doorState).toBe('OPEN');

    m.setSealSourcePresent(true);
    expect(m.doorState).toBe('SEALED');
  });

  it('keeps SAFE_PENDING_CLOSE while only a door-corner AABB overlap remains', () => {
    const m = new SliceModel();
    m.setPlayerPos(ROOM.receiver.x, ROOM.receiver.y);
    m.jam();
    // Door-corner overlap: inside the movement AABB but outside the old circle test.
    m.setPlayerPos(6.8, 5.0);
    advanceTicks(m, SLICE.JAM_DURATION_TICKS);
    expect(m.doorState).toBe('SAFE_PENDING_CLOSE');
    advanceTicks(m, 600);
    expect(m.doorState).toBe('SAFE_PENDING_CLOSE');
    m.setPlayerPos(ROOM.spawn.x, ROOM.spawn.y);
    advanceTicks(m, SLICE.SAFE_CLEAR_DELAY_TICKS);
    expect(m.doorState).toBe('SEALED');
  });

  it('passed is historical: walking back west keeps passed true', () => {
    const m = new SliceModel();
    m.markPassed();
    m.setPlayerPos(ROOM.spawn.x, ROOM.spawn.y);
    expect(m.passed).toBe(true);
  });

  it('near the door, plain F on a SEALED door is E_LINK_UNAVAILABLE with zero cost', () => {
    const m = new SliceModel();
    // Near the door (within any plausible hand-edit range 2 or 6), not far away.
    m.setPlayerPos(6.5, 5.5);
    const before = m.energy;
    const r = m.interact();
    expect(r.code).toBe('E_LINK_UNAVAILABLE');
    expect(r.cost).toBe(0);
    expect(m.energy).toBe(before);
    expect(m.doorState).toBe('SEALED');
  });

  it('restoring a pending safe-close keeps its remaining delay instead of sealing immediately', () => {
    const m = new SliceModel();
    m.setPlayerPos(ROOM.receiver.x, ROOM.receiver.y);
    m.jam();
    m.setPlayerPos(ROOM.spawn.x, ROOM.spawn.y); // step out of the doorway
    advanceTicks(m, SLICE.JAM_DURATION_TICKS);
    expect(m.doorState).toBe('SAFE_PENDING_CLOSE');

    // Let part of the 1 s safe-clear delay elapse, then round-trip the save.
    advanceTicks(m, 30);
    const saved = m.serialize();
    expect(saved.doorState).toBe('SAFE_PENDING_CLOSE');
    const remaining = saved.remaining.safeClear;
    expect(remaining).toBeGreaterThan(0);

    const restored = new SliceModel(saved);
    // Restore must not collapse the pending delay into an immediate SEALED.
    expect(restored.doorState).toBe('SAFE_PENDING_CLOSE');
    advanceTicks(restored, remaining - 1);
    expect(restored.doorState).toBe('SAFE_PENDING_CLOSE');
    advanceTicks(restored, 1);
    expect(restored.doorState).toBe('SEALED');
  });

  it('does not grant instant regen after a spend at full energy (full remainder stays 0)', () => {
    const m = new SliceModel();
    // 11 ticks at full energy: the remainder must already be 0 (cleared every tick at cap).
    advanceTicks(m, SLICE.REGEN_TICKS - 1);
    expect(m.energy).toBe(SLICE.ENERGY_MAX);
    expect(m.serialize().remaining.regenAcc).toBe(0);

    const r = m.scan();
    expect(r.cost).toBe(SLICE.SCAN_COST);
    expect(m.energy).toBe(SLICE.ENERGY_MAX - SLICE.SCAN_COST);

    // One tick later it must still be 90: the old bug (accumulator left at 11)
    // would cross 12 here and grant an immediate +1.
    advanceTicks(m, 1);
    expect(m.serialize().remaining.regenAcc).toBe(1);
    expect(m.energy).toBe(SLICE.ENERGY_MAX - SLICE.SCAN_COST);

    // After the full 12 ticks from the spend, exactly one energy is granted.
    advanceTicks(m, SLICE.REGEN_TICKS - 1);
    expect(m.energy).toBe(SLICE.ENERGY_MAX - SLICE.SCAN_COST + 1);
  });

  it('restore does not hard-reset a persisted manual intent to closed', () => {
    const m = new SliceModel(makePersisted({ doorState: 'OPEN' as DoorState, manualOpenIntent: true }));
    // The solver may re-seal a door whose source is present, but it must not rewrite
    // the persisted manual intent as a side effect.
    expect(m.serialize().manualOpenIntent).toBe(true);
  });
});

// ---------- storage adapter (own-key isolation, rejection, failure) ----------

class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  get length(): number { return this.map.size; }
}

describe('VS-00 storage adapter', () => {
  let store: MemStorage;
  beforeEach(() => {
    store = new MemStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
    // Fresh session: an empty store makes loadSlice() report `missing`, which clears
    // the module-level write lock carried over from a previous rejected case.
    expect(loadSlice()).toEqual({ state: null, status: 'missing' });
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('reports missing, writes only its own key, and leaves existing main/economy data untouched', () => {
    store.setItem(MAIN_KEY, 'MAIN-RAW');
    expect(loadSlice()).toEqual({ state: null, status: 'missing' });

    const state = makePersisted({ energy: 42 });
    expect(saveSlice(state)).toBe(true);
    expect(store.getItem(SLICE_STORAGE_KEY)).not.toBeNull();
    expect(store.getItem(MAIN_KEY)).toBe('MAIN-RAW');

    const loaded = loadSlice();
    expect(loaded.status).toBe('ok');
    expect(loaded.state?.energy).toBe(42);
  });

  it('rejects a bad/unknown schema and preserves the raw value', () => {
    const bad = '{"schema":"something-else","version":99}';
    store.setItem(SLICE_STORAGE_KEY, bad);
    expect(loadSlice()).toEqual({ state: null, status: 'rejected' });
    // A rejected load locks writes for the session; the raw value stays untouched.
    expect(saveSlice(makePersisted())).toBe(false);
    expect(store.getItem(SLICE_STORAGE_KEY)).toBe(bad);
  });

  it('rejects saved positions whose player footprint overlaps a wall, preserving raw', () => {
    // (12.9,5.5) centre cell is floor, but its 0.35 footprint reaches border wall x=13.
    // (6.7,1.5) centre cell is floor, but its footprint reaches partition cell (7,1).
    for (const position of [{ x: 12.9, y: 5.5 }, { x: 6.7, y: 1.5 }]) {
      const raw = JSON.stringify(makePersisted({ position }));
      store.setItem(SLICE_STORAGE_KEY, raw);
      expect(loadSlice()).toEqual({ state: null, status: 'rejected' });
      expect(saveSlice(makePersisted())).toBe(false);
      expect(store.getItem(SLICE_STORAGE_KEY)).toBe(raw);
    }
  });

  it('clearSlice removes only its own key (after a real save)', () => {
    store.setItem(MAIN_KEY, 'MAIN-RAW');
    // The save must actually succeed and the key must exist before clearing, so this
    // cannot pass vacuously if a previous case left the session write lock on.
    expect(saveSlice(makePersisted())).toBe(true);
    expect(store.getItem(SLICE_STORAGE_KEY)).not.toBeNull();

    expect(clearSlice()).toBe(true);
    expect(store.getItem(SLICE_STORAGE_KEY)).toBeNull();
    expect(store.getItem(MAIN_KEY)).toBe('MAIN-RAW');
  });

  it('reports unavailable and save failure when localStorage throws', () => {
    const throwing = {
      getItem(): string | null { throw new Error('blocked'); },
      setItem(): void { throw new Error('quota'); },
      removeItem(): void { throw new Error('blocked'); },
      clear(): void {},
      key(): string | null { return null; },
      length: 0,
    } as unknown as Storage;
    Object.defineProperty(globalThis, 'localStorage', { value: throwing, configurable: true, writable: true });

    expect(loadSlice()).toEqual({ state: null, status: 'unavailable' });
    expect(saveSlice(makePersisted())).toBe(false);
    expect(clearSlice()).toBe(false);
  });

  it('schema constants stay namespaced to this prototype', () => {
    expect(SLICE_SCHEMA).toBe('last_signal_station_zero_vs00_v1');
    expect(SLICE_STORAGE_KEY).toBe('last_signal_station_zero_vs00_v1');
    expect(SLICE_STORAGE_KEY).not.toBe(MAIN_KEY);
  });
});
