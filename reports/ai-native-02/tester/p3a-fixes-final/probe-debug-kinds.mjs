import { chromium } from 'playwright';
const b=await chromium.launch({args:['--no-sandbox']}); const page=await b.newPage({viewport:{width:1280,height:720}});
await page.goto('http://localhost:5371/',{waitUntil:'load'}); await page.waitForFunction(()=>window.__game?.scene.isActive('MainMenuScene'));
await page.mouse.click(640,340); await page.waitForFunction(()=>window.__game?.scene.isActive('GameScene')); await page.waitForTimeout(300);
await page.evaluate(()=>{const gs=window.__game.scene.getScene('GameScene');const w=gs.world;const n={move:{x:0,y:0},dash:false,fire:false,aim:null,interact:false};w.enableEcho();w.stepFrame(1000/60+1e-6,n,n);});
for(const kind of ['stalker','sentinel']){
  const r=await page.evaluate((kind)=>{const gs=window.__game.scene.getScene('GameScene');const w=gs.world;const n={move:{x:0,y:0},dash:false,fire:false,aim:null,interact:false};w.clearEnemiesForTest();w.resetProjectilesForTest();const e=w.simFixture.echo;e.data.hp=e.data.maxHp;e.invuln=0;e.hurtTimer=0;const room=w.currentRoom();
    let far=null;for(const row of w.map.tiles)for(const t of row){if(w.isWalkable(t.x,t.y,0.5)&&Math.hypot(t.x-e.x,t.y-e.y)>10){far={x:t.x,y:t.y};break;}if(far)break;}
    if(far)w.setPlayerPositionForTest(far.x,far.y);w.player.invuln=1e9;w.simFixture.player.invuln=1e9;
    const en=w.spawnEnemy(kind,e.x+1,e.y,room?.id??0,1);w.stepFrame(1000/60+1e-6,n,n);
    return {en:!!en,enKind:en?.data?.kind,enemies:w.enemies.map(x=>({kind:x.data.kind,state:x.data.state,targetActorKind:x.data.targetActorKind,targetId:x.data.targetId,x:x.x,y:x.y})),echo:{x:e.x,y:e.y,hp:e.data.hp},player:{x:w.playerX,y:w.playerY},targets:w.sim.targets.map(t=>({kind:t.kind,x:t.x,y:t.y,hp:t.hp}))};},kind);
  console.log('setup',kind,JSON.stringify(r));
  for(let i=0;i<10;i++){await page.waitForTimeout(400);const s=await page.evaluate(()=>{const gs=window.__game.scene.getScene('GameScene');const w=gs.world;return {hp:w.echoActor?.data.hp,en:w.enemies.map(x=>({kind:x.data.kind,state:x.data.state,tk:x.data.targetActorKind,tid:x.data.targetId,x:x.x,y:x.y})),proj:w.sim.projectiles.length,events:0};});console.log(i,kind,JSON.stringify(s));if(s.hp<100)break;}
}
await b.close();
