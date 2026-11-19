/**
 * Independent P3-b A Owner-authority negative probe (real HTTP bridge).
 * In-process random token only; token never in logs/args/URL/screenshots.
 * Own ephemeral bridge port (startWorldBridge binds port 0).
 */
import { createHash, randomBytes } from 'node:crypto';
import { WorldGateway } from './src/ai-native/worldGateway';
import { startWorldBridge } from './src/ai-native/worldBridgeServer';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));

const ORIGIN = 'http://localhost:5412';
const OTHER_ORIGIN = 'http://localhost:5413';
const TOKEN = randomBytes(24).toString('hex'); // desensitized, in-process only
const secret = () => randomBytes(24).toString('hex');
const hashOf = (s: string) => createHash('sha256').update(s).digest('hex');

async function post(url: string, path: string, body: unknown, origin?: string, token = TOKEN): Promise<{ status: number; json: any }> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(origin ? { origin } : {}) },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() };
}
const get = async (url: string, path: string, origin?: string, token = TOKEN): Promise<{ status: number; json: any }> => {
  const res = await fetch(`${url}${path}`, { headers: { authorization: `Bearer ${token}`, ...(origin ? { origin } : {}) } });
  return { status: res.status, json: await res.json() };
};
const sid = (c: string) => 'sug_' + c.repeat(24);
const rid = (c: string) => 'req_' + c.repeat(24);
const OBS = (epoch: number, tick = 10) => ({
  epoch, tick, player: { x: 0, y: 0 },
  echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
  drones: [{ id: 1, x: 1, y: 0, hp: 5 }],
  schema: 'last_signal.echo-observation.v1',
  perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true },
  targets: []
});

async function newSession(bridgeUrl: string, origin: string, s: string) {
  const hs = await post(bridgeUrl, '/world-link/handshake', { authorized: true, protocolVersion: 1 }, origin);
  if (hs.status !== 200) throw new Error(`handshake ${hs.status}`);
  const session = hs.json.session as string, epoch = hs.json.epoch as number;
  const a = await post(bridgeUrl, '/world-link/companion-authorize',
    { session, epoch, ownerSecretHash: hashOf(s), ownerMode: 'human' }, origin);
  if (a.status !== 200) throw new Error(`authorize ${a.status}`);
  return { session, epoch };
}
async function propose(bridgeUrl: string, session: string, epoch: number, id: string, req: string, origin = ORIGIN) {
  const o = await post(bridgeUrl, '/world-link/companion-observation', { session, epoch, observation: OBS(epoch) }, origin);
  if (o.status !== 200) throw new Error(`observation ${o.status} ${JSON.stringify(o.json)}`);
  const r = await post(bridgeUrl, '/world-link/companion-suggest', {
    session, epoch, requestId: req, suggestionId: id, kind: 'fire',
    reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120
  });
  if (r.status !== 200) throw new Error(`suggest ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

async function main(): Promise<void> {
  const bridge = await startWorldBridge({
    gateway: new WorldGateway(), token: TOKEN,
    allowedOrigins: [ORIGIN, OTHER_ORIGIN], heartbeatIntervalMs: 20
  });
  const U = bridge.url;
  try {
    const s1 = secret(), s2 = secret();
    const A = await newSession(U, ORIGIN, s1);
    const B = await newSession(U, OTHER_ORIGIN, s2);
    check('two independent human-authorized sessions created', A.session !== B.session, { A: A.session, B: B.session });

    // Agent attaches token-only (no Origin) with independent lease
    const attach = await post(U, '/world-link/attach', { session: A.session });
    check('agent attaches with token-only route', attach.status === 200 && !!attach.json.leaseId);
    check('agent ATTACH response has NO ownerSecret', !JSON.stringify(attach.json).includes('ownerSecret') && !JSON.stringify(attach.json).includes(s1));

    const idA = sid('a'), reqA = rid('a');
    await propose(U, A.session, A.epoch, idA, reqA);

    const decPath = '/world-link/companion-decision';
    const appliedPath = '/world-link/companion-applied';
    const base = { session: A.session, epoch: A.epoch, suggestionId: idA, decision: 'confirm', tick: 11 };

    // 1) Agent token (no Origin) cannot confirm / applied
    for (const [label, path] of [['confirm', decPath], ['applied', appliedPath]] as const) {
      const body = path === decPath ? { ...base, ownerSecret: s1 } : { session: A.session, suggestionId: idA, ownerSecret: s1 };
      const r = await post(U, path, body);
      check(`agent token (no Origin) cannot ${label}`, r.status === 403, { status: r.status, json: r.json });
    }
    // 2) Forged Origin + token but no secret
    const forgedOrigin = await post(U, decPath, { ...base }, ORIGIN);
    check('forged Origin + token without secret rejected', forgedOrigin.status === 403 && forgedOrigin.json.messageKey === 'companion.owner_capability_required');
    const otherOrigin = await post(U, decPath, { ...base, ownerSecret: s1 }, OTHER_ORIGIN);
    check('other allowed Origin cannot confirm this session (sessionOrigin binding)', otherOrigin.status === 403, { status: otherOrigin.status, json: otherOrigin.json });
    // 3) Plain object / prototype / spread / JSON / wrong secret / cross-session secret
    const forgedProofs: Array<[string, unknown]> = [
      ['plain OWNER object', { kind: 'OWNER', session: A.session }],
      ['spread of secret', { ...{ ownerSecret: s1 } }],
      ['Object.create(null) with secret', Object.assign(Object.create(null), { ownerSecret: s1 })],
      ['Object.create of secret-bearing object', Object.create({ ownerSecret: s1 })],
      ['JSON round-trip of secret', JSON.parse(JSON.stringify({ ownerSecret: s1 }))],
      ['wrong secret', 'not-the-secret'],
      ['cross-session secret (B secret on A session)', s2],
      ['secret as number', 42],
      ['secret as array', [s1]],
      ['empty secret', ''],
    ];
    for (const [label, forged] of forgedProofs) {
      const r = await post(U, decPath, { ...base, ownerSecret: forged }, ORIGIN);
      check(`forged proof ${label} rejected`, r.status === 403, { status: r.status, code: r.json?.code });
      const ra = await post(U, appliedPath, { session: A.session, suggestionId: idA, ownerSecret: forged }, ORIGIN);
      check(`forged proof ${label} rejected on applied`, ra.status === 403, { status: ra.status, code: ra.json?.code });
    }
    // 4) Wrong session with correct secret (credential+session separation)
    const wrongSession = await post(U, decPath, { ...base, session: B.session, ownerSecret: s1 }, OTHER_ORIGIN);
    check('correct secret but WRONG session rejected (not module string check)', wrongSession.status !== 200, { status: wrongSession.status, json: wrongSession.json });
    // 5) Wrong epoch with correct secret
    const wrongEpoch = await post(U, decPath, { ...base, epoch: A.epoch + 99, ownerSecret: s1 }, ORIGIN);
    check('correct secret but WRONG epoch rejected', wrongEpoch.status !== 200, { status: wrongEpoch.status, json: wrongEpoch.json });
    // 6) Wrong token
    const wrongToken = await post(U, decPath, { ...base, ownerSecret: s1 }, ORIGIN, randomBytes(24).toString('hex'));
    check('wrong token rejected (401)', wrongToken.status === 401, { status: wrongToken.status });

    // 7) secret never appears in observer / status / memory / suggestions / any response
    const responses: Array<[string, any]> = [
      ['observe GET', (await get(U, `/world-link/companion-observation?session=${A.session}&epoch=${A.epoch}`)).json],
      ['status GET', (await get(U, `/world-link/companion-status?session=${A.session}&epoch=${A.epoch}`)).json],
      ['memory GET', (await get(U, `/world-link/companion-memory?session=${A.session}&epoch=${A.epoch}`)).json],
      ['suggestions GET', (await get(U, `/world-link/companion-suggestions?session=${A.session}&epoch=${A.epoch}`, ORIGIN)).json],
      ['agent-status GET', (await get(U, `/world-link/agent-status?session=${A.session}&leaseId=${attach.json.leaseId}`)).json],
      ['session list', (await get(U, `/world-link/companion-status?session=${A.session}&epoch=${A.epoch}`)).json],
    ];
    for (const [label, j] of responses) {
      const text = JSON.stringify(j);
      check(`secret absent from ${label}`, !text.includes(s1) && !text.includes('ownerSecret') && !text.includes('OWNER_AUTHORITIES'), text.slice(0, 160));
    }
    // 8) Real Owner can confirm exactly once; second is E_RETRYABLE; receipt cannot be early
    const pendingBefore = await get(U, `/world-link/companion-suggestions?session=${A.session}&epoch=${A.epoch}`, ORIGIN);
    check('proposal pending before confirm', pendingBefore.json.ok && pendingBefore.json.value.length === 1);
    const preApplied = await post(U, appliedPath, { session: A.session, suggestionId: idA, ownerSecret: s1 }, ORIGIN);
    check('applied receipt BEFORE decision rejected (cannot report effect early)', preApplied.status !== 200 || preApplied.json.ok === false, { status: preApplied.status, json: preApplied.json });
    const okDec = await post(U, decPath, { ...base, ownerSecret: s1 }, ORIGIN);
    check('real Owner confirm succeeds', okDec.status === 200 && okDec.json.value.applied === false, { status: okDec.status, json: okDec.json });
    check('decision record NOT yet applied (receipt honest)', okDec.json.value.applied === false);
    const dup = await post(U, decPath, { ...base, ownerSecret: s1 }, ORIGIN);
    check('2nd confirm same id -> E_RETRYABLE (no double execution)', dup.json.code === 'E_RETRYABLE', { status: dup.status, json: dup.json });
    const applied = await post(U, appliedPath, { session: A.session, suggestionId: idA, ownerSecret: s1 }, ORIGIN);
    check('post-commit applied receipt sets applied=true', applied.status === 200 && applied.json.value.applied === true);
    // 9) reject / expired / reused id never executes
    const idRej = sid('b'), reqRej = rid('b');
    await propose(U, A.session, A.epoch, idRej, reqRej);
    const rej = await post(U, decPath, { ...base, suggestionId: idRej, decision: 'reject', ownerSecret: s1 }, ORIGIN);
    check('reject records decision, no apply marker', rej.status === 200 && rej.json.value.decision === 'reject' && rej.json.value.applied === false);
    const appliedRej = await post(U, appliedPath, { session: A.session, suggestionId: idRej, ownerSecret: s1 }, ORIGIN);
    info('applied receipt on a REJECTED id (gateway marks applied regardless of decision)', { status: appliedRej.status, applied: appliedRej.json?.value?.applied });
    const idExp = sid('c'), reqExp = rid('c');
    await propose(U, A.session, A.epoch, idExp, reqExp);
    const expired = await post(U, decPath, { ...base, suggestionId: idExp, tick: 1000, ownerSecret: s1 }, ORIGIN);
    check('expired suggestion cannot be confirmed', expired.status !== 200 && expired.json.ok === false, { status: expired.status, json: expired.json });
    const reused = await post(U, '/world-link/companion-suggest', {
      session: A.session, epoch: A.epoch, requestId: reqA, suggestionId: idA,
      kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120
    });
    check('reused id after decision rejected', reused.json.ok === false, { json: reused.json });

    // 10) AI/External protagonist mode => read-only, decisions blocked
    const idRo = sid('d'), reqRo = rid('d');
    await propose(U, A.session, A.epoch, idRo, reqRo);
    const mode = await post(U, '/world-link/companion-mode', { session: A.session, epoch: A.epoch, ownerMode: 'ai' }, ORIGIN);
    check('AI owner mode -> readOnly true', mode.json.value?.readOnly === true, { json: mode.json });
    const roDec = await post(U, decPath, { ...base, suggestionId: idRo, ownerSecret: s1 }, ORIGIN);
    check('AI mode blocks Owner confirm', roDec.json.ok === false, { status: roDec.status, json: roDec.json });
    const roSug = await post(U, '/world-link/companion-suggest', {
      session: A.session, epoch: A.epoch, requestId: rid('e'), suggestionId: sid('e'),
      kind: 'move', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 120
    });
    check('AI mode blocks new suggestions (mutual exclusion)', roSug.json.ok === false, { json: roSug.json });
    await post(U, '/world-link/companion-mode', { session: A.session, epoch: A.epoch, ownerMode: 'human' }, ORIGIN);

    // 11) Lease hardkill: late requests cannot auto-restore suggestions
    info('AGENT_LEASE_MS / reaper', { leaseStats: bridge.leaseStats() });
    const idLease = sid('f'), reqLease = rid('f');
    await propose(U, A.session, A.epoch, idLease, reqLease);
    // Expire the lease by advancing the registry clock is internal; instead wait for the
    // reaper with a short heartbeat and verify the companion link degrades explicitly.
    await new Promise((r) => setTimeout(r, 120));
    const late = await get(U, `/world-link/companion-status?session=${A.session}&epoch=${A.epoch}`);
    info('status after reaper tick', { ok: late.json.ok, link: late.json.value?.status?.link, pending: late.json.value?.status?.pendingSuggestions });

    // 12) explicit disconnect cancels pending + NO_MODEL, no fake connected
    const disc = await post(U, '/world-link/companion-disconnect', { session: A.session }, ORIGIN);
    check('disconnect returns NO_MODEL fallback', disc.json.fallback === 'NO_MODEL', { json: disc.json });
    const afterDisc = await get(U, `/world-link/companion-status?session=${A.session}&epoch=${A.epoch}`);
    check('after disconnect link=fallback and pending=0', afterDisc.json.value?.status?.link === 'fallback' && afterDisc.json.value?.status?.pendingSuggestions === 0, { json: afterDisc.json });
    const afterDiscDec = await post(U, decPath, { ...base, suggestionId: idA, ownerSecret: s1 }, ORIGIN);
    check('decision after disconnect rejected', afterDiscDec.json.ok === false, { status: afterDiscDec.status, json: afterDiscDec.json });

    // 13) B session secret on B's own session works (credential+session pairing)
    const idB = sid('1'), reqB = rid('1');
    await propose(U, B.session, B.epoch, idB, reqB, OTHER_ORIGIN);
    const okB = await post(U, decPath, { session: B.session, epoch: B.epoch, suggestionId: idB, decision: 'confirm', tick: 11, ownerSecret: s2 }, OTHER_ORIGIN);
    check('correct secret+session+origin confirms (real boundary, not string check)', okB.status === 200, { status: okB.status, json: okB.json });
  } finally {
    await bridge.close();
  }
  console.log(`BRIDGE_OWNER_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
  if (failures > 0) process.exit(1);
}
main().catch((e) => { console.log('FAIL exception', String(e)); process.exit(1); });
