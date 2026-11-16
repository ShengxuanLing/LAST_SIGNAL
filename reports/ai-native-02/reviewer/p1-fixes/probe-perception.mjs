// Independent reviewer probe for P1 fixes F-01/F-02 (frozen snapshot 1aadd2e).
// Uses only read access + test-only state mutation to construct negative cases.
// Not an external Agent; not a Headless run.
import { chromium } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 5323);
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => !!window.__game, { timeout: 15000 });
await page.waitForTimeout(1300);
await page.evaluate(() => {
  const g = window.__game;
  g.scene.start('GameScene', { seed: 424242 });
});
await page.waitForTimeout(1200);

const result = await page.evaluate(() => {
  const g = window.__game;
  const gs = g.scene.getScene('GameScene');
  const w = gs.world;
  const p = { x: w.player.wx, y: w.player.wy };
  const room = w.currentRoom();
  const other = w.map.rooms.find((r) => r.id !== room.id);
  const flat = w.map.tiles.flat();
  const dist = (t) => Math.hypot(t.x - p.x, t.y - p.y);
  const farFloor = flat.find((t) => dist(t) >= 20 && w.isWalkable(t.x, t.y, 0.5));
  const farWall = flat.find((t) => dist(t) >= 20 && t.type === 'wall');
  const view0 = w.intentView();
  const probe = {
    farFloor: farFloor ? { x: farFloor.x, y: farFloor.y, canWalk: view0.canWalk(farFloor.x + 0.2, farFloor.y + 0.2) } : null,
    farWall: farWall ? { x: farWall.x, y: farWall.y, canWalk: view0.canWalk(farWall.x + 0.2, farWall.y + 0.2) } : null,
    nonFinite: [view0.canWalk(NaN, 0), view0.canWalk(Infinity, 0), view0.canWalk(0, -Infinity)],
    near: null,
  };
  for (let dx = -1; dx <= 1 && !probe.near; dx += 0.5) {
    for (let dy = -1; dy <= 1; dy += 0.5) {
      if (Math.hypot(dx, dy) > 1.2 || (dx === 0 && dy === 0)) continue;
      if (w.isWalkable(p.x + dx, p.y + dy, 0.5)) {
        probe.near = { x: p.x + dx, y: p.y + dy, canWalk: view0.canWalk(p.x + dx, p.y + dy) };
        break;
      }
    }
  }

  // Unentered-room hostile, then same room but far, then near, then wall-blocked.
  const hidden = w.spawnEnemy('drone', other.gx + 2, other.gy + 2, other.id, 1);
  const hiddenUnexplored = w.observationView().perceivedActors.some((a) => a.id === hidden._id);
  w.enteredRooms.add(other.id);
  const hiddenExploredButFar = w.observationView().perceivedActors.some((a) => a.id === hidden._id);

  let candidate = null;
  for (let dx = -4; dx <= 4 && !candidate; dx++) {
    for (let dy = -4; dy <= 4; dy++) {
      const d = Math.hypot(dx, dy);
      if (d < 2 || d > 5) continue;
      const tx = p.x + dx, ty = p.y + dy;
      if (!w.isWalkable(tx, ty, 0.5)) continue;
      if (!w.isPerceivable(tx, ty)) continue;
      const mid = w.tileAt(Math.floor(p.x + dx / 2), Math.floor(p.y + dy / 2));
      if (mid.type === 'wall') continue;
      candidate = { x: tx, y: ty, mid };
      break;
    }
  }
  const near = candidate ? w.spawnEnemy('drone', candidate.x, candidate.y, room.id, 1) : null;
  const nearVisible = near ? w.observationView().perceivedActors.some((a) => a.id === near._id) : null;
  let behindWall = null;
  if (candidate) {
    const prev = candidate.mid.type;
    candidate.mid.type = 'wall';
    behindWall = w.observationView().perceivedActors.some((a) => a.id === near._id);
    candidate.mid.type = prev;
  }

  // Boss / portal use the same bounds.
  w.spawnBoss(w.map.rooms[room.id]);
  const boss = w.boss;
  const nearPoint = candidate ?? { x: p.x + 1, y: p.y };
  boss.wx = nearPoint.x; boss.wy = nearPoint.y;
  const bossNear = !!w.observationView().boss;
  boss.wx = other.gx + 2; boss.wy = other.gy + 2;
  const bossFar = !!w.observationView().boss;
  boss.sprite.destroy(); w.boss = null;
  const portal = w.portal;
  const original = { x: portal.wx, y: portal.wy };
  portal.wx = nearPoint.x; portal.wy = nearPoint.y;
  const portalNear = !!w.observationView().portal;
  portal.wx = other.gx + 2; portal.wy = other.gy + 2;
  const portalFar = !!w.observationView().portal;
  portal.wx = original.x; portal.wy = original.y;
  const finalObs = w.observationView();
  return {
    player: p, roomId: room.id, otherRoomId: other.id,
    visibilityBasis: finalObs.visibilityBasis,
    perception: finalObs.perception,
    probe,
    hiddenUnexplored, hiddenExploredButFar,
    nearVisible, behindWall,
    bossNear, bossFar, portalNear, portalFar,
    hasTargetRoom: JSON.stringify(finalObs).includes('targetRoom'),
    hasPhase: JSON.stringify(finalObs).includes('phase'),
    perceivedIds: finalObs.perceivedActors.map((a) => a.id),
  };
});
console.log(JSON.stringify({ ...result, pageErrors: errors }, null, 2));
await browser.close();
