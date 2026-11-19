/**
 * Independent P3-b production decide/markApplied strict-validation probe.
 *
 * Uses the REAL CompanionGateway + WorldGateway + CompanionFacet (the same
 * production code path the bridge calls). Verifies:
 *   invalid decision enum → E_SCHEMA
 *   tick < createdAtTick → E_STALE_TICK
 *   old epoch → E_STALE_EPOCH
 *   TTL (tick >= expiresAtTick) → E_ACTION_EXPIRED   [must run BEFORE confirm]
 *   already decided → E_RETRYABLE
 *   markApplied on reject → E_PERMISSION decision_not_confirmed
 *   confirm once → applied=false
 *   markApplied appliedTick < decidedAtTick → E_STALE_TICK (before applying)
 *   markApplied with appliedTick >= decidedAtTick → applied=true
 *   decision already applied → E_RETRYABLE
 *
 * In-process only; no network, no secrets in logs.
 */
import { WorldGateway } from './src/ai-native/worldGateway';
import { CompanionGateway } from './src/ai-native/companionGateway';

let failures = 0;
const check = (n, c, d) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n, d) => console.log('INFO', n, JSON.stringify(d));

const wg = new WorldGateway();
const linked = wg.linkSession({ authorized: true, origin: 'http://localhost:5416', nowMs: Date.now() });
if (!linked.ok) throw new Error('linkSession failed: ' + JSON.stringify(linked));
const { session, epoch } = linked;
const cg = new CompanionGateway(wg);
cg.authorize(session, epoch, 'human');
cg.pushObservation(session, epoch, {
  epoch, tick: 10, player: { x: 0, y: 0 },
  echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
  drones: [{ id: 1, x: 1, y: 0, hp: 5 }],
  targets: [{ id: 2, kind: 'hunter', x: 2, y: 1, hp: 60, isBoss: false }],
  schema: 'last_signal.echo-observation.v1',
  perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true }
});

const sug = cg.suggest({
  session, epoch, requestId: 'req_' + 'a'.repeat(24), suggestionId: 'sug_' + 'a'.repeat(24),
  kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600
});
if (!sug.ok) throw new Error('suggest failed: ' + JSON.stringify(sug));
const suggestionId = sug.value.suggestion.suggestionId;
const createdAtTick = sug.value.suggestion.createdAtTick;
const expiresAtTick = sug.value.suggestion.expiresAtTick;
info('suggestion created', { suggestionId, createdAtTick, expiresAtTick });

// 1. invalid decision enum -> E_SCHEMA
const badEnum = cg.decide({ session, epoch, suggestionId, decision: 'anything', tick: 11 });
check('decide invalid enum -> E_SCHEMA decision_invalid', !badEnum.ok && badEnum.code === 'E_SCHEMA', { code: badEnum.code, key: badEnum.messageKey });

// 2. tick < createdAtTick -> E_STALE_TICK
const earlyTick = cg.decide({ session, epoch, suggestionId, decision: 'confirm', tick: createdAtTick - 1 });
check('decide tick before createdAtTick -> E_STALE_TICK tick_before_creation', !earlyTick.ok && earlyTick.code === 'E_STALE_TICK', { code: earlyTick.code, key: earlyTick.messageKey });

// 3. old epoch -> E_STALE_EPOCH
const oldEpoch = cg.decide({ session, epoch: epoch + 99, suggestionId, decision: 'confirm', tick: 11 });
check('decide old epoch -> E_STALE_EPOCH stale_epoch', !oldEpoch.ok && oldEpoch.code === 'E_STALE_EPOCH', { code: oldEpoch.code, key: oldEpoch.messageKey });

// 4. TTL: tick >= expiresAtTick -> E_ACTION_EXPIRED  (MUST run before confirm decides the suggestion)
const expired = cg.decide({ session, epoch, suggestionId, decision: 'confirm', tick: expiresAtTick });
check('decide at/after expiresAtTick -> E_ACTION_EXPIRED suggestion_expired', !expired.ok && expired.code === 'E_ACTION_EXPIRED', { code: expired.code, key: expired.messageKey });

// 5. confirm once -> applied=false
const confirm1 = cg.decide({ session, epoch, suggestionId, decision: 'confirm', tick: 11 });
check('decide confirm once -> ok applied=false', confirm1.ok && confirm1.value.applied === false && confirm1.value.decision === 'confirm', { value: confirm1.value });

// 6. already decided -> E_RETRYABLE (no double execution)
const confirm2 = cg.decide({ session, epoch, suggestionId, decision: 'confirm', tick: 12 });
check('decide confirm again -> E_RETRYABLE decision_exists', !confirm2.ok && confirm2.code === 'E_RETRYABLE', { code: confirm2.code, key: confirm2.messageKey });

// 7. markApplied appliedTick < decidedAtTick (fresh confirm, not yet applied) -> E_STALE_TICK
const markAppliedEarly = cg.markApplied(session, suggestionId, 10);
check('markApplied appliedTick < decidedAtTick -> E_STALE_TICK applied_tick_invalid', !markAppliedEarly.ok && markAppliedEarly.code === 'E_STALE_TICK', { code: markAppliedEarly.code, key: markAppliedEarly.messageKey });

// 8. confirm -> markApplied with appliedTick >= decidedAtTick -> applied=true
const markAppliedOk = cg.markApplied(session, suggestionId, 11);
check('markApplied on confirm with appliedTick>=decidedAtTick -> applied=true', markAppliedOk.ok && markAppliedOk.value.applied === true, { value: markAppliedOk.value });

// 9. decision already applied -> E_RETRYABLE
const markAppliedAgain = cg.markApplied(session, suggestionId, 12);
check('markApplied already applied -> E_RETRYABLE decision_already_applied', !markAppliedAgain.ok && markAppliedAgain.code === 'E_RETRYABLE', { code: markAppliedAgain.code, key: markAppliedAgain.messageKey });

// 10. markApplied on reject -> E_PERMISSION decision_not_confirmed
const sugReject = cg.suggest({
  session, epoch, requestId: 'req_' + 'b'.repeat(24), suggestionId: 'sug_' + 'b'.repeat(24),
  kind: 'move', reason: 'perceived_hostile', target: { x: 1, y: 0 }, ttlTicks: 600
});
const reject1 = cg.decide({ session, epoch, suggestionId: sugReject.value.suggestion.suggestionId, decision: 'reject', tick: 11 });
check('decide reject once -> ok applied=false', reject1.ok && reject1.value.applied === false && reject1.value.decision === 'reject', { value: reject1.value });
const markAppliedReject = cg.markApplied(session, sugReject.value.suggestion.suggestionId, 11);
check('markApplied on rejected decision -> E_PERMISSION decision_not_confirmed', !markAppliedReject.ok && markAppliedReject.code === 'E_PERMISSION', { code: markAppliedReject.code, key: markAppliedReject.messageKey });

console.log('DECIDE_STRICT_' + (failures === 0 ? 'PASS' : 'FAIL') + ' failures=' + failures);
if (failures > 0) process.exit(1);
