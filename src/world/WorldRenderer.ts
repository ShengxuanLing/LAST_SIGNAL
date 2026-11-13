import Phaser from 'phaser';
import { MapData, Tile } from '../types';
import { GAME } from '../config/game';
import { sectorFor } from '../config/dungeon';

// Builds a static isometric map texture (floor + walls + props + lighting) once,
// then composites it under the entity sprites. Keeps per-frame cost to a single
// blit while looking like a coherent 2.5D world.
export class WorldRenderer {
  private layer: Phaser.GameObjects.Sprite;
  private light: Phaser.GameObjects.Sprite;
  private _lightCtx: CanvasRenderingContext2D;
  // Stable reference so the prerender listener can be removed on shutdown.
  private readonly _lightLock = () => this._lockLightToScreen();
  public _offX = 0;
  public _offY = 0;
  private readonly sector;

  constructor(public scene: Phaser.Scene, public map: MapData) {
    this.sector = map.deck === undefined ? undefined : sectorFor(map.deck);
    const src = this._buildTexture();
    if (scene.textures.exists('worldLayer')) scene.textures.remove('worldLayer');
    const tex = scene.textures.createCanvas('worldLayer', src.width, src.height)!;
    const canvas = tex.getCanvas()!;
    const g = canvas.getContext('2d')!;
    g.drawImage(src, 0, 0);
    // NEAREST keeps the 64x32 iso tiles hard-edged, per the style guide.
    (tex as any).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.layer = scene.add.sprite(0, 0, 'worldLayer');
    this.layer.setDepth(-1);
    this.layer.setOrigin(0, 0);
    // Per-frame lighting/vignette overlay on a small canvas texture (cheap, live on CanvasRenderer)
    if (scene.textures.exists('worldLight')) scene.textures.remove('worldLight');
    const lightTex = scene.textures.createCanvas('worldLight', GAME.WINDOW_W, GAME.WINDOW_H)!;
    const lightCanvas = lightTex.getCanvas()!;
    this._lightCtx = lightCanvas.getContext('2d')!;
    this._paintVignette(this._lightCtx);
    this.light = scene.add.sprite(0, 0, 'worldLight');
    this.light.setOrigin(0, 0).setScrollFactor(0);
    this.light.setDepth(1);
    // Align for the first frame; prerender + updateLight re-align on every later frame.
    this._lockLightToScreen();
    this.scene.events.on('prerender', this._lightLock);
    this.scene.events.once('shutdown', () => this.scene.events.off('prerender', this._lightLock));
  }

  /**
   * Phaser's Camera.shake() expects `intensity` as a fraction of the viewport
   * (~0.05), but GameScene feeds it `world.shakeAmount * 8` (a pixel-ish number
   * up to ~144). Shake.update() then computes an offset of up to ~1e5 px, so any
   * boss hit / player hurt blanks the entire frame and also drags the
   * screen-fixed light layer off the viewport. GameScene.ts is outside this
   * phase's editable file set, so normalise the effect here, at the same
   * prerender hook that locks the light. Shake becomes a small visible jitter
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
    // Shake.update() already ran this frame; Shake.preRender() has not yet.
    // Clamp the offsets it is about to add to the camera matrix.
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
    const ox = cam.width * cam.originX;   // 1280*0.5 = 640
    const oy = cam.height * cam.originY;  // 720*0.5 = 360
    this.light.setScale(1 / zx, 1 / zy);
    this.light.setPosition(
      ox * (1 - 1 / zx) - cam.x / zx,
      oy * (1 - 1 / zy) - cam.y / zy
    );
  }

  /** Paint the static dark vignette corners into the overlay canvas. */
  private _paintVignette(ctx: CanvasRenderingContext2D): void {
    const cw = GAME.WINDOW_W, ch = GAME.WINDOW_H;
    // Base stays transparent: the corner tris below draw the soft vignette. An opaque
    // #000 fill here would hide the world and the HUD behind black (bug we hit earlier).
    // Legs are now 0.38*W x 0.32*H (was 0.55*W x 0.55*H) and the corner alpha is
    // <=0.32, so the vignette no longer darkens the screen centre where the player is.
    const vx = cw * 0.38, vy = ch * 0.32;
    const corners = [
      { origin: [0, 0] as [number, number], tri: [[0, 0], [vx, 0], [0, vy]] as Array<[number, number]> },
      { origin: [cw, 0] as [number, number], tri: [[cw, 0], [cw - vx, 0], [cw, vy]] as Array<[number, number]> },
      { origin: [0, ch] as [number, number], tri: [[0, ch], [0, ch - vy], [vx, ch]] as Array<[number, number]> },
      { origin: [cw, ch] as [number, number], tri: [[cw, ch], [cw, ch - vy], [cw - vx, ch]] as Array<[number, number]> },
    ];
    for (const { origin, tri } of corners) {
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
      const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      const grd = ctx.createLinearGradient(origin[0], origin[1], cx, cy);
      grd.addColorStop(0, 'rgba(0,0,0,0.30)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(tri[0][0], tri[0][1]);
      ctx.lineTo(tri[1][0], tri[1][1]);
      ctx.lineTo(tri[2][0], tri[2][1]);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Draw the player's glow onto the overlay, then the vignette. */
  updateLight(_gx: number, _gy: number): void {
    const ctx = this._lightCtx;
    const cw = GAME.WINDOW_W, ch = GAME.WINDOW_H;
    ctx.clearRect(0, 0, cw, ch);
    const cx = cw / 2, cy = ch / 2;
    const r = Math.min(cw, ch) * 0.34;
    const grd = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
    // Faint cyan system glow only: centre <=0.14, mid <=0.06, so the player stays clear.
    grd.addColorStop(0, 'rgba(51,224,255,0.12)');
    grd.addColorStop(0.55, 'rgba(51,224,255,0.05)');
    grd.addColorStop(1, 'rgba(51,224,255,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    this._paintVignette(ctx);
    this._lockLightToScreen();
  }

  private projector(): (gx: number, gy: number) => { x: number; y: number } {
    const halfW = GAME.TILE_W / 2, halfH = GAME.TILE_H / 2;
    const isoX = (gx: number, gy: number) => (gx - gy) * halfW;
    const isoY = (gx: number, gy: number) => (gx + gy) * halfH;
    return (gx: number, gy: number) => ({ x: isoX(gx, gy) + this._offX, y: isoY(gx, gy) + this._offY });
  }

  private _bounds(): { minGX: number; maxGX: number; minGY: number; maxGY: number } {
    let minGX = Infinity, maxGX = -Infinity, minGY = Infinity, maxGY = -Infinity;
    for (const row of this.map.tiles) for (const t of row) {
      minGX = Math.min(minGX, t.x); maxGX = Math.max(maxGX, t.x);
      minGY = Math.min(minGY, t.y); maxGY = Math.max(maxGY, t.y);
    }
    return { minGX, maxGX, minGY, maxGY };
  }

  private _buildTexture(): HTMLCanvasElement {
    const { minGX, maxGX, minGY, maxGY } = this._bounds();
    const halfW = GAME.TILE_W / 2, halfH = GAME.TILE_H / 2;
    const isoX = (x: number, y: number) => (x - y) * halfW;
    const isoY = (x: number, y: number) => (x + y) * halfH;
    const w = (isoX(maxGX, minGY) - isoX(minGX, maxGY)) + 96;
    const h = (isoY(maxGX, maxGY) - isoY(minGX, minGY)) + 96;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w);
    canvas.height = Math.ceil(h);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#05070c';
    g.fillRect(0, 0, canvas.width, canvas.height);
    // Offset so the whole iso world fits inside the positive canvas.
    // isoX = (x - y) * halfW is minimal at (minGX, maxGY); isoY = (x + y) * halfH minimal at (minGX, minGY).
    this._offX = -isoX(minGX, maxGY) + 48;
    this._offY = -isoY(minGX, minGY) + 48;

    const proj = this.projector();
    const inRoom = (gx: number, gy: number): boolean =>
      this.map.rooms.some((r) => gx >= r.gx && gx < r.gx + r.w && gy >= r.gy && gy < r.gy + r.h);
    const isDoorway = (gx: number, gy: number): boolean =>
      this.map.doorways.some((d) => d.x === gx && d.y === gy);

    // Walkable cells = every tile whose type is not 'wall' (floor, spawn, ...).
    // Doorway tiles are plain 'floor' tiles, so they are already in the set; the
    // explicit doorway pass just keeps entrances from ever being treated as void.
    const key = (gx: number, gy: number) => `${gx},${gy}`;
    const walkable = new Set<string>();
    for (const row of this.map.tiles) for (const t of row) {
      if (t.type !== 'wall') walkable.add(key(t.x, t.y));
    }
    for (const d of this.map.doorways) walkable.add(key(d.x, d.y));
    const isWalkable = (gx: number, gy: number): boolean => walkable.has(key(gx, gy));

    // Only the one-tile rim of wall cells touching a walkable cell is rendered.
    // Deep interior walls stay as the #05070c base (already reads as "more wall"),
    // so the screen is no longer filled with wall geometry.
    const nearWalkable = (gx: number, gy: number): boolean => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (isWalkable(gx + dx, gy + dy)) return true;
        }
      }
      return false;
    };
    // Orange is now reserved for the few wall cells directly beside a doorway.
    const nearDoorway = (gx: number, gy: number): boolean =>
      isDoorway(gx - 1, gy) || isDoorway(gx + 1, gy) ||
      isDoorway(gx, gy - 1) || isDoorway(gx, gy + 1);

    const tiles: Tile[] = [];
    for (const row of this.map.tiles) for (const t of row) tiles.push(t);
    tiles.sort((a, b) => (a.x + a.y) - (b.x + b.y));

    for (const t of tiles) {
      const cx = proj(t.x, t.y).x, cy = proj(t.x, t.y).y;
      if (t.type === 'wall') {
        if (nearWalkable(t.x, t.y)) {
          this._drawWall(g, cx, cy, halfW, halfH, nearDoorway(t.x, t.y));
        }
      } else {
        this._drawFloor(g, cx, cy, halfW, halfH, t, isDoorway(t.x, t.y));
        this._drawBoundaryEdges(g, cx, cy, halfW, halfH, t, isWalkable);
      }
    }
    this._drawDecor(g);
    for (const row of this.map.tiles) for (const t of row) {
      if (t.type === 'spawn') {
        const cx = proj(t.x, t.y).x, cy = proj(t.x, t.y).y;
        g.strokeStyle = 'rgba(51,224,255,0.65)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(cx, cy - halfH * 0.8); g.lineTo(cx + halfW * 0.8, cy);
        g.lineTo(cx, cy + halfH * 0.8); g.lineTo(cx - halfW * 0.8, cy); g.closePath(); g.stroke();
      }
    }
    return canvas;
  }

  private _diamond(g: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number): void {
    g.beginPath();
    g.moveTo(cx, cy - hh); g.lineTo(cx + hw, cy); g.lineTo(cx, cy + hh); g.lineTo(cx - hw, cy);
    g.closePath();
  }

  private _drawFloor(g: CanvasRenderingContext2D, cx: number, cy: number, halfW: number, halfH: number, t: Tile, door: boolean): void {
    this._diamond(g, cx, cy, halfW, halfH);
    const grd = g.createLinearGradient(cx - halfW, cy - halfH, cx + halfW, cy + halfH);
    grd.addColorStop(0, door ? '#14303a' : this.sector?.floor[0] ?? '#0e1822');
    grd.addColorStop(1, door ? '#1a3a44' : this.sector?.floor[1] ?? '#12202c');
    g.fillStyle = grd; g.fill();
    const accent = this.sector?.accent ?? '51,224,255';
    g.strokeStyle = `rgba(${accent},${door ? 0.4 : 0.14})`;
    g.lineWidth = 1; g.stroke();
    g.fillStyle = `rgba(${accent},${door ? 0.45 : 0.18})`;
    for (const [dx, dy] of [[-halfW * 0.6, -halfH * 0.6], [halfW * 0.6, -halfH * 0.6], [-halfW * 0.6, halfH * 0.6], [halfW * 0.6, halfH * 0.6]] as const) {
      g.beginPath(); g.arc(cx + dx, cy + dy, 1.4, 0, Math.PI * 2); g.fill();
    }
  }

  /** Faint cyan seam on floor edges that abut wall/void, so room outlines read. */
  private _drawBoundaryEdges(
    g: CanvasRenderingContext2D, cx: number, cy: number, halfW: number, halfH: number,
    t: Tile, isWalkable: (gx: number, gy: number) => boolean
  ): void {
    g.strokeStyle = `rgba(${this.sector?.accent ?? '51,224,255'},0.15)`;
    g.lineWidth = 1;
    const edge = (x1: number, y1: number, x2: number, y2: number) => {
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    };
    // In iso space (gx+1) is down-right and (gy+1) is down-left; the opposite
    // neighbours own the two upper edges of the floor diamond.
    if (!isWalkable(t.x + 1, t.y)) edge(cx + halfW, cy, cx, cy + halfH);
    if (!isWalkable(t.x - 1, t.y)) edge(cx, cy - halfH, cx - halfW, cy);
    if (!isWalkable(t.x, t.y + 1)) edge(cx - halfW, cy, cx, cy + halfH);
    if (!isWalkable(t.x, t.y - 1)) edge(cx, cy - halfH, cx + halfW, cy);
  }

  private _drawWall(g: CanvasRenderingContext2D, cx: number, cy: number, halfW: number, halfH: number, accent: boolean): void {
    const wallH = 26;
    // Dark-blue geometry only: body sides (#0a1016), iso diamond top (#16202b),
    // edge detail (#1d2a36). No orange hazard bar by default.
    // The top face sits on THIS cell's iso diamond (cy), not 26px above it, so it
    // never overlaps the diamonds of neighbouring walkable cells (where the player
    // stands). The visible sides now drop BELOW cy; tiles sorted later by x+y draw
    // their floors over that overhang, which gives correct front-to-back occlusion.
    g.fillStyle = this.sector?.wall[0] ?? '#0a1016';
    this._wallBody(g, cx, cy, halfW, halfH, wallH);
    g.fillStyle = this.sector?.wall[1] ?? '#16202b';
    this._diamond(g, cx, cy, halfW, halfH);
    g.fill();
    g.strokeStyle = this.sector?.wall[2] ?? '#1d2a36'; g.lineWidth = 1; g.stroke();
    if (accent) {
      // Doorframe-only warning: just the wall cells directly beside a doorway get a
      // short, faint orange tick (0.12 alpha, ~10x2px). Never a screen-wide 64px bar,
      // so orange stays a rare entrance/threat cue and the dark cyan floor reads.
      // It tracks the top face: 2px above the diamond centre (now cy, was cy - wallH).
      g.fillStyle = 'rgba(255,138,60,0.12)';
      g.fillRect(cx + halfW * 0.2, cy - 2, halfW * 0.3, 2);
    }
  }

  private _wallBody(g: CanvasRenderingContext2D, cx: number, cy: number, halfW: number, halfH: number, wallH: number): void {
    // Upper edges = the two lower edges of the top diamond at cy; lower edges are
    // the same edges translated down by wallH, to cy + wallH. Front (higher x+y)
    // floors are painted afterwards and cover these downward-extending faces.
    g.beginPath();
    g.moveTo(cx - halfW, cy); g.lineTo(cx, cy + halfH); g.lineTo(cx, cy + halfH + wallH); g.lineTo(cx - halfW, cy + wallH);
    g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(cx + halfW, cy); g.lineTo(cx, cy + halfH); g.lineTo(cx, cy + halfH + wallH); g.lineTo(cx + halfW, cy + wallH);
    g.closePath(); g.fill();
  }

  private _drawDecor(g: CanvasRenderingContext2D): void {
    const proj = this.projector();
    for (const room of this.map.rooms) {
      if (room.kind === 'start') continue;
      let s = (room.id * 2654435761) >>> 0;
      const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      const place = (gx: number, gy: number, color: string) => {
        const cx = proj(gx, gy).x, cy = proj(gx, gy).y;
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.beginPath(); g.ellipse(cx, cy + 4, 11, 5, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#20303a'; g.strokeStyle = color; g.lineWidth = 2;
        g.beginPath(); g.moveTo(cx, cy - 14); g.lineTo(cx + 10, cy - 4); g.lineTo(cx, cy + 4); g.lineTo(cx - 10, cy - 4); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = color; g.fillRect(cx - 3, cy - 9, 6, 3);
      };
      if (room.kind === 'resource' || room.kind === 'shop') {
        for (let i = 0; i < 3; i++) {
          const rx = room.gx + 2 + Math.floor(rand() * Math.max(1, room.w - 4));
          const ry = room.gy + 2 + Math.floor(rand() * Math.max(1, room.h - 4));
          place(rx, ry, i === 2 ? '#ffd233' : '#33e0ff');
        }
      }
      // debris marks
      const count = 2 + (room.id % 3);
      for (let i = 0; i < count; i++) {
        const rx = room.gx + 1 + Math.floor(rand() * Math.max(1, room.w - 2));
        const ry = room.gy + 1 + Math.floor(rand() * Math.max(1, room.h - 2));
        const cx = proj(rx, ry).x, cy = proj(rx, ry).y;
        g.fillStyle = 'rgba(51,224,255,0.05)';
        g.beginPath(); g.arc(cx, cy, 3, 0, Math.PI * 2); g.fill();
      }
    }
  }
}
