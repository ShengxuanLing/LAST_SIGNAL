// Independent Tester — 363eb17 hidden-relay negative: echo observation must NOT
// reveal a relay it does not perceive (out of radius / unexplored / no LOS).
import { buildEchoObservation } from 'D:/Project/AI-NATIVE-02-snapshots/363eb17/src/world/echoView.ts';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/signal-taskc-final';
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const echo:any={id:1,x:10,y:10,aimYaw:0,data:{hp:100,maxHp:100}};
const isExploredTrue=()=>true, isOpaqueFalse=()=>false, isOpaqueTrue=()=>true, isExploredFalse=()=>false;
const sig=(x:number,y:number)=>({deviceId:'relay_main',x,y,relay:'INACTIVE',powered:true,manualEnabled:false,jammedUntilTick:0});
const base=(signal:any,isExplored:any,isOpaque:any)=>buildEchoObservation({echo,player:{x:10,y:10},tick:5,drones:[],targets:[],isExplored,isOpaque,signal,energy:{current:100,max:100},cooldowns:{scanTicks:0,jamTicks:0}} as any);
function main(){
  const inRange=base(sig(11,10),isExploredTrue,isOpaqueFalse);
  rec('H01 perceived relay IS reported when in radius+explored+LOS',!!inRange.relay&&inRange.relay.id==='relay_main','buildEchoObservation near','relay='+JSON.stringify(inRange.relay));
  const far=base(sig(1000,1000),isExploredTrue,isOpaqueFalse);
  rec('H02 HIDDEN relay out of radius NOT reported',!far.relay,'buildEchoObservation far','relay='+JSON.stringify(far.relay));
  const unexplored=base(sig(11,10),isExploredFalse,isOpaqueFalse);
  rec('H03 relay in radius but UNEXPLORED NOT reported',!unexplored.relay,'buildEchoObservation unexplored','relay='+JSON.stringify(unexplored.relay));
  const noLos=base(sig(11,10),isExploredTrue,isOpaqueTrue);
  rec('H04 relay in radius+explored but no LOS NOT reported',!noLos.relay,'buildEchoObservation blocked LOS','relay='+JSON.stringify(noLos.relay));
  // relay absent (no device) => no relay key
  const none=base(null,isExploredTrue,isOpaqueFalse);
  rec('H05 no device => no relay field',!none.relay,'buildEchoObservation no device','relay='+JSON.stringify(none.relay));
  const summary={total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R};
  console.log('SUMMARY',JSON.stringify({total:summary.total,pass:summary.pass,fail:summary.fail}));
  require('node:fs').writeFileSync(`${OUT}/13-hidden-relay.json`,JSON.stringify(summary,null,2));
}
main();
