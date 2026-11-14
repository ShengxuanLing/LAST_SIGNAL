// ART-02 visual quality tiers. Pure (no Phaser) and Node-testable.
// Quality only changes presentation density; it never touches ticks, RNG,
// collision, damage or any authoritative state.

export type VisualQuality = 'off' | 'low' | 'medium' | 'high';

export interface QualityProfile {
  readonly id: VisualQuality;
  /** Hard cap on live pooled particles. */
  readonly maxParticles: number;
  /** Ambient dust motes kept alive in the room. */
  readonly ambientDust: number;
  /** Max simultaneous transient effects (rings, beams, pings). */
  readonly maxEffects: number;
  /** Additive light sprites (glow pools under devices). */
  readonly lights: boolean;
  /** Animated backdrop (rotating observation ring, beacons). */
  readonly backdropMotion: boolean;
  /** Camera micro-shake on hits (visual only). */
  readonly cameraFeedback: boolean;
  /** Bake decals / grime / wear marks into floors. */
  readonly decals: boolean;
  /** Number of procedural floor variants baked. */
  readonly floorVariants: number;
}

export const QUALITY: Record<VisualQuality, QualityProfile> = {
  off: {
    id: 'off', maxParticles: 0, ambientDust: 0, maxEffects: 0, lights: false,
    backdropMotion: false, cameraFeedback: false, decals: false, floorVariants: 0,
  },
  low: {
    id: 'low', maxParticles: 48, ambientDust: 10, maxEffects: 6, lights: false,
    backdropMotion: false, cameraFeedback: false, decals: false, floorVariants: 2,
  },
  medium: {
    id: 'medium', maxParticles: 140, ambientDust: 28, maxEffects: 12, lights: true,
    backdropMotion: true, cameraFeedback: true, decals: true, floorVariants: 4,
  },
  high: {
    id: 'high', maxParticles: 260, ambientDust: 48, maxEffects: 20, lights: true,
    backdropMotion: true, cameraFeedback: true, decals: true, floorVariants: 6,
  },
};

export const QUALITY_STORAGE_KEY = 'last_signal_art02_quality';
const VALID = new Set<VisualQuality>(['off', 'low', 'medium', 'high']);

export function isVisualQuality(v: unknown): v is VisualQuality {
  return typeof v === 'string' && VALID.has(v as VisualQuality);
}

/**
 * Resolve the starting tier: URL `?vq=` wins (explicit, disables auto-degrade),
 * then a stored per-browser preference, then `high` with auto-degrade allowed.
 */
export function resolveQuality(search: string, stored: string | null): { quality: VisualQuality; forced: boolean } {
  const param = new URLSearchParams(search).get('vq');
  if (isVisualQuality(param)) return { quality: param, forced: true };
  if (isVisualQuality(stored)) return { quality: stored, forced: false };
  return { quality: 'high', forced: false };
}

export function lowerTier(q: VisualQuality): VisualQuality {
  return q === 'high' ? 'medium' : q === 'medium' ? 'low' : q;
}

/**
 * Frame-time governor. Feeds real frame deltas; recommends stepping down one
 * tier when the rolling mean stays above budget for a full window. Never
 * steps up automatically (avoids oscillation) and never goes below `low`.
 */
export class FrameGovernor {
  private samples: number[] = [];
  private cooldown = 0;

  constructor(
    private readonly budgetMs = 24,
    private readonly window = 120,
  ) {}

  /** Returns true when the caller should degrade one tier. */
  push(deltaMs: number): boolean {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return false;
    // Ignore huge stalls (tab switch, debugger) — they are not render cost.
    if (deltaMs > 250) return false;
    if (this.cooldown > 0) { this.cooldown--; return false; }
    this.samples.push(deltaMs);
    if (this.samples.length < this.window) return false;
    const mean = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.samples = [];
    if (mean > this.budgetMs) {
      this.cooldown = this.window * 2;
      return true;
    }
    return false;
  }

  reset(): void {
    this.samples = [];
    this.cooldown = 0;
  }
}
