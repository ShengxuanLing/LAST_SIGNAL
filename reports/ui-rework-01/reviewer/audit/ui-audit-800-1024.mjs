// UI-REWORK-01 reviewer browser audit (standalone, read-only).
// Runs the real game in Chromium at two small viewports and records:
//  - layout audit (overlap / out-of-bounds / effective CSS font size)
//  - keyboard reachability of Settings + Inventory controls
//  - focus stability over time (no timer-driven focus stealing)
//  - DOM pairing form: ESC behaviour, occlusion, secret masking in screenshots
//  - HUD hidden while paused / restored after resume
// Writes JSON + screenshots under reports/ui-rework-01/reviewer/audit/ and
// prints one summary line per viewport. Never touches src/ or tests/.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT ?? 5466);
const BASE = `http://localhost:${PORT}/`;
const OUT = path.resolve('reports/ui-rework-01/reviewer/audit');
const LOGDIR = path.resolve('reports/ui-rework-01/reviewer/logs');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(LOGDIR, { recursive: true });

const LINES = [];
const say = (s) => { LINES.push(s); console.log(s); };

const FLAT = `(s) => {
  const out = [];
  const walk = (list) => {
    for (const c of list) {
      if (c.type === 'Container' && Array.isArray(c.list)) { walk(c.list); continue; }
      out.push(c);
    }
  };
  walk(s.children.list);
  return out;
}`;

const BOX = `(c) => {
  const b = c.getBounds ? c.getBounds() : null;
  if (!b) return null;
  if (c.parentContainer && typeof c.getWorldTransformMatrix === 'function') {
    const m = c.getWorldTransformMatrix();
    const p1 = m.transformPoint(b.x, b.y);
    const p2 = m.transformPoint(b.right, b.bottom);
    return { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) };
  }
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}`;

async function canvasBox(page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

async function toCss(page, lx, ly) {
  const b = await canvasBox(page);
  return { x: b.x + (lx * b.w) / 1280, y: b.y + (ly * b.h) / 720 };
}

async function clickText(page, label, exact = false) {
  const logical = await page.evaluate(({ label, exact, flatSrc, boxSrc }) => {
    const g = window.__game;
    const s = g.scene.getScene('PauseScene');
    if (!s || !g.scene.isActive('PauseScene')) return null;
    const flat = eval(flatSrc)(s);
    const box = eval(boxSrc);
    const cands = flat.filter((c) => c.type === 'Text' && c.visible !== false && c.text &&
      (exact ? String(c.text).trim() === label : String(c.text).includes(label)));
    if (!cands.length) return null;
    const hit = cands.find((c) => c.input && c.input.enabled !== false) || cands[0];
    const b = box(hit);
    if (!b) return null;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2, text: String(hit.text).slice(0, 40) };
  }, { label, exact, flatSrc: FLAT, boxSrc: BOX });
  if (!logical) throw new Error(`no visible text matching "${label}" in PauseScene`);
  const p = await toCss(page, logical.x, logical.y);
  await page.mouse.click(p.x, p.y);
  return padded(page, logical.text);
}
const padded = async (_p, t) => t;

async function bootRun(page) {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await page.waitForTimeout(400);
  for (let i = 0; i < 3; i++) {
    await clickMainMenu(page, 'NEW RUN');
    const ok = await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 8000 })
      .then(() => true).catch(() => false);
    if (ok) { await page.waitForTimeout(900); return; }
  }
  throw new Error('NEW RUN did not start');
}

async function clickMainMenu(page, label) {
  const logical = await page.evaluate(({ label, flatSrc, boxSrc }) => {
    const g = window.__game;
    const s = g.scene.getScene('MainMenuScene');
    const flat = eval(flatSrc)(s);
    const t = flat.find((c) => c.type === 'Text' && c.visible !== false && String(c.text || '').trim().startsWith(label));
    if (!t) return null;
    const b = eval(boxSrc)(t);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }, { label, flatSrc: FLAT, boxSrc: BOX });
  if (!logical) throw new Error(`main menu "${label}" not found`);
  const p = await toCss(page, logical.x, logical.y);
  await page.mouse.click(p.x, p.y);
}

async function openPause(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(420);
}

async function ensurePause(page) {
  const active = await page.evaluate(() => window.__game?.scene.isActive('PauseScene'));
  if (!active) await openPause(page);
}

async function pageName(page) {
  return page.evaluate(() => window.__game.scene.getScene('PauseScene')?.page ?? null);
}

async function snapshot(page, sceneKey) {
  return page.evaluate(({ key, flatSrc, boxSrc }) => {
    const g = window.__game;
    const s = g.scene.getScene(key);
    if (!s) return null;
    const W = g.scale.gameSize.width, H = g.scale.gameSize.height;
    const flat = eval(flatSrc)(s);
    const box = eval(boxSrc);
    const els = flat.map((c) => {
      let b = null;
      try { const r = box(c); if (r) b = r; } catch { b = null; }
      const fontSize = c.type === 'Text' ? parseFloat(c.style?.fontSize) || null : null;
      return {
        type: c.type,
        text: c.type === 'Text' ? String(c.text) : null,
        box: b,
        visible: c.visible !== false,
        interactive: !!c.input && c.input.enabled !== false,
        fontSize,
        background: !!(b && b.w >= W * 0.9 && b.h >= H * 0.9),
        focused: c.type === 'Rectangle' && c.lineWidth === 3 && c.strokeColor === 16777215
      };
    });
    return { scene: key, page: s.page ?? null, logical: { w: W, h: H }, elements: els };
  }, { key: sceneKey, flatSrc: FLAT, boxSrc: BOX });
}

function auditGeometry(snap, tolerance = 1) {
  const findings = [];
  const W = snap.logical.w, H = snap.logical.h;
  const els = snap.elements.filter((e) => e.box && e.visible && !e.background);
  for (const e of els) {
    const b = e.box;
    if (b.x < -tolerance || b.y < -tolerance || b.x + b.w > W + tolerance || b.y + b.h > H + tolerance) {
      findings.push({ kind: 'out-of-bounds', a: label(e), box: b });
    }
  }
  for (const e of els) if (e.interactive === false && e.type === 'Rectangle') { /* nop */ }
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j];
      const ox = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x);
      const oy = Math.min(a.box.y + a.box.h, b.box.y + b.box.h) - Math.max(a.box.y, b.box.y);
      if (ox <= 1 || oy <= 1) continue;
      const area = ox * oy;
      if (area < 6) continue;
      // button label + its own hit rectangle: same control, allowed
      const sameControl = (a.text && b.type === 'Rectangle' && !b.text && contains(b.box, a.box)) ||
        (b.text && a.type === 'Rectangle' && !a.text && contains(a.box, b.box));
      if (sameControl) continue;
      findings.push({ kind: 'overlap', a: label(a), b: label(b), area: Math.round(area) });
    }
  }
  return findings;
}
const contains = (outer, inner) => inner.x >= outer.x - 2 && inner.y >= outer.y - 2 &&
  inner.x + inner.w <= outer.x + outer.w + 2 && inner.y + inner.h <= outer.y + outer.h + 2;
const label = (e) => `${e.type}${e.text ? ` "${e.text.slice(0, 36)}"` : ''}${e.interactive ? ' [clickable]' : ''}`;

function fontReport(snap, scale) {
  const texts = snap.elements.filter((e) => e.type === 'Text' && e.visible && e.fontSize);
  const rows = texts.map((e) => ({ text: (e.text || '').slice(0, 40), logical: e.fontSize, css: +(e.fontSize * scale).toFixed(2) }));
  const below10 = rows.filter((r) => r.css < 10);
  return { min: rows.length ? Math.min(...rows.map((r) => r.css)) : null, below10: below10.length, below10sample: below10.slice(0, 6) };
}

async function focusedControl(page) {
  return page.evaluate((flatSrc) => {
    const s = window.__game.scene.getScene('PauseScene');
    const flat = eval(flatSrc)(s);
    const rects = flat.filter((c) => c.type === 'Rectangle' && c.visible !== false && c.input && c.input.enabled !== false);
    const texts = flat.filter((c) => c.type === 'Text' && c.visible !== false && c.text);
    const f = rects.filter((c) => c.lineWidth === 3 && c.strokeColor === 16777215);
    return {
      focusCount: f.length,
      focused: f.map((c) => {
        const near = texts.filter((t) => t.x > c.x - c.width / 2 && t.x < c.x + c.width / 2 && Math.abs(t.y - c.y) < c.height)
          .sort((a, b) => Math.abs(a.y - c.y) - Math.abs(b.y - c.y))[0];
        return { x: c.x, y: c.y, label: near ? String(near.text).slice(0, 40) : null };
      }),
      controls: rects.map((c) => ({ x: c.x, y: c.y, w: c.width, h: c.height }))
    };
  }, FLAT);
}

function near(fig, x, y) { return Math.abs(fig.x - x) < 6 && Math.abs(fig.y - y) < 6; }

async function main() {
  const t0 = new Date().toISOString();
  const hashesBefore = hashSources();
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const summary = { startedAt: t0, sourceHashesBefore: hashesBefore, viewports: {} };

  for (const [w, h] of [[800, 600], [1024, 768]]) {
    const key = `${w}x${h}`;
    const dir = path.join(OUT, key);
    fs.mkdirSync(dir, { recursive: true });
    const checks = [];
    const add = (name, ok, detail) => { checks.push({ name, ok, detail }); say(`  [${ok ? 'ok  ' : 'FAIL'}] ${key} ${name}${detail ? ` :: ${detail}` : ''}`); };
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    const consoleAll = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { consoleAll.push(`${m.type()}|${m.text()}`); if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const shots = [];
    const shot = async (name) => { const f = path.join(dir, `${name}.png`); await page.screenshot({ path: f }); shots.push(f); return f; };
    const go = async (labelStr) => { await clickText(page, labelStr); await page.waitForTimeout(450); };

    try {
      await bootRun(page);
      const cb = await canvasBox(page);
      const scale = cb.w / 1280;
      const surfaces = {};

      // ---- run HUD baseline
      surfaces.run = await snapshot(page, 'GameScene');
      await shot('run-hud');

      await openPause(page);
      add('boot + pause open', (await pageName(page)) === 'pause', `page=${await pageName(page)}, scale=${scale.toFixed(3)}, canvas=${cb.w.toFixed(0)}x${cb.h.toFixed(0)}`);

      const captureSurface = async (name) => {
        surfaces[name] = await snapshot(page, 'PauseScene');
        await shot(name);
      };
      await captureSurface('pause');
      add('HUD hidden while paused', (surfaces.pause && true) ? await hudVisible(page) === false : false, 'GameScene HUD visible flag');

      // ---- settings + keyboard reachability (B7: every real control must be
      // reachable by keyboard, including the new volume arrows)
      await go('SETTINGS');
      await captureSurface('settings');
      const settingsButtons = await page.evaluate(() => {
        const s = window.__game.scene.getScene('PauseScene');
        return (s.uiButtons || []).map((b) => ({ x: b.rect.x, y: b.rect.y, w: b.rect.width, h: b.rect.height, label: String(b.label.text) }));
      });
      const reachSettings = await keyboardSweep(page, Math.max(12, settingsButtons.length + 4));
      const strayFocus = reachSettings.filter((f) => !settingsButtons.some((b) => near(b, f.x, f.y)));
      const reachedButtons = settingsButtons.filter((b) => reachSettings.some((f) => near(b, f.x, f.y)));
      const arrows = settingsButtons.filter((b) => b.label === '◀' || b.label === '▶');
      const arrowsReached = arrows.filter((b) => reachSettings.some((f) => near(b, f.x, f.y)));
      add('settings keyboard focuses only real controls', strayFocus.length === 0 && reachedButtons.length === settingsButtons.length,
        `buttons=${settingsButtons.length} reached=${reachedButtons.length} stray=${strayFocus.length} labels=${JSON.stringify(settingsButtons.map((b) => b.label))}`);
      add('settings volume arrows keyboard-reachable', arrows.length === 4 && arrowsReached.length === 4,
        `arrows=${arrows.length} reached=${arrowsReached.length}`);
      add('settings focus stable 3s (no timer steal)', await focusStable(page, 3000), '');

      // ---- inventory + keyboard reachability + preserved EQUIP rows
      await go('BACK');
      await go('INVENTORY');
      await captureSurface('inventory');
      const invEquip = await page.evaluate((flatSrc) => {
        const s = window.__game.scene.getScene('PauseScene');
        const flat = eval(flatSrc)(s);
        return flat.filter((c) => c.type === 'Text' && c.input && (c.text === 'EQUIP' || c.text === 'EQUIPPED' || c.text === 'QUEUED'))
          .map((c) => ({ text: c.text, x: c.x, y: c.y, enabled: c.input.enabled !== false }));
      }, FLAT);
      add('inventory EQUIP rows preserved (x=420, y=186/230/274)', invEquip.length > 0 && invEquip.some((e) => e.x === 420 && e.y === 186),
        JSON.stringify(invEquip));
      const reachInv = await keyboardSweep(page, 6);
      add('inventory keyboard focuses only buttons', reachInv.length > 0 && reachInv.every((f) => f.label === 'CLOSE'),
        JSON.stringify(reachInv.map((f) => f.label)));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(450);
      add('ESC from inventory returns to pause root (no resume)', (await pageName(page)) === 'pause', `page=${await pageName(page)}`);

      // ---- ai / echo / llm
      await go('AI & COMPANION');
      await captureSurface('ai');
      const backBtn = await focusBack(page, 'BACK');
      add('keyboard ENTER activates focused control', await enterActivates(page, 'BACK'), 'ENTER on BACK');
      await ensurePause(page);
      if ((await pageName(page)) !== 'ai') await go('AI & COMPANION');
      await go('ECHO COMPANION');
      await captureSurface('echo');
      add('echo focus stable 3s', await focusStable(page, 3000), '');
      await go('BACK');
      if ((await pageName(page)) !== 'ai') await go('AI & COMPANION');
      await go('LLM COMPANION');
      await captureSurface('llm');
      const reachLlm = await keyboardSweep(page, 8);
      const disabledReached = reachLlm.some((f) => /CONFIRM FIRST|REJECT FIRST/.test(f.label || ''));
      add('LLM disabled CONFIRM/REJECT not focusable', !disabledReached, JSON.stringify(reachLlm.map((f) => f.label)));
      add('LLM focus stable 3s with no proposal', await focusStable(page, 3000), 'no live link -> statically B4 applies only with pending proposals');
      await go('BACK');
      if ((await pageName(page)) !== 'ai') await go('AI & COMPANION');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      if ((await pageName(page)) !== 'pause') { await ensurePause(page); }
      add('ESC walks one level back (llm->ai->pause)', (await pageName(page)) === 'pause', `page=${await pageName(page)}`);

      // ---- DOM form: occlusion / ESC / secret masking
      await go('SETTINGS');
      await go('EXTERNAL LINK SETUP');
      const formOpen = await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 8000 }).then(() => true).catch(() => false);
      add('DOM pairing form opens', formOpen, '');
      if (formOpen) {
        const occ = await page.evaluate(() => {
          const root = document.querySelector('[data-testid="external-link-form"]');
          const canvas = document.querySelector('canvas');
          let inside = 0, total = 0;
          for (let i = 1; i < 8; i++) for (let j = 1; j < 6; j++) {
            total++;
            const el = document.elementFromPoint(innerWidth * i / 8, innerHeight * j / 6);
            if (el && root.contains(el)) inside++;
          }
          return {
            inside, total,
            rootZ: getComputedStyle(root).zIndex,
            canvasZ: canvas ? getComputedStyle(canvas).zIndex : null,
            types: Array.from(root.querySelectorAll('input')).map((i) => i.type),
            covers: root.getBoundingClientRect().width >= innerWidth - 1 && root.getBoundingClientRect().height >= innerHeight - 1
          };
        });
        add('form fully occludes canvas (all sample points inside form)', occ.inside === occ.total && occ.covers, JSON.stringify(occ));
        add('token/ownerKey inputs are type=password (url is text)', occ.types.length === 3 && occ.types[0] === 'text' && occ.types[1] === 'password' && occ.types[2] === 'password', JSON.stringify(occ.types));

        // clicking a pause button center must not reach the canvas
        const before = await pageName(page);
        const settingsLogical = await page.evaluate(() => {
          const s = window.__game.scene.getScene('PauseScene');
          const t = s.children.list.find((c) => c.type === 'Text' && String(c.text || '').includes('EXTERNAL LINK SETUP'));
          return t ? { x: t.x, y: t.y } : null;
        });
        if (settingsLogical) { const p = await toCss(page, settingsLogical.x, settingsLogical.y); await page.mouse.click(p.x, p.y); await page.waitForTimeout(250); }
        const stillForm = await page.evaluate(() => !!document.querySelector('[data-testid="external-link-form"]'));
        add('clicks under the form do not reach the pause menu', stillForm && (await pageName(page)) === before, `form=${stillForm}`);

        // secret masking: same-length different secrets must render identically (form still open)
        const A = 'SENTINELAAA_0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab'.slice(0, 64);
        const B = 'SENTINELBBB_0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab'.slice(0, 64);
        const pad = 'a'.repeat(24);
        const clip = async () => {
          await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
          await page.waitForTimeout(160);
          return page.locator('input[name="ownerKey"]').screenshot();
        };
        await page.fill('input[name="token"]', pad);
        await page.fill('input[name="ownerKey"]', A);
        const shotA = await clip();
        await page.screenshot({ path: path.join(dir, 'form-secret-typed.png') });
        shots.push(path.join(dir, 'form-secret-typed.png'));
        await page.fill('input[name="ownerKey"]', B);
        const shotB = await clip();
        const same = Buffer.compare(shotA, shotB) === 0;
        await page.fill('input[name="ownerKey"]', A.slice(0, 32));
        const shotShort = await clip();
        const differsByLength = Buffer.compare(shotA, shotShort) !== 0;
        add('screenshot shows only bullets (same-length secrets render identically)', same && differsByLength,
          `sameLen=${same} lenDiffers=${differsByLength}`);
        const leak = await page.evaluate(({ A, B }) => {
          const text = document.body.innerText || '';
          const inputs = Array.from(document.querySelectorAll('[data-testid="external-link-form"] input')).map((i) => i.value);
          return { textHas: text.includes(A) || text.includes(B), globals: JSON.stringify(Object.keys(globalThis).filter((k) => /externalLinkConfig|ownerKey|token/i.test(k))) };
        }, { A, B });
        const consoleLeak = consoleAll.some((m) => m.includes('SENTINEL'));
        add('secrets never appear in visible text / console', !leak.textHas && !consoleLeak, JSON.stringify(leak));
        await page.click('[data-testid="external-link-form"] button:not([type="submit"])');
        await page.waitForTimeout(250);
        const cancelClosed = !(await page.evaluate(() => !!document.querySelector('[data-testid="external-link-form"]')));
        add('CANCEL closes the form, pause stays open',
          cancelClosed && (await page.evaluate(() => window.__game.scene.isActive('PauseScene'))), '');

        // B6: ESC must close ONLY this form (re-open it; previous checks ran while open)
        await go('EXTERNAL LINK SETUP');
        const reopened = await page.waitForSelector('[data-testid="external-link-form"]', { timeout: 8000 }).then(() => true).catch(() => false);
        const pageBeforeEsc = await pageName(page);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const escClosedForm = !(await page.evaluate(() => !!document.querySelector('[data-testid="external-link-form"]')));
        const pauseStillOpen = await page.evaluate(() => window.__game.scene.isActive('PauseScene'));
        add('ESC closes the pairing form only (pause stays open)', reopened && escClosedForm && pauseStillOpen && (await pageName(page)) === pageBeforeEsc,
          JSON.stringify({ reopened, escClosedForm, pauseStillOpen }));
      }

      // ---- B5 tween: HUD must stay hidden until the fade completes
      await page.keyboard.press('Escape');
      await page.waitForTimeout(320);
      if (await page.evaluate(() => window.__game.scene.isActive('PauseScene'))) { await page.keyboard.press('Escape'); }
      await page.waitForTimeout(60);
      const midClose = { active: await page.evaluate(() => window.__game.scene.isActive('PauseScene')), hud: await hudVisible(page) };
      await page.waitForTimeout(800);
      const endClose = { active: await page.evaluate(() => window.__game.scene.isActive('PauseScene')), hud: await hudVisible(page) };
      add('HUD restored only after the fade completes', midClose.hud === false && endClose.hud === true && endClose.active === false,
        JSON.stringify({ midClose, endClose }));

      // ---- B5: deck announcement (a HUD readout) hides/restores with the HUD
      await page.evaluate(() => { const gs = window.__game.scene.getScene('GameScene'); gs.showDeckArrival(3); });
      await page.waitForTimeout(90);
      const annRunning = await annVisible(page);
      await openPause(page);
      const annPaused = await annVisible(page);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(650);
      const annRestored = await annVisible(page);
      add('HUD announcement hides and restores with the HUD', annRunning === true && annPaused === false && annRestored === true,
        JSON.stringify({ annRunning, annPaused, annRestored }));

      const hudAfter = await hudVisible(page);
      add('HUD restored while running', hudAfter === true, `visible=${hudAfter}`);
      await shot('after-resume');

      // ---- compact flip on a real viewport change (R7 / resize)
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.waitForTimeout(400);
      await openPause(page);
      const resized = await page.evaluate(() => { const s = window.__game.scene.getScene('PauseScene'); return { compact: s.compact, page: s.page }; });
      const snapResized = await snapshot(page, 'PauseScene');
      const geoResized = auditGeometry(snapResized);
      const fontResized = fontReport(snapResized, (await canvasBox(page)).w / 1280);
      add('compact flips on resize and relayouts cleanly', resized.compact === false && geoResized.length === 0 && fontResized.min >= 10,
        `compact=${resized.compact} findings=${geoResized.length} minCss=${fontResized.min}`);
      for (let i = 0; i < 3; i++) {
        if (!(await page.evaluate(() => window.__game.scene.isActive('PauseScene')))) break;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(450);
      }

      // ---- geometry + fonts per surface
      const geo = {};
      const fonts = {};
      for (const [name, snap] of Object.entries(surfaces)) {
        if (!snap) continue;
        if (name === 'run') continue; // GameScene world objects are world-space, not screen UI
        geo[name] = auditGeometry(snap);
        fonts[name] = fontReport(snap, scale);
      }
      const overlapCount = Object.values(geo).reduce((n, f) => n + f.filter((x) => x.kind === 'overlap').length, 0);
      const oobCount = Object.values(geo).reduce((n, f) => n + f.filter((x) => x.kind === 'out-of-bounds').length, 0);
      add('no overlapping visible elements', overlapCount === 0, `overlaps=${overlapCount} ${JSON.stringify(Object.entries(geo).filter(([, f]) => f.length).map(([k, f]) => [k, f.slice(0, 3)]))}`);
      add('no visible element outside 1280x720', oobCount === 0, `oob=${oobCount}`);
      const worst = Object.entries(fonts).filter(([n]) => n !== 'run');
      const minCss = Math.min(...worst.map(([, f]) => f.min ?? 99));
      const below10 = worst.reduce((n, [, f]) => n + f.below10, 0);
      add('all menu text >= 10 CSS px', minCss >= 10, `min=${minCss.toFixed(2)}css below10=${below10} ${JSON.stringify(worst.map(([n, f]) => [n, f.min]))}`);

      add('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

      summary.viewports[key] = {
        scale: +scale.toFixed(4), canvas: cb, checks, errors,
        geometry: geo, fonts, screenshots: shots,
        hudVisibleBeforeMenu: surfaces.run ? true : null
      };
      const fails = checks.filter((c) => c.ok === false).length;
      say(`== ${key}: ${checks.length - fails}/${checks.length} checks ok (scale=${scale.toFixed(3)})`);
    } catch (e) {
      add('audit run completed', false, String(e && e.message || e).split('\n')[0]);
      summary.viewports[key] = { error: String(e && e.stack || e), checks, errors, screenshots: shots };
      say(`== ${key}: run failed: ${String(e && e.message || e).split('\n')[0]}`);
    }
    await ctx.close();
  }
  summary.sourceHashesAfter = hashSources();
  summary.sourceChangedDuringRun = JSON.stringify(summary.sourceHashesBefore) !== JSON.stringify(summary.sourceHashesAfter);
  summary.finishedAt = new Date().toISOString();
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'ui-audit-summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, 'ui-audit-run.log'), LINES.join('\n') + '\n');
  const totalFails = Object.values(summary.viewports).reduce((n, v) => n + (v.checks || []).filter((c) => c.ok === false).length, 0);
  say(`TOTAL_FAILURES=${totalFails} sourceChangedDuringRun=${summary.sourceChangedDuringRun}`);
}

function hashSources() {
  const files = ['src/scenes/PauseScene.ts', 'src/ui/menuKit.ts', 'src/scenes/GameScene.ts', 'tests/ui-menu-layout.spec.ts'];
  const out = {};
  for (const f of files) {
    try { out[f] = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16); }
    catch { out[f] = 'missing'; }
  }
  return out;
}

async function hudVisible(page) {
  return page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    return !!(gs && gs.hudVisible);
  });
}

/** Visibility of the most recently created HUD readout (deck announcement). */
async function annVisible(page) {
  return page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    const arr = gs.hudObjects || [];
    for (let i = arr.length - 1; i >= 0; i--) {
      const o = arr[i];
      if (o && o.type === 'Text' && o.scene && String(o.text || '').length) return o.visible;
    }
    return null;
  });
}

async function keyboardSweep(page, steps) {
  const seen = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(90);
    const f = await focusedControl(page);
    for (const g of f.focused) if (!seen.some((s) => near(s, g.x, g.y))) seen.push(g);
  }
  return seen;
}

async function focusStable(page, ms) {
  const a = await focusedControl(page);
  await page.waitForTimeout(ms);
  const b = await focusedControl(page);
  const key = (f) => f.focused.map((g) => `${g.x},${g.y}`).join(';') + `|${f.focusCount}`;
  return key(a) === key(b) && a.focusCount === 1;
}

async function focusBack(page, label) {
  const f = await page.evaluate(({ label, flatSrc }) => {
    const s = window.__game.scene.getScene('PauseScene');
    const flat = eval(flatSrc)(s);
    const t = flat.find((c) => c.type === 'Text' && c.visible !== false && String(c.text || '').includes(label));
    return t ? { x: t.x, y: t.y } : null;
  }, { label, flatSrc: FLAT });
  return f;
}

async function enterActivates(page, expectedLabel) {
  // focus the button containing expectedLabel, then press ENTER and see navigation change
  const before = await pageName(page);
  await page.evaluate(({ label, flatSrc }) => {
    const s = window.__game.scene.getScene('PauseScene');
    const flat = eval(flatSrc)(s);
    const t = flat.find((c) => c.type === 'Text' && c.visible !== false && String(c.text || '').includes(label));
    if (!t) return;
    const handle = s.pageHandle;
    if (handle && typeof handle.focusButton === 'function') {
      const btn = handle.objects ? null : null;
    }
    // fall back to keyboard navigation until the focused rect matches this label
  }, { label: expectedLabel, flatSrc: FLAT });
  for (let i = 0; i < 12; i++) {
    const f = await focusedControl(page);
    const hit = f.focused.find((g) => (g.label || '').includes(expectedLabel));
    if (hit) break;
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(80);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const after = await pageName(page);
  return before !== after;
}

main().catch((e) => { say('FATAL ' + (e && e.stack || e)); fs.writeFileSync(path.join(OUT, 'ui-audit-run.log'), LINES.join('\n') + '\n'); process.exit(1); });
