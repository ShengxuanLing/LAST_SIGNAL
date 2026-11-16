import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomInt, createHash, randomBytes } from "node:crypto";
class RNG {
  constructor(seed) {
    this.state = this._hashSeed(seed);
  }
  static fromSeed(seed) {
    return new RNG(seed);
  }
  _hashSeed(seed) {
    let z2 = (seed >>> 0) + 114007148193232e5 >>> 0;
    z2 = (z2 ^ z2 >>> 30) * 13787848793156545e3 >>> 0;
    z2 = (z2 ^ z2 >>> 27) * 10723151780598845e3 >>> 0;
    return (z2 ^ z2 >>> 31) >>> 0;
  }
  _next() {
    this.state = this.state + 1831565813 >>> 0;
    let t = this.state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return (t ^ t >>> 14) >>> 0;
  }
  /** Uniform float in [0, 1). */
  float() {
    return this._next() / 4294967296;
  }
  /** Integer in [min, max] inclusive. */
  int(min, max) {
    if (max < min) [min, max] = [max, min];
    const range = max - min + 1;
    return min + Math.floor(this._next() / 4294967296 * range);
  }
  /** Float in [min, max). */
  range(min, max) {
    return min + this.float() * (max - min);
  }
  boolean(prob) {
    return this.float() < prob;
  }
  pick(items) {
    return items[this.int(0, items.length - 1)];
  }
  pickWeighted(items) {
    let total = 0;
    for (const it of items) total += it.weight;
    let r = this.float() * total;
    for (const it of items) {
      r -= it.weight;
      if (r <= 0) return it.item;
    }
    return items[items.length - 1].item;
  }
  shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  /** Reset to a specific seed without constructing a new object. */
  seed(seed) {
    this.state = this._hashSeed(seed);
  }
  snapshot() {
    return this.state;
  }
  restore(state) {
    this.state = state >>> 0;
  }
}
const ROOM = {
  width: 14,
  height: 10,
  wallX: 7,
  // The two door cells are a dynamic passable overlay, not static wall.
  doorCells: [{ x: 7, y: 4 }, { x: 7, y: 5 }],
  spawn: { x: 3.5, y: 5.5 },
  // Door receiver is the Jam target; the seal source is read-only and always present.
  receiver: { x: 7.5, y: 5 },
  source: { x: 7.5, y: 3.5 },
  sourceCell: { x: 7, y: 3 },
  eastThresholdX: 8,
  exit: { x: 12.5, y: 5.5 },
  playerRadius: 0.35
};
const DOOR_RECT = { minX: 7, maxX: 8, minY: 4, maxY: 6 };
function isDoorCell(cx, cy) {
  return ROOM.doorCells.some((c) => c.x === cx && c.y === cy);
}
function isBorderWallCell(cx, cy) {
  return cx <= 0 || cy <= 0 || cx >= ROOM.width - 1 || cy >= ROOM.height - 1;
}
function isStaticWallCell(cx, cy) {
  if (isBorderWallCell(cx, cy)) return true;
  return cx === ROOM.wallX && !isDoorCell(cx, cy);
}
function isWalkableCell(cx, cy, doorPassable) {
  if (cx < 0 || cy < 0 || cx >= ROOM.width || cy >= ROOM.height) return false;
  if (isBorderWallCell(cx, cy)) return false;
  if (cx === ROOM.wallX) return isDoorCell(cx, cy) ? doorPassable : false;
  return true;
}
function distanceToReceiver(x, y) {
  return Math.hypot(x - ROOM.receiver.x, y - ROOM.receiver.y);
}
function distanceToSource(x, y) {
  return Math.hypot(x - ROOM.source.x, y - ROOM.source.y);
}
function isOccupyingDoor(x, y, radius = ROOM.playerRadius) {
  const minX = x - radius;
  const maxX = x + radius;
  const minY = y - radius;
  const maxY = y + radius;
  return maxX >= DOOR_RECT.minX && minX <= DOOR_RECT.maxX && maxY >= DOOR_RECT.minY && minY <= DOOR_RECT.maxY;
}
function canFit(x, y, walkable2) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const r = ROOM.playerRadius;
  return [[x, y], [x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]].every(([sx, sy]) => walkable2(Math.floor(sx), Math.floor(sy)));
}
function hasLineOfSight(ax, ay, bx, by, allow) {
  return gridLineOfSight(ax, ay, bx, by, (x, y) => isStaticWallCell(x, y) && !(allow && allow.x === x && allow.y === y));
}
function gridLineOfSight(ax, ay, bx, by, isBlocked) {
  const startX = Math.floor(ax);
  const startY = Math.floor(ay);
  const endX = Math.floor(bx);
  const endY = Math.floor(by);
  if (startX === endX && startY === endY) return true;
  const blocked = (cx2, cy2) => {
    if (cx2 === endX && cy2 === endY || cx2 === startX && cy2 === startY) return false;
    return isBlocked(cx2, cy2);
  };
  const dx = bx - ax;
  const dy = by - ay;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const tDeltaX = stepX === 0 ? Infinity : 1 / adx;
  const tDeltaY = stepY === 0 ? Infinity : 1 / ady;
  let tMaxX = stepX === 0 ? Infinity : (stepX > 0 ? startX + 1 - ax : ax - startX) / adx;
  let tMaxY = stepY === 0 ? Infinity : (stepY > 0 ? startY + 1 - ay : ay - startY) / ady;
  let cx = startX;
  let cy = startY;
  let guard = 0;
  while ((cx !== endX || cy !== endY) && guard++ < 1e4) {
    if (Math.abs(tMaxX - tMaxY) < 1e-9) {
      const nx = cx + stepX;
      const ny = cy + stepY;
      if (blocked(nx, cy) || blocked(cx, ny)) return false;
      cx = nx;
      cy = ny;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
    if (cx === endX && cy === endY) break;
    if (blocked(cx, cy)) return false;
  }
  return true;
}
const GAME = {
  // Combat speed/range fields in configs are authored in screen-px; divide by this
  // to express them in tile-world units (matches the iso projection and movement).
  PIXEL_TO_TILE: 64
};
const WEAPONS = {
  pulse: {
    baseDamage: 12,
    baseRate: 6,
    baseRange: 520
  }
};
const SLICE = {
  TICK_HZ: 60,
  TICK_MS: 1e3 / 60,
  ENERGY_MAX: 100,
  REGEN_PER_SEC: 5,
  REGEN_TICKS: 12,
  SCAN_COST: 10,
  SCAN_CD_TICKS: 120,
  SCAN_REVEAL_TICKS: 480,
  SCAN_RADIUS: 12,
  JAM_COST: 25,
  JAM_CD_TICKS: 480,
  JAM_DURATION_TICKS: 360,
  JAM_RANGE: 6,
  SAFE_CLEAR_DELAY_TICKS: 60,
  INTERACT_RANGE: 6,
  // VS-00 door interaction
  MAX_FRAME_DELTA_MS: 250,
  MAX_TICKS_PER_FRAME: 15,
  MOVE_SPEED: 3.4375
};
const ENEMY_STATS = {
  drone: {
    maxHp: 24,
    speed: 90,
    damage: 6,
    aggroRange: 340,
    attackRange: 200,
    attackCooldown: 1.4
  }
};
const CORRIDOR = {
  template: "station-zero-r2-v1",
  width: 26,
  height: 14,
  spawn: { x: 2.5, y: 10.5 },
  relay: { x: 8.5, y: 9.5 },
  farControl: { x: 18.5, y: 9.5 },
  bridgePort: { x: 10.5, y: 9.5 },
  guard: { x: 5.5, y: 6.5 },
  shores: { west: { x: 9.5, y: 9.5 }, east: { x: 16.5, y: 9.5 } },
  bridge: { left: 10, right: 16, top: 8, bottom: 11 },
  controlRange: 2.25,
  transitionTicks: 90,
  dangerHp: 20,
  maxHp: 100
};
function corridorTile(x, y) {
  if (x <= 0 || x >= CORRIDOR.width - 1 || y <= 0 || y >= CORRIDOR.height - 1) return "wall";
  return x >= CORRIDOR.bridge.left && x < CORRIDOR.bridge.right ? "chasm" : "floor";
}
function isBridgeCell(x, y) {
  const { left, right, top, bottom } = CORRIDOR.bridge;
  return x >= left && x < right && y >= top && y < bottom;
}
function walkable(x, y, bridgePassable) {
  return corridorTile(x, y) === "floor" || bridgePassable && isBridgeCell(x, y);
}
function canStandInCorridor(x, y, bridgePassable) {
  return canFit(x, y, (cx, cy) => walkable(cx, cy, bridgePassable));
}
function corridorLineOfSight(from, to, bridgePassable) {
  return gridLineOfSight(from.x, from.y, to.x, to.y, (x, y) => !walkable(x, y, bridgePassable));
}
function occupiesBridge({ x, y }) {
  const { left, right, top, bottom } = CORRIDOR.bridge;
  const r = ROOM.playerRadius;
  return x + r >= left && x - r <= right && y + r >= top && y - r <= bottom;
}
function shoreOf({ x }) {
  return x < CORRIDOR.bridge.left ? "west" : "east";
}
function nearControl(position, bridgePassable) {
  return [CORRIDOR.relay, CORRIDOR.farControl].some((control) => Math.hypot(position.x - control.x, position.y - control.y) < CORRIDOR.controlRange && corridorLineOfSight(position, control, bridgePassable));
}
function reachable(start, goal, bridgePassable) {
  const queue = [start];
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i];
    if (x === goal.x && y === goal.y) return true;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !canStandInCorridor(nx, ny, bridgePassable)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return false;
}
function validateCorridorTemplate() {
  const { spawn, relay, farControl, guard, shores } = CORRIDOR;
  return [spawn, relay, farControl, guard, shores.west, shores.east].every(({ x, y }) => canStandInCorridor(x, y, false)) && reachable(spawn, shores.west, false) && reachable(shores.west, relay, false) && reachable(shores.east, farControl, false) && !reachable(shores.west, shores.east, false) && reachable(shores.west, shores.east, true);
}
const DRONE = ENEMY_STATS.drone;
const VISION_RANGE = DRONE.aggroRange / GAME.PIXEL_TO_TILE;
const ATTACK_RANGE = DRONE.attackRange / GAME.PIXEL_TO_TILE;
const ATTACK_WINDUP = Math.ceil(DRONE.attackCooldown * SLICE.TICK_HZ);
const MOVE_STEP = DRONE.speed / GAME.PIXEL_TO_TILE / SLICE.TICK_HZ;
const EVIDENCE_TTL = 8 * SLICE.TICK_HZ;
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
class CorridorGuard {
  constructor(cleared) {
    this.location = { ...CORRIDOR.guard };
    this.evidence = null;
    this.jamUntil = 0;
    this.attackAt = 0;
    this.watching = false;
    this.health = cleared ? 0 : DRONE.maxHp;
  }
  get hp() {
    return this.health;
  }
  get position() {
    return { ...this.location };
  }
  takeHit(damage) {
    this.health = Math.max(0, this.health - damage);
    if (this.health > 0) return;
    this.evidence = null;
    this.jamUntil = this.attackAt = 0;
    this.watching = false;
  }
  jam(tick) {
    this.jamUntil = tick + SLICE.JAM_DURATION_TICKS;
    this.attackAt = 0;
    this.watching = false;
  }
  isJammed(tick) {
    return tick < this.jamUntil;
  }
  /** Returns damage only if the guard still has a legal shot when the windup ends. */
  advance(tick, player, shared, bridgePassable) {
    if (this.health === 0) return 0;
    if (this.evidence && tick >= this.evidence.expiresAtTick) this.evidence = null;
    const receive = !this.isJammed(tick);
    this.watching = receive && distance(this.location, player) <= VISION_RANGE && corridorLineOfSight(this.location, player, bridgePassable);
    const sharedObservation = receive && shared && distance(CORRIDOR.relay, player) <= VISION_RANGE && corridorLineOfSight(CORRIDOR.relay, player, bridgePassable);
    if (this.watching || sharedObservation) {
      this.evidence = { ...player, observedAtTick: tick, expiresAtTick: tick + EVIDENCE_TTL };
    }
    if (!this.watching) this.moveToward(this.evidence ?? CORRIDOR.guard);
    if (!this.watching || distance(this.location, player) >= ATTACK_RANGE) {
      this.attackAt = 0;
      return 0;
    }
    if (this.attackAt === 0) this.attackAt = tick + ATTACK_WINDUP;
    if (tick < this.attackAt) return 0;
    this.attackAt = tick + ATTACK_WINDUP;
    return DRONE.damage;
  }
  /** Full private decision state for P1 internal snapshot (not the browser checkpoint). */
  captureFull() {
    return {
      location: { ...this.location },
      evidence: this.evidence ? { x: this.evidence.x, y: this.evidence.y, observedAtTick: this.evidence.observedAtTick, expiresAtTick: this.evidence.expiresAtTick } : null,
      jamUntil: this.jamUntil,
      attackAt: this.attackAt,
      watching: this.watching,
      health: this.health
    };
  }
  /** Restore private decision state verbatim; never re-runs perception or scan. */
  restoreFull(state) {
    this.location = { x: state.location.x, y: state.location.y };
    const e = state.evidence;
    this.evidence = e ? { x: e.x, y: e.y, observedAtTick: e.observedAtTick, expiresAtTick: e.expiresAtTick } : null;
    this.jamUntil = state.jamUntil;
    this.attackAt = state.attackAt;
    this.watching = state.watching;
    this.health = state.health;
  }
  snapshot(tick, shared) {
    const live = this.health > 0;
    const sharedConnected = live && shared;
    const jammed = live && this.isJammed(tick);
    return {
      position: this.position,
      link: !live ? "DEAD" : jammed ? "JAMMED" : sharedConnected ? "LINKED" : "DISCONNECTED",
      sharedConnected,
      jamRemainingTicks: jammed ? this.jamUntil - tick : 0,
      behavior: this.watching ? "WATCHING" : this.evidence ? "INVESTIGATING" : "IDLE",
      evidence: this.evidence && { ...this.evidence }
    };
  }
  moveToward(target) {
    const remaining = distance(this.location, target);
    if (remaining === 0) return;
    const fraction = Math.min(1, MOVE_STEP / remaining);
    const x = this.location.x + (target.x - this.location.x) * fraction;
    const y = this.location.y + (target.y - this.location.y) * fraction;
    if (shoreOf({ x }) === "west" && canStandInCorridor(x, y, false)) this.location = { x, y };
  }
}
const PULSE = WEAPONS.pulse;
const TEMPLATE_VALID = validateCorridorTemplate();
function relayState(manualEnabled, powered, jammed, disposed) {
  if (disposed) return "DISABLED";
  if (jammed) return "JAMMED";
  return manualEnabled && powered ? "ACTIVE" : "INACTIVE";
}
function nextBridge(previous, output, tick) {
  switch (previous.bridge) {
    case "UNAVAILABLE":
      return output ? { bridge: "TRANSITIONING", deadline: tick + CORRIDOR.transitionTicks } : { bridge: "UNAVAILABLE", deadline: 0 };
    case "TRANSITIONING":
      if (!output) return { bridge: "UNAVAILABLE", deadline: 0 };
      if (tick >= previous.deadline) return { bridge: "STABLE", deadline: 0 };
      break;
    case "STABLE":
      return output ? { bridge: "STABLE", deadline: 0 } : { bridge: "UNSTABLE", deadline: tick + CORRIDOR.transitionTicks };
    case "UNSTABLE":
      if (output) return { bridge: "STABLE", deadline: 0 };
      if (tick >= previous.deadline) return { bridge: "UNAVAILABLE", deadline: 0 };
      break;
    case "DISABLED":
      return { bridge: "DISABLED", deadline: 0 };
  }
  return { bridge: previous.bridge, deadline: previous.deadline };
}
function reading(manualEnabled, powered, relay, bridge, deadline) {
  const effectiveOutput = relay === "ACTIVE";
  return Object.freeze({
    manualEnabled,
    powered,
    relay,
    effectiveOutput,
    bridgeFeed: effectiveOutput,
    perceptionFeed: effectiveOutput,
    bridge,
    bridgePassable: bridge === "STABLE" || bridge === "UNSTABLE",
    deadline
  });
}
class Corridor {
  constructor(checkpoint) {
    this.listeners = /* @__PURE__ */ new Set();
    this.disposed = false;
    this.publishing = false;
    this.crossedAtTick = null;
    this.nextShotTick = 0;
    if (!TEMPLATE_VALID) throw new Error("E_NO_FAR_SHORE");
    this.location = { ...checkpoint?.position ?? CORRIDOR.spawn };
    this.lastShore = shoreOf(this.location);
    this.health = checkpoint?.hp ?? CORRIDOR.maxHp;
    this.guard = new CorridorGuard(checkpoint?.guardCleared ?? false);
    this.crossedFlag = checkpoint?.crossed ?? false;
    const enabled = checkpoint?.relayEnabled ?? false;
    const powered = checkpoint?.powered ?? true;
    this.signal = reading(
      enabled,
      powered,
      relayState(enabled, powered, (checkpoint?.jamRemaining ?? 0) > 0, false),
      checkpoint?.bridge ?? "UNAVAILABLE",
      0
    );
  }
  get position() {
    return { ...this.location };
  }
  get alive() {
    return this.health > 0;
  }
  get crossed() {
    return this.crossedFlag;
  }
  get canSave() {
    return this.alive && this.guard.hp === 0 && !occupiesBridge(this.location) && (this.signal.bridge === "STABLE" || this.signal.bridge === "UNAVAILABLE");
  }
  canStand(x, y) {
    return canStandInCorridor(x, y, this.signal.bridgePassable);
  }
  moveTo(x, y) {
    if (this.disposed || this.publishing || !this.alive || !this.canStand(x, y)) return;
    this.location = { x, y };
    if (!occupiesBridge(this.location)) this.lastShore = shoreOf(this.location);
  }
  canInteract() {
    return !this.disposed && this.alive && nearControl(this.location, this.signal.bridgePassable);
  }
  canJam() {
    return !this.disposed && this.alive && this.inRange(CORRIDOR.relay, SLICE.JAM_RANGE);
  }
  canJamGuard() {
    return !this.disposed && !this.publishing && this.alive && this.guard.hp > 0 && this.inRange(this.guard.position, SLICE.JAM_RANGE);
  }
  isGuardJammed(tick) {
    return this.guard.isJammed(tick);
  }
  jamGuard(tick) {
    if (this.canJamGuard() && !this.isGuardJammed(tick)) this.guard.jam(tick);
  }
  scan() {
    const relay = this.inRange(CORRIDOR.relay, SLICE.SCAN_RADIUS);
    return {
      relay,
      bridge: this.inRange(CORRIDOR.bridgePort, SLICE.SCAN_RADIUS),
      perceptionPort: this.inRange(this.guard.position, SLICE.SCAN_RADIUS)
    };
  }
  /** Pure availability probe (no mutation), used by action descriptions. */
  canShoot(tick) {
    if (this.disposed || this.publishing || !this.alive || this.guard.hp === 0 || !this.inRange(this.guard.position, PULSE.baseRange / GAME.PIXEL_TO_TILE)) return "unavailable";
    if (tick < this.nextShotTick) return "cooldown";
    return "ok";
  }
  shoot(tick) {
    const availability = this.canShoot(tick);
    if (availability !== "ok") return availability;
    this.nextShotTick = tick + Math.ceil(SLICE.TICK_HZ / PULSE.baseRate);
    this.guard.takeHit(PULSE.baseDamage);
    return this.guard.hp === 0 ? "cleared" : "hit";
  }
  setEnabled(enabled, tick, jammed) {
    this.resolve(tick, jammed, enabled, this.signal.powered);
  }
  toggle(tick, jammed) {
    this.setEnabled(!this.signal.manualEnabled, tick, jammed);
  }
  setPowered(powered, tick, jammed) {
    this.resolve(tick, jammed, this.signal.manualEnabled, powered);
  }
  setJammed(tick, jammed) {
    this.resolve(tick, jammed, this.signal.manualEnabled, this.signal.powered);
  }
  advance(tick, jammed) {
    if (this.disposed || this.publishing || !this.alive) return null;
    const rescued = this.resolve(tick, jammed, this.signal.manualEnabled, this.signal.powered);
    if (!this.alive) return rescued;
    const { perceptionFeed, bridgePassable } = this.signal;
    const damage = this.guard.advance(tick, this.location, perceptionFeed, bridgePassable);
    this.health = Math.max(0, this.health - damage);
    const exit = CORRIDOR.shores.east;
    if (!this.crossed && this.alive && this.signal.bridge === "STABLE" && this.location.x >= exit.x && Math.hypot(this.location.x - exit.x, this.location.y - exit.y) < 0.45) {
      this.crossedFlag = true;
      this.crossedAtTick = tick;
    }
    return rescued;
  }
  subscribe(listener) {
    if (!this.disposed) this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  dispose() {
    if (this.publishing) return;
    this.disposed = true;
    this.listeners.clear();
    this.signal = reading(this.signal.manualEnabled, this.signal.powered, "DISABLED", "DISABLED", 0);
  }
  snapshot(tick) {
    return {
      ...this.signal,
      position: this.position,
      hp: this.health,
      guardHp: this.guard.hp,
      guard: this.guard.snapshot(tick, this.signal.perceptionFeed),
      crossed: this.crossed,
      crossedAtTick: this.crossedAtTick,
      canInteract: this.canInteract(),
      lastShore: this.lastShore,
      bridgeRemainingTicks: Math.max(0, this.signal.deadline - tick),
      onBridge: occupiesBridge(this.location)
    };
  }
  /** Full private corridor state for P1 internal snapshot (not the browser checkpoint). */
  captureFull() {
    return {
      manualEnabled: this.signal.manualEnabled,
      powered: this.signal.powered,
      relay: this.signal.relay,
      bridge: this.signal.bridge,
      deadline: this.signal.deadline,
      disposed: this.disposed,
      location: { ...this.location },
      lastShore: this.lastShore,
      health: this.health,
      guard: this.guard.captureFull(),
      crossed: this.crossedFlag,
      crossedAtTick: this.crossedAtTick,
      nextShotTick: this.nextShotTick
    };
  }
  /** Restore verbatim; never re-resolves bridge/relay or re-runs guard perception. */
  restoreFull(state) {
    this.disposed = state.disposed;
    this.publishing = false;
    this.signal = reading(state.manualEnabled, state.powered, state.relay, state.bridge, state.deadline);
    this.location = { x: state.location.x, y: state.location.y };
    this.lastShore = state.lastShore;
    this.health = state.health;
    this.guard.restoreFull(state.guard);
    this.crossedFlag = state.crossed;
    this.crossedAtTick = state.crossedAtTick;
    this.nextShotTick = state.nextShotTick;
    this.listeners.clear();
  }
  capture(jamRemaining, scanRemaining, reveal, evidence = []) {
    const { manualEnabled, powered, bridge } = this.signal;
    if (!this.canSave || bridge !== "UNAVAILABLE" && bridge !== "STABLE") return null;
    return {
      template: CORRIDOR.template,
      position: this.position,
      hp: this.health,
      relayEnabled: manualEnabled,
      powered,
      bridge,
      crossed: this.crossed,
      guardCleared: true,
      jamRemaining,
      scanRemaining,
      reveal: scanRemaining > 0 && reveal ? { ...reveal } : null,
      ...scanRemaining > 0 && evidence.length > 0 ? { evidence: evidence.map((e) => ({ ...e, position: { ...e.position } })) } : {}
    };
  }
  inRange(target, radius) {
    return Math.hypot(this.location.x - target.x, this.location.y - target.y) < radius && corridorLineOfSight(this.location, target, this.signal.bridgePassable);
  }
  resolve(tick, jammed, enabled, powered) {
    if (this.disposed || this.publishing || !this.alive) return null;
    const previous = this.signal;
    const relay = relayState(enabled, powered, jammed, this.disposed);
    const { bridge, deadline } = nextBridge(previous, relay === "ACTIVE", tick);
    if (previous.relay === relay && previous.bridge === bridge && previous.deadline === deadline && previous.manualEnabled === enabled && previous.powered === powered) return null;
    let rescued = null;
    if (previous.bridge === "UNSTABLE" && bridge === "UNAVAILABLE" && occupiesBridge(this.location)) {
      rescued = this.lastShore;
      this.location = { ...CORRIDOR.shores[rescued] };
      this.health = Math.max(0, this.health - CORRIDOR.dangerHp);
    }
    const committed = reading(enabled, powered, relay, bridge, deadline);
    this.signal = committed;
    this.publishing = true;
    try {
      for (const listener of [...this.listeners]) {
        try {
          listener(committed);
        } catch (error) {
          console.error("Corridor signal subscriber failed", error);
        }
      }
    } finally {
      this.publishing = false;
    }
    return rescued;
  }
}
const EVIDENCE_TARGET_RULES = Object.freeze({
  tgt_lab_door_receiver: Object.freeze({
    roomId: "station-zero-r1",
    stateLabels: Object.freeze(["receiver-visible"]),
    relationIds: Object.freeze([null, "rel_lab_seal_link"])
  }),
  tgt_lab_seal_source: Object.freeze({
    roomId: "station-zero-r1",
    stateLabels: Object.freeze(["carrier-visible"]),
    relationIds: Object.freeze([null, "rel_lab_seal_link"])
  }),
  tgt_corridor_relay: Object.freeze({
    roomId: "station-zero-r2",
    stateLabels: Object.freeze(["relay-visible"]),
    relationIds: Object.freeze([null])
  }),
  tgt_corridor_bridge: Object.freeze({
    roomId: "station-zero-r2",
    stateLabels: Object.freeze(["bridge-visible"]),
    relationIds: Object.freeze([null, "rel_corridor_relay_bridge"])
  }),
  tgt_corridor_guard: Object.freeze({
    roomId: "station-zero-r2",
    stateLabels: Object.freeze(["perception-visible"]),
    relationIds: Object.freeze([null, "rel_corridor_relay_perception"])
  })
});
const RELAY_STATES = ["ACTIVE", "INACTIVE", "JAMMED", "DISABLED"];
const BRIDGE_STATES = ["UNAVAILABLE", "TRANSITIONING", "STABLE", "UNSTABLE", "DISABLED"];
const DOOR_STATES = ["SEALED", "JAMMED_OPEN", "OPEN", "CLOSED", "SAFE_PENDING_CLOSE"];
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const exactKeys = (v, keys) => {
  const own = Object.keys(v);
  return own.length === keys.length && own.every((k) => keys.includes(k));
};
const keysIn = (v, required, optional = []) => {
  const allowed = /* @__PURE__ */ new Set([...required, ...optional]);
  const own = Object.keys(v);
  return required.every((k) => Object.prototype.hasOwnProperty.call(v, k)) && own.every((k) => allowed.has(k));
};
function isPositionEvidenceState(v) {
  return obj(v) && exactKeys(v, ["x", "y", "observedAtTick", "expiresAtTick"]) && finite(v.x) && finite(v.y) && finite(v.observedAtTick) && finite(v.expiresAtTick);
}
function isSliceEvidenceArray(v) {
  if (!Array.isArray(v)) return false;
  for (const item of v) {
    if (!obj(item) || !keysIn(item, [
      "targetId",
      "relationId",
      "position",
      "observedAtTick",
      "expiresAtTick",
      "stateLabel",
      "roomId"
    ], ["sourceActionId", "observerActorId", "sceneEpoch"])) return false;
    if (typeof item.targetId !== "string" || !item.targetId.startsWith("tgt_")) return false;
    const rule = EVIDENCE_TARGET_RULES[item.targetId];
    if (!rule) return false;
    if (item.relationId !== null && (typeof item.relationId !== "string" || !item.relationId.startsWith("rel_"))) return false;
    if (!obj(item.position) || !finite(item.position.x) || !finite(item.position.y) || !exactKeys(item.position, ["x", "y"])) return false;
    if (!finite(item.observedAtTick) || !finite(item.expiresAtTick) || item.observedAtTick < 0 || item.expiresAtTick <= item.observedAtTick) return false;
    if (typeof item.stateLabel !== "string" || !rule.stateLabels.includes(item.stateLabel)) return false;
    if (item.roomId !== "station-zero-r1" && item.roomId !== "station-zero-r2") return false;
    if (item.roomId !== rule.roomId) return false;
    if (!rule.relationIds.includes(item.relationId)) return false;
    if (item.sourceActionId !== void 0 && (typeof item.sourceActionId !== "string" || !/^aid_[0-9a-f]{24}$/.test(item.sourceActionId))) return false;
    if (item.observerActorId !== void 0 && (typeof item.observerActorId !== "string" || !/^act_[0-9a-f]{16}$/.test(item.observerActorId))) return false;
    if (item.sceneEpoch !== void 0 && (!finite(item.sceneEpoch) || !Number.isInteger(item.sceneEpoch) || item.sceneEpoch < 0)) return false;
    if (Object.values(item).some((x) => x === void 0)) return false;
  }
  return true;
}
function isFullSliceState(v) {
  if (!obj(v) || !exactKeys(v, [
    "energy",
    "tick",
    "door",
    "manualOpenIntent",
    "sealSourcePresent",
    "jamRemainingTicks",
    "jamCooldownTicks",
    "scanCooldownTicks",
    "scanRevealTicks",
    "revealDoorReceiver",
    "revealSealSource",
    "pendingSafeClose",
    "safeClearTicks",
    "regenAcc",
    "accumulatorMs",
    "playerX",
    "playerY",
    "occupancy",
    "passed",
    "paused",
    "lastRelayInteractTick",
    "lastResult",
    "corridorReveal",
    "corridor",
    "evidence",
    "evidenceRescanRequired"
  ])) return false;
  const numbers = [
    "energy",
    "tick",
    "jamRemainingTicks",
    "jamCooldownTicks",
    "scanCooldownTicks",
    "scanRevealTicks",
    "safeClearTicks",
    "regenAcc",
    "accumulatorMs",
    "playerX",
    "playerY",
    "lastRelayInteractTick"
  ];
  if (numbers.some((k) => !finite(v[k]))) return false;
  const booleans = [
    "manualOpenIntent",
    "sealSourcePresent",
    "revealDoorReceiver",
    "revealSealSource",
    "pendingSafeClose",
    "occupancy",
    "passed",
    "paused",
    "evidenceRescanRequired"
  ];
  if (booleans.some((k) => typeof v[k] !== "boolean")) return false;
  if (typeof v.door !== "string" || !DOOR_STATES.includes(v.door)) return false;
  const lr = v.lastResult;
  if (!obj(lr) || typeof lr.code !== "string" || typeof lr.message !== "string" || !finite(lr.cost) || !exactKeys(lr, ["code", "message", "cost"])) return false;
  const cr = v.corridorReveal;
  if (cr !== null) {
    if (!obj(cr) || !exactKeys(cr, ["relay", "bridge", "perceptionPort"])) return false;
    if (["relay", "bridge", "perceptionPort"].some((k) => typeof cr[k] !== "boolean")) return false;
  }
  if (!isSliceEvidenceArray(v.evidence)) return false;
  if (!isFullCorridorState(v.corridor)) return false;
  return true;
}
function isFullCorridorState(v) {
  if (v === null) return true;
  if (!obj(v) || !exactKeys(v, [
    "manualEnabled",
    "powered",
    "relay",
    "bridge",
    "deadline",
    "disposed",
    "location",
    "lastShore",
    "health",
    "guard",
    "crossed",
    "crossedAtTick",
    "nextShotTick"
  ])) return false;
  if (typeof v.manualEnabled !== "boolean" || typeof v.powered !== "boolean" || typeof v.disposed !== "boolean" || typeof v.crossed !== "boolean") return false;
  if (typeof v.relay !== "string" || !RELAY_STATES.includes(v.relay)) return false;
  if (typeof v.bridge !== "string" || !BRIDGE_STATES.includes(v.bridge)) return false;
  if (!finite(v.deadline) || !finite(v.health) || !finite(v.nextShotTick)) return false;
  if (v.lastShore !== "west" && v.lastShore !== "east") return false;
  if (v.crossedAtTick !== null && !finite(v.crossedAtTick)) return false;
  if (!obj(v.location) || !exactKeys(v.location, ["x", "y"]) || !finite(v.location.x) || !finite(v.location.y)) return false;
  return isGuardFullState(v.guard);
}
function isGuardFullState(v) {
  if (!obj(v) || !exactKeys(v, ["location", "evidence", "jamUntil", "attackAt", "watching", "health"])) return false;
  if (!finite(v.jamUntil) || !finite(v.attackAt) || !finite(v.health) || typeof v.watching !== "boolean") return false;
  if (!obj(v.location) || !exactKeys(v.location, ["x", "y"]) || !finite(v.location.x) || !finite(v.location.y)) return false;
  if (v.evidence !== null && !isPositionEvidenceState(v.evidence)) return false;
  return true;
}
const START_HINT = "WASD 移动 · Z 扫描 · X 压制 · F 开门尝试 · Esc 暂停";
function evidenceProvenance(p) {
  if (!p) return {};
  return {
    ...p.sourceActionId !== void 0 ? { sourceActionId: p.sourceActionId } : {},
    ...p.observerActorId !== void 0 ? { observerActorId: p.observerActorId } : {},
    ...p.sceneEpoch !== void 0 ? { sceneEpoch: p.sceneEpoch } : {}
  };
}
class SliceModel {
  constructor(persisted) {
    this.energyValue = SLICE.ENERGY_MAX;
    this.tickIndex = 0;
    this.door = "SEALED";
    this.manualOpenIntent = false;
    this.sealSourcePresent = true;
    this.jamRemainingTicks = 0;
    this.jamCooldownTicks = 0;
    this.scanCooldownTicks = 0;
    this.scanRevealTicks = 0;
    this.revealDoorReceiver = false;
    this.revealSealSource = false;
    this.pendingSafeClose = false;
    this.safeClearTicks = SLICE.SAFE_CLEAR_DELAY_TICKS;
    this.regenAcc = 0;
    this.accumulatorMs = 0;
    this.playerX = ROOM.spawn.x;
    this.playerY = ROOM.spawn.y;
    this.occupancy = false;
    this.passedFlag = false;
    this.pausedFlag = false;
    this.corridor = null;
    this.corridorReveal = null;
    this.lastRelayInteractTick = -1;
    this.evidence = [];
    this.evidenceRescanRequired = false;
    this.lastResult = { code: "OK", message: START_HINT, cost: 0 };
    if (persisted) this.restore(persisted);
  }
  get energy() {
    return this.energyValue;
  }
  get doorState() {
    return this.door;
  }
  get passed() {
    return this.passedFlag;
  }
  get paused() {
    return this.pausedFlag;
  }
  get tick() {
    return this.tickIndex;
  }
  /** Read-only authoritative position; the Scene must draw from this after restore. */
  get position() {
    return this.corridor?.position ?? { x: this.playerX, y: this.playerY };
  }
  get inCorridor() {
    return this.corridor !== null;
  }
  get failed() {
    return this.corridor !== null && !this.corridor.alive;
  }
  get canCheckpoint() {
    return !this.corridor || this.corridor.canSave;
  }
  get jamActive() {
    return this.jamRemainingTicks > 0;
  }
  get doorPassable() {
    return this.door === "JAMMED_OPEN" || this.door === "OPEN" || this.door === "SAFE_PENDING_CLOSE";
  }
  /** True when an old save without evidence was restored; hint the user to rescan. */
  get evidenceRescanRequiredFlag() {
    return this.evidenceRescanRequired;
  }
  get evidenceSnapshot() {
    return this.evidence.map((e) => ({ ...e, position: { ...e.position } }));
  }
  /**
   * Update the authoritative player position. Occupancy is derived from the same
   * AABB footprint the Scene uses for movement collision.
   */
  setPlayerPos(x, y) {
    if (this.corridor) {
      this.corridor.moveTo(x, y);
      return;
    }
    this.playerX = x;
    this.playerY = y;
    this.occupancy = isOccupyingDoor(x, y);
  }
  /** Shared collision query for any actor position (human or ECHO). */
  canStandAt(x, y) {
    return this.corridor?.canStand(x, y) ?? canFit(x, y, (cx, cy) => isWalkableCell(cx, cy, this.doorPassable));
  }
  canStand(x, y) {
    return this.canStandAt(x, y);
  }
  enterCorridor() {
    if (this.corridor || this.paused || !this.passed || Math.hypot(this.playerX - ROOM.exit.x, this.playerY - ROOM.exit.y) >= 0.45) return false;
    this.corridor = new Corridor();
    this.jamRemainingTicks = 0;
    this.scanRevealTicks = 0;
    this.revealDoorReceiver = this.revealSealSource = false;
    this.evidence = [];
    this.evidenceRescanRequired = false;
    this.solveDoor();
    this.ok("失稳走廊：可清除守卫，或按 G 压制守卫后用 F 建桥。", 0);
    return true;
  }
  /** Domain hook for connection-change tests. The UI never exposes free source toggling. */
  setSealSourcePresent(present) {
    this.sealSourcePresent = present;
    this.solveDoor();
  }
  setPaused(paused) {
    this.pausedFlag = paused;
    this.accumulatorMs = 0;
  }
  /**
   * Fixed 60 Hz accumulator. The lab retains its door occupancy order.
   * In the corridor, deadlines resolve against the previous position before movement.
   */
  step(deltaMs, onTick, onCommit) {
    if (this.pausedFlag || this.failed) {
      this.accumulatorMs = 0;
      return 0;
    }
    const clamped = Math.min(Math.max(deltaMs, 0), SLICE.MAX_FRAME_DELTA_MS);
    this.accumulatorMs += clamped;
    let advanced = 0;
    while (this.accumulatorMs >= SLICE.TICK_MS && advanced < SLICE.MAX_TICKS_PER_FRAME && !this.failed) {
      const before = this.snapshot();
      this.tickOnce(onTick);
      onCommit?.(before);
      this.accumulatorMs -= SLICE.TICK_MS;
      advanced++;
    }
    if (advanced === SLICE.MAX_TICKS_PER_FRAME) {
      this.accumulatorMs = this.accumulatorMs % SLICE.TICK_MS;
    }
    return advanced;
  }
  /**
   * Fixed-tick stepping for the headless core: advances exactly `ticks` logic
   * ticks (no wall clock, no frame accumulator). Same tickOnce ordering as the
   * browser path, so lab (move then expiry) and corridor (expiry then move)
   * semantics cannot diverge.
   */
  advanceTicks(ticks, onTick, onCommit) {
    if (this.pausedFlag || this.failed) {
      this.accumulatorMs = 0;
      return 0;
    }
    let advanced = 0;
    while (advanced < ticks && !this.failed) {
      const before = this.snapshot();
      this.tickOnce(onTick);
      onCommit?.(before);
      advanced++;
    }
    return advanced;
  }
  /** Shared scan cost/cooldown gate (human and ECHO use the same resource rules). */
  scanCost() {
    if (this.pausedFlag) return this.fail("E_PAUSED", "已暂停，操作不可用。");
    if (this.failed) return this.fail("E_PERMISSION", "本局已失败，请重开。");
    if (this.scanCooldownTicks > 0) {
      return this.fail("E_COOLDOWN", `扫描冷却中，还需 ${Math.ceil(this.scanCooldownTicks / SLICE.TICK_HZ)} 秒。`);
    }
    if (this.energyValue < SLICE.SCAN_COST) return this.insufficient(SLICE.SCAN_COST);
    this.energyValue -= SLICE.SCAN_COST;
    this.scanCooldownTicks = SLICE.SCAN_CD_TICKS;
    this.scanRevealTicks = SLICE.SCAN_REVEAL_TICKS;
    return null;
  }
  scan(provenance) {
    const blocked = this.scanCost();
    if (blocked) return blocked;
    if (this.corridor) {
      this.corridorReveal = this.corridor.scan();
      const found = Object.values(this.corridorReveal).some(Boolean);
      this.evidence = this.buildCorridorEvidence(provenance);
      return this.ok(found ? "扫描完成：发现当前可见的设备和连接。" : "扫描完成：范围内未发现可操作目标。", SLICE.SCAN_COST);
    }
    const r = this.labScanFrom(this.playerX, this.playerY, provenance);
    this.revealDoorReceiver = r.revealDoorReceiver;
    this.revealSealSource = r.revealSealSource;
    this.evidence = r.evidence;
    return this.ok(
      r.found ? "扫描完成：已发现范围内的门接收器/封锁载波（只揭示，不开门）。" : "扫描完成：范围内未发现可操作目标（空扫仍消耗 10）。",
      SLICE.SCAN_COST
    );
  }
  /**
   * Shared scan capability entry at an EXPLICIT actor position. ECHO uses this
   * with its own position; it consumes the SAME energy/cooldown and uses the
   * lab range/LOS formulas. The returned evidence is actor-local and is NOT
   * written into the human's evidence fields.
   */
  scanFrom(x, y, provenance, range = SLICE.SCAN_RADIUS) {
    const blocked = this.scanCost();
    if (blocked) return { result: blocked, revealDoorReceiver: false, revealSealSource: false, evidence: [] };
    if (this.corridor) {
      return { result: this.fail("E_PERMISSION", "该隔离协作场景仅支持实验室内的 ECHO 扫描。"), revealDoorReceiver: false, revealSealSource: false, evidence: [] };
    }
    const r = this.labScanFrom(x, y, provenance, range);
    return {
      result: this.ok(r.found ? "扫描完成：已发现范围内的设备。" : "扫描完成：范围内未发现可操作目标。", SLICE.SCAN_COST),
      revealDoorReceiver: r.revealDoorReceiver,
      revealSealSource: r.revealSealSource,
      evidence: r.evidence
    };
  }
  labScanFrom(x, y, provenance, range = SLICE.SCAN_RADIUS) {
    const receiverInRange = distanceToReceiver(x, y) < range;
    const sourceInRange = distanceToSource(x, y) < range;
    const revealDoorReceiver = receiverInRange && hasLineOfSight(x, y, ROOM.receiver.x, ROOM.receiver.y);
    const revealSealSource = sourceInRange && hasLineOfSight(x, y, ROOM.source.x, ROOM.source.y, ROOM.sourceCell);
    const found = revealDoorReceiver || revealSealSource;
    const evidence = this.buildLabEvidence(revealDoorReceiver, revealSealSource, { x, y }, provenance);
    return { found, revealDoorReceiver, revealSealSource, evidence };
  }
  jam(target = "relay") {
    if (this.pausedFlag) return this.fail("E_PAUSED", "已暂停，操作不可用。");
    if (this.failed) return this.fail("E_PERMISSION", "本局已失败，请重开。");
    if (target === "guard") {
      if (!this.corridor?.canJamGuard()) {
        return this.fail("E_ILLEGAL_TARGET", "没有 6 格内无遮挡的存活守卫。");
      }
      const blocked = this.jamBlocker(this.corridor.isGuardJammed(this.tickIndex));
      if (blocked) return blocked;
      this.startJam(false);
      this.corridor.jamGuard(this.tickIndex);
      return this.ok("守卫感知压制 6 秒。可用 F 开启中继器并过桥。", SLICE.JAM_COST);
    }
    if (this.corridor) {
      if (!this.corridor.canJam()) return this.fail("E_ILLEGAL_TARGET", "中继器超出 6 格施法范围或被遮挡。");
      const blocked = this.jamBlocker();
      if (blocked) return blocked;
      this.startJam();
      this.corridor.setJammed(this.tickIndex, true);
      return this.ok("中继器发射已压制。开关意图与供电保留。", SLICE.JAM_COST);
    }
    if (!(distanceToReceiver(this.playerX, this.playerY) < SLICE.JAM_RANGE)) {
      return this.fail("E_ILLEGAL_TARGET", "距离门接收器太远（需严格小于 6 格）。");
    }
    return this.labJamFrom(this.playerX, this.playerY);
  }
  /**
   * Shared lab-jam capability entry at an EXPLICIT actor position. ECHO uses
   * this with its own position and the SAME energy/cooldown/range/LOS rules.
   */
  jamFrom(x, y, target = "relay") {
    if (this.pausedFlag) return this.fail("E_PAUSED", "已暂停，操作不可用。");
    if (this.failed) return this.fail("E_PERMISSION", "本局已失败，请重开。");
    if (target !== "relay" || this.corridor) {
      return this.fail("E_ILLEGAL_TARGET", "该隔离协作场景仅支持实验室内对门接收器的 ECHO 压制。");
    }
    return this.labJamFrom(x, y);
  }
  labJamFrom(x, y) {
    if (!(distanceToReceiver(x, y) < SLICE.JAM_RANGE)) {
      return this.fail("E_ILLEGAL_TARGET", "距离门接收器太远（需严格小于 6 格）。");
    }
    if (!hasLineOfSight(x, y, ROOM.receiver.x, ROOM.receiver.y)) {
      return this.fail("E_ILLEGAL_TARGET", "门接收器被遮挡，无法压制。");
    }
    const blocked = this.jamBlocker();
    if (blocked) return blocked;
    this.startJam();
    this.pendingSafeClose = false;
    this.solveDoor();
    return this.ok("压制成功：门接收器被压制，门现在可通行。", SLICE.JAM_COST);
  }
  interact() {
    if (this.pausedFlag) return this.fail("E_PAUSED", "已暂停，操作不可用。");
    if (this.failed) return this.fail("E_PERMISSION", "本局已失败，请重开。");
    if (this.corridor) {
      if (!this.corridor.canInteract()) return this.fail("E_ILLEGAL_TARGET", "请靠近无遮挡的岸边控制器。");
      if (this.lastRelayInteractTick === this.tickIndex) return this.fail("E_RETRYABLE", "本逻辑帧已提交开关操作。");
      this.lastRelayInteractTick = this.tickIndex;
      this.corridor.toggle(this.tickIndex, this.jamActive);
      const { manualEnabled, relay } = this.corridor.snapshot(this.tickIndex);
      return this.ok(`中继器开关已${manualEnabled ? "开启" : "关闭"}。${relay === "JAMMED" ? "压制仍在生效。" : ""}`, 0);
    }
    if (!(distanceToReceiver(this.playerX, this.playerY) < SLICE.INTERACT_RANGE)) {
      return this.fail("E_ILLEGAL_TARGET", "距离门太远。");
    }
    if (!hasLineOfSight(this.playerX, this.playerY, ROOM.receiver.x, ROOM.receiver.y)) {
      return this.fail("E_ILLEGAL_TARGET", "门被遮挡，无法交互。");
    }
    if (this.jamActive) {
      return this.ok("门当前已被压制打开，无需普通开门。", 0);
    }
    if (this.sealSourcePresent) {
      return this.fail("E_LINK_UNAVAILABLE", "当前封锁接收有效，普通开门无效（不扣能量）。");
    }
    this.manualOpenIntent = !this.manualOpenIntent;
    this.solveDoor();
    return this.ok(this.manualOpenIntent ? "普通开门成功。" : "普通关门成功。", 0);
  }
  shootGuard() {
    if (this.paused) return this.fail("E_PAUSED", "已暂停，操作不可用。");
    if (this.failed) return this.fail("E_PERMISSION", "本局已失败，请重开。");
    switch (this.corridor?.shoot(this.tickIndex)) {
      case "hit":
        return this.ok("命中守卫。", 0);
      case "cleared":
        return this.ok("守卫已清除。", 0);
      case "cooldown":
        return this.fail("E_COOLDOWN", "脉冲步枪冷却中。");
      default:
        return this.fail("E_ILLEGAL_TARGET", "没有可射击的守卫。");
    }
  }
  /**
   * Public capability description derived from CURRENT authoritative model
   * state. Used by the observation whitelist instead of a fixed "always legal"
   * list; it does not execute actions or duplicate the rule resolvers.
   */
  actionAvailability() {
    const stopped = this.pausedFlag || this.failed;
    const stopReason = this.pausedFlag ? "E_PAUSED" : "E_PERMISSION";
    const mk = (type, status, reasonCode) => reasonCode ? { type, status, reasonCode } : { type, status };
    const out = [
      mk("move", stopped ? "permission_denied" : "available", stopped ? stopReason : void 0),
      mk("wait", stopped ? "permission_denied" : "available", stopped ? stopReason : void 0)
    ];
    out.push(stopped ? mk("scan", "permission_denied", stopReason) : this.energyValue < SLICE.SCAN_COST ? mk("scan", "insufficient_energy", "E_ENERGY_INSUFFICIENT") : this.scanCooldownTicks > 0 ? mk("scan", "cooldown", "E_COOLDOWN") : mk("scan", "available"));
    let jam;
    if (stopped) jam = mk("jam", "permission_denied", stopReason);
    else if (this.jamActive) jam = mk("jam", "unavailable", "E_RETRYABLE");
    else if (this.jamCooldownTicks > 0) jam = mk("jam", "cooldown", "E_COOLDOWN");
    else if (this.energyValue < SLICE.JAM_COST) jam = mk("jam", "insufficient_energy", "E_ENERGY_INSUFFICIENT");
    else {
      const legal = this.corridor ? this.corridor.canJam() || this.corridor.canJamGuard() : distanceToReceiver(this.playerX, this.playerY) < SLICE.JAM_RANGE && hasLineOfSight(this.playerX, this.playerY, ROOM.receiver.x, ROOM.receiver.y);
      jam = mk("jam", legal ? "available" : "unavailable", legal ? void 0 : "E_ILLEGAL_TARGET");
    }
    out.push(jam);
    let interact;
    if (stopped) interact = mk("interact", "permission_denied", stopReason);
    else {
      const legal = this.corridor ? this.corridor.canInteract() : distanceToReceiver(this.playerX, this.playerY) < SLICE.INTERACT_RANGE && hasLineOfSight(this.playerX, this.playerY, ROOM.receiver.x, ROOM.receiver.y);
      interact = mk("interact", legal ? "available" : "unavailable", legal ? void 0 : "E_ILLEGAL_TARGET");
    }
    out.push(interact);
    if (!this.corridor) out.push(mk("shoot_guard", "unavailable", "E_NOT_APPLICABLE"));
    else if (stopped) out.push(mk("shoot_guard", "permission_denied", stopReason));
    else {
      const availability = this.corridor.canShoot(this.tickIndex);
      out.push(availability === "ok" ? mk("shoot_guard", "available") : availability === "cooldown" ? mk("shoot_guard", "cooldown", "E_COOLDOWN") : mk("shoot_guard", "unavailable", "E_ILLEGAL_TARGET"));
    }
    for (const type of ["aim", "fire", "decoy"]) {
      out.push(mk(type, "unavailable", "E_NOT_APPLICABLE"));
    }
    return out;
  }
  markPassed() {
    this.passedFlag = true;
  }
  snapshot() {
    const scanning = this.scanRevealTicks > 0;
    return {
      tick: this.tickIndex,
      energy: this.energyValue,
      doorState: this.door,
      doorPassable: this.doorPassable,
      jamActive: this.jamActive,
      jamRemainingTicks: this.jamRemainingTicks,
      jamCooldownTicks: this.jamCooldownTicks,
      scanCooldownTicks: this.scanCooldownTicks,
      scanRevealTicks: this.scanRevealTicks,
      safeClearTicks: this.safeClearTicks,
      occupancy: this.occupancy,
      passed: this.passedFlag,
      paused: this.pausedFlag,
      manualOpenIntent: this.manualOpenIntent,
      sealSourcePresent: this.sealSourcePresent,
      pendingSafeClose: this.pendingSafeClose,
      position: { x: this.playerX, y: this.playerY },
      reveal: scanning ? {
        doorReceiver: this.revealDoorReceiver,
        sealSource: this.revealSealSource,
        link: this.revealDoorReceiver && this.revealSealSource
      } : null,
      corridor: this.corridor?.snapshot(this.tickIndex) ?? null,
      corridorReveal: scanning && this.corridorReveal ? { ...this.corridorReveal } : null
    };
  }
  serialize() {
    const corridor = this.corridor?.capture(this.jamRemainingTicks, this.scanRevealTicks, this.corridorReveal, this.evidence);
    if (this.corridor && !corridor) throw new Error("Unsafe corridor checkpoint");
    return {
      schema: "last_signal_station_zero_vs00_v1",
      version: 1,
      roomId: "station-zero-r1",
      energy: this.energyValue,
      tick: this.tickIndex,
      doorState: this.door,
      manualOpenIntent: this.manualOpenIntent,
      sealSourcePresent: this.sealSourcePresent,
      passed: this.passedFlag,
      position: { x: this.playerX, y: this.playerY },
      ...corridor ? { corridor } : {},
      ...!corridor && this.scanRevealTicks > 0 && this.evidence.length > 0 ? { evidence: this.evidence.map((e) => ({ ...e, position: { ...e.position } })) } : {},
      remaining: {
        jam: corridor ? 0 : this.jamRemainingTicks,
        jamCooldown: this.jamCooldownTicks,
        scanCooldown: this.scanCooldownTicks,
        scanReveal: corridor ? 0 : this.scanRevealTicks,
        safeClear: this.safeClearTicks,
        regenAcc: this.regenAcc
      }
    };
  }
  reset() {
    this.dispose();
    this.corridor = null;
    this.corridorReveal = null;
    this.lastRelayInteractTick = -1;
    this.energyValue = SLICE.ENERGY_MAX;
    this.tickIndex = 0;
    this.door = "SEALED";
    this.manualOpenIntent = false;
    this.sealSourcePresent = true;
    this.jamRemainingTicks = 0;
    this.jamCooldownTicks = 0;
    this.scanCooldownTicks = 0;
    this.scanRevealTicks = 0;
    this.revealDoorReceiver = false;
    this.revealSealSource = false;
    this.pendingSafeClose = false;
    this.safeClearTicks = SLICE.SAFE_CLEAR_DELAY_TICKS;
    this.regenAcc = 0;
    this.accumulatorMs = 0;
    this.evidence = [];
    this.evidenceRescanRequired = false;
    this.playerX = ROOM.spawn.x;
    this.playerY = ROOM.spawn.y;
    this.occupancy = false;
    this.passedFlag = false;
    this.pausedFlag = false;
    this.lastResult = { code: "OK", message: "已重开：固定房间与能量已重置。", cost: 0 };
  }
  dispose() {
    this.corridor?.dispose();
  }
  tickOnce(onTick) {
    if (!this.corridor) onTick?.();
    this.tickIndex++;
    if (this.energyValue >= SLICE.ENERGY_MAX) {
      this.regenAcc = 0;
    } else {
      this.regenAcc++;
      if (this.regenAcc >= SLICE.REGEN_TICKS) {
        this.regenAcc -= SLICE.REGEN_TICKS;
        this.energyValue++;
        if (this.energyValue >= SLICE.ENERGY_MAX) this.regenAcc = 0;
      }
    }
    if (this.scanCooldownTicks > 0) this.scanCooldownTicks--;
    if (this.scanRevealTicks > 0) this.scanRevealTicks--;
    if (this.evidence.length > 0) {
      const alive = this.evidence.filter((e) => this.tickIndex < e.expiresAtTick);
      if (alive.length !== this.evidence.length) {
        this.evidence = alive;
        if (alive.length === 0) this.scanRevealTicks = 0;
      }
    }
    if (this.scanRevealTicks === 0) {
      this.revealDoorReceiver = false;
      this.revealSealSource = false;
      this.corridorReveal = null;
      this.evidence = [];
    }
    if (this.jamCooldownTicks > 0) this.jamCooldownTicks--;
    const wasJammed = this.jamRemainingTicks > 0;
    if (this.jamRemainingTicks > 0) this.jamRemainingTicks--;
    if (this.corridor) {
      const rescued = this.corridor.advance(this.tickIndex, this.jamActive);
      if (!rescued && !this.failed) onTick?.();
      if (rescued) {
        const failure2 = this.failed ? "本局失败，请重开。" : "";
        this.ok(`桥梁失稳：已返回${rescued === "west" ? "西" : "东"}岸安全点，损失 ${CORRIDOR.dangerHp} HP。${failure2}`, 0);
      } else if (this.failed) {
        this.ok("本局失败。请选择重开。", 0);
      } else if (wasJammed && !this.jamActive) {
        this.ok("压制到期：中继器与下游已按当前供电和开关重新求解。", 0);
      }
      return;
    }
    if (wasJammed && this.jamRemainingTicks === 0) {
      this.pendingSafeClose = true;
      this.safeClearTicks = SLICE.SAFE_CLEAR_DELAY_TICKS;
      this.lastResult = {
        code: "OK",
        message: this.occupancy ? "压制效果结束：你在门内，门保持开启，离开后安全延迟再恢复。" : "压制效果结束：门按当前源/意图/占位条件安全恢复。",
        cost: 0
      };
    }
    this.occupancy = isOccupyingDoor(this.playerX, this.playerY);
    if (this.occupancy) {
      this.safeClearTicks = SLICE.SAFE_CLEAR_DELAY_TICKS;
    } else if (this.pendingSafeClose && this.safeClearTicks > 0) {
      this.safeClearTicks--;
      if (this.safeClearTicks === 0) {
        this.lastResult = { code: "OK", message: "门已在安全延迟后按当前条件恢复。", cost: 0 };
      }
    }
    this.solveDoor();
  }
  /**
   * Single resolver over CURRENT domain conditions:
   * active Jam > occupancy (never clamp) > pending safe-clear delay >
   * seal source present (SEALED) > manual open intent (OPEN/CLOSED).
   */
  solveDoor() {
    if (this.jamRemainingTicks > 0) {
      this.door = "JAMMED_OPEN";
      this.pendingSafeClose = false;
      this.safeClearTicks = SLICE.SAFE_CLEAR_DELAY_TICKS;
      return;
    }
    if (this.occupancy) {
      this.door = "SAFE_PENDING_CLOSE";
      this.pendingSafeClose = true;
      this.safeClearTicks = SLICE.SAFE_CLEAR_DELAY_TICKS;
      return;
    }
    if (this.pendingSafeClose) {
      if (this.safeClearTicks > 0) {
        this.door = "SAFE_PENDING_CLOSE";
        return;
      }
      this.pendingSafeClose = false;
    }
    if (this.sealSourcePresent) {
      this.door = "SEALED";
      return;
    }
    this.door = this.manualOpenIntent ? "OPEN" : "CLOSED";
  }
  restore(p) {
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));
    this.energyValue = clamp(p.energy, 0, SLICE.ENERGY_MAX);
    this.tickIndex = Math.max(0, Math.round(p.tick));
    this.door = p.doorState;
    this.manualOpenIntent = !!p.manualOpenIntent;
    this.sealSourcePresent = p.sealSourcePresent !== false;
    this.passedFlag = !!p.passed;
    const r = p.remaining;
    this.jamRemainingTicks = clamp(r.jam, 0, SLICE.JAM_DURATION_TICKS);
    this.jamCooldownTicks = clamp(r.jamCooldown, 0, SLICE.JAM_CD_TICKS);
    this.scanCooldownTicks = clamp(r.scanCooldown, 0, SLICE.SCAN_CD_TICKS);
    this.scanRevealTicks = clamp(r.scanReveal, 0, SLICE.SCAN_REVEAL_TICKS);
    this.safeClearTicks = clamp(r.safeClear, 0, SLICE.SAFE_CLEAR_DELAY_TICKS);
    this.regenAcc = clamp(r.regenAcc, 0, SLICE.REGEN_TICKS - 1);
    const doorPassable = this.jamRemainingTicks > 0 || this.door === "JAMMED_OPEN" || this.door === "OPEN" || this.door === "SAFE_PENDING_CLOSE";
    const px = Number(p.position?.x);
    const py = Number(p.position?.y);
    const footprintOk = canFit(px, py, (x, y) => isWalkableCell(x, y, doorPassable));
    this.playerX = footprintOk ? px : ROOM.spawn.x;
    this.playerY = footprintOk ? py : ROOM.spawn.y;
    this.accumulatorMs = 0;
    this.occupancy = isOccupyingDoor(this.playerX, this.playerY);
    this.pendingSafeClose = this.jamRemainingTicks === 0 && this.door === "SAFE_PENDING_CLOSE";
    this.pausedFlag = false;
    const hasEvidenceField = p.evidence !== void 0;
    const hadActiveReveal = this.scanRevealTicks > 0;
    const candidates = isSliceEvidenceArray(p.evidence) ? p.evidence : [];
    const valid = hadActiveReveal ? candidates.filter((e) => e.observedAtTick <= this.tickIndex && this.tickIndex < e.expiresAtTick && e.roomId === "station-zero-r1") : [];
    this.evidence = valid.map((e) => ({ ...e, position: { ...e.position } }));
    if (this.evidence.length === 0) {
      this.scanRevealTicks = 0;
      this.evidenceRescanRequired = hasEvidenceField || hadActiveReveal;
    } else {
      this.scanRevealTicks = Math.max(0, Math.min(
        this.scanRevealTicks,
        Math.max(...this.evidence.map((e) => e.expiresAtTick)) - this.tickIndex
      ));
      this.evidenceRescanRequired = candidates.length !== this.evidence.length;
    }
    this.revealDoorReceiver = this.evidence.some((e) => e.targetId === "tgt_lab_door_receiver");
    this.revealSealSource = this.evidence.some((e) => e.targetId === "tgt_lab_seal_source");
    this.lastResult = { code: "OK", message: "已从本原型存档恢复。", cost: 0 };
    this.solveDoor();
    if (p.corridor) {
      this.corridor = new Corridor(p.corridor);
      this.jamRemainingTicks = p.corridor.jamRemaining;
      this.scanRevealTicks = p.corridor.scanRemaining;
      const r2Candidates = isSliceEvidenceArray(p.corridor.evidence) ? p.corridor.evidence : [];
      const r2Valid = this.scanRevealTicks > 0 ? r2Candidates.filter((e) => e.roomId === "station-zero-r2" && e.observedAtTick <= this.tickIndex && this.tickIndex < e.expiresAtTick) : [];
      this.evidence = r2Valid.map((e) => ({ ...e, position: { ...e.position } }));
      this.revealDoorReceiver = false;
      this.revealSealSource = false;
      if (this.evidence.length > 0) {
        this.corridorReveal = {
          relay: this.evidence.some((e) => e.targetId === "tgt_corridor_relay"),
          bridge: this.evidence.some((e) => e.targetId === "tgt_corridor_bridge"),
          perceptionPort: this.evidence.some((e) => e.targetId === "tgt_corridor_guard")
        };
        this.evidenceRescanRequired = r2Candidates.length !== this.evidence.length;
      } else {
        this.corridorReveal = p.corridor.reveal ? { ...p.corridor.reveal } : null;
        this.evidenceRescanRequired = this.scanRevealTicks > 0;
      }
    }
  }
  /** Full private state (P1 internal snapshot). Not the browser checkpoint. */
  captureFull() {
    return {
      energy: this.energyValue,
      tick: this.tickIndex,
      door: this.door,
      manualOpenIntent: this.manualOpenIntent,
      sealSourcePresent: this.sealSourcePresent,
      jamRemainingTicks: this.jamRemainingTicks,
      jamCooldownTicks: this.jamCooldownTicks,
      scanCooldownTicks: this.scanCooldownTicks,
      scanRevealTicks: this.scanRevealTicks,
      revealDoorReceiver: this.revealDoorReceiver,
      revealSealSource: this.revealSealSource,
      pendingSafeClose: this.pendingSafeClose,
      safeClearTicks: this.safeClearTicks,
      regenAcc: this.regenAcc,
      accumulatorMs: this.accumulatorMs,
      playerX: this.playerX,
      playerY: this.playerY,
      occupancy: this.occupancy,
      passed: this.passedFlag,
      paused: this.pausedFlag,
      lastRelayInteractTick: this.lastRelayInteractTick,
      lastResult: { ...this.lastResult },
      corridorReveal: this.corridorReveal ? { ...this.corridorReveal } : null,
      corridor: this.corridor?.captureFull() ?? null,
      evidence: this.evidence.map((e) => ({ ...e, position: { ...e.position } })),
      evidenceRescanRequired: this.evidenceRescanRequired
    };
  }
  /** Restore full private state verbatim; no scan, no bridge/relay re-resolve. */
  restoreFull(state) {
    if (this.corridor) this.corridor.dispose();
    this.energyValue = state.energy;
    this.tickIndex = state.tick;
    this.door = state.door;
    this.manualOpenIntent = state.manualOpenIntent;
    this.sealSourcePresent = state.sealSourcePresent;
    this.jamRemainingTicks = state.jamRemainingTicks;
    this.jamCooldownTicks = state.jamCooldownTicks;
    this.scanCooldownTicks = state.scanCooldownTicks;
    this.scanRevealTicks = state.scanRevealTicks;
    this.revealDoorReceiver = state.revealDoorReceiver;
    this.revealSealSource = state.revealSealSource;
    this.pendingSafeClose = state.pendingSafeClose;
    this.safeClearTicks = state.safeClearTicks;
    this.regenAcc = state.regenAcc;
    this.accumulatorMs = state.accumulatorMs;
    this.playerX = state.playerX;
    this.playerY = state.playerY;
    this.occupancy = state.occupancy;
    this.passedFlag = state.passed;
    this.pausedFlag = state.paused;
    this.lastRelayInteractTick = state.lastRelayInteractTick;
    this.lastResult = { ...state.lastResult };
    this.corridorReveal = state.corridorReveal ? { ...state.corridorReveal } : null;
    this.evidence = state.evidence.map((e) => ({ ...e, position: { ...e.position } }));
    this.evidenceRescanRequired = state.evidenceRescanRequired;
    this.corridor = null;
    if (state.corridor) {
      const corridor = new Corridor();
      corridor.restoreFull(state.corridor);
      this.corridor = corridor;
    }
  }
  buildLabEvidence(revealDoorReceiver, revealSealSource, at, provenance) {
    if (!revealDoorReceiver && !revealSealSource) return [];
    const tick = this.tickIndex;
    const expiresAtTick = tick + SLICE.SCAN_REVEAL_TICKS;
    const position = at ? { x: at.x, y: at.y } : { x: this.position.x, y: this.position.y };
    const link = revealDoorReceiver && revealSealSource ? "rel_lab_seal_link" : null;
    const prov = evidenceProvenance(provenance);
    const out = [];
    if (revealDoorReceiver) out.push({
      targetId: "tgt_lab_door_receiver",
      relationId: link,
      position,
      observedAtTick: tick,
      expiresAtTick,
      stateLabel: "receiver-visible",
      roomId: "station-zero-r1",
      ...prov
    });
    if (revealSealSource) out.push({
      targetId: "tgt_lab_seal_source",
      relationId: link,
      position,
      observedAtTick: tick,
      expiresAtTick,
      stateLabel: "carrier-visible",
      roomId: "station-zero-r1",
      ...prov
    });
    return out;
  }
  buildCorridorEvidence(provenance) {
    const reveal = this.corridorReveal;
    if (!reveal) return [];
    const tick = this.tickIndex;
    const expiresAtTick = tick + SLICE.SCAN_REVEAL_TICKS;
    const position = { x: this.position.x, y: this.position.y };
    const prov = evidenceProvenance(provenance);
    const out = [];
    if (reveal.relay) out.push({
      targetId: "tgt_corridor_relay",
      relationId: null,
      position,
      observedAtTick: tick,
      expiresAtTick,
      stateLabel: "relay-visible",
      roomId: "station-zero-r2",
      ...prov
    });
    if (reveal.bridge) out.push({
      targetId: "tgt_corridor_bridge",
      relationId: reveal.relay ? "rel_corridor_relay_bridge" : null,
      position,
      observedAtTick: tick,
      expiresAtTick,
      stateLabel: "bridge-visible",
      roomId: "station-zero-r2",
      ...prov
    });
    if (reveal.perceptionPort) out.push({
      targetId: "tgt_corridor_guard",
      relationId: reveal.relay ? "rel_corridor_relay_perception" : null,
      position,
      observedAtTick: tick,
      expiresAtTick,
      stateLabel: "perception-visible",
      roomId: "station-zero-r2",
      ...prov
    });
    return out;
  }
  jamBlocker(active = this.jamActive) {
    if (active) return this.fail("E_RETRYABLE", "已有压制效果生效，未扣能量；无需重复使用。");
    if (this.inCorridor && this.energyValue < SLICE.JAM_COST) return this.insufficient(SLICE.JAM_COST);
    if (this.jamCooldownTicks > 0) {
      return this.fail("E_COOLDOWN", `压制冷却中，还需 ${Math.ceil(this.jamCooldownTicks / SLICE.TICK_HZ)} 秒。`);
    }
    if (this.energyValue < SLICE.JAM_COST) return this.insufficient(SLICE.JAM_COST);
    return null;
  }
  startJam(affectsDevice = true) {
    this.energyValue -= SLICE.JAM_COST;
    this.jamCooldownTicks = SLICE.JAM_CD_TICKS;
    if (affectsDevice) this.jamRemainingTicks = SLICE.JAM_DURATION_TICKS;
  }
  ok(message, cost) {
    const r = { code: "OK", message, cost };
    this.lastResult = r;
    return r;
  }
  fail(code, message) {
    const r = { code, message, cost: 0 };
    this.lastResult = r;
    return r;
  }
  insufficient(need) {
    const wait = Math.max(0, Math.ceil((need - this.energyValue) / SLICE.REGEN_PER_SEC));
    return this.fail(
      "E_ENERGY_INSUFFICIENT",
      `能量不足：当前 ${this.energyValue}，需要 ${need}。等待自然恢复，最多约 ${wait} 秒（一次 Jam 所需 25 约需 5 秒）。`
    );
  }
}
const NO_MOVEMENT = Object.freeze({
  up: false,
  down: false,
  left: false,
  right: false
});
function directionToIntent(direction) {
  switch (direction) {
    case "up":
      return { up: true, down: false, left: false, right: false };
    case "down":
      return { up: false, down: true, left: false, right: false };
    case "left":
      return { up: false, down: false, left: true, right: false };
    case "right":
      return { up: false, down: false, left: false, right: true };
    case "east":
      return { up: false, down: true, left: false, right: true };
    case "west":
      return { up: true, down: false, left: true, right: false };
    case "south":
      return { up: false, down: true, left: true, right: false };
    case "north":
      return { up: true, down: false, left: false, right: true };
  }
}
function stepMovement(model, intent) {
  const p = stepMovementAt(model, intent, model.position.x, model.position.y);
  model.setPlayerPos(p.x, p.y);
}
function stepMovementAt(model, intent, x, y) {
  const dir = { x: 0, y: 0 };
  if (intent.up) {
    dir.x -= 1;
    dir.y -= 1;
  }
  if (intent.down) {
    dir.x += 1;
    dir.y += 1;
  }
  if (intent.left) {
    dir.x -= 1;
    dir.y += 1;
  }
  if (intent.right) {
    dir.x += 1;
    dir.y -= 1;
  }
  let px = x;
  let py = y;
  const len = Math.hypot(dir.x, dir.y);
  if (len > 0) {
    const step = SLICE.MOVE_SPEED * (SLICE.TICK_MS / 1e3);
    const dx = dir.x / len * step;
    const dy = dir.y / len * step;
    if (model.canStandAt(px + dx, py)) px += dx;
    if (model.canStandAt(px, py + dy)) py += dy;
  }
  return { x: px, y: py };
}
function resolveTransitions(model, previous, hooks = {}) {
  const position = model.position;
  let passedDoor = false;
  let enteredCorridor = false;
  let crossedEast = false;
  if (!model.inCorridor && !model.passed && position.x > ROOM.eastThresholdX) {
    model.markPassed();
    passedDoor = true;
  }
  if (!model.inCorridor && model.passed && Math.hypot(position.x - ROOM.exit.x, position.y - ROOM.exit.y) < 0.45) {
    hooks.beforeEnterCorridor?.(model);
    enteredCorridor = model.enterCorridor();
  } else if (model.failed) ;
  else if (!previous.corridor?.crossed) {
    const corridor = model.snapshot().corridor;
    if (corridor?.crossed) crossedEast = true;
  }
  const snapshot = model.snapshot();
  return {
    passedDoor,
    enteredCorridor,
    crossedEast,
    failed: model.failed,
    canCheckpoint: model.canCheckpoint,
    guardHp: snapshot.corridor?.guardHp ?? 0
  };
}
const AI_NATIVE_PROTOCOL_VERSION = 1;
const AI_NATIVE_DTO_SCHEMA_V1 = "last_signal.ai-native.dto.v1";
const AI_NATIVE_ENVELOPE_SCHEMA_V1 = "last_signal.ai-native.envelope.v1";
const AI_NATIVE_OBSERVATION_SCHEMA_V1 = "last_signal.ai-native.observation.v1";
const AI_NATIVE_DEBUG_SCHEMA_V1 = "last_signal.ai-native.debug.v1";
const AI_NATIVE_EVENT_SCHEMA_V1 = "last_signal.ai-native.event.v1";
const AI_NATIVE_SNAPSHOT_SCHEMA_V1 = "last_signal.ai-native.snapshot.v1";
const AI_NATIVE_REPLAY_SCHEMA_V1 = "last_signal.ai-native.replay.v1";
const AI_NATIVE_SCHEMA_V1 = Object.freeze({
  dto: AI_NATIVE_DTO_SCHEMA_V1,
  envelope: AI_NATIVE_ENVELOPE_SCHEMA_V1,
  observation: AI_NATIVE_OBSERVATION_SCHEMA_V1,
  debug: AI_NATIVE_DEBUG_SCHEMA_V1,
  event: AI_NATIVE_EVENT_SCHEMA_V1,
  snapshot: AI_NATIVE_SNAPSHOT_SCHEMA_V1,
  replay: AI_NATIVE_REPLAY_SCHEMA_V1
});
const AI_NATIVE_KERNEL_VERSION_V1 = "station-zero-r1-r2@1";
const AI_NATIVE_SCENARIO_ID_V1 = "station-zero-r1-r2";
const AI_NATIVE_ROOM_IDS_V1 = Object.freeze(["station-zero-r1", "station-zero-r2"]);
const AI_NATIVE_ERROR_CODES_V1 = Object.freeze([
  "E_SCHEMA",
  "E_VERSION_UNSUPPORTED",
  "E_PAYLOAD_TOO_LARGE",
  "E_SESSION_NOT_FOUND",
  "E_SESSION_CLOSED",
  "E_STALE_EPOCH",
  "E_STALE_GENERATION",
  "E_TARGET_DESTROYED",
  "E_STALE_TICK",
  "E_FUTURE_TICK",
  "E_UNKNOWN_ACTOR",
  "E_ID_PAYLOAD_MISMATCH",
  "E_ACTION_EXPIRED",
  "E_PERMISSION",
  "E_PAUSED",
  "E_NOT_APPLICABLE",
  "E_ILLEGAL_TARGET",
  "E_LINK_UNAVAILABLE",
  "E_RETRYABLE",
  "E_ENERGY_INSUFFICIENT",
  "E_COOLDOWN",
  "E_RATE_LIMIT",
  "E_RESOURCE_LIMIT",
  "E_CANCELLED",
  "E_PREEMPTED",
  "E_TIMEOUT",
  "E_SNAPSHOT_INVALID",
  "E_REPLAY_INCOMPATIBLE",
  "E_SAVE_FAILED",
  "E_INTERNAL_TRANSACTION"
]);
const AI_NATIVE_LIMITS_V1 = Object.freeze({
  MAX_SESSIONS: 16,
  MAX_CONCURRENT_STEPS: 4,
  MAX_TICKS_PER_STEP: 1e3,
  MAX_TICKS_PER_STEP_HARD: 1e4,
  MAX_ACTIONS_PER_TICK: 32,
  MAX_ACTIVE_INTENTS_PER_ACTOR: 1,
  MAX_ACTION_DURATION_TICKS: 3600,
  MAX_PAYLOAD_BYTES: 4096,
  MAX_OBSERVATION_EVENTS: 64,
  MAX_EVENT_LOG_EVENTS: 1e4,
  MAX_EVENTS_PER_PAGE: 256,
  MAX_SNAPSHOT_BYTES: 262144,
  MAX_REPLAY_ACTIONS: 1e5,
  MAX_REPLAY_BYTES: 8388608,
  REQUEST_TIMEOUT_MS: 3e4,
  HEARTBEAT_MS: 5e3,
  IDLE_TIMEOUT_MS: 3e5,
  MAX_SESSION_WALL_MS: 36e5,
  MAX_REQUESTS_PER_SECOND: 20,
  MAX_OBSERVE_PER_SECOND: 10,
  MAX_STEP_TICKS_PER_SECOND: 6e3,
  /** schema-layer bounds, not the transport table above */
  MAX_TICK: 2147483647,
  MAX_COORDINATE_ABS: 1e6,
  MAX_STRING_LENGTH: 128,
  /** default per-DTO array ceiling (explicit per-field ceilings override) */
  MAX_ARRAY_LENGTH: 64,
  MAX_OBJECT_KEYS: 4096,
  MAX_DEPTH: 32,
  MAX_NODES: 2e5,
  /** raw JSON purity walk ceilings: must not constrain replay-length arrays */
  WALK_MAX_ARRAY_LENGTH: 1e5
});
const AI_NATIVE_ROLES_V1 = Object.freeze(["PLAYER", "COMPANION", "DEVELOPER"]);
const AI_NATIVE_SESSION_KINDS_V1 = Object.freeze(["production", "test"]);
const AI_NATIVE_MODES_V1 = Object.freeze(["headless", "rendered"]);
const AI_NATIVE_RUN_END_REASONS_V1 = Object.freeze([
  "completed",
  "died",
  "cancelled",
  "timeout",
  "closed"
]);
const AI_NATIVE_ACTION_TYPES_V1 = Object.freeze([
  "move",
  "aim",
  "fire",
  "scan",
  "jam",
  "interact",
  "shoot_guard",
  "decoy",
  "wait"
]);
const AI_NATIVE_SESSION_COMMANDS_V1 = Object.freeze([
  "pause",
  "resume",
  "reset",
  "close",
  "snapshot",
  "restore",
  "replay",
  "inspect_state",
  "inject_fixture"
]);
const AI_NATIVE_ACTION_STATUSES_V1 = Object.freeze([
  "pending",
  "active",
  "completed",
  "rejected",
  "timeout",
  "cancelled",
  "preempted"
]);
const AI_NATIVE_STEP_STATUSES_V1 = Object.freeze([
  "completed",
  "paused",
  "finished",
  "rejected",
  "cancelled"
]);
const AI_NATIVE_HIDDEN_FIELD_NAMES_V1 = Object.freeze([
  "seed",
  "bestseed",
  "best_seed",
  "rng",
  "rngstate",
  "rng_state",
  "rng.state",
  "gamescene.seed",
  "mapdata.seed",
  "mapdata",
  "tiles",
  "doorways",
  "roomsorder",
  "enteredrooms",
  "hiddenmap",
  "fullmap",
  "hidden_map",
  "unexplored",
  "statetimer",
  "state_timer",
  "patrolpoints",
  "patrolindex",
  "stuntimer",
  "aggrorange",
  "fsm",
  "detects",
  "hitset",
  "state",
  "savedata",
  "saveversion",
  "save_version",
  "version",
  "createdat",
  "updatedat",
  "permanent",
  "settings",
  "stats",
  "unlockedweapons",
  "unlockedabilities",
  "scene",
  "world",
  "renderer",
  "sprite",
  "camera",
  "phaser",
  "__game",
  "window",
  "localstorage",
  "document",
  "process",
  "env",
  "apikey",
  "token",
  "password",
  "secret",
  "credential",
  "authorization",
  "aimyaw",
  "dashtimer",
  "invuln",
  "reloadtimer",
  "manualopenintent",
  "sealsourcepresent",
  "pendingsafeclose",
  "occupancy",
  "revealdoorreceiver",
  "revealsealsource",
  "reveal",
  "revealraw",
  "deadline",
  "regenacc",
  "listeners",
  "nextshottick",
  "attackat",
  "watching",
  "guard.evidence",
  "enemies",
  "projectiles",
  "loot",
  "fx",
  "raw",
  "internal",
  "hidden",
  "hypothesis",
  "canonical",
  "enemydata",
  "playerdata",
  "weaponstate",
  "role",
  "permission",
  "asactor",
  "impersonate",
  "asactorid",
  "debug",
  "test",
  "fixture",
  "fixtureref",
  "fixturelog",
  "fixturevalue",
  "prototype",
  "constructor",
  "__proto__"
]);
const ID_PATTERNS = {
  sessionId: /^ses_[0-9a-f]{24}$/,
  actorId: /^act_[0-9a-f]{16}$/,
  actionId: /^aid_[0-9a-f]{24}$/,
  requestId: /^req_[0-9a-f]{24}$/,
  targetId: /^tgt_[a-z0-9_]{1,64}$/,
  evidenceId: /^ev_[a-z0-9]{1,64}$/,
  eventId: /^evt_[a-z0-9]{1,64}$/,
  snapshotId: /^snap_[a-z0-9]{1,64}$/
};
Object.freeze(ID_PATTERNS);
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const SHA256_HASH = /^sha256:[0-9a-f]{64}$/;
const FNV_HASH = /^fnv1a32:[0-9a-f]{8}$/;
const AI_NATIVE_EVENT_TYPES_V1 = Object.freeze([
  "SESSION_CREATED",
  "SESSION_PAUSED",
  "SESSION_RESUMED",
  "SESSION_RESET",
  "SESSION_CLOSED",
  "ACTION_ACCEPTED",
  "ACTION_REJECTED",
  "ACTION_COMPLETED",
  "ACTION_CANCELLED",
  "ACTION_PREEMPTED",
  "ACTION_TIMEOUT",
  "ACTION_REPLAYED",
  "SCAN_EVIDENCE_CREATED",
  "SCAN_EVIDENCE_EXPIRED",
  "JAM_APPLIED",
  "JAM_EXPIRED",
  "DOOR_STATE_CHANGED",
  "RELAY_STATE_CHANGED",
  "BRIDGE_STATE_CHANGED",
  "GUARD_LINK_CHANGED",
  "GUARD_HIT",
  "GUARD_CLEARED",
  "PLAYER_RESCUED",
  "PLAYER_DAMAGED",
  "ROOM_ENTERED",
  "DOOR_PASSED",
  "EAST_CROSSED",
  "RUN_COMPLETED",
  "RUN_FAILED",
  "SNAPSHOT_SAVED",
  "SNAPSHOT_RESTORED",
  "REPLAY_STARTED",
  "REPLAY_FINISHED",
  "DEV_FIXTURE_INJECTED",
  "PERMISSION_DENIED",
  "RATE_LIMITED",
  "SCHEMA_REJECTED"
]);
const HIDDEN_SET = new Set(
  AI_NATIVE_HIDDEN_FIELD_NAMES_V1.map((name) => name.toLowerCase())
);
new Set(Object.values(AI_NATIVE_SCHEMA_V1));
const ERROR_CODE_SET = new Set(AI_NATIVE_ERROR_CODES_V1);
const POLLUTION_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
const AI_NATIVE_ERROR_MESSAGES_V1 = Object.freeze({
  E_SCHEMA: "DTO shape, field type or range is invalid.",
  E_VERSION_UNSUPPORTED: "Protocol version or schema identifier is not supported.",
  E_PAYLOAD_TOO_LARGE: "Request payload exceeds the byte limit.",
  E_SESSION_NOT_FOUND: "Session does not exist.",
  E_SESSION_CLOSED: "Session is closed.",
  E_STALE_EPOCH: "Epoch does not match the active session.",
  E_STALE_GENERATION: "Target instance generation is stale.",
  E_TARGET_DESTROYED: "Target has been destroyed.",
  E_STALE_TICK: "Tick is older than the authoritative tick.",
  E_FUTURE_TICK: "Tick is in the future.",
  E_UNKNOWN_ACTOR: "Actor is not registered in this session.",
  E_ID_PAYLOAD_MISMATCH: "The same action id was reused with a different payload.",
  E_ACTION_EXPIRED: "The request expired before entering the core.",
  E_PERMISSION: "The actor is not permitted to perform this operation.",
  E_PAUSED: "The session is paused.",
  E_NOT_APPLICABLE: "This action is not implemented in the P0 Station Zero scenario.",
  E_ILLEGAL_TARGET: "Target is not visible or not authorised.",
  E_LINK_UNAVAILABLE: "The link is currently unavailable.",
  E_RETRYABLE: "The operation is already in effect; retry with a new id.",
  E_ENERGY_INSUFFICIENT: "Not enough energy.",
  E_COOLDOWN: "The ability is cooling down.",
  E_RATE_LIMIT: "Request rate limit exceeded.",
  E_RESOURCE_LIMIT: "Resource limit exceeded.",
  E_CANCELLED: "The action was cancelled.",
  E_PREEMPTED: "The action was preempted by human takeover.",
  E_TIMEOUT: "The action timed out.",
  E_SNAPSHOT_INVALID: "The snapshot is invalid.",
  E_REPLAY_INCOMPATIBLE: "The snapshot or replay is incompatible with this reader.",
  E_SAVE_FAILED: "Persistence write failed.",
  E_INTERNAL_TRANSACTION: "The atomic transaction failed; no state was committed."
});
function issue(code, path) {
  return Object.freeze({ code, path, message: AI_NATIVE_ERROR_MESSAGES_V1[code] });
}
function bad(code, path) {
  return Object.freeze({ ok: false, issue: issue(code, path) });
}
function good(value) {
  return Object.freeze({ ok: true, value });
}
function isPlainObject$2(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
const C = (value) => ({ t: "const", value });
const ENUM = (values) => ({ t: "enum", values });
const ID = (pattern) => ({ t: "id", pattern });
const STR = (max = AI_NATIVE_LIMITS_V1.MAX_STRING_LENGTH, pattern) => ({ t: "string", max, pattern });
const NUM = (min = 0, max = AI_NATIVE_LIMITS_V1.MAX_TICK, int = true) => ({ t: "number", min, max, int });
const BOOL = { t: "bool" };
const NULL = { t: "null" };
const OBJ = (fields, optional = []) => ({ t: "object", fields, optional });
const ARR = (item, max = AI_NATIVE_LIMITS_V1.MAX_ARRAY_LENGTH) => ({ t: "array", item, max });
const JSON_ONLY = { t: "json" };
const PRIVATE = (inner) => ({ t: "scope", blacklist: false, inner });
const HASH = (prefix) => ({ t: "hash", prefix });
function walkPureJson(value, path, ctx) {
  ctx.nodes += 1;
  if (ctx.nodes > AI_NATIVE_LIMITS_V1.MAX_NODES || ctx.depth > AI_NATIVE_LIMITS_V1.MAX_DEPTH) {
    return issue("E_SCHEMA", path);
  }
  if (value === null) return null;
  const kind = typeof value;
  if (kind === "undefined" || kind === "symbol" || kind === "bigint" || kind === "function") {
    return issue("E_SCHEMA", path);
  }
  if (kind === "number") return Number.isFinite(value) ? null : issue("E_SCHEMA", path);
  if (kind === "boolean") return null;
  if (kind === "string") {
    const text = value;
    return text.length <= AI_NATIVE_LIMITS_V1.MAX_STRING_LENGTH && !CONTROL_CHARS.test(text) ? null : issue("E_SCHEMA", path);
  }
  const object = value;
  if (ctx.seen.has(object)) return issue("E_SCHEMA", path);
  if (Array.isArray(object)) {
    if (object.length > AI_NATIVE_LIMITS_V1.WALK_MAX_ARRAY_LENGTH) return issue("E_SCHEMA", path);
    ctx.seen.add(object);
    ctx.depth += 1;
    for (let index = 0; index < object.length; index += 1) {
      const child = `${path}[${index}]`;
      if (!(index in object)) return issue("E_SCHEMA", child);
      const problem = walkPureJson(object[index], child, ctx);
      if (problem) return problem;
    }
    ctx.depth -= 1;
    ctx.seen.delete(object);
    return null;
  }
  if (!isPlainObject$2(object)) return issue("E_SCHEMA", path);
  const record = object;
  const keys = Reflect.ownKeys(record);
  if (keys.length > AI_NATIVE_LIMITS_V1.MAX_OBJECT_KEYS) return issue("E_SCHEMA", path);
  ctx.seen.add(object);
  ctx.depth += 1;
  for (const key of keys) {
    const child = `${path}.${String(key)}`;
    if (typeof key !== "string") return issue("E_SCHEMA", child);
    if (POLLUTION_KEYS.has(key)) return issue("E_SCHEMA", child);
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor)) return issue("E_SCHEMA", child);
    const problem = walkPureJson(record[key], child, ctx);
    if (problem) return problem;
  }
  ctx.depth -= 1;
  ctx.seen.delete(object);
  return null;
}
function checkVersion(record, path, schema) {
  if (!("schema" in record) || !("protocolVersion" in record)) return issue("E_SCHEMA", path);
  if (typeof record.schema !== "string" || typeof record.protocolVersion !== "number" || !Number.isFinite(record.protocolVersion)) {
    return issue("E_SCHEMA", `${path}.protocolVersion`);
  }
  if (record.protocolVersion !== AI_NATIVE_PROTOCOL_VERSION || record.schema !== schema) {
    return issue("E_VERSION_UNSUPPORTED", `${path}.protocolVersion`);
  }
  return null;
}
function validateSpec(value, spec, path, ctx) {
  ctx.nodes += 1;
  if (ctx.nodes > AI_NATIVE_LIMITS_V1.MAX_NODES || ctx.depth > AI_NATIVE_LIMITS_V1.MAX_DEPTH) {
    return issue("E_SCHEMA", path);
  }
  switch (spec.t) {
    case "const":
      return value === spec.value ? null : issue("E_SCHEMA", path);
    case "enum":
      return typeof value === "string" && spec.values.includes(value) ? null : issue("E_SCHEMA", path);
    case "id":
      return typeof value === "string" && spec.pattern.test(value) ? null : issue("E_SCHEMA", path);
    case "string":
      if (typeof value !== "string" || value.length > (spec.max ?? AI_NATIVE_LIMITS_V1.MAX_STRING_LENGTH) || CONTROL_CHARS.test(value) || spec.pattern && !spec.pattern.test(value)) {
        return issue("E_SCHEMA", path);
      }
      return null;
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return issue("E_SCHEMA", path);
      if (spec.int && !Number.isSafeInteger(value)) return issue("E_SCHEMA", path);
      if (Object.is(value, -0) || value < (spec.min ?? 0) || value > (spec.max ?? AI_NATIVE_LIMITS_V1.MAX_TICK)) {
        return issue("E_SCHEMA", path);
      }
      return null;
    }
    case "bool":
      return typeof value === "boolean" ? null : issue("E_SCHEMA", path);
    case "null":
      return value === null ? null : issue("E_SCHEMA", path);
    case "hash": {
      const pattern = spec.prefix === "sha256" ? SHA256_HASH : FNV_HASH;
      return typeof value === "string" && pattern.test(value) ? null : issue("E_SCHEMA", path);
    }
    case "code":
      return typeof value === "string" && ERROR_CODE_SET.has(value) ? null : issue("E_SCHEMA", path);
    case "resultCode":
      return typeof value === "string" && (value === "OK" || ERROR_CODE_SET.has(value)) ? null : issue("E_SCHEMA", path);
    case "json":
      return walkPureJson(value, path, ctx);
    case "scope": {
      const saved = ctx.blacklist;
      ctx.blacklist = spec.blacklist;
      const problem = validateSpec(value, spec.inner, path, ctx);
      ctx.blacklist = saved;
      return problem;
    }
    case "array": {
      if (!Array.isArray(value)) return issue("E_SCHEMA", path);
      if (value.length > (spec.max ?? AI_NATIVE_LIMITS_V1.MAX_ARRAY_LENGTH)) return issue("E_SCHEMA", path);
      ctx.depth += 1;
      for (let index = 0; index < value.length; index += 1) {
        const child = `${path}[${index}]`;
        if (!(index in value)) return issue("E_SCHEMA", child);
        const problem = validateSpec(value[index], spec.item, child, ctx);
        if (problem) return problem;
      }
      ctx.depth -= 1;
      return null;
    }
    case "object":
    case "primitiveRecord":
    case "record": {
      if (!isPlainObject$2(value)) return issue("E_SCHEMA", path);
      const record = value;
      const keys = Reflect.ownKeys(record);
      if (keys.length > (spec.t === "record" ? spec.maxKeys ?? AI_NATIVE_LIMITS_V1.MAX_OBJECT_KEYS : AI_NATIVE_LIMITS_V1.MAX_OBJECT_KEYS)) return issue("E_SCHEMA", path);
      const allowed = spec.t === "object" ? /* @__PURE__ */ new Set([...Object.keys(spec.fields), ...spec.optional ?? []]) : null;
      const required = spec.t === "object" ? Object.keys(spec.fields).filter((key) => !(spec.optional ?? []).includes(key)) : [];
      for (const key of keys) {
        const child = `${path}.${String(key)}`;
        if (typeof key !== "string") return issue("E_SCHEMA", child);
        key.toLowerCase();
        if (POLLUTION_KEYS.has(key)) return issue("E_SCHEMA", child);
        if (allowed && !allowed.has(key)) return issue("E_SCHEMA", child);
        if (spec.t === "record" && !spec.keyPattern.test(key)) return issue("E_SCHEMA", child);
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || !("value" in descriptor)) return issue("E_SCHEMA", child);
      }
      for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) return issue("E_SCHEMA", `${path}.${key}`);
      }
      ctx.depth += 1;
      for (const key of keys) {
        const child = `${path}.${key}`;
        if (spec.t === "object") {
          if (!Object.prototype.hasOwnProperty.call(spec.fields, key)) continue;
          const problem = validateSpec(record[key], spec.fields[key], child, ctx);
          if (problem) return problem;
        } else if (spec.t === "record") {
          const problem = validateSpec(record[key], spec.value, child, ctx);
          if (problem) return problem;
        } else {
          if (spec.values && !spec.values.includes(key)) return issue("E_SCHEMA", child);
          const item = record[key];
          if (item !== null && typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
            return issue("E_SCHEMA", child);
          }
          if (typeof item === "number" && !Number.isFinite(item)) return issue("E_SCHEMA", child);
        }
      }
      ctx.depth -= 1;
      return null;
    }
    case "oneOf": {
      let first = null;
      for (const variant of spec.variants) {
        const attempt = {
          nodes: ctx.nodes,
          seen: /* @__PURE__ */ new WeakSet(),
          blacklist: ctx.blacklist,
          depth: ctx.depth
        };
        const problem = validateSpec(value, variant, path, attempt);
        if (!problem) {
          ctx.nodes = attempt.nodes;
          return null;
        }
        if (!first) first = problem;
      }
      return first ?? issue("E_SCHEMA", path);
    }
    case "byKey": {
      if (!isPlainObject$2(value)) return issue("E_SCHEMA", path);
      const key = value[spec.key];
      if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(spec.variants, key)) {
        return issue("E_SCHEMA", `${path}.${spec.key}`);
      }
      return validateSpec(value, spec.variants[key], path, ctx);
    }
    case "custom":
      return spec.check(value, path, ctx);
  }
}
function newContext(blacklist) {
  return { nodes: 0, seen: /* @__PURE__ */ new WeakSet(), blacklist, depth: 0 };
}
function hasHiddenField(value, allowed = []) {
  const allow = new Set(allowed.map((name) => name.toLowerCase()));
  const seen = /* @__PURE__ */ new WeakSet();
  const scan = (current, path, depth) => {
    if (current === null || typeof current !== "object") return null;
    if (seen.has(current) || depth > AI_NATIVE_LIMITS_V1.MAX_DEPTH) return path;
    seen.add(current);
    for (const key of Reflect.ownKeys(current)) {
      const child = `${path}.${String(key)}`;
      if (typeof key !== "string") return child;
      if (HIDDEN_SET.has(key.toLowerCase()) && !allow.has(key.toLowerCase()) || POLLUTION_KEYS.has(key)) return child;
      const nested = current[key];
      if (nested !== null && typeof nested === "object") {
        const problem = scan(nested, child, depth + 1);
        if (problem) return problem;
      }
    }
    return null;
  };
  return scan(value, "$", 0);
}
function runSpec(input, spec, versionCheck) {
  const ctx = newContext(true);
  const pure = walkPureJson(input, "$", newContext(false));
  if (pure) return bad(pure.code, pure.path);
  if (versionCheck && isPlainObject$2(input)) {
    const problem2 = versionCheck(input);
    if (problem2) return bad(problem2.code, problem2.path);
  }
  const problem = validateSpec(input, spec, "$", ctx);
  if (problem) return bad(problem.code, problem.path);
  return good(input);
}
const WXWY = OBJ({
  x: NUM(-AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, false),
  y: NUM(-AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, false)
});
const VERSION_FIELDS = (schema) => ({
  schema: C(schema),
  protocolVersion: C(AI_NATIVE_PROTOCOL_VERSION)
});
const versionGuard = (schema) => (record) => checkVersion(record, "$", schema);
const SESSION_ID = ID(ID_PATTERNS.sessionId);
const ACTOR_ID = ID(ID_PATTERNS.actorId);
const ACTION_ID = ID(ID_PATTERNS.actionId);
const REQUEST_ID = ID(ID_PATTERNS.requestId);
const TARGET_ID = ID(ID_PATTERNS.targetId);
const EVIDENCE_ID = ID(ID_PATTERNS.evidenceId);
const EVENT_ID = ID(ID_PATTERNS.eventId);
const SNAPSHOT_ID = ID(ID_PATTERNS.snapshotId);
const EPOCH = NUM(0, 4294967295);
const TICK = NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK);
const MS = NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK);
const ACTION_TYPE = ENUM(AI_NATIVE_ACTION_TYPES_V1);
const ROLE = ENUM(AI_NATIVE_ROLES_V1);
const DURATION_TICKS = NUM(1, AI_NATIVE_LIMITS_V1.MAX_ACTION_DURATION_TICKS);
OBJ({
  actorId: ACTOR_ID,
  role: ROLE,
  priority: NUM(0, 2),
  allowedActions: ARR(ACTION_TYPE),
  observationScope: ENUM(["self", "shared"])
});
const RESOURCE_LIMIT_KEYS = [
  "maxTicksPerStep",
  "maxActionsPerTick",
  "maxActiveIntentsPerActor",
  "maxActionDurationTicks",
  "maxPayloadBytes",
  "maxObservationEvents",
  "maxEventsPerPage",
  "maxRequestsPerSecond",
  "maxObservePerSecond",
  "maxStepTicksPerSecond",
  "requestTimeoutMs",
  "heartbeatMs",
  "idleTimeoutMs",
  "maxSessionWallMs"
];
OBJ(Object.fromEntries(
  RESOURCE_LIMIT_KEYS.map((key) => [key, NUM(1, AI_NATIVE_LIMITS_V1.MAX_TICK)])
));
const ACTION_PAYLOAD_SPECS = Object.freeze({
  move: OBJ({ type: C("move"), direction: WXWY, durationTicks: DURATION_TICKS }),
  aim: OBJ({ type: C("aim"), direction: WXWY }),
  fire: OBJ({ type: C("fire"), held: BOOL, durationTicks: DURATION_TICKS }),
  scan: OBJ({ type: C("scan") }),
  jam: OBJ({ type: C("jam"), targetId: TARGET_ID }),
  interact: OBJ({ type: C("interact"), targetId: TARGET_ID }),
  shoot_guard: OBJ({ type: C("shoot_guard"), targetId: TARGET_ID }),
  decoy: OBJ({ type: C("decoy"), position: WXWY }),
  wait: OBJ({ type: C("wait"), durationTicks: DURATION_TICKS })
});
const ACTION_REQUEST_SHAPE = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  actionId: ACTION_ID,
  actorId: ACTOR_ID,
  sessionId: SESSION_ID,
  epoch: EPOCH,
  targetTick: TICK,
  type: ACTION_TYPE,
  payload: {
    t: "custom",
    name: "discriminatedPayload",
    check: (value, path, ctx) => {
      if (!isPlainObject$2(value)) return issue("E_SCHEMA", path);
      const type = value.type;
      if (typeof type !== "string" || !isSupportedActionType(type)) {
        return issue("E_SCHEMA", `${path}.type`);
      }
      return validateSpec(value, ACTION_PAYLOAD_SPECS[type], path, ctx);
    }
  },
  clientSeq: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  issuedAtMs: MS,
  deadlineTick: TICK
});
const ACTION_REQUEST = {
  t: "custom",
  name: "actionRequest",
  check: (value, path, ctx) => {
    const problem = validateSpec(value, ACTION_REQUEST_SHAPE, path, ctx);
    if (problem) return problem;
    if (!isPlainObject$2(value)) return issue("E_SCHEMA", path);
    if (!isPlainObject$2(value.payload) || value.payload.type !== value.type) {
      return issue("E_SCHEMA", `${path}.payload.type`);
    }
    if (typeof value.targetTick === "number" && typeof value.deadlineTick === "number" && value.deadlineTick < value.targetTick) {
      return issue("E_SCHEMA", `${path}.deadlineTick`);
    }
    return null;
  }
};
const OBSERVATION_EVIDENCE = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_OBSERVATION_SCHEMA_V1),
  evidenceId: EVIDENCE_ID,
  sceneEpoch: EPOCH,
  roomId: ENUM(AI_NATIVE_ROOM_IDS_V1),
  sourceActionId: ACTION_ID,
  source: C("player-scan"),
  observerActorId: ACTOR_ID,
  observerPosition: WXWY,
  targetId: TARGET_ID,
  relationId: STR(128, SAFE_TOKEN),
  observedAtTick: TICK,
  expiresAtTick: TICK,
  observedState: {
    t: "primitiveRecord",
    values: Object.freeze([
      "stateLabel",
      "signalPresent",
      "suppressed",
      "bridgePassable",
      "effectiveOutput",
      "guardLink",
      "discovered",
      "linkVisible"
    ])
  }
}, ["relationId"]);
const ACTION_CAPABILITY = OBJ({
  type: ACTION_TYPE,
  status: ENUM(["available", "unavailable", "cooldown", "insufficient_energy", "permission_denied"]),
  reasonCode: { t: "code" },
  targetIds: ARR(TARGET_ID),
  maxDurationTicks: DURATION_TICKS
}, ["reasonCode", "targetIds", "maxDurationTicks"]);
const CURRENT_FACTS = OBJ({
  self: OBJ({
    position: WXWY,
    energy: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
    hp: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
    maxHp: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
    alive: BOOL,
    paused: BOOL,
    passed: BOOL,
    crossed: BOOL,
    failed: BOOL,
    completed: BOOL
  }, ["hp", "maxHp"]),
  publicDeviceState: OBJ({
    door: ENUM(["SEALED", "JAMMED_OPEN", "OPEN", "CLOSED", "SAFE_PENDING_CLOSE"]),
    doorPassable: BOOL,
    relay: ENUM(["ACTIVE", "INACTIVE", "JAMMED", "DISABLED"]),
    effectiveOutput: BOOL,
    bridge: ENUM(["UNAVAILABLE", "TRANSITIONING", "STABLE", "UNSTABLE", "DISABLED"]),
    bridgePassable: BOOL,
    guardLink: ENUM(["DEAD", "JAMMED", "LINKED", "DISCONNECTED"]),
    guardHp: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
    canInteract: BOOL,
    onBridge: BOOL,
    lastShore: ENUM(["west", "east"])
  }, [
    "relay",
    "effectiveOutput",
    "bridge",
    "bridgePassable",
    "guardLink",
    "guardHp",
    "canInteract",
    "onBridge",
    "lastShore"
  ]),
  publicTimers: OBJ({
    scanCooldownTicks: TICK,
    jamCooldownTicks: TICK,
    scanRevealRemainingTicks: TICK,
    jamRemainingTicks: TICK,
    safeClearRemainingTicks: TICK,
    guardJamRemainingTicks: TICK,
    bridgeRemainingTicks: TICK
  }, ["guardJamRemainingTicks", "bridgeRemainingTicks"]),
  visibleTargets: ARR(OBJ({
    targetId: TARGET_ID,
    kind: ENUM(["door", "receiver", "source", "relay", "bridge", "guard", "control"]),
    publicState: STR(128, SAFE_TOKEN),
    position: WXWY,
    visibility: ENUM(["ordinary", "scan-revealed", "echo-shared"])
  }, ["position"])),
  knownConnections: ARR(OBJ({
    relationId: STR(128, SAFE_TOKEN),
    fromTargetId: TARGET_ID,
    toTargetId: TARGET_ID,
    stateLabel: STR(128, SAFE_TOKEN),
    evidenceId: EVIDENCE_ID
  }))
});
const EVENT_PAYLOAD_KEYS = Object.freeze({
  lifecycle: Object.freeze(["status", "reason", "newEpoch"]),
  actionResult: Object.freeze(["actionId", "actorId", "code", "cost", "resourceWritesThisCall"]),
  actionCancel: Object.freeze(["actionId", "actorId", "reason", "replayed"]),
  evidence: Object.freeze(["evidenceId", "targetId", "observedAtTick", "expiresAtTick", "sourceActionId"]),
  device: Object.freeze(["targetId", "stateLabel", "remainingTicks", "code"]),
  downstream: Object.freeze(["targetId", "stateLabel", "effectiveOutput", "bridgePassable"]),
  guard: Object.freeze(["targetId", "hp", "shore", "cost"]),
  run: Object.freeze(["reason", "tick"]),
  snapshot: Object.freeze(["snapshotId", "epoch", "stateHash", "eventsHash"]),
  devFixture: Object.freeze(["fixtureId", "actorId", "tick", "targetId"]),
  denial: Object.freeze(["code", "requestId"])
});
const AI_NATIVE_EVENT_GROUP_V1 = Object.freeze({
  SESSION_CREATED: "lifecycle",
  SESSION_PAUSED: "lifecycle",
  SESSION_RESUMED: "lifecycle",
  SESSION_RESET: "lifecycle",
  SESSION_CLOSED: "lifecycle",
  ACTION_ACCEPTED: "actionResult",
  ACTION_REJECTED: "actionResult",
  ACTION_COMPLETED: "actionResult",
  ACTION_CANCELLED: "actionCancel",
  ACTION_PREEMPTED: "actionCancel",
  ACTION_TIMEOUT: "actionCancel",
  ACTION_REPLAYED: "actionCancel",
  SCAN_EVIDENCE_CREATED: "evidence",
  SCAN_EVIDENCE_EXPIRED: "evidence",
  JAM_APPLIED: "device",
  JAM_EXPIRED: "device",
  DOOR_STATE_CHANGED: "device",
  RELAY_STATE_CHANGED: "downstream",
  BRIDGE_STATE_CHANGED: "downstream",
  GUARD_LINK_CHANGED: "downstream",
  GUARD_HIT: "guard",
  GUARD_CLEARED: "guard",
  PLAYER_RESCUED: "guard",
  PLAYER_DAMAGED: "guard",
  ROOM_ENTERED: "downstream",
  DOOR_PASSED: "device",
  EAST_CROSSED: "downstream",
  RUN_COMPLETED: "run",
  RUN_FAILED: "run",
  SNAPSHOT_SAVED: "snapshot",
  SNAPSHOT_RESTORED: "snapshot",
  REPLAY_STARTED: "snapshot",
  REPLAY_FINISHED: "snapshot",
  DEV_FIXTURE_INJECTED: "devFixture",
  PERMISSION_DENIED: "denial",
  RATE_LIMITED: "denial",
  SCHEMA_REJECTED: "denial"
});
const AI_NATIVE_EVENT_PAYLOAD_KEYS_V1 = EVENT_PAYLOAD_KEYS;
const EVENT_SHAPE = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_EVENT_SCHEMA_V1),
  eventId: EVENT_ID,
  sessionId: SESSION_ID,
  epoch: EPOCH,
  tick: TICK,
  phase: NUM(0, 6),
  ordinal: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  eventSeq: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  actorId: ACTOR_ID,
  actionId: ACTION_ID,
  correlationId: REQUEST_ID,
  type: ENUM(AI_NATIVE_EVENT_TYPES_V1),
  payload: { t: "primitiveRecord" }
}, ["actorId", "actionId", "correlationId"]);
const EVENT = {
  t: "custom",
  name: "event",
  check: (value, path, ctx) => {
    const problem = validateSpec(value, EVENT_SHAPE, path, ctx);
    if (problem) return problem;
    if (!isPlainObject$2(value) || typeof value.type !== "string") return issue("E_SCHEMA", path);
    const group = AI_NATIVE_EVENT_GROUP_V1[value.type];
    const keys = group ? EVENT_PAYLOAD_KEYS[group] : void 0;
    if (!keys || !isPlainObject$2(value.payload)) return issue("E_SCHEMA", `${path}.payload`);
    for (const key of Object.keys(value.payload)) {
      if (!keys.includes(key)) return issue("E_SCHEMA", `${path}.payload.${key}`);
    }
    return null;
  }
};
const OBSERVATION = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_OBSERVATION_SCHEMA_V1),
  sessionId: SESSION_ID,
  epoch: EPOCH,
  tick: TICK,
  actorId: ACTOR_ID,
  role: ROLE,
  detail: ENUM(["summary", "standard"]),
  roomId: ENUM(AI_NATIVE_ROOM_IDS_V1),
  current: CURRENT_FACTS,
  evidence: ARR(OBSERVATION_EVIDENCE),
  knowledge: ARR(JSON_ONLY, 0),
  hypotheses: ARR(JSON_ONLY, 0),
  events: ARR(EVENT, AI_NATIVE_LIMITS_V1.MAX_OBSERVATION_EVENTS),
  availableActions: ARR(ACTION_CAPABILITY),
  omittedFieldCount: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK)
});
const DEBUG_INSPECTION = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DEBUG_SCHEMA_V1),
  sessionId: SESSION_ID,
  epoch: EPOCH,
  tick: TICK,
  actorId: ACTOR_ID,
  role: C("DEVELOPER"),
  fullState: PRIVATE(JSON_ONLY),
  seed: NUM(0, 4294967295, false),
  rngState: { t: "oneOf", variants: [NULL, NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK)] },
  fixtureLog: PRIVATE(ARR(JSON_ONLY)),
  rawEvents: ARR(EVENT),
  hiddenMap: PRIVATE(JSON_ONLY)
}, ["seed", "rngState", "hiddenMap"]);
const ACTION_RESULT = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  sessionId: SESSION_ID,
  epoch: EPOCH,
  tick: TICK,
  actionId: ACTION_ID,
  actorId: ACTOR_ID,
  status: ENUM(AI_NATIVE_ACTION_STATUSES_V1),
  code: { t: "resultCode" },
  cost: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
  resourceWritesThisCall: NUM(0, 1),
  replayed: BOOL,
  durationRemainingTicks: TICK,
  correlationId: REQUEST_ID,
  messageKey: STR(128, SAFE_TOKEN)
}, ["durationRemainingTicks", "correlationId", "messageKey"]);
const RESOURCE_USAGE = OBJ({
  wallMs: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
  ticksAdvanced: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  eventsEmitted: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  peakActionsPerTick: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  droppedEvents: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  truncatedObservation: BOOL
});
const SLICE_STATE = PRIVATE(OBJ({
  schema: C("last_signal_station_zero_vs00_v1"),
  version: C(1),
  roomId: C("station-zero-r1"),
  energy: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
  tick: TICK,
  doorState: ENUM(["SEALED", "JAMMED_OPEN", "OPEN", "CLOSED", "SAFE_PENDING_CLOSE"]),
  manualOpenIntent: BOOL,
  sealSourcePresent: BOOL,
  passed: BOOL,
  position: OBJ({
    x: NUM(-AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, false),
    y: NUM(-AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, false)
  }),
  corridor: OBJ({
    template: JSON_ONLY,
    position: OBJ({
      x: NUM(-AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, false),
      y: NUM(-AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, AI_NATIVE_LIMITS_V1.MAX_COORDINATE_ABS, false)
    }),
    hp: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK, false),
    relayEnabled: BOOL,
    powered: BOOL,
    bridge: ENUM(["STABLE", "UNAVAILABLE"]),
    guardCleared: C(true),
    crossed: BOOL,
    jamRemaining: TICK,
    scanRemaining: TICK,
    reveal: { t: "oneOf", variants: [NULL, OBJ({ relay: BOOL, bridge: BOOL, perceptionPort: BOOL })] }
  }),
  remaining: OBJ({
    jam: TICK,
    jamCooldown: TICK,
    scanCooldown: TICK,
    scanReveal: TICK,
    safeClear: TICK,
    regenAcc: TICK
  })
}, ["corridor"]));
const SNAPSHOT_DEV = OBJ({
  seed: NUM(0, 4294967295, false),
  fixtureLog: PRIVATE(ARR(JSON_ONLY))
}, ["seed", "fixtureLog"]);
const SNAPSHOT = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_SNAPSHOT_SCHEMA_V1),
  kernelVersion: C(AI_NATIVE_KERNEL_VERSION_V1),
  snapshotId: SNAPSHOT_ID,
  sessionId: SESSION_ID,
  sessionKind: ENUM(AI_NATIVE_SESSION_KINDS_V1),
  epoch: EPOCH,
  tick: TICK,
  scenarioId: C(AI_NATIVE_SCENARIO_ID_V1),
  runStatus: ENUM(["active", "finished"]),
  runEndReason: { t: "oneOf", variants: [NULL, ENUM(AI_NATIVE_RUN_END_REASONS_V1)] },
  createdAtMs: MS,
  state: SLICE_STATE,
  observationEvidence: ARR(OBSERVATION_EVIDENCE),
  idempotencyCache: ARR(OBJ({
    actionId: ACTION_ID,
    actorId: ACTOR_ID,
    payloadHash: HASH("fnv1a32"),
    result: ACTION_RESULT
  })),
  eventCursor: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  rngState: NULL,
  snapshotHash: HASH("sha256"),
  dev: SNAPSHOT_DEV
}, ["dev"]);
const REPLAY = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_REPLAY_SCHEMA_V1),
  kernelVersion: C(AI_NATIVE_KERNEL_VERSION_V1),
  sessionId: SESSION_ID,
  sessionKind: ENUM(AI_NATIVE_SESSION_KINDS_V1),
  initialSnapshot: SNAPSHOT,
  actions: ARR(ACTION_REQUEST, AI_NATIVE_LIMITS_V1.MAX_REPLAY_ACTIONS),
  actionResults: ARR(ACTION_RESULT, AI_NATIVE_LIMITS_V1.MAX_REPLAY_ACTIONS),
  events: ARR(EVENT, AI_NATIVE_LIMITS_V1.MAX_EVENT_LOG_EVENTS),
  finalStateHash: HASH("sha256"),
  eventsHash: HASH("sha256"),
  resourceUsage: RESOURCE_USAGE,
  dev: SNAPSHOT_DEV
}, ["dev"]);
const STEP_RESULT = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  sessionId: SESSION_ID,
  epoch: EPOCH,
  fromTick: TICK,
  toTick: TICK,
  status: ENUM(AI_NATIVE_STEP_STATUSES_V1),
  actionResults: ARR(ACTION_RESULT, AI_NATIVE_LIMITS_V1.MAX_ACTIONS_PER_TICK),
  events: ARR(EVENT, AI_NATIVE_LIMITS_V1.MAX_OBSERVATION_EVENTS),
  eventCursor: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  observation: OBSERVATION,
  postStateHash: HASH("sha256"),
  resourceUsage: RESOURCE_USAGE
}, ["observation"]);
const ERROR = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  sessionId: SESSION_ID,
  epoch: EPOCH,
  tick: TICK,
  requestId: REQUEST_ID,
  correlationId: { t: "oneOf", variants: [REQUEST_ID, ACTION_ID] },
  code: { t: "code" },
  messageKey: STR(128, SAFE_TOKEN),
  retryable: BOOL
}, ["sessionId", "epoch", "tick", "requestId", "correlationId"]);
const CREATE_SESSION_REQUEST = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  requestId: REQUEST_ID,
  kind: ENUM(AI_NATIVE_SESSION_KINDS_V1),
  mode: ENUM(AI_NATIVE_MODES_V1),
  scenarioId: C(AI_NATIVE_SCENARIO_ID_V1),
  actorSpecs: ARR(OBJ({
    role: ROLE,
    observationScope: ENUM(["self", "shared"]),
    allowedActions: ARR(ACTION_TYPE)
  })),
  seed: NUM(0, 4294967295, false),
  fixtureRef: STR(128, SAFE_TOKEN),
  resourceLimits: {
    t: "custom",
    name: "tightenOnlyResourceLimits",
    check: (value, path, ctx) => {
      const problem = validateSpec(value, {
        t: "record",
        keyPattern: /^[a-z][A-Za-z]+$/,
        value: NUM(1, AI_NATIVE_LIMITS_V1.MAX_TICK)
      }, path, ctx);
      if (problem) return problem;
      if (!isPlainObject$2(value)) return issue("E_SCHEMA", path);
      const candidates = {
        maxTicksPerStep: AI_NATIVE_LIMITS_V1.MAX_TICKS_PER_STEP,
        maxActionsPerTick: AI_NATIVE_LIMITS_V1.MAX_ACTIONS_PER_TICK,
        maxActiveIntentsPerActor: AI_NATIVE_LIMITS_V1.MAX_ACTIVE_INTENTS_PER_ACTOR,
        maxActionDurationTicks: AI_NATIVE_LIMITS_V1.MAX_ACTION_DURATION_TICKS,
        maxPayloadBytes: AI_NATIVE_LIMITS_V1.MAX_PAYLOAD_BYTES,
        maxObservationEvents: AI_NATIVE_LIMITS_V1.MAX_OBSERVATION_EVENTS,
        maxEventsPerPage: AI_NATIVE_LIMITS_V1.MAX_EVENTS_PER_PAGE,
        maxRequestsPerSecond: AI_NATIVE_LIMITS_V1.MAX_REQUESTS_PER_SECOND,
        maxObservePerSecond: AI_NATIVE_LIMITS_V1.MAX_OBSERVE_PER_SECOND,
        maxStepTicksPerSecond: AI_NATIVE_LIMITS_V1.MAX_STEP_TICKS_PER_SECOND,
        requestTimeoutMs: AI_NATIVE_LIMITS_V1.REQUEST_TIMEOUT_MS,
        heartbeatMs: AI_NATIVE_LIMITS_V1.HEARTBEAT_MS,
        idleTimeoutMs: AI_NATIVE_LIMITS_V1.IDLE_TIMEOUT_MS,
        maxSessionWallMs: AI_NATIVE_LIMITS_V1.MAX_SESSION_WALL_MS
      };
      for (const key of Object.keys(value)) {
        const hard = candidates[key];
        const actual = value[key];
        if (hard === void 0 || typeof actual !== "number" || actual > hard) {
          return issue("E_SCHEMA", `${path}.${key}`);
        }
      }
      return null;
    }
  }
}, ["seed", "fixtureRef", "resourceLimits"]);
const STEP_REQUEST = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  requestId: REQUEST_ID,
  sessionId: SESSION_ID,
  epoch: EPOCH,
  fromTick: TICK,
  ticks: NUM(1, AI_NATIVE_LIMITS_V1.MAX_TICKS_PER_STEP),
  actions: ARR(ACTION_REQUEST, AI_NATIVE_LIMITS_V1.MAX_ACTIONS_PER_TICK),
  includeObservation: BOOL,
  observationDetail: ENUM(["summary", "standard"])
}, ["observationDetail"]);
const SESSION_COMMAND = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  requestId: REQUEST_ID,
  sessionId: SESSION_ID,
  epoch: EPOCH,
  actorId: ACTOR_ID,
  command: ENUM([...AI_NATIVE_SESSION_COMMANDS_V1, "observe", "get_events", "cancel_action", "step"])
});
const CANCEL_ACTION_REQUEST = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  requestId: REQUEST_ID,
  sessionId: SESSION_ID,
  epoch: EPOCH,
  actorId: ACTOR_ID,
  actionId: ACTION_ID,
  reason: ENUM(["client_cancel", "human_takeover", "timeout", "session_close"])
});
const OBSERVE_REQUEST = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  requestId: REQUEST_ID,
  sessionId: SESSION_ID,
  epoch: EPOCH,
  actorId: ACTOR_ID,
  detail: ENUM(["summary", "standard", "debug"])
});
const GET_EVENTS_REQUEST = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  requestId: REQUEST_ID,
  sessionId: SESSION_ID,
  epoch: EPOCH,
  actorId: ACTOR_ID,
  cursor: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  limit: NUM(1, AI_NATIVE_LIMITS_V1.MAX_EVENTS_PER_PAGE)
});
const SIMPLE_REQUEST = OBJ({
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  requestId: REQUEST_ID,
  sessionId: SESSION_ID,
  epoch: EPOCH,
  actorId: ACTOR_ID
});
const RESTORE_REQUEST = OBJ({
  ...SIMPLE_REQUEST_FIELDS(),
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  snapshot: SNAPSHOT
});
function SIMPLE_REQUEST_FIELDS() {
  return { requestId: REQUEST_ID, sessionId: SESSION_ID, epoch: EPOCH, actorId: ACTOR_ID };
}
const REPLAY_REQUEST = OBJ({
  ...SIMPLE_REQUEST_FIELDS(),
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  replay: REPLAY
});
const INJECT_FIXTURE_REQUEST = OBJ({
  ...SIMPLE_REQUEST_FIELDS(),
  ...VERSION_FIELDS(AI_NATIVE_DTO_SCHEMA_V1),
  fixtureId: STR(128, SAFE_TOKEN),
  tick: TICK,
  targetId: TARGET_ID
}, ["targetId"]);
const REQUEST_UNION = {
  t: "oneOf",
  variants: Object.freeze([
    ACTION_REQUEST,
    STEP_REQUEST,
    CREATE_SESSION_REQUEST,
    SESSION_COMMAND,
    CANCEL_ACTION_REQUEST,
    OBSERVE_REQUEST,
    GET_EVENTS_REQUEST,
    SIMPLE_REQUEST,
    RESTORE_REQUEST,
    REPLAY_REQUEST,
    INJECT_FIXTURE_REQUEST
  ])
};
const RESPONSE_UNION = {
  t: "oneOf",
  variants: Object.freeze([STEP_RESULT, OBSERVATION, DEBUG_INSPECTION, ACTION_RESULT, ERROR])
};
OBJ({
  ...VERSION_FIELDS(AI_NATIVE_ENVELOPE_SCHEMA_V1),
  sessionId: SESSION_ID,
  epoch: EPOCH,
  transportSeq: NUM(0, AI_NATIVE_LIMITS_V1.MAX_TICK),
  kind: ENUM(["request", "response", "event"]),
  requestId: REQUEST_ID,
  correlationId: { t: "oneOf", variants: [REQUEST_ID, ACTION_ID] },
  issuedAtMs: MS,
  payload: { t: "oneOf", variants: Object.freeze([REQUEST_UNION, RESPONSE_UNION, EVENT]) }
}, ["requestId", "correlationId"]);
function stepRequestExtras(record) {
  if (!Array.isArray(record.actions)) return issue("E_SCHEMA", "$.actions");
  const fromTick = record.fromTick;
  if (typeof fromTick !== "number") return issue("E_SCHEMA", "$.fromTick");
  for (let index = 0; index < record.actions.length; index += 1) {
    const action = record.actions[index];
    const targetTick = isPlainObject$2(action) ? action.targetTick : void 0;
    if (typeof targetTick !== "number" || !Number.isSafeInteger(targetTick)) {
      return issue("E_SCHEMA", `$.actions[${index}].targetTick`);
    }
    if (targetTick < fromTick + 1) return issue("E_STALE_TICK", `$.actions[${index}].targetTick`);
    if (targetTick > fromTick + 1) return issue("E_FUTURE_TICK", `$.actions[${index}].targetTick`);
  }
  return null;
}
function observationExtras(record) {
  const evidence = record.evidence;
  if (Array.isArray(evidence)) {
    for (let index = 0; index < evidence.length; index += 1) {
      const item = evidence[index];
      if (!isPlainObject$2(item)) return issue("E_SCHEMA", `$.evidence[${index}]`);
      if (typeof item.observedAtTick === "number" && typeof item.expiresAtTick === "number" && item.observedAtTick >= item.expiresAtTick) {
        return issue("E_SCHEMA", `$.evidence[${index}].expiresAtTick`);
      }
    }
  }
  return null;
}
function withExtras(input, spec, schema, extras) {
  const result = runSpec(input, spec, versionGuard(schema));
  if (!result.ok) return result;
  if (extras && isPlainObject$2(input)) {
    const problem = extras(input);
    if (problem) return bad(problem.code, problem.path);
  }
  return result;
}
function validateStepRequestDetailed(input) {
  return withExtras(input, STEP_REQUEST, AI_NATIVE_DTO_SCHEMA_V1, stepRequestExtras);
}
function validateObservationDetailed(input) {
  if (isPlainObject$2(input) && input.detail === "debug") {
    return bad("E_PERMISSION", "$.detail");
  }
  const result = withExtras(input, OBSERVATION, AI_NATIVE_OBSERVATION_SCHEMA_V1, observationExtras);
  if (!result.ok) return result;
  const hidden = hasHiddenField(input, ["role"]);
  if (hidden) return bad("E_SCHEMA", hidden);
  return result;
}
function validateStepResultDetailed(input) {
  return withExtras(input, STEP_RESULT, AI_NATIVE_DTO_SCHEMA_V1);
}
class AiNativeProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AiNativeProtocolError";
    this.code = code;
    Object.freeze(this);
  }
}
function utf8Bytes(text) {
  const bytes = [];
  for (let index = 0; index < text.length; index += 1) {
    let codePoint = text.charCodeAt(index);
    if (codePoint >= 55296 && codePoint <= 56319 && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 56320 && low <= 57343) {
        codePoint = 65536 + (codePoint - 55296 << 10) + (low - 56320);
        index += 1;
      }
    }
    if (codePoint <= 127) bytes.push(codePoint);
    else if (codePoint <= 2047) {
      bytes.push(192 | codePoint >> 6, 128 | codePoint & 63);
    } else if (codePoint <= 65535) {
      bytes.push(224 | codePoint >> 12, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
    } else {
      bytes.push(
        240 | codePoint >> 18,
        128 | codePoint >> 12 & 63,
        128 | codePoint >> 6 & 63,
        128 | codePoint & 63
      );
    }
  }
  return bytes;
}
function compareByCodePoint(left, right) {
  const a = Array.from(left, (char) => char.codePointAt(0) ?? 0);
  const b = Array.from(right, (char) => char.codePointAt(0) ?? 0);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}
function canonicalize(value, path, seen) {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "undefined" || kind === "symbol" || kind === "bigint" || kind === "function") {
    throw new AiNativeProtocolError("E_SCHEMA", `canonicalJson rejected ${kind} at ${path}`);
  }
  if (kind === "number") {
    if (!Number.isFinite(value)) {
      throw new AiNativeProtocolError("E_SCHEMA", `canonicalJson rejected non-finite number at ${path}`);
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (kind === "boolean") return value ? "true" : "false";
  if (kind === "string") return JSON.stringify(value);
  const object = value;
  if (seen.has(object)) throw new AiNativeProtocolError("E_SCHEMA", `canonicalJson rejected cycle at ${path}`);
  if (Array.isArray(object)) {
    seen.add(object);
    const parts = [];
    for (let index = 0; index < object.length; index += 1) {
      if (!(index in object)) {
        throw new AiNativeProtocolError("E_SCHEMA", `canonicalJson rejected sparse array at ${path}[${index}]`);
      }
      parts.push(canonicalize(object[index], `${path}[${index}]`, seen));
    }
    seen.delete(object);
    return `[${parts.join(",")}]`;
  }
  if (!isPlainObject$2(object)) {
    throw new AiNativeProtocolError("E_SCHEMA", `canonicalJson rejected non-plain object at ${path}`);
  }
  const record = object;
  const keys = Reflect.ownKeys(record).filter((key) => {
    if (typeof key !== "string") {
      throw new AiNativeProtocolError("E_SCHEMA", `canonicalJson rejected symbol key at ${path}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new AiNativeProtocolError("E_SCHEMA", `canonicalJson rejected accessor at ${path}.${key}`);
    }
    return true;
  });
  keys.sort(compareByCodePoint);
  seen.add(object);
  const body = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], `${path}.${key}`, seen)}`);
  seen.delete(object);
  return `{${body.join(",")}}`;
}
function canonicalJson(value) {
  return canonicalize(value, "$", /* @__PURE__ */ new WeakSet());
}
function payloadFingerprint(value) {
  const text = canonicalJson(value);
  let hash = 2166136261;
  for (const byte of utf8Bytes(text)) {
    hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}
function isSupportedActionType(value) {
  return typeof value === "string" && AI_NATIVE_ACTION_TYPES_V1.includes(value);
}
const RUNTIME_SCHEMA = "last_signal.ai-native.runtime-snapshot.v1";
const RUNTIME_VERSION = 1;
const RUNTIME_KERNEL_VERSION = "station-zero-r1-r2@1";
const RUNTIME_SCENARIO = "station-zero";
const RUNTIME_SESSION_ID_PREFIX = "ses_";
const RUNTIME_ACTOR_ID_PREFIX = "act_";
function fixedHex(seed, length) {
  let state = seed >>> 0 ^ 2654435769;
  let out = "";
  for (let i = 0; i < length; i += 1) {
    state = Math.imul(state ^ state >>> 15, 739982445) >>> 0;
    out += (state & 15).toString(16);
  }
  return out;
}
function sessionIdForSeed(seed) {
  return `${RUNTIME_SESSION_ID_PREFIX}${fixedHex(seed, 24)}`;
}
function actorIdForSeed(seed) {
  return `${RUNTIME_ACTOR_ID_PREFIX}${fixedHex(seed, 16)}`;
}
const RUNTIME_LIMITS = Object.freeze({
  MAX_TICKS_PER_STEP: 1e3,
  MAX_ACTIONS_PER_STEP: 32,
  MAX_INTENT_TICKS: 3600,
  MAX_TOTAL_TICKS: 1e6,
  MAX_EVENTS: 1e4,
  MAX_ACTION_LOG: 1e4,
  MAX_ISSUED_SNAPSHOTS: 64,
  MAX_TOTAL_REPLAY_TICKS: 1e5,
  TICK_HZ: SLICE.TICK_HZ
});
const OMITTED_INTERNAL_FIELDS = [
  "seed",
  "rngState",
  "actionLog",
  "events",
  "manualOpenIntent",
  "sealSourcePresent",
  "occupancy",
  "pendingSafeClose",
  "regenAcc",
  "accumulatorMs",
  "lastRelayInteractTick",
  "revealDoorReceiver",
  "revealSealSource",
  "corridorReveal",
  "guard.evidence",
  "guard.attackAt",
  "guard.jamUntil",
  "guard.watching",
  "deadline"
];
function isPlainObject$1(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
const ACTION_FIELDS = ["id", "actor", "type", "direction", "ticks", "target"];
const DIRECTIONS = ["up", "down", "left", "right", "north", "south", "east", "west"];
const SUPPORTED = ["move", "scan", "jam", "interact", "shoot_guard", "wait"];
const UNSUPPORTED$1 = /* @__PURE__ */ new Set(["aim", "fire", "decoy"]);
const JAM_TARGETS = /* @__PURE__ */ new Set(["door", "relay", "guard"]);
function failure(code, message) {
  return Object.freeze({ ok: false, code, message });
}
function success(value) {
  return Object.freeze({ ok: true, value });
}
function isFiniteInt$2(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max;
}
function validateRuntimeAction(input, index = 0) {
  if (!isPlainObject$1(input)) return failure("E_SCHEMA", `action[${index}] must be an object`);
  const keys = Object.keys(input);
  if (keys.some((key) => !ACTION_FIELDS.includes(key))) {
    return failure("E_SCHEMA", `action[${index}] has an unknown field`);
  }
  const type = input.type;
  if (typeof type !== "string") return failure("E_SCHEMA", `action[${index}].type must be a string`);
  if (UNSUPPORTED$1.has(type)) {
    return failure("E_NOT_APPLICABLE", `action[${index}] '${type}' is not implemented in Station Zero P0/P1`);
  }
  if (!SUPPORTED.includes(type)) {
    return failure("E_SCHEMA", `action[${index}] has an unknown type`);
  }
  const actor = input.actor ?? "player";
  if (actor !== "player" && actor !== "echo") {
    return failure("E_UNKNOWN_ACTOR", `action[${index}].actor is not registered`);
  }
  const id = input.id ?? `${actor}-${index}`;
  if (typeof id !== "string" || id.length === 0 || id.length > 64) {
    return failure("E_SCHEMA", `action[${index}].id must be a non-empty string <= 64 chars`);
  }
  const actionType = type;
  if (actionType === "move") {
    const direction = input.direction;
    if (typeof direction !== "string" || !DIRECTIONS.includes(direction)) {
      return failure("E_SCHEMA", `action[${index}].direction must be up/down/left/right/north/south/east/west`);
    }
    const ticks = input.ticks;
    if (!isFiniteInt$2(ticks, 1, RUNTIME_LIMITS.MAX_INTENT_TICKS)) {
      return failure("E_SCHEMA", `action[${index}].ticks must be an integer in 1..${RUNTIME_LIMITS.MAX_INTENT_TICKS}`);
    }
    return success({ id, actor, type: actionType, direction, ticks });
  }
  if (actionType === "wait") {
    const ticks = input.ticks ?? 0;
    if (!isFiniteInt$2(ticks, 0, RUNTIME_LIMITS.MAX_INTENT_TICKS)) {
      return failure("E_SCHEMA", `action[${index}].ticks must be an integer in 0..${RUNTIME_LIMITS.MAX_INTENT_TICKS}`);
    }
    return success({ id, actor, type: actionType, ticks });
  }
  if (actionType === "jam") {
    const target = input.target ?? "relay";
    if (typeof target !== "string" || !JAM_TARGETS.has(target)) {
      return failure("E_SCHEMA", `action[${index}].target must be door/relay/guard`);
    }
    return success({ id, actor, type: actionType, target });
  }
  return success({ id, actor, type: actionType });
}
function actorPriority(actor) {
  return actor === "player" ? 0 : 1;
}
function compareActions(a, b, ai, bi) {
  const pa = actorPriority(a.actor);
  const pb = actorPriority(b.actor);
  if (pa !== pb) return pa - pb;
  if (a.actor !== b.actor) return a.actor < b.actor ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return ai - bi;
}
function moveIntent(action) {
  return action.type === "move" && action.direction ? directionToIntent(action.direction) : NO_MOVEMENT;
}
class HeadlessGame {
  constructor(options) {
    this.scenario = RUNTIME_SCENARIO;
    this.mode = "headless";
    this.status = "running";
    this.epoch = 0;
    this.movement = NO_MOVEMENT;
    this.movementRemainingTicks = 0;
    this.events = [];
    this.eventSeq = 0;
    this.droppedEvents = 0;
    this.actionSeq = 0;
    this.actionLog = [];
    this.issuedSnapshots = /* @__PURE__ */ new Map();
    this.snapshotCounter = 0;
    if (!options || options.scenario !== RUNTIME_SCENARIO || options.mode !== "headless") {
      throw new TypeError('createGame requires { scenario:"station-zero", mode:"headless" }');
    }
    if (!isFiniteInt$2(options.seed, 0, 4294967295)) {
      throw new TypeError("seed must be an integer in 0..0xffffffff");
    }
    this.seed = options.seed;
    this.sessionId = sessionIdForSeed(options.seed);
    this.actorId = actorIdForSeed(options.seed);
    this.rng = new RNG(options.seed);
    this.model = new SliceModel();
    this.emit(0, 0, "SESSION_CREATED", { scenario: RUNTIME_SCENARIO, seed: options.seed });
  }
  get tick() {
    return this.model.tick;
  }
  get paused() {
    return this.status === "paused";
  }
  get finished() {
    return this.status === "finished";
  }
  get inCorridor() {
    return this.model.inCorridor;
  }
  get passed() {
    return this.model.snapshot().passed;
  }
  get crossed() {
    return this.model.snapshot().corridor?.crossed ?? false;
  }
  /** Read-only event log accessor (no snapshot issuance). */
  eventLog() {
    return this.events;
  }
  /** Capture complete internal state for an atomic gateway rollback. */
  captureInternalState() {
    return {
      status: this.status,
      epoch: this.epoch,
      movement: { ...this.movement },
      movementRemainingTicks: this.movementRemainingTicks,
      model: this.model.captureFull(),
      events: this.events.map((e) => Object.freeze({ ...e, payload: { ...e.payload } })),
      eventSeq: this.eventSeq,
      droppedEvents: this.droppedEvents,
      actionSeq: this.actionSeq,
      actionLog: this.actionLog.map((a) => ({ ...a })),
      rngState: this.rng.snapshot()
    };
  }
  /** Restore a previously captured internal state WITHOUT changing epoch or issued frames. */
  restoreInternalState(state) {
    const candidate = new SliceModel();
    candidate.restoreFull(state.model);
    this.model.dispose();
    this.model = candidate;
    this.status = state.status;
    this.epoch = state.epoch;
    this.movement = { ...state.movement };
    this.movementRemainingTicks = state.movementRemainingTicks;
    this.events = state.events.map((e) => Object.freeze({ ...e, payload: { ...e.payload } }));
    this.eventSeq = state.eventSeq;
    this.droppedEvents = state.droppedEvents;
    this.actionSeq = state.actionSeq;
    this.actionLog = state.actionLog.map((a) => ({ ...a }));
    this.rng.restore(state.rngState);
  }
  /** Canonical projection identical to canonicalState(snapshot()) but without snapshot issuance. */
  canonicalStateInternal() {
    const { accumulatorMs, lastResult, ...authoritativeModel } = this.model.captureFull();
    return canonicalJson({
      schema: RUNTIME_SCHEMA,
      protocolVersion: RUNTIME_VERSION,
      kernelVersion: RUNTIME_KERNEL_VERSION,
      scenario: RUNTIME_SCENARIO,
      sessionId: this.sessionId,
      seed: this.seed,
      rngState: this.rng.snapshot(),
      status: this.status,
      tick: this.model.tick,
      movement: { intent: { ...this.movement }, remainingTicks: this.movementRemainingTicks },
      model: authoritativeModel
    });
  }
  /** Dispose the underlying model (gateway boundary cleanup). */
  dispose() {
    this.model.dispose();
  }
  pause() {
    if (this.status === "finished") return failure("E_PAUSED", "run is already finished");
    this.status = "paused";
    this.model.setPaused(true);
    this.emit(this.model.tick, 0, "SESSION_PAUSED", { status: "paused" });
    return success({ status: this.status });
  }
  resume() {
    if (this.status === "finished") return failure("E_PAUSED", "run is already finished");
    this.status = "running";
    this.model.setPaused(false);
    this.emit(this.model.tick, 0, "SESSION_RESUMED", { status: "running" });
    return success({ status: this.status });
  }
  /**
   * Apply actions (deterministically ordered) then advance exactly `ticks`
   * fixed logic ticks. No wall-clock delta is consulted.
   */
  step(options) {
    if (this.status === "paused") return failure("E_PAUSED", "session is paused");
    if (this.status === "finished") return failure("E_PAUSED", "run is finished; reset required");
    if (!isPlainObject$1(options)) return failure("E_SCHEMA", "step options must be an object");
    if (!isFiniteInt$2(options.ticks, 1, RUNTIME_LIMITS.MAX_TICKS_PER_STEP)) {
      return failure("E_RESOURCE_LIMIT", `ticks must be an integer in 1..${RUNTIME_LIMITS.MAX_TICKS_PER_STEP}`);
    }
    if (this.model.tick + options.ticks > RUNTIME_LIMITS.MAX_TOTAL_TICKS) {
      return failure("E_RESOURCE_LIMIT", "total tick budget exceeded");
    }
    const rawActions = options.actions ?? [];
    if (!Array.isArray(rawActions)) return failure("E_SCHEMA", "actions must be an array");
    if (rawActions.length > RUNTIME_LIMITS.MAX_ACTIONS_PER_STEP) {
      return failure("E_RESOURCE_LIMIT", `at most ${RUNTIME_LIMITS.MAX_ACTIONS_PER_STEP} actions per step`);
    }
    const validated = [];
    for (let i = 0; i < rawActions.length; i += 1) {
      const parsed = validateRuntimeAction(rawActions[i], i);
      if (!parsed.ok) return parsed;
      validated.push({ action: parsed.value, index: i });
    }
    validated.sort((a, b) => compareActions(a.action, b.action, a.index, b.index));
    const firstEventIndex = this.events.length;
    const actionResults = [];
    const identity = options.identity;
    for (const { action } of validated) {
      const result = this.applyAction(action, identity);
      actionResults.push(result);
      this.emit(this.model.tick, 2, result.code === "OK" ? "ACTION_ACCEPTED" : "ACTION_REJECTED", {
        actionId: action.id,
        actor: action.actor,
        type: action.type,
        code: result.code,
        cost: result.cost
      });
    }
    let advanced = 0;
    for (let i = 0; i < options.ticks; i += 1) {
      if (this.finished) break;
      const beforeEvidence = new Set(this.model.evidenceSnapshot.map((e) => e.targetId));
      let transitions = {
        passedDoor: false,
        enteredCorridor: false,
        crossedEast: false,
        failed: false
      };
      this.model.advanceTicks(1, () => {
        if (this.movementRemainingTicks > 0) {
          stepMovement(this.model, this.movement);
          this.movementRemainingTicks -= 1;
          if (this.movementRemainingTicks === 0) this.movement = NO_MOVEMENT;
        }
      }, (before) => {
        transitions = resolveTransitions(this.model, before);
        this.emitTickChanges(
          before,
          beforeEvidence,
          transitions.passedDoor,
          transitions.enteredCorridor,
          transitions.crossedEast,
          transitions.failed
        );
      });
      advanced += 1;
      if (this.model.failed) {
        this.finish("RUN_FAILED", "died");
        break;
      }
      if (transitions.crossedEast) {
        this.finish("RUN_COMPLETED", "completed");
        break;
      }
    }
    const newEvents = this.events.slice(firstEventIndex);
    return success({
      tick: this.model.tick,
      advanced,
      actionResults: Object.freeze(actionResults.slice()),
      events: Object.freeze(newEvents),
      status: this.status,
      droppedEvents: this.droppedEvents
    });
  }
  /** Full internal state (dev/test boundary); never returned by observe(). */
  getState() {
    return this.snapshot();
  }
  /**
   * PUBLIC observation: a P0 `ObservationV1` whitelist projection. It passes
   * `validateObservationDetailed()` and contains NO Guard FSM `behavior`, raw
   * `reveal`/`corridorReveal`, hidden timers, seed/RNG or undiscovered targets.
   * `visibleTargets` is derived only from legally observed Scan evidence;
   * `availableActions` comes from the model's current-state capability query,
   * not a fixed "always legal" list; `completed` excludes failed runs.
   */
  observe(identity) {
    const actorId2 = identity?.actorId ?? this.actorId;
    const sceneEpoch = identity?.epoch ?? this.epoch;
    const snapshot = this.model.snapshot();
    const corridor = snapshot.corridor;
    const roomId = corridor ? "station-zero-r2" : "station-zero-r1";
    const observed = this.model.evidenceSnapshot;
    const targetKind = {
      tgt_lab_door_receiver: "receiver",
      tgt_lab_seal_source: "source",
      tgt_corridor_relay: "relay",
      tgt_corridor_bridge: "bridge",
      tgt_corridor_guard: "guard"
    };
    const evidenceIdOf = (targetId, at) => `ev_${fixedHex((hashString(targetId) ^ at) >>> 0, 16)}`;
    const sourceActionIdOf = (targetId, at) => `aid_${fixedHex(hashString(`${targetId}|${at}`) >>> 0, 24)}`;
    const evidence = observed.map((item) => ({
      schema: AI_NATIVE_OBSERVATION_SCHEMA_V1,
      protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      evidenceId: evidenceIdOf(item.targetId, item.observedAtTick),
      sceneEpoch: item.sceneEpoch ?? sceneEpoch,
      roomId: item.roomId,
      sourceActionId: item.sourceActionId ?? sourceActionIdOf(item.targetId, item.observedAtTick),
      source: "player-scan",
      observerActorId: item.observerActorId ?? actorId2,
      observerPosition: { x: item.position.x, y: item.position.y },
      targetId: item.targetId,
      ...item.relationId ? { relationId: item.relationId } : {},
      observedAtTick: item.observedAtTick,
      expiresAtTick: item.expiresAtTick,
      observedState: Object.freeze({ stateLabel: item.stateLabel })
    }));
    const visibleTargets = observed.map((item) => ({
      targetId: item.targetId,
      kind: targetKind[item.targetId] ?? "receiver",
      publicState: item.stateLabel,
      visibility: "scan-revealed"
    }));
    const knownConnections = [];
    const labLink = observed.find((e) => e.relationId === "rel_lab_seal_link");
    if (labLink) knownConnections.push({
      relationId: "rel_lab_seal_link",
      fromTargetId: "tgt_lab_seal_source",
      toTargetId: "tgt_lab_door_receiver",
      stateLabel: "link-visible",
      evidenceId: evidenceIdOf(labLink.targetId, labLink.observedAtTick)
    });
    const relationTargets = {
      rel_corridor_relay_bridge: { from: "tgt_corridor_relay" },
      rel_corridor_relay_perception: { from: "tgt_corridor_relay" }
    };
    for (const item of observed) {
      if (!item.relationId) continue;
      const mapping = relationTargets[item.relationId];
      if (!mapping) continue;
      if (knownConnections.some((c) => c.relationId === item.relationId)) continue;
      knownConnections.push({
        relationId: item.relationId,
        fromTargetId: mapping.from,
        toTargetId: item.targetId,
        stateLabel: "link-visible",
        evidenceId: evidenceIdOf(item.targetId, item.observedAtTick)
      });
    }
    const availableActions = this.model.actionAvailability().map((a) => ({
      type: a.type,
      status: a.status,
      ...a.reasonCode ? { reasonCode: a.reasonCode } : {}
    }));
    const device = {
      door: snapshot.doorState,
      doorPassable: snapshot.doorPassable
    };
    const timers = {
      scanCooldownTicks: snapshot.scanCooldownTicks,
      jamCooldownTicks: snapshot.jamCooldownTicks,
      scanRevealRemainingTicks: snapshot.scanRevealTicks,
      jamRemainingTicks: snapshot.jamRemainingTicks,
      safeClearRemainingTicks: snapshot.safeClearTicks
    };
    if (corridor) {
      device.relay = corridor.relay;
      device.effectiveOutput = corridor.effectiveOutput;
      device.bridge = corridor.bridge;
      device.bridgePassable = corridor.bridgePassable;
      device.guardLink = corridor.guard.link;
      device.guardHp = corridor.guardHp;
      device.canInteract = corridor.canInteract;
      timers.guardJamRemainingTicks = corridor.guard.jamRemainingTicks;
      timers.bridgeRemainingTicks = corridor.bridgeRemainingTicks;
    }
    const terminal = [...this.events].reverse().find((e) => e.type === "RUN_COMPLETED" || e.type === "RUN_FAILED");
    const failed = this.model.failed || terminal?.type === "RUN_FAILED";
    const self = {
      position: { x: this.model.position.x, y: this.model.position.y },
      energy: snapshot.energy,
      ...corridor ? { hp: corridor.hp, maxHp: 100 } : {},
      alive: corridor ? corridor.hp > 0 : !failed,
      paused: snapshot.paused,
      passed: snapshot.passed,
      crossed: corridor?.crossed ?? false,
      failed,
      completed: terminal?.type === "RUN_COMPLETED" && !failed
    };
    return Object.freeze({
      schema: AI_NATIVE_OBSERVATION_SCHEMA_V1,
      protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      epoch: sceneEpoch,
      tick: snapshot.tick,
      actorId: actorId2,
      role: "PLAYER",
      detail: "standard",
      roomId,
      current: {
        self,
        publicDeviceState: device,
        publicTimers: timers,
        visibleTargets,
        knownConnections
      },
      evidence,
      knowledge: [],
      hypotheses: [],
      events: [],
      availableActions,
      omittedFieldCount: OMITTED_INTERNAL_FIELDS.length
    });
  }
  /**
   * Full internal snapshot (private/test/dev only). Every call ISSUES a new
   * bounded private handle and records a canonical fingerprint of the complete
   * authoritative payload (including `model.position`, `accumulatorMs`,
   * `lastResult`, events and actionLog). `restore` requires that exact issued
   * payload; a modified frame is rejected even if its public hashes are
   * recomputed.
   */
  snapshot() {
    const snapshotId = this.nextSnapshotId();
    const frame = {
      schema: RUNTIME_SCHEMA,
      protocolVersion: RUNTIME_VERSION,
      kernelVersion: RUNTIME_KERNEL_VERSION,
      scenario: RUNTIME_SCENARIO,
      snapshotId,
      sessionId: this.sessionId,
      seed: this.seed,
      rngState: this.rng.snapshot(),
      status: this.status,
      epoch: this.epoch,
      tick: this.model.tick,
      movement: { intent: { ...this.movement }, remainingTicks: this.movementRemainingTicks },
      model: this.model.captureFull(),
      events: this.events.slice(),
      eventSeq: this.eventSeq,
      droppedEvents: this.droppedEvents,
      actionSeq: this.actionSeq,
      actionLog: this.actionLog.slice()
    };
    this.issuedSnapshots.set(snapshotId, snapshotIdentity(frame));
    while (this.issuedSnapshots.size > RUNTIME_LIMITS.MAX_ISSUED_SNAPSHOTS) {
      const oldest = this.issuedSnapshots.keys().next().value;
      if (oldest === void 0) break;
      this.issuedSnapshots.delete(oldest);
    }
    return frame;
  }
  nextSnapshotId() {
    const counter = this.snapshotCounter;
    this.snapshotCounter += 1;
    return `snap_${fixedHex(this.seed, 8)}${counter.toString(36)}`;
  }
  /**
   * Restore a snapshot that THIS instance issued. ATOMIC: the frame is fully
   * validated into a candidate model before any state is replaced. Requires
   * the private issued handle plus an exact canonical match of the complete
   * authoritative payload, so changing even a legal ground coordinate (or
   * recomputing the public hash) is rejected. No scan, no TTL extension,
   * no cross-session / cross-seed writes.
   */
  restore(input) {
    return this.restoreFrame(input, true);
  }
  restoreFrame(input, requireIssued) {
    const problem = validateRestoreFrame(input, this.seed, this.sessionId, this.rng.snapshot());
    if (problem) return failure("E_SNAPSHOT_INVALID", problem);
    const frame = input;
    if (requireIssued) {
      const issued = this.issuedProblem(frame);
      if (issued) return failure("E_SNAPSHOT_INVALID", issued);
    }
    const candidate = new SliceModel();
    candidate.restoreFull(frame.model);
    this.model.dispose();
    this.model = candidate;
    this.status = frame.status;
    this.epoch = frame.epoch + 1;
    this.movement = { ...frame.movement.intent };
    this.movementRemainingTicks = frame.movement.remainingTicks;
    this.events = frame.events.map((event) => Object.freeze({ ...event, payload: { ...event.payload } }));
    this.eventSeq = frame.eventSeq;
    this.droppedEvents = frame.droppedEvents;
    this.actionSeq = frame.actionSeq;
    this.actionLog = frame.actionLog.map((action) => ({ ...action }));
    this.rng.restore(frame.rngState);
    return success({ tick: this.model.tick, status: this.status, epoch: this.epoch });
  }
  /** Private issuance check: exact handle + exact complete payload. */
  issuedProblem(frame) {
    const expected = this.issuedSnapshots.get(frame.snapshotId);
    if (expected === void 0) {
      return `snapshot was not issued by this instance or was evicted (max ${RUNTIME_LIMITS.MAX_ISSUED_SNAPSHOTS})`;
    }
    if (expected !== snapshotIdentity(frame)) {
      return "snapshot content does not match the issued frame";
    }
    return null;
  }
  /**
   * Deterministic replay: restore the snapshot into a fresh instance and apply
   * the same ordered steps. `steps` MUST be an array (no silent [] fallback).
   * A zero-step replay reproduces the source canonical state exactly.
   */
  replay(input, steps) {
    if (!Array.isArray(steps)) return failure("E_SCHEMA", "replay steps must be an array");
    if (steps.length > RUNTIME_LIMITS.MAX_TICKS_PER_STEP) {
      return failure("E_RESOURCE_LIMIT", "too many replay steps");
    }
    let totalTicks = 0;
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (!isPlainObject$1(step)) return failure("E_SCHEMA", `steps[${i}] must be an object`);
      if (step.actions !== void 0 && !Array.isArray(step.actions)) {
        return failure("E_SCHEMA", `steps[${i}].actions must be an array`);
      }
      if (!isFiniteInt$2(step.ticks, 1, RUNTIME_LIMITS.MAX_TICKS_PER_STEP)) {
        return failure("E_SCHEMA", `steps[${i}].ticks is out of range`);
      }
      totalTicks += step.ticks;
    }
    if (totalTicks > RUNTIME_LIMITS.MAX_TOTAL_REPLAY_TICKS) {
      return failure("E_RESOURCE_LIMIT", "replay total tick budget exceeded");
    }
    if (!isRuntimeSnapshot(input)) return failure("E_SNAPSHOT_INVALID", "snapshot shape is invalid");
    const issued = this.issuedProblem(input);
    if (issued) return failure("E_SNAPSHOT_INVALID", issued);
    const game = new HeadlessGame({ scenario: RUNTIME_SCENARIO, seed: input.seed, mode: "headless" });
    const restored = game.restoreFrame(input, false);
    if (!restored.ok) return restored;
    for (const step of steps) {
      const outcome = game.step({ actions: step.actions, ticks: step.ticks });
      if (!outcome.ok) return outcome;
    }
    const snapshot = game.snapshot();
    return success({
      snapshot,
      canonicalState: canonicalState(snapshot),
      canonicalEvents: canonicalEvents(snapshot)
    });
  }
  /** Internal test-only teleport. NEVER exposed as an action or via the CLI. */
  __testSetPosition(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError("position must be finite");
    this.model.setPlayerPos(x, y);
  }
  applyAction(action, identity) {
    let result;
    if (action.type === "move") {
      this.movement = moveIntent(action);
      this.movementRemainingTicks = action.ticks ?? 0;
      result = { code: "OK", message: "move intent registered", cost: 0 };
    } else if (action.type === "wait") {
      this.movement = NO_MOVEMENT;
      this.movementRemainingTicks = 0;
      result = { code: "OK", message: "wait", cost: 0 };
    } else if (action.type === "scan") {
      const bare = action.id.startsWith("player-") ? action.id.slice("player-".length) : action.id;
      const sourceActionId = /^aid_[0-9a-f]{24}$/.test(bare) ? bare : void 0;
      const provenance = {
        ...sourceActionId ? { sourceActionId } : {},
        ...identity?.actorId !== void 0 ? { observerActorId: identity.actorId } : {},
        ...identity?.epoch !== void 0 ? { sceneEpoch: identity.epoch } : {}
      };
      result = this.model.scan(Object.keys(provenance).length > 0 ? provenance : void 0);
    } else if (action.type === "jam") {
      result = action.target === "guard" ? this.model.jam("guard") : this.model.jam("relay");
    } else if (action.type === "interact") {
      result = this.model.interact();
    } else {
      result = this.model.shootGuard();
    }
    this.actionSeq += 1;
    this.actionLog.push({
      id: action.id,
      actor: action.actor,
      type: action.type,
      ...action.direction ? { direction: action.direction } : {},
      ...action.ticks !== void 0 ? { ticks: action.ticks } : {},
      ...action.target ? { target: action.target } : {}
    });
    return { id: action.id, actor: action.actor, type: action.type, code: result.code, cost: result.cost };
  }
  emitTickChanges(before, beforeEvidence, passedDoor, enteredCorridor, crossedEast, failed) {
    const after = this.model.snapshot();
    const tick = after.tick;
    if (enteredCorridor) this.emit(tick, 0, "ROOM_ENTERED", { roomId: "station-zero-r2" });
    if (passedDoor) this.emit(tick, 0, "DOOR_PASSED", { roomId: "station-zero-r1" });
    if (before.jamActive && !after.jamActive) this.emit(tick, 4, "JAM_EXPIRED", {});
    if (!before.jamActive && after.jamActive) this.emit(tick, 4, "JAM_APPLIED", { remainingTicks: after.jamRemainingTicks });
    if (before.doorState !== after.doorState) {
      this.emit(tick, 4, "DOOR_STATE_CHANGED", { stateLabel: after.doorState });
    }
    const bc = before.corridor;
    const ac = after.corridor;
    if (ac) {
      if (!bc || bc.relay !== ac.relay) this.emit(tick, 4, "RELAY_STATE_CHANGED", { stateLabel: ac.relay });
      if (!bc || bc.bridge !== ac.bridge) this.emit(tick, 4, "BRIDGE_STATE_CHANGED", { stateLabel: ac.bridge });
      if (!bc || bc.guard.link !== ac.guard.link) this.emit(tick, 4, "GUARD_LINK_CHANGED", { stateLabel: ac.guard.link });
      if (bc && ac.guardHp < bc.guardHp) {
        this.emit(tick, 4, "GUARD_HIT", { hp: ac.guardHp });
        if (ac.guardHp === 0) this.emit(tick, 4, "GUARD_CLEARED", {});
      }
      if (ac.hp < (bc?.hp ?? ac.hp)) this.emit(tick, 4, "PLAYER_DAMAGED", { hp: ac.hp });
    }
    if (crossedEast) this.emit(tick, 0, "EAST_CROSSED", { roomId: "station-zero-r2" });
    const afterEvidence = this.model.evidenceSnapshot;
    for (const item of afterEvidence) {
      if (!beforeEvidence.has(item.targetId)) {
        this.emit(tick, 5, "SCAN_EVIDENCE_CREATED", {
          targetId: item.targetId,
          observedAtTick: item.observedAtTick,
          expiresAtTick: item.expiresAtTick
        });
      }
    }
    if (afterEvidence.length === 0 && beforeEvidence.size > 0) {
      this.emit(tick, 5, "SCAN_EVIDENCE_EXPIRED", {});
    }
  }
  finish(type, reason) {
    if (this.status === "finished") return;
    this.status = "finished";
    this.emit(this.model.tick, 0, type, { reason });
  }
  availableActions() {
    const actions = ["move", "scan", "wait", "jam", "interact"];
    if (this.model.inCorridor) actions.push("shoot_guard");
    return actions;
  }
  emit(tick, phase, type, payload2) {
    let ordinal = 0;
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const event2 = this.events[i];
      if (event2.tick !== tick || event2.phase !== phase) break;
      ordinal = event2.ordinal + 1;
      break;
    }
    const event = Object.freeze({
      eventSeq: this.eventSeq,
      tick,
      phase,
      ordinal,
      type,
      payload: Object.freeze({ ...payload2 })
    });
    this.eventSeq += 1;
    this.events.push(event);
    if (this.events.length > RUNTIME_LIMITS.MAX_EVENTS) {
      this.events.shift();
      this.droppedEvents += 1;
    }
  }
}
function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  }
  return hash >>> 0;
}
function canonicalState(snapshot) {
  const { accumulatorMs, lastResult, ...authoritativeModel } = snapshot.model;
  return canonicalJson({
    schema: snapshot.schema,
    protocolVersion: snapshot.protocolVersion,
    kernelVersion: snapshot.kernelVersion,
    scenario: snapshot.scenario,
    sessionId: snapshot.sessionId,
    seed: snapshot.seed,
    rngState: snapshot.rngState,
    status: snapshot.status,
    tick: snapshot.tick,
    movement: snapshot.movement,
    model: authoritativeModel
  });
}
function snapshotIdentity(frame) {
  const { stateHash, eventsHash, ...rest } = frame;
  return canonicalJson(rest);
}
function canonicalEvents(snapshot) {
  return canonicalJson(snapshot.events);
}
function withHashes(snapshot, hasher) {
  return Object.freeze({
    ...snapshot,
    stateHash: hasher(canonicalState(snapshot)),
    eventsHash: hasher(canonicalEvents(snapshot))
  });
}
const SNAPSHOT_KEYS = [
  "schema",
  "protocolVersion",
  "kernelVersion",
  "scenario",
  "snapshotId",
  "sessionId",
  "seed",
  "rngState",
  "status",
  "epoch",
  "tick",
  "movement",
  "model",
  "events",
  "eventSeq",
  "droppedEvents",
  "actionSeq",
  "actionLog",
  "stateHash",
  "eventsHash"
];
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SESSION_PATTERN = /^ses_[0-9a-f]{24}$/;
const SNAPSHOT_ID_PATTERN = /^snap_[a-z0-9]{1,64}$/;
const EVENT_KEYS = ["eventSeq", "tick", "phase", "ordinal", "type", "payload"];
function isFiniteNumber$1(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
function validateFullSliceRanges(model) {
  const ranges = [
    ["energy", model.energy, 0, 100],
    ["tick", model.tick, 0, RUNTIME_LIMITS.MAX_TOTAL_TICKS],
    ["jamRemainingTicks", model.jamRemainingTicks, 0, SLICE.JAM_DURATION_TICKS],
    ["jamCooldownTicks", model.jamCooldownTicks, 0, SLICE.JAM_CD_TICKS],
    ["scanCooldownTicks", model.scanCooldownTicks, 0, SLICE.SCAN_CD_TICKS],
    ["scanRevealTicks", model.scanRevealTicks, 0, SLICE.SCAN_REVEAL_TICKS],
    ["safeClearTicks", model.safeClearTicks, 0, SLICE.SAFE_CLEAR_DELAY_TICKS],
    ["regenAcc", model.regenAcc, 0, SLICE.REGEN_TICKS - 1],
    ["accumulatorMs", model.accumulatorMs, 0, SLICE.MAX_FRAME_DELTA_MS]
  ];
  for (const [name, value, lo, hi] of ranges) {
    if (!isFiniteNumber$1(value, lo, hi)) return `model.${name} out of range`;
  }
  if (!isFiniteInt$2(model.lastRelayInteractTick, -1, RUNTIME_LIMITS.MAX_TOTAL_TICKS)) {
    return "model.lastRelayInteractTick out of range";
  }
  if (!Number.isFinite(model.playerX) || !Number.isFinite(model.playerY)) return "model position not finite";
  for (const evidence of model.evidence) {
    if (evidence.observedAtTick > model.tick || model.tick >= evidence.expiresAtTick) {
      return "model evidence outside TTL window";
    }
  }
  if (model.scanRevealTicks === 0 && model.evidence.length > 0) return "active evidence without reveal TTL";
  if (model.scanRevealTicks > 0 && model.evidence.length === 0) return "reveal TTL without evidence";
  if (model.corridor) {
    const c = model.corridor;
    if (!isFiniteNumber$1(c.health, 0, 100) || !isFiniteNumber$1(c.deadline, 0, Number.MAX_SAFE_INTEGER) || !isFiniteNumber$1(c.nextShotTick, 0, Number.MAX_SAFE_INTEGER)) return "corridor numbers out of range";
    if (!isFiniteNumber$1(c.guard.health, 0, 1e3) || !isFiniteNumber$1(c.guard.jamUntil, 0, Number.MAX_SAFE_INTEGER) || !isFiniteNumber$1(c.guard.attackAt, 0, Number.MAX_SAFE_INTEGER)) return "guard numbers out of range";
    if (!isFiniteNumber$1(c.location.x, -1e6, 1e6) || !isFiniteNumber$1(c.location.y, -1e6, 1e6) || !isFiniteNumber$1(c.guard.location.x, -1e6, 1e6) || !isFiniteNumber$1(c.guard.location.y, -1e6, 1e6)) {
      return "corridor position out of range";
    }
    const bridgePassable = c.bridge === "STABLE" || c.bridge === "UNSTABLE";
    if (!canStandInCorridor(c.location.x, c.location.y, bridgePassable)) return "corridor position not standable";
    if (!canStandInCorridor(c.guard.location.x, c.guard.location.y, false)) return "guard position not standable";
    if (!model.passed) return "corridor present without passed door";
  } else {
    const doorPassable = model.jamRemainingTicks > 0 || model.door === "JAMMED_OPEN" || model.door === "OPEN" || model.door === "SAFE_PENDING_CLOSE";
    if (!canFit(model.playerX, model.playerY, (cx, cy) => isWalkableCell(cx, cy, doorPassable))) {
      return "lab position not standable";
    }
    if (model.occupancy !== isOccupyingDoor(model.playerX, model.playerY)) return "lab occupancy inconsistent";
  }
  return null;
}
function isRuntimeSnapshot(value) {
  if (!isPlainObject$1(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => !SNAPSHOT_KEYS.includes(key))) return false;
  const required = SNAPSHOT_KEYS.filter((k) => k !== "stateHash" && k !== "eventsHash");
  if (required.some((k) => !Object.prototype.hasOwnProperty.call(value, k))) return false;
  if (value.schema !== RUNTIME_SCHEMA || value.protocolVersion !== RUNTIME_VERSION || value.kernelVersion !== RUNTIME_KERNEL_VERSION || value.scenario !== RUNTIME_SCENARIO) return false;
  if (typeof value.snapshotId !== "string" || !SNAPSHOT_ID_PATTERN.test(value.snapshotId)) return false;
  if (typeof value.sessionId !== "string" || !SESSION_PATTERN.test(value.sessionId)) return false;
  if (!isFiniteInt$2(value.seed, 0, 4294967295) || !isFiniteInt$2(value.rngState, 0, 4294967295)) return false;
  if (value.status !== "running" && value.status !== "paused" && value.status !== "finished") return false;
  if (!isFiniteInt$2(value.epoch, 0, Number.MAX_SAFE_INTEGER) || !isFiniteInt$2(value.tick, 0, RUNTIME_LIMITS.MAX_TOTAL_TICKS)) return false;
  if (value.stateHash !== void 0 && (typeof value.stateHash !== "string" || !HASH_PATTERN.test(value.stateHash))) return false;
  if (value.eventsHash !== void 0 && (typeof value.eventsHash !== "string" || !HASH_PATTERN.test(value.eventsHash))) return false;
  if (!isFullSliceState(value.model)) return false;
  if (validateFullSliceRanges(value.model)) return false;
  if (value.model.tick !== value.tick) return false;
  if (value.model.paused !== (value.status === "paused")) return false;
  const movement = value.movement;
  if (!isPlainObject$1(movement) || !isFiniteInt$2(movement.remainingTicks, 0, RUNTIME_LIMITS.MAX_INTENT_TICKS)) return false;
  const intent = movement.intent;
  if (!isPlainObject$1(intent) || !["up", "down", "left", "right"].every((k) => typeof intent[k] === "boolean")) return false;
  if (!Array.isArray(value.events) || value.events.length > RUNTIME_LIMITS.MAX_EVENTS) return false;
  if (!Array.isArray(value.actionLog) || value.actionLog.length > RUNTIME_LIMITS.MAX_ACTION_LOG) return false;
  if (!isFiniteInt$2(value.eventSeq, 0, Number.MAX_SAFE_INTEGER) || !isFiniteInt$2(value.droppedEvents, 0, Number.MAX_SAFE_INTEGER) || !isFiniteInt$2(value.actionSeq, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (value.actionSeq !== value.actionLog.length) return false;
  if (value.eventSeq !== value.events.length + value.droppedEvents) return false;
  let previousEventSeq = -1;
  let lastTick = -1;
  let lastPhase = -1;
  let expectedOrdinal = 0;
  for (let i = 0; i < value.events.length; i += 1) {
    const event = value.events[i];
    if (!isPlainObject$1(event) || Object.keys(event).length !== EVENT_KEYS.length || EVENT_KEYS.some((k) => !Object.prototype.hasOwnProperty.call(event, k))) return false;
    if (!isFiniteInt$2(event.eventSeq, 0, Number.MAX_SAFE_INTEGER) || !isFiniteInt$2(event.tick, 0, RUNTIME_LIMITS.MAX_TOTAL_TICKS) || !isFiniteInt$2(event.phase, 0, 6) || !isFiniteInt$2(event.ordinal, 0, Number.MAX_SAFE_INTEGER)) return false;
    if (typeof event.type !== "string" || !isPlainObject$1(event.payload)) return false;
    if (i > 0 && event.eventSeq !== previousEventSeq + 1) return false;
    if (event.tick < lastTick) return false;
    if (event.tick === lastTick && event.phase === lastPhase) {
      if (event.ordinal !== expectedOrdinal) return false;
      expectedOrdinal += 1;
    } else {
      if (event.ordinal !== 0) return false;
      lastTick = event.tick;
      lastPhase = event.phase;
      expectedOrdinal = 1;
    }
    previousEventSeq = event.eventSeq;
    for (const payloadValue of Object.values(event.payload)) {
      if (payloadValue === null) continue;
      if (typeof payloadValue === "number" && !Number.isFinite(payloadValue)) return false;
      if (typeof payloadValue !== "string" && typeof payloadValue !== "number" && typeof payloadValue !== "boolean") return false;
    }
  }
  if (value.events.length > 0 && value.events[value.events.length - 1].eventSeq !== value.eventSeq - 1) return false;
  for (let i = 0; i < value.actionLog.length; i += 1) {
    if (!validateRuntimeAction(value.actionLog[i], i).ok) return false;
  }
  return true;
}
function validateRestoreFrame(value, seed, sessionId, rngState) {
  if (!isRuntimeSnapshot(value)) return "snapshot shape is invalid";
  if (value.seed !== seed) return "snapshot source seed mismatch";
  if (value.sessionId !== sessionId) return "snapshot source session mismatch";
  if (value.rngState !== rngState) return "snapshot rng/source state mismatch";
  if (value.status === "finished" && !value.events.some((event) => event.type === "RUN_COMPLETED" || event.type === "RUN_FAILED")) {
    return "finished status without a terminal event";
  }
  if (value.model.passed && !value.events.some((event) => event.type === "DOOR_PASSED" && event.tick <= value.tick)) {
    return "passed flag set but no DOOR_PASSED event is bound to this frame";
  }
  return null;
}
function createGame(options) {
  return new HeadlessGame(options);
}
const HARD_MAX_SESSIONS = 10;
const HARD_MAX_CONCURRENT_STEPS = 2;
const BATCH_TICKS = 25;
const MAX_IDEMPOTENCY_ENTRIES = 1024;
const MAX_REQUEST_CACHE$1 = 256;
const MAX_CANCELLED_IDS = 256;
const ADVANCED_ID = /^aid_[0-9a-f]{24}$/;
const ACTION_FP_FIELDS = ["actorId", "epoch", "type", "payload"];
function hexChars$1(bytes) {
  return randomBytes(bytes).toString("hex");
}
function sha256(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}
function defaultSeed() {
  return randomInt(0, 4294967295) >>> 0;
}
function now() {
  return Date.now();
}
function isFiniteInt$1(value, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max;
}
function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
class SessionError extends Error {
  constructor(code, message, messageKey) {
    super(message);
    this.code = code;
    this.messageKey = messageKey;
    this.name = "SessionError";
  }
}
function makeError(code, messageKey, opts = {}) {
  return Object.freeze({
    schema: AI_NATIVE_DTO_SCHEMA_V1,
    protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
    ...opts.sessionId ? { sessionId: opts.sessionId } : {},
    ...opts.epoch !== void 0 ? { epoch: opts.epoch } : {},
    ...opts.tick !== void 0 ? { tick: opts.tick } : {},
    ...opts.requestId ? { requestId: opts.requestId } : {},
    ...opts.correlationId ? { correlationId: opts.correlationId } : {},
    code,
    messageKey,
    retryable: code === "E_RETRYABLE" || code === "E_RATE_LIMIT"
  });
}
function createProcessSessionBudget(max = 10) {
  let used = 0;
  return {
    max,
    get used() {
      return used;
    },
    tryAcquire() {
      if (used >= max) return false;
      used += 1;
      return true;
    },
    release() {
      if (used > 0) used -= 1;
    }
  };
}
function applyFixtureToModel(fixture, model) {
  const inCorridor = model.corridor !== null;
  const bad2 = (code, messageKey) => ({ ok: false, code, messageKey });
  if (fixture.kind === "named") {
    switch (fixture.name) {
      case "lab_near_door":
        if (inCorridor) return bad2("E_ILLEGAL_TARGET", "lab fixture requires the laboratory");
        model.playerX = 6.5;
        model.playerY = 5.5;
        model.occupancy = isOccupyingDoor(6.5, 5.5);
        return { ok: true };
      case "lab_low_energy":
        if (inCorridor) return bad2("E_ILLEGAL_TARGET", "lab fixture requires the laboratory");
        model.energy = 10;
        return { ok: true };
      case "corridor_ready": {
        if (!model.corridor) return bad2("E_ILLEGAL_TARGET", "corridor fixture requires the corridor");
        const c = model.corridor;
        c.guard.health = 0;
        c.guard.evidence = null;
        c.guard.jamUntil = 0;
        c.guard.attackAt = 0;
        c.guard.watching = false;
        c.manualEnabled = true;
        c.powered = true;
        c.relay = "ACTIVE";
        c.bridge = "STABLE";
        c.deadline = 0;
        c.disposed = false;
        return { ok: true };
      }
      case "corridor_guard_low_hp":
        if (!model.corridor) return bad2("E_ILLEGAL_TARGET", "corridor fixture requires the corridor");
        model.corridor.guard.health = 1;
        return { ok: true };
      default:
        return bad2("E_SCHEMA", "unknown named fixture");
    }
  }
  if (fixture.kind === "player") {
    if (fixture.x !== void 0 || fixture.y !== void 0) {
      if (typeof fixture.x !== "number" || typeof fixture.y !== "number" || !Number.isFinite(fixture.x) || !Number.isFinite(fixture.y)) return bad2("E_SCHEMA", "player position must be finite");
      if (inCorridor) {
        model.corridor.location = { x: fixture.x, y: fixture.y };
      } else {
        model.playerX = fixture.x;
        model.playerY = fixture.y;
        model.occupancy = isOccupyingDoor(fixture.x, fixture.y);
      }
    }
    if (fixture.energy !== void 0) {
      if (!isFiniteInt$1(fixture.energy, 0, 100)) return bad2("E_SCHEMA", "energy must be an integer 0..100");
      model.energy = fixture.energy;
    }
    if (fixture.hp !== void 0) {
      if (!inCorridor) return bad2("E_ILLEGAL_TARGET", "hp fixture requires the corridor");
      if (!isFiniteInt$1(fixture.hp, 0, 100)) return bad2("E_SCHEMA", "hp must be an integer 0..100");
      model.corridor.health = fixture.hp;
    }
    return { ok: true };
  }
  if (fixture.kind === "door") {
    const states = ["SEALED", "JAMMED_OPEN", "OPEN", "CLOSED", "SAFE_PENDING_CLOSE"];
    if (!states.includes(fixture.state)) return bad2("E_SCHEMA", "door state invalid");
    model.door = fixture.state;
    if (fixture.jamTicks !== void 0) {
      if (!isFiniteInt$1(fixture.jamTicks, 0, SLICE.JAM_DURATION_TICKS)) return bad2("E_SCHEMA", "jamTicks out of range");
      model.jamRemainingTicks = fixture.jamTicks;
    }
    return { ok: true };
  }
  if (fixture.kind === "guard") {
    if (!model.corridor) return bad2("E_ILLEGAL_TARGET", "guard fixture requires the corridor");
    const g = model.corridor.guard;
    if (fixture.hp !== void 0) {
      if (!isFiniteInt$1(fixture.hp, 0, 1e3)) return bad2("E_SCHEMA", "guard hp must be an integer 0..1000");
      g.health = fixture.hp;
      if (fixture.hp === 0) {
        g.evidence = null;
        g.jamUntil = 0;
        g.attackAt = 0;
        g.watching = false;
      }
    }
    if (fixture.jamTicks !== void 0) {
      if (!isFiniteInt$1(fixture.jamTicks, 0, SLICE.JAM_DURATION_TICKS)) return bad2("E_SCHEMA", "jamTicks out of range");
      g.jamUntil = fixture.jamTicks === 0 ? 0 : model.tick + fixture.jamTicks;
      g.attackAt = 0;
      g.watching = false;
    }
    if (fixture.x !== void 0 || fixture.y !== void 0) {
      if (typeof fixture.x !== "number" || typeof fixture.y !== "number" || !Number.isFinite(fixture.x) || !Number.isFinite(fixture.y)) return bad2("E_SCHEMA", "guard position must be finite");
      g.location = { x: fixture.x, y: fixture.y };
    }
    return { ok: true };
  }
  if (fixture.kind === "relay") {
    if (!model.corridor) return bad2("E_ILLEGAL_TARGET", "relay fixture requires the corridor");
    const c = model.corridor;
    if (fixture.enabled !== void 0) {
      if (typeof fixture.enabled !== "boolean") return bad2("E_SCHEMA", "relay enabled must be boolean");
      c.manualEnabled = fixture.enabled;
    }
    if (fixture.powered !== void 0) {
      if (typeof fixture.powered !== "boolean") return bad2("E_SCHEMA", "relay powered must be boolean");
      c.powered = fixture.powered;
    }
    if (fixture.bridge !== void 0) {
      if (fixture.bridge !== "UNAVAILABLE" && fixture.bridge !== "STABLE") return bad2("E_SCHEMA", "bridge fixture must be UNAVAILABLE or STABLE");
      c.bridge = fixture.bridge;
      c.deadline = 0;
    }
    c.relay = c.manualEnabled && c.powered ? "ACTIVE" : "INACTIVE";
    c.disposed = false;
    return { ok: true };
  }
  return bad2("E_SCHEMA", "unknown fixture kind");
}
function actionFingerprint(action) {
  const record = {};
  for (const field of ACTION_FP_FIELDS) record[field] = action[field];
  return payloadFingerprint(record);
}
function createSessionManager(options = {}) {
  return new SessionManager(options);
}
const MANAGER_NUMERIC_KEYS = [
  "maxSessions",
  "maxConcurrentSteps",
  "idleTimeoutMs",
  "maxSessionWallMs",
  "maxTicksPerStep",
  "maxActionsPerStep",
  "maxObservationEvents",
  "maxEventsPerPage",
  "maxSnapshotBytes",
  "maxActionDurationTicks"
];
const MANAGER_FN_KEYS = ["clock", "seedProvider", "hasher"];
function validateManagerOptions(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new SessionError("E_SCHEMA", "session manager options must be an object", "schema");
  }
  const allowed = /* @__PURE__ */ new Set([...MANAGER_NUMERIC_KEYS, ...MANAGER_FN_KEYS, "budget"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new SessionError("E_SCHEMA", `unknown session manager option: ${key}`, "schema");
  }
  for (const key of MANAGER_NUMERIC_KEYS) {
    const value = options[key];
    if (value === void 0) continue;
    if (!isFiniteInt$1(value, 1)) throw new SessionError("E_SCHEMA", `${key} must be a finite positive integer`, "schema");
  }
  for (const key of MANAGER_FN_KEYS) {
    const value = options[key];
    if (value !== void 0 && typeof value !== "function") throw new SessionError("E_SCHEMA", `${key} must be a function`, "schema");
  }
  const opts = options;
  if ((opts.maxSessions ?? 10) > HARD_MAX_SESSIONS) {
    throw new SessionError("E_RESOURCE_LIMIT", `maxSessions exceeds hard cap ${HARD_MAX_SESSIONS}`, "resource_limit");
  }
  if ((opts.maxConcurrentSteps ?? 2) > HARD_MAX_CONCURRENT_STEPS) {
    throw new SessionError("E_RESOURCE_LIMIT", `maxConcurrentSteps exceeds hard cap ${HARD_MAX_CONCURRENT_STEPS}`, "resource_limit");
  }
}
class SessionManager {
  constructor(options = {}) {
    this.sessions = /* @__PURE__ */ new Map();
    this.usedIds = /* @__PURE__ */ new Set();
    this.concurrentSteps = 0;
    this.disposed = false;
    validateManagerOptions(options);
    this.maxSessions = options.maxSessions ?? 10;
    this.maxConcurrentSteps = options.maxConcurrentSteps ?? 2;
    this.idleTimeoutMs = options.idleTimeoutMs ?? AI_NATIVE_LIMITS_V1.IDLE_TIMEOUT_MS;
    this.maxSessionWallMs = options.maxSessionWallMs ?? AI_NATIVE_LIMITS_V1.MAX_SESSION_WALL_MS;
    this.maxTicksPerStep = options.maxTicksPerStep ?? AI_NATIVE_LIMITS_V1.MAX_TICKS_PER_STEP;
    this.maxActionsPerStep = options.maxActionsPerStep ?? AI_NATIVE_LIMITS_V1.MAX_ACTIONS_PER_TICK;
    this.maxObservationEvents = options.maxObservationEvents ?? AI_NATIVE_LIMITS_V1.MAX_OBSERVATION_EVENTS;
    this.maxEventsPerPage = options.maxEventsPerPage ?? AI_NATIVE_LIMITS_V1.MAX_EVENTS_PER_PAGE;
    this.maxSnapshotBytes = options.maxSnapshotBytes ?? AI_NATIVE_LIMITS_V1.MAX_SNAPSHOT_BYTES;
    this.maxActionDurationTicks = options.maxActionDurationTicks ?? AI_NATIVE_LIMITS_V1.MAX_ACTION_DURATION_TICKS;
    this.clock = options.clock ?? now;
    this.seedProvider = options.seedProvider ?? defaultSeed;
    this.hasher = options.hasher ?? sha256;
    this.budget = options.budget ?? createProcessSessionBudget(this.maxSessions);
  }
  get size() {
    return this.sessions.size;
  }
  get(id) {
    return this.sessions.get(id);
  }
  /** Trusted owner capability for lifecycle control (human/Gateway only). */
  createOwnerHandle(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.ownerHandle() : null;
  }
  newSessionId() {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const id = `ses_${hexChars$1(12)}`;
      if (!this.usedIds.has(id) && !this.sessions.has(id)) {
        this.usedIds.add(id);
        return id;
      }
    }
    throw new SessionError("E_INTERNAL_TRANSACTION", "could not allocate a unique session id", "internal");
  }
  createProductionSession(options = {}) {
    if (this.disposed) throw new SessionError("E_SESSION_CLOSED", "manager disposed", "session_closed");
    const session = this.createSessionInternal(options.resourceLimits, "production", this.seedProvider(), false);
    session.startIdleWatcher();
    return session.playerHandle();
  }
  createTestSession(options) {
    if (this.disposed) throw new SessionError("E_SESSION_CLOSED", "manager disposed", "session_closed");
    if (!isFiniteInt$1(options.seed, 0, 4294967295)) throw new SessionError("E_SCHEMA", "test seed must be an integer in 0..0xffffffff", "schema");
    const session = this.createSessionInternal(options.resourceLimits, "test", options.seed, false);
    session.startIdleWatcher();
    return session.testHandle();
  }
  createCompanionSession(options = {}) {
    if (this.disposed) throw new SessionError("E_SESSION_CLOSED", "manager disposed", "session_closed");
    const session = this.createSessionInternal(options.resourceLimits, "production", this.seedProvider(), true);
    session.startIdleWatcher();
    return session.companionHandle();
  }
  /**
   * Single creation path for every session kind. The shared process budget is
   * taken BEFORE the session is constructed and released again if construction
   * fails, so a failed create never consumes a slot.
   */
  createSessionInternal(resourceLimits, kind = "production", seed, companion = false) {
    if (!this.budget.tryAcquire()) {
      throw new SessionError("E_RESOURCE_LIMIT", "process session budget exhausted", "resource_limit");
    }
    try {
      const session = new Session(this, {
        id: this.newSessionId(),
        kind,
        role: companion ? "COMPANION" : "PLAYER",
        seed: seed ?? this.seedProvider(),
        resourceLimits,
        clock: this.clock,
        hasher: this.hasher,
        idleTimeoutMs: this.idleTimeoutMs,
        maxSessionWallMs: this.maxSessionWallMs,
        companion
      });
      this.register(session);
      return session;
    } catch (error) {
      this.budget.release();
      throw error;
    }
  }
  register(session) {
    if (this.sessions.has(session.id)) {
      throw new SessionError("E_INTERNAL_TRANSACTION", "session id collision", "internal");
    }
    this.sessions.set(session.id, session);
  }
  dispose() {
    this.disposed = true;
    for (const session of [...this.sessions.values()]) session.forceClose();
    this.sessions.clear();
    this.usedIds.clear();
  }
  acquireStepSlot() {
    if (this.concurrentSteps >= this.maxConcurrentSteps) return false;
    this.concurrentSteps += 1;
    return true;
  }
  releaseStepSlot() {
    this.concurrentSteps = Math.max(0, this.concurrentSteps - 1);
  }
  remove(id) {
    if (this.sessions.delete(id)) this.budget.release();
  }
}
class Session {
  constructor(manager, init) {
    this.mode = "headless";
    this.game = null;
    this.status = "created";
    this.epoch = 0;
    this.generation = 0;
    this.runId = `run_${hexChars$1(8)}`;
    this.runEndReason = null;
    this.events = [];
    this.eventSeq = 0;
    this.lastGameEventSeq = -1;
    this.droppedEvents = 0;
    this.devTampered = false;
    this.fixtureLog = [];
    this.idempotency = /* @__PURE__ */ new Map();
    this.requestCache = /* @__PURE__ */ new Map();
    this.aborts = /* @__PURE__ */ new Map();
    this.advancedInFlight = /* @__PURE__ */ new Set();
    this.cancelledIds = /* @__PURE__ */ new Map();
    this.idleTimer = null;
    this.wallTimer = null;
    this.timers = /* @__PURE__ */ new Set();
    this.manager = manager;
    this.id = init.id;
    this.kind = init.kind;
    this.role = init.role;
    this.isCompanion = init.companion === true;
    this.clock = init.clock;
    this.hasher = init.hasher;
    this.idleTimeoutMs = init.idleTimeoutMs;
    this.maxSessionWallMs = init.maxSessionWallMs;
    this.resourceLimits = sanitizeLimits(init.resourceLimits);
    this.createdAtMs = this.clock();
    this.lastActivityMs = this.createdAtMs;
    this.actorId = `act_${deriveActorHex(init.seed)}`;
    this.game = this.isCompanion ? null : createGame({ scenario: "station-zero", seed: init.seed, mode: "headless" });
  }
  // --- lifecycle (owner/player split) --------------------------------------
  start() {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.status === "created") {
      this.status = "running";
      this.syncEvents();
      this.touch();
    }
    return this.ok(this.descriptor());
  }
  pause() {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.status !== "running") return this.fail("E_PAUSED", "session not running", { sessionId: this.id, epoch: this.epoch });
    const r = this.game.pause();
    if (!r.ok) return this.fail("E_PAUSED", "cannot pause", { sessionId: this.id, epoch: this.epoch });
    this.cancelAllAdvanced();
    this.status = "paused";
    this.syncEvents();
    this.touch();
    return this.ok(this.descriptor());
  }
  resume() {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.status !== "paused") return this.fail("E_PAUSED", "session not paused", { sessionId: this.id, epoch: this.epoch });
    const r = this.game.resume();
    if (!r.ok) return this.fail("E_PAUSED", "cannot resume", { sessionId: this.id, epoch: this.epoch });
    this.status = "running";
    this.syncEvents();
    this.touch();
    return this.ok(this.descriptor());
  }
  /** Trusted owner only: death/new-run = new runId + new epoch + R0. */
  reset() {
    if (this.closedOrDisposed()) return this.closedError();
    this.cancelAllAdvanced();
    this.generation += 1;
    if (this.game) this.game.dispose();
    this.game = createGame({ scenario: "station-zero", seed: this.seedOf(), mode: "headless" });
    this.epoch += 1;
    this.status = "running";
    this.runId = `run_${hexChars$1(8)}`;
    this.runEndReason = null;
    this.events = [];
    this.eventSeq = 0;
    this.lastGameEventSeq = -1;
    this.droppedEvents = 0;
    this.idempotency.clear();
    this.requestCache.clear();
    this.emit("SESSION_RESET", {});
    this.syncEvents();
    this.touch();
    return this.ok(this.descriptor());
  }
  close() {
    if (this.status === "closed") return this.ok({ sessionId: this.id });
    this.cancelAllAdvanced();
    this.forceClose();
    return this.ok({ sessionId: this.id });
  }
  // --- step ----------------------------------------------------------------
  step(request) {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.isCompanion) return this.fail("E_NOT_APPLICABLE", "companion has no ECHO entity in P0", { sessionId: this.id, epoch: this.epoch });
    const parsed = validateStepRequestDetailed(request);
    if (!parsed.ok) {
      return this.fail(parsed.issue.code, "step request rejected", { sessionId: this.id, epoch: this.epoch });
    }
    const v = parsed.value;
    if (v.sessionId !== this.id) {
      return this.fail("E_SESSION_NOT_FOUND", "step request session does not match this session", { sessionId: this.id, epoch: this.epoch });
    }
    if (v.epoch !== this.epoch) {
      return this.fail("E_STALE_EPOCH", "epoch does not match active session", { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
    const requestFp = payloadFingerprint(v);
    const cachedRequest = this.requestCache.get(v.requestId);
    if (cachedRequest) {
      if (cachedRequest.fingerprint === requestFp) return cachedRequest.response;
      return this.fail("E_ID_PAYLOAD_MISMATCH", "same requestId reused with a different request", {
        sessionId: this.id,
        epoch: this.epoch,
        requestId: v.requestId
      });
    }
    if (this.status === "created") return this.fail("E_PAUSED", "session not started", { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    if (this.status === "paused") return this.fail("E_PAUSED", "session is paused", { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    if (this.status === "finished") return this.fail("E_PAUSED", "run finished; reset required", { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    const currentTick = this.game.tick;
    if (v.fromTick !== currentTick) {
      const code = v.fromTick < currentTick ? "E_STALE_TICK" : "E_FUTURE_TICK";
      return this.fail(code, "fromTick does not match the authoritative tick", { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
    if (v.actions.length > this.manager.maxActionsPerStep) {
      return this.fail("E_RESOURCE_LIMIT", "too many actions per step", { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
    if (v.ticks > this.manager.maxTicksPerStep) {
      return this.fail("E_RESOURCE_LIMIT", "ticks exceed step budget", { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
    if (!this.manager.acquireStepSlot()) {
      return this.fail("E_RESOURCE_LIMIT", "concurrent step limit reached", { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
    try {
      const result = this.executeStep(v);
      this.cacheRequest(v.requestId, requestFp, result);
      return result;
    } finally {
      this.manager.releaseStepSlot();
    }
  }
  /**
   * Transactional step: capture a NON-issuing internal rollback state, commit,
   * then validate the outbound StepResult. Any validation failure or thrown
   * dependency (e.g. a bad hasher) atomically restores the game and all
   * session-derived state, without changing the epoch or evicting issued
   * frames. The sanitized failure is returned (never a fake success) and is
   * cached per requestId by `step`.
   */
  executeStep(v) {
    const rollback = this.captureRollback();
    try {
      const result = this.commitStep(v);
      if (!result.ok) this.applyRollback(rollback);
      return result;
    } catch {
      this.safeRollback(rollback);
      return this.fail("E_INTERNAL_TRANSACTION", "step result invalid", { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
  }
  commitStep(v) {
    const startedAt = this.clock();
    const fromTick = this.game.tick;
    const currentTick = fromTick;
    const actionResults = new Array(v.actions.length);
    const executable = [];
    const duplicates = [];
    const seen = /* @__PURE__ */ new Map();
    for (let i = 0; i < v.actions.length; i += 1) {
      const action = v.actions[i];
      const fingerprint = actionFingerprint(action);
      const cached = this.idempotency.get(action.actionId);
      if (cached) {
        actionResults[i] = cached.fingerprint === fingerprint ? { ...cached.result, replayed: true, resourceWritesThisCall: 0 } : this.rejected(action.actionId, action.actorId, "E_ID_PAYLOAD_MISMATCH", "same action id reused with different execution semantics");
        continue;
      }
      const batchSeen = seen.get(action.actionId);
      if (batchSeen) {
        actionResults[i] = batchSeen.fingerprint === fingerprint ? void 0 : this.rejected(action.actionId, action.actorId, "E_ID_PAYLOAD_MISMATCH", "same action id reused with different execution semantics");
        if (batchSeen.fingerprint === fingerprint) duplicates.push({ index: i, actionId: action.actionId });
        continue;
      }
      seen.set(action.actionId, { fingerprint, index: i });
      if (action.sessionId !== this.id) {
        this.rejectAction(actionResults, i, action, fingerprint, "E_SESSION_NOT_FOUND", "action session does not match");
        continue;
      }
      if (action.epoch !== this.epoch) {
        this.rejectAction(actionResults, i, action, fingerprint, "E_STALE_EPOCH", "action epoch is stale");
        continue;
      }
      if (action.actorId !== this.actorId) {
        this.rejectAction(actionResults, i, action, fingerprint, "E_UNKNOWN_ACTOR", "actor not registered in this session");
        continue;
      }
      if (!this.allowedActions.includes(action.type)) {
        this.rejectAction(actionResults, i, action, fingerprint, "E_PERMISSION", "actor not permitted this action");
        continue;
      }
      const adapted = adaptAction(action, currentTick, this.allowedActions);
      if (!adapted.ok) {
        this.rejectAction(actionResults, i, action, fingerprint, adapted.error.code, adapted.error.messageKey);
        continue;
      }
      executable.push({ runtime: adapted.value, index: i, actionId: action.actionId, fingerprint });
    }
    const runResult = this.game.step({
      actions: executable.map((e) => e.runtime),
      ticks: v.ticks,
      identity: { actorId: this.actorId, epoch: v.epoch }
    });
    if (!runResult.ok) {
      return this.fail("E_INTERNAL_TRANSACTION", "step failed", { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
    this.syncEvents();
    this.touch();
    const byRuntimeId = /* @__PURE__ */ new Map();
    for (const rr of runResult.value.actionResults) byRuntimeId.set(rr.id, rr);
    for (const exec of executable) {
      const rr = byRuntimeId.get(exec.runtime.id);
      const result2 = rr ? {
        schema: AI_NATIVE_DTO_SCHEMA_V1,
        protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
        sessionId: this.id,
        epoch: this.epoch,
        tick: this.game.tick,
        actionId: exec.actionId,
        actorId: this.actorId,
        status: rr.code === "OK" ? "completed" : "rejected",
        code: rr.code,
        cost: rr.cost,
        resourceWritesThisCall: rr.code === "OK" && rr.cost > 0 ? 1 : 0,
        replayed: false,
        correlationId: v.requestId
      } : this.rejected(exec.actionId, this.actorId, "E_INTERNAL_TRANSACTION", "action result missing");
      actionResults[exec.index] = result2;
      this.cacheAction(exec.actionId, exec.fingerprint, result2);
    }
    for (const dup of duplicates) {
      const first = this.idempotency.get(dup.actionId);
      actionResults[dup.index] = first ? { ...first.result, replayed: true, resourceWritesThisCall: 0 } : this.rejected(dup.actionId, this.actorId, "E_INTERNAL_TRANSACTION", "missing replay receipt");
    }
    const toTick = this.game.tick;
    if (this.game.finished) {
      this.status = "finished";
      const terminal = [...this.events].reverse().find((e) => e.type === "RUN_COMPLETED" || e.type === "RUN_FAILED");
      this.runEndReason = terminal?.type === "RUN_COMPLETED" ? "completed" : "died";
    }
    const page = this.pageEvents(0, this.manager.maxObservationEvents);
    const observation = v.includeObservation ? this.buildObservation(v.observationDetail ?? "standard", page.events) : void 0;
    const stepStatus = this.status === "finished" ? "finished" : "completed";
    const finalResults = actionResults.map((r, i) => r ?? this.rejected(v.actions[i].actionId, this.actorId, "E_INTERNAL_TRANSACTION", "missing action result"));
    const result = {
      schema: AI_NATIVE_DTO_SCHEMA_V1,
      protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      sessionId: this.id,
      epoch: this.epoch,
      fromTick,
      toTick,
      status: stepStatus,
      actionResults: finalResults,
      events: page.events,
      eventCursor: page.nextCursor,
      ...observation ? { observation } : {},
      postStateHash: this.hasher(this.game.canonicalStateInternal()),
      resourceUsage: {
        wallMs: this.clock() - startedAt,
        ticksAdvanced: runResult.value.advanced,
        eventsEmitted: runResult.value.events.length,
        peakActionsPerTick: executable.length,
        droppedEvents: this.droppedEvents,
        truncatedObservation: page.truncated
      }
    };
    const validated = validateStepResultDetailed(result);
    if (!validated.ok) {
      return this.fail("E_INTERNAL_TRANSACTION", "step result invalid", { sessionId: this.id, epoch: this.epoch, requestId: v.requestId });
    }
    return this.ok(result);
  }
  rejectAction(results, index, action, fingerprint, code, messageKey) {
    const result = this.rejected(action.actionId, action.actorId, code, messageKey);
    results[index] = result;
    this.cacheAction(action.actionId, fingerprint, result);
  }
  cacheAction(actionId2, fingerprint, result) {
    this.idempotency.set(actionId2, { fingerprint, result });
    while (this.idempotency.size > MAX_IDEMPOTENCY_ENTRIES) {
      const oldest = this.idempotency.keys().next().value;
      if (oldest === void 0) break;
      this.idempotency.delete(oldest);
    }
  }
  cacheRequest(requestId, fingerprint, response) {
    this.requestCache.set(requestId, { fingerprint, response });
    while (this.requestCache.size > MAX_REQUEST_CACHE$1) {
      const oldest = this.requestCache.keys().next().value;
      if (oldest === void 0) break;
      this.requestCache.delete(oldest);
    }
  }
  /** Capture everything a step can mutate, without issuing a snapshot. */
  captureRollback() {
    return {
      game: this.game.captureInternalState(),
      status: this.status,
      runEndReason: this.runEndReason,
      events: this.events.slice(),
      eventSeq: this.eventSeq,
      lastGameEventSeq: this.lastGameEventSeq,
      droppedEvents: this.droppedEvents,
      idempotency: new Map(this.idempotency)
    };
  }
  /** Atomic restore of game + session-derived state; no epoch change, no issuance. */
  applyRollback(rollback) {
    this.game.restoreInternalState(rollback.game);
    this.status = rollback.status;
    this.runEndReason = rollback.runEndReason;
    this.events = rollback.events;
    this.eventSeq = rollback.eventSeq;
    this.lastGameEventSeq = rollback.lastGameEventSeq;
    this.droppedEvents = rollback.droppedEvents;
    this.idempotency.clear();
    for (const [actionId2, entry] of rollback.idempotency) this.idempotency.set(actionId2, entry);
  }
  safeRollback(rollback) {
    try {
      this.applyRollback(rollback);
    } catch {
    }
  }
  // --- observation / events ------------------------------------------------
  observe(detail = "standard") {
    if (this.closedOrDisposed()) return this.closedError();
    if (detail === "debug") {
      return this.fail("E_PERMISSION", "debug observation is dev-only", { sessionId: this.id, epoch: this.epoch });
    }
    if (this.isCompanion) return this.fail("E_NOT_APPLICABLE", "companion has no observation scope in P0", { sessionId: this.id, epoch: this.epoch });
    const page = this.pageEvents(0, this.manager.maxObservationEvents);
    const obs = this.buildObservation(detail, detail === "standard" ? page.events : []);
    const validated = validateObservationDetailed(obs);
    if (!validated.ok) {
      return this.fail(validated.issue.code, "observation invalid", { sessionId: this.id, epoch: this.epoch });
    }
    if (hasHiddenField(obs, ["role"]) !== null) {
      return this.fail("E_INTERNAL_TRANSACTION", "observation leaked a hidden field", { sessionId: this.id, epoch: this.epoch });
    }
    this.touch();
    return this.ok(obs);
  }
  getEvents(cursor, limit) {
    if (this.closedOrDisposed()) return this.closedError();
    const safeCursor = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
    const safeLimit = Math.min(Math.max(1, limit | 0), this.manager.maxEventsPerPage);
    const page = this.pageEvents(safeCursor, safeLimit);
    this.touch();
    return this.ok(page);
  }
  // --- bounded advanced actions -------------------------------------------
  moveTo(target, opts = {}) {
    return this.startAdvanced("move_to", opts, async (abort, bound) => {
      let guard = 0;
      while (!abort.aborted && this.isBound(bound) && guard < 4096) {
        guard += 1;
        const pos = this.currentPosition();
        if (!pos) return "stop";
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return "stop";
        const dir = Math.abs(dx) >= Math.abs(dy) ? dx > 0 ? "east" : "west" : dy > 0 ? "south" : "north";
        const ran = await this.execBatch([{ type: "move", direction: dir, ticks: BATCH_TICKS }], BATCH_TICKS, abort, bound);
        if (!ran) return "stop";
        const after = this.currentPosition();
        if (after && Math.abs(after.x - pos.x) < 0.01 && Math.abs(after.y - pos.y) < 0.01) return "blocked";
      }
      return "stop";
    });
  }
  approach(targetId, opts = {}) {
    const target = this.visibleTargetPosition(targetId);
    if (!target) {
      const id = opts.actionId ?? `aid_${hexChars$1(12)}`;
      return immediateAdvanced(id, this.fail("E_ILLEGAL_TARGET", "target not visible", { sessionId: this.id, epoch: this.epoch }));
    }
    return this.moveTo(target, opts);
  }
  scanTarget(opts = {}) {
    return this.startAdvanced("scan_target", opts, async (abort, bound) => {
      const ran = await this.execBatch([{ type: "scan" }], 1, abort, bound);
      return ran ? "stop" : "stop";
    });
  }
  interactWith(targetId, opts = {}) {
    if (!this.visibleTargetPosition(targetId)) {
      const id = opts.actionId ?? `aid_${hexChars$1(12)}`;
      return immediateAdvanced(id, this.fail("E_ILLEGAL_TARGET", "target not visible", { sessionId: this.id, epoch: this.epoch }));
    }
    return this.startAdvanced("interact_with", opts, async (abort, bound) => {
      const ran = await this.execBatch([{ type: "interact" }], 1, abort, bound);
      return ran ? "stop" : "stop";
    });
  }
  waitUntil(opts = {}) {
    const until = opts.until;
    return this.startAdvanced("wait_until", opts, async (abort, bound) => {
      const ran = await this.execBatch([{ type: "wait", ticks: BATCH_TICKS }], BATCH_TICKS, abort, bound);
      if (!ran) return "stop";
      if (until === "finished" && this.game?.finished) return "stop";
      if (until === "passed" && this.game?.passed) return "stop";
      if (until === "crossed" && this.game?.crossed) return "stop";
      return "continue";
    });
  }
  cancelAction(actionId2, _reason = "client_cancel") {
    if (this.closedOrDisposed()) return this.closedError();
    if (typeof actionId2 !== "string" || !ADVANCED_ID.test(actionId2)) {
      return this.fail("E_SCHEMA", "actionId must match aid_<24hex>", { sessionId: this.id, epoch: this.epoch });
    }
    const entry = this.aborts.get(actionId2);
    if (entry) {
      entry.aborted = true;
      this.rememberCancelled(actionId2);
      return this.ok({ actionId: actionId2 });
    }
    if (this.cancelledIds.has(actionId2)) return this.ok({ actionId: actionId2 });
    return this.fail("E_NOT_APPLICABLE", "no in-flight action with this id", { sessionId: this.id, epoch: this.epoch, correlationId: actionId2 });
  }
  startAdvanced(type, opts, body) {
    const actionId2 = opts.actionId ?? `aid_${hexChars$1(12)}`;
    if (typeof actionId2 !== "string" || !ADVANCED_ID.test(actionId2)) {
      return immediateAdvanced(`aid_${hexChars$1(12)}`, this.fail("E_SCHEMA", "advanced actionId invalid", { sessionId: this.id, epoch: this.epoch }));
    }
    if (this.closedOrDisposed()) return immediateAdvanced(actionId2, this.closedError());
    if (this.status === "created") return immediateAdvanced(actionId2, this.fail("E_PAUSED", "session not started", { sessionId: this.id, epoch: this.epoch }));
    if (this.status === "paused") return immediateAdvanced(actionId2, this.fail("E_PAUSED", "session paused", { sessionId: this.id, epoch: this.epoch }));
    if (this.status === "finished") return immediateAdvanced(actionId2, this.fail("E_PAUSED", "run finished", { sessionId: this.id, epoch: this.epoch }));
    if (!this.allowedActions.includes("move") && type !== "scan_target" && type !== "interact_with") {
      return immediateAdvanced(actionId2, this.fail("E_NOT_APPLICABLE", `${type} unsupported`, { sessionId: this.id, epoch: this.epoch }));
    }
    if (this.advancedInFlight.size > 0) {
      return immediateAdvanced(actionId2, this.fail("E_RETRYABLE", "another advanced action is already in flight", { sessionId: this.id, epoch: this.epoch }));
    }
    const abort = { aborted: false };
    const bound = { game: this.game, runId: this.runId, epoch: this.epoch, generation: this.generation };
    this.aborts.set(actionId2, abort);
    this.advancedInFlight.add(actionId2);
    const maxTicks = Math.min(opts.maxTicks ?? this.resourceLimits.maxActionDurationTicks, this.resourceLimits.maxActionDurationTicks);
    const maxWallMs = opts.maxWallMs ?? this.maxSessionWallMs;
    const startedAt = this.clock();
    const onAbort = () => {
      abort.aborted = true;
    };
    if (opts.signal) opts.signal.addEventListener("abort", onAbort, { once: true });
    const promise = this.runAdvanced(actionId2, abort, bound, maxTicks, maxWallMs, startedAt, body, opts.signal, onAbort);
    promise.actionId = actionId2;
    promise.result = promise;
    return promise;
  }
  async runAdvanced(actionId2, abort, bound, maxTicks, maxWallMs, startedAt, body, signal, onAbort) {
    let used = 0;
    try {
      await macrotask();
      while (!abort.aborted && used < maxTicks && this.clock() - startedAt < maxWallMs && this.isBound(bound)) {
        const outcome = await body(abort, bound);
        used += BATCH_TICKS;
        await macrotask();
        if (this.game?.finished) break;
        if (outcome !== "continue") break;
      }
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
      this.aborts.delete(actionId2);
      this.advancedInFlight.delete(actionId2);
    }
    let code = "OK";
    if (abort.aborted || !this.isBound(bound)) code = "E_CANCELLED";
    else if (used >= maxTicks || this.clock() - startedAt >= maxWallMs) code = "E_TIMEOUT";
    const status = code === "OK" ? "completed" : code === "E_CANCELLED" ? "cancelled" : "timeout";
    const result = {
      schema: AI_NATIVE_DTO_SCHEMA_V1,
      protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      sessionId: this.id,
      epoch: this.epoch,
      tick: this.game ? this.game.tick : 0,
      actionId: actionId2,
      actorId: this.actorId,
      status,
      code,
      cost: 0,
      resourceWritesThisCall: 0,
      replayed: false
    };
    this.touch();
    return this.ok(result);
  }
  async execBatch(actions, ticks, abort, bound) {
    if (abort.aborted || !this.isBound(bound) || this.status !== "running" || !this.game) return false;
    if (!this.manager.acquireStepSlot()) return false;
    try {
      const res = this.game.step({ actions, ticks });
      if (!res.ok) return false;
      this.syncEvents();
      this.touch();
      return true;
    } finally {
      this.manager.releaseStepSlot();
    }
  }
  isBound(bound) {
    return this.game === bound.game && this.runId === bound.runId && this.epoch === bound.epoch && this.generation === bound.generation;
  }
  cancelAllAdvanced() {
    for (const id of this.advancedInFlight) {
      const abort = this.aborts.get(id);
      if (abort) abort.aborted = true;
      this.rememberCancelled(id);
    }
    this.advancedInFlight.clear();
    this.generation += 1;
  }
  rememberCancelled(actionId2) {
    this.cancelledIds.set(actionId2, true);
    while (this.cancelledIds.size > MAX_CANCELLED_IDS) {
      const oldest = this.cancelledIds.keys().next().value;
      if (oldest === void 0) break;
      this.cancelledIds.delete(oldest);
    }
  }
  // --- trusted dev/test facet ---------------------------------------------
  snapshot() {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.kind !== "test") return this.fail("E_PERMISSION", "snapshot is dev/test only", { sessionId: this.id, epoch: this.epoch });
    const frame = withHashes(this.game.snapshot(), this.hasher);
    if (Buffer.byteLength(JSON.stringify(frame), "utf8") > this.manager.maxSnapshotBytes) {
      return this.fail("E_PAYLOAD_TOO_LARGE", "snapshot exceeds size budget", { sessionId: this.id, epoch: this.epoch });
    }
    return this.ok(frame);
  }
  restore(frame) {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.kind !== "test") return this.fail("E_PERMISSION", "restore is dev/test only", { sessionId: this.id, epoch: this.epoch });
    this.cancelAllAdvanced();
    const result = this.game.restore(frame);
    if (!result.ok) return this.fail("E_SNAPSHOT_INVALID", "restore rejected", { sessionId: this.id, epoch: this.epoch });
    this.epoch = Math.max(this.epoch + 1, result.value.epoch);
    this.status = result.value.status;
    this.syncEvents();
    this.idempotency.clear();
    this.requestCache.clear();
    if (this.status === "finished") this.runEndReason = "closed";
    this.touch();
    return this.ok({ tick: result.value.tick, status: result.value.status, epoch: this.epoch });
  }
  replay(steps) {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.kind !== "test") return this.fail("E_PERMISSION", "replay is dev/test only", { sessionId: this.id, epoch: this.epoch });
    const result = this.game.replay(this.game.snapshot(), steps);
    if (!result.ok) return this.fail("E_REPLAY_INCOMPATIBLE", "replay failed", { sessionId: this.id, epoch: this.epoch });
    this.touch();
    return this.ok({ canonicalState: result.value.canonicalState, canonicalEvents: result.value.canonicalEvents });
  }
  inspectState() {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.kind !== "test") return this.fail("E_PERMISSION", "inspect is dev/test only", { sessionId: this.id, epoch: this.epoch });
    const snap = this.game.getState();
    return this.ok({ fullState: snap.model, seed: this.seedOf(), rngState: snap.rngState });
  }
  /** Kept for the P2 test surface: named/structured fixtures go through applyDevFixture. */
  injectFixture(_fixtureId) {
    return this.ok({ status: "unavailable" });
  }
  get tickValue() {
    return this.game ? this.game.tick : 0;
  }
  get epochValue() {
    return this.epoch;
  }
  get statusValue() {
    return this.status;
  }
  get devTamperedFlag() {
    return this.devTampered;
  }
  get fixtureAudit() {
    return this.fixtureLog.slice();
  }
  /** Seed is only exposed on the dev/test facet, never on production. */
  devSeed() {
    return this.kind === "test" ? this.seedOf() : null;
  }
  /**
   * Apply a closed dev/test fixture through the domain full-state restore seam.
   * Test-only; increments the epoch (old actions become E_STALE_EPOCH), records
   * an audit event, and marks the run dev-tampered. It never fabricates an
   * issued snapshot; a subsequent snapshot() issues a real frame from the new
   * state, so stateHash matches the snapshot.
   */
  applyDevFixture(fixture) {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.kind !== "test") return this.fail("E_PERMISSION", "fixtures are dev/test only", { sessionId: this.id, epoch: this.epoch });
    if (!this.game) return this.fail("E_NOT_APPLICABLE", "session has no engine", { sessionId: this.id, epoch: this.epoch });
    if (!isPlainObject(fixture) || typeof fixture.kind !== "string") {
      return this.fail("E_SCHEMA", "fixture shape is invalid", { sessionId: this.id, epoch: this.epoch });
    }
    const state = this.game.captureInternalState();
    const model = state.model;
    const applied = applyFixtureToModel(fixture, model);
    if (!applied.ok) return this.fail(applied.code, applied.messageKey, { sessionId: this.id, epoch: this.epoch });
    const problem = validateFullSliceRanges(model);
    if (problem) return this.fail("E_ILLEGAL_TARGET", "fixture produces an illegal state", { sessionId: this.id, epoch: this.epoch });
    this.cancelAllAdvanced();
    this.game.restoreInternalState({ ...state, model });
    this.epoch += 1;
    this.requestCache.clear();
    this.idempotency.clear();
    this.devTampered = true;
    const record = {
      kind: fixture.kind,
      ...fixture.kind === "named" ? { name: fixture.name } : {},
      tick: model.tick,
      epoch: this.epoch,
      atMs: this.clock()
    };
    this.fixtureLog.push(record);
    this.emit("DEV_FIXTURE_INJECTED", { fixtureId: fixture.kind === "named" ? fixture.name : fixture.kind, tick: model.tick });
    this.touch();
    return this.ok({ epoch: this.epoch, tick: model.tick, tampered: true });
  }
  /** Full dev/test inspection (signal/Guard/collision) without issuing a snapshot. */
  inspectDevState() {
    if (this.closedOrDisposed()) return this.closedError();
    if (this.kind !== "test") return this.fail("E_PERMISSION", "inspect is dev/test only", { sessionId: this.id, epoch: this.epoch });
    const state = this.game.captureInternalState();
    const model = state.model;
    const corridor = model.corridor;
    const signal = corridor ? { relay: corridor.relay, bridge: corridor.bridge, powered: corridor.powered, manualEnabled: corridor.manualEnabled, deadline: corridor.deadline, bridgePassable: corridor.bridge === "STABLE" || corridor.bridge === "UNSTABLE" } : { door: model.door, doorPassable: model.door === "JAMMED_OPEN" || model.door === "OPEN" || model.door === "SAFE_PENDING_CLOSE", jamRemainingTicks: model.jamRemainingTicks };
    const guard = corridor ? corridor.guard : null;
    const position = corridor ? corridor.location : { x: model.playerX, y: model.playerY };
    const bridgePassable = corridor ? corridor.bridge === "STABLE" || corridor.bridge === "UNSTABLE" : false;
    const standable = corridor ? canStandInCorridor(position.x, position.y, bridgePassable) : canFit(position.x, position.y, (cx, cy) => isWalkableCell(cx, cy, model.door === "JAMMED_OPEN" || model.door === "OPEN" || model.door === "SAFE_PENDING_CLOSE"));
    const collision = {
      position,
      standable,
      occupancy: corridor ? false : isOccupyingDoor(position.x, position.y),
      inCorridor: corridor !== null,
      onBridge: corridor ? occupiesBridge(position) : false,
      bridgePassable
    };
    return this.ok({
      tick: model.tick,
      epoch: this.epoch,
      status: this.status,
      seed: this.devSeed(),
      rngState: state.rngState,
      movement: state.movement,
      movementRemainingTicks: state.movementRemainingTicks,
      fullState: model,
      signal,
      guard,
      collision,
      devTampered: this.devTampered,
      fixtures: this.fixtureLog.slice()
    });
  }
  // --- internals -----------------------------------------------------------
  currentPosition() {
    if (!this.game) return null;
    const pos = this.game.observe().current.self.position;
    return { x: pos.x, y: pos.y };
  }
  visibleTargetPosition(targetId) {
    if (!this.game) return null;
    const found = this.game.observe().current.visibleTargets.find((t) => t.targetId === targetId);
    return found && "position" in found && found.position ? found.position : null;
  }
  buildObservation(detail, events) {
    const base = this.game.observe({ actorId: this.actorId, epoch: this.epoch });
    return {
      ...base,
      sessionId: this.id,
      epoch: this.epoch,
      actorId: this.actorId,
      role: this.role,
      detail,
      events: detail === "standard" ? events.slice() : [],
      ...detail === "summary" ? { evidence: [], knowledge: [], hypotheses: [] } : {}
    };
  }
  pageEvents(cursor, limit) {
    const slice = this.events.slice(cursor, cursor + limit);
    const nextCursor = cursor + slice.length;
    const truncated = nextCursor < this.events.length || this.droppedEvents > 0;
    return Object.freeze({ events: slice, nextCursor, total: this.events.length, truncated, droppedEvents: this.droppedEvents });
  }
  syncEvents() {
    if (!this.game) return;
    const all = this.game.eventLog();
    for (let i = this.lastGameEventSeq + 1; i < all.length; i += 1) {
      this.appendEvent(all[i]);
      this.lastGameEventSeq = all[i].eventSeq;
    }
  }
  appendEvent(e) {
    const eventId = `evt_${hexChars$1(8)}`;
    const ev = {
      schema: AI_NATIVE_EVENT_SCHEMA_V1,
      protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      eventId,
      sessionId: this.id,
      epoch: this.epoch,
      tick: e.tick,
      phase: e.phase,
      ordinal: e.ordinal,
      eventSeq: this.eventSeq,
      ...eventActionId(e.payload.actionId) ? { actionId: eventActionId(e.payload.actionId) } : {},
      ...typeof e.payload.actor === "string" ? { actorId: this.actorId } : {},
      type: e.type,
      payload: toProtocolPayload(e.type, e.payload)
    };
    this.events.push(ev);
    this.eventSeq += 1;
    if (this.events.length > AI_NATIVE_LIMITS_V1.MAX_EVENT_LOG_EVENTS) {
      this.events.shift();
      this.droppedEvents += 1;
    }
  }
  emit(type, payload2) {
    this.appendEvent({ eventSeq: this.eventSeq, tick: this.game ? this.game.tick : 0, phase: 0, ordinal: 0, type, payload: payload2 });
  }
  descriptor() {
    return Object.freeze({
      schema: AI_NATIVE_DTO_SCHEMA_V1,
      protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      sessionId: this.id,
      kind: this.kind,
      mode: this.mode,
      status: this.status,
      epoch: this.epoch,
      tick: this.game ? this.game.tick : 0,
      scenarioId: AI_NATIVE_SCENARIO_ID_V1,
      kernelVersion: AI_NATIVE_KERNEL_VERSION_V1,
      runId: this.runId,
      runEndReason: this.runEndReason,
      actorRegistry: {
        [this.actorId]: {
          actorId: this.actorId,
          role: this.role,
          priority: this.role === "PLAYER" ? 0 : 2,
          allowedActions: this.allowedActions,
          observationScope: "self"
        }
      },
      createdAtMs: this.createdAtMs,
      lastActivityMs: this.lastActivityMs,
      expiresAtMs: this.lastActivityMs + this.idleTimeoutMs,
      resourceLimits: this.resourceLimits
    });
  }
  get allowedActions() {
    if (this.isCompanion) return [];
    const base = ["move", "scan", "wait", "jam", "interact"];
    if (this.game?.inCorridor) base.push("shoot_guard");
    return base;
  }
  seedOf() {
    return this.game ? this.game.seed : 0;
  }
  touch() {
    this.lastActivityMs = this.clock();
    this.armIdle();
  }
  armIdle() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.timers.delete(this.idleTimer);
      this.idleTimer = null;
    }
    const remaining = this.idleTimeoutMs - (this.clock() - this.lastActivityMs);
    if (remaining <= 0) {
      this.scheduleClose();
      return;
    }
    const t = setTimeout(() => this.scheduleClose(), remaining);
    t.unref?.();
    this.idleTimer = t;
    this.timers.add(t);
  }
  startIdleWatcher() {
    this.armIdle();
    const wall = setTimeout(() => this.scheduleClose(), this.maxSessionWallMs);
    wall.unref?.();
    this.wallTimer = wall;
    this.timers.add(wall);
  }
  scheduleClose() {
    if (this.status === "closed") return;
    this.emit("SESSION_CLOSED", { reason: "idle" });
    this.forceClose();
  }
  forceClose() {
    if (this.status === "closed") return;
    this.cancelAllAdvanced();
    this.status = "closed";
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.idleTimer = null;
    this.wallTimer = null;
    this.game?.dispose();
    this.game = null;
    this.manager.remove(this.id);
  }
  closedOrDisposed() {
    return this.status === "closed";
  }
  closedError() {
    return this.fail("E_SESSION_CLOSED", "session closed", { sessionId: this.id, epoch: this.epoch });
  }
  fail(code, messageKey, extra = {}) {
    return {
      ok: false,
      error: makeError(code, messageKey, {
        sessionId: extra.sessionId,
        epoch: extra.epoch,
        tick: extra.tick,
        requestId: extra.requestId,
        correlationId: extra.correlationId
      })
    };
  }
  ok(value) {
    return { ok: true, value };
  }
  rejected(actionId2, actorId2, code, messageKey) {
    return {
      schema: AI_NATIVE_DTO_SCHEMA_V1,
      protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      sessionId: this.id,
      epoch: this.epoch,
      tick: this.game ? this.game.tick : 0,
      actionId: actionId2,
      actorId: actorId2,
      status: "rejected",
      code,
      cost: 0,
      resourceWritesThisCall: 0,
      replayed: false
    };
  }
  // --- capability narrowings ----------------------------------------------
  playerHandle() {
    const self = this;
    return {
      sessionId: this.id,
      actorId: this.actorId,
      role: "PLAYER",
      start: () => self.start(),
      close: () => self.close(),
      step: (r) => self.step(r),
      observe: (d) => self.observe(d),
      getEvents: (c, l) => self.getEvents(c, l),
      cancelAction: (a, r) => self.cancelAction(a, r),
      moveTo: (t, o) => self.moveTo(t, o),
      approach: (t, o) => self.approach(t, o),
      scanTarget: (o) => self.scanTarget(o),
      interactWith: (t, o) => self.interactWith(t, o),
      waitUntil: (o) => self.waitUntil(o)
    };
  }
  ownerHandle() {
    const self = this;
    return {
      sessionId: this.id,
      capability: "OWNER",
      start: () => self.start(),
      pause: () => self.pause(),
      resume: () => self.resume(),
      reset: () => self.reset(),
      close: () => self.close()
    };
  }
  testHandle() {
    const player = this.playerHandle();
    const self = this;
    return {
      ...player,
      kind: "test",
      snapshot: () => self.snapshot(),
      restore: (f) => self.restore(f),
      replay: (s) => self.replay(s),
      inspectState: () => self.inspectState(),
      injectFixture: (f) => self.injectFixture(f)
    };
  }
  companionHandle() {
    const self = this;
    return {
      sessionId: this.id,
      actorId: this.actorId,
      role: "COMPANION",
      observe: () => self.observe(),
      act: (r) => self.step(r),
      close: () => self.close()
    };
  }
}
function macrotask() {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 0);
    t.unref?.();
  });
}
function immediateAdvanced(actionId2, response) {
  const p = Promise.resolve(response);
  p.actionId = actionId2;
  p.result = p;
  return p;
}
const UNSUPPORTED = /* @__PURE__ */ new Set(["aim", "fire", "decoy"]);
function adaptAction(req, currentTick, allowed) {
  if (UNSUPPORTED.has(req.type)) return { ok: false, error: makeError("E_NOT_APPLICABLE", "action not implemented in P0", { correlationId: req.actionId }) };
  if (!allowed.includes(req.type)) return { ok: false, error: makeError("E_PERMISSION", "action not permitted", { correlationId: req.actionId }) };
  if (req.targetTick !== currentTick + 1) {
    const code = req.targetTick < currentTick + 1 ? "E_STALE_TICK" : "E_FUTURE_TICK";
    return { ok: false, error: makeError(code, "targetTick must equal the next authoritative tick", { correlationId: req.actionId }) };
  }
  const id = `player-${req.actionId}`;
  const out = { id, actor: "player", type: req.type };
  if (req.type === "move") {
    const dir = vectorToCardinal(req.payload);
    if (!dir) return { ok: false, error: makeError("E_SCHEMA", "move direction invalid", { correlationId: req.actionId }) };
    out.direction = dir;
    out.ticks = req.payload.durationTicks;
  } else if (req.type === "wait") {
    out.ticks = req.payload.durationTicks;
  } else if (req.type === "jam" || req.type === "interact") {
    const targetId = req.payload.targetId;
    out.target = targetId.includes("guard") ? "guard" : "relay";
  }
  return { ok: true, value: out };
}
function vectorToCardinal(vec) {
  const { x, y } = vec.direction;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return null;
  if (Math.abs(x) >= Math.abs(y)) return x > 0 ? "east" : "west";
  return y > 0 ? "south" : "north";
}
function eventActionId(value) {
  if (typeof value !== "string") return null;
  const bare = value.startsWith("player-") ? value.slice("player-".length) : value;
  return ADVANCED_ID.test(bare) ? bare : null;
}
function toProtocolPayload(type, payload2) {
  const group = AI_NATIVE_EVENT_GROUP_V1[type];
  const allowed = group ? AI_NATIVE_EVENT_PAYLOAD_KEYS_V1[group] : void 0;
  const out = {};
  if (!allowed) return out;
  for (const [key, value] of Object.entries(payload2)) {
    if (key === "actor") continue;
    const mapped = key === "roomId" ? "stateLabel" : key;
    if (allowed.includes(mapped) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      out[mapped] = value;
    }
  }
  if (type === "SESSION_CREATED" && allowed.includes("status")) out.status = "created";
  if (type === "SESSION_RESET" && allowed.includes("reason")) out.reason = "reset";
  return out;
}
function sanitizeLimits(limits) {
  const base = {
    maxTicksPerStep: AI_NATIVE_LIMITS_V1.MAX_TICKS_PER_STEP,
    maxActionsPerTick: AI_NATIVE_LIMITS_V1.MAX_ACTIONS_PER_TICK,
    maxActiveIntentsPerActor: 1,
    maxActionDurationTicks: AI_NATIVE_LIMITS_V1.MAX_ACTION_DURATION_TICKS,
    maxPayloadBytes: AI_NATIVE_LIMITS_V1.MAX_PAYLOAD_BYTES,
    maxObservationEvents: AI_NATIVE_LIMITS_V1.MAX_OBSERVATION_EVENTS,
    maxEventsPerPage: AI_NATIVE_LIMITS_V1.MAX_EVENTS_PER_PAGE,
    maxRequestsPerSecond: AI_NATIVE_LIMITS_V1.MAX_REQUESTS_PER_SECOND,
    maxObservePerSecond: AI_NATIVE_LIMITS_V1.MAX_OBSERVE_PER_SECOND,
    maxStepTicksPerSecond: AI_NATIVE_LIMITS_V1.MAX_STEP_TICKS_PER_SECOND,
    requestTimeoutMs: AI_NATIVE_LIMITS_V1.REQUEST_TIMEOUT_MS,
    heartbeatMs: AI_NATIVE_LIMITS_V1.HEARTBEAT_MS,
    idleTimeoutMs: AI_NATIVE_LIMITS_V1.IDLE_TIMEOUT_MS,
    maxSessionWallMs: AI_NATIVE_LIMITS_V1.MAX_SESSION_WALL_MS
  };
  if (!limits) return base;
  if (typeof limits !== "object" || Array.isArray(limits)) throw new SessionError("E_SCHEMA", "resourceLimits must be an object", "schema");
  const allowedKeys = new Set(Object.keys(base));
  const merged = { ...base };
  for (const key of Object.keys(limits)) {
    if (!allowedKeys.has(key)) throw new SessionError("E_SCHEMA", `unknown resource limit: ${key}`, "schema");
    const value = limits[key];
    if (!isFiniteInt$1(value, 1)) throw new SessionError("E_SCHEMA", `${key} must be a finite positive integer`, "schema");
    merged[key] = value;
  }
  return merged;
}
function deriveActorHex(seed) {
  let state = seed >>> 0 ^ 2246822507;
  let out = "";
  for (let i = 0; i < 16; i += 1) {
    state = Math.imul(state ^ state >>> 13, 3266489909) >>> 0;
    out += (state & 15).toString(16);
  }
  return out;
}
const DTO = "last_signal.ai-native.dto.v1";
const MAX_SNAPSHOTS = 64;
const MAX_RUNS = 32;
const MAX_AUDIT = 256;
const MAX_REQUEST_CACHE = 256;
const MAX_BATCH_SEEDS = 8;
const MAX_RUN_STEPS = 64;
function hexChars(bytes) {
  return randomBytes(bytes).toString("hex");
}
function handle(prefix) {
  return `${prefix}${hexChars(12)}`;
}
function isFiniteInt(value, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max;
}
function gameplayEvents(events) {
  return events.map((e) => ({
    tick: e.tick,
    phase: e.phase,
    ordinal: e.ordinal,
    eventSeq: e.eventSeq,
    type: e.type,
    payload: Object.fromEntries(Object.entries(e.payload).filter(([k]) => k !== "actionId" && k !== "actorId"))
  }));
}
function gameplayEventsHash(events) {
  return `sha256:${createHash("sha256").update(canonicalJson(gameplayEvents(events))).digest("hex")}`;
}
function ok(value) {
  return { ok: true, value };
}
function fail(code, messageKey) {
  return { ok: false, code, messageKey };
}
function fingerprintArgs(value) {
  try {
    const clean = {};
    for (const [key, item] of Object.entries(value)) if (item !== void 0) clean[key] = item;
    return payloadFingerprint(clean);
  } catch {
    return "__invalid__";
  }
}
function deriveSessionRequestId(domain, requestId) {
  const digest = createHash("sha256").update(`${domain}|${requestId}`).digest("hex").slice(0, 24);
  return `req_${digest}`;
}
const ROUTE_A = [
  { type: "move", payload: { type: "move", direction: { x: 1, y: 0 }, durationTicks: 60 }, ticks: 60 },
  { type: "scan", payload: { type: "scan" }, ticks: 1 },
  { type: "jam", payload: { type: "jam", targetId: "tgt_lab_door_receiver" }, ticks: 1 },
  { type: "move", payload: { type: "move", direction: { x: 1, y: 0 }, durationTicks: 40 }, ticks: 40 },
  { type: "move", payload: { type: "move", direction: { x: 1, y: 0 }, durationTicks: 100 }, ticks: 100 },
  { type: null, payload: null, ticks: 1 },
  { type: "move", payload: { type: "move", direction: { x: 1, y: 0 }, durationTicks: 61 }, ticks: 61 },
  { type: "move", payload: { type: "move", direction: { x: 0, y: -1 }, durationTicks: 17 }, ticks: 17 },
  { type: "interact", payload: { type: "interact", targetId: "tgt_corridor_relay" }, ticks: 1 },
  { type: null, payload: null, ticks: 95 },
  { type: "move", payload: { type: "move", direction: { x: 1, y: 0 }, durationTicks: 150 }, ticks: 150 }
];
class Harness {
  constructor(manager, mode) {
    this.records = /* @__PURE__ */ new Map();
    this.snapshots = /* @__PURE__ */ new Map();
    this.snapshotOrder = [];
    this.runs = /* @__PURE__ */ new Map();
    this.runOrder = [];
    this.pending = /* @__PURE__ */ new Map();
    this.requestCache = /* @__PURE__ */ new Map();
    this.manager = manager;
    this.mode = mode;
  }
  get size() {
    return this.records.size;
  }
  touch(record, op, detail) {
    record.audit.push({
      op,
      atMs: Date.now(),
      tick: record.session.tickValue,
      epoch: record.session.epochValue,
      ...detail ? { detail } : {}
    });
    while (record.audit.length > MAX_AUDIT) record.audit.shift();
  }
  record(handle2) {
    const record = this.records.get(handle2);
    if (!record) return fail("E_SESSION_NOT_FOUND", "unknown session handle");
    return record;
  }
  isRecord(value) {
    return value.session !== void 0;
  }
  /** Create a session. Player mode only production; dev mode only test. */
  createSession(seed) {
    if (this.mode === "player") {
      if (seed !== void 0) return fail("E_PERMISSION", "seed is not accepted on the player surface");
      if (this.records.size >= this.manager.maxSessions) return fail("E_RESOURCE_LIMIT", "session limit reached");
      const player = this.manager.createProductionSession();
      const session2 = this.manager.get(player.sessionId);
      if (!session2) return fail("E_INTERNAL_TRANSACTION", "session unavailable");
      const owner2 = session2.ownerHandle();
      owner2.start();
      const handleValue2 = handle("ses_");
      const record2 = {
        handle: handleValue2,
        session: session2,
        player,
        test: null,
        owner: owner2,
        kind: "production",
        seed: null,
        audit: []
      };
      this.records.set(handleValue2, record2);
      this.touch(record2, "create", { kind: "production" });
      return ok({ session: handleValue2, kind: "production", tick: session2.tickValue, epoch: session2.epochValue });
    }
    if (!isFiniteInt(seed, 0, 4294967295)) return fail("E_SCHEMA", "dev create requires a seed in 0..0xffffffff");
    if (this.records.size >= this.manager.maxSessions) return fail("E_RESOURCE_LIMIT", "session limit reached");
    const test = this.manager.createTestSession({ seed });
    const session = this.manager.get(test.sessionId);
    if (!session) return fail("E_INTERNAL_TRANSACTION", "session unavailable");
    const owner = session.ownerHandle();
    owner.start();
    const handleValue = handle("ses_");
    const record = {
      handle: handleValue,
      session,
      player: test,
      test,
      owner,
      kind: "test",
      seed,
      audit: []
    };
    this.records.set(handleValue, record);
    this.touch(record, "create", { kind: "test", seed });
    return ok({ session: handleValue, kind: "test", tick: session.tickValue, epoch: session.epochValue, seed });
  }
  closeSession(sessionHandle2) {
    const record = this.record(sessionHandle2);
    if (!this.isRecord(record)) return record;
    this.touch(record, "close");
    this.clearSessionRequests(sessionHandle2);
    record.owner.close();
    this.records.delete(sessionHandle2);
    for (const [key, value] of this.pending) {
      if (key.startsWith(`${sessionHandle2}:`)) this.pending.delete(key);
    }
    return ok({ session: sessionHandle2 });
  }
  observe(sessionHandle2, detail = "standard") {
    const record = this.record(sessionHandle2);
    if (!this.isRecord(record)) return record;
    const res = record.player.observe(detail);
    this.touch(record, "observe", { detail });
    return res.ok ? ok(res.value) : fail(res.error.code, res.error.messageKey);
  }
  getEvents(sessionHandle2, cursor = 0, limit = 64) {
    const record = this.record(sessionHandle2);
    if (!this.isRecord(record)) return record;
    const res = record.player.getEvents(cursor, limit);
    this.touch(record, "get_events", { cursor, limit });
    return res.ok ? ok(res.value) : fail(res.error.code, res.error.messageKey);
  }
  step(sessionHandle2, params) {
    const record = this.record(sessionHandle2);
    if (!this.isRecord(record)) return record;
    const argsFp = fingerprintArgs({
      ticks: params.ticks,
      actions: params.actions,
      includeObservation: params.includeObservation,
      detail: params.detail,
      fromTick: params.fromTick,
      targetTick: params.targetTick,
      epoch: params.epoch
    });
    return this.stepWithCache(record, "step", params, argsFp);
  }
  /**
   * Harness-level request idempotency. The ORIGINAL tool arguments are fingerprinted
   * and cached by (session, epoch, requestId, tool domain) BEFORE any default
   * fromTick/actionId is filled, so a retry of the same MCP tool call returns the
   * first receipt and never advances ticks or re-charges resources. Different
   * arguments under the same id conflict; the Session's own validation is untouched.
   */
  stepWithCache(record, domain, params, argsFp) {
    if (!isFiniteInt(params.epoch, 0, 4294967295)) {
      return fail("E_SCHEMA", "epoch is required and must be an integer in 0..4294967295");
    }
    const currentEpoch = record.session.epochValue;
    if (params.epoch !== currentEpoch) {
      return fail("E_STALE_EPOCH", "request epoch is stale; re-read epoch and use a new requestId");
    }
    if (!isFiniteInt(params.ticks, 1, 1e3)) return fail("E_SCHEMA", "ticks must be an integer in 1..1000");
    if (!Array.isArray(params.actions)) return fail("E_SCHEMA", "actions must be an array");
    const requestId = params.requestId ?? `req_${hexChars(12)}`;
    const key = `${record.handle}|${currentEpoch}|${domain}|${requestId}`;
    const cached = this.requestCache.get(key);
    if (cached) {
      if (cached.argsFp === argsFp) return cached.response;
      return fail("E_ID_PAYLOAD_MISMATCH", "same requestId reused with different arguments for this tool");
    }
    const sessionRequestId = deriveSessionRequestId(domain, requestId);
    const result = this.executeStepCore(record, params, sessionRequestId);
    this.rememberRequest(key, record.handle, currentEpoch, requestId, domain, argsFp, result);
    return result;
  }
  executeStepCore(record, params, requestId) {
    const tick = params.fromTick ?? record.session.tickValue;
    const epoch = params.epoch;
    const targetTick = params.targetTick ?? tick + 1;
    const actions = [];
    for (const action of params.actions) {
      if (!action || typeof action.type !== "string" || !action.payload || typeof action.payload !== "object") {
        return fail("E_SCHEMA", "each action needs type and payload");
      }
      actions.push({
        schema: DTO,
        protocolVersion: 1,
        actionId: action.actionId ?? `aid_${hexChars(12)}`,
        actorId: record.session.actorId,
        sessionId: record.session.id,
        epoch,
        targetTick,
        type: action.type,
        payload: action.payload,
        clientSeq: 0,
        issuedAtMs: 0,
        deadlineTick: targetTick
      });
    }
    const request = {
      schema: DTO,
      protocolVersion: 1,
      requestId,
      sessionId: record.session.id,
      epoch,
      fromTick: tick,
      ticks: params.ticks,
      actions,
      includeObservation: params.includeObservation === true,
      observationDetail: params.detail ?? "standard"
    };
    const res = record.session.step(request);
    this.touch(record, "step", { ticks: params.ticks, actions: actions.length });
    return res.ok ? ok(res.value) : fail(res.error.code, res.error.messageKey);
  }
  executeAction(sessionHandle2, params) {
    const record = this.record(sessionHandle2);
    if (!this.isRecord(record)) return record;
    const argsFp = fingerprintArgs({
      ticks: params.ticks,
      action: params.action,
      actions: params.action ? void 0 : params.actions,
      includeObservation: params.includeObservation,
      detail: params.detail,
      fromTick: params.fromTick,
      targetTick: params.targetTick,
      epoch: params.epoch
    });
    const res = this.stepWithCache(record, "execute_action", {
      ticks: params.ticks,
      actions: params.action ? [params.action] : params.actions,
      includeObservation: params.includeObservation,
      detail: params.detail,
      requestId: params.requestId,
      ...params.fromTick !== void 0 ? { fromTick: params.fromTick } : {},
      ...params.targetTick !== void 0 ? { targetTick: params.targetTick } : {},
      epoch: params.epoch
    }, argsFp);
    if (!res.ok) return res;
    return ok({ step: res.value, result: res.value.actionResults[0] ?? null });
  }
  rememberRequest(key, session, epoch, requestId, domain, argsFp, response) {
    this.requestCache.set(key, { session, epoch, requestId, domain, argsFp, response });
    while (this.requestCache.size > MAX_REQUEST_CACHE) {
      const oldest = this.requestCache.keys().next().value;
      if (oldest === void 0) break;
      this.requestCache.delete(oldest);
    }
  }
  clearSessionRequests(sessionHandle2) {
    for (const [key, entry] of this.requestCache) {
      if (entry.session === sessionHandle2) this.requestCache.delete(key);
    }
  }
  async executeAdvanced(sessionHandle2, params) {
    const record = this.record(sessionHandle2);
    if (!this.isRecord(record)) return record;
    if (this.mode !== "dev") return fail("E_PERMISSION", "advanced actions are dev-only");
    if (!isFiniteInt(params.epoch, 0, 4294967295)) {
      return fail("E_SCHEMA", "epoch is required and must be an integer in 0..4294967295");
    }
    if (params.epoch !== record.session.epochValue) {
      return fail("E_STALE_EPOCH", "request epoch is stale; re-read epoch and use a new requestId");
    }
    const opts = {
      ...params.actionId ? { actionId: params.actionId } : {},
      ...params.maxTicks !== void 0 ? { maxTicks: params.maxTicks } : {},
      ...params.maxWallMs !== void 0 ? { maxWallMs: params.maxWallMs } : {}
    };
    let advanced;
    switch (params.type) {
      case "move_to":
        if (!params.target) return fail("E_SCHEMA", "move_to requires target");
        advanced = record.player.moveTo(params.target, opts);
        break;
      case "approach":
        if (!params.targetId) return fail("E_SCHEMA", "approach requires targetId");
        advanced = record.player.approach(params.targetId, opts);
        break;
      case "scan_target":
        advanced = record.player.scanTarget(opts);
        break;
      case "interact_with":
        if (!params.targetId) return fail("E_SCHEMA", "interact_with requires targetId");
        advanced = record.player.interactWith(params.targetId, opts);
        break;
      case "wait_until":
        advanced = record.player.waitUntil({ ...opts, ...params.until ? { until: params.until } : {} });
        break;
      default:
        return fail("E_NOT_APPLICABLE", "unknown advanced action");
    }
    const actionId2 = advanced.actionId;
    this.touch(record, "advanced", { actionId: actionId2, type: params.type });
    if (params.wait === false) {
      this.pending.set(`${sessionHandle2}:${actionId2}`, advanced);
      void advanced.then(() => this.pending.delete(`${sessionHandle2}:${actionId2}`));
      return ok({ actionId: actionId2, status: "started" });
    }
    const res = await advanced;
    this.pending.delete(`${sessionHandle2}:${actionId2}`);
    if (!res.ok) return fail(res.error.code, res.error.messageKey);
    return ok({ actionId: actionId2, status: res.value.status, result: res.value });
  }
  cancelAdvanced(sessionHandle2, actionId2) {
    const record = this.record(sessionHandle2);
    if (!this.isRecord(record)) return record;
    const res = record.player.cancelAction(actionId2);
    this.touch(record, "cancel", { actionId: actionId2 });
    return res.ok ? ok({ actionId: actionId2 }) : fail(res.error.code, res.error.messageKey);
  }
  // --- dev-only capabilities ----------------------------------------------
  requireDev(value) {
    return this.mode === "dev" ? ok(value) : fail("E_PERMISSION", "dev tool is not registered on the player surface");
  }
  saveSnapshot(sessionHandle2) {
    const record = this.record(sessionHandle2);
    if (!this.isRecord(record)) return record;
    if (this.mode !== "dev" || !record.test) return fail("E_PERMISSION", "snapshot is dev/test only");
    const res = record.test.snapshot();
    if (!res.ok) return fail(res.error.code, res.error.messageKey);
    const frame = res.value;
    const sizeBytes = Buffer.byteLength(JSON.stringify(frame), "utf8");
    const evicted = [];
    while (this.snapshots.size >= MAX_SNAPSHOTS) {
      const oldest = this.snapshotOrder.shift();
      if (!oldest) break;
      this.snapshots.delete(oldest);
      evicted.push(oldest);
    }
    const snapshotHandle = handle("snapref_");
    const provenance = { kind: record.kind, devTampered: record.session.devTamperedFlag, fixtures: record.session.fixtureAudit.length };
    this.snapshots.set(snapshotHandle, {
      frame,
      sessionHandle: sessionHandle2,
      tick: frame.tick,
      epoch: frame.epoch,
      ...frame.stateHash ? { stateHash: frame.stateHash } : {},
      sizeBytes,
      provenance
    });
    this.snapshotOrder.push(snapshotHandle);
    this.touch(record, "snapshot", { snapshot: snapshotHandle, sizeBytes });
    return ok({ snapshot: snapshotHandle, tick: frame.tick, epoch: frame.epoch, ...frame.stateHash ? { stateHash: frame.stateHash } : {}, sizeBytes, provenance, evicted });
  }
  restoreSnapshot(sessionHandle2, snapshotHandle) {
    const record = this.record(sessionHandle2);
    if (!this.isRecord(record)) return record;
    if (this.mode !== "dev" || !record.test) return fail("E_PERMISSION", "restore is dev/test only");
    const entry = this.snapshots.get(snapshotHandle);
    if (!entry) return fail("E_SNAPSHOT_INVALID", "snapshot handle is unknown or from another process");
    if (entry.sessionHandle !== sessionHandle2) return fail("E_SNAPSHOT_INVALID", "snapshot belongs to a different session");
    const res = record.test.restore(entry.frame);
    this.touch(record, "restore", { snapshot: snapshotHandle });
    if (!res.ok) return fail(res.error.code, res.error.messageKey);
    this.clearSessionRequests(sessionHandle2);
    return ok({ tick: res.value.tick, status: res.value.status, epoch: res.value.epoch, provenance: entry.provenance });
  }
  replay(sessionHandle2, steps) {
    const record = this.record(sessionHandle2);
    if (!this.isRecord(record)) return record;
    if (this.mode !== "dev" || !record.test) return fail("E_PERMISSION", "replay is dev/test only");
    const res = record.test.replay(steps);
    this.touch(record, "replay", { steps: steps.length });
    return res.ok ? ok({ canonicalState: res.value.canonicalState, canonicalEvents: res.value.canonicalEvents }) : fail(res.error.code, res.error.messageKey);
  }
  inspect(sessionHandle2) {
    const record = this.record(sessionHandle2);
    if (!this.isRecord(record)) return record;
    if (this.mode !== "dev") return fail("E_PERMISSION", "inspect is dev-only");
    const res = record.session.inspectDevState();
    this.touch(record, "inspect");
    return res.ok ? ok(res.value) : fail(res.error.code, res.error.messageKey);
  }
  injectFixture(sessionHandle2, fixture) {
    const record = this.record(sessionHandle2);
    if (!this.isRecord(record)) return record;
    if (this.mode !== "dev") return fail("E_PERMISSION", "fixture is dev/test only");
    const res = record.session.applyDevFixture(fixture);
    this.touch(record, "fixture", { fixture: fixture.kind ?? "unknown" });
    if (!res.ok) return fail(res.error.code, res.error.messageKey);
    this.clearSessionRequests(sessionHandle2);
    return ok({ epoch: res.value.epoch, tick: res.value.tick, tampered: true, audit: record.session.fixtureAudit });
  }
  loadScenario(scenarioId) {
    if (this.mode !== "dev") return fail("E_PERMISSION", "scenario loading is dev-only");
    if (scenarioId !== "station-zero") return fail("E_NOT_APPLICABLE", "only the registered Station Zero template is available");
    return ok({ scenarioId: "station-zero", kernelVersion: "station-zero-r1-r2@1", rooms: ["station-zero-r1", "station-zero-r2"], strategies: ["route-a", "idle"] });
  }
  async runScenario(params) {
    if (this.mode !== "dev") return fail("E_PERMISSION", "run_scenario is dev-only");
    if (!isFiniteInt(params.seed, 0, 4294967295)) return fail("E_SCHEMA", "seed must be an integer in 0..0xffffffff");
    const strategy = params.strategy ?? "route-a";
    if (strategy !== "route-a" && strategy !== "idle") return fail("E_NOT_APPLICABLE", "unknown deterministic strategy");
    const maxTicks = isFiniteInt(params.maxTicks, 1, 1e6) ? params.maxTicks : 2e3;
    const maxWallMs = isFiniteInt(params.maxWallMs, 1, 36e5) ? params.maxWallMs : 15e3;
    const maxEvents = isFiniteInt(params.maxEvents, 1, 1e4) ? params.maxEvents : 512;
    const startedAt = Date.now();
    let test;
    try {
      test = this.manager.createTestSession({ seed: params.seed });
    } catch (error) {
      const code = error.code;
      if (code === "E_RESOURCE_LIMIT") return fail("E_RESOURCE_LIMIT", "process session budget exhausted");
      return fail("E_INTERNAL_TRANSACTION", "scenario session unavailable");
    }
    const session = this.manager.get(test.sessionId);
    if (!session) return fail("E_INTERNAL_TRANSACTION", "session unavailable");
    const owner = session.ownerHandle();
    owner.start();
    const actorId2 = session.actorId;
    const runId = handle("run_");
    const trace = [];
    let tickBudget = maxTicks;
    let done = false;
    let failure2 = null;
    let steps = 0;
    const script = strategy === "idle" ? Array.from({ length: 4 }, () => ({ type: null, payload: null, ticks: Math.max(1, Math.floor(maxTicks / 4)) })) : ROUTE_A;
    try {
      for (const segment of script) {
        if (done || tickBudget <= 0 || Date.now() - startedAt >= maxWallMs || steps >= MAX_RUN_STEPS) break;
        const ticks = Math.min(segment.ticks, tickBudget);
        const before = session.tickValue;
        const epoch = session.epochValue;
        const actions = segment.type && segment.payload ? [{
          schema: DTO,
          protocolVersion: 1,
          actionId: `aid_${hexChars(12)}`,
          actorId: actorId2,
          sessionId: session.id,
          epoch,
          targetTick: before + 1,
          type: segment.type,
          payload: segment.payload,
          clientSeq: 0,
          issuedAtMs: 0,
          deadlineTick: before + 1
        }] : [];
        const res = session.step({
          schema: DTO,
          protocolVersion: 1,
          requestId: `req_${hexChars(12)}`,
          sessionId: session.id,
          epoch,
          fromTick: before,
          ticks,
          actions,
          includeObservation: false
        });
        steps += 1;
        if (!res.ok) {
          failure2 = res.error.code;
          break;
        }
        tickBudget -= ticks;
        trace.push({ step: steps, tickBefore: before, tickAfter: res.value.toTick, actionCodes: res.value.actionResults.map((r) => r.code), status: res.value.status });
        const summary2 = session.observe("summary");
        if (summary2.ok && (summary2.value.current.self.completed || summary2.value.current.self.failed)) done = true;
        const events2 = session.getEvents(0, maxEvents);
        if (events2.ok && events2.value.total >= maxEvents) break;
        await new Promise((r) => setTimeout(r, 0));
      }
      const frame = session.snapshot();
      const events = session.getEvents(0, maxEvents);
      const summaryObs = session.observe("summary");
      const self = summaryObs.ok ? summaryObs.value.current.self : null;
      const stateHash = frame.ok ? frame.value.stateHash : void 0;
      const sessionEvents = events.ok ? events.value.events : [];
      const eventsHash = gameplayEventsHash(sessionEvents);
      let snapshotHandle;
      if (frame.ok) {
        const saved = this.saveSnapshotFromFrame(session, frame.value, runId);
        snapshotHandle = saved;
      }
      const finalTick = session.tickValue;
      owner.close();
      const summary = {
        runId,
        ok: failure2 === null && self !== null,
        ...failure2 ? { code: failure2 } : {},
        seed: params.seed,
        strategy,
        ticks: finalTick,
        completed: self?.completed ?? false,
        passed: self?.passed ?? false,
        crossed: self?.crossed ?? false,
        failed: self?.failed ?? false,
        ...stateHash ? { stateHash } : {},
        ...eventsHash ? { eventsHash } : {},
        eventCount: events.ok ? events.value.total : 0,
        ...snapshotHandle ? { snapshot: snapshotHandle } : {},
        steps,
        elapsedMs: Date.now() - startedAt,
        trace,
        provenance: { dev: true, devTampered: session.devTamperedFlag, fixtures: session.fixtureAudit.length, playerLegal: false },
        stats: { steps, ticks: finalTick, actions: trace.reduce((n, t) => n + t.actionCodes.length, 0), events: events.ok ? events.value.total : 0 }
      };
      this.rememberRun(summary, sessionEvents);
      return ok(summary);
    } catch {
      owner.close();
      return fail("E_INTERNAL_TRANSACTION", "scenario execution failed");
    }
  }
  saveSnapshotFromFrame(session, frame, runId) {
    const sizeBytes = Buffer.byteLength(JSON.stringify(frame), "utf8");
    while (this.snapshots.size >= MAX_SNAPSHOTS) {
      const oldest = this.snapshotOrder.shift();
      if (!oldest) break;
      this.snapshots.delete(oldest);
    }
    const snapshotHandle = handle("snapref_");
    this.snapshots.set(snapshotHandle, {
      frame,
      sessionHandle: runId,
      tick: frame.tick,
      epoch: frame.epoch,
      ...frame.stateHash ? { stateHash: frame.stateHash } : {},
      sizeBytes,
      provenance: { kind: session.kind, devTampered: session.devTamperedFlag, fixtures: session.fixtureAudit.length }
    });
    this.snapshotOrder.push(snapshotHandle);
    return snapshotHandle;
  }
  rememberRun(summary, events) {
    this.runs.set(summary.runId, { summary, events: events.slice(0, 512) });
    this.runOrder.push(summary.runId);
    while (this.runOrder.length > MAX_RUNS) {
      const oldest = this.runOrder.shift();
      if (oldest) this.runs.delete(oldest);
    }
  }
  async runBatch(params) {
    if (this.mode !== "dev") return fail("E_PERMISSION", "run_batch is dev-only");
    if (!Array.isArray(params.seeds) || params.seeds.length < 1 || params.seeds.length > MAX_BATCH_SEEDS) {
      return fail("E_SCHEMA", `seeds must contain 1..${MAX_BATCH_SEEDS} entries`);
    }
    if (params.seeds.some((s) => !isFiniteInt(s, 0, 4294967295))) return fail("E_SCHEMA", "each seed must be an integer in 0..0xffffffff");
    const results = new Array(params.seeds.length);
    let index = 0;
    const worker = async () => {
      while (index < params.seeds.length) {
        const current = index;
        index += 1;
        try {
          const res = await this.runScenario({
            seed: params.seeds[current],
            strategy: params.strategy,
            maxTicks: params.maxTicks,
            maxWallMs: params.maxWallMs,
            maxEvents: params.maxEvents
          });
          results[current] = res.ok ? res.value : {
            runId: handle("run_"),
            ok: false,
            code: res.code,
            seed: params.seeds[current],
            strategy: params.strategy ?? "route-a",
            ticks: 0,
            completed: false,
            passed: false,
            crossed: false,
            failed: true,
            eventCount: 0,
            steps: 0,
            elapsedMs: 0,
            trace: [],
            provenance: { dev: true, devTampered: false, fixtures: 0, playerLegal: false },
            stats: { steps: 0, ticks: 0, actions: 0, events: 0 }
          };
        } catch {
          results[current] = {
            runId: handle("run_"),
            ok: false,
            code: "E_INTERNAL_TRANSACTION",
            seed: params.seeds[current],
            strategy: params.strategy ?? "route-a",
            ticks: 0,
            completed: false,
            passed: false,
            crossed: false,
            failed: true,
            eventCount: 0,
            steps: 0,
            elapsedMs: 0,
            trace: [],
            provenance: { dev: true, devTampered: false, fixtures: 0, playerLegal: false },
            stats: { steps: 0, ticks: 0, actions: 0, events: 0 }
          };
        }
      }
    };
    await Promise.all([worker(), worker()]);
    return ok(results);
  }
  compareRuns(runA, runB) {
    if (this.mode !== "dev") return fail("E_PERMISSION", "compare_runs is dev-only");
    const a = this.runs.get(runA);
    const b = this.runs.get(runB);
    if (!a || !b) return fail("E_NOT_APPLICABLE", "unknown run handle");
    const sameState = a.summary.stateHash === b.summary.stateHash;
    const evA = gameplayEvents(a.events);
    const evB = gameplayEvents(b.events);
    const sameEvents = canonicalJson(evA) === canonicalJson(evB);
    let firstDivergence = null;
    const n = Math.max(evA.length, evB.length);
    for (let i = 0; i < n; i += 1) {
      const ea = evA[i];
      const eb = evB[i];
      if (!ea || !eb || canonicalJson(ea) !== canonicalJson(eb)) {
        firstDivergence = {
          index: i,
          ...ea ? { tickA: ea.tick, typeA: ea.type } : {},
          ...eb ? { tickB: eb.tick, typeB: eb.type } : {}
        };
        break;
      }
    }
    return ok({
      sameState,
      sameEvents,
      ...a.summary.stateHash ? { stateHashA: a.summary.stateHash } : {},
      ...b.summary.stateHash ? { stateHashB: b.summary.stateHash } : {},
      ...a.summary.eventsHash ? { eventsHashA: a.summary.eventsHash } : {},
      ...b.summary.eventsHash ? { eventsHashB: b.summary.eventsHash } : {},
      eventCountA: a.summary.eventCount,
      eventCountB: b.summary.eventCount,
      firstDivergence
    });
  }
  auditTail(sessionHandle2, limit = 16) {
    const record = this.records.get(sessionHandle2);
    if (!record || this.mode !== "dev") return [];
    return record.audit.slice(-Math.max(1, Math.min(limit, MAX_AUDIT)));
  }
  dispose() {
    for (const record of [...this.records.values()]) {
      try {
        record.owner.close();
      } catch {
      }
    }
    this.records.clear();
    this.snapshots.clear();
    this.snapshotOrder.length = 0;
    this.runs.clear();
    this.runOrder.length = 0;
    this.pending.clear();
    this.requestCache.clear();
    this.manager.dispose();
  }
}
const COOP_SCHEMA = "last_signal.ai-native.echo-coop-snapshot.v1";
const COOP_VERSION = 1;
const COOP_SCENARIO = "echo-coop-test";
const COOP_ROOM_ID = "station-zero-r1";
const SHARE_FIELDS = Object.freeze(["relationId", "stateLabel", "position"]);
function coopOk(value) {
  return { ok: true, value };
}
function coopFail(code, messageKey) {
  return { ok: false, code, messageKey };
}
function deepClone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
const MAX_MEMORY = 64;
const MAX_SHARED = 32;
const MAX_EVENTS = 256;
const ECHO_BUDGET_DEFAULT = 12;
const MAX_ISSUED = 64;
function hex24(seed, salt) {
  let h = 2166136261;
  const mix = (byte) => {
    h ^= byte & 255;
    h = Math.imul(h, 16777619) >>> 0;
  };
  for (let i = 0; i < 4; i += 1) mix(seed >>> i * 8);
  for (let i = 0; i < 4; i += 1) mix(salt >>> i * 8);
  let out = "";
  for (let i = 0; i < 24; i += 1) {
    mix(i + 1);
    out += (h >>> i % 8 * 4 & 15).toString(16);
  }
  return out;
}
function actorId(seed, salt) {
  return `act_${hex24(seed, salt).slice(0, 16)}`;
}
function hypothesisId(instanceSalt, n) {
  return `hyp_${hex24(n, parseInt(instanceSalt.slice(0, 8), 16) + n).slice(0, 16)}`;
}
function ttlAlive(observedAtTick, expiresAtTick, tick) {
  return observedAtTick <= tick && tick < expiresAtTick;
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function validPlan(value) {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "scan" || value.kind === "jam") return true;
  if (value.kind === "move") {
    return ["up", "down", "left", "right", "north", "south", "east", "west"].includes(value.direction) && Number.isInteger(value.ticks) && value.ticks >= 1 && value.ticks <= 1e3;
  }
  if (value.kind === "share") return Array.isArray(value.targetIds) && value.targetIds.every((x) => typeof x === "string");
  return false;
}
function validMemory(value) {
  return isRecord(value) && typeof value.kind === "string" && isFiniteNumber(value.tick) && typeof value.detail === "string" && (value.confidence === void 0 || isFiniteNumber(value.confidence));
}
function validProjection(value) {
  if (!isRecord(value)) return false;
  if (typeof value.targetId !== "string" || !isFiniteNumber(value.observedAtTick) || !isFiniteNumber(value.expiresAtTick)) return false;
  if (value.roomId !== "station-zero-r1" && value.roomId !== "station-zero-r2") return false;
  if (value.relationId !== void 0 && value.relationId !== null && typeof value.relationId !== "string") return false;
  if (value.stateLabel !== void 0 && typeof value.stateLabel !== "string") return false;
  if (value.position !== void 0 && (!isRecord(value.position) || !isFiniteNumber(value.position.x) || !isFiniteNumber(value.position.y))) return false;
  if (value.sourceActionId !== void 0 && typeof value.sourceActionId !== "string") return false;
  if (value.observerActorId !== void 0 && typeof value.observerActorId !== "string") return false;
  return true;
}
function validShared(value) {
  return isRecord(value) && validProjection(value.projection) && typeof value.sharedBy === "string" && isFiniteNumber(value.sharedAtTick) && Array.isArray(value.fields) && value.fields.every((f) => SHARE_FIELDS.includes(f));
}
function validHypothesis(value) {
  return isRecord(value) && typeof value.id === "string" && value.id.startsWith("hyp_") && typeof value.statement === "string" && isFiniteNumber(value.confidence) && value.confidence >= 0 && value.confidence <= 1 && isFiniteNumber(value.uncertainty) && value.uncertainty >= 0 && value.uncertainty <= 1 && ["proposed", "confirmed", "rejected"].includes(value.status) && Array.isArray(value.basedOn) && value.basedOn.every((x) => typeof x === "string") && isFiniteNumber(value.proposedAtTick) && validPlan(value.action);
}
function offlineEchoPolicy(observation, memory) {
  const targets = new Set(observation.evidence.map((e) => e.targetId));
  const confirmedJam = memory.some((m) => m.kind === "confirm" && m.detail.includes("jam"));
  const seenReceiver = targets.has("tgt_lab_door_receiver");
  const seenSource = targets.has("tgt_lab_seal_source");
  if (confirmedJam && seenReceiver) {
    return { kind: "move", direction: "east", ticks: 12, statement: "Move within jam range of the receiver and hold.", confidence: 0.8, uncertainty: 0.2 };
  }
  if (seenReceiver || seenSource) {
    return { kind: "share", targetIds: [...targets], statement: "Share the observed devices so the human can confirm a door plan.", confidence: 0.7, uncertainty: 0.3 };
  }
  return { kind: "scan", statement: "Scan locally to find a device before proposing anything.", confidence: 0.5, uncertainty: 0.5 };
}
class CoopSession {
  constructor(options) {
    this.scenario = COOP_SCENARIO;
    this.hypotheses = /* @__PURE__ */ new Map();
    this.eventLog = [];
    this.epoch = 0;
    this.pausedFlag = false;
    this.takenOverFlag = false;
    this.echoCancelledFlag = false;
    this.echoLinkLostFlag = false;
    this.echoBudget = ECHO_BUDGET_DEFAULT;
    this.echoMoveIntent = NO_MOVEMENT;
    this.echoMoveRemaining = 0;
    this.humanMoveIntent = NO_MOVEMENT;
    this.humanMoveRemaining = 0;
    this.hypothesisCounter = 0;
    this.nextActionSeq = 0;
    this.issued = /* @__PURE__ */ new Map();
    this.snapshotCounter = 0;
    const capability = randomBytes(12).toString("hex");
    this.instanceId = `inst_${capability.slice(0, 16)}`;
    this.sessionId = `ses_${capability}`;
    const instSeed = (options.seed ^ parseInt(capability.slice(0, 8), 16)) >>> 0;
    this.instanceSalt = capability;
    this.model = new SliceModel();
    this.testFixture = options.fixture?.test === true;
    this.human = {
      actorId: actorId(instSeed, 17),
      role: "PLAYER",
      position: { x: 0, y: 0 },
      sensorRange: options.humanSensorRange ?? 1.5,
      goal: null,
      memory: [],
      evidence: [],
      shared: []
    };
    this.echo = {
      actorId: actorId(instSeed, 34),
      role: "COMPANION",
      position: { x: 0, y: 0 },
      sensorRange: options.echoSensorRange ?? 1.5,
      goal: null,
      memory: [],
      evidence: [],
      shared: []
    };
    if (options.fixture?.test) {
      this.model.setPlayerPos(options.fixture.human.x, options.fixture.human.y);
      this.echo.position = { x: options.fixture.echo.x, y: options.fixture.echo.y };
    } else {
      this.echo.position = { x: 3.5, y: 5.5 };
    }
    this.human.position = { x: this.model.position.x, y: this.model.position.y };
    if (typeof options.echoBudget === "number") this.echoBudget = Math.max(0, Math.floor(options.echoBudget));
  }
  // --- shared helpers ------------------------------------------------------
  nextActionId(salt) {
    this.nextActionSeq += 1;
    return `aid_${hex24(this.nextActionSeq, salt).slice(0, 24)}`;
  }
  record(actor, kind, detail) {
    this.eventLog.push({ tick: this.model.tick, actor, kind, detail });
    while (this.eventLog.length > MAX_EVENTS) this.eventLog.shift();
  }
  remember(actor, entry) {
    actor.memory.push(entry);
    while (actor.memory.length > MAX_MEMORY) actor.memory.shift();
  }
  echoBlocked() {
    if (this.pausedFlag) return coopFail("E_PAUSED", "human paused the session");
    if (this.takenOverFlag) return coopFail("E_PERMISSION", "human has taken over; ECHO is stopped");
    if (this.echoCancelledFlag) return coopFail("E_CANCELLED", "ECHO action was cancelled");
    if (this.echoLinkLostFlag) return coopFail("E_LINK_UNAVAILABLE", "ECHO link is lost");
    if (this.echoBudget <= 0) return coopFail("E_RESOURCE_LIMIT", "ECHO action budget exhausted");
    return null;
  }
  spendEchoBudget() {
    this.echoBudget = Math.max(0, this.echoBudget - 1);
  }
  advance(ticks) {
    if (this.pausedFlag) return 0;
    let advanced = 0;
    for (let i = 0; i < ticks; i += 1) {
      if (this.model.failed) break;
      const before = this.model.snapshot();
      const doorBefore = before.doorState;
      this.model.advanceTicks(1, () => {
        if (this.humanMoveRemaining > 0) {
          const p = stepMovementAt(this.model, this.humanMoveIntent, this.model.position.x, this.model.position.y);
          this.model.setPlayerPos(p.x, p.y);
          this.humanMoveRemaining -= 1;
          if (this.humanMoveRemaining === 0) this.humanMoveIntent = NO_MOVEMENT;
        }
        if (this.echoMoveRemaining > 0 && !this.takenOverFlag && !this.pausedFlag) {
          const p = stepMovementAt(this.model, this.echoMoveIntent, this.echo.position.x, this.echo.position.y);
          this.echo.position = { x: p.x, y: p.y };
          this.echoMoveRemaining -= 1;
          if (this.echoMoveRemaining === 0) this.echoMoveIntent = NO_MOVEMENT;
        }
      }, () => {
        resolveTransitions(this.model, before);
      });
      advanced += 1;
      this.human.position = { x: this.model.position.x, y: this.model.position.y };
      if (this.model.doorState !== doorBefore) this.record("human", "device", `door ${doorBefore}->${this.model.doorState}`);
    }
    return advanced;
  }
  // --- human actions -------------------------------------------------------
  humanScan() {
    const provenance = { sourceActionId: this.nextActionId(1), observerActorId: this.human.actorId, sceneEpoch: this.epoch };
    const out = this.model.scanFrom(this.human.position.x, this.human.position.y, provenance, this.human.sensorRange);
    if (out.result.code === "OK") this.human.evidence = out.evidence.map((e) => ({ ...e, position: { ...e.position } }));
    this.remember(this.human, { kind: "scan", tick: this.model.tick, detail: out.result.code });
    this.record("human", "scan", out.evidence.map((e) => e.targetId).join(",") || "none");
    return coopOk(out.result);
  }
  humanMove(direction, ticks) {
    if (this.pausedFlag) return coopFail("E_PAUSED", "session is paused");
    this.humanMoveIntent = directionToIntent(direction);
    this.humanMoveRemaining = Math.max(0, Math.floor(ticks));
    const advanced = this.advance(this.humanMoveRemaining);
    this.human.position = { x: this.model.position.x, y: this.model.position.y };
    return coopOk({ advanced, position: { ...this.human.position } });
  }
  humanJam() {
    const result = this.model.jam("relay");
    this.remember(this.human, { kind: "action", tick: this.model.tick, detail: `jam ${result.code}` });
    this.record("human", "jam", result.code);
    return coopOk(result);
  }
  advanceTicks(ticks) {
    if (this.pausedFlag) return coopFail("E_PAUSED", "session is paused");
    return coopOk({ advanced: this.advance(Math.max(0, Math.floor(ticks))) });
  }
  // --- ECHO actions --------------------------------------------------------
  echoScan() {
    const blocked = this.echoBlocked();
    if (blocked) return blocked;
    const provenance = { sourceActionId: this.nextActionId(2), observerActorId: this.echo.actorId, sceneEpoch: this.epoch };
    const out = this.model.scanFrom(this.echo.position.x, this.echo.position.y, provenance, this.echo.sensorRange);
    if (out.result.code === "OK") {
      this.echo.evidence = out.evidence.map((e) => ({ ...e, position: { ...e.position } }));
      this.spendEchoBudget();
      this.remember(this.echo, { kind: "scan", tick: this.model.tick, detail: out.evidence.map((e) => e.targetId).join(",") });
      this.record("echo", "scan", out.evidence.map((e) => e.targetId).join(",") || "none");
    }
    return coopOk({ result: out.result, evidenceTargets: out.evidence.map((e) => e.targetId) });
  }
  echoMove(direction, ticks) {
    const blocked = this.echoBlocked();
    if (blocked) return blocked;
    this.spendEchoBudget();
    this.echoMoveIntent = directionToIntent(direction);
    this.echoMoveRemaining = Math.max(0, Math.floor(ticks));
    const advanced = this.advance(this.echoMoveRemaining);
    this.record("echo", "move", `${direction}:${advanced}`);
    return coopOk({ advanced, position: { ...this.echo.position } });
  }
  echoJam() {
    const blocked = this.echoBlocked();
    if (blocked) return blocked;
    const result = this.model.jamFrom(this.echo.position.x, this.echo.position.y, "relay");
    this.spendEchoBudget();
    this.remember(this.echo, { kind: "action", tick: this.model.tick, detail: `jam ${result.code}` });
    this.record("echo", "jam", result.code);
    return coopOk(result);
  }
  trimEvidence(e, fields) {
    return {
      targetId: e.targetId,
      observedAtTick: e.observedAtTick,
      expiresAtTick: e.expiresAtTick,
      roomId: e.roomId,
      ...e.sourceActionId !== void 0 ? { sourceActionId: e.sourceActionId } : {},
      ...e.observerActorId !== void 0 ? { observerActorId: e.observerActorId } : {},
      ...fields.includes("relationId") ? { relationId: e.relationId } : {},
      ...fields.includes("stateLabel") ? { stateLabel: e.stateLabel } : {},
      ...fields.includes("position") ? { position: { x: e.position.x, y: e.position.y } } : {}
    };
  }
  shareOwned(source, recipient, targetIds, fields) {
    if (fields.length === 0) return coopFail("E_SCHEMA", "share fields must not be empty");
    const unknown = fields.filter((f) => !SHARE_FIELDS.includes(f));
    if (unknown.length > 0) return coopFail("E_SCHEMA", "unknown share fields are rejected");
    const whitelist = fields;
    const chosen = source.evidence.filter((e) => targetIds.includes(e.targetId));
    if (chosen.length === 0) return coopFail("E_ILLEGAL_TARGET", "no owned evidence matches the requested targets");
    for (const evidence of chosen) {
      recipient.shared.push({
        projection: this.trimEvidence(evidence, whitelist),
        // deep, field-trimmed, no alias
        sharedBy: source.actorId,
        sharedAtTick: this.model.tick,
        fields: [...whitelist]
      });
    }
    while (recipient.shared.length > MAX_SHARED) recipient.shared.shift();
    return coopOk({ shared: chosen.length });
  }
  /** ECHO shares a field-whitelisted subset of its OWN evidence to the human. */
  echoShare(targetIds, fields) {
    const blocked = this.echoBlocked();
    if (blocked) return blocked;
    const res = this.shareOwned(this.echo, this.human, targetIds, fields);
    if (!res.ok) return res;
    this.spendEchoBudget();
    this.remember(this.echo, { kind: "share", tick: this.model.tick, detail: targetIds.join(",") });
    this.record("echo", "share", `${targetIds.join(",")}:${fields.join("+")}`);
    return res;
  }
  /** Human shares a field-whitelisted subset of its OWN evidence to ECHO. */
  humanShare(targetIds, fields) {
    const res = this.shareOwned(this.human, this.echo, targetIds, fields);
    if (!res.ok) return res;
    this.record("human", "share", `${targetIds.join(",")}:${fields.join("+")}`);
    return res;
  }
  // --- hypotheses (never auto-canonical) -----------------------------------
  proposeHypothesis(plan, statement, confidence, uncertainty) {
    if (this.takenOverFlag || this.pausedFlag || this.echoCancelledFlag) return coopFail("E_PERMISSION", "ECHO cannot propose while stopped");
    if (!validPlan(plan)) return coopFail("E_SCHEMA", "hypothesis plan is invalid");
    this.hypothesisCounter += 1;
    const frozenPlan = deepFreeze(deepClone(plan));
    const hypothesis = deepFreeze({
      id: hypothesisId(this.instanceSalt, this.hypothesisCounter),
      statement: String(statement).slice(0, 200),
      confidence: Math.max(0, Math.min(1, confidence)),
      uncertainty: Math.max(0, Math.min(1, uncertainty)),
      basedOn: this.echo.evidence.map((e) => e.targetId),
      status: "proposed",
      proposedAtTick: this.model.tick,
      action: frozenPlan
    });
    this.hypotheses.set(hypothesis.id, hypothesis);
    this.remember(this.echo, { kind: "hypothesis", tick: this.model.tick, detail: hypothesis.statement, confidence: hypothesis.confidence });
    this.record("echo", "hypothesis", `${hypothesis.id}:${hypothesis.statement}`);
    return coopOk(hypothesis);
  }
  humanConfirm(id) {
    const h = this.hypotheses.get(id);
    if (!h) return coopFail("E_TARGET_DESTROYED", "unknown hypothesis");
    if (h.status !== "proposed") return coopFail("E_RETRYABLE", "hypothesis already resolved");
    const updated = deepFreeze({ ...h, status: "confirmed" });
    this.hypotheses.set(id, updated);
    this.echo.goal = h.statement;
    this.remember(this.human, { kind: "confirm", tick: this.model.tick, detail: h.statement });
    this.remember(this.echo, { kind: "confirm", tick: this.model.tick, detail: h.statement });
    this.record("human", "confirm", id);
    return coopOk(updated);
  }
  humanReject(id) {
    const h = this.hypotheses.get(id);
    if (!h) return coopFail("E_TARGET_DESTROYED", "unknown hypothesis");
    if (h.status !== "proposed") return coopFail("E_RETRYABLE", "hypothesis already resolved");
    const updated = deepFreeze({ ...h, status: "rejected" });
    this.hypotheses.set(id, updated);
    this.remember(this.human, { kind: "reject", tick: this.model.tick, detail: h.statement });
    this.record("human", "reject", id);
    return coopOk(updated);
  }
  /** Only a CONFIRMED hypothesis may execute; otherwise zero side effects. */
  executeHypothesis(id) {
    const h = this.hypotheses.get(id);
    if (!h) return coopFail("E_TARGET_DESTROYED", "unknown hypothesis");
    if (h.status !== "confirmed") return coopFail("E_PERMISSION", "hypothesis is not confirmed; ECHO must not act");
    const blocked = this.echoBlocked();
    if (blocked) return blocked;
    const plan = h.action;
    if (plan.kind === "scan") {
      const r2 = this.echoScan();
      return r2.ok ? coopOk({ plan, result: r2.value }) : r2;
    }
    if (plan.kind === "move") {
      const r2 = this.echoMove(plan.direction, plan.ticks);
      return r2.ok ? coopOk({ plan, result: r2.value }) : r2;
    }
    if (plan.kind === "jam") {
      const r2 = this.echoJam();
      return r2.ok ? coopOk({ plan, result: r2.value }) : r2;
    }
    const r = this.echoShare(plan.targetIds, ["targetId", "stateLabel", "relationId", "position"].filter((f) => SHARE_FIELDS.includes(f)));
    return r.ok ? coopOk({ plan, result: r.value }) : r;
  }
  // --- offline policy ------------------------------------------------------
  offlineEchoStep() {
    const obs = this.observe("echo");
    if (!obs.ok) return obs;
    const decision = offlineEchoPolicy(obs.value, this.echo.memory);
    const plan = decision.kind === "move" ? { kind: "move", direction: decision.direction, ticks: decision.ticks } : decision.kind === "share" ? { kind: "share", targetIds: [...decision.targetIds] } : { kind: decision.kind };
    const proposed = this.proposeHypothesis(plan, decision.statement, decision.confidence, decision.uncertainty);
    return proposed.ok ? coopOk({ observation: obs.value, hypothesis: proposed.value }) : proposed;
  }
  // --- human owner management (ECHO calls rejected) ------------------------
  pause() {
    this.pausedFlag = true;
    this.echoMoveRemaining = 0;
    this.echoMoveIntent = NO_MOVEMENT;
    this.record("human", "pause", "echo stopped");
    return coopOk({ paused: true });
  }
  resume() {
    this.pausedFlag = false;
    this.record("human", "resume", "");
    return coopOk({ paused: false });
  }
  takeover() {
    this.takenOverFlag = true;
    this.echoMoveRemaining = 0;
    this.echoMoveIntent = NO_MOVEMENT;
    this.record("human", "takeover", "echo stopped");
    return coopOk({ takenOver: true });
  }
  release() {
    this.takenOverFlag = false;
    this.record("human", "release", "");
    return coopOk({ takenOver: false });
  }
  echoManagementAttempt(action) {
    return coopFail("E_PERMISSION", `ECHO may not call owner action ${action}`);
  }
  cancelEcho() {
    this.echoCancelledFlag = true;
    this.echoMoveRemaining = 0;
    this.echoMoveIntent = NO_MOVEMENT;
    this.record("human", "cancel-echo", "");
    return coopOk({ cancelled: true });
  }
  loseEchoLink() {
    this.echoLinkLostFlag = true;
    this.record("human", "link-lost", "");
    return coopOk({ linkLost: true });
  }
  restoreEchoLink() {
    this.echoLinkLostFlag = false;
    this.record("human", "link-restored", "");
    return coopOk({ linkLost: false });
  }
  // --- observation projection ---------------------------------------------
  observe(actor, detail = "standard") {
    const source = actor === "human" ? this.human : this.echo;
    const tick = this.model.tick;
    const own = (actor === "human" ? this.human.evidence : this.echo.evidence).filter((e) => ttlAlive(e.observedAtTick, e.expiresAtTick, tick));
    const shared = source.shared.filter((s) => ttlAlive(s.projection.observedAtTick, s.projection.expiresAtTick, tick));
    const evidence = [
      ...own.map((e) => this.fullEvidenceToObs(e, source.actorId)),
      ...shared.map((s) => this.sharedToObs(s, source.actorId))
    ];
    const visibleTargets = [
      ...own.map((e) => ({
        targetId: e.targetId,
        kind: this.targetKind(e.targetId),
        publicState: e.stateLabel,
        position: { x: e.position.x, y: e.position.y },
        visibility: "scan-revealed"
      })),
      ...shared.map((s) => ({
        targetId: s.projection.targetId,
        kind: this.targetKind(s.projection.targetId),
        publicState: s.projection.stateLabel ?? "shared",
        ...s.projection.position ? { position: { x: s.projection.position.x, y: s.projection.position.y } } : {},
        visibility: "echo-shared"
      }))
    ];
    const relationTargets = {
      rel_lab_seal_link: { from: "tgt_lab_seal_source", to: "tgt_lab_door_receiver" },
      rel_corridor_relay_bridge: { from: "tgt_corridor_relay", to: "tgt_corridor_bridge" },
      rel_corridor_relay_perception: { from: "tgt_corridor_relay", to: "tgt_corridor_guard" }
    };
    const connections = [];
    const addRelation = (relationId, targetId, at) => {
      if (!relationId) return;
      const map = relationTargets[relationId];
      if (!map || connections.some((c) => c.relationId === relationId)) return;
      connections.push({ relationId, fromTargetId: map.from, toTargetId: map.to, stateLabel: "link-visible", evidenceId: `ev_${hex24(at, 51).slice(0, 16)}` });
    };
    for (const e of own) addRelation(e.relationId, e.targetId, e.observedAtTick);
    for (const s of shared) addRelation(s.projection.relationId, s.projection.targetId, s.projection.observedAtTick);
    const position = actor === "human" ? { x: this.model.position.x, y: this.model.position.y } : { ...this.echo.position };
    const snapshot = this.model.snapshot();
    const obs = {
      schema: AI_NATIVE_OBSERVATION_SCHEMA_V1,
      protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      epoch: this.epoch,
      tick,
      actorId: source.actorId,
      role: source.role,
      detail,
      roomId: COOP_ROOM_ID,
      current: {
        self: { position, energy: this.model.energy, alive: !this.model.failed, paused: this.pausedFlag, passed: this.model.passed, crossed: false, failed: this.model.failed, completed: false },
        publicDeviceState: { door: this.model.doorState, doorPassable: this.model.doorPassable },
        publicTimers: {
          scanCooldownTicks: snapshot.scanCooldownTicks,
          jamCooldownTicks: snapshot.jamCooldownTicks,
          scanRevealRemainingTicks: snapshot.scanRevealTicks,
          jamRemainingTicks: snapshot.jamRemainingTicks,
          safeClearRemainingTicks: snapshot.safeClearTicks
        },
        visibleTargets,
        knownConnections: connections
      },
      evidence,
      knowledge: [],
      hypotheses: [],
      // P0 schema caps this at 0; hypotheses are exposed by the coop surface
      events: [],
      availableActions: this.availableActions(actor),
      omittedFieldCount: 0
    };
    const validated = validateObservationDetailed(obs);
    if (!validated.ok) return coopFail(validated.issue.code, "observation invalid");
    if (hasHiddenField(obs, ["role"]) !== null) return coopFail("E_INTERNAL_TRANSACTION", "observation leaked a hidden field");
    return coopOk(obs);
  }
  targetKind(targetId) {
    if (targetId.includes("receiver")) return "receiver";
    if (targetId.includes("source")) return "source";
    if (targetId.includes("relay")) return "relay";
    if (targetId.includes("bridge")) return "bridge";
    if (targetId.includes("guard")) return "guard";
    return "control";
  }
  fullEvidenceToObs(e, fallbackActor) {
    return {
      schema: AI_NATIVE_OBSERVATION_SCHEMA_V1,
      protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      evidenceId: `ev_${hex24(e.observedAtTick, 68).slice(0, 16)}`,
      sceneEpoch: e.sceneEpoch ?? this.epoch,
      roomId: e.roomId,
      sourceActionId: e.sourceActionId ?? `aid_${hex24(e.observedAtTick, 85).slice(0, 24)}`,
      source: "player-scan",
      observerActorId: e.observerActorId ?? fallbackActor,
      observerPosition: { x: e.position.x, y: e.position.y },
      targetId: e.targetId,
      ...e.relationId ? { relationId: e.relationId } : {},
      observedAtTick: e.observedAtTick,
      expiresAtTick: e.expiresAtTick,
      observedState: Object.freeze({ stateLabel: e.stateLabel })
    };
  }
  sharedToObs(s, recipientActor) {
    const p = s.projection;
    return {
      schema: AI_NATIVE_OBSERVATION_SCHEMA_V1,
      protocolVersion: AI_NATIVE_PROTOCOL_VERSION,
      evidenceId: `ev_${hex24(p.observedAtTick, 102).slice(0, 16)}`,
      sceneEpoch: this.epoch,
      roomId: p.roomId,
      sourceActionId: p.sourceActionId ?? `aid_${hex24(p.observedAtTick, 119).slice(0, 24)}`,
      source: "player-scan",
      observerActorId: p.observerActorId ?? s.sharedBy ?? recipientActor,
      observerPosition: p.position ? { x: p.position.x, y: p.position.y } : { x: 0, y: 0 },
      // redacted: real position not shared
      targetId: p.targetId,
      ...typeof p.relationId === "string" && p.relationId.length > 0 ? { relationId: p.relationId } : {},
      observedAtTick: p.observedAtTick,
      expiresAtTick: p.expiresAtTick,
      observedState: Object.freeze(p.stateLabel !== void 0 ? { stateLabel: p.stateLabel } : {})
    };
  }
  availableActions(actor) {
    const snapshot = this.model.snapshot();
    const out = [
      { type: "move", status: this.pausedFlag ? "unavailable" : "available", maxDurationTicks: 3600 },
      { type: "scan", status: snapshot.scanCooldownTicks > 0 ? "cooldown" : snapshot.energy < SLICE.SCAN_COST ? "insufficient_energy" : "available", ...snapshot.scanCooldownTicks > 0 ? { reasonCode: "E_COOLDOWN" } : {} },
      { type: "wait", status: this.pausedFlag ? "unavailable" : "available" }
    ];
    if (actor === "human") out.push({ type: "jam", status: snapshot.energy < SLICE.JAM_COST ? "insufficient_energy" : "available" });
    else if ([...this.hypotheses.values()].some((h) => h.status === "confirmed")) out.push({ type: "jam", status: snapshot.energy < SLICE.JAM_COST ? "insufficient_energy" : "available" });
    return out;
  }
  // --- status / handles ----------------------------------------------------
  /** Trusted full status (owner/Dev only). */
  status() {
    return {
      scenario: COOP_SCENARIO,
      testFixture: this.testFixture,
      tick: this.model.tick,
      epoch: this.epoch,
      paused: this.pausedFlag,
      takenOver: this.takenOverFlag,
      echoCancelled: this.echoCancelledFlag,
      echoLinkLost: this.echoLinkLostFlag,
      echoBudget: this.echoBudget,
      human: { actorId: this.human.actorId, position: { ...this.human.position }, goal: this.human.goal, evidenceTargets: this.human.evidence.map((e) => e.targetId), sharedTargets: this.human.shared.map((s) => s.projection.targetId), memory: this.human.memory.length },
      echo: {
        actorId: this.echo.actorId,
        position: { ...this.echo.position },
        goal: this.echo.goal,
        evidenceTargets: this.echo.evidence.map((e) => e.targetId),
        sharedTargets: this.echo.shared.map((s) => s.projection.targetId),
        memory: this.echo.memory.length,
        hypotheses: [...this.hypotheses.values()].map((h) => ({ id: h.id, status: h.status, statement: h.statement }))
      }
    };
  }
  /** Actor-scoped ECHO status: never exposes human private fields. */
  echoStatus() {
    return {
      scenario: COOP_SCENARIO,
      testFixture: this.testFixture,
      tick: this.model.tick,
      epoch: this.epoch,
      paused: this.pausedFlag,
      takenOver: this.takenOverFlag,
      echoCancelled: this.echoCancelledFlag,
      echoLinkLost: this.echoLinkLostFlag,
      echoBudget: this.echoBudget,
      humanActorId: this.human.actorId,
      echo: {
        actorId: this.echo.actorId,
        position: { ...this.echo.position },
        sensorRange: this.echo.sensorRange,
        goal: this.echo.goal,
        evidenceTargets: this.echo.evidence.map((e) => e.targetId),
        sharedTargets: this.echo.shared.map((s) => s.projection.targetId),
        memory: this.echo.memory.length,
        hypotheses: [...this.hypotheses.values()].map((h) => ({ id: h.id, status: h.status, statement: h.statement }))
      }
    };
  }
  events() {
    return this.eventLog.slice();
  }
  humanHandle() {
    return {
      actorId: this.human.actorId,
      role: "PLAYER",
      observe: (d) => this.observe("human", d),
      scan: () => this.humanScan(),
      move: (dir, ticks) => this.humanMove(dir, ticks),
      jam: () => this.humanJam(),
      pause: () => this.pause(),
      resume: () => this.resume(),
      takeover: () => this.takeover(),
      release: () => this.release(),
      share: (targetIds, fields) => this.humanShare(targetIds, fields),
      confirm: (id) => this.humanConfirm(id),
      reject: (id) => this.humanReject(id),
      cancelEcho: () => this.cancelEcho(),
      status: () => this.status(),
      events: () => this.events()
    };
  }
  companionHandle() {
    return {
      actorId: this.echo.actorId,
      role: "COMPANION",
      observe: (d) => this.observe("echo", d),
      scan: () => this.echoScan(),
      move: (dir, ticks) => this.echoMove(dir, ticks),
      share: (targetIds, fields) => this.echoShare(targetIds, fields),
      propose: (plan, statement, confidence, uncertainty) => this.proposeHypothesis(plan, statement, confidence, uncertainty),
      execute: (id) => this.executeHypothesis(id),
      offlineStep: () => this.offlineEchoStep(),
      management: (action) => this.echoManagementAttempt(action),
      status: () => this.echoStatus()
    };
  }
  // --- isolated signed test snapshot (does not touch the Player schema) ----
  nextSnapshotId() {
    const id = `csnap_${this.instanceSalt.slice(0, 12)}${this.snapshotCounter.toString(36)}`;
    this.snapshotCounter += 1;
    return id;
  }
  snapshotPayload() {
    const human = deepClone(this.human);
    const echo = deepClone(this.echo);
    return {
      schema: COOP_SCHEMA,
      version: COOP_VERSION,
      instanceId: this.instanceId,
      sessionId: this.sessionId,
      tick: this.model.tick,
      epoch: this.epoch,
      model: this.model.captureFull(),
      state: {
        human,
        echo,
        hypotheses: [...this.hypotheses.values()].map((h) => deepClone(h)),
        paused: this.pausedFlag,
        takenOver: this.takenOverFlag,
        echoCancelled: this.echoCancelledFlag,
        echoLinkLost: this.echoLinkLostFlag,
        echoBudget: this.echoBudget,
        humanMoveIntent: { ...this.humanMoveIntent },
        humanMoveRemaining: this.humanMoveRemaining,
        echoMoveIntent: { ...this.echoMoveIntent },
        echoMoveRemaining: this.echoMoveRemaining,
        nextActionSeq: this.nextActionSeq,
        hypothesisCounter: this.hypothesisCounter
      }
    };
  }
  snapshot() {
    const payload2 = this.snapshotPayload();
    const snapshotId = this.nextSnapshotId();
    this.issued.set(snapshotId, canonicalJson(payload2));
    while (this.issued.size > MAX_ISSUED) {
      const oldest = this.issued.keys().next().value;
      if (oldest === void 0) break;
      this.issued.delete(oldest);
    }
    return { ...payload2, snapshotId, publicHash: payloadFingerprint(payload2) };
  }
  restore(frame) {
    if (!isRecord(frame)) return coopFail("E_SCHEMA", "coop snapshot must be an object");
    if (frame.schema !== COOP_SCHEMA) return coopFail("E_REPLAY_INCOMPATIBLE", "unknown coop snapshot schema");
    if (frame.version !== COOP_VERSION) return coopFail("E_VERSION_UNSUPPORTED", "unsupported coop snapshot version");
    if (frame.instanceId !== this.instanceId) return coopFail("E_SNAPSHOT_INVALID", "snapshot instance does not match this instance");
    if (frame.sessionId !== this.sessionId) return coopFail("E_SNAPSHOT_INVALID", "snapshot session does not match this instance");
    if (typeof frame.snapshotId !== "string") return coopFail("E_SNAPSHOT_INVALID", "snapshot lacks an issued handle");
    const expected = this.issued.get(frame.snapshotId);
    if (expected === void 0) return coopFail("E_SNAPSHOT_INVALID", "snapshot was not issued by this instance or was evicted");
    const { snapshotId: _ignored, publicHash: _public, ...payload2 } = frame;
    let actualIdentity;
    try {
      actualIdentity = canonicalJson(payload2);
    } catch {
      return coopFail("E_SNAPSHOT_INVALID", "snapshot payload is not canonical");
    }
    if (actualIdentity !== expected) return coopFail("E_SNAPSHOT_INVALID", "snapshot content does not match the issued frame");
    const state = frame.state;
    if (!isRecord(state)) return coopFail("E_SCHEMA", "coop snapshot state is missing");
    const human = state.human;
    const echo = state.echo;
    if (!isRecord(human) || !isRecord(echo)) return coopFail("E_SCHEMA", "coop snapshot actors are missing");
    if (!isFullSliceState(frame.model)) return coopFail("E_SNAPSHOT_INVALID", "coop snapshot model is invalid");
    if (!isFiniteNumber(frame.tick) || !isFiniteNumber(frame.epoch)) return coopFail("E_SCHEMA", "coop snapshot tick/epoch invalid");
    const humanPos = human.position;
    const echoPos = echo.position;
    if (!isRecord(humanPos) || !isFiniteNumber(humanPos.x) || !isFiniteNumber(humanPos.y)) return coopFail("E_SNAPSHOT_INVALID", "human position invalid");
    if (!isRecord(echoPos) || !isFiniteNumber(echoPos.x) || !isFiniteNumber(echoPos.y)) return coopFail("E_SNAPSHOT_INVALID", "echo position invalid");
    const candidate = new SliceModel();
    candidate.restoreFull(frame.model);
    if (Math.abs(candidate.position.x - humanPos.x) > 1e-6 || Math.abs(candidate.position.y - humanPos.y) > 1e-6) {
      return coopFail("E_SNAPSHOT_INVALID", "human position does not match the model");
    }
    if (!candidate.canStandAt(echoPos.x, echoPos.y)) return coopFail("E_SNAPSHOT_INVALID", "echo position is not standable");
    if (![human.memory, human.evidence, human.shared, echo.memory, echo.evidence, echo.shared].every(Array.isArray)) {
      return coopFail("E_SCHEMA", "coop snapshot actor arrays missing");
    }
    if (!human.memory.every(validMemory) || !echo.memory.every(validMemory)) return coopFail("E_SNAPSHOT_INVALID", "coop snapshot memory invalid");
    if (!human.shared.every(validShared) || !echo.shared.every(validShared)) return coopFail("E_SNAPSHOT_INVALID", "coop snapshot shared evidence invalid");
    if (!isFiniteNumber(state.echoBudget) || state.echoBudget < 0 || state.echoBudget > 1e3) return coopFail("E_SNAPSHOT_INVALID", "coop snapshot budget invalid");
    const hypotheses = state.hypotheses;
    if (!Array.isArray(hypotheses) || !hypotheses.every(validHypothesis)) return coopFail("E_SNAPSHOT_INVALID", "coop snapshot hypotheses invalid");
    this.model.restoreFull(frame.model);
    this.epoch = Math.max(this.epoch + 1, frame.epoch + 1);
    this.human.position = { x: candidate.position.x, y: candidate.position.y };
    this.human.goal = human.goal ?? null;
    this.human.memory = deepClone(human.memory);
    this.human.evidence = deepClone(human.evidence);
    this.human.shared = deepClone(human.shared);
    this.echo.position = { x: echoPos.x, y: echoPos.y };
    this.echo.goal = echo.goal ?? null;
    this.echo.memory = deepClone(echo.memory);
    this.echo.evidence = deepClone(echo.evidence);
    this.echo.shared = deepClone(echo.shared);
    this.hypotheses.clear();
    for (const h of hypotheses) this.hypotheses.set(h.id, deepFreeze(deepClone(h)));
    this.pausedFlag = state.paused === true;
    this.takenOverFlag = state.takenOver === true;
    this.echoCancelledFlag = state.echoCancelled === true;
    this.echoLinkLostFlag = state.echoLinkLost === true;
    this.echoBudget = state.echoBudget;
    const hmi = state.humanMoveIntent;
    this.humanMoveIntent = hmi ? { ...hmi } : NO_MOVEMENT;
    this.echoMoveIntent = state.echoMoveIntent ? { ...state.echoMoveIntent } : NO_MOVEMENT;
    this.humanMoveRemaining = isFiniteNumber(state.humanMoveRemaining) ? state.humanMoveRemaining : 0;
    this.echoMoveRemaining = isFiniteNumber(state.echoMoveRemaining) ? state.echoMoveRemaining : 0;
    this.nextActionSeq = isFiniteNumber(state.nextActionSeq) ? state.nextActionSeq : 0;
    this.hypothesisCounter = isFiniteNumber(state.hypothesisCounter) ? state.hypothesisCounter : 0;
    return coopOk({ tick: this.model.tick, epoch: this.epoch });
  }
}
class CoopManager {
  constructor(maxSessions = 10, budget) {
    this.sessions = /* @__PURE__ */ new Map();
    this.counter = 0;
    this.maxSessions = maxSessions;
    this.budget = budget ?? createProcessSessionBudget(maxSessions);
  }
  get size() {
    return this.sessions.size;
  }
  /**
   * Coop worlds compete for the SAME shared per-process budget as ordinary
   * Player sessions, so the process can never exceed the total cap.
   */
  create(options) {
    if (!this.budget.tryAcquire()) return coopFail("E_RESOURCE_LIMIT", "process session budget exhausted");
    try {
      this.counter += 1;
      const handle2 = `coop_${this.counter.toString(16).padStart(24, "0").slice(-24)}`;
      const session = new CoopSession(options);
      this.sessions.set(handle2, session);
      return coopOk({ handle: handle2, session });
    } catch (error) {
      this.budget.release();
      throw error;
    }
  }
  get(handle2) {
    return this.sessions.get(handle2);
  }
  close(handle2) {
    if (this.sessions.delete(handle2)) {
      this.budget.release();
      return true;
    }
    return false;
  }
  dispose() {
    for (const session of this.sessions.values()) this.budget.release();
    this.sessions.clear();
  }
}
const RESULT_SCHEMA = "last_signal.mcp.tool-result.v1";
const SESSION_RE = /^ses_[0-9a-f]{24}$/;
const ACTION_RE = /^aid_[0-9a-f]{24}$/;
const REQUEST_RE = /^req_[0-9a-f]{24}$/;
const SNAPSHOT_RE = /^snapref_[0-9a-f]{24}$/;
const RUN_RE = /^run_[0-9a-f]{24}$/;
function payload(data, isError = false) {
  const body = { schema: RESULT_SCHEMA, ...data };
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    structuredContent: body,
    ...isError ? { isError: true } : {}
  };
}
function withSessionId(data) {
  return typeof data.session === "string" ? { ...data, sessionId: data.session } : data;
}
function okPayload(data) {
  return payload(withSessionId({ ok: true, ...data }));
}
function errPayload(code, messageKey, extra = {}) {
  return payload(withSessionId({ ok: false, code, messageKey, ...extra }), true);
}
function fromHarness(res, map, extra = {}) {
  return res.ok ? okPayload({ ...extra, ...map(res.value) }) : errPayload(res.code, res.messageKey, extra);
}
function sanitizeEvent(event, session) {
  return { ...event, sessionId: session };
}
function sanitizeObservation(obs, session) {
  return {
    ...obs,
    sessionId: session,
    // Nested event objects must carry the opaque MCP session too.
    events: obs.events.map((e) => sanitizeEvent(e, session))
  };
}
function sanitizeActionResult(result, session) {
  return { ...result, sessionId: session };
}
function sanitizeStepResult(result, session) {
  return {
    ...result,
    sessionId: session,
    actionResults: result.actionResults.map((r) => sanitizeActionResult(r, session)),
    events: result.events.map((e) => sanitizeEvent(e, session)),
    ...result.observation ? { observation: sanitizeObservation(result.observation, session) } : {}
  };
}
function eventSummary(events, session, limit = 8) {
  return events.slice(0, limit).map((e) => sanitizeEvent(e, session));
}
const sessionHandle = z.string().regex(SESSION_RE);
const actionId = z.string().regex(ACTION_RE);
const actionInput = z.strictObject({
  actionId: actionId.optional(),
  type: z.enum(["move", "aim", "fire", "scan", "jam", "interact", "shoot_guard", "decoy", "wait"]),
  payload: z.record(z.string(), z.unknown())
});
const replayStep = z.strictObject({
  actions: z.array(z.record(z.string(), z.unknown())).max(32).optional(),
  ticks: z.number().int().min(1).max(1e3)
});
const fixtureInput = z.union([
  z.strictObject({ kind: z.literal("named"), name: z.enum(["lab_near_door", "lab_low_energy", "corridor_ready", "corridor_guard_low_hp"]) }),
  z.strictObject({
    kind: z.literal("player"),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    energy: z.number().int().min(0).max(100).optional(),
    hp: z.number().int().min(0).max(100).optional()
  }),
  z.strictObject({
    kind: z.literal("door"),
    state: z.enum(["SEALED", "JAMMED_OPEN", "OPEN", "CLOSED", "SAFE_PENDING_CLOSE"]),
    jamTicks: z.number().int().min(0).max(1e5).optional()
  }),
  z.strictObject({
    kind: z.literal("guard"),
    hp: z.number().int().min(0).max(1e3).optional(),
    jamTicks: z.number().int().min(0).max(1e5).optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional()
  }),
  z.strictObject({
    kind: z.literal("relay"),
    enabled: z.boolean().optional(),
    powered: z.boolean().optional(),
    bridge: z.enum(["UNAVAILABLE", "STABLE"]).optional()
  })
]);
const advancedInput = z.strictObject({
  actionId: actionId.optional(),
  type: z.enum(["move_to", "approach", "scan_target", "interact_with", "wait_until"]),
  target: z.strictObject({ x: z.number().finite(), y: z.number().finite() }).optional(),
  targetId: z.string().regex(/^tgt_[a-z0-9_]{1,64}$/).optional(),
  until: z.enum(["passed", "crossed", "finished"]).optional(),
  maxTicks: z.number().int().min(1).max(1e5).optional(),
  maxWallMs: z.number().int().min(1).max(36e5).optional(),
  wait: z.boolean().optional()
});
const createPlayer = z.strictObject({});
const createDev = z.strictObject({ seed: z.number().int().min(0).max(4294967295) });
function register(server, name, description, inputSchema, handler) {
  server.registerTool(
    name,
    { description, inputSchema },
    async (args) => {
      try {
        return await handler(args ?? {});
      } catch (error) {
        const code = error.code;
        if (code === "E_RESOURCE_LIMIT") return errPayload("E_RESOURCE_LIMIT", "process session budget exhausted");
        if (code === "E_SESSION_CLOSED") return errPayload("E_SESSION_CLOSED", "session closed");
        return errPayload("E_INTERNAL_TRANSACTION", "tool handler failed");
      }
    }
  );
}
function registerPlayerTools(server, harness, dev) {
  register(
    server,
    "game_create_session",
    dev ? "Create a DEV/test session with a deterministic seed (dev process only)." : "Create a PLAYER production session. The server generates the seed; no seed/role/dev parameter is accepted.",
    dev ? createDev : createPlayer,
    (args) => fromHarness(
      harness.createSession(dev ? args.seed : void 0),
      (v) => ({ session: v.session, kind: v.kind, tick: v.tick, epoch: v.epoch, ...v.seed !== void 0 ? { seed: v.seed } : {}, dev })
    )
  );
  register(
    server,
    "game_observe",
    "P0 ObservationV1 projection. detail is summary or standard (debug is dev-inspect only).",
    z.strictObject({ session: sessionHandle, detail: z.enum(["summary", "standard"]).optional() }),
    (args) => {
      const session = args.session;
      const res = harness.observe(session, args.detail ?? "standard");
      if (!res.ok) return errPayload(res.code, res.messageKey, { session });
      const obs = sanitizeObservation(res.value, session);
      return okPayload({
        session,
        tick: obs.tick,
        epoch: obs.epoch,
        detail: obs.detail,
        observation: obs,
        events: eventSummary(obs.events, session),
        ...dev ? { dev: true, audit: harness.auditTail(session) } : {}
      });
    }
  );
  register(
    server,
    "game_step",
    "Advance the authoritative simulation by ticks after applying P0 actions. Reuses Session schema/idempotency/epoch/tick.",
    z.strictObject({
      session: sessionHandle,
      ticks: z.number().int().min(1).max(1e3),
      actions: z.array(actionInput).max(32).optional(),
      includeObservation: z.boolean().optional(),
      detail: z.enum(["summary", "standard"]).optional(),
      requestId: z.string().regex(REQUEST_RE).optional(),
      fromTick: z.number().int().min(0).max(2147483647).optional(),
      targetTick: z.number().int().min(0).max(2147483647).optional(),
      epoch: z.number().int().min(0).max(4294967295)
    }),
    (args) => {
      const session = args.session;
      const res = harness.step(session, {
        ticks: args.ticks,
        actions: args.actions ?? [],
        includeObservation: args.includeObservation === true,
        detail: args.detail ?? "standard",
        ...args.requestId ? { requestId: args.requestId } : {},
        ...args.fromTick !== void 0 ? { fromTick: args.fromTick } : {},
        ...args.targetTick !== void 0 ? { targetTick: args.targetTick } : {},
        epoch: args.epoch
      });
      if (!res.ok) return errPayload(res.code, res.messageKey, { session, tick: void 0 });
      const result = sanitizeStepResult(res.value, session);
      return okPayload({
        session,
        tick: result.toTick,
        epoch: result.epoch,
        status: result.status,
        result,
        events: eventSummary(result.events, session),
        ...dev ? { dev: true, audit: harness.auditTail(session) } : {}
      });
    }
  );
  register(
    server,
    "game_execute_action",
    "Execute one P0 action (schema/idempotency/epoch/tick reused) or a bounded advanced action (dev).",
    z.union([
      z.strictObject({
        session: sessionHandle,
        action: actionInput,
        ticks: z.number().int().min(1).max(1e3).optional(),
        requestId: z.string().regex(REQUEST_RE).optional(),
        fromTick: z.number().int().min(0).max(2147483647).optional(),
        targetTick: z.number().int().min(0).max(2147483647).optional(),
        epoch: z.number().int().min(0).max(4294967295)
      }),
      z.strictObject({
        session: sessionHandle,
        advanced: advancedInput,
        epoch: z.number().int().min(0).max(4294967295)
      })
    ]),
    async (args) => {
      const session = args.session;
      if (args.advanced) {
        if (!dev) return errPayload("E_PERMISSION", "advanced actions are dev-only", { session });
        const res2 = await harness.executeAdvanced(session, { ...args.advanced, epoch: args.epoch });
        if (!res2.ok) return errPayload(res2.code, res2.messageKey, { session });
        return okPayload({
          session,
          actionId: res2.value.actionId,
          actionStatus: res2.value.status,
          ...res2.value.result ? { result: sanitizeActionResult(res2.value.result, session) } : {},
          dev: true,
          audit: harness.auditTail(session)
        });
      }
      const res = harness.executeAction(session, {
        ticks: args.ticks ?? 1,
        actions: [],
        action: args.action,
        ...args.requestId ? { requestId: args.requestId } : {},
        ...args.fromTick !== void 0 ? { fromTick: args.fromTick } : {},
        ...args.targetTick !== void 0 ? { targetTick: args.targetTick } : {},
        epoch: args.epoch
      });
      if (!res.ok) return errPayload(res.code, res.messageKey, { session });
      const step = sanitizeStepResult(res.value.step, session);
      return okPayload({
        session,
        tick: step.toTick,
        epoch: step.epoch,
        result: res.value.result ? sanitizeActionResult(res.value.result, session) : null,
        step,
        events: eventSummary(step.events, session),
        ...dev ? { dev: true, audit: harness.auditTail(session) } : {}
      });
    }
  );
  register(
    server,
    "game_get_events",
    "Read a bounded, ordered event page (total order + truncation notice).",
    z.strictObject({
      session: sessionHandle,
      cursor: z.number().int().min(0).max(2147483647).optional(),
      limit: z.number().int().min(1).max(256).optional()
    }),
    (args) => {
      const session = args.session;
      const res = harness.getEvents(session, args.cursor ?? 0, args.limit ?? 64);
      if (!res.ok) return errPayload(res.code, res.messageKey, { session });
      const summary = harness.observe(session, "summary");
      return okPayload({
        session,
        tick: summary.ok ? summary.value.tick : 0,
        events: eventSummary(res.value.events, session, 256),
        nextCursor: res.value.nextCursor,
        total: res.value.total,
        truncated: res.value.truncated,
        droppedEvents: res.value.droppedEvents,
        ...dev ? { dev: true, audit: harness.auditTail(session) } : {}
      });
    }
  );
  register(
    server,
    "game_close_session",
    "Close a session and release its engine/timers.",
    z.strictObject({ session: sessionHandle }),
    (args) => fromHarness(harness.closeSession(args.session), (v) => ({ session: v.session }))
  );
}
function registerDevTools(server, harness) {
  register(
    server,
    "game_snapshot",
    "DEV: issue and register a bounded snapshot handle (never returns a raw frame).",
    z.strictObject({ session: sessionHandle }),
    (args) => {
      const session = args.session;
      return fromHarness(harness.saveSnapshot(session), (v) => ({
        session,
        snapshot: v.snapshot,
        tick: v.tick,
        epoch: v.epoch,
        ...v.stateHash ? { stateHash: v.stateHash } : {},
        sizeBytes: v.sizeBytes,
        provenance: v.provenance,
        evicted: v.evicted,
        dev: true,
        audit: harness.auditTail(session)
      }));
    }
  );
  register(
    server,
    "game_restore",
    "DEV: restore a snapshot handle issued by THIS process for the same session.",
    z.strictObject({ session: sessionHandle, snapshot: z.string().regex(SNAPSHOT_RE) }),
    (args) => {
      const session = args.session;
      return fromHarness(harness.restoreSnapshot(session, args.snapshot), (v) => ({
        session,
        tick: v.tick,
        status: v.status,
        epoch: v.epoch,
        provenance: v.provenance,
        dev: true,
        audit: harness.auditTail(session)
      }));
    }
  );
  register(
    server,
    "game_replay",
    "DEV: real deterministic re-execution from a bounded step list.",
    z.strictObject({ session: sessionHandle, steps: z.array(replayStep).max(64) }),
    (args) => {
      const session = args.session;
      return fromHarness(harness.replay(session, args.steps), (v) => ({
        session,
        canonicalState: v.canonicalState,
        canonicalEvents: v.canonicalEvents,
        dev: true,
        audit: harness.auditTail(session)
      }));
    }
  );
  register(
    server,
    "game_inspect_state",
    "DEV: full signal/Guard/collision readings (debug; never exposed to Player).",
    z.strictObject({ session: sessionHandle }),
    (args) => {
      const session = args.session;
      return fromHarness(harness.inspect(session), (v) => ({
        session,
        inspection: v,
        dev: true,
        audit: harness.auditTail(session)
      }));
    }
  );
  register(
    server,
    "game_inject_fixture",
    "DEV: apply a closed, validated fixture to a test session (audited; epoch bumps).",
    z.strictObject({ session: sessionHandle, fixture: fixtureInput }),
    (args) => {
      const session = args.session;
      return fromHarness(harness.injectFixture(session, args.fixture), (v) => ({
        session,
        epoch: v.epoch,
        tick: v.tick,
        tampered: v.tampered,
        fixtures: v.audit,
        dev: true,
        audit: harness.auditTail(session)
      }));
    }
  );
  register(
    server,
    "game_load_scenario",
    "DEV: load the only registered scenario template (no filesystem/exec).",
    z.strictObject({ scenarioId: z.literal("station-zero") }),
    (args) => fromHarness(harness.loadScenario(args.scenarioId), (v) => ({ ...v, dev: true }))
  );
  register(
    server,
    "game_run_scenario",
    "DEV: run a deterministic legal strategy in the background and return a summary + snapshot handle.",
    z.strictObject({
      scenarioId: z.literal("station-zero"),
      seed: z.number().int().min(0).max(4294967295),
      strategy: z.enum(["route-a", "idle"]).optional(),
      maxTicks: z.number().int().min(1).max(1e6).optional(),
      maxWallMs: z.number().int().min(1).max(36e5).optional(),
      maxEvents: z.number().int().min(1).max(1e4).optional()
    }),
    async (args) => {
      const res = await harness.runScenario({
        seed: args.seed,
        ...args.strategy ? { strategy: args.strategy } : {},
        ...args.maxTicks ? { maxTicks: args.maxTicks } : {},
        ...args.maxWallMs ? { maxWallMs: args.maxWallMs } : {},
        ...args.maxEvents ? { maxEvents: args.maxEvents } : {}
      });
      return fromHarness(res, (v) => ({ ...v }));
    }
  );
  register(
    server,
    "game_run_batch",
    "DEV: run 1..8 seeds with bounded concurrency; per-run failures are isolated and cleaned up.",
    z.strictObject({
      scenarioId: z.literal("station-zero"),
      seeds: z.array(z.number().int().min(0).max(4294967295)).min(1).max(8),
      strategy: z.enum(["route-a", "idle"]).optional(),
      maxTicks: z.number().int().min(1).max(1e6).optional(),
      maxWallMs: z.number().int().min(1).max(36e5).optional(),
      maxEvents: z.number().int().min(1).max(1e4).optional()
    }),
    async (args) => {
      const res = await harness.runBatch({
        seeds: args.seeds,
        ...args.strategy ? { strategy: args.strategy } : {},
        ...args.maxTicks ? { maxTicks: args.maxTicks } : {},
        ...args.maxWallMs ? { maxWallMs: args.maxWallMs } : {},
        ...args.maxEvents ? { maxEvents: args.maxEvents } : {}
      });
      return fromHarness(res, (v) => ({ runs: v }));
    }
  );
  register(
    server,
    "game_compare_runs",
    "DEV: compare two run handles by canonical state hash and ordered event stream.",
    z.strictObject({ runA: z.string().regex(RUN_RE), runB: z.string().regex(RUN_RE) }),
    (args) => fromHarness(harness.compareRuns(args.runA, args.runB), (v) => ({ ...v }))
  );
  register(
    server,
    "game_cancel_action",
    "DEV: cancel an in-flight advanced action by its actionId (bounded, idempotent).",
    z.strictObject({ session: sessionHandle, actionId }),
    (args) => {
      const session = args.session;
      return fromHarness(harness.cancelAdvanced(session, args.actionId), (v) => ({
        session,
        actionId: v.actionId,
        cancelled: true,
        dev: true,
        audit: harness.auditTail(session)
      }));
    }
  );
}
const coopHandle = z.string().regex(/^coop_[0-9a-f]{24}$/);
const coopFixture = z.strictObject({
  test: z.literal(true),
  human: z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
  echo: z.strictObject({ x: z.number().finite(), y: z.number().finite() })
});
function registerCoopTools(server, coop) {
  const session = (handle2) => coop.get(handle2);
  register(
    server,
    "game_coop_create",
    "DEV: create the isolated echo-coop-test world (one authoritative model, two actors).",
    z.strictObject({ seed: z.number().int().min(0).max(4294967295), fixture: coopFixture.optional(), echoBudget: z.number().int().min(0).max(1e3).optional() }),
    (args) => {
      const created = coop.create({
        seed: args.seed,
        ...args.fixture ? { fixture: args.fixture } : {},
        ...args.echoBudget !== void 0 ? { echoBudget: args.echoBudget } : {}
      });
      if (!created.ok) return errPayload(created.code, created.messageKey);
      return okPayload({ coop: created.value.handle, testFixture: created.value.session.testFixture, status: created.value.session.status(), dev: true });
    }
  );
  register(
    server,
    "game_coop_status",
    "DEV: both actor positions/memory/goal/hypotheses.",
    z.strictObject({ coop: coopHandle }),
    (args) => {
      const c = session(args.coop);
      return c ? okPayload({ coop: args.coop, status: c.status(), events: c.events(), dev: true }) : errPayload("E_SESSION_NOT_FOUND", "unknown coop handle");
    }
  );
  register(
    server,
    "game_coop_observe",
    "DEV: legal per-actor observation (P0 ObservationV1).",
    z.strictObject({ coop: coopHandle, actor: z.enum(["human", "echo"]), detail: z.enum(["summary", "standard"]).optional() }),
    (args) => {
      const c = session(args.coop);
      if (!c) return errPayload("E_SESSION_NOT_FOUND", "unknown coop handle");
      const res = c.observe(args.actor, args.detail ?? "standard");
      return res.ok ? okPayload({ coop: args.coop, actor: args.actor, observation: res.value, dev: true }) : errPayload(res.code, res.messageKey);
    }
  );
  register(
    server,
    "game_coop_human",
    "DEV: human-owner action (scan/move/jam/share/confirm/reject/pause/resume/takeover/release/cancel_echo).",
    z.strictObject({
      coop: coopHandle,
      op: z.enum(["scan", "move", "jam", "share", "confirm", "reject", "pause", "resume", "takeover", "release", "cancel_echo"]),
      direction: z.enum(["up", "down", "left", "right", "north", "south", "east", "west"]).optional(),
      ticks: z.number().int().min(1).max(1e3).optional(),
      id: z.string().optional(),
      targetIds: z.array(z.string()).optional(),
      fields: z.array(z.string()).optional()
    }),
    (args) => {
      const c = session(args.coop);
      if (!c) return errPayload("E_SESSION_NOT_FOUND", "unknown coop handle");
      const h = c.humanHandle();
      const op = args.op;
      const res = op === "scan" ? h.scan() : op === "move" ? h.move(args.direction ?? "east", args.ticks ?? 1) : op === "jam" ? h.jam() : op === "share" ? h.share(args.targetIds ?? [], args.fields ?? ["stateLabel"]) : op === "confirm" ? h.confirm(args.id) : op === "reject" ? h.reject(args.id) : op === "pause" ? h.pause() : op === "resume" ? h.resume() : op === "takeover" ? h.takeover() : op === "release" ? h.release() : h.cancelEcho();
      return res.ok ? okPayload({ coop: args.coop, op, value: res.value, status: c.status(), dev: true }) : errPayload(res.code, res.messageKey);
    }
  );
  register(
    server,
    "game_coop_echo",
    "DEV: ECHO action (scan/move/share/propose/execute/offline/management). ECHO can never call owner management.",
    z.strictObject({
      coop: coopHandle,
      op: z.enum(["scan", "move", "share", "propose", "execute", "offline", "management"]),
      direction: z.enum(["up", "down", "left", "right", "north", "south", "east", "west"]).optional(),
      ticks: z.number().int().min(1).max(1e3).optional(),
      id: z.string().optional(),
      targetIds: z.array(z.string()).optional(),
      fields: z.array(z.string()).optional(),
      plan: z.strictObject({ kind: z.enum(["scan", "move", "jam", "share"]), direction: z.enum(["up", "down", "left", "right", "north", "south", "east", "west"]).optional(), ticks: z.number().int().min(1).max(1e3).optional(), targetIds: z.array(z.string()).optional() }).optional(),
      statement: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
      uncertainty: z.number().min(0).max(1).optional(),
      management: z.enum(["pause", "resume", "takeover", "release"]).optional()
    }),
    (args) => {
      const c = session(args.coop);
      if (!c) return errPayload("E_SESSION_NOT_FOUND", "unknown coop handle");
      const e = c.companionHandle();
      const op = args.op;
      const res = op === "scan" ? e.scan() : op === "move" ? e.move(args.direction ?? "east", args.ticks ?? 1) : op === "share" ? e.share(args.targetIds ?? [], args.fields ?? ["stateLabel"]) : op === "execute" ? e.execute(args.id) : op === "offline" ? e.offlineStep() : op === "management" ? e.management(args.management ?? "takeover") : e.propose(args.plan, args.statement ?? "proposal", args.confidence ?? 0.5, args.uncertainty ?? 0.5);
      return res.ok ? okPayload({ coop: args.coop, op, value: res.value, status: c.status(), dev: true }) : errPayload(res.code, res.messageKey);
    }
  );
  register(
    server,
    "game_coop_advance",
    "DEV: advance shared ticks without an actor action (e.g. clear a cooldown).",
    z.strictObject({ coop: coopHandle, ticks: z.number().int().min(1).max(1e4) }),
    (args) => {
      const c = session(args.coop);
      if (!c) return errPayload("E_SESSION_NOT_FOUND", "unknown coop handle");
      const res = c.advanceTicks(args.ticks);
      return res.ok ? okPayload({ coop: args.coop, advanced: res.value.advanced, dev: true }) : errPayload(res.code, res.messageKey);
    }
  );
  register(
    server,
    "game_coop_snapshot",
    "DEV: isolated coop snapshot (not the Player save schema).",
    z.strictObject({ coop: coopHandle }),
    (args) => {
      const c = session(args.coop);
      return c ? okPayload({ coop: args.coop, snapshot: c.snapshot(), dev: true }) : errPayload("E_SESSION_NOT_FOUND", "unknown coop handle");
    }
  );
  register(
    server,
    "game_coop_restore",
    "DEV: restore an isolated coop snapshot.",
    z.strictObject({ coop: coopHandle, frame: z.record(z.string(), z.unknown()) }),
    (args) => {
      const c = session(args.coop);
      if (!c) return errPayload("E_SESSION_NOT_FOUND", "unknown coop handle");
      const res = c.restore(args.frame);
      return res.ok ? okPayload({ coop: args.coop, tick: res.value.tick, dev: true }) : errPayload(res.code, res.messageKey);
    }
  );
  register(
    server,
    "game_coop_close",
    "DEV: close and release a coop world.",
    z.strictObject({ coop: coopHandle }),
    (args) => coop.close(args.coop) ? okPayload({ coop: args.coop, closed: true, dev: true }) : errPayload("E_SESSION_NOT_FOUND", "unknown coop handle")
  );
}
async function main() {
  const dev = process.argv.slice(2).includes("--dev");
  const budget = createProcessSessionBudget(10);
  const manager = createSessionManager({
    maxSessions: 10,
    maxConcurrentSteps: 2,
    idleTimeoutMs: 3e5,
    maxSessionWallMs: 36e5,
    budget
  });
  const harness = new Harness(manager, dev ? "dev" : "player");
  const coopManager = new CoopManager(10, budget);
  const server = new McpServer({
    name: dev ? "last-signal-dev-harness" : "last-signal-player",
    version: "0.3.0"
  });
  registerPlayerTools(server, harness, dev);
  if (dev) {
    registerDevTools(server, harness);
    registerCoopTools(server, coopManager);
  }
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      await server.close();
    } catch {
    }
    try {
      harness.dispose();
    } catch {
    }
    try {
      coopManager.dispose();
    } catch {
    }
  };
  const transport = new StdioServerTransport();
  transport.onclose = () => {
    void cleanup();
  };
  process.on("SIGINT", () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.stdin.on("end", () => {
    void cleanup().finally(() => process.exit(0));
  });
  process.stdin.on("close", () => {
    void cleanup().finally(() => process.exit(0));
  });
  await server.connect(transport);
}
main().catch((error) => {
  process.stderr.write(`[mcp-server] fatal: ${error instanceof Error ? error.message : String(error)}
`);
  process.exit(1);
});
