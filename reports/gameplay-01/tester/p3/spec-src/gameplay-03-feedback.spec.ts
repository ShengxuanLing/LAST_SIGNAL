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
      // The product handle exposes `enabled` (menuKit.ts); `disabled` is derived so
      // both spellings are readable without inventing a field.
      label: String(b?.label?.text ?? ''),
      enabled: !!b?.enabled,
      disabled: !b?.enabled,
      focused: !!b?.focused,
      x: b?.rect?.x ?? 0, y: b?.rect?.y ?? 0, w: b?.rect?.width ?? 0, h: b?.rect?.height ?? 0
    }));
  });
}

/** Wait (bounded) until the REAL handle for `label` reports enabled === expected. */
async function waitButtonEnabled(page: Page, label: string, expected: boolean, timeout = 8000): Promise<void> {
  await page.waitForFunction(({ label, expected }: { label: string; expected: boolean }) => {
    const s: any = (window as any).__game.scene.getScene('PauseScene');
    const b = ((s?.uiButtons ?? []) as any[]).find((x: any) => String(x?.label?.text ?? '') === label);
    return !!b && !!b.enabled === expected;
  }, { label, expected }, { timeout });
}

async function allTexts(page: Page) {
  return page.evaluate(() => {
    const s: any = (window as any).__game.scene.getScene('PauseScene');
    const cam = s?.cameras?.main;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    const rect = canvas ? canvas.getBoundingClientRect() : { width: 0 };
    const logicalW = cam ? cam.width / cam.zoom : 0;
    // CSS px per logical px — uses the real canvas rect, so letterboxing counts.
    const cssScale = logicalW > 0 ? rect.width / logicalW : 0;
    const out: any[] = [];
    const walk = (l: any[]): void => {
      for (const c of l) {
        if (c?.type === 'Container' && c.list) walk(c.list);
        else if (c?.type === 'Text' && c.visible !== false) {
          const logical = Number(String(c.style?.fontSize ?? '0').replace('px', ''));
          out.push({ t: String(c.text ?? ''), logical, css: logical * cssScale, cssScale, x: c.x, y: c.y, w: c.width, h: c.height });
        }
      }
    };
    if (s?.children?.list) walk(s.children.list);
    return out;
  });
}

/** HUD sample taken while the game is LIVE.
 *  CSS px = fontSize x actualScaleY x camera.zoom x (canvasCSSwidth / cam.width).
 *  The live HUD is INVERSE-scaled by lockHud() (scaleX/Y = 1/zoom, re-pinned every
 *  frame), so the zoom cancels: css = fontSize x canvasScale. Every factor is recorded
 *  so the number can be re-derived instead of trusted (review G1-a). */
async function hudSample(page: Page) {
  return page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    const cam = gs.cameras.main;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    const rect = canvas ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
    const canvasScale = cam.width > 0 ? rect.width / cam.width : 0;
    const wv = cam.worldView;
    const logicalOf = (o: any): number => Number(String(o?.style?.fontSize ?? '0').replace('px', ''));
    const cssOf = (o: any): number => logicalOf(o) * Math.abs(o?.scaleY ?? 1) * cam.zoom * canvasScale;
    const describe = (o: any) => {
      const b = o.getBounds();
      return {
        text: String(o.text ?? '').slice(0, 40), visible: o.visible !== false,
        logical: logicalOf(o), scaleX: o.scaleX, scaleY: o.scaleY,
        zoom: cam.zoom, canvasScale,
        bounds: { x: b.x, y: b.y, w: b.width, h: b.height },
        css: Number(cssOf(o).toFixed(3)),
        inverseScaleProduct: Number((o.scaleY * cam.zoom).toFixed(4)),
        inFrame: b.right > wv.x && b.x < wv.right && b.bottom > wv.y && b.y < wv.bottom
      };
    };
    const pick: any = {};
    for (const n of ['txtSignal', 'txtEcho', 'txtSignalDetail']) {
      const t = gs[n];
      if (t && t.type === 'Text') pick[n] = describe(t);
    }
    const out: any[] = [];
    const walk = (l: any[]): void => {
      for (const c of l) {
        if (c?.type === 'Container' && c.list) walk(c.list);
        else if (c?.type === 'Text' && c.text) out.push(describe(c));
      }
    };
    walk(gs.children.list);
    // The locked HUD list is the surface the CSS floor claim is about.
    const hudTexts = ((gs.hudObjects ?? []) as any[]).filter((o) => o && o.type === 'Text').map(describe);
    return {
      pauseActive: g.scene.isActive('PauseScene'), gameActive: g.scene.isActive('GameScene'),
      zoom: cam.zoom, canvasScale,
      worldView: { x: wv.x, y: wv.y, w: wv.width, h: wv.height },
      canvas: { w: rect.width, h: rect.height }, pick, texts: out, hudTexts
    };
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
  test('1) six viewports × default state; pending at 800/1920; no Done state covered', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const proposed = await readyLocalProposal(page);
    const pid = proposed.proposal!.id;
    const rows: any[] = [];

    const snap = async (phase: string) => {
      const texts = await allTexts(page);
      const btns = await buttons(page);
      // CSS size = logical fontSize * (canvas CSS width / logical viewport width).
      const tiny = texts.filter((t) => t.css > 0 && t.css < 10).map((t) => [t.t, t.logical, Number(t.css.toFixed(2))]);
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
      return { phase, labels: btns.map((b) => b.label), tiny, raw, overlaps, cssScale: texts[0]?.cssScale ?? null, sample: texts.length, page: await pausePage(page) };
    };

    // default state at every viewport
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.waitForTimeout(320);
      const row = await snap(`default ${vp.w}x${vp.h}`);
      rows.push(row);
      expect(row.page, `default page at ${vp.w}x${vp.h}`).toBe('local-coop');
      expect(row.labels, 'confirm/reject/audit exist at every viewport').toEqual(expect.arrayContaining(['CONFIRM (HUMAN)', 'REJECT', 'RECENT ACTIONS']));
      expect(row.sample, `texts sampled at ${vp.w}x${vp.h}`).toBeGreaterThan(0);
      expect(row.tiny, `>=10 CSS px font floor at ${vp.w}x${vp.h}`).toEqual([]);
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
      expect(row.sample, `texts sampled in pending at ${vp.w}x${vp.h}`).toBeGreaterThan(0);
      expect(row.tiny, `pending >=10 CSS px font floor at ${vp.w}x${vp.h}`).toEqual([]);
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
    const readyConfirm = readyButtons.find((b) => b.label === 'CONFIRM (HUMAN)');
    expect(readyConfirm?.enabled, 'the real CONFIRM handle reports enabled while a proposal is ready').toBe(true);
    expect(readyConfirm?.disabled, 'CONFIRM is not disabled while a proposal is ready').toBe(false);
    rec3('p3-ready-before-confirm', { readyText, buttons: readyButtons, pid });

    // real click -> queued
    await confirmProposal(page, pid);
    const queuedText = (await allTexts(page)).map((t) => t.t).join('\n');
    const queuedButtons = await buttons(page);
    expect(queuedText, 'after a real confirm the page reports the waiting/queued state').toMatch(/WAITING|QUEUED/i);
    const queued = await echoState(page);
    expect(queued.pending?.id, 'the pending action is the confirmed proposal').toBe(pid);
    expect(queued.queue.length, 'confirm queued exactly one command').toBe(1);
    // The REAL handles must be disabled while pending (restored after F1: the
    // earlier removal was caused by reading a non-existent `b.disabled`).
    await waitButtonEnabled(page, 'CONFIRM (HUMAN)', false);
    await waitButtonEnabled(page, 'REJECT', false);
    const settled = await buttons(page);
    for (const label of ['CONFIRM (HUMAN)', 'REJECT']) {
      const b = settled.find((x) => x.label === label);
      expect(b?.enabled, `${label} real handle reports disabled while pending`).toBe(false);
      expect(b?.disabled, `${label} maps to disabled while pending`).toBe(true);
    }
    // The page must not let a second confirm duplicate the queued action.
    await clickLabel(page, 'PauseScene', 'CONFIRM (HUMAN)');
    await page.waitForTimeout(350);
    const afterSecond = await echoState(page);
    expect(afterSecond.queue.length, 'a second CONFIRM while pending cannot duplicate the command').toBe(1);
    expect(afterSecond.pending?.id, 'the pending action is still the same proposal').toBe(pid);
    const afterSecondButtons = await buttons(page);
    expect(afterSecondButtons.find((b) => b.label === 'CONFIRM (HUMAN)')?.enabled, 'a second click leaves CONFIRM disabled').toBe(false);
    rec3('p3-queued-after-confirm', {
      queuedText, buttons: queuedButtons, queued, afterSecond,
      settled: Object.fromEntries(settled.map((b) => [b.label, { enabled: b.enabled, disabled: b.disabled }])),
      afterSecondClick: Object.fromEntries(afterSecondButtons.map((b) => [b.label, { enabled: b.enabled, disabled: b.disabled }]))
    });

    // real resume -> the same proposal becomes applied by a real event
    await resumeAndAwaitApplied(page, pid);
    const done = await echoState(page);
    expect(done.auditApplied, 'the real resume produced an applied audit entry for that proposal').toContain(pid);
    expect(done.pending, 'pending cleared after the action executed').toBeNull();
    rec3('p3-applied-real', { done, pid });
    await shot3(page, 'p3-02-proposal-result');

    // F5: reopen the local page at 1280 after the real applied and capture the
    // Done / receipt view, bound to the ORIGINAL proposalId.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(250);
    await openLocalCoop(page);
    await page.waitForTimeout(350);
    const donePage = await pausePage(page);
    const doneBody = (await allTexts(page)).map((t) => t.t).join('\n');
    const receipt = await page.evaluate((id: string) => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      return w.echoAudit.recent(32)
        .filter((e: any) => e.proposalId === id)
        .map((e: any) => ({ result: e.result, action: e.action, provenance: e.provenance }));
    }, pid);
    rec3('p3-done-receipt', {
      pid, page: donePage, doneBody: doneBody.slice(0, 700), receipt,
      note: 'audit raw fields (provenance/action/target) are the designed record, not a leak; only 1280 is captured in the Done state'
    });
    expect(donePage, 'the reopened local page is local-coop').toBe('local-coop');
    expect(doneBody, 'the Done view does not claim a pending action').not.toMatch(/WAITING/i);
    expect(receipt.some((r) => r.result === 'applied'), 'the receipt is bound to the original proposalId').toBe(true);
    await shot3(page, 'p3-02-done-receipt');
  });

  test('3) pending: CONFIRM/REJECT are disabled, not focusable and not activatable by keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const proposed = await readyLocalProposal(page);
    const pid = proposed.proposal!.id;
    await confirmProposal(page, pid);
    const before = await echoState(page);
    expect(await pausePage(page), 'the pending page is local-coop before the sweep').toBe('local-coop');
    const beforeButtons = await buttons(page);
    expect(beforeButtons.length, 'the pending page still exposes real buttons').toBeGreaterThan(0);
    expect(beforeButtons.find((b) => b.label === 'CONFIRM (HUMAN)')?.disabled, 'CONFIRM disabled while pending').toBe(true);
    expect(beforeButtons.find((b) => b.label === 'REJECT')?.disabled, 'REJECT disabled while pending').toBe(true);
    const focusOrder: string[] = [];
    const rounds: any[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(90);
      const roundPage = await pausePage(page);
      const btns = await buttons(page);
      expect(roundPage, `round ${i + 1} stays on the local-coop page`).toBe('local-coop');
      expect(btns.length, `round ${i + 1} exposes real buttons`).toBeGreaterThan(0);
      const focused = btns.filter((b) => b.focused).map((b) => b.label);
      rounds.push({ round: i + 1, page: roundPage, buttons: btns.length, focused });
      focusOrder.push(...focused);
    }
    // The sweep ends on an ENABLED control (BACK / LOW-RISK), so Enter may navigate:
    // the claim is that it cannot activate the disabled CONFIRM/REJECT or add a command.
    const lastFocused = rounds[rounds.length - 1].focused;
    expect(lastFocused.length, 'a real control had keyboard focus before Enter').toBeGreaterThan(0);
    expect(['CONFIRM (HUMAN)', 'REJECT'], 'no disabled control is focused before Enter').not.toContain(lastFocused[0]);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const afterEnterPage = await pausePage(page);
    const after = await echoState(page);
    rec3('p3-disabled-focus', { before, focusOrder, rounds, lastFocused, afterEnterPage, after, pid });
    expect(['local-coop', 'echo', 'pause', 'local-audit'], 'Enter only performs a real in-overlay navigation').toContain(afterEnterPage);
    expect(new Set(focusOrder).size, 'the keyboard sweep actually collected focus').toBeGreaterThan(0);
    expect(focusOrder, 'CONFIRM (HUMAN) never takes keyboard focus while pending').not.toContain('CONFIRM (HUMAN)');
    expect(focusOrder, 'REJECT never takes keyboard focus while pending').not.toContain('REJECT');
    expect(after.queue, 'keyboard activation cannot add a second command').toEqual(before.queue);
    expect(after.pending, 'the pending action is unchanged').toEqual(before.pending);
    await openLocalCoop(page);
    const reopened = await echoState(page);
    expect(reopened.pending?.id, 'the pending action survives real navigation').toBe(before.pending?.id);
    expect(reopened.queue, 'the queue survives real navigation').toEqual(before.queue);
  });

  test('4) RECENT ACTIONS: page window == last 8 of the internal stack + ESC/BACK round trip', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const proposed = await readyLocalProposal(page);
    const pid = proposed.proposal!.id;
    await confirmProposal(page, pid);
    const before = await echoState(page);
    // LAYOUT FIXTURE (labelled): 10 injected entries just to exercise the 8-record
    // window. Every behaviour assertion below uses real state only.
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
    const tiny = texts.filter((t) => t.css > 0 && t.css < 10).map((t) => [t.t, t.logical, Number(t.css.toFixed(2))]);
    // F8: the page must render the same 8 records the audit model returns as its last 8
    // (recent(8) === recent(32).slice(-8)). This is INTERNAL window consistency inside the
    // audit layer - not an independent check of what was drawn. The injected entries
    // bracket it: tick 209 must be inside the window, tick 200 outside.
    const window8 = await page.evaluate(() => {
      const w: any = (window as any).__game.scene.getScene('GameScene').world;
      const all = w.echoAudit.recent(32).map((e: any) => ({ tick: e.tick, pid: e.proposalId ?? null }));
      const newest = w.echoAudit.recent(8).map((e: any) => ({ tick: e.tick, pid: e.proposalId ?? null }));
      return { all, newest };
    });
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
    rec3('p3-audit', {
      numbered, afterEsc, reopened, backPage, tiny, overlaps, body: body.slice(0, 900), before, after,
      window8: { newest: window8.newest, stackTicks: window8.all.map((e) => e.tick) },
      fixture: 'layout only: 10 injected audit entries exercise the 8-record window; behaviour assertions use real state',
      f8_scope: 'internal window consistency (page draws the audit model last-8) + 209 inside / 200 outside; not an independent verification of the drawing'
    });
    expect(window8.newest.length, 'the audit window returns exactly 8 entries').toBe(8);
    // echoAudit.recent() returns chronological order (oldest first), so the
    // newest 8 are the LAST 8 of the stack.
    expect(window8.newest.map((e) => e.tick), 'the page window matches the last 8 of the internal stack').toEqual(window8.all.slice(-8).map((e) => e.tick));
    expect(window8.newest.map((e) => e.tick), 'injected tick 209 is inside the shown window').toContain(209);
    expect(window8.newest.map((e) => e.tick), 'injected tick 200 is outside the shown window').not.toContain(200);
    expect(numbered, 'the page renders exactly as many numbered records as the window').toBe(window8.newest.length);
    expect(numbered, 'at most 8 numbered records').toBeLessThanOrEqual(8);
    expect(afterEsc, 'ESC returns from the audit to the cooperation page').toBe('local-coop');
    expect(reopened, 'the audit page opens again').toBe('local-audit');
    expect(backPage, 'BACK returns to the cooperation page').toBe('local-coop');
    expect(tiny, 'audit >=10 CSS px font floor').toEqual([]);
    expect(overlaps, 'audit interactive elements do not overlap').toEqual([]);
    expect(after.queue, 'a read-only audit round trip does not touch the queue').toEqual(before.queue);
    expect(after.pending, 'a read-only audit round trip does not touch pending').toEqual(before.pending);
    await shot3(page, 'p3-04-audit');
  });

  test('5) live HUD >=10 CSS px at 800 AND 1280 (inverse-scale aware); echo page font floor', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await bootDemo(page);
    await enableEchoAndSettle(page);
    // F2: the pause overlay hides the HUD (setHudVisible(false)), so the HUD must be
    // sampled while the game is really live - an empty sampled list is not green.
    await page.waitForFunction(() => !(window as any).__game.scene.isActive('PauseScene') && (window as any).__game.scene.isActive('GameScene'), undefined, { timeout: 15000 });
    await page.waitForTimeout(400);

    /** Expected CSS size per logical size, from css = fontSize x canvasScale (zoom cancels). */
    const expected = (logical: number, canvasScale: number): number | null =>
      (logical === 16 || logical === 17) ? Number((logical * canvasScale).toFixed(3)) : null;
    const checkHud = (h: any, vp: string) => {
      const visible = h.hudTexts.filter((t: any) => t.visible && t.text.length > 0);
      expect(visible.length, `${vp}: the locked HUD exposes visible text objects`).toBeGreaterThan(0);
      const tiny = visible.filter((t: any) => t.css < 10).map((t: any) => [t.text, t.logical, t.css]);
      expect(tiny, `${vp}: every visible locked-HUD line is at least 10 CSS px`).toEqual([]);
      // The lock makes scaleY = 1/zoom; if that ever stops being true the CSS number
      // above is wrong, so the invariant is asserted rather than assumed (G1-a).
      const badInvariant = visible.filter((t: any) => Math.abs(t.inverseScaleProduct - 1) > 0.02)
        .map((t: any) => [t.text, t.scaleY, t.zoom]);
      expect(badInvariant, `${vp}: lockHud keeps scaleY x zoom = 1`).toEqual([]);
      const out = visible.filter((t: any) => !t.inFrame).map((t: any) => t.text);
      expect(out, `${vp}: every locked-HUD line sits inside the camera worldView`).toEqual([]);
      for (const t of visible) {
        const want = expected(t.logical, h.canvasScale);
        if (want !== null) {
          expect(Math.abs(t.css - want), `${vp}: a ${t.logical}px line measures ${want} CSS px`).toBeLessThan(0.02);
        }
      }
      return visible;
    };
    const summary = (h: any, visible: any[]) => ({
      zoom: h.zoom, canvasScale: h.canvasScale, canvas: h.canvas,
      lines: visible.length,
      sizes: [...new Set(visible.map((t: any) => Number(t.css.toFixed(3))))].sort((a, b) => a - b),
      scaleY: [...new Set(visible.map((t: any) => t.scaleY))],
      logical: [...new Set(visible.map((t: any) => t.logical))].sort((a, b) => a - b),
      detail: visible.map((t: any) => ({
        text: t.text, logical: t.logical, scaleX: t.scaleX, scaleY: t.scaleY,
        zoom: t.zoom, canvasScale: t.canvasScale, css: t.css, bounds: t.bounds
      }))
    });

    const hud800 = await hudSample(page);
    expect(hud800.pauseActive, 'the pause overlay is closed while sampling the HUD').toBe(false);
    expect(hud800.gameActive, 'the game scene is live while sampling the HUD').toBe(true);
    expect(hud800.texts.length, 'the live HUD exposes real Text objects').toBeGreaterThan(0);
    expect(hud800.pick.txtSignal?.visible, 'the HUD signal line is visible while live').toBe(true);
    expect((hud800.pick.txtSignal?.text ?? '').length, 'the HUD signal line has real content').toBeGreaterThan(0);
    expect(hud800.pick.txtEcho?.visible, 'the HUD echo line is visible while live').toBe(true);
    const visible800 = checkHud(hud800, '800x600');
    const outsideCss = hud800.texts.filter((t: any) => t.visible && !t.inFrame).map((t: any) => t.t);
    expect(outsideCss, 'every visible live HUD text intersects the camera worldView').toEqual([]);
    rec3('p3-hud-live-800', {
      ...summary(hud800, visible800), pick: hud800.pick, outsideAllTexts: outsideCss,
      note: 'css = fontSize x scaleY x zoom x canvasScale; lockHud inverse scaling cancels zoom (G1-a)'
    });
    await shot3(page, 'p3-05-hud-live-800');

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(420);
    const hud1280 = await hudSample(page);
    const visible1280 = checkHud(hud1280, '1280x720');
    rec3('p3-hud-live-1280', { ...summary(hud1280, visible1280), pick: hud1280.pick });
    await shot3(page, 'p3-05-hud-live');

    // The paused state hides the HUD: assert that, instead of reading an empty list.
    await openEchoPage(page);
    const paused = await hudSample(page);
    expect(paused.pauseActive, 'the pause overlay is open on the echo page').toBe(true);
    expect(paused.pick.txtSignal?.visible, 'the HUD is hidden while the overlay is open').toBe(false);
    const texts = await allTexts(page);
    const tiny = texts.filter((t) => t.css > 0 && t.css < 10).map((t) => [t.t, t.logical, Number(t.css.toFixed(2))]);
    const body = texts.map((t) => t.t).join('\n');
    rec3('p3-echo-detail', {
      tiny, scale: texts[0]?.cssScale ?? null, sample: texts.length, body: body.slice(0, 700),
      pausedHud: { pauseActive: paused.pauseActive, signalVisible: paused.pick.txtSignal?.visible ?? null }
    });
    expect(texts.length, 'the echo page has real text').toBeGreaterThan(0);
    expect(tiny, 'no echo-page text below 10 CSS px').toEqual([]);
    expect(body, 'the echo page names the companion surface').toMatch(/ECHO COMPANION|LOCAL COOPERATION/i);
    expect(body, 'the echo page shows real copy, not placeholders').not.toMatch(/undefined|\bNaN\b/);
    await shot3(page, 'p3-05-echo-detail');
  });

  test('6) resize 800->1920->1280 and reopen rebuild exact object counts; no fake OFFLINE', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const proposed = await readyLocalProposal(page);
    const pid = proposed.proposal!.id;
    const countAt = () => page.evaluate(() => {
      const s: any = (window as any).__game.scene.getScene('PauseScene');
      const walk = (l: any[]): number => l.reduce((n, c) => n + (c?.type === 'Container' && c.list ? walk(c.list) : 1), 0);
      const btns = ((s?.uiButtons ?? []) as any[]).map((b: any) => String(b?.label?.text ?? ''));
      return { uiObjects: walk(s?.children?.list ?? []), buttons: btns.length, labels: btns };
    });
    // F6: count ALL page objects, and cross the compact token threshold
    // (800 = compact, 1920 = large) instead of two compact viewports.
    const base = await countAt();
    const rows: any[] = [{ vp: '1280x720', ...base }];
    for (const vp of [{ w: 800, h: 600 }, { w: 1920, h: 1080 }, { w: 1280, h: 720 }]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.waitForTimeout(420);
      rows.push({ vp: `${vp.w}x${vp.h}`, ...(await countAt()) });
    }
    const compact = rows[1], wide = rows[2], back = rows[3];
    for (const r of rows) {
      expect(new Set(r.labels).size, `${r.vp}: no duplicated button labels`).toBe(r.labels.length);
      expect(r.buttons, `${r.vp}: the page still exposes buttons`).toBeGreaterThan(0);
    }
    // Same viewport => same token set => the object count must be EXACT, not +-3.
    expect(back.uiObjects, 'returning to 1280 rebuilds exactly the same object count').toBe(base.uiObjects);
    expect(back.buttons, 'returning to 1280 restores the same buttons').toBe(base.buttons);
    await page.waitForTimeout(300);
    await toPauseRoot(page);
    await openLocalCoop(page);
    const reopened = await countAt();
    const status = await page.evaluate(() => {
      const game: any = (window as any).__game;
      const gs: any = game.scene.getScene('GameScene');
      return {
        companionStatus: gs.companionStatus ?? null,
        hasLink: !!gs.companionLink,
        page: game.scene.getScene('PauseScene')?.currentPage ?? null
      };
    });
    const body = (await allTexts(page)).map((t) => t.t).join('\n');
    rec3('p3-resize-reopen', {
      base, rows, reopened, status, body: body.slice(0, 500), pid,
      note: 'compact 800 legitimately uses the small token set, so its count may differ; equality is asserted only for the same viewport'
    });
    expect(reopened.uiObjects, 'reopening the page rebuilds exactly the same object count').toBe(base.uiObjects);
    expect(reopened.buttons, 'reopening restores the same buttons').toBe(base.buttons);
    expect(compact.uiObjects > 0 && wide.uiObjects > 0, 'both extreme viewports rendered real objects').toBe(true);
    // F3: the local cooperation page never claims a connection state; OFFLINE is an
    // LLM-page-only string, so this assertion is unconditional (no dead provenance).
    expect(body, 'the local cooperation page never says OFFLINE').not.toMatch(/\bOFFLINE\b/);
    expect(['CONNECTED', 'FALLBACK:NO_MODEL', 'READ_ONLY', 'OFF', null], 'companion status is the real scene-level source').toContain(status.companionStatus);
    expect(reopened.labels, 'reopening restores the cooperation actions').toEqual(expect.arrayContaining(['CONFIRM (HUMAN)', 'REJECT', 'RECENT ACTIONS']));
  });

  test('7) LLM page footer + its real connection state, with a real screenshot', async ({ page }) => {
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
    const status = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return { companionStatus: gs.companionStatus ?? null, hasLink: !!gs.companionLink };
    });
    const shotPath = await shot3(page, 'p3-07-llm-footer');
    rec3('p3-llm-footer', {
      pageName, body: body.slice(0, 900), shot: shotPath, status,
      fixture: 'connection state exactly as the real page shows it (no model call made)'
    });
    expect(pageName, 'the LLM page opened').toBe('llm');
    expect(body, 'the footer states the resume rule').toMatch(/Takes effect when you resume/);
    // F3: the rendered state must agree with the real status; never fake CONNECTED.
    if (status.companionStatus === 'CONNECTED') {
      expect(body, 'a CONNECTED status is rendered as connected').toMatch(/COMPANION CONNECTED/);
    } else if (status.companionStatus === 'FALLBACK:NO_MODEL') {
      expect(body, 'a NO_MODEL status is rendered as no model / offline').toMatch(/NO MODEL|OFFLINE/);
    } else if (status.companionStatus === 'READ_ONLY') {
      expect(body, 'a READ_ONLY status is rendered as read only').toMatch(/READ ONLY/);
    } else {
      // Real status 'OFF' (or null): the page must not claim a connection.
      expect(status.companionStatus, 'an OFF status is the real scene value').toMatch(/^(OFF)?$/);
      expect(body, 'an OFF status is never rendered as connected').not.toMatch(/COMPANION CONNECTED/);
      // online variant NOT covered in this run (no real connection was established).
    }
  });
});
