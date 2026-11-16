// Independent probe #3 for 1aadd2e: pointer takeover semantics (UI click vs world click),
// and overlay ownership. NO fixture: no i-frame refresh, no HP/coordinate writes, no addXp.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5283/';
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-fixes-final/evidence-pointer';
mkdirSync(OUT, { recursive: true });
const GAME_W = 1280, GAME_H = 720;
const report = { meta: { url: BASE, fixture: false, startedUtc: new Date().toISOString() }, steps: [], errors: [], trials: [] };
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
    takeoverCount: c.takeoverCount, takeoverReason: c.lastTakeoverReason,
    gamePaused: gs.paused, fireHeld: gs.fireHeld, playerFireHeld: pl.fireHeld(),
    inputFlags: { up: pl.input.up, down: pl.input.down, left: pl.input.left, right: pl.input.right },
    hp: pl.data.hp, grid: { x: pl.wx, y: pl.wy },
    txtControl: gs.txtControl.text, txtAgentLink: gs.txtAgentLink.text
  };
});
const step = (name, detail = {}) => report.steps.push({ name, detail });

async function clearOverlays() {
  for (let i = 0; i < 8; i++) {
    const s = await snap();
    if (!s.active.includes('LevelUpScene')) break;
    await page.keyboard.press('1');
    await page.waitForTimeout(450);
  }
  return snap();
}
async function enableAi(tag) {
  await clearOverlays();
  let s = await snap();
  if (s.owner === 'ai' && s.aiEnabled) return s;
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  const labels = await page.evaluate(() => {
    const ps = window.__game.scene.getScene('PauseScene');
    return ps && window.__game.scene.isActive('PauseScene') ? ps.children.list.filter((c) => c.type === 'Text').map((c) => c.text) : [];
  });
  if (labels.some((t) => t.includes('AI CONTROL: OFF'))) { await clickLogical(640, 540); await page.waitForTimeout(500); }
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  s = await clearOverlays();
  step(`${tag}-enable`, { owner: s.owner, aiEnabled: s.aiEnabled, active: s.active });
  return s;
}

await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await clickLogical(640, 340); // real NEW RUN
await page.waitForTimeout(1500);
await enableAi('initial');

// Trial A: world-area pointer press while NO overlay is open -> must take over.
{
  const before = await clearOverlays();
  const activeAtClick = before.active;
  const b = await box();
  await page.mouse.click(b.x + (800 * b.w) / GAME_W, b.y + (400 * b.h) / GAME_H);
  await page.waitForTimeout(400);
  const after = await snap();
  const t = {
    kind: 'world-pointer-press-no-overlay', activeAtClick, before: { owner: before.owner, aiEnabled: before.aiEnabled },
    after: { owner: after.owner, aiEnabled: after.aiEnabled, takeoverReason: after.takeoverReason, takeoverCount: after.takeoverCount },
    pass: before.owner === 'ai' && after.owner === 'human' && after.aiEnabled === false && after.takeoverReason === 'human-input'
  };
  report.trials.push(t); step('trial-world-pointer', t);
  await page.screenshot({ path: path.join(OUT, '01-after-world-pointer.png') });
}

// Trial B: pause-menu UI click (INVENTORY button) while AI owns -> must NOT take over.
{
  const before = await enableAi('ui-click');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  const pausedState = await snap();
  await clickLogical(640, 360); // INVENTORY (interactive UI object)
  await page.waitForTimeout(500);
  const afterUi = await snap();
  const t = {
    kind: 'pause-ui-click-INVENTORY', pausedBefore: { owner: pausedState.owner, mode: pausedState.mode, active: pausedState.active },
    after: { owner: afterUi.owner, aiEnabled: afterUi.aiEnabled, active: afterUi.active, takeoverReason: afterUi.takeoverReason },
    pass: pausedState.owner === 'ai' && afterUi.owner === 'ai' && afterUi.aiEnabled === true
  };
  report.trials.push(t); step('trial-ui-click', t);
  await page.screenshot({ path: path.join(OUT, '02-after-ui-click.png') });
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  const closed = await snap();
  step('after-ui-close', { owner: closed.owner, aiEnabled: closed.aiEnabled, active: closed.active });
  report.trials[report.trials.length - 1].afterClose = { owner: closed.owner, aiEnabled: closed.aiEnabled };
}

// Trial C: non-UI pointer press while the pause overlay is open -> must take over.
{
  const before = await enableAi('overlay-pointer');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  const pausedState = await snap();
  const b = await box();
  await page.mouse.click(b.x + (100 * b.w) / GAME_W, b.y + (100 * b.h) / GAME_H);
  await page.waitForTimeout(450);
  const after = await snap();
  const t = {
    kind: 'overlay-non-ui-pointer-press', pausedBefore: { owner: pausedState.owner, mode: pausedState.mode, active: pausedState.active },
    after: { owner: after.owner, aiEnabled: after.aiEnabled, takeoverReason: after.takeoverReason, takeoverCount: after.takeoverCount },
    pass: pausedState.owner === 'ai' && after.owner === 'human' && after.aiEnabled === false && after.takeoverReason === 'human-input'
  };
  report.trials.push(t); step('trial-overlay-pointer', t);
  await page.screenshot({ path: path.join(OUT, '03-after-overlay-pointer.png') });
}
report.meta.endedUtc = new Date().toISOString();
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p1-fixes-final/pointer-overlay-log.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
