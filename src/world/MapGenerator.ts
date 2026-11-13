// Deterministic procedural map generator.
// Strategy: place axis-aligned rooms on a coarse grid (no overlap), connect them
// into a spanning tree via greedy nearest-neighbour (guarantees reachability),
// add a few extra edges for loops, then carve L-shaped corridors. Walls fill the rest.
// No softlocks by construction: every room is reachable from the start.
import { RNG } from '../core/random';
import { MapData, Room, Tile, TileType } from '../types';
import { GAME } from '../config/game';
import { dungeonRng, hasSectorBoss } from '../config/dungeon';

export class MapGenerator {
  private rng: RNG;
  private CELL_STEP = 0;

  constructor(private seed: number, private deck?: number) {
    this.rng = deck === undefined ? new RNG(seed) : dungeonRng(seed);
  }

  reseed(seed: number): void {
    this.seed = seed;
    this.rng = this.deck === undefined ? new RNG(seed) : dungeonRng(seed);
  }

  generate(): MapData {
    const roomCount = this.deck === undefined
      ? this.rng.int(GAME.MAP_MIN_ROOMS, GAME.MAP_MAX_ROOMS)
      : this.rng.int(5, 6);
    const rooms = this._placeRooms(roomCount);
    const order = this._greedySpanningBfs(rooms);
    if (this.deck === undefined) assignRoles(this, rooms, order);
    else this.assignSectorRooms(rooms, order, this.deck);
    const floorCells = this._carveCorridors(rooms);
    if (this.deck !== undefined) this.addCover(rooms, floorCells, this.deck);
    const { tiles, doorways } = this._buildTiles(rooms, floorCells);
    return {
      seed: this.seed,
      deck: this.deck,
      width: tiles[0].length,
      height: tiles.length,
      tiles,
      rooms,
      doorways,
      roomsOrder: order
    };
  }

  private assignSectorRooms(rooms: Room[], order: number[], deck: number): void {
    rooms[0].kind = 'start';
    const end = rooms[order[order.length - 1]];
    end.kind = hasSectorBoss(deck) ? 'boss' : 'extraction';
    const interior = this.rng.shuffle(order.slice(1, -1));
    rooms[interior[0]].kind = 'resource';
    rooms[interior[1]].kind = 'elite';
    // The route toward other rooms never needs to cross the sector exit.
    const pathNeighbor = order[order.length - 2];
    for (const id of end.connectedTo) {
      if (id !== pathNeighbor) rooms[id].connectedTo = rooms[id].connectedTo.filter((neighbor) => neighbor !== end.id);
    }
    end.connectedTo = [pathNeighbor];
  }

  private addCover(rooms: Room[], floor: Set<string>, deck: number): void {
    for (const room of rooms) {
      if (room.kind !== 'combat' && room.kind !== 'elite') continue;
      const offset = this.rng.pick([2, room.w - 3]);
      const x = room.gx + offset;
      const y = room.gy + 2;
      floor.delete(`${x},${y}`);
      if (deck >= 2) floor.delete(`${x},${y + 1}`);
      if (deck >= 4) floor.delete(`${room.gx + room.w - offset - 1},${room.gy + room.h - 3}`);
    }
  }

  private _placeRooms(count: number): Room[] {
    const sector = this.deck !== undefined;
    const maxSize = sector ? 11 : GAME.ROOM_MAX;
    const step = maxSize + 4;
    this.CELL_STEP = step;
    const placed: Room[] = [];
    const used = new Set<string>();
    let guard = 0;
    while (placed.length < count && guard < count * 10) {
      guard++;
      const cx = this.rng.int(0, sector ? 4 : 12);
      const cy = this.rng.int(0, sector ? 3 : 9);
      const key = `${cx},${cy}`;
      if (used.has(key)) continue;
      const w = this.rng.int(GAME.ROOM_MIN, maxSize);
      const h = this.rng.int(GAME.ROOM_MIN, maxSize);
      const originX = cx * step + this.rng.int(1, Math.max(1, step - w - 2));
      const originY = cy * step + this.rng.int(1, Math.max(1, step - h - 2));
      let overlap = false;
      for (const p of placed) {
        const okx = originX < p.gx + p.w + 1 && originX + w + 1 > p.gx;
        const oky = originY < p.gy + p.h + 1 && originY + h + 1 > p.gy;
        if (okx && oky) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;
      used.add(key);
      placed.push({
        id: placed.length, kind: 'combat', gx: originX, gy: originY, w, h,
        connectedTo: [], cleared: false, spawned: false
      });
    }
    if (placed.length === 0) {
      placed.push({
        id: 0, kind: 'combat', gx: 2, gy: 2, w: GAME.ROOM_MIN, h: GAME.ROOM_MIN,
        connectedTo: [], cleared: false, spawned: false
      });
    }
    return placed;
  }

  private _greedySpanningBfs(rooms: Room[]): number[] {
    const n = rooms.length;
    const visited = new Set<number>();
    const order: number[] = [];
    const active = new Set(rooms.map((_, i) => i));
    active.delete(0);
    let current = 0;
    while (active.size) {
      let best = -1, bestD = Infinity;
      for (const i of active) {
        const dx = rooms[i].gx - rooms[current].gx;
        const dy = rooms[i].gy - rooms[current].gy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
      rooms[current].connectedTo.push(best);
      rooms[best].connectedTo.push(current);
      active.delete(best);
      current = best;
    }
    // BFS over the tree => reachable ordering.
    const queue = [0];
    visited.add(0);
    while (queue.length) {
      const cur = queue.shift()!;
      order.push(cur);
      for (const nb of rooms[cur].connectedTo) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    // Extra edges for loops, avoiding duplicates.
    const extra = Math.max(0, n - 3);
    let guard = 0, added = 0;
    while (added < extra && guard < n * n) {
      guard++;
      const a = this.rng.int(0, n - 1);
      const b = this.rng.int(0, n - 1);
      if (a === b || rooms[a].connectedTo.includes(b)) continue;
      rooms[a].connectedTo.push(b);
      rooms[b].connectedTo.push(a);
      added++;
    }
    return order;
  }

  private _carveCorridors(rooms: Room[]): Set<string> {
    const floor = new Set<string>();
    const key = (gx: number, gy: number) => `${gx},${gy}`;
    for (const r of rooms) {
      for (let gy = r.gy; gy < r.gy + r.h; gy++) {
        for (let gx = r.gx; gx < r.gx + r.w; gx++) {
          floor.add(key(gx, gy));
        }
      }
    }
    const processed = new Set<string>();
    for (const r of rooms) {
      for (const nb of r.connectedTo) {
        const k = `${r.id}->${nb}`;
        if (processed.has(k)) continue;
        processed.add(k);
        const ra = rooms[r.id], rb = rooms[nb];
        const ax = Math.floor(ra.gx + ra.w / 2);
        const ay = Math.floor(ra.gy + ra.h / 2);
        const bx = Math.floor(rb.gx + rb.w / 2);
        const by = Math.floor(rb.gy + rb.h / 2);
        const sx = Math.min(ax, bx), ex = Math.max(ax, bx);
        const sy = Math.min(ay, by), ey = Math.max(ay, by);
        const halfWidth = this.deck === undefined ? 0 : 1;
        for (let offset = -halfWidth; offset <= halfWidth; offset++) {
          for (let x = sx; x <= ex; x++) floor.add(key(x, ay + offset));
          for (let y = sy; y <= ey; y++) floor.add(key(bx + offset, y));
        }
      }
    }
    return floor;
  }

  private _buildTiles(rooms: Room[], floor: Set<string>): { tiles: Tile[][]; doorways: Array<{ x: number; y: number }> } {
    const key = (gx: number, gy: number) => `${gx},${gy}`;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const k of floor) {
      const [gx, gy] = k.split(',').map(Number);
      minX = Math.min(minX, gx); minY = Math.min(minY, gy);
      maxX = Math.max(maxX, gx); maxY = Math.max(maxY, gy);
    }
    const pad = 2;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const W = maxX - minX + 1;
    const H = maxY - minY + 1;
    const tiles: Tile[][] = [];
    const doorways: Array<{ x: number; y: number }> = [];
    for (let gy = 0; gy < H; gy++) {
      const row: Tile[] = [];
      for (let gx = 0; gx < W; gx++) {
        const worldX = minX + gx;
        const worldY = minY + gy;
        const type: TileType = floor.has(key(worldX, worldY)) ? 'floor' : 'wall';
        row.push({ x: worldX, y: worldY, type, height: 0 });
      }
      tiles.push(row);
    }
    const inRoom = (gx: number, gy: number): boolean =>
      rooms.some((r) => gx >= r.gx && gx < r.gx + r.w && gy >= r.gy && gy < r.gy + r.h);
    for (const r of rooms) {
      const candidates = [
        { x: r.gx - 1, y: Math.floor(r.gy + r.h / 2) },
        { x: r.gx + r.w, y: Math.floor(r.gy + r.h / 2) },
        { x: Math.floor(r.gx + r.w / 2), y: r.gy - 1 },
        { x: Math.floor(r.gx + r.w / 2), y: r.gy + r.h }
      ];
      for (const c of candidates) {
        if (floor.has(key(c.x, c.y)) && !inRoom(c.x, c.y)) {
          doorways.push({ x: c.x, y: c.y });
        }
      }
    }
    if (rooms.length) {
      const start = rooms[0];
      const lx = Math.floor(start.gx + start.w / 2) - minX;
      const ly = Math.floor(start.gy + start.h / 2) - minY;
      if (lx >= 0 && lx < W && ly >= 0 && ly < H) tiles[ly][lx].type = 'spawn';
    }
    return { tiles, doorways };
  }
}

// Deterministically assign special room roles based on BFS depth from start.
export function assignRoles(_gen: MapGenerator, rooms: Room[], _order: number[]): void {
  if (rooms.length <= 1) {
    if (rooms[0]) rooms[0].kind = 'start';
    return;
  }
  const depth = roomDepth({ rooms, seed: 0, width: 0, height: 0, tiles: [], doorways: [], roomsOrder: [] });
  const byDepth = [...rooms].sort((a, b) => depth.get(a.id)! - depth.get(b.id)!);
  byDepth[0].kind = 'start';
  const boss = byDepth[byDepth.length - 1];
  boss.kind = 'boss';
  boss.w = Math.max(boss.w, 13);
  boss.h = Math.max(boss.h, 11);
  const mid = byDepth[Math.floor(byDepth.length / 2)];
  if (mid) mid.kind = 'elite';
  for (const r of byDepth.slice(1, -1)) {
    if (r.kind === 'combat') {
      // Deterministic hash of room id + depth drives role roll.
      const h = (r.id * 2654435761 + depth.get(r.id)! * 40503) >>> 0;
      const roll = (h % 100) / 100;
      if (roll < 0.35) r.kind = 'resource';
      else if (roll < 0.5) r.kind = 'shop';
      else if (roll < 0.62) r.kind = 'event';
    }
  }
}

export function roomDepth(map: MapData, startId = 0): Map<number, number> {
  const depth = new Map<number, number>();
  depth.set(startId, 0);
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    for (const nb of map.rooms[cur].connectedTo) {
      if (!depth.has(nb)) {
        depth.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }
  return depth;
}

export function guaranteeReachable(map: MapData, startId = 0): boolean {
  const depth = roomDepth(map, startId);
  return depth.size === map.rooms.length;
}
