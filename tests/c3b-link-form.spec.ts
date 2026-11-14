// AI-NATIVE-02 C3-b — native in-game External Link connection form.
//
// The normal demo must not require the browser console. A player opens
// Pause -> SETTINGS -> EXTERNAL LINK SETUP, enters a local bridge URL and a
// MASKED token, and clicks AUTHORIZE. Typing must not trigger Phaser takeover
// or close the pause menu. Real bridge errors are surfaced. Five viewports.

import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';
import { WorldGateway } from '../src/ai-native/worldGateway';

const PORT = Number(process.env.PORT ?? 5173);
const ORIGIN = `http://localhost:${PORT}`;

async function canvasScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('#game canvas') as HTMLCanvasElement | null;
    const box = canvas?.getBoundingClientRect();
    return box ? box.width / 1280 : 1;
  });
}

async function clickLogical(page: Page, lx: number, ly: number): Promise<void> {
  const scale = await canvasScale(page);
  const offset = await page.evaluate(() => {
    const canvas = document.querySelector('#game canvas') as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    return { x: box.left, y: box.top };
  });
  await page.mouse.click(offset.x + lx * scale, offset.y + ly * scale);
}

async function bootRun(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  const newRun = await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      const t = s.children.list.find((c: any) => c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
      if (t) return { x: t.x, y: t.y };
    }
    return null;
  });
  expect(newRun).not.toBeNull();
  await page.mouse.click(newRun!.x, newRun!.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
}

async function openFormFromSettings(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
  await clickLogical(page, 640, 420); // SETTINGS
  await page.waitForTimeout(250);
  await clickLogical(page, 640, 510); // EXTERNAL LINK SETUP
  await expect(page.getByTestId('external-link-form')).toBeVisible({ timeout: 5000 });
}

async function owner(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__game.scene.getScene('GameScene').world.player.control.owner);
}

test('the form is reachable without the console, masks the token and isolates typing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await bootRun(page);

  // Turn the local AI demo on so a keyboard leak would be observable.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
  await clickLogical(page, 640, 540); // AI CONTROL
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
  expect(await owner(page), 'AI owns control').toBe('ai');

  await page.keyboard.press('Escape');
  await openFormFromSettings(page);

  const token = page.locator('[data-testid="external-link-form"] input[name="token"]');
  await expect(token).toHaveAttribute('type', 'password');
  const url = page.locator('[data-testid="external-link-form"] input[name="bridgeUrl"]');
  // Typing W/A/S/D/SPACE/ESC must NOT take control or close the pause menu.
  await url.fill('');
  await url.type('wasd space', { delay: 10 });
  await url.press('Escape');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).__game.scene.isActive('PauseScene')), 'pause menu still open').toBe(true);
  expect(await owner(page), 'typing did not take over').toBe('ai');
  await expect(page.getByTestId('external-link-form')).toBeVisible();

  await page.getByRole('button', { name: 'CANCEL' }).click();
  await expect(page.getByTestId('external-link-form')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('AUTHORIZE from the form links the rendered world; a wrong token shows a REAL error', async ({ page }) => {
  const tokenValue = randomBytes(24).toString('hex');
  const gateway = new WorldGateway();
  const bridge = await startWorldBridge({ gateway, token: tokenValue, allowedOrigins: [ORIGIN] });
  try {
    await bootRun(page);
    await page.keyboard.press('Escape');
    await openFormFromSettings(page);

    // Wrong token first: the real bridge error must be shown, not a generic toast.
    await page.locator('[data-testid="external-link-form"] input[name="bridgeUrl"]').fill(bridge.url);
    await page.locator('[data-testid="external-link-form"] input[name="token"]').fill('wrong-token-value-0123456789');
    await page.getByRole('button', { name: 'AUTHORIZE' }).click();
    const status = page.getByTestId('external-link-status');
    await expect(status).toContainText('FAILED', { timeout: 10000 });
    await expect(status).toContainText('world.', { timeout: 10000 });
    expect(await owner(page), 'control stays human on failure').toBe('human');

    // Correct token from the same form.
    await page.locator('[data-testid="external-link-form"] input[name="bridgeUrl"]').fill(bridge.url);
    await page.locator('[data-testid="external-link-form"] input[name="token"]').fill(tokenValue);
    await page.getByRole('button', { name: 'AUTHORIZE' }).click();
    await expect(page.getByTestId('external-link-form')).toHaveCount(0, { timeout: 15000 });
    await expect.poll(async () => owner(page), { timeout: 15000 }).toBe('external');
    // The token must not remain in the DOM.
    const leaked = await page.evaluate(() => document.body.innerHTML.includes('wrong-token-value'));
    expect(leaked).toBe(false);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
  } finally {
    await bridge.close();
  }
});

test('the connection form fits and stays usable at five viewports', async ({ page }) => {
  test.setTimeout(120000);
  await bootRun(page);
  for (const [w, h] of [[1920, 1080], [1366, 768], [1280, 720], [1024, 768], [800, 600]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await openFormFromSettings(page);
    const box = await page.getByTestId('external-link-form').boundingBox();
    expect(box, `form visible at ${w}x${h}`).not.toBeNull();
    expect(box!.x, `left inside ${w}x${h}`).toBeGreaterThanOrEqual(-1);
    expect(box!.y, `top inside ${w}x${h}`).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width, `right inside ${w}x${h}`).toBeLessThanOrEqual(w + 1);
    expect(box!.y + box!.height, `bottom inside ${w}x${h}`).toBeLessThanOrEqual(h + 1);
    await page.getByRole('button', { name: 'CANCEL' }).click();
    await expect(page.getByTestId('external-link-form')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
  }
  await page.setViewportSize({ width: 1280, height: 720 });
});
