/**
 * AI-NATIVE-01 P5 — runnable isolated ECHO co-op demo (real independent Node process).
 *
 * Spawns the built DEV MCP server through the official SDK client and drives the
 * minimal legal co-op chain over the `game_coop_*` tools:
 *   human observes device A, ECHO independently observes device B -> ECHO shares a
 *   subset -> proposes a hypothesis -> human confirms -> ECHO executes the
 *   confirmed shared-rule action (jam the receiver) -> the human walks through the
 *   opened door. It also shows the refusal/management/permission counterexamples.
 *
 * Nothing here is production Player registration; the coop tools exist only on
 * the `--dev` process. Run: npm run game:mcp:build && npx vite-node src/ai-native/coopDemo.mts
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO = process.cwd();
const SERVER = resolve(REPO, 'dist-mcp/mcpServer.mjs');

interface CoopToolResult { ok: boolean; code?: string; [key: string]: unknown }

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

async function main(): Promise<void> {
  if (!existsSync(SERVER)) fail(`missing ${SERVER}; run npm run game:mcp:build first`);
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER, '--dev'], cwd: REPO, stderr: 'pipe' });
  transport.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[mcp-server] ${chunk.toString()}`));
  const client = new Client({ name: 'last-signal-coop-demo', version: '0.5.0' });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown>): Promise<CoopToolResult> => {
    const result = await client.callTool({ name, arguments: args });
    return (result.structuredContent ?? {}) as CoopToolResult;
  };

  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert(tools.includes('game_coop_create') && tools.includes('game_coop_echo'), 'coop tools missing on dev server', tools);
  log('dev tools (coop present)', tools.filter((t) => t.startsWith('game_coop')));

  const created = await call('game_coop_create', {
    seed: 7,
    fixture: { test: true, human: { x: 6.5, y: 5.5 }, echo: { x: 6.5, y: 3.5 } },
  });
  assert(created.ok && typeof created.coop === 'string', 'coop create failed', created);
  const coop = created.coop as string;
  assert(created.testFixture === true, 'coop fixture must be explicitly marked test', created);
  const status = created.status as { human: { actorId: string }; echo: { actorId: string } };
  log('coop world', { coop, human: status.human.actorId, echo: status.echo.actorId, fixture: 'echo-coop-test (test:true)' });

  const humanScan = await call('game_coop_human', { coop, op: 'scan' });
  assert(humanScan.ok, 'human scan failed', humanScan);
  const humanObs = await call('game_coop_observe', { coop, actor: 'human' });
  const humanTargets = (humanObs.observation as { evidence: Array<{ targetId: string }> }).evidence.map((e) => e.targetId);
  assert(JSON.stringify(humanTargets) === JSON.stringify(['tgt_lab_door_receiver']), 'human should see device A only', humanTargets);
  log('human scan (device A)', humanTargets);

  await call('game_coop_advance', { coop, ticks: 250 });
  const echoScan = await call('game_coop_echo', { coop, op: 'scan' });
  assert(echoScan.ok, 'echo scan failed', echoScan);
  const echoObs = await call('game_coop_observe', { coop, actor: 'echo' });
  const echoTargets = (echoObs.observation as { evidence: Array<{ targetId: string }> }).evidence.map((e) => e.targetId);
  assert(JSON.stringify(echoTargets) === JSON.stringify(['tgt_lab_seal_source']), 'echo should see device B only', echoTargets);
  log('echo scan (device B)', echoTargets);

  const share = await call('game_coop_echo', { coop, op: 'share', targetIds: ['tgt_lab_seal_source'], fields: ['stateLabel', 'relationId', 'position'] });
  assert(share.ok, 'echo share failed', share);
  const humanAfterShare = await call('game_coop_observe', { coop, actor: 'human' });
  assert((humanAfterShare.observation as { evidence: unknown[] }).evidence.length === 2, 'human should receive the shared subset', humanAfterShare.observation);
  log('echo share -> human evidence count', (humanAfterShare.observation as { evidence: unknown[] }).evidence.length);

  const proposed = await call('game_coop_echo', { coop, op: 'propose', plan: { kind: 'jam' }, statement: 'Jam the receiver to open the door', confidence: 0.8, uncertainty: 0.2 });
  assert(proposed.ok, 'propose failed', proposed);
  const hypothesis = (proposed.value as { id: string }).id;
  const statusProposed = (proposed.status as { echo: { hypotheses: Array<{ status: string }> } }).echo.hypotheses[0].status;
  assert(statusProposed === 'proposed', 'hypothesis must stay proposed', statusProposed);
  log('hypothesis', { id: hypothesis, status: statusProposed, confidence: 0.8, uncertainty: 0.2 });

  const denied = await call('game_coop_echo', { coop, op: 'execute', id: hypothesis });
  assert(denied.ok === false && denied.code === 'E_PERMISSION', 'unconfirmed execution must be refused', denied);
  const management = await call('game_coop_echo', { coop, op: 'management', management: 'takeover' });
  assert(management.ok === false && management.code === 'E_PERMISSION', 'ECHO management must be refused', management);
  log('refusal path', { unconfirmedExecute: denied.code, echoManagement: management.code });

  const confirmed = await call('game_coop_human', { coop, op: 'confirm', id: hypothesis });
  assert(confirmed.ok, 'confirm failed', confirmed);
  const executed = await call('game_coop_echo', { coop, op: 'execute', id: hypothesis });
  assert(executed.ok, 'confirmed execution failed', executed);
  const afterJam = await call('game_coop_observe', { coop, actor: 'human' });
  const door = (afterJam.observation as { current: { publicDeviceState: { door: string } } }).current.publicDeviceState.door;
  assert(door === 'JAMMED_OPEN', 'door must be actually jammed', door);
  log('confirmed ECHO jam', { door });

  const humanMove = await call('game_coop_human', { coop, op: 'move', direction: 'east', ticks: 60 });
  assert(humanMove.ok, 'human move failed', humanMove);
  const finalObs = await call('game_coop_observe', { coop, actor: 'human' });
  const self = (finalObs.observation as { current: { self: { passed: boolean; energy: number } }; tick: number }).current.self;
  const tick = (finalObs.observation as { tick: number }).tick;
  assert(self.passed === true, 'human did not pass the opened door', self);
  log('collaboration success', { tick, passed: self.passed, energy: self.energy, door });

  const paused = await call('game_coop_human', { coop, op: 'pause' });
  assert(paused.ok, 'pause failed', paused);
  const echoWhilePaused = await call('game_coop_echo', { coop, op: 'scan' });
  assert(echoWhilePaused.ok === false && echoWhilePaused.code === 'E_PAUSED', 'paused ECHO must stop', echoWhilePaused);
  await call('game_coop_human', { coop, op: 'resume' });
  log('owner pause stops ECHO', { echoCode: echoWhilePaused.code });

  const statusFinal = await call('game_coop_status', { coop });
  log('coop trace', { events: (statusFinal.events as unknown[]).length, hypotheses: (statusFinal.status as { echo: { hypotheses: unknown[] } }).echo.hypotheses.length });

  await call('game_coop_close', { coop });
  const pid = transport.pid;
  await client.close();
  await new Promise((r) => setTimeout(r, 300));
  let alive = true;
  try { if (pid) process.kill(pid, 0); } catch { alive = false; }
  assert(!alive, 'dev server process leaked');
  log('coop demo done', { serverExited: !alive });
}

main().then(() => process.exit(0)).catch((error) => {
  process.stderr.write(`FAIL coop demo | ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
