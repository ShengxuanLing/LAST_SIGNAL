# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: checkpoint.spec.ts >> inventory equips an owned weapon and the safe checkpoint restores the selection
- Location: tests\checkpoint.spec.ts:61:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 4
+ Received  + 4

@@ -1,15 +1,15 @@
  Object {
    "buttons": Array [
      Object {
-       "enabled": true,
-       "label": "EQUIP",
+       "enabled": false,
+       "label": "EQUIPPED",
        "y": 186,
      },
      Object {
-       "enabled": false,
-       "label": "EQUIPPED",
+       "enabled": true,
+       "label": "EQUIP",
        "y": 230,
      },
      Object {
        "enabled": true,
        "label": "EQUIP",

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e3] [cursor=pointer]
```

# Test source

```ts
  1   | import { expect, test, type Page } from '@playwright/test';
  2   | import { SAVE_KEY } from '../src/config/game';
  3   | import { WEAPONS } from '../src/config/weapons';
  4   | import { UPGRADE_LIST } from '../src/config/upgrades';
  5   | 
  6   | function readSave(page: Page) {
  7   |   return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), SAVE_KEY);
  8   | }
  9   | 
  10  | async function waitForScene(page: Page, key: string) {
  11  |   await page.waitForFunction((name) => (window as any).__game?.scene.isActive(name), key, { timeout: 10000 });
  12  | }
  13  | 
  14  | // Click a menu / Game-Over button by its on-screen Text label instead of
  15  | // hard-coding pixel coordinates: locate the Phaser Text object in the active
  16  | // scene, take its position, and click there. Keeps the test robust to layout.
  17  | async function clickButton(page: Page, label: string) {
  18  |   const pos = await page.evaluate((label) => {
  19  |     const g = (window as any).__game;
  20  |     for (const s of Object.values(g.scene.scenes) as any[]) {
  21  |       if (!g.scene.isActive(s.sys.settings.key)) continue;
  22  |       const t = s.children.list.find(
  23  |         (c: any) => c.type === 'Text' && (c.text || '').trim().startsWith(label) && c.visible !== false
  24  |       );
  25  |       if (t) return { x: t.x, y: t.y };
  26  |     }
  27  |     return null;
  28  |   }, label);
  29  |   if (!pos) throw new Error(`button not found: "${label}"`);
  30  |   await page.mouse.click(pos.x, pos.y);
  31  | }
  32  | 
  33  | // Make NEW RUN deterministic (fixed seed) by instrumenting MainMenuScene.start.
  34  | async function fixSeed(page: Page, seed: number) {
  35  |   await page.evaluate((seed) => {
  36  |     const menu = (window as any).__game.scene.getScene('MainMenuScene');
  37  |     const plugin = menu.scene;
  38  |     const start = plugin.start.bind(plugin);
  39  |     plugin.start = (key: string, data: object) =>
  40  |       start(key, key === 'GameScene' ? { ...data, seed } : data);
  41  |   }, seed);
  42  | }
  43  | 
  44  | // Choose the first level-up card by its real button hit-area (no coordinates).
  45  | async function pickFirstCard(page: Page) {
  46  |   const card = await page.evaluate(() => {
  47  |     const g = (window as any).__game;
  48  |     const ls = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'LevelUpScene') as any;
  49  |     return ls && ls.buttons.length ? { x: ls.buttons[0].x, y: ls.buttons[0].y } : null;
  50  |   });
  51  |   expect(card, 'level-up card available').not.toBeNull();
  52  |   await page.mouse.click(Math.round(card!.x), Math.round(card!.y));
  53  |   await page.evaluate(() => {
  54  |     const g = (window as any).__game;
  55  |     const w = g.scene.getScene('GameScene').world;
  56  |     w.resetSimulationAccumulator();
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
> 94  |   await expect.poll(inventory).toEqual({
      |                                ^ Error: expect(received).toEqual(expected) // deep equality
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
```