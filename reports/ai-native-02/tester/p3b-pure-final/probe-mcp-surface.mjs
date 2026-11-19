import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const SNAP='D:/Project/AI-NATIVE-02-snapshots/ab59fe6';
const checks=[];
for(const dev of [false,true]){
  const c=new Client({name:'surface',version:'1.0.0'});
  await c.connect(new StdioClientTransport({command:'node',args:[SNAP+'/dist-mcp/worldHeadlessMcpServer.mjs',...(dev?['--dev']:[])],cwd:SNAP,env:{...process.env},stderr:'pipe'}));
  const tools=(await c.listTools()).tools.map(t=>t.name);
  const status=await c.callTool({name:'world_signal_status',arguments:{}});
  let body;try{body=JSON.parse(status.content[0].text)}catch{body={raw:status.content[0].text}}
  const banned=tools.filter(n=>/signal|companion|echo_|llm/i.test(n));
  checks.push({dev,tools,banned,signalStatus:body.code??body.messageKey??null,ok:banned.filter(n=>n!=='world_signal_status').length===0&&body.code==='E_NOT_APPLICABLE'&&body.messageKey==='world.signal_combat_unsupported'});
  await c.close();
}
console.log(JSON.stringify(checks,null,2));
if(!checks.every(c=>c.ok))process.exit(1);
