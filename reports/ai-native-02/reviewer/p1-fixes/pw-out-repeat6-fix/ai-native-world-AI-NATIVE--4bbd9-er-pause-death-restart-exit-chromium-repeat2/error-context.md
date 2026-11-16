# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai-native-world.spec.ts >> AI-NATIVE-02 P1 real World >> shared control path, AI run, disable/takeover, level-up takeover, pause/death/restart/exit
- Location: tests\ai-native-world.spec.ts:232:3

# Error details

```
Error: AI produced multiple intents with non-zero movement

expect(received).toBeGreaterThan(expected)

Expected: > 2
Received:   2
```

# Test source

```ts
  236 |     page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  237 |     mkdirSync(OUT, { recursive: true });
  238 | 
  239 |     await bootRun(page);
  240 |     await stabilizeEvidenceRun(page);
  241 |     record('evidence-fixture', {
  242 |       reason: 'avoid unrelated combat death while sampling control transitions; death still tested via real hurt() after clearing i-frames',
  243 |       onlyIFramesRefreshed: true, hpUnchanged: true, coordinatesUnchanged: true,
  244 |       actor: 'test-harness (not the controller)'
  245 |     });
  246 |     let st = await state(page);
  247 |     expect(st, 'GameScene world exists').not.toBeNull();
  248 |     expect(st!.active, 'GameScene active').toContain('GameScene');
  249 |     // Honest default: human control, no external agent.
  250 |     expect(st!.owner).toBe('human');
  251 |     expect(st!.aiEnabled).toBe(false);
  252 |     expect(st!.mode).toBe('HUMAN');
  253 |     expect(st!.txtControl).toContain('HUMAN');
  254 |     expect(st!.txtAgentLink).toContain('EXTERNAL NOT CONNECTED');
  255 |     expect(st!.txtAgentLink).toContain('LOCAL DETERMINISTIC');
  256 |     expect(st!.externalAgentConnected).toBe(false);
  257 |     expect(st!.lastIntentOwner).toBe('human');
  258 |     record('human-default', { mode: st!.mode, txtControl: st!.txtControl, txtAgentLink: st!.txtAgentLink });
  259 |     await page.screenshot({ path: path.join(OUT, 'hud-human-1280x720.png') });
  260 | 
  261 |     // Pause menu exposes the dev entry and labels the demo honestly.
  262 |     await page.keyboard.press('Escape');
  263 |     await page.waitForTimeout(500);
  264 |     const pauseLabels = await sceneTexts(page, 'PauseScene');
  265 |     expect(pauseLabels.some((t) => t.includes('AI CONTROL: OFF')), 'AI toggle shown as OFF when disabled').toBe(true);
  266 |     expect(pauseLabels.some((t) => t.includes('EXTERNAL AGENT  NOT CONNECTED')), 'pause states no external agent').toBe(true);
  267 |     await page.screenshot({ path: path.join(OUT, 'pause-ai-entry-1280x720.png') });
  268 |     record('pause-entry', { labels: pauseLabels });
  269 | 
  270 |     await clickLogical(page, 640, 540);
  271 |     await page.waitForTimeout(550);
  272 |     st = await state(page);
  273 |     expect(st!.aiEnabled, 'AI enabled while paused').toBe(true);
  274 |     expect(st!.owner, 'owner flips to AI').toBe('ai');
  275 |     expect(st!.authorityPaused, 'authority frozen while paused').toBe(true);
  276 |     record('ai-enabled-paused', { owner: st!.owner, paused: st!.paused, aiEnabled: st!.aiEnabled });
  277 | 
  278 |     await page.keyboard.press('Escape');
  279 |     await page.waitForTimeout(700);
  280 |     st = await state(page);
  281 |     expect(st!.paused, 'game resumed').toBe(false);
  282 |     expect(st!.owner, 'AI owns the live run').toBe('ai');
  283 |     expect(st!.mode).toBe('AI');
  284 |     expect(st!.txtControl).toContain('LOCAL DETERMINISTIC');
  285 | 
  286 |     // Sample the running AI: real movement, legal actions, collision stays valid.
  287 |     const samples: Array<Record<string, unknown>> = [];
  288 |     let pathLength = 0;
  289 |     let previous: { x: number; y: number; room: string | null } | null = null;
  290 |     let maxStep = 0;
  291 |     let movingSamples = 0;
  292 |     let portalTransitions = 0;
  293 |     const portalJumps: Array<Record<string, unknown>> = [];
  294 |     let levelUpChoices = 0;
  295 |     const seenRooms = new Set<string>();
  296 |     for (let i = 0; i < 14; i++) {
  297 |       const active = await page.evaluate(() =>
  298 |         (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key));
  299 |       if (active.includes('LevelUpScene')) {
  300 |         levelUpChoices++;
  301 |         await page.keyboard.press('1');
  302 |         await page.waitForTimeout(400);
  303 |       }
  304 |       await page.waitForTimeout(300);
  305 |       const s = await state(page);
  306 |       if (s!.owner !== 'ai') break;
  307 |       if (previous) {
  308 |         const step = Math.hypot(s!.grid.x - previous.x, s!.grid.y - previous.y);
  309 |         if (previous.room !== s!.room) {
  310 |           // World.tryInteract() legally lands the player in the next room. This
  311 |           // is a room transition through the shared interact rule, not a
  312 |           // collision-skipping movement step; record it separately.
  313 |           portalTransitions++;
  314 |           portalJumps.push({ from: previous, to: s!.grid, distance: step, room: s!.room });
  315 |         } else {
  316 |           pathLength += step;
  317 |           maxStep = Math.max(maxStep, step);
  318 |         }
  319 |       }
  320 |       previous = { x: s!.grid.x, y: s!.grid.y, room: s!.room };
  321 |       if (s!.intent.move.x !== 0 || s!.intent.move.y !== 0) movingSamples++;
  322 |       if (s!.room) seenRooms.add(s!.room);
  323 |       samples.push({
  324 |         i, grid: s!.grid, action: s!.lastAiAction, target: s!.lastAiTarget,
  325 |         room: s!.room, enemies: s!.enemies, projectiles: s!.projectiles,
  326 |         intentOwner: s!.lastIntentOwner, intent: s!.intent, walkable: s!.walkable,
  327 |         hp: s!.hp, damage: s!.damage, active: s!.active
  328 |       });
  329 |       if (i % 3 === 0) await page.screenshot({ path: path.join(OUT, `ai-run-${String(i).padStart(2, '0')}.png`) });
  330 |     }
  331 |     record('ai-samples', { samples, pathLength, maxStep, movingSamples, portalTransitions, portalJumps, rooms: [...seenRooms], levelUpChoices });
  332 |     st = await state(page);
  333 | 
  334 |     // Observable movement: multiple moving samples, real path, collision-legal.
  335 |     const actions = new Set(samples.map((s) => String(s.action)).filter((a) => a !== 'null'));
> 336 |     expect(movingSamples, 'AI produced multiple intents with non-zero movement').toBeGreaterThan(2);
      |                                                                                  ^ Error: AI produced multiple intents with non-zero movement
  337 |     expect(pathLength, 'AI actually walked through the World').toBeGreaterThan(1.5);
  338 |     expect(maxStep, 'no collision-skipping jump between same-room samples').toBeLessThan(3.2);
  339 |     if (portalTransitions > 0) {
  340 |       // Portal transitions are legal World.tryInteract room changes, so they
  341 |       // are logged separately and excluded from collision-legality steps.
  342 |       expect(portalJumps.every((j) => Number(j.distance) > 3.2),
  343 |         'room transitions are recorded as distinct interact jumps').toBe(true);
  344 |     }
  345 |     walkableOnly(samples);
  346 |     expect(actions.size, 'AI reported real action changes').toBeGreaterThan(1);
  347 |     expect(st!.aiActionCount, 'AI executed a countable sequence of actions').toBeGreaterThan(1);
  348 |     expect(st!.lastAiAction, 'HUD has a last AI action').toBeTruthy();
  349 |     expect(st!.txtAiAction, 'HUD shows the AI action').toContain(String(st!.lastAiAction));
  350 |     expect(st!.txtAiTarget, 'HUD shows the AI target').toContain(String(st!.lastAiTarget));
  351 |     expect(st!.lastIntentOwner, 'last executed intent came from AI').toBe('ai');
  352 |     record('ai-summary', {
  353 |       aiActionCount: st!.aiActionCount, lastAiAction: st!.lastAiAction, lastAiTarget: st!.lastAiTarget,
  354 |       movedTo: st!.grid, room: st!.room, enemies: st!.enemies, pathLength, maxStep, movingSamples,
  355 |       portalTransitions, seenRooms: [...seenRooms]
  356 |     });
  357 |     await page.screenshot({ path: path.join(OUT, 'ai-active-hud-1280x720.png') });
  358 | 
  359 |     // R-04 evidence: an actor in another room is NOT visible to the controller,
  360 |     // while legal public state (own HP, current-room actors) is preserved.
  361 |     const whitelist = await page.evaluate(() => {
  362 |       const g: any = (window as any).__game;
  363 |       // Production builds minify class names: always resolve scenes by key.
  364 |     const gs: any = g.scene.getScene('GameScene');
  365 |       const w = gs.world;
  366 |       const current = w.currentRoom()?.id ?? 0;
  367 |       const other = w.map.rooms.find((r: any) => r.id !== current);
  368 |       const enemy = w.spawnEnemy('drone', other.gx + 2, other.gy + 2, other.id, 1);
  369 |       const obs = w.observationView();
  370 |       const view = w.intentView();
  371 |       return {
  372 |         worldEnemies: w.enemies.length,
  373 |         hiddenEnemyId: enemy._id,
  374 |         hiddenEnemyRoom: other.id,
  375 |         currentRoom: current,
  376 |         perceivedIds: obs.perceivedActors.map((a: any) => a.id),
  377 |         intentEnemyIds: view.enemies.map((a: any) => a.id),
  378 |         hasTargetRoom: JSON.stringify(obs).includes('targetRoom'),
  379 |         playerHp: obs.player.hp,
  380 |         roomKind: w.currentRoom()?.kind ?? null
  381 |       };
  382 |     });
  383 |     expect(whitelist.worldEnemies, 'hidden enemy exists in the World').toBeGreaterThan(1);
  384 |     expect(whitelist.perceivedIds, 'other-room enemy is not in the perception projection').not.toContain(whitelist.hiddenEnemyId);
  385 |     expect(whitelist.intentEnemyIds, 'controller view also excludes it').not.toContain(whitelist.hiddenEnemyId);
  386 |     expect(whitelist.hasTargetRoom, 'portal destination never leaves the projection').toBe(false);
  387 |     expect(whitelist.playerHp, 'own public HP is kept in the projection').toBeGreaterThan(0);
  388 |     record('observation-whitelist', whitelist);
  389 | 
  390 |     // Pause while AI is running: ownership is frozen and the menu shows ON.
  391 |     const beforePause = await state(page);
  392 |     await page.keyboard.press('Escape');
  393 |     await page.waitForTimeout(450);
  394 |     const paused = await state(page);
  395 |     expect(paused!.paused, 'game paused').toBe(true);
  396 |     expect(paused!.authorityPaused, 'authority paused').toBe(true);
  397 |     expect(paused!.mode, 'HUD mode frozen as PAUSED').toBe('PAUSED');
  398 |     const runningLabels = await sceneTexts(page, 'PauseScene');
  399 |     expect(runningLabels.some((t) => t.includes('AI CONTROL: ON · LOCAL DEMO')),
  400 |       'pause menu shows AI control ON while AI is running (not OFF)').toBe(true);
  401 |     expect(runningLabels.some((t) => t.includes('CONTROL  AI · LOCAL DETERMINISTIC DEMO')),
  402 |       'pause menu labels local deterministic demo').toBe(true);
  403 |     const pausedActionCount = paused!.aiActionCount;
  404 |     await page.waitForTimeout(900);
  405 |     const frozen = await state(page);
  406 |     expect(frozen!.grid.x, 'AI cannot step while paused').toBeCloseTo(paused!.grid.x, 6);
  407 |     expect(frozen!.grid.y, 'AI cannot step while paused').toBeCloseTo(paused!.grid.y, 6);
  408 |     expect(frozen!.aiActionCount, 'no AI actions while paused').toBe(pausedActionCount);
  409 |     record('pause-freeze', { paused: paused!.mode, frozen: frozen!.grid, aiActionCount: pausedActionCount });
  410 | 
  411 |     // Manual disable from the pause menu: back to human, no self-reclaim.
  412 |     const takeoverBeforeDisable = paused!.takeoverCount;
  413 |     await clickLogical(page, 640, 540); // AI CONTROL: ON -> OFF
  414 |     await page.waitForTimeout(550);
  415 |     const disabled = await state(page);
  416 |     expect(disabled!.aiEnabled, 'AI disabled from pause menu').toBe(false);
  417 |     expect(disabled!.owner, 'owner back to human after disable').toBe('human');
  418 |     expect(disabled!.lastTakeoverReason, 'disable reason recorded').toBe('pause-menu');
  419 |     expect(disabled!.takeoverCount, 'disable counted as takeover').toBe(takeoverBeforeDisable + 1);
  420 |     const offLabels = await sceneTexts(page, 'PauseScene');
  421 |     expect(offLabels.some((t) => t.includes('AI CONTROL: OFF')), 'pause menu shows OFF after disable').toBe(true);
  422 |     await page.screenshot({ path: path.join(OUT, 'pause-ai-off-1280x720.png') });
  423 |     await page.keyboard.press('Escape');
  424 |     await page.waitForTimeout(500);
  425 |     const stationaryStart = await state(page);
  426 |     await page.waitForTimeout(2500);
  427 |     const stationary = await state(page);
  428 |     expect(stationary!.owner, 'human still owns control after disable').toBe('human');
  429 |     expect(stationary!.aiEnabled, 'AI stays disabled (no self-reclaim)').toBe(false);
  430 |     expect(stationary!.lastAiAction, 'AI action state cleared after disable').toBeNull();
  431 |     expect(stationary!.txtControl, 'HUD returns to HUMAN').toContain('HUMAN');
  432 |     if (stationaryStart!.hp === stationary!.hp) {
  433 |       // No enemy knockback involved: the disabled AI must not move the player.
  434 |       expect(stationary!.grid.x, 'disabled AI does not move the player').toBeCloseTo(stationaryStart!.grid.x, 6);
  435 |       expect(stationary!.grid.y, 'disabled AI does not move the player').toBeCloseTo(stationaryStart!.grid.y, 6);
  436 |     }
```