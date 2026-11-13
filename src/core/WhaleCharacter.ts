import Phaser from 'phaser';

export const WHALE_TEXTURE = 'whale-chan';
export const WHALE_REAR_TEXTURE = 'whale-chan-rear';
const OUTLINE = '#101f43';
const HAIR_LIGHT = '#75c8ff';
const HAIR_MID = '#3e7ed8';
const HAIR_DARK = '#283c87';
const CLOTH = '#222e60';
const WHITE = '#effaff';

export function drawWhaleCharacter(canvas: HTMLCanvasElement, rear: boolean): void {
  const ctx = canvas.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const shape = (path: string, fill: string | CanvasGradient, stroke = OUTLINE, width = 1.7) => {
    const silhouette = new Path2D(path);
    ctx.fillStyle = fill;
    ctx.fill(silhouette);
    if (!width) return;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke(silhouette);
  };
  const oval = (x: number, y: number, rx: number, ry: number, fill: string) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const gradient = (top: number, bottom: number, light: string, dark: string) => {
    const paint = ctx.createLinearGradient(0, top, 0, bottom);
    paint.addColorStop(0, light);
    paint.addColorStop(1, dark);
    return paint;
  };
  const hair = gradient(12, 77, HAIR_LIGHT, HAIR_DARK);
  const tail = gradient(45, 83, '#5db8f7', '#345bb5');
  const apron = gradient(55, 80, WHITE, '#b6d5f1');

  // Far-side hair and raised fluke establish the three-quarter silhouette.
  shape('M38 22 Q14 30 20 54 Q25 64 14 76 Q23 82 36 76 L59 78 Q74 74 68 59 L65 28 Z', hair);
  shape('M51 76 Q66 81 76 69 Q82 63 80 56 Q69 59 67 48 Q77 47 83 51 Q85 43 93 42 Q96 53 88 59 Q88 78 69 83 Q58 86 51 81 Z', tail);
  shape('M70 76 Q84 70 85 57 Q88 53 91 47 Q91 54 87 58 Q85 74 70 79 Z', '#7fdaff', OUTLINE, 0);

  // Far boot is higher in screen space to match the angled floor plane.
  shape('M47 74 L56 73 L56 83 Q62 86 56 89 L48 89 Q45 87 47 74 Z', '#d3e8fa');
  shape('M47 83 L55 82 Q63 86 56 89 L48 89 Z', CLOTH);
  shape('M33 75 L43 75 L42 87 Q46 91 40 93 L30 93 Q27 91 32 87 Z', WHITE);
  shape('M32 87 L42 86 Q47 91 40 93 L30 93 Q27 91 32 87 Z', CLOTH);
  shape('M32 54 Q25 57 24 66 Q24 70 30 70 L37 59 Z', apron);
  shape('M51 53 Q61 56 63 64 L58 69 L51 60 Z', apron);
  shape('M35 52 L53 53 L53 63 Q57 71 62 77 Q48 85 27 79 Q32 71 35 64 Z', gradient(54, 81, '#3d5088', CLOTH));
  shape('M29 77 Q45 82 60 76 L62 79 Q46 86 27 81 Z', '#e4bc75', OUTLINE, 0);
  if (rear) {
    shape('M41 65 Q32 59 30 67 Q31 74 42 69 Q49 75 54 70 Q56 62 44 65 Z', apron);
  } else {
    shape('M40 58 L50 58 L51 68 L55 76 Q43 81 33 76 L38 67 Z', apron);
    shape('M38 73 Q45 75 48 70 Q50 70 50 73 Q46 78 38 75 Z', HAIR_MID, OUTLINE, 0);
    shape('M39 55 L45 58 L51 55 L51 62 L45 61 L39 62 Z', '#3b80da', OUTLINE, 1);
    oval(45, 59, 1.7, 1.7, '#8ceaff');
  }

  shape('M27 34 Q17 33 14 24 Q25 23 31 29 Z', tail);
  shape('M59 29 Q67 23 73 26 Q72 34 64 37 Z', tail);
  shape('M23 31 Q25 15 42 14 Q59 12 66 26 L66 43 Q63 54 53 57 Q38 59 28 52 Q22 47 23 31 Z',
    rear ? hair : gradient(22, 57, '#fff1e4', '#efbfb9'));
  if (rear) {
    shape('M29 28 Q28 53 22 66 Q32 76 43 62 Q48 70 56 68 Q69 65 66 37 L63 25 Z', hair);
    shape('M32 29 Q39 47 29 64 Q44 56 40 32 Z', HAIR_LIGHT, OUTLINE, 0);
    shape('M51 29 Q60 45 54 61 Q64 54 60 36 Z', HAIR_MID, OUTLINE, 0);
  } else {
    oval(35, 42, 4.4, 5.7, OUTLINE);
    oval(50, 41, 4.8, 6, OUTLINE);
    oval(35.5, 44, 3, 3, '#407fcb');
    oval(50.5, 43, 3.3, 3.3, '#407fcb');
    oval(36, 40, 1.5, 1.5, WHITE);
    oval(51, 39, 1.5, 1.5, WHITE);
    oval(30, 48, 3, 1.4, '#eea7ae');
    oval(54, 47, 3.2, 1.4, '#eea7ae');
    shape('M40 49 Q44 52 47 48 Q46 53 43 53 Q41 52 40 49 Z', '#b56c82', OUTLINE, 0);
    shape('M23 46 Q17 35 24 24 Q29 16 42 15 Q59 14 64 25 Q70 35 64 49 L60 55 Q61 42 56 31 Q51 36 48 38 L47 31 Q39 38 30 36 L29 49 Q26 53 23 46 Z', hair);
    shape('M26 28 Q36 19 53 22 Q43 24 32 31 Z', '#a9e5ff', OUTLINE, 0);
    shape('M26 37 Q29 47 23 58 Q21 61 25 64 Q31 61 32 53 Z', HAIR_MID);
  }

  shape('M24 23 Q24 17 31 17 Q30 12 38 13 Q43 9 48 13 Q55 11 57 16 Q63 16 64 22 Q44 16 24 23 Z', apron);
  shape('M43 16 Q37 6 45 3 Q43 8 48 15 Z', HAIR_MID);
}

export class WhaleCharacterEffects {
  private wakeTime = 0;
  private stride = 0;
  private readonly shadow: Phaser.GameObjects.Ellipse;

  constructor(private readonly sprite: Phaser.GameObjects.Sprite) {
    this.shadow = sprite.scene.add.ellipse(sprite.x, sprite.y, 26, 11, 0x04060b, 0.75).setDepth(88);
    sprite.once('destroy', () => this.shadow.destroy());
  }

  project(): void {
    this.shadow.setPosition(this.sprite.x, this.sprite.y);
  }

  move(dt: number, dx: number, dy: number, dashing: boolean): void {
    const moving = Math.hypot(dx, dy) > 0.01;
    this.stride = moving ? this.stride + dt * 18 : 0;
    this.sprite.setOrigin(this.sprite.originX, (91 + Math.sin(this.stride) * 2) / 100);
    this.wakeTime = Math.max(0, this.wakeTime - dt);
    if (!moving) return;
    this.face(dx, dy);
    if (this.wakeTime > 0) return;
    this.wakeTime = dashing ? 0.045 : 0.13;
    const { scene, x, y } = this.sprite;
    const wake = scene.add.ellipse(x - dx, y - dy, 17, 8).setStrokeStyle(1.5, 0x65d9ff, 0.7)
      .setDepth(89).setName('whale-wake');
    scene.tweens.add({ targets: wake, alpha: 0, scaleX: 2, scaleY: 1.5, duration: 260,
      onComplete: () => wake.destroy() });
    if (dashing) {
      const echo = scene.add.image(x - dx, y - dy, this.sprite.texture.key)
        .setOrigin(this.sprite.originX, this.sprite.originY).setScale(this.sprite.scaleX)
        .setFlipX(this.sprite.flipX).setTint(0x5cdfff).setAlpha(0.32).setDepth(92).setName('whale-dash');
      scene.tweens.add({ targets: echo, alpha: 0, duration: 160, onComplete: () => echo.destroy() });
    }
  }

  fire(dx: number, dy: number): void {
    this.face(dx, dy);
    const { scene, x, y } = this.sprite;
    const angle = Math.atan2(dy, dx);
    const fx = scene.add.graphics({ x: x + Math.cos(angle) * 15, y: y + Math.sin(angle) * 8 - 13 })
      .setRotation(angle).setDepth(101).setName('whale-shot');
    fx.lineStyle(2, 0x63dfff, 0.9).beginPath().arc(0, 0, 9, -1.15, 1.15).strokePath();
    fx.fillStyle(0xe2fbff, 0.95).fillCircle(11, 0, 2.7);
    fx.fillStyle(0x75dfff, 0.8).fillCircle(6, -7, 1.8).fillCircle(6, 7, 1.8);
    scene.tweens.add({ targets: fx, x: fx.x + Math.cos(angle) * 12, y: fx.y + Math.sin(angle) * 12,
      alpha: 0, duration: 150, onComplete: () => fx.destroy() });
  }

  private face(dx: number, dy: number): void {
    this.sprite.setTexture(dy < -Math.abs(dx) * 0.35 ? WHALE_REAR_TEXTURE : WHALE_TEXTURE);
    // Mirror around the ground contact point, which is slightly left of centre.
    const left = dx < 0;
    this.sprite.setFlipX(left).setOrigin(left ? 0.54 : 0.46, this.sprite.originY);
  }
}
