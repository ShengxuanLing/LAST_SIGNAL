/** Strongest vector: can the Agent create its OWN session with a forged Origin? */
import { createHash, randomBytes } from 'node:crypto';
import { WorldGateway } from './src/ai-native/worldGateway';
import { startWorldBridge } from './src/ai-native/worldBridgeServer';
let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));
const ORIGIN = 'http://localhost:5412';
const TOKEN = randomBytes(24).toString('hex');
const secret = randomBytes(24).toString('hex');
const h = (s: string) => createHash('sha256').update(s).digest('hex');
const post = async (u: string, p: string, b: unknown, o?: string) => {
  const r = await fetch(`${u}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(o ? { origin: o } : {}) }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json() };
};
async function main() {
  const bridge = await startWorldBridge({ gateway: new WorldGateway(), token: TOKEN, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20 });
  const U = bridge.url;
  try {
    // Agent forges the exact game Origin on HANDSHAKE (no human click at all).
    const hs = await post(U, '/world-link/handshake', { authorized: true, protocolVersion: 1 }, ORIGIN);
    info('agent-forged handshake', { status: hs.status, json: hs.json });
    check('agent CAN complete handshake with forged Origin', hs.status === 200 && !!hs.json.session);
    const session = hs.json.session as string, epoch = hs.json.epoch as number;
    const auth = await post(U, '/world-link/companion-authorize', { session, epoch, ownerSecretHash: h(secret), ownerMode: 'human' }, ORIGIN);
    info('agent self-authorize', { status: auth.status, json: auth.json });
    check('agent CAN self-authorize companion with its own secret', auth.status === 200);
    const attach = await post(U, '/world-link/attach', { session });
    check('agent attaches to its own session', attach.status === 200);
    const obs = { epoch, tick: 10, player: { x: 0, y: 0 }, echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
      drones: [{ id: 1, x: 1, y: 0, hp: 5 }], schema: 'last_signal.echo-observation.v1',
      perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true }, targets: [] };
    const po = await post(U, '/world-link/companion-observation', { session, epoch, observation: obs }, ORIGIN);
    check('agent pushes its own observation', po.status === 200);
    const id = 'sug_' + 'a'.repeat(24);
    const sug = await post(U, '/world-link/companion-suggest', { session, epoch, requestId: 'req_' + 'a'.repeat(24), suggestionId: id,
      kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600 });
    check('agent proposes', sug.json.ok === true);
    const dec = await post(U, '/world-link/companion-decision', { session, epoch, suggestionId: id, decision: 'confirm', tick: 11, ownerSecret: secret }, ORIGIN);
    info('AGENT FULL SELF-CONFIRM (no human anywhere)', { status: dec.status, json: dec.json });
    check('BLOCKER: Agent can create session + self-authorize + self-confirm with NO human', dec.status === 200 && dec.json.ok === true);
  } finally { await bridge.close(); }
  console.log(`AGENT_FULL_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
  if (failures > 0) process.exit(1);
}
main().catch((e) => { console.log('FAIL exception', String(e)); process.exit(1); });
