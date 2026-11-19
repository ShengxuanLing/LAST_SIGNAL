# -*- coding: utf-8 -*-
from pathlib import Path
p = Path('src/world/World.ts')
s = p.read_text(encoding='utf-8')

# 1 imports: keep both sides.
start = s.index('<<<<<<< HEAD\nimport type { ControllerActorView')
end = s.index('>>>>>>> feat/ai-native-runtime\n', start) + len('>>>>>>> feat/ai-native-runtime\n')
new = """import type { ControllerActorView, LocalControllerView } from '../ai-native/localController';
import { buildWorldObservation, type WorldObservationV1 } from '../ai-native/worldObservation';
import { WORLD_PERCEPTION, createLocalProbe, gridLineOfSight } from '../ai-native/worldPerception';
import { cloneCheckpoint } from '../systems/RunCheckpoint';
import { chooseNearestActor, type ActorCombatPort, type ActorTargetView } from './actorTarget';
import { buildEchoObservation, type EchoObservation } from './echoView';
import { SIGNAL_TUNING } from '../signal/signalTuning';
import { ExternalLinkState, type ExternalActionReceipt } from '../ai-native/externalLink';
import { EchoController, type EchoMode, type EchoView } from '../ai-native/echo';
import type { PlayerIntent } from '../ai-native/control';
import {
  createSimulationState, ECHO_ACTOR_ID, enqueueCommand, enqueueEchoHit, enqueuePlayerHit, isWalkableFromState,
  enqueueTargetHp as enqueueCoreTargetHp, enqueueTargetMove as enqueueCoreTargetMove, ensureWalkableFromState, processCommands,
  registerDrone, registerTarget,
  spawnEnemyProjectile as spawnCoreEnemyProjectile, stepSimulationTicks, SIM_TUNING,
  type SimulationIntent, type SimulationState, type SimEchoState, type SimEvent, type SimLootKind, type SimProjectile, type SimTarget
} from './sim/core';
import { CombatVfx, BOLT_HEIGHT, type BoltView, type TelegraphView } from '../art/survey/CombatVfx';
import { CSS, DEPTH, FONT, INK } from '../art/survey/tokens';
"""
s = s[:start] + new + s[end:]

# 2 fields: keep HEAD core + art vfx/damageStack.
start = s.index('<<<<<<< HEAD\n  /** C2: first-slice authority for player/drone/core projectiles. */')
end = s.index('>>>>>>> feat/ai-native-runtime\n  shakeAmount = 0;', start) + len('>>>>>>> feat/ai-native-runtime\n')
head_side = s[start + len('<<<<<<< HEAD\n'):s.index('=======\n', start)]
new = head_side + """  /** AR-02 visual-only combat effects (reads state, never writes it). */
  vfx: CombatVfx;
  private damageStack = new Map<number, { t: number; n: number }>();
"""
s = s[:start] + new + s[end:]

# 3 onEnterRoom: keep HEAD generation block + art observation.
start = s.index('<<<<<<< HEAD\n    const depth = this.roomDepth.of(r.id);')
end = s.index('>>>>>>> feat/ai-native-runtime\n    }\n  }\n\n  private roomEnemyCount', start) + len('>>>>>>> feat/ai-native-runtime\n')
head_side = s[start + len('<<<<<<< HEAD\n'):s.index('=======\n', start)]
new = """    // Survey ink: entering a room is an observation; the mast's pulse draws it in.
    if (this.renderer) {
      const p = this.player.sprite;
      this.renderer.observeRoom(room.id, p.x, p.y);
    }
""" + head_side
s = s[:start] + new + s[end:]

# 4 spawnLoot: keep HEAD core enqueue, drop art legacy addProjectileSprite.
start = s.index('<<<<<<< HEAD\n  /** Queues a visible loot drop; core owns the data and the pickup transaction. */')
end = s.index('>>>>>>> feat/ai-native-runtime\n  }\n\n  // ---------- FX ----------', start) + len('>>>>>>> feat/ai-native-runtime\n')
head_side = s[start + len('<<<<<<< HEAD\n'):s.index('=======\n', start)]
new = head_side
s = s[:start] + new + s[end:]

# 5 updateLegacy -> killEnemy: replace the whole mangled block.
start = s.index('  private updateLegacy(dt: number): void {')
end = s.index('  private killEnemy(e: Enemy): void {', start)
new = """  private updateLegacy(dt: number): void {
    this.clock += dt;
    for (const e of this.enemies) {
      if (e.data.kind === 'drone') continue; // core owns drone FSM and timers
      const port = this.enemyCombatPort(e);
      if (port) e.update(dt, port);
      e.applyVisual(dt, this.clock);
    }
    if (this.boss) {
      const port = this.enemyCombatPort(this.boss);
      if (port) this.boss.update(dt, port);
    }
    this.updateRoom();
    this.player.updateView(dt);
    this.updateFx(dt);
    this.updateCamera(dt);
    if (this.renderer) {
      this.renderer.update(dt);
      this.renderer.updateLight(this.player.wx, this.player.wy);
    }
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 10);
  }

  private syncCoreLoot(): void {
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

  private updateFx(dt: number): void {
    // Bolts (player pulse / hostile) and hostile telegraphs, read from live state.
    const bolts: BoltView[] = [];
    for (const p of this.projectiles) {
      const a = this.worldToScreen(p.data.pos.x, p.data.pos.y);
      const b = this.worldToScreen(p.data.pos.x + p.data.vel.x * 0.01, p.data.pos.y + p.data.vel.y * 0.01);
      bolts.push({ x: a.x, y: a.y, vx: b.x - a.x, vy: b.y - a.y, enemy: p.data.side === 'enemy', kind: (p.spr as any).__kind ?? 'pulse' });
    }
    const tele: TelegraphView[] = [];
    const ps = this.player.sprite;
    for (const e of this.enemies) {
      const v = e.view;
      if (!v || v.telegraph <= 0 || !this.player.alive) continue;
      const ap = v.aperture();
      const melee = !!e.data.stats.reachEnemy;
      tele.push({
        ax: melee ? e.sprite.x : ap.x, ay: melee ? e.sprite.y : ap.y,
        tx: ps.x, ty: melee ? ps.y : ps.y - BOLT_HEIGHT,
        strength: v.telegraph, melee, detect: e.data.state === 'detect',
        // melee reach used by Enemy.doAttack: attackRange + 1.5 tiles, in screen px (iso x-scale)
        reach: (e.data.stats.attackRange + 1.5) * GAME.TILE_W / Math.SQRT2,
      });
    }
    this.vfx.update(dt, bolts, tele);
  }

"""
s = s[:start] + new + s[end:]

# 6 killEnemy conflict: keep core text + art death visual.
start = s.index('<<<<<<< HEAD\n    // Core already committed HP/death, XP, currency and drop RNG.')
end = s.index('>>>>>>> feat/ai-native-runtime\n    e.sprite.destroy();', start) + len('>>>>>>> feat/ai-native-runtime\n')
new = """    // Core already committed HP/death, XP, currency and drop RNG. The adapter
    // only removes presentation and emits stats.
    e._hp = 0;
    this.damageStack.delete(e._id);
    this.enemyDeathVisual(e);
"""
s = s[:start] + new + s[end:]

p.write_text(s, encoding='utf-8')
print('World conflicts resolved')
