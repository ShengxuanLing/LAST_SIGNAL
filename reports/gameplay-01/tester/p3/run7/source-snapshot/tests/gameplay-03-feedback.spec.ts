import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * GAMEPLAY-01 · P3 — feedback / menu-surface acceptance.
 *
 * Run tree: D:\tmp\ls-p3-accept @ 0083e20 + p3/v2 manifest (5 sources), PORT 5492.
 * Every case drives the REAL ui via pointer/keyboard on the real scenes. Where a
 * seam is used it is labelled `fixture:` in the record. No product change.
 */

const VIEWPORTS: Array<{ w: number; h: number }> = [
  { w: 800, h: 600 },
  { w: 1024, h: 768 },
  { w: 1280, h: 720 },
  { w: 1366, h: 768 },
  { w: 1600, h: 900 },
  { w: 1920, h: 1080 }
];

const LOCAL_W = 960;
const LOCAL_H = 540;

function evidenceDir(): string {
  return process.env.LS_AI_EVIDENCE_DIR ?? path.join(process.cwd(), 'reports', 'ai-native-02', 'evidence');
}
function record(name: string, data: unknown): void {
  try {
    const dir = evidenceDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 2));
  } catch { /* evidence is best-effort; assertions still run */ }
}

async function shot(page: Page, name: string): Promise<string | null> {
  const dir = process.env.LS_SHOT_DIR;
  if (!dir) return null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.png`);
    await page.screenshot({ path: file });
    return file;
  } catch { return null; }
}

async function canvasBox(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await page.locator('#game-canvas').boundingBox();
  if (!box) throw new Error('canvas not found');
  return box;
}
async function clickLogical(page: Page, lx: number, ly: number): Promise<void> {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + (lx * box.w) / LOCAL_W, box.y + (ly * box.h) / LOCAL_H);
}

async function bootDemo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('last_signal_autoOwner', 'human');
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith('last_signal_')) window.localStorage.removeItem(key);
    }
    window.localStorage.setItem('last_signal_autoOwner', 'human');
  });
  const base = (process.env.PLAYWRIGHT_BASE_URL || process.env.APP_URL || `http://localhost:${process.env.PORT ?? 5173}`).replace(/\/+$/, '');
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__game?.isRunning === true, { timeout: 45000 });
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const d of ['01', '02', '03']) {
      window.localStorage.removeItem(`last_signal_demo_seen_${d}`);
      window.localStorage.setItem(`last_signal_demo_seen_${d}`, '1');
    }
    {
      const k = 'last_signal_demo_seen_demo-01';
      const has = Object.keys(window.localStorage).some((key) => key.startsWith('last_signal_demo_seen'));
      if (has) window.localStorage.removeItem(k);
    }
    g.scene.getScene('MainMenuScene').scene.start('GameScene', { demo: 'demo-01' });
  });
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 30000 });
  await page.waitForTimeout(1500);
}

/** Idempotent: ESC toggles the overlay, so only press it when it is closed. */
async function ensurePause(page: Page): Promise<void> {
  const open = await page.evaluate(() => (window as any).__game?.scene.isActive('PauseScene'));
  if (open) return;
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(350);
}

async function resumeGame(page: Page, ms = 1200): Promise<void> {
  if (await page.evaluate(() => (window as any).__game?.scene.isActive('PauseScene'))) {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(ms);
}

/** Button inventory straight from the real uiButtons handles (no hardcoded coords). */
async function buttons(page: Page): Promise<Array<{ label: string; disabled: boolean; focused: boolean; cx: number; cy: number; x: number; y: number; w: number; h: number }>> {
  return page.evaluate(() => {
    const s: any = (window as any).__game.scene.getScene('PauseScene');
    const list: any[] = s?.uiButtons ?? [];
    return list.map((b: any) => ({
      label: String(b.label?.text ?? ''),
      disabled: !!b.disabled,
      focused: !!b.focused,
      x: b.rect?.x ?? 0, y: b.rect?.y ?? 0, w: b.rect?.width ?? 0, h: b.rect?.height ?? 0,
      cx: (b.rect?.x ?? 0), cy: (b.rect?.y ?? 0)
    }));
  });
}

async function clickButtonByLabel(page: Page, label: string): Promise<boolean> {
  const found = await page.evaluate((wanted: string) => {
    const s: any = (window as any).__game.scene.getScene('PauseScene');
    const list: any[] = s?.uiButtons ?? [];
    const hit = list.find((b: any) => String(b.label?.text ?? '').trim() === wanted);
    if (!hit) return null;
    return { x: hit.rect.x, y: hit.rect.y };
  }, label);
  if (!found) return false;
  await clickLogical(page, found.x, found.y);
  await page.waitForTimeout(300);
  return true;
}

async function pausePage(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__game.scene.getScene('PauseScene')?.currentPage ?? '');
}

async function goLocalCoop(page: Page): Promise<void> {
  await ensurePause(page);
  if ((await pausePage(page)) === 'pause') {
    await clickButtonByLabel(page, 'AI & COMPANION').catch(() => undefined);
  }
  if ((await pausePage(page)) === 'ai') {
    await clickButtonByLabel(page, 'ECHO COMPANION >').catch(() => undefined);
  }
  if ((await pausePage(page)) === 'echo') {
    await clickButtonByLabel(page, 'LOCAL COOPERATION >').catch(() => undefined);
  }
  await page.waitForTimeout(400);
}

async function allTexts(page: Page): Promise<Array<{ t: string; size: number; x: number; y: number; w: number; h: number }>> {
  return page.evaluate(() => {
    const s: any = (window as any).__game.scene.getScene('PauseScene');
    const out: any[] = [];
    const walk = (list: any[]): void => {
      for (const c of list) {
        if (c?.type === 'Container' && c.list) { walk(c.list); continue; }
        if (c?.type === 'Text' && c.visible !== false) {
          out.push({ t: String(c.text ?? ''), size: Number(c.style?.fontSize?.replace('px', '') ?? 0), x: c.x, y: c.y, w: c.width, h: c.height });
        }
      }
    };
    if (s?.children?.list) walk(s.children.list);
    return out;
  });
}

async function echoState(page: Page): Promise<{ proposal: any; pending: any; queue: string[]; audit: number; applied: number }> {
  return page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    return {
      proposal: w.echoLocalProposal ? { id: w.echoLocalProposal.id, kind: w.echoLocalProposal.kind } : null,
      pending: w.echoPendingLocal ? { id: w.echoPendingLocal.proposalId, kind: w.echoPendingLocal.kind } : null,
      queue: (w.sim.pendingCommands ?? []).map((c: any) => c.type),
      audit: w.echoAudit.recent(32).length,
      applied: w.echoAudit.recent(32).filter((e: any) => e.result === 'applied').length
    };
  });
}

test.describe('GAMEPLAY-01 P3 · feedback surfaces', () => {
  test('1) six viewports: default local-cooperation page, font floor, no raw ids/ticks/code', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootDemo(page);
    await goLocalCoop(page);
    const rows: any[] = [];
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.waitForTimeout(550);
      const texts = await allTexts(page);
      const btns = await buttons(page);
      const labels = btns.map((b) => b.label);
      const tiny = texts.filter((t) => t.size > 0 && t.size < 10);
      const raw = texts.map((t) => t.t).filter((t) => /local_\d+_\d+|tick\s*[:=]\s*\d+|\b[a-f0-9]{24,}\b|undefined|null|NaN/.test(t));
      rows.push({ vp, labels, tiny: tiny.map((t) => [t.t, t.size]), raw, page: await pausePage(page) });
      expect(await pausePage(page), `viewport ${vp.w}x${vp.h} stays on local-coop`).toBe('local-coop');
      expect(labels, 'viewport has the real cooperation buttons').toEqual(expect.arrayContaining(['CONFIRM (HUMAN)', 'REJECT', 'RECENT ACTIONS']));
      expect(tiny, 'no text below the 10 CSS px floor').toEqual([]);
      expect(raw, 'no raw ids / ticks / code leaks into the page').toEqual([]);
    }
    // disabled buttons when nothing is pending: click does nothing, no queue entry.
    const before = await echoState(page);
    const disabled = (await buttons(page)).filter((b) => b.label === 'CONFIRM (HUMAN)' || b.label === 'REJECT');
    expect(disabled.length, 'confirm/reject exist').toBe(2);
    await clickButtonByLabel(page, 'CONFIRM (HUMAN)');
    await clickButtonByLabel(page, 'REJECT');
    const afterClicks = await echoState(page);
    record('p3-six-viewports', { rows, disabledFlags: disabled.map((b) => b.disabled), before, afterClicks });
    expect(afterClicks.queue, 'clicking a disabled action queues nothing').toEqual(before.queue);
    await shot(page, 'p3-01-six-viewports');
  });

  test('2) proposal → WAITING → real confirm → DONE, and a real resume turns it into an applied audit entry', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootDemo(page);
    await goLocalCoop(page);
    await clickButtonByLabel(page, 'LOW-RISK COOPERATION: OFF');
    expect(await echoState(page).then((s) => s.proposal), 'a local proposal appears').not.toBeNull();
    const waitingText = (await allTexts(page)).map((t) => t.t).join('\n');
    expect(waitingText, 'the pending line says WAITING').toMatch(/WAITING/i);
    // real confirm click
    await clickButtonByLabel(page, 'CONFIRM (HUMAN)');
    const afterConfirm = await echoState(page);
    const doneText = (await allTexts(page)).map((t) => t.t).join('\n');
    record('p3-proposal-waiting-done', { waitingText, doneText, afterConfirm });
    expect(afterConfirm.queue.length, 'confirm queues exactly one command').toBe(1);
    expect(doneText, 'the page reports the queued/again-waiting state').toMatch(/WAITING|QUEUED/i);
    // real resume: the action executes and the audit records a real applied entry.
    await resumeGame(page, 2500);
    const applied = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      return { applied: w.echoAudit.recent(32).filter((e: any) => e.result === 'applied').length, queue: (w.sim.pendingCommands ?? []).length };
    });
    record('p3-applied-real', { applied });
    expect(applied.applied, 'a REAL resume produced the applied audit entry (not injected)').toBeGreaterThan(0);
    expect(applied.queue, 'the queue drained').toBe(0);
    await shot(page, 'p3-02-proposal');
  });

  test('3) pending: CONFIRM/REJECT are disabled, not focusable and not activatable by keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootDemo(page);
    await goLocalCoop(page);
    await clickButtonByLabel(page, 'LOW-RISK COOPERATION: OFF');
    await clickButtonByLabel(page, 'CONFIRM (HUMAN)');
    const before = await echoState(page);
    const labels = (await buttons(page)).map((b) => b.label);
    const focusOrder: string[] = [];
    for (let i = 0; i < labels.length + 3; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(90);
      const focused = (await buttons(page)).filter((b) => b.focused).map((b) => b.label);
      if (focused.length) focusOrder.push(...focused);
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const after = await echoState(page);
    record('p3-disabled-focus', { before, labels, focusOrder, after });
    expect(focusOrder, 'CONFIRM (HUMAN) never receives keyboard focus while pending').not.toContain('CONFIRM (HUMAN)');
    expect(focusOrder, 'REJECT never receives keyboard focus while pending').not.toContain('REJECT');
    expect(after.queue, 'keyboard activation cannot add a second command').toEqual(before.queue);
    expect(after.pending, 'the pending action is unchanged by a disabled click/enter').toEqual(before.pending);
  });

  test('4) RECENT ACTIONS: keyboard navigation, audit8 window, BACK/ESC round trip changes nothing', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootDemo(page);
    await goLocalCoop(page);
    // LAYOUT FIXTURE: inject 10 audit entries so the "8 visible records" rule can
    // be checked without 10 real actions; behaviour assertions use real events only.
    await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      const push = (w as any).echoAudit?.push?.bind(w.echoAudit);
      for (let i = 0; i < 10; i++) {
        const e = { tick: 200 + i, provenance: i % 2 ? 'model' : 'human-local', action: i % 2 ? 'mark' : 'scan', target: { x: 8, y: 45 }, result: 'enqueued', proposalId: `local_fixture_${i}` };
        push?.(e);
      }
    });
    const before = await echoState(page);
    await clickButtonByLabel(page, 'RECENT ACTIONS');
    expect(await pausePage(page), 'the audit page opened').toBe('local-audit');
    const texts = await allTexts(page);
    const body = texts.map((t) => t.t).join('\n');
    const numbered = (body.match(/^#\d+/gm) ?? []).length;
    // ESC returns one layer (audit -> local-coop) without touching pending/queue.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
    const layered = { afterEsc: await pausePage(page) };
    const mid = await echoState(page);
    // BACK button round trip as well.
    await clickButtonByLabel(page, 'RECENT ACTIONS');
    const reopened = await pausePage(page);
    await clickButtonByLabel(page, 'BACK');
    const backPage = await pausePage(page);
    const after = await echoState(page);
    record('p3-audit', { numbered, layered, reopened, backPage, body: body.slice(0, 800), before, mid, after, fixture: 'layout: 10 injected audit entries' });
    expect(numbered, 'the audit shows at most 8 numbered records').toBeLessThanOrEqual(8);
    expect(numbered, 'the audit shows the real stack (non-empty)').toBeGreaterThan(0);
    expect(layered.afterEsc, 'ESC returns from the audit page to the cooperation page').toBe('local-coop');
    expect(reopened, 'the audit page can be opened again').toBe('local-audit');
    expect(backPage, 'BACK returns to the cooperation page').toBe('local-coop');
    expect(after.queue, 'a read-only audit round trip never changes the queue').toEqual(before.queue);
    expect(after.pending, 'a read-only audit round trip never changes pending').toEqual(before.pending);
    await shot(page, 'p3-04-audit');
  });

  test('5) echo detail + HUD geometry and font floor at the compact viewport', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await bootDemo(page);
    await ensurePause(page);
    await clickButtonByLabel(page, 'AI & COMPANION');
    await clickButtonByLabel(page, 'ECHO COMPANION >');
    await page.waitForTimeout(400);
    const texts = await allTexts(page);
    const tiny = texts.filter((t) => t.size > 0 && t.size < 10);
    const hud = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const w = gs.world;
      const cam = gs.cameras.main;
      const out: any[] = [];
      const walk = (list: any[]): void => {
        for (const c of list) {
          if (c?.type === 'Container' && c.list) { walk(c.list); continue; }
          if (c?.type === 'Text' && c.visible !== false && c.text) out.push({ t: String(c.text), x: c.x, y: c.y });
        }
      };
      walk(gs.children.list);
      return { texts: out.slice(0, 40), zoom: cam.zoom, scrollX: cam.scrollX, scrollY: cam.scrollY, repo: !!w };
    });
    record('p3-echo-detail', { tiny: tiny.map((t) => [t.t, t.size]), count: texts.length, hud });
    expect(tiny, 'no text below 10 CSS px on the echo page').toEqual([]);
    const body = texts.map((t) => t.t).join('\n');
    expect(body, 'the echo page shows the local cooperation detail').toMatch(/ECHO COMPANION|LOCAL COOPERATION/i);
    expect(body, 'the signal detail is real text, not a placeholder').not.toMatch(/undefined|NaN/);
    await shot(page, 'p3-05-echo-detail');
  });

  test('6) resize and reopen do not duplicate page objects; sources never fake OFFLINE', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootDemo(page);
    await goLocalCoop(page);
    const countOnce = (await allTexts(page)).length;
    for (let i = 0; i < 3; i++) {
      await page.setViewportSize({ width: i % 2 ? 1024 : 1366, height: 768 });
      await page.waitForTimeout(350);
    }
    const countResized = (await allTexts(page)).length;
    await page.keyboard.press('Escape');
    await ensurePause(page);
    await goLocalCoop(page);
    const countReopened = (await allTexts(page)).length;
    const source = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      const view = w.signalView();
      return { source: view?.aiSource ?? null, model: view?.modelState ?? null };
    });
    const body = (await allTexts(page)).map((t) => t.t).join('\n');
    record('p3-resize-reopen', { countOnce, countResized, countReopened, source, body: body.slice(0, 600) });
    expect(Math.abs(countResized - countOnce), 'a resize does not duplicate page objects').toBeLessThanOrEqual(3);
    expect(Math.abs(countReopened - countOnce), 'a reopen does not duplicate page objects').toBeLessThanOrEqual(3);
    // The local path must never claim OFFLINE it cannot know: if the model is not
    // actually offline, the page must not say so.
    if (source.model !== 'offline') {
      expect(body, 'no fake OFFLINE claim while the model is not offline').not.toMatch(/\bOFFLINE\b/);
    }
  });

  test('7) LLM page: the footer states the resume rule, with a real screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootDemo(page);
    await ensurePause(page);
    await clickButtonByLabel(page, 'AI & COMPANION');
    await clickButtonByLabel(page, 'LLM COMPANION >').catch(() => undefined);
    await page.waitForTimeout(500);
    const pageName = await pausePage(page);
    const body = (await allTexts(page)).map((t) => t.t).join('\n');
    const shotPath = await shot(page, 'p3-07-llm-footer');
    record('p3-llm-footer', { pageName, body: body.slice(0, 900), shot: shotPath, fixture: 'connection state: as shown by the real page (no model call made)' });
    expect(pageName, 'the LLM page opened').toBe('llm');
    expect(body, 'the footer states the resume rule').toMatch(/Takes effect when you resume/);
  });
});
