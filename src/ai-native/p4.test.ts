/**
 * AI-NATIVE-01 P4 — Player observation provenance regressions.
 *
 * The live Codex Player trace showed R2 scan evidence still carrying the stale
 * R1 observer position, a synthetic sourceActionId, and a game actor id that did
 * not match the public observation actor. These tests pin the fixed behaviour:
 * the real scan origin/room, the actual scan action id / actor / epoch, no
 * resampling on restore, and the corridor known-connection projection.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionManager, type SessionManager, type TestSessionHandle } from './sessions';
import { SliceModel } from '../slice/rules';
import { isSliceEvidenceArray } from '../slice/fullState';
import type { StepRequestV1, ActionRequestV1, ObservationV1 } from './protocol';

const DTO = 'last_signal.ai-native.dto.v1';
let counter = 0;
const hex24 = (): string => String(++counter).padStart(24, '0');
const aid = (): string => `aid_${hex24()}`;
const act = (): string => `act_${hex24().slice(0, 16)}`;

let managers: SessionManager[] = [];
afterEach(() => { for (const m of managers) { try { m.dispose(); } catch { /* ignore */ } } managers = []; });

function makeSession(): { manager: SessionManager; session: TestSessionHandle } {
  const manager = createSessionManager({ maxSessions: 4, idleTimeoutMs: 100000, maxSessionWallMs: 100000 });
  managers.push(manager);
  const session = manager.createTestSession({ seed: 11 });
  const owner = manager.createOwnerHandle(session.sessionId);
  if (!owner) throw new Error('owner missing');
  owner.start();
  return { manager, session };
}
function tickOf(session: TestSessionHandle): number {
  const r = session.observe('summary');
  return r.ok ? r.value.tick : -1;
}
function step(
  session: TestSessionHandle,
  type: ActionRequestV1['type'] | null,
  payload: ActionRequestV1['payload'] | null,
  ticks: number,
  actionId?: string,
): { actionId?: string } | null {
  const tick = tickOf(session);
  const actions: ActionRequestV1[] = type && payload
    ? [{
      schema: DTO, protocolVersion: 1,
      actionId: (actionId ?? aid()) as ActionRequestV1['actionId'],
      actorId: session.actorId, sessionId: session.sessionId as ActionRequestV1['sessionId'],
      epoch: 0, targetTick: tick + 1, type, payload,
      clientSeq: 0, issuedAtMs: 0, deadlineTick: tick + 1,
    }]
    : [];
  const request: StepRequestV1 = {
    schema: DTO, protocolVersion: 1, requestId: `req_${hex24()}` as StepRequestV1['requestId'],
    sessionId: session.sessionId as StepRequestV1['sessionId'], epoch: 0, fromTick: tick,
    ticks, actions, includeObservation: true, observationDetail: 'standard',
  };
  const res = session.step(request);
  if (!res.ok) return null;
  return { actionId: res.value.actionResults[0]?.actionId as string | undefined };
}
function driveToCorridor(session: TestSessionHandle): void {
  step(session, 'move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 60 }, 60);
  step(session, 'scan', { type: 'scan' }, 1);
  step(session, 'jam', { type: 'jam', targetId: 'tgt_lab_door_receiver' as never }, 1);
  step(session, 'move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 40 }, 40);
  step(session, 'move', { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 100 }, 100);
  step(session, null, null, 1);
}

describe('P4 Player observation provenance', () => {
  it('an R2 scan records the corridor observer position/room, actual actionId/actor/epoch', () => {
    const { session } = makeSession();
    driveToCorridor(session);
    const scanId = aid();
    expect(step(session, 'scan', { type: 'scan' }, 1, scanId)).not.toBeNull();
    const obs = session.observe('standard');
    expect(obs.ok).toBe(true);
    if (!obs.ok) return;
    const current = obs.value.current.self.position;
    expect(obs.value.roomId).toBe('station-zero-r2');
    expect(obs.value.evidence.length).toBeGreaterThan(0);
    for (const item of obs.value.evidence) {
      expect(item.roomId).toBe('station-zero-r2');
      expect(item.observerPosition).toEqual({ x: current.x, y: current.y });
      expect(item.sourceActionId).toBe(scanId);
      expect(item.observerActorId).toBe(obs.value.actorId);
      expect(item.sceneEpoch).toBe(obs.value.epoch);
    }
    const relations = obs.value.current.knownConnections.map((c) => c.relationId);
    expect(relations).toContain('rel_corridor_relay_bridge');
    expect(relations).toContain('rel_corridor_relay_perception');
  });

  it('restore keeps the recorded provenance (no resampling, no identity fabrication)', () => {
    const { session } = makeSession();
    driveToCorridor(session);
    expect(step(session, 'scan', { type: 'scan' }, 1)).not.toBeNull();
    const before = session.observe('standard');
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const snap = session.snapshot();
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    const restored = session.restore(snap.value);
    expect(restored.ok).toBe(true);
    const after = session.observe('standard');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.evidence).toEqual(before.value.evidence);
  });

  it('still attributes R1 scan evidence to its own action', () => {
    const { session } = makeSession();
    const scanId = aid();
    expect(step(session, 'scan', { type: 'scan' }, 1, scanId)).not.toBeNull();
    const obs = session.observe('standard');
    expect(obs.ok).toBe(true);
    if (!obs.ok) return;
    for (const item of obs.value.evidence) {
      expect(item.roomId).toBe('station-zero-r1');
      expect(item.sourceActionId).toBe(scanId);
      expect(item.observerActorId).toBe(obs.value.actorId);
    }
  });
});

describe('P4 evidence provenance is backward compatible', () => {
  it('SliceModel records scan provenance and restores it verbatim', () => {
    const model = new SliceModel();
    model.setPlayerPos(6.5, 5.5);
    const sourceActionId = `aid_${'a'.repeat(24)}`;
    const observerActorId = `act_${'b'.repeat(16)}`;
    model.scan({ sourceActionId, observerActorId, sceneEpoch: 3 });
    const evidence = model.evidenceSnapshot;
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((e) => e.sourceActionId === sourceActionId)).toBe(true);
    expect(evidence.every((e) => e.observerActorId === observerActorId)).toBe(true);
    expect(evidence.every((e) => e.sceneEpoch === 3)).toBe(true);
    const restored = new SliceModel();
    restored.restoreFull(model.captureFull());
    expect(restored.evidenceSnapshot).toEqual(evidence);
  });

  it('legacy evidence without provenance still serializes and validates', () => {
    const legacy = {
      targetId: 'tgt_lab_door_receiver', relationId: null, position: { x: 3.5, y: 5.5 },
      observedAtTick: 5, expiresAtTick: 485, stateLabel: 'receiver-visible', roomId: 'station-zero-r1',
    };
    const enriched = {
      ...legacy, sourceActionId: `aid_${'c'.repeat(24)}`, observerActorId: `act_${'d'.repeat(16)}`, sceneEpoch: 0,
    };
    expect(isSliceEvidenceArray([legacy])).toBe(true);
    expect(isSliceEvidenceArray([enriched])).toBe(true);
    expect(isSliceEvidenceArray([{ ...legacy, sourceActionId: 'not-an-aid' }])).toBe(false);
    expect(isSliceEvidenceArray([{ ...legacy, observerActorId: 'nope' }])).toBe(false);
    expect(isSliceEvidenceArray([{ ...legacy, sceneEpoch: -1 }])).toBe(false);
  });
});
