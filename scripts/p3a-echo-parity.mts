/**
 * P3-a — echo determinism / checkpoint parity (Node, no Phaser).
 *
 * The rendered World and this Node driver share the SAME core
 * (`stepSimulationTicks` + `EchoController`). This script proves:
 *   1. two independent runs with the same seed/perception/actions produce the
 *      identical canonical echo state and events;
 *   2. a boundary snapshot of the echo restores into a new world and continues
 *      identically (echo checkpoint round-trip);
 *   3. the echo actually moved/fired and a real drone took echo damage.
 *
 * It does not claim a rendered pixel comparison; the rendered side is covered
 * by tests/ai-native-world.spec.ts (same core, real browser).
 */
import { EchoController } from '../src/ai-native/echo';
import { HeadlessWorld, neutralIntent, type HeadlessWorldFrame } from '../src/ai-native/worldHeadless';
import { canonicalJson, payloadFingerprint } from '../src/ai-native/protocol';

const SEED = 424242;
const TICKS = 360;
const CONFIRM_AT = 40;
const SNAP_AT = 180;

function fail(message: string, extra?: unknown): never {
  process.stderr.write(`FAIL ${message}${extra === undefined ? '' : ` | ${JSON.stringify(extra)}`}\n`);
  process.exit(1);
}

function pass(name: string, extra?: unknown): void {
  process.stdout.write(`PASS ${name}${extra === undefined ? '' : ` | ${JSON.stringify(extra)}`}\n`);
}

interface DriveResult {
  state: string;
  events: string;
  frame: HeadlessWorldFrame | null;
  controller: ReturnType<EchoController['snapshotState']>;
  echo: { x: number; y: number; hp: number } | null;
  drones: Array<{ id: number; hp: number }>;
  initialDrones: Array<{ id: number; hp: number }>;
  shots: number;
}

function drive(world: HeadlessWorld, controller: EchoController, from: number, to: number, snapAt: number): DriveResult {
  let frame: HeadlessWorldFrame | null = null;
  const initialDrones = world.state.drones.map((drone) => ({ id: drone.id, hp: drone.hp }));
  for (let tick = from; tick < to; tick += 1) {
    if (tick === CONFIRM_AT) controller.confirmAssist();
    const view = world.echoView();
    const echoIntent = view ? controller.decide(view) : undefined;
    world.runSteps([{ ticks: 1, intent: neutralIntent(), echoIntent }]);
    if (tick === snapAt) frame = world.snapshot();
  }
  const state = world.state;
  return {
    state: world.canonicalState(),
    events: world.canonicalEvents(),
    frame,
    controller: controller.snapshotState(),
    echo: state.echo ? { x: state.echo.x, y: state.echo.y, hp: state.echo.data.hp } : null,
    drones: state.drones.map((drone) => ({ id: drone.id, hp: drone.hp })),
    initialDrones,
    shots: world.echoShotCount
  };
}

function fresh(): { world: HeadlessWorld; controller: EchoController } {
  const world = new HeadlessWorld({ seed: SEED });
  world.enableEcho();
  const controller = new EchoController();
  controller.setMode('follow');
  return { world, controller };
}

function main(): void {
  // Run A and B: identical inputs, independent worlds.
  const a = fresh();
  const aResult = drive(a.world, a.controller, 0, TICKS, SNAP_AT);
  const b = fresh();
  const bResult = drive(b.world, b.controller, 0, TICKS, SNAP_AT);

  if (aResult.state !== bResult.state) fail('deterministic echo state', { a: payloadFingerprint(aResult.state), b: payloadFingerprint(bResult.state) });
  if (aResult.events !== bResult.events) fail('deterministic echo events', { a: payloadFingerprint(aResult.events), b: payloadFingerprint(bResult.events) });
  pass('deterministic_echo_state_events', {
    stateHash: payloadFingerprint(aResult.state), eventsHash: payloadFingerprint(aResult.events)
  });

  if (!aResult.echo) fail('echo did not exist after the run');
  const movedOrFired = aResult.echo.x !== 0 || aResult.echo.y !== 0 || aResult.shots > 0;
  if (!movedOrFired) fail('echo never moved or fired');
  pass('echo_acted', { echo: aResult.echo, shots: aResult.shots });

  // Checkpoint round-trip: restore the tick-180 frame + policy state, continue.
  if (!aResult.frame) fail('echo snapshot frame missing');
  const restored = HeadlessWorld.fromFrame(aResult.frame, false);
  const restoredController = new EchoController();
  restoredController.loadState(aResult.controller);
  // The frame is captured AFTER the tick at SNAP_AT, so continue from +1.
  const cResult = drive(restored, restoredController, SNAP_AT + 1, TICKS, -1);
  if (cResult.state !== aResult.state) {
    fail('restored echo run diverged', {
      expected: payloadFingerprint(aResult.state), actual: payloadFingerprint(cResult.state)
    });
  }
  pass('echo_checkpoint_restore_parity', { stateHash: payloadFingerprint(aResult.state) });

  // A real drone must have taken real echo damage (killed -> absent, or lower HP).
  const initial = aResult.initialDrones;
  const before = aResult.drones;
  const initialHp = new Map(initial.map((drone) => [drone.id, drone.hp]));
  const damaged = before.length < initial.length
    || before.some((drone) => drone.hp < (initialHp.get(drone.id) ?? drone.hp));
  if (!damaged) fail('no real drone took echo damage', { initial, before });
  pass('real_drone_damaged_by_echo', { initial, before });

  // The echo actor is a true part of the canonical projection.
  if (!aResult.state.includes('"echo"')) fail('canonical state is missing the echo actor');
  pass('canonical_includes_echo', { canonicalBytes: Buffer.byteLength(aResult.state, 'utf8') });

  const summary = {
    seed: SEED, ticks: TICKS, confirmAt: CONFIRM_AT, snapAt: SNAP_AT,
    stateHash: payloadFingerprint(aResult.state),
    echo: aResult.echo, shots: aResult.shots
  };
  process.stdout.write(`P3A_ECHO_PARITY_PASS | ${canonicalJson(summary)}\n`);
}

main();
