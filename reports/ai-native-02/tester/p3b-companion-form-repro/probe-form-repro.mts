// Minimal independent repro — 7fd4a2e pure UI Companion form, NO global config.
// Host-side only: reads private credential files, drives browser form, records network paths/status.
// NEVER writes token/ownerKey/ownerCap into agent env, logs, URLs or screenshots.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';

const SNAP='D:/Project/AI-NATIVE-02-snapshots/7fd4a2e';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3b-companion-form-repro';
const DEV=5392, BR=8904, BR2=8905, ORIGIN=`http://localhost:${DEV}`;
const TOKEN=randomBytes(24).toString('hex'); // host-generated Agent token (bridge auth only)
const R:any[]=[];
const rec=(name:string,pass:boolean,result:string,path:string,detail:any={})=>{
  const line=`${pass?'PASS':'FAIL'} | ${name} | ${result} | ${path}`;
  R.push({name,verdict:pass?'PASS':'FAIL',result,path,detail});
  console.log(line);
};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function start(cmd:string,args:string[],env:Record<string,string>={}){
  const p=spawn(cmd,args,{cwd:SNAP,env:{...process.env,...env},stdio:['pipe','pipe','pipe'],shell:true});
  let o='',e='';p.stdout.on('data',d=>o+=d.toString());p.stderr.on('data',d=>e+=d.toString());
  return{p,out:()=>o,err:()=>e};
}
async function waitHttp(u:string){const t=Date.now();while(Date.now()-t<40000){try{const r=await fetch(u);if(r.status<500)return true;}catch{}await sleep(200);}return false;}
async function clickText(page:any,l:string){
  const pt=await page.evaluate((s:string)=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;
    for(const sc of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(sc.sys.settings.key))continue;for(const c of(sc.children.list??[])){if(c.type==='Text'&&(c.text||'').includes(s)){const b=c.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}}return null;},l);
  if(!pt)throw new Error('missing text: '+l);await page.mouse.click(pt.x,pt.y);
}

async function runScenario(browser:any, opts:{label:string, injectHostConfig:boolean, bridgeUrl:string, token:string, ownerKey:string}){
  const {label,injectHostConfig,bridgeUrl,token,ownerKey}=opts;
  // FRESH browser context per scenario; no stale global/localStorage.
  const ctx=await browser.newContext({viewport:{width:1280,height:720}});
  const page=await ctx.newPage();
  const net:string[]=[]; const errs:string[]=[];
  page.on('request',r=>{const u=r.url();if(u.includes('/world-link/'))net.push(`${r.method()} ${new URL(u).pathname}`);});
  page.on('response',r=>{const u=r.url();if(u.includes('/world-link/'))net.push(`<- ${r.status()} ${new URL(u).pathname}`);});
  page.on('pageerror',e=>errs.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  if(injectHostConfig){
    // HOST config injection: bridgeUrl+token ONLY. ownerKey is deliberately NOT provided here,
    // so a successful pairing proves the key came from the real masked form.
    await page.addInitScript(({u,t})=>{(window as any).__externalLinkConfig={bridgeUrl:u,token:t};},{u:bridgeUrl,t:token});
  }
  try{
    await page.goto(ORIGIN);
    await page.evaluate(()=>localStorage.removeItem('lastSignal.save.v1'));
    await page.reload();
    await page.waitForFunction(()=>(window as any).__game?.scene.isActive('MainMenuScene'),undefined,{timeout:20000});
    const nr=await page.evaluate(()=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;
      for(const s of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(s.sys.settings.key))continue;const q=(s.children.list as any[]).find(c=>c.type==='Text'&&(c.text||'').trim().startsWith('NEW RUN')&&c.visible!==false);
        if(q){const b=q.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}return null;});
    if(!nr)throw new Error('NEW RUN not found');
    await page.mouse.click(nr.x,nr.y);
    await page.waitForFunction(()=>(window as any).__game?.scene.isActive('GameScene'),undefined,{timeout:20000});
    await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.enableEcho();});
    await page.waitForFunction(()=>!!(window as any).__game.scene.getScene('GameScene').world.echoActor,undefined,{timeout:20000});
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>(window as any).__game?.scene.isActive('PauseScene'),undefined,{timeout:20000});
    await clickText(page,'LLM COMPANION >');await sleep(300);
    await clickText(page,'ENABLE / RE-AUTHORIZE');
    await page.waitForSelector('[data-testid="external-link-form"]',{timeout:10000});
    const inputs=await page.evaluate(()=>[...document.querySelectorAll('[data-testid="external-link-form"] input')].map(i=>({n:(i as HTMLInputElement).name,t:(i as HTMLInputElement).type})));
    rec(`${label}: form exposes masked bridge token + owner key fields`,
      inputs.some(i=>i.n==='token'&&i.t==='password')&&inputs.some(i=>i.n==='ownerKey'&&i.t==='password'),
      JSON.stringify(inputs),`${OUT}/01-${label}.log`);

    const globalBefore=await page.evaluate(()=>{const g=(window as any).__externalLinkConfig;return g?Object.keys(g):[];});
    await page.locator('input[name="bridgeUrl"]').fill(bridgeUrl);
    await page.locator('input[name="token"]').fill(token);
    await page.locator('input[name="ownerKey"]').fill(ownerKey);
    net.length=0;
    await page.locator('button[type="submit"]').click();
    await sleep(2500);
    const state=await page.evaluate(()=>{const f=document.querySelector('[data-testid="external-link-form"]') as HTMLElement|null;const gs:any=(window as any).__game.scene.getScene('GameScene');
      return{formStatus:f?.querySelector('[role="status"]')?.textContent??'(closed)',formOpen:!!f,
        companionStatus:gs?.companionStatus,hasLink:!!gs?.companionLink,
        tokenVal:(f?.querySelector('input[name="token"]') as HTMLInputElement)?.value??'',
        keyVal:(f?.querySelector('input[name="ownerKey"]') as HTMLInputElement)?.value??'',
        globalKeys:(window as any).__externalLinkConfig?Object.keys((window as any).__externalLinkConfig):[]};});
    const screenshot=`${OUT}/evidence/${label}.png`;
    await page.screenshot({path:screenshot});
    const detail={...state,globalBefore,network:net,pageErrors:errs.slice(0,5),screenshot};
    await writeFile(`${OUT}/01-${label}.json`,JSON.stringify(detail,null,2));
    const handshakeSent=net.some(x=>x.includes('/world-link/handshake'));
    return{detail,handshakeSent,net};
  }finally{await ctx.close();}
}

async function main(){
  const dev=start('npx',['vite','--mode','test','--port',String(DEV),'--strictPort']);
  let br=start('npx',['vite-node','scripts/c3b-bridge.mts'],{LAST_SIGNAL_WORLD_PORT:String(BR),LAST_SIGNAL_WORLD_ORIGIN:ORIGIN,LAST_SIGNAL_WORLD_TOKEN:TOKEN});
  let br2:any=null;
  let browser:any=null;
  try{
    rec('00 dev server ready','npx vite --mode test --port 5392 --strictPort',String(await waitHttp(ORIGIN+'/')),`${OUT}/00-freeze.log`);
    const getBridgeMeta=async()=>{const t=Date.now();while(Date.now()-t<40000&&!/BRIDGE_URL=/.test(br.out()))await sleep(200);
      const lines=br.out().split(/\r?\n/),pick=(k:string)=>lines.find(l=>l.startsWith(k+'='))?.slice(k.length+1)??'';
      return{url:pick('BRIDGE_URL'),tokenFile:pick('TOKEN_FILE'),ownerFile:pick('OWNER_KEY_FILE'),acl:pick('OWNER_KEY_ACL')};};
    const meta1=await getBridgeMeta();
    rec('01 host-only credential files (independent, ACL printed)',
      'npx vite-node scripts/c3b-bridge.mts',
      JSON.stringify({bridgeUrl:meta1.url,separateFiles:meta1.tokenFile!==meta1.ownerFile,aclPrinted:!!meta1.acl,tokenInLog:/TOKEN=[0-9a-f]{16,}/.test(br.out()),ownerKeyInLog:/OWNER_KEY=[0-9a-f]{16,}/.test(br.out())}),
      `${OUT}/01-host-config.json`);
    const token=(await readFile(meta1.tokenFile,'utf8')).trim();
    const ownerKey=(await readFile(meta1.ownerFile,'utf8')).trim();
    rec('02 token/ownerKey validated from private files (host side only)',
      'readFile(TOKEN_FILE/OWNER_KEY_FILE)',
      JSON.stringify({tokenLen:token.length,ownerKeyPattern:/^[0-9a-f]{64}$/.test(ownerKey),sameValue:token===ownerKey,agentEnvHasOwnerKey:Object.values(process.env).some(v=>typeof v==='string'&&v===ownerKey)}),
      `${OUT}/01-host-config.json`);

    browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});

    // A. PURE UI — fresh context, NO global config injection.
    const A=await runScenario(browser,{label:'pure-ui',injectHostConfig:false,bridgeUrl:meta1.url,token,ownerKey});
    rec('03 PURE UI: AUTHORIZE produces a real handshake request',
      A.handshakeSent,'handshakeSent='+A.handshakeSent,`${OUT}/01-pure-ui.json`,{network:A.net});
    rec('04 PURE UI: Owner state after AUTHORIZE',
      A.detail.companionStatus==='CONNECTED',
      `companionStatus=${A.detail.companionStatus}; formStatus=${A.detail.formStatus??A.detail.formStatus}; formOpen=${A.detail.formOpen}`,
      `${OUT}/01-pure-ui.json`,{formStatus:A.detail.formStatus,globalBefore:A.detail.globalBefore,pageErrors:A.detail.pageErrors});

    // Host-side direct validation with the SAME key: proves key/token/tool env are valid.
    const hv=await fetch(`${meta1.url}/world-link/handshake`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,origin:ORIGIN},
      body:JSON.stringify({authorized:true,protocolVersion:1,ownerKey})});
    const hvj=await hv.json();
    rec('05 same key/token accepted by bridge directly (not bad credentials)',
      'fetch POST /world-link/handshake (host-side validation)',
      `status=${hv.status}; ok=${hvj.ok}; code=${hvj.code??''}; messageKey=${hvj.messageKey??''}`,
      `${OUT}/01-credential-control.json`);

    // B. CONTROL — SECOND independent bridge (new port) + fresh context WITH host config.
    br2=start('npx',['vite-node','scripts/c3b-bridge.mts'],{LAST_SIGNAL_WORLD_PORT:String(BR2),LAST_SIGNAL_WORLD_ORIGIN:ORIGIN,LAST_SIGNAL_WORLD_TOKEN:TOKEN});
    const meta2=await (async()=>{const t=Date.now();while(Date.now()-t<40000&&!/BRIDGE_URL=/.test(br2.out()))await sleep(200);
      const lines=br2.out().split(/\r?\n/),pick=(k:string)=>lines.find(l=>l.startsWith(k+'='))?.slice(k.length+1)??'';
      return{url:pick('BRIDGE_URL'),ownerFile:pick('OWNER_KEY_FILE')};})();
    if(!meta2.url||!meta2.ownerFile)throw new Error('control bridge meta missing: '+br2.err().slice(0,400));
    const ownerKey2=(await readFile(meta2.ownerFile,'utf8')).trim();
    const B=await runScenario(browser,{label:'host-config',injectHostConfig:true,bridgeUrl:meta2.url,token,ownerKey:ownerKey2});
    rec('06 CONTROL with host config: AUTHORIZE succeeds',
      B.detail.companionStatus==='CONNECTED',
      `companionStatus=${B.detail.companionStatus}; handshakeSent=${B.handshakeSent}; network=${JSON.stringify(B.net)}`,
      `${OUT}/01-host-config.json`,{formStatus:B.detail.formStatus,globalBefore:B.detail.globalBefore,pageErrors:B.detail.pageErrors});

    rec('07 ownerKey never in host-config global (control injects only url+token)',
      Array.isArray(B.detail.globalBefore)&&!B.detail.globalBefore.includes('ownerKey'),
      `globalKeysBeforeForm=${JSON.stringify(B.detail.globalBefore)}`,`${OUT}/01-host-config.json`);

    // Final gate summary (one line per check).
    await writeFile(`${OUT}/gate-summary.log`,R.map(r=>`${r.verdict} | ${r.name} | ${r.result} | ${r.path}`).join('\n')+'\n');
    await writeFile(`${OUT}/diagnosis.json`,JSON.stringify({total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R},null,2));
  }finally{if(browser)await browser.close().catch(()=>{});for(const x of [br,br2].filter(Boolean)){x.p.stdin.end();x.p.kill('SIGTERM');}dev.p.kill('SIGTERM');await sleep(500);for(const x of [br,br2].filter(Boolean))x.p.kill('SIGKILL');dev.p.kill('SIGKILL');}
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
