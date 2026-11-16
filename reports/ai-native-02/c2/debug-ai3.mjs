import { chromium } from '@playwright/test';
const browser = await chromium.launch({args:['--no-sandbox']});
const page = await browser.newPage({viewport:{width:1280,height:720}});
await page.goto('http://localhost:5173/');
await page.waitForFunction(()=>!!window.__game);
await page.waitForTimeout(1300);
await page.evaluate(()=>{const g=window.__game;const m=g.scene.getScene('MainMenuScene');const o=m.scene.start.bind(m.scene);m.scene.start=(k,d)=>k==='GameScene'?o(k,{seed:424242}):o(k,d);});
await page.mouse.click(640,340);
await page.waitForTimeout(1500);
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
await page.mouse.click(640,540); await page.waitForTimeout(550);
await page.keyboard.press('Escape'); await page.waitForTimeout(320);
let prev=null, path=0, trans=0;
for (let i=0;i<40;i++){
 const s=await page.evaluate(()=>{
  const g=window.__game; const gs=g.scene.getScene('GameScene'); const w=gs.world;
  const v=w.intentView();
  return {tick:w.sim.tick,pos:{x:w.sim.player.x,y:w.sim.player.y},room:w.currentRoom()?.kind,
   intent:w.player.lastIntent, owner:w.player.control.owner, portal:v.portal, enemies:v.enemies.length,act:w.player.control.snapshot().lastAiAction};
 });
 if(prev){const d=Math.hypot(s.pos.x-prev.x,s.pos.y-prev.y); if(prev.room!==s.room)trans++; else path+=d;}
 prev={...s.pos,room:s.room};
 if(i<25) console.log(i,JSON.stringify({tick:s.tick,pos:{x:+s.pos.x.toFixed(2),y:+s.pos.y.toFixed(2)},room:s.room,move:s.intent.move,act:s.act,portal:s.portal,en:s.enemies,path:+path.toFixed(2),trans}));
 await page.waitForTimeout(100);
}
await browser.close();
