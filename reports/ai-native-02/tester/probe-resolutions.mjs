import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5281/';
const sizes = [
  [1920, 1080],
  [1366, 768],
  [1280, 720],
  [1024, 768],
  [800, 600]
];
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const out = { base, results: [] };
for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const g = (window).__game;
    for (const s of g.scene.getScenes(true)) g.scene.stop(s.sys.settings.key);
    g.scene.start('GameScene', { seed: 42 });
  });
  await page.waitForFunction(() => {
    const g = (window).__game;
    const gs = Object.values(g.scene.scenes).find((s) => s && s.constructor && s.constructor.name === 'GameScene');
    return !!(gs && gs.world && gs.world.player);
  }, { timeout: 15000 });
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const g = (window).__game;
    const gs = Object.values(g.scene.scenes).find((s) => s && s.constructor && s.constructor.name === 'GameScene');
    const c = g.canvas;
    const r = c.getBoundingClientRect();
    const texts = gs
      ? {
          control: gs.txtControl ? { x: gs.txtControl.x, y: gs.txtControl.y, w: gs.txtControl.width, text: gs.txtControl.text, visible: gs.txtControl.visible } : null,
          aiAction: gs.txtAiAction ? { x: gs.txtAiAction.x, y: gs.txtAiAction.y, w: gs.txtAiAction.width, text: gs.txtAiAction.text } : null,
          aiTarget: gs.txtAiTarget ? { x: gs.txtAiTarget.x, y: gs.txtAiTarget.y, w: gs.txtAiTarget.width, text: gs.txtAiTarget.text } : null,
          agentLink: gs.txtAgentLink ? { x: gs.txtAgentLink.x, y: gs.txtAgentLink.y, w: gs.txtAgentLink.width, text: gs.txtAgentLink.text } : null
        }
      : null;
    const controlSnap = gs && gs.world && gs.world.player ? gs.world.player.control.snapshot() : null;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      canvasCss: { x: r.x, y: r.y, w: r.width, h: r.height },
      canvasInternal: { w: c.width, h: c.height },
      scale: { sx: r.width / c.width, sy: r.height / c.height },
      logical: { w: g.scale.width, h: g.scale.height },
      texts,
      control: controlSnap
    };
  });
  out.results.push({ size: `${w}x${h}`, errors, ...info });
  await page.screenshot({ path: `D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/shots/wip-${w}x${h}.png` });
  await page.close();
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
