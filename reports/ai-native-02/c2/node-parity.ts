// AI-NATIVE-02 C2 — true Node/Rendered parity check.
// Reads the initial state and controlled intent sequence produced by the
// rendered Playwright test, replays the same ticks in Node (vite-node), and
// compares canonical state + ordered events. No Phaser/DOM is imported here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  canonicalSimulationEvents, canonicalSimulationState, stepSimulationTicks,
  type SimEvent, type SimulationState
} from '../../../src/world/sim/core';

const dir = path.resolve('reports/ai-native-02/c2/parity');
const initial = JSON.parse(readFileSync(path.join(dir, 'parity-initial.json'), 'utf8')) as SimulationState;
const sequence = JSON.parse(readFileSync(path.join(dir, 'parity-sequence.json'), 'utf8')) as Array<{
  ticks: number; intent: any;
}>;
const rendered = JSON.parse(readFileSync(path.join(dir, 'parity-rendered.json'), 'utf8')) as {
  canonical: string; events: string; finalTick: number; eventTypes: string[];
};

function run(start: SimulationState) {
  let state: SimulationState = JSON.parse(JSON.stringify(start)) as SimulationState;
  const events: SimEvent[] = [];
  for (const step of sequence) events.push(...stepSimulationTicks(state, step.ticks, step.intent));
  return { state, events };
}

const nodeA = run(initial);
const nodeB = run(initial);
const nodeCanonical = canonicalSimulationState(nodeA.state);
const nodeEvents = canonicalSimulationEvents(nodeA.events);
const replayCanonical = canonicalSimulationState(nodeB.state);
const replayEvents = canonicalSimulationEvents(nodeB.events);

const checks: Array<[string, boolean]> = [
  ['node-replay-state', nodeCanonical === replayCanonical],
  ['node-replay-events', nodeEvents === replayEvents],
  ['node-vs-rendered-state', nodeCanonical === rendered.canonical],
  ['node-vs-rendered-events', nodeEvents === rendered.events],
  ['node-final-tick', nodeA.state.tick === rendered.finalTick],
  ['seed-present', typeof initial.seed === 'number'],
  ['rng-state-present', typeof nodeA.state.rngState === 'number'],
  ['real-combat-events', rendered.eventTypes.includes('player-fired') && rendered.eventTypes.includes('enemy-hit')]
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
const failed = checks.filter(([, ok]) => !ok);
console.log(`PARITY_${failed.length === 0 ? 'PASS' : 'FAIL'} checks=${checks.length} failures=${failed.length}`);
if (failed.length > 0) {
  console.log('rendered-canonical', rendered.canonical);
  console.log('node-canonical', nodeCanonical);
  console.log('rendered-events', rendered.events);
  console.log('node-events', nodeEvents);
  process.exit(1);
}
