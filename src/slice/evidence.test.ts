/**
 * AI-NATIVE-01 P1 — minimal R9 evidence persistence in the browser save.
 *
 * The published key/schema/version are UNCHANGED. `evidence` is an optional,
 * strictly validated compatible extension; old saves without it still load but
 * their active reveal evidence is cleared and a rescan is required.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SLICE_STORAGE_KEY, SLICE_SCHEMA, clearSlice, loadSlice, saveSlice } from './storage';
import { SliceModel, type PersistedSliceState } from './rules';
import type { SliceEvidenceV1 } from './fullState';
import { isSliceEvidenceArray } from './fullState';

class MemStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
  key(): string | null { return null; }
  get length(): number { return this.map.size; }
}

const MAIN_KEY = 'last_signal_save_v1';

const EVIDENCE: SliceEvidenceV1[] = [{
  targetId: 'tgt_lab_door_receiver',
  relationId: 'rel_lab_seal_link',
  position: { x: 6.5, y: 5.5 },
  observedAtTick: 5,
  expiresAtTick: 485,
  stateLabel: 'receiver-visible',
  roomId: 'station-zero-r1',
}];

function makePersisted(overrides: Partial<PersistedSliceState> = {}): PersistedSliceState {
  return {
    schema: SLICE_SCHEMA,
    version: 1,
    roomId: 'station-zero-r1',
    energy: 100,
    tick: 10,
    doorState: 'SEALED',
    manualOpenIntent: false,
    sealSourcePresent: true,
    passed: false,
    position: { x: 3.5, y: 5.5 },
    remaining: { jam: 0, jamCooldown: 0, scanCooldown: 0, scanReveal: 0, safeClear: 60, regenAcc: 0 },
    ...overrides,
  } as PersistedSliceState;
}

describe('R9 evidence compatible extension', () => {
  let store: MemStorage;
  beforeEach(() => {
    store = new MemStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
    expect(loadSlice()).toEqual({ state: null, status: 'missing' });
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('keeps the published key/schema/version unchanged', () => {
    expect(SLICE_SCHEMA).toBe('last_signal_station_zero_vs00_v1');
    expect(SLICE_STORAGE_KEY).toBe('last_signal_station_zero_vs00_v1');
    expect(SLICE_STORAGE_KEY).not.toBe(MAIN_KEY);
  });

  it('saves and loads a valid optional evidence array', () => {
    expect(saveSlice(makePersisted({ evidence: EVIDENCE }))).toBe(true);
    const loaded = loadSlice();
    expect(loaded.status).toBe('ok');
    expect(loaded.state?.evidence).toEqual(EVIDENCE);
    expect(JSON.parse(store.getItem(SLICE_STORAGE_KEY) as string).evidence).toEqual(EVIDENCE);
  });

  it('rejects malformed evidence, preserves the raw value and locks writes', () => {
    const cases: unknown[] = [
      { not: 'an array' },
      [{ ...EVIDENCE[0], targetId: 'not-a-target-id' }],
      [{ ...EVIDENCE[0], expiresAtTick: 5 }],
      [{ ...EVIDENCE[0], observedAtTick: Number.NaN }],
      [{ ...EVIDENCE[0], extra: 'unknown' }],
      [{ ...EVIDENCE[0], roomId: 'other-room' }],
    ];
    for (const bad of cases) {
      const raw = JSON.stringify({ ...makePersisted(), evidence: bad });
      store.setItem(SLICE_STORAGE_KEY, raw);
      expect(loadSlice()).toEqual({ state: null, status: 'rejected' });
      expect(saveSlice(makePersisted())).toBe(false);
      expect(store.getItem(SLICE_STORAGE_KEY)).toBe(raw);
      expect(clearSlice()).toBe(true); // explicit restart may clear it
      expect(loadSlice()).toEqual({ state: null, status: 'missing' });
    }
  });

  it('accepts an old save without evidence and clears active reveal on restore', () => {
    const old = makePersisted({ remaining: { jam: 0, jamCooldown: 0, scanCooldown: 0, scanReveal: 120, safeClear: 60, regenAcc: 0 } });
    const raw = JSON.stringify(old);
    store.setItem(SLICE_STORAGE_KEY, raw);
    const loaded = loadSlice();
    expect(loaded.status).toBe('ok');
    expect(loaded.state?.evidence).toBeUndefined();
    const model = new SliceModel(loaded.state);
    expect(model.evidenceRescanRequiredFlag).toBe(true);
    expect(model.evidenceSnapshot).toEqual([]);
    expect(model.snapshot().reveal).toBeNull();
    expect(model.snapshot().scanRevealTicks).toBe(0);
  });

  it('round-trips real Scan evidence without re-scanning or extending TTL', () => {
    const model = new SliceModel();
    model.setPlayerPos(6.5, 5.5);
    expect(model.scan().code).toBe('OK');
    const saved = model.serialize();
    expect(isSliceEvidenceArray(saved.evidence)).toBe(true);
    expect(saved.evidence?.length).toBeGreaterThan(0);
    const restored = new SliceModel(saved);
    expect(restored.evidenceRescanRequiredFlag).toBe(false);
    expect(restored.evidenceSnapshot).toEqual(model.evidenceSnapshot);
    expect(restored.snapshot().reveal?.doorReceiver).toBe(true);
  });

  it('B3: expired evidence is safely discarded with a rescan hint, never a free Scan', () => {
    const save = makePersisted({
      tick: 5000,
      remaining: { jam: 0, jamCooldown: 0, scanCooldown: 0, scanReveal: 480, safeClear: 60, regenAcc: 0 },
      evidence: [{ ...EVIDENCE[0], observedAtTick: 5, expiresAtTick: 485 }],
    } as Partial<PersistedSliceState>);
    store.setItem(SLICE_STORAGE_KEY, JSON.stringify(save));
    const loaded = loadSlice();
    expect(loaded.status).toBe('ok');
    const model = new SliceModel(loaded.state);
    const snapshot = model.snapshot();
    expect(snapshot.tick).toBe(5000);
    expect(snapshot.scanRevealTicks).toBe(0);
    expect(snapshot.reveal).toBeNull();
    expect(model.evidenceSnapshot).toEqual([]);
    expect(model.evidenceRescanRequiredFlag).toBe(true);
    expect(snapshot.energy).toBe(100); // never charged for a free Scan
  });

  it('B3: future evidence is rejected by storage and locks writes', () => {
    const save = makePersisted({ tick: 10, evidence: [{ ...EVIDENCE[0], observedAtTick: 999, expiresAtTick: 1480 }] } as Partial<PersistedSliceState>);
    const raw = JSON.stringify(save);
    store.setItem(SLICE_STORAGE_KEY, raw);
    expect(loadSlice()).toEqual({ state: null, status: 'rejected' });
    expect(saveSlice(makePersisted())).toBe(false);
    expect(store.getItem(SLICE_STORAGE_KEY)).toBe(raw);
  });

  it('B3: unknown target/stateLabel enums are rejected', () => {
    const bad = [
      { ...EVIDENCE[0], targetId: 'tgt_unknown' },
      { ...EVIDENCE[0], stateLabel: 'free-scan' },
      { ...EVIDENCE[0], relationId: 'rel_unknown' },
      { ...EVIDENCE[0], roomId: 'station-zero-r2' },
    ];
    for (const item of bad) {
      const raw = JSON.stringify(makePersisted({ evidence: [item] } as Partial<PersistedSliceState>));
      store.setItem(SLICE_STORAGE_KEY, raw);
      expect(loadSlice()).toEqual({ state: null, status: 'rejected' });
      expect(clearSlice()).toBe(true);
    }
  });

  it('B3: entering the corridor clears R1 evidence, and expired evidence is not serialized', () => {
    const model = new SliceModel();
    model.setPlayerPos(6.5, 5.5);
    expect(model.scan().code).toBe('OK');
    expect(model.evidenceSnapshot.length).toBeGreaterThan(0);
    model.markPassed();
    model.setPlayerPos(12.5, 5.5);
    expect(model.enterCorridor()).toBe(true);
    expect(model.evidenceSnapshot).toEqual([]);
    expect(model.snapshot().scanRevealTicks).toBe(0);
    const expired = new SliceModel();
    expired.setPlayerPos(6.5, 5.5);
    expired.scan();
    for (let i = 0; i < 481; i += 1) expired.advanceTicks(1);
    expect(expired.evidenceSnapshot).toEqual([]);
    expect(expired.serialize().evidence).toBeUndefined();
  });

  it('B3-1: a legal corridor scan saves and reloads with correct R2 evidence/TTL (no rescan)', () => {
    const model = new SliceModel();
    model.setPlayerPos(6.5, 5.5);
    model.markPassed();
    model.setPlayerPos(12.5, 5.5);
    expect(model.enterCorridor()).toBe(true);
    expect(model.shootGuard().code).toBe('OK');
    model.advanceTicks(10);
    expect(model.shootGuard().code).toBe('OK');
    expect(model.snapshot().corridor?.guardHp).toBe(0); // guard cleared = safe point
    model.setPlayerPos(9.5, 9.5);
    expect(model.scan().code).toBe('OK');
    const saved = model.serialize();
    expect(saved.evidence).toBeUndefined(); // R1 top-level must stay empty in corridor
    expect(saved.corridor?.evidence?.length).toBeGreaterThan(0);
    expect(saved.corridor?.evidence?.every((e) => e.roomId === 'station-zero-r2')).toBe(true);
    // Persist + reload through the real storage path.
    expect(saveSlice(saved)).toBe(true);
    const loaded = loadSlice();
    expect(loaded.status).toBe('ok');
    const restored = new SliceModel(loaded.state!);
    expect(restored.inCorridor).toBe(true);
    const r2 = restored.evidenceSnapshot;
    expect(r2.length).toBe(saved.corridor!.evidence!.length);
    expect(r2.every((e) => e.roomId === 'station-zero-r2')).toBe(true);
    expect(r2.every((e) => e.observedAtTick <= restored.tick && restored.tick < e.expiresAtTick)).toBe(true);
    expect(restored.evidenceRescanRequiredFlag).toBe(false);
    expect(restored.snapshot().corridorReveal?.relay).toBe(true);
    expect(restored.snapshot().energy).toBe(saved.energy); // no fresh scan on restore
    expect(restored.snapshot().scanRevealTicks).toBe(saved.corridor!.scanRemaining);
  });

  it('B3-1: corridor evidence with wrong room or TTL mismatch is rejected (not silently accepted)', () => {
    const model = new SliceModel();
    model.setPlayerPos(6.5, 5.5);
    model.markPassed();
    model.setPlayerPos(12.5, 5.5);
    expect(model.enterCorridor()).toBe(true);
    model.advanceTicks(10);
    expect(model.shootGuard().code).toBe('OK');
    model.advanceTicks(10);
    expect(model.shootGuard().code).toBe('OK');
    model.setPlayerPos(9.5, 9.5);
    expect(model.scan().code).toBe('OK');
    const saved = model.serialize();
    const wrongRoom = JSON.parse(JSON.stringify(saved)) as PersistedSliceState;
    wrongRoom.corridor = { ...wrongRoom.corridor!, evidence: saved.corridor!.evidence!.map((e) => ({ ...e, roomId: 'station-zero-r1' })) };
    expect(saveSlice(wrongRoom)).toBe(false);
    store.setItem(SLICE_STORAGE_KEY, JSON.stringify(wrongRoom));
    expect(loadSlice().status).toBe('rejected');
    const badTtl = JSON.parse(JSON.stringify(saved)) as PersistedSliceState;
    badTtl.tick = saved.tick + 500; // clock advanced but corridor TTL unchanged
    expect(saveSlice(badTtl)).toBe(false);
  });
});
