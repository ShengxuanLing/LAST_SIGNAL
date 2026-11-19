# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai-native-world.spec.ts >> AI-NATIVE-02 P1 real World >> shared control path, AI run, disable/takeover, level-up takeover, pause/death/restart/exit
- Location: tests\ai-native-world.spec.ts:257:3

# Error details

```
Error: PauseScene open

expect(received).toContain(expected) // indexOf

Expected value: "PauseScene"
Received array: ["GameOverScene"]
```

# Test source

```ts
  106 |       active: g.scene.getScenes(true).map((s: any) => s.sys.settings.key),
  107 |       paused: gs.paused,
  108 |       aiEnabled: ctl.aiEnabled,
  109 |       owner: ctl.owner,
  110 |       authorityPaused: ctl.paused,
  111 |       mode: snap.mode,
  112 |       modeLabel: snap.modeLabel,
  113 |       lastAiAction: snap.lastAiAction,
  114 |       lastAiTarget: snap.lastAiTarget,
  115 |       aiActionCount: snap.aiActionCount,
  116 |       takeoverCount: snap.takeoverCount,
  117 |       lastTakeoverReason: snap.lastTakeoverReason,
  118 |       externalAgentConnected: snap.externalAgentConnected,
  119 |       grid: { x: gs.world.player.wx, y: gs.world.player.wy },
  120 |       intent: { move: intent.move, fire: intent.fire, aim: intent.aim, interact: intent.interact },
  121 |       lastIntentOwner: gs.world.player.lastIntentOwner,
  122 |       walkable: gs.world.isWalkable(gs.world.player.wx, gs.world.player.wy, 0.5),
  123 |       enemies: gs.world.enemies.length,
  124 |       projectiles: gs.world.projectiles.length,
  125 |       hp: gs.world.player.data.hp,
  126 |       damage: gs.damageDealt,
  127 |       fireHeld: gs.fireHeld,
  128 |       playerFireHeld: gs.world.player.fireHeld(),
  129 |       inputFlags: { ...gs.world.player.input },
  130 |       weaponKey: gs.world.player.data.weaponKey,
  131 |       visibilityBasis: gs.world.observationView().visibilityBasis,
  132 |       aiPathStats: (window as any).__aiPathStats ?? null,
  133 |       room: gs.world.currentRoom()?.kind ?? null,
  134 |       hpBarText: gs.txtHp.text,
  135 |       txtControl: gs.txtControl.text,
  136 |       txtAiAction: gs.txtAiAction.text,
  137 |       txtAiTarget: gs.txtAiTarget.text,
  138 |       txtAgentLink: gs.txtAgentLink.text,
  139 |       txtHelp: gs.txtHelp.text
  140 |     };
  141 |   });
  142 | }
  143 | 
  144 | async function sceneTexts(page: Page, sceneName: string) {
  145 |   return page.evaluate((name) => {
  146 |     const g: any = (window as any).__game;
  147 |     const s: any = g.scene.getScene(name);
  148 |     if (!s || !g.scene.isActive(name)) return [];
  149 |     return (s.children.list as any[]).filter((c) => c.type === 'Text').map((c) => c.text as string);
  150 |   }, sceneName);
  151 | }
  152 | 
  153 | async function hudRects(page: Page) {
  154 |   return page.evaluate(() => {
  155 |     const g: any = (window as any).__game;
  156 |     // Production builds minify class names: always resolve scenes by key.
  157 |     const gs: any = g.scene.getScene('GameScene');
  158 |     const cam = gs.cameras.main;
  159 |     const p0 = cam.getWorldPoint(0, 0);
  160 |     const px = cam.getWorldPoint(100, 0);
  161 |     const py = cam.getWorldPoint(0, 100);
  162 |     const ax = (px.x - p0.x) / 100, bx = p0.x;
  163 |     const ay = (py.y - p0.y) / 100, by = p0.y;
  164 |     const names = ['txtWeapon', 'txtRoom', 'txtEnemies', 'txtControl', 'txtAiAction', 'txtAiTarget',
  165 |       'txtAgentLink', 'txtHp', 'txtXp', 'txtCurrency', 'txtLevel', 'timer', 'txtStats', 'txtHelp'];
  166 |     return names.map((n) => {
  167 |       const o = gs[n];
  168 |       if (!o) return null;
  169 |       const sx = (o.x - bx) / ax;
  170 |       const sy = (o.y - by) / ay;
  171 |       return {
  172 |         name: n,
  173 |         text: o.text,
  174 |         x: sx - o.originX * o.width,
  175 |         y: sy - o.originY * o.height,
  176 |         w: o.width,
  177 |         h: o.height,
  178 |         color: o.style && o.style.color ? o.style.color : null
  179 |       };
  180 |     }).filter(Boolean);
  181 |   });
  182 | }
  183 | 
  184 | async function bootRun(page: Page): Promise<void> {
  185 |   await page.goto(`http://localhost:${PORT}/`);
  186 |   await page.waitForFunction(() => !!(window as any).__game, { timeout: 15000 });
  187 |   await page.waitForTimeout(1300);
  188 |   // Deterministic fixed seed via the real NEW RUN button (real click below).
  189 |   await page.evaluate((seed) => {
  190 |     const g: any = (window as any).__game;
  191 |     const menu: any = g.scene.getScene('MainMenuScene');
  192 |     const orig = menu.scene.start.bind(menu.scene);
  193 |     menu.scene.start = (key: string, data?: any) => {
  194 |       if (key === 'GameScene') return orig(key, { seed });
  195 |       return orig(key, data);
  196 |     };
  197 |   }, SEED);
  198 |   await clickLogical(page, 640, 340);
  199 |   await page.waitForTimeout(1500);
  200 | }
  201 | 
  202 | async function enableAiViaPause(page: Page): Promise<void> {
  203 |   await page.keyboard.press('Escape');
  204 |   await page.waitForTimeout(550);
  205 |   const paused = await state(page);
> 206 |   expect(paused?.active, 'PauseScene open').toContain('PauseScene');
      |                                             ^ Error: PauseScene open
  207 |   await clickLogical(page, 640, 540); // AI CONTROL button
  208 |   await page.waitForTimeout(550);
  209 |   const on = await state(page);
  210 |   expect(on?.aiEnabled, 'AI demo enabled from Pause menu').toBe(true);
  211 |   await page.keyboard.press('Escape'); // PauseScene closes -> GameScene.onResume()
  212 |   await page.waitForTimeout(900);
  213 | }
  214 | 
  215 | // Test-harness fixture (not a controller action, not gameplay logic):
  216 | // combat difficulty must not kill the run while control transitions are being
  217 | // sampled. Death is still exercised through the real hurt() path later, after
  218 | // invulnerability is explicitly cleared. This is recorded in the operation log.
  219 | async function stabilizeEvidenceRun(page: Page): Promise<void> {
  220 |   await page.evaluate(() => {
  221 |     // World.tryInteract() -> Player.reset() legitimately resets i-frames on
  222 |     // room transitions, so refresh them from the test harness. No HP or
  223 |     // coordinates are changed; the HUD keeps its normal values. The death test
  224 |     // clears i-frames and calls hurt() synchronously in one evaluate below.
  225 |     const apply = () => {
  226 |       const g: any = (window as any).__game;
  227 |       const gs: any = g.scene.getScene('GameScene');
  228 |       if (gs?.world?.player) gs.world.player.invuln = 1e9;
  229 |     };
  230 |     apply();
  231 |     (window as any).__lsKeepAlive = window.setInterval(apply, 100);
  232 |   });
  233 | }
  234 | 
  235 | async function clearLevelUp(page: Page): Promise<number> {
  236 |   let closed = 0;
  237 |   for (let i = 0; i < 5; i++) {
  238 |     const active = await page.evaluate(() =>
  239 |       (window as any).__game.scene.getScenes(true).map((s: any) => s.sys.settings.key));
  240 |     if (!active.includes('LevelUpScene')) break;
  241 |     await page.keyboard.press('1');
  242 |     closed++;
  243 |     await page.waitForTimeout(450);
  244 |   }
  245 |   return closed;
  246 | }
  247 | 
  248 | function walkableOnly(samples: Array<Record<string, unknown>>): void {
  249 |   for (const s of samples) {
  250 |     expect(s.walkable, `sampled position stays walkable @${JSON.stringify(s.grid)}`).toBe(true);
  251 |   }
  252 | }
  253 | 
  254 | test.describe('AI-NATIVE-02 P1 real World', () => {
  255 |   test.use({ viewport: { width: 1280, height: 720 } });
  256 | 
  257 |   test('shared control path, AI run, disable/takeover, level-up takeover, pause/death/restart/exit', async ({ page }) => {
  258 |     test.setTimeout(90000);
  259 |     const errors: string[] = [];
  260 |     page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  261 |     page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  262 |     mkdirSync(OUT, { recursive: true });
  263 | 
  264 |     await bootRun(page);
  265 |     await stabilizeEvidenceRun(page);
  266 |     record('evidence-fixture', {
  267 |       reason: 'avoid unrelated combat death while sampling control transitions; death still tested via real hurt() after clearing i-frames',
  268 |       onlyIFramesRefreshed: true, hpUnchanged: true, coordinatesUnchanged: true,
  269 |       actor: 'test-harness (not the controller)'
  270 |     });
  271 |     let st = await state(page);
  272 |     expect(st, 'GameScene world exists').not.toBeNull();
  273 |     expect(st!.active, 'GameScene active').toContain('GameScene');
  274 |     // Honest default: human control, no external agent.
  275 |     expect(st!.owner).toBe('human');
  276 |     expect(st!.aiEnabled).toBe(false);
  277 |     expect(st!.mode).toBe('HUMAN');
  278 |     expect(st!.txtControl).toContain('HUMAN');
  279 |     expect(st!.txtAgentLink).toContain('EXTERNAL NOT CONNECTED');
  280 |     expect(st!.txtAgentLink).toContain('LOCAL DETERMINISTIC');
  281 |     expect(st!.externalAgentConnected).toBe(false);
  282 |     expect(st!.lastIntentOwner).toBe('human');
  283 |     record('human-default', { mode: st!.mode, txtControl: st!.txtControl, txtAgentLink: st!.txtAgentLink });
  284 |     await page.screenshot({ path: path.join(OUT, 'hud-human-1280x720.png') });
  285 | 
  286 |     // Pause menu exposes the dev entry and labels the demo honestly.
  287 |     await page.keyboard.press('Escape');
  288 |     await page.waitForTimeout(500);
  289 |     const pauseLabels = await sceneTexts(page, 'PauseScene');
  290 |     expect(pauseLabels.some((t) => t.includes('AI CONTROL: OFF')), 'AI toggle shown as OFF when disabled').toBe(true);
  291 |     expect(pauseLabels.some((t) => t.includes('EXTERNAL AGENT  NOT CONNECTED')), 'pause states no external agent').toBe(true);
  292 |     await page.screenshot({ path: path.join(OUT, 'pause-ai-entry-1280x720.png') });
  293 |     record('pause-entry', { labels: pauseLabels });
  294 | 
  295 |     await clickLogical(page, 640, 540);
  296 |     await page.waitForTimeout(550);
  297 |     // Passive in-page sampler: records real core positions every 50ms so a fast
  298 |     // travel burst is not lost to Node<->browser round-trip latency.
  299 |     await page.evaluate(() => {
  300 |       const g: any = (window as any).__game;
  301 |       const gs: any = g.scene.getScene('GameScene');
  302 |       const stats: any = { samples: 0, pathLength: 0, transitions: 0, maxStep: 0, legalSamples: 0, prev: null };
  303 |       (window as any).__aiPathStats = stats;
  304 |       (window as any).__aiPathTimer = setInterval(() => {
  305 |         const w = gs.world;
  306 |         const p = { x: w.sim.player.x, y: w.sim.player.y, room: w.currentRoom()?.kind ?? null };
```