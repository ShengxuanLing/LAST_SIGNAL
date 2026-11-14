// ART-02 Signal observer. Pure: diffs two consecutive READ-ONLY snapshots of
// the authoritative slice model into presentation events. It never calls the
// model, never mutates a snapshot and holds no gameplay state of its own.
import type { SliceSnapshot, DoorState } from '../slice/rules';
import type { BridgeState, RelayState } from '../slice/corridor';
import type { GuardSnapshot } from '../slice/corridorGuard';
import { ROOM } from '../slice/room';
import { CORRIDOR } from '../slice/corridorRoom';
import type { Pt } from './themes';

export type ScanHit = 'doorReceiver' | 'sealSource' | 'relay' | 'bridgePort' | 'perceptionPort';

export type SignalEvent =
  | { type: 'roomChanged'; room: 'lab' | 'corridor' }
  | { type: 'scan'; origin: Pt; hits: { id: ScanHit; at: Pt }[] }
  | { type: 'jam'; origin: Pt; target: 'doorReceiver' | 'relay' | 'guard'; at: Pt }
  | { type: 'door'; from: DoorState; to: DoorState }
  | { type: 'relay'; from: RelayState; to: RelayState }
  | { type: 'relaySwitch'; enabled: boolean; at: Pt }
  | { type: 'bridge'; from: BridgeState; to: BridgeState }
  | { type: 'guardBehavior'; from: GuardSnapshot['behavior']; to: GuardSnapshot['behavior']; at: Pt }
  | { type: 'guardHit'; at: Pt; cleared: boolean }
  | { type: 'playerHurt'; at: Pt; amount: number; rescued: boolean }
  | { type: 'revealExpired' };

export function playerPos(s: SliceSnapshot): Pt {
  return s.corridor ? { ...s.corridor.position } : { ...s.position };
}

function scanHits(s: SliceSnapshot): { id: ScanHit; at: Pt }[] {
  const hits: { id: ScanHit; at: Pt }[] = [];
  if (s.reveal?.sealSource) hits.push({ id: 'sealSource', at: { ...ROOM.source } });
  if (s.reveal?.doorReceiver) hits.push({ id: 'doorReceiver', at: { ...ROOM.receiver } });
  const r = s.corridorReveal;
  if (r?.relay) hits.push({ id: 'relay', at: { ...CORRIDOR.relay } });
  if (r?.bridge) hits.push({ id: 'bridgePort', at: { ...CORRIDOR.bridgePort } });
  if (r?.perceptionPort && s.corridor) hits.push({ id: 'perceptionPort', at: { ...s.corridor.guard.position } });
  return hits;
}

function nearestControl(p: Pt): Pt {
  const a = CORRIDOR.relay;
  const b = CORRIDOR.farControl;
  return Math.hypot(p.x - a.x, p.y - a.y) <= Math.hypot(p.x - b.x, p.y - b.y) ? { ...a } : { ...b };
}

/**
 * Derive presentation events from `prev -> cur`. `prev === null` means the
 * first frame (or after a restart) and only yields `roomChanged`.
 */
export function diffSnapshots(prev: SliceSnapshot | null, cur: SliceSnapshot): SignalEvent[] {
  const room = cur.corridor ? 'corridor' : 'lab';
  if (!prev) return [{ type: 'roomChanged', room }];
  const out: SignalEvent[] = [];
  const prevRoom = prev.corridor ? 'corridor' : 'lab';
  if (prevRoom !== room) {
    out.push({ type: 'roomChanged', room });
    return out;
  }
  // A restart rewinds the tick; treat as a fresh room without replaying effects.
  if (cur.tick < prev.tick) return [{ type: 'roomChanged', room }];

  const origin = playerPos(cur);
  // Scan: the reveal window is (re)armed only by a legal scan.
  if (cur.scanRevealTicks > prev.scanRevealTicks) {
    out.push({ type: 'scan', origin, hits: scanHits(cur) });
  } else if (prev.scanRevealTicks > 0 && cur.scanRevealTicks === 0) {
    out.push({ type: 'revealExpired' });
  }

  if (!cur.corridor) {
    if (cur.jamRemainingTicks > prev.jamRemainingTicks) {
      out.push({ type: 'jam', origin, target: 'doorReceiver', at: { ...ROOM.receiver } });
    }
    if (cur.doorState !== prev.doorState) out.push({ type: 'door', from: prev.doorState, to: cur.doorState });
    return out;
  }

  const c = cur.corridor;
  const p = prev.corridor!;
  if (c.relay === 'JAMMED' && p.relay !== 'JAMMED') {
    out.push({ type: 'jam', origin, target: 'relay', at: { ...CORRIDOR.relay } });
  }
  if (c.guard.jamRemainingTicks > p.guard.jamRemainingTicks) {
    out.push({ type: 'jam', origin, target: 'guard', at: { ...c.guard.position } });
  }
  if (c.manualEnabled !== p.manualEnabled) {
    out.push({ type: 'relaySwitch', enabled: c.manualEnabled, at: nearestControl(origin) });
  }
  if (c.relay !== p.relay) out.push({ type: 'relay', from: p.relay, to: c.relay });
  if (c.bridge !== p.bridge) out.push({ type: 'bridge', from: p.bridge, to: c.bridge });
  if (c.guardHp > 0 && c.guard.behavior !== p.guard.behavior) {
    out.push({ type: 'guardBehavior', from: p.guard.behavior, to: c.guard.behavior, at: { ...c.guard.position } });
  }
  if (c.guardHp < p.guardHp) out.push({ type: 'guardHit', at: { ...c.guard.position }, cleared: c.guardHp === 0 });
  if (c.hp < p.hp) {
    const jumped = Math.hypot(c.position.x - p.position.x, c.position.y - p.position.y) > 1;
    out.push({ type: 'playerHurt', at: { ...c.position }, amount: p.hp - c.hp, rescued: jumped });
  }
  return out;
}

/**
 * Remaining fraction of the scan reveal window in [0,1]. Presentation uses it
 * to show that observed information is ageing (the last 25% flickers).
 */
export function revealFreshness(s: SliceSnapshot, revealTicks: number): number {
  if (revealTicks <= 0) return 0;
  return Math.max(0, Math.min(1, s.scanRevealTicks / revealTicks));
}
