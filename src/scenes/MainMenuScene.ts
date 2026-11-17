import Phaser from 'phaser';
import { GAME, SAVE_VERSION } from '../config/game';
import { WEAPONS } from '../config/weapons';
import { formatDuration } from '../core/formatDuration';
import { APPEARANCES, availableAvatars, resolveAvatar } from '../core/PlayerAppearance';
import { WHALE_TEXTURE } from '../core/WhaleCharacter';
import { deckLabel } from '../config/dungeon';
import { saveSystem } from '../main';
import { audio } from '../systems/AudioSystem';
import { PERMANENT_TALENT_CAP, PERMANENT_TALENTS } from '../systems/SaveSystem';
import { FONT } from '../art/survey/tokens';
import { UIC, UIN } from '../ui/palette';
import { dashed, frame, sheetChrome, ticks } from '../ui/sheet';

const PRIMARY = 0x33e0ff;
const DANGER = 0x5a2a3a;

interface MenuConfig {
  view?: 'checkpoint' | 'permanent' | 'replace';
  notice?: string;
  seed?: number;
  sectorRun?: boolean;
}

export class MainMenuScene extends Phaser.Scene {
  constructor() { super('MainMenuScene'); }

  create(config: MenuConfig = {}): void {
    this.cameras.main.setBounds(0, 0, GAME.WINDOW_W, GAME.WINDOW_H);
    const bg = this.textures.get('bg');
    if (bg) this.add.image(GAME.WINDOW_W / 2, GAME.WINDOW_H / 2, bg);

    // UI-ART-01: the title page is sheet 00 of the field survey manual.
    this.relay = false;
    const chrome = this.add.graphics();
    sheetChrome(chrome);
    this.deco = this.add.graphics();
    this.pulse = this.add.graphics();

    const cx = GAME.WINDOW_W / 2;
    this.add.text(cx, 96, 'ZERO STATION  ·  FIELD SURVEY MANUAL  ·  EX-17', {
      fontFamily: FONT.mono, fontSize: '12px', color: UIC.dim
    }).setOrigin(0.5, 0.5).setLetterSpacing(4);
    const title = this.add.text(cx, 150, 'LAST SIGNAL', {
      fontFamily: FONT.mono, fontSize: '64px', color: UIC.text,
      fontStyle: 'bold', shadow: { offsetX: 0, offsetY: 4, color: '#000000', blur: 10, fill: true }
    }).setOrigin(0.5, 0.5).setLetterSpacing(16);
    {
      const g = this.deco, gap = title.width / 2 + 26, y = 150.5;
      for (const sx of [-1, 1]) {
        g.lineStyle(1, UIN.ink, 0.35);
        g.lineBetween(cx + sx * gap, y, cx + sx * (gap + 90), y);
        g.lineBetween(cx + sx * (gap + 90), y - 7, cx + sx * (gap + 90), y + 7);
        g.fillStyle(UIN.accent, 0.9);
        g.fillRect(cx + sx * (gap - 8) - 2.5, y - 2.5, 5, 5);
      }
      dashed(g, cx - 250, 186.5, cx + 250, 186.5, 2, 5, 0.25);
    }
    this.add.text(cx, 210, 'SIGNAL LOST. SIGNAL REMAINS.', {
      fontFamily: FONT.mono, fontSize: '15px', color: UIC.muted
    }).setOrigin(0.5, 0.5).setLetterSpacing(6);

    const save = saveSystem.load();
    if (config.view === 'permanent') {
      frame(this.deco, cx - 330, 228, cx + 330, 620, { fillAlpha: 0.6, lineAlpha: 0.1 });
      this.caption(cx - 314, 240, 'SHEET 02 · PERMANENT RECORD');
      this.line(cx, 260, `PERMANENT CORES: ${save.permanent.cores}`, UIC.rare);
      this.line(cx, 292, 'Earn one core per boss victory. Talents apply to new runs.');
      PERMANENT_TALENTS.forEach(({ key, label, effect }, index) => {
        const rank = save.permanent[key];
        const locked = rank >= PERMANENT_TALENT_CAP || save.permanent.cores < 1;
        this._button(cx, 338 + index * 54, `${label} ${rank} · ${effect} · 1 CORE`, 520, () => {
          if (locked) return;
          if (saveSystem.buyTalent(key)) this.scene.restart({ view: 'permanent' });
          else this._flash('TALENT PURCHASE NOT SAVED');
        }, 0x274a55, locked);
        this.index(cx - 272, 338 + index * 54, index + 1, locked);
      });
      this.line(cx, 490, `UNLOCKED WEAPONS: ${save.permanent.unlockedWeapons.join(' · ').toUpperCase()}`);
      this._button(cx, 586, 'BACK', 360, () => this.scene.restart({}), 0x274a55);
      return;
    }

    if (config.view === 'checkpoint' && save.run) {
      frame(this.deco, cx - 330, 228, cx + 330, 516, { fillAlpha: 0.6, lineAlpha: 0.1 });
      this.caption(cx - 314, 240, 'SHEET 03 · SAFE CHECKPOINT');
      const { player, clearedRooms, seed, stats, deck } = save.run;
      this.line(cx, 266, `CHECKPOINT · SEED ${seed}`, UIC.text);
      const stage = deck === undefined ? '' : `${deckLabel(deck)} · `;
      this.line(cx, 305, `${stage}ROOMS CLEARED ${clearedRooms.length} · LEVEL ${player.level} · RUN CREDITS ${player.currency}`);
      this.line(cx, 336, `RUN UPGRADES ${player.upgrades.length} · HP ${Math.ceil(player.hp)}/${player.maxHp}`);
      this.line(cx, 367, `EQUIPPED ${WEAPONS[player.weaponKey].name} · TIME ${formatDuration(stats.elapsedSeconds)}`);
      this._button(cx, 420, 'RESUME CHECKPOINT', 360, () => this.scene.start('GameScene', { resume: true }), PRIMARY);
      this._button(cx, 480, 'BACK', 360, () => this.scene.restart({}), 0x274a55);
      return;
    }

    if (config.view === 'replace') {
      frame(this.deco, cx - 330, 252, cx + 330, 496, { fillAlpha: 0.6, lineAlpha: 0.1, line: UIN.warn, tickAlpha: 0.7 });
      this.line(cx, 287, 'STARTING OVER REPLACES THE CURRENT RUN CHECKPOINT.', UIC.warn);
      this.line(cx, 323, 'Permanent cores, talents and weapon unlocks are kept.');
      this._button(cx, 400, 'REPLACE AND START', 360, () => this.scene.start('GameScene', {
        seed: config.seed, sectorRun: config.sectorRun
      }), DANGER);
      this._button(cx, 460, 'BACK', 360, () => this.scene.restart({}), 0x274a55);
      return;
    }

    this.add.text(cx, 250, `VERSION ${SAVE_VERSION} · RUNS ${save.permanent.runs} · BOSSES ${save.permanent.bossesDefeated}`, {
      fontFamily: FONT.mono, fontSize: '12px', color: UIC.dim
    }).setOrigin(0.5, 0.5).setLetterSpacing(2);

    const menuY = 340;
    this._button(cx, menuY, 'NEW RUN', 360, () => {
      if (saveSystem.load().run) this.scene.restart({ view: 'replace' });
      else this.scene.start('GameScene', {});
    }, PRIMARY);
    this._button(cx, menuY + 60, 'LOAD RUN', 360, () => {
      if (saveSystem.load().run) this.scene.restart({ view: 'checkpoint' });
      else this._flash('NO CHECKPOINT AVAILABLE');
    }, 0x274a55, !save.run);
    this._button(cx, menuY + 120, 'CONTINUE', 360, () => {
      if (saveSystem.load().run) this.scene.start('GameScene', { resume: true });
      else this._flash('NO CHECKPOINT AVAILABLE');
    }, 0x274a55, !save.run);
    this._button(cx, menuY + 180, `PERMANENT TALENTS · ${save.permanent.cores} CORES`, 450, () => {
      this.scene.restart({ view: 'permanent' });
    }, 0x274a55);
    this._button(cx, menuY + 240, 'SECTOR RUN', 360, () => {
      if (saveSystem.load().run) this.scene.restart({ view: 'replace', sectorRun: true });
      else this.scene.start('GameScene', { sectorRun: true });
    }, PRIMARY);
    [0, 1, 2, 3, 4].forEach((i) => this.index(cx - 237, menuY + i * 60, i + 1, (i === 1 || i === 2) && !save.run));
    const avatarX = 1000;
    const avatar = resolveAvatar(save.settings.avatar, this.textures);
    const appearance = APPEARANCES[avatar];
    frame(this.deco, avatarX - 120, 304, avatarX + 120, 604, { fillAlpha: 0.55, lineAlpha: 0.1 });
    this.add.text(avatarX, 328, 'PLAYER APPEARANCE', {
      fontFamily: FONT.mono, fontSize: '13px', color: UIC.dim, fontStyle: 'bold'
    }).setOrigin(0.5).setLetterSpacing(3);
    // Survey pad under the executor: iso diamond + dashed inner ring.
    {
      const g = this.deco, py = 440;
      g.fillStyle(0x000000, 0.45); g.fillEllipse(avatarX, py, 84, 24);
      g.lineStyle(1, UIN.ink, 0.35);
      g.strokePoints([{ x: avatarX - 56, y: py }, { x: avatarX, y: py - 18 }, { x: avatarX + 56, y: py }, { x: avatarX, y: py + 18 }], true);
      for (const [x0, y0, x1, y1] of [[-32, 0, 0, -10], [0, -10, 32, 0], [32, 0, 0, 10], [0, 10, -32, 0]]) {
        dashed(g, avatarX + x0, py + y0, avatarX + x1, py + y1, 2, 3, 0.3, UIN.accent);
      }
    }
    {
      const avatars = availableAvatars(this.textures);
      const at = Math.max(0, avatars.indexOf(avatar));
      this.deco!.lineStyle(1, UIN.ink, 0.14);
      this.deco!.lineBetween(avatarX - 104, 536.5, avatarX + 104, 536.5);
      this.add.text(avatarX, 556, `PROFILE ${at + 1} / ${avatars.length}`, {
        fontFamily: FONT.mono, fontSize: '12px', color: UIC.muted, fontStyle: 'bold'
      }).setOrigin(0.5).setLetterSpacing(3);
      this.add.text(avatarX, 578, 'SAVED IN THIS BROWSER', {
        fontFamily: FONT.mono, fontSize: '10px', color: UIC.faint
      }).setOrigin(0.5).setLetterSpacing(2);
    }
    this.drawRelay();
    const preview = this.add.image(avatarX, 406, appearance.textures[0]);
    preview.setScale((avatar === 'operator' ? 74 : 124) / preview.height);
    this._button(avatarX, 490, `${appearance.label} ↻`, 208, () => {
      const avatars = availableAvatars(this.textures);
      if (avatars.length <= 1) { this._flash('CHARACTER ART UNAVAILABLE'); return; }
      const latest = saveSystem.load();
      const current = resolveAvatar(latest.settings.avatar, this.textures);
      latest.settings.avatar = avatars[(avatars.indexOf(current) + 1) % avatars.length];
      if (saveSystem.save(latest)) this.scene.restart({});
      else this._flash('APPEARANCE NOT SAVED');
    }, 0x274a55);
    if (config.notice) this._flash(config.notice);

    this.add.text(cx, GAME.WINDOW_H - 34, 'WASD MOVE  ·  MOUSE AIM  ·  CLICK FIRE  ·  SPACE DASH  ·  F INTERACT  ·  I INVENTORY  ·  ESC PAUSE', {
      fontFamily: FONT.mono, fontSize: '12px', color: UIC.faint
    }).setOrigin(0.5, 0.5).setLetterSpacing(1);

    this._continueState = { title, scanlines: this.scanlines };
  }

  scanlines: Phaser.GameObjects.Graphics | null = null;
  _continueState: any = null;
  private deco: Phaser.GameObjects.Graphics | null = null;
  private pulse: Phaser.GameObjects.Graphics | null = null;
  private relay = false;

  private line(x: number, y: number, message: string, color: string = UIC.muted): void {
    this.add.text(x, y, message, { fontFamily: FONT.mono, fontSize: '16px', color }).setOrigin(0.5);
  }

  /** Small sheet caption (top-left of a framed card). */
  private caption(x: number, y: number, message: string): void {
    this.add.text(x, y, message, { fontFamily: FONT.mono, fontSize: '11px', color: UIC.faint }).setOrigin(0, 0.5).setLetterSpacing(3);
  }

  /** Manual index number to the left of a menu entry ("01"). */
  private index(x: number, y: number, n: number, dim: boolean): void {
    this.add.text(x, y, String(n).padStart(2, '0'), {
      fontFamily: FONT.mono, fontSize: '13px', color: dim ? '#4a473f' : UIC.dim, fontStyle: 'bold'
    }).setOrigin(1, 0.5);
  }

  /**
   * Left companion panel: relay R-2 drawn as a survey schematic. The scan
   * rings are the only motion on the title page (Scan = a survey act).
   */
  private drawRelay(): void {
    const g = this.deco!;
    const x = 260, base = 462, top = 362;
    frame(g, x - 120, 304, x + 120, 604, { fillAlpha: 0.55, lineAlpha: 0.1 });
    this.add.text(x, 328, 'RELAY R-2', {
      fontFamily: FONT.mono, fontSize: '13px', color: UIC.dim, fontStyle: 'bold'
    }).setOrigin(0.5).setLetterSpacing(3);
    // base plinth (iso diamond with a visible thickness)
    g.fillStyle(UIN.massLift, 1);
    g.fillPoints([{ x: x - 44, y: base }, { x, y: base - 16 }, { x: x + 44, y: base }, { x, y: base + 16 }], true);
    g.fillStyle(UIN.mass, 1);
    g.fillPoints([{ x: x - 44, y: base }, { x, y: base + 16 }, { x, y: base + 24 }, { x: x - 44, y: base + 8 }], true);
    g.fillStyle(0x0f1215, 1);
    g.fillPoints([{ x: x + 44, y: base }, { x, y: base + 16 }, { x, y: base + 24 }, { x: x + 44, y: base + 8 }], true);
    g.lineStyle(1, UIN.ink, 0.55);
    g.strokePoints([{ x: x - 44, y: base }, { x, y: base - 16 }, { x: x + 44, y: base }, { x, y: base + 16 }], true);
    // mast: two rails + braces
    g.lineStyle(1.5, UIN.ink, 0.75);
    g.lineBetween(x - 6, base - 4, x - 2, top); g.lineBetween(x + 6, base - 4, x + 2, top);
    g.lineStyle(1, UIN.ink, 0.35);
    for (let y = base - 16; y > top + 8; y -= 18) { g.lineBetween(x - 5, y, x + 5, y - 9); g.lineBetween(x + 5, y, x - 5, y - 9); }
    // cross arms
    g.lineStyle(1.5, UIN.ink, 0.7);
    g.lineBetween(x - 22, top + 22, x + 22, top + 22);
    g.lineBetween(x - 14, top + 40, x + 14, top + 40);
    // emitter
    g.fillStyle(UIN.signal, 1); g.fillRect(x - 3, top - 6, 6, 6);
    // dimension line (height callout)
    g.lineStyle(1, UIN.ink, 0.3);
    g.lineBetween(x + 62, top - 3, x + 62, base); g.lineBetween(x + 56, top - 3, x + 68, top - 3); g.lineBetween(x + 56, base, x + 68, base);
    dashed(g, x + 8, top - 3, x + 54, top - 3, 2, 3, 0.25);
    this.add.text(x + 70, (top + base) / 2, 'H 14.2', { fontFamily: FONT.mono, fontSize: '10px', color: UIC.faint }).setOrigin(0, 0.5);
    g.lineStyle(1, UIN.ink, 0.14);
    g.lineBetween(x - 104, 536.5, x + 104, 536.5);
    this.add.text(x, 556, 'CARRIER LOST', { fontFamily: FONT.mono, fontSize: '12px', color: UIC.warn, fontStyle: 'bold' }).setOrigin(0.5).setLetterSpacing(3);
    this.add.text(x, 578, 'LISTENING ON 7 BANDS', { fontFamily: FONT.mono, fontSize: '10px', color: UIC.faint }).setOrigin(0.5).setLetterSpacing(2);
    this.relay = true;
  }

  private drawPulse(): void {
    const g = this.pulse;
    if (!g || !this.relay) return;
    g.clear();
    const x = 260, y = 462, top = 359;
    const t = this.time.now / 1000;
    for (let k = 0; k < 3; k++) {
      const p = ((t * 0.32) + k / 3) % 1;
      const r = 18 + p * 96;
      g.lineStyle(1, UIN.signal, 0.42 * (1 - p));
      g.strokeEllipse(x, y, r * 2, r);
    }
    const blink = 0.5 + 0.5 * Math.sin(t * 3.2);
    g.fillStyle(UIN.signal, 0.12 + 0.18 * blink);
    g.fillCircle(x, top, 9);
  }

  private _button(cx: number, y: number, label: string, w: number, cb: () => void, color: number, dim = false): void {
    // UI-ART-01: same tone grammar as the pause kit (src/ui/menuKit.ts).
    const primary = color === PRIMARY, danger = color === DANGER;
    const fill = dim ? UIN.panel : primary ? UIN.accentDeep : danger ? UIN.warnDeep : UIN.mass;
    const line = dim ? UIN.ink : primary ? UIN.accent : danger ? UIN.warn : UIN.ink;
    const lineAlpha = dim ? 0.1 : primary ? 0.7 : danger ? 0.6 : 0.3;
    const fillAlpha = dim ? 0.55 : 0.92;
    const g = this.add.rectangle(cx, y, w, 46, fill, fillAlpha).setOrigin(0.5, 0.5)
      .setStrokeStyle(1, line, lineAlpha);
    const labelColor = dim ? '#5d594f' : danger ? UIC.warn : UIC.text;
    const t = this.add.text(cx, y, label, {
      fontFamily: FONT.mono, fontSize: dim ? '17px' : '19px',
      color: labelColor, fontStyle: 'bold'
    }).setOrigin(0.5, 0.5).setLetterSpacing(dim || label.length * 16 > w - 24 ? 2 : 4);
    const fx = this.add.graphics();
    if (primary && !dim) { fx.fillStyle(UIN.accent, 0.9); fx.fillRect(cx - w / 2 + 1, y - 22, 3, 44); }
    const hit = this.add.rectangle(cx, y, w, 46, 0x000000, 0).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => { audio.ui(); cb(); });
    hit.on('pointerover', () => {
      if (dim) { g.setFillStyle(UIN.mass, 0.7); return; }
      g.setFillStyle(danger ? UIN.warnDeep : primary ? UIN.accentDeep : UIN.massLift, 1).setStrokeStyle(1.5, danger ? UIN.warn : UIN.accent, 1);
      t.setColor(danger ? UIC.warn : UIC.white);
      ticks(fx, cx - w / 2 - 5, y - 28, cx + w / 2 + 5, y + 28, 7, 0.9, danger ? UIN.warn : UIN.accent);
    });
    hit.on('pointerout', () => {
      g.setFillStyle(fill, fillAlpha).setStrokeStyle(1, line, lineAlpha);
      t.setColor(labelColor);
      fx.clear();
      if (primary && !dim) { fx.fillStyle(UIN.accent, 0.9); fx.fillRect(cx - w / 2 + 1, y - 22, 3, 44); }
    });
  }

  private _flash(msg: string): void {
    const t = this.add.text(GAME.WINDOW_W / 2, 625, msg, { fontFamily: FONT.mono, fontSize: '14px', color: UIC.warn }).setOrigin(0.5, 0.5).setDepth(10).setLetterSpacing(2);
    this.time.addEvent({ delay: 1800, callback: () => t.destroy() });
  }

  update(): void {
    this.drawPulse();
  }
}
