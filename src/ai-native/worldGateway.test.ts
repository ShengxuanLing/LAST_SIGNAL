// AI-NATIVE-02 C3-a — WorldGateway tests. No simulation state, no ticks.

import { describe, expect, it } from 'vitest';
import { WorldGateway } from './worldGateway';
import { WORLD_LIMITS, WORLD_PROTOCOL_VERSION, WORLD_SCHEMA_V1 } from './worldProtocol';

const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;
const origin = 'http://localhost:5335';

function gateway(options: ConstructorParameters<typeof WorldGateway>[0] = {}) {
  return new WorldGateway({ sessionIdFactory: () => `ses_${'a'.repeat(24)}`, ...options });
}

function observation(epoch: number, tick: number) {
  return {
    schema: WORLD_SCHEMA_V1,
    protocolVersion: WORLD_PROTOCOL_VERSION,
    epoch,
    tick,
    roomId: 0,
    player: { x: 5, y: 5, hp: 100, maxHp: 100, aimYaw: 0, weaponKey: 'pulse', ammo: -1, magazine: -1 },
    drones: [{ id: 1, kind: 'drone', x: 7, y: 5, hp: 24, state: 'chase' }],
    projectiles: [],
    availableActions: ['move', 'stop', 'aim', 'fire', 'interact']
  };
}

function batch(actionId = aid(1), ticks = 10) {
  return { actions: [{ type: 'move' as const, actionId, dir: { x: 1, y: 0 }, ticks }], ttlTicks: 60 };
}

function linked(g: WorldGateway, now = 1000) {
  const linked = g.linkSession({ authorized: true, origin, nowMs: now });
  expect(linked.ok).toBe(true);
  if (!linked.ok) throw new Error('link failed');
  const pushed = g.pushObservation(linked.session, linked.epoch, observation(linked.epoch, 5), now);
  expect(pushed.ok).toBe(true);
  return { session: linked.session, epoch: linked.epoch };
}

describe('C3-a WorldGateway authorization/session', () => {
  it('requires explicit authorization and enforces the session budget', () => {
    const g = gateway({ maxSessions: 1 });
    expect(g.linkSession({ authorized: false, origin, nowMs: 1 }).ok).toBe(false);
    const a = g.linkSession({ authorized: true, origin, nowMs: 1 });
    expect(a.ok).toBe(true);
    expect(g.linkSession({ authorized: true, origin, nowMs: 2 }).ok).toBe(false);
    expect(g.listSessions()).toHaveLength(1);
    g.dispose();
    expect(g.listSessions()).toHaveLength(0);
  });

  it('accepts only the exact origin/epoch observation and never stores a token', () => {
    const g = gateway();
    const { session, epoch } = linked(g);
    expect(g.pushObservation(session, epoch + 1, observation(epoch + 1, 6), 1000).ok).toBe(false);
    expect(g.pushObservation(session, epoch, observation(epoch + 1, 6), 1000).ok).toBe(false); // observation epoch mismatch
    const view = g.listSessions()[0];
    expect(view).toEqual(expect.objectContaining({ session, epoch, status: 'connected', tick: 5 }));
    expect(JSON.stringify(view)).not.toMatch(/token|seed|rng|map/i);
  });

  it('heartbeat loss marks LOST and invalidates control; close releases', () => {
    const g = gateway({ lostAfterMs: 50 });
    const { session, epoch } = linked(g);
    expect(g.reapExpired(1049)).toEqual([]);
    expect(g.reapExpired(1051)).toEqual([session]);
    const view = g.listSessions()[0];
    expect(view.status).toBe('lost');
    expect(view.epoch).toBe(epoch + 1);
    expect((g.nextAction({ sessionId: session, epoch, nowMs: 1060 }) as any).ok).toBe(false);
    expect(g.closeSession(session, 1060).ok).toBe(true);
    expect(g.listSessions()).toHaveLength(0);
  });
});

describe('C3-a WorldGateway queue/idempotency/TTL', () => {
  it('queues without applying, then ACK marks applied', () => {
    const g = gateway();
    const { session, epoch } = linked(g);
    const receipt = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(), nowMs: 1001 });
    expect('ok' in receipt, 'batch receipt is a success shape').toBe(false);
    if ('ok' in receipt) throw new Error('unexpected error');
    expect(receipt.acceptedTick).toBe(5);
    expect(receipt.applyByTick).toBe(65);
    expect(receipt.actions[0].status).toBe('queued');
    const next = g.nextAction({ sessionId: session, epoch, nowMs: 1002 });
    expect(next && !('ok' in next) && next.actionId).toBe(aid(1));
    const ack = g.ackAction({
      sessionId: session, epoch, requestId: rid(1), actionId: aid(1),
      result: 'applied', appliedTick: 6, nowMs: 1003
    });
    expect('ok' in ack && ack.ok === false).toBe(false);
    if (!('ok' in ack)) expect(ack.status).toBe('applied');
    const replay = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(), nowMs: 1004 });
    if ('ok' in replay) throw new Error('unexpected error');
    expect(replay.replayed).toBe(true);
    expect(replay.actions[0].status).toBe('applied');
  });

  it('same request/payload replays without a second queue; different payload rejects', () => {
    const g = gateway();
    const { session, epoch } = linked(g);
    const first = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(), nowMs: 1001 });
    const second = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(), nowMs: 1002 });
    if ('ok' in first || 'ok' in second) throw new Error('unexpected error');
    expect(second.replayed).toBe(true);
    expect(g.nextAction({ sessionId: session, epoch, nowMs: 1003 })).toEqual(expect.objectContaining({ actionId: aid(1) }));
    expect(g.nextAction({ sessionId: session, epoch, afterActionId: aid(1), nowMs: 1003 })).toBeNull();
    const mismatch = g.submitActions({
      sessionId: session, epoch, requestId: rid(1),
      actions: { actions: [{ type: 'stop', actionId: aid(1) }] }, nowMs: 1004
    });
    expect('ok' in mismatch && mismatch.code).toBe('E_ID_PAYLOAD_MISMATCH');
  });

  it('duplicate actionId with different payload is rejected, stale epoch is rejected', () => {
    const g = gateway();
    const { session, epoch } = linked(g);
    const first = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(aid(1)), nowMs: 1001 });
    expect('ok' in first).toBe(false);
    const duplicate = g.submitActions({ sessionId: session, epoch, requestId: rid(2), actions: batch(aid(1), 99), nowMs: 1002 });
    expect('ok' in duplicate && duplicate.code).toBe('E_ID_PAYLOAD_MISMATCH');
    const stale = g.submitActions({ sessionId: session, epoch: epoch + 1, requestId: rid(3), actions: batch(aid(2)), nowMs: 1002 });
    expect('ok' in stale && stale.code).toBe('E_STALE_EPOCH');
  });

  it('TTL expires queued actions when observation tick passes applyByTick, ACK is expired', () => {
    const g = gateway();
    const { session, epoch } = linked(g);
    const receipt = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(aid(1), 1), nowMs: 1001 });
    if ('ok' in receipt) throw new Error('unexpected error');
    expect(receipt.applyByTick).toBe(65);
    expect(g.nextAction({ sessionId: session, epoch, nowMs: 1002 })).not.toBeNull();
    const pushed = g.pushObservation(session, epoch, observation(epoch, 66), 1003);
    expect(pushed.ok).toBe(true);
    expect(g.nextAction({ sessionId: session, epoch, nowMs: 1004 })).toBeNull();
    const ack = g.ackAction({ sessionId: session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: 66, nowMs: 1005 });
    expect((ack as any).status).toBe('expired');
    expect((ack as any).code).toBe('E_ACTION_EXPIRED');
  });

  it('yield cancels pending, bumps epoch, and old actions are invalid', () => {
    const g = gateway();
    const { session, epoch } = linked(g);
    const receipt = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(), nowMs: 1001 });
    expect('ok' in receipt).toBe(false);
    const yielded = g.yieldSession(session, epoch, 'human-input', 1002);
    expect(yielded.ok && yielded.epoch).toBe(epoch + 1);
    expect((g.nextAction({ sessionId: session, epoch, nowMs: 1003 }) as any).ok).toBe(false);
    expect((g.ackAction({ sessionId: session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: 6, nowMs: 1004 }) as any).ok).toBe(false);
    const old = g.submitActions({ sessionId: session, epoch, requestId: rid(2), actions: batch(aid(2)), nowMs: 1005 });
    expect('ok' in old && old.code).toBe('E_STALE_EPOCH');
    expect(g.authorize(session, epoch + 1, 1006).ok).toBe(true);
    expect((g.submitActions({ sessionId: session, epoch: epoch + 1, requestId: rid(3), actions: batch(aid(3)), nowMs: 1007 }) as any).ok).toBeDefined();
  });

  it('enforces pending/cache limits and ACK TTL', () => {
    const g = gateway({ maxPendingActions: 2, maxCacheEntries: 2 });
    const { session, epoch } = linked(g);
    expect((g.submitActions({
      sessionId: session, epoch, requestId: rid(1),
      actions: { actions: [{ type: 'stop', actionId: aid(1) }, { type: 'stop', actionId: aid(2) }, { type: 'stop', actionId: aid(3) }] },
      nowMs: 1001
    }) as any).ok).toBe(false);
    const first = g.submitActions({ sessionId: session, epoch, requestId: rid(2), actions: { actions: [{ type: 'stop', actionId: aid(4) }] }, nowMs: 1002 });
    expect('ok' in first).toBe(false);
    const expired = g.ackAction({ sessionId: session, epoch, requestId: rid(2), actionId: aid(4), result: 'applied', appliedTick: 1000, nowMs: 1003 });
    expect((expired as any).status).toBe('expired');
    expect((g as any).sessions.get(session).requestCache.size).toBeLessThanOrEqual(2);
    expect((g as any).sessions.get(session).actionCache.size).toBeLessThanOrEqual(2);
  });
  it('wall-time TTL expires queued actions even without a newer observation', () => {
    const g = gateway();
    const { session, epoch } = linked(g);
    const receipt = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(aid(1)), nowMs: 1000 });
    expect('ok' in receipt).toBe(false);
    expect(g.nextAction({ sessionId: session, epoch, nowMs: 1000 + 4999 })).not.toBeNull();
    expect(g.nextAction({ sessionId: session, epoch, nowMs: 1000 + 5001 })).toBeNull();
    const ack = g.ackAction({ sessionId: session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: 6, nowMs: 1000 + 5001 });
    expect((ack as any).status).toBe('expired');
    expect((ack as any).code).toBe('E_ACTION_EXPIRED');
  });

});
