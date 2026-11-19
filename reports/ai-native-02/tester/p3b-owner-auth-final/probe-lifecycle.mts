// Independent Tester — Owner re-auth capability swap + agent lease + C3b dual-credential.
// No secrets logged; only status/code/messageKey and booleans.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { WorldGateway } from 'D:/Project/AI-NATIVE-02-snapshots/87ab379/src/ai-native/worldGateway.ts';
import { startWorldBridge } from 'D:/Project/AI-NATIVE-02-snapshots/87ab379/src/ai-native/worldBridgeServer.ts';
import { ownerHashFromFile, createOwnerCredentialFile } from 'D:/Project/AI-NATIVE-02-snapshots/87ab379/src/ai-native/ownerCredential.ts';
import { WORLD_PROTOCOL_VERSION } from 'D:/Project/AI-NATIVE-02-snapshots/87ab379/src/ai-native/worldProtocol.ts';
import { randomBytes } from 'node:crypto';

const ORIGIN='http://localhost:5392';
const TOKEN=randomBytes(24).toString('hex');
const R:any[]=[];
const rec=(n:string,p:boolean,o:any)=>{R.push({name:n,verdict:p?'PASS':'FAIL',observed:o});console.log(p?'PASS':'FAIL',n,JSON.stringify(o));};
const post=async(url:string,path:string,body:unknown,origin?:string)=>{const r=await fetch(url+path,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${TOKEN}`,...(origin?{origin}:{})},body:JSON.stringify(body)});return{status:r.status,json:await r.json()};};
const get=async(url:string,path:string,origin?:string)=>{const r=await fetch(url+path,{headers:{authorization:`Bearer ${TOKEN}`,...(origin?{origin}:{})}});return{status:r.status,json:await r.json()};};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const brief=(r:any)=>({status:r.status,ok:r.json?.ok,code:r.json?.code,messageKey:r.json?.messageKey,epoch:r.json?.value?.status?.epoch});

async function main(){
  // Host-private Owner key file (produced by the same production helper the launcher uses).
  const cred=await createOwnerCredentialFile();
  const ownerFile=cred.path;
  const ownerKey=(await readFile(ownerFile,'utf8')).trim();
  const wrongKey='f'.repeat(64);

  const bridge=await startWorldBridge({gateway:new WorldGateway(),token:TOKEN,ownerKeyHash:await ownerHashFromFile(ownerFile),allowedOrigins:[ORIGIN],heartbeatIntervalMs:50});
  try{
    // --- A. Reauth capability swap ---
    const hs=await post(bridge.url,'/world-link/handshake',{authorized:true,protocolVersion:WORLD_PROTOCOL_VERSION,ownerKey},ORIGIN);
    const s=hs.json.session,e=hs.json.epoch,cap0=hs.json.ownerCap;
    rec('L1 human handshake issues cap',hs.status===200&&!!cap0,brief(hs));
    const a1=await post(bridge.url,'/world-link/companion-authorize',{session:s,epoch:e,ownerCap:cap0,ownerMode:'human'},ORIGIN);
    const cap1=a1.json.ownerCap;
    rec('L2 authorize issues rotated cap',a1.status===200&&!!cap1&&cap1!==cap0,{status:a1.status,rotated:cap1!==cap0});

    // old cap (cap0) must fail after authorize
    const stale=await get(bridge.url,`/world-link/companion-suggestions?session=${s}&epoch=${e}&ownerCap=${cap0}`,ORIGIN);
    rec('L3 old handshake cap rejected after authorize',stale.status===403,{status:stale.status,code:stale.json.code});

    // wrong key cannot reauthorize even with current cap
    const badRe=await post(bridge.url,'/world-link/companion-authorize',{session:s,epoch:e,ownerCap:cap1,ownerKey:wrongKey,reauthorize:true},ORIGIN);
    rec('L4 wrong Owner key reauthorization rejected',badRe.status===403,{status:badRe.status,messageKey:badRe.json.messageKey});
    const stillGood=await get(bridge.url,`/world-link/companion-suggestions?session=${s}&epoch=${e}&ownerCap=${cap1}`,ORIGIN);
    rec('L5 cap unchanged after failed reauthorization',stillGood.status===200,{status:stillGood.status});

    // correct key + current cap => new cap issued, old cap dead
    const goodRe=await post(bridge.url,'/world-link/companion-authorize',{session:s,epoch:e,ownerCap:cap1,ownerKey,reauthorize:true},ORIGIN);
    const cap2=goodRe.json.ownerCap;
    rec('L6 correct key reauthorization issues new cap',goodRe.status===200&&!!cap2&&cap2!==cap1,{status:goodRe.status,rotated:cap2!==cap1});
    const deadCap=await get(bridge.url,`/world-link/companion-suggestions?session=${s}&epoch=${e}&ownerCap=${cap1}`,ORIGIN);
    rec('L7 cap1 dead after swap',deadCap.status===403,{status:deadCap.status,code:deadCap.json.code});
    const liveCap=await get(bridge.url,`/world-link/companion-suggestions?session=${s}&epoch=${e}&ownerCap=${cap2}`,ORIGIN);
    rec('L8 cap2 live after swap',liveCap.status===200,{status:liveCap.status});

    // --- B. Agent lease EOF/SIGKILL -> 4s deadline, no auto reconnect ---
    const at=await post(bridge.url,'/world-link/attach',{session:s});
    const leaseId=at.json.leaseId as string;
    rec('L9 agent attach (token only)',at.status===200&&!!leaseId,{status:at.status,hasLeaseId:!!leaseId});
    const st1=await get(bridge.url,`/world-link/agent-status?session=${s}&leaseId=${leaseId}`);
    rec('L10 agent lease live',st1.status===200&&st1.json?.attached===true,{status:st1.status,attached:st1.json?.attached});
    await sleep(5000); // no renew: simulate EOF/SIGKILL
    const st2=await get(bridge.url,`/world-link/agent-status?session=${s}&leaseId=${leaseId}`);
    const sessions=await get(bridge.url,'/world-link/companion-status?session='+s+'&epoch='+e+`&ownerCap=${cap2}`,ORIGIN);
    rec('L11 agent lease expired at ~4s (no auto renew)',st2.status===200&&st2.json?.attached===false&&st2.json?.status==='closed',{status:st2.status,attached:st2.json?.attached,leaseStatus:st2.json?.leaseStatus,statusText:st2.json?.status});
    rec('L12 bridge session invalidated after lease expiry',sessions.status!==200||sessions.json?.ok===false,{status:sessions.status,code:sessions.json?.code});
    const noReconnect=await get(bridge.url,`/world-link/agent-status?session=${s}&leaseId=${leaseId}`);
    rec('L13 no automatic reconnect',noReconnect.json?.attached===false,{status:noReconnect.status,attached:noReconnect.json?.attached,statusText:noReconnect.json?.status});

    // --- C. LOST reload re-handshake WITHOUT restarting bridge (needs key + new session) ---
    const hs2=await post(bridge.url,'/world-link/handshake',{authorized:true,protocolVersion:WORLD_PROTOCOL_VERSION,ownerKey},ORIGIN);
    rec('L14 LOST reload re-handshake with same host key, bridge alive',hs2.status===200&&!!hs2.json.ownerCap,{status:hs2.status,code:hs2.json?.code,newSession:hs2.json?.session!==s,newEpoch:hs2.json?.epoch!==e});
    const agentAfter=await post(bridge.url,'/world-link/attach',{});
    rec('L15 agent attach after reload (only human session exists)',agentAfter.status===200,{status:agentAfter.status,code:agentAfter.json?.code});

    // --- D. C3b Player dual-credential handshake + close (NEW bridge, fresh session) ---
    const bridge2=await startWorldBridge({gateway:new WorldGateway(),token:TOKEN,ownerKeyHash:await ownerHashFromFile(ownerFile),allowedOrigins:[ORIGIN],heartbeatIntervalMs:50});
    try{
      const h2=await post(bridge2.url,'/world-link/handshake',{authorized:true,protocolVersion:WORLD_PROTOCOL_VERSION,ownerKey},ORIGIN);
      const s2=h2.json.session,e2=h2.json.epoch,cap=h2.json.ownerCap;
      rec('L16 C3b Player: handshake needs owner key',h2.status===200,{status:h2.status});
      const noCapObs=await post(bridge2.url,'/world-link/observation',{session:s2,epoch:e2,observation:{}},ORIGIN);
      rec('L17 C3b Player: renderer observation requires cap',noCapObs.status===403,{status:noCapObs.status,messageKey:noCapObs.json?.messageKey});
      const at2=await post(bridge2.url,'/world-link/attach',{session:s2});
      rec('L18 C3b Player: agent attach token-only',at2.status===200,{status:at2.status});
      const closeNoCap=await post(bridge2.url,'/world-link/close',{session:s2,epoch:e2},ORIGIN);
      rec('L19 C3b Player: close requires cap',closeNoCap.status===403,{status:closeNoCap.status,messageKey:closeNoCap.json?.messageKey});
      const closeOk=await post(bridge2.url,'/world-link/close',{session:s2,epoch:e2,ownerCap:cap},ORIGIN);
      rec('L20 C3b Player: owner close succeeds',closeOk.status===200,{status:closeOk.status});
      const afterClose=await post(bridge2.url,'/world-link/attach',{session:s2});
      rec('L21 C3b Player: attach after close rejected',afterClose.status===403,{status:afterClose.status});
    }finally{await bridge2.close();}
  }finally{await bridge.close();}
  const summary={total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R};
  console.log('SUMMARY',JSON.stringify({total:summary.total,pass:summary.pass,fail:summary.fail}));
  await import('node:fs/promises').then(fs=>fs.writeFile('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3b-owner-auth-final/07-lifecycle.json',JSON.stringify(summary,null,2)));
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
