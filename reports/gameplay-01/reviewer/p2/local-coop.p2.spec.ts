import { test, expect } from '@playwright/test';
const OUT = 'reports/gameplay-01/reviewer/p2';
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
  await page.waitForTimeout(350);
}
async function st(page: any) {
  return page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene'); const w: any = gs.world;
    const s: any = (window as any).__game.scene.getScene('PauseScene');
    return {
      page: s?.page ?? null,
      echo: w.echoActor ? { hp: w.echoActor.data.hp, x: w.echoActor.x, y: w.echoActor.y } : null,
      proposal: w.echoLocalProposal ? { id: w.echoLocalProposal.id, kind: w.echoLocalProposal.kind } : null,
      optIn: w.echoCooperation,
      notice: s?.localNoticeText ? String(s.localNoticeText.text) : null,
      status: s?.localStatus ? String(s.localStatus.text) : null,
      confirmEnabled: s?.localConfirm?.enabled ?? null,
      switchLabel: s?.localSwitch?.label?.text ?? null,
      audit: w.echoAudit?.last?.() ?? null,
      pending: (w.sim.pendingCommands ?? []).length,
      relay: w.sim.signal ? w.sim.signal.relay : null,
      energy: w.sim.signal ? w.sim.signal.actors.echo.energy.energy : null,
      tick: w.sim.tick, paused: gs.paused === true
    };
  });
}
test('P2 local coop: proposal -> confirm (paused) -> duplicate window -> resume applied', async ({ page }) => {
  await page.goto('/'); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await clickText(page, 'MainMenuScene', 'DEMO 01');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await clickText(page, 'PauseScene', 'AI & COMPANION');
  await clickText(page, 'PauseScene', 'ECHO COMPANION');
  const a = await st(page);
  console.log('[A] echo page', JSON.stringify({ echo: a.echo }));
  if (!a.echo) {
    await clickText(page, 'PauseScene', 'ENABLE ECHO');
    // ECHO enable is queued: it commits on the next real tick, so resume first.
    await clickText(page, 'PauseScene', 'BACK');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    if (await page.evaluate(() => (window as any).__game.scene.isActive('PauseScene'))) { await page.keyboard.press('Escape'); }
    await page.waitForTimeout(1200);
    const spawned = await st(page);
    console.log('[A2] after resume', JSON.stringify({ echo: spawned.echo, tick: spawned.tick, paused: spawned.paused }));
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await clickText(page, 'PauseScene', 'AI & COMPANION');
    await clickText(page, 'PauseScene', 'ECHO COMPANION');
  }
  await clickText(page, 'PauseScene', 'LOCAL COOPERATION');
  await page.waitForTimeout(500);
  const s1 = await st(page);
  console.log('[1] local page', JSON.stringify(s1));
  await page.screenshot({ path: `${OUT}/local-page-1280x720.png` });

  if (!s1.proposal) { console.log('[skip] no local proposal'); return; }
  const id1 = s1.proposal.id;
  await clickText(page, 'PauseScene', 'CONFIRM (HUMAN)');
  await page.waitForTimeout(400);
  const s2 = await st(page);
  console.log('[2] after confirm (still paused)', JSON.stringify({ proposal: s2.proposal, notice: s2.notice, confirmEnabled: s2.confirmEnabled, pending: s2.pending, audit: s2.audit, tick: s2.tick }));
  // Blocker probe: is a NEW proposal regenerated + confirm re-enabled with a pending command?
  await page.screenshot({ path: `${OUT}/after-confirm-paused-1280x720.png` });
  let s3 = s2;
  if (s2.proposal && s2.confirmEnabled) {
    await clickText(page, 'PauseScene', 'CONFIRM (HUMAN)');
    await page.waitForTimeout(400);
    s3 = await st(page);
    console.log('[3] SECOND confirm while still paused', JSON.stringify({ proposal: s3.proposal, pending: s3.pending, audit: s3.audit, notice: s3.notice }));
  }
  // resume -> real commit
  await clickText(page, 'PauseScene', 'BACK');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  if (await page.evaluate(() => (window as any).__game.scene.isActive('PauseScene'))) { await page.keyboard.press('Escape'); }
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await clickText(page, 'PauseScene', 'AI & COMPANION');
  await clickText(page, 'PauseScene', 'ECHO COMPANION');
  await clickText(page, 'PauseScene', 'LOCAL COOPERATION');
  await page.waitForTimeout(600);
  const s4 = await st(page);
  console.log('[4] after resume', JSON.stringify({ relay: s4.relay, energy: s4.energy, audit: s4.audit, notice: s4.notice, paused: s4.paused, tick: s4.tick }));
  await page.screenshot({ path: `${OUT}/after-resume-1280x720.png` });
  // switch persistence
  await clickText(page, 'PauseScene', 'LOW-RISK COOPERATION');
  await page.waitForTimeout(400);
  const s5 = await st(page);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') || '{}'));
  console.log('[5] switch', JSON.stringify({ label: s5.switchLabel, optIn: s5.optIn, savedOptIn: saved?.permanent?.echoCooperationOptIn ?? null, notice: s5.notice }));
  console.log('[TARGET-IDS]', JSON.stringify({ id1, secondId: s3.proposal?.id ?? null }));
});
