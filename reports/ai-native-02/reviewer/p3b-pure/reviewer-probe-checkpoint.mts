import { basePlayerData } from './src/config/game';
import { echoPlayerData, registerEcho, createSimulationState, ECHO_ACTOR_ID, type SimulationState } from './src/world/sim/core';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import { validateCheckpoint, cloneCheckpoint } from './src/systems/RunCheckpoint';
import { AI_NATIVE_LIMITS_V1 } from './src/ai-native/protocol';
import type { RunCheckpoint } from './src/types';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));

const gen = new MapGenerator(424242);
const map = gen.generate(); assignRoles(gen, map.rooms, map.roomsOrder); guaranteeReachable(map);
const state: SimulationState = createSimulationState({
  seed: 424242, map, playerX: 3, playerY: 4,
  playerData: { ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: 0, weaponKey: 'pulse',
    weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }], upgrades: [], abilities: [] }
});
const echo = registerEcho(state, 5, 6);
const frame = (): RunCheckpoint => ({
  id: 'reviewer', seed: 424242, roomId: 0, position: { x: 3, y: 4 }, clearedRooms: [0], portalTarget: null,
  rngState: 123456, player: { ...state.player.data }, loot: [], stats: { kills: 0, items: 0, damage: 0, elapsedSeconds: 2 },
  coreState: { tick: 120, rngState: 999, nextProjectileId: 4, purchaseTransactions: [],
    playerTimers: { dashTimer: 0, invuln: 0, hurtTimer: 0, fireTimer: 0.1, aimYaw: 0.5 },
    echo: JSON.parse(JSON.stringify(echo)) }
} as unknown as RunCheckpoint);

// 1. real factory frame + old archive + player upgrades are NOT falsely rejected
check('real core-built echo frame accepted', validateCheckpoint(frame()));
check('cloneCheckpoint round-trip remains valid', validateCheckpoint(cloneCheckpoint(frame())));
const old = frame(); delete (old.coreState as any).echo;
check('old archive without echo accepted', validateCheckpoint(old) && cloneCheckpoint(old).coreState!.echo === undefined);
const upgraded = frame();
upgraded.player = { ...upgraded.player, level: 7, xp: 120, xpToNext: 400, currency: 55, weaponKey: 'scatter',
  weapons: [{ key: 'scatter', level: 3, ammo: 8, magazine: 8, reloading: false, reloadTimer: 0 }],
  upgrades: [{ key: 'power', level: 2 }], abilities: ['dash'] };
check('normal player upgrades do not falsely reject echo frame', validateCheckpoint(upgraded));

// 2. runtime HP / facing / positions / timers boundaries
const runtime = frame(); const e = runtime.coreState!.echo!;
e.data.hp = 1; e.data.aimYaw = -2.5; e.x = 12.25; e.y = -3.5; e.aimYaw = -1.2;
e.invuln = 0.5; e.hurtTimer = 0.25; e.fireTimer = 0.3; e.dashTimer = 0.1; e.data.weapons[0].reloadTimer = 0.2;
check('runtime damage / negative facing / negative coords / timers accepted', validateCheckpoint(runtime));
const dead = frame(); dead.coreState!.echo!.data.hp = 0;
check('dead echo hp=0 accepted (real resolvePlayerHit clamps at 0)', validateCheckpoint(dead));
const full = frame(); full.coreState!.echo!.data.hp = 100;
check('full-hp echo accepted', validateCheckpoint(full));

// 3. EVERY non-upgradeable factory field pinned exactly (not merely bounded)
const base = echoPlayerData();
const pinned = ['maxHp','speed','armor','damage','critChance','critDamage','xpGain','pickupRange','dashCooldown','dashDuration','cooldownReduced','pierceCount','hpRegen','level','xp','xpToNext','currency','weaponKey'];
for (const key of pinned) {
  const f = frame();
  (f.coreState!.echo!.data as unknown as Record<string, unknown>)[key] =
    typeof (base as any)[key] === 'number' ? (base as any)[key] + 1 : (key === 'weaponKey' ? 'scatter' : 'x');
  check(`pinned ${key} tamper rejected`, !validateCheckpoint(f));
}
check('all 18 pinned keys equal the factory', pinned.length === 18);
check('ECHO_ACTOR_ID is the factory identity', ECHO_ACTOR_ID === 1 && echo.actorId === ECHO_ACTOR_ID);

// 4. all previously flagged "within-absolute-cap" injections now rejected
const injections: Array<[string, number]> = [['damage',99],['hpRegen',50],['cooldownReduced',1],['critDamage',99],['pierceCount',10],['speed',1000],['armor',1000],['pickupRange',1000],['xpGain',100],['maxHp',10000],['hp',10000],['xp',100],['currency',100],['level',2]];
for (const [k,v] of injections) { const f=frame(); (f.coreState!.echo!.data as any)[k]=v; check(`${k}=${v} rejected`, !validateCheckpoint(f)); }

// 5. structural / finite / identity / hidden-field negatives
const neg: Array<[string,(f:RunCheckpoint)=>void]> = [
  ['hp<0', f=>{f.coreState!.echo!.data.hp=-1;}],
  ['hp>maxHp', f=>{f.coreState!.echo!.data.hp=101;}],
  ['maxHp=0', f=>{f.coreState!.echo!.data.maxHp=0;}],
  ['NaN hp', f=>{f.coreState!.echo!.data.hp=Number.NaN;}],
  ['Inf armor', f=>{f.coreState!.echo!.data.armor=Number.POSITIVE_INFINITY;}],
  ['NaN x', f=>{f.coreState!.echo!.x=Number.NaN;}],
  ['x beyond coord cap', f=>{f.coreState!.echo!.x=AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS+1;}],
  ['wrong actorId', f=>{f.coreState!.echo!.actorId=2;}],
  ['negative timer', f=>{(f.coreState!.echo as any).fireTimer=-1;}],
  ['timer > MAX_TICK', f=>{(f.coreState!.echo as any).fireTimer=AI_NATIVE_LIMITS_V1.MAX_TICK+1;}],
  ['reloadTimer > MAX_TICK', f=>{f.coreState!.echo!.data.weapons[0].reloadTimer=AI_NATIVE_LIMITS_V1.MAX_TICK+1;}],
  ['extra weapon', f=>{f.coreState!.echo!.data.weapons.push({key:'scatter',level:1,ammo:8,magazine:8,reloading:false,reloadTimer:0});}],
  ['wrong weapon key', f=>{f.coreState!.echo!.data.weaponKey='scatter';}],
  ['reloading true', f=>{f.coreState!.echo!.data.weapons[0].reloading=true;}],
  ['free upgrade', f=>{f.coreState!.echo!.data.upgrades.push({key:'power',level:1} as any);}],
  ['free ability', f=>{f.coreState!.echo!.data.abilities.push('jam');}],
  ['NaN data.aimYaw', f=>{f.coreState!.echo!.data.aimYaw=Number.NaN;}],
];
for (const [n,mut] of neg) { const f=frame(); mut(f); check(`negative ${n} rejected`, !validateCheckpoint(f)); }

// 6. RESIDUAL evidence: fields NOT pinned / not deeply validated
for (const [k,v] of [['data.aimYaw', 1e9],['e.aimYaw', 1e9],['e.fireTimer', 2e9],['weapon.reloadTimer', 2e9]] as Array<[string,number]>) {
  const f = frame();
  if (k==='data.aimYaw') f.coreState!.echo!.data.aimYaw = v;
  else if (k==='e.aimYaw') (f.coreState!.echo as any).aimYaw = v;
  else if (k==='e.fireTimer') (f.coreState!.echo as any).fireTimer = v;
  else f.coreState!.echo!.data.weapons[0].reloadTimer = v;
  info(`${k}=${v} ${validateCheckpoint(f)?'ACCEPTED (loose runtime bound)':'rejected'}`, { accepted: validateCheckpoint(f) });
}
const hidden = frame(); (hidden.coreState!.echo as any).hiddenTarget = { x: 1, y: 2, hp: 999 };
info(`extra hiddenTarget key ${validateCheckpoint(hidden)?'ACCEPTED (denylist, extra keys kept)':'rejected'}`, { accepted: validateCheckpoint(hidden) });

console.log(`CHECKPOINT_${failures===0?'PASS':'FAIL'} failures=${failures}`);
if (failures>0) process.exit(1);
