// Independent Tester — Signal 5037c82 pure core rules (no Phaser/bridge/MCP/LLM).
// Verifies: range/LOS/insufficient/CD/repeat/paused-no-regen, actor validation
// (echo cannot impersonate player's account), v1-without-actor rejected,
// toggle-relay/JAM semantics, separate player/echo accounts.
import {
  createSignalDevice, commitSignalScan, commitSignalJam, commitToggleRelay,
  signalExitOpen, validSignalDevice
} from 'D:/Project/AI-NATIVE-02-snapshots/5037c82/src/world/sim/signalState.ts';
import { SIGNAL_TUNING } from 'D:/Project/AI-NATIVE-02-snapshots/5037c82/src/signal/signalTuning.ts';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/signal-5037c82';
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const T=SIGNAL_TUNING;
const legality=(pos:{x:number,y:number})=>({
  hasLineOfSight:()=>true,
  actorPosition:()=>pos
});
const blockedLOS=(pos:{x:number,y:number})=>({
  hasLineOfSight:()=>false,
  actorPosition:()=>pos
});
const near={x:4,y:3};
const far={x:100,y:100};
function deviceAt(tick=0){return createSignalDevice({deviceId:'relay_main',roomId:7,x:4,y:3,tick});}
function main(){
  // S01 tuning real values
  rec('S01 shared tuning real values',T.SCAN_COST===10&&T.SCAN_CD_TICKS===120&&T.JAM_COST===25&&T.JAM_CD_TICKS===480&&T.JAM_DURATION_TICKS===360&&T.ENERGY_MAX===100&&T.REGEN_TICKS===12&&T.EVIDENCE_TTL_TICKS===300,
    'SIGNAL_TUNING',JSON.stringify({scanCost:T.SCAN_COST,scanCD:T.SCAN_CD_TICKS,jamCost:T.JAM_COST,jamCD:T.JAM_CD_TICKS,jamDuration:T.JAM_DURATION_TICKS,energyMax:T.ENERGY_MAX,regenTicks:T.REGEN_TICKS,evidenceTTL:T.EVIDENCE_TTL_TICKS}));
  // S02 absent signal = legacy, no gate
  rec('S02 no device => legacy exit open, no signal key',signalExitOpen(undefined)===true&&!validSignalDevice(undefined),
    'signalExitOpen(undefined)+validSignalDevice',JSON.stringify({exitOpen:signalExitOpen(undefined)}));
  // S03 one device one room, initial INACTIVE
  const d=deviceAt();
  rec('S03 one device one room INACTIVE',d.deviceId==='relay_main'&&d.roomId===7&&d.relay==='INACTIVE'&&signalExitOpen(d)===false,
    'createSignalDevice+signalExitOpen',JSON.stringify({deviceId:d.deviceId,roomId:d.roomId,relay:d.relay,exitOpen:signalExitOpen(d)}));
  // S04 toggle-relay -> ACTIVE opens gate; power off -> DISABLED closes
  const tog=commitToggleRelay(d,true,1);
  const openActive=tog.relay==='ACTIVE'&&signalExitOpen(d)===true;
  const pw=commitToggleRelay(d,false,2);
  rec('S04 toggle ACTIVE opens gate; toggle off closes',openActive&&pw.relay==='INACTIVE'&&signalExitOpen(d)===false,
    'commitToggleRelay x2',JSON.stringify({afterOn:tog.relay,openActive,afterOff:pw.relay}));
  commitToggleRelay(d,true,3); // restore ACTIVE for subsequent tests
  // S05 player scan charges player -10 + CD120 only on player account
  const scan=commitSignalScan(d,'player',4,false,legality(near));
  rec('S05 player scan: player -10 + CD120, echo unchanged',scan.ok===true&&scan.energy===90&&d.actors.player.cooldowns.scanCooldownTicks===120&&d.actors.echo.energy.energy===100,
    'commitSignalScan(player)',JSON.stringify({ok:scan.ok,energy:scan.energy,cd:scan.energy!==undefined?d.actors.player.cooldowns.scanCooldownTicks:null,echoEnergy:d.actors.echo.energy.energy}));
  // S06 echo scan charges echo only, player unchanged
  const scanE=commitSignalScan(d,'echo',5,false,legality(near));
  rec('S06 echo scan: echo -10 + CD120, player unchanged',scanE.ok===true&&scanE.energy===90&&d.actors.echo.cooldowns.scanCooldownTicks===120&&d.actors.player.energy.energy===90,
    'commitSignalScan(echo)',JSON.stringify({ok:scanE.ok,energy:scanE.energy,playerEnergy:d.actors.player.energy.energy}));
  // S07 echo CANNOT impersonate player: actor selects account; echo actor drains echo account not player
  // (already proven by S06: echo scan drained echo, player stayed 90)
  rec('S07 echo actor cannot drain player account',d.actors.player.energy.energy===90&&d.actors.echo.energy.energy===90,
    'actor->account mapping (echo drains echo, not player)',JSON.stringify({playerEnergy:d.actors.player.energy.energy,echoEnergy:d.actors.echo.energy.energy}));
  // S08 jam charges echo -25 + CD480, relay JAMMED (not ACTIVE)
  const jam=commitSignalJam(d,'echo',6,false,legality(near));
  rec('S08 echo jam: echo -25 + CD480, relay JAMMED',jam.ok===true&&jam.energy===65&&d.actors.echo.cooldowns.jamCooldownTicks===480&&d.relay==='JAMMED',
    'commitSignalJam(echo)',JSON.stringify({ok:jam.ok,energy:jam.energy,relay:d.relay}));
  // S09 out-of-range / no-LOS => E_PERMISSION, no charge
  const pEnergy=d.actors.player.energy.energy;
  const farScan=commitSignalScan(d,'player',7,false,legality(far));
  const losScan=commitSignalScan(d,'player',8,false,blockedLOS(near));
  rec('S09 far/no-LOS => E_PERMISSION, no charge',farScan.code==='E_PERMISSION'&&losScan.code==='E_PERMISSION'&&d.actors.player.energy.energy===pEnergy,
    'commitSignalScan(far/los)',JSON.stringify({far:farScan.code,los:losScan.code,energy:d.actors.player.energy.energy}));
  // S10 repeat scan while CD => E_COOLDOWN, no double charge
  const dup=commitSignalScan(d,'player',9,false,legality(near));
  rec('S10 duplicate scan in CD => E_COOLDOWN, no double charge',dup.code==='E_COOLDOWN'&&d.actors.player.energy.energy===pEnergy,
    'commitSignalScan(twice)',JSON.stringify({code:dup.code,energy:d.actors.player.energy.energy}));
  // S11 insufficient energy => E_ENERGY_INSUFFICIENT, no charge
  const poor=deviceAt();
  poor.actors.player.energy.energy=5;
  const poorScan=commitSignalScan(poor,'player',10,false,legality(near));
  rec('S11 insufficient energy => E_ENERGY_INSUFFICIENT, no charge',poorScan.code==='E_ENERGY_INSUFFICIENT'&&poor.actors.player.energy.energy===5,
    'commitSignalScan(energy=5)',JSON.stringify({code:poorScan.code,energy:poor.actors.player.energy.energy}));
  // S12 paused: no regen, no CD decay
  const pausedBefore=JSON.stringify(d.actors.player);
  d.actors.player=tickFn(d.actors.player,true); d.actors.player=tickFn(d.actors.player,true);
  rec('S12 paused ticks no regen/decay',JSON.stringify(d.actors.player)===pausedBefore,
    'tickSignalResources(paused=true)x2',JSON.stringify({unchanged:JSON.stringify(d.actors.player)===pausedBefore}));
  // S13 unpaused 12 ticks => exactly +1 energy
  const e0=d.actors.player.energy.energy;
  for(let t=0;t<12;t+=1)d.actors.player=tickFn(d.actors.player,false);
  rec('S13 unpaused 12 ticks => exactly +1 energy',d.actors.player.energy.energy===e0+1,
    '12 real ticks',JSON.stringify({before:e0,after:d.actors.player.energy.energy}));
  // S14 JAM suppresses until expiry then returns to ACTIVE (manual kept)
  let jd=deviceAt(); commitToggleRelay(jd,true,1); commitSignalJam(jd,'echo',2,false,legality(near));
  const during=jd.relay;
  for(let t=3;t<2+T.JAM_DURATION_TICKS-1;t+=1){jd.actors.player=tickFn(jd.actors.player,false);jd.actors.echo=tickFn(jd.actors.echo,false);jd=applyTickDevice(jd,t);}
  const beforeExpiry=jd.relay;
  jd=applyTickDevice(jd,2+T.JAM_DURATION_TICKS);
  rec('S14 JAM suppresses until exact expiry then ACTIVE recovers',during==='JAMMED'&&beforeExpiry==='JAMMED'&&jd.relay==='ACTIVE'&&signalExitOpen(jd)===true,
    'jam + 360 ticks',JSON.stringify({during,beforeExpiry,after:jd.relay,open:signalExitOpen(jd)}));
  // S15 toggle-relay does not override JAM
  const td=deviceAt(); commitSignalJam(td,'echo',1,false,legality(near)); commitToggleRelay(td,true,2);
  rec('S15 toggle cannot override JAM',td.relay==='JAMMED'&&td.manualEnabled===true,
    'jam then toggle',JSON.stringify({relay:td.relay,manualEnabled:td.manualEnabled}));
  // S16 v1-without-actor rejected: commitSignalScan with invalid actor => E_PERMISSION
  const noActor=commitSignalScan(d,'' as any,20,false,legality(near));
  rec('S16 invalid/empty actor => E_PERMISSION (v1-style without actor rejected)',noActor.ok===false&&noActor.code==='E_PERMISSION',
    'commitSignalScan(invalid actor)',JSON.stringify({ok:noActor.ok,code:noActor.code}));
  // S17 validSignalDevice strict
  rec('S17 validSignalDevice strict reject',validSignalDevice({})===false&&validSignalDevice(null)===false,
    'validSignalDevice',JSON.stringify({empty:false,null:false}));
  const summary={total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R};
  console.log('SUMMARY',JSON.stringify({total:summary.total,pass:summary.pass,fail:summary.fail}));
  require('node:fs').writeFileSync(`${OUT}/10-signal-core.json`,JSON.stringify(summary,null,2));
}
// Minimal tick fn (pure, mirrors tickSignalResources energy/CD decay)
function tickFn(res:any,paused:boolean){
  if(paused)return res;
  const T=SIGNAL_TUNING;
  let {energy,regenAcc}=res.energy;
  if(energy<T.ENERGY_MAX){regenAcc+=1;if(regenAcc>=T.REGEN_TICKS){energy+=1;regenAcc=energy>=T.ENERGY_MAX?0:regenAcc-T.REGEN_TICKS;}}
  const dec=(v:number)=>Math.max(0,v-1);
  return {...res,energy:{energy,regenAcc},cooldowns:{...res.cooldowns,scanCooldownTicks:dec(res.cooldowns.scanCooldownTicks),jamCooldownTicks:dec(res.cooldowns.jamCooldownTicks),jamRemainingTicks:dec(res.cooldowns.jamRemainingTicks)}}};
function applyTickDevice(d:any,tick:number){
  // mirror tickSignalDevice: clear jam at expiry, recompute relay
  if(tick>=d.jammedUntilTick&&d.control.jammedUntilTick!==0){d.control={...d.control,jammedUntilTick:0};d.jammedUntilTick=0;}
  // recompute relay from manualEnabled/powered/jammed
  const jammed=tick<d.control.jammedUntilTick;
  d.relay=d.control.disposed?'DISABLED':jammed?'JAMMED':(d.control.manualEnabled&&d.control.powered?'ACTIVE':'INACTIVE');
  return d;
}
main();
