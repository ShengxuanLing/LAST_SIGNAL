// Precise loot-magnet measurement (59aa852): place a currency drop N grid units away in a
// RUNNING (unpaused) game and measure the distance to the player over time.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5293/';
const out = { meta: { url: BASE, target: '59aa852', pickupRangeConfig: 90 }, trials: [], findings: [] };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.mouse.click(640, 340);
await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'));
await page.waitForTimeout(1200);

for (const dist of [20, 40, 85]) {
  const t = await page.evaluate(async (dist) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const gs = (window).__game.scene.getScene('GameScene'), w = gs.world, s = w.simFixture;
    const c0 = w.player.data.currency;
    w.enqueueSpawnLoot(s.player.x + dist, s.player.y, 'currency', 'currency', 10);
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await sleep(120);
      samples.push({
        tick: s.tick,
        loot: s.loot.length,
        currency: w.player.data.currency,
        d: s.loot[0] ? Number(Math.hypot(s.player.x - s.loot[0].x, s.player.y - s.loot[0].y).toFixed(2)) : null
      });
      if (w.player.data.currency > c0) break;
    }
    return { c0, currency: w.player.data.currency, collected: w.player.data.currency > c0, samples, pickupRange: s.player.data.pickupRange };
  }, dist);
  out.trials.push({ dist, ...t });
}
out.findings.push({
  name: 'magnet-radius-90-grid-units-swallows-far-drops',
  detail: out.trials,
  note: 'stepLoot uses p.data.pickupRange (config value 90) directly as a GRID distance for the magnet pull, so any drop within 90 grid units is dragged in and auto-collected within a fraction of a second while the game runs. The 5f49b24 report claim "20-tile far loot is NOT auto-picked up (20 > 12.5)" only holds if the magnet pull never runs (paused/zero-dt). The C1 pickup threshold (12.5 grid) is therefore not the effective pickup distance.'
});
out.errors = errors;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-current-triage/loot-magnet-log.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
