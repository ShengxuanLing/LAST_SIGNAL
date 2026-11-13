/**
 * AI-NATIVE-01 / P3 — independent Node MCP client (official SDK).
 *
 * Spawns the built MCP server as a separate Node process over stdio
 * (windowsHide is set by the SDK's StdioClientTransport on Windows), then does a
 * real initialize + listTools + callTool loop. This is MCP integration evidence,
 * not a P4 agent playthrough.
 *
 * Run:  npm run game:mcp:build && npx vite-node src/ai-native/mcpClient.mts
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { validateStepResultDetailed, validateObservationDetailed } from './protocol';

const DTO = 'last_signal.ai-native.dto.v1';
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
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Payload { ok: boolean; code?: string; [key: string]: unknown }

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<Payload> {
  const result = await client.callTool({ name, arguments: args });
  const payload = result.structuredContent as Payload | undefined;
  assert(payload && typeof payload === 'object', `tool ${name} returned no structuredContent`, result);
  return payload;
}
async function callExpectError(client: Client, name: string, args: Record<string, unknown>): Promise<{ threw: boolean; isError: boolean; payload?: Payload }> {
  try {
    const result = await client.callTool({ name, arguments: args });
    return { threw: false, isError: result.isError === true, payload: result.structuredContent as Payload | undefined };
  } catch {
    return { threw: true, isError: true };
  }
}

async function openClient(dev: boolean): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER, ...(dev ? ['--dev'] : [])],
    cwd: REPO,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[mcp-server] ${chunk.toString()}`));
  const client = new Client({ name: 'last-signal-mcp-client', version: '0.3.0' });
  await client.connect(transport);
  return { client, transport };
}

const ROUTE: Array<{ type: string | null; payload: Record<string, unknown> | null; ticks: number }> = [
  { type: 'move', payload: { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 60 }, ticks: 60 },
  { type: 'scan', payload: { type: 'scan' }, ticks: 1 },
  { type: 'jam', payload: { type: 'jam', targetId: 'tgt_lab_door_receiver' }, ticks: 1 },
  { type: 'move', payload: { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 40 }, ticks: 40 },
  { type: 'move', payload: { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 100 }, ticks: 100 },
  { type: null, payload: null, ticks: 1 },
  { type: 'move', payload: { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 61 }, ticks: 61 },
  { type: 'move', payload: { type: 'move', direction: { x: 0, y: -1 }, durationTicks: 17 }, ticks: 17 },
  { type: 'interact', payload: { type: 'interact', targetId: 'tgt_corridor_relay' }, ticks: 1 },
  { type: null, payload: null, ticks: 95 },
  { type: 'move', payload: { type: 'move', direction: { x: 1, y: 0 }, durationTicks: 150 }, ticks: 150 },
];

async function playerFlow(): Promise<void> {
  const { client, transport } = await openClient(false);
  const list = await client.listTools();
  const names = list.tools.map((t) => t.name).sort();
  log('PLAYER listTools', names);
  assert(!names.includes('game_snapshot'), 'player server must not register game_snapshot');
  assert(!names.includes('game_restore'), 'player server must not register game_restore');
  assert(!names.includes('game_inspect_state'), 'player server must not register dev inspect');
  assert(names.includes('game_step') && names.includes('game_observe'), 'player core tools missing');

  const created = await call(client, 'game_create_session', {});
  assert(created.ok && typeof created.session === 'string', 'player create failed', created);
  const session = created.session as string;
  const playerEpoch = created.epoch as number;
  log('PLAYER create', { session: session.slice(0, 8) + '…', kind: created.kind, tick: created.tick, epoch: playerEpoch });
  const noEpochStep = await callExpectError(client, 'game_step', { session, ticks: 1, actions: [] });
  assert(noEpochStep.threw || noEpochStep.isError || noEpochStep.payload?.code === 'E_SCHEMA', 'missing epoch on game_step must be rejected', noEpochStep);
  const noEpochExec = await callExpectError(client, 'game_execute_action', { session, action: { type: 'wait', payload: { type: 'wait', durationTicks: 1 } }, ticks: 1 });
  assert(noEpochExec.threw || noEpochExec.isError || noEpochExec.payload?.code === 'E_SCHEMA', 'missing epoch on game_execute_action must be rejected', noEpochExec);
  const staleEpoch = await callExpectError(client, 'game_step', { session, epoch: 999, ticks: 1, actions: [] });
  assert(staleEpoch.payload?.ok === false && staleEpoch.payload.code === 'E_STALE_EPOCH', 'stale epoch must be rejected', staleEpoch.payload);

  // Harness-level request idempotency: same requestId + same args (no fromTick/actionId)
  const idemReq = `req_${'c'.repeat(24)}`;
  const idem1 = await call(client, 'game_step', { session, epoch: playerEpoch, ticks: 1, requestId: idemReq, actions: [] });
  const idem2 = await call(client, 'game_step', { session, epoch: playerEpoch, ticks: 1, requestId: idemReq, actions: [] });
  assert(idem1.ok && idem2.ok && idem1.tick === idem2.tick, 'same step request must not advance', { idem1, idem2 });
  assert(JSON.stringify(idem1.result) === JSON.stringify(idem2.result), 'same step request must return the original receipt');
  const idemConflict = await callExpectError(client, 'game_step', { session, epoch: playerEpoch, ticks: 2, requestId: idemReq, actions: [] });
  assert(idemConflict.payload?.ok === false && idemConflict.payload.code === 'E_ID_PAYLOAD_MISMATCH', 'different args under the same requestId must conflict', idemConflict.payload);

  const actReq = `req_${'d'.repeat(24)}`;
  const action = { type: 'wait', payload: { type: 'wait', durationTicks: 1 } };
  const ea1 = await call(client, 'game_execute_action', { session, epoch: playerEpoch, action, ticks: 1, requestId: actReq });
  const ea2 = await call(client, 'game_execute_action', { session, epoch: playerEpoch, action, ticks: 1, requestId: actReq });
  assert(ea1.ok && ea2.ok && ea1.tick === ea2.tick, 'same execute_action request must not advance', { ea1, ea2 });
  assert(JSON.stringify(ea1.result) === JSON.stringify(ea2.result), 'same execute_action request must return the original receipt');
  const eaConflict = await callExpectError(client, 'game_execute_action', {
    session, epoch: playerEpoch, ticks: 1, requestId: actReq, action: { type: 'wait', payload: { type: 'wait', durationTicks: 2 } },
  });
  assert(eaConflict.payload?.ok === false && eaConflict.payload.code === 'E_ID_PAYLOAD_MISMATCH', 'different action under the same requestId must conflict', eaConflict.payload);

  const failReq = `req_${'e'.repeat(24)}`;
  const fail1 = await callExpectError(client, 'game_step', { session, epoch: playerEpoch, ticks: 1, requestId: failReq, actions: [], fromTick: 999, targetTick: 1000 });
  const fail2 = await callExpectError(client, 'game_step', { session, epoch: playerEpoch, ticks: 1, requestId: failReq, actions: [], fromTick: 999, targetTick: 1000 });
  assert(fail1.payload?.ok === false && fail2.payload?.ok === false && fail1.payload.code === fail2.payload.code, 'failed first receipt must be stable on retry', { fail1: fail1.payload, fail2: fail2.payload });
  log('PLAYER idempotency', { sameStep: idem1.tick === idem2.tick, conflict: idemConflict.payload?.code, sameExecute: ea1.tick === ea2.tick, execConflict: eaConflict.payload?.code, failureStable: fail1.payload?.code });

  // Dev tool is not callable on the player process.
  const snapshotAttempt = await callExpectError(client, 'game_snapshot', { session });
  assert(snapshotAttempt.threw || snapshotAttempt.isError || snapshotAttempt.payload?.ok === false, 'player must not call game_snapshot', snapshotAttempt);

  // Seed/role/kind elevation is rejected by the closed player schema.
  for (const bad of [{ seed: 1 }, { role: 'DEVELOPER' }, { kind: 'test' }, { devTicket: 'x' }]) {
    const res = await callExpectError(client, 'game_create_session', bad);
    assert(res.threw || res.isError || res.payload?.ok === false, `player create must reject ${JSON.stringify(bad)}`, res);
  }

  for (const segment of ROUTE) {
    const actions = segment.type && segment.payload
      ? [{ type: segment.type, payload: segment.payload }]
      : [];
    const step = await call(client, 'game_step', { session, epoch: playerEpoch, ticks: segment.ticks, actions, includeObservation: false });
    assert(step.ok && step.result && (step.result as { sessionId: string }).sessionId === session, 'player step failed', step);
    assert(validateStepResultDetailed(step.result).ok, 'player StepResult is not P0-valid', step.result);
  }
  const observed = await call(client, 'game_observe', { session, detail: 'standard' });
  assert(observed.ok && observed.observation, 'player observe failed', observed);
  assert(validateObservationDetailed(observed.observation).ok, 'player observation is not P0-valid');
  const self = (observed.observation as { current: { self: Record<string, unknown> } }).current.self;
  const obsSession = (observed.observation as { sessionId: string }).sessionId;
  assert(obsSession === session, 'observation sessionId must be the opaque handle');
  assert(self.completed === true && self.crossed === true, 'player route did not complete', self);
  log('PLAYER route', { tick: observed.tick, room: (observed.observation as { roomId: string }).roomId, completed: self.completed, crossed: self.crossed });

  const events = await call(client, 'game_get_events', { session, cursor: 0, limit: 8 });
  assert(events.ok && Array.isArray(events.events), 'player get_events failed', events);
  log('PLAYER events', { total: events.total, truncated: events.truncated, returned: (events.events as unknown[]).length });

  await call(client, 'game_close_session', { session });
  const pid = transport.pid;
  await client.close();
  await sleep(300);
  let alive = true;
  try { if (pid) process.kill(pid, 0); } catch { alive = false; }
  assert(!alive, 'player server process leaked after close');
  log('PLAYER closed', { serverExited: !alive });
}

async function devFlow(): Promise<void> {
  const { client, transport } = await openClient(true);
  const list = await client.listTools();
  const names = list.tools.map((t) => t.name).sort();
  log('DEV listTools', names);
  for (const tool of ['game_snapshot', 'game_restore', 'game_run_scenario', 'game_inspect_state', 'game_inject_fixture', 'game_replay', 'game_run_batch', 'game_compare_runs']) {
    assert(names.includes(tool), `dev server missing ${tool}`);
  }

  const created = await call(client, 'game_create_session', { seed: 11 });
  assert(created.ok && created.kind === 'test', 'dev create failed', created);
  const session = created.session as string;
  let devEpoch = created.epoch as number;
  log('DEV create', { kind: created.kind, seed: created.seed, epoch: devEpoch });

  // Request-idempotency across an epoch change: a pre-fixture requestId must not replay.
  const epochReq = `req_${'7'.repeat(24)}`;
  const preFixture = await call(client, 'game_step', { session, epoch: devEpoch, ticks: 1, requestId: epochReq, actions: [] });
  assert(preFixture.ok && typeof preFixture.tick === 'number', 'pre-fixture step failed', preFixture);

  // Fixture: audited, epoch-bumped, inspectable.
  const fixture = await call(client, 'game_inject_fixture', { session, fixture: { kind: 'named', name: 'lab_near_door' } });
  assert(fixture.ok && fixture.tampered === true, 'fixture inject failed', fixture);
  devEpoch = fixture.epoch as number;
  const oldEpochReq = await callExpectError(client, 'game_step', { session, epoch: 0, ticks: 1, requestId: epochReq, actions: [] });
  const noEpochAfterFixture = await callExpectError(client, 'game_step', { session, ticks: 1, requestId: epochReq, actions: [] });
  assert(noEpochAfterFixture.threw || noEpochAfterFixture.isError || noEpochAfterFixture.payload?.code === 'E_SCHEMA', 'missing epoch after fixture must be rejected', noEpochAfterFixture);
  assert(oldEpochReq.payload?.ok === false && oldEpochReq.payload.code === 'E_STALE_EPOCH', 'old-epoch request must be rejected', oldEpochReq.payload);
  const newEpochReq = await call(client, 'game_step', { session, epoch: devEpoch, ticks: 1, requestId: epochReq, actions: [] });
  assert(newEpochReq.ok && (newEpochReq.result as { fromTick: number }).fromTick === preFixture.tick, 'post-fixture request must execute, not replay', { preFixture, newEpochReq });

  const inspect = await call(client, 'game_inspect_state', { session });
  assert(inspect.ok && inspect.inspection, 'inspect failed', inspect);
  const inspection = inspect.inspection as { signal: Record<string, unknown>; collision: Record<string, unknown>; fullState: Record<string, unknown>; devTampered: boolean };
  assert(inspection.devTampered === true, 'inspect must mark dev tampering');
  assert(inspection.collision && inspection.signal, 'inspect must expose signal/collision');
  log('DEV fixture+inspect', { epoch: fixture.epoch, door: inspection.signal.door, collision: inspection.collision, tampered: inspection.devTampered });

  // Save snapshot -> step -> restore -> replay.
  const saved = await call(client, 'game_snapshot', { session });
  assert(saved.ok && typeof saved.snapshot === 'string', 'snapshot failed', saved);
  const snap = saved.snapshot as string;
  const beforeTick = saved.tick as number;
  const step = await call(client, 'game_step', { session, epoch: devEpoch, ticks: 5, actions: [{ type: 'wait', payload: { type: 'wait', durationTicks: 5 } }] });
  assert(step.ok && (step.tick as number) === beforeTick + 5, 'dev step failed', step);
  assert(validateStepResultDetailed(step.result).ok, 'dev StepResult is not P0-valid', step.result);
  const preRestoreEpoch = devEpoch;
  const restored = await call(client, 'game_restore', { session, snapshot: snap });
  assert(restored.ok && restored.tick === beforeTick, 'restore failed', restored);
  devEpoch = restored.epoch as number;
  const postRestoreOld = await callExpectError(client, 'game_step', { session, epoch: preRestoreEpoch, ticks: 1, requestId: `req_${'8'.repeat(24)}`, actions: [] });
  assert(postRestoreOld.payload?.ok === false && postRestoreOld.payload.code === 'E_STALE_EPOCH', 'post-restore old epoch must be E_STALE_EPOCH', postRestoreOld.payload);
  const postRestoreMissing = await callExpectError(client, 'game_step', { session, ticks: 1, requestId: `req_${'8'.repeat(24)}`, actions: [] });
  assert(postRestoreMissing.threw || postRestoreMissing.isError || postRestoreMissing.payload?.code === 'E_SCHEMA', 'post-restore missing epoch must be rejected', postRestoreMissing);
  const postRestoreFresh = await call(client, 'game_step', { session, epoch: devEpoch, ticks: 1, requestId: `req_${'8'.repeat(24)}`, actions: [] });
  assert(postRestoreFresh.ok, 'post-restore new-epoch request must execute', postRestoreFresh);
  const replay = await call(client, 'game_replay', { session, steps: [{ actions: [], ticks: 1 }] });
  assert(replay.ok && typeof replay.canonicalState === 'string', 'replay failed', replay);
  log('DEV snapshot/restore/replay', { snapshot: snap.slice(0, 12) + '…', restoredTick: restored.tick, replayStable: typeof replay.canonicalState === 'string' });

  // Multi-session isolation: a second test session is independent of the first.
  const createdB = await call(client, 'game_create_session', { seed: 22 });
  assert(createdB.ok && typeof createdB.session === 'string', 'dev second session failed', createdB);
  const sessionB = createdB.session as string;
  const tickABefore = (await call(client, 'game_observe', { session, detail: 'summary' })).tick as number;
  const stepB = await call(client, 'game_step', { session: sessionB, epoch: createdB.epoch as number, ticks: 3, actions: [] });
  assert(stepB.ok && stepB.tick === 3, 'second session step failed', stepB);
  const tickAAfter = (await call(client, 'game_observe', { session, detail: 'summary' })).tick as number;
  assert(tickABefore === tickAAfter, 'sessions are not isolated');
  await call(client, 'game_close_session', { session: sessionB });
  const badHandle = await callExpectError(client, 'game_observe', { session: `ses_${'0'.repeat(24)}` });
  assert(badHandle.payload?.ok === false && badHandle.payload.code === 'E_SESSION_NOT_FOUND', 'bad session handle must be rejected', badHandle.payload);
  log('DEV isolation', { sessionBClosed: true, otherSessionTickStable: true, badHandleRejected: true });

  // Scenario + batch + compare.
  const runA = await call(client, 'game_run_scenario', { scenarioId: 'station-zero', seed: 11, strategy: 'route-a' });
  assert(runA.ok && runA.runId && runA.snapshot, 'run_scenario failed', runA);
  const runA2 = await call(client, 'game_run_scenario', { scenarioId: 'station-zero', seed: 11, strategy: 'route-a' });
  assert(runA2.ok && runA2.runId, 'same-seed run_scenario failed', runA2);
  const runB = await call(client, 'game_run_scenario', { scenarioId: 'station-zero', seed: 12, strategy: 'route-a' });
  assert(runB.ok && runB.runId, 'second run_scenario failed', runB);
  const compareSame = await call(client, 'game_compare_runs', { runA: runA.runId, runB: runA2.runId });
  assert(compareSame.ok && compareSame.sameState === true && compareSame.sameEvents === true, 'same-seed compare must match', compareSame);
  const compareDiff = await call(client, 'game_compare_runs', { runA: runA.runId, runB: runB.runId });
  assert(compareDiff.ok && compareDiff.sameState === false && compareDiff.sameEvents === true && compareDiff.firstDivergence === null, 'different-seed compare must keep deterministic events but seed-pinned state', compareDiff);
  const batch = await call(client, 'game_run_batch', { scenarioId: 'station-zero', seeds: [11, 12], strategy: 'route-a' });
  assert(batch.ok && Array.isArray(batch.runs) && (batch.runs as unknown[]).length === 2, 'batch failed', batch);
  const [conc1, conc2] = await Promise.all([
    call(client, 'game_run_scenario', { scenarioId: 'station-zero', seed: 21, strategy: 'route-a' }),
    call(client, 'game_run_scenario', { scenarioId: 'station-zero', seed: 22, strategy: 'route-a' }),
  ]);
  assert(conc1.ok && conc2.ok && conc1.completed === true && conc2.completed === true, 'concurrent background runs failed', { conc1, conc2 });
  log('DEV concurrent runs', { run1: conc1.runId, run2: conc2.runId, bothCompleted: true });
  log('DEV scenario/batch/compare', {
    runA: { completed: runA.completed, tick: runA.ticks, stateHash: String(runA.stateHash).slice(0, 14) + '…' },
    runB: { completed: runB.completed, tick: runB.ticks },
    compareSameSeed: { sameState: compareSame.sameState, sameEvents: compareSame.sameEvents },
    compareDiffSeed: { sameState: compareDiff.sameState, sameEvents: compareDiff.sameEvents, firstDivergence: compareDiff.firstDivergence },
    batch: (batch.runs as Array<{ ok: boolean }>).map((r) => r.ok),
  });

  // Advanced action cancellation (no AbortSignal) and timeout.
  const noEpochAdvanced = await callExpectError(client, 'game_execute_action', { session, advanced: { type: 'wait_until', maxTicks: 10 } });
  assert(noEpochAdvanced.threw || noEpochAdvanced.isError || noEpochAdvanced.payload?.code === 'E_SCHEMA', 'missing epoch on advanced must be rejected', noEpochAdvanced);
  const started = await call(client, 'game_execute_action', { session, epoch: devEpoch, advanced: { type: 'wait_until', maxTicks: 400, wait: false } });
  assert(started.ok && typeof started.actionId === 'string', 'advanced start failed', started);
  const cancel = await call(client, 'game_cancel_action', { session, actionId: started.actionId });
  assert(cancel.ok, 'cancel failed', cancel);
  const timed = await call(client, 'game_execute_action', { session, epoch: devEpoch, advanced: { type: 'wait_until', maxTicks: 400, maxWallMs: 50, wait: true } });
  assert(timed.ok && timed.result && (timed.result as { code: string }).code === 'E_TIMEOUT', 'advanced timeout failed', timed);
  log('DEV advanced', { cancel: cancel.ok, timeoutCode: (timed.result as { code: string }).code });

  await call(client, 'game_close_session', { session });
  const pid = transport.pid;
  await client.close();
  await sleep(300);
  let alive = true;
  try { if (pid) process.kill(pid, 0); } catch { alive = false; }
  assert(!alive, 'dev server process leaked after close');
  log('DEV closed', { serverExited: !alive });
}

async function main(): Promise<void> {
  if (!existsSync(SERVER)) fail(`missing ${SERVER}; run npm run game:mcp:build first`);
  log('MCP client', { server: SERVER, node: process.version });
  await playerFlow();
  await devFlow();
  log('MCP client done');
}

main().then(() => process.exit(0)).catch((error) => {
  process.stderr.write(`FAIL client | ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
