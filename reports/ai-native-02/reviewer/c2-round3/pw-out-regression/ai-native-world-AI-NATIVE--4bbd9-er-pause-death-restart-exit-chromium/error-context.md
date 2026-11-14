# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai-native-world.spec.ts >> AI-NATIVE-02 P1 real World >> shared control path, AI run, disable/takeover, level-up takeover, pause/death/restart/exit
- Location: tests\ai-native-world.spec.ts:256:3

# Error details

```
Error: HUD reflects human control after level-up

expect(received).toContain(expected) // indexOf

Expected substring: "HUMAN"
Received string:    "CONTROL  PAUSED"
```

# Test source

```ts
  498 |     const disabled = await state(page);
  499 |     expect(disabled!.aiEnabled, 'AI disabled from pause menu').toBe(false);
  500 |     expect(disabled!.owner, 'owner back to human after disable').toBe('human');
  501 |     expect(disabled!.lastTakeoverReason, 'disable reason recorded').toBe('pause-menu');
  502 |     expect(disabled!.takeoverCount, 'disable counted as takeover').toBe(takeoverBeforeDisable + 1);
  503 |     const offLabels = await sceneTexts(page, 'PauseScene');
  504 |     expect(offLabels.some((t) => t.includes('AI CONTROL: OFF')), 'pause menu shows OFF after disable').toBe(true);
  505 |     await page.screenshot({ path: path.join(OUT, 'pause-ai-off-1280x720.png') });
  506 |     await page.keyboard.press('Escape');
  507 |     await page.waitForTimeout(500);
  508 |     const stationaryStart = await state(page);
  509 |     await page.waitForTimeout(2500);
  510 |     const stationary = await state(page);
  511 |     expect(stationary!.owner, 'human still owns control after disable').toBe('human');
  512 |     expect(stationary!.aiEnabled, 'AI stays disabled (no self-reclaim)').toBe(false);
  513 |     expect(stationary!.lastAiAction, 'AI action state cleared after disable').toBeNull();
  514 |     expect(stationary!.txtControl, 'HUD returns to HUMAN').toContain('HUMAN');
  515 |     if (stationaryStart!.hp === stationary!.hp) {
  516 |       // No enemy knockback involved: the disabled AI must not move the player.
  517 |       expect(stationary!.grid.x, 'disabled AI does not move the player').toBeCloseTo(stationaryStart!.grid.x, 6);
  518 |       expect(stationary!.grid.y, 'disabled AI does not move the player').toBeCloseTo(stationaryStart!.grid.y, 6);
  519 |     }
  520 |     record('manual-disable', { owner: stationary!.owner, takeoverCount: stationary!.takeoverCount, reason: disabled!.lastTakeoverReason });
  521 | 
  522 |     // Human safety takeover during live AI play.
  523 |     await enableAiViaPause(page);
  524 |     await clearLevelUp(page);
  525 |     const beforeTakeover = await state(page);
  526 |     expect(beforeTakeover!.owner).toBe('ai');
  527 |     // Fine-grained position tracking: real movement is continuous, a teleport
  528 |     // would show one huge step. This is an observed movement/collision check,
  529 |     // not a relaxed aggregate threshold.
  530 |     const track: Array<{ x: number; y: number }> = [{ ...beforeTakeover!.grid }];
  531 |     await page.keyboard.down('KeyD');
  532 |     for (let i = 0; i < 6; i++) {
  533 |       await page.waitForTimeout(80);
  534 |       const s = await state(page);
  535 |       track.push({ ...s!.grid });
  536 |     }
  537 |     await page.keyboard.up('KeyD');
  538 |     await page.waitForTimeout(250);
  539 |     const maxTrackStep = Math.max(...track.slice(1).map((p, i) =>
  540 |       Math.hypot(p.x - track[i].x, p.y - track[i].y)));
  541 |     await clearLevelUp(page);
  542 |     st = await state(page);
  543 |     expect(st!.owner, 'human regained ownership').toBe('human');
  544 |     expect(st!.aiEnabled, 'local demo disabled after takeover').toBe(false);
  545 |     expect(st!.lastTakeoverReason).toBe('human-input');
  546 |     expect(st!.lastIntentOwner).toBe('human');
  547 |     expect(st!.txtControl).toContain('HUMAN');
  548 |     expect(maxTrackStep, 'takeover movement is continuous, not a teleport').toBeLessThan(1.2);
  549 |     expect((await state(page))!.walkable, 'post-takeover position is walkable').toBe(true);
  550 |     record('human-takeover', {
  551 |       owner: st!.owner, takeoverCount: st!.takeoverCount, reason: st!.lastTakeoverReason,
  552 |       maxTrackStep, track
  553 |     });
  554 |     await page.waitForTimeout(2000);
  555 |     expect((await state(page))!.owner, 'human keeps control for 2s after takeover').toBe('human');
  556 | 
  557 |     // Real product behavior: human takes over while LevelUpScene is on top.
  558 |     await enableAiViaPause(page);
  559 |     await clearLevelUp(page);
  560 |     const takeoversBeforeLevelUp = (await state(page))!.takeoverCount;
  561 |     await page.evaluate(() => {
  562 |       const g: any = (window as any).__game;
  563 |       // Production builds minify class names: always resolve scenes by key.
  564 |     const gs: any = g.scene.getScene('GameScene');
  565 |       const pl = gs.world.player;
  566 |       pl.addXp(pl.data.xpToNext);
  567 |     });
  568 |     await page.waitForTimeout(1200);
  569 |     const overlay = await state(page);
  570 |     expect(overlay!.active, 'LevelUpScene open').toContain('LevelUpScene');
  571 |     expect(overlay!.owner, 'AI still owns the paused run before human input').toBe('ai');
  572 |     const overlayActionCount = overlay!.aiActionCount;
  573 |     await page.waitForTimeout(900);
  574 |     const overlayFrozen = await state(page);
  575 |     expect(overlayFrozen!.aiActionCount, 'AI cannot act inside the overlay').toBe(overlayActionCount);
  576 |     expect(overlayFrozen!.grid.x, 'player cannot move inside the overlay').toBeCloseTo(overlay!.grid.x, 6);
  577 |     expect(overlayFrozen!.grid.y, 'player cannot move inside the overlay').toBeCloseTo(overlay!.grid.y, 6);
  578 |     await page.screenshot({ path: path.join(OUT, 'levelup-ai-paused-1280x720.png') });
  579 |     // A single movement key must reclaim control WITHOUT closing the overlay.
  580 |     await page.keyboard.press('KeyW');
  581 |     await page.waitForTimeout(500);
  582 |     const duringOverlay = await state(page);
  583 |     expect(duringOverlay!.active, 'LevelUpScene still open after takeover key').toContain('LevelUpScene');
  584 |     expect(duringOverlay!.owner, 'human takeover works inside the level-up overlay').toBe('human');
  585 |     expect(duringOverlay!.aiEnabled, 'AI disabled by overlay takeover').toBe(false);
  586 |     expect(duringOverlay!.takeoverCount, 'overlay takeover counted').toBe(takeoversBeforeLevelUp + 1);
  587 |     record('levelup-takeover', {
  588 |       active: duringOverlay!.active, owner: duringOverlay!.owner,
  589 |       takeoverCount: duringOverlay!.takeoverCount, reason: duringOverlay!.lastTakeoverReason
  590 |     });
  591 |     await page.keyboard.press('1'); // real product choice, then resume
  592 |     await page.waitForTimeout(900);
  593 |     const afterLevelUp = await state(page);
  594 |     expect(afterLevelUp!.active, 'LevelUpScene closed after choosing').not.toContain('LevelUpScene');
  595 |     expect(afterLevelUp!.paused, 'run resumed after choosing').toBe(false);
  596 |     expect(afterLevelUp!.owner, 'human still owns control after level-up').toBe('human');
  597 |     expect(afterLevelUp!.aiEnabled, 'AI stays disabled after level-up takeover').toBe(false);
> 598 |     expect(afterLevelUp!.txtControl, 'HUD reflects human control after level-up').toContain('HUMAN');
      |                                                                                   ^ Error: HUD reflects human control after level-up
  599 |     record('levelup-after', { owner: afterLevelUp!.owner, aiEnabled: afterLevelUp!.aiEnabled, paused: afterLevelUp!.paused });
  600 | 
  601 |     // Death ends the run: AI is dropped and control returns to the human.
  602 |     await page.evaluate(() => {
  603 |       const g: any = (window as any).__game;
  604 |       // Production builds minify class names: always resolve scenes by key.
  605 |     const gs: any = g.scene.getScene('GameScene');
  606 |       gs.world.player.invuln = 0;
  607 |       gs.world.player.hurt(999999, gs.world.player.wx + 1, gs.world.player.wy);
  608 |       // Commit the queued hit deterministically (B4: legacy hurt is applied by
  609 |       // the core on the next tick, not synchronously by the adapter).
  610 |       const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  611 |       for (let i = 0; i < 10; i++) gs.world.stepFrame(1000 / 60, neutral);
  612 |     });
  613 |     await page.waitForTimeout(400);
  614 |     const dead = await state(page);
  615 |     expect(dead!.active, 'GameOverScene after death').toContain('GameOverScene');
  616 |     expect(dead!.active, 'GameOverScene after death').toContain('GameOverScene');
  617 |     expect(dead!.owner, 'ownership back to human after death').toBe('human');
  618 |     expect(dead!.aiEnabled, 'AI disabled after death').toBe(false);
  619 |     expect(dead!.authorityPaused, 'authority paused after death').toBe(true);
  620 |     const saveAfterDeath = await page.evaluate(() => {
  621 |       const raw = localStorage.getItem('last_signal_save_v1');
  622 |       const parsed = raw ? JSON.parse(raw) : {};
  623 |       return { hasRun: !!parsed.run, cores: parsed.permanent?.cores ?? null };
  624 |     });
  625 |     expect(saveAfterDeath.hasRun, 'death clears the run checkpoint').toBe(false);
  626 |     record('death', { active: dead!.active, owner: dead!.owner, aiEnabled: dead!.aiEnabled, save: saveAfterDeath });
  627 |     await page.screenshot({ path: path.join(OUT, 'death-ownership-1280x720.png') });
  628 | 
  629 |     // Restart: a brand-new run boots human-controlled, with no residual state.
  630 |     await clickLogical(page, 640, 500); // RETRY SAME SEED
  631 |     await page.waitForTimeout(1600);
  632 |     const restarted = await state(page);
  633 |     // R-03 evidence: a captured checkpoint frame is a deep copy, not live state.
  634 |     const captured = await page.evaluate(() => {
  635 |       const g: any = (window as any).__game;
  636 |       // Production builds minify class names: always resolve scenes by key.
  637 |     const gs: any = g.scene.getScene('GameScene');
  638 |       const cp = gs.world.captureCheckpoint('frame-test', gs.seed, gs.runStats());
  639 |       if (!cp) return { available: false };
  640 |       (window as any).__capturedFrame = cp;
  641 |       (window as any).__capturedJson = JSON.stringify(cp);
  642 |       // Mutate the live run the same way play would (currency / hp) through core
  643 |       // transactions, so this remains valid on a production preview.
  644 |       gs.world.enqueueCurrency(7);
  645 |       gs.world.enqueueHeal(-5);
  646 |       gs.world.resetSimulationAccumulator();
  647 |       gs.world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  648 |       return { available: true };
  649 |     });
  650 |     expect(captured.available, 'start-room checkpoint frame captured in memory').toBe(true);
  651 |     const afterMutation = await page.evaluate(() => {
  652 |       const g: any = (window as any).__game;
  653 |       // Production builds minify class names: always resolve scenes by key.
  654 |     const gs: any = g.scene.getScene('GameScene');
  655 |       const cp = (window as any).__capturedFrame;
  656 |       return {
  657 |         unchanged: JSON.stringify(cp) === (window as any).__capturedJson,
  658 |         capturedCurrency: cp.player.currency,
  659 |         liveCurrency: gs.world.player.data.currency,
  660 |         capturedHp: cp.player.hp,
  661 |         liveHp: gs.world.player.data.hp
  662 |       };
  663 |     });
  664 |     expect(afterMutation.unchanged, 'captured frame does not mutate with the live run').toBe(true);
  665 |     expect(afterMutation.liveCurrency, 'live run changed').toBe(afterMutation.capturedCurrency + 7);
  666 |     record('checkpoint-copy', afterMutation);
  667 |     expect(restarted!.active, 'new GameScene after restart').toContain('GameScene');
  668 |     expect(restarted!.paused, 'new run resumed').toBe(false);
  669 |     expect(restarted!.owner, 'new run starts human-controlled').toBe('human');
  670 |     expect(restarted!.aiEnabled, 'no AI state carried into new run').toBe(false);
  671 |     expect(restarted!.aiActionCount).toBe(0);
  672 |     expect(restarted!.takeoverCount).toBe(0);
  673 |     record('restart', { owner: restarted!.owner, aiEnabled: restarted!.aiEnabled, aiActionCount: restarted!.aiActionCount });
  674 | 
  675 |     // Scene exit: QUIT TO MENU must shut the World down without errors.
  676 |     await page.keyboard.press('Escape');
  677 |     await page.waitForTimeout(500);
  678 |     await clickLogical(page, 640, 480); // QUIT TO MENU
  679 |     await page.waitForTimeout(1000);
  680 |     const menuActive = await page.evaluate(() =>
  681 |       (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key));
  682 |     expect(menuActive, 'MainMenuScene active after quit').toContain('MainMenuScene');
  683 |     expect(menuActive, 'GameScene stopped after quit').not.toContain('GameScene');
  684 |     record('scene-exit', { active: menuActive });
  685 |     expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
  686 |     saveLog('control-flow-1280x720');
  687 |   });
  688 | 
  689 |   for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720], [1024, 768], [800, 600]] as Array<[number, number]>) {
  690 |     test(`HUD fully visible, non-overlapping and scaled geometry at ${w}x${h}`, async ({ page }) => {
  691 |       test.setTimeout(60000);
  692 |       const errors: string[] = [];
  693 |       page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  694 |       page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  695 |       await page.setViewportSize({ width: w, height: h });
  696 |       mkdirSync(OUT, { recursive: true });
  697 | 
  698 |       await bootRun(page);
```