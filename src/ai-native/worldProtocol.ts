// AI-NATIVE-02 C3-a — strict first-slice World protocol.
//
// This intentionally reuses the AI-NATIVE envelope/error/idempotency primitives
// where they fit, and adds only the two payloads the rendered/headless world
// link needs: WorldActionV1 (intent-only, no actor override) and
// WorldObservationV1 (player-visible whitelist). It does not import Phaser,
// hold simulation state, or define a second full protocol stack.
//
// C3-a scope: schema + validation only. No World/Player/Scene execution here.

import { z } from 'zod';
import {
  AI_NATIVE_ID_PATTERNS_V1, AI_NATIVE_LIMITS_V1, canonicalJson, payloadFingerprint,
  type ErrorCodeV1
} from './protocol';

export const WORLD_SCHEMA_V1 = 'last_signal.world.v1' as const;
export const WORLD_PROTOCOL_VERSION = 1 as const;

export const WORLD_LIMITS = Object.freeze({
  MAX_ACTIONS_PER_BATCH: 8,
  MAX_ACTION_TICKS: 120,
  MAX_TTL_TICKS: 600,
  DEFAULT_TTL_TICKS: 120,
  MAX_ACTION_WALL_MS: 5000,
  MAX_PENDING_ACTIONS: 32,
  MAX_SESSIONS: 4,
  MAX_CACHE_ENTRIES: 128,
  MAX_PAYLOAD_BYTES: 8192,
  MAX_OBSERVATION_DRONES: 32,
  MAX_OBSERVATION_PROJECTILES: 64,
  HEARTBEAT_MS: 1000,
  LOST_AFTER_MS: 5000
});

const actionId = z.string().regex(AI_NATIVE_ID_PATTERNS_V1.actionId);
const requestId = z.string().regex(AI_NATIVE_ID_PATTERNS_V1.requestId);
const sessionId = z.string().regex(AI_NATIVE_ID_PATTERNS_V1.sessionId);
const coordinate = z.number().finite().min(-AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS).max(AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS);
const vec = z.strictObject({ x: coordinate, y: coordinate });
const ticks = z.number().int().min(1).max(WORLD_LIMITS.MAX_ACTION_TICKS);
const ttlTicks = z.number().int().min(1).max(WORLD_LIMITS.MAX_TTL_TICKS);

const moveAction = z.strictObject({
  type: z.literal('move'),
  actionId,
  dir: vec.refine((v) => Math.hypot(v.x, v.y) > 1e-9, 'direction must be non-zero'),
  ticks
});
const stopAction = z.strictObject({ type: z.literal('stop'), actionId });
const aimAction = z.strictObject({ type: z.literal('aim'), actionId, target: vec });
const fireAction = z.strictObject({ type: z.literal('fire'), actionId, target: vec.optional(), ticks });
const interactAction = z.strictObject({ type: z.literal('interact'), actionId });

export const worldActionSchema = z.discriminatedUnion('type', [
  moveAction, stopAction, aimAction, fireAction, interactAction
]);
export type WorldActionV1 = z.infer<typeof worldActionSchema>;

export const worldActionBatchSchema = z.strictObject({
  actions: z.array(worldActionSchema).min(1).max(WORLD_LIMITS.MAX_ACTIONS_PER_BATCH),
  ttlTicks: ttlTicks.optional()
}).superRefine((batch, ctx) => {
  const ids = new Set<string>();
  for (const [index, action] of batch.actions.entries()) {
    if (ids.has(action.actionId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['actions', index, 'actionId'], message: 'duplicate actionId' });
    }
    ids.add(action.actionId);
  }
});
export type WorldActionBatchV1 = z.infer<typeof worldActionBatchSchema>;

const droneSchema = z.strictObject({
  id: z.number().int().min(0).max(AI_NATIVE_LIMITS_V1.MAX_TICK),
  kind: z.string().min(1).max(32),
  x: coordinate,
  y: coordinate,
  hp: z.number().finite().min(0),
  state: z.string().min(1).max(32)
});
const projectileSchema = z.strictObject({
  id: z.number().int().min(0).max(AI_NATIVE_LIMITS_V1.MAX_TICK),
  side: z.enum(['player', 'enemy']),
  kind: z.string().min(1).max(32),
  x: coordinate,
  y: coordinate,
  vx: z.number().finite(),
  vy: z.number().finite(),
  damage: z.number().finite().min(0),
  lifetime: z.number().finite().min(0)
});
const playerSchema = z.strictObject({
  x: coordinate,
  y: coordinate,
  hp: z.number().finite().min(0),
  maxHp: z.number().finite().positive(),
  aimYaw: z.number().finite(),
  weaponKey: z.string().min(1).max(32),
  ammo: z.number().int().min(-1),
  magazine: z.number().int().min(-1)
});

export const worldObservationSchema = z.strictObject({
  schema: z.literal(WORLD_SCHEMA_V1),
  protocolVersion: z.literal(WORLD_PROTOCOL_VERSION),
  epoch: z.number().int().min(0).max(AI_NATIVE_LIMITS_V1.MAX_TICK),
  tick: z.number().int().min(0).max(AI_NATIVE_LIMITS_V1.MAX_TICK),
  roomId: z.number().int().min(0).max(AI_NATIVE_LIMITS_V1.MAX_TICK).nullable(),
  player: playerSchema,
  drones: z.array(droneSchema).max(WORLD_LIMITS.MAX_OBSERVATION_DRONES),
  projectiles: z.array(projectileSchema).max(WORLD_LIMITS.MAX_OBSERVATION_PROJECTILES),
  availableActions: z.array(z.enum(['move', 'stop', 'aim', 'fire', 'interact'])).max(5)
});
export type WorldObservationV1 = z.infer<typeof worldObservationSchema>;

export interface WorldValidationError {
  readonly ok: false;
  readonly code: ErrorCodeV1;
  readonly messageKey: string;
  readonly path: string;
}
export type WorldParseResult<T> = { readonly ok: true; readonly value: T } | WorldValidationError;

function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(canonicalJson(value)).length;
}

function fromZod<T>(result: z.ZodSafeParseResult<T>, pathPrefix = '$'): WorldParseResult<T> {
  if (result.success) return { ok: true, value: result.data };
  const first = result.error.issues[0];
  const path = first?.path?.length ? `${pathPrefix}.${first.path.join('.')}` : pathPrefix;
  return { ok: false, code: 'E_SCHEMA', messageKey: 'world.schema_invalid', path };
}

export function parseWorldAction(value: unknown): WorldParseResult<WorldActionV1> {
  return fromZod(worldActionSchema.safeParse(value));
}

export function parseWorldActionBatch(value: unknown): WorldParseResult<WorldActionBatchV1> {
  const parsed = fromZod(worldActionBatchSchema.safeParse(value));
  if (!parsed.ok) return parsed;
  if (payloadBytes(parsed.value) > WORLD_LIMITS.MAX_PAYLOAD_BYTES) {
    return { ok: false, code: 'E_PAYLOAD_TOO_LARGE', messageKey: 'world.payload_too_large', path: '$' };
  }
  return parsed;
}

export function parseWorldObservation(value: unknown): WorldParseResult<WorldObservationV1> {
  const parsed = fromZod(worldObservationSchema.safeParse(value));
  if (!parsed.ok) return parsed;
  if (payloadBytes(parsed.value) > WORLD_LIMITS.MAX_PAYLOAD_BYTES) {
    return { ok: false, code: 'E_PAYLOAD_TOO_LARGE', messageKey: 'world.payload_too_large', path: '$' };
  }
  return parsed;
}

/** Canonical payload hash used by gateway idempotency. */
export function worldActionFingerprint(value: WorldActionV1): string {
  return payloadFingerprint(canonicalJson(value));
}

export function worldBatchFingerprint(value: WorldActionBatchV1): string {
  return payloadFingerprint(canonicalJson(value));
}

export const worldProtocolPatterns = Object.freeze({ sessionId, requestId, actionId });
