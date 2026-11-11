import Phaser from 'phaser';
import { GraphicsFactory } from '../core/GraphicsFactory';
import { isoToScreen } from '../core/iso';
import { GAME } from '../config/game';
import { ROOM, isStaticWallCell } from './room';
import { SliceModel, SLICE, type DoorState, type SliceSnapshot } from './rules';
import { CORRIDOR_LINKS, type BridgeState } from './corridor';
import { CORRIDOR, corridorTile, isBridgeCell } from './corridorRoom';
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

const BRIDGE_LABEL: Record<BridgeState, string> = {
  UNAVAILABLE: '桥梁断开 · 不可通行',
  TRANSITIONING: '建立中 · 暂不可通行',
  STABLE: '桥梁稳定 · 可以通行',
  UNSTABLE: '⚠ 失稳预警 · 立即撤离',
  DISABLED: '桥梁已停用',
};

function setText(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

export class SliceScene extends Phaser.Scene {
  private model!: SliceModel;
  private playerSprite!: Phaser.GameObjects.Image;
  private doorGfx!: Phaser.GameObjects.Graphics;
  private markerGfx!: Phaser.GameObjects.Graphics;
  private floors!: Phaser.GameObjects.Graphics;
  private walls!: Phaser.GameObjects.Graphics;
  private guardSprite!: Phaser.GameObjects.Image;
  private keys!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private els!: HudEls;
  private kb: Phaser.Input.Keyboard.KeyboardPlugin | null = null;
  private keyHandlers: KeyHandler[] = [];
  private listeners = new AbortController();
  private offX = 0;
  private offY = 0;
  private roomScale = 1;
  private px: number = ROOM.spawn.x;
  private py: number = ROOM.spawn.y;
  private notice = '';
  private storageWarning = '';
  private labReadout!: HTMLElement;
  private corridorReadout!: HTMLElement;
  private bridgeReadout!: HTMLElement;
  private relayReadout!: HTMLElement;
  private healthReadout!: HTMLElement;
  private hint!: HTMLElement;
  private interactButton!: HTMLElement;

  constructor() {
    super('SliceScene');
  }

  create(): void {
    this.listeners = new AbortController();
    this.keyHandlers = [];
    if (!this.textures.exists('player') || !this.textures.exists('bg')) GraphicsFactory.create(this);
    this.add.image(GAME.WINDOW_W / 2, GAME.WINDOW_H / 2, 'bg').setDepth(-100);

    this.floors = this.add.graphics().setDepth(0);
    this.walls = this.add.graphics().setDepth(10);
    this.doorGfx = this.add.graphics().setDepth(50);
    this.markerGfx = this.add.graphics().setDepth(60);
    this.guardSprite = this.add.image(0, 0, 'enemy_drone').setDepth(200).setVisible(false);
    this.guardSprite.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.doShoot());

    const loaded = loadSlice();
    this.model = new SliceModel(loaded.state);
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
    this.drawRoom();

    const kb = this.input.keyboard;
    this.kb = kb;
    if (kb) {
      this.keys = kb.addKeys('W,A,S,D') as unknown as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
      this.bindKey('keydown-Z', () => this.doScan());
      this.bindKey('keydown-X', () => this.doJam());
      this.bindKey('keydown-F', () => this.doInteract());
      this.bindKey('keydown-J', () => this.doShoot());
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
    this.labReadout = document.querySelector<HTMLElement>('#lab-readout')!;
    this.corridorReadout = document.querySelector<HTMLElement>('#corridor-readout')!;
    this.bridgeReadout = document.querySelector<HTMLElement>('[data-testid="vs01-bridge-state"]')!;
    this.relayReadout = document.querySelector<HTMLElement>('[data-testid="vs01-relay-state"]')!;
    this.healthReadout = document.querySelector<HTMLElement>('[data-testid="vs01-health"]')!;
    this.hint = document.querySelector<HTMLElement>('#slice-hint')!;
    this.interactButton = document.querySelector<HTMLElement>('[data-testid="vs00-btn-interact"]')!;
    this.bindButtons();

    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
    document.body.dataset.vs00Ready = '1';
    this.refreshHud();
  }

  update(_time: number, delta: number): void {
    if (!this.model.paused && !this.model.failed) {
      const previous = this.model.snapshot();
      const lastResult = this.model.lastResult;
      this.model.step(delta, () => this.stepMovement());
      if (this.model.lastResult !== lastResult) this.notice = '';
      this.syncPosition();
      if (!this.model.inCorridor && !this.model.passed && this.px > ROOM.eastThresholdX) {
        this.model.markPassed();
        const saved = saveSlice(this.model.serialize());
        this.notice = saved ? '已通过门：原型完成（已保存）。' : '已通过门：原型完成（未保存）。';
        if (!saved) this.storageWarning = '未保存：本原型存档不可写（坏档/存储不可用）。';
      }
      if (!this.model.inCorridor && this.model.passed &&
          Math.hypot(this.px - ROOM.exit.x, this.py - ROOM.exit.y) < 0.45) {
        // Save the safe laboratory exit before introducing the live corridor guard.
        if (!saveSlice(this.model.serialize())) this.storageWarning = '未保存实验室出口进度。';
        if (this.model.enterCorridor()) {
          this.notice = '';
          this.syncPosition();
          this.drawRoom();
        }
      } else if (this.model.failed) {
        if (!clearSlice(true)) this.storageWarning = '未清除原存档。';
      } else if (!previous.corridor?.crossed) {
        const corridor = this.model.snapshot().corridor;
        if (corridor?.crossed) {
          if (this.model.canCheckpoint) this.doSave();
          else this.notice = corridor.guardHp > 0
            ? '已抵达东岸。守卫仍在场，本次未保存；刷新将回到最近检查点。'
            : '已抵达东岸。请在安全岸边保存进度。';
        }
      }
    }
    this.renderEntities();
    this.refreshHud();
  }

  // ---------- input / actions (buttons and keys share these entry points) ----------

  private bindKey(event: string, fn: () => void): void {
    if (!this.kb) return;
    const handled = new WeakSet<KeyboardEvent>();
    const handler = (e: KeyboardEvent): void => {
      // Phaser can replay queued DOM events when several inputs arrive in one frame.
      if (e.repeat || handled.has(e)) return;
      handled.add(e);
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

  private doShoot(): void {
    if (!this.model.inCorridor) return;
    this.notice = '';
    this.model.shootGuard();
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
    this.syncPosition();
    this.drawRoom();
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
    if (!this.model.canCheckpoint) {
      this.notice = '请先清除守卫，并在桥梁无危险转换时站上岸边保存。';
      this.refreshHud();
      return;
    }
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
    this.model.dispose();
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
    this.syncPosition();
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
    if (this.model.canStand(nextX, this.py)) this.px = nextX;
    const nextY = this.py + dy;
    if (this.model.canStand(this.px, nextY)) this.py = nextY;
  }

  private syncPosition(): void {
    const { x, y } = this.model.position;
    this.px = x;
    this.py = y;
  }

  // ---------- rendering ----------

  private computeOffsets(): void {
    const { width, height } = this.model.inCorridor ? CORRIDOR : ROOM;
    this.roomScale = this.model.inCorridor ? 0.82 : 1;
    const pts = [
      isoToScreen(0, 0),
      isoToScreen(width, 0),
      isoToScreen(0, height),
      isoToScreen(width, height),
    ];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    this.offX = GAME.WINDOW_W / 2 - (Math.min(...xs) + Math.max(...xs)) * this.roomScale / 2;
    this.offY = GAME.WINDOW_H / 2 - (Math.min(...ys) + Math.max(...ys)) * this.roomScale / 2 + 26;
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    const p = isoToScreen(x, y);
    return { x: p.x * this.roomScale + this.offX, y: p.y * this.roomScale + this.offY };
  }

  private diamondPath(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    g.beginPath();
    const h = 16 * this.roomScale;
    g.moveTo(x, y - h);
    g.lineTo(x + 2 * h, y);
    g.lineTo(x, y + h);
    g.lineTo(x - 2 * h, y);
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

  private drawRoom(): void {
    this.computeOffsets();
    this.playerSprite.setScale(this.roomScale);
    const guard = this.toScreen(CORRIDOR.guard.x, CORRIDOR.guard.y);
    this.guardSprite.setPosition(guard.x, guard.y).setScale(this.roomScale * 1.25).setTint(0xff8a3c);
    const { floors, walls } = this;
    floors.clear();
    walls.clear();
    const { width, height } = this.model.inCorridor ? CORRIDOR : ROOM;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = this.model.inCorridor ? corridorTile(x, y) : isStaticWallCell(x, y) ? 'wall' : 'floor';
        const s = this.toScreen(x + 0.5, y + 0.5);
        if (tile === 'wall') {
          this.fillDiamond(walls, s.x, s.y, 0x0a1016, 1);
          this.fillDiamond(walls, s.x, s.y - 7, 0x16202b, 1);
          walls.lineStyle(1, 0x33e0ff, 0.14);
          this.strokeDiamond(walls, s.x, s.y - 7);
        } else {
          this.fillDiamond(floors, s.x, s.y, tile === 'chasm' ? 0x05070c : 0x0e1620, 1);
          floors.lineStyle(1, tile === 'chasm' ? 0xff3355 : 0x33e0ff, 0.08);
          this.strokeDiamond(floors, s.x, s.y);
        }
      }
    }
  }

  private renderEntities(): void {
    const p = this.toScreen(this.px, this.py);
    this.playerSprite.setPosition(p.x, p.y);
    this.playerSprite.setDepth(500 + this.px + this.py);

    this.doorGfx.clear();
    this.markerGfx.clear();
    const snapshot = this.model.snapshot();
    this.guardSprite.setVisible((snapshot.corridor?.guardHp ?? 0) > 0);
    if (snapshot.corridor) {
      this.renderCorridor(snapshot);
      return;
    }
    const color = DOOR_COLOR[this.model.doorState];
    for (const c of ROOM.doorCells) {
      const s = this.toScreen(c.x + 0.5, c.y + 0.5);
      this.fillDiamond(this.doorGfx, s.x, s.y, color, 0.85);
      this.doorGfx.lineStyle(2, 0x05070c, 0.8);
      this.strokeDiamond(this.doorGfx, s.x, s.y);
    }

    const exit = this.toScreen(ROOM.exit.x, ROOM.exit.y);
    this.markerGfx.lineStyle(2, 0x33e0ff, 0.75);
    this.strokeDiamond(this.markerGfx, exit.x, exit.y);
    const reveal = snapshot.reveal;
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

  private renderCorridor(snapshot: SliceSnapshot): void {
    const c = snapshot.corridor!;
    const g = this.markerGfx;
    const { left, right, top, bottom } = CORRIDOR.bridge;
    if (c.bridgePassable || c.bridge === 'TRANSITIONING') {
      const color = c.bridge === 'STABLE' ? 0x33e0ff : 0xff8a3c;
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          if (!isBridgeCell(x, y)) continue;
          const s = this.toScreen(x + 0.5, y + 0.5);
          if (c.bridgePassable) this.fillDiamond(this.doorGfx, s.x, s.y, color, 0.42);
          this.doorGfx.lineStyle(c.bridge === 'UNSTABLE' ? 3 : 1, color, 0.9);
          this.strokeDiamond(this.doorGfx, s.x, s.y);
          if (c.bridge === 'UNSTABLE') this.doorGfx.lineBetween(s.x - 7, s.y + 4, s.x + 7, s.y - 4);
        }
      }
    }
    for (const shore of Object.values(CORRIDOR.shores)) {
      const p = this.toScreen(shore.x, shore.y);
      g.lineStyle(2, 0x33e0ff, 0.65);
      this.strokeDiamond(g, p.x, p.y);
    }
    const relay = this.toScreen(CORRIDOR.relay.x, CORRIDOR.relay.y);
    const far = this.toScreen(CORRIDOR.farControl.x, CORRIDOR.farControl.y);
    const outputColor = c.effectiveOutput ? 0x33e0ff : 0xff8a3c;
    g.fillStyle(0x10232c, 1);
    g.fillRect(relay.x - 9, relay.y - 19, 18, 19);
    g.fillRect(far.x - 7, far.y - 15, 14, 15);
    g.lineStyle(2, outputColor, 1);
    g.strokeRect(relay.x - 9, relay.y - 19, 18, 19);
    g.strokeRect(far.x - 7, far.y - 15, 14, 15);

    const reveal = snapshot.corridorReveal;
    if (!reveal?.relay) return;
    g.lineStyle(2, outputColor, 0.9);
    for (const [index, revealed] of [reveal.bridge, reveal.perceptionPort].entries()) {
      if (!revealed) continue;
      const target = CORRIDOR_LINKS[index].target;
      const p = this.toScreen(target.x, target.y);
      g.lineBetween(relay.x, relay.y - 12, p.x, p.y);
      g.strokeCircle(p.x, p.y, 6);
    }
  }

  private refreshCorridorHud(snapshot: SliceSnapshot): void {
    const c = snapshot.corridor;
    this.labReadout.hidden = !!c;
    this.corridorReadout.hidden = !c;
    const interact = c ? '切换中继器' : '开门尝试';
    setText(this.interactButton, interact);
    setText(this.hint, c
      ? 'Z 扫描 · X 压制中继器 · F 操作控制器 · J 或点击守卫开火'
      : '目标：穿过实验室的封锁门，走到东侧青色出口。能量不足时可等待恢复。');
    if (!c) return;

    const seconds = (ticks: number): string => (Math.ceil(ticks / 6) / 10).toFixed(1);
    const bridgeTime = c.bridgeRemainingTicks > 0 ? ` · ${seconds(c.bridgeRemainingTicks)} 秒` : '';
    const shore = c.bridge === 'UNSTABLE' && c.onBridge ? ` · 退往${c.lastShore === 'west' ? '西' : '东'}岸` : '';
    setText(this.bridgeReadout, BRIDGE_LABEL[c.bridge] + bridgeTime + shore);
    this.bridgeReadout.dataset.state = c.bridge;
    this.bridgeReadout.dataset.ticks = String(c.bridgeRemainingTicks);
    this.bridgeReadout.dataset.passable = c.bridgePassable ? '1' : '0';
    const status = c.relay === 'JAMMED' ? `压制中 ${seconds(snapshot.jamRemainingTicks)} 秒` : c.powered ? '有供电' : '失去供电';
    const control = c.canInteract ? ' · F 可切换' : '';
    const cooldown = snapshot.jamCooldownTicks > 0 ? ` · 冷却 ${seconds(snapshot.jamCooldownTicks)} 秒` : '';
    setText(this.relayReadout,
      `中继器 ${c.manualEnabled ? '开' : '关'} · ${status} · 输出 ${c.effectiveOutput ? 'ON' : 'OFF'}${control}${cooldown}`);
    this.relayReadout.dataset.state = c.relay;
    this.relayReadout.dataset.output = c.effectiveOutput ? '1' : '0';
    this.relayReadout.dataset.jamTicks = String(snapshot.jamRemainingTicks);
    this.relayReadout.dataset.cooldownTicks = String(snapshot.jamCooldownTicks);
    setText(this.healthReadout, `HP ${c.hp} / ${CORRIDOR.maxHp} · ${c.guardHp > 0 ? '守卫在场' : '守卫已清除'}`);
    this.healthReadout.dataset.hp = String(c.hp);
    this.healthReadout.dataset.guard = String(c.guardHp);
    this.healthReadout.dataset.onBridge = c.onBridge ? '1' : '0';

    const reveal = snapshot.corridorReveal;
    const details: string[] = [];
    if (reveal?.relay) details.push('中继器');
    if (reveal?.bridge) details.push(reveal.relay ? '中继器 → 桥梁承重' : '桥梁承重');
    if (reveal?.relay && reveal.perceptionPort) {
      details.push(`中继器 → 感知端口（预留，${c.perceptionFeed ? '有' : '无'}信号）`);
    }
    setText(this.els.scan, reveal
      ? `扫描：${details.length > 0 ? details.join(' · ') : '范围内未发现可操作目标。'}`
      : '未扫描。按 Z 观察中继器的连接。');
    this.els.scan.dataset.revealed = reveal ? '1' : '0';
    this.els.scan.dataset.link = reveal?.relay && reveal.bridge ? '1' : '0';
    setText(this.els.complete, c.hp === 0 ? '本局失败 · 可重开' : c.crossed ? '已到达东岸 · VS-01 完成 ✓' : '失稳走廊 · 前往东岸');
    this.els.complete.dataset.complete = c.crossed && c.hp > 0 ? '1' : '0';
  }

  private refreshHud(): void {
    if (!this.els) return;
    const s = this.model.snapshot();
    this.els.energy.textContent = `${s.energy} / ${SLICE.ENERGY_MAX}`;
    this.els.energy.dataset.energy = String(s.energy);
    this.els.door.textContent = DOOR_LABEL[s.doorState];
    this.els.door.dataset.state = s.doorState;

    const base = [this.notice || this.model.lastResult.message, this.storageWarning].filter(Boolean).join(' · ');
    this.els.feedback.textContent = s.paused ? `【已暂停】${base}` : base;
    this.els.feedback.dataset.code = this.model.lastResult.code;
    this.els.feedback.dataset.cost = String(this.model.lastResult.cost);

    this.els.position.textContent = `${this.px.toFixed(1)}, ${this.py.toFixed(1)}`;
    this.els.position.dataset.x = this.px.toFixed(1);
    this.els.position.dataset.y = this.py.toFixed(1);
    document.body.dataset.sliceRoom = s.corridor ? 'corridor' : 'lab';
    this.refreshCorridorHud(s);
    if (s.corridor) return;

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
