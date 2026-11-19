import {chromium} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {randomBytes,createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {mkdirSync,appendFileSync} from 'node:fs';
import {startWorldBridge} from './src/ai-native/worldBridgeServer';
import {WorldGateway} from './src/ai-native/worldGateway';
const out='D:/Project/LAST_SIGNAL/reports/ai-native-02/lead-echo-live';mkdirSync(out,{recursive:true});
const token=randomBytes(24).toString('hex'),ownerKey=randomBytes(32).toString('hex');
const bridge=await startWorldBridge({gateway:new WorldGateway(),token,ownerKeyHash:createHash('sha256').update(ownerKey).digest('hex'),allowedOrigins:['http://localhost:5420']});
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:out+'/video'}});const page=await context.newPage();
page.on('pageerror',e=>appendFileSync(out+'/errors.log',e.message+'\n'));
async function clickText(label:string,scene='PauseScene'){const p=await page.evaluate(({label,scene})=>{const s=(window as any).__game.scene.getScene(scene);const t=s.children.list.find((x:any)=>x.type==='Text'&&x.text?.includes(label));if(!t)return null;const b=t.getBounds();return{x:b.centerX,y:b.centerY};},{label,scene});if(!p)throw Error('Missing UI '+label);await page.mouse.click(p.x,p.y);}
await page.goto('http://localhost:5420');await page.waitForFunction(()=>(window as any).__game?.scene.isActive('MainMenuScene'));await clickText('NEW RUN','MainMenuScene');await page.waitForFunction(()=>(window as any).__game.scene.isActive('GameScene'));
// Owner-only bootstrap: actual generated room, one real drone, base ECHO.
console.log('STAGE game');await page.evaluate(()=>{(window as any).__game.scene.getScene('GameScene').world.enableEcho();});await page.waitForFunction(()=>!!(window as any).__game.scene.getScene('GameScene').world.echoActor).catch(async e=>{console.log('BOOT_STATE',await page.evaluate(()=>{const g=(window as any).__game;const s=g.scene.getScene('GameScene');return {paused:s.paused,tick:s.world.sim.tick,commands:s.world.sim.pendingCommands,scenes:g.scene.getScenes(true).map((x:any)=>x.sys.settings.key)}}));throw e;});console.log('STAGE echo');
const bootstrap=await page.evaluate(()=>{const w=(window as any).__game.scene.getScene('GameScene').world;const e=w.echoActor;const r=w.currentRoom();const candidates=w.map.tiles.flat().filter((t:any)=>w.isWalkable(t.x,t.y,.5)&&Math.hypot(t.x-e.x,t.y-e.y)>1&&Math.hypot(t.x-e.x,t.y-e.y)<2.2);const p=candidates[0];if(!p)throw Error('No legal spawn');w.spawnEnemy('drone',p.x,p.y,r.id,0);return {room:r.id,enemy:{x:p.x,y:p.y},fixture:'Owner enableEcho+spawn real drone; no HP/energy/resources edits'};});
await page.waitForTimeout(60);await page.keyboard.press('Escape');await page.waitForFunction(()=>(window as any).__game.scene.isActive('PauseScene'));console.log('STAGE pause');await clickText('LLM COMPANION >');await page.waitForTimeout(80);await clickText('ENABLE / RE-AUTHORIZE');console.log('STAGE form');
await page.locator('input[name="bridgeUrl"]').fill(bridge.url);await page.locator('input[name="token"]').fill(token);await page.locator('input[name="ownerKey"]').fill(ownerKey);await page.getByRole('button',{name:'AUTHORIZE',exact:true}).click();console.log('STAGE authorized click');await page.waitForFunction(()=>(window as any).__game.scene.getScene('GameScene').companionStatus==='CONNECTED').catch(async e=>{await page.screenshot({path:out+'/failure.png'});console.log('OWNER_STATUS',await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').companionStatus));throw e;});
const c=new Client({name:'lead-echo-model-operator',version:'1'});await c.connect(new StdioClientTransport({command:process.execPath,args:['dist-mcp/companionMcpServer.mjs'],env:{...process.env,LAST_SIGNAL_WORLD_BRIDGE_URL:bridge.url,LAST_SIGNAL_WORLD_TOKEN:token} as any,stderr:'pipe'}));
appendFileSync(out+'/bootstrap.json',JSON.stringify({commit:'7fd4a2eedb39ebf3602de00328eb5a12287ee300',bootstrap,ownerConfirmation:'automated real UI, not actual human evidence',agentBoundary:'official Companion MCP only; Owner key absent from Agent env'})+'\n');console.log('READY Companion MCP; paused for Owner proposals');let round=0;
for await(const line of createInterface({input:process.stdin,terminal:false})){try{const q=JSON.parse(line);if(q.tool==='shutdown')break;
if(q.tool==='_owner_confirm'){
await clickText('CONFIRM FIRST PROPOSAL');await page.waitForTimeout(100);await page.keyboard.press('Escape');await page.waitForTimeout(600);await page.keyboard.press('Escape');await page.waitForFunction(()=>(window as any).__game.scene.isActive('PauseScene'));await clickText('LLM COMPANION >');await page.waitForTimeout(100);
const state=await page.evaluate(()=>{const w=(window as any).__game.scene.getScene('GameScene').world;return {tick:w.sim.tick,playerHp:w.sim.player.data.hp,echoHp:w.sim.echo?.data.hp,shots:w.sim.echo?.shotsFired,enemies:w.enemies.filter((e:any)=>e.alive).map((e:any)=>({id:e._id,hp:e._hp}))};});appendFileSync(out+'/owner-ui.jsonl',JSON.stringify({at:new Date().toISOString(),event:'automated Owner CONFIRM + normal 600ms + Pause',state})+'\n');console.log(JSON.stringify({ownerFixture:state}));
}else{const r=await c.callTool({name:q.tool,arguments:q.args??{}});appendFileSync(out+'/tool-io.jsonl',JSON.stringify({round:++round,at:new Date().toISOString(),...q,result:r.structuredContent})+'\n');console.log(JSON.stringify(r.structuredContent));}
await page.screenshot({path:out+`/round-${round}-${q.tool.startsWith('_')?'owner':'agent'}.png`});
}catch(e){console.log(JSON.stringify({error:String(e)}));}}
await c.close();await context.close();await browser.close();await bridge.close();process.exit(0);
