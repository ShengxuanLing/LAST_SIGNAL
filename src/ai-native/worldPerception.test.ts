// AI-NATIVE-02 P1 fix — bounded grid perception unit tests (F-01/F-02).

import { describe, expect, it } from 'vitest';
import {
  WORLD_PERCEPTION,
  createLocalProbe,
  gridLineOfSight
} from './worldPerception';

const center = { x: 0, y: 0 };
const exploredAll = () => true;

describe('gridLineOfSight (bounded, camera-free)', () => {
  it('accepts a close, explored, unobstructed target', () => {
    expect(gridLineOfSight({ x: 3, y: 0 }, {
      center, radiusTiles: WORLD_PERCEPTION.radiusTiles,
      isExplored: exploredAll, isOpaque: () => false
    })).toBe(true);
  });

  it('rejects targets beyond the perception radius', () => {
    expect(gridLineOfSight({ x: 60, y: 60 }, {
      center, radiusTiles: WORLD_PERCEPTION.radiusTiles,
      isExplored: exploredAll, isOpaque: () => false
    })).toBe(false);
  });

  it('rejects targets behind a wall', () => {
    expect(gridLineOfSight({ x: 4, y: 0 }, {
      center, radiusTiles: WORLD_PERCEPTION.radiusTiles,
      isExplored: exploredAll,
      isOpaque: (x, y) => Math.floor(x) === 2 && Math.floor(y) === 0
    })).toBe(false);
  });

  it('rejects targets in unentered (unexplored) rooms', () => {
    expect(gridLineOfSight({ x: 4, y: 0 }, {
      center, radiusTiles: WORLD_PERCEPTION.radiusTiles,
      isExplored: (x) => x < 3,
      isOpaque: () => false
    })).toBe(false);
  });

  it('rejects non-finite coordinates and a non-finite center', () => {
    const opts = {
      radiusTiles: WORLD_PERCEPTION.radiusTiles,
      isExplored: exploredAll, isOpaque: () => false
    };
    expect(gridLineOfSight({ x: NaN, y: 0 }, { ...opts, center })).toBe(false);
    expect(gridLineOfSight({ x: Infinity, y: 0 }, { ...opts, center })).toBe(false);
    expect(gridLineOfSight({ x: 1, y: 1 }, { ...opts, center: { x: NaN, y: 0 } })).toBe(false);
  });
});

describe('createLocalProbe (no full-map oracle)', () => {
  it('answers only short-range, finite, explored positions', () => {
    let calls = 0;
    const probe = createLocalProbe({
      center,
      probeRadiusTiles: WORLD_PERCEPTION.probeRadiusTiles,
      isExplored: (x, y) => x < 8 && y < 8,
      isWalkable: (x, y) => { calls++; return !(x < 0 && y === 0); }
    });
    expect(probe(0.45, 0)).toBe(true);
    expect(probe(-0.45, 0)).toBe(false);
    expect(probe(0.45, 9)).toBe(false); // unexplored
    expect(calls).toBe(2);
  });

  it('uniformly rejects far floor, far wall and non-finite probes without terrain lookups', () => {
    let calls = 0;
    const probe = createLocalProbe({
      center,
      probeRadiusTiles: WORLD_PERCEPTION.probeRadiusTiles,
      isExplored: exploredAll,
      isWalkable: () => { calls++; return true; }
    });
    const farFloor = probe(141, 141);   // real terrain would be walkable floor
    const farWall = probe(142, 141);    // real terrain would be a wall
    expect(farFloor).toBe(false);
    expect(farWall).toBe(false);
    expect(farFloor).toBe(farWall);     // no real terrain bit leaks
    expect(probe(NaN, 0)).toBe(false);
    expect(probe(Infinity, 0)).toBe(false);
    expect(probe(0, -Infinity)).toBe(false);
    expect(calls).toBe(0);              // rejected before isWalkable was called
  });

  it('keeps the probe radius strictly smaller than the perception radius', () => {
    expect(WORLD_PERCEPTION.probeRadiusTiles).toBeLessThan(WORLD_PERCEPTION.radiusTiles);
  });
});
