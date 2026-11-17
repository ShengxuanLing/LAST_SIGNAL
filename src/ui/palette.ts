// UI-ART-01 — screen-space UI palette for every menu, overlay and HUD text.
//
// Direction A "SURVEY INK" (docs/art/03_VISUAL_BIBLE.md §2 / §7) applied to the
// interface layer: graphite sheets, bone ink, hairline frames. Colour carries the
// same meaning as in the world, so the UI never invents a second vocabulary:
//   * text / textMid / muted / dim / faint — bone ink at decreasing priority;
//   * accent (cyan)  — interactable protocol: focus, primary action, "you can act";
//   * signal (blue)  — a stable, live link (CONNECTED, ACTIVE relay, equipped);
//   * warn  (amber)  — unknown / unstable / not connected / in progress / caution;
//   * rare  (green)  — permanent cores and other rare rewards;
//   * hostile        — reserved for hostile threat, never for UI chrome.
// Contrast against the void #07090b (WCAG, hand-checked): text 11.2, textMid 9.0,
// muted 7.4, dim 5.0, faint 3.6 (faint is for decorative captions only).
import { CSS, INK } from '../art/survey/tokens';

export const UIC = {
  void: CSS.shadow,
  text: CSS.known,
  textMid: CSS.knownMid,
  muted: '#aea896',
  dim: '#8a8476',
  faint: '#6c685d',
  accent: CSS.interact,
  signal: CSS.signal,
  warn: CSS.unknown,
  rare: CSS.rare,
  hostile: CSS.hostile,
  white: CSS.priority,
} as const;

/** Numeric versions for Graphics / Rectangle fills. */
export const UIN = {
  void: INK.shadow,
  panel: INK.panel,
  mass: INK.mass,
  massLight: INK.massLight,
  massLift: INK.massLift,
  ink: INK.known,
  accent: INK.interact,
  accentDeep: 0x0d2a29,
  signal: INK.signal,
  warn: INK.unknown,
  warnDeep: 0x1d170f,
  rare: INK.rare,
} as const;
