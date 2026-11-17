import Phaser from 'phaser';
import { GAME, basePlayerData } from '../config/game';
import { UPGRADES, UPGRADE_LIST, applyUpgrade } from '../config/upgrades';
import { PlayerData } from '../types';
import { GameScene } from './GameScene';
import { audio } from '../systems/AudioSystem';
import { FONT } from '../art/survey/tokens';
import { UIC, UIN } from '../ui/palette';
import { dashed, diamond, sheetChrome, ticks } from '../ui/sheet';

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

    // UI-ART-01: a field-upgrade sheet over the frozen run. The scrim is a
    // plain, non-interactive rectangle so the card hit areas stay the only
    // controls; all chrome is Graphics (no bounds, never hit-tested).
    this.add.rectangle(0, 0, GAME.WINDOW_W, GAME.WINDOW_H, UIN.void, 0.8).setOrigin(0, 0);
    sheetChrome(this.add.graphics());
    const cx = GAME.WINDOW_W / 2;
    const head = this.add.graphics();
    this.add.text(cx, 92, 'EX-17 · FIELD UPGRADE AVAILABLE', {
      fontFamily: FONT.mono, fontSize: '11px', color: UIC.dim
    }).setOrigin(0.5, 0.5).setLetterSpacing(4);
    const title = this.add.text(cx, 120, `LEVEL ${lvl}`, {
      fontFamily: FONT.mono, fontSize: '28px', color: UIC.text, fontStyle: 'bold'
    }).setOrigin(0.5, 0.5).setLetterSpacing(8);
    for (const sx of [-1, 1]) {
      const gap = title.width / 2 + 20;
      head.lineStyle(1, UIN.ink, 0.32);
      head.lineBetween(cx + sx * gap, 120.5, cx + sx * (gap + 60), 120.5);
      head.lineBetween(cx + sx * (gap + 60), 115.5, cx + sx * (gap + 60), 125.5);
      head.fillStyle(UIN.accent, 0.9);
      head.fillRect(cx + sx * (gap - 6) - 2, 118.5, 4, 4);
    }
    this.add.text(cx, 150, 'CHOOSE AN UPGRADE', {
      fontFamily: FONT.mono, fontSize: '13px', color: UIC.muted
    }).setOrigin(0.5, 0.5).setLetterSpacing(4);

    const startX = GAME.WINDOW_W / 2 - (this.choices.length * 260) / 2 + 130;
    this.choices.forEach((key, i) => {
      const def = UPGRADES[key];
      const x = startX + i * 260;
      const x0 = x - 115, x1 = x + 115, y0 = 170, y1 = 470;
      const panel = this.add.rectangle(x, 320, 230, 300, UIN.panel, 0.96)
        .setStrokeStyle(1, UIN.ink, 0.22).setInteractive();
      this.buttons.push(panel);
      const card = this.add.graphics();
      const paintCard = (hot: boolean): void => {
        card.clear();
        // header band, divider rules, effect well
        card.fillStyle(hot ? UIN.massLift : UIN.mass, 1); card.fillRect(x0 + 1, y0 + 1, 228, 56);
        card.lineStyle(1, UIN.ink, 0.16); card.lineBetween(x0 + 1, y0 + 57.5, x1 - 1, y0 + 57.5);
        dashed(card, x0 + 18, 312.5, x1 - 18, 312.5, 2, 4, 0.22);
        card.fillStyle(UIN.accentDeep, hot ? 0.9 : 0.55); card.fillRect(x0 + 12, 408, 206, 50);
        card.lineStyle(1, UIN.accent, hot ? 0.6 : 0.25); card.strokeRect(x0 + 12.5, 408.5, 205, 49);
        // key cap
        card.lineStyle(1, hot ? UIN.accent : UIN.ink, hot ? 1 : 0.5); card.strokeRect(x0 + 14.5, y0 + 15.5, 26, 26);
        // rank pips: filled = owned, outlined accent = this choice, faint = remaining
        const owned = prog?.level ?? 0;
        const n = def.maxLevel, pw = 14, pg = 6;
        const px0 = x - ((n * pw + (n - 1) * pg) / 2) + pw / 2;
        for (let k = 0; k < n; k++) {
          const px = px0 + k * (pw + pg);
          if (k < owned) diamond(card, px, 284, 5, UIN.ink, 0.9, true);
          else if (k === owned) diamond(card, px, 284, 5, UIN.accent, 1, true);
          else diamond(card, px, 284, 5, UIN.ink, 0.3, false);
        }
        if (hot) {
          panel.setStrokeStyle(1.5, UIN.accent, 1);
          ticks(card, x0 - 6, y0 - 6, x1 + 6, y1 + 6, 10, 1, UIN.accent);
        } else {
          panel.setStrokeStyle(1, UIN.ink, 0.22);
          ticks(card, x0, y0, x1, y1, 8, 0.55);
        }
      };
      const prog = this.player.upgrades.find((u) => u.key === def.key);
      paintCard(false);

      const glow = this.add.rectangle(x, 320, 230, 300, UIN.accent, 0).setOrigin(0.5, 0.5).setInteractive();
      glow.on('pointerover', () => paintCard(true));
      glow.on('pointerout', () => paintCard(false));
      glow.on('pointerdown', () => this.choose(key));
      const shortcut = `keydown-${['ONE', 'TWO', 'THREE'][i]}`;
      const onKey = (event: KeyboardEvent) => {
        if (!event.repeat) this.choose(key);
      };
      this.input.keyboard?.on(shortcut, onKey);
      this.events.once('shutdown', () => this.input.keyboard?.off(shortcut, onKey));

      // key cap number + rank caption
      this.add.text(x0 + 27.5, y0 + 29, `${i + 1}`, {
        fontFamily: FONT.mono, fontSize: '16px', color: UIC.accent, fontStyle: 'bold'
      }).setOrigin(0.5);
      this.add.text(x1 - 14, y0 + 29, `RANK ${prog?.level ?? 0}/${def.maxLevel}`, {
        fontFamily: FONT.mono, fontSize: '11px', color: UIC.dim
      }).setOrigin(1, 0.5).setLetterSpacing(2);
      this.add.text(x, 254, def.name, { fontFamily: FONT.mono, fontSize: '18px', color: UIC.text, fontStyle: 'bold' }).setOrigin(0.5, 0.5);
      this.wrapText(this.add.text(x, 330, def.description, {
        fontFamily: FONT.mono, fontSize: '14px', color: UIC.textMid,
        lineHeight: 16, align: 'center'
      } as any).setOrigin(0.5, 0), x, 330, 200);
      // effect preview
      const before = this.snapshot();
      const cloned = structuredClone(this.player);
      applyUpgrade(def, cloned, (prog?.level ?? 0) + 1);
      const after = this.snapshot(cloned);
      const diff = this.formatDiff(before, after);
      this.add.text(x, 433, diff, { fontFamily: FONT.mono, fontSize: '13px', color: UIC.accent, fontStyle: 'bold', align: 'center' }).setOrigin(0.5, 0.5);
    });

    this.add.text(GAME.WINDOW_W / 2, GAME.WINDOW_H - 34, 'CLICK A CARD OR PRESS ITS NUMBER', {
      fontFamily: FONT.mono, fontSize: '12px', color: UIC.faint
    }).setOrigin(0.5, 0.5).setLetterSpacing(2);
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
    const count = Math.min(n, remainingItems.length);
    for (let i = 0; i < count; i++) {
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
    const prog = this.player.upgrades.find((u) => u.key === key);
    const newLevel = (prog?.level ?? 0) + 1;
    const parent = this.scene.get<GameScene>('GameScene');
    // Enqueue the core command; it commits on the next resumed core tick.
    parent?.world.enqueueApplyUpgrade(key, newLevel);
    parent?.markCheckpointDirty();
    // Hand control back to the parent: it (re)opens the next pending level-up or
    // resumes the game. We must not set parent.paused/alpha directly here.
    this.time.delayedCall(120, () => {
      if (parent && this.onClose) this.onClose();
      else this.scene.stop();
    });
  }
}
