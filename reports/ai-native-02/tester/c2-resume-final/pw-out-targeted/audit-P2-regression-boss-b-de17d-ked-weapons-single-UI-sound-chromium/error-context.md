# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: audit.spec.ts >> P2 regression: boss bullets, screen-locked light, unlocked weapons, single UI sound
- Location: tests\audit.spec.ts:508:1

# Error details

```
Error: laser(3) + shockwave(12) bullets created

expect(received).toBe(expected) // Object.is equality

Expected: 15
Received: 16
```

# Test source

```ts
  613 |   // Emptying a magazine now auto-recovers instead of locking the weapon forever.
  614 |   await page.evaluate(() => {
  615 |     const g: any = (window as any).__game;
  616 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
  617 |     const ws = gs.world.player.data.weapons.find((w: any) => w.key === 'scatter');
  618 |     ws.ammo = 0; ws.reloading = true; ws.reloadTimer = 0.05;
  619 |   });
  620 |   await page.waitForTimeout(250);
  621 |   const reloaded = await page.evaluate(() => {
  622 |     const g: any = (window as any).__game;
  623 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
  624 |     const ws = gs.world.player.data.weapons.find((w: any) => w.key === 'scatter');
  625 |     return { ammo: ws.ammo, reloading: ws.reloading };
  626 |   });
  627 |   expect(reloaded.reloading, 'reload finishes').toBe(false);
  628 |   expect(reloaded.ammo, 'magazine refilled').toBe(8);
  629 | 
  630 |   // ---- screen-locked worldLight: before camera move ----
  631 |   const lightRect = () => page.evaluate(() => {
  632 |     const g: any = (window as any).__game;
  633 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
  634 |     const cam = gs.cameras.main, L = gs.world.renderer.light;
  635 |     const m = Array.from(cam.matrix.matrix) as number[];
  636 |     const tp = cam.matrix.transformPoint(L.x - cam.scrollX * L.scrollFactorX, L.y - cam.scrollY * L.scrollFactorY, { x: 0, y: 0 });
  637 |     return { x: tp.x, y: tp.y, w: 1280 * L.scaleX * m[0], h: 720 * L.scaleY * m[3],
  638 |       zoom: cam.zoom, scrollX: cam.scrollX, scrollY: cam.scrollY,
  639 |       scrollFactorX: L.scrollFactorX, originX: L.originX, visible: L.visible,
  640 |       prerenderListeners: gs.events.listenerCount('prerender') };
  641 |   });
  642 |   const lightBefore = await lightRect();
  643 |   expect(lightBefore.scrollFactorX, 'worldLight scrollFactorX = 0').toBe(0);
  644 |   expect(lightBefore.originX, 'worldLight origin(0,0)').toBe(0);
  645 |   expect(lightBefore.visible, 'worldLight visible').toBe(true);
  646 |   expect(Math.abs(lightBefore.x), 'light left edge at screen x=0').toBeLessThan(2);
  647 |   expect(Math.abs(lightBefore.y), 'light top edge at screen y=0').toBeLessThan(2);
  648 |   expect(Math.abs(lightBefore.w - 1280), 'light covers full screen width').toBeLessThan(2);
  649 |   expect(Math.abs(lightBefore.h - 720), 'light covers full screen height').toBeLessThan(2);
  650 |   await page.screenshot({ path: path.join(SHOT_DIR, 'p2-light-before-camera-move.png') });
  651 | 
  652 |   // Move the player to another room AND change zoom; light must stay locked.
  653 |   await page.evaluate(() => {
  654 |     const g: any = (window as any).__game;
  655 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
  656 |     const w = gs.world, t = w.map.rooms[3];
  657 |     w.player.reset(t.gx + t.w / 2, t.gy + t.h / 2);
  658 |     gs.cameras.main.setZoom(1.25);
  659 |   });
  660 |   await page.waitForTimeout(300);
  661 |   const lightAfter = await lightRect();
  662 |   await page.screenshot({ path: path.join(SHOT_DIR, 'p2-light-after-camera-move.png') });
  663 |   expect(Math.abs(lightAfter.scrollX - lightBefore.scrollX), 'camera actually scrolled').toBeGreaterThan(50);
  664 |   expect(Math.abs(lightAfter.zoom - lightBefore.zoom), 'camera actually zoomed').toBeGreaterThan(0.02);
  665 |   expect(Math.abs(lightAfter.x - lightBefore.x), 'light screen x unchanged after camera move/zoom').toBeLessThan(2);
  666 |   expect(Math.abs(lightAfter.y - lightBefore.y), 'light screen y unchanged after camera move/zoom').toBeLessThan(2);
  667 |   expect(Math.abs(lightAfter.w - 1280), 'light still covers width after zoom').toBeLessThan(2);
  668 |   expect(Math.abs(lightAfter.h - 720), 'light still covers height after zoom').toBeLessThan(2);
  669 |   expect(lightAfter.prerenderListeners, 'no duplicate prerender listeners').toBe(1);
  670 | 
  671 |   // ---- Boss bullets: normalised speed + still visible after 0.5s ----
  672 |   const bossInit = await page.evaluate(() => {
  673 |     const g: any = (window as any).__game;
  674 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
  675 |     const w = gs.world, pl = w.player;
  676 |     for (const q of w.projectiles) q.spr.destroy();
  677 |     w.resetProjectilesForTest();
  678 |     if (!w.boss) w.spawnBoss(w.map.rooms[w.currentRoom()?.id ?? 0]);
  679 |     const boss = w.boss;
  680 |     // The player was just reset() into this room and is invulnerable, so a Boss
  681 |     // spawned on top of the player would have all 15 bullets consumed by the
  682 |     // player-collision check on the very first frame (no knockback while invuln).
  683 |     // Put the Boss on a walkable tile ~9 grid units away so the barrage actually
  684 |     // flies and stays inside the visible viewport.
  685 |     const offsets = [[9, 0], [9, -3], [9, 3], [7, -6], [-9, 0], [0, -9]];
  686 |     const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  687 |     for (const [dx, dy] of offsets) {
  688 |       const nx = pl.wx + dx, ny = pl.wy + dy;
  689 |       if (w.isWalkable(nx, ny, 0.5) && w.tileAt(nx, ny).type !== 'wall') {
  690 |         w.enqueueTargetMove(boss._id, nx, ny);
  691 |         w.resetSimulationAccumulator();
  692 |         w.stepFrame(1000 / 60 + 1e-6, neutral);
  693 |         break;
  694 |       }
  695 |     }
  696 |     boss.attackTimer = 999999; boss.stateTimer = 999999; // freeze auto-attacks
  697 |     const c0 = w.simFixture.projectiles.length;
  698 |     boss.phase = 2; boss.fireLaser(pl); boss.shockwave();
  699 |     w.resetSimulationAccumulator();
  700 |     w.stepFrame(1000 / 60 + 1e-6, neutral);
  701 |     const created = w.projectiles.slice(c0);
  702 |     const cam = gs.cameras.main;
  703 |     return {
  704 |       count: created.length,
  705 |       speeds: created.map((q: any) => Math.hypot(q.data.vel.x, q.data.vel.y)),
  706 |       bullets: created.map((q: any) => ({
  707 |         id: q.data.id, pos: { x: q.data.pos.x, y: q.data.pos.y },
  708 |         vel: { x: q.data.vel.x, y: q.data.vel.y }, visible: q.spr.visible,
  709 |         screen: (() => { const tp = cam.matrix.transformPoint(q.spr.x - cam.scrollX, q.spr.y - cam.scrollY, { x: 0, y: 0 }); return { x: tp.x, y: tp.y }; })()
  710 |       }))
  711 |     };
  712 |   });
> 713 |   expect(bossInit.count, 'laser(3) + shockwave(12) bullets created').toBe(15);
      |                                                                      ^ Error: laser(3) + shockwave(12) bullets created
  714 |   const maxSpeed = Math.max(...bossInit.speeds);
  715 |   const minSpeed = Math.min(...bossInit.speeds);
  716 |   expect(minSpeed, 'Boss bullets still have velocity (phase-1 guarantee)').toBeGreaterThan(0);
  717 |   expect(maxSpeed, 'Boss bullet speed normalised (<= 3 tile/s, not 160)').toBeLessThanOrEqual(3);
  718 |   expect(Math.abs(maxSpeed - 2.5), 'laser = 160/64 = 2.5 tile/s').toBeLessThan(0.01);
  719 |   expect(Math.abs(minSpeed - 1.875), 'shockwave = 120/64 = 1.875 tile/s').toBeLessThan(0.01);
  720 |   expect(bossInit.bullets.every((b: any) => b.visible), 'all Boss bullet sprites visible').toBe(true);
  721 |   expect(bossInit.bullets.every((b: any) => b.screen.x > 0 && b.screen.x < 1280 && b.screen.y > 0 && b.screen.y < 720),
  722 |     'Boss bullets spawn inside the visible viewport').toBe(true);
  723 |   await page.waitForTimeout(500);
  724 |   const afterHalf = await page.evaluate(() => {
  725 |     const g: any = (window as any).__game;
  726 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
  727 |     const w = gs.world, cam = gs.cameras.main;
  728 |     return {
  729 |       count: w.projectiles.length,
  730 |       visible: w.projectiles.filter((q: any) => q.spr.visible).length,
  731 |       lifetimes: w.projectiles.map((q: any) => q.data.lifetime),
  732 |       bullets: w.projectiles.map((q: any) => ({
  733 |         id: q.data.id, pos: { x: q.data.pos.x, y: q.data.pos.y },
  734 |         screen: (() => { const tp = cam.matrix.transformPoint(q.spr.x - cam.scrollX, q.spr.y - cam.scrollY, { x: 0, y: 0 }); return { x: tp.x, y: tp.y }; })()
  735 |       }))
  736 |     };
  737 |   });
  738 |   expect(afterHalf.count, 'Boss bullets still exist 0.5s later').toBeGreaterThan(0);
  739 |   expect(afterHalf.visible, 'all surviving Boss bullets still visible').toBe(afterHalf.count);
  740 |   expect(afterHalf.lifetimes.every((l: number) => l > 0), 'bullets not expired').toBe(true);
  741 |   const moved = afterHalf.bullets.some((b: any) => {
  742 |     const before = bossInit.bullets.find((x: any) => x.id === b.id);
  743 |     return before && Math.hypot(b.pos.x - before.pos.x, b.pos.y - before.pos.y) > 0.05;
  744 |   });
  745 |   expect(moved, 'Boss bullets actually travelled (not 160-tile/s teleport)').toBe(true);
  746 |   expect(afterHalf.bullets.every((b: any) => b.screen.x > 0 && b.screen.x < 1280 && b.screen.y > 0 && b.screen.y < 720),
  747 |     'surviving bullets remain on screen after 0.5s').toBe(true);
  748 |   await page.screenshot({ path: path.join(SHOT_DIR, 'p2-boss-barrage.png') });
  749 | 
  750 |   // A boss attack used to shake the camera by ~1e5 px and blank the whole frame.
  751 |   const shakeBounded = await page.evaluate(() => {
  752 |     const g: any = (window as any).__game;
  753 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
  754 |     const cam = gs.cameras.main;
  755 |     const sh: any = (cam as any).shakeEffect;
  756 |     return { offsetX: sh._offsetX, offsetY: sh._offsetY, intensityX: sh.intensity.x };
  757 |   });
  758 |   expect(Math.abs(shakeBounded.offsetX), 'shake offset X bounded to a few px').toBeLessThan(20);
  759 |   expect(Math.abs(shakeBounded.offsetY), 'shake offset Y bounded to a few px').toBeLessThan(20);
  760 |   const bright = await page.evaluate(() => {
  761 |     const g: any = (window as any).__game;
  762 |     const d = g.canvas.getContext('2d').getImageData(0, 0, 1280, 720).data;
  763 |     let n = 0;
  764 |     for (let i = 0; i < d.length; i += 4) if (d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 60) n++;
  765 |     return n;
  766 |   });
  767 |   expect(bright, 'frame is NOT blanked during a Boss attack').toBeGreaterThan(1000);
  768 | 
  769 |   // One card click -> exactly one levelchoose sound (no double play).
  770 |   await page.evaluate(() => {
  771 |     const g: any = (window as any).__game;
  772 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'GameScene');
  773 |     const pl = gs.world.player;
  774 |     pl.world.playerDataFixture.xp = 0; pl.world.playerDataFixture.xpToNext = 30; pl.addXp(30);
  775 |   });
  776 |   await page.waitForTimeout(500);
  777 |   const cardBtn = await page.evaluate(() => {
  778 |     const g: any = (window as any).__game;
  779 |     const ls: any = Object.values(g.scene.scenes).find((s: any) => s?.constructor?.name === 'LevelUpScene');
  780 |     return ls && ls.buttons.length ? { x: ls.buttons[0].x, y: ls.buttons[0].y } : null;
  781 |   });
  782 |   expect(cardBtn, 'LevelUpScene card available').not.toBeNull();
  783 |   // Q/E weapon switches also play a ui sound (2 earlier), so take a fresh
  784 |   // baseline here: a card click must add exactly one levelchoose and zero ui.
  785 |   const uiBeforeCard = await page.evaluate(() => (window as any).__uiCount);
  786 |   await page.mouse.click(Math.round(cardBtn.x), Math.round(cardBtn.y));
  787 |   await page.waitForTimeout(500);
  788 |   const cardSound = await page.evaluate(() => ({ ui: (window as any).__uiCount, choose: (window as any).__chooseCount }));
  789 |   expect(cardSound.choose, 'one card click -> exactly one levelchoose sound').toBe(1);
  790 |   expect(cardSound.ui, 'card click does not add extra ui sounds').toBe(uiBeforeCard);
  791 | 
  792 |   expect(errors, 'no pageerror / console error across P2 flow').toEqual([]);
  793 | });
  794 | 
```