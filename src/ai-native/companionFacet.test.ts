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
      'setPlayerData', 'restore', 'restoreSnapshot', 'replay', 'injectFixture', 'dev', 'devTools']) {
      expect(names.has(forbidden), `CompanionFacet must not expose ${forbidden}`).toBe(false);
    }
    for (const allowed of ['observe', 'suggest', 'status', 'pendingSuggestions', 'advanceTo', 'setLink', 'setOwnerMode', 'rebindEpoch']) {
      expect(names.has(allowed), `CompanionFacet exposes ${allowed}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Owner confirmation contract (pure; no gateway or UI registration)
// ---------------------------------------------------------------------------
import {
  COMPANION_SUGGESTION_KINDS, CompanionOwnerLedger,
  createOwnerCapability, isOwnerCapability
} from './companionFacet';

function proposed(f: CompanionFacet, kind: string = 'scan') {
  f.observe(view({ relay: { id: 'relay', x: 2, y: 0, state: 'INACTIVE' } }));
  const r = f.suggest({ kind: kind as never, reason: 'perceived_relay' });
  if (!r.ok) throw new Error(`suggest failed: ${r.code}`);
  return r.value;
}

describe('CompanionOwnerLedger capability', () => {
  it('a token, Origin header, JSON or plain object can NEVER become the owner capability', () => {
    const real = createOwnerCapability('ses_aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(isOwnerCapability(real)).toBe(true);
    for (const forged of [
      { kind: 'OWNER', session: 'ses_aaaaaaaaaaaaaaaaaaaaaaaa', token: 'secret', origin: 'http://localhost:5335' },
      { kind: 'OWNER', session: 'ses_aaaaaaaaaaaaaaaaaaaaaaaa' },
      { kind: 'OWNER', session: 'ses_aaaaaaaaaaaaaaaaaaaaaaaa', [Symbol('other')]: true },
      'Bearer secret', null, undefined, 42,
      JSON.parse(JSON.stringify(real))
    ]) {
      expect(isOwnerCapability(forged), `forged owner proof rejected: ${JSON.stringify(forged)}`).toBe(false);
    }
  });

  it('owner decisions need the capability, matching session/epoch, human mode and a live link', () => {
    const f = facet();
    const s = proposed(f);
    const ledger = new CompanionOwnerLedger(f);
    const cap = createOwnerCapability(f.session);
    const base = { suggestionId: s.suggestionId, decision: 'confirm' as const, epoch: 1, tick: s.createdAtTick + 1 };

    expect(ledger.decide({ ...base, capability: { token: 'x', origin: 'http://localhost:5335' } }))
      .toMatchObject({ ok: false, code: 'E_PERMISSION' });
    expect(ledger.decide({ ...base, capability: createOwnerCapability('ses_bbbbbbbbbbbbbbbbbbbbbbbb') }))
      .toMatchObject({ ok: false, code: 'E_PERMISSION' });
    expect(ledger.decide({ ...base, capability: cap, epoch: 99 }))
      .toMatchObject({ ok: false, code: 'E_STALE_EPOCH' });

    f.setOwnerMode('ai');
    expect(ledger.decide({ ...base, capability: cap }))
      .toMatchObject({ ok: false, code: 'E_PERMISSION' });
    f.setOwnerMode('human');
    f.setLink('fallback');
    expect(ledger.decide({ ...base, capability: cap }))
      .toMatchObject({ ok: false, code: 'E_LINK_UNAVAILABLE' });
    f.setLink('connected');
    // The fallback/disconnect cancelled the suggestion, so it is expired now.
    expect(ledger.decide({ ...base, capability: cap }))
      .toMatchObject({ ok: false, code: 'E_TARGET_DESTROYED' });

    const fresh = proposed(f);
    const okDecision = ledger.decide({
      capability: cap, suggestionId: fresh.suggestionId, decision: 'confirm',
      epoch: 1, tick: fresh.createdAtTick + 1
    });
    expect(okDecision.ok).toBe(true);
    if (!okDecision.ok) return;
    expect(okDecision.value).toMatchObject({ suggestionId: fresh.suggestionId, decision: 'confirm', actorId: 1 });
    expect(ledger.decide({ capability: cap, suggestionId: fresh.suggestionId, decision: 'reject', epoch: 1, tick: 101 }))
      .toMatchObject({ ok: false, code: 'E_RETRYABLE' });
    // A decision RECORDS authority; it never executes and never changes the
    // suggestion status. The facet still has no executor.
    expect(f.pendingSuggestions()[0].status).toBe('proposed');
    expect(ledger.list()).toHaveLength(1);
    const names = new Set([
      ...Object.getOwnPropertyNames(f),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(f))
    ]);
    for (const forbidden of ['confirm', 'reject', 'execute', 'step', 'stepPlayer']) {
      expect(names.has(forbidden)).toBe(false);
    }
  });

  it('expired suggestions cannot be confirmed (TTL is a real contract)', () => {
    const f = facet();
    const s = proposed(f);
    const ledger = new CompanionOwnerLedger(f);
    expect(ledger.decide({
      capability: createOwnerCapability(f.session), suggestionId: s.suggestionId,
      decision: 'confirm', epoch: 1, tick: s.expiresAtTick
    })).toMatchObject({ ok: false, code: 'E_TARGET_DESTROYED' });
    expect(ledger.list()).toHaveLength(0);
  });

  it('EVERY external suggestion kind, including move, stays proposed until a decision', () => {
    const f = facet();
    const ledger = new CompanionOwnerLedger(f);
    for (const kind of COMPANION_SUGGESTION_KINDS) {
      const s = proposed(f, kind);
      expect(s.status).toBe('proposed');
      expect(s.kind).toBe(kind);
    }
    expect(f.pendingSuggestions()).toHaveLength(COMPANION_SUGGESTION_KINDS.length);
    expect(ledger.list(), 'no implicit confirmations').toHaveLength(0);
    expect(COMPANION_LIMITS.SUGGESTION_TTL_TICKS).toBe(600);
  });

  it('snapshot carries necessary state and hard bounds, never hidden state or auth', () => {
    const f = facet();
    const s = proposed(f);
    const snap = f.snapshot();
    expect(snap).toMatchObject({
      session: f.session, epoch: 1, actorId: 1, link: 'connected',
      dedupLimit: COMPANION_LIMITS.MAX_DEDUP_RECORDS,
      suggestionLimit: COMPANION_LIMITS.MAX_UNCONFIRMED,
      suggestionTtlTicks: COMPANION_LIMITS.SUGGESTION_TTL_TICKS,
      memoryTtlTicks: COMPANION_LIMITS.MEMORY_TTL_TICKS
    });
    expect(snap.pending.map((p) => p.suggestionId)).toContain(s.suggestionId);
    expect(snap.pending[0].status).toBe('proposed');
    expect(Object.isFrozen(snap)).toBe(true);
    const text = JSON.stringify(snap);
    for (const hidden of ['seed', 'rngState', 'map', 'capability', 'OWNER_CAPABILITY', 'token']) {
      expect(text).not.toContain(`"${hidden}"`);
    }
    // Diagnostic only: no restore entry point that could re-arm authority.
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(f))).not.toContain('restoreSnapshot');
  });

  it('old epoch and disconnect fallback are visible in the snapshot and block decisions', () => {
    const f = facet();
    proposed(f);
    const cap = createOwnerCapability(f.session);
    const ledger = new CompanionOwnerLedger(f);
    f.rebindEpoch(2);
    expect(ledger.decide({ capability: cap, suggestionId: f.pendingSuggestions()[0]?.suggestionId ?? 'x', decision: 'confirm', epoch: 1, tick: 101 }))
      .toMatchObject({ ok: false });
    expect(f.snapshot()).toMatchObject({ epoch: 2, pending: [] });
    f.setLink('fallback');
    expect(f.snapshot()).toMatchObject({ link: 'fallback', fallbackLabel: 'NO_MODEL' });
  });
});
