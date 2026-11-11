import { GAME } from '../config/game';
import { WEAPONS } from '../config/weapons';
import type { Cell } from './room';
import { SLICE } from './tuning';
import { CorridorGuard, type GuardSnapshot } from './corridorGuard';
import {
  CORRIDOR, canStandInCorridor, corridorLineOfSight, nearControl,
  occupiesBridge, shoreOf, validateCorridorTemplate, type Shore,
} from './corridorRoom';

export type RelayState = 'ACTIVE' | 'INACTIVE' | 'JAMMED' | 'DISABLED';
export type BridgeState = 'UNAVAILABLE' | 'TRANSITIONING' | 'STABLE' | 'UNSTABLE' | 'DISABLED';

export interface CorridorReveal {
  relay: boolean;
  bridge: boolean;
  perceptionPort: boolean;
}

/** Consumers receive one immutable post-commit reading, independent of callback order. */
export interface CorridorSignal {
  readonly manualEnabled: boolean;
  readonly powered: boolean;
  readonly relay: RelayState;
  readonly effectiveOutput: boolean;
  readonly bridgeFeed: boolean;
  readonly perceptionFeed: boolean;
  readonly bridge: BridgeState;
  readonly bridgePassable: boolean;
  readonly deadline: number;
}

export interface CorridorCheckpoint {
  template: typeof CORRIDOR.template;
  position: Cell;
  hp: number;
  relayEnabled: boolean;
  powered: boolean;
  bridge: 'STABLE' | 'UNAVAILABLE';
  guardCleared: true;
  crossed: boolean;
  jamRemaining: number;
  scanRemaining: number;
  reveal: CorridorReveal | null;
}

export interface CorridorSnapshot extends CorridorSignal {
  position: Cell;
  hp: number;
  guardHp: number;
  guard: GuardSnapshot;
  crossed: boolean;
  crossedAtTick: number | null;
  canInteract: boolean;
  bridgeRemainingTicks: number;
  lastShore: Shore;
  onBridge: boolean;
}

const PULSE = WEAPONS.pulse;
const TEMPLATE_VALID = validateCorridorTemplate();

function relayState(manualEnabled: boolean, powered: boolean, jammed: boolean, disposed: boolean): RelayState {
  if (disposed) return 'DISABLED';
  if (jammed) return 'JAMMED';
  return manualEnabled && powered ? 'ACTIVE' : 'INACTIVE';
}

function nextBridge(
  previous: CorridorSignal, output: boolean, tick: number,
): Pick<CorridorSignal, 'bridge' | 'deadline'> {
  switch (previous.bridge) {
    case 'UNAVAILABLE':
      return output
        ? { bridge: 'TRANSITIONING', deadline: tick + CORRIDOR.transitionTicks }
        : { bridge: 'UNAVAILABLE', deadline: 0 };
    case 'TRANSITIONING':
      if (!output) return { bridge: 'UNAVAILABLE', deadline: 0 };
      if (tick >= previous.deadline) return { bridge: 'STABLE', deadline: 0 };
      break;
    case 'STABLE':
      return output
        ? { bridge: 'STABLE', deadline: 0 }
        : { bridge: 'UNSTABLE', deadline: tick + CORRIDOR.transitionTicks };
    case 'UNSTABLE':
      if (output) return { bridge: 'STABLE', deadline: 0 };
      if (tick >= previous.deadline) return { bridge: 'UNAVAILABLE', deadline: 0 };
      break;
    case 'DISABLED':
      return { bridge: 'DISABLED', deadline: 0 };
  }
  return { bridge: previous.bridge, deadline: previous.deadline };
}

function reading(
  manualEnabled: boolean, powered: boolean, relay: RelayState, bridge: BridgeState, deadline: number,
): CorridorSignal {
  const effectiveOutput = relay === 'ACTIVE';
  return Object.freeze({
    manualEnabled, powered, relay, effectiveOutput,
    bridgeFeed: effectiveOutput,
    perceptionFeed: effectiveOutput,
    bridge, bridgePassable: bridge === 'STABLE' || bridge === 'UNSTABLE', deadline,
  });
}

export class Corridor {
  private signal: CorridorSignal;
  private readonly listeners = new Set<(signal: CorridorSignal) => void>();
  private disposed = false;
  private publishing = false;
  private location: Cell;
  private lastShore: Shore;
  private health: number;
  private readonly guard: CorridorGuard;
  private crossedFlag: boolean;
  private crossedAtTick: number | null = null;
  private nextShotTick = 0;

  constructor(checkpoint?: CorridorCheckpoint) {
    if (!TEMPLATE_VALID) throw new Error('E_NO_FAR_SHORE');
    this.location = { ...(checkpoint?.position ?? CORRIDOR.spawn) };
    this.lastShore = shoreOf(this.location);
    this.health = checkpoint?.hp ?? CORRIDOR.maxHp;
    this.guard = new CorridorGuard(checkpoint?.guardCleared ?? false);
    this.crossedFlag = checkpoint?.crossed ?? false;
    const enabled = checkpoint?.relayEnabled ?? false;
    const powered = checkpoint?.powered ?? true;
    this.signal = reading(
      enabled, powered, relayState(enabled, powered, (checkpoint?.jamRemaining ?? 0) > 0, false),
      checkpoint?.bridge ?? 'UNAVAILABLE', 0,
    );
  }

  get position(): Cell { return { ...this.location }; }
  get alive(): boolean { return this.health > 0; }
  get crossed(): boolean { return this.crossedFlag; }
  get canSave(): boolean {
    return this.alive && this.guard.hp === 0 && !occupiesBridge(this.location) &&
      (this.signal.bridge === 'STABLE' || this.signal.bridge === 'UNAVAILABLE');
  }

  canStand(x: number, y: number): boolean {
    return canStandInCorridor(x, y, this.signal.bridgePassable);
  }

  moveTo(x: number, y: number): void {
    if (this.disposed || this.publishing || !this.alive || !this.canStand(x, y)) return;
    this.location = { x, y };
    if (!occupiesBridge(this.location)) this.lastShore = shoreOf(this.location);
  }

  canInteract(): boolean {
    return !this.disposed && this.alive && nearControl(this.location, this.signal.bridgePassable);
  }

  canJam(): boolean {
    return !this.disposed && this.alive && this.inRange(CORRIDOR.relay, SLICE.JAM_RANGE);
  }

  canJamGuard(): boolean {
    return !this.disposed && !this.publishing && this.alive && this.guard.hp > 0 &&
      this.inRange(this.guard.position, SLICE.JAM_RANGE);
  }

  isGuardJammed(tick: number): boolean { return this.guard.isJammed(tick); }

  jamGuard(tick: number): void {
    if (this.canJamGuard() && !this.isGuardJammed(tick)) this.guard.jam(tick);
  }

  scan(): CorridorReveal {
    const relay = this.inRange(CORRIDOR.relay, SLICE.SCAN_RADIUS);
    return {
      relay,
      bridge: this.inRange(CORRIDOR.bridgePort, SLICE.SCAN_RADIUS),
      perceptionPort: this.inRange(this.guard.position, SLICE.SCAN_RADIUS),
    };
  }

  shoot(tick: number): 'hit' | 'cleared' | 'cooldown' | 'unavailable' {
    if (this.disposed || this.publishing || !this.alive || this.guard.hp === 0 ||
        !this.inRange(this.guard.position, PULSE.baseRange / GAME.PIXEL_TO_TILE)) return 'unavailable';
    if (tick < this.nextShotTick) return 'cooldown';
    this.nextShotTick = tick + Math.ceil(SLICE.TICK_HZ / PULSE.baseRate);
    this.guard.takeHit(PULSE.baseDamage);
    return this.guard.hp === 0 ? 'cleared' : 'hit';
  }

  setEnabled(enabled: boolean, tick: number, jammed: boolean): void {
    this.resolve(tick, jammed, enabled, this.signal.powered);
  }

  toggle(tick: number, jammed: boolean): void {
    this.setEnabled(!this.signal.manualEnabled, tick, jammed);
  }

  setPowered(powered: boolean, tick: number, jammed: boolean): void {
    this.resolve(tick, jammed, this.signal.manualEnabled, powered);
  }

  setJammed(tick: number, jammed: boolean): void {
    this.resolve(tick, jammed, this.signal.manualEnabled, this.signal.powered);
  }

  advance(tick: number, jammed: boolean): Shore | null {
    if (this.disposed || this.publishing || !this.alive) return null;
    const rescued = this.resolve(tick, jammed, this.signal.manualEnabled, this.signal.powered);
    if (!this.alive) return rescued;
    const { perceptionFeed, bridgePassable } = this.signal;
    const damage = this.guard.advance(tick, this.location, perceptionFeed, bridgePassable);
    this.health = Math.max(0, this.health - damage);
    const exit = CORRIDOR.shores.east;
    if (!this.crossed && this.alive && this.signal.bridge === 'STABLE' &&
        this.location.x >= exit.x && Math.hypot(this.location.x - exit.x, this.location.y - exit.y) < 0.45) {
      this.crossedFlag = true;
      this.crossedAtTick = tick;
    }
    return rescued;
  }

  subscribe(listener: (signal: CorridorSignal) => void): () => void {
    if (!this.disposed) this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    if (this.publishing) return;
    this.disposed = true;
    this.listeners.clear();
    this.signal = reading(this.signal.manualEnabled, this.signal.powered, 'DISABLED', 'DISABLED', 0);
  }

  snapshot(tick: number): CorridorSnapshot {
    return {
      ...this.signal, position: this.position, hp: this.health, guardHp: this.guard.hp,
      guard: this.guard.snapshot(tick, this.signal.perceptionFeed),
      crossed: this.crossed, crossedAtTick: this.crossedAtTick, canInteract: this.canInteract(), lastShore: this.lastShore,
      bridgeRemainingTicks: Math.max(0, this.signal.deadline - tick),
      onBridge: occupiesBridge(this.location),
    };
  }

  capture(jamRemaining: number, scanRemaining: number, reveal: CorridorReveal | null): CorridorCheckpoint | null {
    const { manualEnabled, powered, bridge } = this.signal;
    if (!this.canSave || (bridge !== 'UNAVAILABLE' && bridge !== 'STABLE')) return null;
    return {
      template: CORRIDOR.template, position: this.position, hp: this.health, relayEnabled: manualEnabled,
      powered, bridge, crossed: this.crossed, guardCleared: true, jamRemaining, scanRemaining,
      reveal: scanRemaining > 0 && reveal ? { ...reveal } : null,
    };
  }

  private inRange(target: Cell, radius: number): boolean {
    return Math.hypot(this.location.x - target.x, this.location.y - target.y) < radius &&
      corridorLineOfSight(this.location, target, this.signal.bridgePassable);
  }

  private resolve(tick: number, jammed: boolean, enabled: boolean, powered: boolean): Shore | null {
    if (this.disposed || this.publishing || !this.alive) return null;
    const previous = this.signal;
    const relay = relayState(enabled, powered, jammed, this.disposed);
    const { bridge, deadline } = nextBridge(previous, relay === 'ACTIVE', tick);
    if (previous.relay === relay && previous.bridge === bridge && previous.deadline === deadline &&
        previous.manualEnabled === enabled && previous.powered === powered) return null;

    let rescued: Shore | null = null;
    if (previous.bridge === 'UNSTABLE' && bridge === 'UNAVAILABLE' && occupiesBridge(this.location)) {
      rescued = this.lastShore;
      this.location = { ...CORRIDOR.shores[rescued] };
      this.health = Math.max(0, this.health - CORRIDOR.dangerHp);
    }
    const committed = reading(enabled, powered, relay, bridge, deadline);
    this.signal = committed;
    this.publishing = true;
    try {
      for (const listener of [...this.listeners]) {
        try { listener(committed); }
        catch (error) { console.error('Corridor signal subscriber failed', error); }
      }
    } finally {
      this.publishing = false;
    }
    return rescued;
  }
}
