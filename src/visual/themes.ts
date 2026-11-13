// ART-02 environment themes and dressing. Pure data, Node-testable.
//
// Rooms are dressed by COMPOSING reusable prop kinds from a theme config —
// the baker has one drawing routine per kind, never per room. Props are pure
// presentation: they are not read by collision, LOS, AI or any rule.
import { MATERIAL, SIGNAL } from './palette';

export type RoomId = 'lab' | 'corridor';

/** Brief-mandated surface (task ART-02 §3.3) plus the knobs the baker needs. */
export interface EnvironmentVisualConfig {
  themeId: string;
  ambientIntensity: number;
  fogDensity: number;
  particleDensity: number;
  colorPalette: string[];
}

export interface Pt { x: number; y: number; }

export type FloorMaterial = 'observation' | 'grating';

/** Wall-plane text: on the north-west back wall (`x-axis`) or the north-east one (`y-axis`). */
export type WallFace = 'alongX' | 'alongY';

export type Prop =
  | { kind: 'pipeRun'; face: WallFace; from: number; to: number; height: number; radius: number; color: number }
  | { kind: 'cableRun'; points: Pt[]; width: number }
  | { kind: 'plate'; face: WallFace; at: number; height: number; lines: string[]; accent: number; width?: number }
  | { kind: 'stencil'; at: Pt; text: string; size: number; alpha?: number; angle?: 'x' | 'y' }
  | { kind: 'plinth'; at: Pt; size: number; height: number }
  | { kind: 'console'; at: Pt; lines: string[] }
  | { kind: 'rail'; from: Pt; to: Pt }
  | { kind: 'cart'; at: Pt }
  | { kind: 'hazardEdge'; from: Pt; to: Pt }
  | { kind: 'emitter'; at: Pt }
  | { kind: 'dock'; at: Pt; label: string }
  | { kind: 'wreck'; at: Pt }
  | { kind: 'wear'; points: Pt[]; radius: number }
  | { kind: 'grime'; at: Pt; radius: number };

/** Animated, non-baked ambient elements. */
export type Ambient =
  | { kind: 'flicker'; at: Pt; height: number; color: number; pattern: string; periodMs: number }
  | { kind: 'blink'; at: Pt; height: number; color: number; periodMs: number; duty: number }
  | { kind: 'abyssLight'; at: Pt; color: number };

export interface RoomTheme {
  readonly room: RoomId;
  readonly config: EnvironmentVisualConfig;
  readonly floor: FloorMaterial;
  /** Height in px (unscaled) of back walls, interior walls and front curbs. */
  readonly wallHeight: { back: number; interior: number; front: number };
  readonly seed: number;
  readonly props: readonly Prop[];
  readonly ambient: readonly Ambient[];
}

const hexes = (...c: number[]): string[] => c.map((v) => `#${v.toString(16).padStart(6, '0')}`);

/**
 * R1 Observation Lab — "Silent Machine Civilization".
 * Ordered, repetitive, clean but unattended: automation still cycling with no
 * one to confirm it. Cool, low ambient; the only warm light is the seal.
 */
export const LAB_THEME: RoomTheme = {
  room: 'lab',
  config: {
    themeId: 'silent-machine/observation-lab',
    ambientIntensity: 0.32,
    fogDensity: 0.18,
    particleDensity: 0.45,
    colorPalette: hexes(MATERIAL.floorBase, MATERIAL.steel, MATERIAL.concrete, SIGNAL.protocol, SIGNAL.feed, SIGNAL.hostile),
  },
  floor: 'observation',
  wallHeight: { back: 54, interior: 30, front: 8 },
  seed: 0x0b5e_0002,
  props: [
    // Back-wall services: one long coolant line and a thinner data line.
    { kind: 'pipeRun', face: 'alongX', from: 1, to: 13, height: 40, radius: 3.2, color: MATERIAL.steelLit },
    { kind: 'pipeRun', face: 'alongX', from: 1.5, to: 6.6, height: 30, radius: 1.6, color: MATERIAL.rust },
    { kind: 'pipeRun', face: 'alongY', from: 1, to: 9, height: 44, radius: 2.4, color: MATERIAL.steelLit },
    // Facility identity and maintenance records (questions, not answers).
    { kind: 'plate', face: 'alongX', at: 2.2, height: 22, accent: SIGNAL.protocol, width: 3.2,
      lines: ['OBS-LAB 02', '共识场观测 · 第二实验室'] },
    { kind: 'plate', face: 'alongX', at: 8.6, height: 22, accent: SIGNAL.unstable, width: 3.8,
      lines: ['维护周期 #4117 · 自动签核 ✓', '人工签核 —— · 记录无法解析'] },
    { kind: 'plate', face: 'alongY', at: 3.0, height: 24, accent: SIGNAL.dormant, width: 3.0,
      lines: ['门 B · 接收器 RX-7', '状态由外部载波决定'] },
    // Floor stencils.
    { kind: 'stencil', at: { x: 4.6, y: 7.6 }, text: '观测区 · 勿遮挡接收器', size: 11, alpha: 0.22 },
    { kind: 'stencil', at: { x: 10.6, y: 3.2 }, text: 'B-SIDE', size: 14, alpha: 0.16 },
    { kind: 'stencil', at: { x: 11.9, y: 7.4 }, text: '出口 →', size: 12, alpha: 0.26, angle: 'y' },
    // Equipment bases under the two causal endpoints (presentation only).
    { kind: 'plinth', at: { x: 6.55, y: 5.0 }, size: 0.32, height: 6 },
    // Interrupted automation: a sample rail with a cart frozen mid-run.
    { kind: 'rail', from: { x: 1.6, y: 2.0 }, to: { x: 6.4, y: 2.0 } },
    { kind: 'cart', at: { x: 4.3, y: 2.0 } },
    { kind: 'console', at: { x: 1.7, y: 8.3 }, lines: ['> 自检 ......... OK', '> 封锁载波 持续', '> 来源: 内部', '> 等待人工确认_'] },
    { kind: 'console', at: { x: 12.3, y: 1.7 }, lines: ['> 归档同步', '> 对端 无响应', '> 重试 #88213_'] },
    // Floor cable from the console bank toward the partition (an unproven hint, not a reveal).
    { kind: 'cableRun', points: [{ x: 1.9, y: 7.9 }, { x: 3.0, y: 7.2 }, { x: 5.6, y: 7.0 }, { x: 6.9, y: 6.4 }], width: 2.2 },
    { kind: 'cableRun', points: [{ x: 12.0, y: 2.0 }, { x: 10.2, y: 2.6 }, { x: 8.1, y: 2.4 }], width: 1.6 },
    // Wear: the path someone (something) walked thousands of times.
    { kind: 'wear', points: [{ x: 2.0, y: 5.5 }, { x: 4.5, y: 5.3 }, { x: 6.8, y: 4.9 }, { x: 9.5, y: 5.2 }, { x: 12.5, y: 5.5 }], radius: 0.55 },
    { kind: 'grime', at: { x: 1.4, y: 1.4 }, radius: 1.3 },
    { kind: 'grime', at: { x: 12.6, y: 8.6 }, radius: 1.1 },
    { kind: 'grime', at: { x: 6.4, y: 8.5 }, radius: 0.9 },
  ],
  ambient: [
    // One ceiling light failing in a strict, learnable rhythm.
    { kind: 'flicker', at: { x: 10.5, y: 1.05 }, height: 46, color: SIGNAL.feedHi, pattern: '1111011101000000', periodMs: 2400 },
    { kind: 'flicker', at: { x: 1.05, y: 6.5 }, height: 46, color: SIGNAL.feedHi, pattern: '1', periodMs: 1000 },
    { kind: 'blink', at: { x: 4.3, y: 2.0 }, height: 12, color: SIGNAL.unstable, periodMs: 1600, duty: 0.25 },
    { kind: 'blink', at: { x: 1.7, y: 8.3 }, height: 20, color: SIGNAL.protocol, periodMs: 900, duty: 0.5 },
  ],
};

/**
 * R2 Unstable Corridor — "Abandoned Infrastructure" crossed by "Signal Anomaly".
 * Industrial grating, rust, a chasm with a previous bridge lying in it; the
 * bridge itself exists only while the relay keeps it consistent.
 */
export const CORRIDOR_THEME: RoomTheme = {
  room: 'corridor',
  config: {
    themeId: 'abandoned-infrastructure/unstable-corridor',
    ambientIntensity: 0.24,
    fogDensity: 0.32,
    particleDensity: 0.7,
    colorPalette: hexes(MATERIAL.steelDark, MATERIAL.rust, MATERIAL.hazardYellow, SIGNAL.feed, SIGNAL.unstable, SIGNAL.hostile),
  },
  floor: 'grating',
  wallHeight: { back: 60, interior: 30, front: 8 },
  seed: 0x0b5e_0003,
  props: [
    { kind: 'pipeRun', face: 'alongX', from: 1, to: 9.6, height: 46, radius: 4.2, color: MATERIAL.rust },
    { kind: 'pipeRun', face: 'alongX', from: 16.2, to: 25, height: 46, radius: 4.2, color: MATERIAL.rust },
    { kind: 'pipeRun', face: 'alongX', from: 1, to: 25, height: 32, radius: 1.8, color: MATERIAL.steelLit },
    { kind: 'pipeRun', face: 'alongY', from: 1, to: 13, height: 40, radius: 2.6, color: MATERIAL.steelLit },
    { kind: 'plate', face: 'alongX', at: 3.0, height: 24, accent: SIGNAL.unstable, width: 4.2,
      lines: ['跨越段 R2 · 桥段 B-3', '承重由中继维持 · 勿在失稳时停留'] },
    { kind: 'plate', face: 'alongX', at: 17.6, height: 24, accent: SIGNAL.dormant, width: 3.6,
      lines: ['东岸 · 维护通道', '上次巡检 ———— · 结果：通过'] },
    { kind: 'plate', face: 'alongY', at: 9.2, height: 26, accent: SIGNAL.hostile, width: 3.4,
      lines: ['RLY-08 输出', '→ 桥承重 / 感知网'] },
    { kind: 'dock', at: { x: 5.5, y: 6.5 }, label: '巡检单元 坞站 03' },
    { kind: 'stencil', at: { x: 5.2, y: 11.6 }, text: '巡检路线 · 持续', size: 11, alpha: 0.2 },
    { kind: 'stencil', at: { x: 20.5, y: 5.0 }, text: 'E-SHORE', size: 15, alpha: 0.14 },
    { kind: 'plinth', at: { x: 8.5, y: 9.5 }, size: 0.42, height: 7 },
    { kind: 'plinth', at: { x: 18.5, y: 9.5 }, size: 0.36, height: 7 },
    { kind: 'hazardEdge', from: { x: 10, y: 1 }, to: { x: 10, y: 13 } },
    { kind: 'hazardEdge', from: { x: 16, y: 1 }, to: { x: 16, y: 13 } },
    { kind: 'emitter', at: { x: 10, y: 8 } },
    { kind: 'emitter', at: { x: 10, y: 11 } },
    { kind: 'emitter', at: { x: 16, y: 8 } },
    { kind: 'emitter', at: { x: 16, y: 11 } },
    { kind: 'wreck', at: { x: 12.6, y: 4.2 } },
    { kind: 'cableRun', points: [{ x: 8.5, y: 9.9 }, { x: 9.3, y: 10.6 }, { x: 9.9, y: 10.8 }], width: 2.4 },
    { kind: 'cableRun', points: [{ x: 8.3, y: 9.2 }, { x: 7.0, y: 7.8 }, { x: 5.9, y: 6.9 }], width: 1.6 },
    { kind: 'cableRun', points: [{ x: 16.1, y: 10.6 }, { x: 17.2, y: 10.2 }, { x: 18.3, y: 9.8 }], width: 2.4 },
    { kind: 'wear', points: [{ x: 2.5, y: 10.5 }, { x: 5.5, y: 10.0 }, { x: 8.5, y: 9.6 }, { x: 9.6, y: 9.5 }], radius: 0.5 },
    { kind: 'wear', points: [{ x: 16.4, y: 9.5 }, { x: 18.5, y: 9.5 }, { x: 22.5, y: 9.0 }], radius: 0.5 },
    { kind: 'grime', at: { x: 1.6, y: 1.6 }, radius: 1.6 },
    { kind: 'grime', at: { x: 23.6, y: 2.0 }, radius: 1.4 },
    { kind: 'grime', at: { x: 3.0, y: 12.2 }, radius: 1.0 },
  ],
  ambient: [
    { kind: 'flicker', at: { x: 6.5, y: 1.05 }, height: 52, color: SIGNAL.feedHi, pattern: '1', periodMs: 1000 },
    { kind: 'flicker', at: { x: 20.5, y: 1.05 }, height: 52, color: SIGNAL.feedHi, pattern: '11101100000011', periodMs: 2800 },
    { kind: 'blink', at: { x: 5.5, y: 6.5 }, height: 6, color: SIGNAL.unstable, periodMs: 2000, duty: 0.15 },
    { kind: 'abyssLight', at: { x: 12.2, y: 4.0 }, color: SIGNAL.unstable },
    { kind: 'abyssLight', at: { x: 13.6, y: 7.0 }, color: SIGNAL.feed },
    { kind: 'abyssLight', at: { x: 12.8, y: 10.0 }, color: SIGNAL.feed },
  ],
};

export const THEMES: Record<RoomId, RoomTheme> = { lab: LAB_THEME, corridor: CORRIDOR_THEME };
