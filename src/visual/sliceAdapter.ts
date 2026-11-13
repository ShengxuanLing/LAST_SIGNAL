// Thin adapter so the host scene needs only a few lines to mount ART-02.
import type Phaser from 'phaser';
import { GAME } from '../config/game';
import { isoToScreen } from '../core/iso';
import { ROOM } from '../slice/room';
import { CORRIDOR } from '../slice/corridorRoom';
import type { Pt, RoomId } from './themes';
import { SliceVisuals } from './SliceVisuals';
import { sliceGeometry } from './sliceGeometry';

/**
 * Predicts the host's projection for a room that is not on screen yet, so the
 * art layer can pre-bake it in small slices. It mirrors SliceScene's layout
 * maths; SliceVisuals verifies the prediction against the live projection on
 * entry and falls back to a synchronous bake if they ever diverge.
 */
export function predictSliceLayout(room: RoomId): { project(x: number, y: number): Pt; scale: number } {
  const { width, height } = room === 'corridor' ? CORRIDOR : ROOM;
  const scale = room === 'corridor' ? 0.82 : 1;
  const pts = [isoToScreen(0, 0), isoToScreen(width, 0), isoToScreen(0, height), isoToScreen(width, height)];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const offX = GAME.WINDOW_W / 2 - (Math.min(...xs) + Math.max(...xs)) * scale / 2;
  const offY = GAME.WINDOW_H / 2 - (Math.min(...ys) + Math.max(...ys)) * scale / 2 + 26;
  return {
    scale,
    project: (x, y) => {
      const p = isoToScreen(x, y);
      return { x: p.x * scale + offX, y: p.y * scale + offY };
    },
  };
}

export function createSliceVisuals(
  scene: Phaser.Scene,
  project: (x: number, y: number) => Pt,
  roomScale: () => number,
  legacy: readonly { setVisible(v: boolean): unknown }[],
): SliceVisuals {
  return new SliceVisuals({ scene, project, roomScale, legacy, geometry: sliceGeometry, predict: predictSliceLayout });
}
