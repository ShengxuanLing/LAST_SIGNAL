// Independent Tester — 4b938a5 stale applied generation guard.
// Stale (room-cancelled) decision: omitting generation/room evidence must NOT flip
// to applied; the CORRECT original generation/room is the only accepted late report;
// a wrong generation is refused. Non-stale records keep the loose contract.
import { WorldGateway } from 'D:/Project/AI-NATIVE-02-snapshots/c2a31af/src/ai-native/worldGateway.ts';
import { CompanionGateway } from 'D:/Project/AI-NATIVE-02-snapshots/c2a31af/src/ai-native/companionGateway.ts';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/signal-origin-final';
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const wg=new WorldGateway(); const cg=new CompanionGateway(wg);
const linked=wg.linkSession({authorized:true,origin:'http://localhost:5392',nowMs:Date.now()}) as any;
const s=linked.session as string, e=linked.epoch as number;
cg.authorize(s,e,'human');
// mirror the real authorize path: notify the START room FIRST (generation 0->1, roomId=0)
cg.roomChanged(s,e,0,9,1);
const obs=(tick:number,roomId:number|null)=>({epoch:e,tick,roomId,player:{x:0,y:0},echo:{x:0,y:0,hp:100,maxHp:100,aimYaw:0},drones:[{id:1,x:1,y:0,hp:5}],schema:'last_signal.echo-observation.v1',perception:{center:{x:0,y:0},radiusTiles:12,requiresExplored:true,requiresLineOfSight:true},targets:[]});
cg.pushObservation(s,e,obs(10,0));
const sugId='sug_'+'a'.repeat(24);
const prop=cg.suggest({session:s,epoch:e,requestId:'req_'+'a'.repeat(24),suggestionId:sugId,kind:'fire',reason:'perceived_hostile',target:{x:1,y:0},ttlTicks:600});
rec('G01 propose in room 0',prop.ok===true,'suggest',JSON.stringify({ok:prop.ok}));
const dec=cg.decide({session:s,epoch:e,suggestionId:sugId,decision:'confirm',tick:12});
rec('G02 confirm decision recorded (applied=false)',dec.ok===true&&(dec.value as any).applied===false,'decide',JSON.stringify({ok:dec.ok,value:(dec.value as any)}));
const rc=cg.roomChanged(s,e,1,20,2);
rec('G03 room change makes the confirmed-unapplied decision stale',rc.ok===true,'roomChanged(room=1)',JSON.stringify({ok:rc.ok,value:rc.value}));
// NEGATIVE: omit generation/room evidence
const omit=cg.markApplied(s,sugId,21);
rec('G04 stale applied OMITTING generation/room refused E_STALE_GENERATION',omit.ok===false&&(omit as any).code==='E_STALE_GENERATION','markApplied(no execution)',JSON.stringify({ok:omit.ok,code:(omit as any).code,messageKey:(omit as any).messageKey}));
// NEGATIVE: wrong generation
const wrong=cg.markApplied(s,sugId,21,{generation:1,roomId:1});
rec('G05 stale applied with WRONG generation refused',wrong.ok===false&&(wrong as any).code==='E_STALE_GENERATION','markApplied(generation=1,room=1)',JSON.stringify({ok:wrong.ok,code:(wrong as any).code}));
// NEGATIVE: correct generation but wrong room
const wrongRoom=cg.markApplied(s,sugId,21,{generation:0,roomId:1});
rec('G06 stale applied correct generation but WRONG room refused',wrongRoom.ok===false&&(wrongRoom as any).code==='E_STALE_GENERATION','markApplied(gen=0,room=1)',JSON.stringify({ok:wrongRoom.ok,code:(wrongRoom as any).code}));
// POSITIVE: correct original generation + room
const good=cg.markApplied(s,sugId,21,{generation:1,roomId:0});
rec('G07 stale applied with CORRECT original generation/room accepted',good.ok===true&&(good.value as any).applied===true,'markApplied(gen=1,room=0)',JSON.stringify({ok:good.ok,value:(good.value as any)}));
// Non-stale loose contract: fresh room-1 proposal/decision, omit evidence -> accepted
cg.pushObservation(s,e,obs(22,1));
const sug2='sug_'+'b'.repeat(24);
cg.suggest({session:s,epoch:e,requestId:'req_'+'b'.repeat(24),suggestionId:sug2,kind:'fire',reason:'perceived_hostile',target:{x:1,y:0},ttlTicks:600});
cg.decide({session:s,epoch:e,suggestionId:sug2,decision:'confirm',tick:23});
const loose=cg.markApplied(s,sug2,24);
rec('G08 NON-stale record omitting evidence still accepted (loose contract)',loose.ok===true&&(loose.value as any).applied===true,'markApplied(non-stale, no execution)',JSON.stringify({ok:loose.ok,value:(loose.value as any)}));
const summary={total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R};
console.log('SUMMARY',JSON.stringify({total:summary.total,pass:summary.pass,fail:summary.fail}));
require('node:fs').writeFileSync(`${OUT}/06-stale-applied.json`,JSON.stringify(summary,null,2));
