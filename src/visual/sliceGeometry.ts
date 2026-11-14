// Read-only room geometry for the art layer, built from the SAME tables the
// rules use. The art layer never defines its own walkable area. Pure (no Phaser).
import { isDoorCell, isStaticWallCell, ROOM } from '../slice/room';
import { CORRIDOR, corridorTile } from '../slice/corridorRoom';
import type { RoomGeometry, TileKind } from './EnvironmentBaker';
import type { RoomId } from './themes';

export const LAB_GEOMETRY: RoomGeometry = {
  width: ROOM.width,
  height: ROOM.height,
  tileAt: (x, y): TileKind => (isDoorCell(x, y) ? 'door' : isStaticWallCell(x, y) ? 'wall' : 'floor'),
};

export const CORRIDOR_GEOMETRY: RoomGeometry = {
  width: CORRIDOR.width,
  height: CORRIDOR.height,
  tileAt: (x, y): TileKind => corridorTile(x, y),
};

export function sliceGeometry(room: RoomId): RoomGeometry {
  return room === 'corridor' ? CORRIDOR_GEOMETRY : LAB_GEOMETRY;
}
