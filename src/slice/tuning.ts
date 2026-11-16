// Shared prototype values, in grid cells and fixed logic ticks.
// Signal (finite resource) numbers now live in ONE shared module so the
// future main-World Relay device and this frozen slice cannot drift.
import { SIGNAL_TUNING } from '../signal/signalTuning';

export const SLICE = Object.freeze({
  ...SIGNAL_TUNING,
  SAFE_CLEAR_DELAY_TICKS: 60,
  INTERACT_RANGE: 6, // VS-00 door interaction
  MAX_FRAME_DELTA_MS: 250,
  MAX_TICKS_PER_FRAME: 15,
  MOVE_SPEED: 3.4375,
} as const);
