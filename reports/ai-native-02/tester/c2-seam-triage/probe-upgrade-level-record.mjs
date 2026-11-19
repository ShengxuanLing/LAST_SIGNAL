// Triage probe: the audit.spec.ts:65 upgrade failure — is it a missing tick barrier or a
// real product defect? Compare the queued-command path with the C1-era behaviour by
// checking (a) the command is queued, (b) who commits it, (c) whether the committed
// upgrade is visible in player.data.upgrades.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5291/';
const out = { meta: { url: BASE, target: '5f49b24', case: 'upgrade commit ownership' }, steps: [], findings: [] };
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
await page.evaluate(() => {
  const gs = (window).__game.scene.getScene('GameScene');
  const pl = gs.world.player;
  pl.world.playerDataFixture.xp = 0; pl.world.playerDataFixture.xpToNext = 30; pl.addXp(30);
});
await page.waitForTimeout(900);
const st0 = await page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene'), live = gs.world.simFixture;
  return { active: g.scene.getScenes(true).map((s) => s.sys.settings.key), choices: g.scene.getScene('LevelUpScene').choices, upgrades: gs.world.player.data.upgrades.length, pending: live.pendingCommands.map((c) => c.type), tick: live.tick };
});
out.steps.push({ name: 'levelup-open', detail: st0 });
const btn = await page.evaluate(() => {
  const ls = (window).__game.scene.getScene('LevelUpScene');
  return ls.buttons[0] ? { x: ls.buttons[0].x, y: ls.buttons[0].y } : null;
});
await page.mouse.click(Math.round(btn.x), Math.round(btn.y));
const timeline = [];
for (let i = 0; i < 30; i++) {
  const s = await page.evaluate(() => {
    const g = window.__game, gs = g.scene.getScene('GameScene'), live = gs.world.simFixture;
    const d = gs.world.player.data;
    return {
      upgrades: d.upgrades.length, upgradeKeys: d.upgrades.map((u) => u.key),
      pending: live.pendingCommands.map((c) => c.type), tick: live.tick,
      levelUpActive: g.scene.isActive('LevelUpScene'), paused: gs.paused,
      dmg: d.damage, speed: d.speed, maxHp: d.maxHp
    };
  });
  timeline.push(s);
  if (s.upgrades > 0) break;
  await page.waitForTimeout(80);
}
out.steps.push({ name: 'after-click-timeline', detail: { first: timeline[0], last: timeline[timeline.length - 1], committed: timeline.findIndex((t) => t.upgrades > 0), samples: timeline.slice(0, 6) } });
// Manual tick while the overlay is still open (what a test could legally do)
const manual = await page.evaluate(() => {
  const gs = (window).__game.scene.getScene('GameScene'), w = gs.world, live = w.simFixture;
  const before = { upgrades: w.player.data.upgrades.length, pending: live.pendingCommands.map((c) => c.type), tick: live.tick, paused: gs.paused };
  w.resetSimulationAccumulator();
  const ev = w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  return { before, after: { upgrades: w.player.data.upgrades.length, upgradeKeys: w.player.data.upgrades.map((u) => u.key), pending: live.pendingCommands.map((c) => c.type), tick: live.tick, events: ev.map((e) => e.type), dmg: w.player.data.damage, speed: w.player.data.speed } };
});
out.steps.push({ name: 'manual-tick-while-overlay', detail: manual });
out.findings.push({
  name: 'upgrade-level-not-recorded-in-player-data.upgrades',
  detail: { st0, timeline: { first: timeline[0], last: timeline[timeline.length - 1], committedIndex: timeline.findIndex((t) => t.upgrades > 0) }, manual },
  note: 'core case apply-upgrade calls applyUpgrade(def, state.player.data, level) which only runs def.apply(state, level); it never records data.upgrades.push({key, level}). The 6ac60b2 parent used applyUpgradeToPlayer() which did both. So player.data.upgrades stays empty forever: the upgrade stat IS applied (damage/speed/maxHp change) but the level list is lost.'
});
out.errors = errors;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-seam-triage/triage-upgrade-level-record.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
