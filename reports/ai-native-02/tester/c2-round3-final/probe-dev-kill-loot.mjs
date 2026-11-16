// Dev-only rendered probe: visible kill loot at a distance (no instant pickup).
// Fixture declared: simFixture live-core access + one injected player projectile;
// normal stepFrame ticks drive the kill and pickup. Production throws on simFixture.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5289/';
const report = { meta: { url: BASE, target: '6ac60b2', devOnlyFixture: 'simFixture + injected projectile', startedUtc: new Date().toISOString() }, checks: [], flow: {}, errors: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) process.exitCode = 1; };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await page.evaluate(() => {
  const g = window.__game, menu = g.scene.getScene('MainMenuScene');
  const orig = menu.scene.start.bind(menu.scene);
  menu.scene.start = (key, data) => key === 'GameScene' ? orig(key, { ...(data || {}), seed: 424242 }) : orig(key, data);
});
const b = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(b.x + (640 * b.w) / 1280, b.y + (340 * b.h) / 720);
await page.waitForTimeout(1400);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
const result = await page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene'), w = gs.world;
  const sim = w.simFixture; // dev-only live core
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  const step = () => w.stepFrame(1000 / 60 + 1e-6, neutral);
  const tiles = [];
  for (const row of sim.map.tiles) for (const t of row) {
    if ((t.type === 'floor' || t.type === 'spawn') && w.isWalkable(t.x, t.y, 0.5)) tiles.push({ x: t.x, y: t.y });
  }
  const start = tiles[0];
  let far = null;
  for (const t of tiles) if (Math.hypot(t.x - start.x, t.y - start.y) > 90) { far = t; break; }
  if (!far) return { available: false };
  w.enqueueTeleport(start.x, start.y, false);
  w.enqueueSpawnEnemy('hunter', far.x, far.y, w.currentRoom()?.id ?? 0, 1);
  step();
  const enemy = w.enemies[w.enemies.length - 1];
  w.enqueueTargetHp(enemy._id, 1);
  step();
  const currency0 = sim.player.data.currency;
  sim.projectiles.push({
    id: sim.nextProjectileId++, ownerId: 0, side: 'player', source: 'player', kind: 'pulse',
    pos: { x: far.x, y: far.y }, vel: { x: 0, y: 0 }, damage: 999, lifetime: 1, radius: 0.2,
    crit: false, pierce: 0, hitIds: []
  });
  const killEvents = step().map((e) => e.type);
  const visible = w.loot.length;
  const coreLoot = sim.loot.length;
  const currencyAfterKill = sim.player.data.currency;
  // Move via legal teleport command near the drop, then one normal tick settles it.
  let near = null;
  for (const t of tiles) { const d = Math.hypot(t.x - far.x, t.y - far.y); if (d > 0 && d < 10) { near = t; break; } }
  w.enqueueTeleport(near.x, near.y, false);
  const collectEvents = step().map((e) => e.type);
  return {
    available: true, far, start, near, killEvents, visible, coreLoot,
    currency0, currencyAfterKill, currencyAfterCollect: sim.player.data.currency,
    collectEvents, lootViewsAfter: w.loot.length, coreLootAfter: sim.loot.length
  };
});
report.flow = result;
check('far-kill-fixture-available', result.available === true, result);
check('far-kill-emits-loot-dropped', result.killEvents?.includes('enemy-died') && result.killEvents?.includes('loot-dropped'), result.killEvents);
check('far-kill-loot-visible-and-uncollected', result.visible >= 1 && result.coreLoot >= 1 && result.currencyAfterKill === result.currency0, result);
check('moving-collects-kill-loot', result.collectEvents?.includes('loot-collected') && result.currencyAfterCollect > result.currencyAfterKill && result.lootViewsAfter === 0, result);
check('no-console-error', report.errors.length === 0, report.errors);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-round3-final/dev-kill-loot-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
