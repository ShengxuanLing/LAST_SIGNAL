// Independent Tester — d690848 lifecycle (v2): hardkill 4s independent lease,
// browser heartbeat cannot renew agent lease, old epoch no action, no double execution.
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { WorldGateway } from 'D:/Project/AI-NATIVE-02-snapshots/d690848/src/ai-native/worldGateway.ts';
import { startWorldBridge } from 'D:/Project/AI-NATIVE-02-snapshots/d690848/src/ai-native/worldBridgeServer.ts';
import { createOwnerCredentialFile, ownerHashFromFile } from 'D:/Project/AI-NATIVE-02-snapshots/d690848/src/ai-native/ownerCredential.ts';
import { WORLD_PROTOCOL_VERSION } from 'D:/Project/AI-NATIVE-02-snapshots/d690848/src/ai-native/worldProtocol.ts';

const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3b-session-final';
const ORIGIN='http://localhost:5392';
const TOKEN=randomBytes(24).toString('hex');
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string,detail:any={})=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result,detail});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result} | ${OUT}/02-lifecycle.json`);};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const obs=(epoch:number,tick:number)=>({epoch,tick,player:{x:0,y:0},echo:{x:0,y:0,hp:100,maxHp:100,aimYaw:0},drones:[{id:1,x:1,y:0,hp:5}],schema:'last_signal.echo-observation.v1',perception:{center:{x:0,y:0},radiusTiles:12,requiresExplored:true,requiresLineOfSight:true},targets:[]});
const stopAction=(c:string)=>({type:'stop',actionId:'act_'+c.repeat(24)});
const brief=(r:any)=>({status:r.status,ok:r.json?.ok,code:r.json?.code,messageKey:r.json?.messageKey,attached:r.json?.attached,statusText:r.json?.status,epoch:r.json?.epoch});

async function main(){
  const cred=await createOwnerCredentialFile();
  const ownerKey=(await readFile(cred.path,'utf8')).trim();
  const bridge=await startWorldBridge({gateway:new WorldGateway(),token:TOKEN,ownerKeyHash:await ownerHashFromFile(cred.path),allowedOrigins:[ORIGIN],heartbeatIntervalMs:50});
  const post=async(p:string,b:any,o?:string)=>{const r=await fetch(bridge.url+p,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${TOKEN}`,...(o?{origin:o}:{})},body:JSON.stringify(b)});return{status:r.status,json:await r.json()};};
  const get=async(p:string,o?:string)=>{const r=await fetch(bridge.url+p,{headers:{authorization:`Bearer ${TOKEN}`,...(o?{origin:o}:{})}});return{status:r.status,json:await r.json()};};
  try{
    // A. Human handshake + authorize; capture the ROTATED cap returned by authorize.
    const hs=await post('/world-link/handshake',{authorized:true,protocolVersion:WORLD_PROTOCOL_VERSION,ownerKey},ORIGIN);
    const s=hs.json.session,e=hs.json.epoch;
    const au=await post('/world-link/companion-authorize',{session:s,epoch:e,ownerCap:hs.json.ownerCap,ownerMode:'human'},ORIGIN);
    const cap=au.json.ownerCap;
    rec('L01 human handshake + authorize',hs.status===200&&au.status===200,'POST handshake+authorize',JSON.stringify({hs:hs.status,au:au.status,rotated:cap!==hs.json.ownerCap}));
    await post('/world-link/companion-observation',{session:s,epoch:e,observation:obs(e,10),ownerCap:cap},ORIGIN);
    const sug=await post('/world-link/companion-suggest',{session:s,epoch:e,requestId:'req_'+'b'.repeat(24),suggestionId:'sug_'+'b'.repeat(24),kind:'fire',reason:'perceived_hostile',target:{x:1,y:0},ttlTicks:600});
    rec('L02 agent propose ok',sug.status===200&&sug.json.ok===true,'POST companion-suggest',JSON.stringify(brief(sug)));

    // B. Agent attach lease; browser heartbeat runs; agent never renews (hardkill).
    const at=await post('/world-link/attach',{session:s});
    const leaseId=at.json.leaseId as string;
    const st0=await get(`/world-link/agent-status?session=${s}&leaseId=${leaseId}`);
    rec('L03 agent lease live (attached=true)',at.status===200&&st0.json?.attached===true,'POST attach + GET agent-status',JSON.stringify({attach:at.status,attached:st0.json?.attached}));
    let hbOk=0,lastHb:any=null,stop=false;
    const hbLoop=(async()=>{while(!stop){const r=await post('/world-link/heartbeat',{session:s,epoch:e,ownerCap:cap},ORIGIN);if(r.status===200)hbOk++;else lastHb=r;await sleep(500);}})();
    await sleep(5200); // no agent-renew => 4s independent lease must expire
    const st1=await get(`/world-link/agent-status?session=${s}&leaseId=${leaseId}`);
    rec('L04 hardkill: independent 4s lease expired (attached=false)',st1.json?.attached===false,'no agent-renew 5.2s',JSON.stringify(brief(st1)),{heartbeatsOk:hbOk});
    rec('L05 browser heartbeat cannot renew agent lease (session closed)',st1.json?.status==='closed','500ms browser heartbeat + no agent renew',JSON.stringify({attached:st1.json?.attached,status:st1.json?.status,heartbeatsOk:hbOk}));
    stop=true;await hbLoop;
    const hbDenied=lastHb?lastHb.status!==200&&lastHb.json?.ok===false:true;
    rec('L06 post-expiry browser heartbeat denied (no revival)',hbDenied,'POST heartbeat after lease expiry',JSON.stringify(lastHb?brief(lastHb):{note:'no failing heartbeat captured'}));

    // C. Old session/epoch cannot act.
    const oldSubmit=await post('/world-link/action-submit',{session:s,epoch:e,requestId:'req_'+'c'.repeat(24),actions:[stopAction('c')]});
    rec('L07 old epoch action-submit rejected',oldSubmit.status!==200&&oldSubmit.json?.ok===false,'POST action-submit (old)',JSON.stringify(brief(oldSubmit)));
    const oldObs=await get(`/world-link/companion-observation?session=${s}&epoch=${e}`);
    rec('L08 old session observation rejected',oldObs.status!==200&&oldObs.json?.ok===false,'GET companion-observation (old)',JSON.stringify(brief(oldObs)));

    // D. Fresh human re-handshake => new session/epoch; old stays dead.
    const hs2=await post('/world-link/handshake',{authorized:true,protocolVersion:WORLD_PROTOCOL_VERSION,ownerKey},ORIGIN);
    const s2=hs2.json.session,e2=hs2.json.epoch;
    const au2=await post('/world-link/companion-authorize',{session:s2,epoch:e2,ownerCap:hs2.json.ownerCap,ownerMode:'human'},ORIGIN);
    const cap2=au2.json.ownerCap;
    const recycle=await post('/world-link/action-submit',{session:s,epoch:e,requestId:'req_'+'d'.repeat(24),actions:[stopAction('d')]});
    rec('L09 fresh handshake -> new session; old epoch still rejected',hs2.status===200&&s2!==s&&recycle.status!==200,'POST handshake + old action-submit',JSON.stringify({newSession:s2!==s,oldSubmit:recycle.status,oldCode:recycle.json?.code,authorize:au2.status}));

    // E. Duplicate confirm / stop: no double execution.
    await post('/world-link/companion-observation',{session:s2,epoch:e2,observation:obs(e2,20),ownerCap:cap2},ORIGIN);
    const sug2=await post('/world-link/companion-suggest',{session:s2,epoch:e2,requestId:'req_'+'e'.repeat(24),suggestionId:'sug_'+'e'.repeat(24),kind:'fire',reason:'perceived_hostile',target:{x:1,y:0},ttlTicks:600});
    const dec1=await post('/world-link/companion-decision',{session:s2,epoch:e2,suggestionId:'sug_'+'e'.repeat(24),decision:'confirm',tick:21,ownerCap:cap2},ORIGIN);
    const dec2=await post('/world-link/companion-decision',{session:s2,epoch:e2,suggestionId:'sug_'+'e'.repeat(24),decision:'confirm',tick:22,ownerCap:cap2},ORIGIN);
    const app1=await post('/world-link/companion-applied',{session:s2,suggestionId:'sug_'+'e'.repeat(24),appliedTick:21,ownerCap:cap2},ORIGIN);
    const app2=await post('/world-link/companion-applied',{session:s2,suggestionId:'sug_'+'e'.repeat(24),appliedTick:22,ownerCap:cap2},ORIGIN);
    rec('L10 first confirm+applied accepted',sug2.status===200&&dec1.status===200&&app1.status===200,'confirm + applied',JSON.stringify({sug:sug2.status,dec1:dec1.status,app1:app1.status}));
    rec('L11 duplicate confirm rejected (no double execute)',dec2.status!==200&&dec2.json?.code==='E_RETRYABLE','second confirm',JSON.stringify({status:dec2.status,code:dec2.json?.code,messageKey:dec2.json?.messageKey}));
    rec('L12 duplicate applied rejected (no double receipt)',app2.status!==200,'second applied',JSON.stringify({status:app2.status,code:app2.json?.code,messageKey:app2.json?.messageKey}));

    // F. stop suggestion duplicate confirm.
    await post('/world-link/companion-observation',{session:s2,epoch:e2,observation:obs(e2,30),ownerCap:cap2},ORIGIN);
    const sugS=await post('/world-link/companion-suggest',{session:s2,epoch:e2,requestId:'req_'+'f'.repeat(24),suggestionId:'sug_'+'f'.repeat(24),kind:'move',reason:'perceived_hostile',target:{x:1,y:0},ttlTicks:600});
    const decS1=await post('/world-link/companion-decision',{session:s2,epoch:e2,suggestionId:'sug_'+'f'.repeat(24),decision:'confirm',tick:31,ownerCap:cap2},ORIGIN);
    const decS2=await post('/world-link/companion-decision',{session:s2,epoch:e2,suggestionId:'sug_'+'f'.repeat(24),decision:'confirm',tick:32,ownerCap:cap2},ORIGIN);
    rec('L13 move confirm once accepted',sugS.status===200&&decS1.status===200,'suggest stop + confirm',JSON.stringify({sug:sugS.status,dec:decS1.status,code:sugS.json?.code}));
    rec('L14 move duplicate confirm rejected (single execute)',decS2.status!==200&&decS2.json?.code==='E_RETRYABLE','second stop confirm',JSON.stringify({status:decS2.status,code:decS2.json?.code}));

    const summary={total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R};
    console.log('SUMMARY',JSON.stringify({total:summary.total,pass:summary.pass,fail:summary.fail}));
    await import('node:fs/promises').then(fs=>fs.writeFile(`${OUT}/02-lifecycle.json`,JSON.stringify(summary,null,2)));
  }finally{await bridge.close();}
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
