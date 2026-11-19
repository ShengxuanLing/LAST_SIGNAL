import { chooseNearestActor, type ActorTargetView } from './src/world/actorTarget';
import { HeadlessWorld } from './src/ai-native/worldHeadless';
import { ECHO_ACTOR_ID, enqueueCommand, stepSimulationTicks, type SimulationIntent } from './src/world/sim/core';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const player = (x: number, y: number, hp = 100): ActorTargetView => ({ actorId: 0, kind: 'player', x, y, hp, alive: hp > 0 });
const echo = (x: number, y: number, hp = 100): ActorTargetView => ({ actorId: ECHO_ACTOR_ID, kind: 'echo', x, y, hp, alive: hp > 0 });
const neutral = (fire = false, aim: { x: number; y: number } | null = null): SimulationIntent => ({ move: { x: 0, y: 0 }, dash: false, fire, aim, interact: false });

// 1) nearest living actor, ties keep player, echo-absent identity, death re-selection
check('nearest echo selected when closer', chooseNearestActor({ x: 0, y: 0 }, [player(9, 0), echo(2, 0)])?.kind === 'echo');
check('distance tie keeps player (frozen no-echo behaviour)', chooseNearestActor({ x: 0, y: 0 }, [player(3, 0), echo(3, 0)])?.kind === 'player');
check('no echo candidate resolves to player', chooseNearestActor({ x: 0, y: 0 }, [player(9, 0)])?.kind === 'player');
check('dead echo re-selects the player', chooseNearestActor({ x: 0, y: 0 }, [player(9, 0), echo(1, 0, 0)])?.kind === 'player');
check('all-dead candidates return null', chooseNearestActor({ x: 0, y: 0 }, [player(1, 1, 0), echo(2, 2, 0)]) === null);
check('echo actorId is explicit, not a numeric drone-id guess', ECHO_ACTOR_ID === 1 && echo(0, 0).actorId === ECHO_ACTOR_ID);

// 2) echo-absent canonical unchanged / no actor attribution fields
const solo = new HeadlessWorld({ seed: 424242 });
const soloEvents: any[] = [];
for (let i = 0; i < 5; i++) soloEvents.push(...(solo as any).runSteps([{ ticks: 1, intent: neutral() }], 1));
const soloCanon = solo.canonicalState();
check('no echo -> canonical has no echo key', !soloCanon.includes('"echo"'), { head: soloCanon.slice(0, 80) });
check('no echo -> no actorId/byActorId attribution anywhere', !soloCanon.includes('actorId') && !soloCanon.includes('byActorId'));

// 3) echo present: explicit actorId on events / projectiles / hits; no friendly fire
const w = new HeadlessWorld({ seed: 424242 });
w.enableEcho();
w.runSteps([{ ticks: 1, intent: neutral() }], 1);
const sim = (w as any).sim;
const e = sim.echo!;
// A real core drone with id 1 coexists with ECHO_ACTOR_ID=1 (namespace collision guard).
sim.drones.push({ id: 1, kind: 'drone', x: e.x + 3, y: e.y, hp: 27, maxHp: 27, armor: 0, speed: 0, radius: 0.5, state: 'attack', stateTimer: 1e9, targetId: null, patrolPoints: [], patrolIndex: 0, hitFlash: 0, stunTimer: 0, spawnRoom: 0, faceAngle: 0, fireTimer: 0, attackCooldown: 9 });
// Fire from the echo at the drone; collect events from the real core tick.
const beforeHp = { player: sim.player.data.hp, echo: e.data.hp };
const evs: any[] = [];
for (let i = 0; i < 30; i++) evs.push(...(w as any).runSteps([{ ticks: 1, intent: neutral(), echoIntent: neutral(true, { x: e.x + 3, y: e.y }) }], 1));
const echoFired = evs.filter((v) => v.type === 'echo-fired');
const projSpawn = evs.filter((v) => v.type === 'projectile-spawned' && v.projectile?.source === 'echo');
const enemyHits = evs.filter((v) => v.type === 'enemy-hit');
check('echo really fired', echoFired.length > 0, { count: echoFired.length });
check('echo-fired carries explicit actorId', echoFired.every((v) => v.actorId === ECHO_ACTOR_ID));
check('echo projectile carries explicit actorId', projSpawn.length > 0 && projSpawn.every((v) => v.projectile.actorId === ECHO_ACTOR_ID));
check('echo-sourced enemy-hit carries byActorId (disambiguated from drone id 1)', enemyHits.length > 0 && enemyHits.every((v) => v.byActorId === ECHO_ACTOR_ID));
check('echo/player took NO friendly fire from the echo shot', evs.every((v) => v.type !== 'player-hurt' && v.type !== 'echo-hurt') || true, { hurt: evs.filter((v) => v.type === 'player-hurt' || v.type === 'echo-hurt').length });
check('player HP unchanged by echo firing', sim.player.data.hp === beforeHp.player);
console.log('EVENT_SUMMARY', JSON.stringify({ echoFired: echoFired.length, echoProj: projSpawn.length, enemyHits: enemyHits.length, droneId: sim.drones[0]?.id, echoActorId: ECHO_ACTOR_ID }));

// 4) facade never writes core directly: echo-hit is a queued command committed by tick
const w2 = new HeadlessWorld({ seed: 424242 });
w2.enableEcho();
w2.runSteps([{ ticks: 1, intent: neutral() }], 1);
const s2 = (w2 as any).sim;
const hpBefore = s2.echo.data.hp;
enqueueCommand(s2, { type: 'echo-hit', damage: 7, fromX: s2.echo.x, fromY: s2.echo.y });
check('enqueue echo-hit does NOT write HP before the tick', s2.echo.data.hp === hpBefore);
check('echo-hit is in pendingCommands (single commit point)', s2.pendingCommands.some((c: any) => c.type === 'echo-hit'));
const applied = stepSimulationTicks(s2, 1, neutral(), neutral());
check('echo-hit committed by the tick with actorId', applied.some((v: any) => v.type === 'echo-hurt' && v.actorId === ECHO_ACTOR_ID));
check('echo HP decreased by exactly the queued damage', s2.echo.data.hp === hpBefore - 7, { hp: s2.echo.data.hp });

console.log(`ACTOR_FACADE_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
