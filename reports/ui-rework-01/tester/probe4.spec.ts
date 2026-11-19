import { test } from '@playwright/test';
import { boot, clickText, press } from './probe-helpers';

test('who navigates', async ({ page }) => {
  await boot(page);
  await press(page, 'Escape');
  await clickText(page, 'PauseScene', 'AI & COMPANION'); await page.waitForTimeout(400);
  await clickText(page, 'PauseScene', 'LLM COMPANION'); await page.waitForTimeout(400);
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    (window as any).__nav = [];
    const proto = Object.getPrototypeOf(s);
    const orig = proto.navigate;
    proto.navigate = function (p: any) {
      (window as any).__nav.push({ p, stack: (new Error().stack || '').split('\n').slice(1, 6).join(' << ') });
      return orig.call(this, p);
    };
  });
  await clickText(page, 'PauseScene', 'ENABLE / RE-AUTHORIZE'); await page.waitForTimeout(600);
  console.log('NAV_AFTER_OPEN ' + JSON.stringify(await page.evaluate(() => (window as any).__nav)));
  await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]', 'http://127.0.0.1:9');
  await page.fill('[data-testid="external-link-form"] input[name="token"]', 'e2e-token-0123456789abcdef');
  await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]', 'a'.repeat(64));
  console.log('NAV_AFTER_FILL ' + JSON.stringify(await page.evaluate(() => (window as any).__nav)));
  await page.click('[data-testid="external-link-form"] button[type="submit"]');
  await page.waitForTimeout(800);
  console.log('NAV_AFTER_SUBMIT ' + JSON.stringify(await page.evaluate(() => (window as any).__nav)));
});
