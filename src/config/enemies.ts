// Data-driven enemy configuration.
import { EnemyKind, EnemyStats } from '../types';
export type { EnemyKind } from '../types';
import { clamp } from '../core/random';

export interface EnemyTier {
  kind: EnemyKind;
  weight: number;
  minDepth: number;
  maxDepth: number;
}

export const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  drone: {
    maxHp: 24,
    speed: 90,
    damage: 6,
    armor: 0,
    aggroRange: 340,
    attackRange: 200,
    attackCooldown: 1.4,
    xpValue: 8,
    currencyValue: 3,
    reachEnemy: false,
    ranged: true
  },
  stalker: {
    maxHp: 40,
    speed: 200,
    damage: 12,
    armor: 2,
    aggroRange: 300,
    attackRange: 46,
    attackCooldown: 0.9,
    xpValue: 12,
    currencyValue: 4,
    reachEnemy: true,
    ranged: false
  },
  sentinel: {
    maxHp: 120,
    speed: 60,
    damage: 16,
    armor: 8,
    aggroRange: 240,
    attackRange: 130,
    attackCooldown: 2.2,
    xpValue: 24,
    currencyValue: 8,
    reachEnemy: true,
    ranged: false
  },
  hunter: {
    maxHp: 52,
    speed: 130,
    damage: 10,
    armor: 1,
    aggroRange: 420,
    attackRange: 220,
    attackCooldown: 1.8,
    xpValue: 18,
    currencyValue: 6,
    reachEnemy: false,
    ranged: true
  },
  sentry: {
    maxHp: 36, speed: 54, damage: 5, armor: 1, aggroRange: 440,
    attackRange: 320, attackCooldown: 1.6, xpValue: 10, currencyValue: 4,
    reachEnemy: false, ranged: true
  },
  shiver: {
    maxHp: 46, speed: 220, damage: 9, armor: 1, aggroRange: 430,
    attackRange: 140, attackCooldown: 1.6, xpValue: 15, currencyValue: 5,
    reachEnemy: false, ranged: true
  },
  slag: {
    maxHp: 76, speed: 164, damage: 14, armor: 5, aggroRange: 460,
    attackRange: 70, attackCooldown: 1.1, xpValue: 18, currencyValue: 6,
    reachEnemy: true, ranged: false
  },
  boss_warden: {
    maxHp: 2400,
    speed: 110,
    damage: 34,
    armor: 12,
    aggroRange: 99999,
    attackRange: 200,
    attackCooldown: 1.6,
    xpValue: 200,
    currencyValue: 120,
    reachEnemy: true,
    ranged: true
  }
};

// Weights scale with room "depth" (distance from start along the map).
export const ENEMY_TIERS: EnemyTier[] = [
  { kind: 'drone', weight: 30, minDepth: 0, maxDepth: 99 },
  { kind: 'stalker', weight: 22, minDepth: 0, maxDepth: 99 },
  { kind: 'hunter', weight: 14, minDepth: 1, maxDepth: 99 },
  { kind: 'sentinel', weight: 12, minDepth: 3, maxDepth: 99 }
];

export function pickEnemyKind(rng: { float: () => number; int: (a: number, b: number) => number }, depth: number): EnemyKind {
  // deterministic weighted pick
  const pool = ENEMY_TIERS.filter((t) => depth >= t.minDepth && depth <= t.maxDepth);
  const total = pool.reduce((s, t) => s + t.weight, 0);
  let r = rng.float() * total;
  for (const t of pool) {
    r -= t.weight;
    if (r <= 0) return t.kind;
  }
  return pool[pool.length - 1].kind;
}

export function scaleStats(base: EnemyStats, depth: number, rng: { float: () => number }): EnemyStats {
  // Exponential-ish difficulty scaling applied at spawn.
  const factor = 1 + depth * 0.12 + rng.float() * 0.08;
  return {
    ...base,
    maxHp: Math.round(base.maxHp * factor),
    speed: base.speed * (1 + depth * 0.02),
    damage: Math.round(base.damage * factor),
    armor: base.armor + Math.floor(depth / 4)
  };
}

export function clampInt(n: number): number {
  return clamp(Math.round(n), 1, 9999);
}
