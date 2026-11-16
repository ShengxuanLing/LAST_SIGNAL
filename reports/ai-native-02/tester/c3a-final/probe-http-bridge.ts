// Independent C3-a probe #1 — REAL HTTP loopback bridge, fake token only.
// Bridge A (stable): origin/preflight/credentials/authorized/duplicate handshake/body/JSON/
//   observation whitelist+rollback/session binding/cross-origin use/queue-next-ack/forgery/
//   cross-session ack/yield/close/rehandshake.
// Bridge B (separate, short lostAfterMs): heartbeat loss -> LOST -> old epoch/bridge duplicate.
import { startWorldBridge } from './src/ai-native/worldBridgeServer';
import { WorldGateway } from './src/ai-native/worldGateway';

const TOKEN = 'test-token-c3a-0123456789'; // fake, local-only
const ORIGIN = 'http://localhost:5173';
const ORIGIN2 = 'http://localhost:5199';
const out: any = { checks: [], findings: [], flows: {}, meta: { fakeToken: true, token: TOKEN } };
const check = (name: string, ok: boolean, detail?: any) => {
  out.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) process.exitCode = 1;
};
const finding = (name: string, detail: any) => out.findings.push({ name, detail });

const gateway = new WorldGateway({ lostAfterMs: 30000 });
const server = await startWorldBridge({
  gateway, token: TOKEN, allowedOrigins: [ORIGIN, ORIGIN2], heartbeatIntervalMs: 100
});
const base = server.url;
out.meta.url = base;

async function req(pathname: string, opts: {
  method?: string; origin?: string | null; token?: string | null;
  body?: any; raw?: string; contentType?: string;
} = {}) {
  const headers: Record<string, string> = {};
  if (opts.origin !== null && opts.origin !== undefined) headers.Origin = opts.origin;
  if (opts.token !== null && opts.token !== undefined) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.raw !== undefined || opts.body !== undefined) headers['Content-Type'] = opts.contentType ?? 'application/json';
  const body = opts.raw !== undefined ? opts.raw : opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const res = await fetch(base + pathname, { method: opts.method ?? 'POST', headers, body });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), json, text };
}
const hsBody = { authorized: true, protocolVersion: 1 };
const obs = (session: string, epoch: number, tick: number, extra: any = {}) => ({
  session, epoch,
  observation: {
    schema: 'last_signal.world.v1', protocolVersion: 1, epoch,
    tick, roomId: 0,
    player: { x: 8, y: 45, hp: 100, maxHp: 100, aimYaw: 0, weaponKey: 'pulse', ammo: -1, magazine: -1 },
    drones: [], projectiles: [], availableActions: ['move', 'stop', 'aim', 'fire', 'interact'],
    ...extra
  }
});

// --- Origin / preflight / credentials / authorized flag ---
{
  const noOrigin = await req('/world-link/handshake', { token: TOKEN, body: hsBody });
  check('handshake-missing-origin-403', noOrigin.status === 403 && noOrigin.json?.code === 'E_PERMISSION');
  const wrongOrigin = await req('/world-link/handshake', { origin: 'http://evil.example', token: TOKEN, body: hsBody });
  check('handshake-wrong-origin-403', wrongOrigin.status === 403);
  check('denied-origin-no-cors-header', wrongOrigin.headers['access-control-allow-origin'] === undefined);
  const preflight = await req('/world-link/handshake', { method: 'OPTIONS', origin: ORIGIN });
  check('preflight-allowed-origin-204', preflight.status === 204);
  check('preflight-cors-echo', preflight.headers['access-control-allow-origin'] === ORIGIN);
  check('preflight-no-wildcard', preflight.headers['access-control-allow-origin'] !== '*');
  check('preflight-allows-auth-header', String(preflight.headers['access-control-allow-headers'] ?? '').includes('authorization'));
  const preflightNoOrigin = await req('/world-link/handshake', { method: 'OPTIONS' });
  check('preflight-missing-origin-403', preflightNoOrigin.status === 403);
  const noCred = await req('/world-link/handshake', { origin: ORIGIN, body: hsBody });
  check('handshake-no-credential-401', noCred.status === 401);
  const badCred = await req('/world-link/handshake', { origin: ORIGIN, token: 'wrong-token-0123456789', body: hsBody });
  check('handshake-wrong-credential-401', badCred.status === 401);
  check('token-never-echoed', !(JSON.stringify(noCred.json) + JSON.stringify(badCred.json)).includes(TOKEN));
  const unauthorizedFlag = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: { authorized: false, protocolVersion: 1 } });
  check('handshake-authorized-false-403', unauthorizedFlag.status === 403 && unauthorizedFlag.json?.messageKey === 'world.authorization_required');
  const badVersion = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: { authorized: true, protocolVersion: 2 } });
  check('handshake-wrong-protocol-403', badVersion.status === 403);
}

// --- Valid handshake + duplicate + origin binding ---
let session = '';
let epoch = 0;
{
  const hs = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: hsBody });
  session = hs.json?.session; epoch = hs.json?.epoch;
  check('handshake-valid-200', hs.status === 200 && typeof session === 'string' && epoch === 1 && hs.json?.protocolVersion === 1, { epoch });
  const dup = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: hsBody });
  check('duplicate-handshake-409', dup.status === 409 && dup.json?.messageKey === 'world.duplicate_handshake');
  const sessions = gateway.listSessions();
  check('session-bound-to-origin', sessions.length === 1 && sessions[0].origin === ORIGIN && sessions[0].status === 'connected');
  const other = await req('/world-link/handshake', { origin: ORIGIN2, token: TOKEN, body: hsBody });
  out.flows.secondSessionStatus = other.status;
  check('second-allowed-origin-can-link', other.status === 200);
}

// --- Body / content-type / route ---
{
  const big = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, raw: JSON.stringify({ session, epoch, observation: { big: 'x'.repeat(9000) } }) });
  check('body-too-large-413', big.status === 413 && big.json?.code === 'E_PAYLOAD_TOO_LARGE');
  const wrongType = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, raw: '{}', contentType: 'text/plain' });
  check('content-type-json-required-415', wrongType.status === 415);
  const badJson = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, raw: '{' });
  check('invalid-json-400', badJson.status === 400 && badJson.json?.code === 'E_SCHEMA');
  const unknown = await req('/world-link/nope', { origin: ORIGIN, token: TOKEN, body: {} });
  check('unknown-route-404', unknown.status === 404);
  const arrayBody = await req('/world-link/handshake', { origin: ORIGIN2, token: TOKEN, raw: '[]' });
  check('array-body-rejected-400', arrayBody.status === 400);
}

// --- Observation validation / whitelist / rollback ---
{
  const wrongEpoch = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, epoch + 5, 10) });
  check('observation-wrong-epoch-409', wrongEpoch.status === 409 && wrongEpoch.json?.code === 'E_STALE_EPOCH');
  const hiddenField = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, epoch, 100, { targetRoom: 7 }) });
  check('observation-hidden-field-rejected', hiddenField.status === 400, { path: hiddenField.json?.path });
  const badNumber = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: { session, epoch, observation: { ...obs(session, epoch, 100).observation, player: { x: NaN, y: 45, hp: 100, maxHp: 100, aimYaw: 0, weaponKey: 'pulse', ammo: -1, magazine: -1 } } } });
  check('observation-nonfinite-rejected', badNumber.status === 400 || badNumber.status === 413, { status: badNumber.status });
  const tooManyDrones = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, epoch, 100, { drones: Array.from({ length: 33 }, (_, i) => ({ id: i, kind: 'drone', x: 1, y: 1, hp: 1, state: 'idle' })) }) });
  check('observation-drone-bound-rejected', tooManyDrones.status === 400);
  const good = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, epoch, 100) });
  check('observation-valid-200', good.status === 200 && good.json?.tick === 100);
  const stale = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, epoch, 50) });
  out.flows.staleTickStatus = stale.status;
  if (stale.status === 200) {
    finding('observation-old-tick-accepted', {
      note: 'gateway accepts a lower observation tick as latest; whitelist state can roll back and tick-TTL deadlines extend from the stale tick',
      previousTick: 100, acceptedTick: 50
    });
  } else {
    check('observation-old-tick-rejected', stale.status === 409, { status: stale.status });
  }
}

// --- Cross-origin session use (both origins allowed, shared token) ---
{
  const cross = await req('/world-link/observation', { origin: ORIGIN2, token: TOKEN, body: obs(session, epoch, 101) });
  out.flows.crossOriginSessionUseStatus = cross.status;
  if (cross.status === 200) {
    finding('allowed-origin-can-drive-other-session', {
      note: 'bridge checks Origin allowlist + token but does not bind requests to the handshake origin; any allowed origin with the token can use any session',
      handshakeOrigin: ORIGIN, requestOrigin: ORIGIN2
    });
  } else {
    check('cross-origin-session-use-rejected', cross.status === 403, { status: cross.status });
  }
}

// --- Queue -> next-action -> ack, forgery, replay, cross-session ack ---
{
  const queued = gateway.submitActions({ sessionId: session, epoch, requestId: 'req_06bca4872af3bf5a68796c0f', actions: { actions: [{ type: 'stop', actionId: 'aid_772fe51d6245002bbfab98ea' }], ttlTicks: 5 }, nowMs: Date.now() });
  out.flows.queued = queued;
  check('gateway-queue-ok', 'acceptedTick' in queued && queued.acceptedTick === 101 && queued.session === session, { acceptedTick: (queued as any).acceptedTick });
  out.flows.httpActionSubmitRoute = 'absent: bridge exposes no action-submit route; gateway.submitActions is called directly';
  const next = await req(`/world-link/next-action?session=${session}&epoch=${epoch}`, { method: 'GET', origin: ORIGIN, token: TOKEN });
  check('next-action-200', next.status === 200 && next.json?.action?.actionId === 'aid_772fe51d6245002bbfab98ea');
  const forged = await req('/world-link/action-ack', { origin: ORIGIN, token: TOKEN, body: { session, epoch, requestId: 'req_06bca4872af3bf5a68796c0f', actionId: 'aid_dc2988558bca7dc429598a26', result: 'applied', appliedTick: 102 } });
  check('forged-actionid-rejected', forged.status === 400 && forged.json?.code === 'E_ACTION_EXPIRED');
  const pendingAfterForged = gateway.nextAction({ sessionId: session, epoch, nowMs: Date.now() });
  check('forged-ack-does-not-apply', pendingAfterForged !== null && pendingAfterForged.actionId === 'aid_772fe51d6245002bbfab98ea');
  const wrongReq = await req('/world-link/action-ack', { origin: ORIGIN, token: TOKEN, body: { session, epoch, requestId: 'req_f9724433f1d510e7184ff263', actionId: 'aid_772fe51d6245002bbfab98ea', result: 'applied', appliedTick: 102 } });
  check('ack-wrong-request-rejected', wrongReq.status === 400);
  const ack = await req('/world-link/action-ack', { origin: ORIGIN, token: TOKEN, body: { session, epoch, requestId: 'req_06bca4872af3bf5a68796c0f', actionId: 'aid_772fe51d6245002bbfab98ea', result: 'applied', appliedTick: 102 } });
  check('ack-valid-200-applied', ack.status === 200 && ack.json?.ack?.status === 'applied');
  const replay = gateway.submitActions({ sessionId: session, epoch, requestId: 'req_06bca4872af3bf5a68796c0f', actions: { actions: [{ type: 'stop', actionId: 'aid_772fe51d6245002bbfab98ea' }], ttlTicks: 5 }, nowMs: Date.now() });
  check('request-replay-after-ack-applied', 'replayed' in replay && replay.replayed === true && replay.actions[0].status === 'applied');
  const nextAfterAck = await req(`/world-link/next-action?session=${session}&epoch=${epoch}`, { method: 'GET', origin: ORIGIN, token: TOKEN });
  check('no-double-queue-after-ack', nextAfterAck.status === 200 && nextAfterAck.json?.action === null);

  const hs2 = gateway.listSessions().find((s) => s.origin === ORIGIN2 && s.status === 'connected');
  const s2 = hs2!.session;
  await req('/world-link/observation', { origin: ORIGIN2, token: TOKEN, body: obs(s2, 1, 300) });
  const q2 = gateway.submitActions({ sessionId: s2, epoch: 1, requestId: 'req_b40ec8fe84449dcd96de5f20', actions: { actions: [{ type: 'stop', actionId: 'aid_6753f07e0e1f5d0a14a85a4f' }] }, nowMs: Date.now() });
  check('second-session-queue-ok', 'acceptedTick' in q2 && typeof q2.acceptedTick === 'number');
  const crossAck = await req('/world-link/action-ack', { origin: ORIGIN, token: TOKEN, body: { session, epoch, requestId: 'req_b40ec8fe84449dcd96de5f20', actionId: 'aid_6753f07e0e1f5d0a14a85a4f', result: 'applied', appliedTick: 103 } });
  check('cross-session-ack-rejected', crossAck.status === 400, { status: crossAck.status });
  const s2pending = gateway.nextAction({ sessionId: s2, epoch: 1, nowMs: Date.now() });
  check('cross-session-ack-does-not-consume', s2pending !== null && s2pending.actionId === 'aid_6753f07e0e1f5d0a14a85a4f');
}

// --- Yield / old epoch / close / rehandshake ---
{
  const y = await req('/world-link/yield', { origin: ORIGIN, token: TOKEN, body: { session, epoch, reason: 'human-input' } });
  check('yield-200-bumps-epoch', y.status === 200 && y.json?.epoch === epoch + 1);
  const oldObs = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, epoch, 302) });
  check('yielded-old-epoch-409', oldObs.status === 409 && oldObs.json?.code === 'E_STALE_EPOCH');
  const closed = await req('/world-link/close', { origin: ORIGIN, token: TOKEN, body: { session } });
  check('close-valid-200', closed.status === 200);
  const afterClose = await req('/world-link/heartbeat', { origin: ORIGIN, token: TOKEN, body: { session, epoch: epoch + 1 } });
  check('heartbeat-after-close-404', afterClose.status === 404);
  const reHs = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: hsBody });
  check('rehandshake-after-close-200', reHs.status === 200 && reHs.json?.epoch === 1);
}

// --- Bridge B: heartbeat loss -> LOST, old epoch, duplicate handshake, explicit close ---
{
  const lostGateway = new WorldGateway({ lostAfterMs: 150 });
  const bridgeB = await startWorldBridge({ gateway: lostGateway, token: TOKEN, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20 });
  const r = async (pathname: string, body?: any, method = 'POST') => {
    const res = await fetch(bridgeB.url + pathname, {
      method, headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const hs = await r('/world-link/handshake', hsBody);
  const sid = hs.json.session;
  await new Promise((resolve) => setTimeout(resolve, 400));
  const views = lostGateway.listSessions();
  const lost = views.find((s) => s.session === sid);
  check('lost-after-missed-heartbeats', lost?.status === 'lost' && lost.epoch === 2, { status: lost?.status, epoch: lost?.epoch });
  const oldHb = await r('/world-link/heartbeat', { session: sid, epoch: 1 });
  check('lost-old-epoch-409', oldHb.status === 409);
  const dup = await r('/world-link/handshake', hsBody);
  check('lost-duplicate-handshake-409', dup.status === 409);
  const close = await r('/world-link/close', { session: sid });
  check('lost-explicit-close-200', close.status === 200);
  const re = await r('/world-link/handshake', hsBody);
  check('lost-rehandshake-after-close-200', re.status === 200 && re.json.epoch === 1);
  await bridgeB.close();
}

await server.close();
out.meta.endedUtc = new Date().toISOString();
console.log(JSON.stringify(out, null, 2));
console.log(out.checks.every((c: any) => c.ok) ? 'HTTP_PROBE_PASS' : 'HTTP_PROBE_FAIL');
