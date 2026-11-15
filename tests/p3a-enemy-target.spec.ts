// P3-a fix — legacy enemies must legally select and hurt the ECHO.
//
// Fixture disclosure: the test uses the World's owner/dev facades to place the
// protagonist and spawn a real legacy enemy through the normal spawn queue.
// Damage/FSM/ranged projectiles are the real core paths, not synthetic writes.

import { expect, test } from '@playwright/test';

async function bootRun(page: any): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('lastSignal.save.v1'));
  await page.reload();
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('MainMenuScene'));
  const newRun = await page.evaluate(() => {
    const g: any = (window as any).__game;
    for (const s of Object.values(g.scene.scenes) as any[]) {
      if (!g.scene.isActive(s.sys.settings.key)) continue;
      const t = s.children.list.find((c: any) => c.type === 'Text' && (c.text || '').trim().startsWith('NEW RUN') && c.visible !== false);
      if (t) return { x: t.x, y: t.y };
    }
    return null;
  });
  expect(newRun).not.toBeNull();
  await page.mouse.click(newRun!.x, newRun!.y);
  await page.waitForFunction(() => (window as any).__game?.scene.isActive('GameScene'));
}

interface Probe {
  echo: { x: number; y: number; hp: number } | null;
  playerHp: number;
  enemies: Array<{ id: number; kind: string; hp: number; state: string }>;
}

async function probe(page: any): Promise<Probe> {
  return page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    const e = w.echoActor;
    return {
      echo: e ? { x: e.x, y: e.y, hp: e.data.hp } : null,
      playerHp: w.player.data.hp,
      enemies: w.enemies.map((en: any) => ({ id: en._id, kind: en.data.kind, hp: en.hp, state: en.data.state }))
    };
  });
}

test('legacy hunter legally targets and damages the echo, then re-selects the player', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await bootRun(page);

  // Enable the real echo actor (owner API) and wait for the committed spawn.
  await page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    gs.world.enableEcho();
  });
  await page.waitForFunction(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    return !!gs.world.echoActor;
  });

  // Player far away, real hunter spawned next to the echo through the queue.
  const setup = await page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    const e = w.echoActor;
    let far = null as null | { x: number; y: number };
    for (const row of w.map.tiles) {
      for (const tile of row) {
        if (!w.isWalkable(tile.x, tile.y, 0.5)) continue;
        const d = Math.hypot(tile.x - e.x, tile.y - e.y);
        if (d > 10) { far = { x: tile.x, y: tile.y }; break; }
      }
      if (far) break;
    }
    if (far) w.setPlayerPositionForTest(far.x, far.y);
    // Harness fixtures: isolate one real hunter and keep the protagonist
    // invulnerable while the enemy SHOULD be fighting the echo (both the
    // adapter hit gate and the authoritative core invuln window).
    w.clearEnemiesForTest();
    w.player.invuln = 1e9;
    w.simFixture.player.invuln = 1e9;
    const room = w.currentRoom();
    w.enqueueSpawnEnemy('hunter', e.x + 1, e.y, room?.id ?? 0, 1);
    return { echo: { x: e.x, y: e.y, hp: e.data.hp }, player: { x: w.playerX, y: w.playerY } };
  });
  expect(setup.echo.hp).toBeGreaterThan(0);
  await page.waitForFunction(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    return gs.world.enemies.some((e: any) => e.data.kind === 'hunter');
  }, undefined, { timeout: 20000 });

  const before = await probe(page);
  expect(before.enemies.some((e) => e.kind === 'hunter'), 'real non-drone enemy spawned').toBe(true);
  const playerHp = before.playerHp;

  let echoHurt = false;
  let targetKind: string | null = null;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(250);
    const now = await probe(page);
    if (now.echo && now.echo.hp < before.echo!.hp) echoHurt = true;
    // The legacy FSM records the actor it locked (0 player / 1 echo).
    targetKind = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const en = gs.world.enemies.find((e: any) => e.data.kind !== 'drone');
      return en ? String(en.data.targetId) : null;
    });
    if (echoHurt) break;
  }
  expect(echoHurt, 'legacy enemy damaged the echo (not only chased the player)').toBe(true);
  expect(targetKind, 'legacy FSM locked the echo actor id, not the player').toBe('1');
  const after = await probe(page);
  expect(after.playerHp, 'protagonist HP untouched while the enemy fought the echo').toBe(playerHp);

  // Kill the echo: the same enemy must re-select the protagonist.
  await page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    gs.world.simFixture.echo!.data.hp = 1;
  });
  await page.waitForFunction(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    return !gs.world.echoActor || gs.world.echoActor.data.hp <= 0;
  }, undefined, { timeout: 30000 });

  // Put the player next to the surviving hunter; it must now damage the player.
  await page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    const en = w.enemies.find((e: any) => e.data.kind !== 'drone');
    if (en) w.setPlayerPositionForTest(en.x + 1, en.y);
    w.player.invuln = 0;
    w.simFixture.player.invuln = 0;
  });
  const playerHpBeforeReselect = (await probe(page)).playerHp;
  let playerHurt = false;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(250);
    const now = await probe(page);
    if (now.playerHp < playerHpBeforeReselect) { playerHurt = true; break; }
  }
  expect(playerHurt, 'after echo death the enemy re-selects and hurts the protagonist').toBe(true);

  expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('all legacy enemy kinds and the Boss can legally select and hurt the echo', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await bootRun(page);
  await page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    gs.world.enableEcho();
  });
  await page.waitForFunction(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    return !!gs.world.echoActor;
  });

  const echoSpawn = await page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const e = gs.world.echoActor;
    return { x: e.x, y: e.y };
  });
  const check = async (kind: string): Promise<{ hurt: boolean; locked: boolean }> => {
    await page.evaluate(({ enemyKind, spawn }) => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      const w = gs.world;
      w.clearEnemiesForTest();
      w.resetProjectilesForTest();
      w.player.invuln = 1e9;
      w.simFixture.player.invuln = 1e9;
      const e = w.simFixture.echo!;
      e.data.hp = e.data.maxHp;
      e.invuln = 0;
      e.x = spawn.x;
      e.y = spawn.y;
      let far = null as null | { x: number; y: number };
      for (const row of w.map.tiles) {
        for (const tile of row) {
          if (!w.isWalkable(tile.x, tile.y, 0.5)) continue;
          if (Math.hypot(tile.x - e.x, tile.y - e.y) > 10) { far = { x: tile.x, y: tile.y }; break; }
        }
        if (far) break;
      }
      if (far) w.setPlayerPositionForTest(far.x, far.y);
      const room = w.currentRoom();
      w.spawnEnemy(enemyKind, e.x + 1, e.y, room?.id ?? 0, 1);
    }, { enemyKind: kind, spawn: echoSpawn });
    let hurt = false;
    let locked = false;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(200);
      const s = await page.evaluate(() => {
        const gs: any = (window as any).__game.scene.getScene('GameScene');
        const w = gs.world;
        const en = w.enemies.find((e: any) => e.data.kind !== 'drone');
        return { hp: w.echoActor?.data.hp ?? 0, kind: en?.data.targetActorKind ?? null };
      });
      if (s.hp < 100) hurt = true;
      if (s.kind === 'echo') locked = true;
      if (hurt && locked) break;
    }
    return { hurt, locked };
  };

  for (const kind of ['hunter', 'stalker', 'sentinel']) {
    const result = await check(kind);
    expect(result.hurt, `${kind} really damaged the echo`).toBe(true);
    expect(result.locked, `${kind} locked the echo actor kind`).toBe(true);
  }

  // Boss: real boss spawn in a real boss room, echo placed inside melee range.
  await page.evaluate(() => {
    const gs: any = (window as any).__game.scene.getScene('GameScene');
    const w = gs.world;
    w.clearEnemiesForTest();
    w.player.invuln = 1e9;
    w.simFixture.player.invuln = 1e9;
    const bossRoom = w.map.rooms.find((r: any) => r.kind === 'boss');
    if (!bossRoom) return;
    w.spawnBoss(bossRoom);
    const b = w.boss;
    const e = w.simFixture.echo!;
    e.data.hp = e.data.maxHp;
    e.invuln = 0;
    e.x = b.x + 1.5;
    e.y = b.y;
    w.enteredRooms.add(bossRoom.id);
    let far = null as null | { x: number; y: number };
    for (const row of w.map.tiles) {
      for (const tile of row) {
        if (!w.isWalkable(tile.x, tile.y, 0.5)) continue;
        if (Math.hypot(tile.x - e.x, tile.y - e.y) > 14) { far = { x: tile.x, y: tile.y }; break; }
      }
      if (far) break;
    }
    if (far) w.setPlayerPositionForTest(far.x, far.y);
  });
  let bossHurt = false;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(200);
    const hp = await page.evaluate(() => {
      const gs: any = (window as any).__game.scene.getScene('GameScene');
      return gs.world.echoActor?.data.hp ?? 0;
    });
    if (hp < 100) { bossHurt = true; break; }
  }
  expect(bossHurt, 'Boss really damaged the echo').toBe(true);
  expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
