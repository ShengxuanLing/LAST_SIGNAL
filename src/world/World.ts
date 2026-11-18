import Phaser from 'phaser';
import { MapData, Tile, Vec2, ProjectileData, LootDrop, EnemyStateName, Room } from '../types';
import { ENEMY_STATS, EnemyKind } from '../config/enemies';
import { GAME } from '../config/game';
import { PURCHASE_LEDGER_CAP } from '../config/supplies';
import { ItemKind } from '../types';
import { IsoMath, isoToScreen, screenToIso } from '../core/iso';
import { RNG } from '../core/random';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Boss } from '../entities/Boss';
import { RoomDepth } from '../world/roomdepth';
import { WorldRenderer } from '../world/WorldRenderer';
import type { PlayerData, RunCheckpoint, SaveData } from '../types';
import { audio } from '../systems/AudioSystem';
import type { ControllerActorView, LocalControllerView } from '../ai-native/localController';
import { buildWorldObservation, type WorldObservationV1 } from '../ai-native/worldObservation';
import { WORLD_PERCEPTION, createLocalProbe, gridLineOfSight } from '../ai-native/worldPerception';
import { cloneCheckpoint } from '../systems/RunCheckpoint';
import { chooseNearestActor, type ActorCombatPort, type ActorTargetView } from './actorTarget';
import { buildEchoObservation, type EchoObservation } from './echoView';
import { SIGNAL_TUNING } from '../signal/signalTuning';
import { ExternalLinkState, type ExternalActionReceipt } from '../ai-native/externalLink';
import { EchoController, ECHO_LIMITS, type EchoMode, type EchoLocalProposal, type EchoView } from '../ai-native/echo';
import { EchoAuditRing } from '../ai-native/echoAudit';
import type { PlayerIntent } from '../ai-native/control';
import {
  createSimulationState, ECHO_ACTOR_ID, enqueueCommand, enqueueEchoHit, enqueuePlayerHit, isWalkableFromState,
  enqueueTargetHp as enqueueCoreTargetHp, enqueueTargetMove as enqueueCoreTargetMove, ensureWalkableFromState, processCommands,
  registerDrone, registerTarget,
  spawnEnemyProjectile as spawnCoreEnemyProjectile, stepSimulationTicks, SIM_TUNING,
  type SimulationIntent, type SimulationState, type SimCommand, type SimEchoState, type SimEvent, type SimLootKind, type SimProjectile, type SimTarget
} from './sim/core';
import { CombatVfx, BOLT_HEIGHT, type BoltView, type TelegraphView } from '../art/survey/CombatVfx';
import { CSS, DEPTH, FONT, INK } from '../art/survey/tokens';
import { deckLabel, dungeonRng, encounter, TOTAL_DECKS } from '../config/dungeon';
import { P1_DEMO_ID, buildP1Scenario, p1RouteFor, type P1Scenario } from '../config/p1Scenario';
import { routeTargetFor } from '../signal/relay';

export interface WorldCallbacks {
  onLevelUp: (level: number) => void;
  onDeath: () => void;
  onRoomCleared: (room: RoomInfo) => void;
  onRoomEntered: (room: RoomInfo) => void;
  onLoot: (drop: LootDrop) => void;
  onStats: (delta: { enemies: number; items: number; dmg: number }) => void;
  onBossWin: () => void;
  onNextDeck: () => void;
  /** A committed Signal relay/command change (checkpoint-dirty hint). */
  onSignalChanged?: () => void;
}

export interface RoomInfo {
  id: number; kind: string; gx: number; gy: number; w: number; h: number;
}

export class World {
  scene: Phaser.Scene;
  map: MapData;
  player: Player;
  enemies: Enemy[] = [];
  /** C2: first-slice authority for player/drone/core projectiles. */
  private _sim!: SimulationState;
  private simVersion = 0;
  private simSnapshotCache: SimulationState | null = null;
  private playerDataSnapshotCache: any = null;
  private simAccumulatorMs = 0;
  private coreProjectileViews = new Map<number, { spr: Phaser.GameObjects.Sprite; data: SimProjectile }>();

  /**
   * Read-only compatibility view for old regressions. It returns fresh copies of
   * core projectile data; callers cannot mutate authoritative projectiles.
   * The setter is intentionally non-authoritative (legacy test cleanup only);
   * use resetProjectilesForTest() for an explicit dev reset.
   */
  get projectiles(): Array<{ spr: Phaser.GameObjects.Sprite; data: any }> {
    return [...this.coreProjectileViews.values()].map((view) => ({
      spr: view.spr,
      data: {
        ...view.data, pos: { ...view.data.pos }, vel: { ...view.data.vel },
        hitIds: [...view.data.hitIds], hitSet: new Set(view.data.hitIds)
      }
    }));
  }
  set projectiles(_value: Array<{ spr: Phaser.GameObjects.Sprite; data: any }>) {
    // Compatibility setter must not clear or expose authoritative core state.
  }

  private static assertDevTest(): void {
    // Build-time constant: production builds cannot enable this facade.
    if (!__LAST_SIGNAL_DEV_TEST__) throw new Error('dev/test only');
  }

  /** Explicit dev/test reset; not a general scene API. */
  resetProjectilesForTest(): void {
    World.assertDevTest();
    // P3-a fix: a restore may NEVER inherit an old assist confirmation, mode,
    // memory or pending intent. Echo HP comes verbatim from the checkpoint.
    this.echoController.reset();
    this.resetEchoCooperationRuntime();
    this.echoShotsFired = 0;
    for (const view of this.coreProjectileViews.values()) if (view.spr.scene) view.spr.destroy();
    this.coreProjectileViews.clear();
    if (this._sim) this._sim.projectiles = [];
  }

  /** Read-only loot view over core loot; external code cannot clear core state. */
  get loot(): Array<{ spr: Phaser.GameObjects.Sprite; data: LootDrop }> {
    return [...this.coreLootViews.values()];
  }
  set loot(_value: Array<{ spr: Phaser.GameObjects.Sprite; data: LootDrop }>) {
    // Compatibility setter is intentionally non-authoritative.
  }

  setPlayerPositionForTest(x: number, y: number): void {
    World.assertDevTest();
    this._sim.player.x = x;
    this._sim.player.y = y;
    this.bumpSimVersion();
  }

  clearLootForTest(): void {
    World.assertDevTest();
    for (const view of this.coreLootViews.values()) if (view.spr.scene) view.spr.destroy();
    this.coreLootViews.clear();
    this._sim.loot = [];
    this.bumpSimVersion();
  }

  /** Explicit dev/test enemy cleanup; keeps adapter and core in sync. */
  clearEnemiesForTest(): void {
    World.assertDevTest();
    for (const e of this.enemies) if (e.sprite.scene) e.sprite.destroy();
    this.enemies = [];
    if (this._sim) {
      this._sim.drones = [];
      this._sim.targets = [];
    }
    if (this.boss) {
      if (this.boss.sprite.scene) this.boss.sprite.destroy();
      this.boss = null;
    }
  }
  private coreLootViews = new Map<number, { spr: Phaser.GameObjects.Sprite; data: LootDrop }>();
  /** AR-02 visual-only combat effects (reads state, never writes it). */
  vfx: CombatVfx;
  private damageStack = new Map<number, { t: number; n: number }>();
  shakeAmount = 0;
  clock = 0;

  private roomDepth = new RoomDepth();
  private callbacks: WorldCallbacks;
  private rng: RNG;
  private enemyIdCounter = 1;
  private worldSpawns: Array<{ kind: EnemyKind; x: number; y: number; room: number; depth: number; boss?: Room }> = [];
  /** Rooms whose generation command/spawn is queued but not yet committed. */
  private pendingRoomEnters = new Set<number>();
  /** C3-b: external agent link state (authorization, pending intents, receipts). */
  readonly externalLink = new ExternalLinkState();
  /** P3-a: pure echo intent policy (no Phaser; shared with the Node parity driver). */
  readonly echoController = new EchoController();
  /** Bounded human-local/owner-external audit ring; never read by the policy. */
  readonly echoAudit = new EchoAuditRing();
  /** Real committed echo shots (observability only; no hidden state). */
  echoShotsFired = 0;
  /** One Owner-confirmed companion intent, committed by the next core tick. */
  private pendingCompanionIntent: SimulationIntent | null = null;
  /** Saved low-risk ECHO cooperation consent (default false). */
  private echoCooperationOptIn = false;
  /** Bumped on every committed room change; bounds local proposals/memory. */
  private echoRoomGeneration = 0;
  /** A human-local/owner-external signal command awaiting its real core result. */
  private pendingLocalSignal: { kind: 'scan' | 'jam' | 'toggle-relay'; target: { x: number; y: number } | null; tick: number; provenance: 'human-local' | 'owner-external'; proposalId?: string } | null = null;
  /** The single in-flight human-local action; blocks a second confirm until a real receipt/cancel. */
  private pendingLocalAction: {
    proposalId: string;
    acceptedTick: number;
    kind: 'scan' | 'jam' | 'toggle-relay';
    target: { x: number; y: number } | null;
    roomGeneration: number;
    originRoomId: number;
    command: SimCommand | null;
  } | null = null;
  /** Exact command just queued by enqueueSignalCommand (for lifecycle cancel). */
  private lastEnqueuedSignalCommand: SimCommand | null = null;
  private echoSprite: Phaser.GameObjects.Container | null = null;
  private echoLine: Phaser.GameObjects.Graphics | null = null;
  private signalSprite: Phaser.GameObjects.Container | null = null;
  private signalLine: Phaser.GameObjects.Graphics | null = null;
  /** Latest committed supply receipts, keyed by transaction id (session-only). */
  private supplyReceipts = new Map<string, { transactionId: string; offerKey: string; roomId: number; ok: boolean; reason?: string; price: number; currency: number; hp: number; weaponKey: string }>();
  private roomClearedHandlers: Array<(r: RoomInfo) => void> = [];
  private currentRoomId = -1;
  /** Public read-only room id (the same value the renderer/tests read). */
  get roomIdValue(): number { return this.currentRoomId; }
  private enteredRooms = new Set<number>();
  public renderer: WorldRenderer | null = null;
  private _minX = 0;
  private _minY = 0;
  private _maxX = 0;
  private _maxY = 0;
  private portal: { spr: Phaser.GameObjects.Sprite; targetRoom: number | null; wx: number; wy: number } | null = null;
  private waves: EnemyKind[][] = [];
  private activeWave = 0;
  private roomSeal?: Phaser.GameObjects.Graphics;
  /** ONE real Relay device per run. Spawned on first room enter only when the
   *  human has explicitly opted into Signal Collaboration; absent = legacy
   *  v1 run (portal always open). */
  private signalDeviceSpawned = false;
  /** Explicit human opt-in to Signal Collaboration (from save data). Ordinary
   *  NEW RUNS stay legacy (no device, no gating) until enabled in-game. */
  private signalCollaborationOptIn = false;
  /** GAMEPLAY-01 P1 authored Demo-01 scenario. null for every normal run. */
  p1Scenario: P1Scenario | null = null;
  /** Set when the authored scene cannot be assembled (explicit visible failure). */
  p1ScenarioError: string | null = null;
  /** Sentinel -1 so the FIRST computed target (including null) is always applied. */
  private lastP1RouteTarget: number | null = -1;
  /** Last committed scan/jam result for honest HUD feedback. */
  lastSignalFeedback: { kind: 'scan' | 'jam'; ok: boolean; code?: string; tick: number } | null = null;

  /** Deep, frozen read-only snapshot. External adapters must never mutate this. */
  get sim(): SimulationState {
    if (!this.simSnapshotCache) {
      this.simSnapshotCache = deepFreeze(JSON.parse(JSON.stringify(this._sim)) as SimulationState);
    }
    return this.simSnapshotCache;
  }

  /** Explicit dev/test fixture access to live core state; production throws. */
  get simFixture(): SimulationState {
    World.assertDevTest();
    this.bumpSimVersion();
    return this._sim;
  }

  /** Explicit dev/test fixture access to live player data; production throws. */
  get playerDataFixture(): any {
    World.assertDevTest();
    this.bumpSimVersion();
    return this._sim.player.data;
  }

  /** Deep, frozen player data snapshot for HUD/read-only adapters. */
  get playerDataSnapshot(): any {
    if (!this.playerDataSnapshotCache) {
      this.playerDataSnapshotCache = deepFreeze(JSON.parse(JSON.stringify(this._sim.player.data)));
    }
    return this.playerDataSnapshotCache;
  }

  get hasSimulation(): boolean { return !!this._sim; }

  /**
   * C3-b: queue an external agent intent. It becomes a legal PlayerIntent and
   * is executed by the existing core tick — never a direct state write.
   * Returns the receipt: 'queued' means it will be applied by a later tick.
   */
  enqueueExternalIntent(command: {
    actionId: string;
    requestId: string;
    intent: PlayerIntent;
    applyByTick: number;
    ttlTicks: number;
    /** Integer REAL core ticks the intent must be delivered for. */
    durationTicks?: number;
  }): ExternalActionReceipt {
    return this.externalLink.enqueueIntent(command, this._sim.tick);
  }

  /**
   * The intent the CURRENT rendered frame must run for the external owner.
   * Only an ACTIVE execution (started and bound to an epoch by the controller)
   * supplies an intent; a merely queued action never runs early.
   */
  takeExternalIntent(): PlayerIntent {
    return this.externalLink.activeIntent()
      ?? { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  }

  /** Read-only legal perception predicate (same crop as the player's view). */
  isPerceivablePosition(x: number, y: number): boolean {
    return this.isPerceivable(x, y);
  }

  // ---------- P3-a echo companion ----------

  get echoActor(): SimEchoState | null { return this._sim?.echo ?? null; }
  get echoMode(): EchoMode { return this.echoController.mode; }
  get echoSuggestion(): 'fire' | null { return this.echoController.suggestion; }
  get echoAssistArmed(): boolean { return this.echoController.assistConfirmed; }

  /**
   * The echo's OWN bounded perception: centred on the echo, 12 tiles, explored
   * rooms and line of sight. It never reuses the player's crop or full map.
   */
  echoView(): EchoObservation | null {
    const echo = this._sim.echo;
    if (!echo) return null;
    const signal = this._sim.signal;
    const echoAccount = signal?.actors.echo;
    return buildEchoObservation({
      echo,
      player: { x: this._sim.player.x, y: this._sim.player.y },
      tick: this._sim.tick,
      drones: this._sim.drones.map((drone) => ({ id: drone.id, x: drone.x, y: drone.y, hp: drone.hp })),
      targets: this._sim.targets.map((target) => ({
        id: target.id, kind: target.kind, x: target.x, y: target.y, hp: target.hp, isBoss: target.isBoss
      })),
      isExplored: (x, y) => this.isExploredCell(x, y),
      isOpaque: (x, y) => this.isOpaqueCell(x, y),
      // Echo-only Signal knowledge: the builder itself decides whether the
      // echo currently perceives the device (no player-side leak).
      signal: signal
        ? {
            deviceId: signal.deviceId, x: signal.x, y: signal.y, relay: signal.relay,
            powered: signal.powered, manualEnabled: signal.manualEnabled,
            jammedUntilTick: signal.jammedUntilTick
          }
        : null,
      energy: echoAccount
        ? { current: echoAccount.energy.energy, max: SIGNAL_TUNING.ENERGY_MAX }
        : undefined,
      cooldowns: echoAccount
        ? { scanTicks: echoAccount.cooldowns.scanCooldownTicks, jamTicks: echoAccount.cooldowns.jamCooldownTicks }
        : undefined
    });
  }

  /**
   * The echo policy view: the same legal observation plus a bounded `canWalk`
   * probe (restricted to the echo's perception/explored/LOS) and the saved
   * low-risk switch. It is NOT the serialized observation DTO.
   */
  echoPolicyView(): EchoView | null {
    const view = this.echoView();
    const echo = this._sim.echo;
    if (!view || !echo) return null;
    const canWalk = (x: number, y: number): boolean => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      if (Math.hypot(x - echo.x, y - echo.y) >= ECHO_LIMITS.perceptionTiles) return false;
      if (!this.isExploredCell(x, y)) return false;
      if (!this.isWalkable(x, y, 0.5)) return false;
      return gridLineOfSight({ x, y }, {
        center: { x: echo.x, y: echo.y },
        radiusTiles: ECHO_LIMITS.perceptionTiles,
        isExplored: (sx, sy) => this.isExploredCell(sx, sy),
        isOpaque: (sx, sy) => this.isOpaqueCell(sx, sy),
        stepTiles: WORLD_PERCEPTION.losStepTiles
      });
    };
    return {
      ...view,
      canWalk,
      autonomyEnabled: this.echoCooperationOptIn,
      roomGeneration: this.echoRoomGeneration
    };
  }

  get echoCooperation(): boolean { return this.echoCooperationOptIn; }

  /** Human low-risk switch. OFF clears autonomous movement, never the manual mode.
   *  AI/external ownership is read-only for this human preference. */
  setEchoCooperationOptIn(enabled: boolean): boolean {
    if (this.player.control.owner !== 'human') return false;
    this.echoCooperationOptIn = !!enabled;
    this.echoController.setAutonomy(this.echoCooperationOptIn);
    return true;
  }

  get echoLocalProposal(): EchoLocalProposal | null {
    return this.pendingLocalAction ? null : this.echoController.localProposal;
  }

  /** The single in-flight human-local action (same id shown as WAITING in UI). */
  get echoPendingLocal(): { proposalId: string; kind: 'scan' | 'jam' | 'toggle-relay'; target: { x: number; y: number } | null; acceptedTick: number; roomGeneration: number } | null {
    const pending = this.pendingLocalAction;
    if (!pending) return null;
    return {
      proposalId: pending.proposalId, kind: pending.kind,
      target: pending.target ? { ...pending.target } : null,
      acceptedTick: pending.acceptedTick, roomGeneration: pending.roomGeneration
    };
  }

  /** Generate the current local proposal (non-executing). */
  proposeLocalEcho(): EchoLocalProposal | null {
    const view = this.echoPolicyView();
    return view ? this.echoController.propose(view) : null;
  }

  /**
   * Minimal human-local confirmation boundary. The UI must call this instead of
   * `enqueueCompanionAction`. It validates the real echo/owner/id/expiry/room/
   * target legality, takes originRoomId at confirmation, enqueues for the next
   * tick, and is the only setter of provenance 'human-local'.
   */
  confirmLocalEchoProposal(id: string): boolean {
    const echo = this._sim.echo;
    const tick = this._sim.tick;
    // Exactly one in-flight human confirmation. A second confirm (UI or direct
    // boundary call) must not enqueue, overwrite the pending record or touch the
    // existing core command. An unsettled signal command from either path also
    // blocks a new local confirmation so receipts stay attributable.
    if (this.pendingLocalAction || this.pendingLocalSignal) {
      this.echoAudit.record({
        tick, provenance: 'human-local', action: 'local-confirm', target: null,
        result: 'rejected', code: 'E_ALREADY_PENDING', proposalId: id
      });
      return false;
    }
    if (!echo || echo.data.hp <= 0) {
      this.echoAudit.record({ tick, provenance: 'human-local', action: 'local-confirm', target: null, result: 'rejected', code: 'E_ECHO_UNAVAILABLE', proposalId: id });
      return false;
    }
    const ownerHuman = this.player.control.owner === 'human';
    const validation = this.echoController.validateLocalProposal(id, tick, this.echoRoomGeneration, ownerHuman);
    if (!validation.ok) {
      this.echoAudit.record({ tick, provenance: 'human-local', action: 'local-confirm', target: null, result: 'rejected', code: validation.code, proposalId: id });
      return false;
    }
    const proposal = this.echoController.localProposal;
    if (!proposal) return false;
    if (!this.localProposalTargetLegal(proposal)) {
      this.echoAudit.record({ tick, provenance: 'human-local', action: proposal.kind, target: proposal.target, result: 'rejected', code: 'E_TARGET_NOT_LEGAL', proposalId: id });
      this.echoController.rejectLocalProposal(id, tick);
      return false;
    }
    // originRoomId is captured at confirmation, never cached in the proposal.
    const originRoomId = this.roomIdValue;
    this.lastEnqueuedSignalCommand = null;
    const ok = this.enqueueCompanionActionInternal(proposal.kind, proposal.target ?? undefined, 'human-local', originRoomId, proposal.id);
    if (ok) {
      this.pendingLocalAction = {
        proposalId: proposal.id, acceptedTick: tick, kind: proposal.kind, target: proposal.target,
        roomGeneration: this.echoRoomGeneration, originRoomId, command: this.lastEnqueuedSignalCommand
      };
      this.lastEnqueuedSignalCommand = null;
      this.echoController.markLocalPending(proposal);
      this.echoController.consumeLocalProposal(id);
    } else {
      this.echoAudit.record({ tick, provenance: 'human-local', action: proposal.kind, target: proposal.target, result: 'rejected', code: 'E_NOT_APPLICABLE', proposalId: id });
    }
    return ok;
  }

  rejectLocalEchoProposal(id: string): boolean {
    const proposal = this.echoController.localProposal;
    if (!proposal || proposal.id !== id) return false;
    const tick = this._sim.tick;
    this.echoController.rejectLocalProposal(id, tick);
    this.echoAudit.record({ tick, provenance: 'human-local', action: proposal.kind, target: proposal.target, result: 'rejected', code: 'E_USER_REJECTED', proposalId: id });
    return true;
  }

  private localProposalTargetLegal(proposal: EchoLocalProposal): boolean {
    const view = this.echoView();
    const echo = this._sim.echo;
    if (!view || !echo || !view.relay) return false;
    const distance = Math.hypot(view.relay.x - echo.x, view.relay.y - echo.y);
    const energy = view.energy?.current ?? 0;
    const scanTicks = view.cooldowns?.scanTicks ?? 0;
    const jamTicks = view.cooldowns?.jamTicks ?? 0;
    if (proposal.kind === 'scan') {
      return distance < SIGNAL_TUNING.SCAN_RADIUS && energy >= SIGNAL_TUNING.SCAN_COST && scanTicks <= 0;
    }
    if (proposal.kind === 'jam') {
      return distance < SIGNAL_TUNING.JAM_RANGE && energy >= SIGNAL_TUNING.JAM_COST && jamTicks <= 0;
    }
    if (proposal.kind === 'toggle-relay') return distance < SIGNAL_TUNING.JAM_RANGE;
    return false;
  }

  /** Committed room change: invalidate memory/proposals and bump generation. */
  private advanceEchoRoomGeneration(): void {
    // Cancel the exact queued local command BEFORE dropping the guard, so a new
    // local action cannot be enqueued while the old command remains in core.
    this.cancelPendingLocalAction('E_ROOM_CHANGED');
    this.echoRoomGeneration += 1;
    this.echoController.setRoomGeneration(this.echoRoomGeneration);
    this.echoController.clearForRoomTransition();
    this.pendingCompanionIntent = null;
    this.pendingLocalSignal = null;
  }

  /**
   * Explicit local lifecycle cancel: remove THIS queued command (never another
   * path's command), record a local cancellation with the proposal id, then
   * clear the guard. Used by room change, echo disable and an explicit revoke.
   */
  cancelPendingLocalAction(reason: 'E_ROOM_CHANGED' | 'E_ECHO_DISABLED' | 'E_LOCAL_REVOKED' | 'E_ECHO_DEAD'): boolean {
    const pending = this.pendingLocalAction;
    if (!pending) return false;
    if (pending.command) {
      const index = this._sim.pendingCommands.indexOf(pending.command);
      if (index >= 0) this._sim.pendingCommands.splice(index, 1);
    }
    this.echoAudit.record({
      tick: this._sim.tick, provenance: 'human-local', action: pending.kind,
      target: pending.target, result: 'cancelled', code: reason, proposalId: pending.proposalId
    });
    this.pendingLocalAction = null;
    this.echoController.clearLocalPending();
    if (this.pendingLocalSignal?.proposalId === pending.proposalId) this.pendingLocalSignal = null;
    this.bumpSimVersion();
    return true;
  }

  /** Record the real result of a pending local/owner signal command. */
  private settlePendingLocalSignal(kind: 'scan' | 'jam' | 'toggle-relay', ok: boolean, code?: string): void {
    const local = this.pendingLocalAction;
    if (local && local.kind === kind) {
      this.echoAudit.record({
        tick: this._sim.tick, provenance: 'human-local', action: local.kind,
        target: local.target, result: ok ? 'applied' : 'rejected',
        proposalId: local.proposalId, ...(code ? { code } : {})
      });
      this.pendingLocalAction = null;
      this.echoController.clearLocalPending();
      // Do not consume a newer owner-external pending row if it overwrote the
      // local row after enqueue; only clear the matching local receipt.
      if (this.pendingLocalSignal?.proposalId === local.proposalId) this.pendingLocalSignal = null;
      return;
    }
    const pending = this.pendingLocalSignal;
    if (!pending || pending.kind !== kind) return;
    this.echoAudit.record({
      tick: this._sim.tick, provenance: pending.provenance, action: pending.kind,
      target: pending.target, result: ok ? 'applied' : 'rejected',
      ...(pending.proposalId ? { proposalId: pending.proposalId } : {}),
      ...(code ? { code } : {})
    });
    this.pendingLocalSignal = null;
  }

  /** Per-run echo/autonomy runtime reset; the saved human switch is re-applied. */
  private resetEchoCooperationRuntime(): void {
    this.echoRoomGeneration = 0;
    this.echoController.reset();
    this.echoController.setRoomGeneration(0);
    this.echoController.setAutonomy(this.echoCooperationOptIn);
    this.echoAudit.reset();
    this.pendingLocalSignal = null;
    this.pendingLocalAction = null;
    this.lastEnqueuedSignalCommand = null;
    this.pendingCompanionIntent = null;
  }

  /** Bounded, real Signal state (no hidden fields). Mirrors headless
   *  worldHeadless.signalView() so Rendered and Headless report byte-parity
   *  echoSignal. Returns null when no relay device exists (legacy v1 run). */
  signalView(): Record<string, unknown> | null {
    const s = this._sim.signal;
    if (!s) return null;
    return {
      deviceId: s.deviceId, roomId: s.roomId, x: s.x, y: s.y,
      relay: s.relay, manualEnabled: s.manualEnabled, powered: s.powered,
      jammedUntilTick: s.jammedUntilTick,
      playerEnergy: s.actors.player.energy.energy,
      echoEnergy: s.actors.echo.energy.energy,
      playerScanCD: s.actors.player.cooldowns.scanCooldownTicks,
      playerJamCD: s.actors.player.cooldowns.jamCooldownTicks,
      echoScanCD: s.actors.echo.cooldowns.scanCooldownTicks,
      echoJamCD: s.actors.echo.cooldowns.jamCooldownTicks,
      evidence: s.evidence.length,
      exitOpen: s.relay === 'ACTIVE'
    };
  }

  /**
     /** Enqueue a legal Signal command directly on the core. Committed by the next
   *  processCommands tick; no flush, no direct state write. Returns false when
   *  no signal device exists or the command is unknown. */
  private enqueueSignalCommand(
    command: { type: 'signal-scan' | 'signal-jam'; actor: 'player' | 'echo' }
      | { type: 'toggle-relay'; enabled: boolean; originRoomId?: number }
      | { type: 'signal-power'; powered: boolean }
  ): boolean {
    if (!this._sim.signal) return false;
    enqueueCommand(this._sim, command);
    this.lastEnqueuedSignalCommand = command;
    this.bumpSimVersion();
    return true;
  }

  /** Human opt-in to Signal Collaboration. Persisted to save data by the
   *  caller (GameScene). When enabled, the first room enter spawns the Relay
   *  device; when false the run stays legacy (portal always open). */
  setSignalCollaborationOptIn(enabled: boolean): void {
    this.signalCollaborationOptIn = enabled;
  }

  /** HUMAN PLAYER scan the Relay using the player's own finite energy account. */
  playerSignalScan(): boolean { return this.enqueueSignalCommand({ type: 'signal-scan', actor: 'player' }); }
  /** HUMAN PLAYER jam the relay emission (suppresses, never toggles manual/power). */
  playerSignalJam(): boolean { return this.enqueueSignalCommand({ type: 'signal-jam', actor: 'player' }); }
  /** External agent / Companion-confirmed signal command on a named actor's
   *  energy account. Committed by the next core tick; never a direct state
   *  write. Returns false when no device exists or the command is unknown. */
  enqueueSignalCommandByActor(command: {
    type: 'signal-scan' | 'signal-jam'; actor: 'player' | 'echo'
  }): boolean { return this.enqueueSignalCommand(command); }
  /** HUMAN OWNER manual relay + power toggle (JAM is preserved, not a switch). */
  toggleRelay(enabled?: boolean): boolean {
    return this.enqueueSignalCommand({ type: 'toggle-relay', enabled: enabled ?? !(this._sim.signal?.manualEnabled ?? false) });
  }
  setRelayPower(powered: boolean): boolean { return this.enqueueSignalCommand({ type: 'signal-power', powered }); }

  // ---------------------------------------------------------------------------
  // GAMEPLAY-01 P1 — authored Demo-01 scenario (null for normal runs/rooms)
  // ---------------------------------------------------------------------------

  /** Build the authored route data + graph edges. Idempotent; called before a
   *  checkpoint restore and before spawning the demo sentry. Old rooms never
   *  enter this path, so their behaviour and save data are unchanged. */
  setupP1Scenario(): boolean {
    // Idempotent: GameScene calls this before restore, and restoreCheckpoint
    // may call it again. Recomputing would mutate connectedTo twice and pick a
    // different route pair (breaking portalTarget restore).
    if (this.p1Scenario) return true;
    if (this.p1ScenarioError) return false;
    const scenario = buildP1Scenario({
      map: this.map,
      isWalkable: (x, y, radius) => this.isWalkable(x, y, radius)
    });
    if (!scenario) {
      this.p1ScenarioError = 'DEMO 01 UNAVAILABLE · LAYOUT / ROUTES CANNOT BE AUTHORED';
      return false;
    }
    this.p1Scenario = scenario;
    // P4/M2: the authored demo + route identity is part of the CORE state, so a
    // snapshot / restore / replay cannot silently lose it (the rendered World
    // and the formal Headless now agree on one identity). Data only: the route
    // target is still derived from the committed relay state.
    this._sim.authored = {
      id: scenario.id,
      roomId: scenario.roomId,
      startRoomId: scenario.startRoomId,
      routes: scenario.routes.map((route) => ({
        target: route.target, when: route.when, label: route.label,
        ...(route.portal ? { portal: { x: route.portal.x, y: route.portal.y } } : {})
      }))
    };
    // P4 layout: the authored player start is distinct from the device cell.
    if (scenario.playerStart) {
      this._sim.player.x = scenario.playerStart.x;
      this._sim.player.y = scenario.playerStart.y;
      this.bumpSimVersion();
    }
    this.lastP1RouteTarget = -1;
    return true;
  }

  /** Spawn the authored sentry encounter in the scenario room (fresh demo only). */
  spawnP1Sentry(): void {
    const scenario = this.p1Scenario;
    if (!scenario) return;
    const room = this.map.rooms[scenario.roomId];
    if (!room) return;
    room.kind = 'combat';
    room.spawned = true;
    room.cleared = false;
    this.clearPortal();
    this.lastP1RouteTarget = -1;
    this.signalDeviceSpawned = true;
    enqueueCommand(this._sim, {
      type: 'spawn-signal-device', deviceId: 'relay_main', roomId: scenario.roomId,
      x: scenario.relay.x, y: scenario.relay.y, initial: scenario.initial
    });
    const ids: number[] = [];
    for (const spot of scenario.drones) {
      const enemy = this.spawnEnemy('drone', spot.x, spot.y, scenario.roomId, this.roomDepth.of(scenario.roomId));
      ids.push(enemy._id);
    }
    enqueueCommand(this._sim, { type: 'link-drones-to-signal', deviceId: 'relay_main', droneIds: ids });
    this.bumpSimVersion();
  }

  /** Recompute the authored route portal from the current relay state. */
  private updateP1RoutePortal(): void {
    const scenario = this.p1Scenario;
    if (!scenario) return;
    const room = this.map.rooms[scenario.roomId];
    if (!room || this.currentRoomId !== room.id) {
      if (this.portal) this.clearPortal();
      this.lastP1RouteTarget = -1;
      return;
    }
    if (!room.cleared) {
      if (this.portal) this.clearPortal();
      this.lastP1RouteTarget = -1;
      return;
    }
    const relay = this._sim.signal?.relay ?? null;
    const route = p1RouteFor(relay, scenario.routes);
    const target = route?.target ?? null;
    if (target === this.lastP1RouteTarget) return;
    this.lastP1RouteTarget = target;
    if (target === null) { this.clearPortal(); return; }
    if (route?.portal) this.makePortal(target, route.portal);
    else this.placePortalForTarget(room, target);
  }

  /** P1 HUD helper: null = no authored link; true = linked drones may fire. */
  get p1LinkedFireEnabled(): boolean | null {
    if (!this.p1Scenario) return null;
    const signal = this._sim.signal;
    if (!signal) return null;
    return signal.relay === 'ACTIVE';
  }

  get p1JamRemainingTicks(): number {
    const signal = this._sim.signal;
    return signal ? Math.max(0, signal.jammedUntilTick - this._sim.tick) : 0;
  }

  get p1RouteTarget(): number | null {
    const scenario = this.p1Scenario;
    if (!scenario) return null;
    return routeTargetFor(this._sim.signal?.relay ?? null, scenario.routes);
  }

  /** Owner-confirmed companion action -> a SINGLE queued core intent (move/fire/
   *  aim/stop) consumed by the next stepFrame tick, or a Signal command
   *  (scan/jam/toggle-relay) committed directly by the core tick. No flush, no
   *  direct state write. `scan`/`jam` spend the ECHO's own energy account and
   *  are gated by range/LOS/cooldown inside the core.
   */
  enqueueCompanionAction(kind: string, target?: { x: number; y: number }): boolean {
    return this.enqueueCompanionActionInternal(kind, target, 'owner-external');
  }

  /** Shared executor. `provenance` may only be set by an authorized boundary. */
  private enqueueCompanionActionInternal(
    kind: string, target: { x: number; y: number } | undefined,
    provenance: 'human-local' | 'owner-external', originRoomId?: number, proposalId?: string
  ): boolean {
    const echo = this._sim.echo;
    if (!echo || echo.data.hp <= 0) return false;
    switch (kind) {
      case 'move': {
        if (!target) return false;
        const dx = target.x - echo.x, dy = target.y - echo.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return false;
        this.pendingCompanionIntent = {
          move: { x: dx / len, y: dy / len }, dash: false, fire: false, aim: null, interact: false
        };
        this.bumpSimVersion();
        this.echoAudit.record({ tick: this._sim.tick, provenance, action: 'move', target: target ?? null, result: 'enqueued' });
        return true;
      }
      case 'aim':
        if (!target) return false;
        this.pendingCompanionIntent = {
          move: { x: 0, y: 0 }, dash: false, fire: false, aim: { x: target.x, y: target.y }, interact: false
        };
        this.bumpSimVersion();
        return true;
      case 'fire':
        this.pendingCompanionIntent = {
          move: { x: 0, y: 0 }, dash: false, fire: true,
          aim: target ? { x: target.x, y: target.y } : null, interact: false
        };
        this.bumpSimVersion();
        return true;
      case 'stop':
        this.pendingCompanionIntent = {
          move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false
        };
        this.bumpSimVersion();
        return true;
      case 'scan':
      case 'jam':
      case 'toggle-relay': {
        const signalKind = kind as 'scan' | 'jam' | 'toggle-relay';
        let ok = false;
        if (signalKind === 'toggle-relay') {
          // originRoomId is captured at confirmation (not cached in a proposal).
          ok = this.enqueueSignalCommand({
            type: 'toggle-relay',
            enabled: !(this._sim.signal?.manualEnabled ?? false),
            originRoomId: originRoomId ?? this.roomIdValue
          });
        } else {
          ok = this.enqueueSignalCommand({
            type: signalKind === 'scan' ? 'signal-scan' : 'signal-jam',
            actor: 'echo'
          });
        }
        if (ok) {
          this.pendingLocalSignal = {
            kind: signalKind, target: target ?? null, tick: this._sim.tick, provenance,
            ...(proposalId ? { proposalId } : {})
          };
          this.echoAudit.record({
            tick: this._sim.tick, provenance, action: signalKind,
            target: target ?? null, result: 'enqueued',
            ...(proposalId ? { proposalId } : {})
          });
        }
        return ok;
      }
      default:
        return false;
    }
  }

  get hasPendingCompanionIntent(): boolean { return this.pendingCompanionIntent !== null; }

  /** Human request: spawn the companion next to the protagonist. */
  enableEcho(): void {
    if (this._sim.echo) return;
    let spawn = { x: this.player.x + 1, y: this.player.y };
    if (!isWalkableFromState(this._sim, spawn.x, spawn.y, 0.5)) spawn = { x: this.player.x, y: this.player.y };
    enqueueCommand(this._sim, { type: 'spawn-echo', x: spawn.x, y: spawn.y });
    this.bumpSimVersion();
  }

  disableEcho(): void {
    if (!this._sim.echo) return;
    this.cancelPendingLocalAction('E_ECHO_DISABLED');
    this.echoController.clearIntent();
    this.pendingLocalSignal = null;
    enqueueCommand(this._sim, { type: 'remove-echo' });
    this.bumpSimVersion();
  }

  setEchoMode(mode: EchoMode, target: { x: number; y: number } | null = null): void {
    this.echoController.setMode(mode, target);
  }

  /** Only the human confirms assist fire; the controller never arms itself. */
  confirmEchoAssist(): void {
    this.echoController.confirmAssist();
  }

  /** How many core ticks the active external action still needs. */
  get externalRemainingTicks(): number {
    return this.externalLink.activeExecution?.remainingTicks ?? 0;
  }

  /** The core tick actually applied an external intent: the receipt is real. */
  commitExternalIntent(actionId: string, appliedTick: number): ExternalActionReceipt | null {
    return this.externalLink.commitApplied(actionId, appliedTick);
  }

  /** The external intent could not be executed. */
  rejectExternalIntent(actionId: string, code: string, appliedTick: number): ExternalActionReceipt | null {
    return this.externalLink.commitRejected(actionId, code, appliedTick);
  }

  /** Expire external intents whose apply-by tick has passed. */
  expireExternalIntents(): void {
    this.externalLink.expireOverdue(this._sim.tick);
  }

  get playerX(): number { return this._sim.player.x; }
  get playerY(): number { return this._sim.player.y; }
  get playerFireTimer(): number { return this._sim.player.fireTimer; }
  get playerDashTimer(): number { return this._sim.player.dashTimer; }
  get playerInvuln(): number { return this._sim.player.invuln; }
  get playerHurtTimer(): number { return this._sim.player.hurtTimer; }
  get playerAimYaw(): number { return this._sim.player.aimYaw; }

  /** Spawn/generation queue barrier: true while World-held enemy/Boss spawns
   *  have been requested but not yet committed by stepFrame. */
  hasPendingSpawns(): boolean {
    return this.worldSpawns.length > 0 || this.pendingRoomEnters.size > 0;
  }

  /** Verifiable committed barrier: true while any core command or World-generated
   *  spawn is still enqueued but not committed. Checkpoint must not capture then. */
  hasUncommittedCommands(): boolean {
    return this._sim.pendingCommands.length > 0 || this.hasPendingSpawns();
  }

  private bumpSimVersion(): void {
    this.simVersion++;
    this.simSnapshotCache = null;
    this.playerDataSnapshotCache = null;
  }


  constructor(scene: Phaser.Scene, map: MapData, save: SaveData, callbacks: WorldCallbacks) {
    this.scene = scene;
    this.map = map;
    this.callbacks = callbacks;
    this.signalCollaborationOptIn = !!save.permanent?.signalCollaborationOptIn;
    this.echoCooperationOptIn = !!save.permanent?.echoCooperationOptIn;
    this.echoController.setAutonomy(this.echoCooperationOptIn);
    this.echoController.setRoomGeneration(this.echoRoomGeneration);
    this.rng = map.deck === undefined ? new RNG(map.seed * 7919 + 1) : dungeonRng(map.seed);
    this.roomDepth.build(map);
    this._computeBounds();
    // Build the renderer first: Player/Enemy/Boss project() in their constructors and
    // need the renderer's offset to place their sprites on the first frame.
    this.renderer = new WorldRenderer(scene, map);
    const spawn = this.findSpawn();
    this.player = new Player(this, spawn.x, spawn.y, save);
    this.player.id = 0;
    // C2: create the single first-slice authority. Player.data is the same
    // object reference; Player getters/setters read and write this state.
    this._sim = createSimulationState({
      seed: map.seed,
      map,
      playerData: this.player.data,
      playerX: this.player.wx,
      playerY: this.player.wy
    });
    const kb = scene.input.keyboard;
    if (kb) {
      // Register keys by their code name (e.g. 'D') so the KeyboardPlugin stores them
      // under the numeric keyCode (`keys[KeyCodes[code]]`, e.g. keys[68]). Its `update()`
      // handler resolves keys via `event.keyCode`, which Chrome still emits (68 for 'd').
      const keyW = (kb as any).addKey || (kb as any).createKey;
      const keys = {
        W: keyW.call(kb, 'W'),
        A: keyW.call(kb, 'A'),
        S: keyW.call(kb, 'S'),
        D: keyW.call(kb, 'D'),
      };
      const cursors = { space: keyW.call(kb, 'SPACE') };
      this.player.registerInput(keys, cursors);
    }
    this.vfx = new CombatVfx(scene, map.seed);
  }

  /** Number of rooms whose survey ink has been drawn (visual observation state). */
  surveyedRooms(): number {
    return this.map.rooms.filter((r) => this.renderer?.isObserved(r.id)).length;
  }

  id(): number { return this.enemyIdCounter++; }

  private findSpawn(): Vec2 {
    for (let gy = 0; gy < this.map.tiles.length; gy++) {
      for (let gx = 0; gx < this.map.tiles[gy].length; gx++) {
        if (this.map.tiles[gy][gx].type === 'spawn') {
          return { x: this.map.tiles[gy][gx].x, y: this.map.tiles[gy][gx].y };
        }
      }
    }
    return { x: this.map.tiles[0][0].x, y: this.map.tiles[0][0].y };
  }

  /** Project a world-grid coordinate to screen space using the renderer's map offset. */
  worldToScreen(x: number, y: number): Vec2 {
    const off = this.renderer ? { x: this.renderer._offX, y: this.renderer._offY } : { x: 0, y: 0 };
    const iso = isoToScreen(x, y);
    return { x: iso.x + off.x, y: iso.y + off.y };
  }

  /** Inverse of worldToScreen: a display-space point back to a world-grid coordinate. */
  screenToWorld(sx: number, sy: number): Vec2 {
    const offX = this.renderer ? this.renderer._offX : 0;
    const offY = this.renderer ? this.renderer._offY : 0;
    return screenToIso(sx - offX, sy - offY);
  }

  // ---------- Collision ----------

  private _computeBounds(): void {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const tiles = this.map.tiles;
    for (let gy = 0; gy < tiles.length; gy++) {
      for (let gx = 0; gx < tiles[gy].length; gx++) {
        const t = tiles[gy][gx];
        minX = Math.min(minX, t.x); minY = Math.min(minY, t.y);
        maxX = Math.max(maxX, t.x); maxY = Math.max(maxY, t.y);
      }
    }
    this._minX = minX; this._minY = minY; this._maxX = maxX; this._maxY = maxY;
  }

  tileAt(worldX: number, worldY: number): Tile {
    // tiles[] is indexed [gy][gx] where the tile at that cell has world coord
    // (minX + gx, minY + gy). So map the absolute world coord back to an index by
    // subtracting the offset first.
    const gx = Math.floor(worldX) - this._minX;
    const gy = Math.floor(worldY) - this._minY;
    if (gy < 0 || gy >= this.map.tiles.length) return { x: gx, y: gy, type: 'wall', height: 0 };
    const row = this.map.tiles[gy];
    if (!row) return { x: gx, y: gy, type: 'wall', height: 0 };
    if (gx < 0 || gx >= row.length) return { x: gx, y: gy, type: 'wall', height: 0 };
    return row[gx];
  }

  isWalkable(worldX: number, worldY: number, radius = 0.5): boolean {
    // sample the four corners of the entity's bounding circle-ish square
    const samples = [
      { x: worldX - radius, y: worldY - radius },
      { x: worldX + radius, y: worldY - radius },
      { x: worldX - radius, y: worldY + radius },
      { x: worldX + radius, y: worldY + radius }
    ];
    for (const s of samples) {
      const t = this.tileAt(s.x, s.y);
      if (t.type === 'wall' || t.type === 'lava' || t.type === 'water') return false;
    }
    return true;
  }

  // ---------- Room tracking ----------

  /**
   * Read-only adapter for the local deterministic controller (AI-NATIVE-02 P1).
   * It exposes only a bounded perception projection: own state, perceived
   * actors / boss / portal, and a short-range local walkability probe. It has no
   * setters and no full-map collision oracle; a controller can never write
   * coordinates or HP, only return a PlayerIntent for Player.applyIntent().
   */
  intentView(): LocalControllerView {
    const observation = this.observationView();
    const enemies: ControllerActorView[] = observation.perceivedActors.map((actor) => ({
      id: actor.id, kind: actor.kind, x: actor.x, y: actor.y, alive: actor.alive
    }));
    const boss: ControllerActorView | null = observation.boss
      ? { id: observation.boss.id, kind: 'boss_warden', x: observation.boss.x, y: observation.boss.y, alive: true }
      : null;
    const center = { x: observation.player.x, y: observation.player.y };
    return {
      ready: observation.player.alive && !this.player.control.paused,
      player: { x: center.x, y: center.y, alive: observation.player.alive },
      roomId: observation.roomId,
      enemies,
      boss,
      portal: observation.portal ? { x: observation.portal.x, y: observation.portal.y } : null,
      // F-01: bounded local probe. Far / non-finite / unexplored queries are
      // uniformly rejected and never reach the real terrain predicate.
      canWalk: createLocalProbe({
        center,
        probeRadiusTiles: WORLD_PERCEPTION.probeRadiusTiles,
        isExplored: (x, y) => this.isExploredCell(x, y),
        isWalkable: (x, y) => this.isWalkable(x, y, 0.5)
      }),
      timeSeconds: this.clock
    };
  }

  /** Room id containing a grid point, or null when outside all room bounds. */
  private roomIdAt(x: number, y: number): number | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    for (const r of this.map.rooms) {
      if (x >= r.gx && x < r.gx + r.w && y >= r.gy && y < r.gy + r.h) return r.id;
    }
    return null;
  }

  /** Only rooms the player has actually entered count as known territory. */
  private isExploredCell(x: number, y: number): boolean {
    const id = this.roomIdAt(x, y);
    return id !== null && this.enteredRooms.has(id);
  }

  /** Wall cells occlude sight. Lava/water block movement, not sight. */
  private isOpaqueCell(x: number, y: number): boolean {
    return this.tileAt(Math.floor(x), Math.floor(y)).type === 'wall';
  }

  /** F-02: grid-only perception, no camera, viewport or spawn-room shortcut. */
  private isPerceivable(x: number, y: number): boolean {
    return gridLineOfSight({ x, y }, {
      center: { x: this.player.x, y: this.player.y },
      radiusTiles: WORLD_PERCEPTION.radiusTiles,
      isExplored: (sx, sy) => this.isExploredCell(sx, sy),
      isOpaque: (sx, sy) => this.isOpaqueCell(sx, sy),
      stepTiles: WORLD_PERCEPTION.losStepTiles
    });
  }

  /**
   * Legal read-only projection for AI adapters (see ai-native/worldObservation).
   * Actors, boss and portal are included only when they satisfy the bounded
   * grid radius + explored-room + LOS predicate. Portal destination, Boss phase,
   * seed / RNG / full map never leave the World here.
   */
  observationView(): WorldObservationV1 {
    const room = this.currentRoom();
    return buildWorldObservation({
      player: {
        x: this.player.x, y: this.player.y, alive: this.player.alive,
        hp: this.player.data.hp, maxHp: this.player.data.maxHp
      },
      roomId: room?.id ?? null,
      enemies: this.enemies.map((enemy) => ({
        id: enemy._id, kind: enemy.data.kind, x: enemy.x, y: enemy.y,
        alive: enemy.alive, roomId: enemy.data.spawnRoom
      })),
      boss: this.boss
        ? {
            id: this.boss._id, x: this.boss.x, y: this.boss.y, alive: this.boss.alive,
            hp: this.boss._hp, maxHp: this.boss.maxHp(), roomId: this.boss.spawnRoom
          }
        : null,
      portal: this.portal
        ? { x: this.portal.wx, y: this.portal.wy, targetRoom: this.portal.targetRoom ?? -1 }
        : null,
      perception: {
        basis: 'grid-radius+explored+line-of-sight',
        center: { x: this.player.x, y: this.player.y },
        radiusTiles: WORLD_PERCEPTION.radiusTiles,
        probeRadiusTiles: WORLD_PERCEPTION.probeRadiusTiles,
        requiresExplored: true,
        requiresLineOfSight: true
      },
      isPerceivable: (x, y) => this.isPerceivable(x, y)
    });
  }

  currentRoom(): RoomInfo | null {
    const px = this.player.x, py = this.player.y;
    for (const r of this.map.rooms) {
      if (px >= r.gx && px < r.gx + r.w && py >= r.gy && py < r.gy + r.h) {
        return { id: r.id, kind: r.kind, gx: r.gx, gy: r.gy, w: r.w, h: r.h };
      }
    }
    return null;
  }

  private get exitRoom(): Room | undefined {
    return this.map.rooms.find(({ kind }) => kind === 'boss' || kind === 'extraction');
  }

  private get exitUnlocked(): boolean {
    const exit = this.exitRoom;
    return this.map.rooms.every((room) => room === exit || room.cleared);
  }

  private isDeckExit(room: Room): boolean {
    return this.map.deck !== undefined && room === this.exitRoom;
  }

  private get nextDeck(): number | undefined {
    const deck = this.map.deck;
    return deck !== undefined && deck + 1 < TOTAL_DECKS ? deck + 1 : undefined;
  }

  canMovePlayer(x: number, y: number): boolean {
    const room = this.map.rooms[this.currentRoomId];
    return this.canMoveInRoom(x, y, this.player.getRadius(), room?.spawned && !room.cleared ? room.id : undefined);
  }

  canMoveInRoom(x: number, y: number, radius: number, roomId?: number): boolean {
    const room = this.map.deck !== undefined && roomId !== undefined ? this.map.rooms[roomId] : undefined;
    if (room && (x < room.gx || x >= room.gx + room.w || y < room.gy || y >= room.gy + room.h)) return false;
    return this.isWalkable(x, y, radius);
  }

  get roomObjective(): string {
    const room = this.map.rooms[this.currentRoomId];
    if (!room) return '';
    if (this.p1Scenario && room.id === this.p1Scenario.roomId) {
      if (!room.cleared) return 'CLEAR THE LINKED SENTRY · T SCAN · Y JAM · R TOGGLE';
      const relay = this._sim.signal?.relay ?? null;
      if (relay === 'JAMMED') return 'ROUTE BLOCKED · JAMMED — WAIT OR R TOGGLE RELAY';
      const route = p1RouteFor(relay, this.p1Scenario.routes);
      if (route) return `F AT PORTAL · ${route.when === 'RELAY_ACTIVE' ? 'ROUTE A' : 'ROUTE B'} · ${route.label}`;
      return 'ROUTE UNAVAILABLE';
    }
    if (this.isDeckExit(room) && !this.exitUnlocked) return 'EXIT LOCKED · CLEAR OTHER ROOMS';
    if (room.cleared && this.isDeckExit(room) && this.nextDeck !== undefined) return `F · DESCEND TO ${deckLabel(this.nextDeck)}`;
    if (!room.cleared && this.waves.length) return `WAVE ${this.activeWave}/${this.waves.length}`;
    return this.portal && room.cleared ? 'F AT PORTAL · NEXT ROOM' : '';
  }

  updateRoom(): void {
    let room = this.currentRoom();
    let roomChanged = false;
    if (!room && this.currentRoomId === -1) {
      // After a teleport transition, currentRoomId is -1 until the room is
      // re-resolved from the player's new position.
      room = this.map.rooms.find((r) =>
        this._sim.player.x >= r.gx && this._sim.player.x < r.gx + r.w &&
        this._sim.player.y >= r.gy && this._sim.player.y < r.gy + r.h
      ) as RoomInfo | null;
      if (room) {
        this.currentRoomId = room.id;
        roomChanged = true;
      }
    }
    if (!room) return;
    if (roomChanged || room.id !== this.currentRoomId) {
      this.currentRoomId = room.id;
      this.onEnterRoom(room);
    }
    // clear when all enemies in room dead — but only after the room's own
    // generation has committed (spawned) and is no longer pending.
    const inRoom = this.enemies.filter((e) => e.data.spawnRoom === room.id && e.alive);
    const r = this.map.rooms[room.id];
    if (r.spawned && !this.pendingRoomEnters.has(room.id) && inRoom.length === 0 && !r.cleared &&
        (this.map.deck === undefined || !this.boss)) {
      if (this.map.deck !== undefined && this.activeWave < this.waves.length) {
        this.spawnSectorWave(r);
        return;
      }
      r.cleared = true;
      this.clearRoomSeal();
      if (this.map.deck !== undefined && !this.won) this.placePortal(r);
      this.callbacks.onRoomCleared(room);
      r.cleared = true;
      this.clearRoomSeal();
      if (this.map.deck !== undefined && !this.won) this.placePortal(r);
      this.callbacks.onRoomCleared(room);
    }
    if (this.p1Scenario) this.updateP1RoutePortal();
  }

  private onEnterRoom(room: RoomInfo): void {
    this.advanceEchoRoomGeneration();
    const r = this.map.rooms[room.id];
    this.activeWave = 0;
    this.waves = [];
    this.enteredRooms.add(room.id);
    // Survey ink: entering a room is an observation; the mast's pulse draws it in.
    if (this.renderer) {
      const p = this.player.sprite;
      this.renderer.observeRoom(room.id, p.x, p.y);
    }
    const depth = this.roomDepth.of(r.id);
    const isNew = !r.spawned && !this.pendingRoomEnters.has(r.id);

    if (isNew && this.isDeckExit(r) && !this.exitUnlocked) {
      this.placePortal(r);
      return;
    }

    if (isNew && this.map.deck !== undefined) {
      if (r.kind === 'boss') {
        this.spawnBoss(r);
        r.spawned = true;
      } else if (r.kind === 'extraction' && this.exitUnlocked) {
        // 无 boss 的终点房：其他房间已清后，进入即为下一 sector 门。
        this.placePortal(r);
        this.callbacks.onRoomEntered(r);
        return;
      } else {
        r.spawned = true;
        this.waves = encounter(this.map.seed, this.map.deck, r.id, r.kind);
        if (this.waves.length) this.spawnSectorWave(r);
      }
      if (r.kind === 'resource' || r.kind === 'shop') this.spawnResourceLoot(r);
      this.callbacks.onRoomEntered(room);
    } else if (isNew && r.kind === 'boss') {
      this.enqueueSpawnBoss(r);
      this.pendingRoomEnters.add(r.id);
      this.callbacks.onRoomEntered(room);
      this.placePortal(r);
    } else if (isNew) {
      const enemyCount = this.roomEnemyCount(r, depth);
      const enemyPositions: Vec2[] = [];
      for (let i = 0; i < enemyCount; i++) {
        enemyPositions.push({
          x: r.gx + 3 + (i % 3) * (r.w - 6) / 3,
          y: r.gy + 3 + Math.floor(i / 3) * (r.h - 6)
        });
      }
      const resourceCount = this.roomResourceCount(r, depth);
      const resourcePositions: Vec2[] = [];
      for (let i = 0; i < resourceCount; i++) {
        resourcePositions.push({ x: r.gx + 2 + (i + 1) * 2, y: r.gy + 2 + (i % 2) * 2 });
      }
      const neighbors = r.connectedTo.filter((n) => n !== r.id);
      enqueueCommand(this._sim, {
        type: 'room-enter', roomId: r.id, roomKind: r.kind,
        gx: r.gx, gy: r.gy, w: r.w, h: r.h, depth,
        savedPortalTarget: null,
        neighbors, enemyCount, enemyPositions, resourceCount, resourcePositions,
        firstEnemyId: this.enemyIdCounter
      });
      this.enemyIdCounter += enemyCount;
      this.bumpSimVersion();
      this.pendingRoomEnters.add(r.id);
      this.callbacks.onRoomEntered(room);
      this.placePortal(r);
      if (this.signalCollaborationOptIn && !this.signalDeviceSpawned) {
        this.signalDeviceSpawned = true;
        enqueueCommand(this._sim, {
          type: 'spawn-signal-device',
          deviceId: 'relay_main',
          roomId: r.id,
          x: r.gx + Math.floor(r.w / 2),
          y: r.gy + Math.floor(r.h / 2)
        });
      }
    } else if (!this.portal) {
      this.placePortal(r);
    }

    if (this.map.deck !== undefined && !r.cleared && (this.boss || this.waves.length)) this.showRoomSeal(r);
    if (this.map.deck === undefined || r.cleared) this.placePortal(r);
    else this.clearPortal();
  }

  private showRoomSeal(room: Room): void {
    this.clearRoomSeal();
    const seal = this.scene.add.graphics().setDepth(58);
    seal.lineStyle(3, 0xff805b, 0.9);
    const edge = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
      if (this.tileAt(x, y).type === 'wall') return;
      const from = this.worldToScreen(ax, ay);
      const to = this.worldToScreen(bx, by);
      seal.lineBetween(from.x, from.y, to.x, to.y);
    };
    const right = room.gx + room.w;
    const bottom = room.gy + room.h;
    for (let x = room.gx; x < right; x++) {
      edge(x, room.gy - 1, x, room.gy, x + 1, room.gy);
      edge(x, bottom, x, bottom, x + 1, bottom);
    }
    for (let y = room.gy; y < bottom; y++) {
      edge(room.gx - 1, y, room.gx, y, room.gx, y + 1);
      edge(right, y, right, y, right, y + 1);
    }
    this.roomSeal = seal;
  }

  private clearRoomSeal(): void {
    this.roomSeal?.destroy();
    this.roomSeal = undefined;
  }

  private roomEnemyCount(r: Room, depth: number): number {
    if (r.kind === 'start') return 0;
    if (r.kind === 'elite') return 4 + depth;
    if (r.kind === 'shop') return 1;
    return 2 + depth;
  }

  private roomResourceCount(r: Room, depth: number): number {
    // C1: resource loot exists only in resource / shop rooms. Ordinary combat
    // and start rooms never drop resource loot.
    if (r.kind !== 'resource' && r.kind !== 'shop') return 0;
    return r.kind === 'shop' ? 3 : 2 + (depth % 3);
  }

  private placePortal(r: Room, savedTarget?: number | null): void {
    if (this.isDeckExit(r) && this.nextDeck !== undefined) {
      if (r.kind === 'extraction') {
        // 无 boss 的终点房：其他房间已清后，进入即为下一 sector 门。
        if (this.exitUnlocked) { this.makePortal(null, this.cellCentre(this.findWalkableInRoom(r))); return; }
        this.clearPortal(); return;
      }
      if (r.cleared) { this.makePortal(null, this.cellCentre(this.findWalkableInRoom(r))); return; }
      this.clearPortal(); return;
    }
    // Prefer the first step toward any unvisited room. If every room is already
    // visited, allow backtracking instead of destroying the portal and soft-locking
    // the run in a leaf room.
    let target = savedTarget ?? this.nextRoomTowardUnvisited(r.id);
    if (target === null) {
      const neighbors = r.connectedTo.filter((n) => n !== r.id &&
        (this.map.deck === undefined || this.exitUnlocked || this.map.rooms[n] !== this.exitRoom));
      if (neighbors.length === 0) {
        this.clearPortal();
        return;
      }
      // Portal target is drawn from the core RNG when the room-enter command
      // commits; this deterministic fallback is only reachable for restored
      // frames that did not persist a portal target.
      target = neighbors[0];
    }
    this.placePortalForTarget(r, target);
  }

  private placePortalForTarget(r: Room, target: number): void {
    const tr = this.map.rooms[target];
    const targetCenter = { x: tr.gx + tr.w / 2, y: tr.gy + tr.h / 2 };

    // Place the portal on a walkable tile INSIDE the current room, nearest to the
    // target room. The old code searched around the midpoint between room centres
    // with `isWalkable(..., 8)`, which requires a 16x16 open square and therefore
    // almost never matches; the portal then stayed at a wall/void midpoint.
    let best = {
      x: r.gx + Math.floor(r.w / 2),
      y: r.gy + Math.floor(r.h / 2)
    };
    let bestD = Infinity;
    for (const row of this.map.tiles) {
      for (const tile of row) {
        if (tile.x < r.gx || tile.x >= r.gx + r.w) continue;
        if (tile.y < r.gy || tile.y >= r.gy + r.h) continue;
        if (!this.isWalkable(tile.x, tile.y, 0.5)) continue;
        const dd = (tile.x - targetCenter.x) ** 2 + (tile.y - targetCenter.y) ** 2;
        if (dd < bestD) { bestD = dd; best = { x: tile.x, y: tile.y }; }
      }
    }

    this.makePortal(target, this.cellCentre(best));
  }

  private clearPortal(): void {
    if (!this.portal) return;
    this.scene.tweens.killTweensOf(this.portal.spr);
    this.portal.spr.destroy();
    this.portal = null;
  }

  private makePortal(target: number | null, center: Vec2): void {
    this.clearPortal();
    // `center` is the authored/derived CELL CENTRE (tile + 0.5). The sprite, its
    // label, its glow and the interaction point (`wx`/`wy`) all use that one
    // point — P1 passed a corner here and the beacon sat half a tile away from
    // the real interaction point (M7).
    const s = this.worldToScreen(center.x, center.y);
    const spr = this.scene.add.sprite(s.x, s.y, 'portal_beacon');
    spr.setOrigin(0.5, 54 / 64).setDepth(DEPTH.decal + 1);
    if (target === null) spr.setTint(0xffd233);
    this.scene.add.tween({ targets: spr, alpha: { from: 0.65, to: 1 }, duration: 900, yoyo: true, repeat: -1 });
    const labelText = target === null
      ? 'F · DESCEND'
      : `F · R-${String(target).padStart(2, '0')} ${this.map.rooms[target].kind.toUpperCase()}`;
    const label = this.scene.add.text(s.x + 16, s.y - 58, labelText, {
      fontFamily: FONT.mono, fontSize: '11px', color: CSS.interact
    }).setOrigin(0, 0.5).setDepth(DEPTH.decal + 1);
    const glow = this.scene.add.image(s.x, s.y, 'light_interact').setBlendMode(Phaser.BlendModes.ADD).setScale(0.6).setAlpha(0.35).setDepth(DEPTH.light);
    spr.once('destroy', () => { label.destroy(); glow.destroy(); });
    this.portal = { spr, targetRoom: target, wx: center.x, wy: center.y };
  }

  /** Integer grid cell -> the cell CENTRE the presenters/interaction agree on. */
  private cellCentre(cell: Vec2): Vec2 {
    return { x: cell.x + 0.5, y: cell.y + 0.5 };
  }

  /** First adjacent room on the shortest room-graph path to an unvisited room. */
  private nextRoomTowardUnvisited(startId: number): number | null {
    const parent = new Map<number, number | null>();
    const queue = [startId];
    parent.set(startId, null);
    let goal: number | null = null;
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur !== startId && (this.map.deck === undefined ? !this.enteredRooms.has(cur) : !this.map.rooms[cur].cleared)) {
        goal = cur;
        break;
      }
      for (const nb of this.map.rooms[cur].connectedTo) {
        if (this.map.deck !== undefined && !this.exitUnlocked && this.map.rooms[nb] === this.exitRoom) continue;
        if (!parent.has(nb)) { parent.set(nb, cur); queue.push(nb); }
      }
    }
    if (goal === null) return null;
    let step = goal;
    while (parent.get(step) !== startId) {
      const prev = parent.get(step);
      if (prev === null || prev === undefined) return null;
      step = prev;
    }
    return step;
  }

  /**
   * A walkable landing spot inside a room, closest to its geometric centre.
   * MapGenerator.assignRoles() can enlarge a room (boss room -> 13x11) after the
   * tiles were carved, so r.gx+r.w/2 / r.gy+r.h/2 may sit in a wall/void.
   * Only tiles whose radius-0.5 footprint is clear qualify (same predicate as
   * placePortal); integer grid coords are returned so Player/Boss collision
   * checks sample the same tiles we validated here.
   */
  private findWalkableInRoom(r: Room): Vec2 {
    const cx = r.gx + r.w / 2, cy = r.gy + r.h / 2;
    let best: Vec2 = { x: r.gx + Math.floor(r.w / 2), y: r.gy + Math.floor(r.h / 2) };
    let bestD = Infinity;
    for (const row of this.map.tiles) {
      for (const tile of row) {
        if (tile.x < r.gx || tile.x >= r.gx + r.w) continue;
        if (tile.y < r.gy || tile.y >= r.gy + r.h) continue;
        if (!this.isWalkable(tile.x, tile.y, 0.5)) continue;
        const dd = (tile.x - cx) ** 2 + (tile.y - cy) ** 2;
        if (dd < bestD) { bestD = dd; best = { x: tile.x, y: tile.y }; }
      }
    }
    return best;
  }

  /** Boss spawn near the room centre, but never on top of the player. */
  private findBossSpawnInRoom(r: Room): Vec2 {
    const center = this.findWalkableInRoom(r);
    const px = this.player.wx, py = this.player.wy;
    let best = center;
    let bestCenterD = Infinity;
    for (const row of this.map.tiles) {
      for (const tile of row) {
        if (tile.x < r.gx || tile.x >= r.gx + r.w) continue;
        if (tile.y < r.gy || tile.y >= r.gy + r.h) continue;
        if (!this.isWalkable(tile.x, tile.y, 0.5)) continue;
        if (Math.hypot(tile.x - px, tile.y - py) < 3) continue;
        const centerD = (tile.x - center.x) ** 2 + (tile.y - center.y) ** 2;
        if (centerD < bestCenterD) { bestCenterD = centerD; best = { x: tile.x, y: tile.y }; }
      }
    }
    return best;
  }

  tryInteract(player: Player): void {
    if (!this.portal) return;
    const current = this.currentRoom();
    const p1Room = current && this.p1Scenario && current.id === this.p1Scenario.roomId ? current : null;
    if (p1Room) {
      // Authored route room: its own route condition already selected the
      // portal target. The legacy "only ACTIVE opens" gate does not apply.
      if (!this.map.rooms[p1Room.id].cleared) return;
    } else {
      // Only an ACTIVE relay opens the exit. No device => legacy v1 run
      // unchanged (portal always open). JAMMED/DISABLED keeps the gate shut.
      const sig = this.signalView();
      if (sig && sig.relay !== 'ACTIVE') return;
    }
    if (this.map.deck !== undefined && !p1Room) {
      const room = this.currentRoom();
      if (!room || (!this.map.rooms[room.id].cleared && !this.isDeckExit(this.map.rooms[room.id]))) return;
    }
    const dx = player.x - this.portal.wx, dy = player.y - this.portal.wy;
    if (Math.hypot(dx, dy) < 2.0) {
      if (this.portal.targetRoom === null) {
        this.callbacks.onNextDeck();
        return;
      }
      const target = this.map.rooms[this.portal.targetRoom];
      const landing = this.findWalkableInRoom(target);
      this.currentRoomId = -1;
      this.enteredRooms.delete(this.portal.targetRoom);
      this.clearPortal();
      if (this.map.deck !== undefined) {
        player.reset(landing.x, landing.y, false);
        this.updateRoom();
      } else {
        // Ordinary transition is a command committed by the next core tick with
        // a validated walkable landing; updateRoom() enters the destination and
        // queues its spawn/portal on that tick. The companion migrates with the
        // protagonist on that SAME tick, and the old room's armed assist +
        // pending companion intent + echo memory are dropped (never carried into
        // the new encounter).
        this.advanceEchoRoomGeneration();
        this.enqueueTeleport(landing.x, landing.y, true, true);
      }
      audio.wave();
    }
  }

  private spawnSectorWave(room: Room): void {
    const rng = dungeonRng(this.map.seed ^ Math.imul(room.id + 1, 0x27d4eb2d) ^ this.activeWave);
    const spots: Vec2[] = [];
    for (let x = room.gx + 1; x < room.gx + room.w - 1; x++) {
      for (let y = room.gy + 1; y < room.gy + room.h - 1; y++) {
        if (Math.hypot(x - this.player.x, y - this.player.y) >= 2 && this.isWalkable(x, y)) spots.push({ x, y });
      }
    }
    const positions = rng.shuffle(spots);
    const depth = this.roomDepth.of(room.id) + Math.floor((this.map.deck ?? 0) / 2);
    for (const kind of this.waves[this.activeWave++]) {
      const { x, y } = positions.pop() ?? this.findWalkableInRoom(room);
      this.spawnEnemy(kind, x, y, room.id, depth);
    }
    audio.wave();
  }

  private spawnForRoom(r: Room): void {
    if (r.kind === 'start') { r.spawned = true; r.cleared = true; return; }
    const depth = this.roomDepth.of(r.id);
    const count = r.kind === 'elite' ? 4 + depth : r.kind === 'shop' ? 1 : 2 + depth;
    r.spawned = true;
    // spawn away from player within room
    for (let i = 0; i < count; i++) {
      const ex = r.gx + 3 + (i % 3) * (r.w - 6) / 3;
      const ey = r.gy + 3 + Math.floor(i / 3) * (r.h - 6);
      const kind = this.pickEnemyForRoom(r, depth);
      this.spawnEnemy(kind, ex, ey, r.id, depth);
    }
  }

  private pickEnemyForRoom(r: Room, depth: number): EnemyKind {
    if (r.kind === 'elite') {
      const elite = ['sentinel', 'hunter', 'stalker'] as const;
      return elite[r.id % elite.length];
    }
    const all: EnemyKind[] = ['drone', 'stalker', 'hunter', 'sentinel'];
    return all[(r.id * 53 + depth * 11) % 4];
  }

  private spawnResourceLoot(r: Room): void {
    if (this.map.deck !== undefined) {
      const center = this.findWalkableInRoom(r);
      this.spawnLoot(center.x - 1, center.y, 'health', 'health', 0);
      this.spawnLoot(center.x + 1, center.y, 'currency', 'currency', 12);
      return;
    }
    const n = r.kind === 'shop' ? 3 : 2 + (this.roomDepth.of(r.id) % 3);
    for (let i = 0; i < n; i++) {
      const x = r.gx + 2 + (i + 1) * 2;
      const y = r.gy + 2 + (i % 2) * 2;
      const kind = (r.id + i) % 2 === 0 ? 'currency' : 'health';
      this.spawnLoot(x, y, kind, kind, kind === 'currency' ? 10 : 0);
    }
  }

  // ---------- Spawning ----------

  spawnEnemy(kind: EnemyKind, x: number, y: number, room: number, depth: number): Enemy {
    const e = new Enemy(this, kind, x, y, room, depth);
    e._id = this.enemyIdCounter++;
    e.initHp();
    this.enemies.push(e);
    if (kind === 'drone') {
      const drone = registerDrone(this._sim, {
        id: e._id, x: e.x, y: e.y, hp: e._hp, data: e.data,
        attackTimer: e.attackTimer, wanderTimer: e.wanderTimer
      });
      e.attachSimDrone(drone);
    } else {
      const target = registerTarget(this._sim, {
        id: e._id, kind, x: e.x, y: e.y, hp: e._hp, maxHp: e.data.stats.maxHp,
        armor: e.data.stats.armor, radius: e.getRadius(), isBoss: false,
        xpValue: e.data.stats.xpValue, currencyValue: e.data.stats.currencyValue
      });
      e.attachSimTarget(target);
    }
    // A direct core spawn is a committed mutation: invalidate the public
    // read-only snapshot so the next `world.sim` reflects the new actor.
    this.bumpSimVersion();
    return e;
  }

  spawnBoss(r: Room): void {
    const depth = this.roomDepth.of(r.id);
    const landing = this.findBossSpawnInRoom(r);
    this.boss = new Boss(this, landing.x, landing.y, r.id, depth);
    this.boss._id = this.enemyIdCounter++;
    this.boss.initHp();
    // Boss room generation is now committed.
    r.spawned = true;
    this.pendingRoomEnters.delete(r.id);
    const target = registerTarget(this._sim, {
      id: this.boss._id, kind: 'boss_warden', x: this.boss.x, y: this.boss.y,
      hp: this.boss._hp, maxHp: this.boss.maxHp(),
      armor: ENEMY_STATS.boss_warden.armor, radius: this.boss.getRadius() + 1, isBoss: true,
      xpValue: ENEMY_STATS.boss_warden.xpValue, currencyValue: ENEMY_STATS.boss_warden.currencyValue
    });
    this.boss.attachSimTarget(target);
    this.bumpSimVersion();
  }

  boss: Boss | null = null;

  /** Legal adapter commands: committed by the next core tick, never written live. */
  enqueueTargetMove(targetId: number, x: number, y: number): void {
    enqueueCommand(this._sim, { type: 'move-target', targetId, x, y });
    this.bumpSimVersion();
  }

  enqueueTargetHp(targetId: number, hp: number): void {
    enqueueCommand(this._sim, { type: 'set-target-hp', targetId, hp });
    this.bumpSimVersion();
  }

  enqueueHeal(amount: number): void {
    enqueueCommand(this._sim, { type: 'heal-player', amount });
    this.bumpSimVersion();
  }

  enqueueCurrency(amount: number): void {
    enqueueCommand(this._sim, { type: 'add-currency', amount });
    this.bumpSimVersion();
  }

  enqueueApplyUpgrade(key: string, level: number): void {
    enqueueCommand(this._sim, { type: 'apply-upgrade', key, level });
    this.bumpSimVersion();
  }

  enqueueAddXp(base: number): void {
    enqueueCommand(this._sim, { type: 'add-xp', base });
    this.bumpSimVersion();
  }

  enqueueSpawnLoot(x: number, y: number, kind: SimLootKind, key: string, amount: number, bob = 0): void {
    enqueueCommand(this._sim, { type: 'spawn-loot', x, y, kind, key, amount, bob });
    this.bumpSimVersion();
  }

  #setPlayerData(data: PlayerData): void {
    this._sim.player.data = JSON.parse(JSON.stringify(data)) as PlayerData;
  }

  #resetPlayer(x: number, y: number): void {
    const recovered = ensureWalkableFromState(this._sim, { x, y });
    this._sim.player.x = recovered.x;
    this._sim.player.y = recovered.y;
    this._sim.player.data.hp = this._sim.player.data.maxHp;
    this._sim.player.invuln = 1.0;
    this._sim.player.fireTimer = 0;
    this.bumpSimVersion();
  }

  /** Core-owned equip transaction; UI calls this instead of writing player.data. */
  enqueueEquipWeapon(key: string): boolean {
    enqueueCommand(this._sim, { type: 'equip-weapon', key });
    this.bumpSimVersion();
    return true;
  }

  /** Deck transition: carry the previous deck's player data into the new scene. Deep-copied; used only by a new-run scene transition (never mid-tick). */
  applyTransitionPlayerData(data: PlayerData): void {
    this.#setPlayerData(data);
    this.bumpSimVersion();
  }

  /** Fixture/Owner-only full-state write. Normal gameplay must use semantic
   *  commands (purchase-supply / heal-player / add-currency / equip-weapon...).
   *  Guarded by dev/test so a live Player cannot overwrite HP/currency wholesale. */
  enqueueSetPlayerData(data: PlayerData): void {
    World.assertDevTest();
    enqueueCommand(this._sim, { type: 'set-player-data', data });
    this.bumpSimVersion();
  }

  /** Queues an atomic supply purchase; the core validates offer, room safety,
   *  balance and eligibility at commit time and emits a receipt event. */
  enqueuePurchaseSupply(transactionId: string, offerKey: string, roomId: number): void {
    enqueueCommand(this._sim, { type: 'purchase-supply', transactionId, offerKey, roomId });
    this.bumpSimVersion();
  }

  /** Committed supply receipt for a transaction id, if already processed. */
  getSupplyReceipt(transactionId: string) {
    return this.supplyReceipts.get(transactionId);
  }

  /** Read-only: the weapon key queued by an equip-weapon command, if any. */
  getPendingEquipWeapon(): string | null {
    for (const command of this._sim.pendingCommands) {
      if (command.type === 'equip-weapon') return command.key;
    }
    return null;
  }

  /** Queues an enemy/Boss spawn; committed at the start of the next core tick. */
  enqueueSpawnEnemy(kind: EnemyKind, x: number, y: number, room: number, depth: number): void {
    this.worldSpawns.push({ kind, x, y, room, depth });
    this.bumpSimVersion();
  }

  enqueueSpawnBoss(room: Room): void {
    this.worldSpawns.push({ kind: 'boss_warden', x: 0, y: 0, room: room.id, depth: this.roomDepth.of(room.id), boss: room });
    this.bumpSimVersion();
  }

  private processWorldSpawns(): void {
    if (this.worldSpawns.length === 0) return;
    const queue = this.worldSpawns;
    this.worldSpawns = [];
    for (const entry of queue) {
      if (entry.boss) this.spawnBoss(entry.boss);
      else this.spawnEnemy(entry.kind, entry.x, entry.y, entry.room, entry.depth);
    }
  }

  /** Queues a validated room teleport; committed by the next core tick. */
  enqueueTeleport(x: number, y: number, healToFull = true, migrateEcho = false): void {
    enqueueCommand(this._sim, { type: 'teleport-player', x, y, healToFull, migrateEcho });
    this.bumpSimVersion();
  }

  /** Queues a legacy ranged attack; core commits it on the next tick. */
  spawnEnemyProjectile(ownerId: number, x: number, y: number, damage: number, vel: Vec2 = { x: 0, y: 0 }, lifetime?: number): void {
    enqueueCommand(this._sim, { type: 'spawn-enemy-projectile', ownerId, x, y, damage, vel, lifetime });
    this.bumpSimVersion();
  }

  /** Explicit sprite cleanup helper used by compatibility tests. */
  private destroyProjectileSprite(p: { spr: Phaser.GameObjects.Sprite }): void {
    if (p.spr && p.spr.scene) p.spr.destroy();
  }

  private projSprite(kind: any, enemy: boolean): string {
    if (enemy) return 'proj_enemy';
    const map: Record<string, string> = { pulse: 'proj_pulse', scatter: 'proj_pulse', plasma: 'proj_plasma', arc: 'proj_pulse' };
    return map[kind] ?? 'proj_pulse';
  }

  /** Queues a visible loot drop; core owns the data and the pickup transaction. */
  spawnLoot(x: number, y: number, kind: ItemKind, key: string, amount: number, bob = 0): void {
    this.enqueueSpawnLoot(x, y, kind as SimLootKind, key, amount, bob);
  }

  // ---------- FX ----------

  addShake(mag: number): void {
    this.shakeAmount = Math.min(18, this.shakeAmount + mag);
  }

  /**
   * Takes world-grid coordinates; the text object is placed in display space.
   * AR-02: numbers start above the head and successive hits on the same target are
   * staggered horizontally (03 §4: ±8 px × index) so "12 22 2" no longer stacks.
   */
  addDamageNumber(x: number, y: number, amount: number, crit: boolean, targetId = -1, headPx = 48): void {
    const s = this.worldToScreen(x, y);
    const st = this.damageStack.get(targetId);
    const n = st && this.clock - st.t < 0.6 ? st.n + 1 : 0;
    this.damageStack.set(targetId, { t: this.clock, n });
    const k = n % 5;
    const dx = k === 0 ? 0 : (k % 2 ? 1 : -1) * 8 * Math.ceil(k / 2);
    const t = this.scene.add.text(s.x + dx, s.y - headPx, crit ? `${Math.round(amount)}×` : Math.round(amount).toString(), {
      fontFamily: FONT.mono, fontSize: crit ? '17px' : '13px', fontStyle: 'bold',
      color: crit ? CSS.priority : CSS.known, stroke: CSS.shadow, strokeThickness: 3
    }).setOrigin(0.5, 1).setDepth(DEPTH.label);
    t.setAlpha(1);
    this.scene.tweens.add({ targets: t, y: s.y - headPx - 22, alpha: 0, duration: 800, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  /** Takes world-grid coordinates; drawn by CombatVfx as survey ink debris. */
  addHitFx(x: number, y: number, color: number): void {
    const s = this.worldToScreen(x, y);
    this.vfx.impact(s.x, s.y - 4, color, false, 3);
  }

  /** Dash: two bone afterimages + a ground drag mark (03 §8 Special). Visual only. */
  onDash(): void {
    const p = this.player.sprite;
    const from = { x: p.x, y: p.y };
    for (let i = 0; i < 2; i++) {
      this.scene.time.delayedCall(i * 40, () => {
        if (!p.scene) return;
        const ghost = this.scene.add.image(p.x, p.y, p.texture.key, p.frame.name)
          .setOrigin(p.originX, p.originY).setScale(p.scaleX, p.scaleY).setFlipX(p.flipX)
          .setAlpha(0.35).setDepth(p.depth - 0.001).setBlendMode(Phaser.BlendModes.ADD);
        this.scene.tweens.add({ targets: ghost, alpha: 0, duration: 160, onComplete: () => ghost.destroy() });
      });
    }
    this.scene.time.delayedCall(140, () => { if (p.scene) this.vfx.drag(from.x, from.y, p.x, p.y); });
  }

  // ---------- Update ----------

  /** C2: fixed 60Hz core ticks; render frame delta is only an accumulator input. */
  stepFrame(frameDeltaMs: number, intent: SimulationIntent, echoIntentOverride?: SimulationIntent): SimEvent[] {
    const delta = Math.max(0, Math.min(frameDeltaMs, SIM_TUNING.MAX_FRAME_DELTA_MS));
    this.simAccumulatorMs += delta;
    // Epsilon: 250ms must yield exactly 15 ticks despite binary rounding.
    let ticks = Math.floor((this.simAccumulatorMs + 1e-9) / SIM_TUNING.TICK_MS);
    if (ticks > SIM_TUNING.MAX_TICKS_PER_FRAME) {
      ticks = SIM_TUNING.MAX_TICKS_PER_FRAME;
      // Drop the excess instead of catching up on later frames.
      this.simAccumulatorMs = Math.max(0, this.simAccumulatorMs % SIM_TUNING.TICK_MS);
    } else {
      this.simAccumulatorMs = Math.max(0, this.simAccumulatorMs - ticks * SIM_TUNING.TICK_MS);
    }
    let events: SimEvent[] = [];
    if (ticks > 0) {
      // World-level spawns and ordinary room spawns commit at the tick boundary.
      this.processWorldSpawns();
      // P3-a: the echo decides BEFORE the tick from its own perception, then the
      // same core tick commits its move/fire. No separate state mutation.
      // An explicit echo intent is used ONLY by the parity/diagnostic driver;
      // normal rendered play always takes the EchoController decision.
      const policyView = this.echoPolicyView();
      const echoIntent = this.pendingCompanionIntent ?? echoIntentOverride
        ?? (policyView ? this.echoController.decide(policyView) : undefined);
      this.pendingCompanionIntent = null;
      // C3-b fix: an external action's intent must be delivered for EXACTLY
      // its remaining integer core ticks. If one frame contains more ticks than
      // the action has left, split the core call so the surplus ticks run with
      // a neutral intent. Counting is by core ticks, never by RAF frames.
      const active = this.externalLink.activeExecution;
      if (active && active.remainingTicks > 0 && ticks > active.remainingTicks) {
        const first = active.remainingTicks;
        events = stepSimulationTicks(this._sim, first, intent, echoIntent);
        this.externalLink.advanceExecution(first, this._sim.tick, this.externalLink.epoch);
        const rest = ticks - first;
        if (rest > 0) {
          const neutral: SimulationIntent = {
            move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false
          };
          events.push(...stepSimulationTicks(this._sim, rest, neutral, echoIntent));
        }
      } else {
        events = stepSimulationTicks(this._sim, ticks, intent, echoIntent);
        if (active) {
          this.externalLink.advanceExecution(ticks, this._sim.tick, this.externalLink.epoch);
        }
      }
      this.applySimEvents(events);
      this.reapDrainedLocalActionAfterTick();
      this.bumpSimVersion();
    }
    this.syncCoreEntities(delta / 1000);
    if (ticks > 0) this.updateLegacy(delta / 1000);
    return events;
  }

  resetSimulationAccumulator(): void { this.simAccumulatorMs = 0; }

  /** A dead echo that dropped its queued local command without a receipt must
   *  not leave the single-pending guard stuck. Only an actually-local row is
   *  cleared; a raw-restored/external command is never guessed as human-local. */
  private reapDrainedLocalActionAfterTick(): void {
    const pending = this.pendingLocalAction;
    if (!pending?.command || !this.echoController.pendingLocalProposal ||
        this._sim.pendingCommands.includes(pending.command)) return;
    const echo = this._sim.echo;
    if (echo && echo.data.hp > 0) return;
    this.echoAudit.record({
      tick: this._sim.tick, provenance: 'human-local', action: pending.kind,
      target: pending.target, result: 'cancelled', code: 'E_ECHO_DEAD', proposalId: pending.proposalId
    });
    this.pendingLocalAction = null;
    this.echoController.clearLocalPending();
    if (this.pendingLocalSignal?.proposalId === pending.proposalId) this.pendingLocalSignal = null;
    this.bumpSimVersion();
  }

  /** Legacy melee/attack adapter: queue a player hit; core commits it next tick. */
  enqueuePlayerHit(damage: number, fromX: number, fromY: number): void {
    enqueuePlayerHit(this._sim, damage, fromX, fromY);
  }

  /**
   * Strict dev/test-only diagnostic facade. It must NOT be used as official
   * Node/Rendered parity evidence (parity drives stepFrame/accumulator).
   */
  stepSimulationTicksForTest(ticks: number, intent: SimulationIntent): SimEvent[] {
    if (!__LAST_SIGNAL_DEV_TEST__) throw new Error('dev/test only');
    const events = stepSimulationTicks(this._sim, Math.max(0, Math.floor(ticks)), intent);
    this.applySimEvents(events);
    this.syncCoreEntities(0);
    return events;
  }

  private applySimEvents(events: SimEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'player-moved':
          if (event.dashStarted) { this.addShake(4); audio.ui(); }
          break;
        case 'player-fired':
          this.player.playFireFeedback(event.spec.kind);
          break;
        case 'echo-fired':
          this.echoController.suggestion = null;
          this.echoShotsFired += 1;
          break;
        case 'echo-moved':
          if (event.dashStarted) this.addShake(2);
          break;
        case 'echo-hurt':
          this.addShake(3);
          break;
        case 'echo-death':
          this.echoController.reset();
          this.addShake(6);
          break;
        case 'echo-spawned':
        case 'echo-despawned':
          break;
        case 'drone-step': {
          const enemy = this.enemies.find((e) => e._id === event.droneId);
          if (enemy && event.step.faceAngle !== null) enemy.sprite.setRotation(event.step.faceAngle);
          break;
        }
        case 'enemy-hit': {
          if (this.boss && this.boss._id === event.enemyId) {
            this.boss.hitFlash = event.hit.hitFlash;
            this.boss.syncPhaseFromHp();
            this.addDamageNumber(this.boss.x, this.boss.y, event.damage, event.crit);
            this.callbacks.onStats({ enemies: 0, items: 0, dmg: event.damage });
          } else {
            const enemy = this.enemies.find((e) => e._id === event.enemyId);
            if (enemy) {
              enemy.data.hitFlash = event.hit.hitFlash;
              enemy.applyVisual();
              this.addDamageNumber(enemy.x, enemy.y, event.damage, event.crit);
              this.callbacks.onStats({ enemies: 0, items: 0, dmg: event.damage });
            }
          }
          break;
        }
        case 'enemy-died': {
          if (this.boss && this.boss._id === event.enemyId) this.killBoss();
          else {
            const enemy = this.enemies.find((e) => e._id === event.enemyId);
            if (enemy) this.killEnemy(enemy);
          }
          break;
        }
        case 'enemy-spawned': {
          const e = new Enemy(this, event.kind as EnemyKind, event.x, event.y, event.room, this.roomDepth.of(event.room));
          e._id = event.id;
          e.initHp();
          if (event.kind === 'drone') {
            const droneState = this._sim.drones.find((d) => d.id === event.id);
            if (droneState) e.attachExistingSimDrone(droneState);
          } else {
            const targetState = this._sim.targets.find((t) => t.id === event.id);
            if (targetState) e.attachExistingSimTarget(targetState);
          }
          this.enemies.push(e);
          break;
        }
        case 'player-hurt':
          this.player.syncVisual();
          audio.hurt();
          this.addShake(6);
          break;
        case 'signal-scanned':
          this.lastSignalFeedback = {
            kind: 'scan', ok: event.ok !== false,
            ...(event.code ? { code: event.code } : {}), tick: this._sim.tick
          };
          this.settlePendingLocalSignal('scan', event.ok !== false, event.code);
          this.callbacks.onSignalChanged?.();
          break;
        case 'signal-jammed':
          this.lastSignalFeedback = {
            kind: 'jam', ok: event.ok !== false,
            ...(event.code ? { code: event.code } : {}), tick: this._sim.tick
          };
          this.settlePendingLocalSignal('jam', event.ok !== false, event.code);
          this.callbacks.onSignalChanged?.();
          break;
        case 'signal-relay-changed':
          this.settlePendingLocalSignal('toggle-relay', true, undefined);
          this.callbacks.onSignalChanged?.();
          break;
        case 'player-death':
          this.onPlayerDeath();
          break;
        case 'player-healed':
          this.player.syncVisual();
          audio.pickup();
          break;
        case 'currency-gained':
        case 'xp-gained':
          this.player.syncVisual();
          break;
        case 'player-levelup':
          this.onLevelUp(event.level);
          break;
        case 'player-upgraded':
          this.player.syncVisual();
          break;
        case 'supply-purchase-result':
          this.supplyReceipts.set(event.transactionId, {
            transactionId: event.transactionId, offerKey: event.offerKey, roomId: event.roomId,
            ok: event.ok, reason: event.reason, price: event.price,
            currency: event.currency, hp: event.hp, weaponKey: event.weaponKey
          });
          // Receipts are a bounded UI cache, not the authority: drop the oldest
          // entries once past the ledger cap. The core ledger stays authoritative.
          while (this.supplyReceipts.size > PURCHASE_LEDGER_CAP) {
            const oldest = this.supplyReceipts.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            this.supplyReceipts.delete(oldest);
          }
          this.player.syncVisual();
          break;
        case 'enemy-spawned':
          this.spawnEnemyFromCore(event as any);
          break;
        case 'room-cleared': {
          // GAMEPLAY-01 P4 / M1: the CORE owns the one authoritative room-clear
          // commit. The presenter only reacts (seal, authored portal, callback)
          // and never re-writes the flag, so World and Headless cannot diverge.
          const cleared = this.map.rooms[event.roomId];
          if (!cleared) break;
          this.clearRoomSeal();
          if (this.p1Scenario && this.p1Scenario.roomId === cleared.id) this.updateP1RoutePortal();
          else if (this.map.deck !== undefined && !this.won) this.placePortal(cleared);
          this.callbacks.onRoomCleared(cleared);
          break;
        }
        case 'room-generated': {
          const room = this.map.rooms[event.roomId];
          if (room) {
            // The room's generation has now committed: enemies/loot exist.
            // Only from here on may updateRoom() evaluate the cleared state.
            room.spawned = true;
            this.pendingRoomEnters.delete(room.id);
          }
          if (room && event.portalTarget !== null && event.portalTarget !== undefined) {
            this.placePortalForTarget(room, event.portalTarget);
          }
          break;
        }
        case 'loot-dropped':
          this.syncCoreLoot();
          break;
        case 'loot-collected':
          this.syncCoreLoot();
          this.callbacks.onStats({ enemies: 0, items: 1, dmg: 0 });
          this.addHitFx(event.x, event.y, event.kind === 'health' ? 0xff3355 : 0xffd233);
          break;
        case 'projectile-wall':
          this.addHitFx(event.x, event.y, 0x88aacc);
          break;
      }
    }
  }

  private spawnEnemyFromCore(event: { id: number; kind: string; x: number; y: number; room: number }): void {
    if (this.enemies.some((e) => e._id === event.id)) return;
    const droneState = this._sim.drones.find((d) => d.id === event.id);
    const targetState = this._sim.targets.find((t) => t.id === event.id);
    if (!droneState && !targetState) return;
    const e = new Enemy(this, event.kind as EnemyKind, event.x, event.y, event.room, this.roomDepth.of(event.room));
    e._id = event.id;
    if (droneState) e.attachExistingSimDrone(droneState);
    else if (targetState) e.attachExistingSimTarget(targetState);
    this.enemies.push(e);
  }

  private syncCoreEntities(dt: number): void {
    this.player.syncVisual(dt);
    this.syncEchoVisual();
    this.syncSignalVisual();
    this.syncCoreLoot();
    for (const drone of this._sim.drones) {
      const enemy = this.enemies.find((e) => e._id === drone.id);
      if (enemy) enemy.applyVisual();
    }
    const alive = new Set<number>();
    for (const projectile of this._sim.projectiles) {
      alive.add(projectile.id);
      let view = this.coreProjectileViews.get(projectile.id);
      if (!view) {
        const screen = this.worldToScreen(projectile.pos.x, projectile.pos.y);
        const spr = this.scene.add.sprite(screen.x, screen.y, this.projSprite(projectile.kind, projectile.side === 'enemy'));
        spr.setDepth(80);
        spr.setScale(projectile.side === 'enemy' ? 1.4 : 1.1);
        if (projectile.side === 'enemy') spr.setTint(0xff5533);
        view = { spr, data: projectile };
        this.coreProjectileViews.set(projectile.id, view);
      }
      view.data = projectile;
      const screen = this.worldToScreen(projectile.pos.x, projectile.pos.y);
      view.spr.setPosition(screen.x, screen.y);
    }
    for (const [id, view] of this.coreProjectileViews) {
      if (alive.has(id)) continue;
      if (view.spr.scene) view.spr.destroy();
      this.coreProjectileViews.delete(id);
    }
  }

  /** Code-native companion visuals: distinct body, facing wedge, target line. */
  private syncEchoVisual(): void {
    const echo = this._sim.echo;
    if (!echo) {
      if (this.echoSprite) { this.echoSprite.destroy(); this.echoSprite = null; }
      if (this.echoLine) { this.echoLine.destroy(); this.echoLine = null; }
      return;
    }
    if (!this.echoSprite) {
      const g = this.scene.add.graphics();
      g.fillStyle(0x33e0ff, 1); g.fillCircle(0, 0, 10);
      g.lineStyle(2, 0xffffff, 0.9); g.strokeCircle(0, 0, 10);
      g.fillStyle(0xeafaff, 1); g.fillTriangle(11, 0, 2, -5, 2, 5);
      this.echoSprite = this.scene.add.container(0, 0, [g]).setDepth(75);
    }
    const screen = this.worldToScreen(echo.x, echo.y);
    this.echoSprite.setPosition(screen.x, screen.y);
    this.echoSprite.setRotation(echo.aimYaw);
    this.echoSprite.setAlpha(echo.data.hp > 0 ? 1 : 0.25);
    if (!this.echoLine) this.echoLine = this.scene.add.graphics().setDepth(74);
    this.echoLine.clear();
    const view = this.echoView();
    let target: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const drone of [...(view?.drones ?? []), ...(view?.targets ?? [])]) {
      const d = Math.hypot(drone.x - echo.x, drone.y - echo.y);
      if (d < bestD) { target = drone; bestD = d; }
    }
    if (target) {
      const t = this.worldToScreen(target.x, target.y);
      this.echoLine.lineStyle(1, 0x33e0ff, this.echoController.assistConfirmed ? 0.6 : 0.25);
      this.echoLine.lineBetween(screen.x, screen.y, t.x, t.y);
    }
  }

  /** Code-native relay visual: device sprite coloured by relay state plus a
   *  target line from ECHO to the relay when alive and discovered/in range.
   *  No hidden state. */
  private syncSignalVisual(): void {
    const sig = this._sim.signal;
    if (!sig) {
      if (this.signalSprite) { this.signalSprite.destroy(); this.signalSprite = null; }
      if (this.signalLine) { this.signalLine.destroy(); this.signalLine = null; }
      return;
    }
    const color = sig.relay === 'ACTIVE' ? 0x00ff77
      : sig.relay === 'JAMMED' ? 0xff3333
      : sig.relay === 'DISABLED' ? 0x444444
      : 0x7777ff;
    if (!this.signalSprite) {
      const g = this.scene.add.graphics();
      g.fillStyle(color, 1); g.fillCircle(0, 0, 9);
      g.lineStyle(2, 0xffffff, 0.9); g.strokeCircle(0, 0, 9);
      g.fillStyle(0xeafaff, 1); g.fillTriangle(10, 0, 2, -5, 2, 5);
      this.signalSprite = this.scene.add.container(0, 0, [g]).setDepth(75);
    } else {
      const g = this.signalSprite.getAt(0) as Phaser.GameObjects.Graphics;
      g.clear();
      g.fillStyle(color, 1); g.fillCircle(0, 0, 9);
      g.lineStyle(2, 0xffffff, 0.9); g.strokeCircle(0, 0, 9);
      g.fillStyle(0xeafaff, 1); g.fillTriangle(10, 0, 2, -5, 2, 5);
    }
    const screen = this.worldToScreen(sig.x, sig.y);
    this.signalSprite.setPosition(screen.x, screen.y);

    const echo = this._sim.echo;
    if (!this.signalLine) this.signalLine = this.scene.add.graphics().setDepth(74);
    this.signalLine.clear();
    if (echo && echo.data.hp > 0) {
      const discovered = sig.evidence.some((e) => e.id === sig.deviceId);
      const within = Math.hypot(echo.x - sig.x, echo.y - sig.y) <= 12;
      if (discovered || within) {
        const t = this.worldToScreen(sig.x, sig.y);
        const eScreen = this.worldToScreen(echo.x, echo.y);
        this.signalLine.lineStyle(1, color, sig.relay === 'ACTIVE' ? 0.8 : 0.5);
        this.signalLine.lineBetween(eScreen.x, eScreen.y, t.x, t.y);
      }
    }
  }

  /**
   * Legal, echo-centred visibility for an enemy: the same grid radius +
   * explored-room + wall LOS predicate used by the companion. Enemies never
   * learn about an actor they cannot see.
   */
  private isActorVisibleFrom(self: { x: number; y: number }, x: number, y: number): boolean {
    return gridLineOfSight({ x, y }, {
      center: { x: self.x, y: self.y },
      radiusTiles: WORLD_PERCEPTION.radiusTiles,
      isExplored: (sx, sy) => this.isExploredCell(sx, sy),
      isOpaque: (sx, sy) => this.isOpaqueCell(sx, sy),
      stepTiles: WORLD_PERCEPTION.losStepTiles
    });
  }

  /**
   * Read-only actor view + legal damage facade for legacy enemies. The player is
   * always a candidate (frozen no-echo behaviour); the ECHO is only a candidate
   * when it is actually visible to that enemy. Ties keep the player.
   */
  private enemyCombatPort(self: { x: number; y: number }): ActorCombatPort | null {
    const candidates: ActorTargetView[] = [];
    if (this._sim.player.data.hp > 0) {
      candidates.push({
        actorId: 0, kind: 'player',
        x: this._sim.player.x, y: this._sim.player.y,
        hp: this._sim.player.data.hp, alive: true
      });
    }
    const echo = this._sim.echo;
    if (echo && echo.data.hp > 0 && this.isActorVisibleFrom(self, echo.x, echo.y)) {
      candidates.push({
        actorId: ECHO_ACTOR_ID, kind: 'echo',
        x: echo.x, y: echo.y, hp: echo.data.hp, alive: true
      });
    }
    const target = chooseNearestActor(self, candidates);
    if (!target) return null;
    return {
      target,
      hurtTarget: (amount: number, fromX: number, fromY: number): boolean => {
        if (target.kind === 'player') return this.player.hurt(amount, fromX, fromY);
        // Echo damage is a queued core command; the legacy adapter never writes
        // authoritative HP and never bypasses processCommands.
        enqueueEchoHit(this._sim, amount, fromX, fromY);
        this.bumpSimVersion();
        return true;
      }
    };
  }

  private updateLegacy(dt: number): void {
    this.clock += dt;
    for (const e of this.enemies) {
      if (e.data.kind === 'drone') continue; // core owns drone FSM and timers
      const port = this.enemyCombatPort(e);
      if (port) e.update(dt, port);
      e.applyVisual(dt, this.clock);
    }
    if (this.boss) {
      const port = this.enemyCombatPort(this.boss);
      if (port) this.boss.update(dt, port);
    }
    this.updateRoom();
    this.player.updateView(dt);
    this.updateFx(dt);
    this.updateCamera(dt);
    if (this.renderer) {
      this.renderer.update(dt);
      this.renderer.updateLight(this.player.wx, this.player.wy);
    }
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 10);
  }

  private syncCoreLoot(): void {
    const alive = new Set<number>();
    for (const loot of this._sim.loot) {
      alive.add(loot.id);
      let view = this.coreLootViews.get(loot.id);
      if (!view) {
        const s = this.worldToScreen(loot.x, loot.y);
        const kind = loot.kind as ItemKind;
        const spr = this.scene.add.sprite(s.x, s.y, 'icon_' + (kind === 'currency' ? 'currency' : kind === 'health' ? 'health' : 'upgrade'));
        spr.setDepth(70);
        view = { spr, data: { x: loot.x, y: loot.y, kind, key: loot.key, amount: loot.amount, bob: loot.bob } };
        this.coreLootViews.set(loot.id, view);
      }
      view.data = { x: loot.x, y: loot.y, kind: loot.kind as ItemKind, key: loot.key, amount: loot.amount, bob: loot.bob };
      const screen = this.worldToScreen(loot.x, loot.y);
      view.spr.setPosition(screen.x, screen.y);
    }
    for (const [id, view] of this.coreLootViews) {
      if (alive.has(id)) continue;
      if (view.spr.scene) view.spr.destroy();
      this.coreLootViews.delete(id);
    }
  }

  private updateFx(dt: number): void {
    // Bolts (player pulse / hostile) and hostile telegraphs, read from live state.
    const bolts: BoltView[] = [];
    for (const p of this.projectiles) {
      const a = this.worldToScreen(p.data.pos.x, p.data.pos.y);
      const b = this.worldToScreen(p.data.pos.x + p.data.vel.x * 0.01, p.data.pos.y + p.data.vel.y * 0.01);
      bolts.push({ x: a.x, y: a.y, vx: b.x - a.x, vy: b.y - a.y, enemy: p.data.side === 'enemy', kind: (p.spr as any).__kind ?? 'pulse' });
    }
    const tele: TelegraphView[] = [];
    const ps = this.player.sprite;
    for (const e of this.enemies) {
      const v = e.view;
      if (!v || v.telegraph <= 0 || !this.player.alive) continue;
      const ap = v.aperture();
      const melee = !!e.data.stats.reachEnemy;
      tele.push({
        ax: melee ? e.sprite.x : ap.x, ay: melee ? e.sprite.y : ap.y,
        tx: ps.x, ty: melee ? ps.y : ps.y - BOLT_HEIGHT,
        strength: v.telegraph, melee, detect: e.data.state === 'detect',
        // melee reach used by Enemy.doAttack: attackRange + 1.5 tiles, in screen px (iso x-scale)
        reach: (e.data.stats.attackRange + 1.5) * GAME.TILE_W / Math.SQRT2,
      });
    }
    this.vfx.update(dt, bolts, tele);
  }

  private killEnemy(e: Enemy): void {
    // Core already committed HP/death, XP, currency and drop RNG. The adapter
    // only removes presentation and emits stats.
    this.damageStack.delete(e._id);
    this.enemyDeathVisual(e);
    e.sprite.destroy();
    this.callbacks.onStats({ enemies: 1, items: 0, dmg: 0 });
    this.enemies = this.enemies.filter((x) => x !== e);
  }

  /**
   * Death (03 §8): the mass collapses inward (400 ms), the aperture goes out, and
   * the wreck's ink outline stays 2 s before fading to dotted "history". Visual only;
   * it runs after the kill was resolved and never delays drops / XP / room clear.
   */
  private enemyDeathVisual(e: Enemy): void {
    const sp = e.sprite;
    if (!sp?.scene) return;
    const frame = String(sp.frame.name).replace(/_flash$/, '');
    const husk = this.scene.add.image(sp.x, sp.y, sp.texture.key, `${frame.startsWith('tele') ? 'idle_0' : frame}_flash`)
      .setOrigin(sp.originX, sp.originY).setFlipX(sp.flipX).setDepth(sp.depth).setAlpha(0.9);
    const body = this.scene.add.image(sp.x, sp.y, sp.texture.key, frame.startsWith('tele') ? 'idle_0' : frame)
      .setOrigin(sp.originX, sp.originY).setFlipX(sp.flipX).setDepth(sp.depth);
    this.scene.tweens.add({ targets: husk, alpha: 0, duration: 90, onComplete: () => husk.destroy() });
    this.scene.tweens.add({ targets: body, scaleY: 0.25, scaleX: 1.15, alpha: 0, duration: 400, ease: 'Cubic.easeIn', onComplete: () => body.destroy() });
    const w = e.view ? e.view.art.shadowW : 32;
    this.vfx.wreck(sp.x, sp.y, w, e.data.kind);
    this.vfx.impact(sp.x, sp.y - 14, INK.known, false, 6);
  }

  private killBoss(): void {
    if (!this.boss) return;
    const bossRoom = this.map.rooms[this.boss.spawnRoom];
    this.boss.sprite.destroy();
    this.boss = null;
    this.clearRoomSeal();
    if (this.nextDeck !== undefined) {
      for (const enemy of this.enemies) enemy.sprite.destroy();
      this.enemies = [];
      for (const projectile of this.projectiles) this.destroyProjectileSprite(projectile);
      this.projectiles = [];
      bossRoom.cleared = true;
      this.callbacks.onStats({ enemies: 1, items: 0, dmg: 0 });
      this.placePortal(bossRoom);
      this.callbacks.onRoomCleared(bossRoom);
      this.player.addXp(60);
      return;
    }
    this.won = true;
    this.callbacks.onStats({ enemies: 1, items: 0, dmg: 0 });
    this.player.addXp(200);
    if (this.map.deck === undefined) {
      const bx = this.player.x, by = this.player.y;
      for (let i = 0; i < 12; i++) this.spawnLoot(bx + (Math.random() - 0.5) * 120, by + (Math.random() - 0.5) * 120, 'currency', 'currency', 10);
    }
    audio.bossroar();
    this.callbacks.onBossWin();
  }

  won = false;

  // ---------- Camera ----------

  private cam!: Phaser.Cameras.Scene2D.Camera;
  private camX = 0;
  private camY = 0;

  updateCamera(_dt: number): void {
    // Camera is driven by HUDScene/GameScene using player world position.
    this.camX = this.player.x;
    this.camY = this.player.y;
  }

  // ---------- Death / level ----------

  onPlayerDeath(): void {
    this.player.respawn = true;
    this.callbacks.onDeath();
  }

  onLevelUp(level: number): void {
    this.callbacks.onLevelUp(level);
  }

  captureCheckpoint(id: string, seed: number, stats: RunCheckpoint['stats']): RunCheckpoint | null {
    const room = this.currentRoom();
    if (!room || !this.map.rooms[room.id].cleared || !this.player.alive ||
        this.won || this.boss || this.enemies.some((enemy) => enemy.alive) ||
        this.map.rooms.some((entry) => entry.spawned && !entry.cleared)) return null;
    // Checkpoint must only capture fully committed transactions. If commands
    // are still pending (enqueued but not yet consumed by processCommands),
    // refuse to capture — the caller must wait for the next stepFrame commit.
    if (this.hasUncommittedCommands()) return null;
    // Deep copy: the returned frame must not keep references to the live
    // player / loot. Any in-memory holder (AI harness, checkpoint UI, test)
    // would otherwise observe silently mutating "snapshots" (review R-03).
    return cloneCheckpoint({
      id, seed, deck: this.map.deck, stats, roomId: room.id,
      ...(this.p1Scenario ? { demo: this.p1Scenario.id } : {}),
      position: { x: this.player.x, y: this.player.y },
      clearedRooms: this.map.rooms.filter((entry) => entry.cleared).map((entry) => entry.id),
      portalTarget: this.currentRoomId === room.id ? this.portal?.targetRoom ?? null : null,
      rngState: this.rng.snapshot(),
      player: this.player.data,
      loot: this._sim.loot.map((l) => ({ x: l.x, y: l.y, kind: l.kind as ItemKind, key: l.key, amount: l.amount, bob: l.bob })),
      coreState: {
        tick: this._sim.tick,
        rngState: this._sim.rngState,
        playerTimers: {
          dashTimer: this._sim.player.dashTimer, invuln: this._sim.player.invuln,
          hurtTimer: this._sim.player.hurtTimer, fireTimer: this._sim.player.fireTimer, aimYaw: this._sim.player.aimYaw
        },
        nextProjectileId: this._sim.nextProjectileId,
        purchaseTransactions: [...this._sim.purchaseTransactions],
        // Optional echo / Signal snapshots: deep-copied by cloneCheckpoint.
        ...(this._sim.echo ? { echo: this._sim.echo } : {}),
        ...(this._sim.signal ? { signal: this._sim.signal } : {})
      }
    });
  }

  restoreCheckpoint(run: RunCheckpoint): boolean {
    if (run.demo === P1_DEMO_ID && !this.setupP1Scenario()) return false;
    const room = this.map.rooms[run.roomId];
    if (!room || !run.clearedRooms.every((id) => this.map.rooms[id] &&
          (this.map.rooms[id].kind !== 'boss' || this.nextDeck !== undefined)) ||
        (run.portalTarget !== null && !room.connectedTo.includes(run.portalTarget))) return false;

    for (const id of run.clearedRooms) {
      this.map.rooms[id].cleared = this.map.rooms[id].spawned = true;
      this.enteredRooms.add(id);
    }
    // F-08: deep copy the incoming frame before assigning it to the live state.
    const frame = cloneCheckpoint(run);
    this.#setPlayerData(frame.player);
    // Capture the checkpoint's HP *before* reset(): reset() heals to full, but a
    // resumed run must keep exactly the HP it had when the checkpoint was saved.
    const restoredHp = this.player.data.hp;
    const { x, y } = run.position;
    const inside = x >= room.gx && x < room.gx + room.w && y >= room.gy && y < room.gy + room.h;
    const position = inside && this.isWalkable(x, y) ? run.position : this.findWalkableInRoom(room);
    this.#resetPlayer(position.x, position.y);
    this._sim.player.data.hp = restoredHp;
    this.bumpSimVersion();
    this.currentRoomId = room.id;
    // Visual: rooms surveyed before the checkpoint are drawn immediately (no pulse).
    for (const id of new Set([...run.clearedRooms, room.id])) this.renderer?.observeRoom(id, 0, 0, true);
    if (this.p1Scenario && this.p1Scenario.roomId === room.id) {
      // P4/M2: the authored portal is re-derived from the COMMITTED relay state
      // after a restore; a saved portalTarget can never resurrect a stale door.
      this.lastP1RouteTarget = -1;
      this.updateP1RoutePortal();
    } else {
      this.placePortal(room, run.portalTarget);
    }
    this.rng.restore(run.rngState);
    this._sim.tick = 0;
    this._sim.drones = [];
    this._sim.targets = [];
    this._sim.projectiles = [];
    this._sim.pendingPlayerHits = [];
    // Restore must not inherit uncommitted commands/spawns from a prior live run.
    // The processed-purchase ledger is part of committed history: it is restored
    // from the checkpoint below (and only cleared when the checkpoint lacks it).
    this._sim.pendingCommands = [];
    this.worldSpawns = [];
    this.pendingRoomEnters.clear();
    this._sim.loot = [];
    this._sim.player.dashTimer = 0; this._sim.player.invuln = 0; this._sim.player.hurtTimer = 0;
    this._sim.player.fireTimer = 0; this._sim.player.aimYaw = 0;
    if (run.coreState) {
      // Restore the authoritative fixed-tick core contract so the resumed run
      // keeps the exact tick / RNG / timer / projectile-id sequence it had at
      // save time. Without this the core would silently re-randomise.
      this._sim.tick = run.coreState.tick;
      this._sim.rngState = run.coreState.rngState;
      const t = run.coreState.playerTimers;
      this._sim.player.dashTimer = t.dashTimer; this._sim.player.invuln = t.invuln;
      this._sim.player.hurtTimer = t.hurtTimer; this._sim.player.fireTimer = t.fireTimer; this._sim.player.aimYaw = t.aimYaw;
      this._sim.nextProjectileId = run.coreState.nextProjectileId;
      this._sim.purchaseTransactions = Array.isArray(run.coreState.purchaseTransactions)
        ? [...run.coreState.purchaseTransactions]
        : [];
      // Old saves have no echo: leave the run solo-compatible.
      if (run.coreState.echo) {
        this._sim.echo = JSON.parse(JSON.stringify(run.coreState.echo)) as typeof this._sim.echo;
      } else {
        delete this._sim.echo;
      }
      if (run.coreState.signal) {
        this._sim.signal = JSON.parse(JSON.stringify(run.coreState.signal)) as typeof this._sim.signal;
      } else {
        delete this._sim.signal;
      }
    } else {
      // Legacy frame: re-derive the core RNG from the map seed so a restored
      // run still produces a deterministic core stream.
      this._sim.rngState = new RNG(run.seed * 7919 + 1).snapshot();
    }
    // P3-a fix: a restore may NEVER inherit an old assist confirmation, mode,
    // memory or pending intent. Echo HP comes verbatim from the checkpoint.
    this.echoController.reset();
    this.resetEchoCooperationRuntime();
    this.echoShotsFired = 0;
    for (const view of this.coreProjectileViews.values()) if (view.spr.scene) view.spr.destroy();
    this.coreProjectileViews.clear();
    this._sim.loot = run.loot.map((drop, i) => ({ id: i + 1, x: drop.x, y: drop.y, kind: drop.kind as SimLootKind, key: drop.key, amount: drop.amount, bob: drop.bob }));
    this._sim.nextLootId = run.loot.length + 1;
    this.bumpSimVersion();
    return true;
  }

  reset(): void {
    for (const e of this.enemies) e.sprite.destroy();
    this.enemies = [];
    // P3-a fix: a restore may NEVER inherit an old assist confirmation, mode,
    // memory or pending intent. Echo HP comes verbatim from the checkpoint.
    this.echoController.reset();
    this.resetEchoCooperationRuntime();
    this.echoShotsFired = 0;
    for (const view of this.coreProjectileViews.values()) if (view.spr.scene) view.spr.destroy();
    this.coreProjectileViews.clear();
    this._sim.drones = [];
    this._sim.targets = [];
    this._sim.projectiles = [];
    for (const l of this.loot) l.spr.destroy();
    this.loot = [];
    this.boss = null;
    delete this._sim.echo;
    this.pendingCompanionIntent = null;
    this.echoController.reset();
    this.resetEchoCooperationRuntime();
    this.echoShotsFired = 0;
    if (this.echoSprite) { this.echoSprite.destroy(); this.echoSprite = null; }
    if (this.echoLine) { this.echoLine.destroy(); this.echoLine = null; }
  }

  statsSnapshot(): { enemies: number; items: number; dmg: number } {
    return { enemies: 0, items: 0, dmg: 0 };
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as any)) deepFreeze((value as any)[key]);
    Object.freeze(value as any);
  }
  return value;
}
