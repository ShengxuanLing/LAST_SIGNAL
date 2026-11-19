import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const out={checks:[],steps:[]}; const ck=(n,ok,d)=>{out.checks.push({n,ok,...(d===undefined?{}:{d})});if(!ok)process.exitCode=1;};
process.on('exit',()=>{try{process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3b-pure-final/echo-checkpoint.json',JSON.stringify(out,null,2));}catch{}});
const b=await chromium.launch({args:['--no-sandbox']}); const p=await b.newPage({viewport:{width:1280,height:720}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:5381/',{waitUntil:'load'});
await p.waitForFunction(()=>window.__game?.scene.isActive('MainMenuScene'));
await p.mouse.click(640,340);
await p.waitForFunction(()=>window.__game?.scene.isActive('GameScene'));
await p.waitForTimeout(400);
const r=await p.evaluate(async()=>{
  const mod=await import('/src/systems/RunCheckpoint.ts');
  const core=await import('/src/world/sim/core.ts');
  const gs=window.__game.scene.getScene('GameScene'); const w=gs.world;
  const neutral={move:{x:0,y:0},dash:false,fire:false,aim:null,interact:false};
  w.clearEnemiesForTest(); w.enableEcho(); w.stepFrame(1000/60+1e-6,neutral,neutral);
  w.setEchoMode('hold'); w.confirmEchoAssist();
  const e=w.simFixture.echo;
  e.data.hp=42; e.aimYaw=-1.2; e.dashTimer=0.05; e.invuln=0.3; e.hurtTimer=0.2; e.fireTimer=0.1;
  e.data.weapons[0].reloadTimer=0.4;
  w.simFixture.player.data.hp=55;
  for(const room of w.map.rooms){if(room.kind==='boss')continue;room.cleared=true;room.spawned=true;}
  const frame=w.captureCheckpoint('tester-echo-base',424242,{kills:0,items:0,damage:0,elapsedSeconds:0});
  if(!frame)return {captured:false};
  frame.portalTarget=null;
  const valid=mod.validateCheckpoint(frame);
  const echoValid=mod.validEchoActor(frame.coreState.echo);
  // tamper each exact base stat: validation must reject
  const base=core.echoPlayerData();
  const keys=['maxHp','speed','armor','damage','critChance','critDamage','xpGain','pickupRange','dashCooldown','dashDuration','cooldownReduced','pierceCount','hpRegen','level','xp','xpToNext','currency','weaponKey'];
  const rejected={};
  for(const k of keys){
    const copy=JSON.parse(JSON.stringify(frame));
    copy.coreState.echo.data[k]= typeof base[k]==='number' ? (base[k]+99) : 'laser';
    rejected[k]=!mod.validateCheckpoint(copy);
  }
  for(const extra of ['upgrades','abilities']){
    const copy=JSON.parse(JSON.stringify(frame));
    copy.coreState.echo.data[extra]=[{key:'free',level:1}];
    rejected[extra]=!mod.validateCheckpoint(copy);
  }
  // old save without echo still valid
  const legacy=JSON.parse(JSON.stringify(frame)); delete legacy.coreState.echo;
  const legacyValid=mod.validateCheckpoint(legacy);
  // restore the damaged running frame
  const okRestore=w.restoreCheckpoint(frame);
  const after=w.echoActor;
  return {captured:true,valid,echoValid,rejected,legacyValid,okRestore,
    after:{echoHp:after?.data.hp,playerHp:w.simFixture.player.data.hp,aimYaw:after?.aimYaw,dashTimer:after?.dashTimer,invuln:after?.invuln,hurtTimer:after?.hurtTimer,fireTimer:after?.fireTimer,reloadTimer:after?.data.weapons[0].reloadTimer,assist:w.echoAssistArmed,mode:w.echoMode,shots:w.echoShotsFired}};
});
out.steps.push({name:'result',r});
ck('checkpoint-captured',r.captured===true,r);
ck('valid-echo-actor',r.valid===true&&r.echoValid===true,{valid:r.valid,echoValid:r.echoValid});
ck('exact-base-stats-enforced',Object.values(r.rejected).every(Boolean),r.rejected);
ck('old-save-without-echo-valid',r.legacyValid===true,r.legacyValid);
ck('damaged-running-frame-restores',r.okRestore===true&&r.after.echoHp===42&&r.after.playerHp===55&&r.after.aimYaw===-1.2&&r.after.dashTimer===0.05&&r.after.invuln===0.3&&r.after.hurtTimer===0.2&&r.after.fireTimer===0.1&&r.after.reloadTimer===0.4,r.after);
ck('restore-clears-authority',r.after.assist===false&&r.after.mode==='follow'&&r.after.shots===0,r.after);
ck('no-page-errors',errs.length===0,errs);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3b-pure-final/echo-checkpoint.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({checks:out.checks.map(c=>[c.n,c.ok])},null,2));
await b.close();
process.exit(0);
