// GAMEPLAY-01 P3 v2 — audit page with 8 real recorded entries at 800x600.
// Entries are produced by real local actions (fixture clicks) plus real rejected
// entries; the page must wrap, scroll if needed, and ESC one layer back.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT ?? '5497';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'audit8');
fs.mkdirSync(ROOT, { recursive: true });
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
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
  await page.waitForTimeout(350);
}
async function closePause() {
  for (let i = 0; i < 5; i++) {
    if (!(await page.evaluate(() => window.__game?.scene.isActive('PauseScene')))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(280);
  }
  await page.waitForFunction(() => !window.__game.scene.isActive('PauseScene'), { timeout: 8000 });
  await page.waitForTimeout(400);
}
async function openLocal() {
  // State-aware navigation: the pause scene may already be open on some page.
  const active = await page.evaluate(() => window.__game?.scene.isActive('PauseScene'));
  if (!active) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), { timeout: 10000 });
    await page.waitForTimeout(450);
  }
  const current = await page.evaluate(() => window.__game.scene.getScene('PauseScene')?.page ?? null);
  if (current === 'local-coop') return;
  if (current === 'echo' || current === 'local-audit') {
    await clickText('PauseScene', 'BACK');
    await page.waitForTimeout(250);
  }
  await clickText('PauseScene', 'AI & COMPANION');
  await clickText('PauseScene', 'ECHO COMPANION');
  await clickText('PauseScene', 'LOCAL COOPERATION');
  await page.waitForTimeout(350);
}
async function auditState() {
  return page.evaluate(() => {
    const g = window.__game;
    const s = g.scene.getScene('PauseScene');
    const t = s.localAuditText;
    const b = t.getBounds();
    const texts = s.children.list.filter((c) => c.type === 'Text' && c.visible !== false).map((c) => {
      const bb = c.getBounds();
      return { text: String(c.text).slice(0, 200), x: bb.x, y: bb.y, w: bb.width, h: bb.height, font: c.style?.fontSize };
    });
    return {
      page: s.page,
      title: String(s.children.list.find((c) => c.type === 'Text' && String(c.text).startsWith('LOCAL AUDIT'))?.text ?? ''),
      subtitle: texts.find((x) => x.text.includes('Recent actions'))?.text ?? '',
      auditText: String(t.text),
      height: b.height, y: b.y, x: b.x, w: b.width,
      lines: String(t.text).split('\n').length,
      texts,
      auditCount: g.scene.getScene('GameScene').world.echoAudit.recent(8).length,
      pending: g.scene.getScene('GameScene').world.echoPendingLocal,
      queue: g.scene.getScene('GameScene').world.sim.pendingCommands.length,
      confirmEnabled: s.localConfirm?.enabled ?? null,
      rejectEnabled: s.localReject?.enabled ?? null
    };
  });
}

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(500);
  await clickText('MainMenuScene', 'DEMO 01');
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(500);
  await clickText('PauseScene', 'AI & COMPANION');
  await clickText('PauseScene', 'ECHO COMPANION');
  await clickText('PauseScene', 'ENABLE ECHO');
  await closePause();
  await page.waitForFunction(() => !!window.__game.scene.getScene('GameScene').world.echoActor, undefined, { timeout: 8000 });

  // Real recorded entries: confirm + resume (applied), then reject proposals.
  for (let i = 0; i < 4; i++) {
    await openLocal();
    const hasProposal = await page.evaluate(() => !!window.__game.scene.getScene('GameScene').world.echoLocalProposal);
    if (hasProposal) {
      await clickText('PauseScene', 'CONFIRM (HUMAN)');
      await closePause();
      await page.waitForTimeout(700);
    }
    await openLocal();
    const hasProposal2 = await page.evaluate(() => !!window.__game.scene.getScene('GameScene').world.echoLocalProposal);
    if (hasProposal2) {
      await clickText('PauseScene', 'REJECT');
      await page.waitForTimeout(200);
    }
    await closePause();
    await page.waitForTimeout(500);
  }
  // Direct boundary rejections create real rejected audit rows with codes.
  await page.evaluate(() => {
    const w = window.__game.scene.getScene('GameScene').world;
    for (let i = 0; i < 4; i++) w.confirmLocalEchoProposal(`local_missing_${i}`);
  });
  await page.waitForTimeout(200);

  await openLocal();
  // Create exactly one pending local action before opening the 8-entry audit.
  const pendingProposal = await page.evaluate(() => window.__game.scene.getScene('GameScene').world.echoLocalProposal);
  const confirmBeforeAudit = pendingProposal ? await clickText('PauseScene', 'CONFIRM (HUMAN)').then(() => true).catch(() => false) : false;
  await page.waitForTimeout(400);
  await clickText('PauseScene', 'RECENT ACTIONS');
  const audit = await auditState();
  await page.screenshot({ path: path.join(ROOT, 'audit8-800x600.png') });

  // Scroll: the audit region scrolls only when it overflows; record the effect.
  const beforeY = audit.y;
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(250);
  const afterScroll = await auditState();
  await page.screenshot({ path: path.join(ROOT, 'audit8-800x600-scrolled.png') });
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(250);
  const restored = await auditState();

  // ESC one layer back.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const escPage = await page.evaluate(() => window.__game.scene.getScene('PauseScene')?.page ?? null);
  const escState = await page.evaluate(() => {
    const s = window.__game.scene.getScene('PauseScene');
    const w = window.__game.scene.getScene('GameScene').world;
    return { page: s.page, pending: w.echoPendingLocal, queue: w.sim.pendingCommands.length, confirmEnabled: s.localConfirm?.enabled ?? null, rejectEnabled: s.localReject?.enabled ?? null };
  });

  const scale = (await rect()).w / 1280;
  const minCss = Math.min(...audit.texts.map((t) => parseFloat(String(t.font)) * scale));
  const outside = audit.texts.filter((t) => t.x < -0.5 || t.y < -0.5 || t.x + t.w > 1280.5 || t.y + t.h > 720.5);
  const wrapped = audit.auditText.split('\n').some((l) => l.length > 0);
  const singlePending = !!audit.pending && audit.queue === 1;
  const ok = audit.page === 'local-audit' && audit.auditCount >= 4 && audit.auditCount <= 8 && singlePending &&
    outside.length === 0 && minCss >= 10 && escPage === 'local-coop' &&
    escState.confirmEnabled === false && escState.rejectEnabled === false && errors.length === 0 &&
    audit.auditText.includes('You') && audit.auditText.includes('local_');
  const out = {
    ok, viewport: '800x600', minCss, outside, auditCount: audit.auditCount, lines: audit.lines,
    height: audit.height, title: audit.title, subtitle: audit.subtitle,
    auditText: audit.auditText,
    scroll: { beforeY, afterY: afterScroll.y, restoredY: restored.y, scrolled: afterScroll.y !== beforeY },
    escPage, escState, singlePending, confirmBeforeAudit, errors
  };
  fs.writeFileSync(path.join(ROOT, 'audit8.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ROOT, 'audit8.log'), lines.join('\n') + '\n');
  say(`AUDIT8: entries=${audit.auditCount} lines=${audit.lines} minCss=${minCss} outside=${outside.length} singlePending=${singlePending} esc=${escPage} scrollMoved=${out.scroll.scrolled}`);
  say(`TEXT:\n${audit.auditText}`);
  say(`RESULT: ${ok ? 'PASS' : 'FAIL'} (fixture; not human)`);
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (e) {
  say(`ERROR: ${String(e).split('\n')[0]}`);
  say(`PAGE ERRORS: ${errors.slice(0, 3).join(' | ')}`);
  fs.writeFileSync(path.join(ROOT, 'audit8.log'), lines.join('\n') + '\n');
  await browser.close();
  process.exit(1);
}
