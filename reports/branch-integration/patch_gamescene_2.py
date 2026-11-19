# -*- coding: utf-8 -*-
from pathlib import Path
p = Path('src/scenes/GameScene.ts')
s = p.read_text(encoding='utf-8')
start = s.index('<<<<<<< HEAD\n    // F-06: FIT scales')
end = s.index('>>>>>>> feat/ai-native-runtime\n  }\n\n  private lockHud', start) + len('>>>>>>> feat/ai-native-runtime\n')
old = s[start:end]
new = """    // F-06: FIT scales the 1280x720 canvas down (0.625 at 800x600). Use larger
    // logical fonts and more vertical room in compact viewports instead of
    // hiding rows, relying on z-index, or calling 7.5 CSS px "readable".
    const scale = Math.min(
      window.innerWidth / GAME.WINDOW_W,
      window.innerHeight / GAME.WINDOW_H
    ) || 1;
    const compact = scale < 0.85;
    this.hudLayout = compact
      ? {
          weaponY: 16, roomY: 42, enemiesY: 68,
          controlY: 96, actionY: 124, targetY: 152, linkY: 180, echoY: 208, signalY: 236,
          helpY: GAME.WINDOW_H - 52, baseRowFont: '17px', controlFont: '17px', rowFont: '17px',
          helpFont: '16px', helpColor: '#8fb8c8'
        }
      : {
          weaponY: 20, roomY: 44, enemiesY: 64,
          controlY: 90, actionY: 110, targetY: 128, linkY: 146, echoY: 164, signalY: 182,
          helpY: GAME.WINDOW_H - 44, baseRowFont: '13px', controlFont: '13px', rowFont: '12px',
          helpFont: '13px', helpColor: '#8fb8c8'
        };
    const L = this.hudLayout;
    const mono = (size: number, color: string, bold = false) =>
      ({ fontFamily: FONT.mono, fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal' });
    const art = compact
      ? { tiny: 16, small: 16, body: 17, title: 17, boss: 18 }
      : { tiny: 10, small: 11, body: 12, title: 14, boss: 16 };
    // One Graphics for every HUD shape; pinned at screen (0,0) by lockHud.
    this.hud = add.graphics().setDepth(HUD_DEPTH);
    (this.hud as any).originX = 0; (this.hud as any).originY = 0;
    this.hpShown = -1; this.previousHp = -1; this.hpLossFlash = 0;

    this.txtVitals = add.text(20, 14, 'EX-17 · VITALS', mono(art.tiny, CSS.knownLow)).setLetterSpacing(2).setDepth(HUD_DEPTH);
    this.txtHp = add.text(230, 25, '100 / 100', mono(compact ? 17 : 15, CSS.known, true)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtXp = add.text(230, 44, 'XP 0/30', mono(art.small, CSS.knownMid)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtCurrency = add.text(20, 58, 'CREDITS 0', mono(art.body, CSS.known)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtLevel = add.text(20, 76, 'LV 1', mono(art.body, CSS.known, true)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.timer = add.text(20, 98, '', mono(art.small, CSS.knownMid)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtWeapon = add.text(GAME.WINDOW_W - 20, L.weaponY, '', mono(compact ? 17 : 14, CSS.known, true)).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtRoom = add.text(GAME.WINDOW_W - 20, L.roomY, '', mono(art.small, CSS.knownMid)).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtEnemies = add.text(GAME.WINDOW_W - 20, L.enemiesY, '', mono(art.body, CSS.known, true)).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtBossHp = add.text(GAME.WINDOW_W / 2, 30, '', mono(art.boss, CSS.known, true)).setOrigin(0.5, 0.5).setDepth(HUD_DEPTH);
    // Boss fill: left edge pinned (displayOrigin set in refreshBoss) so it drains to the
    // right and stays inside its frame (audit 7.9: fill used to start at the centre).
    this.bossBarFill = add.rectangle(GAME.WINDOW_W / 2, 52, 0, 8, INK.hostile, 1).setOrigin(0.5, 0.5).setDepth(HUD_DEPTH);
    this.txtMap = add.text(GAME.WINDOW_W - 20, GAME.WINDOW_H - 132, '', mono(art.tiny, CSS.knownMid)).setOrigin(1, 0).setLetterSpacing(1).setDepth(HUD_DEPTH);
    this.txtStats = add.text(20, GAME.WINDOW_H - 22, '', mono(art.small, CSS.knownLow)).setOrigin(0, 0).setDepth(HUD_DEPTH);

    // AI-NATIVE-02 control rows (kept from the authoritative world branch, merged
    // with the survey HUD layout rather than replacing it).
    this.txtControl = add.text(GAME.WINDOW_W - 20, L.controlY, '', { fontFamily: 'monospace', fontSize: L.controlFont, fontStyle: 'bold', color: '#8fb8c8' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtAiAction = add.text(GAME.WINDOW_W - 20, L.actionY, '', { fontFamily: 'monospace', fontSize: L.rowFont, color: '#8fb8c8' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtAiTarget = add.text(GAME.WINDOW_W - 20, L.targetY, '', { fontFamily: 'monospace', fontSize: L.rowFont, color: '#8fb8c8' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtAgentLink = add.text(GAME.WINDOW_W - 20, L.linkY, 'LOCAL DETERMINISTIC DEMO · EXTERNAL NOT CONNECTED', { fontFamily: 'monospace', fontSize: L.rowFont, color: '#ff8a3c' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtEcho = add.text(GAME.WINDOW_W - 20, L.echoY, 'ECHO OFF · PAUSE > ECHO COMPANION', { fontFamily: 'monospace', fontSize: L.rowFont, color: '#33e0ff' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtSignal = add.text(GAME.WINDOW_W - 20, L.signalY, 'RELAY OFF · NO DEVICE', { fontFamily: 'monospace', fontSize: L.rowFont, color: '#8fb8c8' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtHelp = add.text(20, L.helpY, 'ESC PAUSE · ANY MOVE / FIRE / F TAKES HUMAN CONTROL', { fontFamily: 'monospace', fontSize: L.helpFont, color: L.helpColor }).setOrigin(0, 0).setDepth(HUD_DEPTH);
"""
s = s[:start] + new + s[end:]
p.write_text(s, encoding='utf-8')
print('setupHud patched')
