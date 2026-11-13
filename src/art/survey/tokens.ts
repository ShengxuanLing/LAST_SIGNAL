// ART-RENAISSANCE · Direction A "SURVEY INK" — semantic tokens.
// Source of truth: docs/art/03_VISUAL_BIBLE.md §2 (colour) and §7 (type / time / fx).
// Rendering code must use these names instead of raw hex so meaning stays auditable:
//  * hostile (vermilion) is ONLY for hostile apertures, hostile shots and hostile aim lines;
//  * ink.known (bone) is the executor body and observed/known linework;
//  * interact (cyan) is interactable protocol + the executor mast lamp;
//  * signal (cold blue) is stable signal linkage;
//  * unknown (amber) is unknown / unstable / warning.

export const INK = {
  mass: 0x15191d,
  massLight: 0x232a30,
  massLift: 0x2b333a,
  shadow: 0x07090b,
  ao: 0x0a0c0e,
  known: 0xe8e2d0,
  knownMid: 0xcfc8b4,
  knownLow: 0xbdb6a2,
  hostile: 0xff4a3d,
  hostileBody: 0x0a0b0d,
  hostileBodyLift: 0x1a1e22,
  unknown: 0xf2a93b,
  signal: 0x7fb7ff,
  interact: 0x4fe3d6,
  rare: 0x9fe870,
  priority: 0xffffff,
  panel: 0x0b0d10,
} as const;

/** CSS strings for Canvas 2D bakes. */
export const CSS = {
  mass: '#15191d',
  massLight: '#232a30',
  massLift: '#2b333a',
  shadow: '#07090b',
  ao: '#0a0c0e',
  known: '#e8e2d0',
  knownMid: '#cfc8b4',
  knownLow: '#bdb6a2',
  hostile: '#ff4a3d',
  hostileBody: '#0a0b0d',
  hostileBodyLift: '#1a1e22',
  unknown: '#f2a93b',
  signal: '#7fb7ff',
  interact: '#4fe3d6',
  rare: '#9fe870',
  priority: '#ffffff',
} as const;

export const rgba = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export const FONT = {
  mono: "Consolas, 'Cascadia Mono', ui-monospace, monospace",
  cjk: "'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif",
} as const;

/** Milliseconds (03 §7). hitStop is deliberately absent: it would change game time. */
export const TIME = {
  hitFlash: 60,
  damageNumber: 800,
  scanPulse: 450,
  scanInkReveal: 300,
  lowHpPulse: 1200,
  toast: 1800,
  telegraph: 300,
} as const;

export const FX = {
  maxParticlesPerHit: 6,
  maxLiveParticles: 160,
} as const;

/** Depth bands (03 §6). Actors are iso-sorted inside [ACTOR_BASE, ACTOR_BASE + 2). */
export const DEPTH = {
  void: -10,
  world: -1,
  ink: -0.5,
  light: 1,
  decal: 60,
  loot: 70,
  shadow: 88,
  actorBase: 100,
  fx: 400,
  label: 450,
  hud: 500,
} as const;

/** Iso depth inside the actor band: larger wx+wy is nearer the camera. */
export function actorDepth(wx: number, wy: number): number {
  return DEPTH.actorBase + Math.max(0, Math.min(1.99, (wx + wy) / 400));
}
