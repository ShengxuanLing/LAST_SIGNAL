import { expect, test, type Page } from '@playwright/test';
import { SAVE_KEY } from '../src/config/game';

const savedAvatar = (page: Page) => page.evaluate((key) =>
  JSON.parse(localStorage.getItem(key) ?? '{}').settings?.avatar, SAVE_KEY);

const waitForMenu = (page: Page) => page.waitForFunction(() =>
  (window as any).__game?.scene.isActive('MainMenuScene'));

test('Claude can be selected, restored and shown in both side-facing views', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForMenu(page);
  for (const avatar of ['whale', 'claude', 'grok', 'gemini', 'gpt', 'operator', 'whale', 'claude']) {
    await page.mouse.click(1000, 490);
    await expect.poll(() => savedAvatar(page)).toBe(avatar);
    await waitForMenu(page);
  }

  await page.reload();
  await waitForMenu(page);
  expect(await savedAvatar(page)).toBe('claude');
  if (process.env.LS_SHOT_DIR) await page.screenshot({ path: `${process.env.LS_SHOT_DIR}/claude-menu.png` });
  await page.mouse.click(640, 340);
  await page.waitForFunction(() => (window as any).__game.scene.isActive('GameScene'));
  const playerSprite = () => page.evaluate(() => {
    const { world } = (window as any).__game.scene.getScene('GameScene');
    const sprite = world.player.sprite;
    return { texture: sprite.texture.key, radius: world.player.getRadius(), height: sprite.displayHeight };
  });
  expect(await playerSprite()).toMatchObject({ texture: 'claude-chan', radius: 0.5, height: 72 });
  if (process.env.LS_SHOT_DIR) await page.screenshot({ path: `${process.env.LS_SHOT_DIR}/claude-game.png` });

  for (const [key, texture] of [['a', 'claude-chan-left'], ['d', 'claude-chan-right'], ['w', 'claude-chan']]) {
    await page.keyboard.down(key);
    await expect.poll(async () => (await playerSprite()).texture).toBe(texture);
    await page.keyboard.up(key);
  }
  expect(errors).toEqual([]);
});
