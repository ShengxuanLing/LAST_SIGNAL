// AI-NATIVE-02 P1 — unit tests for the shared control seam.
//
// These tests cover the pure contract: PlayerIntent construction, the real
// anisotropic screen -> grid movement budget, deterministic target selection
// and the ownership/pause/takeover state machine. They do not need Phaser.

import { describe, expect, it } from 'vitest';
import {
  ControlAuthority,
  intentFromHumanInput,
  intentToWorldVelocity,
  neutralIntent,
  screenDirectionTowardGrid
} from './control';
import {
  AI_TUNING,
  LocalDeterministicController,
  pickTarget,
  type LocalControllerView
} from './localController';

function view(overrides: Partial<LocalControllerView> = {}): LocalControllerView {
  return {
    ready: true,
    player: { x: 0, y: 0, alive: true },
    roomId: 0,
    enemies: [],
    boss: null,
    portal: null,
    canWalk: () => true,
    timeSeconds: 0,
    ...overrides
  };
}

function actor(id: number, kind: string, x: number, y: number, alive = true) {
  return { id, kind, x, y, alive };
}

describe('PlayerIntent / human adapter', () => {
  it('neutral intent is a full stop with no side effects', () => {
    const n = neutralIntent();
    expect(n.move).toEqual({ x: 0, y: 0 });
    expect(n.fire).toBe(false);
    expect(n.dash).toBe(false);
    expect(n.interact).toBe(false);
    expect(n.aim).toBeNull();
  });

  it('maps keyboard/pointer state into the same DTO the controller returns', () => {
    const intent = intentFromHumanInput({
      up: false, down: true, left: true, right: false,
      dash: true, fire: true, interact: false, aim: { x: 4, y: 5 }
    });
    expect(intent.move).toEqual({ x: -1, y: 1 });
    expect(intent.dash).toBe(true);
    expect(intent.fire).toBe(true);
    expect(intent.aim).toEqual({ x: 4, y: 5 });
  });
});

describe('movement budget (real anisotropic screen -> grid path)', () => {
  it('screen-right and screen-diagonal cost different grid speeds', () => {
    const right = intentToWorldVelocity({ x: 1, y: 0 }, 64);
    const diag = intentToWorldVelocity({ x: 1, y: 1 }, 64);
    const rightMag = Math.hypot(right.x, right.y);
    const diagMag = Math.hypot(diag.x, diag.y);
    expect(rightMag).toBeCloseTo(Math.SQRT2, 6);
    expect(diagMag).toBeCloseTo(Math.sqrt(5), 6);
    expect(Math.abs(diagMag - rightMag)).toBeGreaterThan(0.1);
  });

  it('steering toward a grid point maps back to that exact unit grid direction', () => {
    const screen = screenDirectionTowardGrid(3, 1);
    const world = intentToWorldVelocity(screen, 7);
    const mag = Math.hypot(world.x, world.y);
    expect(world.x / mag).toBeCloseTo(3 / Math.sqrt(10), 6);
    expect(world.y / mag).toBeCloseTo(1 / Math.sqrt(10), 6);
    // The budget is linear in speed and preserves the 3:1 grid direction.
    expect(world.x).toBeCloseTo(3 / Math.SQRT2 * 7 / 64, 6);
    expect(world.y).toBeCloseTo(1 / Math.SQRT2 * 7 / 64, 6);
  });

  it('returns zero velocity for a stop intent', () => {
    expect(intentToWorldVelocity({ x: 0, y: 0 }, 220)).toEqual({ x: 0, y: 0 });
  });
});

describe('deterministic target selection', () => {
  it('picks the nearest hostile and includes the boss', () => {
    const v = view({
      enemies: [actor(1, 'drone', 6, 0), actor(2, 'stalker', 2, 0)],
      boss: actor(3, 'boss_warden', 30, 30)
    });
    expect(pickTarget(v)?.id).toBe(2);
  });

  it('breaks distance ties by lower id (stable ordering)', () => {
    const v = view({
      enemies: [actor(9, 'drone', 4, 0), actor(4, 'drone', 0, 4)]
    });
    expect(pickTarget(v)?.id).toBe(4);
  });

  it('ignores dead actors', () => {
    const v = view({ enemies: [actor(1, 'drone', 1, 0, false)], boss: null });
    expect(pickTarget(v)).toBeNull();
  });
});

describe('LocalDeterministicController', () => {
  it('walks toward a distant hostile through the real intent budget', () => {
    const c = new LocalDeterministicController();
    const d = c.decide(view({ enemies: [actor(5, 'drone', 6, 0)] }));
    expect(d.action).toBe('MOVE');
    expect(d.targetId).toBe(5);
    expect(d.intent.fire).toBe(true);
    const v = intentToWorldVelocity(d.intent.move, 1);
    const mag = Math.hypot(v.x, v.y);
    expect(v.x / mag).toBeCloseTo(1, 6);
    expect(v.y / mag).toBeCloseTo(0, 6);
  });

  it('stops and fires when a hostile is inside engage range', () => {
    const c = new LocalDeterministicController();
    const d = c.decide(view({ enemies: [actor(5, 'drone', 2, 0)] }));
    expect(d.action).toBe('ENGAGE');
    expect(d.intent.move).toEqual({ x: 0, y: 0 });
    expect(d.intent.fire).toBe(true);
    expect(d.intent.aim).toEqual({ x: 2, y: 0 });
    expect(2).toBeLessThanOrEqual(AI_TUNING.engageRange);
  });

  it('travels to the portal and interacts when close', () => {
    const c = new LocalDeterministicController();
    const travel = c.decide(view({ portal: { x: 9, y: 0 } }));
    expect(travel.action).toBe('TRAVEL');
    expect(Math.hypot(travel.intent.move.x, travel.intent.move.y)).toBeGreaterThan(0);
    expect(travel.intent.fire).toBe(false);

    const arrive = new LocalDeterministicController();
    const interact = arrive.decide(view({ portal: { x: 0.5, y: 0 } }));
    expect(interact.action).toBe('INTERACT');
    expect(interact.intent.interact).toBe(true);
    expect(interact.intent.move).toEqual({ x: 0, y: 0 });
  });

  it('reports STOP with no hostile and no portal, HOLD when not ready', () => {
    const c = new LocalDeterministicController();
    expect(c.decide(view()).action).toBe('STOP');
    expect(c.decide(view({ ready: false })).action).toBe('HOLD');
    expect(c.decide(view({ player: { x: 0, y: 0, alive: false } })).action).toBe('HOLD');
  });

  it('reports BLOCKED instead of phasing through walls', () => {
    const c = new LocalDeterministicController();
    const d = c.decide(view({ enemies: [actor(1, 'drone', 8, 0)], canWalk: () => false }));
    expect(d.action).toBe('BLOCKED');
    expect(d.intent.move).toEqual({ x: 0, y: 0 });
  });

  it('is deterministic for an identical view sequence and resets cleanly', () => {
    const run = (controller: LocalDeterministicController) => {
      const script: Array<LocalControllerView> = [
        view({ enemies: [actor(2, 'drone', 5, 1)], timeSeconds: 0 }),
        view({ enemies: [actor(2, 'drone', 4.5, 1)], timeSeconds: 0.5 }),
        view({ portal: { x: 3, y: 3 }, timeSeconds: 1.0 })
      ];
      return script.map((v) => controller.decide(v));
    };
    const a = run(new LocalDeterministicController());
    const b = run(new LocalDeterministicController());
    expect(a).toEqual(b);
    const c = new LocalDeterministicController();
    c.decide(view({ enemies: [actor(1, 'drone', 5, 0)] }));
    c.reset();
    expect(c.decide(view({ enemies: [actor(1, 'drone', 5, 0)] }))).toEqual(
      new LocalDeterministicController().decide(view({ enemies: [actor(1, 'drone', 5, 0)] }))
    );
  });
});

describe('ControlAuthority ownership / pause / takeover', () => {
  it('defaults to human and never claims an external agent', () => {
    const a = new ControlAuthority();
    const s = a.snapshot();
    expect(s.owner).toBe('human');
    expect(s.mode).toBe('HUMAN');
    expect(s.aiEnabled).toBe(false);
    expect(s.externalAgentConnected).toBe(false);
    expect(s.agentLinkLabel).toContain('EXTERNAL NOT CONNECTED');
    expect(s.agentLinkLabel).toContain('LOCAL DETERMINISTIC');
  });

  it('enables AI, pauses, and resumes with ownership restored', () => {
    const a = new ControlAuthority();
    a.enableAi(3);
    expect(a.snapshot().mode).toBe('AI');
    expect(a.snapshot().modeLabel).toContain('LOCAL DETERMINISTIC');
    a.pause();
    expect(a.snapshot().mode).toBe('PAUSED');
    expect(a.owner).toBe('ai');
    a.resume();
    expect(a.snapshot().mode).toBe('AI');
    expect(a.owner).toBe('ai');
  });

  it('human takeover disables the local demo and is recorded', () => {
    const a = new ControlAuthority();
    a.enableAi();
    expect(a.humanTakeover('human-input')).toBe(true);
    const s = a.snapshot();
    expect(s.owner).toBe('human');
    expect(s.aiEnabled).toBe(false);
    expect(s.takeoverCount).toBe(1);
    expect(s.lastTakeoverReason).toBe('human-input');
    // Second takeover attempt while human does nothing.
    expect(a.humanTakeover('again')).toBe(false);
    expect(a.snapshot().takeoverCount).toBe(1);
  });

  it('pause/resume with AI disabled stays human (no silent AI grab)', () => {
    const a = new ControlAuthority();
    a.pause();
    a.resume();
    expect(a.owner).toBe('human');
    expect(a.snapshot().mode).toBe('HUMAN');
  });

  it('death and run end hand control back to the human', () => {
    const a = new ControlAuthority();
    a.enableAi();
    a.onDeath();
    expect(a.snapshot().owner).toBe('human');
    expect(a.snapshot().paused).toBe(true);
    expect(a.snapshot().modeLabel).toBe('PAUSED');

    const b = new ControlAuthority();
    b.enableAi();
    b.onRunEnd();
    expect(b.owner).toBe('human');
    expect(b.snapshot().paused).toBe(true);
  });

  it('onRunStart and onSceneExit reset AI state', () => {
    const a = new ControlAuthority();
    a.enableAi();
    a.noteAiDecision({ action: 'ENGAGE', targetId: 3, targetLabel: 'HOSTILE #3 drone' }, 1.25);
    a.onSceneExit();
    expect(a.owner).toBe('human');
    expect(a.aiEnabled).toBe(false);
    expect(a.snapshot().lastAiAction).toBeNull();

    a.enableAi();
    a.noteAiDecision({ action: 'MOVE', targetId: 1, targetLabel: 'HOSTILE #1 drone' }, 2);
    a.onRunStart();
    const s = a.snapshot();
    expect(s.owner).toBe('human');
    expect(s.lastAiAction).toBeNull();
    expect(s.aiActionCount).toBe(0);
    expect(s.takeoverCount).toBe(0);
  });

  it('counts executed AI actions only when the action or target changes', () => {
    const a = new ControlAuthority();
    a.enableAi();
    a.noteAiDecision({ action: 'MOVE', targetId: 1, targetLabel: 'HOSTILE #1 drone' }, 0.1);
    a.noteAiDecision({ action: 'MOVE', targetId: 1, targetLabel: 'HOSTILE #1 drone' }, 0.2);
    expect(a.snapshot().aiActionCount).toBe(1);
    a.noteAiDecision({ action: 'ENGAGE', targetId: 1, targetLabel: 'HOSTILE #1 drone' }, 0.3);
    expect(a.snapshot().aiActionCount).toBe(2);
    expect(a.snapshot().lastAiAction).toBe('ENGAGE');
    expect(a.snapshot().lastAiTarget).toBe('HOSTILE #1 drone');
    expect(a.snapshot().lastAiActionAtSeconds).toBe(0.3);
  });
});
