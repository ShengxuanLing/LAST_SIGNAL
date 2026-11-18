# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: audit.spec.ts >> P2 regression: boss bullets, screen-locked light, unlocked weapons, single UI sound
- Location: tests\audit.spec.ts:575:1

# Error details

```
Error: laser(3) + shockwave(12) bullets created

expect(received).toBe(expected) // Object.is equality

Expected: 15
Received: 16
```

# Test source

```ts
  680 |   // Emptying a magazine now auto-recovers instead of locking the weapon forever.
  681 |   await page.evaluate(() => {
  682 |     const g: any = (window as any).__game;
  683 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'GameScene');
  684 |     const ws = gs.world.player.data.weapons.find((w: any) => w.key === 'scatter');
  685 |     ws.ammo = 0; ws.reloading = true; ws.reloadTimer = 0.05;
  686 |   });
  687 |   await page.waitForTimeout(250);
  688 |   const reloaded = await page.evaluate(() => {
  689 |     const g: any = (window as any).__game;
  690 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'GameScene');
  691 |     const ws = gs.world.player.data.weapons.find((w: any) => w.key === 'scatter');
  692 |     return { ammo: ws.ammo, reloading: ws.reloading };
  693 |   });
  694 |   expect(reloaded.reloading, 'reload finishes').toBe(false);
  695 |   expect(reloaded.ammo, 'magazine refilled').toBe(8);
  696 | 
  697 |   // ---- screen-locked worldLight: before camera move ----
  698 |   const lightRect = () => page.evaluate(() => {
  699 |     const g: any = (window as any).__game;
  700 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'GameScene');
  701 |     const cam = gs.cameras.main, L = gs.world.renderer.light;
  702 |     const m = Array.from(cam.matrix.matrix) as number[];
  703 |     const tp = cam.matrix.transformPoint(L.x - cam.scrollX * L.scrollFactorX, L.y - cam.scrollY * L.scrollFactorY, { x: 0, y: 0 });
  704 |     return { x: tp.x, y: tp.y, w: 1280 * L.scaleX * m[0], h: 720 * L.scaleY * m[3],
  705 |       zoom: cam.zoom, scrollX: cam.scrollX, scrollY: cam.scrollY,
  706 |       scrollFactorX: L.scrollFactorX, originX: L.originX, visible: L.visible,
  707 |       prerenderListeners: gs.events.listenerCount('prerender') };
  708 |   });
  709 |   const lightBefore = await lightRect();
  710 |   expect(lightBefore.scrollFactorX, 'worldLight scrollFactorX = 0').toBe(0);
  711 |   expect(lightBefore.originX, 'worldLight origin(0,0)').toBe(0);
  712 |   expect(lightBefore.visible, 'worldLight visible').toBe(true);
  713 |   expect(Math.abs(lightBefore.x), 'light left edge at screen x=0').toBeLessThan(2);
  714 |   expect(Math.abs(lightBefore.y), 'light top edge at screen y=0').toBeLessThan(2);
  715 |   expect(Math.abs(lightBefore.w - 1280), 'light covers full screen width').toBeLessThan(2);
  716 |   expect(Math.abs(lightBefore.h - 720), 'light covers full screen height').toBeLessThan(2);
  717 |   await page.screenshot({ path: path.join(SHOT_DIR, 'p2-light-before-camera-move.png') });
  718 | 
  719 |   // Move the player to another room AND change zoom; light must stay locked.
  720 |   await page.evaluate(() => {
  721 |     const g: any = (window as any).__game;
  722 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'GameScene');
  723 |     const w = gs.world, t = w.map.rooms[3];
  724 |     w.player.reset(t.gx + t.w / 2, t.gy + t.h / 2);
  725 |     gs.cameras.main.setZoom(1.25);
  726 |   });
  727 |   await page.waitForTimeout(300);
  728 |   const lightAfter = await lightRect();
  729 |   await page.screenshot({ path: path.join(SHOT_DIR, 'p2-light-after-camera-move.png') });
  730 |   expect(Math.abs(lightAfter.scrollX - lightBefore.scrollX), 'camera actually scrolled').toBeGreaterThan(50);
  731 |   expect(Math.abs(lightAfter.zoom - lightBefore.zoom), 'camera actually zoomed').toBeGreaterThan(0.02);
  732 |   expect(Math.abs(lightAfter.x - lightBefore.x), 'light screen x unchanged after camera move/zoom').toBeLessThan(2);
  733 |   expect(Math.abs(lightAfter.y - lightBefore.y), 'light screen y unchanged after camera move/zoom').toBeLessThan(2);
  734 |   expect(Math.abs(lightAfter.w - 1280), 'light still covers width after zoom').toBeLessThan(2);
  735 |   expect(Math.abs(lightAfter.h - 720), 'light still covers height after zoom').toBeLessThan(2);
  736 |   expect(lightAfter.prerenderListeners, 'no duplicate prerender listeners').toBe(1);
  737 | 
  738 |   // ---- Boss bullets: normalised speed + still visible after 0.5s ----
  739 |   const bossInit = await page.evaluate(() => {
  740 |     const g: any = (window as any).__game;
  741 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'GameScene');
  742 |     const w = gs.world, pl = w.player;
  743 |     for (const q of w.projectiles) q.spr.destroy();
  744 |     w.resetProjectilesForTest();
  745 |     if (!w.boss) w.spawnBoss(w.map.rooms[w.currentRoom()?.id ?? 0]);
  746 |     const boss = w.boss;
  747 |     // The player was just reset() into this room and is invulnerable, so a Boss
  748 |     // spawned on top of the player would have all 15 bullets consumed by the
  749 |     // player-collision check on the very first frame (no knockback while invuln).
  750 |     // Put the Boss on a walkable tile ~9 grid units away so the barrage actually
  751 |     // flies and stays inside the visible viewport.
  752 |     const offsets = [[9, 0], [9, -3], [9, 3], [7, -6], [-9, 0], [0, -9]];
  753 |     const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  754 |     for (const [dx, dy] of offsets) {
  755 |       const nx = pl.wx + dx, ny = pl.wy + dy;
  756 |       if (w.isWalkable(nx, ny, 0.5) && w.tileAt(nx, ny).type !== 'wall') {
  757 |         w.enqueueTargetMove(boss._id, nx, ny);
  758 |         w.resetSimulationAccumulator();
  759 |         w.stepFrame(1000 / 60 + 1e-6, neutral);
  760 |         break;
  761 |       }
  762 |     }
  763 |     boss.attackTimer = 999999; boss.stateTimer = 999999; // freeze auto-attacks
  764 |     const c0 = w.simFixture.projectiles.length;
  765 |     boss.phase = 2; boss.fireLaser(pl); boss.shockwave();
  766 |     w.resetSimulationAccumulator();
  767 |     w.stepFrame(1000 / 60 + 1e-6, neutral);
  768 |     const created = w.projectiles.slice(c0);
  769 |     const cam = gs.cameras.main;
  770 |     return {
  771 |       count: created.length,
  772 |       speeds: created.map((q: any) => Math.hypot(q.data.vel.x, q.data.vel.y)),
  773 |       bullets: created.map((q: any) => ({
  774 |         id: q.data.id, pos: { x: q.data.pos.x, y: q.data.pos.y },
  775 |         vel: { x: q.data.vel.x, y: q.data.vel.y }, visible: q.spr.visible,
  776 |         screen: (() => { const tp = cam.matrix.transformPoint(q.spr.x - cam.scrollX, q.spr.y - cam.scrollY, { x: 0, y: 0 }); return { x: tp.x, y: tp.y }; })()
  777 |       }))
  778 |     };
  779 |   });
> 780 |   expect(bossInit.count, 'laser(3) + shockwave(12) bullets created').toBe(15);
      |                                                                      ^ Error: laser(3) + shockwave(12) bullets created
  781 |   const maxSpeed = Math.max(...bossInit.speeds);
  782 |   const minSpeed = Math.min(...bossInit.speeds);
  783 |   expect(minSpeed, 'Boss bullets still have velocity (phase-1 guarantee)').toBeGreaterThan(0);
  784 |   expect(maxSpeed, 'Boss bullet speed normalised (<= 3 tile/s, not 160)').toBeLessThanOrEqual(3);
  785 |   expect(Math.abs(maxSpeed - 2.5), 'laser = 160/64 = 2.5 tile/s').toBeLessThan(0.01);
  786 |   expect(Math.abs(minSpeed - 1.875), 'shockwave = 120/64 = 1.875 tile/s').toBeLessThan(0.01);
  787 |   expect(bossInit.bullets.every((b: any) => b.visible), 'all Boss bullet sprites visible').toBe(true);
  788 |   expect(bossInit.bullets.every((b: any) => b.screen.x > 0 && b.screen.x < 1280 && b.screen.y > 0 && b.screen.y < 720),
  789 |     'Boss bullets spawn inside the visible viewport').toBe(true);
  790 |   await page.waitForTimeout(500);
  791 |   const afterHalf = await page.evaluate(() => {
  792 |     const g: any = (window as any).__game;
  793 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'GameScene');
  794 |     const w = gs.world, cam = gs.cameras.main;
  795 |     return {
  796 |       count: w.projectiles.length,
  797 |       visible: w.projectiles.filter((q: any) => q.spr.visible).length,
  798 |       lifetimes: w.projectiles.map((q: any) => q.data.lifetime),
  799 |       bullets: w.projectiles.map((q: any) => ({
  800 |         id: q.data.id, pos: { x: q.data.pos.x, y: q.data.pos.y },
  801 |         screen: (() => { const tp = cam.matrix.transformPoint(q.spr.x - cam.scrollX, q.spr.y - cam.scrollY, { x: 0, y: 0 }); return { x: tp.x, y: tp.y }; })()
  802 |       }))
  803 |     };
  804 |   });
  805 |   expect(afterHalf.count, 'Boss bullets still exist 0.5s later').toBeGreaterThan(0);
  806 |   expect(afterHalf.visible, 'all surviving Boss bullets still visible').toBe(afterHalf.count);
  807 |   expect(afterHalf.lifetimes.every((l: number) => l > 0), 'bullets not expired').toBe(true);
  808 |   const moved = afterHalf.bullets.some((b: any) => {
  809 |     const before = bossInit.bullets.find((x: any) => x.id === b.id);
  810 |     return before && Math.hypot(b.pos.x - before.pos.x, b.pos.y - before.pos.y) > 0.05;
  811 |   });
  812 |   expect(moved, 'Boss bullets actually travelled (not 160-tile/s teleport)').toBe(true);
  813 |   expect(afterHalf.bullets.every((b: any) => b.screen.x > 0 && b.screen.x < 1280 && b.screen.y > 0 && b.screen.y < 720),
  814 |     'surviving bullets remain on screen after 0.5s').toBe(true);
  815 |   await page.screenshot({ path: path.join(SHOT_DIR, 'p2-boss-barrage.png') });
  816 | 
  817 |   // A boss attack used to shake the camera by ~1e5 px and blank the whole frame.
  818 |   const shakeBounded = await page.evaluate(() => {
  819 |     const g: any = (window as any).__game;
  820 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'GameScene');
  821 |     const cam = gs.cameras.main;
  822 |     const sh: any = (cam as any).shakeEffect;
  823 |     return { offsetX: sh._offsetX, offsetY: sh._offsetY, intensityX: sh.intensity.x };
  824 |   });
  825 |   expect(Math.abs(shakeBounded.offsetX), 'shake offset X bounded to a few px').toBeLessThan(20);
  826 |   expect(Math.abs(shakeBounded.offsetY), 'shake offset Y bounded to a few px').toBeLessThan(20);
  827 |   const bright = await page.evaluate(() => {
  828 |     const g: any = (window as any).__game;
  829 |     const d = g.canvas.getContext('2d').getImageData(0, 0, 1280, 720).data;
  830 |     let n = 0;
  831 |     for (let i = 0; i < d.length; i += 4) if (d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 60) n++;
  832 |     return n;
  833 |   });
  834 |   expect(bright, 'frame is NOT blanked during a Boss attack').toBeGreaterThan(1000);
  835 | 
  836 |   // One card click -> exactly one levelchoose sound (no double play).
  837 |   await page.evaluate(() => {
  838 |     const g: any = (window as any).__game;
  839 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'GameScene');
  840 |     const pl = gs.world.player;
  841 |     pl.world.playerDataFixture.xp = 0; pl.world.playerDataFixture.xpToNext = 30; pl.addXp(30);
  842 |   });
  843 |   await page.waitForTimeout(500);
  844 |   const cardBtn = await page.evaluate(() => {
  845 |     const g: any = (window as any).__game;
  846 |     const ls: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'LevelUpScene');
  847 |     return ls && ls.buttons.length ? { x: ls.buttons[0].x, y: ls.buttons[0].y } : null;
  848 |   });
  849 |   expect(cardBtn, 'LevelUpScene card available').not.toBeNull();
  850 |   // Q/E weapon switches also play a ui sound (2 earlier), so take a fresh
  851 |   // baseline here: a card click must add exactly one levelchoose and zero ui.
  852 |   const uiBeforeCard = await page.evaluate(() => (window as any).__uiCount);
  853 |   await page.mouse.click(Math.round(cardBtn.x), Math.round(cardBtn.y));
  854 |   await page.waitForTimeout(500);
  855 |   const cardSound = await page.evaluate(() => ({ ui: (window as any).__uiCount, choose: (window as any).__chooseCount }));
  856 |   expect(cardSound.choose, 'one card click -> exactly one levelchoose sound').toBe(1);
  857 |   expect(cardSound.ui, 'card click does not add extra ui sounds').toBe(uiBeforeCard);
  858 | 
  859 |   expect(errors, 'no pageerror / console error across P2 flow').toEqual([]);
  860 | });
  861 | 
```