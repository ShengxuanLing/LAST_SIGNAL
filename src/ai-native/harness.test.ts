/**
 * AI-NATIVE-01 P3 — Developer Harness / MCP surface tests.
 *
 * These exercise the trusted harness directly (no transport): mode isolation,
 * closed fixtures, snapshot registry, scenario/batch/compare, cancellation and
 * malformed-input behaviour. The real MCP protocol is covered by the separate
 * official-SDK client gate (`mcpClient.mts`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionManager, type DevFixture } from './sessions';
import { Harness, toolMatrix, PLAYER_TOOLS, DEV_ONLY_TOOLS } from './harness';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const AID = (c: string): string => `aid_${c.repeat(24)}`;
const RID = (c: string): string => `req_${c.repeat(24)}`;
const SNAP0 = `snapref_${'0'.repeat(24)}`;

let managers: Array<ReturnType<typeof createSessionManager>> = [];
let harnesses: Harness[] = [];
afterEach(() => {
  for (const h of harnesses) h.dispose();
  for (const m of managers) { try { m.dispose(); } catch { /* ignore */ } }
  harnesses = [];
  managers = [];
});

function devHarness(): Harness {
  const manager = createSessionManager({ maxSessions: 10, idleTimeoutMs: 100000, maxSessionWallMs: 100000 });
  const harness = new Harness(manager, 'dev');
  managers.push(manager); harnesses.push(harness);
  return harness;
}
function playerHarness(): Harness {
  const manager = createSessionManager({ maxSessions: 10, idleTimeoutMs: 100000, maxSessionWallMs: 100000 });
  const harness = new Harness(manager, 'player');
  managers.push(manager); harnesses.push(harness);
  return harness;
}
function devSession(h: Harness, seed = 11): string {
  const res = h.createSession(seed);
  if (!res.ok) throw new Error(`create failed: ${res.code}`);
  return res.value.session;
}
function epochOf(h: Harness, session: string): number {
  const res = h.observe(session, 'summary');
  return res.ok ? res.value.epoch : -1;
}

describe('tool matrix / mode isolation', () => {
  it('player exposes only the player tools; dev adds the dev tools', () => {
    const player = toolMatrix(false);
    const dev = toolMatrix(true);
    expect(player).toEqual([...PLAYER_TOOLS]);
    expect(player).toHaveLength(6);
    for (const tool of ['game_snapshot', 'game_restore', 'game_run_scenario', 'game_inspect_state', 'game_inject_fixture']) {
      expect(player).not.toContain(tool);
      expect(dev).toContain(tool);
    }
    for (const tool of PLAYER_TOOLS) expect(dev).toContain(tool);
    expect(dev).toHaveLength(PLAYER_TOOLS.length + DEV_ONLY_TOOLS.length);
  });

  it('player harness refuses dev capabilities and seed elevation', async () => {
    const h = playerHarness();
    expect(h.createSession(1).ok).toBe(false);
    const created = h.createSession();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const session = created.value.session;
    expect(h.saveSnapshot(session).ok).toBe(false);
    expect(h.restoreSnapshot(session, SNAP0).ok).toBe(false);
    expect(h.inspect(session).ok).toBe(false);
    expect(h.injectFixture(session, { kind: 'named', name: 'lab_near_door' }).ok).toBe(false);
    expect((await h.runScenario({ seed: 1 })).ok).toBe(false);
    expect((await h.runBatch({ seeds: [1] })).ok).toBe(false);
    expect(h.compareRuns('run_x', 'run_y').ok).toBe(false);
    expect(h.loadScenario('station-zero').ok).toBe(false);
    expect((await h.executeAdvanced(session, { epoch: epochOf(h, session), type: 'wait_until' })).ok).toBe(false);
    expect(h.auditTail(session)).toEqual([]);
  });

  it('dev create requires a seed and produces a test session', () => {
    const h = devHarness();
    expect(h.createSession().ok).toBe(false);
    const res = h.createSession(42);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.kind).toBe('test');
  });

  it('unknown session handles are rejected without throwing', () => {
    const h = devHarness();
    const ghost = `ses_${'0'.repeat(24)}`;
    expect(() => h.observe(ghost)).not.toThrow();
    expect(h.observe(ghost).ok).toBe(false);
    expect(h.step(ghost, { epoch: epochOf(h, ghost), ticks: 1, actions: [] }).ok).toBe(false);
    expect(h.closeSession(ghost).ok).toBe(false);
  });
});

describe('closed dev fixtures', () => {
  it('named lab fixture applies, bumps epoch and is audited', () => {
    const h = devHarness();
    const session = devSession(h);
    const res = h.injectFixture(session, { kind: 'named', name: 'lab_near_door' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.tampered).toBe(true);
    expect(res.value.epoch).toBeGreaterThan(0);
    const inspect = h.inspect(session);
    expect(inspect.ok).toBe(true);
    if (inspect.ok) {
      const collision = inspect.value.collision as { position: { x: number; y: number }; standable: boolean };
      expect(collision.position).toEqual({ x: 6.5, y: 5.5 });
      expect(collision.standable).toBe(true);
      expect(inspect.value.devTampered).toBe(true);
    }
    const events = h.getEvents(session, 0, 64);
    expect(events.ok && events.value.events.some((e) => e.type === 'DEV_FIXTURE_INJECTED')).toBe(true);
  });

  it('door/energy fixtures are reflected in inspection', () => {
    const h = devHarness();
    const session = devSession(h);
    expect(h.injectFixture(session, { kind: 'door', state: 'OPEN' }).ok).toBe(true);
    expect(h.injectFixture(session, { kind: 'player', energy: 10 }).ok).toBe(true);
    const inspect = h.inspect(session);
    expect(inspect.ok).toBe(true);
    if (inspect.ok) {
      expect((inspect.value.signal as { door: string }).door).toBe('OPEN');
      expect((inspect.value.fullState as { energy: number }).energy).toBe(10);
    }
  });

  it('a fixture bumps the epoch so old-epoch actions are rejected', () => {
    const h = devHarness();
    const session = devSession(h);
    expect(h.injectFixture(session, { kind: 'named', name: 'lab_low_energy' }).ok).toBe(true);
    const stale = h.step(session, { ticks: 1, actions: [], epoch: 0, fromTick: 0, targetTick: 1 });
    expect(stale.ok ? null : stale.code).toBe('E_STALE_EPOCH');
  });

  it('corridor fixture exposes Guard/signal/collision readings', () => {
    const h = devHarness();
    const session = devSession(h, 11);
    const route: Array<[string | null, Record<string, unknown> | null, number]> = [
      ['move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 60 }, 60],
      ['scan', { type: 'scan' }, 1],
      ['jam', { type: 'jam', targetId: 'tgt_lab_door_receiver' }, 1],
      ['move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 40 }, 40],
      ['move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 100 }, 100],
      [null, null, 1],
    ];
    for (const [type, payload, ticks] of route) {
      const actions = type && payload ? [{ type: type as never, payload: payload as never }] : [];
      expect(h.step(session, { epoch: epochOf(h, session), ticks, actions }).ok).toBe(true);
    }
    const obs = h.observe(session, 'summary');
    expect(obs.ok && obs.value.roomId).toBe('station-zero-r2');
    expect(h.injectFixture(session, { kind: 'named', name: 'corridor_ready' }).ok).toBe(true);
    const inspect = h.inspect(session);
    expect(inspect.ok).toBe(true);
    if (inspect.ok) {
      expect((inspect.value.guard as { health: number }).health).toBe(0);
      expect((inspect.value.signal as { bridge: string }).bridge).toBe('STABLE');
      expect((inspect.value.collision as { inCorridor: boolean }).inCorridor).toBe(true);
    }
  });

  it('rejects illegal fixtures (bad position / guard without corridor / unknown shape)', () => {
    const h = devHarness();
    const session = devSession(h);
    expect(h.injectFixture(session, { kind: 'player', x: 0.1, y: 0.1 }).ok).toBe(false);
    expect(h.injectFixture(session, { kind: 'guard', hp: 0 }).ok).toBe(false);
    expect(h.injectFixture(session, { kind: 'named', name: 'corridor_ready' }).ok).toBe(false);
    expect(() => h.injectFixture(session, {} as DevFixture)).not.toThrow();
    expect(h.injectFixture(session, {} as DevFixture).ok).toBe(false);
  });
});

describe('snapshot registry', () => {
  it('save -> step -> restore reverts the tick; foreign/cross-session handles are rejected', () => {
    const h = devHarness();
    const a = devSession(h, 111);
    const b = devSession(h, 222);
    const saved = h.saveSnapshot(a);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const before = saved.value.tick;
    const step = h.step(a, { epoch: epochOf(h, a), ticks: 5, actions: [] });
    expect(step.ok).toBe(true);
    const restored = h.restoreSnapshot(a, saved.value.snapshot);
    expect(restored.ok && restored.value.tick).toBe(before);
    const cross = h.restoreSnapshot(b, saved.value.snapshot);
    expect(cross.ok ? null : cross.code).toBe('E_SNAPSHOT_INVALID');
    const foreign = h.restoreSnapshot(a, SNAP0);
    expect(foreign.ok ? null : foreign.code).toBe('E_SNAPSHOT_INVALID');
  });

  it('bounds the snapshot registry with FIFO eviction (P1 64-frame boundary)', () => {
    const h = devHarness();
    const session = devSession(h);
    const handles: string[] = [];
    let evicted = 0;
    for (let i = 0; i < 65; i += 1) {
      const res = h.saveSnapshot(session);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      handles.push(res.value.snapshot);
      evicted += res.value.evicted.length;
    }
    expect(evicted).toBeGreaterThanOrEqual(1);
    expect(h.restoreSnapshot(session, handles[0]).ok).toBe(false);
    expect(h.restoreSnapshot(session, handles[handles.length - 1]).ok).toBe(true);
  });

  it('snapshot provenance marks dev-tampered runs', () => {
    const h = devHarness();
    const session = devSession(h);
    expect(h.injectFixture(session, { kind: 'named', name: 'lab_low_energy' }).ok).toBe(true);
    const saved = h.saveSnapshot(session);
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value.provenance.devTampered).toBe(true);
      expect(saved.value.provenance.fixtures).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('step idempotency + replay', () => {
  it('an identical request retry returns the original StepResult with no tick advance', () => {
    const h = devHarness();
    const session = devSession(h);
    const action = { actionId: AID('a'), type: 'wait' as const, payload: { type: 'wait', durationTicks: 2 } as never };
    const request = { ticks: 2, actions: [action], requestId: RID('b'), fromTick: 0, targetTick: 1, epoch: 0 };
    const first = h.step(session, request);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const retry = h.step(session, request);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.value).toEqual(first.value);
    const obs = h.observe(session, 'summary');
    expect(obs.ok && obs.value.tick).toBe(2);
  });

  it('a repeated actionId is replayed without re-execution/charge', () => {
    const h = devHarness();
    const session = devSession(h);
    const action = { actionId: AID('c'), type: 'scan' as const, payload: { type: 'scan' } as never };
    const first = h.executeAction(session, { epoch: epochOf(h, session), ticks: 1, actions: [], action });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = h.executeAction(session, { epoch: epochOf(h, session), ticks: 1, actions: [], action });
    expect(second.ok).toBe(true);
    if (second.ok && second.value.result) {
      expect(second.value.result.replayed).toBe(true);
      expect(second.value.result.resourceWritesThisCall).toBe(0);
    }
  });

  it('replay re-executes deterministically and a different step list diverges', () => {
    const h = devHarness();
    const session = devSession(h);
    const a = h.replay(session, [{ actions: [], ticks: 2 }]);
    const b = h.replay(session, [{ actions: [], ticks: 2 }]);
    const c = h.replay(session, [{ actions: [{ type: 'wait', ticks: 5 }], ticks: 5 }]);
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(a.value.canonicalState).toBe(b.value.canonicalState);
      expect(c.value.canonicalState).not.toBe(a.value.canonicalState);
    }
  });
});

describe('MCP request idempotency (original tool args)', () => {
  it('same requestId + same step args returns the original receipt without advancing', () => {
    const h = devHarness();
    const session = devSession(h);
    const requestId = RID('d');
    const first = h.step(session, { epoch: epochOf(h, session), ticks: 1, actions: [], requestId });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const tick1 = first.value.toTick;
    const retry = h.step(session, { epoch: epochOf(h, session), ticks: 1, actions: [], requestId });
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.value).toEqual(first.value);
      expect(retry.value.toTick).toBe(tick1);
    }
    const obs = h.observe(session, 'summary');
    expect(obs.ok && obs.value.tick).toBe(tick1);
  });

  it('same requestId + different step args conflicts', () => {
    const h = devHarness();
    const session = devSession(h);
    const requestId = RID('e');
    expect(h.step(session, { epoch: epochOf(h, session), ticks: 1, actions: [], requestId }).ok).toBe(true);
    const conflict = h.step(session, { epoch: epochOf(h, session), ticks: 2, actions: [], requestId });
    expect(conflict.ok ? null : conflict.code).toBe('E_ID_PAYLOAD_MISMATCH');
  });

  it('same execute_action requestId + same action (no actionId) replays; different action conflicts', () => {
    const h = devHarness();
    const session = devSession(h);
    const requestId = RID('f');
    const action = { type: 'wait' as const, payload: { type: 'wait', durationTicks: 1 } as never };
    const first = h.executeAction(session, { epoch: epochOf(h, session), ticks: 1, actions: [], action, requestId });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const retry = h.executeAction(session, { epoch: epochOf(h, session), ticks: 1, actions: [], action, requestId });
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.value.step).toEqual(first.value.step);
    const conflict = h.executeAction(session, { epoch: epochOf(h, session),
      ticks: 1, actions: [], requestId,
      action: { type: 'wait' as const, payload: { type: 'wait', durationTicks: 2 } as never },
    });
    expect(conflict.ok ? null : conflict.code).toBe('E_ID_PAYLOAD_MISMATCH');
  });

  it('caches a failed first receipt and returns it on retry', () => {
    const h = devHarness();
    const session = devSession(h);
    const requestId = RID('a');
    const bad = h.step(session, { epoch: epochOf(h, session), ticks: 1, actions: [], requestId, fromTick: 5, targetTick: 6 });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const retry = h.step(session, { epoch: epochOf(h, session), ticks: 1, actions: [], requestId, fromTick: 5, targetTick: 6 });
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.code).toBe(bad.code);
    const obs = h.observe(session, 'summary');
    expect(obs.ok && obs.value.tick).toBe(0);
  });

  it('isolates the same requestId per session', () => {
    const h = devHarness();
    const a = devSession(h, 11);
    const b = devSession(h, 22);
    const requestId = RID('9');
    const ra = h.step(a, { epoch: epochOf(h, a), ticks: 1, actions: [], requestId });
    const rb = h.step(b, { epoch: epochOf(h, b), ticks: 1, actions: [], requestId });
    expect(ra.ok && rb.ok).toBe(true);
    if (ra.ok && rb.ok) {
      expect(ra.value.toTick).toBe(1);
      expect(rb.value.toTick).toBe(1);
    }
    const ra2 = h.step(a, { epoch: epochOf(h, a), ticks: 1, actions: [], requestId });
    expect(ra2.ok && ra2.value.toTick).toBe(1);
  });

  it('a fixture epoch change rejects old-epoch requests and does not replay the old cache', () => {
    const h = devHarness();
    const session = devSession(h);
    const requestId = RID('7');
    const first = h.step(session, { epoch: epochOf(h, session), ticks: 1, actions: [], requestId });
    expect(first.ok && first.value.toTick).toBe(1);
    expect(h.injectFixture(session, { kind: 'named', name: 'lab_low_energy' }).ok).toBe(true);
    const oldEpoch = h.step(session, { ticks: 1, actions: [], requestId, epoch: 0 });
    expect(oldEpoch.ok ? null : oldEpoch.code).toBe('E_STALE_EPOCH');
    const noEpoch = h.step(session, { ticks: 1, actions: [], requestId } as never);
    expect(noEpoch.ok ? null : noEpoch.code).toBe('E_SCHEMA');
    const tickAfterRejects = h.observe(session, 'summary');
    expect(tickAfterRejects.ok && tickAfterRejects.value.tick).toBe(1);
    const newEpoch = h.step(session, { epoch: epochOf(h, session), ticks: 1, actions: [], requestId });
    expect(newEpoch.ok).toBe(true);
    if (newEpoch.ok) expect(newEpoch.value.fromTick).toBe(1);
  });

  it('step and execute_action use separate request namespaces', () => {
    const h = devHarness();
    const session = devSession(h);
    const requestId = RID('6');
    const step = h.step(session, { epoch: epochOf(h, session), ticks: 1, actions: [], requestId });
    expect(step.ok).toBe(true);
    const exec = h.executeAction(session, { epoch: epochOf(h, session),
      ticks: 1, actions: [], requestId,
      action: { type: 'wait' as const, payload: { type: 'wait', durationTicks: 1 } as never },
    });
    expect(exec.ok).toBe(true);
    if (step.ok && exec.ok) expect(exec.value.step.fromTick).toBe(step.value.toTick);
  });
});

describe('required epoch contract', () => {
  it('rejects a missing epoch on step / execute_action / executeAdvanced without state change', async () => {
    const h = devHarness();
    const session = devSession(h);
    const before = h.observe(session, 'summary');
    const noStep = h.step(session, { ticks: 1, actions: [] } as never);
    expect(noStep.ok ? null : noStep.code).toBe('E_SCHEMA');
    const noExec = h.executeAction(session, {
      ticks: 1, actions: [],
      action: { type: 'wait' as const, payload: { type: 'wait', durationTicks: 1 } as never },
    } as never);
    expect(noExec.ok ? null : noExec.code).toBe('E_SCHEMA');
    const noAdvanced = await h.executeAdvanced(session, { type: 'wait_until' } as never);
    expect(noAdvanced.ok ? null : noAdvanced.code).toBe('E_SCHEMA');
    const after = h.observe(session, 'summary');
    expect(after.ok && before.ok && after.value.tick).toBe(before.ok ? before.value.tick : -1);
    expect(after.ok && before.ok && after.value.current.self.energy).toBe(before.ok ? before.value.current.self.energy : -1);
  });

  it('rejects a NaN or old epoch and accepts the current epoch', () => {
    const h = devHarness();
    const session = devSession(h);
    const epoch = epochOf(h, session);
    const nanEpoch = h.step(session, { epoch: NaN, ticks: 1, actions: [] });
    expect(nanEpoch.ok ? null : nanEpoch.code).toBe('E_SCHEMA');
    const oldEpoch = h.step(session, { epoch: 99, ticks: 1, actions: [] });
    expect(oldEpoch.ok ? null : oldEpoch.code).toBe('E_STALE_EPOCH');
    expect(h.step(session, { epoch, ticks: 1, actions: [] }).ok).toBe(true);
  });

  it('restore bumps the epoch; old/missing requests are rejected and the new epoch executes', () => {
    const h = devHarness();
    const session = devSession(h);
    const epoch0 = epochOf(h, session);
    expect(h.step(session, { epoch: epoch0, ticks: 1, actions: [] }).ok).toBe(true);
    const snap = h.saveSnapshot(session);
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    const restored = h.restoreSnapshot(session, snap.value.snapshot);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.epoch).toBeGreaterThan(epoch0);
    const newEpoch = restored.value.epoch;
    const staleAfterRestore = h.step(session, { epoch: epoch0, ticks: 1, actions: [] });
    expect(staleAfterRestore.ok ? null : staleAfterRestore.code).toBe('E_STALE_EPOCH');
    const missingAfterRestore = h.step(session, { ticks: 1, actions: [] } as never);
    expect(missingAfterRestore.ok ? null : missingAfterRestore.code).toBe('E_SCHEMA');
    const fresh = h.step(session, { epoch: newEpoch, ticks: 1, actions: [] });
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(fresh.value.fromTick).toBe(restored.value.tick);
  });
});

describe('scenario / batch / compare', () => {
  it('same seed reproduces state and gameplay events; a different seed changes only state', async () => {
    const h = devHarness();
    const a = await h.runScenario({ seed: 11 });
    const b = await h.runScenario({ seed: 11 });
    const c = await h.runScenario({ seed: 12 });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;
    expect(a.value.completed).toBe(true);
    expect(a.value.stateHash).toBe(b.value.stateHash);
    expect(a.value.eventsHash).toBe(b.value.eventsHash);
    expect(c.value.stateHash).not.toBe(a.value.stateHash);
    expect(c.value.eventsHash).toBe(a.value.eventsHash);
    const same = h.compareRuns(a.value.runId, b.value.runId);
    expect(same.ok).toBe(true);
    if (same.ok) {
      expect(same.value.sameState).toBe(true);
      expect(same.value.sameEvents).toBe(true);
      expect(same.value.firstDivergence).toBeNull();
    }
    const diff = h.compareRuns(a.value.runId, c.value.runId);
    expect(diff.ok).toBe(true);
    if (diff.ok) {
      expect(diff.value.sameState).toBe(false);
      expect(diff.value.sameEvents).toBe(true);
      expect(diff.value.firstDivergence).toBeNull();
    }
    expect(a.value.provenance.playerLegal).toBe(false);
    expect(a.value.provenance.dev).toBe(true);
  });

  it('run_batch isolates seeds, cleans sessions up, and rejects invalid inputs', async () => {
    const h = devHarness();
    const batch = await h.runBatch({ seeds: [11, 12] });
    expect(batch.ok).toBe(true);
    if (batch.ok) {
      expect(batch.value).toHaveLength(2);
      expect(batch.value.every((r) => r.ok)).toBe(true);
    }
    expect(h.size).toBe(0);
    expect(h.manager.size).toBe(0);
    expect(h.compareRuns('run_x', 'run_y').ok).toBe(false);
    expect((await h.runScenario({ seed: 1, strategy: 'nope' })).ok).toBe(false);
    expect((await h.runScenario({ seed: -1 })).ok).toBe(false);
  });

  it('a tiny budget stops the run without throwing', async () => {
    const h = devHarness();
    const res = await h.runScenario({ seed: 11, maxTicks: 10 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.completed).toBe(false);
      expect(res.value.ticks).toBeLessThanOrEqual(10);
    }
  });

  it('load_scenario only accepts the registered template', () => {
    const h = devHarness();
    expect(h.loadScenario('station-zero').ok).toBe(true);
    expect(h.loadScenario('../../etc/passwd').ok).toBe(false);
    expect(h.loadScenario('other').ok).toBe(false);
  });
});

describe('advanced action cancellation / timeout', () => {
  it('cancels an in-flight advanced action by its observable actionId', async () => {
    const h = devHarness();
    const session = devSession(h);
    const started = await h.executeAdvanced(session, { epoch: epochOf(h, session), type: 'wait_until', maxTicks: 1000, wait: false });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const before = h.observe(session, 'summary');
    const cancel = h.cancelAdvanced(session, started.value.actionId as never);
    expect(cancel.ok).toBe(true);
    await sleep(80);
    const after = h.observe(session, 'summary');
    expect(before.ok && after.ok && after.value.tick).toBe(before.ok ? before.value.tick : -1);
    expect(h.cancelAdvanced(session, AID('f') as never).ok).toBe(false);
  });

  it('times out a bounded advanced action', async () => {
    const h = devHarness();
    const session = devSession(h);
    const res = await h.executeAdvanced(session, { epoch: epochOf(h, session), type: 'wait_until', maxTicks: 1000, maxWallMs: 50, wait: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.result?.code).toBe('E_TIMEOUT');
  });
});

describe('malformed input never throws', () => {
  it('bad ticks/actions/fixtures return schema errors', () => {
    const h = devHarness();
    const session = devSession(h);
    expect(() => h.step(session, { epoch: epochOf(h, session), ticks: NaN, actions: [] })).not.toThrow();
    expect(h.step(session, { epoch: epochOf(h, session), ticks: NaN, actions: [] }).ok).toBe(false);
    expect(() => h.step(session, { epoch: epochOf(h, session), ticks: 1, actions: null as never })).not.toThrow();
    expect(h.step(session, { epoch: epochOf(h, session), ticks: 1, actions: null as never }).ok).toBe(false);
    expect(() => h.getEvents(session, -5, 0)).not.toThrow();
  });
});
