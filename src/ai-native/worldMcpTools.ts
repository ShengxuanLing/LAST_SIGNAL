// AI-NATIVE-02 C3-b — official WORLD MCP tools and server entry.
//
// This module deliberately imports ONLY the agent-side bridge client, the
// protocol schemas, zod and the MCP SDK. It has ZERO simulation-core imports:
// there is no second SimulationState, it never steps the rendered game and
// never writes a Scene. The rendered browser is the only authority.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { WorldClient } from './worldClient';
import { WORLD_LIMITS, parseWorldActionBatch, type WorldActionV2 } from './worldProtocol';

const RESULT_SCHEMA = 'last_signal.mcp.tool-result.v1';

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
function errPayload(code: string, messageKey: string): CallToolResult {
  return payload({ ok: false, code, messageKey }, true);
}

const worldRequestId = z.string().regex(/^req_[0-9a-f]{24}$/);
const worldActionId = z.string().regex(/^aid_[0-9a-f]{24}$/);
const worldCoord = z.number().finite().min(-100000).max(100000);
const worldMoveAction = z.strictObject({
  type: z.literal('move'), actionId: worldActionId,
  dir: z.strictObject({ x: worldCoord, y: worldCoord }),
  ticks: z.number().int().min(1).max(WORLD_LIMITS.MAX_ACTION_TICKS)
});
const worldStopAction = z.strictObject({ type: z.literal('stop'), actionId: worldActionId });
const worldAimAction = z.strictObject({
  type: z.literal('aim'), actionId: worldActionId,
  target: z.strictObject({ x: worldCoord, y: worldCoord })
});
const worldFireAction = z.strictObject({
  type: z.literal('fire'), actionId: worldActionId,
  target: z.strictObject({ x: worldCoord, y: worldCoord }).optional(),
  ticks: z.number().int().min(1).max(WORLD_LIMITS.MAX_ACTION_TICKS)
});
const worldInteractAction = z.strictObject({ type: z.literal('interact'), actionId: worldActionId });
const worldScanAction = z.strictObject({
  type: z.literal('scan'), actionId: worldActionId,
  actor: z.enum(['player', 'echo']),
  ticks: z.number().int().min(1).max(WORLD_LIMITS.MAX_ACTION_TICKS)
});
const worldJamAction = z.strictObject({
  type: z.literal('jam'), actionId: worldActionId,
  actor: z.enum(['player', 'echo']),
  ticks: z.number().int().min(1).max(WORLD_LIMITS.MAX_ACTION_TICKS)
});
/** V2 action schema: v1 intents plus signal actions with explicit actor. */
export const worldActionV2Schema = z.discriminatedUnion('type', [
  worldMoveAction, worldStopAction, worldAimAction, worldFireAction, worldInteractAction,
  worldScanAction, worldJamAction
]);
const worldAction = z.discriminatedUnion('type', [
  worldMoveAction, worldStopAction, worldAimAction, worldFireAction, worldInteractAction
]);

type RegisterFn = (
  server: McpServer,
  name: string,
  description: string,
  schema: z.ZodTypeAny,
  handler: (args: Record<string, unknown>) => Promise<CallToolResult> | CallToolResult
) => void;

/** Bind the four official tools. An agent tool can never authorize a session. */
export function registerWorldTools(server: McpServer, client: WorldClient, register: RegisterFn): void {
  const ensureAttached = async (): Promise<{ ok: true } | { ok: false; code: string; messageKey: string }> => {
    if (client.sessionId) {
      // ALWAYS verify the remote lease/session. A locally cached sessionId
      // must never be reported as attached after a hard disconnect.
      const status = await client.status();
      if (status.ok && status.attached) return { ok: true };
      return { ok: false, code: status.code ?? 'E_SESSION_NOT_FOUND', messageKey: status.messageKey ?? 'world.session_closed' };
    }
    if (client.detached) {
      return { ok: false, code: 'E_SESSION_NOT_FOUND', messageKey: 'world.session_closed' };
    }
    const result = await client.handshake();
    if ('ok' in result && result.ok === true) return { ok: true };
    const failure = result as { code?: string; messageKey?: string };
    return { ok: false, code: failure.code ?? 'E_SESSION_NOT_FOUND', messageKey: failure.messageKey ?? 'world.not_attached' };
  };

  register(server, 'world_list_sessions',
    'List the rendered world session the HUMAN authorized (agent side, attach-only).',
    z.strictObject({}),
    async () => {
      const attached = await ensureAttached();
      if (!attached.ok) return errPayload(attached.code, attached.messageKey);
      const status = await client.status();
      return okPayload({
        session: client.sessionId,
        epoch: client.currentEpoch,
        attached: status.attached === true,
        linkStatus: status.status,
        leaseStatus: status.leaseStatus ?? 'unknown'
      });
    });

  register(server, 'world_observe',
    'Read the latest POST-COMMIT, perception-cropped observation of the rendered world.',
    z.strictObject({}),
    async () => {
      const attached = await ensureAttached();
      if (!attached.ok) return errPayload(attached.code, attached.messageKey);
      const result = await client.observe();
      if (!result.ok) return errPayload(result.code, result.messageKey);
      return okPayload({ observation: result.observation, session: client.sessionId, epoch: client.currentEpoch });
    });

  register(server, 'world_action',
    'Submit intents to the rendered world. Queue-only: the browser executes them on a real core tick. V1 actions (move/stop/aim/fire/interact) plus V2 signal actions (scan/jam with actor). V1 scan/jam without actor is rejected by the gateway.',
    z.strictObject({
      requestId: worldRequestId,
      actions: z.array(z.lazy(() => worldActionV2Schema)).min(1).max(WORLD_LIMITS.MAX_ACTIONS_PER_BATCH),
      ttlTicks: z.number().int().min(1).max(WORLD_LIMITS.MAX_TTL_TICKS).optional()
    }),
    async (args) => {
      const attached = await ensureAttached();
      if (!attached.ok) return errPayload(attached.code, attached.messageKey);
      // Default to the MAXIMUM protocol TTL: an action may request up to 120
      // real core ticks, and the execution deadline must cover that duration
      // plus bridge latency. The gateway still enforces the hard 600-tick cap.
      const result = await client.submit(
        args.requestId as string,
        args.actions as never,
        (args.ttlTicks as number | undefined) ?? WORLD_LIMITS.MAX_TTL_TICKS
      );
      if (!result.ok) return errPayload(result.code ?? 'E_SCHEMA', result.messageKey ?? 'world.action_failed');
      return okPayload({
        session: client.sessionId,
        epoch: result.epoch ?? client.currentEpoch,
        requestId: result.requestId,
        acceptedTick: result.acceptedTick,
        applyByTick: result.applyByTick,
        replayed: result.replayed ?? false,
        actions: result.actions ?? []
      });
    });

  register(server, 'world_close',
    'Disconnect the agent side. The rendered game degrades to HUMAN control; no automatic re-take.',
    z.strictObject({}),
    async () => {
      const wasAttached = client.sessionId !== null;
      const ok = await client.close();
      if (ok || !wasAttached) return okPayload({ closed: true });
      return errPayload('E_LINK_UNAVAILABLE', 'world.close_failed');
    });
}

/** Resolve credentials without ever echoing the token. */
export async function resolveWorldConfig(): Promise<{ bridgeUrl: string; token: string } | null> {
  const bridgeUrl = (process.env.LAST_SIGNAL_WORLD_BRIDGE_URL ?? '').replace(/\/$/, '');
  const tokenFile = process.env.LAST_SIGNAL_WORLD_TOKEN_FILE ?? '';
  let token = process.env.LAST_SIGNAL_WORLD_TOKEN ?? '';
  if (!token && tokenFile) {
    try { token = (await readFile(tokenFile, 'utf8')).trim(); } catch { token = ''; }
  }
  if (!bridgeUrl || !token) return null;
  return { bridgeUrl, token };
}

/** Standalone entry used by `node dist-mcp/worldMcpServer.mjs` and by `--world`. */
export async function startWorldMcpServer(): Promise<void> {
  const config = await resolveWorldConfig();
  if (!config) {
    process.stderr.write('[world-mcp] LAST_SIGNAL_WORLD_BRIDGE_URL and token (env or TOKEN_FILE) are required' + String.fromCharCode(10));
    process.exit(2);
  }
  const client = new WorldClient(config);
  const server = new McpServer({ name: 'last-signal-world', version: '0.4.0' });
  const register: RegisterFn = (srv, name, description, schema, handler) =>
    srv.registerTool(name, { description, inputSchema: schema as never }, (async (args: unknown) => {
      try { return await handler((args ?? {}) as Record<string, unknown>); }
      catch {
        return payload({ ok: false, code: 'E_NOT_APPLICABLE', messageKey: 'world.tool_failed' }, true);
      }
    }) as never);
  registerWorldTools(server, client, register);

  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    try { await server.close(); } catch { /* ignore */ }
    try { await client.close(); } catch { /* ignore */ }
  };
  const transport = new StdioServerTransport();
  transport.onclose = () => { void cleanup(); };
  // EOF / SIGINT / SIGTERM degrade the rendered link to HUMAN control.
  process.on('SIGINT', () => { void cleanup().finally(() => process.exit(0)); });
  process.on('SIGTERM', () => { void cleanup().finally(() => process.exit(0)); });
  process.stdin.on('end', () => { void cleanup().finally(() => process.exit(0)); });
  process.stdin.on('close', () => { void cleanup().finally(() => process.exit(0)); });
  await server.connect(transport);
}
