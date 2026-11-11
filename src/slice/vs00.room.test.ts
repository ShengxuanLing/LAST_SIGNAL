import { describe, it, expect } from 'vitest';
import { ROOM, isOccupyingDoor, hasLineOfSight } from './room';

// VS-00 room geometry regressions. These intentionally pin the *intended* geometry
// (AABB door occupancy + wall-clipped LOS), not merely the current helper output.
describe('VS-00 fixed room geometry', () => {
  it('door occupancy uses the same AABB footprint as movement (door corners count)', () => {
    // Dead centre of the door opening.
    expect(isOccupyingDoor(ROOM.receiver.x, ROOM.receiver.y)).toBe(true);
    // Door-corner overlap: inside the expanded AABB of door cell (7,5) but outside
    // the old circle approximation (distance 0.860 > 0.5 + 0.35 = 0.85).
    // A circle test would report "not occupying" here and the door could clamp the body.
    expect(isOccupyingDoor(6.8, 5.0)).toBe(true);
    expect(isOccupyingDoor(8.2, 5.0)).toBe(true);
    // Clearly outside the doorway.
    expect(isOccupyingDoor(ROOM.spawn.x, ROOM.spawn.y)).toBe(false);
    expect(isOccupyingDoor(9.2, 5.0)).toBe(false);
  });

  it('LOS is clipped by static walls and the allow cell exempts the embedded source', () => {
    // A straight segment through partition cell (7,2) is blocked.
    expect(hasLineOfSight(6.5, 2.5, 8.5, 2.5)).toBe(false);
    // The same segment is allowed when that cell is the embedded source cell.
    expect(hasLineOfSight(3.5, 2.0, 7.5, 2.0, { x: 7, y: 2 })).toBe(true);
    // Dynamic door cells are not static walls, so the receiver stays visible.
    expect(hasLineOfSight(ROOM.spawn.x, ROOM.spawn.y, ROOM.receiver.x, ROOM.receiver.y)).toBe(true);
  });

  it('blocks LOS through a cell corner when a side cell is a static wall', () => {
    // The segment passes exactly through corner (7,3). The (7,3) endpoint cell is
    // allowed as the embedded source cell, but the adjacent (7,2) static wall must
    // still block: a ray sampled only along its centre line would thread the corner.
    expect(hasLineOfSight(6.5, 2.5, 7.5, 3.5, { x: 7, y: 3 })).toBe(false);
  });
});
