import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomBytes } from 'node:crypto';
const SNAP='D:/Project/AI-NATIVE-02-snapshots/dcb4f14';
const stderr=[]; const proc=[];
const transport=new StdioClientTransport({command:'node',args:[SNAP+'/dist-mcp/worldHeadlessMcpServer.mjs','--dev'],cwd:SNAP,env:{...process.env},stderr:'pipe'});
const c=new Client({name:'win2',version:'1.0.0'});
await c.connect(transport);
const child=transport._process; if(child){child.on('exit',(code,sig)=>proc.push({code,sig})); child.on('error',(e)=>proc.push({error:String(e)}));}
if(transport.stderr) transport.stderr.on('data',(d)=>stderr.push(d.toString()));
const call=async(n,a)=>{const r=await c.callTool({name:n,arguments:a});const t=r.content?.[0]?.text??'';let b;try{b=JSON.parse(t)}catch{b={raw:t.slice(0,80)}};return {isError:!!r.isError,body:b,len:t.length}};
const req=()=>'req_'+randomBytes(12).toString('hex');
const dummy={move:{x:0,y:0},dash:false,fire:false,aim:null,interact:false};
const out={samples:[],error:null,lastLen:null,proc:[],stderr:null};
try{
  const cr=(await call('world_headless_create_session',{seed:424242})).body; const ep=cr.epoch;
  for(let i=0;i<70;i++){
    const r=await call('world_headless_step',{session:cr.session,epoch:ep,requestId:req(),ticks:300,intent:dummy});
    out.samples.push({i,tick:r.body.toTick,len:r.len,events:(r.body.events??[]).length});
    out.lastLen=r.len;
    if(r.isError){ out.error='tool error '+JSON.stringify(r.body).slice(0,120); break; }
    if(out.samples.length%5===0) console.error('i',i,'tick',r.body.toTick,'len',r.len);
  }
}catch(e){ out.error=String(e).slice(0,300); }
out.proc=proc; out.stderr=stderr.join('').slice(-800);
const maxSample=out.samples.reduce((m,s)=>s.len>m.len?s:m,{len:0});
console.error('samples',out.samples.length,'maxLen',maxSample.len,'atTick',maxSample.tick,'error',out.error,'proc',JSON.stringify(proc));
console.log(JSON.stringify(out,null,2));
try{await c.close()}catch{}
process.exit(0);
