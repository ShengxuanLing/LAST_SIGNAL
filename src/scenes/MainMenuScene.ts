import Phaser from 'phaser';
import { GAME, SAVE_VERSION } from '../config/game';
import { WEAPONS } from '../config/weapons';
import { formatDuration } from '../core/formatDuration';
import { saveSystem } from '../main';
import { audio } from '../systems/AudioSystem';
import { PERMANENT_TALENT_CAP, PERMANENT_TALENTS } from '../systems/SaveSystem';

interface MenuConfig {
  view?: 'checkpoint' | 'permanent' | 'replace';
  notice?: string;
  seed?: number;
}

export class MainMenuScene extends Phaser.Scene {
  constructor() { super('MainMenuScene'); }

  create(config: MenuConfig = {}): void {
    this.cameras.main.setBounds(0, 0, GAME.WINDOW_W, GAME.WINDOW_H);
    const bg = this.textures.get('bg');
    if (bg) this.add.image(GAME.WINDOW_W / 2, GAME.WINDOW_H / 2, bg);

    // Animated scanline overlay
    this.scanlines = this.add.graphics();
    this.drawScanlines();
    this._scanTween();

    const cx = GAME.WINDOW_W / 2;
    const title = this.add.text(cx, 150, 'LAST SIGNAL', {
      fontFamily: 'monospace', fontSize: '64px', color: '#33e0ff',
      fontStyle: 'bold', letterSpacing: 8, shadow: { offsetX: 0, offsetY: 3, color: '#0b7d99', blur: 6 }
    }).setOrigin(0.5, 0.5);
    this.add.text(cx, 210, 'SIGNAL LOST. SIGNAL REMAINS.', {
      fontFamily: 'monospace', fontSize: '16px', color: '#ff8a3c', letterSpacing: 3
    }).setOrigin(0.5, 0.5);

    const save = saveSystem.load();
    if (config.view === 'permanent') {
      this.line(cx, 260, `PERMANENT CORES: ${save.permanent.cores}`, '#ffd233');
      this.line(cx, 292, 'Earn one core per boss victory. Talents apply to new runs.');
      PERMANENT_TALENTS.forEach(({ key, label, effect }, index) => {
        const rank = save.permanent[key];
        const locked = rank >= PERMANENT_TALENT_CAP || save.permanent.cores < 1;
        this._button(cx, 338 + index * 54, `${label} ${rank} · ${effect} · 1 CORE`, 520, () => {
          if (locked) return;
          if (saveSystem.buyTalent(key)) this.scene.restart({ view: 'permanent' });
          else this._flash('TALENT PURCHASE NOT SAVED');
        }, 0x274a55, locked);
      });
      this.line(cx, 490, `UNLOCKED WEAPONS: ${save.permanent.unlockedWeapons.join(' · ').toUpperCase()}`);
      this._button(cx, 586, 'BACK', 360, () => this.scene.restart({}), 0x274a55);
      return;
    }

    if (config.view === 'checkpoint' && save.run) {
      const { player, clearedRooms, seed, stats } = save.run;
      this.line(cx, 266, `CHECKPOINT · SEED ${seed}`, '#33e0ff');
      this.line(cx, 305, `ROOMS CLEARED ${clearedRooms.length} · LEVEL ${player.level} · RUN CREDITS ${player.currency}`);
      this.line(cx, 336, `RUN UPGRADES ${player.upgrades.length} · HP ${Math.ceil(player.hp)}/${player.maxHp}`);
      this.line(cx, 367, `EQUIPPED ${WEAPONS[player.weaponKey].name} · TIME ${formatDuration(stats.elapsedSeconds)}`);
      this._button(cx, 420, 'RESUME CHECKPOINT', 360, () => this.scene.start('GameScene', { resume: true }), 0x33e0ff);
      this._button(cx, 480, 'BACK', 360, () => this.scene.restart({}), 0x274a55);
      return;
    }

    if (config.view === 'replace') {
      this.line(cx, 287, 'STARTING OVER REPLACES THE CURRENT RUN CHECKPOINT.', '#ff8a3c');
      this.line(cx, 323, 'Permanent cores, talents and weapon unlocks are kept.');
      this._button(cx, 400, 'REPLACE AND START', 360, () => this.scene.start('GameScene', { seed: config.seed }), 0x5a2a3a);
      this._button(cx, 460, 'BACK', 360, () => this.scene.restart({}), 0x274a55);
      return;
    }

    this.add.text(cx, 250, `VERSION ${SAVE_VERSION} · RUNS ${save.permanent.runs} · BOSSES ${save.permanent.bossesDefeated}`, {
      fontFamily: 'monospace', fontSize: '13px', color: '#5a7480'
    }).setOrigin(0.5, 0.5);

    const menuY = 340;
    this._button(cx, menuY, 'NEW RUN', 360, () => {
      if (saveSystem.load().run) this.scene.restart({ view: 'replace' });
      else this.scene.start('GameScene', {});
    }, 0x33e0ff);
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
    if (config.notice) this._flash(config.notice);

    this.add.text(cx, GAME.WINDOW_H - 30, 'WASD move · MOUSE aim · CLICK fire · SPACE dash · F interact · I inventory · ESC pause', {
      fontFamily: 'monospace', fontSize: '13px', color: '#48606b'
    }).setOrigin(0.5, 0.5);

    this._continueState = { title, scanlines: this.scanlines };
  }

  scanlines: Phaser.GameObjects.Graphics | null = null;
  _continueState: any = null;

  private line(x: number, y: number, message: string, color = '#8fb8c8'): void {
    this.add.text(x, y, message, { fontFamily: 'monospace', fontSize: '16px', color }).setOrigin(0.5);
  }

  private drawScanlines(): void {
    this.scanlines?.clear();
    this.scanlines?.lineStyle(1, 0x33e0ff, 0.04);
    for (let y = 0; y < GAME.WINDOW_H; y += 4) {
      this.scanlines?.lineBetween(0, y, GAME.WINDOW_W, y);
    }
  }

  private _scanTween(): void {
    let phase = 0;
    this.time.addEvent({
      delay: 40, repeat: -1,
      callback: () => {
        phase = (phase + 1) % 5;
        this.drawScanlines();
      }
    });
  }

  private _button(cx: number, y: number, label: string, w: number, cb: () => void, color: number, dim = false): void {
    const fillAlpha = dim ? 0.16 : 0.35;
    const g = this.add.rectangle(cx, y, w, 46, color, fillAlpha).setOrigin(0.5, 0.5)
      .setStrokeStyle(2, dim ? 0x3d535d : 0x33e0ff, dim ? 0.4 : 0.7);
    const t = this.add.text(cx, y, label, {
      fontFamily: 'monospace', fontSize: dim ? '17px' : '20px',
      color: dim ? '#5a7480' : '#eafaff', fontStyle: 'bold', letterSpacing: dim ? 1 : 3
    }).setOrigin(0.5, 0.5);
    const hit = this.add.rectangle(cx, y, w, 46, 0x000000, 0).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => { audio.ui(); cb(); });
    hit.on('pointerover', () => { g.setFillStyle(color, dim ? 0.26 : 0.6); });
    hit.on('pointerout', () => { g.setFillStyle(color, fillAlpha); });
  }

  private _flash(msg: string): void {
    const t = this.add.text(GAME.WINDOW_W / 2, 625, msg, { fontFamily: 'monospace', fontSize: '14px', color: '#ff8a3c' }).setOrigin(0.5, 0.5).setDepth(10);
    this.time.addEvent({ delay: 1800, callback: () => t.destroy() });
  }

  update(): void {
    if (this.scanlines) this.drawScanlines();
  }
}
