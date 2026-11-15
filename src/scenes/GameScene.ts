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

interface SceneConfig {
  seed?: number;
  resume?: boolean;
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

  // HUD elements
  private hpBar!: Phaser.GameObjects.Graphics;
  private hpFill!: Phaser.GameObjects.Rectangle;
  private xpBar!: Phaser.GameObjects.Graphics;
  private xpFill!: Phaser.GameObjects.Rectangle;
  private txtHp!: Phaser.GameObjects.Text;
  private txtXp!: Phaser.GameObjects.Text;
  private txtCurrency!: Phaser.GameObjects.Text;
  private txtWeapon!: Phaser.GameObjects.Text;
  private txtLevel!: Phaser.GameObjects.Text;
  private txtRoom!: Phaser.GameObjects.Text;
  private txtEnemies!: Phaser.GameObjects.Text;
  private txtBossHp!: Phaser.GameObjects.Text;
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossBarFill!: Phaser.GameObjects.Rectangle;
  private minimap!: Phaser.GameObjects.Graphics;
  private txtStats!: Phaser.GameObjects.Text;
  private timer!: Phaser.GameObjects.Text;
  // AI-NATIVE-02 P1 control HUD (honest local-demo labelling).
  private txtControl!: Phaser.GameObjects.Text;
  private txtAiAction!: Phaser.GameObjects.Text;
  private txtAiTarget!: Phaser.GameObjects.Text;
  private txtAgentLink!: Phaser.GameObjects.Text;
  private txtEcho!: Phaser.GameObjects.Text;
  /** P3-b A: browser-held owner capability (never exposed to the agent). */
  companionLink: CompanionLink | null = null;
  private companionFrame = 0;
  /** Confirmed companion suggestion awaiting its post-commit receipt. */
  private pendingCompanionReceipt: { suggestionId: string; enqueuedTick: number } | null = null;
  private txtHelp!: Phaser.GameObjects.Text;
  /** Compact-viewport HUD layout (F-06): larger logical fonts, no z-index tricks. */
  private hudLayout = {
    weaponY: 20, roomY: 44, enemiesY: 64,
    controlY: 90, actionY: 110, targetY: 128, linkY: 146, echoY: 164,
    helpY: GAME.WINDOW_H - 44, baseRowFont: '13px', controlFont: '13px', rowFont: '12px',
    helpFont: '13px', helpColor: '#8fb8c8'
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

  create(config: SceneConfig): void {
    // A previous run may have been left paused by an overlay (e.g. QUIT TO MENU).
    // Scene instances are reused, so clear the flag on every fresh run.
    this.paused = false;
    this.fireHeld = false;
    this.cameras.main.setAlpha(1);
    const save = saveSystem.load();
    const checkpoint = config?.resume ? save.run : undefined;
    if (config?.resume && !checkpoint) {
      this.scene.start('MainMenuScene', { notice: 'NO CHECKPOINT AVAILABLE' });
      return;
    }
    // A resumed run keeps the checkpoint's id; a brand-new run gets a fresh id.
    // A NEW RUN must not carry over a previous run's id, and its first checkpoint
    // write replaces the old on-disk run (see the undefined expectedId below).
    this.runId = checkpoint ? checkpoint.id : crypto.getRandomValues(new Uint32Array(4)).join('-');
    this.checkpointDirty = false;
    this.runFinished = false;
    this.pendingLevels = [];
    this.levelUpActive = false;
    this.enemiesKilled = checkpoint?.stats.kills ?? 0;
    this.itemsCollected = checkpoint?.stats.items ?? 0;
    this.damageDealt = checkpoint?.stats.damage ?? 0;
    this.runStart = this.time.now - (checkpoint?.stats.elapsedSeconds ?? 0) * 1000;
    this.seed = (checkpoint?.seed ?? config?.seed ?? Math.floor(Math.random() * 1e9)) >>> 0;
    const map = this.buildMap(this.seed);
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
      onBossWin: () => this.onBossWin()
    };
    this.world = new World(this, map, save, callbacks);
    if (checkpoint && !this.world.restoreCheckpoint(checkpoint)) {
      saveSystem.discardCheckpoint(checkpoint.id);
      this.scene.start('MainMenuScene', { notice: 'CHECKPOINT INCOMPATIBLE' });
      return;
    }
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
      saveSystem.writeCheckpoint(firstCheckpoint, undefined);
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
    this.input.keyboard!.on('keydown-F', () => {
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
    });
    // Snap the camera once. In Phaser 3.90 zoom is about the viewport center, so
    // getScroll() (which also clamps to setBounds) is the scroll that centers the
    // player; scrollX/Y must not be set to the player's world position directly.
    const px = this.world.player.sprite.x, py = this.world.player.sprite.y;
    const start = this.cam.getScroll(px, py);
    this.cam.setScroll(start.x, start.y);
    audio.ensureContext();
  }

  private buildMap(seed: number): any {
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
    this.refreshHud();
  }

  private setupHud(): void {
    // Screen-space HUD. Each element is added directly to the scene; every frame, lockHud
    // places its origin in the world (scroll + target / zoom) and scales it by 1 / zoom so
    // its on-screen position stays fixed as the camera scrolls and its size stays fixed as
    // the camera zooms in/out (zoomTo() is unavailable in this build).
    // Placing elements individually (instead of in a scaled container) keeps the far-right
    // text inside the camera's culling bounds. HUD_DEPTH sits above the lighting overlay (1)
    // and all world entities.
    const HUD_DEPTH = 500;
    const style = { fontFamily: 'monospace', fontStyle: 'bold' };
    const add = this.add;
    // F-06: FIT scales the 1280x720 canvas down (0.625 at 800x600). Use larger
    // logical fonts and more vertical room in compact viewports instead of
    // hiding rows, relying on z-index, or calling 7.5 CSS px "readable".
    // Phaser's displayScale is not a reliable FIT ratio across builds; use the
    // actual viewport-to-logical-canvas ratio (FIT + CENTER_BOTH).
    const scale = Math.min(
      window.innerWidth / GAME.WINDOW_W,
      window.innerHeight / GAME.WINDOW_H
    ) || 1;
    const compact = scale < 0.85;
    this.hudLayout = compact
      ? {
          weaponY: 16, roomY: 42, enemiesY: 68,
          controlY: 96, actionY: 124, targetY: 152, linkY: 180, echoY: 208,
          helpY: GAME.WINDOW_H - 52, baseRowFont: '17px', controlFont: '17px', rowFont: '17px',
          helpFont: '16px', helpColor: '#8fb8c8'
        }
      : {
          weaponY: 20, roomY: 44, enemiesY: 64,
          controlY: 90, actionY: 110, targetY: 128, linkY: 146, echoY: 164,
          helpY: GAME.WINDOW_H - 44, baseRowFont: '13px', controlFont: '13px', rowFont: '12px',
          helpFont: '13px', helpColor: '#8fb8c8'
        };

    // Graphics bars: fillRect() draws at fixed local offsets with origin (0,0), so the bar
    // origin (x,y) is the rect's top-left. lockHud pins it to that point via the camera
    // transform, so fillRect() lands on-screen. (originX/Y set directly: Graphics.setOrigin
    // is not present in this Phaser build.)
    this.hpBar = add.graphics().setDepth(HUD_DEPTH);
    (this.hpBar as any).originX = 0; (this.hpBar as any).originY = 0;
    this.xpBar = add.graphics().setDepth(HUD_DEPTH);
    (this.xpBar as any).originX = 0; (this.xpBar as any).originY = 0;
    this.bossBar = add.graphics().setDepth(HUD_DEPTH);
    (this.bossBar as any).originX = 0; (this.bossBar as any).originY = 0;

    // Rectangles + texts: their origin is placed at the target screen position by lockHud.
    this.hpFill = add.rectangle(0, 0, 0, 12, 0xff3355, 1).setOrigin(0, 0.5).setDepth(HUD_DEPTH);
    this.txtHp = add.text(128, 20, 'HP 100', { ...style, fontSize: '16px', color: '#eafaff' }).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.xpFill = add.rectangle(0, 0, 0, 6, 0x33e0ff, 1).setOrigin(0, 0.5).setDepth(HUD_DEPTH);
    this.txtXp = add.text(128, 40, 'XP 0', { ...style, fontSize: '12px', color: '#8fb8c8' }).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtCurrency = add.text(20, 60, 'CREDITS 0', { fontFamily: 'monospace', fontSize: '14px', color: '#ffd233' }).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtLevel = add.text(20, 80, 'LV 1', { fontFamily: 'monospace', fontSize: '14px', color: '#33e0ff' }).setOrigin(0, 0).setDepth(HUD_DEPTH);
    const L = this.hudLayout;
    this.txtWeapon = add.text(GAME.WINDOW_W - 20, L.weaponY, '', { fontFamily: 'monospace', fontSize: L.baseRowFont, color: '#ff8a3c' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtRoom = add.text(GAME.WINDOW_W - 20, L.roomY, '', { fontFamily: 'monospace', fontSize: L.baseRowFont, color: '#8fb8c8' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtEnemies = add.text(GAME.WINDOW_W - 20, L.enemiesY, '', { fontFamily: 'monospace', fontSize: L.baseRowFont, color: '#8fb8c8' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtControl = add.text(GAME.WINDOW_W - 20, L.controlY, '', { fontFamily: 'monospace', fontSize: L.controlFont, fontStyle: 'bold', color: '#8fb8c8' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtAiAction = add.text(GAME.WINDOW_W - 20, L.actionY, '', { fontFamily: 'monospace', fontSize: L.rowFont, color: '#8fb8c8' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtAiTarget = add.text(GAME.WINDOW_W - 20, L.targetY, '', { fontFamily: 'monospace', fontSize: L.rowFont, color: '#8fb8c8' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtAgentLink = add.text(GAME.WINDOW_W - 20, L.linkY, 'LOCAL DETERMINISTIC DEMO · EXTERNAL NOT CONNECTED', { fontFamily: 'monospace', fontSize: L.rowFont, color: '#ff8a3c' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtEcho = add.text(GAME.WINDOW_W - 20, L.echoY, 'ECHO OFF · PAUSE > ECHO COMPANION', { fontFamily: 'monospace', fontSize: L.rowFont, color: '#33e0ff' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtHelp = add.text(20, L.helpY, 'ESC PAUSE · ANY MOVE / FIRE / F TAKES HUMAN CONTROL', { fontFamily: 'monospace', fontSize: L.helpFont, color: L.helpColor }).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtBossHp = add.text(GAME.WINDOW_W / 2, 30, '', { fontFamily: 'monospace', fontSize: '20px', color: '#ff3355', fontStyle: 'bold' }).setOrigin(0.5, 0.5).setDepth(HUD_DEPTH);
    this.bossBarFill = add.rectangle(GAME.WINDOW_W / 2, 52, 0, 8, 0xff3355, 1).setOrigin(0.5, 0.5).setDepth(HUD_DEPTH);
    this.timer = add.text(20, 104, '', { fontFamily: 'monospace', fontSize: '12px', color: '#5a7480' }).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtStats = add.text(20, GAME.WINDOW_H - 20, '', { fontFamily: 'monospace', fontSize: '12px', color: '#3d535d' }).setOrigin(0, 0).setDepth(HUD_DEPTH);
  }

  private lockHud(): void {
    const z = this.cam.zoom || 1;
    const iz = 1 / z;
    const world = (sx: number, sy: number) => this.cam.getWorldPoint(sx, sy);
    // Graphics bars: their fillRect() draws at fixed local offsets with origin (0,0), so
    // pin the element origin to the rect's top-left in world space.
    const p = world(18, 16);
    this.hpBar.x = p.x; this.hpBar.y = p.y; this.hpBar.scaleX = iz; this.hpBar.scaleY = iz;
    const q = world(18, 38);
    this.xpBar.x = q.x; this.xpBar.y = q.y; this.xpBar.scaleX = iz; this.xpBar.scaleY = iz;
    const rb = world(GAME.WINDOW_W / 2 - 160, 44);
    this.bossBar.x = rb.x; this.bossBar.y = rb.y; this.bossBar.scaleX = iz; this.bossBar.scaleY = iz;
    // Everything else: place the element's origin at its on-screen target via the camera's
    // own transform, so it stays fixed on screen regardless of scroll/zoom.
    const place = (o: { x: number; y: number; scaleX: number; scaleY: number }, tx: number, ty: number) => {
      const w = world(tx, ty);
      o.x = w.x; o.y = w.y; o.scaleX = iz; o.scaleY = iz;
    };
    place(this.hpFill, 20, 24);
    place(this.txtHp, 128, 20);
    place(this.xpFill, 20, 44);
    place(this.txtXp, 128, 40);
    place(this.txtCurrency, 20, 60);
    place(this.txtLevel, 20, 80);
    const L = this.hudLayout;
    place(this.txtWeapon, GAME.WINDOW_W - 20, L.weaponY);
    place(this.txtRoom, GAME.WINDOW_W - 20, L.roomY);
    place(this.txtEnemies, GAME.WINDOW_W - 20, L.enemiesY);
    place(this.txtControl, GAME.WINDOW_W - 20, L.controlY);
    place(this.txtAiAction, GAME.WINDOW_W - 20, L.actionY);
    place(this.txtAiTarget, GAME.WINDOW_W - 20, L.targetY);
    place(this.txtAgentLink, GAME.WINDOW_W - 20, L.linkY);
    place(this.txtEcho, GAME.WINDOW_W - 20, L.echoY);
    place(this.txtHelp, 20, L.helpY);
    place(this.txtBossHp, GAME.WINDOW_W / 2, 30);
    place(this.bossBarFill, GAME.WINDOW_W / 2, 52);
    place(this.timer, 20, 104);
    place(this.txtStats, 20, GAME.WINDOW_H - 20);
    const m = world(GAME.WINDOW_W - 160, GAME.WINDOW_H - 140);
    this.minimap.x = m.x; this.minimap.y = m.y; this.minimap.scaleX = iz; this.minimap.scaleY = iz;
  }

  private setupMinimap(): void {
    this.minimap = this.add.graphics().setDepth(500);
    (this.minimap as any).originX = 0; (this.minimap as any).originY = 0;
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
    // Companion receipt: only AFTER a real core tick consumed the confirmed
    // intent (never early, never while paused with no tick).
    if (this.pendingCompanionReceipt && this.world.sim.tick > this.pendingCompanionReceipt.enqueuedTick) {
      const { suggestionId } = this.pendingCompanionReceipt;
      this.pendingCompanionReceipt = null;
      void this.companionLink?.postApplied(suggestionId, this.world.sim.tick);
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
    this.refreshHud();
    this.refreshMinimap();
    this.refreshBoss();
    this.updateStats();
  }

  private refreshHud(): void {
    const p = this.world.player;
    const w = p.weapon;
    const hpRatio = p.data.hp / p.data.maxHp;
    this.hpBar.clear();
    this.hpBar.fillStyle(0x0d1822, 1);
    // Graphics bars are pinned by lockHud() at their screen-space top-left,
    // so draw from the local origin instead of adding the screen offset twice.
    this.hpBar.fillRect(0, 0, 108, 16);
    this.hpFill.width = 104 * hpRatio;
    this.txtHp.setText(`HP ${Math.ceil(p.data.hp)}/${p.data.maxHp}`);
    const xpRatio = p.data.xp / p.data.xpToNext;
    this.xpBar.clear();
    this.xpBar.fillStyle(0x0d1822, 1);
    this.xpBar.fillRect(0, 0, 108, 10);
    this.xpFill.width = 104 * xpRatio;
    this.txtXp.setText(`XP ${p.data.xp}/${p.data.xpToNext}`);
    this.txtCurrency.setText(`CREDITS ${p.data.currency}`);
    this.txtLevel.setText(`LV ${p.data.level}`);
    const weaponState = p.data.weapons.find(({ key }) => key === p.data.weaponKey);
    const ammo = weaponState && weaponState.magazine > 0
      ? weaponState.reloading ? ' · RELOADING' : ` · ${weaponState.ammo}/${weaponState.magazine}`
      : '';
    this.txtWeapon.setText(`${w.name} [${w.icon}]${ammo}`);
    const room = this.world.currentRoom();
    if (room) this.txtRoom.setText(`${room.kind.toUpperCase()} ROOM`);
    const aliveEnemies = this.world.enemies.length + (this.world.boss ? 1 : 0);
    this.txtEnemies.setText(`HOSTILES ${aliveEnemies}`);
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
    const secs = Math.floor((this.time.now - this.runStart) / 1000);
    this.timer.setText(formatDuration(Math.max(0, secs)));
    const settings = saveSystem.getSettings();
    audio.setVolumes(settings.masterVolume, settings.sfxVolume);
  }

  private refreshMinimap(): void {
    const m = this.minimap;
    m.clear();
    const map = this.world.map;
    const scale = 0.25;
    const ox = GAME.WINDOW_W - 160, oy = GAME.WINDOW_H - 140;
    m.fillStyle(0x0d1822, 0.6);
    m.fillRect(ox - 4, oy - 4, map.width * scale + 8, map.height * scale + 8);
    for (const r of map.rooms) {
      const inRoom = this.world.currentRoom()?.id === r.id;
      m.fillStyle(inRoom ? 0x33e0ff : 0x2a3a44, 1);
      m.fillRect(ox + r.gx * scale, oy + r.gy * scale, Math.max(4, r.w * scale), Math.max(4, r.h * scale));
    }
    const px = ox + this.world.player.x * scale;
    const py = oy + this.world.player.y * scale;
    m.fillStyle(0xff8a3c, 1);
    m.fillRect(px - 2, py - 2, 4, 4);
  }

  private refreshBoss(): void {
    const boss = this.world.boss;
    if (!boss) { this.bossBar.clear(); this.txtBossHp.setText(''); return; }
    const ratio = Math.max(0, boss._hp / boss.maxHp());
    this.bossBar.clear();
    this.bossBar.fillStyle(0x0d1822, 1);
    this.bossBar.fillRect(0, 0, 320, 24);
    this.bossBarFill.width = 316 * ratio;
    this.txtBossHp.setText(`★ THE WARDEN — PHASE ${boss.phase} ★`);
    // Do not overwrite bossBarFill.y: lockHud() already pinned it to screen y=52.
    // The old line wrote raw world coordinate 48 and moved the red fill offscreen.
  }

  private updateStats(): void {
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
    const secs = Math.floor((this.time.now - this.runStart) / 1000);
    this.txtStats.setText(`KILLS ${this.enemiesKilled} · LOOT ${this.itemsCollected} · DMG ${Math.round(this.damageDealt)} · ${secs}s`);
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
    this.refreshHud();
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
      this.refreshHud();
      // Commands queued while the overlay was open (upgrade/loot) commit on the
      // next real frame tick; do not force a tick here. The accumulator is reset
      // so a paused overlay does not bank time, and the queued command is
      // reported as pending until the normal update commits it.
      this.world.resetSimulationAccumulator();
      this.refreshHud();
      if (!this.paused && this.checkpointDirty) this.saveCheckpoint();
      this.cameras.main.setAlpha(1);
    }
  }

  private onRoomEntered(room: RoomInfo): void {
    if (room.kind === 'boss') audio.bossroar();
    else audio.wave();
    const p = this.world.player;
    const s = this.world.worldToScreen(p.x, p.y);
    const t = this.add.text(s.x, s.y - 40, `${room.kind.toUpperCase()} ROOM`, {
      fontFamily: 'monospace', fontSize: '16px', color: '#33e0ff'
    }).setOrigin(0.5, 0.5).setDepth(200);
    this.tweens.add({ targets: t, alpha: 0, duration: 1200, onComplete: () => t.destroy() });
  }

  private onRoomCleared(room: RoomInfo): void {
    this.checkpointDirty = true;
    // The start room is marked cleared on create so a fresh run can be persisted;
    // do not flash a combat banner or play the clear cue for this synthetic event.
    if (room.kind === 'start') return;
    audio.wave();
    const p = this.world.player;
    const s = this.world.worldToScreen(p.x, p.y);
    const t = this.add.text(s.x, s.y - 40, 'ROOM CLEARED', {
      fontFamily: 'monospace', fontSize: '16px', color: '#33e0ff'
    }).setOrigin(0.5, 0.5).setDepth(200);
    this.tweens.add({ targets: t, alpha: 0, duration: 1200, onComplete: () => t.destroy() });
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
    this.scene.start('GameOverScene', { seed: this.seed, stats, won: false });
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
    const t = this.add.text(s.x, s.y - 40, 'THE WARDEN DESTROYED', {
      fontFamily: 'monospace', fontSize: '20px', color: '#ffd233', fontStyle: 'bold'
    }).setOrigin(0.5, 0.5).setDepth(200);
    this.tweens.add({ targets: t, alpha: 0, duration: 1200, onComplete: () => t.destroy() });
    this.time.addEvent({
      delay: 2200,
      repeat: 0,
      callback: () => {
        this.scene.stop('PauseScene');
        this.scene.stop('LevelUpScene');
        this.scene.start('GameOverScene', { seed: this.seed, stats, won: true, coreAwarded });
      }
    });
  }

  private onPause(): void {
    if (this.paused) return;
    // C3-b: pausing cancels pending external intents (they must not fire while
    // the game is frozen) and the epoch is bumped.
    this.externalLink?.degrade('pause');
    this.saveCheckpoint();
    this.paused = true;
    this.world.player.control.pause();
    this.world.player.clearHeldInput();
    this.fireHeld = false;
    this.refreshHud();
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
    this.refreshHud();
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
    this.refreshHud();
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
    this.refreshHud();
  }

  disableEcho(): void {
    this.world.disableEcho();
    this.refreshHud();
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
    this.refreshHud();
  }

  confirmEchoAssist(): void {
    this.world.confirmEchoAssist();
    this.refreshHud();
  }

  revokeEchoAssist(): void {
    this.world.echoController.revokeAssist();
    this.refreshHud();
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
        heartbeatIntervalMs: 1500,
        apply: (kind, target, suggestionId) => {
          const ok = this.world.enqueueCompanionAction(kind, target);
          if (ok && suggestionId) this.pendingCompanionReceipt = { suggestionId, enqueuedTick: this.world.sim.tick };
          return ok;
        },
        appliedTick: () => this.world.sim.tick
      });
      return await this.companionLink.authorize();
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
    this.refreshHud();
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
    this.refreshHud();
    this.world.resetSimulationAccumulator();
    this.scene.launch('PauseScene', { mode: 'inventory' });
  }
}
