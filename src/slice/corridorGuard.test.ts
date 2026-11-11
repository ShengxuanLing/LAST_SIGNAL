import { describe, expect, it } from 'vitest';
import { CorridorGuard } from './corridorGuard';
import { CORRIDOR } from './corridorRoom';
import { SliceModel, SLICE } from './rules';

describe('R2 guard perception', () => {
  it('keeps local vision with the uplink off and takes only position evidence from the relay', () => {
    const guard = new CorridorGuard(false);
    const local = CORRIDOR.spawn;
    const relayOnly = { x: 12.5, y: 9.5 };
    guard.advance(1, local, false, false);
    expect(guard.snapshot(1, false)).toMatchObject({
      link: 'DISCONNECTED', behavior: 'WATCHING', evidence: { ...local, observedAtTick: 1 },
    });
    guard.advance(2, relayOnly, false, true);
    expect(guard.snapshot(2, false)).toMatchObject({
      behavior: 'INVESTIGATING', evidence: { ...local, observedAtTick: 1 },
    });
    expect(guard.advance(3, relayOnly, true, true)).toBe(0);
    expect(guard.snapshot(3, true)).toMatchObject({
      link: 'LINKED', behavior: 'INVESTIGATING', evidence: { ...relayOnly, observedAtTick: 3 },
    });
    const hidden = { x: 12.5, y: 6.5 };
    guard.advance(4, hidden, true, false);
    expect(guard.snapshot(4, true).evidence).toMatchObject({ ...relayOnly, observedAtTick: 3 });
    guard.advance(3 + 8 * SLICE.TICK_HZ, hidden, false, false);
    expect(guard.snapshot(3 + 8 * SLICE.TICK_HZ, false)).toMatchObject({ behavior: 'IDLE', evidence: null });
  });

  it('cancels an uncommitted shot, investigates a fixed point, and observes anew at expiry', () => {
    const guard = new CorridorGuard(false);
    const local = { x: 5.5, y: 7.5 };
    const moved = { x: 6.5, y: 7.5 };
    guard.advance(1, local, false, false);
    guard.jam(85);
    expect(guard.advance(85, moved, true, true)).toBe(0);
    expect(guard.snapshot(85, true)).toMatchObject({
      link: 'JAMMED', sharedConnected: true, behavior: 'INVESTIGATING',
      evidence: { ...local, observedAtTick: 1 }, jamRemainingTicks: 360,
    });
    expect(guard.snapshot(85, true).position.y).toBeGreaterThan(CORRIDOR.guard.y);
    expect(guard.advance(444, moved, true, true)).toBe(0);
    expect(guard.snapshot(444, true).evidence).toMatchObject(local);
    expect(guard.advance(445, moved, true, true)).toBe(0);
    expect(guard.snapshot(445, true)).toMatchObject({
      link: 'LINKED', behavior: 'WATCHING', evidence: { ...moved, observedAtTick: 445 },
    });
    expect(guard.advance(529, moved, true, true)).toBeGreaterThan(0);
    guard.takeHit(24);
    expect(guard.advance(530, moved, true, true)).toBe(0);
    expect(guard.snapshot(530, true)).toMatchObject({ link: 'DEAD', sharedConnected: false, evidence: null });
  });

  it('keeps Jam on the selected receiver when the relay changes and keeps the lab save boundary', () => {
    const model = new SliceModel();
    expect(model.jam('guard')).toMatchObject({ code: 'E_ILLEGAL_TARGET', cost: 0 });
    model.markPassed();
    model.setPlayerPos(12.5, 5.5);
    expect(model.enterCorridor()).toBe(true);
    model.step(SLICE.TICK_MS);
    expect(model.jam('guard')).toMatchObject({ code: 'OK', cost: 25 });
    expect(model.jam('guard')).toMatchObject({ code: 'E_RETRYABLE', cost: 0 });
    expect(model.snapshot()).toMatchObject({
      jamRemainingTicks: 0, jamCooldownTicks: 480, energy: 75,
      corridor: { relay: 'INACTIVE', guard: { link: 'JAMMED', jamRemainingTicks: 360 } },
    });
    model.setPlayerPos(8.5, 9.5);
    expect(model.interact()).toMatchObject({ code: 'OK', cost: 0 });
    expect(model.snapshot().corridor).toMatchObject({
      bridge: 'TRANSITIONING', relay: 'ACTIVE', guard: { sharedConnected: true, link: 'JAMMED', jamRemainingTicks: 360 },
    });
    model.setPaused(true);
    model.step(10000);
    expect(model.snapshot().corridor?.guard.jamRemainingTicks).toBe(360);
    model.setPaused(false);
    for (let i = 0; i < 90; i++) model.step(SLICE.TICK_MS);
    expect(model.snapshot().corridor?.bridge).toBe('STABLE');
    model.setPlayerPos(16.5, 9.5);
    model.step(SLICE.TICK_MS);
    expect(model.snapshot().corridor).toMatchObject({ crossed: true, guardHp: 24 });
    expect(model.canCheckpoint).toBe(false);
    model.reset();
    expect(model.snapshot()).toMatchObject({ corridor: null, jamCooldownTicks: 0 });
  });
});
