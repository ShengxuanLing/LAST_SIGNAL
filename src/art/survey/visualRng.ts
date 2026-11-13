// Visual-only RNG (03 §10). Derived from (map seed, room id, salt) and NEVER from
// World.rng or Math.random, so decoration, wear and stencils can never shift loot,
// crit, spawn picks or the checkpoint rngState. Pure: unit-tested in node.
import { RNG } from '../../core/random';

/** FNV-1a over the salt, folded with seed and room id. */
export function visualSeed(mapSeed: number, roomId: number, salt = 'VIS'): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => { h ^= v & 0xff; h = Math.imul(h, 0x01000193) >>> 0; };
  for (let i = 0; i < salt.length; i++) mix(salt.charCodeAt(i));
  for (const v of [mapSeed >>> 0, (roomId + 0x9e37) >>> 0]) {
    mix(v); mix(v >>> 8); mix(v >>> 16); mix(v >>> 24);
  }
  return h >>> 0;
}

export function visualRng(mapSeed: number, roomId: number, salt = 'VIS'): RNG {
  return new RNG(visualSeed(mapSeed, roomId, salt));
}

/** Stable 0..1 hash for per-tile wear without allocating an RNG per tile. */
export function tileNoise(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ (seed >>> 0);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
