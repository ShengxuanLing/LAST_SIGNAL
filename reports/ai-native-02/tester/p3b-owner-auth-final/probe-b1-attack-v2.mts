// Independent Tester — P3b Owner-auth fix (87ab379) re-verification of B1 attack chain.
// Adapted from probe-b1-attack.mts to the dual-credential contract.
// NEVER logs token / ownerKey / ownerCap values — only status/code/messageKey.
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { WorldGateway } from 'D:/Project/AI-NATIVE-02-snapshots/87ab379/src/ai-native/worldGateway.ts';
import { startWorldBridge } from 'D:/Project/AI-NATIVE-02-snapshots/87ab379/src/ai-native/worldBridgeServer.ts';
import { CompanionGateway } from 'D:/Project/AI-NATIVE-02-snapshots/87ab379/src/ai-native/companionGateway.ts';
import { CompanionFacet } from 'D:/Project/AI-NATIVE-02-snapshots/87ab379/src/ai-native/companionFacet.ts';
import { createOwnerCredentialFile } from 'D:/Project/AI-NATIVE-02-snapshots/87ab379/src/ai-native/ownerCredential.ts';
import { WORLD_PROTOCOL_VERSION } from 'D:/Project/AI-NATIVE-02-snapshots/87ab379/src/ai-native/worldProtocol.ts';

const ORIGIN = 'http://localhost:5392'; // declared only; probe uses bridge-assigned port
const TOKEN = randomBytes(24).toString('hex');
const results: any[] = [];
const check = (name: string, pass: boolean, observed: any) => {
  results.push({ name, verdict: pass ? 'SECURE' : 'VULNERABLE', observed });
};

const post = async (url: string, path: string, body: unknown, origin?: string, token = TOKEN) => {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(origin ? { origin } : {}) },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() };
};
const obs = (epoch: number, tick: number) => ({
  epoch, tick, player: { x: 0, y: 0 },
  echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
  drones: [{ id: 1, x: 1, y: 0, hp: 5 }],
  schema: 'last_signal.echo-observation.v1',
  perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true },
  targets: []
});
const brief = (r: any) => ({ status: r.status, ok: r.json?.ok, code: r.json?.code, messageKey: r.json?.messageKey,
  decision: r.json?.value?.decision, applied: r.json?.value?.applied });

async function main() {
  // Host-private Owner pairing key from a 0600/current-SID-only file.
  const cred = await createOwnerCredentialFile();
  const ownerKey = (await readFile(cred.path, 'utf8')).trim();
  const attackerKey = randomBytes(32).toString('hex'); // agent-generated fake key
  const attackerCap = randomBytes(32).toString('hex'); // agent-generated fake cap

  const bridge = await startWorldBridge({
    gateway: new WorldGateway(), token: TOKEN, ownerKeyHash: cred.keyHash,
    allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20
  });
  try {
    // === Positive: human handshake with pairing key issues one Owner cap ===
    const hs = await post(bridge.url, '/world-link/handshake',
      { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey }, ORIGIN);
    const session = hs.json.session as string, epoch = hs.json.epoch as number, cap = hs.json.ownerCap as string;
    check('P0 human handshake issues ownerCap', hs.status === 200 && !!session && !!cap, brief(hs));

    // C1: agent self-handshake without owner key
    const selfHs = await post(bridge.url, '/world-link/handshake',
      { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION }, ORIGIN);
    check('C1 agent self-handshake rejected', selfHs.status === 403 && selfHs.json.messageKey === 'world.owner_pairing_required', brief(selfHs));

    // C2: agent self-handshake with its own generated key
    const fakeHs = await post(bridge.url, '/world-link/handshake',
      { authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey: attackerKey }, ORIGIN);
    check('C2 agent fake-key handshake rejected', fakeHs.status === 403 && fakeHs.json.messageKey === 'world.owner_pairing_required', brief(fakeHs));

    // Human authorize with cap
    const auth = await post(bridge.url, '/world-link/companion-authorize',
      { session, epoch, ownerCap: cap, ownerMode: 'human' }, ORIGIN);
    check('P1 human authorize accepted', auth.status === 200, brief(auth));
    const authCap = auth.json.ownerCap as string; // authorize atomically rotates the cap
    check('P1b handshake cap rotated on authorize', !!authCap && authCap !== cap,
      { rotated: !!authCap && authCap !== cap });

    // X2: agent re-authorize/overwrite with fake key + fake cap + forged Origin
    const x2 = await post(bridge.url, '/world-link/companion-authorize', {
      session, epoch, ownerKey: attackerKey, ownerCap: attackerCap, ownerMode: 'human', reauthorize: true
    }, ORIGIN);
    check('X2 agent re-authorize/overwrite blocked', x2.status === 403 && x2.json.messageKey === 'companion.owner_capability_required', brief(x2));

    // X2b: reauthorize with real key but no cap
    const x2b = await post(bridge.url, '/world-link/companion-authorize', {
      session, epoch, ownerKey, ownerMode: 'human', reauthorize: true
    }, ORIGIN);
    check('X2b reauthorize w/ real key but no cap blocked', x2b.status === 403, brief(x2b));

    // X4: agent self-POST observation, forged Origin, no cap
    const x4 = await post(bridge.url, '/world-link/companion-observation',
      { session, epoch, observation: obs(epoch, 10), ownerCap: attackerCap }, ORIGIN);
    check('X4 agent fake observation blocked', x4.status === 403 && x4.json.messageKey === 'companion.owner_capability_required', brief(x4));

    // Positive observation with human cap
    const pObs = await post(bridge.url, '/world-link/companion-observation',
      { session, epoch, observation: obs(epoch, 10), ownerCap: authCap }, ORIGIN);
    check('P2 human observation accepted', pObs.status === 200, brief(pObs));

    // Human suggest (token-only agent route) to seed a real proposal
    const sugId = 'sug_' + 'a'.repeat(24);
    const sug = await post(bridge.url, '/world-link/companion-suggest', {
      session, epoch, requestId: 'req_' + 'a'.repeat(24), suggestionId: sugId,
      kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120
    });
    check('P3 agent suggest (propose-only) accepted', sug.status === 200 && sug.json.ok === true, brief(sug));

    // X6: agent self-confirm with fake cap
    const x6 = await post(bridge.url, '/world-link/companion-decision', {
      session, epoch, suggestionId: sugId, decision: 'confirm', tick: 11, ownerCap: attackerCap
    }, ORIGIN);
    check('X6 agent self-confirm blocked', x6.status === 403 && x6.json.messageKey === 'companion.owner_capability_required', brief(x6));

    // X7: agent markApplied with fake cap
    const x7 = await post(bridge.url, '/world-link/companion-applied', {
      session, suggestionId: sugId, appliedTick: 11, ownerCap: attackerCap
    }, ORIGIN);
    check('X7 agent markApplied blocked', x7.status === 403 && x7.json.messageKey === 'companion.owner_capability_required', brief(x7));

    // X9: agent mode flip external->human with fake cap
    const x9 = await post(bridge.url, '/world-link/companion-mode', {
      session, epoch, ownerMode: 'human', ownerCap: attackerCap
    }, ORIGIN);
    check('X9 agent mode flip blocked', x9.status === 403 && x9.json.messageKey === 'companion.owner_capability_required', brief(x9));

    // Verify human cap still valid after all attacks (no silent overwrite)
    const stillValid = await post(bridge.url, '/world-link/companion-observation',
      { session, epoch, observation: obs(epoch, 12), ownerCap: authCap }, ORIGIN);
    check('X10 human cap still valid after attacks', stillValid.status === 200, brief(stillValid));

    // Positive decision + applied with real cap
    const dec = await post(bridge.url, '/world-link/companion-decision', {
      session, epoch, suggestionId: sugId, decision: 'confirm', tick: 12, ownerCap: authCap
    }, ORIGIN);
    check('P4 human confirm accepted', dec.status === 200 && dec.json.value?.decision === 'confirm', brief(dec));
    const applied = await post(bridge.url, '/world-link/companion-applied', {
      session, suggestionId: sugId, appliedTick: 12, ownerCap: authCap
    }, ORIGIN);
    check('P5 human markApplied accepted', applied.status === 200 && applied.json.value?.applied === true, brief(applied));

    // Y2: production CompanionGateway.decide rejects tick earlier than creation
    const gw = new WorldGateway(), cg = new CompanionGateway(gw);
    const linked = gw.linkSession({ authorized: true, origin: ORIGIN, nowMs: Date.now() }) as any;
    const s2 = linked.session as string, e2 = linked.epoch as number;
    (cg.authorize(s2, e2, 'human') as any);
    (cg.pushObservation(s2, e2, obs(e2, 100)) as any);
    const sugY = 'sug_' + 'b'.repeat(24);
    (cg.suggest({ session: s2, epoch: e2, requestId: 'req_' + 'b'.repeat(24), suggestionId: sugY,
      kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120 }) as any);
    const early = cg.decide({ session: s2, epoch: e2, suggestionId: sugY, decision: 'confirm', tick: 50 }) as any;
    check('Y2 early tick rejected', early.ok === false && early.code === 'E_STALE_TICK',
      { ok: early.ok, code: early.code, messageKey: early.messageKey });

    // Y5: reject decision cannot be markApplied
    const sugR = 'sug_' + 'c'.repeat(24);
    (cg.suggest({ session: s2, epoch: e2, requestId: 'req_' + 'c'.repeat(24), suggestionId: sugR,
      kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120 }) as any);
    const rej = cg.decide({ session: s2, epoch: e2, suggestionId: sugR, decision: 'reject', tick: 101 }) as any;
    const rejApplied = cg.markApplied(s2, sugR, 101) as any;
    check('Y5 reject cannot markApplied', rej.ok === true && rejApplied.ok === false,
      { rejectOk: rej.ok, appliedOk: rejApplied.ok, code: rejApplied.code, messageKey: rejApplied.messageKey });

    // Y5b: appliedTick earlier than decidedTick rejected
    const sugE = 'sug_' + 'd'.repeat(24);
    (cg.suggest({ session: s2, epoch: e2, requestId: 'req_' + 'd'.repeat(24), suggestionId: sugE,
      kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120 }) as any);
    (cg.decide({ session: s2, epoch: e2, suggestionId: sugE, decision: 'confirm', tick: 102 }) as any);
    const earlyApplied = cg.markApplied(s2, sugE, 99) as any;
    check('Y5b appliedTick < decidedTick rejected', earlyApplied.ok === false && earlyApplied.code === 'E_STALE_TICK',
      { ok: earlyApplied.ok, code: earlyApplied.code, messageKey: earlyApplied.messageKey });

    const summary = {
      total: results.length,
      secure: results.filter(r => r.verdict === 'SECURE').length,
      vulnerable: results.filter(r => r.verdict === 'VULNERABLE').length,
      results
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await bridge.close();
  }
}
main().catch(e => { console.error('PROBE ERROR', e?.message ?? String(e)); process.exitCode = 1; });
