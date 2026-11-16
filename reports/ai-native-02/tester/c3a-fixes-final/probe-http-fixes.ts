// Independent C3-a fixes probe #2 — REAL HTTP bridge, corrected contracts.
// F1 low tick over HTTP, TTL baseline, same tick, epoch reset; F3 per-operation origin
// binding (observe/heartbeat/next-action/ack/yield and close residual check); token/CORS/
// unauthorized strict; body/JSON/hidden-field validation.
import { startWorldBridge } from './src/ai-native/worldBridgeServer';
import { WorldGateway } from './src/ai-native/worldGateway';

const TOKEN = 'test-token-c3a-fixes-0123456789';
const ORIGIN = 'http://localhost:5173';
const ORIGIN2 = 'http://localhost:5199';
const out: any = { checks: [], findings: [], flows: {}, meta: { fakeToken: true, target: '0ac1814' } };
const check = (name: string, ok: boolean, detail?: any) => {
  out.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) process.exitCode = 1;
};
const finding = (name: string, detail: any) => out.findings.push({ name, detail });
const hex = (n: number) => n.toString(16).padStart(24, '0');
const RID = (n: number) => `req_${hex(n)}`;
const AID = (n: number) => `aid_${hex(n)}`;

const gateway = new WorldGateway({ lostAfterMs: 30000 });
const server = await startWorldBridge({ gateway, token: TOKEN, allowedOrigins: [ORIGIN, ORIGIN2], heartbeatIntervalMs: 100 });
const base = server.url;
out.meta.url = base;

async function req(pathname: string, opts: { method?: string; origin?: string | null; token?: string | null; body?: any; raw?: string; contentType?: string; } = {}) {
  const headers: Record<string, string> = {};
  if (opts.origin !== null && opts.origin !== undefined) headers.Origin = opts.origin;
  if (opts.token !== null && opts.token !== undefined) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.raw !== undefined || opts.body !== undefined) headers['Content-Type'] = opts.contentType ?? 'application/json';
  const body = opts.raw !== undefined ? opts.raw : opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const res = await fetch(base + pathname, { method: opts.method ?? 'POST', headers, body });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), json, text };
}
const hsBody = { authorized: true, protocolVersion: 1 };
const obs = (session: string, epoch: number, tick: number, extra: any = {}, hp = 100) => ({
  session, epoch,
  observation: {
    schema: 'last_signal.world.v1', protocolVersion: 1, epoch, tick, roomId: 0,
    player: { x: 8, y: 45, hp, maxHp: 100, aimYaw: 0, weaponKey: 'pulse', ammo: -1, magazine: -1 },
    drones: [], projectiles: [], availableActions: ['move', 'stop', 'aim', 'fire', 'interact'],
    ...extra
  }
});

// --- auth / origin / preflight strict (unchanged contracts) ---
{
  const noOrigin = await req('/world-link/handshake', { token: TOKEN, body: hsBody });
  check('handshake-missing-origin-403', noOrigin.status === 403);
  const wrongOrigin = await req('/world-link/handshake', { origin: 'http://evil.example', token: TOKEN, body: hsBody });
  check('handshake-wrong-origin-403', wrongOrigin.status === 403 && wrongOrigin.headers['access-control-allow-origin'] === undefined);
  const pre = await req('/world-link/handshake', { method: 'OPTIONS', origin: ORIGIN });
  check('preflight-204-cors', pre.status === 204 && pre.headers['access-control-allow-origin'] === ORIGIN && pre.headers['access-control-allow-origin'] !== '*');
  const noCred = await req('/world-link/handshake', { origin: ORIGIN, body: hsBody });
  check('handshake-no-credential-401', noCred.status === 401);
  const badCred = await req('/world-link/handshake', { origin: ORIGIN, token: 'wrong-token-0123456789', body: hsBody });
  check('handshake-wrong-credential-401', badCred.status === 401);
  check('token-not-echoed', !(JSON.stringify(noCred.json) + JSON.stringify(badCred.json)).includes(TOKEN));
  const flag = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: { authorized: false, protocolVersion: 1 } });
  check('authorized-false-403', flag.status === 403 && flag.json?.messageKey === 'world.authorization_required');
  const big = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, raw: JSON.stringify({ x: 'y'.repeat(9000) }) });
  check('body-too-large-413', big.status === 413);
}

// --- valid handshake + duplicate ---
let session = ''; let epoch = 0;
{
  const hs = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: hsBody });
  session = hs.json?.session; epoch = hs.json?.epoch;
  check('handshake-valid-200', hs.status === 200 && epoch === 1);
  const dup = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: hsBody });
  check('duplicate-handshake-409', dup.status === 409);
}

// --- F1 over HTTP: stale tick 409, no rollback, TTL baseline unchanged, same tick allowed ---
{
  const good = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, epoch, 5) });
  check('obs-tick5-200', good.status === 200 && good.json?.tick === 5);
  const stale = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, epoch, 4) });
  check('F1-http-stale-tick-409', stale.status === 409 && stale.json?.code === 'E_STALE_TICK', { status: stale.status });
  const view = gateway.listSessions().find((s) => s.session === session);
  check('F1-http-latest-tick-not-rolled-back', view?.tick === 5);
  const q = gateway.submitActions({ sessionId: session, epoch, requestId: RID(1), actions: { actions: [{ type: 'stop', actionId: AID(1) }], ttlTicks: 10 }, nowMs: Date.now() });
  check('F1-http-TTL-baseline-unchanged', 'acceptedTick' in q && q.acceptedTick === 5 && q.applyByTick === 15);
  const same = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, epoch, 5, {}, 77) });
  check('same-tick-allowed-last-write-wins', same.status === 200 && same.json?.tick === 5);
  out.flows.sameTickPolicy = 'same tick accepted; last observation replaces previous (last-write-wins); TTL baseline stays at that tick';
}

// --- F3: per-operation origin binding ---
{
  const crossObs = await req('/world-link/observation', { origin: ORIGIN2, token: TOKEN, body: obs(session, epoch, 6) });
  check('F3-cross-origin-observation-403', crossObs.status === 403 && crossObs.json?.messageKey === 'world.origin_mismatch');
  const crossHb = await req('/world-link/heartbeat', { origin: ORIGIN2, token: TOKEN, body: { session, epoch } });
  check('F3-cross-origin-heartbeat-403', crossHb.status === 403 && crossHb.json?.messageKey === 'world.origin_mismatch');
  const nextA = await req(`/world-link/next-action?session=${session}&epoch=${epoch}`, { method: 'GET', origin: ORIGIN, token: TOKEN });
  check('next-action-same-origin-200', nextA.status === 200 && nextA.json?.action?.actionId === AID(1));
  const nextB = await req(`/world-link/next-action?session=${session}&epoch=${epoch}`, { method: 'GET', origin: ORIGIN2, token: TOKEN });
  check('F3-cross-origin-next-action-403', nextB.status === 403 && nextB.json?.messageKey === 'world.origin_mismatch');
  const ackB = await req('/world-link/action-ack', { origin: ORIGIN2, token: TOKEN, body: { session, epoch, requestId: RID(1), actionId: AID(1), result: 'applied', appliedTick: 6 } });
  check('F3-cross-origin-ack-403', ackB.status === 403 && ackB.json?.messageKey === 'world.origin_mismatch');
  const yieldB = await req('/world-link/yield', { origin: ORIGIN2, token: TOKEN, body: { session, epoch, reason: 'x' } });
  check('F3-cross-origin-yield-403', yieldB.status === 403 && yieldB.json?.messageKey === 'world.origin_mismatch');
  const ackA = await req('/world-link/action-ack', { origin: ORIGIN, token: TOKEN, body: { session, epoch, requestId: RID(1), actionId: AID(1), result: 'applied', appliedTick: 5 } });
  check('ack-same-origin-200-applied', ackA.status === 200 && ackA.json?.ack?.status === 'applied');
}

// --- F3 residual: is close origin-bound? ---
{
  const closeB = await req('/world-link/close', { origin: ORIGIN2, token: TOKEN, body: { session } });
  out.flows.crossOriginCloseStatus = closeB.status;
  if (closeB.status === 200) {
    finding('F3-residual-close-not-origin-bound', {
      note: 'close route does not call originMatches; a different allowed origin with the shared token can close another origin\'s session',
      sessionOrigin: ORIGIN, requestOrigin: ORIGIN2, status: 200
    });
  } else {
    check('F3-cross-origin-close-403', closeB.status === 403);
  }
}

// --- epoch reset over HTTP (new session because close may have removed it) ---
{
  const hs = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: hsBody });
  const sid = hs.status === 200 ? hs.json?.session : gateway.listSessions().find((s) => s.origin === ORIGIN && s.status === 'connected')?.session;
  check('epoch-reset-session-available', typeof sid === 'string' && sid.length > 0, { handshakeStatus: hs.status });
  const obs0 = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(sid, 1, 100) });
  check('epoch-reset-pre-observation', obs0.status === 200 || obs0.status === 409, { status: obs0.status });
  const y = await req('/world-link/yield', { origin: ORIGIN, token: TOKEN, body: { session: sid, epoch: 1, reason: 'human-input' } });
  check('yield-200-epoch2', y.status === 200 && y.json?.epoch === 2);
  // Bridge has no re-authorize route (F4); explicit gateway authorize is required before the
  // new epoch can observe. This is a gateway-level re-authorization, not an HTTP shortcut.
  const reauth = gateway.authorize(sid, 2, Date.now());
  check('epoch-explicit-reauthorize-ok', reauth.ok === true && reauth.epoch === 2);
  const reset = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(sid, 2, 1) });
  check('epoch-tick-reset-200', reset.status === 200 && reset.json?.tick === 1, { status: reset.status, body: reset.json });
  const oldObs = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(sid, 1, 2) });
  check('old-epoch-still-409', oldObs.status === 409);
  const c = await req('/world-link/close', { origin: ORIGIN, token: TOKEN, body: { session: sid } });
  check('close-same-origin-200', c.status === 200);
}

await server.close();
out.meta.endedUtc = new Date().toISOString();
console.log(JSON.stringify(out, null, 2));
console.log(out.checks.every((c: any) => c.ok) ? 'HTTP_FIXES_PROBE_PASS' : 'HTTP_FIXES_PROBE_FAIL');
