import Phaser from 'phaser';
import { GraphicsFactory } from '../core/GraphicsFactory';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    GraphicsFactory.create(this);
    const loader = document.getElementById('loader');
    if (loader) (loader as HTMLElement).style.display = 'none';
    this.scene.start('PreloadScene');
  }
}
