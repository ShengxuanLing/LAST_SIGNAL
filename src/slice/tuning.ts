// Shared prototype values, in grid cells and fixed logic ticks.
export const SLICE = {
  TICK_HZ: 60,
  TICK_MS: 1000 / 60,
  ENERGY_MAX: 100,
  REGEN_PER_SEC: 5,
  REGEN_TICKS: 12,
  SCAN_COST: 10,
  SCAN_CD_TICKS: 120,
  SCAN_REVEAL_TICKS: 480,
  SCAN_RADIUS: 12,
  JAM_COST: 25,
  JAM_CD_TICKS: 480,
  JAM_DURATION_TICKS: 360,
  JAM_RANGE: 6,
  SAFE_CLEAR_DELAY_TICKS: 60,
  INTERACT_RANGE: 6, // VS-00 door interaction
  MAX_FRAME_DELTA_MS: 250,
  MAX_TICKS_PER_FRAME: 15,
  MOVE_SPEED: 3.4375,
} as const;
