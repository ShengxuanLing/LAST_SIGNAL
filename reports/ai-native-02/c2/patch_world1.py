import io
p='src/world/World.ts'
s=open(p,encoding='utf-8').read()

def rep(old,new):
    global s
    assert old in s, 'MISSING: '+old[:80]
    s=s.replace(old,new,1)

rep("""import {
  advanceProjectile, createProjectileData, projectileHitsTarget,
  type WeaponFireSpec
} from './sim/rules';""","""import { advanceProjectile, projectileHitsTarget } from './sim/rules';
import {
  createSimulationState, registerDrone, stepSimulationTicks, SIM_TUNING,
  type SimulationIntent, type SimulationState, type SimEvent, type SimProjectile
} from './sim/core';""")

rep("""  projectiles: Array<{ spr: Phaser.GameObjects.Sprite; data: ProjectileData }> = [];
  /** C1 evidence: first projectile produced by the single pure builder. */
  lastProjectileData: ProjectileData | null = null;""","""  projectiles: Array<{ spr: Phaser.GameObjects.Sprite; data: ProjectileData }> = [];
  /** C1/C2 evidence: first core projectile produced by the single pure builder. */
  lastProjectileData: SimProjectile | null = null;
  /** C2: first-slice authority for player/drone/core projectiles. */
  sim!: SimulationState;
  private simAccumulatorMs = 0;
  private coreProjectileSprites = new Map<number, Phaser.GameObjects.Sprite>();""")

rep("""    const spawn = this.findSpawn();
    this.player = new Player(this, spawn.x, spawn.y, save);
    this.player.id = 0;
    const kb = scene.input.keyboard;""","""    const spawn = this.findSpawn();
    this.player = new Player(this, spawn.x, spawn.y, save);
    this.player.id = 0;
    // C2: create the single first-slice authority. Player.data is the same
    // object reference; Player getters/setters read and write this state.
    this.sim = createSimulationState({
      seed: map.seed,
      map,
      playerData: this.player.data,
      playerX: this.player.wx,
      playerY: this.player.wy
    });
    const kb = scene.input.keyboard;""")

rep("""  spawnEnemy(kind: EnemyKind, x: number, y: number, room: number, depth: number): Enemy {
    const e = new Enemy(this, kind, x, y, room, depth);
    e._id = this.enemyIdCounter++;
    e.initHp();
    this.enemies.push(e);
    return e;
  }""","""  spawnEnemy(kind: EnemyKind, x: number, y: number, room: number, depth: number): Enemy {
    const e = new Enemy(this, kind, x, y, room, depth);
    e._id = this.enemyIdCounter++;
    e.initHp();
    this.enemies.push(e);
    if (kind === 'drone') {
      const drone = registerDrone(this.sim, {
        id: e._id, x: e.x, y: e.y, hp: e._hp, data: e.data,
        attackTimer: e.attackTimer, wanderTimer: e.wanderTimer
      });
      e.attachSimDrone(drone);
    }
    return e;
  }""")

start=s.index("  spawnProjectile(ownerId: number")
end=s.index("  spawnEnemyProjectile(ownerId: number")
s=s[:start]+s[end:]

rep("""  reset(): void {
    for (const e of this.enemies) e.sprite.destroy();
    this.enemies = [];
    for (const p of this.projectiles) p.spr.destroy();
    this.projectiles = [];
    for (const l of this.loot) l.spr.destroy();
    this.loot = [];
    this.boss = null;
  }""","""  reset(): void {
    for (const e of this.enemies) e.sprite.destroy();
    this.enemies = [];
    for (const p of this.projectiles) p.spr.destroy();
    this.projectiles = [];
    for (const spr of this.coreProjectileSprites.values()) if (spr.scene) spr.destroy();
    this.coreProjectileSprites.clear();
    this.sim.drones = [];
    this.sim.projectiles = [];
    for (const l of this.loot) l.spr.destroy();
    this.loot = [];
    this.boss = null;
  }""")

rep("""    this.player.data = run.player;
    // Capture the checkpoint's HP *before* reset(): reset() heals to full, but a
    // resumed run must keep exactly the HP it had when the checkpoint was saved.
    const restoredHp = this.player.data.hp;""","""    // F-08: deep copy the incoming frame before assigning it to the live state.
    const frame = cloneCheckpoint(run);
    this.player.data = frame.player;
    // Capture the checkpoint's HP *before* reset(): reset() heals to full, but a
    // resumed run must keep exactly the HP it had when the checkpoint was saved.
    const restoredHp = this.player.data.hp;""")

rep("""    this.currentRoomId = room.id;
    this.placePortal(room, run.portalTarget);
    this.rng.restore(run.rngState);""","""    this.currentRoomId = room.id;
    this.placePortal(room, run.portalTarget);
    this.rng.restore(run.rngState);
    this.sim.tick = 0;
    this.sim.drones = [];
    this.sim.projectiles = [];
    for (const spr of this.coreProjectileSprites.values()) if (spr.scene) spr.destroy();
    this.coreProjectileSprites.clear();""")

open(p,'w',encoding='utf-8').write(s)
print('world part1 written')
