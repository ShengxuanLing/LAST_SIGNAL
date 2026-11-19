/**
 * Critical negative: can an Agent (token + forged Origin, but WITHOUT the
 * browser-held secret) re-authorize the session with its OWN ownerSecretHash
 * and then confirm? If yes, Owner isolation is broken.
 */
import { createHash, randomBytes } from 'node:crypto';
import { WorldGateway } from './src/ai-native/worldGateway';
import { startWorldBridge } from './src/ai-native/worldBridgeServer';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));
const ORIGIN = 'http://localhost:5412';
const TOKEN = randomBytes(24).toString('hex');
const browserSecret = randomBytes(24).toString('hex');
const agentSecret = randomBytes(24).toString('hex');
const h = (s: string) => createHash('sha256').update(s).digest('hex');
const post = async (u: string, p: string, b: unknown, o?: string) => {
  const r = await fetch(`${u}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(o ? { origin: o } : {}) }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json() };
};
const OBS = (epoch: number) => ({ epoch, tick: 10, player: { x: 0, y: 0 }, echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
  drones: [{ id: 1, x: 1, y: 0, hp: 5 }], schema: 'last_signal.echo-observation.v1',
  perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true }, targets: [] });

async function main(): Promise<void> {
  const bridge = await startWorldBridge({ gateway: new WorldGateway(), token: TOKEN, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20 });
  const U = bridge.url;
  try {
    const hs = await post(U, '/world-link/handshake', { authorized: true, protocolVersion: 1 }, ORIGIN);
    const session = hs.json.session as string, epoch = hs.json.epoch as number;
    const auth = await post(U, '/world-link/companion-authorize', { session, epoch, ownerSecretHash: h(browserSecret), ownerMode: 'human' }, ORIGIN);
    check('human authorize with browser secret ok', auth.status === 200);
    const attach = await post(U, '/world-link/attach', { session });
    check('agent attaches and learns the session id', attach.status === 200 && attach.json.session === session);

    // Agent forges the game's Origin and RE-AUTHORIZES with its own secret hash.
    const reauth = await post(U, '/world-link/companion-authorize', {
      session, epoch, ownerSecretHash: h(agentSecret), ownerMode: 'human'
    }, ORIGIN);
    info('agent re-authorize with forged Origin + own secret hash', { status: reauth.status, json: reauth.json });

    await post(U, '/world-link/companion-observation', { session, epoch, observation: OBS(epoch) }, ORIGIN);
    const id = 'sug_' + 'a'.repeat(24);
    const sug = await post(U, '/world-link/companion-suggest', {
      session, epoch, requestId: 'req_' + 'a'.repeat(24), suggestionId: id,
      kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120
    });
    check('agent suggestion created', sug.json.ok === true);

    const selfConfirm = await post(U, '/world-link/companion-decision', {
      session, epoch, suggestionId: id, decision: 'confirm', tick: 11, ownerSecret: agentSecret
    }, ORIGIN);
    info('AGENT self-confirm result (token + forged Origin + own secret)', { status: selfConfirm.status, json: selfConfirm.json });
    const browserConfirm = await post(U, '/world-link/companion-decision', {
      session, epoch, suggestionId: 'sug_' + 'b'.repeat(24), decision: 'confirm', tick: 11, ownerSecret: browserSecret
    }, ORIGIN);
    info('original browser secret still valid?', { status: browserConfirm.status, json: browserConfirm.json });

    if (selfConfirm.status === 200 && selfConfirm.json.ok === true) {
      check('BLOCKER: Agent CAN install its own secret and self-confirm -> Owner isolation BROKEN', false, { reauth: reauth.json, selfConfirm: selfConfirm.json });
    } else {
      check('Agent re-authorize + self-confirm blocked (Owner isolation intact)', true);
    }
  } finally { await bridge.close(); }
  console.log(`REAUTH_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
  if (failures > 0) process.exit(1);
}
main().catch((e) => { console.log('FAIL exception', String(e)); process.exit(1); });
