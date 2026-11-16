import { describe, expect, it } from 'vitest';
import { ExternalLinkState } from './externalLink';
import { intentFromExternalAction } from './externalLinkController';

const NEUTRAL = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };

function linkedState(): ExternalLinkState {
  const state = new ExternalLinkState({ sessionIdFactory: () => 'ses_test_1' });
  const authorized = state.authorize(true);
  expect(authorized.ok).toBe(true);
  state.connected('ses_test_1', (authorized as { epoch: number }).epoch);
  return state;
}

describe('C3-b external link state', () => {
  it('a session exists only after explicit human authorization', () => {
    const state = new ExternalLinkState({ sessionIdFactory: () => 'ses_test_1' });
    const denied = state.authorize(false);
    expect(denied.ok).toBe(false);
    expect(state.session).toBeNull();
    expect(state.snapshot().status).toBe('DISCONNECTED');
    const allowed = state.authorize(true);
    expect(allowed.ok).toBe(true);
    expect(state.session).toBe('ses_test_1');
    expect(state.snapshot().humanAuthorized).toBe(true);
  });

  it('queued intents are not "applied" until the core tick commits them', () => {
    const state = linkedState();
    const receipt = state.enqueueIntent({
      actionId: 'act_1', requestId: 'req_1', intent: NEUTRAL, applyByTick: 100, ttlTicks: 60
    }, 10);
    expect(receipt.status).toBe('queued');
    expect(receipt.appliedTick).toBeUndefined();
    expect(state.receipt('act_1')?.status).toBe('queued');
    const applied = state.commitApplied('act_1', 11);
    expect(applied?.status).toBe('applied');
    expect(applied?.appliedTick).toBe(11);
  });

  it('the same action id is never applied twice', () => {
    const state = linkedState();
    state.enqueueIntent({ actionId: 'act_1', requestId: 'req_1', intent: NEUTRAL, applyByTick: 100, ttlTicks: 60 }, 10);
    state.commitApplied('act_1', 11);
    const again = state.enqueueIntent({
      actionId: 'act_1', requestId: 'req_1', intent: NEUTRAL, applyByTick: 100, ttlTicks: 60
    }, 12);
    expect(again.status).toBe('applied');
    expect(again.appliedTick).toBe(11);
  });

  it('takeover cancels pending intents and bumps the epoch', () => {
    const state = linkedState();
    const epochBefore = state.epoch;
    state.enqueueIntent({ actionId: 'act_1', requestId: 'req_1', intent: NEUTRAL, applyByTick: 100, ttlTicks: 60 }, 10);
    const result = state.yield('takeover');
    expect(result.cancelled).toHaveLength(1);
    expect(result.cancelled[0].status).toBe('cancelled');
    expect(state.epoch).toBeGreaterThan(epochBefore);
    expect(state.pendingCount).toBe(0);
    expect(state.snapshot().status).toBe('YIELDED');
  });

  it('death / pause / scene exit / disconnect all cancel pending intents', () => {
    for (const reason of ['pause', 'death', 'scene-exit', 'disconnect', 'heartbeat-loss'] as const) {
      const state = linkedState();
      state.enqueueIntent({ actionId: 'act_x', requestId: 'req_x', intent: NEUTRAL, applyByTick: 100, ttlTicks: 60 }, 10);
      const result = state.yield(reason);
      expect(result.cancelled, reason).toHaveLength(1);
      expect(state.pendingCount, reason).toBe(0);
    }
  });

  it('disconnect degrades the link and clears the human authorization', () => {
    const state = linkedState();
    state.disconnect();
    expect(state.snapshot().status).toBe('LOST');
    expect(state.snapshot().humanAuthorized).toBe(false);
    expect(state.session).toBeNull();
    // A new intent after a disconnect is refused (no session).
    const receipt = state.enqueueIntent({
      actionId: 'act_1', requestId: 'req_1', intent: NEUTRAL, applyByTick: 100, ttlTicks: 60
    }, 10);
    expect(receipt.status).toBe('rejected');
  });

  it('stale epochs cannot enqueue (the link state is per-epoch)', () => {
    const state = linkedState();
    const epochBefore = state.epoch;
    state.yield('takeover');
    expect(state.epoch).not.toBe(epochBefore);
    const receipt = state.enqueueIntent({
      actionId: 'act_1', requestId: 'req_1', intent: NEUTRAL, applyByTick: 100, ttlTicks: 60
    }, 10);
    expect(receipt.status).toBe('rejected');
  });

  it('the pending queue is bounded', () => {
    const state = new ExternalLinkState({ sessionIdFactory: () => 'ses_test_1', maxPending: 2 });
    const authorized = state.authorize(true);
    state.connected('ses_test_1', (authorized as { epoch: number }).epoch);
    expect(state.enqueueIntent({ actionId: 'a1', requestId: 'r1', intent: NEUTRAL, applyByTick: 100, ttlTicks: 60 }, 1).status).toBe('queued');
    expect(state.enqueueIntent({ actionId: 'a2', requestId: 'r2', intent: NEUTRAL, applyByTick: 100, ttlTicks: 60 }, 1).status).toBe('queued');
    const overflow = state.enqueueIntent({ actionId: 'a3', requestId: 'r3', intent: NEUTRAL, applyByTick: 100, ttlTicks: 60 }, 1);
    expect(overflow.status).toBe('rejected');
    expect(overflow.code).toBe('E_RESOURCE_LIMIT');
    expect(state.pendingCount).toBe(2);
  });

  it('the receipt cache is bounded', () => {
    const state = new ExternalLinkState({ sessionIdFactory: () => 'ses_test_1', maxReceipts: 4 });
    const authorized = state.authorize(true);
    state.connected('ses_test_1', (authorized as { epoch: number }).epoch);
    for (let i = 0; i < 10; i += 1) {
      state.enqueueIntent({
        actionId: `a${i}`, requestId: `r${i}`, intent: NEUTRAL, applyByTick: 100, ttlTicks: 60
      }, 1);
    }
    expect(state.snapshot().pendingCount).toBeLessThanOrEqual(8);
    // The oldest receipt is dropped, but the pending intents stay bounded too.
    expect(state.receipt('a0')).toBeNull();
  });

  it('expired intents are dropped and reported as expired', () => {
    const state = linkedState();
    state.enqueueIntent({ actionId: 'act_1', requestId: 'req_1', intent: NEUTRAL, applyByTick: 12, ttlTicks: 60 }, 10);
    state.expireOverdue(12);
    expect(state.pendingCount).toBe(0);
    expect(state.receipt('act_1')?.status).toBe('expired');
  });

  it('external actions convert to legal intents only', () => {
    expect(intentFromExternalAction({ type: 'move', dir: { x: 3, y: 4 } })).toEqual({
      move: { x: 0.6, y: 0.8 }, dash: false, fire: false, aim: null, interact: false
    });
    expect(intentFromExternalAction({ type: 'fire', target: { x: 1, y: 2 } })).toEqual({
      move: { x: 0, y: 0 }, dash: false, fire: true, aim: { x: 1, y: 2 }, interact: false
    });
    expect(intentFromExternalAction({ type: 'interact' })).toEqual({
      move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: true
    });
    expect(intentFromExternalAction({ type: 'stop' })).toEqual(NEUTRAL);
  });
});
