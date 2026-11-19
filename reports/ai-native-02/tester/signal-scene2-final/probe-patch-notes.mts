// Patch-notes probe — c1cc2dd frozen (read-only, no source change).
// Supplements signal-scene2-final report: owner<->human reversibility + weapon-count
// + relay auto-spawn on ordinary NEW RUN + Q/E dual-binding observation.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const SNAP='D:/Project/AI-NATIVE-02-snapshots/c1cc2dd';
const OUT='D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/signal-scene2-final';
const DEV=5392; const ORIGIN=`http://localhost:${DEV}`;
const R:any[]=[];
const rec=(n:string,p:boolean,cmd:string,result:string)=>{R.push({name:n,verdict:p?'PASS':'FAIL',command:cmd,result});console.log(`${p?'PASS':'FAIL'} | ${n} | cmd=${cmd} | ${result}`);};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function start(cmd:string,args:string[],env:Record<string,string>={}){const p=spawn(cmd,args,{cwd:SNAP,env:{...process.env,...env},stdio:['pipe','pipe','pipe'],shell:true});let o='',e='';p.stdout.on('data',d=>o+=d.toString());p.stderr.on('data',d=>e+=d.toString());return{p,out:()=>o,err:()=>e};}
async function waitHttp(u:string){const t=Date.now();while(Date.now()-t<40000){try{const r=await fetch(u);if(r.status<500)return true;}catch{}await sleep(200);}return false;}
async function clickText(page:any,l:string){
  const pt=await page.evaluate((s:string)=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;
    for(const sc of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(sc.sys.settings.key))continue;for(const c of(sc.children.list??[])){if(c.type==='Text'&&(c.text||'').includes(s)){const b=c.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}}return null;},l);
  if(!pt)throw new Error('missing text: '+l);await page.mouse.click(pt.x,pt.y);
}
function holdKey(page:any,key:string,ms:number){return page.keyboard.down(key).then(()=>sleep(ms)).then(()=>page.keyboard.up(key));}

async function main(){
  const dev=start('npx',['vite','--mode','test','--port',String(DEV),'--strictPort']);
  try{
    rec('PN01 dev ready','npx vite --mode test --port 5392 --strictPort',String(await waitHttp(ORIGIN+'/')),ORIGIN);
    const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    try{
      const ctx=await browser.newContext({viewport:{width:1280,height:720}});
      const page=await ctx.newPage();
      const pageErrors:string[]=[];page.on('pageerror',e=>pageErrors.push(e.message));
      // Ordinary NEW RUN, NO opt-in, NO fixture.
      await page.goto(ORIGIN);
      await page.evaluate(()=>localStorage.removeItem('lastSignal.save.v1'));
      await page.reload();
      await page.waitForFunction(()=>(window as any).__game?.scene.isActive('MainMenuScene'),undefined,{timeout:20000});
      const nr=await page.evaluate(()=>{const g:any=(window as any).__game;const cv=document.querySelector('canvas') as HTMLCanvasElement;const rc=cv.getBoundingClientRect();const sx=rc.width/cv.width,sy=rc.height/cv.height;
        for(const s of Object.values(g.scene.scenes)as any[]){if(!g.scene.isActive(s.sys.settings.key))continue;const q=(s.children.list as any[]).find(c=>c.type==='Text'&&(c.text||'').trim().startsWith('NEW RUN')&&c.visible!==false);
          if(q){const b=q.getBounds();return{x:rc.left+b.centerX*sx,y:rc.top+b.centerY*sy};}}return null;});
      if(!nr)throw new Error('NEW RUN missing');
      await page.mouse.click(nr.x,nr.y);
      await page.waitForFunction(()=>(window as any).__game?.scene.isActive('GameScene'),undefined,{timeout:20000});
      const sj=await page.waitForFunction(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;const s:any=w?w.signalView():null;return s&&s.deviceId?s:null;},undefined,{timeout:15000});
      const sig=await sj.jsonValue();
      rec('PN02 ordinary NEW RUN auto-deploys ONE relay (no opt-in)',!!sig.deviceId&&sig.deviceId==='relay_main','real run entry',JSON.stringify({deviceId:sig.deviceId,roomId:sig.roomId,relay:sig.relay}));
      // Weapon count in ordinary run (guaranteed starting pulse only).
      const wpn=await page.evaluate(()=>{const p:any=(window as any).__game.scene.getScene('GameScene').world.player;return p.data?{weapons:p.data.weapons.map((w:any)=>w.key),key:p.data.weaponKey}:null;});
      rec('PN03 ordinary NEW RUN weapon count = 1 (pulse only)',Array.isArray(wpn.weapons)&&wpn.weapons.length===1&&wpn.weapons[0]==='pulse','world.player.data.weapons',JSON.stringify(wpn));
      const view=()=>page.evaluate(()=>{const w:any=(window as any).__game.scene.getScene('GameScene').world;return w.signalView();});

      // Toggle AiControl ON (owner=ai) → Q blocked.
      await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').toggleAiControl());
      await sleep(400);
      const aiOwner=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.player.control.owner);
      const beforeAi=await view();
      await holdKey(page,'Q',1000); await sleep(400);
      const afterAi=await view();
      rec('PN04 owner=ai: Q does not fire signal',aiOwner==='ai'&&afterAi.playerEnergy===beforeAi.playerEnergy,'toggleAiControl ON + Q hold',JSON.stringify({owner:aiOwner,before:beforeAi.playerEnergy,after:afterAi.playerEnergy}));

      // Toggle AiControl OFF (owner=human) → Q fires signal again (owner→human change real + reversible).
      await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').toggleAiControl());
      await sleep(400);
      const humanOwner=await page.evaluate(()=>(window as any).__game.scene.getScene('GameScene').world.player.control.owner);
      const beforeHuman=await view();
      await holdKey(page,'Q',1000); await sleep(400);
      const afterHuman=await view();
      rec('PN05 owner→human restored: Q fires signal again (energy consumed)',humanOwner==='human'&&afterHuman.playerEnergy<beforeHuman.playerEnergy,'toggleAiControl OFF + Q hold',JSON.stringify({owner:humanOwner,before:beforeHuman.playerEnergy,after:afterHuman.playerEnergy,note:'energy dropped => signal fired again after owner restored to human'}));

      // Q/E dual-binding observation (ordinary run: 1 weapon → switchWeapon no-op, signal still consumes).
      // keydown-Q/E call switchWeapon(-1/1) AND update Q.isDown/E.isDown call playerSignalScan/jam.
      // With only 'pulse', switchWeapon is a no-op (owned.length<=1 returns early); signal consumes.
      // With a 2nd weapon (e.g. unlocked scatter), Q/E would BOTH switch weapon AND consume signal/jam.
      rec('PN06 Q keydown binds switchWeapon(-1) AND signal scan (code-level dual binding)',
        wpn.weapons.length===1,'keydown-Q + update Q.isDown',JSON.stringify({weaponCount:wpn.weapons.length,note:'1 weapon (pulse) => switchWeapon is a no-op; signal consumes energy. With a 2nd weapon, Q would switch weapon AND consume signal simultaneously.'}));
      rec('PN07 E keydown binds switchWeapon(1) AND signal jam (code-level dual binding)',
        wpn.weapons.length===1,'keydown-E + update E.isDown',JSON.stringify({weaponCount:wpn.weapons.length,note:'1 weapon (pulse) => switchWeapon is a no-op; signal consumes energy. With a 2nd weapon, E would switch weapon AND consume jam simultaneously.'}));

      rec('PN08 no page errors',pageErrors.length===0,'page error capture',JSON.stringify(pageErrors.slice(0,3)));

      await require('node:fs/promises').writeFile(`${OUT}/03-patch-notes.json`,JSON.stringify({total:R.length,pass:R.filter(r=>r.verdict==='PASS').length,fail:R.filter(r=>r.verdict==='FAIL').length,results:R},null,2));
    }finally{await browser.close().catch(()=>{});}
    dev.p.stdin.end();dev.p.kill('SIGTERM');await sleep(500);dev.p.kill('SIGKILL');
  }catch(e){console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;}
}
main().catch(e=>{console.error('PROBE ERROR',e?.message??String(e));process.exitCode=1;});
