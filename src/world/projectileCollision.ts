/** First contact along (x, y) + t * (dx, dy), for t in [0, 1]. */
export function circleContact(x: number, y: number, dx: number, dy: number,
  cx: number, cy: number, radius: number): number {
  const ox = x - cx, oy = y - cy;
  const outside = ox * ox + oy * oy - radius * radius;
  if (outside <= 0) return 0;
  const along = ox * dx + oy * dy;
  if (along >= 0) return Infinity;
  const lengthSq = dx * dx + dy * dy;
  const discriminant = along * along - lengthSq * outside;
  if (discriminant < 0) return Infinity;
  const t = (-along - Math.sqrt(discriminant)) / lengthSq;
  return t <= 1 ? t : Infinity;
}

/** Visit grid cells in travel order, including on frames that cross several tiles. */
export function wallContact(x: number, y: number, dx: number, dy: number,
  isWall: (gx: number, gy: number) => boolean): number {
  let gx = Math.floor(x), gy = Math.floor(y);
  if (isWall(gx, gy)) return 0;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const stepX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const stepY = dy === 0 ? Infinity : Math.abs(1 / dy);
  let nextX = dx === 0 ? Infinity : (gx + (sx > 0 ? 1 : 0) - x) / dx;
  let nextY = dy === 0 ? Infinity : (gy + (sy > 0 ? 1 : 0) - y) / dy;
  while (Math.min(nextX, nextY) <= 1) {
    const t = Math.min(nextX, nextY);
    if (nextX === t) { gx += sx; nextX += stepX; }
    if (nextY === t) { gy += sy; nextY += stepY; }
    if (isWall(gx, gy)) return Math.max(0, t);
  }
  return Infinity;
}
