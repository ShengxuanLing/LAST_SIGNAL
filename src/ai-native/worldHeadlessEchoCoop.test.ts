import { describe, expect, it } from 'vitest';
import { HeadlessWorld, neutralIntent } from './worldHeadless';
import { ECHO_ACTOR_ID } from '../world/sim/core';
import { SIGNAL_TUNING } from '../signal/signalTuning';

// P2 — the formal headless entry drives the SAME pure EchoController and the
// same core commands (no hand-written echoIntent as "autonomy").
describe('P2 headless ECHO local cooperation', () => {
  function makeWorld(): { world: HeadlessWorld; roomId: number } {
    const world = new HeadlessWorld({ seed: 424242 });
    const roomId = world.identity.combatRoomId ?? 0;
    world.enableEcho();
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    expect(world.state.echo).toBeTruthy();
    const echo = world.state.echo!;
    world.enableSignalDevice({ deviceId: 'relay_main', roomId, x: echo.x, y: echo.y });
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    return { world, roomId };
  }

  it('echo perceives the relay and produces a local scan proposal (non-executing)', () => {
    const { world } = makeWorld();
    expect(world.echoView()?.relay?.id).toBe('relay_main');
    const proposal = world.proposeLocalEcho();
    expect(proposal?.kind).toBe('scan');
    expect(proposal?.provenance).toBe('local-echo');
    const energy = world.signalView()?.echoEnergy;
    expect(energy).toBe(SIGNAL_TUNING.ENERGY_MAX);
  });

  it('non-human owner fails closed with no echo energy spend', () => {
    const { world } = makeWorld();
    const proposal = world.proposeLocalEcho()!;
    const before = world.signalView()?.echoEnergy;
    expect(world.confirmLocalEchoProposal(proposal.id, false)).toBe(false);
    expect(world.signalView()?.echoEnergy).toBe(before);
    expect(world.echoController.localProposal?.id).toBe(proposal.id);
  });

  it('human confirm commits a real core scan on the next tick (echo energy, not player)', () => {
    const { world } = makeWorld();
    const beforeView = world.signalView() as { playerEnergy: number; echoEnergy: number };
    const playerEnergyBefore = beforeView.playerEnergy;
    const echoEnergyBefore = beforeView.echoEnergy;
    const proposal = world.proposeLocalEcho()!;
    expect(world.confirmLocalEchoProposal(proposal.id, true)).toBe(true);
    expect(world.echoController.localProposal).toBeNull();
    expect(world.echoPendingLocal?.proposalId).toBe(proposal.id);
    expect(world.state.pendingCommands).toHaveLength(1);
    const events = world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const scan = events.find((e) => e.type === 'signal-scanned');
    expect(scan && scan.type === 'signal-scanned' ? scan.ok : false).toBe(true);
    expect(scan && scan.type === 'signal-scanned' ? scan.actorId : -1).toBe(ECHO_ACTOR_ID);
    expect(scan && scan.type === 'signal-scanned' ? scan.energy : -1).toBe(echoEnergyBefore - SIGNAL_TUNING.SCAN_COST);
    const after = world.signalView() as { playerEnergy: number; echoEnergy: number; evidence: number };
    expect(after.playerEnergy).toBe(playerEnergyBefore);
    expect(after.echoEnergy).toBeLessThanOrEqual(echoEnergyBefore - SIGNAL_TUNING.SCAN_COST);
    expect(after.evidence).toBeGreaterThan(0);
    expect(world.echoPendingLocal).toBeNull();
    expect(world.echoAudit.last()).toMatchObject({ action: 'scan', result: 'applied', proposalId: proposal.id });
  });

  it('paused repeated confirm enqueues only one command and one real receipt', () => {
    const { world } = makeWorld();
    const proposal = world.proposeLocalEcho()!;
    expect(world.confirmLocalEchoProposal(proposal.id, true)).toBe(true);
    expect(world.echoPendingLocal?.proposalId).toBe(proposal.id);
    expect(world.state.pendingCommands).toHaveLength(1);
    // No second proposal while in flight; direct boundary calls also fail closed.
    expect(world.proposeLocalEcho()).toBeNull();
    expect(world.confirmLocalEchoProposal(proposal.id, true)).toBe(false);
    expect(world.confirmLocalEchoProposal('local_other', true)).toBe(false);
    expect(world.state.pendingCommands).toHaveLength(1);
    expect(world.echoPendingLocal?.proposalId).toBe(proposal.id);
    expect(world.echoAudit.last()).toMatchObject({ result: 'rejected', code: 'E_ALREADY_PENDING' });
    const events = world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    expect(events.filter((e) => e.type === 'signal-scanned')).toHaveLength(1);
    expect(world.echoPendingLocal).toBeNull();
    expect(world.echoAudit.last()).toMatchObject({ action: 'scan', result: 'applied', proposalId: proposal.id });
  });

  it('repeated toggle confirm flips the relay exactly once on the real tick', () => {
    const { world } = makeWorld();
    const scan = world.proposeLocalEcho()!;
    expect(world.confirmLocalEchoProposal(scan.id, true)).toBe(true);
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const manualBefore = (world.signalView() as { manualEnabled: boolean }).manualEnabled;
    const toggle = world.proposeLocalEcho()!;
    expect(toggle.kind).toBe('toggle-relay');
    expect(world.confirmLocalEchoProposal(toggle.id, true)).toBe(true);
    expect(world.state.pendingCommands).toHaveLength(1);
    expect(world.proposeLocalEcho()).toBeNull();
    expect(world.confirmLocalEchoProposal(toggle.id, true)).toBe(false);
    expect(world.state.pendingCommands).toHaveLength(1);
    const events = world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    expect(events.filter((e) => e.type === 'signal-relay-changed')).toHaveLength(1);
    expect((world.signalView() as { manualEnabled: boolean }).manualEnabled).toBe(!manualBefore);
    expect(world.echoPendingLocal).toBeNull();
    expect(world.echoAudit.last()).toMatchObject({ action: 'toggle-relay', result: 'applied', proposalId: toggle.id });
  });

  it('explicit cancel removes the exact command, records it and allows a new action', () => {
    const { world } = makeWorld();
    const proposal = world.proposeLocalEcho()!;
    expect(world.confirmLocalEchoProposal(proposal.id, true)).toBe(true);
    expect(world.state.pendingCommands).toHaveLength(1);
    expect(world.cancelPendingLocalEcho('E_LOCAL_REVOKED')).toBe(true);
    expect(world.state.pendingCommands).toHaveLength(0);
    expect(world.echoPendingLocal).toBeNull();
    expect(world.echoAudit.last()).toMatchObject({ result: 'cancelled', code: 'E_LOCAL_REVOKED', proposalId: proposal.id });
    const next = world.proposeLocalEcho();
    expect(next).not.toBeNull();
    expect(world.confirmLocalEchoProposal(next!.id, true)).toBe(true);
    expect(world.state.pendingCommands).toHaveLength(1);
  });

  it('switch OFF does not cancel an already human-confirmed action', () => {
    const { world } = makeWorld();
    const proposal = world.proposeLocalEcho()!;
    expect(world.confirmLocalEchoProposal(proposal.id, true)).toBe(true);
    world.echoController.setAutonomy(false);
    expect(world.echoPendingLocal?.proposalId).toBe(proposal.id);
    expect(world.state.pendingCommands).toHaveLength(1);
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    expect(world.echoAudit.last()).toMatchObject({ result: 'applied', proposalId: proposal.id });
  });

  it('wrong/stale id fails closed; rejection keeps energy and applies a cooldown', () => {
    const { world } = makeWorld();
    const proposal = world.proposeLocalEcho()!;
    const before = world.signalView()?.echoEnergy;
    expect(world.confirmLocalEchoProposal('wrong', true)).toBe(false);
    expect(world.rejectLocalEchoProposal(proposal.id)).toBe(true);
    expect(world.signalView()?.echoEnergy).toBe(before);
    expect(world.proposeLocalEcho()).toBeNull();
  });

  it('the headless tick uses the same controller when no echoIntent override is given', () => {
    const { world } = makeWorld();
    const echo = world.state.echo!;
    world.echoController.setMode('move-to', { x: echo.x + 2, y: echo.y });
    const events = world.runSteps([{ ticks: 5, intent: neutralIntent() }]);
    expect(events.some((e) => e.type === 'echo-moved')).toBe(true);
  });

  it('a new run defaults low-risk OFF; the option only enables it explicitly', () => {
    const off = new HeadlessWorld({ seed: 424242 });
    expect(off.echoController.autonomyEnabled).toBe(false);
    const on = new HeadlessWorld({ seed: 424242, echoAutonomy: true });
    expect(on.echoController.autonomyEnabled).toBe(true);
  });
});

describe('P2 raw-sim restore / queue guard', () => {
  function makeWorld(): { world: HeadlessWorld; roomId: number } {
    const world = new HeadlessWorld({ seed: 424242 });
    const roomId = world.identity.combatRoomId ?? 0;
    world.enableEcho();
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const echo = world.state.echo!;
    world.enableSignalDevice({ deviceId: 'relay_main', roomId, x: echo.x, y: echo.y });
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    return { world, roomId };
  }

  it('restore keeps one queued scan, blocks a second confirm, then executes once', () => {
    const { world, roomId } = makeWorld();
    const proposal = world.proposeLocalEcho()!;
    expect(world.confirmLocalEchoProposal(proposal.id, true)).toBe(true);
    const restored = HeadlessWorld.fromSimulationState(world.state, [roomId]);
    expect(restored.echoPendingLocal).toMatchObject({ restored: true, kind: 'scan', proposalId: null, acceptedTick: null });
    expect(restored.proposeLocalEcho()).toBeNull();
    expect(restored.confirmLocalEchoProposal(proposal.id, true)).toBe(false);
    expect(restored.confirmLocalEchoProposal('local_restored_other', true)).toBe(false);
    expect(restored.state.pendingCommands).toHaveLength(1);
    const events = restored.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const scans = events.filter((e) => e.type === 'signal-scanned');
    expect(scans).toHaveLength(1);
    expect(scans[0] && scans[0].type === 'signal-scanned' ? scans[0].energy : -1)
      .toBe(SIGNAL_TUNING.ENERGY_MAX - SIGNAL_TUNING.SCAN_COST);
    expect(restored.state.pendingCommands).toHaveLength(0);
    expect(restored.echoPendingLocal).toBeNull();
    // The restored command must not fabricate a human-local applied receipt.
    expect(restored.echoAudit.recent().some((e) => e.action === 'scan' && e.result === 'applied')).toBe(false);
  });

  it('restore keeps one queued toggle, blocks a second confirm, flips exactly once', () => {
    const { world, roomId } = makeWorld();
    const scan = world.proposeLocalEcho()!;
    expect(world.confirmLocalEchoProposal(scan.id, true)).toBe(true);
    world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const manualBefore = (world.signalView() as { manualEnabled: boolean }).manualEnabled;
    const toggle = world.proposeLocalEcho()!;
    expect(toggle.kind).toBe('toggle-relay');
    expect(world.confirmLocalEchoProposal(toggle.id, true)).toBe(true);
    const restored = HeadlessWorld.fromSimulationState(world.state, [roomId]);
    expect(restored.echoPendingLocal).toMatchObject({ restored: true, kind: 'toggle-relay', proposalId: null });
    expect(restored.proposeLocalEcho()).toBeNull();
    expect(restored.confirmLocalEchoProposal(toggle.id, true)).toBe(false);
    expect(restored.state.pendingCommands).toHaveLength(1);
    const events = restored.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    expect(events.filter((e) => e.type === 'signal-relay-changed')).toHaveLength(1);
    expect((restored.signalView() as { manualEnabled: boolean }).manualEnabled).toBe(!manualBefore);
    expect(restored.echoPendingLocal).toBeNull();
    expect(restored.state.pendingCommands).toHaveLength(0);
  });

  it('does not mark or delete a player/other-actor command as human-local', () => {
    const { world, roomId } = makeWorld();
    world.enqueueSignalCommand({ type: 'signal-scan', actor: 'player' });
    const restored = HeadlessWorld.fromSimulationState(world.state, [roomId]);
    expect(restored.echoPendingLocal).toBeNull();
    expect(restored.state.pendingCommands).toHaveLength(1);
    expect(restored.state.pendingCommands[0]).toMatchObject({ type: 'signal-scan', actor: 'player' });
    expect(restored.echoAudit.last()).toBeNull();
    const events = restored.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    const scans = events.filter((e) => e.type === 'signal-scanned');
    expect(scans).toHaveLength(1);
    expect(scans[0] && scans[0].type === 'signal-scanned' ? scans[0].actorId : -1).not.toBe(ECHO_ACTOR_ID);
    expect(restored.state.pendingCommands).toHaveLength(0);
    expect(restored.echoAudit.last()).toBeNull();
  });

  it('preserves an external Owner toggle command while blocking a new local confirm', () => {
    const { world, roomId } = makeWorld();
    world.enqueueSignalCommand({ type: 'toggle-relay', enabled: true, originRoomId: roomId });
    const restored = HeadlessWorld.fromSimulationState(world.state, [roomId]);
    expect(restored.echoPendingLocal).toMatchObject({ restored: true, kind: 'toggle-relay', proposalId: null });
    expect(restored.confirmLocalEchoProposal('local_external_guard', true)).toBe(false);
    expect(restored.state.pendingCommands).toHaveLength(1);
    const events = restored.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    expect(events.filter((e) => e.type === 'signal-relay-changed')).toHaveLength(1);
    expect((restored.signalView() as { manualEnabled: boolean }).manualEnabled).toBe(true);
    expect(restored.state.pendingCommands).toHaveLength(0);
    expect(restored.echoPendingLocal).toBeNull();
    expect(restored.echoAudit.recent().some((e) => e.action === 'toggle-relay' && e.result === 'applied')).toBe(false);
  });

  it('a room generation change does not clear the restored guard before the core', () => {
    const { world } = makeWorld();
    const proposal = world.proposeLocalEcho()!;
    expect(world.confirmLocalEchoProposal(proposal.id, true)).toBe(true);
    // Empty entered set forces the post-tick room-enter path.
    const restored = HeadlessWorld.fromSimulationState(world.state, []);
    expect(restored.echoPendingLocal).toMatchObject({ restored: true, kind: 'scan' });
    const events = restored.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    expect(events.filter((e) => e.type === 'signal-scanned')).toHaveLength(1);
    expect(restored.state.pendingCommands).toHaveLength(0);
    expect(restored.echoPendingLocal).toBeNull();
  });

  it('does not let an explicit local cancel delete an unknown restored command', () => {
    const { world, roomId } = makeWorld();
    const proposal = world.proposeLocalEcho()!;
    expect(world.confirmLocalEchoProposal(proposal.id, true)).toBe(true);
    const restored = HeadlessWorld.fromSimulationState(world.state, [roomId]);
    expect(restored.cancelPendingLocalEcho('E_LOCAL_REVOKED')).toBe(false);
    expect(restored.state.pendingCommands).toHaveLength(1);
    expect(restored.echoPendingLocal).toMatchObject({ restored: true, kind: 'scan' });
    const events = restored.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    expect(events.filter((e) => e.type === 'signal-scanned')).toHaveLength(1);
    expect(restored.state.pendingCommands).toHaveLength(0);
    expect(restored.echoPendingLocal).toBeNull();
  });

  it('a dead echo does not leave an actually-local guard stuck', () => {
    const { world } = makeWorld();
    const proposal = world.proposeLocalEcho()!;
    expect(world.confirmLocalEchoProposal(proposal.id, true)).toBe(true);
    (world as unknown as { sim: { echo: { data: { hp: number } } } }).sim.echo.data.hp = 0;
    const events = world.runSteps([{ ticks: 1, intent: neutralIntent() }]);
    expect(world.echoPendingLocal).toBeNull();
    expect(world.state.pendingCommands).toHaveLength(0);
    expect(world.echoAudit.last()).not.toBeNull();
    expect(events.length).toBeGreaterThanOrEqual(0);
  });
});
