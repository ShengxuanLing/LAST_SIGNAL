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
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit teleport, player now at portal
    world.tryInteract(world.player); // triggers room transition
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit room-enter
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false }); // commit spawn, let SupplyTerminal update
  });
  await expect(page.getByText('Supply terminal · clear remaining threats')).toBeVisible();
  await page.keyboard.press('g');
  const terminal = page.getByRole('dialog', { name: 'Supply terminal' });
  await expect(terminal).toBeHidden();

  const roomReward = await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    // Known baseline, then grant 82 credits through a real loot drop.
    world.clearLootForTest();
    world.playerDataFixture.currency = 0;
    world.playerDataFixture.hp = 25;
    world.enqueueSpawnLoot(world.player.x, world.player.y, 'currency', 'currency', 82);
    // Actually clear the room in the authoritative core (no premature reward).
    world.simFixture.drones = [];
    world.simFixture.targets = [];
    for (const enemy of world.enemies) if (enemy.sprite?.scene) enemy.sprite.destroy();
    world.enemies = [];
    if (world.boss) { if (world.boss.sprite?.scene) world.boss.sprite.destroy(); world.boss = null; }
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    return world.currentRoom().kind === 'elite' ? 24 : 12;
  });
  await expect(page.getByText(`+${roomReward} credits · room cleared`)).toBeVisible();
  await expect.poll(async () => (await checkpoint(page)).run?.player.currency).toBe(82 + roomReward);
  await page.keyboard.press('g');
  await expect(terminal).toBeVisible();

  const repair = terminal.getByRole('button', { name: 'Buy Repair kit for 16 credits' });
  const calibration = terminal.getByRole('button', { name: 'Buy Weapon calibration for 28 credits' });
  const weapon = terminal.getByRole('button', { name: /Buy .* for 40 credits/ });

  // Purchase is queued in the paused dialog and commits on the resume tick;
  // success is shown only after the checkpoint save.
  await repair.click();
  await expect(terminal.getByText(/Close the terminal to complete your purchase/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(terminal).toBeHidden();
  await expect(page.locator('#supply-reward')).toContainText('Purchased Repair kit.');
  await expect.poll(async () => (await checkpoint(page)).run.player.hp).toBe(60);
  await expect.poll(async () => (await checkpoint(page)).run.player.currency).toBe(82 + roomReward - 16);

  await page.getByRole('button', { name: /Supply terminal/ }).click();
  await expect(terminal).toBeVisible();
  await weapon.click();
  await expect(terminal.getByText(/Close the terminal to complete your purchase/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(terminal).toBeHidden();
  await expect(page.locator('#supply-reward')).toContainText('Purchased');
  await page.getByRole('button', { name: /Supply terminal/ }).click();
  await expect(terminal).toBeVisible();
  await expect(weapon).toBeDisabled();
  await expect(terminal.getByText(/Already owned/)).toBeVisible();

  await calibration.click();
  await expect(terminal.getByText(/Close the terminal to complete your purchase/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(terminal).toBeHidden();
  // Closing resumes the scene; the calibration command commits on the next
  // normal tick and only then is the checkpoint saved.
  await expect.poll(async () => (await checkpoint(page)).run?.player.currency).toBe(82 + roomReward - 16 - 40 - 28);
  const after = await checkpoint(page);
  expect(after.run.player.currency).toBe(82 + roomReward - 16 - 40 - 28);
  expect(after.run.player.weapons).toHaveLength(2);
  expect(after.run.player.weapons.find((entry: any) => entry.key === after.run.player.weaponKey)?.level).toBe(2);
  expect(after.permanent).toMatchObject({ cores: 0, unlockedWeapons: ['pulse'] });

  await page.getByRole('button', { name: /Supply terminal/ }).click();
  await expect(terminal).toBeVisible();
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

test('a failed checkpoint save keeps the purchase pending and completes once after recovery', async ({ page }) => {
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
    const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
    world.player.reset(world.portal.wx, world.portal.wy);
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, neutral);
    world.tryInteract(world.player);
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, neutral);
    world.resetSimulationAccumulator();
    world.stepFrame(1000 / 60 + 1e-6, neutral);
    world.simFixture.drones = [];
    world.simFixture.targets = [];
    for (const enemy of world.enemies) if (enemy.sprite?.scene) enemy.sprite.destroy();
    world.enemies = [];
    if (world.boss) { if (world.boss.sprite?.scene) world.boss.sprite.destroy(); world.boss = null; }
    for (let i = 0; i < 5; i += 1) {
      world.resetSimulationAccumulator();
      world.stepFrame(1000 / 60 + 1e-6, neutral);
    }
    const data = world.playerDataFixture;
    data.currency = 200;
    data.hp = 40;
    (window as any).__game.scene.getScene('GameScene').saveCheckpoint();
  });
  await expect(page.locator('#supply-open')).toBeVisible();

  // Inject a real storage failure, then buy: the commit succeeds in memory but
  // the checkpoint save fails, so the UI must NOT report success and must keep
  // the transaction pending (dirty) for retry.
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('Storage unavailable for the test'); };
    window.addEventListener('restore-test-storage', () => { Storage.prototype.setItem = original; }, { once: true });
  });
  const baseline = await page.evaluate(() => {
    const w = (window as any).__game.scene.getScene('GameScene').world;
    return { currency: w.sim.player.data.currency, disk: JSON.parse(localStorage.getItem('last_signal_save_v1') ?? '{}').run?.player?.currency };
  });
  const diskBefore = baseline.disk as number;

  await page.locator('#supply-open').click();
  const terminal = page.getByRole('dialog', { name: 'Supply terminal' });
  await expect(terminal).toBeVisible();
  await terminal.getByRole('button', { name: 'Buy Repair kit for 16 credits' }).click();
  await expect(terminal.getByText(/Close the terminal to complete your purchase/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(terminal).toBeHidden();

  await expect(page.locator('#supply-reward')).toContainText('could not be saved');
  await expect(page.locator('#supply-reward')).not.toContainText('Purchased');
  const mid = await checkpoint(page);
  // In-memory commit deducted once; the failed save left the on-disk checkpoint untouched.
  const memAfter = await page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.sim.player.data.currency);
  expect(memAfter, 'in-memory commit deducted exactly once').toBe(baseline.currency - 16);
  expect(mid.run.player.currency, 'on-disk checkpoint unchanged while storage fails').toBe(diskBefore);

  // Recover storage: the pending transaction retries and completes exactly once.
  await page.evaluate(() => window.dispatchEvent(new Event('restore-test-storage')));
  await expect(page.locator('#supply-reward')).toContainText('Purchased Repair kit.');
  await expect.poll(async () => (await checkpoint(page)).run?.player.currency).toBe(baseline.currency - 16);
  await expect.poll(async () => (await checkpoint(page)).run?.player.hp).toBe(75);
  const after = await checkpoint(page);
  expect(after.run.player.currency, 'no double deduction after retry').toBe(baseline.currency - 16);
  expect(after.run.player.hp).toBe(75);
  expect(after.run.player.weapons).toHaveLength(1);
  expect(errors).toEqual([]);
});
