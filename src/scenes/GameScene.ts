import Phaser from 'phaser';
import { GAME } from '../config/game';
import { MapGenerator, assignRoles, guaranteeReachable, roomDepth } from '../world/MapGenerator';
import { World, WorldCallbacks, RoomInfo } from '../world/World';
import { WEAPONS } from '../config/weapons';
import { UPGRADES } from '../config/upgrades';
import { saveSystem, game } from '../main';
import { audio } from '../systems/AudioSystem';
import { formatDuration } from '../core/formatDuration';
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
    if (!checkpoint) this.world.updateRoom();
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
      if (this.paused) return;
      this.saveCheckpoint();
      this.world.tryInteract(this.world.player);
    });
    this.input.keyboard!.on('keydown-Q', () => this.switchWeapon(-1));
    this.input.keyboard!.on('keydown-E', () => this.switchWeapon(1));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (p.button === 0) this.fireHeld = true; });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => { if (p.button === 0) this.fireHeld = false; });

    this.setupHud();
    this.setupMinimap();
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
    this.txtWeapon = add.text(GAME.WINDOW_W - 20, 20, '', { fontFamily: 'monospace', fontSize: '16px', color: '#ff8a3c' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtRoom = add.text(GAME.WINDOW_W - 20, 44, '', { fontFamily: 'monospace', fontSize: '13px', color: '#8fb8c8' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtEnemies = add.text(GAME.WINDOW_W - 20, 64, '', { fontFamily: 'monospace', fontSize: '13px', color: '#8fb8c8' }).setOrigin(1, 0).setDepth(HUD_DEPTH);
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
    place(this.txtWeapon, GAME.WINDOW_W - 20, 20);
    place(this.txtRoom, GAME.WINDOW_W - 20, 44);
    place(this.txtEnemies, GAME.WINDOW_W - 20, 64);
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
    const dt = Math.max(0, delta) / 1000;
    this.world.update(dt);
    if (!this.paused && this.checkpointDirty) this.saveCheckpoint();

    // aim from last pointer
    const ptr = this.input.activePointer;
    this.world.player.aimFromPointer(ptr);
    this.world.player.setFireHeld(this.fireHeld);

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

  saveCheckpoint(): boolean {
    if (this.runFinished) return false;
    const checkpoint = this.world.captureCheckpoint(this.runId, this.seed, this.runStats());
    if (!checkpoint) return false;
    this.checkpointDirty = false;
    return saveSystem.writeCheckpoint(checkpoint, this.runId);
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
    audio.levelup();
    this.paused = true;
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
    this.pendingLevels = [];
    this.levelUpActive = false;
    audio.death();
    const stats = this.runStats();
    saveSystem.finishRun(this.runId, false, this.seed, stats);
    this.scene.stop('LevelUpScene');
    this.scene.start('GameOverScene', { seed: this.seed, stats, won: false });
  }

  private onBossWin(): void {
    if (this.runFinished) return;
    this.runFinished = true;
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
    this.saveCheckpoint();
    this.paused = true;
    this.scene.launch('PauseScene', { mode: 'pause' });
  }

  onResume(): void { this.paused = false; }

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
    this.paused = true;
    this.scene.launch('PauseScene', { mode: 'inventory' });
  }
}
