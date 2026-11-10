// Data-driven weapon configuration.
// Each weapon has genuinely different mechanics and per-level scaling hooks.
import { WeaponDef } from '../types';
import { clamp } from '../core/random';

export const WEAPONS: Record<string, WeaponDef> = {
  pulse: {
    key: 'pulse',
    kind: 'pulse',
    name: 'Pulse Rifle',
    description: 'Rapid, accurate energy bursts. Reliable DPS at any range.',
    baseDamage: 12,
    baseRate: 6,
    baseSpread: 0.02,
    baseProjectileSpeed: 720,
    baseRange: 520,
    critBase: 0.1,
    levelDamage: (l) => 12 + (l - 1) * 3,
    levelRate: (l) => 6 + (l - 1) * 0.8,
    levelRange: (l) => 520 + (l - 1) * 20,
    icon: '△'
  },
  scatter: {
    key: 'scatter',
    kind: 'scatter',
    name: 'Scatter Gun',
    description: 'Fires a wide cone of pellets. Devastating up close, falls off at range.',
    baseDamage: 6,
    baseRate: 2.2,
    baseSpread: 0.5,
    baseProjectileSpeed: 560,
    baseRange: 260,
    magazine: 8,
    reloadTime: 1.1,
    critBase: 0.05,
    levelDamage: (l) => 6 + (l - 1) * 1.5,
    levelRate: (l) => 2.2 + (l - 1) * 0.25,
    levelRange: (l) => 260 + (l - 1) * 15,
    icon: '◆'
  },
  plasma: {
    key: 'plasma',
    kind: 'plasma',
    name: 'Plasma Cannon',
    description: 'Slow, heavy shot that pierces enemies and detonates on impact.',
    baseDamage: 42,
    baseRate: 1.4,
    baseSpread: 0,
    baseProjectileSpeed: 380,
    baseRange: 480,
    critBase: 0.15,
    levelDamage: (l) => 42 + (l - 1) * 14,
    levelRate: (l) => 1.4 + (l - 1) * 0.15,
    levelRange: (l) => 480 + (l - 1) * 25,
    icon: '●'
  },
  arc: {
    key: 'arc',
    kind: 'arc',
    name: 'Arc Drone',
    description: 'Chain lightning that arcs between nearby foes. Great against crowds.',
    baseDamage: 10,
    baseRate: 3.5,
    baseSpread: 0.08,
    baseProjectileSpeed: 900,
    baseRange: 240,
    critBase: 0.2,
    levelDamage: (l) => 10 + (l - 1) * 2.5,
    levelRate: (l) => 3.5 + (l - 1) * 0.4,
    levelRange: (l) => 240 + (l - 1) * 20,
    icon: '⚡'
  }
};

export const WEAPON_LIST = Object.values(WEAPONS);

export function weaponDps(def: WeaponDef, level = 1, cooldownReduction = 0): number {
  const dmg = def.levelDamage(level);
  const fireRate = def.levelRate(level) / (1 - cooldownReduction);
  // effective dps ignoring range/penetration; a rough comparison metric
  return dmg * fireRate;
}

export function clampLevel(l: number): number {
  return clamp(l, 1, 10);
}
