import Phaser from 'phaser';
import { MapData, Tile, Vec2, ProjectileData, LootDrop, HitFx, EnemyStateName, Room } from '../types';
import { EnemyKind } from '../config/enemies';
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
  projectiles: Array<{ spr: Phaser.GameObjects.Sprite; data: ProjectileData }> = [];
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
  private projIdCounter = 1;
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
    return e;
  }

  spawnBoss(r: Room): void {
    const depth = this.roomDepth.of(r.id);
    const landing = this.findBossSpawnInRoom(r);
    this.boss = new Boss(this, landing.x, landing.y, r.id, depth);
    this.boss._id = this.enemyIdCounter++;
    this.boss.initHp();
  }

  boss: Boss | null = null;

  spawnProjectile(ownerId: number, x: number, y: number, angle: number, spec: any, side: 'player' | 'enemy'): ProjectileData {
    const shots = spec.shots ?? 1;
    const results: ProjectileData[] = [];
    for (let i = 0; i < shots; i++) {
      const spread = spec.spread ?? 0;
      const a = angle + (shots > 1 ? (i / (shots - 1) - 0.5) * spread * shots : 0);
      const px = x + Math.cos(a) * 16 / GAME.PIXEL_TO_TILE;
      const py = y + Math.sin(a) * 16 / GAME.PIXEL_TO_TILE;
      const crit = this.rng.float() < spec.critChance;
      const dmg = (crit ? spec.critDamage : 1) * spec.damage;
      const data: ProjectileData = {
        id: this.projIdCounter++, ownerId, side, pos: { x: px, y: py },
        vel: { x: Math.cos(a) * spec.speed, y: Math.sin(a) * spec.speed },
        // Collision radius is expressed in tile-world units. Convert the px-authored
        // value, then keep a small minimum hitbox so fast bullets remain hittable
        // without falling back to the old 6-tile "magnet" radius.
        damage: dmg, lifetime: spec.lifetime,
        radius: Math.max((spec.magazine > 0 && spec.kind === 'scatter' ? 5 : 6) / GAME.PIXEL_TO_TILE, 0.2),
        crit, pierce: spec.pierce ?? 0, hitSet: new Set()
      };
      this.addProjectileSprite(data, spec.kind, side === 'enemy');
      results.push(data);
    }
    return results[0];
  }

  spawnEnemyProjectile(ownerId: number, x: number, y: number, damage: number, vel: Vec2 = { x: 0, y: 0 }): ProjectileData {
    const data: ProjectileData = {
      id: this.projIdCounter++, ownerId, side: 'enemy', pos: { x, y },
      vel: { x: vel.x, y: vel.y }, damage, lifetime: 2.5,
      radius: Math.max(6 / GAME.PIXEL_TO_TILE, 0.2),
      crit: false, pierce: 0, hitSet: new Set()
    };
    this.addProjectileSprite(data, 'plasma', true);
    return data;
  }

  private projSprite(kind: any, enemy: boolean): string {
    if (enemy) return 'proj_enemy';
    const map: Record<string, string> = { pulse: 'proj_pulse', scatter: 'proj_pulse', plasma: 'proj_plasma', arc: 'proj_pulse' };
    return map[kind] ?? 'proj_pulse';
  }

  private addProjectileSprite(data: ProjectileData, kind: any, enemy: boolean): void {
    const s = this.worldToScreen(data.pos.x, data.pos.y);
    const spr = this.scene.add.sprite(s.x, s.y, this.projSprite(kind, enemy));
    spr.setDepth(80);
    spr.setScale(enemy ? 1.4 : 1.1);
    if (enemy) spr.setTint(0xff5533);
    this.projectiles.push({ spr, data });
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

  update(dt: number): void {
    this.clock += dt;
    this.player.update(dt);
    // enemies
    for (const e of this.enemies) {
      e.update(dt, this.player);
      e.applyVisual();
    }
    if (this.boss) {
      this.boss.update(dt, this.player);
    }
    this.updateProjectiles(dt);
    this.updateLoot(dt);
    this.updateFx(dt);
    this.updateRoom();
    this.updateCamera(dt);
    if (this.renderer) this.renderer.updateLight(this.player.wx, this.player.wy);
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 10);
  }

  /** Shortest distance from point P to segment AB; used for swept projectile hits. */
  private segmentPointDistance(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    if (l2 <= 1e-9) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  /** Remove a projectile's display sprite exactly once (reset()/other paths may have done it already). */
  private destroyProjectileSprite(p: { spr: Phaser.GameObjects.Sprite; data: ProjectileData }): void {
    if (p.spr && p.spr.scene) p.spr.destroy();
  }

  private updateProjectiles(dt: number): void {
    const remaining: Array<{ spr: Phaser.GameObjects.Sprite; data: ProjectileData }> = [];
    for (const p of this.projectiles) {
      const prevX = p.data.pos.x;
      const prevY = p.data.pos.y;
      p.data.pos.x += p.data.vel.x * dt;
      p.data.pos.y += p.data.vel.y * dt;
      p.data.lifetime -= dt;
      const s = this.worldToScreen(p.data.pos.x, p.data.pos.y);
      p.spr.setPosition(s.x, s.y);
      const t = this.tileAt(p.data.pos.x, p.data.pos.y);
      const hitWall = t.type === 'wall';
      const expired = p.data.lifetime <= 0 || hitWall ||
        p.data.pos.x < -40 || p.data.pos.x > this.map.width + 40 ||
        p.data.pos.y < -40 || p.data.pos.y > this.map.height + 40;
      if (expired) {
        if (hitWall) this.addHitFx(p.data.pos.x, p.data.pos.y, 0x88aacc);
        // lifetime / hitWall / out-of-bounds: the entry leaves the array, so the sprite must go too.
        this.destroyProjectileSprite(p);
        continue;
      }
      // Swept collision: a fast bullet can cross a small hitbox between frames.
      const hit = (tx: number, ty: number, targetRadius: number): boolean =>
        this.segmentPointDistance(prevX, prevY, p.data.pos.x, p.data.pos.y, tx, ty)
          <= targetRadius + p.data.radius;
      // collisions
      let alive = true;
      if (p.data.side === 'player') {
        for (const e of this.enemies) {
          if (e._hp <= 0 || p.data.hitSet.has(e._id)) continue;
          if (hit(e.x, e.y, e.getRadius())) {
            const dmg = p.data.damage;
            e.hit(dmg, p.data.pos);
            this.addDamageNumber(e.x, e.y, dmg, p.data.crit);
            this.callbacks.onStats({ enemies: 0, items: 0, dmg: dmg });
            if (e._hp <= 0) this.killEnemy(e);
            if (p.data.pierce > 0) { p.data.pierce--; p.data.hitSet.add(e._id); }
            else { alive = false; break; }
          }
        }
        if (this.boss && this.boss._hp > 0 && !p.data.hitSet.has(this.boss._id)) {
          if (hit(this.boss.x, this.boss.y, this.boss.getRadius() + 1)) {
            const dmg = p.data.damage;
            this.boss.hit(dmg, p.data.pos);
            this.addDamageNumber(this.boss.x, this.boss.y, dmg, p.data.crit);
            this.callbacks.onStats({ enemies: 0, items: 0, dmg: dmg });
            if (this.boss._hp <= 0) this.killBoss();
            if (p.data.pierce > 0) { p.data.pierce--; p.data.hitSet.add(this.boss._id); }
            else { alive = false; }
          }
        }
      } else {
        if (this.player.alive && hit(this.player.x, this.player.y, this.player.getRadius())) {
          this.player.hurt(p.data.damage, p.data.pos.x, p.data.pos.y);
          alive = false;
        }
      }
      // Anything that is no longer alive (hit an enemy / boss / player, without pierce)
      // also has to release its sprite instead of becoming a ghost on screen.
      if (alive) remaining.push(p);
      else this.destroyProjectileSprite(p);
    }
    this.projectiles = remaining;
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
    switch (drop.kind) {
      case 'health': this.player.heal(30); break;
      case 'currency': this.player.data.currency += drop.amount || 10; break;
      case 'restore': this.player.heal(this.player.data.maxHp); break;
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
    e._hp = 0;
    e.sprite.destroy();
    this.callbacks.onStats({ enemies: 1, items: 0, dmg: 0 });
    // drop currency + health
    if (this.rng.float() < 0.6) this.spawnLoot(e.x, e.y, 'currency', 'currency', 4);
    if (this.rng.float() < 0.25) this.spawnLoot(e.x, e.y, 'health', 'health', 0);
    // xp
    this.player.addXp(e.data.stats.xpValue);
    this.enemies = this.enemies.filter((x) => x !== e);
  }

  private killBoss(): void {
    if (!this.boss) return;
    this.boss._hp = 0;
    this.boss.sprite.destroy();
    this.boss = null;
    this.won = true;
    this.callbacks.onStats({ enemies: 1, items: 0, dmg: 0 });
    this.player.addXp(200);
    const bx = this.player.x, by = this.player.y;
    for (let i = 0; i < 12; i++) this.spawnLoot(bx + (Math.random() - 0.5) * 120, by + (Math.random() - 0.5) * 120, 'currency', 'currency', 10);
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
    return {
      id, seed, stats, roomId: room.id,
      position: { x: this.player.x, y: this.player.y },
      clearedRooms: this.map.rooms.filter((entry) => entry.cleared).map((entry) => entry.id),
      portalTarget: this.currentRoomId === room.id ? this.portal?.targetRoom ?? null : null,
      rngState: this.rng.snapshot(),
      player: this.player.data,
      loot: this.loot.map(({ data }) => data)
    };
  }

  restoreCheckpoint(run: RunCheckpoint): boolean {
    const room = this.map.rooms[run.roomId];
    if (!room || !run.clearedRooms.every((id) => this.map.rooms[id]?.kind && this.map.rooms[id].kind !== 'boss') ||
        (run.portalTarget !== null && !room.connectedTo.includes(run.portalTarget))) return false;

    for (const id of run.clearedRooms) {
      this.map.rooms[id].cleared = this.map.rooms[id].spawned = true;
      this.enteredRooms.add(id);
    }
    this.player.data = run.player;
    const { x, y } = run.position;
    const inside = x >= room.gx && x < room.gx + room.w && y >= room.gy && y < room.gy + room.h;
    const position = inside && this.isWalkable(x, y) ? run.position : this.findWalkableInRoom(room);
    this.player.reset(position.x, position.y);
    this.currentRoomId = room.id;
    this.placePortal(room, run.portalTarget);
    this.rng.restore(run.rngState);
    for (const drop of run.loot) this.spawnLoot(drop.x, drop.y, drop.kind, drop.key, drop.amount, drop.bob);
    return true;
  }

  reset(): void {
    for (const e of this.enemies) e.sprite.destroy();
    this.enemies = [];
    for (const p of this.projectiles) p.spr.destroy();
    this.projectiles = [];
    for (const l of this.loot) l.spr.destroy();
    this.loot = [];
    this.boss = null;
  }

  statsSnapshot(): { enemies: number; items: number; dmg: number } {
    return { enemies: 0, items: 0, dmg: 0 };
  }
}
