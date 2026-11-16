import { basePlayerData, GAME } from '../config/game';
import { WEAPON_LIST } from '../config/weapons';
import { UPGRADE_LIST } from '../config/upgrades';
import { isValidTransactionId, PURCHASE_LEDGER_CAP } from '../config/supplies';
import { echoPlayerData, ECHO_ACTOR_ID } from '../world/sim/core';
import { AI_NATIVE_LIMITS_V1 } from '../ai-native/protocol';
import { validSignalDevice } from '../world/sim/signalState';
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

// P3-b Task0 — the echo base actor shape comes from the SAME factory used to
// create it (`core.ts echoPlayerData()`). An absolute upper bound is NOT enough:
// damage=99 / regen=50 / speed=1000 would still pass. Non-upgradeable fields
// must equal the factory values exactly; only genuine runtime state may vary.
const ECHO_BASE = echoPlayerData();
const ECHO_EXACT_BASE_KEYS = Object.freeze([
  'maxHp', 'speed', 'armor', 'damage', 'critChance', 'critDamage', 'xpGain',
  'pickupRange', 'dashCooldown', 'dashDuration', 'cooldownReduced', 'pierceCount',
  'hpRegen', 'level', 'xp', 'xpToNext', 'currency', 'weaponKey'
] as const);

/** Runtime timers are bounded by REAL physical durations at 60Hz, not MAX_TICK. */
const ECHO_TIMER_BOUNDS = Object.freeze({
  dashTimer: 2 * 60,       // 2 s dash window
  invuln: 10 * 60,         // 10 s invulnerability
  hurtTimer: 1 * 60,       // 1 s hurt flash
  fireTimer: 5 * 60,       // 5 s weapon cooldown
  reloadTimer: 10 * 60     // 10 s reload
});
const ECHO_TOP_KEYS = Object.freeze([
  'actorId', 'x', 'y', 'data', 'dashTimer', 'invuln', 'hurtTimer', 'fireTimer', 'aimYaw'
]);
const ECHO_WEAPON_KEYS = Object.freeze(['key', 'level', 'ammo', 'magazine', 'reloading', 'reloadTimer']);

function bounded(value: unknown, max: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}

/** Deep validation of the optional echo actor in a checkpoint frame. */
export function validEchoActor(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  // Strict allowlist: extra hiddenTarget / nested free fields are rejected.
  if (Object.keys(e).some((k) => !ECHO_TOP_KEYS.includes(k))) return false;
  if (e.actorId !== ECHO_ACTOR_ID) return false;
  if (typeof e.x !== 'number' || !Number.isFinite(e.x) ||
      typeof e.y !== 'number' || !Number.isFinite(e.y) ||
      Math.abs(e.x) > AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS ||
      Math.abs(e.y) > AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS) return false;
  // aimYaw can be negative; the other timers are non-negative.
  if (typeof e.aimYaw !== 'number' || !Number.isFinite(e.aimYaw)) return false;
  for (const key of ['dashTimer', 'invuln', 'hurtTimer', 'fireTimer'] as const) {
    if (!bounded(e[key], ECHO_TIMER_BOUNDS[key])) return false;
  }

  const data = e.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (Object.keys(data).some((k) => !Object.keys(ECHO_BASE).includes(k))) return false;
  // Non-upgradeable stats / identity must be EXACTLY the legal base values.
  for (const key of ECHO_EXACT_BASE_KEYS) {
    if (data[key] !== ECHO_BASE[key as keyof typeof ECHO_BASE]) return false;
  }
  // Runtime HP (normal damage), facing and the weapon reload timer may vary.
  if (typeof data.hp !== 'number' || !Number.isFinite(data.hp) ||
      data.hp < 0 || data.hp > ECHO_BASE.maxHp) return false;
  if (typeof data.aimYaw !== 'number' || !Number.isFinite(data.aimYaw)) return false;

  if (!Array.isArray(data.weapons) || data.weapons.length !== 1) return false;
  const weapon = data.weapons[0] as Record<string, unknown>;
  const baseWeapon = ECHO_BASE.weapons[0];
  if (!weapon || typeof weapon !== 'object' || Array.isArray(weapon) ||
      Object.keys(weapon).some((k) => !ECHO_WEAPON_KEYS.includes(k)) ||
      weapon.key !== baseWeapon.key || weapon.level !== baseWeapon.level ||
      weapon.ammo !== baseWeapon.ammo || weapon.magazine !== baseWeapon.magazine ||
      weapon.reloading !== false || !bounded(weapon.reloadTimer, ECHO_TIMER_BOUNDS.reloadTimer)) return false;
  // No free skills: the echo has no upgrades and no abilities, ever.
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
    const signal = (core as { signal?: unknown }).signal;
    if (signal !== undefined && !validSignalDevice(signal)) return false;
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
