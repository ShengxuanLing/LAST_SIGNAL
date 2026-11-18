// Reviewer-only P4 v3 probes (snapshot only; never copied into the repo).
import { describe, expect, it } from 'vitest';
import { HeadlessWorld } from '../ai-native/worldHeadless';
import { canonicalSimulationState, stepSimulationTicks } from '../world/sim/core';

const idle = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false } as any;
const SEEDS = [20261117, 20261118, 20261119];
const rows: any[] = [];
const row = (k: string, v: any) => rows.push({ [k]: v });

function demoWorld(seed = SEEDS[0]) {
  return new HeadlessWorld({ seed, demo: true });
}

describe('P4 v3 probes', () => {
  it('R1 counter-example from v2 is gone: restore keeps the queue AND rebuilds the guard', () => {
    const w = demoWorld();
    w.enableEcho();
    w.runSteps([{ ticks: 2, intent: idle }]);
    const p = w.proposeLocalEcho()!;
    expect(p).not.toBeNull();
    expect(w.confirmLocalEchoProposal(p.id, true)).toBe(true);
    const queued = (w as any).sim.pendingCommands.map((c: any) => c.type);
    const frame: any = JSON.parse(JSON.stringify(w.snapshot()));

    const t = demoWorld();
    const res: any = t.restore(frame);
    const guard: any = t.echoPendingLocal;
    const q0 = (t as any).sim.pendingCommands.map((c: any) => c.type);
    // the exact v2 duplication sequence: propose + confirm immediately after restore
    const immediate = t.proposeLocalEcho();
    const okImmediate = immediate ? t.confirmLocalEchoProposal(immediate.id, true) : false;
    const q1 = (t as any).sim.pendingCommands.map((c: any) => c.type);
    // direct confirm of the SAVED id must also be refused
    const oldId = t.confirmLocalEchoProposal(p.id, true);
    const q2 = (t as any).sim.pendingCommands.map((c: any) => c.type);

    row('r1', {
      restoreOk: res.ok, queued, restoredQueue: q0, guard,
      immediateProposal: immediate ? immediate.kind : null, immediateConfirm: okImmediate,
      queueAfterImmediate: q1, oldIdConfirm: oldId, queueAfterOldId: q2
    });
    expect(res.ok).toBe(true);
    expect(q0, 'queue preserved exactly').toEqual(queued);
    expect(guard, 'guard rebuilt').toMatchObject({ restored: true, proposalId: null });
    expect(immediate, 'no new proposal while busy').toBeNull();
    expect(okImmediate).toBe(false);
    expect(q1, 'no duplicate command possible').toEqual(queued);
    expect(oldId, 'the saved id is not re-executable').toBe(false);
    expect(q2, 'queue still exact').toEqual(queued);
  });

  it('restored action executes exactly once with the real cost (scan 10 / toggle flip 1)', () => {
    // scan
    const w = demoWorld(SEEDS[0]);
    w.enableEcho();
    w.runSteps([{ ticks: 2, intent: idle }]);
    const p = w.proposeLocalEcho()!;
    w.confirmLocalEchoProposal(p.id, true);
    const frame: any = JSON.parse(JSON.stringify(w.snapshot()));
    const t = demoWorld(SEEDS[0]);
    t.restore(frame);
    const e0 = (t.signalView() as any)?.echoEnergy;
    const events = t.runSteps([{ ticks: 1, intent: idle }]);
    const e1 = (t.signalView() as any)?.echoEnergy;
    const scans = events.filter((e) => e.type === 'signal-scanned');
    const auditAfter: any[] = (t as any).echoAudit.recent(32);
    row('scanExec', {
      scans: scans.length, echoEnergy: [e0, e1], cost: e0 !== null && e1 !== null ? e0 - e1 : null,
      busyAfter: t.echoPendingLocal,
      auditResults: auditAfter.map((r: any) => ({ result: r.result, code: r.code ?? null, pid: r.proposalId ?? null })),
      queueAfter: (t as any).sim.pendingCommands.map((c: any) => c.type)
    });
    expect(scans.length, 'exactly one scan').toBe(1);
    expect(e0! - e1!, 'real scan cost').toBe(10);
    expect(t.echoPendingLocal, 'busy cleared after the receipt').toBeNull();
    expect((t as any).sim.pendingCommands, 'queue drained').toHaveLength(0);
    // P2 contract: a restored (unknown-provenance) command must NOT fabricate a
    // human-local applied/enqueued receipt; the guard clears from the REAL event.
    expect(auditAfter.filter((r: any) => r.result === 'applied' || r.result === 'enqueued'),
      'no fabricated human-local receipt for the restored command').toHaveLength(0);
  });

  it('mixed player + echo commands survive a restore and both commit once', () => {
    const w = demoWorld(SEEDS[1]);
    w.enableEcho();
    w.runSteps([{ ticks: 2, intent: idle }]);
    w.enqueueSignalCommand({ type: 'signal-scan', actor: 'player' } as any);
    const p = w.proposeLocalEcho()!;
    expect(w.confirmLocalEchoProposal(p.id, true)).toBe(true);
    const before = (w as any).sim.pendingCommands.map((c: any) => `${c.type}:${c.actor ?? '-'}`);
    const frame: any = JSON.parse(JSON.stringify(w.snapshot()));
    const t = demoWorld(SEEDS[1]);
    t.restore(frame);
    const after = (t as any).sim.pendingCommands.map((c: any) => `${c.type}:${c.actor ?? '-'}`);
    const events = t.runSteps([{ ticks: 1, intent: idle }]);
    row('mixed', { before, after, scans: events.filter((e) => e.type === 'signal-scanned').length, guard: t.echoPendingLocal });
    expect(after, 'both commands preserved with their actor').toEqual(before);
    expect(before).toHaveLength(2);
    expect(events.filter((e) => e.type === 'signal-scanned'), 'both real scans executed').toHaveLength(2);
    expect((t as any).sim.pendingCommands).toHaveLength(0);
  });

  it('a player-only queued scan does NOT mark the echo busy (actor filter), a toggle does', () => {
    const w = demoWorld(SEEDS[2]);
    w.enableEcho();
    w.runSteps([{ ticks: 2, intent: idle }]);
    w.enqueueSignalCommand({ type: 'signal-scan', actor: 'player' } as any);
    const frame: any = JSON.parse(JSON.stringify(w.snapshot()));
    const t = demoWorld(SEEDS[2]);
    t.restore(frame);
    const playerOnlyGuard = t.echoPendingLocal;

    const w2 = demoWorld(SEEDS[2]);
    w2.enableEcho();
    w2.runSteps([{ ticks: 2, intent: idle }]);
    w2.enqueueSignalCommand({ type: 'toggle-relay', enabled: false } as any);
    const f2: any = JSON.parse(JSON.stringify(w2.snapshot()));
    const t2 = demoWorld(SEEDS[2]);
    t2.restore(f2);
    const toggleGuard: any = t2.echoPendingLocal;
    row('actorFilter', { playerOnlyGuard, toggleGuard });
    expect(playerOnlyGuard, 'player-only action is not an echo pending').toBeNull();
    expect(toggleGuard, 'toggle-relay is conservative busy (no actor field)').toMatchObject({ restored: true, proposalId: null, kind: 'toggle-relay' });
  });

  it('fromFrame shares the same contract as fromSimulationState (R2) and replay does not crash', () => {
    const w = demoWorld(SEEDS[0]);
    w.enableEcho();
    w.runSteps([{ ticks: 2, intent: idle }]);
    const p = w.proposeLocalEcho()!;
    w.confirmLocalEchoProposal(p.id, true);
    const frame: any = JSON.parse(JSON.stringify(w.snapshot()));
    const ff = HeadlessWorld.fromFrame(frame, false);
    const fs = HeadlessWorld.fromSimulationState(w.state, [w.demoScenario!.roomId]);
    let threw: string | null = null;
    let guard: any = null;
    try { guard = ff.echoPendingLocal; } catch (e) { threw = (e as Error).message; }
    const ffProposal = ff.proposeLocalEcho();
    const fsProposal = fs.proposeLocalEcho();
    const steps = [{ ticks: 1, intent: idle }];
    const replayW = HeadlessWorld.fromFrame(frame, false);
    replayW.runSteps(steps as any);
    const rp = replayW.replay(frame, steps as any);
    row('fromFrame', {
      threw, guard, ffProposal: ffProposal ? ffProposal.kind : null, fsProposal: fsProposal ? fsProposal.kind : null,
      replayOk: rp.ok, echoRoomGeneration: (ff as any).echoRoomGeneration
    });
    expect(threw, 'fromFrame.echoPendingLocal does not throw').toBeNull();
    expect(guard, 'fromFrame guard matches restore').toMatchObject({ restored: true, proposalId: null });
    expect(ffProposal, 'fromFrame blocks a new proposal like fromSimulationState').toBeNull();
    expect(fsProposal).toBeNull();
    expect(rp.ok, 'replay of a demo frame is deterministic').toBe(true);
  });

  it('a failed restore does not touch the live world, and legacy frames still restore', () => {
    const w = demoWorld(SEEDS[1]);
    stepSimulationTicks((w as any).sim, 3, idle);
    const before = canonicalSimulationState((w as any).sim);
    const auditBefore = (w as any).echoAudit.recent(32).length;
    const bad: any = JSON.parse(JSON.stringify(w.snapshot()));
    bad.sim.authored.routes = { evil: true };
    const res: any = w.restore(bad);
    const after = canonicalSimulationState((w as any).sim);
    row('failedRestore', { ok: res.ok, code: res.code, unchanged: before === after, auditUnchanged: auditBefore === (w as any).echoAudit.recent(32).length });

    const legacy: any = JSON.parse(JSON.stringify(w.snapshot()));
    delete legacy.sim.authored;
    const t = new HeadlessWorld({ seed: SEEDS[1] });
    const lr: any = t.restore(legacy);
    row('legacy', { accepted: lr.ok, routeState: t.routeState, guard: t.echoPendingLocal });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('E_SNAPSHOT_INVALID');
    expect(after, 'live state byte-identical after a rejected frame').toBe(before);
    expect(lr.ok, 'a legacy frame without authored still restores').toBe(true);
    expect(t.routeState).toBeNull();
  });

  it('the old local session cannot leak: stale proposal card, stale id, owner gate, audit cap', () => {
    const w = demoWorld(SEEDS[0]);
    w.enableEcho();
    w.runSteps([{ ticks: 2, intent: idle }]);
    const p = w.proposeLocalEcho()!;
    // do NOT confirm: the restore must drop this stale card
    const frame: any = JSON.parse(JSON.stringify(w.snapshot()));
    const t = demoWorld(SEEDS[0]);
    t.restore(frame);
    const staleCard = (t as any).echoController.localProposal;
    const staleIdConfirm = t.confirmLocalEchoProposal(p.id, true);
    // owner gate: a non-human confirm must be refused (no owner bypass)
    const w2 = demoWorld(SEEDS[1]);
    w2.enableEcho();
    w2.runSteps([{ ticks: 2, intent: idle }]);
    const p2 = w2.proposeLocalEcho()!;
    const ownerRefused = w2.confirmLocalEchoProposal(p2.id, false);
    const ownerQueue = (w2 as any).sim.pendingCommands.map((c: any) => c.type);
    const ownerGuard = w2.echoPendingLocal;
    // audit cap stays bounded
    const audit: any = (t as any).echoAudit;
    for (let i = 0; i < 80; i += 1) audit.record({ tick: i, provenance: 'human-local', action: 'scan', target: null, result: 'enqueued', proposalId: `x_${i}` });
    row('session', {
      staleCard, staleIdConfirm, ownerRefused, ownerQueue, ownerGuard,
      cap: audit.cap, ringLen: audit.recent(200).length
    });
    expect(staleCard, 'the old proposal card is dropped by the restore').toBeNull();
    expect(staleIdConfirm, 'the stale id cannot be confirmed').toBe(false);
    expect(ownerRefused, 'a non-human confirm is refused').toBe(false);
    expect(ownerQueue, 'the owner gate left the queue untouched').toEqual([]);
    expect(ownerGuard, 'the owner gate left no busy marker').toBeNull();
    expect(audit.recent(200).length, 'audit ring respects its cap').toBeLessThanOrEqual(audit.cap);
  });

  it('restore into a USED world: audit history and room generation across the four entry points', () => {
    // source world: confirmed echo action -> audit row(s), generation 0
    const src = demoWorld(SEEDS[0]);
    src.enableEcho();
    src.runSteps([{ ticks: 2, intent: idle }]);
    const p = src.proposeLocalEcho()!;
    src.confirmLocalEchoProposal(p.id, true);
    const frame: any = JSON.parse(JSON.stringify(src.snapshot()));

    // target world that already has its OWN history
    const used = demoWorld(SEEDS[0]);
    used.enableEcho();
    used.runSteps([{ ticks: 2, intent: idle }]);
    const p2 = used.proposeLocalEcho()!;
    used.confirmLocalEchoProposal(p2.id, true);
    used.runSteps([{ ticks: 1, intent: idle }]); // commits, writes applied receipt
    const usedAuditBefore = (used as any).echoAudit.recent(32).map((r: any) => ({ result: r.result, pid: r.proposalId ?? null }));
    (used as any).echoRoomGeneration = 7; // simulate an advanced generation
    const beforeRestoreGen = (used as any).echoRoomGeneration;
    used.restore(frame);
    const usedAuditAfter = (used as any).echoAudit.recent(32).map((r: any) => ({ result: r.result, pid: r.proposalId ?? null }));
    const restoreGen = (used as any).echoRoomGeneration;
    const ff = HeadlessWorld.fromFrame(frame, false);
    const fs = HeadlessWorld.fromSimulationState(src.state, [src.demoScenario!.roomId]);
    row('crossPath', {
      usedAuditBefore, usedAuditAfter, auditKept: JSON.stringify(usedAuditBefore) === JSON.stringify(usedAuditAfter),
      beforeRestoreGen, restoreGen,
      fromFrameGen: (ff as any).echoRoomGeneration, fromStateGen: (fs as any).echoRoomGeneration,
      fromFrameAudit: (ff as any).echoAudit.recent(32).length,
      fromStateAudit: (fs as any).echoAudit.recent(32).length,
      guard: used.echoPendingLocal
    });
    expect(used.echoPendingLocal, 'the guard contract still holds on a used target').toMatchObject({ restored: true, proposalId: null });
  });

  it('log rows', () => { console.log('P4V3_PROBE ' + JSON.stringify(rows)); });
});
