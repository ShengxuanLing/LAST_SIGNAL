// Thin adapter so the host scene needs only a few lines to mount ART-02.
import type Phaser from 'phaser';
import type { Pt } from './themes';
import { SliceVisuals } from './SliceVisuals';
import { sliceGeometry } from './sliceGeometry';

export function createSliceVisuals(
  scene: Phaser.Scene,
  project: (x: number, y: number) => Pt,
  roomScale: () => number,
  legacy: readonly { setVisible(v: boolean): unknown }[],
): SliceVisuals {
  return new SliceVisuals({ scene, project, roomScale, legacy, geometry: sliceGeometry });
}
