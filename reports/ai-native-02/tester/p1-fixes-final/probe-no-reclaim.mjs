// Independent probe #6 for 1aadd2e: takeover inside the inventory overlay, then closing
// the overlay must NOT re-grab the AI (no self-reclaim). NO fixture, no state writes.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5283/';
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-fixes-final/evidence-noreclaim';
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
    authorityPaused: c.paused, gamePaused: gs.paused, takeoverCount: c.takeoverCount,
    takeoverReason: c.lastTakeoverReason, actionCount: c.aiActionCount,
    txtControl: gs.txtControl.text, txtAiAction: gs.txtAiAction.text,
    grid: { x: Number(pl.wx.toFixed(3)), y: Number(pl.wy.toFixed(3)) }
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

// Open the inventory (I), then a single movement key must take over while it stays open.
await page.keyboard.press('KeyI'); await page.waitForTimeout(600);
step('inventory-open', await snap());
await page.keyboard.press('KeyW'); await page.waitForTimeout(500);
const during = await snap();
step('takeover-inside-inventory', during);
await page.screenshot({ path: path.join(OUT, '01-takeover-inside-inventory.png') });

// Close the overlay with the CLOSE button -> must stay human, AI must not re-grab.
await clickLogical(640, GAME_H - 60); await page.waitForTimeout(900);
const closed = await snap();
await page.waitForTimeout(1800);
const later = await snap();
step('after-close', closed);
step('1.8s-later', later);
report.verdict = {
  takeoverInsideOverlay: during.owner === 'human' && during.aiEnabled === false && during.takeoverReason === 'human-input' && during.active.includes('PauseScene'),
  closedStaysHuman: closed.owner === 'human' && closed.aiEnabled === false,
  noSelfReclaim: later.owner === 'human' && later.aiEnabled === false && later.actionCount === during.actionCount
};
report.meta.endedUtc = new Date().toISOString();
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-fixes-final/no-reclaim-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
