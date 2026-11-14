import Phaser from 'phaser';
import { MapData, Tile, Vec2, LootDrop, HitFx, EnemyStateName, Room } from '../types';
import { ENEMY_STATS, EnemyKind } from '../config/enemies';
import { GAME } from '../config/game';
import { ItemKind } from '../types';
import { IsoMath, isoToScreen, screenToIso } from '../core/iso';
import { RNG } from '../core/random';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Boss } from '../entities/Boss';
import { RoomDepth } from '../world/roomdepth';
import { WorldRenderer } from '../world/WorldRenderer';
import type { RunCheckpoint, SaveData } from '../types';
import { audio } from '../systems/AudioSystem';
import type { ControllerActorView, LocalControllerView } from '../ai-native/localController';
import { buildWorldObservation, type WorldObservationV1 } from '../ai-native/worldObservation';
import { WORLD_PERCEPTION, createLocalProbe, gridLineOfSight } from '../ai-native/worldPerception';
import { cloneCheckpoint } from '../systems/RunCheckpoint';
import {
  addCurrency as addCoreCurrency, addPlayerXp as addCorePlayerXp, createSimulationState,
  applyUpgradeToPlayer as applyCoreUpgrade, enqueueCommand, enqueuePlayerHit,
  enqueueTargetHp as enqueueCoreTargetHp, enqueueTargetMove as enqueueCoreTargetMove,
  healPlayer as healCorePlayer, registerDrone, registerTarget,
  spawnEnemyProjectile as spawnCoreEnemyProjectile, stepSimulationTicks, SIM_TUNING,
  type SimulationIntent, type SimulationState, type SimEvent, type SimProjectile, type SimTarget
} from './sim/core';

export interface WorldCallbacks {
  onLevelUp: (level: number) => void;
  onDeath: () => void;
  onRoomCleared: (room: RoomInfo) => void;
  onRoomEntered: (room: RoomInfo) => void;
  onLoot: (drop: LootDrop) => void;
  onStats: (delta: { enemies: number; items: number; dmg: number }) => void;
  onBossWin: () => void;
}

export interface RoomInfo {
  id: number; kind: string; gx: number; gy: number; w: number; h: number;
}

export class World {
  scene: Phaser.Scene;
  map: MapData;
  player: Player;
  enemies: Enemy[] = [];
  /** C2: first-slice authority for player/drone/core projectiles. */
  sim!: SimulationState;
  private simAccumulatorMs = 0;
  private coreProjectileViews = new Map<number, { spr: Phaser.GameObjects.Sprite; data: SimProjectile }>();

  /**
   * Read-only compatibility view for old regressions. It returns fresh copies of
   * core projectile data; callers cannot mutate authoritative projectiles.
   * The setter is intentionally non-authoritative (legacy test cleanup only);
   * use resetProjectilesForTest() for an explicit dev reset.
   */
  get projectiles(): Array<{ spr: Phaser.GameObjects.Sprite; data: any }> {
    return [...this.coreProjectileViews.values()].map((view) => ({
      spr: view.spr,
      data: {
        ...view.data, pos: { ...view.data.pos }, vel: { ...view.data.vel },
        hitIds: [...view.data.hitIds], hitSet: new Set(view.data.hitIds)
      }
    }));
  }
  set projectiles(_value: Array<{ spr: Phaser.GameObjects.Sprite; data: any }>) {
    // Compatibility setter must not clear or expose authoritative core state.
  }

  private static assertDevTest(): void {
    const env = (import.meta as any).env ?? {};
    if (!(env.DEV === true || env.MODE === 'test')) throw new Error('dev/test only');
  }

  /** Explicit dev/test reset; not a general scene API. */
  resetProjectilesForTest(): void {
    World.assertDevTest();
    for (const view of this.coreProjectileViews.values()) if (view.spr.scene) view.spr.destroy();
    this.coreProjectileViews.clear();
    if (this.sim) this.sim.projectiles = [];
  }

  /** Explicit dev/test enemy cleanup; keeps adapter and core in sync. */
  clearEnemiesForTest(): void {
    World.assertDevTest();
    for (const e of this.enemies) if (e.sprite.scene) e.sprite.destroy();
    this.enemies = [];
    if (this.sim) {
      this.sim.drones = [];
      this.sim.targets = [];
    }
    if (this.boss) {
      if (this.boss.sprite.scene) this.boss.sprite.destroy();
      this.boss = null;
    }
  }
  loot: Array<{ spr: Phaser.GameObjects.Sprite; data: LootDrop }> = [];
  fx: HitFx[] = [];
  private damageTexts: Phaser.GameObjects.Text[] = [];
  private fxGraphics: Phaser.GameObjects.Graphics;
  shakeAmount = 0;
  clock = 0;

  private roomDepth = new RoomDepth();
  private callbacks: WorldCallbacks;
  private rng: RNG;
  private enemyIdCounter = 1;
  private roomClearedHandlers: Array<(r: RoomInfo) => void> = [];
  private currentRoomId = -1;
  private enteredRooms = new Set<number>();
  public renderer: WorldRenderer | null = null;
  private _minX = 0;
  private _minY = 0;
  private _maxX = 0;
  private _maxY = 0;
  private portal: { spr: Phaser.GameObjects.Sprite; targetRoom: number; wx: number; wy: number } | null = null;

  constructor(scene: Phaser.Scene, map: MapData, save: SaveData, callbacks: WorldCallbacks) {
    this.scene = scene;
    this.map = map;
    this.callbacks = callbacks;
    this.rng = new RNG(map.seed * 7919 + 1);
    this.roomDepth.build(map);
    this._computeBounds();
    // Build the renderer first: Player/Enemy/Boss project() in their constructors and
    // need the renderer's offset to place their sprites on the first frame.
    this.renderer = new WorldRenderer(scene, map);
    const spawn = this.findSpawn();
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
    const kb = scene.input.keyboard;
    if (kb) {
      // Register keys by their code name (e.g. 'D') so the KeyboardPlugin stores them
      // under the numeric keyCode (`keys[KeyCodes[code]]`, e.g. keys[68]). Its `update()`
      // handler resolves keys via `event.keyCode`, which Chrome still emits (68 for 'd').
      const keyW = (kb as any).addKey || (kb as any).createKey;
      const keys = {
        W: keyW.call(kb, 'W'),
        A: keyW.call(kb, 'A'),
        S: keyW.call(kb, 'S'),
        D: keyW.call(kb, 'D'),
      };
      const cursors = { space: keyW.call(kb, 'SPACE') };
      this.player.registerInput(keys, cursors);
    }
    this.fxGraphics = this.scene.add.graphics();
    this.fxGraphics.setDepth(400);
  }

  id(): number { return this.enemyIdCounter++; }

  private findSpawn(): Vec2 {
    for (let gy = 0; gy < this.map.tiles.length; gy++) {
      for (let gx = 0; gx < this.map.tiles[gy].length; gx++) {
        if (this.map.tiles[gy][gx].type === 'spawn') {
          return { x: this.map.tiles[gy][gx].x, y: this.map.tiles[gy][gx].y };
        }
      }
    }
    return { x: this.map.tiles[0][0].x, y: this.map.tiles[0][0].y };
  }

  /** Project a world-grid coordinate to screen space using the renderer's map offset. */
  worldToScreen(x: number, y: number): Vec2 {
    const off = this.renderer ? { x: this.renderer._offX, y: this.renderer._offY } : { x: 0, y: 0 };
    const iso = isoToScreen(x, y);
    return { x: iso.x + off.x, y: iso.y + off.y };
  }

  /** Inverse of worldToScreen: a display-space point back to a world-grid coordinate. */
  screenToWorld(sx: number, sy: number): Vec2 {
    const offX = this.renderer ? this.renderer._offX : 0;
    const offY = this.renderer ? this.renderer._offY : 0;
    return screenToIso(sx - offX, sy - offY);
  }

  // ---------- Collision ----------

  private _computeBounds(): void {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const tiles = this.map.tiles;
    for (let gy = 0; gy < tiles.length; gy++) {
      for (let gx = 0; gx < tiles[gy].length; gx++) {
        const t = tiles[gy][gx];
        minX = Math.min(minX, t.x); minY = Math.min(minY, t.y);
        maxX = Math.max(maxX, t.x); maxY = Math.max(maxY, t.y);
      }
    }
    this._minX = minX; this._minY = minY; this._maxX = maxX; this._maxY = maxY;
  }

  tileAt(worldX: number, worldY: number): Tile {
    // tiles[] is indexed [gy][gx] where the tile at that cell has world coord
    // (minX + gx, minY + gy). So map the absolute world coord back to an index by
    // subtracting the offset first.
    const gx = Math.floor(worldX) - this._minX;
    const gy = Math.floor(worldY) - this._minY;
    if (gy < 0 || gy >= this.map.tiles.length) return { x: gx, y: gy, type: 'wall', height: 0 };
    const row = this.map.tiles[gy];
    if (!row) return { x: gx, y: gy, type: 'wall', height: 0 };
    if (gx < 0 || gx >= row.length) return { x: gx, y: gy, type: 'wall', height: 0 };
    return row[gx];
  }

  isWalkable(worldX: number, worldY: number, radius = 0.5): boolean {
    // sample the four corners of the entity's bounding circle-ish square
    const samples = [
      { x: worldX - radius, y: worldY - radius },
      { x: worldX + radius, y: worldY - radius },
      { x: worldX - radius, y: worldY + radius },
      { x: worldX + radius, y: worldY + radius }
    ];
    for (const s of samples) {
      const t = this.tileAt(s.x, s.y);
      if (t.type === 'wall' || t.type === 'lava' || t.type === 'water') return false;
    }
    return true;
  }

  // ---------- Room tracking ----------

  /**
   * Read-only adapter for the local deterministic controller (AI-NATIVE-02 P1).
   * It exposes only a bounded perception projection: own state, perceived
   * actors / boss / portal, and a short-range local walkability probe. It has no
   * setters and no full-map collision oracle; a controller can never write
   * coordinates or HP, only return a PlayerIntent for Player.applyIntent().
   */
  intentView(): LocalControllerView {
    const observation = this.observationView();
    const enemies: ControllerActorView[] = observation.perceivedActors.map((actor) => ({
      id: actor.id, kind: actor.kind, x: actor.x, y: actor.y, alive: actor.alive
    }));
    const boss: ControllerActorView | null = observation.boss
      ? { id: observation.boss.id, kind: 'boss_warden', x: observation.boss.x, y: observation.boss.y, alive: true }
      : null;
    const center = { x: observation.player.x, y: observation.player.y };
    return {
      ready: observation.player.alive && !this.player.control.paused,
      player: { x: center.x, y: center.y, alive: observation.player.alive },
      roomId: observation.roomId,
      enemies,
      boss,
      portal: observation.portal ? { x: observation.portal.x, y: observation.portal.y } : null,
      // F-01: bounded local probe. Far / non-finite / unexplored queries are
      // uniformly rejected and never reach the real terrain predicate.
      canWalk: createLocalProbe({
        center,
        probeRadiusTiles: WORLD_PERCEPTION.probeRadiusTiles,
        isExplored: (x, y) => this.isExploredCell(x, y),
        isWalkable: (x, y) => this.isWalkable(x, y, 0.5)
      }),
      timeSeconds: this.clock
    };
  }

  /** Room id containing a grid point, or null when outside all room bounds. */
  private roomIdAt(x: number, y: number): number | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    for (const r of this.map.rooms) {
      if (x >= r.gx && x < r.gx + r.w && y >= r.gy && y < r.gy + r.h) return r.id;
    }
    return null;
  }

  /** Only rooms the player has actually entered count as known territory. */
  private isExploredCell(x: number, y: number): boolean {
    const id = this.roomIdAt(x, y);
    return id !== null && this.enteredRooms.has(id);
  }

  /** Wall cells occlude sight. Lava/water block movement, not sight. */
  private isOpaqueCell(x: number, y: number): boolean {
    return this.tileAt(Math.floor(x), Math.floor(y)).type === 'wall';
  }

  /** F-02: grid-only perception, no camera, viewport or spawn-room shortcut. */
  private isPerceivable(x: number, y: number): boolean {
    return gridLineOfSight({ x, y }, {
      center: { x: this.player.x, y: this.player.y },
      radiusTiles: WORLD_PERCEPTION.radiusTiles,
      isExplored: (sx, sy) => this.isExploredCell(sx, sy),
      isOpaque: (sx, sy) => this.isOpaqueCell(sx, sy),
      stepTiles: WORLD_PERCEPTION.losStepTiles
    });
  }

  /**
   * Legal read-only projection for AI adapters (see ai-native/worldObservation).
   * Actors, boss and portal are included only when they satisfy the bounded
   * grid radius + explored-room + LOS predicate. Portal destination, Boss phase,
   * seed / RNG / full map never leave the World here.
   */
  observationView(): WorldObservationV1 {
    const room = this.currentRoom();
    return buildWorldObservation({
      player: {
        x: this.player.x, y: this.player.y, alive: this.player.alive,
        hp: this.player.data.hp, maxHp: this.player.data.maxHp
      },
      roomId: room?.id ?? null,
      enemies: this.enemies.map((enemy) => ({
        id: enemy._id, kind: enemy.data.kind, x: enemy.x, y: enemy.y,
        alive: enemy.alive, roomId: enemy.data.spawnRoom
      })),
      boss: this.boss
        ? {
            id: this.boss._id, x: this.boss.x, y: this.boss.y, alive: this.boss.alive,
            hp: this.boss._hp, maxHp: this.boss.maxHp(), roomId: this.boss.spawnRoom
          }
        : null,
      portal: this.portal
        ? { x: this.portal.wx, y: this.portal.wy, targetRoom: this.portal.targetRoom }
        : null,
      perception: {
        basis: 'grid-radius+explored+line-of-sight',
        center: { x: this.player.x, y: this.player.y },
        radiusTiles: WORLD_PERCEPTION.radiusTiles,
        probeRadiusTiles: WORLD_PERCEPTION.probeRadiusTiles,
        requiresExplored: true,
        requiresLineOfSight: true
      },
      isPerceivable: (x, y) => this.isPerceivable(x, y)
    });
  }

  currentRoom(): RoomInfo | null {
    const px = this.player.x, py = this.player.y;
    for (const r of this.map.rooms) {
      if (px >= r.gx && px < r.gx + r.w && py >= r.gy && py < r.gy + r.h) {
        return { id: r.id, kind: r.kind, gx: r.gx, gy: r.gy, w: r.w, h: r.h };
      }
    }
    return null;
  }

  updateRoom(): void {
    const room = this.currentRoom();
    if (!room) return;
    if (room.id !== this.currentRoomId) {
      this.currentRoomId = room.id;
      this.onEnterRoom(room);
    }
    // clear when all enemies in room dead
    const inRoom = this.enemies.filter((e) => e.data.spawnRoom === room.id && e.alive);
    const r = this.map.rooms[room.id];
    if (r.spawned && inRoom.length === 0 && !r.cleared) {
      r.cleared = true;
      this.callbacks.onRoomCleared(room);
    }
  }

  private onEnterRoom(room: RoomInfo): void {
    const r = this.map.rooms[room.id];
    this.enteredRooms.add(room.id);
    if (!r.spawned) {
      if (r.kind === 'boss') this.spawnBoss(r);
      else this.spawnForRoom(r);
      if (r.kind === 'resource' || r.kind === 'shop') this.spawnResourceLoot(r);
      this.callbacks.onRoomEntered(room);
    }
    this.placePortal(r);
  }

  private placePortal(r: Room, savedTarget?: number | null): void {
    // Prefer the first step toward any unvisited room. If every room is already
    // visited, allow backtracking instead of destroying the portal and soft-locking
    // the run in a leaf room.
    let target = savedTarget ?? this.nextRoomTowardUnvisited(r.id);
    if (target === null) {
      const neighbors = r.connectedTo.filter((n) => n !== r.id);
      if (neighbors.length === 0) {
        if (this.portal) this.portal.spr.destroy();
        this.portal = null;
        return;
      }
      target = this.rng.pick(neighbors);
    }
    const tr = this.map.rooms[target];
    const targetCenter = { x: tr.gx + tr.w / 2, y: tr.gy + tr.h / 2 };

    // Place the portal on a walkable tile INSIDE the current room, nearest to the
    // target room. The old code searched around the midpoint between room centres
    // with `isWalkable(..., 8)`, which requires a 16x16 open square and therefore
    // almost never matches; the portal then stayed at a wall/void midpoint.
    let best = {
      x: r.gx + Math.floor(r.w / 2),
      y: r.gy + Math.floor(r.h / 2)
    };
    let bestD = Infinity;
    for (const row of this.map.tiles) {
      for (const tile of row) {
        if (tile.x < r.gx || tile.x >= r.gx + r.w) continue;
        if (tile.y < r.gy || tile.y >= r.gy + r.h) continue;
        if (!this.isWalkable(tile.x, tile.y, 0.5)) continue;
        const dd = (tile.x - targetCenter.x) ** 2 + (tile.y - targetCenter.y) ** 2;
        if (dd < bestD) { bestD = dd; best = { x: tile.x, y: tile.y }; }
      }
    }

    if (this.portal) { this.portal.spr.destroy(); this.portal = null; }
    const s = this.worldToScreen(best.x, best.y);
    const spr = this.scene.add.sprite(s.x, s.y, 'icon_pause');
    spr.setDepth(60);
    spr.setScale(0.8);
    this.scene.add.tween({ targets: spr, alpha: { from: 0.4, to: 1 }, duration: 900, yoyo: true, repeat: -1 });
    this.portal = { spr, targetRoom: target, wx: best.x, wy: best.y };
  }

  /** First adjacent room on the shortest room-graph path to an unvisited room. */
  private nextRoomTowardUnvisited(startId: number): number | null {
    const parent = new Map<number, number | null>();
    const queue = [startId];
    parent.set(startId, null);
    let goal: number | null = null;
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur !== startId && !this.enteredRooms.has(cur)) { goal = cur; break; }
      for (const nb of this.map.rooms[cur].connectedTo) {
        if (!parent.has(nb)) { parent.set(nb, cur); queue.push(nb); }
      }
    }
    if (goal === null) return null;
    let step = goal;
    while (parent.get(step) !== startId) {
      const prev = parent.get(step);
      if (prev === null || prev === undefined) return null;
      step = prev;
    }
    return step;
  }

  /**
   * A walkable landing spot inside a room, closest to its geometric centre.
   * MapGenerator.assignRoles() can enlarge a room (boss room -> 13x11) after the
   * tiles were carved, so r.gx+r.w/2 / r.gy+r.h/2 may sit in a wall/void.
   * Only tiles whose radius-0.5 footprint is clear qualify (same predicate as
   * placePortal); integer grid coords are returned so Player/Boss collision
   * checks sample the same tiles we validated here.
   */
  private findWalkableInRoom(r: Room): Vec2 {
    const cx = r.gx + r.w / 2, cy = r.gy + r.h / 2;
    let best: Vec2 = { x: r.gx + Math.floor(r.w / 2), y: r.gy + Math.floor(r.h / 2) };
    let bestD = Infinity;
    for (const row of this.map.tiles) {
      for (const tile of row) {
        if (tile.x < r.gx || tile.x >= r.gx + r.w) continue;
        if (tile.y < r.gy || tile.y >= r.gy + r.h) continue;
        if (!this.isWalkable(tile.x, tile.y, 0.5)) continue;
        const dd = (tile.x - cx) ** 2 + (tile.y - cy) ** 2;
        if (dd < bestD) { bestD = dd; best = { x: tile.x, y: tile.y }; }
      }
    }
    return best;
  }

  /** Boss spawn near the room centre, but never on top of the player. */
  private findBossSpawnInRoom(r: Room): Vec2 {
    const center = this.findWalkableInRoom(r);
    const px = this.player.wx, py = this.player.wy;
    let best = center;
    let bestCenterD = Infinity;
    for (const row of this.map.tiles) {
      for (const tile of row) {
        if (tile.x < r.gx || tile.x >= r.gx + r.w) continue;
        if (tile.y < r.gy || tile.y >= r.gy + r.h) continue;
        if (!this.isWalkable(tile.x, tile.y, 0.5)) continue;
        if (Math.hypot(tile.x - px, tile.y - py) < 3) continue;
        const centerD = (tile.x - center.x) ** 2 + (tile.y - center.y) ** 2;
        if (centerD < bestCenterD) { bestCenterD = centerD; best = { x: tile.x, y: tile.y }; }
      }
    }
    return best;
  }

  tryInteract(player: Player): void {
    if (!this.portal) return;
    const dx = player.x - this.portal.wx, dy = player.y - this.portal.wy;
    if (Math.hypot(dx, dy) < 2.0) {
      const target = this.map.rooms[this.portal.targetRoom];
      const landing = this.findWalkableInRoom(target);
      this.currentRoomId = -1;
      this.enteredRooms.delete(this.portal.targetRoom);
      this.portal.spr.destroy();
      this.portal = null;
      player.reset(landing.x, landing.y);
      audio.wave();
    }
  }

  private spawnForRoom(r: Room): void {
    if (r.kind === 'start') { r.spawned = true; return; }
    const depth = this.roomDepth.of(r.id);
    const count = r.kind === 'elite' ? 4 + depth : r.kind === 'shop' ? 1 : 2 + depth;
    r.spawned = true;
    // spawn away from player within room
    for (let i = 0; i < count; i++) {
      const ex = r.gx + 3 + (i % 3) * (r.w - 6) / 3;
      const ey = r.gy + 3 + Math.floor(i / 3) * (r.h - 6);
      const kind = this.pickEnemyForRoom(r, depth);
      this.spawnEnemy(kind, ex, ey, r.id, depth);
    }
  }

  private pickEnemyForRoom(r: Room, depth: number): EnemyKind {
    const pool: EnemyKind[] = [];
    if (r.kind === 'elite') pool.push('sentinel', 'hunter', 'stalker', 'drone');
    else {
      const roll = (r.id * 53 + depth * 11) % 4;
      const all: EnemyKind[] = ['drone', 'stalker', 'hunter', 'sentinel'];
      pool.push(all[roll], all[(roll + 1) % 4]);
    }
    return this.rng.pick(pool);
  }

  private spawnResourceLoot(r: Room): void {
    const n = r.kind === 'shop' ? 3 : 2 + (this.roomDepth.of(r.id) % 3);
    for (let i = 0; i < n; i++) {
      const x = r.gx + 2 + (i + 1) * 2;
      const y = r.gy + 2 + (i % 2) * 2;
      const kind = this.rng.int(0, 1) === 0 ? 'currency' : 'health';
      this.spawnLoot(x, y, kind, kind, kind === 'currency' ? 10 : 0);
    }
  }

  // ---------- Spawning ----------

  spawnEnemy(kind: EnemyKind, x: number, y: number, room: number, depth: number): Enemy {
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
    } else {
      const target = registerTarget(this.sim, {
        id: e._id, kind, x: e.x, y: e.y, hp: e._hp, maxHp: e.data.stats.maxHp,
        armor: e.data.stats.armor, radius: e.getRadius(), isBoss: false,
        xpValue: e.data.stats.xpValue, currencyValue: e.data.stats.currencyValue
      });
      e.attachSimTarget(target);
    }
    return e;
  }

  spawnBoss(r: Room): void {
    const depth = this.roomDepth.of(r.id);
    const landing = this.findBossSpawnInRoom(r);
    this.boss = new Boss(this, landing.x, landing.y, r.id, depth);
    this.boss._id = this.enemyIdCounter++;
    this.boss.initHp();
    const target = registerTarget(this.sim, {
      id: this.boss._id, kind: 'boss_warden', x: this.boss.x, y: this.boss.y,
      hp: this.boss._hp, maxHp: this.boss.maxHp(),
      armor: ENEMY_STATS.boss_warden.armor, radius: this.boss.getRadius() + 1, isBoss: true,
      xpValue: ENEMY_STATS.boss_warden.xpValue, currencyValue: ENEMY_STATS.boss_warden.currencyValue
    });
    this.boss.attachSimTarget(target);
  }

  boss: Boss | null = null;

  /** Legal adapter commands: committed by the next core tick, never written live. */
  enqueueTargetMove(targetId: number, x: number, y: number): void {
    enqueueCoreTargetMove(this.sim, targetId, x, y);
  }

  enqueueTargetHp(targetId: number, hp: number): void {
    enqueueCoreTargetHp(this.sim, targetId, hp);
  }

  enqueueHeal(amount: number): void {
    enqueueCommand(this.sim, { type: 'heal-player', amount });
  }

  enqueueCurrency(amount: number): void {
    enqueueCommand(this.sim, { type: 'add-currency', amount });
  }

  /** Core-owned XP transaction used by legacy/test callers; emits level callbacks. */
  addPlayerXp(base: number): number {
    const { gained, levels } = addCorePlayerXp(this.sim, base);
    for (const level of levels) this.onLevelUp(level);
    return gained;
  }

  /** Core-owned immediate heal transaction for non-tick adapter callers. */
  healPlayer(amount: number): number {
    return healCorePlayer(this.sim, amount);
  }

  /** Core-owned immediate currency transaction for non-tick adapter callers. */
  addCurrency(amount: number): number {
    return addCoreCurrency(this.sim, amount);
  }

  /** Core-owned upgrade transaction; the level-up UI must call this, not mutate data. */
  applyUpgradeChoice(key: string, level: number): boolean {
    return applyCoreUpgrade(this.sim, key, level);
  }

  spawnEnemyProjectile(ownerId: number, x: number, y: number, damage: number, vel: Vec2 = { x: 0, y: 0 }): SimProjectile {
    const projectile = spawnCoreEnemyProjectile(this.sim, ownerId, x, y, damage, vel);
    // Expose the new core entry to legacy presentation callers immediately; the
    // next stepFrame keeps its position in sync. No gameplay rule is duplicated.
    this.syncCoreEntities(0);
    return projectile;
  }

  /** Explicit sprite cleanup helper used by compatibility tests. */
  private destroyProjectileSprite(p: { spr: Phaser.GameObjects.Sprite }): void {
    if (p.spr && p.spr.scene) p.spr.destroy();
  }

  private projSprite(kind: any, enemy: boolean): string {
    if (enemy) return 'proj_enemy';
    const map: Record<string, string> = { pulse: 'proj_pulse', scatter: 'proj_pulse', plasma: 'proj_plasma', arc: 'proj_pulse' };
    return map[kind] ?? 'proj_pulse';
  }

  spawnLoot(x: number, y: number, kind: ItemKind, key: string, amount: number, bob = Math.random() * Math.PI * 2): void {
    const drop: LootDrop = { x, y, kind, key, amount, bob };
    const color = kind === 'health' ? 0xff3355 : kind === 'currency' ? 0xffd233 : 0x33e0ff;
    const s = this.worldToScreen(x, y);
    const spr = this.scene.add.sprite(s.x, s.y, 'icon_' + (kind === 'currency' ? 'currency' : kind === 'health' ? 'health' : 'upgrade'));
    spr.setDepth(70);
    this.loot.push({ spr, data: drop });
  }

  // ---------- FX ----------

  addShake(mag: number): void {
    this.shakeAmount = Math.min(18, this.shakeAmount + mag);
  }

  /** Takes world-grid coordinates; the text object is placed in display space. */
  addDamageNumber(x: number, y: number, amount: number, crit: boolean): void {
    const s = this.worldToScreen(x, y);
    const t = this.scene.add.text(s.x, s.y - 20, Math.round(amount).toString(), {
      fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold',
      color: crit ? '#ffd233' : '#ffb060', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5, 0.5).setDepth(400);
    t.setAlpha(1);
    this.scene.tweens.add({ targets: t, y: s.y - 44, alpha: 0, duration: 800, onComplete: () => t.destroy() });
    this.damageTexts.push(t);
  }

  /** Takes world-grid coordinates; fx are drawn directly in display space by updateFx(). */
  addHitFx(x: number, y: number, color: number): void {
    const s = this.worldToScreen(x, y);
    this.fx.push({ x: s.x, y: s.y, color, life: 0.3, vy: 0 });
  }

  // ---------- Update ----------

  /** C2: fixed 60Hz core ticks; render frame delta is only an accumulator input. */
  stepFrame(frameDeltaMs: number, intent: SimulationIntent): SimEvent[] {
    const delta = Math.max(0, Math.min(frameDeltaMs, SIM_TUNING.MAX_FRAME_DELTA_MS));
    this.simAccumulatorMs += delta;
    // Epsilon: 250ms must yield exactly 15 ticks despite binary rounding.
    let ticks = Math.floor((this.simAccumulatorMs + 1e-9) / SIM_TUNING.TICK_MS);
    if (ticks > SIM_TUNING.MAX_TICKS_PER_FRAME) {
      ticks = SIM_TUNING.MAX_TICKS_PER_FRAME;
      // Drop the excess instead of catching up on later frames.
      this.simAccumulatorMs = Math.max(0, this.simAccumulatorMs % SIM_TUNING.TICK_MS);
    } else {
      this.simAccumulatorMs = Math.max(0, this.simAccumulatorMs - ticks * SIM_TUNING.TICK_MS);
    }
    let events: SimEvent[] = [];
    if (ticks > 0) {
      events = stepSimulationTicks(this.sim, ticks, intent);
      this.applySimEvents(events);
    }
    this.syncCoreEntities(delta / 1000);
    this.updateLegacy(delta / 1000);
    return events;
  }

  resetSimulationAccumulator(): void { this.simAccumulatorMs = 0; }

  /** Legacy melee/attack adapter: queue a player hit; core commits it next tick. */
  enqueuePlayerHit(damage: number, fromX: number, fromY: number): void {
    enqueuePlayerHit(this.sim, damage, fromX, fromY);
  }

  /**
   * Strict dev/test-only diagnostic facade. It must NOT be used as official
   * Node/Rendered parity evidence (parity drives stepFrame/accumulator).
   */
  stepSimulationTicksForTest(ticks: number, intent: SimulationIntent): SimEvent[] {
    const env = (import.meta as any).env ?? {};
    if (!(env.DEV === true || env.MODE === 'test')) throw new Error('dev/test only');
    const events = stepSimulationTicks(this.sim, Math.max(0, Math.floor(ticks)), intent);
    this.applySimEvents(events);
    this.syncCoreEntities(0);
    return events;
  }

  private applySimEvents(events: SimEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'player-moved':
          if (event.dashStarted) { this.addShake(4); audio.ui(); }
          break;
        case 'player-fired':
          this.player.playFireFeedback(event.spec.kind);
          break;
        case 'drone-step': {
          const enemy = this.enemies.find((e) => e._id === event.droneId);
          if (enemy && event.step.faceAngle !== null) enemy.sprite.setRotation(event.step.faceAngle);
          break;
        }
        case 'enemy-hit': {
          if (this.boss && this.boss._id === event.enemyId) {
            this.boss.hitFlash = event.hit.hitFlash;
            this.boss.syncPhaseFromHp();
            this.addDamageNumber(this.boss.x, this.boss.y, event.damage, event.crit);
            this.callbacks.onStats({ enemies: 0, items: 0, dmg: event.damage });
          } else {
            const enemy = this.enemies.find((e) => e._id === event.enemyId);
            if (enemy) {
              enemy.data.hitFlash = event.hit.hitFlash;
              enemy.applyVisual();
              this.addDamageNumber(enemy.x, enemy.y, event.damage, event.crit);
              this.callbacks.onStats({ enemies: 0, items: 0, dmg: event.damage });
            }
          }
          break;
        }
        case 'enemy-died': {
          if (this.boss && this.boss._id === event.enemyId) this.killBoss();
          else {
            const enemy = this.enemies.find((e) => e._id === event.enemyId);
            if (enemy) this.killEnemy(enemy);
          }
          break;
        }
        case 'player-hurt':
          this.player.syncVisual();
          audio.hurt();
          this.addShake(6);
          break;
        case 'player-death':
          this.onPlayerDeath();
          break;
        case 'player-healed':
          this.player.syncVisual();
          audio.pickup();
          break;
        case 'currency-gained':
        case 'xp-gained':
          this.player.syncVisual();
          break;
        case 'player-levelup':
          this.onLevelUp(event.level);
          break;
        case 'player-upgraded':
          this.player.syncVisual();
          break;
        case 'projectile-wall':
          this.addHitFx(event.x, event.y, 0x88aacc);
          break;
      }
    }
  }

  private syncCoreEntities(dt: number): void {
    this.player.syncVisual(dt);
    for (const drone of this.sim.drones) {
      const enemy = this.enemies.find((e) => e._id === drone.id);
      if (enemy) enemy.applyVisual();
    }
    const alive = new Set<number>();
    for (const projectile of this.sim.projectiles) {
      alive.add(projectile.id);
      let view = this.coreProjectileViews.get(projectile.id);
      if (!view) {
        const screen = this.worldToScreen(projectile.pos.x, projectile.pos.y);
        const spr = this.scene.add.sprite(screen.x, screen.y, this.projSprite(projectile.kind, projectile.side === 'enemy'));
        spr.setDepth(80);
        spr.setScale(projectile.side === 'enemy' ? 1.4 : 1.1);
        if (projectile.side === 'enemy') spr.setTint(0xff5533);
        view = { spr, data: projectile };
        this.coreProjectileViews.set(projectile.id, view);
      }
      view.data = projectile;
      const screen = this.worldToScreen(projectile.pos.x, projectile.pos.y);
      view.spr.setPosition(screen.x, screen.y);
    }
    for (const [id, view] of this.coreProjectileViews) {
      if (alive.has(id)) continue;
      if (view.spr.scene) view.spr.destroy();
      this.coreProjectileViews.delete(id);
    }
  }

  private updateLegacy(dt: number): void {
    this.clock += dt;
    for (const e of this.enemies) {
      if (e.data.kind === 'drone') continue; // core owns drone FSM and timers
      e.update(dt, this.player);
      e.applyVisual();
    }
    if (this.boss) this.boss.update(dt, this.player);
    this.updateLoot(dt);
    this.updateFx(dt);
    this.updateRoom();
    this.updateCamera(dt);
    if (this.renderer) this.renderer.updateLight(this.player.wx, this.player.wy);
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 10);
  }

  private updateLoot(dt: number): void {
    const remaining: Array<{ spr: Phaser.GameObjects.Sprite; data: LootDrop }> = [];
    for (const l of this.loot) {
      l.data.bob += dt * 4;
      const dx = this.player.x - l.data.x, dy = this.player.y - l.data.y;
      const d = Math.hypot(dx, dy);
      // magnet
      if (d > 0 && d < this.player.data.pickupRange) {
        const pull = 120 * (1 - d / this.player.data.pickupRange);
        l.data.x += (dx / d) * pull * dt;
        l.data.y += (dy / d) * pull * dt;
        const s = this.worldToScreen(l.data.x, l.data.y);
        l.spr.setPosition(s.x, s.y);
      }
      if (d < this.player.getRadius() + 12) {
        // Collected drops must remove their display sprite too, otherwise the
        // icon stays on screen forever after the item was already banked.
        l.spr.destroy();
        this.collectLoot(l.data);
        continue;
      }
      remaining.push(l);
    }
    this.loot = remaining;
  }

  private collectLoot(drop: LootDrop): void {
    // Loot is collected by the adapter, but the canonical player write is a
    // core command committed on the next tick.
    switch (drop.kind) {
      case 'health': this.healPlayer(30); break;
      case 'currency': this.addCurrency(drop.amount || 10); break;
      case 'restore': this.healPlayer(this.player.data.maxHp); break;
    }
    this.callbacks.onStats({ enemies: 0, items: 1, dmg: 0 });
    // spawn a pickup visual flash
    this.addHitFx(drop.x, drop.y, drop.kind === 'health' ? 0xff3355 : 0xffd233);
  }

  private updateFx(dt: number): void {
    // draw hit flashes
    this.fxGraphics.clear();
    for (const f of this.fx) f.life -= dt;
    const alive = this.fx.filter((f) => f.life > 0);
    for (const f of alive) {
      const a = Math.max(0, f.life / 0.3);
      this.fxGraphics.fillStyle(f.color, a * 0.5);
      this.fxGraphics.fillCircle(f.x, f.y, 10);
    }
    this.fx = alive;
    // fade damage numbers (managed by tweens); cleanup destroyed ones
    if (this.damageTexts.length && !this.damageTexts[0].scene) {
      this.damageTexts = this.damageTexts.filter((t) => !t.scene);
    }
  }

  private killEnemy(e: Enemy): void {
    // Core already committed HP/death, XP, currency and drop RNG. The adapter
    // only removes presentation and emits stats.
    e.sprite.destroy();
    this.callbacks.onStats({ enemies: 1, items: 0, dmg: 0 });
    this.enemies = this.enemies.filter((x) => x !== e);
  }

  private killBoss(): void {
    if (!this.boss) return;
    this.boss.sprite.destroy();
    this.boss = null;
    this.won = true;
    this.callbacks.onStats({ enemies: 1, items: 0, dmg: 0 });
    audio.bossroar();
    this.callbacks.onBossWin();
  }

  won = false;

  // ---------- Camera ----------

  private cam!: Phaser.Cameras.Scene2D.Camera;
  private camX = 0;
  private camY = 0;

  updateCamera(_dt: number): void {
    // Camera is driven by HUDScene/GameScene using player world position.
    this.camX = this.player.x;
    this.camY = this.player.y;
  }

  // ---------- Death / level ----------

  onPlayerDeath(): void {
    this.player.respawn = true;
    this.callbacks.onDeath();
  }

  onLevelUp(level: number): void {
    this.callbacks.onLevelUp(level);
  }

  captureCheckpoint(id: string, seed: number, stats: RunCheckpoint['stats']): RunCheckpoint | null {
    const room = this.currentRoom();
    if (!room || !this.map.rooms[room.id].cleared || !this.player.alive ||
        this.won || this.boss || this.enemies.some((enemy) => enemy.alive) ||
        this.map.rooms.some((entry) => entry.spawned && !entry.cleared)) return null;
    // Deep copy: the returned frame must not keep references to the live
    // player / loot. Any in-memory holder (AI harness, checkpoint UI, test)
    // would otherwise observe silently mutating "snapshots" (review R-03).
    return cloneCheckpoint({
      id, seed, stats, roomId: room.id,
      position: { x: this.player.x, y: this.player.y },
      clearedRooms: this.map.rooms.filter((entry) => entry.cleared).map((entry) => entry.id),
      portalTarget: this.currentRoomId === room.id ? this.portal?.targetRoom ?? null : null,
      rngState: this.rng.snapshot(),
      player: this.player.data,
      loot: this.loot.map(({ data }) => data),
      coreState: {
        tick: this.sim.tick,
        rngState: this.sim.rngState,
        playerTimers: {
          dashTimer: this.sim.player.dashTimer, invuln: this.sim.player.invuln,
          hurtTimer: this.sim.player.hurtTimer, fireTimer: this.sim.player.fireTimer, aimYaw: this.sim.player.aimYaw
        },
        nextProjectileId: this.sim.nextProjectileId
      }
    });
  }

  restoreCheckpoint(run: RunCheckpoint): boolean {
    const room = this.map.rooms[run.roomId];
    if (!room || !run.clearedRooms.every((id) => this.map.rooms[id]?.kind && this.map.rooms[id].kind !== 'boss') ||
        (run.portalTarget !== null && !room.connectedTo.includes(run.portalTarget))) return false;

    for (const id of run.clearedRooms) {
      this.map.rooms[id].cleared = this.map.rooms[id].spawned = true;
      this.enteredRooms.add(id);
    }
    // F-08: deep copy the incoming frame before assigning it to the live state.
    const frame = cloneCheckpoint(run);
    this.player.data = frame.player;
    // Capture the checkpoint's HP *before* reset(): reset() heals to full, but a
    // resumed run must keep exactly the HP it had when the checkpoint was saved.
    const restoredHp = this.player.data.hp;
    const { x, y } = run.position;
    const inside = x >= room.gx && x < room.gx + room.w && y >= room.gy && y < room.gy + room.h;
    const position = inside && this.isWalkable(x, y) ? run.position : this.findWalkableInRoom(room);
    this.player.reset(position.x, position.y);
    this.player.data.hp = restoredHp;
    this.currentRoomId = room.id;
    this.placePortal(room, run.portalTarget);
    this.rng.restore(run.rngState);
    this.sim.tick = 0;
    this.sim.drones = [];
    this.sim.targets = [];
    this.sim.projectiles = [];
    this.sim.pendingPlayerHits = [];
    this.sim.player.dashTimer = 0; this.sim.player.invuln = 0; this.sim.player.hurtTimer = 0;
    this.sim.player.fireTimer = 0; this.sim.player.aimYaw = 0;
    if (run.coreState) {
      // Restore the authoritative fixed-tick core contract so the resumed run
      // keeps the exact tick / RNG / timer / projectile-id sequence it had at
      // save time. Without this the core would silently re-randomise.
      this.sim.tick = run.coreState.tick;
      this.sim.rngState = run.coreState.rngState;
      const t = run.coreState.playerTimers;
      this.sim.player.dashTimer = t.dashTimer; this.sim.player.invuln = t.invuln;
      this.sim.player.hurtTimer = t.hurtTimer; this.sim.player.fireTimer = t.fireTimer; this.sim.player.aimYaw = t.aimYaw;
      this.sim.nextProjectileId = run.coreState.nextProjectileId;
    } else {
      // Legacy frame: re-derive the core RNG from the map seed so a restored
      // run still produces a deterministic core stream.
      this.sim.rngState = new RNG(run.seed * 7919 + 1).snapshot();
    }
    for (const view of this.coreProjectileViews.values()) if (view.spr.scene) view.spr.destroy();
    this.coreProjectileViews.clear();
    for (const drop of run.loot) this.spawnLoot(drop.x, drop.y, drop.kind, drop.key, drop.amount, drop.bob);
    return true;
  }

  reset(): void {
    for (const e of this.enemies) e.sprite.destroy();
    this.enemies = [];
    for (const view of this.coreProjectileViews.values()) if (view.spr.scene) view.spr.destroy();
    this.coreProjectileViews.clear();
    this.sim.drones = [];
    this.sim.targets = [];
    this.sim.projectiles = [];
    for (const l of this.loot) l.spr.destroy();
    this.loot = [];
    this.boss = null;
  }

  statsSnapshot(): { enemies: number; items: number; dmg: number } {
    return { enemies: 0, items: 0, dmg: 0 };
  }
}
