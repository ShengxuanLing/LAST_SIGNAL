import type Phaser from 'phaser';
import type { Avatar } from '../types';
import { WHALE_REAR_TEXTURE, WHALE_SIDE_TEXTURE, WHALE_TEXTURE } from './WhaleCharacter';

export const APPEARANCES = {
  operator: { label: 'OPERATOR', textures: ['player'] },
  whale: { label: 'WHALE-CHAN', textures: [WHALE_TEXTURE, WHALE_SIDE_TEXTURE, WHALE_REAR_TEXTURE] },
  claude: { label: 'CLAUDE-CHAN', textures: ['claude-chan', 'claude-chan-left', 'claude-chan-right'] }
} as const satisfies Record<Avatar, { label: string; textures: readonly string[] }>;

export function availableAvatars(textures: Phaser.Textures.TextureManager): Avatar[] {
  return (Object.keys(APPEARANCES) as Avatar[])
    .filter((avatar) => APPEARANCES[avatar].textures.every((key) => textures.exists(key)));
}

export function resolveAvatar(avatar: Avatar | undefined, textures: Phaser.Textures.TextureManager): Avatar {
  return avatar && APPEARANCES[avatar].textures.every((key) => textures.exists(key)) ? avatar : 'operator';
}

export function faceClaude(sprite: Phaser.GameObjects.Sprite, dx: number, dy: number): void {
  if (Math.hypot(dx, dy) <= 0.01) return;
  const [front, left, right] = APPEARANCES.claude.textures;
  const side = Math.abs(dy) < Math.abs(dx) * 0.65;
  const texture = side ? (dx < 0 ? left : right) : front;
  if (sprite.texture.key === texture) return;
  sprite.setTexture(texture).setOrigin(texture === left ? 0.52 : texture === right ? 0.53 : 0.5, 0.99);
}
