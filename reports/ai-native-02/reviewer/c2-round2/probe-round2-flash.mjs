import { chromium } from '@playwright/test';
const PORT = Number(process.env.PORT ?? 5361);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__game.scene.start('GameScene', { seed: 424242 }));
await page.waitForTimeout(1200);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const r = await page.evaluate(() => {
  const g = window.__game; const gs = g.scene.getScene('GameScene'); const w = gs.world; const p = w.player;
  w.clearEnemiesForTest();
  const room = w.currentRoom();
  let spot = null; for (const d of [2,1.5,-2,-1.5]) { const x=p.wx+d,y=p.wy; if (w.isWalkable(x,y,0.5)) { spot={x,y}; break; } }
  if (!spot) spot = { x:p.wx, y:p.wy+2 };
  const hunter = w.spawnEnemy('hunter', spot.x, spot.y, room.id, 1);
  w.enqueueTargetHp(hunter._id, 500);
  w.resetSimulationAccumulator();
  const neutral = { move:{x:0,y:0}, dash:false, fire:false, aim:null, interact:false };
  w.stepFrame(1000/60+1e-6, neutral);
  let sawHit=false, flash=0, hp0=hunter._hp;
  for (let i=0;i<80;i++) {
    const ev = w.stepFrame(1000/60+1e-6, { move:{x:0,y:0}, dash:false, fire:true, aim:spot, interact:false });
    if (ev.some(e=>e.type==='enemy-hit')) { sawHit=true; flash=hunter.data.hitFlash; break; }
  }
  return { sawHit, flash, hp0, hp1: hunter._hp, paused: gs.paused };
});
console.log(JSON.stringify({ ...r, pageErrors: errors }, null, 2));
await browser.close();
