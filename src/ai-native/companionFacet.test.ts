// AI-NATIVE-02 P3-b — Companion facet (pure) permission, budget and honesty tests.

import { describe, expect, it } from 'vitest';
import {
  COMPANION_LIMITS, CompanionFacet, type CompanionObservationView
} from './companionFacet';

function ids(): () => string {
  let n = 0;
  return () => `sug_${(n++).toString(16).padStart(24, '0')}`;
}

function facet(overrides: Partial<{ epoch: number; maxUnconfirmed: number; maxDedupRecords: number }> = {}) {
  return new CompanionFacet({
    session: 'ses_aaaaaaaaaaaaaaaaaaaaaaaa',
    epoch: overrides.epoch ?? 1,
    suggestionIdFactory: ids(),
    maxUnconfirmed: overrides.maxUnconfirmed,
    maxDedupRecords: overrides.maxDedupRecords
  });
}

function view(overrides: Partial<CompanionObservationView> = {}): CompanionObservationView {
  return {
    epoch: 1,
    tick: 100,
    player: { x: 0, y: 0 },
    echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
    drones: [],
    ...overrides
  };
}

describe('CompanionFacet observe', () => {
  it('projects only the echo-centred, bounded perception view', () => {
    const f = facet();
    const r = f.observe(view({
      drones: [
        { id: 1, x: 3, y: 0, hp: 5 },
        { id: 2, x: 40, y: 0, hp: 5 },
        { id: 3, x: 0, y: 0, hp: 0 }
      ],
      relay: { id: 'relay_main', x: 2, y: 0, state: 'INACTIVE' },
      objectiveBlocked: true,
      energy: { current: 90, max: 100 }
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.drones.map((d) => d.id)).toEqual([1]);
    expect(r.value.relay?.id).toBe('relay_main');
    expect(r.value.objectiveBlocked).toBe(true);
    expect(r.value.energy).toEqual({ current: 90, max: 100 });
    expect(r.value).not.toHaveProperty('seed');
    expect(r.value).not.toHaveProperty('map');
    expect(r.value).not.toHaveProperty('rngState');
    expect(Object.isFrozen(r.value)).toBe(true);
    // The returned value cannot be used to mutate internal memory.
    expect(() => { (r.value.drones as unknown as unknown[]).push({}); }).toThrow();
  });

  it('rejects a stale epoch and a backwards tick', () => {
    const f = facet();
    expect(f.observe(view({ epoch: 2 }))).toMatchObject({ ok: false, code: 'E_STALE_EPOCH' });
    expect(f.observe(view({ tick: 10 }))).toMatchObject({ ok: true });
    expect(f.observe(view({ tick: 9 }))).toMatchObject({ ok: false, code: 'E_STALE_TICK' });
  });

  it('keeps memory bounded to 16 entries and expires it by TTL', () => {
    const f = facet();
    for (let t = 0; t < 3; t += 1) {
      f.observe(view({
        tick: 100 + t,
        drones: Array.from({ length: 10 }, (_, i) => ({ id: t * 10 + i + 1, x: 1, y: 1, hp: 5 }))
      }));
    }
    expect(f.memory.length).toBe(COMPANION_LIMITS.MEMORY_ENTRIES);
    // Exactly at TTL the oldest entry is kept; past it, pruned.
    f.observe(view({ tick: 100 + COMPANION_LIMITS.MEMORY_TTL_TICKS, drones: [] }));
    expect(f.memory.length).toBeGreaterThan(0);
    f.observe(view({ tick: 100 + COMPANION_LIMITS.MEMORY_TTL_TICKS * 2 + 5, drones: [] }));
    expect(f.memory.length).toBe(0);
  });
});

describe('CompanionFacet suggest', () => {
  it('reasons must be visible in the CURRENT observation (no invented causes)', () => {
    const f = facet();
    f.observe(view({ drones: [{ id: 1, x: 1, y: 0, hp: 5 }] }));
    expect(f.suggest({ kind: 'scan', reason: 'perceived_relay' }))
      .toMatchObject({ ok: false, code: 'E_SCHEMA', messageKey: 'companion.reason_unobserved' });
    expect(f.suggest({ kind: 'scan', reason: 'objective_blocked' }))
      .toMatchObject({ ok: false, code: 'E_SCHEMA' });
    expect(f.suggest({ kind: 'fire', reason: 'no_perceived_target' }))
      .toMatchObject({ ok: false, code: 'E_SCHEMA' });
    expect(f.suggest({ kind: 'fire', reason: 'perceived_hostile', target: { x: 1, y: 0 } }))
      .toMatchObject({ ok: true });
  });

  it('a suggestion target must be inside the echo perception and well formed', () => {
    const f = facet();
    f.observe(view({ relay: { id: 'relay', x: 2, y: 0, state: 'INACTIVE' } }));
    expect(f.suggest({ kind: 'jam', reason: 'perceived_relay', target: { x: 30, y: 0 } }))
      .toMatchObject({ ok: false, code: 'E_ILLEGAL_TARGET' });
    expect(f.suggest({ kind: 'jam', reason: 'perceived_relay', target: { x: Number.NaN, y: 0 } }))
      .toMatchObject({ ok: false, code: 'E_SCHEMA' });
    expect(f.suggest({ kind: 'jam', reason: 'perceived_relay', ttlTicks: 9999 }))
      .toMatchObject({ ok: false, code: 'E_SCHEMA' });
    expect(f.suggest({ kind: 'jam', reason: 'perceived_relay', confidence: 1.5 }))
      .toMatchObject({ ok: false, code: 'E_SCHEMA' });
    expect(f.suggest({ kind: 'jam', reason: 'perceived_relay', suggestionId: 'bad' }))
      .toMatchObject({ ok: false, code: 'E_SCHEMA' });
    expect(f.suggest({ kind: 'explode' as never, reason: 'perceived_relay' }))
      .toMatchObject({ ok: false, code: 'E_SCHEMA' });
  });

  it('is idempotent per suggestionId and never re-executes an evicted id', () => {
    const f = facet();
    f.observe(view({ relay: { id: 'relay', x: 2, y: 0, state: 'INACTIVE' } }));
    const first = f.suggest({ kind: 'scan', reason: 'perceived_relay', suggestionId: 'sug_' + 'a'.repeat(24) });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.replayed).toBe(false);
    const replay = f.suggest({ kind: 'scan', reason: 'perceived_relay', suggestionId: 'sug_' + 'a'.repeat(24) });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.replayed).toBe(true);
    expect(f.status().dedupRecords).toBe(1);
    expect(f.suggest({ kind: 'jam', reason: 'perceived_relay', suggestionId: 'sug_' + 'a'.repeat(24) }))
      .toMatchObject({ ok: false, code: 'E_ID_PAYLOAD_MISMATCH' });
    // Expire, then the old id must stay rejected (tombstone).
    f.observe(view({ tick: 100 + COMPANION_LIMITS.DEFAULT_SUGGESTION_TTL_TICKS + 1, relay: { id: 'relay', x: 2, y: 0, state: 'INACTIVE' } }));
    expect(f.suggest({ kind: 'scan', reason: 'perceived_relay', suggestionId: 'sug_' + 'a'.repeat(24) }))
      .toMatchObject({ ok: false, code: 'E_RETRY_AFTER_EVICTION' });
  });

  it('rejects on a full unconfirmed queue instead of FIFO-evicting a live one', () => {
    const f = facet({ maxUnconfirmed: 2 });
    f.observe(view({ relay: { id: 'relay', x: 2, y: 0, state: 'INACTIVE' } }));
    expect(f.suggest({ kind: 'scan', reason: 'perceived_relay' })).toMatchObject({ ok: true });
    expect(f.suggest({ kind: 'jam', reason: 'perceived_relay' })).toMatchObject({ ok: true });
    expect(f.suggest({ kind: 'move', reason: 'perceived_relay', target: { x: 1, y: 0 } }))
      .toMatchObject({ ok: false, code: 'E_RESOURCE_LIMIT' });
    expect(f.pendingSuggestions()).toHaveLength(2);
    expect(f.status().dedupRecords).toBe(2);
  });

  it('honours the session-wide dedup hard bound', () => {
    const f = facet({ maxDedupRecords: 3 });
    f.observe(view({ relay: { id: 'relay', x: 2, y: 0, state: 'INACTIVE' } }));
    for (let i = 0; i < 3; i += 1) {
      expect(f.suggest({ kind: 'scan', reason: 'perceived_relay', ttlTicks: 60 })).toMatchObject({ ok: true });
      f.observe(view({ tick: 101 + i, relay: { id: 'relay', x: 2, y: 0, state: 'INACTIVE' } }));
    }
    expect(f.suggest({ kind: 'scan', reason: 'perceived_relay' }))
      .toMatchObject({ ok: false, code: 'E_RESOURCE_LIMIT', messageKey: 'companion.dedup_limit' });
  });

  it('no observation means no suggestion', () => {
    const f = facet();
    expect(f.suggest({ kind: 'scan', reason: 'no_perceived_target' }))
      .toMatchObject({ ok: false, code: 'E_LINK_UNAVAILABLE' });
  });
});

describe('CompanionFacet honesty / exclusion', () => {
  it('AI or External protagonist control is read-only and cancels pending suggestions', () => {
    const f = facet();
    f.observe(view({ relay: { id: 'relay', x: 2, y: 0, state: 'INACTIVE' } }));
    expect(f.suggest({ kind: 'scan', reason: 'perceived_relay' })).toMatchObject({ ok: true });
    f.setOwnerMode('ai');
    expect(f.status()).toMatchObject({ readOnly: true, ownerMode: 'ai', pendingSuggestions: 0 });
    expect(f.suggest({ kind: 'scan', reason: 'perceived_relay' }))
      .toMatchObject({ ok: false, code: 'E_PERMISSION' });
    f.setOwnerMode('external');
    expect(f.suggest({ kind: 'scan', reason: 'perceived_relay' }))
      .toMatchObject({ ok: false, code: 'E_PERMISSION' });
    f.setOwnerMode('human');
    expect(f.suggest({ kind: 'scan', reason: 'perceived_relay' })).toMatchObject({ ok: true });
  });

  it('disconnect is an explicit fallback, cancels unconfirmed work and never auto-reconnects', () => {
    const f = facet();
    f.observe(view({ relay: { id: 'relay', x: 2, y: 0, state: 'INACTIVE' } }));
    const proposed = f.suggest({ kind: 'scan', reason: 'perceived_relay' });
    expect(proposed).toMatchObject({ ok: true });
    if (!proposed.ok) return;
    const proposedId = proposed.value.suggestionId;
    f.setLink('fallback');
    expect(f.status()).toMatchObject({ link: 'fallback', fallbackLabel: 'NO_MODEL', pendingSuggestions: 0 });
    expect(f.suggest({ kind: 'scan', reason: 'perceived_relay' }))
      .toMatchObject({ ok: false, code: 'E_LINK_UNAVAILABLE' });
    f.setLink('connected');
    // Reconnecting does NOT revive the cancelled suggestion.
    expect(f.status()).toMatchObject({ link: 'connected', fallbackLabel: null, pendingSuggestions: 0 });
    expect(f.suggest({ kind: 'scan', reason: 'perceived_relay', suggestionId: proposedId }))
      .toMatchObject({ ok: false, code: 'E_RETRY_AFTER_EVICTION' });
  });

  it('a stale epoch invalidates unconfirmed suggestions', () => {
    const f = facet();
    f.observe(view({ relay: { id: 'relay', x: 2, y: 0, state: 'INACTIVE' } }));
    expect(f.suggest({ kind: 'scan', reason: 'perceived_relay' })).toMatchObject({ ok: true });
    f.rebindEpoch(2);
    expect(f.status()).toMatchObject({ epoch: 2, pendingSuggestions: 0 });
    expect(f.observe(view({ epoch: 1, relay: { id: 'relay', x: 2, y: 0, state: 'INACTIVE' } })))
      .toMatchObject({ ok: false, code: 'E_STALE_EPOCH' });
  });

  it('exposes no confirmation, owner, player-step or dev capability', () => {
    const f = facet();
    const names = new Set([
      ...Object.getOwnPropertyNames(f),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(f))
    ]);
    for (const forbidden of ['confirm', 'reject', 'accept', 'execute', 'step', 'stepPlayer', 'toggleRelay',
      'setPlayerData', 'snapshot', 'restore', 'replay', 'injectFixture', 'dev', 'devTools']) {
      expect(names.has(forbidden), `CompanionFacet must not expose ${forbidden}`).toBe(false);
    }
    for (const allowed of ['observe', 'suggest', 'status', 'pendingSuggestions', 'advanceTo', 'setLink', 'setOwnerMode', 'rebindEpoch']) {
      expect(names.has(allowed), `CompanionFacet exposes ${allowed}`).toBe(true);
    }
  });
});
