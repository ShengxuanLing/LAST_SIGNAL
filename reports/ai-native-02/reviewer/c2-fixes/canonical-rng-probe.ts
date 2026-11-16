// Independent reviewer probe for C2 fix a8232c8 canonical/RNG/target/checkpoint contracts.
// Run from the frozen snapshot: npx vite-node reviewer-canonical-rng-probe.ts
import { GAME, basePlayerData } from './src/config/game';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import { RNG } from './src/core/random';
import type { PlayerData, RunCheckpoint } from './src/types';
import {
  canonicalSimulationEvents, canonicalSimulationState, createSimulationState,
  registerTarget, type SimulationState
} from './src/world/sim/core';
import { validateCheckpoint } from './src/systems/RunCheckpoint';

let fails = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!cond) fails++;
};
function realMap() {
  const gen = new MapGenerator(424242);
  const map = gen.generate();
  assignRoles(gen, map.rooms, map.roomsOrder);
  guaranteeReachable(map);
  return map;
}
function pdata(): PlayerData {
  const b = basePlayerData();
  return { ...b, level: 1, xp: 0, xpToNext: 30, currency: 0, weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
    upgrades: [], abilities: [] } as PlayerData;
}
const map = realMap();
const state = createSimulationState({ seed: 424242, map, playerData: pdata(), playerX: 0, playerY: 0 });
state.player.x = 5; state.player.y = 5; state.player.dashTimer = 0.2; state.player.invuln = 0.3;
state.player.hurtTimer = 0.1; state.player.fireTimer = 0.4; state.player.aimYaw = 0.5;
state.nextProjectileId = 42;
state.pendingPlayerHits.push({ damage: 3, fromX: 4, fromY: 5 });
const target = { id: 9, kind: 'hunter', x: 8, y: 5, hp: 10, maxHp: 20, armor: 1, radius: 0.5, isBoss: false };
const registered = registerTarget(state, target);
check('registerTarget-returns-same-object', registered === target);
check('registerTarget-stores-reference-not-copy', state.targets[0] === target);
const canonical = canonicalSimulationState(state);
const parsed = JSON.parse(canonical);
check('canonical-has-mapHash', typeof parsed.mapHash === 'string');
check('canonical-has-targets', Array.isArray(parsed.targets) && parsed.targets.length === 1);
check('canonical-has-pendingPlayerHits', Array.isArray(parsed.pendingPlayerHits) && parsed.pendingPlayerHits.length === 1);
check('canonical-has-nextProjectileId', parsed.nextProjectileId === 42);
check('canonical-includes-core-timers', parsed.player.dashTimer === 0.2 && parsed.player.invuln === 0.3 && parsed.player.hurtTimer === 0.1 && parsed.player.fireTimer === 0.4 && parsed.player.aimYaw === 0.5);
check('canonical-includes-full-player-data', parsed.player.data && parsed.player.data.upgrades && parsed.player.data.xpGain !== undefined);
// Events are no longer rounded.
const e1 = [{ type: 'player-moved', position: { x: 1, y: 0 }, velocity: { x: 0, y: 0 }, dashTimer: 0, dashStarted: false }];
const e2 = [{ type: 'player-moved', position: { x: 1 + 1e-10, y: 0 }, velocity: { x: 0, y: 0 }, dashTimer: 0, dashStarted: false }];
check('canonical-events-preserve-1e-10', canonicalSimulationEvents(e1 as any) !== canonicalSimulationEvents(e2 as any));

// C1 vs C2 RNG order: C1 World.rng consumed crit + legacy loot; C2 core has a separate stream.
const seed = 424242, init = seed * 7919 + 1;
const c1 = new RNG(init), c2 = new RNG(init);
const c1Shot1 = c1.float() < 0.1, c2Shot1 = c2.float() < 0.1;
// C1 killEnemy loot consumes two floats on the SAME stream; C2 core crit stream is separate.
c1.float(); c1.float();
const c1Shot2 = c1.float() < 0.1, c2Shot2 = c2.float() < 0.1;
check('C1-loot-shifts-next-crit-vs-C2-core', c1Shot2 !== c2Shot2, { c1Shot1, c1Shot2, c2Shot1, c2Shot2 });
console.log(JSON.stringify({ rngProbe: { c1Shot1, c1Shot2, c2Shot1, c2Shot2, init }, note: 'C2 core uses a separate continuous RNG; C1 shared World.rng with loot' }, null, 2));

// Old checkpoint without coreState remains structurally valid.
const old: RunCheckpoint = {
  id: 'old', seed: 424242, roomId: 0, position: { x: 5, y: 5 }, clearedRooms: [0], portalTarget: null,
  rngState: 123, player: pdata(), loot: [], stats: { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 }
};
check('old-checkpoint-without-coreState-valid', validateCheckpoint(old) === true);
const withCore = { ...old, coreState: { tick: 40, rngState: 99, playerTimers: { dashTimer: 0, invuln: 0, hurtTimer: 0, fireTimer: 0, aimYaw: 0 }, nextProjectileId: 42 } };
check('new-checkpoint-with-coreState-valid', validateCheckpoint(withCore as any) === true);
const badCore = { ...withCore, coreState: { ...withCore.coreState, playerTimers: { ...withCore.coreState.playerTimers, dashTimer: Number.NaN } } };
check('bad-coreState-timer-rejected', validateCheckpoint(badCore as any) === false);

console.log(JSON.stringify({ result: fails === 0 ? 'CANONICAL_RNG_PROBE_PASS' : 'CANONICAL_RNG_PROBE_FAIL', failures: fails }, null, 2));
if (fails) process.exitCode = 1;
