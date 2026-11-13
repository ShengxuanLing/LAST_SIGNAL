import Phaser from 'phaser';
import { MapData, Room, Tile } from '../types';
import { GAME } from '../config/game';
import { CSS, DEPTH, INK, FONT, TIME, rgba } from '../art/survey/tokens';
import { visualRng, tileNoise, visualSeed } from '../art/survey/visualRng';

// ART-RENAISSANCE AR-02 · Direction A "SURVEY INK".
// Two layers:
//  * worldLayer (depth -1): one baked Canvas of graphite MASS — floor plates, tall back
//    walls (90 px) with formwork / ribs / seepage, low front slabs (30 px "plate
//    thickness"), facility props and stencils. No ink lines: unobserved space is mass only.
//  * per-room INK images (depth -0.5): bone survey linework (grid, 4-tile seams, wall
//    caps, dimension lines, labels) that is invisible until the room is OBSERVED, then
//    drawn in by an expanding survey ring (03 §9 scanPulse 450 ms).
// Collision, room geometry and tile semantics are untouched: tile (x, y) is drawn over
// its collision cell [x, x+1) x [y, y+1) (centre x+0.5, y+0.5).
// Decoration uses visualRng(map.seed, room.id) only — never World.rng / Math.random.

const RISE_H = 88;      // tall back wall height (03 §4: ~90 px)
const SLAB_H = 30;      // low front slab ("plate thickness", 03 §4)
const CORRIDOR_H = 16;  // corridor rim slab
const REVEAL_S = TIME.scanPulse / 1000;

const ROOM_CODE: Record<string, string> = {
  start: 'Z-00 · WAKE BAY', combat: 'Z-07 · OBS', resource: 'COLD STORE 3', shop: 'SUPPLY 2',
  event: 'ARCHIVE 5', elite: 'GATE 4', boss: 'ARRAY CORE', extraction: 'EXIT',
};

interface InkLayer { image: Phaser.GameObjects.Image; observed: boolean; reveal: number; cx: number; cy: number; radius: number; mask?: Phaser.GameObjects.Graphics; ring?: Phaser.GameObjects.Graphics }

export class WorldRenderer {
  private layer: Phaser.GameObjects.Sprite;
  private light: Phaser.GameObjects.Sprite;
  private _lightCtx: CanvasRenderingContext2D;
  // Stable reference so the prerender listener can be removed on shutdown.
  private readonly _lightLock = () => this._lockLightToScreen();
  public _offX = 0;
  public _offY = 0;
  private walkable = new Set<string>();
  private roomFloor = new Map<string, number>();
  private ink = new Map<number, InkLayer>();
  private readonly seed: number;

  constructor(public scene: Phaser.Scene, public map: MapData) {
    this.seed = visualSeed(map.seed, -1, 'WORLD');
    const src = this._buildTexture();
    if (scene.textures.exists('worldLayer')) scene.textures.remove('worldLayer');
    scene.textures.addCanvas('worldLayer', src);
    this.layer = scene.add.sprite(0, 0, 'worldLayer');
    this.layer.setDepth(DEPTH.world);
    this.layer.setOrigin(0, 0);
    // Screen-space overlay: vignette only. AR-02 removed the screen-centre glow —
    // light now comes from world objects (ADD pools owned by actor views, 03 §1 rule 4).
    if (scene.textures.exists('worldLight')) scene.textures.remove('worldLight');
    const lightTex = scene.textures.createCanvas('worldLight', GAME.WINDOW_W, GAME.WINDOW_H)!;
    const lightCanvas = lightTex.getCanvas()!;
    this._lightCtx = lightCanvas.getContext('2d')!;
    this._paintVignette(this._lightCtx);
    lightTex.refresh();
    this.light = scene.add.sprite(0, 0, 'worldLight');
    this.light.setOrigin(0, 0).setScrollFactor(0);
    this.light.setDepth(DEPTH.light);
    // Align for the first frame; prerender + updateLight re-align on every later frame.
    this._lockLightToScreen();
    this.scene.events.on('prerender', this._lightLock);
    this.scene.events.once('shutdown', () => {
      this.scene.events.off('prerender', this._lightLock);
      for (const roomId of this.ink.keys()) this.scene.textures.remove(`inkRoom_${roomId}`);
      this.ink.clear();
    });
  }

  /**
   * Phaser's Camera.shake() expects `intensity` as a fraction of the viewport
   * (~0.05), but GameScene feeds it `world.shakeAmount * 8` (a pixel-ish number
   * up to ~144). Shake.update() then computes an offset of up to ~1e5 px, so any
   * boss hit / player hurt blanks the entire frame and also drags the
   * screen-fixed light layer off the viewport. Normalise the effect here, at the
   * same prerender hook that locks the light. Shake becomes a small visible jitter
   * (<= 8px) instead of a teleport; scroll/zoom logic is untouched.
   */
  private _clampCameraShake(): void {
    const cam = this.scene.cameras.main as any;
    const shake = cam.shakeEffect;
    if (!shake || !shake.isRunning) return;
    const maxPx = 8;
    const i = shake.intensity;
    if (i && (i.x > maxPx / cam.width || i.y > maxPx / cam.height)) {
      i.set(maxPx / cam.width, maxPx / cam.height);
    }
    if (shake._offsetX > maxPx) shake._offsetX = maxPx;
    else if (shake._offsetX < -maxPx) shake._offsetX = -maxPx;
    if (shake._offsetY > maxPx) shake._offsetY = maxPx;
    else if (shake._offsetY < -maxPx) shake._offsetY = -maxPx;
  }

  /** Lock the light texture to the exact [0..1280]x[0..720] screen rect for this camera. */
  private _lockLightToScreen(): void {
    this._clampCameraShake();
    const cam = this.scene.cameras.main;
    const zx = cam.zoomX || 1;
    const zy = cam.zoomY || 1;
    const ox = cam.width * cam.originX;
    const oy = cam.height * cam.originY;
    this.light.setScale(1 / zx, 1 / zy);
    this.light.setPosition(
      ox * (1 - 1 / zx) - cam.x / zx,
      oy * (1 - 1 / zy) - cam.y / zy
    );
  }

  /** Static edge falloff: unobserved periphery sinks toward env.shadow. */
  private _paintVignette(ctx: CanvasRenderingContext2D): void {
    const cw = GAME.WINDOW_W, ch = GAME.WINDOW_H;
    ctx.clearRect(0, 0, cw, ch);
    const grd = ctx.createRadialGradient(cw / 2, ch / 2, ch * 0.42, cw / 2, ch / 2, cw * 0.66);
    grd.addColorStop(0, rgba(CSS.shadow, 0));
    grd.addColorStop(1, rgba(CSS.shadow, 0.62));
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, cw, ch);
  }

  /** Kept for API compatibility (World.update): the overlay is static now. */
  updateLight(_gx: number, _gy: number): void {
    this._lockLightToScreen();
  }

  // ---------------------------------------------------------------- observation

  isObserved(roomId: number): boolean { return !!this.ink.get(roomId)?.observed; }

  /** Survey a room: its ink is drawn in by a ring expanding from (sx, sy) in display space. */
  observeRoom(roomId: number, sx: number, sy: number, instant = false): void {
    const room = this.map.rooms[roomId];
    if (!room) return;
    const L = this.ink.get(roomId) ?? this._buildInkLayer(room);
    if (!L || L.observed) return;
    L.observed = true;
    L.image.setVisible(true);
    if (instant) { L.reveal = 1; return; }
    L.reveal = 0; L.cx = sx; L.cy = sy;
    const b = L.image.getBounds();
    L.radius = Math.max(...[[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]]
      .map(([x, y]) => Math.hypot(x - sx, (y - sy) * 2))) + 8;
    L.mask = this.scene.make.graphics({}, false);
    L.image.setMask(L.mask.createGeometryMask());
    L.ring = this.scene.add.graphics().setDepth(DEPTH.decal + 1);
  }

  /** Advance reveal rings (dt from World.update, i.e. game.step time). */
  update(dt: number): void {
    for (const L of this.ink.values()) {
      if (!L.mask || !L.ring) continue;
      L.reveal = Math.min(1, L.reveal + dt / REVEAL_S);
      const e = 1 - Math.pow(1 - L.reveal, 3);
      const r = Math.max(4, L.radius * e);
      L.mask.clear(); L.mask.fillStyle(0xffffff, 1); L.mask.fillEllipse(L.cx, L.cy, r * 2, r);
      const ring = L.ring;
      ring.clear();
      const a = 1 - L.reveal;
      ring.lineStyle(1.5, INK.known, 0.85 * a);
      // dashed iso ring + 8 graduation ticks (survey pulse, 02 §1.8)
      const n = 72;
      for (let i = 0; i < n; i += 2) {
        const q0 = (i / n) * Math.PI * 2, q1 = ((i + 1) / n) * Math.PI * 2;
        ring.lineBetween(L.cx + Math.cos(q0) * r, L.cy + Math.sin(q0) * r * 0.5, L.cx + Math.cos(q1) * r, L.cy + Math.sin(q1) * r * 0.5);
      }
      ring.lineStyle(1, INK.interact, 0.7 * a);
      for (let i = 0; i < 8; i++) {
        const q = (i / 8) * Math.PI * 2;
        const x = L.cx + Math.cos(q) * r, y = L.cy + Math.sin(q) * r * 0.5;
        ring.lineBetween(x, y, x + Math.cos(q) * 7, y + Math.sin(q) * 3.5);
      }
      if (L.reveal >= 1) {
        L.image.clearMask(true);
        L.mask.destroy();
        L.mask = undefined;
        ring.destroy(); L.ring = undefined;
      }
    }
  }

  // ---------------------------------------------------------------- projection

  private projector(): (gx: number, gy: number) => { x: number; y: number } {
    const halfW = GAME.TILE_W / 2, halfH = GAME.TILE_H / 2;
    return (gx: number, gy: number) => ({ x: (gx - gy) * halfW + this._offX, y: (gx + gy) * halfH + this._offY });
  }

  /** Visual centre of the collision cell (x, y). */
  private cell(gx: number, gy: number): { x: number; y: number } {
    return this.projector()(gx + 0.5, gy + 0.5);
  }

  private _bounds(): { minGX: number; maxGX: number; minGY: number; maxGY: number } {
    let minGX = Infinity, maxGX = -Infinity, minGY = Infinity, maxGY = -Infinity;
    for (const row of this.map.tiles) for (const t of row) {
      minGX = Math.min(minGX, t.x); maxGX = Math.max(maxGX, t.x);
      minGY = Math.min(minGY, t.y); maxGY = Math.max(maxGY, t.y);
    }
    return { minGX, maxGX, minGY, maxGY };
  }

  private key(gx: number, gy: number): string { return `${gx},${gy}`; }
  private isWalk(gx: number, gy: number): boolean { return this.walkable.has(this.key(gx, gy)); }
  private roomAt(gx: number, gy: number): number { return this.roomFloor.get(this.key(gx, gy)) ?? -1; }

  private wallKind(gx: number, gy: number): 'none' | 'tall' | 'slab' | 'rim' {
    if (this.isWalk(gx, gy)) return 'none';
    let near = false, roomNear = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!this.isWalk(gx + dx, gy + dy)) continue;
      near = true;
      if (this.roomAt(gx + dx, gy + dy) >= 0) roomNear = true;
    }
    if (!near) return 'none';
    const front = this.isWalk(gx + 1, gy) || this.isWalk(gx, gy + 1) || this.isWalk(gx + 1, gy + 1);
    const behind = this.isWalk(gx - 1, gy) || this.isWalk(gx, gy - 1) || this.isWalk(gx - 1, gy - 1);
    if (roomNear && front && !behind) return 'tall';
    return roomNear ? 'slab' : 'rim';
  }

  // ---------------------------------------------------------------- mass bake

  private _buildTexture(): HTMLCanvasElement {
    const { minGX, maxGX, minGY, maxGY } = this._bounds();
    const halfW = GAME.TILE_W / 2, halfH = GAME.TILE_H / 2;
    const isoX = (x: number, y: number) => (x - y) * halfW;
    const isoY = (x: number, y: number) => (x + y) * halfH;
    const w = (isoX(maxGX, minGY) - isoX(minGX, maxGY)) + 96;
    const h = (isoY(maxGX, maxGY) - isoY(minGX, minGY)) + 96 + RISE_H;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w);
    canvas.height = Math.ceil(h);
    const g = canvas.getContext('2d')!;
    // L0 void: env.shadow with very low-frequency grain.
    g.fillStyle = CSS.shadow;
    g.fillRect(0, 0, canvas.width, canvas.height);
    this._offX = -isoX(minGX, maxGY) + 48;
    this._offY = -isoY(minGX, minGY) + 48 + RISE_H;
    const grain = visualRng(this.map.seed, -1, 'VOID');
    g.fillStyle = rgba(CSS.massLight, 0.35);
    for (let i = 0, n = Math.floor(canvas.width * canvas.height / 9000); i < n; i++) {
      g.fillRect(Math.floor(grain.float() * canvas.width), Math.floor(grain.float() * canvas.height), 1, 1);
    }

    for (const row of this.map.tiles) for (const t of row) if (t.type !== 'wall') this.walkable.add(this.key(t.x, t.y));
    for (const d of this.map.doorways) this.walkable.add(this.key(d.x, d.y));
    for (const r of this.map.rooms) {
      for (let y = r.gy; y < r.gy + r.h; y++) for (let x = r.gx; x < r.gx + r.w; x++) {
        if (this.isWalk(x, y)) this.roomFloor.set(this.key(x, y), r.id);
      }
    }
    const isDoorway = (gx: number, gy: number) => this.map.doorways.some((d) => d.x === gx && d.y === gy);

    const tiles: Tile[] = [];
    for (const row of this.map.tiles) for (const t of row) tiles.push(t);
    tiles.sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.x - b.x);

    for (const t of tiles) {
      const { x: cx, y: cy } = this.cell(t.x, t.y);
      if (t.type === 'wall') {
        const kind = this.wallKind(t.x, t.y);
        if (kind === 'tall') this._drawTallWall(g, cx, cy, halfW, halfH, t);
        else if (kind === 'slab') this._drawWall(g, cx, cy, halfW, halfH, SLAB_H, false);
        else if (kind === 'rim') this._drawWall(g, cx, cy, halfW, halfH, CORRIDOR_H, true);
      } else {
        this._drawFloor(g, cx, cy, halfW, halfH, t, isDoorway(t.x, t.y));
      }
    }
    for (const room of this.map.rooms) this._drawRoomDressing(g, room);
    return canvas;
  }

  private _diamond(g: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number): void {
    g.beginPath();
    g.moveTo(cx, cy - hh); g.lineTo(cx + hw, cy); g.lineTo(cx, cy + hh); g.lineTo(cx - hw, cy);
    g.closePath();
  }

  private _drawFloor(g: CanvasRenderingContext2D, cx: number, cy: number, halfW: number, halfH: number, t: Tile, door: boolean): void {
    const inRoom = this.roomAt(t.x, t.y) >= 0;
    const n = tileNoise(t.x, t.y, this.seed);
    this._diamond(g, cx, cy, halfW, halfH);
    const grd = g.createLinearGradient(cx - halfW, cy - halfH, cx + halfW, cy + halfH);
    const lift = Math.round((n - 0.5) * 6);
    const base = inRoom ? 0x1a1f23 : 0x121619;
    const c = (v: number) => `rgb(${((v >> 16) & 255) + lift},${((v >> 8) & 255) + lift},${(v & 255) + lift})`;
    grd.addColorStop(0, c(base + 0x030303));
    grd.addColorStop(1, c(base - 0x030303));
    g.fillStyle = grd; g.fill();
    // Plate bevel: catch-light on the two upper edges, AO groove on the lower edges.
    g.lineWidth = 1;
    g.strokeStyle = rgba(CSS.massLift, inRoom ? 0.7 : 0.4);
    g.beginPath(); g.moveTo(cx - halfW + 1, cy); g.lineTo(cx, cy - halfH + 0.5); g.lineTo(cx + halfW - 1, cy); g.stroke();
    g.strokeStyle = rgba(CSS.ao, 0.9);
    g.beginPath(); g.moveTo(cx - halfW + 1, cy); g.lineTo(cx, cy + halfH - 0.5); g.lineTo(cx + halfW - 1, cy); g.stroke();
    // Fasteners on every other plate (2x2 plate groups).
    if (inRoom && ((t.x + t.y) & 1) === 0) {
      g.fillStyle = rgba(CSS.ao, 0.9);
      for (const [dx, dy] of [[-halfW * 0.5, 0], [halfW * 0.5, 0]] as const) {
        g.beginPath(); g.arc(cx + dx, cy + dy, 1.3, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = rgba(CSS.known, 0.08);
      for (const [dx, dy] of [[-halfW * 0.5, -0.8], [halfW * 0.5, -0.8]] as const) g.fillRect(cx + dx - 0.5, cy + dy, 1, 1);
    }
    // Wear: repeated contact near thresholds exposes brighter metal (03 §5).
    if (door || n > 0.93) {
      g.fillStyle = rgba(CSS.known, door ? 0.07 : 0.035);
      g.beginPath(); g.ellipse(cx + (n - 0.5) * 10, cy, halfW * 0.45, halfH * 0.35, 0, 0, Math.PI * 2); g.fill();
    }
    if (door) {
      // threshold drain slots
      g.strokeStyle = rgba(CSS.ao, 1); g.lineWidth = 2;
      for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(cx - 10 + k * 3, cy - 5 + k * 1.5 + 5); g.lineTo(cx + 2 + k * 3, cy + 1 + k * 1.5 + 5 - 6); g.stroke(); }
    }
    if (t.type === 'spawn') {
      g.strokeStyle = rgba(CSS.known, 0.18); g.lineWidth = 1;
      this._diamond(g, cx, cy, halfW * 0.7, halfH * 0.7); g.stroke();
    }
  }

  /** Low wall / slab: top face on its own diamond, body extending downward. */
  private _drawWall(g: CanvasRenderingContext2D, cx: number, cy: number, halfW: number, halfH: number, wallH: number, corridor: boolean): void {
    // Faces drop BELOW cy; tiles sorted later by x+y paint their floors over the overhang.
    g.fillStyle = corridor ? '#0b0e10' : '#0e1215';
    g.beginPath();
    g.moveTo(cx - halfW, cy); g.lineTo(cx, cy + halfH); g.lineTo(cx, cy + halfH + wallH); g.lineTo(cx - halfW, cy + wallH);
    g.closePath(); g.fill();
    g.fillStyle = corridor ? '#08090b' : '#0a0c0e';
    g.beginPath();
    g.moveTo(cx + halfW, cy); g.lineTo(cx, cy + halfH); g.lineTo(cx, cy + halfH + wallH); g.lineTo(cx + halfW, cy + wallH);
    g.closePath(); g.fill();
    this._diamond(g, cx, cy, halfW, halfH);
    g.fillStyle = corridor ? '#15191c' : '#1f252a';
    g.fill();
    g.strokeStyle = rgba(CSS.massLift, corridor ? 0.35 : 0.8); g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx - halfW, cy); g.lineTo(cx, cy + halfH); g.lineTo(cx + halfW, cy); g.stroke();
  }

  /** Tall back wall: concrete / painted-steel prism rising RISE_H above its cell. */
  private _drawTallWall(g: CanvasRenderingContext2D, cx: number, cy: number, halfW: number, halfH: number, t: Tile): void {
    const riseH = RISE_H;
    const n = tileNoise(t.x, t.y, this.seed ^ 0x55);
    const L = { x: cx - halfW, y: cy }, B = { x: cx, y: cy + halfH }, R = { x: cx + halfW, y: cy };
    const faceL = this.isWalk(t.x, t.y + 1) || this.isWalk(t.x + 1, t.y + 1);
    const faceR = this.isWalk(t.x + 1, t.y) || this.isWalk(t.x + 1, t.y + 1);
    // left face (faces +y): receives the key light
    const gl = g.createLinearGradient(0, cy - riseH, 0, cy + halfH);
    gl.addColorStop(0, '#2a3137'); gl.addColorStop(0.7, '#20262b'); gl.addColorStop(1, '#14181b');
    g.fillStyle = gl;
    g.beginPath(); g.moveTo(L.x, L.y); g.lineTo(B.x, B.y); g.lineTo(B.x, B.y - riseH); g.lineTo(L.x, L.y - riseH); g.closePath(); g.fill();
    // right face (faces +x): shadow side
    const gr = g.createLinearGradient(0, cy - riseH, 0, cy + halfH);
    gr.addColorStop(0, '#1d2226'); gr.addColorStop(1, '#0d1013');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(R.x, R.y); g.lineTo(B.x, B.y); g.lineTo(B.x, B.y - riseH); g.lineTo(R.x, R.y - riseH); g.closePath(); g.fill();

    const faceDetail = (ax: number, ay: number, bx: number, by: number, lit: boolean) => {
      // formwork seams (concrete pour lines) at 30 / 60 px
      for (const hh of [30, 60]) {
        g.strokeStyle = rgba(CSS.ao, 0.95); g.lineWidth = 1;
        g.beginPath(); g.moveTo(ax, ay - hh); g.lineTo(bx, by - hh); g.stroke();
        g.strokeStyle = rgba(CSS.massLift, lit ? 0.7 : 0.35);
        g.beginPath(); g.moveTo(ax, ay - hh + 1); g.lineTo(bx, by - hh + 1); g.stroke();
      }
      // tie-bolt holes
      g.fillStyle = rgba(CSS.ao, 0.9);
      for (const f of [0.3, 0.7]) for (const hh of [15, 45, 75]) {
        g.beginPath(); g.arc(ax + (bx - ax) * f, ay + (by - ay) * f - hh, 1.2, 0, Math.PI * 2); g.fill();
      }
      // seepage streak (vertical, dark) on some panels
      if (n > 0.55) {
        const f = 0.2 + n * 0.6;
        const sx = ax + (bx - ax) * f, sy = ay + (by - ay) * f;
        const sg = g.createLinearGradient(0, sy - riseH, 0, sy - 8);
        sg.addColorStop(0, rgba(CSS.ao, 0.0)); sg.addColorStop(0.3, rgba(CSS.ao, 0.55)); sg.addColorStop(1, rgba(CSS.ao, 0));
        g.fillStyle = sg; g.fillRect(sx - 2.5, sy - riseH + 6, 5, riseH - 14);
      }
      // grime band at the foot
      const fg = g.createLinearGradient(0, Math.min(ay, by) - 14, 0, Math.max(ay, by));
      fg.addColorStop(0, rgba(CSS.ao, 0)); fg.addColorStop(1, rgba(CSS.ao, 0.8));
      g.fillStyle = fg;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(bx, by - 14); g.lineTo(ax, ay - 14); g.closePath(); g.fill();
      // structural rib on every second cell
      if (((t.x + t.y) & 1) === 0) {
        g.fillStyle = rgba(CSS.massLift, lit ? 0.9 : 0.5);
        g.beginPath(); g.moveTo(ax + 1, ay - 2); g.lineTo(ax + 5, ay + (by - ay) * (4 / (bx - ax || 1)) - 2); g.lineTo(ax + 5, ay - riseH + 4); g.lineTo(ax + 1, ay - riseH + 2); g.closePath(); g.fill();
      }
    };
    if (faceL) faceDetail(L.x, L.y, B.x, B.y, true);
    if (faceR) faceDetail(B.x, B.y, R.x, R.y, false);
    // top cap
    this._diamond(g, cx, cy - riseH, halfW, halfH);
    g.fillStyle = '#2b333a'; g.fill();
    g.strokeStyle = rgba(CSS.ao, 1); g.lineWidth = 1; g.stroke();
    // exposed-edge wear on the cap lip (repeated contact -> brighter metal)
    g.strokeStyle = rgba(CSS.known, 0.12 + n * 0.12);
    g.beginPath(); g.moveTo(L.x + 2, L.y - riseH + 1); g.lineTo(B.x, B.y - riseH - 0.5); g.lineTo(R.x - 2, R.y - riseH + 1); g.stroke();
  }

  // ---------------------------------------------------------------- dressing

  /** Text painted on a wall face. dir = +1 for left faces (slope +0.5), -1 for right faces. */
  private _stencil(g: CanvasRenderingContext2D, x: number, y: number, text: string, dir: 1 | -1, size: number, color: string): void {
    g.save();
    g.setTransform(1, 0.5 * dir, 0, 1, x, y);
    g.font = `bold ${size}px ${FONT.mono}`;
    g.fillStyle = color;
    g.textBaseline = 'alphabetic';
    g.fillText(text, 0, 0);
    g.restore();
  }

  /** Back wall run (cells whose +y face looks into the room) along the room's top-left edge. */
  private _backRunLeft(room: Room): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    const y = room.gy - 1;
    for (let x = room.gx; x < room.gx + room.w; x++) if (this.wallKind(x, y) === 'tall' && this.isWalk(x, y + 1)) out.push({ x, y });
    return out;
  }

  private _backRunRight(room: Room): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    const x = room.gx - 1;
    for (let y = room.gy; y < room.gy + room.h; y++) if (this.wallKind(x, y) === 'tall' && this.isWalk(x + 1, y)) out.push({ x, y });
    return out;
  }

  private _drawRoomDressing(g: CanvasRenderingContext2D, room: Room): void {
    const rng = visualRng(this.map.seed, room.id);
    const halfW = GAME.TILE_W / 2, halfH = GAME.TILE_H / 2;
    const floorCells: Array<{ x: number; y: number }> = [];
    for (let y = room.gy; y < room.gy + room.h; y++) for (let x = room.gx; x < room.gx + room.w; x++) if (this.isWalk(x, y)) floorCells.push({ x, y });
    if (!floorCells.length) return;
    const pickCell = (margin = 1) => {
      const c = floorCells.filter((p) => p.x >= room.gx + margin && p.x < room.gx + room.w - margin && p.y >= room.gy + margin && p.y < room.gy + room.h - margin);
      const list = c.length ? c : floorCells;
      return list[Math.floor(rng.float() * list.length)];
    };

    // Oil stains (env.ao), 2-3 per room.
    for (let i = 0, n = 2 + Math.floor(rng.float() * 2); i < n; i++) {
      const cell = pickCell(1);
      const p = this.cell(cell.x, cell.y);
      g.fillStyle = rgba(CSS.ao, 0.45);
      for (let k = 0; k < 3; k++) {
        g.beginPath(); g.ellipse(p.x + (rng.float() - 0.5) * 18, p.y + (rng.float() - 0.5) * 8, 8 + rng.float() * 12, 4 + rng.float() * 5, 0, 0, Math.PI * 2); g.fill();
      }
    }
    // Drain grate.
    {
      const c = pickCell(2);
      const p = this.cell(c.x, c.y);
      g.fillStyle = '#0c0f11'; this._diamond(g, p.x, p.y, halfW * 0.62, halfH * 0.62); g.fill();
      g.strokeStyle = rgba(CSS.massLift, 0.9); g.lineWidth = 1; g.stroke();
      g.strokeStyle = rgba(CSS.massLift, 0.6);
      for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(p.x - 12 + k * 3 + 6, p.y - 6 + k * 1.5 + 3); g.lineTo(p.x + k * 3 + 6, p.y + k * 1.5 + 3 - 6); g.stroke(); }
    }
    // Cable run from the back wall foot across a few plates.
    const runL = this._backRunLeft(room);
    const runR = this._backRunRight(room);
    if (runL.length > 2) {
      const a = runL[1 + Math.floor(rng.float() * (runL.length - 2))];
      const p0 = this.cell(a.x, a.y + 1), p1 = this.cell(a.x + 1, a.y + 3), p2 = this.cell(a.x + 3, a.y + 4);
      for (const [w, col] of [[4, rgba(CSS.ao, 1)], [2.2, '#20262b'], [0.8, rgba(CSS.known, 0.12)]] as const) {
        g.strokeStyle = col; g.lineWidth = w;
        g.beginPath(); g.moveTo(p0.x, p0.y - 4); g.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y); g.stroke();
      }
    }

    // Wall stencil code + room number (narrative / room-type recognition, 02 §1.5).
    const code = ROOM_CODE[room.kind] ?? 'Z-??';
    if (runL.length >= 3) {
      const a = runL[Math.min(1, runL.length - 3)];
      const p = this.cell(a.x, a.y);
      this._stencil(g, p.x - halfW + 6, p.y - 40, code, 1, 13, rgba(CSS.known, 0.24));
      this._stencil(g, p.x - halfW + 6, p.y - 24, `R-${String(room.id).padStart(2, '0')}`, 1, 10, rgba(CSS.known, 0.18));
      // hazard chevrons near the run end (worn paint)
      const e = this.cell(runL[runL.length - 1].x, runL[runL.length - 1].y);
      g.save(); g.setTransform(1, 0.5, 0, 1, e.x - halfW + 4, e.y - 70);
      g.fillStyle = rgba(CSS.unknown, 0.13);
      for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(k * 7, 0); g.lineTo(k * 7 + 4, 0); g.lineTo(k * 7 + 10, 8); g.lineTo(k * 7 + 6, 8); g.closePath(); g.fill(); }
      g.restore();
    }

    // Room-type props (03 §5 table). Placed against back walls or flat on the floor
    // so nothing implies a collider that does not exist.
    if (room.kind === 'combat' && runR.length >= 2) this._observationRack(g, runR[Math.floor(runR.length / 2)]);
    if (room.kind === 'combat') {
      const cell = pickCell(2);
      this._toppledCart(g, this.cell(cell.x, cell.y), rng.float());
    }
    if (room.kind === 'start' && runR.length >= 2) this._wakePod(g, runR[Math.max(0, runR.length - 2)]);
    if (room.kind === 'elite' && runL.length >= 3) this._gateFrame(g, runL[Math.floor(runL.length / 2)]);
    if ((room.kind === 'resource' || room.kind === 'shop') && runR.length >= 2) this._sampleCabinets(g, runR[0], rng);
    if (room.kind === 'boss') {
      const c = this.cell(room.gx + Math.floor(room.w / 2), room.gy + Math.floor(room.h / 2));
      g.strokeStyle = rgba(CSS.massLift, 0.9); g.lineWidth = 2;
      for (const r of [3, 2.2]) { g.beginPath(); g.ellipse(c.x, c.y, r * halfW, r * halfH, 0, 0, Math.PI * 2); g.stroke(); }
    }
    // Old impact scorches: earlier awakenings fought here too (03 §5 wear rule).
    if (room.kind !== 'start') {
      for (let i = 0; i < 3; i++) {
        const cell = pickCell(1);
        const p = this.cell(cell.x, cell.y);
        g.fillStyle = rgba(CSS.ao, 0.7);
        g.beginPath(); g.ellipse(p.x, p.y, 5, 2.5, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = rgba(CSS.ao, 0.6); g.lineWidth = 1;
        for (let k = 0; k < 5; k++) { const q = rng.float() * Math.PI * 2; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + Math.cos(q) * 9, p.y + Math.sin(q) * 4.5); g.stroke(); }
      }
    }
  }

  /** Observation rack mounted on a right-hand (+x facing) back wall face. */
  private _observationRack(g: CanvasRenderingContext2D, c: { x: number; y: number }): void {
    const p = this.cell(c.x, c.y);
    // face runs from B (p.x, p.y+16) to R (p.x+32, p.y): slope -0.5
    g.save(); g.setTransform(1, -0.5, 0, 1, p.x + 3, p.y + 16);
    g.fillStyle = '#121619'; g.fillRect(0, -66, 26, 60);
    g.strokeStyle = '#3a4248'; g.lineWidth = 1.5; g.strokeRect(0, -66, 26, 60);
    for (const y of [-48, -30]) { g.beginPath(); g.moveTo(0, y); g.lineTo(26, y); g.stroke(); }
    // instruments on shelves: graduated cylinders / a dead dial
    g.fillStyle = '#2a3137'; g.fillRect(3, -62, 6, 13); g.fillRect(12, -59, 9, 10);
    g.fillRect(4, -44, 14, 12); g.fillRect(20, -42, 4, 10);
    g.strokeStyle = rgba(CSS.known, 0.22); g.lineWidth = 1;
    g.beginPath(); g.arc(11, -38, 4, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(11, -38); g.lineTo(13.5, -40.5); g.stroke();
    g.fillStyle = rgba(CSS.known, 0.2); for (let k = 0; k < 4; k++) g.fillRect(4 + k * 5, -26, 3, 18);
    g.restore();
  }

  private _toppledCart(g: CanvasRenderingContext2D, p: { x: number; y: number }, r: number): void {
    g.save(); g.translate(p.x, p.y); g.rotate((r - 0.5) * 0.5);
    g.fillStyle = rgba(CSS.ao, 0.8); g.beginPath(); g.ellipse(0, 3, 22, 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1e2429'; g.fillRect(-18, -6, 32, 9);
    g.fillStyle = '#2a3137'; g.fillRect(-18, -9, 32, 3);
    g.strokeStyle = rgba(CSS.ao, 1); g.lineWidth = 1; g.strokeRect(-18, -9, 32, 12);
    g.strokeStyle = '#3a4248'; g.lineWidth = 1.5;
    for (const x of [-12, 8]) { g.beginPath(); g.arc(x, -12, 3, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(14, -4); g.lineTo(24, -10); g.stroke();
    g.restore();
  }

  /** Hibernation pod against the back wall; 17 tally scratches beside it (awakening count). */
  private _wakePod(g: CanvasRenderingContext2D, c: { x: number; y: number }): void {
    const p = this.cell(c.x, c.y);
    g.save(); g.setTransform(1, -0.5, 0, 1, p.x + 2, p.y + 16);
    g.fillStyle = '#20262b'; g.beginPath(); g.ellipse(14, -36, 13, 30, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#4a5157'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#0c0f11'; g.beginPath(); g.ellipse(14, -38, 8, 21, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = rgba(CSS.known, 0.3); g.lineWidth = 1;
    g.beginPath(); g.ellipse(14, -38, 8, 21, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = rgba(CSS.interact, 0.55); g.fillRect(12, -72, 4, 2); // pod status light (protocol)
    g.restore();
    // 17 tally marks scratched into the adjacent face (3 x 5 + 2).
    const q = this.cell(c.x, c.y - 1);
    g.save(); g.setTransform(1, -0.5, 0, 1, q.x + 4, q.y + 16);
    g.strokeStyle = rgba(CSS.known, 0.2); g.lineWidth = 1;
    let x = 0;
    for (let i = 0; i < 17; i++) {
      if (i > 0 && i % 5 === 0) x += 3;
      if (i % 5 === 4) { g.beginPath(); g.moveTo(x - 13, -42); g.lineTo(x + 1, -50); g.stroke(); }
      else { g.beginPath(); g.moveTo(x, -40); g.lineTo(x, -52); g.stroke(); x += 3; }
    }
    g.restore();
  }

  private _gateFrame(g: CanvasRenderingContext2D, c: { x: number; y: number }): void {
    const p = this.cell(c.x, c.y);
    g.save(); g.setTransform(1, 0.5, 0, 1, p.x - 32 - 20, p.y - 10);
    g.strokeStyle = '#3a4248'; g.lineWidth = 4; g.strokeRect(0, -74, 58, 74);
    g.fillStyle = '#0c0f11'; g.fillRect(4, -70, 50, 70);
    g.fillStyle = rgba(CSS.unknown, 0.12);
    for (let k = 0; k < 6; k++) g.fillRect(8 + k * 8, -70, 4, 6);
    g.restore();
  }

  private _sampleCabinets(g: CanvasRenderingContext2D, c: { x: number; y: number }, rng: { float(): number }): void {
    const p = this.cell(c.x, c.y);
    g.save(); g.setTransform(1, -0.5, 0, 1, p.x + 2, p.y + 16);
    for (let k = 0; k < 2; k++) {
      g.fillStyle = '#1b2025'; g.fillRect(k * 14, -54, 12, 50);
      g.strokeStyle = '#3a4248'; g.lineWidth = 1; g.strokeRect(k * 14, -54, 12, 50);
      for (let j = 0; j < 4; j++) { g.fillStyle = rng.float() > 0.5 ? rgba(CSS.known, 0.2) : rgba(CSS.ao, 1); g.fillRect(k * 14 + 3, -50 + j * 11, 6, 2); }
    }
    g.restore();
  }

  // ---------------------------------------------------------------- ink layers

  private _buildInkLayer(room: Room): InkLayer {
    const halfW = GAME.TILE_W / 2, halfH = GAME.TILE_H / 2;
    const project = this.projector();
    const corners = [[room.gx - 1, room.gy - 1], [room.gx + room.w + 1, room.gy - 1], [room.gx - 1, room.gy + room.h + 1], [room.gx + room.w + 1, room.gy + room.h + 1]]
      .map(([x, y]) => project(x, y));
    const minX = Math.floor(Math.min(...corners.map((c) => c.x))) - 40;
    const maxX = Math.ceil(Math.max(...corners.map((c) => c.x))) + 40;
    const minY = Math.floor(Math.min(...corners.map((c) => c.y))) - RISE_H - 30;
    const maxY = Math.ceil(Math.max(...corners.map((c) => c.y))) + 40;
    const canvas = document.createElement('canvas');
    canvas.width = maxX - minX;
    canvas.height = maxY - minY;
    const g = canvas.getContext('2d')!;
    g.translate(-minX, -minY);
    this._paintInk(g, room, halfW, halfH);
    const key = `inkRoom_${room.id}`;
    this.scene.textures.addCanvas(key, canvas);
    const image = this.scene.add.image(minX, minY, key).setOrigin(0, 0).setDepth(DEPTH.ink);
    const layer = { image, observed: false, reveal: 0, cx: 0, cy: 0, radius: 0 };
    this.ink.set(room.id, layer);
    return layer;
  }

  private _paintInk(g: CanvasRenderingContext2D, room: Room, halfW: number, halfH: number): void {
    const P = this.projector();
    const inside = (x: number, y: number) => this.roomAt(x, y) === room.id;
    // Survey grid (16%) + 4-tile heavy seams (38%): drawn on the cell edges.
    for (let y = room.gy; y <= room.gy + room.h; y++) {
      for (let x = room.gx; x < room.gx + room.w; x++) {
        if (!inside(x, y) && !inside(x, y - 1)) continue;
        const heavy = (y - room.gy) % 4 === 0;
        const edge = !inside(x, y) || !inside(x, y - 1);
        g.strokeStyle = rgba(CSS.known, edge ? 0.55 : heavy ? 0.36 : 0.15);
        g.lineWidth = edge ? 1.2 : 1;
        const a = P(x, y), b = P(x + 1, y);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
    }
    for (let x = room.gx; x <= room.gx + room.w; x++) {
      for (let y = room.gy; y < room.gy + room.h; y++) {
        if (!inside(x, y) && !inside(x - 1, y)) continue;
        const heavy = (x - room.gx) % 4 === 0;
        const edge = !inside(x, y) || !inside(x - 1, y);
        g.strokeStyle = rgba(CSS.known, edge ? 0.55 : heavy ? 0.36 : 0.15);
        g.lineWidth = edge ? 1.2 : 1;
        const a = P(x, y), b = P(x, y + 1);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
    }
    // Wall cap lines (60%) on observed tall walls + foot line (45%).
    for (let y = room.gy - 1; y <= room.gy + room.h; y++) for (let x = room.gx - 1; x <= room.gx + room.w; x++) {
      if (this.wallKind(x, y) !== 'tall') continue;
      const c = this.cell(x, y);
      g.strokeStyle = rgba(CSS.known, 0.6); g.lineWidth = 1;
      g.beginPath(); g.moveTo(c.x - halfW, c.y - RISE_H); g.lineTo(c.x, c.y + halfH - RISE_H); g.lineTo(c.x + halfW, c.y - RISE_H); g.stroke();
      g.strokeStyle = rgba(CSS.known, 0.22);
      g.beginPath(); g.moveTo(c.x - halfW, c.y); g.lineTo(c.x - halfW, c.y - RISE_H); g.stroke();
    }
    // Doorway thresholds: dashed (inferred passage), bone.
    for (const d of this.map.doorways) {
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inside(d.x + dx, d.y + dy));
      if (!near) continue;
      const c = this.cell(d.x, d.y);
      g.setLineDash([3, 3]); g.strokeStyle = rgba(CSS.known, 0.5); g.lineWidth = 1;
      this._diamond(g, c.x, c.y, halfW * 0.85, halfH * 0.85); g.stroke();
      g.setLineDash([]);
    }
    // Corner survey marks.
    for (const [x, y] of [[room.gx, room.gy], [room.gx + room.w, room.gy], [room.gx, room.gy + room.h], [room.gx + room.w, room.gy + room.h]]) {
      const c = P(x, y);
      g.strokeStyle = rgba(CSS.known, 0.8); g.lineWidth = 1;
      g.beginPath(); g.moveTo(c.x - 6, c.y); g.lineTo(c.x + 6, c.y); g.moveTo(c.x, c.y - 4); g.lineTo(c.x, c.y + 4); g.stroke();
    }
    // Dimension line along the front-left edge (y = gy + h), offset outward.
    const a = P(room.gx, room.gy + room.h), b = P(room.gx + room.w, room.gy + room.h);
    const off = { x: -9, y: 18 };
    g.strokeStyle = rgba(CSS.known, 0.5); g.lineWidth = 1;
    g.beginPath(); g.moveTo(a.x + off.x, a.y + off.y); g.lineTo(b.x + off.x, b.y + off.y); g.stroke();
    for (const p of [a, b]) { g.beginPath(); g.moveTo(p.x + off.x * 0.4, p.y + off.y * 0.4); g.lineTo(p.x + off.x * 1.4, p.y + off.y * 1.4); g.stroke(); }
    const mx = (a.x + b.x) / 2 + off.x, my = (a.y + b.y) / 2 + off.y;
    g.save(); g.setTransform(1, 0.5, 0, 1, mx - 22, my + 12);
    g.font = `10px ${FONT.mono}`; g.fillStyle = rgba(CSS.known, 0.7);
    g.fillText(`${room.w.toFixed(1)} m`, 0, 0);
    g.restore();
    // Second dimension (front-right edge, x = gx + w).
    const c0 = P(room.gx + room.w, room.gy), c1 = P(room.gx + room.w, room.gy + room.h);
    const off2 = { x: 9, y: 18 };
    g.beginPath(); g.moveTo(c0.x + off2.x, c0.y + off2.y); g.lineTo(c1.x + off2.x, c1.y + off2.y); g.stroke();
    for (const p of [c0, c1]) { g.beginPath(); g.moveTo(p.x + off2.x * 0.4, p.y + off2.y * 0.4); g.lineTo(p.x + off2.x * 1.4, p.y + off2.y * 1.4); g.stroke(); }
    g.save(); g.setTransform(1, -0.5, 0, 1, (c0.x + c1.x) / 2 + off2.x + 2, (c0.y + c1.y) / 2 + off2.y + 14);
    g.font = `10px ${FONT.mono}`; g.fillStyle = rgba(CSS.known, 0.7);
    g.fillText(`${room.h.toFixed(1)} m`, 0, 0);
    g.restore();
    // Leader label at the back corner: room id / function (the "annotation" voice).
    const top = P(room.gx, room.gy);
    const lx = top.x, ly = top.y - RISE_H - 8;
    g.strokeStyle = rgba(CSS.known, 0.55); g.lineWidth = 1;
    g.beginPath(); g.moveTo(lx, ly + 6); g.lineTo(lx + 16, ly - 10); g.lineTo(lx + 120, ly - 10); g.stroke();
    g.font = `bold 10px ${FONT.mono}`; g.fillStyle = rgba(CSS.known, 0.85);
    g.fillText(`R-${String(room.id).padStart(2, '0')} · ${room.kind.toUpperCase()}`, lx + 18, ly - 14);
    g.font = `10px ${FONT.mono}`; g.fillStyle = rgba(CSS.known, 0.5);
    g.fillText(`${ROOM_CODE[room.kind] ?? ''} · ${room.w}×${room.h}`, lx + 18, ly + 0);
  }
}
