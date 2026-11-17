// UI-ART-01 — "field survey manual" drawing primitives for screen-space UI.
//
// Everything here draws into a Phaser Graphics object. Graphics has no
// getBounds(), so these decorations never take part in hit-testing or in the
// layout audit (tests/ui-menu-layout.spec.ts): they cannot overlap a control,
// steal a click, or be focused. Interactive geometry stays owned by the
// existing Rectangle + Text controls.
import Phaser from 'phaser';
import { GAME } from '../config/game';
import { UIN } from './palette';

type G = Phaser.GameObjects.Graphics;

/** Corner ticks of a hairline frame (A4 frame language). */
export function ticks(g: G, x0: number, y0: number, x1: number, y1: number, len = 8, alpha = 0.6, color: number = UIN.ink): void {
  g.lineStyle(1, color, alpha);
  for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
    g.lineBetween(x, y, x + sx * len, y);
    g.lineBetween(x, y, x, y + sy * len);
  }
}

export interface FrameOpts {
  fill?: number;
  fillAlpha?: number;
  line?: number;
  lineAlpha?: number;
  tick?: number;
  tickAlpha?: number;
}

/** Panel: optional fill, hairline outline and brighter corner ticks. */
export function frame(g: G, x0: number, y0: number, x1: number, y1: number, o: FrameOpts = {}): void {
  if (o.fillAlpha !== 0) {
    g.fillStyle(o.fill ?? UIN.panel, o.fillAlpha ?? 0.72);
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  if ((o.lineAlpha ?? 0.14) > 0) {
    g.lineStyle(1, o.line ?? UIN.ink, o.lineAlpha ?? 0.14);
    g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
  }
  ticks(g, x0, y0, x1, y1, o.tick ?? 8, o.tickAlpha ?? 0.55, o.line ?? UIN.ink);
}

/** Hairline dimension rule: end ticks + a small centre diamond. */
export function rule(g: G, cx: number, y: number, half: number, alpha = 0.32, color: number = UIN.ink, gap = 0): void {
  g.lineStyle(1, color, alpha);
  if (gap > 0) {
    g.lineBetween(cx - half, y, cx - gap, y);
    g.lineBetween(cx + gap, y, cx + half, y);
  } else {
    g.lineBetween(cx - half, y, cx + half, y);
  }
  g.lineBetween(cx - half, y - 4, cx - half, y + 4);
  g.lineBetween(cx + half, y - 4, cx + half, y + 4);
  if (gap === 0) {
    g.fillStyle(color, Math.min(1, alpha * 2));
    g.beginPath();
    g.moveTo(cx, y - 3); g.lineTo(cx + 3, y); g.lineTo(cx, y + 3); g.lineTo(cx - 3, y);
    g.closePath(); g.fillPath();
  }
}

/** Dashed hairline (used for "inferred" / leader lines, never for solid facts). */
export function dashed(g: G, x0: number, y0: number, x1: number, y1: number, dash = 3, gapLen = 4, alpha = 0.3, color: number = UIN.ink): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len <= 0) return;
  g.lineStyle(1, color, alpha);
  for (let d = 0; d < len; d += dash + gapLen) {
    const e = Math.min(len, d + dash);
    g.lineBetween(x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len, x0 + ((x1 - x0) * e) / len, y0 + ((y1 - y0) * e) / len);
  }
}

/** Small registration cross-hair (sheet corners). */
export function registration(g: G, x: number, y: number, r = 7, alpha = 0.3): void {
  g.lineStyle(1, UIN.ink, alpha);
  g.strokeCircle(x, y, r * 0.6);
  g.lineBetween(x - r, y, x + r, y);
  g.lineBetween(x, y - r, x, y + r);
}

/**
 * Overlay sheet chrome: a hairline border inset from the canvas edge, ruler
 * ticks along the top edge and registration marks in the corners. Used under
 * every menu page so overlays read as pages of the same manual.
 */
export function sheetChrome(g: G, inset = 10, alpha = 0.16): void {
  const W = GAME.WINDOW_W, H = GAME.WINDOW_H;
  g.lineStyle(1, UIN.ink, alpha);
  g.strokeRect(inset + 0.5, inset + 0.5, W - inset * 2 - 1, H - inset * 2 - 1);
  for (let x = inset + 40; x < W - inset; x += 40) {
    const major = (x - inset) % 200 === 0;
    g.lineStyle(1, UIN.ink, major ? alpha * 1.8 : alpha);
    g.lineBetween(x, inset, x, inset + (major ? 7 : 4));
    g.lineBetween(x, H - inset, x, H - inset - (major ? 7 : 4));
  }
  for (let y = inset + 40; y < H - inset; y += 40) {
    const major = (y - inset) % 200 === 0;
    g.lineStyle(1, UIN.ink, major ? alpha * 1.8 : alpha);
    g.lineBetween(inset, y, inset + (major ? 7 : 4), y);
    g.lineBetween(W - inset, y, W - inset - (major ? 7 : 4), y);
  }
  for (const [x, y] of [[inset, inset], [W - inset, inset], [inset, H - inset], [W - inset, H - inset]]) {
    registration(g, x, y, 9, alpha * 2.2);
  }
}

/** Filled diamond pip (shape-coded markers). */
export function diamond(g: G, x: number, y: number, r: number, color: number, alpha = 1, filled = true): void {
  if (filled) {
    g.fillStyle(color, alpha);
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fillPath();
  } else {
    g.lineStyle(1, color, alpha);
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.strokePath();
  }
}
