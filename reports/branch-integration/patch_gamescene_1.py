# -*- coding: utf-8 -*-
from pathlib import Path
p = Path('src/scenes/GameScene.ts')
s = p.read_text(encoding='utf-8')

old = """<<<<<<< HEAD
  // AI-NATIVE-02 P1 control HUD (honest local-demo labelling).
  private txtControl!: Phaser.GameObjects.Text;
  private txtAiAction!: Phaser.GameObjects.Text;
  private txtAiTarget!: Phaser.GameObjects.Text;
  private txtAgentLink!: Phaser.GameObjects.Text;
  private txtEcho!: Phaser.GameObjects.Text;
  private txtSignal!: Phaser.GameObjects.Text;
  /** P3-b A: browser-held owner capability (never exposed to the agent). */
  companionLink: CompanionLink | null = null;
  private companionFrame = 0;
  /** Confirmed companion suggestion awaiting its post-commit receipt. */
  private pendingCompanionReceipt: { suggestionId: string; enqueuedTick: number; generation: number; roomId: number | null } | null = null;
  /** Player signal keys (independent, unoccupied keys: T=scan, Y=jam, R=toggle relay). */
  private signalKeyCooldown = false;
  private keyT!: Phaser.Input.Keyboard.Key;
  private keyY!: Phaser.Input.Keyboard.Key;
  private keyR!: Phaser.Input.Keyboard.Key;
  private txtHelp!: Phaser.GameObjects.Text;
  /** Compact-viewport HUD layout (F-06): larger logical fonts, no z-index tricks. */
  private hudLayout = {
    weaponY: 20, roomY: 44, enemiesY: 64,
    controlY: 90, actionY: 110, targetY: 128, linkY: 146, echoY: 164, signalY: 182,
    helpY: GAME.WINDOW_H - 44, baseRowFont: '13px', controlFont: '13px', rowFont: '12px',
    helpFont: '13px', helpColor: '#8fb8c8'
  };
=======
  private txtVitals!: Phaser.GameObjects.Text;
>>>>>>> feat/ai-native-runtime
"""
new = """  private txtVitals!: Phaser.GameObjects.Text;
  // AI-NATIVE-02 P1 control HUD (honest local-demo labelling).
  private txtControl!: Phaser.GameObjects.Text;
  private txtAiAction!: Phaser.GameObjects.Text;
  private txtAiTarget!: Phaser.GameObjects.Text;
  private txtAgentLink!: Phaser.GameObjects.Text;
  private txtEcho!: Phaser.GameObjects.Text;
  private txtSignal!: Phaser.GameObjects.Text;
  /** P3-b A: browser-held owner capability (never exposed to the agent). */
  companionLink: CompanionLink | null = null;
  private companionFrame = 0;
  /** Confirmed companion suggestion awaiting its post-commit receipt. */
  private pendingCompanionReceipt: { suggestionId: string; enqueuedTick: number; generation: number; roomId: number | null } | null = null;
  /** Player signal keys (independent, unoccupied keys: T=scan, Y=jam, R=toggle relay). */
  private signalKeyCooldown = false;
  private keyT!: Phaser.Input.Keyboard.Key;
  private keyY!: Phaser.Input.Keyboard.Key;
  private keyR!: Phaser.Input.Keyboard.Key;
  private txtHelp!: Phaser.GameObjects.Text;
  /** Compact-viewport HUD layout (F-06): larger logical fonts, no z-index tricks. */
  private hudLayout = {
    weaponY: 20, roomY: 44, enemiesY: 64,
    controlY: 90, actionY: 110, targetY: 128, linkY: 146, echoY: 164, signalY: 182,
    helpY: GAME.WINDOW_H - 44, baseRowFont: '13px', controlFont: '13px', rowFont: '12px',
    helpFont: '13px', helpColor: '#8fb8c8'
  };
"""
assert old in s
s = s.replace(old, new)

# create shutdown: keep HEAD (AI cleanup) and drop the art-only empty side.
old = """    this.setupHud();
<<<<<<< HEAD
    this.setupMinimap();
    // P1: fresh run starts with human control; no AI state is carried over from
    // a previous run / scene instance. Explicit rather than relying on defaults.
    this.world.player.control.onRunStart();
    // Scene exit must not leave an AI owner or held input behind.
    this.events.once('shutdown', () => {
      // C3-b: scene exit cancels pending external intents and closes the link.
      this.externalLink?.degrade('scene-exit');
      void this.externalLink?.dispose('scene-exit');
      this.externalLink = null;
      this.world.player.control.onSceneExit();
      this.world.player.clearHeldInput();
      this.fireHeld = false;
      // Scene exit clears any pending signal key debounce.
      this.signalKeyCooldown = false;
    });
=======
>>>>>>> feat/ai-native-runtime
    // Snap the camera once."""
new = """    this.setupHud();
    // P1: fresh run starts with human control; no AI state is carried over from
    // a previous run / scene instance. Explicit rather than relying on defaults.
    this.world.player.control.onRunStart();
    // Scene exit must not leave an AI owner or held input behind.
    this.events.once('shutdown', () => {
      // C3-b: scene exit cancels pending external intents and closes the link.
      this.externalLink?.degrade('scene-exit');
      void this.externalLink?.dispose('scene-exit');
      this.externalLink = null;
      this.world.player.control.onSceneExit();
      this.world.player.clearHeldInput();
      this.fireHeld = false;
      // Scene exit clears any pending signal key debounce.
      this.signalKeyCooldown = false;
    });
    // Snap the camera once."""
assert old in s
s = s.replace(old, new)
p.write_text(s, encoding='utf-8')
print('fields/create patched')
