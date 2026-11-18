// GAMEPLAY-01 P3 early visual proof — real P3 tree, real menu/pause, fixture clicks.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ?? '5497';
const OUT = path.resolve('reports/gameplay-01/developer/p3/early');
fs.mkdirSync(OUT, { recursive: true });
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function canvasRect() {
  return page.evaluate(() => {
    const r = window.__game.canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}
async function textPos(sceneKey, label) {
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
async function clickText(sceneKey, label) {
  const r = await canvasRect();
  const p = await textPos(sceneKey, label);
  if (!p) throw new Error(`text not found: ${label} in ${sceneKey}`);
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
async function openEcho() {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(350);
  await clickText('PauseScene', 'AI & COMPANION');
  await clickText('PauseScene', 'ECHO COMPANION');
}
async function openLocal() {
  await openEcho();
  await clickText('PauseScene', 'LOCAL COOPERATION');
  await page.waitForTimeout(400);
}
async function snap(name) { await page.screenshot({ path: path.join(OUT, name) }); }
async function localState() {
  return page.evaluate(() => {
    const g = window.__game;
    const s = g.scene.getScene('PauseScene');
    const w = g.scene.getScene('GameScene').world;
    const texts = s.children.list.filter((c) => c.type === 'Text' && c.visible !== false).map((c) => {
      const b = c.getBounds();
      return { text: String(c.text).slice(0, 220), x: b.x, y: b.y, w: b.width, h: b.height, font: c.style?.fontSize, color: c.style?.color };
    });
    return {
      page: s.page,
      texts,
      status: String(s.localStatus?.text ?? ''),
      proposal: String(s.localProposalText?.text ?? ''),
      notice: String(s.localNoticeText?.text ?? ''),
      auditEnabled: s.localAudit?.enabled ?? null,
      confirmEnabled: s.localConfirm?.enabled ?? null,
      rejectEnabled: s.localReject?.enabled ?? null,
      pending: w.echoPendingLocal,
      proposalNow: w.echoLocalProposal ? { id: w.echoLocalProposal.id, kind: w.echoLocalProposal.kind } : null,
      audit: w.echoAudit.last(),
      tick: w.sim?.tick ?? null,
      echo: w.echoActor ? { hp: w.echoActor.data.hp } : null
    };
  });
}
async function hudState() {
  return page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    const W = gs.world;
    const t = (name) => {
      const o = gs[name];
      if (!o) return null;
      const b = o.getBounds();
      return { text: String(o.text), x: b.x, y: b.y, w: b.width, h: b.height, font: o.style?.fontSize, color: o.style?.color };
    };
    return { signal: t('txtSignal'), detail: t('txtSignalDetail'), echo: t('txtEcho'), help: t('txtHelp'), view: W.signalView() };
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
  await openEcho();
  await clickText('PauseScene', 'ENABLE ECHO');
  await closePause();
  await page.waitForFunction(() => !!window.__game.scene.getScene('GameScene').world.echoActor, undefined, { timeout: 8000 });
  await page.waitForTimeout(300);

  await openLocal();
  const proposal = await localState();
  await snap('local-proposal-1280x720.png');
  say(`PROPOSAL: ${JSON.stringify({ page: proposal.page, status: proposal.status, proposal: proposal.proposal, notice: proposal.notice, confirm: proposal.confirmEnabled })}`);

  await clickText('PauseScene', 'CONFIRM (HUMAN)');
  await page.waitForTimeout(500);
  const waiting = await localState();
  await snap('local-waiting-1280x720.png');
  say(`WAITING: ${JSON.stringify({ status: waiting.status, proposal: waiting.proposal, notice: waiting.notice, confirm: waiting.confirmEnabled, reject: waiting.rejectEnabled, pending: waiting.pending })}`);

  await clickText('PauseScene', 'VIEW AUDIT');
  const audit = await localState();
  await snap('local-audit-1280x720.png');
  say(`AUDIT: ${JSON.stringify({ page: audit.page, texts: audit.texts.map((t) => t.text) })}`);
  await clickText('PauseScene', 'BACK');

  await closePause();
  await page.waitForTimeout(900);
  const hud = await hudState();
  await snap('hud-1280x720.png');
  say(`HUD: ${JSON.stringify(hud)}`);

  await openLocal();
  const done = await localState();
  await snap('local-done-1280x720.png');
  say(`DONE: ${JSON.stringify({ status: done.status, proposal: done.proposal, notice: done.notice, audit: done.audit })}`);

  const cssScale = 1280 / 1280;
  const all = [...proposal.texts, ...waiting.texts, ...audit.texts];
  const outside = all.filter((t) => t.x < -0.5 || t.y < -0.5 || t.x + t.w > 1280.5 || t.y + t.h > 720.5);
  const sizes = all.map((t) => ({ text: t.text.slice(0, 40), px: parseFloat(String(t.font)) * cssScale }));
  const minSize = Math.min(...sizes.map((s) => s.px));
  const out = {
    ok: proposal.page === 'local-coop' && proposal.confirmEnabled === true &&
      waiting.pending !== null && waiting.confirmEnabled === false && waiting.proposal.includes('Waiting') &&
      audit.page === 'local-audit' && audit.texts.some((t) => t.text.includes('No recent') || t.text.includes('human-local') || t.text.includes('local')) &&
      hud.signal?.text.includes('RELAY') && hud.detail?.text.includes('SCAN') &&
      done.audit?.result === 'applied' && outside.length === 0 && minSize >= 10 && errors.length === 0,
    viewport: '1280x720', cssScale, minSize, outside, sizes, proposal, waiting, audit, hud, done, errors
  };
  fs.writeFileSync(path.join(OUT, 'early.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT, 'early.log'), lines.join('\n') + '\n');
  say(`RESULT: ${out.ok ? 'PASS' : 'FAIL'} (fixture/agent-driven; not human) outside=${outside.length} minCss=${minSize}`);
  await browser.close();
  process.exit(out.ok ? 0 : 1);
} catch (e) {
  say(`ERROR: ${String(e).split('\n')[0]}`);
  say(`PAGE ERRORS: ${errors.slice(0, 3).join(' | ')}`);
  fs.writeFileSync(path.join(OUT, 'early.log'), lines.join('\n') + '\n');
  await browser.close();
  process.exit(1);
}
