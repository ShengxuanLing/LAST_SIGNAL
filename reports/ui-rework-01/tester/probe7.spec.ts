import { test } from '@playwright/test';
import { boot, clickText, press } from './probe-helpers';

const pageName = async (page: any) => page.evaluate(() => {
  const g: any = (window as any).__game;
  const s: any = g.scene.getScene('PauseScene');
  return g.scene.isActive('PauseScene') ? (s.page ?? '?') : 'none';
});

test('click through the form overlay', async ({ page }) => {
  await boot(page);
  await press(page, 'Escape');
  await clickText(page, 'PauseScene', 'AI & COMPANION'); await page.waitForTimeout(400);
  await clickText(page, 'PauseScene', 'LLM COMPANION'); await page.waitForTimeout(400);
  await clickText(page, 'PauseScene', 'ENABLE / RE-AUTHORIZE');
  await page.waitForSelector('[data-testid="external-link-form"]');
  const geom = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="external-link-form"]')!;
    const panel = root.querySelector('form')!;
    const pr = panel.getBoundingClientRect();
    const els = Array.from(root.querySelectorAll('button,input')).map((e: any) => { const r = e.getBoundingClientRect(); return { tag: e.tagName, type: e.type, x: r.x, y: r.y, w: r.width, h: r.height, text: e.textContent }; });
    return { panel: { x: pr.x, y: pr.y, w: pr.width, h: pr.height }, els };
  });
  console.log('FORM_GEOM ' + JSON.stringify(geom));
  // Click on the panel background where Phaser's BACK button sits (640,530).
  const before = await pageName(page);
  await page.mouse.click(640, 530);
  await page.waitForTimeout(600);
  console.log(`CLICK_640_530 before=${before} after=${await pageName(page)}`);
  // Click on the panel background where Phaser's ENABLE button sits (640,186).
  await page.mouse.click(640, 186);
  await page.waitForTimeout(600);
  console.log(`CLICK_640_186 after=${await pageName(page)} formOpen=${await page.evaluate(() => !!document.querySelector('[data-testid="external-link-form"]'))}`);
});
