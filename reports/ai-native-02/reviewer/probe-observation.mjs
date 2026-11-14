// Independent reviewer probe (read-only game state via __game; no production files changed).
// Evidence for: unbounded canWalk oracle / "current room" != visible range.
import { chromium } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 5313);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.evaluate(() => {
  const g = window.__game;
  g.scene.start('GameScene', { seed: 424242 });
});
await page.waitForTimeout(1200);

const result = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const obs = w.observationView();
  const view = w.intentView();
  const current = w.currentRoom()?.id ?? 0;
  const other = w.map.rooms.find((r) => r.id !== current);
  const flat = w.map.tiles.flat();
  const farWall = flat.filter((t) => t.type === 'wall' && t.x > other.gx + 1 && t.x < other.gx + other.w - 1).slice(0, 2);
  const floorTile = flat.find((t) => t.type !== 'wall' && t.x > other.gx + 1 && t.x < other.gx + other.w - 1 && t.y > other.gy + 1 && t.y < other.gy + other.h - 1);
  // Spawn a hostile assigned to the CURRENT room but far outside the viewport.
  const farX = w.player.wx + 60;
  const farY = w.player.wy + 60;
  const farEnemy = w.spawnEnemy('drone', farX, farY, current, 1);
  const obsAfter = w.observationView();
  const probes = [
    { name: 'current-player', x: w.player.wx, y: w.player.wy },
    { name: 'other-room-center', x: other.gx + 2.5, y: other.gy + 2.5 },
    { name: 'out-of-bounds', x: 9999, y: 9999 },
    ...(floorTile ? [{ name: 'other-room-floor', x: floorTile.x + 0.5, y: floorTile.y + 0.5 }] : []),
    ...farWall.map((t, i) => ({ name: `other-room-wall-${i}`, x: t.x + 0.5, y: t.y + 0.5 })),
  ].map((p) => ({ ...p, canWalk: view.canWalk(p.x, p.y) }));
  return {
    protocolVersion: obs.protocolVersion,
    currentRoom: current,
    otherRoom: other.id,
    otherRoomDistance: Math.hypot(other.gx - w.player.wx, other.gy - w.player.wy),
    visibleActorIds: obs.visibleActors.map((a) => a.id),
    farEnemy: { id: farEnemy._id, x: farX, y: farY, spawnRoom: current },
    farEnemyInObservation: obsAfter.visibleActors.some((a) => a.id === farEnemy._id),
    farEnemyInIntentView: w.intentView().enemies.some((a) => a.id === farEnemy._id),
    probes,
    portalHasTargetRoom: JSON.stringify(obs).includes('targetRoom'),
    intentViewKeys: Object.keys(view),
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
