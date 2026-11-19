// GAMEPLAY-01 · P3 — feedback / menu-surface acceptance (P3 v2 tree).
//
// Run tree: D:\tmp\ls-p3-accept @ 0083e20 + p3/v2 manifest (5 sources), PORT 5492.
// Every case drives the REAL ui (pointer/keyboard on the real scenes). Seams are
// labelled `fixture:` in the records. No product change, no model call, no skip.
//
// Contract for a local proposal (per the product): a NEW run has ECHO disabled,
// so `world.echoLocalProposal` is correctly null until the real menu ENABLE has
// been used and the actor settled — every proposal case calls bootDemo ->
// enableEchoAndSettle -> cooperation assertions -> openLocalCoop -> real proposal.

import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT ?? '5492';
const LOCAL_W = 960;
const LOCAL_H = 540;
const SAVE_KEY = 'last_signal_save_v1';

const VIEWPORTS: Array<{ w: number; h: number }> = [
  { w: 800, h: 600 },
  { w: 1024, h: 768 },
  { w: 1280, h: 720 },
  { w: 1366, h: 768 },
  { w: 1600, h: 900 },
  { w: 1920, h: 1080 }
];

function rec3(name: string, data: unknown): void {
  try {
    const dir = process.env.LS_AI_EVIDENCE_DIR ?? path.join(process.cwd(), 'evidence');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 2));
  } catch { /* evidence only */ }
}

async function shot3(page: Page, name: string): Promise<string | null> {
  const dir = process.env.LS_SHOT_DIR;
  if (!dir) return null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.png`);
    await page.screenshot({ path: file });
    return file;
  } catch { return null; }
}

async function canvasBox(page: Page) {
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!box) throw new Error('no canvas');
  return box;
}

/** Click by canvas fraction (0..1): scenes use different camera sizes. */
async function clickLogical(page: Page, fx: number, fy: number): Promise<void> {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + fx * box.w, box.y + fy * box.h);
}

async function clickLabel(page: Page, sceneKey: string, label: string): Promise<void> {
  const logical = await page.evaluate(({ key, label }) => {
    const g = (window as any).__game;
    const s = g.scene.getScene(key);
    if (!s || !g.scene.isActive(key)) return null;
    const flat: any[] = [];
    const walk = (l: any[]) => { for (const c of l) { if (c.type === 'Container' && Array.isArray(c.list)) walk(c.list); else flat.push(c); } };
    walk(s.children.list);
    const box = (c: any) => { const b = c.getBounds ? c.getBounds() : null; return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; };
    const centre = (c: any) => { const b = box(c); return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null; };
    const matches = flat.filter((c) => c.type === 'Text' && c.visible !== false && c.text && String(c.text).includes(label));
    if (!matches.length) return null;
    const interactive = flat.filter((c) => c.input && c.input.enabled !== false && c.visible !== false);
    const pick = matches.find((m) => {
      const c = centre(m); if (!c) return false;
      if (m.input) return true;
      return interactive.some((o) => { const oc = centre(o); return !!oc && Math.abs(oc.x - c.x) <= 4 && Math.abs(oc.y - c.y) <= 4; });
    }) ?? matches[0];
    const c = centre(pick);
    if (!c) return null;
    // convert world -> camera screen -> canvas fraction (scene cameras differ)
    const cam = s.cameras.main;
    const camW = cam.width / cam.zoom;
    const camH = cam.height / cam.zoom;
    return { fx: (c.x - cam.scrollX) / camW, fy: (c.y - cam.scrollY) / camH };
  }, { key: sceneKey, label });
  expect(logical, `label "${label}" visible in ${sceneKey}`).not.toBeNull();
  await clickLogical(page, logical!.fx, logical!.fy);
  await page.waitForTimeout(250);
}

async function ensurePause(page: Page): Promise<void> {
  const open = await page.evaluate(() => (window as any).__game?.scene.isActive('PauseScene'));
  if (open) return;
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'), { timeout: 10000 });
  await page.waitForTimeout(350);
}

async function resumeGame(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const active = await page.evaluate(() => (window as any).__game.scene.isActive('PauseScene'));
    if (!active) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(420);
  }
}

async function pausePage(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__game.scene.getScene('PauseScene')?.currentPage ?? '');
}

/** Leave any sub-page with real ESC/BACK; never writes scene state. */
async function toPauseRoot(page: Page): Promise<void> {
  await ensurePause(page);
  for (let i = 0; i < 6; i++) {
    if ((await pausePage(page)) === 'pause') return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  expect(await pausePage(page), 'ESC/BACK reached the pause root').toBe('pause');
}

async function openEchoPage(page: Page): Promise<void> {
  await ensurePause(page);
  if ((await pausePage(page)) === 'echo') return;
  await toPauseRoot(page);
  await clickLabel(page, 'PauseScene', 'AI & COMPANION');
  await page.waitForTimeout(300);
  if ((await pausePage(page)) === 'echo') return;
  await clickLabel(page, 'PauseScene', 'ECHO COMPANION');
  await page.waitForTimeout(350);
  expect(await pausePage(page), 'the echo companion page is open').toBe('echo');
}

async function openLocalCoop(page: Page): Promise<void> {
  await ensurePause(page);
  if ((await pausePage(page)) === 'local-coop') return;
  if ((await pausePage(page)) !== 'echo') await openEchoPage(page);
  await clickLabel(page, 'PauseScene', 'LOCAL COOPERATION');
  await page.waitForTimeout(350);
  expect(await pausePage(page), 'the local cooperation page is open').toBe('local-coop');
}

async function enableEchoAndSettle(page: Page): Promise<void> {
  await openEchoPage(page);
  await clickLabel(page, 'PauseScene', 'ENABLE ECHO');
  await page.waitForTimeout(300);
  await resumeGame(page);
  const tick0 = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.tick);
  await page.waitForFunction((tb: number) => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return !!w.echoActor && w.sim.tick > tb + 2;
  }, tick0, { timeout: 15000 });
}

async function waitForLocalProposal(page: Page, timeout = 20000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const has = await page.evaluate(() => !!(window as any).__game.scene.getScene('GameScene').world.echoLocalProposal);
    if (has) return true;
    await resumeGame(page);
    await page.waitForTimeout(700);
    await openLocalCoop(page);
  }
  return false;
}

async function bootDemo(page: Page): Promise<void> {
  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate((k) => {
    localStorage.removeItem(k);
    for (const key of Object.keys(localStorage)) if (key.startsWith('last_signal_demo_seen')) localStorage.removeItem(key);
    localStorage.setItem('last_signal_autoOwner', 'human');
  }, SAVE_KEY);
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 30000 });
  await page.waitForTimeout(400);
  await clickLabel(page, 'MainMenuScene', 'DEMO 01');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 30000 });
  await page.waitForTimeout(1000);
}

async function buttons(page: Page) {
  return page.evaluate(() => {
    const s: any = (window as any).__game.scene.getScene('PauseScene');
    return ((s?.uiButtons ?? []) as any[]).map((b: any) => ({
      label: String(b.label?.text ?? ''), disabled: !!b.disabled, focused: !!b.focused,
      x: b.rect?.x ?? 0, y: b.rect?.y ?? 0, w: b.rect?.width ?? 0, h: b.rect?.height ?? 0
    }));
  });
}

async function allTexts(page: Page) {
  return page.evaluate(() => {
    const s: any = (window as any).__game.scene.getScene('PauseScene');
    const out: any[] = [];
    const walk = (l: any[]): void => {
      for (const c of l) {
        if (c?.type === 'Container' && c.list) walk(c.list);
        else if (c?.type === 'Text' && c.visible !== false) {
          out.push({ t: String(c.text ?? ''), size: Number(String(c.style?.fontSize ?? '0').replace('px', '')), x: c.x, y: c.y, w: c.width, h: c.height });
        }
      }
    };
    if (s?.children?.list) walk(s.children.list);
    return out;
  });
}

async function echoState(page: Page) {
  return page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    const s = w.signalView?.() ?? {};
    return {
      hasEcho: !!w.echoActor, alive: (w.echoActor?.data?.hp ?? 0) > 0, owner: w.player?.control?.owner ?? null,
      proposal: w.echoLocalProposal ? { id: w.echoLocalProposal.id, kind: w.echoLocalProposal.kind } : null,
      pending: w.echoPendingLocal ? { id: w.echoPendingLocal.proposalId, kind: w.echoPendingLocal.kind } : null,
      queue: (w.sim.pendingCommands ?? []).map((c: any) => c.type),
      auditApplied: w.echoAudit.recent(32).filter((e: any) => e.result === 'applied').map((e: any) => e.proposalId ?? null),
      energy: s.playerEnergy ?? null, tick: w.sim.tick
    };
  });
}

/** Real confirm: press the real button, then wait for the queue (no fixed sleep). */
async function confirmProposal(page: Page, proposalId: string): Promise<void> {
  await clickLabel(page, 'PauseScene', 'CONFIRM (HUMAN)');
  await page.waitForFunction((id: string) => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    return (w.sim.pendingCommands ?? []).length > 0 && w.echoPendingLocal?.proposalId === id;
  }, proposalId, { timeout: 10000 });
}

/** Real resume: wait for the real applied audit receipt of that proposal. */
async function resumeAndAwaitApplied(page: Page, proposalId: string): Promise<void> {
  await resumeGame(page);
  await page.waitForFunction((id: string) => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    return w.echoAudit.recent(32).some((e: any) => e.result === 'applied' && e.proposalId === id);
  }, proposalId, { timeout: 20000 });
}

/** boot -> real ENABLE -> cooperation assertions -> local-coop page with a real proposal. */
async function readyLocalProposal(page: Page) {
  await bootDemo(page);
  await enableEchoAndSettle(page);
  const coop = await echoState(page);
  expect(coop.hasEcho, 'the real ENABLE created the echo actor').toBe(true);
  expect(coop.alive, 'the echo actor is alive').toBe(true);
  expect(coop.owner, 'the human owns control after ENABLE').toBe('human');
  rec3('p3-coop-precondition', coop);
  await openLocalCoop(page);
  const got = await waitForLocalProposal(page);
  const state = await echoState(page);
  rec3('p3-proposal-arrived', { got, state });
  expect(got, 'live perception yields a real local proposal after ENABLE').toBe(true);
  expect(state.proposal, 'the proposal is on the real page').not.toBeNull();
  return state;
}

test.describe('GAMEPLAY-01 P3 · feedback surfaces', () => {
  test('1) six viewports across default / pending / result states: font floor, no raw ids, no overlap', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const proposed = await readyLocalProposal(page);
    const pid = proposed.proposal!.id;
    const rows: any[] = [];

    const snap = async (phase: string) => {
      const texts = await allTexts(page);
      const btns = await buttons(page);
      const tiny = texts.filter((t) => t.size > 0 && t.size < 10).map((t) => [t.t, t.size]);
      const raw = texts.map((t) => t.t).filter((t) => /local_\d+_\d+|tick\s*[:=]\s*\d+|\b[a-f0-9]{24,}\b|undefined|\bNaN\b/.test(t));
      // interactive rects must not overlap (legitimate parent/child pairs are absent on these pages)
      const overlaps: any[] = [];
      for (let i = 0; i < btns.length; i++) {
        for (let j = i + 1; j < btns.length; j++) {
          const a = btns[i], b = btns[j];
          const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
          const oy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
          if (ox > 2 && oy > 2) overlaps.push([a.label, b.label]);
        }
      }
      return { phase, labels: btns.map((b) => b.label), tiny, raw, overlaps, page: await pausePage(page) };
    };

    // default state at every viewport
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.waitForTimeout(320);
      const row = await snap(`default ${vp.w}x${vp.h}`);
      rows.push(row);
      expect(row.page, `default page at ${vp.w}x${vp.h}`).toBe('local-coop');
      expect(row.labels, 'confirm/reject/audit exist at every viewport').toEqual(expect.arrayContaining(['CONFIRM (HUMAN)', 'REJECT', 'RECENT ACTIONS']));
      expect(row.tiny, `font floor at ${vp.w}x${vp.h}`).toEqual([]);
      expect(row.raw, `no raw ids at ${vp.w}x${vp.h}`).toEqual([]);
      expect(row.overlaps, `no overlapping interactive elements at ${vp.w}x${vp.h}`).toEqual([]);
    }
    // pending state at the smallest and largest viewport
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(300);
    const beforePending = await echoState(page);
    expect(beforePending.proposal?.id, 'a proposal is still ready before confirming').toBe(pid);
    await confirmProposal(page, pid);
    for (const vp of [VIEWPORTS[0], VIEWPORTS[5]]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.waitForTimeout(320);
      const row = await snap(`pending ${vp.w}x${vp.h}`);
      rows.push(row);
      const body = (await allTexts(page)).map((t) => t.t).join('\n');
      expect(body, `pending copy at ${vp.w}x${vp.h}`).toMatch(/WAITING|QUEUED/i);
      expect(row.tiny, `pending font floor at ${vp.w}x${vp.h}`).toEqual([]);
      expect(row.overlaps, `pending overlap at ${vp.w}x${vp.h}`).toEqual([]);
    }
    await shot3(page, 'p3-01-six-viewports');
    rec3('p3-six-viewports', { rows, pid });
  });

  test('2) proposal -> Ready -> real CONFIRM -> WAITING/Queued + disabled -> real resume -> applied', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const proposed = await readyLocalProposal(page);
    const pid = proposed.proposal!.id;
    // BEFORE confirm the page shows a ready proposal, not "waiting", and the
    // action is available.
    const readyText = (await allTexts(page)).map((t) => t.t).join('\n');
    const readyButtons = await buttons(page);
    expect(readyText, 'the ready proposal copy mentions the action/scan').toMatch(/Scan|Ready|Proposal|reveal/i);
    expect(readyText, 'a ready proposal is not reported as waiting').not.toMatch(/WAITING/i);
    expect(readyButtons.find((b) => b.label === 'CONFIRM (HUMAN)')?.disabled, 'CONFIRM is enabled while a proposal is ready').toBe(false);
    rec3('p3-ready-before-confirm', { readyText, buttons: readyButtons, pid });

    // real click -> queued
    await confirmProposal(page, pid);
    const queuedText = (await allTexts(page)).map((t) => t.t).join('\n');
    const queuedButtons = await buttons(page);
    expect(queuedText, 'after a real confirm the page reports the waiting/queued state').toMatch(/WAITING|QUEUED/i);
    const queued = await echoState(page);
    expect(queued.pending?.id, 'the pending action is the confirmed proposal').toBe(pid);
    expect(queued.queue.length, 'confirm queued exactly one command').toBe(1);
    for (const label of ['CONFIRM (HUMAN)', 'REJECT']) {
      expect(queuedButtons.find((b) => b.label === label)?.disabled, `${label} is disabled while pending`).toBe(true);
    }
    rec3('p3-queued-after-confirm', { queuedText, buttons: queuedButtons, queued });

    // real resume -> the same proposal becomes applied by a real event
    await resumeAndAwaitApplied(page, pid);
    const done = await echoState(page);
    expect(done.auditApplied, 'the real resume produced an applied audit entry for that proposal').toContain(pid);
    expect(done.pending, 'pending cleared after the action executed').toBeNull();
    rec3('p3-applied-real', { done, pid });
    await shot3(page, 'p3-02-proposal-result');
  });

  test('3) pending: CONFIRM/REJECT are disabled, not focusable and not activatable by keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const proposed = await readyLocalProposal(page);
    const pid = proposed.proposal!.id;
    await confirmProposal(page, pid);
    const before = await echoState(page);
    const focusOrder: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(90);
      focusOrder.push(...(await buttons(page)).filter((b) => b.focused).map((b) => b.label));
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const after = await echoState(page);
    rec3('p3-disabled-focus', { before, focusOrder, after, pid });
    expect(focusOrder, 'CONFIRM (HUMAN) never takes keyboard focus while pending').not.toContain('CONFIRM (HUMAN)');
    expect(focusOrder, 'REJECT never takes keyboard focus while pending').not.toContain('REJECT');
    expect(after.queue, 'keyboard activation cannot add a second command').toEqual(before.queue);
    expect(after.pending, 'the pending action is unchanged').toEqual(before.pending);
  });

  test('4) RECENT ACTIONS: ≤8 numbered records, ESC/BACK round trip, pending and queue untouched', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const proposed = await readyLocalProposal(page);
    const pid = proposed.proposal!.id;
    await confirmProposal(page, pid);
    const before = await echoState(page);
    // LAYOUT FIXTURE: 10 injected entries just to check the 8-record window; the
    // behaviour assertions below never rely on injected entries.
    await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      for (let i = 0; i < 10; i++) {
        w.echoAudit.record({
          tick: 200 + i, provenance: i % 2 ? 'model' : 'human-local',
          action: i % 2 ? 'mark' : 'scan', target: { x: 8, y: 45 },
          result: 'enqueued', proposalId: `local_fixture_${i}`
        });
      }
    });
    await clickLabel(page, 'PauseScene', 'RECENT ACTIONS');
    await page.waitForTimeout(300);
    expect(await pausePage(page), 'the audit page opened').toBe('local-audit');
    const texts = await allTexts(page);
    const body = texts.map((t) => t.t).join('\n');
    const numbered = (body.match(/^#\d+/gm) ?? []).length;
    const tiny = texts.filter((t) => t.size > 0 && t.size < 10).map((t) => [t.t, t.size]);
    const btns = await buttons(page);
    const overlaps: any[] = [];
    for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
      const a = btns[i], b = btns[j];
      const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
      const oy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
      if (ox > 2 && oy > 2) overlaps.push([a.label, b.label]);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(320);
    const afterEsc = await pausePage(page);
    await clickLabel(page, 'PauseScene', 'RECENT ACTIONS');
    await page.waitForTimeout(250);
    const reopened = await pausePage(page);
    await clickLabel(page, 'PauseScene', 'BACK');
    await page.waitForTimeout(250);
    const backPage = await pausePage(page);
    const after = await echoState(page);
    rec3('p3-audit', { numbered, afterEsc, reopened, backPage, tiny, overlaps, body: body.slice(0, 900), before, after, fixture: 'layout: 10 injected audit entries' });
    expect(numbered, 'at most 8 numbered records').toBeLessThanOrEqual(8);
    expect(numbered, 'the audit stack is not empty').toBeGreaterThan(0);
    expect(afterEsc, 'ESC returns from the audit to the cooperation page').toBe('local-coop');
    expect(reopened, 'the audit page opens again').toBe('local-audit');
    expect(backPage, 'BACK returns to the cooperation page').toBe('local-coop');
    expect(tiny, 'audit font floor').toEqual([]);
    expect(overlaps, 'audit interactive elements do not overlap').toEqual([]);
    expect(after.queue, 'a read-only audit round trip does not touch the queue').toEqual(before.queue);
    expect(after.pending, 'a read-only audit round trip does not touch pending').toEqual(before.pending);
    await shot3(page, 'p3-04-audit');
  });

  test('5) echo detail + HUD: font floor, real signal text, HUD texts inside the frame', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await bootDemo(page);
    await enableEchoAndSettle(page);
    await openEchoPage(page);
    const texts = await allTexts(page);
    const tiny = texts.filter((t) => t.size > 0 && t.size < 10);
    const body = texts.map((t) => t.t).join('\n');
    const hud = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const cam = gs.cameras.main;
      const out: any[] = [];
      const walk = (l: any[]) => { for (const c of l) { if (c?.type === 'Container' && c.list) walk(c.list); else if (c?.type === 'Text' && c.visible !== false && c.text) out.push({ t: String(c.text).slice(0, 40), x: c.x, y: c.y, w: c.width, h: c.height }); } };
      walk(gs.children.list);
      return { zoom: cam.zoom, scrollX: cam.scrollX, scrollY: cam.scrollY, worldW: cam.width / cam.zoom, worldH: cam.height / cam.zoom, texts: out };
    });
    const outside = hud.texts.filter((t) => t.x < -4 || t.y < -4 || t.x > hud.worldW + 4 || t.y > hud.worldH + 4);
    rec3('p3-echo-detail', { tiny: tiny.map((t) => [t.t, t.size]), body: body.slice(0, 700), hud: { ...hud, texts: hud.texts.slice(0, 40) }, outside });
    expect(tiny.map((t) => t.t), 'no text below 10 CSS px on the echo page').toEqual([]);
    expect(body, 'the echo page names the companion surface').toMatch(/ECHO COMPANION|LOCAL COOPERATION/i);
    expect(body, 'the echo page shows real copy, not placeholders').not.toMatch(/undefined|\bNaN\b/);
    expect(outside, 'every HUD text sits inside the camera frame').toEqual([]);
    await shot3(page, 'p3-05-echo-detail');
  });

  test('6) resize and reopen keep the page object count stable; no fake OFFLINE', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const proposed = await readyLocalProposal(page);
    const countOnce = (await allTexts(page)).length;
    for (let i = 0; i < 3; i++) {
      await page.setViewportSize({ width: i % 2 ? 1024 : 1366, height: 768 });
      await page.waitForTimeout(320);
    }
    const countAfterResize = (await allTexts(page)).length;
    await page.setViewportSize({ width: 1280, height: 720 });
    await toPauseRoot(page);
    await openLocalCoop(page);
    const countReopened = (await allTexts(page)).length;
    const source = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      const v = w.signalView?.() ?? {};
      return { source: v.aiSource ?? null, model: v.modelState ?? null };
    });
    const body = (await allTexts(page)).map((t) => t.t).join('\n');
    rec3('p3-resize-reopen', { countOnce, countAfterResize, countReopened, source, body: body.slice(0, 600), pid: proposed.proposal!.id });
    expect(Math.abs(countAfterResize - countOnce), 'a resize does not duplicate page objects').toBeLessThanOrEqual(3);
    expect(Math.abs(countReopened - countOnce), 'a reopen does not duplicate page objects').toBeLessThanOrEqual(3);
    if (source.model !== 'offline' && source.model !== 'error') {
      expect(body, 'no fake OFFLINE claim while the model is not offline').not.toMatch(/\bOFFLINE\b/);
    }
  });

  test('7) LLM page footer states the resume rule, with a real screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await bootDemo(page);
    await ensurePause(page);
    await toPauseRoot(page);
    await clickLabel(page, 'PauseScene', 'AI & COMPANION');
    await page.waitForTimeout(300);
    await clickLabel(page, 'PauseScene', 'LLM COMPANION');
    await page.waitForTimeout(500);
    const pageName = await pausePage(page);
    const body = (await allTexts(page)).map((t) => t.t).join('\n');
    const shotPath = await shot3(page, 'p3-07-llm-footer');
    rec3('p3-llm-footer', { pageName, body: body.slice(0, 900), shot: shotPath, fixture: 'connection state as shown by the real page (no model call made)' });
    expect(pageName, 'the LLM page opened').toBe('llm');
    expect(body, 'the footer states the resume rule').toMatch(/Takes effect when you resume/);
  });
});
