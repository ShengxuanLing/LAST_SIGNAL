/**
 * AI-NATIVE-02 C3-c — official headless WORLD MCP smoke (Player + Dev).
 *
 * Real stdio MCP protocol frames against `dist-mcp/worldHeadlessMcpServer.mjs`.
 * It proves the interface and the REAL same-core combat; it is NOT an LLM
 * playthrough and does not pre-write any strategy.
 */
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO = process.cwd();
const SERVER = resolve(REPO, 'dist-mcp/worldHeadlessMcpServer.mjs');
const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;

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
async function withClient<T>(args: string[], run: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [SERVER, ...args], env: { ...process.env } as never, stderr: 'pipe'
  });
  const client = new Client({ name: 'headless-smoke', version: '0.0.0' });
  await client.connect(transport);
  try { return await run(client); } finally { await client.close().catch(() => undefined); }
}
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const structured = result.structuredContent as Record<string, any> | undefined;
  // A strict-schema rejection arrives as a protocol error (no structuredContent).
  if (!structured) return { ok: false, code: 'E_SCHEMA' } as Record<string, any>;
  return structured;
};

async function main(): Promise<void> {
  // ---- Player surface -----------------------------------------------------
  await withClient([], async (client) => {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    for (const name of ['world_headless_create_session', 'world_list_sessions', 'world_observe', 'world_action', 'world_headless_step', 'world_close', 'world_signal_status']) {
      assert(tools.includes(name), `player tool ${name}`);
    }
    for (const devTool of tools.filter((t) => t.includes('_dev_'))) {
      assert(false, `Player surface must not register ${devTool}`);
    }
    log('PASS player_surface_only', { count: tools.length });

    const created = await call(client, 'world_headless_create_session');
    assert(created.ok === true, 'create session', created);
    assert(created.seed === undefined, 'Player create never returns a seed', created);
    const session = created.session as string;
    const epoch = created.epoch as number;
    log('PASS player_create_session', { session, epoch, tick: created.tick, status: created.status });

    const devAttempt = await call(client, 'world_headless_create_session', { seed: 11 });
    assert(devAttempt.ok === false, 'Player cannot pass a seed', devAttempt);

    const observed = await call(client, 'world_observe', { session });
    assert(observed.ok === true && observed.observation.tick === 0, 'post-create observation', observed);
    const drone = observed.observation.drones[0];
    assert(drone && drone.kind === 'drone', 'a real drone is perceivable', observed.observation.drones);
    const serialized = JSON.stringify(observed.observation).toLowerCase();
    for (const hidden of ['"seed":', '"rngstate":', '"map":', '"tiles":', '"pendingcommands":']) {
      assert(!serialized.includes(hidden), `no hidden ${hidden}`);
    }
    log('PASS player_observe_cropped', { tick: observed.observation.tick, drones: observed.observation.drones.length });

    const action = await call(client, 'world_action', {
      session, epoch, requestId: rid(1),
      actions: [{ type: 'fire', actionId: aid(1), target: { x: drone.x, y: drone.y }, ticks: 60 }],
      ttlTicks: 600
    });
    assert(action.ok === true, 'queue fire', action);
    assert(action.actions[0].status === 'queued', 'queued != applied', action);

    const step = await call(client, 'world_headless_step', { session, epoch, requestId: rid(2), ticks: 60 });
    assert(step.ok === true, 'step', step);
    assert(step.ticks === 60, 'exactly 60 real core ticks', step.ticks);
    assert(step.applied.length === 1 && step.applied[0].executedTicks === 60, 'fire executed for 60 ticks', step.applied);
    log('PASS player_step_fire60', {
      fromTick: step.fromTick, toTick: step.toTick, status: step.status,
      eventCount: step.eventCount, applied: step.applied
    });

    const replay = await call(client, 'world_headless_step', { session, epoch, requestId: rid(2), ticks: 60 });
    assert(replay.replayed === true && replay.toTick === step.toTick, 'same step request is idempotent', replay);
    const mismatch = await call(client, 'world_headless_step', { session, epoch, requestId: rid(2), ticks: 30 });
    assert(mismatch.ok === false && mismatch.code === 'E_ID_PAYLOAD_MISMATCH', 'step id mismatch rejected', mismatch);
    log('PASS player_step_idempotent');

    const observed2 = await call(client, 'world_observe', { session });
    assert(observed2.ok === true && observed2.observation.tick === step.toTick, 'observation advanced with the step', observed2);
    log('PASS player_observe_post_step', { tick: observed2.observation.tick, hp: observed2.observation.player.hp });

    const staleEpoch = await call(client, 'world_headless_step', { session, epoch: epoch - 1, requestId: rid(3), ticks: 5 });
    assert(staleEpoch.ok === false && staleEpoch.code === 'E_STALE_EPOCH', 'old epoch rejected', staleEpoch);
    log('PASS player_stale_epoch_rejected');

    const signal = await call(client, 'world_signal_status');
    assert(signal.ok === false && signal.code === 'E_NOT_APPLICABLE', 'Signal Combat is explicitly unsupported', signal);
    log('PASS signal_unsupported');

    const closed = await call(client, 'world_close', { session });
    assert(closed.ok === true, 'close', closed);
    const afterClose = await call(client, 'world_observe', { session });
    assert(afterClose.ok === false, 'closed session is not observable', afterClose);
    log('PASS player_close_releases');
  });

  // ---- Dev surface --------------------------------------------------------
  await withClient(['--dev'], async (client) => {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    for (const name of ['world_headless_dev_inspect', 'world_headless_dev_snapshot', 'world_headless_dev_restore', 'world_headless_dev_replay', 'world_headless_dev_load_room', 'world_headless_dev_spawn_enemies', 'world_headless_dev_export_failure', 'world_headless_dev_batch', 'world_headless_dev_compare', 'world_headless_dev_perf']) {
      assert(tools.includes(name), `dev tool ${name}`);
    }
    const created = await call(client, 'world_headless_create_session', { seed: 424242 });
    assert(created.ok === true && created.seed === 424242, 'dev explicit seed', created);
    const session = created.session as string;
    let epoch = created.epoch as number;

    const inspect = await call(client, 'world_headless_dev_inspect', { session });
    assert(inspect.ok === true && inspect.inspect.rngState !== undefined, 'inspect has RNG', inspect);
    assert(inspect.inspect.purchaseLedger !== undefined, 'inspect has ledger count', inspect);
    log('PASS dev_inspect', { tick: inspect.inspect.tick, mapHash: inspect.inspect.mapHash });

    const snapshot = await call(client, 'world_headless_dev_snapshot', { session });
    assert(snapshot.ok === true && snapshot.frame.schema === 'last_signal.world-headless.frame.v1', 'snapshot frame', snapshot.frameBytes);
    assert(snapshot.frame.sim.pendingCommands !== undefined && snapshot.frame.sim.rngState !== undefined, 'frame has pending+RNG');
    log('PASS dev_snapshot', { bytes: snapshot.frameBytes });

    const rooms = await call(client, 'world_headless_dev_inspect', { session });
    const roomId = rooms.inspect.roomId as number;
    const loaded = await call(client, 'world_headless_dev_load_room', { session, roomId, kinds: ['drone'] });
    assert(loaded.ok === true && loaded.spawned === 1, 'load real room', loaded);
    epoch = loaded.epoch as number;
    log('PASS dev_load_room', { roomId, epoch, spawned: loaded.spawned });

    const spawned = await call(client, 'world_headless_dev_spawn_enemies', { session, kinds: ['drone', 'drone'] });
    assert(spawned.ok === true && spawned.spawned === 2, 'spawn real enemies', spawned);
    epoch = spawned.epoch as number;
    log('PASS dev_spawn_enemies', { epoch, spawned: spawned.spawned });

    // Real combat through the Player step tool on the Dev session.
    const drone = (await call(client, 'world_observe', { session })).observation.drones[0];
    await call(client, 'world_action', {
      session, epoch, requestId: rid(10),
      actions: [{ type: 'fire', actionId: aid(10), target: { x: drone.x, y: drone.y }, ticks: 120 }],
      ttlTicks: 600
    });
    for (let i = 0; i < 4; i += 1) {
      const r = await call(client, 'world_headless_step', { session, epoch, requestId: rid(20 + i), ticks: 60 });
      assert(r.ok === true, `dev combat step ${i}`, r);
    }
    const afterCombat = await call(client, 'world_observe', { session });
    log('PASS dev_real_combat', { tick: afterCombat.tick, drones: afterCombat.observation.drones.length });

    // Deterministic replay needs a START frame and the SAME steps the session
    // actually ran. Use a fresh Dev session so the comparison is meaningful.
    const replaySession = (await call(client, 'world_headless_create_session', { seed: 424242 })).session as string;
    const replayEpoch = (await call(client, 'world_list_sessions')).sessions
      .find((s: any) => s.session === replaySession)?.epoch as number;
    const replayFrame = (await call(client, 'world_headless_dev_snapshot', { session: replaySession })).frame;
    const replaySteps = [{ ticks: 20, intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false } }];
    for (let i = 0; i < replaySteps.length; i += 1) {
      const r = await call(client, 'world_headless_step', {
        session: replaySession, epoch: replayEpoch, requestId: rid(30 + i), ticks: replaySteps[i].ticks, intent: replaySteps[i].intent
      });
      assert(r.ok === true, 'replay-source step', r);
    }
    const replay = await call(client, 'world_headless_dev_replay', { session: replaySession, frame: replayFrame, steps: replaySteps });
    assert(replay.ok === true && replay.sameState === true && replay.sameEvents === true, 'deterministic replay reproduces the session', replay);
    log('PASS dev_replay', { sameState: replay.sameState, sameEvents: replay.sameEvents, firstDivergence: replay.firstDivergence });
    await call(client, 'world_close', { session: replaySession });

    const exported = await call(client, 'world_headless_dev_export_failure', {
      session, reason: 'smoke'
    });
    assert(exported.ok === true && typeof exported.path === 'string', 'failure export', exported);
    log('PASS dev_export_failure', { path: exported.path, bytes: exported.bytes });

    const batch = await call(client, 'world_headless_dev_batch', { seeds: [424242, 777], maxTicks: 600 });
    assert(batch.ok === true && batch.result.runs.length === 2, 'batch combat regression', batch);
    log('PASS dev_batch', batch.result.aggregate);

    const compare = await call(client, 'world_headless_dev_compare', { seeds: [424242, 777], maxTicks: 600 });
    assert(compare.ok === true && compare.result.results.length === 2, 'policy comparison', compare);
    assert(compare.result.note.includes('NOT an AI agent'), 'comparison is explicitly not AI', compare.result.note);
    log('PASS dev_compare', compare.result.results);

    const perf = await call(client, 'world_headless_dev_perf', { ticks: 1000, sessions: 10 });
    assert(perf.ok === true && perf.result.sessions === 10, 'perf 1000x10', perf);
    assert(perf.result.liveCombatTicks > 0, 'perf ran real combat, not an empty scene', perf.result.liveCombatTicks);
    log('PASS dev_perf', {
      ticks: perf.result.ticksPerSession, sessions: perf.result.sessions,
      wallMs: perf.result.wallMs, cpuUserMs: perf.result.cpuUserMs,
      heapUsedBytes: perf.result.heapUsedBytes, events: perf.result.totalEvents,
      liveTicks: perf.result.liveCombatTicks
    });

    const restored = await call(client, 'world_headless_dev_restore', { session, frame: snapshot.frame });
    assert(restored.ok === true && restored.epoch > epoch, 'restore bumps epoch', restored);
    log('PASS dev_restore_epoch', { epoch: restored.epoch });

    const t = 4;
    const a = await call(client, 'world_headless_dev_batch', { seeds: [424242], maxTicks: 600 });
    const b = await call(client, 'world_headless_dev_batch', { seeds: [424242], maxTicks: 600 });
    assert(a.ok && b.ok && a.result.runs[0].canonicalStateHash === b.result.runs[0].canonicalStateHash,
      'deterministic baseline is reproducible', { a: a.result.runs[0].canonicalStateHash, b: b.result.runs[0].canonicalStateHash });
    log('PASS dev_batch_deterministic', { hash: a.result.runs[0].canonicalStateHash });

    await call(client, 'world_close', { session });
    void randomBytes;
  });

  log('HEADLESS_MCP_SMOKE_PASS');
}

main().catch((error) => fail('headless mcp smoke', error instanceof Error ? error.message : String(error)));
