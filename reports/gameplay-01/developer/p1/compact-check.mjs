// P1 compact 800x600 HUD readability/overlap check (fixture).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const PORT = process.env.PORT ?? '5499';
const BASE = `http://localhost:${PORT}/`;
const OUT = path.resolve('reports/gameplay-01/developer/p1');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(600);
  const pos = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MainMenuScene');
    const t = s.children.list.find((c) => c.type === 'Text' && String(c.text || '').includes('DEMO 01'));
    return t ? { x: t.getBounds().centerX, y: t.getBounds().centerY } : null;
  });
  if (!pos) throw new Error('DEMO 01 not found');
  const css = await page.evaluate(({ x, y }) => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: r.x + (x * r.width) / 1280, y: r.y + (y * r.height) / 720 };
  }, pos);
  await page.mouse.click(css.x, css.y);
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    const b = (o) => { const r = o.getBounds(); return { x: r.x, y: r.y, w: r.width, h: r.height, text: String(o.text) }; };
    const main = b(gs.txtSignal);
    const detail = b(gs.txtSignalDetail);
    const objective = b(gs.txtObjective);
    const help = b(gs.txtHelp);
    return {
      compact: gs.world ? (window.innerWidth / 1280 < 0.85) : null,
      main, detail, objective, help,
      overlapMainDetail: !(main.y + main.h <= detail.y || detail.y + detail.h <= main.y),
      overlapObjectiveHelp: !(objective.y + objective.h <= help.y || help.y + help.h <= objective.y),
      detailLeft: detail.x,
      detailHasKeys: detail.text.includes('KEYS'),
      detailHasCost: detail.text.includes('COST'),
      detailHasRange: detail.text.includes('RANGE'),
      detailHasOldSafe: /DRONES SAFE|LINK SENTRY FIRING/.test(detail.text)
    };
  });
  await page.screenshot({ path: path.join(OUT, 'final/screenshots/demo-compact-800x600.png') });
  const ok = !info.overlapMainDetail && !info.overlapObjectiveHelp && info.detailLeft >= 640 &&
    info.detailHasKeys && info.detailHasCost && info.detailHasRange && !info.detailHasOldSafe && errors.length === 0;
  const lines = [
    `800x600 COMPACT: detailLeft=${info.detailLeft} main/detail overlap=${info.overlapMainDetail} objective/help overlap=${info.overlapObjectiveHelp}`,
    `detail=${JSON.stringify(info.detail)}`,
    `RESULT: ${ok ? 'PASS' : 'FAIL'} (fixture; not human acceptance)`
  ];
  fs.writeFileSync(path.join(OUT, 'final/logs/demo-compact-800x600.log'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.log('ERROR', String(e).split('\n')[0]);
  fs.writeFileSync(path.join(OUT, 'final/logs/demo-compact-800x600.log'), `ERROR ${String(e)}\n`);
  await browser.close();
  process.exit(1);
}
await browser.close();
