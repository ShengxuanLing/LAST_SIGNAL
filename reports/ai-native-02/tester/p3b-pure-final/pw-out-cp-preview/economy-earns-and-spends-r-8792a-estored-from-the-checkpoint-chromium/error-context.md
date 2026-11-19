# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: economy.spec.ts >> earns and spends run credits, with purchases restored from the checkpoint
- Location: tests\economy.spec.ts:11:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Supply terminal · clear remaining threats')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('Supply terminal · clear remaining threats') with timeout 5000ms
  - waiting for getByText('Supply terminal · clear remaining threats')

```

# Test source

```ts
  1   | import { expect, test, type Page } from '@playwright/test';
  2   | 
  3   | async function waitForScene(page: Page, name: string) {
  4   |   await page.waitForFunction((key) => (window as any).__game?.scene.isActive(key), name);
  5   | }
  6   | 
  7   | async function checkpoint(page: Page) {
  8   |   return page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') ?? '{}'));
  9   | }
  10  | 
  11  | test('earns and spends run credits, with purchases restored from the checkpoint', async ({ page }) => {
  12  |   const errors: string[] = [];
  13  |   page.on('pageerror', (error) => errors.push(error.message));
  14  |   await page.goto('/economy.html');
  15  |   await waitForScene(page, 'MainMenuScene');
  16  |   await page.evaluate(() => {
  17  |     const menu = (window as any).__game.scene.getScene('MainMenuScene');
  18  |     const start = menu.scene.start.bind(menu.scene);
  19  |     menu.scene.start = (key: string, data: object) => start(key, key === 'GameScene' ? { ...data, seed: 424242 } : data);
  20  |   });
  21  |   await page.mouse.click(640, 340);
  22  |   await waitForScene(page, 'GameScene');
  23  |   await page.evaluate(() => {
  24  |     const { world } = (window as any).__game.scene.getScene('GameScene');
  25  |     world.player.reset(world.portal.wx, world.portal.wy);
  26  |     world.resetSimulationAccumulator();
  27  |     world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit teleport, player now at portal
  28  |     world.tryInteract(world.player); // triggers room transition
  29  |     world.resetSimulationAccumulator();
  30  |     world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit room-enter
  31  |     world.resetSimulationAccumulator();
  32  |     world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit spawn, let SupplyTerminal update
  33  |   });
> 34  |   await expect(page.getByText('Supply terminal · clear remaining threats')).toBeVisible();
      |                                                                             ^ Error: expect(locator).toBeVisible() failed
  35  |   await page.keyboard.press('g');
  36  |   const terminal = page.getByRole('dialog', { name: 'Supply terminal' });
  37  |   await expect(terminal).toBeHidden();
  38  | 
  39  |   const roomReward = await page.evaluate(() => {
  40  |     const { world } = (window as any).__game.scene.getScene('GameScene');
  41  |     // Known baseline, then grant 82 credits through a real loot drop.
  42  |     world.clearLootForTest();
  43  |     world.playerDataFixture.currency = 0;
  44  |     world.playerDataFixture.hp = 25;
  45  |     world.enqueueSpawnLoot(world.player.x, world.player.y, 'currency', 'currency', 82);
  46  |     // Actually clear the room in the authoritative core (no premature reward).
  47  |     world.simFixture.drones = [];
  48  |     world.simFixture.targets = [];
  49  |     for (const enemy of world.enemies) if (enemy.sprite?.scene) enemy.sprite.destroy();
  50  |     world.enemies = [];
  51  |     if (world.boss) { if (world.boss.sprite?.scene) world.boss.sprite.destroy(); world.boss = null; }
  52  |     world.resetSimulationAccumulator();
  53  |     world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
  54  |     return world.currentRoom().kind === 'elite' ? 24 : 12;
  55  |   });
  56  |   await expect(page.getByText(`+${roomReward} credits · room cleared`)).toBeVisible();
  57  |   await expect.poll(async () => (await checkpoint(page)).run?.player.currency).toBe(82 + roomReward);
  58  |   await page.keyboard.press('g');
  59  |   await expect(terminal).toBeVisible();
  60  | 
  61  |   const repair = terminal.getByRole('button', { name: 'Buy Repair kit for 16 credits' });
  62  |   const calibration = terminal.getByRole('button', { name: 'Buy Weapon calibration for 28 credits' });
  63  |   const weapon = terminal.getByRole('button', { name: /Buy .* for 40 credits/ });
  64  | 
  65  |   // Purchase is queued in the paused dialog and commits on the resume tick;
  66  |   // success is shown only after the checkpoint save.
  67  |   await repair.click();
  68  |   await expect(terminal.getByText(/Close the terminal to complete your purchase/)).toBeVisible();
  69  |   await page.keyboard.press('Escape');
  70  |   await expect(terminal).toBeHidden();
  71  |   await expect(page.locator('#supply-reward')).toContainText('Purchased Repair kit.');
  72  |   await expect.poll(async () => (await checkpoint(page)).run.player.hp).toBe(60);
  73  |   await expect.poll(async () => (await checkpoint(page)).run.player.currency).toBe(82 + roomReward - 16);
  74  | 
  75  |   await page.getByRole('button', { name: /Supply terminal/ }).click();
  76  |   await expect(terminal).toBeVisible();
  77  |   await weapon.click();
  78  |   await expect(terminal.getByText(/Close the terminal to complete your purchase/)).toBeVisible();
  79  |   await page.keyboard.press('Escape');
  80  |   await expect(terminal).toBeHidden();
  81  |   await expect(page.locator('#supply-reward')).toContainText('Purchased');
  82  |   await page.getByRole('button', { name: /Supply terminal/ }).click();
  83  |   await expect(terminal).toBeVisible();
  84  |   await expect(weapon).toBeDisabled();
  85  |   await expect(terminal.getByText(/Already owned/)).toBeVisible();
  86  | 
  87  |   await calibration.click();
  88  |   await expect(terminal.getByText(/Close the terminal to complete your purchase/)).toBeVisible();
  89  |   await page.keyboard.press('Escape');
  90  |   await expect(terminal).toBeHidden();
  91  |   // Closing resumes the scene; the calibration command commits on the next
  92  |   // normal tick and only then is the checkpoint saved.
  93  |   await expect.poll(async () => (await checkpoint(page)).run?.player.currency).toBe(82 + roomReward - 16 - 40 - 28);
  94  |   const after = await checkpoint(page);
  95  |   expect(after.run.player.currency).toBe(82 + roomReward - 16 - 40 - 28);
  96  |   expect(after.run.player.weapons).toHaveLength(2);
  97  |   expect(after.run.player.weapons.find((entry: any) => entry.key === after.run.player.weaponKey)?.level).toBe(2);
  98  |   expect(after.permanent).toMatchObject({ cores: 0, unlockedWeapons: ['pulse'] });
  99  | 
  100 |   await page.getByRole('button', { name: /Supply terminal/ }).click();
  101 |   await expect(terminal).toBeVisible();
  102 |   await expect(calibration).toBeDisabled();
  103 |   await expect(terminal.getByText(/Not enough credits/).first()).toBeVisible();
  104 |   await page.keyboard.press('Escape');
  105 |   await expect(terminal).toBeHidden();
  106 |   await waitForScene(page, 'GameScene');
  107 | 
  108 |   await page.reload();
  109 |   await waitForScene(page, 'MainMenuScene');
  110 |   await page.mouse.click(640, 460);
  111 |   await waitForScene(page, 'GameScene');
  112 |   await page.getByRole('button', { name: /Supply terminal/ }).click();
  113 |   await expect(terminal.getByText(`${after.run.player.currency} run credits`)).toBeVisible();
  114 |   await expect(weapon).toBeDisabled();
  115 |   await expect.poll(async () => (await checkpoint(page)).run.player).toMatchObject({
  116 |     currency: after.run.player.currency,
  117 |     hp: 60,
  118 |     weapons: after.run.player.weapons
  119 |   });
  120 |   expect(errors).toEqual([]);
  121 | });
  122 | 
  123 | test('a failed checkpoint save keeps the purchase pending and completes once after recovery', async ({ page }) => {
  124 |   const errors: string[] = [];
  125 |   page.on('pageerror', (error) => errors.push(error.message));
  126 |   await page.goto('/economy.html');
  127 |   await waitForScene(page, 'MainMenuScene');
  128 |   await page.evaluate(() => {
  129 |     const menu = (window as any).__game.scene.getScene('MainMenuScene');
  130 |     const start = menu.scene.start.bind(menu.scene);
  131 |     menu.scene.start = (key: string, data: object) => start(key, key === 'GameScene' ? { ...data, seed: 424242 } : data);
  132 |   });
  133 |   await page.mouse.click(640, 340);
  134 |   await waitForScene(page, 'GameScene');
```