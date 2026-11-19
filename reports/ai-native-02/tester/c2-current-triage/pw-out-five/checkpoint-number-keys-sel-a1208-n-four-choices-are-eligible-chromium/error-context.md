# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: checkpoint.spec.ts >> number keys select an upgrade when four choices are eligible
- Location: tests\checkpoint.spec.ts:140:1

# Error details

```
Error: expect(received).toContainEqual(expected) // deep equality

Expected value: {"key": "vitality", "level": 1}
Received array: []

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  57  |     w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit upgrade
  58  |   });
  59  | }
  60  | 
  61  | test('inventory equips an owned weapon and the safe checkpoint restores the selection', async ({ page }) => {
  62  |   await page.goto('/');
  63  |   await waitForScene(page, 'MainMenuScene');
  64  |   await fixSeed(page, 424242);
  65  |   await page.evaluate((key) => {
  66  |     localStorage.setItem(key, JSON.stringify({ permanent: { unlockedWeapons: ['pulse', 'scatter', 'plasma'] } }));
  67  |   }, SAVE_KEY);
  68  |   await clickButton(page, 'NEW RUN');
  69  |   await waitForScene(page, 'GameScene');
  70  | 
  71  |   const inventory = () => page.evaluate(() => {
  72  |     const game = (window as any).__game;
  73  |     const scene = game.scene.getScene('PauseScene');
  74  |     const player = game.scene.getScene('GameScene').world.player;
  75  |     const buttons = scene.children.list
  76  |       .filter((child: any) => child.type === 'Text' && ['EQUIP', 'EQUIPPED'].includes(child.text))
  77  |       .map((child: any) => ({ label: child.text, y: child.y, enabled: child.input?.enabled ?? false }));
  78  |     return { weapon: player.data.weaponKey, buttons };
  79  |   });
  80  | 
  81  |   await page.keyboard.press('i');
  82  |   await expect.poll(async () => (await inventory()).buttons).toEqual([
  83  |     { label: 'EQUIPPED', y: 186, enabled: false },
  84  |     { label: 'EQUIP', y: 230, enabled: true },
  85  |     { label: 'EQUIP', y: 274, enabled: true }
  86  |   ]);
  87  |   await page.mouse.click(420, 242); // Equip Scatter Gun using its on-screen button.
  88  |   await page.evaluate(() => {
  89  |     const g = (window as any).__game;
  90  |     const w = g.scene.getScene('GameScene').world;
  91  |     w.resetSimulationAccumulator();
  92  |     w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit equip-weapon
  93  |   });
  94  |   await expect.poll(inventory).toEqual({
  95  |     weapon: 'scatter',
  96  |     buttons: [
  97  |       { label: 'EQUIP', y: 186, enabled: true },
  98  |       { label: 'EQUIPPED', y: 230, enabled: false },
  99  |       { label: 'EQUIP', y: 274, enabled: true }
  100 |     ]
  101 |   });
  102 |   await page.keyboard.press('e');
  103 |   expect((await inventory()).weapon).toBe('scatter');
  104 |   await page.keyboard.press('3');
  105 |   await expect.poll(async () => (await inventory()).weapon).toBe('plasma');
  106 |   await expect.poll(() => sceneLabels(page, 'PauseScene')).toContain(WEAPONS.plasma.description);
  107 |   await page.keyboard.press('2');
  108 |   await expect.poll(async () => (await inventory()).weapon).toBe('scatter');
  109 | 
  110 |   await page.keyboard.press('i');
  111 |   await page.waitForFunction(() => !(window as any).__game.scene.isActive('PauseScene'));
  112 |   await expect.poll(() => sceneLabels(page, 'GameScene')).toContain('Scatter Gun [◆] · 8/8');
  113 |   await page.evaluate(() => {
  114 |     const game = (window as any).__game.scene.getScene('GameScene');
  115 |     const scatter = game.world.playerDataFixture.weapons.find((weapon: { key: string }) => weapon.key === 'scatter');
  116 |     Object.assign(scatter, { ammo: 0, reloading: true, reloadTimer: 2 });
  117 |   });
  118 |   await expect.poll(() => sceneLabels(page, 'GameScene')).toContain('Scatter Gun [◆] · RELOADING');
  119 |   await page.keyboard.press('Escape');
  120 |   await page.waitForFunction(() => (window as any).__game.scene.isActive('PauseScene'));
  121 |   await clickButton(page, 'QUIT TO MENU');
  122 |   await waitForScene(page, 'MainMenuScene');
  123 |   expect((await readSave(page)).run.player.weaponKey).toBe('scatter');
  124 | 
  125 |   await clickButton(page, 'LOAD RUN');
  126 |   await expect.poll(async () => (await sceneLabels(page, 'MainMenuScene'))
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
> 157 |   await expect.poll(async () => (await readSave(page)).run?.player.upgrades).toContainEqual({ key, level: 1 });
      |                                                                              ^ Error: expect(received).toContainEqual(expected) // deep equality
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
  227 |   await expect.poll(async () => (await readSave(page)).run?.player.upgrades.length).toBe(1);
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
```