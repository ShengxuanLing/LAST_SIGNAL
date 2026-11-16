// AI-NATIVE-02 P3-b — shared Signal tuning.
//
// These are the REAL Station Zero slice values. `src/slice/tuning.ts` now
// re-exports them so the frozen slice rules and the future main-World Signal
// device use ONE set of numbers, not two drifting copies.

export const SIGNAL_TUNING = Object.freeze({
  TICK_HZ: 60,
  TICK_MS: 1000 / 60,
  ENERGY_MAX: 100,
  REGEN_PER_SEC: 5,
  REGEN_TICKS: 12,
  SCAN_COST: 10,
  SCAN_CD_TICKS: 120,
  SCAN_REVEAL_TICKS: 480,
  SCAN_RADIUS: 12,
  EVIDENCE_TTL_TICKS: 300,
  JAM_COST: 25,
  JAM_CD_TICKS: 480,
  JAM_DURATION_TICKS: 360,
  JAM_RANGE: 6
} as const);
