// GAMEPLAY-01 P3 ECHO-page signal detail at six viewports (fixture).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT ?? '5497';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'matrix');
const VIEWPORTS = [[1920,1080,'1920x1080'],[1600,900,'1600x900'],[1366,768,'1366x768'],[1280,720,'1280x720'],[1024,768,'1024x768'],[800,600,'800x600']];
const BG = '#05070c';
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
function lum(h) { const x = h.replace('#',''); const c=[0,2,4].map(i=>parseInt(x.slice(i,i+2),16)/255); const f=v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4; return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2]); }
function contrast(fg,bg=BG){ if(!/^#[0-9a-f]{6}$/i.test(fg||'')) return null; const a=lum(fg),b=lum(bg); return Math.round(((Math.max(a,b)+.05)/(Math.min(a,b)+.05))*100)/100; }
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
async function rect(){ return page.evaluate(()=>{const r=window.__game.canvas.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}); }
async function clickText(sceneKey,label){ const r=await rect(); const p=await page.evaluate(({key,label})=>{const g=window.__game;const s=g.scene.getScene(key);if(!s||!g.scene.isActive(key))return null;const t=s.children.list.find(c=>c.type==='Text'&&c.visible!==false&&String(c.text).includes(label));if(!t)return null;const b=t.getBounds();return{x:b.centerX,y:b.centerY};},{key:sceneKey,label}); if(!p) throw new Error(`not found: ${label}`); await page.mouse.click(r.x+p.x*(r.w/1280),r.y+p.y*(r.h/720)); await page.waitForTimeout(400); }
async function state(){
  const raw=await page.evaluate(()=>{const g=window.__game;const s=g.scene.getScene('PauseScene');const w=g.scene.getScene('GameScene').world;return{page:s.page,texts:s.children.list.filter(c=>c.type==='Text'&&c.visible!==false).map(c=>{const b=c.getBounds();return{text:String(c.text).slice(0,220),x:b.x,y:b.y,w:b.width,h:b.height,font:c.style?.fontSize,color:c.style?.color};}),detail:String(s.echoSignalDetail?.text??''),status:String(s.echoStatus?.text??''),buttons:(s.pageHandle?.buttons??[]).map(b=>({label:String(b.label?.text??''),enabled:b.enabled})),signal:w.signalView()};});
  const r=await rect(); const scale=r.w/1280; const sizes=raw.texts.map(t=>({px:Math.round(parseFloat(String(t.font))*scale*10)/10})); const minCss=Math.min(...sizes.map(s=>s.px));
  const outside=raw.texts.filter(t=>t.x<-.5||t.y<-.5||t.x+t.w>1280.5||t.y+t.h>720.5);
  const overlaps=[]; for(let i=0;i<raw.texts.length;i++)for(let j=i+1;j<raw.texts.length;j++){const a=raw.texts[i],b=raw.texts[j];if(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y)overlaps.push([a.text.slice(0,24),b.text.slice(0,24)]);}
  const minContrast=Math.min(...raw.texts.map(t=>contrast(String(t.color))??99));
  return{...raw,scale,minCss,outside,overlaps,minContrast};
}
try{
  const results=[];
  for(const vp of VIEWPORTS){
    await page.setViewportSize({width:vp[0],height:vp[1]});
    await page.goto(`http://localhost:${PORT}/`); await page.evaluate(()=>localStorage.clear()); await page.reload();
    await page.waitForFunction(()=>window.__game?.scene.isActive('MainMenuScene'),{timeout:25000}); await page.waitForTimeout(600);
    await clickText('MainMenuScene','DEMO 01'); await page.waitForFunction(()=>window.__game?.scene.isActive('GameScene'),{timeout:20000}); await page.waitForTimeout(1100);
    await page.keyboard.press('Escape'); await page.waitForFunction(()=>window.__game?.scene.isActive('PauseScene'),{timeout:10000}); await page.waitForTimeout(350);
    await clickText('PauseScene','AI & COMPANION'); await clickText('PauseScene','ECHO COMPANION');
    const s=await state(); const dir=path.join(ROOT,vp[2]); fs.mkdirSync(dir,{recursive:true}); await page.screenshot({path:path.join(dir,'echo-detail.png')});
    const ok=s.page==='echo'&&s.detail.includes('Scan')&&s.detail.includes('Jam')&&s.detail.includes('Link')&&s.outside.length===0&&s.overlaps.length===0&&s.minCss>=10&&s.minContrast>=4.5&&errors.length===0;
    results.push({viewport:vp[2],ok,page:s.page,detail:s.detail,status:s.status,minCss:s.minCss,minContrast:s.minContrast,outside:s.outside,overlaps:s.overlaps,buttons:s.buttons,signal:s.signal});
    say(`${vp[2]} ${ok?'PASS':'FAIL'} minCss=${s.minCss} contrast=${s.minContrast} outside=${s.outside.length} overlaps=${s.overlaps.length} detail=${JSON.stringify(s.detail)}`);
  }
  const ok=results.every(r=>r.ok);
  const env={cwd:process.cwd(),spec:fileURLToPath(import.meta.url),devroot:'D:/tmp/gp01-p3-ui',note:'Independent P3 gate tree; own reports; c2/c3c not run; fixture.'};
  fs.writeFileSync(path.join(ROOT,'echo-detail.json'),JSON.stringify({ok,env,results,errors},null,2));
  fs.writeFileSync(path.join(ROOT,'echo-detail.log'),lines.join('\n')+'\n');
  say(`ECHO DETAIL RESULT: ${ok?'PASS':'FAIL'}`);
  await browser.close(); process.exit(ok?0:1);
}catch(e){ say(`ERROR: ${String(e).split('\n')[0]}`); fs.writeFileSync(path.join(ROOT,'echo-detail.log'),lines.join('\n')+'\n'); await browser.close(); process.exit(1); }
