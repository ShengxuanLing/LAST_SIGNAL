import Phaser from 'phaser';
import { GAME, basePlayerData } from '../config/game';
import { UPGRADES, UPGRADE_LIST, applyUpgrade } from '../config/upgrades';
import { PlayerData } from '../types';
import { GameScene } from './GameScene';
import { audio } from '../systems/AudioSystem';

export class LevelUpScene extends Phaser.Scene {
  constructor() { super('LevelUpScene'); }

  private choices: string[] = [];
  private buttons: Phaser.GameObjects.Rectangle[] = [];
  private player!: PlayerData;
  private chosen = false;
  // Public callback the parent (GameScene) supplies via launch config so the
  // scene can hand control back without poking the parent's paused/alpha directly.
  private onClose: (() => void) | null = null;

  create(config: { level: number; onClose?: () => void }): void {
    // Scene instances are reused between level-ups, so reset per-open state.
    this.chosen = false;
    this.buttons = [];
    this.onClose = config.onClose ?? null;
    const parent = this.scene.get<GameScene>('GameScene');
    const data = parent?.world?.player?.data as PlayerData | undefined;
    this.player = data ?? ({ ...basePlayerData(), level: config?.level ?? 1, upgrades: [] } as unknown as PlayerData);
    const lvl = config?.level ?? this.player.level;

    // weighted selection excluding maxed upgrades
    const pool = UPGRADE_LIST.filter((d) => {
      const prog = this.player.upgrades.find((u) => u.key === d.key);
      const current = prog?.level ?? 0;
      return current < d.maxLevel;
    });
    const weights = pool.map((d) => d.weight);
    this.choices = this.pickWeighted(pool, weights, 3).map((d) => d.key);

    // header
    this.add.text(GAME.WINDOW_W / 2, 120, `LEVEL ${lvl}`, {
      fontFamily: 'monospace', fontSize: '22px', color: '#33e0ff', fontStyle: 'bold'
    }).setOrigin(0.5, 0.5);
    this.add.text(GAME.WINDOW_W / 2, 150, 'CHOOSE AN UPGRADE', {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffb060'
    }).setOrigin(0.5, 0.5);

    const startX = GAME.WINDOW_W / 2 - (this.choices.length * 260) / 2 + 130;
    this.choices.forEach((key, i) => {
      const def = UPGRADES[key];
      const x = startX + i * 260;
      const panel = this.add.rectangle(x, 320, 230, 300, 0x0d1822, 0.9)
        .setStrokeStyle(2, 0x33e0ff, 0.8).setInteractive();
      this.buttons.push(panel);

      const glow = this.add.rectangle(x, 320, 230, 300, 0x33e0ff, 0).setOrigin(0.5, 0.5).setInteractive();
      glow.on('pointerover', () => panel.setFillStyle(0x16303a, 1));
      glow.on('pointerout', () => panel.setFillStyle(0x0d1822, 0.9));
      glow.on('pointerdown', () => this.choose(key));

      // icon
      this.add.text(x, 200, '★', { fontSize: '48px', color: '#ffd233' }).setOrigin(0.5, 0.5);
      this.add.text(x, 250, def.name, { fontFamily: 'monospace', fontSize: '20px', color: '#eafaff', fontStyle: 'bold' }).setOrigin(0.5, 0.5);
      const prog = this.player.upgrades.find((u) => u.key === def.key);
      this.add.text(x, 280, `Lv ${prog?.level ?? 0}/${def.maxLevel}`, { fontFamily: 'monospace', fontSize: '13px', color: '#8fb8c8' }).setOrigin(0.5, 0.5);
      this.wrapText(this.add.text(x, 330, def.description, {
        fontFamily: 'monospace', fontSize: '14px', color: '#cfe8ef',
        lineHeight: 16, align: 'center'
      } as any).setOrigin(0.5, 0), x, 330, 200);
      // effect preview
      const before = this.snapshot();
      const cloned = structuredClone(this.player);
      applyUpgrade(def, cloned, (prog?.level ?? 0) + 1);
      const after = this.snapshot(cloned);
      const diff = this.formatDiff(before, after);
      this.add.text(x, 450, diff, { fontFamily: 'monospace', fontSize: '12px', color: '#7ff0ff' }).setOrigin(0.5, 0.5);
    });

    this.add.text(GAME.WINDOW_W / 2, GAME.WINDOW_H - 24, 'choose one to continue', {
      fontFamily: 'monospace', fontSize: '12px', color: '#48606b'
    }).setOrigin(0.5, 0.5);
  }

  private snapshot(state: PlayerData = this.player): Record<string, number> {
    // Cover every stat an upgrade can mutate, otherwise armour / xpGain /
    // dashCooldown upgrades render an empty "before vs after" preview.
    return {
      hp: state.hp, maxHp: state.maxHp, speed: state.speed, damage: state.damage,
      critChance: state.critChance, critDamage: state.critDamage, pickupRange: state.pickupRange,
      cooldownReduced: state.cooldownReduced, pierceCount: state.pierceCount, hpRegen: state.hpRegen,
      armor: state.armor, xpGain: state.xpGain, dashCooldown: state.dashCooldown
    };
  }

  private formatDiff(before: Record<string, number>, after: Record<string, number>): string {
    const lines: string[] = [];
    const labels: Record<string, string> = {
      hp: 'HP', maxHp: 'MaxHP', speed: 'Speed', damage: 'Dmg', critChance: 'Crit%',
      critDamage: 'CritDmg', pickupRange: 'Magnet', cooldownReduced: 'Cooldown',
      pierceCount: 'Pierce', hpRegen: 'Regen', armor: 'Armor', xpGain: 'XP%', dashCooldown: 'DashCD'
    };
    for (const k of Object.keys(after)) {
      const delta = after[k] - before[k];
      if (Math.abs(delta) < 1e-9) continue;
      const show = k === 'critChance'
        ? (delta * 100).toFixed(0) + '%'
        : (Math.abs(delta) < 10 ? delta.toFixed(2) : Math.round(delta).toString());
      lines.push(`${delta >= 0 ? '+' : ''}${show} ${labels[k]}`);
    }
    return lines.slice(0, 4).join('\n');
  }

  private pickWeighted<T>(items: T[], weights: number[], n: number): T[] {
    const out: T[] = [];
    const remainingItems = items.slice();
    const remainingWeights = weights.slice();
    for (let i = 0; i < Math.min(n, remainingItems.length); i++) {
      const total = remainingWeights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total;
      let idx = 0;
      for (let j = 0; j < remainingWeights.length; j++) {
        r -= remainingWeights[j];
        if (r <= 0) { idx = j; break; }
      }
      out.push(remainingItems[idx]);
      remainingItems.splice(idx, 1);
      remainingWeights.splice(idx, 1);
    }
    return out;
  }

  // 10px per character is intentionally conservative: Linux CI font fallback can be
  // wider than Windows Consolas, and descriptions must stay inside the 230px card.
  private wrapText(text: Phaser.GameObjects.Text, x: number, y: number, width: number, charWidth = 10): void {
    const words = (text.text as string).split(' ');
    let line = '';
    const lines: string[] = [];
    for (const w of words) {
      const test = line + w + ' ';
      if (test.length * charWidth > width && line) {
        lines.push(line);
        line = w + ' ';
      } else line = test;
    }
    if (line) lines.push(line);
    text.setText(lines.join('\n'));
  }

  private choose(key: string): void {
    if (this.chosen) return;
    this.chosen = true;
    audio.levelchoose();
    const def = UPGRADES[key];
    const prog = this.player.upgrades.find((u) => u.key === key);
    const newLevel = (prog?.level ?? 0) + 1;
    applyUpgrade(def, this.player, newLevel);
    if (prog) prog.level = newLevel;
    else this.player.upgrades.push({ key, level: newLevel });
    const parent = this.scene.get<GameScene>('GameScene');
    parent?.saveCheckpoint();
    // Hand control back to the parent: it (re)opens the next pending level-up or
    // resumes the game. We must not set parent.paused/alpha directly here.
    this.time.delayedCall(120, () => {
      if (parent && this.onClose) this.onClose();
      else this.scene.stop();
    });
  }
}
