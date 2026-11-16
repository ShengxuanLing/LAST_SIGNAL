import { GAME, basePlayerData } from './src/config/game';
import { ENEMY_STATS } from './src/config/enemies';
import { MapGenerator, assignRoles, guaranteeReachable } from './src/world/MapGenerator';
import { RNG } from './src/core/random';
import type { EnemyData, PlayerData } from './src/types';
import { createSimulationState, isWalkableFromState, registerDrone, stepSimulationTicks, type SimulationIntent } from './src/world/sim/core';

let fails = 0;
const check = (name: string, cond: boolean, detail?: unknown) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` ${JSON.stringify(detail)}`}`); if (!cond) fails++; };
function map() { const g = new MapGenerator(424242); const m = g.generate(); assignRoles(g, m.rooms, m.roomsOrder); guaranteeReachable(m); return m; }
function pd(): PlayerData { const b = basePlayerData(); return { ...b, level:1, xp:0, xpToNext:30, currency:0, weaponKey:'pulse', weapons:[{key:'pulse',level:1,ammo:-1,magazine:-1,reloading:false,reloadTimer:0}], upgrades:[], abilities:[] } as PlayerData; }
function dd(): EnemyData { const d=ENEMY_STATS.drone; return { kind:'drone', stats:{...d, speed:d.speed/64, aggroRange:d.aggroRange/64, attackRange:d.attackRange/64}, state:'idle', stateTimer:1000, targetId:null, patrolPoints:[], patrolIndex:0, hitFlash:0, stunTimer:0, spawnRoom:0 }; }
function scenario(name: string, droneCount: number) {
  const m = map(); const st = createSimulationState({ seed:424242, map:m, playerData:pd(), playerX:0, playerY:0 });
  const tiles = m.tiles.flat().filter(t => t.type==='floor' || t.type==='spawn');
  let spot: any = null; for (const t of tiles) { if (isWalkableFromState(st,t.x,t.y,0.5) && isWalkableFromState(st,t.x+2,t.y,0.5)) { spot={x:t.x,y:t.y}; break; } }
  if (!spot) throw new Error('no spot'); st.player.x=spot.x; st.player.y=spot.y;
  for (let i=0;i<droneCount;i++) { const d=dd(); registerDrone(st,{id:i+1,x:spot.x+2,y:spot.y+i*0.5,hp:1,data:d,attackTimer:1000,wanderTimer:1000}); }
  const intent: SimulationIntent = { move:{x:0,y:0}, dash:false, fire:true, aim:{x:spot.x+2,y:spot.y}, interact:false };
  const events = stepSimulationTicks(st, 180, intent);
  const ref = new RNG(st.seed*7919+1);
  const expected: boolean[] = []; const actual: boolean[] = [];
  for (const e of events) {
    if (e.type==='projectile-spawned' && e.projectile.side==='player') { actual.push(e.projectile.crit); expected.push(ref.float() < st.player.data.critChance); }
    if (e.type==='enemy-died') { ref.float(); ref.float(); }
  }
  const deaths = events.filter(e=>e.type==='enemy-died').length;
  check(`${name}.deaths`, droneCount===0 || deaths>0, { deaths });
  check(`${name}.crit-order`, JSON.stringify(actual)===JSON.stringify(expected), { actual, expected, deaths });
  check(`${name}.rng-state`, st.rngState===ref.snapshot(), { st: st.rngState, ref: ref.snapshot() });
}
scenario('no-kill-1shot', 0);
scenario('one-kill', 1);
scenario('two-kills', 2);
console.log(JSON.stringify({ result: fails===0?'RNG_MULTI_PASS':'RNG_MULTI_FAIL', failures:fails },null,2));
if (fails) process.exitCode=1;
