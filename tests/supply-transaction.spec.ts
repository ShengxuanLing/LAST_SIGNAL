import { expect, test, type Page } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 5173);

async function waitForScene(page: Page, name: string) {
  await page.waitForFunction((key) => (window as any).__game?.scene.isActive(key), name);
}

async function checkpoint(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('last_signal_save_v1') ?? '{}'));
}

async function waitCommitted(page: Page) {
  await page.waitForFunction(() => {
    const world = (window as any).__game.scene.getScene('GameScene').world;
    return !world.hasUncommittedCommands();
  });
}

/** Enter the first room, clear it, and wait for a safe supply terminal. */
async function reachSafeTerminal(page: Page) {
  await page.goto(`http://localhost:${PORT}/economy.html`);
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
  });
  // Clear the room and let updateRoom mark it cleared.
  await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    for (const enemy of world.enemies) { if (enemy.sprite?.scene) enemy.sprite.destroy(); }
    world.enemies = [];
    if (world.boss) { if (world.boss.sprite?.scene) world.boss.sprite.destroy(); world.boss = null; }
    // Core-authoritative enemies too: the commit-time safety check reads core state.
    world.simFixture.drones = [];
    world.simFixture.targets = [];
  });
  for (let i = 0; i < 5; i += 1) {
    await page.evaluate(() => {
      const { world } = (window as any).__game.scene.getScene('GameScene');
      world.resetSimulationAccumulator();
      world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    });
  }
  await waitCommitted(page);
  await expect(page.locator('#supply-open')).toBeVisible();
}

test('supply purchase commits on close, saves once, and blocks duplicate clicks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await reachSafeTerminal(page);

  // Seed an affordable, injured player and persist it as the baseline checkpoint.
  await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene('GameScene');
    const data = scene.world.playerDataFixture;
    data.currency = 200;
    data.hp = 40;
    scene.saveCheckpoint();
  });
  const before = await checkpoint(page);
  expect(before.run.player.currency).toBe(200);

  await page.locator('#supply-open').click();
  const dialog = page.getByRole('dialog', { name: 'Supply terminal' });
  await expect(dialog).toBeVisible();

  const repair = dialog.getByRole('button', { name: 'Buy Repair kit for 16 credits' });
  await expect(repair).toBeEnabled();
  await repair.click();
  // While the scene is paused there is no tick: the UI must say so and block re-clicks.
  await expect(dialog.getByText(/Close the terminal to complete your purchase/)).toBeVisible();
  await expect(repair).toBeDisabled();

  // Closing resumes the scene; the next tick commits, then the receipt is saved.
  await page.locator('#supply-close').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#supply-reward')).toContainText('Purchased Repair kit.');
  await expect.poll(async () => (await checkpoint(page)).run?.player.currency).toBe(184);
  await expect.poll(async () => (await checkpoint(page)).run?.player.hp).toBe(75);

  // No second deduction and no duplicate weapon/effect.
  const after = await checkpoint(page);
  expect(after.run.player.currency).toBe(184);
  expect(after.run.player.weapons).toHaveLength(1);

  // A committed purchase survives an immediate reload (saved before exit).
  await page.reload();
  await waitForScene(page, 'MainMenuScene');
  await page.mouse.click(640, 460); // CONTINUE
  await waitForScene(page, 'GameScene');
  const reopened = await checkpoint(page);
  expect(reopened.run.player.currency).toBe(184);
  expect(reopened.run.player.hp).toBe(75);
  expect(errors).toEqual([]);
});

test('insufficient credits disables every supply offer', async ({ page }) => {
  await reachSafeTerminal(page);
  await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene('GameScene');
    const data = scene.world.playerDataFixture;
    data.currency = 0;
    data.hp = 40;
    scene.saveCheckpoint();
  });
  await page.locator('#supply-open').click();
  const dialog = page.getByRole('dialog', { name: 'Supply terminal' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Buy Repair kit for 16 credits' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Buy Weapon calibration for 28 credits' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /Buy .* for 40 credits/ })).toBeDisabled();
});

test('uncommitted purchase is discarded on reload and keeps the last checkpoint', async ({ page }) => {
  await reachSafeTerminal(page);
  await page.evaluate(() => {
    const scene = (window as any).__game.scene.getScene('GameScene');
    const data = scene.world.playerDataFixture;
    data.currency = 120;
    data.hp = 40;
    scene.saveCheckpoint();
  });

  await page.locator('#supply-open').click();
  const dialog = page.getByRole('dialog', { name: 'Supply terminal' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Buy Repair kit for 16 credits' }).click();
  await expect(dialog.getByText(/Close the terminal to complete your purchase/)).toBeVisible();

  // Reload WITHOUT closing: the queued purchase was never committed, so the
  // last saved checkpoint must still hold the pre-purchase values.
  await page.reload();
  await waitForScene(page, 'MainMenuScene');
  await page.mouse.click(640, 460); // CONTINUE
  await waitForScene(page, 'GameScene');
  const restored = await checkpoint(page);
  expect(restored.run.player.currency).toBe(120);
  expect(restored.run.player.hp).toBe(40);
  expect(restored.run.player.weapons).toHaveLength(1);
});
