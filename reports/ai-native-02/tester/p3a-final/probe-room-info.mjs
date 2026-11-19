import { chromium } from 'playwright';
const b=await chromium.launch({args:['--no-sandbox']});
const page=await b.newPage({viewport:{width:1280,height:720}});
await page.goto('http://localhost:5361/',{waitUntil:'load'});
await page.waitForFunction(()=>window.__game?.scene.isActive('MainMenuScene'));
await page.mouse.click(640,340);
await page.waitForFunction(()=>window.__game?.scene.isActive('GameScene'));
await page.waitForTimeout(400);
const r=await page.evaluate(()=>{const gs=window.__game.scene.getScene('GameScene');const w=gs.world;const e=w.sim.player;const room=w.currentRoom();
 let best=null;
 for(let y=0;y<60;y+=1){for(let x=0;x<60;x+=1){if(!w.isWalkable(x,y,0.5))continue;const d=Math.hypot(x-e.x,y-e.y);if(!best||d>best.d)best={x,y,d};}}
 return {room, player:{x:e.x,y:e.y}, maxWalkableDist:best, enemies:w.sim.targets.map(t=>({id:t.id,x:t.x,y:t.y,kind:t.kind})), drones:w.sim.drones.length};});
console.log(JSON.stringify(r,null,2));
await b.close();
