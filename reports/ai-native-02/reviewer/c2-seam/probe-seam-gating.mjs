// Focused per-method fixture gating check on frozen production preview.
import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5376);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
  const tryCall = (fn) => { try { fn(); return 'NO-THROW'; } catch (e) { return String(e); } };
  const names = ['simFixture','playerDataFixture','stepSimulationTicksForTest','setPlayerPositionForTest','clearLootForTest','clearEnemiesForTest','resetProjectilesForTest','processPendingCommands'];
  const out = {};
  for (const n of names) out[n] = tryCall(() => w[n]());
  return out;
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
