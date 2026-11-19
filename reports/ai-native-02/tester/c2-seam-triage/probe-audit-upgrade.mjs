// Triage probe: LevelUp upgrade command commit timing (audit.spec.ts:65 failure).
// Compares the immediate read (test's current expectation) with the state after a
// normal resumed tick. Read-only: no state writes beyond the game's own UI click.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5291/';
const out = { meta: { url: BASE, target: '5f49b24', case: 'audit.spec.ts:65 upgrade count' }, samples: [], findings: [] };
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
const b = await page.evaluate(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.mouse.click(b.x + (640 * b.w) / 1280, b.y + (340 * b.h) / 720);
await page.waitForTimeout(1500);
// Same fixture as audit.spec.ts:8
await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const pl = gs.world.player;
  pl.world.playerDataFixture.xp = 0; pl.world.playerDataFixture.xpToNext = 30; pl.addXp(30);
});
await page.waitForTimeout(800);
const before = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const d = gs.world.player.data;
  return { levelUpActive: g.scene.isActive('LevelUpScene'), upgrades: d.upgrades.length, tick: gs.world.simFixture?.tick ?? null, pending: gs.world.simFixture?.pendingCommands.length ?? null, paused: gs.paused };
});
const buttons = await page.evaluate(() => {
  const g = window.__game;
  const ls = g.scene.getScene('LevelUpScene');
  return (ls?.buttons ?? []).map((x) => ({ x: x.x, y: x.y }));
});
await page.mouse.click(Math.round(buttons[0].x), Math.round(buttons[0].y));
// Sample the upgrade count over time: immediate, then every 50ms.
const timeline = [];
for (let i = 0; i < 24; i++) {
  const s = await page.evaluate(() => {
    const g = window.__game;
    const gs = g.scene.getScene('GameScene');
    const live = gs.world.simFixture;
    return {
      t: Date.now(), upgrades: gs.world.player.data.upgrades.length,
      levelUpActive: g.scene.isActive('LevelUpScene'), paused: gs.paused,
      tick: live?.tick ?? null, pending: live?.pendingCommands.length ?? null,
      pendingKinds: live?.pendingCommands.map((c) => c.type) ?? []
    };
  });
  timeline.push(s);
  if (s.upgrades > before.upgrades && i > 1) break;
  await page.waitForTimeout(50);
}
out.samples = { before, buttons, timeline };
const firstUpgradeAt = timeline.findIndex((t) => t.upgrades > before.upgrades);
out.findings.push({
  name: 'upgrade-commit-is-deferred-to-next-core-tick',
  immediateAfterClick: timeline[0], firstUpgradeSampleIndex: firstUpgradeAt,
  firstUpgradeSample: firstUpgradeAt >= 0 ? timeline[firstUpgradeAt] : null,
  note: firstUpgradeAt < 0 ? 'upgrade never committed within 1.2s' : 'the command is queued by LevelUpScene.choose() and committed by the next normal tick; an immediate read after the click sees 0'
});
out.errors = errors;
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-seam-triage/triage-audit-upgrade.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
