// Does replay from a MID-RUN boundary frame compare history correctly, and is
// the saved event history immutable?
import { HeadlessWorld } from './src/ai-native/worldHeadless';
const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
const move = { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false };
let failures = 0; const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const w = new HeadlessWorld({ seed: 424242 });
// Create real history first (mid-run boundary, no manager active/queued involved).
w.runSteps([{ ticks: 20, intent: neutral }], 20);
const frame = w.snapshot();
const tickT = w.tick;
const steps = [{ ticks: 10, intent: move }, { ticks: 5, intent: neutral }];
w.runSteps(steps, 15);
const stateAfter = w.canonicalState();
const eventsAfter = w.canonicalEvents();
const replay = w.replay(frame, steps);
check('mid-run replay state matches', replay.sameState === true, { sameState: replay.sameState, tickT });
check('mid-run replay EVENTS match (full history vs subsequent-only)', replay.sameEvents === true, {
  sameEvents: replay.sameEvents, firstDivergence: replay.firstDivergence,
  expectedEventsHash: replay.expectedEventsHash, actualEventsHash: replay.actualEventsHash
});
check('mid-run replay firstDivergence is null', replay.firstDivergence === null, { firstDivergence: replay.firstDivergence });
console.log(`C3C_REPLAY_MID_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
