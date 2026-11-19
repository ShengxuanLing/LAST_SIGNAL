# -*- coding: utf-8 -*-
from pathlib import Path
p = Path('src/world/World.ts')
s = p.read_text(encoding='utf-8')

# 1 imports
start = s.index('<<<<<<< HEAD\nimport type { ControllerActorView')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
head = s[start + len('<<<<<<< HEAD\n'):s.index('=======\n', start)]
s = s[:start] + head + "import { deckLabel, dungeonRng, encounter, TOTAL_DECKS } from '../config/dungeon';\n" + s[end:]

# 2 fields
start = s.index('<<<<<<< HEAD\n  private portal: { spr: Phaser.GameObjects.Sprite; targetRoom: number; wx: number; wy: number } | null = null;')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
new = """  private portal: { spr: Phaser.GameObjects.Sprite; targetRoom: number | null; wx: number; wy: number } | null = null;
  private waves: EnemyKind[][] = [];
  private activeWave = 0;
  private roomSeal?: Phaser.GameObjects.Graphics;
  /** ONE real Relay device per run. Spawned on first room enter only when the
   *  human has explicitly opted into Signal Collaboration; absent = legacy
   *  v1 run (portal always open). */
  private signalDeviceSpawned = false;
  /** Explicit human opt-in to Signal Collaboration (from save data). Ordinary
   *  NEW RUNS stay legacy (no device, no gating) until enabled in-game. */
  private signalCollaborationOptIn = false;

  /** Deep, frozen read-only snapshot. External adapters must never mutate this. */
  get sim(): SimulationState {
    if (!this.simSnapshotCache) {
      this.simSnapshotCache = deepFreeze(JSON.parse(JSON.stringify(this._sim)) as SimulationState);
    }
    return this.simSnapshotCache;
  }

  /** Explicit dev/test fixture access to live core state; production throws. */
  get simFixture(): SimulationState {
    World.assertDevTest();
    this.bumpSimVersion();
    return this._sim;
  }

  /** Deep, frozen player data snapshot for HUD/read-only adapters. */
  get playerDataSnapshot(): any {
"""
s = s[:start] + new + s[end:]

# 3 rng
start = s.index('<<<<<<< HEAD\n    this.signalCollaborationOptIn = !!save.permanent?.signalCollaborationOptIn;')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
new = """    this.signalCollaborationOptIn = !!save.permanent?.signalCollaborationOptIn;
    this.rng = map.deck === undefined ? new RNG(map.seed * 7919 + 1) : dungeonRng(map.seed);
"""
s = s[:start] + new + s[end:]

# 4 updateRoom
start = s.index('<<<<<<< HEAD\n    if (r.spawned && !this.pendingRoomEnters.has(room.id) && inRoom.length === 0 && !r.cleared) {')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
new = """    if (r.spawned && !this.pendingRoomEnters.has(room.id) && inRoom.length === 0 && !r.cleared &&
        (this.map.deck === undefined || !this.boss)) {
      if (this.map.deck !== undefined && this.activeWave < this.waves.length) {
        this.spawnSectorWave(r);
        return;
      }
      r.cleared = true;
      this.clearRoomSeal();
      if (this.map.deck !== undefined && !this.won) this.placePortal(r);
      this.callbacks.onRoomCleared(room);
"""
s = s[:start] + new + s[end:]

# 5 onEnterRoom: replace entire conflict with combined logic.
start = s.index('<<<<<<< HEAD\n    // Survey ink: entering a room is an observation')
sector_start = s.index('=======\n', start) + len('=======\n')
sector_end = s.index('>>>>>>> origin/feat/sector-dungeon\n', sector_start)
sector = s[sector_start:sector_end]
sector = sector[sector.index('  private showRoomSeal'):]
end = s.index('>>>>>>> origin/feat/sector-dungeon\n  }\n\n  private placePortal', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
new = """    // Survey ink: entering a room is an observation; the mast's pulse draws it in.
    if (this.renderer) {
      const p = this.player.sprite;
      this.renderer.observeRoom(room.id, p.x, p.y);
    }
    const depth = this.roomDepth.of(r.id);
    const isNew = !r.spawned && !this.pendingRoomEnters.has(r.id);

    if (isNew && this.isDeckExit(r) && !this.exitUnlocked) {
      this.placePortal(r);
      return;
    }

    if (isNew && this.map.deck !== undefined) {
      if (r.kind === 'boss') {
        this.spawnBoss(r);
        r.spawned = true;
      } else {
        r.spawned = true;
        this.waves = encounter(this.map.seed, this.map.deck, r.id, r.kind);
        if (this.waves.length) this.spawnSectorWave(r);
      }
      if (r.kind === 'resource' || r.kind === 'shop') this.spawnResourceLoot(r);
      this.callbacks.onRoomEntered(room);
    } else if (isNew && r.kind === 'boss') {
      this.enqueueSpawnBoss(r);
      this.pendingRoomEnters.add(r.id);
      this.callbacks.onRoomEntered(room);
      this.placePortal(r);
    } else if (isNew) {
      const enemyCount = this.roomEnemyCount(r, depth);
      const enemyPositions: Vec2[] = [];
      for (let i = 0; i < enemyCount; i++) {
        enemyPositions.push({
          x: r.gx + 3 + (i % 3) * (r.w - 6) / 3,
          y: r.gy + 3 + Math.floor(i / 3) * (r.h - 6)
        });
      }
      const resourceCount = this.roomResourceCount(r, depth);
      const resourcePositions: Vec2[] = [];
      for (let i = 0; i < resourceCount; i++) {
        resourcePositions.push({ x: r.gx + 2 + (i + 1) * 2, y: r.gy + 2 + (i % 2) * 2 });
      }
      const neighbors = r.connectedTo.filter((n) => n !== r.id);
      enqueueCommand(this._sim, {
        type: 'room-enter', roomId: r.id, roomKind: r.kind,
        gx: r.gx, gy: r.gy, w: r.w, h: r.h, depth,
        savedPortalTarget: null,
        neighbors, enemyCount, enemyPositions, resourceCount, resourcePositions,
        firstEnemyId: this.enemyIdCounter
      });
      this.enemyIdCounter += enemyCount;
      this.bumpSimVersion();
      this.pendingRoomEnters.add(r.id);
      this.callbacks.onRoomEntered(room);
      this.placePortal(r);
      if (this.signalCollaborationOptIn && !this.signalDeviceSpawned) {
        this.signalDeviceSpawned = true;
        enqueueCommand(this._sim, {
          type: 'spawn-signal-device',
          deviceId: 'relay_main',
          roomId: r.id,
          x: r.gx + Math.floor(r.w / 2),
          y: r.gy + Math.floor(r.h / 2)
        });
      }
    } else if (!this.portal) {
      this.placePortal(r);
    }

    if (this.map.deck !== undefined && !r.cleared && (this.boss || this.waves.length)) this.showRoomSeal(r);
    if (this.map.deck === undefined || r.cleared) this.placePortal(r);
    else this.clearPortal();
""" + sector
s = s[:start] + new + s[end:]

# 6 placePortal target drawing: keep art visuals + clear/make wrappers.
start = s.index('<<<<<<< HEAD\n    if (this.portal) { this.portal.spr.destroy(); this.portal = null; }')
end = s.index('  /** First adjacent room on the shortest room-graph path', start)
new = """    this.makePortal(target, best);
  }

  private clearPortal(): void {
    if (!this.portal) return;
    this.scene.tweens.killTweensOf(this.portal.spr);
    this.portal.spr.destroy();
    this.portal = null;
  }

  private makePortal(target: number | null, best: Vec2): void {
    this.clearPortal();
    // Display at the visual centre of the chosen cell; interaction still uses (best.x, best.y).
    const s = this.worldToScreen(best.x + 0.5, best.y + 0.5);
    const spr = this.scene.add.sprite(s.x, s.y, 'portal_beacon');
    spr.setOrigin(0.5, 54 / 64).setDepth(DEPTH.decal + 1);
    if (target === null) spr.setTint(0xffd233);
    this.scene.add.tween({ targets: spr, alpha: { from: 0.65, to: 1 }, duration: 900, yoyo: true, repeat: -1 });
    const labelText = target === null
      ? 'F · DESCEND'
      : `F · R-${String(target).padStart(2, '0')} ${this.map.rooms[target].kind.toUpperCase()}`;
    const label = this.scene.add.text(s.x + 16, s.y - 58, labelText, {
      fontFamily: FONT.mono, fontSize: '11px', color: CSS.interact
    }).setOrigin(0, 0.5).setDepth(DEPTH.decal + 1);
    const glow = this.scene.add.image(s.x, s.y, 'light_interact').setBlendMode(Phaser.BlendModes.ADD).setScale(0.6).setAlpha(0.35).setDepth(DEPTH.light);
    spr.once('destroy', () => { label.destroy(); glow.destroy(); });
    this.portal = { spr, targetRoom: target, wx: best.x, wy: best.y };
  }

"""
s = s[:start] + new + s[end:]

# 7 tryInteract gates
start = s.index('<<<<<<< HEAD\n    // Only an ACTIVE relay opens the exit.')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
new = """    // Only an ACTIVE relay opens the exit. No device => legacy v1 run
    // unchanged (portal always open). JAMMED/DISABLED relay keeps the gate
    // shut: scan→confirm→ACTIVE is required to pass.
    const sig = this.signalView();
    if (sig && sig.relay !== 'ACTIVE') return;
    if (this.map.deck !== undefined) {
      const room = this.currentRoom();
      if (!room || (!this.map.rooms[room.id].cleared && !this.isDeckExit(this.map.rooms[room.id]))) return;
    }
"""
s = s[:start] + new + s[end:]

# 7b tryInteract portal transition
start = s.index('<<<<<<< HEAD\n      this.portal.spr.destroy();')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n      audio.wave();', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
new = """      this.clearPortal();
      if (this.map.deck !== undefined) {
        player.reset(landing.x, landing.y, false);
        this.updateRoom();
      } else {
        // Ordinary transition is a command committed by the next core tick with
        // a validated walkable landing; updateRoom() enters the destination and
        // queues its spawn/portal on that tick. The companion migrates with the
        // protagonist on that SAME tick, and the old room's armed assist +
        // pending companion intent + echo memory are dropped (never carried into
        // the new encounter).
        this.echoController.clearForRoomTransition();
        this.pendingCompanionIntent = null;
        this.enqueueTeleport(landing.x, landing.y, true, true);
      }
"""
s = s[:start] + new + s[end:]

# 8 updateLegacy sector insert: keep HEAD (no player.update).
start = s.index('<<<<<<< HEAD\n=======\n    this.player.update(dt);')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n    for (const e of this.enemies)', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
s = s[:start] + s[end:]

# 9 syncCoreLoot + legacy projectile/loot block: keep only HEAD syncCoreLoot.
start = s.index('<<<<<<< HEAD\n  private syncCoreLoot(): void {')
end = s.index('  private updateFx(dt: number): void {', start)
new = """  private syncCoreLoot(): void {
    const alive = new Set<number>();
    for (const loot of this._sim.loot) {
      alive.add(loot.id);
      let view = this.coreLootViews.get(loot.id);
      if (!view) {
        const s = this.worldToScreen(loot.x, loot.y);
        const kind = loot.kind as ItemKind;
        const spr = this.scene.add.sprite(s.x, s.y, 'icon_' + (kind === 'currency' ? 'currency' : kind === 'health' ? 'health' : 'upgrade'));
        spr.setDepth(70);
        view = { spr, data: { x: loot.x, y: loot.y, kind, key: loot.key, amount: loot.amount, bob: loot.bob } };
        this.coreLootViews.set(loot.id, view);
      }
      view.data = { x: loot.x, y: loot.y, kind: loot.kind as ItemKind, key: loot.key, amount: loot.amount, bob: loot.bob };
      const screen = this.worldToScreen(loot.x, loot.y);
      view.spr.setPosition(screen.x, screen.y);
    }
    for (const [id, view] of this.coreLootViews) {
      if (alive.has(id)) continue;
      if (view.spr.scene) view.spr.destroy();
      this.coreLootViews.delete(id);
    }
  }

"""
s = s[:start] + new + s[end:]

# 10 killBoss
start = s.index('<<<<<<< HEAD\n=======\n    const bossRoom = this.map.rooms[this.boss.spawnRoom];')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n    this.boss.sprite.destroy();', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
s = s[:start] + "    const bossRoom = this.map.rooms[this.boss.spawnRoom];\n" + s[end:]
start = s.index('<<<<<<< HEAD\n=======\n    this.player.addXp(200);')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n    audio.bossroar();', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
s = s[:start] + """    this.player.addXp(200);
    if (this.map.deck === undefined) {
      const bx = this.player.x, by = this.player.y;
      for (let i = 0; i < 12; i++) this.spawnLoot(bx + (Math.random() - 0.5) * 120, by + (Math.random() - 0.5) * 120, 'currency', 'currency', 10);
    }
""" + s[end:]

# 11 captureCheckpoint: keep HEAD clone + add deck.
start = s.index('<<<<<<< HEAD\n    // Checkpoint must only capture fully committed transactions.')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
head = s[start + len('<<<<<<< HEAD\n'):s.index('=======\n', start)]
head = head.replace("      id, seed, stats, roomId: room.id,", "      id, seed, deck: this.map.deck, stats, roomId: room.id,")
s = s[:start] + head + s[end:]

p.write_text(s, encoding='utf-8')
print('World sector conflicts resolved')
