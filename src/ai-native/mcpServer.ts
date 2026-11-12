/**
 * AI-NATIVE-01 / P3 — Official MCP stdio server.
 *
 * This is a REAL Model Context Protocol server built with the official
 * `@modelcontextprotocol/sdk` (McpServer + StdioServerTransport), not a renamed
 * JSON-line CLI. stdout carries protocol frames only; all diagnostics go to
 * stderr.
 *
 * Modes are fixed at process start:
 *   node dist-mcp/mcpServer.mjs              -> PLAYER tools (production only)
 *   node dist-mcp/mcpServer.mjs --dev        -> DEV harness tools (test only)
 *
 * A tool argument can never change mode (closed strict schemas reject
 * role/kind/devTicket/seed on the player surface). Dev-only tools are not even
 * registered in the player process, so listTools and callTool are both isolated.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createSessionManager, type DevFixture } from './sessions';
import { Harness, toolMatrix, type HarnessResult, type RunSummary } from './harness';
import type { ActionResultV1, EventV1, ObservationV1, StepResultV1 } from './protocol';

const RESULT_SCHEMA = 'last_signal.mcp.tool-result.v1';
const SESSION_RE = /^ses_[0-9a-f]{24}$/;
const ACTION_RE = /^aid_[0-9a-f]{24}$/;
const REQUEST_RE = /^req_[0-9a-f]{24}$/;
const SNAPSHOT_RE = /^snapref_[0-9a-f]{24}$/;
const RUN_RE = /^run_[0-9a-f]{24}$/;

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------
function payload(data: Record<string, unknown>, isError = false): CallToolResult {
  const body = { schema: RESULT_SCHEMA, ...data };
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: body,
    ...(isError ? { isError: true } : {}),
  };
}
function withSessionId(data: Record<string, unknown>): Record<string, unknown> {
  return typeof data.session === 'string' ? { ...data, sessionId: data.session } : data;
}
function okPayload(data: Record<string, unknown>): CallToolResult {
  return payload(withSessionId({ ok: true, ...data }));
}
function errPayload(code: string, messageKey: string, extra: Record<string, unknown> = {}): CallToolResult {
  return payload(withSessionId({ ok: false, code, messageKey, ...extra }), true);
}
function fromHarness<T>(res: HarnessResult<T>, map: (value: T) => Record<string, unknown>, extra: Record<string, unknown> = {}): CallToolResult {
  return res.ok ? okPayload({ ...extra, ...map(res.value) }) : errPayload(res.code, res.messageKey, extra);
}

function sanitizeEvent(event: EventV1, session: string): EventV1 {
  return { ...event, sessionId: session as EventV1['sessionId'] };
}
function sanitizeObservation(obs: ObservationV1, session: string): ObservationV1 {
  return {
    ...obs,
    sessionId: session as ObservationV1['sessionId'],
    // Nested event objects must carry the opaque MCP session too.
    events: obs.events.map((e) => sanitizeEvent(e, session)),
  };
}
function sanitizeActionResult(result: ActionResultV1, session: string): ActionResultV1 {
  return { ...result, sessionId: session as ActionResultV1['sessionId'] };
}
function sanitizeStepResult(result: StepResultV1, session: string): StepResultV1 {
  return {
    ...result,
    sessionId: session as StepResultV1['sessionId'],
    actionResults: result.actionResults.map((r) => sanitizeActionResult(r, session)),
    events: result.events.map((e) => sanitizeEvent(e, session)),
    ...(result.observation ? { observation: sanitizeObservation(result.observation, session) } : {}),
  };
}
function eventSummary(events: readonly EventV1[], session: string, limit = 8): EventV1[] {
  return events.slice(0, limit).map((e) => sanitizeEvent(e, session));
}

// ---------------------------------------------------------------------------
// Schemas (strict/closed)
// ---------------------------------------------------------------------------
const sessionHandle = z.string().regex(SESSION_RE);
const actionId = z.string().regex(ACTION_RE);
const actionInput = z.strictObject({
  actionId: actionId.optional(),
  type: z.enum(['move', 'aim', 'fire', 'scan', 'jam', 'interact', 'shoot_guard', 'decoy', 'wait']),
  payload: z.record(z.string(), z.unknown()),
});
const replayStep = z.strictObject({
  actions: z.array(z.record(z.string(), z.unknown())).max(32).optional(),
  ticks: z.number().int().min(1).max(1000),
});
const fixtureInput = z.union([
  z.strictObject({ kind: z.literal('named'), name: z.enum(['lab_near_door', 'lab_low_energy', 'corridor_ready', 'corridor_guard_low_hp']) }),
  z.strictObject({
    kind: z.literal('player'),
    x: z.number().finite().optional(), y: z.number().finite().optional(),
    energy: z.number().int().min(0).max(100).optional(), hp: z.number().int().min(0).max(100).optional(),
  }),
  z.strictObject({
    kind: z.literal('door'),
    state: z.enum(['SEALED', 'JAMMED_OPEN', 'OPEN', 'CLOSED', 'SAFE_PENDING_CLOSE']),
    jamTicks: z.number().int().min(0).max(100000).optional(),
  }),
  z.strictObject({
    kind: z.literal('guard'),
    hp: z.number().int().min(0).max(1000).optional(), jamTicks: z.number().int().min(0).max(100000).optional(),
    x: z.number().finite().optional(), y: z.number().finite().optional(),
  }),
  z.strictObject({
    kind: z.literal('relay'),
    enabled: z.boolean().optional(), powered: z.boolean().optional(),
    bridge: z.enum(['UNAVAILABLE', 'STABLE']).optional(),
  }),
]);
const advancedInput = z.strictObject({
  actionId: actionId.optional(),
  type: z.enum(['move_to', 'approach', 'scan_target', 'interact_with', 'wait_until']),
  target: z.strictObject({ x: z.number().finite(), y: z.number().finite() }).optional(),
  targetId: z.string().regex(/^tgt_[a-z0-9_]{1,64}$/).optional(),
  until: z.enum(['passed', 'crossed', 'finished']).optional(),
  maxTicks: z.number().int().min(1).max(100000).optional(),
  maxWallMs: z.number().int().min(1).max(3_600_000).optional(),
  wait: z.boolean().optional(),
});
const createPlayer = z.strictObject({});
const createDev = z.strictObject({ seed: z.number().int().min(0).max(0xffffffff) });

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
type Handler = (args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>;

function register(server: McpServer, name: string, description: string, inputSchema: z.ZodTypeAny, handler: Handler): void {
  server.registerTool(
    name,
    { description, inputSchema: inputSchema as never },
    (async (args: unknown) => {
      try {
        return await handler((args ?? {}) as Record<string, unknown>);
      } catch {
        return errPayload('E_INTERNAL_TRANSACTION', 'tool handler failed');
      }
    }) as never,
  );
}

function registerPlayerTools(server: McpServer, harness: Harness, dev: boolean): void {
  register(server, 'game_create_session',
    dev
      ? 'Create a DEV/test session with a deterministic seed (dev process only).'
      : 'Create a PLAYER production session. The server generates the seed; no seed/role/dev parameter is accepted.',
    dev ? createDev : createPlayer,
    (args) => fromHarness(
      harness.createSession(dev ? (args.seed as number) : undefined),
      (v) => ({ session: v.session, kind: v.kind, tick: v.tick, epoch: v.epoch, ...(v.seed !== undefined ? { seed: v.seed } : {}), dev }),
    ));

  register(server, 'game_observe',
    'P0 ObservationV1 projection. detail is summary or standard (debug is dev-inspect only).',
    z.strictObject({ session: sessionHandle, detail: z.enum(['summary', 'standard']).optional() }),
    (args) => {
      const session = args.session as string;
      const res = harness.observe(session, (args.detail as 'summary' | 'standard' | undefined) ?? 'standard');
      if (!res.ok) return errPayload(res.code, res.messageKey, { session });
      const obs = sanitizeObservation(res.value, session);
      return okPayload({
        session, tick: obs.tick, epoch: obs.epoch, detail: obs.detail, observation: obs,
        events: eventSummary(obs.events, session),
        ...(dev ? { dev: true, audit: harness.auditTail(session) } : {}),
      });
    });

  register(server, 'game_step',
    'Advance the authoritative simulation by ticks after applying P0 actions. Reuses Session schema/idempotency/epoch/tick.',
    z.strictObject({
      session: sessionHandle,
      ticks: z.number().int().min(1).max(1000),
      actions: z.array(actionInput).max(32).optional(),
      includeObservation: z.boolean().optional(),
      detail: z.enum(['summary', 'standard']).optional(),
      requestId: z.string().regex(REQUEST_RE).optional(),
      fromTick: z.number().int().min(0).max(2_147_483_647).optional(),
      targetTick: z.number().int().min(0).max(2_147_483_647).optional(),
      epoch: z.number().int().min(0).max(4_294_967_295),
    }),
    (args) => {
      const session = args.session as string;
      const res = harness.step(session, {
        ticks: args.ticks as number,
        actions: (args.actions as never[] | undefined) ?? [],
        includeObservation: args.includeObservation === true,
        detail: (args.detail as 'summary' | 'standard' | undefined) ?? 'standard',
        ...(args.requestId ? { requestId: args.requestId as string } : {}),
        ...(args.fromTick !== undefined ? { fromTick: args.fromTick as number } : {}),
        ...(args.targetTick !== undefined ? { targetTick: args.targetTick as number } : {}),
        epoch: args.epoch as number,
      });
      if (!res.ok) return errPayload(res.code, res.messageKey, { session, tick: undefined });
      const result = sanitizeStepResult(res.value, session);
      return okPayload({
        session, tick: result.toTick, epoch: result.epoch, status: result.status,
        result,
        events: eventSummary(result.events, session),
        ...(dev ? { dev: true, audit: harness.auditTail(session) } : {}),
      });
    });

  register(server, 'game_execute_action',
    'Execute one P0 action (schema/idempotency/epoch/tick reused) or a bounded advanced action (dev).',
    z.union([
      z.strictObject({
        session: sessionHandle,
        action: actionInput,
        ticks: z.number().int().min(1).max(1000).optional(),
        requestId: z.string().regex(REQUEST_RE).optional(),
        fromTick: z.number().int().min(0).max(2_147_483_647).optional(),
        targetTick: z.number().int().min(0).max(2_147_483_647).optional(),
        epoch: z.number().int().min(0).max(4_294_967_295),
      }),
      z.strictObject({
        session: sessionHandle,
        advanced: advancedInput,
        epoch: z.number().int().min(0).max(4_294_967_295),
      }),
    ]),
    async (args) => {
      const session = args.session as string;
      if (args.advanced) {
        if (!dev) return errPayload('E_PERMISSION', 'advanced actions are dev-only', { session });
        const res = await harness.executeAdvanced(session, { ...(args.advanced as Record<string, unknown>), epoch: args.epoch as number } as never);
        if (!res.ok) return errPayload(res.code, res.messageKey, { session });
        return okPayload({
          session, actionId: res.value.actionId, actionStatus: res.value.status,
          ...(res.value.result ? { result: sanitizeActionResult(res.value.result, session) } : {}),
          dev: true, audit: harness.auditTail(session),
        });
      }
      const res = harness.executeAction(session, {
        ticks: (args.ticks as number | undefined) ?? 1,
        actions: [],
        action: args.action as never,
        ...(args.requestId ? { requestId: args.requestId as string } : {}),
        ...(args.fromTick !== undefined ? { fromTick: args.fromTick as number } : {}),
        ...(args.targetTick !== undefined ? { targetTick: args.targetTick as number } : {}),
        epoch: args.epoch as number,
      });
      if (!res.ok) return errPayload(res.code, res.messageKey, { session });
      const step = sanitizeStepResult(res.value.step, session);
      return okPayload({
        session, tick: step.toTick, epoch: step.epoch,
        result: res.value.result ? sanitizeActionResult(res.value.result, session) : null,
        step,
        events: eventSummary(step.events, session),
        ...(dev ? { dev: true, audit: harness.auditTail(session) } : {}),
      });
    });

  register(server, 'game_get_events',
    'Read a bounded, ordered event page (total order + truncation notice).',
    z.strictObject({
      session: sessionHandle,
      cursor: z.number().int().min(0).max(2_147_483_647).optional(),
      limit: z.number().int().min(1).max(256).optional(),
    }),
    (args) => {
      const session = args.session as string;
      const res = harness.getEvents(session, (args.cursor as number | undefined) ?? 0, (args.limit as number | undefined) ?? 64);
      if (!res.ok) return errPayload(res.code, res.messageKey, { session });
      const summary = harness.observe(session, 'summary');
      return okPayload({
        session, tick: summary.ok ? summary.value.tick : 0,
        events: eventSummary(res.value.events, session, 256),
        nextCursor: res.value.nextCursor, total: res.value.total,
        truncated: res.value.truncated, droppedEvents: res.value.droppedEvents,
        ...(dev ? { dev: true, audit: harness.auditTail(session) } : {}),
      });
    });

  register(server, 'game_close_session',
    'Close a session and release its engine/timers.',
    z.strictObject({ session: sessionHandle }),
    (args) => fromHarness(harness.closeSession(args.session as string), (v) => ({ session: v.session })));
}

function registerDevTools(server: McpServer, harness: Harness): void {
  register(server, 'game_snapshot',
    'DEV: issue and register a bounded snapshot handle (never returns a raw frame).',
    z.strictObject({ session: sessionHandle }),
    (args) => {
      const session = args.session as string;
      return fromHarness(harness.saveSnapshot(session), (v) => ({
        session, snapshot: v.snapshot, tick: v.tick, epoch: v.epoch,
        ...(v.stateHash ? { stateHash: v.stateHash } : {}), sizeBytes: v.sizeBytes,
        provenance: v.provenance, evicted: v.evicted, dev: true, audit: harness.auditTail(session),
      }));
    });

  register(server, 'game_restore',
    'DEV: restore a snapshot handle issued by THIS process for the same session.',
    z.strictObject({ session: sessionHandle, snapshot: z.string().regex(SNAPSHOT_RE) }),
    (args) => {
      const session = args.session as string;
      return fromHarness(harness.restoreSnapshot(session, args.snapshot as string), (v) => ({
        session, tick: v.tick, status: v.status, epoch: v.epoch, provenance: v.provenance,
        dev: true, audit: harness.auditTail(session),
      }));
    });

  register(server, 'game_replay',
    'DEV: real deterministic re-execution from a bounded step list.',
    z.strictObject({ session: sessionHandle, steps: z.array(replayStep).max(64) }),
    (args) => {
      const session = args.session as string;
      return fromHarness(harness.replay(session, args.steps as never), (v) => ({
        session, canonicalState: v.canonicalState, canonicalEvents: v.canonicalEvents,
        dev: true, audit: harness.auditTail(session),
      }));
    });

  register(server, 'game_inspect_state',
    'DEV: full signal/Guard/collision readings (debug; never exposed to Player).',
    z.strictObject({ session: sessionHandle }),
    (args) => {
      const session = args.session as string;
      return fromHarness(harness.inspect(session), (v) => ({
        session, inspection: v, dev: true, audit: harness.auditTail(session),
      }));
    });

  register(server, 'game_inject_fixture',
    'DEV: apply a closed, validated fixture to a test session (audited; epoch bumps).',
    z.strictObject({ session: sessionHandle, fixture: fixtureInput }),
    (args) => {
      const session = args.session as string;
      return fromHarness(harness.injectFixture(session, args.fixture as DevFixture), (v) => ({
        session, epoch: v.epoch, tick: v.tick, tampered: v.tampered, fixtures: v.audit,
        dev: true, audit: harness.auditTail(session),
      }));
    });

  register(server, 'game_load_scenario',
    'DEV: load the only registered scenario template (no filesystem/exec).',
    z.strictObject({ scenarioId: z.literal('station-zero') }),
    (args) => fromHarness(harness.loadScenario(args.scenarioId as string), (v) => ({ ...v, dev: true })));

  register(server, 'game_run_scenario',
    'DEV: run a deterministic legal strategy in the background and return a summary + snapshot handle.',
    z.strictObject({
      scenarioId: z.literal('station-zero'),
      seed: z.number().int().min(0).max(0xffffffff),
      strategy: z.enum(['route-a', 'idle']).optional(),
      maxTicks: z.number().int().min(1).max(1_000_000).optional(),
      maxWallMs: z.number().int().min(1).max(3_600_000).optional(),
      maxEvents: z.number().int().min(1).max(10_000).optional(),
    }),
    async (args) => {
      const res = await harness.runScenario({
        seed: args.seed as number,
        ...(args.strategy ? { strategy: args.strategy as string } : {}),
        ...(args.maxTicks ? { maxTicks: args.maxTicks as number } : {}),
        ...(args.maxWallMs ? { maxWallMs: args.maxWallMs as number } : {}),
        ...(args.maxEvents ? { maxEvents: args.maxEvents as number } : {}),
      });
      return fromHarness(res, (v: RunSummary) => ({ ...v }));
    });

  register(server, 'game_run_batch',
    'DEV: run 1..8 seeds with bounded concurrency; per-run failures are isolated and cleaned up.',
    z.strictObject({
      scenarioId: z.literal('station-zero'),
      seeds: z.array(z.number().int().min(0).max(0xffffffff)).min(1).max(8),
      strategy: z.enum(['route-a', 'idle']).optional(),
      maxTicks: z.number().int().min(1).max(1_000_000).optional(),
      maxWallMs: z.number().int().min(1).max(3_600_000).optional(),
      maxEvents: z.number().int().min(1).max(10_000).optional(),
    }),
    async (args) => {
      const res = await harness.runBatch({
        seeds: args.seeds as number[],
        ...(args.strategy ? { strategy: args.strategy as string } : {}),
        ...(args.maxTicks ? { maxTicks: args.maxTicks as number } : {}),
        ...(args.maxWallMs ? { maxWallMs: args.maxWallMs as number } : {}),
        ...(args.maxEvents ? { maxEvents: args.maxEvents as number } : {}),
      });
      return fromHarness(res, (v) => ({ runs: v }));
    });

  register(server, 'game_compare_runs',
    'DEV: compare two run handles by canonical state hash and ordered event stream.',
    z.strictObject({ runA: z.string().regex(RUN_RE), runB: z.string().regex(RUN_RE) }),
    (args) => fromHarness(harness.compareRuns(args.runA as string, args.runB as string), (v) => ({ ...v })));

  register(server, 'game_cancel_action',
    'DEV: cancel an in-flight advanced action by its actionId (bounded, idempotent).',
    z.strictObject({ session: sessionHandle, actionId }),
    (args) => {
      const session = args.session as string;
      return fromHarness(harness.cancelAdvanced(session, args.actionId as never), (v) => ({
        session, actionId: v.actionId, cancelled: true, dev: true, audit: harness.auditTail(session),
      }));
    });
}

// ---------------------------------------------------------------------------
// Process entry
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const dev = process.argv.slice(2).includes('--dev');
  const manager = createSessionManager({
    maxSessions: 10, maxConcurrentSteps: 2,
    idleTimeoutMs: 300_000, maxSessionWallMs: 3_600_000,
  });
  const harness = new Harness(manager, dev ? 'dev' : 'player');
  const server = new McpServer({
    name: dev ? 'last-signal-dev-harness' : 'last-signal-player',
    version: '0.3.0',
  });
  registerPlayerTools(server, harness, dev);
  if (dev) registerDevTools(server, harness);

  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    try { await server.close(); } catch { /* ignore */ }
    try { harness.dispose(); } catch { /* ignore */ }
  };
  const transport = new StdioServerTransport();
  transport.onclose = () => { void cleanup(); };
  process.on('SIGINT', () => { void cleanup().finally(() => process.exit(0)); });
  process.on('SIGTERM', () => { void cleanup().finally(() => process.exit(0)); });
  process.stdin.on('end', () => { void cleanup().finally(() => process.exit(0)); });
  process.stdin.on('close', () => { void cleanup().finally(() => process.exit(0)); });
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`[mcp-server] fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
