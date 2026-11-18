/// <reference types="vite/client" />
import Phaser from 'phaser';
import { saveSystem } from '../systems/SaveSystem';
import type { Avatar } from '../types';
import whaleFront from '../assets/whale/front.png?url';
import whaleSide from '../assets/whale/side.png?url';
import whaleBack from '../assets/whale/back.png?url';
import { APPEARANCES, resolveAvatar } from '../core/PlayerAppearance';
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

const avatarImages: Record<Exclude<Avatar, 'operator'>, [string, string, string]> = {
  whale: [whaleFront, whaleSide, whaleBack],
  claude: [claudeFront, claudeLeft, claudeRight],
  grok: [grokFront, grokLeft, grokRight],
  gemini: [geminiFront, geminiLeft, geminiRight],
  gpt: [gptFront, gptLeft, gptRight]
};

export class PreloadScene extends Phaser.Scene {
  constructor() { super('PreloadScene'); }

  readonly unavailable = new Set<Avatar>();
  private requested: Avatar = 'operator';
  private selecting = false;

  init(config: { avatar?: Avatar } = {}): void {
    this.selecting = config.avatar !== undefined;
    this.requested = config.avatar ?? saveSystem.getSettings().avatar ?? 'operator';
  }

  preload(): void {
    if (this.requested === 'operator') return;
    const urls = avatarImages[this.requested];
    APPEARANCES[this.requested].textures.forEach((key, index) => {
      if (!this.textures.exists(key)) this.load.image(key, urls[index]);
    });
    const loader = document.getElementById('loader');
    if (!loader || !this.load.list.size) return;
    loader.style.display = 'flex';
    const progress = (fraction: number) => {
      loader.textContent = `LOADING ${APPEARANCES[this.requested].label} · ${Math.round(fraction * 100)}%`;
    };
    progress(0);
    this.load.on(Phaser.Loader.Events.PROGRESS, progress);
    this.events.once('shutdown', () => this.load.off(Phaser.Loader.Events.PROGRESS, progress));
  }

  create(): void {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    let notice: string | undefined;
    if (resolveAvatar(this.requested, this.textures) !== this.requested) {
      this.unavailable.add(this.requested);
      notice = 'CHARACTER ART UNAVAILABLE';
    } else if (this.selecting) {
      if (!saveSystem.updateSettings({ avatar: this.requested })) notice = 'APPEARANCE NOT SAVED';
    }
    this.scene.start('MainMenuScene', { notice });
  }
}
