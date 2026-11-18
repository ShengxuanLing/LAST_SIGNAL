import Phaser from 'phaser';
import { visualRng } from '../art/survey/visualRng';
import { CSS, DEPTH, INK, rgba } from '../art/survey/tokens';

const SIZE = 512;
type Paint = (ctx: CanvasRenderingContext2D) => void;

interface Chunk {
  left: number;
  top: number;
  right: number;
  bottom: number;
  commands: Paint[];
}

/** Bake in world coordinates, allocating backing pixels only near painted geometry. */
export class TerrainChunks {
  readonly bounds: Phaser.GameObjects.Rectangle;
  private readonly chunks = new Map<number, Chunk>();
  private readonly textureKeys: string[] = [];
  private readonly columns: number;

  constructor(private readonly scene: Phaser.Scene, width: number, height: number, private readonly seed: number) {
    this.columns = Math.ceil(width / SIZE);
    this.bounds = scene.add.rectangle(0, 0, width, height, INK.shadow)
      .setOrigin(0).setDepth(DEPTH.world);
    scene.events.once('shutdown', () => {
      for (const key of this.textureKeys) scene.textures.remove(key);
      this.textureKeys.length = 0;
    });
  }

  paint(left: number, top: number, right: number, bottom: number,
    draw: Paint): void {
    const x0 = Math.max(0, Math.floor(left / SIZE));
    const y0 = Math.max(0, Math.floor(top / SIZE));
    const x1 = Math.min(this.columns - 1, Math.floor(right / SIZE));
    const y1 = Math.min(Math.ceil(this.bounds.height / SIZE) - 1, Math.floor(bottom / SIZE));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const id = y * this.columns + x;
        let chunk = this.chunks.get(id);
        if (!chunk) {
          chunk = { left, top, right, bottom, commands: [] };
          this.chunks.set(id, chunk);
        } else {
          chunk.left = Math.min(left, chunk.left);
          chunk.top = Math.min(top, chunk.top);
          chunk.right = Math.max(right, chunk.right);
          chunk.bottom = Math.max(bottom, chunk.bottom);
        }
        chunk.commands.push(draw);
      }
    }
  }

  bake(): void {
    for (const [id, chunk] of this.chunks) {
      const x = (id % this.columns) * SIZE;
      const y = Math.floor(id / this.columns) * SIZE;
      const left = Math.max(x, Math.floor(chunk.left));
      const top = Math.max(y, Math.floor(chunk.top));
      const right = Math.min(x + SIZE, this.bounds.width, Math.ceil(chunk.right) + 1);
      const bottom = Math.min(y + SIZE, this.bounds.height, Math.ceil(chunk.bottom) + 1);
      const texture = this.scene.textures.createCanvas(`terrain-${id}`, right - left, bottom - top)!;
      this.textureKeys.push(texture.key);
      const ctx = texture.context;
      ctx.fillStyle = CSS.shadow;
      ctx.fillRect(0, 0, texture.width, texture.height);
      const grain = visualRng(this.seed, id, 'VOID');
      ctx.fillStyle = rgba(CSS.massLight, 0.35);
      for (let i = 0; i < Math.floor(texture.width * texture.height / 9000); i++) {
        ctx.fillRect(grain.int(0, texture.width - 1), grain.int(0, texture.height - 1), 1, 1);
      }
      ctx.translate(-left, -top);
      for (const paint of chunk.commands) paint(ctx);
      texture.refresh();
      this.scene.add.image(left, top, texture.key).setOrigin(0).setDepth(DEPTH.world);
    }
    this.chunks.clear();
  }
}
