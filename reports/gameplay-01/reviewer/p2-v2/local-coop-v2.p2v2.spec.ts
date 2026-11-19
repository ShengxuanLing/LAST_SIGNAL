import { test, expect } from '@playwright/test';
const OUT = 'reports/gameplay-01/reviewer/p2-v2';

async function clickText(page: any, scene: string, label: string) {
  const p = await page.evaluate(({ scene, label }) => {
    const g: any = (window as any).__game; const s: any = g.scene.getScene(scene);
    const flat: any[] = []; const walk = (l: any[]) => { for (const c of l) { if (c.type === 'Container' && Array.isArray(c.list)) walk(c.list); else flat.push(c); } };
    walk(s.children.list);
    const t = flat.find((c) => c.type === 'Text' && c.visible !== false && String(c.text || '').includes(label));
    if (!t) return null; const b = t.getBounds(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, { scene, label });
  expect(p, `text ${label}`).not.toBeNull();
  const box = await page.evaluate(() => { const c = document.querySelector('canvas')!; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.click(box.x + p!.x * box.w / 1280, box.y + p!.y * box.h / 720);
  await page.waitForTimeout(320);
}

async function st(page: any) {
  return page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene'); const w: any = gs.world;
    const s: any = (window as any).__game.scene.getScene('PauseScene');
    const sig = w.signalView ? w.signalView() : null;
    return {
      page: s?.page ?? null, paused: gs.paused === true, tick: w.sim.tick,
      hp: w.player.data.hp, echoEnergy: sig?.echoEnergy ?? null, relay: sig?.relay ?? null,
      manual: sig?.manualEnabled ?? null,
      proposal: w.echoLocalProposal ? { id: w.echoLocalProposal.id, kind: w.echoLocalProposal.kind } : null,
      pending: w.echoPendingLocal ? { id: w.echoPendingLocal.proposalId, tick: w.echoPendingLocal.acceptedTick } : null,
      queued: (w.sim.pendingCommands ?? []).length,
      notice: s?.localNoticeText ? String(s.localNoticeText.text) : null,
      confirmEnabled: s?.localConfirm?.enabled ?? null,
      audit: w.echoAudit?.last?.() ?? null,
      echo: w.echoActor ? { hp: w.echoActor.data.hp } : null
    };
  });
}

async function resume(page: any) {
  for (let i = 0; i < 5; i++) {
    const active = await page.evaluate(() => (window as any).__game.scene.isActive('PauseScene'));
    if (!active) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(380);
  }
  await page.waitForTimeout(1200);
}

async function bootAndLocal(page: any) {
  await page.goto('/'); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await clickText(page, 'MainMenuScene', 'DEMO 01');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape'); await page.waitForTimeout(450);
  await clickText(page, 'PauseScene', 'AI & COMPANION');
  await clickText(page, 'PauseScene', 'ECHO COMPANION');
  if (!(await st(page)).echo) {
    await clickText(page, 'PauseScene', 'ENABLE ECHO');
    await clickText(page, 'PauseScene', 'BACK');
    await resume(page);
    await page.keyboard.press('Escape'); await page.waitForTimeout(450);
    await clickText(page, 'PauseScene', 'AI & COMPANION');
    await clickText(page, 'PauseScene', 'ECHO COMPANION');
  }
  await clickText(page, 'PauseScene', 'LOCAL COOPERATION');
  await page.waitForTimeout(450);
}

test('v2 single-pending: scan + toggle, WAITING, exact commit, audit link', async ({ page }) => {
  await bootAndLocal(page);
  const s1 = await st(page);
  console.log('[1] local page', JSON.stringify(s1));
  await page.screenshot({ path: `${OUT}/v2-local-1280x720.png` });
  expect(s1.proposal, 'a local proposal exists').not.toBeNull();
  const propId = s1.proposal!.id;
  const before = { tick: s1.tick, hp: s1.hp, echoEnergy: s1.echoEnergy, echoHp: s1.echo?.hp };

  await clickText(page, 'PauseScene', 'CONFIRM (HUMAN)');
  const s2 = await st(page);
  console.log('[2] after confirm#1 (paused)', JSON.stringify(s2));
  expect(s2.pending?.id).toBe(propId);
  expect(s2.queued, 'exactly one queued command').toBe(1);
  expect(s2.proposal, 'no new proposal while pending').toBeNull();
  expect(s2.confirmEnabled, 'CONFIRM disabled while pending').toBe(false);
  expect(s2.notice ?? '', 'WAITING text names the proposal').toContain(propId);
  expect({ tick: s2.tick, hp: s2.hp, echoEnergy: s2.echoEnergy, echoHp: s2.echo?.hp }).toEqual(before);
  await page.screenshot({ path: `${OUT}/v2-waiting-1280x720.png` });

  const direct = await page.evaluate((id) => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    const out: any = { same: w.confirmLocalEchoProposal(id), queued: (w.sim.pendingCommands ?? []).length, pending: w.echoPendingLocal?.proposalId ?? null };
    out.wrong = w.confirmLocalEchoProposal('local_999_9');
    out.queued2 = (w.sim.pendingCommands ?? []).length;
    out.pending2 = w.echoPendingLocal?.proposalId ?? null;
    out.audit = w.echoAudit.last();
    return out;
  }, propId);
  console.log('[3] direct re-confirms', JSON.stringify(direct));
  expect(direct.same).toBe(false);
  expect(direct.wrong).toBe(false);
  expect(direct.queued).toBe(1);
  expect(direct.queued2).toBe(1);
  expect(direct.pending2).toBe(propId);
  expect(direct.audit?.code).toBe('E_ALREADY_PENDING');

  // resume: capture the committed signal event, then settle + settle-linked audit
  await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    (window as any).__p2v2 = { events: [] };
    const orig = w.stepFrame.bind(w);
    w.stepFrame = (...a: any[]) => { const ev = orig(...a) as any[]; for (const e of ev) if (e?.type?.startsWith?.('signal-')) (window as any).__p2v2.events.push(e); return ev; };
  });
  await clickText(page, 'PauseScene', 'BACK');
  await resume(page);
  await page.waitForTimeout(500);
  const events = await page.evaluate(() => (window as any).__p2v2.events);
  const scanEv = (events ?? []).find((e: any) => e.type === 'signal-scanned');
  console.log('[3b] committed signal event', JSON.stringify(scanEv ?? null));
  const after = await st(page);
  console.log('[4] after resume', JSON.stringify(after));
  expect(after.pending, 'guard cleared by its own receipt').toBeNull();
  expect(after.queued, 'queue drained').toBe(0);
  expect(after.audit?.result).toBe('applied');
  expect(after.audit?.proposalId).toBe(propId);
  if (scanEv) {
    expect(scanEv.actorId, 'scan committed by the ECHO actor').toBe(1);
    expect(scanEv.ok, 'scan committed ok').toBe(true);
  }
  await page.screenshot({ path: `${OUT}/v2-applied-1280x720.png` });

  // second round: scan on cooldown -> toggle proposal -> exactly one flip
  await page.keyboard.press('Escape'); await page.waitForTimeout(450);
  await clickText(page, 'PauseScene', 'AI & COMPANION');
  await clickText(page, 'PauseScene', 'ECHO COMPANION');
  await clickText(page, 'PauseScene', 'LOCAL COOPERATION');
  await page.waitForTimeout(400);
  const t1 = await st(page);
  console.log('[5] second proposal', JSON.stringify({ proposal: t1.proposal, relay: t1.relay, manual: t1.manual, echoEnergy: t1.echoEnergy }));
  if (t1.proposal) {
    const beforeManual = t1.manual;
    await clickText(page, 'PauseScene', 'CONFIRM (HUMAN)');
    const t2 = await st(page);
    expect(t2.queued, 'toggle: exactly one queued command').toBe(1);
    await clickText(page, 'PauseScene', 'BACK');
    await resume(page);
    await page.waitForTimeout(800);
    const t3 = await st(page);
    console.log('[6] toggle after resume', JSON.stringify({ manualBefore: beforeManual, manualAfter: t3.manual, relay: t3.relay, audit: t3.audit }));
    expect(t3.manual, 'exactly one toggle applied').toBe(!beforeManual);
  }
});

test('v2 five viewports: proposal/WAITING geometry + font + ESC', async ({ page }) => {
  const vps: Array<[number, number]> = [[1920, 1080], [1366, 768], [1280, 720], [1024, 768], [800, 600]];
  for (const [w, h] of vps) {
    await page.setViewportSize({ width: w, height: h });
    await bootAndLocal(page);
    const m = await page.evaluate(() => {
      const gs: any = (window as any).__game;
      const s: any = gs.scene.getScene('PauseScene');
      const c = document.querySelector('canvas')!; const r = c.getBoundingClientRect();
      const scale = r.width / gs.scale.gameSize.width;
      const texts = [s.localStatus, s.localProposalText, s.localNoticeText].filter(Boolean);
      const rows = texts.map((t: any) => {
        const b = t.getBounds();
        return { css: +(parseFloat(String(t.style.fontSize)) * scale).toFixed(2), box: { x: b.x, y: b.y, w: b.width, h: b.height } };
      });
      const outside = rows.filter((x: any) => x.box.x < -1 || x.box.y < -1 || x.box.x + x.box.w > 1280 + 1 || x.box.y + x.box.h > 720 + 1).length;
      return { scale: +scale.toFixed(3), outside, minCss: Math.min(...rows.map((x: any) => x.css)), page: s.page };
    });
    console.log(`[vp ${w}x${h}]`, JSON.stringify(m));
    expect(m.page).toBe('local-coop');
    expect(m.outside, 'no text outside the 1280x720 page').toBe(0);
    expect(m.minCss, 'text >= 10 CSS px').toBeGreaterThanOrEqual(10);
    await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    const page2 = await page.evaluate(() => (window as any).__game.scene.getScene('PauseScene')?.page ?? null);
    expect(page2, 'ESC from local -> echo page').toBe('echo');
    await page.screenshot({ path: `${OUT}/v2-local-${w}x${h}.png` });
  }
});
