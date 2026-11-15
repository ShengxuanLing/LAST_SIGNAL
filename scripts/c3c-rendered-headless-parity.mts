// AI-NATIVE-02 C3-c — Rendered <-> Headless same-core canonical parity.
//
// Reads the initial `SimulationState`, the ordered intent sequence and the
// canonical state/events produced by the rendered World (Playwright spec
// `tests/c3c-headless-parity.spec.ts`), replays them with the SAME core through
// the headless runtime, and compares. No Phaser/DOM here.
//
// Run: npm run game:world:parity   (after the Playwright export spec)

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HeadlessWorld } from '../src/ai-native/worldHeadless';
import type { SimulationState } from '../src/world/sim/core';

const dir = path.resolve('reports/ai-native-02/c3c/parity');
const initial = JSON.parse(readFileSync(path.join(dir, 'initial.json'), 'utf8')) as SimulationState;
const sequence = JSON.parse(readFileSync(path.join(dir, 'sequence.json'), 'utf8')) as Array<{
  ticks: number; intent: any;
}>;
const rendered = JSON.parse(readFileSync(path.join(dir, 'rendered.json'), 'utf8')) as {
  canonical: string; events: string; eventTypes: string[]; finalTick: number;
  dronesLeft: number; projectilesLeft: number;
};

function run(seedEntered: number[] = []): { world: HeadlessWorld; canonical: string; events: string } {
  const world = HeadlessWorld.fromSimulationState(initial, seedEntered);
  for (const step of sequence) {
    world.runSteps([{ ticks: step.ticks, intent: step.intent }], step.ticks);
  }
  return { world, canonical: world.canonicalState(), events: world.canonicalEvents() };
}

function log(line: string): void { process.stdout.write(`${line}\n`); }
function fail(message: string): never { process.stderr.write(`FAIL ${message}\n`); process.exit(1); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) fail(message); }

const first = run();
const second = run([]);
const finalTick = first.world.tick;
const dronesLeft = first.world.state.drones.length;
const projectilesLeft = first.world.state.projectiles.length;

const checks: Array<[string, boolean]> = [
  ['headless-replay-state', first.canonical === second.canonical],
  ['headless-replay-events', first.events === second.events],
  ['rendered-vs-headless-state', first.canonical === rendered.canonical],
  ['rendered-vs-headless-events', first.events === rendered.events],
  ['rendered-vs-headless-final-tick', finalTick === rendered.finalTick],
  ['rendered-vs-headless-drones', dronesLeft === rendered.dronesLeft],
  ['rendered-vs-headless-projectiles', projectilesLeft === rendered.projectilesLeft],
  ['real-combat-events', rendered.eventTypes.includes('player-fired') && rendered.eventTypes.includes('drone-step')]
];

let failed = 0;
for (const [name, ok] of checks) {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}
if (failed > 0) fail(`${failed} parity check(s) failed`);
log(`C3C_RENDERED_HEADLESS_PARITY_PASS finalTick=${finalTick} events=${first.world.eventTotal}`);
