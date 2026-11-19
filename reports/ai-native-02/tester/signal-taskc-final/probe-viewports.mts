// Independent Tester — 363eb17 five-viewport Signal HUD / two-account screenshot.
// Fresh browser context, dual-opt-in save (correct key), real NEW RUN + device.
import { chromium } from 'playwright';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/signal-taskc-final';
const ORIGIN='http://localhost:5392';
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const dualSave={version:2,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
  permanent:{maxHpBonus:0,speedBonus:0,damageBonus:0,critChanceBonus:0,armorBonus:0,xpBonus:0,currencyBonus:0,unlockedWeapons:['pulse','scatter'],unlockedAbilities:[],cores:0,runs:0,bossesDefeated:0,bestSeed:0,signalCollaborationOptIn:true},
  settings:{masterVolume:0.7,sfxVolume:0.8,mouseDpi:1,fullscreen:false,screenShake:true},stats:{enemiesKilled:0,itemsCollected:0,damageDealt:0,playTimeSeconds:0}};
async function newRun(page:any){
  await page.goto(ORIGIN);
  await page.evaluate((s)=>localStorage.setItem('last_signal_save_v1',JSON.stringify(s)),dualSave);
  await page.reload();
  await page.waitForFunction(()=>(window as any).__game?.scene.isActive('MainMenuScene'),undefined,{timeout:20000});
  const cv=await page.evaluate(()=>{const c=document.querySelector('canvas') as HTMLCanvasElement;const r=c.getBoundingClientRect();return{w:c.width,h:c.height,l:r.left,t:r.top,sx:r.width/c.width,sy:r.height/c.height};});
  const nr=await page.evaluate(()=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;
    for(const s of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(s.sys.settings.key))continue;const q=(s.children.list as any[]).find(c=>c.type==='Text'&&(c.text||'').trim().startsWith('NEW RUN')&&c.visible!==false);if(q){const b=q.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}return null;});
  await page.mouse.click(nr.x,nr.y);
  await page.waitForFunction(()=>(window as any).__game?.scene.isActive('GameScene'),undefined,{timeout:20000});
  await page.waitForFunction(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;const s:any=w?w.signalView():null;return s&&s.deviceId?s:null;},undefined,{timeout:15000});
}
async function main(){
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const sizes=[{w:800,h:600},{w:1024,h:768},{w:1280,h:720},{w:1366,h:768},{w:1920,h:1080}];
  try{
    for(const sz of sizes){
      const pg=await browser.newPage({viewport:{width:sz.w,height:sz.h}});
      await newRun(pg);
      // T scan -> player CD; Y jam is range-gated but player at device pos; capture two accounts
      await pg.keyboard.down('T');await sleep(80);await pg.keyboard.up('T');await sleep(200);
      const v=await pg.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene');const s=w.world.signalView();const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();return{hud:w.txtSignal?w.txtSignal.text:'',relay:s.relay,pE:s.playerEnergy,eE:s.echoEnergy,canvas:{x:rc.left,y:rc.top,w:rc.width,h:rc.height},win:{w:window.innerWidth,h:window.innerHeight}};});
      const hasBoth=/p:\d+/.test(v.hud)&&/e:\d+/.test(v.hud);
      const hasUnits=/playerScanCD:\d+t/.test(v.hud)&&/echoScanCD:\d+t/.test(v.hud);
      const hudFits=v.canvas.x>=0&&v.canvas.y>=0;
      rec(`V-${sz.w}x${sz.h} HUD two accounts + CD units visible`,hasBoth&&hasUnits&&hudFits,'real NEW RUN + T scan',JSON.stringify({hud:v.hud,pE:v.pE,eE:v.eE,canvas:v.canvas,win:v.win}));
      await pg.screenshot({path:`${OUT}/evidence/hud-${sz.w}x${sz.h}.png`});
      await pg.close();
    }
    await require('node:fs').writeFileSync(`${OUT}/11-viewports.json`,JSON.stringify({total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R},null,2));
  }finally{await browser.close().catch(()=>{});}
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
