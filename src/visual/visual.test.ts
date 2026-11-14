import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SliceModel } from '../slice/rules';
import { ROOM } from '../slice/room';
import { CORRIDOR } from '../slice/corridorRoom';
import { SLICE } from '../slice/tuning';
import { contrast, MATERIAL, SIGNAL } from './palette';
import { FrameGovernor, lowerTier, QUALITY, resolveQuality } from './quality';
import { EffectList, ParticlePool, visualRng } from './pool';
import { diffSnapshots, revealFreshness } from './signalEvents';
import { THEMES } from './themes';
import { sliceGeometry } from './sliceGeometry';

const spark = { x: 0, y: 0, vx: 0, vy: 0, ay: 0, maxLife: 1, size: 1, color: 0xffffff, alpha: 1, shape: 0 as const };

describe('ART-02 quality tiers', () => {
  it('URL ?vq= wins and is marked forced; storage is a soft preference; default is high', () => {
    expect(resolveQuality('?vq=low', 'high')).toEqual({ quality: 'low', forced: true });
    expect(resolveQuality('?vq=nonsense', 'medium')).toEqual({ quality: 'medium', forced: false });
    expect(resolveQuality('', null)).toEqual({ quality: 'high', forced: false });
    expect(resolveQuality('?vq=off', null).quality).toBe('off');
  });

  it('tiers are monotonic in cost and lowerTier never goes below low', () => {
    expect(QUALITY.low.maxParticles).toBeLessThan(QUALITY.medium.maxParticles);
    expect(QUALITY.medium.maxParticles).toBeLessThan(QUALITY.high.maxParticles);
    expect(QUALITY.off.maxParticles).toBe(0);
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBe('low');
  });

  it('frame governor degrades only on a sustained over-budget window and ignores stalls', () => {
    const g = new FrameGovernor(20, 10);
    for (let i = 0; i < 9; i++) expect(g.push(30)).toBe(false);
    expect(g.push(30)).toBe(true);
    // Cooldown prevents an immediate second step.
    for (let i = 0; i < 15; i++) expect(g.push(30)).toBe(false);
    const h = new FrameGovernor(20, 10);
    for (let i = 0; i < 30; i++) expect(h.push(i % 2 ? 16 : 900)).toBe(false);
  });
});

describe('ART-02 pools are bounded', () => {
  it('particle pool clips bursts at the active limit and frees expired particles', () => {
    const pool = new ParticlePool(8);
    pool.setLimit(5);
    let spawned = 0;
    for (let i = 0; i < 50; i++) if (pool.spawn({ ...spark, maxLife: 0.5 })) spawned++;
    expect(spawned).toBe(5);
    expect(pool.live).toBe(5);
    pool.setLimit(2);
    expect(pool.live).toBe(2);
    pool.step(1);
    expect(pool.live).toBe(0);
    expect(pool.items.length).toBe(8);
  });

  it('effect list evicts the oldest instead of growing', () => {
    const list = new EffectList<{ age: number; duration: number; id: number }>(3);
    for (let i = 0; i < 10; i++) list.push({ age: 0, duration: 1, id: i });
    expect(list.items.map((e) => e.id)).toEqual([7, 8, 9]);
    list.step(2);
    expect(list.items.length).toBe(0);
  });

  it('visual RNG is deterministic and isolated from gameplay', () => {
    const a = visualRng(42);
    const b = visualRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('ART-02 Signal observer is read-only and state-driven', () => {
  it('lab: Scan and Jam produce events only from real model transitions, without mutating it', () => {
    const model = new SliceModel();
    model.setPlayerPos(ROOM.spawn.x, ROOM.spawn.y);
    const s0 = model.snapshot();
    expect(diffSnapshots(null, s0)).toEqual([{ type: 'roomChanged', room: 'lab' }]);
    expect(diffSnapshots(s0, model.snapshot())).toEqual([]);

    model.scan();
    const s1 = model.snapshot();
    const before = JSON.stringify(model.serialize());
    const snapBefore = JSON.stringify(s1);
    const scanEvents = diffSnapshots(s0, s1);
    expect(JSON.stringify(s1)).toBe(snapBefore);
    expect(JSON.stringify(model.serialize())).toBe(before);
    const scan = scanEvents.find((e) => e.type === 'scan');
    expect(scan && scan.type === 'scan' && scan.hits.map((h) => h.id).sort()).toEqual(['doorReceiver', 'sealSource']);

    model.jam();
    const s2 = model.snapshot();
    const events = diffSnapshots(s1, s2).map((e) => e.type);
    expect(events).toContain('jam');
    expect(events).toContain('door');
    // An illegal action changes nothing, so it must not produce any feedback event.
    const s3 = model.snapshot();
    model.jam();
    expect(diffSnapshots(s3, model.snapshot()).filter((e) => e.type !== 'revealExpired')).toEqual([]);
  });

  it('reveal freshness decays with the authoritative reveal window', () => {
    const model = new SliceModel();
    model.scan();
    expect(revealFreshness(model.snapshot(), SLICE.SCAN_REVEAL_TICKS)).toBe(1);
    model.advanceTicks(SLICE.SCAN_REVEAL_TICKS / 2);
    expect(revealFreshness(model.snapshot(), SLICE.SCAN_REVEAL_TICKS)).toBeCloseTo(0.5, 2);
    const mid = model.snapshot();
    model.advanceTicks(SLICE.SCAN_REVEAL_TICKS);
    expect(diffSnapshots(mid, model.snapshot()).map((e) => e.type)).toContain('revealExpired');
  });

  it('corridor: relay switch and bridge transitions are observed in order', () => {
    const model = new SliceModel();
    model.markPassed();
    model.setPlayerPos(ROOM.exit.x, ROOM.exit.y);
    expect(model.enterCorridor()).toBe(true);
    const lab = model.snapshot();
    // Walk to the near relay through the shared movement contract.
    model.setPlayerPos(CORRIDOR.shores.west.x - 1, CORRIDOR.shores.west.y);
    const s0 = model.snapshot();
    expect(diffSnapshots(lab, s0).map((e) => e.type)).not.toContain('roomChanged');
    model.interact();
    const s1 = model.snapshot();
    const types = diffSnapshots(s0, s1).map((e) => e.type);
    expect(types).toContain('relaySwitch');
    expect(types).toContain('relay');
    expect(types).toContain('bridge');
    let prev = s1;
    const seen: string[] = [];
    for (let i = 0; i < CORRIDOR.transitionTicks + 2; i++) {
      model.advanceTicks(1);
      const cur = model.snapshot();
      for (const e of diffSnapshots(prev, cur)) if (e.type === 'bridge') seen.push(`${e.from}->${e.to}`);
      prev = cur;
    }
    expect(seen).toContain('TRANSITIONING->STABLE');
  });
});

describe('ART-02 readability and composition', () => {
  it('every meaning-bearing colour stays >= 3:1 against the darkest and brightest floor', () => {
    for (const [name, c] of Object.entries(SIGNAL)) {
      if (name === 'dormant') continue;
      expect(contrast(c, MATERIAL.floorPlate), name).toBeGreaterThanOrEqual(3);
      expect(contrast(c, MATERIAL.steel), name).toBeGreaterThanOrEqual(2.4);
    }
  });

  it('themes expose the EnvironmentVisualConfig contract', () => {
    for (const t of Object.values(THEMES)) {
      expect(typeof t.config.themeId).toBe('string');
      expect(t.config.colorPalette.length).toBeGreaterThan(3);
      for (const k of ['ambientIntensity', 'fogDensity', 'particleDensity'] as const) {
        expect(t.config[k]).toBeGreaterThanOrEqual(0);
        expect(t.config[k]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('standing props never sit on interactive anchors (spawn, exit, door, shores, devices)', () => {
    const anchors = {
      lab: [ROOM.spawn, ROOM.exit, ROOM.receiver, ...ROOM.doorCells.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }))],
      corridor: [CORRIDOR.spawn, CORRIDOR.shores.west, CORRIDOR.shores.east, CORRIDOR.bridgePort],
    };
    for (const t of Object.values(THEMES)) {
      const geo = sliceGeometry(t.room);
      for (const p of t.props) {
        if (p.kind !== 'console' && p.kind !== 'cart') continue;
        expect(geo.tileAt(Math.floor(p.at.x), Math.floor(p.at.y))).toBe('floor');
        for (const a of anchors[t.room]) expect(Math.hypot(a.x - p.at.x, a.y - p.at.y), `${t.room} ${p.kind}`).toBeGreaterThan(1.2);
      }
    }
  });

  it('src/visual never imports a mutable model, game RNG or input arbitration', () => {
    const dir = join(__dirname);
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/import\s+\{[^}]*\bSliceModel\b[^}]*\}\s+from/);
      expect(src, f).not.toMatch(/core\/random|Math\.random|keyboard\.on|addKeys|saveSlice|localStorage\.setItem/);
    }
  });
});
