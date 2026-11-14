// Independent C3-a fixes probe #1 — direct WorldGateway contracts (F1/F2/F3 + memory).
// Correct-contract assertions (not flipped old probes): stale tick rejected, TTL baseline
// unchanged, same-tick last-write-wins, epoch tick reset, evicted retry rejected, batch
// atomicity, ACK bounds, cache/pending bounded, evicted-id memory growth, release on
// yield/lost/close/dispose.
import { WorldGateway } from './src/ai-native/worldGateway';
import { WORLD_LIMITS } from './src/ai-native/worldProtocol';

const ORIGIN = 'http://localhost:5173';
const out: any = {
  checks: [], findings: [], flows: {},
  limits: { ...WORLD_LIMITS },
  meta: { target: '0ac1814', gatewayOnly: true, fakeSessionFactory: true }
};
const check = (name: string, ok: boolean, detail?: any) => {
  out.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) process.exitCode = 1;
};
const finding = (name: string, detail: any) => out.findings.push({ name, detail });
const hex = (n: number) => n.toString(16).padStart(24, '0');
const RID = (n: number) => `req_${hex(n)}`;
const AID = (n: number) => `aid_${hex(n)}`;

let seq = 0;
const factory = () => `ses_${String(++seq).padStart(24, '0')}`;
const gw = (opts: any = {}) => new WorldGateway({ sessionIdFactory: factory, ...opts });
const obsFor = (epoch: number, tick: number, extra: any = {}) => ({
  schema: 'last_signal.world.v1', protocolVersion: 1, epoch, tick, roomId: 0,
  player: { x: 8, y: 45, hp: 100, maxHp: 100, aimYaw: 0, weaponKey: 'pulse', ammo: -1, magazine: -1 },
  drones: [], projectiles: [], availableActions: ['move', 'stop', 'aim', 'fire', 'interact'],
  ...extra
});
const stop = (id: string) => ({ type: 'stop', actionId: id });
const stateOf = (g: any, sid: string) => g.sessions.get(sid);

// ---------- F1: monotonic observation / TTL baseline / same tick / epoch reset ----------
{
  const g: any = gw();
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  check('link-ok', s.ok === true);
  const o5 = g.pushObservation(s.session, 1, obsFor(1, 5), 1);
  check('obs-tick5-ok', o5.ok === true && o5.tick === 5);
  const stale = g.pushObservation(s.session, 1, obsFor(1, 4), 2);
  check('F1-stale-tick-rejected', stale.ok === false && stale.code === 'E_STALE_TICK');
  const tickAfter = g.listSessions().find((x: any) => x.session === s.session)?.tick;
  check('F1-latest-tick-not-rolled-back', tickAfter === 5);
  const q = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(1), actions: { actions: [stop(AID(1))], ttlTicks: 10 }, nowMs: 3 });
  check('F1-TTL-baseline-unchanged', 'acceptedTick' in q && q.acceptedTick === 5 && q.applyByTick === 15, { acceptedTick: (q as any).acceptedTick });
  // same tick: allowed, last-write-wins (documented policy)
  const same = g.pushObservation(s.session, 1, obsFor(1, 5, { player: { x: 9, y: 45, hp: 90, maxHp: 100, aimYaw: 0, weaponKey: 'pulse', ammo: -1, magazine: -1 } }), 4);
  check('same-tick-policy-last-write-wins', same.ok === true && same.tick === 5);
  const afterSame = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(2), actions: { actions: [stop(AID(2))] }, nowMs: 5 });
  check('same-tick-TTL-baseline-still-5', 'acceptedTick' in afterSame && afterSame.acceptedTick === 5);
  // epoch reset: yield -> epoch 2, lower tick is legitimate
  const y = g.yieldSession(s.session, 1, 'human-input', 6);
  check('yield-bumps-epoch', y.ok === true && y.epoch === 2);
  const reauth = g.authorize(s.session, 2, 7);
  check('yield-explicit-reauthorize', reauth.ok === true && reauth.epoch === 2);
  const resetObs = g.pushObservation(s.session, 2, obsFor(2, 1), 7);
  check('epoch-tick-reset-accepted', resetObs.ok === true && resetObs.tick === 1);
  const q2 = g.submitActions({ sessionId: s.session, epoch: 2, requestId: RID(3), actions: { actions: [stop(AID(3))], ttlTicks: 5 }, nowMs: 8 });
  check('epoch-reset-TTL-baseline', 'acceptedTick' in q2 && q2.acceptedTick === 1 && q2.applyByTick === 6);
  g.dispose();
}

// ---------- F2: evicted request/action never re-executes; batch atomicity ----------
{
  const g: any = gw({ maxCacheEntries: 2 });
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  g.pushObservation(s.session, 1, obsFor(1, 100), 0);
  // request X / action A applied
  const qx = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(10), actions: { actions: [stop(AID(10))] }, nowMs: 1 });
  check('evict-setup-queue', 'acceptedTick' in qx);
  const ax = g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(10), actionId: AID(10), result: 'applied', appliedTick: 101, nowMs: 2 });
  check('evict-setup-applied', 'ok' in ax === false && ax.status === 'applied');
  // evict X/A by more unique requests/actions
  for (let i = 11; i <= 16; i++) {
    g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(i), actions: { actions: [stop(AID(i))] }, nowMs: 3 });
    g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(i), actionId: AID(i), result: 'rejected', nowMs: 4 });
  }
  const st: any = stateOf(g, s.session);
  check('F2-request-id-evicted', st.evictedRequestIds.has(RID(10)), { size: st.evictedRequestIds.size });
  check('F2-action-id-evicted', st.evictedActionIds.has(AID(10)), { size: st.evictedActionIds.size });
  const retryReq = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(10), actions: { actions: [stop(AID(10))] }, nowMs: 5 });
  check('F2-evicted-request-rejected', retryReq.ok === false && retryReq.code === 'E_RETRY_AFTER_EVICTION');
  const retryAct = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(99), actions: { actions: [stop(AID(10))] }, nowMs: 5 });
  check('F2-evicted-action-rejected', retryAct.ok === false && retryAct.code === 'E_RETRY_AFTER_EVICTION');
  const pendingIds = (stateOf(g, s.session)?.pending ?? []).map((p: any) => p.actionId);
  check('F2-no-re-queue', !pendingIds.includes(AID(10)) && !pendingIds.includes(AID(99)));
  // batch atomicity with an evicted action in the middle
  const before = pendingIds.length;
  const batch = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(98), actions: { actions: [stop(AID(5)), stop(AID(10)), stop(AID(6))] }, nowMs: 6 });
  check('F2-batch-with-evicted-action-rejected', batch.ok === false && batch.code === 'E_RETRY_AFTER_EVICTION');
  const after = (stateOf(g, s.session)?.pending ?? []).map((p: any) => p.actionId);
  check('F2-batch-atomic-no-partial', after.length === before && !after.includes(AID(5)) && !after.includes(AID(6)), { before, after });
  g.dispose();
}

// ---------- F3: ACK accepted <= applied <= deadline ----------
{
  const g: any = gw();
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  g.pushObservation(s.session, 1, obsFor(1, 50), 0); // acceptedTick 50, ttl 5 => deadline 55
  g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(20), actions: { actions: [stop(AID(20))], ttlTicks: 5 }, nowMs: 1 });
  const below = g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(20), actionId: AID(20), result: 'applied', appliedTick: 49, nowMs: 2 });
  check('F3-ack-below-accepted-rejected', below.ok === false && below.code === 'E_SCHEMA');
  const atAccepted = g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(20), actionId: AID(20), result: 'applied', appliedTick: 50, nowMs: 2 });
  check('F3-ack-at-accepted-ok', 'ok' in atAccepted === false && atAccepted.status === 'applied');
  // at deadline accepted
  g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(21), actions: { actions: [stop(AID(21))], ttlTicks: 5 }, nowMs: 3 });
  const atDeadline = g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(21), actionId: AID(21), result: 'applied', appliedTick: 55, nowMs: 3 });
  check('F3-ack-at-deadline-ok', 'ok' in atDeadline === false && atDeadline.status === 'applied');
  // above deadline -> expired
  g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(22), actions: { actions: [stop(AID(22))], ttlTicks: 5 }, nowMs: 4 });
  const above = g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(22), actionId: AID(22), result: 'applied', appliedTick: 56, nowMs: 4 });
  check('F3-ack-above-deadline-expired', 'ok' in above === false && above.status === 'expired');
  g.dispose();
}

// ---------- Bounded caches / pending vs UNBOUNDED evicted-id sets ----------
{
  const g: any = gw({ maxCacheEntries: 2 });
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  g.pushObservation(s.session, 1, obsFor(1, 100), 0);
  const st: any = stateOf(g, s.session);
  const heap0 = process.memoryUsage().heapUsed;
  const checkpoints: any[] = [];
  const N = 3000;
  for (let i = 1; i <= N; i++) {
    g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(10000 + i), actions: { actions: [stop(AID(10000 + i))] }, nowMs: i });
    g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(10000 + i), actionId: AID(10000 + i), result: 'rejected', nowMs: i });
    if (i % 1000 === 0) checkpoints.push({ ops: i, evictedReq: st.evictedRequestIds.size, evictedAct: st.evictedActionIds.size, reqCache: st.requestCache.size, actCache: st.actionCache.size, pending: st.pending.length, heapMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1) });
  }
  const heap1 = process.memoryUsage().heapUsed;
  out.flows.evictedGrowth = { checkpoints, heapDeltaMB: +((heap1 - heap0) / 1048576).toFixed(2), maxCacheEntries: 2, ops: N };
  check('caches-bounded', st.requestCache.size <= 2 && st.actionCache.size <= 2, { req: st.requestCache.size, act: st.actionCache.size });
  check('pending-empty', st.pending.length === 0);
  const linear = checkpoints.length === 3 && checkpoints[2].evictedReq > checkpoints[1].evictedReq && checkpoints[1].evictedReq > checkpoints[0].evictedReq;
  if (linear) {
    finding('unbounded-evicted-id-memory', {
      note: 'evictedRequestIds/evictedActionIds are intentionally uncapped; a single long-lived connected session grows both sets linearly with every cache eviction. There is no session total-operation cap or monotonic watermark to bound them. The ring audit trail is capped but is not the dedupe authority.',
      checkpoints,
      heapDeltaMB: out.flows.evictedGrowth.heapDeltaMB,
      release: 'see yield/lost/close/dispose checks below'
    });
  } else {
    check('evicted-sets-bounded', false, { checkpoints });
  }
  const reqSizeBefore = st.evictedRequestIds.size;
  const actSizeBefore = st.evictedActionIds.size;
  // yield: are the sets released on epoch bump?
  g.yieldSession(s.session, 1, 'human-input', N + 1);
  check('yield-clears-pending-caches', st.pending.length === 0 && st.requestCache.size === 0 && st.actionCache.size === 0);
  const afterYield = { req: st.evictedRequestIds.size, act: st.evictedActionIds.size };
  out.flows.evictedAfterYield = { before: { req: reqSizeBefore, act: actSizeBefore }, after: afterYield };
  if (afterYield.req > 0 || afterYield.act > 0) {
    finding('evicted-sets-not-released-on-yield', {
      note: 'yieldSession bumps epoch and clears pending/caches but leaves evictedRequestIds/evictedActionIds intact; memory is not released at epoch rollover and old ids stay rejected in the new epoch',
      before: { req: reqSizeBefore, act: actSizeBefore }, after: afterYield
    });
  }
  // reconnect explicitly, then lose the session; epoch bump must still clear pending/caches
  g.authorize(s.session, 2, N + 2);
  g.pushObservation(s.session, 2, obsFor(2, 1), N + 2);
  g.submitActions({ sessionId: s.session, epoch: 2, requestId: RID(20001), actions: { actions: [stop(AID(20001))] }, nowMs: N + 2 });
  g.reapExpired(N + 2 + 100000);
  check('lost-clears-pending-caches', st.pending.length === 0 && st.requestCache.size === 0 && st.actionCache.size === 0);
  const afterLost = { req: st.evictedRequestIds.size, act: st.evictedActionIds.size };
  out.flows.evictedAfterLost = afterLost;
  if (afterLost.req > 0 || afterLost.act > 0) {
    finding('evicted-sets-not-released-on-lost', {
      note: 'reapExpired marks LOST and clears pending/caches but leaves evicted ids; only close/dispose drops the session object',
      after: afterLost
    });
  }
  // close: session dropped -> sets unreachable; dispose: all dropped
  const sid = s.session;
  g.closeSession(sid, N + 3);
  check('close-drops-session', g.sessions.size === 0 && g.sessionOrigin(sid) === null);
  const g2: any = gw();
  const s2 = g2.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  g2.pushObservation(s2.session, 1, obsFor(1, 1), 0);
  g2.dispose();
  check('dispose-clears-all', g2.sessions.size === 0);
  g.dispose();
}

// ---------- budget release across ACK/expiry ----------
{
  const g: any = gw({ maxPendingActions: 2 });
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  g.pushObservation(s.session, 1, obsFor(1, 100), 0);
  g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(30), actions: { actions: [stop(AID(30))] }, nowMs: 1 });
  g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(31), actions: { actions: [stop(AID(31))] }, nowMs: 1 });
  const over = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(32), actions: { actions: [stop(AID(32))] }, nowMs: 1 });
  check('pending-limit-enforced', over.ok === false && over.code === 'E_RESOURCE_LIMIT');
  g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(30), actionId: AID(30), result: 'rejected', nowMs: 2 });
  const after = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(33), actions: { actions: [stop(AID(33))] }, nowMs: 2 });
  check('budget-released-after-ack', 'acceptedTick' in after);
  // tick expiry releases budget
  g.pushObservation(s.session, 1, obsFor(1, 300), 3);
  check('tick-expiry-released', stateOf(g, s.session).pending.length === 0);
  const afterExpiry = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(34), actions: { actions: [stop(AID(34))] }, nowMs: 4 });
  check('budget-released-after-expiry', 'acceptedTick' in afterExpiry);
  g.dispose();
}

console.log(JSON.stringify(out, null, 2));
console.log(out.checks.every((c: any) => c.ok) ? 'GATEWAY_FIXES_PROBE_PASS' : 'GATEWAY_FIXES_PROBE_FAIL');
