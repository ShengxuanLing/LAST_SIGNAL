import { chromium } from 'playwright';
const b=await chromium.launch({args:['--no-sandbox']});
const out={checks:[]};
for(const [label,base,paths] of [
 ['prod','http://localhost:5410/',['','station-zero.html','economy.html']],
 ['testbuild','http://localhost:5405/',['','station-zero.html','economy.html']]
]){
 for(const path of paths){
  const p=await b.newPage({viewport:{width:1280,height:720}});
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(base+path,{waitUntil:'load'});await p.waitForTimeout(1400);
  const st=await p.evaluate(()=>({hasGame:typeof window.__game!=='undefined',canvas:!!document.querySelector('canvas')}));
  const want=label==='prod'||path==='station-zero.html'?false:true;
  const ok=st.hasGame===want;
  out.checks.push({label,path:path||'index.html',expect:want?'has __game':'no __game (prod or standalone slice)',...st,ok,errs});
  await p.close();
 }
}
console.log(JSON.stringify(out,null,2));
if(!out.checks.every(c=>c.ok))process.exit(1);
await b.close();
