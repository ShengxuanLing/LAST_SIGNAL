import { expect, test } from '@playwright/test';
import { SAVE_KEY } from '../src/config/game';

for (const avatar of ['grok', 'gemini', 'gpt']) {
  test(`${avatar} loads its three community sprites in a playable run`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
    // Exercise old save migration alongside the normal browser reload and new-run entry.
    await page.evaluate(({ key, avatar }) => {
      localStorage.setItem(key, JSON.stringify({ version: 1, settings: { avatar } }));
    }, { key: SAVE_KEY, avatar });
    await page.reload();
    await page.waitForFunction((label) => (window as any).__game?.scene.getScene('MainMenuScene')
      .children.list.some((child: any) => child.text === label), `${avatar.toUpperCase()}-CHAN ↻`);
    if (process.env.LS_SHOT_DIR) await page.screenshot({ path: `${process.env.LS_SHOT_DIR}/roster-${avatar}-menu.png` });
    await page.mouse.click(640, 340);
    await page.waitForFunction(() => (window as any).__game.scene.isActive('GameScene'));
    const sprite = () => page.evaluate(() => {
      const { player } = (window as any).__game.scene.getScene('GameScene').world;
      const { texture, displayHeight, height } = player.sprite;
      return { key: texture.key, displayHeight, height, radius: player.getRadius() };
    });
    expect(await sprite()).toMatchObject({ key: `${avatar}-chan`, displayHeight: 72, height: 640, radius: 0.5 });
    for (const [key, suffix] of [['a', '-left'], ['d', '-right'], ['w', '']]) {
      await page.keyboard.down(key);
      await expect.poll(async () => (await sprite()).key).toBe(`${avatar}-chan${suffix}`);
      await page.keyboard.up(key);
    }
    expect(errors).toEqual([]);
  });
}
