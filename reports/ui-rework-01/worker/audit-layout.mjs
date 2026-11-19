// UI-REWORK-01 worker-side layout audit (not part of tests/).
// Mirrors the tester's audit rules (visible interactive inside viewport; no
// overlap between visible non-background objects) across every new Pause page.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ?? '5177';
const BASE = `http://localhost:${PORT}/`;
const OUT = path.resolve('reports/ui-rework-01/worker/audit');
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [[1920, 1080], [1600, 900], [1366, 768], [1280, 720], [1024, 768], [800, 600]];

function intersectionArea(a, b) {
  const x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return x <= 0 || y <= 0 ? 0 : x * y;
}
function describe(e) {
  const label = e.text ? `"${e.text.slice(0, 42)}"` : e.type;
  return `${e.type}${label}${e.interactive ? ' [clickable]' : ''}`;
}
function audit(snap) {
  const findings = [];
  const { w: W, h: H } = snap.logical;
  const els = snap.elements.filter((e) => e.box);
  for (const e of els) {
    const b = e.box;
    if (!e.background && (b.x < -1 || b.y < -1 || b.x + b.w > W + 1 || b.y + b.h > H + 1)) {
      findings.push({ kind: 'clipped', a: describe(e) });
    }
    if (!e.visible && e.interactive) findings.push({ kind: 'hidden-but-interactive', a: describe(e) });
  }
  const visible = els.filter((e) => e.visible && e.alpha > 0.05 && !e.background);
  for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
    const a = visible[i], b = visible[j];
    const area = intersectionArea(a.box, b.box);
    if (area <= 0.5) continue;
    // Only allow a text label inside its OWN control rectangle. A text that
    // merely touches a different interactive rectangle is a real overlap.
    const contains = (outer, inner) => inner.x >= outer.x - 2 && inner.y >= outer.y - 2 &&
      inner.x + inner.w <= outer.x + outer.w + 2 && inner.y + inner.h <= outer.y + outer.h + 2;
    const sameControl = (a.text && b.type === 'Rectangle' && !b.text && contains(b.box, a.box)) ||
      (b.text && a.type === 'Rectangle' && !a.text && contains(a.box, b.box));
    if (sameControl) continue;
    findings.push({ kind: 'overlap', a: describe(a), b: describe(b), area });
  }
  return findings;
}
async function layout(page) {
  return page.evaluate(() => {
    const g = window.__game;
    const s = g.scene.getScene('PauseScene');
    const W = g.scale.gameSize.width, H = g.scale.gameSize.height;
    const elements = (s.children.list || []).map((c) => {
      let box = null;
      try { const b = c.getBounds ? c.getBounds() : null; if (b && Number.isFinite(b.x)) box = { x: b.x, y: b.y, w: b.width, h: b.height }; } catch { box = null; }
      const background = !!(box && box.w >= W * 0.9 && box.h >= H * 0.9);
      return { type: c.type, text: c.type === 'Text' ? String(c.text) : null, box,
        visible: c.visible !== false, alpha: typeof c.alpha === 'number' ? c.alpha : 1,
        interactive: !!c.input && c.input.enabled !== false, background };
    });
    return { scene: 'PauseScene', logical: { w: W, h: H }, elements };
  });
}
async function toCss(page, lx, ly) {
  return page.evaluate(({ x, y, W, H }) => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.x + (x * r.width) / W, y: r.y + (y * r.height) / H };
  }, { x: lx, y: ly, W: 1280, H: 720 });
}
async function clickField(page, name) {
  const p = await page.evaluate((n) => {
    const s = window.__game.scene.getScene('PauseScene');
    const obj = s[n];
    if (!obj) return null;
    const target = obj.rect ?? obj;
    if (!target || !target.input) return null;
    const b = target.getBounds();
    return { x: b.centerX, y: b.centerY };
  }, name);
  if (!p) throw new Error(`clickable field not found: ${name}`);
  const css = await toCss(page, p.x, p.y);
  await page.mouse.click(css.x, css.y);
  await page.waitForTimeout(260);
}
async function clickText(page, label, sceneKey = 'PauseScene') {
  const p = await page.evaluate(({ l, key }) => {
    const s = window.__game.scene.getScene(key);
    const t = s.children.list.find((c) => c.type === 'Text' && c.visible !== false && String(c.text).includes(l));
    if (!t) return null;
    const b = t.getBounds();
    return { x: b.centerX, y: b.centerY };
  }, { l: label, key: sceneKey });
  if (!p) throw new Error(`text not found: ${label} in ${sceneKey}`);
  const css = await toCss(page, p.x, p.y);
  await page.mouse.click(css.x, css.y);
  await page.waitForTimeout(260);
}
async function boot(page) {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.removeItem('last_signal_save_v1'));
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 20000 });
  await clickText(page, 'NEW RUN', 'MainMenuScene');
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(400);
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const report = {};
try {
  for (const [w, h] of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: h });
    await boot(page);
    report[`${w}x${h}`] = {};
    // pause root
    report[`${w}x${h}`].pause = audit(await layout(page));
    await clickField(page, 'btnAi');
    report[`${w}x${h}`].ai = audit(await layout(page));
    await clickField(page, 'btnEcho');
    report[`${w}x${h}`].echo = audit(await layout(page));
    await clickField(page, 'btnEchoBack');
    await clickField(page, 'btnLlm');
    report[`${w}x${h}`].llm = audit(await layout(page));
    await clickField(page, 'btnLlmBack');
    await clickField(page, 'btnAiBack');
    await clickField(page, 'btnSettings');
    report[`${w}x${h}`].settings = audit(await layout(page));
    await clickField(page, 'btnSettingsBack');
    await clickField(page, 'btnInventory');
    report[`${w}x${h}`].inventory = audit(await layout(page));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
  }
} finally {
  writeFileSync(path.join(OUT, 'layout-findings.json'), JSON.stringify(report, null, 2));
  await browser.close();
}

let total = 0;
for (const [vp, surfaces] of Object.entries(report)) {
  for (const [name, findings] of Object.entries(surfaces)) {
    if (findings.length) {
      total += findings.length;
      console.log(`${vp} ${name}: ${findings.length} finding(s)`);
      for (const f of findings.slice(0, 8)) console.log(`   ${f.kind}: ${f.a}${f.b ? ` <> ${f.b}` : ''}`);
    }
  }
}
console.log(total ? `\nTOTAL findings: ${total}` : '\n0 findings across all surfaces/viewports');
process.exit(0);
