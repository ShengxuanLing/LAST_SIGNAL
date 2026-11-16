// Independent reviewer probe: after a real core kill, does Rendered canonical still match Node/core?
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5351);
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
  for (const d of [3, -3, 2, -2]) { const x = p.wx + d, y = p.wy; if (w.isWalkable(x, y, 0.5)) { spot = { x, y }; break; } }
  if (!spot) spot = { x: p.wx, y: p.wy + 3 };
  const drone = w.spawnEnemy('drone', spot.x, spot.y, room.id, 1);
  drone._hp = 20;
  const initial = JSON.parse(JSON.stringify(w.sim));
  const fire = { move: { x: 0, y: 0 }, dash: false, fire: true, aim: spot, interact: false };
  // Rendered: NORMAL stepFrame ticks until killed (150).
  w.resetSimulationAccumulator();
  for (let i = 0; i < 150; i++) w.stepFrame(1000 / 60 + 1e-6, fire);
  const rendered = mod.canonicalSimulationState(w.sim);
  const renderedEvents = w.sim; // not used
  const renderedXp = w.sim.player.data.xp;
  const renderedCurrency = w.sim.player.data.currency;
  const stillInWorld = w.enemies.some((e) => e._id === drone._id);
  // Core: clone initial and same 150 direct ticks.
  const clone = JSON.parse(JSON.stringify(initial));
  const events = mod.stepSimulationTicks(clone, 150, fire);
  const core = mod.canonicalSimulationState(clone);
  return {
    equal: rendered === core,
    renderedXp, renderedCurrency, stillInWorld,
    coreXp: clone.player.data.xp, coreCurrency: clone.player.data.currency,
    renderedLen: rendered.length, coreLen: core.length,
    renderedHead: rendered.slice(0, 220), coreHead: core.slice(0, 220),
    eventTypes: [...new Set(events.map((e) => e.type))],
  };
});
console.log(JSON.stringify({ ...result, pageErrors: errors }, null, 2));
await browser.close();
