# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai-native-world.spec.ts >> AI-NATIVE-02 P1 real World >> shared control path, AI run, disable/takeover, level-up takeover, pause/death/restart/exit
- Location: tests\ai-native-world.spec.ts:257:3

# Error details

```
Error: GameOverScene after death

expect(received).toContain(expected) // indexOf

Expected value: "GameOverScene"
Received array: ["GameScene"]
```

# Test source

```ts
  516 |     if (stationaryStart!.hp === stationary!.hp) {
  517 |       // No enemy knockback involved: the disabled AI must not move the player.
  518 |       expect(stationary!.grid.x, 'disabled AI does not move the player').toBeCloseTo(stationaryStart!.grid.x, 6);
  519 |       expect(stationary!.grid.y, 'disabled AI does not move the player').toBeCloseTo(stationaryStart!.grid.y, 6);
  520 |     }
  521 |     record('manual-disable', { owner: stationary!.owner, takeoverCount: stationary!.takeoverCount, reason: disabled!.lastTakeoverReason });
  522 | 
  523 |     // Human safety takeover during live AI play.
  524 |     await enableAiViaPause(page);
  525 |     await clearLevelUp(page);
  526 |     const beforeTakeover = await state(page);
  527 |     expect(beforeTakeover!.owner).toBe('ai');
  528 |     // Fine-grained position tracking: real movement is continuous, a teleport
  529 |     // would show one huge step. This is an observed movement/collision check,
  530 |     // not a relaxed aggregate threshold.
  531 |     const track: Array<{ x: number; y: number }> = [{ ...beforeTakeover!.grid }];
  532 |     await page.keyboard.down('KeyD');
  533 |     for (let i = 0; i < 6; i++) {
  534 |       await page.waitForTimeout(80);
  535 |       const s = await state(page);
  536 |       track.push({ ...s!.grid });
  537 |     }
  538 |     await page.keyboard.up('KeyD');
  539 |     await page.waitForTimeout(250);
  540 |     const maxTrackStep = Math.max(...track.slice(1).map((p, i) =>
  541 |       Math.hypot(p.x - track[i].x, p.y - track[i].y)));
  542 |     await clearLevelUp(page);
  543 |     st = await state(page);
  544 |     expect(st!.owner, 'human regained ownership').toBe('human');
  545 |     expect(st!.aiEnabled, 'local demo disabled after takeover').toBe(false);
  546 |     expect(st!.lastTakeoverReason).toBe('human-input');
  547 |     expect(st!.lastIntentOwner).toBe('human');
  548 |     expect(st!.txtControl).toContain('HUMAN');
  549 |     expect(maxTrackStep, 'takeover movement is continuous, not a teleport').toBeLessThan(1.2);
  550 |     expect((await state(page))!.walkable, 'post-takeover position is walkable').toBe(true);
  551 |     record('human-takeover', {
  552 |       owner: st!.owner, takeoverCount: st!.takeoverCount, reason: st!.lastTakeoverReason,
  553 |       maxTrackStep, track
  554 |     });
  555 |     await page.waitForTimeout(2000);
  556 |     expect((await state(page))!.owner, 'human keeps control for 2s after takeover').toBe('human');
  557 | 
  558 |     // Real product behavior: human takes over while LevelUpScene is on top.
  559 |     await enableAiViaPause(page);
  560 |     await clearLevelUp(page);
  561 |     const takeoversBeforeLevelUp = (await state(page))!.takeoverCount;
  562 |     await page.evaluate(() => {
  563 |       const g: any = (window as any).__game;
  564 |       // Production builds minify class names: always resolve scenes by key.
  565 |     const gs: any = g.scene.getScene('GameScene');
  566 |       const pl = gs.world.player;
  567 |       pl.addXp(pl.data.xpToNext);
  568 |     });
  569 |     await page.waitForTimeout(1200);
  570 |     const overlay = await state(page);
  571 |     expect(overlay!.active, 'LevelUpScene open').toContain('LevelUpScene');
  572 |     expect(overlay!.owner, 'AI still owns the paused run before human input').toBe('ai');
  573 |     const overlayActionCount = overlay!.aiActionCount;
  574 |     await page.waitForTimeout(900);
  575 |     const overlayFrozen = await state(page);
  576 |     expect(overlayFrozen!.aiActionCount, 'AI cannot act inside the overlay').toBe(overlayActionCount);
  577 |     expect(overlayFrozen!.grid.x, 'player cannot move inside the overlay').toBeCloseTo(overlay!.grid.x, 6);
  578 |     expect(overlayFrozen!.grid.y, 'player cannot move inside the overlay').toBeCloseTo(overlay!.grid.y, 6);
  579 |     await page.screenshot({ path: path.join(OUT, 'levelup-ai-paused-1280x720.png') });
  580 |     // A single movement key must reclaim control WITHOUT closing the overlay.
  581 |     await page.keyboard.press('KeyW');
  582 |     await page.waitForTimeout(500);
  583 |     const duringOverlay = await state(page);
  584 |     expect(duringOverlay!.active, 'LevelUpScene still open after takeover key').toContain('LevelUpScene');
  585 |     expect(duringOverlay!.owner, 'human takeover works inside the level-up overlay').toBe('human');
  586 |     expect(duringOverlay!.aiEnabled, 'AI disabled by overlay takeover').toBe(false);
  587 |     expect(duringOverlay!.takeoverCount, 'overlay takeover counted').toBe(takeoversBeforeLevelUp + 1);
  588 |     record('levelup-takeover', {
  589 |       active: duringOverlay!.active, owner: duringOverlay!.owner,
  590 |       takeoverCount: duringOverlay!.takeoverCount, reason: duringOverlay!.lastTakeoverReason
  591 |     });
  592 |     await page.keyboard.press('1'); // real product choice, then resume
  593 |     await page.waitForTimeout(900);
  594 |     const afterLevelUp = await state(page);
  595 |     expect(afterLevelUp!.active, 'LevelUpScene closed after choosing').not.toContain('LevelUpScene');
  596 |     expect(afterLevelUp!.paused, 'run resumed after choosing').toBe(false);
  597 |     expect(afterLevelUp!.owner, 'human still owns control after level-up').toBe('human');
  598 |     expect(afterLevelUp!.aiEnabled, 'AI stays disabled after level-up takeover').toBe(false);
  599 |     expect(afterLevelUp!.txtControl, 'HUD reflects human control after level-up').toContain('HUMAN');
  600 |     record('levelup-after', { owner: afterLevelUp!.owner, aiEnabled: afterLevelUp!.aiEnabled, paused: afterLevelUp!.paused });
  601 | 
  602 |     // Death ends the run: AI is dropped and control returns to the human.
  603 |     await page.evaluate(() => {
  604 |       const g: any = (window as any).__game;
  605 |       // Production builds minify class names: always resolve scenes by key.
  606 |     const gs: any = g.scene.getScene('GameScene');
  607 |       gs.world.player.invuln = 0;
  608 |       gs.world.player.hurt(999999, gs.world.player.wx + 1, gs.world.player.wy);
  609 |       // Commit the queued hit deterministically (B4: legacy hurt is applied by
  610 |       // the core on the next tick, not synchronously by the adapter).
  611 |       const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  612 |       for (let i = 0; i < 10; i++) gs.world.stepFrame(1000 / 60, neutral);
  613 |     });
  614 |     await page.waitForTimeout(400);
  615 |     const dead = await state(page);
> 616 |     expect(dead!.active, 'GameOverScene after death').toContain('GameOverScene');
      |                                                       ^ Error: GameOverScene after death
  617 |     expect(dead!.active, 'GameOverScene after death').toContain('GameOverScene');
  618 |     expect(dead!.owner, 'ownership back to human after death').toBe('human');
  619 |     expect(dead!.aiEnabled, 'AI disabled after death').toBe(false);
  620 |     expect(dead!.authorityPaused, 'authority paused after death').toBe(true);
  621 |     const saveAfterDeath = await page.evaluate(() => {
  622 |       const raw = localStorage.getItem('last_signal_save_v1');
  623 |       const parsed = raw ? JSON.parse(raw) : {};
  624 |       return { hasRun: !!parsed.run, cores: parsed.permanent?.cores ?? null };
  625 |     });
  626 |     expect(saveAfterDeath.hasRun, 'death clears the run checkpoint').toBe(false);
  627 |     record('death', { active: dead!.active, owner: dead!.owner, aiEnabled: dead!.aiEnabled, save: saveAfterDeath });
  628 |     await page.screenshot({ path: path.join(OUT, 'death-ownership-1280x720.png') });
  629 | 
  630 |     // Restart: a brand-new run boots human-controlled, with no residual state.
  631 |     await clickLogical(page, 640, 500); // RETRY SAME SEED
  632 |     await page.waitForTimeout(1600);
  633 |     const restarted = await state(page);
  634 |     // R-03 evidence: a captured checkpoint frame is a deep copy, not live state.
  635 |     const captured = await page.evaluate(() => {
  636 |       const g: any = (window as any).__game;
  637 |       // Production builds minify class names: always resolve scenes by key.
  638 |     const gs: any = g.scene.getScene('GameScene');
  639 |       const cp = gs.world.captureCheckpoint('frame-test', gs.seed, gs.runStats());
  640 |       if (!cp) return { available: false };
  641 |       (window as any).__capturedFrame = cp;
  642 |       (window as any).__capturedJson = JSON.stringify(cp);
  643 |       // Mutate the live run the same way play would (currency / hp) through core
  644 |       // transactions, so this remains valid on a production preview.
  645 |       gs.world.enqueueCurrency(7);
  646 |       gs.world.enqueueHeal(-5);
  647 |       gs.world.resetSimulationAccumulator();
  648 |       gs.world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  649 |       return { available: true };
  650 |     });
  651 |     expect(captured.available, 'start-room checkpoint frame captured in memory').toBe(true);
  652 |     const afterMutation = await page.evaluate(() => {
  653 |       const g: any = (window as any).__game;
  654 |       // Production builds minify class names: always resolve scenes by key.
  655 |     const gs: any = g.scene.getScene('GameScene');
  656 |       const cp = (window as any).__capturedFrame;
  657 |       return {
  658 |         unchanged: JSON.stringify(cp) === (window as any).__capturedJson,
  659 |         capturedCurrency: cp.player.currency,
  660 |         liveCurrency: gs.world.player.data.currency,
  661 |         capturedHp: cp.player.hp,
  662 |         liveHp: gs.world.player.data.hp
  663 |       };
  664 |     });
  665 |     expect(afterMutation.unchanged, 'captured frame does not mutate with the live run').toBe(true);
  666 |     expect(afterMutation.liveCurrency, 'live run changed').toBe(afterMutation.capturedCurrency + 7);
  667 |     record('checkpoint-copy', afterMutation);
  668 |     expect(restarted!.active, 'new GameScene after restart').toContain('GameScene');
  669 |     expect(restarted!.paused, 'new run resumed').toBe(false);
  670 |     expect(restarted!.owner, 'new run starts human-controlled').toBe('human');
  671 |     expect(restarted!.aiEnabled, 'no AI state carried into new run').toBe(false);
  672 |     expect(restarted!.aiActionCount).toBe(0);
  673 |     expect(restarted!.takeoverCount).toBe(0);
  674 |     record('restart', { owner: restarted!.owner, aiEnabled: restarted!.aiEnabled, aiActionCount: restarted!.aiActionCount });
  675 | 
  676 |     // Scene exit: QUIT TO MENU must shut the World down without errors.
  677 |     await page.keyboard.press('Escape');
  678 |     await page.waitForTimeout(500);
  679 |     await clickLogical(page, 640, 480); // QUIT TO MENU
  680 |     await page.waitForTimeout(1000);
  681 |     const menuActive = await page.evaluate(() =>
  682 |       (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key));
  683 |     expect(menuActive, 'MainMenuScene active after quit').toContain('MainMenuScene');
  684 |     expect(menuActive, 'GameScene stopped after quit').not.toContain('GameScene');
  685 |     record('scene-exit', { active: menuActive });
  686 |     expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
  687 |     saveLog('control-flow-1280x720');
  688 |   });
  689 | 
  690 |   for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720], [1024, 768], [800, 600]] as Array<[number, number]>) {
  691 |     test(`HUD fully visible, non-overlapping and scaled geometry at ${w}x${h}`, async ({ page }) => {
  692 |       test.setTimeout(60000);
  693 |       const errors: string[] = [];
  694 |       page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  695 |       page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  696 |       await page.setViewportSize({ width: w, height: h });
  697 |       mkdirSync(OUT, { recursive: true });
  698 | 
  699 |       await bootRun(page);
  700 |       await stabilizeEvidenceRun(page);
  701 |       const scale = ((await canvasBox(page))!.w) / GAME_W;
  702 |       await enableAiViaPause(page);
  703 |       await page.waitForTimeout(1200);
  704 |       // A real run may open the real LevelUpScene; choose its first card.
  705 |       for (let i = 0; i < 6; i++) {
  706 |         const active = await page.evaluate(() =>
  707 |           (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key));
  708 |         if (!active.includes('LevelUpScene')) break;
  709 |         await page.keyboard.press('1');
  710 |         await page.waitForTimeout(450);
  711 |       }
  712 |       const st = await state(page);
  713 |       expect(st!.mode, 'AI running at this viewport').toBe('AI');
  714 |       expect(st!.owner).toBe('ai');
  715 |       expect(st!.txtControl).toContain('LOCAL DETERMINISTIC');
  716 |       expect(st!.txtAgentLink).toContain('EXTERNAL NOT CONNECTED');
```