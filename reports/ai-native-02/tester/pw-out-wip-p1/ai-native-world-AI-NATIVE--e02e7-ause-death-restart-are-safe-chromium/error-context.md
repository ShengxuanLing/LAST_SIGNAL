# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ai-native-world.spec.ts >> AI-NATIVE-02 P1 real World >> human and local deterministic AI share one control path; takeover/pause/death/restart are safe
- Location: tests\ai-native-world.spec.ts:163:3

# Error details

```
Error: AI actually moved (>2 distinct positions)

expect(received).toBeGreaterThan(expected)

Expected: > 2
Received:   2
```

# Test source

```ts
  130 |     const g: any = (window as any).__game;
  131 |     const menu: any = g.scene.getScene('MainMenuScene');
  132 |     const orig = menu.scene.start.bind(menu.scene);
  133 |     menu.scene.start = (key: string, data?: any) => {
  134 |       if (key === 'GameScene') return orig(key, { seed });
  135 |       return orig(key, data);
  136 |     };
  137 |   }, SEED);
  138 |   await clickLogical(page, 640, 340);
  139 |   await page.waitForTimeout(1500);
  140 | }
  141 | 
  142 | async function enableAiViaPause(page: Page): Promise<void> {
  143 |   await page.keyboard.press('Escape');
  144 |   await page.waitForTimeout(550);
  145 |   const paused = await state(page);
  146 |   expect(paused?.active, 'PauseScene open').toContain('PauseScene');
  147 |   await clickLogical(page, 640, 540); // AI CONTROL button
  148 |   await page.waitForTimeout(550);
  149 |   const on = await state(page);
  150 |   expect(on?.aiEnabled, 'AI demo enabled from Pause menu').toBe(true);
  151 |   await page.keyboard.press('Escape'); // PauseScene closes -> GameScene.onResume()
  152 |   await page.waitForTimeout(900);
  153 |   const after = await state(page);
  154 |   console.log('DEBUG enableAiViaPause after ESC', JSON.stringify({
  155 |     active: after?.active, paused: after?.paused, owner: after?.owner,
  156 |     aiEnabled: after?.aiEnabled, authorityPaused: after?.authorityPaused, mode: after?.mode
  157 |   }));
  158 | }
  159 | 
  160 | test.describe('AI-NATIVE-02 P1 real World', () => {
  161 |   test.use({ viewport: { width: 1280, height: 720 } });
  162 | 
  163 |   test('human and local deterministic AI share one control path; takeover/pause/death/restart are safe', async ({ page }) => {
  164 |     const errors: string[] = [];
  165 |     page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  166 |     page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  167 |     mkdirSync(OUT, { recursive: true });
  168 | 
  169 |     await bootRun(page);
  170 |     let st = await state(page);
  171 |     expect(st, 'GameScene world exists').not.toBeNull();
  172 |     expect(st!.active, 'GameScene active').toContain('GameScene');
  173 |     // Honest default: human control, no external agent.
  174 |     expect(st!.owner).toBe('human');
  175 |     expect(st!.aiEnabled).toBe(false);
  176 |     expect(st!.mode).toBe('HUMAN');
  177 |     expect(st!.txtControl).toContain('HUMAN');
  178 |     expect(st!.txtAgentLink).toContain('EXTERNAL NOT CONNECTED');
  179 |     expect(st!.txtAgentLink).toContain('LOCAL DETERMINISTIC');
  180 |     expect(st!.externalAgentConnected).toBe(false);
  181 |     expect(st!.lastIntentOwner).toBe('human');
  182 |     record('human-default', { mode: st!.mode, txtControl: st!.txtControl, txtAgentLink: st!.txtAgentLink });
  183 |     await page.screenshot({ path: path.join(OUT, 'hud-human-1280x720.png') });
  184 | 
  185 |     // Pause menu exposes the dev entry and labels the demo honestly.
  186 |     await page.keyboard.press('Escape');
  187 |     await page.waitForTimeout(500);
  188 |     const pauseLabels = await page.evaluate(() => {
  189 |       const g: any = (window as any).__game;
  190 |       const ps: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'PauseScene');
  191 |       return (ps.children.list as any[]).filter((c) => c.type === 'Text').map((c) => c.text);
  192 |     });
  193 |     expect(pauseLabels.some((t: string) => t.includes('AI CONTROL: OFF')), 'AI toggle shown as OFF').toBe(true);
  194 |     expect(pauseLabels.some((t: string) => t.includes('EXTERNAL AGENT  NOT CONNECTED')), 'pause states no external agent').toBe(true);
  195 |     await page.screenshot({ path: path.join(OUT, 'pause-ai-entry-1280x720.png') });
  196 |     record('pause-entry', { labels: pauseLabels.filter((t: string) => t.includes('AI') || t.includes('AGENT') || t.includes('CONTROL')) });
  197 | 
  198 |     await clickLogical(page, 640, 540);
  199 |     await page.waitForTimeout(550);
  200 |     st = await state(page);
  201 |     expect(st!.aiEnabled, 'AI enabled while paused').toBe(true);
  202 |     expect(st!.owner, 'owner flips to AI').toBe('ai');
  203 |     expect(st!.authorityPaused, 'authority frozen while paused').toBe(true);
  204 |     record('ai-enabled-paused', { owner: st!.owner, paused: st!.paused, aiEnabled: st!.aiEnabled });
  205 | 
  206 |     await page.keyboard.press('Escape');
  207 |     await page.waitForTimeout(900);
  208 |     st = await state(page);
  209 |     expect(st!.paused, 'game resumed').toBe(false);
  210 |     expect(st!.owner, 'AI owns the live run').toBe('ai');
  211 |     expect(st!.mode).toBe('AI');
  212 |     expect(st!.txtControl).toContain('LOCAL DETERMINISTIC');
  213 | 
  214 |     // Sample the running AI: it must actually move and report real actions.
  215 |     const samples: Array<Record<string, unknown>> = [];
  216 |     for (let i = 0; i < 8; i++) {
  217 |       await page.waitForTimeout(650);
  218 |       const s = await state(page);
  219 |       samples.push({
  220 |         i, grid: s!.grid, action: s!.lastAiAction, target: s!.lastAiTarget,
  221 |         room: s!.room, enemies: s!.enemies, projectiles: s!.projectiles,
  222 |         intentOwner: s!.lastIntentOwner, hp: s!.hp, damage: s!.damage
  223 |       });
  224 |       await page.screenshot({ path: path.join(OUT, `ai-run-${String(i).padStart(2, '0')}.png`) });
  225 |     }
  226 |     record('ai-samples', { samples });
  227 |     st = await state(page);
  228 | 
  229 |     const distinct = new Set(samples.map((s) => `${(s.grid as any).x.toFixed(2)},${(s.grid as any).y.toFixed(2)}`));
> 230 |     expect(distinct.size, 'AI actually moved (>2 distinct positions)').toBeGreaterThan(2);
      |                                                                        ^ Error: AI actually moved (>2 distinct positions)
  231 |     const actions = new Set(samples.map((s) => String(s.action)));
  232 |     expect(actions.size, 'AI reported real action changes').toBeGreaterThan(1);
  233 |     expect(st!.aiActionCount, 'AI executed a countable sequence of actions').toBeGreaterThan(1);
  234 |     expect(st!.lastAiAction, 'HUD has a last AI action').toBeTruthy();
  235 |     expect(st!.txtAiAction, 'HUD shows the AI action').toContain(String(st!.lastAiAction));
  236 |     expect(st!.txtAiTarget, 'HUD shows the AI target').toContain(String(st!.lastAiTarget));
  237 |     expect(st!.lastIntentOwner, 'last executed intent came from AI').toBe('ai');
  238 |     record('ai-summary', {
  239 |       aiActionCount: st!.aiActionCount, lastAiAction: st!.lastAiAction, lastAiTarget: st!.lastAiTarget,
  240 |       movedTo: st!.grid, room: st!.room, enemies: st!.enemies
  241 |     });
  242 |     await page.screenshot({ path: path.join(OUT, 'ai-active-hud-1280x720.png') });
  243 | 
  244 |     // Human safe takeover: one movement key press wins immediately.
  245 |     const beforeTakeover = await state(page);
  246 |     await page.keyboard.down('KeyD');
  247 |     await page.waitForTimeout(450);
  248 |     await page.keyboard.up('KeyD');
  249 |     await page.waitForTimeout(250);
  250 |     st = await state(page);
  251 |     expect(st!.owner, 'human regained ownership').toBe('human');
  252 |     expect(st!.aiEnabled, 'local demo disabled after takeover').toBe(false);
  253 |     expect(st!.takeoverCount, 'takeover recorded').toBe(1);
  254 |     expect(st!.lastTakeoverReason).toBe('human-input');
  255 |     expect(st!.lastIntentOwner).toBe('human');
  256 |     expect(st!.txtControl).toContain('HUMAN');
  257 |     expect(st!.grid.x, 'human input actually moved the player').not.toBe(beforeTakeover!.grid.x);
  258 |     record('human-takeover', { owner: st!.owner, takeoverCount: st!.takeoverCount, reason: st!.lastTakeoverReason });
  259 | 
  260 |     // Pause freezes even a re-enabled AI (no hidden stepping while paused).
  261 |     await enableAiViaPause(page);
  262 |     await page.waitForTimeout(900);
  263 |     const beforePause = await state(page);
  264 |     expect(beforePause!.owner).toBe('ai');
  265 |     await page.keyboard.press('Escape');
  266 |     await page.waitForTimeout(300);
  267 |     const pausedFrozen = await state(page);
  268 |     await page.waitForTimeout(900);
  269 |     const afterWait = await state(page);
  270 |     expect(pausedFrozen!.paused, 'game paused').toBe(true);
  271 |     expect(pausedFrozen!.authorityPaused, 'authority paused').toBe(true);
  272 |     expect(afterWait!.grid.x, 'player frozen while paused').toBeCloseTo(pausedFrozen!.grid.x, 6);
  273 |     expect(afterWait!.grid.y, 'player frozen while paused').toBeCloseTo(pausedFrozen!.grid.y, 6);
  274 |     record('pause-freeze', { owner: pausedFrozen!.owner, paused: pausedFrozen!.paused, frozenAt: pausedFrozen!.grid });
  275 |     await page.keyboard.press('Escape'); // resume
  276 |     await page.waitForTimeout(600);
  277 |     expect((await state(page))!.owner).toBe('ai');
  278 | 
  279 |     // Death ends the run: AI is dropped and control returns to the human.
  280 |     await page.evaluate(() => {
  281 |       const g: any = (window as any).__game;
  282 |       const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
  283 |       gs.world.player.invuln = 0;
  284 |       gs.world.player.hurt(999999, gs.world.player.wx + 1, gs.world.player.wy);
  285 |     });
  286 |     await page.waitForTimeout(1000);
  287 |     const dead = await state(page);
  288 |     expect(dead!.active, 'GameOverScene after death').toContain('GameOverScene');
  289 |     expect(dead!.owner, 'ownership back to human after death').toBe('human');
  290 |     expect(dead!.aiEnabled, 'AI disabled after death').toBe(false);
  291 |     expect(dead!.authorityPaused, 'authority paused after death').toBe(true);
  292 |     record('death', { active: dead!.active, owner: dead!.owner, aiEnabled: dead!.aiEnabled });
  293 |     await page.screenshot({ path: path.join(OUT, 'death-ownership-1280x720.png') });
  294 | 
  295 |     // Restart: a brand-new run boots human-controlled, with no residual state.
  296 |     await clickLogical(page, 640, 500); // RETRY SAME SEED
  297 |     await page.waitForTimeout(1600);
  298 |     const restarted = await state(page);
  299 |     expect(restarted!.active, 'new GameScene after restart').toContain('GameScene');
  300 |     expect(restarted!.paused, 'new run resumed').toBe(false);
  301 |     expect(restarted!.owner, 'new run starts human-controlled').toBe('human');
  302 |     expect(restarted!.aiEnabled, 'no AI state carried into new run').toBe(false);
  303 |     expect(restarted!.aiActionCount).toBe(0);
  304 |     expect(restarted!.takeoverCount).toBe(0);
  305 |     record('restart', { owner: restarted!.owner, aiEnabled: restarted!.aiEnabled, aiActionCount: restarted!.aiActionCount });
  306 | 
  307 |     // Scene exit: QUIT TO MENU must shut the World down without errors.
  308 |     await page.keyboard.press('Escape');
  309 |     await page.waitForTimeout(500);
  310 |     await clickLogical(page, 640, 480); // QUIT TO MENU
  311 |     await page.waitForTimeout(1000);
  312 |     const exited = await state(page);
  313 |     const menuActive = await page.evaluate(() =>
  314 |       (window as any).__game.scene.getScenes(true).map((s: any) => s.constructor.name));
  315 |     expect(menuActive, 'MainMenuScene active after quit').toContain('MainMenuScene');
  316 |     expect(menuActive, 'GameScene stopped after quit').not.toContain('GameScene');
  317 |     record('scene-exit', { active: menuActive, stateAfterExit: exited });
  318 |     expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
  319 |     saveLog('1280x720');
  320 |   });
  321 | 
  322 |   for (const [w, h] of [[1920, 1080], [1024, 768]] as Array<[number, number]>) {
  323 |     test(`HUD is fully visible and non-overlapping at ${w}x${h}`, async ({ page }) => {
  324 |       const errors: string[] = [];
  325 |       page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  326 |       page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  327 |       await page.setViewportSize({ width: w, height: h });
  328 |       mkdirSync(OUT, { recursive: true });
  329 | 
  330 |       await bootRun(page);
```