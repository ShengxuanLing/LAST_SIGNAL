// Independent C3-a probe #2 — direct WorldGateway semantics (no World, no Phaser).
// Covers: auth/session budget, observation whitelist + stale-tick rollback + TTL extension,
// idempotency (request/action), batch partial commit, ACK forgery/cross-session/TTL,
// tick+wall TTL, pending/cache budget release, cache eviction re-execution,
// yield/lost/old epoch, close/dispose, actor/seed override rejection.
import { WorldGateway } from './src/ai-native/worldGateway';
import { WORLD_LIMITS } from './src/ai-native/worldProtocol';

const ORIGIN = 'http://localhost:5173';
const out: any = { checks: [], findings: [], flows: {}, limits: { ...WORLD_LIMITS } };
const hex = (n: number) => n.toString(16).padStart(24, '0');
const AID = (n: number) => `aid_${hex(n)}`;
const RID = (n: number) => `req_${hex(n)}`;

const check = (name: string, ok: boolean, detail?: any) => {
  out.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) process.exitCode = 1;
};
const finding = (name: string, detail: any) => out.findings.push({ name, detail });

let seq = 0;
const factory = () => `ses_tester_${String(++seq).padStart(4, '0')}`;
const gw = (opts: any = {}) => new WorldGateway({ sessionIdFactory: factory, ...opts });
const obsFor = (epoch: number, tick: number, extra: any = {}) => ({
  schema: 'last_signal.world.v1', protocolVersion: 1, epoch, tick, roomId: 0,
  player: { x: 8, y: 45, hp: 100, maxHp: 100, aimYaw: 0, weaponKey: 'pulse', ammo: -1, magazine: -1 },
  drones: [], projectiles: [], availableActions: ['move', 'stop', 'aim', 'fire', 'interact'],
  ...extra
});
const act = (actionId: string, type = 'stop', extra: any = {}) => ({ type, actionId, ...(type === 'move' ? { dir: { x: 1, y: 0 }, ticks: 1 } : {}), ...(type === 'fire' ? { ticks: 1 } : {}), ...extra });

// 1) Authorization / session budget / close
{
  const g = gw({ maxSessions: 2 });
  const denied = g.linkSession({ authorized: false, origin: ORIGIN, nowMs: 0 });
  check('link-requires-authorized-true', !denied.ok && denied.code === 'E_PERMISSION');
  const a = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  const b = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  const c = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  check('session-budget', a.ok && b.ok && !c.ok && c.code === 'E_RESOURCE_LIMIT');
  if (a.ok) {
    g.closeSession(a.session, 1);
    const after = g.heartbeat(a.session, 1, 2);
    check('close-removes-session', !after.ok && after.code === 'E_SESSION_NOT_FOUND' && !g.listSessions().some((s) => s.session === a.session));
  }
  g.dispose();
  check('dispose-clears', g.listSessions().length === 0);
}

// 2) Observation whitelist + stale tick rollback + TTL extension
{
  const g = gw();
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  if (!s.ok) throw new Error('link failed');
  const hidden = g.pushObservation(s.session, 1, obsFor(1, 100, { targetRoom: 7 }), 1);
  check('observation-rejects-hidden-field', !hidden.ok && hidden.code === 'E_SCHEMA', { path: hidden.path });
  const actorField = g.pushObservation(s.session, 1, { ...obsFor(1, 100), actorId: 'x' }, 1);
  check('observation-rejects-actor-override', !actorField.ok && actorField.code === 'E_SCHEMA');
  const wrongEpoch = g.pushObservation(s.session, 2, obsFor(2, 100), 1);
  check('observation-wrong-epoch', !wrongEpoch.ok && wrongEpoch.code === 'E_STALE_EPOCH');
  const ok100 = g.pushObservation(s.session, 1, obsFor(1, 100), 1);
  check('observation-valid', ok100.ok && ok100.tick === 100);
  const ok105 = g.pushObservation(s.session, 1, obsFor(1, 105), 2);
  const stale = g.pushObservation(s.session, 1, obsFor(1, 50), 3);
  out.flows.staleObservation = { accepted: stale.ok, tick: stale.ok ? stale.tick : null, beforeTick: 105 };
  if (stale.ok) {
    const viewTick = g.listSessions().find((x) => x.session === s.session)?.tick;
    check('stale-observation-rolls-latest-tick-back', viewTick === 50, { viewTick });
    finding('observation-stale-tick-rollback', {
      note: 'pushObservation accepts tick 50 after tick 105 and replaces the latest whitelist observation; tick-TTL is then computed from the stale tick',
      beforeTick: 105, afterTick: 50
    });
    // TTL extension proof: acceptedTick becomes 50 instead of 105.
    const q = g.submitActions({ sessionId: s.session, epoch: 1, requestId: 'req_ec176355cc56e1dd9fcee75e', actions: { actions: [act('aid_24db3627813bdd3835a1c8f6')], ttlTicks: 10 }, nowMs: 4 });
    check('stale-tick-extends-ttl', 'acceptedTick' in q && q.acceptedTick === 50 && q.applyByTick === 60, { acceptedTick: (q as any).acceptedTick });
  } else {
    check('stale-observation-rejected', stale.code === 'E_STALE_EPOCH', { code: stale.code });
  }
  g.dispose();
}

// 3) Idempotency + batch partial commit + actor override
{
  const g = gw();
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  if (!s.ok) throw new Error('link');
  check('submit-requires-observation', !g.submitActions({ sessionId: s.session, epoch: 1, requestId: 'req_bbd27838c23eddd9d5313472', actions: { actions: [act('aid_d3a8ef55c68967d3f7f0a719')] }, nowMs: 1 }).ok);
  g.pushObservation(s.session, 1, obsFor(1, 100), 1);
  const batchA = { actions: [act('aid_16447632cfae786e18d03f72')], ttlTicks: 10 };
  const q1 = g.submitActions({ sessionId: s.session, epoch: 1, requestId: 'req_8ee22e3909895921a8aaa220', actions: batchA, nowMs: 1 });
  const q2 = g.submitActions({ sessionId: s.session, epoch: 1, requestId: 'req_8ee22e3909895921a8aaa220', actions: batchA, nowMs: 2 });
  check('request-replay-same-payload', 'replayed' in q1 && 'replayed' in q2 && q1.replayed === false && q2.replayed === true);
  const q3 = g.submitActions({ sessionId: s.session, epoch: 1, requestId: 'req_8ee22e3909895921a8aaa220', actions: { actions: [act('aid_16447632cfae786e18d03f72', 'fire', { ticks: 2 })], ttlTicks: 10 }, nowMs: 3 });
  check('request-different-payload-rejected', !q3.ok && q3.code === 'E_ID_PAYLOAD_MISMATCH');
  const q4 = g.submitActions({ sessionId: s.session, epoch: 1, requestId: 'req_e82b1894eac2a21986df4b0e', actions: { actions: [act('aid_16447632cfae786e18d03f72', 'fire', { ticks: 2 })] }, nowMs: 4 });
  check('action-different-payload-rejected', !q4.ok && q4.code === 'E_ID_PAYLOAD_MISMATCH');
  const beforePending = g.nextAction({ sessionId: s.session, epoch: 1, nowMs: 5 });
  check('no-partial-queue-after-mismatch', beforePending !== null && beforePending.actionId === 'aid_16447632cfae786e18d03f72');
  // batch [new act, conflicting act] must not queue the new one
  const partial = g.submitActions({ sessionId: s.session, epoch: 1, requestId: 'req_8d0492b6f3c30bcf8aef3c95', actions: { actions: [act('aid_0a131a8f89376219c56d7f63'), act('aid_16447632cfae786e18d03f72', 'fire', { ticks: 2 })] }, nowMs: 6 });
  check('batch-conflict-rejected', !partial.ok && partial.code === 'E_ID_PAYLOAD_MISMATCH');
  const afterConflict = g.nextAction({ sessionId: s.session, epoch: 1, nowMs: 7 });
  check('batch-conflict-no-partial-commit', afterConflict !== null && afterConflict.actionId === 'aid_16447632cfae786e18d03f72');
  // schema: actor/seed/role overrides and duplicates / bounds
  check('action-actor-override-rejected', !g.submitActions({ sessionId: s.session, epoch: 1, requestId: 'req_6746320df0c129aeb3e43daf', actions: { actions: [act('aid_6317ff0cc4070235de224793', 'stop', { actorId: 'x' })] }, nowMs: 8 }).ok);
  check('action-seed-override-rejected', !g.submitActions({ sessionId: s.session, epoch: 1, requestId: 'req_abd4dde38df32322b6ade17b', actions: { actions: [act('aid_d278ae66cbd5948a79c86aea', 'stop', { seed: 7 })] }, nowMs: 8 }).ok);
  check('batch-duplicate-actionid-rejected', !g.submitActions({ sessionId: s.session, epoch: 1, requestId: 'req_6ec235dd6611c0003eac7619', actions: { actions: [act('aid_aae6cff3ea17b8cb3408ed5e'), act('aid_aae6cff3ea17b8cb3408ed5e')] }, nowMs: 8 }).ok);
  check('batch-over-8-rejected', !g.submitActions({ sessionId: s.session, epoch: 1, requestId: 'req_3ca43d96545487c5ad2e85f3', actions: { actions: Array.from({ length: 9 }, (_, i) => act(`aid_6c263387a6c1b8404d621ae5${i}`)) }, nowMs: 8 }).ok);
  check('action-ticks-over-120-rejected', !g.submitActions({ sessionId: s.session, epoch: 1, requestId: 'req_7a9cb18810723e76fdc9a282', actions: { actions: [act('aid_a309b084c1117d91729e6aff', 'move', { ticks: 121 })] }, nowMs: 8 }).ok);
  g.dispose();
}

// 4) ACK semantics: tick TTL, wheel clock TTL, wrong request, cross-session
{
  const g = gw();
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  if (!s.ok) throw new Error('link');
  g.pushObservation(s.session, 1, obsFor(1, 100), 0);
  g.submitActions({ sessionId: s.session, epoch: 1, requestId: 'req_df34db009cfff767b0de6dd0', actions: { actions: [act('aid_3cdbdce72237d8f5dc401b27')], ttlTicks: 5 }, nowMs: 1 });
  const wrongRequest = g.ackAction({ sessionId: s.session, epoch: 1, requestId: 'req_4a232c1c4fd871fda4ba4347', actionId: 'aid_3cdbdce72237d8f5dc401b27', result: 'applied', appliedTick: 101, nowMs: 2 });
  check('ack-wrong-request-rejected', 'ok' in wrongRequest && wrongRequest.ok === false && wrongRequest.code === 'E_ID_PAYLOAD_MISMATCH');
  const overTick = g.ackAction({ sessionId: s.session, epoch: 1, requestId: 'req_df34db009cfff767b0de6dd0', actionId: 'aid_3cdbdce72237d8f5dc401b27', result: 'applied', appliedTick: 106, nowMs: 3 });
  check('ack-late-tick-expired', 'ok' in overTick === false && overTick.status === 'expired' && overTick.code === 'E_ACTION_EXPIRED');
  check('expired-ack-releases-budget', g.nextAction({ sessionId: s.session, epoch: 1, nowMs: 4 }) === null);

  // wall-time TTL
  const s2 = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  if (!s2.ok) throw new Error('link2');
  g.pushObservation(s2.session, 1, obsFor(1, 200), 0);
  g.submitActions({ sessionId: s2.session, epoch: 1, requestId: 'req_71b6900f640459cbf71945b5', actions: { actions: [act('aid_9a7f4ab9c37273e733bae093')] }, nowMs: 1000 });
  const wallAck = g.ackAction({ sessionId: s2.session, epoch: 1, requestId: 'req_71b6900f640459cbf71945b5', actionId: 'aid_9a7f4ab9c37273e733bae093', result: 'applied', appliedTick: 201, nowMs: 1000 + WORLD_LIMITS.MAX_ACTION_WALL_MS + 1 });
  check('ack-wall-ttl-expired', 'ok' in wallAck && wallAck.ok === false && wallAck.code === 'E_ACTION_EXPIRED');
  check('wall-expiry-releases-budget', g.nextAction({ sessionId: s2.session, epoch: 1, nowMs: 7000 }) === null);

  // cross-session ACK + forged action id
  const s3 = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  if (!s3.ok) throw new Error('link3');
  g.pushObservation(s3.session, 1, obsFor(1, 300), 0);
  g.submitActions({ sessionId: s3.session, epoch: 1, requestId: 'req_7cca73fb3dff7709449400ec', actions: { actions: [act('aid_9c775d40f1be3846b779eb1a')] }, nowMs: 1 });
  const cross = g.ackAction({ sessionId: s.session, epoch: 1, requestId: 'req_7cca73fb3dff7709449400ec', actionId: 'aid_9c775d40f1be3846b779eb1a', result: 'applied', appliedTick: 301, nowMs: 2 });
  check('cross-session-ack-rejected', 'ok' in cross && cross.ok === false && cross.code === 'E_ACTION_EXPIRED');
  const stillThere = g.nextAction({ sessionId: s3.session, epoch: 1, nowMs: 3 });
  check('cross-session-ack-does-not-consume', stillThere !== null && stillThere.actionId === 'aid_9c775d40f1be3846b779eb1a');
  const forged = g.ackAction({ sessionId: s3.session, epoch: 1, requestId: 'req_7cca73fb3dff7709449400ec', actionId: 'aid_d79338178987ff50eb002f65', result: 'applied', appliedTick: 301, nowMs: 4 });
  check('forged-actionid-rejected', 'ok' in forged && forged.ok === false && forged.code === 'E_ACTION_EXPIRED');
  g.dispose();
}

// 5) Pending budget + release; cache eviction double execution
{
  const g = gw({ maxPendingActions: 3 });
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  if (!s.ok) throw new Error('link');
  g.pushObservation(s.session, 1, obsFor(1, 100), 0);
  for (let i = 0; i < 3; i++) {
    const r = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(100 + i), actions: { actions: [act(AID(100 + i))] }, nowMs: 1 });
    check(`pending-budget-fill-${i}`, 'acceptedTick' in r && typeof r.acceptedTick === 'number');
  }
  const over = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(200), actions: { actions: [act(AID(200))] }, nowMs: 2 });
  check('pending-budget-exceeded', !over.ok && over.code === 'E_RESOURCE_LIMIT');
  const ackOne = g.ackAction({ sessionId: s.session, epoch: 1, requestId: RID(100), actionId: AID(100), result: 'rejected', nowMs: 3 });
  check('ack-releases-one-slot', 'ok' in ackOne === false && ackOne.status === 'rejected');
  const afterRelease = g.submitActions({ sessionId: s.session, epoch: 1, requestId: RID(300), actions: { actions: [act(AID(300))] }, nowMs: 3 });
  check('submit-after-release', 'acceptedTick' in afterRelease && typeof afterRelease.acceptedTick === 'number');
  g.dispose();

  // Cache eviction: small cache, acknowledged action, then many new actions evict it,
  // then the original request is retried -> is it queued again (double execution)?
  const g2 = gw({ maxCacheEntries: 2 });
  const s2 = g2.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  if (!s2.ok) throw new Error('link2');
  g2.pushObservation(s2.session, 1, obsFor(1, 100), 0);
  const origBatch = { actions: [act('aid_8b8e0643f84eccfb89d7039f')] };
  g2.submitActions({ sessionId: s2.session, epoch: 1, requestId: 'req_b0b0658c00640548f5996333', actions: origBatch, nowMs: 1 });
  g2.ackAction({ sessionId: s2.session, epoch: 1, requestId: 'req_b0b0658c00640548f5996333', actionId: 'aid_8b8e0643f84eccfb89d7039f', result: 'applied', appliedTick: 101, nowMs: 2 });
  for (let i = 0; i < 6; i++) {
    g2.submitActions({ sessionId: s2.session, epoch: 1, requestId: RID(400 + i), actions: { actions: [act(AID(400 + i))] }, nowMs: 3 });
  }
  const retry = g2.submitActions({ sessionId: s2.session, epoch: 1, requestId: 'req_b0b0658c00640548f5996333', actions: origBatch, nowMs: 4 });
  out.flows.cacheEvictionRetry = retry;
  const next = g2.nextAction({ sessionId: s2.session, epoch: 1, nowMs: 5 });
  if ('replayed' in retry && retry.actions[0].status !== 'applied') {
    finding('cache-eviction-allows-retry-requeue', {
      note: 'idempotency cache is bounded (MAX_CACHE_ENTRIES); after eviction a retried requestId+payload can be queued again, so a retry after eviction may double-execute',
      retryReceipt: retry, next: next ? next.actionId : null
    });
  } else {
    check('cache-eviction-retry-still-idempotent', 'replayed' in retry && retry.replayed === true && retry.actions[0].status === 'applied');
  }
  g2.dispose();
}

// 6) Yield / lost / re-authorize
{
  const g = gw({ lostAfterMs: 1000 });
  const s = g.linkSession({ authorized: true, origin: ORIGIN, nowMs: 0 });
  if (!s.ok) throw new Error('link');
  g.pushObservation(s.session, 1, obsFor(1, 100), 0);
  g.submitActions({ sessionId: s.session, epoch: 1, requestId: 'req_7a60057c53f4b7332a70fadf', actions: { actions: [act('aid_2637cd37c05fe1652dc177d7')] }, nowMs: 1 });
  const y = g.yieldSession(s.session, 1, 'human-input', 2);
  const yieldedNext = g.nextAction({ sessionId: s.session, epoch: 2, nowMs: 3 });
  check('yield-bumps-epoch-clears', y.ok && y.epoch === 2 && 'ok' in yieldedNext && yieldedNext.ok === false && yieldedNext.code === 'E_PERMISSION');
  check('yield-old-epoch-stale', !g.pushObservation(s.session, 1, obsFor(1, 101), 3).ok);
  check('yield-old-epoch-ack-stale', (() => { const r = g.ackAction({ sessionId: s.session, epoch: 1, requestId: 'req_7a60057c53f4b7332a70fadf', actionId: 'aid_2637cd37c05fe1652dc177d7', result: 'applied', appliedTick: 101, nowMs: 3 }); return 'ok' in r && r.ok === false && r.code === 'E_STALE_EPOCH'; })());
  const reauth = g.authorize(s.session, 2, 4);
  check('explicit-reauthorize-yielded', reauth.ok && reauth.epoch === 2);
  const oldReauth = g.authorize(s.session, 1, 4);
  check('old-epoch-reauthorize-rejected', 'ok' in oldReauth && oldReauth.ok === false && oldReauth.code === 'E_STALE_EPOCH');

  const lost = g.reapExpired(5 + 1000 + 1);
  check('reap-marks-lost', lost.includes(s.session));
  const view = g.listSessions().find((x) => x.session === s.session);
  check('lost-bumps-epoch-clears', view?.status === 'lost' && view.epoch === 3);
  check('lost-old-epoch-stale', !g.heartbeat(s.session, 2, 5000).ok);
  const reauthLost = g.authorize(s.session, 3, 5001);
  check('explicit-reauthorize-lost', reauthLost.ok && reauthLost.epoch === 3);
  g.dispose();
}

console.log(JSON.stringify(out, null, 2));
console.log(out.checks.every((c: any) => c.ok) ? 'GATEWAY_PROBE_PASS' : 'GATEWAY_PROBE_FAIL');
