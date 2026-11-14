// AI-NATIVE-02 C2 round 2 — real-kill Node/Rendered parity check.
// Reads the initial state and controlled intent sequence produced by
// tests/c2-parity.spec.ts (normal stepFrame path), replays it in Node with the
// same core, and compares canonical state/events/rewards/post-kill shots.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  canonicalSimulationEvents, canonicalSimulationState, stepSimulationTicks,
  type SimEvent, type SimulationState
} from '../src/world/sim/core';

const dir = path.resolve('reports/ai-native-02/c2-fixes-round2/parity-kill');
const initial = JSON.parse(readFileSync(path.join(dir, 'kill-initial.json'), 'utf8')) as SimulationState;
const sequence = JSON.parse(readFileSync(path.join(dir, 'kill-sequence.json'), 'utf8')) as Array<{
  ticks: number; intent: any;
}>;
const rendered = JSON.parse(readFileSync(path.join(dir, 'kill-rendered.json'), 'utf8')) as {
  canonical: string; events: string; eventTypes: string[]; finalTick: number;
  xp: number; currency: number; dronesLeft: number; targetsLeft: number;
};

function run(start: SimulationState) {
  const state: SimulationState = JSON.parse(JSON.stringify(start)) as SimulationState;
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
const eventTypes = new Set(nodeA.events.map((e) => e.type));
const firstDeath = nodeA.events.findIndex((e) => e.type === 'enemy-died');
const postKillShot = firstDeath >= 0 && nodeA.events
  .slice(firstDeath + 1)
  .some((e) => e.type === 'player-fired');

const checks: Array<[string, boolean]> = [
  ['node-replay-state', nodeCanonical === replayCanonical],
  ['node-replay-events', nodeEvents === replayEvents],
  ['node-vs-rendered-state', nodeCanonical === rendered.canonical],
  ['node-vs-rendered-events', nodeEvents === rendered.events],
  ['node-final-tick', nodeA.state.tick === rendered.finalTick],
  ['real-kill-events', eventTypes.has('enemy-died') && eventTypes.has('enemy-hit')],
  ['core-reward-events', eventTypes.has('xp-gained')],
  ['xp-equals-rendered', nodeA.state.player.data.xp === rendered.xp],
  ['currency-equals-rendered', nodeA.state.player.data.currency === rendered.currency],
  ['xp-increased', nodeA.state.player.data.xp > initial.player.data.xp],
  ['drones-removed', nodeA.state.drones.length === 0 && rendered.dronesLeft === 0],
  ['targets-removed', nodeA.state.targets.length === 0 && rendered.targetsLeft === 0],
  ['post-kill-shot', postKillShot]
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
const failed = checks.filter(([, ok]) => !ok);
console.log(`KILL_PARITY_${failed.length === 0 ? 'PASS' : 'FAIL'} checks=${checks.length} failures=${failed.length}`);
if (failed.length > 0) {
  console.log('rendered-canonical', rendered.canonical);
  console.log('node-canonical', nodeCanonical);
  console.log('rendered-events', rendered.events);
  console.log('node-events', nodeEvents);
  process.exit(1);
}
