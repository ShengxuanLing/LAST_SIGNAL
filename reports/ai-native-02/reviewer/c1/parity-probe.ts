// Independent reviewer parity probe for C1 (frozen snapshot cdb594e).
// Compares the new pure rule outputs against the exact parent 1aadd2e inline formulas.
// Runs with vite-node from the snapshot root; all persistent output goes to reviewer/c1/.
import { GAME, basePlayerData } from './src/config/game';
import { WEAPONS } from './src/config/weapons';
import { ENEMY_STATS } from './src/config/enemies';
import { IsoMath } from './src/core/iso';
import { RNG } from './src/core/random';
import {
  advanceProjectile, axisSlide, buildWeaponSpec, createProjectileData,
  damageAfterArmor, projectileHitsTarget, resolveEnemyHit,
  screenVelocityToGridVelocity, stepDroneAi, stepPlayerMovement,
  segmentPointDistance
} from './src/world/sim/rules';

let checks = 0;
let failures = 0;
const fail = (name: string, detail: unknown) => {
  failures++;
  console.log(`FAIL ${name}: ${JSON.stringify(detail)}`);
};
const ok = (name: string, cond: boolean, detail?: unknown) => {
  checks++;
  if (!cond) fail(name, detail);
};
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const samePoint = (a: any, b: any, eps = 1e-9) => close(a.x, b.x, eps) && close(a.y, b.y, eps);

// --- 1. damageAfterArmor vs parent Player.hurt / Enemy.hit inline formula ---
for (const armor of [0, 1, 8, 12, 80, 1000]) {
  for (const amount of [0, 1, 6, 12, 42, 999]) {
    const old = Math.max(1, amount * (1 - Math.min(0.75, armor / (armor + 80))));
    const neu = damageAfterArmor(amount, armor);
    ok(`armor(${armor},${amount})`, close(old, neu), { old, neu });
  }
}

// --- 2. buildWeaponSpec vs parent Player.tryFire inline spec ---
function oldWeaponSpec(w: any, data: any, magazine: number) {
  return {
    damage: w.baseDamage * data.damage,
    speed: w.baseProjectileSpeed / GAME.PIXEL_TO_TILE,
    critBase: w.critBase,
    critDamage: data.critDamage,
    critChance: data.critChance,
    pierce: data.pierceCount + (w.kind === 'plasma' ? 2 : 0),
    lifetime: w.baseRange / w.baseProjectileSpeed,
    kind: w.kind,
    magazine,
    shots: w.kind === 'scatter' ? 5 : 1,
    spread: w.baseSpread
  };
}
const pdata = basePlayerData();
for (const key of Object.keys(WEAPONS)) {
  const w = WEAPONS[key];
  const mag = w.magazine ?? -1;
  const old = oldWeaponSpec(w, pdata, mag);
  const neu: any = buildWeaponSpec({
    weapon: w, damageMultiplier: pdata.damage, critChance: pdata.critChance,
    critDamage: pdata.critDamage, pierceCount: pdata.pierceCount, magazine: mag,
    pixelToTile: GAME.PIXEL_TO_TILE
  });
  for (const k of Object.keys(old)) ok(`spec.${key}.${k}`, close((old as any)[k], neu[k], 1e-9) || (old as any)[k] === neu[k], { old: (old as any)[k], neu: neu[k] });
}

// --- 3. createProjectileData vs parent World.spawnProjectile inline; RNG order/state ---
function oldProjectile(spec: any, angle: number, i: number, shots: number, origin: any, id: number, ownerId: number, side: string, rng: RNG) {
  const spread = spec.spread ?? 0;
  const a = angle + (shots > 1 ? (i / (shots - 1) - 0.5) * spread * shots : 0);
  const px = origin.x + Math.cos(a) * 16 / GAME.PIXEL_TO_TILE;
  const py = origin.y + Math.sin(a) * 16 / GAME.PIXEL_TO_TILE;
  const crit = rng.float() < spec.critChance;
  const dmg = (crit ? spec.critDamage : 1) * spec.damage;
  return {
    id, ownerId, side,
    pos: { x: px, y: py },
    vel: { x: Math.cos(a) * spec.speed, y: Math.sin(a) * spec.speed },
    damage: dmg, lifetime: spec.lifetime,
    radius: Math.max((spec.magazine > 0 && spec.kind === 'scatter' ? 5 : 6) / GAME.PIXEL_TO_TILE, 0.2),
    crit, pierce: spec.pierce ?? 0, hitSet: new Set<number>()
  };
}
for (const key of Object.keys(WEAPONS)) {
  const w = WEAPONS[key];
  const mag = w.magazine ?? -1;
  const spec: any = buildWeaponSpec({
    weapon: w, damageMultiplier: pdata.damage, critChance: pdata.critChance,
    critDamage: pdata.critDamage, pierceCount: pdata.pierceCount, magazine: mag,
    pixelToTile: GAME.PIXEL_TO_TILE
  });
  const shots = spec.shots;
  for (let i = 0; i < shots; i++) {
    const seed = 1000 + i * 7 + key.length;
    const rngOld = new RNG(seed);
    const rngNew = new RNG(seed);
    const old = oldProjectile(spec, 0.37, i, shots, { x: 10, y: 20 }, 100 + i, 0, 'player', rngOld);
    const neu: any = createProjectileData({
      id: 100 + i, ownerId: 0, side: 'player', origin: { x: 10, y: 20 }, angle: 0.37,
      spec, rng: rngNew, shotIndex: i, shotCount: shots, pixelToTile: GAME.PIXEL_TO_TILE
    });
    ok(`proj.${key}.${i}.id`, old.id === neu.id);
    ok(`proj.${key}.${i}.ownerId`, old.ownerId === neu.ownerId);
    ok(`proj.${key}.${i}.side`, old.side === neu.side);
    ok(`proj.${key}.${i}.pos`, samePoint(old.pos, neu.pos), { old: old.pos, neu: neu.pos });
    ok(`proj.${key}.${i}.vel`, samePoint(old.vel, neu.vel), { old: old.vel, neu: neu.vel });
    ok(`proj.${key}.${i}.damage`, close(old.damage, neu.damage), { old: old.damage, neu: neu.damage });
    ok(`proj.${key}.${i}.lifetime`, close(old.lifetime, neu.lifetime));
    ok(`proj.${key}.${i}.radius`, close(old.radius, neu.radius));
    ok(`proj.${key}.${i}.crit`, old.crit === neu.crit, { old: old.crit, neu: neu.crit });
    ok(`proj.${key}.${i}.pierce`, old.pierce === neu.pierce);
    ok(`proj.${key}.${i}.hitSet`, old.hitSet.size === neu.hitSet.size);
    ok(`proj.${key}.${i}.rngState`, rngOld.snapshot() === rngNew.snapshot(), { old: rngOld.snapshot(), neu: rngNew.snapshot() });
  }
}

// --- 4. advanceProjectile vs parent World.updateProjectiles inline ---
const tileAt = (x: number, y: number): any => (x > 50 ? { type: 'wall' } : { type: 'floor' });
for (const dt of [0.016, 0.1, 0.5]) {
  const pos = { x: 10, y: 10 }, vel = { x: 5, y: -3 }, lifetime = 0.4;
  const oldPos = { x: pos.x + vel.x * dt, y: pos.y + vel.y * dt };
  const oldLifetime = lifetime - dt;
  const oldHitWall = tileAt(oldPos.x, oldPos.y).type === 'wall';
  const oldExpired = oldLifetime <= 0 || oldHitWall || oldPos.x < -40 || oldPos.x > 200 + 40 || oldPos.y < -40 || oldPos.y > 200 + 40;
  const neu = advanceProjectile({ pos, vel, lifetime, dt, tileAt, mapWidth: 200, mapHeight: 200 });
  ok(`advance.${dt}.pos`, samePoint(oldPos, neu.pos));
  ok(`advance.${dt}.lifetime`, close(oldLifetime, neu.lifetime));
  ok(`advance.${dt}.hitWall`, oldHitWall === neu.hitWall);
  ok(`advance.${dt}.expired`, oldExpired === neu.expired);
}
const wallCase = advanceProjectile({ pos: { x: 49, y: 0 }, vel: { x: 10, y: 0 }, lifetime: 1, dt: 0.5, tileAt, mapWidth: 200, mapHeight: 200 });
ok('advance.wall', wallCase.hitWall && wallCase.expired);

// --- 5. projectileHitsTarget vs parent segmentPointDistance inline ---
function oldSeg(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 <= 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
for (const c of [
  { a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, t: { x: 1, y: 0 }, r: 0.5, pr: 0.2 },
  { a: { x: 0, y: 0 }, b: { x: 2, y: 0 }, t: { x: 0, y: 5 }, r: 0.5, pr: 0.2 },
  { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, t: { x: 0.1, y: 0 }, r: 0.5, pr: 0.2 },
  { a: { x: -3, y: 4 }, b: { x: 5, y: -2 }, t: { x: 1, y: 1 }, r: 0.4, pr: 0.3 }
]) {
  const old = oldSeg(c.a.x, c.a.y, c.b.x, c.b.y, c.t.x, c.t.y) <= c.r + c.pr;
  const neu = projectileHitsTarget(c.a, c.b, c.t, c.r, c.pr);
  const segEqual = close(segmentPointDistance(c.a.x, c.a.y, c.b.x, c.b.y, c.t.x, c.t.y), oldSeg(c.a.x, c.a.y, c.b.x, c.b.y, c.t.x, c.t.y));
  ok('swept.hit', old === neu, { old, neu });
  ok('swept.segmentDistance', segEqual);
}

// --- 6. resolveEnemyHit vs parent Enemy.hit inline ---
function oldEnemyHit(hp: number, pos: any, armor: number, stun: number, damage: number, source: any, isWalkable: (x: number, y: number, r: number) => boolean) {
  if (stun > 0) return { blocked: true, hp, position: { ...pos }, hitFlash: 0, knockbackApplied: false };
  const reduction = 1 - Math.min(0.75, armor / (armor + 80));
  const dmg = Math.max(1, damage * reduction);
  const dx = pos.x - source.x, dy = pos.y - source.y;
  const d = Math.hypot(dx, dy) || 1;
  const kb = 16 / GAME.PIXEL_TO_TILE;
  const nx = pos.x + (dx / d) * kb, ny = pos.y + (dy / d) * kb;
  const okWalk = isWalkable(nx, ny, 0.4);
  return { blocked: false, hp: hp - dmg, position: okWalk ? { x: nx, y: ny } : { ...pos }, hitFlash: 0.15, knockbackApplied: okWalk };
}
for (const armor of [0, 8, 80]) {
  for (const stun of [0, 0.2]) {
    for (const walk of [true, false]) {
      const hp = 40, pos = { x: 5, y: 5 }, damage = 30, source = { x: 4, y: 4 };
      const isW = (_x: number, _y: number, _r: number) => walk;
      const old = oldEnemyHit(hp, pos, armor, stun, damage, source, isW);
      const neu = resolveEnemyHit({ hp, position: pos, armor, stunTimer: stun, damage, source, isWalkable: isW, pixelToTile: GAME.PIXEL_TO_TILE });
      ok(`enemyHit(${armor},${stun},${walk}).blocked`, old.blocked === neu.blocked);
      ok(`enemyHit(${armor},${stun},${walk}).hp`, close(old.hp, neu.hp), { old: old.hp, neu: neu.hp });
      ok(`enemyHit(${armor},${stun},${walk}).pos`, samePoint(old.position, neu.position));
      ok(`enemyHit(${armor},${stun},${walk}).hitFlash`, close(old.hitFlash, neu.hitFlash));
      ok(`enemyHit(${armor},${stun},${walk}).knockback`, old.knockbackApplied === neu.knockbackApplied);
    }
  }
}

// --- 7. stepPlayerMovement / axisSlide vs parent Player.applyIntent inline ---
function oldPlayerMove(pos: any, move: any, dash: boolean, speed: number, dt: number, dashTimer: number, dashDuration: number, isWalkable: (x: number, y: number) => boolean) {
  const mag = Math.hypot(move.x, move.y);
  let sp = speed, dtimer = dashTimer;
  if (dtimer > 0) { sp = speed * 2.6; dtimer -= dt; }
  let vx = 0, vy = 0;
  if (mag > 0) {
    const sx = move.x / mag, sy = move.y / mag;
    const tx = sx / (IsoMath.TILE_W / 2), ty = sy / (IsoMath.TILE_H / 2);
    vx = (tx + ty) / 2 * sp; vy = (ty - tx) / 2 * sp;
  }
  let x = pos.x, y = pos.y;
  const nx = x + vx * dt; if (isWalkable(nx, y)) x = nx;
  const ny = y + vy * dt; if (isWalkable(x, ny)) y = ny;
  const dashStarted = dash && dtimer <= 0 && mag > 0;
  if (dashStarted) dtimer = dashDuration;
  return { position: { x, y }, velocity: { x: vx, y: vy }, dashTimer: dtimer, dashStarted };
}
for (const c of [
  { move: { x: 1, y: 0 }, dash: false, dt: 0.016, dashTimer: 0 },
  { move: { x: 1, y: 1 }, dash: true, dt: 0.05, dashTimer: 0 },
  { move: { x: -1, y: 0.3 }, dash: false, dt: 0.2, dashTimer: 0.3 },
  { move: { x: 0, y: 0 }, dash: true, dt: 0.1, dashTimer: 0 }
]) {
  const isW = (x: number, y: number) => !(x > 6 && y > 6);
  const old = oldPlayerMove({ x: 4, y: 4 }, c.move, c.dash, 220, c.dt, c.dashTimer, 0.16, isW);
  const neu = stepPlayerMovement({
    position: { x: 4, y: 4 }, move: c.move, dash: c.dash, speed: 220, dt: c.dt,
    dashTimer: c.dashTimer, dashDuration: 0.16, isWalkable: isW
  });
  ok('playerMove.pos', samePoint(old.position, neu.position), { old: old.position, neu: neu.position });
  ok('playerMove.vel', samePoint(old.velocity, neu.velocity));
  ok('playerMove.dashTimer', close(old.dashTimer, neu.dashTimer));
  ok('playerMove.dashStarted', old.dashStarted === neu.dashStarted);
  ok('playerMove.axisSlide', samePoint(axisSlide({ x: 4, y: 4 }, old.velocity, c.dt, isW), old.position));
}

// --- 8. drone FSM key transitions vs parent Enemy.stateMachine (selected cases) ---
const ds = ENEMY_STATS.drone;
const droneStats = {
  speed: ds.speed / 64, aggroRange: ds.aggroRange / 64, attackRange: ds.attackRange / 64,
  attackCooldown: ds.attackCooldown, damage: ds.damage, ranged: ds.ranged, reachEnemy: ds.reachEnemy
};
const baseDrone: any = {
  dt: 0.1, position: { x: 0, y: 0 }, player: { x: 3, y: 0 }, stats: droneStats,
  state: 'idle', stateTimer: 1, wanderTimer: 1, attackTimer: 0,
  patrolPoints: [{ x: 10, y: 0 }], patrolIndex: 0, targetId: null,
  isWalkable: () => true, pixelToTile: GAME.PIXEL_TO_TILE
};
const idle = stepDroneAi({ ...baseDrone, state: 'idle', stateTimer: -0.1 });
ok('drone.idle->patrol', idle.state === 'patrol');
const detect = stepDroneAi({ ...baseDrone, state: 'detect', stateTimer: 0.2 });
ok('drone.detect.doubleDecrement', close(detect.stateTimer, 0.1), { got: detect.stateTimer });
ok('drone.detect.targetId', detect.targetId === 0);
const attack = stepDroneAi({ ...baseDrone, state: 'attack', attackTimer: 0 });
ok('drone.attack.ranged', attack.attack?.kind === 'ranged');
ok('drone.attack.damage', attack.attack?.damage === ds.damage);
ok('drone.attack.cooldown', close(attack.attackTimer, ds.attackCooldown));
const stun = stepDroneAi({ ...baseDrone, state: 'stun', stateTimer: 0.05 });
ok('drone.stun.doubleDecrement', close(stun.stateTimer, -0.05));
ok('drone.stun->chase', stun.state === 'chase');
const patrolBlocked = stepDroneAi({ ...baseDrone, state: 'patrol', isWalkable: () => false });
ok('drone.patrol.blocked', samePoint(patrolBlocked.position, { x: 0, y: 0 }));

console.log(JSON.stringify({
  checks, failures,
  result: failures === 0 ? 'PARITY_PASS' : 'PARITY_FAIL',
  note: 'compared new sim/rules.ts against exact parent 1aadd2e inline formulas; uses real config/RNG'
}, null, 2));
if (failures > 0) process.exitCode = 1;
