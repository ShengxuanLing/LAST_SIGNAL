// Reviewer-only P4 v4 probe: how often does the legacy "centre-qualifying cell"
// predicate fail for a room (i.e. when does findWalkableCentreInRoom fall back)?
import { describe, expect, it } from 'vitest';
import { generateRealMap } from '../ai-native/worldHeadless';
import { createSimulationState, isWalkableFromState } from '../world/sim/core';

const SEEDS = [20261117, 20261118, 20261119, 1, 42, 424242, 777, 20260101, 555, 99999];
const rows: any[] = [];

describe('P4 v4 portal-centre probe', () => {
  it('counts rooms without any centre-qualifying cell (fallback reachability)', () => {
    for (const seed of SEEDS) {
      const map = generateRealMap(seed);
      const sim = createSimulationState({ seed, map, playerData: { hp: 100, maxHp: 100 } as any, playerX: 0, playerY: 0 });
      let rooms = 0, failing = 0;
      const failingIds: number[] = [];
      for (const r of map.rooms) {
        rooms += 1;
        let ok = 0;
        for (let y = r.gy; y < r.gy + r.h; y += 1) {
          for (let x = r.gx; x < r.gx + r.w; x += 1) {
            if (isWalkableFromState(sim, x + 0.5, y + 0.5, 0.5)) ok += 1;
          }
        }
        if (ok === 0) { failing += 1; failingIds.push(r.id); }
      }
      rows.push({ seed, rooms, roomsWithoutCentre: failing, failingIds });
    }
    console.log('P4V4_PROBE ' + JSON.stringify(rows));
    expect(rows.length).toBe(SEEDS.length);
  });
});
