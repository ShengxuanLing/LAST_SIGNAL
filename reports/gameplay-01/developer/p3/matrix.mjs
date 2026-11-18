// GAMEPLAY-01 P3 six-viewport browser matrix (fixture/agent-driven; not human).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT ?? '5497';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'matrix');
fs.mkdirSync(ROOT, { recursive: true });
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const VIEWPORTS = [
  [1920, 1080, '1920x1080'],
  [1600, 900, '1600x900'],
  [1366, 768, '1366x768'],
  [1280, 720, '1280x720'],
  [1024, 768, '1024x768'],
  [800, 600, '800x600']
];
const BG = '#05070c';

function lum(hexs) {
  const h = hexs.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function contrast(fg, bg = BG) {
  if (!fg || !/^#[0-9a-f]{6}$/i.test(fg)) return null;
  const a = lum(fg), b = lum(bg);
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}

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
async function snap(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name) });
}
async function localState(vp, dir) {
  const raw = await page.evaluate(() => {
    const g = window.__game;
    const s = g.scene.getScene('PauseScene');
    const w = g.scene.getScene('GameScene').world;
    return {
      page: s.page,
      texts: s.children.list.filter((c) => c.type === 'Text' && c.visible !== false).map((c) => {
        const b = c.getBounds();
        return { text: String(c.text).slice(0, 260), x: b.x, y: b.y, w: b.width, h: b.height, font: c.style?.fontSize, color: c.style?.color };
      }),
      status: String(s.localStatus?.text ?? ''),
      proposal: String(s.localProposalText?.text ?? ''),
      notice: String(s.localNoticeText?.text ?? ''),
      confirmEnabled: s.localConfirm?.enabled ?? null,
      rejectEnabled: s.localReject?.enabled ?? null,
      auditEnabled: s.localAudit?.enabled ?? null,
      pending: w.echoPendingLocal,
      audit: w.echoAudit.last(),
      tick: w.sim?.tick ?? null,
      buttons: (s.pageHandle?.buttons ?? []).map((b) => ({ label: String(b.label?.text ?? ''), enabled: b.enabled, focused: b.focused })),
      childCount: s.children.list.length
    };
  });
  const r = await rect();
  const cssScale = r.w / 1280;
  const sizes = raw.texts.map((t) => ({ text: t.text.slice(0, 36), px: Math.round(parseFloat(String(t.font)) * cssScale * 10) / 10 }));
  const minCss = Math.min(...sizes.map((s) => s.px));
  const outside = raw.texts.filter((t) => t.x < -0.5 || t.y < -0.5 || t.x + t.w > 1280.5 || t.y + t.h > 720.5);
  const overlaps = [];
  for (let i = 0; i < raw.texts.length; i++) {
    for (let j = i + 1; j < raw.texts.length; j++) {
      const a = raw.texts[i], b = raw.texts[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlaps.push([a.text.slice(0, 24), b.text.slice(0, 24)]);
    }
  }
  const contrasts = raw.texts.map((t) => ({ text: t.text.slice(0, 30), fg: t.color, ratio: contrast(String(t.color)) })).filter((x) => x.ratio !== null);
  const minContrast = Math.min(...contrasts.map((c) => c.ratio));
  return { ...raw, viewport: vp, cssScale, minCss, outside, overlaps, minContrast, contrasts, sizes };
}
async function hudState(vp, dir) {
  const raw = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    const t = (name) => {
      const o = gs[name];
      if (!o) return null;
      return { text: String(o.text), w: o.width, h: o.height, font: o.style?.fontSize, color: o.style?.color, x: o.x, y: o.y, originX: o.originX };
    };
    return { signal: t('txtSignal'), detail: t('txtSignalDetail'), echo: t('txtEcho'), help: t('txtHelp'), view: gs.world.signalView() };
  });
  const r = await rect();
  const cssScale = r.w / 1280;
  const rows = [raw.signal, raw.detail, raw.echo, raw.help].filter(Boolean);
  const minCss = Math.min(...rows.map((o) => Math.round(parseFloat(String(o.font)) * cssScale * 10) / 10));
  const contrastMin = Math.min(...rows.map((o) => contrast(String(o.color)) ?? 99));
  const lineWidths = rows.map((o) => ({ text: o.text.slice(0, 44), w: o.w, x: o.x }));
  return { ...raw, viewport: vp, cssScale, minCss, minContrast: contrastMin, lineWidths };
}
async function boot(vp) {
  await page.setViewportSize({ width: vp[0], height: vp[1] });
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(600);
  await clickText('MainMenuScene', 'DEMO 01');
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(1100);
  await openEcho();
  await clickText('PauseScene', 'ENABLE ECHO');
  await closePause();
  await page.waitForFunction(() => !!window.__game.scene.getScene('GameScene').world.echoActor, undefined, { timeout: 8000 });
  await page.waitForTimeout(300);
}

const results = [];
try {
  for (const vp of VIEWPORTS) {
    const dir = path.join(ROOT, vp[2]);
    await boot(vp);
    await openLocal();
    const proposal = await localState(vp, dir);
    await snap(dir, 'proposal.png');

    await clickText('PauseScene', 'CONFIRM (HUMAN)');
    await page.waitForTimeout(450);
    const waiting = await localState(vp, dir);
    await snap(dir, 'waiting.png');

    await clickText('PauseScene', 'RECENT ACTIONS');
    const audit = await localState(vp, dir);
    await snap(dir, 'audit.png');
    await clickText('PauseScene', 'BACK');

    // 1280-only interaction checks: focus, resize, repeated page build, ESC layers.
    let focus = null, resize = null, repeat = null, esc = null;
    if (vp[2] === '1280x720') {
      const beforeFocus = await page.evaluate(() => {
        const s = window.__game.scene.getScene('PauseScene');
        return (s.pageHandle?.buttons ?? []).map((b) => ({ label: String(b.label?.text ?? ''), focused: b.focused }));
      });
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);
      const afterFocus = await page.evaluate(() => {
        const s = window.__game.scene.getScene('PauseScene');
        return (s.pageHandle?.buttons ?? []).map((b) => ({ label: String(b.label?.text ?? ''), focused: b.focused }));
      });
      focus = { before: beforeFocus, after: afterFocus };

      const beforeResize = await localState(vp, dir);
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.waitForTimeout(500);
      const resized = await localState([1366, 768, '1366x768'], dir);
      await snap(dir, 'resize-1366x768.png');
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.waitForTimeout(500);
      const back = await localState(vp, dir);
      resize = { before: beforeResize, resized, back };

      const c0 = await page.evaluate(() => window.__game.scene.getScene('PauseScene').children.list.length);
      await clickText('PauseScene', 'BACK');
      await clickText('PauseScene', 'LOCAL COOPERATION');
      const c1 = await page.evaluate(() => window.__game.scene.getScene('PauseScene').children.list.length);
      repeat = { before: c0, after: c1 };

      const escPages = [];
      const pageNow = () => page.evaluate(() => window.__game.scene.getScene('PauseScene')?.page ?? null);
      escPages.push(await pageNow());
      await page.keyboard.press('Escape'); await page.waitForTimeout(250); escPages.push(await pageNow());
      await page.keyboard.press('Escape'); await page.waitForTimeout(250); escPages.push(await pageNow());
      await page.keyboard.press('Escape'); await page.waitForTimeout(250); escPages.push(await pageNow());
      await page.keyboard.press('Escape'); await page.waitForTimeout(350); escPages.push(await pageNow());
      esc = escPages;
      await closePause();
    } else {
      await closePause();
    }
    await page.waitForTimeout(700);
    const hud = await hudState(vp, dir);
    await snap(dir, 'hud.png');
    await openLocal();
    const done = await localState(vp, dir);
    await snap(dir, 'done.png');

    const outside = [...proposal.outside, ...waiting.outside, ...audit.outside, ...done.outside];
    const overlaps = [...proposal.overlaps, ...waiting.overlaps, ...audit.overlaps, ...done.overlaps];
    const minCss = Math.min(proposal.minCss, waiting.minCss, audit.minCss, done.minCss, hud.minCss);
    const minContrast = Math.min(proposal.minContrast, waiting.minContrast, audit.minContrast, done.minContrast, hud.minContrast);
    const ok = outside.length === 0 && overlaps.length === 0 && minCss >= 10 && minContrast >= 4.5 &&
      waiting.confirmEnabled === false && waiting.rejectEnabled === false && done.audit?.result === 'applied' &&
      hud.signal?.text.includes('RELAY') && hud.detail?.text.includes('SCAN') && errors.length === 0;
    const row = {
      viewport: vp[2], ok, minCss, minContrast, outside, overlaps,
      proposal: { page: proposal.page, status: proposal.status, proposal: proposal.proposal, buttons: proposal.buttons, minCss: proposal.minCss, minContrast: proposal.minContrast },
      waiting: { status: waiting.status, proposal: waiting.proposal, notice: waiting.notice, confirm: waiting.confirmEnabled, reject: waiting.rejectEnabled, pending: waiting.pending, buttons: waiting.buttons },
      audit: { page: audit.page, texts: audit.texts.map((t) => t.text), minCss: audit.minCss, minContrast: audit.minContrast },
      done: { status: done.status, notice: done.notice, audit: done.audit, proposal: done.proposal },
      hud: { signal: hud.signal, detail: hud.detail, echo: hud.echo, help: hud.help, minCss: hud.minCss, minContrast: hud.minContrast },
      focus, resize: resize ? { beforeMinCss: resize.before.minCss, resizedMinCss: resize.resized.minCss, backMinCss: resize.back.minCss, resizedPage: resize.resized.page, outside: resize.resized.outside.length } : null,
      repeat, esc
    };
    results.push(row);
    say(`${vp[2]} ${ok ? 'PASS' : 'FAIL'} minCss=${minCss} minContrast=${minContrast} outside=${outside.length} overlaps=${overlaps.length}`);
  }
  const allOk = results.every((r) => r.ok);
  const env = {
    cwd: process.cwd(),
    spec: fileURLToPath(import.meta.url),
    devroot: 'D:/tmp/gp01-p3-ui',
    lastSignalRoot: process.env.LAST_SIGNAL_ROOT ?? null,
    note: 'Independent P3 gate tree; own reports; c2/c3c were not run. Fixture/agent-driven; not human.'
  };
  fs.writeFileSync(path.join(ROOT, 'summary.json'), JSON.stringify({ ok: allOk, env, results, errors }, null, 2));
  fs.writeFileSync(path.join(ROOT, 'matrix.log'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(ROOT, 'env.json'), JSON.stringify(env, null, 2));
  say(`MATRIX RESULT: ${allOk ? 'PASS' : 'FAIL'} (fixture/agent-driven; not human)`);
  await browser.close();
  process.exit(allOk ? 0 : 1);
} catch (e) {
  say(`ERROR: ${String(e).split('\n')[0]}`);
  say(`PAGE ERRORS: ${errors.slice(0, 3).join(' | ')}`);
  fs.writeFileSync(path.join(ROOT, 'matrix.log'), lines.join('\n') + '\n');
  await browser.close();
  process.exit(1);
}
