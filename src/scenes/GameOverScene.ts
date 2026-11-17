import Phaser from 'phaser';
import { GAME } from '../config/game';
import { saveSystem } from '../main';
import { audio } from '../systems/AudioSystem';
import { formatDuration } from '../core/formatDuration';
import { deckLabel } from '../config/dungeon';
import type { RunCheckpoint } from '../types';
import { FONT } from '../art/survey/tokens';
import { UIC, UIN } from '../ui/palette';
import { frame, sheetChrome, ticks } from '../ui/sheet';

export class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOverScene'); }

  create(config: { seed: number; stats?: RunCheckpoint['stats']; won?: boolean; coreAwarded?: boolean; deck?: number }): void {
    const won = config?.won === true;
    const { kills, damage, items, elapsedSeconds } = config?.stats ?? {
      kills: 0, damage: 0, items: 0, elapsedSeconds: 0
    };
    const seed = config?.seed ?? 0;

    const save = saveSystem.load();

    this.cameras.main.setBounds(0, 0, GAME.WINDOW_W, GAME.WINDOW_H);
    const bg = this.textures.get('bg');
    if (bg) this.add.image(GAME.WINDOW_W / 2, GAME.WINDOW_H / 2, bg);

    // UI-ART-01: the run debrief is one sheet of the survey manual.
    sheetChrome(this.add.graphics());
    const deco = this.add.graphics();
    const cx = GAME.WINDOW_W / 2;
    const title = won ? 'EXTRACT COMPLETE' : 'SIGNAL LOST';
    const subtitle = config?.coreAwarded ? '+1 PERMANENT CORE' : won ? 'You uncovered another truth.' : 'The city keeps its secrets.';
    // Status chip: shape + colour + words (never colour alone).
    const chipText = won ? 'EXTRACTION CONFIRMED' : 'TRANSMISSION ENDED';
    const chipColor = won ? UIN.signal : UIN.warn;
    const chip = this.add.text(cx, 70, chipText, {
      fontFamily: FONT.mono, fontSize: '12px', color: won ? UIC.signal : UIC.warn, fontStyle: 'bold'
    }).setOrigin(0.5, 0.5).setLetterSpacing(4);
    deco.lineStyle(1, chipColor, 0.7);
    deco.strokeRect(Math.round(cx - chip.width / 2 - 16) + 0.5, 58.5, Math.round(chip.width + 32), 23);
    deco.fillStyle(chipColor, 1);
    deco.fillRect(Math.round(cx - chip.width / 2 - 9), 67, 5, 5);
    const titleText = this.add.text(cx, 120, title, {
      fontFamily: FONT.mono, fontSize: '48px', color: UIC.text, fontStyle: 'bold',
      shadow: { offsetX: 0, offsetY: 4, color: '#000000', blur: 10, fill: true }
    }).setOrigin(0.5, 0.5).setLetterSpacing(10);
    for (const sx of [-1, 1]) {
      const gap = titleText.width / 2 + 24;
      deco.lineStyle(1, UIN.ink, 0.32);
      deco.lineBetween(cx + sx * gap, 120.5, cx + sx * (gap + 70), 120.5);
      deco.lineBetween(cx + sx * (gap + 70), 114.5, cx + sx * (gap + 70), 126.5);
    }
    this.add.text(cx, 176, subtitle, {
      fontFamily: FONT.mono, fontSize: '16px', color: config?.coreAwarded ? UIC.rare : UIC.muted,
      fontStyle: config?.coreAwarded ? 'bold' : 'normal'
    }).setOrigin(0.5, 0.5).setLetterSpacing(config?.coreAwarded ? 4 : 1);

    // Debrief table.
    const tableBottom = won ? 434 : 356;
    frame(deco, cx - 300, 222, cx + 300, tableBottom, { fillAlpha: 0.62, lineAlpha: 0.1 });
    this.add.text(cx - 284, 234, 'DEBRIEF', { fontFamily: FONT.mono, fontSize: '10px', color: UIC.faint }).setOrigin(0, 0.5).setLetterSpacing(3);
    deco.lineStyle(1, UIN.ink, 0.12);
    deco.lineBetween(cx - 270, 264.5, cx + 270, 264.5);
    deco.lineBetween(cx - 270, 320.5, cx + 270, 320.5);

    const stage = config?.deck === undefined ? '' : ` · ${deckLabel(config.deck)}`;
    this.add.text(cx, 250, `SEED ${seed}${stage}`, { fontFamily: FONT.mono, fontSize: '13px', color: UIC.dim }).setOrigin(0.5, 0.5).setLetterSpacing(2);
    this.add.text(cx, 280, `KILLS ${kills} · DAMAGE DEALT ${Math.round(damage)}`, { fontFamily: FONT.mono, fontSize: '19px', color: UIC.text, fontStyle: 'bold' }).setOrigin(0.5, 0.5);
    this.add.text(cx, 304, `ITEMS COLLECTED ${items} · TIME ${formatDuration(elapsedSeconds)}`, { fontFamily: FONT.mono, fontSize: '19px', color: UIC.text, fontStyle: 'bold' }).setOrigin(0.5, 0.5);
    this.add.text(cx, 338, `RUNS COMPLETED ${save.permanent.runs} · BOSSES ${save.permanent.bossesDefeated}`, {
      fontFamily: FONT.mono, fontSize: '13px', color: UIC.dim
    }).setOrigin(0.5, 0.5).setLetterSpacing(1);

    if (won) {
      deco.lineBetween(cx - 270, 358.5, cx + 270, 358.5);
      const head = this.add.text(cx, 380, 'WEAPONS UNLOCKED', { fontFamily: FONT.mono, fontSize: '12px', color: UIC.dim, fontStyle: 'bold' }).setOrigin(0.5, 0.5).setLetterSpacing(4);
      deco.lineBetween(cx - head.width / 2 - 70, 380.5, cx - head.width / 2 - 12, 380.5);
      deco.lineBetween(cx + head.width / 2 + 12, 380.5, cx + head.width / 2 + 70, 380.5);
      this.add.text(cx, 408, save.permanent.unlockedWeapons.join(' · '), { fontFamily: FONT.mono, fontSize: '15px', color: UIC.rare, fontStyle: 'bold' }).setOrigin(0.5, 0.5).setLetterSpacing(2);
    }

    this._button(GAME.WINDOW_W / 2, 500, won ? 'NEW RUN' : 'RETRY SAME SEED', () => {
      const nextSeed = won ? undefined : seed;
      const next = { seed: nextSeed, sectorRun: config?.deck !== undefined };
      if (saveSystem.load().run) this.scene.start('MainMenuScene', { view: 'replace', ...next });
      else this.scene.start('GameScene', next);
    }, true);
    this._button(GAME.WINDOW_W / 2, 560, 'MAIN MENU', () => this.scene.start('MainMenuScene', {}), false);
  }

  private _button(cx: number, y: number, label: string, cb: () => void, primary: boolean): void {
    const w = 320;
    const fill = primary ? UIN.accentDeep : UIN.mass;
    const line = primary ? UIN.accent : UIN.ink;
    const lineAlpha = primary ? 0.7 : 0.3;
    const g = this.add.rectangle(cx, y, w, 46, fill, 0.92).setOrigin(0.5, 0.5).setStrokeStyle(1, line, lineAlpha);
    const t = this.add.text(cx, y, label, { fontFamily: FONT.mono, fontSize: '19px', color: UIC.text, fontStyle: 'bold' }).setOrigin(0.5, 0.5).setLetterSpacing(4);
    const fx = this.add.graphics();
    const rest = () => {
      fx.clear();
      if (primary) { fx.fillStyle(UIN.accent, 0.9); fx.fillRect(cx - w / 2 + 1, y - 22, 3, 44); }
    };
    rest();
    const hit = this.add.rectangle(cx, y, w, 46, 0x000000, 0).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => { audio.ui(); cb(); });
    hit.on('pointerover', () => {
      g.setFillStyle(primary ? UIN.accentDeep : UIN.massLift, 1).setStrokeStyle(1.5, UIN.accent, 1);
      t.setColor(UIC.white);
      ticks(fx, cx - w / 2 - 5, y - 28, cx + w / 2 + 5, y + 28, 7, 0.9, UIN.accent);
    });
    hit.on('pointerout', () => { g.setFillStyle(fill, 0.92).setStrokeStyle(1, line, lineAlpha); t.setColor(UIC.text); rest(); });
  }
}
