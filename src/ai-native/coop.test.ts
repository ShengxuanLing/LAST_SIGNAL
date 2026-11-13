/**
 * AI-NATIVE-01 P5 — isolated ECHO co-op tests (tightened information/confirmation/snapshot contract).
 *
 * One authoritative SliceModel / shared tick; two actors with independent
 * positions, memory and goals. Pins the minimal legal chain, the refusal path,
 * REAL field-trimmed sharing, actor-scoped companion status, immutable
 * proposals, and the signed/validated isolated snapshot.
 */
import { describe, expect, it } from 'vitest';
import { createCoopSession, CoopManager, offlineEchoPolicy, COOP_SCHEMA, type CoopHypothesis } from './coop';
import { validateObservationDetailed, hasHiddenField, payloadFingerprint } from './protocol';

function coop(budget = 12, extra: Partial<{ humanSensorRange: number; echoSensorRange: number }> = {}) {
  return createCoopSession({
    seed: 7,
    fixture: { test: true, human: { x: 6.5, y: 5.5 }, echo: { x: 6.5, y: 3.5 } },
    echoBudget: budget,
    ...extra,
  });
}
function energyOf(handle: ReturnType<ReturnType<typeof coop>['humanHandle']>): number {
  const r = handle.observe('summary');
  return r.ok ? r.value.current.self.energy : -1;
}
function scanBoth(c: ReturnType<typeof coop>) {
  const h = c.humanHandle();
  const e = c.companionHandle();
  h.scan();
  c.advanceTicks(250);
  e.scan();
  return { h, e };
}

describe('coop actors are independent on one authoritative world', () => {
  it('has distinct actor ids, positions, memory and goals', () => {
    const c = coop();
    const h = c.humanHandle();
    const e = c.companionHandle();
    expect(h.actorId).not.toBe(e.actorId);
    expect(c.status().human.position).not.toEqual(c.status().echo.position);
    h.scan();
    c.advanceTicks(250);
    e.scan();
    const status = c.status();
    expect(status.human.memory).toBeGreaterThan(0);
    expect(status.echo.memory).toBeGreaterThan(0);
    const prop = e.propose({ kind: 'jam' }, 'jam the receiver', 0.8, 0.2);
    expect(prop.ok).toBe(true);
    expect(c.status().echo.goal).toBeNull();
    if (prop.ok) h.confirm(prop.value.id);
    expect(c.status().echo.goal).toBe('jam the receiver');
  });

  it('same tick / same world: an ECHO jam opens the door the human can see and use', () => {
    const c = coop();
    const { h, e } = scanBoth(c);
    const prop = e.propose({ kind: 'jam' }, 'open the door', 0.8, 0.2);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    expect(h.confirm(prop.value.id).ok).toBe(true);
    const echoBefore = { ...c.status().echo.position };
    expect(e.execute(prop.value.id).ok).toBe(true);
    const afterJam = h.observe('summary');
    expect(afterJam.ok && afterJam.value.current.publicDeviceState.doorPassable).toBe(true);
    const humanBefore = { ...c.status().human.position };
    h.move('east', 60);
    expect(c.status().human.position).not.toEqual(humanBefore);
    expect(c.status().echo.position).toEqual(echoBefore);
    const final = h.observe('summary');
    expect(final.ok && final.value.current.self.passed).toBe(true);
  });
});

describe('per-actor incomplete information and REAL field-trimmed share', () => {
  it('human sees A, ECHO sees B, and neither sees the other private evidence before a share', () => {
    const c = coop();
    const { h, e } = scanBoth(c);
    const human = h.observe('standard');
    const echo = e.observe('standard');
    expect(human.ok && echo.ok).toBe(true);
    if (!human.ok || !echo.ok) return;
    expect(human.value.evidence.map((x) => x.targetId)).toEqual(['tgt_lab_door_receiver']);
    expect(echo.value.evidence.map((x) => x.targetId)).toEqual(['tgt_lab_seal_source']);
    expect(echo.value.evidence.some((x) => x.targetId === 'tgt_lab_door_receiver')).toBe(false);
  });

  it('shares only the selected fields; unselected relationId/stateLabel/position never leak', () => {
    // A wide sensor so the human's evidence carries a relation; then share only stateLabel.
    const c = coop(12, { humanSensorRange: 12, echoSensorRange: 1.5 });
    const h = c.humanHandle();
    const e = c.companionHandle();
    h.scan();
    c.advanceTicks(250);
    e.scan();
    expect(h.share(['tgt_lab_door_receiver'], ['stateLabel']).ok).toBe(true);
    const echo = e.observe('standard');
    expect(echo.ok).toBe(true);
    if (!echo.ok) return;
    const shared = echo.value.evidence.find((x) => x.targetId === 'tgt_lab_door_receiver');
    expect(shared?.observedState.stateLabel).toBe('receiver-visible');
    const target = echo.value.current.visibleTargets.find((t) => t.targetId === 'tgt_lab_door_receiver');
    expect(target?.position).toBeUndefined(); // position not selected -> not projected
    // relationId not selected -> no relation/knownConnection from the shared evidence
    expect(echo.value.evidence.some((x) => x.relationId === 'rel_lab_seal_link')).toBe(false);
    expect(echo.value.current.knownConnections.some((k) => k.relationId === 'rel_lab_seal_link')).toBe(false);
  });

  it('sharing the relationId field does project the relation; empty/unknown fields are rejected', () => {
    const c = coop(12, { humanSensorRange: 12, echoSensorRange: 1.5 });
    const h = c.humanHandle();
    const e = c.companionHandle();
    h.scan();
    c.advanceTicks(250);
    e.scan();
    expect(h.share(['tgt_lab_door_receiver'], ['stateLabel', 'relationId', 'position']).ok).toBe(true);
    const echo = e.observe('standard');
    expect(echo.ok).toBe(true);
    if (echo.ok) {
      expect(echo.value.current.knownConnections.some((k) => k.relationId === 'rel_lab_seal_link')).toBe(true);
      const target = echo.value.current.visibleTargets.find((t) => t.targetId === 'tgt_lab_door_receiver');
      expect(target?.position).toEqual({ x: 6.5, y: 5.5 }); // selected position IS projected
    }
    const empty = h.share(['tgt_lab_door_receiver'], []);
    expect(empty.ok ? null : empty.code).toBe('E_SCHEMA');
    const unknown = h.share(['tgt_lab_door_receiver'], ['notAField']);
    expect(unknown.ok ? null : unknown.code).toBe('E_SCHEMA');
  });

  it('ECHO shares its own evidence to the human with real trimming (no hidden state)', () => {
    const c = coop();
    const { h, e } = scanBoth(c);
    expect(e.share(['tgt_lab_seal_source'], ['stateLabel', 'position']).ok).toBe(true);
    const human = h.observe('standard');
    expect(human.ok).toBe(true);
    if (!human.ok) return;
    const shared = human.value.evidence.find((x) => x.targetId === 'tgt_lab_seal_source');
    expect(shared?.observerActorId).toBe(e.actorId);
    expect(shared?.observedState.stateLabel).toBe('carrier-visible');
    expect(validateObservationDetailed(human.value).ok).toBe(true);
    expect(hasHiddenField(human.value, ['role'])).toBeNull();
  });
});

describe('COMPANION status is actor-scoped (no human private fields)', () => {
  it('never exposes human position/goal/evidence/memory', () => {
    const c = coop();
    const h = c.humanHandle();
    const e = c.companionHandle();
    h.scan();
    c.advanceTicks(250);
    e.scan();
    const status = e.status();
    expect(status.humanActorId).toBe(h.actorId);
    expect((status as unknown as Record<string, unknown>).human).toBeUndefined();
    expect(status.echo.evidenceTargets).toEqual(['tgt_lab_seal_source']);
    expect(status.echo.sharedTargets).toEqual([]);
    // the human's private evidence/position/goal/memory must not appear
    const text = JSON.stringify(status);
    expect(text).not.toContain('tgt_lab_door_receiver');
  });
});

describe('hypotheses never auto-canonical and are immutable', () => {
  it('deep-freezes the plan so external mutation cannot change the confirmed action', () => {
    const c = coop();
    const h = c.humanHandle();
    const e = c.companionHandle();
    const plan = { kind: 'jam' as const };
    const prop = e.propose(plan, 'jam the receiver', 0.7, 0.3);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    (plan as { kind: string }).kind = 'scan'; // mutate the caller's plan afterwards
    expect(prop.value.action.kind).toBe('jam');
    expect(() => { (prop.value.action as { kind: string }).kind = 'scan'; }).toThrow();
    const confirmed = h.confirm(prop.value.id);
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.value.status).toBe('confirmed');
      expect(() => { (confirmed.value.action as { kind: string }).kind = 'scan'; }).toThrow();
    }
    expect(c.status().echo.hypotheses[0].status).toBe('confirmed');
  });

  it('stays proposed until confirm; P0 observation keeps hypotheses empty; offline policy reproducible', () => {
    const c = coop();
    const h = c.humanHandle();
    const e = c.companionHandle();
    const prop = e.propose({ kind: 'jam' }, 'jam the receiver', 0.7, 0.3);
    expect(prop.ok && prop.value.status).toBe('proposed');
    const obs = e.observe('standard');
    expect(obs.ok && obs.value.hypotheses).toEqual([]);
    h.scan();
    c.advanceTicks(250);
    e.scan();
    const obs2 = e.observe('standard');
    expect(obs2.ok).toBe(true);
    if (obs2.ok) {
      const a = offlineEchoPolicy(obs2.value, []);
      const b = offlineEchoPolicy(obs2.value, []);
      expect(a).toEqual(b);
    }
  });
});

describe('permission boundaries and zero-side-effect refusal', () => {
  it('unconfirmed/rejected execution and ECHO management have zero side effects', () => {
    const c = coop();
    const h = c.humanHandle();
    const e = c.companionHandle();
    const prop = e.propose({ kind: 'jam' }, 'jam', 0.8, 0.2);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    const energyBefore = energyOf(h);
    const doorBefore = c.status();
    expect(e.execute(prop.value.id).ok).toBe(false);
    expect(energyOf(h)).toBe(energyBefore);
    expect(c.status().human.position).toEqual(doorBefore.human.position);
    h.reject(prop.value.id);
    expect(e.execute(prop.value.id).ok).toBe(false);
    expect(energyOf(h)).toBe(energyBefore);
    for (const action of ['pause', 'resume', 'takeover', 'release'] as const) expect(e.management(action).ok).toBe(false);
  });

  it('pause / takeover stop ECHO while the human keeps control; budget/cancel/link enforced', () => {
    const c = coop(1);
    const h = c.humanHandle();
    const e = c.companionHandle();
    h.pause();
    const paused = e.scan();
    expect(paused.ok ? null : paused.code).toBe('E_PAUSED');
    h.resume();
    h.takeover();
    const taken = e.move('east', 5);
    expect(taken.ok).toBe(false);
    expect(h.move('east', 2).ok).toBe(true);
    h.release();
    const first = e.scan();
    expect(first.ok).toBe(true);
    const overBudget = e.scan();
    expect(overBudget.ok ? null : overBudget.code).toBe('E_RESOURCE_LIMIT');
    c.cancelEcho();
    const cancelled = e.scan();
    expect(cancelled.ok).toBe(false);
  });
});

describe('shared-rule ECHO movement/scan and resources', () => {
  it('ECHO moves only itself using the shared collision geometry', () => {
    const c = coop();
    const e = c.companionHandle();
    const humanBefore = { ...c.status().human.position };
    const before = { ...c.status().echo.position };
    expect(e.move('east', 20).ok).toBe(true);
    expect(c.status().echo.position.x).toBeGreaterThan(before.x);
    expect(c.status().human.position).toEqual(humanBefore);
  });

  it('ECHO scan uses the same energy/cooldown rule as the human', () => {
    const c = coop();
    const h = c.humanHandle();
    const e = c.companionHandle();
    const before = energyOf(h);
    expect(e.scan().ok).toBe(true);
    expect(energyOf(h)).toBe(before - 10);
  });
});

describe('isolated signed snapshot', () => {
  it('round-trips, is repeatable, is atomic and bumps epoch monotonically', () => {
    const c = coop();
    const { h, e } = scanBoth(c);
    const before = c.status();
    const snap = c.snapshot();
    expect(snap.schema).toBe(COOP_SCHEMA);
    h.move('east', 30);
    expect(c.status().tick).toBeGreaterThan(before.tick);
    const first = c.restore(snap);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.tick).toBe(before.tick);
    const epoch1 = c.status().epoch;
    const second = c.restore(snap); // repeated restore of the same issued frame is allowed
    expect(second.ok).toBe(true);
    expect(c.status().epoch).toBeGreaterThan(epoch1);
    void e;
  });

  it('rejects tampered content, unknown schema/version, missing state and cross-instance frames atomically', () => {
    const a = coop();
    const b = coop();
    const { h } = scanBoth(a);
    void h;
    const frame = a.snapshot() as Record<string, unknown>;
    const before = a.status();
    const restoreRaw = (f: unknown) => a.restore(f);

    const tamperBudget = JSON.parse(JSON.stringify(frame));
    tamperBudget.state.echoBudget = 999;
    const budgetRes = restoreRaw(tamperBudget);
    expect(budgetRes.ok ? null : budgetRes.code).toBe('E_SNAPSHOT_INVALID');
    const tamperHyp = JSON.parse(JSON.stringify(frame));
    if (Array.isArray(tamperHyp.state.hypotheses) && tamperHyp.state.hypotheses.length > 0) {
      tamperHyp.state.hypotheses[0].status = 'confirmed';
    } else {
      tamperHyp.state.unknown = true;
    }
    expect(restoreRaw(tamperHyp).ok).toBe(false);
    const tamperPos = JSON.parse(JSON.stringify(frame));
    tamperPos.state.echo.position.x = 999;
    expect(restoreRaw(tamperPos).ok).toBe(false);
    expect(restoreRaw({ ...frame, schema: 'other' }).ok).toBe(false);
    expect(restoreRaw({ ...frame, version: 999 }).ok).toBe(false);
    const missing = JSON.parse(JSON.stringify(frame));
    delete missing.state;
    expect(restoreRaw(missing).ok).toBe(false);
    expect(b.restore(frame).ok).toBe(false); // another instance's frame
    // atomic: no failed restore changed our state
    expect(a.status()).toEqual(before);
  });

  it('restore removes a confirmation made after the snapshot so old plans cannot execute', () => {
    const c = coop();
    const { h, e } = scanBoth(c);
    const prop = e.propose({ kind: 'jam' }, 'jam', 0.8, 0.2);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    const snap = c.snapshot(); // hypothesis is still proposed here
    expect(h.confirm(prop.value.id).ok).toBe(true);
    expect(c.restore(snap).ok).toBe(true);
    const after = c.status().echo.hypotheses.find((x) => x.id === prop.value.id);
    expect(after?.status).toBe('proposed');
    expect(e.execute(prop.value.id).ok).toBe(false); // not confirmed after restore
  });
});

describe('instance identity and full-payload snapshot authorization', () => {
  it('two same-seed instances each scan/issue, then their frames are mutually rejected with no state change', () => {
    const a = coop();
    const b = coop();
    const { h: ha } = scanBoth(a);
    scanBoth(b);
    void ha;
    const fa = a.snapshot();
    const fb = b.snapshot();
    const beforeA = a.status();
    const beforeB = b.status();
    expect(b.restore(fa).ok ? null : (b.restore(fa) as { code: string }).code).toBe('E_SNAPSHOT_INVALID');
    expect(a.restore(fb).ok).toBe(false);
    expect(a.status()).toEqual(beforeA);
    expect(b.status()).toEqual(beforeB);
  });

  it('forged snapshotId/instanceId/sessionId and a recomputed public hash are rejected', () => {
    const c = coop();
    scanBoth(c);
    const frame = c.snapshot() as Record<string, unknown>;
    const before = c.status();
    const restore = (f: unknown) => c.restore(f);
    const forgedId = JSON.parse(JSON.stringify(frame));
    forgedId.snapshotId = 'csnap_forged';
    expect(restore(forgedId).ok).toBe(false);
    const forgedInstance = JSON.parse(JSON.stringify(frame));
    forgedInstance.instanceId = 'inst_forged';
    expect(restore(forgedInstance).ok).toBe(false);
    const forgedSession = JSON.parse(JSON.stringify(frame));
    forgedSession.sessionId = 'ses_ffffffffffffffffffffffff';
    expect(restore(forgedSession).ok).toBe(false);
    // Tamper a field AND recompute the public hash: authorization still uses the
    // full issued canonical payload, so this must be rejected.
    const tampered = JSON.parse(JSON.stringify(frame));
    tampered.state.echoBudget = 3;
    const { snapshotId: _id, publicHash: _h, ...payload } = tampered;
    void _id; void _h;
    tampered.publicHash = payloadFingerprint(payload);
    expect(restore(tampered).ok ? null : (restore(tampered) as { code: string }).code).toBe('E_SNAPSHOT_INVALID');
    expect(c.status()).toEqual(before);
  });

  it('dual-actor state (positions/evidence/shared/memory/hypotheses) is fully restored without alias', () => {
    const c = coop();
    const { h, e } = scanBoth(c);
    expect(e.share(['tgt_lab_seal_source'], ['stateLabel']).ok).toBe(true);
    const prop = e.propose({ kind: 'jam' }, 'jam', 0.8, 0.2);
    expect(prop.ok).toBe(true);
    const before = c.status();
    const frame = c.snapshot();
    h.move('east', 30);
    e.move('north', 5);
    expect(c.status().tick).toBeGreaterThan(before.tick);
    expect(c.restore(frame).ok).toBe(true);
    const after = c.status();
    expect(after.human.position).toEqual(before.human.position);
    expect(after.echo.position).toEqual(before.echo.position);
    expect(after.echo.evidenceTargets).toEqual(before.echo.evidenceTargets);
    expect(after.echo.sharedTargets).toEqual(before.echo.sharedTargets);
    expect(after.echo.hypotheses).toEqual(before.echo.hypotheses);
    // No alias: mutating the frame after restore does not change the session.
    (frame.state as { echo: { memory: unknown[] } }).echo.memory.push({ kind: 'scan', tick: 0, detail: 'tamper' });
    expect(c.status().echo.memory).toBe(before.echo.memory);
  });

  it('eviction is explicit and repeated valid restore works', () => {
    const c = coop();
    scanBoth(c);
    const handles: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 65; i += 1) handles.push(c.snapshot());
    // The oldest issued frame was evicted (cap 64).
    expect(c.restore(handles[0]).ok).toBe(false);
    expect(c.restore(handles[handles.length - 1]).ok).toBe(true);
    expect(c.restore(handles[handles.length - 1]).ok).toBe(true); // repeated restore of a valid frame
  });
});

describe('CoopManager hard limit and cleanup', () => {
  it('caps at 10 sessions and frees on close', () => {
    const manager = new CoopManager();
    const fixture = { test: true as const, human: { x: 6.5, y: 5.5 }, echo: { x: 6.5, y: 3.5 } };
    const handles: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const res = manager.create({ seed: i, fixture });
      expect(res.ok).toBe(true);
      if (res.ok) handles.push(res.value.handle);
    }
    const over = manager.create({ seed: 99, fixture });
    expect(over.ok ? null : over.code).toBe('E_RESOURCE_LIMIT');
    expect(manager.close(handles[0])).toBe(true);
    expect(manager.create({ seed: 100, fixture }).ok).toBe(true);
    manager.dispose();
    expect(manager.size).toBe(0);
  });
});
