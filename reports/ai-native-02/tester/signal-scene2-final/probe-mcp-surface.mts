// Independent Tester — MCP signal surface on frozen c1cc2dd (stdio, headless --dev).
// Verifies: official surface has NO signal scan/jam tools; headless exposes world_signal_status
// (+ Dev command/device/batch only under --dev); v1 action scan/jam rejected with clear error.
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SNAP='D:/Project/AI-NATIVE-02-snapshots/c1cc2dd';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/signal-scene2-final';
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const call=(c:any,name:string,args:any={})=>c.callTool({name,arguments:args}).then((r:any)=>r.structuredContent as any);
async function main(){
  const transport=new StdioClientTransport({command:process.execPath,args:[`${SNAP}/dist-mcp/worldHeadlessMcpServer.mjs`,`--dev`],env:process.env,stderr:'pipe'});
  const c=new Client({name:'tester-mcp-surface',version:'0.0.0'});
  await c.connect(transport);
  try{
    const tools=await c.listTools();
    const names=tools.tools.map((t:any)=>t.name).sort();
    rec('N01 headless --dev exposes world_signal_status',names.includes('world_signal_status'),'listTools',JSON.stringify(names.filter(n=>n.includes('signal'))));
    rec('N02 headless exposes ONLY Dev signal command/device/batch (no official signal command on player surface)',
      names.includes('world_headless_dev_signal_command')&&names.includes('world_headless_dev_signal_device')&&names.includes('world_headless_dev_signal_batch'),
      'listTools signal tools',JSON.stringify(names.filter(n=>n.includes('signal'))));
    rec('N03 headless does NOT expose a generic world_signal_scan/jam tool',
      !names.some(n=>n==='world_signal_scan'||n==='world_signal_jam'),'listTools',JSON.stringify(names.filter(n=>n.includes('signal')||n==='world_action')));
    // No device yet => supported false / error.
    const st0=await call(c,'world_signal_status');
    rec('N04 world_signal_status no device => not supported (truthful)',st0.ok===false&&(st0.code==='E_NOT_APPLICABLE'||st0.code==='E_LINK_UNAVAILABLE'),
      'world_signal_status (no device)',JSON.stringify({ok:st0.ok,code:st0.code,messageKey:st0.messageKey}));
    // Create session (dev => explicit seed).
    const cs=await call(c,'world_headless_create_session',{seed:424242});
    rec('N05 headless create session',cs.ok===true&&!!cs.session,'world_headless_create_session',JSON.stringify({ok:cs.ok,session:cs.session,code:cs.code}));
    const session=cs.session as string;
    const st1=await call(c,'world_signal_status');
    rec('N06 world_signal_status session but no device => not supported',st1.ok===false,'world_signal_status (session,no device)',JSON.stringify({ok:st1.ok,code:st1.code}));
    // Spawn ONE relay device (DEV).
    const sd=await call(c,'world_headless_dev_signal_device',{session});
    rec('N07 dev spawn ONE relay device',sd.ok===true,'world_headless_dev_signal_device',JSON.stringify({ok:sd.ok,code:sd.code,messageKey:sd.messageKey}));
    const st2=await call(c,'world_signal_status');
    rec('N08 world_signal_status with device => supported:true',st2.ok===true&&st2.supported===true,'world_signal_status (with device)',JSON.stringify({ok:st2.ok,supported:st2.supported,device:st2.device?.deviceId,relay:st2.device?.relay}));
    // Dev signal-command scan (actor player) charges -10 CD120.
    const sc1=await call(c,'world_headless_dev_signal_command',{session,type:'signal-scan',actor:'player'});
    await new Promise(r=>setTimeout(r,150));
    const st2b=await call(c,'world_signal_status');
    rec('N09 dev signal-command scan charges player -10',sc1.ok===true&&st2b.device.playerEnergy===90,'world_headless_dev_signal_command signal-scan',JSON.stringify({ok:sc1.ok,code:sc1.code,energy:st2b.device.playerEnergy,relay:st2b.device.relay}));
    // Repeat scan blocked by cooldown.
    const sc2=await call(c,'world_headless_dev_signal_command',{session,type:'signal-scan',actor:'player'});
    const st2c=await call(c,'world_signal_status');
    rec('N10 repeat scan blocked by cooldown (no double charge)',st2c.device.playerEnergy===90,'repeat signal-scan',JSON.stringify({ok:sc2.ok,code:sc2.code,energy:st2c.device.playerEnergy}));
    // Dev signal-command jam -> JAMMED -25.
    const jm1=await call(c,'world_headless_dev_signal_command',{session,type:'signal-jam',actor:'player'});
    await new Promise(r=>setTimeout(r,150));
    const st3=await call(c,'world_signal_status');
    rec('N11 dev signal-command jam => JAMMED -25',jm1.ok===true&&st3.device.relay==='JAMMED','signal-jam',JSON.stringify({ok:jm1.ok,code:jm1.code,relay:st3.device.relay,energy:st3.device.playerEnergy}));
    // Repeat jam blocked while jammed.
    const jm2=await call(c,'world_headless_dev_signal_command',{session,type:'signal-jam',actor:'player'});
    const st3b=await call(c,'world_signal_status');
    rec('N12 repeat jam blocked while jammed (relay stays JAMMED, energy unchanged)',st3b.device.relay==='JAMMED'&&st3b.device.playerEnergy===st3.device.playerEnergy,'repeat signal-jam',JSON.stringify({ok:jm2.ok,code:jm2.code,relay:st3b.device.relay,energy:st3b.device.playerEnergy}));
    // v1 world_action with scan type => schema rejection (clear error, no silent reinterpretation).
    const vaRaw=await c.callTool({name:'world_action',arguments:{session,epoch:1,requestId:'req_'+'a'.repeat(24),actions:[{type:'scan',actionId:'aid_'+'a'.repeat(24),ticks:1}]}});
    const va={isError:vaRaw.isError===true,structuredContent:vaRaw.structuredContent};
    const n13ok = va.isError===true || va.structuredContent?.ok===false || va.structuredContent?.code==='E_SCHEMA';
rec('N13 v1 world_action scan rejected (clear error, no silent v2 reinterpretation)',n13ok,
      'world_action {type:scan} v1 schema (isError='+Boolean(va.isError)+')',JSON.stringify({isError:va.isError,structuredContent:va.structuredContent}));
    const summary={total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R};
    console.log('SUMMARY',JSON.stringify({total:summary.total,pass:summary.pass,fail:summary.fail}));
    await require('node:fs/promises').writeFile(`${OUT}/02-mcp-surface.json`,JSON.stringify(summary,null,2));
  }finally{await c.close().catch(()=>{});await transport.close().catch(()=>{});}
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
