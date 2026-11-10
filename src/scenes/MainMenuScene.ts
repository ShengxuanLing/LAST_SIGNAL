import Phaser from 'phaser';
import { GAME, SAVE_VERSION } from '../config/game';
import { saveSystem } from '../main';
import { audio } from '../systems/AudioSystem';

export class MainMenuScene extends Phaser.Scene {
  constructor() { super('MainMenuScene'); }

  create(): void {
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
    this.add.text(cx, 250, `VERSION ${SAVE_VERSION} · RUNS ${save.permanent.runs} · BOSSES ${save.permanent.bossesDefeated}`, {
      fontFamily: 'monospace', fontSize: '13px', color: '#5a7480'
    }).setOrigin(0.5, 0.5);

    const menuY = 340;
    this._button(cx, menuY, 'NEW RUN', 360, () => this.scene.start('GameScene'), 0x33e0ff);
    this._button(cx, menuY + 60, 'LOAD RUN · 暂未实现', 360, () => {
      this._flash('暂未实现：读档尚未实现 (NOT IMPLEMENTED)');
    }, 0x1a2830, true);
    this._button(cx, menuY + 120, 'CONTINUE · 暂未实现', 360, () => {
      this._flash('暂未实现：读档尚未实现 (NOT IMPLEMENTED)');
    }, 0x1a2830, true);

    this.add.text(cx, GAME.WINDOW_H - 30, 'WASD move · MOUSE aim · CLICK fire · SPACE dash · F interact · I inventory · ESC pause', {
      fontFamily: 'monospace', fontSize: '13px', color: '#48606b'
    }).setOrigin(0.5, 0.5);

    this._continueState = { title, scanlines: this.scanlines };
  }

  scanlines: Phaser.GameObjects.Graphics | null = null;
  _continueState: any = null;

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
    const t = this.add.text(GAME.WINDOW_W / 2, 540, msg, { fontFamily: 'monospace', fontSize: '14px', color: '#ff8a3c' }).setOrigin(0.5, 0.5).setDepth(10);
    this.time.addEvent({ delay: 1800, callback: () => t.destroy() });
  }

  update(): void {
    if (this.scanlines) this.drawScanlines();
  }
}
