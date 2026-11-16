// Task C fix #2 — a COMMITTED room change must retire the previous room's
// Companion proposals. Field evidence: an unconfirmed `fire` seeded in room A,
// a REAL portal transition A -> B, then the Owner confirmed the OLD object and
// the browser fired one projectile on the old room's coordinates.
//
// Contract proven here:
//   - unconfirmed proposals of the old room are cancelled with a real tombstone
//   - confirmed-but-not-applied decisions are cancelled too
//   - a held old suggestion can no longer be decided (E_STALE_GENERATION)
//   - no late markApplied / duplicate suggest can revive it
//   - the agent must publish a NEW room observation before proposing again
//   - the same-room notification is idempotent (pause/resume cancels nothing)
//   - already APPLIED history stays applied
//
// Run: npx vitest run src/ai-native/companionRoomGeneration.test.ts

import { describe, expect, it } from 'vitest';
import { WorldGateway } from './worldGateway';
import { CompanionGateway } from './companionGateway';

const ORIGIN = 'http://localhost:5336';
const ROOM_A = 0;
const ROOM_B = 3;

function setup(roomId = ROOM_A) {
  const gateway = new WorldGateway();
  const linked = gateway.linkSession({ authorized: true, origin: ORIGIN, nowMs: 1000 });
  if (!linked.ok) throw new Error('link failed');
  const companion = new CompanionGateway(gateway);
  companion.authorize(linked.session, linked.epoch, 'human');
  // Real order: the room commit lands first, then the renderer publishes the
  // observation for THAT room (a room change invalidates older observations).
  const room = companion.roomChanged(linked.session, linked.epoch, roomId, 99);
  expect(room.ok).toBe(true);
  expect(companion.pushObservation(linked.session, linked.epoch, observation({ tick: 100 })).ok).toBe(true);
  return { gateway, companion, session: linked.session, epoch: linked.epoch };
}

function observation(overrides: Record<string, unknown> = {}) {
  const base = {
    epoch: 1, tick: 100,
    player: { x: 0, y: 0 },
    echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
    drones: [{ id: 1, x: 2, y: 0, hp: 5 }],
    targets: []
  };
  const merged = { ...base, ...overrides };
  return {
    ...merged,
    schema: 'last_signal.echo-observation.v1',
    perception: {
      center: { x: merged.echo.x, y: merged.echo.y },
      radiusTiles: 12, requiresExplored: true, requiresLineOfSight: true
    },
    targets: merged.targets ?? []
  };
}

function suggestion(n: number, overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'req_' + n.toString(16).padStart(24, '0'),
    suggestionId: 'sug_' + n.toString(16).padStart(24, '0'),
    kind: 'fire',
    reason: 'perceived_hostile',
    target: { x: 2, y: 0 },
    ...overrides
  };
}

describe('room generation retires the previous room proposals', () => {
  it('cancels unconfirmed proposals and reports an explicit cancelled receipt', () => {
    const { companion, session, epoch } = setup();
    const proposed = companion.suggest({ session, epoch, ...suggestion(1) } as never);
    expect(proposed.ok).toBe(true);
    const id = (proposed as { value: { suggestion: { suggestionId: string } } }).value.suggestion.suggestionId;
    expect(companion.status(session, epoch).ok && (companion.status(session, epoch) as any).value.pending).toHaveLength(1);

    const moved = companion.roomChanged(session, epoch, ROOM_B, 120);
    expect(moved.ok).toBe(true);
    const after = companion.status(session, epoch) as any;
    expect(after.value.pending).toHaveLength(0);
    expect(after.value.receipts).toContainEqual({
      suggestionId: id, status: 'cancelled', reason: 'room_changed', decidedAtTick: null, appliedTick: null
    });
    expect(after.value.status.roomId).toBe(ROOM_B);
    expect(after.value.status.roomGeneration).toBeGreaterThan(0);
  });

  it('a held OLD suggestion object can no longer be decided (E_STALE_GENERATION)', () => {
    const { companion, session, epoch } = setup();
    const id = 'sug_' + '1'.repeat(24);
    const proposed = companion.suggest({ session, epoch, ...suggestion(2, { suggestionId: id }) } as never);
    expect(proposed.ok).toBe(true);

    companion.roomChanged(session, epoch, ROOM_B, 120);
    const decided = companion.decide({ session, epoch, suggestionId: id, decision: 'confirm', tick: 121 });
    expect(decided).toMatchObject({ ok: false, code: 'E_STALE_GENERATION' });
    expect((decided as { messageKey: string }).messageKey).toBe('companion.suggestion_room_changed');
    // and it can never be reported as executed later
    expect(companion.markApplied(session, id, 122))
      .toMatchObject({ ok: false, code: 'E_STALE_GENERATION' });
    expect((companion.status(session, epoch) as any).value.pending).toHaveLength(0);
  });

  it('a CONFIRMED-but-unapplied decision goes stale, and only the ORIGINAL generation can report applied', () => {
    const { companion, session, epoch } = setup();
    const id = 'sug_' + '2'.repeat(24);
    expect(companion.suggest({ session, epoch, ...suggestion(3, { suggestionId: id }) } as never).ok).toBe(true);
    expect(companion.decide({ session, epoch, suggestionId: id, decision: 'confirm', tick: 101 }).ok).toBe(true);
    const decidedGeneration = (companion.status(session, epoch) as any).value.status.roomGeneration;

    companion.roomChanged(session, epoch, ROOM_B, 120);
    const stale = (companion.status(session, epoch) as any).value.receipts as Array<Record<string, unknown>>;
    expect(stale.find((r) => r.suggestionId === id)).toMatchObject({ status: 'cancelled', reason: 'room_changed' });
    // A receipt claiming the NEW generation is refused (it never ran there).
    expect(companion.markApplied(session, id, 121, { generation: decidedGeneration + 1 }))
      .toMatchObject({ ok: false, code: 'E_STALE_GENERATION' });
    // A late receipt from the ORIGINAL generation is truthful history: applied.
    expect(companion.markApplied(session, id, 102, { generation: decidedGeneration, roomId: ROOM_A }).ok).toBe(true);
    const after = (companion.status(session, epoch) as any).value.receipts as Array<Record<string, unknown>>;
    expect(after.find((r) => r.suggestionId === id)).toMatchObject({ status: 'applied', appliedTick: 102 });
  });

  it('SAME-ROOM repeat with a confirmed-but-unapplied decision is still a no-op (no generation bump)', () => {
    const { companion, session, epoch } = setup();
    const id = 'sug_' + '6'.repeat(24);
    expect(companion.suggest({ session, epoch, ...suggestion(11, { suggestionId: id }) } as never).ok).toBe(true);
    expect(companion.decide({ session, epoch, suggestionId: id, decision: 'confirm', tick: 101 }).ok).toBe(true);
    const before = (companion.status(session, epoch) as any).value.status.roomGeneration;

    for (let i = 0; i < 3; i += 1) {
      const same = companion.roomChanged(session, epoch, ROOM_A, 110 + i);
      expect(same.ok).toBe(true);
      expect((same as any).value.generation, 'same-room repeat must not bump').toBe(before);
      expect((same as any).value.cancelled).toHaveLength(0);
    }
    const status = companion.status(session, epoch) as any;
    expect(status.value.receipts.find((r: any) => r.suggestionId === id))
      .toMatchObject({ status: 'confirmed' });
    // and the decision can still be applied truthfully in its own generation
    expect(companion.markApplied(session, id, 102).ok).toBe(true);
  });

  it('an OUT-OF-ORDER (late) report for a left room neither rolls back nor cancels the new proposal', () => {
    const { companion, session, epoch } = setup();
    expect(companion.roomChanged(session, epoch, ROOM_A, 90, 1).ok).toBe(true);
    expect(companion.roomChanged(session, epoch, ROOM_B, 95, 2).ok).toBe(true);
    const newId = 'sug_' + '7'.repeat(24);
    expect(companion.pushObservation(session, epoch, observation({ tick: 96 })).ok).toBe(true);
    expect(companion.suggest({ session, epoch, ...suggestion(12, { suggestionId: newId }) } as never).ok).toBe(true);

    // The delayed A report (older sequence AND older tick) arrives last.
    const late = companion.roomChanged(session, epoch, ROOM_A, 91, 1);
    expect(late.ok).toBe(true);
    expect((late as any).value.stale, 'the late report is classified stale').toBe(true);
    expect((late as any).value.cancelled, 'it cancels nothing').toHaveLength(0);

    const status = companion.status(session, epoch) as any;
    expect(status.value.status.roomId, 'the session stays in the newest room').toBe(ROOM_B);
    expect(status.value.pending.map((p: { suggestionId: string }) => p.suggestionId))
      .toContain(newId);
  });

  it('keeps an ALREADY APPLIED suggestion as applied history', () => {
    const { companion, session, epoch } = setup();
    const id = 'sug_' + '3'.repeat(24);
    companion.suggest({ session, epoch, ...suggestion(4, { suggestionId: id }) } as never);
    companion.decide({ session, epoch, suggestionId: id, decision: 'confirm', tick: 101 });
    expect(companion.markApplied(session, id, 102).ok).toBe(true);

    companion.roomChanged(session, epoch, ROOM_B, 120);
    const receipts = (companion.status(session, epoch) as any).value.receipts as Array<Record<string, unknown>>;
    expect(receipts.find((r) => r.suggestionId === id)).toMatchObject({ status: 'applied', appliedTick: 102 });
  });

  it('a duplicate suggest (same or new requestId) never resurrects the old id', () => {
    const { companion, session, epoch } = setup();
    const id = 'sug_' + '4'.repeat(24);
    const input = suggestion(5, { suggestionId: id });
    expect(companion.suggest({ session, epoch, ...input } as never).ok).toBe(true);

    companion.roomChanged(session, epoch, ROOM_B, 120);
    // Same requestId replay: refused with the explicit room-generation reason.
    expect(companion.suggest({ session, epoch, ...input } as never))
      .toMatchObject({ ok: false, code: 'E_STALE_GENERATION', messageKey: 'companion.suggestion_room_changed' });
    // A brand-new requestId for the same suggestionId is still dead.
    expect(companion.suggest({
      session, epoch, ...input, requestId: 'req_' + '9'.repeat(24)
    } as never)).toMatchObject({ ok: false, code: 'E_STALE_GENERATION' });
  });

  it('requires a NEW room observation before any new proposal', () => {
    const { companion, session, epoch } = setup();
    companion.roomChanged(session, epoch, ROOM_B, 120);
    expect(companion.suggest({ session, epoch, ...suggestion(6) } as never))
      .toMatchObject({ ok: false, code: 'E_LINK_UNAVAILABLE', messageKey: 'companion.no_observation' });

    const pushed = companion.pushObservation(session, epoch, observation({ tick: 130 }));
    expect(pushed.ok).toBe(true);
    const fresh = companion.suggest({ session, epoch, ...suggestion(7) } as never);
    expect(fresh.ok).toBe(true);
    const value = (fresh as { value: { suggestion: { roomId: number; generation: number } } }).value.suggestion;
    expect(value.roomId).toBe(ROOM_B);
    expect(value.generation).toBeGreaterThan(0);
  });

  it('is idempotent for the same room: pause/resume and repeats cancel nothing', () => {
    const { companion, session, epoch } = setup();
    const id = 'sug_' + '5'.repeat(24);
    companion.suggest({ session, epoch, ...suggestion(8, { suggestionId: id }) } as never);
    const before = (companion.status(session, epoch) as any).value.status.roomGeneration;

    for (let i = 0; i < 3; i += 1) {
      expect(companion.roomChanged(session, epoch, ROOM_A, 110 + i).ok).toBe(true);
    }
    const after = companion.status(session, epoch) as any;
    expect(after.value.pending.map((p: { suggestionId: string }) => p.suggestionId)).toEqual([id]);
    expect(after.value.receipts.some((r: { status: string }) => r.status === 'cancelled')).toBe(false);
    expect(after.value.status.roomGeneration).toBe(before);
  });
});
