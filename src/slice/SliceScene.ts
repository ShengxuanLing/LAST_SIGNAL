import Phaser from 'phaser';
import { GraphicsFactory } from '../core/GraphicsFactory';
import { isoToScreen } from '../core/iso';
import { GAME } from '../config/game';
import { ROOM, isStaticWallCell, isWalkableCell } from './room';
import { SliceModel, SLICE, type DoorState, type PersistedSliceState } from './rules';
import { clearSlice, loadSlice, saveSlice } from './storage';

const DOOR_LABEL: Record<DoorState, string> = {
  SEALED: '封锁中（不可通行）',
  JAMMED_OPEN: '已被压制：可通行',
  OPEN: '已打开',
  CLOSED: '已关闭',
  SAFE_PENDING_CLOSE: '占位保护：待安全关闭',
};

const DOOR_COLOR: Record<DoorState, number> = {
  SEALED: 0xff3355,
  JAMMED_OPEN: 0x33e0ff,
  OPEN: 0x33e0ff,
  CLOSED: 0x5a7480,
  SAFE_PENDING_CLOSE: 0xff8a3c,
};

interface HudEls {
  energy: HTMLElement;
  door: HTMLElement;
  feedback: HTMLElement;
  scan: HTMLElement;
  position: HTMLElement;
  complete: HTMLElement;
}

type KeyHandler = { event: string; fn: (e: KeyboardEvent) => void };

export class SliceScene extends Phaser.Scene {
  private model!: SliceModel;
  private playerSprite!: Phaser.GameObjects.Image;
  private doorGfx!: Phaser.GameObjects.Graphics;
  private markerGfx!: Phaser.GameObjects.Graphics;
  private keys!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private els!: HudEls;
  private kb: Phaser.Input.Keyboard.KeyboardPlugin | null = null;
  private keyHandlers: KeyHandler[] = [];
  private listeners = new AbortController();
  private offX = 0;
  private offY = 0;
  private px: number = ROOM.spawn.x;
  private py: number = ROOM.spawn.y;
  private notice = '';
  private storageWarning = '';

  constructor() {
    super('SliceScene');
  }

  create(): void {
    this.listeners = new AbortController();
    this.keyHandlers = [];
    if (!this.textures.exists('player') || !this.textures.exists('bg')) GraphicsFactory.create(this);
    this.add.image(GAME.WINDOW_W / 2, GAME.WINDOW_H / 2, 'bg').setDepth(-100);

    this.computeOffsets();
    this.drawStaticMap();

    this.doorGfx = this.add.graphics().setDepth(50);
    this.markerGfx = this.add.graphics().setDepth(60);

    const loaded = loadSlice();
    this.model = new SliceModel(loaded.state as PersistedSliceState | null);
    if (loaded.status === 'rejected') {
      this.notice = '存档不兼容：已保留原档并以新局开始。';
      this.storageWarning = '未保存：原档不兼容，写入已锁定；点“重开”可清除本原型存档。';
    } else if (loaded.status === 'unavailable') {
      this.notice = '浏览器存储不可用：本局可玩，但无法保存。';
      this.storageWarning = '未保存：浏览器存储不可用。';
    }
    // Use the model's restored position (save position is authoritative). Never
    // overwrite it with spawn; spawn is only the model default when no save exists.
    const restored = this.model.position;
    this.px = restored.x;
    this.py = restored.y;
    this.model.setPlayerPos(this.px, this.py);

    this.playerSprite = this.add.image(0, 0, 'player').setDepth(500);

    const kb = this.input.keyboard;
    this.kb = kb;
    if (kb) {
      this.keys = kb.addKeys('W,A,S,D') as unknown as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
      this.bindKey('keydown-Z', () => this.doScan());
      this.bindKey('keydown-X', () => this.doJam());
      this.bindKey('keydown-F', () => this.doInteract());
      this.bindKey('keydown-ESC', () => this.doTogglePause());
    }

    this.els = {
      energy: document.querySelector<HTMLElement>('[data-testid="vs00-energy"]')!,
      door: document.querySelector<HTMLElement>('[data-testid="vs00-door-state"]')!,
      feedback: document.querySelector<HTMLElement>('[data-testid="vs00-feedback"]')!,
      scan: document.querySelector<HTMLElement>('[data-testid="vs00-scan-details"]')!,
      position: document.querySelector<HTMLElement>('[data-testid="vs00-player-position"]')!,
      complete: document.querySelector<HTMLElement>('[data-testid="vs00-complete"]')!,
    };
    this.bindButtons();

    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
    document.body.dataset.vs00Ready = '1';
    this.refreshHud();
  }

  update(_time: number, delta: number): void {
    if (!this.model.paused) {
      this.model.step(delta, () => this.stepMovement());
      if (!this.model.passed && this.px > ROOM.eastThresholdX) {
        this.model.markPassed();
        const saved = saveSlice(this.model.serialize());
        this.notice = saved ? '已通过门：原型完成（已保存）。' : '已通过门：原型完成（未保存）。';
        if (!saved) this.storageWarning = '未保存：本原型存档不可写（坏档/存储不可用）。';
      }
    }
    this.renderEntities();
    this.refreshHud();
  }

  // ---------- input / actions (buttons and keys share these entry points) ----------

  private bindKey(event: string, fn: () => void): void {
    if (!this.kb) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.repeat) return; // OS key auto-repeat must not keep consuming resources
      fn();
    };
    this.kb.on(event, handler);
    this.keyHandlers.push({ event, fn: handler });
  }

  private doScan(): void {
    this.notice = '';
    this.model.scan();
    this.refreshHud();
  }

  private doJam(): void {
    this.notice = '';
    this.model.jam();
    this.refreshHud();
  }

  private doInteract(): void {
    this.notice = '';
    this.model.interact();
    this.refreshHud();
  }

  private doTogglePause(): void {
    this.model.setPaused(!this.model.paused);
    this.notice = '';
    this.refreshHud();
  }

  private doRestart(): void {
    const cleared = clearSlice();
    this.model.reset();
    const resetPos = this.model.position;
    this.px = resetPos.x;
    this.py = resetPos.y;
    this.model.setPlayerPos(this.px, this.py);
    if (cleared) {
      this.storageWarning = '';
      this.notice = '已重开并清除本原型存档。';
    } else {
      this.storageWarning = '未清除：本原型存档不可写（保留原档）。';
      this.notice = '已重开：内存已重置，但未能清除存档。';
    }
    this.refreshHud();
  }

  private doSave(): void {
    if (saveSlice(this.model.serialize())) {
      this.storageWarning = '';
      this.notice = '已保存本原型进度。';
    } else {
      this.storageWarning = '未保存：本原型存档不可写（坏档/存储不可用）。';
      this.notice = '保存失败。';
    }
    this.refreshHud();
  }

  private bindButtons(): void {
    const bind = (id: string, fn: () => void): void => {
      const el = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
      if (el) el.addEventListener('click', fn, { signal: this.listeners.signal });
    };
    bind('vs00-btn-scan', () => this.doScan());
    bind('vs00-btn-jam', () => this.doJam());
    bind('vs00-btn-interact', () => this.doInteract());
    bind('vs00-btn-pause', () => this.doTogglePause());
    bind('vs00-btn-restart', () => this.doRestart());
    bind('vs00-btn-save', () => this.doSave());
  }

  private onWindowBlur = (): void => {
    this.model.setPaused(true);
    this.notice = '已自动暂停（窗口失焦）。';
    this.refreshHud();
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) this.onWindowBlur();
  };

  private teardown(): void {
    this.listeners.abort();
    if (this.kb) {
      for (const { event, fn } of this.keyHandlers) this.kb.off(event, fn);
    }
    this.keyHandlers = [];
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    delete document.body.dataset.vs00Ready;
  }

  // ---------- fixed-tick movement + collision ----------

  /** Called at the start of each logic tick (fixed dt, current door passability). */
  private stepMovement(): void {
    if (!this.keys) return;
    const dir = { x: 0, y: 0 };
    if (this.keys.W.isDown) { dir.x -= 1; dir.y -= 1; }
    if (this.keys.S.isDown) { dir.x += 1; dir.y += 1; }
    if (this.keys.A.isDown) { dir.x -= 1; dir.y += 1; }
    if (this.keys.D.isDown) { dir.x += 1; dir.y -= 1; }
    const len = Math.hypot(dir.x, dir.y);
    if (len > 0) {
      const step = SLICE.MOVE_SPEED * (SLICE.TICK_MS / 1000);
      this.tryMove((dir.x / len) * step, (dir.y / len) * step);
    }
    this.model.setPlayerPos(this.px, this.py);
  }

  private tryMove(dx: number, dy: number): void {
    const nextX = this.px + dx;
    if (this.canStand(nextX, this.py)) this.px = nextX;
    const nextY = this.py + dy;
    if (this.canStand(this.px, nextY)) this.py = nextY;
  }

  private canStand(x: number, y: number): boolean {
    const r = ROOM.playerRadius;
    const samples: Array<[number, number]> = [
      [x, y],
      [x - r, y - r],
      [x + r, y - r],
      [x - r, y + r],
      [x + r, y + r],
    ];
    for (const [sx, sy] of samples) {
      if (!isWalkableCell(Math.floor(sx), Math.floor(sy), this.model.doorPassable)) return false;
    }
    return true;
  }

  // ---------- rendering ----------

  private computeOffsets(): void {
    const pts = [
      isoToScreen(0, 0),
      isoToScreen(ROOM.width, 0),
      isoToScreen(0, ROOM.height),
      isoToScreen(ROOM.width, ROOM.height),
    ];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    this.offX = GAME.WINDOW_W / 2 - (Math.min(...xs) + Math.max(...xs)) / 2;
    this.offY = GAME.WINDOW_H / 2 - (Math.min(...ys) + Math.max(...ys)) / 2 + 26;
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    const p = isoToScreen(x, y);
    return { x: p.x + this.offX, y: p.y + this.offY };
  }

  private diamondPath(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    g.beginPath();
    g.moveTo(x, y - 16);
    g.lineTo(x + 32, y);
    g.lineTo(x, y + 16);
    g.lineTo(x - 32, y);
    g.closePath();
  }

  private fillDiamond(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, alpha: number): void {
    this.diamondPath(g, x, y);
    g.fillStyle(color, alpha);
    g.fillPath();
  }

  private strokeDiamond(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    this.diamondPath(g, x, y);
    g.strokePath();
  }

  private drawStaticMap(): void {
    const floors = this.add.graphics().setDepth(0);
    const walls = this.add.graphics().setDepth(10);
    for (let y = 0; y < ROOM.height; y++) {
      for (let x = 0; x < ROOM.width; x++) {
        if (isStaticWallCell(x, y)) continue;
        const s = this.toScreen(x + 0.5, y + 0.5);
        this.fillDiamond(floors, s.x, s.y, 0x0e1620, 1);
        floors.lineStyle(1, 0x33e0ff, 0.08);
        this.strokeDiamond(floors, s.x, s.y);
      }
    }
    for (let y = 0; y < ROOM.height; y++) {
      for (let x = 0; x < ROOM.width; x++) {
        if (!isStaticWallCell(x, y)) continue;
        const s = this.toScreen(x + 0.5, y + 0.5);
        this.fillDiamond(walls, s.x, s.y, 0x0a1016, 1);
        this.fillDiamond(walls, s.x, s.y - 7, 0x16202b, 1);
        walls.lineStyle(1, 0x33e0ff, 0.14);
        this.strokeDiamond(walls, s.x, s.y - 7);
      }
    }
  }

  private renderEntities(): void {
    const p = this.toScreen(this.px, this.py);
    this.playerSprite.setPosition(p.x, p.y);
    this.playerSprite.setDepth(500 + this.px + this.py);

    this.doorGfx.clear();
    const color = DOOR_COLOR[this.model.doorState];
    for (const c of ROOM.doorCells) {
      const s = this.toScreen(c.x + 0.5, c.y + 0.5);
      this.fillDiamond(this.doorGfx, s.x, s.y, color, 0.85);
      this.doorGfx.lineStyle(2, 0x05070c, 0.8);
      this.strokeDiamond(this.doorGfx, s.x, s.y);
    }

    this.markerGfx.clear();
    const reveal = this.model.snapshot().reveal;
    if (reveal) {
      const src = this.toScreen(ROOM.source.x, ROOM.source.y);
      const rec = this.toScreen(ROOM.receiver.x, ROOM.receiver.y);
      if (reveal.link) {
        this.markerGfx.lineStyle(2, 0xffd233, 0.55);
        this.markerGfx.lineBetween(src.x, src.y, rec.x, rec.y);
      }
      if (reveal.sealSource) {
        this.markerGfx.fillStyle(0xff8a3c, 0.9);
        this.markerGfx.fillCircle(src.x, src.y, 5);
      }
      if (reveal.doorReceiver) {
        this.markerGfx.lineStyle(2, 0x33e0ff, 0.9);
        this.markerGfx.strokeCircle(rec.x, rec.y, 7);
      }
    }
  }

  private refreshHud(): void {
    if (!this.els) return;
    const s = this.model.snapshot();
    this.els.energy.textContent = `${s.energy} / ${SLICE.ENERGY_MAX}`;
    this.els.energy.dataset.energy = String(s.energy);
    this.els.door.textContent = DOOR_LABEL[s.doorState];
    this.els.door.dataset.state = s.doorState;

    const parts = [this.notice, this.storageWarning].filter(Boolean);
    const base = parts.length ? parts.join(' · ') : this.model.lastResult.message;
    this.els.feedback.textContent = s.paused ? `【已暂停】${base}` : base;
    this.els.feedback.dataset.code = this.model.lastResult.code;
    this.els.feedback.dataset.cost = String(this.model.lastResult.cost);

    this.els.position.textContent = `${this.px.toFixed(1)}, ${this.py.toFixed(1)}`;
    this.els.position.dataset.x = this.px.toFixed(1);
    this.els.position.dataset.y = this.py.toFixed(1);

    const reveal = s.reveal;
    if (!reveal) {
      this.els.scan.textContent = '未扫描。按 Z 或点“扫描”。';
    } else if (!reveal.doorReceiver && !reveal.sealSource) {
      this.els.scan.textContent = '扫描：范围内未发现可操作目标（空扫仍消耗 10）。';
    } else {
      const bits: string[] = [];
      if (reveal.doorReceiver) bits.push('门接收器（存在）');
      if (reveal.sealSource) bits.push('封锁载波（存在）');
      if (reveal.link) bits.push('连接：源 → 门接收器');
      this.els.scan.textContent = `扫描：${bits.join(' · ')}`;
    }
    this.els.scan.dataset.revealed = reveal ? '1' : '0';
    this.els.scan.dataset.doorReceiver = reveal?.doorReceiver ? '1' : '0';
    this.els.scan.dataset.sealSource = reveal?.sealSource ? '1' : '0';
    this.els.scan.dataset.link = reveal?.link ? '1' : '0';

    this.els.complete.textContent = s.passed ? '已通过门：原型完成 ✓' : '尚未通过门';
    this.els.complete.dataset.complete = s.passed ? '1' : '0';
  }
}
