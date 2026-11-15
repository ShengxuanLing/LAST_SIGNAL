// P3-b A — Companion gateway bounded semantics and Owner isolation.

import { describe, expect, it } from 'vitest';
import { WorldGateway } from './worldGateway';
import { CompanionGateway } from './companionGateway';
import { COMPANION_LIMITS } from './companionFacet';

const ORIGIN = 'http://localhost:5335';
function setup() {
  const gateway = new WorldGateway();
  const linked = gateway.linkSession({ authorized: true, origin: ORIGIN, nowMs: 1000 });
  if (!linked.ok) throw new Error('link failed');
  const companion = new CompanionGateway(gateway);
  companion.authorize(linked.session, linked.epoch, 'human');
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

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'req_' + 'a'.repeat(24),
    suggestionId: 'sug_' + 'b'.repeat(24),
    kind: 'fire',
    reason: 'perceived_hostile',
    target: { x: 2, y: 0 },
    ...overrides
  };
}

describe('CompanionGateway', () => {
  it('only observes the echo-cropped observation pushed by the browser', () => {
    const { companion, session, epoch } = setup();
    expect(companion.observe(session, epoch)).toMatchObject({ ok: false, code: 'E_LINK_UNAVAILABLE' });
    const pushed = companion.pushObservation(session, epoch, observation());
    expect(pushed.ok).toBe(true);
    if (!pushed.ok) return;
    expect(pushed.value.drones.map((d) => d.id)).toEqual([1]);
    expect(JSON.stringify(pushed.value)).not.toContain('"seed"');
    expect(companion.pushObservation(session, epoch, { ...observation(), seed: 42 }))
      .toMatchObject({ ok: false, code: 'E_SCHEMA' });
  });

  it('suggest is idempotent, bounded (8 live / 512 dedup), TTL/epoch aware', () => {
    const { companion, session, epoch, gateway } = setup();
    companion.pushObservation(session, epoch, observation());
    const first = companion.suggest({ session, epoch, ...suggestion() } as never);
    expect(first.ok).toBe(true);
    const replay = companion.suggest({ session, epoch, ...suggestion() } as never);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.replayed).toBe(true);
    expect(companion.suggest({ session, epoch, ...suggestion({ kind: 'move' }) } as never))
      .toMatchObject({ ok: false, code: 'E_ID_PAYLOAD_MISMATCH' });
    for (let i = 0; i < 7; i += 1) {
      expect(companion.suggest({
        session, epoch,
        requestId: 'req_' + (i + 1).toString(16).padStart(24, '0'),
        suggestionId: 'sug_' + (i + 1).toString(16).padStart(24, '0'),
        kind: 'fire', reason: 'perceived_hostile', target: { x: 2, y: 0 }
      } as never).ok).toBe(true);
    }
    expect(companion.suggest({
      session, epoch,
      requestId: 'req_' + 'f'.repeat(24), suggestionId: 'sug_' + 'f'.repeat(24),
      kind: 'fire', reason: 'perceived_hostile', target: { x: 2, y: 0 }
    } as never)).toMatchObject({ ok: false, code: 'E_RESOURCE_LIMIT' });
    expect(companion.status(session, epoch).ok).toBe(true);
    gateway.yieldSession(session, epoch, 'takeover', 2000);
    expect(companion.suggest({ session, epoch, ...suggestion({ suggestionId: 'sug_' + 'c'.repeat(24) }) } as never))
      .toMatchObject({ ok: false });
    expect(COMPANION_LIMITS.MAX_DEDUP_RECORDS).toBe(512);
  });

  it('every external suggestion stays proposed until the browser-only decision', () => {
    const { companion, session, epoch } = setup();
    companion.pushObservation(session, epoch, observation());
    const r = companion.suggest({ session, epoch, ...suggestion() } as never);
    if (!r.ok) throw new Error('suggest failed');
    const id = r.value.suggestion.suggestionId;
    expect(companion.pending(session, epoch)).toMatchObject({ ok: true });
    const pending = companion.pending(session, epoch);
    if (!pending.ok) throw new Error('pending failed');
    expect(pending.value.map((p) => p.suggestionId)).toContain(id);
    expect(pending.value[0].status).toBe('proposed');
    const decided = companion.decide({ session, epoch, suggestionId: id, decision: 'confirm', tick: 101 });
    expect(decided.ok).toBe(true);
    expect(companion.decide({ session, epoch, suggestionId: id, decision: 'reject', tick: 101 }))
      .toMatchObject({ ok: false, code: 'E_RETRYABLE' });
    const applied = companion.markApplied(session, id, 102);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.applied).toBe(true);
  });

  it('stale epoch, expired TTL and AI/External owner mode are refused', () => {
    const { companion, session, epoch } = setup();
    companion.pushObservation(session, epoch, observation());
    expect(companion.observe(session, epoch + 1)).toMatchObject({ ok: false, code: 'E_STALE_EPOCH' });
    const r = companion.suggest({ session, epoch, ...suggestion({ ttlTicks: 3 }) } as never);
    if (!r.ok) throw new Error('suggest failed');
    const id = r.value.suggestion.suggestionId;
    companion.pushObservation(session, epoch, observation({ tick: 103 }));
    expect(companion.decide({ session, epoch, suggestionId: id, decision: 'confirm', tick: 103 }))
      .toMatchObject({ ok: false, code: 'E_TARGET_DESTROYED' });
    companion.setOwnerMode(session, epoch, 'ai');
    const r2 = companion.pushObservation(session, epoch, observation({ tick: 104 }));
    expect(r2.ok).toBe(true);
    expect(companion.suggest({
      session, epoch,
      requestId: 'req_' + 'e'.repeat(24), suggestionId: 'sug_' + 'd'.repeat(24),
      kind: 'fire', reason: 'perceived_hostile', target: { x: 2, y: 0 }
    } as never)).toMatchObject({ ok: false, code: 'E_PERMISSION' });
    expect(companion.decide({ session, epoch, suggestionId: id, decision: 'confirm', tick: 104 }))
      .toMatchObject({ ok: false, code: 'E_PERMISSION' });
  });

  it('lease expiry/disconnect cancels pending work and shows NO_MODEL fallback', () => {
    const { companion, session, epoch } = setup();
    companion.pushObservation(session, epoch, observation());
    const r = companion.suggest({ session, epoch, ...suggestion() } as never);
    expect(r.ok).toBe(true);
    companion.onLeaseExpired(session);
    const status = companion.status(session, epoch);
    if (!status.ok) throw new Error('status failed');
    expect(status.value.status).toMatchObject({ link: 'fallback', fallbackLabel: 'NO_MODEL', pendingSuggestions: 0 });
    expect(companion.observe(session, epoch)).toMatchObject({ ok: false, code: 'E_LINK_UNAVAILABLE' });
    expect(companion.decide({ session, epoch, suggestionId: 'sug_' + 'b'.repeat(24), decision: 'confirm', tick: 101 }))
      .toMatchObject({ ok: false, code: 'E_LINK_UNAVAILABLE' });
  });
});
