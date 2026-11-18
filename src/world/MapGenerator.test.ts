import { describe, expect, it } from 'vitest';
import { MapGenerator, guaranteeReachable } from './MapGenerator';

describe('seeded maps', () => {
  it('generates distinct connected layouts and replays a seed after reseeding', () => {
    const generator = new MapGenerator(1);
    const layouts = new Set<string>();
    for (let seed = 0; seed < 32; seed++) {
      generator.reseed(seed);
      const map = generator.generate();
      expect(map.seed).toBe(seed);
      expect(map.mapVersion).toBe(2);
      expect(guaranteeReachable(map)).toBe(true);
      layouts.add(JSON.stringify(map.rooms));
    }
    expect(layouts.size).toBe(32);
    generator.reseed(1);
    expect(generator.generate().rooms).toEqual(new MapGenerator(1).generate().rooms);
  });

  it('reconstructs the room geometry referenced by original checkpoints', () => {
    const map = new MapGenerator(424242, 1).generate();
    expect(map.mapVersion).toBe(1);
    expect(map.rooms.map(r => [r.gx, r.gy, r.w, r.h, r.kind])).toEqual([
      [4, 40, 9, 11, 'start'], [145, 79, 12, 9, 'combat'],
      [93, 128, 12, 13, 'resource'], [19, 41, 13, 10, 'combat'],
      [199, 95, 13, 11, 'boss'], [111, 39, 8, 10, 'elite']
    ]);
  });
});
