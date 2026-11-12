/**
 * AI-NATIVE-01 P2 — Session / Observation / Action Gateway tests (fix round).
 *
 * Real capability handles (PLAYER / OWNER / TEST / COMPANION), P0 closed-schema
 * StepRequest input, strict session/epoch/fromTick/targetTick binding, request
 * and action idempotency, bounded advanced actions with cancelAction, and the
 * full production door/bridge route to completion.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createSessionManager, type SessionManager, type PlayerSessionHandle,
  type TestSessionHandle, type OwnerSessionHandle, type CompanionSessionHandle,
  type AdvancedActionHandle,
} from './sessions';
import {
  validateObservationDetailed, hasHiddenField,
  type ActionRequestV1, type StepRequestV1, type ObservationV1,
} from './protocol';
import { canonicalState } from './runtime';

const DTO = 'last_signal.ai-native.dto.v1';
const SEED = 0x5eed1;
let idc = 0;
const hex24 = (): string => (++idc).toString(16).padStart(24, '0');
const aid = (): ActionRequestV1['actionId'] => `aid_${hex24()}` as ActionRequestV1['actionId'];
const rid = (): StepRequestV1['requestId'] => `req_${hex24()}` as StepRequestV1['requestId'];

function makeManager(opts: Record<string, unknown> = {}): SessionManager {
  return createSessionManager({ maxSessions: 10, idleTimeoutMs: 100000, maxSessionWallMs: 100000, ...opts });
}
function ownerOf(m: SessionManager, h: { sessionId: string }): OwnerSessionHandle {
  const owner = m.createOwnerHandle(h.sessionId);
  if (!owner) throw new Error('owner handle missing');
  return owner;
}
function tickOf(h: PlayerSessionHandle): number {
  const r = h.observe('summary');
  return r.ok ? r.value.tick : -1;
}
function epochOf(h: PlayerSessionHandle): number {
  const r = h.observe('summary');
  return r.ok ? r.value.epoch : -1;
}
function selfOf(h: PlayerSessionHandle): ObservationV1['current']['self'] | null {
  const r = h.observe('summary');
  return r.ok ? r.value.current.self : null;
}
function action(
  h: PlayerSessionHandle,
  type: ActionRequestV1['type'],
  payload: ActionRequestV1['payload'],
  opts: { id?: string; epoch?: number; targetTick?: number } = {},
): ActionRequestV1 {
  const tick = tickOf(h);
  const targetTick = opts.targetTick ?? tick + 1;
  return {
    schema: DTO, protocolVersion: 1,
    actionId: (opts.id ?? aid()) as ActionRequestV1['actionId'],
    actorId: h.actorId, sessionId: h.sessionId as ActionRequestV1['sessionId'],
    epoch: opts.epoch ?? epochOf(h), targetTick, type, payload,
    clientSeq: 0, issuedAtMs: 0, deadlineTick: targetTick,
  };
}
function stepReq(
  h: PlayerSessionHandle,
  actions: ActionRequestV1[],
  ticks: number,
  extra: Record<string, unknown> = {},
): StepRequestV1 {
  return {
    schema: DTO, protocolVersion: 1, requestId: rid(),
    sessionId: h.sessionId as StepRequestV1['sessionId'], epoch: epochOf(h),
    fromTick: tickOf(h), ticks, actions, includeObservation: true, observationDetail: 'standard',
    ...extra,
  } as StepRequestV1;
}
function move(h: PlayerSessionHandle, dir: { x: number; y: number }, ticks: number, id?: string): ActionRequestV1 {
  return action(h, 'move', { type: 'move', direction: dir, durationTicks: ticks }, { id });
}

let manager: SessionManager;
beforeEach(() => { manager = makeManager(); });
afterEach(() => { manager.dispose(); });

// ---------------------------------------------------------------------------
// Trusted entry / capability split
// ---------------------------------------------------------------------------
describe('trusted entry / capability split', () => {
  it('PLAYER handle has actions/observe/cancel/start/close but no pause/resume/reset/dev', () => {
    const p = manager.createProductionSession();
    for (const k of ['step', 'observe', 'getEvents', 'cancelAction', 'start', 'close', 'moveTo', 'approach', 'scanTarget', 'interactWith', 'waitUntil']) {
      expect(typeof (p as unknown as Record<string, unknown>)[k]).toBe('function');
    }
    for (const k of ['pause', 'resume', 'reset', 'snapshot', 'restore', 'replay', 'inspectState', 'injectFixture', 'createOwnerHandle', 'owner']) {
      expect(k in p).toBe(false);
    }
  });

  it('trusted OWNER handle owns pause/resume/reset and cannot be obtained from the Player handle', () => {
    const p = manager.createProductionSession();
    const owner = manager.createOwnerHandle(p.sessionId);
    expect(owner).not.toBeNull();
    expect(owner!.capability).toBe('OWNER');
    for (const k of ['start', 'pause', 'resume', 'reset', 'close']) {
      expect(typeof (owner as unknown as Record<string, unknown>)[k]).toBe('function');
    }
    expect((p as unknown as Record<string, unknown>).owner).toBeUndefined();
  });

  it('TEST handle adds only the dev/test facet', () => {
    const t = manager.createTestSession({ seed: SEED });
    for (const k of ['snapshot', 'restore', 'replay', 'inspectState', 'injectFixture']) {
      expect(typeof (t as unknown as Record<string, unknown>)[k]).toBe('function');
    }
    expect('pause' in t).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B1 — P0 closed-schema StepRequest entry
// ---------------------------------------------------------------------------
describe('B1 — StepRequest uses the P0 closed schema', () => {
  let p: PlayerSessionHandle;
  beforeEach(() => { p = manager.createTestSession({ seed: SEED }); ownerOf(manager, p).start(); });

  function expectSchemaReject(request: unknown): void {
    const before = tickOf(p);
    let res: ReturnType<PlayerSessionHandle['step']>;
    expect(() => { res = p.step(request as StepRequestV1); }).not.toThrow();
    expect(res!.ok).toBe(false);
    expect(res!.ok ? null : res!.error.code).toBe('E_SCHEMA');
    expect(tickOf(p)).toBe(before);
  }

  it('rejects non-array / null / undefined actions without throwing', () => {
    for (const bad of ['not-an-array', null, undefined, 42, {}]) {
      expectSchemaReject({ ...stepReq(p, [], 1), actions: bad });
    }
  });

  it('rejects unknown request fields (role/dev/audience/kind/seed/fixture)', () => {
    for (const key of ['role', 'dev', 'audience', 'kind', 'seed', 'fixture']) {
      expectSchemaReject({ ...stepReq(p, [], 1), [key]: key === 'role' ? 'DEVELOPER' : true });
    }
  });

  it('rejects NaN/Infinity/negative/fractional/undefined ticks and bad types', () => {
    for (const bad of [NaN, Infinity, -1, 1.5, undefined, '1']) {
      expectSchemaReject({ ...stepReq(p, [], 1), ticks: bad });
    }
    expectSchemaReject({ ...stepReq(p, [], 1), fromTick: '0' });
    expectSchemaReject({ ...stepReq(p, [], 1), epoch: NaN });
    expectSchemaReject({ ...stepReq(p, [], 1), sessionId: 'not-a-session' });
    expectSchemaReject(null);
  });
});

// ---------------------------------------------------------------------------
// B2 — session / epoch / tick binding
// ---------------------------------------------------------------------------
describe('B2 — StepRequest and action binding', () => {
  let p: PlayerSessionHandle;
  beforeEach(() => { p = manager.createTestSession({ seed: SEED }); ownerOf(manager, p).start(); });

  it('rejects a foreign request sessionId without executing', () => {
    const before = tickOf(p);
    const res = p.step({ ...stepReq(p, [], 2), sessionId: `ses_${'b'.repeat(24)}` });
    expect(res.ok).toBe(false);
    expect(res.ok ? null : res.error.code).toBe('E_SESSION_NOT_FOUND');
    expect(tickOf(p)).toBe(before);
  });

  it('rejects an action with a foreign sessionId', () => {
    const a = { ...action(p, 'scan', { type: 'scan' }), sessionId: `ses_${'c'.repeat(24)}` } as ActionRequestV1;
    const res = p.step(stepReq(p, [a], 1));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.actionResults[0].code).toBe('E_SESSION_NOT_FOUND');
  });

  it('rejects a stale action epoch', () => {
    const a = action(p, 'scan', { type: 'scan' }, { epoch: 99 });
    const res = p.step(stepReq(p, [a], 1));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.actionResults[0].code).toBe('E_STALE_EPOCH');
  });

  it('rejects action targetTick that is not exactly fromTick+1', () => {
    const cur = tickOf(p);
    const forward = p.step(stepReq(p, [action(p, 'scan', { type: 'scan' }, { targetTick: cur + 5 })], 1));
    expect(forward.ok).toBe(false);
    expect(forward.ok ? null : forward.error.code).toBe('E_FUTURE_TICK');
    const backward = p.step(stepReq(p, [action(p, 'scan', { type: 'scan' }, { targetTick: cur })], 1));
    expect(backward.ok).toBe(false);
    expect(backward.ok ? null : backward.error.code).toBe('E_STALE_TICK');
    expect(tickOf(p)).toBe(cur);
  });

  it('rejects a fromTick that is not the authoritative tick', () => {
    // advance so a stale tick is actually observable
    expect(p.step(stepReq(p, [move(p, { x: 1, y: 0 }, 2)], 2)).ok).toBe(true);
    const cur = tickOf(p);
    const future = p.step({ ...stepReq(p, [], 1), fromTick: cur + 2 });
    expect(future.ok ? null : future.error.code).toBe('E_FUTURE_TICK');
    const stale = p.step({ ...stepReq(p, [], 1), fromTick: cur - 1 });
    expect(stale.ok ? null : stale.error.code).toBe('E_STALE_TICK');
    expect(tickOf(p)).toBe(cur);
  });

  it('rejects an action from a foreign actor', () => {
    const a = { ...action(p, 'scan', { type: 'scan' }), actorId: `act_${'a'.repeat(16)}` } as ActionRequestV1;
    const res = p.step(stepReq(p, [a], 1));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.actionResults[0].code).toBe('E_UNKNOWN_ACTOR');
  });
});

// ---------------------------------------------------------------------------
// B3 — same-batch duplicate actionId
// ---------------------------------------------------------------------------
describe('B3 — same-batch duplicate actionId', () => {
  it('executes once, charges once, and maps [OK, replayed]', () => {
    const p = manager.createTestSession({ seed: SEED });
    ownerOf(manager, p).start();
    const energyBefore = selfOf(p)!.energy;
    const id = aid();
    const a = action(p, 'scan', { type: 'scan' }, { id });
    const res = p.step(stepReq(p, [a, { ...a }], 1));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.actionResults.map((r) => r.code)).toEqual(['OK', 'OK']);
    expect(res.value.actionResults.map((r) => r.replayed)).toEqual([false, true]);
    // Same original receipt (cost 10) but no NEW resource write on the replay.
    expect(res.value.actionResults.map((r) => r.cost)).toEqual([10, 10]);
    expect(res.value.actionResults.map((r) => r.resourceWritesThisCall)).toEqual([1, 0]);
    expect(selfOf(p)!.energy).toBe(energyBefore - 10);
    // Cross-batch replay returns the ORIGINAL receipt, not an overwritten one.
    const replay = p.step(stepReq(p, [action(p, 'scan', { type: 'scan' }, { id })], 1));
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.value.actionResults[0].code).toBe('OK');
      expect(replay.value.actionResults[0].replayed).toBe(true);
    }
  });

  it('same id + different payload in one batch rejects the duplicate, executes once', () => {
    const p = manager.createTestSession({ seed: SEED });
    ownerOf(manager, p).start();
    const id = aid();
    const a1 = action(p, 'wait', { type: 'wait', durationTicks: 1 }, { id });
    const a2 = action(p, 'wait', { type: 'wait', durationTicks: 2 }, { id });
    const res = p.step(stepReq(p, [a1, a2], 1));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.actionResults[0].code).toBe('OK');
      expect(res.value.actionResults[1].code).toBe('E_ID_PAYLOAD_MISMATCH');
    }
  });

  it('caches a failed action receipt and replays it for duplicates/retries', () => {
    const p = manager.createTestSession({ seed: SEED });
    ownerOf(manager, p).start();
    // First scan consumes the cooldown.
    expect(p.step(stepReq(p, [action(p, 'scan', { type: 'scan' })], 1)).ok).toBe(true);
    const id = aid();
    const failAction = action(p, 'scan', { type: 'scan' }, { id });
    const first = p.step(stepReq(p, [failAction, { ...failAction }], 1));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.actionResults[0].code).toBe('E_COOLDOWN');
    expect(first.value.actionResults[1].code).toBe('E_COOLDOWN');
    expect(first.value.actionResults[1].replayed).toBe(true);
    const retry = p.step(stepReq(p, [action(p, 'scan', { type: 'scan' }, { id })], 1));
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.value.actionResults[0].code).toBe('E_COOLDOWN');
      expect(retry.value.actionResults[0].replayed).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// B4 — requestId / actionId idempotency
// ---------------------------------------------------------------------------
describe('B4 — request and action idempotency', () => {
  it('same requestId + identical request returns the original StepResult with no tick advance or charge', () => {
    const p = manager.createTestSession({ seed: SEED });
    ownerOf(manager, p).start();
    const request = stepReq(p, [move(p, { x: 1, y: 0 }, 5)], 5);
    const first = p.step(request);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const tickAfterFirst = tickOf(p);
    const energyAfterFirst = selfOf(p)!.energy;
    const second = p.step(request);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value).toEqual(first.value);
    expect(tickOf(p)).toBe(tickAfterFirst);
    expect(selfOf(p)!.energy).toBe(energyAfterFirst);
  });

  it('same requestId with a different payload is rejected and does not advance', () => {
    const p = manager.createTestSession({ seed: SEED });
    ownerOf(manager, p).start();
    const request = stepReq(p, [], 1);
    expect(p.step(request).ok).toBe(true);
    const before = tickOf(p);
    const conflict = p.step({ ...request, ticks: 2 });
    expect(conflict.ok).toBe(false);
    expect(conflict.ok ? null : conflict.error.code).toBe('E_ID_PAYLOAD_MISMATCH');
    expect(tickOf(p)).toBe(before);
  });

  it('a new requestId with a repeated actionId advances the explicit ticks but does not re-execute/re-charge', () => {
    const p = manager.createTestSession({ seed: SEED });
    ownerOf(manager, p).start();
    const id = aid();
    const first = p.step(stepReq(p, [move(p, { x: 1, y: 0 }, 5, id)], 5));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const energyAfterFirst = selfOf(p)!.energy;
    const tickBefore = tickOf(p);
    const second = p.step(stepReq(p, [move(p, { x: 1, y: 0 }, 5, id)], 3));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.toTick).toBe(tickBefore + 3); // explicit new ticks
    expect(second.value.actionResults[0].replayed).toBe(true);
    expect(second.value.actionResults[0].cost).toBe(0);
    expect(selfOf(p)!.energy).toBe(energyAfterFirst);
  });

  it('a same requestId retry of a step with a failed action returns the identical failed StepResult', () => {
    const p = manager.createTestSession({ seed: SEED });
    ownerOf(manager, p).start();
    p.step(stepReq(p, [action(p, 'scan', { type: 'scan' })], 1)); // cooldown
    const request = stepReq(p, [action(p, 'scan', { type: 'scan' })], 1);
    const first = p.step(request);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.actionResults[0].code).toBe('E_COOLDOWN');
    const before = tickOf(p);
    const retry = p.step(request);
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.value).toEqual(first.value);
      expect(retry.value.actionResults[0].code).toBe('E_COOLDOWN');
    }
    expect(tickOf(p)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// B5 — hard budgets + option validation
// ---------------------------------------------------------------------------
describe('B5 — hard budgets and option validation', () => {
  it('hard caps are 10 sessions / 2 concurrent steps', () => {
    expect(() => createSessionManager({ maxSessions: 11 })).toThrow();
    expect(() => createSessionManager({ maxSessions: 1000 })).toThrow();
    expect(() => createSessionManager({ maxConcurrentSteps: 3 })).toThrow();
    expect(() => createSessionManager({ maxConcurrentSteps: 64 })).toThrow();
    expect(() => createSessionManager({ maxSessions: 10, maxConcurrentSteps: 2 })).not.toThrow();
  });

  it('rejects NaN/Infinity/negative/fractional/unknown options', () => {
    for (const opts of [{ maxSessions: NaN }, { maxSessions: Infinity }, { maxSessions: -1 }, { maxSessions: 1.5 }, { unknown: true }, { clock: 1 }]) {
      expect(() => createSessionManager(opts as never)).toThrow();
    }
  });

  it('enforces the 10-session cap at creation', () => {
    const m = makeManager();
    for (let i = 0; i < 10; i += 1) m.createTestSession({ seed: SEED + i });
    expect(() => m.createTestSession({ seed: 1 })).toThrow();
    m.dispose();
  });
});

// ---------------------------------------------------------------------------
// B6 — owner lifecycle split
// ---------------------------------------------------------------------------
describe('B6 — owner lifecycle split', () => {
  it('owner pause/resume/reset works while the Player cannot call them', () => {
    const p = manager.createProductionSession();
    const owner = ownerOf(manager, p);
    expect(owner.start().ok).toBe(true);
    expect(owner.pause().ok).toBe(true);
    const paused = p.step(stepReq(p, [], 1));
    expect(paused.ok ? null : paused.error.code).toBe('E_PAUSED');
    expect(owner.resume().ok).toBe(true);
    const epochBefore = epochOf(p);
    const reset = owner.reset();
    expect(reset.ok).toBe(true);
    if (reset.ok) expect(reset.value.epoch).toBeGreaterThan(epochBefore);
  });

  it('Player start/close remain available (own run), owner close is available too', () => {
    const p = manager.createProductionSession();
    expect(p.start().ok).toBe(true);
    expect(p.close().ok).toBe(true);
    expect(manager.get(p.sessionId)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// E1 — reset / close / restore races with in-flight advanced actions
// ---------------------------------------------------------------------------
describe('E1 — advanced action cannot pollute a new run', () => {
  it('reset during waitUntil leaves the new run at tick 0', async () => {
    const p = manager.createTestSession({ seed: SEED });
    const owner = ownerOf(manager, p);
    owner.start();
    const handle = p.waitUntil({ maxTicks: 100000, maxWallMs: 100000, until: 'crossed' });
    await new Promise((r) => setTimeout(r, 40));
    const before = tickOf(p);
    expect(before).toBeGreaterThan(0);
    const reset = owner.reset();
    expect(reset.ok).toBe(true);
    expect(tickOf(p)).toBe(0);
    await new Promise((r) => setTimeout(r, 80));
    expect(tickOf(p)).toBe(0); // new run untouched by the old action
    const old = await handle;
    expect(old.ok ? old.value.code : old.error.code).toBe('E_CANCELLED');
    owner.close();
  }, 20000);

  it('close during waitUntil freezes the session and cancels the action', async () => {
    const p = manager.createTestSession({ seed: SEED });
    const owner = ownerOf(manager, p);
    owner.start();
    const handle = p.waitUntil({ maxTicks: 100000, maxWallMs: 100000 });
    await new Promise((r) => setTimeout(r, 30));
    const before = tickOf(p);
    owner.close();
    await new Promise((r) => setTimeout(r, 60));
    const old = await handle;
    expect(old.ok ? old.value.code : old.error.code).toBe('E_CANCELLED');
    expect(tickOf(p)).toBe(-1); // closed: no observation, no writes
    expect(before).toBeGreaterThan(0);
  }, 20000);

  it('restore during waitUntil cancels the in-flight action and pins the restored epoch', async () => {
    const t = manager.createTestSession({ seed: SEED }) as TestSessionHandle;
    const owner = ownerOf(manager, t);
    owner.start();
    await new Promise((r) => setTimeout(r, 5));
    // advance a little, then snapshot
    t.step(stepReq(t, [move(t, { x: 1, y: 0 }, 3)], 3));
    const snap = t.snapshot();
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    const snapshotTick = snap.value.tick;
    const handle = t.waitUntil({ maxTicks: 100000, maxWallMs: 100000 });
    await new Promise((r) => setTimeout(r, 30));
    const restored = t.restore(snap.value);
    expect(restored.ok).toBe(true);
    const epochAfterRestore = epochOf(t);
    await new Promise((r) => setTimeout(r, 60));
    expect(tickOf(t)).toBe(snapshotTick); // restored position stable
    const old = await handle;
    expect(old.ok ? old.value.code : old.error.code).toBe('E_CANCELLED');
    expect(epochOf(t)).toBe(epochAfterRestore);
  }, 20000);
});

// ---------------------------------------------------------------------------
// D2 — cancelAction actually cancels (no AbortSignal)
// ---------------------------------------------------------------------------
describe('D2 — cancelAction cancels bounded advanced actions', () => {
  it('cancels via the returned handle actionId and freezes ticks', async () => {
    const p = manager.createTestSession({ seed: SEED });
    ownerOf(manager, p).start();
    const handle: AdvancedActionHandle = p.waitUntil({ maxTicks: 100000, maxWallMs: 100000 });
    await new Promise((r) => setTimeout(r, 30));
    const before = tickOf(p);
    const cancel = p.cancelAction(handle.actionId);
    expect(cancel.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    expect(tickOf(p)).toBe(before); // no further ticks after cancel
    const result = await handle.result;
    expect(result.ok ? result.value.code : result.error.code).toBe('E_CANCELLED');
    // Repeat cancel is idempotent (bounded history).
    expect(p.cancelAction(handle.actionId).ok).toBe(true);
  }, 20000);

  it('cancels synchronously before the loop starts via a caller-supplied actionId', async () => {
    const p = manager.createTestSession({ seed: SEED });
    ownerOf(manager, p).start();
    const id = aid();
    const before = tickOf(p);
    const handle = p.waitUntil({ maxTicks: 400, actionId: id });
    const cancel = p.cancelAction(id); // synchronous, before any tick
    expect(cancel.ok).toBe(true);
    const result = await handle;
    expect(result.ok ? result.value.code : result.error.code).toBe('E_CANCELLED');
    expect(tickOf(p)).toBe(before);
  }, 20000);

  it('an unmatched actionId is not faked as success', () => {
    const p = manager.createTestSession({ seed: SEED });
    ownerOf(manager, p).start();
    const res = p.cancelAction(`aid_${'f'.repeat(24)}`);
    expect(res.ok).toBe(false);
    expect(res.ok ? null : res.error.code).toBe('E_NOT_APPLICABLE');
  });
});

// ---------------------------------------------------------------------------
// Session id decoupling / isolation
// ---------------------------------------------------------------------------
describe('session id decoupling and isolation', () => {
  it('duplicate seedProvider values still produce distinct sessions (no Map overwrite)', () => {
    const m = makeManager({ seedProvider: () => 777 });
    const a = m.createProductionSession();
    const b = m.createProductionSession();
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(m.size).toBe(2);
    expect(m.get(a.sessionId)).toBeDefined();
    expect(m.get(b.sessionId)).toBeDefined();
    m.dispose();
  });

  it('two managers stay isolated even with the same seedProvider', () => {
    const m1 = makeManager({ seedProvider: () => 777 });
    const m2 = makeManager({ seedProvider: () => 777 });
    const a = m1.createTestSession({ seed: SEED });
    const b = m2.createTestSession({ seed: SEED });
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(m1.get(b.sessionId)).toBeUndefined();
    expect(m2.get(a.sessionId)).toBeUndefined();
    m1.dispose(); m2.dispose();
  });
});

// ---------------------------------------------------------------------------
// debug observe is a permission error
// ---------------------------------------------------------------------------
describe('debug observation', () => {
  it('is rejected with E_PERMISSION (sanitized, no leak)', () => {
    const p = manager.createTestSession({ seed: SEED });
    ownerOf(manager, p).start();
    const res = p.observe('debug' as never);
    expect(res.ok).toBe(false);
    expect(res.ok ? null : res.error.code).toBe('E_PERMISSION');
  });
});

// ---------------------------------------------------------------------------
// Result-validation transaction (post-commit failure must roll back)
// ---------------------------------------------------------------------------
const realSha = (text: string): string => `sha256:${createHash('sha256').update(text).digest('hex')}`;

function stateOf(p: PlayerSessionHandle): { tick: number; energy: number; events: number; epoch: number } {
  const obs = p.observe('summary');
  const events = p.getEvents(0, 10000);
  return {
    tick: obs.ok ? obs.value.tick : -1,
    energy: obs.ok ? obs.value.current.self.energy : -1,
    events: events.ok ? events.value.total : -1,
    epoch: obs.ok ? obs.value.epoch : -1,
  };
}

describe('result-validation transaction', () => {
  it('rolls back tick/energy/events/epoch, caches the sanitized failure, and retries identically', () => {
    let bad = true;
    const m = createSessionManager({
      maxSessions: 10, idleTimeoutMs: 100000, maxSessionWallMs: 100000,
      hasher: (text) => (bad ? 'bad-hash' : realSha(text)),
    });
    const p = m.createTestSession({ seed: SEED });
    ownerOf(m, p).start();
    const before = stateOf(p);
    const actionId = aid();
    const request = stepReq(p, [action(p, 'scan', { type: 'scan' }, { id: actionId })], 1);

    const first = p.step(request);
    expect(first.ok).toBe(false);
    expect(first.ok ? null : first.error.code).toBe('E_INTERNAL_TRANSACTION');
    expect(stateOf(p)).toEqual(before); // no tick / energy / event / epoch change

    // Same requestId + identical request -> the SAME sanitized failure, no E_STALE_TICK.
    const retry = p.step(request);
    expect(retry.ok).toBe(false);
    expect(retry.ok ? null : retry.error.code).toBe('E_INTERNAL_TRANSACTION');
    expect(retry.ok ? null : retry.error.messageKey).toBe(first.ok ? null : first.error.messageKey);
    expect(stateOf(p)).toEqual(before);

    // Same requestId + different payload -> conflict, still no state change.
    const conflict = p.step({ ...request, ticks: 2 });
    expect(conflict.ok ? null : conflict.error.code).toBe('E_ID_PAYLOAD_MISMATCH');
    expect(stateOf(p)).toEqual(before);

    // Fix the dependency: a NEW request with the same actionId executes fresh
    // (the failed step left no idempotency cache pollution).
    bad = false;
    const fixed = p.step(stepReq(p, [action(p, 'scan', { type: 'scan' }, { id: actionId })], 1));
    expect(fixed.ok).toBe(true);
    if (fixed.ok) {
      expect(fixed.value.actionResults[0].replayed).toBe(false);
      expect(fixed.value.actionResults[0].code).toBe('OK');
    }
    expect(stateOf(p).tick).toBe(before.tick + 1);
    m.dispose();
  });

  it('a throwing hasher cannot escape and leaves no commit', () => {
    const m = createSessionManager({
      maxSessions: 10, idleTimeoutMs: 100000, maxSessionWallMs: 100000,
      hasher: () => { throw new Error('hasher boom'); },
    });
    const p = m.createTestSession({ seed: SEED });
    ownerOf(m, p).start();
    const before = stateOf(p);
    const request = stepReq(p, [move(p, { x: 1, y: 0 }, 3)], 3);
    let res: ReturnType<PlayerSessionHandle['step']> | undefined;
    expect(() => { res = p.step(request); }).not.toThrow();
    expect(res!.ok).toBe(false);
    expect(res!.ok ? null : res!.error.code).toBe('E_INTERNAL_TRANSACTION');
    expect(stateOf(p)).toEqual(before);
    const retry = p.step(request);
    expect(retry.ok ? null : retry.error.code).toBe('E_INTERNAL_TRANSACTION');
    expect(stateOf(p)).toEqual(before);
    m.dispose();
  });

  it('a failed step does not evict previously issued snapshots or change epoch', () => {
    let bad = false;
    const m = createSessionManager({
      maxSessions: 10, idleTimeoutMs: 100000, maxSessionWallMs: 100000,
      hasher: (text) => (bad ? 'bad-hash' : realSha(text)),
    });
    const t = m.createTestSession({ seed: SEED });
    ownerOf(m, t).start();
    t.step(stepReq(t, [move(t, { x: 1, y: 0 }, 2)], 2));
    const issued = t.snapshot();
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const epochBefore = stateOf(t).epoch;
    bad = true;
    expect(t.step(stepReq(t, [action(t, 'scan', { type: 'scan' })], 1)).ok).toBe(false);
    bad = false;
    expect(stateOf(t).epoch).toBe(epochBefore); // rollback did not bump epoch
    const restored = t.restore(issued.value); // frame still issued (not evicted)
    expect(restored.ok).toBe(true);
    m.dispose();
  });

  it('postStateHash matches canonicalState of an issued snapshot (no per-step issuance drift)', () => {
    const t = manager.createTestSession({ seed: SEED });
    ownerOf(manager, t).start();
    const res = t.step(stepReq(t, [move(t, { x: 1, y: 0 }, 5)], 5));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const snap = t.snapshot();
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    expect(res.value.postStateHash).toBe(realSha(canonicalState(snap.value)));
  });
});

// ---------------------------------------------------------------------------
// Full production route to completion
// ---------------------------------------------------------------------------
describe('production PLAYER full door/bridge route', () => {
  it('reaches the east shore and completes using only legal lower-level actions', () => {
    const p = manager.createProductionSession();
    const owner = ownerOf(manager, p);
    expect(owner.start().ok).toBe(true);
    const script: Array<[ActionRequestV1['type'] | null, ActionRequestV1['payload'] | null, number]> = [
      ['move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 60 }, 60],
      ['scan', { type: 'scan' }, 1],
      ['jam', { type: 'jam', targetId: 'tgt_lab_door_receiver' }, 1],
      ['move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 40 }, 40],
      ['move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 100 }, 100],
      [null, null, 1],
      ['move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 61 }, 61],
      ['move', { type: 'move', direction: { x: 0, y: -1 }, durationTicks: 17 }, 17],
      ['interact', { type: 'interact', targetId: 'tgt_corridor_relay' }, 1],
      [null, null, 95],
      ['move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 150 }, 150],
    ];
    for (const [type, payload, ticks] of script) {
      const actions = type && payload ? [action(p, type, payload)] : [];
      const res = p.step(stepReq(p, actions, ticks));
      expect(res.ok).toBe(true);
    }
    const self = selfOf(p)!;
    expect(self.passed).toBe(true);
    expect(self.crossed).toBe(true);
    expect(self.completed).toBe(true);
    expect(self.failed).toBe(false);
    const obs = p.observe('standard');
    expect(obs.ok).toBe(true);
    if (obs.ok) {
      expect(obs.value.roomId).toBe('station-zero-r2');
      expect(validateObservationDetailed(obs.value).ok).toBe(true);
      expect(hasHiddenField(obs.value, ['role'])).toBeNull();
    }
    owner.close();
  }, 30000);
});

// ---------------------------------------------------------------------------
// Companion / observation / events / cleanup
// ---------------------------------------------------------------------------
describe('companion', () => {
  it('is independently bound and returns E_NOT_APPLICABLE', () => {
    const c: CompanionSessionHandle = manager.createCompanionSession();
    const obs = c.observe('standard');
    expect(obs.ok ? null : obs.error.code).toBe('E_NOT_APPLICABLE');
    const act = c.act(stepReq(c as unknown as PlayerSessionHandle, [], 1));
    expect(act.ok ? null : act.error.code).toBe('E_NOT_APPLICABLE');
    expect(c.role).toBe('COMPANION');
  });
});

describe('observation and events', () => {
  it('summary validates as P0 and leaks no hidden field', () => {
    const p = manager.createTestSession({ seed: SEED });
    ownerOf(manager, p).start();
    const obs = p.observe('summary');
    expect(obs.ok).toBe(true);
    if (!obs.ok) return;
    expect(validateObservationDetailed(obs.value).ok).toBe(true);
    expect(hasHiddenField(obs.value, ['role'])).toBeNull();
    expect(obs.value.evidence).toEqual([]);
    expect(obs.value.events).toEqual([]);
  });

  it('events paginate with a truncation notice', () => {
    const p = manager.createTestSession({ seed: SEED });
    ownerOf(manager, p).start();
    for (let i = 0; i < 20; i += 1) {
      expect(p.step(stepReq(p, [action(p, 'wait', { type: 'wait', durationTicks: 1 })], 1)).ok).toBe(true);
    }
    const page = p.getEvents(0, 10);
    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.value.events.length).toBe(10);
      expect(page.value.truncated).toBe(true);
    }
  });
});

describe('idle / close cleanup', () => {
  it('an idle session is reclaimed and removed', async () => {
    const m = makeManager({ idleTimeoutMs: 30 });
    const p = m.createTestSession({ seed: SEED });
    ownerOf(m, p).start();
    await new Promise((r) => setTimeout(r, 90));
    expect(m.get(p.sessionId)).toBeUndefined();
    m.dispose();
  }, 20000);

  it('manager.dispose() closes everything', () => {
    const m = makeManager();
    m.createTestSession({ seed: SEED });
    m.createProductionSession();
    m.dispose();
    expect(m.size).toBe(0);
  });
});
