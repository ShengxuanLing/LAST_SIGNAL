/**
 * Independent P3-b session-repro probe (commit ae8b4e2).
 *
 * Faithfully reproduces the Lead's Companion session failure WITHOUT masking it:
 *   - real HTTP bridge (token + host ownerKeyHash)
 *   - human handshake with ownerKey (simulates the real in-game form)
 *   - companion-authorize with the issued ownerCap (simulates CONNECTED)
 *   - NO manual pushObservation / NO stepSimulationTicks (a real Pause UI has
 *     no GameScene frame and no core tick)
 *   - official Companion MCP server launched with Agent env ONLY
 *     (bridgeUrl + token, NO ownerKey, NO ownerCap)
 *   - round 1 echo_observe immediately; then idle ~15s (Pause open) with the
 *     CompanionLink heartbeat's ONLY action (GET companion-status) every 1s;
 *     then round 2 echo_observe
 *   - observe gateway session status/epoch and that the core tick never moved
 *
 * Secret boundary: token/ownerKey are in-process random; never logged.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { startWorldBridge } from './src/ai-native/worldBridgeServer';
import { WorldGateway } from './src/ai-native/worldGateway';

let failures = 0;
const check = (n, c, d) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n, d) => console.log('INFO', n, JSON.stringify(d));

const TOKEN = randomBytes(24).toString('hex');
const OWNER_KEY = randomBytes(32).toString('hex');
const OWNER_HASH = createHash('sha256').update(OWNER_KEY, 'utf8').digest('hex');
const ORIGIN = 'http://localhost:5420';
const h = (s) => createHash('sha256').update(s).digest('hex');

const post = async (u, p, b, o) => {
  const r = await fetch(u + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, ...(o ? { origin: o } : {}) }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json() };
};
const get = async (u, p, o) => {
  const r = await fetch(u + p, { headers: { authorization: 'Bearer ' + TOKEN, ...(o ? { origin: o } : {}) } });
  return { status: r.status, json: await r.json() };
};

async function main() {
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: TOKEN, ownerKeyHash: OWNER_HASH, allowedOrigins: [ORIGIN] });
  const U = bridge.url;
  let transport = null;
  let client = null;
  try {
    // ---- human handshake (real in-game form) + companion authorize (CONNECTED) ----
    const hs = await post(U, '/world-link/handshake', { authorized: true, protocolVersion: 1, ownerKey: OWNER_KEY }, ORIGIN);
    check('human handshake with ownerKey -> 200 + ownerCap', hs.status === 200 && !!hs.json.session && !!hs.json.ownerCap, { status: hs.status, json: hs.json });
    const session = hs.json.session;
    const epoch0 = hs.json.epoch;
    check('human handshake returns ownerCap (renderer-only)', typeof hs.json.ownerCap === 'string');
    const auth = await post(U, '/world-link/companion-authorize', { session, epoch: epoch0, ownerCap: hs.json.ownerCap, ownerMode: 'human' }, ORIGIN);
    check('companion authorize (ownerCap) -> 200 CONNECTED', auth.status === 200 && auth.json.ok === true, { status: auth.status, json: auth.json });

    // Nest snapshot of a real Pause: no observation pushed, no sim tick.
    const t0 = Date.now();
    const sess0 = gateway.listSessions().find((s) => s.session === session);
    info('gateway right after authorize (Pause open)', { status: sess0?.status, epoch: sess0?.epoch, lastSeenAgoMs: sess0 ? Date.now() - sess0.lastSeenMs : null });

    // ---- official Companion MCP server: Agent env ONLY bridgeUrl + token ----
    const SERVER = resolve('dist-mcp/companionMcpServer.mjs');
    transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, LAST_SIGNAL_WORLD_BRIDGE_URL: U, LAST_SIGNAL_WORLD_TOKEN: TOKEN }, stderr: 'pipe' });
    client = new Client({ name: 'reviewer-session-repro', version: '1' });
    await client.connect(transport);

    // ---- round 1: echo_observe immediately (no observation ever pushed) ----
    const r1 = await client.callTool({ name: 'echo_observe', arguments: {} });
    const r1c = r1.structuredContent ?? {};
    info('round 1 echo_observe (immediately after CONNECTED)', { ok: r1c.ok, code: r1c.code, messageKey: r1c.messageKey, atMs: Date.now() - t0, gatewayStatus: gateway.listSessions().find((s) => s.session === session)?.status, gatewayEpoch: gateway.listSessions().find((s) => s.session === session)?.epoch });
    check('round 1 echo_observe -> E_LINK_UNAVAILABLE companion.no_observation (no initial push)', r1c.ok === false && r1c.code === 'E_LINK_UNAVAILABLE' && r1c.messageKey === 'companion.no_observation', { ok: r1c.ok, code: r1c.code, messageKey: r1c.messageKey });

    // ---- idle ~15s (Pause open). Only the CompanionLink heartbeat action:
    //      GET companion-status (does NOT POST renderer heartbeat / no push). ----
    let lostSeen = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const st = gateway.listSessions().find((s) => s.session === session);
      const hb = await get(U, '/world-link/companion-status?session=' + session + '&epoch=' + epoch0, ORIGIN);
      info('idle tick ' + (i + 1) + 's', { gatewayStatus: st?.status, gatewayEpoch: st?.epoch, heartbeatStatus: hb.status, heartbeatOk: hb.json?.ok });
      // The CompanionLink heartbeat's GET must NOT keep the session connected.
      if (st?.status === 'lost') lostSeen = true;
    }
    const sessEnd = gateway.listSessions().find((s) => s.session === session);
    info('gateway after ~15s idle (Pause open, only GET heartbeat)', { status: sessEnd?.status, epoch: sessEnd?.epoch, coreTick: 0 });
    check('gateway session became LOST despite GET-only heartbeat (renderer heartbeat not POSTed)', lostSeen && sessEnd?.status === 'lost', { status: sessEnd?.status, epoch: sessEnd?.epoch });
    check('gateway epoch bumped past the agent-cached epoch', (sessEnd?.epoch ?? 0) > epoch0, { epoch0, epochEnd: sessEnd?.epoch });

    // ---- round 2: echo_observe -> stale_epoch (Agent cached epoch0 from attach) ----
    const r2 = await client.callTool({ name: 'echo_observe', arguments: {} });
    const r2c = r2.structuredContent ?? {};
    info('round 2 echo_observe after ~15s', { ok: r2c.ok, code: r2c.code, messageKey: r2c.messageKey, gatewayEpoch: gateway.listSessions().find((s) => s.session === session)?.epoch });
    check('round 2 echo_observe -> E_STALE_EPOCH world.stale_epoch (Agent cached old epoch)', r2c.ok === false && r2c.code === 'E_STALE_EPOCH' && r2c.messageKey === 'world.stale_epoch', { ok: r2c.ok, code: r2c.code, messageKey: r2c.messageKey });

    console.log('SESSION_REPRO_' + (failures === 0 ? 'PASS' : 'FAIL') + ' failures=' + failures);
    if (failures > 0) process.exitCode = 1;
  } finally {
    try { if (client) await client.close(); } catch { /* ignore */ }
    await bridge.close();
  }
}
main().catch((e) => { console.log('FAIL exception', String(e)); process.exitCode = 1; });
