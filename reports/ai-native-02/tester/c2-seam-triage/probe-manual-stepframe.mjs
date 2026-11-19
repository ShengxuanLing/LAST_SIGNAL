// Triage probe: does a manual stepFrame commit the queued equip/upgrade while the
// inventory/level-up overlay is open (i.e. is the command pending or lost)?
// Read-only inspection of live core state through the dev-only simFixture.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5291/';
const out = { meta: { url: BASE, target: '5f49b24', case: 'manual stepFrame while overlay open' }, equip: null, upgrade: null, findings: [] };
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
  localStorage.setItem('last_signal_save_v1', JSON.stringify({ permanent: { unlockedWeapons: ['pulse', 'scatter', 'plasma'] } }));
});
const b = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(b.x + (640 * b.w) / 1280, b.y + (340 * b.h) / 720);
await page.waitForTimeout(1400);

// --- equip: click while the inventory overlay is open, then manually step ---
await page.keyboard.press('i');
await page.waitForTimeout(600);
await page.mouse.click(420, 242);
out.equip = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const live = w.simFixture;
  const before = { weapon: gs.world.player.data.weaponKey, pending: live.pendingCommands.map((c) => c.type), tick: live.tick, paused: gs.paused };
  // manual normal tick exactly like the test does
  w.resetSimulationAccumulator();
  const ev = w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  const after = { weapon: gs.world.player.data.weaponKey, pending: live.pendingCommands.map((c) => c.type), tick: live.tick, paused: gs.paused, events: ev.map((e) => e.type) };
  const scene = g.scene.getScene('PauseScene');
  const labels = scene.children.list.filter((c) => c.type === 'Text' && ['EQUIP', 'EQUIPPED'].includes(c.text)).map((c) => ({ label: c.text, y: c.y, enabled: c.input?.enabled ?? false }));
  return { before, after, labels };
});

// --- upgrade: open the level-up overlay, press 3, then manually step ---
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const pl = gs.world.player;
  pl.world.playerDataFixture.xp = 0; pl.world.playerDataFixture.xpToNext = 30; pl.addXp(30);
});
await page.waitForTimeout(900);
const lvl = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const ls = g.scene.getScene('LevelUpScene');
  const live = gs.world.simFixture;
  return { active: g.scene.isActive('LevelUpScene'), choices: ls?.choices ?? [], upgrades: gs.world.player.data.upgrades.length, pending: live.pendingCommands.map((c) => c.type), tick: live.tick, paused: gs.paused };
});
await page.keyboard.press('3');
await page.waitForTimeout(400);
const afterKey = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const live = gs.world.simFixture;
  return { upgrades: gs.world.player.data.upgrades.length, pending: live.pendingCommands.map((c) => c.type), tick: live.tick, levelUpActive: g.scene.isActive('LevelUpScene'), paused: gs.paused };
});
const afterManual = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const live = w.simFixture;
  w.resetSimulationAccumulator();
  const ev = w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  return { upgrades: gs.world.player.data.upgrades.length, pending: live.pendingCommands.map((c) => c.type), tick: live.tick, events: ev.map((e) => e.type), damage: gs.world.player.data.damage, speed: gs.world.player.data.speed };
});
out.upgrade = { lvl, afterKey, afterManual };
out.findings.push({
  name: 'manual-stepFrame-inside-overlay',
  note: 'the test already issues a manual stepFrame after the click; whether the command commits depends on whether the core tick actually runs while the overlay is open',
  equip: out.equip, upgrade: { lvl: out.upgrade.lvl, afterKey: out.upgrade.afterKey, afterManual: out.upgrade.afterManual }
});
out.errors = errors;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-seam-triage/triage-manual-stepframe.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
