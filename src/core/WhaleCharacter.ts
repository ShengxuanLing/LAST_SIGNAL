import Phaser from 'phaser';

export const WHALE_TEXTURE = 'whale-chan';
export const WHALE_REAR_TEXTURE = 'whale-chan-rear';
export const WHALE_SIDE_TEXTURE = 'whale-chan-side';
const WHALE_FOOT_Y = 0.99;

export class WhaleCharacterEffects {
  private wakeTime = 0;
  private stride = 0;
  private readonly shadow: Phaser.GameObjects.Ellipse;

  constructor(private readonly sprite: Phaser.GameObjects.Sprite) {
    sprite.setDisplaySize(sprite.width * 72 / sprite.height, 72).setOrigin(0.5, WHALE_FOOT_Y);
    this.shadow = sprite.scene.add.ellipse(sprite.x, sprite.y, 26, 11, 0x04060b, 0.75).setDepth(88);
    sprite.once('destroy', () => this.shadow.destroy());
  }

  project(): void {
    this.shadow.setPosition(this.sprite.x, this.sprite.y);
  }

  move(dt: number, dx: number, dy: number, dashing: boolean): void {
    const moving = Math.hypot(dx, dy) > 0.01;
    this.stride = moving ? this.stride + dt * 18 : 0;
    this.sprite.setOrigin(this.sprite.originX, WHALE_FOOT_Y + Math.sin(this.stride) * 0.02);
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
    const side = Math.abs(dy) < Math.abs(dx) * 0.65;
    const facingRight = side && dx > 0;
    this.sprite.setTexture(side ? WHALE_SIDE_TEXTURE : dy < 0 ? WHALE_REAR_TEXTURE : WHALE_TEXTURE);
    // The profile's feet sit at 36% of its width. Flip the pivot with the artwork.
    this.sprite.setFlipX(facingRight).setOrigin(side ? (facingRight ? 0.64 : 0.36) : 0.5, this.sprite.originY);
  }
}
