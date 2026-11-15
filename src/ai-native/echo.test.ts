// P3-a — echo intent policy (pure, no Phaser).

import { describe, expect, it } from 'vitest';
import { EchoController, ECHO_LIMITS, type EchoView } from './echo';

function view(overrides: Partial<EchoView> = {}): EchoView {
  return {
    tick: 0,
    player: { x: 0, y: 0 },
    echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 },
    drones: [],
    ...overrides
  };
}

describe('P3-a echo controller', () => {
  it('follow keeps a standoff and holds when close', () => {
    const c = new EchoController();
    c.setMode('follow');
    const far = c.decide(view({ player: { x: 10, y: 0 } }));
    expect(far.move.x).toBeGreaterThan(0);
    expect(far.move.y).toBe(0);
    const near = c.decide(view({ player: { x: 1, y: 0 } }));
    expect(near.move).toEqual({ x: 0, y: 0 });
  });

  it('hold never moves; move-to walks to the target then stops', () => {
    const c = new EchoController();
    c.setMode('hold');
    expect(c.decide(view({ player: { x: 20, y: 20 } })).move).toEqual({ x: 0, y: 0 });

    c.setMode('move-to', { x: 5, y: 0 });
    const walk = c.decide(view());
    expect(walk.move.x).toBeGreaterThan(0);
    const arrive = c.decide(view({ echo: { x: 5, y: 0, hp: 100, maxHp: 100, aimYaw: 0 } }));
    expect(arrive.move).toEqual({ x: 0, y: 0 });
    expect(c.moveTarget).toBeNull();
  });

  it('never fires without an explicit assist confirm, and a mode switch revokes it', () => {
    const c = new EchoController();
    c.setMode('follow');
    const drones = [{ id: 7, x: 2, y: 0, hp: 10 }];
    expect(c.decide(view({ drones })).fire).toBe(false);
    expect(c.suggest(view({ drones }))).toBe('fire');
    c.confirmAssist();
    expect(c.suggestion).toBeNull();
    expect(c.decide(view({ drones })).fire).toBe(true);
    c.setMode('hold');
    expect(c.assistConfirmed).toBe(false);
    expect(c.decide(view({ drones })).fire).toBe(false);
  });

  it('aims at the nearest perceived drone and only at perceived ones', () => {
    const c = new EchoController();
    c.setMode('hold');
    const intent = c.decide(view({
      drones: [{ id: 1, x: 4, y: 0, hp: 5 }, { id: 2, x: 1, y: 1, hp: 5 }]
    }));
    expect(intent.aim).toEqual({ x: 1, y: 1 });
    // Nothing hidden: an empty perception view yields no aim.
    expect(c.decide(view()).aim).toBeNull();
    expect(intent.dash).toBe(false);
    expect(intent.interact).toBe(false);
  });

  it('bounds memory to 16 entries and expires it by TTL', () => {
    const c = new EchoController();
    const lot = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, x: i, y: 0, hp: 5 }));
    c.observe(view({ tick: 0, drones: lot }));
    expect(c.memory).toHaveLength(ECHO_LIMITS.memoryEntries);
    expect(c.memory.at(-1)?.id).toBe(40);
    // Just before TTL the oldest survives; after TTL it is pruned.
    c.observe(view({ tick: ECHO_LIMITS.memoryTtlTicks, drones: [] }));
    expect(c.memory.length).toBeGreaterThan(0);
    c.observe(view({ tick: ECHO_LIMITS.memoryTtlTicks * 2 + 1, drones: [] }));
    expect(c.memory).toHaveLength(0);
  });

  it('a dead echo produces a neutral intent and no suggestion', () => {
    const c = new EchoController();
    c.setMode('follow');
    c.confirmAssist();
    const intent = c.decide(view({
      echo: { x: 0, y: 0, hp: 0, maxHp: 100, aimYaw: 0 },
      drones: [{ id: 1, x: 1, y: 0, hp: 5 }]
    }));
    expect(intent).toEqual({ move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    expect(c.lastAlive).toBe(false);
  });

  it('clearIntent stops assist immediately (disconnect / takeover)', () => {
    const c = new EchoController();
    c.setMode('hold');
    c.confirmAssist();
    c.clearIntent();
    expect(c.decide(view({ drones: [{ id: 1, x: 1, y: 0, hp: 5 }] })).fire).toBe(false);
  });
});

describe('EchoController reset (restore/restart/death boundary)', () => {
  it('clears assist, mode, memory, suggestion and intent in one step', () => {
    const c = new EchoController();
    c.setMode('move-to', { x: 5, y: 0 });
    c.confirmAssist();
    c.observe({ tick: 10, player: { x: 0, y: 0 }, echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 }, drones: [{ id: 1, x: 1, y: 0, hp: 5 }] });
    c.decide({ tick: 10, player: { x: 0, y: 0 }, echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 }, drones: [{ id: 1, x: 1, y: 0, hp: 5 }] });
    expect(c.assistConfirmed).toBe(true);
    expect(c.memory.length).toBeGreaterThan(0);
    c.reset();
    expect(c.assistConfirmed).toBe(false);
    expect(c.mode).toBe('follow');
    expect(c.moveTarget).toBeNull();
    expect(c.memory).toHaveLength(0);
    expect(c.suggestion).toBeNull();
    expect(c.lastIntent).toEqual({ move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    expect(c.decide({ tick: 11, player: { x: 0, y: 0 }, echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 }, drones: [{ id: 1, x: 1, y: 0, hp: 5 }] }).fire).toBe(false);
  });
});
