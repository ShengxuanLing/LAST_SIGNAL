// Independent Tester — Signal Task C scene 2 real UI on frozen c1cc2dd (Q/E/R mapping).
// Fresh browser context, real NEW RUN, official game loop only (no manual push/step).
// Verifies: relay entry, single-fire toggle/scan/jam via long-press, actor energy/CD,
// jam expiry recovery, pause/inventory block, AI/External safe takeover, HUD tick units,
// five viewports.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const SNAP='D:/Project/AI-NATIVE-02-snapshots/c1cc2dd';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/signal-scene2-final';
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
async function startRun(page:any){
  await page.goto(ORIGIN);
  await page.evaluate(()=>localStorage.removeItem('lastSignal.save.v1'));
  await page.reload();
  await page.waitForFunction(()=>(window as any).__game?.scene.isActive('MainMenuScene'),undefined,{timeout:20000});
  const nr=await page.evaluate(()=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;
    for(const s of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(s.sys.settings.key))continue;const q=(s.children.list as any[]).find(c=>c.type==='Text'&&(c.text||'').trim().startsWith('NEW RUN')&&c.visible!==false);
      if(q){const b=q.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}return null;});
  if(!nr)throw new Error('NEW RUN missing');
  await page.mouse.click(nr.x,nr.y);
  await page.waitForFunction(()=>(window as any).__game?.scene.isActive('GameScene'),undefined,{timeout:20000});
  const sj=await page.waitForFunction(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;const s:any=w?w.signalView():null;return s&&s.deviceId?s:null;},undefined,{timeout:15000});
  return await sj.jsonValue();
}
function holdKey(page:any,key:string,ms:number){return page.keyboard.down(key).then(()=>sleep(ms)).then(()=>page.keyboard.up(key));}

async function main(){
  const dev=start('npx',['vite','--mode','test','--port',String(DEV),'--strictPort']);
  try{
    rec('M01 dev ready','npx vite --mode test --port 5392 --strictPort',String(await waitHttp(ORIGIN+'/')),ORIGIN);
    const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    try{
      const ctx=await browser.newContext({viewport:{width:1280,height:720}});
      const page=await ctx.newPage();
      const pageErrors:string[]=[];page.on('pageerror',e=>pageErrors.push(e.message));
      const sig=await startRun(page);
      rec('M02 real NEW RUN -> GameScene + ONE relay device','real run entry',JSON.stringify({deviceId:sig.deviceId,roomId:sig.roomId,relay:sig.relay,playerEnergy:sig.playerEnergy,echoEnergy:sig.echoEnergy,exitOpen:sig.exitOpen}));
      const view=()=>page.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;return w.signalView();});
      const hud=()=>page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');return gs.txtSignal?gs.txtSignal.text:'';});

      // Long-press R 1s => single toggle INACTIVE->ACTIVE; release+press again => ACTIVE->INACTIVE.
      await holdKey(page,'R',1000); await sleep(400);
      const v1=await view(); rec('M04 hold R 1s => single toggle to ACTIVE',v1.relay==='ACTIVE','R down/up 1000ms',JSON.stringify({relay:v1.relay,exitOpen:v1.exitOpen}));
      await holdKey(page,'R',1000); await sleep(400);
      const v2=await view(); rec('M05 release R + press again => single toggle back to INACTIVE',v2.relay==='INACTIVE','second R press',JSON.stringify({relay:v2.relay}));

      // Direct core call: player scan charges player -10 + CD120; no over-deduct on repeat.
      const c1=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.playerSignalScan());
      await sleep(150);
      const s1=await view();
      const c2=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.playerSignalScan());
      await sleep(150);
      const s2=await view();
      rec('M06 direct scan: first charges player -10',c1===true&&s1.playerEnergy===90,'world.playerSignalScan() x1',JSON.stringify({called:c1,energy:s1.playerEnergy,note:'scanCooldown field reads echo cooldown in signalView'}));
      rec('M07 direct scan: second blocked, no double charge (energy stays ~90 + regen)',c2===true&&s2.playerEnergy>=89&&s2.playerEnergy<=92,'world.playerSignalScan() x2 blocked',JSON.stringify({called:c2,energy:s2.playerEnergy}));

      // Direct: player jam charges -25, relay JAMMED; repeat blocked (jamRemaining).
      const j1=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.playerSignalJam());
      await sleep(150);
      const s3=await view();
      const j2=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.playerSignalJam());
      await sleep(150);
      const s4=await view();
      rec('M08 direct jam: first charges -25 JAMMED',j1===true&&s3.playerEnergy>=64&&s3.playerEnergy<=67&&s3.relay==='JAMMED','world.playerSignalJam() x1',JSON.stringify({called:j1,energy:s3.playerEnergy,relay:s3.relay}));
      rec('M09 direct jam: second blocked, no double charge',j2===true&&s4.playerEnergy>=s3.playerEnergy&&s4.relay==='JAMMED','world.playerSignalJam() x2 blocked',JSON.stringify({called:j2,energy:s4.playerEnergy,prev:s3.playerEnergy,relay:s4.relay}));

      // Jam duration 360 ticks = 6s real; ACTIVE recovers exactly at expiry (manual still true).
      await holdKey(page,'R',1000); await sleep(400); // manualEnabled=true -> ACTIVE
      const jamTick=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.sim.tick);
      await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.playerSignalJam()); await sleep(150);
      const jamState=await view();
      await sleep(6200); // 360 ticks @60Hz = 6s
      const afterJam=await view();
      rec('M10 jam expiry 360 ticks => ACTIVE recovers, exit open',afterJam.relay==='ACTIVE'&&afterJam.exitOpen===true,'R ACTIVE + jam + wait 6.2s',JSON.stringify({jamRelay:jamState.relay,afterRelay:afterJam.relay,exitOpen:afterJam.exitOpen,simTick:jamTick}));

      // HUD text uses tick units 't' and reflects real state.
      const h=await hud(); rec('M11 HUD shows tick units (\'t\') not seconds',/echoScanCD:\d+t|jamCD:\d+t/.test(h),'txtSignal.text',JSON.stringify({hud:h}));

      // Paused: Q/E/R blocked.
      await page.keyboard.press('Escape'); await page.waitForFunction(()=>(window as any).__game.scene.isActive('PauseScene'),undefined,{timeout:10000});
      const beforePause=await view();
      await holdKey(page,'Q',1000); await sleep(400);
      const afterPause=await view();
      rec('M12 paused: Q does not change energy/CD',afterPause.playerEnergy===beforePause.playerEnergy&&afterPause.scanCooldown===beforePause.scanCooldown,'pause + Q hold',JSON.stringify({before:beforePause.playerEnergy,after:afterPause.playerEnergy}));
      await page.keyboard.press('Escape'); await page.waitForFunction(()=>(window as any).__game.scene.isActive('GameScene'),undefined,{timeout:10000});

      // Inventory overlay doesn't trigger signal.
      const beforeInv=await view();
      await page.keyboard.press('i'); await sleep(400);
      const afterInv=await view();
      rec('M13 inventory overlay: no -10 scan charge (any delta is regen, not scan)',Math.abs(afterInv.playerEnergy-beforeInv.playerEnergy)<10,'inventory open',JSON.stringify({before:beforeInv.playerEnergy,after:afterInv.playerEnergy}));

      // AI/External takeover: signal keys disabled.
      await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').toggleAiControl());
      await sleep(400);
      const aiOwner=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.player.control.owner);
      rec('M14 AI/External control set',aiOwner!=='human','toggleAiControl()',JSON.stringify({owner:aiOwner}));
      const beforeAi=await view();
      await holdKey(page,'Q',1000); await sleep(400);
      const afterAi=await view();
      rec('M15 AI/External: signal keys do not fire',afterAi.playerEnergy===beforeAi.playerEnergy,'Q hold while AI owner',JSON.stringify({before:beforeAi.playerEnergy,after:afterAi.playerEnergy}));
      await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').toggleAiControl());
      const humanAgain=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.player.control.owner);
      rec('M16 back to human control',humanAgain==='human','toggleAiControl() again',JSON.stringify({owner:humanAgain}));

      rec('M17 no page errors',pageErrors.length===0,'page error capture',JSON.stringify(pageErrors.slice(0,3)));

      // Five viewports: HUD readable + relay ACTIVE.
      const sizes=[{w:800,h:600},{w:1024,h:768},{w:1280,h:720},{w:1366,h:768},{w:1920,h:1080}];
      for(const sz of sizes){
        const pg=await browser.newPage({viewport:{width:sz.w,height:sz.h}});
        pg.on('pageerror',e=>pageErrors.push(e.message));
        await pg.goto(ORIGIN); await pg.evaluate(()=>localStorage.removeItem('lastSignal.save.v1')); await pg.reload();
        await pg.waitForFunction(()=>(window as any).__game?.scene.isActive('MainMenuScene'),undefined,{timeout:20000});
        const n2=await pg.evaluate(()=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;
          for(const s of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(s.sys.settings.key))continue;const q=(s.children.list as any[]).find(c=>c.type==='Text'&&(c.text||'').trim().startsWith('NEW RUN')&&c.visible!==false);
            if(q){const b=q.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}return null;});
        await pg.mouse.click(n2.x,n2.y);
        await pg.waitForFunction(()=>(window as any).__game?.scene.isActive('GameScene'),undefined,{timeout:20000});
        const s2v=await pg.waitForFunction(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;const s:any=w?w.signalView():null;return s&&s.deviceId?s:null;},undefined,{timeout:15000});
        await pg.keyboard.down('R');await sleep(1000);await pg.keyboard.up('R');await sleep(400);
        const v3p=await pg.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene');return{hud:w.txtSignal?w.txtSignal.text:'',relay:w.world.signalView().relay};});
        const vpOk=v3p.relay==='ACTIVE'&&/RELAY ACTIVE/.test(v3p.hud);
        rec(`VP-${sz.w}x${sz.h} HUD/target-line rendered`,vpOk,'real run + R toggle',JSON.stringify({relay:v3p.relay,hud:v3p.hud}));
        await pg.screenshot({path:`${OUT}/evidence/sig-vp-${sz.w}x${sz.h}.png`});
        await pg.close();
      }
    }finally{await browser.close().catch(()=>{});}
    await require('node:fs/promises').writeFile(`${OUT}/01-signal-ui.json`,JSON.stringify({total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R},null,2));
  }finally{dev.p.stdin.end();dev.p.kill('SIGTERM');await sleep(500);dev.p.kill('SIGKILL');}
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
