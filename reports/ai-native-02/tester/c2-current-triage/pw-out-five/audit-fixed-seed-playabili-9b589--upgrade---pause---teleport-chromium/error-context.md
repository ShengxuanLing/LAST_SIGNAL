# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: audit.spec.ts >> fixed-seed playability regression: menu -> movement -> fire -> kill -> loot -> upgrade -> pause -> teleport
- Location: tests\audit.spec.ts:65:1

# Error details

```
Error: exactly ONE upgrade chosen

expect(received).toBe(expected) // Object.is equality

Expected: 1
Received: 0
```

# Test source

```ts
  248 |   expect(projectileRegress.enemyShot, 'enemy ranged bullet created').not.toBeNull();
  249 |   expect(projectileRegress.enemyShot.speed, 'bullet has velocity toward player').toBeGreaterThan(0);
  250 |   expect((projectileRegress.bossOk as any).error, 'boss attack did not throw').toBeUndefined();
  251 |   expect((projectileRegress.bossOk as any).laserCreated, 'boss fireLaser still creates bullets').toBeGreaterThan(0);
  252 |   expect((projectileRegress.bossOk as any).anyVelocity, 'boss bullets still get velocity').toBe(true);
  253 | 
  254 |   // 6) Loot is visible, then collected (and its sprite is removed).
  255 |   const beforeLoot = st.currency;
  256 |   // Spawn + read visibility in ONE evaluate: pickupRange is expressed in grid
  257 |   // units, so a drop is magnetised almost immediately on the next update tick.
  258 |   const lootVisible = await page.evaluate(() => {
  259 |     const g: any = (window as any).__game;
  260 |     const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
  261 |     const w = gs.world;
  262 |     w.spawnLoot(w.player.wx + 18, w.player.wy, 'currency', 'currency', 10);
  263 |     w.resetSimulationAccumulator();
  264 |     w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  265 |     return { count: w.loot.length, visible: w.loot.map((l: any) => l.spr.visible) };
  266 |   });
  267 |   expect(lootVisible.count, 'loot drop exists').toBeGreaterThan(0);
  268 |   expect(lootVisible.visible.every(Boolean), 'loot sprite visible').toBe(true);
  269 |   await page.waitForTimeout(600);
  270 |   st = await worldState(page);
  271 |   const orphanIcons = await page.evaluate(() => {
  272 |     const g: any = (window as any).__game;
  273 |     const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
  274 |     return gs.children.list.filter((c: any) => c.texture?.key === 'icon_currency').length;
  275 |   });
  276 |   expect(st.currency, 'currency increased from pickup').toBeGreaterThan(beforeLoot);
  277 |   expect(st.items, 'pickup counted').toBeGreaterThan(0);
  278 |   expect(st.loot, 'loot list emptied').toBe(0);
  279 |   expect(orphanIcons, 'collected loot sprite destroyed').toBe(0);
  280 | 
  281 |   // 7) applyUpgrade really mutates state (unit-level guard against the old no-op).
  282 |   const upgradeUnit = await page.evaluate(async () => {
  283 |     const mod: any = await import('/src/config/upgrades.ts');
  284 |     const state: any = { maxHp: 100, hp: 100, speed: 220, damage: 1, critChance: 0.1, critDamage: 1.5,
  285 |       pickupRange: 90, cooldownReduced: 0, pierceCount: 0, hpRegen: 0, armor: 0, xpGain: 1,
  286 |       dashCooldown: 0.9, upgrades: [] };
  287 |     const before = JSON.stringify(state);
  288 |     mod.applyUpgrade(mod.UPGRADES.power, state, 1);
  289 |     return { changed: JSON.stringify(state) !== before, damage: state.damage, count: Object.keys(mod.UPGRADES).length };
  290 |   });
  291 |   expect(upgradeUnit.count, '12 upgrade definitions').toBe(12);
  292 |   expect(upgradeUnit.changed, 'applyUpgrade mutates PlayerData').toBe(true);
  293 |   expect(upgradeUnit.damage, 'power upgrade raises damage').toBeCloseTo(1.1, 5);
  294 | 
  295 |   // 8) Level-up scene opens, 3 cards on screen, one click chooses exactly one,
  296 |   //    current-run stats change, and play resumes.
  297 |   await page.evaluate(() => {
  298 |     const g: any = (window as any).__game;
  299 |     const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
  300 |     const pl = gs.world.player;
  301 |     pl.world.playerDataFixture.xp = 0; pl.world.playerDataFixture.xpToNext = 30; pl.addXp(30);
  302 |   });
  303 |   await page.waitForTimeout(700);
  304 |   const levelUp = await page.evaluate(() => {
  305 |     const g: any = (window as any).__game;
  306 |     const ls = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'LevelUpScene') as any;
  307 |     const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
  308 |     const d = gs.world.player.data;
  309 |     return {
  310 |       active: g.scene.isActive('LevelUpScene'), choices: ls?.choices ?? [],
  311 |       buttons: (ls?.buttons ?? []).map((b: any) => ({ x: b.x, y: b.y, w: b.width, h: b.height })),
  312 |       previews: (ls?.children?.list ?? []).filter((c: any) => c.type === 'Text' && Math.abs(c.y - 450) < 1 && (c.text || '').trim().length > 0).length,
  313 |       paused: gs.paused, camAlpha: gs.cameras.main.alpha,
  314 |       before: { maxHp: d.maxHp, hp: d.hp, speed: d.speed, damage: d.damage, critChance: d.critChance,
  315 |         critDamage: d.critDamage, pickupRange: d.pickupRange, cooldownReduced: d.cooldownReduced,
  316 |         pierceCount: d.pierceCount, hpRegen: d.hpRegen, armor: d.armor, xpGain: d.xpGain,
  317 |         dashCooldown: d.dashCooldown },
  318 |       upgradesBefore: d.upgrades.length
  319 |     };
  320 |   });
  321 |   expect(levelUp.active, 'LevelUpScene opened').toBe(true);
  322 |   expect(levelUp.paused, 'game paused while choosing').toBe(true);
  323 |   expect(levelUp.choices.length, '3 upgrade cards').toBe(3);
  324 |   expect(levelUp.buttons.length, '3 card hit areas').toBe(3);
  325 |   for (const b of levelUp.buttons) {
  326 |     expect(b.x - b.w / 2, 'card fully on screen (left)').toBeGreaterThan(0);
  327 |     expect(b.x + b.w / 2, 'card fully on screen (right)').toBeLessThan(1280);
  328 |   }
  329 |   expect(levelUp.previews, 'numeric upgrade previews rendered').toBeGreaterThan(0);
  330 |   await page.screenshot({ path: path.join(SHOT_DIR, 'levelup.png') });
  331 | 
  332 |   await page.mouse.click(Math.round(levelUp.buttons[0].x), Math.round(levelUp.buttons[0].y));
  333 |   await page.waitForTimeout(700);
  334 |   st = await worldState(page);
  335 |   const after = await page.evaluate(() => {
  336 |     const g: any = (window as any).__game;
  337 |     const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
  338 |     const d = gs.world.player.data;
  339 |     return { maxHp: d.maxHp, hp: d.hp, speed: d.speed, damage: d.damage, critChance: d.critChance,
  340 |       critDamage: d.critDamage, pickupRange: d.pickupRange, cooldownReduced: d.cooldownReduced,
  341 |       pierceCount: d.pierceCount, hpRegen: d.hpRegen, armor: d.armor, xpGain: d.xpGain,
  342 |       dashCooldown: d.dashCooldown, upgrades: d.upgrades.length,
  343 |       levelUpActive: g.scene.isActive('LevelUpScene') };
  344 |   });
  345 |   expect(after.levelUpActive, 'LevelUpScene closed after choosing').toBe(false);
  346 |   expect(st.paused, 'play resumed').toBe(false);
  347 |   expect(st.camAlpha, 'camera alpha restored').toBe(1);
> 348 |   expect(after.upgrades - levelUp.upgradesBefore, 'exactly ONE upgrade chosen').toBe(1);
      |                                                                                 ^ Error: exactly ONE upgrade chosen
  349 |   const changed = Object.keys(levelUp.before).some((k) => (levelUp.before as any)[k] !== (after as any)[k]);
  350 |   expect(changed, 'current-run attributes changed immediately').toBe(true);
  351 | 
  352 |   // 9) ESC opens the pause/inventory overlay and closes it again, no getParentScene error.
  353 |   await page.keyboard.press('Escape');
  354 |   await page.waitForTimeout(500);
  355 |   const pauseOpen = await page.evaluate(() => {
  356 |     const g: any = (window as any).__game;
  357 |     const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
  358 |     return { active: g.scene.isActive('PauseScene'), paused: gs.paused };
  359 |   });
  360 |   expect(pauseOpen.active, 'PauseScene opened by ESC').toBe(true);
  361 |   expect(pauseOpen.paused, 'game paused').toBe(true);
  362 |   await page.screenshot({ path: path.join(SHOT_DIR, 'pause.png') });
  363 |   await page.keyboard.press('Escape');
  364 |   await page.waitForTimeout(600);
  365 |   const pauseClosed = await page.evaluate(() => {
  366 |     const g: any = (window as any).__game;
  367 |     const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
  368 |     return { active: g.scene.isActive('PauseScene'), paused: gs.paused };
  369 |   });
  370 |   expect(pauseClosed.active, 'PauseScene closed').toBe(false);
  371 |   expect(pauseClosed.paused, 'game resumed').toBe(false);
  372 | 
  373 |   // 9b) SETTINGS: two independent volume rows both change and persist.
  374 |   await page.keyboard.press('Escape');
  375 |   await page.waitForTimeout(450);
  376 |   await page.mouse.click(640, 420); // SETTINGS
  377 |   await page.waitForTimeout(350);
  378 |   const settingsBefore = await page.evaluate(() => {
  379 |     const g: any = (window as any).__game;
  380 |     const ps: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'PauseScene');
  381 |     const c: any = ps.children.list.find((x: any) => x.type === 'Container');
  382 |     const txt = c ? c.list.filter((x: any) => x.type === 'Text').map((x: any) => x.text) : [];
  383 |     return { master: txt.find((t: string) => t.startsWith('MASTER')), sfx: txt.find((t: string) => t.startsWith('SFX')), arrows: txt.filter((t: string) => t === '◀' || t === '▶').length };
  384 |   });
  385 |   expect(settingsBefore.arrows, 'two rows of volume arrows (4 total)').toBe(4);
  386 |   expect(settingsBefore.master, 'master volume label shown').toBeTruthy();
  387 |   expect(settingsBefore.sfx, 'sfx volume label shown').toBeTruthy();
  388 |   await page.mouse.click(480, 300); // master -
  389 |   await page.mouse.click(480, 340); // sfx -
  390 |   await page.waitForTimeout(300);
  391 |   const settingsAfter = await page.evaluate(() => {
  392 |     const g: any = (window as any).__game;
  393 |     const ps: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'PauseScene');
  394 |     const c: any = ps.children.list.find((x: any) => x.type === 'Container');
  395 |     const txt = c ? c.list.filter((x: any) => x.type === 'Text').map((x: any) => x.text) : [];
  396 |     const saved = JSON.parse(localStorage.getItem('last_signal_save_v1') || '{}');
  397 |     return {
  398 |       master: txt.find((t: string) => t.startsWith('MASTER')),
  399 |       sfx: txt.find((t: string) => t.startsWith('SFX')),
  400 |       settings: saved.settings || null
  401 |     };
  402 |   });
  403 |   expect(settingsAfter.master, 'master volume changed').not.toBe(settingsBefore.master);
  404 |   expect(settingsAfter.sfx, 'sfx volume changed').not.toBe(settingsBefore.sfx);
  405 |   expect(settingsAfter.settings?.screenShake, 'strict validate() still accepts persisted save').toBe(true);
  406 |   await page.mouse.click(640, 370); // screen shake toggle
  407 |   await page.mouse.click(640, 405); // reset audio
  408 |   const restoredSettings = await page.evaluate(() =>
  409 |     JSON.parse(localStorage.getItem('last_signal_save_v1') || '{}').settings);
  410 |   expect(restoredSettings).toMatchObject({ screenShake: false, masterVolume: 0.7, sfxVolume: 0.8 });
  411 |   await page.keyboard.press('Escape');
  412 |   await page.waitForTimeout(500);
  413 |   const settingsClosed = await page.evaluate(() => ({
  414 |     pauseActive: (window as any).__game.scene.isActive('PauseScene'),
  415 |     paused: (Object.values((window as any).__game.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any).paused
  416 |   }));
  417 |   expect(settingsClosed.pauseActive, 'PauseScene closed by ESC from settings').toBe(false);
  418 |   expect(settingsClosed.paused, 'game resumed after settings').toBe(false);
  419 | 
  420 |   // 10) F teleports to the next room: grid == nearest walkable landing tile and sprite follows.
  421 |   st = await worldState(page);
  422 |   expect(st.hasPortal, 'portal available for teleport').toBe(true);
  423 |   const teleport = await page.evaluate(() => {
  424 |     const g: any = (window as any).__game;
  425 |     const gs = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene') as any;
  426 |     const w = gs.world, t = w.map.rooms[w.portal.targetRoom];
  427 |     const expected = w.findWalkableInRoom(t);
  428 |     w.player.reset(w.portal.wx, w.portal.wy); // walk onto the portal
  429 |     return { expected, beforeRoom: w.currentRoom()?.id, expectedWalkable: w.isWalkable(expected.x, expected.y, 0.5) };
  430 |   });
  431 |   expect(teleport.expectedWalkable, 'target landing tile is walkable').toBe(true);
  432 |   await page.keyboard.press('KeyF');
  433 |   await page.waitForTimeout(500);
  434 |   st = await worldState(page);
  435 |   expect(Math.abs(st.grid.x - teleport.expected.x), 'teleported grid x == target landing tile').toBeLessThan(0.01);
  436 |   expect(Math.abs(st.grid.y - teleport.expected.y), 'teleported grid y == target landing tile').toBeLessThan(0.01);
  437 |   expect(st.spriteErr, 'teleported sprite == worldToScreen(grid)').toBeLessThan(1);
  438 |   expect(st.room?.id, 'entered a different room').not.toBe(teleport.beforeRoom);
  439 |   expect(st.centerErr, 'camera re-centred after teleport').toBeLessThan(120);
  440 | 
  441 |   // 11) The orange wall stripe flood is gone: sample the actual game canvas.
  442 |   const orangeRatio = await page.evaluate(() => {
  443 |     const g: any = (window as any).__game;
  444 |     const ctx = g.canvas.getContext('2d');
  445 |     const d = ctx.getImageData(0, 0, 1280, 720).data;
  446 |     let orange = 0;
  447 |     for (let i = 0; i < d.length; i += 4) {
  448 |       const r = d[i], gg = d[i + 1], b = d[i + 2];
```