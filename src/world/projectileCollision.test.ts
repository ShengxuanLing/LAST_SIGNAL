import { describe, expect, it } from 'vitest';
import { circleContact, wallContact } from './projectileCollision';

describe('swept projectile contacts', () => {
  it('orders enemies and a one-tile wall on the same long frame', () => {
    const wall = wallContact(0.5, 2.5, 8, 0, (x, y) => x === 4 && y === 2);
    const near = circleContact(0.5, 2.5, 8, 0, 2, 2.5, 0.5);
    const far = circleContact(0.5, 2.5, 8, 0, 7, 2.5, 0.5);
    expect(near).toBe(1 / 8);
    expect(wall).toBe(3.5 / 8);
    expect(far).toBeGreaterThan(wall);
  });

  it('handles overlap, misses, tangents and targets beyond the remaining range', () => {
    expect(circleContact(0, 0, 0, 0, 0.1, 0, 1)).toBe(0);
    expect(circleContact(0, 0, 0, 0, 2, 0, 1)).toBe(Infinity);
    expect(circleContact(0, 0, 4, 0, 2, 1, 1)).toBe(0.5);
    expect(circleContact(0, 0, 4, 0, 6, 0, 1)).toBe(Infinity);
    expect(circleContact(0, 0, -4, 0, 2, 0, 1)).toBe(Infinity);
  });

  it('walks negative, diagonal and stationary grid segments', () => {
    expect(wallContact(2, 3, -2, 0, x => x === 1)).toBe(0);
    expect(wallContact(1.5, 1.5, -2, -2, (x, y) => x === 0 && y === 0)).toBe(0.25);
    expect(wallContact(1, 2, 0, 0, () => false)).toBe(Infinity);
    expect(wallContact(1, 2, 0, 0, () => true)).toBe(0);
  });
});
