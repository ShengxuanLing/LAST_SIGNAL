import Phaser from 'phaser';
import { GAME } from '../config/game';
import { SliceScene } from './SliceScene';
import './slice.css';

// Independent VS-00 entry. It intentionally does NOT import ../main, so the
// original seven-scene game is never booted from /station-zero.html.
export const game = new Phaser.Game({
  type: Phaser.CANVAS,
  backgroundColor: '#05070c',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME.WINDOW_W,
    height: GAME.WINDOW_H,
    parent: 'game',
  },
  scene: [SliceScene],
  render: {
    antialias: true,
    roundPixels: false,
    pixelArt: false,
  },
});
