/** Airtight: Agent needs ONLY its token + the (non-secret, printed) ORIGIN. */
import { createHash, randomBytes } from 'node:crypto';
import { WorldGateway } from './src/ai-native/worldGateway';
import { startWorldBridge } from './src/ai-native/worldBridgeServer';
let failures=0; const check=(n:string,c:boolean,d?:unknown)=>{if(c)console.log('PASS',n);else{failures++;console.log('FAIL',n,JSON.stringify(d));}};
const info=(n:string,d?:unknown)=>console.log('INFO',n,JSON.stringify(d));
const ORIGIN='http://localhost:5412', TOKEN=randomBytes(24).toString('hex');
const secret=randomBytes(24).toString('hex'), h=(s:string)=>createHash('sha256').update(s).digest('hex');
const post=async(u:string,p:string,b:unknown,o?:string)=>{const r=await fetch(`${u}${p}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${TOKEN}`,...(o?{origin:o}:{})},body:JSON.stringify(b)});return{status:r.status,json:await r.json()};};
async function main(){
  const bridge=await startWorldBridge({gateway:new WorldGateway(),token:TOKEN,allowedOrigins:[ORIGIN],heartbeatIntervalMs:20});
  const U=bridge.url;
  try{
    // 1. HUMAN (renderer) creates the session with its own secret.
    const hs=await post(U,'/world-link/handshake',{authorized:true,protocolVersion:1},ORIGIN);
    await post(U,'/world-link/companion-authorize',{session:hs.json.session,epoch:hs.json.epoch,ownerSecretHash:h(randomBytes(24).toString('hex')),ownerMode:'human'},ORIGIN);
    // 2. AGENT: no prior session knowledge; attach() with EMPTY body returns the single live session.
    const attach=await post(U,'/world-link/attach',{});
    info('agent attach() with empty body', {status:attach.status, session:attach.json.session, epoch:attach.json.epoch});
    check('Agent learns session+epoch from its own attach (no human disclosure needed)', attach.status===200 && !!attach.json.session && attach.json.epoch!==undefined);
    const session=attach.json.session as string, epoch=attach.json.epoch as number;
    // 3. Agent forges the (public) Origin and installs its OWN secret on that session.
    const reauth=await post(U,'/world-link/companion-authorize',{session,epoch,ownerSecretHash:h(secret),ownerMode:'human'},ORIGIN);
    check('Agent overwrites the human ownerSecretHash', reauth.status===200);
    // 4. Agent pushes observation, proposes, confirms — all with token + forged Origin.
    const obs={epoch,tick:10,player:{x:0,y:0},echo:{x:0,y:0,hp:100,maxHp:100,aimYaw:0},drones:[{id:1,x:1,y:0,hp:5}],
      schema:'last_signal.echo-observation.v1',perception:{center:{x:0,y:0},radiusTiles:12,requiresExplored:true,requiresLineOfSight:true},targets:[]};
    await post(U,'/world-link/companion-observation',{session,epoch,observation:obs},ORIGIN);
    const id='sug_'+'a'.repeat(24);
    const sug=await post(U,'/world-link/companion-suggest',{session,epoch,requestId:'req_'+'a'.repeat(24),suggestionId:id,kind:'fire',reason:'perceived_hostile',target:{x:1,y:0},ttlTicks:600});
    check('Agent proposals accepted', sug.json.ok===true);
    const dec=await post(U,'/world-link/companion-decision',{session,epoch,suggestionId:id,decision:'confirm',tick:11,ownerSecret:secret},ORIGIN);
    info('AGENT SELF-CONFIRM on the HUMAN session', {status:dec.status,json:dec.json});
    check('BLOCKER: Agent self-confirms on the human-authorized session using only token+public Origin', dec.status===200 && dec.json.ok===true);
    const applied=await post(U,'/world-link/companion-applied',{session,suggestionId:id,ownerSecret:secret},ORIGIN);
    check('Agent also posts its own applied receipt', applied.status===200 && applied.json.value.applied===true);
  } finally { await bridge.close(); }
  console.log(`AGENT_MINIMAL_${failures===0?'PASS':'FAIL'} failures=${failures}`); if(failures>0)process.exit(1);
}
main().catch((e)=>{console.log('FAIL exception',String(e));process.exit(1);});
