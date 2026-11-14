import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5355);
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.waitForTimeout(1000);
await page.evaluate(() => window.__game.scene.start('GameScene', { seed: 424242 }));
await page.waitForTimeout(1000);
const result = await page.evaluate(() => {
  const w = window.__game.scene.getScene('GameScene').world;
  const out = {};
  try { w.resetProjectilesForTest(); out.projectileHelper = 'allowed'; } catch (e) { out.projectileHelper = String(e); }
  try { w.clearEnemiesForTest(); out.enemyHelper = 'allowed'; } catch (e) { out.enemyHelper = String(e); }
  return out;
});
console.log(JSON.stringify(result));
await browser.close();
