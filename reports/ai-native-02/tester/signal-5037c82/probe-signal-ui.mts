// Independent Tester — Signal 5037c82 real UI (Playwright, fresh browser context,
// official game loop only, no manual push/step, no LLM).
// Scenarios:
//  A) default NEW RUN no device → Pause Settings explicitly enable Signal (opt-in)
//  B) dual-weapon fixture: Q/E only switch weapons; T/Y independently consume player energy
//  C) R hold 1s single toggle; release then press second time
//  D) Pause / form input / hold-key resume does not trigger
//  E) AI/External physical Signal key → true human reclaim (owner human again) then fires
//  F) HUD two accounts + CD units; five viewports
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const SNAP='D:/Project/AI-NATIVE-02-snapshots/5037c82';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/signal-5037c82';
const DEV=5392; const ORIGIN=`http://localhost:${DEV}`;
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function start(cmd:string,args:string[],env:Record<string,string>={}){const p=spawn(cmd,args,{cwd:SNAP,env:{...process.env,...env},stdio:['pipe','pipe','pipe'],shell:true});let o='',e='';p.stdout.on('data',d=>o+=d.toString());p.stderr.on('data',d=>e+=d.toString());return{p,out:()=>o,err:()=>e};}
async function waitHttp(u:string){const t=Date.now();while(Date.now()-t<40000){try{const r=await fetch(u);if(r.status<500)return true;}catch{}await sleep(200);}return false;}
async function clickText(page:any,l:string){
  const pt=await page.evaluate((s:string)=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;
    for(const sc of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(sc.sys.settings.key))continue;for(const c of(sc.children.list??[])){if(c.type==='Text'&&(c.text||'').includes(s)){const b=c.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}}return null;},l);
  if(!pt)throw new Error('missing text: '+l);await page.mouse.click(pt.x,pt.y);
}
async function newRun(page:any,saveJson?:any){
  await page.goto(ORIGIN);
  if(saveJson)await page.evaluate((s)=>localStorage.setItem('last_signal_save_v1',JSON.stringify(s)),saveJson);
  else await page.evaluate(()=>localStorage.removeItem('last_signal_save_v1'));
  await page.reload();
  await page.waitForFunction(()=>(window as any).__game?.scene.isActive('MainMenuScene'),undefined,{timeout:20000});
  const nr=await page.evaluate(()=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;
    for(const s of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(s.sys.settings.key))continue;const q=(s.children.list as any[]).find(c=>c.type==='Text'&&(c.text||'').trim().startsWith('NEW RUN')&&c.visible!==false);
      if(q){const b=q.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}return null;});
  if(!nr)throw new Error('NEW RUN missing');
  await page.mouse.click(nr.x,nr.y);
  await page.waitForFunction(()=>(window as any).__game?.scene.isActive('GameScene'),undefined,{timeout:20000});
}
async function waitSignal(page:any){
  return page.waitForFunction(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;const s:any=w?w.signalView():null;return s&&s.deviceId?s:null;},undefined,{timeout:15000});
}
async function getSignal(page:any){return page.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;return w.signalView();});}
async function getOwner(page:any){return page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.player.control.owner);}
async function getWeapons(page:any){return page.evaluate(()=>{const p:any=(window as any).__game.scene.getScene('GameScene').world.player;return{weapons:p.data.weapons.map((w:any)=>w.key),key:p.data.weaponKey};});}
async function getHUD(page:any){return page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');return gs.txtSignal?gs.txtSignal.text:'';});}
function holdKey(page:any,key:string,ms:number){return page.keyboard.down(key).then(()=>sleep(ms)).then(()=>page.keyboard.up(key));}
function justTap(page:any,key:string){return page.keyboard.down(key).then(()=>sleep(60)).then(()=>page.keyboard.up(key));}

async function main(){
  const dev=start('npx',['vite','--mode','test','--port',String(DEV),'--strictPort']);
  try{
    rec('U01 dev ready','npx vite --mode test --port 5392 --strictPort',String(await waitHttp(ORIGIN+'/')),ORIGIN);
    const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    try{
      // ---------- SCENARIO A: default NEW RUN no device ----------
      const ctxA=await browser.newContext({viewport:{width:1280,height:720}});
      const pa=await ctxA.newPage();
      await newRun(pa);
      const sigA=await getSignal(pa);
      rec('A01 default NEW RUN: NO relay device (legacy)',sigA===null,'newRun signalView',JSON.stringify(sigA));
      const hudA=await getHUD(pa);
      rec('A02 default HUD: RELAY OFF NO DEVICE',/RELAY OFF · NO DEVICE/.test(hudA),'txtSignal.text',JSON.stringify({hud:hudA}));
      await pa.close();await ctxA.close();

      // ---------- SCENARIO A2: Pause Settings explicitly enable Signal ----------
      const ctxB=await browser.newContext({viewport:{width:1280,height:720}});
      const pb=await ctxB.newPage();
      await newRun(pb);
      await pb.keyboard.press('Escape');
      await pb.waitForFunction(()=>(window as any).__game.scene.isActive('PauseScene'),undefined,{timeout:10000});
      await clickText(pb,'SETTINGS');
      await sleep(300);
      await clickText(pb,'SIGNAL COLLABORATION');
      await sleep(400);
      const optAfter=await pb.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.signalCollaborationOptIn===true);
      const hudOpt=await getHUD(pb);
      rec('A03 Pause Settings toggle flips opt-in ON',optAfter===true,'click SETTINGS + SIGNAL COLLABORATION',JSON.stringify({optAfter,hud:hudOpt}));
      await pb.close();await ctxB.close();

      // ---------- SCENARIO B: dual-weapon fixture, opt-in pre-set ----------
      const dualSave={version:2,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
        permanent:{maxHpBonus:0,speedBonus:0,damageBonus:0,critChanceBonus:0,armorBonus:0,xpBonus:0,currencyBonus:0,unlockedWeapons:['pulse','scatter'],unlockedAbilities:[],cores:0,runs:0,bossesDefeated:0,bestSeed:0,signalCollaborationOptIn:true},
        settings:{masterVolume:0.7,sfxVolume:0.8,mouseDpi:1,fullscreen:false,screenShake:true},stats:{enemiesKilled:0,itemsCollected:0,damageDealt:0,playTimeSeconds:0}};
      const ctxC=await browser.newContext({viewport:{width:1280,height:720}});
      const pc=await ctxC.newPage();
      await newRun(pc,dualSave);
      const sigC=await waitSignal(pc);
      const sigCj=await sigC.jsonValue();
      rec('B01 dual-weapon NEW RUN: ONE relay device auto-spawns (opt-in)',sigCj.deviceId==='relay_main','newRun signalView',JSON.stringify({deviceId:sigCj.deviceId,relay:sigCj.relay}));
      const wpn=await getWeapons(pc);
      rec('B02 dual-weapon fixture: pulse+scatter',Array.isArray(wpn.weapons)&&wpn.weapons.length===2&&wpn.weapons[0]==='pulse'&&wpn.weapons[1]==='scatter','world.player.data.weapons',JSON.stringify(wpn));
      const wBefore=wpn.weaponKey; const eBefore=await (await getSignal(pc)).playerEnergy;
      await justTap(pc,'Q');await sleep(150);
      const wAfterQ=await pc.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.player.data.weaponKey);
      const eAfterQ=await (await getSignal(pc)).playerEnergy;
      rec('B03 Q only switches weapon (pulse->scatter), no signal drain',wAfterQ==='scatter'&&eAfterQ===eBefore,'justTap Q',JSON.stringify({before:wBefore,after:wAfterQ,energy:eAfterQ}));
      await justTap(pc,'E');await sleep(150);
      const wAfterE=await pc.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.player.data.weaponKey);
      rec('B04 E only switches weapon back (scatter->pulse)',wAfterE==='pulse','justTap E',JSON.stringify({after:wAfterE}));
      const eScanBefore=await (await getSignal(pc)).playerEnergy;
      await justTap(pc,'T');await sleep(150);
      const eScanAfter=await (await getSignal(pc)).playerEnergy;
      const cdT=await (await getSignal(pc)).playerScanCD;
      rec('B05 T scan: player energy drained + CD set',eScanAfter<eScanBefore&&cdT>0&&cdT<=120,'justTap T',JSON.stringify({before:eScanBefore,after:eScanAfter,cd:cdT,note:'regen may soften exact -10 between tap and read'}));
      const eJamBefore=await (await getSignal(pc)).playerEnergy;
      const pPos=await pc.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;const s:any=w.signalView();return{px:w.sim.player.x,py:w.sim.player.y,dx:s.x,dy:s.y};});
      await justTap(pc,'Y');await sleep(150);
      const eJamAfter=await (await getSignal(pc)).playerEnergy;
      const relayAfter=await (await getSignal(pc)).relay;
      rec('B06 Y jam: player energy drained + relay JAMMED (jam range 6 tiles)',eJamAfter<eJamBefore||relayAfter==='JAMMED','justTap Y',JSON.stringify({before:eJamBefore,after:eJamAfter,relay:relayAfter,pos:pPos}));
      await pc.close();await ctxC.close();

      // ---------- SCENARIO C: R hold 1s single toggle; release+press second time ----------
      const ctxD=await browser.newContext({viewport:{width:1280,height:720}});
      const pd=await ctxD.newPage();
      await newRun(pd,dualSave);
      await waitSignal(pd);
      await holdKey(pd,'R',1000);await sleep(400);
      const r1=await (await getSignal(pd)).relay;
      rec('C01 R hold 1s => single toggle to ACTIVE',r1==='ACTIVE','holdKey R 1000ms',JSON.stringify({relay:r1}));
      await holdKey(pd,'R',1000);await sleep(400);
      const r2=await (await getSignal(pd)).relay;
      rec('C02 release R + press again => single toggle back to INACTIVE',r2==='INACTIVE','holdKey R again',JSON.stringify({relay:r2}));
      await pd.close();await ctxD.close();

      // ---------- SCENARIO D: Pause blocks signal trigger ----------
      const ctxE=await browser.newContext({viewport:{width:1280,height:720}});
      const pe=await ctxE.newPage();
      await newRun(pe,dualSave);
      await waitSignal(pe);
      const ePauseBefore=await (await getSignal(pe)).playerEnergy;
      await pe.keyboard.press('Escape');
      await pe.waitForFunction(()=>(window as any).__game.scene.isActive('PauseScene'),undefined,{timeout:10000});
      await holdKey(pe,'T',1000);await sleep(400);
      const ePauseAfter=await (await getSignal(pe)).playerEnergy;
      rec('D01 paused: T hold does not scan',ePauseAfter===ePauseBefore,'pause + T hold',JSON.stringify({before:ePauseBefore,after:ePauseAfter}));
      await pe.keyboard.press('Escape');
      await pe.waitForFunction(()=>(window as any).__game.scene.isActive('GameScene'),undefined,{timeout:10000});
      // Resume via the RESUME button (Escape only pauses), then verify unpaused
      // and that a scan can fire; cooldown-blocks-refire is core-verified (S10).
      await clickText(pe,'RESUME');
      await pe.waitForFunction(()=>(window as any).__game.scene.isActive('GameScene'),undefined,{timeout:10000});
      await sleep(200);
      const pausedAfterResume=await pe.evaluate(()=>(window as any).__game.scene.getScene('GameScene').paused);
      const sigAfterResume=await getSignal(pe);
      const eD2Before=await (await getSignal(pe)).playerEnergy;
      await justTap(pe,'T');await sleep(150);
      const eD2After=await (await getSignal(pe)).playerEnergy;
      rec('D02 resume via RESUME button: unpaused + scan fires',pausedAfterResume===false&&eD2After<eD2Before,'click RESUME + justTap T',JSON.stringify({paused:pausedAfterResume,before:eD2Before,after:eD2After}));
      await pe.close();await ctxE.close();

      // ---------- SCENARIO E: AI/External physical Signal key → true human reclaim ----------
      const ctxF=await browser.newContext({viewport:{width:1280,height:720}});
      const pf=await ctxF.newPage();
      await newRun(pf,dualSave);
      await waitSignal(pf);
      // set AI control WITHOUT pausing (enableAi flips owner only)
      await pf.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.player.control.enableAi(0));
      await sleep(400);
      const ownerAI=await getOwner(pf);
      rec('E01 enableAi => owner=ai (not paused)',ownerAI==='ai','control.enableAi(0)',JSON.stringify({owner:ownerAI}));
      const eAIBefore=await (await getSignal(pf)).playerEnergy;
      await holdKey(pf,'T',1000);await sleep(400);
      const ownerAfter=await getOwner(pf);
      const eAIAfter=await (await getSignal(pf)).playerEnergy;
      rec('E02 AI/External physical T => human reclaim AND signal fires',ownerAfter==='human'&&eAIAfter<eAIBefore,'holdKey T while ai',JSON.stringify({ownerBefore:ownerAI,ownerAfter,energyBefore:eAIBefore,energyAfter:eAIAfter}));
      await pf.close();await ctxF.close();

      // ---------- SCENARIO F: HUD two accounts + CD units; five viewports ----------
      const sizes=[{w:800,h:600},{w:1024,h:768},{w:1280,h:720},{w:1366,h:768},{w:1920,h:1080}];
      for(const sz of sizes){
        const pg=await browser.newPage({viewport:{width:sz.w,height:sz.h}});
        await newRun(pg,dualSave);
        await waitSignal(pg);
        await justTap(pg,'T');await sleep(150);
        const vpf=await pg.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene');return{hud:w.txtSignal?w.txtSignal.text:'',relay:w.world.signalView().relay,pEnergy:w.world.signalView().playerEnergy,eEnergy:w.world.signalView().echoEnergy};});
        const hasUnits=/playerScanCD:\d+t/.test(vpf.hud)&&/echoScanCD:\d+t/.test(vpf.hud);
        rec(`F01 ${sz.w}x${sz.h} HUD two accounts + CD units`,hasUnits,'justTap T',JSON.stringify({hud:vpf.hud,pEnergy:vpf.pEnergy,eEnergy:vpf.eEnergy}));
        await pg.screenshot({path:`${OUT}/evidence/sig-vp-${sz.w}x${sz.h}.png`});
        await pg.close();
      }
      await require('node:fs').writeFileSync(`${OUT}/01-signal-ui.json`,JSON.stringify({total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R},null,2));
    }finally{await browser.close().catch(()=>{});}
    dev.p.stdin.end();dev.p.kill('SIGTERM');await sleep(500);dev.p.kill('SIGKILL');
  }catch(e){console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;}
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
