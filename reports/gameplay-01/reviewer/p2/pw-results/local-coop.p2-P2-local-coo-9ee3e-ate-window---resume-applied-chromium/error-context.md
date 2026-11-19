# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: local-coop.p2.spec.ts >> P2 local coop: proposal -> confirm (paused) -> duplicate window -> resume applied
- Location: reports\gameplay-01\reviewer\p2\local-coop.p2.spec.ts:37:1

# Error details

```
Error: text AI & COMPANION

expect(received).not.toBeNull()

Received: null
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | const OUT = 'reports/gameplay-01/reviewer/p2';
  3   | async function clickText(page: any, scene: string, label: string) {
  4   |   const p = await page.evaluate(({ scene, label }) => {
  5   |     const g: any = (window as any).__game; const s: any = g.scene.getScene(scene);
  6   |     const flat: any[] = []; const walk = (l: any[]) => { for (const c of l) { if (c.type === 'Container' && Array.isArray(c.list)) walk(c.list); else flat.push(c); } };
  7   |     walk(s.children.list);
  8   |     const t = flat.find((c) => c.type === 'Text' && c.visible !== false && String(c.text || '').includes(label));
  9   |     if (!t) return null; const b = t.getBounds(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  10  |   }, { scene, label });
> 11  |   expect(p, `text ${label}`).not.toBeNull();
      |                                  ^ Error: text AI & COMPANION
  12  |   const box = await page.evaluate(() => { const c = document.querySelector('canvas')!; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  13  |   await page.mouse.click(box.x + p!.x * box.w / 1280, box.y + p!.y * box.h / 720);
  14  |   await page.waitForTimeout(350);
  15  | }
  16  | async function st(page: any) {
  17  |   return page.evaluate(() => {
  18  |     const gs: any = (window as any).__game.scene.getScene('GameScene'); const w: any = gs.world;
  19  |     const s: any = (window as any).__game.scene.getScene('PauseScene');
  20  |     return {
  21  |       page: s?.page ?? null,
  22  |       echo: w.echoActor ? { hp: w.echoActor.data.hp, x: w.echoActor.x, y: w.echoActor.y } : null,
  23  |       proposal: w.echoLocalProposal ? { id: w.echoLocalProposal.id, kind: w.echoLocalProposal.kind } : null,
  24  |       optIn: w.echoCooperation,
  25  |       notice: s?.localNoticeText ? String(s.localNoticeText.text) : null,
  26  |       status: s?.localStatus ? String(s.localStatus.text) : null,
  27  |       confirmEnabled: s?.localConfirm?.enabled ?? null,
  28  |       switchLabel: s?.localSwitch?.label?.text ?? null,
  29  |       audit: w.echoAudit?.last?.() ?? null,
  30  |       pending: (w.sim.pendingCommands ?? []).length,
  31  |       relay: w.sim.signal ? w.sim.signal.relay : null,
  32  |       energy: w.sim.signal ? w.sim.signal.actors.echo.energy.energy : null,
  33  |       tick: w.sim.tick, paused: gs.paused === true
  34  |     };
  35  |   });
  36  | }
  37  | test('P2 local coop: proposal -> confirm (paused) -> duplicate window -> resume applied', async ({ page }) => {
  38  |   await page.goto('/'); await page.evaluate(() => localStorage.clear()); await page.reload();
  39  |   await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  40  |   await clickText(page, 'MainMenuScene', 'DEMO 01');
  41  |   await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
  42  |   await page.waitForTimeout(800);
  43  |   await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  44  |   await clickText(page, 'PauseScene', 'AI & COMPANION');
  45  |   await clickText(page, 'PauseScene', 'ECHO COMPANION');
  46  |   const a = await st(page);
  47  |   console.log('[A] echo page', JSON.stringify({ echo: a.echo }));
  48  |   if (!a.echo) {
  49  |     await clickText(page, 'PauseScene', 'ENABLE ECHO');
  50  |     // ECHO enable is queued: it commits on the next real tick, so resume first.
  51  |     await clickText(page, 'PauseScene', 'BACK');
  52  |     await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  53  |     if (await page.evaluate(() => (window as any).__game.scene.isActive('PauseScene'))) { await page.keyboard.press('Escape'); }
  54  |     await page.waitForTimeout(1200);
  55  |     const spawned = await st(page);
  56  |     console.log('[A2] after resume', JSON.stringify({ echo: spawned.echo, tick: spawned.tick, paused: spawned.paused }));
  57  |     await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  58  |     await clickText(page, 'PauseScene', 'AI & COMPANION');
  59  |     await clickText(page, 'PauseScene', 'ECHO COMPANION');
  60  |   }
  61  |   await clickText(page, 'PauseScene', 'LOCAL COOPERATION');
  62  |   await page.waitForTimeout(500);
  63  |   const s1 = await st(page);
  64  |   console.log('[1] local page', JSON.stringify(s1));
  65  |   await page.screenshot({ path: `${OUT}/local-page-1280x720.png` });
  66  | 
  67  |   if (!s1.proposal) { console.log('[skip] no local proposal'); return; }
  68  |   const id1 = s1.proposal.id;
  69  |   await clickText(page, 'PauseScene', 'CONFIRM (HUMAN)');
  70  |   await page.waitForTimeout(400);
  71  |   const s2 = await st(page);
  72  |   console.log('[2] after confirm (still paused)', JSON.stringify({ proposal: s2.proposal, notice: s2.notice, confirmEnabled: s2.confirmEnabled, pending: s2.pending, audit: s2.audit, tick: s2.tick }));
  73  |   // Blocker probe: is a NEW proposal regenerated + confirm re-enabled with a pending command?
  74  |   await page.screenshot({ path: `${OUT}/after-confirm-paused-1280x720.png` });
  75  |   let s3 = s2;
  76  |   if (s2.proposal && s2.confirmEnabled) {
  77  |     await clickText(page, 'PauseScene', 'CONFIRM (HUMAN)');
  78  |     await page.waitForTimeout(400);
  79  |     s3 = await st(page);
  80  |     console.log('[3] SECOND confirm while still paused', JSON.stringify({ proposal: s3.proposal, pending: s3.pending, audit: s3.audit, notice: s3.notice }));
  81  |   }
  82  |   // resume -> real commit
  83  |   await clickText(page, 'PauseScene', 'BACK');
  84  |   await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  85  |   if (await page.evaluate(() => (window as any).__game.scene.isActive('PauseScene'))) { await page.keyboard.press('Escape'); }
  86  |   await page.waitForTimeout(1200);
  87  |   await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  88  |   await clickText(page, 'PauseScene', 'AI & COMPANION');
  89  |   await clickText(page, 'PauseScene', 'ECHO COMPANION');
  90  |   await clickText(page, 'PauseScene', 'LOCAL COOPERATION');
  91  |   await page.waitForTimeout(600);
  92  |   const s4 = await st(page);
  93  |   console.log('[4] after resume', JSON.stringify({ relay: s4.relay, energy: s4.energy, audit: s4.audit, notice: s4.notice, paused: s4.paused, tick: s4.tick }));
  94  |   await page.screenshot({ path: `${OUT}/after-resume-1280x720.png` });
  95  |   // switch persistence
  96  |   await clickText(page, 'PauseScene', 'LOW-RISK COOPERATION');
  97  |   await page.waitForTimeout(400);
  98  |   const s5 = await st(page);
  99  |   const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') || '{}'));
  100 |   console.log('[5] switch', JSON.stringify({ label: s5.switchLabel, optIn: s5.optIn, savedOptIn: saved?.permanent?.echoCooperationOptIn ?? null, notice: s5.notice }));
  101 |   console.log('[TARGET-IDS]', JSON.stringify({ id1, secondId: s3.proposal?.id ?? null }));
  102 | });
  103 | 
```