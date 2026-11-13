/**
 * AI-NATIVE-01 P5 final — shared session budget across SessionManager + CoopManager.
 *
 * Real official-SDK MCP client (independent Node process) driving the dev MCP
 * server. Verifies:
 *   - 5 Player sessions + 5 Coop sessions = 10 total (budget cap) OK
 *   - 11th create (Player or Coop) rejected E_RESOURCE_LIMIT
 *   - close() releases budget; after close, create succeeds again
 *   - all-coop (10) then run_scenario rejected E_RESOURCE_LIMIT (no leak)
 *   - failed creation (bad seed) does not consume budget
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO = process.cwd();
const SERVER = resolve(REPO, 'dist-mcp/mcpServer.mjs');

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
async function call(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  return (result.structuredContent ?? {}) as { ok?: boolean; code?: string; [key: string]: unknown };
}
async function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function main(): Promise<void> {
  if (!existsSync(SERVER)) fail(`missing ${SERVER}; run npm run game:mcp:build first`);
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER, '--dev'], cwd: REPO, stderr: 'pipe' });
  transport.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[mcp-server] ${chunk.toString()}`));
  const client = new Client({ name: 'last-signal-budget-client', version: '0.5.0' });
  await client.connect(transport);

  const sessions: string[] = [];   // Player sessions
  const coops: string[] = [];      // Coop sessions

  // 1) Create 5 Player sessions + 5 Coop sessions = 10 total (budget cap)
  for (let i = 0; i < 5; i += 1) {
    const r = await call(client, 'game_create_session', { seed: i + 1 });
    assert(r.ok && typeof r.session === 'string', 'player create failed', r);
    sessions.push(r.session as string);
  }
  for (let i = 0; i < 5; i += 1) {
    const r = await call(client, 'game_coop_create', { seed: 100 + i, fixture: { test: true, human: { x: 6.5, y: 5.5 }, echo: { x: 6.5, y: 3.5 } } });
    assert(r.ok && typeof r.coop === 'string', 'coop create failed', r);
    coops.push(r.coop as string);
  }
  log('created 5 Player + 5 Coop sessions (budget cap 10 reached)');

  // 2) 11th Player session rejected
  const over1 = await call(client, 'game_create_session', { seed: 99 });
  assert(over1.ok === false && over1.code === 'E_RESOURCE_LIMIT', '11th player create should be E_RESOURCE_LIMIT', over1);
  // 11th Coop session rejected
  const over2 = await call(client, 'game_coop_create', { seed: 199, fixture: { test: true, human: { x: 6.5, y: 5.5 }, echo: { x: 6.5, y: 3.5 } } });
  assert(over2.ok === false && over2.code === 'E_RESOURCE_LIMIT', '11th coop create should be E_RESOURCE_LIMIT', over2);

  // 3) A REJECTED creation (invalid seed) must not consume budget.
  //    Free one slot first so the budget is not already full.
  const freed = await call(client, 'game_close_session', { session: sessions[0] });
  assert(freed.ok, 'close should succeed', freed);
  let badRejected = false;
  try {
    const bad = await client.callTool({ name: 'game_create_session', arguments: { seed: -1 } });
    badRejected = bad.isError === true || (bad.structuredContent as { ok?: boolean } | undefined)?.ok === false;
  } catch { badRejected = true; }
  assert(badRejected, 'invalid seed must be rejected');
  const afterBad = await call(client, 'game_create_session', { seed: 50 });
  assert(afterBad.ok, 'create after a failed create must still work (no quota consumed)', afterBad);
  sessions.push(afterBad.session as string);
  log('rejected creation does not consume budget; the next valid create succeeds');

  // 4) Close a session -> budget released -> create again
  const c0 = coops[0];
  const closed = await call(client, 'game_coop_close', { coop: c0 });
  assert(closed.ok && closed.closed === true, 'close should succeed', closed);
  const recreated = await call(client, 'game_coop_create', { seed: 200, fixture: { test: true, human: { x: 6.5, y: 5.5 }, echo: { x: 6.5, y: 3.5 } } });
  assert(recreated.ok, 'create after close must succeed', recreated);
  coops.push(recreated.coop as string);
  log('close releases budget; re-create succeeds');

  // 5) Fill the budget completely (all remaining slots are coop worlds), then
  //    a further create, run_scenario and run_batch must all be rejected.
  while (true) {
    const fill = await call(client, 'game_coop_create', { seed: 300 + coops.length, fixture: { test: true, human: { x: 6.5, y: 5.5 }, echo: { x: 6.5, y: 3.5 } } });
    if (!fill.ok) break;
    coops.push(fill.coop as string);
  }
  const overCreate = await call(client, 'game_coop_create', { seed: 999, fixture: { test: true, human: { x: 6.5, y: 5.5 }, echo: { x: 6.5, y: 3.5 } } });
  assert(overCreate.ok === false && overCreate.code === 'E_RESOURCE_LIMIT', 'create beyond the cap must be E_RESOURCE_LIMIT', overCreate);
  const run = await call(client, 'game_run_scenario', { scenarioId: 'station-zero', seed: 1, strategy: 'route-a' });
  assert(run.ok === false && run.code === 'E_RESOURCE_LIMIT', 'run_scenario when full must be E_RESOURCE_LIMIT', run);
  const batch = await call(client, 'game_run_batch', { scenarioId: 'station-zero', seeds: [1] });
  // run_batch isolates per-run failures: every run reports the budget rejection.
  assert(batch.ok === true && Array.isArray(batch.runs) && batch.runs.length === 1, 'run_batch must return its run list', batch);
  assert(batch.runs[0].ok === false && batch.runs[0].code === 'E_RESOURCE_LIMIT', 'each batch run must report E_RESOURCE_LIMIT', batch.runs[0]);
  log('a full process budget blocks create/run_scenario/run_batch with E_RESOURCE_LIMIT');

  await client.close();
  log('budget client done - all assertions passed');
}

main().then(() => process.exit(0)).catch((error) => {
  process.stderr.write(`FAIL budget client | ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
