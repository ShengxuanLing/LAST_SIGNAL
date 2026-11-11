import { clampLevel, WEAPONS } from '../config/weapons';
import type { PlayerData, Room, WeaponKind } from '../types';

const LOAN_WEAPONS = ['scatter', 'plasma', 'arc'] as const;

export interface Supply {
  name: string;
  description: string;
  price: number;
  unavailable?: string;
  apply(player: PlayerData): void;
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

function weaponSupply(key: WeaponKind, player: PlayerData): Supply {
  const def = WEAPONS[key];
  const magazine = def.magazine ?? -1;
  return {
    name: def.name,
    description: 'Adds this weapon to your arsenal for the current run and equips it.',
    price: 40,
    unavailable: player.weapons.some((weapon) => weapon.key === key) ? 'Already owned' : undefined,
    apply: (next) => {
      next.weapons.push({ key, level: 1, ammo: magazine, magazine, reloading: false, reloadTimer: 0 });
      next.weaponKey = key;
    }
  };
}

export function suppliesFor(player: PlayerData, seed: number, roomId: number): Supply[] {
  const active = player.weapons.find((weapon) => weapon.key === player.weaponKey);
  const weapon = active && WEAPONS[active.key];
  const nextLevel = active ? clampLevel(active.level + 1) : 1;
  const atCap = !!active && nextLevel <= active.level;
  const loan = LOAN_WEAPONS[((seed ^ Math.imul(roomId, 2654435761)) >>> 0) % LOAN_WEAPONS.length];
  return [
    {
      name: 'Repair kit',
      description: 'Restores up to 35 HP.',
      price: 16,
      unavailable: player.hp >= player.maxHp ? 'Health full' : undefined,
      apply: (next) => { next.hp = Math.min(next.maxHp, next.hp + 35); }
    },
    {
      name: 'Weapon calibration',
      description: weapon && active
        ? `${weapon.name} · Lv ${active.level}${atCap ? '' : ` → ${nextLevel}`}`
        : 'Adds one level to your equipped weapon.',
      price: 28,
      unavailable: !active || !weapon ? 'No equipped weapon' : atCap ? 'Max level' : undefined,
      apply: (next) => {
        const equipped = next.weapons.find((entry) => entry.key === next.weaponKey);
        if (equipped) equipped.level = clampLevel(equipped.level + 1);
      }
    },
    weaponSupply(loan, player)
  ];
}

export function purchaseBlocker(player: PlayerData, supply: Supply): string | undefined {
  return supply.unavailable ?? (player.currency < supply.price ? 'Not enough credits' : undefined);
}

export function buySupply(player: PlayerData, supply: Supply): PlayerData | null {
  if (purchaseBlocker(player, supply)) return null;
  const next = structuredClone(player);
  next.currency -= supply.price;
  supply.apply(next);
  return next;
}
