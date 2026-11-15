// AI-NATIVE-02 C3-c — official headless WORLD MCP tools.
//
// This module owns a REAL `HeadlessWorld` (same `src/world/sim/core.ts` +
// real `MapGenerator` + real config). It registers the official MCP tools:
//   Player surface:  world_list_sessions / world_observe / world_action /
//                    world_headless_create_session / world_headless_step /
//                    world_close
//   Dev-only surface: inspect / snapshot / restore / replay / load real room /
//                    spawn real enemies / export failure / batch / compare /
//                    perf / signal status (explicit UNSUPPORTED).
//
// Reused unchanged from C3-a: `WorldGateway` (epoch / idempotency / request
// cache / action cache / TTL / close budget) and `WorldObservationV1`
// perception cropping. No Phaser, no DOM, no second game rule set.
//
// Player tools NEVER accept a seed, a fixture or any HP/position write. Dev
// tools are registered only in `--world-headless --dev`.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorldGateway, type WorldNextAction } from './worldGateway';
import { WORLD_LIMITS, parseWorldActionBatch } from './worldProtocol';
import { canonicalJson, payloadFingerprint } from './protocol';
import {
  HEADLESS_MAX_SESSIONS, HEADLESS_MAX_TICKS_PER_STEP,
  HeadlessWorld, isHeadlessFrame, intentFromWorldAction, neutralIntent,
  type HeadlessRunStep
} from './worldHeadless';
import {
  combatPerf, combatRegression, compareBaselinePolicies, signalCombatStatus,
  type BaselinePolicyId
} from './worldHeadlessHarness';
import type { EnemyKind } from '../types';

const RESULT_SCHEMA = 'last_signal.mcp.tool-result.v1';
const HEADLESS_MAX_BATCH_SEEDS = 8;
const HEADLESS_STEP_CACHE = 128;

function payload(data: Record<string, unknown>, isError = false): CallToolResult {
  const body = { schema: RESULT_SCHEMA, ...data };
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: body,
    ...(isError ? { isError: true } : {})
  };
}
function okPayload(data: Record<string, unknown>): CallToolResult {
  return payload({ ok: true, ...data });
}
function errPayload(code: string, messageKey: string, extra: Record<string, unknown> = {}): CallToolResult {
  return payload({ ok: false, code, messageKey, ...extra }, true);
}

type SessionLookup = { ok: true; record: HeadlessSession } | { ok: false; code: string; messageKey: string };

interface HeadlessSession {
  readonly session: string;
  readonly world: HeadlessWorld;
  epoch: number;
  readonly stepCache: Map<string, { fingerprint: string; result: Record<string, unknown> }>;
  readonly stepOrder: string[];
}

/** Owner-only manager. Player tools go through `player*` methods only. */
export class HeadlessWorldManager {
  private readonly gateway = new WorldGateway({ maxSessions: HEADLESS_MAX_SESSIONS });
  private readonly sessions = new Map<string, HeadlessSession>();
  private seedCounter = 0;

  constructor(private readonly dev: boolean, private readonly seedProvider: () => number) {}

  private touch(session: string): SessionLookup {
    const record = this.sessions.get(session);
    if (!record) return { ok: false, code: 'E_SESSION_NOT_FOUND', messageKey: 'world.session_unknown' };
    const view = this.gateway.listSessions().find((s) => s.session === session);
    if (!view || view.status !== 'connected') {
      this.sessions.delete(session);
      return { ok: false, code: 'E_SESSION_NOT_FOUND', messageKey: 'world.session_closed' };
    }
    record.epoch = view.epoch;
    return { ok: true, record };
  }

  /** Player: server-generated seed only. Dev: explicit seed allowed. */
  createSession(requestedSeed?: number): CallToolResult {
    if (requestedSeed !== undefined && !this.dev) {
      return errPayload('E_PERMISSION', 'world.headless_seed_is_dev_only');
    }
    if (this.sessions.size >= HEADLESS_MAX_SESSIONS) {
      return errPayload('E_RESOURCE_LIMIT', 'world.session_limit');
    }
    const linked = this.gateway.linkSession({ authorized: true, origin: 'headless', nowMs: Date.now() });
    if (!linked.ok) return errPayload(linked.code, linked.messageKey);
    let seed: number;
    if (requestedSeed !== undefined) seed = requestedSeed >>> 0;
    else {
      this.seedCounter += 1;
      seed = this.seedProvider();
    }
    const world = new HeadlessWorld({ seed });
    const pushed = this.gateway.pushObservation(linked.session, linked.epoch, world.observation(linked.epoch), Date.now());
    if (!pushed.ok) {
      this.gateway.closeSession(linked.session, Date.now());
      return errPayload(pushed.code, pushed.messageKey);
    }
    const record: HeadlessSession = {
      session: linked.session, world, epoch: linked.epoch,
      stepCache: new Map(), stepOrder: []
    };
    this.sessions.set(linked.session, record);
    return okPayload({
      ...(this.dev ? { seed } : {}),
      session: linked.session, epoch: linked.epoch,
      tick: world.tick, status: world.runStatus,
      observation: world.observation(linked.epoch)
    });
  }

  listSessions(): CallToolResult {
    const rows = [...this.sessions.values()].map((r) => ({
      session: r.session, epoch: r.epoch, tick: r.world.tick,
      status: this.gateway.listSessions().find((s) => s.session === r.session)?.status ?? 'closed',
      combat: r.world.runStatus
    }));
    return okPayload({ sessions: rows });
  }

  observe(session: string): CallToolResult {
    const found = this.touch(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    return okPayload({
      session: record.session, epoch: record.epoch, tick: record.world.tick,
      status: record.world.runStatus, observation: record.world.observation(record.epoch)
    });
  }

  /** Queue-only, EXACTLY the rendered action semantics (same schema/receipt). */
  action(session: string, epoch: number, requestId: string, actions: unknown, ttlTicks?: number): CallToolResult {
    const found = this.touch(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    if (epoch !== record.epoch) return errPayload('E_STALE_EPOCH', 'world.stale_epoch');
    const parsed = parseWorldActionBatch({ actions, ...(ttlTicks === undefined ? {} : { ttlTicks }) });
    if (!parsed.ok) return errPayload(parsed.code, parsed.messageKey, { path: parsed.path });
    const result = this.gateway.submitActions({
      sessionId: session, epoch, requestId,
      actions: { actions, ...(ttlTicks === undefined ? {} : { ttlTicks }) },
      nowMs: Date.now()
    });
    if ('ok' in result && result.ok === false) return errPayload(result.code, result.messageKey);
    return okPayload({ session, epoch, ...result });
  }

  /**
   * LEGAL CORE TICKS. Drains queued actions in FIFO order (each consumes its
   * `durationTicks`), then fills the remaining ticks with the supplied intent
   * (or a neutral intent). The core tick is the ONLY state writer.
   */
  step(session: string, epoch: number, requestId: string, ticks: number, intent?: unknown): CallToolResult {
    const found = this.touch(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    if (epoch !== record.epoch) return errPayload('E_STALE_EPOCH', 'world.stale_epoch');
    const boundedTicks = Math.max(1, Math.min(HEADLESS_MAX_TICKS_PER_STEP, Math.floor(ticks)));
    const fingerprint = payloadFingerprint(canonicalJson({ epoch, ticks: boundedTicks, intent: intent ?? null }));
    const cached = record.stepCache.get(requestId);
    if (cached) {
      if (cached.fingerprint !== fingerprint) return errPayload('E_ID_PAYLOAD_MISMATCH', 'world.request_payload_mismatch');
      return okPayload({ ...cached.result, replayed: true });
    }
    if (!this.dev && record.world.runStatus !== 'running') {
      return errPayload('E_NOT_APPLICABLE', 'world.headless_combat_ended');
    }
    let parsedIntent: TypedIntent | null = null;
    if (intent !== undefined) {
      parsedIntent = parsePlayerIntent(intent);
      if (!parsedIntent) return errPayload('E_SCHEMA', 'world.headless_intent_invalid');
    }

    const fromTick = record.world.tick;
    const schedule: Array<{ ticks: number; intent: TypedIntent }> = [];
    const applied: Array<{ actionId: string; requestId: string; startedTick: number; appliedTick: number; executedTicks: number }> = [];
    const rejected: Array<{ actionId: string; requestId: string; code: string }> = [];
    let used = 0;
    let cursor: string | undefined;
    while (used < boundedTicks) {
      const raw = this.gateway.nextAction({ sessionId: session, epoch, afterActionId: cursor, nowMs: Date.now() });
      if (!raw || ('ok' in raw && raw.ok === false)) break;
      const next = raw as WorldNextAction;
      const action = next.action;
      const converted = intentFromWorldAction(action);
      const span = Math.min(converted.ticks, boundedTicks - used);
      if (span <= 0) break;
      const wouldEnd = record.world.tick + used + span;
      if (wouldEnd > next.applyByTick) {
        // Explicit execution deadline: this action cannot finish inside its TTL.
        this.gateway.ackAction({
          sessionId: session, epoch, requestId: next.requestId, actionId: next.actionId,
          result: 'rejected', code: 'E_ACTION_EXPIRED', nowMs: Date.now()
        });
        rejected.push({ actionId: next.actionId, requestId: next.requestId, code: 'E_ACTION_EXPIRED' });
        cursor = next.actionId;
        continue;
      }
      schedule.push({ ticks: span, intent: converted.intent });
      applied.push({
        actionId: next.actionId, requestId: next.requestId,
        startedTick: record.world.tick + used, appliedTick: record.world.tick + used + span,
        executedTicks: span
      });
      used += span;
      cursor = next.actionId;
    }
    const fill = boundedTicks - used;
    if (fill > 0) schedule.push({ ticks: fill, intent: parsedIntent ?? neutralIntent() });

    record.world.runSteps(schedule, boundedTicks);
    const toTick = record.world.tick;
    for (const a of applied) {
      this.gateway.ackAction({
        sessionId: session, epoch, requestId: a.requestId, actionId: a.actionId,
        result: 'applied', appliedTick: a.appliedTick, nowMs: Date.now()
      });
    }
    record.world.refreshStatus();
    this.gateway.pushObservation(session, epoch, record.world.observation(epoch), Date.now());
    const result: Record<string, unknown> = {
      session, epoch, requestId,
      fromTick, toTick, ticks: toTick - fromTick, blockTicks: boundedTicks,
      status: record.world.runStatus,
      applied, rejected,
      observation: record.world.observation(epoch),
      canonicalState: record.world.canonicalState(),
      canonicalEvents: record.world.canonicalEvents(),
      eventCount: record.world.eventTotal
    };
    record.stepCache.set(requestId, { fingerprint, result });
    record.stepOrder.push(requestId);
    while (record.stepOrder.length > HEADLESS_STEP_CACHE) {
      const oldest = record.stepOrder.shift();
      if (oldest !== undefined) record.stepCache.delete(oldest);
    }
    return okPayload({ ...result, replayed: false });
  }

  close(session: string): CallToolResult {
    const record = this.sessions.get(session);
    this.gateway.closeSession(session, Date.now());
    this.sessions.delete(session);
    if (!record) return errPayload('E_SESSION_NOT_FOUND', 'world.session_unknown');
    return okPayload({ session, closed: true, tick: record.world.tick });
  }

  // ----- Dev/OWNER-only surface -------------------------------------------

  private devRecord(session: string): SessionLookup {
    if (!this.dev) return { ok: false, code: 'E_PERMISSION', messageKey: 'world.headless_dev_only' };
    return this.touch(session);
  }

  inspect(session: string): CallToolResult {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    return okPayload({ session, epoch: record.epoch, inspect: record.world.inspect() });
  }

  snapshot(session: string): CallToolResult {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    const frame = record.world.snapshot();
    return okPayload({ session, epoch: record.epoch, frameBytes: canonicalJson(frame).length, frame });
  }

  restore(session: string, frame: unknown): CallToolResult {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    if (!isHeadlessFrame(frame)) return errPayload('E_SNAPSHOT_INVALID', 'world.headless_frame_invalid');
    const restored = record.world.restore(frame);
    if (!restored.ok) return errPayload(restored.code, restored.messageKey);
    const rebind = this.gateway.rebindSession(session, Date.now());
    if (!rebind.ok) return errPayload(rebind.code, rebind.messageKey);
    record.epoch = rebind.epoch;
    this.gateway.pushObservation(session, record.epoch, record.world.observation(record.epoch), Date.now());
    record.stepCache.clear();
    record.stepOrder.length = 0;
    return okPayload({ session, epoch: record.epoch, status: record.world.runStatus, observation: record.world.observation(record.epoch) });
  }

  replay(session: string, frame: unknown, steps: unknown): CallToolResult {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    const parsedSteps = parseSteps(steps);
    if (!parsedSteps) return errPayload('E_SCHEMA', 'world.headless_steps_invalid');
    const result = record.world.replay(frame, parsedSteps);
    return okPayload({ session, ...result });
  }

  loadRoom(session: string, roomId: number, kinds: readonly EnemyKind[]): CallToolResult {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    const loaded = record.world.loadRoom(roomId, kinds);
    if (!loaded.ok) return errPayload(loaded.code, loaded.messageKey);
    const rebind = this.gateway.rebindSession(session, Date.now());
    if (!rebind.ok) return errPayload(rebind.code, rebind.messageKey);
    record.epoch = rebind.epoch;
    this.gateway.pushObservation(session, record.epoch, record.world.observation(record.epoch), Date.now());
    return okPayload({ session, epoch: record.epoch, roomId, spawned: loaded.spawned, observation: record.world.observation(record.epoch) });
  }

  spawnEnemies(session: string, kinds: readonly EnemyKind[]): CallToolResult {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    const spawned = record.world.spawnEnemies(kinds);
    if (!spawned.ok) return errPayload(spawned.code, spawned.messageKey);
    const rebind = this.gateway.rebindSession(session, Date.now());
    if (!rebind.ok) return errPayload(rebind.code, rebind.messageKey);
    record.epoch = rebind.epoch;
    this.gateway.pushObservation(session, record.epoch, record.world.observation(record.epoch), Date.now());
    return okPayload({ session, epoch: record.epoch, spawned: spawned.spawned });
  }

  async exportFailure(session: string, reason: string): Promise<CallToolResult> {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    const bundle = record.world.exportFailure(reason);
    const dir = resolve('reports/ai-native-02/c3c/failures');
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, `${session}-${Date.now()}.failure.json`);
    await writeFile(file, canonicalJson(bundle), 'utf8');
    return okPayload({ session, path: file, bytes: canonicalJson(bundle).length });
  }

  batch(seeds: readonly number[], maxTicks: number, policy: BaselinePolicyId): CallToolResult {
    if (!this.dev) return errPayload('E_PERMISSION', 'world.headless_dev_only');
    if (seeds.length === 0 || seeds.length > HEADLESS_MAX_BATCH_SEEDS) {
      return errPayload('E_RESOURCE_LIMIT', 'world.headless_batch_limit');
    }
    return okPayload({ result: combatRegression(seeds, maxTicks, policy) });
  }

  compare(seeds: readonly number[], maxTicks: number): CallToolResult {
    if (!this.dev) return errPayload('E_PERMISSION', 'world.headless_dev_only');
    if (seeds.length === 0 || seeds.length > HEADLESS_MAX_BATCH_SEEDS) {
      return errPayload('E_RESOURCE_LIMIT', 'world.headless_batch_limit');
    }
    return okPayload({ result: compareBaselinePolicies(seeds, maxTicks) });
  }

  perf(ticks: number, sessions: number): CallToolResult {
    if (!this.dev) return errPayload('E_PERMISSION', 'world.headless_dev_only');
    if (![1000, 10000].includes(ticks)) return errPayload('E_SCHEMA', 'world.headless_perf_ticks');
    if (sessions < 1 || sessions > 10) return errPayload('E_RESOURCE_LIMIT', 'world.headless_perf_sessions');
    return okPayload({ result: combatPerf(ticks, sessions) });
  }

  signalStatus(): CallToolResult {
    const status = signalCombatStatus();
    return errPayload(status.code, status.messageKey);
  }
}

type TypedIntent = { move: { x: number; y: number }; dash: boolean; fire: boolean; aim: { x: number; y: number } | null; interact: boolean };

/** Player intent validation: only legal movement/aim/fire/interact fields. */
export function parsePlayerIntent(value: unknown): TypedIntent | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const move = v.move as { x?: unknown; y?: unknown } | undefined;
  const aim = v.aim as { x?: unknown; y?: unknown } | null | undefined;
  const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1000;
  if (!move || !num(move.x) || !num(move.y)) return null;
  if (aim !== null && aim !== undefined && (!num(aim.x) || !num(aim.y))) return null;
  if (typeof v.dash !== 'boolean' || typeof v.fire !== 'boolean' || typeof v.interact !== 'boolean') return null;
  return {
    move: { x: move.x, y: move.y }, dash: v.dash, fire: v.fire,
    aim: aim === null || aim === undefined ? null : { x: aim.x as number, y: aim.y as number },
    interact: v.interact
  };
}

function parseSteps(value: unknown): HeadlessRunStep[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > WORLD_LIMITS.MAX_ACTIONS_PER_BATCH) return null;
  const steps: HeadlessRunStep[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const v = raw as Record<string, unknown>;
    if (typeof v.ticks !== 'number' || !Number.isFinite(v.ticks) || v.ticks < 1) return null;
    const intent = parsePlayerIntent(v.intent);
    if (!intent) return null;
    steps.push({ ticks: Math.floor(v.ticks), intent });
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------
type RegisterFn = (
  server: McpServer,
  name: string,
  description: string,
  schema: z.ZodTypeAny,
  handler: (args: Record<string, unknown>) => Promise<CallToolResult> | CallToolResult
) => void;

const worldCoord = z.number().finite().min(-1000).max(1000);
const worldActionId = z.string().regex(/^aid_[0-9a-f]{24}$/);
const worldRequestId = z.string().regex(/^req_[0-9a-f]{24}$/);
const sessionId = z.string().regex(/^ses_[0-9a-f]{24}$/);
const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), actionId: worldActionId, dir: z.strictObject({ x: worldCoord, y: worldCoord }), ticks: z.number().int().min(1).max(WORLD_LIMITS.MAX_ACTION_TICKS) }),
  z.strictObject({ type: z.literal('stop'), actionId: worldActionId }),
  z.strictObject({ type: z.literal('aim'), actionId: worldActionId, target: z.strictObject({ x: worldCoord, y: worldCoord }) }),
  z.strictObject({ type: z.literal('fire'), actionId: worldActionId, target: z.strictObject({ x: worldCoord, y: worldCoord }).optional(), ticks: z.number().int().min(1).max(WORLD_LIMITS.MAX_ACTION_TICKS) }),
  z.strictObject({ type: z.literal('interact'), actionId: worldActionId })
]);
const intentSchema = z.strictObject({
  move: z.strictObject({ x: worldCoord, y: worldCoord }),
  dash: z.boolean(), fire: z.boolean(),
  aim: z.strictObject({ x: worldCoord, y: worldCoord }).nullable(),
  interact: z.boolean()
});
const enemyKind = z.enum(['drone', 'stalker', 'sentinel', 'hunter', 'boss_warden']);
const policy = z.enum(['hold', 'seek-and-fire']);

export function registerHeadlessWorldTools(server: McpServer, manager: HeadlessWorldManager, register: RegisterFn, dev: boolean): void {
  register(server, 'world_headless_create_session',
    dev
      ? 'DEV: create a headless same-core session with an explicit seed.'
      : 'Create a headless same-core session (server-generated seed only).',
    dev ? z.strictObject({ seed: z.number().int().min(0).max(0xffffffff).optional() }) : z.strictObject({}),
    (args) => manager.createSession(dev ? (args.seed as number | undefined) : undefined));

  register(server, 'world_list_sessions', 'List headless sessions and their real tick/status.',
    z.strictObject({}), () => manager.listSessions());

  register(server, 'world_observe', 'Post-commit, perception-cropped headless observation.',
    z.strictObject({ session: sessionId, epoch: z.number().int().min(0).optional() }),
    (args) => manager.observe(args.session as string));

  register(server, 'world_action', 'Queue legal intents (exactly the rendered action schema). Queue-only.',
    z.strictObject({ session: sessionId, epoch: z.number().int().min(0), requestId: worldRequestId, actions: z.array(actionSchema).min(1).max(WORLD_LIMITS.MAX_ACTIONS_PER_BATCH), ttlTicks: z.number().int().min(1).max(WORLD_LIMITS.MAX_TTL_TICKS).optional() }),
    (args) => manager.action(args.session as string, args.epoch as number, args.requestId as string, args.actions, args.ttlTicks as number | undefined));

  register(server, 'world_headless_step', 'Run real core ticks (Owner-controlled tick boundary). Drains queued actions then fills with intent.',
    z.strictObject({ session: sessionId, epoch: z.number().int().min(0), requestId: worldRequestId, ticks: z.number().int().min(1).max(HEADLESS_MAX_TICKS_PER_STEP), intent: intentSchema.optional() }),
    (args) => manager.step(args.session as string, args.epoch as number, args.requestId as string, args.ticks as number, args.intent));

  register(server, 'world_close', 'Close a headless session; releases the real core state.',
    z.strictObject({ session: sessionId }), (args) => manager.close(args.session as string));

  register(server, 'world_signal_status', 'Signal Combat in the main World is NOT implemented.', z.strictObject({}), () => manager.signalStatus());

  if (!dev) return;

  register(server, 'world_headless_dev_inspect', 'DEV: bounded debug projection (seed/rng/pending/ledger/map hash).',
    z.strictObject({ session: sessionId }), (args) => manager.inspect(args.session as string));

  register(server, 'world_headless_dev_snapshot', 'DEV: full owner frame (state/commands/RNG/ledger/map identity/events).',
    z.strictObject({ session: sessionId }), (args) => manager.snapshot(args.session as string));

  register(server, 'world_headless_dev_restore', 'DEV: restore a real owner frame and atomically bump the epoch.',
    z.strictObject({ session: sessionId, frame: z.unknown() }), (args) => manager.restore(args.session as string, args.frame));

  register(server, 'world_headless_dev_replay', 'DEV: deterministic replay from a start frame; returns REAL divergence info.',
    z.strictObject({ session: sessionId, frame: z.unknown(), steps: z.array(z.strictObject({ ticks: z.number().int().min(1), intent: intentSchema })).min(1).max(WORLD_LIMITS.MAX_ACTIONS_PER_BATCH) }),
    (args) => manager.replay(args.session as string, args.frame, args.steps));

  register(server, 'world_headless_dev_load_room', 'DEV: load a REAL generated room and spawn REAL enemies.',
    z.strictObject({ session: sessionId, roomId: z.number().int().min(0).max(4096), kinds: z.array(enemyKind).min(1).max(WORLD_LIMITS.MAX_ACTIONS_PER_BATCH) }),
    (args) => manager.loadRoom(args.session as string, args.roomId as number, args.kinds as EnemyKind[]));

  register(server, 'world_headless_dev_spawn_enemies', 'DEV: spawn REAL enemies near the player (sustain a real wave).',
    z.strictObject({ session: sessionId, kinds: z.array(enemyKind).min(1).max(WORLD_LIMITS.MAX_ACTIONS_PER_BATCH) }),
    (args) => manager.spawnEnemies(args.session as string, args.kinds as EnemyKind[]));

  register(server, 'world_headless_dev_export_failure', 'DEV: export a failure reproduction bundle to reports/ai-native-02/c3c/failures/.',
    z.strictObject({ session: sessionId, reason: z.string().min(1).max(120) }),
    (args) => manager.exportFailure(args.session as string, args.reason as string));

  register(server, 'world_headless_dev_batch', 'DEV: fixed-seed combat regression (deterministic baseline policy).',
    z.strictObject({ seeds: z.array(z.number().int().min(0).max(0xffffffff)).min(1).max(HEADLESS_MAX_BATCH_SEEDS), maxTicks: z.number().int().min(1).max(HEADLESS_MAX_TICKS_PER_STEP), policy: policy.optional() }),
    (args) => manager.batch(args.seeds as number[], args.maxTicks as number, (args.policy as BaselinePolicyId | undefined) ?? 'seek-and-fire'));

  register(server, 'world_headless_dev_compare', 'DEV: deterministic BASELINE policy comparison (NOT an AI agent, NOT Signal Combat).',
    z.strictObject({ seeds: z.array(z.number().int().min(0).max(0xffffffff)).min(1).max(HEADLESS_MAX_BATCH_SEEDS), maxTicks: z.number().int().min(1).max(HEADLESS_MAX_TICKS_PER_STEP) }),
    (args) => manager.compare(args.seeds as number[], args.maxTicks as number));

  register(server, 'world_headless_dev_perf', 'DEV: real combat perf: 1000/10000 ticks x 1..10 sessions (CPU/heap/wall/events).',
    z.strictObject({ ticks: z.number().int().min(1).max(10000), sessions: z.number().int().min(1).max(10) }),
    (args) => manager.perf(args.ticks as number, args.sessions as number));
}

/** Standalone entry for `node dist-mcp/worldHeadlessMcpServer.mjs [--dev]`. */
export async function startWorldHeadlessMcpServer(dev: boolean): Promise<void> {
  const manager = new HeadlessWorldManager(dev, () => randomBytes(4).readUInt32BE(0) >>> 0);
  const server = new McpServer({ name: dev ? 'last-signal-world-headless-dev' : 'last-signal-world-headless', version: '0.4.0' });
  const register: RegisterFn = (srv, name, description, schema, handler) =>
    srv.registerTool(name, { description, inputSchema: schema as never }, (async (args: unknown) => {
      try { return await handler((args ?? {}) as Record<string, unknown>); }
      catch { return errPayload('E_NOT_APPLICABLE', 'world.tool_failed'); }
    }) as never);
  registerHeadlessWorldTools(server, manager, register, dev);
  const transport = new StdioServerTransport();
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    try { await server.close(); } catch { /* ignore */ }
  };
  transport.onclose = () => { void cleanup(); };
  process.on('SIGINT', () => { void cleanup().finally(() => process.exit(0)); });
  process.on('SIGTERM', () => { void cleanup().finally(() => process.exit(0)); });
  process.stdin.on('end', () => { void cleanup().finally(() => process.exit(0)); });
  process.stdin.on('close', () => { void cleanup().finally(() => process.exit(0)); });
  await server.connect(transport);
}
