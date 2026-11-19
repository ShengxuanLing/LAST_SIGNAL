import { test } from '@playwright/test';

const seed = 424242;
async function clickLogical(page: any, lx: number, ly: number) {
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas')!; const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + (lx * box.w) / 1280, box.y + (ly * box.h) / 720);
}
test('ai-survival', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).__game, { timeout: 20000 });
  await page.waitForTimeout(1300);
  await page.evaluate((s) => {
    const g: any = (window as any).__game;
    const menu: any = g.scene.getScene('MainMenuScene');
    const orig = menu.scene.start.bind(menu.scene);
    menu.scene.start = (key: string, data?: any) => (key === 'GameScene' ? orig(key, { seed: s }) : orig(key, data));
  }, seed);
  await clickLogical(page, 640, 340);
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await clickLogical(page, 640, 540);
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  let firstLevelUpMs: number | null = null;
  let deathMs: number | null = null;
  const fpsSamples: number[] = [];
  const hpTrace: number[] = [];
  const started = Date.now();
  // mimic the P1 loop: press '1' on level-up, 100ms cadence, 80 samples
  for (let i = 0; i < 80; i++) {
    const snap = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const active = g.scene.getScenes(true).map((s: any) => s.sys.settings.key);
      return { active, hp: gs?.world ? gs.world.player.data.hp : null, fps: g.loop.actualFps, enemies: gs?.world ? gs.world.enemies.length : null, room: gs?.world ? (gs.world.currentRoom()?.kind ?? null) : null };
    });
    if (snap.active.includes('LevelUpScene') && firstLevelUpMs === null) firstLevelUpMs = Date.now() - started;
    if (snap.active.includes('GameOverScene')) { deathMs = Date.now() - started; break; }
    if (snap.hp !== null) hpTrace.push(snap.hp);
    if (typeof snap.fps === 'number') fpsSamples.push(Math.round(snap.fps));
    if (snap.active.includes('LevelUpScene')) { await page.keyboard.press('1'); await page.waitForTimeout(400); }
    await page.waitForTimeout(100);
  }
  const final = await page.evaluate(() => {
    const g: any = (window as any).__game;
    const gs: any = g.scene.getScene('GameScene');
    return { active: g.scene.getScenes(true).map((s: any) => s.sys.settings.key), hp: gs?.world ? gs.world.player.data.hp : null, owner: gs?.world?.player?.control ? gs.world.player.control.owner : null };
  });
  const avgFps = fpsSamples.length ? Math.round(fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length) : null;
  const minHp = hpTrace.length ? Math.min(...hpTrace) : null;
  console.log('RESULT ' + JSON.stringify({ deathMs, firstLevelUpMs, avgFps, minHp, hpTrace: hpTrace.length > 30 ? hpTrace.filter((_, i) => i % 5 === 0) : hpTrace, final }));
});
