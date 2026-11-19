import { readFileSync } from 'node:fs';
import { WorldGateway } from './src/ai-native/worldGateway';
import { CompanionGateway } from './src/ai-native/companionGateway';
let failures=0; const check=(n:string,c:boolean,d?:unknown)=>{if(c)console.log('PASS',n);else{failures++;console.log('FAIL',n,JSON.stringify(d));}};
const info=(n:string,d?:unknown)=>console.log('INFO',n,JSON.stringify(d));
// Gateway honours external mode when explicitly set.
const wg=new WorldGateway(); const l=wg.linkSession({authorized:true,origin:'http://localhost:5412',nowMs:Date.now()});
if(!l.ok) throw new Error('link');
const cg=new CompanionGateway(wg); const {session,epoch}=l;
cg.authorize(session,epoch,'human');
cg.pushObservation(session,epoch,{epoch,tick:10,player:{x:0,y:0},echo:{x:0,y:0,hp:100,maxHp:100,aimYaw:0},
  drones:[{id:1,x:1,y:0,hp:5}],schema:'last_signal.echo-observation.v1',
  perception:{center:{x:0,y:0},radiusTiles:12,requiresExplored:true,requiresLineOfSight:true},targets:[]});
const ext=cg.setOwnerMode(session,epoch,'external');
check('gateway setOwnerMode(external) -> readOnly', ext.ok && ext.value.readOnly===true);
const sug=cg.suggest({session,epoch,requestId:'req_'+'a'.repeat(24),suggestionId:'sug_'+'a'.repeat(24),kind:'move',reason:'perceived_hostile',target:{x:1,y:0},ttlTicks:600});
check('external mode blocks new suggestions at gateway', !sug.ok);
// BUT: GameScene.authorizeExternalAgent never calls setOwnerMode('external').
const scene = readFileSync('src/scenes/GameScene.ts','utf8');
const externalBlock = scene.slice(scene.indexOf('async authorizeExternalAgent'), scene.indexOf('getExternalLinkError'));
const hasMode = /companionLink\??\.setOwnerMode/.test(externalBlock);
info('GameScene.authorizeExternalAgent calls setOwnerMode?', { hasMode });
check('GAP: rendered EXTERNAL Player takeover does NOT set companion read-only', !hasMode);
const aiBlock = scene.slice(scene.indexOf('toggleAiControl'), scene.indexOf('private switchWeapon'));
check('AI toggle DOES set ownerMode ai/human (asymmetric)', /setOwnerMode\('ai'\)/.test(aiBlock) && /setOwnerMode\('human'\)/.test(aiBlock));
console.log(`EXTERNAL_MODE_${failures===0?'PASS':'FAIL'} failures=${failures}`); if(failures>0)process.exit(1);
