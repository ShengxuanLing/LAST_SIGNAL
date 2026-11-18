#!/usr/bin/env node
// ART-RENAISSANCE verification runner (works without npm on PATH).
// Runs each project tool through its JS entry with the current `node`, runs the
// full Playwright suite and the art baseline capture, then writes logs and a
// summary to reports/art/test-results/.
//
//   node scripts/art/run-checks.mjs [--phase before|after] [--only typecheck,unit,build,e2e,art]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const args = process.argv.slice(2);
const phase = args.includes('--phase') ? args[args.indexOf('--phase') + 1] : 'before';
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const want = (k) => !only || only.has(k);
const OUT = path.join(root, 'reports', 'art', 'test-results');
mkdirSync(OUT, { recursive: true });
const tmpBuild = path.join(os.tmpdir(), `last-signal-art-build-${Date.now()}`);
const nm = (p) => path.join(root, 'node_modules', p);

function run(name, file, argv, env = {}) {
  return new Promise((resolve) => {
    const log = path.join(OUT, `${phase}-${name}.log`);
    const stream = createWriteStream(log);
    const cmd = [process.execPath, file, ...argv];
    stream.write(`$ ${cmd.map((c) => path.relative(root, c) || c).join(' ')}\n# cwd ${root}\n# started ${new Date().toISOString()}\n\n`);
    const t0 = Date.now();
    const child = spawn(process.execPath, [file, ...argv], { cwd: root, env: { ...process.env, FORCE_COLOR: '0', ...env } });
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    child.on('close', (code) => {
      const ms = Date.now() - t0;
      stream.end(`\n# exit ${code} in ${(ms / 1000).toFixed(1)} s\n`);
      console.log(`[${code === 0 ? 'PASS' : 'FAIL'}] ${name} (${(ms / 1000).toFixed(1)} s) -> ${path.relative(root, log)}`);
      resolve({ name, code, seconds: +(ms / 1000).toFixed(1), log: path.relative(root, log).replace(/\\/g, '/'), command: `node ${path.relative(root, file).replace(/\\/g, '/')} ${argv.join(' ')}` });
    });
  });
}

const results = [];
const env = {
  node: process.version, platform: `${os.type()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGB: +(os.totalmem() / 2 ** 30).toFixed(1),
  startedAt: new Date().toISOString(), phase
};

if (want('typecheck')) results.push(await run('typecheck', nm('typescript/bin/tsc'), ['--noEmit']));
if (want('unit')) results.push(await run('unit', nm('vitest/vitest.mjs'), ['run', '--no-cache']));
if (want('build')) {
  results.push(await run('build', nm('vite/bin/vite.js'), ['build', '--outDir', tmpBuild, '--emptyOutDir']));
  results.push(await run('build-economy', nm('vite/bin/vite.js'), ['build', '--config', 'vite.economy.config.ts', '--outDir', tmpBuild + '-economy', '--emptyOutDir']));
}

if (want('e2e') || want('art')) {
  const pw = nm('@playwright/test/cli.js');
  const shotDir = path.join(os.tmpdir(), `last-signal-art-shots-${Date.now()}`);
  if (want('e2e')) results.push(await run('e2e', pw, ['test', '--reporter=line', '--workers=1', '--output', shotDir + '-out'], { PORT: '5173', LS_SHOT_DIR: shotDir, LAST_SIGNAL_ROOT: root }));
  if (want('art')) results.push(await run('art-capture', pw, ['test', '-c', 'playwright.art.config.ts'], { PORT: '5173', ART_PHASE: phase }));
}

env.finishedAt = new Date().toISOString();
const summary = { environment: env, results };
writeFileSync(path.join(OUT, `${phase}-summary.json`), JSON.stringify(summary, null, 2));
console.log(`summary -> reports/art/test-results/${phase}-summary.json`);
process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
