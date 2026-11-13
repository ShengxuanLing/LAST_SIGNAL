// ART-02 environment baker. Draws a room's static environment ONCE into a
// Canvas 2D surface (floor materials, extruded walls, pipes, cables, plates,
// stencils, chasm depth, wear and grime). The result is uploaded as a single
// texture, so per-frame cost is one image blit regardless of detail.
//
// Inputs are read-only geometry callbacks; nothing here feeds collision,
// LOS, navigation or any rule.
import { MATERIAL, SIGNAL, css, mix } from './palette';
import { visualRng } from './pool';
import type { QualityProfile } from './quality';
import type { Prop, RoomTheme, Pt, WallFace } from './themes';
import { isoEllipse, polyPath, prismFaces, rectAt, type Projector } from './iso2d';

export type TileKind = 'floor' | 'wall' | 'chasm' | 'door';

export interface RoomGeometry {
  readonly width: number;
  readonly height: number;
  tileAt(x: number, y: number): TileKind;
}

type Ctx = CanvasRenderingContext2D;

function fillPoly(ctx: Ctx, pts: readonly Pt[], fill: string | CanvasGradient): void {
  polyPath(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokePoly(ctx: Ctx, pts: readonly Pt[], stroke: string, width = 1): void {
  polyPath(ctx, pts);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

function line(ctx: Ctx, a: Pt, b: Pt, stroke: string, width = 1): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

export class EnvironmentBaker {
  private rnd: () => number;

  constructor(
    private readonly ctx: Ctx,
    private readonly P: Projector,
    private readonly scale: number,
    private readonly geo: RoomGeometry,
    private readonly theme: RoomTheme,
    private readonly q: QualityProfile,
  ) {
    this.rnd = visualRng(theme.seed);
  }

  bake(): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    this.drawChasm();
    this.drawFloors();
    this.drawFloorProps();
    this.drawAmbientOcclusion();
    this.drawWalls();
    this.drawWallProps();
    this.drawStandingProps();
    ctx.restore();
  }

  // ---------------------------------------------------------------- floors

  private wallClass(x: number, y: number): 'back' | 'front' | 'interior' {
    const { width, height } = this.geo;
    if (x === 0 || y === 0) return 'back';
    if (x === width - 1 || y === height - 1) return 'front';
    return 'interior';
  }

  private drawFloors(): void {
    const { ctx, P, geo, theme, q } = this;
    const variants = Math.max(1, q.floorVariants);
    for (let y = 0; y < geo.height; y++) {
      for (let x = 0; x < geo.width; x++) {
        const t = geo.tileAt(x, y);
        if (t !== 'floor' && t !== 'door') continue;
        const quad = rectAt(P, x, y, x + 1, y + 1);
        const v = Math.floor(this.rnd() * variants);
        const shade = (this.rnd() - 0.5) * 0.12;
        if (theme.floor === 'observation') this.observationTile(x, y, quad, v, shade);
        else this.gratingTile(x, y, quad, v, shade);
        if (t === 'door') {
          // Door track recess: always baked; the leaf itself is dynamic.
          fillPoly(ctx, rectAt(P, x + 0.12, y, x + 0.88, y + 1), css(MATERIAL.grime, 0.9));
          line(ctx, P(x + 0.5, y), P(x + 0.5, y + 1), css(MATERIAL.steel, 0.9), 1.2 * this.scale);
        }
      }
    }
  }

  private observationTile(x: number, y: number, quad: Pt[], v: number, shade: number): void {
    const { ctx, P } = this;
    const base = shade >= 0 ? mix(MATERIAL.floorPlate, MATERIAL.floorWorn, shade * 4) : mix(MATERIAL.floorPlate, MATERIAL.floorBase, -shade * 6);
    fillPoly(ctx, quad, css(base));
    // Plate seam (dark) and bevel highlight on the two lit edges.
    strokePoly(ctx, quad, css(MATERIAL.floorSeam), 1.4);
    line(ctx, P(x + 0.04, y + 0.04), P(x + 0.96, y + 0.04), css(MATERIAL.steelLit, 0.35), 1);
    line(ctx, P(x + 0.04, y + 0.04), P(x + 0.04, y + 0.96), css(MATERIAL.steelLit, 0.22), 1);
    // Variant details: quarter-plate split, vent grille, access hatch, bolts.
    if (v === 1) {
      line(ctx, P(x + 0.5, y + 0.06), P(x + 0.5, y + 0.94), css(MATERIAL.floorSeam, 0.8), 1);
    } else if (v === 2) {
      for (let i = 0; i < 5; i++) {
        const k = 0.3 + i * 0.1;
        line(ctx, P(x + 0.28, y + k), P(x + 0.72, y + k), css(MATERIAL.grime, 0.85), 1.6 * this.scale);
      }
    } else if (v === 3) {
      strokePoly(ctx, rectAt(P, x + 0.22, y + 0.22, x + 0.78, y + 0.78), css(MATERIAL.floorSeam, 0.9), 1.2);
      fillPoly(ctx, rectAt(P, x + 0.62, y + 0.3, x + 0.72, y + 0.4), css(MATERIAL.hazardYellow, 0.25));
    } else if (v >= 4) {
      for (const [bx, by] of [[0.12, 0.12], [0.88, 0.12], [0.88, 0.88], [0.12, 0.88]]) {
        const p = P(x + bx, y + by);
        ctx.fillStyle = css(MATERIAL.steelLit, 0.5);
        ctx.fillRect(p.x - 1, p.y - 0.5, 2, 1.2);
      }
    }
  }

  private gratingTile(x: number, y: number, quad: Pt[], v: number, shade: number): void {
    const { ctx, P } = this;
    fillPoly(ctx, quad, css(mix(MATERIAL.steelDark, MATERIAL.floorSeam, 0.3 - shade)));
    // Grating bars along both axes; the void below shows through as near-black.
    const n = 6;
    for (let i = 1; i < n; i++) {
      const k = i / n;
      line(ctx, P(x + k, y + 0.03), P(x + k, y + 0.97), css(MATERIAL.steel, 0.75), 1);
      line(ctx, P(x + 0.03, y + k), P(x + 0.97, y + k), css(MATERIAL.floorSeam, 0.9), 1);
    }
    // Structural frame.
    strokePoly(ctx, quad, css(MATERIAL.steelLit, 0.55), 1.5);
    const roll = this.rnd();
    if (roll < 0.07) {
      // Patched plate welded over a broken section (rare: wear, not pattern).
      const patch = rectAt(P, x + 0.18, y + 0.2, x + 0.62, y + 0.7);
      fillPoly(ctx, patch, css(MATERIAL.steel));
      strokePoly(ctx, patch, css(MATERIAL.rust, 0.8), 1);
    } else if (roll < 0.13 && v !== 0 && this.q.decals) {
      const c = P(x + 0.5, y + 0.5);
      const e = isoEllipse(0.42, this.scale);
      const g = this.ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, e.rx);
      g.addColorStop(0, css(MATERIAL.rust, 0.3));
      g.addColorStop(1, css(MATERIAL.rust, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, e.rx, e.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------- chasm

  private chasmBounds(): { x0: number; x1: number; y0: number; y1: number } | null {
    const { geo } = this;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let y = 0; y < geo.height; y++) {
      for (let x = 0; x < geo.width; x++) {
        if (geo.tileAt(x, y) !== 'chasm') continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
      }
    }
    return Number.isFinite(x0) ? { x0, x1, y0, y1 } : null;
  }

  private drawChasm(): void {
    const b = this.chasmBounds();
    if (!b) return;
    const { ctx, P, scale } = this;
    const mouth = rectAt(P, b.x0, b.y0, b.x1, b.y1);
    const top = Math.min(...mouth.map((p) => p.y));
    const bottom = Math.max(...mouth.map((p) => p.y));
    ctx.save();
    polyPath(ctx, mouth);
    ctx.clip();
    const g = ctx.createLinearGradient(0, top, 0, bottom + 80 * scale);
    g.addColorStop(0, css(MATERIAL.abyss));
    g.addColorStop(0.5, css(MATERIAL.void));
    g.addColorStop(1, css(0x0a0f1c));
    ctx.fillStyle = g;
    ctx.fillRect(0, top - 10, ctx.canvas.width, bottom - top + 200);
    // Deep structure: receding support ribs far below the walkway.
    for (let i = 0; i < 9; i++) {
      const yy = b.y0 + (i + 0.5) * (b.y1 - b.y0) / 9;
      for (const depth of [90, 170]) {
        const a = P(b.x0 + 0.2, yy, -depth);
        const c = P(b.x1 - 0.2, yy, -depth);
        line(ctx, a, c, css(MATERIAL.steelDark, depth > 100 ? 0.35 : 0.6), (depth > 100 ? 1.5 : 3) * scale);
      }
    }
    for (let i = 0; i < 26; i++) {
      const p = P(b.x0 + this.rnd() * (b.x1 - b.x0), b.y0 + this.rnd() * (b.y1 - b.y0), -60 - this.rnd() * 220);
      ctx.fillStyle = css(this.rnd() < 0.2 ? SIGNAL.unstable : SIGNAL.feed, 0.12 + this.rnd() * 0.25);
      ctx.fillRect(p.x, p.y, 1.5, 1.5);
    }
    // The previous bridge segment, lying where it fell.
    for (const prop of this.theme.props) if (prop.kind === 'wreck') this.wreck(prop.at);
    ctx.restore();
    // Cliff face on the near (west) platform edge, dropping into the dark.
    const depth = 120;
    for (let y = b.y0; y < b.y1; y++) {
      if (this.geo.tileAt(b.x0 - 1, y) !== 'floor') continue;
      const face = [P(b.x0, y, 0), P(b.x0, y + 1, 0), P(b.x0, y + 1, -depth), P(b.x0, y, -depth)];
      const fg = ctx.createLinearGradient(0, face[0].y, 0, face[0].y + depth * scale);
      fg.addColorStop(0, css(MATERIAL.concrete));
      fg.addColorStop(1, css(MATERIAL.void, 0));
      fillPoly(ctx, face, fg);
      line(ctx, P(b.x0, y, -6), P(b.x0, y + 1, -6), css(MATERIAL.steelLit, 0.4), 1);
    }
    // Far (east) lip: thin slab edge catching light.
    line(ctx, P(b.x1, b.y0), P(b.x1, b.y1), css(MATERIAL.steelLit, 0.5), 1.4);
  }

  private wreck(at: Pt): void {
    const { ctx, P, scale } = this;
    const z = -150;
    const deck = [P(at.x - 1.6, at.y - 0.5, z), P(at.x + 1.3, at.y - 1.1, z - 20), P(at.x + 1.6, at.y + 0.4, z - 10), P(at.x - 1.3, at.y + 1.0, z + 8)];
    fillPoly(ctx, deck, css(MATERIAL.steelDark, 0.85));
    strokePoly(ctx, deck, css(MATERIAL.steel, 0.6), 1.2);
    for (let i = 1; i < 5; i++) line(ctx, P(at.x - 1.6 + i * 0.6, at.y - 0.6, z - i * 4), P(at.x - 1.3 + i * 0.6, at.y + 0.9, z - i * 3), css(MATERIAL.floorSeam, 0.8), 1);
    const lamp = P(at.x + 1.2, at.y - 0.6, z - 14);
    ctx.fillStyle = css(SIGNAL.unstable, 0.35);
    ctx.fillRect(lamp.x - 1.5 * scale, lamp.y - 1.5 * scale, 3 * scale, 3 * scale);
  }

  // ---------------------------------------------------------------- walls

  private drawWalls(): void {
    const { geo, theme } = this;
    const cells: { x: number; y: number }[] = [];
    for (let y = 0; y < geo.height; y++) for (let x = 0; x < geo.width; x++) if (geo.tileAt(x, y) === 'wall') cells.push({ x, y });
    cells.sort((a, b) => a.x + a.y - (b.x + b.y) || a.x - b.x);
    for (const { x, y } of cells) {
      const cls = this.wallClass(x, y);
      const h = theme.wallHeight[cls];
      // Walls bordering the chasm become thin railings so the void stays legible.
      const overChasm = cls === 'front' && (geo.tileAt(x, y - 1) === 'chasm');
      this.wallBlock(x, y, overChasm ? 4 : h, cls);
    }
  }

  private wallBlock(x: number, y: number, h: number, cls: 'back' | 'front' | 'interior'): void {
    const { ctx, P, scale } = this;
    const f = prismFaces(P, x, y, x + 1, y + 1, h);
    const top = cls === 'interior' ? MATERIAL.steel : MATERIAL.steelDark;
    fillPoly(ctx, f.south, css(MATERIAL.concrete));
    fillPoly(ctx, f.east, css(MATERIAL.concreteDark));
    fillPoly(ctx, f.top, css(top));
    strokePoly(ctx, f.top, css(MATERIAL.steelLit, 0.6), 1);
    if (h < 12) return;
    // Panel seams and a dark plinth band on visible faces.
    for (const face of ['south', 'east'] as const) {
      const pts = f[face];
      const [a, b, c, d] = pts;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const midTop = { x: (d.x + c.x) / 2, y: (d.y + c.y) / 2 };
      line(ctx, mid, midTop, css(MATERIAL.grime, 0.7), 1);
      const band = 5 * scale;
      fillPoly(ctx, [a, b, { x: b.x, y: b.y - band }, { x: a.x, y: a.y - band }], css(MATERIAL.grime, 0.65));
      if (cls !== 'back' && h >= 24) {
        // Hazard chevrons on interior partitions (aged, low contrast).
        const s0 = { x: a.x, y: a.y - band };
        const s1 = { x: b.x, y: b.y - band };
        const n = 5;
        for (let i = 0; i < n; i += 2) {
          const p0 = { x: s0.x + (s1.x - s0.x) * i / n, y: s0.y + (s1.y - s0.y) * i / n };
          const p1 = { x: s0.x + (s1.x - s0.x) * (i + 1) / n, y: s0.y + (s1.y - s0.y) * (i + 1) / n };
          fillPoly(ctx, [p0, p1, { x: p1.x, y: p1.y - 3 * scale }, { x: p0.x, y: p0.y - 3 * scale }], css(MATERIAL.hazardYellow, 0.22));
        }
      }
    }
    if (cls === 'back' && this.rnd() < 0.3) {
      // Recessed vent on the room-facing face.
      const face = y === 0 ? f.south : f.east;
      const [a, b, , d] = face;
      for (let i = 0; i < 4; i++) {
        const t = 0.45 + i * 0.07;
        const p0 = { x: a.x + (d.x - a.x) * t + (b.x - a.x) * 0.25, y: a.y + (d.y - a.y) * t + (b.y - a.y) * 0.25 };
        const p1 = { x: p0.x + (b.x - a.x) * 0.5, y: p0.y + (b.y - a.y) * 0.5 };
        line(ctx, p0, p1, css(MATERIAL.grime, 0.9), 1.4);
      }
    }
  }

  private drawAmbientOcclusion(): void {
    const { ctx, P, geo } = this;
    const strip = (from: Pt[], dir: { x: number; y: number }): void => {
      const [a, b] = from;
      const c = { x: b.x + dir.x, y: b.y + dir.y };
      const d = { x: a.x + dir.x, y: a.y + dir.y };
      const g = ctx.createLinearGradient(a.x, a.y, d.x, d.y);
      g.addColorStop(0, css(MATERIAL.grime, 0.7));
      g.addColorStop(1, css(MATERIAL.grime, 0));
      fillPoly(ctx, [a, b, c, d], g);
    };
    const W = geo.width - 1;
    const H = geo.height - 1;
    const k = 0.7;
    strip([P(1, 1), P(W, 1)], { x: P(1, 1 + k).x - P(1, 1).x, y: P(1, 1 + k).y - P(1, 1).y });
    strip([P(1, 1), P(1, H)], { x: P(1 + k, 1).x - P(1, 1).x, y: P(1 + k, 1).y - P(1, 1).y });
    // Interior wall columns: shade both sides.
    for (let x = 1; x < W; x++) {
      let run = 0;
      for (let y = 1; y <= H; y++) {
        const wall = y < H && geo.tileAt(x, y) === 'wall';
        if (wall) { run++; continue; }
        if (run > 0) {
          const y0 = y - run;
          strip([P(x + 1, y0), P(x + 1, y)], { x: P(x + 1 + k * 0.6, y0).x - P(x + 1, y0).x, y: P(x + 1 + k * 0.6, y0).y - P(x + 1, y0).y });
        }
        run = 0;
      }
    }
  }

  // ---------------------------------------------------------------- props

  private drawFloorProps(): void {
    for (const p of this.theme.props) {
      switch (p.kind) {
        case 'wear': if (this.q.decals) this.wear(p.points, p.radius); break;
        case 'grime': if (this.q.decals) this.grime(p.at, p.radius); break;
        case 'cableRun': this.cable(p.points, p.width); break;
        case 'stencil': this.stencil(p); break;
        case 'rail': this.rail(p.from, p.to); break;
        case 'hazardEdge': this.hazardEdge(p.from, p.to); break;
        case 'dock': this.dockFloor(p.at, p.label); break;
        default: break;
      }
    }
  }

  private drawWallProps(): void {
    for (const p of this.theme.props) {
      if (p.kind === 'pipeRun') this.pipe(p.face, p.from, p.to, p.height, p.radius, p.color);
      else if (p.kind === 'plate') this.plate(p.face, p.at, p.height, p.lines, p.accent, p.width ?? 3);
    }
    for (const a of this.theme.ambient) if (a.kind === 'flicker') this.lampFixture(a.at, a.height);
  }

  private drawStandingProps(): void {
    const standing = this.theme.props.filter((p) => p.kind === 'plinth' || p.kind === 'console' || p.kind === 'cart' || p.kind === 'emitter' || p.kind === 'dock');
    const key = (p: Prop): number => ('at' in p && typeof p.at === 'object' ? p.at.x + p.at.y : 0);
    standing.sort((a, b) => key(a) - key(b));
    for (const p of standing) {
      if (p.kind === 'plinth') this.plinth(p.at, p.size, p.height);
      else if (p.kind === 'console') this.console(p.at, p.lines);
      else if (p.kind === 'cart') this.cart(p.at);
      else if (p.kind === 'emitter') this.emitterPost(p.at);
      else if (p.kind === 'dock') this.dockPost(p.at);
    }
  }

  private wear(points: Pt[], radius: number): void {
    const { ctx, P } = this;
    const scr = points.map((p) => P(p.x, p.y));
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = css(MATERIAL.stencil);
    for (const w of [1, 0.6]) {
      ctx.lineWidth = isoEllipse(radius * w, this.scale).ry * 2;
      ctx.beginPath();
      ctx.moveTo(scr[0].x, scr[0].y);
      for (const p of scr.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private grime(at: Pt, radius: number): void {
    const { ctx, P } = this;
    const c = P(at.x, at.y);
    const e = isoEllipse(radius, this.scale);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(1, e.ry / e.rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, e.rx);
    g.addColorStop(0, css(MATERIAL.grime, 0.55));
    g.addColorStop(1, css(MATERIAL.grime, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, e.rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private cable(points: Pt[], width: number): void {
    const { ctx, P, scale } = this;
    const scr = points.map((p) => P(p.x, p.y));
    for (const [w, col] of [[width + 1.6, css(MATERIAL.grime, 0.8)], [width, css(MATERIAL.cable)], [width * 0.35, css(MATERIAL.steelLit, 0.35)]] as const) {
      ctx.beginPath();
      ctx.moveTo(scr[0].x, scr[0].y);
      for (let i = 1; i < scr.length; i++) {
        const a = scr[i - 1];
        const b = scr[i];
        ctx.quadraticCurveTo(a.x + (b.x - a.x) * 0.5, a.y + (b.y - a.y) * 0.5 + 3 * scale, b.x, b.y);
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = w * scale;
      ctx.stroke();
    }
  }

  /** Text painted onto the floor plane. */
  private stencil(p: Extract<Prop, { kind: 'stencil' }>): void {
    const { ctx, P, scale } = this;
    const o = P(p.at.x, p.at.y);
    ctx.save();
    if (p.angle === 'y') ctx.setTransform(scale * 0.71, -scale * 0.355, scale * 0.71, scale * 0.355, o.x, o.y);
    else ctx.setTransform(scale * 0.71, scale * 0.355, -scale * 0.71, scale * 0.355, o.x, o.y);
    ctx.font = `bold ${p.size * 1.6}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = css(MATERIAL.stencil, p.alpha ?? 0.2);
    ctx.fillText(p.text, 0, 0);
    ctx.restore();
  }

  private rail(from: Pt, to: Pt): void {
    const { ctx, P, scale } = this;
    for (const off of [-0.12, 0.12]) line(ctx, P(from.x, from.y + off), P(to.x, to.y + off), css(MATERIAL.steelLit, 0.7), 1.4 * scale);
    const n = Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 0.35);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const cx = from.x + (to.x - from.x) * t;
      const cy = from.y + (to.y - from.y) * t;
      line(ctx, P(cx, cy - 0.17), P(cx, cy + 0.17), css(MATERIAL.grime, 0.9), 2 * scale);
    }
    // End stop with a faded "auto" stencil.
    const end = P(to.x + 0.15, to.y);
    ctx.fillStyle = css(MATERIAL.hazardYellow, 0.3);
    ctx.fillRect(end.x - 3 * scale, end.y - 3 * scale, 6 * scale, 4 * scale);
  }

  private hazardEdge(from: Pt, to: Pt): void {
    const { ctx, P } = this;
    const vertical = from.x === to.x;
    const inner = from.x <= 10 ? -0.22 : 0.22;
    const len = vertical ? to.y - from.y : to.x - from.x;
    const n = Math.round(len / 0.25);
    for (let i = 0; i < n; i++) {
      const s = (vertical ? from.y : from.x) + i * (len / n);
      const e = s + len / n;
      const quad = vertical
        ? [P(from.x, s), P(from.x, e), P(from.x + inner, e), P(from.x + inner, s)]
        : [P(s, from.y), P(e, from.y), P(e, from.y + inner), P(s, from.y + inner)];
      fillPoly(ctx, quad, css(i % 2 ? MATERIAL.hazardDark : MATERIAL.hazardYellow, i % 2 ? 0.9 : 0.42));
    }
  }

  private pipe(face: WallFace, from: number, to: number, h: number, r: number, color: number): void {
    const { ctx, P, scale } = this;
    const at = (u: number): Pt => (face === 'alongX' ? P(u, 1.04, h) : P(1.04, u, h));
    const a = at(from);
    const b = at(to);
    line(ctx, { x: a.x, y: a.y + r * scale * 0.8 }, { x: b.x, y: b.y + r * scale * 0.8 }, css(MATERIAL.grime, 0.6), r * 2 * scale);
    line(ctx, a, b, css(mix(color, MATERIAL.grime, 0.35)), r * 2 * scale);
    line(ctx, { x: a.x, y: a.y - r * 0.45 * scale }, { x: b.x, y: b.y - r * 0.45 * scale }, css(mix(color, 0xffffff, 0.18), 0.8), Math.max(1, r * 0.6 * scale));
    // Brackets.
    for (let u = Math.ceil(from); u < to; u += 1.5) {
      const p = at(u);
      ctx.fillStyle = css(MATERIAL.steelDark);
      ctx.fillRect(p.x - 1.5 * scale, p.y - (r + 2) * scale, 3 * scale, (2 * r + 6) * scale);
    }
  }

  /** Text plate mounted on a back wall, skewed onto the wall plane. */
  private plate(face: WallFace, at: number, h: number, lines: string[], accent: number, width: number): void {
    const { ctx, P, scale } = this;
    const half = width / 2;
    const origin = face === 'alongX' ? P(at - half, 1.0, h) : P(1.0, at + half, h);
    const W = width * 32;
    const lineH = 10;
    const H = lines.length * lineH + 8;
    ctx.save();
    ctx.setTransform(scale, face === 'alongX' ? scale * 0.5 : -scale * 0.5, 0, scale, origin.x, origin.y);
    ctx.fillStyle = css(MATERIAL.steelDark, 0.95);
    ctx.fillRect(0, -H, W, H);
    ctx.strokeStyle = css(MATERIAL.steelLit, 0.7);
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, -H + 0.5, W - 1, H - 1);
    ctx.fillStyle = css(accent, 0.8);
    ctx.fillRect(0, -H, 3, H);
    ctx.font = `${8}px ui-monospace, Consolas, monospace`;
    ctx.textBaseline = 'top';
    lines.forEach((t, i) => {
      ctx.fillStyle = css(i === 0 ? MATERIAL.plateText : MATERIAL.stencil, i === 0 ? 0.95 : 0.7);
      ctx.fillText(t, 7, -H + 4 + i * lineH, W - 10);
    });
    ctx.restore();
  }

  private lampFixture(at: Pt, h: number): void {
    const { ctx, P, scale } = this;
    const c = P(at.x, at.y, h);
    ctx.fillStyle = css(MATERIAL.steelDark);
    ctx.fillRect(c.x - 9 * scale, c.y - 3 * scale, 18 * scale, 6 * scale);
    ctx.fillStyle = css(MATERIAL.grime);
    ctx.fillRect(c.x - 7 * scale, c.y - 1 * scale, 14 * scale, 2 * scale);
  }

  private plinth(at: Pt, size: number, h: number): void {
    const { ctx, P } = this;
    const f = prismFaces(P, at.x - size, at.y - size, at.x + size, at.y + size, h);
    fillPoly(ctx, f.south, css(MATERIAL.concrete));
    fillPoly(ctx, f.east, css(MATERIAL.concreteDark));
    fillPoly(ctx, f.top, css(MATERIAL.steel));
    strokePoly(ctx, f.top, css(MATERIAL.hazardYellow, 0.35), 1);
  }

  private console(at: Pt, lines: string[]): void {
    const { ctx, P, scale } = this;
    const f = prismFaces(P, at.x - 0.35, at.y - 0.2, at.x + 0.35, at.y + 0.2, 20);
    fillPoly(ctx, f.east, css(MATERIAL.steelDark));
    fillPoly(ctx, f.south, css(MATERIAL.steel));
    fillPoly(ctx, f.top, css(MATERIAL.steelLit));
    // Screen on the south face.
    const o = P(at.x - 0.3, at.y + 0.2, 18);
    ctx.save();
    ctx.setTransform(scale, scale * 0.5, 0, scale, o.x, o.y);
    ctx.fillStyle = css(0x061018);
    ctx.fillRect(0, 0, 0.6 * 32, 14);
    ctx.font = '3.4px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    lines.forEach((t, i) => {
      ctx.fillStyle = css(SIGNAL.protocol, i === lines.length - 1 ? 0.75 : 0.45);
      ctx.fillText(t, 1, 1 + i * 3.2, 0.6 * 32 - 2);
    });
    ctx.restore();
  }

  private cart(at: Pt): void {
    const { ctx, P } = this;
    const f = prismFaces(P, at.x - 0.28, at.y - 0.2, at.x + 0.28, at.y + 0.2, 9);
    fillPoly(ctx, f.east, css(MATERIAL.steelDark));
    fillPoly(ctx, f.south, css(MATERIAL.steel));
    fillPoly(ctx, f.top, css(MATERIAL.steelLit));
    // Sample canister left in the tray.
    const c = prismFaces(P, at.x - 0.1, at.y - 0.08, at.x + 0.06, at.y + 0.08, 7, 9);
    fillPoly(ctx, c.east, css(mix(SIGNAL.feed, MATERIAL.grime, 0.6)));
    fillPoly(ctx, c.south, css(mix(SIGNAL.feed, MATERIAL.grime, 0.45)));
    fillPoly(ctx, c.top, css(mix(SIGNAL.feed, MATERIAL.grime, 0.3)));
  }

  private emitterPost(at: Pt): void {
    const { ctx, P } = this;
    const f = prismFaces(P, at.x - 0.12, at.y - 0.12, at.x + 0.12, at.y + 0.12, 14);
    fillPoly(ctx, f.east, css(MATERIAL.steelDark));
    fillPoly(ctx, f.south, css(MATERIAL.steel));
    fillPoly(ctx, f.top, css(MATERIAL.steelLit));
  }

  private dockFloor(at: Pt, label: string): void {
    const { ctx, P, scale } = this;
    const c = P(at.x, at.y);
    const e = isoEllipse(0.75, scale);
    ctx.save();
    ctx.strokeStyle = css(MATERIAL.hazardYellow, 0.3);
    ctx.lineWidth = 2;
    ctx.setLineDash([6 * scale, 5 * scale]);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, e.rx, e.ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = css(MATERIAL.steel, 0.8);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, e.rx * 0.6, e.ry * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    this.stencil({ kind: 'stencil', at: { x: at.x + 0.2, y: at.y + 1.05 }, text: label, size: 9, alpha: 0.25 });
  }

  private dockPost(at: Pt): void {
    const { ctx, P } = this;
    const f = prismFaces(P, at.x - 0.95, at.y - 0.12, at.x - 0.75, at.y + 0.12, 16);
    fillPoly(ctx, f.east, css(MATERIAL.steelDark));
    fillPoly(ctx, f.south, css(MATERIAL.steel));
    fillPoly(ctx, f.top, css(MATERIAL.steelLit));
  }
}

/** Full-screen backdrop: megastructure silhouettes and the observation ring. */
export function bakeBackdrop(ctx: Ctx, w: number, h: number, seed: number, detailed: boolean): void {
  const rnd = visualRng(seed);
  const g = ctx.createRadialGradient(w / 2, h * 0.42, 40, w / 2, h * 0.5, Math.max(w, h) * 0.75);
  g.addColorStop(0, css(MATERIAL.backdropLight));
  g.addColorStop(1, css(MATERIAL.void));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Observation ring (huge, far away, partly occluded by the room).
  ctx.save();
  ctx.translate(w / 2, h * 0.2);
  ctx.strokeStyle = css(MATERIAL.steel, 0.35);
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.46, h * 0.13, 0, Math.PI * 0.94, Math.PI * 2.06);
  ctx.stroke();
  ctx.strokeStyle = css(MATERIAL.steelLit, 0.18);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, -4, w * 0.46, h * 0.13, 0, Math.PI * 0.94, Math.PI * 2.06);
  ctx.stroke();
  for (let i = 0; i < 28; i++) {
    const a = Math.PI * (0.96 + i * 0.04);
    const x = Math.cos(a) * w * 0.46;
    const y = Math.sin(a) * h * 0.13;
    ctx.fillStyle = css(MATERIAL.steelDark, 0.8);
    ctx.fillRect(x - 3, y - 9, 6, 16);
  }
  ctx.restore();
  // Two banks of receding pylons, left and right.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const depth = i / 7;
      const x = w / 2 + side * (w * 0.33 + depth * w * 0.16) + (rnd() - 0.5) * 18;
      const pw = 46 - depth * 32;
      const top = h * (0.12 + depth * 0.18);
      const col = mix(MATERIAL.backdrop, MATERIAL.void, depth * 0.7);
      ctx.fillStyle = css(col);
      ctx.fillRect(x - pw / 2, top, pw, h - top);
      ctx.fillStyle = css(MATERIAL.steelDark, 0.35 * (1 - depth));
      ctx.fillRect(x - pw / 2, top, 2, h - top);
      if (detailed) {
        for (let k = 0; k < 8; k++) {
          if (rnd() < 0.55) continue;
          ctx.fillStyle = css(rnd() < 0.15 ? SIGNAL.unstable : SIGNAL.feed, 0.08 + rnd() * 0.14 * (1 - depth));
          ctx.fillRect(x - pw / 4 + rnd() * pw / 2, top + 20 + rnd() * (h - top - 40), 2, 2);
        }
      }
    }
  }
  // Horizontal trusses tie the pylons together.
  for (let i = 0; i < 4; i++) {
    const y = h * (0.3 + i * 0.16);
    ctx.strokeStyle = css(MATERIAL.backdrop, 0.9);
    ctx.lineWidth = 6 - i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w * 0.22, y + 12);
    ctx.moveTo(w, y);
    ctx.lineTo(w * 0.78, y + 12);
    ctx.stroke();
  }
  // Haze.
  const haze = ctx.createLinearGradient(0, h * 0.55, 0, h);
  haze.addColorStop(0, css(MATERIAL.void, 0));
  haze.addColorStop(1, css(MATERIAL.void, 0.8));
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, w, h);
}

/** Soft additive glow sprite (white core -> colour -> transparent). */
export function bakeGlow(ctx: Ctx, size: number, color: number): void {
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, css(mix(color, 0xffffff, 0.5), 0.9));
  g.addColorStop(0.25, css(color, 0.45));
  g.addColorStop(1, css(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

/** Screen-edge vignette (fog of the unobserved). */
export function bakeVignette(ctx: Ctx, w: number, h: number, color: number, strength: number): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.38, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, css(color, 0));
  g.addColorStop(1, css(color, strength));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
