// Independent Tester — c2a31af: origin field cannot be injected via MCP; Companion
// stale toggle (originRoomId) rejected after teleport / once before; human R global.
import { parseWorldActionBatch } from 'D:/Project/AI-NATIVE-02-snapshots/c2a31af/src/ai-native/worldProtocol.ts';
import { basePlayerData, xpForLevel } from 'D:/Project/AI-NATIVE-02-snapshots/c2a31af/src/config/game.ts';
import { MapGenerator, assignRoles, guaranteeReachable } from 'D:/Project/AI-NATIVE-02-snapshots/c2a31af/src/world/MapGenerator.ts';
import { createSimulationState, enqueueCommand, stepSimulationTicks, isWalkableFromState } from 'D:/Project/AI-NATIVE-02-snapshots/c2a31af/src/world/sim/core.ts';
import { roomAt } from 'D:/Project/AI-NATIVE-02-snapshots/c2a31af/src/config/supplies.ts';
import { signalExitOpen } from 'D:/Project/AI-NATIVE-02-snapshots/c2a31af/src/world/sim/signalState.ts';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/signal-origin-final';
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const neutral=()=>({move:{x:0,y:0},dash:false,fire:false,aim:null,interact:false});
function playerData(){return{...basePlayerData(),level:1,xp:0,xpToNext:xpForLevel(1),currency:0,weaponKey:'pulse',weapons:[{key:'pulse',level:1,ammo:-1,magazine:-1,reloading:false,reloadTimer:0}],upgrades:[],abilities:[]} as any;}
function state(){const gen=new MapGenerator(424242);const map=gen.generate();assignRoles(gen,map.rooms,map.roomsOrder);guaranteeReachable(map);const s=createSimulationState({seed:424242,map,playerData:playerData(),playerX:0,playerY:0});for(const row of map.tiles)for(const tile of row){if((tile.type==='floor'||tile.type==='spawn')&&isWalkableFromState(s,tile.x,tile.y,0.5)){s.player.x=tile.x;s.player.y=tile.y;return s;}}return s;}
function spawnRelay(s:any){const pr=roomAt(s.map.rooms,s.player.x,s.player.y)?.id??0;enqueueCommand(s,{type:'spawn-signal-device',deviceId:'relay_main',roomId:pr,x:s.player.x,y:s.player.y});stepSimulationTicks(s,1,neutral());return s.signal;}
function farWalkable(s:any){const deviceRoom=s.signal.roomId;let best:any=null;let bestD=Infinity;for(const row of s.map.tiles)for(const tile of row){if(!isWalkableFromState(s,tile.x,tile.y,0.5))continue;const r=roomAt(s.map.rooms,tile.x,tile.y);if(!r||r.id===deviceRoom)continue;const d=Math.hypot(tile.x-s.signal.x,tile.y-s.signal.y);if(d<bestD){bestD=d;best={x:tile.x,y:tile.y};}}return best;}
function main(){
  // --- MCP origin field cannot be injected ---
  const toggle = parseWorldActionBatch({actions:[{type:'toggle-relay',enabled:true}]});
  rec('M01 MCP world_action cannot submit toggle-relay',toggle.ok===false,'parseWorldActionBatch(toggle-relay)',JSON.stringify({ok:toggle.ok,code:(toggle as any).code}));
  const injId='aid_'+'a'.repeat(24);
  const inject = parseWorldActionBatch({actions:[{type:'scan',actor:'player',actionId:injId,originRoomId:0,ticks:1}]});
  rec('M02 MCP world_action cannot inject originRoomId',inject.ok===false,'parseWorldActionBatch(scan+originRoomId)',JSON.stringify({ok:inject.ok,code:(inject as any).code}));
  const okScan = parseWorldActionBatch({actions:[{type:'scan',actor:'player',actionId:injId,ticks:1}]});
  rec('M03 MCP legal v2 scan with actor still parses',okScan.ok===true,'parseWorldActionBatch(scan)',JSON.stringify({ok:okScan.ok}));
  // --- Companion stale toggle bound to origin room ---
  // before teleport: originRoomId == device room -> commits once
  const s1=state(); spawnRelay(s1); const dev1=s1.signal.roomId; const far1=farWalkable(s1);
  enqueueCommand(s1,{type:'toggle-relay',enabled:true,originRoomId:dev1});
  enqueueCommand(s1,{type:'teleport-player',x:far1.x,y:far1.y,healToFull:true,migrateEcho:true});
  const ev1=stepSimulationTicks(s1,1,neutral());
  rec('M04 Companion toggle queued BEFORE teleport commits once in old room',s1.signal.relay==='ACTIVE'&&ev1.filter((e:any)=>e.type==='signal-relay-changed').length===1,'toggle(originRoomId=dev)+teleport same tick',JSON.stringify({relay:s1.signal.relay,changed:ev1.filter((e:any)=>e.type==='signal-relay-changed').length}));
  // after teleport: originRoomId = old room -> rejected, ACTIVE/exitOpen unchanged
  const s2=state(); spawnRelay(s2); const dev2=s2.signal.roomId; const far2=farWalkable(s2);
  enqueueCommand(s2,{type:'toggle-relay',enabled:true}); stepSimulationTicks(s2,1,neutral()); // ACTIVE
  enqueueCommand(s2,{type:'teleport-player',x:far2.x,y:far2.y,healToFull:true,migrateEcho:true}); stepSimulationTicks(s2,1,neutral());
  const relayBefore=s2.signal.relay, openBefore=signalExitOpen(s2.signal);
  enqueueCommand(s2,{type:'toggle-relay',enabled:false,originRoomId:dev2});
  const ev2=stepSimulationTicks(s2,1,neutral());
  rec('M05 stale Companion toggle AFTER teleport rejected, ACTIVE/exitOpen unchanged',s2.signal.relay===relayBefore&&signalExitOpen(s2.signal)===openBefore&&ev2.filter((e:any)=>e.type==='signal-relay-changed').length===0,'toggle(originRoomId=old) after teleport',JSON.stringify({relayBefore,relayAfter:s2.signal.relay,openBefore,openAfter:signalExitOpen(s2.signal),changed:ev2.filter((e:any)=>e.type==='signal-relay-changed').length}));
  // human R (no originRoomId) after teleport -> global control (c233)
  const s3=state(); spawnRelay(s3); const far3=farWalkable(s3);
  enqueueCommand(s3,{type:'toggle-relay',enabled:true}); stepSimulationTicks(s3,1,neutral());
  enqueueCommand(s3,{type:'teleport-player',x:far3.x,y:far3.y,healToFull:true,migrateEcho:true}); stepSimulationTicks(s3,1,neutral());
  enqueueCommand(s3,{type:'toggle-relay',enabled:false});
  const ev3=stepSimulationTicks(s3,1,neutral());
  rec('M06 human R (no originRoomId) in new room still toggles old-room device',s3.signal.relay==='INACTIVE'&&signalExitOpen(s3.signal)===false&&ev3.filter((e:any)=>e.type==='signal-relay-changed').length===1,'human toggle after teleport',JSON.stringify({relay:s3.signal.relay,exitOpen:signalExitOpen(s3.signal),changed:ev3.filter((e:any)=>e.type==='signal-relay-changed').length}));
  const summary={total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R};
  console.log('SUMMARY',JSON.stringify({total:summary.total,pass:summary.pass,fail:summary.fail}));
  require('node:fs').writeFileSync(`${OUT}/04-origin-schema-core.json`,JSON.stringify(summary,null,2));
}
main();
