import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const SNAP='D:/tmp/gp01-rm-b6a98e5';
const t=new StdioClientTransport({command:process.execPath,args:[SNAP+'/dist-mcp/worldHeadlessMcpServer.mjs','--dev'],cwd:SNAP});
const c=new Client({name:'probe3',version:'0'});
await c.connect(t);
const u=(r)=>r?.structuredContent ?? JSON.parse(r?.content?.find(x=>x.type==='text')?.text ?? '{}');
const s=u(await c.callTool({name:'world_headless_create_session',arguments:{seed:20261117}}));
for (const roomId of [0,1,2,3,4,5,6,7,8]) {
  const load=u(await c.callTool({name:'world_headless_dev_load_room',arguments:{session:s.session,roomId,kinds:['drone','drone','drone']}}));
  if (!load.ok) { console.log('room',roomId,'load_failed',load.code,load.messageKey); continue; }
  const obs=u(await c.callTool({name:'world_observe',arguments:{session:s.session,epoch:load.epoch}}));
  const o=obs.observation??obs;
  console.log('room',roomId,'player',o.player?.x,o.player?.y,'roomObs',o.roomId,'enemies',(o.enemies??[]).length, JSON.stringify((o.enemies??[]).map(e=>({id:e.id,x:e.x,y:e.y,hp:e.hp}))));
}
await c.close();
