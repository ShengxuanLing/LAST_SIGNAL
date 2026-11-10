// Data-driven upgrade system. Three choices on level-up, at least 8 upgrade types.
// Each upgrade directly mutates PlayerData so effects are measurable.
import { PlayerData, UpgradeDef } from '../types';

export function applyUpgrade(def: UpgradeDef, state: PlayerData, level = 1): void {
  def.apply(state, level);
}

export const UPGRADES: Record<string, UpgradeDef> = {
  vitality: {
    key: 'vitality',
    name: 'Vitality',
    description: '+15% maximum health (and heal the delta).',
    maxLevel: 6,
    weight: 10,
    apply: (state, lvl) => {
      const before = state.maxHp;
      state.maxHp = Math.round(state.maxHp * 1.15);
      state.hp += state.maxHp - before;
    }
  },
  speed: {
    key: 'speed',
    name: 'Optics',
    description: '+8% movement speed.',
    maxLevel: 5,
    weight: 8,
    apply: (state, lvl) => {
      state.speed *= 1.08;
    }
  },
  power: {
    key: 'power',
    name: 'Overcharge',
    description: '+10% weapon damage.',
    maxLevel: 6,
    weight: 10,
    apply: (state, lvl) => {
      state.damage *= 1.10;
    }
  },
  critical: {
    key: 'critical',
    name: 'Targeting AI',
    description: '+6% critical hit chance.',
    maxLevel: 5,
    weight: 8,
    apply: (state, lvl) => {
      state.critChance = Math.min(0.8, state.critChance + 0.06);
    }
  },
  critDamage: {
    key: 'critDamage',
    name: 'Focus Lens',
    description: '+25% critical damage.',
    maxLevel: 5,
    weight: 7,
    apply: (state, lvl) => {
      state.critDamage += 0.25;
    }
  },
  rapid: {
    key: 'rapid',
    name: 'Cooldown Systems',
    description: '+8% attack speed (lower weapon cooldown).',
    maxLevel: 5,
    weight: 8,
    apply: (state, lvl) => {
      state.cooldownReduced = Math.min(0.9, state.cooldownReduced + 0.08);
    }
  },
  magnet: {
    key: 'magnet',
    name: 'Magnetic Fields',
    description: '+40% item pickup range.',
    maxLevel: 4,
    weight: 8,
    apply: (state, lvl) => {
      state.pickupRange *= 1.40;
    }
  },
  datapad: {
    key: 'datapad',
    name: 'Data Pad',
    description: '+15% experience gain.',
    maxLevel: 5,
    weight: 8,
    apply: (state, lvl) => {
      state.xpGain *= 1.15;
    }
  },
  armor: {
    key: 'armor',
    name: 'Reactive Plating',
    description: '+2 flat armor (damage reduction).',
    maxLevel: 6,
    weight: 8,
    apply: (state, lvl) => {
      state.armor += 2;
    }
  },
  quickdash: {
    key: 'quickdash',
    name: 'Thruster Refit',
    description: '-15% dash cooldown.',
    maxLevel: 4,
    weight: 6,
    apply: (state, lvl) => {
      state.dashCooldown *= 0.85;
    }
  },
  pierce: {
    key: 'pierce',
    name: 'Piercing Rounds',
    description: 'Projectiles hit +1 additional enemy.',
    maxLevel: 3,
    weight: 6,
    apply: (state, lvl) => {
      state.pierceCount = (state.pierceCount ?? 0) + 1;
    }
  },
  regen: {
    key: 'regen',
    name: 'Nanite Repair',
    description: 'Regenerate +1 HP per second.',
    maxLevel: 5,
    weight: 8,
    apply: (state, lvl) => {
      state.hpRegen = (state.hpRegen ?? 0) + 1;
    }
  }
};

export const UPGRADE_LIST = Object.values(UPGRADES);

export const STARTING_WEAPONS: string[] = ['pulse', 'pulse', 'pulse'];
