import { WorldGateway } from './src/ai-native/worldGateway';
import { CompanionGateway } from './src/ai-native/companionGateway';
let failures=0; const check=(n:string,c:boolean,d?:unknown)=>{if(c)console.log('PASS',n);else{failures++;console.log('FAIL',n,JSON.stringify(d));}};
const info=(n:string,d?:unknown)=>console.log('INFO',n,JSON.stringify(d));
const wg=new WorldGateway(); const l=wg.linkSession({authorized:true,origin:'http://localhost:5412',nowMs:Date.now()});
if(!l.ok) throw new Error('link');
const cg=new CompanionGateway(wg); const {session,epoch}=l;
cg.authorize(session,epoch,'human');
cg.pushObservation(session,epoch,{epoch,tick:10,player:{x:0,y:0},echo:{x:0,y:0,hp:100,maxHp:100,aimYaw:0},
  drones:[{id:1,x:1,y:0,hp:5}],schema:'last_signal.echo-observation.v1',
  perception:{center:{x:0,y:0},radiusTiles:12,requiresExplored:true,requiresLineOfSight:true},targets:[]});
const id='sug_'+'a'.repeat(24);
cg.suggest({session,epoch,requestId:'req_'+'a'.repeat(24),suggestionId:id,kind:'fire',reason:'perceived_hostile',target:{x:1,y:0},ttlTicks:600});
// Gateway decide: tick BEFORE createdAtTick (created at 10)
const early = cg.decide({session,epoch,suggestionId:id,decision:'confirm',tick:0});
info('gateway.decide with tick=0 (before createdAtTick=10)', {ok:early.ok, value:early.ok?early.value:undefined, code:early.ok?undefined:(early as any).code});
check('GAP: gateway.decide does NOT enforce tick>=createdAtTick (pure ledger does)', early.ok === true);
// decision enum not runtime validated at gateway level
const id2='sug_'+'b'.repeat(24);
cg.suggest({session,epoch,requestId:'req_'+'b'.repeat(24),suggestionId:id2,kind:'fire',reason:'perceived_hostile',target:{x:1,y:0},ttlTicks:600});
const weird = cg.decide({session,epoch,suggestionId:id2,decision:'anything' as any,tick:11});
info('gateway.decide with decision="anything"', {ok:weird.ok, value:weird.ok?weird.value:undefined});
check('GAP: gateway.decide does NOT runtime-validate decision enum', weird.ok === true);
console.log(`GATEWAY_DECIDE_${failures===0?'PASS':'FAIL'} failures=${failures}`); if(failures>0)process.exit(1);
