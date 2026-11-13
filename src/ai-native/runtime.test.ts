/**
 * AI-NATIVE-01 P1 — headless runtime tests + Reviewer B1..B7 regressions.
 *
 * Runtime verification only; no AI playthrough claim. No Phaser/DOM import.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  HeadlessGame, canonicalEvents, canonicalState, createGame, isRuntimeSnapshot, validateRestoreFrame,
  validateRuntimeAction, withHashes, type RuntimeAction, type RuntimeHasher,
} from './runtime';
import { hasHiddenField, validateObservationDetailed } from './protocol';
import { SliceModel } from '../slice/rules';
import { directionToIntent, resolveTransitions, stepMovement } from '../slice/sharedCore';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VITE_NODE = path.join(REPO, 'node_modules/vite-node/vite-node.mjs');
const CLI = path.join(REPO, 'src/ai-native/headlessCli.ts');
const hasher: RuntimeHasher = (canonical) => `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;

function game(seed = 7): HeadlessGame {
  return createGame({ scenario: 'station-zero', seed, mode: 'headless' });
}
function stepOk(g: HeadlessGame, actions: readonly RuntimeAction[], ticks: number): void {
  const result = g.step({ actions, ticks });
  if (!result.ok) throw new Error(`step failed: ${result.code} ${result.message}`);
}
function expectFailure(result: { ok: boolean; code?: string }, code: string): void {
  expect(result.ok).toBe(false);
  expect((result as { code?: string }).code).toBe(code);
}
function self(g: HeadlessGame) { return g.observe().current.self; }
function device(g: HeadlessGame) { return g.observe().current.publicDeviceState; }
function driveToCorridor(g: HeadlessGame): void {
  g.__testSetPosition(8.5, 5.5);
  expect(g.step({ actions: [], ticks: 1 }).ok).toBe(true);
  expect(self(g).passed).toBe(true);
  g.__testSetPosition(12.5, 5.5);
  expect(g.step({ actions: [], ticks: 1 }).ok).toBe(true);
  expect(g.observe().roomId).toBe('station-zero-r2');
}
function runCli(input: string, dev = true): string {
  return execFileSync(process.execPath, [VITE_NODE, CLI, '--run', ...(dev ? ['--dev'] : [])], {
    cwd: REPO, input, encoding: 'utf8', timeout: 120_000,
  });
}
function cliLines(input: string, dev = true): Array<Record<string, unknown>> {
  return runCli(input, dev).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Two-way line channel to one real CLI process (same instance across commands). */
class CliChannel {
  private readonly queue: string[] = [];
  private readonly waiters: Array<(line: string) => void> = [];
  private readonly child: ChildProcessWithoutNullStreams;
  readonly exit: Promise<number | null>;

  constructor(dev = true) {
    this.child = spawn(process.execPath, [VITE_NODE, CLI, '--run', ...(dev ? ['--dev'] : [])], {
      cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'],
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
      else this.queue.push(line);
    });
    this.exit = new Promise((resolve) => this.child.on('exit', (code) => resolve(code)));
  }

  write(command: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  next(): Promise<Record<string, unknown>> {
    const buffered = this.queue.shift();
    if (buffered !== undefined) return Promise.resolve(JSON.parse(buffered) as Record<string, unknown>);
    return new Promise((resolve) => {
      this.waiters.push((line) => resolve(JSON.parse(line) as Record<string, unknown>));
    });
  }
}

describe('determinism and instance isolation', () => {
  it('same seed + same ordered actions => identical canonical state and events', () => {
    const run = (): HeadlessGame => {
      const g = game(11);
      stepOk(g, [{ type: 'scan' }], 1);
      stepOk(g, [{ type: 'jam', target: 'door' }], 5);
      stepOk(g, [{ type: 'move', direction: 'down', ticks: 40 }], 40);
      stepOk(g, [{ type: 'wait' }], 10);
      return g;
    };
    const a = run();
    const b = run();
    expect(canonicalState(a.snapshot())).toBe(canonicalState(b.snapshot()));
    expect(canonicalEvents(a.snapshot())).toBe(canonicalEvents(b.snapshot()));
  });

  it('action input order does not change the deterministic result', () => {
    const a = game(12);
    const b = game(12);
    stepOk(a, [{ type: 'scan', id: 'a' }, { type: 'wait', id: 'b' }], 3);
    stepOk(b, [{ type: 'wait', id: 'b' }, { type: 'scan', id: 'a' }], 3);
    expect(canonicalState(a.snapshot())).toBe(canonicalState(b.snapshot()));
    expect(canonicalEvents(a.snapshot())).toBe(canonicalEvents(b.snapshot()));
  });

  it('different instances and seeds are isolated', () => {
    const a = game(1);
    const b = game(2);
    expect(a.snapshot().seed).toBe(1);
    expect(b.snapshot().seed).toBe(2);
    expect(a.snapshot().sessionId).not.toBe(b.snapshot().sessionId);
    stepOk(a, [{ type: 'scan' }], 1);
    stepOk(a, [{ type: 'move', direction: 'down', ticks: 30 }], 30);
    expect(b.tick).toBe(0);
    expect(self(b).energy).toBe(100);
    expect(self(b).position).toEqual({ x: 3.5, y: 5.5 });
    expect(self(a).position).not.toEqual(self(b).position);
  });
});

describe('fixed tick, pause and bounded execution', () => {
  it('pause freezes the tick and rejects step until resume', () => {
    const g = game();
    stepOk(g, [], 10);
    const t0 = g.tick;
    expect(g.pause().ok).toBe(true);
    expectFailure(g.step({ actions: [], ticks: 10 }), 'E_PAUSED');
    expect(g.tick).toBe(t0);
    expect(g.resume().ok).toBe(true);
    stepOk(g, [], 5);
    expect(g.tick).toBe(t0 + 5);
  });

  it('rejects out-of-range ticks, unknown fields/actions/actors and unsupported actions', () => {
    const g = game();
    expectFailure(g.step({ actions: [], ticks: 0 }), 'E_RESOURCE_LIMIT');
    expectFailure(g.step({ actions: [], ticks: 1001 }), 'E_RESOURCE_LIMIT');
    expectFailure(g.step({ actions: [], ticks: Number.NaN }), 'E_RESOURCE_LIMIT');
    expectFailure(g.step({ actions: [{ type: 'scan', extra: 1 }], ticks: 1 }), 'E_SCHEMA');
    expectFailure(g.step({ actions: [{ type: 'teleport' }], ticks: 1 }), 'E_SCHEMA');
    expectFailure(g.step({ actions: [{ type: 'scan', actor: 'admin' }], ticks: 1 }), 'E_UNKNOWN_ACTOR');
    expectFailure(g.step({ actions: [{ type: 'move', direction: 'sideways', ticks: 2 }], ticks: 1 }), 'E_SCHEMA');
    expectFailure(g.step({ actions: [{ type: 'move', direction: 'down', ticks: Number.POSITIVE_INFINITY }], ticks: 1 }), 'E_SCHEMA');
    for (const type of ['aim', 'fire', 'decoy']) {
      expectFailure(g.step({ actions: [{ type }], ticks: 1 }), 'E_NOT_APPLICABLE');
    }
    const tooMany = Array.from({ length: 33 }, (_, i) => ({ type: 'wait', id: `w${i}` }));
    expectFailure(g.step({ actions: tooMany, ticks: 1 }), 'E_RESOURCE_LIMIT');
    expect(validateRuntimeAction({ type: 'scan', ticks: 0 }).ok).toBe(true);
  });

  it('createGame rejects invalid options', () => {
    expect(() => createGame({ scenario: 'station-zero', seed: -1, mode: 'headless' })).toThrow();
    expect(() => createGame({ scenario: 'station-zero', seed: Number.NaN, mode: 'headless' })).toThrow();
    expect(() => createGame({ scenario: 'other' as 'station-zero', seed: 1, mode: 'headless' })).toThrow();
  });
});

describe('B1 — browser frame batch and Node per-tick transition commit are identical', () => {
  it('exact repro: passed=true pos(12.64,5.07) south 15 ticks', () => {
    const intent = directionToIntent('south');
    const run = (perTick: boolean) => {
      const model = new SliceModel();
      model.markPassed();
      model.setPlayerPos(12.64, 5.07);
      let enteredAtTick = -1;
      let entered = false;
      let advanced = 0;
      let tickCounter = 0;
      const commit = (before: ReturnType<SliceModel['snapshot']>): void => {
        tickCounter += 1;
        const t = resolveTransitions(model, before);
        if (t.enteredCorridor && !entered) { entered = true; enteredAtTick = tickCounter; }
      };
      if (perTick) {
        for (let i = 0; i < 15; i += 1) { advanced += model.advanceTicks(1, () => stepMovement(model, intent), commit); }
      } else {
        advanced = model.step(250, () => stepMovement(model, intent), commit);
      }
      return { advanced, entered, enteredAtTick, inCorridor: model.inCorridor, position: model.position };
    };
    const browser = run(false);
    const node = run(true);
    expect(browser.advanced).toBe(15);
    expect(browser.entered).toBe(true);
    expect(browser.enteredAtTick).toBe(1);
    expect(browser.inCorridor).toBe(true);
    expect(node.entered).toBe(true);
    expect(node.enteredAtTick).toBe(1);
    expect(node.inCorridor).toBe(true);
    expect(node.position).toEqual(browser.position);
  });

  it('SliceScene delegates transition decisions to the per-tick commit hook, not frame-end sampling', () => {
    const source = readFileSync(path.join(REPO, 'src/slice/SliceScene.ts'), 'utf8');
    expect(source).toMatch(/this\.model\.step\(delta, \(\) => this\.stepMovement\(\), \(before\) =>/);
    expect(source).toMatch(/resolveTransitions\(this\.model, before/);
  });
});

describe('shared movement and door progression', () => {
  it('move uses the shared fixed-speed/axis-collision entry and cannot pass a sealed door', () => {
    const g = game();
    stepOk(g, [{ type: 'move', direction: 'down', ticks: 200 }], 200);
    const pos = self(g).position;
    expect(pos.x).toBeLessThan(7);
    expect(pos.x).toBeGreaterThan(3.5);
  });

  it('passing the door then reaching the exit enters the corridor', () => {
    const g = game();
    driveToCorridor(g);
    expect(device(g).relay).toBe('INACTIVE');
    expect(device(g).bridge).toBe('UNAVAILABLE');
  });

  it('Jam expires and the door safely returns to SEALED', () => {
    const g = game();
    g.__testSetPosition(6.5, 5.5);
    stepOk(g, [{ type: 'jam', target: 'door' }], 1);
    expect(device(g).door).toBe('JAMMED_OPEN');
    stepOk(g, [], 360);
    expect(device(g).door).toBe('SAFE_PENDING_CLOSE');
    stepOk(g, [], 61);
    expect(device(g).door).toBe('SEALED');
  });
});

describe('corridor bridge and guard', () => {
  it('relay/bridge transition legally and never soft-locks after a collapse', () => {
    const g = game();
    driveToCorridor(g);
    g.__testSetPosition(9.5, 9.5);
    stepOk(g, [{ type: 'interact' }], 1);
    expect(device(g).bridge).toBe('TRANSITIONING');
    stepOk(g, [], 90);
    expect(device(g).bridge).toBe('STABLE');
    g.__testSetPosition(12.5, 9.5);
    stepOk(g, [{ type: 'jam', target: 'relay' }], 1);
    expect(device(g).bridge).toBe('UNSTABLE');
    stepOk(g, [], 90);
    const rescued = g.observe();
    expect(device(g).bridge).toBe('UNAVAILABLE');
    expect(self(g).position).toEqual({ x: 9.5, y: 9.5 });
    expect(self(g).hp).toBe(80);
    expect(rescued.current.self.crossed).toBe(false);
    stepOk(g, [], 360);
    stepOk(g, [], 90);
    expect(device(g).bridge).toBe('STABLE');
    expect(self(g).hp).toBeGreaterThan(0);
  });

  it('guard perceives a nearby player and deals damage through the existing FSM', () => {
    const g = game();
    driveToCorridor(g);
    g.__testSetPosition(5.5, 8.5);
    stepOk(g, [], 1);
    stepOk(g, [], 200);
    expect(self(g).hp).toBeLessThan(100);
  });

  it('jam silences guard perception; shoot_guard is a limited corridor-only capability', () => {
    const g = game();
    driveToCorridor(g);
    g.__testSetPosition(5.5, 8.5);
    stepOk(g, [{ type: 'jam', target: 'guard' }], 1);
    expect(device(g).guardLink).toBe('JAMMED');
    stepOk(g, [], 360);
    expect(device(g).guardLink).not.toBe('JAMMED');
    g.__testSetPosition(5.5, 8.5);
    stepOk(g, [{ type: 'shoot_guard' }], 11);
    stepOk(g, [{ type: 'shoot_guard' }], 11);
    expect(device(g).guardHp).toBe(0);
  });
});

describe('B2 — public observation is a P0 ObservationV1 whitelist projection', () => {
  it('lab and corridor observations pass P0 validation and hide no FSM state', () => {
    const g = game(7);
    g.__testSetPosition(6.5, 5.5);
    stepOk(g, [{ type: 'scan' }], 1);
    for (const observation of [g.observe(), (() => {
      g.__testSetPosition(8.5, 5.5);
      stepOk(g, [], 1);
      g.__testSetPosition(12.5, 5.5);
      stepOk(g, [], 1);
      stepOk(g, [{ type: 'scan' }], 1);
      return g.observe();
    })()]) {
      const validation = validateObservationDetailed(observation);
      expect(validation.ok).toBe(true);
      expect(hasHiddenField(observation, ['role'])).toBeNull();
      const text = JSON.stringify(observation);
      for (const banned of ['behavior', 'corridorReveal', 'revealDoorReceiver', 'revealSealSource', 'manualOpenIntent', 'rngState', 'seed', 'attackAt', 'jamUntil', 'watching']) {
        expect(text).not.toContain(banned);
      }
      expect(observation.omittedFieldCount).toBeGreaterThan(0);
    }
  });

  it('availableActions is derived from model state, not a fixed legal list', () => {
    const g = game();
    const before = g.observe().availableActions;
    expect(before.find((a) => a.type === 'scan')?.status).toBe('available');
    expect(before.find((a) => a.type === 'aim')?.status).toBe('unavailable');
    expect(before.find((a) => a.type === 'aim')?.reasonCode).toBe('E_NOT_APPLICABLE');
    g.__testSetPosition(6.5, 5.5);
    stepOk(g, [{ type: 'scan' }], 1);
    const after = g.observe().availableActions;
    const scan = after.find((a) => a.type === 'scan');
    expect(scan?.status).toBe('cooldown');
    expect(scan?.reasonCode).toBe('E_COOLDOWN');
    expect(before.find((a) => a.type === 'jam')?.status).toBe('available');
    expect(after.find((a) => a.type === 'jam')?.status).toBe('available');
  });

  it('completed is true only for RUN_COMPLETED, never for RUN_FAILED', () => {
    // Produce a REAL failure through the existing guard FSM (no forged frame).
    const g = game();
    driveToCorridor(g);
    g.__testSetPosition(5.5, 8.5);
    for (let i = 0; i < 10 && g.snapshot().status !== 'finished'; i += 1) {
      stepOk(g, [], 300);
    }
    const failedSnapshot = g.snapshot();
    expect(failedSnapshot.status).toBe('finished');
    expect(failedSnapshot.events.some((e) => e.type === 'RUN_FAILED')).toBe(true);
    expect(self(g).failed).toBe(true);
    expect(self(g).completed).toBe(false);
    // A legitimately issued failed frame can be restored and still reports failure.
    expect(g.restore(failedSnapshot).ok).toBe(true);
    expect(self(g).completed).toBe(false);
    expect(self(g).failed).toBe(true);
  });
});

describe('B3 + R9 evidence, snapshot/restore and replay', () => {
  it('Scan creates evidence; restore preserves it verbatim without scan and without extending TTL', () => {
    const g = game();
    g.__testSetPosition(6.5, 5.5);
    stepOk(g, [{ type: 'scan' }], 1);
    const before = g.snapshot();
    expect(before.model.evidence.length).toBeGreaterThan(0);
    const original = JSON.parse(JSON.stringify(before.model.evidence));
    stepOk(g, [], 10);
    expect(g.restore(before).ok).toBe(true);
    const after = g.snapshot();
    expect(after.model.evidence).toEqual(original);
    expect(after.model.evidenceRescanRequired).toBe(false);
    expect(after.model.evidence[0].expiresAtTick).toBe(original[0].expiresAtTick);
  });

  it('evidence expires by TTL and an old save requires a rescan', () => {
    const g = game();
    g.__testSetPosition(6.5, 5.5);
    stepOk(g, [{ type: 'scan' }], 1);
    stepOk(g, [], 481);
    expect(g.observe().evidence).toEqual([]);
  });

  it('entering the corridor discards R1 evidence', () => {
    const g = game();
    g.__testSetPosition(6.5, 5.5);
    stepOk(g, [{ type: 'scan' }], 1);
    expect(g.observe().evidence.length).toBeGreaterThan(0);
    driveToCorridor(g);
    expect(g.observe().roomId).toBe('station-zero-r2');
    expect(g.observe().evidence).toEqual([]);
    expect(g.snapshot().model.evidence).toEqual([]);
  });

  it('live-guard snapshot replay is deterministic and matches restore+steps', () => {
    const g = game();
    driveToCorridor(g);
    g.__testSetPosition(5.5, 8.5);
    stepOk(g, [{ type: 'jam', target: 'guard' }], 1);
    stepOk(g, [{ type: 'scan' }], 1);
    stepOk(g, [], 7);
    const snapshot = g.snapshot();
    expect(snapshot.model.corridor?.guard.health).toBeGreaterThan(0);
    const steps = [
      { actions: [{ type: 'shoot_guard' }] as readonly RuntimeAction[], ticks: 20 },
      { actions: [] as readonly RuntimeAction[], ticks: 120 },
      { actions: [{ type: 'move', direction: 'down' as const, ticks: 30 }] as readonly RuntimeAction[], ticks: 30 },
    ];
    const a = g.replay(snapshot, steps);
    const b = g.replay(snapshot, steps);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.canonicalState).toBe(b.value.canonicalState);
    expect(a.value.canonicalEvents).toBe(b.value.canonicalEvents);
    // Restore+step equivalence uses the SAME instance that issued the frame.
    expect(g.restore(snapshot).ok).toBe(true);
    for (const step of steps) stepOk(g, step.actions, step.ticks);
    expect(canonicalState(g.snapshot())).toBe(a.value.canonicalState);
    expect(canonicalEvents(g.snapshot())).toBe(a.value.canonicalEvents);
  });
});

describe('B4 — restore is issued-frame-bound, atomic and geometry-checked', () => {
  it('rejects a same-session legal-ground position change, even with recomputed public hashes', () => {
    const g = game(1);
    const issued = g.snapshot();
    const before = { tick: g.tick, position: self(g).position, status: g.snapshot().status };
    const moved = JSON.parse(JSON.stringify(issued)) as Record<string, any>;
    moved.model.playerX = 12.5; // legal floor coordinate, no wall, no fake passed flag
    moved.model.playerY = 5.5;
    // Content-level validation alone would pass; private issuance identity must reject.
    expect(validateRestoreFrame(moved, g.seed, g.sessionId, g.snapshot().rngState)).toBeNull();
    expectFailure(g.restore(moved), 'E_SNAPSHOT_INVALID');
    // Recompute BOTH public hashes: still not an authorization source.
    const rehashed = withHashes(moved as never, hasher);
    expectFailure(g.restore(rehashed), 'E_SNAPSHOT_INVALID');
    expect(g.tick).toBe(before.tick);
    expect(self(g).position).toEqual(before.position);
    expect(g.snapshot().status).toBe(before.status);
  });

  it('rejects an arbitrary teleport / fake passed flag', () => {
    const g = game(1);
    const snap = JSON.parse(JSON.stringify(g.snapshot()));
    snap.model.playerX = 12.5;
    snap.model.playerY = 5.5;
    snap.model.passed = true;
    expectFailure(g.restore(snap), 'E_SNAPSHOT_INVALID');
    expect(g.observe().roomId).toBe('station-zero-r1');
    expect(self(g).passed).toBe(false);
    expect(g.tick).toBe(0);
  });

  it('rejects cross-seed and same-seed foreign frames (not issued by this instance)', () => {
    const a = game(11);
    const b = game(22);
    expectFailure(b.restore(a.snapshot()), 'E_SNAPSHOT_INVALID');
    expect(b.snapshot().rngState).toBe(game(22).snapshot().rngState);
    expect(b.tick).toBe(0);
    // Same seed/session but a different instance -> still not issued by `b`.
    const c = game(11);
    expect(c.sessionId).toBe(a.sessionId);
    expectFailure(b.restore(c.snapshot()), 'E_SNAPSHOT_INVALID');
    expectFailure(c.restore(a.snapshot()), 'E_SNAPSHOT_INVALID');
  });

  it('content validation rejects wall positions, range, forged events and bad actionLog', () => {
    const g = game();
    const base = g.snapshot();
    const wall = { ...base, model: { ...base.model, playerX: 0.1, playerY: 0.1 } };
    expect(validateRestoreFrame(wall, g.seed, g.sessionId, g.snapshot().rngState)).toBeTruthy();
    expectFailure(g.restore(wall), 'E_SNAPSHOT_INVALID');
    const energy = { ...base, model: { ...base.model, energy: 1e9 } };
    expect(validateRestoreFrame(energy, g.seed, g.sessionId, g.snapshot().rngState)).toBeTruthy();
    expectFailure(g.restore(energy), 'E_SNAPSHOT_INVALID');
    const events = { ...base, events: Array.from({ length: 10001 }, (_, i) => ({
      eventSeq: i, tick: 0, phase: 0, ordinal: i, type: 'SESSION_CREATED', payload: {},
    })), eventSeq: 10001 };
    expect(isRuntimeSnapshot(events)).toBe(false);
    expectFailure(g.restore(events), 'E_SNAPSHOT_INVALID');
    const badLog = { ...base, actionLog: [{ type: 'scan', unknown: 1 }], actionSeq: 1 };
    expect(isRuntimeSnapshot(badLog)).toBe(false);
    expectFailure(g.restore(badLog), 'E_SNAPSHOT_INVALID');
    // Atomic: no failed restore contaminated the instance.
    expect(isRuntimeSnapshot(g.snapshot())).toBe(true);
    expect(g.tick).toBe(0);
    expect(self(g).energy).toBe(100);
  });

  it('closed schema rejects unknown top-level fields', () => {
    const g = game();
    const snap = { ...g.snapshot(), injected: true } as unknown;
    expect(isRuntimeSnapshot(snap)).toBe(false);
    expectFailure(g.restore(snap), 'E_SNAPSHOT_INVALID');
  });

  it('source mismatches are reported by validateRestoreFrame', () => {
    const g = game(5);
    const snap = g.snapshot();
    expect(validateRestoreFrame(snap, 5, g.sessionId, g.snapshot().rngState)).toBeNull();
    expect(validateRestoreFrame(snap, 6, g.sessionId, g.snapshot().rngState)).toContain('seed');
    expect(validateRestoreFrame(snap, 5, 'ses_000000000000000000000000', g.snapshot().rngState)).toContain('session');
  });

  it('multiple restores of one issued frame work; eviction is explicit and bounded', () => {
    const g = game(9);
    const issued = g.snapshot();
    expect(g.restore(issued).ok).toBe(true);
    expect(g.restore(issued).ok).toBe(true);
    const frames = [issued];
    for (let i = 0; i < 64; i += 1) frames.push(g.snapshot());
    // Oldest issued frame was evicted (cap 64).
    expectFailure(g.restore(frames[0]), 'E_SNAPSHOT_INVALID');
    expect(g.restore(frames[frames.length - 1]).ok).toBe(true);
  });

  it('rejects a corridor+passed frame whose DOOR_PASSED event was stripped', () => {
    const g = game(7);
    driveToCorridor(g);
    expect(g.snapshot().model.passed).toBe(true);
    const issued = g.snapshot();
    const stripped = JSON.parse(JSON.stringify(issued)) as Record<string, any>;
    stripped.events = [];
    stripped.eventSeq = 0;
    stripped.droppedEvents = 0;
    // Content validation still requires the door-pass proof even inside R2.
    expect(validateRestoreFrame(stripped, g.seed, g.sessionId, g.snapshot().rngState)).toContain('DOOR_PASSED');
    // Issuance identity also rejects the tampered frame; failure must not pollute.
    const before = g.snapshot();
    expectFailure(g.restore(stripped), 'E_SNAPSHOT_INVALID');
    expect(g.snapshot().status).toBe(before.status);
    expect(g.snapshot().tick).toBe(before.tick);
  });
});

describe('B5 — canonical hash is authoritative-state only', () => {
  it('source snapshot -> restore -> 0-step replay reproduces the same canonical hash', () => {
    const g = game(3);
    // Test-only internal field mutation BEFORE issuance, so the frame is legitimately issued.
    (g as unknown as { model: { accumulatorMs: number } }).model.accumulatorMs = 10;
    const source = g.snapshot();
    const c0 = canonicalState(source);
    const h0 = hasher(c0);
    expect(g.restore(source).ok).toBe(true);
    expect(canonicalState(g.snapshot())).toBe(c0);
    const replay = g.replay(source, []);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.canonicalState).toBe(c0);
    expect(hasher(replay.value.canonicalState)).toBe(h0);
    // epoch is transport metadata for gateway isolation, not simulation state.
    expect(g.snapshot().epoch).toBe(source.epoch + 1);
    expect(g.snapshot().model.accumulatorMs).toBe(10);
  });

  it('CLI 0-step replay hash equals the source snapshot hash', () => {
    const lines = cliLines([
      JSON.stringify({ cmd: 'create', id: 'g', seed: 42 }),
      JSON.stringify({ cmd: 'snapshot', id: 'g' }),
      JSON.stringify({ cmd: 'replay', id: 'g', steps: [] }),
      JSON.stringify({ cmd: 'quit' }),
    ].join('\n') + '\n');
    const snap = lines[1].snapshot as Record<string, unknown>;
    expect(snap.stateHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(lines[2].stateHash).toBe(snap.stateHash);
    expect(lines[2].eventsHash).toBe(snap.eventsHash);
  });
});

describe('B6 — CLI Dev channel identity (no audience upgrade)', () => {
  it('snapshot/replay/restore require the explicit --dev channel', () => {
    const input = [
      JSON.stringify({ cmd: 'create', id: 'g', seed: 42 }),
      JSON.stringify({ cmd: 'snapshot', id: 'g', audience: 'dev' }),
      JSON.stringify({ cmd: 'replay', id: 'g', steps: [] }),
      JSON.stringify({ cmd: 'restore', id: 'g', snapshot: {} }),
      JSON.stringify({ cmd: 'quit' }),
    ].join('\n') + '\n';
    const lines = cliLines(input, false);
    expect(lines[0]).toMatchObject({ ok: true, cmd: 'create' });
    expect(lines[0]).not.toHaveProperty('seed');
    expect(lines[1]).toMatchObject({ ok: false, code: 'E_PERMISSION' });
    expect(lines[2]).toMatchObject({ ok: false, code: 'E_PERMISSION' });
    expect(lines[3]).toMatchObject({ ok: false, code: 'E_PERMISSION' });
  });

  it('observe never leaks seed/RNG/full model even on the Dev channel', () => {
    const lines = cliLines([
      JSON.stringify({ cmd: 'create', id: 'g', seed: 42 }),
      JSON.stringify({ cmd: 'observe', id: 'g' }),
      JSON.stringify({ cmd: 'quit' }),
    ].join('\n') + '\n');
    const text = JSON.stringify(lines[1].observation);
    for (const hidden of ['seed', 'rngState', 'manualOpenIntent', 'regenAcc', 'accumulatorMs', 'behavior']) {
      expect(text).not.toContain(hidden);
    }
    expect(lines[1].observation).toMatchObject({ schema: 'last_signal.ai-native.observation.v1' });
  });

  it('CLI docs state seed/RNG only in the Dev channel', () => {
    const doc = readFileSync(path.join(REPO, 'docs/AI_NATIVE_RUNTIME.md'), 'utf8');
    expect(doc).toMatch(/--dev/);
    expect(doc).toMatch(/not MCP|不是 MCP/);
  });
});

describe('B7 — CLI strict schema and resource limits', () => {
  it('step/replay reject non-array actions/steps instead of silently using []', () => {
    const lines = cliLines([
      JSON.stringify({ cmd: 'create', id: 'g', seed: 42 }),
      JSON.stringify({ cmd: 'step', id: 'g', actions: 'east', ticks: 60 }),
      JSON.stringify({ cmd: 'replay', id: 'g', steps: 'nope' }),
      JSON.stringify({ cmd: 'quit' }),
    ].join('\n') + '\n');
    expect(lines[1]).toMatchObject({ ok: false, code: 'E_SCHEMA' });
    expect(lines[2]).toMatchObject({ ok: false, code: 'E_SCHEMA' });
  });

  it('enforces instance count, id length and JSON line size', () => {
    const cmds: string[] = [];
    for (let i = 0; i < 17; i += 1) cmds.push(JSON.stringify({ cmd: 'create', id: `g${i}`, seed: i }));
    cmds.push(JSON.stringify({ cmd: 'create', id: 'x'.repeat(33), seed: 1 }));
    cmds.push(JSON.stringify({ cmd: 'create', id: 'long', seed: 1, blob: 'a'.repeat(17000) }));
    cmds.push(JSON.stringify({ cmd: 'quit' }));
    const lines = cliLines(cmds.join('\n') + '\n');
    expect(lines[16]).toMatchObject({ ok: false, code: 'E_RESOURCE_LIMIT' });
    expect(lines[17]).toMatchObject({ ok: false, code: 'E_SCHEMA' });
    expect(lines[18]).toMatchObject({ ok: false, code: 'E_RESOURCE_LIMIT' });
  });

  it('restore requires hashes and only accepts this instance issued frame', async () => {
    const ch = new CliChannel(true);
    ch.write({ cmd: 'create', id: 'g', seed: 42 });
    expect(await ch.next()).toMatchObject({ ok: true, cmd: 'create' });
    ch.write({ cmd: 'snapshot', id: 'g' });
    const snap = (await ch.next()).snapshot as Record<string, any>;
    expect(snap.stateHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const noHash = JSON.parse(JSON.stringify(snap));
    delete noHash.stateHash;
    ch.write({ cmd: 'restore', id: 'g', snapshot: noHash });
    expect(await ch.next()).toMatchObject({ ok: false, code: 'E_SNAPSHOT_INVALID' });

    // A frame issued by a DIFFERENT instance (different seed + steps) is not in
    // this instance's private issuance record, even though its public hashes are
    // valid.
    const other = game(7);
    stepOk(other, [], 5);
    const foreign = withHashes(other.snapshot(), hasher);
    ch.write({ cmd: 'restore', id: 'g', snapshot: foreign });
    expect(await ch.next()).toMatchObject({ ok: false, code: 'E_SNAPSHOT_INVALID' });

    const moved = JSON.parse(JSON.stringify(snap));
    moved.model.playerX = 12.5;
    moved.model.playerY = 5.5;
    ch.write({ cmd: 'restore', id: 'g', snapshot: withHashes(moved as never, hasher) });
    expect(await ch.next()).toMatchObject({ ok: false, code: 'E_SNAPSHOT_INVALID' });

    ch.write({ cmd: 'restore', id: 'g', snapshot: snap });
    expect(await ch.next()).toMatchObject({ ok: true, cmd: 'restore' });
    ch.write({ cmd: 'quit' });
    expect(await ch.exit).toBe(0);
  });

  it('quit exits and cleans up without waiting for stdin EOF', async () => {
    const child = spawn(process.execPath, [VITE_NODE, CLI, '--run', '--dev'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    const exit = new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('quit did not exit')); }, 30_000);
      child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
    });
    child.stdin.write(JSON.stringify({ cmd: 'create', id: 'g', seed: 1 }) + '\n');
    child.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n');
    // Intentionally do NOT call child.stdin.end(): quit must close on its own.
    const code = await exit;
    expect(code).toBe(0);
  });
});

describe('purity and real Node CLI process', () => {
  it('runtime/sharedCore/fullState sources contain no renderer or Node crypto imports', () => {
    const files = ['runtime.ts', 'headlessCli.ts'].map((f) => path.join(REPO, 'src/ai-native', f))
      .concat(['sharedCore.ts', 'fullState.ts'].map((f) => path.join(REPO, 'src/slice', f)));
    for (const file of files) {
      if (file.endsWith('headlessCli.ts')) continue;
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/from ['"]phaser/);
      expect(source).not.toMatch(/\b(?:document|window|localStorage)\./);
      expect(source).not.toMatch(/from ['"](?:node:)?crypto['"]/);
    }
    expect(readFileSync(path.join(REPO, 'src/ai-native/headlessCli.ts'), 'utf8')).toMatch(/node:crypto/);
  });

  it('full CLI cycle: create/step/observe/snapshot/replay/pause/resume/close/quit', () => {
    const input = [
      JSON.stringify({ cmd: 'create', id: 'a', seed: 5 }),
      JSON.stringify({ cmd: 'step', id: 'a', actions: [{ type: 'scan' }], ticks: 2 }),
      JSON.stringify({ cmd: 'observe', id: 'a' }),
      JSON.stringify({ cmd: 'snapshot', id: 'a' }),
      JSON.stringify({ cmd: 'replay', id: 'a', steps: [{ actions: [], ticks: 1 }] }),
      JSON.stringify({ cmd: 'pause', id: 'a' }),
      JSON.stringify({ cmd: 'resume', id: 'a' }),
      JSON.stringify({ cmd: 'create', id: 'b', seed: 6 }),
      JSON.stringify({ cmd: 'close', id: 'b' }),
      JSON.stringify({ cmd: 'quit' }),
    ].join('\n') + '\n';
    const output = runCli(input);
    const lines = output.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.length).toBe(10);
    expect(lines[0]).toMatchObject({ ok: true, cmd: 'create', id: 'a', tick: 0 });
    expect(lines[1]).toMatchObject({ ok: true, cmd: 'step', advanced: 2 });
    expect(lines[2]).toMatchObject({ ok: true, cmd: 'observe' });
    expect(lines[3].snapshot).toMatchObject({ stateHash: expect.any(String) });
    expect(lines[4]).toMatchObject({ ok: true, cmd: 'replay' });
    expect(lines[5]).toMatchObject({ ok: true, cmd: 'pause' });
    expect(lines[6]).toMatchObject({ ok: true, cmd: 'resume' });
    expect(lines[8]).toMatchObject({ ok: true, cmd: 'close' });
    expect(lines[9]).toMatchObject({ ok: true, cmd: 'quit' });
  });
});
