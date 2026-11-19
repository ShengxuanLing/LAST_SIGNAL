import { buildEchoObservation } from './src/world/echoView';
import { echoPlayerData } from './src/world/sim/core';
import { HeadlessWorld } from './src/ai-native/worldHeadless';
import type { SimEchoState } from './src/world/sim/core';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const mkEcho = (x: number, y: number): SimEchoState => ({ actorId: 1, x, y, data: echoPlayerData(), dashTimer: 0, invuln: 0, hurtTimer: 0, fireTimer: 0, aimYaw: 0 });

// 1) shared projection: targets/Boss public data only, no hidden state
const view = buildEchoObservation({
  echo: mkEcho(0, 0), player: { x: 2, y: 0 }, tick: 7,
  drones: [{ id: 1, x: 1, y: 0, hp: 20 }],
  targets: [
    { id: 2, kind: 'hunter', x: 2, y: 1, hp: 60, isBoss: false },
    { id: 3, kind: 'boss_warden', x: 3, y: 0, hp: 900, isBoss: true }
  ],
  isExplored: () => true, isOpaque: () => false
});
check('drones present', view.drones.map((d) => d.id).join(',') === '1');
check('targets + Boss present with public state', view.targets.map((t) => t.id).join(',') === '2,3' && view.targets.find((t) => t.isBoss)?.kind === 'boss_warden', { targets: view.targets });
const json = JSON.stringify(view);
const forbidden = ['rngState', 'seed', 'mapHash', 'map', 'pendingCommands', 'pendingPlayerHits', 'purchaseTransactions', 'nextProjectileId', 'loot', 'tiles', 'rooms', 'upgrade', 'abilities', 'weaponKey', 'weapons', 'armor', 'speed', 'damage', 'patrolPoints', 'targetId'];
const leaked = forbidden.filter((k) => json.includes(`"${k}"`));
check('shared projection leaks NO hidden/authoritative fields', leaked.length === 0, { leaked });
check('echo view centred on echo (player is a separate public point)', view.echo.x === 0 && view.echo.y === 0 && view.player.x === 2);
check('target objects carry only id/kind/x/y/hp/isBoss', Object.keys(view.targets[0]).sort().join(',') === 'hp,id,isBoss,kind,x,y', { keys: Object.keys(view.targets[0]) });

// 2) LOS / explored / radius / dead filtering: hidden projection never leaks
const hidden = buildEchoObservation({
  echo: mkEcho(0, 0), player: { x: 0, y: 0 }, tick: 0,
  drones: [{ id: 1, x: 40, y: 0, hp: 20 }, { id: 2, x: 1, y: 0, hp: 0 }],
  targets: [
    { id: 3, kind: 'hunter', x: 1, y: 0, hp: 0, isBoss: false },
    { id: 4, kind: 'sentinel', x: 1, y: 1, hp: 20, isBoss: false },
    { id: 5, kind: 'stalker', x: 4, y: 0, hp: 20, isBoss: false }
  ],
  isExplored: (x) => x < 0.5, isOpaque: (x) => x > 1 && x < 3
});
check('dead / hidden / unexplored / wall-blocked actors are dropped', hidden.drones.length === 0 && hidden.targets.length === 0, { drones: hidden.drones, targets: hidden.targets });

// 3) Headless runtime really exposes sim.targets via the shared projection
const w = new HeadlessWorld({ seed: 424242 });
w.enableEcho();
w.runSteps([{ ticks: 1, intent: { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false } }], 1);
const sim = (w as any).sim;
const e = sim.echo!;
sim.targets.push({ id: 77, kind: 'hunter', x: e.x + 1, y: e.y, hp: 60, maxHp: 60, armor: 0, radius: 0.5, isBoss: false, xpValue: 4, currencyValue: 4 });
sim.targets.push({ id: 78, kind: 'boss_warden', x: e.x + 2, y: e.y, hp: 900, maxHp: 900, armor: 2, radius: 2, isBoss: true, xpValue: 40, currencyValue: 40 });
sim.targets.push({ id: 79, kind: 'stalker', x: e.x + 500, y: e.y, hp: 20, maxHp: 20, armor: 0, radius: 0.5, isBoss: false, xpValue: 4, currencyValue: 4 });
const allRooms = sim.map.rooms.map((_r: any, i: number) => i);
const hv = HeadlessWorld.fromSimulationState(sim, allRooms).echoView();
check('Headless echoView includes real sim.targets + Boss public state', hv?.targets.map((t) => t.id).sort((a, b) => a - b).join(',') === '77,78', { ids: hv?.targets.map((t) => t.id) });
check('far/hidden target 79 not leaked', !hv?.targets.some((t) => t.id === 79));
check('Headless echoView target objects are public-only', hv!.targets.every((t) => Object.keys(t).sort().join(',') === 'hp,id,isBoss,kind,x,y'));
check('Headless echoView has no rng/seed/map fields', !JSON.stringify(hv).includes('rngState') && !JSON.stringify(hv).includes('seed'));

console.log(`ECHO_VIEW_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
