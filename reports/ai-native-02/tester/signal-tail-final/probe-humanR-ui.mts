// Independent Tester — real-UI human R cross-room control comparison.
// boot opt-in run -> device in room A -> R makes ACTIVE -> real portal to B ->
// press R again in room B -> did the global device still toggle?
import { chromium } from 'playwright';
const ORIGIN='http://localhost:5392';
const OUT=process.env.OUTDIR as string;
const TAG=process.env.SNAPTAG as string;
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const save={version:2,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
  permanent:{maxHpBonus:0,speedBonus:0,damageBonus:0,critChanceBonus:0,armorBonus:0,xpBonus:0,currencyBonus:0,unlockedWeapons:['pulse'],unlockedAbilities:[],cores:0,runs:0,bossesDefeated:0,bestSeed:0,signalCollaborationOptIn:true},
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
    await page.waitForFunction(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;const s:any=w?w.signalView():null;return s&&s.deviceId?s:null;},undefined,{timeout:15000});
    const read=()=>page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');const w=gs.world;const s=w.signalView();return{roomId:w.currentRoomId,relay:s.relay,exitOpen:s.exitOpen,manualEnabled:s.manualEnabled,deviceRoom:s.roomId,hud:gs.txtSignal?gs.txtSignal.text:''};});
    // R -> ACTIVE (human R in room A)
    await page.keyboard.down('R');await sleep(120);await page.keyboard.up('R');await sleep(400);
    const v1=await read();
    rec(`${TAG}-U1 human R in room A makes relay ACTIVE`,v1.relay==='ACTIVE','R hold 120ms',JSON.stringify({relay:v1.relay,roomId:v1.roomId,deviceRoom:v1.deviceRoom}));
    // real portal to room B (fixture: stand on portal)
    const roomA=v1.roomId;
    await page.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;w.player.reset(w.portal.wx,w.portal.wy);});
    await sleep(500);
    await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.player.requestInteract();});
    await page.waitForFunction((prev:number)=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;return w.currentRoomId!==prev&&w.currentRoomId>=0;},roomA,{timeout:25000});
    const v2=await read();
    rec(`${TAG}-U2 real portal A->B (device stays in A)`,v2.roomId!==roomA&&v2.deviceRoom===roomA,'portal interact',JSON.stringify({roomA,roomB:v2.roomId,deviceRoom:v2.deviceRoom,relay:v2.relay}));
    // FRESH human R in room B (device in old room A)
    const before=await read();
    await page.keyboard.down('R');await sleep(120);await page.keyboard.up('R');await sleep(500);
    const after=await read();
    const toggled = after.relay!==before.relay;
    rec(`${TAG}-U3 human R in room B (device in old room A): ${toggled?'APPLIED (global control preserved)':'REJECTED (no change)'}`,
      true,'R hold 120ms in room B',JSON.stringify({before:{relay:before.relay,exitOpen:before.exitOpen},after:{relay:after.relay,exitOpen:after.exitOpen},toggled}));
    await page.screenshot({path:`${OUT}/evidence/humanR-${TAG}.png`});
    const summary={tag:TAG,total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R};
    console.log('SUMMARY',JSON.stringify({tag:TAG,total:summary.total,pass:summary.pass,fail:summary.fail}));
    await require('node:fs').writeFileSync(`${OUT}/humanR-ui-${TAG}.json`,JSON.stringify(summary,null,2));
  }finally{await browser.close().catch(()=>{});}
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
