// ART-02 visual tokens. Pure data (no Phaser / no DOM) so it is Node-testable.
//
// Reconciles docs/STYLE_GUIDE.md (existing hexes) with GDB §12.3 semantic colours:
//   cold blue = stable signal feed, cyan = interactable protocol endpoint,
//   amber = unknown / unstable, red = hostile control & danger,
//   white = high-priority observation event, low-saturation grey = unobserved.
// Every colour that carries meaning is ALSO encoded by line style / motion, so
// state never depends on hue alone (see docs/art/VISUAL_LANGUAGE.md §3).

/** Semantic signal colours (meaning-bearing). */
export const SIGNAL = {
  /** Interactable protocol endpoint / player-issued action (existing system cyan). */
  protocol: 0x33e0ff,
  protocolHi: 0x7ff0ff,
  /** Stable carrier / feed that is currently delivering (cold blue). */
  feed: 0x5d8dff,
  feedHi: 0xb7ccff,
  /** Unknown, unstable or about-to-expire state (existing warning orange as amber). */
  unstable: 0xff8a3c,
  unstableHi: 0xffc08a,
  /** Hostile control, sealed, danger (existing threat red). */
  hostile: 0xff3355,
  /** Interference / jammed (existing jammed-guard violet). */
  jammed: 0xa398ff,
  /** High-priority observation event (scan hit). */
  observe: 0xf2fbff,
  /** No longer observed / inactive. */
  dormant: 0x5a7480,
} as const;

/** Material colours (non-semantic; never used for state). */
export const MATERIAL = {
  void: 0x020307,
  abyss: 0x03050a,
  floorBase: 0x0f161d,
  floorPlate: 0x131c25,
  floorSeam: 0x070b10,
  floorWorn: 0x1a2530,
  concrete: 0x1b2229,
  concreteDark: 0x10151a,
  steel: 0x26313b,
  steelLit: 0x34424e,
  steelDark: 0x141b22,
  rust: 0x4a2f22,
  grime: 0x080a0d,
  hazardYellow: 0xc9a227,
  hazardDark: 0x15120a,
  stencil: 0x8d9aa3,
  cable: 0x0b0e12,
  plateText: 0x9fb4c0,
  backdrop: 0x070b12,
  backdropLight: 0x0d1520,
} as const;

/** CSS helpers for canvas 2D baking. */
export function css(hex: number, alpha = 1): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/** Linear blend of two hex colours, t in [0,1]. */
export function mix(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (shift: number): number => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * k) << shift;
  };
  return ch(16) | ch(8) | ch(0);
}

/** WCAG relative luminance, used by the readability unit test. */
export function luminance(hex: number): number {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((hex >> 16) & 0xff) + 0.7152 * lin((hex >> 8) & 0xff) + 0.0722 * lin(hex & 0xff);
}

export function contrast(a: number, b: number): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
