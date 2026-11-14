// Pure supply-terminal rules shared by the authoritative core and the economy UI.
//
// No DOM / Phaser imports. Prices are fixed here so neither an Agent nor an
// arbitrary command argument can override them. The core resolves the offered
// weapon from the run seed + room id; callers only pass a stable offer key.

import { clampLevel, WEAPONS } from './weapons';
import type { PlayerData, Room } from '../types';

export const LOAN_WEAPONS = ['scatter', 'plasma', 'arc'] as const;
export type LoanWeaponKind = typeof LOAN_WEAPONS[number];

export type SupplyOfferKey = 'repair' | 'calibration' | 'weapon';

export const SUPPLY_OFFER_KEYS: readonly SupplyOfferKey[] = ['repair', 'calibration', 'weapon'];

export const SUPPLY_PRICES: Readonly<Record<SupplyOfferKey, number>> = Object.freeze({
  repair: 16,
  calibration: 28,
  weapon: 40
});

export function isSupplyOfferKey(value: string): value is SupplyOfferKey {
  return value === 'repair' || value === 'calibration' || value === 'weapon';
}

export function clearReward(room: Room): number {
  if (room.kind === 'start' || room.kind === 'boss' || room.kind === 'extraction') return 0;
  return room.kind === 'elite' ? 24 : 12;
}

export function terminalRooms(rooms: Room[]): Set<number> {
  const stations = rooms.filter((room) => room.kind === 'shop' || room.kind === 'elite').map((room) => room.id);
  const first = rooms.find((room) => room.kind === 'start')?.connectedTo
    .find((id) => rooms[id] && clearReward(rooms[id]) > 0);
  if (first !== undefined) stations.push(first);
  return new Set(stations);
}

/** Deterministic loan weapon for a terminal room. */
export function loanWeaponFor(seed: number, roomId: number): LoanWeaponKind {
  return LOAN_WEAPONS[((seed ^ Math.imul(roomId, 2654435761)) >>> 0) % LOAN_WEAPONS.length];
}

/** Room containing a grid position, if any. */
export function roomAt(rooms: Room[], x: number, y: number): Room | undefined {
  return rooms.find((room) => x >= room.gx && x < room.gx + room.w && y >= room.gy && y < room.gy + room.h);
}

export function supplyPrice(key: SupplyOfferKey): number {
  return SUPPLY_PRICES[key];
}

export function supplyOfferName(key: SupplyOfferKey, player: PlayerData, seed: number, roomId: number): string {
  if (key === 'repair') return 'Repair kit';
  if (key === 'calibration') return 'Weapon calibration';
  return WEAPONS[loanWeaponFor(seed, roomId)].name;
}

export function supplyOfferDescription(key: SupplyOfferKey, player: PlayerData, seed: number, roomId: number): string {
  if (key === 'repair') return 'Restores up to 35 HP.';
  if (key === 'calibration') {
    const active = player.weapons.find((weapon) => weapon.key === player.weaponKey);
    const weapon = active && WEAPONS[active.key];
    const nextLevel = active ? clampLevel(active.level + 1) : 1;
    const atCap = !!active && nextLevel <= active.level;
    return weapon && active
      ? `${weapon.name} · Lv ${active.level}${atCap ? '' : ` → ${nextLevel}`}`
      : 'Adds one level to your equipped weapon.';
  }
  return 'Adds this weapon to your arsenal for the current run and equips it.';
}

/** Offer-only eligibility (no balance). Used by both UI blockers and core commit validation. */
export function supplyOfferBlocker(key: SupplyOfferKey, player: PlayerData, seed: number, roomId: number): string | undefined {
  if (key === 'repair') return player.hp >= player.maxHp ? 'Health full' : undefined;
  if (key === 'calibration') {
    const active = player.weapons.find((weapon) => weapon.key === player.weaponKey);
    if (!active || !WEAPONS[active.key]) return 'No equipped weapon';
    if (clampLevel(active.level + 1) <= active.level) return 'Max level';
    return undefined;
  }
  const loan = loanWeaponFor(seed, roomId);
  return player.weapons.some((weapon) => weapon.key === loan) ? 'Already owned' : undefined;
}

/** Full pre-purchase blocker including balance. */
export function supplyOfferPurchaseBlocker(key: SupplyOfferKey, player: PlayerData, seed: number, roomId: number): string | undefined {
  const offer = supplyOfferBlocker(key, player, seed, roomId);
  if (offer) return offer;
  return player.currency < supplyPrice(key) ? 'Not enough credits' : undefined;
}

/** Apply a validated purchase to a player snapshot. Caller must have checked the blocker. */
export function applySupply(key: SupplyOfferKey, player: PlayerData, seed: number, roomId: number): void {
  if (key === 'repair') {
    player.hp = Math.min(player.maxHp, player.hp + 35);
    return;
  }
  if (key === 'calibration') {
    const equipped = player.weapons.find((weapon) => weapon.key === player.weaponKey);
    if (equipped) equipped.level = clampLevel(equipped.level + 1);
    return;
  }
  const loan = loanWeaponFor(seed, roomId);
  const def = WEAPONS[loan];
  const magazine = def.magazine ?? -1;
  player.weapons.push({ key: loan, level: 1, ammo: magazine, magazine, reloading: false, reloadTimer: 0 });
  player.weaponKey = loan;
}
