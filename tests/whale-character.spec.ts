import { expect, test, type Page } from '@playwright/test';
import { SAVE_KEY } from '../src/config/game';

function playerState(page: Page) {
  return page.evaluate(() => {
    const game = (window as any).__game;
    const scene = game.scene.getScene('GameScene');
    const { sprite } = scene.world.player;
    return {
      texture: sprite.texture.key,
      sourceHeight: sprite.height,
      displayHeight: sprite.displayHeight,
      flipped: sprite.flipX,
      radius: scene.world.player.getRadius(),
      effects: scene.children.list.map((child: { name: string }) => child.name)
        .filter((name: string) => name.startsWith('whale-'))
    };
  });
}

test('whale appearance persists and responds to real movement and shots', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  await page.mouse.click(1000, 490);
  await expect.poll(() => page.evaluate((key) =>
    JSON.parse(localStorage.getItem(key) ?? '{}').settings?.avatar, SAVE_KEY)).toBe('whale');

  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  if (process.env.LS_SHOT_DIR) await page.screenshot({ path: `${process.env.LS_SHOT_DIR}/whale-art-menu.png` });
  await page.mouse.click(640, 340);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
  expect(await playerState(page)).toMatchObject({ texture: 'whale-chan', sourceHeight: 306, displayHeight: 72, radius: 0.5 });
  if (process.env.LS_SHOT_DIR) await page.screenshot({ path: `${process.env.LS_SHOT_DIR}/whale-art-game.png` });

  await page.keyboard.down('a');
  await expect.poll(() => playerState(page)).toMatchObject({ texture: 'whale-chan-side', flipped: false });
  await page.keyboard.up('a');
  await page.keyboard.down('d');
  await expect.poll(() => playerState(page)).toMatchObject({ texture: 'whale-chan-side', flipped: true });
  await page.keyboard.up('d');

  await page.keyboard.down('w');
  await expect.poll(() => playerState(page)).toMatchObject({
    texture: 'whale-chan-rear', effects: expect.arrayContaining(['whale-wake'])
  });
  await page.keyboard.down('Space');
  await expect.poll(async () => (await playerState(page)).effects).toContain('whale-dash');
  await page.keyboard.up('Space');
  await page.keyboard.up('w');

  await page.keyboard.down('s');
  await expect.poll(() => playerState(page)).toMatchObject({ texture: 'whale-chan', flipped: false });
  await page.keyboard.up('s');
  await page.mouse.move(860, 450);
  await page.mouse.down();
  await expect.poll(async () => (await playerState(page)).effects).toContain('whale-shot');
  await page.mouse.up();
  await expect.poll(async () => (await playerState(page)).effects).toEqual([]);
  expect(errors).toEqual([]);
});
