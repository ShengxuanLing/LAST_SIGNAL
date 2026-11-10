import { test, expect } from '@playwright/test';

// Regression test: the full HUD (HP/XP/CREDITS/LV/timer, weapon/room/enemies on the
// right, stats) must render at on-screen positions and stay locked as the camera moves.
// Regression: camera world-space culling previously cut the far-right HUD texts.
test('full HUD renders and stays locked during camera movement', async ({ page }) => {
  await page.goto('http://localhost:5199/');
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const g: any = (window as any).__game;
    g.scene.start('GameScene', { seed: 42 });
  });
  await page.waitForTimeout(1800);

  const sampleHUD = async () => {
    await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs = Object.values(g.scene.scenes).find((s:any)=>s?.constructor?.name==='GameScene');
      // move the player so the camera scrolls while we sample
      gs.world.player.reset(4000, 400);
    });
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs = Object.values(g.scene.scenes).find((s:any)=>s?.constructor?.name==='GameScene');
      const cam = gs.cameras.main;
      const ctx = g.canvas.getContext('2d')!;
      // count bright (non-background) pixels inside a screen rect; >0 => the text/bar renders
      const bright = (x:number,y:number,w:number,h:number)=>{const d=ctx.getImageData(x,y,w,h);let n=0;for(let k=0;k<d.data.length;k+=4){if(d.data[k]>150||d.data[k+1]>120||d.data[k+2]>80)n++;}return n;};
      return {
        zoom: cam.zoom,
        hp: bright(120,8,130,40),
        xp: bright(120,30,130,30),
        credits: bright(8,52,140,28),
        level: bright(8,70,90,28),
        timer: bright(8,96,90,24),
        hpBar: bright(8,14,120,28),
        weapon: bright(1090,6,200,40),    // far right: was culled before the fix
        room: bright(1090,32,200,30),      // far right
        enemies: bright(1090,50,200,30),   // far right
        stats: bright(8,680,320,28),
      };
    });
  };

  const hud = await sampleHUD();
  console.log('HUD', JSON.stringify(hud));
  // every region must contain bright pixels
  expect(hud.hp, 'HP text').toBeGreaterThan(0);
  expect(hud.xp, 'XP text').toBeGreaterThan(0);
  expect(hud.credits, 'CREDITS text').toBeGreaterThan(0);
  expect(hud.level, 'LV text').toBeGreaterThan(0);
  expect(hud.timer, 'timer text').toBeGreaterThan(0);
  expect(hud.hpBar, 'HP bar').toBeGreaterThan(0);
  expect(hud.weapon, 'weapon text (far-right)').toBeGreaterThan(0);
  expect(hud.room, 'room text (far-right)').toBeGreaterThan(0);
  expect(hud.enemies, 'enemies text (far-right)').toBeGreaterThan(0);
  expect(hud.stats, 'stats text').toBeGreaterThan(0);
});
