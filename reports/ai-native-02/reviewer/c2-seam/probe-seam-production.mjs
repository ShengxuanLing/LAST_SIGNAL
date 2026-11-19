// Production-gate probe: run against frozen production build preview.
// Asserts (a) dev fixtures throw 'dev/test only' in production,
// (b) enqueue* queue-only (no synchronous core write),
// (c) processPendingCommands is un-gated and callable in production (the seam hole).
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5376);
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
await page.waitForTimeout(350);

const result = await page.evaluate(() => {
  const g = window.__game;
  const w = g.scene.getScene('GameScene').world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const snap = () => ({ hp: w.sim.player.data.hp, currency: w.sim.player.data.currency,
    pendingCommands: w.sim.pendingCommands.length, tick: w.sim.tick });
  const tryCall = (fn) => { try { fn(); return 'no-throw'; } catch (e) { return String(e); } };

  const fixtureGating = {};
  for (const name of ['simFixture', 'playerDataFixture', 'setPlayerPositionForTest', 'clearLootForTest',
    'clearEnemiesForTest', 'resetProjectilesForTest', 'stepSimulationTicksForTest']) {
    fixtureGating[name] = tryCall(() => w[name]);
  }

  // processPendingCommands must exist and be callable (not gated) in production.
  const processPendingGated = tryCall(() => w.processPendingCommands());

  // enqueue* must be queue-only in production: no synchronous hp/currency write.
  const before = snap();
  tryCall(() => w.enqueueHeal(50));
  tryCall(() => w.enqueueCurrency(10));
  tryCall(() => w.enqueueAddXp(1));
  const afterQueue = snap();

  // tick must not have advanced just by enqueueing.
  let tickAdvanced = false;
  try { const ev = w.stepFrame(1000 / 60 + 1e-6, neutral); tickAdvanced = true; } catch (_) { tickAdvanced = false; }
  const afterTick = snap();

  return { paused: g.scene.getScene('GameScene').paused, fixtureGating, processPendingGated,
    before, afterQueue, afterTick };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
