// Renders every hand-authored concept SVG in art/concepts/** to a PNG in art/exports/
// (same relative path) using the bundled Chromium. Needs no dev server.
//   node node_modules/@playwright/test/cli.js test -c playwright.art.config.ts concepts
import { test } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = path.resolve('art', 'concepts');
const OUT = path.resolve('art', 'exports');

function svgs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return svgs(full);
    return name.endsWith('.svg') ? [full] : [];
  });
}

test('render concept SVGs to PNG', async ({ page }) => {
  for (const file of svgs(SRC)) {
    const head = readFileSync(file, 'utf8').slice(0, 400);
    const w = Number(/width="(\d+)"/.exec(head)?.[1] ?? 1280);
    const h = Number(/height="(\d+)"/.exec(head)?.[1] ?? 720);
    await page.setViewportSize({ width: w, height: h });
    await page.goto(pathToFileURL(file).href);
    await page.waitForTimeout(150);
    const rel = path.relative(SRC, file).replace(/\.svg$/, '.png');
    mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
    await page.screenshot({ path: path.join(OUT, rel) });
  }
});
