// Independent Tester — 246469b core: cooldown rejects with NO charge, then recovers.
import { createSignalDevice, commitSignalScan, tickSignalDevice } from 'D:/Project/AI-NATIVE-02-snapshots/246469b/src/world/sim/signalState.ts';
import { SIGNAL_TUNING as T } from 'D:/Project/AI-NATIVE-02-snapshots/246469b/src/signal/signalTuning.ts';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/signal-field-fix';
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const near={hasLineOfSight:()=>true,actorPosition:()=>({x:3,y:3})};
const d=createSignalDevice({deviceId:'relay_main',roomId:0,x:3,y:3,tick:0});
function tickTo(t:number){for(let i=0;i<t;i++)tickSignalDevice(d,tickBase+i,false);}
let tickBase=1;
const scan1=commitSignalScan(d,'player',1,false,near);
const e1=d.actors.player.energy.energy, cd1=d.actors.player.cooldowns.scanCooldownTicks;
rec('C01 first scan charges -10 + CD>0',scan1.ok===true&&e1===90&&cd1===120,'commitSignalScan x1',JSON.stringify({ok:scan1.ok,energy:e1,cd:cd1}));
const scan2=commitSignalScan(d,'player',2,false,near);
const e2=d.actors.player.energy.energy;
rec('C02 scan during CD rejected E_COOLDOWN, NO charge',scan2.code==='E_COOLDOWN'&&e2<=90,'commitSignalScan during CD',JSON.stringify({code:scan2.code,energy:e2}));
// advance exactly the scan cooldown ticks (unpaused) -> CD should reach 0
tickTo(120);
const cdAfter=d.actors.player.cooldowns.scanCooldownTicks;
rec('C03 after CD ticks, cooldown recovers to 0',cdAfter===0,'120 real unpaused ticks',JSON.stringify({cd:cdAfter}));
const eBefore3=d.actors.player.energy.energy;
const scan3=commitSignalScan(d,'player',200,false,near);
rec('C04 scan after recovery accepted + charged',scan3.ok===true&&d.actors.player.energy.energy<eBefore3&&d.actors.player.cooldowns.scanCooldownTicks===120,'commitSignalScan after recovery',JSON.stringify({ok:scan3.ok,before:eBefore3,after:d.actors.player.energy.energy}));
// insufficient energy: no charge
const poor=createSignalDevice({deviceId:'p',roomId:0,x:3,y:3,tick:0}); poor.actors.player.energy.energy=5;
const ps=commitSignalScan(poor,'player',1,false,near);
rec('C05 insufficient energy => E_ENERGY_INSUFFICIENT, NO charge',ps.code==='E_ENERGY_INSUFFICIENT'&&poor.actors.player.energy.energy===5,'commitSignalScan energy=5',JSON.stringify({code:ps.code,energy:poor.actors.player.energy.energy}));
const summary={total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R};
console.log('SUMMARY',JSON.stringify({total:summary.total,pass:summary.pass,fail:summary.fail}));
require('node:fs').writeFileSync(`${OUT}/14-cd-recovery.json`,JSON.stringify(summary,null,2));
