# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: checkpoint.spec.ts >> resume reuses the checkpoint id and restores saved HP / run-scoped progress
- Location: tests\checkpoint.spec.ts:197:1

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
  53  |   await page.evaluate(() => {
  54  |     const g = (window as any).__game;
  55  |     const w = g.scene.getScene('GameScene').world;
  56  |     w.resetSimulationAccumulator();
  57  |     w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit upgrade
  58  |   });
  59  | }
  60  | 
  61  | // Legal sync point: commands queued while a pause-like overlay is open commit
  62  | // on a normal core tick. The inventory overlay itself never steps the sim.
  63  | async function commitTick(page: Page) {
  64  |   await page.evaluate(() => {
  65  |     const w = (window as any).__game.scene.getScene('GameScene').world;
  66  |     w.resetSimulationAccumulator();
  67  |     w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  68  |   });
  69  | }
  70  | 
  71  | test('inventory equips an owned weapon and the safe checkpoint restores the selection', async ({ page }) => {
  72  |   await page.goto('/');
  73  |   await waitForScene(page, 'MainMenuScene');
  74  |   await fixSeed(page, 424242);
  75  |   await page.evaluate((key) => {
  76  |     localStorage.setItem(key, JSON.stringify({ permanent: { unlockedWeapons: ['pulse', 'scatter', 'plasma'] } }));
  77  |   }, SAVE_KEY);
  78  |   await clickButton(page, 'NEW RUN');
  79  |   await waitForScene(page, 'GameScene');
  80  | 
  81  |   const inventory = () => page.evaluate(() => {
  82  |     const game = (window as any).__game;
  83  |     const scene = game.scene.getScene('PauseScene');
  84  |     const player = game.scene.getScene('GameScene').world.player;
  85  |     const buttons = scene.children.list
  86  |       .filter((child: any) => child.type === 'Text' && ['EQUIP', 'EQUIPPED'].includes(child.text))
  87  |       .map((child: any) => ({ label: child.text, y: child.y, enabled: child.input?.enabled ?? false }));
  88  |     return { weapon: player.data.weaponKey, buttons };
  89  |   });
  90  | 
  91  |   await page.keyboard.press('i');
  92  |   await expect.poll(async () => (await inventory()).buttons).toEqual([
  93  |     { label: 'EQUIPPED', y: 186, enabled: false },
  94  |     { label: 'EQUIP', y: 230, enabled: true },
  95  |     { label: 'EQUIP', y: 274, enabled: true }
  96  |   ]);
  97  |   await page.mouse.click(420, 242); // Equip Scatter Gun using its on-screen button.
  98  |   await page.evaluate(() => {
  99  |     const g = (window as any).__game;
  100 |     const w = g.scene.getScene('GameScene').world;
  101 |     w.resetSimulationAccumulator();
  102 |     w.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit equip-weapon
  103 |   });
  104 |   await expect.poll(inventory).toEqual({
  105 |     weapon: 'scatter',
  106 |     buttons: [
  107 |       { label: 'EQUIP', y: 186, enabled: true },
  108 |       { label: 'EQUIPPED', y: 230, enabled: false },
  109 |       { label: 'EQUIP', y: 274, enabled: true }
  110 |     ]
  111 |   });
  112 |   await page.keyboard.press('e');
  113 |   expect((await inventory()).weapon).toBe('scatter');
  114 |   await page.keyboard.press('3');
  115 |   await commitTick(page); // equip-plasma commits on the normal tick
  116 |   await expect.poll(async () => (await inventory()).weapon).toBe('plasma');
  117 |   await expect.poll(() => sceneLabels(page, 'PauseScene')).toContain(WEAPONS.plasma.description);
  118 |   await page.keyboard.press('2');
  119 |   await commitTick(page); // equip-scatter commits on the normal tick
  120 |   await expect.poll(async () => (await inventory()).weapon).toBe('scatter');
  121 | 
  122 |   await page.keyboard.press('i');
  123 |   await page.waitForFunction(() => !(window as any).__game.scene.isActive('PauseScene'));
  124 |   await expect.poll(() => sceneLabels(page, 'GameScene')).toContain('Scatter Gun [◆] · 8/8');
  125 |   await page.evaluate(() => {
  126 |     const game = (window as any).__game.scene.getScene('GameScene');
  127 |     const scatter = game.world.playerDataFixture.weapons.find((weapon: { key: string }) => weapon.key === 'scatter');
  128 |     Object.assign(scatter, { ammo: 0, reloading: true, reloadTimer: 2 });
  129 |   });
  130 |   await expect.poll(() => sceneLabels(page, 'GameScene')).toContain('Scatter Gun [◆] · RELOADING');
  131 |   await page.keyboard.press('Escape');
  132 |   await page.waitForFunction(() => (window as any).__game.scene.isActive('PauseScene'));
  133 |   await clickButton(page, 'QUIT TO MENU');
  134 |   await waitForScene(page, 'MainMenuScene');
  135 |   expect((await readSave(page)).run.player.weaponKey).toBe('scatter');
  136 | 
  137 |   await clickButton(page, 'LOAD RUN');
  138 |   await expect.poll(async () => (await sceneLabels(page, 'MainMenuScene'))
  139 |     .find((label: string) => label.startsWith('EQUIPPED'))).toMatch(/^EQUIPPED Scatter Gun · TIME \d+:\d{2}$/);
  140 |   await clickButton(page, 'RESUME CHECKPOINT');
  141 |   await waitForScene(page, 'GameScene');
  142 |   await page.keyboard.press('i');
  143 |   await expect.poll(async () => (await inventory()).buttons[1]?.label).toBe('EQUIPPED');
  144 |   expect((await inventory()).weapon).toBe('scatter');
  145 | });
  146 | 
  147 | function sceneLabels(page: Page, name: string): Promise<string[]> {
  148 |   return page.evaluate((key) => (window as any).__game.scene.getScene(key).children.list
  149 |     .filter((child: any) => child.type === 'Text').map((child: any) => child.text), name);
  150 | }
  151 | 
```