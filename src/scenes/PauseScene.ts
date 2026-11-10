import Phaser from 'phaser';
import { GAME, DEFAULT_SETTINGS } from '../config/game';
import { UPGRADE_LIST, UPGRADES } from '../config/upgrades';
import { WEAPONS } from '../config/weapons';
import { saveSystem } from '../main';
import { audio } from '../systems/AudioSystem';
import { GameScene } from './GameScene';

export class PauseScene extends Phaser.Scene {
  constructor() { super('PauseScene'); }

  create(config?: { mode?: 'pause' | 'inventory' }): void {
    const mode = config?.mode ?? 'pause';
    const parent = this.scene.get<GameScene>('GameScene');
    const player = parent.world.player;

    // dim overlay (not interactive, so it cannot steal clicks from the buttons)
    const dim = this.add.rectangle(0, 0, GAME.WINDOW_W, GAME.WINDOW_H, 0x04060b, 0.82)
      .setOrigin(0, 0);
    dim.setAlpha(0);
    this.tweens.add({ targets: dim, alpha: 0.82, duration: 150 });

    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      this.tweens.add({ targets: dim, alpha: 0, duration: 150, onComplete: () => {
        this.scene.stop();
        if (parent) parent.onResume();
      }});
    };
    // ESC closes the overlay. Remove the listener on shutdown so scene.restart()
    // (inventory / settings back) never accumulates duplicate handlers.
    const onEsc = () => close();
    this.input.keyboard?.on('keydown-ESC', onEsc);
    this.events.once('shutdown', () => {
      this.input.keyboard?.off('keydown-ESC', onEsc);
    });

    if (mode === 'inventory') {
      this.add.text(GAME.WINDOW_W / 2, 90, 'INVENTORY', { fontFamily: 'monospace', fontSize: '30px', color: '#33e0ff', fontStyle: 'bold' }).setOrigin(0.5, 0.5);

      // weapons
      this.add.text(120, 150, 'WEAPON ARSENAL', { fontFamily: 'monospace', fontSize: '18px', color: '#ff8a3c' });
      player.data.weapons.forEach((w, i) => {
        const def = WEAPONS[w.key];
        const active = player.data.weaponKey === w.key;
        this.add.text(120, 186 + i * 44, `${def ? def.name : w.key}`, { fontFamily: 'monospace', fontSize: '18px', color: active ? '#ffd233' : '#cfe8ef' });
        this.add.text(120, 206 + i * 44, `level ${w.level} · ${w.magazine > 0 ? `${w.ammo}/${w.magazine}` : '∞ energy'}`, { fontFamily: 'monospace', fontSize: '13px', color: '#8fb8c8' });
        if (active) this.add.text(420, 186, 'EQUIPPED', { fontFamily: 'monospace', fontSize: '13px', color: '#7ff0ff' });
      });

      // stats
      const s = player.data;
      this.add.text(520, 150, 'STATS', { fontFamily: 'monospace', fontSize: '18px', color: '#ff8a3c' });
      const stats = [
        `Level ${s.level}`, `HP ${Math.ceil(s.hp)}/${s.maxHp}`, `Speed ${Math.round(s.speed)}`,
        `Damage ${s.damage.toFixed(2)}`, `Crit ${Math.round(s.critChance * 100)}%`, `Crit Dmg ${s.critDamage.toFixed(2)}x`,
        `Armor ${s.armor}`, `Pierce ${s.pierceCount}`, `Regen ${s.hpRegen}/s`, `Magnet ${Math.round(s.pickupRange)}`,
        `Credits ${s.currency}`
      ];
      stats.forEach((txt, i) => this.add.text(520, 186 + i * 26, txt, { fontFamily: 'monospace', fontSize: '15px', color: '#eafaff' }));

      // upgrades
      const activeUp = player.data.upgrades.filter((u) => u.level > 0);
      this.add.text(900, 150, 'UPGRADES', { fontFamily: 'monospace', fontSize: '18px', color: '#ff8a3c' });
      if (activeUp.length === 0) this.add.text(900, 186, 'none yet', { fontFamily: 'monospace', fontSize: '15px', color: '#8fb8c8' });
      activeUp.forEach((u, i) => {
        const def = UPGRADES[u.key];
        this.add.text(900, 186 + i * 30, `${def ? def.name : u.key}  ${u.level}/${def?.maxLevel ?? 1}`, { fontFamily: 'monospace', fontSize: '15px', color: '#eafaff' });
      });

      this._button(GAME.WINDOW_W / 2, GAME.WINDOW_H - 60, 'CLOSE', close, 0x274a55);
    } else {
      // pause menu
      this.add.text(GAME.WINDOW_W / 2, 150, 'PAUSED', { fontFamily: 'monospace', fontSize: '48px', color: '#33e0ff', fontStyle: 'bold', letterSpacing: 6 }).setOrigin(0.5, 0.5);
      this._button(GAME.WINDOW_W / 2, 300, 'RESUME', close, 0x33e0ff);
      this._button(GAME.WINDOW_W / 2, 360, 'INVENTORY', () => this.scene.restart({ mode: 'inventory' }), 0x274a55);
      this._button(GAME.WINDOW_W / 2, 420, 'SETTINGS', () => this.showSettings(), 0x274a55);
      this._button(GAME.WINDOW_W / 2, 480, 'QUIT TO MENU', () => {
        // scene.start() only shuts down the calling scene; GameScene would stay
        // active (and paused) underneath the menu. Stop it explicitly so a later
        // NEW RUN boots a fresh, unpaused run.
        this.scene.stop('GameScene');
        this.scene.start('MainMenuScene');
      }, 0x5a2a3a);
    }
  }

  private showSettings(): void {
    const save = saveSystem.load();
    // Transparent input blocker: Phaser input is top-only, so this swallows clicks
    // that would otherwise land on the pause-menu buttons underneath.
    const blocker = this.add.rectangle(0, 0, GAME.WINDOW_W, GAME.WINDOW_H, 0x000000, 0)
      .setOrigin(0, 0).setInteractive();
    const wrap = this.add.container(GAME.WINDOW_W / 2, 300);

    const vol = this.add.text(0, 0, `MASTER ${Math.round(save.settings.masterVolume * 100)}%`, { fontFamily: 'monospace', fontSize: '18px', color: '#eafaff' }).setOrigin(0.5, 0.5);
    const sfx = this.add.text(0, 40, `SFX ${Math.round(save.settings.sfxVolume * 100)}%`, { fontFamily: 'monospace', fontSize: '18px', color: '#eafaff' }).setOrigin(0.5, 0.5);
    wrap.add([vol, sfx]);

    const arrow = (x: number, y: number, label: string) => this.add.text(x, y, label, {
      fontFamily: 'monospace', fontSize: '24px', color: '#33e0ff', backgroundColor: '#0d1822'
    }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    const masterLeft = arrow(-160, 0, '◀');
    const masterRight = arrow(160, 0, '▶');
    const sfxLeft = arrow(-160, 40, '◀');
    const sfxRight = arrow(160, 40, '▶');
    wrap.add([masterLeft, masterRight, sfxLeft, sfxRight]);

    let master = save.settings.masterVolume;
    let sfxVol = save.settings.sfxVolume;
    const apply = () => {
      vol.setText(`MASTER ${Math.round(master * 100)}%`);
      sfx.setText(`SFX ${Math.round(sfxVol * 100)}%`);
      audio.setVolumes(master, sfxVol);
      save.settings.masterVolume = master;
      save.settings.sfxVolume = sfxVol;
      saveSystem.save(save);
    };
    const step = (v: number, delta: number) => Math.max(0, Math.min(1, Math.round((v + delta) * 10) / 10));
    masterLeft.on('pointerdown', () => { master = step(master, -0.1); apply(); audio.ui(); });
    masterRight.on('pointerdown', () => { master = step(master, 0.1); apply(); audio.ui(); });
    sfxLeft.on('pointerdown', () => { sfxVol = step(sfxVol, -0.1); apply(); audio.ui(); });
    sfxRight.on('pointerdown', () => { sfxVol = step(sfxVol, 0.1); apply(); audio.ui(); });

    const hint = this.add.text(0, 135, '◀ / ▶ ADJUST VOLUME · ESC RESUME', { fontFamily: 'monospace', fontSize: '12px', color: '#48606b' }).setOrigin(0.5, 0.5);
    const back = this.add.text(0, 90, 'BACK', { fontFamily: 'monospace', fontSize: '14px', color: '#8fb8c8', backgroundColor: '#0d1822' }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    wrap.add([hint, back]);
    const closeBack = () => { audio.ui(); blocker.destroy(); wrap.destroy(); this.scene.restart({ mode: 'pause' }); };
    back.on('pointerdown', closeBack);
  }

  private _button(cx: number, y: number, label: string, cb: () => void, color: number): void {
    const w = 340;
    const g = this.add.rectangle(cx, y, w, 46, color, 0.35).setOrigin(0.5, 0.5).setStrokeStyle(2, 0x33e0ff, 0.7);
    const t = this.add.text(cx, y, label, { fontFamily: 'monospace', fontSize: '20px', color: '#eafaff', fontStyle: 'bold', letterSpacing: 3 }).setOrigin(0.5, 0.5);
    const hit = this.add.rectangle(cx, y, w, 46, 0x000000, 0).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => { audio.ui(); cb(); });
    hit.on('pointerover', () => g.setFillStyle(color, 0.6));
    hit.on('pointerout', () => g.setFillStyle(color, 0.35));
  }
}
