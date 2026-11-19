// UI-REWORK-01 — worker live capture + smoke (not part of tests/).
// Renders the real Pause surfaces in Chromium and writes screenshots to
// developer/. Also asserts HUD hide/restore and layered ESC.
import { chromium } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = process.env.PORT ?? '5177';
const BASE = `http://localhost:${PORT}/`;
const OUT = path.resolve('reports/ui-rework-01/developer');
mkdirSync(OUT, { recursive: true });

const errors = [];
const results = [];

function log(step, ok, detail = '') {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail ? ` — ${detail}` : ''}`);
}

async function textBox(page, sceneKey, label, exact = false) {
  return page.evaluate(({ key, label, exact }) => {
    const g = window.__game;
    const s = g.scene.getScene(key);
    if (!s || !g.scene.isActive(key)) return null;
    const t = s.children.list.find((c) => {
      if (c.type !== 'Text' || c.visible === false || !c.text) return false;
      return exact ? String(c.text).trim() === label : String(c.text).includes(label);
    });
    if (!t) return null;
    const b = t.getBounds();
    return { x: b.centerX, y: b.centerY };
  }, { key: sceneKey, label, exact });
}

async function clickText(page, sceneKey, label, exact = false) {
  const p = await textBox(page, sceneKey, label, exact);
  if (!p) throw new Error(`text not found: ${label} in ${sceneKey}`);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(320);
  return p;
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  return file;
}

async function bootRun(page) {
  await page.goto(BASE);
  await page.evaluate(() => localStorage.removeItem('last_signal_save_v1'));
  await page.reload();
  await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), { timeout: 20000 });
  await clickText(page, 'MainMenuScene', 'NEW RUN');
  await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(900);
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

try {
  await bootRun(page);
  const hudBefore = await page.evaluate(() => window.__game.scene.getScene('GameScene').hud.visible);
  await shot(page, 'pause-run-hud-1280x720.png');

  // B5: a live deck-arrival announcement is part of the HUD and must hide too.
  await page.evaluate(() => { window.__game.scene.getScene('GameScene').showDeckArrival(0); });
  await page.waitForTimeout(120);
  const hudAlive = await page.evaluate(() => window.__game.scene.getScene('GameScene').hudObjects.filter((o) => o.scene).length);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(450);
  const hudPaused = await page.evaluate(() => window.__game.scene.getScene('GameScene').hud.visible);
  log('HUD visible before menu', hudBefore === true, String(hudBefore));
  log('HUD hidden while paused', hudPaused === false, String(hudPaused));
  const allHudHidden = await page.evaluate(() => {
    const gs = window.__game.scene.getScene('GameScene');
    const alive = gs.hudObjects.filter((o) => o.scene);
    return { all: alive.length > 0 && alive.every((o) => o.visible === false), alive: alive.length };
  });
  log('deck announcement + every HUD object hidden while paused', allHudHidden.all, `objects=${allHudHidden.alive} (before pause=${hudAlive})`);
  await shot(page, 'pause-root-1280x720.png');
  const api = await page.evaluate(() => {
    const s = window.__game.scene.getScene('PauseScene');
    return {
      page: s.currentPage,
      objects: Array.isArray(s.uiObjects) ? s.uiObjects.length : -1,
      buttons: Array.isArray(s.uiButtons) ? s.uiButtons.map((b) => String(b.label.text)) : null,
      confirmAliasSame: s.confirmHandle === s.llmConfirm,
      rejectAliasSame: s.rejectHandle === s.llmReject
    };
  });
  log('read-only test interface (currentPage/uiObjects/uiButtons)', api.page === 'pause' && api.objects > 0 && Array.isArray(api.buttons) && api.buttons.includes('RESUME'), JSON.stringify({ page: api.page, objects: api.objects, buttons: api.buttons }));
  log('confirm/reject handles are the real controls (read-only aliases only)', api.confirmAliasSame && api.rejectAliasSame, JSON.stringify({ confirmAliasSame: api.confirmAliasSame, rejectAliasSame: api.rejectAliasSame }));

  const rootLabels = await page.evaluate(() => {
    const s = window.__game.scene.getScene('PauseScene');
    return s.children.list.filter((c) => c.type === 'Text').map((c) => String(c.text));
  });
  for (const label of ['RESUME', 'INVENTORY', 'SETTINGS', 'AI & COMPANION', 'QUIT TO MENU']) {
    log(`root entry "${label}"`, rootLabels.some((t) => t === label));
  }
  log('root footer has honest AI CONTROL: OFF', rootLabels.some((t) => t.includes('AI CONTROL: OFF')));
  log('root footer has EXTERNAL AGENT  NOT CONNECTED', rootLabels.some((t) => t.includes('EXTERNAL AGENT  NOT CONNECTED')));

  await clickText(page, 'PauseScene', 'AI & COMPANION');
  await shot(page, 'pause-ai-1280x720.png');
  let aiLabels = await page.evaluate(() => window.__game.scene.getScene('PauseScene').children.list.filter((c) => c.type === 'Text').map((c) => String(c.text)));
  log('AI page has AI CONTROL toggle', aiLabels.some((t) => t.startsWith('AI CONTROL:')));
  log('AI page distinguishes LOCAL DETERMINISTIC', aiLabels.some((t) => t.includes('LOCAL DETERMINISTIC')));
  log('AI page has ECHO COMPANION entry', aiLabels.some((t) => t.includes('ECHO COMPANION')));
  log('AI page has LLM COMPANION entry', aiLabels.some((t) => t.includes('LLM COMPANION')));
  log('AI page has AUTHORIZE EXTERNAL AGENT', aiLabels.some((t) => t.includes('AUTHORIZE EXTERNAL AGENT')));

  await clickText(page, 'PauseScene', 'ECHO COMPANION');
  await shot(page, 'pause-echo-1280x720.png');
  const echoLabels = await page.evaluate(() => window.__game.scene.getScene('PauseScene').children.list.filter((c) => c.type === 'Text').map((c) => String(c.text)));
  log('echo page has ENABLE ECHO', echoLabels.some((t) => t === 'ENABLE ECHO'));

  await clickText(page, 'PauseScene', 'BACK');
  await clickText(page, 'PauseScene', 'LLM COMPANION');
  await shot(page, 'pause-llm-1280x720.png');
  const llm = await page.evaluate(() => {
    const s = window.__game.scene.getScene('PauseScene');
    const texts = s.children.list.filter((c) => c.type === 'Text');
    const confirm = texts.find((c) => String(c.text).startsWith('CONFIRM FIRST PROPOSAL'));
    const reject = texts.find((c) => String(c.text).startsWith('REJECT FIRST PROPOSAL'));
    return {
      labels: texts.map((c) => String(c.text)),
      confirmEnabled: !!(confirm && confirm.scene && s.btnResume === null),
      pending: texts.find((c) => /pending proposal/i.test(String(c.text)))?.text ?? ''
    };
  });
  log('LLM page shows NO PROPOSAL honestly', llm.labels.some((t) => /no pending proposal/i.test(t)));
  log('LLM page has ENABLE / RE-AUTHORIZE', llm.labels.some((t) => t.includes('ENABLE / RE-AUTHORIZE')));

  // Layered ESC: llm -> ai -> pause -> resume.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  log('ESC from LLM returns to AI page (PauseScene still open)', await page.evaluate(() => window.__game.scene.isActive('PauseScene')));
  const stage1 = await page.evaluate(() => window.__game.scene.getScene('PauseScene').children.list.some((c) => c.type === 'Text' && String(c.text).includes('HUMAN ALWAYS RETAINS CONTROL')));
  log('after ESC we are on AI page', stage1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const stage2 = await page.evaluate(() => window.__game.scene.getScene('PauseScene').children.list.some((c) => c.type === 'Text' && String(c.text).trim() === 'PAUSED'));
  log('second ESC returns to Pause root', stage2);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__game.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(400);
  const hudRestored = await page.evaluate(() => window.__game.scene.getScene('GameScene').hud.visible);
  log('third ESC resumes and restores HUD', hudRestored === true, String(hudRestored));

  // Settings + inventory surfaces.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await clickText(page, 'PauseScene', 'SETTINGS');
  await shot(page, 'pause-settings-1280x720.png');
  const settingsLabels = await page.evaluate(() => window.__game.scene.getScene('PauseScene').children.list.filter((c) => c.type === 'Text').map((c) => String(c.text)));
  for (const h of ['AUDIO', 'DISPLAY', 'SIGNAL', 'CONNECTION']) log(`settings group ${h}`, settingsLabels.includes(h));
  await clickText(page, 'PauseScene', 'BACK');
  await clickText(page, 'PauseScene', 'INVENTORY');
  await shot(page, 'pause-inventory-1280x720.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  log('ESC from inventory returns to Pause root', await page.evaluate(() => window.__game.scene.getScene('PauseScene').children.list.some((c) => c.type === 'Text' && String(c.text).trim() === 'PAUSED')));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__game.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(300);

  log('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  log('capture script aborted', false, String(err));
} finally {
  writeFileSync(path.join(OUT, 'pause-smoke.json'), JSON.stringify({ results, errors }, null, 2));
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
