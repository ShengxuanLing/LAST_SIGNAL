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

    // Permission negatives: a Dev tool is not registered on the Player surface,
    // and a Player create can never take a seed.
    const devCall = await call(client, 'world_headless_dev_inspect', { session: 'ses_' + '0'.repeat(24) });
    assert(devCall.ok === false, 'Player cannot call a Dev tool', devCall);
    const devSeed = await call(client, 'world_headless_create_session', { seed: 11 });
    assert(devSeed.ok === false, 'Player cannot pass a seed', devSeed);
    log('PASS player_permission_negative', { devToolRejected: true, seedRejected: true });

    // CHANNEL (Tester F2): Player step has NO direct intent. A direct intent is
    // rejected by the tool schema and does not advance ticks or move the player.
    const ch = await call(client, 'world_headless_create_session');
    assert(ch.ok === true, 'channel session', ch);
    const chSession = ch.session as string;
    const chEpoch = ch.epoch as number;
    const chObs = await call(client, 'world_observe', { session: chSession });
    const sx = chObs.observation.player.x as number;
    const sy = chObs.observation.player.y as number;
    const directIntent = await call(client, 'world_headless_step', {
      session: chSession, epoch: chEpoch, requestId: rid(40), ticks: 10,
      intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false }
    });
    assert(directIntent.ok === false, 'Player step must not accept a direct intent', directIntent);
    const afterReject = await call(client, 'world_observe', { session: chSession });
    assert(afterReject.observation.tick === chObs.observation.tick, 'rejected direct intent does not advance', afterReject.observation.tick);

    const neutral = await call(client, 'world_headless_step', { session: chSession, epoch: chEpoch, requestId: rid(41), ticks: 10 });
    assert(neutral.ok === true && neutral.ticks === 10, 'neutral step', neutral);
    const neutralObs = await call(client, 'world_observe', { session: chSession });
    assert(neutralObs.observation.player.x === sx && neutralObs.observation.player.y === sy, 'neutral step does not move');
    assert(neutralObs.observation.projectiles.length === 0, 'neutral step does not fire');

    await call(client, 'world_action', {
      session: chSession, epoch: chEpoch, requestId: rid(42),
      actions: [{ type: 'move', actionId: aid(42), dir: { x: 1, y: 0 }, ticks: 20 }], ttlTicks: 600
    });
    const movedStep = await call(client, 'world_headless_step', { session: chSession, epoch: chEpoch, requestId: rid(43), ticks: 20 });
    assert(movedStep.ok === true && movedStep.applied[0].executedTicks === 20, 'act+step', movedStep);
    const movedObs = await call(client, 'world_observe', { session: chSession });
    assert(Math.hypot(movedObs.observation.player.x - sx, movedObs.observation.player.y - sy) > 0, 'act+step really moved');
    log('PASS player_step_channel', { directRejected: true, neutralStable: true, actStepMoved: true });
    await call(client, 'world_close', { session: chSession });

    const created = await call(client, 'world_headless_create_session');
    assert(created.ok === true, 'create session', created);
    assert(created.seed === undefined, 'Player create never returns a seed', created);
    const session = created.session as string;
    const epoch = created.epoch as number;
    log('PASS player_create_session', { session, epoch, tick: created.tick, status: created.status });

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
      actions: [{ type: 'fire', actionId: aid(1), target: { x: drone.x, y: drone.y }, ticks: 120 }],
      ttlTicks: 600
    });
    assert(action.ok === true, 'queue fire', action);
    assert(action.actions[0].status === 'queued', 'queued != applied', action);

    // Cross-step execution: 10 ticks is executing (10/110), NOT applied.
    const step10 = await call(client, 'world_headless_step', { session, epoch, requestId: rid(2), ticks: 10 });
    assert(step10.ok === true, 'step10', step10);
    assert(step10.canonicalState === undefined && step10.canonicalEvents === undefined, 'step10 has NO canonical');
    assert(step10.applied.length === 0, 'step10 must not ACK applied', step10.applied);
    assert(step10.executing && step10.executing.executedTicks === 10 && step10.executing.remainingTicks === 110, 'step10 executing 10/110', step10.executing);
    log('PASS player_step_executing', { executing: step10.executing });

    const step110 = await call(client, 'world_headless_step', { session, epoch, requestId: rid(4), ticks: 110 });
    assert(step110.ok === true, 'step110', step110);
    assert(step110.canonicalState === undefined && step110.canonicalEvents === undefined, 'step110 has NO canonical');
    assert(step110.applied.length === 1 && step110.applied[0].executedTicks === 120, 'completed only after 120 real ticks', step110.applied);
    assert(step110.executing === null, 'no active action left', step110.executing);
    log('PASS player_step_completed_120', { fromTick: step110.fromTick, toTick: step110.toTick, status: step110.status });

    const replay = await call(client, 'world_headless_step', { session, epoch, requestId: rid(2), ticks: 10 });
    assert(replay.replayed === true && replay.toTick === 10, 'same step request is idempotent', replay);
    assert(replay.canonicalState === undefined, 'replay has NO canonical');
    const mismatch = await call(client, 'world_headless_step', { session, epoch, requestId: rid(2), ticks: 30 });
    assert(mismatch.ok === false && mismatch.code === 'E_ID_PAYLOAD_MISMATCH', 'step id mismatch rejected', mismatch);
    log('PASS player_step_idempotent');

    const observed2 = await call(client, 'world_observe', { session });
    assert(observed2.ok === true && observed2.observation.tick === step110.toTick, 'observation advanced with the step', observed2);
    log('PASS player_observe_post_step', { tick: observed2.observation.tick, hp: observed2.observation.player.hp });

    const ended = await call(client, 'world_headless_step', { session, epoch, requestId: rid(5), ticks: 5 });
    assert(ended.ok === false && ended.code === 'E_NOT_APPLICABLE', 'terminal step rejected', ended);

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

    // Dev keeps a strict direct intent for fixture/replay.
    const devBefore = await call(client, 'world_observe', { session });
    const devStep = await call(client, 'world_headless_step', {
      session, epoch, requestId: rid(60), ticks: 20,
      intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false }
    });
    assert(devStep.ok === true && devStep.ticks === 20, 'dev intent step', devStep);
    const devAfter = await call(client, 'world_observe', { session });
    assert(Math.hypot(devAfter.observation.player.x - devBefore.observation.player.x,
      devAfter.observation.player.y - devBefore.observation.player.y) > 0, 'dev intent really moves');
    log('PASS dev_step_intent', { fromTick: devStep.fromTick, toTick: devStep.toTick });

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

    // Dev snapshot boundary: refused mid-execution, allowed only at a boundary.
    const snapCreated = await call(client, 'world_headless_create_session', { seed: 424243 });
    const snapSession = snapCreated.session as string;
    const snapEpoch = snapCreated.epoch as number;
    const snapDrone = (await call(client, 'world_observe', { session: snapSession })).observation.drones[0];
    await call(client, 'world_action', {
      session: snapSession, epoch: snapEpoch, requestId: rid(80),
      actions: [{ type: 'fire', actionId: aid(80), target: { x: snapDrone.x, y: snapDrone.y }, ticks: 120 }], ttlTicks: 600
    });
    const snap10 = await call(client, 'world_headless_step', { session: snapSession, epoch: snapEpoch, requestId: rid(81), ticks: 10 });
    assert(snap10.executing && snap10.executing.remainingTicks === 110, 'executing 10/110', snap10.executing);
    const midSnap = await call(client, 'world_headless_dev_snapshot', { session: snapSession });
    assert(midSnap.ok === false && midSnap.code === 'E_NOT_APPLICABLE'
      && midSnap.messageKey === 'world.snapshot_requires_action_boundary', 'mid-execution snapshot rejected', midSnap);
    const snap110 = await call(client, 'world_headless_step', { session: snapSession, epoch: snapEpoch, requestId: rid(82), ticks: 110 });
    assert(snap110.applied[0].executedTicks === 120, 'action completed at 120', snap110.applied);
    const boundarySnap = await call(client, 'world_headless_dev_snapshot', { session: snapSession });
    assert(boundarySnap.ok === true && boundarySnap.boundary === 'action'
      && boundarySnap.frame.boundary === 'action', 'boundary snapshot', boundarySnap);
    // Mid-run replay: continue 15 real ticks after the boundary frame, then
    // replay the SAME interval. History baseline + new segment must match.
    const cont15 = await call(client, 'world_headless_step', { session: snapSession, epoch: snapEpoch, requestId: rid(83), ticks: 15 });
    assert(cont15.ok === true && cont15.ticks === 15, 'continuation step', cont15);
    const histSteps = [{ ticks: 15, intent: { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false } }];
    const histReplay = await call(client, 'world_headless_dev_replay', { session: snapSession, frame: boundarySnap.frame, steps: histSteps });
    assert(histReplay.ok === true && histReplay.sameState === true && histReplay.sameEvents === true
      && histReplay.firstDivergence === null, 'mid-run replay over the frame baseline', histReplay);
    assert(histReplay.historyPreserved === true && histReplay.baselineEvents > 0, 'history baseline preserved', histReplay);
    const tampered = JSON.parse(JSON.stringify(boundarySnap.frame));
    tampered.events[0] = { type: 'player-moved', position: { x: 1.5, y: 2.5 } };
    const badReplay = await call(client, 'world_headless_dev_replay', { session: snapSession, frame: tampered, steps: histSteps });
    assert(badReplay.ok === true && badReplay.sameEvents === false && badReplay.firstDivergence === 0,
      'tampered baseline history is detected at index 0', badReplay);
    log('PASS dev_replay_history', {
      baselineEvents: histReplay.baselineEvents,
      historyPreserved: histReplay.historyPreserved,
      tamperDivergence: badReplay.firstDivergence
    });

    const boundaryRestore = await call(client, 'world_headless_dev_restore', { session: snapSession, frame: boundarySnap.frame });
    assert(boundaryRestore.ok === true && boundaryRestore.epoch > snapEpoch, 'restore bumps epoch', boundaryRestore);
    await call(client, 'world_close', { session: snapSession });
    log('PASS dev_snapshot_boundary', { midRejected: true, restoredEpoch: boundaryRestore.epoch });

    await call(client, 'world_close', { session });
    void randomBytes;
  });

  log('HEADLESS_MCP_SMOKE_PASS');
}

main().catch((error) => fail('headless mcp smoke', error instanceof Error ? error.message : String(error)));
