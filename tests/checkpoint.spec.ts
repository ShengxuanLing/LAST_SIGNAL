import { expect, test, type Page } from '@playwright/test';

const saveKey = 'last_signal_save_v1';

function readSave(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), saveKey);
}

async function waitForScene(page: Page, key: string) {
  await page.waitForFunction((name) => (window as any).__game?.scene.isActive(name), key, { timeout: 10000 });
}

test('resumes a cleared room and keeps run upgrades separate from permanent talents', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForScene(page, 'MainMenuScene');
  await page.evaluate(() => {
    const { scene } = (window as any).__game.scene.getScene('MainMenuScene');
    const start = scene.start.bind(scene);
    scene.start = (key: string, data: object) => start(key, key === 'GameScene' ? { ...data, seed: 424242 } : data);
  });
  await page.mouse.click(640, 340);
  await waitForScene(page, 'GameScene');
  await expect.poll(async () => (await readSave(page)).run?.clearedRooms.length).toBe(1);

  await page.evaluate(() => {
    const game = (window as any).__game.scene.getScene('GameScene');
    const { world } = game;
    world.player.reset(world.portal.wx, world.portal.wy);
    world.tryInteract(world.player);
  });
  await page.waitForFunction(() => (window as any).__game.scene.getScene('GameScene').world.enemies.length > 0);
  await page.evaluate(() => {
    const game = (window as any).__game.scene.getScene('GameScene');
    const { world } = game;
    for (const enemy of world.enemies) enemy.sprite.destroy();
    world.enemies = [];
    world.spawnLoot(world.player.x, world.player.y, 'currency', 'currency', 42);
    world.player.addXp(30);
  });
  await waitForScene(page, 'LevelUpScene');
  await page.mouse.click(380, 320);
  await expect.poll(async () => (await readSave(page)).run?.player.upgrades.length).toBe(1);
  await expect.poll(async () => (await readSave(page)).run?.player.currency).toBeGreaterThanOrEqual(42);
  const before = await readSave(page);
  expect(before.run.clearedRooms).toHaveLength(2);
  expect(before.permanent).toMatchObject({ cores: 0, maxHpBonus: 0, armorBonus: 0, damageBonus: 0 });

  await page.reload();
  await waitForScene(page, 'MainMenuScene');
  await page.mouse.click(640, 400); // LOAD RUN
  await page.waitForFunction(() => (window as any).__game.scene.getScene('MainMenuScene').children.list
    .some((child: any) => child.text === 'CHECKPOINT · SEED 424242'));
  await page.mouse.click(640, 460); // BACK
  await page.waitForFunction(() => (window as any).__game.scene.getScene('MainMenuScene').children.list
    .some((child: any) => child.text === 'CONTINUE'));
  await page.mouse.click(640, 460); // CONTINUE
  await waitForScene(page, 'GameScene');
  await expect.poll(async () => (await readSave(page)).run?.id).not.toBe(before.run.id);
  const resumed = await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    return { player: world.player.data, room: world.currentRoom().id, enemies: world.enemies.length };
  });
  expect(resumed.player).toMatchObject({
    upgrades: before.run.player.upgrades, currency: before.run.player.currency, level: before.run.player.level
  });
  expect(resumed.room).toBe(before.run.roomId);
  expect(resumed.enemies).toBe(0);

  await page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    world.spawnBoss(world.map.rooms.find((room: any) => room.kind === 'boss'));
    world.killBoss();
  });
  await waitForScene(page, 'GameOverScene');
  const victory = await readSave(page);
  expect(victory.run).toBeUndefined();
  expect(victory.permanent).toMatchObject({ cores: 1, bossesDefeated: 1, maxHpBonus: 0 });

  await page.mouse.click(640, 560); // MAIN MENU
  await waitForScene(page, 'MainMenuScene');
  await page.mouse.click(640, 520); // PERMANENT TALENTS
  await page.waitForFunction(() => (window as any).__game.scene.getScene('MainMenuScene').children.list
    .some((child: any) => child.text === 'PERMANENT CORES: 1'));
  await page.mouse.click(640, 338); // VITALITY
  await expect.poll(async () => (await readSave(page)).permanent).toMatchObject({ cores: 0, maxHpBonus: 1 });
  await page.waitForFunction(() => (window as any).__game.scene.getScene('MainMenuScene').children.list
    .some((child: any) => child.text === 'PERMANENT CORES: 0'));
  await page.mouse.click(640, 586); // BACK
  await page.waitForFunction(() => (window as any).__game.scene.getScene('MainMenuScene').children.list
    .some((child: any) => child.text === 'NEW RUN'));
  await page.mouse.click(640, 340);
  await waitForScene(page, 'GameScene');
  await expect.poll(async () => (await readSave(page)).run?.player).toMatchObject({
    hp: 120, maxHp: 120, currency: 0, upgrades: [], level: 1
  });
  expect(errors).toEqual([]);
});
