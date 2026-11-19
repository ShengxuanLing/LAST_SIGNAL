import { basePlayerData } from './src/config/game';
import { echoPlayerData, registerEcho, createSimulationState, type SimulationState } from './src/world/sim/core';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import { validateCheckpoint, cloneCheckpoint, validEchoActor, ECHO_STAT_BOUNDS } from './src/systems/RunCheckpoint';
import { EchoController } from './src/ai-native/echo';
import type { RunCheckpoint } from './src/types';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));

// REAL echo actor built by the core (not a hand-written test fixture).
const gen = new MapGenerator(424242);
const map = gen.generate();
assignRoles(gen, map.rooms, map.roomsOrder);
guaranteeReachable(map);
const state: SimulationState = createSimulationState({ seed: 424242, map, playerData: { ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: 0, weaponKey: 'pulse', weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }], upgrades: [], abilities: [] }, playerX: 3, playerY: 4 });
const echo = registerEcho(state, 5, 6);

const baseFrame = (): RunCheckpoint => ({
  id: 'reviewer-frame', seed: 424242, roomId: 0, position: { x: 3, y: 4 },
  clearedRooms: [0], portalTarget: null, rngState: 123456,
  player: { ...state.player.data },
  loot: [], stats: { kills: 0, items: 0, damage: 0, elapsedSeconds: 2 },
  coreState: {
    tick: 120, rngState: 999, nextProjectileId: 4, purchaseTransactions: [],
    playerTimers: { dashTimer: 0, invuln: 0, hurtTimer: 0, fireTimer: 0.1, aimYaw: 0.5 },
    echo: JSON.parse(JSON.stringify(echo))
  }
} as unknown as RunCheckpoint);

// 1) legit base echo frame is NOT falsely rejected
const legit = baseFrame();
check('legit core-built base echo frame passes validateCheckpoint', validateCheckpoint(legit));
check('validEchoActor accepts real core echo data', validEchoActor(JSON.parse(JSON.stringify(echo))));
check('cloneCheckpoint preserves a valid echo', validateCheckpoint(cloneCheckpoint(legit)));

// 2) legit damaged / fired echo still passes (no false rejection of normal play)
const damaged = baseFrame();
damaged.coreState!.echo!.data.hp = 42;
damaged.coreState!.echo!.fireTimer = 0.33; damaged.coreState!.echo!.hurtTimer = 0.2; damaged.coreState!.echo!.invuln = 0.1;
check('damaged echo HP=42 with running timers passes (no false rejection)', validateCheckpoint(damaged), { hp: damaged.coreState!.echo!.data.hp });

// 3) legit PLAYER upgrades (valid upgrade key/level) in the same frame must not be rejected
const upgradedPlayer = baseFrame();
upgradedPlayer.player = { ...upgradedPlayer.player, level: 7, xp: 120, xpToNext: 400, currency: 55, weaponKey: 'scatter',
  weapons: [{ key: 'scatter', level: 3, ammo: 8, magazine: 8, reloading: false, reloadTimer: 0 }],
  upgrades: [{ key: 'power', level: 2 }], abilities: ['dash'] };
check('normal PLAYER upgrades do not falsely reject an echo frame', validateCheckpoint(upgradedPlayer));
check('the echo itself is still base-only in that frame', upgradedPlayer.coreState!.echo!.data.level === 1 && upgradedPlayer.coreState!.echo!.data.upgrades.length === 0);

// 4) old save without echo stays valid
const old = baseFrame(); delete (old.coreState as any).echo;
check('old save without echo stays valid', validateCheckpoint(old) && cloneCheckpoint(old).coreState!.echo === undefined);

// 5) deep validation: injected stats / skills / weapons / non-finite numbers rejected
const tamper = (mut: (f: RunCheckpoint) => void, name: string) => { const f = baseFrame(); mut(f); check(name, !validateCheckpoint(f)); };
tamper((f) => { f.coreState!.echo!.data.speed = 999999; }, 'rejects injected speed beyond cap');
tamper((f) => { f.coreState!.echo!.data.armor = 5000; }, 'rejects injected armor beyond cap');
tamper((f) => { f.coreState!.echo!.data.critChance = 2; }, 'rejects out-of-range critChance');
tamper((f) => { f.coreState!.echo!.data.upgrades.push({ key: 'power', level: 1 } as any); }, 'rejects injected free upgrades');
tamper((f) => { f.coreState!.echo!.data.abilities.push('jam'); }, 'rejects injected abilities');
tamper((f) => { f.coreState!.echo!.data.weapons.push({ key: 'scatter', level: 1, ammo: 8, magazine: 8, reloading: false, reloadTimer: 0 }); }, 'rejects extra weapon');
tamper((f) => { f.coreState!.echo!.data.weaponKey = 'scatter'; }, 'rejects non-pulse weapon');
tamper((f) => { f.coreState!.echo!.data.speed = Number.NaN; }, 'rejects NaN speed');
tamper((f) => { f.coreState!.echo!.data.armor = Number.POSITIVE_INFINITY; }, 'rejects Infinity armor');
tamper((f) => { f.coreState!.echo!.data.hp = -1; }, 'rejects negative HP');
tamper((f) => { f.coreState!.echo!.data.hp = 101; }, 'rejects HP > maxHp');
tamper((f) => { f.coreState!.echo!.data.maxHp = 0; }, 'rejects maxHp <= 0');
tamper((f) => { f.coreState!.echo!.x = Number.NaN; }, 'rejects NaN position');
tamper((f) => { f.coreState!.echo!.actorId = 2; }, 'rejects wrong actorId');
tamper((f) => { (f.coreState!.echo as any).fireTimer = -1; }, 'rejects negative timer');
check('ECHO_STAT_BOUNDS are absolute caps (not pinned to base values)', ECHO_STAT_BOUNDS.hp === 10000 && ECHO_STAT_BOUNDS.damage === 100 && ECHO_STAT_BOUNDS.hpRegen === 100);

// 6) RESIDUAL evidence: values INSIDE the loose caps but far above base are ACCEPTED.
const injections: Array<[string, number, number]> = [
  ['damage', 99, 1.0], ['hpRegen', 50, 0], ['cooldownReduced', 1, 0],
  ['critDamage', 99, 1.5], ['pierceCount', 10, 0], ['speed', 1000, 220],
  ['armor', 1000, 0], ['pickupRange', 1000, 90], ['xpGain', 100, 1.0]
];
for (const [key, injected, base] of injections) {
  const f = baseFrame(); (f.coreState!.echo!.data as any)[key] = injected;
  const accepted = validateCheckpoint(f);
  info(`stat ${key}=${injected} (base ${base}) ${accepted ? 'ACCEPTED — loose cap' : 'rejected'}`, { accepted });
}
const bigHp = baseFrame(); bigHp.coreState!.echo!.data.maxHp = 10000; bigHp.coreState!.echo!.data.hp = 10000;
info(`maxHp=10000 / hp=10000 (base 100) ${validateCheckpoint(bigHp) ? 'ACCEPTED — HP injection possible' : 'rejected'}`, { accepted: validateCheckpoint(bigHp) });

// 7) Controller.reset clears every authority field
const c = new EchoController();
const ev = { tick: 10, player: { x: 0, y: 0 }, echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 }, drones: [{ id: 1, x: 1, y: 0, hp: 5 }] };
c.setMode('move-to', { x: 5, y: 0 }); c.confirmAssist(); c.observe(ev); c.decide(ev);
check('controller armed/memory/mode seeded', c.assistConfirmed && c.memory.length > 0 && c.mode === 'move-to');
c.reset();
check('reset clears assist/mode/moveTarget/memory/suggestion/intent', !c.assistConfirmed && c.mode === 'follow' && c.moveTarget === null && c.memory.length === 0 && c.suggestion === null && !c.lastIntent.fire);
check('reset cannot fire without a NEW confirmation', c.decide({ ...ev, tick: 11 }).fire === false);

console.log(`CHECKPOINT_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
