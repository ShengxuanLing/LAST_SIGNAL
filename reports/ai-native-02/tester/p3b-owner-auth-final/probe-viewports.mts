// Independent Tester — 5 viewports: masked form, no secret in DOM/global/logs/screenshots.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const SNAP='D:/Project/AI-NATIVE-02-snapshots/87ab379';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3b-owner-auth-final';
const DEV=5392, BR=8904, ORIGIN=`http://localhost:${DEV}`;
const R:any[]=[]; const rec=(n:string,p:boolean,o:any)=>{R.push({name:n,verdict:p?'PASS':'FAIL',observed:o});console.log(p?'PASS':'FAIL',n,JSON.stringify(o));};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function start(cmd:string,args:string[],env:Record<string,string>={}){const p=spawn(cmd,args,{cwd:SNAP,env:{...process.env,...env},stdio:['pipe','pipe','pipe'],shell:true});let o='',e='';p.stdout.on('data',d=>o+=d.toString());p.stderr.on('data',d=>e+=d.toString());return{p,out:()=>o,err:()=>e};}
async function waitHttp(u:string){const t=Date.now();while(Date.now()-t<40000){try{const r=await fetch(u);if(r.status<500)return true;}catch{}await sleep(200);}return false;}
async function clickText(page:any,l:string){const pt=await page.evaluate((s:string)=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;for(const sc of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(sc.sys.settings.key))continue;for(const c of(sc.children.list??[])){if(c.type==='Text'&&(c.text||'').includes(s)){const b=c.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}}return null;},l);if(!pt)throw new Error('missing '+l);await page.mouse.click(pt.x,pt.y);}

async function main(){
  const dev=start('npx',['vite','--mode','test','--port',String(DEV),'--strictPort']);
  const br=start('npx',['vite-node','scripts/c3b-bridge.mts'],{LAST_SIGNAL_WORLD_PORT:String(BR),LAST_SIGNAL_WORLD_ORIGIN:ORIGIN});
  let browser:any=null;
  try{
    rec('V0 dev ready',await waitHttp(ORIGIN+'/'),{});
    const t=Date.now();while(Date.now()-t<40000&&!/BRIDGE_URL=/.test(br.out()))await sleep(200);
    const lines=br.out().split(/\r?\n/),pick=(k:string)=>lines.find(l=>l.startsWith(k+'='))?.slice(k.length+1)??'';
    const bridgeUrl=pick('BRIDGE_URL'),token=(await readFile(pick('TOKEN_FILE'),'utf8')).trim(),ownerKey=(await readFile(pick('OWNER_KEY_FILE'),'utf8')).trim();
    browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const sizes=[{w:800,h:600},{w:1024,h:768},{w:1280,h:720},{w:1366,h:768},{w:1920,h:1080}];
    for(const sz of sizes){
      const page=await browser.newPage({viewport:{width:sz.w,height:sz.h}});
      const logs:string[]=[];page.on('console',m=>logs.push(m.text()));page.on('pageerror',e=>logs.push(e.message));
      await page.goto(ORIGIN);await page.evaluate(()=>localStorage.removeItem('lastSignal.save.v1'));await page.reload();
      await page.waitForFunction(()=>(window as any).__game?.scene.isActive('MainMenuScene'),undefined,{timeout:20000}).catch(async e=>{console.log('DBG mainmenu fail',await page.evaluate(()=>({g:!!(window as any).__game,keys:(window as any).__game?.scene?.scenes?.map((s:any)=>s.sys.settings.key),url:location.href})));throw e;});
      const nr=await page.evaluate(()=>{const g:any=(window as any).__game;for(const s of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(s.sys.settings.key))continue;const q=(s.children.list as any[]).find(c=>c.type==='Text'&&(c.text||'').trim().startsWith('NEW RUN')&&c.visible!==false);if(q){const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;const b=q.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}return null;});
      if(nr)await page.mouse.click(nr.x,nr.y);
      await page.waitForFunction(()=>(window as any).__game?.scene.isActive('GameScene'),undefined,{timeout:20000}).catch(async e=>{console.log('DBG game fail',await page.evaluate(()=>({active:(window as any).__game?.scene?.getScenes?.(true)?.map((s:any)=>s.scene.key)})));throw e;});
      await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.enableEcho();});
      await page.evaluate(({u,t})=>{(window as any).__externalLinkConfig={bridgeUrl:u,token:t};},{u:bridgeUrl,t:token});
      await page.keyboard.press('Escape');await page.waitForFunction(()=>(window as any).__game?.scene.isActive('PauseScene'),undefined,{timeout:20000}).catch(async e=>{console.log('DBG pause fail',await page.evaluate(()=>({active:(window as any).__game?.scene?.getScenes?.(true)?.map((s:any)=>s.scene.key)})));throw e;});
      await clickText(page,'LLM COMPANION >');await sleep(250);await clickText(page,'ENABLE / RE-AUTHORIZE');
      await page.waitForSelector('[data-testid="external-link-form"]');
      const shape=await page.evaluate(()=>{const f=document.querySelector('[data-testid="external-link-form"]') as HTMLElement;
        const panel=f.querySelector('form') as HTMLElement;const b=panel.getBoundingClientRect();
        const ins=[...f.querySelectorAll('input')].map(i=>({n:(i as HTMLInputElement).name,t:(i as HTMLInputElement).type}));
        return{w:Math.round(b.width),h:Math.round(b.height),left:Math.round(b.left),top:Math.round(b.top),ins,
          fits:b.left>=0&&b.top>=0&&b.right<=window.innerWidth+2&&b.bottom<=window.innerHeight+2};});
      rec(`V-${sz.w}x${sz.h} form rendered & fits`,shape.fits&&shape.ins.some(i=>i.n==='ownerKey'&&i.t==='password'),shape);
      await page.locator('input[name="bridgeUrl"]').fill(bridgeUrl);
      await page.locator('input[name="token"]').fill(token);
      await page.locator('input[name="ownerKey"]').fill(ownerKey);
      await page.locator('button[type="submit"]').click();await sleep(1200);
      const state=await page.evaluate(()=>{const f=document.querySelector('[data-testid="external-link-form"]') as HTMLFormElement|null;
        return{tokenVal:(f?.querySelector('input[name="token"]') as HTMLInputElement)?.value??'',
          keyVal:(f?.querySelector('input[name="ownerKey"]') as HTMLInputElement)?.value??'',
          globalKeys:(window as any).__externalLinkConfig?Object.keys((window as any).__externalLinkConfig):[],
          status:(window as any).__game.scene.getScene('GameScene').companionStatus};});
      const joined=logs.join('\n')+br.err()+br.out();
      rec(`V-${sz.w}x${sz.h} secrets absent from DOM/global/logs`,
        state.tokenVal===''&&state.keyVal===''&&!state.globalKeys.includes('ownerKey')&&!joined.includes(ownerKey)&&!joined.includes(token),
        {domCleared:state.tokenVal===''&&state.keyVal==='',globalKeys:state.globalKeys,logHit:joined.includes(ownerKey)||joined.includes(token),status:state.status});
      // Screenshot only AFTER secrets cleared from DOM.
      await page.screenshot({path:`${OUT}/evidence/viewport-${sz.w}x${sz.h}.png`});
      await page.close();
    }
    await writeFile(`${OUT}/08-viewports.json`,JSON.stringify({total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R},null,2));
  }finally{if(browser)await browser.close().catch(()=>{});br.p.stdin.end();br.p.kill('SIGTERM');dev.p.kill('SIGTERM');await sleep(500);br.p.kill('SIGKILL');dev.p.kill('SIGKILL');}
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
