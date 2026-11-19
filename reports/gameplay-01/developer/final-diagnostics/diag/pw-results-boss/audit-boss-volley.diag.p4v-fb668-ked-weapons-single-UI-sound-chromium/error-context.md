# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: audit-boss-volley.diag.p4v4.spec.ts >> P2 regression: boss bullets, screen-locked light, unlocked weapons, single UI sound
- Location: reports\gameplay-01\developer\p4-recovery\diag\audit-boss-volley.diag.p4v4.spec.ts:580:1

# Error details

```
Error: laser(3) + shockwave(12) bullets created

expect(received).toBe(expected) // Object.is equality

Expected: 15
Received: 16
```

# Test source

```ts
  717 |   expect(lightBefore.visible, 'worldLight visible').toBe(true);
  718 |   expect(Math.abs(lightBefore.x), 'light left edge at screen x=0').toBeLessThan(2);
  719 |   expect(Math.abs(lightBefore.y), 'light top edge at screen y=0').toBeLessThan(2);
  720 |   expect(Math.abs(lightBefore.w - 1280), 'light covers full screen width').toBeLessThan(2);
  721 |   expect(Math.abs(lightBefore.h - 720), 'light covers full screen height').toBeLessThan(2);
  722 |   await page.screenshot({ path: path.join(SHOT_DIR, 'p2-light-before-camera-move.png') });
  723 | 
  724 |   // Move the player to another room AND change zoom; light must stay locked.
  725 |   await page.evaluate(() => {
  726 |     const g: any = (window as any).__game;
  727 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'GameScene');
  728 |     const w = gs.world, t = w.map.rooms[3];
  729 |     w.player.reset(t.gx + t.w / 2, t.gy + t.h / 2);
  730 |     gs.cameras.main.setZoom(1.25);
  731 |   });
  732 |   await page.waitForTimeout(300);
  733 |   const lightAfter = await lightRect();
  734 |   await page.screenshot({ path: path.join(SHOT_DIR, 'p2-light-after-camera-move.png') });
  735 |   expect(Math.abs(lightAfter.scrollX - lightBefore.scrollX), 'camera actually scrolled').toBeGreaterThan(50);
  736 |   expect(Math.abs(lightAfter.zoom - lightBefore.zoom), 'camera actually zoomed').toBeGreaterThan(0.02);
  737 |   expect(Math.abs(lightAfter.x - lightBefore.x), 'light screen x unchanged after camera move/zoom').toBeLessThan(2);
  738 |   expect(Math.abs(lightAfter.y - lightBefore.y), 'light screen y unchanged after camera move/zoom').toBeLessThan(2);
  739 |   expect(Math.abs(lightAfter.w - 1280), 'light still covers width after zoom').toBeLessThan(2);
  740 |   expect(Math.abs(lightAfter.h - 720), 'light still covers height after zoom').toBeLessThan(2);
  741 |   expect(lightAfter.prerenderListeners, 'no duplicate prerender listeners').toBe(1);
  742 | 
  743 |   // ---- Boss bullets: normalised speed + still visible after 0.5s ----
  744 |   const bossInit = await page.evaluate(() => {
  745 |     const g: any = (window as any).__game;
  746 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'GameScene');
  747 |     const w = gs.world, pl = w.player;
  748 |     for (const q of w.projectiles) q.spr.destroy();
  749 |     w.resetProjectilesForTest();
  750 |     if (!w.boss) w.spawnBoss(w.map.rooms[w.currentRoom()?.id ?? 0]);
  751 |     const boss = w.boss;
  752 |     // The player was just reset() into this room and is invulnerable, so a Boss
  753 |     // spawned on top of the player would have all 15 bullets consumed by the
  754 |     // player-collision check on the very first frame (no knockback while invuln).
  755 |     // Put the Boss on a walkable tile ~9 grid units away so the barrage actually
  756 |     // flies and stays inside the visible viewport.
  757 |     const offsets = [[9, 0], [9, -3], [9, 3], [7, -6], [-9, 0], [0, -9]];
  758 |     const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  759 |     for (const [dx, dy] of offsets) {
  760 |       const nx = pl.wx + dx, ny = pl.wy + dy;
  761 |       if (w.isWalkable(nx, ny, 0.5) && w.tileAt(nx, ny).type !== 'wall') {
  762 |         w.enqueueTargetMove(boss._id, nx, ny);
  763 |         w.resetSimulationAccumulator();
  764 |         w.stepFrame(1000 / 60 + 1e-6, neutral);
  765 |         break;
  766 |       }
  767 |     }
  768 |     boss.attackTimer = 999999; boss.stateTimer = 999999; // freeze auto-attacks
  769 |     const c0 = w.simFixture.projectiles.length;
  770 |     const preDiag = {
  771 |       coreIds: w.simFixture.projectiles.map((q: any) => q.id),
  772 |       coreLen: w.simFixture.projectiles.length,
  773 |       adapterIds: w.projectiles.map((q: any) => q.data.id),
  774 |       adapterLen: w.projectiles.length,
  775 |       queued: w.simFixture.pendingCommands.map((c: any) => `${c.type}${c.ownerId !== undefined ? '#' + c.ownerId : ''}`),
  776 |       droneAlive: (w.simFixture.drones ?? []).filter((d: any) => d.hp > 0).length,
  777 |       enemiesAlive: (w.enemies ?? []).filter((e: any) => e.alive).length,
  778 |       bossId: boss._id, bossPhase: boss.phase, bossAttackTimer: boss.attackTimer, bossStateTimer: boss.stateTimer
  779 |     };
  780 |     boss.phase = 2; boss.fireLaser(pl); boss.shockwave();
  781 |     const queuedAfterCalls = w.simFixture.pendingCommands.map((c: any) => `${c.type}${c.ownerId !== undefined ? '#' + c.ownerId : ''}`);
  782 |     w.resetSimulationAccumulator();
  783 |     const stepEvents: any[] = (w.stepFrame(1000 / 60 + 1e-6, neutral) as any[]) ?? [];
  784 |     const created = w.projectiles.slice(c0);
  785 |     const postDiag = {
  786 |       coreIds: w.simFixture.projectiles.map((q: any) => q.id),
  787 |       coreLen: w.simFixture.projectiles.length,
  788 |       adapterIds: w.projectiles.map((q: any) => q.data.id),
  789 |       adapterLen: w.projectiles.length,
  790 |       queued: w.simFixture.pendingCommands.map((c: any) => `${c.type}${c.ownerId !== undefined ? '#' + c.ownerId : ''}`),
  791 |       droneAlive: (w.simFixture.drones ?? []).filter((d: any) => d.hp > 0).length,
  792 |       spawned: stepEvents.filter((e: any) => e.type === 'projectile-spawned').map((e: any) => ({
  793 |         id: e.projectile.id, ownerId: e.projectile.ownerId, source: e.projectile.source,
  794 |         kind: e.projectile.kind, vel: { x: e.projectile.vel.x, y: e.projectile.vel.y },
  795 |         pos: { x: e.projectile.pos.x, y: e.projectile.pos.y }
  796 |       })),
  797 |       eventTypes: stepEvents.map((e: any) => e.type)
  798 |     };
  799 |     const cam = gs.cameras.main;
  800 |     return {
  801 |       count: created.length,
  802 |       createdIds: created.map((q: any) => q.data.id),
  803 |       preDiag, queuedAfterCalls, postDiag,
  804 |       speeds: created.map((q: any) => Math.hypot(q.data.vel.x, q.data.vel.y)),
  805 |       bullets: created.map((q: any) => ({
  806 |         id: q.data.id, pos: { x: q.data.pos.x, y: q.data.pos.y },
  807 |         vel: { x: q.data.vel.x, y: q.data.vel.y }, visible: q.spr.visible,
  808 |         screen: (() => { const tp = cam.matrix.transformPoint(q.spr.x - cam.scrollX, q.spr.y - cam.scrollY, { x: 0, y: 0 }); return { x: tp.x, y: tp.y }; })()
  809 |       }))
  810 |     };
  811 |   });
  812 |   // DIAG: persist the full attribution BEFORE the assertion can throw.
  813 |   {
  814 |     mkdirSync(DIAG_DIR, { recursive: true });
  815 |     writeFileSync(path.join(DIAG_DIR, `boss-volley-${RUN_TAG}.json`), JSON.stringify(bossInit, null, 2));
  816 |   }
> 817 |   expect(bossInit.count, 'laser(3) + shockwave(12) bullets created').toBe(15);
      |                                                                      ^ Error: laser(3) + shockwave(12) bullets created
  818 |   const maxSpeed = Math.max(...bossInit.speeds);
  819 |   const minSpeed = Math.min(...bossInit.speeds);
  820 |   expect(minSpeed, 'Boss bullets still have velocity (phase-1 guarantee)').toBeGreaterThan(0);
  821 |   expect(maxSpeed, 'Boss bullet speed normalised (<= 3 tile/s, not 160)').toBeLessThanOrEqual(3);
  822 |   expect(Math.abs(maxSpeed - 2.5), 'laser = 160/64 = 2.5 tile/s').toBeLessThan(0.01);
  823 |   expect(Math.abs(minSpeed - 1.875), 'shockwave = 120/64 = 1.875 tile/s').toBeLessThan(0.01);
  824 |   expect(bossInit.bullets.every((b: any) => b.visible), 'all Boss bullet sprites visible').toBe(true);
  825 |   expect(bossInit.bullets.every((b: any) => b.screen.x > 0 && b.screen.x < 1280 && b.screen.y > 0 && b.screen.y < 720),
  826 |     'Boss bullets spawn inside the visible viewport').toBe(true);
  827 |   await page.waitForTimeout(500);
  828 |   const afterHalf = await page.evaluate(() => {
  829 |     const g: any = (window as any).__game;
  830 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'GameScene');
  831 |     const w = gs.world, cam = gs.cameras.main;
  832 |     return {
  833 |       count: w.projectiles.length,
  834 |       visible: w.projectiles.filter((q: any) => q.spr.visible).length,
  835 |       lifetimes: w.projectiles.map((q: any) => q.data.lifetime),
  836 |       bullets: w.projectiles.map((q: any) => ({
  837 |         id: q.data.id, pos: { x: q.data.pos.x, y: q.data.pos.y },
  838 |         screen: (() => { const tp = cam.matrix.transformPoint(q.spr.x - cam.scrollX, q.spr.y - cam.scrollY, { x: 0, y: 0 }); return { x: tp.x, y: tp.y }; })()
  839 |       }))
  840 |     };
  841 |   });
  842 |   expect(afterHalf.count, 'Boss bullets still exist 0.5s later').toBeGreaterThan(0);
  843 |   expect(afterHalf.visible, 'all surviving Boss bullets still visible').toBe(afterHalf.count);
  844 |   expect(afterHalf.lifetimes.every((l: number) => l > 0), 'bullets not expired').toBe(true);
  845 |   const moved = afterHalf.bullets.some((b: any) => {
  846 |     const before = bossInit.bullets.find((x: any) => x.id === b.id);
  847 |     return before && Math.hypot(b.pos.x - before.pos.x, b.pos.y - before.pos.y) > 0.05;
  848 |   });
  849 |   expect(moved, 'Boss bullets actually travelled (not 160-tile/s teleport)').toBe(true);
  850 |   expect(afterHalf.bullets.every((b: any) => b.screen.x > 0 && b.screen.x < 1280 && b.screen.y > 0 && b.screen.y < 720),
  851 |     'surviving bullets remain on screen after 0.5s').toBe(true);
  852 |   await page.screenshot({ path: path.join(SHOT_DIR, 'p2-boss-barrage.png') });
  853 | 
  854 |   // A boss attack used to shake the camera by ~1e5 px and blank the whole frame.
  855 |   const shakeBounded = await page.evaluate(() => {
  856 |     const g: any = (window as any).__game;
  857 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'GameScene');
  858 |     const cam = gs.cameras.main;
  859 |     const sh: any = (cam as any).shakeEffect;
  860 |     return { offsetX: sh._offsetX, offsetY: sh._offsetY, intensityX: sh.intensity.x };
  861 |   });
  862 |   expect(Math.abs(shakeBounded.offsetX), 'shake offset X bounded to a few px').toBeLessThan(20);
  863 |   expect(Math.abs(shakeBounded.offsetY), 'shake offset Y bounded to a few px').toBeLessThan(20);
  864 |   const bright = await page.evaluate(() => {
  865 |     const g: any = (window as any).__game;
  866 |     const d = g.canvas.getContext('2d').getImageData(0, 0, 1280, 720).data;
  867 |     let n = 0;
  868 |     for (let i = 0; i < d.length; i += 4) if (d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 60) n++;
  869 |     return n;
  870 |   });
  871 |   expect(bright, 'frame is NOT blanked during a Boss attack').toBeGreaterThan(1000);
  872 | 
  873 |   // One card click -> exactly one levelchoose sound (no double play).
  874 |   await page.evaluate(() => {
  875 |     const g: any = (window as any).__game;
  876 |     const gs: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'GameScene');
  877 |     const pl = gs.world.player;
  878 |     pl.world.playerDataFixture.xp = 0; pl.world.playerDataFixture.xpToNext = 30; pl.addXp(30);
  879 |   });
  880 |   await page.waitForTimeout(500);
  881 |   const cardBtn = await page.evaluate(() => {
  882 |     const g: any = (window as any).__game;
  883 |     const ls: any = Object.values(g.scene.scenes).find((s: any) => s?.sys?.settings?.key === 'LevelUpScene');
  884 |     return ls && ls.buttons.length ? { x: ls.buttons[0].x, y: ls.buttons[0].y } : null;
  885 |   });
  886 |   expect(cardBtn, 'LevelUpScene card available').not.toBeNull();
  887 |   // Q/E weapon switches also play a ui sound (2 earlier), so take a fresh
  888 |   // baseline here: a card click must add exactly one levelchoose and zero ui.
  889 |   const uiBeforeCard = await page.evaluate(() => (window as any).__uiCount);
  890 |   await page.mouse.click(Math.round(cardBtn.x), Math.round(cardBtn.y));
  891 |   await page.waitForTimeout(500);
  892 |   const cardSound = await page.evaluate(() => ({ ui: (window as any).__uiCount, choose: (window as any).__chooseCount }));
  893 |   expect(cardSound.choose, 'one card click -> exactly one levelchoose sound').toBe(1);
  894 |   expect(cardSound.ui, 'card click does not add extra ui sounds').toBe(uiBeforeCard);
  895 | 
  896 |   expect(errors, 'no pageerror / console error across P2 flow').toEqual([]);
  897 | });
  898 | 
```