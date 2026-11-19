import { CompanionFacet, CompanionOwnerLedger, createOwnerCapability, type CompanionObservationView } from './src/ai-native/companionFacet';
let failures=0; const check=(n:string,c:boolean,d?:unknown)=>{if(c)console.log('PASS',n);else{failures++;console.log('FAIL',n,JSON.stringify(d));}};
const info=(n:string,d?:unknown)=>console.log('INFO',n,JSON.stringify(d));
let idc=0; const S='ses_aaaaaaaaaaaaaaaaaaaaaaaa';
const mk=()=>new CompanionFacet({session:S,epoch:1,suggestionIdFactory:()=>`sug_${(++idc).toString(16).padStart(24,'0')}`});
const v=(tick:number)=>({epoch:1,tick,echo:{x:0,y:0,hp:100,maxHp:100,aimYaw:0},player:{x:2,y:0},drones:[{id:1,x:1,y:0,hp:20}]} as CompanionObservationView);
// Backwards-tick decision
{
  const f=mk(); f.observe(v(500));
  const s=f.suggest({kind:'move',reason:'perceived_hostile',target:{x:1,y:0},ttlTicks:600});
  if(!s.ok) throw new Error('suggest failed');
  const L=new CompanionOwnerLedger(f);
  const d=L.decide({capability:createOwnerCapability(S),suggestionId:s.value.suggestionId,decision:'confirm',epoch:1,tick:0});
  info('decide at tick=0 while suggestion createdAtTick=500', {ok:d.ok, code:d.ok?undefined:(d as any).code, decidedAtTick:d.ok?d.value.decidedAtTick:undefined});
  check('decide does NOT reject a tick BEFORE createdAtTick (contract gap)', d.ok);
}
// decision enum not runtime-validated
{
  const f=mk(); f.observe(v(10));
  const s=f.suggest({kind:'move',reason:'perceived_hostile',ttlTicks:600});
  if(!s.ok) throw new Error('suggest failed');
  const L=new CompanionOwnerLedger(f);
  const d=L.decide({capability:createOwnerCapability(S),suggestionId:s.value.suggestionId,decision:'anything' as any,epoch:1,tick:11});
  info('decide with decision="anything"', {ok:d.ok, recorded:d.ok?(d.value as any).decision:undefined});
  check('decide does NOT runtime-validate decision enum (transport must strict-schema)', d.ok);
}
// repeated confirm across DIFFERENT suggestions requires one decision each
{
  const f=mk(); f.observe(v(10));
  const a=f.suggest({kind:'move',reason:'perceived_hostile',ttlTicks:600});
  const b=f.suggest({kind:'move',reason:'perceived_hostile',ttlTicks:600});
  if(!a.ok||!b.ok) throw new Error('suggest failed');
  const L=new CompanionOwnerLedger(f); const cap=createOwnerCapability(S);
  const d1=L.decide({capability:cap,suggestionId:a.value.suggestionId,decision:'confirm',epoch:1,tick:11});
  const d2=L.decide({capability:cap,suggestionId:b.value.suggestionId,decision:'confirm',epoch:1,tick:11});
  check('two distinct suggestions each need their own decision', d1.ok&&d2.ok&&L.list().length===2);
  const d3=L.decide({capability:cap,suggestionId:a.value.suggestionId,decision:'confirm',epoch:1,tick:12});
  check('re-confirm of an already-decided id still E_RETRYABLE', !d3.ok&&(d3 as any).code==='E_RETRYABLE');
  check('list stays at 2 (no double execution)', L.list().length===2);
}
console.log(`LEDGER_EDGES_${failures===0?'PASS':'FAIL'} failures=${failures}`); if(failures>0)process.exit(1);
