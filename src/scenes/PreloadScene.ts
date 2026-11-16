/// <reference types="vite/client" />
import Phaser from 'phaser';
import { GAME } from '../config/game';
import { WHALE_TEXTURE, WHALE_SIDE_TEXTURE, WHALE_REAR_TEXTURE } from '../core/WhaleCharacter';
import whaleFront from '../assets/whale/front.png?url';
import whaleSide from '../assets/whale/side.png?url';
import whaleBack from '../assets/whale/back.png?url';
import { APPEARANCES, type DirectionalAvatar } from '../core/PlayerAppearance';
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
    this.add.text(cx, cy - 40, 'LAST SIGNAL', {
      fontFamily: 'monospace', fontSize: '48px', color: '#33e0ff',
      fontStyle: 'bold', letterSpacing: 6
    }).setOrigin(0.5, 0.5);
    this.add.text(cx, cy - 6, 'INITIALIZING COMBAT SYSTEMS', {
      fontFamily: 'monospace', fontSize: '16px', color: '#8fb8c8'
    }).setOrigin(0.5, 0.5);

    // Transition after textures have finished loading.
    const bw = 320, bh = 12, bx = cx - bw / 2, by = cy + 20;
    this.add.rectangle(bx, by, bw, bh, 0x0d1822).setOrigin(0.5, 0.5);
    const bar = this.add.rectangle(bx, by, 2, bh, 0x33e0ff).setOrigin(0, 0.5);
    const t = this.add.tween({
      targets: bar, scaleX: bw / 2, duration: 600, ease: 'Cubic.easeOut',
      onComplete: () => this.scene.start('MainMenuScene')
    });
  }
}
