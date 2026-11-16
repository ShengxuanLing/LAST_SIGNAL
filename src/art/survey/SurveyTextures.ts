// ART-RENAISSANCE AR-02 · Direction A "SURVEY INK" — procedural actor / VFX textures.
//
// Every texture here is drawn with Canvas 2D at boot (no external image assets),
// so the editable source IS this file (see docs/art/AR02_SLICE_REPORT.md §assets).
// Shapes follow art/concepts/A_survey_ink/A2_silhouettes.svg:
//   executor = upright hard-shell figure + left scan mast (brightest mass),
//   drone    = tripod + box head ("theodolite"),
//   stalker  = low wide arch + front pincers,
//   hunter   = hovering diamond + thin non-solid wings ("range kite"),
//   sentinel = tall slab on a wide base (provisional, outside the AR-02 slice).
// Hostiles are dark masses with exactly ONE vermilion aperture (03 §1 rule 2).
import Phaser from 'phaser';
import { CSS, rgba } from './tokens';

type Ctx = CanvasRenderingContext2D;
type Draw = (g: Ctx) => void;

export interface SheetSpec {
  key: string;
  cellW: number;
  cellH: number;
  /** Feet / ground anchor inside a cell, in px. */
  footX: number;
  footY: number;
  frames: Array<{ name: string; draw: Draw }>;
  /** Extra baked variants per frame: 'flash' = white silhouette, 'rim' = vermilion 1px rim. */
  variants?: Array<'flash' | 'rim'>;
}

export interface SheetInfo { originX: number; originY: number; cellW: number; cellH: number }
export const SHEETS: Record<string, SheetInfo> = {};

const DARK_EDGE = '#050607';

function buildSheet(scene: Phaser.Scene, spec: SheetSpec): void {
  const variants = spec.variants ?? [];
  const names: Array<{ name: string; draw: Draw; variant?: 'flash' | 'rim' }> = [];
  for (const f of spec.frames) {
    names.push(f);
    for (const v of variants) names.push({ name: `${f.name}_${v}`, draw: f.draw, variant: v });
  }
  const cols = Math.max(1, Math.floor(2048 / spec.cellW));
  const rows = Math.ceil(names.length / cols);
  if (scene.textures.exists(spec.key)) scene.textures.remove(spec.key);
  const tex = scene.textures.createCanvas(spec.key, Math.min(cols, names.length) * spec.cellW, rows * spec.cellH)!;
  const sheet = tex.getContext();
  const cell = document.createElement('canvas');
  cell.width = spec.cellW; cell.height = spec.cellH;
  const cg = cell.getContext('2d')!;
  const tmp = document.createElement('canvas');
  tmp.width = spec.cellW; tmp.height = spec.cellH;
  const tg = tmp.getContext('2d')!;
  names.forEach((f, i) => {
    const x = (i % cols) * spec.cellW, y = Math.floor(i / cols) * spec.cellH;
    cg.setTransform(1, 0, 0, 1, 0, 0);
    cg.clearRect(0, 0, spec.cellW, spec.cellH);
    cg.translate(spec.footX, spec.footY);
    f.draw(cg);
    cg.setTransform(1, 0, 0, 1, 0, 0);
    if (f.variant === 'flash') {
      // White silhouette (hit flash, 03 §8 "白色体块闪 60 ms").
      cg.globalCompositeOperation = 'source-in';
      cg.fillStyle = CSS.priority;
      cg.fillRect(0, 0, spec.cellW, spec.cellH);
      cg.globalCompositeOperation = 'source-over';
      sheet.drawImage(cell, x, y);
    } else if (f.variant === 'rim') {
      // Vermilion 1px rim around the unchanged frame (executor hurt, 03 §8).
      tg.clearRect(0, 0, spec.cellW, spec.cellH);
      tg.globalCompositeOperation = 'source-over';
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) tg.drawImage(cell, dx, dy);
      tg.globalCompositeOperation = 'source-in';
      tg.fillStyle = CSS.hostile;
      tg.fillRect(0, 0, spec.cellW, spec.cellH);
      tg.globalCompositeOperation = 'source-over';
      tg.drawImage(cell, 0, 0);
      sheet.drawImage(tmp, x, y);
    } else {
      sheet.drawImage(cell, x, y);
    }
    tex.add(f.name, 0, x, y, spec.cellW, spec.cellH);
  });
  tex.refresh();
  SHEETS[spec.key] = { originX: spec.footX / spec.cellW, originY: spec.footY / spec.cellH, cellW: spec.cellW, cellH: spec.cellH };
}

function single(scene: Phaser.Scene, key: string, w: number, h: number, draw: Draw, nearest = false): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, w, h)!;
  draw(tex.getContext());
  tex.refresh();
  if (nearest) (tex as any).setFilter(Phaser.Textures.FilterMode.NEAREST);
}

// ---------------------------------------------------------------------------
// Executor (EX-17). Feet at (0,0); y grows downward, so the body is at negative y.
// view 'f' = front three-quarter (facing screen-right/down), 'b' = rear three-quarter.

export const EXECUTOR = {
  cellW: 72, cellH: 84, footX: 32, footY: 80,
  /** Muzzle offset from the feet (unflipped), per view, used by the muzzle-flash VFX. */
  muzzle: { f: { x: 27, y: -30 }, b: { x: 25, y: -41 } },
  /** Mast lamp offset from the feet (unflipped). */
  lamp: { f: { x: -13, y: -67 }, b: { x: -11, y: -68 } },
  idleFrames: 4,
  moveFrames: 6,
} as const;

function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

function leg(g: Ctx, hipX: number, hipY: number, footX: number, footY: number, color: string): void {
  const kneeX = (hipX + footX) / 2 + 1.5, kneeY = (hipY + footY) / 2;
  g.lineCap = 'round';
  g.strokeStyle = DARK_EDGE; g.lineWidth = 8;
  g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(kneeX, kneeY); g.lineTo(footX, footY - 2); g.stroke();
  g.strokeStyle = color; g.lineWidth = 6;
  g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(kneeX, kneeY); g.lineTo(footX, footY - 2); g.stroke();
  // boot
  g.fillStyle = '#2a3036';
  roundRect(g, footX - 4, footY - 4, 9, 4.5, 1.5); g.fill();
  g.strokeStyle = DARK_EDGE; g.lineWidth = 1; g.stroke();
}

function drawExecutor(g: Ctx, view: 'f' | 'b', bob: number, stride: number, lift: number): void {
  // Legs (far leg first). stride: -1..1, lift: 0..1 (which foot is raised).
  const hipY = -27 + bob;
  const sx = stride * 6;
  leg(g, -3, hipY, -3 - sx, -lift * 3, CSS.knownLow);
  leg(g, 4, hipY, 4 + sx, -(1 - lift) * 3 * Math.abs(stride), CSS.knownMid);

  const ty = bob;
  // Backpack + mast (behind the torso on the left).
  g.fillStyle = view === 'b' ? CSS.knownMid : CSS.knownLow;
  roundRect(g, view === 'b' ? -14 : -16, -47 + ty, view === 'b' ? 14 : 9, 20, 2); g.fill();
  g.strokeStyle = DARK_EDGE; g.lineWidth = 1.2; g.stroke();
  if (view === 'b') {
    g.strokeStyle = rgba(CSS.shadow, 0.55); g.lineWidth = 1;
    for (const yy of [-42, -38, -34]) { g.beginPath(); g.moveTo(-12, yy + ty); g.lineTo(-3, yy + ty); g.stroke(); }
  }
  const lamp = EXECUTOR.lamp[view];
  g.strokeStyle = CSS.knownMid; g.lineWidth = 1.6; g.lineCap = 'round';
  g.beginPath(); g.moveTo(view === 'b' ? -9 : -13, -46 + ty); g.lineTo(lamp.x, lamp.y + 3 + ty); g.stroke();
  // mast crossbar (survey staff graduation)
  g.lineWidth = 1;
  for (const yy of [-52, -58]) { g.beginPath(); g.moveTo(lamp.x - 2, yy + ty); g.lineTo(lamp.x + 1.5, yy + ty); g.stroke(); }
  g.fillStyle = CSS.interact;
  g.beginPath(); g.arc(lamp.x, lamp.y + ty, 2.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = rgba(CSS.interact, 0.25);
  g.beginPath(); g.arc(lamp.x, lamp.y + ty, 4.5, 0, Math.PI * 2); g.fill();

  // Torso shell.
  const torso = g.createLinearGradient(-11, -48 + ty, 11, -26 + ty);
  torso.addColorStop(0, '#f4efe2');
  torso.addColorStop(0.55, CSS.known);
  torso.addColorStop(1, CSS.knownLow);
  g.fillStyle = torso;
  g.beginPath();
  g.moveTo(-9, -26 + ty); g.lineTo(9, -26 + ty); g.lineTo(11, -38 + ty);
  g.quadraticCurveTo(11, -47 + ty, 4, -48 + ty); g.lineTo(-5, -48 + ty);
  g.quadraticCurveTo(-11, -47 + ty, -11, -38 + ty); g.closePath(); g.fill();
  g.strokeStyle = DARK_EDGE; g.lineWidth = 1.3; g.stroke();
  // Belt + chest seam + ID plate wear.
  g.fillStyle = '#3a3f44'; g.fillRect(-9, -29 + ty, 18, 3);
  g.strokeStyle = rgba(CSS.shadow, 0.35); g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, -46 + ty); g.lineTo(0, -31 + ty); g.stroke();
  if (view === 'f') {
    g.fillStyle = '#3a3f44'; g.fillRect(2, -43 + ty, 7, 4);
    g.fillStyle = CSS.interact; g.fillRect(3, -42 + ty, 1.5, 1.5); // status LED (protocol cyan)
    g.fillStyle = rgba(CSS.known, 0.8); g.fillRect(5.5, -42 + ty, 2.5, 1);
  }

  // Helmet.
  const hy = -55 + ty;
  const helm = g.createRadialGradient(-3, hy - 3, 1, 0, hy, 9);
  helm.addColorStop(0, '#fbf8ef'); helm.addColorStop(1, CSS.knownLow);
  g.fillStyle = helm;
  g.beginPath(); g.arc(0.5, hy, 7.8, 0, Math.PI * 2); g.fill();
  g.strokeStyle = DARK_EDGE; g.lineWidth = 1.3; g.stroke();
  if (view === 'f') {
    g.fillStyle = CSS.mass;
    roundRect(g, 0.5, hy - 3.5, 8, 5.5, 2); g.fill();
    g.strokeStyle = rgba(CSS.known, 0.7); g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(2.5, hy - 2); g.lineTo(6.5, hy - 2); g.stroke();
  } else {
    g.strokeStyle = rgba(CSS.shadow, 0.45); g.lineWidth = 1;
    g.beginPath(); g.arc(0.5, hy, 5, Math.PI * 0.85, Math.PI * 1.6); g.stroke();
  }

  // Arm + pulse rifle (right hand, forward).
  const m = EXECUTOR.muzzle[view];
  const gy = view === 'f' ? -35 + ty : -42 + ty;
  g.strokeStyle = DARK_EDGE; g.lineWidth = 6.5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(5, -44 + ty); g.lineTo(11, gy + 2); g.stroke();
  g.strokeStyle = CSS.knownMid; g.lineWidth = 4.5;
  g.beginPath(); g.moveTo(5, -44 + ty); g.lineTo(11, gy + 2); g.stroke();
  g.save();
  g.translate(9, gy);
  g.rotate(Math.atan2(m.y + ty - gy, m.x - 9) );
  const len = Math.hypot(m.x - 9, m.y + ty - gy);
  g.fillStyle = '#2a3036';
  roundRect(g, -3, -2.6, len + 1, 5.2, 1.5); g.fill();
  g.strokeStyle = DARK_EDGE; g.lineWidth = 1; g.stroke();
  g.fillStyle = rgba(CSS.known, 0.85); g.fillRect(1, -2.4, len - 6, 1.2); // top highlight
  g.fillStyle = CSS.interact; g.fillRect(len - 4, -1, 2, 2);             // emitter
  g.restore();
}

function executorFrames(): Array<{ name: string; draw: Draw }> {
  const out: Array<{ name: string; draw: Draw }> = [];
  for (const view of ['f', 'b'] as const) {
    for (let i = 0; i < EXECUTOR.idleFrames; i++) {
      const bob = [0, -0.5, -1, -0.5][i];
      out.push({ name: `${view}_idle_${i}`, draw: (g) => drawExecutor(g, view, bob, 0, 0) });
    }
    for (let i = 0; i < EXECUTOR.moveFrames; i++) {
      const p = (i / EXECUTOR.moveFrames) * Math.PI * 2;
      out.push({ name: `${view}_move_${i}`, draw: (g) => drawExecutor(g, view, -Math.abs(Math.sin(p)) * 1.5, Math.sin(p), Math.sin(p) > 0 ? 1 : 0) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hostiles.

function aperture(g: Ctx, x: number, y: number, r: number, wide = false): void {
  g.fillStyle = '#121416';
  g.beginPath(); g.arc(x, y, r + 2.2, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3a3f44'; g.lineWidth = 1; g.stroke();
  g.fillStyle = CSS.hostile;
  g.beginPath(); g.arc(x, y, wide ? r + 1.2 : r, 0, Math.PI * 2); g.fill();
  g.fillStyle = CSS.priority;
  g.beginPath(); g.arc(x - r * 0.35, y - r * 0.35, Math.max(0.8, r * 0.28), 0, Math.PI * 2); g.fill();
  if (wide) {
    g.strokeStyle = rgba(CSS.hostile, 0.85); g.lineWidth = 1;
    g.beginPath(); g.arc(x, y, r + 4.5, 0, Math.PI * 2); g.stroke();
  }
}

/** Drone "theodolite": tripod + box head + lens. step = leg phase, scan = lens offset. */
function drawDrone(g: Ctx, step: number, scan: number, wide: boolean): void {
  const headY = -24;
  const legs: Array<[number, number, number]> = [[-14, 0, 0], [13, -2, 1], [3, 3, 2]];
  for (const [fx, fy, idx] of legs) {
    const raised = step >= 0 && idx === step ? 3 : 0;
    g.lineCap = 'round';
    g.strokeStyle = DARK_EDGE; g.lineWidth = 4.2;
    g.beginPath(); g.moveTo(0, headY + 2); g.lineTo(fx, fy - raised); g.stroke();
    g.strokeStyle = '#3a4046'; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(0, headY + 2); g.lineTo(fx, fy - raised); g.stroke();
    g.fillStyle = '#5a6066'; g.beginPath(); g.arc(fx, fy - raised, 1.4, 0, Math.PI * 2); g.fill();
  }
  // collar
  g.fillStyle = '#23282d'; g.fillRect(-4, headY - 1, 8, 4);
  // head box
  const hx = -12, hy = headY - 17, hw = 24, hh = 16;
  const body = g.createLinearGradient(hx, hy, hx + hw, hy + hh);
  body.addColorStop(0, '#2a3036'); body.addColorStop(1, CSS.hostileBody);
  g.fillStyle = body;
  roundRect(g, hx, hy, hw, hh, 2); g.fill();
  g.strokeStyle = DARK_EDGE; g.lineWidth = 1.4; g.stroke();
  g.strokeStyle = rgba(CSS.known, 0.18); g.lineWidth = 1;
  g.beginPath(); g.moveTo(hx + 2, hy + 1.5); g.lineTo(hx + hw - 2, hy + 1.5); g.stroke(); // top bevel catch-light
  // eyepiece (rear knob)
  g.fillStyle = '#1a1e22'; g.fillRect(hx - 4, hy + 5, 4, 6);
  g.strokeStyle = DARK_EDGE; g.strokeRect(hx - 4, hy + 5, 4, 6);
  // lens housing + single aperture
  aperture(g, 6 + scan, hy + hh / 2, wide ? 4 : 3.2, wide);
}

/** Stalker "clamp crawler": low wide arch, leg wave, front pincers (open = attack). */
function drawStalker(g: Ctx, phase: number, open: boolean): void {
  g.lineCap = 'round';
  // legs: three pairs, alternating lift
  for (let i = 0; i < 3; i++) {
    const bx = -14 + i * 12;
    const lift = Math.sin(phase + i * 2.1) * 2.5;
    for (const side of [-1, 1]) {
      const fy = side < 0 ? -1 : 2;
      g.strokeStyle = DARK_EDGE; g.lineWidth = 3.6;
      g.beginPath(); g.moveTo(bx, -9); g.lineTo(bx + side * 3 - 5, -14 - (side < 0 ? lift : -lift) * 0.4); g.lineTo(bx - 7 + side * 2, fy - Math.max(0, side < 0 ? lift : -lift)); g.stroke();
      g.strokeStyle = '#3a4046'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(bx, -9); g.lineTo(bx + side * 3 - 5, -14 - (side < 0 ? lift : -lift) * 0.4); g.lineTo(bx - 7 + side * 2, fy - Math.max(0, side < 0 ? lift : -lift)); g.stroke();
    }
  }
  // pincers (forward = +x)
  const spread = open ? 7 : 2.5;
  for (const s of [-1, 1]) {
    g.strokeStyle = DARK_EDGE; g.lineWidth = 4.4;
    g.beginPath(); g.moveTo(18, -9); g.lineTo(26, -9 + s * spread); g.lineTo(33, -8 + s * (spread - 4)); g.stroke();
    g.strokeStyle = '#4a5157'; g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(18, -9); g.lineTo(26, -9 + s * spread); g.lineTo(33, -8 + s * (spread - 4)); g.stroke();
  }
  // carapace arch
  const body = g.createLinearGradient(-22, -24, 18, -4);
  body.addColorStop(0, '#2a3036'); body.addColorStop(1, CSS.hostileBody);
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(-24, -6); g.quadraticCurveTo(-20, -24, 0, -24); g.quadraticCurveTo(20, -24, 22, -6);
  g.lineTo(14, -4); g.quadraticCurveTo(0, -11, -16, -4); g.closePath(); g.fill();
  g.strokeStyle = DARK_EDGE; g.lineWidth = 1.4; g.stroke();
  // segment plates
  g.strokeStyle = rgba(CSS.known, 0.14); g.lineWidth = 1;
  for (const x of [-10, 0, 10]) { g.beginPath(); g.moveTo(x, -23); g.lineTo(x + 2, -9); g.stroke(); }
  // bar aperture (single, vermilion)
  g.fillStyle = '#121416'; g.fillRect(5, -20, 14, 6);
  g.fillStyle = CSS.hostile; g.fillRect(7, -18.5, open ? 11 : 10, open ? 3.4 : 3);
  g.fillStyle = CSS.priority; g.fillRect(8, -18.5, 2, 1);
}

/** Hunter "range kite": hovering diamond, thin wings. hover = vertical offset. */
function drawHunter(g: Ctx, hover: number, tilt: number, wide: boolean): void {
  const cy = -36 + hover;
  // wings: thin, translucent (explicitly non-solid, 03 §3)
  for (const s of [-1, 1]) {
    const tip = s * 31, ty = cy - 9 + (s > 0 ? tilt : -tilt);
    g.fillStyle = 'rgba(26,30,34,0.55)';
    g.beginPath(); g.moveTo(s * 9, cy - 2); g.lineTo(tip, ty); g.lineTo(s * 21, cy + 6); g.closePath(); g.fill();
    g.strokeStyle = rgba(CSS.known, 0.32); g.lineWidth = 1;
    g.stroke();
    g.strokeStyle = rgba(CSS.known, 0.5);
    g.beginPath(); g.moveTo(tip, ty); g.lineTo(tip + s * 3, ty - 2); g.stroke(); // range tick
  }
  // tail rod
  g.strokeStyle = '#3a4046'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(0, cy + 15); g.lineTo(0, cy + 23); g.stroke();
  // diamond body
  const body = g.createLinearGradient(-12, cy - 16, 12, cy + 16);
  body.addColorStop(0, '#2c3238'); body.addColorStop(0.5, CSS.hostileBodyLift); body.addColorStop(1, CSS.hostileBody);
  g.fillStyle = body;
  g.beginPath(); g.moveTo(0, cy - 17); g.lineTo(13, cy); g.lineTo(0, cy + 16); g.lineTo(-13, cy); g.closePath(); g.fill();
  g.strokeStyle = DARK_EDGE; g.lineWidth = 1.4; g.stroke();
  g.strokeStyle = rgba(CSS.known, 0.2); g.lineWidth = 1;
  g.beginPath(); g.moveTo(-11, cy - 1); g.lineTo(0, cy - 15); g.lineTo(11, cy - 1); g.stroke();
  aperture(g, 0, cy, wide ? 4.4 : 3.6, wide);
}

/** Sentinel "gate tower" — provisional (outside AR-02 slice). */
function drawSentinel(g: Ctx, louver: number): void {
  g.fillStyle = CSS.hostileBody;
  g.beginPath(); g.moveTo(-20, 0); g.lineTo(20, 0); g.lineTo(15, -10); g.lineTo(-15, -10); g.closePath(); g.fill();
  g.strokeStyle = DARK_EDGE; g.lineWidth = 1.4; g.stroke();
  const body = g.createLinearGradient(-12, -70, 12, -10);
  body.addColorStop(0, '#2a3036'); body.addColorStop(1, CSS.hostileBody);
  g.fillStyle = body;
  g.beginPath(); g.moveTo(-12, -10); g.lineTo(12, -10); g.lineTo(10, -66); g.lineTo(-10, -66); g.closePath(); g.fill();
  g.stroke();
  g.fillStyle = '#1a1e22'; g.fillRect(-14, -72, 28, 7); g.strokeRect(-14, -72, 28, 7);
  g.fillStyle = '#121416'; g.fillRect(-9, -58, 18, 8);
  g.fillStyle = CSS.hostile; g.fillRect(-7, -56 + louver, 14, 4 - louver);
  g.strokeStyle = rgba(CSS.known, 0.16); g.lineWidth = 1;
  for (const y of [-44, -34, -24]) { g.beginPath(); g.moveTo(-9, y); g.lineTo(9, y); g.stroke(); }
}

/** Legacy Warden look (pre-AR-02 enemy_hunter circle). The Warden is NOT part of the slice. */
function drawLegacyWarden(c: HTMLCanvasElement): void {
  const g = c.getContext('2d')!;
  const cx = c.width / 2, cy = c.height / 2;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath(); g.ellipse(cx, c.height - 4, c.width * 0.4, 5, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#20303a'; g.strokeStyle = '#a05cff'; g.lineWidth = 2.5;
  g.beginPath(); g.arc(cx, cy, 11, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#a05cff'; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(cx, cy - 1, 2.5, 0, Math.PI * 2); g.fill();
}

export const ENEMY_ART = {
  drone: { key: 'enemy_drone', cellW: 64, cellH: 60, footX: 30, footY: 54, idle: 4, move: 3, apertureY: -33, apertureX: 6, shadowW: 34 },
  stalker: { key: 'enemy_stalker', cellW: 80, cellH: 40, footX: 38, footY: 34, idle: 2, move: 4, apertureY: -17, apertureX: 13, shadowW: 50 },
  hunter: { key: 'enemy_hunter', cellW: 80, cellH: 72, footX: 40, footY: 64, idle: 4, move: 4, apertureY: -36, apertureX: 0, shadowW: 30 },
  sentinel: { key: 'enemy_sentinel', cellW: 56, cellH: 84, footX: 28, footY: 80, idle: 2, move: 2, apertureY: -54, apertureX: 0, shadowW: 44 },
} as const;
export type ArtKind = keyof typeof ENEMY_ART;

// ---------------------------------------------------------------------------

export function createSurveyTextures(scene: Phaser.Scene): void {
  // --- Executor sheet + single-frame 'player' (Station Zero / menu preview use it).
  buildSheet(scene, { key: 'executor', cellW: EXECUTOR.cellW, cellH: EXECUTOR.cellH, footX: EXECUTOR.footX, footY: EXECUTOR.footY, frames: executorFrames(), variants: ['rim'] });
  single(scene, 'player', EXECUTOR.cellW, EXECUTOR.cellH, (g) => { g.translate(EXECUTOR.footX, EXECUTOR.footY); drawExecutor(g, 'f', 0, 0, 0); });
  SHEETS.player = { ...SHEETS.executor };

  // --- Hostiles.
  const d = ENEMY_ART.drone;
  buildSheet(scene, {
    key: d.key, cellW: d.cellW, cellH: d.cellH, footX: d.footX, footY: d.footY, variants: ['flash'],
    frames: [
      ...[0, 1, 0, -1].map((s, i) => ({ name: `idle_${i}`, draw: (g: Ctx) => drawDrone(g, -1, s, false) })),
      ...[0, 1, 2].map((s, i) => ({ name: `move_${i}`, draw: (g: Ctx) => drawDrone(g, s, 0, false) })),
      { name: 'tele_0', draw: (g: Ctx) => drawDrone(g, -1, 0, true) },
    ],
  });
  const s = ENEMY_ART.stalker;
  buildSheet(scene, {
    key: s.key, cellW: s.cellW, cellH: s.cellH, footX: s.footX, footY: s.footY, variants: ['flash'],
    frames: [
      ...[0, 1].map((i) => ({ name: `idle_${i}`, draw: (g: Ctx) => drawStalker(g, i * 0.6, false) })),
      ...[0, 1, 2, 3].map((i) => ({ name: `move_${i}`, draw: (g: Ctx) => drawStalker(g, (i / 4) * Math.PI * 2, false) })),
      { name: 'tele_0', draw: (g: Ctx) => drawStalker(g, 0, true) },
    ],
  });
  const h = ENEMY_ART.hunter;
  buildSheet(scene, {
    key: h.key, cellW: h.cellW, cellH: h.cellH, footX: h.footX, footY: h.footY, variants: ['flash'],
    frames: [
      ...[0, -1, -2, -1].map((v, i) => ({ name: `idle_${i}`, draw: (g: Ctx) => drawHunter(g, v, 0, false) })),
      ...[0, -1, -2, -1].map((v, i) => ({ name: `move_${i}`, draw: (g: Ctx) => drawHunter(g, v, i % 2 ? 3 : -3, false) })),
      { name: 'tele_0', draw: (g: Ctx) => drawHunter(g, -1, 0, true) },
    ],
  });
  const t = ENEMY_ART.sentinel;
  buildSheet(scene, {
    key: t.key, cellW: t.cellW, cellH: t.cellH, footX: t.footX, footY: t.footY, variants: ['flash'],
    frames: [
      ...[0, 1].map((i) => ({ name: `idle_${i}`, draw: (g: Ctx) => drawSentinel(g, i) })),
      ...[0, 1].map((i) => ({ name: `move_${i}`, draw: (g: Ctx) => drawSentinel(g, i) })),
      { name: 'tele_0', draw: (g: Ctx) => drawSentinel(g, 0) },
    ],
  });
  // The Warden keeps its pre-AR-02 look under its own key (out of slice; AR-04).
  single(scene, 'enemy_warden_legacy', 26, 24, (g) => drawLegacyWarden(g.canvas), true);

  // --- Contact shadow (env.ao) and world-sourced light pools (ADD, iso ellipses).
  single(scene, 'ink_shadow', 64, 24, (g) => {
    const r = g.createRadialGradient(32, 32, 2, 32, 32, 32); // user space; y is squashed below
    r.addColorStop(0, rgba(CSS.ao, 0.85)); r.addColorStop(0.6, rgba(CSS.ao, 0.45)); r.addColorStop(1, rgba(CSS.ao, 0));
    g.setTransform(1, 0, 0, 0.375, 0, 0); g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  });
  for (const [key, col] of [['light_interact', CSS.interact], ['light_signal', CSS.signal], ['light_hostile', CSS.hostile], ['light_known', CSS.known]] as const) {
    single(scene, key, 128, 64, (g) => {
      const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      r.addColorStop(0, rgba(col, 0.55)); r.addColorStop(0.35, rgba(col, 0.2)); r.addColorStop(1, rgba(col, 0));
      g.setTransform(1, 0, 0, 0.5, 0, 0); g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    });
  }

  // --- Projectiles (keys keep the proj_ prefix that runtime-bugs.spec relies on).
  // Drawn as a compact glow; the elongated bolt + trail are painted by CombatVfx.
  single(scene, 'proj_pulse', 12, 12, (g) => {
    const r = g.createRadialGradient(6, 6, 0, 6, 6, 6);
    r.addColorStop(0, CSS.priority); r.addColorStop(0.35, CSS.known); r.addColorStop(0.7, rgba(CSS.interact, 0.35)); r.addColorStop(1, rgba(CSS.interact, 0));
    g.fillStyle = r; g.fillRect(0, 0, 12, 12);
  });
  single(scene, 'proj_plasma', 20, 20, (g) => {
    const r = g.createRadialGradient(10, 10, 0, 10, 10, 10);
    r.addColorStop(0, CSS.priority); r.addColorStop(0.3, CSS.known); r.addColorStop(0.6, rgba(CSS.interact, 0.45)); r.addColorStop(1, rgba(CSS.interact, 0));
    g.fillStyle = r; g.fillRect(0, 0, 20, 20);
  });
  single(scene, 'proj_enemy', 14, 14, (g) => {
    const r = g.createRadialGradient(7, 7, 0, 7, 7, 7);
    r.addColorStop(0, '#ffe2dc'); r.addColorStop(0.3, CSS.hostile); r.addColorStop(0.65, rgba(CSS.hostile, 0.45)); r.addColorStop(1, rgba(CSS.hostile, 0));
    g.fillStyle = r; g.fillRect(0, 0, 14, 14);
    g.strokeStyle = rgba(CSS.shadow, 0.9); g.lineWidth = 1; g.beginPath(); g.arc(7, 7, 3.2, 0, Math.PI * 2); g.stroke();
  });

  // --- Pickups (no hostile red: health = protocol cyan cell, credits = bone chit).
  single(scene, 'icon_health', 24, 24, (g) => {
    g.fillStyle = rgba(CSS.ao, 0.7); g.beginPath(); g.ellipse(12, 20, 8, 3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = CSS.knownMid; roundRect(g, 7, 4, 10, 14, 2.5); g.fill();
    g.strokeStyle = DARK_EDGE; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = CSS.interact; g.fillRect(11, 7, 2, 8); g.fillRect(8.5, 10, 7, 2);
  });
  single(scene, 'icon_currency', 24, 24, (g) => {
    g.fillStyle = rgba(CSS.ao, 0.7); g.beginPath(); g.ellipse(12, 19, 8, 3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = CSS.known;
    g.beginPath(); g.moveTo(12, 5); g.lineTo(20, 11); g.lineTo(12, 17); g.lineTo(4, 11); g.closePath(); g.fill();
    g.strokeStyle = DARK_EDGE; g.lineWidth = 1.2; g.stroke();
    g.strokeStyle = rgba(CSS.shadow, 0.6); g.lineWidth = 1;
    g.beginPath(); g.moveTo(8, 11); g.lineTo(16, 11); g.stroke();
  });

  // --- Portal: survey stake + protocol ring (replaces the pause-icon portal, audit 7.9).
  single(scene, 'portal_beacon', 48, 64, (g) => {
    g.strokeStyle = CSS.interact; g.lineWidth = 1.5;
    g.setLineDash([4, 3]);
    g.beginPath(); g.ellipse(24, 54, 20, 9, 0, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = rgba(CSS.interact, 0.45);
    g.beginPath(); g.ellipse(24, 54, 13, 6, 0, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = CSS.known; g.lineWidth = 2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(24, 54); g.lineTo(24, 12); g.stroke();
    g.fillStyle = CSS.interact;
    g.beginPath(); g.moveTo(25, 10); g.lineTo(38, 15); g.lineTo(25, 21); g.closePath(); g.fill();
    g.strokeStyle = DARK_EDGE; g.lineWidth = 1; g.stroke();
    g.strokeStyle = CSS.known; g.lineWidth = 1;
    for (const y of [24, 32, 40]) { g.beginPath(); g.moveTo(21, y); g.lineTo(27, y); g.stroke(); }
  });
}
