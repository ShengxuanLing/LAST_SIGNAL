// Independent Tester — 7c0068f deterministic NOTIFY-RACE probe:
// Delay the renderer's /world-link/companion-room by N ms and try to Owner-confirm
// the held old-room suggestion INSIDE that window. If it still reaches core, the
// cancel is not atomic w.r.t. the room commit — report promptly.
import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorldGateway } from 'D:/Project/AI-NATIVE-02-snapshots/7c0068f/src/ai-native/worldGateway.ts';
import { startWorldBridge } from 'D:/Project/AI-NATIVE-02-snapshots/7c0068f/src/ai-native/worldBridgeServer.ts';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from 'D:/Project/AI-NATIVE-02-snapshots/7c0068f/src/ai-native/ownerAuthFixture.ts';

const SNAP='D:/Project/AI-NATIVE-02-snapshots/7c0068f';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/companion-room-cancel-final';
const ORIGIN='http://localhost:5392';
const TOKEN=randomBytes(24).toString('hex');
const COMPANION_SERVER=resolve(SNAP,'dist-mcp/companionMcpServer.mjs');
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const dualSave={version:2,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
  permanent:{maxHpBonus:0,speedBonus:0,damageBonus:0,critChanceBonus:0,armorBonus:0,xpBonus:0,currencyBonus:0,unlockedWeapons:['pulse'],unlockedAbilities:[],cores:0,runs:0,bossesDefeated:0,bestSeed:0,signalCollaborationOptIn:true},
  settings:{masterVolume:0.7,sfxVolume:0.8,mouseDpi:1,fullscreen:false,screenShake:true},stats:{enemiesKilled:0,itemsCollected:0,damageDealt:0,playTimeSeconds:0}};
async function clickText(page:any,l:string){
  const pt=await page.evaluate((s:string)=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;
    function find(list:any[]):any{for(const c of list){if(!c)continue;if(c.type==='Text'&&(c.text||'').includes(s)){const b=c.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}if(c.list&&Array.isArray(c.list)){const f=find(c.list);if(f)return f;}}return null;}
    const s2=g.scene.getScene('PauseScene');return s2?find(s2.children.list):null;},l);
  if(!pt)throw new Error('missing text '+l);await page.mouse.click(pt.x,pt.y);
}
async function boot(page:any){
  await page.goto(ORIGIN);
  await page.evaluate((s)=>localStorage.setItem('last_signal_save_v1',JSON.stringify(s)),dualSave);
  await page.reload();
  await page.waitForFunction(()=>(window as any).__game?.scene.isActive('MainMenuScene'),undefined,{timeout:20000});
  const nr=await page.evaluate(()=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;
    for(const s of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(s.sys.settings.key))continue;const q=(s.children.list as any[]).find(c=>c.type==='Text'&&(c.text||'').trim().startsWith('NEW RUN')&&c.visible!==false);if(q){const b=q.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}return null;});
  await page.mouse.click(nr.x,nr.y);
  await page.waitForFunction(()=>(window as any).__game?.scene.isActive('GameScene'),undefined,{timeout:20000});
  await page.waitForFunction(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;const s:any=w?w.signalView():null;return s&&s.deviceId?s:null;},undefined,{timeout:15000});
}
const tool=(c:any,name:string,args:any={})=>c.callTool({name,arguments:args}).then((r:any)=>({ok:r.isError!==true&&(r.structuredContent as any)?.ok!==false,...(r.structuredContent as any)}));

async function main(){
  const gateway=new WorldGateway();
  const bridge=await startWorldBridge({gateway,token:TOKEN,ownerKeyHash:TEST_OWNER_KEY_HASH,allowedOrigins:[ORIGIN],heartbeatIntervalMs:1000});
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  const DELAY_MS=4000;
  try{
    await boot(page);
    await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.enableEcho();});
    await page.waitForFunction(()=>!!((window as any).__game.scene.getScene('GameScene').world.echoActor),undefined,{timeout:15000});
    await page.keyboard.press('Escape');await page.waitForFunction(()=>(window as any).__game.scene.isActive('PauseScene'),undefined,{timeout:10000});
    await clickText(page,'LLM COMPANION >');await sleep(300);await clickText(page,'ENABLE / RE-AUTHORIZE');
    await page.waitForSelector('[data-testid="external-link-form"] input[name="ownerKey"]',{timeout:10000});
    await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]',bridge.url);
    await page.fill('[data-testid="external-link-form"] input[name="token"]',TOKEN);
    await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]',TEST_OWNER_KEY);
    await page.click('[data-testid="external-link-form"] button[type="submit"]');
    await page.waitForFunction(()=>(window as any).__game.scene.getScene('GameScene').companionStatus==='CONNECTED',undefined,{timeout:15000});
    await page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');const w=gs.world;const e=w.echoActor;const room=w.currentRoom();w.spawnEnemy('drone',e.x+1,e.y,room?.id??0,1);void gs.companionLink.pushObservation();});
    await sleep(600);
    const transport=new StdioClientTransport({command:process.execPath,args:[COMPANION_SERVER],env:{...process.env,LAST_SIGNAL_WORLD_BRIDGE_URL:bridge.url,LAST_SIGNAL_WORLD_TOKEN:TOKEN},stderr:'pipe'});
    const sdk=new Client({name:'raced',version:'0.0.0'}); await sdk.connect(transport);
    const obs=await tool(sdk,'echo_observe');
    const id='sug_'+randomBytes(12).toString('hex');
    const sug=await tool(sdk,'echo_suggest',{requestId:'req_'+randomBytes(12).toString('hex'),suggestionId:id,kind:'fire',reason:'perceived_hostile',target:{x:(obs.observation?.echo?.x??0)+1,y:obs.observation?.echo?.y??0},ttlTicks:600});
    rec('R01 seed unconfirmed suggestion',sug.ok===true,'sdk echo_suggest',JSON.stringify({ok:sug.ok}));
    const heldOld=await page.evaluate((id:string)=>(window as any).__game.scene.getScene('GameScene').companionLink.pending().then((l:any[])=>l.find((p:any)=>p.suggestionId===id)??null),id);
    rec('R02 Owner link holds old object',!!heldOld,'companionLink.pending','ok');
    const roomA=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.currentRoomId);
    // Install the delay on the renderer's room-cancel route ONLY
    let notifySent=0;
    await page.route('**/world-link/companion-room', async (route:any)=>{ notifySent++; await sleep(DELAY_MS); await route.continue(); });
    // open gate (fixture) + portal
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!(window as any).__game?.scene.isActive('PauseScene'),undefined,{timeout:10000});
    await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.toggleRelay(true);});
    await page.waitForFunction(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;return w.sim.signal&&w.sim.signal.relay==='ACTIVE';},undefined,{timeout:15000});
    await page.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;w.player.reset(w.portal.wx,w.portal.wy);});
    await sleep(400);
    await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.player.requestInteract();});
    await page.waitForFunction((prev:number)=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;return w.currentRoomId!==prev&&w.currentRoomId>=0;},roomA,{timeout:25000});
    const roomB=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.currentRoomId);
    rec('R03 portal committed (notify now delayed in flight)',roomB!==roomA&&notifySent>0,'portal interact',JSON.stringify({roomA,roomB,notifySent}));
    // INSIDE the window: try to confirm the old object while room-cancel is still in flight
    const inWindow=await page.evaluate(async(old:any)=>{const gs:any=(window as any).__game.scene.getScene('GameScene');const before=gs.world.hasPendingCompanionIntent;const ok=await gs.companionLink.decide(old,'confirm');return{ok,error:gs.companionLink.error,pending:gs.world.hasPendingCompanionIntent,before};},heldOld);
    await sleep(800);
    const snapAfterWindow=await page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');const w=gs.world;return{echoShots:gs.echoShotsFired,echoProj:w.sim.projectiles.filter((p:any)=>p.source==='echo').length,pendingIntent:w.hasPendingCompanionIntent,echoEnergy:w.sim.signal?w.sim.signal.actors.echo.energy.energy:-1};});
    const raced = inWindow.ok===true;
    rec('R04 RACE: old confirm inside notify-delay window',!raced,'companionLink.decide(old) inside '+DELAY_MS+'ms window',JSON.stringify({inWindow,snapAfterWindow,raced}));
    // wait for the delayed cancel to land, then old confirm must be refused
    await sleep(DELAY_MS+1500);
    const afterNotify=await page.evaluate(async(old:any)=>{const gs:any=(window as any).__game.scene.getScene('GameScene');const ok=await gs.companionLink.decide(old,'confirm');return{ok,error:gs.companionLink.error};},heldOld);
    const st=await tool(sdk,'echo_status');
    const recOld=(st.receipts??[]).find((r:any)=>r.suggestionId===id);
    rec('R05 after notify lands: old confirm refused; status cancelled',afterNotify.ok===false&&String(afterNotify.error).includes('E_STALE_GENERATION')&&recOld?.status==='cancelled','companionLink.decide(old) after notify',JSON.stringify({afterNotify,receipt:recOld}));
    await page.screenshot({path:`${OUT}/evidence/notify-race.png`});
    await require('node:fs').writeFileSync(`${OUT}/13-notify-race.json`,JSON.stringify({total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R,detail:{delayMs:DELAY_MS,roomA,roomB,notifySent,inWindow,snapAfterWindow,raced,afterNotify,recOld}},null,2));
    console.log('SUMMARY',JSON.stringify({total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length}));
    await sdk.close(); await transport.close();
  }finally{ await browser.close().catch(()=>{}); await bridge.close(); }
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
