import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomBytes } from 'node:crypto';
const SNAP='D:/Project/AI-NATIVE-02-snapshots/dcb4f14';
const stderrChunks=[];
const procEvents=[];
const transport=new StdioClientTransport({command:'node',args:[SNAP+'/dist-mcp/worldHeadlessMcpServer.mjs','--dev'],cwd:SNAP,env:{...process.env},stderr:'pipe'});
const c=new Client({name:'win',version:'1.0.0'});
await c.connect(transport);
const child = transport._process;
if (child) { child.on('exit', (code, sig) => procEvents.push({ code, sig })); child.on('error', (e) => procEvents.push({ error: String(e) })); }
if (transport.stderr) transport.stderr.on('data',(d)=>stderrChunks.push(d.toString()));
const call=async(n,a)=>{const r=await c.callTool({name:n,arguments:a});const t=r.content?.[0]?.text??'';let b;try{b=JSON.parse(t)}catch{b={raw:t}};return {isError:!!r.isError,body:b}};
const req=()=>'req_'+randomBytes(12).toString('hex');
const dummy={move:{x:0,y:0},dash:false,fire:false,aim:null,interact:false};
const out={steps:0,error:null,events:null,eventsTruncated:null,sameEvents:null,stderr:null};
try{
  const cr=(await call('world_headless_create_session',{seed:424242})).body;
  let ep=cr.epoch;
  for(let i=0;i<21;i++){
    const r=await call('world_headless_step',{session:cr.session,epoch:ep,requestId:req(),ticks:1000,intent:dummy});
    console.error('step',i,'tick',r.body.toTick,'status',r.body.status,'events',(r.body.events??[]).length,'isError',r.isError);
    out.steps=i+1;
  }
  const snap=await call('world_headless_dev_snapshot',{session:cr.session});
  out.events=snap.body.frame?.events?.length??null;
  const rep=await call('world_headless_dev_replay',{session:cr.session,frame:snap.body.frame,steps:[{ticks:5,intent:dummy}]});
  out.eventsTruncated=rep.body.eventsTruncated;
  out.sameEvents=rep.body.sameEvents;
  out.baselineEvents=rep.body.baselineEvents;
}catch(e){ out.error=String(e).slice(0,400); }
out.stderr=stderrChunks.join('').slice(-1500);
out.procEvents=procEvents;
out.pid=transport.pid;
console.log(JSON.stringify(out,null,2));
try{await c.close()}catch{}
process.exit(0);
