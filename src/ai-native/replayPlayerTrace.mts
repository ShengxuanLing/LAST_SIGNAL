/**
 * AI-NATIVE-01 P4 — neutral Player-trace replayer.
 *
 * Reads the portable trace sample (examples/ai-native/p4-player-trace.json),
 * replays its recorded MCP requests through a FRESH official Player MCP server
 * (never --dev), dynamically replacing session/epoch/requestId/actionId, and
 * compares the resulting PUBLIC trajectory (final tick / completed / hp / energy
 * and the ordered event type+tick stream).
 *
 * It does not claim full state-hash equality: a different seed produces different
 * opaque identity/hashes, which is expected and normalized away. Model decision
 * text is provenance only and is never executed.
 *
 * Usage: npx vite-node src/ai-native/replayPlayerTrace.mts
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO = process.cwd();
const SERVER = resolve(REPO, 'dist-mcp/mcpServer.mjs');
const TRACE = resolve(REPO, 'examples/ai-native/p4-player-trace.json');

interface RecordedRequest { seq: number; name: string; arguments: Record<string, unknown>; result: { ok?: boolean; code?: string } }
interface TraceFile {
  provenance: { sourceSha256: string; baselineCommit: string; note: string };
  expected: { finalTick: number; completed: boolean; hp: number; energy: number; roomId: string; events: Array<{ type: string; tick: number }> };
  requests: RecordedRequest[];
}

function log(message: string, data?: unknown): void {
  process.stdout.write(`${message}${data === undefined ? '' : ` | ${JSON.stringify(data)}`}\n`);
}
function fail(message: string, data?: unknown): never {
  process.stderr.write(`FAIL ${message}${data === undefined ? '' : ` | ${JSON.stringify(data)}`}\n`);
  process.exit(1);
}
function assert(condition: unknown, message: string, data?: unknown): asserts condition {
  if (!condition) fail(message, data);
}

let counter = 0;
const hex24 = (): string => String(++counter).padStart(24, '0');
const newRequestId = (): string => `req_${hex24()}`;
const newActionId = (): string => `aid_${hex24()}`;

function normalize(name: string, args: Record<string, unknown>, session: string, epoch: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args, session };
  if (name === 'game_create_session') return {};
  if (out.epoch !== undefined) out.epoch = epoch;
  if (out.requestId !== undefined) out.requestId = newRequestId();
  if (Array.isArray(out.actions)) {
    out.actions = (out.actions as Array<Record<string, unknown>>).map((action) => ({
      ...action,
      ...(action.actionId !== undefined ? { actionId: newActionId() } : {}),
    }));
  }
  if (out.action && typeof out.action === 'object') {
    const action = out.action as Record<string, unknown>;
    if (action.actionId !== undefined) out.action = { ...action, actionId: newActionId() };
  }
  return out;
}

function collectSessionRefs(value: unknown, refs: string[]): void {
  if (typeof value === 'string') { if (/^ses_[0-9a-f]{24}$/.test(value)) refs.push(value); return; }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) collectSessionRefs(item, refs); return; }
  for (const item of Object.values(value as Record<string, unknown>)) collectSessionRefs(item, refs);
}

async function main(): Promise<void> {
  if (!existsSync(SERVER)) fail(`missing ${SERVER}; run npm run game:mcp:build first`);
  if (!existsSync(TRACE)) fail(`missing trace ${TRACE}`);
  const trace = JSON.parse(readFileSync(TRACE, 'utf8')) as TraceFile;
  assert(trace.requests.length > 0, 'trace has no requests');
  log('trace', { requests: trace.requests.length, source: trace.provenance.sourceSha256.slice(0, 12) + '…', baseline: trace.provenance.baselineCommit.slice(0, 10) + '…' });

  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], cwd: REPO, stderr: 'pipe' });
  transport.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[mcp-server] ${chunk.toString()}`));
  const client = new Client({ name: 'last-signal-p4-replayer', version: '0.4.0' });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown>): Promise<{ ok: boolean; isError: boolean; payload: Record<string, unknown> | null }> => {
    const result = await client.callTool({ name, arguments: args });
    const payload = (result.structuredContent ?? null) as Record<string, unknown> | null;
    return { ok: result.isError !== true && payload?.ok !== false, isError: result.isError === true, payload };
  };

  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert(!tools.some((t) => ['game_snapshot', 'game_restore', 'game_inspect_state', 'game_inject_fixture', 'game_run_scenario'].includes(t)), 'replay must use a Player server without dev tools', tools);
  assert(tools.includes('game_step') && tools.includes('game_observe'), 'player tools missing', tools);
  log('player tools', tools);

  const created = await call('game_create_session', {});
  assert(created.ok && typeof created.payload?.session === 'string', 'create failed', created.payload);
  const session = created.payload!.session as string;
  let epoch = created.payload!.epoch as number;
  log('session', { session: session.slice(0, 10) + '…', epoch });

  const sessionRefs: string[] = [];
  let replayed = 0;
  let expectedFailures = 0;
  for (const request of trace.requests) {
    if (typeof request.name !== 'string') continue;
    if (request.name === 'game_create_session' || request.name === 'game_get_events' || request.name === 'game_close_session') continue;
    const args = normalize(request.name, request.arguments, session, epoch);
    const result = await call(request.name, args);
    collectSessionRefs(result.payload, sessionRefs);
    if (result.ok) {
      if (typeof result.payload?.epoch === 'number') epoch = result.payload.epoch as number;
      replayed += 1;
    } else if (request.result?.code === 'E_SCHEMA') {
      expectedFailures += 1; // the recorded bad-payload retry must fail the same way
    } else {
      fail(`unexpected replay failure for ${request.name}`, result.payload);
    }
  }
  log('replayed', { requests: replayed, expectedSchemaFailures: expectedFailures });

  const observed = await call('game_observe', { session, detail: 'standard' });
  assert(observed.ok && observed.payload?.observation, 'final observe failed', observed.payload);
  collectSessionRefs(observed.payload, sessionRefs);
  const observation = observed.payload!.observation as { tick: number; roomId: string; current: { self: Record<string, unknown> } };
  const self = observation.current.self;
  const expected = trace.expected;
  assert(observation.tick === expected.finalTick, `tick mismatch: ${observation.tick} != ${expected.finalTick}`);
  assert(self.completed === expected.completed, 'completed mismatch');
  assert(self.hp === expected.hp, 'hp mismatch');
  assert(self.energy === expected.energy, 'energy mismatch');
  assert(observation.roomId === expected.roomId, 'room mismatch');

  const eventsResult = await call('game_get_events', { session, cursor: 0, limit: 100 });
  assert(eventsResult.ok && Array.isArray(eventsResult.payload?.events), 'get_events failed', eventsResult.payload);
  collectSessionRefs(eventsResult.payload, sessionRefs);
  const events = (eventsResult.payload!.events as Array<{ type: string; tick: number }>).map((e) => ({ type: e.type, tick: e.tick }));
  assert(JSON.stringify(events) === JSON.stringify(expected.events), 'ordered event stream mismatch', { got: events.length, expected: expected.events.length });

  const foreign = [...new Set(sessionRefs.filter((ref) => ref !== session))];
  assert(foreign.length === 0, 'public envelope leaked a foreign/internal session id', foreign);

  await call('game_close_session', { session });
  const pid = transport.pid;
  await client.close();
  await new Promise((r) => setTimeout(r, 300));
  let alive = true;
  try { if (pid) process.kill(pid, 0); } catch { alive = false; }
  assert(!alive, 'server process leaked');

  log('replay match', {
    tick: observation.tick, completed: self.completed, hp: self.hp, energy: self.energy,
    room: observation.roomId, events: events.length, sessionRefsConsistent: foreign.length === 0, serverExited: !alive,
  });
  log('P4 replay done');
}

main().then(() => process.exit(0)).catch((error) => {
  process.stderr.write(`FAIL replay | ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
