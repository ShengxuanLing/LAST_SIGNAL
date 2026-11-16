import { chromium } from '@playwright/test';
const browser = await chromium.launch({args:['--no-sandbox']});
const page = await browser.newPage({viewport:{width:1280,height:720}});
await page.goto('http://localhost:5173/');
await page.waitForFunction(()=>!!window.__game);
await page.waitForTimeout(1300);
await page.mouse.click(640,340);
await page.waitForTimeout(1500);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.mouse.click(640,540);
await page.waitForTimeout(500);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
for (let i=0;i<40;i++){
 const s=await page.evaluate(()=>{
  const g=window.__game; const gs=g.scene.getScene('GameScene'); const w=gs.world;
  const v=w.intentView();
  return {tick:w.sim.tick,pos:{x:+w.sim.player.x.toFixed(2),y:+w.sim.player.y.toFixed(2)},room:w.currentRoom()?.kind,
   intent:w.player.lastIntent, owner:w.player.control.owner, portal:v.portal, enemies:v.enemies.length,act:w.player.control.snapshot().lastAiAction};
 });
 console.log(JSON.stringify(s));
 await page.waitForTimeout(100);
}
await browser.close();
