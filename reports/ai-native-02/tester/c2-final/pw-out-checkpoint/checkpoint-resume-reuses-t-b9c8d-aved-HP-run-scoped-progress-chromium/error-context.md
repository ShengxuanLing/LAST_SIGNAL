# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: checkpoint.spec.ts >> resume reuses the checkpoint id and restores saved HP / run-scoped progress
- Location: tests\checkpoint.spec.ts:171:1

# Error details

```
Error: level-up card available

expect(received).not.toBeNull()

Received: null
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
> 51  |   expect(card, 'level-up card available').not.toBeNull();
      |                                               ^ Error: level-up card available
  52  |   await page.mouse.click(Math.round(card!.x), Math.round(card!.y));
  53  | }
  54  | 
  55  | test('inventory equips an owned weapon and the safe checkpoint restores the selection', async ({ page }) => {
  56  |   await page.goto('/');
  57  |   await waitForScene(page, 'MainMenuScene');
  58  |   await fixSeed(page, 424242);
  59  |   await page.evaluate((key) => {
  60  |     localStorage.setItem(key, JSON.stringify({ permanent: { unlockedWeapons: ['pulse', 'scatter', 'plasma'] } }));
  61  |   }, SAVE_KEY);
  62  |   await clickButton(page, 'NEW RUN');
  63  |   await waitForScene(page, 'GameScene');
  64  | 
  65  |   const inventory = () => page.evaluate(() => {
  66  |     const game = (window as any).__game;
  67  |     const scene = game.scene.getScene('PauseScene');
  68  |     const player = game.scene.getScene('GameScene').world.player;
  69  |     const buttons = scene.children.list
  70  |       .filter((child: any) => child.type === 'Text' && ['EQUIP', 'EQUIPPED'].includes(child.text))
  71  |       .map((child: any) => ({ label: child.text, y: child.y, enabled: child.input?.enabled ?? false }));
  72  |     return { weapon: player.data.weaponKey, buttons };
  73  |   });
  74  | 
  75  |   await page.keyboard.press('i');
  76  |   await expect.poll(async () => (await inventory()).buttons).toEqual([
  77  |     { label: 'EQUIPPED', y: 186, enabled: false },
  78  |     { label: 'EQUIP', y: 230, enabled: true },
  79  |     { label: 'EQUIP', y: 274, enabled: true }
  80  |   ]);
  81  |   await page.mouse.click(420, 242); // Equip Scatter Gun using its on-screen button.
  82  |   await expect.poll(inventory).toEqual({
  83  |     weapon: 'scatter',
  84  |     buttons: [
  85  |       { label: 'EQUIP', y: 186, enabled: true },
  86  |       { label: 'EQUIPPED', y: 230, enabled: false },
  87  |       { label: 'EQUIP', y: 274, enabled: true }
  88  |     ]
  89  |   });
  90  |   await page.keyboard.press('e');
  91  |   expect((await inventory()).weapon).toBe('scatter');
  92  |   await page.keyboard.press('3');
  93  |   await expect.poll(async () => (await inventory()).weapon).toBe('plasma');
  94  |   await expect.poll(() => sceneLabels(page, 'PauseScene')).toContain(WEAPONS.plasma.description);
  95  |   await page.keyboard.press('2');
  96  |   await expect.poll(async () => (await inventory()).weapon).toBe('scatter');
  97  | 
  98  |   await page.keyboard.press('i');
  99  |   await page.waitForFunction(() => !(window as any).__game.scene.isActive('PauseScene'));
  100 |   await expect.poll(() => sceneLabels(page, 'GameScene')).toContain('Scatter Gun [◆] · 8/8');
  101 |   await page.evaluate(() => {
  102 |     const game = (window as any).__game.scene.getScene('GameScene');
  103 |     const scatter = game.world.player.data.weapons.find((weapon: { key: string }) => weapon.key === 'scatter');
  104 |     Object.assign(scatter, { ammo: 0, reloading: true, reloadTimer: 2 });
  105 |   });
  106 |   await expect.poll(() => sceneLabels(page, 'GameScene')).toContain('Scatter Gun [◆] · RELOADING');
  107 |   await page.keyboard.press('Escape');
  108 |   await page.waitForFunction(() => (window as any).__game.scene.isActive('PauseScene'));
  109 |   await clickButton(page, 'QUIT TO MENU');
  110 |   await waitForScene(page, 'MainMenuScene');
  111 |   expect((await readSave(page)).run.player.weaponKey).toBe('scatter');
  112 | 
  113 |   await clickButton(page, 'LOAD RUN');
  114 |   await expect.poll(async () => (await sceneLabels(page, 'MainMenuScene'))
  115 |     .find((label: string) => label.startsWith('EQUIPPED'))).toMatch(/^EQUIPPED Scatter Gun · TIME \d+:\d{2}$/);
  116 |   await clickButton(page, 'RESUME CHECKPOINT');
  117 |   await waitForScene(page, 'GameScene');
  118 |   await page.keyboard.press('i');
  119 |   await expect.poll(async () => (await inventory()).buttons[1]?.label).toBe('EQUIPPED');
  120 |   expect((await inventory()).weapon).toBe('scatter');
  121 | });
  122 | 
  123 | function sceneLabels(page: Page, name: string): Promise<string[]> {
  124 |   return page.evaluate((key) => (window as any).__game.scene.getScene(key).children.list
  125 |     .filter((child: any) => child.type === 'Text').map((child: any) => child.text), name);
  126 | }
  127 | 
  128 | test('number keys select an upgrade when four choices are eligible', async ({ page }) => {
  129 |   await page.goto('/');
  130 |   await waitForScene(page, 'MainMenuScene');
  131 |   await fixSeed(page, 424242);
  132 |   await clickButton(page, 'NEW RUN');
  133 |   await waitForScene(page, 'GameScene');
  134 |   await page.evaluate((maxed) => {
  135 |     const player = (window as any).__game.scene.getScene('GameScene').world.player;
  136 |     player.data.upgrades = maxed;
  137 |     player.addXp(player.data.xpToNext);
  138 |   }, UPGRADE_LIST.slice(4).map(({ key, maxLevel }) => ({ key, level: maxLevel })));
  139 |   await waitForScene(page, 'LevelUpScene');
  140 |   expect(await sceneLabels(page, 'LevelUpScene')).toEqual(expect.arrayContaining(['[1]', '[2]', '[3]']));
  141 |   const key = await page.evaluate(() => (window as any).__game.scene.getScene('LevelUpScene').choices[2]);
  142 |   await page.keyboard.press('3');
  143 |   await expect.poll(async () => (await readSave(page)).run?.player.upgrades).toContainEqual({ key, level: 1 });
  144 | });
  145 | 
  146 | test('loss recap shows run stats and retries the same seed', async ({ page }) => {
  147 |   await page.goto('/');
  148 |   await waitForScene(page, 'MainMenuScene');
  149 |   await fixSeed(page, 424242);
  150 |   await clickButton(page, 'NEW RUN');
  151 |   await waitForScene(page, 'GameScene');
```