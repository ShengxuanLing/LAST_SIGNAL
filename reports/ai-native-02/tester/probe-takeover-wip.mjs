import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5281/';
const SHOTS = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/shots';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const report = { steps: [] };

const snap = () => page.evaluate(() => {
  const g = window.__game;
  const gs = Object.values(g.scene.scenes).find((s) => s && s.constructor && s.constructor.name === 'GameScene');
  const pl = gs.world.player;
  return {
    control: pl.control.snapshot(),
    player: { x: Number(pl.wx.toFixed(3)), y: Number(pl.wy.toFixed(3)), hp: Number(pl.data.hp.toFixed(1)) },
    hasAction: !!gs.txtAiAction,
    texts: {
      control: gs.txtControl && gs.txtControl.text,
      aiAction: gs.txtAiAction && gs.txtAiAction.text,
      aiTarget: gs.txtAiTarget && gs.txtAiTarget.text,
      agentLink: gs.txtAgentLink && gs.txtAgentLink.text
    },
    scenes: g.scene.getScenes(true).map((s) => s.constructor.name),
    lastIntentOwner: pl.lastIntentOwner
  };
});

// Click a Phaser Text label by mapping logical scene coords -> CSS pixels.
async function clickLogicalText(sceneName, startsWith) {
  const pos = await page.evaluate(({ sceneName, startsWith }) => {
    const g = window.__game;
    const scene = g.scene.getScene(sceneName);
    if (!scene) return null;
    const t = scene.children.list.find((c) => c.type === 'Text' && (c.text || '').trim().startsWith(startsWith) && c.visible !== false);
    if (!t) return null;
    const r = g.canvas.getBoundingClientRect();
    const s = g.scale;
    return { x: r.x + t.x * (r.width / s.width), y: r.y + t.y * (r.height / s.height), text: t.text };
  }, { sceneName, startsWith });
  if (!pos) throw new Error(`label not found: ${sceneName}/${startsWith}`);
  await page.mouse.click(pos.x, pos.y);
  return pos;
}

await page.goto(base);
await page.waitForFunction(() => !!(window).__game, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const g = window.__game;
  for (const s of g.scene.getScenes(true)) g.scene.stop(s.sys.settings.key);
  g.scene.start('GameScene', { seed: 42 });
});
await page.waitForFunction(() => {
  const g = window.__game;
  const gs = Object.values(g.scene.scenes).find((s) => s && s.constructor && s.constructor.name === 'GameScene');
  return !!(gs && gs.world && gs.world.player);
}, { timeout: 15000 });
await page.waitForTimeout(1200);
report.steps.push({ name: 'start', state: await snap() });

// 1. pause via the game's own ESC binding (in-page keyboard, not OS input)
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
report.steps.push({ name: 'paused', state: await snap() });

// 2. AI takeover via the Pause menu's own control button
const aiBtn = await clickLogicalText('PauseScene', 'AI CONTROL');
await page.waitForTimeout(600);
report.steps.push({ name: 'after-toggle-paused', clicked: aiBtn, state: await snap() });

// 3. resume via the menu's RESUME button
const resumeBtn = await clickLogicalText('PauseScene', 'RESUME');
await page.waitForTimeout(2500);
const aiState = await snap();
report.steps.push({ name: 'resumed-ai', clicked: resumeBtn, state: aiState, moved: aiState.player.x !== report.steps[0].state.player.x || aiState.player.y !== report.steps[0].state.player.y });
await page.screenshot({ path: `${SHOTS}/wip-1280x720-ai-mode.png` });

// 4. safe human take-back with a real in-page movement key
await page.keyboard.down('KeyW');
await page.waitForTimeout(400);
await page.keyboard.up('KeyW');
await page.waitForTimeout(300);
report.steps.push({ name: 'human-takeback', state: await snap() });

// 5. death hands control back and stops AI
await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  gs.world.onPlayerDeath();
});
await page.waitForTimeout(1200);
report.steps.push({ name: 'death', state: await snap(), scenes: await page.evaluate(() => window.__game.scene.getScenes(true).map((s) => s.constructor.name)) });
await page.screenshot({ path: `${SHOTS}/wip-1280x720-death.png` });

report.errors = errors;
console.log(JSON.stringify(report, null, 2));
await browser.close();
