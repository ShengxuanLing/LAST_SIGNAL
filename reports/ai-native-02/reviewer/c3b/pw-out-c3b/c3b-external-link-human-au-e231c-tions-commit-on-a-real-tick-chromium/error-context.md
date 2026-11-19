# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: c3b-external-link.spec.ts >> human authorization links the rendered world to the bridge; actions commit on a real tick
- Location: tests\c3b-external-link.spec.ts:20:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "Cannot read properties of null (reading 'heartbeat')",
+ ]
```

# Test source

```ts
  40  |       for (const s of Object.values(g.scene.scenes) as any[]) {
  41  |         if (!g.scene.isActive(s.sys.settings.key)) continue;
  42  |         const t = s.children.list.find((c: any) => c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
  43  |         if (t) return { x: t.x, y: t.y };
  44  |       }
  45  |       return null;
  46  |     });
  47  |     expect(newRun, 'NEW RUN button').not.toBeNull();
  48  |     await page.mouse.click(newRun!.x, newRun!.y);
  49  |     await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
  50  | 
  51  |     // HUMAN authorization through the real Pause menu.
  52  |     await page.keyboard.press('Escape');
  53  |     await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
  54  |     // The pause menu is rendered in the Phaser canvas: locate the label object.
  55  |     const authorizePos = await page.evaluate(() => {
  56  |       const g: any = (window as any).__game;
  57  |       const ps = g.scene.getScene('PauseScene');
  58  |       const t = ps.children.list.find((c: any) => c.type === 'Text' && (c.text || '').startsWith('AUTHORIZE EXTERNAL AGENT'));
  59  |       return t ? { x: t.x, y: t.y } : null;
  60  |     });
  61  |     expect(authorizePos, 'authorization control is present').not.toBeNull();
  62  |     await page.mouse.click(Math.round(authorizePos!.x), Math.round(authorizePos!.y));
  63  |     await expect.poll(async () => page.evaluate(() => {
  64  |       const gs = (window as any).__game.scene.getScene('GameScene');
  65  |       return gs.world.player.control.owner;
  66  |     }), { timeout: 15000 }).toBe('external');
  67  | 
  68  |     // RESUME is also a human action: it grants the freshly authorized link
  69  |     // control of the running game (no automatic re-take ever happens).
  70  |     await page.keyboard.press('Escape');
  71  |     await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
  72  | 
  73  |     // The rendered world owns the session; the agent attaches to it.
  74  |     const client = new WorldClient({ bridgeUrl: bridge.url, token: TOKEN });
  75  |     const handshake = await client.handshake();
  76  |     expect(handshake.ok, 'agent handshake').toBe(true);
  77  | 
  78  |     // The rendered game pushes a post-commit observation; the agent reads it.
  79  |     let observation = null as Awaited<ReturnType<typeof client.observe>> | null;
  80  |     for (let i = 0; i < 60; i += 1) {
  81  |       observation = await client.observe();
  82  |       if (observation.ok && observation.observation.tick > 0) break;
  83  |       await page.waitForTimeout(100);
  84  |     }
  85  |     expect(observation?.ok, 'agent observation').toBe(true);
  86  |     const obs = (observation as { observation: { tick: number; player: { x: number; y: number } } }).observation;
  87  |     expect(obs.tick, 'observation carries a real post-commit tick').toBeGreaterThan(0);
  88  | 
  89  |     // The agent submits an intent; the browser executes it on a real core tick
  90  |     // and ACKs with the post-commit tick.
  91  |     const tickBefore = obs.tick;
  92  |     const submit = await client.submit('req_c3b000000000000000000001', [{
  93  |       type: 'move', actionId: 'aid_c3b000000000000000000001', dir: { x: 1, y: 0 }, ticks: 10
  94  |     }]);
  95  |     expect(submit.ok, 'agent action accepted').toBe(true);
  96  |     expect(submit.actions?.[0]?.status, 'queued, not applied').toBe('queued');
  97  | 
  98  |     // Wait for the REAL post-commit ACK, not merely for a tick to pass.
  99  |     await expect.poll(async () => page.evaluate(() => {
  100 |       const w = (window as any).__game.scene.getScene('GameScene').world;
  101 |       return w.externalLink.receipt('aid_c3b000000000000000000001')?.status ?? 'none';
  102 |     }), { timeout: 15000 }).toBe('applied');
  103 | 
  104 |     // The movement intent was executed by the core (player moved) and the HUD
  105 |     // reports the external owner.
  106 |     const after = await page.evaluate(() => {
  107 |       const gs = (window as any).__game.scene.getScene('GameScene');
  108 |       const w = gs.world;
  109 |       const r = w.externalLink.receipt('aid_c3b000000000000000000001');
  110 |       return {
  111 |         owner: w.player.control.owner,
  112 |         pending: w.hasUncommittedCommands(),
  113 |         linkLabel: gs.txtAgentLink?.text ?? '',
  114 |         receipt: r ? { status: r.status, appliedTick: r.appliedTick } : null,
  115 |         lastAppliedTick: w.externalLink.snapshot().lastAppliedTick
  116 |       };
  117 |     });
  118 |     expect(after.owner, 'external agent owns control').toBe('external');
  119 |     expect(after.pending, 'no pending commands left').toBe(false);
  120 |     expect(after.linkLabel, 'HUD shows the real link state').toContain('EXTERNAL AGENT CONNECTED');
  121 |     // The ACK is produced from the REAL post-commit tick, not from the queue.
  122 |     expect(after.receipt?.status, 'intent applied by the core').toBe('applied');
  123 |     expect(after.receipt?.appliedTick, 'real applied tick recorded').toBeGreaterThan(tickBefore);
  124 |     expect(after.lastAppliedTick, 'HUD last action from the real commit').toBe(after.receipt?.appliedTick);
  125 | 
  126 |     // A human takeover cancels the link and returns control.
  127 |     await page.keyboard.press('Escape');
  128 |     await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
  129 |     await page.keyboard.press('Escape');
  130 |     await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
  131 |     await page.keyboard.press('d');
  132 |     await page.waitForTimeout(200);
  133 |     const takenOver = await page.evaluate(() => {
  134 |       const w = (window as any).__game.scene.getScene('GameScene').world;
  135 |       return { owner: w.player.control.owner, external: w.externalLink.snapshot().status };
  136 |     });
  137 |     expect(takenOver.owner, 'human input takes control back').toBe('human');
  138 |     expect(takenOver.external, 'external link yielded').not.toBe('CONNECTED');
  139 | 
> 140 |     expect(errors).toEqual([]);
      |                    ^ Error: expect(received).toEqual(expected) // deep equality
  141 |   } finally {
  142 |     await bridge.close();
  143 |   }
  144 | });
  145 | 
  146 | test('takeover / overlay / agent disconnect yield the link; no automatic re-take', async ({ page }) => {
  147 |   const gateway = new WorldGateway();
  148 |   const bridge = await startWorldBridge({ gateway, token: TOKEN, allowedOrigins: [ORIGIN] });
  149 |   try {
  150 |     await page.goto('/');
  151 |     await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  152 |     await page.evaluate(({ bridgeUrl, token }) => {
  153 |       (window as any).__externalLinkConfig = { bridgeUrl, token };
  154 |     }, { bridgeUrl: bridge.url, token: TOKEN });
  155 |     const newRun = await page.evaluate(() => {
  156 |       const g: any = (window as any).__game;
  157 |       for (const s of Object.values(g.scene.scenes) as any[]) {
  158 |         if (!g.scene.isActive(s.sys.settings.key)) continue;
  159 |         const t = s.children.list.find((c: any) => c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
  160 |         if (t) return { x: t.x, y: t.y };
  161 |       }
  162 |       return null;
  163 |     });
  164 |     await page.mouse.click(newRun!.x, newRun!.y);
  165 |     await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
  166 | 
  167 |     const authorize = async (): Promise<void> => {
  168 |       await page.keyboard.press('Escape');
  169 |       await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
  170 |       const pos = await page.evaluate(() => {
  171 |         const ps = (window as any).__game.scene.getScene('PauseScene');
  172 |         const t = ps.children.list.find((c: any) => c.type === 'Text' && (c.text || '').startsWith('AUTHORIZE EXTERNAL AGENT'));
  173 |         return t ? { x: t.x, y: t.y } : null;
  174 |       });
  175 |       expect(pos, 'authorization control is present').not.toBeNull();
  176 |       await page.mouse.click(Math.round(pos!.x), Math.round(pos!.y));
  177 |       await expect.poll(async () => page.evaluate(() =>
  178 |         (window as any).__game.scene.getScene('GameScene').world.player.control.owner
  179 |       ), { timeout: 15000 }).toBe('external');
  180 |       await page.keyboard.press('Escape');
  181 |       await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
  182 |     };
  183 | 
  184 |     await authorize();
  185 |     const sessionAfterFirstAuthorize = await page.evaluate(() =>
  186 |       (window as any).__game.scene.getScene('GameScene').world.externalLink.snapshot().session
  187 |     );
  188 | 
  189 |     // Human takeover yields and does NOT auto re-take after the overlay closes.
  190 |     await page.keyboard.press('d');
  191 |     await expect.poll(async () => page.evaluate(() =>
  192 |       (window as any).__game.scene.getScene('GameScene').world.externalLink.snapshot().status
  193 |     )).toBe('YIELDED');
  194 |     expect(await page.evaluate(() =>
  195 |       (window as any).__game.scene.getScene('GameScene').world.player.control.owner
  196 |     )).toBe('human');
  197 |     await page.keyboard.press('Escape');
  198 |     await page.waitForFunction(() => (window as any).__game?.scene.isActive('PauseScene'));
  199 |     await page.keyboard.press('Escape');
  200 |     await page.waitForFunction(() => !(window as any).__game?.scene.isActive('PauseScene'));
  201 |     expect(await page.evaluate(() =>
  202 |       (window as any).__game.scene.getScene('GameScene').world.player.control.owner
  203 |     ), 'no automatic re-take').toBe('human');
  204 | 
  205 |     // A fresh HUMAN authorize is required, and it creates a NEW session
  206 |     // (the old, yielded session cannot be reused).
  207 |     await authorize();
  208 |     const sessionAfterSecondAuthorize = await page.evaluate(() =>
  209 |       (window as any).__game.scene.getScene('GameScene').world.externalLink.snapshot().session
  210 |     );
  211 |     expect(sessionAfterSecondAuthorize).not.toBe(sessionAfterFirstAuthorize);
  212 | 
  213 |     // An agent-side disconnect closes the bridge session; the rendered game
  214 |     // degrades to HUMAN control when its heartbeat fails.
  215 |     const client = new WorldClient({ bridgeUrl: bridge.url, token: TOKEN });
  216 |     expect((await client.handshake()).ok).toBe(true);
  217 |     expect(await client.close()).toBe(true);
  218 |     await expect.poll(async () => page.evaluate(() => {
  219 |       const w = (window as any).__game.scene.getScene('GameScene').world;
  220 |       return { status: w.externalLink.snapshot().status, owner: w.player.control.owner };
  221 |     }), { timeout: 15000 }).toMatchObject({ owner: 'human' });
  222 |     const afterDisconnect = await page.evaluate(() => {
  223 |       const w = (window as any).__game.scene.getScene('GameScene').world;
  224 |       return { status: w.externalLink.snapshot().status, owner: w.player.control.owner };
  225 |     });
  226 |     expect(afterDisconnect.status).not.toBe('CONNECTED');
  227 |   } finally {
  228 |     await bridge.close();
  229 |   }
  230 | });
  231 | 
```