# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: boss-room.spec.ts >> boss room: player, camera bounds and shake stay sane after addShake(18)
- Location: tests\boss-room.spec.ts:14:1

# Error details

```
Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]: INITIALIZING LAST SIGNAL...
```

# Test source

```ts
  4   | 
  5   | const SHOT_DIR = path.resolve(process.env.LS_SHOT_DIR ?? 'screens');
  6   | 
  7   | // Boss-room regression: a real kind==='boss' room of the seed-1 map, player and
  8   | // boss on the walkable tile closest to the room centre, zoom 1.25 and a
  9   | // max-strength shake. Verifies the player stays on screen / centred, the frame
  10  | // is not blanked, the shake is clamped, the camera bounds cover the world layer
  11  | // and the run produces no pageerror / console error.
  12  | test.use({ viewport: { width: 1440, height: 900 } });
  13  | 
  14  | test('boss room: player, camera bounds and shake stay sane after addShake(18)', async ({ page }) => {
  15  |   const errors: string[] = [];
  16  |   page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  17  |   page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  18  | 
  19  |   mkdirSync(SHOT_DIR, { recursive: true });
  20  |   await page.goto('http://localhost:5173/');
  21  |   await page.waitForFunction(() => !!(window as any).__game, { timeout: 10000 });
  22  |   await page.waitForTimeout(1000);
  23  | 
  24  |   // Stop every active scene, then start a fresh deterministic run.
  25  |   await page.evaluate(() => {
  26  |     const g: any = (window as any).__game;
  27  |     for (const s of g.scene.getScenes(true)) g.scene.stop(s.sys.settings.key);
  28  |     g.scene.start('GameScene', { seed: 1 });
  29  |   });
  30  |   await page.waitForFunction(() => {
  31  |     const g: any = (window as any).__game;
  32  |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
  33  |     return !!(gs && gs.world && gs.world.player && g.scene.isActive('GameScene'));
  34  |   }, { timeout: 10000 });
  35  |   await page.waitForTimeout(300);
  36  | 
  37  |   const setup = await page.evaluate(() => {
  38  |     const g: any = (window as any).__game;
  39  |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
  40  |     const w = gs.world, pl = w.player, cam = gs.cameras.main;
  41  | 
  42  |     // A real room from the generated map (not a fabricated boss-room object).
  43  |     const room: any = w.map.rooms.find((r: any) => r.kind === 'boss');
  44  |     if (!room) throw new Error('seed=1 map has no kind==="boss" room');
  45  | 
  46  |     // Walkable tile strictly inside the room bounds, closest to the room centre.
  47  |     const cx = room.gx + room.w / 2, cy = room.gy + room.h / 2;
  48  |     const best = { x: 0, y: 0 };
  49  |     let bestD = Infinity;
  50  |     let foundTile = false;
  51  |     for (const row of w.map.tiles) {
  52  |       for (const t of row) {
  53  |         if (t.x < room.gx || t.x >= room.gx + room.w) continue;
  54  |         if (t.y < room.gy || t.y >= room.gy + room.h) continue;
  55  |         if (!w.isWalkable(t.x, t.y, 0.5)) continue;
  56  |         const d = (t.x + 0.5 - cx) ** 2 + (t.y + 0.5 - cy) ** 2;
  57  |         if (d < bestD) { bestD = d; best.x = t.x; best.y = t.y; foundTile = true; }
  58  |       }
  59  |     }
  60  |     if (!foundTile) throw new Error('boss room has no walkable tile');
  61  | 
  62  |     // reset() restores hp/invuln from its own defaults, so apply ours afterwards.
  63  |     pl.reset(best.x, best.y);
  64  |     pl.data.hp = 1000;
  65  |     pl.data.maxHp = 1000;
  66  |     pl.invuln = 999;
  67  | 
  68  |     // Re-enter the boss room (spawns the real Boss, portal and room HUD).
  69  |     w.currentRoomId = -1;
  70  |     w.updateRoom();
  71  |     if (!w.boss) w.spawnBoss(room);
  72  |     const boss = w.boss;
  73  |     boss.attackTimer = 999;
  74  |     boss.phase = 1;
  75  | 
  76  |     cam.zoom = 1.25;
  77  |     // Phaser's setScroll(x, y) takes numbers: unpack the Vector2 from getScroll,
  78  |     // exactly as GameScene.create does. Zoom first, so getScroll clamps at 1.25.
  79  |     const s = cam.getScroll(pl.sprite.x, pl.sprite.y);
  80  |     cam.setScroll(s.x, s.y);
  81  | 
  82  |     w.addShake(18);
  83  |     return {
  84  |       roomId: room.id,
  85  |       roomKind: room.kind,
  86  |       currentRoomKind: w.currentRoom()?.kind ?? null,
  87  |       tile: { x: best.x, y: best.y },
  88  |       player: { x: pl.wx, y: pl.wy },
  89  |       boss: { x: boss.wx, y: boss.wy, attackTimer: boss.attackTimer, phase: boss.phase },
  90  |       separation: Math.hypot(boss.wx - pl.wx, boss.wy - pl.wy),
  91  |       zoom: cam.zoom
  92  |     };
  93  |   });
  94  | 
  95  |   expect(setup.roomKind, 'found room is a real boss room').toBe('boss');
  96  |   expect(setup.currentRoomKind, 'player stands inside the boss room').toBe('boss');
  97  |   expect(setup.player.x, 'player landed on the chosen walkable tile (x)').toBe(setup.tile.x);
  98  |   expect(setup.player.y, 'player landed on the chosen walkable tile (y)').toBe(setup.tile.y);
  99  |   expect(setup.separation, 'boss does not spawn on top of the player').toBeGreaterThanOrEqual(3);
  100 | 
  101 |   await page.waitForTimeout(300);
  102 |   await page.screenshot({ path: path.join(SHOT_DIR, 'boss-room.png') });
  103 | 
> 104 |   const m = await page.evaluate(() => {
      |                        ^ Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
  105 |     const g: any = (window as any).__game;
  106 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
  107 |     const w = gs.world, pl = w.player, cam = gs.cameras.main;
  108 | 
  109 |     // Invert the live camera transform (scroll + zoom + shake) to get the
  110 |     // player's screen coordinates in the internal 1280x720 canvas.
  111 |     const p0 = cam.getWorldPoint(0, 0);
  112 |     const p1 = cam.getWorldPoint(100, 0);
  113 |     const p2 = cam.getWorldPoint(0, 100);
  114 |     const ax = (p1.x - p0.x) / 100, bx = p0.x;
  115 |     const ay = (p2.y - p0.y) / 100, by = p0.y;
  116 |     const screenX = (pl.sprite.x - bx) / ax;
  117 |     const screenY = (pl.sprite.y - by) / ay;
  118 | 
  119 |     const centre = cam.getWorldPoint(640, 360);
  120 |     const centerErr = Math.hypot(centre.x - pl.sprite.x, centre.y - pl.sprite.y);
  121 | 
  122 |     const canvas = g.canvas;
  123 |     const ctx = canvas.getContext('2d')!;
  124 |     const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  125 |     let bright = 0;
  126 |     for (let i = 0; i < data.length; i += 4) {
  127 |       if (data[i] > 60 || data[i + 1] > 60 || data[i + 2] > 60) bright++;
  128 |     }
  129 |     const bar = gs.bossBarFill;
  130 |     const barScreenX = (bar.x - bx) / ax;
  131 |     const barScreenY = (bar.y - by) / ay;
  132 |     const barRectX = Math.max(0, Math.round(barScreenX - 170));
  133 |     const barRectY = Math.max(0, Math.round(barScreenY - 20));
  134 |     const barRectW = Math.min(canvas.width - barRectX, 340);
  135 |     const barRectH = Math.min(canvas.height - barRectY, 40);
  136 |     const barData = ctx.getImageData(barRectX, barRectY, barRectW, barRectH).data;
  137 |     let bossBarRed = 0;
  138 |     for (let i = 0; i < barData.length; i += 4) {
  139 |       if (barData[i] > 180 && barData[i + 1] < 100 && barData[i + 2] < 120) bossBarRed++;
  140 |     }
  141 | 
  142 |     const sh: any = (cam as any).shakeEffect;
  143 |     const renderer: any = w.renderer;
  144 |     return {
  145 |       screenX, screenY, centerErr, bright,
  146 |       intensityX: sh.intensity.x, intensityY: sh.intensity.y,
  147 |       offsetX: sh._offsetX, offsetY: sh._offsetY,
  148 |       boundsHeight: cam.getBounds().height,
  149 |       layerHeight: renderer.layer.height,
  150 |       playerDepth: pl.sprite.depth,
  151 |       bossDepth: w.boss ? w.boss.sprite.depth : -1,
  152 |       barScreenX, barScreenY, barWidth: bar.width, bossBarRed
  153 |     };
  154 |   });
  155 | 
  156 |   expect(m.screenX, 'player screen x in 0..1280').toBeGreaterThan(0);
  157 |   expect(m.screenX, 'player screen x in 0..1280').toBeLessThan(1280);
  158 |   expect(m.screenY, 'player screen y in 0..720').toBeGreaterThan(0);
  159 |   expect(m.screenY, 'player screen y in 0..720').toBeLessThan(720);
  160 |   expect(m.centerErr, 'camera centre error < 20').toBeLessThan(20);
  161 |   expect(m.bright, 'canvas bright pixels > 2000 (frame not blanked)').toBeGreaterThan(2000);
  162 |   expect(Math.abs(m.intensityX), 'shake intensity x < 0.02').toBeLessThan(0.02);
  163 |   expect(Math.abs(m.intensityY), 'shake intensity y < 0.02').toBeLessThan(0.02);
  164 |   expect(Math.abs(m.offsetX), 'shake _offsetX |.| < 20').toBeLessThan(20);
  165 |   expect(Math.abs(m.offsetY), 'shake _offsetY |.| < 20').toBeLessThan(20);
  166 |   expect(m.boundsHeight, 'camera bounds height >= renderer.layer.height').toBeGreaterThanOrEqual(m.layerHeight);
  167 |   expect(m.playerDepth, 'player renders above boss').toBeGreaterThan(m.bossDepth);
  168 |   expect(m.barScreenY, 'boss HP fill stays near its HUD y under shake').toBeGreaterThan(30);
  169 |   expect(m.barScreenY, 'boss HP fill stays near its HUD y under shake').toBeLessThan(80);
  170 |   expect(m.barWidth, 'boss HP fill has non-zero width').toBeGreaterThan(0);
  171 |   expect(
  172 |     m.bossBarRed,
  173 |     'boss HP bar shows red fill: ' + JSON.stringify({ x: m.barScreenX, y: m.barScreenY, width: m.barWidth, red: m.bossBarRed })
  174 |   ).toBeGreaterThan(1000);
  175 |   expect(errors, 'no pageerror / console error').toHaveLength(0);
  176 | });
  177 | 
```