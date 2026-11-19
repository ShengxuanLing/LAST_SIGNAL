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

Locator: getByRole('dialog', { name: 'Supply terminal' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('dialog', { name: 'Supply terminal' }) with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'Supply terminal' })

```

```yaml
- main "LAST SIGNAL"
- status: Supply terminal · clear remaining threats
```

# Test source

```ts
  1  | import { expect, test, type Page } from '@playwright/test';
  2  | 
  3  | async function waitForScene(page: Page, name: string) {
  4  |   await page.waitForFunction((key) => (window as any).__game?.scene.isActive(key), name);
  5  | }
  6  | 
  7  | async function checkpoint(page: Page) {
  8  |   return page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') ?? '{}'));
  9  | }
  10 | 
  11 | test('earns and spends run credits, with purchases restored from the checkpoint', async ({ page }) => {
  12 |   const errors: string[] = [];
  13 |   page.on('pageerror', (error) => errors.push(error.message));
  14 |   await page.goto('/economy.html');
  15 |   await waitForScene(page, 'MainMenuScene');
  16 |   await page.evaluate(() => {
  17 |     const menu = (window as any).__game.scene.getScene('MainMenuScene');
  18 |     const start = menu.scene.start.bind(menu.scene);
  19 |     menu.scene.start = (key: string, data: object) => start(key, key === 'GameScene' ? { ...data, seed: 424242 } : data);
  20 |   });
  21 |   await page.mouse.click(640, 340);
  22 |   await waitForScene(page, 'GameScene');
  23 |   await page.evaluate(() => {
  24 |     const { world } = (window as any).__game.scene.getScene('GameScene');
  25 |     world.player.reset(world.portal.wx, world.portal.wy);
  26 |     world.resetSimulationAccumulator();
  27 |     world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit teleport, player now at portal
  28 |     world.tryInteract(world.player); // triggers room transition
  29 |     world.resetSimulationAccumulator();
  30 |     world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit room-enter
  31 |     world.resetSimulationAccumulator();
  32 |     world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit spawn, let SupplyTerminal update
  33 |   });
  34 |   await expect(page.getByText('Supply terminal · clear remaining threats')).toBeVisible();
  35 |   await page.keyboard.press('g');
  36 |   const terminal = page.getByRole('dialog', { name: 'Supply terminal' });
  37 |   await expect(terminal).toBeHidden();
  38 | 
  39 |   const roomReward = await page.evaluate(() => {
  40 |     const { world } = (window as any).__game.scene.getScene('GameScene');
  41 |     return world.currentRoom().kind === 'elite' ? 24 : 12;
  42 |   });
  43 |   await expect(page.getByText(`+${roomReward} credits · room cleared`)).toBeVisible();
  44 |   await expect.poll(async () => (await checkpoint(page)).run?.player.currency).toBeGreaterThan(0);
  45 |   await page.keyboard.press('g');
> 46 |   await expect(terminal).toBeVisible();
     |                          ^ Error: expect(locator).toBeVisible() failed
  47 | 
  48 |   const repair = terminal.getByRole('button', { name: 'Buy Repair kit for 16 credits' });
  49 |   const calibration = terminal.getByRole('button', { name: 'Buy Weapon calibration for 28 credits' });
  50 |   const weapon = terminal.getByRole('button', { name: /Buy .* for 40 credits/ });
  51 |   await page.evaluate(() => {
  52 |     const original = Storage.prototype.setItem;
  53 |     Storage.prototype.setItem = () => { throw new Error('Storage unavailable for the test'); };
  54 |     window.addEventListener('restore-test-storage', () => { Storage.prototype.setItem = original; }, { once: true });
  55 |   });
  56 |   await repair.click();
  57 |   await expect(terminal.getByText('Purchase could not be saved. Your credits were kept.')).toBeVisible();
  58 |   await expect(terminal.getByText(`${82 + roomReward} run credits`)).toBeVisible();
  59 |   await page.evaluate(() => window.dispatchEvent(new Event('restore-test-storage')));
  60 | 
  61 |   await repair.click();
  62 |   await expect.poll(async () => (await checkpoint(page)).run.player.hp).toBe(60);
  63 |   await weapon.click();
  64 |   await expect(weapon).toBeDisabled();
  65 |   await expect(terminal.getByText(/Already owned/)).toBeVisible();
  66 |   await calibration.click();
  67 |   const after = await checkpoint(page);
  68 |   expect(after.run.player.currency).toBe(82 + roomReward - 16 - 40 - 28);
  69 |   expect(after.run.player.weapons).toHaveLength(2);
  70 |   expect(after.run.player.weapons.find((entry: any) => entry.key === after.run.player.weaponKey)?.level).toBe(2);
  71 |   expect(after.permanent).toMatchObject({ cores: 0, unlockedWeapons: ['pulse'] });
  72 |   await expect(calibration).toBeDisabled();
  73 |   await expect(terminal.getByText(/Not enough credits/).first()).toBeVisible();
  74 |   await page.keyboard.press('Escape');
  75 |   await expect(terminal).toBeHidden();
  76 |   await waitForScene(page, 'GameScene');
  77 | 
  78 |   await page.reload();
  79 |   await waitForScene(page, 'MainMenuScene');
  80 |   await page.mouse.click(640, 460);
  81 |   await waitForScene(page, 'GameScene');
  82 |   await page.getByRole('button', { name: /Supply terminal/ }).click();
  83 |   await expect(terminal.getByText(`${after.run.player.currency} run credits`)).toBeVisible();
  84 |   await expect(weapon).toBeDisabled();
  85 |   await expect.poll(async () => (await checkpoint(page)).run.player).toMatchObject({
  86 |     currency: after.run.player.currency,
  87 |     hp: 60,
  88 |     weapons: after.run.player.weapons
  89 |   });
  90 |   expect(errors).toEqual([]);
  91 | });
  92 | 
```