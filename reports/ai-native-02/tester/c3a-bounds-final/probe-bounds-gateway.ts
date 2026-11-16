// Independent C3-a bounds probe #1 — WorldGateway: 512 hard quota, tiny-cache long flow,
// ACK/eviction edges, retries, batch atomicity, yield/LOST/authorize quota, close/dispose,
// error-path accounting, same-tick conflict, ACK bounds.
import { WorldGateway } from './src/ai-native/worldGateway';
import { WORLD_LIMITS } from './src/ai-native/worldProtocol';

const ORIGIN = 'http://localhost:5173';
const out: any = { checks: [], findings: [], flows: {}, meta: { target: 'a53bfa7', gatewayOnly: true } };
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
const obsFor = (epoch: number, tick: number, hp = 100, x = 8) => ({
  schema: 'last_signal.world.v1', protocolVersion: 1, epoch, tick, roomId: 0,
  player: { x, y: 45, hp, maxHp: 100, aimYaw: 0, weaponKey: 'pulse', ammo: -1, magazine: -1 },
  drones: [], projectiles: [], availableActions: ['move', 'stop', 'aim', 'fire', 'interact']
});
const stop = (id: string) => ({ type: 'stop', actionId: id });
const stateOf = (g: any, sid: string) => g.sessions.get(sid);
const sizes = (s: any) => ({
  dedup: s.dedupRecords,
  reqCache: s.requestCache.size, actCache: s.actionCache.size,
  evReq: s.evictedRequestIds.size, evAct: s.evictedActionIds.size,
  total: s.requestCache.size + s.actionCache.size + s.evictedRequestIds.size + s.evictedActionIds.size,
  pending: s.pending.length
});
const assertAccounting = (label: string, s: any) => {
  const x = sizes(s);
  check(`${label}-accounting`, x.dedup === x.total,
    { dedup: x.dedup, total: x.total, size: x });
  return x;
};

check('MAX_DEDUP_RECORDS-512', WORLD_LIMITS.MAX_DEDUP_RECORDS === 512, { value: WORLD_LIMITS.MAX_DEDUP_RECORDS });

// ---------- default quota: 512 records, long flow, retries, atomic quota failure ----------
{
  const g: any = gw(); // default maxDedup=512, cache=128
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  check('link-ok', s.ok === true);
  g.pushObservation(s.session, 1, obsFor(1, 1000), 0);
  const st = stateOf(g, s.session);
  const checkpoints: any[] = [];
  const N = 400;
  let firstQuotaAt = -1;
  const reqIndex = new Map<string, number>();
  for (let i = 1; i <= N; i++) {
    reqIndex.set(RID(1000 + i), i);
    const r = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(1000 + i), actions: { actions: [stop(AID(1000 + i))] }, nowMs: i });
    if ('acceptedTick' in r) {
      g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(1000 + i), actionId: AID(1000 + i), result: 'applied', appliedTick: 1000, nowMs: i });
    } else {
      if (firstQuotaAt < 0) firstQuotaAt = i;
      check(`quota-rejects-new-${i}`, r.code === 'E_RESOURCE_LIMIT', { code: r.code });
    }
    if (i === 100 || i === 200 || i === 256 || i === 300 || i === 400) {
      const x = assertAccounting(`long-${i}`, st);
      checkpoints.push({ ops: i, firstQuotaAt, ...x });
    }
  }
  out.flows.longFlow = { N, firstQuotaAt, checkpoints };
  check('quota-reached-at-512', checkpoints.some((c) => c.dedup === 512), { checkpoints });
  check('quota-bounded-not-growing', checkpoints.every((c) => c.dedup <= 512 && c.total <= 512));

  // At quota: a cached request replay still works; an evicted request is rejected with
  // E_RETRY_AFTER_EVICTION (not quota), proving retries do not recharge.
  const cacheReq = [...st.requestCache.keys()].slice(-1)[0];
  const cacheIdx = reqIndex.get(cacheReq) ?? N;
  const replay = g.submitActions({ sessionId: s.session, epoch: 1, requestId: cacheReq, actions: { actions: [stop(AID(1000 + cacheIdx))] }, nowMs: N + 1 });
  const afterReplay = assertAccounting('quota-cached-replay', st);
  check('quota-cached-replay-idempotent', 'replayed' in replay && replay.replayed === true);
  check('quota-cached-replay-no-new-charge', afterReplay.dedup === 512 && afterReplay.total === 512);
  const evictedReq = [...st.evictedRequestIds][0];
  const evRetry = g.submitActions({ sessionId: s.session, epoch: 1, requestId: evictedReq, actions: { actions: [stop(AID(1000 + N))] }, nowMs: N + 2 });
  check('quota-evicted-request-retry-rejected', evRetry.ok === false && evRetry.code === 'E_RETRY_AFTER_EVICTION');
  const evAct = [...st.evictedActionIds][0];
  const evActRetry = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(999999), actions: { actions: [stop(evAct)] }, nowMs: N + 3 });
  check('quota-evicted-action-retry-rejected', evActRetry.ok === false && evActRetry.code === 'E_RETRY_AFTER_EVICTION');
  const afterRetries = assertAccounting('quota-retries', st);
  check('quota-retries-no-charge', afterRetries.dedup === 512 && afterRetries.total === 512);

  // New batch under full quota is rejected atomically (no partial charge/queue).
  const before = sizes(st);
  const batch = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(888888), actions: { actions: [stop(AID(888880)), stop(AID(888881))] }, nowMs: N + 4 });
  check('quota-batch-rejected', batch.ok === false && batch.code === 'E_RESOURCE_LIMIT');
  const after = sizes(st);
  check('quota-batch-atomic-no-charge', JSON.stringify(before) === JSON.stringify(after), { before, after });

  // Error-path precedence at full quota: malformed payload is still E_SCHEMA; a payload
  // mismatch for a cached action may surface as quota (checked before fingerprinting) but
  // must not charge or leak either request id. Record the observed code, assert accounting.
  const cachedAid = [...st.actionCache.keys()][0];
  const malformed = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(777777), actions: { actions: [{ type: 'stop' }] }, nowMs: N + 5 });
  check('quota-malformed-is-schema', malformed.ok === false && malformed.code === 'E_SCHEMA');
  const mismatchAtQuota = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(777776), actions: { actions: [{ type: 'fire', actionId: cachedAid, ticks: 2 }] }, nowMs: N + 6 });
  out.flows.quotaMismatchCode = (mismatchAtQuota as any).code;
  check('quota-mismatch-no-charge', JSON.stringify(after) === JSON.stringify(sizes(st)), { after, now: sizes(st) });
  check('quota-mismatch-no-leak', !st.requestCache.has(RID(777776)) && !st.evictedRequestIds.has(RID(777776)) && !st.requestCache.has(RID(777777)) && !st.evictedRequestIds.has(RID(777777)));
  g.dispose();
}

// ---------- tiny cache: eviction/ACK edge stays bounded; retry not re-executed ----------
{
  const g: any = gw({ maxCacheEntries: 2, maxDedupRecords: 12 });
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  g.pushObservation(s.session, 1, obsFor(1, 10), 0);
  const st = stateOf(g, s.session);
  const acked: number[] = [];
  for (let i = 1; i <= 6; i++) {
    const r = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(2000 + i), actions: { actions: [stop(AID(2000 + i))] }, nowMs: i });
    check(`tiny-submit-${i}`, 'acceptedTick' in r, { code: (r as any).code });
    if ('acceptedTick' in r) {
      const a = g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(2000 + i), actionId: AID(2000 + i), result: 'applied', appliedTick: 10, nowMs: i });
      if ('ok' in a === false && a.status === 'applied') acked.push(i);
    }
    const x = assertAccounting(`tiny-${i}`, st);
    check(`tiny-bounded-${i}`, x.total <= 12);
  }
  out.flows.tiny = { acked, sizes: sizes(st) };
  // Retry evicted request/action after eviction while quota remains
  const evReq = [...st.evictedRequestIds][0];
  const evAct = [...st.evictedActionIds][0];
  check('tiny-evicted-request-retry', evReq !== undefined && g.submitActions({ sessionId: s.session, epoch: 1, requestId: evReq, actions: { actions: [stop(evAct ?? AID(3000))] }, nowMs: 99 }).code === 'E_RETRY_AFTER_EVICTION');
  check('tiny-bounded-after-retry', sizes(st).total <= 12 && sizes(st).dedup === sizes(st).total);
  g.dispose();
}

// ---------- tiny cache, longer flow: every eviction/ACK edge stays exactly bounded ----------
{
  const g: any = gw({ maxCacheEntries: 2, maxDedupRecords: 64 });
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  g.pushObservation(s.session, 1, obsFor(1, 20), 0);
  const st = stateOf(g, s.session);
  const checkpoints: any[] = [];
  let quotaAt = -1;
  for (let i = 1; i <= 40; i++) {
    const r = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(3000 + i), actions: { actions: [stop(AID(3000 + i))] }, nowMs: i });
    if ('acceptedTick' in r) {
      g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(3000 + i), actionId: AID(3000 + i), result: 'applied', appliedTick: 20, nowMs: i });
    } else {
      if (quotaAt < 0) quotaAt = i;
      check(`tiny-long-quota-reject-${i}`, r.code === 'E_RESOURCE_LIMIT');
    }
    if (i % 8 === 0 || i === 32 || i === 33) {
      const x = assertAccounting(`tiny-long-${i}`, st);
      check(`tiny-long-bound-${i}`, x.total <= 64);
      checkpoints.push({ ops: i, quotaAt, ...x });
    }
  }
  out.flows.tinyLong = { quotaAt, checkpoints };
  check('tiny-long-quota-at-64', checkpoints.some((c) => c.dedup === 64));
  const evReq = [...st.evictedRequestIds][0];
  const evAct = [...st.evictedActionIds][0];
  const retryReq = g.submitActions({ sessionId: s.session, epoch: 1, requestId: evReq, actions: { actions: [stop(AID(3999))] }, nowMs: 99 });
  check('tiny-long-evicted-request-retry', retryReq.ok === false && retryReq.code === 'E_RETRY_AFTER_EVICTION');
  const retryAct = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(3998), actions: { actions: [stop(evAct)] }, nowMs: 99 });
  check('tiny-long-evicted-action-retry', retryAct.ok === false && retryAct.code === 'E_RETRY_AFTER_EVICTION');
  check('tiny-long-no-growth-after-retry', sizes(st).dedup === 64 && sizes(st).total === 64);
  g.dispose();
}

// ---------- batch quota atomicity (small quota) ----------
{
  const g: any = gw({ maxCacheEntries: 2, maxDedupRecords: 8 });
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  g.pushObservation(s.session, 1, obsFor(1, 50), 0);
  const st = stateOf(g, s.session);
  for (let i = 1; i <= 3; i++) {
    const r = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(4000 + i), actions: { actions: [stop(AID(4000 + i))] }, nowMs: i });
    check(`batchfill-${i}`, 'acceptedTick' in r);
    g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(4000 + i), actionId: AID(4000 + i), result: 'rejected', nowMs: i });
  }
  check('batchfill-quota-6', sizes(st).dedup === 6, { sizes: sizes(st) });
  const before = sizes(st);
  const over = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(4100), actions: { actions: [stop(AID(4100)), stop(AID(4101))] }, nowMs: 5 });
  check('batch-quota-rejected', over.ok === false && over.code === 'E_RESOURCE_LIMIT', { code: (over as any).code });
  check('batch-quota-atomic', JSON.stringify(before) === JSON.stringify(sizes(st)), { before, after: sizes(st) });
  const fits = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(4200), actions: { actions: [stop(AID(4200))] }, nowMs: 6 });
  check('batch-quota-exact-fit', 'acceptedTick' in fits);
  check('batch-quota-exact-fit-8', sizes(st).dedup === 8, { sizes: sizes(st) });
  check('batch-quota-no-partial-ids', !st.actionCache.has(AID(4100)) && !st.actionCache.has(AID(4101)) &&
    !st.evictedActionIds.has(AID(4100)) && !st.evictedActionIds.has(AID(4101)) &&
    !st.requestCache.has(RID(4100)) && !st.evictedRequestIds.has(RID(4100)));
  g.dispose();
}

// ---------- yield / LOST / authorize do not bypass quota; records retained ----------
{
  const g: any = gw({ maxCacheEntries: 2, maxDedupRecords: 8 });
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  g.pushObservation(s.session, 1, obsFor(1, 10), 0);
  const st = stateOf(g, s.session);
  for (let i = 1; i <= 4; i++) {
    g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(5000 + i), actions: { actions: [stop(AID(5000 + i))] }, nowMs: i });
    g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(5000 + i), actionId: AID(5000 + i), result: 'rejected', nowMs: i });
  }
  const full = sizes(st);
  check('yield-setup-full-8', full.dedup === 8, { full });
  const y = g.yieldSession(s.session, 1, 'human-input', 10);
  check('yield-bumps-epoch', y.ok && y.epoch === 2);
  const afterYield = assertAccounting('yield', st);
  check('yield-retains-quota-records', afterYield.dedup === 8 && afterYield.total === 8, { afterYield });
  check('yield-clears-caches', afterYield.reqCache === 0 && afterYield.actCache === 0);
  const reauth = g.authorize(s.session, 2, 11);
  check('yield-authorize-ok', reauth.ok && reauth.epoch === 2);
  g.pushObservation(s.session, 2, obsFor(2, 1), 11);
  const newWork = g.submitActions({ sessionId: s.session, epoch: 2, requestId: RID(5100), actions: { actions: [stop(AID(5100))] }, nowMs: 12 });
  check('yield-authorize-quota-not-bypassed', newWork.ok === false && newWork.code === 'E_RESOURCE_LIMIT', { code: (newWork as any).code });
  const oldReq = [...st.evictedRequestIds][0];
  const oldRetry = g.submitActions({ sessionId: s.session, epoch: 2, requestId: oldReq, actions: { actions: [stop(AID(5101))] }, nowMs: 13 });
  check('yield-old-request-retry-rejected', oldRetry.ok === false && oldRetry.code === 'E_RETRY_AFTER_EVICTION');
  const afterYieldOps = assertAccounting('yield-after-ops', st);
  check('yield-still-bounded', afterYieldOps.dedup === 8 && afterYieldOps.total === 8);
  // LOST: same retention, quota not reset
  g.authorize(s.session, 2, 14);
  g.reapExpired(14 + 1_000_000);
  const afterLost = assertAccounting('lost', st);
  check('lost-retains-quota-records', afterLost.dedup === 8 && afterLost.total === 8);
  check('lost-clears-caches', afterLost.reqCache === 0 && afterLost.actCache === 0);
  const lostReauth = g.authorize(s.session, 3, 15);
  check('lost-authorize-ok', lostReauth.ok && lostReauth.epoch === 3);
  g.pushObservation(s.session, 3, obsFor(3, 1), 15);
  const lostWork = g.submitActions({ sessionId: s.session, epoch: 3, requestId: RID(5200), actions: { actions: [stop(AID(5200))] }, nowMs: 16 });
  check('lost-authorize-quota-not-bypassed', lostWork.ok === false && lostWork.code === 'E_RESOURCE_LIMIT');
  // close releases; new handshake = fresh quota; explicit authorized=true again
  const sid = s.session;
  const closed = g.closeSession(sid, 17);
  check('close-ok', closed.ok === true && g.sessions.size === 0);
  const denied = g.linkSession({ authorized: false, origin: ORIGIN, nowMs: 18 });
  check('new-session-requires-authorized-true', denied.ok === false && denied.code === 'E_PERMISSION');
  const fresh = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 18 });
  const freshSt = stateOf(g, fresh.session);
  check('new-session-fresh-quota', freshSt.dedupRecords === 0 && sizes(freshSt).total === 0);
  g.pushObservation(fresh.session, 1, obsFor(1, 1), 18);
  const freshWork = g.submitActions({ sessionId: fresh.session, epoch: 1, requestId: RID(5300), actions: { actions: [stop(AID(5300))] }, nowMs: 19 });
  check('new-session-can-work', 'acceptedTick' in freshWork);
  g.dispose();
  check('dispose-clears', g.sessions.size === 0);
}

// ---------- error paths: no accidental charge / leaked records ----------
{
  const g: any = gw({ maxCacheEntries: 2, maxDedupRecords: 16 });
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  g.pushObservation(s.session, 1, obsFor(1, 20), 0);
  const st = stateOf(g, s.session);
  const base = sizes(st);
  // schema error
  const bad = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(6000), actions: { actions: [{ type: 'stop' }] }, nowMs: 1 });
  check('error-schema', bad.ok === false && bad.code === 'E_SCHEMA');
  check('error-schema-no-charge', JSON.stringify(base) === JSON.stringify(sizes(st)), { base, after: sizes(st) });
  check('error-schema-no-leak-id', !st.requestCache.has(RID(6000)) && !st.evictedRequestIds.has(RID(6000)) &&
    !st.actionCache.has(AID(6000)) && !st.evictedActionIds.has(AID(6000)));
  // valid submit then request payload mismatch
  g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(6001), actions: { actions: [stop(AID(6001))] }, nowMs: 2 });
  const afterValid = sizes(st);
  const mismatchReq = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(6001), actions: { actions: [stop(AID(6002))] }, nowMs: 3 });
  check('error-request-payload-mismatch', mismatchReq.ok === false && mismatchReq.code === 'E_ID_PAYLOAD_MISMATCH');
  check('error-request-mismatch-no-charge', JSON.stringify(afterValid) === JSON.stringify(sizes(st)));
  // action payload mismatch under a new request: no charge
  const mismatchAct = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(6003), actions: { actions: [{ type: 'stop', actionId: AID(6001), extra: 1 } as any] }, nowMs: 4 });
  check('error-action-payload-mismatch', mismatchAct.ok === false);
  check('error-action-mismatch-no-charge', JSON.stringify(afterValid) === JSON.stringify(sizes(st)));
  // ACK wrong request: pending stays, no charge
  const pendingBefore = sizes(st).pending;
  const wrongAck = g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(6999), actionId: AID(6001), result: 'applied', appliedTick: 21, nowMs: 5 });
  check('error-ack-wrong-request', 'ok' in wrongAck && wrongAck.ok === false && wrongAck.code === 'E_ID_PAYLOAD_MISMATCH');
  check('error-ack-no-charge-pending-intact', sizes(st).pending === pendingBefore);
  // ACK below accepted -> E_SCHEMA, no charge, pending intact
  const lowAck = g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(6001), actionId: AID(6001), result: 'applied', appliedTick: 19, nowMs: 5 });
  check('error-ack-below-accepted', 'ok' in lowAck && lowAck.ok === false && lowAck.code === 'E_SCHEMA');
  check('error-ack-below-no-charge', sizes(st).pending === pendingBefore);
  g.dispose();
}

// ---------- same-tick contract / TTL baseline / epoch reset ----------
{
  const g: any = gw();
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  const o1 = g.pushObservation(s.session, 1, obsFor(1, 30, 100, 8), 0);
  check('same-tick-first-ok', o1.ok === true && o1.tick === 30);
  const o2 = g.pushObservation(s.session, 1, obsFor(1, 30, 100, 8), 1);
  check('same-tick-same-payload-idempotent', o2.ok === true && o2.tick === 30);
  const o3 = g.pushObservation(s.session, 1, obsFor(1, 30, 90, 9), 2);
  check('same-tick-different-payload-409', o3.ok === false && o3.code === 'E_TICK_CONFLICT', { code: (o3 as any).code });
  const viewTick = g.listSessions().find((x: any) => x.session === s.session)?.tick;
  check('same-tick-conflict-latest-unchanged', viewTick === 30);
  const q = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(7000), actions: { actions: [stop(AID(7000))], ttlTicks: 5 }, nowMs: 3 });
  check('same-tick-conflict-TTL-baseline', 'acceptedTick' in q && q.acceptedTick === 30 && q.applyByTick === 35);
  const old = g.pushObservation(s.session, 1, obsFor(1, 29), 4);
  check('old-tick-rejected', old.ok === false && old.code === 'E_STALE_TICK');
  const afterOld = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(7001), actions: { actions: [stop(AID(7001))], ttlTicks: 5 }, nowMs: 5 });
  check('old-tick-TTL-not-rolled-back', 'acceptedTick' in afterOld && afterOld.acceptedTick === 30);
  // same tick same payload still idempotent after the conflict and old-tick attempts
  const o4 = g.pushObservation(s.session, 1, obsFor(1, 30, 100, 8), 6);
  check('same-tick-idempotent-after-conflict', o4.ok === true && o4.tick === 30);
  // epoch reset after explicit authorize
  const y = g.yieldSession(s.session, 1, 'human-input', 7);
  check('yield-for-reset', y.ok && y.epoch === 2);
  const re = g.authorize(s.session, 2, 8);
  check('explicit-authorize-reset', re.ok && re.epoch === 2);
  const reset = g.pushObservation(s.session, 2, obsFor(2, 1), 9);
  check('new-epoch-tick-reset-allowed', reset.ok === true && reset.tick === 1);
  const qReset = g.submitActions({ sessionId: s.session, epoch: 2, requestId: RID(7002), actions: { actions: [stop(AID(7002))], ttlTicks: 5 }, nowMs: 10 });
  check('new-epoch-TTL-baseline-reset', 'acceptedTick' in qReset && qReset.acceptedTick === 1 && qReset.applyByTick === 6);
  g.dispose();
}

// ---------- ACK bounds (accepted <= applied <= deadline) ----------
{
  const g: any = gw();
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  g.pushObservation(s.session, 1, obsFor(1, 40), 0);
  g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(8000), actions: { actions: [stop(AID(8000))], ttlTicks: 5 }, nowMs: 1 });
  const below = g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(8000), actionId: AID(8000), result: 'applied', appliedTick: 39, nowMs: 2 });
  check('ack-below-accepted-rejected', 'ok' in below && below.ok === false && below.code === 'E_SCHEMA');
  const atAccepted = g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(8000), actionId: AID(8000), result: 'applied', appliedTick: 40, nowMs: 2 });
  check('ack-at-accepted-ok', 'ok' in atAccepted === false && atAccepted.status === 'applied');
  g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(8001), actions: { actions: [stop(AID(8001))], ttlTicks: 5 }, nowMs: 3 });
  const atDeadline = g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(8001), actionId: AID(8001), result: 'applied', appliedTick: 45, nowMs: 3 });
  check('ack-at-deadline-ok', 'ok' in atDeadline === false && atDeadline.status === 'applied');
  g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(8002), actions: { actions: [stop(AID(8002))], ttlTicks: 5 }, nowMs: 4 });
  const above = g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(8002), actionId: AID(8002), result: 'applied', appliedTick: 46, nowMs: 4 });
  check('ack-above-deadline-expired', 'ok' in above === false && above.status === 'expired');
  g.dispose();
}

// ---------- pending budget + cleanup ----------
{
  const g: any = gw({ maxPendingActions: 2 });
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  g.pushObservation(s.session, 1, obsFor(1, 60), 0);
  g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(9000), actions: { actions: [stop(AID(9000))] }, nowMs: 1 });
  g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(9001), actions: { actions: [stop(AID(9001))] }, nowMs: 1 });
  const over = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(9002), actions: { actions: [stop(AID(9002))] }, nowMs: 1 });
  check('pending-limit', over.ok === false && over.code === 'E_RESOURCE_LIMIT');
  g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(9000), actionId: AID(9000), result: 'rejected', nowMs: 2 });
  const after = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(9003), actions: { actions: [stop(AID(9003))] }, nowMs: 2 });
  check('pending-release-after-ack', 'acceptedTick' in after);
  g.dispose();
}

out.meta.endedUtc = new Date().toISOString();
console.log(JSON.stringify(out, null, 2));
console.log(out.checks.every((c: any) => c.ok) ? 'BOUNDS_GATEWAY_PROBE_PASS' : 'BOUNDS_GATEWAY_PROBE_FAIL');
