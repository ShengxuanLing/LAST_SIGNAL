// Triage probe: is the 42-currency loot from checkpoint.spec.ts:185 ever COLLECTED?
// The fixture spawns loot at the player position; pickup now happens in stepLoot with
// a PLAYER_RADIUS+12 threshold and a magnet pull. Observe the loot lifecycle.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5291/';
const out = { meta: { url: BASE, target: '5f49b24', case: 'checkpoint.spec.ts:185 loot/currency lifecycle' }, steps: [], findings: [] };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await page.evaluate(() => {
  const g = window.__game, m = g.scene.getScene('MainMenuScene');
  const o = m.scene.start.bind(m.scene);
  m.scene.start = (k, d) => k === 'GameScene' ? o(k, { ...(d || {}), seed: 424242 }) : o(k, d);
});
await page.mouse.click(640, 340);
await page.waitForFunction(() => (window).__game.scene.isActive('GameScene'));
await page.waitForTimeout(1200);
const lifecycle = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const { world } = (window).__game.scene.getScene('GameScene');
  const live = world.simFixture;
  const before = { currency: world.player.data.currency, loot: live.loot.length, tick: live.tick, pos: { x: live.player.x, y: live.player.y } };
  world.spawnLoot(live.player.x, live.player.y, 'currency', 'currency', 42);
  const queued = { pending: live.pendingCommands.map((c) => c.type), loot: live.loot.length, currency: world.player.data.currency };
  const timeline = [];
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    const s = {
      tick: live.tick, loot: live.loot.length, lootViews: world.loot.length,
      currency: world.player.data.currency, pending: live.pendingCommands.map((c) => c.type),
      pos: { x: Number(live.player.x.toFixed(3)), y: Number(live.player.y.toFixed(3)) },
      pickupRange: live.player.data.pickupRange,
      dist: live.loot.length ? Number(Math.hypot(live.player.x - live.loot[0].x, live.player.y - live.loot[0].y).toFixed(3)) : null
    };
    timeline.push(s);
    if (s.currency > before.currency) break;
  }
  const last = timeline[timeline.length - 1];
  return { before, queued, timeline: timeline.slice(0, 8), last, collected: last.currency > before.currency };
});
out.steps.push({ name: 'loot-lifecycle', detail: lifecycle });
out.findings.push({
  name: 'spawned-loot-collectability',
  detail: lifecycle,
  note: 'world.spawnLoot now only queues a spawn-loot command; the drop is created on the next tick and then follows the normal stepLoot magnet/pickup rules'
});
out.errors = errors;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-seam-triage/triage-loot-lifecycle.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
