// VS-00 minimal causal model: Scan -> Jam -> Door, plus a fixed-tick energy/cooldown loop.
// Pure TypeScript (no Phaser / no DOM), so it can be unit-tested in the node Vitest env.
import {
  canFit,
  ROOM,
  distanceToReceiver,
  distanceToSource,
  hasLineOfSight,
  isOccupyingDoor,
  isWalkableCell,
} from './room';
import { Corridor, type CorridorCheckpoint, type CorridorReveal, type CorridorSnapshot } from './corridor';
import { CORRIDOR } from './corridorRoom';
import { SLICE } from './tuning';
import type { FullSliceState, SliceEvidenceV1 } from './fullState';
import { isSliceEvidenceArray } from './fullState';

export { SLICE } from './tuning';

export type DoorState = 'SEALED' | 'JAMMED_OPEN' | 'OPEN' | 'CLOSED' | 'SAFE_PENDING_CLOSE';

export type ResultCode =
  | 'OK'
  | 'E_ENERGY_INSUFFICIENT'
  | 'E_COOLDOWN'
  | 'E_RETRYABLE'
  | 'E_LINK_UNAVAILABLE'
  | 'E_ILLEGAL_TARGET'
  | 'E_PAUSED'
  | 'E_PERMISSION';

export type ActionAvailabilityStatus =
  | 'available' | 'unavailable' | 'cooldown' | 'insufficient_energy' | 'permission_denied';

export interface ActionAvailability {
  readonly type: 'move' | 'scan' | 'jam' | 'interact' | 'shoot_guard' | 'wait' | 'aim' | 'fire' | 'decoy';
  readonly status: ActionAvailabilityStatus;
  readonly reasonCode?: ResultCode | 'E_NOT_APPLICABLE';
}

export interface ActionResult {
  code: ResultCode;
  message: string;
  cost: number;
}

export interface SliceReveal {
  doorReceiver: boolean;
  sealSource: boolean;
  link: boolean;
}

export interface SliceSnapshot {
  tick: number;
  energy: number;
  doorState: DoorState;
  doorPassable: boolean;
  jamActive: boolean;
  jamRemainingTicks: number;
  jamCooldownTicks: number;
  scanCooldownTicks: number;
  scanRevealTicks: number;
  safeClearTicks: number;
  occupancy: boolean;
  passed: boolean;
  paused: boolean;
  manualOpenIntent: boolean;
  sealSourcePresent: boolean;
  pendingSafeClose: boolean;
  position: { x: number; y: number };
  reveal: SliceReveal | null;
  corridor: CorridorSnapshot | null;
  corridorReveal: CorridorReveal | null;
}

export interface PersistedSliceState {
  schema: 'last_signal_station_zero_vs00_v1';
  version: 1;
  roomId: 'station-zero-r1';
  energy: number;
  tick: number;
  doorState: DoorState;
  manualOpenIntent: boolean;
  sealSourcePresent: boolean;
  passed: boolean;
  position: { x: number; y: number };
  corridor?: CorridorCheckpoint;
  /**
   * P1 R9 COMPATIBLE EXTENSION (optional; key/schema/version unchanged).
   * Old saves without this field are still readable but their active scan
   * evidence is cleared and a rescan is required.
   */
  evidence?: SliceEvidenceV1[];
  remaining: {
    jam: number;
    jamCooldown: number;
    scanCooldown: number;
    scanReveal: number;
    safeClear: number;
    regenAcc: number;
  };
}

const START_HINT = 'WASD 移动 · Z 扫描 · X 压制 · F 开门尝试 · Esc 暂停';

/** Optional headless scan provenance recorded with R9 evidence (never resampled on restore). */
export interface ScanProvenance {
  readonly sourceActionId?: string;
  readonly observerActorId?: string;
  readonly sceneEpoch?: number;
}

function evidenceProvenance(p?: ScanProvenance): Pick<SliceEvidenceV1, 'sourceActionId' | 'observerActorId' | 'sceneEpoch'> {
  if (!p) return {};
  return {
    ...(p.sourceActionId !== undefined ? { sourceActionId: p.sourceActionId } : {}),
    ...(p.observerActorId !== undefined ? { observerActorId: p.observerActorId } : {}),
    ...(p.sceneEpoch !== undefined ? { sceneEpoch: p.sceneEpoch } : {}),
  };
}

export class SliceModel {
  private energyValue: number = SLICE.ENERGY_MAX;
  private tickIndex = 0;
  private door: DoorState = 'SEALED';
  private manualOpenIntent = false;
  private sealSourcePresent = true;
  private jamRemainingTicks = 0;
  private jamCooldownTicks = 0;
  private scanCooldownTicks = 0;
  private scanRevealTicks = 0;
  private revealDoorReceiver = false;
  private revealSealSource = false;
  private pendingSafeClose = false;
  private safeClearTicks: number = SLICE.SAFE_CLEAR_DELAY_TICKS;
  private regenAcc = 0;
  private accumulatorMs = 0;
  private playerX: number = ROOM.spawn.x;
  private playerY: number = ROOM.spawn.y;
  private occupancy = false;
  private passedFlag = false;
  private pausedFlag = false;
  private corridor: Corridor | null = null;
  private corridorReveal: CorridorReveal | null = null;
  private lastRelayInteractTick = -1;
  private evidence: SliceEvidenceV1[] = [];
  private evidenceRescanRequired = false;

  lastResult: ActionResult = { code: 'OK', message: START_HINT, cost: 0 };

  constructor(persisted?: PersistedSliceState | null) {
    if (persisted) this.restore(persisted);
  }

  get energy(): number { return this.energyValue; }
  get doorState(): DoorState { return this.door; }
  get passed(): boolean { return this.passedFlag; }
  get paused(): boolean { return this.pausedFlag; }
  get tick(): number { return this.tickIndex; }
  /** Read-only authoritative position; the Scene must draw from this after restore. */
  get position(): { x: number; y: number } { return this.corridor?.position ?? { x: this.playerX, y: this.playerY }; }
  get inCorridor(): boolean { return this.corridor !== null; }
  get failed(): boolean { return this.corridor !== null && !this.corridor.alive; }
  get canCheckpoint(): boolean { return !this.corridor || this.corridor.canSave; }
  get jamActive(): boolean { return this.jamRemainingTicks > 0; }
  get doorPassable(): boolean {
    return this.door === 'JAMMED_OPEN' || this.door === 'OPEN' || this.door === 'SAFE_PENDING_CLOSE';
  }
  /** True when an old save without evidence was restored; hint the user to rescan. */
  get evidenceRescanRequiredFlag(): boolean { return this.evidenceRescanRequired; }
  get evidenceSnapshot(): readonly SliceEvidenceV1[] { return this.evidence.map((e) => ({ ...e, position: { ...e.position } })); }

  /**
   * Update the authoritative player position. Occupancy is derived from the same
   * AABB footprint the Scene uses for movement collision.
   */
  setPlayerPos(x: number, y: number): void {
    if (this.corridor) {
      this.corridor.moveTo(x, y);
      return;
    }
    this.playerX = x;
    this.playerY = y;
    this.occupancy = isOccupyingDoor(x, y);
  }

  /** Shared collision query for any actor position (human or ECHO). */
  canStandAt(x: number, y: number): boolean {
    return this.corridor?.canStand(x, y) ??
      canFit(x, y, (cx, cy) => isWalkableCell(cx, cy, this.doorPassable));
  }

  canStand(x: number, y: number): boolean {
    return this.canStandAt(x, y);
  }

  enterCorridor(): boolean {
    if (this.corridor || this.paused || !this.passed ||
        Math.hypot(this.playerX - ROOM.exit.x, this.playerY - ROOM.exit.y) >= 0.45) return false;
    this.corridor = new Corridor();
    // Door-only effects/evidence stay in R1. Shared energy/cooldowns carry over.
    this.jamRemainingTicks = 0;
    this.scanRevealTicks = 0;
    this.revealDoorReceiver = this.revealSealSource = false;
    this.evidence = [];
    this.evidenceRescanRequired = false;
    this.solveDoor();
    this.ok('失稳走廊：可清除守卫，或按 G 压制守卫后用 F 建桥。', 0);
    return true;
  }

  /** Domain hook for connection-change tests. The UI never exposes free source toggling. */
  setSealSourcePresent(present: boolean): void {
    this.sealSourcePresent = present;
    this.solveDoor();
  }

  setPaused(paused: boolean): void {
    this.pausedFlag = paused;
    this.accumulatorMs = 0;
  }

  /**
   * Fixed 60 Hz accumulator. The lab retains its door occupancy order.
   * In the corridor, deadlines resolve against the previous position before movement.
   */
  step(deltaMs: number, onTick?: () => void, onCommit?: (before: SliceSnapshot) => void): number {
    if (this.pausedFlag || this.failed) {
      this.accumulatorMs = 0;
      return 0;
    }
    const clamped = Math.min(Math.max(deltaMs, 0), SLICE.MAX_FRAME_DELTA_MS);
    this.accumulatorMs += clamped;
    let advanced = 0;
    while (this.accumulatorMs >= SLICE.TICK_MS && advanced < SLICE.MAX_TICKS_PER_FRAME && !this.failed) {
      const before = this.snapshot();
      this.tickOnce(onTick);
      onCommit?.(before);
      this.accumulatorMs -= SLICE.TICK_MS;
      advanced++;
    }
    if (advanced === SLICE.MAX_TICKS_PER_FRAME) {
      // Drop whole-tick backlog, keep only the sub-tick remainder (no offline catch-up).
      this.accumulatorMs = this.accumulatorMs % SLICE.TICK_MS;
    }
    return advanced;
  }

  /**
   * Fixed-tick stepping for the headless core: advances exactly `ticks` logic
   * ticks (no wall clock, no frame accumulator). Same tickOnce ordering as the
   * browser path, so lab (move then expiry) and corridor (expiry then move)
   * semantics cannot diverge.
   */
  advanceTicks(ticks: number, onTick?: () => void, onCommit?: (before: SliceSnapshot) => void): number {
    if (this.pausedFlag || this.failed) {
      this.accumulatorMs = 0;
      return 0;
    }
    let advanced = 0;
    while (advanced < ticks && !this.failed) {
      const before = this.snapshot();
      this.tickOnce(onTick);
      onCommit?.(before);
      advanced++;
    }
    return advanced;
  }

  /** Shared scan cost/cooldown gate (human and ECHO use the same resource rules). */
  private scanCost(): ActionResult | null {
    if (this.pausedFlag) return this.fail('E_PAUSED', '已暂停，操作不可用。');
    if (this.failed) return this.fail('E_PERMISSION', '本局已失败，请重开。');
    if (this.scanCooldownTicks > 0) {
      return this.fail('E_COOLDOWN', `扫描冷却中，还需 ${Math.ceil(this.scanCooldownTicks / SLICE.TICK_HZ)} 秒。`);
    }
    if (this.energyValue < SLICE.SCAN_COST) return this.insufficient(SLICE.SCAN_COST);
    this.energyValue -= SLICE.SCAN_COST;
    this.scanCooldownTicks = SLICE.SCAN_CD_TICKS;
    this.scanRevealTicks = SLICE.SCAN_REVEAL_TICKS;
    return null;
  }

  scan(provenance?: ScanProvenance): ActionResult {
    const blocked = this.scanCost();
    if (blocked) return blocked;
    if (this.corridor) {
      this.corridorReveal = this.corridor.scan();
      const found = Object.values(this.corridorReveal).some(Boolean);
      this.evidence = this.buildCorridorEvidence(provenance);
      return this.ok(found ? '扫描完成：发现当前可见的设备和连接。' : '扫描完成：范围内未发现可操作目标。', SLICE.SCAN_COST);
    }
    // A scan is a single pulse: an empty scan is legal and still costs 10.
    const r = this.labScanFrom(this.playerX, this.playerY, provenance);
    this.revealDoorReceiver = r.revealDoorReceiver;
    this.revealSealSource = r.revealSealSource;
    this.evidence = r.evidence;
    return this.ok(
      r.found
        ? '扫描完成：已发现范围内的门接收器/封锁载波（只揭示，不开门）。'
        : '扫描完成：范围内未发现可操作目标（空扫仍消耗 10）。',
      SLICE.SCAN_COST
    );
  }

  /**
   * Shared scan capability entry at an EXPLICIT actor position. ECHO uses this
   * with its own position; it consumes the SAME energy/cooldown and uses the
   * lab range/LOS formulas. The returned evidence is actor-local and is NOT
   * written into the human's evidence fields.
   */
  scanFrom(x: number, y: number, provenance?: ScanProvenance, range: number = SLICE.SCAN_RADIUS): {
    readonly result: ActionResult;
    readonly revealDoorReceiver: boolean;
    readonly revealSealSource: boolean;
    readonly evidence: SliceEvidenceV1[];
  } {
    const blocked = this.scanCost();
    if (blocked) return { result: blocked, revealDoorReceiver: false, revealSealSource: false, evidence: [] };
    if (this.corridor) {
      return { result: this.fail('E_PERMISSION', '该隔离协作场景仅支持实验室内的 ECHO 扫描。'), revealDoorReceiver: false, revealSealSource: false, evidence: [] };
    }
    const r = this.labScanFrom(x, y, provenance, range);
    return {
      result: this.ok(r.found ? '扫描完成：已发现范围内的设备。' : '扫描完成：范围内未发现可操作目标。', SLICE.SCAN_COST),
      revealDoorReceiver: r.revealDoorReceiver,
      revealSealSource: r.revealSealSource,
      evidence: r.evidence,
    };
  }

  private labScanFrom(x: number, y: number, provenance?: ScanProvenance, range: number = SLICE.SCAN_RADIUS): {
    readonly found: boolean;
    readonly revealDoorReceiver: boolean;
    readonly revealSealSource: boolean;
    readonly evidence: SliceEvidenceV1[];
  } {
    const receiverInRange = distanceToReceiver(x, y) < range;
    const sourceInRange = distanceToSource(x, y) < range;
    const revealDoorReceiver = receiverInRange && hasLineOfSight(x, y, ROOM.receiver.x, ROOM.receiver.y);
    const revealSealSource = sourceInRange && hasLineOfSight(x, y, ROOM.source.x, ROOM.source.y, ROOM.sourceCell);
    const found = revealDoorReceiver || revealSealSource;
    const evidence = this.buildLabEvidence(revealDoorReceiver, revealSealSource, { x, y }, provenance);
    return { found, revealDoorReceiver, revealSealSource, evidence };
  }

  jam(target: 'relay' | 'guard' = 'relay'): ActionResult {
    if (this.pausedFlag) return this.fail('E_PAUSED', '已暂停，操作不可用。');
    if (this.failed) return this.fail('E_PERMISSION', '本局已失败，请重开。');
    if (target === 'guard') {
      if (!this.corridor?.canJamGuard()) {
        return this.fail('E_ILLEGAL_TARGET', '没有 6 格内无遮挡的存活守卫。');
      }
      const blocked = this.jamBlocker(this.corridor.isGuardJammed(this.tickIndex));
      if (blocked) return blocked;
      this.startJam(false);
      this.corridor.jamGuard(this.tickIndex);
      return this.ok('守卫感知压制 6 秒。可用 F 开启中继器并过桥。', SLICE.JAM_COST);
    }
    if (this.corridor) {
      if (!this.corridor.canJam()) return this.fail('E_ILLEGAL_TARGET', '中继器超出 6 格施法范围或被遮挡。');
      const blocked = this.jamBlocker();
      if (blocked) return blocked;
      this.startJam();
      this.corridor.setJammed(this.tickIndex, true);
      return this.ok('中继器发射已压制。开关意图与供电保留。', SLICE.JAM_COST);
    }
    if (!(distanceToReceiver(this.playerX, this.playerY) < SLICE.JAM_RANGE)) {
      return this.fail('E_ILLEGAL_TARGET', '距离门接收器太远（需严格小于 6 格）。');
    }
    return this.labJamFrom(this.playerX, this.playerY);
  }

  /**
   * Shared lab-jam capability entry at an EXPLICIT actor position. ECHO uses
   * this with its own position and the SAME energy/cooldown/range/LOS rules.
   */
  jamFrom(x: number, y: number, target: 'relay' | 'guard' = 'relay'): ActionResult {
    if (this.pausedFlag) return this.fail('E_PAUSED', '已暂停，操作不可用。');
    if (this.failed) return this.fail('E_PERMISSION', '本局已失败，请重开。');
    if (target !== 'relay' || this.corridor) {
      return this.fail('E_ILLEGAL_TARGET', '该隔离协作场景仅支持实验室内对门接收器的 ECHO 压制。');
    }
    return this.labJamFrom(x, y);
  }

  private labJamFrom(x: number, y: number): ActionResult {
    if (!(distanceToReceiver(x, y) < SLICE.JAM_RANGE)) {
      return this.fail('E_ILLEGAL_TARGET', '距离门接收器太远（需严格小于 6 格）。');
    }
    if (!hasLineOfSight(x, y, ROOM.receiver.x, ROOM.receiver.y)) {
      return this.fail('E_ILLEGAL_TARGET', '门接收器被遮挡，无法压制。');
    }
    const blocked = this.jamBlocker();
    if (blocked) return blocked;
    this.startJam();
    this.pendingSafeClose = false;
    this.solveDoor();
    return this.ok('压制成功：门接收器被压制，门现在可通行。', SLICE.JAM_COST);
  }

  interact(): ActionResult {
    if (this.pausedFlag) return this.fail('E_PAUSED', '已暂停，操作不可用。');
    if (this.failed) return this.fail('E_PERMISSION', '本局已失败，请重开。');
    if (this.corridor) {
      if (!this.corridor.canInteract()) return this.fail('E_ILLEGAL_TARGET', '请靠近无遮挡的岸边控制器。');
      if (this.lastRelayInteractTick === this.tickIndex) return this.fail('E_RETRYABLE', '本逻辑帧已提交开关操作。');
      this.lastRelayInteractTick = this.tickIndex;
      this.corridor.toggle(this.tickIndex, this.jamActive);
      const { manualEnabled, relay } = this.corridor.snapshot(this.tickIndex);
      return this.ok(`中继器开关已${manualEnabled ? '开启' : '关闭'}。${relay === 'JAMMED' ? '压制仍在生效。' : ''}`, 0);
    }
    if (!(distanceToReceiver(this.playerX, this.playerY) < SLICE.INTERACT_RANGE)) {
      return this.fail('E_ILLEGAL_TARGET', '距离门太远。');
    }
    if (!hasLineOfSight(this.playerX, this.playerY, ROOM.receiver.x, ROOM.receiver.y)) {
      return this.fail('E_ILLEGAL_TARGET', '门被遮挡，无法交互。');
    }
    if (this.jamActive) {
      return this.ok('门当前已被压制打开，无需普通开门。', 0);
    }
    if (this.sealSourcePresent) {
      // The seal source is present by default, so a plain open is always blocked.
      return this.fail('E_LINK_UNAVAILABLE', '当前封锁接收有效，普通开门无效（不扣能量）。');
    }
    this.manualOpenIntent = !this.manualOpenIntent;
    this.solveDoor();
    return this.ok(this.manualOpenIntent ? '普通开门成功。' : '普通关门成功。', 0);
  }

  shootGuard(): ActionResult {
    if (this.paused) return this.fail('E_PAUSED', '已暂停，操作不可用。');
    if (this.failed) return this.fail('E_PERMISSION', '本局已失败，请重开。');
    switch (this.corridor?.shoot(this.tickIndex)) {
      case 'hit': return this.ok('命中守卫。', 0);
      case 'cleared': return this.ok('守卫已清除。', 0);
      case 'cooldown': return this.fail('E_COOLDOWN', '脉冲步枪冷却中。');
      default: return this.fail('E_ILLEGAL_TARGET', '没有可射击的守卫。');
    }
  }

  /**
   * Public capability description derived from CURRENT authoritative model
   * state. Used by the observation whitelist instead of a fixed "always legal"
   * list; it does not execute actions or duplicate the rule resolvers.
   */
  actionAvailability(): ActionAvailability[] {
    const stopped = this.pausedFlag || this.failed;
    const stopReason: ResultCode = this.pausedFlag ? 'E_PAUSED' : 'E_PERMISSION';
    const mk = (type: ActionAvailability['type'], status: ActionAvailabilityStatus, reasonCode?: ActionAvailability['reasonCode']): ActionAvailability =>
      reasonCode ? { type, status, reasonCode } : { type, status };
    const out: ActionAvailability[] = [
      mk('move', stopped ? 'permission_denied' : 'available', stopped ? stopReason : undefined),
      mk('wait', stopped ? 'permission_denied' : 'available', stopped ? stopReason : undefined),
    ];
    out.push(stopped ? mk('scan', 'permission_denied', stopReason)
      : this.energyValue < SLICE.SCAN_COST ? mk('scan', 'insufficient_energy', 'E_ENERGY_INSUFFICIENT')
      : this.scanCooldownTicks > 0 ? mk('scan', 'cooldown', 'E_COOLDOWN')
      : mk('scan', 'available'));
    let jam: ActionAvailability;
    if (stopped) jam = mk('jam', 'permission_denied', stopReason);
    else if (this.jamActive) jam = mk('jam', 'unavailable', 'E_RETRYABLE');
    else if (this.jamCooldownTicks > 0) jam = mk('jam', 'cooldown', 'E_COOLDOWN');
    else if (this.energyValue < SLICE.JAM_COST) jam = mk('jam', 'insufficient_energy', 'E_ENERGY_INSUFFICIENT');
    else {
      const legal = this.corridor
        ? (this.corridor.canJam() || this.corridor.canJamGuard())
        : (distanceToReceiver(this.playerX, this.playerY) < SLICE.JAM_RANGE &&
           hasLineOfSight(this.playerX, this.playerY, ROOM.receiver.x, ROOM.receiver.y));
      jam = mk('jam', legal ? 'available' : 'unavailable', legal ? undefined : 'E_ILLEGAL_TARGET');
    }
    out.push(jam);
    let interact: ActionAvailability;
    if (stopped) interact = mk('interact', 'permission_denied', stopReason);
    else {
      const legal = this.corridor
        ? this.corridor.canInteract()
        : (distanceToReceiver(this.playerX, this.playerY) < SLICE.INTERACT_RANGE &&
           hasLineOfSight(this.playerX, this.playerY, ROOM.receiver.x, ROOM.receiver.y));
      interact = mk('interact', legal ? 'available' : 'unavailable', legal ? undefined : 'E_ILLEGAL_TARGET');
    }
    out.push(interact);
    if (!this.corridor) out.push(mk('shoot_guard', 'unavailable', 'E_NOT_APPLICABLE'));
    else if (stopped) out.push(mk('shoot_guard', 'permission_denied', stopReason));
    else {
      const availability = this.corridor.canShoot(this.tickIndex);
      out.push(availability === 'ok' ? mk('shoot_guard', 'available')
        : availability === 'cooldown' ? mk('shoot_guard', 'cooldown', 'E_COOLDOWN')
        : mk('shoot_guard', 'unavailable', 'E_ILLEGAL_TARGET'));
    }
    for (const type of ['aim', 'fire', 'decoy'] as const) {
      out.push(mk(type, 'unavailable', 'E_NOT_APPLICABLE'));
    }
    return out;
  }

  markPassed(): void {
    this.passedFlag = true;
  }

  snapshot(): SliceSnapshot {
    const scanning = this.scanRevealTicks > 0;
    return {
      tick: this.tickIndex,
      energy: this.energyValue,
      doorState: this.door,
      doorPassable: this.doorPassable,
      jamActive: this.jamActive,
      jamRemainingTicks: this.jamRemainingTicks,
      jamCooldownTicks: this.jamCooldownTicks,
      scanCooldownTicks: this.scanCooldownTicks,
      scanRevealTicks: this.scanRevealTicks,
      safeClearTicks: this.safeClearTicks,
      occupancy: this.occupancy,
      passed: this.passedFlag,
      paused: this.pausedFlag,
      manualOpenIntent: this.manualOpenIntent,
      sealSourcePresent: this.sealSourcePresent,
      pendingSafeClose: this.pendingSafeClose,
      position: { x: this.playerX, y: this.playerY },
      reveal: scanning
        ? {
            doorReceiver: this.revealDoorReceiver,
            sealSource: this.revealSealSource,
            link: this.revealDoorReceiver && this.revealSealSource,
          }
        : null,
      corridor: this.corridor?.snapshot(this.tickIndex) ?? null,
      corridorReveal: scanning && this.corridorReveal ? { ...this.corridorReveal } : null,
    };
  }

  serialize(): PersistedSliceState {
    const corridor = this.corridor?.capture(this.jamRemainingTicks, this.scanRevealTicks, this.corridorReveal, this.evidence);
    if (this.corridor && !corridor) throw new Error('Unsafe corridor checkpoint');
    return {
      schema: 'last_signal_station_zero_vs00_v1',
      version: 1,
      roomId: 'station-zero-r1',
      energy: this.energyValue,
      tick: this.tickIndex,
      doorState: this.door,
      manualOpenIntent: this.manualOpenIntent,
      sealSourcePresent: this.sealSourcePresent,
      passed: this.passedFlag,
      position: { x: this.playerX, y: this.playerY },
      ...(corridor ? { corridor } : {}),
      ...(!corridor && this.scanRevealTicks > 0 && this.evidence.length > 0
        ? { evidence: this.evidence.map((e) => ({ ...e, position: { ...e.position } })) }
        : {}),
      remaining: {
        jam: corridor ? 0 : this.jamRemainingTicks,
        jamCooldown: this.jamCooldownTicks,
        scanCooldown: this.scanCooldownTicks,
        scanReveal: corridor ? 0 : this.scanRevealTicks,
        safeClear: this.safeClearTicks,
        regenAcc: this.regenAcc,
      },
    };
  }

  reset(): void {
    this.dispose();
    this.corridor = null;
    this.corridorReveal = null;
    this.lastRelayInteractTick = -1;
    this.energyValue = SLICE.ENERGY_MAX;
    this.tickIndex = 0;
    this.door = 'SEALED';
    this.manualOpenIntent = false;
    this.sealSourcePresent = true;
    this.jamRemainingTicks = 0;
    this.jamCooldownTicks = 0;
    this.scanCooldownTicks = 0;
    this.scanRevealTicks = 0;
    this.revealDoorReceiver = false;
    this.revealSealSource = false;
    this.pendingSafeClose = false;
    this.safeClearTicks = SLICE.SAFE_CLEAR_DELAY_TICKS;
    this.regenAcc = 0;
    this.accumulatorMs = 0;
    this.evidence = [];
    this.evidenceRescanRequired = false;
    this.playerX = ROOM.spawn.x;
    this.playerY = ROOM.spawn.y;
    this.occupancy = false;
    this.passedFlag = false;
    this.pausedFlag = false;
    this.lastResult = { code: 'OK', message: '已重开：固定房间与能量已重置。', cost: 0 };
  }

  dispose(): void { this.corridor?.dispose(); }

  private tickOnce(onTick?: () => void): void {
    if (!this.corridor) onTick?.();
    this.tickIndex++;

    // Energy regeneration: 1 per REGEN_TICKS, capped. At full energy keep the
    // accumulator at 0 so the first post-spend tick cannot immediately grant regen.
    if (this.energyValue >= SLICE.ENERGY_MAX) {
      this.regenAcc = 0;
    } else {
      this.regenAcc++;
      if (this.regenAcc >= SLICE.REGEN_TICKS) {
        this.regenAcc -= SLICE.REGEN_TICKS;
        this.energyValue++;
        if (this.energyValue >= SLICE.ENERGY_MAX) this.regenAcc = 0;
      }
    }

    if (this.scanCooldownTicks > 0) this.scanCooldownTicks--;
    if (this.scanRevealTicks > 0) this.scanRevealTicks--;
    // R9 evidence expires by its absolute TTL even if scanRevealTicks was stale.
    if (this.evidence.length > 0) {
      const alive = this.evidence.filter((e) => this.tickIndex < e.expiresAtTick);
      if (alive.length !== this.evidence.length) {
        this.evidence = alive;
        if (alive.length === 0) this.scanRevealTicks = 0;
      }
    }
    if (this.scanRevealTicks === 0) {
      this.revealDoorReceiver = false;
      this.revealSealSource = false;
      this.corridorReveal = null;
      this.evidence = [];
    }
    if (this.jamCooldownTicks > 0) this.jamCooldownTicks--;

    const wasJammed = this.jamRemainingTicks > 0;
    if (this.jamRemainingTicks > 0) this.jamRemainingTicks--;
    if (this.corridor) {
      const rescued = this.corridor.advance(this.tickIndex, this.jamActive);
      if (!rescued && !this.failed) onTick?.();
      if (rescued) {
        const failure = this.failed ? '本局失败，请重开。' : '';
        this.ok(`桥梁失稳：已返回${rescued === 'west' ? '西' : '东'}岸安全点，损失 ${CORRIDOR.dangerHp} HP。${failure}`, 0);
      } else if (this.failed) {
        this.ok('本局失败。请选择重开。', 0);
      } else if (wasJammed && !this.jamActive) {
        this.ok('压制到期：中继器与下游已按当前供电和开关重新求解。', 0);
      }
      return;
    }
    if (wasJammed && this.jamRemainingTicks === 0) {
      // Expiry only changes remaining ticks; the resolver decides the door state.
      this.pendingSafeClose = true;
      this.safeClearTicks = SLICE.SAFE_CLEAR_DELAY_TICKS;
      this.lastResult = {
        code: 'OK',
        message: this.occupancy
          ? '压制效果结束：你在门内，门保持开启，离开后安全延迟再恢复。'
          : '压制效果结束：门按当前源/意图/占位条件安全恢复。',
        cost: 0,
      };
    }

    this.occupancy = isOccupyingDoor(this.playerX, this.playerY);
    if (this.occupancy) {
      this.safeClearTicks = SLICE.SAFE_CLEAR_DELAY_TICKS;
    } else if (this.pendingSafeClose && this.safeClearTicks > 0) {
      this.safeClearTicks--;
      if (this.safeClearTicks === 0) {
        this.lastResult = { code: 'OK', message: '门已在安全延迟后按当前条件恢复。', cost: 0 };
      }
    }
    this.solveDoor();
  }

  /**
   * Single resolver over CURRENT domain conditions:
   * active Jam > occupancy (never clamp) > pending safe-clear delay >
   * seal source present (SEALED) > manual open intent (OPEN/CLOSED).
   */
  private solveDoor(): void {
    if (this.jamRemainingTicks > 0) {
      this.door = 'JAMMED_OPEN';
      this.pendingSafeClose = false;
      this.safeClearTicks = SLICE.SAFE_CLEAR_DELAY_TICKS;
      return;
    }
    if (this.occupancy) {
      this.door = 'SAFE_PENDING_CLOSE';
      this.pendingSafeClose = true;
      this.safeClearTicks = SLICE.SAFE_CLEAR_DELAY_TICKS;
      return;
    }
    if (this.pendingSafeClose) {
      if (this.safeClearTicks > 0) {
        this.door = 'SAFE_PENDING_CLOSE';
        return;
      }
      this.pendingSafeClose = false;
    }
    if (this.sealSourcePresent) {
      this.door = 'SEALED';
      return;
    }
    this.door = this.manualOpenIntent ? 'OPEN' : 'CLOSED';
  }

  private restore(p: PersistedSliceState): void {
    const clamp = (n: number, lo: number, hi: number): number =>
      Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));
    this.energyValue = clamp(p.energy, 0, SLICE.ENERGY_MAX);
    this.tickIndex = Math.max(0, Math.round(p.tick));
    this.door = p.doorState;
    this.manualOpenIntent = !!p.manualOpenIntent;
    this.sealSourcePresent = p.sealSourcePresent !== false;
    this.passedFlag = !!p.passed;
    const r = p.remaining;
    this.jamRemainingTicks = clamp(r.jam, 0, SLICE.JAM_DURATION_TICKS);
    this.jamCooldownTicks = clamp(r.jamCooldown, 0, SLICE.JAM_CD_TICKS);
    this.scanCooldownTicks = clamp(r.scanCooldown, 0, SLICE.SCAN_CD_TICKS);
    this.scanRevealTicks = clamp(r.scanReveal, 0, SLICE.SCAN_REVEAL_TICKS);
    this.safeClearTicks = clamp(r.safeClear, 0, SLICE.SAFE_CLEAR_DELAY_TICKS);
    this.regenAcc = clamp(r.regenAcc, 0, SLICE.REGEN_TICKS - 1);
    // Position validation reuses the Scene's 5-point AABB footprint and the saved
    // door passability (jam / JAMMED_OPEN / OPEN / SAFE_PENDING_CLOSE). A saved
    // position whose body would intersect a wall falls back to spawn.
    const doorPassable =
      this.jamRemainingTicks > 0 ||
      this.door === 'JAMMED_OPEN' ||
      this.door === 'OPEN' ||
      this.door === 'SAFE_PENDING_CLOSE';
    const px = Number(p.position?.x);
    const py = Number(p.position?.y);
    const footprintOk = canFit(px, py, (x, y) => isWalkableCell(x, y, doorPassable));
    this.playerX = footprintOk ? px : ROOM.spawn.x;
    this.playerY = footprintOk ? py : ROOM.spawn.y;
    this.accumulatorMs = 0;
    this.occupancy = isOccupyingDoor(this.playerX, this.playerY);
    // Rebuild pending safe-close from the saved door state. A save made after Jam
    // expired but while the 1 s safe-clear delay is still running (player already
    // left the doorway) must keep SAFE_PENDING_CLOSE and its remaining safeClear,
    // not jump straight to SEALED. Occupancy still re-arms the delay below.
    this.pendingSafeClose = this.jamRemainingTicks === 0 && this.door === 'SAFE_PENDING_CLOSE';
    this.pausedFlag = false;
    // R9: restore NEVER re-runs Scan/LOS to invent reveal evidence. Evidence is
    // accepted only when it is shape/enum valid AND inside its absolute TTL
    // window (`observedAtTick <= savedTick < expiresAtTick`). Expired/future or
    // room-mismatched evidence is safely discarded with a rescan hint; it can
    // never become a free Scan.
    const hasEvidenceField = p.evidence !== undefined;
    const hadActiveReveal = this.scanRevealTicks > 0;
    const candidates = isSliceEvidenceArray(p.evidence) ? p.evidence : [];
    const valid = hadActiveReveal
      ? candidates.filter((e) => e.observedAtTick <= this.tickIndex &&
        this.tickIndex < e.expiresAtTick && e.roomId === 'station-zero-r1')
      : [];
    this.evidence = valid.map((e) => ({ ...e, position: { ...e.position } }));
    if (this.evidence.length === 0) {
      this.scanRevealTicks = 0;
      this.evidenceRescanRequired = hasEvidenceField || hadActiveReveal;
    } else {
      this.scanRevealTicks = Math.max(0, Math.min(
        this.scanRevealTicks,
        Math.max(...this.evidence.map((e) => e.expiresAtTick)) - this.tickIndex,
      ));
      this.evidenceRescanRequired = candidates.length !== this.evidence.length;
    }
    this.revealDoorReceiver = this.evidence.some((e) => e.targetId === 'tgt_lab_door_receiver');
    this.revealSealSource = this.evidence.some((e) => e.targetId === 'tgt_lab_seal_source');
    this.lastResult = { code: 'OK', message: '已从本原型存档恢复。', cost: 0 };
    this.solveDoor();
    if (p.corridor) {
      this.corridor = new Corridor(p.corridor);
      this.jamRemainingTicks = p.corridor.jamRemaining;
      this.scanRevealTicks = p.corridor.scanRemaining;
      // R9 R2 evidence is persisted under the corridor checkpoint (real room
      // ownership). Restore verbatim inside its TTL window; never re-scan.
      const r2Candidates = isSliceEvidenceArray(p.corridor.evidence) ? p.corridor.evidence : [];
      const r2Valid = this.scanRevealTicks > 0
        ? r2Candidates.filter((e) => e.roomId === 'station-zero-r2' &&
          e.observedAtTick <= this.tickIndex && this.tickIndex < e.expiresAtTick)
        : [];
      this.evidence = r2Valid.map((e) => ({ ...e, position: { ...e.position } }));
      this.revealDoorReceiver = false;
      this.revealSealSource = false;
      if (this.evidence.length > 0) {
        this.corridorReveal = {
          relay: this.evidence.some((e) => e.targetId === 'tgt_corridor_relay'),
          bridge: this.evidence.some((e) => e.targetId === 'tgt_corridor_bridge'),
          perceptionPort: this.evidence.some((e) => e.targetId === 'tgt_corridor_guard'),
        };
        this.evidenceRescanRequired = r2Candidates.length !== this.evidence.length;
      } else {
        this.corridorReveal = p.corridor.reveal ? { ...p.corridor.reveal } : null;
        this.evidenceRescanRequired = this.scanRevealTicks > 0;
      }
    }
  }

  /** Full private state (P1 internal snapshot). Not the browser checkpoint. */
  captureFull(): FullSliceState {
    return {
      energy: this.energyValue,
      tick: this.tickIndex,
      door: this.door,
      manualOpenIntent: this.manualOpenIntent,
      sealSourcePresent: this.sealSourcePresent,
      jamRemainingTicks: this.jamRemainingTicks,
      jamCooldownTicks: this.jamCooldownTicks,
      scanCooldownTicks: this.scanCooldownTicks,
      scanRevealTicks: this.scanRevealTicks,
      revealDoorReceiver: this.revealDoorReceiver,
      revealSealSource: this.revealSealSource,
      pendingSafeClose: this.pendingSafeClose,
      safeClearTicks: this.safeClearTicks,
      regenAcc: this.regenAcc,
      accumulatorMs: this.accumulatorMs,
      playerX: this.playerX,
      playerY: this.playerY,
      occupancy: this.occupancy,
      passed: this.passedFlag,
      paused: this.pausedFlag,
      lastRelayInteractTick: this.lastRelayInteractTick,
      lastResult: { ...this.lastResult },
      corridorReveal: this.corridorReveal ? { ...this.corridorReveal } : null,
      corridor: this.corridor?.captureFull() ?? null,
      evidence: this.evidence.map((e) => ({ ...e, position: { ...e.position } })),
      evidenceRescanRequired: this.evidenceRescanRequired,
    };
  }

  /** Restore full private state verbatim; no scan, no bridge/relay re-resolve. */
  restoreFull(state: FullSliceState): void {
    if (this.corridor) this.corridor.dispose();
    this.energyValue = state.energy;
    this.tickIndex = state.tick;
    this.door = state.door;
    this.manualOpenIntent = state.manualOpenIntent;
    this.sealSourcePresent = state.sealSourcePresent;
    this.jamRemainingTicks = state.jamRemainingTicks;
    this.jamCooldownTicks = state.jamCooldownTicks;
    this.scanCooldownTicks = state.scanCooldownTicks;
    this.scanRevealTicks = state.scanRevealTicks;
    this.revealDoorReceiver = state.revealDoorReceiver;
    this.revealSealSource = state.revealSealSource;
    this.pendingSafeClose = state.pendingSafeClose;
    this.safeClearTicks = state.safeClearTicks;
    this.regenAcc = state.regenAcc;
    this.accumulatorMs = state.accumulatorMs;
    this.playerX = state.playerX;
    this.playerY = state.playerY;
    this.occupancy = state.occupancy;
    this.passedFlag = state.passed;
    this.pausedFlag = state.paused;
    this.lastRelayInteractTick = state.lastRelayInteractTick;
    this.lastResult = { ...state.lastResult };
    this.corridorReveal = state.corridorReveal ? { ...state.corridorReveal } : null;
    this.evidence = state.evidence.map((e) => ({ ...e, position: { ...e.position } }));
    this.evidenceRescanRequired = state.evidenceRescanRequired;
    this.corridor = null;
    if (state.corridor) {
      const corridor = new Corridor();
      corridor.restoreFull(state.corridor);
      this.corridor = corridor;
    }
  }

  private buildLabEvidence(
    revealDoorReceiver: boolean,
    revealSealSource: boolean,
    at?: { readonly x: number; readonly y: number },
    provenance?: ScanProvenance,
  ): SliceEvidenceV1[] {
    if (!revealDoorReceiver && !revealSealSource) return [];
    const tick = this.tickIndex;
    const expiresAtTick = tick + SLICE.SCAN_REVEAL_TICKS;
    const position = at ? { x: at.x, y: at.y } : { x: this.position.x, y: this.position.y };
    const link = revealDoorReceiver && revealSealSource ? 'rel_lab_seal_link' : null;
    const prov = evidenceProvenance(provenance);
    const out: SliceEvidenceV1[] = [];
    if (revealDoorReceiver) out.push({
      targetId: 'tgt_lab_door_receiver', relationId: link, position, observedAtTick: tick,
      expiresAtTick, stateLabel: 'receiver-visible', roomId: 'station-zero-r1', ...prov,
    });
    if (revealSealSource) out.push({
      targetId: 'tgt_lab_seal_source', relationId: link, position, observedAtTick: tick,
      expiresAtTick, stateLabel: 'carrier-visible', roomId: 'station-zero-r1', ...prov,
    });
    return out;
  }

  private buildCorridorEvidence(provenance?: ScanProvenance): SliceEvidenceV1[] {
    const reveal = this.corridorReveal;
    if (!reveal) return [];
    const tick = this.tickIndex;
    const expiresAtTick = tick + SLICE.SCAN_REVEAL_TICKS;
    // The observer is the corridor avatar, NOT the stale laboratory playerX/Y.
    const position = { x: this.position.x, y: this.position.y };
    const prov = evidenceProvenance(provenance);
    const out: SliceEvidenceV1[] = [];
    if (reveal.relay) out.push({
      targetId: 'tgt_corridor_relay', relationId: null, position, observedAtTick: tick,
      expiresAtTick, stateLabel: 'relay-visible', roomId: 'station-zero-r2', ...prov,
    });
    if (reveal.bridge) out.push({
      targetId: 'tgt_corridor_bridge', relationId: reveal.relay ? 'rel_corridor_relay_bridge' : null,
      position, observedAtTick: tick, expiresAtTick, stateLabel: 'bridge-visible', roomId: 'station-zero-r2', ...prov,
    });
    if (reveal.perceptionPort) out.push({
      targetId: 'tgt_corridor_guard', relationId: reveal.relay ? 'rel_corridor_relay_perception' : null,
      position, observedAtTick: tick, expiresAtTick, stateLabel: 'perception-visible', roomId: 'station-zero-r2', ...prov,
    });
    return out;
  }

  private jamBlocker(active = this.jamActive): ActionResult | null {
    if (active) return this.fail('E_RETRYABLE', '已有压制效果生效，未扣能量；无需重复使用。');
    if (this.inCorridor && this.energyValue < SLICE.JAM_COST) return this.insufficient(SLICE.JAM_COST);
    if (this.jamCooldownTicks > 0) {
      return this.fail('E_COOLDOWN', `压制冷却中，还需 ${Math.ceil(this.jamCooldownTicks / SLICE.TICK_HZ)} 秒。`);
    }
    if (this.energyValue < SLICE.JAM_COST) return this.insufficient(SLICE.JAM_COST);
    return null;
  }

  private startJam(affectsDevice = true): void {
    this.energyValue -= SLICE.JAM_COST;
    this.jamCooldownTicks = SLICE.JAM_CD_TICKS;
    if (affectsDevice) this.jamRemainingTicks = SLICE.JAM_DURATION_TICKS;
  }

  private ok(message: string, cost: number): ActionResult {
    const r: ActionResult = { code: 'OK', message, cost };
    this.lastResult = r;
    return r;
  }

  private fail(code: ResultCode, message: string): ActionResult {
    const r: ActionResult = { code, message, cost: 0 };
    this.lastResult = r;
    return r;
  }

  private insufficient(need: number): ActionResult {
    const wait = Math.max(0, Math.ceil((need - this.energyValue) / SLICE.REGEN_PER_SEC));
    return this.fail(
      'E_ENERGY_INSUFFICIENT',
      `能量不足：当前 ${this.energyValue}，需要 ${need}。等待自然恢复，最多约 ${wait} 秒（一次 Jam 所需 25 约需 5 秒）。`
    );
  }
}
