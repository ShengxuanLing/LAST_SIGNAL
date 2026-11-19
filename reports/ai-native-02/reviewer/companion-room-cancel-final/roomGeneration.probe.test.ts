// REVIEWER PROBE (not part of the frozen commit) — deterministic "delayed
// arrival" probes for the 7c0068f room-generation chain. No browsers, no timers:
// every interleaving is produced by call ORDER, so it is reproducible.
import { describe, expect, it } from 'vitest';
import { WorldGateway } from '../ai-native/worldGateway';
import { CompanionGateway } from '../ai-native/companionGateway';
import { CompanionFacet } from '../ai-native/companionFacet';

const ORIGIN = 'http://localhost:5311';
const ROOM_A = 3;
const ROOM_B = 5;

function setup() {
  const gateway = new WorldGateway();
  const linked = gateway.linkSession({ authorized: true, origin: ORIGIN, nowMs: 1000 });
  if (!linked.ok) throw new Error('link failed');
  const companion = new CompanionGateway(gateway);
  companion.authorize(linked.session, linked.epoch, 'human');
  return { companion, session: linked.session, epoch: linked.epoch };
}

function observation(tick: number, roomOffset = 0, relay = true) {
  const base: Record<string, any> = {
    tick,
    player: { x: 25 + roomOffset, y: 46 },
    echo: { x: 26 + roomOffset, y: 46, hp: 100, maxHp: 100, aimYaw: 0 },
    drones: [],
    targets: [],
    energy: { current: 100, max: 100 },
    cooldowns: { scanTicks: 0, jamTicks: 0 }
  };
  if (relay) {
    base.relay = { id: 'relay_main', x: 25 + roomOffset, y: 46, state: 'INACTIVE' };
    base.objectiveBlocked = true;
  }
  return {
    ...base,
    schema: 'last_signal.echo-observation.v1',
    perception: {
      center: { x: base.echo.x, y: base.echo.y },
      radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true
    }
  };
}

const id24 = (n: number) => 'sug_' + n.toString(16).padStart(24, '0');
const req24 = (n: number) => 'req_' + n.toString(16).padStart(24, '0');

function seed(g: ReturnType<typeof setup>, tick: number, n: number) {
  const pushed = g.companion.pushObservation(g.session, g.epoch, observation(tick));
  expect(pushed.ok, JSON.stringify(pushed)).toBe(true);
  const s = g.companion.suggest({
    session: g.session, epoch: g.epoch,
    requestId: req24(n), suggestionId: id24(n),
    kind: 'scan', reason: 'perceived_relay', ttlTicks: 600
  });
  expect(s.ok, JSON.stringify(s)).toBe(true);
}

describe('7c0068f room generation — deterministic ordering probes', () => {
  it('P1 generation is monotonic and session/epoch never change; same-room notify is a no-op', () => {
    const g = setup();
    g.companion.pushObservation(g.session, g.epoch, observation(10));
    const r0 = g.companion.roomChanged(g.session, g.epoch, ROOM_A, 10);
    expect(r0.ok).toBe(true);
    if (!r0.ok) return;
    const genA = r0.value.generation;
    expect(r0.value.roomId).toBe(ROOM_A);

    // same room, nothing confirmed: must NOT bump / NOT cancel anything
    seed(g, 20, 1);
    const same = g.companion.roomChanged(g.session, g.epoch, ROOM_A, 20);
    expect(same.ok).toBe(true);
    if (!same.ok) return;
    expect(same.value.generation, 'same-room repeat cannot bump the generation').toBe(genA);
    expect(same.value.cancelled).toHaveLength(0);
    const still = g.companion.pending(g.session, g.epoch);
    expect(still.ok && still.value.map((p) => p.suggestionId)).toEqual([id24(1)]);

    const toB = g.companion.roomChanged(g.session, g.epoch, ROOM_B, 30);
    expect(toB.ok).toBe(true);
    if (!toB.ok) return;
    expect(toB.value.generation).toBe(genA + 1);
    // session/epoch unchanged by the room change
    const view = g.companion.status(g.session, g.epoch);
    expect(view.ok).toBe(true);
    if (view.ok) expect(view.value.status.epoch).toBe(g.epoch);
  });

  it('P2 CONFIRMED-but-unapplied + SAME-ROOM notify: does the generation still bump? (claim check)', () => {
    const g = setup();
    seed(g, 50, 2);
    const decided = g.companion.decide({
      session: g.session, epoch: g.epoch, suggestionId: id24(2), decision: 'confirm', tick: 50
    });
    expect(decided.ok, JSON.stringify(decided)).toBe(true);

    const before = g.companion.status(g.session, g.epoch);
    const genBefore = before.ok ? before.value.status.roomGeneration : -1;

    // A duplicate / repeated notification for the SAME room (idempotent by
    // contract) while one decision is confirmed but not yet applied.
    const same = g.companion.roomChanged(g.session, g.epoch, ROOM_A, 51);
    expect(same.ok).toBe(true);
    const after = g.companion.status(g.session, g.epoch);
    const genAfter = after.ok ? after.value.status.roomGeneration : -1;
    const receipts = after.ok ? after.value.receipts : [];
    const rec = receipts.find((r) => r.suggestionId === id24(2));
    // DOCUMENTS ACTUAL BEHAVIOUR (asserted as fact, not as wish):
    console.log('P2 same_room_bumped=' + (genAfter !== genBefore) + ' receipts=' + JSON.stringify(rec));
    expect(genAfter, 'same-room repeat with an unapplied decision bumps the generation').toBe(genBefore + 1);
    expect(rec, 'the confirmed decision is reported as cancelled/room_changed').toMatchObject({
      status: 'cancelled', reason: 'room_changed', decidedAtTick: null
    });
  });

  it('P3 late markApplied after a room change is refused and cannot resurrect the id', () => {
    const g = setup();
    seed(g, 60, 3);
    expect(g.companion.decide({
      session: g.session, epoch: g.epoch, suggestionId: id24(3), decision: 'confirm', tick: 60
    }).ok).toBe(true);
    const moved = g.companion.roomChanged(g.session, g.epoch, ROOM_B, 61);
    expect(moved.ok).toBe(true);
    // The browser posts applied AFTER the tick: this is the late arrival.
    const late = g.companion.markApplied(g.session, id24(3), 62);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.code).toBe('E_STALE_GENERATION');
    // replaying the old suggest request cannot revive it
    g.companion.pushObservation(g.session, g.epoch, observation(63, 88, false));
    const revive = g.companion.suggest({
      session: g.session, epoch: g.epoch,
      requestId: req24(3), suggestionId: id24(3),
      kind: 'scan', reason: 'perceived_relay', ttlTicks: 600
    });
    expect(revive.ok).toBe(false);
    if (!revive.ok) {
      // either the room tombstone or the eviction tombstone must refuse it
      expect(['E_STALE_GENERATION', 'E_RETRY_AFTER_EVICTION']).toContain(revive.code);
    }
  });

  it('P4 late CONFIRM of a held old object after a room change is refused', () => {
    const g = setup();
    seed(g, 70, 4);
    const pendingBefore = g.companion.pending(g.session, g.epoch);
    expect(pendingBefore.ok && pendingBefore.value.length).toBe(1);
    const held = pendingBefore.ok ? pendingBefore.value[0] : null;
    expect(g.companion.roomChanged(g.session, g.epoch, ROOM_B, 71).ok).toBe(true);
    const lateConfirm = g.companion.decide({
      session: g.session, epoch: g.epoch, suggestionId: held!.suggestionId, decision: 'confirm', tick: 72
    });
    expect(lateConfirm.ok).toBe(false);
    if (!lateConfirm.ok) expect(lateConfirm.code).toBe('E_STALE_GENERATION');
    // and it never shows up as pending again
    const after = g.companion.pending(g.session, g.epoch);
    expect(after.ok && after.value.length).toBe(0);
  });

  it('P5 out-of-order room reports (B then late A) — over-cancellation check', () => {
    const g = setup();
    g.companion.roomChanged(g.session, g.epoch, ROOM_A, 80);
    const toB = g.companion.roomChanged(g.session, g.epoch, ROOM_B, 81);
    expect(toB.ok).toBe(true);
    // a legitimate NEW-room proposal
    seed(g, 82, 5);
    // a LATE report for the room we already left
    const lateA = g.companion.roomChanged(g.session, g.epoch, ROOM_A, 83);
    expect(lateA.ok).toBe(true);
    const status = g.companion.status(g.session, g.epoch);
    const roomId = status.ok ? status.value.status.roomId : null;
    const cancelledLate = lateA.ok ? lateA.value.cancelled : [];
    console.log('P5 roomId_after_late_report=' + roomId + ' cancelled=' + JSON.stringify(cancelledLate));
    // DOCUMENTS ACTUAL BEHAVIOUR: a stale report regresses roomId and cancels
    // the NEW room's legitimate proposal.
    expect(roomId, 'roomId regresses to the late (older) room').toBe(ROOM_A);
    expect(cancelledLate, 'the new room proposal is cancelled by the stale report').toEqual([id24(5)]);
    const pending = g.companion.pending(g.session, g.epoch);
    expect(pending.ok && pending.value.length, 'its owner can no longer confirm it').toBe(0);
  });

  it('P6 tombstone ledger is bounded at 512 but the id stays non-resurrectable', () => {
    const facet = new CompanionFacet({ session: 'ses_probe_tombstones', epoch: 1 });
    for (let i = 0; i < 513; i += 1) {
      facet.applyRoomChange(1000 + i, i, [id24(i)]);
    }
    const ids = facet.cancelledSuggestionIds();
    expect(ids.length, 'tombstones are FIFO-bounded at 512').toBe(512);
    expect(facet.roomCancellation(id24(0)), 'oldest tombstone is evicted from the ledger').toBeNull();
    expect(facet.roomCancellation(id24(512)), 'newest tombstone is present').toBe('room_changed');
    // The eviction ledger still refuses any replay of the evicted id.
    expect(facet.expiredSuggestionIds()).toContain(id24(0));
  });

  it('P7 a new-room proposal is impossible until the new observation lands', () => {
    const g = setup();
    g.companion.pushObservation(g.session, g.epoch, observation(90));
    g.companion.roomChanged(g.session, g.epoch, ROOM_B, 91);
    const tooEarly = g.companion.suggest({
      session: g.session, epoch: g.epoch,
      requestId: req24(7), suggestionId: id24(7),
      kind: 'scan', reason: 'perceived_relay', ttlTicks: 600
    });
    expect(tooEarly.ok, 'no observation after the room change => no proposal').toBe(false);
    if (!tooEarly.ok) expect(tooEarly.code).toBe('E_LINK_UNAVAILABLE');
    const pushed = g.companion.pushObservation(g.session, g.epoch, observation(92));
    expect(pushed.ok, JSON.stringify(pushed)).toBe(true);
    const ok = g.companion.suggest({
      session: g.session, epoch: g.epoch,
      requestId: req24(7), suggestionId: id24(7),
      kind: 'scan', reason: 'perceived_relay', ttlTicks: 600
    });
    expect(ok.ok, 'after the new observation it is proposable again').toBe(true);
  });
});
