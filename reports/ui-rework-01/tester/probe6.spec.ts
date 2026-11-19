import { test } from '@playwright/test';
import { boot, clickText, press } from './probe-helpers';

const pageName = async (page: any) => page.evaluate(() => {
  const g: any = (window as any).__game;
  const s: any = g.scene.getScene('PauseScene');
  return g.scene.isActive('PauseScene') ? (s.page ?? '?') : 'none';
});

async function openForm(page: any) {
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    s.navigate('llm');
  });
  await page.waitForTimeout(400);
  await clickText(page, 'PauseScene', 'ENABLE / RE-AUTHORIZE');
  await page.waitForSelector('[data-testid="external-link-form"]');
}

test('A/B submit click', async ({ page }) => {
  await boot(page);
  await press(page, 'Escape');
  await clickText(page, 'PauseScene', 'AI & COMPANION'); await page.waitForTimeout(400);
  await clickText(page, 'PauseScene', 'LLM COMPANION'); await page.waitForTimeout(400);

  // A: page.click(selector)
  await openForm(page);
  await page.click('[data-testid="external-link-form"] button[type="submit"]');
  await page.waitForTimeout(700);
  console.log('A_selector ' + await pageName(page));
  await page.evaluate(() => (document.querySelector('[data-testid="external-link-form"]') as any)?.remove());
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    s.domForm = null;
  });

  // B: mouse.click at the same rect centre
  await openForm(page);
  const box = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="external-link-form"] button[type="submit"]')!.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(700);
  console.log('B_mouse ' + await pageName(page) + ' at ' + JSON.stringify(box));

  // C: what Phaser object is under that point?
  const hit = await page.evaluate(({ x, y }) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene('PauseScene');
    const found: any[] = [];
    const walk = (l: any[]): any[] => l.flatMap((c: any) => (c.type === 'Container' && c.list ? walk(c.list) : [c]));
    for (const o of walk(s.children.list)) {
      if (!o.input) continue;
      const r = o.input.hitArea;
      if (!r) continue;
      const b = o.getBounds();
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) found.push({ t: o.type, label: o.text ?? null, box: { x: b.x, y: b.y, w: b.width, h: b.height } });
    }
    return { canvas: g.canvas.getBoundingClientRect().toJSON(), found };
  }, box);
  console.log('HIT ' + JSON.stringify(hit));
});
