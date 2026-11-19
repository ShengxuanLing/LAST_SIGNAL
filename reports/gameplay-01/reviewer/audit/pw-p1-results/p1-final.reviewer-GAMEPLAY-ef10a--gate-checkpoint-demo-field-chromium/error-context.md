# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p1-final.reviewer.spec.ts >> GAMEPLAY-01 P1 final reviewer harness >> B: routes A/B by real walking, JAMMED gate, checkpoint demo field
- Location: reports\gameplay-01\reviewer\audit\p1-final.reviewer.spec.ts:300:3

# Error details

```
Error: independent normal walking reached route-B portal

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Test source

```ts
  299 | 
  300 |   test('B: routes A/B by real walking, JAMMED gate, checkpoint demo field', async ({ page }) => {
  301 |     test.setTimeout(300000);
  302 | 
  303 |     // ---- Phase 1: JAMMED gate + checkpoint(null) + route A by real walking
  304 |     await enterDemo(page);
  305 |     const s0 = await st(page);
  306 |     const routes = s0.p1!.routes;
  307 |     const routeA = routes.find((r: any) => r.w === 'RELAY_ACTIVE')!;
  308 |     const routeB = routes.find((r: any) => r.w === 'RELAY_INACTIVE')!;
  309 |     const kinds = await page.evaluate(() => {
  310 |       const w: any = (window as any).__game.scene.getScene('GameScene').world;
  311 |       const sc = w.p1Scenario;
  312 |       return sc ? sc.routes.map((r: any) => ({ target: r.target, kind: w.map.rooms[r.target]?.kind })) : null;
  313 |     });
  314 |     console.log('[B] routes/kinds', JSON.stringify({ routeA, routeB, kinds }));
  315 |     for (const k of kinds ?? []) expect(['boss', 'extraction'], 'route target must not be a terminal room').not.toContain(k.kind);
  316 | 
  317 |     await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.clearEnemiesForTest());
  318 |     await page.waitForTimeout(700);
  319 |     const cleared = await st(page);
  320 |     expect(cleared.cleared, 'room cleared (labelled fixture: clearEnemiesForTest)').toBe(true);
  321 |     expect(cleared.portal!.target, 'ACTIVE selects route A').toBe(routeA.t);
  322 | 
  323 |     // Jam from the spawn tile (which is in JAM range) -> portal must vanish.
  324 |     const jamNearRelay = await page.evaluate(() => {
  325 |       const w: any = (window as any).__game.scene.getScene('GameScene').world;
  326 |       const sc = w.p1Scenario;
  327 |       return { dist: Math.hypot(w.player.x - sc.relay.x, w.player.y - sc.relay.y) };
  328 |     });
  329 |     await tap(page, 'KeyY');
  330 |     await page.waitForTimeout(350);
  331 |     const jammed = await st(page);
  332 |     console.log('[B] jam near relay', JSON.stringify({ dist: +jamNearRelay.dist.toFixed(2), relay: jammed.relay, energy: jammed.energy, portal: jammed.portal }));
  333 |     expect(jammed.relay, 'jam accepted from an in-range position').toBe('JAMMED');
  334 |     expect(jammed.portal, 'JAMMED matches neither route: portal is gone').toBeNull();
  335 | 
  336 |     // Distance from the portal tile to the relay: documents why "stand on the
  337 |     // door and jam it" is not reachable through natural play.
  338 |     const distPortalToRelay = await page.evaluate(() => {
  339 |       const w: any = (window as any).__game.scene.getScene('GameScene').world;
  340 |       const sc = w.p1Scenario;
  341 |       return Math.hypot(sc.relay.x - w.portal?.wx ?? 0, 0);
  342 |     }).catch(() => null);
  343 | 
  344 |     // Save while the portal is null (pause), then F on the same tile must not pass.
  345 |     await page.keyboard.press('Escape');
  346 |     await page.waitForTimeout(700);
  347 |     const saved = await readSave(page);
  348 |     console.log('[B] save while JAMMED', JSON.stringify({ demo: saved.run?.demo, portalTarget: saved.run?.portalTarget, relay: saved.run?.coreState?.signal?.relay ?? null }));
  349 |     expect(saved.run?.demo, 'checkpoint carries the demo marker').toBe('p1');
  350 |     expect(saved.run?.portalTarget, 'JAMMED => portalTarget null in save').toBeNull();
  351 |     await page.keyboard.press('Escape');
  352 |     await page.waitForTimeout(600);
  353 |     const roomBefore = (await st(page)).room;
  354 |     await tap(page, 'KeyF');
  355 |     await page.waitForTimeout(600);
  356 |     expect((await st(page)).room, 'F cannot pass with no portal (JAMMED)').toBe(roomBefore);
  357 | 
  358 |     // Expiry restores ACTIVE -> route A portal; walk it for real and cross.
  359 |     await page.waitForFunction(() => {
  360 |       const gs: any = (window as any).__game.scene.getScene('GameScene');
  361 |       return gs.world.sim.signal?.relay === 'ACTIVE';
  362 |     }, undefined, { timeout: 20000 });
  363 |     await page.waitForTimeout(600);
  364 |     const backA = await st(page);
  365 |     expect(backA.portal, 'portal returns after jam expiry').not.toBeNull();
  366 |     expect(backA.portal!.target, 'expiry restores route A (manual/powered preserved)').toBe(routeA.t);
  367 |     const walkedA = await walkTo(page, backA.portal!.x, backA.portal!.y);
  368 |     expect(walkedA, 'independent normal walking reached route-A portal').toBe(true);
  369 |     // jam is out of range from the door: record the real refusal (design observation)
  370 |     const atDoor = await page.evaluate(() => {
  371 |       const w: any = (window as any).__game.scene.getScene('GameScene').world;
  372 |       const sc = w.p1Scenario;
  373 |       return { dist: Math.hypot(w.player.x - sc.relay.x, w.player.y - sc.relay.y) };
  374 |     });
  375 |     await tap(page, 'KeyY');
  376 |     await page.waitForTimeout(300);
  377 |     const doorJam = await page.evaluate(() => {
  378 |       const w: any = (window as any).__game.scene.getScene('GameScene').world;
  379 |       return { relay: w.sim.signal?.relay ?? null, feedback: w.lastSignalFeedback };
  380 |     });
  381 |     console.log('[B] jam at the door tile', JSON.stringify({ distToRelay: +atDoor.dist.toFixed(2), ...doorJam }));
  382 | 
  383 |     await tap(page, 'KeyF');
  384 |     await page.waitForFunction((t) => (window as any).__game.scene.getScene('GameScene').world.currentRoomId === t, routeA.t, { timeout: 15000 }).catch(() => undefined);
  385 |     const crossedA = await st(page);
  386 |     console.log('[B] crossed A', JSON.stringify({ room: crossedA.room, expected: routeA.t }));
  387 |     expect(crossedA.room, 'F at the route-A portal enters room A (real walking + real F)').toBe(routeA.t);
  388 | 
  389 |     // ---- Phase 2: fresh demo -> route B by real walking
  390 |     await enterDemo(page);
  391 |     await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.clearEnemiesForTest());
  392 |     await page.waitForTimeout(600);
  393 |     await tap(page, 'KeyR');
  394 |     await page.waitForTimeout(700);
  395 |     const sw = await st(page);
  396 |     expect(sw.relay, 'R -> INACTIVE').toBe('INACTIVE');
  397 |     expect(sw.portal!.target, 'INACTIVE selects route B (live)').toBe(routeB.t);
  398 |     const walkedB = await walkTo(page, sw.portal!.x, sw.portal!.y);
> 399 |     expect(walkedB, 'independent normal walking reached route-B portal').toBe(true);
      |                                                                          ^ Error: independent normal walking reached route-B portal
  400 |     await tap(page, 'KeyF');
  401 |     await page.waitForFunction((t) => (window as any).__game.scene.getScene('GameScene').world.currentRoomId === t, routeB.t, { timeout: 15000 }).catch(() => undefined);
  402 |     const crossedB = await st(page);
  403 |     console.log('[B] crossed B', JSON.stringify({ room: crossedB.room, expected: routeB.t }));
  404 |     expect(crossedB.room, 'F at the route-B portal enters room B (real walking + real F)').toBe(routeB.t);
  405 |     await page.screenshot({ path: `${OUT}/demo-B-route-walked.png` });
  406 |   });
  407 | 
  408 |   test('C: independent real-walk crossing for route A and route B', async ({ page }) => {
  409 |     test.setTimeout(300000);
  410 |     // Route A: default ACTIVE
  411 |     await enterDemo(page);
  412 |     const a0 = await st(page);
  413 |     const routeA = a0.p1!.routes.find((r: any) => r.w === 'RELAY_ACTIVE')!;
  414 |     const routeB = a0.p1!.routes.find((r: any) => r.w === 'RELAY_INACTIVE')!;
  415 |     await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.clearEnemiesForTest());
  416 |     await page.waitForTimeout(700);
  417 |     const pa = await st(page);
  418 |     expect(pa.portal!.target, 'ACTIVE -> route A portal').toBe(routeA.t);
  419 |     const okA = await walkTo(page, pa.portal!.x, pa.portal!.y);
  420 |     expect(okA, 'real walking reached route A portal').toBe(true);
  421 |     await tap(page, 'KeyF');
  422 |     const crossedA = await page.waitForFunction((t) => (window as any).__game.scene.getScene('GameScene').world.currentRoomId === t, routeA.t, { timeout: 12000 }).then(() => true).catch(() => false);
  423 |     const sA = await st(page);
  424 |     console.log('[C] route A', JSON.stringify({ crossedA, room: sA.room, expected: routeA.t }));
  425 |     expect(crossedA, 'F at route A portal enters room A').toBe(true);
  426 |     await page.screenshot({ path: `${OUT}/walk-route-A.png` });
  427 | 
  428 |     // Route B: fresh demo, R -> INACTIVE
  429 |     await enterDemo(page);
  430 |     await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.clearEnemiesForTest());
  431 |     await page.waitForTimeout(600);
  432 |     await tap(page, 'KeyR');
  433 |     await page.waitForTimeout(700);
  434 |     const pb = await st(page);
  435 |     expect(pb.relay, 'R -> INACTIVE').toBe('INACTIVE');
  436 |     expect(pb.portal!.target, 'INACTIVE -> route B portal').toBe(routeB.t);
  437 |     const okB = await walkTo(page, pb.portal!.x, pb.portal!.y);
  438 |     expect(okB, 'real walking reached route B portal').toBe(true);
  439 |     await tap(page, 'KeyF');
  440 |     const crossedB = await page.waitForFunction((t) => (window as any).__game.scene.getScene('GameScene').world.currentRoomId === t, routeB.t, { timeout: 12000 }).then(() => true).catch(() => false);
  441 |     const sB = await st(page);
  442 |     console.log('[C] route B', JSON.stringify({ crossedB, room: sB.room, expected: routeB.t }));
  443 |     expect(crossedB, 'F at route B portal enters room B').toBe(true);
  444 |     await page.screenshot({ path: `${OUT}/walk-route-B.png` });
  445 |   });
  446 | 
  447 |   test('compact 800x600: new HUD detail text size, contrast and overlap', async ({ page }) => {
  448 |     test.setTimeout(180000);
  449 |     await page.setViewportSize({ width: 800, height: 600 });
  450 |     await enterDemo(page);
  451 |     await page.waitForTimeout(600);
  452 |     const info = await page.evaluate(() => {
  453 |       const gs: any = (window as any).__game.scene.getScene('GameScene');
  454 |       const g: any = (window as any).__game;
  455 |       const canvas = document.querySelector('canvas')!;
  456 |       const r = canvas.getBoundingClientRect();
  457 |       const scale = r.width / g.scale.gameSize.width;
  458 |       const text = gs.txtSignalDetail;
  459 |       const style = text ? String(text.style.fontSize) : null;
  460 |       const logical = style ? parseFloat(style) : null;
  461 |       const b = text ? text.getBounds() : null;
  462 |       // overlaps with other HUD texts (screen-locked, same camera space)
  463 |       const others = gs.hudObjects.filter((o: any) => o && o !== text && o.type === 'Text' && o.visible !== false);
  464 |       const box = (o: any) => { const q = o.getBounds(); return { x: q.x, y: q.y, w: q.width, h: q.height }; };
  465 |       const tb = b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
  466 |       const overlaps: Array<{ other: string; area: number }> = [];
  467 |       if (tb) {
  468 |         for (const o of others) {
  469 |           const q = box(o);
  470 |           const ox = Math.min(tb.x + tb.w, q.x + q.w) - Math.max(tb.x, q.x);
  471 |           const oy = Math.min(tb.y + tb.h, q.y + q.h) - Math.max(tb.y, q.y);
  472 |           if (ox > 1 && oy > 1) overlaps.push({ other: String(o.text || o.type).slice(0, 28), area: Math.round(ox * oy) });
  473 |         }
  474 |       }
  475 |       return {
  476 |         scale, logical, css: logical ? +(logical * scale).toFixed(2) : null,
  477 |         color: text ? String(text.style.color) : null,
  478 |         text: text ? String(text.text) : null,
  479 |         box: tb, overlaps,
  480 |         canvas: { w: r.width, h: r.height }
  481 |       };
  482 |     });
  483 |     console.log('[compact] detail', JSON.stringify(info));
  484 |     expect(info.css, 'new HUD detail text keeps >=10 CSS px').toBeGreaterThanOrEqual(10);
  485 |     expect(info.overlaps.filter((o) => o.area > 6), 'no real overlap with other HUD text').toEqual([]);
  486 |     // contrast ratio of the detail colour vs the game background (#05070c)
  487 |     const lum = (hex: string) => {
  488 |       const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  489 |       if (!m) return null;
  490 |       const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
  491 |         .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  492 |       return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  493 |     };
  494 |     const bg = lum('#05070c')!;
  495 |     const fg = info.color ? lum(info.color) : null;
  496 |     const contrast = fg === null ? null : +(((fg + 0.05) / (bg + 0.05)).toFixed(2));
  497 |     console.log('[compact] contrast', JSON.stringify({ color: info.color, contrast }));
  498 |     await page.screenshot({ path: `${OUT}/p1-compact-800x600.png` });
  499 | 
```