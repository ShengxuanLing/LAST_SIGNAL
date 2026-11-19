// Independent Tester — 246469b cross-room unconfirmed Companion suggestion negative.
// Question: an unconfirmed suggestion seeded in room A, then a REAL portal transition
// to room B — does the product invalidate it (epoch/cancel/TTL), or can it mis-execute
// with stale room-A coordinates after the gate?
import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorldGateway } from 'D:/Project/AI-NATIVE-02-snapshots/246469b/src/ai-native/worldGateway.ts';
import { startWorldBridge } from 'D:/Project/AI-NATIVE-02-snapshots/246469b/src/ai-native/worldBridgeServer.ts';
import { TEST_OWNER_KEY, TEST_OWNER_KEY_HASH } from 'D:/Project/AI-NATIVE-02-snapshots/246469b/src/ai-native/ownerAuthFixture.ts';

const SNAP='D:/Project/AI-NATIVE-02-snapshots/246469b';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/signal-field-fix';
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
    return find(g.scene.getScene('PauseScene').children.list);},l);
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
const tool=(c:any,name:string,args:any={})=>c.callTool({name,arguments:args}).then((r:any)=>r.structuredContent as any);

async function main(){
  const gateway=new WorldGateway();
  const bridge=await startWorldBridge({gateway,token:TOKEN,ownerKeyHash:TEST_OWNER_KEY_HASH,allowedOrigins:[ORIGIN],heartbeatIntervalMs:1000});
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  let sdk:any=null,transport:any=null;
  try{
    await boot(page);
    await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.enableEcho();});
    await page.waitForFunction(()=>!!((window as any).__game.scene.getScene('GameScene').world.echoActor),undefined,{timeout:15000});
    // Authorize companion via real masked form
    await page.keyboard.press('Escape');await page.waitForFunction(()=>(window as any).__game.scene.isActive('PauseScene'),undefined,{timeout:10000});
    await clickText(page,'LLM COMPANION >');await sleep(300);
    await clickText(page,'ENABLE / RE-AUTHORIZE');
    await page.waitForSelector('[data-testid="external-link-form"] input[name="ownerKey"]',{timeout:10000});
    await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]',bridge.url);
    await page.fill('[data-testid="external-link-form"] input[name="token"]',TOKEN);
    await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]',TEST_OWNER_KEY);
    await page.click('[data-testid="external-link-form"] button[type="submit"]');
    await page.waitForFunction(()=>(window as any).__game.scene.getScene('GameScene').companionStatus==='CONNECTED',undefined,{timeout:15000});
    rec('X01 companion CONNECTED via real form',true,'form submit','status=CONNECTED');
    // Spawn a REAL drone + push observation so perceived_hostile is observed in room A
    await page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');const w=gs.world;const e=w.echoActor;const room=w.currentRoom();w.spawnEnemy('drone',e.x+1,e.y,room?.id??0,1);void gs.companionLink.pushObservation();});
    await sleep(600);
    // SDK attach + observe + suggest (unconfirmed, room A target)
    transport=new StdioClientTransport({command:process.execPath,args:[COMPANION_SERVER],env:{...process.env,LAST_SIGNAL_WORLD_BRIDGE_URL:bridge.url,LAST_SIGNAL_WORLD_TOKEN:TOKEN},stderr:'pipe'});
    sdk=new Client({name:'xroom',version:'0.0.0'}); await sdk.connect(transport);
    const obs=await tool(sdk,'echo_observe');
    rec('X02 echo_observe sees relay',obs?.ok===true&&!!obs?.observation?.relay,'sdk echo_observe','relay='+JSON.stringify(obs?.observation?.relay));
    const roomA=await page.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;const e=w.echoActor;return{roomId:w.currentRoomId,x:e.x,y:e.y};});
    const oldTarget={x:roomA.x+1,y:roomA.y};
    const sugId='sug_'+randomBytes(12).toString('hex'), reqId='req_'+randomBytes(12).toString('hex');
    const sug=await tool(sdk,'echo_suggest',{requestId:reqId,suggestionId:sugId,kind:'fire',reason:'perceived_hostile',target:oldTarget,ttlTicks:600});
    rec('X03 unconfirmed suggestion seeded in room A',sug?.ok===true,'sdk echo_suggest',JSON.stringify({ok:sug?.ok,kind:sug?.suggestion?.kind,target:sug?.suggestion?.target,code:sug?.code}));
    const pendBefore=await tool(sdk,'echo_status');
    const pendIdsBefore=(pendBefore?.pending??[]).map((p:any)=>p.suggestionId);
    rec('X04 suggestion pending before portal',pendIdsBefore.includes(sugId),'sdk echo_status',JSON.stringify({pending:pendIdsBefore}));
    // Resume, open the gate (fixture: direct owner toggle), then REAL portal transition
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!(window as any).__game?.scene.isActive('PauseScene'),undefined,{timeout:10000});
    await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.toggleRelay(true);});
    await page.waitForFunction(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;return w.sim.signal&&w.sim.signal.relay==='ACTIVE';},undefined,{timeout:15000});
    const roomBefore=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.currentRoomId);
    await page.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;w.player.reset(w.portal.wx,w.portal.wy);});
    await sleep(500);
    await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.player.requestInteract();});
    await page.waitForFunction((prev:number)=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;return w.currentRoomId!==prev&&w.currentRoomId>=0;},roomBefore,{timeout:25000});
    const roomB=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.currentRoomId);
    rec('X05 real portal transition A->B',roomB!==roomBefore,'portal interact',JSON.stringify({roomA:roomBefore,roomB}));
    // Re-observe so the gateway sees room B state (push is on the 30-frame cadence too)
    await page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');void gs.companionLink.pushObservation();});
    await sleep(300);
    const pendAfter=await tool(sdk,'echo_status');
    const pendIdsAfter=(pendAfter?.pending??[]).map((p:any)=>p.suggestionId);
    rec('X06 OBSERVE: old suggestion pending after portal?',true,'sdk echo_status (after portal)',JSON.stringify({pendingAfter:pendIdsAfter,stillThere:pendIdsAfter.includes(sugId)}));
    // Attempt Owner CONFIRM of the OLD suggestion via the real browser link
    const echoBeforeConfirm=await page.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;const gs:any=(window as any).__game.scene.getScene('GameScene');return{x:w.echoActor.x,y:w.echoActor.y,pending:w.hasPendingCompanionIntent,shots:gs.echoShotsFired};});
    const decideResult=await page.evaluate(async(id:string)=>{
      const gs:any=(window as any).__game.scene.getScene('GameScene');
      const list=await gs.companionLink.pending();
      const old=list.find((p:any)=>p.suggestionId===id);
      if(!old)return{found:false};
      const ok=await gs.companionLink.decide(old,'confirm');
      return{found:true,decided:ok,error:gs.companionLink.error,kind:old.kind,target:old.target};
    },sugId);
    await sleep(600);
    const afterConfirm=await page.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;const gs:any=(window as any).__game.scene.getScene('GameScene');return{x:w.echoActor.x,y:w.echoActor.y,pending:w.hasPendingCompanionIntent,roomId:w.currentRoomId,shots:gs.echoShotsFired,projectiles:w.sim.projectiles.filter((p:any)=>p.source==='echo').length};});
    // Did the stale intent execute? (echo moved / pending intent after confirm / new decision recorded)
    const staleApplied = (decideResult.found && decideResult.decided) || afterConfirm.pending;
    rec('X07 NEGATIVE: old unconfirmed suggestion cannot mis-execute after portal',
      decideResult.found===false || decideResult.decided===false || (afterConfirm.pending===false && Math.abs(afterConfirm.x-echoBeforeConfirm.x)<0.001 && Math.abs(afterConfirm.y-echoBeforeConfirm.y)<0.001),
      'Owner confirm old suggestion after portal',JSON.stringify({decideResult,echoBeforeConfirm,afterConfirm,staleApplied}));
    await page.screenshot({path:`${OUT}/evidence/xroom-after.png`});
    await require('node:fs').writeFileSync(`${OUT}/11-cross-room-suggestion.json`,JSON.stringify({total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R,detail:{roomA,roomB,oldTarget,sugId,pendIdsBefore,pendIdsAfter,decideResult,echoBeforeConfirm,afterConfirm}},null,2));
    const summary={total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length};
    console.log('SUMMARY',JSON.stringify(summary));
  }finally{
    try{await sdk?.close();}catch{} try{await transport?.close();}catch{}
    await browser.close().catch(()=>{});
    await bridge.close();
  }
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
