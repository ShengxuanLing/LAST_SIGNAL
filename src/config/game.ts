// Global game constants and balance configuration.
export const GAME = {
  WINDOW_W: 1280,
  WINDOW_H: 720,
  TILE_W: 64,
  TILE_H: 32,
  // Combat speed/range fields in configs are authored in screen-px; divide by this
  // to express them in tile-world units (matches the iso projection and movement).
  PIXEL_TO_TILE: 64,
  // Map spans this many tiles per room; room grid in iso cells.
  ROOM_MIN: 8,
  ROOM_MAX: 14,
  MAP_MAX_ROOMS: 9,
  MAP_MIN_ROOMS: 5,
  CAM_LERP: 0.12,
  CAM_ZOOM_MIN: 0.8,
  CAM_ZOOM_MAX: 1.25,
  GRAVITY: 0, // iso world is flat-ish; heights are decorative
  WORLD_BOUND_PAD: 32,
  DAMAGE_NUMBER_LIFE: 0.8,
  SHAKE_DECAY: 6,
  SHAKE_MAX: 18
};

export const DEFAULT_SETTINGS = {
  masterVolume: 0.7,
  sfxVolume: 0.8,
  mouseDpi: 1.0,
  fullscreen: false,
  screenShake: true
};

export const SAVE_KEY = 'last_signal_save_v1';
export { SAVE_VERSION } from '../types';
export type { SaveData } from '../types';

// Balance: XP curve. xpToNext = base * level^exponent
export function xpForLevel(level: number): number {
  return Math.round(20 * Math.pow(level, 1.45));
}

export function basePlayerData() {
  return {
    maxHp: 100,
    hp: 100,
    speed: 220,
    armor: 0,
    damage: 1.0,
    critChance: 0.1,
    critDamage: 1.5,
    xpGain: 1.0,
    pickupRange: 90,
    dashCooldown: 0.9,
    dashDuration: 0.16,
    aimYaw: 0,
    cooldownReduced: 0,
    pierceCount: 0,
    hpRegen: 0
  };
}
