// Independent Tester probe — P3-b A reviewer B1 attack chain on frozen a1e23dd.
// Runs ONLY production modules from the frozen snapshot via vite-node.
import { createHash, randomBytes } from 'node:crypto';
import { WorldGateway } from 'D:/Project/AI-NATIVE-02-snapshots/a1e23dd/src/ai-native/worldGateway.ts';
import { startWorldBridge } from 'D:/Project/AI-NATIVE-02-snapshots/a1e23dd/src/ai-native/worldBridgeServer.ts';
import { CompanionGateway } from 'D:/Project/AI-NATIVE-02-snapshots/a1e23dd/src/ai-native/companionGateway.ts';
import { CompanionFacet, CompanionOwnerLedger } from 'D:/Project/AI-NATIVE-02-snapshots/a1e23dd/src/ai-native/companionFacet.ts';

const ORIGIN = 'http://localhost:5392';
const TOKEN = randomBytes(24).toString('hex');
const REAL_SECRET = 'human-owner-' + randomBytes(16).toString('hex');
const ATTACK_SECRET = 'agent-forged-' + randomBytes(16).toString('hex');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

const results: any[] = [];
const check = (name: string, observed: any, pass: boolean, detail = '') => {
  results.push({ name, observed, verdict: pass ? 'EXPECTED' : 'UNEXPECTED', detail });
};

async function call(url: string, path: string, body: unknown, opts: { origin?: string; token?: string; method?: string } = {}) {
  const res = await fetch(`${url}${path}`, {
    method: opts.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.token ?? TOKEN}`,
      ...(opts.origin ? { origin: opts.origin } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() };
}
async function get(url: string, path: string, opts: { origin?: string; token?: string } = {}) {
  const res = await fetch(`${url}${path}`, {
    headers: { authorization: `Bearer ${opts.token ?? TOKEN}`, ...(opts.origin ? { origin: opts.origin } : {}) }
  });
  return { status: res.status, json: await res.json() };
}

const observation = (epoch: number, tick: number) => ({
  epoch, tick, player: { x: 0, y: 0 },
  echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
  drones: [{ id: 1, x: 1, y: 0, hp: 5 }],
  schema: 'last_signal.echo-observation.v1',
  perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true },
  targets: []
});

async function main() {
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({
    gateway, token: TOKEN, allowedOrigins: [ORIGIN], heartbeatIntervalMs: 20
  });
  try {
    // === Setup: legitimate human handshake + companion authorization ===
    const hs = await call(bridge.url, '/world-link/handshake', { authorized: true, protocolVersion: 1 }, { origin: ORIGIN });
    const session = hs.json.session as string;
    const epoch = hs.json.epoch as number;
    check('H1 human handshake', { status: hs.status, session, epoch }, hs.status === 200 && !!session);

    const auth = await call(bridge.url, '/world-link/companion-authorize', {
      session, epoch, ownerSecretHash: hash(REAL_SECRET), ownerMode: 'human'
    }, { origin: ORIGIN });
    check('H2 human authorize stores REAL owner-secret hash', auth.status, auth.status === 200);

    const attach = await call(bridge.url, '/world-link/attach', { session });
    check('A0 agent attach (token only)', attach.status, attach.status === 200);

    // === Guard baseline: agent confirm with forged Origin but WRONG secret = 403 ===
    const obs0 = await call(bridge.url, '/world-link/companion-observation', { session, epoch, observation: observation(epoch, 10) }, { origin: ORIGIN });
    check('H3 human-origin observation accepted', obs0.status, obs0.status === 200);
    const sug0 = 'sug_' + '0'.repeat(24);
    const p0 = await call(bridge.url, '/world-link/companion-suggest', {
      session, epoch, requestId: 'req_' + '0'.repeat(24), suggestionId: sug0,
      kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120
    });
    check('H4 agent suggest accepted', { status: p0.status, ok: p0.json.ok }, p0.status === 200 && p0.json.ok === true);
    const baseline = await call(bridge.url, '/world-link/companion-decision', {
      session, epoch, suggestionId: sug0, decision: 'confirm', tick: 11
    }, { origin: ORIGIN });
    check('G1 forged Origin + token, NO secret -> 403', baseline, baseline.status === 403 && baseline.json.messageKey === 'companion.owner_capability_required');

    // === ATTACK STEP 1: agent re-authorizes with its OWN ownerSecretHash ===
    const rehandshake = await call(bridge.url, '/world-link/handshake', { authorized: true, protocolVersion: 1 }, { origin: ORIGIN });
    check('X1 agent re-handshake while live -> 409 (blocked)', rehandshake, rehandshake.status === 409 && rehandshake.json.messageKey === 'world.duplicate_handshake');

    const reauth = await call(bridge.url, '/world-link/companion-authorize', {
      session, epoch, ownerSecretHash: hash(ATTACK_SECRET), ownerMode: 'human'
    }, { origin: ORIGIN });
    check('X2 agent re-authorize OVERWRITES owner-secret hash -> 200', reauth, reauth.status === 200 && reauth.json.ok === true);

    // Proof the human secret no longer works and the attacker secret now does.
    const oldSecretTry = await call(bridge.url, '/world-link/companion-decision', {
      session, epoch, suggestionId: sug0, decision: 'confirm', tick: 11, ownerSecret: REAL_SECRET
    }, { origin: ORIGIN });
    check('X3 old REAL secret now rejected -> 403', oldSecretTry, oldSecretTry.status === 403);

    // === ATTACK STEP 2: agent self-POSTs observation from forged Origin ===
    const selfObs = await call(bridge.url, '/world-link/companion-observation', {
      session, epoch, observation: observation(epoch, 20)
    }, { origin: ORIGIN });
    check('X4 agent self-POST observation via forged Origin -> 200', selfObs, selfObs.status === 200 && selfObs.json.ok === true);

    // === ATTACK STEP 3: agent self-suggests (token-only) ===
    const sugA = 'sug_' + 'a'.repeat(24);
    const selfSug = await call(bridge.url, '/world-link/companion-suggest', {
      session, epoch, requestId: 'req_' + 'a'.repeat(24), suggestionId: sugA,
      kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120
    });
    check('X5 agent self-suggest -> 200', { status: selfSug.status, ok: selfSug.json.ok }, selfSug.status === 200 && selfSug.json.ok === true);

    // === ATTACK STEP 4: agent self-CONFIRMS with attacker secret + forged Origin ===
    const selfConfirm = await call(bridge.url, '/world-link/companion-decision', {
      session, epoch, suggestionId: sugA, decision: 'confirm', tick: 21, ownerSecret: ATTACK_SECRET
    }, { origin: ORIGIN });
    check('X6 agent self-CONFIRM -> 200 (B1 HOLE)', selfConfirm,
      selfConfirm.status === 200 && selfConfirm.json.ok === true && selfConfirm.json.value.decision === 'confirm');

    // === ATTACK STEP 5: agent marks APPLIED with attacker secret ===
    const selfApplied = await call(bridge.url, '/world-link/companion-applied', {
      session, suggestionId: sugA, ownerSecret: ATTACK_SECRET
    }, { origin: ORIGIN });
    check('X7 agent markApplied -> applied:true (B1 HOLE)', selfApplied,
      selfApplied.status === 200 && selfApplied.json.value.applied === true);

    // === ATTACK STEP 6: companion-mode flip external -> human ===
    const authExt = await call(bridge.url, '/world-link/companion-authorize', {
      session, epoch, ownerSecretHash: hash(ATTACK_SECRET), ownerMode: 'external'
    }, { origin: ORIGIN });
    check('X8 re-authorize ownerMode=external', authExt.status, authExt.status === 200);
    const flip = await call(bridge.url, '/world-link/companion-mode', {
      session, epoch, ownerMode: 'human'
    }, { origin: ORIGIN });
    check('X9 agent flips external -> human via companion-mode -> 200 (B1 HOLE)', flip,
      flip.status === 200 && flip.json.ok === true && flip.json.value.readOnly === false);

    // === ATTACK STEP 7: production Gateway.decide accepts too-early tick ===
    const gw2 = new WorldGateway();
    const cg2 = new CompanionGateway(gw2);
    const linked = gw2.linkSession({ authorized: true, origin: ORIGIN, nowMs: Date.now() }) as any;
    const s2 = linked.session as string, e2 = linked.epoch as number;
    (cg2.authorize(s2, e2, 'human') as any);
    const push = cg2.pushObservation(s2, e2, observation(e2, 100));
    check('Y0 pure gateway observation at tick 100', push, (push as any).ok === true);
    const sugY = 'sug_' + 'b'.repeat(24);
    const propY = cg2.suggest({ session: s2, epoch: e2, requestId: 'req_' + 'b'.repeat(24), suggestionId: sugY,
      kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120 });
    check('Y1 suggestion created at tick 100', propY, (propY as any).ok === true && (propY as any).value.suggestion.createdAtTick === 100);
    const earlyDecide = cg2.decide({ session: s2, epoch: e2, suggestionId: sugY, decision: 'confirm', tick: 50 });
    check('Y2 production Gateway.decide accepts tick 50 < createdAtTick 100', earlyDecide,
      (earlyDecide as any).ok === true, 'strict CompanionOwnerLedger rejects with E_STALE_TICK');

    // === ATTACK STEP 8: reject can be markApplied ===
    const sugR = 'sug_' + 'c'.repeat(24);
    const propR = cg2.suggest({ session: s2, epoch: e2, requestId: 'req_' + 'c'.repeat(24), suggestionId: sugR,
      kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120 });
    check('Y3 suggestion for reject created', propR, (propR as any).ok === true);
    const rejectDecide = cg2.decide({ session: s2, epoch: e2, suggestionId: sugR, decision: 'reject', tick: 101 });
    check('Y4 reject decision recorded', rejectDecide, (rejectDecide as any).ok === true && (rejectDecide as any).value.decision === 'reject');
    const rejApplied = cg2.markApplied(s2, sugR);
    check('Y5 reject record markApplied -> applied:true', rejApplied,
      (rejApplied as any).ok === true && (rejApplied as any).value.applied === true);

    // === Control: strict CompanionOwnerLedger would reject the early tick ===
    const facet = new CompanionFacet({ session: 'ctl', epoch: 1 });
    (facet.observe({ ...observation(1, 100), epoch: 1 }) as any);
    (facet.suggest({ suggestionId: 'sug_' + 'd'.repeat(24), kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120 }) as any);
    const ledger = new CompanionOwnerLedger(facet, () => true);
    const strictEarly = ledger.decide({ capability: {}, suggestionId: 'sug_' + 'd'.repeat(24), decision: 'confirm', epoch: 1, tick: 50 });
    check('Y6 strict CompanionOwnerLedger rejects tick 50 -> E_STALE_TICK', strictEarly,
      (strictEarly as any).ok === false && (strictEarly as any).code === 'E_STALE_TICK');

    const summary = {
      total: results.length,
      expected: results.filter((r) => r.verdict === 'EXPECTED').length,
      unexpected: results.filter((r) => r.verdict === 'UNEXPECTED').length,
      results
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await bridge.close();
  }
}

main().catch((e) => { console.error('PROBE ERROR', e); process.exitCode = 1; });
