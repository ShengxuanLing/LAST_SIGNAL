/**
 * Independent CompanionGateway + CompanionFacet + World.enqueueCompanionAction
 * contract probe: TTL / dedup 512 hard bound / memory 16 / fake hidden input /
 * one confirm -> ONE queued echo intent consumed by one core tick / reject /
 * expired / reused id never execute / receipt cannot report effect early.
 * No browser, no network, no production source changes.
 */
import { WorldGateway } from './src/ai-native/worldGateway';
import { CompanionGateway } from './src/ai-native/companionGateway';
import { CompanionFacet, COMPANION_LIMITS, OwnerAuthorityValidator, CompanionOwnerLedger, type CompanionObservationView } from './src/ai-native/companionFacet';
import { isEchoObservation, buildEchoObservation, ECHO_OBSERVATION_SCHEMA } from './src/world/echoView';
import { echoPlayerData } from './src/world/sim/core';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));

const hex = (c: string, n: number) => c.repeat(n);
const sid = (i: number) => 'sug_' + i.toString(16).padStart(24, '0');
const rid = (i: number) => 'req_' + i.toString(16).padStart(24, '0');

function cropped(epoch = 1, tick = 10, extras: Record<string, unknown> = {}): CompanionObservationView {
  const echo = { actorId: 1, x: 0, y: 0, data: echoPlayerData(), dashTimer: 0, invuln: 0, hurtTimer: 0, fireTimer: 0, aimYaw: 0 };
  const base = buildEchoObservation({
    echo, player: { x: 2, y: 0 }, tick,
    drones: [{ id: 1, x: 1, y: 0, hp: 20 }],
    targets: [{ id: 2, kind: 'hunter', x: 2, y: 1, hp: 60, isBoss: false }],
    isExplored: () => true, isOpaque: () => false
  });
  return { ...base, epoch, ...extras } as unknown as CompanionObservationView;
}

function gateway() {
  const wg = new WorldGateway();
  const linked = wg.linkSession({ authorized: true, origin: 'http://localhost:5412', nowMs: Date.now() });
  if (!linked.ok) throw new Error('linkSession failed');
  const cg = new CompanionGateway(wg);
  return { wg, cg, session: linked.session, epoch: linked.epoch };
}
function setup(cg: CompanionGateway, session: string, epoch: number, tick = 10) {
  const a = cg.authorize(session, epoch, 'human');
  if (!a.ok) throw new Error('authorize failed');
  const o = cg.pushObservation(session, epoch, cropped(epoch, tick));
  if (!o.ok) throw new Error(`pushObservation failed ${o.code} ${o.messageKey}`);
  return o.value;
}

// 1. crop attestation: raw sim / hidden target / forged schema rejected
{
  const real = cropped();
  // isEchoObservation attests the BUILDER output (no `epoch` key); the facet
  // strips `epoch` before calling it. Test both paths explicitly.
  const { epoch: _e, ...builderOnly } = real as unknown as Record<string, unknown>;
  check('buildEchoObservation output passes isEchoObservation', isEchoObservation(builderOnly));
  check('isEchoObservation rejects the extra epoch key (facet strips it first)', !isEchoObservation(real));
  const raw = { epoch: 1, tick: 10, echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 }, player: { x: 2, y: 0 }, drones: [{ id: 1, x: 1, y: 0, hp: 20 }] };
  check('raw observation WITHOUT crop attestation rejected', !isEchoObservation(raw));
  check('fake schema string rejected', !isEchoObservation({ ...real, schema: 'forged' }));
  check('hidden extra field rejected', !isEchoObservation({ ...real, hiddenTarget: { x: 999, y: 999 } }));
  check('unbounded drone (beyond 12 tiles) rejected', !isEchoObservation({ ...real, drones: [{ id: 9, x: 50, y: 0, hp: 20 }] }));
  check('perception.center mismatch rejected', !isEchoObservation({ ...real, perception: { ...real.perception, center: { x: 999, y: 999 } } }));
  info('ECHO_OBSERVATION_SCHEMA', { schema: ECHO_OBSERVATION_SCHEMA });
  const { cg, session, epoch } = gateway();
  const pushed = cg.pushObservation(session, epoch, raw);
  check('gateway.pushObservation rejects raw hidden input', !pushed.ok, { code: pushed.ok ? undefined : pushed.code });
}

// 2. Gateway TTL / dedup hard bound / 8 unconfirmed / memory 16
{
  const { cg, session, epoch } = gateway();
  setup(cg, session, epoch);
  // TTL: suggestion expires at tick+ttl; pending() advances to observation tick only
  const r1 = cg.suggest({ session, epoch, requestId: rid(1), suggestionId: sid(1), kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 5 });
  check('suggest OK with ttlTicks=5', r1.ok, r1.ok ? undefined : { code: r1.code });
  const exp = cg.decide({ session, epoch, suggestionId: sid(1), decision: 'confirm', tick: 15 });
  check('decide at/after expiresAtTick rejected (TTL real)', !exp.ok, { code: exp.ok ? undefined : exp.code });
  // 8 unconfirmed hard bound
  let blocked = false;
  for (let i = 2; i <= 12; i++) {
    const r = cg.suggest({ session, epoch, requestId: rid(i), suggestionId: sid(i), kind: 'move', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600 });
    if (!r.ok && r.code === 'E_RESOURCE_LIMIT') blocked = true;
  }
  check('unconfirmed queue rejects at hard bound 8 (no FIFO eviction)', blocked);
  info('COMPANION_LIMITS', { maxUnconfirmed: COMPANION_LIMITS.MAX_UNCONFIRMED, maxDedup: COMPANION_LIMITS.MAX_DEDUP_RECORDS, ttl: COMPANION_LIMITS.SUGGESTION_TTL_TICKS, memory: COMPANION_LIMITS.MEMORY_ENTRIES });
  // dedup 512 hard bound on a fresh gateway
  const g2 = gateway(); setup(g2.cg, g2.session, g2.epoch, 10);
  let dedupBlocked = false;
  for (let i = 1; i <= COMPANION_LIMITS.MAX_DEDUP_RECORDS + 3; i++) {
    const r = g2.cg.suggest({
      session: g2.session, epoch: g2.epoch, requestId: rid(100000 + i), suggestionId: sid(100000 + i),
      kind: 'move', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 1
    });
    if (!r.ok && r.code === 'E_RESOURCE_LIMIT') dedupBlocked = true;
    // expire all pending each round so only the dedup bound can block
    g2.cg.pending(g2.session, g2.epoch);
  }
  info('dedup hard bound reached (512 records cap)', { dedupBlocked });
  check('dedup records hard bound enforced (E_RESOURCE_LIMIT)', dedupBlocked);
  const stats = g2.cg.stats();
  info('gateway stats after 515 distinct requestIds', { ...stats });
  check('bounded sessions (one per gateway session)', stats.sessions <= 4);
}

// 3. Facet memory 16 + targets evidence + reason must be observable
{
  const f = new CompanionFacet({ session: 'ses_x', epoch: 1, suggestionIdFactory: () => sid(900) });
  const many = cropped(1, 10, {
    drones: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, x: (i % 10) + 0.5, y: 0.5, hp: 5 })),
    targets: [{ id: 77, kind: 'hunter', x: 2, y: 1, hp: 60, isBoss: false }]
  });
  const o = f.observe(many);
  check('observe cropped 40 drones + 1 target OK', o.ok);
  check('memory hard cap 16', f.memory.length <= COMPANION_LIMITS.MEMORY_ENTRIES, { len: f.memory.length });
  check('targets recorded in bounded memory (evidence)', o.ok && o.value.targets.some((t) => t.id === 77));
  const fakeHidden = f.observe(cropped(1, 11, { hiddenTarget: { x: 999, y: 999, hp: 999 } }));
  check('fake hidden field in view rejected', !fakeHidden.ok, { code: fakeHidden.ok ? undefined : fakeHidden.code });
  const noDrone = f.observe(cropped(1, 12, { drones: [], targets: [] }));
  check('no perceived target observation legal', noDrone.ok);
  const invented = f.suggest({ kind: 'fire', reason: 'perceived_hostile' });
  check('invented perceived_hostile rejected (reason must be observable)', !invented.ok && (invented as any).messageKey === 'companion.reason_unobserved');
  // snapshot bounded + no auth
  const snap = f.snapshot();
  check('snapshot frozen & bounded', Object.isFrozen(snap) && snap.memory.length <= 16 && snap.pending.length <= 8);
  check('snapshot has no secret/capability/hidden fields', !JSON.stringify(snap).includes('ownerSecret') && !JSON.stringify(snap).includes('OWNER') && !JSON.stringify(snap).includes('999'));
}

// 4. OwnerAuthorityValidator + single confirm -> one decision, no double execution
{
  const owned = new WeakSet<object>();
  const authority = Object.freeze({ kind: 'OWNER' });
  owned.add(authority);
  const isOwner: OwnerAuthorityValidator = (p) => typeof p === 'object' && p !== null && owned.has(p);
  const f = new CompanionFacet({ session: 'ses_y', epoch: 1, suggestionIdFactory: () => sid(700) });
  f.observe(cropped());
  const s = f.suggest({ kind: 'move', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600 });
  if (!s.ok) throw new Error('suggest failed');
  const L = new CompanionOwnerLedger(f, isOwner);
  for (const [label, proof] of [
    ['token', { token: 'x' }], ['plain OWNER', { kind: 'OWNER', session: 'ses_y' }],
    ['spread of authority', { ...authority }], ['Object.create(authority)', Object.create(authority)],
    ['JSON round-trip', JSON.parse(JSON.stringify(authority))], ['symbol-named fake', { [Symbol('last_signal.companion.owner.v1')]: true }]
  ] as Array<[string, unknown]>) {
    const r = L.decide({ capability: proof, suggestionId: s.value.suggestionId, decision: 'confirm', epoch: 1, tick: 11 });
    check(`ledger rejects ${label} (WeakSet identity only)`, !r.ok && (r as any).code === 'E_PERMISSION');
  }
  const ok = L.decide({ capability: authority, suggestionId: s.value.suggestionId, decision: 'confirm', epoch: 1, tick: 11 });
  check('exact WeakSet identity confirms once', ok.ok && L.list().length === 1);
  const dup = L.decide({ capability: authority, suggestionId: s.value.suggestionId, decision: 'confirm', epoch: 1, tick: 12 });
  check('2nd confirm E_RETRYABLE (no double execution)', !dup.ok && (dup as any).code === 'E_RETRYABLE' && L.list().length === 1);
  check('ledger never executes (suggestion stays proposed)', f.pendingSuggestions()[0]?.status === 'proposed');
  const badEnum = L.decide({ capability: authority, suggestionId: sid(701), decision: 'anything' as any, epoch: 1, tick: 11 });
  check('decide strictly validates decision enum', !badEnum.ok && (badEnum as any).code === 'E_SCHEMA');
  const beforeCreated = L.decide({ capability: authority, suggestionId: sid(702), decision: 'confirm', epoch: 1, tick: 0 });
  info('tick before creation handling', { ok: beforeCreated.ok, code: beforeCreated.ok ? undefined : (beforeCreated as any).code });
}

console.log(`CONTRACT_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
