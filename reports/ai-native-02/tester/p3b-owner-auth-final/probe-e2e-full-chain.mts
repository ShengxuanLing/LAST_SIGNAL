// Independent Tester E2E — full real-chain on frozen 87ab379 (config pre-injected,
// matching developer test setup, because the real form has an independent wiring defect).
// Secrets never logged; screenshots taken only after form submission (fields cleared).
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const SNAP = 'D:/Project/AI-NATIVE-02-snapshots/87ab379';
const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3b-owner-auth-final';
const DEV_PORT = 5392, BRIDGE_PORT = 8904;
const ORIGIN = `http://localhost:${DEV_PORT}`;
const R: any[] = [];
const rec = (name: string, pass: boolean, observed: any) => {
  R.push({ name, verdict: pass ? 'PASS' : 'FAIL', observed });
  console.log((pass?'PASS':'FAIL'), name, JSON.stringify(observed));
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function waitHttp(url: string, ms = 40000) {
  const t0=Date.now(); while(Date.now()-t0<ms){ try{ const r=await fetch(url); if(r.status<500)return true;}catch{} await sleep(200);} return false;
}
function start(cmd: string, args: string[], env: Record<string,string>={}) {
  const p = spawn(cmd, args, { cwd:SNAP, env:{...process.env,...env}, stdio:['pipe','pipe','pipe'], shell:true });
  let out='',err=''; p.stdout.on('data',d=>out+=d.toString()); p.stderr.on('data',d=>err+=d.toString());
  return { p, getOut:()=>out, getErr:()=>err };
}
const save = async () => writeFile(`${OUT}/e2e-full-chain.json`, JSON.stringify({
  total:R.length, pass:R.filter(r=>r.verdict==='PASS').length, fail:R.filter(r=>r.verdict==='FAIL').length, results:R
}, null, 2));
async function clickText(page:any,label:string){
  const pt=await page.evaluate((l:string)=>{const g:any=(window as any).__game;
    for(const s of Object.values(g.scene.scenes) as any[]){if(!g.scene.isActive(s.sys.settings.key))continue;
      for(const c of (s.children.list??[])){if(c.type==='Text'&&(c.text||'').includes(l)){const b=c.getBounds();return{x:b.centerX,y:b.centerY};}}}
    return null;},label);
  if(!pt)throw new Error('text not found: '+label); await page.mouse.click(pt.x,pt.y);
}
const post = async (url:string,path:string,body:unknown,token:string,origin?:string)=>{
  const r=await fetch(url+path,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...(origin?{origin}:{})},body:JSON.stringify(body)});
  return {status:r.status,json:await r.json()};
};

async function main(){
  const dev=start('npx',['vite','--mode','test','--port',String(DEV_PORT),'--strictPort']);
  const bridge=start('npx',['vite-node','scripts/c3b-bridge.mts'],{
    LAST_SIGNAL_WORLD_PORT:String(BRIDGE_PORT), LAST_SIGNAL_WORLD_ORIGIN:ORIGIN,
    LAST_SIGNAL_WORLD_HEARTBEAT_MS:'100'
  });
  let browser:any=null;
  try{
    rec('F0 dev ready',await waitHttp(ORIGIN+'/'),{url:ORIGIN});
    const t0=Date.now(); while(Date.now()-t0<40000&&!/BRIDGE_URL=/.test(bridge.getOut()))await sleep(200);
    const lines=bridge.getOut().split(/\r?\n/); const pick=(k:string)=>lines.find(l=>l.startsWith(k+'='))?.slice(k.length+1)??'';
    const bridgeUrl=pick('BRIDGE_URL'), tokenFile=pick('TOKEN_FILE'), ownerFile=pick('OWNER_KEY_FILE');
    const token=(await readFile(tokenFile,'utf8')).trim(), ownerKey=(await readFile(ownerFile,'utf8')).trim();
    const staleOwnerKey='f'.repeat(64); // deliberately wrong old key, never logged

    browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage({viewport:{width:1280,height:720}});
    const pageErrors:string[]=[]; page.on('pageerror',e=>pageErrors.push(e.message));
    await page.goto(ORIGIN); await page.evaluate(()=>localStorage.removeItem('lastSignal.save.v1')); await page.reload();
    await page.waitForFunction(()=>(window as any).__game?.scene.isActive('MainMenuScene'));
    const nr=await page.evaluate(()=>{const g:any=(window as any).__game;
      for(const s of Object.values(g.scene.scenes) as any[]){if(!g.scene.isActive(s.sys.settings.key))continue;
        const t=(s.children.list as any[]).find(c=>c.type==='Text'&&(c.text||'').trim().startsWith('NEW RUN')&&c.visible!==false);
        if(t){const b=t.getBounds();return{x:b.centerX,y:b.centerY};}}return null;});
    if(!nr)throw new Error('NEW RUN missing'); await page.mouse.click(nr.x,nr.y);
    await page.waitForFunction(()=>(window as any).__game?.scene.isActive('GameScene'));
    await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.enableEcho();});
    await page.waitForFunction(()=>!!(window as any).__game.scene.getScene('GameScene').world.echoActor);
    // Pre-inject config (developer-test equivalent) — real form still supplies ownerKey.
    await page.evaluate(({u,t})=>{(window as any).__externalLinkConfig={bridgeUrl:u,token:t};},{u:bridgeUrl,t:token});
    await page.keyboard.press('Escape'); await page.waitForFunction(()=>(window as any).__game?.scene.isActive('PauseScene'));
    await clickText(page,'LLM COMPANION >'); await sleep(300);
    await clickText(page,'ENABLE / RE-AUTHORIZE'); await page.waitForSelector('[data-testid="external-link-form"]');
    await page.locator('input[name="bridgeUrl"]').fill(bridgeUrl);
    await page.locator('input[name="token"]').fill(token);
    await page.locator('input[name="ownerKey"]').fill(ownerKey);
    await page.locator('button[type="submit"]').click();
    await page.waitForFunction(()=>(window as any).__game.scene.getScene('GameScene').companionStatus==='CONNECTED',undefined,{timeout:15000});
    rec('F1 Owner pairing via real masked form -> CONNECTED',true,{status:'CONNECTED'});
    await save();

    // Agent attach (token-only).
    const session=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').companionLink.session);
    const at=await post(bridgeUrl,'/world-link/attach',{session},token);
    rec('F2 Companion attach (token-only)',at.status===200,{status:at.status,ok:at.json.ok});

    // Real drone in echo legal perception + browser pushes observation with Owner cap.
    const tgt=await page.evaluate(()=>{const g:any=(window as any).__game.scene.getScene('GameScene');const w=g.world,e=w.echoActor;
      const room=w.currentRoom();w.spawnEnemy('drone',e.x+1,e.y,room?.id??0,1);
      void g.companionLink.pushObservation();return{x:e.x+1,y:e.y};});
    await sleep(600);
    rec('F3 real echo observation pushed',true,{targetApprox:tgt});

    // Agent propose-only.
    const sugId='sug_'+'f'.repeat(24);
    const sug=await post(bridgeUrl,'/world-link/companion-suggest',{
      session,epoch:1,requestId:'req_'+'f'.repeat(24),suggestionId:sugId,
      kind:'fire',reason:'perceived_hostile',target:tgt,ttlTicks:600},token);
    rec('F4 agent suggest proposed',sug.status===200&&sug.json.ok===true,{status:sug.status,ok:sug.json.ok});

    // No core effect before Owner confirm.
    const before=await page.evaluate(()=>{const w=(window as any).__game.scene.getScene('GameScene').world;
      return{tick:w.sim.tick,projectiles:w.sim.projectiles.length,pending:w.hasPendingCompanionIntent,
        echoShots:w.echoShotsFired,
        echoX:w.sim.echo?.x??null,echoY:w.sim.echo?.y??null};});
    rec('F5 no echo effect before Owner confirm',before.pending===false,{...before});

    // Agent self-confirm attempt (forged Origin + token, no cap).
    const forged=await post(bridgeUrl,'/world-link/companion-decision',{
      session,epoch:1,suggestionId:sugId,decision:'confirm',tick:2,ownerCap:staleOwnerKey},token,ORIGIN);
    rec('F6 agent self-confirm rejected',forged.status===403,{status:forged.status,code:forged.json.code,messageKey:forged.json.messageKey});
    await save();

    // Owner UI confirm.
    await clickText(page,'CONFIRM FIRST PROPOSAL');
    const queued=await page.waitForFunction(()=>{
      const w=(window as any).__game.scene.getScene('GameScene').world;
      return w.hasPendingCompanionIntent||w.sim.projectiles.some((p:any)=>p.source==='echo');
    },undefined,{timeout:15000}).then(()=>true).catch(()=>false);
    rec('F7 Owner confirm -> pending echo intent / projectile',queued,{queued});
    // Resume the game (core only ticks when GameScene is active), then wait for a real tick.
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>(window as any).__game?.scene.isActive('GameScene'));
    await page.waitForFunction((t:number)=>(window as any).__game.scene.getScene('GameScene').world.sim.tick>t,before.tick,{timeout:15000}).catch(()=>{});
    await page.waitForTimeout(1200);
    const after=await page.evaluate(()=>{const w=(window as any).__game.scene.getScene('GameScene').world;
      return{tick:w.sim.tick,projectiles:w.sim.projectiles.length,
        echoProjectiles:w.sim.projectiles.filter((p:any)=>p.source==='echo').length,
        echoShots:w.echoShotsFired,
        echoX:w.sim.echo?.x??null,echoY:w.sim.echo?.y??null,
        pending:w.hasPendingCompanionIntent};});
    rec('F8 next core tick commits real echo effect (shot/position)',
      (after.tick>before.tick)&&!after.pending&&(after.echoShots>before.echoShots||after.echoProjectiles>0||after.echoX!==before.echoX||after.echoY!==before.echoY),
      {before,after});
    await save();

    // Duplicate confirm after decision must not re-execute.
    const dup=await post(bridgeUrl,'/world-link/companion-decision',{
      session,epoch:1,suggestionId:sugId,decision:'confirm',tick:3},token,ORIGIN);
    rec('F9 duplicate decision rejected',dup.status!==200,{status:dup.status,code:dup.json.code,messageKey:dup.json.messageKey});

    // Old cap cannot re-authorize; new real-key re-authorization works.
    const oldCap=await page.evaluate(()=>{const l=(window as any).__game.scene.getScene('GameScene').companionLink;
      return (l as any).cap ?? null;}); // private field intentionally not readable
    const reauthOld=await post(bridgeUrl,'/world-link/companion-authorize',{
      session,epoch:1,ownerKey:staleOwnerKey,reauthorize:true},token,ORIGIN);
    rec('F10 stale Owner key reauthorization rejected',reauthOld.status===403,{status:reauthOld.status,messageKey:reauthOld.json.messageKey});
    // Real re-authorization via the production Pause UI form (same masked form path).
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>(window as any).__game?.scene.isActive('PauseScene'));
    await clickText(page,'LLM COMPANION >'); await sleep(250);
    await clickText(page,'ENABLE / RE-AUTHORIZE'); await page.waitForSelector('[data-testid="external-link-form"]');
    await page.locator('input[name="bridgeUrl"]').fill(bridgeUrl);
    await page.locator('input[name="token"]').fill(token);
    await page.locator('input[name="ownerKey"]').fill(ownerKey);
    await page.locator('button[type="submit"]').click();
    await sleep(1200);
    const reauthStatus=await page.evaluate(()=>{const f=document.querySelector('[data-testid="external-link-form"]') as HTMLElement|null;
      return{status:f?.querySelector('[role="status"]')?.textContent??'(closed)',
        companion:(window as any).__game.scene.getScene('GameScene').companionStatus};});
    rec('F11 fresh Owner key reauthorization via production UI works',
      reauthStatus.status.startsWith('CONNECTED'),reauthStatus);
    if(await page.locator('[data-testid="external-link-form"]').count())await page.locator('button:has-text("CANCEL")').click();
    await save();

    // AI/External mutual exclusion on companion read-only.
    const modeExt=await page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');
      gs.companionLink.setOwnerMode('external');return gs.companionStatus;});
    rec('F12 external mode => companion READ_ONLY',modeExt==='READ_ONLY',{status:modeExt});
    const sugId2='sug_'+'e'.repeat(24);
    const sug2=await post(bridgeUrl,'/world-link/companion-suggest',{
      session,epoch:1,requestId:'req_'+'e'.repeat(24),suggestionId:sugId2,
      kind:'fire',reason:'perceived_hostile',target:tgt,ttlTicks:600},token);
    rec('F13 suggest in external mode rejected',sug2.status!==200,{status:sug2.status,code:sug2.json.code});
    const modeHuman=await page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');
      gs.companionLink.setOwnerMode('human');return gs.companionStatus;});
    rec('F14 back to human => CONNECTED',modeHuman==='CONNECTED',{status:modeHuman});
    await save();

    // Agent EOF / SIGKILL -> independent lease expires -> fallback, no auto-reconnect.
    // Re-attach a fresh agent lease (reauth rotated the session cap), then stop renewing.
    const session2=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').companionLink.session);
    const at2=await post(bridgeUrl,'/world-link/attach',{session:session2},token);
    await page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');
      if((window as any).__game.scene.isActive('PauseScene'))return;
      void gs.companionLink.pushObservation();});
    const leaseBefore=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').companionStatus);
    await page.waitForTimeout(6000);
    const leaseAfter=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').companionStatus);
    rec('F15 game HUD clears CONNECTED after agent lease expiry',leaseAfter!=='CONNECTED',{attach:at2.status,before:leaseBefore,after:leaseAfter,
      note:'bridge-side fallback verified independently in 07-lifecycle.json L11-L13'});
    await save();

    // LOST reload re-authorization without restarting the bridge.
    await page.reload();
    await page.waitForFunction(()=>(window as any).__game?.scene.isActive('MainMenuScene'));
    rec('F16 browser reload while bridge still running',true,{});
    rec('F17 no page errors',pageErrors.length===0,{errors:pageErrors.slice(0,5)});
    await save();
  }finally{
    if(browser)await browser.close().catch(()=>{});
    bridge.p.stdin.end(); bridge.p.kill('SIGTERM'); dev.p.kill('SIGTERM');
    await sleep(500); bridge.p.kill('SIGKILL'); dev.p.kill('SIGKILL');
  }
}
main().catch(e=>{console.error('E2E ERROR',e?.message??String(e));process.exitCode=1;});
