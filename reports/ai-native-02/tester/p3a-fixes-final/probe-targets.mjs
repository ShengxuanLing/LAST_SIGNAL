// P3-a fix: legacy enemy kinds + Boss must legally choose/hurt the ECHO,
// protagonist HP must not move, and after echo death the player is re-selected.
// Fixtures disclosed: owner/dev facades (spawnEnemy/spawnBoss, setPlayerPositionForTest,
// invuln/simFixture HP) to isolate the real attack paths; no synthetic HP damage.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5371/';
const out = { meta: { target: '212cd5634ea4ef1e775294eab3ccfca8ecff3a1f', fixtures: 'owner/dev spawn + invuln + HP setup; real FSM/core attacks' }, checks: [], steps: [] };
const check = (n, ok, d) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };
process.on('exit', () => { try { process.getBuiltinModule('node:fs').writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-fixes-final/targets.json', JSON.stringify(out, null, 2)); } catch {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.scene.isActive('MainMenuScene'));
await page.waitForTimeout(400);
await page.mouse.click(640, 340);
await page.waitForFunction(() => window.__game?.scene.isActive('GameScene'));
await page.waitForTimeout(400);

// real echo through the World path, no assist confirmation
const setup = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  w.enableEcho(); w.stepFrame(1000 / 60 + 1e-6, neutral, neutral);
  w.echoController.revokeAssist();
  return { echo: w.echoActor ? { x: w.echoActor.x, y: w.echoActor.y, hp: w.echoActor.data.hp } : null, assist: w.echoAssistArmed, shots: w.echoShotsFired };
});
check('echo-ready-without-assist', setup.echo !== null && setup.assist === false && setup.shots === 0, setup);
const echoSpawnPoint = setup.echo;

const state = () => page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const e = w.echoActor;
  const ens = w.enemies.filter((x) => x.data.kind !== 'drone').map((x) => ({ kind: x.data.kind, tk: x.data.targetActorKind ?? null, tid: x.data.targetId ?? null }));
  return {
    echoHp: e ? e.data.hp : null, playerHp: w.player.data.hp, shots: w.echoShotsFired,
    assist: w.echoAssistArmed, enemies: ens,
    targetKind: ens.some((x) => x.tk === 'echo') ? 'echo' : (ens[0]?.tk ?? null),
    targetId: ens.some((x) => x.tid === 1 || x.tid === '1') ? 1 : (ens[0]?.tid ?? null),
    bossTargetKind: w.boss?.data?.targetActorKind ?? null
  };
});

const runKind = async (kind) => {
  await page.evaluate(({ kind, spawn }) => {
    const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
    const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
    w.clearEnemiesForTest(); w.resetProjectilesForTest();
    w.echoController.revokeAssist();
    const e = w.simFixture.echo;
    e.data.hp = e.data.maxHp; e.invuln = 0; e.hurtTimer = 0;
    if (spawn) { e.x = spawn.x; e.y = spawn.y; w.echoActor.x = spawn.x; w.echoActor.y = spawn.y; }
    const room = w.currentRoom();
    // keep the echo in the start room; put the protagonist far + invulnerable
    let far = null;
    for (const row of w.map.tiles) for (const tile of row) {
      if (w.isWalkable(tile.x, tile.y, 0.5) && Math.hypot(tile.x - e.x, tile.y - e.y) > 10) { far = { x: tile.x, y: tile.y }; break; }
      if (far) break;
    }
    if (far) w.setPlayerPositionForTest(far.x, far.y);
    w.player.invuln = 1e9; w.simFixture.player.invuln = 1e9;
    w.spawnEnemy(kind, spawn.x + 1, spawn.y, room?.id ?? 0, 1);
    w.stepFrame(1000 / 60 + 1e-6, neutral, neutral);
  }, { kind, spawn: echoSpawnPoint });
  const before = await state();
  let hurt = null; let locked = null;
  for (let i = 0; i < 80; i += 1) {
    await sleep(200);
    const s = await state();
    if (s.echoHp < before.echoHp && hurt === null) hurt = s;
    if (s.targetKind === 'echo' || s.targetId === 1 || s.targetId === '1') locked = s;
    if (hurt && locked) break;
  }
  const after = await state();
  const step = { kind, before: { echoHp: before.echoHp, playerHp: before.playerHp }, hurt, locked, after: { echoHp: after.echoHp, playerHp: after.playerHp, shots: after.shots, assist: after.assist } };
  out.steps.push({ name: `kind-${kind}`, step });
  check(`${kind}-echo-hp-drops`, !!hurt && hurt.echoHp < before.echoHp, step);
  check(`${kind}-targets-echo`, !!locked, { targetKind: locked?.targetKind, targetId: locked?.targetId });
  check(`${kind}-player-hp-independent`, after.playerHp === before.playerHp, { before: before.playerHp, after: after.playerHp });
  check(`${kind}-no-fire-without-confirm`, after.shots === 0 && after.assist === false, { shots: after.shots, assist: after.assist });
};
for (const kind of ['hunter', 'stalker', 'sentinel']) await runKind(kind);

// Boss: real boss in a real boss room, echo in melee range
await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  w.clearEnemiesForTest(); w.resetProjectilesForTest();
  w.echoController.revokeAssist();
  w.player.invuln = 1e9; w.simFixture.player.invuln = 1e9;
  const bossRoom = w.map.rooms.find((r) => r.kind === 'boss');
  w.spawnBoss(bossRoom);
  const b = w.boss; const e = w.simFixture.echo;
  e.data.hp = e.data.maxHp; e.invuln = 0; e.hurtTimer = 0; e.x = b.x + 1.5; e.y = b.y;
  w.enteredRooms.add(bossRoom.id);
  let far = null;
  for (const row of w.map.tiles) for (const tile of row) {
    if (w.isWalkable(tile.x, tile.y, 0.5) && Math.hypot(tile.x - e.x, tile.y - e.y) > 14) { far = { x: tile.x, y: tile.y }; break; }
    if (far) break;
  }
  if (far) w.setPlayerPositionForTest(far.x, far.y);
  w.stepFrame(1000 / 60 + 1e-6, neutral, neutral);
});
const bossBefore = await state();
let bossHurt = null;
for (let i = 0; i < 60; i += 1) { await sleep(200); const s = await state(); if (s.echoHp < 100) { bossHurt = s; break; } }
out.steps.push({ name: 'boss', bossBefore, bossHurt });
check('boss-echo-hp-drops', !!bossHurt, { before: bossBefore.echoHp, hurt: bossHurt?.echoHp });
check('boss-player-hp-independent', bossHurt && bossHurt.playerHp === bossBefore.playerHp, { before: bossBefore.playerHp, after: bossHurt?.playerHp });
check('boss-no-fire-without-confirm', bossHurt && bossHurt.shots === 0 && bossHurt.assist === false, { shots: bossHurt?.shots });

// after echo death, a surviving hunter must re-select and hurt the protagonist
const reselect = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const neutral = { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false };
  w.clearEnemiesForTest(); w.resetProjectilesForTest();
  const e = w.simFixture.echo;
  e.data.hp = e.data.maxHp; e.invuln = 0;
  const room = w.currentRoom();
  w.spawnEnemy('hunter', e.x + 1, e.y, room?.id ?? 0, 1);
  let far = null;
  for (const row of w.map.tiles) for (const tile of row) {
    if (w.isWalkable(tile.x, tile.y, 0.5) && Math.hypot(tile.x - e.x, tile.y - e.y) > 10) { far = { x: tile.x, y: tile.y }; break; }
    if (far) break;
  }
  if (far) w.setPlayerPositionForTest(far.x, far.y);
  w.player.invuln = 1e9; w.simFixture.player.invuln = 1e9;
  w.stepFrame(1000 / 60 + 1e-6, neutral, neutral);
  return { echoHp: e.data.hp };
});
await sleep(1200);
const dead = await page.evaluate(() => {
  const gs = window.__game.scene.getScene('GameScene'); const w = gs.world;
  const en = w.enemies.find((x) => x.data.kind === 'hunter');
  w.simFixture.echo.data.hp = 1;
  if (en) w.setPlayerPositionForTest(en.x + 1, en.y);
  w.player.invuln = 0; w.simFixture.player.invuln = 0;
  return { hunter: !!en, echoHp: w.echoActor?.data.hp };
});
let playerHurt = null;
for (let i = 0; i < 60; i += 1) {
  await sleep(200);
  const s = await state();
  if (s.echoHp <= 0 && s.playerHp < 100) { playerHurt = s; break; }
}
out.steps.push({ name: 'reselect-after-death', reselect, dead, playerHurt });
check('echo-death-reselects-player', !!playerHurt && playerHurt.targetKind === 'player' || (!!playerHurt && playerHurt.targetId === 0), playerHurt);
check('no-page-errors', errs.length === 0, errs);
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/p3a-fixes-final/targets.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({ checks: out.checks.map((c) => [c.n, c.ok]) }, null, 2));
await browser.close();
process.exit(0);
