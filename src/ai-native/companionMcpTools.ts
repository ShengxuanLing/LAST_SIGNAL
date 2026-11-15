// AI-NATIVE-02 P3-b A — official COMPANION MCP surface (core-free).
//
// Only four tools: echo_observe / echo_suggest / echo_status / echo_memory.
// There is deliberately NO confirm tool: the human Owner confirms inside the
// real game UI with a browser-held secret the agent never receives.
// This module imports no simulation core and never steps anything.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolveWorldConfig } from './worldMcpTools';
import { WORLD_LIMITS } from './worldProtocol';

const RESULT_SCHEMA = 'last_signal.mcp.companion-result.v1';
const ID_REQ = /^req_[0-9a-f]{24}$/;
const ID_SUG = /^sug_[0-9a-f]{24}$/;
const COORD = z.number().finite().min(-100000).max(100000);

function payload(data: Record<string, unknown>, isError = false): CallToolResult {
  const body = { schema: RESULT_SCHEMA, ...data };
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: body,
    ...(isError ? { isError: true } : {})
  };
}
const okPayload = (data: Record<string, unknown>): CallToolResult => payload({ ok: true, ...data });
const errPayload = (code: string, messageKey: string): CallToolResult => payload({ ok: false, code, messageKey }, true);

export interface CompanionClientConfig { bridgeUrl: string; token: string; session?: string }

/** Agent-side HTTP client: attach -> independent lease -> observe/suggest. */
export class CompanionClient {
  private session: string | null;
  private epoch = 1;
  private leaseId: string | null = null;
  private renewTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: CompanionClientConfig) {
    this.session = config.session ?? null;
  }

  private async request(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${this.config.bridgeUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.token}`,
        ...(init.headers as Record<string, string> | undefined)
      }
    });
    return res.json();
  }
  private post(path: string, body: unknown): Promise<any> {
    return this.request(path, { method: 'POST', body: JSON.stringify(body) });
  }
  private get(path: string): Promise<any> { return this.request(path, { method: 'GET' }); }

  get attached(): boolean { return this.session !== null && this.leaseId !== null; }
  get currentSession(): string | null { return this.session; }

  async attach(): Promise<{ ok: boolean; code?: string; messageKey?: string }> {
    const r = await this.post('/world-link/attach', this.session ? { session: this.session } : {});
    if (!r.ok) return { ok: false, code: r.code, messageKey: r.messageKey };
    this.session = r.session;
    this.epoch = r.epoch;
    this.leaseId = r.leaseId;
    this.renewTimer = setInterval(() => {
      if (!this.session || !this.leaseId) return;
      void this.post('/world-link/agent-renew', { session: this.session, epoch: this.epoch, leaseId: this.leaseId });
    }, WORLD_LIMITS.AGENT_RENEW_MS);
    this.renewTimer.unref?.();
    return { ok: true };
  }

  private async ready(): Promise<CallToolResult | null> {
    if (!this.attached) {
      const a = await this.attach();
      if (!a.ok) return errPayload(a.code ?? 'E_LINK_UNAVAILABLE', a.messageKey ?? 'companion.attach_failed');
    }
    return null;
  }

  async observe(): Promise<CallToolResult> {
    const bad = await this.ready(); if (bad) return bad;
    const r = await this.get(`/world-link/companion-observation?session=${this.session}&epoch=${this.epoch}`);
    if (!r.ok) return errPayload(r.code ?? 'E_LINK_UNAVAILABLE', r.messageKey ?? 'companion.no_observation');
    return okPayload({ observation: r.value });
  }

  async suggest(input: {
    requestId: string; suggestionId: string; kind: string; reason: string;
    target?: { x: number; y: number }; confidence?: number; ttlTicks?: number;
  }): Promise<CallToolResult> {
    const bad = await this.ready(); if (bad) return bad;
    const r = await this.post('/world-link/companion-suggest', {
      session: this.session, epoch: this.epoch, ...input
    });
    if (!r.ok) return errPayload(r.code ?? 'E_SCHEMA', r.messageKey ?? 'companion.suggest_failed');
    return okPayload({ suggestion: r.value.suggestion, replayed: r.value.replayed, requestId: r.value.requestId });
  }

  async status(): Promise<CallToolResult> {
    const bad = await this.ready(); if (bad) return bad;
    const r = await this.get(`/world-link/companion-status?session=${this.session}&epoch=${this.epoch}`);
    if (!r.ok) return errPayload(r.code ?? 'E_LINK_UNAVAILABLE', r.messageKey ?? 'companion.status_failed');
    return okPayload({ status: r.value.status, pending: r.value.pending, receipts: r.value.receipts ?? [] });
  }

  async memory(): Promise<CallToolResult> {
    const bad = await this.ready(); if (bad) return bad;
    const r = await this.get(`/world-link/companion-memory?session=${this.session}&epoch=${this.epoch}`);
    if (!r.ok) return errPayload(r.code ?? 'E_LINK_UNAVAILABLE', r.messageKey ?? 'companion.memory_failed');
    return okPayload({ memoryEntries: r.memoryEntries, memoryTtlTicks: r.memoryTtlTicks });
  }

  async close(): Promise<void> {
    if (this.renewTimer) { clearInterval(this.renewTimer); this.renewTimer = null; }
    if (this.session && this.leaseId) {
      await this.post('/world-link/agent-disconnect', { session: this.session, leaseId: this.leaseId }).catch(() => undefined);
    }
    this.session = null;
    this.leaseId = null;
  }
}

export function registerCompanionTools(server: McpServer, client: CompanionClient): void {
  const register = (name: string, description: string, schema: z.ZodTypeAny,
    handler: (args: any) => Promise<CallToolResult>): void => {
    server.registerTool(name, { description, inputSchema: schema as never }, (async (args: unknown) => {
      try { return await handler(args ?? {}); }
      catch { return errPayload('E_NOT_APPLICABLE', 'companion.tool_failed'); }
    }) as never);
  };
  register('echo_observe', 'Echo-legal perception only (no seed/map/RNG/hidden state).', z.strictObject({}), () => client.observe());
  register('echo_suggest',
    'Propose ONE companion action. Every proposal needs a human Owner confirmation in the game UI; this tool never executes.',
    z.strictObject({
      requestId: z.string().regex(ID_REQ),
      suggestionId: z.string().regex(ID_SUG),
      kind: z.enum(['move', 'aim', 'fire', 'scan', 'jam']),
      reason: z.enum(['perceived_hostile', 'perceived_relay', 'no_perceived_target', 'objective_blocked']),
      target: z.strictObject({ x: COORD, y: COORD }).optional(),
      confidence: z.number().min(0).max(1).optional(),
      ttlTicks: z.number().int().min(1).max(WORLD_LIMITS.MAX_TTL_TICKS).optional()
    }), (args) => client.suggest(args));
  register('echo_status', 'Truthful link/owner state (Connected / Fallback NO_MODEL) and pending proposals.', z.strictObject({}), () => client.status());
  register('echo_memory', 'Bounded memory count and TTL (no raw hidden memory).', z.strictObject({}), () => client.memory());
}

export async function startCompanionMcpServer(): Promise<void> {
  const config = await resolveWorldConfig();
  if (!config) {
    process.stderr.write('[companion-mcp] LAST_SIGNAL_WORLD_BRIDGE_URL and token are required\n');
    process.exit(2);
  }
  const client = new CompanionClient(config);
  const server = new McpServer({ name: 'last-signal-companion', version: '0.1.0' });
  registerCompanionTools(server, client);
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    try { await client.close(); } catch { /* ignore */ }
    try { await server.close(); } catch { /* ignore */ }
  };
  const transport = new StdioServerTransport();
  transport.onclose = () => { void cleanup(); };
  process.on('SIGINT', () => { void cleanup().finally(() => process.exit(0)); });
  process.on('SIGTERM', () => { void cleanup().finally(() => process.exit(0)); });
  process.stdin.on('end', () => { void cleanup().finally(() => process.exit(0)); });
  process.stdin.on('close', () => { void cleanup().finally(() => process.exit(0)); });
  await server.connect(transport);
}
