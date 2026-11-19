# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai-native-world.spec.ts >> AI-NATIVE-02 P1 real World >> shared control path, AI run, disable/takeover, level-up takeover, pause/death/restart/exit
- Location: tests\ai-native-world.spec.ts:257:3

# Error details

```
Error: HUD returns to HUMAN

expect(received).toContain(expected) // indexOf

Expected substring: "HUMAN"
Received string:    "CONTROL  PAUSED"
```

# Test source

```ts
  415 |     expect(boundedWaitExhausted, 'bounded wait found valid continuous motion + real interaction').toBe(false);
  416 |     expect(aiPathStats!.transitions > 0 || interactSamples > 0,
  417 |       'real portal interaction (World.tryInteract) observed, not simulated').toBe(true);
  418 |     if (portalTransitions > 0) {
  419 |       // Portal transitions are legal World.tryInteract room changes, so they
  420 |       // are logged separately and excluded from collision-legality steps.
  421 |       expect(portalJumps.every((j) => Number(j.distance) > 3.2),
  422 |         'room transitions are recorded as distinct interact jumps').toBe(true);
  423 |       expect(seenRooms.size, 'portal interaction changed rooms').toBeGreaterThan(1);
  424 |     }
  425 |     walkableOnly(samples);
  426 |     expect(actions.size, 'AI reported real action changes').toBeGreaterThan(1);
  427 |     expect(st!.aiActionCount, 'AI executed a countable sequence of actions').toBeGreaterThan(1);
  428 |     expect(st!.lastAiAction, 'HUD has a last AI action').toBeTruthy();
  429 |     expect(st!.txtAiAction, 'HUD shows the AI action').toContain(String(st!.lastAiAction));
  430 |     expect(st!.txtAiTarget, 'HUD shows the AI target').toContain(String(st!.lastAiTarget));
  431 |     expect(st!.lastIntentOwner, 'last executed intent came from AI').toBe('ai');
  432 |     record('ai-summary', {
  433 |       aiActionCount: st!.aiActionCount, lastAiAction: st!.lastAiAction, lastAiTarget: st!.lastAiTarget,
  434 |       movedTo: st!.grid, room: st!.room, enemies: st!.enemies, pathLength, maxStep, movingSamples,
  435 |       interactSamples, portalTransitions, samples: samples.length, aiPathStats,
  436 |       boundedWaitExhausted, seenRooms: [...seenRooms]
  437 |     });
  438 |     await page.screenshot({ path: path.join(OUT, 'ai-active-hud-1280x720.png') });
  439 | 
  440 |     // R-04 evidence: an actor in another room is NOT visible to the controller,
  441 |     // while legal public state (own HP, current-room actors) is preserved.
  442 |     const whitelist = await page.evaluate(() => {
  443 |       const g: any = (window as any).__game;
  444 |       // Production builds minify class names: always resolve scenes by key.
  445 |     const gs: any = g.scene.getScene('GameScene');
  446 |       const w = gs.world;
  447 |       const current = w.currentRoom()?.id ?? 0;
  448 |       const other = w.map.rooms.find((r: any) => r.id !== current);
  449 |       // Guarantee at least one in-world enemy besides the hidden one, so the
  450 |       // "hidden enemy exists in the World" assertion is deterministic.
  451 |       w.spawnEnemy('drone', w.player.wx, w.player.wy, current, 1);
  452 |       const enemy = w.spawnEnemy('drone', other.gx + 2, other.gy + 2, other.id, 1);
  453 |       const obs = w.observationView();
  454 |       const view = w.intentView();
  455 |       return {
  456 |         worldEnemies: w.enemies.length,
  457 |         hiddenEnemyId: enemy._id,
  458 |         hiddenEnemyRoom: other.id,
  459 |         currentRoom: current,
  460 |         perceivedIds: obs.perceivedActors.map((a: any) => a.id),
  461 |         intentEnemyIds: view.enemies.map((a: any) => a.id),
  462 |         hasTargetRoom: JSON.stringify(obs).includes('targetRoom'),
  463 |         playerHp: obs.player.hp,
  464 |         roomKind: w.currentRoom()?.kind ?? null
  465 |       };
  466 |     });
  467 |     expect(whitelist.worldEnemies, 'hidden enemy exists in the World').toBeGreaterThan(1);
  468 |     expect(whitelist.perceivedIds, 'other-room enemy is not in the perception projection').not.toContain(whitelist.hiddenEnemyId);
  469 |     expect(whitelist.intentEnemyIds, 'controller view also excludes it').not.toContain(whitelist.hiddenEnemyId);
  470 |     expect(whitelist.hasTargetRoom, 'portal destination never leaves the projection').toBe(false);
  471 |     expect(whitelist.playerHp, 'own public HP is kept in the projection').toBeGreaterThan(0);
  472 |     record('observation-whitelist', whitelist);
  473 | 
  474 |     // Pause while AI is running: ownership is frozen and the menu shows ON.
  475 |     const beforePause = await state(page);
  476 |     await page.keyboard.press('Escape');
  477 |     await page.waitForTimeout(450);
  478 |     const paused = await state(page);
  479 |     expect(paused!.paused, 'game paused').toBe(true);
  480 |     expect(paused!.authorityPaused, 'authority paused').toBe(true);
  481 |     expect(paused!.mode, 'HUD mode frozen as PAUSED').toBe('PAUSED');
  482 |     const runningLabels = await sceneTexts(page, 'PauseScene');
  483 |     expect(runningLabels.some((t) => t.includes('AI CONTROL: ON · LOCAL DEMO')),
  484 |       'pause menu shows AI control ON while AI is running (not OFF)').toBe(true);
  485 |     expect(runningLabels.some((t) => t.includes('CONTROL  AI · LOCAL DETERMINISTIC DEMO')),
  486 |       'pause menu labels local deterministic demo').toBe(true);
  487 |     const pausedActionCount = paused!.aiActionCount;
  488 |     await page.waitForTimeout(900);
  489 |     const frozen = await state(page);
  490 |     expect(frozen!.grid.x, 'AI cannot step while paused').toBeCloseTo(paused!.grid.x, 6);
  491 |     expect(frozen!.grid.y, 'AI cannot step while paused').toBeCloseTo(paused!.grid.y, 6);
  492 |     expect(frozen!.aiActionCount, 'no AI actions while paused').toBe(pausedActionCount);
  493 |     record('pause-freeze', { paused: paused!.mode, frozen: frozen!.grid, aiActionCount: pausedActionCount });
  494 | 
  495 |     // Manual disable from the pause menu: back to human, no self-reclaim.
  496 |     const takeoverBeforeDisable = paused!.takeoverCount;
  497 |     await clickLogical(page, 640, 540); // AI CONTROL: ON -> OFF
  498 |     await page.waitForTimeout(550);
  499 |     const disabled = await state(page);
  500 |     expect(disabled!.aiEnabled, 'AI disabled from pause menu').toBe(false);
  501 |     expect(disabled!.owner, 'owner back to human after disable').toBe('human');
  502 |     expect(disabled!.lastTakeoverReason, 'disable reason recorded').toBe('pause-menu');
  503 |     expect(disabled!.takeoverCount, 'disable counted as takeover').toBe(takeoverBeforeDisable + 1);
  504 |     const offLabels = await sceneTexts(page, 'PauseScene');
  505 |     expect(offLabels.some((t) => t.includes('AI CONTROL: OFF')), 'pause menu shows OFF after disable').toBe(true);
  506 |     await page.screenshot({ path: path.join(OUT, 'pause-ai-off-1280x720.png') });
  507 |     await page.keyboard.press('Escape');
  508 |     await page.waitForTimeout(500);
  509 |     const stationaryStart = await state(page);
  510 |     await page.waitForTimeout(2500);
  511 |     const stationary = await state(page);
  512 |     expect(stationary!.owner, 'human still owns control after disable').toBe('human');
  513 |     expect(stationary!.aiEnabled, 'AI stays disabled (no self-reclaim)').toBe(false);
  514 |     expect(stationary!.lastAiAction, 'AI action state cleared after disable').toBeNull();
> 515 |     expect(stationary!.txtControl, 'HUD returns to HUMAN').toContain('HUMAN');
      |                                                            ^ Error: HUD returns to HUMAN
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
```