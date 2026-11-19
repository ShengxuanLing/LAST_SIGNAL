// Independent loot-magnet probe (780cece, running game): default pickupRange must NOT vacuum a
// drop 18 tiles away; a near drop must be collected; a wide magnet may collect far loot.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5296/';
const out = { meta: { url: BASE, target: '780cece' }, checks: [], steps: [], errors: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') out.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => out.errors.push(`pageerror: ${e.message}`));
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(() => { const m = (window).__game.scene.getScene('MainMenuScene'); const o = m.scene.start.bind(m.scene); m.scene.start = (k, d) => k === 'GameScene' ? o(k, { ...(d || {}), seed: 424242 }) : o(k, d); });
const b = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(b.x + (640 * b.w) / 1280, b.y + (340 * b.h) / 720);
await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'));
await page.waitForTimeout(1400);

for (const dist of [18, 5]) {
  const r = await page.evaluate(async (dist) => {
    const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
    const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
    const before = w.sim.player.data.currency;
    w.spawnLoot(w.sim.player.x + dist, w.sim.player.y, 'currency', 'currency', 10);
    for (let i = 0; i < 90; i++) {
      w.resetSimulationAccumulator();
      w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    }
    await sleep(200);
    const res = { loot: w.loot.length, lootViews: w.loot.length, currency: w.sim.player.data.currency, before, collected: w.sim.player.data.currency > before, pickupRange: w.sim.player.data.pickupRange };
    w.clearLootForTest();
    return res;
  }, dist);
  out.steps.push({ name: `loot-${dist}`, detail: r });
  if (dist === 18) check('default-magnet-keeps-18-tile-loot', r.loot === 1 && r.collected === false, r);
  else check('near-5-tile-loot-collected', r.collected === true && r.loot === 0, r);
}
out.errors.length === 0 && check('no-console-error', true);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-resume-final/loot-magnet-log.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
