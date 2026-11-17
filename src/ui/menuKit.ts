// UI-REWORK-01 — shared, framework-free menu layout kit.
//
// One place for padding / gap / button geometry / wrapping / hover / focus /
// disabled behaviour so every Pause surface uses the same visual grammar.
// A MenuPage owns every object it creates and destroys them together, which is
// what guarantees "hidden objects are never interactive" and "no duplicate
// objects on resize / re-open".
//
// Compact tokens: Phaser Scale.FIT keeps the 1280x720 logical canvas, then the
// browser scales it down. At 800x600 the scale is 0.625, so a 12 logical-px
// glyph becomes 7.5 CSS px. The compact token set raises the logical sizes so
// the *effective CSS* size stays >= 10px at the smallest supported viewport.
import Phaser from 'phaser';
import { GAME } from '../config/game';
import { FONT } from '../art/survey/tokens';
import { audio } from '../systems/AudioSystem';
import { UIC, UIN } from './palette';
import { ticks } from './sheet';

export interface UITokens {
  PAD: number;
  GAP: number;
  BTN_W: number;
  BTN_H: number;
  BTN_STRIDE: number;
  TITLE_FONT: number;
  HEAD_FONT: number;
  BODY_FONT: number;
  SMALL_FONT: number;
  BTN_FONT: number;
}

export const UI_NORMAL: UITokens = {
  PAD: 24, GAP: 12,
  BTN_W: 460, BTN_H: 50, BTN_STRIDE: 62,
  TITLE_FONT: 42, HEAD_FONT: 15, BODY_FONT: 14, SMALL_FONT: 12, BTN_FONT: 18
};

export const UI_COMPACT: UITokens = {
  PAD: 20, GAP: 10,
  BTN_W: 520, BTN_H: 46, BTN_STRIDE: 56,
  TITLE_FONT: 40, HEAD_FONT: 16, BODY_FONT: 17, SMALL_FONT: 16, BTN_FONT: 20
};

export const UI = UI_NORMAL;
export const UI_W = GAME.WINDOW_W;
export const UI_H = GAME.WINDOW_H;

/** Pick tokens from the real CSS scale (same criterion as GameScene F-06). */
export function resolveUITokens(): UITokens {
  const scale = Math.min(
    (typeof window !== 'undefined' ? window.innerWidth : GAME.WINDOW_W) / GAME.WINDOW_W,
    (typeof window !== 'undefined' ? window.innerHeight : GAME.WINDOW_H) / GAME.WINDOW_H
  );
  return scale < 0.85 ? UI_COMPACT : UI_NORMAL;
}

export type Tone = 'primary' | 'neutral' | 'danger' | 'muted';

// UI-ART-01: Survey Ink button tones. Fill = the tone; outline = its accent.
// primary = interactable protocol (cyan), danger = caution (amber, never the
// hostile vermilion), neutral / muted = graphite mass.
export const TONE: Record<Tone, number> = {
  primary: UIN.accentDeep,
  neutral: UIN.mass,
  danger: UIN.warnDeep,
  muted: UIN.panel,
};

const TONE_LINE: Record<Tone, { color: number; alpha: number; label: string }> = {
  primary: { color: UIN.accent, alpha: 0.7, label: UIC.text },
  neutral: { color: UIN.ink, alpha: 0.3, label: UIC.text },
  danger: { color: UIN.warn, alpha: 0.55, label: UIC.warn },
  muted: { color: UIN.ink, alpha: 0.18, label: UIC.muted },
};

const INK = {
  label: UIC.text,
  labelDim: '#5d594f',
  body: UIC.textMid,
  head: UIC.dim,
  muted: UIC.muted,
  focus: UIN.accent,
} as const;

/** Anything the menu can move keyboard focus through and activate. */
export interface Focusable {
  enabled: boolean;
  setFocused(focused: boolean): void;
  activate(): void;
}

export interface ButtonHandle extends Focusable {
  rect: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  /** Non-interactive focus / hover chrome (Graphics: no bounds, no input). */
  deco: Phaser.GameObjects.Graphics;
  focused: boolean;
  setLabel(text: string): void;
  setDisabled(disabled: boolean): void;
  setTone(tone: Tone): void;
}

export interface ButtonOpts {
  x?: number;
  y: number;
  label: string;
  onClick: () => void;
  w?: number;
  h?: number;
  tone?: Tone;
  disabled?: boolean;
  fontSize?: number;
  /** Optional narrower font only for compact tokens is handled by the caller. */
}

/** One interactive rectangle + one label. No separate invisible hit area, so a
 *  screen-reader-style audit sees exactly one control per button. */
export function createButton(scene: Phaser.Scene, opts: ButtonOpts, tokens: UITokens = UI_NORMAL): ButtonHandle {
  const x = opts.x ?? GAME.WINDOW_W / 2;
  const w = opts.w ?? tokens.BTN_W;
  const h = opts.h ?? tokens.BTN_H;
  let tone: Tone = opts.tone ?? 'neutral';
  const rect = scene.add.rectangle(x, opts.y, w, h, TONE[tone], 0.92)
    .setOrigin(0.5).setStrokeStyle(1, TONE_LINE[tone].color, TONE_LINE[tone].alpha);
  const label = scene.add.text(x, opts.y, opts.label, {
    fontFamily: FONT.mono,
    fontSize: `${opts.fontSize ?? tokens.BTN_FONT}px`,
    color: TONE_LINE[tone].label,
    fontStyle: 'bold',
    align: 'center',
    wordWrap: { width: w - 28, useAdvancedWrap: false }
  }).setOrigin(0.5).setLetterSpacing(2);
  // Focus / hover chrome lives in a Graphics (no bounds, never hit-tested).
  const deco = scene.add.graphics();
  let hovered = false;

  const handle: ButtonHandle = {
    rect, label, deco,
    enabled: true,
    focused: false,
    setLabel: (text: string) => { label.setText(text); },
    setDisabled: (disabled: boolean) => {
      handle.enabled = !disabled;
      // Keep the rectangle interactive even when disabled: activation is gated
      // by handle.enabled, and keeping the control/its label as one hit area
      // means a disabled button is still one control, not two overlapping
      // objects (screen-reader / audit friendly).
      if (disabled) handle.focused = false;
      paint();
    },
    setTone: (next: Tone) => { tone = next; paint(); },
    setFocused: (focused: boolean) => { handle.focused = focused; paint(); },
    activate: () => {
      if (!handle.enabled) return;
      audio.ui();
      opts.onClick();
    }
  };

  function paint(): void {
    deco.clear();
    const line = TONE_LINE[tone];
    // Local to the deco object, so a scrolled region (which moves both) stays aligned.
    const bx = rect.x - deco.x, by = rect.y - deco.y;
    const x0 = bx - w / 2, x1 = bx + w / 2, y0 = by - h / 2, y1 = by + h / 2;
    if (!handle.enabled) {
      rect.setFillStyle(UIN.panel, 0.55).setStrokeStyle(1, UIN.ink, 0.1);
      label.setColor(INK.labelDim);
      return;
    }
    if (handle.focused) {
      rect.setFillStyle(tone === 'danger' ? UIN.warnDeep : UIN.accentDeep, 1).setStrokeStyle(1.5, tone === 'danger' ? UIN.warn : INK.focus, 1);
      label.setColor(tone === 'danger' ? UIC.warn : UIC.white);
      // Outer corner ticks + a caret: focus is shape-coded, not colour-only.
      ticks(deco, x0 - 5, y0 - 5, x1 + 5, y1 + 5, 7, 0.9, tone === 'danger' ? UIN.warn : UIN.accent);
      if (w >= 120) {
        const cx = x0 + 9;
        deco.fillStyle(tone === 'danger' ? UIN.warn : UIN.accent, 1);
        deco.beginPath(); deco.moveTo(cx, by - 5); deco.lineTo(cx + 6, by); deco.lineTo(cx, by + 5); deco.closePath(); deco.fillPath();
      }
      return;
    }
    if (hovered) {
      rect.setFillStyle(tone === 'danger' ? UIN.warnDeep : UIN.massLift, 1).setStrokeStyle(1, line.color, Math.min(1, line.alpha + 0.3));
      label.setColor(tone === 'danger' ? UIC.warn : UIC.white);
      return;
    }
    rect.setFillStyle(TONE[tone], 0.92).setStrokeStyle(1, line.color, line.alpha);
    label.setColor(line.label);
    // Primary actions carry a small cyan protocol pip at the left edge.
    if (tone === 'primary') {
      deco.fillStyle(UIN.accent, 0.9);
      deco.fillRect(x0 + 1, y0 + 1, 3, h - 2);
    }
  }

  rect.setInteractive({ useHandCursor: true });
  rect.on('pointerover', () => { hovered = true; if (handle.enabled) paint(); });
  rect.on('pointerout', () => { hovered = false; paint(); });
  rect.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
    event?.stopPropagation?.();
    handle.activate();
  });
  if (opts.disabled) handle.setDisabled(true); else paint();
  return handle;
}

export interface TextOpts {
  origin?: [number, number];
  color?: string;
  fontSize?: number;
  bold?: boolean;
  letterSpacing?: number;
  wrapWidth?: number;
  align?: 'left' | 'center' | 'right';
}

/**
 * A page that owns every object it builds. `destroy()` removes them all, so a
 * hidden page never leaves interactive objects behind and re-entering a page
 * never stacks duplicates.
 */
export class MenuPage {
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  /** Public read-only view of the created button handles (test interface). */
  buttons: ButtonHandle[] = [];
  private items: Focusable[] = [];
  private focusIndex = -1;
  private keyHandlers: Array<{ event: string; fn: (event: KeyboardEvent) => void }> = [];
  private wheelHandler: ((p: Phaser.Input.Pointer, o: unknown, dx: number, dy: number) => void) | null = null;
  private region: { start: number } | null = null;
  private scene: Phaser.Scene;
  readonly tokens: UITokens;
  /** Optional per-frame refresh owned by the page builder. */
  refresh: (() => void) | null = null;

  constructor(scene: Phaser.Scene, tokens: UITokens = UI_NORMAL) {
    this.scene = scene;
    this.tokens = tokens;
  }

  text(x: number, y: number, value: string, opts: TextOpts = {}): Phaser.GameObjects.Text {
    const origin = opts.origin ?? [0.5, 0.5];
    const t = this.scene.add.text(x, y, value, {
      fontFamily: FONT.mono,
      fontSize: `${opts.fontSize ?? this.tokens.BODY_FONT}px`,
      color: opts.color ?? INK.body,
      fontStyle: opts.bold ? 'bold' : 'normal',
      align: opts.align ?? 'center',
      ...(opts.wrapWidth ? { wordWrap: { width: opts.wrapWidth, useAdvancedWrap: true } } : {})
    }).setOrigin(origin[0], origin[1]);
    if (opts.letterSpacing) t.setLetterSpacing(opts.letterSpacing);
    this.objects.push(t);
    return t;
  }

  /** Non-interactive drawing layer owned by this page (destroyed with it). */
  graphics(): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    this.objects.push(g);
    return g;
  }

  title(value: string, y: number): Phaser.GameObjects.Text {
    const t = this.text(GAME.WINDOW_W / 2, y, value, {
      fontSize: this.tokens.TITLE_FONT, color: UIC.text, bold: true, letterSpacing: 8
    });
    // Dimension marks flanking the title (never under it, so a subtitle placed
    // close below is never struck through).
    const g = this.graphics();
    const cx = GAME.WINDOW_W / 2, yy = Math.round(y) + 0.5, gap = t.width / 2 + 22;
    for (const sx of [-1, 1]) {
      g.lineStyle(1, UIN.ink, 0.32);
      g.lineBetween(cx + sx * gap, yy, cx + sx * (gap + 56), yy);
      g.lineBetween(cx + sx * (gap + 56), yy - 5, cx + sx * (gap + 56), yy + 5);
      g.fillStyle(UIN.accent, 0.85);
      g.fillRect(cx + sx * (gap - 6) - 2, yy - 2.5, 4, 4);
    }
    return t;
  }

  head(value: string, y: number, color: string = INK.head): Phaser.GameObjects.Text {
    const t = this.text(GAME.WINDOW_W / 2, y, value, {
      fontSize: this.tokens.HEAD_FONT, color, bold: true, letterSpacing: 4
    });
    // Section label set between two hairlines ("— AUDIO —").
    const g = this.graphics();
    const gap = t.width / 2 + 12;
    const yy = Math.round(y) + 0.5;
    g.lineStyle(1, UIN.ink, 0.2);
    g.lineBetween(GAME.WINDOW_W / 2 - gap - 110, yy, GAME.WINDOW_W / 2 - gap, yy);
    g.lineBetween(GAME.WINDOW_W / 2 + gap, yy, GAME.WINDOW_W / 2 + gap + 110, yy);
    return t;
  }

  button(opts: ButtonOpts): ButtonHandle {
    const handle = createButton(this.scene, opts, this.tokens);
    this.objects.push(handle.rect, handle.label, handle.deco);
    this.buttons.push(handle);
    this.items.push(handle);
    return handle;
  }

  /** Register a non-button control (e.g. an Inventory EQUIP row) in the focus
   *  order. The page's UP/DOWN/ENTER navigation treats it like a button. */
  addFocusable(item: Focusable): void {
    this.items.push(item);
  }

  /** Buttons and focusables are focusable top-to-bottom. Pointer hover only
   *  highlights; keyboard focus is owned by UP/DOWN. */
  finishButtons(): void {
    const kb = this.scene.input.keyboard;
    if (!kb) return;
    const first = this.items.findIndex((b) => b.enabled);
    if (first >= 0) this.setFocus(first);
    const move = (delta: number) => (event: KeyboardEvent) => {
      if (event.repeat) return;
      const n = this.items.length;
      if (n === 0) return;
      event.preventDefault?.();
      let i = this.focusIndex;
      for (let step = 0; step < n; step++) {
        i = (i + delta + n) % n;
        if (this.items[i]?.enabled) break;
      }
      this.setFocus(i);
    };
    const activate = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const b = this.items[this.focusIndex];
      if (!b || !b.enabled) return;
      event.preventDefault?.();
      b.activate();
    };
    this.bind('keydown-UP', move(-1));
    this.bind('keydown-DOWN', move(1));
    this.bind('keydown-ENTER', activate);
  }

  private bind(event: string, fn: (event: KeyboardEvent) => void): void {
    this.scene.input.keyboard?.on(event, fn);
    this.keyHandlers.push({ event, fn });
  }

  private setFocus(index: number): void {
    this.focusIndex = index;
    this.items.forEach((b, i) => b.setFocused(i === index));
  }

  /** Focus a button by identity (used after an explicit user interaction). */
  focusButton(handle: ButtonHandle): void {
    const i = this.items.indexOf(handle);
    if (i >= 0) this.setFocus(i);
  }

  /** Begin a scrollable content region; every object created until `endRegion`
   *  belongs to the region. */
  beginRegion(): void {
    this.region = { start: this.objects.length };
  }

  /**
   * Optional wheel scroll for a content region. When the content fits inside
   * the band (the common case at every supported viewport, since Phaser FIT
   * keeps a fixed 1280x720 logical canvas) this is a no-op, so nothing ever
   * leaves the viewport. Returns whether scrolling is actually enabled.
   */
  endRegion(bandBottom: number, contentBottom?: number): boolean {
    const region = this.region;
    this.region = null;
    if (!region) return false;
    const items = this.objects.slice(region.start).map((o) => ({
      o: o as unknown as { y: number },
      y0: (o as unknown as { y: number }).y
    }));
    if (items.length === 0) return false;
    const bottom = contentBottom ?? Math.max(...items.map((it) => it.y0 + 24));
    const max = Math.max(0, bottom - bandBottom);
    if (max <= 0) return false;
    let offset = 0;
    this.wheelHandler = (_p, _o, _dx, dy) => {
      // Wheel down (positive deltaY) moves content UP, so the offset is negative.
      offset = Phaser.Math.Clamp(offset - Math.sign(dy) * 24, -max, 0);
      for (const it of items) it.o.y = it.y0 + offset;
    };
    this.scene.input.on('wheel', this.wheelHandler);
    return true;
  }

  destroy(): void {
    for (const { event, fn } of this.keyHandlers) this.scene.input.keyboard?.off(event, fn);
    this.keyHandlers = [];
    if (this.wheelHandler) this.scene.input.off('wheel', this.wheelHandler);
    this.wheelHandler = null;
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    this.items = [];
    this.buttons = [];
    this.focusIndex = -1;
    this.refresh = null;
  }
}

export const UI_INK = INK;
