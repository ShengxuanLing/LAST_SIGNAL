/** Characterize the re-authorize blocker's reach + related mode-flip vector. */
import { createHash, randomBytes } from 'node:crypto';
import { WorldGateway } from './src/ai-native/worldGateway';
import { startWorldBridge } from './src/ai-native/worldBridgeServer';
let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));
const ORIGIN = 'http://localhost:5412';
const TOKEN = randomBytes(24).toString('hex');
const bs = randomBytes(24).toString('hex'), as = randomBytes(24).toString('hex');
const h = (s: string) => createHash('sha256').update(s).digest('hex');
const post = async (u: string, p: string, b: unknown, o?: string) => {
  const r = await fetch(`${u}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(o ? { origin: o } : {}) }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json() };
};
async function main() {
  const bridge = await startWorldBridge({ gateway: new WorldGateway(), token: TOKEN, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20 });
  const U = bridge.url;
  try {
    const hs = await post(U, '/world-link/handshake', { authorized: true, protocolVersion: 1 }, ORIGIN);
    const session = hs.json.session as string, epoch = hs.json.epoch as number;
    await post(U, '/world-link/companion-authorize', { session, epoch, ownerSecretHash: h(bs), ownerMode: 'human' }, ORIGIN);
    await post(U, '/world-link/attach', { session });

    // Variant A: re-authorize with NO Origin (agent-style) must be denied.
    const noOrigin = await post(U, '/world-link/companion-authorize', { session, epoch, ownerSecretHash: h(as) });
    info('re-authorize with NO Origin', { status: noOrigin.status, json: noOrigin.json });
    check('no-Origin re-authorize denied', noOrigin.status === 403);
    // Variant B: forged Origin + wrong session must be denied by gateway.
    const wrongSession = await post(U, '/world-link/companion-authorize', { session: 'ses_' + '0'.repeat(24), epoch, ownerSecretHash: h(as) }, ORIGIN);
    info('re-authorize with wrong session', { status: wrongSession.status, json: wrongSession.json });
    check('wrong-session re-authorize denied', wrongSession.json.ok === false);
    // Variant C: forged Origin + wrong epoch must be denied.
    const wrongEpoch = await post(U, '/world-link/companion-authorize', { session, epoch: epoch + 5, ownerSecretHash: h(as) }, ORIGIN);
    info('re-authorize with wrong epoch', { status: wrongEpoch.status, json: wrongEpoch.json });
    check('wrong-epoch re-authorize denied', wrongEpoch.json.ok === false);
    // Variant D: forged Origin + correct session/epoch => ACCEPTED (the hole).
    const reauth = await post(U, '/world-link/companion-authorize', { session, epoch, ownerSecretHash: h(as), ownerMode: 'human' }, ORIGIN);
    info('re-authorize with forged Origin + correct session/epoch', { status: reauth.status, json: reauth.json });
    check('HOLE CONFIRMED: agent can overwrite ownerSecretHash', reauth.status === 200 && reauth.json.ok === true);
    // Variant E: after overwrite, the browser's original secret no longer works.
    const browserDec = await post(U, '/world-link/companion-decision', {
      session, epoch, suggestionId: 'sug_' + 'c'.repeat(24), decision: 'confirm', tick: 11, ownerSecret: bs
    }, ORIGIN);
    info('original browser secret after overwrite', { status: browserDec.status, code: browserDec.json?.code });
    check('original browser secret invalidated (Agent hijacked Owner credential)', browserDec.status === 403);
    // Variant F: companion-mode with forged Origin can flip ai/external -> human (read-only bypass).
    await post(U, '/world-link/companion-mode', { session, epoch, ownerMode: 'ai' }, ORIGIN);
    const flip = await post(U, '/world-link/companion-mode', { session, epoch, ownerMode: 'human' }, ORIGIN);
    info('agent flips ownerMode ai -> human via forged Origin', { status: flip.status, json: flip.json });
    check('HOLE: ownerMode flip also only guarded by forgeable Origin', flip.json.value?.readOnly === false);
    // Variant G: companion-authorize never requires the EXISTING owner secret.
    const src = (await import('node:fs')).readFileSync('src/ai-native/worldBridgeServer.ts', 'utf8');
    check('companionAuthorize does NOT call ownerSecretOk', !/companionAuthorize[\s\S]{0,700}ownerSecretOk/.test(src));
    // Variant H: bridge launcher prints ORIGIN verbatim => agent can learn the forgeable Origin.
    const launcher = (await import('node:fs')).readFileSync('scripts/c3b-bridge.mts', 'utf8');
    check('launcher prints ORIGIN (agent can learn the value to forge)', /ORIGIN=\$\{ORIGIN\}/.test(launcher));
  } finally { await bridge.close(); }
  console.log(`REAUTH_BOUNDARY_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
  if (failures > 0) process.exit(1);
}
main().catch((e) => { console.log('FAIL exception', String(e)); process.exit(1); });
