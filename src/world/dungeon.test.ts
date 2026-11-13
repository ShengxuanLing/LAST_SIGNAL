import { describe, expect, it } from 'vitest';
import { deckLabel, deckSeed, encounter, hasSectorBoss, sectorFor, TOTAL_DECKS } from '../config/dungeon';
import { guaranteeReachable, MapGenerator } from './MapGenerator';

describe('sector dungeon', () => {
  it('generates reachable maps with the right exit and at least one combat room', () => {
    for (let deck = 0; deck < TOTAL_DECKS; deck++) {
      for (let seed = 0; seed < 40; seed++) {
        const map = new MapGenerator(deckSeed(seed, deck), deck).generate();
        expect(guaranteeReachable(map)).toBe(true);
        const exit = map.rooms.filter(({ kind }) => kind === 'boss' || kind === 'extraction');
        expect(exit).toHaveLength(1);
        expect(exit[0].kind).toBe(hasSectorBoss(deck) ? 'boss' : 'extraction');
        expect(exit[0].connectedTo).toHaveLength(1);
        expect(map.rooms.filter(({ kind }) => kind === 'resource')).toHaveLength(1);
        const combat = map.rooms.filter(({ kind }) => kind === 'combat');
        expect(combat.length).toBeGreaterThan(0);
        for (const room of combat) {
          expect(map.tiles.flat().some((tile) => tile.type === 'wall' &&
            tile.x >= room.gx + 2 && tile.x < room.gx + room.w - 2 &&
            tile.y >= room.gy + 2 && tile.y < room.gy + room.h - 2)).toBe(true);
        }
      }
    }
  });

  it('varies layouts and waves with the seed and only draws from the local sector pool', () => {
    const map = (seed: number) => new MapGenerator(deckSeed(seed, 0), 0).generate().rooms;
    expect(map(52)).toEqual(map(52));
    expect(map(52)).not.toEqual(map(97));
    expect(deckLabel(2)).toBe('2-1 · CRYO VAULT');
    for (let deck = 0; deck < TOTAL_DECKS; deck++) {
      const allowed = new Set<string>(sectorFor(deck).enemies.map(({ item }) => item));
      const waves = encounter(deckSeed(42, deck), deck, 1, 'elite');
      expect(waves).toHaveLength(2);
      expect(waves).toEqual(encounter(deckSeed(42, deck), deck, 1, 'elite'));
      expect(waves.flat().every((kind) => allowed.has(kind))).toBe(true);
      expect(encounter(deckSeed(42, deck), deck, 1, 'resource')).toEqual([]);
      const samples = new Set(Array.from({ length: 24 }, (_, seed) =>
        JSON.stringify(encounter(deckSeed(seed, deck), deck, 1, 'elite'))));
      expect(samples.size).toBeGreaterThan(1);
    }
  });
});
