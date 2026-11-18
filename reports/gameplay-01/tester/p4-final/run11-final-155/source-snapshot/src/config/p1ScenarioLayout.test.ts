// GAMEPLAY-01 P4 — review F1: the authored builder must be ALL-OR-NOTHING.
//
// The reviewer constructed a room that can only host one walkable cell: the
// builder returned `null` (correct) but had already written the two
// `connectedTo` edges and `kind = 'combat'` (wrong). The rendered World keeps
// that map when `setupP1Scenario()` reports failure, so the start room silently
// became an unspawned/uncleared combat room and the room graph changed.
//
// Contract under test: a `null` result leaves the map EXACTLY as it was, and a
// successful result commits the authored mutations in one step.
import { describe, expect, it } from 'vitest';
import { buildP1Scenario, type P1BuildContext } from './p1Scenario';
import type { MapData, Room, Vec2 } from '../types';

function grid(size: number, type: 'floor' | 'wall'): MapData['tiles'] {
  const tiles: MapData['tiles'] = [];
  for (let y = 0; y < size; y += 1) {
    const row: MapData['tiles'][number] = [];
    for (let x = 0; x < size; x += 1) row.push({ x, y, type, height: 0 });
    tiles.push(row);
  }
  return tiles;
}

function room(id: number, kind: Room['kind'], gx: number, gy: number, w: number, h: number, connectedTo: number[]): Room {
  return { id, kind, gx, gy, w, h, connectedTo: [...connectedTo], cleared: false, spawned: false };
}

function mapWith(rooms: Room[], tiles: MapData['tiles']): MapData {
  return { seed: 20261117, width: tiles[0].length, height: tiles.length, tiles, rooms, doorways: [], roomsOrder: rooms.map((r) => r.id) };
}

/** Exact byte-level snapshot of the mutable room graph. */
function graphBytes(map: MapData): string {
  return JSON.stringify(map.rooms.map((r) => ({
    id: r.id, kind: r.kind, connectedTo: [...r.connectedTo], cleared: r.cleared, spawned: r.spawned,
    gx: r.gx, gy: r.gy, w: r.w, h: r.h
  })));
}

const oneCell = (only: Vec2): P1BuildContext['isWalkable'] => (x, y) => x === only.x && y === only.y;

/** Two route targets, authored room only wide enough for ONE walkable cell. */
function oneWalkableCellMap(): MapData {
  const tiles = grid(8, 'wall');
  const rooms = [
    room(0, 'start', 0, 0, 3, 3, [1]),
    room(1, 'combat', 4, 0, 3, 3, [0]),
    room(2, 'resource', 4, 4, 3, 3, [0])
  ];
  return mapWith(rooms, tiles);
}

/** Two route targets, authored room completely unwalkable. */
function noWalkableCellMap(): MapData {
  const tiles = grid(8, 'wall');
  const rooms = [
    room(0, 'start', 0, 0, 3, 3, [1]),
    room(1, 'combat', 4, 0, 3, 3, [0]),
    room(2, 'resource', 4, 4, 3, 3, [0])
  ];
  return mapWith(rooms, tiles);
}

describe('P4 F1 — a null layout never mutates the map', () => {
  it('single-walkable-cell room: returns null and leaves kind/connectedTo untouched', () => {
    const map = oneWalkableCellMap();
    const before = graphBytes(map);
    const beforeRoom0 = { kind: map.rooms[0].kind, connectedTo: [...map.rooms[0].connectedTo] };

    const scenario = buildP1Scenario({ map, isWalkable: oneCell({ x: 1.5, y: 1.5 }) });

    expect(scenario).toBeNull();
    expect(graphBytes(map), 'map bytes must be identical after a failed build').toBe(before);
    expect(map.rooms[0].kind).toBe('start');
    expect(map.rooms[0].connectedTo).toEqual(beforeRoom0.connectedTo);
  });

  it('completely unwalkable room: returns null and leaves kind/connectedTo untouched', () => {
    const map = noWalkableCellMap();
    const before = graphBytes(map);

    const scenario = buildP1Scenario({ map, isWalkable: () => false });

    expect(scenario).toBeNull();
    expect(graphBytes(map)).toBe(before);
  });

  it('too few route targets: returns null and leaves the map untouched', () => {
    const tiles = grid(4, 'floor');
    const map = mapWith([room(0, 'start', 0, 0, 3, 3, [])], tiles);
    const before = graphBytes(map);

    expect(buildP1Scenario({ map, isWalkable: () => true })).toBeNull();
    expect(graphBytes(map)).toBe(before);
  });

  it('a device cell that cannot avoid the player start fails without mutation', () => {
    // Exactly two walkable cells, one grid step apart: the route pair itself is
    // too close, so the build must fail and must not have touched the graph.
    const map = oneWalkableCellMap();
    const before = graphBytes(map);
    const cells = new Set(['1.5,1.5', '1.5,2.5']);
    const walkable = (x: number, y: number): boolean => cells.has(`${x},${y}`);

    const scenario = buildP1Scenario({ map, isWalkable: walkable });

    expect(scenario).toBeNull();
    expect(graphBytes(map)).toBe(before);
  });
});

describe('P4 F1 — a successful layout commits the authored mutations once', () => {
  it('commits kind + both graph edges on success, and only then', () => {
    const map = mapWith(
      [room(0, 'start', 0, 0, 6, 6, [1]), room(1, 'combat', 6, 0, 4, 4, [0]), room(2, 'resource', 6, 6, 4, 4, [0])],
      grid(12, 'floor')
    );
    const before = graphBytes(map);
    const scenario = buildP1Scenario({ map, isWalkable: () => true });

    expect(scenario).not.toBeNull();
    // Before the call the room graph was untouched.
    expect(before).not.toBe(graphBytes(map));
    expect(map.rooms[scenario!.roomId].kind).toBe('combat');
    const a = scenario!.routes[0].target;
    const b = scenario!.routes[1].target;
    expect(map.rooms[0].connectedTo).toContain(a);
    expect(map.rooms[0].connectedTo).toContain(b);
    expect(map.rooms[a].connectedTo).toContain(0);
    expect(map.rooms[b].connectedTo).toContain(0);
    // No duplicate edge was appended.
    expect(new Set(map.rooms[0].connectedTo).size).toBe(map.rooms[0].connectedTo.length);
    expect(new Set(map.rooms[a].connectedTo).size).toBe(map.rooms[a].connectedTo.length);
  });

  it('does not duplicate edges that already exist in both directions', () => {
    const map = mapWith(
      [room(0, 'start', 0, 0, 6, 6, [1, 2]), room(1, 'combat', 6, 0, 4, 4, [0]), room(2, 'resource', 6, 6, 4, 4, [0])],
      grid(12, 'floor')
    );
    const scenario = buildP1Scenario({ map, isWalkable: () => true });
    expect(scenario).not.toBeNull();
    for (const route of scenario!.routes) {
      expect(map.rooms[0].connectedTo.filter((id) => id === route.target)).toHaveLength(1);
      expect(map.rooms[route.target].connectedTo.filter((id) => id === 0)).toHaveLength(1);
    }
  });
});
