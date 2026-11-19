import { test } from '@playwright/test';

const OUT = 'reports/ui-rework-01/tester';

async function canvasOf(page: any) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas')!;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}
async function clickText(page: any, scene: string, label: string) {
  const l = await page.evaluate(({ scene, label }: any) => {
    const g: any = (window as any).__game;
    const s: any = g.scene.getScene(scene);
    const walk = (list: any[]): any[] => list.flatMap((c: any) => (c.type === 'Container' && c.list ? walk(c.list) : [c]));
    const t = walk(s.children.list).find((c: any) => c.type === 'Text' && c.visible !== false && String(c.text).includes(label));
    if (!t) return null;
    let b = t.getBounds();
    if (t.parentContainer) {
      const m = t.getWorldTransformMatrix();
      const p1 = m.transformPoint(b.x, b.y), p2 = m.transformPoint(b.right, b.bottom);
      b = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) };
    }
    return { x: b.x + (b.w ?? b.width) / 2, y: b.y + (b.h ?? b.height) / 2 };
  }, { scene, label });
  if (!l) throw new Error('no text ' + label);
  const box = await canvasOf(page);
  console.log("CLICK", label, JSON.stringify(l), JSON.stringify(box));
  await page.mouse.click(box.x + (l.x * box.w) / 1280, box.y + (l.y * box.h) / 720);
}
async function alive(page: any, ms = 3000) {
  const t0 = Date.now();
  try {
    await page.evaluate(() => 1, null, { timeout: ms });
    return `ok ${Date.now() - t0}ms`;
  } catch (e: any) { return `HUNG ${Date.now() - t0}ms ${e.message.split('\n')[0]}`; }
}
async function boot(page: any) {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('lastSignal.save.v1'));
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  await page.waitForTimeout(400);
  await clickText(page, 'MainMenuScene', 'NEW RUN');
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
  await page.waitForTimeout(800);
}
const press = async (page: any, key: string) => { await page.keyboard.press(key); await page.waitForTimeout(900); };

for (const [name, flow] of [
  ['inventory-esc', async (page: any) => { await press(page, 'Escape'); await clickText(page, 'PauseScene', 'INVENTORY'); await press(page, 'Escape'); }],
  ['settings-back-inventory-esc', async (page: any) => {
    await press(page, 'Escape');
    await clickText(page, 'PauseScene', 'SETTINGS'); await page.waitForTimeout(500);
    await clickText(page, 'PauseScene', 'BACK'); await page.waitForTimeout(500);
    await clickText(page, 'PauseScene', 'INVENTORY'); await press(page, 'Escape');
  }],
  ['pause-esc', async (page: any) => { await press(page, 'Escape'); await press(page, 'Escape'); }],
  ['echo-back', async (page: any) => {
    await press(page, 'Escape');
    await clickText(page, 'PauseScene', 'ECHO COMPANION'); await page.waitForTimeout(600);
    await clickText(page, 'PauseScene', 'BACK'); await page.waitForTimeout(700);
  }],
  ['companion-back', async (page: any) => {
    await press(page, 'Escape');
    await clickText(page, 'PauseScene', 'LLM COMPANION'); await page.waitForTimeout(600);
    await clickText(page, 'PauseScene', 'BACK'); await page.waitForTimeout(700);
  }]
] as Array<[string, (p: any) => Promise<void>]>) {
  test(`flow ${name}`, async ({ page }) => {
    await boot(page);
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await flow(page);
    const state = await alive(page);
    const scenes = await page.evaluate(() => (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key)).catch(() => ['<unresponsive>']);
    console.log(`FLOW ${name}: alive=${state} scenes=${JSON.stringify(scenes)} errors=${JSON.stringify(errs.slice(0, 3))}`);
    await page.screenshot({ path: `${OUT}/probe-${name}.png` });
  });
}
