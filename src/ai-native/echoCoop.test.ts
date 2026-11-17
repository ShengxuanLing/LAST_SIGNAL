import { describe, expect, it } from 'vitest';
import { EchoController, ECHO_LIMITS, type EchoView } from './echo';
import { SIGNAL_TUNING } from '../signal/signalTuning';

function view(overrides: Partial<EchoView> = {}): EchoView {
  return {
    tick: 100,
    player: { x: 10, y: 10 },
    echo: { x: 10, y: 10, hp: 100, maxHp: 100, aimYaw: 0 },
    drones: [],
    targets: [],
    ...overrides
  };
}

function relayView(overrides: Partial<EchoView> = {}): EchoView {
  return view({
    tick: 200,
    echo: { x: 10, y: 10, hp: 100, maxHp: 100, aimYaw: 0 },
    relay: { id: 'relay_main', x: 11, y: 10, state: 'ACTIVE' },
    energy: { current: 100, max: 100 },
    cooldowns: { scanTicks: 0, jamTicks: 0 },
    roomGeneration: 3,
    canWalk: () => true,
    ...overrides
  });
}

describe('P2 echo observe/autonomy', () => {
  it('default OFF: observe has no autonomous movement', () => {
    const controller = new EchoController();
    controller.setMode('observe');
    const intent = controller.decide(view({ canWalk: () => true }));
    expect(intent.move).toEqual({ x: 0, y: 0 });
    expect(controller.autonomyEnabled).toBe(false);
  });

  it('switch ON: observe moves only to a verifiable safe cell', () => {
    const controller = new EchoController();
    controller.setMode('observe');
    controller.setAutonomy(true);
    const intent = controller.decide(view({ canWalk: () => true }));
    expect(Math.hypot(intent.move.x, intent.move.y)).toBeGreaterThan(0);
  });

  it('cannot prove safety: no canWalk => no movement', () => {
    const controller = new EchoController();
    controller.setMode('observe');
    controller.setAutonomy(true);
    const intent = controller.decide(view());
    expect(intent.move).toEqual({ x: 0, y: 0 });
  });

  it('HOLD wins over autonomy: no automatic movement', () => {
    const controller = new EchoController();
    controller.setMode('hold');
    controller.setAutonomy(true);
    const intent = controller.decide(view({ canWalk: () => true }));
    expect(intent.move).toEqual({ x: 0, y: 0 });
  });

  it('manual move-to target has priority over autonomy', () => {
    const controller = new EchoController();
    controller.setMode('move-to', { x: 15, y: 10 });
    controller.setAutonomy(true);
    const intent = controller.decide(view({ canWalk: () => true }));
    expect(intent.move.x).toBeGreaterThan(0);
    expect(controller.moveTarget).not.toBeNull();
  });

  it('OBSERVE never fires even with assist armed', () => {
    const controller = new EchoController();
    controller.setMode('observe');
    controller.confirmAssist();
    const intent = controller.decide(view({
      canWalk: () => true,
      drones: [{ id: 7, x: 11, y: 10, hp: 10 }]
    }));
    expect(intent.fire).toBe(false);
  });
});

describe('P2 local perception memory', () => {
  it('records source/TTL/roomGeneration and caps at 16', () => {
    const controller = new EchoController();
    const drones = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, x: 10 + i, y: 10, hp: 10 }));
    controller.observe(view({ tick: 50, roomGeneration: 2, drones }));
    expect(controller.memory).toHaveLength(ECHO_LIMITS.memoryEntries);
    for (const entry of controller.memory) {
      expect(entry.source).toBe('echo-perception');
      expect(entry.kind).toBe('drone');
      expect(entry.expiresAtTick).toBe(50 + ECHO_LIMITS.memoryTtlTicks);
      expect(entry.roomGeneration).toBe(2);
    }
  });

  it('expires by TTL and clears on a committed room generation change', () => {
    const controller = new EchoController();
    controller.observe(view({ tick: 10, roomGeneration: 1, drones: [{ id: 1, x: 9, y: 10, hp: 10 }] }));
    expect(controller.memory).toHaveLength(1);
    controller.observe(view({ tick: 10 + ECHO_LIMITS.memoryTtlTicks + 1, roomGeneration: 1 }));
    expect(controller.memory).toHaveLength(0);
    controller.observe(view({ tick: 20, roomGeneration: 1, drones: [{ id: 2, x: 9, y: 10, hp: 10 }] }));
    controller.setRoomGeneration(2);
    expect(controller.memory).toHaveLength(0);
  });

  it('relay memory is last-seen only (kind relay, no hidden state)', () => {
    const controller = new EchoController();
    controller.observe(relayView());
    const relay = controller.memory.find((e) => e.kind === 'relay');
    expect(relay?.id).toBe('relay_main');
    expect(Object.keys(relay ?? {})).not.toContain('state');
  });
});

describe('P2 local proposal + fail-closed confirmation', () => {
  it('legal view produces a local scan proposal with all required fields', () => {
    const controller = new EchoController();
    const proposal = controller.propose(relayView());
    expect(proposal).not.toBeNull();
    expect(proposal!.kind).toBe('scan');
    expect(proposal!.provenance).toBe('local-echo');
    expect(proposal!.target).toEqual({ x: 11, y: 10 });
    expect(proposal!.observedTick).toBe(200);
    expect(proposal!.expiresAtTick).toBe(200 + ECHO_LIMITS.localProposalTtlTicks);
    expect(proposal!.roomGeneration).toBe(3);
    expect(proposal!.cost).toEqual({ energy: SIGNAL_TUNING.SCAN_COST, resource: 'echo-energy' });
    expect(proposal!.needsConfirm).toBe(true);
    // proposing is non-executing: no energy/world mutation in the controller
    expect(controller.localProposal?.id).toBe(proposal!.id);
  });

  it('no relay => no proposal; toggle fallback when scan is not legal', () => {
    const controller = new EchoController();
    expect(controller.propose(view({ tick: 5 }))).toBeNull();
    const toggle = controller.propose(relayView({ energy: { current: 0, max: 100 } }));
    expect(toggle?.kind).toBe('toggle-relay');
  });

  it('validates human/id/expiry/room; wrong or stale id fails closed', () => {
    const controller = new EchoController();
    const proposal = controller.propose(relayView())!;
    expect(controller.validateLocalProposal(proposal.id, 200, 3, true).ok).toBe(true);
    expect(controller.validateLocalProposal(proposal.id, 200, 3, false).code).toBe('E_OWNER_NOT_HUMAN');
    expect(controller.validateLocalProposal('wrong', 200, 3, true).code).toBe('E_STALE_ID');
    expect(controller.validateLocalProposal(proposal.id, proposal.expiresAtTick, 3, true).code).toBe('E_EXPIRED');
    expect(controller.validateLocalProposal(proposal.id, 200, 4, true).code).toBe('E_STALE_ROOM');
  });

  it('rejection clears and applies a bounded re-proposal cooldown', () => {
    const controller = new EchoController();
    const proposal = controller.propose(relayView())!;
    controller.rejectLocalProposal(proposal.id, 200);
    expect(controller.localProposal).toBeNull();
    expect(controller.propose(relayView({ tick: 250 }))).toBeNull();
    expect(controller.propose(relayView({ tick: 200 + ECHO_LIMITS.localRejectCooldownTicks + 1 }))).not.toBeNull();
  });

  it('consume clears the proposal; a room change clears it too', () => {
    const controller = new EchoController();
    const proposal = controller.propose(relayView())!;
    controller.consumeLocalProposal(proposal.id);
    expect(controller.localProposal).toBeNull();
    const next = controller.propose(relayView({ tick: 260 }))!;
    expect(next).not.toBeNull();
    controller.setRoomGeneration(4);
    expect(controller.localProposal).toBeNull();
    expect(controller.validateLocalProposal(next.id, 260, 4, true).ok).toBe(false);
  });
});

describe('P2 lifecycle boundary', () => {
  it('OFF clears autonomous movement but never silently turns HOLD into FOLLOW', () => {
    const controller = new EchoController();
    controller.setMode('hold');
    controller.setAutonomy(true);
    controller.setAutonomy(false);
    expect(controller.mode).toBe('hold');
    expect(controller.decide(view({ canWalk: () => true })).move).toEqual({ x: 0, y: 0 });
  });

  it('authority reset clears memory/proposal/intent (checkpoint restore/death/new R0)', () => {
    const controller = new EchoController();
    controller.setMode('move-to', { x: 14, y: 10 });
    controller.confirmAssist();
    controller.observe(relayView());
    controller.propose(relayView());
    controller.setAutonomy(true);
    controller.reset();
    expect(controller.mode).toBe('follow');
    expect(controller.memory).toHaveLength(0);
    expect(controller.localProposal).toBeNull();
    expect(controller.suggestion).toBeNull();
    expect(controller.assistConfirmed).toBe(false);
    expect(controller.lastIntent.move).toEqual({ x: 0, y: 0 });
    // The saved switch is World-owned; reset alone does not flip it on.
    expect(controller.autonomyEnabled).toBe(true);
  });
});

describe('P2 single in-flight local action', () => {
  it('blocks new proposals and validations until the core receipt', () => {
    const controller = new EchoController();
    const proposal = controller.propose(relayView())!;
    controller.markLocalPending(proposal);
    expect(controller.pendingLocalProposal?.id).toBe(proposal.id);
    expect(controller.propose(relayView({ tick: 210 }))).toBeNull();
    expect(controller.validateLocalProposal(proposal.id, 210, 3, true).code).toBe('E_ALREADY_PENDING');
    expect(controller.validateLocalProposal('local_other', 210, 3, true).code).toBe('E_ALREADY_PENDING');
    controller.clearLocalPending();
    expect(controller.propose(relayView({ tick: 210 }))).not.toBeNull();
  });

  it('room transition, reset and disconnect clear the pending marker', () => {
    for (const action of ['room', 'reset', 'clear'] as const) {
      const controller = new EchoController();
      const proposal = controller.propose(relayView())!;
      controller.markLocalPending(proposal);
      if (action === 'room') controller.setRoomGeneration(4);
      if (action === 'reset') controller.reset();
      if (action === 'clear') controller.clearIntent();
      expect(controller.pendingLocalProposal).toBeNull();
    }
    // OFF only withdraws autonomy; it does not silently cancel a confirmed action.
    const c = new EchoController();
    const p = c.propose(relayView())!;
    c.markLocalPending(p);
    c.setAutonomy(false);
    expect(c.pendingLocalProposal?.id).toBe(p.id);
  });
});

describe('P2 raw-restored queued signal (unknown provenance)', () => {
  it('blocks proposals/validation without faking a local proposal', () => {
    const controller = new EchoController();
    controller.setRestoredPending('toggle-relay');
    expect(controller.pendingLocalProposal).toBeNull();
    expect(controller.restoredPendingKind).toBe('toggle-relay');
    expect(controller.propose(relayView())).toBeNull();
    expect(controller.validateLocalProposal('local_any', 210, 3, true).code).toBe('E_ALREADY_PENDING');
    // Room generation/clear-intent must not lose a guard while the core queue is
    // still there; only the real receipt or a full reset clears it.
    controller.setRoomGeneration(4);
    controller.clearForRoomTransition();
    controller.clearIntent();
    expect(controller.restoredPendingKind).toBe('toggle-relay');
    controller.clearRestoredPending();
    expect(controller.propose(relayView({ tick: 211, roomGeneration: 4 }))).not.toBeNull();
    const reset = new EchoController();
    reset.setRestoredPending('scan');
    reset.reset();
    expect(reset.restoredPendingKind).toBeNull();
  });
});
