// GAMEPLAY-01 P4 v3 / R1+R2 — every RESTORE entry point must keep the P2
// single-pending contract: a queued echo scan/jam or relay toggle with unknown
// provenance produces a CONSERVATIVE busy guard (restored:true, no proposalId),
// never a fabricated human-local receipt, and never removes other actors' queued
// commands. This file is written FIRST (red) against the v2 bytes.
import { describe, expect, it } from 'vitest';
import {
  HeadlessWorld, NEUTRAL_INTENT, isHeadlessFrame
} from './worldHeadless';
import type { HeadlessWorldFrame } from './worldHeadless';

const SEED = 20261117;

interface Armed {
  world: HeadlessWorld;
  frame: HeadlessWorldFrame;
  proposalId: string | null;
  queuedTypes: string[];
}

/** Real P2 flow: enable echo, owner-fixture confirm a local scan, snapshot
 *  BEFORE the core tick consumes the command. */
function armedScan(): Armed {
  const world = new HeadlessWorld({ seed: SEED, demo: true });
  world.enableEcho();
  world.runSteps([{ ticks: 2, intent: NEUTRAL_INTENT }]);
  const proposal = world.proposeLocalEcho();
  if (!proposal || proposal.kind !== 'scan') throw new Error('no scan proposal in fixture');
  if (!world.confirmLocalEchoProposal(proposal.id, true)) throw new Error('confirm failed');
  return {
    world, frame: world.snapshot(), proposalId: proposal.id,
    queuedTypes: world.state.pendingCommands.map((c) => c.type)
  };
}

/** One manual relay toggle queued (human R), snapshot before commit. */
function armedToggle(): Armed {
  const world = new HeadlessWorld({ seed: SEED, demo: true });
  world.enableEcho();
  world.runSteps([{ ticks: 2, intent: NEUTRAL_INTENT }]);
  world.enqueueSignalCommand({ type: 'toggle-relay', enabled: false });
  return {
    world, frame: world.snapshot(), proposalId: null,
    queuedTypes: world.state.pendingCommands.map((c) => c.type)
  };
}

function auditRows(world: HeadlessWorld) {
  return world.echoAudit.recent(32);
}

describe('R1 — frame restore() preserves the conservative single-pending guard', () => {
  for (const [label, arm] of [['scan', armedScan], ['toggle', armedToggle]] as const) {
    it(`${label}: guard is rebuilt, no second command can be confirmed, receipt clears it`, () => {
      const { frame, proposalId, queuedTypes } = arm();
      expect(queuedTypes).toHaveLength(1);

      const restored = new HeadlessWorld({ seed: SEED, demo: true });
      expect(restored.restore(frame).ok).toBe(true);
      const rowsAfterRestore = auditRows(restored);
      expect(rowsAfterRestore.length, 'restore itself writes NO audit row').toBe(0);
      if (proposalId) expect(rowsAfterRestore.some((r) => r.proposalId === proposalId)).toBe(false);

      // The exact core queue survives; it is never deleted to fix the guard.
      expect(restored.state.pendingCommands.map((c) => c.type)).toEqual(queuedTypes);
      const guard = restored.echoPendingLocal;
      expect(guard, 'R1: a queued unknown-provenance signal must mark busy').not.toBeNull();
      expect(guard!.restored).toBe(true);
      expect(guard!.proposalId).toBeNull();
      expect(guard!.kind).toBe(label === 'scan' ? 'scan' : 'toggle-relay');

      // No suggestion and no second confirmation of the old (or any) id.
      expect(restored.proposeLocalEcho()).toBeNull();
      if (proposalId) expect(restored.confirmLocalEchoProposal(proposalId, true)).toBe(false);
      // The ONLY new row is the honest rejection of the second confirmation —
      // never an applied/enqueued row for the unknown restored command.
      const rowsAfterConfirm = auditRows(restored);
      if (proposalId) {
        expect(rowsAfterConfirm.length).toBe(1);
        expect(rowsAfterConfirm[0]).toMatchObject({ result: 'rejected', code: 'E_ALREADY_PENDING' });
        expect(rowsAfterConfirm.some((r) => r.result === 'applied' || r.result === 'enqueued')).toBe(false);
      } else {
        expect(rowsAfterConfirm.length, 'no confirm attempt => no audit row').toBe(0);
      }

      // One real tick: the ORIGINAL command commits exactly once.
      const before = restored.signalView();
      const events = restored.runSteps([{ ticks: 1, intent: NEUTRAL_INTENT }]);
      expect(restored.state.pendingCommands).toHaveLength(0);
      if (label === 'scan') {
        expect(events.filter((e) => e.type === 'signal-scanned')).toHaveLength(1);
        const after = restored.signalView();
        expect((before?.echoEnergy as number) - (after?.echoEnergy as number)).toBe(10);
      } else {
        expect(events.filter((e) => e.type === 'signal-relay-changed')).toHaveLength(1);
        expect(before?.relay).toBe('ACTIVE');
        expect(restored.signalView()?.relay).toBe('INACTIVE');
      }
      // Guard cleared by the real receipt, so the human can propose again.
      expect(restored.echoPendingLocal).toBeNull();
      expect(restored.proposeLocalEcho()).not.toBeNull();
      if (proposalId) {
        expect(auditRows(restored).filter((r) => r.proposalId === proposalId &&
          (r.result === 'applied' || r.result === 'enqueued'))).toHaveLength(0);
      }
    });
  }

  it('does not delete other actors\' queued commands (mixed player + echo scan)', () => {
    const world = new HeadlessWorld({ seed: SEED, demo: true });
    world.enableEcho();
    world.runSteps([{ ticks: 2, intent: NEUTRAL_INTENT }]);
    world.enqueueSignalCommand({ type: 'signal-scan', actor: 'player' });
    const proposal = world.proposeLocalEcho()!;
    expect(world.confirmLocalEchoProposal(proposal.id, true)).toBe(true);
    const beforeTypes = world.state.pendingCommands.map((c) => `${c.type}:${(c as any).actor ?? '-'}`);
    expect(beforeTypes).toHaveLength(2);

    const frame = world.snapshot();
    const restored = new HeadlessWorld({ seed: SEED, demo: true });
    expect(restored.restore(frame).ok).toBe(true);
    expect(restored.state.pendingCommands.map((c) => `${c.type}:${(c as any).actor ?? '-'}`)).toEqual(beforeTypes);
    expect(restored.echoPendingLocal?.restored).toBe(true);
    expect(restored.proposeLocalEcho()).toBeNull();

    const events = restored.runSteps([{ ticks: 1, intent: NEUTRAL_INTENT }]);
    expect(events.filter((e) => e.type === 'signal-scanned')).toHaveLength(2);
    expect(restored.state.pendingCommands).toHaveLength(0);
  });
});

describe('R2 — fromFrame() initialises the same P2 runtime and guard', () => {
  for (const [label, arm] of [['scan', armedScan], ['toggle', armedToggle]] as const) {
    it(`${label}: echoPendingLocal is readable, proposal is blocked, runSteps commits once`, () => {
      const { frame, queuedTypes, proposalId } = arm();
      expect(isHeadlessFrame(frame)).toBe(true);
      const fromFrame = HeadlessWorld.fromFrame(frame, false);
      expect(() => fromFrame.echoPendingLocal).not.toThrow();
      expect(fromFrame.echoPendingLocal?.restored).toBe(true);
      expect(fromFrame.echoPendingLocal?.proposalId).toBeNull();
      expect(fromFrame.proposeLocalEcho()).toBeNull();
      if (proposalId) expect(fromFrame.confirmLocalEchoProposal(proposalId, true)).toBe(false);
      expect(fromFrame.state.pendingCommands.map((c) => c.type)).toEqual(queuedTypes);
      expect(() => fromFrame.runSteps([{ ticks: 1, intent: NEUTRAL_INTENT }])).not.toThrow();
      expect(fromFrame.state.pendingCommands).toHaveLength(0);
      expect(fromFrame.echoPendingLocal).toBeNull();
      expect(() => fromFrame.echoPendingLocal).not.toThrow();
    });
  }

  it('fromSimulationState keeps the SAME contract as restore/fromFrame', () => {
    const { frame, world, proposalId } = armedScan();
    const routes = [world.demoScenario!.roomId];
    const fromState = HeadlessWorld.fromSimulationState(world.state, routes);
    expect(fromState.echoPendingLocal?.restored).toBe(true);
    expect(fromState.echoPendingLocal?.proposalId).toBeNull();
    expect(fromState.proposeLocalEcho()).toBeNull();
    if (proposalId) expect(fromState.confirmLocalEchoProposal(proposalId, true)).toBe(false);
    const restored = new HeadlessWorld({ seed: SEED, demo: true });
    restored.restore(frame);
    expect(fromState.echoPendingLocal).toEqual(restored.echoPendingLocal);
    expect(HeadlessWorld.fromFrame(frame, false).echoPendingLocal).toEqual(restored.echoPendingLocal);
  });

  it('replay (which uses fromFrame internally) does not crash on a guarded frame', () => {
    const { frame } = armedToggle();
    const live = new HeadlessWorld({ seed: SEED, demo: true });
    expect(live.restore(frame).ok).toBe(true);
    live.runSteps([{ ticks: 1, intent: NEUTRAL_INTENT }]);
    const result = live.replay(frame, [{ ticks: 1, intent: NEUTRAL_INTENT }]);
    expect(result.ok).toBe(true);
    expect(result.sameState).toBe(true);
    expect(result.sameEvents).toBe(true);
  });
});

describe('R1/R2 — old frames and echo-less worlds stay compatible', () => {
  it('a frame with no echo / no queued signal has a null guard everywhere', () => {
    const world = new HeadlessWorld({ seed: SEED }); // no echo, no authored
    const frame = world.snapshot();
    delete (frame.sim as any).authored;

    const viaRestore = new HeadlessWorld({ seed: SEED });
    expect(viaRestore.restore(frame).ok).toBe(true);
    expect(viaRestore.echoPendingLocal).toBeNull();
    expect(() => viaRestore.runSteps([{ ticks: 1, intent: NEUTRAL_INTENT }])).not.toThrow();

    const viaFrame = HeadlessWorld.fromFrame(frame, false);
    expect(() => viaFrame.echoPendingLocal).not.toThrow();
    expect(viaFrame.echoPendingLocal).toBeNull();
    expect(() => viaFrame.runSteps([{ ticks: 1, intent: NEUTRAL_INTENT }])).not.toThrow();

    const viaState = HeadlessWorld.fromSimulationState(world.state, []);
    expect(viaState.echoPendingLocal).toBeNull();
  });
});
