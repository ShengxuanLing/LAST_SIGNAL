import { chromium } from 'playwright';
const b=await chromium.launch({args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1280,height:720}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:5382/',{waitUntil:'load'});
await p.waitForFunction(()=>window.__game?.scene.isActive('MainMenuScene'),null,{timeout:10000});
await p.mouse.click(640,340);
await p.waitForFunction(()=>window.__game?.scene.isActive('GameScene'),null,{timeout:10000});
await p.waitForTimeout(500);
const r=await p.evaluate(()=>{
  const g=window.__game; const gs=g.scene.getScene('GameScene');
  let levelName=null;
  try { gs.onLevelUp(1); levelName=g.scene.getScenes(true).map(s=>s.constructor.name); } catch(e){ levelName='ERR '+String(e); }
  return {active:g.scene.getScenes(true).map(s=>({key:s.sys.settings.key,ctor:s.constructor.name})),withLevelUp:levelName};
});
console.log(JSON.stringify({r,errs},null,2));
await b.close();
