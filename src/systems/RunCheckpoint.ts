import { basePlayerData, GAME } from '../config/game';
import { WEAPON_LIST } from '../config/weapons';
import { UPGRADE_LIST } from '../config/upgrades';
import { isValidTransactionId, PURCHASE_LEDGER_CAP } from '../config/supplies';
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

/**
 * Deep copy of a checkpoint frame (review R-03). `captureCheckpoint` used to
 * return live references to `player.data` and loot entries, so any in-memory
 * holder (AI adapter, checkpoint UI, test) would see silently mutating data.
 * The on-disk write serialises immediately, which hid the bug for saves only.
 */
export function cloneCheckpoint(run: RunCheckpoint): RunCheckpoint {
  return {
    ...run,
    position: { ...run.position },
    clearedRooms: run.clearedRooms.slice(),
    player: JSON.parse(JSON.stringify(run.player)) as RunCheckpoint['player'],
    loot: run.loot.map((drop) => ({ ...drop })),
    stats: { ...run.stats },
    ...(run.coreState ? { coreState: JSON.parse(JSON.stringify(run.coreState)) } : {})
  };
}

/** Conservative absolute bounds for the echo's base-only stats. */
export const ECHO_STAT_BOUNDS = Object.freeze({
  hp: 10000, speed: 1000, armor: 1000, damage: 100,
  critChance: 1, critDamage: 100, xpGain: 100, pickupRange: 1000,
  dashCooldown: 100, dashDuration: 10, cooldownReduced: 1,
  pierceCount: 10, hpRegen: 100
});

/** Deep validation of the optional echo actor in a checkpoint frame. */
export function validEchoActor(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  if (e.actorId !== 1) return false;
  if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) return false;
  if (!['dashTimer', 'invuln', 'hurtTimer', 'fireTimer', 'aimYaw'].every((k) =>
    typeof e[k] === 'number' && Number.isFinite(e[k]) && (e[k] as number) >= 0)) return false;
  const data = e.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const numeric: Array<[string, number]> = [
    ['hp', ECHO_STAT_BOUNDS.hp], ['maxHp', ECHO_STAT_BOUNDS.hp],
    ['speed', ECHO_STAT_BOUNDS.speed], ['armor', ECHO_STAT_BOUNDS.armor],
    ['damage', ECHO_STAT_BOUNDS.damage], ['critChance', ECHO_STAT_BOUNDS.critChance],
    ['critDamage', ECHO_STAT_BOUNDS.critDamage], ['xpGain', ECHO_STAT_BOUNDS.xpGain],
    ['pickupRange', ECHO_STAT_BOUNDS.pickupRange], ['dashCooldown', ECHO_STAT_BOUNDS.dashCooldown],
    ['dashDuration', ECHO_STAT_BOUNDS.dashDuration], ['cooldownReduced', ECHO_STAT_BOUNDS.cooldownReduced],
    ['pierceCount', ECHO_STAT_BOUNDS.pierceCount], ['hpRegen', ECHO_STAT_BOUNDS.hpRegen],
    ['aimYaw', Math.PI * 4], ['level', 1], ['xp', 0], ['currency', 0]
  ];
  for (const [key, max] of numeric) {
    const v = data[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) return false;
  }
  if (typeof data.maxHp !== 'number' || data.maxHp <= 0) return false;
  if (typeof data.hp !== 'number' || data.hp > data.maxHp) return false;
  if (typeof data.xpToNext !== 'number' || !Number.isFinite(data.xpToNext) || data.xpToNext <= 0) return false;
  if (data.weaponKey !== 'pulse') return false;
  if (!Array.isArray(data.weapons) || data.weapons.length !== 1) return false;
  const weapon = data.weapons[0] as Record<string, unknown>;
  if (!weapon || weapon.key !== 'pulse' || weapon.level !== 1 || weapon.ammo !== -1 ||
      weapon.magazine !== -1 || weapon.reloading !== false ||
      typeof weapon.reloadTimer !== 'number' || !Number.isFinite(weapon.reloadTimer)) return false;
  // Base-only: no upgrades, no abilities, no free skills.
  if (!Array.isArray(data.upgrades) || data.upgrades.length !== 0) return false;
  if (!Array.isArray(data.abilities) || data.abilities.length !== 0) return false;
  return true;
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
  if (!stats || !isCount(stats.kills) || !isCount(stats.items) ||
      !Number.isFinite(stats.damage) || stats.damage < 0 || !isCount(stats.elapsedSeconds) ||
      !Array.isArray(run.loot) || !run.loot.every((drop) =>
        drop && [drop.x, drop.y, drop.amount, drop.bob].every(Number.isFinite) &&
        DROP_KINDS.includes(drop.kind) && typeof drop.key === 'string')) return false;

  const core = run.coreState;
  if (core) {
    const t = core.playerTimers;
    if (!isUint32(core.tick) || !isUint32(core.rngState) || !isCount(core.nextProjectileId) || !t ||
        !['dashTimer', 'invuln', 'hurtTimer', 'fireTimer', 'aimYaw'].every((k) => Number.isFinite((t as any)[k]))) return false;
    // Optional echo actor: absent is valid (old checkpoint / solo run). Present
    // must be a DEEP, structurally valid, bounded base-only actor. A tampered
    // checkpoint must not be able to inject speed/armor/damage or free skills.
    const echo = (core as { echo?: unknown }).echo;
    if (echo !== undefined && !validEchoActor(echo)) return false;
    // Optional processed-purchase ledger: absent is valid (old checkpoint),
    // present must be bounded, well-formed and duplicate-free.
    const ledger = (core as { purchaseTransactions?: unknown }).purchaseTransactions;
    if (ledger !== undefined) {
      if (!Array.isArray(ledger) || ledger.length > PURCHASE_LEDGER_CAP) return false;
      const seen = new Set<string>();
      for (const id of ledger) {
        if (!isValidTransactionId(id) || seen.has(id)) return false;
        seen.add(id);
      }
    }
  }
  return true;
}
