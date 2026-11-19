# -*- coding: utf-8 -*-
from pathlib import Path
p = Path('src/world/WorldRenderer.ts')
s = p.read_text(encoding='utf-8')

# imports
start = s.index('<<<<<<< HEAD\nimport { CSS, DEPTH, INK, FONT, TIME, rgba }')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
art = s[start + len('<<<<<<< HEAD\n'):s.index('=======\n', start)]
s = s[:start] + art + "import { sectorFor } from '../config/dungeon';\n" + s[end:]

# fields/constructor
start = s.index('<<<<<<< HEAD\n  private walkable = new Set<string>();')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
art = s[start + len('<<<<<<< HEAD\n'):s.index('=======\n', start)]
# constructor art side ends with '{' and sets this.seed; append sector field/init at right spots.
art = art.replace("  private readonly seed: number;\n", "  private readonly seed: number;\n  private readonly sector;\n")
art = art.replace("    this.seed = visualSeed(map.seed, -1, 'WORLD');\n", "    this.seed = visualSeed(map.seed, -1, 'WORLD');\n    this.sector = map.deck === undefined ? undefined : sectorFor(map.deck);\n")
s = s[:start] + art + s[end:]

# floor drawing: keep art side
start = s.index('<<<<<<< HEAD\n    const lift = Math.round((n - 0.5) * 6);')
end = s.index('>>>>>>> origin/feat/sector-dungeon\n', start) + len('>>>>>>> origin/feat/sector-dungeon\n')
art = s[start + len('<<<<<<< HEAD\n'):s.index('=======\n', start)]
s = s[:start] + art + s[end:]

p.write_text(s, encoding='utf-8')
print('WorldRenderer resolved')
