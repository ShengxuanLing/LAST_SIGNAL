import { describe, expect, it, vi } from 'vitest';
import { Corridor, type CorridorSignal } from './corridor';
import { CORRIDOR, canStandInCorridor, occupiesBridge, validateCorridorTemplate } from './corridorRoom';
import { SliceModel, SLICE } from './rules';
import { clearSlice, loadSlice, saveSlice, SLICE_STORAGE_KEY } from './storage';

const { transitionTicks: delay, shores } = CORRIDOR;

function stableCorridor(): Corridor {
  const corridor = new Corridor();
  corridor.setEnabled(true, 0, false);
  corridor.advance(delay, false);
  return corridor;
}

function playTicks(model: SliceModel, ticks: number): void {
  for (let i = 0; i < ticks; i++) model.step(SLICE.TICK_MS);
}

function corridorModel(): SliceModel {
  const model = new SliceModel();
  model.markPassed();
  model.setPlayerPos(12.5, 5.5);
  expect(model.enterCorridor()).toBe(true);
  return model;
}

describe('VS-01 relay and bridge', () => {
  it('solves manual intent, supply and Jam in priority order', () => {
    const corridor = new Corridor();
    expect(corridor.snapshot(0)).toMatchObject({ relay: 'INACTIVE', powered: true, effectiveOutput: false });
    corridor.setPowered(false, 0, false);
    corridor.setEnabled(true, 0, false);
    expect(corridor.snapshot(0)).toMatchObject({ relay: 'INACTIVE', manualEnabled: true, powered: false });
    corridor.setJammed(1, true);
    corridor.setPowered(true, 2, true);
    expect(corridor.snapshot(2)).toMatchObject({ relay: 'JAMMED', effectiveOutput: false, powered: true });
    corridor.setEnabled(false, 3, true);
    corridor.advance(360, false);
    expect(corridor.snapshot(360)).toMatchObject({ relay: 'INACTIVE', bridge: 'UNAVAILABLE' });
    corridor.setEnabled(true, 361, false);
    expect(corridor.snapshot(361)).toMatchObject({ relay: 'ACTIVE', bridge: 'TRANSITIONING' });
  });

  it('publishes the same post-commit reading to both subscribers and ignores repeated state writes', () => {
    const corridor = stableCorridor();
    const bridge: CorridorSignal[] = [];
    const uplink: CorridorSignal[] = [];
    corridor.subscribe((snapshot) => bridge.push(snapshot));
    const disconnect = corridor.subscribe((snapshot) => uplink.push(snapshot));
    corridor.setEnabled(false, 100, false);
    corridor.setEnabled(false, 100, false);
    corridor.advance(101, false);
    expect(bridge).toHaveLength(1);
    expect(bridge[0]).toBe(uplink[0]);
    expect(Object.isFrozen(bridge[0])).toBe(true);
    expect(bridge[0]).toMatchObject({ bridge: 'UNSTABLE', bridgeFeed: false, perceptionFeed: false, bridgePassable: true });
    disconnect();
    corridor.setEnabled(true, 102, false);
    expect(bridge).toHaveLength(2);
    expect(uplink).toHaveLength(1);
    corridor.dispose();
    corridor.setEnabled(true, 200, false);
    expect(corridor.snapshot(200)).toMatchObject({ relay: 'DISABLED', bridge: 'DISABLED', effectiveOutput: false });
    expect(bridge).toHaveLength(2);
  });

  it('isolates a faulty or reentrant subscriber from the committed downstream state', () => {
    const corridor = stableCorridor();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      corridor.subscribe(() => {
        corridor.setEnabled(true, 100, false);
        throw new Error('subscriber fault');
      });
      const second = vi.fn();
      corridor.subscribe(second);
      corridor.setEnabled(false, 100, false);
      expect(errors).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledWith(expect.objectContaining({
        relay: 'INACTIVE', bridge: 'UNSTABLE', bridgeFeed: false, perceptionFeed: false,
      }));
    } finally {
      errors.mockRestore();
    }
  });

  it('validates both shores and opens only the template bridge footprint', () => {
    expect(validateCorridorTemplate()).toBe(true);
    expect(canStandInCorridor(12.5, 9.5, false)).toBe(false);
    expect(canStandInCorridor(12.5, 9.5, true)).toBe(true);
    expect(canStandInCorridor(12.5, 7.9, true)).toBe(false);
    expect(occupiesBridge({ x: 16.35, y: 9.5 })).toBe(true);
    expect(occupiesBridge(shores.east)).toBe(false);
  });

  it('cancels construction when power drops and preserves the full construction time on retry', () => {
    const corridor = new Corridor();
    corridor.setEnabled(true, 0, false);
    expect(corridor.snapshot(delay - 1).bridgePassable).toBe(false);
    corridor.setPowered(false, delay - 1, false);
    expect(corridor.snapshot(delay - 1).bridge).toBe('UNAVAILABLE');
    corridor.setPowered(true, delay, false);
    corridor.advance(2 * delay - 1, false);
    expect(corridor.snapshot(2 * delay - 1).bridge).toBe('TRANSITIONING');
    corridor.advance(2 * delay, false);
    expect(corridor.snapshot(2 * delay).bridge).toBe('STABLE');
  });

  it('preserves warning footing, cancels on timely recovery and handles empty collapse', () => {
    const corridor = stableCorridor();
    corridor.setJammed(100, true);
    expect(corridor.snapshot(100)).toMatchObject({ relay: 'JAMMED', bridge: 'UNSTABLE', bridgePassable: true });
    corridor.moveTo(12.5, 9.5);
    expect(corridor.advance(100 + delay, false)).toBeNull();
    expect(corridor.snapshot(100 + delay)).toMatchObject({ bridge: 'STABLE', hp: 100, onBridge: true });
    corridor.moveTo(shores.west.x, shores.west.y);
    corridor.setEnabled(false, 200, false);
    expect(corridor.advance(200 + delay, false)).toBeNull();
    expect(corridor.snapshot(200 + delay)).toMatchObject({ bridge: 'UNAVAILABLE', hp: 100, onBridge: false });
  });

  it('resolves the deadline against the occupied edge before processing movement', () => {
    const model = corridorModel();
    model.setPlayerPos(8.5, 9.5);
    model.interact();
    expect(model.interact()).toMatchObject({ code: 'E_RETRYABLE', cost: 0 });
    playTicks(model, delay);
    model.setPlayerPos(12.5, 9.5);
    model.jam();
    model.setPlayerPos(16.34, 9.5);
    playTicks(model, delay - 1);
    const attemptedStep = vi.fn(() => model.setPlayerPos(16.4, 9.5));
    model.step(SLICE.TICK_MS, attemptedStep);
    expect(attemptedStep).not.toHaveBeenCalled();
    expect(model.snapshot().corridor).toMatchObject({ position: shores.west, hp: 80, bridge: 'UNAVAILABLE' });
  });

  it.each(['west', 'east'] as const)('sends an occupied edge back to the last %s shore once', (shore) => {
    const corridor = stableCorridor();
    const bank = shores[shore];
    corridor.moveTo(bank.x, bank.y);
    corridor.moveTo(shore === 'west' ? 9.7 : 16.3, 9.5);
    corridor.setEnabled(false, 100, false);
    expect(corridor.snapshot(101)).toMatchObject({ hp: 100, onBridge: true, bridgePassable: true });
    expect(corridor.advance(100 + delay, false)).toBe(shore);
    expect(corridor.advance(101 + delay, false)).toBeNull();
    expect(corridor.snapshot(101 + delay)).toMatchObject({ hp: 80, position: bank, bridge: 'UNAVAILABLE' });
    expect(corridor.canStand(12.5, 9.5)).toBe(false);
  });

  it('rebuilds after repeated collapses and permits fatal recovery without reviving the run', () => {
    const corridor = stableCorridor();
    for (let i = 0; i < 5; i++) {
      const tick = 100 + i * delay * 3;
      corridor.setEnabled(true, tick, false);
      corridor.advance(tick + delay, false);
      corridor.moveTo(12.5, 9.5);
      corridor.setEnabled(false, tick + delay + 1, false);
      expect(corridor.advance(tick + delay * 2 + 1, false)).toBe('west');
      expect(corridor.snapshot(tick + delay * 2 + 1).hp).toBe(80 - 20 * i);
    }
    expect(corridor.alive).toBe(false);
    expect(corridor.canSave).toBe(false);
    corridor.setEnabled(true, 2000, false);
    expect(corridor.snapshot(2000).bridge).toBe('UNAVAILABLE');
  });

  it('shares fixed time, scan cost and Jam rules; pause and reset freeze or clear transient state', () => {
    const model = corridorModel();
    expect(model.scan()).toMatchObject({ code: 'OK', cost: 10 });
    expect(model.snapshot().corridorReveal).toEqual({ relay: true, bridge: true, perceptionPort: true });
    const before = model.energy;
    expect(model.jam()).toMatchObject({ code: 'E_ILLEGAL_TARGET', cost: 0 });
    expect(model.interact()).toMatchObject({ code: 'E_ILLEGAL_TARGET', cost: 0 });
    expect(model.energy).toBe(before);
    model.setPlayerPos(8.5, 9.5);
    expect(model.interact().cost).toBe(0);
    playTicks(model, delay);
    expect(model.jam()).toMatchObject({ code: 'OK', cost: 25 });
    expect(model.jam()).toMatchObject({ code: 'E_RETRYABLE', cost: 0 });
    model.setPaused(true);
    const frozen = model.snapshot();
    playTicks(model, delay * 2);
    expect(model.snapshot()).toEqual(frozen);
    expect(model.interact()).toMatchObject({ code: 'E_PAUSED', cost: 0 });
    model.setPaused(false);
    playTicks(model, SLICE.JAM_DURATION_TICKS);
    expect(model.snapshot().corridor).toMatchObject({ relay: 'ACTIVE', bridge: 'TRANSITIONING' });
    model.reset();
    expect(model.snapshot()).toMatchObject({ corridor: null, energy: 100, jamRemainingTicks: 0, tick: 0 });
    model.markPassed();
    model.setPlayerPos(12.5, 5.5);
    expect(model.enterCorridor()).toBe(true);
    expect(model.snapshot().corridor).toMatchObject({ relay: 'INACTIVE', bridge: 'UNAVAILABLE', hp: 100 });
  });

  it('blocks unsafe checkpoints and restores a cleared shore with exact Jam remaining', () => {
    const model = corridorModel();
    expect(model.canCheckpoint).toBe(false);
    expect(model.shootGuard().code).toBe('OK');
    playTicks(model, 10);
    expect(model.shootGuard().code).toBe('OK');
    expect(model.canCheckpoint).toBe(true);
    model.setPlayerPos(8.5, 9.5);
    model.interact();
    expect(model.canCheckpoint).toBe(false);
    playTicks(model, delay);
    model.setPlayerPos(12.5, 9.5);
    expect(model.canCheckpoint).toBe(false);
    model.setPlayerPos(9.5, 9.5);
    model.jam();
    expect(model.canCheckpoint).toBe(false);
    playTicks(model, delay);
    const before = model.snapshot();
    const checkpoint = model.serialize();
    expect(checkpoint.remaining.jam).toBe(0);
    const restored = new SliceModel(checkpoint);
    expect(restored.snapshot()).toMatchObject({
      corridor: { hp: before.corridor!.hp, guardHp: 0, relay: 'JAMMED', bridge: 'UNAVAILABLE' },
      jamRemainingTicks: SLICE.JAM_DURATION_TICKS - delay,
    });
    playTicks(restored, SLICE.JAM_DURATION_TICKS - delay);
    expect(restored.snapshot().corridor).toMatchObject({ relay: 'ACTIVE', bridge: 'TRANSITIONING' });
  });

  it('does not charge an underfunded Jam and reproduces an identical timed input sequence', () => {
    const low = new SliceModel({ ...new SliceModel().serialize(), energy: 5 });
    low.markPassed();
    low.setPlayerPos(12.5, 5.5);
    low.enterCorridor();
    low.setPlayerPos(8.5, 9.5);
    expect(low.jam()).toMatchObject({ code: 'E_ENERGY_INSUFFICIENT', cost: 0 });
    expect(low.snapshot()).toMatchObject({ energy: 5, jamCooldownTicks: 0, jamRemainingTicks: 0 });
    function play() {
      const model = corridorModel();
      model.setPlayerPos(8.5, 9.5);
      model.interact();
      playTicks(model, delay);
      model.setPlayerPos(12.5, 9.5);
      model.jam();
      playTicks(model, delay);
      return model.snapshot();
    }
    expect(play()).toEqual(play());
  });

  it('rejects a corridor save on the bridge or in a conflicting state without replacing it', () => {
    const model = corridorModel();
    model.shootGuard();
    playTicks(model, 10);
    model.shootGuard();
    const checkpoint = model.serialize();
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
      removeItem: (key: string) => map.delete(key),
    });
    try {
      expect(loadSlice().status).toBe('missing');
      expect(saveSlice(checkpoint)).toBe(true);
      const newer = JSON.stringify({ ...checkpoint, tick: checkpoint.tick + 1 });
      map.set(SLICE_STORAGE_KEY, newer);
      expect(saveSlice(checkpoint)).toBe(false);
      expect(clearSlice(true)).toBe(false);
      expect(map.get(SLICE_STORAGE_KEY)).toBe(newer);

      const invalid = JSON.stringify({
        ...checkpoint, corridor: { ...checkpoint.corridor, position: { x: 12.5, y: 9.5 } },
      });
      map.set(SLICE_STORAGE_KEY, invalid);
      expect(loadSlice().status).toBe('rejected');
      expect(saveSlice(checkpoint)).toBe(false);
      expect(clearSlice(true)).toBe(false);
      expect(map.get(SLICE_STORAGE_KEY)).toBe(invalid);
      expect(clearSlice()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
