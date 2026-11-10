// Data-driven item / loot configuration.
import { ItemDef, ItemKind } from '../types';

export const ITEMS: Record<string, ItemDef> = {
  health: {
    key: 'health',
    kind: 'health',
    name: 'Nano Patch',
    description: 'Restores 30 HP.',
    rarity: 1.0
  },
  currency: {
    key: 'currency',
    kind: 'currency',
    name: 'Credit Chip',
    description: 'Worth 10 credits.',
    rarity: 1.0
  },
  repair: {
    key: 'repair',
    kind: 'restore',
    name: 'Systems Restore',
    description: 'Fully repairs your health.',
    rarity: 0.5
  }
};

export const ITEM_LIST = Object.values(ITEMS);

export function kindWeights(): { kind: ItemKind; weight: number }[] {
  return [
    { kind: 'health', weight: 55 },
    { kind: 'currency', weight: 40 },
    { kind: 'restore', weight: 10 }
  ];
}
