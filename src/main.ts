import Phaser from 'phaser';
import { GAME } from './config/game';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { GameScene } from './scenes/GameScene';
import { LevelUpScene } from './scenes/LevelUpScene';
import { GameOverScene } from './scenes/GameOverScene';
import { PauseScene } from './scenes/PauseScene';

export const game = new Phaser.Game({
  type: Phaser.CANVAS,
  backgroundColor: '#05070c',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME.WINDOW_W,
    height: GAME.WINDOW_H,
    parent: 'game'
  },
  scene: [BootScene, PreloadScene, MainMenuScene, GameScene, LevelUpScene, GameOverScene, PauseScene],
  // Keep world textures crisp via explicit NEAREST filters in GraphicsFactory /
  // WorldRenderer, but do NOT force the whole canvas into pixelArt mode.
  // With FIT scaling, `pixelArt: true` set `image-rendering: pixelated`,
  // `antialias: false` and `roundPixels: true`; non-integer CSS scaling then
  // dropped thin monospace glyph strokes and made HUD/LevelUp text unreadable.
  render: {
    antialias: true,
    roundPixels: false,
    pixelArt: false
  },
  dom: { createContainer: true }
});

export { saveSystem } from './systems/SaveSystem';

;(window as any).__game = game;
