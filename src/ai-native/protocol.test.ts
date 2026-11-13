/**
 * AI-NATIVE-01 / P0 — real schema validation tests for src/ai-native/protocol.ts.
 *
 * Scope: pure DTO/schema validation only. These tests do NOT execute any game
 * action, do not import Phaser / World / SliceModel, and do not claim that any
 * action (especially aim/fire/decoy) is implemented in the game.
 *
 * Contract: docs/AI_NATIVE_PROTOCOL.md (§13 minimum acceptance list),
 * docs/AI_NATIVE_ARCHITECTURE.md, docs/AI_NATIVE_PERMISSION_MODEL.md.
 */
import { describe, expect, it } from 'vitest';
import * as P from './protocol';

// ---------------------------------------------------------------------------
// Fixtures (all opaque IDs match the v1 patterns)
// ---------------------------------------------------------------------------

const HEX24 = '0123456789abcdef01234567';
const HEX16 = '0123456789abcdef';
const SES = `ses_${HEX24}` as P.SessionId;
const ACT = `act_${HEX16}` as P.ActorId;
const ACT2 = `act_fedcba9876543210` as P.ActorId;
const AID = `aid_${HEX24}` as P.ActionId;
const RID = `req_${HEX24}` as P.RequestId;
const TGT = 'tgt_lab_door_receiver' as P.TargetId;
const EVID = 'ev_abc123' as P.EvidenceId;
const EVTID = 'evt_abc123' as P.EventId;
const SNAPID = 'snap_abc123' as P.SnapshotId;
const SHA = `sha256:${'a'.repeat(64)}`;
const FNV = 'fnv1a32:5465b825';

const DTO = P.AI_NATIVE_DTO_SCHEMA_V1;
const OBS = P.AI_NATIVE_OBSERVATION_SCHEMA_V1;
const EVT = P.AI_NATIVE_EVENT_SCHEMA_V1;
const SNAP = P.AI_NATIVE_SNAPSHOT_SCHEMA_V1;
const REPLAY = P.AI_NATIVE_REPLAY_SCHEMA_V1;
const DEBUG = P.AI_NATIVE_DEBUG_SCHEMA_V1;
const ENVELOPE = P.AI_NATIVE_ENVELOPE_SCHEMA_V1;

function actionRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: DTO,
    protocolVersion: 1,
    actionId: AID,
    actorId: ACT,
    sessionId: SES,
    epoch: 1,
    targetTick: 11,
    type: 'scan',
    payload: { type: 'scan' },
    clientSeq: 7,
    issuedAtMs: 1000,
    deadlineTick: 20,
    ...overrides,
  };
}

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: OBS,
    protocolVersion: 1,
    sessionId: SES,
    epoch: 1,
    tick: 10,
    actorId: ACT,
    role: 'PLAYER',
    detail: 'standard',
    roomId: 'station-zero-r1',
    current: {
      self: {
        position: { x: 3.5, y: 5.5 }, energy: 100,
        alive: true, paused: false, passed: false,
        crossed: false, failed: false, completed: false,
      },
      publicDeviceState: { door: 'SEALED', doorPassable: false },
      publicTimers: {
        scanCooldownTicks: 0, jamCooldownTicks: 0, scanRevealRemainingTicks: 0,
        jamRemainingTicks: 0, safeClearRemainingTicks: 0,
      },
      visibleTargets: [],
      knownConnections: [],
    },
    evidence: [],
    knowledge: [],
    hypotheses: [],
    events: [],
    availableActions: [],
    omittedFieldCount: 0,
    ...overrides,
  };
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: EVT,
    protocolVersion: 1,
    eventId: EVTID,
    sessionId: SES,
    epoch: 1,
    tick: 10,
    phase: 2,
    ordinal: 0,
    eventSeq: 0,
    type: 'ACTION_ACCEPTED',
    payload: { actionId: AID, actorId: ACT, code: 'OK', cost: 0, resourceWritesThisCall: 1 },
    ...overrides,
  };
}

function sliceState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'last_signal_station_zero_vs00_v1',
    version: 1,
    roomId: 'station-zero-r1',
    energy: 100,
    tick: 10,
    doorState: 'SEALED',
    manualOpenIntent: false,
    sealSourcePresent: true,
    passed: false,
    position: { x: 3.5, y: 5.5 },
    remaining: {
      jam: 0, jamCooldown: 0, scanCooldown: 0,
      scanReveal: 0, safeClear: 0, regenAcc: 0,
    },
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: SNAP,
    protocolVersion: 1,
    kernelVersion: P.AI_NATIVE_KERNEL_VERSION_V1,
    snapshotId: SNAPID,
    sessionId: SES,
    sessionKind: 'production',
    epoch: 1,
    tick: 10,
    scenarioId: P.AI_NATIVE_SCENARIO_ID_V1,
    runStatus: 'active',
    runEndReason: null,
    createdAtMs: 1000,
    state: sliceState(),
    observationEvidence: [],
    idempotencyCache: [],
    eventCursor: 0,
    rngState: null,
    snapshotHash: SHA,
    ...overrides,
  };
}

function replay(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: REPLAY,
    protocolVersion: 1,
    kernelVersion: P.AI_NATIVE_KERNEL_VERSION_V1,
    sessionId: SES,
    sessionKind: 'production',
    initialSnapshot: snapshot(),
    actions: [],
    actionResults: [],
    events: [],
    finalStateHash: SHA,
    eventsHash: SHA,
    resourceUsage: {
      wallMs: 0, ticksAdvanced: 0, eventsEmitted: 0,
      peakActionsPerTick: 0, droppedEvents: 0, truncatedObservation: false,
    },
    ...overrides,
  };
}

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: ENVELOPE,
    protocolVersion: 1,
    sessionId: SES,
    epoch: 1,
    transportSeq: 1,
    kind: 'request',
    requestId: RID,
    issuedAtMs: 1000,
    payload: actionRequest(),
    ...overrides,
  };
}

function sessionDescriptor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: DTO,
    protocolVersion: 1,
    sessionId: SES,
    kind: 'production',
    mode: 'headless',
    status: 'running',
    epoch: 1,
    tick: 10,
    scenarioId: P.AI_NATIVE_SCENARIO_ID_V1,
    kernelVersion: P.AI_NATIVE_KERNEL_VERSION_V1,
    runId: 'run_0001',
    runEndReason: null,
    actorRegistry: {
      [ACT]: {
        actorId: ACT, role: 'PLAYER', priority: 0,
        allowedActions: ['scan', 'jam'], observationScope: 'self',
      },
    },
    createdAtMs: 1,
    lastActivityMs: 2,
    expiresAtMs: 3,
    resourceLimits: {
      maxTicksPerStep: 1000, maxActionsPerTick: 32, maxActiveIntentsPerActor: 1,
      maxActionDurationTicks: 3600, maxPayloadBytes: 4096, maxObservationEvents: 64,
      maxEventsPerPage: 256, maxRequestsPerSecond: 20, maxObservePerSecond: 10,
      maxStepTicksPerSecond: 6000, requestTimeoutMs: 30000, heartbeatMs: 5000,
      idleTimeoutMs: 300000, maxSessionWallMs: 3600000,
    },
    ...overrides,
  };
}

function createSessionRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: DTO,
    protocolVersion: 1,
    requestId: RID,
    kind: 'production',
    mode: 'headless',
    scenarioId: P.AI_NATIVE_SCENARIO_ID_V1,
    actorSpecs: [{ role: 'PLAYER', observationScope: 'self', allowedActions: ['scan'] }],
    ...overrides,
  };
}

function debugInspection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: DEBUG,
    protocolVersion: 1,
    sessionId: SES,
    epoch: 1,
    tick: 10,
    actorId: ACT,
    role: 'DEVELOPER',
    fullState: { seed: 42, internalDoorIntent: true },
    fixtureLog: [],
    rawEvents: [],
    ...overrides,
  };
}

function errorDto(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: DTO,
    protocolVersion: 1,
    code: 'E_SCHEMA',
    messageKey: 'error.schema',
    retryable: false,
    sessionId: SES,
    epoch: 1,
    tick: 10,
    requestId: RID,
    ...overrides,
  };
}

function stepResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: DTO,
    protocolVersion: 1,
    sessionId: SES,
    epoch: 1,
    fromTick: 10,
    toTick: 11,
    status: 'completed',
    actionResults: [],
    events: [],
    eventCursor: 0,
    postStateHash: SHA,
    resourceUsage: {
      wallMs: 0, ticksAdvanced: 1, eventsEmitted: 0,
      peakActionsPerTick: 0, droppedEvents: 0, truncatedObservation: false,
    },
    ...overrides,
  };
}

function actionResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: DTO,
    protocolVersion: 1,
    sessionId: SES,
    epoch: 1,
    tick: 11,
    actionId: AID,
    actorId: ACT,
    status: 'completed',
    code: 'OK',
    cost: 0,
    resourceWritesThisCall: 1,
    replayed: false,
    ...overrides,
  };
}

function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: OBS,
    protocolVersion: 1,
    evidenceId: EVID,
    sceneEpoch: 1,
    roomId: 'station-zero-r1',
    sourceActionId: AID,
    source: 'player-scan',
    observerActorId: ACT,
    observerPosition: { x: 3.5, y: 5.5 },
    targetId: TGT,
    observedAtTick: 5,
    expiresAtTick: 20,
    observedState: { signalPresent: true, discovered: true },
    ...overrides,
  };
}

/** Assert a failed ValidationResult with an exact error code. */
function expectCode(result: P.ValidationResult<unknown>, code: P.ErrorCodeV1): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issue.code).toBe(code);
}

/** Narrow a successful ValidationResult for typed comparisons. */
function unwrap<T>(result: P.ValidationResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`unexpected failure: ${result.issue.code} at ${result.issue.path}`);
  return result.value;
}

// ---------------------------------------------------------------------------
// 1. Constants / version / no fake runtime (§13.1)
// ---------------------------------------------------------------------------

describe('P0 contract constants and version compatibility', () => {
  it('exports all seven v1 schema strings plus version/kernel/limits/error codes', () => {
    expect(P.AI_NATIVE_PROTOCOL_VERSION).toBe(1);
    expect(P.AI_NATIVE_KERNEL_VERSION_V1).toBe('station-zero-r1-r2@1');
    expect(P.AI_NATIVE_SCHEMA_V1.dto).toBe('last_signal.ai-native.dto.v1');
    expect(Object.keys(P.AI_NATIVE_SCHEMA_V1)).toHaveLength(7);
    expect(P.AI_NATIVE_LIMITS_V1.MAX_PAYLOAD_BYTES).toBe(4096);
    expect(P.AI_NATIVE_LIMITS_V1.MAX_TICKS_PER_STEP).toBe(1000);
    expect(P.AI_NATIVE_LIMITS_V1.MAX_ACTION_DURATION_TICKS).toBe(3600);
    expect(P.AI_NATIVE_LIMITS_V1.MAX_EVENT_LOG_EVENTS).toBe(10000);
    expect(P.AI_NATIVE_ERROR_CODES_V1).toContain('E_NOT_APPLICABLE');
    expect(P.AI_NATIVE_ERROR_CODES_V1).toContain('E_ID_PAYLOAD_MISMATCH');
    expect(P.AI_NATIVE_ERROR_CODES_V1).toContain('E_REPLAY_INCOMPATIBLE');
    expect(Object.keys(P.AI_NATIVE_ERROR_MESSAGES_V1)).toHaveLength(P.AI_NATIVE_ERROR_CODES_V1.length);
  });

  it('isCompatibleVersion accepts only protocolVersion 1 + exact schema', () => {
    expect(P.isCompatibleVersion(1)).toBe(true);
    expect(P.isCompatibleVersion({ protocolVersion: 1, schema: DTO })).toBe(true);
    expect(P.isCompatibleVersion({ protocolVersion: 1, schema: OBS })).toBe(true);
    expect(P.isCompatibleVersion({ protocolVersion: 2, schema: DTO })).toBe(false);
    expect(P.isCompatibleVersion({ protocolVersion: 1, schema: 'last_signal.ai-native.dto.v2' })).toBe(false);
    expect(P.isCompatibleVersion({ protocolVersion: 1 })).toBe(false);
    expect(P.isCompatibleVersion(null)).toBe(false);
    expect(P.isCompatibleVersion('1')).toBe(false);
  });

  it('exports no Runtime / Gateway execution function (P0 is schema only)', () => {
    const exportedFunctions = Object.entries(P)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name);
    for (const forbidden of ['execute', 'step', 'createSession', 'runStep', 'applyAction', 'dispatch', 'advanceTick']) {
      expect(exportedFunctions).not.toContain(forbidden);
    }
    expect(P.GAME_IMPLEMENTATION_STATUS.protocolOnly).toBe(true);
    expect(P.GAME_IMPLEMENTATION_STATUS.runtime).toBe('NOT_IMPLEMENTED_P0');
    expect(P.GAME_IMPLEMENTATION_STATUS.statement).toMatch(/aim\/fire\/decoy are unsupported/);
  });

  it('has pure, immutable constant tables', () => {
    expect(Object.isFrozen(P.AI_NATIVE_SCHEMA_V1)).toBe(true);
    expect(Object.isFrozen(P.AI_NATIVE_LIMITS_V1)).toBe(true);
    expect(Object.isFrozen(P.AI_NATIVE_ERROR_CODES_V1)).toBe(true);
    expect(Object.isFrozen(P.AI_NATIVE_ERROR_MESSAGES_V1)).toBe(true);
    expect(Object.isFrozen(P.AI_NATIVE_UNSUPPORTED_ACTIONS_V1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Legal DTOs (all v1 guards must accept valid shapes)
// ---------------------------------------------------------------------------

describe('legal v1 DTOs', () => {
  it('ActionRequestV1 (all 9 wire action types) validates', () => {
    const payloads: Record<string, Record<string, unknown>> = {
      move: { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 5 },
      aim: { type: 'aim', direction: { x: 0, y: 1 } },
      fire: { type: 'fire', held: true, durationTicks: 3 },
      scan: { type: 'scan' },
      jam: { type: 'jam', targetId: TGT },
      interact: { type: 'interact', targetId: TGT },
      shoot_guard: { type: 'shoot_guard', targetId: TGT },
      decoy: { type: 'decoy', position: { x: 1, y: 1 } },
      wait: { type: 'wait', durationTicks: 2 },
    };
    for (const [type, payload] of Object.entries(payloads)) {
      const dto = actionRequest({ type, payload });
      const result = P.validateActionRequestDetailed(dto);
      expect(result.ok, `action ${type}`).toBe(true);
      expect(P.validateActionRequest(dto)).toBe(true);
    }
  });

  it('SessionDescriptorV1 / CreateSessionRequestV1 / StepRequestV1 validate', () => {
    expect(P.validateSessionDescriptor(sessionDescriptor())).toBe(true);
    expect(P.validateCreateSessionRequest(createSessionRequest())).toBe(true);
    const step = {
      schema: DTO, protocolVersion: 1, requestId: RID, sessionId: SES, epoch: 1,
      fromTick: 10, ticks: 1, actions: [actionRequest({ targetTick: 11 })],
      includeObservation: true, observationDetail: 'standard',
    };
    expect(P.validateStepRequest(step)).toBe(true);
  });

  it('ObservationV1 / EventV1 / ErrorV1 / StepResultV1 / ActionResultV1 validate', () => {
    expect(P.validateObservation(observation())).toBe(true);
    expect(P.validateEvent(event())).toBe(true);
    expect(P.validateErrorDetailed(errorDto()).ok).toBe(true);
    expect(P.validateStepResult(stepResult())).toBe(true);
    expect(P.validateActionResultDetailed(actionResult()).ok).toBe(true);
    expect(P.validateObservationEvidenceDetailed(evidence()).ok).toBe(true);
  });

  it('SnapshotV1 / ReplayV1 / DebugInspectionV1 / EnvelopeV1 / RequestV1 validate', () => {
    expect(P.validateSnapshot(snapshot())).toBe(true);
    expect(P.validateReplay(replay())).toBe(true);
    expect(P.validateDebugInspection(debugInspection())).toBe(true);
    expect(P.validateEnvelope(envelope())).toBe(true);
    expect(P.validateRequest(actionRequest())).toBe(true);
    expect(P.validateRequest(createSessionRequest())).toBe(true);
  });

  it('summary detail is also a valid ObservationV1 (strict subset of standard)', () => {
    expect(P.validateObservation(observation({ detail: 'summary' }))).toBe(true);
  });

  it('validators do not mutate their input (no state pollution)', () => {
    const dto = observation({ evidence: [evidence()] });
    const before = JSON.stringify(dto);
    expect(P.validateObservationDetailed(dto).ok).toBe(true);
    expect(P.hasHiddenField(dto, ['role'])).toBeNull();
    expect(JSON.stringify(dto)).toBe(before);
    // Repeated validation is deterministic and side-effect free.
    expect(P.validateObservationDetailed(dto).ok).toBe(true);
    expect(JSON.stringify(dto)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 3. Strict closed schemas (§13.2)
// ---------------------------------------------------------------------------

describe('strict unknown-input rejection (§13.2)', () => {
  it('rejects unknown top-level and nested fields with E_SCHEMA', () => {
    expectCode(P.validateActionRequestDetailed(actionRequest({ extra: 1 })), 'E_SCHEMA');
    const nested = actionRequest({ payload: { type: 'scan', injected: true } });
    expectCode(P.validateActionRequestDetailed(nested), 'E_SCHEMA');
    expectCode(P.validateObservationDetailed(observation({ extra: 1 })), 'E_SCHEMA');
    const nestedObs = observation();
    (nestedObs.current as Record<string, unknown>).self =
      { ...(nestedObs.current as Record<string, any>).self, extra: 1 };
    expectCode(P.validateObservationDetailed(nestedObs), 'E_SCHEMA');
  });

  it('rejects payload.type !== outer type and deadlineTick < targetTick', () => {
    expectCode(
      P.validateActionRequestDetailed(actionRequest({ type: 'scan', payload: { type: 'jam', targetId: TGT } })),
      'E_SCHEMA',
    );
    expectCode(P.validateActionRequestDetailed(actionRequest({ deadlineTick: 10 })), 'E_SCHEMA');
  });

  it('rejects NaN, Infinity, -Infinity and undefined', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expectCode(P.validateActionRequestDetailed(actionRequest({ targetTick: bad })), 'E_SCHEMA');
      expectCode(P.validateObservationDetailed(observation({ tick: bad })), 'E_SCHEMA');
    }
    expectCode(P.validateActionRequestDetailed(actionRequest({ issuedAtMs: undefined })), 'E_SCHEMA');
    expectCode(P.validateObservationDetailed(observation({ omittedFieldCount: undefined })), 'E_SCHEMA');
    expectCode(P.validateActionRequestDetailed(actionRequest({ payload: { type: 'move', direction: { x: NaN, y: 0 }, durationTicks: 1 } })), 'E_SCHEMA');
  });

  it('rejects Set / Map / Date / function / symbol / bigint / class instances', () => {
    class Intruder { public readonly x = 1; }
    for (const bad of [new Set([1]), new Map(), new Date(0), () => 1, Symbol('x'), 1n, new Intruder()]) {
      expectCode(P.validateActionRequestDetailed(actionRequest({ clientSeq: bad })), 'E_SCHEMA');
    }
    const cycle: Record<string, unknown> = actionRequest();
    cycle.selfRef = cycle;
    expectCode(P.validateActionRequestDetailed(cycle), 'E_SCHEMA');
  });

  it('rejects non-integer / out-of-range ticks, durations and coordinates', () => {
    expectCode(P.validateActionRequestDetailed(actionRequest({ targetTick: -1 })), 'E_SCHEMA');
    expectCode(P.validateActionRequestDetailed(actionRequest({ targetTick: 1.5 })), 'E_SCHEMA');
    expectCode(P.validateActionRequestDetailed(actionRequest({ targetTick: 2 ** 53 })), 'E_SCHEMA');
    expectCode(P.validateActionRequestDetailed(actionRequest({ epoch: -0 })), 'E_SCHEMA');
    const tooLong = actionRequest({
      type: 'wait', payload: { type: 'wait', durationTicks: P.AI_NATIVE_LIMITS_V1.MAX_ACTION_DURATION_TICKS + 1 },
    });
    expectCode(P.validateActionRequestDetailed(tooLong), 'E_SCHEMA');
  });

  it('rejects malformed opaque IDs and wrong types', () => {
    expectCode(P.validateActionRequestDetailed(actionRequest({ sessionId: 'player' })), 'E_SCHEMA');
    expectCode(P.validateActionRequestDetailed(actionRequest({ actorId: 'echo' })), 'E_SCHEMA');
    expectCode(P.validateActionRequestDetailed(actionRequest({ actionId: 'not-an-id' })), 'E_SCHEMA');
    expectCode(P.validateActionRequestDetailed(actionRequest({ clientSeq: '7' })), 'E_SCHEMA');
    expectCode(P.validateActionRequestDetailed(actionRequest({ targetId: 'aim' })), 'E_SCHEMA');
  });

  it('rejects unsupported protocolVersion / schema with E_VERSION_UNSUPPORTED', () => {
    expectCode(P.validateActionRequestDetailed(actionRequest({ protocolVersion: 2 })), 'E_VERSION_UNSUPPORTED');
    expectCode(P.validateActionRequestDetailed(actionRequest({ schema: 'last_signal.ai-native.dto.v2' })), 'E_VERSION_UNSUPPORTED');
    expectCode(P.validateObservationDetailed(observation({ schema: DTO })), 'E_VERSION_UNSUPPORTED');
    expectCode(P.validateSnapshotDetailed(snapshot({ protocolVersion: 2 })), 'E_VERSION_UNSUPPORTED');
  });

  it('rejects prototype-pollution keys and accessor properties', () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":true}}');
    Object.assign(polluted, actionRequest());
    expectCode(P.validateActionRequestDetailed(polluted), 'E_SCHEMA');
    expectCode(P.validateActionRequestDetailed(actionRequest({ constructor: 'x' })), 'E_SCHEMA');
    const withGetter = actionRequest();
    Object.defineProperty(withGetter, 'computed', { enumerable: true, get: () => 1 });
    expectCode(P.validateActionRequestDetailed(withGetter), 'E_SCHEMA');
  });

  it('rejects an unknown action type with E_SCHEMA', () => {
    expectCode(P.validateActionRequestDetailed(actionRequest({ type: 'teleport', payload: { type: 'teleport' } })), 'E_SCHEMA');
    expectCode(P.validateActionRequestDetailed(actionRequest({ type: 'action_aim', payload: { type: 'action_aim' } })), 'E_SCHEMA');
  });
});

// ---------------------------------------------------------------------------
// 4. aim / fire / decoy: unsupported, never "game implemented" (Non-blocking contract item)
// ---------------------------------------------------------------------------

describe('unsupported aim/fire/decoy cannot masquerade as implemented', () => {
  it('declares them unsupported and returns E_NOT_APPLICABLE from the support gate', () => {
    for (const type of ['aim', 'fire', 'decoy']) {
      expect(P.isUnsupportedAction(type)).toBe(true);
      expectCode(P.validateActionSupport(type), 'E_NOT_APPLICABLE');
    }
    for (const type of ['move', 'scan', 'jam', 'interact', 'shoot_guard', 'wait']) {
      expect(P.isUnsupportedAction(type)).toBe(false);
      expect(P.validateActionSupport(type).ok).toBe(true);
    }
    expectCode(P.validateActionSupport('teleport'), 'E_SCHEMA');
  });

  it('a wire-valid aim/fire ActionRequest is NOT evidence of game implementation', () => {
    const aim = actionRequest({ type: 'aim', payload: { type: 'aim', direction: { x: 1, y: 0 } } });
    const fire = actionRequest({ type: 'fire', payload: { type: 'fire', held: true, durationTicks: 2 } });
    expect(P.validateActionRequest(aim)).toBe(true); // shape only
    expect(P.validateActionRequest(fire)).toBe(true);
    expectCode(P.validateActionSupport(aim.type), 'E_NOT_APPLICABLE');
    expectCode(P.validateActionSupport(fire.type), 'E_NOT_APPLICABLE');
    expect(P.GAME_IMPLEMENTATION_STATUS.mcpServer).toBe('NOT_IMPLEMENTED_P0');
    expect(P.AI_NATIVE_UNSUPPORTED_ACTIONS_V1).toContain('aim');
    expect(P.AI_NATIVE_UNSUPPORTED_ACTIONS_V1).toContain('fire');
  });

  it('an ActionResult cannot claim completion for an unsupported action kind', () => {
    // ActionResultV1 has no `type` field at all; injecting one is an unknown field.
    expectCode(P.validateActionResultDetailed(actionResult({ type: 'fire' })), 'E_SCHEMA');
    expectCode(P.validateActionResultDetailed(actionResult({ code: 'E_NOT_APPLICABLE', status: 'completed' })), 'E_SCHEMA');
  });
});

// ---------------------------------------------------------------------------
// 5. Permissions / Dev isolation (§13.6, permission model §1–§4)
// ---------------------------------------------------------------------------

describe('permission and Dev isolation', () => {
  it('production CreateSessionRequest with seed / fixtureRef / DEVELOPER is rejected', () => {
    expectCode(P.validateCreateSessionRequestDetailed(createSessionRequest({ seed: 42 })), 'E_PERMISSION');
    expectCode(P.validateCreateSessionRequestDetailed(createSessionRequest({ fixtureRef: 'fixture_1' })), 'E_PERMISSION');
    const withDev = createSessionRequest({
      actorSpecs: [{ role: 'DEVELOPER', observationScope: 'self', allowedActions: [] }],
    });
    expectCode(P.validateCreateSessionRequestDetailed(withDev), 'E_PERMISSION');
    // test-kind sessions may carry a seed, and may contain DEVELOPER
    const testRequest = createSessionRequest({ kind: 'test', seed: 42, actorSpecs: [{ role: 'DEVELOPER', observationScope: 'self', allowedActions: [] }] });
    expect(P.validateCreateSessionRequest(testRequest)).toBe(true);
  });

  it('production SessionDescriptor cannot contain DEVELOPER; priorities are fixed', () => {
    const devBinding = { actorId: ACT, role: 'DEVELOPER', priority: 2, allowedActions: [], observationScope: 'self' };
    expectCode(P.validateSessionDescriptorDetailed(sessionDescriptor({ actorRegistry: { [ACT]: devBinding } })), 'E_PERMISSION');
    const wrongPriority = { actorId: ACT, role: 'PLAYER', priority: 2, allowedActions: [], observationScope: 'self' };
    expectCode(P.validateSessionDescriptorDetailed(sessionDescriptor({ actorRegistry: { [ACT]: wrongPriority } })), 'E_PERMISSION');
    expect(P.validateSessionDescriptor(sessionDescriptor({ kind: 'test', actorRegistry: { [ACT]: devBinding } }))).toBe(true);
  });

  it('COMPANION has no world-write actions and only shared observation scope', () => {
    const companion = { actorId: ACT, role: 'COMPANION', priority: 1, allowedActions: [], observationScope: 'shared' };
    expect(P.validateSessionDescriptor(sessionDescriptor({ actorRegistry: { [ACT]: companion } }))).toBe(true);
    expectCode(P.validateActionPermission(companion as P.ActorBindingV1, 'scan', 'production'), 'E_PERMISSION');
    const withActions = { ...companion, allowedActions: ['scan'] };
    expectCode(P.validateSessionDescriptorDetailed(sessionDescriptor({ actorRegistry: { [ACT]: withActions } })), 'E_PERMISSION');
  });

  it('PLAYER world writes require an explicit grant; unsupported types stay E_NOT_APPLICABLE', () => {
    const player = { actorId: ACT, role: 'PLAYER', priority: 0, allowedActions: ['scan', 'fire'], observationScope: 'self' } as P.ActorBindingV1;
    expect(P.validateActionPermission(player, 'scan', 'production').ok).toBe(true);
    expectCode(P.validateActionPermission(player, 'jam', 'production'), 'E_PERMISSION');
    expectCode(P.validateActionPermission(player, 'fire', 'production'), 'E_NOT_APPLICABLE');
  });

  it('detail:"debug" is E_PERMISSION for PLAYER/COMPANION; debug is a separate DTO', () => {
    expectCode(P.validateObservationDetailed(observation({ detail: 'debug' })), 'E_PERMISSION');
    expectCode(P.validateObserveDetail('PLAYER', 'debug'), 'E_PERMISSION');
    expectCode(P.validateObserveDetail('COMPANION', 'debug'), 'E_PERMISSION');
    expect(P.validateObserveDetail('PLAYER', 'standard').ok).toBe(true);
    expect(P.validateDebugInspection(debugInspection())).toBe(true);
    expectCode(P.validateDebugInspectionDetailed(debugInspection({ role: 'PLAYER' })), 'E_SCHEMA');
    expectCode(P.validateObservationDetailed(debugInspection()), 'E_VERSION_UNSUPPORTED');
  });

  it('ActionRequest cannot carry role/permission/asActor/impersonate/debug/seed/fixture', () => {
    for (const field of ['role', 'permission', 'asActor', 'impersonate', 'debug', 'seed', 'fixture']) {
      expectCode(P.validateActionRequestDetailed(actionRequest({ [field]: 'PLAYER' })), 'E_SCHEMA');
    }
  });

  it('hidden fields are rejected in public Observation / Error / Event payloads', () => {
    expect(P.hasHiddenField({ seed: 1 })).toBe('$.seed');
    expect(P.hasHiddenField({ nested: { rngState: 2 } })).toBe('$.nested.rngState');
    expect(P.hasHiddenField({ role: 'PLAYER' }, ['role'])).toBeNull();
    expectCode(P.validateObservationDetailed(observation({ seed: 42 })), 'E_SCHEMA');
    const leaky = observation();
    (leaky.current as Record<string, unknown>).publicDeviceState = { door: 'SEALED', doorPassable: false, stateTimer: 3 };
    expectCode(P.validateObservationDetailed(leaky), 'E_SCHEMA');
    expectCode(P.validateErrorDetailed(errorDto({ rngState: 1 })), 'E_SCHEMA');
    expectCode(P.validateEventDetailed(event({ payload: { actionId: AID, seed: 9 } })), 'E_SCHEMA');
  });

  it('knowledge / hypotheses are always empty in P0 (never auto-promoted)', () => {
    expectCode(P.validateObservationDetailed(observation({ knowledge: [{ fact: 1 }] })), 'E_SCHEMA');
    expectCode(P.validateObservationDetailed(observation({ hypotheses: [{ guess: 1 }] })), 'E_SCHEMA');
  });

  it('production snapshots/replays are valid PRIVATE frames (structure != authorization)', () => {
    // Internal production snapshots may carry internal state; structural
    // validation must NOT reject them. Delivery is a separate audience gate.
    expect(P.validateSnapshot(snapshot({ dev: { seed: 1 } }))).toBe(true);
    expect(P.validateReplay(replay({ dev: { seed: 1 } }))).toBe(true);
    expect(P.validateSnapshot(snapshot())).toBe(true);
  });

  it('PLAYER / COMPANION can never receive raw SnapshotV1 / ReplayV1', () => {
    for (const kind of ['snapshot', 'replay'] as const) {
      for (const role of ['PLAYER', 'COMPANION'] as const) {
        for (const sessionKind of ['production', 'test'] as const) {
          expectCode(P.authorizeRawFrame({ role, sessionKind }, kind), 'E_PERMISSION');
          // Stripping the dev segment must NOT make it deliverable to Player.
          expectCode(P.authorizeRawFrame({ role, sessionKind, devSegmentRemoved: true }, kind), 'E_PERMISSION');
        }
      }
      // DEVELOPER in a production session may not export raw frames either.
      expectCode(P.authorizeRawFrame({ role: 'DEVELOPER', sessionKind: 'production' }, kind), 'E_PERMISSION');
      // Only DEVELOPER + test is allowed; this is a pure check, not a delivery.
      const allowed = P.authorizeRawFrame({ role: 'DEVELOPER', sessionKind: 'test' }, kind);
      expect(allowed.ok).toBe(true);
      if (allowed.ok) expect(allowed.value.kind).toBe(kind);
      expectCode(P.authorizeRawFrame({ role: 'NOBODY', sessionKind: 'test' }, kind), 'E_SCHEMA');
      expectCode(P.authorizeRawFrame({ role: 'PLAYER', sessionKind: 'other' }, kind), 'E_SCHEMA');
      expectCode(P.authorizeRawFrame(null, kind), 'E_SCHEMA');
      expectCode(P.authorizeRawFrame({ role: 'DEVELOPER', sessionKind: 'test', devSegmentRemoved: 'yes' }, kind), 'E_SCHEMA');
    }
  });

  it('structural validation passing does not grant an audience', () => {
    const frame = snapshot();
    expect(P.validateSnapshot(frame)).toBe(true);
    expectCode(P.authorizeRawFrame({ role: 'PLAYER', sessionKind: 'production' }, 'snapshot'), 'E_PERMISSION');
    expectCode(P.authorizeRawFrame({ role: 'COMPANION', sessionKind: 'production' }, 'replay'), 'E_PERMISSION');
  });

  it('observedState only accepts the documented key whitelist', () => {
    expectCode(P.validateObservationEvidenceDetailed(evidence({ observedState: { seed: 1 } })), 'E_SCHEMA');
    expectCode(P.validateObservationEvidenceDetailed(evidence({ observedState: { nested: { x: 1 } } })), 'E_SCHEMA');
    expect(P.validateObservationEvidenceDetailed(evidence({ observedState: { bridgePassable: true, stateLabel: 'STABLE' } })).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Tick boundaries / stage order (§13.4, §13.5)
// ---------------------------------------------------------------------------

describe('tick boundaries and validation stage order', () => {
  it('targetTick must equal currentTick + 1', () => {
    expect(P.validateActionTargetTick({ targetTick: 11 }, 10).ok).toBe(true);
    expectCode(P.validateActionTargetTick({ targetTick: 10 }, 10), 'E_STALE_TICK');
    expectCode(P.validateActionTargetTick({ targetTick: 12 }, 10), 'E_FUTURE_TICK');
  });

  it('StepRequest actions must all target fromTick + 1', () => {
    const base = {
      schema: DTO, protocolVersion: 1, requestId: RID, sessionId: SES, epoch: 1,
      fromTick: 10, ticks: 1, actions: [], includeObservation: false,
    };
    expect(P.validateStepRequest(base)).toBe(true);
    expectCode(P.validateStepRequestDetailed({ ...base, actions: [actionRequest({ targetTick: 10 })] }), 'E_STALE_TICK');
    expectCode(P.validateStepRequestDetailed({ ...base, actions: [actionRequest({ targetTick: 12 })] }), 'E_FUTURE_TICK');
  });

  it('firstErrorByStage returns only the earliest cause', () => {
    const issues = [
      { stage: 10, code: 'E_COOLDOWN' as const },
      { stage: 1, code: 'E_SCHEMA' as const },
      { stage: 6, code: 'E_PERMISSION' as const },
    ];
    expect(P.firstErrorByStage(issues)?.code).toBe('E_SCHEMA');
    expect(P.firstErrorByStage([])).toBeNull();
    expect(P.AI_NATIVE_VALIDATION_STAGES_V1[0]).toBe('payload');
    expect(P.AI_NATIVE_VALIDATION_STAGES_V1).toContain('transaction');
  });

  it('action ordering uses (targetTick, priority, actorId, actionId), not transport fields', () => {
    const priorityOf = (actorId: P.ActorId) => (actorId === ACT ? 0 : 1);
    const low = { targetTick: 11, actorId: ACT, actionId: 'aid_ffffffffffffffffffffffff' as P.ActionId };
    const high = { targetTick: 11, actorId: ACT2, actionId: 'aid_000000000000000000000000' as P.ActionId };
    expect(P.compareActionOrder(low, high, priorityOf)).toBeLessThan(0);
    const earlier = { ...high, targetTick: 10 };
    expect(P.compareActionOrder(earlier, low, priorityOf)).toBeLessThan(0);
    // transportSeq / issuedAtMs are not part of the ordering key.
    const withTransport = { ...low, transportSeq: 999, issuedAtMs: 999999 };
    expect(P.compareActionOrder(withTransport, low, priorityOf)).toBe(0);
  });

  it('event total order is (tick, phase, ordinal, actorId ?? "", eventId)', () => {
    const base = event({ actorId: undefined });
    delete (base as Record<string, unknown>).actorId;
    const a = unwrap(P.validateEventDetailed(event({ eventId: 'evt_aaa', actorId: ACT })));
    const b = unwrap(P.validateEventDetailed(event({ eventId: 'evt_bbb', actorId: ACT2 })));
    expect(P.compareEventOrder(a, b)).toBeLessThan(0);
    const laterTick = unwrap(P.validateEventDetailed(event({ tick: 11 })));
    expect(P.compareEventOrder(a, laterTick)).toBeLessThan(0);
    const same = unwrap(P.validateEventDetailed(event()));
    expect(P.compareEventOrder(same, same)).toBe(0);
    expect(base).toBeTruthy();
  });

  it('event payload key whitelist depends on event type (§8)', () => {
    expect(P.validateEvent(event({ type: 'SESSION_CREATED', payload: { status: 'created' } }))).toBe(true);
    expectCode(P.validateEventDetailed(event({ type: 'SESSION_CREATED', payload: { actionId: AID } })), 'E_SCHEMA');
    // A subset of whitelisted keys is valid; a non-whitelisted key is not.
    expect(P.validateEvent(event({ type: 'DEV_FIXTURE_INJECTED', payload: { fixtureId: 'f1' } }))).toBe(true);
    expectCode(P.validateEventDetailed(event({ type: 'DEV_FIXTURE_INJECTED', payload: { fixtureId: 'f1', cost: 1 } })), 'E_SCHEMA');
    const devEvent = event({
      type: 'DEV_FIXTURE_INJECTED',
      payload: { fixtureId: 'f1', actorId: ACT, tick: 10, targetId: TGT },
    });
    expect(P.validateEvent(devEvent)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. canonicalJson / payloadFingerprint / redactError (§2.2, §3)
// ---------------------------------------------------------------------------

describe('canonicalJson and payloadFingerprint', () => {
  it('sorts object keys by code point, preserves array order', () => {
    expect(P.canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(P.canonicalJson({ z: [3, 1, 2], a: { d: 4, c: 5 } })).toBe('{"a":{"c":5,"d":4},"z":[3,1,2]}');
    expect(P.canonicalJson({ '😀': 1, '\uE000': 2 })).toBe('{"\uE000":2,"😀":1}');
    expect(P.canonicalJson({ b: 1, a: 1 })).toBe(P.canonicalJson({ a: 1, b: 1 }));
  });

  it('normalizes -0 and rejects non-plain JSON values', () => {
    expect(P.canonicalJson({ x: -0 })).toBe('{"x":0}');
    class Thing { public readonly a = 1; }
    for (const bad of [NaN, Infinity, -Infinity, undefined, new Set(), new Map(), new Date(), new Thing(), () => 1, 1n, Symbol('x')]) {
      expect(() => P.canonicalJson({ x: bad })).toThrow(P.AiNativeProtocolError);
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => P.canonicalJson(cyclic)).toThrow(/cycle/);
    const sparse: unknown[] = new Array(2);
    sparse[1] = 1;
    expect(() => P.canonicalJson(sparse)).toThrow(P.AiNativeProtocolError);
    const withGetter = {};
    Object.defineProperty(withGetter, 'x', { enumerable: true, get: () => 1 });
    expect(() => P.canonicalJson(withGetter)).toThrow(P.AiNativeProtocolError);
  });

  it('payloadFingerprint is fnv1a32 over canonical UTF-8 bytes (known vectors)', () => {
    expect(P.payloadFingerprint({})).toBe('fnv1a32:5465b825');
    expect(P.payloadFingerprint({ b: 2, a: 1 })).toBe('fnv1a32:5314055b');
    expect(P.payloadFingerprint({ a: 1, b: 2 })).toBe(P.payloadFingerprint({ b: 2, a: 1 }));
    expect(P.payloadFingerprint({ k: '信号' })).toBe('fnv1a32:9f4dbbc9');
    expect(P.payloadFingerprint({ '😀': 1 })).toBe('fnv1a32:bc24a77b');
    expect(P.payloadFingerprint({})).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(P.AI_NATIVE_ID_PATTERNS_V1.sessionId.test(SES)).toBe(true);
  });

  it('validatePayloadSize enforces MAX_PAYLOAD_BYTES', () => {
    expect(P.validatePayloadSize(actionRequest()).ok).toBe(true);
    expectCode(P.validatePayloadSize({ blob: 'x'.repeat(5000) }), 'E_PAYLOAD_TOO_LARGE');
  });
});

describe('redactError (§4.4)', () => {
  it('keeps only whitelisted fields and replaces unsafe messageKey', () => {
    const dirty = { ...errorDto({ messageKey: 'leak.seed.value' }), seed: 42, stack: 'internal/path' };
    const clean = P.redactError(dirty as unknown as P.ErrorV1);
    expect(clean.code).toBe('E_SCHEMA');
    expect(clean.messageKey).toBe('error.generic');
    expect(clean.retryable).toBe(false);
    expect(Object.keys(clean)).not.toContain('seed');
    expect(Object.keys(clean)).not.toContain('stack');
    expect(JSON.stringify(clean)).not.toMatch(/42|internal\/path/);
    expect(Object.isFrozen(clean)).toBe(true);
  });

  it('keeps a safe messageKey and fixed safe error text', () => {
    const clean = P.redactError(errorDto({ code: 'E_PERMISSION', messageKey: 'error.permission' }) as unknown as P.ErrorV1);
    expect(clean.messageKey).toBe('error.permission');
    expect(P.AI_NATIVE_ERROR_MESSAGES_V1.E_PERMISSION).not.toMatch(/seed|path|stack/i);
    expect(P.validateErrorDetailed(clean).ok).toBe(true);
  });

  it('throws on an invalid ErrorV1 shape', () => {
    expect(() => P.redactError({ code: 'E_SCHEMA' } as unknown as P.ErrorV1)).toThrow(P.AiNativeProtocolError);
  });
});

// ---------------------------------------------------------------------------
// 8. Idempotency (§13.3)
// ---------------------------------------------------------------------------

describe('idempotency check (pure, no global cache)', () => {
  const entry = (overrides: Partial<P.IdempotencyEntryV1> = {}): P.IdempotencyEntryV1 => ({
    sessionId: SES, epoch: 1, actorId: ACT, actionId: AID, payloadHash: FNV, ...overrides,
  });

  it('same key + same hash => replayed, different hash => E_ID_PAYLOAD_MISMATCH', () => {
    const result = P.checkIdempotency(entry(), entry());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.replayed).toBe(true);
    expectCode(P.checkIdempotency(entry(), entry({ payloadHash: 'fnv1a32:deadbeef' })), 'E_ID_PAYLOAD_MISMATCH');
  });

  it('cross-epoch / cross-session caches are isolated', () => {
    expectCode(P.checkIdempotency(entry(), entry({ epoch: 2 })), 'E_STALE_EPOCH');
    expectCode(P.checkIdempotency(entry(), entry({ sessionId: `ses_${'f'.repeat(24)}` as P.SessionId })), 'E_STALE_EPOCH');
  });

  it('fingerprint of a canonical action payload is stable across key order', () => {
    const a = P.payloadFingerprint({ type: 'scan', targetTick: 11 });
    const b = P.payloadFingerprint({ targetTick: 11, type: 'scan' });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 9. R9 evidence restore / snapshot & replay compatibility (§13.7, §13.8)
// ---------------------------------------------------------------------------

describe('R9 observation evidence restore', () => {
  it('same snapshot restored twice yields identical evidence and TTL (no re-scan)', () => {
    const items = [evidence()] as unknown as P.ObservationEvidenceV1[];
    const first = P.validateRestoredEvidence(items, 10, 1);
    const second = P.validateRestoredEvidence(items, 10, 1);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value).toEqual(second.value);
      expect(first.value[0].expiresAtTick).toBe(20);
      expect(first.value[0].observedAtTick).toBe(5);
    }
  });

  it('rejects expired evidence, wrong sceneEpoch, and bad shape', () => {
    expectCode(P.validateRestoredEvidence([evidence({ expiresAtTick: 10 })] as never, 10, 1), 'E_SNAPSHOT_INVALID');
    expectCode(P.validateRestoredEvidence([evidence({ sceneEpoch: 9 })] as never, 10, 1), 'E_SNAPSHOT_INVALID');
    expectCode(P.validateRestoredEvidence([evidence({ observedAtTick: 11 })] as never, 10, 1), 'E_SNAPSHOT_INVALID');
    expectCode(P.validateRestoredEvidence([{ bogus: 1 }] as never, 10, 1), 'E_SCHEMA');
  });

  it('old saves with no evidence simply clear (empty array), without inventing any', () => {
    const result = P.validateRestoredEvidence([], 10, 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });

  it('observation evidence with observedAtTick >= expiresAtTick is rejected', () => {
    expectCode(P.validateObservationDetailed(observation({ evidence: [evidence({ observedAtTick: 20, expiresAtTick: 20 })] })), 'E_SCHEMA');
  });
});

describe('Snapshot / Replay compatibility (death is a new run)', () => {
  it('rejects wrong version / kernelVersion / schema', () => {
    expectCode(P.validateSnapshotDetailed(snapshot({ protocolVersion: 2 })), 'E_VERSION_UNSUPPORTED');
    expectCode(P.validateSnapshotDetailed(snapshot({ kernelVersion: 'station-zero-r1-r2@2' })), 'E_SCHEMA');
    expectCode(P.validateReplayDetailed(replay({ kernelVersion: 'station-zero-r1-r2@2' })), 'E_SCHEMA');
    expectCode(P.validateReplayDetailed(replay({ schema: SNAP })), 'E_VERSION_UNSUPPORTED');
  });

  it('rejects cross-session / cross-kind replay', () => {
    const r = P.validateReplayDetailed(replay());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const good = P.validateReplayCompatibility(r.value, { sessionId: SES, sessionKind: 'production' });
    expect(good.ok).toBe(true);
    expectCode(P.validateReplayCompatibility(r.value, { sessionId: SES, sessionKind: 'test' }), 'E_REPLAY_INCOMPATIBLE');
    expectCode(P.validateReplayCompatibility(r.value, { sessionId: `ses_${'f'.repeat(24)}` as P.SessionId, sessionKind: 'production' }), 'E_REPLAY_INCOMPATIBLE');
    expectCode(P.validateReplayCompatibility({ ...r.value, kernelVersion: 'station-zero-r1-r2@2' } as never, { sessionId: SES, sessionKind: 'production' }), 'E_REPLAY_INCOMPATIBLE');
  });

  it('a finished(died) snapshot is not restorable as a live run', () => {
    const died = P.validateSnapshotDetailed(snapshot({ runStatus: 'finished', runEndReason: 'died' }));
    expect(died.ok).toBe(true);
    if (died.ok) expectCode(P.validateRestoreEligibility(died.value), 'E_SNAPSHOT_INVALID');
    const active = P.validateSnapshotDetailed(snapshot());
    expect(active.ok).toBe(true);
    if (active.ok) expect(P.validateRestoreEligibility(active.value).ok).toBe(true);
  });

  it('rejects a snapshot whose state shape deviates from PersistedSliceState', () => {
    expectCode(P.validateSnapshotDetailed(snapshot({ state: { schema: 'other', version: 2 } })), 'E_SCHEMA');
    expectCode(P.validateSnapshotDetailed(snapshot({ state: sliceState({ remaining: { jam: 0 } }) })), 'E_SCHEMA');
    expectCode(P.validateSnapshotDetailed(snapshot({ state: sliceState({ NaNField: NaN }) })), 'E_SCHEMA');
  });

  it('rejects a bad hash shape, and non-null rngState', () => {
    expectCode(P.validateSnapshotDetailed(snapshot({ snapshotHash: 'deadbeef' })), 'E_SCHEMA');
    expectCode(P.validateSnapshotDetailed(snapshot({ rngState: 1 })), 'E_SCHEMA');
    expectCode(P.validateReplayDetailed(replay({ eventsHash: 'x' })), 'E_SCHEMA');
  });
});

// ---------------------------------------------------------------------------
// 10. Resource limits / pagination / terminal idempotency (§13.10)
// ---------------------------------------------------------------------------

describe('resource limits, pagination and terminal idempotency', () => {
  it('enforces MAX_EVENTS_PER_PAGE and explicit droppedEvents accounting', () => {
    expect(P.validateEventPage(0, 256).ok).toBe(true);
    expectCode(P.validateEventPage(0, 257), 'E_RESOURCE_LIMIT');
    expectCode(P.validateEventPage(-1, 10), 'E_SCHEMA');
    expect(P.truncateEventLog(100)).toEqual({ kept: 100, droppedEvents: 0 });
    expect(P.truncateEventLog(10001)).toEqual({ kept: 10000, droppedEvents: 1 });
    expect(() => P.truncateEventLog(-1)).toThrow(P.AiNativeProtocolError);
  });

  it('rejects oversized StepRequest ticks / actions', () => {
    const base = {
      schema: DTO, protocolVersion: 1, requestId: RID, sessionId: SES, epoch: 1,
      fromTick: 10, ticks: 1, actions: [], includeObservation: false,
    };
    expectCode(P.validateStepRequestDetailed({ ...base, ticks: P.AI_NATIVE_LIMITS_V1.MAX_TICKS_PER_STEP + 1 }), 'E_SCHEMA');
    const tooMany = Array.from({ length: P.AI_NATIVE_LIMITS_V1.MAX_ACTIONS_PER_TICK + 1 }, () => actionRequest({ targetTick: 11 }));
    expectCode(P.validateStepRequestDetailed({ ...base, actions: tooMany }), 'E_SCHEMA');
  });

  it('terminal cancellation / timeout is idempotent with zero resource writes', () => {
    for (const status of ['completed', 'rejected', 'timeout', 'cancelled', 'preempted'] as const) {
      const result = P.validateCancelTerminal(status);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({ idempotent: true, resourceWrites: 0 });
    }
    expectCode(P.validateCancelTerminal('pending' as P.ActionStatusV1), 'E_SCHEMA');
    expectCode(P.validateActionDeadline(11, 10), 'E_TIMEOUT');
    expect(P.validateActionDeadline(10, 10).ok).toBe(true);
  });

  it('CreateSessionRequest resourceLimits can only tighten', () => {
    expect(P.validateCreateSessionRequest(createSessionRequest({ resourceLimits: { maxTicksPerStep: 10 } }))).toBe(true);
    const tooLoose = createSessionRequest({ resourceLimits: { maxTicksPerStep: P.AI_NATIVE_LIMITS_V1.MAX_TICKS_PER_STEP + 1 } });
    expectCode(P.validateCreateSessionRequestDetailed(tooLoose), 'E_SCHEMA');
    expectCode(P.validateCreateSessionRequestDetailed(createSessionRequest({ resourceLimits: { unknownKey: 1 } })), 'E_SCHEMA');
  });
});

// ---------------------------------------------------------------------------
// 11. Envelope / request discrimination
// ---------------------------------------------------------------------------

describe('envelope and request discrimination', () => {
  it('kind couples to the payload shape', () => {
    expect(P.validateEnvelope(envelope()).valueOf).toBeTruthy();
    // Positive: ordinary request / response / event envelopes remain valid.
    expect(P.validateEnvelope(envelope())).toBe(true);
    expect(P.validateEnvelope(envelope({ kind: 'response', payload: stepResult() }))).toBe(true);
    expect(P.validateEnvelope(envelope({ kind: 'event', payload: event() }))).toBe(true);
    expectCode(P.validateEnvelopeDetailed(envelope({ kind: 'response', payload: actionRequest() })), 'E_SCHEMA');
    expectCode(P.validateEnvelopeDetailed(envelope({ kind: 'request', payload: stepResult() })), 'E_SCHEMA');
  });

  // Reviewer P0-1: private storage frames must not be public response payloads.
  it('REJECTS a response envelope carrying a private SnapshotV1', () => {
    expect(P.validateSnapshot(snapshot())).toBe(true); // independent frame still valid
    expect(P.validateEnvelope(envelope({ kind: 'response', payload: snapshot() }))).toBe(false);
    expectCode(P.validateEnvelopeDetailed(envelope({ kind: 'response', payload: snapshot() })), 'E_SCHEMA');
  });

  it('REJECTS a response envelope carrying a private ReplayV1', () => {
    expect(P.validateReplay(replay())).toBe(true); // independent frame still valid
    expect(P.validateEnvelope(envelope({ kind: 'response', payload: replay() }))).toBe(false);
    expectCode(P.validateEnvelopeDetailed(envelope({ kind: 'response', payload: replay() })), 'E_SCHEMA');
  });

  // Reviewer P0-2: 'notification' is not a session envelope kind.
  it('REJECTS a notification envelope even with a valid EventV1 payload', () => {
    expect(P.validateEvent(event())).toBe(true);
    expect(P.validateEnvelope(envelope({ kind: 'event', payload: event() }))).toBe(true);
    expect(P.validateEnvelope(envelope({ kind: 'notification', payload: event() }))).toBe(false);
    expectCode(P.validateEnvelopeDetailed(envelope({ kind: 'notification', payload: event() })), 'E_SCHEMA');
  });

  it('Dev/test independent private frames remain valid outside public envelopes', () => {
    expect(P.validateSnapshot(snapshot({ sessionKind: 'test', dev: { seed: 1 } }))).toBe(true);
    expect(P.validateReplay(replay({ sessionKind: 'test', dev: { seed: 1 } }))).toBe(true);
    expect(P.authorizeRawFrame({ role: 'DEVELOPER', sessionKind: 'test' }, 'snapshot').ok).toBe(true);
    expectCode(P.authorizeRawFrame({ role: 'PLAYER', sessionKind: 'production' }, 'snapshot'), 'E_PERMISSION');
  });

  it('rejects wrong envelope schema / unknown kind / bad transportSeq', () => {
    expectCode(P.validateEnvelopeDetailed(envelope({ schema: DTO })), 'E_VERSION_UNSUPPORTED');
    expectCode(P.validateEnvelopeDetailed(envelope({ kind: 'bogus' })), 'E_SCHEMA');
    expectCode(P.validateEnvelopeDetailed(envelope({ transportSeq: -1 })), 'E_SCHEMA');
    expectCode(P.validateRequestDetailed({ schema: DTO, protocolVersion: 1 }), 'E_SCHEMA');
  });

  it('exposes the fixed-name type guards required by protocol §3', () => {
    for (const name of [
      'validateEnvelope', 'validateRequest', 'validateActionRequest', 'validateObservation',
      'validateDebugInspection', 'validateEvent', 'validateSnapshot', 'validateReplay',
      'isCompatibleVersion', 'canonicalJson', 'payloadFingerprint', 'redactError',
    ]) {
      expect(typeof (P as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// 12. v1 vocabulary: no legacy actor aliases; pause/resume are SessionCommands
// ---------------------------------------------------------------------------

describe('v1 vocabulary and ObservationEvidenceV1 version field', () => {
  it('no player/echo legacy aliases are exported', () => {
    const exports = Object.keys(P);
    for (const legacy of ['ACTORS', 'isActor', 'AI_NATIVE_ROLE_TO_LEGACY_ACTOR_V1', 'AI_NATIVE_P0_CAPABILITIES_V1']) {
      expect(exports).not.toContain(legacy);
    }
    expect(P.AI_NATIVE_SESSION_COMMANDS_V1).toContain('pause');
    expect(P.AI_NATIVE_SESSION_COMMANDS_V1).toContain('resume');
    expect(P.AI_NATIVE_ACTION_TYPES_V1).not.toContain('pause' as P.ActionTypeV1);
    expect(P.AI_NATIVE_ACTION_TYPES_V1).not.toContain('resume' as P.ActionTypeV1);
    expect(P.AI_NATIVE_ROLES_V1).toEqual(['PLAYER', 'COMPANION', 'DEVELOPER']);
  });

  it('ObservationEvidenceV1 requires protocolVersion: 1 and exact schema', () => {
    expect(P.validateObservationEvidenceDetailed(evidence()).ok).toBe(true);
    expectCode(P.validateObservationEvidenceDetailed(evidence({ protocolVersion: 2 })), 'E_VERSION_UNSUPPORTED');
    expectCode(P.validateObservationEvidenceDetailed(evidence({ schema: DTO })), 'E_VERSION_UNSUPPORTED');
    const withoutVersion = evidence();
    delete (withoutVersion as Record<string, unknown>).protocolVersion;
    expectCode(P.validateObservationEvidenceDetailed(withoutVersion), 'E_SCHEMA');
    expectCode(P.validateObservationEvidenceDetailed(evidence({ protocolVersion: '1' })), 'E_SCHEMA');
    // Nested evidence inside an Observation is validated with the same rule.
    expectCode(P.validateObservationDetailed(observation({ evidence: [withoutVersion] })), 'E_SCHEMA');
  });
});
