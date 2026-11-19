// REVIEWER PROBE (not part of the frozen commit) — stale-receipt evidence rules
// for 4b938a5: markApplied must refuse a room-cancelled record unless the
// ORIGINAL generation AND room are reported; a real late receipt still records.
import { describe, expect, it } from 'vitest';
import { WorldGateway } from '../ai-native/worldGateway';
import { CompanionGateway } from '../ai-native/companionGateway';

const ORIGIN = 'http://localhost:5311';
const A = 3, B = 5;
const sugId = (n: number) => 'sug_' + n.toString(16).padStart(24, '0');
const reqId = (n: number) => 'req_' + n.toString(16).padStart(24, '0');

function setup() {
  const gateway = new WorldGateway();
  const linked = gateway.linkSession({ authorized: true, origin: ORIGIN, nowMs: 1000 });
  if (!linked.ok) throw new Error('link failed');
  const companion = new CompanionGateway(gateway);
  companion.authorize(linked.session, linked.epoch, 'human');
  return { companion, session: linked.session, epoch: linked.epoch };
}
function observation(tick: number) {
  return {
    epoch: 1, tick, player: { x: 0, y: 0 },
    echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
    drones: [], targets: [],
    schema: 'last_signal.echo-observation.v1',
    perception: { center: { x: 0, y: 0 }, radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true }
  };
}
async function staleDecision(companion: any, session: string, epoch: number, n: number) {
  expect(companion.pushObservation(session, epoch, observation(n)).ok).toBe(true);
  expect(companion.suggest({
    session, epoch, requestId: reqId(n), suggestionId: sugId(n),
    kind: 'scan', reason: 'no_perceived_target', ttlTicks: 600
  }).ok).toBe(true);
  expect(companion.decide({ session, epoch, suggestionId: sugId(n), decision: 'confirm', tick: n + 1 }).ok).toBe(true);
  await companion.roomChanged(session, epoch, B, n + 2, 2);   // -> record becomes stale
}

describe('4b938a5 stale receipt evidence', () => {
  it('S1 stale + omitted execution is refused (no flip back to applied)', async () => {
    const { companion, session, epoch } = setup();
    await companion.roomChanged(session, epoch, A, 9, 1);
    await staleDecision(companion, session, epoch, 11);
    const r = companion.markApplied(session, sugId(11), 14);
    console.log('S1 ' + JSON.stringify(r));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_STALE_GENERATION');
    const st = companion.status(session, epoch);
    expect(st.ok && st.value.receipts.find((x) => x.suggestionId === sugId(11))).toMatchObject({
      status: 'cancelled', reason: 'room_changed'
    });
  });

  it('S2 stale + wrong generation is refused', async () => {
    const { companion, session, epoch } = setup();
    await companion.roomChanged(session, epoch, A, 9, 1);
    await staleDecision(companion, session, epoch, 21);
    const r = companion.markApplied(session, sugId(21), 24, { generation: 2, roomId: A });
    console.log('S2 ' + JSON.stringify(r));
    expect(r.ok).toBe(false);
  });

  it('S3 stale + wrong roomId is refused (even with the right generation)', async () => {
    const { companion, session, epoch } = setup();
    await companion.roomChanged(session, epoch, A, 9, 1);
    await staleDecision(companion, session, epoch, 31);
    // generation of the decision is 1 (room A); report generation 1 but room B
    const r = companion.markApplied(session, sugId(31), 34, { generation: 1, roomId: B });
    console.log('S3 ' + JSON.stringify(r));
    expect(r.ok).toBe(false);
  });

  it('S4 stale + ORIGINAL generation and room still records the real execution', async () => {
    const { companion, session, epoch } = setup();
    await companion.roomChanged(session, epoch, A, 9, 1);
    await staleDecision(companion, session, epoch, 41);
    const r = companion.markApplied(session, sugId(41), 44, { generation: 1, roomId: A });
    console.log('S4 ' + JSON.stringify(r));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const st = companion.status(session, epoch);
    expect(st.ok && st.value.receipts.find((x) => x.suggestionId === sugId(41))).toMatchObject({
      status: 'applied', appliedTick: 44
    });
  });

  it('S5 non-stale record keeps the loose contract (omitted evidence still accepted)', async () => {
    const { companion, session, epoch } = setup();
    await companion.roomChanged(session, epoch, A, 9, 1);
    expect(companion.pushObservation(session, epoch, observation(51)).ok).toBe(true);
    expect(companion.suggest({
      session, epoch, requestId: reqId(51), suggestionId: sugId(51),
      kind: 'scan', reason: 'no_perceived_target', ttlTicks: 600
    }).ok).toBe(true);
    expect(companion.decide({ session, epoch, suggestionId: sugId(51), decision: 'confirm', tick: 52 }).ok).toBe(true);
    const r = companion.markApplied(session, sugId(51), 53);
    console.log('S5 ' + JSON.stringify(r));
    expect(r.ok).toBe(true);
  });
});
