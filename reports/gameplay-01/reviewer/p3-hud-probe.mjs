import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
await p.goto('http://localhost:5494/');
await p.evaluate(() => {
  localStorage.removeItem('last_signal_save_v1');
  localStorage.setItem('last_signal_autoOwner', 'human');
});
await p.reload();
await p.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'), undefined, { timeout: 30000 });
await p.waitForTimeout(400);
// click DEMO 01 by camera-aware fraction
const f = await p.evaluate(() => {
  const g = window.__game; const s = g.scene.getScene('MainMenuScene'); const cam = s.cameras.main;
  const flat = []; const walk = (l) => { for (const c of l) { if (c.type === 'Container' && c.list) walk(c.list); else flat.push(c); } };
  walk(s.children.list);
  const t = flat.find((c) => c.type === 'Text' && c.visible !== false && String(c.text).includes('DEMO 01'));
  const bb = t.getBounds(); const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
  return { fx: (cx - cam.scrollX) / (cam.width / cam.zoom), fy: (cy - cam.scrollY) / (cam.height / cam.zoom) };
});
const box = await p.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await p.mouse.click(box.x + f.fx * box.w, box.y + f.fy * box.h);
await p.waitForFunction(() => window.__game?.scene.isActive('GameScene'), undefined, { timeout: 30000 });
await p.waitForTimeout(1500);
const info = await p.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const cam = gs.cameras.main;
  const r = document.querySelector('canvas').getBoundingClientRect();
  const pick = {};
  for (const n of ['txtSignal', 'txtEcho', 'txtSignalDetail', 'txtVitals']) {
    const t = gs[n]; if (!t) continue;
    const bb = t.getBounds();
    const fs = Number(String(t.style.fontSize).replace('px', ''));
    pick[n] = { text: String(t.text), fontSize: fs, scaleX: t.scaleX, scaleY: t.scaleY, boundsH: bb.height, boundsW: bb.width };
  }
  const canvasScale = r.width / cam.width;
  const out = {};
  for (const [k, v] of Object.entries(pick)) {
    out[k] = { ...v,
      renderedGamePx_h: v.boundsH * cam.zoom,
      cssIfCounterScaled: v.fontSize * canvasScale,
      cssIfNotCounterScaled: v.fontSize * v.scaleX === 1 ? v.fontSize * cam.zoom * canvasScale : null };
  }
  return { zoom: cam.zoom, canvas: { w: r.width, h: r.height }, canvasScale, pick: out };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
