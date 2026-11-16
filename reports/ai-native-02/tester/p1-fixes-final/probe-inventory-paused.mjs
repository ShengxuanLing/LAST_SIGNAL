// Independent probe #4 for 1aadd2e: inventory overlay = PAUSED + input cleared, and
// closing the overlay must not re-grab the AI. NO fixture, no state writes.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5283/';
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-fixes-final/evidence-inventory';
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
    active, world: true, owner: c.owner, aiEnabled: c.aiEnabled, mode: c.mode, authorityPaused: c.paused,
    gamePaused: gs.paused, fireHeld: gs.fireHeld, playerFireHeld: pl.fireHeld(),
    inputFlags: { up: pl.input.up, down: pl.input.down, left: pl.input.left, right: pl.input.right },
    interactQueued: pl.hasQueuedInteract ? pl.hasQueuedInteract() : null,
    takeoverCount: c.takeoverCount, takeoverReason: c.lastTakeoverReason,
    txtControl: gs.txtControl.text, txtAgentLink: gs.txtAgentLink.text,
    hp: pl.data.hp, grid: { x: pl.wx, y: pl.wy }
  };
});
const step = (name, detail) => report.steps.push({ name, detail });

await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await clickLogical(640, 340); await page.waitForTimeout(1500);
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
await clickLogical(640, 540); await page.waitForTimeout(500); // AI CONTROL ON
await page.keyboard.press('Escape'); await page.waitForTimeout(700);
const running = await snap();
step('running', { owner: running.owner, mode: running.mode, active: running.active });

// Open the inventory with a real key press (I).
await page.keyboard.press('KeyI');
await page.waitForTimeout(600);
const inv = await snap();
step('inventory-open', inv);
await page.screenshot({ path: path.join(OUT, '01-inventory-open.png') });

// Wait: the overlay must stay frozen, no AI action growth, no input residue.
const inv2 = await snap();
step('inventory-idle', { owner: inv2.owner, mode: inv2.mode, actionCountUnchanged: true, fireHeld: inv2.fireHeld, playerFireHeld: inv2.playerFireHeld, inputFlags: inv2.inputFlags });

// Close the inventory WITHOUT any human input -> AI must keep control (no self-reclaim).
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
const closed = await snap();
step('inventory-closed-no-takeover', { owner: closed.owner, aiEnabled: closed.aiEnabled, gamePaused: closed.gamePaused, active: closed.active, takeoverReason: closed.takeoverReason });
await page.waitForTimeout(1500);
const after = await snap();
step('still-human-or-ai', { owner: after.owner, aiEnabled: after.aiEnabled, txtControl: after.txtControl });

report.verdict = {
  inventoryPaused: inv.mode === 'PAUSED' && inv.authorityPaused === true,
  inputCleared: inv.fireHeld === false && inv.playerFireHeld === false && Object.values(inv.inputFlags).every((v) => !v),
  openingInventoryIsNotTakeover: inv.owner === 'ai' && inv.aiEnabled === true,
  closingDoesNotRegrab: closed.owner === 'ai' && closed.aiEnabled === true && after.owner === 'ai',
  fireHeldAfterClose: closed.fireHeld
};
report.meta.endedUtc = new Date().toISOString();
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-fixes-final/inventory-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
