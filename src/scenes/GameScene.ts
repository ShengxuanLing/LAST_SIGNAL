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
import { CSS, DEPTH, FONT, INK, TIME } from '../art/survey/tokens';

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

  // HUD elements (AR-02: one per-frame Graphics + texts, Direction A field-manual style)
  private hud!: Phaser.GameObjects.Graphics;
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
  private txtEnemies!: Phaser.GameObjects.Text;
  private txtBossHp!: Phaser.GameObjects.Text;
  private bossBarFill!: Phaser.GameObjects.Rectangle;
  private txtMap!: Phaser.GameObjects.Text;
  private txtStats!: Phaser.GameObjects.Text;
  private timer!: Phaser.GameObjects.Text;
  private txtVitals!: Phaser.GameObjects.Text;

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
    // AR-02 Direction A "field survey manual" (A4): hairline frames + corner ticks,
    // monospace numerals, segmented vitals. Priority: vitals (top-left) > hostiles /
    // weapon (top-right) > survey map (bottom-right) > run stats (bottom-left).
    // The 480x320 combat core stays clear (03 §4).
    const HUD_DEPTH = DEPTH.hud;
    const add = this.add;
    const mono = (size: number, color: string, bold = false) =>
      ({ fontFamily: FONT.mono, fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal' });
    // One Graphics for every HUD shape; pinned at screen (0,0) by lockHud.
    this.hud = add.graphics().setDepth(HUD_DEPTH);
    (this.hud as any).originX = 0; (this.hud as any).originY = 0;
    this.hpShown = -1; this.previousHp = -1; this.hpLossFlash = 0;

    this.txtVitals = add.text(20, 14, 'EX-17 · VITALS', mono(10, CSS.knownLow)).setLetterSpacing(2).setDepth(HUD_DEPTH);
    this.txtHp = add.text(230, 25, '100 / 100', mono(15, CSS.known, true)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtXp = add.text(230, 44, 'XP 0/30', mono(11, CSS.knownMid)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtCurrency = add.text(20, 58, 'CREDITS 0', mono(12, CSS.known)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtLevel = add.text(20, 76, 'LV 1', mono(12, CSS.known, true)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.timer = add.text(20, 98, '', mono(11, CSS.knownMid)).setOrigin(0, 0).setDepth(HUD_DEPTH);
    this.txtWeapon = add.text(GAME.WINDOW_W - 20, 16, '', mono(14, CSS.known, true)).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtRoom = add.text(GAME.WINDOW_W - 20, 38, '', mono(11, CSS.knownMid)).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtEnemies = add.text(GAME.WINDOW_W - 20, 56, '', mono(12, CSS.known, true)).setOrigin(1, 0).setDepth(HUD_DEPTH);
    this.txtBossHp = add.text(GAME.WINDOW_W / 2, 30, '', mono(16, CSS.known, true)).setOrigin(0.5, 0.5).setDepth(HUD_DEPTH);
    // Boss fill: left edge pinned (displayOrigin set in refreshBoss) so it drains to the
    // right and stays inside its frame (audit 7.9: fill used to start at the centre).
    this.bossBarFill = add.rectangle(GAME.WINDOW_W / 2, 52, 0, 8, INK.hostile, 1).setOrigin(0.5, 0.5).setDepth(HUD_DEPTH);
    this.txtMap = add.text(GAME.WINDOW_W - 20, GAME.WINDOW_H - 132, '', mono(10, CSS.knownMid)).setOrigin(1, 0).setLetterSpacing(1).setDepth(HUD_DEPTH);
    this.txtStats = add.text(20, GAME.WINDOW_H - 22, '', mono(11, CSS.knownLow)).setOrigin(0, 0).setDepth(HUD_DEPTH);
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
    place(this.txtVitals, 20, 14);
    place(this.txtHp, 230, 25);
    place(this.txtXp, 230, 44);
    place(this.txtCurrency, 20, 58);
    place(this.txtLevel, 20, 76);
    place(this.txtWeapon, GAME.WINDOW_W - 20, 16);
    place(this.txtRoom, GAME.WINDOW_W - 20, 38);
    place(this.txtEnemies, GAME.WINDOW_W - 20, 56);
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

    this.refreshHud(dt);
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

    // ---- weapon / room / hostiles (top-right)
    g.fillStyle(INK.panel, 0.55); g.fillRect(1000, 8, 268, 84);
    this.ticks(1000, 8, 1268, 92);
    const weaponState = p.data.weapons.find(({ key }) => key === p.data.weaponKey);
    const ammo = weaponState && weaponState.magazine > 0
      ? weaponState.reloading ? ' · RELOADING' : ` · ${weaponState.ammo}/${weaponState.magazine}`
      : ' · ∞';
    this.txtWeapon.setText(`${w.name} [${w.icon}]${ammo}`);
    const room = this.world.currentRoom();
    const total = this.world.map.rooms.length;
    if (room) this.txtRoom.setText(`R-${String(room.id).padStart(2, '0')} · ${room.kind.toUpperCase()} · SURVEYED ${this.world.surveyedRooms()}/${total}`);
    const aliveEnemies = this.world.enemies.length + (this.world.boss ? 1 : 0);
    this.txtEnemies.setText(`HOSTILES ${aliveEnemies}`);
    // one hollow pip per hostile (shape-coded, not colour-coded)
    for (let i = 0; i < Math.min(aliveEnemies, 16); i++) {
      const x = 1258 - i * 10, y = 80;
      g.lineStyle(1.2, INK.known, 0.8);
      g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 4, y); g.lineTo(x, y + 4); g.lineTo(x - 4, y); g.closePath(); g.strokePath();
    }

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
    this.txtBossHp.setText(`THE WARDEN · PHASE ${boss.phase} / 3`);
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
    const labelY = Math.max(40, p.sprite.displayOriginY * p.sprite.scaleY + 14);
    const t = this.add.text(s.x, s.y - labelY, 'THE WARDEN DESTROYED', {
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
