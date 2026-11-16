// Independent probe #5 for 1aadd2e: does the control authority RESUME after the
// inventory overlay closes (ESC and CLOSE button), and can the human still act?
// NO fixture, no state writes. Read-only sampling + real key/button input.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5283/';
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-fixes-final/evidence-resume';
mkdirSync(OUT, { recursive: true });
const GAME_W = 1280, GAME_H = 720;
const report = { meta: { url: BASE, fixture: false, startedUtc: new Date().toISOString() }, steps: [], errors: [] };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
const box = () => page.evaluate(() => {
  const c = document.querySelector('canvas'); const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
async function clickLogical(lx, ly) {
  const b = await box(); await page.mouse.click(b.x + (lx * b.w) / GAME_W, b.y + (ly * b.h) / GAME_H);
}
const snap = () => page.evaluate(() => {
  const g = window.__game, gs = g.scene.getScene('GameScene');
  const active = g.scene.getScenes(true).map((s) => s.sys.settings.key);
  if (!gs || !gs.world) return { active, world: null };
  const pl = gs.world.player, c = pl.control.snapshot();
  return {
    active, world: true, owner: c.owner, aiEnabled: c.aiEnabled, mode: c.mode,
    authorityPaused: c.paused, gamePaused: gs.paused, actionCount: c.aiActionCount,
    takeoverCount: c.takeoverCount, txtControl: gs.txtControl.text,
    grid: { x: Number(pl.wx.toFixed(3)), y: Number(pl.wy.toFixed(3)) }, hp: pl.data.hp
  };
});
const step = (name, detail) => report.steps.push({ name, detail });

await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await clickLogical(640, 340); await page.waitForTimeout(1500);
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
await clickLogical(640, 540); await page.waitForTimeout(500); // AI CONTROL ON
await page.keyboard.press('Escape'); await page.waitForTimeout(800);
step('running', await snap());

// --- A) inventory via I key, close via ESC ---
await page.keyboard.press('KeyI'); await page.waitForTimeout(600);
step('A-inventory-open', await snap());
await page.keyboard.press('Escape');
for (const wait of [200, 400, 800, 1500]) { await page.waitForTimeout(wait === 200 ? 200 : wait - 200); step(`A-after-esc-${wait}ms`, await snap()); }
const a1 = await snap(); await page.waitForTimeout(2000); const a2 = await snap();
step('A-ai-activity-after-close', { actionCountBefore: a1.actionCount, actionCountAfter: a2.actionCount, mode: a2.mode, txtControl: a2.txtControl, gridBefore: a1.grid, gridAfter: a2.grid });
// human input must still work
await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD');
await page.waitForTimeout(300);
const a3 = await snap();
step('A-human-move-after-close', { gridBefore: a2.grid, gridAfter: a3.grid, moved: a3.grid.x !== a2.grid.x || a3.grid.y !== a2.grid.y, owner: a3.owner, mode: a3.mode });
await page.screenshot({ path: path.join(OUT, '01-after-inventory-esc-close.png') });

// --- B) inventory via pause-menu INVENTORY button, close via CLOSE button ---
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
await clickLogical(640, 360); await page.waitForTimeout(700); // INVENTORY (restart -> inventory mode)
step('B-inventory-open', await snap());
await clickLogical(640, GAME_H - 60); await page.waitForTimeout(900); // CLOSE button
step('B-after-close-button', await snap());
const b1 = await snap(); await page.waitForTimeout(2000); const b2 = await snap();
step('B-ai-activity-after-close', { actionCountBefore: b1.actionCount, actionCountAfter: b2.actionCount, mode: b2.mode, txtControl: b2.txtControl, gridBefore: b1.grid, gridAfter: b2.grid });
await page.screenshot({ path: path.join(OUT, '02-after-inventory-close-button.png') });

report.meta.endedUtc = new Date().toISOString();
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-fixes-final/resume-after-inventory-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
