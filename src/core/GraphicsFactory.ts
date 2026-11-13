// Procedural texture generation. Produces Phaser textures via canvas so the game
// needs no external image assets while still looking coherent.
import Phaser from 'phaser';

export class GraphicsFactory {
  static GRAY = '#20303a';
  static CYAN = '#33e0ff';
  static ORANGE = '#ff8a3c';
  static RED = '#ff3355';
  static PURPLE = '#a05cff';

  static create(scene: Phaser.Scene): void {
    const gen = (key: string, w: number, h: number, fn: (c: HTMLCanvasElement) => void): void => {
      const tex = scene.textures.createCanvas(key, w, h)!;
      const canvas = tex.getCanvas()!;
      fn(canvas);
      (tex as any).setFilter(Phaser.Textures.FilterMode.NEAREST);
    };

    gen('floor', 64, 64, (c) => {
      const g = c.getContext('2d')!;
      const grd = g.createLinearGradient(0, 0, 64, 64);
      grd.addColorStop(0, '#0e1620');
      grd.addColorStop(1, '#12202c');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      g.strokeStyle = 'rgba(51,224,255,0.06)';
      g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, 63, 63);
      g.fillStyle = 'rgba(51,224,255,0.10)';
      for (const [x, y] of [[8, 8], [56, 8], [8, 56], [56, 56]] as const) {
        g.beginPath(); g.arc(x, y, 1.5, 0, Math.PI * 2); g.fill();
      }
    });

    gen('wall', 64, 64, (c) => {
      const g = c.getContext('2d')!;
      // Dark-blue geometric block, matching WorldRenderer._drawWall. The orange
      // hazard stripe loop is gone: only a tiny low-alpha doorframe tick remains.
      g.fillStyle = '#0a1016'; g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#16202b'; g.fillRect(2, 2, 60, 60);
      g.fillStyle = '#1d2a36';
      for (let y = 14; y <= 38; y += 12) g.fillRect(6, y, 52, 4);
      g.fillStyle = 'rgba(255,138,60,0.12)';
      g.fillRect(54, 3, 6, 2);
    });

    gen('bg', 1280, 720, (c) => {
      const g = c.getContext('2d')!;
      const grd = g.createRadialGradient(640, 360, 60, 640, 360, 900);
      grd.addColorStop(0, '#0b1420');
      grd.addColorStop(1, '#04060b');
      g.fillStyle = grd;
      g.fillRect(0, 0, 1280, 720);
      g.fillStyle = 'rgba(51,224,255,0.04)';
      for (let i = 0; i < 60; i++) {
        const x = Math.random() * 1280, y = Math.random() * 720, r = Math.random() * 2 + 0.5;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    });

    gen('player', 48, 48, (c) => {
      const g = c.getContext('2d')!;
      const cx = 24, cy = 24;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath(); g.ellipse(cx, cy + 12, 14, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0d2030'; g.strokeStyle = '#33e0ff'; g.lineWidth = 3;
      g.beginPath(); g.arc(cx, cy, 12, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#33e0ff'; g.fillRect(cx - 8, cy - 4, 16, 5);
      g.fillStyle = '#7ff0ff'; g.fillRect(cx - 6, cy - 3, 6, 2);
      g.fillStyle = '#ff8a3c';
      g.fillRect(cx - 13, cy - 2, 3, 6); g.fillRect(cx + 10, cy - 2, 3, 6);
    });

    gen('enemy_drone', 24, 24, (c) => drawEnemy(c, '#243040', '#33e0ff', 10, true));
    gen('enemy_stalker', 26, 24, (c) => drawEnemy(c, '#3a2030', '#ff3355', 11, false));
    gen('enemy_sentinel', 34, 30, (c) => drawEnemy(c, '#2a3020', '#ffd233', 15, false));
    gen('enemy_hunter', 26, 24, (c) => drawEnemy(c, '#20303a', '#a05cff', 11, false));


    gen('proj_pulse', 12, 12, (c) => radial(c, '#eafaff', '#33e0ff'));
    gen('proj_pink', 12, 12, (c) => radial(c, '#fff0e0', '#ff8a3c'));
    gen('proj_plasma', 20, 20, (c) => radial(c, '#fff2c0', '#ff5a3c'));
    gen('proj_boss', 24, 24, (c) => radial(c, '#ffffff', '#a05cff'));
    gen('proj_enemy', 12, 12, (c) => radial(c, '#ffd0b0', '#ff3355'));

    gen('icon_health', 24, 24, (c) => {
      const g = c.getContext('2d')!;
      g.fillStyle = '#ff3355';
      g.beginPath(); g.moveTo(12, 4); g.bezierCurveTo(20, 8, 20, 16, 12, 20);
      g.bezierCurveTo(4, 16, 4, 8, 12, 4); g.fill();
    });
    gen('icon_currency', 24, 24, (c) => {
      const g = c.getContext('2d')!;
      g.fillStyle = '#ffd233'; g.strokeStyle = '#cc9a12'; g.lineWidth = 2;
      g.beginPath(); g.arc(12, 12, 8, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#cc9a12'; g.font = 'bold 11px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('$', 12, 13);
    });
    gen('icon_upgrade', 24, 24, (c) => {
      const g = c.getContext('2d')!;
      g.fillStyle = '#33e0ff';
      g.beginPath(); g.moveTo(12, 2); g.lineTo(15, 9); g.lineTo(22, 9); g.lineTo(17, 14);
      g.lineTo(19, 22); g.lineTo(12, 17); g.lineTo(5, 22); g.lineTo(7, 14); g.lineTo(2, 9); g.lineTo(9, 9); g.closePath(); g.fill();
    });
    gen('icon_weapon', 24, 24, (c) => {
      const g = c.getContext('2d')!;
      g.fillStyle = '#ff8a3c'; g.fillRect(4, 10, 16, 4); g.fillRect(10, 6, 4, 12);
    });
    gen('icon_shop', 24, 24, (c) => {
      const g = c.getContext('2d')!;
      g.fillStyle = '#9feaff'; g.fillRect(5, 6, 14, 14); g.fillStyle = '#0a1016'; g.fillRect(9, 10, 2, 6); g.fillRect(13, 10, 2, 6);
    });
    gen('icon_boss', 24, 24, (c) => {
      const g = c.getContext('2d')!;
      g.fillStyle = '#ff3355'; g.strokeStyle = '#ffd233'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(12, 2); g.lineTo(22, 20); g.lineTo(2, 20); g.closePath(); g.fill(); g.stroke();
    });
    gen('icon_pause', 24, 24, (c) => {
      const g = c.getContext('2d')!;
      g.fillStyle = '#eafaff'; g.fillRect(6, 5, 5, 14); g.fillRect(13, 5, 5, 14);
    });
  }
}

function radial(c: HTMLCanvasElement, inner: string, outer: string): void {
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(c.width / 2, c.height / 2, 1, c.width / 2, c.height / 2, c.width / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.4, outer);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
}

function drawEnemy(c: HTMLCanvasElement, body: string, accent: string, r: number, diamond: boolean): void {
  const g = c.getContext('2d')!;
  const cx = c.width / 2, cy = c.height / 2;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath(); g.ellipse(cx, c.height - 4, c.width * 0.4, 5, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = body; g.strokeStyle = accent; g.lineWidth = 2.5;
  if (diamond) {
    g.beginPath(); g.moveTo(cx, 3); g.lineTo(c.width - 3, cy); g.lineTo(cx, c.height - 3); g.lineTo(3, cy); g.closePath();
    g.fill(); g.stroke();
  } else {
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = accent; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = accent;
  g.beginPath(); g.arc(cx, cy - 1, 2.5, 0, Math.PI * 2); g.fill();
}
