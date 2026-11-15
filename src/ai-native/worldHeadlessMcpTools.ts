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
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorldGateway, type WorldNextAction } from './worldGateway';
import { WORLD_LIMITS, parseWorldActionBatch } from './worldProtocol';
import { canonicalJson, payloadFingerprint } from './protocol';
import { consumeExecutionTicks } from './actionExecution';
import { HeadlessRequestLedger } from './headlessRequestLedger';
import { publicEvents } from './headlessPublicEvents';
import { hardenOwnerDirectory, hardenOwnerFile } from './secureTokenFile';
import {
  HEADLESS_MAX_FRAME_BYTES, HEADLESS_MAX_SESSIONS, HEADLESS_MAX_TICKS_PER_STEP,
  HeadlessWorld, isHeadlessFrame, isHistoryTruncated, intentFromWorldAction, neutralIntent,
  type HeadlessRunStep
} from './worldHeadless';
import {
  combatPerf, combatRegression, compareBaselinePolicies, signalCombatStatus, signalCombatBatch,
  type BaselinePolicyId
} from './worldHeadlessHarness';
import type { EnemyKind } from '../types';

const RESULT_SCHEMA = 'last_signal.mcp.tool-result.v1';
/**
 * TRANSPORT BUDGET: no single MCP response may approach the ~4 MB SDK/stdio
 * limit. Full canonical state/events are NEVER returned inline; they are
 * hashed, windowed, paged or written to an owner-only local artifact.
 */
const MAX_RESPONSE_BYTES = 512 * 1024;
const EVENTS_PAGE_DEFAULT = 128;
const EVENTS_PAGE_MAX = 512;
const EVENTS_PAGE_BYTE_BUDGET = 384 * 1024;
const STEP_EVENT_TAIL = 64;
const MAX_FRAME_INGRESS_BYTES = 512 * 1024;
const FRAME_REF_MAX = 2;
const FRAME_REF_MAX_BYTES = 16 * 1024 * 1024;
const FRAME_DIR = 'reports/ai-native-02/c3c/frames';

/**
 * The frames ROOT itself must be a plain directory, not a junction/symlink.
 * Task0 checked links INSIDE the root; an escape through the root itself must
 * obey exactly the same rule.
 */
export async function isSafeFramesRoot(root: string): Promise<boolean> {
  try {
    const info = await lstat(root);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}
const HEADLESS_MAX_BATCH_SEEDS = 8;

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

function rawAction(value: WorldNextAction | null | { ok: false }): WorldNextAction | null {
  if (!value) return null;
  if ('ok' in value && value.ok === false) return null;
  return value as WorldNextAction;
}

type SessionLookup = { ok: true; record: HeadlessSession } | { ok: false; code: string; messageKey: string };

/**
 * PLAYER OUTPUT ALLOWLIST.
 *
 * These builders are the ONLY way a Player tool result is produced. They
 * construct an explicit public schema (observation whitelist, receipt, counters)
 * instead of deleting "hidden" fields, so a new core field can never leak by
 * default. Dev/OWNER detail is added only by the Dev surface.
 */
type Json = Record<string, unknown>;

export function publicObservation(observation: any): Json {
  const player = observation?.player ?? {};
  return {
    schema: observation?.schema,
    protocolVersion: observation?.protocolVersion,
    epoch: observation?.epoch,
    tick: observation?.tick,
    roomId: observation?.roomId,
    player: {
      x: player.x, y: player.y, hp: player.hp, maxHp: player.maxHp,
      aimYaw: player.aimYaw, weaponKey: player.weaponKey,
      ammo: player.ammo, magazine: player.magazine
    },
    drones: Array.isArray(observation?.drones)
      ? observation.drones.map((d: any) => ({ id: d.id, kind: d.kind, x: d.x, y: d.y, hp: d.hp, state: d.state }))
      : [],
    projectiles: Array.isArray(observation?.projectiles)
      ? observation.projectiles.map((p: any) => ({
          id: p.id, side: p.side, kind: p.kind, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
          damage: p.damage, lifetime: p.lifetime
        }))
      : [],
    availableActions: Array.isArray(observation?.availableActions) ? [...observation.availableActions] : []
  };
}

/** Public receipt for one applied action (no seed / map / RNG / hidden targets). */
function publicApplied(applied: ReadonlyArray<{ actionId: string; requestId: string; startedTick: number; appliedTick: number; executedTicks: number }>): Json[] {
  return applied.map((a) => ({
    actionId: a.actionId, requestId: a.requestId,
    startedTick: a.startedTick, appliedTick: a.appliedTick, executedTicks: a.executedTicks
  }));
}
function publicRejected(rejected: ReadonlyArray<{ actionId: string; requestId: string; code: string }>): Json[] {
  return rejected.map((r) => ({ actionId: r.actionId, requestId: r.requestId, code: r.code }));
}
/**
 * Bytes actually put on the wire for one MCP tool result: the JSON envelope
 * plus the text content and structuredContent (both carry the same body).
 * UTF-8 encoded, so non-ASCII is counted at its real size.
 */
export function measureMcpResult(result: CallToolResult): number {
  return Buffer.byteLength(JSON.stringify(result), 'utf8');
}

function publicActionReceipt(a: { actionId: string; status: string; applyByTick: number; code?: string }): Json {
  return {
    actionId: a.actionId, status: a.status, applyByTick: a.applyByTick,
    ...(a.code ? { code: a.code } : {})
  };
}

interface ActiveExecution {
  readonly actionId: string;
  readonly requestId: string;
  readonly intent: TypedIntent;
  readonly actionType: string;
  readonly durationTicks: number;
  remainingTicks: number;
  readonly startedTick: number;
  readonly applyByTick: number;
  readonly epoch: number;
}

interface HeadlessSession {
  readonly session: string;
  readonly world: HeadlessWorld;
  epoch: number;
  /** Cross-step persistent action execution (duration consumed by real ticks). */
  active: ActiveExecution | null;
  /** Shared requestId namespace + bounded dedup (step AND action). */
  readonly ledger: HeadlessRequestLedger;
}

/** Owner-only manager. Player tools go through `player*` methods only. */
export class HeadlessWorldManager {
  private readonly gateway = new WorldGateway({ maxSessions: HEADLESS_MAX_SESSIONS });
  private readonly sessions = new Map<string, HeadlessSession>();
  /** Bounded owner-only frame refs (LRU by insertion order, capped by bytes). */
  private readonly frameRefs = new Map<string, { frame: unknown; bytes: number; session: string }>();
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
      active: null, ledger: new HeadlessRequestLedger()
    };
    this.sessions.set(linked.session, record);
    return okPayload({
      // Dev only: the explicit seed. Player create NEVER returns a seed.
      ...(this.dev ? { seed } : {}),
      session: linked.session, epoch: linked.epoch,
      tick: world.tick, status: world.runStatus,
      observation: publicObservation(world.observation(linked.epoch))
    });
  }

  listSessions(): CallToolResult {
    // A session id is an opaque handle; no seed/map/RNG is ever listed.
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
      status: record.world.runStatus, observation: publicObservation(record.world.observation(record.epoch))
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
    // One requestId namespace shared with `step`: reusing an id across domains
    // (or a different action payload) can never bypass dedup.
    const fingerprint = payloadFingerprint(canonicalJson({ actions: parsed.value.actions, ttlTicks: parsed.value.ttlTicks ?? null }));
    const check = record.ledger.check(requestId, 'action', fingerprint);
    if (check.kind === 'error') return errPayload(check.code, check.messageKey);
    if (check.kind === 'new') {
      const reserved = record.ledger.reserve(requestId, 'action', fingerprint);
      if (!reserved.ok) return errPayload(reserved.code, reserved.messageKey);
    }
    const result = this.gateway.submitActions({
      sessionId: session, epoch, requestId,
      actions: { actions, ...(ttlTicks === undefined ? {} : { ttlTicks }) },
      nowMs: Date.now()
    });
    if ('ok' in result && result.ok === false) return errPayload(result.code, result.messageKey);
    const posted = result as {
      session: string; epoch: number; requestId: string;
      acceptedTick: number; applyByTick: number; replayed: boolean;
      actions: Array<{ actionId: string; status: string; applyByTick: number; code?: string }>;
    };
    // Explicit allowlist: the gateway receipt has no seed/map/RNG, and this
    // builder guarantees a future receipt field cannot leak by default.
    return okPayload({
      session: posted.session, epoch: posted.epoch, requestId: posted.requestId,
      acceptedTick: posted.acceptedTick, applyByTick: posted.applyByTick,
      replayed: posted.replayed,
      actions: posted.actions.map(publicActionReceipt)
    });
  }

  /**
   * LEGAL CORE TICKS. Drains queued actions in FIFO order (each consumes its
   * `durationTicks`), then fills the remaining ticks with the supplied intent
   * (or a neutral intent). The core tick is the ONLY state writer.
   */
  /**
   * LEGAL CORE TICKS with CROSS-STEP persistent execution.
   *
   * The active action's `remainingTicks` survives across step calls and is
   * consumed by REAL core ticks only (`consumeExecutionTicks` — the SAME rule
   * the rendered link uses). It is ACKed `applied` ONLY when the full duration
   * has been delivered; a short step reports `executing` and does NOT ACK.
   * `step10 + step110` therefore produces the same canonical state/events as
   * `step120`.
   */
  step(session: string, epoch: number, requestId: string, ticks: number, intent?: unknown): CallToolResult {
    const found = this.touch(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    if (epoch !== record.epoch) return errPayload('E_STALE_EPOCH', 'world.stale_epoch');
    const boundedTicks = Math.max(1, Math.min(HEADLESS_MAX_TICKS_PER_STEP, Math.floor(ticks)));
    // CHANNEL GUARD (Tester F2): the Player channel has NO direct intent. A
    // Player must queue a `world_action` and then step; only Dev may pass a
    // strict fixture/replay intent. This is checked BEFORE any quota/tick work,
    // so a rejected direct intent cannot advance, charge or alter the queue.
    if (!this.dev && intent !== undefined) {
      return errPayload('E_PERMISSION', 'world.headless_intent_player_forbidden');
    }
    let parsedIntent: TypedIntent | null = null;
    if (intent !== undefined) {
      parsedIntent = parsePlayerIntent(intent);
      if (!parsedIntent) return errPayload('E_SCHEMA', 'world.headless_intent_invalid');
    }
    const fingerprint = payloadFingerprint(canonicalJson({ epoch, ticks: boundedTicks, intent: parsedIntent }));
    const check = record.ledger.check(requestId, 'step', fingerprint);
    if (check.kind === 'error') return errPayload(check.code, check.messageKey);
    if (check.kind === 'same') {
      // A replayed step NEVER advances again. If the response cache was
      // evicted, the id is tombstoned and rejected instead of re-executing.
      if (check.response === undefined) return errPayload('E_RETRY_AFTER_EVICTION', 'world.request_evicted');
      return okPayload({ ...(check.response as Record<string, unknown>), replayed: true });
    }
    if (!this.dev && record.world.runStatus !== 'running') {
      return errPayload('E_NOT_APPLICABLE', 'world.headless_combat_ended');
    }
    const reserved = record.ledger.reserve(requestId, 'step', fingerprint);
    if (!reserved.ok) return errPayload(reserved.code, reserved.messageKey);

    const fromTick = record.world.tick;
    const eventsBefore = record.world.eventTotal;
    const schedule: Array<{ ticks: number; intent: TypedIntent }> = [];
    const applied: Array<{ actionId: string; requestId: string; startedTick: number; appliedTick: number; executedTicks: number }> = [];
    const rejected: Array<{ actionId: string; requestId: string; code: string; executedTicks?: number }> = [];
    let used = 0;
    let cursor: string | undefined;

    const ackApplied = (a: ActiveExecution, appliedTick: number): void => {
      this.gateway.ackAction({
        sessionId: session, epoch, requestId: a.requestId, actionId: a.actionId,
        result: 'applied', appliedTick, nowMs: Date.now()
      });
      applied.push({
        actionId: a.actionId, requestId: a.requestId,
        startedTick: a.startedTick, appliedTick, executedTicks: a.durationTicks
      });
    };
    const ackRejected = (a: ActiveExecution, code: string, executedTicks: number): void => {
      this.gateway.ackAction({
        sessionId: session, epoch, requestId: a.requestId, actionId: a.actionId,
        result: 'rejected', code: code as never, nowMs: Date.now()
      });
      rejected.push({ actionId: a.actionId, requestId: a.requestId, code, executedTicks });
    };

    while (used < boundedTicks) {
      // 1) Epoch guard: an in-flight action bound to an old epoch is cancelled.
      if (record.active && record.active.epoch !== epoch) {
        const stale = record.active;
        record.active = null;
        ackRejected(stale, 'E_STALE_EPOCH', stale.durationTicks - stale.remainingTicks);
        cursor = stale.actionId;
        continue;
      }
      // 2) STOP PREEMPTION: a queued `stop` immediately follows the ACTIVE
      //    action. Cancel it (recording executed ticks) and run the stop as a
      //    real 1-tick neutral commit. Other actions keep FIFO.
      if (record.active) {
        const peekRaw = this.gateway.nextAction({ sessionId: session, epoch, afterActionId: record.active.actionId, nowMs: Date.now() });
        const peek = rawAction(peekRaw);
        if (peek && peek.action.type === 'stop') {
          const preempted = record.active;
          record.active = null;
          ackRejected(preempted, 'E_PREEMPTED', preempted.durationTicks - preempted.remainingTicks);
          const converted = intentFromWorldAction(peek.action);
          record.active = {
            actionId: peek.actionId, requestId: peek.requestId,
            intent: converted.intent, actionType: peek.action.type,
            durationTicks: 1, remainingTicks: 1,
            startedTick: record.world.tick + used,
            applyByTick: peek.applyByTick, epoch
          };
          cursor = peek.actionId;
        }
      }
      // 3) Start the next queued action (FIFO) if none is active.
      if (!record.active) {
        const next = rawAction(this.gateway.nextAction({ sessionId: session, epoch, afterActionId: cursor, nowMs: Date.now() }));
        if (!next) break;
        const converted = intentFromWorldAction(next.action);
        const startTick = record.world.tick + used;
        if (startTick + 1 > next.applyByTick) {
          ackRejected({
            actionId: next.actionId, requestId: next.requestId, intent: converted.intent,
            actionType: next.action.type, durationTicks: converted.ticks, remainingTicks: converted.ticks,
            startedTick: startTick, applyByTick: next.applyByTick, epoch
          }, 'E_ACTION_EXPIRED', 0);
          cursor = next.actionId;
          continue;
        }
        record.active = {
          actionId: next.actionId, requestId: next.requestId,
          intent: converted.intent, actionType: next.action.type,
          durationTicks: converted.ticks, remainingTicks: converted.ticks,
          startedTick: startTick, applyByTick: next.applyByTick, epoch
        };
        cursor = next.actionId;
      }
      // 4) Consume real ticks from the active action (never over-deliver).
      const active = record.active;
      const take = Math.min(boundedTicks - used, active.remainingTicks);
      if (take <= 0) break;
      schedule.push({ ticks: take, intent: active.intent });
      const consumed = consumeExecutionTicks(active.remainingTicks, take);
      active.remainingTicks = consumed.remaining;
      used += take;
      if (consumed.completed) {
        const completedTick = record.world.tick + used;
        if (completedTick > active.applyByTick) {
          ackRejected(active, 'E_TIMEOUT', active.durationTicks);
        } else {
          ackApplied(active, completedTick);
        }
        record.active = null;
      }
    }
    const fill = boundedTicks - used;
    if (fill > 0) schedule.push({ ticks: fill, intent: parsedIntent ?? neutralIntent() });

    const stepEvents = record.world.runSteps(schedule, boundedTicks);
    record.world.refreshStatus();
    this.gateway.pushObservation(session, epoch, record.world.observation(epoch), Date.now());

    const executing = record.active
      ? {
          actionId: record.active.actionId, requestId: record.active.requestId,
          actionType: record.active.actionType,
          startedTick: record.active.startedTick,
          executedTicks: record.active.durationTicks - record.active.remainingTicks,
          remainingTicks: record.active.remainingTicks,
          durationTicks: record.active.durationTicks
        }
      : null;
    const observation = record.world.observation(epoch);
    const eventsRetained = record.world.eventsCount;
    const eventsTotal = record.world.eventTotal;
    const eventsTruncated = isHistoryTruncated(eventsTotal, eventsRetained);
    // DEV: bounded raw tail + a pagination cursor. PLAYER: the legal public
    // projection of THIS step, also bounded. Never the full event history.
    const eventTail = this.dev
      ? record.world.eventsSlice(Math.max(0, eventsRetained - STEP_EVENT_TAIL), STEP_EVENT_TAIL)
      : publicEvents(stepEvents, (x, y) => record.world.isPerceivablePosition(x, y)).slice(-STEP_EVENT_TAIL);
    // Transport-budgeted step result: hashes + bounded window + cursor, never
    // the multi-MB canonical state/events.
    const result: Record<string, unknown> = {
      session, epoch, requestId,
      fromTick, toTick: record.world.tick, ticks: record.world.tick - fromTick,
      blockTicks: boundedTicks,
      status: record.world.runStatus,
      executing,
      applied,
      rejected,
      observation: publicObservation(observation),
      eventCount: eventsTotal - eventsBefore,
      eventTotal: eventsTotal,
      eventsRetained,
      eventsTruncated,
      events: eventTail,
      nextCursor: eventsTotal,
      stateFingerprint: record.world.canonicalStateHash(),
      eventsFingerprint: record.world.canonicalEventsHash()
    };
    record.ledger.store(requestId, result);
    return this.respond({ ...result, replayed: false });
  }

  close(session: string): CallToolResult {
    const record = this.sessions.get(session);
    if (record) {
      record.active = null;
      record.ledger.clear();
    }
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

  /** Count unprocessed queued actions for this session/epoch (bounded probe). */
  private pendingActions(session: string, epoch: number): number {
    let cursor: string | undefined;
    let count = 0;
    while (count < 64) {
      const next = rawAction(this.gateway.nextAction({ sessionId: session, epoch, afterActionId: cursor, nowMs: Date.now() }));
      if (!next) break;
      cursor = next.actionId;
      count += 1;
    }
    return count;
  }

  /** Queued actions EXCLUDING the currently active one (which is still pending
   *  in the gateway until it is ACKed). */
  private queuedCount(record: HeadlessSession, session: string): number {
    const pending = this.pendingActions(session, record.epoch);
    return Math.max(0, pending - (record.active ? 1 : 0));
  }

  /** An ACTION BOUNDARY: no active execution and no unprocessed queued action. */
  private atActionBoundary(record: HeadlessSession, session: string): boolean {
    return record.active === null && this.pendingActions(session, record.epoch) === 0;
  }

  /**
   * Transport-budgeted response. The budget is charged on the COMPLETE MCP
   * result (JSON text content + structuredContent + envelope), in UTF-8 bytes,
   * so non-ASCII and the text/structured duplication are counted exactly.
   */
  private respond(data: Record<string, unknown>): CallToolResult {
    const body = { schema: RESULT_SCHEMA, ok: true, ...data };
    const result = payload(body);
    const bytes = measureMcpResult(result);
    if (bytes > MAX_RESPONSE_BYTES) {
      return errPayload('E_PAYLOAD_TOO_LARGE', 'world.response_too_large', {
        bytes, maxBytes: MAX_RESPONSE_BYTES,
        hint: 'use world_headless_dev_events (paged), snapshot ref or frame export'
      });
    }
    return result;
  }


  /** Bounded in-process frame cache (owner refs; never multi-MB duplicates). */
  private storeFrameRef(ref: string, frame: unknown, bytes: number, session: string): void {
    this.frameRefs.set(ref, { frame, bytes, session });
    const total = (): number => {
      let n = 0;
      for (const e of this.frameRefs.values()) n += e.bytes;
      return n;
    };
    while (this.frameRefs.size > 1 && (this.frameRefs.size > FRAME_REF_MAX || total() > FRAME_REF_MAX_BYTES)) {
      const oldest = this.frameRefs.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.frameRefs.delete(oldest);
    }
  }

  private resolveFrame(input: { ref?: unknown; frame?: unknown }): { ok: true; frame: unknown } | { ok: false; code: string; messageKey: string; extra?: Record<string, unknown> } {
    if (typeof input.ref === 'string' && input.ref.length > 0) {
      const entry = this.frameRefs.get(input.ref);
      if (!entry) return { ok: false, code: 'E_SNAPSHOT_INVALID', messageKey: 'world.frame_ref_unknown' };
      return { ok: true, frame: entry.frame };
    }
    if (input.frame !== undefined) {
      if (!isHeadlessFrame(input.frame)) return { ok: false, code: 'E_SNAPSHOT_INVALID', messageKey: 'world.headless_frame_invalid' };
      const bytes = canonicalJson(input.frame).length;
      if (bytes > MAX_FRAME_INGRESS_BYTES) {
        return {
          ok: false, code: 'E_PAYLOAD_TOO_LARGE', messageKey: 'world.frame_too_large_for_transport',
          extra: { bytes, maxBytes: MAX_FRAME_INGRESS_BYTES, hint: 'use a snapshot ref or restore_file' }
        };
      }
      return { ok: true, frame: input.frame };
    }
    return { ok: false, code: 'E_SCHEMA', messageKey: 'world.frame_required' };
  }

  inspect(session: string): CallToolResult {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    const queuedActions = this.queuedCount(record, session);
    const eventsRetained = record.world.eventsCount;
    const eventsTotal = record.world.eventTotal;
    return this.respond({
      session, epoch: record.epoch,
      // `canonicalState` is small (map is a hash); the EVENT history is paged.
      canonicalState: record.world.canonicalState(),
      stateFingerprint: record.world.canonicalStateHash(),
      eventsFingerprint: record.world.canonicalEventsHash(),
      eventsRetained, eventsTotal,
      eventsTruncated: isHistoryTruncated(eventsTotal, eventsRetained),
      inspect: record.world.inspect(),
      manager: {
        boundary: record.active === null && queuedActions === 0 ? 'action' : 'mid_execution',
        active: record.active
          ? {
              actionId: record.active.actionId, requestId: record.active.requestId,
              actionType: record.active.actionType, startedTick: record.active.startedTick,
              executedTicks: record.active.durationTicks - record.active.remainingTicks,
              remainingTicks: record.active.remainingTicks, durationTicks: record.active.durationTicks
            }
          : null,
        queuedActions,
        ledger: record.ledger.stats()
      }
    });
  }

  /** Dev: full canonical STATE (small) without the event history. */
  devState(session: string): CallToolResult {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    const eventsRetained = record.world.eventsCount;
    const eventsTotal = record.world.eventTotal;
    return this.respond({
      session, epoch: record.epoch, tick: record.world.tick,
      canonicalState: record.world.canonicalState(),
      stateFingerprint: record.world.canonicalStateHash(),
      eventsFingerprint: record.world.canonicalEventsHash(),
      eventsRetained, eventsTotal,
      eventsTruncated: isHistoryTruncated(eventsTotal, eventsRetained)
    });
  }

  devEventsSummary(session: string): CallToolResult {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    const retained = record.world.eventsCount;
    const total = record.world.eventTotal;
    return this.respond({
      session, epoch: record.epoch,
      eventTotal: total, eventsRetained: retained,
      windowStart: total - retained,
      eventsTruncated: isHistoryTruncated(total, retained),
      eventsFingerprint: record.world.canonicalEventsHash()
    });
  }

  /** Dev: bounded, cursor-paged events. No silent loss: a lost prefix is
   *  reported via `truncated`/`lostPrefix`/`windowStart`. */
  devEvents(session: string, offset: number, limit: number): CallToolResult {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    const retained = record.world.eventsCount;
    const total = record.world.eventTotal;
    const windowStart = total - retained;
    const requestedOffset = Math.max(0, Math.floor(offset));
    const effectiveOffset = Math.max(requestedOffset, windowStart);
    const lostPrefix = effectiveOffset - requestedOffset;
    let pageSize = Math.max(1, Math.min(EVENTS_PAGE_MAX, Math.floor(limit)));
    let items = record.world.eventsSlice(effectiveOffset - windowStart, pageSize);
    const build = (size: number) => {
      const pageItems = record.world.eventsSlice(effectiveOffset - windowStart, size);
      return {
        session, epoch: record.epoch,
        offset: effectiveOffset, requestedOffset, limit: size,
        total, retained, windowStart,
        truncated: isHistoryTruncated(total, retained),
        lostPrefix,
        nextCursor: effectiveOffset + pageItems.length < total ? effectiveOffset + pageItems.length : null,
        items: pageItems
      };
    };
    let body = build(pageSize);
    // Shrink using the SAME full-result budget (envelope included), not the body.
    while (pageSize > 1
      && measureMcpResult(payload({ schema: RESULT_SCHEMA, ok: true, ...body })) > EVENTS_PAGE_BYTE_BUDGET) {
      pageSize = Math.max(1, Math.floor(pageSize / 2));
      body = build(pageSize);
    }
    return this.respond(body);
  }

  snapshot(session: string): CallToolResult {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    // A snapshot is only meaningful at an ACTION BOUNDARY. Mid-execution would
    // silently drop the remaining ticks / queued actions, so refuse it WITHOUT
    // cancelling or ACKing anything.
    if (!this.atActionBoundary(record, session)) {
      return errPayload('E_NOT_APPLICABLE', 'world.snapshot_requires_action_boundary');
    }
    const eventsRetained = record.world.eventsCount;
    const eventsTotal = record.world.eventTotal;
    const frame = { ...record.world.snapshot(), boundary: 'action' as const };
    const bytes = canonicalJson(frame).length;
    const ref = `frameref_${randomBytes(12).toString('hex')}`;
    this.storeFrameRef(ref, frame, bytes, session);
    // The frame itself is NOT transported inline (it can be many MB); the owner
    // receives an in-process ref plus size/hash/truncation metadata.
    return this.respond({
      session, epoch: record.epoch, boundary: 'action',
      ref, frameBytes: bytes,
      eventsRetained, eventsTotal,
      eventsTruncated: isHistoryTruncated(eventsTotal, eventsRetained),
      stateFingerprint: record.world.canonicalStateHash(),
      eventsFingerprint: record.world.canonicalEventsHash()
    });
  }

  private applyRestore(record: HeadlessSession, session: string, frame: unknown): CallToolResult {
    if (!isHeadlessFrame(frame)) return errPayload('E_SNAPSHOT_INVALID', 'world.headless_frame_invalid');
    // Only an ACTION-BOUNDARY frame may be restored.
    if ((frame as { boundary?: unknown }).boundary !== 'action') {
      return errPayload('E_NOT_APPLICABLE', 'world.snapshot_requires_action_boundary');
    }
    if (!this.atActionBoundary(record, session)) {
      return errPayload('E_NOT_APPLICABLE', 'world.restore_requires_action_boundary');
    }
    const restored = record.world.restore(frame);
    if (!restored.ok) return errPayload(restored.code, restored.messageKey);
    const rebind = this.gateway.rebindSession(session, Date.now());
    if (!rebind.ok) return errPayload(rebind.code, rebind.messageKey);
    record.epoch = rebind.epoch;
    record.active = null;
    record.ledger.clear();
    this.gateway.pushObservation(session, record.epoch, record.world.observation(record.epoch), Date.now());
    return this.respond({
      session, epoch: record.epoch, status: record.world.runStatus,
      stateFingerprint: record.world.canonicalStateHash(),
      eventsFingerprint: record.world.canonicalEventsHash(),
      observation: record.world.observation(record.epoch)
    });
  }

  restore(session: string, input: { ref?: unknown; frame?: unknown }): CallToolResult {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const resolved = this.resolveFrame(input);
    if (!resolved.ok) return errPayload(resolved.code, resolved.messageKey, resolved.extra ?? {});
    return this.applyRestore(found.record, session, resolved.frame);
  }

  replay(session: string, input: { ref?: unknown; frame?: unknown }, steps: unknown): CallToolResult {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    const resolved = this.resolveFrame(input);
    if (!resolved.ok) return errPayload(resolved.code, resolved.messageKey, resolved.extra ?? {});
    const parsedSteps = parseSteps(steps);
    if (!parsedSteps) return errPayload('E_SCHEMA', 'world.headless_steps_invalid');
    const result = record.world.replay(resolved.frame, parsedSteps);
    return this.respond({ session, ...result });
  }

  async replayFile(session: string, path: string, steps: unknown): Promise<CallToolResult> {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const parsedSteps = parseSteps(steps);
    if (!parsedSteps) return errPayload('E_SCHEMA', 'world.headless_steps_invalid');
    const file = await this.resolveFrameFile(path);
    if (!file.ok) return errPayload(file.code, file.messageKey, file.extra ?? {});
    let frame: unknown;
    try { frame = JSON.parse(await readFile(file.path, 'utf8')); }
    catch { return errPayload('E_SNAPSHOT_INVALID', 'world.frame_file_unreadable'); }
    if (!isHeadlessFrame(frame)) return errPayload('E_SNAPSHOT_INVALID', 'world.headless_frame_invalid');
    const result = found.record.world.replay(frame, parsedSteps);
    return this.respond({ session, ...result });
  }

  /**
   * Resolve an owner-only frame path under FRAME_DIR.
   *
   * Rejects: `..`/absolute escapes, the frames root itself, non-regular
   * files, symlinks / junctions / reparse points anywhere in the path (checked
   * with `realpath` + `lstat`), and files larger than the 16 MiB frame cap
   * BEFORE any read/parse.
   */
  private async resolveFrameFile(path: string): Promise<
    { ok: true; path: string; size: number } | { ok: false; code: string; messageKey: string; extra?: Record<string, unknown> }
  > {
    const base = resolve(FRAME_DIR);
    // Root-level junction/symlink escape: same rule as an internal link.
    if (!(await isSafeFramesRoot(base))) {
      return { ok: false, code: 'E_PERMISSION', messageKey: 'world.frame_path_forbidden' };
    }
    const lexical = resolve(path);
    if (lexical === base || !lexical.startsWith(base + sep)) {
      return { ok: false, code: 'E_PERMISSION', messageKey: 'world.frame_path_forbidden' };
    }
    let realBase: string;
    let realFile: string;
    try {
      realBase = await realpath(base);
      realFile = await realpath(lexical);
    } catch {
      // Missing path or a broken link: treat as forbidden, never fall back to
      // the lexical path.
      return { ok: false, code: 'E_PERMISSION', messageKey: 'world.frame_path_forbidden' };
    }
    if (realFile !== realBase && !realFile.startsWith(realBase + sep)) {
      return { ok: false, code: 'E_PERMISSION', messageKey: 'world.frame_path_forbidden' };
    }
    let info;
    try { info = await lstat(realFile); }
    catch { return { ok: false, code: 'E_PERMISSION', messageKey: 'world.frame_path_forbidden' }; }
    if (info.isSymbolicLink() || !info.isFile()) {
      return { ok: false, code: 'E_PERMISSION', messageKey: 'world.frame_path_forbidden' };
    }
    if (info.size > HEADLESS_MAX_FRAME_BYTES) {
      return {
        ok: false, code: 'E_RESOURCE_LIMIT', messageKey: 'world.frame_file_too_large',
        extra: { size: info.size, maxBytes: HEADLESS_MAX_FRAME_BYTES }
      };
    }
    return { ok: true, path: realFile, size: info.size };
  }

  /** Dev: write the full frame to an owner-only local artifact (not the wire). */
  async frameExport(session: string, input: { ref?: unknown; frame?: unknown }): Promise<CallToolResult> {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    let frame: unknown;
    if (typeof input.ref === 'string' || input.frame !== undefined) {
      const resolved = this.resolveFrame(input);
      if (!resolved.ok) return errPayload(resolved.code, resolved.messageKey, resolved.extra ?? {});
      frame = resolved.frame;
    } else {
      if (!this.atActionBoundary(record, session)) {
        return errPayload('E_NOT_APPLICABLE', 'world.snapshot_requires_action_boundary');
      }
      frame = { ...record.world.snapshot(), boundary: 'action' as const };
    }
    const text = canonicalJson(frame);
    const dir = resolve(FRAME_DIR);
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, `${session}-${Date.now()}.frame.json`);
    await writeFile(file, text, 'utf8');
    const aclDir = await hardenOwnerDirectory(dir);
    const aclFile = await hardenOwnerFile(file);
    return this.respond({
      session, path: file, bytes: text.length, acl: aclFile, aclDir,
      eventsRetained: record.world.eventsCount,
      eventsTotal: record.world.eventTotal,
      eventsTruncated: isHistoryTruncated(record.world.eventTotal, record.world.eventsCount),
      stateFingerprint: record.world.canonicalStateHash(),
      eventsFingerprint: record.world.canonicalEventsHash()
    });
  }

  /** Dev: restore from an owner-only frame file (request carries only a path). */
  async restoreFile(session: string, path: string): Promise<CallToolResult> {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const file = await this.resolveFrameFile(path);
    if (!file.ok) return errPayload(file.code, file.messageKey, file.extra ?? {});
    // Size was checked by resolveFrameFile BEFORE any read/parse.
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(file.path, 'utf8')); }
    catch { return errPayload('E_SNAPSHOT_INVALID', 'world.frame_file_unreadable'); }
    // A local owner file bypasses the TRANSPORT ingress limit, not validation.
    return this.applyRestore(found.record, session, parsed);
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
    record.active = null;
    record.ledger.clear();
    this.gateway.pushObservation(session, record.epoch, record.world.observation(record.epoch), Date.now());
    return this.respond({ session, epoch: record.epoch, roomId, spawned: loaded.spawned, observation: record.world.observation(record.epoch) });
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
    record.active = null;
    record.ledger.clear();
    this.gateway.pushObservation(session, record.epoch, record.world.observation(record.epoch), Date.now());
    return this.respond({ session, epoch: record.epoch, spawned: spawned.spawned });
  }

  async exportFailure(session: string, reason: string): Promise<CallToolResult> {
    const found = this.devRecord(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    const queuedActions = this.queuedCount(record, session);
    const boundary = record.active === null && queuedActions === 0;
    const eventsRetained = record.world.eventsCount;
    const eventsTotal = record.world.eventTotal;
    // EXACT truncation: `eventTotal === retained` is NOT truncated; only a lost
    // prefix (eventTotal > retained) makes a full reproduction impossible.
    const eventsTruncated = isHistoryTruncated(eventsTotal, eventsRetained);
    const replayable = boundary && !eventsTruncated;
    const base = record.world.exportFailure(reason);
    const diagnostics = {
      boundary: boundary ? 'action' : 'mid_execution',
      replayable,
      active: record.active
        ? {
            actionId: record.active.actionId, requestId: record.active.requestId,
            actionType: record.active.actionType, startedTick: record.active.startedTick,
            executedTicks: record.active.durationTicks - record.active.remainingTicks,
            remainingTicks: record.active.remainingTicks, durationTicks: record.active.durationTicks
          }
        : null,
      queuedActions,
      ledger: record.ledger.stats(),
      eventsRetained,
      eventsTotal,
      eventsTruncated,
      stateFingerprint: record.world.canonicalStateHash(),
      eventsFingerprint: record.world.canonicalEventsHash(),
      note: eventsTruncated
        ? 'HISTORY TRUNCATED (eventTotal > retained events): the retained window alone is not a full reproduction and cannot be claimed replayable'
        : boundary
          ? 'action-boundary export: full future state captured and replayable'
          : 'INCOMPLETE reproduction: active/queued actions are still pending; remaining ticks are NOT in the frame'
    };
    const frame = base.frame as Record<string, unknown> | undefined;
    if (replayable && frame) frame.boundary = 'action';
    const bundle = { ...base, manager: diagnostics };
    const dir = resolve('reports/ai-native-02/c3c/failures');
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, `${session}-${Date.now()}.failure.json`);
    const text = canonicalJson(bundle);
    await writeFile(file, text, 'utf8');
    const aclDir = await hardenOwnerDirectory(dir);
    const aclFile = await hardenOwnerFile(file);
    return this.respond({
      session, path: file, bytes: text.length, acl: aclFile, aclDir,
      boundary: diagnostics.boundary, replayable: diagnostics.replayable,
      eventsRetained, eventsTotal, eventsTruncated,
      stateFingerprint: diagnostics.stateFingerprint,
      diagnostics
    });
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
    // Truthful: supported ONLY when a real core device exists.
    for (const record of this.sessions.values()) {
      const view = record.world.signalView();
      if (view) {
        const status = signalCombatStatus(view);
        return okPayload({ supported: true, code: status.code, messageKey: status.messageKey, device: view });
      }
    }
    const status = signalCombatStatus();
    return errPayload(status.code, status.messageKey);
  }

  /** Dev/OWNER-only: spawn ONE real Relay device in an existing session. */
  signalDevice(session: string): CallToolResult {
    if (!this.dev) return errPayload('E_PERMISSION', 'world.headless_dev_only');
    const found = this.touch(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    const record = found.record;
    const deviceId = 'relay_main';
    const roomId = record.world.currentEpoch >= 1 ? 0 : 0;
    const pos = record.world.state.player;
    record.world.enableSignalDevice({ deviceId, roomId, x: pos.x + 1, y: pos.y });
    record.world.runSteps([{ ticks: 1, intent: neutralIntent() }], 1);
    return okPayload({ session, epoch: found.record.epoch, device: record.world.signalView() });
  }

  /** Dev/OWNER-only: legal core Signal command, committed by a real tick. */
  signalCommand(session: string, command: {
    type: 'signal-scan' | 'signal-jam' | 'toggle-relay' | 'signal-power';
    actor?: 'player' | 'echo'; enabled?: boolean; powered?: boolean;
  }): CallToolResult {
    if (!this.dev) return errPayload('E_PERMISSION', 'world.headless_dev_only');
    const found = this.touch(session);
    if (!found.ok) return errPayload(found.code, found.messageKey);
    if (!found.record.world.signalView()) return errPayload('E_NOT_APPLICABLE', 'world.signal_combat_unsupported');
    found.record.world.enqueueSignalCommand(command);
    const events = found.record.world.runSteps([{ ticks: 1, intent: neutralIntent() }], 1);
    return okPayload({ session, epoch: found.record.epoch, events: events.map((e) => e.type), device: found.record.world.signalView() });
  }

  /** Dev/OWNER-only: REAL Signal Combat batch across seeds. */
  signalBatch(seeds: readonly number[]): CallToolResult {
    if (!this.dev) return errPayload('E_PERMISSION', 'world.headless_dev_only');
    if (seeds.length === 0 || seeds.length > 10) return errPayload('E_RESOURCE_LIMIT', 'world.headless_batch_limit');
    return okPayload({ result: signalCombatBatch(seeds) });
  }
}

type TypedIntent = { move: { x: number; y: number }; dash: boolean; fire: boolean; aim: { x: number; y: number } | null; interact: boolean };

/** Player intent validation: only legal movement/aim/fire/interact fields. */
export function parsePlayerIntent(value: unknown): TypedIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  // STRICT allowlist: the intent shape is exactly the legal PlayerIntent.
  // Extra keys (hp, seed, position, weaponKey, ammo, ...) are rejected.
  const topKeys = Object.keys(v).sort();
  if (topKeys.join(',') !== 'aim,dash,fire,interact,move') return null;
  const move = v.move;
  if (!move || typeof move !== 'object' || Array.isArray(move)) return null;
  const moveKeys = Object.keys(move as Record<string, unknown>).sort();
  if (moveKeys.join(',') !== 'x,y') return null;
  const aim = v.aim;
  if (aim !== null) {
    if (!aim || typeof aim !== 'object' || Array.isArray(aim)) return null;
    const aimKeys = Object.keys(aim as Record<string, unknown>).sort();
    if (aimKeys.join(',') !== 'x,y') return null;
  }
  const num = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1000;
  const mv = move as Record<string, unknown>;
  const av = aim as Record<string, unknown> | null;
  if (!num(mv.x) || !num(mv.y)) return null;
  if (av !== null && (!num(av.x) || !num(av.y))) return null;
  if (typeof v.dash !== 'boolean' || typeof v.fire !== 'boolean' || typeof v.interact !== 'boolean') return null;
  // Never allow an over-speed vector: the core normalizes today, and this
  // boundary guarantees it regardless of future core changes.
  let mx = mv.x as number;
  let my = mv.y as number;
  const mag = Math.hypot(mx, my);
  if (mag > 1) { mx /= mag; my /= mag; }
  return {
    move: { x: mx, y: my }, dash: v.dash, fire: v.fire,
    aim: av === null ? null : { x: av.x as number, y: av.y as number },
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

  // Player channel: NO `intent` field is registered at all, so the official
  // SDK strict schema rejects a direct intent before it reaches the manager.
  const playerStepSchema = z.strictObject({
    session: sessionId, epoch: z.number().int().min(0), requestId: worldRequestId,
    ticks: z.number().int().min(1).max(HEADLESS_MAX_TICKS_PER_STEP)
  });
  const devStepSchema = z.strictObject({
    session: sessionId, epoch: z.number().int().min(0), requestId: worldRequestId,
    ticks: z.number().int().min(1).max(HEADLESS_MAX_TICKS_PER_STEP),
    intent: intentSchema.optional()
  });
  register(server, 'world_headless_step',
    dev
      ? 'DEV: run real core ticks; queued actions first, optionally a strict fixture intent for replay.'
      : 'Run real core ticks. Advances ONLY queued world_action intents (then neutral). Queue with world_action first; direct intent is not accepted.',
    dev ? devStepSchema : playerStepSchema,
    (args) => manager.step(args.session as string, args.epoch as number, args.requestId as string, args.ticks as number, (args as { intent?: unknown }).intent));

  register(server, 'world_close', 'Close a headless session; releases the real core state.',
    z.strictObject({ session: sessionId }), (args) => manager.close(args.session as string));

  register(server, 'world_signal_status', 'Real Signal Combat capability: supported only when a core Relay device exists.', z.strictObject({}), () => manager.signalStatus());
  if (dev) {
    register(server, 'world_headless_dev_signal_device', 'DEV: spawn ONE real Relay device in a session.', z.strictObject({ session: z.string() }), (a) => manager.signalDevice(a.session as string));
    register(server, 'world_headless_dev_signal_command', 'DEV: commit one legal Signal core command.', z.strictObject({
      session: z.string(),
      type: z.enum(['signal-scan', 'signal-jam', 'toggle-relay', 'signal-power']),
      actor: z.enum(['player', 'echo']).optional(),
      enabled: z.boolean().optional(), powered: z.boolean().optional()
    }), (a) => manager.signalCommand(a.session as string, a as never));
    register(server, 'world_headless_dev_signal_batch', 'DEV: real multi-seed Signal Combat batch.', z.strictObject({
      seeds: z.array(z.number().int().min(0)).min(1).max(10)
    }), (a) => manager.signalBatch(a.seeds as number[]));
  }

  if (!dev) return;

  register(server, 'world_headless_dev_inspect', 'DEV: bounded debug projection (seed/rng/pending/ledger/map hash).',
    z.strictObject({ session: sessionId }), (args) => manager.inspect(args.session as string));

  register(server, 'world_headless_dev_snapshot', 'DEV: action-boundary snapshot; returns a bounded frame REF + size/hash/truncation (frame is not inline). Refused mid-execution.',
    z.strictObject({ session: sessionId }), (args) => manager.snapshot(args.session as string));

  register(server, 'world_headless_dev_state', 'DEV: full canonical STATE (small) + hashes; event history is paged separately.',
    z.strictObject({ session: sessionId }), (args) => manager.devState(args.session as string));

  register(server, 'world_headless_dev_events_summary', 'DEV: bounded event-history summary (total/retained/windowStart/truncated/hash).',
    z.strictObject({ session: sessionId }), (args) => manager.devEventsSummary(args.session as string));

  register(server, 'world_headless_dev_events', 'DEV: cursor-paged events (offset,limit) with total/truncated/nextCursor. Bounded response.',
    z.strictObject({ session: sessionId, offset: z.number().int().min(0), limit: z.number().int().min(1).max(EVENTS_PAGE_MAX).optional() }),
    (args) => manager.devEvents(args.session as string, args.offset as number, (args.limit as number | undefined) ?? EVENTS_PAGE_DEFAULT));

  register(server, 'world_headless_dev_restore', 'DEV: restore an ACTION-BOUNDARY frame by ref (preferred) or a <=512KiB inline frame; bumps the epoch.',
    z.strictObject({ session: sessionId, ref: z.string().min(1).max(128).optional(), frame: z.unknown().optional() }),
    (args) => manager.restore(args.session as string, { ref: args.ref, frame: args.frame }));

  register(server, 'world_headless_dev_replay', 'DEV: deterministic replay from a boundary frame ref/inline frame; returns REAL divergence info.',
    z.strictObject({ session: sessionId, ref: z.string().min(1).max(128).optional(), frame: z.unknown().optional(), steps: z.array(z.strictObject({ ticks: z.number().int().min(1), intent: intentSchema })).min(1).max(WORLD_LIMITS.MAX_ACTIONS_PER_BATCH) }),
    (args) => manager.replay(args.session as string, { ref: args.ref, frame: args.frame }, args.steps));

  register(server, 'world_headless_dev_replay_file', 'DEV: replay from an owner-only frame file under reports/ai-native-02/c3c/frames/.',
    z.strictObject({ session: sessionId, path: z.string().min(1).max(512), steps: z.array(z.strictObject({ ticks: z.number().int().min(1), intent: intentSchema })).min(1).max(WORLD_LIMITS.MAX_ACTIONS_PER_BATCH) }),
    (args) => manager.replayFile(args.session as string, args.path as string, args.steps));

  register(server, 'world_headless_dev_frame_export', 'DEV: write the full frame to an owner-only local artifact; returns a path (not the payload).',
    z.strictObject({ session: sessionId, ref: z.string().min(1).max(128).optional() }),
    (args) => manager.frameExport(args.session as string, { ref: args.ref }));

  register(server, 'world_headless_dev_restore_file', 'DEV: restore from an owner-only frame file under reports/ai-native-02/c3c/frames/.',
    z.strictObject({ session: sessionId, path: z.string().min(1).max(512) }),
    (args) => manager.restoreFile(args.session as string, args.path as string));

  register(server, 'world_headless_dev_load_room', 'DEV: load a REAL generated room and spawn REAL enemies.',
    z.strictObject({ session: sessionId, roomId: z.number().int().min(0).max(4096), kinds: z.array(enemyKind).min(1).max(WORLD_LIMITS.MAX_ACTIONS_PER_BATCH) }),
    (args) => manager.loadRoom(args.session as string, args.roomId as number, args.kinds as EnemyKind[]));

  register(server, 'world_headless_dev_spawn_enemies', 'DEV: spawn REAL enemies near the player (sustain a real wave).',
    z.strictObject({ session: sessionId, kinds: z.array(enemyKind).min(1).max(WORLD_LIMITS.MAX_ACTIONS_PER_BATCH) }),
    (args) => manager.spawnEnemies(args.session as string, args.kinds as EnemyKind[]));

  register(server, 'world_headless_dev_export_failure', 'DEV: export a failure bundle to reports/ai-native-02/c3c/failures/. Marks whether it is a complete/replayable boundary.',
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
