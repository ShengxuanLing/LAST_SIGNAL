import Phaser from 'phaser';
import { GAME } from '../config/game';
import { saveSystem, game } from '../main';
import { audio } from '../systems/AudioSystem';

export class GameOverScene extends Phaser.Scene {
  constructor() { super('GameOverScene'); }

  create(config: { seed: number; killCount?: number; dmg?: number; won?: boolean }): void {
    const won = config?.won === true;
    const killCount = config?.killCount ?? 0;
    const dmg = config?.dmg ?? 0;
    const seed = config?.seed ?? 0;

    // Finalize the run on the permanent save.
    const save = saveSystem.load();
    save.permanent.runs += 1;
    save.stats.enemiesKilled += killCount;
    save.stats.damageDealt += dmg;
    save.stats.playTimeSeconds += Math.floor((this.time.now) / 1000);
    if (won) {
      save.permanent.bossesDefeated += 1;
      // reward: unlock remaining weapons
      for (const w of ['scatter', 'plasma', 'arc']) {
        if (!save.permanent.unlockedWeapons.includes(w)) save.permanent.unlockedWeapons.push(w);
      }
      if (seed > save.permanent.bestSeed) save.permanent.bestSeed = seed;
    }
    saveSystem.save(save);

    this.cameras.main.setBounds(0, 0, GAME.WINDOW_W, GAME.WINDOW_H);
    const bg = this.textures.get('bg');
    if (bg) this.add.image(GAME.WINDOW_W / 2, GAME.WINDOW_H / 2, bg);

    const title = won ? 'EXTRACT COMPLETE' : 'SIGNAL LOST';
    const subtitle = won ? 'You uncovered another truth.' : 'The city keeps its secrets.';
    this.add.text(GAME.WINDOW_W / 2, 120, title, {
      fontFamily: 'monospace', fontSize: '48px', color: won ? '#ffd233' : '#ff3355', fontStyle: 'bold', letterSpacing: 4
    }).setOrigin(0.5, 0.5);
    this.add.text(GAME.WINDOW_W / 2, 176, subtitle, {
      fontFamily: 'monospace', fontSize: '18px', color: '#8fb8c8'
    }).setOrigin(0.5, 0.5);

    this.add.text(GAME.WINDOW_W / 2, 250, `SEED ${seed}`, { fontFamily: 'monospace', fontSize: '14px', color: '#5a7480' }).setOrigin(0.5, 0.5);
    this.add.text(GAME.WINDOW_W / 2, 278, `KILLS ${killCount}`, { fontFamily: 'monospace', fontSize: '20px', color: '#eafaff' }).setOrigin(0.5, 0.5);
    this.add.text(GAME.WINDOW_W / 2, 306, `DMAGE DEALT ${Math.round(dmg)}`, { fontFamily: 'monospace', fontSize: '20px', color: '#eafaff' }).setOrigin(0.5, 0.5);
    this.add.text(GAME.WINDOW_W / 2, 334, `RUNS COMPLETED ${save.permanent.runs} · BOSSES ${save.permanent.bossesDefeated}`, {
      fontFamily: 'monospace', fontSize: '14px', color: '#5a7480'
    }).setOrigin(0.5, 0.5);

    if (won) {
      this.add.text(GAME.WINDOW_W / 2, 380, 'WEAPONS UNLOCKED', { fontFamily: 'monospace', fontSize: '16px', color: '#ff8a3c' }).setOrigin(0.5, 0.5);
      this.add.text(GAME.WINDOW_W / 2, 408, save.permanent.unlockedWeapons.join(' · '), { fontFamily: 'monospace', fontSize: '14px', color: '#ffd233' }).setOrigin(0.5, 0.5);
    }

    this._button(GAME.WINDOW_W / 2, 500, won ? 'NEW RUN' : 'RETRY', () => this.scene.start('GameScene'), 0x33e0ff);
    this._button(GAME.WINDOW_W / 2, 560, 'MAIN MENU', () => this.scene.start('MainMenuScene'), 0x274a55);
  }

  private _button(cx: number, y: number, label: string, cb: () => void, color: number): void {
    const w = 320;
    const g = this.add.rectangle(cx, y, w, 46, color, 0.35).setOrigin(0.5, 0.5).setStrokeStyle(2, 0x33e0ff, 0.7);
    const t = this.add.text(cx, y, label, { fontFamily: 'monospace', fontSize: '20px', color: '#eafaff', fontStyle: 'bold', letterSpacing: 3 }).setOrigin(0.5, 0.5);
    const hit = this.add.rectangle(cx, y, w, 46, 0x000000, 0).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => { audio.ui(); cb(); });
    hit.on('pointerover', () => g.setFillStyle(color, 0.6));
    hit.on('pointerout', () => g.setFillStyle(color, 0.35));
  }
}
