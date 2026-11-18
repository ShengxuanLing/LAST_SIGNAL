// GAMEPLAY-01 · P4 — headless restore / raw-frame probes for the review's R1/R2.
//
// NODE-side model tests (no browser, no product source change). They assert the
// CONTRACT the owner surface needs (docs/gameplay/P4_RESTORE_CONTRACT.V3.md §2):
//
//   for a queued echo scan/jam or an unknown-provenance toggle-relay, EVERY
//   owner-restore entry point must produce the same conservative busy guard:
//     echoPendingLocal = { restored: true, proposalId: null, kind }
//     proposeLocalEcho() === null
//     confirmLocalEchoProposal(anyId, true) === false  + a rejected
//     E_ALREADY_PENDING audit row (never applied/enqueued human-local)
//     the core queue stays byte-exact,
//     the original command commits exactly once on the next real tick,
//     then the guard clears by its real receipt (no deadlock).
//
// Entry points: fromSimulationState, restore(frame), fromFrame(frame), replay().
// A RunCheckpoint is a DIFFERENT contract (it intentionally drops uncommitted
// commands at a safe point) and is asserted in the rendered P4 spec instead.

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HeadlessWorld } from '../src/ai-native/worldHeadless';

const BASE = path.resolve(process.env.LS_P4_DIR ?? 'reports/gameplay-01/tester/p4-final/run1');
const SEEDS = [20261117, 20261118, 20261119] as const;
const COST: Record<string, number> = { scan: 10, jam: 25 };

function rec(name: string, data: unknown): void {
  const dir = path.join(BASE, 'evidence');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 2));
}

/** Real session with exactly one confirmed local Signal command in flight. */
function sessionWithPending(seed: number) {
  const hw = new HeadlessWorld({ seed, demo: true, echoAutonomy: false });
  hw.enableEcho();
  hw.runSteps([{ ticks: 1, intent: null }]);
  let proposal = hw.proposeLocalEcho();
  if (!proposal) proposal = hw.proposeLocalEcho();
  if (!proposal) return { hw, proposal: null, accepted: false, queue: [] as string[] };
  const accepted = hw.confirmLocalEchoProposal(proposal.id);
  const queue = hw.state.pendingCommands.map((c) => c.type);
  return { hw, proposal, accepted, queue };
}

/** The shared contract check for one restored world and one frame. */
function checkContract(world: HeadlessWorld, label: string, frameQueue: string[], rows: any[], recName?: string) {
  const pending = world.echoPendingLocal;
  const propose = world.proposeLocalEcho();
  const directConfirm = world.confirmLocalEchoProposal('probe_second_confirm_never_real', true);
  const queueAfter = world.state.pendingCommands.map((c) => c.type);
  const audit = world.echoAudit.recent(32).map((e) => ({
    kind: e.action, result: e.result, code: e.code ?? null, proposalId: e.proposalId, provenance: e.provenance
  }));
  const before = world.signalView();
  const beforeEnergy = { player: (before as any)?.playerEnergy ?? null, echo: (before as any)?.echoEnergy ?? null };
  const events = world.runSteps([{ ticks: 4, intent: null }]);
  const after = world.signalView();
  const afterEnergy = { player: (after as any)?.playerEnergy ?? null, echo: (after as any)?.echoEnergy ?? null };
  const commits = events.filter((e) => e.type === 'signal-scanned' || e.type === 'signal-jammed');
  const toggles = events.filter((e) => e.type === 'signal-relay-changed');
  const kind = pending?.kind ?? null;
  const row = {
    entry: label,
    frameQueue,
    pendingAfter: pending && { kind: pending.kind, restored: pending.restored, proposalId: pending.proposalId ?? null },
    proposeAfter: propose && { id: propose.id, kind: propose.kind },
    directConfirmAccepted: directConfirm,
    queueAfterQueue: queueAfter,
    audit,
    beforeEnergy, afterEnergy,
    commits: commits.map((e: any) => ({ type: e.type, actorId: e.actorId, ok: e.ok !== false, energy: e.energy ?? null, code: e.code ?? null })),
    toggles: toggles.map((e: any) => ({ relay: e.relay, manualEnabled: e.manualEnabled })),
    pendingAfterCommit: world.echoPendingLocal,
    appliedHumanLocalRows: world.echoAudit.recent(32)
      .filter((e) => e.result === 'applied' && e.provenance === 'human-local' && !e.proposalId).length
  };
  rows.push(row);
  // Persist the measured facts before asserting so a failing run still archives them.
  if (recName) rec(recName, { entry: label, row });

  expect(pending, `${label}: the conservative busy guard exists after the restore`).not.toBeNull();
  expect(pending!.restored, `${label}: the guard is marked as restored`).toBe(true);
  expect(pending!.proposalId ?? null, `${label}: no proposal id is invented`).toBeNull();
  expect(propose, `${label}: proposeLocalEcho is blocked while the guard is set`).toBeNull();
  expect(directConfirm, `${label}: a direct second confirm is refused`).toBe(false);
  expect(audit.some((a) => a.result === 'rejected' && a.code === 'E_ALREADY_PENDING'),
    `${label}: the refusal is an E_ALREADY_PENDING rejection row`).toBe(true);
  expect(queueAfter.length, `${label}: the core queue is unchanged (no extra command)`).toBe(frameQueue.length);
  if (kind === 'scan' || kind === 'jam') {
    expect(commits.length, `${label}: the queued ${kind} commits exactly once on a real tick`).toBe(1);
    const e: any = commits[0];
    expect(e.ok, `${label}: the commit was accepted`).toBe(true);
    const actorEnergy = e.actorId === -2 ? 'echo' : 'player';
    const actorBefore = (beforeEnergy as any)[actorEnergy];
    // Exact cost from the committed event payload (never a post-sample net delta).
    expect(actorBefore - e.energy, `${label}: the ${kind} costs exactly ${COST[kind]} (event payload)`).toBe(COST[kind]);
    row.exactCost = { actor: actorEnergy, before: actorBefore, eventEnergy: e.energy, actualCost: actorBefore - e.energy, netDelta: actorBefore - (afterEnergy as any)[actorEnergy] };
  }
  if (kind === 'toggle-relay') {
    expect(toggles.length, `${label}: the queued relay toggle commits exactly once`).toBe(1);
  }
  expect(world.echoPendingLocal, `${label}: the guard clears by its real receipt (no deadlock)`).toBeNull();
  expect(row.appliedHumanLocalRows, `${label}: no fabricated applied human-local row`).toBe(0);
  if (recName) rec(recName + '-final', { entry: label, row });
  return row;
}

for (const seed of SEEDS) {
  test(`R1 · snapshot -> restore(frame) keeps one pending guard (seed ${seed})`, async () => {
    test.setTimeout(120000);
    const rows: any[] = [];
    const s = sessionWithPending(seed);
    expect(s.proposal, `seed ${seed}: a real local proposal exists to confirm`).not.toBeNull();
    expect(s.accepted, `seed ${seed}: the real boundary accepted the confirmation`).toBe(true);
    expect(s.queue.length, `seed ${seed}: exactly one command is queued after the confirm`).toBe(1);
    expect(s.hw.echoPendingLocal, `seed ${seed}: a real pending exists before the snapshot`).not.toBeNull();
    const frame = s.hw.snapshot();
    const frameQueue = (frame.sim as any).pendingCommands.map((c: any) => c.type);
    expect(frameQueue.length, `seed ${seed}: the mid-execution frame carries the command`).toBe(1);
    const resumed = new HeadlessWorld({ seed, demo: true, echoAutonomy: false });
    const restore = resumed.restore(frame);
    expect(restore.ok, `seed ${seed}: restore accepted the frame`).toBe(true);
    const row = checkContract(resumed, `restore(frame) seed ${seed}`, frameQueue, rows, 'p4-r1-restore-single-pending');
    rec('p4-r1-restore-single-pending-summary', { seed, kind: s.proposal.kind, entry: 'restore(frame)', row });
  });

  test(`R2 · fromFrame keeps the same guard and a readable pending projection (seed ${seed})`, async () => {
    test.setTimeout(120000);
    const rows: any[] = [];
    const s = sessionWithPending(seed);
    const frame = s.hw.snapshot();
    const frameQueue = (frame.sim as any).pendingCommands.map((c: any) => c.type);
    const loaded = HeadlessWorld.fromFrame(frame);
    const row = checkContract(loaded, `fromFrame(frame) seed ${seed}`, frameQueue, rows, 'p4-r2-fromframe-pending');
    rec('p4-r2-fromframe-pending-summary', { seed, kind: s.proposal?.kind ?? null, entry: 'fromFrame(frame)', row });
  });
}

test('R2b · replay() inherits the same guard (it builds its world with fromFrame)', async () => {
  test.setTimeout(120000);
  const rows: any[] = [];
  for (const seed of SEEDS) {
    const s = sessionWithPending(seed);
    const frame = s.hw.snapshot();
    const replayWorld = HeadlessWorld.fromFrame(frame);
    const pending = replayWorld.echoPendingLocal;
    const propose = replayWorld.proposeLocalEcho();
    rows.push({
      seed,
      pending: pending && { kind: pending.kind, restored: pending.restored },
      propose: propose ? { id: propose.id, kind: propose.kind } : null,
      routeState: replayWorld.routeState
    });
    expect(pending, `seed ${seed}: the replay world carries the restored guard`).not.toBeNull();
    expect(pending!.restored, `seed ${seed}: replay guard is conservative`).toBe(true);
    expect(propose, `seed ${seed}: replay world cannot propose over the guard`).toBeNull();
  }
  rec('p4-r2b-replay-guard', { rows });
});
