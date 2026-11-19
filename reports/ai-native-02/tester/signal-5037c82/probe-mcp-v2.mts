// Independent Tester — Signal 5037c82 official v2 MCP surface (headless --dev,
// StdioClientTransport, no browser, no LLM).
// Verifies: world_signal_status truthful; dev spawn ONE relay; dev signal-command
// scan/jam true post-commit deduction + evidence; actor=echo does NOT impersonate
// Player (player's account used for player commands; echo account separate);
// v1-style scan without actor rejected; v1 intent actions unchanged.
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SNAP='D:/Project/AI-NATIVE-02-snapshots/5037c82';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/signal-5037c82';
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const call=(c:any,name:string,args:any={})=>c.callTool({name,arguments:args}).then((r:any)=>{const s=r.structuredContent as any;return{ok:r.isError!==true&&s?.ok!==false,isError:r.isError===true,code:s?.code,messageKey:s?.messageKey,...s};});
async function main(){
  const transport=new StdioClientTransport({command:process.execPath,args:[`${SNAP}/dist-mcp/worldHeadlessMcpServer.mjs`,`--dev`],env:process.env,stderr:'pipe'});
  const c=new Client({name:'tester-mcp-v2',version:'0.0.0'});
  await c.connect(transport);
  try{
    const tools=await c.listTools();
    const names=tools.tools.map((t:any)=>t.name).sort();
    rec('M01 headless --dev exposes world_signal_status',names.includes('world_signal_status'),'listTools',JSON.stringify(names.filter(n=>n.includes('signal'))));
    rec('M02 dev exposes signal command/device/batch (no generic world_signal_scan/jam)',
      names.includes('world_headless_dev_signal_command')&&names.includes('world_headless_dev_signal_device')&&names.includes('world_headless_dev_signal_batch')&&!names.includes('world_signal_scan')&&!names.includes('world_signal_jam'),
      'listTools signal',JSON.stringify(names.filter(n=>n.includes('signal'))));
    const st0=await call(c,'world_signal_status');
    rec('M03 world_signal_status no device => unsupported (truthful)',st0.ok===false&&(st0.code==='E_NOT_APPLICABLE'||st0.code==='E_LINK_UNAVAILABLE'),
      'world_signal_status (no device)',JSON.stringify({ok:st0.ok,code:st0.code,messageKey:st0.messageKey}));
    const cs=await call(c,'world_headless_create_session',{seed:424242});
    rec('M04 headless create session',cs.ok===true&&!!cs.session,'world_headless_create_session',JSON.stringify({ok:cs.ok,session:cs.session}));
    const session=cs.session as string;
    const st1=await call(c,'world_signal_status');
    rec('M05 world_signal_status session no device => unsupported',st1.ok===false,'world_signal_status (no device)',JSON.stringify({ok:st1.ok,code:st1.code}));
    const sd=await call(c,'world_headless_dev_signal_device',{session});
    rec('M06 dev spawn ONE relay device',sd.ok===true,'world_headless_dev_signal_device',JSON.stringify({ok:sd.ok,code:sd.code}));
    const st2=await call(c,'world_signal_status');
    rec('M07 world_signal_status with device => supported:true',st2.ok===true&&st2.supported===true,'world_signal_status (with device)',JSON.stringify({ok:st2.ok,supported:st2.supported,device:st2.device?.deviceId,relay:st2.device?.relay,playerEnergy:st2.device?.playerEnergy,echoEnergy:st2.device?.echoEnergy}));
    // Player scan -> post-commit deduction player -10 + evidence, echo unchanged (no impersonation)
    const sc1=await call(c,'world_headless_dev_signal_command',{session,type:'signal-scan',actor:'player'});
    await new Promise(r=>setTimeout(r,120));
    const st3=await call(c,'world_signal_status');
    rec('M08 dev signal-command scan: player -10, evidence, echo untouched',sc1.ok===true&&st3.device.playerEnergy===90&&(st3.device.evidence??0)>=1&&st3.device.echoEnergy===100,
      'world_headless_dev_signal_command signal-scan',JSON.stringify({ok:sc1.ok,code:sc1.code,playerEnergy:st3.device.playerEnergy,echoEnergy:st3.device.echoEnergy,evidence:st3.device.evidence,relay:st3.device.relay}));
    // Repeat scan blocked by CD -> energy unchanged (90->90), no double charge
    const sc2=await call(c,'world_headless_dev_signal_command',{session,type:'signal-scan',actor:'player'});
    await new Promise(r=>setTimeout(r,120));
    const st4=await call(c,'world_signal_status');
    rec('M09 repeat scan blocked by CD (no double charge)',sc2.ok===true&&st4.device.playerEnergy===90,
      'repeat signal-scan',JSON.stringify({ok:sc2.ok,code:sc2.code,playerEnergy:st4.device.playerEnergy,note:'tool returns ok:true but energy unchanged => blocked by CD'}));
    // Player jam -> player -25, relay JAMMED (player's own account, echo not impersonating)
    const jm1=await call(c,'world_headless_dev_signal_command',{session,type:'signal-jam',actor:'player'});
    await new Promise(r=>setTimeout(r,120));
    const st5=await call(c,'world_signal_status');
    rec('M10 dev signal-command jam: player -25, relay JAMMED, echo untouched',jm1.ok===true&&st5.device.playerEnergy===65&&st5.device.relay==='JAMMED'&&st5.device.echoEnergy===100,
      'signal-jam',JSON.stringify({ok:jm1.ok,code:jm1.code,relay:st5.device.relay,playerEnergy:st5.device.playerEnergy,echoEnergy:st5.device.echoEnergy}));
    // Echo account untouched by player's commands -> echo not impersonating player
    rec('M11 echo account not impersonating player (player cmds use player acct)',st5.device.echoEnergy===100&&st5.device.playerEnergy===65,
      'actor->account separation',JSON.stringify({playerEnergy:st5.device.playerEnergy,echoEnergy:st5.device.echoEnergy}));
    // v1-style scan without actor -> rejected (schema requires actor)
    const va=await call(c,'world_action',{session,epoch:1,requestId:'req_'+'a'.repeat(24),actions:[{type:'scan',actionId:'aid_'+'a'.repeat(24),ticks:1}]}).catch(e=>({ok:false,code:'EXCEPTION',messageKey:String(e),isError:true}));
    const vaRejected = va.ok===false||va.isError===true||va.code==='E_SCHEMA';
    rec('M12 v1-style scan without actor rejected (not silently v2)',vaRejected,
      'world_action {type:scan} no actor',JSON.stringify({ok:va.ok,code:va.code,isError:va.isError,messageKey:va.messageKey}));
    // v1 intent action (fire) still works — v1 unchanged
    const vf=await call(c,'world_action',{session,epoch:1,requestId:'req_'+'b'.repeat(24),actions:[{type:'fire',actionId:'aid_'+'b'.repeat(24),ticks:1,target:{x:1,y:2}}]}).catch(e=>({ok:false,code:'EXCEPTION',messageKey:String(e),isError:true}));
    rec('M13 v1 fire action still accepted (v1 unchanged)',vf.ok===true,
      'world_action {type:fire} v1',JSON.stringify({ok:vf.ok,code:vf.code,isError:vf.isError,messageKey:vf.messageKey}));
    const summary={total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R};
    console.log('SUMMARY',JSON.stringify({total:summary.total,pass:summary.pass,fail:summary.fail}));
    require('node:fs').writeFileSync(`${OUT}/02-mcp-v2.json`,JSON.stringify(summary,null,2));
  }finally{await c.close().catch(()=>{});await transport.close().catch(()=>{});}
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
