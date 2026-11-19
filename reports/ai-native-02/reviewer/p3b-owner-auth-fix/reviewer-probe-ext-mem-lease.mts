/**
 * Independent P3-b probe: External protagonist readonly synchronization,
 * memory boundedness, and lease hardkill degradation/cleanup.
 *
 * Uses the REAL CompanionGateway + WorldGateway + AgentLeaseRegistry.
 * In-process only; no network, no secrets in logs.
 */
import { WorldGateway } from './src/ai-native/worldGateway';
import { CompanionGateway } from './src/ai-native/companionGateway';
import { COMPANION_LIMITS } from './src/ai-native/companionFacet';
import { AgentLeaseRegistry } from './src/ai-native/agentLease';

let failures = 0;
const check = (n, c, d) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n, d) => console.log('INFO', n, JSON.stringify(d));

const OBS = (epoch, tick) => ({ epoch, tick, player: { x: 0, y: 0 },
  echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
  drones: [{ id: 1, x: 1, y: 0, hp: 5 }],
  schema: 'last_signal.echo-observation.v1',
  perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true } });

async function main() {
  // ============ External protagonist readonly synchronization ============
  const wg = new WorldGateway();
  const linked = wg.linkSession({ authorized: true, origin: 'http://localhost:5416', nowMs: Date.now() });
  if (!linked.ok) throw new Error('linkSession failed');
  const { session, epoch } = linked;
  const cg = new CompanionGateway(wg);
  cg.authorize(session, epoch, 'human');
  cg.pushObservation(session, epoch, OBS(epoch, 10));

  // External mode -> readOnly, blocks suggest + confirm at gateway
  const setExt = cg.setOwnerMode(session, epoch, 'external');
  check('gateway setOwnerMode(external) -> readOnly=true', setExt.ok && setExt.value.readOnly === true, { value: setExt.value });
  const extSuggest = cg.suggest({ session, epoch, requestId: 'req_' + 'b'.repeat(24), suggestionId: 'sug_' + 'b'.repeat(24),
    kind: 'move', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600 });
  check('external mode blocks new suggestions at gateway', !extSuggest.ok, { code: extSuggest.ok ? undefined : extSuggest.code });

  // Back to human -> create fresh suggestion (external mode cancelled unconfirmed work), then confirm
  const setHuman = cg.setOwnerMode(session, epoch, 'human');
  check('gateway setOwnerMode(human) -> readOnly=false', setHuman.ok && setHuman.value.readOnly === false);
  const sug = cg.suggest({ session, epoch, requestId: 'req_' + 'c'.repeat(24), suggestionId: 'sug_' + 'c'.repeat(24),
    kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600 });
  check('human mode allows new suggestion', sug.ok === true, { code: sug.ok ? undefined : sug.code });
  const humanConfirm = cg.decide({ session, epoch, suggestionId: sug.value.suggestion.suggestionId, decision: 'confirm', tick: 11 });
  check('human mode allows confirm', humanConfirm.ok === true, { code: humanConfirm.ok ? undefined : humanConfirm.code });

  // ============ Memory boundedness ============
  const wg2 = new WorldGateway();
  const linked2 = wg2.linkSession({ authorized: true, origin: 'http://localhost:5416', nowMs: Date.now() });
  const { session: s2, epoch: e2 } = linked2;
  const cg2 = new CompanionGateway(wg2);
  cg2.authorize(s2, e2, 'human');
  cg2.pushObservation(s2, e2, OBS(e2, 10));
  // Create 40 suggestions (over 8-pending bound) to verify bounds
  for (let i = 0; i < 40; i++) {
    cg2.suggest({ session: s2, epoch: e2, requestId: 'req_' + i.toString(16).padStart(24, '0'),
      suggestionId: 'sug_' + i.toString(16).padStart(24, '0'), kind: 'move', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600 });
  }
  const pending = cg2.pending(s2, e2);
  info('pending after 40 suggestions', { count: pending.value.length, limit: COMPANION_LIMITS.MAX_UNCONFIRMED });
  check('pending suggestions bounded by MAX_UNCONFIRMED (8)', pending.value.length <= COMPANION_LIMITS.MAX_UNCONFIRMED, { count: pending.value.length });

  // Memory entries bounded by 16 (via facet memory)
  const facetMem = cg2['sessions'].get(s2).facet.memory.length;
  info('facet memory entries', { count: facetMem, limit: COMPANION_LIMITS.MEMORY_ENTRIES });
  check('facet memory bounded by MEMORY_ENTRIES (16)', facetMem <= COMPANION_LIMITS.MEMORY_ENTRIES, { count: facetMem });

  // Dedup records bounded by 512 (requestRecords)
  const recs = cg2['sessions'].get(s2).requestRecords;
  info('dedup records after 40', { count: recs, limit: COMPANION_LIMITS.MAX_DEDUP_RECORDS });
  check('dedup records bounded by MAX_DEDUP_RECORDS (512)', recs <= COMPANION_LIMITS.MAX_DEDUP_RECORDS, { count: recs });

  // ============ Lease hardkill degradation/cleanup ============
  const leases = new AgentLeaseRegistry(4000);
  const now = Date.now();
  const issued = leases.issue(session, epoch, now);
  check('lease issued', issued.ok === true, { code: issued.ok ? undefined : issued.code });
  const lease = issued.lease;
  info('lease issued', { leaseMs: lease.expiresAtMs - lease.createdAtMs, expiresInMs: lease.expiresAtMs - now });

  // Not yet expired
  const st1 = leases.status(session, lease.leaseId, now);
  check('lease live before expiry', st1.ok === true && st1.status === 'live', { status: st1.ok ? st1.status : st1.code });

  // Advance past expiry without renew -> hard expire
  const st2 = leases.status(session, lease.leaseId, now + 5000);
  check('lease hard-expires after deadline without renew', st2.ok === false || st2.status === 'expired', { status: st2.ok ? st2.status : st2.code, expiresAtMs: lease.expiresAtMs, probedAt: now + 5000 });

  // Mirror the bridge reaper: lease expiry triggers companions.onLeaseExpired
  leases.reap(now + 5000);
  cg.onLeaseExpired(session);
  const cg3stats = cg['sessions'].get(session);
  info('companion after reap+onLeaseExpired', { pending: cg3stats.facet.pendingSuggestions().length, decisions: cg3stats.decisions.size, observation: !!cg3stats.observation });
  check('lease expiry cancels pending companion suggestions', cg3stats.facet.pendingSuggestions().length === 0);
  check('lease expiry clears companion observation', cg3stats.observation === null);
  check('lease expiry clears companion decisions', cg3stats.decisions.size === 0);

  // Old leaseId cannot renew after expiry
  const renewOld = leases.renew(lease.leaseId, session, epoch, now + 5000);
  check('old leaseId cannot renew after expiry', renewOld.ok === false, { code: renewOk(renewOld), key: renewOk(renewOld) });

  console.log('EXT_READONLY_MEM_LEASE_' + (failures === 0 ? 'PASS' : 'FAIL') + ' failures=' + failures);
  if (failures > 0) process.exit(1);
}

function renewOk(r) { return r.ok ? undefined : r.code; }

main().catch((e) => { console.log('FAIL exception', String(e)); process.exit(1); });
