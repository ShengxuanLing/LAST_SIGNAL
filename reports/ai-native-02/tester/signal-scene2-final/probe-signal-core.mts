// Independent Tester — Signal pure/engine rules on frozen c1cc2dd.
// Production modules only; no test fixtures; no LLM.
import { SIGNAL_TUNING } from 'D:/Project/AI-NATIVE-02-snapshots/c1cc2dd/src/signal/signalTuning.ts';
const T = SIGNAL_TUNING;
import {
  createSignalResources, tickSignalResources, tryScan, tryJam
} from 'D:/Project/AI-NATIVE-02-snapshots/c1cc2dd/src/signal/signalCore.ts';
import {
  createSignalDevice, commitSignalScan, commitSignalJam, commitToggleRelay,
  commitSignalPower, tickSignalDevice, signalExitOpen, signalEvidenceVisible
} from 'D:/Project/AI-NATIVE-02-snapshots/c1cc2dd/src/world/sim/signalState.ts';

const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/signal-scene2-final';
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const pos=(x:number,y:number)=>({x,y});
const near={hasLineOfSight:()=>true,actorPosition:(a:'player'|'echo')=>a==='player'?pos(3,3):pos(2,3)};
const far={hasLineOfSight:()=>true,actorPosition:(a:'player'|'echo')=>a==='player'?pos(100,100):pos(100,100)};
const blocked={hasLineOfSight:()=>false,actorPosition:(a:'player'|'echo')=>a==='player'?pos(3,3):pos(2,3)};

function main(){
  // Tuning truth.
  rec('S01 shared tuning real values',T.SCAN_COST===10&&T.SCAN_CD_TICKS===120&&T.JAM_COST===25&&T.JAM_CD_TICKS===480&&T.JAM_DURATION_TICKS===360&&T.ENERGY_MAX===100&&T.REGEN_TICKS===12,
    'SIGNAL_TUNING',JSON.stringify({scanCost:T.SCAN_COST,scanCD:T.SCAN_CD_TICKS,jamCost:T.JAM_COST,jamCD:T.JAM_CD_TICKS,jamDuration:T.JAM_DURATION_TICKS,energyMax:T.ENERGY_MAX,regenTicks:T.REGEN_TICKS}));

  // One device / one room.
  const d=createSignalDevice({deviceId:'relay_main',roomId:7,x:4,y:3,tick:0});
  rec('S02 one device one room, initial INACTIVE',d.deviceId==='relay_main'&&d.roomId===7&&d.relay==='INACTIVE'&&!signalExitOpen(d),
    'createSignalDevice + signalExitOpen',JSON.stringify({deviceId:d.deviceId,roomId:d.roomId,relay:d.relay,exitOpen:signalExitOpen(d)}));

  // Owner toggle -> ACTIVE -> exit gate opens; power off -> DISABLED closes.
  const tog=commitToggleRelay(d,true,1);
  const openActive=tog.relay==='ACTIVE'&&signalExitOpen(d);
  const pw=commitSignalPower(d,false,2);
  rec('S03 ACTIVE gate opens; power off closes (INACTIVE)',openActive&&pw.relay==='INACTIVE'&&!signalExitOpen(d),
    'commitToggleRelay + commitSignalPower',JSON.stringify({afterToggle:tog.relay,openActive,afterPower:pw.relay,openDisabled:signalExitOpen(d)}));
  commitSignalPower(d,true,3); commitToggleRelay(d,true,3);

  // Independent actor accounts and real charges.
  const scan=commitSignalScan(d,'player',4,false,near);
  const playerAfter=d.actors.player.energy.energy, echoAfter=d.actors.echo.energy.energy;
  const scanCd=d.actors.player.cooldowns.scanCooldownTicks;
  rec('S04 player scan charges 10 energy + 120 CD only on player',scan.ok&&scan.energy===90&&scanCd===120&&echoAfter===100,
    'commitSignalScan(player)',JSON.stringify({ok:scan.ok,energy:scan.energy,cd:scanCd,echoEnergy:echoAfter}));
  const jam=commitSignalJam(d,'echo',5,false,near);
  const jamCd=d.actors.echo.cooldowns.jamCooldownTicks;
  rec('S05 echo jam charges 25 + 480 CD only on echo, relay JAMMED',jam.ok&&jam.energy===75&&jamCd===480&&d.relay==='JAMMED',
    'commitSignalJam(echo)',JSON.stringify({ok:jam.ok,energy:jam.energy,cd:jamCd,relay:d.relay,playerEnergy:d.actors.player.energy.energy}));

  // Range / LOS / insufficient / duplicate.
  const pEnergy=d.actors.player.energy.energy;
  const farScan=commitSignalScan(d,'player',6,false,far);
  const losScan=commitSignalScan(d,'player',6,false,blocked);
  const dupScan=commitSignalScan(d,'player',7,false,near);
  rec('S06 out-of-range / no-LOS => E_PERMISSION, no charge',farScan.code==='E_PERMISSION'&&losScan.code==='E_PERMISSION'&&d.actors.player.energy.energy===pEnergy,
    'commitSignalScan(far/los)',JSON.stringify({far:farScan.code,los:losScan.code,energy:d.actors.player.energy.energy}));
  rec('S07 duplicate scan while CD => E_COOLDOWN, no double charge',dupScan.code==='E_COOLDOWN'&&d.actors.player.energy.energy===pEnergy,
    'commitSignalScan(twice)',JSON.stringify({code:dupScan.code,energy:d.actors.player.energy.energy}));
  const poor=createSignalDevice({deviceId:'poor',roomId:7,x:4,y:3,tick:0});
  poor.actors.player.energy.energy=5;
  const poorScan=commitSignalScan(poor,'player',8,false,near);
  rec('S08 insufficient energy => E_ENERGY_INSUFFICIENT, no charge',poorScan.code==='E_ENERGY_INSUFFICIENT'&&poor.actors.player.energy.energy===5,
    'commitSignalScan(energy=5)',JSON.stringify({code:poorScan.code,energy:poor.actors.player.energy.energy}));

  // Paused: no regen and no cooldown decay; unpaused regen exactly 1/12t.
  const pausedBefore=JSON.stringify(d.actors.player);
  tickSignalDevice(d,100,true); tickSignalDevice(d,200,true);
  rec('S09 paused ticks do not regen / decay',JSON.stringify(d.actors.player)===pausedBefore,
    'tickSignalDevice(paused=true) x2',JSON.stringify({unchanged:JSON.stringify(d.actors.player)===pausedBefore}));
  const energy0=d.actors.player.energy.energy;
  for(let t=201;t<=212;t++)tickSignalDevice(d,t,false);
  rec('S10 unpaused 12 ticks => exactly +1 energy',d.actors.player.energy.energy===energy0+1,
    '12 real ticks',JSON.stringify({before:energy0,after:d.actors.player.energy.energy}));

  // JAM suppress emission until expiry, then ACTIVE restored (manual+power kept).
  const jd=createSignalDevice({deviceId:'jamtest',roomId:1,x:1,y:1,tick:0});
  commitToggleRelay(jd,true,1);
  commitSignalJam(jd,'echo',2,false,near);
  const during=jd.relay, openDuring=signalExitOpen(jd);
  for(let t=3;t<2+T.JAM_DURATION_TICKS-1;t++)tickSignalDevice(jd,t,false);
  const beforeExpiry=jd.relay;
  tickSignalDevice(jd,2+T.JAM_DURATION_TICKS,false);
  rec('S11 JAM suppresses ACTIVE until exact expiry; recovers',during==='JAMMED'&&!openDuring&&beforeExpiry==='JAMMED'&&jd.relay==='ACTIVE'&&signalExitOpen(jd),
    'commitSignalJam + 360 tickSignalDevice',JSON.stringify({during,beforeExpiry,afterExpiry:jd.relay,openAfter:signalExitOpen(jd),jamUntil:jd.jammedUntilTick}));
  rec('S12 manual toggle cannot override JAM',(()=>{const x=createSignalDevice({deviceId:'m',roomId:1,x:1,y:1,tick:0});commitSignalJam(x,'echo',1,false,near);commitToggleRelay(x,true,2);return x.relay==='JAMMED';})(),
    'commitSignalJam then commitToggleRelay',JSON.stringify({note:'JAM must win over manual toggle'}));

  // No device => legacy run portal always open (no signal key in canonical).
  rec('S13 no-device run: legacy exit open',signalExitOpen(undefined)===true,'signalExitOpen(undefined)',JSON.stringify({exitOpen:signalExitOpen(undefined)}));

  // Evidence TTL is actor-local and expires.
  const ev=createSignalDevice({deviceId:'ev',roomId:1,x:1,y:1,tick:0});
  commitSignalScan(ev,'player',1,false,near);
  const visAt1=signalEvidenceVisible(ev,1);
  const expiryTick=1+T.SCAN_REVEAL_TICKS+1;
  tickSignalDevice(ev,expiryTick,false);
  const visExpire=signalEvidenceVisible(ev,expiryTick);
  rec('S14 evidence visible then expires at reveal TTL',visAt1===true&&visExpire===false,
    'commitSignalScan + signalEvidenceVisible',JSON.stringify({atTick1:visAt1,atExpiry:visExpire,ttl:T.SCAN_REVEAL_TICKS}));

  const summary={total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R};
  console.log('SUMMARY',JSON.stringify({total:summary.total,pass:summary.pass,fail:summary.fail}));
  require('node:fs').writeFileSync(`${OUT}/10-signal-core.json`,JSON.stringify(summary,null,2));
}
main();
