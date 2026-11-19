import { test } from '@playwright/test';
import { boot, clickText, press } from './probe-helpers';

const pageName = async (page: any) => page.evaluate(() => {
  const g: any = (window as any).__game;
  const s: any = g.scene.getScene('PauseScene');
  return g.scene.isActive('PauseScene') ? (s.page ?? '?') : 'none';
});

test('form click isolation: baseline vs mousedown stopped', async ({ page }) => {
  await boot(page);
  await press(page, 'Escape');
  await clickText(page, 'PauseScene', 'AI & COMPANION'); await page.waitForTimeout(400);
  await clickText(page, 'PauseScene', 'LLM COMPANION'); await page.waitForTimeout(400);

  // Baseline: click AUTHORIZE with an unreachable bridge.
  await clickText(page, 'PauseScene', 'ENABLE / RE-AUTHORIZE'); await page.waitForTimeout(500);
  await page.fill('[data-testid="external-link-form"] input[name="token"]', 'e2e-token-0123456789abcdef');
  await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]', 'a'.repeat(64));
  const box = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="external-link-form"] button[type="submit"]')!.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  console.log('SUBMIT_AT ' + JSON.stringify(box));
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(700);
  console.log('BASELINE_PAGE ' + await pageName(page));
  const survivedBaseline = (await pageName(page)) === 'llm';
  await page.screenshot({ path: 'reports/ui-rework-01/tester/probe-form-click-baseline.png' });

  // Same click, but the form also stops real mouse events (Chromium dispatches
  // pointerdown AND mousedown; Phaser listens for mousedown/mouseup on window).
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="external-link-form"]')!;
    for (const t of ['mousedown', 'mouseup', 'mousemove', 'wheel', 'contextmenu', 'dblclick']) {
      root.addEventListener(t as any, (e) => e.stopPropagation(), true);
    }
    (window as any).__mouseGuard = true;
  });
  // Reopen llm page if the baseline click already navigated away.
  if (!survivedBaseline) {
    await page.evaluate(() => {
      const g: any = (window as any).__game;
      const s: any = g.scene.getScene('PauseScene');
      if (g.scene.isActive('PauseScene')) s.navigate('llm');
    });
    await page.waitForTimeout(300);
  }
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(700);
  console.log('GUARDED_PAGE ' + await pageName(page));
  await page.screenshot({ path: 'reports/ui-rework-01/tester/probe-form-click-guarded.png' });
});
