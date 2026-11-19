// My own Rendered -> Headless ECHO parity export (frozen b3930c5).
// Rendered World runs the SAME core with a real echo + real drone/hunter; the ordered
// per-tick player intent and the echo intent actually used are exported together with
// the initial SimulationState, canonical state and FULL events.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-final/parity';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5361/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
await page.waitForTimeout(500);
await page.mouse.click(640, 340);
await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
await page.waitForTimeout(600);

const result = await page.evaluate(async () => {
  const mod = await import('/src/world/sim/core.ts');
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  // real echo through the world's own path; one legal tick commits spawn
  w.enableEcho();
  w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral);
  const e = w.echoActor;
  const room = w.currentRoom()?.id ?? 0;
  // real enemies through the World path (fixture disclosed): one drone for echo kill,
  // one hunter adjacent to the echo so it can be independently hurt.
  w.spawnEnemy('drone', e.x + 2.5, e.y, room, 1);
  w.spawnEnemy('drone', e.x + 1.6, e.y, room, 2);
  w.setEchoMode('hold');
  w.confirmEchoAssist(); // human confirm path; echo may fire only after this
  w.resetSimulationAccumulator(); w.stepFrame(1000 / 60 + 1e-6, neutral); // commit spawns
  const initial = JSON.parse(JSON.stringify(w.sim));
  const echoInit = { x: w.echoActor.x, y: w.echoActor.y, hp: w.echoActor.data.hp };
  const events = [];
  const ticks = [];
  const trace = [];
  for (let i = 0; i < 360; i += 1) {
    w.resetSimulationAccumulator();
    const evs = w.stepFrame(1000 / 60 + 1e-6, neutral);
    events.push(...evs);
    const echoIntent = JSON.parse(JSON.stringify(w.echoController.lastIntent));
    ticks.push({ intent: neutral, echoIntent });
    trace.push({ i, tick: w.sim.tick, echo: w.echoActor ? { x: w.echoActor.x, y: w.echoActor.y, hp: w.echoActor.data.hp } : null, nextProjectileId: w.sim.nextProjectileId, targets: w.sim.targets.map((t) => ({ id: t.id, hp: t.hp, x: t.x, y: t.y })), drones: w.sim.drones.map((d) => ({ id: d.id, hp: d.hp, x: d.x, y: d.y })) });
    if (echoInit.hp > 0 && w.echoActor && w.echoActor.data.hp <= 0) {
      // keep going a bit to prove no fire after death
    }
  }
  return {
    initial, ticks,
    canonical: mod.canonicalSimulationState(w.sim),
    events: mod.canonicalSimulationEvents(events),
    eventTypes: [...new Set(events.map((e) => e.type))],
    finalTick: w.sim.tick,
    echoFinal: w.echoActor ? { x: w.echoActor.x, y: w.echoActor.y, hp: w.echoActor.data.hp } : null,
    echoShots: w.echoShotsFired, trace,
    dronesLeft: w.sim.drones.length, targetsLeft: w.sim.targets.length,
    playerHp: w.sim.player.data.hp
  };
});
writeFileSync(OUT + '/initial.json', JSON.stringify(result.initial));
writeFileSync(OUT + '/ticks.json', JSON.stringify(result.ticks));
writeFileSync(OUT + '/rendered.json', JSON.stringify({ canonical: result.canonical, events: result.events, eventTypes: result.eventTypes, finalTick: result.finalTick, echoFinal: result.echoFinal, echoShots: result.echoShots, dronesLeft: result.dronesLeft, targetsLeft: result.targetsLeft, playerHp: result.playerHp, trace: result.trace }));
console.log(JSON.stringify({ eventTypes: result.eventTypes, finalTick: result.finalTick, echoFinal: result.echoFinal, echoShots: result.echoShots, dronesLeft: result.dronesLeft, targetsLeft: result.targetsLeft, playerHp: result.playerHp, ticks: result.ticks.length, errors: errs }, null, 2));
await browser.close();
