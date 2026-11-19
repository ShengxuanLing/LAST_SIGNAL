// Independent Tester — 7c0068f re-run of the cross-room old-suggestion negative (fire),
// plus duplicate-suggest / late-applied / new-room-once / agent-cancel-403 / memory-new-room.
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
  let sdk:any=null,transport:any=null;
  try{
    await boot(page);
    await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.enableEcho();});
    await page.waitForFunction(()=>!!((window as any).__game.scene.getScene('GameScene').world.echoActor),undefined,{timeout:15000});
    // authorize companion via real masked form
    await page.keyboard.press('Escape');await page.waitForFunction(()=>(window as any).__game.scene.isActive('PauseScene'),undefined,{timeout:10000});
    await clickText(page,'LLM COMPANION >');await sleep(300);await clickText(page,'ENABLE / RE-AUTHORIZE');
    await page.waitForSelector('[data-testid="external-link-form"] input[name="ownerKey"]',{timeout:10000});
    await page.fill('[data-testid="external-link-form"] input[name="bridgeUrl"]',bridge.url);
    await page.fill('[data-testid="external-link-form"] input[name="token"]',TOKEN);
    await page.fill('[data-testid="external-link-form"] input[name="ownerKey"]',TEST_OWNER_KEY);
    await page.click('[data-testid="external-link-form"] button[type="submit"]');
    await page.waitForFunction(()=>(window as any).__game.scene.getScene('GameScene').companionStatus==='CONNECTED',undefined,{timeout:15000});
    rec('X01 companion CONNECTED via real form',true,'form submit','status=CONNECTED');
    // spawn real drone + observe so perceived_hostile passes; suggest fire with room-A target
    await page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');const w=gs.world;const e=w.echoActor;const room=w.currentRoom();w.spawnEnemy('drone',e.x+1,e.y,room?.id??0,1);void gs.companionLink.pushObservation();});
    await sleep(600);
    transport=new StdioClientTransport({command:process.execPath,args:[COMPANION_SERVER],env:{...process.env,LAST_SIGNAL_WORLD_BRIDGE_URL:bridge.url,LAST_SIGNAL_WORLD_TOKEN:TOKEN},stderr:'pipe'});
    sdk=new Client({name:'xroom2',version:'0.0.0'}); await sdk.connect(transport);
    const obs=await tool(sdk,'echo_observe');
    const roomAInfo=await page.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;const e=w.echoActor;const r=w.currentRoom();return{roomId:w.currentRoomId,x:e.x,y:e.y,room:r?{gx:r.gx,gy:r.gy,w:r.w,h:r.h}:null};});
    const oldTarget={x:roomAInfo.x+1,y:roomAInfo.y};
    const oldId='sug_'+randomBytes(12).toString('hex'), oldReq='req_'+randomBytes(12).toString('hex');
    const sug=await tool(sdk,'echo_suggest',{requestId:oldReq,suggestionId:oldId,kind:'fire',reason:'perceived_hostile',target:oldTarget,ttlTicks:600});
    rec('X02 seed unconfirmed fire suggestion in room A',sug.ok===true&&sug.suggestion?.generation===0,'sdk echo_suggest',JSON.stringify({ok:sug.ok,kind:sug.suggestion?.kind,target:sug.suggestion?.target,generation:sug.suggestion?.generation,roomId:sug.suggestion?.roomId,code:sug.code}));
    const stA=await tool(sdk,'echo_status');
    rec('X03 pending before portal',(stA.pending??[]).map((p:any)=>p.suggestionId).includes(oldId),'sdk echo_status',JSON.stringify({pending:(stA.pending??[]).map((p:any)=>p.suggestionId)}));
    // held OLD object from the real Owner link
    const heldOld=await page.evaluate((id:string)=>(window as any).__game.scene.getScene('GameScene').companionLink.pending().then((l:any[])=>l.find((p:any)=>p.suggestionId===id)??null),oldId);
    rec('X04 Owner link holds the old object',!!heldOld,'companionLink.pending',JSON.stringify({held:!!heldOld}));
    // open gate (fixture) + real portal
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!(window as any).__game?.scene.isActive('PauseScene'),undefined,{timeout:10000});
    await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.toggleRelay(true);});
    await page.waitForFunction(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;return w.sim.signal&&w.sim.signal.relay==='ACTIVE';},undefined,{timeout:15000});
    await page.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;w.player.reset(w.portal.wx,w.portal.wy);});
    await sleep(500);
    await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.player.requestInteract();});
    await page.waitForFunction((prev:number)=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;return w.currentRoomId!==prev&&w.currentRoomId>=0;},roomAInfo.roomId,{timeout:25000});
    const roomB=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.currentRoomId);
    rec('X05 real portal transition A->B',roomB!==roomAInfo.roomId,'portal interact',JSON.stringify({roomA:roomAInfo.roomId,roomB}));
    // status: no old pending + cancelled receipt
    await expect_poll(async()=>{const s=await tool(sdk,'echo_status');return s.receipts?.find((r:any)=>r.suggestionId===oldId)?.status??'none';},'cancelled',20000);
    const stB=await tool(sdk,'echo_status');
    const receiptB=(stB.receipts??[]).find((r:any)=>r.suggestionId===oldId);
    const pendingB=(stB.pending??[]).map((p:any)=>p.suggestionId);
    rec('X06 after portal: no old pending + cancelled receipt(reason room_changed) + roomId=B',
      !pendingB.includes(oldId)&&receiptB?.status==='cancelled'&&receiptB?.reason==='room_changed'&&stB.status?.roomId===roomB,
      'sdk echo_status (after)',JSON.stringify({pending:pendingB,receipt:receiptB,statusRoomId:stB.status?.roomId}));
    // held OLD confirm refused E_STALE_GENERATION; no execution
    const snap=()=>page.evaluate(()=>{const gs:any=(window as any).__game.scene.getScene('GameScene');const w=gs.world;return{echoShots:gs.echoShotsFired,echoProj:w.sim.projectiles.filter((p:any)=>p.source==='echo').length,pendingIntent:w.hasPendingCompanionIntent,pendingCmds:(w.sim.pendingCommands||[]).map((c:any)=>c.type),echoEnergy:w.sim.signal?w.sim.signal.actors.echo.energy.energy:-1};});
    const before=await snap();
    const decided=await page.evaluate(async(old:any)=>{const gs:any=(window as any).__game.scene.getScene('GameScene');const ok=await gs.companionLink.decide(old,'confirm');return{ok,error:gs.companionLink.error};},heldOld);
    await sleep(600);
    const after=await snap();
    const noExec=after.pendingIntent===false&&after.echoProj===before.echoProj&&after.echoShots===before.echoShots&&after.echoEnergy===before.echoEnergy&&!after.pendingCmds.some((c:string)=>['toggle-relay','signal-scan','signal-jam'].includes(c));
    rec('X07 held OLD confirm refused E_STALE_GENERATION + no execution',decided.ok===false&&String(decided.error).includes('E_STALE_GENERATION')&&noExec,'companionLink.decide(old,confirm)',JSON.stringify({decided,before,after}));
    // duplicate suggest old id -> E_STALE_GENERATION (no revive)
    const dup=await tool(sdk,'echo_suggest',{requestId:'req_'+randomBytes(12).toString('hex'),suggestionId:oldId,kind:'fire',reason:'perceived_hostile',target:oldTarget,ttlTicks:600});
    rec('X08 old duplicate suggest refused (no revive)',dup.ok===false&&dup.code==='E_STALE_GENERATION','sdk echo_suggest(old id)',JSON.stringify({ok:dup.ok,code:dup.code,messageKey:dup.messageKey}));
    // late applied old id -> E_STALE_GENERATION
    const lateApplied=await page.evaluate(async(id:string)=>{const gs:any=(window as any).__game.scene.getScene('GameScene');const ok=await gs.companionLink.postApplied(id,gs.world.sim.tick);return{ok,error:gs.companionLink.error};},oldId);
    rec('X09 late applied old id refused (no phantom execution)',lateApplied.ok===false,'companionLink.postApplied(old)',JSON.stringify(lateApplied));
    // Agent token direct cancel -> 403
    const agentCancel=await fetch(`${bridge.url}/world-link/companion-room`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${TOKEN}`},body:JSON.stringify({session:stB.status.session,epoch:stB.status.epoch,roomId:roomAInfo.roomId,tick:after.tick??0})});
    rec('X10 Agent token direct cancel refused 403',agentCancel.status===403,'fetch POST /companion-room (token only)',JSON.stringify({status:agentCancel.status}));
    // memory is new room (no old-room coords)
    const obsB=await tool(sdk,'echo_observe');
    const mem=(obsB.observation?.memory??[]) as any[];
    const oldRoomBounds=roomAInfo.room;
    const memInOldRoom=mem.filter((m:any)=>oldRoomBounds&&m.x>=oldRoomBounds.gx&&m.x<oldRoomBounds.gx+oldRoomBounds.w&&m.y>=oldRoomBounds.gy&&m.y<oldRoomBounds.gy+oldRoomBounds.h);
    rec('X11 observation memory is new room (no old-room entries)',obsB.ok===true&&memInOldRoom.length===0&&(obsB.observation?.epoch!==undefined),'sdk echo_observe (room B)',JSON.stringify({memCount:mem.length,memInOldRoom:memInOldRoom.length,pendingAfter:stB.pending?.length}));
    // new room observe -> new suggest -> Owner confirm -> next tick ONCE
    const newId='sug_'+randomBytes(12).toString('hex');
    const sugB=await tool(sdk,'echo_suggest',{requestId:'req_'+randomBytes(12).toString('hex'),suggestionId:newId,kind:'move',reason:'no_perceived_target',target:{x:(obsB.observation?.echo?.x??0)+1,y:obsB.observation?.echo?.y??0},ttlTicks:600});
    rec('X12 new-room suggestion accepted (roomId=B)',sugB.ok===true&&sugB.suggestion?.roomId===roomB&&sugB.suggestion?.generation>=1,'sdk echo_suggest (room B)',JSON.stringify({ok:sugB.ok,roomId:sugB.suggestion?.roomId,generation:sugB.suggestion?.generation,code:sugB.code}));
    const heldNew=await page.evaluate((id:string)=>(window as any).__game.scene.getScene('GameScene').companionLink.pending().then((l:any[])=>l.find((p:any)=>p.suggestionId===id)??null),newId);
    const confirmNew=await page.evaluate(async(s:any)=>{const gs:any=(window as any).__game.scene.getScene('GameScene');const ok=await gs.companionLink.decide(s,'confirm');return{ok,pending:gs.world.hasPendingCompanionIntent};},heldNew);
    rec('X13 new-room Owner confirm accepted + enqueues intent',confirmNew.ok===true&&confirmNew.pending===true,'companionLink.decide(new,confirm)',JSON.stringify(confirmNew));
    await page.waitForFunction(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;return w.hasPendingCompanionIntent===false;},undefined,{timeout:15000});
    const stC=await tool(sdk,'echo_status');
    const recC=(stC.receipts??[]).find((r:any)=>r.suggestionId===newId);
    rec('X14 new-room confirm executes once on next tick (receipt confirmed/applied)',/confirmed|applied/.test(String(recC?.status))&&((stC.pending??[]).map((p:any)=>p.suggestionId).includes(newId)===false),'sdk echo_status (after new confirm)',JSON.stringify({receipt:recC,pending:(stC.pending??[]).map((p:any)=>p.suggestionId)}));
    await page.screenshot({path:`${OUT}/evidence/room-b-after-fix.png`});
    await require('node:fs').writeFileSync(`${OUT}/11-cross-room-negative.json`,JSON.stringify({total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R,detail:{roomA:roomAInfo.roomId,roomB,oldId,newId,receiptB,pendingB,decided,before,after,lateApplied}},null,2));
    console.log('SUMMARY',JSON.stringify({total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length}));
  }finally{
    try{await sdk?.close();}catch{} try{await transport?.close();}catch{}
    await browser.close().catch(()=>{}); await bridge.close();
  }
}
async function expect_poll(fn:()=>Promise<string>,want:string,ms:number){const t=Date.now();while(Date.now()-t<ms){if(String(await fn()).includes(want))return true;await sleep(250);}return false;}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
