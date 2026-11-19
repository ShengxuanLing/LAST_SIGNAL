# -*- coding: utf-8 -*-
from pathlib import Path
p = Path('src/entities/Boss.ts')
s = p.read_text(encoding='utf-8')

old = """<<<<<<< HEAD
import type { SimTarget } from '../world/sim/core';
import { toCombatPort, type ActorCombatPort, type ActorTargetView, type PlayerLikeCombat } from '../world/actorTarget';
=======
import { sectorFor } from '../config/dungeon';
>>>>>>> origin/feat/sector-dungeon
"""
new = """import type { SimTarget } from '../world/sim/core';
import { toCombatPort, type ActorCombatPort, type ActorTargetView, type PlayerLikeCombat } from '../world/actorTarget';
import { sectorFor } from '../config/dungeon';
"""
assert old in s
s = s.replace(old, new)

old = """  spawnRoom: number;
<<<<<<< HEAD

  get _hp(): number { return this.simTarget ? this.simTarget.hp : this.__hp; }
  get wx(): number { return this.simTarget ? this.simTarget.x : this._wx; }
  get wy(): number { return this.simTarget ? this.simTarget.y : this._wy; }

  constructor(public world: World, x: number, y: number, room: number, _depth: number) {
    this.spawnRoom = room;
    // AR-02 restyled 'enemy_hunter'; the Warden is outside the slice and keeps its
    // pre-AR-02 look under its own key until AR-04 designs the armillary Warden.
    this.sprite = this.world.scene.add.sprite(x, y, 'enemy_warden_legacy');
=======
  wx: number;
  wy: number;
  private readonly variant;

  constructor(public world: World, x: number, y: number, room: number, _depth: number) {
    this.spawnRoom = room;
    this.variant = world.map.deck === undefined ? undefined : sectorFor(world.map.deck).boss;
    this.sprite = this.world.scene.add.sprite(x, y, this.variant?.texture ?? 'enemy_hunter');
>>>>>>> origin/feat/sector-dungeon
"""
new = """  spawnRoom: number;
  private readonly variant;

  get _hp(): number { return this.simTarget ? this.simTarget.hp : this.__hp; }
  get wx(): number { return this.simTarget ? this.simTarget.x : this._wx; }
  get wy(): number { return this.simTarget ? this.simTarget.y : this._wy; }

  constructor(public world: World, x: number, y: number, room: number, _depth: number) {
    this.spawnRoom = room;
    this.variant = world.map.deck === undefined ? undefined : sectorFor(world.map.deck).boss;
    // AR-02 restyled 'enemy_hunter'; the Warden is outside the slice and keeps its
    // pre-AR-02 look under its own key until AR-04 designs the armillary Warden.
    this.sprite = this.world.scene.add.sprite(x, y, this.variant?.texture ?? 'enemy_warden_legacy');
"""
assert old in s
s = s.replace(old, new)

old = """<<<<<<< HEAD
    this._wx = x;
    this._wy = y;
    this.__hp = ENEMY_STATS.boss_warden.maxHp;
=======
    this.wx = x;
    this.wy = y;
    this._hp = this.maxHp();
>>>>>>> origin/feat/sector-dungeon
"""
new = """    this._wx = x;
    this._wy = y;
    this.__hp = this.maxHp();
"""
assert old in s
s = s.replace(old, new)

old = """<<<<<<< HEAD
  initHp(): void { this.__hp = this.maxHp(); }
=======
  private canMove(x: number, y: number): boolean {
    return this.world.canMoveInRoom(x, y, 0.5, this.spawnRoom);
  }

  initHp(): void { this._hp = this.maxHp(); }
>>>>>>> origin/feat/sector-dungeon
"""
new = """  private canMove(x: number, y: number): boolean {
    return this.world.canMoveInRoom(x, y, 0.5, this.spawnRoom);
  }

  initHp(): void { this.__hp = this.maxHp(); }
"""
assert old in s
s = s.replace(old, new)

s = s.replace("""<<<<<<< HEAD
      if (this.world.isWalkable(bx + vx * dt, by)) bx += vx * dt;
      if (this.world.isWalkable(bx, by + vy * dt)) by += vy * dt;
=======
      if (this.canMove(this.wx + vx * dt, this.wy)) this.wx += vx * dt;
      if (this.canMove(this.wx, this.wy + vy * dt)) this.wy += vy * dt;
>>>>>>> origin/feat/sector-dungeon
""", """      if (this.canMove(bx + vx * dt, by)) bx += vx * dt;
      if (this.canMove(bx, by + vy * dt)) by += vy * dt;
""")
s = s.replace("""<<<<<<< HEAD
      if (this.world.isWalkable(bx + vx * dt, by)) bx += vx * dt;
      if (this.world.isWalkable(bx, by + vy * dt)) by += vy * dt;
=======
      if (this.canMove(this.wx + vx * dt, this.wy)) this.wx += vx * dt;
      if (this.canMove(this.wx, this.wy + vy * dt)) this.wy += vy * dt;
>>>>>>> origin/feat/sector-dungeon
""", """      if (this.canMove(bx + vx * dt, by)) bx += vx * dt;
      if (this.canMove(bx, by + vy * dt)) by += vy * dt;
""")

old = """<<<<<<< HEAD
  private doAttack(combat: ActorCombatPort | PlayerLikeCombat, d: number): void {
    const port = toCombatPort(combat);
    const player = port.target;
=======
  private doAttack(player: PlayerLike, d: number): void {
    if (this.variant) {
      const { pattern } = this.variant;
      if (pattern === 'ring' || (pattern === 'mixed' && this.phase > 1)) this.shockwave();
      if (pattern !== 'ring' || this.phase > 1) this.fireLaser(player);
      if (this.phase > 1 && this.stateTimer <= 0) {
        this.summonDrones();
        this.stateTimer = 9;
      }
      this.attackTimer = 2 - this.phase * 0.35;
      return;
    }
>>>>>>> origin/feat/sector-dungeon
"""
new = """  private doAttack(combat: ActorCombatPort | PlayerLikeCombat, d: number): void {
    const port = toCombatPort(combat);
    const player = port.target;
    if (this.variant) {
      const { pattern } = this.variant;
      if (pattern === 'ring' || (pattern === 'mixed' && this.phase > 1)) this.shockwave();
      if (pattern !== 'ring' || this.phase > 1) this.fireLaser(player);
      if (this.phase > 1 && this.stateTimer <= 0) {
        this.summonDrones();
        this.stateTimer = 9;
      }
      this.attackTimer = 2 - this.phase * 0.35;
      return;
    }
"""
assert old in s
s = s.replace(old, new)

old = """<<<<<<< HEAD
      if (this.world.isWalkable(ex, ey)) this.world.enqueueSpawnEnemy('drone', ex, ey, this.spawnRoom, 3);
=======
      if (this.canMove(ex, ey)) {
        const e = this.world.spawnEnemy(this.variant?.summon ?? 'drone', ex, ey, this.spawnRoom, 3);
        e._id = this._id + 100 + i;
      }
>>>>>>> origin/feat/sector-dungeon
"""
new = """      if (this.canMove(ex, ey)) {
        this.world.enqueueSpawnEnemy(this.variant?.summon ?? 'drone', ex, ey, this.spawnRoom, 3);
      }
"""
assert old in s
s = s.replace(old, new)
p.write_text(s, encoding='utf-8')
print('Boss patched')
