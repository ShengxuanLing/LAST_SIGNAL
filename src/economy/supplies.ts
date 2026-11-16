import {
  SUPPLY_OFFER_KEYS, applySupply, clearReward, loanWeaponFor, supplyOfferBlocker,
  supplyOfferDescription, supplyOfferName, supplyPrice, terminalRooms,
  type SupplyOfferKey
} from '../config/supplies';
import type { PlayerData } from '../types';

export { clearReward, terminalRooms } from '../config/supplies';

export interface Supply {
  /** Stable offer id. The core resolves price + effect from this key, not display fields. */
  key: SupplyOfferKey;
  name: string;
  description: string;
  price: number;
  unavailable?: string;
  apply(player: PlayerData): void;
}

export function suppliesFor(player: PlayerData, seed: number, roomId: number): Supply[] {
  return SUPPLY_OFFER_KEYS.map((key) => ({
    key,
    name: supplyOfferName(key, player, seed, roomId),
    description: supplyOfferDescription(key, player, seed, roomId),
    price: supplyPrice(key),
    unavailable: supplyOfferBlocker(key, player, seed, roomId),
    apply: (next) => applySupply(key, next, seed, roomId)
  }));
}

export function purchaseBlocker(player: PlayerData, supply: Supply): string | undefined {
  return supply.unavailable ?? (player.currency < supply.price ? 'Not enough credits' : undefined);
}

/** Local preview helper for the UI. The authoritative transaction is the core
 *  `purchase-supply` command; this only builds an optimistic display snapshot. */
export function buySupply(player: PlayerData, supply: Supply): PlayerData | null {
  if (purchaseBlocker(player, supply)) return null;
  const next = structuredClone(player);
  next.currency -= supply.price;
  supply.apply(next);
  return next;
}

export { loanWeaponFor };
