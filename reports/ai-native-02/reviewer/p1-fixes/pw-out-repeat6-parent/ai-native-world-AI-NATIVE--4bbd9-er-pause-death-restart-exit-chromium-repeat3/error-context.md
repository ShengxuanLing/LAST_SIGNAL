# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai-native-world.spec.ts >> AI-NATIVE-02 P1 real World >> shared control path, AI run, disable/takeover, level-up takeover, pause/death/restart/exit
- Location: tests\ai-native-world.spec.ts:218:3

# Error details

```
Error: no collision-skipping jump between same-room samples

expect(received).toBeLessThan(expected)

Expected: < 3.2
Received:   3.385358178696221
```

# Test source

```ts
  224 | 
  225 |     await bootRun(page);
  226 |     await stabilizeEvidenceRun(page);
  227 |     record('evidence-fixture', {
  228 |       reason: 'avoid unrelated combat death while sampling control transitions; death still tested via real hurt() after clearing i-frames',
  229 |       onlyIFramesRefreshed: true, hpUnchanged: true, coordinatesUnchanged: true,
  230 |       actor: 'test-harness (not the controller)'
  231 |     });
  232 |     let st = await state(page);
  233 |     expect(st, 'GameScene world exists').not.toBeNull();
  234 |     expect(st!.active, 'GameScene active').toContain('GameScene');
  235 |     // Honest default: human control, no external agent.
  236 |     expect(st!.owner).toBe('human');
  237 |     expect(st!.aiEnabled).toBe(false);
  238 |     expect(st!.mode).toBe('HUMAN');
  239 |     expect(st!.txtControl).toContain('HUMAN');
  240 |     expect(st!.txtAgentLink).toContain('EXTERNAL NOT CONNECTED');
  241 |     expect(st!.txtAgentLink).toContain('LOCAL DETERMINISTIC');
  242 |     expect(st!.externalAgentConnected).toBe(false);
  243 |     expect(st!.lastIntentOwner).toBe('human');
  244 |     record('human-default', { mode: st!.mode, txtControl: st!.txtControl, txtAgentLink: st!.txtAgentLink });
  245 |     await page.screenshot({ path: path.join(OUT, 'hud-human-1280x720.png') });
  246 | 
  247 |     // Pause menu exposes the dev entry and labels the demo honestly.
  248 |     await page.keyboard.press('Escape');
  249 |     await page.waitForTimeout(500);
  250 |     const pauseLabels = await sceneTexts(page, 'PauseScene');
  251 |     expect(pauseLabels.some((t) => t.includes('AI CONTROL: OFF')), 'AI toggle shown as OFF when disabled').toBe(true);
  252 |     expect(pauseLabels.some((t) => t.includes('EXTERNAL AGENT  NOT CONNECTED')), 'pause states no external agent').toBe(true);
  253 |     await page.screenshot({ path: path.join(OUT, 'pause-ai-entry-1280x720.png') });
  254 |     record('pause-entry', { labels: pauseLabels });
  255 | 
  256 |     await clickLogical(page, 640, 540);
  257 |     await page.waitForTimeout(550);
  258 |     st = await state(page);
  259 |     expect(st!.aiEnabled, 'AI enabled while paused').toBe(true);
  260 |     expect(st!.owner, 'owner flips to AI').toBe('ai');
  261 |     expect(st!.authorityPaused, 'authority frozen while paused').toBe(true);
  262 |     record('ai-enabled-paused', { owner: st!.owner, paused: st!.paused, aiEnabled: st!.aiEnabled });
  263 | 
  264 |     await page.keyboard.press('Escape');
  265 |     await page.waitForTimeout(700);
  266 |     st = await state(page);
  267 |     expect(st!.paused, 'game resumed').toBe(false);
  268 |     expect(st!.owner, 'AI owns the live run').toBe('ai');
  269 |     expect(st!.mode).toBe('AI');
  270 |     expect(st!.txtControl).toContain('LOCAL DETERMINISTIC');
  271 | 
  272 |     // Sample the running AI: real movement, legal actions, collision stays valid.
  273 |     const samples: Array<Record<string, unknown>> = [];
  274 |     let pathLength = 0;
  275 |     let previous: { x: number; y: number; room: string | null } | null = null;
  276 |     let maxStep = 0;
  277 |     let movingSamples = 0;
  278 |     let portalTransitions = 0;
  279 |     const portalJumps: Array<Record<string, unknown>> = [];
  280 |     let levelUpChoices = 0;
  281 |     const seenRooms = new Set<string>();
  282 |     for (let i = 0; i < 14; i++) {
  283 |       const active = await page.evaluate(() =>
  284 |         (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key));
  285 |       if (active.includes('LevelUpScene')) {
  286 |         levelUpChoices++;
  287 |         await page.keyboard.press('1');
  288 |         await page.waitForTimeout(400);
  289 |       }
  290 |       await page.waitForTimeout(300);
  291 |       const s = await state(page);
  292 |       if (s!.owner !== 'ai') break;
  293 |       if (previous) {
  294 |         const step = Math.hypot(s!.grid.x - previous.x, s!.grid.y - previous.y);
  295 |         if (previous.room !== s!.room) {
  296 |           // World.tryInteract() legally lands the player in the next room. This
  297 |           // is a room transition through the shared interact rule, not a
  298 |           // collision-skipping movement step; record it separately.
  299 |           portalTransitions++;
  300 |           portalJumps.push({ from: previous, to: s!.grid, distance: step, room: s!.room });
  301 |         } else {
  302 |           pathLength += step;
  303 |           maxStep = Math.max(maxStep, step);
  304 |         }
  305 |       }
  306 |       previous = { x: s!.grid.x, y: s!.grid.y, room: s!.room };
  307 |       if (s!.intent.move.x !== 0 || s!.intent.move.y !== 0) movingSamples++;
  308 |       if (s!.room) seenRooms.add(s!.room);
  309 |       samples.push({
  310 |         i, grid: s!.grid, action: s!.lastAiAction, target: s!.lastAiTarget,
  311 |         room: s!.room, enemies: s!.enemies, projectiles: s!.projectiles,
  312 |         intentOwner: s!.lastIntentOwner, intent: s!.intent, walkable: s!.walkable,
  313 |         hp: s!.hp, damage: s!.damage, active: s!.active
  314 |       });
  315 |       if (i % 3 === 0) await page.screenshot({ path: path.join(OUT, `ai-run-${String(i).padStart(2, '0')}.png`) });
  316 |     }
  317 |     record('ai-samples', { samples, pathLength, maxStep, movingSamples, portalTransitions, portalJumps, rooms: [...seenRooms], levelUpChoices });
  318 |     st = await state(page);
  319 | 
  320 |     // Observable movement: multiple moving samples, real path, collision-legal.
  321 |     const actions = new Set(samples.map((s) => String(s.action)).filter((a) => a !== 'null'));
  322 |     expect(movingSamples, 'AI produced multiple intents with non-zero movement').toBeGreaterThan(2);
  323 |     expect(pathLength, 'AI actually walked through the World').toBeGreaterThan(1.5);
> 324 |     expect(maxStep, 'no collision-skipping jump between same-room samples').toBeLessThan(3.2);
      |                                                                             ^ Error: no collision-skipping jump between same-room samples
  325 |     if (portalTransitions > 0) {
  326 |       // Portal transitions are legal World.tryInteract room changes, so they
  327 |       // are logged separately and excluded from collision-legality steps.
  328 |       expect(portalJumps.every((j) => Number(j.distance) > 3.2),
  329 |         'room transitions are recorded as distinct interact jumps').toBe(true);
  330 |     }
  331 |     walkableOnly(samples);
  332 |     expect(actions.size, 'AI reported real action changes').toBeGreaterThan(1);
  333 |     expect(st!.aiActionCount, 'AI executed a countable sequence of actions').toBeGreaterThan(1);
  334 |     expect(st!.lastAiAction, 'HUD has a last AI action').toBeTruthy();
  335 |     expect(st!.txtAiAction, 'HUD shows the AI action').toContain(String(st!.lastAiAction));
  336 |     expect(st!.txtAiTarget, 'HUD shows the AI target').toContain(String(st!.lastAiTarget));
  337 |     expect(st!.lastIntentOwner, 'last executed intent came from AI').toBe('ai');
  338 |     record('ai-summary', {
  339 |       aiActionCount: st!.aiActionCount, lastAiAction: st!.lastAiAction, lastAiTarget: st!.lastAiTarget,
  340 |       movedTo: st!.grid, room: st!.room, enemies: st!.enemies, pathLength, maxStep, movingSamples,
  341 |       portalTransitions, seenRooms: [...seenRooms]
  342 |     });
  343 |     await page.screenshot({ path: path.join(OUT, 'ai-active-hud-1280x720.png') });
  344 | 
  345 |     // R-04 evidence: an actor in another room is NOT visible to the controller,
  346 |     // while legal public state (own HP, current-room actors) is preserved.
  347 |     const whitelist = await page.evaluate(() => {
  348 |       const g: any = (window as any).__game;
  349 |       // Production builds minify class names: always resolve scenes by key.
  350 |     const gs: any = g.scene.getScene('GameScene');
  351 |       const w = gs.world;
  352 |       const current = w.currentRoom()?.id ?? 0;
  353 |       const other = w.map.rooms.find((r: any) => r.id !== current);
  354 |       const enemy = w.spawnEnemy('drone', other.gx + 2, other.gy + 2, other.id, 1);
  355 |       const obs = w.observationView();
  356 |       const view = w.intentView();
  357 |       return {
  358 |         worldEnemies: w.enemies.length,
  359 |         hiddenEnemyId: enemy._id,
  360 |         hiddenEnemyRoom: other.id,
  361 |         currentRoom: current,
  362 |         visibleIds: obs.visibleActors.map((a: any) => a.id),
  363 |         intentEnemyIds: view.enemies.map((a: any) => a.id),
  364 |         hasTargetRoom: JSON.stringify(obs).includes('targetRoom'),
  365 |         playerHp: obs.player.hp,
  366 |         roomKind: w.currentRoom()?.kind ?? null
  367 |       };
  368 |     });
  369 |     expect(whitelist.worldEnemies, 'hidden enemy exists in the World').toBeGreaterThan(1);
  370 |     expect(whitelist.visibleIds, 'other-room enemy is not in the whitelist').not.toContain(whitelist.hiddenEnemyId);
  371 |     expect(whitelist.intentEnemyIds, 'controller view also excludes it').not.toContain(whitelist.hiddenEnemyId);
  372 |     expect(whitelist.hasTargetRoom, 'portal destination never leaves the projection').toBe(false);
  373 |     expect(whitelist.playerHp, 'own public HP is kept in the projection').toBeGreaterThan(0);
  374 |     record('observation-whitelist', whitelist);
  375 | 
  376 |     // Pause while AI is running: ownership is frozen and the menu shows ON.
  377 |     const beforePause = await state(page);
  378 |     await page.keyboard.press('Escape');
  379 |     await page.waitForTimeout(450);
  380 |     const paused = await state(page);
  381 |     expect(paused!.paused, 'game paused').toBe(true);
  382 |     expect(paused!.authorityPaused, 'authority paused').toBe(true);
  383 |     expect(paused!.mode, 'HUD mode frozen as PAUSED').toBe('PAUSED');
  384 |     const runningLabels = await sceneTexts(page, 'PauseScene');
  385 |     expect(runningLabels.some((t) => t.includes('AI CONTROL: ON · LOCAL DEMO')),
  386 |       'pause menu shows AI control ON while AI is running (not OFF)').toBe(true);
  387 |     expect(runningLabels.some((t) => t.includes('CONTROL  AI · LOCAL DETERMINISTIC DEMO')),
  388 |       'pause menu labels local deterministic demo').toBe(true);
  389 |     const pausedActionCount = paused!.aiActionCount;
  390 |     await page.waitForTimeout(900);
  391 |     const frozen = await state(page);
  392 |     expect(frozen!.grid.x, 'AI cannot step while paused').toBeCloseTo(paused!.grid.x, 6);
  393 |     expect(frozen!.grid.y, 'AI cannot step while paused').toBeCloseTo(paused!.grid.y, 6);
  394 |     expect(frozen!.aiActionCount, 'no AI actions while paused').toBe(pausedActionCount);
  395 |     record('pause-freeze', { paused: paused!.mode, frozen: frozen!.grid, aiActionCount: pausedActionCount });
  396 | 
  397 |     // Manual disable from the pause menu: back to human, no self-reclaim.
  398 |     const takeoverBeforeDisable = paused!.takeoverCount;
  399 |     await clickLogical(page, 640, 540); // AI CONTROL: ON -> OFF
  400 |     await page.waitForTimeout(550);
  401 |     const disabled = await state(page);
  402 |     expect(disabled!.aiEnabled, 'AI disabled from pause menu').toBe(false);
  403 |     expect(disabled!.owner, 'owner back to human after disable').toBe('human');
  404 |     expect(disabled!.lastTakeoverReason, 'disable reason recorded').toBe('pause-menu');
  405 |     expect(disabled!.takeoverCount, 'disable counted as takeover').toBe(takeoverBeforeDisable + 1);
  406 |     const offLabels = await sceneTexts(page, 'PauseScene');
  407 |     expect(offLabels.some((t) => t.includes('AI CONTROL: OFF')), 'pause menu shows OFF after disable').toBe(true);
  408 |     await page.screenshot({ path: path.join(OUT, 'pause-ai-off-1280x720.png') });
  409 |     await page.keyboard.press('Escape');
  410 |     await page.waitForTimeout(500);
  411 |     const stationaryStart = await state(page);
  412 |     await page.waitForTimeout(2500);
  413 |     const stationary = await state(page);
  414 |     expect(stationary!.owner, 'human still owns control after disable').toBe('human');
  415 |     expect(stationary!.aiEnabled, 'AI stays disabled (no self-reclaim)').toBe(false);
  416 |     expect(stationary!.lastAiAction, 'AI action state cleared after disable').toBeNull();
  417 |     expect(stationary!.txtControl, 'HUD returns to HUMAN').toContain('HUMAN');
  418 |     if (stationaryStart!.hp === stationary!.hp) {
  419 |       // No enemy knockback involved: the disabled AI must not move the player.
  420 |       expect(stationary!.grid.x, 'disabled AI does not move the player').toBeCloseTo(stationaryStart!.grid.x, 6);
  421 |       expect(stationary!.grid.y, 'disabled AI does not move the player').toBeCloseTo(stationaryStart!.grid.y, 6);
  422 |     }
  423 |     record('manual-disable', { owner: stationary!.owner, takeoverCount: stationary!.takeoverCount, reason: disabled!.lastTakeoverReason });
  424 | 
```