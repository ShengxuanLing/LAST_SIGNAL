import { RNG } from '../core/random';
import type { EnemyKind, RoomKind } from '../types';

export const DECKS_PER_SECTOR = 2;

export const SECTORS = [
  {
    name: 'RELAY YARD', brief: 'An abandoned relay grid still running its quarantine patrols.',
    floor: ['#0e2330', '#163746'], wall: ['#0a151d', '#193442', '#245061'],
    accent: '65,206,246', color: 0x41cef6,
    enemies: [{ item: 'drone', weight: 5 }, { item: 'stalker', weight: 4 }, { item: 'sentry', weight: 3 }],
    boss: { name: 'GATEKEEPER', hp: 550, pattern: 'ring', texture: 'enemy_sentry', summon: 'drone' }
  },
  {
    name: 'CRYO VAULT', brief: 'Thawing containment cells have released the station’s test units.',
    floor: ['#14233c', '#23375d'], wall: ['#0c1225', '#1f2a4a', '#3e5279'],
    accent: '148,176,255', color: 0x94b0ff,
    enemies: [{ item: 'hunter', weight: 4 }, { item: 'shiver', weight: 5 }, { item: 'sentinel', weight: 2 }],
    boss: { name: 'CRYO ARRAY', hp: 850, pattern: 'fan', texture: 'enemy_shiver', summon: 'shiver' }
  },
  {
    name: 'FURNACE CORE', brief: 'The runaway reactor has turned its maintenance machines into guards.',
    floor: ['#2e191e', '#4a2528'], wall: ['#170e15', '#382127', '#673b39'],
    accent: '250,137,103', color: 0xfa8967,
    enemies: [{ item: 'sentinel', weight: 3 }, { item: 'slag', weight: 5 }, { item: 'stalker', weight: 2 }],
    boss: { name: 'THE WARDEN', hp: 1400, pattern: 'mixed', texture: 'enemy_slag', summon: 'slag' }
  }
] as const satisfies readonly {
  name: string; brief: string; floor: readonly [string, string]; wall: readonly [string, string, string];
  accent: string; color: number;
  enemies: readonly { item: EnemyKind; weight: number }[];
  boss: { name: string; hp: number; pattern: 'ring' | 'fan' | 'mixed'; texture: string; summon: EnemyKind };
}[];

export const TOTAL_DECKS = SECTORS.length * DECKS_PER_SECTOR;

export function sectorFor(deck: number) {
  return SECTORS[Math.floor(deck / DECKS_PER_SECTOR)];
}

export function hasSectorBoss(deck: number): boolean {
  return (deck + 1) % DECKS_PER_SECTOR === 0;
}

export function deckLabel(deck: number): string {
  return `${Math.floor(deck / DECKS_PER_SECTOR) + 1}-${deck % DECKS_PER_SECTOR + 1} · ${sectorFor(deck).name}`;
}

export function deckSeed(seed: number, deck: number): number {
  // An odd multiplier gives each deck a distinct 32-bit input for the same run.
  return (seed ^ Math.imul(deck + 1, 0x9e3779b9)) >>> 0;
}

export function dungeonRng(seed: number): RNG {
  // The legacy RNG hashes seeds using floating-point multiplication. Mix in
  // uint32 arithmetic here so nearby seeds stay distinct on the new maps.
  let state = Math.imul(seed ^ (seed >>> 16), 0x7feb352d);
  state = Math.imul(state ^ (state >>> 15), 0x846ca68b);
  const rng = new RNG(0);
  rng.restore(state ^ (state >>> 16));
  return rng;
}

export function encounter(seed: number, deck: number, roomId: number, kind: RoomKind) {
  const rng = dungeonRng(seed ^ Math.imul(roomId + 1, 0x85ebca6b));
  const elite = kind === 'elite';
  const count = kind !== 'elite' && kind !== 'combat' ? 0 : elite || deck > 0 ? 2 : 1;
  const pool = [...sectorFor(deck).enemies];
  return Array.from({ length: count }, () =>
    Array.from({ length: rng.int(elite ? 2 : 1, elite ? 4 : 3) }, () => rng.pickWeighted<EnemyKind>(pool)));
}
