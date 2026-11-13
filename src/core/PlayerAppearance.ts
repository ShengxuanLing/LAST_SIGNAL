import type Phaser from 'phaser';
import { AVATARS, type Avatar } from '../types';
import { WHALE_REAR_TEXTURE, WHALE_SIDE_TEXTURE, WHALE_TEXTURE } from './WhaleCharacter';

export const APPEARANCES = {
  operator: { label: 'OPERATOR', textures: ['player'] },
  whale: { label: 'WHALE-CHAN', textures: [WHALE_TEXTURE, WHALE_SIDE_TEXTURE, WHALE_REAR_TEXTURE] },
  claude: { label: 'CLAUDE-CHAN', textures: ['claude-chan', 'claude-chan-left', 'claude-chan-right'], feet: [0.5, 0.52, 0.53] },
  grok: { label: 'GROK-CHAN', textures: ['grok-chan', 'grok-chan-left', 'grok-chan-right'], feet: [0.57, 0.48, 0.52] },
  gemini: { label: 'GEMINI-CHAN', textures: ['gemini-chan', 'gemini-chan-left', 'gemini-chan-right'], feet: [0.48, 0.5, 0.48] },
  gpt: { label: 'GPT-CHAN', textures: ['gpt-chan', 'gpt-chan-left', 'gpt-chan-right'], feet: [0.5, 0.46, 0.5] }
} as const satisfies Record<Avatar, { label: string; textures: readonly string[]; feet?: readonly number[] }>;

export type DirectionalAvatar = Exclude<Avatar, 'operator' | 'whale'>;

export function availableAvatars(textures: Phaser.Textures.TextureManager): Avatar[] {
  return AVATARS.filter((avatar) => APPEARANCES[avatar].textures.every((key) => textures.exists(key)));
}

export function resolveAvatar(avatar: Avatar | undefined, textures: Phaser.Textures.TextureManager): Avatar {
  return avatar && APPEARANCES[avatar].textures.every((key) => textures.exists(key)) ? avatar : 'operator';
}

export function faceAvatar(sprite: Phaser.GameObjects.Sprite, avatar: DirectionalAvatar, dx: number, dy: number): void {
  if (Math.hypot(dx, dy) <= 0.01) return;
  const { textures, feet } = APPEARANCES[avatar];
  const side = Math.abs(dy) < Math.abs(dx) * 0.65;
  const index = side ? (dx < 0 ? 1 : 2) : 0;
  const texture = textures[index];
  if (sprite.texture.key === texture) return;
  sprite.setTexture(texture).setOrigin(feet[index], 0.99);
}
