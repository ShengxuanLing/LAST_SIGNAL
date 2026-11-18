import Phaser from 'phaser';
import { GraphicsFactory } from '../core/GraphicsFactory';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    GraphicsFactory.create(this);
    this.scene.start('PreloadScene');
  }
}
