// Independent C3-a bounds probe #2 — REAL HTTP bridge: close Origin binding + session
// preservation, same-tick contract over HTTP, stale tick/TTL baseline, epoch reset,
// handshake human-confirmation flag, auth/CORS/body strictness.
import { startWorldBridge } from './src/ai-native/worldBridgeServer';
import { WorldGateway } from './src/ai-native/worldGateway';

const TOKEN = 'test-token-c3a-bounds-0123456789';
const ORIGIN = 'http://localhost:5173';
const ORIGIN2 = 'http://localhost:5199';
const out: any = { checks: [], findings: [], flows: {}, meta: { fakeToken: true, target: 'a53bfa7' } };
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
const obs = (session: string, epoch: number, tick: number, hp = 100, x = 8) => ({
  session, epoch,
  observation: {
    schema: 'last_signal.world.v1', protocolVersion: 1, epoch, tick, roomId: 0,
    player: { x, y: 45, hp, maxHp: 100, aimYaw: 0, weaponKey: 'pulse', ammo: -1, magazine: -1 },
    drones: [], projectiles: [], availableActions: ['move', 'stop', 'aim', 'fire', 'interact']
  }
});

// --- auth/Origin/preflight/body strict ---
{
  const noOrigin = await req('/world-link/handshake', { token: TOKEN, body: hsBody });
  check('handshake-missing-origin-403', noOrigin.status === 403);
  const wrongOrigin = await req('/world-link/handshake', { origin: 'http://evil.example', token: TOKEN, body: hsBody });
  check('handshake-wrong-origin-403', wrongOrigin.status === 403 && wrongOrigin.headers['access-control-allow-origin'] === undefined);
  const pre = await req('/world-link/handshake', { method: 'OPTIONS', origin: ORIGIN });
  check('preflight-204-cors', pre.status === 204 && pre.headers['access-control-allow-origin'] === ORIGIN && pre.headers['access-control-allow-origin'] !== '*');
  const noCred = await req('/world-link/handshake', { origin: ORIGIN, body: hsBody });
  check('no-credential-401', noCred.status === 401);
  const badCred = await req('/world-link/handshake', { origin: ORIGIN, token: 'wrong-token-0123456789', body: hsBody });
  check('wrong-credential-401', badCred.status === 401);
  check('token-not-echoed', !(JSON.stringify(noCred.json) + JSON.stringify(badCred.json)).includes(TOKEN));
  const flag = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: { authorized: false, protocolVersion: 1 } });
  check('authorized-false-403', flag.status === 403 && flag.json?.messageKey === 'world.authorization_required');
  const missingFlag = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: { protocolVersion: 1 } });
  check('authorized-missing-403', missingFlag.status === 403);
  const big = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, raw: JSON.stringify({ x: 'z'.repeat(9000) }) });
  check('body-too-large-413', big.status === 413);
}

// --- session A; same-tick / stale tick / TTL baseline over HTTP ---
let session = '';
{
  const hs = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: hsBody });
  session = hs.json?.session;
  check('handshake-valid-200', hs.status === 200 && hs.json?.epoch === 1);
  const dup = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: hsBody });
  check('duplicate-handshake-409', dup.status === 409);
  const first = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, 1, 10) });
  check('obs-tick10-200', first.status === 200 && first.json?.tick === 10);
  const same = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, 1, 10) });
  check('same-tick-same-payload-idempotent-200', same.status === 200 && same.json?.tick === 10);
  const conflict = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, 1, 10, 90, 9) });
  check('same-tick-different-payload-409', conflict.status === 409 && conflict.json?.code === 'E_TICK_CONFLICT', { status: conflict.status, body: conflict.json });
  const latest = gateway.listSessions().find((s) => s.session === session);
  check('same-tick-conflict-latest-unchanged', latest?.tick === 10);
  const stale = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, 1, 9) });
  check('old-tick-409', stale.status === 409 && stale.json?.code === 'E_STALE_TICK');
  const q = gateway.submitActions({ sessionId: session, epoch: 1, requestId: RID(1), actions: { actions: [{ type: 'stop', actionId: AID(1) }], ttlTicks: 5 }, nowMs: Date.now() });
  check('old-tick-TTL-baseline-unchanged', 'acceptedTick' in q && q.acceptedTick === 10 && q.applyByTick === 15);
  // same payload as latest still idempotent after conflict / stale attempts
  const again = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, 1, 10) });
  check('same-tick-idempotent-after-attempts', again.status === 200 && again.json?.tick === 10);
}

// --- close Origin binding: B cannot close A; A remains usable; A can close ---
{
  const closeB = await req('/world-link/close', { origin: ORIGIN2, token: TOKEN, body: { session } });
  check('cross-origin-close-403', closeB.status === 403 && closeB.json?.messageKey === 'world.origin_mismatch', { status: closeB.status });
  const alive = await req('/world-link/heartbeat', { origin: ORIGIN, token: TOKEN, body: { session, epoch: 1 } });
  check('original-session-alive-after-cross-origin-close', alive.status === 200);
  const stillObs = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, 1, 10) });
  check('original-session-observation-still-works', stillObs.status === 200);
  const closeA = await req('/world-link/close', { origin: ORIGIN, token: TOKEN, body: { session } });
  check('same-origin-close-200', closeA.status === 200);
  const afterClose = await req('/world-link/heartbeat', { origin: ORIGIN, token: TOKEN, body: { session, epoch: 1 } });
  check('closed-session-gone-404', afterClose.status === 404);
  // new handshake requires explicit authorized=true and is a fresh session/quota
  const denied = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: { authorized: false, protocolVersion: 1 } });
  check('post-close-handshake-requires-authorized', denied.status === 403);
  const fresh = await req('/world-link/handshake', { origin: ORIGIN, token: TOKEN, body: hsBody });
  check('post-close-authorized-handshake-200', fresh.status === 200 && fresh.json?.epoch === 1);
  session = fresh.json?.session;
  const freshState: any = (gateway as any).sessions.get(session);
  check('post-close-fresh-dedup-quota', freshState.dedupRecords === 0);
}

// --- epoch reset after explicit authorize (bridge has no authorize route) ---
{
  await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, 1, 100) });
  const y = await req('/world-link/yield', { origin: ORIGIN, token: TOKEN, body: { session, epoch: 1, reason: 'human-input' } });
  check('yield-200-epoch2', y.status === 200 && y.json?.epoch === 2);
  const re = gateway.authorize(session, 2, Date.now());
  check('gateway-explicit-authorize-ok', re.ok === true && re.epoch === 2);
  const reset = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, 2, 1) });
  check('new-epoch-tick-reset-200', reset.status === 200 && reset.json?.tick === 1, { status: reset.status });
  const oldEpoch = await req('/world-link/observation', { origin: ORIGIN, token: TOKEN, body: obs(session, 1, 2) });
  check('old-epoch-409', oldEpoch.status === 409);
  const close = await req('/world-link/close', { origin: ORIGIN, token: TOKEN, body: { session } });
  check('close-after-reset-200', close.status === 200);
}

await server.close();
out.meta.endedUtc = new Date().toISOString();
console.log(JSON.stringify(out, null, 2));
console.log(out.checks.every((c: any) => c.ok) ? 'BOUNDS_HTTP_PROBE_PASS' : 'BOUNDS_HTTP_PROBE_FAIL');
