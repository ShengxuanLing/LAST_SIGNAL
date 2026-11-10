import { MapData } from '../types';

// Precomputed BFS distances from the start room (id 0) over the room adjacency graph.
export class RoomDepth {
  private depths = new Map<number, number>();
  private built = false;

  build(map: MapData): void {
    this.depths = new Map();
    this.built = true;
    const queue = [0];
    this.depths.set(0, 0);
    while (queue.length) {
      const cur = queue.shift()!;
      const d = this.depths.get(cur)!;
      for (const nb of map.rooms[cur].connectedTo) {
        if (!this.depths.has(nb)) {
          this.depths.set(nb, d + 1);
          queue.push(nb);
        }
      }
    }
  }

  of(id: number): number {
    if (!this.built) return 0;
    return this.depths.get(id) ?? 0;
  }

  /** All room ids at a given depth. */
  at(depth: number): number[] {
    return [...this.depths.entries()].filter(([, d]) => d === depth).map(([id]) => id);
  }
}
