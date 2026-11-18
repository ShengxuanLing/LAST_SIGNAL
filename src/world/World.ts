import Phaser from 'phaser';
import { MapData, Tile, Vec2, ProjectileData, LootDrop, EnemyStateName, Room } from '../types';
import { EnemyKind } from '../config/enemies';
import { GAME } from '../config/game';
import { ItemKind } from '../types';
import { IsoMath, isoToScreen, screenToIso } from '../core/iso';
import { RNG } from '../core/random';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Boss } from '../entities/Boss';
import { circleContact, wallContact } from './projectileCollision';
import { RoomDepth } from '../world/roomdepth';
import { WorldRenderer } from '../world/WorldRenderer';
import type { RunCheckpoint, SaveData } from '../types';
import { audio } from '../systems/AudioSystem';
import { CombatVfx, BOLT_HEIGHT, type BoltView, type TelegraphView } from '../art/survey/CombatVfx';
import { CSS, DEPTH, FONT, INK } from '../art/survey/tokens';

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
  /** AR-02 visual-only combat effects (reads state, never writes it). */
  vfx: CombatVfx;
  private damageStack = new Map<number, { t: number; n: number }>();
  shakeAmount = 0;
  clock = 0;

  private roomDepth = new RoomDepth();
  private callbacks: WorldCallbacks;
  readonly rng: RNG;
  private enemyIdCounter = 1;
  private projIdCounter = 1;
  private currentRoomId = -1;
  private enteredRooms = new Set<number>();
  public renderer: WorldRenderer | null = null;
  private _minX = 0;
  private _minY = 0;
  private portal: { spr: Phaser.GameObjects.Sprite; targetRoom: number; wx: number; wy: number } | null = null;

  constructor(scene: Phaser.Scene, map: MapData, save: SaveData, callbacks: WorldCallbacks) {
    this.scene = scene;
    this.map = map;
    this.callbacks = callbacks;
    this.rng = new RNG(map.seed * 7919 + 1);
    this.roomDepth.build(map);
    this._minX = map.tiles[0][0].x;
    this._minY = map.tiles[0][0].y;
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
    this.vfx = new CombatVfx(scene, map.seed);
  }

  /** Number of rooms whose survey ink has been drawn (visual observation state). */
  surveyedRooms(): number {
    return this.renderer?.surveyedRooms ?? 0;
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
    const point = isoToScreen(x, y);
    point.x += this.renderer?._offX ?? 0;
    point.y += this.renderer?._offY ?? 0;
    return point;
  }

  /** Inverse of worldToScreen: a display-space point back to a world-grid coordinate. */
  screenToWorld(sx: number, sy: number): Vec2 {
    const offX = this.renderer ? this.renderer._offX : 0;
    const offY = this.renderer ? this.renderer._offY : 0;
    return screenToIso(sx - offX, sy - offY);
  }

  // ---------- Collision ----------

  tileAt(worldX: number, worldY: number): Tile {
    // tiles[] is indexed [gy][gx] where the tile at that cell has world coord
    // (minX + gx, minY + gy). So map the absolute world coord back to an index by
    // subtracting the offset first.
    const gx = Math.floor(worldX) - this._minX;
    const gy = Math.floor(worldY) - this._minY;
    return this.map.tiles[gy]?.[gx] ?? { x: Math.floor(worldX), y: Math.floor(worldY), type: 'wall', height: 0 };
  }

  isWalkable(worldX: number, worldY: number, radius = 0.5): boolean {
    const left = Math.floor(worldX - radius) - this._minX;
    const right = Math.floor(worldX + radius) - this._minX;
    const top = Math.floor(worldY - radius) - this._minY;
    const bottom = Math.floor(worldY + radius) - this._minY;
    return this.canEnterCell(left, top) && this.canEnterCell(right, top) &&
      this.canEnterCell(left, bottom) && this.canEnterCell(right, bottom);
  }

  private canEnterCell(x: number, y: number): boolean {
    const type = this.map.tiles[y]?.[x]?.type;
    return type === 'floor' || type === 'spawn' || type === 'debris';
  }

  // ---------- Room tracking ----------

  currentRoom(): Room | null {
    const px = this.player.x, py = this.player.y;
    for (const r of this.map.rooms) {
      if (px >= r.gx && px < r.gx + r.w && py >= r.gy && py < r.gy + r.h) {
        return r;
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
    const r = this.map.rooms[room.id];
    if (r.spawned && !r.cleared && this.boss?.spawnRoom !== room.id && !this.enemies.some((e) => e.data.spawnRoom === room.id && e.alive)) {
      r.cleared = true;
      this.callbacks.onRoomCleared(room);
    }
  }

  private onEnterRoom(room: RoomInfo): void {
    const r = this.map.rooms[room.id];
    this.enteredRooms.add(room.id);
    // Survey ink: entering a room is an observation; the mast's pulse draws it in.
    if (this.renderer) {
      const p = this.player.sprite;
      this.renderer.observeRoom(room.id, p.x, p.y);
    }
    if (!r.spawned) {
      if (r.kind === 'boss') {
        this.spawnBoss(r);
        r.spawned = true;
      } else this.spawnForRoom(r);
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
    const best = this.findWalkableInRoom(r, targetCenter);

    if (this.portal) { this.portal.spr.destroy(); this.portal = null; }
    // Display at the visual centre of the chosen cell; interaction still uses (best.x, best.y).
    const s = this.worldToScreen(best.x + 0.5, best.y + 0.5);
    const spr = this.scene.add.sprite(s.x, s.y, 'portal_beacon');
    spr.setOrigin(0.5, 54 / 64).setDepth(DEPTH.decal + 1);
    this.scene.add.tween({ targets: spr, alpha: { from: 0.65, to: 1 }, duration: 900, yoyo: true, repeat: -1 });
    // Protocol label (interact cyan) + world light pool; both die with the beacon.
    const label = this.scene.add.text(s.x + 16, s.y - 58, `F · R-${String(target).padStart(2, '0')} ${tr.kind.toUpperCase()}`, {
      fontFamily: FONT.mono, fontSize: '11px', color: CSS.interact
    }).setOrigin(0, 0.5).setDepth(DEPTH.decal + 1);
    const glow = this.scene.add.image(s.x, s.y, 'light_interact').setBlendMode(Phaser.BlendModes.ADD).setScale(0.6).setAlpha(0.35).setDepth(DEPTH.light);
    spr.once('destroy', () => { label.destroy(); glow.destroy(); });
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
  private findWalkableInRoom(r: Room, target?: Vec2, avoidPlayer = false): Vec2 {
    const center = { x: r.gx + Math.floor(r.w / 2), y: r.gy + Math.floor(r.h / 2) };
    const tx = target?.x ?? r.gx + r.w / 2;
    const ty = target?.y ?? r.gy + r.h / 2;
    let best = center;
    let bestDistance = Infinity;
    for (let y = r.gy; y < r.gy + r.h; y++) {
      for (let x = r.gx; x < r.gx + r.w; x++) {
        const distance = (x - tx) ** 2 + (y - ty) ** 2;
        if (distance >= bestDistance || !this.isWalkable(x, y)) continue;
        if (avoidPlayer && (x - this.player.x) ** 2 + (y - this.player.y) ** 2 < 9) continue;
        best = { x, y };
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Boss spawn near the room centre, but never on top of the player. */
  private findBossSpawnInRoom(r: Room): Vec2 {
    const center = this.findWalkableInRoom(r);
    return this.findWalkableInRoom(r, center, true);
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
    const rowSpacing = (r.h - 6) / Math.max(1, Math.ceil(count / 3) - 1);
    for (let i = 0; i < count; i++) {
      const ex = r.gx + 3 + (i % 3) * (r.w - 6) / 3;
      const ey = r.gy + 3 + Math.floor(i / 3) * rowSpacing;
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
      const x = r.gx + 2 + (i + 1) * (r.w - 4) / (n + 1);
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
    spr.setDepth(DEPTH.fx - 1);
    // Position stays the ground projection (collision truth, audit.spec projErr < 1);
    // the glow is drawn BOLT_HEIGHT px higher through the origin so shots read as
    // fired at chest height. CombatVfx paints the bolt / trail at the same height.
    spr.setOrigin(0.5, 0.5 + BOLT_HEIGHT / spr.height);
    this.projectiles.push({ spr, data });
    (spr as any).__kind = kind;
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

  /**
   * Takes world-grid coordinates; the text object is placed in display space.
   * AR-02: numbers start above the head and successive hits on the same target are
   * staggered horizontally (03 §4: ±8 px × index) so "12 22 2" no longer stacks.
   */
  addDamageNumber(x: number, y: number, amount: number, crit: boolean, targetId = -1, headPx = 48): void {
    const s = this.worldToScreen(x, y);
    const st = this.damageStack.get(targetId);
    const n = st && this.clock - st.t < 0.6 ? st.n + 1 : 0;
    this.damageStack.set(targetId, { t: this.clock, n });
    const k = n % 5;
    const dx = k === 0 ? 0 : (k % 2 ? 1 : -1) * 8 * Math.ceil(k / 2);
    const t = this.scene.add.text(s.x + dx, s.y - headPx, crit ? `${Math.round(amount)}×` : Math.round(amount).toString(), {
      fontFamily: FONT.mono, fontSize: crit ? '17px' : '13px', fontStyle: 'bold',
      color: crit ? CSS.priority : CSS.known, stroke: CSS.shadow, strokeThickness: 3
    }).setOrigin(0.5, 1).setDepth(DEPTH.label);
    t.setAlpha(1);
    this.scene.tweens.add({ targets: t, y: s.y - headPx - 22, alpha: 0, duration: 800, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  /** Takes world-grid coordinates; drawn by CombatVfx as survey ink debris. */
  addHitFx(x: number, y: number, color: number): void {
    const s = this.worldToScreen(x, y);
    this.vfx.impact(s.x, s.y - 4, color, false, 3);
  }

  /** Dash: two bone afterimages + a ground drag mark (03 §8 Special). Visual only. */
  onDash(): void {
    const p = this.player.sprite;
    const from = { x: p.x, y: p.y };
    for (let i = 0; i < 2; i++) {
      this.scene.time.delayedCall(i * 40, () => {
        if (!p.scene) return;
        const ghost = this.scene.add.image(p.x, p.y, p.texture.key, p.frame.name)
          .setOrigin(p.originX, p.originY).setScale(p.scaleX, p.scaleY).setFlipX(p.flipX)
          .setAlpha(0.35).setDepth(p.depth - 0.001).setBlendMode(Phaser.BlendModes.ADD);
        this.scene.tweens.add({ targets: ghost, alpha: 0, duration: 160, onComplete: () => ghost.destroy() });
      });
    }
    this.scene.time.delayedCall(140, () => { if (p.scene) this.vfx.drag(from.x, from.y, p.x, p.y); });
  }

  // ---------- Update ----------

  update(dt: number): void {
    this.clock += dt;
    this.player.update(dt);
    // enemies
    for (const e of this.enemies) {
      e.update(dt, this.player);
      e.applyVisual(dt, this.clock);
    }
    if (this.boss) {
      this.boss.update(dt, this.player);
    }
    this.updateProjectiles(dt);
    this.updateLoot(dt);
    this.updateRoom();
    this.player.updateView(dt);
    this.updateFx(dt);
    this.updateCamera(dt);
    this.renderer?.update(dt);
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 10);
  }

  private readonly projectileWall = (x: number, y: number): boolean => {
    const tile = this.map.tiles[y - this._minY]?.[x - this._minX];
    return !tile || tile.type === 'wall';
  };

  /** Remove a projectile's display sprite exactly once (reset()/other paths may have done it already). */
  private destroyProjectileSprite(p: { spr: Phaser.GameObjects.Sprite; data: ProjectileData }): void {
    if (p.spr && p.spr.scene) p.spr.destroy();
  }

  private updateProjectiles(dt: number): void {
    let kept = 0;
    for (const projectile of this.projectiles) {
      const { data, spr } = projectile;
      if (data.lifetime <= 0) {
        this.destroyProjectileSprite(projectile);
        continue;
      }
      const travel = Math.min(dt, data.lifetime);
      const dx = data.vel.x * travel, dy = data.vel.y * travel;
      const { x, y } = data.pos;
      const wall = wallContact(x, y, dx, dy, this.projectileWall);
      let stop = wall;
      if (data.side === 'player') {
        stop = Math.min(wall, this.hitTargets(data, dx, dy, wall));
      } else if (this.player.alive) {
        const hit = circleContact(x, y, dx, dy, this.player.x, this.player.y,
          this.player.getRadius() + data.radius);
        if (hit < wall) {
          stop = hit;
          const hx = x + dx * hit, hy = y + dy * hit;
          if (this.player.hurt(data.damage, hx, hy)) {
            const s = this.worldToScreen(hx, hy);
            this.vfx.impact(s.x, s.y - BOLT_HEIGHT, INK.hostile, false, 5);
          }
        }
      }
      const t = Math.min(1, stop);
      data.pos.x = x + dx * t;
      data.pos.y = y + dy * t;
      const s = this.worldToScreen(data.pos.x, data.pos.y);
      if (stop === wall && wall <= 1) {
        this.vfx.impact(s.x, s.y - BOLT_HEIGHT, data.side === 'enemy' ? INK.hostile : INK.known, false, 3);
      }
      data.lifetime -= dt;
      if (stop <= 1 || data.lifetime <= 0) this.destroyProjectileSprite(projectile);
      else {
        spr.setPosition(s.x, s.y);
        this.projectiles[kept++] = projectile;
      }
    }
    this.projectiles.length = kept;
  }

  private hitTargets(shot: ProjectileData, dx: number, dy: number, wall: number): number {
    const hits: Array<{ target: Enemy | Boss; time: number }> = [];
    const collect = (target: Enemy | Boss, radius: number) => {
      if (!target.alive || shot.hitSet.has(target._id)) return;
      const time = circleContact(shot.pos.x, shot.pos.y, dx, dy, target.x, target.y, radius + shot.radius);
      if (time < wall) hits.push({ target, time });
    };
    for (const enemy of this.enemies) collect(enemy, enemy.getRadius());
    if (this.boss) collect(this.boss, this.boss.getRadius() + 1);
    if (hits.length > 1) hits.sort((a, b) => a.time - b.time);

    for (const { target, time } of hits) {
      const point = { x: shot.pos.x + dx * time, y: shot.pos.y + dy * time };
      const hp = target._hp;
      target.hit(shot.damage, point);
      const damage = hp - Math.max(0, target._hp);
      if (damage > 0) {
        const s = this.worldToScreen(point.x, point.y);
        this.vfx.impact(s.x, s.y - BOLT_HEIGHT, INK.known, shot.crit, shot.crit ? 6 : 4);
        this.addDamageNumber(target.x, target.y, damage, shot.crit, target._id, target instanceof Enemy ? target.headPx() : 64);
        this.callbacks.onStats({ enemies: 0, items: 0, dmg: damage });
        if (!target.alive) {
          if (target instanceof Boss) this.killBoss();
          else this.killEnemy(target);
        }
      }
      if (shot.pierce <= 0) return time;
      shot.pierce--;
      shot.hitSet.add(target._id);
    }
    return Infinity;
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
    this.addHitFx(drop.x, drop.y, drop.kind === 'health' ? INK.interact : INK.known);
  }

  private updateFx(dt: number): void {
    // Bolts (player pulse / hostile) and hostile telegraphs, read from live state.
    const bolts: BoltView[] = [];
    for (const p of this.projectiles) {
      const velocity = isoToScreen(p.data.vel.x * 0.01, p.data.vel.y * 0.01);
      bolts.push({ x: p.spr.x, y: p.spr.y, vx: velocity.x, vy: velocity.y, enemy: p.data.side === 'enemy', kind: (p.spr as any).__kind ?? 'pulse' });
    }
    const tele: TelegraphView[] = [];
    const ps = this.player.sprite;
    for (const e of this.enemies) {
      const v = e.view;
      if (!v || v.telegraph <= 0 || !this.player.alive) continue;
      const ap = v.aperture();
      const melee = !!e.data.stats.reachEnemy;
      tele.push({
        ax: melee ? e.sprite.x : ap.x, ay: melee ? e.sprite.y : ap.y,
        tx: ps.x, ty: melee ? ps.y : ps.y - BOLT_HEIGHT,
        strength: v.telegraph, melee, detect: e.data.state === 'detect',
        // melee reach used by Enemy.doAttack: attackRange + 1.5 tiles, in screen px (iso x-scale)
        reach: (e.data.stats.attackRange + 1.5) * GAME.TILE_W / Math.SQRT2,
      });
    }
    this.vfx.update(dt, bolts, tele);
  }

  private killEnemy(e: Enemy): void {
    e._hp = 0;
    this.damageStack.delete(e._id);
    this.enemyDeathVisual(e);
    e.sprite.destroy();
    this.callbacks.onStats({ enemies: 1, items: 0, dmg: 0 });
    // drop currency + health
    if (this.rng.float() < 0.6) this.spawnLoot(e.x, e.y, 'currency', 'currency', 4);
    if (this.rng.float() < 0.25) this.spawnLoot(e.x, e.y, 'health', 'health', 0);
    // xp
    this.player.addXp(e.data.stats.xpValue);
    this.enemies = this.enemies.filter((x) => x !== e);
  }

  /**
   * Death (03 §8): the mass collapses inward (400 ms), the aperture goes out, and
   * the wreck's ink outline stays 2 s before fading to dotted "history". Visual only;
   * it runs after the kill was resolved and never delays drops / XP / room clear.
   */
  private enemyDeathVisual(e: Enemy): void {
    const sp = e.sprite;
    if (!sp?.scene) return;
    const frame = String(sp.frame.name).replace(/_flash$/, '');
    const husk = this.scene.add.image(sp.x, sp.y, sp.texture.key, `${frame.startsWith('tele') ? 'idle_0' : frame}_flash`)
      .setOrigin(sp.originX, sp.originY).setFlipX(sp.flipX).setDepth(sp.depth).setAlpha(0.9);
    const body = this.scene.add.image(sp.x, sp.y, sp.texture.key, frame.startsWith('tele') ? 'idle_0' : frame)
      .setOrigin(sp.originX, sp.originY).setFlipX(sp.flipX).setDepth(sp.depth);
    this.scene.tweens.add({ targets: husk, alpha: 0, duration: 90, onComplete: () => husk.destroy() });
    this.scene.tweens.add({ targets: body, scaleY: 0.25, scaleX: 1.15, alpha: 0, duration: 400, ease: 'Cubic.easeIn', onComplete: () => body.destroy() });
    const w = e.view ? e.view.art.shadowW : 32;
    this.vfx.wreck(sp.x, sp.y, w, e.data.kind);
    this.vfx.impact(sp.x, sp.y - 14, INK.known, false, 6);
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
    for (let i = 0; i < 12; i++) this.spawnLoot(bx + this.rng.range(-60, 60), by + this.rng.range(-60, 60), 'currency', 'currency', 10);
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

  safeCheckpointRoom(room = this.currentRoom()): Room | null {
    if (!room?.cleared || !this.player.alive || this.won || this.boss ||
        this.enemies.some(enemy => enemy.alive) ||
        this.map.rooms.some(entry => entry.spawned && !entry.cleared)) return null;
    return room;
  }

  captureCheckpoint(id: string, seed: number, stats: RunCheckpoint['stats']): RunCheckpoint | null {
    const room = this.safeCheckpointRoom();
    if (!room) return null;
    return {
      id, seed, mapVersion: this.map.mapVersion, stats, roomId: room.id,
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
    // Capture the checkpoint's HP *before* reset(): reset() heals to full, but a
    // resumed run must keep exactly the HP it had when the checkpoint was saved.
    const restoredHp = this.player.data.hp;
    const { x, y } = run.position;
    const inside = x >= room.gx && x < room.gx + room.w && y >= room.gy && y < room.gy + room.h;
    const position = inside && this.isWalkable(x, y) ? run.position : this.findWalkableInRoom(room);
    this.player.reset(position.x, position.y);
    this.player.data.hp = restoredHp;
    this.currentRoomId = room.id;
    // Visual: rooms surveyed before the checkpoint are drawn immediately (no pulse).
    for (const id of new Set([...run.clearedRooms, room.id])) this.renderer?.observeRoom(id, 0, 0, true);
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
