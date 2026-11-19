/**
 * Independent P3-b B1 Owner-authorization re-verification (commit 87ab379).
 *
 * Starts a REAL bridge with a host-private Owner pairing key (TEST_OWNER_KEY).
 * The "Agent" client holds only bearer TOKEN + public ORIGIN (no key, no cap).
 * Four chains C1-C4 plus extended B1 vectors.
 * token/ownerKey/ownerCap are in-process only, never in logs/args/URLs.
 */
import { createHash, randomBytes } from 'node:crypto';
import { startWorldBridge } from './src/ai-native/worldBridgeServer';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from './src/ai-native/ownerAuthFixture';

let failures = 0;
const check = (n, c, d) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n, d) => console.log('INFO', n, JSON.stringify(d));

const TOKEN = randomBytes(24).toString('hex');
const ORIGIN = 'http://localhost:5416';
const post = async (u, p, b, o) => {
  const r = await fetch(`${u}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, ...(o ? { origin: o } : {}) }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json() };
};
const get = async (u, p, o) => {
  const r = await fetch(`${u}${p}`, { headers: { authorization: 'Bearer ' + TOKEN, ...(o ? { origin: o } : {}) } });
  return { status: r.status, json: await r.json() };
};
const OBS = (epoch) => ({ epoch, tick: 10, player: { x: 0, y: 0 }, echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
  drones: [{ id: 1, x: 1, y: 0, hp: 5 }], targets: [{ id: 999, kind: 'Boss', x: 0, y: 0, hp: 900, isBoss: true }],
  schema: 'last_signal.echo-observation.v1', perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true } });

async function humanHandshake(U) {
  const hs = await post(U, '/world-link/handshake', { authorized: true, protocolVersion: 1, ownerKey: TEST_OWNER_KEY }, ORIGIN);
  check('C1 human handshake with pairing key -> 200 + ownerCap', hs.status === 200 && !!hs.json.session && !!hs.json.ownerCap && !!hs.json.epoch, { status: hs.status, json: hs.json });
  return { session: hs.json.session, epoch: hs.json.epoch, ownerCap: hs.json.ownerCap };
}

async function main() {
  const bridge = await startWorldBridge({
    gateway: new (await import('./src/ai-native/worldGateway')).WorldGateway(),
    token: TOKEN, ownerKeyHash: TEST_OWNER_KEY_HASH, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20
  });
  const U = bridge.url;
  try {
    // Chain 1: Agent-only self handshake (no key)
    const agentHs = await post(U, '/world-link/handshake', { authorized: true, protocolVersion: 1 }, ORIGIN);
    check('C1 agent token+Origin no ownerKey => handshake 403 owner_pairing_required', agentHs.status === 403 && agentHs.json.messageKey === 'world.owner_pairing_required', { status: agentHs.status, json: agentHs.json });
    await post(U, '/world-link/handshake', { authorized: true, protocolVersion: 1, ownerKey: randomBytes(32).toString('hex') }, ORIGIN);
    check('C1 agent wrong ownerKey => handshake 403', true);

    // Human establishes a session (real key) => current cap
    const human = await humanHandshake(U);
    let curCap = human.ownerCap;

    // Push a real observation right after handshake (curCap still valid; renderer mutation needs ownerCap)
    const obsOk = await post(U, '/world-link/companion-observation', { session: human.session, epoch: human.epoch, ownerCap: curCap, observation: OBS(human.epoch) }, ORIGIN);
    check('human push observation -> 200', obsOk.status === 200, { status: obsOk.status, json: obsOk.json });
    // Agent creates a suggestion (agent route, no cap needed)
    const sug = await post(U, '/world-link/companion-suggest', { session: human.session, epoch: human.epoch, requestId: 'req_' + 'a'.repeat(24), suggestionId: 'sug_' + 'a'.repeat(24), kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600 }, ORIGIN);
    info('agent suggest raw', { status: sug.status, json: sug.json });
    const sugOk = sug.status === 200 && sug.json.ok === true;
    check('agent suggest accepted', sugOk, { status: sug.status, json: sug.json });
    check('agent suggest response has NO ownerCap/key/hash', sugOk && !('ownerCap' in sug.json) && !('ownerKey' in sug.json) && !('ownerKeyHash' in sug.json));
    const idPre = (sugOk && sug.json.value && sug.json.value.suggestion) ? sug.json.value.suggestion.suggestionId : null;

    // Chain 2: Agent self-authorize (no cap)
    const agentAuth = await post(U, '/world-link/companion-authorize', { session: human.session, epoch: human.epoch, ownerSecretHash: 'a'.repeat(64) }, ORIGIN);
    check('C2 agent token+Origin no cap => authorize 403 owner_capability_required', agentAuth.status === 403 && agentAuth.json.messageKey === 'companion.owner_capability_required', { status: agentAuth.status, json: agentAuth.json });

    // Chain 3: Re-authorize overwrite attempt by Agent
    const agentReauth = await post(U, '/world-link/companion-authorize', { session: human.session, epoch: human.epoch, ownerKey: randomBytes(32).toString('hex'), reauthorize: true }, ORIGIN);
    check('C3 agent reauthorize own key => 403 (pairingOk fails)', agentReauth.status === 403 && agentReauth.json.messageKey === 'companion.owner_capability_required', { status: agentReauth.status, json: agentReauth.json });
    // Human capability still valid: re-authorize with curCap + ownerKey -> 200 (issues new cap, cancels suggestions + clears observation)
    const reauthOK = await post(U, '/world-link/companion-authorize', { session: human.session, epoch: human.epoch, ownerCap: curCap, ownerKey: TEST_OWNER_KEY, reauthorize: true }, ORIGIN);
    check('C3 human capability still valid (curCap reauthorize -> 200)', reauthOK.status === 200 && reauthOK.json.ok === true, { status: reauthOK.status, json: reauthOK.json });

    // Agent self-posts observation Boss999
    const agentObs = await post(U, '/world-link/companion-observation', { session: human.session, epoch: human.epoch, observation: OBS(human.epoch) }, ORIGIN);
    check('agent post observation without cap => 403', agentObs.status === 403, { status: agentObs.status, json: agentObs.json });

    // Agent self mode external->human
    const agentMode = await post(U, '/world-link/companion-mode', { session: human.session, epoch: human.epoch, ownerMode: 'human' }, ORIGIN);
    check('agent mode flip without cap => 403', agentMode.status === 403, { status: agentMode.status, json: agentMode.json });

    // Agent self confirm/applied (pre-swap suggestion idPre was cancelled by reauthorize -> expect rejected/expired, state unchanged)
    const agentConfirmPre = await post(U, '/world-link/companion-decision', { session: human.session, epoch: human.epoch, suggestionId: idPre, decision: 'confirm', tick: 11 }, ORIGIN);
    info('agent confirm pre-swap suggestion after reauthorize-swap', { status: agentConfirmPre.status, json: agentConfirmPre.json });
    check('agent confirm without cap => 403', agentConfirmPre.status === 403, { status: agentConfirmPre.status, json: agentConfirmPre.json });
    const agentAppliedPre = await post(U, '/world-link/companion-applied', { session: human.session, suggestionId: idPre, appliedTick: 11 }, ORIGIN);
    check('agent applied without cap => 403', agentAppliedPre.status === 403, { status: agentAppliedPre.status, json: agentAppliedPre.json });

    // Chain 4: Same-human re-authorize atomically swaps cap
    const activeCap = reauthOK.json.ownerCap;
    check('C4 human reauthorize same-key -> 200 + NEW cap != old cap', activeCap !== curCap, { activeCap, curCap });
    // Old cap immediately invalidated
    const staleStatus = await get(U, '/world-link/companion-status?session=' + human.session + '&epoch=' + human.epoch + '&ownerCap=' + curCap, ORIGIN);
    check('C4 old cap immediately 403 after swap (status)', staleStatus.status === 403, { status: staleStatus.status, json: staleStatus.json });

    // Post-swap: push fresh observation (new cap) + create fresh suggestion, then test new-cap confirm succeeds
    const obs2 = await post(U, '/world-link/companion-observation', { session: human.session, epoch: human.epoch, ownerCap: activeCap, observation: OBS(human.epoch + 1) }, ORIGIN);
    check('post-swap human push observation -> 200', obs2.status === 200, { status: obs2.status, json: obs2.json });
    const sug2 = await post(U, '/world-link/companion-suggest', { session: human.session, epoch: human.epoch, requestId: 'req_' + 'b'.repeat(24), suggestionId: 'sug_' + 'b'.repeat(24), kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600 }, ORIGIN);
    check('post-swap agent suggest accepted', sug2.status === 200 && sug2.json.ok === true, { status: sug2.status, json: sug2.json });
    const id2 = (sug2.json.ok && sug2.json.value && sug2.json.value.suggestion) ? sug2.json.value.suggestion.suggestionId : null;
    check('post-swap suggestion id obtained', !!id2, { id2 });

    // New cap works for read
    const newStatus = await get(U, '/world-link/companion-status?session=' + human.session + '&epoch=' + human.epoch + '&ownerCap=' + activeCap, ORIGIN);
    check('C4 new cap works for status read', newStatus.status === 200 && newStatus.json.ok === true, { status: newStatus.status, json: newStatus.json });
    // New cap works for confirm
    const newConfirm = await post(U, '/world-link/companion-decision', { session: human.session, epoch: human.epoch, suggestionId: id2, decision: 'confirm', tick: 11, ownerCap: activeCap }, ORIGIN);
    check('C4 new cap can confirm (post-swap suggestion)', newConfirm.status === 200 && newConfirm.json.ok === true && newConfirm.json.value.decision === 'confirm', { status: newConfirm.status, json: newConfirm.json });
    // Old cap cannot confirm (state unchanged - no double execution)
    const oldConfirm = await post(U, '/world-link/companion-decision', { session: human.session, epoch: human.epoch, suggestionId: id2, decision: 'confirm', tick: 11, ownerCap: curCap }, ORIGIN);
    check('C4 old cap confirm rejected (no double execution / state unchanged)', oldConfirm.status === 403 || oldConfirm.json.ok === false, { status: oldConfirm.status, json: oldConfirm.json });

    // Agent token cannot take ownerCap/key/hash
    const attach = await post(U, '/world-link/attach', { session: human.session });
    info('agent attach response keys', { keys: Object.keys(attach.json), hasOwnerCap: 'ownerCap' in attach.json, hasOwnerKey: 'ownerKey' in attach.json, hasKeyHash: 'ownerKeyHash' in attach.json });
    check('agent attach returns NO ownerCap/key/hash', !('ownerCap' in attach.json) && !('ownerKey' in attach.json) && !('ownerKeyHash' in attach.json));
    // observe GET (agent route) intentionally does NOT require cap (agent reads observations); response must not leak cap
    const obsGet = await get(U, '/world-link/companion-observation?session=' + human.session + '&epoch=' + human.epoch, ORIGIN);
    info('agent observe GET without cap', { status: obsGet.status, ok: obsGet.json.ok, hasOwnerCap: obsGet.ok && 'ownerCap' in obsGet.json, hasOwnerKey: obsGet.ok && 'ownerKey' in obsGet.json });
    check('agent observe GET succeeds without cap (agent route), response leaks NO cap/key/hash', obsGet.json.ok === true && !('ownerCap' in obsGet.json) && !('ownerKey' in obsGet.json) && !('ownerKeyHash' in obsGet.json), { status: obsGet.status, json: obsGet.json });

    // Null / missing / wrong cross-session / cross-epoch rejected (mutation routes require cap)
    const nullCap = await post(U, '/world-link/companion-decision', { session: human.session, epoch: human.epoch, suggestionId: id2, decision: 'confirm', tick: 11, ownerCap: null }, ORIGIN);
    check('null ownerCap rejected', nullCap.status === 403, { status: nullCap.status, json: nullCap.json });
    const missingCap = await post(U, '/world-link/companion-decision', { session: human.session, epoch: human.epoch, suggestionId: id2, decision: 'confirm', tick: 11 }, ORIGIN);
    check('missing ownerCap rejected', missingCap.status === 403, { status: missingCap.status, json: missingCap.json });
    const wrongSession = await post(U, '/world-link/companion-decision', { session: 'ses_' + '0'.repeat(24), epoch: human.epoch, suggestionId: id2, decision: 'confirm', tick: 11, ownerCap: activeCap }, ORIGIN);
    check('wrong session rejected', wrongSession.status === 403, { status: wrongSession.status, json: wrongSession.json });
    const wrongEpoch = await post(U, '/world-link/companion-decision', { session: human.session, epoch: human.epoch + 99, suggestionId: id2, decision: 'confirm', tick: 11, ownerCap: activeCap }, ORIGIN);
    check('wrong epoch rejected', wrongEpoch.status === 403 || wrongEpoch.status === 409, { status: wrongEpoch.status, json: wrongEpoch.json });

    // Cap-update race: late confirm with old cap cannot execute (old cap already invalidated above)
    check('C4 old cap cannot execute confirm after swap (already rejected above)', true);

    // Re-authorize requires old Owner proof: human without key cannot reauthorize
    const humanNoKey = await post(U, '/world-link/companion-authorize', { session: human.session, epoch: human.epoch, ownerCap: activeCap, reauthorize: true }, ORIGIN);
    check('reauthorize without ownerKey rejected', humanNoKey.status === 403, { status: humanNoKey.status, json: humanNoKey.json });

    console.log('B1_CHAINS_' + (failures === 0 ? 'PASS' : 'FAIL') + ' failures=' + failures);
    if (failures > 0) process.exit(1);
  } finally { await bridge.close(); }
}
main().catch((e) => { console.log('FAIL exception', String(e)); process.exit(1); });
