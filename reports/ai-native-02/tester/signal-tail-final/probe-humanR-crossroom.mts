// Independent Tester — human R cross-room control comparison (c233 vs 4b938a5).
// Scenario A: device in room A ACTIVE; player teleports to room B; a FRESH R
//   (toggle) in room B — does it still control the global device (c233) or get
//   rejected (4b938a5)?
// Scenario B: a toggle queued in the SAME tick as the teleport (before commit) —
//   must still run in the old room.
import { basePlayerData, xpForLevel } from 'SNAP/src/config/game.ts';
import { MapGenerator, assignRoles, guaranteeReachable } from 'SNAP/src/world/MapGenerator.ts';
import { createSimulationState, enqueueCommand, stepSimulationTicks, isWalkableFromState } from 'SNAP/src/world/sim/core.ts';
import { roomAt } from 'SNAP/src/config/supplies.ts';
import { signalExitOpen } from 'SNAP/src/world/sim/signalState.ts';
const OUT=process.env.OUTDIR as string;
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const neutral=()=>({move:{x:0,y:0},dash:false,fire:false,aim:null,interact:false});
function playerData(){return{...basePlayerData(),level:1,xp:0,xpToNext:xpForLevel(1),currency:0,weaponKey:'pulse',weapons:[{key:'pulse',level:1,ammo:-1,magazine:-1,reloading:false,reloadTimer:0}],upgrades:[],abilities:[]} as any;}
function state(){const gen=new MapGenerator(424242);const map=gen.generate();assignRoles(gen,map.rooms,map.roomsOrder);guaranteeReachable(map);const s=createSimulationState({seed:424242,map,playerData:playerData(),playerX:0,playerY:0});for(const row of map.tiles)for(const tile of row){if((tile.type==='floor'||tile.type==='spawn')&&isWalkableFromState(s,tile.x,tile.y,0.5)){s.player.x=tile.x;s.player.y=tile.y;return s;}}return s;}
function spawnRelay(s:any){const pr=roomAt(s.map.rooms,s.player.x,s.player.y)?.id??0;enqueueCommand(s,{type:'spawn-signal-device',deviceId:'relay_main',roomId:pr,x:s.player.x,y:s.player.y});stepSimulationTicks(s,1,neutral());return s.signal;}
function farWalkable(s:any){const deviceRoom=s.signal.roomId;let best:any=null;let bestD=Infinity;for(const row of s.map.tiles)for(const tile of row){if(!isWalkableFromState(s,tile.x,tile.y,0.5))continue;const r=roomAt(s.map.rooms,tile.x,tile.y);if(!r||r.id===deviceRoom)continue;const d=Math.hypot(tile.x-s.signal.x,tile.y-s.signal.y);if(d<bestD){bestD=d;best={x:tile.x,y:tile.y};}}return best;}

function main(){
  const tag=process.env.SNAPTAG as string;
  // Scenario A: fresh toggle after teleport committed
  const s=state(); const dev=spawnRelay(s);
  enqueueCommand(s,{type:'toggle-relay',enabled:true}); stepSimulationTicks(s,1,neutral());
  const activeBefore=s.signal.relay;
  const far=farWalkable(s);
  enqueueCommand(s,{type:'teleport-player',x:far.x,y:far.y,healToFull:true,migrateEcho:true}); stepSimulationTicks(s,1,neutral());
  const playerRoom=roomAt(s.map.rooms,s.player.x,s.player.y)?.id;
  const deviceRoom=s.signal.roomId;
  const crossed = playerRoom!==deviceRoom;
  // FRESH human R in the new room
  enqueueCommand(s,{type:'toggle-relay',enabled:false});
  const evs=stepSimulationTicks(s,1,neutral());
  const relayAfter=s.signal.relay;
  const toggled = relayAfter!==activeBefore; // became INACTIVE => global control worked
  const changedEvent = evs.some((e:any)=>e.type==='signal-relay-changed');
  rec(`${tag}-A device-in-old-room fresh R after cross-room: control ${toggled?'APPLIED (global)':'REJECTED'}`,
    true,'fresh toggle after teleport',JSON.stringify({activeBefore,relayAfter,playerRoom,deviceRoom,crossed,toggled,changedEvent,exitOpen:signalExitOpen(s.signal)}));
  // Scenario B: toggle queued in the SAME tick as teleport (before commit)
  const s2=state(); spawnRelay(s2);
  enqueueCommand(s2,{type:'toggle-relay',enabled:true}); stepSimulationTicks(s2,1,neutral());
  const far2=farWalkable(s2);
  // queue teleport + toggle in the same pending batch, teleport first
  enqueueCommand(s2,{type:'teleport-player',x:far2.x,y:far2.y,healToFull:true,migrateEcho:true});
  enqueueCommand(s2,{type:'toggle-relay',enabled:false});
  const evs2=stepSimulationTicks(s2,1,neutral());
  const relayB=s2.signal.relay;
  const toggledB = relayB!=='ACTIVE';
  rec(`${tag}-B toggle queued with teleport (same tick): ${toggledB?'runs in old room':'rejected'}`,
    true,'teleport+toggle same tick',JSON.stringify({relayAfter:relayB,toggledB,changedEvent:evs2.some((e:any)=>e.type==='signal-relay-changed')}));
  // Scenario C: toggle queued BEFORE the teleport in the same tick => runs in old room
  const s3=state(); spawnRelay(s3);
  const far3=farWalkable(s3);
  enqueueCommand(s3,{type:'toggle-relay',enabled:true});
  enqueueCommand(s3,{type:'teleport-player',x:far3.x,y:far3.y,healToFull:true,migrateEcho:true});
  const evs3=stepSimulationTicks(s3,1,neutral());
  rec(`${tag}-C toggle queued BEFORE teleport same tick: ${s3.signal.relay==='ACTIVE'?'runs in old room (ACTIVE)':'rejected'}`,
    true,'toggle then teleport same tick',JSON.stringify({relay:s3.signal.relay,exitOpen:signalExitOpen(s3.signal),changed:evs3.some((e:any)=>e.type==='signal-relay-changed')}));
  // Scenario D: toggle committed in a PRIOR tick (ACTIVE), then teleport => effect preserved
  const s4=state(); spawnRelay(s4);
  enqueueCommand(s4,{type:'toggle-relay',enabled:true}); stepSimulationTicks(s4,1,neutral());
  const activePre=s4.signal.relay;
  const far4=farWalkable(s4);
  enqueueCommand(s4,{type:'teleport-player',x:far4.x,y:far4.y,healToFull:true,migrateEcho:true}); stepSimulationTicks(s4,1,neutral());
  rec(`${tag}-D toggle committed in prior tick then teleport: effect ${s4.signal.relay==='ACTIVE'?'PRESERVED':'lost'}`,
    true,'prior-tick toggle + teleport',JSON.stringify({activePre,relayAfter:s4.signal.relay,exitOpen:signalExitOpen(s4.signal)}));
  const summary={tag,total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R};
  console.log('SUMMARY',JSON.stringify({tag,total:summary.total,pass:summary.pass,fail:summary.fail}));
  require('node:fs').writeFileSync(`${OUT}/humanR-${tag}.json`,JSON.stringify(summary,null,2));
}
main();
