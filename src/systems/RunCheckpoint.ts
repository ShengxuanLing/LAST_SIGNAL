import { basePlayerData, GAME } from '../config/game';
import { WEAPON_LIST } from '../config/weapons';
import { UPGRADE_LIST } from '../config/upgrades';
import type { ItemKind, RunCheckpoint } from '../types';

const PLAYER_NUMBERS = [...Object.keys(basePlayerData()), 'level', 'xp', 'xpToNext', 'currency'];
const WEAPON_KEYS = WEAPON_LIST.map(({ key }) => key);
const DROP_KINDS: ItemKind[] = ['health', 'currency', 'upgrade', 'weapon', 'ability', 'restore'];

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isRoomId(value: number): boolean {
  return isCount(value) && value < GAME.MAP_MAX_ROOMS;
}

function isUint32(value: number): boolean {
  return isCount(value) && value <= 0xffffffff;
}

export function validateCheckpoint(run: RunCheckpoint | undefined): run is RunCheckpoint {
  if (!run || typeof run.id !== 'string' || !run.id || !isUint32(run.seed) || !isUint32(run.rngState)) return false;
  if (!isRoomId(run.roomId) || !Number.isFinite(run.position?.x) || !Number.isFinite(run.position?.y)) return false;
  if (!Array.isArray(run.clearedRooms) || !run.clearedRooms.every(isRoomId) || !run.clearedRooms.includes(run.roomId)) return false;
  if (run.portalTarget !== null && !isRoomId(run.portalTarget)) return false;

  const player = run.player;
  if (!player || typeof player !== 'object' || !PLAYER_NUMBERS.every((key) => Number.isFinite(Reflect.get(player, key)))) return false;
  if (player.hp <= 0 || player.hp > player.maxHp || !isCount(player.level) || player.level < 1 ||
      !isCount(player.xp) || !isCount(player.xpToNext) || player.xpToNext <= player.xp || !isCount(player.currency)) return false;
  if (!Array.isArray(player.abilities) || !player.abilities.every((key) => typeof key === 'string')) return false;
  if (!Array.isArray(player.weapons) || !player.weapons.every((weapon) =>
    weapon && WEAPON_KEYS.includes(weapon.key) && isCount(weapon.level) && weapon.level > 0 &&
    Number.isInteger(weapon.ammo) && Number.isInteger(weapon.magazine) &&
    typeof weapon.reloading === 'boolean' && Number.isFinite(weapon.reloadTimer))) return false;
  if (!player.weapons.some(({ key }) => key === player.weaponKey)) return false;
  if (!Array.isArray(player.upgrades) || !player.upgrades.every((upgrade) =>
    upgrade && isCount(upgrade.level) && upgrade.level > 0 &&
    UPGRADE_LIST.some((def) => def.key === upgrade.key && upgrade.level <= def.maxLevel))) return false;

  const stats = run.stats;
  return !!stats && isCount(stats.kills) && isCount(stats.items) &&
    Number.isFinite(stats.damage) && stats.damage >= 0 && isCount(stats.elapsedSeconds) &&
    Array.isArray(run.loot) && run.loot.every((drop) =>
      drop && [drop.x, drop.y, drop.amount, drop.bob].every(Number.isFinite) &&
      DROP_KINDS.includes(drop.kind) && typeof drop.key === 'string');
}
