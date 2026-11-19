import { test } from '@playwright/test';
import { clickText, boot, press, alive } from './probe-helpers';

test('inventory esc deep', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    (window as any).__keys = [];
    window.addEventListener('keydown', (e) => (window as any).__keys.push(e.key), true);
  });
  await press(page, 'Escape');
  await clickText(page, 'PauseScene', 'INVENTORY');
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    const dim = s.children.list.find((c: any) => c.type === 'Rectangle' && c.width >= 1280);
    return { scenes: g.scene.getScenes(true).map((sc: any) => sc.sys.settings.key), mode: s.sys.settings.data?.mode, dimAlpha: dim ? dim.alpha : null, keyHandlers: (s.input.keyboard?.listeners?.('keydown-ESC') ?? []).length };
  });
  await page.keyboard.press('Escape');
  const samples: any[] = [];
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(250);
    samples.push(await page.evaluate(() => {
      const g: any = (window as any).__game;
      const s: any = g.scene.getScene('PauseScene');
      const dim = s?.children?.list?.find((c: any) => c.type === 'Rectangle' && c.width >= 1280);
      return { scenes: g.scene.getScenes(true).map((sc: any) => sc.sys.settings.key), mode: s?.sys?.settings?.data?.mode, dimAlpha: dim ? Math.round(dim.alpha * 100) / 100 : null, keys: (window as any).__keys.slice(-3) };
    }));
  }
  console.log('BEFORE ' + JSON.stringify(before));
  console.log('SAMPLES ' + JSON.stringify(samples));
  await page.screenshot({ path: 'reports/ui-rework-01/tester/probe-inventory-after-esc.png' });
});
