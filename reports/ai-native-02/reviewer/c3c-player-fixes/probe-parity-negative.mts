// Independent negative control: the rendered<->headless parity is sensitive to a
// real divergence (exact sequence matches; a mutated sequence does not).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HeadlessWorld } from './src/ai-native/worldHeadless';
const dir = path.resolve('reports/ai-native-02/c3c/parity');
const initial = JSON.parse(readFileSync(path.join(dir, 'initial.json'), 'utf8'));
const sequence = JSON.parse(readFileSync(path.join(dir, 'sequence.json'), 'utf8'));
const rendered = JSON.parse(readFileSync(path.join(dir, 'rendered.json'), 'utf8'));
const run = (seq: any[]) => {
  const w = HeadlessWorld.fromSimulationState(initial, []);
  for (const s of seq) w.runSteps([{ ticks: s.ticks, intent: s.intent }], s.ticks);
  return { canonical: w.canonicalState(), events: w.canonicalEvents() };
};
let failures = 0; const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const exact = run(sequence);
check('exact sequence matches rendered canonical', exact.canonical === rendered.canonical);
check('exact sequence matches rendered events', exact.events === rendered.events);
// Mutate one real input (flip the first move direction).
const mutated = sequence.map((s: any) => ({ ...s, intent: { ...s.intent, fire: false } }));
const neg = run(mutated);
check('NEGATIVE: mutated input changes canonical (parity is sensitive)', neg.canonical !== rendered.canonical);
check('NEGATIVE: mutated input changes events', neg.events !== rendered.events);
console.log(`C3C_PARITY_NEG_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
