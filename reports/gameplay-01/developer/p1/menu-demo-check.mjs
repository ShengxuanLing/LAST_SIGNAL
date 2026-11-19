// GAMEPLAY-01 P1 — menu entry at 800x600 + save-overwrite confirmation (fixture).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ?? '5499';
const BASE = `http://localhost:${PORT}/`;
const OUT = path.resolve('reports/gameplay-01/developer/p1');
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const canvas = () => page.evaluate(() => {
  const r = document.querySelector('canvas').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
async function toCss(lx, ly) {
  const b = await canvas();
  return { x: b.x + (lx * b.w) / 1280, y: b.y + (ly * b.h) / 720 };
}
async function textBox(sceneKey, label) {
  return page.evaluate(({ key, label }) => {
    const g = window.__game;
    const s = g.scene.getScene(key);
    if (!s || !g.scene.isActive(key)) return null;
    const t = s.children.list.find((c) => c.type === 'Text' && c.visible !== false && String(c.text).includes(label));
    if (!t) return null;
    const b = t.getBounds();
    return { x: b.centerX, y: b.centerY };
  }, { key: sceneKey, label });
}
async function click(sceneKey, label) {
  const p = await textBox(sceneKey, label);
  if (!p) throw new Error(`text not found: ${label} in ${sceneKey}`);
  const c = await toCss(p.x, p.y);
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(400);
}
try {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'menu-demo-800x600.png') });
  const menu = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MainMenuScene');
    const rows = s.children.list.filter((c) => c.type === 'Text' && c.visible !== false).map((c) => {
      const b = c.getBounds();
      return { text: String(c.text).slice(0, 44), x: b.x, y: b.y, w: b.width, h: b.height };
    });
    return rows;
  });
  const demo = menu.find((r) => r.text.includes('DEMO 01'));
  const sector = menu.find((r) => r.text.includes('SECTOR RUN'));
  const help = menu.find((r) => r.text.includes('WASD move'));
  const within = demo && demo.x >= 0 && demo.y >= 0 && demo.x + demo.w <= 1280 && demo.y + demo.h <= 720;
  const noOverlap = demo && sector && help &&
    (demo.y + demo.h <= sector.y || sector.y + sector.h <= demo.y || demo.x + demo.w <= sector.x || sector.x + sector.w <= demo.x) &&
    (demo.y + demo.h <= help.y || help.y + help.h <= demo.y);
  say(`800x600 MENU: demo=${JSON.stringify(demo)} within=${within} noOverlapWithSectorOrHelp=${noOverlap}`);

  // Real NEW RUN -> first checkpoint -> quit to menu -> demo button -> replace view.
  await click('MainMenuScene', 'NEW RUN');
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(500);
  await click('PauseScene', 'QUIT TO MENU');
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 15000 });
  await page.waitForTimeout(500);
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') || '{}'));
  say(`SAVE AFTER NEW RUN/QUIT: run=${!!save.run} id=${save.run?.id ?? 'none'}`);
  await click('MainMenuScene', 'DEMO 01');
  await page.waitForTimeout(500);
  const replaceTexts = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MainMenuScene');
    return s.children.list.filter((c) => c.type === 'Text' && c.visible !== false).map((c) => String(c.text));
  });
  const hasReplaceNotice = replaceTexts.some((t) => t.includes('STARTING OVER REPLACES THE CURRENT RUN CHECKPOINT'));
  say(`REPLACE VIEW: notice=${hasReplaceNotice}`);
  await click('MainMenuScene', 'REPLACE AND START');
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(1200);
  const demoState = await page.evaluate(() => {
    const w = window.__game.scene.getScene('GameScene').world;
    return { scen: w.p1Scenario, relay: w.signalView()?.relay ?? null };
  });
  say(`REPLACE START DEMO: scen=${!!demoState.scen} relay=${demoState.relay}`);

  const ok = !!demo && within && noOverlap && !!save.run && hasReplaceNotice &&
    demoState.scen?.id === 'p1' && demoState.relay === 'ACTIVE' && errors.length === 0;
  say(`RESULT: ${ok ? 'PASS' : 'FAIL'} (fixture; not human acceptance)`);
  fs.writeFileSync(path.join(OUT, 'menu-demo-check.json'), JSON.stringify({ ok, demo, sector, help, within, noOverlap, save: save.run?.id ?? null, hasReplaceNotice, demoState, errors }, null, 2));
  fs.writeFileSync(path.join(OUT, 'logs/menu-demo-check.log'), lines.join('\n') + '\n');
  process.exit(ok ? 0 : 1);
} catch (e) {
  say(`ERROR: ${String(e).split('\n')[0]}`);
  fs.writeFileSync(path.join(OUT, 'logs/menu-demo-check.log'), lines.join('\n') + '\n');
  await browser.close();
  process.exit(1);
}
await browser.close();
