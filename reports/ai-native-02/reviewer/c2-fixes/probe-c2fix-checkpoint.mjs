// Independent reviewer probe: checkpoint coreState restore + old-save fallback (dev server).
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
  const { RNG } = await import('/src/core/random.ts');
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  for (const rm of w.map.rooms) { if (rm.kind !== 'boss') { rm.spawned = true; rm.cleared = true; } }
  w.enemies = []; w.boss = null; w.won = false;
  w.resetSimulationAccumulator();
  for (let i = 0; i < 40; i++) w.stepFrame(1000 / 60 + 1e-6, neutral);
  const frame = w.captureCheckpoint('h3-probe', w.map.seed, { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 });
  const before = { tick: w.sim.tick, rng: w.sim.rngState, pid: w.sim.nextProjectileId, dash: w.sim.player.dashTimer };
  w.sim.tick = 9999; w.sim.rngState = 1; w.sim.nextProjectileId = 1; w.sim.player.dashTimer = 0;
  const ok = w.restoreCheckpoint(frame);
  const after = { tick: w.sim.tick, rng: w.sim.rngState, pid: w.sim.nextProjectileId, dash: w.sim.player.dashTimer };
  const oldFrame = JSON.parse(JSON.stringify(frame));
  delete oldFrame.coreState;
  const okOld = w.restoreCheckpoint(oldFrame);
  const expectedOldRng = new RNG(oldFrame.seed * 7919 + 1).snapshot();
  return {
    captured: !!frame?.coreState, ok, before, after,
    okOld, oldTick: w.sim.tick, oldRng: w.sim.rngState, expectedOldRng, oldPid: w.sim.nextProjectileId,
  };
});
console.log(JSON.stringify({ ...result, pageErrors: errors }, null, 2));
await browser.close();
