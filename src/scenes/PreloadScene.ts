/// <reference types="vite/client" />
import Phaser from 'phaser';
import { GAME } from '../config/game';
import { WHALE_TEXTURE, WHALE_SIDE_TEXTURE, WHALE_REAR_TEXTURE } from '../core/WhaleCharacter';
import whaleFront from '../assets/whale/front.png?url';
import whaleSide from '../assets/whale/side.png?url';
import whaleBack from '../assets/whale/back.png?url';
import { APPEARANCES, type DirectionalAvatar } from '../core/PlayerAppearance';
import { FONT } from '../art/survey/tokens';
import { UIC, UIN } from '../ui/palette';
import { sheetChrome } from '../ui/sheet';
import claudeFront from '../assets/claude/front.webp?url';
import claudeLeft from '../assets/claude/left.webp?url';
import claudeRight from '../assets/claude/right.webp?url';
import grokFront from '../assets/grok/front.webp?url';
import grokLeft from '../assets/grok/left.webp?url';
import grokRight from '../assets/grok/right.webp?url';
import geminiFront from '../assets/gemini/front.webp?url';
import geminiLeft from '../assets/gemini/left.webp?url';
import geminiRight from '../assets/gemini/right.webp?url';
import gptFront from '../assets/gpt/front.webp?url';
import gptLeft from '../assets/gpt/left.webp?url';
import gptRight from '../assets/gpt/right.webp?url';

const avatarImages: Record<DirectionalAvatar, [string, string, string]> = {
  claude: [claudeFront, claudeLeft, claudeRight],
  grok: [grokFront, grokLeft, grokRight],
  gemini: [geminiFront, geminiLeft, geminiRight],
  gpt: [gptFront, gptLeft, gptRight]
};

export class PreloadScene extends Phaser.Scene {
  constructor() { super('PreloadScene'); }

  preload(): void {
    this.load.image(WHALE_TEXTURE, whaleFront);
    this.load.image(WHALE_SIDE_TEXTURE, whaleSide);
    this.load.image(WHALE_REAR_TEXTURE, whaleBack);
    for (const avatar of Object.keys(avatarImages) as DirectionalAvatar[]) {
      APPEARANCES[avatar].textures.forEach((key, index) => this.load.image(key, avatarImages[avatar][index]));
    }
  }

  create(): void {
    const cx = GAME.WINDOW_W / 2, cy = GAME.WINDOW_H / 2;
    // UI-ART-01: boot sheet in the Survey Ink palette (matches index.html loader).
    sheetChrome(this.add.graphics());
    this.add.text(cx, cy - 78, 'ZERO STATION · EX-17', {
      fontFamily: FONT.mono, fontSize: '12px', color: UIC.dim
    }).setOrigin(0.5, 0.5).setLetterSpacing(5);
    this.add.text(cx, cy - 40, 'LAST SIGNAL', {
      fontFamily: FONT.mono, fontSize: '48px', color: UIC.text, fontStyle: 'bold'
    }).setOrigin(0.5, 0.5).setLetterSpacing(12);
    this.add.text(cx, cy + 4, 'INITIALIZING COMBAT SYSTEMS', {
      fontFamily: FONT.mono, fontSize: '13px', color: UIC.muted
    }).setOrigin(0.5, 0.5).setLetterSpacing(4);

    // Segmented survey bar: 24 cells fill left to right, then hand over.
    const cells = 24, cw = 12, gap = 3, bw = cells * cw + (cells - 1) * gap;
    const bx = cx - bw / 2, by = cy + 34;
    const g = this.add.graphics();
    const progress = { v: 0 };
    const paint = (): void => {
      g.clear();
      g.lineStyle(1, UIN.ink, 0.3);
      g.strokeRect(bx - 6.5, by - 8.5, bw + 13, 17);
      const lit = Math.round(progress.v * cells);
      for (let i = 0; i < cells; i++) {
        g.fillStyle(i < lit ? UIN.ink : UIN.mass, i < lit ? 0.95 : 1);
        g.fillRect(bx + i * (cw + gap), by - 4, cw, 8);
      }
      if (lit > 0 && lit < cells) { g.fillStyle(UIN.accent, 1); g.fillRect(bx + (lit - 1) * (cw + gap), by - 4, cw, 8); }
    };
    paint();
    this.add.tween({
      targets: progress, v: 1, duration: 600, ease: 'Cubic.easeOut',
      onUpdate: paint,
      onComplete: () => this.scene.start('MainMenuScene')
    });
  }
}
