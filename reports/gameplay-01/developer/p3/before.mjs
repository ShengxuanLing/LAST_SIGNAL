// GAMEPLAY-01 P3 before/after — P2v3 (87a0fac) local page + HUD at 1280.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ?? '5496';
const OUT = path.resolve('reports/gameplay-01/developer/p3/before');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function rect() {
  return page.evaluate(() => {
    const r = window.__game.canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}
async function clickText(sceneKey, label) {
  const r = await rect();
  const p = await page.evaluate(({ key, label }) => {
    const g = window.__game;
    const s = g.scene.getScene(key);
    if (!s || !g.scene.isActive(key)) return null;
    const t = s.children.list.find((c) => c.type === 'Text' && c.visible !== false && String(c.text).includes(label));
    if (!t) return null;
    const b = t.getBounds();
    return { x: b.centerX, y: b.centerY };
  }, { key: sceneKey, label });
  if (!p) throw new Error(`not found: ${label}`);
  await page.mouse.click(r.x + p.x * (r.w / 1280), r.y + p.y * (r.h / 720));
  await page.waitForTimeout(400);
}
async function closePause() {
  for (let i = 0; i < 5; i++) {
    if (!(await page.evaluate(() => window.__game?.scene.isActive('PauseScene')))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => !window.__game.scene.isActive('PauseScene'), { timeout: 8000 });
  await page.waitForTimeout(500);
}
async function state() {
  return page.evaluate(() => {
    const g = window.__game;
    const s = g.scene.getScene('PauseScene');
    const w = g.scene.getScene('GameScene').world;
    return {
      page: s.page,
      texts: s.children.list.filter((c) => c.type === 'Text' && c.visible !== false).map((c) => {
        const b = c.getBounds();
        return { text: String(c.text).slice(0, 220), x: b.x, y: b.y, w: b.width, h: b.height, font: c.style?.fontSize, color: c.style?.color };
      }),
      proposal: String(s.localProposalText?.text ?? ''),
      notice: String(s.localNoticeText?.text ?? ''),
      confirmEnabled: s.localConfirm?.enabled ?? null,
      rejectEnabled: s.localReject?.enabled ?? null,
      pending: w.echoPendingLocal ?? null,
      audit: w.echoAudit?.last?.() ?? null
    };
  });
}
async function hud() {
  return page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    const t = (name) => {
      const o = gs[name];
      if (!o) return null;
      const b = o.getBounds();
      return { text: String(o.text), x: b.x, y: b.y, w: b.width, h: b.height, font: o.style?.fontSize, color: o.style?.color };
    };
    return { signal: t('txtSignal'), detail: t('txtSignalDetail'), echo: t('txtEcho'), help: t('txtHelp') };
  });
}

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(600);
  await clickText('MainMenuScene', 'DEMO 01');
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(350);
  await clickText('PauseScene', 'AI & COMPANION');
  await clickText('PauseScene', 'ECHO COMPANION');
  await clickText('PauseScene', 'ENABLE ECHO');
  await closePause();
  await page.waitForFunction(() => !!window.__game.scene.getScene('GameScene').world.echoActor, undefined, { timeout: 8000 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(350);
  await clickText('PauseScene', 'AI & COMPANION');
  await clickText('PauseScene', 'ECHO COMPANION');
  await clickText('PauseScene', 'LOCAL COOPERATION');
  const local = await state();
  await page.screenshot({ path: path.join(OUT, 'p2v3-local-proposal-1280x720.png') });
  await closePause();
  await page.waitForTimeout(800);
  const hudState = await hud();
  await page.screenshot({ path: path.join(OUT, 'p2v3-hud-1280x720.png') });
  const out = { ok: local.page === 'local-coop' && errors.length === 0, local, hud: hudState, errors, viewport: '1280x720' };
  fs.writeFileSync(path.join(OUT, 'p2v3.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'p2v3.log'), lines.join('\n') + '\n');
  say(`P2V3 PROPOSAL: ${JSON.stringify({ page: local.page, proposal: local.proposal, notice: local.notice, confirm: local.confirmEnabled })}`);
  say(`P2V3 HUD: ${JSON.stringify(hudState)}`);
  say(`RESULT: ${out.ok ? 'PASS' : 'FAIL'} (fixture; not human)`);
  await browser.close();
  process.exit(out.ok ? 0 : 1);
} catch (e) {
  say(`ERROR: ${String(e).split('\n')[0]}`);
  fs.writeFileSync(path.join(OUT, 'p2v3.log'), lines.join('\n') + '\n');
  await browser.close();
  process.exit(1);
}
