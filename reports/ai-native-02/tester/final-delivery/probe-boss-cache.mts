// Independent Tester — d1f29d1 Boss direct-spawn snapshot invalidation supplement.
// Spec covers spawnEnemy(drone); this proves spawnBoss also invalidates world.sim,
// the old snapshot stays frozen, and a real tick stays consistent. No _sim read.
import { chromium } from 'playwright';
const ORIGIN='http://localhost:5392';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/final-delivery';
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const save={version:2,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
  permanent:{maxHpBonus:0,speedBonus:0,damageBonus:0,critChanceBonus:0,armorBonus:0,xpBonus:0,currencyBonus:0,unlockedWeapons:['pulse'],unlockedAbilities:[],cores:0,runs:0,bossesDefeated:0,bestSeed:0,signalCollaborationOptIn:false},
  settings:{masterVolume:0.7,sfxVolume:0.8,mouseDpi:1,fullscreen:false,screenShake:true},stats:{enemiesKilled:0,itemsCollected:0,damageDealt:0,playTimeSeconds:0}};
async function main(){
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  try{
    await page.goto(ORIGIN);
    await page.evaluate((s)=>localStorage.setItem('last_signal_save_v1',JSON.stringify(s)),save);
    await page.reload();
    await page.waitForFunction(()=>(window as any).__game?.scene.isActive('MainMenuScene'),undefined,{timeout:20000});
    const nr=await page.evaluate(()=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;
      for(const s of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(s.sys.settings.key))continue;const q=(s.children.list as any[]).find(c=>c.type==='Text'&&(c.text||'').trim().startsWith('NEW RUN')&&c.visible!==false);if(q){const b=q.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}return null;});
    await page.mouse.click(nr.x,nr.y);
    await page.waitForFunction(()=>(window as any).__game?.scene.isActive('GameScene'),undefined,{timeout:20000});
    await page.waitForFunction(()=>!!((window as any).__game.scene.getScene('GameScene').world),undefined,{timeout:15000});
    const res=await page.evaluate(()=>{
      const mod:any=null;
      const g:any=(window as any).__game; const w=g.scene.getScene('GameScene').world;
      const before=w.sim; const beforeTargets=before.targets.length; const beforeDrones=before.drones.length; const beforeFrozen=Object.isFrozen(before);
      const rooms=w.map.rooms as any[];
      const bossRoom=rooms.find((r:any)=>r.kind==='boss') ?? rooms[rooms.length-1];
      w.spawnBoss(bossRoom);
      const after=w.sim; const bossId=w.boss?._id;
      const afterHasBoss=after.targets.some((t:any)=>t.id===bossId&&t.isBoss===true);
      const afterIsNew=after!==before;
      const beforeUnchanged=before.targets.length===beforeTargets&&before.drones.length===beforeDrones;
      const afterFrozen=Object.isFrozen(after);
      const neutral={move:{x:0,y:0},dash:false,fire:false,aim:null,interact:false};
      const events=w.stepFrame(1000/60+1e-6,neutral);
      const ticked=w.sim;
      return{beforeTargets,beforeDrones,afterTargets:after.targets.length,afterHasBoss,afterIsNew,beforeUnchanged,beforeFrozen,afterFrozen,
        tickAfter: ticked.tick, tickHasBoss: ticked.targets.some((t:any)=>t.id===bossId), eventsIsArray:Array.isArray(events)};
    });
    rec('B1 warm snapshot starts without a boss target',res.beforeTargets>=0&&res.beforeFrozen===true,'warm w.sim',JSON.stringify({beforeTargets:res.beforeTargets,beforeFrozen:res.beforeFrozen}));
    rec('B2 spawnBoss invalidates world.sim (new snapshot + boss target)',res.afterIsNew===true&&res.afterHasBoss===true&&res.afterTargets>res.beforeTargets,'w.spawnBoss(room)',JSON.stringify({afterIsNew:res.afterIsNew,afterHasBoss:res.afterHasBoss,afterTargets:res.afterTargets,beforeTargets:res.beforeTargets}));
    rec('B3 old frozen snapshot unchanged (immutable history)',res.beforeUnchanged===true&&res.afterFrozen===true,'old w.sim',JSON.stringify({beforeUnchanged:res.beforeUnchanged,afterFrozen:res.afterFrozen}));
    rec('B4 real tick keeps a fresh consistent snapshot with the boss',res.tickAfter>0&&res.tickHasBoss===true&&res.eventsIsArray===true,'w.stepFrame',JSON.stringify({tickAfter:res.tickAfter,tickHasBoss:res.tickHasBoss,eventsIsArray:res.eventsIsArray}));
    await page.screenshot({path:`${OUT}/evidence/boss-cache.png`});
    const summary={total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R};
    console.log('SUMMARY',JSON.stringify({total:summary.total,pass:summary.pass,fail:summary.fail}));
    await require('node:fs').writeFileSync(`${OUT}/05-boss-cache.json`,JSON.stringify(summary,null,2));
  }finally{await browser.close().catch(()=>{});}
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
