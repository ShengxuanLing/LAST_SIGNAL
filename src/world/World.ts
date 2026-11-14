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
import type { PlayerData, RunCheckpoint, SaveData } from '../types';
import { audio } from '../systems/AudioSystem';
import type { ControllerActorView, LocalControllerView } from '../ai-native/localController';
import { buildWorldObservation, type WorldObservationV1 } from '../ai-native/worldObservation';
import { WORLD_PERCEPTION, createLocalProbe, gridLineOfSight } from '../ai-native/worldPerception';
import { cloneCheckpoint } from '../systems/RunCheckpoint';
import {
  addCurrency as addCoreCurrency, addPlayerXp as addCorePlayerXp, createSimulationState,
  applyUpgradeToPlayer as applyCoreUpgrade, enqueueCommand, enqueuePlayerHit,
  enqueueTargetHp as enqueueCoreTargetHp, enqueueTargetMove as enqueueCoreTargetMove, ensureWalkableFromState,
  healPlayer as healCorePlayer, registerDrone, registerTarget,
  spawnEnemyProjectile as spawnCoreEnemyProjectile, stepSimulationTicks, SIM_TUNING,
  type SimulationIntent, type SimulationState, type SimEvent, type SimLootKind, type SimProjectile, type SimTarget
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
  private _sim!: SimulationState;
  private simVersion = 0;
  private simSnapshotCache: SimulationState | null = null;
  private playerDataSnapshotCache: any = null;
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
    if (this._sim) this._sim.projectiles = [];
  }

  /** Read-only loot view over core loot; external code cannot clear core state. */
  get loot(): Array<{ spr: Phaser.GameObjects.Sprite; data: LootDrop }> {
    return [...this.coreLootViews.values()];
  }
  set loot(_value: Array<{ spr: Phaser.GameObjects.Sprite; data: LootDrop }>) {
    // Compatibility setter is intentionally non-authoritative.
  }

  setPlayerPositionForTest(x: number, y: number): void {
    World.assertDevTest();
    this._sim.player.x = x;
    this._sim.player.y = y;
    this.bumpSimVersion();
  }

  clearLootForTest(): void {
    World.assertDevTest();
    for (const view of this.coreLootViews.values()) if (view.spr.scene) view.spr.destroy();
    this.coreLootViews.clear();
    this._sim.loot = [];
    this.bumpSimVersion();
  }

  /** Explicit dev/test enemy cleanup; keeps adapter and core in sync. */
  clearEnemiesForTest(): void {
    World.assertDevTest();
    for (const e of this.enemies) if (e.sprite.scene) e.sprite.destroy();
    this.enemies = [];
    if (this._sim) {
      this._sim.drones = [];
      this._sim.targets = [];
    }
    if (this.boss) {
      if (this.boss.sprite.scene) this.boss.sprite.destroy();
      this.boss = null;
    }
  }
  private coreLootViews = new Map<number, { spr: Phaser.GameObjects.Sprite; data: LootDrop }>();
  fx: HitFx[] = [];
  private damageTexts: Phaser.GameObjects.Text[] = [];
  private fxGraphics: Phaser.GameObjects.Graphics;
  shakeAmount = 0;
  clock = 0;

  private roomDepth = new RoomDepth();
  private callbacks: WorldCallbacks;
  private rng: RNG;
  private enemyIdCounter = 1;
  private worldSpawns: Array<{ kind: EnemyKind; x: number; y: number; room: number; depth: number; boss?: Room }> = [];
  private roomClearedHandlers: Array<(r: RoomInfo) => void> = [];
  private currentRoomId = -1;
  private enteredRooms = new Set<number>();
  public renderer: WorldRenderer | null = null;
  private _minX = 0;
  private _minY = 0;
  private _maxX = 0;
  private _maxY = 0;
  private portal: { spr: Phaser.GameObjects.Sprite; targetRoom: number; wx: number; wy: number } | null = null;

  /** Deep, frozen read-only snapshot. External adapters must never mutate this. */
  get sim(): SimulationState {
    if (!this.simSnapshotCache) {
      this.simSnapshotCache = deepFreeze(JSON.parse(JSON.stringify(this._sim)) as SimulationState);
    }
    return this.simSnapshotCache;
  }

  /** Explicit dev/test fixture access to live core state; production throws. */
  get simFixture(): SimulationState {
    World.assertDevTest();
    this.bumpSimVersion();
    return this._sim;
  }

  /** Deep, frozen player data snapshot for HUD/read-only adapters. */
  get playerDataSnapshot(): any {
    if (!this.playerDataSnapshotCache) {
      this.playerDataSnapshotCache = deepFreeze(JSON.parse(JSON.stringify(this._sim.player.data)));
    }
    return this.playerDataSnapshotCache;
  }

  /** Explicit dev/test fixture access to live player data; production throws. */
  get playerDataFixture(): any {
    World.assertDevTest();
    this.bumpSimVersion();
    return this._sim.player.data;
  }

  get hasSimulation(): boolean { return !!this._sim; }

  get playerX(): number { return this._sim.player.x; }
  get playerY(): number { return this._sim.player.y; }
  get playerFireTimer(): number { return this._sim.player.fireTimer; }
  get playerDashTimer(): number { return this._sim.player.dashTimer; }
  get playerInvuln(): number { return this._sim.player.invuln; }
  get playerHurtTimer(): number { return this._sim.player.hurtTimer; }
  get playerAimYaw(): number { return this._sim.player.aimYaw; }

  private bumpSimVersion(): void {
    this.simVersion++;
    this.simSnapshotCache = null;
    this.playerDataSnapshotCache = null;
  }

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
    this._sim = createSimulationState({
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
      if (r.kind === 'boss') this.enqueueSpawnBoss(r);
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
      target = neighbors[0];
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
      // Ordinary transition is a command committed by the next core tick with
      // a validated walkable landing; updateRoom() enters the destination and
      // queues its spawn/portal on that tick.
      this.enqueueTeleport(landing.x, landing.y, true);
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
    if (r.kind === 'elite') {
      const elite = ['sentinel', 'hunter', 'stalker'] as const;
      return elite[r.id % elite.length];
    }
    const all: EnemyKind[] = ['drone', 'stalker', 'hunter', 'sentinel'];
    return all[(r.id * 53 + depth * 11) % 4];
  }

  private spawnResourceLoot(r: Room): void {
    const n = r.kind === 'shop' ? 3 : 2 + (this.roomDepth.of(r.id) % 3);
    for (let i = 0; i < n; i++) {
      const x = r.gx + 2 + (i + 1) * 2;
      const y = r.gy + 2 + (i % 2) * 2;
      const kind = (r.id + i) % 2 === 0 ? 'currency' : 'health';
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
      const drone = registerDrone(this._sim, {
        id: e._id, x: e.x, y: e.y, hp: e._hp, data: e.data,
        attackTimer: e.attackTimer, wanderTimer: e.wanderTimer
      });
      e.attachSimDrone(drone);
    } else {
      const target = registerTarget(this._sim, {
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
    const target = registerTarget(this._sim, {
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
    enqueueCoreTargetMove(this._sim, targetId, x, y);
    this.bumpSimVersion();
  }

  enqueueTargetHp(targetId: number, hp: number): void {
    enqueueCoreTargetHp(this._sim, targetId, hp);
    this.bumpSimVersion();
  }

  enqueueHeal(amount: number): void {
    enqueueCommand(this._sim, { type: 'heal-player', amount });
    this.bumpSimVersion();
  }

  enqueueCurrency(amount: number): void {
    enqueueCommand(this._sim, { type: 'add-currency', amount });
    this.bumpSimVersion();
  }

  enqueueApplyUpgrade(key: string, level: number): void {
    enqueueCommand(this._sim, { type: 'apply-upgrade', key, level });
    this.bumpSimVersion();
  }

  enqueueAddXp(base: number): void {
    enqueueCommand(this._sim, { type: 'add-xp', base });
    this.bumpSimVersion();
  }

  enqueueSpawnLoot(x: number, y: number, kind: SimLootKind, key: string, amount: number, bob = 0): void {
    enqueueCommand(this._sim, { type: 'spawn-loot', x, y, kind, key, amount, bob });
    this.bumpSimVersion();
  }

  /** Owner-only reset/transition; validates a legal landing cell before commit. */
  ownerResetPlayer(x: number, y: number): void {
    const recovered = ensureWalkableFromState(this._sim, { x, y });
    this._sim.player.x = recovered.x;
    this._sim.player.y = recovered.y;
    this._sim.player.data.hp = this._sim.player.data.maxHp;
    this._sim.player.invuln = 1.0;
    this._sim.player.fireTimer = 0;
    this.bumpSimVersion();
  }

  /** Owner-only move used by the reset path; ordinary movement is core-stepped. */
  ownerMovePlayer(x: number, y: number): void {
    this._sim.player.x = x;
    this._sim.player.y = y;
    this.bumpSimVersion();
  }
  /** Owner/shop transaction: replaces canonical player data atomically. */
  ownerSetPlayerData(data: PlayerData): void {
    this._sim.player.data = JSON.parse(JSON.stringify(data)) as PlayerData;
    this.bumpSimVersion();
  }

  /** Core-owned equip transaction; UI calls this instead of writing player.data. */
  equipWeapon(key: string): boolean {
    if (!this._sim.player.data.weapons.some((w) => w.key === key)) return false;
    this._sim.player.data.weaponKey = key;
    this.bumpSimVersion();
    return true;
  }

  /** Core-owned XP transaction used by legacy/test callers; emits level callbacks. */
  addPlayerXp(base: number): number {
    const { gained, levels } = addCorePlayerXp(this._sim, base);
    for (const level of levels) this.onLevelUp(level);
    this.bumpSimVersion();
    return gained;
  }

  /** Core-owned immediate heal transaction for test/owner callers. */
  healPlayer(amount: number): number {
    const hp = healCorePlayer(this._sim, amount);
    this.bumpSimVersion();
    return hp;
  }

  /** Core-owned immediate currency transaction for test/owner callers. */
  addCurrency(amount: number): number {
    const currency = addCoreCurrency(this._sim, amount);
    this.bumpSimVersion();
    return currency;
  }

  /** Queues an enemy/Boss spawn; committed at the start of the next core tick. */
  enqueueSpawnEnemy(kind: EnemyKind, x: number, y: number, room: number, depth: number): void {
    this.worldSpawns.push({ kind, x, y, room, depth });
    this.bumpSimVersion();
  }

  enqueueSpawnBoss(room: Room): void {
    this.worldSpawns.push({ kind: 'boss_warden', x: 0, y: 0, room: room.id, depth: this.roomDepth.of(room.id), boss: room });
    this.bumpSimVersion();
  }

  private processWorldSpawns(): void {
    if (this.worldSpawns.length === 0) return;
    const queue = this.worldSpawns;
    this.worldSpawns = [];
    for (const entry of queue) {
      if (entry.boss) this.spawnBoss(entry.boss);
      else this.spawnEnemy(entry.kind, entry.x, entry.y, entry.room, entry.depth);
    }
  }

  /** Queues a validated room teleport; committed by the next core tick. */
  enqueueTeleport(x: number, y: number, healToFull = true): void {
    enqueueCommand(this._sim, { type: 'teleport-player', x, y, healToFull });
    this.bumpSimVersion();
  }

  /** Queues a legacy ranged attack; core commits it on the next tick. */
  spawnEnemyProjectile(ownerId: number, x: number, y: number, damage: number, vel: Vec2 = { x: 0, y: 0 }, lifetime?: number): void {
    enqueueCommand(this._sim, { type: 'spawn-enemy-projectile', ownerId, x, y, damage, vel, lifetime });
    this.bumpSimVersion();
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

  /** Queues a visible loot drop; core owns the data and the pickup transaction. */
  spawnLoot(x: number, y: number, kind: ItemKind, key: string, amount: number, bob = 0): void {
    this.enqueueSpawnLoot(x, y, kind as SimLootKind, key, amount, bob);
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
      // World-level spawns and ordinary room spawns commit at the tick boundary.
      this.processWorldSpawns();
      events = stepSimulationTicks(this._sim, ticks, intent);
      this.applySimEvents(events);
      this.bumpSimVersion();
    }
    this.syncCoreEntities(delta / 1000);
    if (ticks > 0) this.updateLegacy(delta / 1000);
    return events;
  }

  resetSimulationAccumulator(): void { this.simAccumulatorMs = 0; }

  /** Legacy melee/attack adapter: queue a player hit; core commits it next tick. */
  enqueuePlayerHit(damage: number, fromX: number, fromY: number): void {
    enqueuePlayerHit(this._sim, damage, fromX, fromY);
  }

  /**
   * Strict dev/test-only diagnostic facade. It must NOT be used as official
   * Node/Rendered parity evidence (parity drives stepFrame/accumulator).
   */
  stepSimulationTicksForTest(ticks: number, intent: SimulationIntent): SimEvent[] {
    const env = (import.meta as any).env ?? {};
    if (!(env.DEV === true || env.MODE === 'test')) throw new Error('dev/test only');
    const events = stepSimulationTicks(this._sim, Math.max(0, Math.floor(ticks)), intent);
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
        case 'loot-dropped':
          this.syncCoreLoot();
          break;
        case 'loot-collected':
          this.syncCoreLoot();
          this.callbacks.onStats({ enemies: 0, items: 1, dmg: 0 });
          this.addHitFx(event.x, event.y, event.kind === 'health' ? 0xff3355 : 0xffd233);
          break;
        case 'projectile-wall':
          this.addHitFx(event.x, event.y, 0x88aacc);
          break;
      }
    }
  }

  private syncCoreEntities(dt: number): void {
    this.player.syncVisual(dt);
    this.syncCoreLoot();
    for (const drone of this._sim.drones) {
      const enemy = this.enemies.find((e) => e._id === drone.id);
      if (enemy) enemy.applyVisual();
    }
    const alive = new Set<number>();
    for (const projectile of this._sim.projectiles) {
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
    this.updateFx(dt);
    this.updateRoom();
    this.updateCamera(dt);
    if (this.renderer) this.renderer.updateLight(this.player.wx, this.player.wy);
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 10);
  }

  private syncCoreLoot(): void {
    const alive = new Set<number>();
    for (const loot of this._sim.loot) {
      alive.add(loot.id);
      let view = this.coreLootViews.get(loot.id);
      if (!view) {
        const s = this.worldToScreen(loot.x, loot.y);
        const kind = loot.kind as ItemKind;
        const spr = this.scene.add.sprite(s.x, s.y, 'icon_' + (kind === 'currency' ? 'currency' : kind === 'health' ? 'health' : 'upgrade'));
        spr.setDepth(70);
        view = { spr, data: { x: loot.x, y: loot.y, kind, key: loot.key, amount: loot.amount, bob: loot.bob } };
        this.coreLootViews.set(loot.id, view);
      }
      view.data = { x: loot.x, y: loot.y, kind: loot.kind as ItemKind, key: loot.key, amount: loot.amount, bob: loot.bob };
      const screen = this.worldToScreen(loot.x, loot.y);
      view.spr.setPosition(screen.x, screen.y);
    }
    for (const [id, view] of this.coreLootViews) {
      if (alive.has(id)) continue;
      if (view.spr.scene) view.spr.destroy();
      this.coreLootViews.delete(id);
    }
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
      loot: this._sim.loot.map((l) => ({ x: l.x, y: l.y, kind: l.kind as ItemKind, key: l.key, amount: l.amount, bob: l.bob })),
      coreState: {
        tick: this._sim.tick,
        rngState: this._sim.rngState,
        playerTimers: {
          dashTimer: this._sim.player.dashTimer, invuln: this._sim.player.invuln,
          hurtTimer: this._sim.player.hurtTimer, fireTimer: this._sim.player.fireTimer, aimYaw: this._sim.player.aimYaw
        },
        nextProjectileId: this._sim.nextProjectileId
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
    this.ownerSetPlayerData(frame.player);
    // Capture the checkpoint's HP *before* reset(): reset() heals to full, but a
    // resumed run must keep exactly the HP it had when the checkpoint was saved.
    const restoredHp = this.player.data.hp;
    const { x, y } = run.position;
    const inside = x >= room.gx && x < room.gx + room.w && y >= room.gy && y < room.gy + room.h;
    const position = inside && this.isWalkable(x, y) ? run.position : this.findWalkableInRoom(room);
    this.player.reset(position.x, position.y);
    this._sim.player.data.hp = restoredHp;
    this.bumpSimVersion();
    this.currentRoomId = room.id;
    this.placePortal(room, run.portalTarget);
    this.rng.restore(run.rngState);
    this._sim.tick = 0;
    this._sim.drones = [];
    this._sim.targets = [];
    this._sim.projectiles = [];
    this._sim.pendingPlayerHits = [];
    this._sim.loot = [];
    this._sim.player.dashTimer = 0; this._sim.player.invuln = 0; this._sim.player.hurtTimer = 0;
    this._sim.player.fireTimer = 0; this._sim.player.aimYaw = 0;
    if (run.coreState) {
      // Restore the authoritative fixed-tick core contract so the resumed run
      // keeps the exact tick / RNG / timer / projectile-id sequence it had at
      // save time. Without this the core would silently re-randomise.
      this._sim.tick = run.coreState.tick;
      this._sim.rngState = run.coreState.rngState;
      const t = run.coreState.playerTimers;
      this._sim.player.dashTimer = t.dashTimer; this._sim.player.invuln = t.invuln;
      this._sim.player.hurtTimer = t.hurtTimer; this._sim.player.fireTimer = t.fireTimer; this._sim.player.aimYaw = t.aimYaw;
      this._sim.nextProjectileId = run.coreState.nextProjectileId;
    } else {
      // Legacy frame: re-derive the core RNG from the map seed so a restored
      // run still produces a deterministic core stream.
      this._sim.rngState = new RNG(run.seed * 7919 + 1).snapshot();
    }
    for (const view of this.coreProjectileViews.values()) if (view.spr.scene) view.spr.destroy();
    this.coreProjectileViews.clear();
    this._sim.loot = run.loot.map((drop, i) => ({ id: i + 1, x: drop.x, y: drop.y, kind: drop.kind as SimLootKind, key: drop.key, amount: drop.amount, bob: drop.bob }));
    this._sim.nextLootId = run.loot.length + 1;
    this.bumpSimVersion();
    return true;
  }

  reset(): void {
    for (const e of this.enemies) e.sprite.destroy();
    this.enemies = [];
    for (const view of this.coreProjectileViews.values()) if (view.spr.scene) view.spr.destroy();
    this.coreProjectileViews.clear();
    this._sim.drones = [];
    this._sim.targets = [];
    this._sim.projectiles = [];
    for (const l of this.loot) l.spr.destroy();
    this.loot = [];
    this.boss = null;
  }

  statsSnapshot(): { enemies: number; items: number; dmg: number } {
    return { enemies: 0, items: 0, dmg: 0 };
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as any)) deepFreeze((value as any)[key]);
    Object.freeze(value as any);
  }
  return value;
}
