// P2 Demo-02 compact layout check at 800x600 (fixture-driven visual check).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ?? '5599';
const OUT = path.resolve('reports/gameplay-01/developer/p2/demo02');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const rect = () => page.evaluate(() => {
  const c = window.__game.canvas;
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const sx = async () => { const r = await rect(); return r.w / 1280; };
async function clickText(label) {
  const r = await rect();
  const s = r.w / 1280;
  const p = await page.evaluate((label) => {
    const s = window.__game.scene.getScene('PauseScene');
    const t = s?.children.list.find((c) => c.type === 'Text' && c.visible !== false && String(c.text).includes(label));
    if (!t) return null;
    const b = t.getBounds();
    return { x: b.centerX, y: b.centerY };
  }, label);
  if (!p) throw new Error(`not found: ${label}`);
  await page.mouse.click(r.x + p.x * s, r.y + p.y * s);
  await page.waitForTimeout(400);
}
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(500);
  const r = await rect();
  const start = await page.evaluate(() => {
    const s = window.__game.scene.getScene('MainMenuScene');
    const t = s.children.list.find((c) => c.type === 'Text' && String(c.text).includes('DEMO 01'));
    const b = t.getBounds();
    return { x: b.centerX, y: b.centerY };
  });
  await page.mouse.click(r.x + start.x * (r.w / 1280), r.y + start.y * (r.h / 720));
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(300);
  await clickText('AI & COMPANION');
  await clickText('ECHO COMPANION');
  await clickText('ENABLE ECHO');
  for (let i = 0; i < 5; i++) {
    if (!(await page.evaluate(() => window.__game?.scene.isActive('PauseScene')))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => !!window.__game.scene.getScene('GameScene').world.echoActor, undefined, { timeout: 8000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(300);
  await clickText('AI & COMPANION');
  await clickText('ECHO COMPANION');
  await clickText('LOCAL COOPERATION');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'demo02-local-800x600.png') });
  const metrics = await page.evaluate(() => {
    const s = window.__game.scene.getScene('PauseScene');
    const texts = s.children.list.filter((c) => c.type === 'Text' && c.visible !== false).map((c) => {
      const b = c.getBounds();
      return { text: String(c.text).slice(0, 48), x: b.x, y: b.y, w: b.width, h: b.height, font: c.style?.fontSize };
    });
    return { page: s.page, tokens: s.tokens?.SMALL_FONT, texts, proposal: String(s.localProposalText?.text ?? '') };
  });
  const r2 = await rect();
  const cssScale = r2.w / 1280;
  const smallCss = (metrics.tokens ?? 0) * cssScale;
  const outside = metrics.texts.filter((t) => t.x < 0 || t.y < 0 || t.x + t.w > 1280 || t.y + t.h > 720);
  const ok = metrics.page === 'local-coop' && metrics.proposal.includes('LOCAL ·') &&
    metrics.tokens === 16 && smallCss >= 10 && outside.length === 0 && errors.length === 0;
  const out = { ok, viewport: { w: 800, h: 600 }, canvas: r2, cssScale, smallCss, page: metrics.page, tokens: metrics.tokens, outside, proposal: metrics.proposal, errors };
  fs.writeFileSync(path.join(OUT, 'demo02-local-800.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.log(`ERROR ${String(e).split('\n')[0]} | pageErrors=${errors.slice(0, 2).join(' | ')}`);
  await browser.close();
  process.exit(1);
}
