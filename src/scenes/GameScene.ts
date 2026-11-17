import Phaser from 'phaser';
import { GAME } from '../config/game';
import { MapGenerator, assignRoles, guaranteeReachable, roomDepth } from '../world/MapGenerator';
import { World, WorldCallbacks, RoomInfo } from '../world/World';
import { WEAPONS } from '../config/weapons';
import { UPGRADES } from '../config/upgrades';
import { saveSystem, game } from '../main';
import { audio } from '../systems/AudioSystem';
import { formatDuration } from '../core/formatDuration';
import { ExternalLinkController, type ExternalLinkDegradeReason } from '../ai-native/externalLinkController';
import { CompanionLink } from '../ai-native/companionLink';
import { clearOwnerPairing, peekOwnerPairing } from '../ai-native/ownerPairing';
import { WORLD_PROTOCOL_VERSION } from '../ai-native/worldProtocol';
import { Player } from '../entities/Player';
import type { RunCheckpoint } from '../types';
import { CSS, DEPTH, FONT, INK, TIME } from '../art/survey/tokens';
import { UIC } from '../ui/palette';
import { deckLabel, deckSeed, sectorFor } from '../config/dungeon';
import type { MapData } from '../types';

interface SceneConfig {
  seed?: number;
  resume?: boolean;
  sectorRun?: boolean;
  transition?: Pick<RunCheckpoint, 'id' | 'player' | 'stats'> & { deck: number };
}

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }
  world!: World;
  private cam!: Phaser.Cameras.Scene2D.Camera;
  private keys!: Phaser.Input.Keyboard.Key;
  fireHeld = false;
  paused = false;

  // HUD elements (AR-02: one per-frame Graphics + texts, Direction A field-manual style)
  private hud!: Phaser.GameObjects.Graphics;
  /** UI-REWORK-01: every screen-space HUD object, so a menu can hide/restore
   *  the whole readout without faking state or resizing the world. */
  private hudObjects: Phaser.GameObjects.GameObject[] = [];
  private hudVisible = true;
  private hpShown = -1;
  private previousHp = -1;
  private hpLossFlash = 0;
  private banners: Array<{ t: Phaser.GameObjects.Text; x: number; y: number }> = [];
  private txtHp!: Phaser.GameObjects.Text;
  private txtXp!: Phaser.GameObjects.Text;
  private txtCurrency!: Phaser.GameObjects.Text;
  private txtWeapon!: Phaser.GameObjects.Text;
  private txtLevel!: Phaser.GameObjects.Text;
  private txtRoom!: Phaser.GameObjects.Text;
  private txtObjective!: Phaser.GameObjects.Text;
  private txtEnemies!: Phaser.GameObjects.Text;
  private txtBossHp!: Phaser.GameObjects.Text;
  private bossBarFill!: Phaser.GameObjects.Rectangle;
  private txtMap!: Phaser.GameObjects.Text;
  private txtStats!: Phaser.GameObjects.Text;
  private timer!: Phaser.GameObjects.Text;
  private txtVitals!: Phaser.GameObjects.Text;
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
    vitalsY: 14, weaponY: 20, roomY: 44, enemiesY: 64,
    controlY: 90, actionY: 110, targetY: 128, linkY: 146, echoY: 164, signalY: 182,
    helpY: GAME.WINDOW_H - 44, baseRowFont: '13px', controlFont: '13px', rowFont: '12px',
    helpFont: '13px', helpColor: UIC.muted
  };

  private runStart = 0;
  private enemiesKilled = 0;
  private itemsCollected = 0;
  private damageDealt = 0;
  private runId = '';
  private checkpointDirty = false;
  private runFinished = false;
  // Pending level-up levels. When one XP gain crosses several levels, addXp()
  // fires onLevelUp multiple times; we queue them and open the scene one at a
  // time so no upgrade is skipped and the scene is never launched twice.
  private pendingLevels: number[] = [];
  private levelUpActive = false;
  /** C3-b: rendered external-agent link (null until the human authorizes). */
  private externalLink: ExternalLinkController | null = null;
  /** Last REAL bridge error from a HUMAN authorize attempt (UI feedback). */
  private lastExternalLinkError: { code: string; messageKey: string } | null = null;

  seed = 0;
  private deck?: number;

  create(config: SceneConfig): void {
    // A previous run may have been left paused by an overlay (e.g. QUIT TO MENU).
    // Scene instances are reused, so clear the flag on every fresh run.
    this.paused = false;
    this.fireHeld = false;
    this.cameras.main.setAlpha(1);
    const save = saveSystem.load();
    const checkpoint = config?.resume ? save.run : undefined;
    const transition = config?.transition;
    if (config?.resume && !checkpoint) {
      this.scene.start('MainMenuScene', { notice: 'NO CHECKPOINT AVAILABLE' });
      return;
    }
    // A resumed run keeps the checkpoint's id; a brand-new run gets a fresh id.
    // A NEW RUN must not carry over a previous run's id, and its first checkpoint
    // write replaces the old on-disk run (see the undefined expectedId below).
    const progress = checkpoint ?? transition;
    this.runId = progress?.id ?? crypto.getRandomValues(new Uint32Array(4)).join('-');
    this.checkpointDirty = false;
    this.runFinished = false;
    this.pendingLevels = [];
    this.levelUpActive = false;
    this.enemiesKilled = progress?.stats.kills ?? 0;
    this.itemsCollected = progress?.stats.items ?? 0;
    this.damageDealt = progress?.stats.damage ?? 0;
    this.runStart = this.time.now - (progress?.stats.elapsedSeconds ?? 0) * 1000;
    this.seed = (checkpoint?.seed ?? config?.seed ?? Math.floor(Math.random() * 1e9)) >>> 0;
    this.deck = progress?.deck ?? (config?.sectorRun ? 0 : undefined);
    const map = this.buildMap(this.seed, this.deck);
    const callbacks: WorldCallbacks = {
      onLevelUp: (level) => this.onLevelUp(level),
      onDeath: () => this.onDeath(),
      onRoomCleared: (room) => this.onRoomCleared(room),
      onRoomEntered: (room) => this.onRoomEntered(room),
      onLoot: () => {},
      onStats: (delta) => {
        if (delta.enemies) this.enemiesKilled += delta.enemies;
        if (delta.items) {
          this.itemsCollected += delta.items;
          this.checkpointDirty = true;
        }
        if (delta.dmg) this.damageDealt += delta.dmg;
      },
      onBossWin: () => this.onBossWin(),
      onNextDeck: () => this.advanceDeck()
    };
    this.world = new World(this, map, save, callbacks);
    if (checkpoint && !this.world.restoreCheckpoint(checkpoint)) {
      saveSystem.discardCheckpoint(checkpoint.id);
      this.scene.start('MainMenuScene', { notice: 'CHECKPOINT INCOMPATIBLE' });
      return;
    }
    if (transition) this.world.applyTransitionPlayerData(transition.player);
    if (!checkpoint) {
      this.world.updateRoom();
      // Commit the initial room generation on one real tick so the first
      // checkpoint reflects fully committed state; never flush outside a tick.
      this.world.resetSimulationAccumulator();
      this.world.stepFrame(1000 / 60 + 1e-6, { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false });
    }
    const firstCheckpoint = this.world.captureCheckpoint(this.runId, this.seed, this.runStats());
    if (firstCheckpoint) {
      // First write replaces any existing on-disk checkpoint (expectedId ===
      // undefined) so a NEW RUN clears the old run and a RESUME re-saves the same
      // id. Later writes pass this.runId so they can only touch the active run.
      saveSystem.writeCheckpoint(firstCheckpoint, progress?.id);
    }
    this.checkpointDirty = false;

    // Camera bounds must follow the real isometric world layer, not the tile-grid
    // size: WorldRenderer bakes the whole map into one texture whose width/height
    // are far larger than map.width * TILE_W / map.height * TILE_H. The old grid
    // based bounds clamped scrollY and pushed the player/boss/map off the bottom
    // of the screen in deep (boss) rooms.
    this.cam = this.cameras.main;
    const layer = (this.world.renderer as any).layer as { width: number; height: number };
    const pad = 200;
    this.cam.setBounds(-pad, -pad, layer.width + pad * 2, layer.height + pad * 2);
    // Keep bounds clamping enabled (setBounds already sets it; be explicit).
    this.cam.useBounds = true;
    this.cam.setZoom(GAME.CAM_ZOOM_MIN);

    // Input
    this.keys = this.input.keyboard!.addKey('SPACE');
    this.input.keyboard!.on('keydown_SPACE', () => {});
    this.input.keyboard!.on('keydown-ESC', (event: KeyboardEvent) => {
      if (!event.repeat) this.onPause();
    });
    this.input.keyboard!.on('keydown-I', (event: KeyboardEvent) => {
      if (!event.repeat) this.toggleInventory();
    });
    this.input.keyboard!.on('keydown-F', (event: KeyboardEvent) => {
      if (this.runFinished) return;
      if (this.paused) {
        // F-05: an interaction key must also be able to reclaim control while
        // an overlay is on top; it must NOT interact with a paused world.
        this.takeoverFromHumanInput();
        return;
      }
      this.saveCheckpoint();
      // Queue the interaction so it executes in Player.applyIntent, the same
      // path the local controller uses (legal action, not a direct teleport).
      this.world.player.requestInteract();
    });
    this.input.keyboard!.on('keydown-Q', () => this.switchWeapon(-1));
    this.input.keyboard!.on('keydown-E', () => this.switchWeapon(1));
    // Signal keys: independent, unoccupied by weapon switching. T=scan, Y=jam, R=toggle relay.
    this.keyT = this.input.keyboard!.addKey('T');
    this.keyY = this.input.keyboard!.addKey('Y');
    this.keyR = this.input.keyboard!.addKey('R');
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.button !== 0) return;
      // UI click ownership: a pointerdown on an interactive overlay object
      // belongs to that overlay (weapon equip / upgrade card / menu button),
      // not to "fire". Only a non-UI press counts as fire and can take over.
      if (this.pointerDownOnUi(p)) return;
      if (this.world.player.control.owner === 'ai') this.takeoverFromHumanInput();
      this.fireHeld = !this.paused;
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.button === 0) this.fireHeld = false; });
    // Real product takeover: movement keys must work even while a pause-like
    // overlay (LevelUpScene / PauseScene / inventory) is on top, where
    // Player.update() is not running.
    const takeoverOnMove = (event: KeyboardEvent) => {
      if (event.repeat) return;
      this.takeoverFromHumanInput();
    };
    for (const code of ['W', 'A', 'S', 'D', 'SPACE']) {
      this.input.keyboard!.on(`keydown-${code}`, takeoverOnMove);
    }

    this.setupHud();
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
    // Snap the camera once. In Phaser 3.90 zoom is about the viewport center, so
    // getScroll() (which also clamps to setBounds) is the scroll that centers the
    // player; scrollX/Y must not be set to the player's world position directly.
    const px = this.world.player.sprite.x, py = this.world.player.sprite.y;
    const start = this.cam.getScroll(px, py);
    this.cam.setScroll(start.x, start.y);
    audio.ensureContext();
    if (!checkpoint && this.deck !== undefined) this.showDeckArrival(this.deck);
  }

  private showDeckArrival(deck: number): void {
    const announcement = this.add.text(GAME.WINDOW_W / 2, 126,
      [deckLabel(deck), sectorFor(deck).brief], {
        fontFamily: FONT.mono, fontSize: '16px', align: 'center',
        color: CSS.known, backgroundColor: '#0b0d10', padding: { x: 14, y: 8 }
      }).setOrigin(0.5).setScrollFactor(0).setDepth(501);
    // UI-REWORK-01 B5: the deck announcement is part of the screen readout and
    // must hide with the rest of the HUD when a menu is open.
    this.hudObjects.push(announcement);
    announcement.setVisible(this.hudVisible);
    this.tweens.add({ targets: announcement, alpha: 0, delay: 2300, duration: 400,
      onComplete: () => announcement.destroy() });
  }

  private buildMap(seed: number, deck?: number): MapData {
    if (deck !== undefined) return new MapGenerator(deckSeed(seed, deck), deck).generate();
    const gen = new MapGenerator(seed);
    const map = gen.generate();
    assignRoles(gen, map.rooms, map.roomsOrder);
    if (!guaranteeReachable(map)) {
      // extremely unlikely; retry with offset seed
      const gen2 = new MapGenerator(seed ^ 0x5bd1e995);
      const m2 = gen2.generate();
      assignRoles(gen2, m2.rooms, m2.roomsOrder);
      return m2;
    }
    return map;
  }

  /** UI clicks belong to the overlay scene; only the remaining pointer presses are fire. */
  private pointerDownOnUi(pointer: Phaser.Input.Pointer): boolean {
    for (const key of ['PauseScene', 'LevelUpScene']) {
      if (!this.scene.isActive(key)) continue;
      const overlay: any = this.scene.get(key);
      const input = overlay?.input as Phaser.Input.InputPlugin | undefined;
      if (input && typeof input.hitTestPointer === 'function' &&
          input.hitTestPointer(pointer).length > 0) return true;
    }
    return false;
  }

  /** One-key / one-click human reclaim, valid during overlays too. */
  private takeoverFromHumanInput(): void {
    // C3-b: any human input cancels a pending external intent (YIELDED + epoch).
    this.externalLink?.degrade('takeover');
    if (this.world.player.control.owner !== 'ai') return;
    this.world.player.control.humanTakeover('human-input');
    this.world.player.clearHeldInput();
    this.fireHeld = false;
    this.refreshHud(0);
  }

  private advanceDeck(): void {
    if (this.deck === undefined || this.paused || this.runFinished) return;
    this.paused = true;
    this.scene.restart({
      seed: this.seed,
      transition: {
        id: this.runId, deck: this.deck + 1,
        player: structuredClone(this.world.player.data), stats: this.runStats()
      }
    } satisfies SceneConfig);
  }

  private setupHud(): void {
    // Screen-space HUD. Each element is added directly to the scene; every frame, lockHud
    // places its origin in the world (scroll + target / zoom) and scales it by 1 / zoom so
    // its on-screen position stays fixed as the camera scrolls and its size stays fixed as
    // the camera zooms in/out (zoomTo() is unavailable in this build).
    // Placing elements individually (instead of in a scaled container) keeps the far-right
    // text inside the camera's culling bounds. HUD_DEPTH sits above the lighting overlay (1)
    // and all world entities.
    // AR-02 Direction A "field survey manual" (A4): hairline frames + corner ticks,
    // monospace numerals, segmented vitals. Priority: vitals (top-left) > hostiles /
    // weapon (top-right) > survey map (bottom-right) > run stats (bottom-left).
    // The 480x320 combat core stays clear (03 §4).
    const HUD_DEPTH = DEPTH.hud;
    const add = this.add;
    // F-06: FIT scales the 1280x720 canvas down (0.625 at 800x600). Use larger
    // logical fonts and more vertical room in compact viewports instead of
    // hiding rows, relying on z-index, or calling 7.5 CSS px "readable".
    const scale = Math.min(
      window.innerWidth / GAME.WINDOW_W,
      window.innerHeight / GAME.WINDOW_H
    ) || 1;
    const compact = scale < 0.85;
    this.hudLayout = compact
      ? {
          vitalsY: 7, weaponY: 16, roomY: 42, enemiesY: 68,
          controlY: 96, actionY: 124, targetY: 152, linkY: 180, echoY: 208, signalY: 236,
          helpY: GAME.WINDOW_H - 52, baseRowFont: '17px', controlFont: '17px', rowFont: '17px',
          helpFont: '16px', helpColor: UIC.muted
        }
      : {
          vitalsY: 14, weaponY: 20, roomY: 44, enemiesY: 64,
          controlY: 90, actionY: 110, targetY: 128, linkY: 146, echoY: 164, signalY: 182,
          helpY: GAME.WINDOW_H - 44, baseRowFont: '13px', controlFont: '13px', rowFont: '12px',
          helpFont: '13px', helpColor: UIC.muted
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

    this.txtVitals = add.text(20, L.vitalsY, 'EX-17 · VITALS', mono(art.tiny, CSS.knownLow)).setLetterSpacing(2).setDepth(HUD_DEPTH);
    this.txtHp = add.text(230, 25, '100 / 100', mono(compact ? 17 : 15, CSS.known, true)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtXp = add.text(230, 44, 'XP 0/30', mono(art.small, CSS.knownMid)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtCurrency = add.text(20, 58, 'CREDITS 0', mono(art.body, CSS.known)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtLevel = add.text(20, 76, 'LV 1', mono(art.body, CSS.known, true)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.timer = add.text(20, 98, '', mono(art.small, CSS.knownMid)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtWeapon = add.text(GAME.WINDOW_W - 20, L.weaponY, '', mono(compact ? 17 : 14, CSS.known, true)).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtRoom = add.text(GAME.WINDOW_W - 20, L.roomY, '', mono(art.small, CSS.knownMid)).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtObjective = add.text(GAME.WINDOW_W / 2, 676, '', mono(compact ? 16 : 15, CSS.interact)).setOrigin(0.5, 0.5).setDepth(HUD_DEPTH);
    this.txtEnemies = add.text(GAME.WINDOW_W - 20, L.enemiesY, '', mono(art.body, CSS.known, true)).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtBossHp = add.text(GAME.WINDOW_W / 2, 30, '', mono(art.boss, CSS.known, true)).setOrigin(0.5, 0.5).setDepth(HUD_DEPTH);
    // Boss fill: left edge pinned (displayOrigin set in refreshBoss) so it drains to the
    // right and stays inside its frame (audit 7.9: fill used to start at the centre).
    this.bossBarFill = add.rectangle(GAME.WINDOW_W / 2, 52, 0, 8, INK.hostile, 1).setOrigin(0.5, 0.5).setDepth(HUD_DEPTH);
    this.txtMap = add.text(GAME.WINDOW_W - 20, GAME.WINDOW_H - 132, '', mono(art.tiny, CSS.knownMid)).setOrigin(1, 0).setLetterSpacing(1).setDepth(HUD_DEPTH);
    this.txtStats = add.text(20, GAME.WINDOW_H - 22, '', mono(art.small, CSS.knownLow)).setOrigin(0, 0).setDepth(HUD_DEPTH);

    // AI-NATIVE-02 control rows (kept from the authoritative world branch, merged
    // with the survey HUD layout rather than replacing it).
    this.txtControl = add.text(GAME.WINDOW_W - 20, L.controlY, '', { fontFamily: FONT.mono, fontSize: L.controlFont, fontStyle: 'bold', color: UIC.muted }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtAiAction = add.text(GAME.WINDOW_W - 20, L.actionY, '', { fontFamily: FONT.mono, fontSize: L.rowFont, color: UIC.muted }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtAiTarget = add.text(GAME.WINDOW_W - 20, L.targetY, '', { fontFamily: FONT.mono, fontSize: L.rowFont, color: UIC.muted }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtAgentLink = add.text(GAME.WINDOW_W - 20, L.linkY, 'LOCAL DETERMINISTIC DEMO · EXTERNAL NOT CONNECTED', { fontFamily: FONT.mono, fontSize: L.rowFont, color: UIC.warn }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtEcho = add.text(GAME.WINDOW_W - 20, L.echoY, 'ECHO OFF · PAUSE > ECHO COMPANION', { fontFamily: FONT.mono, fontSize: L.rowFont, color: UIC.accent }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtSignal = add.text(GAME.WINDOW_W - 20, L.signalY, 'RELAY OFF · NO DEVICE', { fontFamily: FONT.mono, fontSize: L.rowFont, color: UIC.muted }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtHelp = add.text(20, L.helpY, 'ESC PAUSE · ANY MOVE / FIRE / F TAKES HUMAN CONTROL', { fontFamily: FONT.mono, fontSize: L.helpFont, color: L.helpColor }).setOrigin(0, 0).setDepth(HUD_DEPTH);

    this.hudObjects = [
      this.hud, this.txtVitals, this.txtHp, this.txtXp, this.txtCurrency, this.txtLevel, this.timer,
      this.txtWeapon, this.txtRoom, this.txtObjective, this.txtEnemies, this.txtBossHp, this.bossBarFill,
      this.txtMap, this.txtStats, this.txtControl, this.txtAiAction, this.txtAiTarget, this.txtAgentLink,
      this.txtEcho, this.txtSignal, this.txtHelp
    ];
    this.hudVisible = true;
  }

  /** UI-REWORK-01: hide the whole HUD while a menu/overlay owns the screen, and
   *  restore it on resume. Never clears text — only visibility. */
  setHudVisible(visible: boolean): void {
    if (!this.hud || this.hudVisible === visible) return;
    this.hudVisible = visible;
    for (const o of this.hudObjects) {
      const target = o as unknown as { scene?: unknown; setVisible?: (v: boolean) => void };
      if (!target.scene) continue;
      target.setVisible?.(visible);
    }
    for (const b of this.banners) if (b.t.scene) b.t.setVisible(visible);
  }

  private lockHud(): void {
    const z = this.cam.zoom || 1;
    const iz = 1 / z;
    const world = (sx: number, sy: number) => this.cam.getWorldPoint(sx, sy);
    // Place each element's origin at its on-screen target via the camera's own
    // transform, so it stays fixed on screen regardless of scroll/zoom.
    const place = (o: { x: number; y: number; scaleX: number; scaleY: number }, tx: number, ty: number) => {
      const w = world(tx, ty);
      o.x = w.x; o.y = w.y; o.scaleX = iz; o.scaleY = iz;
    };
    place(this.hud, 0, 0);
    place(this.txtVitals, 20, this.hudLayout.vitalsY);
    place(this.txtHp, 230, 25);
    place(this.txtXp, 230, 44);
    place(this.txtCurrency, 20, 58);
    place(this.txtLevel, 20, 76);
    const L = this.hudLayout;
    place(this.txtWeapon, GAME.WINDOW_W - 20, L.weaponY);
    place(this.txtRoom, GAME.WINDOW_W - 20, L.roomY);
    place(this.txtObjective, GAME.WINDOW_W / 2, 676);
    place(this.txtEnemies, GAME.WINDOW_W - 20, L.enemiesY);
    place(this.txtControl, GAME.WINDOW_W - 20, L.controlY);
    place(this.txtAiAction, GAME.WINDOW_W - 20, L.actionY);
    place(this.txtAiTarget, GAME.WINDOW_W - 20, L.targetY);
    place(this.txtAgentLink, GAME.WINDOW_W - 20, L.linkY);
    place(this.txtEcho, GAME.WINDOW_W - 20, L.echoY);
    place(this.txtSignal, GAME.WINDOW_W - 20, L.signalY);
    place(this.txtHelp, 20, L.helpY);
    place(this.txtBossHp, GAME.WINDOW_W / 2, 30);
    place(this.bossBarFill, GAME.WINDOW_W / 2, 52);
    place(this.timer, 20, 98);
    place(this.txtMap, GAME.WINDOW_W - 20, GAME.WINDOW_H - 132);
    place(this.txtStats, 20, GAME.WINDOW_H - 22);
    for (const b of this.banners) if (b.t.scene) place(b.t, b.x, b.y);
  }

  /**
   * Screen-locked banner in the top band (03 §4: never over the player's head).
   * Text objects are pinned every frame by lockHud and fade over TIME.toast.
   */
  private banner(title: string, sub: string, color: string = CSS.known): void {
    this.banners = this.banners.filter((b) => b.t.scene);
    for (const b of this.banners) b.t.destroy();
    this.banners = [];
    const mk = (y: number, text: string, size: number, col: string, bold: boolean) => {
      const t = this.add.text(0, 0, text, { fontFamily: FONT.mono, fontSize: `${size}px`, color: col, fontStyle: bold ? 'bold' : 'normal' })
        .setOrigin(0.5, 0.5).setLetterSpacing(bold ? 4 : 1).setDepth(DEPTH.hud);
      this.banners.push({ t, x: GAME.WINDOW_W / 2, y });
      this.tweens.add({ targets: t, alpha: { from: 1, to: 0 }, delay: TIME.toast * 0.55, duration: TIME.toast * 0.45, onComplete: () => t.destroy() });
    };
    mk(108, title, 16, color, true);
    if (sub) mk(128, sub, 11, CSS.knownMid, false);
    // lockHud() pins these before the next render (update always runs first).
  }

  update(_time: number, delta: number): void {
    if (this.paused) return;
    // C2: sample one intent per rendered frame, then step the single core at
    // fixed 60Hz ticks. Paused/level-up/inventory frames do not accumulate.
    const ptr = this.input.activePointer;
    this.world.player.aimFromPointer(ptr);
    this.world.player.setFireHeld(this.fireHeld);
    // C3-b: poll the bridge for the next external intent BEFORE the tick so it
    // is executed by the same core tick path as every other controller.
    void this.externalLink?.beforeFrame();
    const intent = this.world.player.sampleIntent();
    this.world.stepFrame(delta, intent);
    if (intent.interact) this.world.tryInteract(this.world.player);
    // PLAYER signal actions (OWNER/human only), on the player's own energy account.
    // T = scan, Y = jam, R = toggle relay. Independent from Q/E weapon switching.
    // Edge-triggered: one press = one commit, debounced until key release. A
    // physical Signal press first reclaims control (humanTakeover), then the
    // command goes through the same core commit path as every other player
    // action, never bypassing permission checks. Pause/forms do not trigger.
    if (this.world.sim.signal && !this.paused && !this.signalKeyCooldown) {
      const k = this.input.keyboard;
      const issueScan = k && Phaser.Input.Keyboard.JustDown(this.keyT);
      const issueJam = k && Phaser.Input.Keyboard.JustDown(this.keyY);
      const issueToggle = k && Phaser.Input.Keyboard.JustDown(this.keyR);
      if (issueScan || issueJam || issueToggle) {
        // Reclaim control from AI/External before issuing a physical Signal command.
        if (this.world.player.control.owner !== 'human') {
          this.takeoverFromHumanInput();
        }
        if (this.world.player.control.owner === 'human') {
          if (issueScan) this.world.playerSignalScan();
          else if (issueJam) this.world.playerSignalJam();
          else if (issueToggle) this.world.toggleRelay();
          this.signalKeyCooldown = true;
        }
      }
    }
    // Release clears the cooldown so the same key can be pressed again.
    // On pause/resume the cooldown is cleared, so a held key cannot repeat
    // after resume without a fresh press.
    if (this.signalKeyCooldown && this.input.keyboard &&
        !this.input.keyboard.addKey('T').isDown &&
        !this.input.keyboard.addKey('Y').isDown &&
        !this.input.keyboard.addKey('R').isDown) {
      this.signalKeyCooldown = false;
    }
    // Companion receipt: only AFTER a real core tick consumed the confirmed
    // intent (never early, never while paused with no tick).
    if (this.pendingCompanionReceipt && this.world.sim.tick > this.pendingCompanionReceipt.enqueuedTick) {
      const { suggestionId, generation, roomId } = this.pendingCompanionReceipt;
      this.pendingCompanionReceipt = null;
      void this.companionLink?.postApplied(suggestionId, this.world.sim.tick, { generation, roomId }).then((ok) => {
        // Publish the fresh post-commit observation so the model reads its own
        // real result (damage / state). Never advances the simulation.
        if (ok) void this.companionLink?.pushObservation();
      });
    }
    if (!this.paused && this.checkpointDirty) this.saveCheckpoint();
    // C3-b: after the tick, ACK any executed external intent with the real
    // post-commit tick and push the post-commit observation.
    void this.externalLink?.afterFrame();

    // camera follows player (Phaser 3.90: Camera.follow removed -> manual scroll lerp)
    const px = this.world.player.sprite.x, py = this.world.player.sprite.y;
    const t = this.cam.getScroll(px, py);
    this.cam.scrollX += (t.x - this.cam.scrollX) * GAME.CAM_LERP;
    this.cam.scrollY += (t.y - this.cam.scrollY) * GAME.CAM_LERP;

    // camera zoom out toward boss arenas
    // camera zoom toward boss arenas (manual; zoomTo() is broken in Phaser 3.90)
    const room = this.world.currentRoom();
    const targetZoom = room && (room.kind === 'boss') ? GAME.CAM_ZOOM_MAX : GAME.CAM_ZOOM_MIN;
    this.cam.zoom = this.cam.zoom + (targetZoom - this.cam.zoom) * 0.05;

    // Now that the camera scroll/zoom have settled this frame, lock the screen-space HUD
    // to it so it neither trails the camera nor rescales with zoom.
    this.lockHud();

    // screen shake: Phaser expects intensity as a 0..1 fraction of the viewport,
    // not a pixel count (SHAKE_MAX / WINDOW_W is at most ~0.014).
    if (this.world.shakeAmount > 0.5 && saveSystem.getSettings().screenShake) {
      this.cam.shake(100, this.world.shakeAmount / GAME.WINDOW_W);
    }

    this.companionFrame += 1;
    if (this.companionLink && this.companionFrame % 30 === 0) void this.companionLink.pushObservation();
    this.refreshHud(Math.max(0, delta) / 1000);
    this.refreshMinimap();
    this.refreshBoss();
    this.updateStats();
  }

  /** Hairline frame corner ticks (survey-manual frame language, A4). */
  private ticks(x0: number, y0: number, x1: number, y1: number, len = 6, alpha = 0.55): void {
    const g = this.hud;
    g.lineStyle(1, INK.known, alpha);
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      g.lineBetween(x, y, x + sx * len, y); g.lineBetween(x, y, x, y + sy * len);
    }
  }

  private refreshHud(dt: number): void {
    if (!this.hud || !this.hudVisible) return;
    const g = this.hud;
    g.clear();
    const p = this.world.player;
    const w = p.weapon;

    // ---- vitals: segmented HP (10 HP / segment), recent loss flashes vermilion then drains
    g.fillStyle(INK.panel, 0.55); g.fillRect(12, 8, 300, 112);
    this.ticks(12, 8, 312, 120);
    const hp = Math.max(0, p.data.hp), max = p.data.maxHp;
    if (this.hpShown < 0 || hp > this.hpShown) this.hpShown = hp;
    if (this.previousHp >= 0 && hp < this.previousHp) this.hpLossFlash = TIME.lowHpPulse / 3000;
    this.previousHp = hp;
    this.hpLossFlash = Math.max(0, this.hpLossFlash - dt);
    if (this.hpLossFlash <= 0) this.hpShown = Math.max(hp, this.hpShown - max * dt * 1.5);
    const n = Math.max(5, Math.min(20, Math.round(max / 10)));
    const bx = 20, by = 28, bw = 200, bh = 11, gap = 2;
    const sw = (bw - gap * (n - 1)) / n;
    const low = hp / max < 0.3;
    const pulse = low ? 0.5 + 0.5 * Math.sin((this.world.clock * 2 * Math.PI * 1000) / TIME.lowHpPulse) : 0;
    for (let i = 0; i < n; i++) {
      const x = bx + i * (sw + gap);
      const segLo = (i / n) * max, segHi = ((i + 1) / n) * max;
      g.fillStyle(INK.mass, 1); g.fillRect(x, by, sw, bh);
      const fill = Math.max(0, Math.min(1, (hp - segLo) / (segHi - segLo)));
      const lost = Math.max(0, Math.min(1, (this.hpShown - segLo) / (segHi - segLo)));
      if (lost > fill) { g.fillStyle(INK.hostile, 0.9); g.fillRect(x + sw * fill, by, sw * (lost - fill), bh); }
      if (fill > 0) {
        g.fillStyle(low ? (pulse > 0.5 ? INK.hostile : INK.known) : INK.known, 1);
        g.fillRect(x, by, sw * fill, bh);
      }
      g.lineStyle(1, INK.known, 0.35); g.strokeRect(x + 0.5, by + 0.5, sw - 1, bh - 1);
    }
    this.txtHp.setText(`${Math.ceil(hp)} / ${max}`);
    // XP hairline bar
    const xpRatio = Math.max(0, Math.min(1, p.data.xp / p.data.xpToNext));
    g.fillStyle(INK.mass, 1); g.fillRect(bx, 46, bw, 4);
    g.fillStyle(INK.knownMid, 0.85); g.fillRect(bx, 46, bw * xpRatio, 4);
    g.lineStyle(1, INK.known, 0.3);
    for (let i = 1; i < 4; i++) g.lineBetween(bx + (bw * i) / 4, 44, bx + (bw * i) / 4, 52);
    this.txtXp.setText(`XP ${p.data.xp}/${p.data.xpToNext}`);
    this.txtCurrency.setText(`CREDITS ${p.data.currency}`);
    this.txtLevel.setText(`LV ${p.data.level}`);
    const secs = Math.floor((this.time.now - this.runStart) / 1000);
    this.timer.setText(`T+${formatDuration(Math.max(0, secs))}`);

    // ---- weapon / room / hostiles (top-right). UI-ART-01: both right-hand
    // panels size to their text, so long status rows never spill out of the
    // frame; the frame is drawn after the texts are updated (see below).
    const weaponState = p.data.weapons.find(({ key }) => key === p.data.weaponKey);
    const ammo = weaponState && weaponState.magazine > 0
      ? weaponState.reloading ? ' · RELOADING' : ` · ${weaponState.ammo}/${weaponState.magazine}`
      : ' · ∞';
    this.txtWeapon.setText(`${w.name} [${w.icon}]${ammo}`);
    const room = this.world.currentRoom();
    const total = this.world.map.rooms.length;
    if (this.deck === undefined) {
      if (room) this.txtRoom.setText(`R-${String(room.id).padStart(2, '0')} · ${room.kind.toUpperCase()} · SURVEYED ${this.world.surveyedRooms()}/${total}`);
    } else {
      this.txtRoom.setText(`${deckLabel(this.deck)} · ${room?.kind.toUpperCase() ?? 'CORRIDOR'}`);
      this.txtObjective.setText(this.world.roomObjective);
    }
    const aliveEnemies = this.world.enemies.length + (this.world.boss ? 1 : 0);
    this.txtEnemies.setText(`HOSTILES ${aliveEnemies}`);
    const L = this.hudLayout;
    const R = GAME.WINDOW_W - 12;
    const topW = Math.max(this.txtWeapon.width, this.txtRoom.width, this.txtEnemies.width + Math.min(aliveEnemies, 16) * 10 + 14);
    const topX = Math.min(1000, R - topW - 20);
    const topBottom = L.enemiesY + this.txtEnemies.height + 4;
    g.fillStyle(INK.panel, 0.55); g.fillRect(topX, 8, R - topX, topBottom - 8);
    this.ticks(topX, 8, R, topBottom);
    // one hollow pip per hostile (shape-coded, not colour-coded), set on the
    // HOSTILES row to the left of its label so the two never collide
    const pipY = L.enemiesY + this.txtEnemies.height / 2;
    for (let i = 0; i < Math.min(aliveEnemies, 16); i++) {
      const x = GAME.WINDOW_W - 20 - this.txtEnemies.width - 12 - i * 10, y = pipY;
      g.lineStyle(1.2, INK.known, 0.8);
      g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 4, y); g.lineTo(x, y + 4); g.lineTo(x - 4, y); g.closePath(); g.strokePath();
    }

    // AI-NATIVE-02 P1: control ownership, last executed AI action/target, and
    // the truthful link state (no external agent is attached in this phase).
    const control = p.control.snapshot();
    this.txtControl.setText(`CONTROL  ${control.modeLabel}`);
    this.txtControl.setColor(control.owner === 'ai' ? UIC.signal : control.paused ? UIC.warn : UIC.muted);
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
      this.txtEcho.setColor(UIC.accent);
    } else if (echo.data.hp <= 0) {
      this.txtEcho.setText('ECHO DOWN · INDEPENDENT OF YOU');
      this.txtEcho.setColor(UIC.warn);
    } else {
      const mode = this.world.echoMode === 'follow' ? 'FOLLOW'
        : this.world.echoMode === 'hold' ? 'HOLD' : 'MOVE';
      const assist = this.world.echoAssistArmed ? 'ASSIST ARMED' : 'ASSIST SAFE';
      const suggest = this.world.echoSuggestion ? ' · CONFIRM FIRE' : '';
      const link = this.companionStatus === 'CONNECTED' ? ' · COMPANION CONNECTED'
        : this.companionStatus === 'FALLBACK:NO_MODEL' ? ' · COMPANION NO MODEL'
        : this.companionStatus === 'READ_ONLY' ? ' · COMPANION READ ONLY' : '';
      this.txtEcho.setText(`ECHO ${Math.ceil(echo.data.hp)}/${echo.data.maxHp} · ${mode} · ${assist}${suggest}${link}`);
      this.txtEcho.setColor(this.world.echoSuggestion ? UIC.warn : UIC.accent);
    }
    this.refreshSignalHud();
    // AI / link status block: its own, quieter panel under the weapon panel.
    const rows = [this.txtControl, this.txtAiAction, this.txtAiTarget, this.txtAgentLink, this.txtEcho, this.txtSignal];
    const rowsW = Math.max(...rows.map((t) => t.width));
    const midX = R - rowsW - 20;
    const midTop = Math.max(L.controlY - 5, topBottom + 3), midBottom = L.signalY + this.txtSignal.height + 6;
    g.fillStyle(INK.panel, 0.42); g.fillRect(midX, midTop, R - midX, midBottom - midTop);
    this.ticks(midX, midTop, R, midBottom, 5, 0.35);
    const settings = saveSystem.getSettings();
    audio.setVolumes(settings.masterVolume, settings.sfxVolume);
  }

  /** Survey map: observed rooms solid, unobserved inferred (dashed), executor = cyan dot. */
  private refreshMinimap(): void {
    const g = this.hud;
    const map = this.world.map;
    const rooms = map.rooms;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rooms) { minX = Math.min(minX, r.gx); minY = Math.min(minY, r.gy); maxX = Math.max(maxX, r.gx + r.w); maxY = Math.max(maxY, r.gy + r.h); }
    const box = { x: GAME.WINDOW_W - 196, y: GAME.WINDOW_H - 114, w: 176, h: 96 };
    const s = Math.min(box.w / Math.max(1, maxX - minX), box.h / Math.max(1, maxY - minY));
    const ox = box.x + (box.w - (maxX - minX) * s) / 2 - minX * s;
    const oy = box.y + (box.h - (maxY - minY) * s) / 2 - minY * s;
    g.fillStyle(INK.panel, 0.55); g.fillRect(box.x - 8, box.y - 26, box.w + 16, box.h + 34);
    this.ticks(box.x - 8, box.y - 26, box.x + box.w + 8, box.y + box.h + 8);
    g.lineStyle(1, INK.known, 0.25);
    for (const r of rooms) for (const c of r.connectedTo) {
      if (c < r.id) continue;
      const t = rooms[c];
      g.lineBetween(ox + (r.gx + r.w / 2) * s, oy + (r.gy + r.h / 2) * s, ox + (t.gx + t.w / 2) * s, oy + (t.gy + t.h / 2) * s);
    }
    const cur = this.world.currentRoom()?.id;
    for (const r of rooms) {
      const x = ox + r.gx * s, y = oy + r.gy * s, w = Math.max(4, r.w * s), h = Math.max(4, r.h * s);
      if (this.world.renderer?.isObserved(r.id)) {
        g.fillStyle(r.id === cur ? INK.massLift : INK.mass, 1); g.fillRect(x, y, w, h);
        g.lineStyle(r.id === cur ? 1.6 : 1, INK.known, r.id === cur ? 1 : 0.7); g.strokeRect(x, y, w, h);
      } else {
        g.lineStyle(1, INK.known, 0.35);
        for (const [x0, y0, x1, y1] of [[x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]]) {
          const len = Math.hypot(x1 - x0, y1 - y0);
          for (let d = 0; d < len; d += 5) {
            const e = Math.min(len, d + 2.5);
            g.lineBetween(x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len, x0 + ((x1 - x0) * e) / len, y0 + ((y1 - y0) * e) / len);
          }
        }
      }
    }
    g.fillStyle(INK.interact, 1);
    g.fillCircle(ox + this.world.player.x * s, oy + this.world.player.y * s, 2.5);
    this.txtMap.setText(`SURVEY MAP · ${this.world.surveyedRooms()}/${rooms.length}`);
  }

  private refreshBoss(): void {
    const boss = this.world.boss;
    if (!boss) { this.bossBarFill.width = 0; this.txtBossHp.setText(''); return; }
    const g = this.hud;
    const ratio = Math.max(0, boss._hp / boss.maxHp());
    const x0 = GAME.WINDOW_W / 2 - 160;
    g.fillStyle(INK.panel, 0.7); g.fillRect(x0, 44, 320, 16);
    g.lineStyle(1, INK.known, 0.5); g.strokeRect(x0 + 0.5, 44.5, 319, 15);
    for (const f of [1 / 3, 2 / 3]) g.lineBetween(x0 + 320 * f, 40, x0 + 320 * f, 64); // phase thresholds
    this.ticks(x0 - 6, 18, x0 + 326, 66, 6, 0.4);
    this.bossBarFill.width = 316 * ratio;
    // Left-anchored fill inside the frame [482, 798] — independent of the current width.
    this.bossBarFill.setDisplayOrigin(158, 4);
    this.txtBossHp.setText(`★ ${boss.name} — PHASE ${boss.phase} ★`);
  }

  private updateStats(): void {
    const secs = Math.floor((this.time.now - this.runStart) / 1000);
    this.txtStats.setText(`KILLS ${this.enemiesKilled} · LOOT ${this.itemsCollected} · DMG ${Math.round(this.damageDealt)} · ${secs}s`);
  }

  private refreshSignalHud(): void {
    const s = this.world.signalView() as { relay: string; echoEnergy?: number; playerEnergy?: number; playerScanCD?: number; playerJamCD?: number; echoScanCD?: number; echoJamCD?: number; exitOpen: boolean } | null;
    if (!s) {
      if (this.txtSignal) this.txtSignal.setText('RELAY OFF · NO DEVICE');
      return;
    }
    const e = s.echoEnergy ?? 0, p = s.playerEnergy ?? 0;
    let c = '';
    if (s.echoEnergy !== undefined) c += ` echoScanCD:${s.echoScanCD}t/jamCD:${s.echoJamCD}t`;
    if (s.playerEnergy !== undefined && s.playerEnergy > 0) c += ` playerScanCD:${s.playerScanCD}t/jamCD:${s.playerJamCD}t`;
    const exit = s.exitOpen ? 'EXIT OPEN' : 'EXIT CLOSED';
    let txt = `RELAY ${s.relay.toUpperCase()} | e:${e} p:${p}`;
    if (c) txt += c;
    txt += ` · ${exit}`;
    if (this.txtSignal) this.txtSignal.setText(txt);
    this.txtSignal.setColor(s.relay === 'ACTIVE' ? UIC.signal : s.relay === 'JAMMED' ? UIC.warn : UIC.muted);
  }

  private runStats(): RunCheckpoint['stats'] {
    return {
      kills: this.enemiesKilled,
      items: this.itemsCollected,
      damage: this.damageDealt,
      elapsedSeconds: Math.max(0, Math.floor((this.time.now - this.runStart) / 1000))
    };
  }

  markCheckpointDirty(): void { this.checkpointDirty = true; }

  saveCheckpoint(): boolean {
    if (this.runFinished) return false;
    const checkpoint = this.world.captureCheckpoint(this.runId, this.seed, this.runStats());
    if (!checkpoint) return false;
    // Only clear the dirty flag once the write actually succeeded; a failed
    // save must stay dirty so a later retry persists it.
    const written = saveSystem.writeCheckpoint(checkpoint, this.runId);
    if (written) this.checkpointDirty = false;
    return written;
  }

  private onLevelUp(level: number): void {
    if (this.world.won || this.runFinished) return;
    this.pendingLevels.push(level);
    if (!this.levelUpActive) this.openNextLevelUp();
  }

  private openNextLevelUp(): void {
    const level = this.pendingLevels.shift();
    if (level === undefined) return;
    this.levelUpActive = true;
    // C3-b: a level-up overlay cancels pending external intents.
    this.externalLink?.degrade('level-up');
    audio.levelup();
    this.paused = true;
    this.world.player.control.pause();
    this.world.player.clearHeldInput();
    this.refreshHud(0);
    this.world.resetSimulationAccumulator();
    this.cameras.main.setAlpha(0.5);
    this.scene.launch('LevelUpScene', { level, onClose: () => this.onLevelUpClosed() });
  }

  /** Public callback invoked by LevelUpScene.choose() after a choice is applied. */
  onLevelUpClosed(): void {
    this.scene.stop('LevelUpScene');
    this.levelUpActive = false;
    if (this.pendingLevels.length > 0) {
      // More levels queued from the same XP gain: open the next one.
      this.openNextLevelUp();
    } else {
      this.paused = false;
      this.world.player.control.resume();
      this.world.player.clearHeldInput();
      this.refreshHud(0);
      // Commands queued while the overlay was open (upgrade/loot) commit on the
      // next real frame tick; do not force a tick here. The accumulator is reset
      // so a paused overlay does not bank time, and the queued command is
      // reported as pending until the normal update commits it.
      this.world.resetSimulationAccumulator();
      this.refreshHud(0);
      if (!this.paused && this.checkpointDirty) this.saveCheckpoint();
      this.cameras.main.setAlpha(1);
    }
  }

  private onRoomEntered(room: RoomInfo): void {
    if (room.kind === 'boss') audio.bossroar();
    else audio.wave();
    // Committed room boundary: the companion's previous-room work dies with the
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
  }

  private onRoomCleared(room: RoomInfo): void {
    this.checkpointDirty = true;
    // The start room is marked cleared on create so a fresh run can be persisted;
    // do not flash a combat banner or play the clear cue for this synthetic event.
    if (room.kind === 'start') return;
    audio.wave();
    this.banner('ROOM CLEARED', `R-${String(room.id).padStart(2, '0')}`, CSS.interact);
  }

  private onDeath(): void {
    if (this.runFinished) return;
    this.runFinished = true;
    // C3-b: death cancels pending external intents.
    this.externalLink?.degrade('death');
    this.pendingLevels = [];
    this.levelUpActive = false;
    // Death ends the run: hand ownership back to the human and drop AI state.
    this.world.player.control.onDeath();
    this.world.resetSimulationAccumulator();
    this.world.player.clearHeldInput();
    this.fireHeld = false;
    audio.death();
    const stats = this.runStats();
    saveSystem.finishRun(this.runId, false, this.seed, stats);
    this.scene.stop('LevelUpScene');
    this.scene.start('GameOverScene', { seed: this.seed, stats, won: false, deck: this.deck });
  }

  private onBossWin(): void {
    if (this.runFinished) return;
    this.runFinished = true;
    this.world.player.control.onRunEnd();
    this.world.resetSimulationAccumulator();
    this.world.player.clearHeldInput();
    this.fireHeld = false;
    const stats = this.runStats();
    const coreAwarded = saveSystem.finishRun(this.runId, true, this.seed, stats);
    this.pendingLevels = [];
    this.levelUpActive = false;
    audio.bossroar();
    const p = this.world.player;
    const s = this.world.worldToScreen(p.x, p.y);
    const labelY = Math.max(40, p.sprite.displayOriginY * p.sprite.scaleY + 14);
    const t = this.add.text(s.x, s.y - labelY, 'THE WARDEN DESTROYED', {
      fontFamily: FONT.mono, fontSize: '20px', color: CSS.priority, fontStyle: 'bold',
      stroke: CSS.shadow, strokeThickness: 4
    }).setOrigin(0.5, 0.5).setDepth(200).setLetterSpacing(4);
    this.tweens.add({ targets: t, alpha: 0, duration: 1200, onComplete: () => t.destroy() });
    this.time.addEvent({
      delay: 2200,
      repeat: 0,
      callback: () => {
        this.scene.stop('PauseScene');
        this.scene.stop('LevelUpScene');
        this.scene.start('GameOverScene', { seed: this.seed, stats, won: true, coreAwarded, deck: this.deck });
      }
    });
  }

  private onPause(): void {
    if (this.paused) return;
    // C3-b: pausing cancels pending external intents (they must not fire while
    // the game is frozen) and the epoch is bumped.
    this.externalLink?.degrade('pause');
    // Publish the latest post-commit observation so the paused companion UI and
    // the Agent read the real frozen state. Never advances the simulation.
    void this.companionLink?.pushObservation();
    this.saveCheckpoint();
    this.paused = true;
    this.world.player.control.pause();
    this.world.player.clearHeldInput();
    this.fireHeld = false;
    // Pause clears any pending signal key debounce so a held key cannot fire
    // again after resume without a fresh press.
    this.signalKeyCooldown = false;
    this.refreshHud(0);
    this.world.resetSimulationAccumulator();
    this.scene.launch('PauseScene', { mode: 'pause' });
  }

  onResume(): void {
    this.world.resetSimulationAccumulator();
    this.paused = false;
    this.world.player.control.resume();
    this.world.player.clearHeldInput();
    this.fireHeld = false;
    // Commands queued while the overlay was open (equip / upgrade / supply
    // purchase) commit on the next real frame tick that accumulates a full
    // tick; do not force a tick on resume. The accumulator is reset so the
    // paused overlay banks no time, and the UI keeps QUEUED until commit.
    this.world.resetSimulationAccumulator();
    this.refreshHud(0);
    if (!this.paused && this.checkpointDirty) this.saveCheckpoint();
  }

  /**
   * C3-b: authorize an external agent link. This is a HUMAN action (the pause
   * menu button); an agent can never call it on the human's behalf. The bridge
   * URL and token are injected by the host page, never hard-coded here.
   */
  async authorizeExternalAgent(bridgeUrl: string, token: string, ownerKey: string): Promise<boolean> {
    // The page-level config is a one-shot injection aid, never a credential
    // store. Remove it immediately after this authorization attempt; only the
    // live link keeps the required credentials in memory.
    const clearGlobalConfig = (): void => {
      const g = globalThis as unknown as { __externalLinkConfig?: unknown };
      if (g.__externalLinkConfig !== undefined) delete g.__externalLinkConfig;
    };
    clearGlobalConfig();
    if (!bridgeUrl || !token || !ownerKey) return false;
    // A fresh HUMAN click may re-authorize a yielded/lost link. This is never
    // automatic: without the click the agent stays yielded.
    if (this.externalLink) {
      if (this.world.externalLink.snapshot().status === 'CONNECTED') return false;
      // Wait for the old bridge session to actually close, otherwise the new
      // handshake races the teardown and the bridge answers 409 duplicate.
      await this.externalLink.dispose();
      this.externalLink = null;
    }
    this.externalLink = new ExternalLinkController({
      world: this.world,
      bridgeUrl,
      token,
      ownerKey,
      authorize: () => { /* the human click already happened */ }
    });
    const ok = await this.externalLink.authorizeHuman();
    if (!ok) {
      this.lastExternalLinkError = this.externalLink?.lastError
        ?? { code: 'E_LINK_UNAVAILABLE', messageKey: 'world.bridge_unreachable' };
      this.externalLink = null;
      return false;
    }
    this.lastExternalLinkError = null;
    // G4: External protagonist control is mutually exclusive with Companion
    // authority. Set the companion READ_ONLY in the SAME human action.
    this.companionLink?.setOwnerMode('external');
    clearOwnerPairing(this);
    this.refreshHud(0);
    return true;
  }

  /** Real error from the last human authorize attempt (never a token). */
  getExternalLinkError(): { code: string; messageKey: string } | null {
    return this.lastExternalLinkError;
  }

  /** C3-b: the human took over -> cancel every pending external intent. */
  cancelExternalLink(reason: ExternalLinkDegradeReason = 'takeover'): void {
    this.externalLink?.degrade(reason);
  }

  /** Dev entry for the real World, used by the Pause menu button. */
  /** P3-a: human-driven echo commands (never reachable by an external agent). */
  enableEcho(): void {
    this.takeoverFromHumanInput();
    this.world.enableEcho();
    this.refreshHud(0);
  }

  disableEcho(): void {
    this.world.disableEcho();
    this.refreshHud(0);
  }

  setEchoMode(mode: 'follow' | 'hold' | 'move-to'): void {
    if (mode === 'move-to') {
      // "MOVE TO AIM": the human's current aim direction, 4 tiles ahead.
      const a = this.world.playerAimYaw;
      this.world.setEchoMode('move-to', {
        x: this.world.playerX + Math.cos(a) * 4,
        y: this.world.playerY + Math.sin(a) * 4
      });
    } else {
      this.world.setEchoMode(mode);
    }
    this.refreshHud(0);
  }

  confirmEchoAssist(): void {
    this.world.confirmEchoAssist();
    this.refreshHud(0);
  }

  revokeEchoAssist(): void {
    this.world.echoController.revokeAssist();
    this.refreshHud(0);
  }

  /**
   * P3-b A HUMAN authorize: creates a bridge session + the browser-only Owner
   * capability. This NEVER attaches an external Player controller and never
   * changes protagonist ownership; the agent MCP attaches later with its token.
   */
  /** HUMAN authorize the companion from explicit form parameters (no global).
   *  Used by the Pause menu owner pairing form. bridgeUrl/token/ownerKey come
   *  directly from the masked form fields; nothing is stored globally. */
  async authorizeCompanion(bridgeUrl: string, token: string, ownerKey: string): Promise<boolean> {
    if (!bridgeUrl || !token || !ownerKey) return false;
    try {
      const res = await fetch(`${bridgeUrl.replace(/\/$/, '')}/world-link/handshake`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          origin: location.origin
        },
        body: JSON.stringify({ authorized: true, protocolVersion: WORLD_PROTOCOL_VERSION, ownerKey })
      });
      const hs = await res.json() as { ok?: boolean; session?: string; epoch?: number; ownerCap?: string };
      if (!hs.ok || !hs.session || hs.epoch === undefined || !hs.ownerCap) {
        clearOwnerPairing(this);
        return false;
      }
      this.companionLink = new CompanionLink({
        bridgeUrl: bridgeUrl.replace(/\/$/, ''), token, origin: location.origin,
        session: hs.session, epoch: hs.epoch, ownerCap: hs.ownerCap,
        observation: () => this.world.echoView() as unknown as Record<string, unknown> | null,
        heartbeatIntervalMs: 1000,
        apply: (kind, target, suggestionId) => {
          const ok = this.world.enqueueCompanionAction(kind, target);
          if (ok && suggestionId) {
            this.pendingCompanionReceipt = {
              suggestionId,
              enqueuedTick: this.world.sim.tick,
              // Execution generation/room: the receipt must describe where the
              // action really ran, not where a later response arrived.
              generation: this.companionLink?.lastApplyGeneration ?? -1,
              roomId: this.companionLink?.lastApplyRoomId ?? null
            };
          }
          return ok;
        },
        appliedTick: () => this.world.sim.tick
      });
      // Seed the local room barrier with the CURRENT room BEFORE any HTTP, so a
      // proposal can never be created/consumed with an unknown room (and the
      // server learns the start room on the same authorize).
      const startRoom = this.world.roomIdValue;
      const startTick = this.world.sim.tick;
      this.companionLink.enterRoom(startRoom, startTick);
      const ok = await this.companionLink.authorize();
      if (ok) {
        // 1) tell the bridge which room this session starts in (monotonic seq),
        // 2) then publish the committed observation for THAT room, so
        //    echo_observe succeeds immediately.
        void this.companionLink.notifyRoom(startRoom, startTick)
          .then(() => this.companionLink?.pushObservation())
          .catch(() => undefined);
      }
      return ok;
    } catch {
      return false;
    }
  }

  /** HUMAN authorize: reads bridgeUrl/token/ownerKey from the page-level
   *  config wrapper (compat path for host pre-injected config). Normal UI
   *  should call authorizeCompanion(bridgeUrl, token, ownerKey) directly and
   *  never rely on a global. */
  async authorizeCompanionFromConfig(): Promise<boolean> {
    const config = (globalThis as unknown as {
      __externalLinkConfig?: { bridgeUrl?: string; token?: string; ownerKey?: string };
    }).__externalLinkConfig;
    const bridgeUrl = (config?.bridgeUrl ?? '').replace(/\/$/, '');
    const token = config?.token ?? '';
    const ownerKey = config?.ownerKey ?? '';
    return await this.authorizeCompanion(bridgeUrl, token, ownerKey);
  }

  /** HUMAN re-authorization on an existing live companion link: requires the
   *  private key and atomically swaps the capability (old cap stops working,
   *  pending unconfirmed suggestions cancelled). Wrong key does not break the
   *  active connection. When no live companion link exists, falls through to
   *  a fresh handshake requiring explicit Owner grant. */
  async reauthorizeCompanion(ownerKey: string): Promise<boolean> {
    if (!ownerKey) return false;
    const link = this.companionLink;
    if (link && link.status === 'CONNECTED') {
      const ok = await link.authorize('human', ownerKey);
      if (ok) clearOwnerPairing(this);
      return ok;
    }
    // No live link: a fresh handshake requires explicit Owner grant.
    return false;
  }

  get companionStatus(): string {
    return this.companionLink?.status ?? 'OFF';
  }

  /** Ask the policy for a suggestion using the echo's own perception. */
  suggestEcho(): 'fire' | null {
    const view = this.world.echoView();
    return view ? this.world.echoController.suggest(view) : null;
  }

  toggleAiControl(): boolean {
    const control = this.world.player.control;
    if (control.aiEnabled) {
      control.disableAi('pause-menu');
      this.world.player.clearHeldInput();
      this.companionLink?.setOwnerMode('human');
      return false;
    }
    control.enableAi(this.world.clock);
    this.companionLink?.setOwnerMode('ai');
    this.refreshHud(0);
    return true;
  }

  private switchWeapon(dir: number): void {
    if (this.paused) return;
    const owned = this.world.player.data.weapons.map((w) => w.key);
    if (owned.length <= 1) return;
    const idx = owned.indexOf(this.world.player.data.weaponKey);
    if (idx < 0) return;
    const next = owned[(idx + dir + owned.length) % owned.length];
    if (this.world.player.equipWeapon(next)) audio.ui();
  }

  private toggleInventory(): void {
    if (this.paused) return;
    // F-04: inventory is a pause-like overlay. Freeze authority and drop held
    // input exactly like onPause(); human takeover inside the overlay disables
    // the demo, so onResume() cannot silently hand control back to the AI.
    // C3-b: the overlay also cancels pending external intents.
    this.externalLink?.degrade('inventory');
    this.paused = true;
    this.world.player.control.pause();
    this.world.player.clearHeldInput();
    this.fireHeld = false;
    this.refreshHud(0);
    this.world.resetSimulationAccumulator();
    this.scene.launch('PauseScene', { mode: 'inventory' });
  }
}
