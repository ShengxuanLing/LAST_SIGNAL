// AI-NATIVE-02 C2 — static ownership / rewiring gate.
//
// Proves the first-slice Phaser adapters read/write World.sim instead of
// keeping shadow player/drone/projectile rules, and that the pure core has no
// Phaser/DOM/Math.random. Node-only deterministic behaviour is tested in
// core.test.ts; rendered parity is tests/c2-parity.spec.ts.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (relative: string): string => readFileSync(path.resolve(relative), 'utf8');

describe('C2 pure core contract', () => {
  it('core.ts and rules.ts have no Phaser / DOM / wall clock / unseeded randomness', () => {
    for (const file of ['src/world/sim/core.ts', 'src/world/sim/rules.ts']) {
      const src = read(file);
      expect(src, file).not.toMatch(/from ['\"]phaser['\"]/);
      expect(src, file).not.toMatch(/\bdocument\b|\bwindow\b/);
      expect(src, file).not.toMatch(/Math\.random|Date\.now|performance\.now/);
    }
    const core = read('src/world/sim/core.ts');
    expect(core).toContain('stepSimulationTicks(');
    expect(core).toContain('canonicalSimulationState(');
    expect(core).toContain('SimEvent');
    expect(core).toContain('TICK_HZ: 60');
  });
});

describe('C2 single-authority adapters', () => {
  it('Player delegates all mutable state to World.sim and only samples intents', () => {
    const src = read('src/entities/Player.ts');
    expect(src).toContain('playerDataSnapshot');
    expect(src).toContain('sampleIntent()');
    expect(src).toContain('syncVisual(');
    expect(src).toContain('enqueuePlayerHit(');
    expect(src).not.toContain('this.applyIntent(');
    expect(src).not.toContain('stepPlayerMovement(');
    expect(src).not.toContain('private tryFire(');
    expect(src).not.toContain('this.data.hp = hit.hp');
    for (const debug of ['lastMoveStep', 'lastWeaponSpec', 'lastProjectileData', 'lastDroneStep', 'lastHitResult']) {
      expect(src, debug).not.toContain(debug);
    }
  });

  it('Enemy drone state is attached to the core, other kinds keep legacy FSM', () => {
    const src = read('src/entities/Enemy.ts');
    expect(src).toContain('attachSimDrone(');
    expect(src).toContain('SimDroneState');
    expect(src).toContain("if (this.data.kind === 'drone') return;");
    expect(src).toContain('legacyStateMachine');
    expect(src).not.toContain('stepDroneAi(');
    // B7: target state is read-only for the adapter; no live setters/hit write.
    expect(src).not.toContain('set wx(');
    expect(src).not.toContain('set wy(');
    expect(src).not.toContain('set _hp(');
    expect(src).not.toContain('hit(damage: number');
    expect(src).toContain('enqueueTargetMove(');
  });

  it('Boss target is read-only for the adapter; target radius keeps the old +1', () => {
    const src = read('src/entities/Boss.ts');
    expect(src).not.toContain('set wx(');
    expect(src).not.toContain('set wy(');
    expect(src).not.toContain('set _hp(');
    expect(src).not.toContain('hit(damage: number');
    expect(src).toContain('enqueueTargetMove(');
    expect(read('src/world/World.ts')).toContain('getRadius() + 1');
  });

  it('B6/B7/H9/H10: rewards, target commands, gated helpers and hit flash are in the core/World', () => {
    const core = read('src/world/sim/core.ts');
    expect(core).toContain('registerTarget');
    expect(core).toContain('const stored: SimTarget = { ...target }');
    expect(core).toContain('awardEnemyKill');
    expect(core).toContain('processCommands');
    expect(core).toContain('pendingCommands');
    const world = read('src/world/World.ts');
    expect(world).toContain('enqueueTargetMove(');
    expect(world).toContain('assertDevTest');
    expect(world).toContain('enemy.data.hitFlash = event.hit.hitFlash');
    expect(world).not.toContain('this.player.addXp(e.data.stats.xpValue)');
    expect(read('src/scenes/LevelUpScene.ts')).toContain('enqueueApplyUpgrade(');
    expect(read('src/entities/Player.ts')).toContain('enqueueTeleport');
    const player = read('src/entities/Player.ts');
    expect(player).not.toContain('set data(');
    expect(player).not.toContain('set wx(');
    expect(player).not.toContain('set wy(');
    expect(player).not.toContain('ownerResetPlayer');
    expect(player).not.toContain('ownerMovePlayer');
    const worldSrc = read('src/world/World.ts');
    expect(worldSrc).toContain('private _sim!: SimulationState');
    expect(worldSrc).toContain('get sim(): SimulationState');
    expect(worldSrc).toContain('get simFixture(): SimulationState');
    expect(worldSrc).not.toContain('ownerCapability');
    expect(worldSrc).not.toContain('ownerSetPlayerData(');
    expect(worldSrc).not.toContain('ownerResetPlayer(');
    expect(worldSrc).not.toContain('ownerMovePlayer(');
    expect(worldSrc).toContain('enqueueSpawnLoot(');
    expect(worldSrc).toContain('enqueueTeleport(');
  });

  it('World owns SimulationState, fixed accumulator, typed events and legacy-only update', () => {
    const src = read('src/world/World.ts');
    expect(src).toContain('createSimulationState(');
    expect(src).toContain('stepSimulationTicks(');
    expect(src).toContain('stepFrame(');
    expect(src).toContain('applySimEvents(');
    expect(src).toContain('syncCoreEntities(');
    expect(src).toContain('resetSimulationAccumulator(');
    expect(src).toContain('MAX_TICKS_PER_FRAME');
    expect(src).not.toContain('this.player.update(dt)');
    expect(src).not.toContain('spawnProjectile(ownerId');
  });

  it('GameScene samples one intent and resets accumulator on pause-like overlays', () => {
    const src = read('src/scenes/GameScene.ts');
    expect(src).toContain('sampleIntent()');
    expect(src).toContain('world.stepFrame(delta, intent)');
    expect(src).toContain('resetSimulationAccumulator()');
    expect(src).not.toContain('world.update(dt)');
  });
});

describe('C2 purchase transaction and commit barrier', () => {
  it('core owns an atomic purchase-supply command validated at commit time', () => {
    const core = read('src/world/sim/core.ts');
    // Stable offer key + transaction id + room only; price is never an argument.
    expect(core).toMatch(/type: 'purchase-supply'; transactionId: string; offerKey: string; roomId: number/);
    expect(core).toContain("'supply-purchase-result'");
    expect(core).toContain('purchaseTransactions');
    expect(core).toContain('supplyOfferPurchaseBlocker(');
    expect(core).toContain('terminalRooms(');
    expect(core).toContain('applySupply(');
    // Dedup + commit-time safety checks.
    expect(core).toContain('Duplicate transaction');
    expect(core).toContain('Room not cleared');
    expect(core).toContain('Clear remaining rooms first');
    expect(core).toContain('Clear remaining threats');
  });

  it('World exposes a real spawn barrier and refuses uncommitted checkpoint capture', () => {
    const world = read('src/world/World.ts');
    expect(world).toContain('hasPendingSpawns()');
    expect(world).toContain('worldSpawns.length > 0');
    expect(world).toContain('hasUncommittedCommands()');
    expect(world).toMatch(/hasUncommittedCommands\(\): boolean \{\s*return this\._sim\.pendingCommands\.length > 0 \|\| this\.hasPendingSpawns\(\)/);
    expect(world).toMatch(/if \(this\.hasUncommittedCommands\(\)\) return null/);
    expect(world).toContain('enqueuePurchaseSupply(');
    expect(world).toContain('getSupplyReceipt(');
  });

  it('generic full-state write is fixture/Owner-guarded; UI buys via purchase-supply', () => {
    const world = read('src/world/World.ts');
    const setPlayerData = world.slice(world.indexOf('enqueueSetPlayerData('));
    expect(setPlayerData.slice(0, 400)).toContain('assertDevTest()');
    const economy = read('src/economy/main.ts');
    expect(economy).toContain('enqueuePurchaseSupply(');
    expect(economy).not.toContain('enqueueSetPlayerData(');
    expect(economy).not.toContain('processPendingCommands(');
  });

  it('purchase ledger is hard-capped, canonical and checkpointed (no FIFO eviction)', () => {
    const core = read('src/world/sim/core.ts');
    expect(core).toContain('PURCHASE_LEDGER_CAP');
    expect(core).toContain("'Supply ledger full'");
    expect(core).toContain('purchaseTransactions: state.purchaseTransactions');
    expect(core).not.toContain('purchaseTransactions.splice(');
    const world = read('src/world/World.ts');
    expect(world).toContain('purchaseTransactions: [...this._sim.purchaseTransactions]');
    expect(world).toContain('run.coreState.purchaseTransactions');
    const checkpoint = read('src/systems/RunCheckpoint.ts');
    expect(checkpoint).toContain('PURCHASE_LEDGER_CAP');
    expect(checkpoint).toContain('isValidTransactionId');
  });
});
