import { CompanionLink } from './src/ai-native/companionLink';
let failures=0; const check=(n:string,c:boolean,d?:unknown)=>{if(c)console.log('PASS',n);else{failures++;console.log('FAIL',n,JSON.stringify(d));}};
const info=(n:string,d?:unknown)=>console.log('INFO',n,JSON.stringify(d));
const link = new CompanionLink({ bridgeUrl:'http://127.0.0.1:1', token:'fake-token-for-probe', origin:'http://localhost:5412', session:'ses_reviewer', epoch:1, observation:()=>null, apply:()=>false });
// Simulate the post-authorize private fields WITHOUT any network (assign directly).
(link as any).ownerSecret = 'REVIEWER_FAKE_SECRET_NOT_REAL';
(link as any).capability = Object.freeze({kind:'OWNER'});
const text = JSON.stringify(link);
info('JSON.stringify(CompanionLink) keys', { keys: Object.keys(link), containsSecret: text.includes('REVIEWER_FAKE_SECRET_NOT_REAL') });
check('RESIDUAL confirmed: TS-private ownerSecret IS enumerable & survives JSON.stringify (no production __game to reach it)', text.includes('REVIEWER_FAKE_SECRET_NOT_REAL'));
check('status/error getters do not expose the secret', !JSON.stringify({status:link.status,error:link.error,session:link.session}).includes('REVIEWER_FAKE_SECRET_NOT_REAL'));
console.log(`SERIALIZE_${failures===0?'PASS':'FAIL'} failures=${failures}`); if(failures>0)process.exit(1);
