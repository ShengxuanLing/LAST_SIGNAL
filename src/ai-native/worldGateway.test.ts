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

describe('C3-a gateway hard gates (F1/F2/F3) from independent tester findings', () => {
  it('F1: observations are monotonic; stale tick is rejected and never rolls back the baseline', () => {
    const g = gateway();
    const { session, epoch } = linked(g); // observation pushed at tick 5
    const stale = g.pushObservation(session, epoch, observation(epoch, 3), 2000);
    expect((stale as any).ok !== true).toBe(true);
    expect((stale as any).code).toBe('E_STALE_TICK');
    expect(g.listSessions()[0].tick).toBe(5);
    const r = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(aid(1), 10), nowMs: 2000 });
    expect((r as any).ok !== true).toBe(true);
    expect((r as any).acceptedTick).toBe(5);
    // Same tick is allowed (no rollback, no TTL extension beyond current max).
    expect(g.pushObservation(session, epoch, observation(epoch, 5), 2001).ok).toBe(true);
    // Newer tick advances the baseline.
    expect(g.pushObservation(session, epoch, observation(epoch, 9), 2002).ok).toBe(true);
    const r2 = g.submitActions({ sessionId: session, epoch, requestId: rid(2), actions: batch(aid(2), 10), nowMs: 2002 });
    expect((r2 as any).ok !== true).toBe(true);
    expect((r2 as any).acceptedTick).toBe(9);
  });

  it('F2: a request/action id evicted from the cache cannot be retried into the queue', () => {
    const g = gateway({ maxCacheEntries: 2, maxPendingActions: 64 });
    const { session, epoch } = linked(g);
    const first = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(aid(1), 10), nowMs: 1000 });
    expect((first as any).ok !== true).toBe(true);
    // ACK the first action so it becomes applied and stays in cache until evicted.
    const ack = g.ackAction({ sessionId: session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: 6, nowMs: 1001 });
    expect((ack as any).status).toBe('applied');
    // Flood the bounded caches so req1/actionA are evicted from the window.
    for (let i = 0; i < 10; i++) {
      g.submitActions({ sessionId: session, epoch, requestId: rid(10 + i), actions: batch(aid(10 + i), 10), nowMs: 1100 + i });
    }
    // The same request/action that fell out of the window must be rejected, not re-queued.
    const retry = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(aid(1), 10), nowMs: 1200 });
    expect((retry as any).ok !== true).toBe(true);
    expect((retry as any).code).toBe('E_RETRY_AFTER_EVICTION');
    const retryAction = g.submitActions({ sessionId: session, epoch, requestId: rid(99), actions: batch(aid(1), 10), nowMs: 1201 });
    expect((retryAction as any).ok !== true).toBe(true);
    expect((retryAction as any).code).toBe('E_RETRY_AFTER_EVICTION');
  });

  it('F3: ACK appliedTick must be within [acceptedTick, applyByTick] (no future/fake ACK)', () => {
    const g = gateway();
    const { session, epoch } = linked(g);
    const r = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(aid(1), 10), nowMs: 1000 });
    expect((r as any).ok !== true).toBe(true);
    const accepted = (r as any).acceptedTick;
    const applyBy = (r as any).applyByTick;
    // Below accepted -> schema invalid (no fake/early ACK).
    const low = g.ackAction({ sessionId: session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: accepted - 1, nowMs: 1001 });
    expect((low as any).code).toBe('E_SCHEMA');
    // A separate action is used for the above-applyBy bound so its pending is
    // actually removed by the expiry path.
    const r2 = g.submitActions({ sessionId: session, epoch, requestId: rid(2), actions: batch(aid(2), 10), nowMs: 1000 });
    const applyBy2 = (r2 as any).applyByTick;
    const high = g.ackAction({ sessionId: session, epoch, requestId: rid(2), actionId: aid(2), result: 'applied', appliedTick: applyBy2 + 1, nowMs: 1001 });
    expect((high as any).status).toBe('expired');
    // Within bounds on the original action -> applied.
    const ok = g.ackAction({ sessionId: session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: accepted + 2, nowMs: 1001 });
    expect((ok as any).status).toBe('applied');
  });
});

describe('C3-a bounded session quota and same-tick observation conflict', () => {
  const usage = (g: WorldGateway, session: string) => {
    const s = (g as any).sessions.get(session);
    return {
      total: s.requestCache.size + s.actionCache.size + s.evictedRequestIds.size + s.evictedActionIds.size,
      records: s.dedupRecords,
      pending: s.pending.length
    };
  };
  const isErr = (x: any): boolean => !!x && x.ok === false;

  it('hard quota bounds cache+evicted records and rejects new work atomically', () => {
    const g = gateway({ maxDedupRecords: 6, maxCacheEntries: 2, maxPendingActions: 64 });
    const { session, epoch } = linked(g);
    let accepted = 0;
    let rejected = 0;
    let quotaError: any = null;
    for (let i = 1; i <= 20; i++) {
      const r = g.submitActions({
        sessionId: session, epoch, requestId: rid(i),
        actions: { actions: [{ type: 'stop', actionId: aid(i) }], ttlTicks: 60 }, nowMs: 1000 + i
      });
      if (isErr(r)) {
        rejected++;
        if ((r as any).code === 'E_RESOURCE_LIMIT') quotaError = r;
      } else {
        accepted++;
        const ack = g.ackAction({
          sessionId: session, epoch, requestId: rid(i), actionId: aid(i),
          result: 'applied', appliedTick: 6, nowMs: 1001 + i
        });
        expect((ack as any).status).toBe('applied');
      }
      const u = usage(g, session);
      expect(u.total, 'cache + evicted never exceeds the hard quota').toBeLessThanOrEqual(6);
      expect(u.records).toBe(u.total);
      expect(u.pending).toBe(0);
    }
    expect(accepted).toBe(3);
    expect(rejected).toBe(17);
    expect(quotaError?.code).toBe('E_RESOURCE_LIMIT');
    // A retry of an already-accepted request cannot bypass the quota and cannot re-queue.
    const retry = g.submitActions({
      sessionId: session, epoch, requestId: rid(1),
      actions: { actions: [{ type: 'stop', actionId: aid(1) }], ttlTicks: 60 }, nowMs: 2000
    });
    if (isErr(retry)) expect((retry as any).code).toBe('E_RETRY_AFTER_EVICTION');
    else expect((retry as any).replayed).toBe(true);
    expect(g.nextAction({ sessionId: session, epoch, nowMs: 2000 })).toBeNull();
    expect(usage(g, session).total).toBeLessThanOrEqual(6);
  });

  it('quota rejection happens before enqueue and leaves no partial batch', () => {
    const g = gateway({ maxDedupRecords: 4, maxCacheEntries: 8, maxPendingActions: 64 });
    const { session, epoch } = linked(g);
    const first = g.submitActions({
      sessionId: session, epoch, requestId: rid(1),
      actions: { actions: [{ type: 'stop', actionId: aid(1) }], ttlTicks: 60 }, nowMs: 1000
    });
    expect(isErr(first)).toBe(false);
    expect(usage(g, session)).toEqual({ total: 2, records: 2, pending: 1 });
    const tooBig = g.submitActions({
      sessionId: session, epoch, requestId: rid(2),
      actions: { actions: [{ type: 'stop', actionId: aid(2) }, { type: 'stop', actionId: aid(3) }], ttlTicks: 60 },
      nowMs: 1001
    });
    expect(isErr(tooBig)).toBe(true);
    expect((tooBig as any).code).toBe('E_RESOURCE_LIMIT');
    expect(usage(g, session)).toEqual({ total: 2, records: 2, pending: 1 });
    expect((g.nextAction({ sessionId: session, epoch, nowMs: 1001 }) as any)?.actionId).toBe(aid(1));
    expect(g.nextAction({ sessionId: session, epoch, nowMs: 1001, afterActionId: aid(1) })).toBeNull();
  });

  it('tiny cache eviction stays bounded; retry after eviction is rejected', () => {
    const g = gateway({ maxDedupRecords: 6, maxCacheEntries: 1, maxPendingActions: 64 });
    const { session, epoch } = linked(g);
    const first = g.submitActions({
      sessionId: session, epoch, requestId: rid(1),
      actions: { actions: [{ type: 'stop', actionId: aid(1) }], ttlTicks: 60 }, nowMs: 1000
    });
    expect(isErr(first)).toBe(false);
    expect((g.ackAction({ sessionId: session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: 6, nowMs: 1001 }) as any).status).toBe('applied');
    // Fill the remaining quota with one more accepted request, then force eviction.
    const second = g.submitActions({
      sessionId: session, epoch, requestId: rid(2),
      actions: { actions: [{ type: 'stop', actionId: aid(2) }], ttlTicks: 60 }, nowMs: 1002
    });
    expect(isErr(second)).toBe(false);
    const third = g.submitActions({
      sessionId: session, epoch, requestId: rid(3),
      actions: { actions: [{ type: 'stop', actionId: aid(3) }], ttlTicks: 60 }, nowMs: 1003
    });
    expect(isErr(third)).toBe(false);
    expect(usage(g, session).total).toBeLessThanOrEqual(6);
    const retry = g.submitActions({
      sessionId: session, epoch, requestId: rid(1),
      actions: { actions: [{ type: 'stop', actionId: aid(1) }], ttlTicks: 60 }, nowMs: 1004
    });
    expect(isErr(retry)).toBe(true);
    expect((retry as any).code).toBe('E_RETRY_AFTER_EVICTION');
    expect(usage(g, session).total).toBeLessThanOrEqual(6);
  });

  it('same request replay is idempotent; different payload is rejected without new records', () => {
    const g = gateway({ maxDedupRecords: 16 });
    const { session, epoch } = linked(g);
    const r1 = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(aid(1)), nowMs: 1000 });
    expect(isErr(r1)).toBe(false);
    const before = usage(g, session);
    const replay = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(aid(1)), nowMs: 1001 });
    expect(isErr(replay)).toBe(false);
    expect((replay as any).replayed).toBe(true);
    expect(usage(g, session)).toEqual(before);
    const mismatch = g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(aid(2)), nowMs: 1002 });
    expect(isErr(mismatch)).toBe(true);
    expect((mismatch as any).code).toBe('E_ID_PAYLOAD_MISMATCH');
    expect(usage(g, session)).toEqual(before);
  });

  it('same-tick observation: identical payload is idempotent, conflicting payload is rejected', () => {
    const g = gateway();
    const { session, epoch } = linked(g); // tick 5
    const same = g.pushObservation(session, epoch, observation(epoch, 5), 2000);
    expect(same.ok).toBe(true);
    expect((g as any).sessions.get(session).lastObservation.roomId).toBe(0);
    const changed = observation(epoch, 5);
    changed.roomId = 1;
    const conflict = g.pushObservation(session, epoch, changed, 2001);
    expect(conflict.ok).toBe(false);
    expect((conflict as any).code).toBe('E_TICK_CONFLICT');
    expect(g.listSessions()[0].tick).toBe(5);
    // Latest authoritative content is not overwritten by the conflicting payload.
    expect((g as any).sessions.get(session).lastObservation.roomId).toBe(0);
    // A new commit tick is required to change the observation.
    changed.tick = 6;
    expect(g.pushObservation(session, epoch, changed, 2002).ok).toBe(true);
    expect((g as any).sessions.get(session).lastObservation.roomId).toBe(1);
    expect(g.listSessions()[0].tick).toBe(6);
  });

  it('cross-epoch old requests stay rejected; re-authorize allows a tick reset', () => {
    const g = gateway({ maxDedupRecords: 16 });
    const { session, epoch } = linked(g);
    expect(isErr(g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(aid(1)), nowMs: 1000 }))).toBe(false);
    expect((g.ackAction({ sessionId: session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: 6, nowMs: 1001 }) as any).status).toBe('applied');
    const yielded = g.yieldSession(session, epoch, 'human-input', 1002);
    expect(yielded.ok).toBe(true);
    const epoch2 = (yielded as any).epoch;
    expect(epoch2).toBe(epoch + 1);
    expect(g.authorize(session, epoch2, 1003).ok).toBe(true);
    expect(g.pushObservation(session, epoch2, observation(epoch2, 1), 1004).ok).toBe(true);
    const old = g.submitActions({ sessionId: session, epoch: epoch2, requestId: rid(1), actions: batch(aid(1)), nowMs: 1005 });
    expect(isErr(old)).toBe(true);
    expect((old as any).code).toBe('E_RETRY_AFTER_EVICTION');
    expect(g.nextAction({ sessionId: session, epoch: epoch2, nowMs: 1005 })).toBeNull();
    const fresh = g.submitActions({ sessionId: session, epoch: epoch2, requestId: rid(2), actions: batch(aid(2)), nowMs: 1006 });
    expect(isErr(fresh)).toBe(false);
    expect((fresh as any).acceptedTick).toBe(1);
    expect(usage(g, session).total).toBeLessThanOrEqual(16);
  });

  it('LOST retains dedup records and rejects old requests after re-authorize', () => {
    const g = gateway({ maxDedupRecords: 16, lostAfterMs: 50 });
    const { session, epoch } = linked(g);
    expect(isErr(g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(aid(1)), nowMs: 1000 }))).toBe(false);
    expect((g.ackAction({ sessionId: session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: 6, nowMs: 1001 }) as any).status).toBe('applied');
    expect(g.reapExpired(2000)).toContain(session);
    const lostEpoch = g.listSessions()[0].epoch;
    expect(lostEpoch).toBe(epoch + 1);
    expect(g.authorize(session, lostEpoch, 2001).ok).toBe(true);
    expect(g.pushObservation(session, lostEpoch, observation(lostEpoch, 1), 2001).ok).toBe(true);
    const old = g.submitActions({ sessionId: session, epoch: lostEpoch, requestId: rid(1), actions: batch(aid(1)), nowMs: 2002 });
    expect(isErr(old)).toBe(true);
    expect((old as any).code).toBe('E_RETRY_AFTER_EVICTION');
    expect(usage(g, session).total).toBeLessThanOrEqual(16);
  });

  it('pending budget recovers after ACK without exceeding the dedup quota', () => {
    const g = gateway({ maxPendingActions: 2, maxDedupRecords: 32 });
    const { session, epoch } = linked(g);
    expect(isErr(g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(aid(1)), nowMs: 1000 }))).toBe(false);
    expect(isErr(g.submitActions({ sessionId: session, epoch, requestId: rid(2), actions: batch(aid(2)), nowMs: 1001 }))).toBe(false);
    const over = g.submitActions({ sessionId: session, epoch, requestId: rid(3), actions: batch(aid(3)), nowMs: 1002 });
    expect(isErr(over)).toBe(true);
    expect((over as any).code).toBe('E_RESOURCE_LIMIT');
    expect(usage(g, session).pending).toBe(2);
    expect((g.ackAction({ sessionId: session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: 6, nowMs: 1003 }) as any).status).toBe('applied');
    expect(usage(g, session).pending).toBe(1);
    const recovered = g.submitActions({ sessionId: session, epoch, requestId: rid(3), actions: batch(aid(3)), nowMs: 1004 });
    expect(isErr(recovered)).toBe(false);
    expect(usage(g, session).pending).toBe(2);
    expect(usage(g, session).total).toBeLessThanOrEqual(32);
  });
  it('default quota bounds a long session at WORLD_LIMITS.MAX_DEDUP_RECORDS', () => {
    const g = gateway();
    const { session, epoch } = linked(g);
    let rejected = 0;
    for (let i = 1; i <= 400; i++) {
      const r = g.submitActions({
        sessionId: session, epoch, requestId: rid(i),
        actions: { actions: [{ type: 'stop', actionId: aid(i) }], ttlTicks: 60 }, nowMs: 1000 + i
      });
      if (isErr(r)) {
        rejected++;
        expect((r as any).code).toBe('E_RESOURCE_LIMIT');
      } else {
        expect((g.ackAction({ sessionId: session, epoch, requestId: rid(i), actionId: aid(i), result: 'applied', appliedTick: 6, nowMs: 1001 + i }) as any).status).toBe('applied');
      }
      const u = usage(g, session);
      expect(u.total).toBeLessThanOrEqual(WORLD_LIMITS.MAX_DEDUP_RECORDS);
      expect(u.records).toBe(u.total);
    }
    expect(rejected).toBeGreaterThan(0);
    expect(g.listSessions()[0].epoch).toBe(epoch); // quota never silently bumps epoch
  });

  it('re-adding a pending action receipt moves it back without double counting', () => {
    const g = gateway({ maxCacheEntries: 1, maxPendingActions: 8, maxDedupRecords: 8 });
    const { session, epoch } = linked(g);
    expect(isErr(g.submitActions({ sessionId: session, epoch, requestId: rid(1), actions: batch(aid(1)), nowMs: 1000 }))).toBe(false);
    // Queueing B evicts A's action-cache entry while A is still pending.
    expect(isErr(g.submitActions({ sessionId: session, epoch, requestId: rid(2), actions: batch(aid(2)), nowMs: 1001 }))).toBe(false);
    const before = usage(g, session);
    expect(before.total).toBe(before.records);
    expect((g.ackAction({ sessionId: session, epoch, requestId: rid(1), actionId: aid(1), result: 'applied', appliedTick: 6, nowMs: 1002 }) as any).status).toBe('applied');
    const after = usage(g, session);
    expect(after.total, 'moving an evicted pending receipt back into cache must not duplicate it').toBe(after.records);
    expect(after.total).toBeLessThanOrEqual(8);
  });
});
