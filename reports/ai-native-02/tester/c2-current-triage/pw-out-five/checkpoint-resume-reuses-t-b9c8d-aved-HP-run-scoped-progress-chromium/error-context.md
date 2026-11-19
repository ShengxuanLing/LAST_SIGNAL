# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: checkpoint.spec.ts >> resume reuses the checkpoint id and restores saved HP / run-scoped progress
- Location: tests\checkpoint.spec.ts:185:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 1
Received: 0

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  127 |     .find((label: string) => label.startsWith('EQUIPPED'))).toMatch(/^EQUIPPED Scatter Gun · TIME \d+:\d{2}$/);
  128 |   await clickButton(page, 'RESUME CHECKPOINT');
  129 |   await waitForScene(page, 'GameScene');
  130 |   await page.keyboard.press('i');
  131 |   await expect.poll(async () => (await inventory()).buttons[1]?.label).toBe('EQUIPPED');
  132 |   expect((await inventory()).weapon).toBe('scatter');
  133 | });
  134 | 
  135 | function sceneLabels(page: Page, name: string): Promise<string[]> {
  136 |   return page.evaluate((key) => (window as any).__game.scene.getScene(key).children.list
  137 |     .filter((child: any) => child.type === 'Text').map((child: any) => child.text), name);
  138 | }
  139 | 
  140 | test('number keys select an upgrade when four choices are eligible', async ({ page }) => {
  141 |   await page.goto('/');
  142 |   await waitForScene(page, 'MainMenuScene');
  143 |   await fixSeed(page, 424242);
  144 |   await clickButton(page, 'NEW RUN');
  145 |   await waitForScene(page, 'GameScene');
  146 |   await page.evaluate(() => {
  147 |     const player = (window as any).__game.scene.getScene('GameScene').world.player;
  148 |     player.world.playerDataFixture.upgrades = [];
  149 |     player.addXp(player.data.xpToNext);
  150 |     player.world.resetSimulationAccumulator();
  151 |     player.world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit addXp
  152 |   });
  153 |   await waitForScene(page, 'LevelUpScene');
  154 |   expect(await sceneLabels(page, 'LevelUpScene')).toEqual(expect.arrayContaining(['[1]', '[2]', '[3]']));
  155 |   const key = await page.evaluate(() => (window as any).__game.scene.getScene('LevelUpScene').choices[2]);
  156 |   await page.keyboard.press('3');
  157 |   await expect.poll(async () => (await readSave(page)).run?.player.upgrades).toContainEqual({ key, level: 1 });
  158 | });
  159 | 
  160 | test('loss recap shows run stats and retries the same seed', async ({ page }) => {
  161 |   await page.goto('/');
  162 |   await waitForScene(page, 'MainMenuScene');
  163 |   await fixSeed(page, 424242);
  164 |   await clickButton(page, 'NEW RUN');
  165 |   await waitForScene(page, 'GameScene');
  166 |   const runId = (await readSave(page)).run.id;
  167 |   await page.evaluate(() => {
  168 |     const game = (window as any).__game.scene.getScene('GameScene');
  169 |     game.enemiesKilled = 3;
  170 |     game.itemsCollected = 5;
  171 |     game.damageDealt = 79.6;
  172 |     game.runStart = game.time.now - 65000;
  173 |     game.world.onPlayerDeath();
  174 |   });
  175 |   await waitForScene(page, 'GameOverScene');
  176 |   expect(await sceneLabels(page, 'GameOverScene')).toEqual(expect.arrayContaining([
  177 |     'KILLS 3 · DAMAGE DEALT 80', 'ITEMS COLLECTED 5 · TIME 1:05'
  178 |   ]));
  179 |   await clickButton(page, 'RETRY SAME SEED');
  180 |   await waitForScene(page, 'GameScene');
  181 |   expect((await readSave(page)).run).toMatchObject({ seed: 424242 });
  182 |   expect((await readSave(page)).run.id).not.toBe(runId);
  183 | });
  184 | 
  185 | test('resume reuses the checkpoint id and restores saved HP / run-scoped progress', async ({ page }) => {
  186 |   const errors: string[] = [];
  187 |   page.on('pageerror', (error) => errors.push(error.message));
  188 |   await page.goto('/');
  189 |   await waitForScene(page, 'MainMenuScene');
  190 |   await fixSeed(page, 424242);
  191 | 
  192 |   await clickButton(page, 'NEW RUN');
  193 |   await waitForScene(page, 'GameScene');
  194 |   await expect.poll(async () => (await readSave(page)).run?.clearedRooms.length).toBe(1);
  195 | 
  196 |   // Spawn + clear enemies, then gain a level and pick a run-scoped upgrade.
  197 |   await page.evaluate(() => {
  198 |     const game = (window as any).__game.scene.getScene('GameScene');
  199 |     const { world } = game;
  200 |     world.player.reset(world.portal.wx, world.portal.wy);
  201 |     world.resetSimulationAccumulator();
  202 |     world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit teleport, player now at portal
  203 |     world.tryInteract(world.player); // triggers room transition
  204 |     world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit room-enter, queue spawn
  205 |     world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit enemy spawn
  206 |   });
  207 |   await page.waitForFunction(() =>
  208 |     (window as any).__game.scene.getScene('GameScene').world.enemies.length > 0);
  209 |   await page.evaluate(() => {
  210 |     const game = (window as any).__game.scene.getScene('GameScene');
  211 |     const { world } = game;
  212 |     for (const enemy of world.enemies) enemy.sprite.destroy();
  213 |     world.enemies = [];
  214 |     world.spawnLoot(world.player.x, world.player.y, 'currency', 'currency', 42);
  215 |     world.player.addXp(30);
  216 |     world.resetSimulationAccumulator();
  217 |     world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit addXp command
  218 |   });
  219 |   await waitForScene(page, 'LevelUpScene');
  220 |   await pickFirstCard(page);
  221 |   await page.evaluate(() => {
  222 |     const g = (window as any).__game;
  223 |     const w = g.scene.getScene('GameScene').world;
  224 |     w.resetSimulationAccumulator();
  225 |     w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // let checkpoint save
  226 |   });
> 227 |   await expect.poll(async () => (await readSave(page)).run?.player.upgrades.length).toBe(1);
      |                                                                                     ^ Error: expect(received).toBe(expected) // Object.is equality
  228 |   await expect.poll(async () => (await readSave(page)).run?.player.currency).toBeGreaterThanOrEqual(42);
  229 | 
  230 |   const before = await readSave(page);
  231 |   expect(before.run.clearedRooms).toHaveLength(2);
  232 |   expect(before.permanent).toMatchObject({ cores: 0, maxHpBonus: 0, armorBonus: 0, damageBonus: 0 });
  233 | 
  234 |   // ---- Resume via the menu (state-driven buttons, not coordinates) ----
  235 |   await page.reload();
  236 |   await waitForScene(page, 'MainMenuScene');
  237 | 
  238 |   // CONTINUE must be present and enabled (a checkpoint exists) — state assertion.
  239 |   const menu = await page.evaluate(() => {
  240 |     const m = (window as any).__game.scene.getScene('MainMenuScene');
  241 |     const labels = m.children.list.filter((c: any) => c.type === 'Text').map((c: any) => c.text);
  242 |     const dim = m.children.list.filter((c: any) => c.type === 'Rectangle' && c.fillAlpha === 0.16).length;
  243 |     return { hasContinue: labels.includes('CONTINUE'), dim };
  244 |   });
  245 |   expect(menu.hasContinue, 'CONTINUE button present when a checkpoint exists').toBe(true);
  246 |   expect(menu.dim, 'CONTINUE not dimmed when a checkpoint exists').toBe(0);
  247 | 
  248 |   await clickButton(page, 'CONTINUE');
  249 |   await waitForScene(page, 'GameScene');
  250 | 
  251 |   // Contract: resume reuses the checkpoint id (stable across reload).
  252 |   await expect.poll(async () => (await readSave(page)).run?.id).toBe(before.run.id);
  253 | 
  254 |   const resumed = await page.evaluate(() => {
  255 |     const { world } = (window as any).__game.scene.getScene('GameScene');
  256 |     return { player: world.player.data, room: world.currentRoom().id, enemies: world.enemies.length };
  257 |   });
  258 |   // HP is restored from the checkpoint verbatim (World.restoreCheckpoint keeps HP).
  259 |   expect(resumed.player.hp).toBe(before.run.player.hp);
  260 |   expect(resumed.player.maxHp).toBe(before.run.player.maxHp);
  261 |   expect(resumed.player).toMatchObject({
  262 |     upgrades: before.run.player.upgrades, currency: before.run.player.currency, level: before.run.player.level
  263 |   });
  264 |   expect(resumed.room).toBe(before.run.roomId);
  265 |   expect(resumed.enemies).toBe(0);
  266 | 
  267 |   // Victory still awards a single core and clears the run.
  268 |   await page.evaluate(() => {
  269 |     const { world } = (window as any).__game.scene.getScene('GameScene');
  270 |     world.spawnBoss(world.map.rooms.find((room: any) => room.kind === 'boss'));
  271 |     world.killBoss();
  272 |   });
  273 |   await waitForScene(page, 'GameOverScene');
  274 |   const victory = await readSave(page);
  275 |   expect(victory.run).toBeUndefined();
  276 |   expect(victory.permanent).toMatchObject({ cores: 1, bossesDefeated: 1, maxHpBonus: 0 });
  277 | 
  278 |   // Permanent talents remain separate from the (now cleared) run.
  279 |   await clickButton(page, 'MAIN MENU');
  280 |   await waitForScene(page, 'MainMenuScene');
  281 |   await clickButton(page, 'PERMANENT TALENTS');
  282 |   await page.waitForFunction(() =>
  283 |     (window as any).__game.scene.getScene('MainMenuScene').children.list
  284 |       .some((child: any) => child.text === 'PERMANENT CORES: 1'));
  285 |   await clickButton(page, 'VITALITY 0 · +20% BASE HP · 1 CORE');
  286 |   await expect.poll(async () => (await readSave(page)).permanent).toMatchObject({ cores: 0, maxHpBonus: 1 });
  287 |   await clickButton(page, 'BACK');
  288 |   await page.waitForFunction(() =>
  289 |     (window as any).__game.scene.getScene('MainMenuScene').children.list
  290 |       .some((child: any) => child.text === 'NEW RUN'));
  291 | 
  292 |   // NEW RUN on top of an already-cleared run starts a brand-new run (new id).
  293 |   await clickButton(page, 'NEW RUN');
  294 |   await waitForScene(page, 'GameScene');
  295 |   await expect.poll(async () => (await readSave(page)).run?.player).toMatchObject({
  296 |     hp: 120, maxHp: 120, currency: 0, upgrades: [], level: 1
  297 |   });
  298 |   const fresh = await readSave(page);
  299 |   expect(fresh.run.id, 'NEW RUN generates a fresh id (not the resumed one)').not.toBe(before.run.id);
  300 | 
  301 |   expect(errors).toEqual([]);
  302 | });
  303 | 
  304 | test('death routes to Game Over and clears the run checkpoint', async ({ page }) => {
  305 |   const errors: string[] = [];
  306 |   page.on('pageerror', (error) => errors.push(error.message));
  307 |   await page.goto('/');
  308 |   await waitForScene(page, 'MainMenuScene');
  309 |   await fixSeed(page, 424242);
  310 | 
  311 |   await clickButton(page, 'NEW RUN');
  312 |   await waitForScene(page, 'GameScene');
  313 |   // A checkpoint must exist before death so we can prove it gets cleared.
  314 |   await expect.poll(async () => (await readSave(page)).run).toBeDefined();
  315 | 
  316 |   // Drive the real death path: World.onPlayerDeath -> GameScene.onDeath ->
  317 |   // finishRun(id, false) + scene.start('GameOverScene').
  318 |   await page.evaluate(() => {
  319 |     const { world } = (window as any).__game.scene.getScene('GameScene');
  320 |     world.onPlayerDeath();
  321 |   });
  322 |   await waitForScene(page, 'GameOverScene');
  323 | 
  324 |   await expect.poll(async () => (await readSave(page)).run, 'run checkpoint cleared on death').toBeUndefined();
  325 |   const afterDeath = await readSave(page);
  326 |   expect(afterDeath.permanent, 'permanent progression untouched by death')
  327 |     .toMatchObject({ cores: 0, maxHpBonus: 0 });
```