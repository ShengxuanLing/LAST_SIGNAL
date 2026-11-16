// Clean pause-OFF check at cdb594e (no LevelUp overlay timing artifact).
// NO fixture: real NEW RUN + Pause menu AI CONTROL only; no HP/coord/i-frame edits.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5284/';
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c1-final';
mkdirSync(OUT, { recursive: true });
const GAME_W = 1280, GAME_H = 720;
const report = { meta: { url: BASE, fixture: false, startedUtc: new Date().toISOString() }, steps: [], verdict: null, errors: [] };
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
  const c = gs.world.player.control.snapshot();
  return { active, owner: c.owner, aiEnabled: c.aiEnabled, mode: c.mode, paused: c.paused,
    takeoverCount: c.takeoverCount, takeoverReason: c.lastTakeoverReason, actionCount: c.aiActionCount,
    txtControl: gs.txtControl.text, gamePaused: gs.paused, hp: gs.world.player.data.hp };
});
const labels = () => page.evaluate(() => {
  const g = window.__game, ps = g.scene.getScene('PauseScene');
  return ps && g.scene.isActive('PauseScene') ? ps.children.list.filter((c) => c.type === 'Text').map((c) => c.text) : [];
});
const step = (name, detail) => report.steps.push({ name, detail });
async function clearOverlays() {
  for (let i = 0; i < 8; i++) {
    const s = await snap();
    if (!s.active.includes('LevelUpScene')) break;
    await page.keyboard.press('1'); await page.waitForTimeout(450);
  }
  return snap();
}

await page.goto(BASE);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await clickLogical(640, 340); await page.waitForTimeout(1500);
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
await clickLogical(640, 540); await page.waitForTimeout(500); // AI CONTROL ON
await page.keyboard.press('Escape'); await page.waitForTimeout(700);
let s = await clearOverlays();
// Re-enable AI if a takeover happened during overlay clearing (it should not).
if (!(s.owner === 'ai' && s.aiEnabled)) {
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  if ((await labels()).some((t) => t.includes('AI CONTROL: OFF'))) { await clickLogical(640, 540); await page.waitForTimeout(500); }
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  s = await clearOverlays();
}
step('ai-running', s);

// Pause while AI owns: fresh PauseScene must show ON.
await page.keyboard.press('Escape'); await page.waitForTimeout(600);
const onLabels = (await labels()).filter((t) => /AI CONTROL|CONTROL|AGENT/.test(t));
const paused = await snap();
await page.waitForTimeout(900);
const frozen = await snap();
step('paused', { mode: paused.mode, onLabels, gridFrozen: frozen.mode === 'PAUSED', actionCountSame: frozen.actionCount === paused.actionCount });

// Click the same button -> OFF, then resume.
await clickLogical(640, 540); await page.waitForTimeout(600);
const offLabels = (await labels()).filter((t) => /AI CONTROL|CONTROL|AGENT/.test(t));
const disabled = await snap();
await page.keyboard.press('Escape'); await page.waitForTimeout(600);
const resumed = await snap();
await page.waitForTimeout(2000);
const later = await snap();
step('off-and-resume', { offLabels, disabled, resumed, later });

report.verdict = {
  pauseWhileAiOn: paused.owner === 'ai' && paused.mode === 'PAUSED' && onLabels.some((t) => t.includes('AI CONTROL: ON')),
  frozenWhilePaused: frozen.actionCount === paused.actionCount && frozen.mode === 'PAUSED',
  disabledFromMenu: disabled.owner === 'human' && disabled.aiEnabled === false && disabled.takeoverReason === 'pause-menu',
  menuShowsOff: offLabels.some((t) => t.includes('AI CONTROL: OFF')),
  noSelfReclaim: later.owner === 'human' && later.aiEnabled === false && later.txtControl.includes('HUMAN')
};
report.verdict.pass = Object.values(report.verdict).every(Boolean);
report.meta.endedUtc = new Date().toISOString();
writeFileSync(`${OUT}/pause-off-log.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
