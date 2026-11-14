p='tests/ai-native-world.spec.ts'
s=open(p,encoding='utf-8').read()
start=s.index("    // Fixture: one real drone on a real walkable tile; no i-frames / HP edits.")
end=s.index("    expect(errors, `no console/page errors: ${errors.join(' | ')}`).toHaveLength(0);\n    saveLog('c1-rendered-rules-1280x720');")
new = '''    // Fixture: one real drone on a real walkable tile; no i-frames / HP edits.
    const setup = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world, pl = w.player;
      const room = w.currentRoom();
      let target: any = null;
      for (const d of [2, 1.5, -2, -1.5, 3, -3]) {
        const x = pl.wx + d, y = pl.wy;
        if (w.isWalkable(x, y, 0.5)) { target = { x, y }; break; }
      }
      if (!target) target = { x: pl.wx, y: pl.wy + 2 };
      const enemy = w.spawnEnemy('drone', target.x, target.y, room?.id ?? 0, 1);
      (window as any).__c1Enemy = enemy;
      (window as any).__c1EnemyId = enemy._id;
      return {
        enemyId: enemy._id, enemyHp: enemy._hp, target,
        player: { x: pl.wx, y: pl.wy }, speed: pl.data.speed, tick: w.sim.tick
      };
    });
    expect(setup.enemyId, 'real drone spawned').toBeGreaterThan(0);
    expect(setup.enemyHp).toBeGreaterThan(0);
    record('c1-fixture', { reason: 'one spawned drone + real keyboard/mouse; no i-frames/HP fixture; C2 core state is authoritative', setup });

    // Movement is owned by the fixed-tick core; real KeyD must move that state.
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(200);
    const moved = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world;
      return {
        x: w.sim.player.x, y: w.sim.player.y, tick: w.sim.tick,
        walkable: w.isWalkable(w.sim.player.x, w.sim.player.y, 0.5)
      };
    });
    await page.keyboard.up('KeyD');
    expect(moved.tick, 'core advanced under real input').toBeGreaterThan(setup.tick);
    expect(Math.hypot(moved.x - setup.player.x, moved.y - setup.player.y), 'core player moved').toBeGreaterThan(0.1);
    expect(moved.walkable, 'core player stayed walkable').toBe(true);

    // Drone FSM/state is the same live core state, not an adapter mirror.
    await page.waitForTimeout(500);
    const droneStep = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world;
      const d = w.sim.drones.find((x: any) => x.id === (window as any).__c1EnemyId);
      return d ? { id: d.id, x: d.x, y: d.y, hp: d.hp, state: d.data.state, tick: w.sim.tick } : null;
    });
    expect(droneStep, 'Enemy is backed by World.sim.drones').not.toBeNull();
    expect(droneStep.state).toBeTruthy();

    // Aim + real mouse fire: core projectile + swept hit + core drone HP.
    const aim = await gridToCss(page, setup.target.x, setup.target.y);
    await page.mouse.move(Math.round(aim.x), Math.round(aim.y));
    await page.mouse.down();
    let seenProjectile: any = null;
    for (let i = 0; i < 12 && !seenProjectile; i++) {
      await page.waitForTimeout(60);
      seenProjectile = await page.evaluate(() => {
        const g: any = (window as any).__game;
        const gs: any = g.scene.getScene('GameScene');
        const p = gs.world.sim.projectiles.find((x: any) => x.source === 'player');
        return p ? {
          damage: p.damage, crit: p.crit, vel: p.vel, lifetime: p.lifetime,
          radius: p.radius, pos: p.pos, source: p.source
        } : null;
      });
    }
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const fired = await page.evaluate(() => {
      const g: any = (window as any).__game;
      const gs: any = g.scene.getScene('GameScene');
      const w = gs.world, pl = w.player;
      const def = pl.weapon;
      const data = pl.data;
      const ws = data.weapons.find((x: any) => x.key === data.weaponKey);
      const drone = w.sim.drones.find((x: any) => x.id === (window as any).__c1EnemyId);
      const enemy = (window as any).__c1Enemy;
      return {
        weaponKey: data.weaponKey,
        expected: {
          damage: def.baseDamage * data.damage,
          speed: def.baseProjectileSpeed / 64,
          lifetime: def.baseRange / def.baseProjectileSpeed,
          critChance: data.critChance,
          critDamage: data.critDamage,
          pierce: data.pierceCount + (def.kind === 'plasma' ? 2 : 0),
          magazine: ws.magazine,
          shots: def.kind === 'scatter' ? 5 : 1,
          spread: def.baseSpread
        },
        drone: drone ? { id: drone.id, hp: drone.hp } : null,
        enemyHp: enemy ? enemy._hp : null,
        stillInWorld: w.enemies.some((x: any) => x._id === (window as any).__c1EnemyId),
        coreProjectiles: w.sim.projectiles.length,
        aimYaw: w.sim.player.aimYaw
      };
    });
    expect(fired.weaponKey, 'pulse is the C1 first slice').toBe('pulse');
    expect(seenProjectile, 'core produced a player projectile from real mouse fire').not.toBeNull();
    expect(seenProjectile.damage).toBeCloseTo(
      (seenProjectile.crit ? fired.expected.critDamage : 1) * fired.expected.damage, 6);
    expect(Math.hypot(seenProjectile.vel.x, seenProjectile.vel.y)).toBeCloseTo(fired.expected.speed, 6);
    expect(seenProjectile.lifetime).toBeCloseTo(fired.expected.lifetime, 6);
    expect(seenProjectile.radius).toBe(0.2);
    expect(fired.enemyHp, 'core drone HP dropped or drone died').toBeLessThan(setup.enemyHp);
    expect(fired.aimYaw, 'core aim follows the real pointer').toBeTruthy();
    record('c1-rendered', {
      weaponKey: fired.weaponKey, expected: fired.expected, projectile: seenProjectile,
      enemyHp: fired.enemyHp, stillInWorld: fired.stillInWorld,
      coreProjectiles: fired.coreProjectiles, moved, droneStep
    });
    await page.screenshot({ path: path.join(OUT, 'c1-rendered-rules-1280x720.png') });
'''
s=s[:start]+new+s[end:]
open(p,'w',encoding='utf-8').write(s)
print('c1 test rewritten for core state')
