// Independent reviewer probe: normal World.stepFrame path vs direct core ticks (frozen 4cf1bc8).
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5345);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__game.scene.start('GameScene', { seed: 424242 }));
await page.waitForTimeout(1200);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const result = await page.evaluate(async () => {
  const mod = await import('/src/world/sim/core.ts');
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const p = w.player;
  const room = w.currentRoom();
  let spot = null;
  for (const d of [3, -3, 2, -2]) {
    const x = p.wx + d, y = p.wy;
    if (w.isWalkable(x, y, 0.5)) { spot = { x, y }; break; }
  }
  if (!spot) spot = { x: p.wx, y: p.wy + 3 };
  w.spawnEnemy('drone', spot.x, spot.y, room.id, 1);
  const initial = JSON.parse(JSON.stringify(w.sim));
  const sequence = [
    { n: 20, intent: { move: { x: 1, y: 0 }, dash: false, fire: false, aim: null, interact: false } },
    { n: 120, intent: { move: { x: 0, y: 0 }, dash: false, fire: true, aim: { x: spot.x, y: spot.y }, interact: false } },
    { n: 12, intent: { move: { x: -1, y: 0 }, dash: false, fire: false, aim: null, interact: false } }
  ];
  // A) normal World.stepFrame path, one tick per call.
  w.resetSimulationAccumulator();
  for (const step of sequence) {
    for (let i = 0; i < step.n; i++) w.stepFrame(1000 / 60, step.intent);
  }
  const stepFrameCanonical = mod.canonicalSimulationState(w.sim);
  const stepFrameTick = w.sim.tick;
  // B) direct core ticks on a fresh clone of the same initial state.
  const clone = JSON.parse(JSON.stringify(initial));
  for (const step of sequence) mod.stepSimulationTicks(clone, step.n, step.intent);
  const coreCanonical = mod.canonicalSimulationState(clone);
  return {
    paused: gs.paused,
    stepFrameTick,
    coreTick: clone.tick,
    canonicalEqual: stepFrameCanonical === coreCanonical,
    stepFrameLen: stepFrameCanonical.length,
    coreLen: coreCanonical.length,
    stepFrameHead: stepFrameCanonical.slice(0, 180),
    coreHead: coreCanonical.slice(0, 180),
    accumulator: w.simAccumulatorMs,
  };
});
console.log(JSON.stringify({ ...result, pageErrors: errors }, null, 2));
await browser.close();
