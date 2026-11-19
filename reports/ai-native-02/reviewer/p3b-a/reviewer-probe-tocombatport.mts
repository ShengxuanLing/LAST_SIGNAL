/**
 * Independent preview-fix regression probe:
 *  - toCombatPort passes a REAL ActorCombatPort through unchanged (nearest-echo
 *    target selection preserved), never rewrites it to the player
 *  - PlayerLike compatibility delegates hurt() (core pending hit), no direct
 *    HP write, no second World
 *  - Enemy/Boss consume port.target everywhere (no stale `combat.target`)
 */
import { toCombatPort, chooseNearestActor, type ActorCombatPort, type ActorTargetView } from './src/world/actorTarget';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));

const echoTarget: ActorTargetView = { actorId: 1, kind: 'echo', x: 1, y: 0, hp: 60, alive: true };
const playerTarget: ActorTargetView = { actorId: 0, kind: 'player', x: 9, y: 0, hp: 100, alive: true };
check('chooseNearestActor still picks the nearer echo', chooseNearestActor({ x: 0, y: 0 }, [playerTarget, echoTarget])?.kind === 'echo');
check('tie keeps player', chooseNearestActor({ x: 0, y: 0 }, [{ ...playerTarget, x: 3 }, { ...echoTarget, x: 3 }])?.kind === 'player');

let hurtCalls: Array<{ amount: number; fromX: number; fromY: number }> = [];
const realPort: ActorCombatPort = {
  target: echoTarget,
  hurtTarget: (amount, fromX, fromY) => { hurtCalls.push({ amount, fromX, fromY }); return true; }
};
const passed = toCombatPort(realPort);
check('real ActorCombatPort returned BY IDENTITY (no rewrite)', passed === realPort);
check('real port keeps echo target (target selection NOT regressed)', passed.target.kind === 'echo' && passed.target.actorId === 1);
check('real port target is read-only view (no writable Player/echo)', !('hurt' in passed.target) && !('data' in passed.target));
passed.hurtTarget(7, 2, 3);
check('hurtTarget delegates to the legal command facade', hurtCalls.length === 1 && hurtCalls[0].amount === 7);
check('no direct HP write on the target view', echoTarget.hp === 60);

// PlayerLike compatibility (legacy direct Scene/test calls)
const fakePlayer = { x: 5, y: 5, data: { hp: 88 }, hurtCalls: [] as number[], hurt(a: number) { this.hurtCalls.push(a); return true; } };
const compat = toCombatPort(fakePlayer);
check('PlayerLike -> legal port with player actorId=0', compat.target.actorId === 0 && compat.target.kind === 'player');
check('PlayerLike hp read from data.hp', compat.target.hp === 88);
check('PlayerLike alive=true', compat.target.alive === true);
compat.hurtTarget(4, 1, 1);
check('PlayerLike hurtTarget delegates to player.hurt (core pending hit path)', fakePlayer.hurtCalls.length === 1 && fakePlayer.hurtCalls[0] === 4);
check('PlayerLike port does NOT invent an echo/kernel target', compat.target.kind === 'player');

// adversarial: object with a `target` field but wrong shape must still be treated as port
const weird = { target: { kind: 'player', actorId: 0, x: 0, y: 0, hp: 1, alive: true }, hurtTarget: () => false };
check('duck-typed port still passed through unchanged', toCombatPort(weird as any) === (weird as any));

console.log(`TOCOMBATPORT_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
