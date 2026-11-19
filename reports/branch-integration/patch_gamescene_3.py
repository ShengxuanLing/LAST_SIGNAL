# -*- coding: utf-8 -*-
from pathlib import Path
p = Path('src/scenes/GameScene.ts')
s = p.read_text(encoding='utf-8')

# lockHud conflict
start = s.index('<<<<<<< HEAD\n    place(this.hpFill, 20, 24);')
end = s.index('>>>>>>> feat/ai-native-runtime\n    place(this.txtBossHp', start) + len('>>>>>>> feat/ai-native-runtime\n')
new = """    place(this.hud, 0, 0);
    place(this.txtVitals, 20, 14);
    place(this.txtHp, 230, 25);
    place(this.txtXp, 230, 44);
    place(this.txtCurrency, 20, 58);
    place(this.txtLevel, 20, 76);
    const L = this.hudLayout;
    place(this.txtWeapon, GAME.WINDOW_W - 20, L.weaponY);
    place(this.txtRoom, GAME.WINDOW_W - 20, L.roomY);
    place(this.txtEnemies, GAME.WINDOW_W - 20, L.enemiesY);
    place(this.txtControl, GAME.WINDOW_W - 20, L.controlY);
    place(this.txtAiAction, GAME.WINDOW_W - 20, L.actionY);
    place(this.txtAiTarget, GAME.WINDOW_W - 20, L.targetY);
    place(this.txtAgentLink, GAME.WINDOW_W - 20, L.linkY);
    place(this.txtEcho, GAME.WINDOW_W - 20, L.echoY);
    place(this.txtSignal, GAME.WINDOW_W - 20, L.signalY);
    place(this.txtHelp, 20, L.helpY);
"""
s = s[:start] + new + s[end:]

# update conflict
start = s.index('<<<<<<< HEAD\n    this.companionFrame += 1;')
end = s.index('>>>>>>> feat/ai-native-runtime\n', start) + len('>>>>>>> feat/ai-native-runtime\n')
new = """    this.companionFrame += 1;
    if (this.companionLink && this.companionFrame % 30 === 0) void this.companionLink.pushObservation();
    this.refreshHud(dt);
"""
s = s[:start] + new + s[end:]

# refreshHud AI/art conflict
start = s.index('<<<<<<< HEAD\n    // AI-NATIVE-02 P1: control ownership')
end = s.index('>>>>>>> feat/ai-native-runtime\n', start) + len('>>>>>>> feat/ai-native-runtime\n')
new = """    // one hollow pip per hostile (shape-coded, not colour-coded)
    for (let i = 0; i < Math.min(aliveEnemies, 16); i++) {
      const x = 1258 - i * 10, y = 80;
      g.lineStyle(1.2, INK.known, 0.8);
      g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 4, y); g.lineTo(x, y + 4); g.lineTo(x - 4, y); g.closePath(); g.strokePath();
    }

    // AI-NATIVE-02 P1: control ownership, last executed AI action/target, and
    // the truthful link state (no external agent is attached in this phase).
    const control = p.control.snapshot();
    this.txtControl.setText(`CONTROL  ${control.modeLabel}`);
    this.txtControl.setColor(control.owner === 'ai' ? '#7ff0ff' : control.paused ? '#ffd233' : '#8fb8c8');
    this.txtAiAction.setText(`AI ACTION  ${control.lastAiAction ?? '—'}${control.aiActionCount > 0 ? ` ×${control.aiActionCount}` : ''}`);
    this.txtAiTarget.setText(`AI TARGET  ${control.lastAiTarget ?? '—'}`);
    // C3-b: the link label is the truth — it reflects the real connection state
    // and the last action the core actually committed.
    this.txtAgentLink.setText(control.externalAgentConnected
      ? `EXTERNAL AGENT CONNECTED · LAST ${control.lastAiAction ?? '—'}`
      : `${control.controllerLabel} DEMO · EXTERNAL NOT CONNECTED`);
    const echo = this.world.echoActor;
    if (!echo) {
      this.txtEcho.setText('ECHO OFF · PAUSE > ECHO COMPANION');
      this.txtEcho.setColor('#33e0ff');
    } else if (echo.data.hp <= 0) {
      this.txtEcho.setText('ECHO DOWN · INDEPENDENT OF YOU');
      this.txtEcho.setColor('#ff5533');
    } else {
      const mode = this.world.echoMode === 'follow' ? 'FOLLOW'
        : this.world.echoMode === 'hold' ? 'HOLD' : 'MOVE';
      const assist = this.world.echoAssistArmed ? 'ASSIST ARMED' : 'ASSIST SAFE';
      const suggest = this.world.echoSuggestion ? ' · CONFIRM FIRE' : '';
      const link = this.companionStatus === 'CONNECTED' ? ' · COMPANION CONNECTED'
        : this.companionStatus === 'FALLBACK:NO_MODEL' ? ' · COMPANION NO MODEL'
        : this.companionStatus === 'READ_ONLY' ? ' · COMPANION READ ONLY' : '';
      this.txtEcho.setText(`ECHO ${Math.ceil(echo.data.hp)}/${echo.data.maxHp} · ${mode} · ${assist}${suggest}${link}`);
      this.txtEcho.setColor(this.world.echoSuggestion ? '#ffd233' : '#33e0ff');
    }
    this.refreshSignalHud();
    const secs = Math.floor((this.time.now - this.runStart) / 1000);
    this.timer.setText(formatDuration(Math.max(0, secs)));
"""
s = s[:start] + new + s[end:]

# onRoomEntered conflict
start = s.index('<<<<<<< HEAD\n    // Committed room boundary')
end = s.index('>>>>>>> feat/ai-native-runtime\n  }\n\n  private onRoomCleared', start) + len('>>>>>>> feat/ai-native-runtime\n')
new = """    // Committed room boundary: the companion's previous-room work dies with the
    // room. This is a RENDERER-only report (Owner capability + game Origin), so
    // an Agent can never cancel the Owner's proposals. After the cancel we
    // publish the NEW room's committed observation, so the agent must observe
    // here before it may propose again. A pause/resume never reaches this.
    const link = this.companionLink;
    if (link) {
      // SYNCHRONOUS barrier BEFORE any await: the previous room's proposals are
      // unusable for this renderer immediately, even while the HTTP cancel is
      // still in flight (delayed/lost/out-of-order notifications included).
      link.enterRoom(room.id, this.world.sim.tick);
      // A receipt for a decision applied in the old room is no longer publishable.
      this.pendingCompanionReceipt = null;
      if (link.status === 'CONNECTED') {
        void link.notifyRoom(room.id, this.world.sim.tick).then((ok) => {
          if (ok) void link.pushObservation();
        });
      }
    }
    this.banner(`R-${String(room.id).padStart(2, '0')} · ${room.kind.toUpperCase()}`, 'SURVEY REGISTERED');
"""
s = s[:start] + new + s[end:]
p.write_text(s, encoding='utf-8')
print('remaining game scene patched')
