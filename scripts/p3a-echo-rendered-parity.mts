/**
 * P3-a fix — REAL Rendered <-> Headless echo parity (byte comparison).
 *
 * The rendered World exported its exact initial SimulationState, the ordered
 * per-tick PLAYER and ECHO intents, and its canonical state/events
 * (tests/p3a-echo-parity.spec.ts). This Node driver replays the SAME frame and
 * intents through the same core and compares canonical strings byte-for-byte.
 * This is cross-runtime parity, not the earlier Node-only determinism check.
 *
 * SCOPE (Lead ruling, Tester p3a-final): strict byte parity covers the
 * core-managed actors (player, echo, core drones) and the core-owned target
 * state. The non-drone hunter in the rendered export is a STATIC core target:
 * its legacy FSM/AI decision loop is deliberately idle and out of parity scope
 * (legacy decisions still live in the rendered adapter). No legacy command is
 * replayed here as if both runtimes had decided it, and no target field is
 * ignored to hide a difference. Legacy target SELECTION/damage is instead
 * proven in tests/p3a-enemy-target.spec.ts (real rendered World).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HeadlessWorld } from '../src/ai-native/worldHeadless';
import type { SimulationState } from '../src/world/sim/core';

const dir = path.resolve('reports/ai-native-02/p3a/parity');
const initial = JSON.parse(readFileSync(path.join(dir, 'initial.json'), 'utf8')) as SimulationState;
const sequence = JSON.parse(readFileSync(path.join(dir, 'sequence.json'), 'utf8')) as Array<{
  ticks: number; intent: any; echoIntent: any;
}>;
const rendered = JSON.parse(readFileSync(path.join(dir, 'rendered.json'), 'utf8')) as {
  canonical: string; events: string; eventTypes: string[]; finalTick: number;
  echoHp: number | null; droneHp: number; enteredRooms: number[];
};

const fail = (message: string): never => { process.stderr.write(`FAIL ${message}\n`); process.exit(1); };
const log = (line: string): void => { process.stdout.write(`${line}
`); };
function assert(condition: unknown, message: string): asserts condition { if (!condition) fail(message); }

function replay(): { canonical: string; events: string; tick: number; echoHp: number | null } {
  const world = HeadlessWorld.fromSimulationState(initial, rendered.enteredRooms);
  for (const step of sequence) {
    world.runSteps([{ ticks: step.ticks, intent: step.intent, echoIntent: step.echoIntent }], step.ticks);
  }
  const state = world.state;
  return {
    canonical: world.canonicalState(),
    events: world.canonicalEvents(),
    tick: world.tick,
    echoHp: state.echo?.data.hp ?? null
  };
}

const first = replay();
const second = replay();
assert(first.canonical === second.canonical, 'headless replay state diverged');
assert(first.events === second.events, 'headless replay events diverged');
assert(first.canonical === rendered.canonical, `rendered/headless canonical mismatch: ${first.canonical.slice(0, 120)} vs ${rendered.canonical.slice(0, 120)}`);
assert(first.events === rendered.events, 'rendered/headless event bytes differ');
assert(first.tick === rendered.finalTick, 'rendered/headless final tick differs');
assert(first.echoHp === rendered.echoHp, 'rendered/headless echo HP differs');
assert(initial.echo !== undefined, 'initial frame has no echo actor');
for (const type of ['enemy-hit', 'enemy-died', 'echo-fired', 'echo-hurt', 'loot-dropped', 'loot-collected']) {
  assert(rendered.eventTypes.includes(type), `rendered evidence missing ${type}`);
}
assert(rendered.events.includes('byActorId'), 'non-drone hit attribution missing from events');
assert(rendered.events.includes('"actorId":1'), 'echo actorId missing from events');
assert(sequence.every((step) => step.echoIntent), 'every ordered tick has an echo intent');
log('PASS rendered_vs_headless_echo_state | byte-equal canonical');
log('PASS rendered_vs_headless_echo_events | byte-equal full canonical events');
log('PASS echo_non_drone_death_loot_echo_hurt | all real event types present');
log(`P3A_ECHO_RENDERED_PARITY_PASS ticks=${first.tick} steps=${sequence.length} echoHp=${first.echoHp}`);
