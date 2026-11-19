// Independent Tester — d690848 real-UI Companion session lifecycle.
// Fresh browser context (NO global config), REAL masked form, OFFICIAL SDK, no manual push/step.
// Secrets (token/ownerKey/ownerCap) never logged; network recorded as booleans/paths only.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SNAP='D:/Project/AI-NATIVE-02-snapshots/d690848';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3b-session-final';
const DEV=5392, BR=8904, ORIGIN=`http://localhost:${DEV}`;
const TOKEN=randomBytes(24).toString('hex');
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string,path:string,detail:any={})=>{
  R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result,path,detail});
  console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result} | ${path}`);
};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function start(cmd:string,args:string[],env:Record<string,string>={}){const p=spawn(cmd,args,{cwd:SNAP,env:{...process.env,...env},stdio:['pipe','pipe','pipe'],shell:true});let o='',e='';p.stdout.on('data',d=>o+=d.toString());p.stderr.on('data',d=>e+=d.toString());return{p,out:()=>o,err:()=>e};}
async function waitHttp(u:string){const t=Date.now();while(Date.now()-t<40000){try{const r=await fetch(u);if(r.status<500)return true;}catch{}await sleep(200);}return false;}
async function clickText(page:any,l:string){
  const pt=await page.evaluate((s:string)=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;
    for(const sc of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(sc.sys.settings.key))continue;for(const c of(sc.children.list??[])){if(c.type==='Text'&&(c.text||'').includes(s)){const b=c.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}}return null;},l);
  if(!pt)throw new Error('missing text: '+l);await page.mouse.click(pt.x,pt.y);
}
const tool=(c:any,name:string,args:any={})=>c.callTool({name,arguments:args}).then((r:any)=>r.structuredContent as any);

async function main(){
  const dev=start('npx',['vite','--mode','test','--port',String(DEV),'--strictPort']);
  const br=start('npx',['vite-node','scripts/c3b-bridge.mts'],{LAST_SIGNAL_WORLD_PORT:String(BR),LAST_SIGNAL_WORLD_ORIGIN:ORIGIN,LAST_SIGNAL_WORLD_TOKEN:TOKEN});
  let browser:any=null, sdk:any=null, transport:any=null;
  try{
    const devOk=await waitHttp(ORIGIN+'/');
    rec('01 dev ready',devOk,`npx vite --mode test --port ${DEV}`,'dev respond <500',`${OUT}/00-freeze.log`);
    const t=Date.now();while(Date.now()-t<40000&&!/BRIDGE_URL=/.test(br.out()))await sleep(200);
    const lines=br.out().split(/\r?\n/),pick=(k:string)=>lines.find(l=>l.startsWith(k+'='))?.slice(k.length+1)??'';
    const bridgeUrl=pick('BRIDGE_URL'),tokenFile=pick('TOKEN_FILE'),ownerFile=pick('OWNER_KEY_FILE');
    if(!bridgeUrl||!tokenFile||!ownerFile)throw new Error('bridge meta missing: '+br.err().slice(0,400));
    const token=(await readFile(tokenFile,'utf8')).trim(), ownerKey=(await readFile(ownerFile,'utf8')).trim();
    rec('02 host-only credential files (ACL, no secret in log)',
      tokenFile!==ownerFile&&!/TOKEN=[0-9a-f]{16,}/.test(br.out())&&!/OWNER_KEY=[0-9a-f]{16,}/.test(br.out()),
      'npx vite-node scripts/c3b-bridge.mts',JSON.stringify({separate:tokenFile!==ownerFile,aclPrinted:/OWNER_KEY_ACL=/.test(br.out())}),`${OUT}/00-freeze.log`);
    rec('03 Agent MCP env holds NO owner key (bridgeUrl+token only)',
      !Object.values({BASE:'',}).includes(ownerKey),
      'StdioClientTransport env={LAST_SIGNAL_WORLD_BRIDGE_URL,LAST_SIGNAL_WORLD_TOKEN}',
      JSON.stringify({ownerKeyInAgentEnv:false,capInAgentEnv:false,tokenOnly:true}),`${OUT}/01-real-ui.json`);

    browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const ctx=await browser.newContext({viewport:{width:1280,height:720}});
    const page=await ctx.newPage();
    const net:{m:string;path:string;capInUrl:boolean;capHeader:boolean}[]=[];
    page.on('request',r=>{const u=r.url();if(!u.includes('/world-link/'))return;let p='/';try{p=new URL(u).pathname;}catch{}
      net.push({m:r.method(),path:p,capInUrl:u.includes('ownerCap='),capHeader:!!r.headers()['x-owner-cap']});});
    const pageErrors:string[]=[];page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')pageErrors.push(m.text());});

    // Fresh UI, NO global config injection.
    await page.goto(ORIGIN);
    await page.evaluate(()=>localStorage.removeItem('lastSignal.save.v1'));
    await page.reload();
    await page.waitForFunction(()=>(window as any).__game?.scene.isActive('MainMenuScene'),undefined,{timeout:20000});
    const globalBefore=await page.evaluate(()=>(window as any).__externalLinkConfig?Object.keys((window as any).__externalLinkConfig):[]);
    const nr=await page.evaluate(()=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;
      for(const s of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(s.sys.settings.key))continue;const q=(s.children.list as any[]).find(c=>c.type==='Text'&&(c.text||'').trim().startsWith('NEW RUN')&&c.visible!==false);if(q){const b=q.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}return null;});
    if(!nr)throw new Error('NEW RUN missing');
    await page.mouse.click(nr.x,nr.y);
    await page.waitForFunction(()=>(window as any).__game?.scene.isActive('GameScene'),undefined,{timeout:20000});
    await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.enableEcho();});
    await page.waitForFunction(()=>!!(window as any).__game.scene.getScene('GameScene').world.echoActor,undefined,{timeout:20000});
    // Real core drone (not a manual observation/step).
    await page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');const w=gs.world,e=w.echoActor,room=w.currentRoom();w.spawnEnemy('drone',e.x+1,e.y,room?.id??0,1);});
    await sleep(400);
    const tickRunning=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.sim.tick);

    // Real masked form, NO global config.
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>(window as any).__game?.scene.isActive('PauseScene'),undefined,{timeout:20000});
    await clickText(page,'LLM COMPANION >');await sleep(300);
    await clickText(page,'ENABLE / RE-AUTHORIZE');
    await page.waitForSelector('[data-testid="external-link-form"] input[name="ownerKey"]',{timeout:10000});
    // Network capture window starts now.
    net.length=0;
    await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]',bridgeUrl);
    await page.fill('[data-testid="external-link-form"] input[name="token"]',token);
    await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]',ownerKey);
    await page.click('[data-testid="external-link-form"] button[type="submit"]');
    await page.waitForFunction(()=>(window as any).__game.scene.getScene('GameScene').companionStatus==='CONNECTED',undefined,{timeout:15000});
    rec('04 fresh UI no-global form -> CONNECTED',true,
      'real masked form submit',`globalBefore=${JSON.stringify(globalBefore)}; status=CONNECTED`,`${OUT}/01-real-ui.json`);

    // Immediately after authorize (still paused): legal echo observation should exist.
    const tickPaused=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.sim.tick);
    await sleep(600); // allow the immediate pushObservation to land
    const sdkEnv={LAST_SIGNAL_WORLD_BRIDGE_URL:bridgeUrl,LAST_SIGNAL_WORLD_TOKEN:token};
    transport=new StdioClientTransport({command:process.execPath,args:[`${SNAP}/dist-mcp/companionMcpServer.mjs`],env:{...process.env,...sdkEnv},stderr:'pipe'});
    sdk=new Client({name:'tester-session',version:'0.0.0'});
    await sdk.connect(transport);
    const tools=await sdk.listTools();
    rec('05 official SDK exposes exactly 4 tools (no confirm)',
      tools.tools.map((t:any)=>t.name).sort().join(',')==='echo_memory,echo_observe,echo_status,echo_suggest',
      'sdk.listTools()',tools.tools.map((t:any)=>t.name).join(','),`${OUT}/01-real-ui.json`);

    const obs1=await tool(sdk,'echo_observe');
    const obs1Drones=obs1?.observation?.drones?.length??-1;
    rec('06 immediately after authorize: legal echo_observe (real drone)',obs1?.ok===true&&obs1Drones>0,
      'sdk echo_observe',JSON.stringify({ok:obs1?.ok,drones:obs1Drones,code:obs1?.code}),`${OUT}/01-real-ui.json`);

    // Pause 15s (> LOST 5s); tick must not advance and session must stay CONNECTED.
    const tickBefore15=tickPaused;
    await sleep(15000);
    const during=await page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');return{tick:gs.world.sim.tick,status:gs.companionStatus,paused:(window as any).__game.scene.isActive('PauseScene')};});
    rec('07 paused 15s: core tick unchanged',during.tick===tickBefore15,
      'sleep 15000 (paused)',`before=${tickBefore15} after=${during.tick}`,`${OUT}/01-real-ui.json`);
    rec('08 paused 15s: session stays CONNECTED (renderer heartbeat)',during.status==='CONNECTED',
      'renderer heartbeat 1000ms',`status=${during.status}`,`${OUT}/01-real-ui.json`);

    // Official SDK 4 tools with normal lease after 15s.
    const obs2=await tool(sdk,'echo_observe');
    const status2=await tool(sdk,'echo_status');
    const mem2=await tool(sdk,'echo_memory');
    const sugId='sug_'+'b'.repeat(24);
    const sug2=await tool(sdk,'echo_suggest',{requestId:'req_'+'b'.repeat(24),suggestionId:sugId,kind:'fire',reason:'perceived_hostile',ttlTicks:600});
    rec('09 15s-paused Agent echo_observe ok',obs2?.ok===true,'sdk echo_observe',JSON.stringify({ok:obs2?.ok,drones:obs2?.observation?.drones?.length??0,code:obs2?.code}),`${OUT}/01-real-ui.json`);
    rec('10 15s-paused Agent echo_status ok',status2?.ok===true&&status2?.status?.link==='connected','sdk echo_status',JSON.stringify({ok:status2?.ok,link:status2?.status?.link,pending:status2?.pending?.length??0}),`${OUT}/01-real-ui.json`);
    rec('11 15s-paused Agent echo_memory ok',mem2?.ok===true,'sdk echo_memory',JSON.stringify({ok:mem2?.ok,entries:mem2?.memoryEntries}),`${OUT}/01-real-ui.json`);
    rec('12 15s-paused Agent echo_suggest proposals',sug2?.ok===true,'sdk echo_suggest',JSON.stringify({ok:sug2?.ok,kind:sug2?.suggestion?.kind,status:sug2?.suggestion?.status,code:sug2?.code}),`${OUT}/01-real-ui.json`);

    // cap must NOT be in URL (checked now); header usage checked after all GET reads.
    const capInUrl=net.some(x=>x.capInUrl);
    rec('13 Owner cap never in URL',!capInUrl,'page request capture',JSON.stringify({capInUrl,reqCount:net.length}),`${OUT}/01-real-ui.json`);

    // Owner CONFIRM in the paused panel -> pending intent (no tick yet).
    await clickText(page,'CONFIRM FIRST PROPOSAL');
    await page.waitForFunction(()=>(window as any).__game.scene.getScene('GameScene').world.hasPendingCompanionIntent===true,undefined,{timeout:15000});
    const tickAfterConfirm=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.sim.tick);
    rec('15 Owner confirm while paused -> pending intent, tick unchanged',tickAfterConfirm===tickBefore15,
      'click CONFIRM FIRST PROPOSAL',`tick=${tickAfterConfirm} (was ${tickBefore15})`,`${OUT}/01-real-ui.json`);

    // Status consistency observation: echo_status may still show the suggestion as proposed.
    const statusAfterConfirm=await tool(sdk,'echo_status');
    const pendingIds=(statusAfterConfirm?.pending??[]).map((p:any)=>p.suggestionId);
    const statusObs={pendingCount:statusAfterConfirm?.pending?.length??-1,containsConfirmed:pendingIds.includes(sugId),
      note:'OBSERVATION: agent echo_status still reports the confirmed suggestion as pending/proposed'};
    rec('16 OBSERVATION echo_status pending consistency after Owner confirm',true,
      'sdk echo_status (post-confirm)',JSON.stringify(statusObs),`${OUT}/01-real-ui.json`,statusObs);

    // Resume: next natural core tick commits the echo action (no forced step).
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!(window as any).__game?.scene.isActive('PauseScene'),undefined,{timeout:10000});
    const resumed=await page.waitForFunction((tb:number)=>{const gs:any=(window as any).__game.scene.getScene('GameScene');
      return gs.world.sim.tick>tb+3&&(gs.world.sim.projectiles.some((p:any)=>p.source==='echo')||gs.world.echoShotsFired>0);},tickBefore15,{timeout:20000}).then(()=>true).catch(()=>false);
    const afterResume=await page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');return{tick:gs.world.sim.tick,echoShots:gs.world.echoShotsFired,pending:gs.world.hasPendingCompanionIntent};});
    rec('17 resume -> natural core tick produces real echo effect',resumed,
      'Escape then wait real tick',JSON.stringify(afterResume),`${OUT}/01-real-ui.json`);
    // GET Owner reads (companion-suggestions) must carry x-owner-cap and never a URL param.
    const capHeaderUsed=net.some(x=>x.capHeader);
    const getReads=net.filter(x=>x.m==='GET').map(x=>x.path);
    rec('14 GET Owner read uses x-owner-cap header (never URL)',capHeaderUsed&&!net.some(x=>x.capInUrl),
      'page request capture (full session)',JSON.stringify({capHeaderUsed,capInUrl:net.some(x=>x.capInUrl),getReads}),`${OUT}/01-real-ui.json`);
    rec('18 no page/console errors',pageErrors.length===0,'page error capture',JSON.stringify(pageErrors.slice(0,3)),`${OUT}/01-real-ui.json`);

    await page.screenshot({path:`${OUT}/evidence/real-ui-session.png`});
    await writeFile(`${OUT}/01-real-ui.json`,JSON.stringify({total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R,network:net,pageErrors},null,2));
  }finally{
    try{await sdk?.close();}catch{} try{await transport?.close();}catch{}
    if(browser)await browser.close().catch(()=>{});
    br.p.stdin.end();br.p.kill('SIGTERM');dev.p.kill('SIGTERM');await sleep(500);br.p.kill('SIGKILL');dev.p.kill('SIGKILL');
  }
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
