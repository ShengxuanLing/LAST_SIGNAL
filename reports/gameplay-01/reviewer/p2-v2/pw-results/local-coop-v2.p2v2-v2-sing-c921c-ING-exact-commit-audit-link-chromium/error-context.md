# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: local-coop-v2.p2v2.spec.ts >> v2 single-pending: scan + toggle, WAITING, exact commit, audit link
- Location: reports\gameplay-01\reviewer\p2-v2\local-coop-v2.p2v2.spec.ts:69:1

# Error details

```
Error: exactly one toggle applied

expect(received).toBe(expected) // Object.is equality

Expected: false
Received: true
```

# Test source

```ts
  49  |   await page.goto('/'); await page.evaluate(() => localStorage.clear()); await page.reload();
  50  |   await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'), { timeout: 25000 });
  51  |   await clickText(page, 'MainMenuScene', 'DEMO 01');
  52  |   await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'), { timeout: 20000 });
  53  |   await page.waitForTimeout(700);
  54  |   await page.keyboard.press('Escape'); await page.waitForTimeout(450);
  55  |   await clickText(page, 'PauseScene', 'AI & COMPANION');
  56  |   await clickText(page, 'PauseScene', 'ECHO COMPANION');
  57  |   if (!(await st(page)).echo) {
  58  |     await clickText(page, 'PauseScene', 'ENABLE ECHO');
  59  |     await clickText(page, 'PauseScene', 'BACK');
  60  |     await resume(page);
  61  |     await page.keyboard.press('Escape'); await page.waitForTimeout(450);
  62  |     await clickText(page, 'PauseScene', 'AI & COMPANION');
  63  |     await clickText(page, 'PauseScene', 'ECHO COMPANION');
  64  |   }
  65  |   await clickText(page, 'PauseScene', 'LOCAL COOPERATION');
  66  |   await page.waitForTimeout(450);
  67  | }
  68  | 
  69  | test('v2 single-pending: scan + toggle, WAITING, exact commit, audit link', async ({ page }) => {
  70  |   await bootAndLocal(page);
  71  |   const s1 = await st(page);
  72  |   console.log('[1] local page', JSON.stringify(s1));
  73  |   await page.screenshot({ path: `${OUT}/v2-local-1280x720.png` });
  74  |   expect(s1.proposal, 'a local proposal exists').not.toBeNull();
  75  |   const propId = s1.proposal!.id;
  76  |   const before = { tick: s1.tick, hp: s1.hp, echoEnergy: s1.echoEnergy, echoHp: s1.echo?.hp };
  77  | 
  78  |   await clickText(page, 'PauseScene', 'CONFIRM (HUMAN)');
  79  |   const s2 = await st(page);
  80  |   console.log('[2] after confirm#1 (paused)', JSON.stringify(s2));
  81  |   expect(s2.pending?.id).toBe(propId);
  82  |   expect(s2.queued, 'exactly one queued command').toBe(1);
  83  |   expect(s2.proposal, 'no new proposal while pending').toBeNull();
  84  |   expect(s2.confirmEnabled, 'CONFIRM disabled while pending').toBe(false);
  85  |   expect(s2.notice ?? '', 'WAITING text names the proposal').toContain(propId);
  86  |   expect({ tick: s2.tick, hp: s2.hp, echoEnergy: s2.echoEnergy, echoHp: s2.echo?.hp }).toEqual(before);
  87  |   await page.screenshot({ path: `${OUT}/v2-waiting-1280x720.png` });
  88  | 
  89  |   const direct = await page.evaluate((id) => {
  90  |     const w: any = (window as any).__game.scene.getScene('GameScene').world;
  91  |     const out: any = { same: w.confirmLocalEchoProposal(id), queued: (w.sim.pendingCommands ?? []).length, pending: w.echoPendingLocal?.proposalId ?? null };
  92  |     out.wrong = w.confirmLocalEchoProposal('local_999_9');
  93  |     out.queued2 = (w.sim.pendingCommands ?? []).length;
  94  |     out.pending2 = w.echoPendingLocal?.proposalId ?? null;
  95  |     out.audit = w.echoAudit.last();
  96  |     return out;
  97  |   }, propId);
  98  |   console.log('[3] direct re-confirms', JSON.stringify(direct));
  99  |   expect(direct.same).toBe(false);
  100 |   expect(direct.wrong).toBe(false);
  101 |   expect(direct.queued).toBe(1);
  102 |   expect(direct.queued2).toBe(1);
  103 |   expect(direct.pending2).toBe(propId);
  104 |   expect(direct.audit?.code).toBe('E_ALREADY_PENDING');
  105 | 
  106 |   // resume: capture the committed signal event, then settle + settle-linked audit
  107 |   await page.evaluate(() => {
  108 |     const w: any = (window as any).__game.scene.getScene('GameScene').world;
  109 |     (window as any).__p2v2 = { events: [] };
  110 |     const orig = w.stepFrame.bind(w);
  111 |     w.stepFrame = (...a: any[]) => { const ev = orig(...a) as any[]; for (const e of ev) if (e?.type?.startsWith?.('signal-')) (window as any).__p2v2.events.push(e); return ev; };
  112 |   });
  113 |   await clickText(page, 'PauseScene', 'BACK');
  114 |   await resume(page);
  115 |   await page.waitForTimeout(500);
  116 |   const events = await page.evaluate(() => (window as any).__p2v2.events);
  117 |   const scanEv = (events ?? []).find((e: any) => e.type === 'signal-scanned');
  118 |   console.log('[3b] committed signal event', JSON.stringify(scanEv ?? null));
  119 |   const after = await st(page);
  120 |   console.log('[4] after resume', JSON.stringify(after));
  121 |   expect(after.pending, 'guard cleared by its own receipt').toBeNull();
  122 |   expect(after.queued, 'queue drained').toBe(0);
  123 |   expect(after.audit?.result).toBe('applied');
  124 |   expect(after.audit?.proposalId).toBe(propId);
  125 |   if (scanEv) {
  126 |     expect(scanEv.actorId, 'scan committed by the ECHO actor').toBe(1);
  127 |     expect(scanEv.ok, 'scan committed ok').toBe(true);
  128 |   }
  129 |   await page.screenshot({ path: `${OUT}/v2-applied-1280x720.png` });
  130 | 
  131 |   // second round: scan on cooldown -> toggle proposal -> exactly one flip
  132 |   await page.keyboard.press('Escape'); await page.waitForTimeout(450);
  133 |   await clickText(page, 'PauseScene', 'AI & COMPANION');
  134 |   await clickText(page, 'PauseScene', 'ECHO COMPANION');
  135 |   await clickText(page, 'PauseScene', 'LOCAL COOPERATION');
  136 |   await page.waitForTimeout(400);
  137 |   const t1 = await st(page);
  138 |   console.log('[5] second proposal', JSON.stringify({ proposal: t1.proposal, relay: t1.relay, manual: t1.manual, echoEnergy: t1.echoEnergy }));
  139 |   if (t1.proposal) {
  140 |     const beforeManual = t1.manual;
  141 |     await clickText(page, 'PauseScene', 'CONFIRM (HUMAN)');
  142 |     const t2 = await st(page);
  143 |     expect(t2.queued, 'toggle: exactly one queued command').toBe(1);
  144 |     await clickText(page, 'PauseScene', 'BACK');
  145 |     await resume(page);
  146 |     await page.waitForTimeout(800);
  147 |     const t3 = await st(page);
  148 |     console.log('[6] toggle after resume', JSON.stringify({ manualBefore: beforeManual, manualAfter: t3.manual, relay: t3.relay, audit: t3.audit }));
> 149 |     expect(t3.manual, 'exactly one toggle applied').toBe(!beforeManual);
      |                                                     ^ Error: exactly one toggle applied
  150 |   }
  151 | });
  152 | 
  153 | test('v2 five viewports: proposal/WAITING geometry + font + ESC', async ({ page }) => {
  154 |   const vps: Array<[number, number]> = [[1920, 1080], [1366, 768], [1280, 720], [1024, 768], [800, 600]];
  155 |   for (const [w, h] of vps) {
  156 |     await page.setViewportSize({ width: w, height: h });
  157 |     await bootAndLocal(page);
  158 |     const m = await page.evaluate(() => {
  159 |       const gs: any = (window as any).__game;
  160 |       const s: any = gs.scene.getScene('PauseScene');
  161 |       const c = document.querySelector('canvas')!; const r = c.getBoundingClientRect();
  162 |       const scale = r.width / gs.scale.gameSize.width;
  163 |       const texts = [s.localStatus, s.localProposalText, s.localNoticeText].filter(Boolean);
  164 |       const rows = texts.map((t: any) => {
  165 |         const b = t.getBounds();
  166 |         return { css: +(parseFloat(String(t.style.fontSize)) * scale).toFixed(2), box: { x: b.x, y: b.y, w: b.width, h: b.height } };
  167 |       });
  168 |       const outside = rows.filter((x: any) => x.box.x < -1 || x.box.y < -1 || x.box.x + x.box.w > 1280 + 1 || x.box.y + x.box.h > 720 + 1).length;
  169 |       return { scale: +scale.toFixed(3), outside, minCss: Math.min(...rows.map((x: any) => x.css)), page: s.page };
  170 |     });
  171 |     console.log(`[vp ${w}x${h}]`, JSON.stringify(m));
  172 |     expect(m.page).toBe('local-coop');
  173 |     expect(m.outside, 'no text outside the 1280x720 page').toBe(0);
  174 |     expect(m.minCss, 'text >= 10 CSS px').toBeGreaterThanOrEqual(10);
  175 |     await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  176 |     const page2 = await page.evaluate(() => (window as any).__game.scene.getScene('PauseScene')?.page ?? null);
  177 |     expect(page2, 'ESC from local -> echo page').toBe('echo');
  178 |     await page.screenshot({ path: `${OUT}/v2-local-${w}x${h}.png` });
  179 |   }
  180 | });
  181 | 
```