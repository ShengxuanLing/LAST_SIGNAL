// C3c Task0 — export/replay "replayable" is a NARROW flag:
//   replayable = action-boundary AND the event history is NOT truncated.
// Truncation is exact: `eventTotal === retained` is NOT truncated.

import { describe, expect, it } from 'vitest';
import { isHistoryTruncated } from './worldHeadless';
import { HeadlessWorldManager } from './worldHeadlessMcpTools';

const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;
const body = (r: any): any => r.structuredContent ?? { ok: false, code: 'E_SCHEMA' };

function dev(): HeadlessWorldManager {
  let seed = 424242;
  return new HeadlessWorldManager(true, () => (seed += 1));
}

describe('C3c export flag — exact truncation predicate', () => {
  it('exactly at the retained cap is NOT truncated; one over is', () => {
    expect(isHistoryTruncated(20_000, 20_000)).toBe(false);
    expect(isHistoryTruncated(19_999, 20_000)).toBe(false);
    expect(isHistoryTruncated(20_001, 20_000)).toBe(true);
    expect(isHistoryTruncated(0, 0)).toBe(false);
  });
});

describe('C3c export flag — boundary and mid-execution', () => {
  it('a short boundary export is replayable with no truncation', async () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    const drone = body(manager.observe(created.session)).observation.drones[0];
    body(manager.action(created.session, created.epoch, rid(1), [
      { type: 'fire', actionId: aid(1), target: { x: drone.x, y: drone.y }, ticks: 60 }
    ], 600));
    body(manager.step(created.session, created.epoch, rid(2), 60));
    const exported = body(await manager.exportFailure(created.session, 'boundary-short'));
    expect(exported.boundary).toBe('action');
    expect(exported.eventsTruncated).toBe(false);
    expect(exported.replayable).toBe(true);
    expect(exported.diagnostics.eventsTruncated).toBe(false);
  });

  it('a mid-execution export is NOT replayable even when not truncated', async () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    const drone = body(manager.observe(created.session)).observation.drones[0];
    body(manager.action(created.session, created.epoch, rid(3), [
      { type: 'fire', actionId: aid(3), target: { x: drone.x, y: drone.y }, ticks: 120 }
    ], 600));
    body(manager.step(created.session, created.epoch, rid(4), 10));
    const exported = body(await manager.exportFailure(created.session, 'mid'));
    expect(exported.boundary).toBe('mid_execution');
    expect(exported.eventsTruncated).toBe(false);
    expect(exported.replayable).toBe(false);
    expect(exported.diagnostics.active.remainingTicks).toBe(110);
  });

  it('a boundary export with TRUNCATED history is NOT replayable and says so', async () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    // Sustain a real multi-drone wave so the real core emits far more than the
    // 20k retained window (each live drone emits a `drone-step` every tick).
    const spawnedEpoch = body(manager.spawnEnemies(created.session,
      ['drone', 'drone', 'drone', 'drone', 'drone', 'drone', 'drone', 'drone'])).epoch as number;
    for (let i = 0; i < 10; i += 1) {
      const step = body(manager.step(created.session, spawnedEpoch, rid(100 + i), 1000));
      expect(step.ok).toBe(true);
    }
    const inspect = body(manager.inspect(created.session));
    expect(inspect.manager.boundary, 'no active/queued action').toBe('action');
    const exported = body(await manager.exportFailure(created.session, 'boundary-truncated'));
    expect(exported.boundary).toBe('action');
    expect(exported.eventsTruncated).toBe(true);
    expect(exported.replayable).toBe(false);
    expect(String(exported.diagnostics.note)).toContain('HISTORY TRUNCATED');
    expect((exported.diagnostics as any).eventsTotal)
      .toBeGreaterThan((exported.diagnostics as any).eventsRetained);
  }, 120_000);

  it('a truncated snapshot still carries the exact truncation flag (history vs state)', async () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    const spawnedEpoch = body(manager.spawnEnemies(created.session,
      ['drone', 'drone', 'drone', 'drone', 'drone', 'drone', 'drone', 'drone'])).epoch as number;
    for (let i = 0; i < 10; i += 1) {
      body(manager.step(created.session, spawnedEpoch, rid(200 + i), 1000));
    }
    const snap = body(manager.snapshot(created.session));
    expect(snap.ok).toBe(true);
    expect(snap.eventsTruncated).toBe(true);
    expect(snap.eventsTotal).toBeGreaterThan(snap.eventsRetained);
    // The flag is about the HISTORY window, not the future state. (A 20k-event
    // frame can exceed the separate 2 MiB frame-size cap, so this test does not
    // assert restore of that oversized frame; `restore` reports E_RESOURCE_LIMIT
    // honestly instead of truncating state.)
    const restored = body(manager.restore(created.session, { ref: snap.ref }));
    if (!restored.ok) expect(restored.code).toBe('E_RESOURCE_LIMIT');
  }, 120_000);
});
