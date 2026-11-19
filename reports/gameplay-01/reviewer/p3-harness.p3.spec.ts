import { test, expect } from '@playwright/test';
const OUT = 'D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/p3-shots';

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
  await page.waitForTimeout(300);
}
async function resumeAll(page: any) {
  for (let i = 0; i < 5; i++) {
    if (!(await page.evaluate(() => (window as any).__game.scene.isActive('PauseScene')))) break;
    await page.keyboard.press('Escape'); await page.waitForTimeout(220);
  }
  await page.waitForTimeout(900);
}
async function toRoot(page: any) {
  for (let i = 0; i < 6; i++) {
    if (!(await page.evaluate(() => (window as any).__game.scene.isActive('PauseScene')))) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    const pg = await page.evaluate(() => (window as any).__game.scene.getScene('PauseScene')?.page ?? null);
    if (pg === 'pause') return;
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
}
async function openLocal(page: any) {
  await toRoot(page);
  await clickText(page, 'PauseScene', 'AI & COMPANION');
  await clickText(page, 'PauseScene', 'ECHO COMPANION');
  await clickText(page, 'PauseScene', 'LOCAL COOPERATION');
  await page.waitForTimeout(350);
}
async function measureLocal(page: any) {
  return page.evaluate(() => {
    const gs: any = (window as any).__game;
    const s: any = gs.scene.getScene('PauseScene');
    const c = document.querySelector('canvas')!; const r = c.getBoundingClientRect();
    const scale = r.width / gs.scale.gameSize.width;
    const fields: any = {};
    const texts = ['localStatus', 'localProposalText', 'localNoticeText', 'localAuditText'];
    const boxes: any[] = [];
    for (const f of texts) {
      const t = s[f];
      if (!t) continue;
      const b = t.getBounds();
      fields[f] = { text: String(t.text).slice(0, 400), css: +(parseFloat(String(t.style.fontSize)) * scale).toFixed(2), box: { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } };
      boxes.push({ name: f, box: b });
    }
    const outside = boxes.filter((x: any) => x.box.x < -1 || x.box.y < -1 || x.box.x + x.box.width > 1281 || x.box.y + x.box.height > 721).map((x: any) => x.name);
    const overlaps: any[] = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].box, b = boxes[j].box;
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ox > 1 && oy > 1) overlaps.push({ a: boxes[i].name, b: boxes[j].name, area: Math.round(ox * oy) });
    }
    return { page: s.page, scale: +scale.toFixed(3), fields, outside, overlaps };
  });
}
async function hudLines(page: any) {
  return page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const c = document.querySelector('canvas')!; const r = c.getBoundingClientRect();
    const scale = r.width / gs.scale.gameSize.width;
    const t = gs.txtSignalDetail;
    if (!t) return null;
    const b = t.getBounds();
    const lines = String(t.text).split('\n');
    return {
      lines, lineCount: lines.length,
      css: +(parseFloat(String(t.style.fontSize)) * scale).toFixed(2),
      color: String(t.style.color),
      box: { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) },
      clipped: b.x < -1 || b.y < -1 || b.x + b.width > 1281 || b.y + b.height > 721
    };
  });
}

test('P3 display: local coop copy, WAITING, Done-on-receipt, audit lines, HUD', async ({ page }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/'); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  await clickText(page, 'MainMenuScene', 'DEMO 01');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
  await page.waitForTimeout(700);
  // enable ECHO via real menu, then resume one tick
  await page.keyboard.press('Escape'); await page.waitForTimeout(420);
  await clickText(page, 'PauseScene', 'AI & COMPANION');
  await clickText(page, 'PauseScene', 'ECHO COMPANION');
  await clickText(page, 'PauseScene', 'ENABLE ECHO');
  await clickText(page, 'PauseScene', 'BACK');
  await resumeAll(page);
  await page.waitForFunction(() => !!(window as any).__game.scene.getScene('GameScene').world.echoActor, { timeout: 15000 });
  const hud = await hudLines(page);
  console.log('[HUD]', JSON.stringify(hud));

  await openLocal(page);
  const l1 = await measureLocal(page);
  console.log('[L1 proposal]', JSON.stringify(l1));
  await page.screenshot({ path: `${OUT}/p3-local-proposal-1280x720.png` });

  // confirm -> while paused the receipt must be Queued, not Done
  await clickText(page, 'PauseScene', 'CONFIRM (HUMAN)');
  const pending = await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    return { pending: w.echoPendingLocal?.proposalId ?? null, queued: (w.sim.pendingCommands ?? []).length, confirmEnabled: (window as any).__game.scene.getScene('PauseScene')?.localConfirm?.enabled ?? null };
  });
  await page.waitForTimeout(400);
  const l2 = await measureLocal(page);
  console.log('[L2 waiting]', JSON.stringify({ pending, ...l2 }));
  await page.screenshot({ path: `${OUT}/p3-waiting-1280x720.png` });
  expect(pending.queued).toBe(1);
  expect(l2.fields.localProposalText.text, 'waiting copy is player-facing').not.toMatch(/core tick|tick |room gen|\bid\b/i);
  expect(String(l2.fields.localProposalText.text)).toContain('Waiting to resume');
  expect(String(l2.fields.localNoticeText.text), 'paused receipt is Queued, not Done').not.toContain('Done');

  // resume -> real receipt -> Done on the local page
  await clickText(page, 'PauseScene', 'BACK');
  await resumeAll(page);
  await page.waitForTimeout(1200);
  await openLocal(page);
  const l3 = await measureLocal(page);
  console.log('[L3 after receipt]', JSON.stringify(l3));
  expect(String(l3.fields.localNoticeText.text)).toContain('Done');

  // generate more real entries: toggle confirm + a reject, then open audit
  const actions = await page.evaluate(async () => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w: any = gs.world;
    const out: any[] = [];
    out.push(w.proposeLocalEcho()?.kind ?? null);
    return out;
  });
  console.log('[L4 propose]', JSON.stringify(actions));
  if (await page.evaluate(() => (window as any).__game.scene.getScene('PauseScene')?.localConfirm?.enabled)) {
    await clickText(page, 'PauseScene', 'CONFIRM (HUMAN)');
    await clickText(page, 'PauseScene', 'BACK');
    await resumeAll(page);
    await page.waitForTimeout(1000);
    await openLocal(page);
  }
  // labelled layout fixture: 8 audit rows to test the dense layout
  const pad = await page.evaluate(() => {
    const w: any = (window as any).__game.scene.getScene('GameScene').world;
    for (let i = 0; i < 8; i++) {
      w.echoAudit.record({ tick: 1000 + i, provenance: i % 2 ? 'owner-external' : 'human-local', action: i % 2 ? 'toggle-relay' : 'scan', target: { x: 8, y: 45 }, result: i % 3 === 0 ? 'rejected' : 'applied', ...(i % 3 === 0 ? { code: 'E_PERMISSION' } : {}), proposalId: `local_${1000 + i}_${i}` } as any);
    }
    return w.echoAudit.recent(16).length;
  });
  console.log('[L5 audit ring]', pad);
  await clickText(page, 'PauseScene', 'RECENT ACTIONS');
  await page.waitForTimeout(350);
  const a1 = await measureLocal(page);
  console.log('[A1 audit 1280]', JSON.stringify(a1));
  await page.screenshot({ path: `${OUT}/p3-audit-1280x720.png` });
  expect(a1.page).toBe('local-audit');
  expect(a1.outside.length, 'audit text stays inside 1280x720').toBe(0);
  expect(a1.fields.localAuditText.css).toBeGreaterThanOrEqual(10);
  // ESC chain: local-audit -> local-coop -> echo
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const p1 = await page.evaluate(() => (window as any).__game.scene.getScene('PauseScene')?.page);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const p2 = await page.evaluate(() => (window as any).__game.scene.getScene('PauseScene')?.page);
  console.log('[ESC]', JSON.stringify({ fromAudit: p1, then: p2 }));
  expect(p1).toBe('local-coop');
  expect(p2).toBe('echo');

  // 800x600 narrow: audit + local layout
  await page.setViewportSize({ width: 800, height: 600 });
  await page.waitForTimeout(500);
  await openLocal(page);
  const n1 = await measureLocal(page);
  await clickText(page, 'PauseScene', 'RECENT ACTIONS');
  const n2 = await measureLocal(page);
  console.log('[800 local]', JSON.stringify(n1));
  console.log('[800 audit]', JSON.stringify(n2));
  await page.screenshot({ path: `${OUT}/p3-audit-800x600.png` });
  expect(n2.outside.length).toBe(0);
  expect(n2.fields.localAuditText.css).toBeGreaterThanOrEqual(10);
  // 1024 spotcheck
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(500);
  await openLocal(page);
  const m1 = await measureLocal(page);
  console.log('[1024 local]', JSON.stringify({ outside: m1.outside, overlaps: m1.overlaps, page: m1.page, css: m1.fields.localProposalText?.css }));
  expect(m1.outside.length).toBe(0);
});
