import { expect, test, type Page } from '@playwright/test';

async function waitForScene(page: Page, name: string) {
  await page.waitForFunction((key) => (window as any).__game?.scene.isActive(key), name);
}

async function checkpoint(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') ?? '{}'));
}

test('earns and spends run credits, with purchases restored from the checkpoint', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/economy.html');
  await waitForScene(page, 'MainMenuScene');
  await page.evaluate(() => {
    const menu = (window as any).__game.scene.getScene('MainMenuScene');
    const start = menu.scene.start.bind(menu.scene);
    menu.scene.start = (key: string, data: object) => start(key, key === 'GameScene' ? { ...data, seed: 424242 } : data);
  });
  await page.mouse.click(640, 340);
  await waitForScene(page, 'GameScene');
  await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    world.player.reset(world.portal.wx, world.portal.wy);
    world.tryInteract(world.player);
  });
  await expect(page.getByText('Supply terminal · clear remaining threats')).toBeVisible();
  await page.keyboard.press('g');
  const terminal = page.getByRole('dialog', { name: 'Supply terminal' });
  await expect(terminal).toBeHidden();

  const roomReward = await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    for (const entry of world.loot) entry.spr.destroy();
    world.loot = [];
    world.player.data.currency = 0;
    world.player.data.hp = 25;
    world.spawnLoot(world.player.x, world.player.y, 'currency', 'currency', 82);
    for (const enemy of world.enemies) enemy.sprite.destroy();
    world.enemies = [];
    return world.currentRoom().kind === 'elite' ? 24 : 12;
  });
  await expect(page.getByText(`+${roomReward} credits · room cleared`)).toBeVisible();
  await expect.poll(async () => (await checkpoint(page)).run?.player.currency).toBe(82 + roomReward);
  await page.keyboard.press('g');
  await expect(terminal).toBeVisible();

  const repair = terminal.getByRole('button', { name: 'Buy Repair kit for 16 credits' });
  const calibration = terminal.getByRole('button', { name: 'Buy Weapon calibration for 28 credits' });
  const weapon = terminal.getByRole('button', { name: /Buy .* for 40 credits/ });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('Storage unavailable for the test'); };
    window.addEventListener('restore-test-storage', () => { Storage.prototype.setItem = original; }, { once: true });
  });
  await repair.click();
  await expect(terminal.getByText('Purchase could not be saved. Your credits were kept.')).toBeVisible();
  await expect(terminal.getByText(`${82 + roomReward} run credits`)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('restore-test-storage')));

  await repair.click();
  await expect.poll(async () => (await checkpoint(page)).run.player.hp).toBe(60);
  await weapon.click();
  await expect(weapon).toBeDisabled();
  await expect(terminal.getByText(/Already owned/)).toBeVisible();
  await calibration.click();
  const after = await checkpoint(page);
  expect(after.run.player.currency).toBe(82 + roomReward - 16 - 40 - 28);
  expect(after.run.player.weapons).toHaveLength(2);
  expect(after.run.player.weapons.find((entry: any) => entry.key === after.run.player.weaponKey)?.level).toBe(2);
  expect(after.permanent).toMatchObject({ cores: 0, unlockedWeapons: ['pulse'] });
  await expect(calibration).toBeDisabled();
  await expect(terminal.getByText(/Not enough credits/).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(terminal).toBeHidden();
  await waitForScene(page, 'GameScene');

  await page.reload();
  await waitForScene(page, 'MainMenuScene');
  await page.mouse.click(640, 460);
  await waitForScene(page, 'GameScene');
  await page.getByRole('button', { name: /Supply terminal/ }).click();
  await expect(terminal.getByText(`${after.run.player.currency} run credits`)).toBeVisible();
  await expect(weapon).toBeDisabled();
  await expect.poll(async () => (await checkpoint(page)).run.player).toMatchObject({
    currency: after.run.player.currency,
    hp: 60,
    weapons: after.run.player.weapons
  });
  expect(errors).toEqual([]);
});
