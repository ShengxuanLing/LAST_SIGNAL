/** Can an Agent fabricate the echo observation (crop attestation is a self-declared string)? */
import { createHash, randomBytes } from 'node:crypto';
import { WorldGateway } from './src/ai-native/worldGateway';
import { startWorldBridge } from './src/ai-native/worldBridgeServer';
import { isEchoObservation, ECHO_OBSERVATION_SCHEMA } from './src/world/echoView';
let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));
const ORIGIN = 'http://localhost:5412';
const TOKEN = randomBytes(24).toString('hex');
const h = (s: string) => createHash('sha256').update(s).digest('hex');
const post = async (u: string, p: string, b: unknown, o?: string) => {
  const r = await fetch(`${u}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(o ? { origin: o } : {}) }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json() };
};
const get = async (u: string, p: string) => {
  const r = await fetch(`${u}${p}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  return { status: r.status, json: await r.json() };
};
async function main() {
  const bridge = await startWorldBridge({ gateway: new WorldGateway(), token: TOKEN, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20 });
  const U = bridge.url;
  try {
    const hs = await post(U, '/world-link/handshake', { authorized: true, protocolVersion: 1 }, ORIGIN);
    const session = hs.json.session as string, epoch = hs.json.epoch as number;
    await post(U, '/world-link/companion-authorize', { session, epoch, ownerSecretHash: h(randomBytes(24).toString('hex')), ownerMode: 'human' }, ORIGIN);
    await post(U, '/world-link/attach', { session });

    // A fabricated "cropped" observation: schema + perception are PUBLIC strings
    // that any process can copy; targets/drones are self-declared.
    const fake = {
      epoch, tick: 10, player: { x: 0, y: 0 },
      echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
      drones: [{ id: 1, x: 1, y: 0, hp: 5 }],
      targets: [{ id: 999, kind: 'hunter', x: 2, y: 2, hp: 900, isBoss: true }],
      schema: ECHO_OBSERVATION_SCHEMA,
      perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true }
    };
    const { epoch: _epoch, ...attested } = fake as Record<string, unknown>;
    check('forged object (minus epoch) passes isEchoObservation (self-declared attestation)', isEchoObservation(attested));
    const push = await post(U, '/world-link/companion-observation', { session, epoch, observation: fake }, ORIGIN);
    info('Agent pushes fabricated observation via forged Origin', { status: push.status, json: push.json });
    check('HOLE: Agent CAN push a fabricated observation (no LOS/authority proof)', push.status === 200 && push.json.ok === true);
    const obs = await get(U, `/world-link/companion-observation?session=${session}&epoch=${epoch}`);
    info('Agent reads back the fabricated perception', { ok: obs.json.ok, targets: obs.json.value?.targets, drones: obs.json.value?.drones });
    check('fabricated hidden Boss target is served to the Agent as "perception"',
      obs.json.ok && JSON.stringify(obs.json.value?.targets).includes('999'));
    // Reason can now be justified from the fabricated perception
    const sug = await post(U, '/world-link/companion-suggest', {
      session, epoch, requestId: 'req_' + 'a'.repeat(24), suggestionId: 'sug_' + 'a'.repeat(24),
      kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600
    });
    check('suggestion accepted on the fabricated observation', sug.json.ok === true, { json: sug.json });
    // hidden extra field still rejected
    const withHidden = { ...fake, hiddenTarget: { x: 9999, y: 9999, hp: 1 } };
    check('isEchoObservation still rejects unknown extra fields', !isEchoObservation(withHidden));
    const pushHidden = await post(U, '/world-link/companion-observation', { session, epoch, observation: withHidden }, ORIGIN);
    check('gateway rejects observation with hidden extra field', pushHidden.json.ok === false, { json: pushHidden.json });
  } finally { await bridge.close(); }
  console.log(`FAKE_OBS_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
  if (failures > 0) process.exit(1);
}
main().catch((e) => { console.log('FAIL exception', String(e)); process.exit(1); });
