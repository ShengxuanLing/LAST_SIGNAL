# -*- coding: utf-8 -*-
from pathlib import Path
p = Path('src/scenes/GameScene.ts')
s = p.read_text(encoding='utf-8')

# imports
start = s.index('<<<<<<< HEAD\nimport { ExternalLinkController')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
head = s[start + len('<<<<<<< HEAD\n'):s.index('=======\n', start)]
s = s[:start] + head + "import { deckLabel, deckSeed, sectorFor } from '../config/dungeon';\nimport type { MapData } from '../types';\n" + s[end:]

# create: keep HEAD tick + transition player
start = s.index('<<<<<<< HEAD\n    if (!checkpoint) {')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
head = s[start + len('<<<<<<< HEAD\n'):s.index('=======\n', start)]
new = "    if (transition) this.world.player.data = transition.player;\n" + head
s = s[:start] + new + s[end:]

# F key: keep takeover behavior, add runFinished guard.
start = s.index('<<<<<<< HEAD\n    this.input.keyboard!.on(\'keydown-F\', () => {')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
new = """    this.input.keyboard!.on('keydown-F', (event: KeyboardEvent) => {
      if (this.runFinished) return;
      if (this.paused) {
        // F-05: an interaction key must also be able to reclaim control while
        // an overlay is on top; it must NOT interact with a paused world.
        this.takeoverFromHumanInput();
        return;
      }
"""
s = s[:start] + new + s[end:]

# takeover + advanceDeck
start = s.index('<<<<<<< HEAD\n  /** UI clicks belong to the overlay scene; only the remaining pointer presses are fire. */')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n  }\n\n  private setupHud', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
head = s[start + len('<<<<<<< HEAD\n'):s.index('=======\n', start)]
new = head + """  }

  private advanceDeck(): void {
    if (this.deck === undefined || this.paused || this.runFinished) return;
    this.paused = true;
    this.scene.restart({
      seed: this.seed,
      transition: {
        id: this.runId, deck: this.deck + 1,
        player: structuredClone(this.world.player.data), stats: this.runStats()
      }
    } satisfies SceneConfig);
"""
s = s[:start] + new + s[end:]

# setupHud: keep HEAD (art + AI) side
start = s.index('<<<<<<< HEAD\n    // AI-NATIVE-02 control rows')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
head = s[start + len('<<<<<<< HEAD\n'):s.index('=======\n', start)]
s = s[:start] + head + s[end:]

# lockHud: keep HEAD side
start = s.index('<<<<<<< HEAD\n    place(this.hud, 0, 0);')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
head = s[start + len('<<<<<<< HEAD\n'):s.index('=======\n', start)]
s = s[:start] + head + s[end:]

# room/deck text
start = s.index('<<<<<<< HEAD\n    const total = this.world.map.rooms.length;')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
new = """    const total = this.world.map.rooms.length;
    if (this.deck === undefined) {
      if (room) this.txtRoom.setText(`R-${String(room.id).padStart(2, '0')} · ${room.kind.toUpperCase()} · SURVEYED ${this.world.surveyedRooms()}/${total}`);
    } else {
      this.txtRoom.setText(`${deckLabel(this.deck)} · ${room?.kind.toUpperCase() ?? 'CORRIDOR'}`);
      this.txtObjective.setText(this.world.roomObjective);
    }
"""
s = s[:start] + new + s[end:]

# minimap: keep art side
start = s.index('<<<<<<< HEAD\n    const rooms = map.rooms;')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
head = s[start + len('<<<<<<< HEAD\n'):s.index('=======\n', start)]
s = s[:start] + head + s[end:]

# boss line
start = s.index('<<<<<<< HEAD\n    // Left-anchored fill inside the frame')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
new = """    // Left-anchored fill inside the frame [482, 798] — independent of the current width.
    this.bossBarFill.setDisplayOrigin(158, 4);
    this.txtBossHp.setText(`★ ${boss.name} — PHASE ${boss.phase} ★`);
"""
s = s[:start] + new + s[end:]

p.write_text(s, encoding='utf-8')
print('GameScene sector conflicts resolved')
