import { chromium } from 'playwright';
const b=await chromium.launch({args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1280,height:720}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:5382/economy.html',{waitUntil:'load'});
await p.waitForTimeout(1800);
const r=await p.evaluate(()=>({title:document.title,url:location.href,hasSupplyOpen:!!document.querySelector('#supply-open'),hasCanvas:!!document.querySelector('canvas'),hasGame:typeof window.__game!=='undefined',scripts:[...document.scripts].map(s=>s.getAttribute('src')),sceneNames:window.__game?window.__game.scene.getScenes(true).map(s=>s.constructor.name):[]}));
console.log(JSON.stringify({r,errs},null,2));
await b.close();
