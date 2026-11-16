// C3c step-channel fix (Tester F2): the Player channel has NO direct intent.
// Only `world_action` (queued) + step is legal; Dev keeps a strict fixture
// intent for replay. A rejected direct intent must not advance ticks, charge
// quota, or touch the queue.

import { describe, expect, it } from 'vitest';
import { HeadlessWorldManager } from './worldHeadlessMcpTools';

const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;
const body = (r: any): any => r.structuredContent ?? { ok: false, code: 'E_SCHEMA' };

function player(): HeadlessWorldManager {
  let seed = 4242;
  return new HeadlessWorldManager(false, () => (seed += 1));
}
function dev(): HeadlessWorldManager {
  let seed = 424242;
  return new HeadlessWorldManager(true, () => (seed += 1));
}

const MOVE = { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false };

describe('C3c step channel — Player has no direct intent', () => {
  it('rejects a direct intent with E_PERMISSION and does not advance/charge', () => {
    const manager = player();
    const created = body(manager.createSession());
    const before = body(manager.observe(created.session));
    const rejected = body(manager.step(created.session, created.epoch, rid(1), 10, MOVE));
    expect(rejected.ok).toBe(false);
    expect(rejected.code).toBe('E_PERMISSION');
    const after = body(manager.observe(created.session));
    expect(after.tick, 'no tick advanced').toBe(before.tick);
    // The rejected id did not consume the dedup slot: the SAME requestId is
    // still usable for a legal (queued) step.
    const legal = body(manager.step(created.session, created.epoch, rid(1), 10));
    expect(legal.ok).toBe(true);
    expect(legal.ticks).toBe(10);
  });

  it('a step with no queued action is neutral: no movement and no fire', () => {
    const manager = player();
    const created = body(manager.createSession());
    const before = body(manager.observe(created.session));
    const step = body(manager.step(created.session, created.epoch, rid(2), 10));
    expect(step.ok).toBe(true);
    expect(step.ticks).toBe(10);
    const after = body(manager.observe(created.session));
    expect(after.tick).toBe(before.tick + 10);
    expect(after.observation.player.x).toBe(before.observation.player.x);
    expect(after.observation.player.y).toBe(before.observation.player.y);
    expect(after.observation.projectiles).toHaveLength(0);
    expect(step.executing).toBeNull();
  });

  it('act(move) + step produces real movement through the legal channel', () => {
    const manager = player();
    const created = body(manager.createSession());
    const before = body(manager.observe(created.session));
    const action = body(manager.action(created.session, created.epoch, rid(3), [
      { type: 'move', actionId: aid(3), dir: { x: 1, y: 0 }, ticks: 20 }
    ], 600));
    expect(action.ok).toBe(true);
    expect(action.actions[0].status).toBe('queued');
    const step = body(manager.step(created.session, created.epoch, rid(4), 20));
    expect(step.ok).toBe(true);
    expect(step.applied[0].actionId).toBe(aid(3));
    expect(step.applied[0].executedTicks).toBe(20);
    const after = body(manager.observe(created.session));
    expect(Math.hypot(
      after.observation.player.x - before.observation.player.x,
      after.observation.player.y - before.observation.player.y
    )).toBeGreaterThan(0);
  });

  it('Dev keeps a strict intent for fixture/replay', () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    const before = body(manager.observe(created.session));
    const step = body(manager.step(created.session, created.epoch, rid(5), 20, MOVE));
    expect(step.ok).toBe(true);
    expect(step.ticks).toBe(20);
    const after = body(manager.observe(created.session));
    expect(Math.hypot(
      after.observation.player.x - before.observation.player.x,
      after.observation.player.y - before.observation.player.y
    )).toBeGreaterThan(0);
  });

  it('Dev still rejects a malformed intent (unknown/HP/over-speed), but over-speed is clamped', () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    expect(body(manager.step(created.session, created.epoch, rid(6), 1, { ...MOVE, hp: 9 })).code).toBe('E_SCHEMA');
    expect(body(manager.step(created.session, created.epoch, rid(7), 1, { ...MOVE, seed: 1 })).code).toBe('E_SCHEMA');
    // Over-speed is normalized, not rejected, and cannot exceed unit speed.
    const fast = body(manager.step(created.session, created.epoch, rid(8), 10, { ...MOVE, move: { x: 1000, y: 0 } }));
    expect(fast.ok).toBe(true);
  });
});
