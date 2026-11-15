// C3c snapshot boundary fix: a Dev snapshot/restore is only legal at an ACTION
// BOUNDARY (no active execution, no queued action). Mid-execution is refused
// without cancelling/ACKing, so remaining ticks cannot be silently lost.

import { describe, expect, it } from 'vitest';
import { HeadlessWorldManager } from './worldHeadlessMcpTools';

const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;
const body = (r: any): any => r.structuredContent ?? { ok: false, code: 'E_SCHEMA' };

function dev(): HeadlessWorldManager {
  let seed = 424242;
  return new HeadlessWorldManager(true, () => (seed += 1));
}

function setup(manager: HeadlessWorldManager) {
  const created = body(manager.createSession(424242));
  const drone = body(manager.observe(created.session)).observation.drones[0];
  return { session: created.session as string, epoch: created.epoch as number, drone };
}

describe('C3c snapshot — action boundary only', () => {
  it('refuses a mid-execution snapshot without cancelling, ACKing or advancing', () => {
    const manager = dev();
    const { session, epoch, drone } = setup(manager);
    body(manager.action(session, epoch, rid(1), [
      { type: 'fire', actionId: aid(1), target: { x: drone.x, y: drone.y }, ticks: 120 }
    ], 600));
    const step10 = body(manager.step(session, epoch, rid(2), 10));
    expect(step10.executing.remainingTicks).toBe(110);
    const before = body(manager.inspect(session));
    const mid = body(manager.snapshot(session));
    expect(mid.ok).toBe(false);
    expect(mid.code).toBe('E_NOT_APPLICABLE');
    expect(mid.messageKey).toBe('world.snapshot_requires_action_boundary');
    const after = body(manager.inspect(session));
    // The refusal changed nothing: same tick, same active remaining, same ledger.
    expect(after.inspect.tick).toBe(before.inspect.tick);
    expect(after.manager.active.remainingTicks).toBe(110);
    expect(after.manager.active.executedTicks).toBe(10);
    expect(after.manager.ledger).toEqual(before.manager.ledger);
  });

  it('refuses a snapshot while an action is queued but not started', () => {
    const manager = dev();
    const { session, epoch, drone } = setup(manager);
    body(manager.action(session, epoch, rid(3), [
      { type: 'fire', actionId: aid(3), target: { x: drone.x, y: drone.y }, ticks: 60 }
    ], 600));
    const rejected = body(manager.snapshot(session));
    expect(rejected.ok).toBe(false);
    expect(rejected.code).toBe('E_NOT_APPLICABLE');
    // The queued action is preserved (still observable/queued), not dropped.
    const after = body(manager.inspect(session));
    expect(after.manager.queuedActions).toBe(1);
  });

  it('a completed boundary snapshot is restorable and restore bumps the epoch', () => {
    const manager = dev();
    const { session, epoch, drone } = setup(manager);
    body(manager.action(session, epoch, rid(4), [
      { type: 'fire', actionId: aid(4), target: { x: drone.x, y: drone.y }, ticks: 120 }
    ], 600));
    body(manager.step(session, epoch, rid(5), 10));
    const completed = body(manager.step(session, epoch, rid(6), 110));
    expect(completed.applied[0].executedTicks).toBe(120);
    const snap = body(manager.snapshot(session));
    expect(snap.ok).toBe(true);
    expect(snap.boundary).toBe('action');
    expect(snap.frame.boundary).toBe('action');
    const restored = body(manager.restore(session, snap.frame));
    expect(restored.ok).toBe(true);
    expect(restored.epoch).toBeGreaterThan(epoch);
    expect(body(manager.observe(session)).tick).toBe(snap.frame.sim.tick);
  });

  it('restore rejects a frame without the boundary marker and a mid-execution session', () => {
    const manager = dev();
    const { session, epoch, drone } = setup(manager);
    // Reach a boundary, then build a raw (unmarked) frame.
    const boundary = body(manager.snapshot(session));
    expect(boundary.ok).toBe(true);
    const rawFrame = { ...boundary.frame } as Record<string, unknown>;
    delete rawFrame.boundary;
    const rejectedFrame = body(manager.restore(session, rawFrame));
    expect(rejectedFrame.ok).toBe(false);
    expect(rejectedFrame.messageKey).toBe('world.snapshot_requires_action_boundary');

    // Now start an action and try to restore the (valid) boundary frame while
    // the current session is mid-execution: it must be refused.
    body(manager.action(session, epoch, rid(7), [
      { type: 'fire', actionId: aid(7), target: { x: drone.x, y: drone.y }, ticks: 120 }
    ], 600));
    body(manager.step(session, epoch, rid(8), 10));
    const rejectedBusy = body(manager.restore(session, boundary.frame));
    expect(rejectedBusy.ok).toBe(false);
    expect(rejectedBusy.messageKey).toBe('world.restore_requires_action_boundary');
    // The in-flight action is untouched.
    expect(body(manager.inspect(session)).manager.active.remainingTicks).toBe(110);
  });

  it('post-restore subsequent actions match the same sequence without restore', () => {
    const run = (withRestore: boolean) => {
      const manager = dev();
      const { session, epoch, drone } = setup(manager);
      body(manager.action(session, epoch, rid(10), [
        { type: 'fire', actionId: aid(10), target: { x: drone.x, y: drone.y }, ticks: 120 }
      ], 600));
      body(manager.step(session, epoch, rid(11), 10));
      body(manager.step(session, epoch, rid(12), 110));
      let currentEpoch = epoch;
      if (withRestore) {
        const snap = body(manager.snapshot(session));
        const restored = body(manager.restore(session, snap.frame));
        currentEpoch = restored.epoch;
      }
      body(manager.action(session, currentEpoch, rid(13), [
        { type: 'move', actionId: aid(13), dir: { x: 1, y: 0 }, ticks: 20 }
      ], 600));
      const after = body(manager.step(session, currentEpoch, rid(14), 20));
      // Events are immutable value DTOs, so the FULL history (baseline + new
      // segment) must match. This no longer relies on a "subsequent only" view.
      return {
        canonical: after.canonicalState as string,
        events: after.canonicalEvents as string,
        stepEvents: JSON.stringify(after.events),
        tick: after.toTick
      };
    };
    const plain = run(false);
    const restored = run(true);
    expect(restored.tick).toBe(plain.tick);
    expect(restored.canonical).toBe(plain.canonical);
    expect(restored.events, 'full history (baseline + continuation) matches').toBe(plain.events);
    expect(restored.stepEvents).toBe(plain.stepEvents);
  });

  it('exportFailure marks a mid-execution bundle as NOT replayable', async () => {
    const manager = dev();
    const { session, epoch, drone } = setup(manager);
    body(manager.action(session, epoch, rid(20), [
      { type: 'fire', actionId: aid(20), target: { x: drone.x, y: drone.y }, ticks: 120 }
    ], 600));
    body(manager.step(session, epoch, rid(21), 10));
    const partial = body(await manager.exportFailure(session, 'mid-execution'));
    expect(partial.ok).toBe(true);
    expect(partial.boundary).toBe('mid_execution');
    expect(partial.replayable).toBe(false);
    expect(partial.diagnostics.active.remainingTicks).toBe(110);
    expect(partial.diagnostics.queuedActions).toBe(0);
    expect(partial.diagnostics.note).toContain('INCOMPLETE');

    // Finish the action; the boundary export is replayable.
    body(manager.step(session, epoch, rid(22), 110));
    const full = body(await manager.exportFailure(session, 'boundary'));
    expect(full.boundary).toBe('action');
    expect(full.replayable).toBe(true);
  });

  it('inspect exposes manager execution state for diagnostics', () => {
    const manager = dev();
    const { session, epoch, drone } = setup(manager);
    body(manager.action(session, epoch, rid(30), [
      { type: 'fire', actionId: aid(30), target: { x: drone.x, y: drone.y }, ticks: 120 }
    ], 600));
    body(manager.step(session, epoch, rid(31), 10));
    const inspect = body(manager.inspect(session));
    expect(inspect.manager.boundary).toBe('mid_execution');
    expect(inspect.manager.active.actionId).toBe(aid(30));
    expect(inspect.manager.ledger.requests).toBeGreaterThan(0);
  });
});
