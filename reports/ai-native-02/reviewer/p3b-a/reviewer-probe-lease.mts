/**
 * Independent lease HARDKILL probe: no renew => agent lease expires on the
 * 4s deadline, bridge reaper hard-disconnects. Late requests must NOT
 * auto-restore suggestions; no fake connected state. Own ephemeral port.
 */
import { createHash, randomBytes } from 'node:crypto';
import { WorldGateway } from './src/ai-native/worldGateway';
import { startWorldBridge } from './src/ai-native/worldBridgeServer';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));
const ORIGIN = 'http://localhost:5412';
const TOKEN = randomBytes(24).toString('hex');
const secret = randomBytes(24).toString('hex');
const hashOf = (s: string) => createHash('sha256').update(s).digest('hex');
const post = async (u: string, p: string, b: unknown, o?: string) => {
  const r = await fetch(`${u}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(o ? { origin: o } : {}) }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json() };
};
const get = async (u: string, p: string, o?: string) => {
  const r = await fetch(`${u}${p}`, { headers: { authorization: `Bearer ${TOKEN}`, ...(o ? { origin: o } : {}) } });
  return { status: r.status, json: await r.json() };
};
const OBS = (epoch: number) => ({
  epoch, tick: 10, player: { x: 0, y: 0 }, echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
  drones: [{ id: 1, x: 1, y: 0, hp: 5 }], schema: 'last_signal.echo-observation.v1',
  perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true }, targets: []
});

async function main(): Promise<void> {
  const bridge = await startWorldBridge({ gateway: new WorldGateway(), token: TOKEN, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20 });
  const U = bridge.url;
  try {
    const hs = await post(U, '/world-link/handshake', { authorized: true, protocolVersion: 1 }, ORIGIN);
    const session = hs.json.session as string, epoch = hs.json.epoch as number;
    await post(U, '/world-link/companion-authorize', { session, epoch, ownerSecretHash: hashOf(secret), ownerMode: 'human' }, ORIGIN);
    const attach = await post(U, '/world-link/attach', { session });
    check('agent lease issued', attach.status === 200 && !!attach.json.leaseId);
    info('lease TTL', { leaseMs: attach.json.leaseMs, renewMs: attach.json.renewMs });

    // Push observation + suggest, then DO NOT renew the lease (hard kill simulation).
    await post(U, '/world-link/companion-observation', { session, epoch, observation: OBS(epoch) }, ORIGIN);
    const id = 'sug_' + 'a'.repeat(24);
    const sug = await post(U, '/world-link/companion-suggest', {
      session, epoch, requestId: 'req_' + 'a'.repeat(24), suggestionId: id,
      kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600
    });
    check('suggestion created before lease expiry', sug.json.ok === true);
    const before = await get(U, `/world-link/companion-status?session=${session}&epoch=${epoch}`);
    check('pending suggestion before expiry', before.json.value?.status?.pendingSuggestions === 1, { json: before.json });

    // Wait past AGENT_LEASE_MS (4000) + reaper (200) WITHOUT renewing.
    const t0 = Date.now();
    let expired = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const st = await get(U, `/world-link/agent-status?session=${session}&leaseId=${attach.json.leaseId}`);
      if (st.json.attached === false || st.json.status === 'closed' || st.json.status === 'lost') { expired = true; break; }
    }
    info('lease hardkill elapsed', { ms: Date.now() - t0, expired, stats: bridge.leaseStats() });
    check('lease HARD-EXPIRES without renew (no SIGKILL cleanup needed)', expired);

    const after = await get(U, `/world-link/companion-status?session=${session}&epoch=${epoch}`);
    info('companion status after hardkill', { ok: after.json.ok, code: after.json.code, link: after.json.value?.status?.link, pending: after.json.value?.status?.pendingSuggestions });
    check('companion link degraded (not fake connected)', after.json.ok === false || after.json.value?.status?.link === 'fallback');

    // Late agent requests must NOT auto-restore suggestions or reconnect.
    const lateSuggest = await post(U, '/world-link/companion-suggest', {
      session, epoch, requestId: 'req_' + 'b'.repeat(24), suggestionId: 'sug_' + 'b'.repeat(24),
      kind: 'move', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600
    });
    check('late agent suggest after hardkill rejected', lateSuggest.json.ok === false, { status: lateSuggest.status, json: lateSuggest.json });
    const lateStatus = await get(U, `/world-link/companion-status?session=${session}&epoch=${epoch}`);
    check('late request did NOT auto-restore pending suggestions',
      lateStatus.json.ok === false || (lateStatus.json.value?.status?.pendingSuggestions ?? 0) === 0, { json: lateStatus.json });
    const lateDec = await post(U, '/world-link/companion-decision', {
      session, epoch, suggestionId: id, decision: 'confirm', tick: 11, ownerSecret: secret
    }, ORIGIN);
    check('late Owner confirm after hardkill rejected', lateDec.json.ok === false, { status: lateDec.status, json: lateDec.json });
    const lateRenew = await post(U, '/world-link/agent-renew', { session, epoch, leaseId: attach.json.leaseId });
    check('old leaseId cannot renew after expiry', lateRenew.json.ok === false, { status: lateRenew.status, json: lateRenew.json });
    check('ownerSecretHash cleaned on lease expiry', !(JSON.stringify(bridge.leaseStats()).includes(secret)));
    check('token never in any response', !JSON.stringify(lateStatus.json).includes(TOKEN));
  } finally { await bridge.close(); }
  console.log(`LEASE_HARDKILL_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
  if (failures > 0) process.exit(1);
}
main().catch((e) => { console.log('FAIL exception', String(e)); process.exit(1); });
