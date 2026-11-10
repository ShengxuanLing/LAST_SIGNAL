import Phaser from 'phaser';
import { GAME } from '../config/game';

export class PreloadScene extends Phaser.Scene {
  constructor() { super('PreloadScene'); }

  create(): void {
    const cx = GAME.WINDOW_W / 2, cy = GAME.WINDOW_H / 2;
    this.add.text(cx, cy - 40, 'LAST SIGNAL', {
      fontFamily: 'monospace', fontSize: '48px', color: '#33e0ff',
      fontStyle: 'bold', letterSpacing: 6
    }).setOrigin(0.5, 0.5);
    this.add.text(cx, cy - 6, 'INITIALIZING COMBAT SYSTEMS', {
      fontFamily: 'monospace', fontSize: '16px', color: '#8fb8c8'
    }).setOrigin(0.5, 0.5);

    // Progress bar (fake: graphics already built in Boot; represent completion).
    const bw = 320, bh = 12, bx = cx - bw / 2, by = cy + 20;
    this.add.rectangle(bx, by, bw, bh, 0x0d1822).setOrigin(0.5, 0.5);
    const bar = this.add.rectangle(bx, by, 2, bh, 0x33e0ff).setOrigin(0, 0.5);
    const t = this.add.tween({
      targets: bar, scaleX: bw / 2, duration: 600, ease: 'Cubic.easeOut',
      onComplete: () => this.scene.start('MainMenuScene')
    });
  }
}
