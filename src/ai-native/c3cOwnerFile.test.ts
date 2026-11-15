// C3c owner-file fix (Reviewer A–D):
//  A. frame/failure files are owner-only (POSIX 0600 / Windows current-SID ACL)
//  B. frame file paths reject junctions/symlinks escaping the frames root
//  C. the transport budget is charged on the FULL MCP result (text+structured)
//  D. oversized frame files are rejected BEFORE read/parse

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { HeadlessWorldManager, measureMcpResult } from './worldHeadlessMcpTools';

const aid = (n: number) => `aid_${n.toString(16).padStart(24, '0')}`;
const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;
const body = (r: any): any => r.structuredContent ?? { ok: false, code: 'E_SCHEMA' };
const FRAMES = resolve('reports/ai-native-02/c3c/frames');
/** Build a real MCP-shaped result (text + structuredContent) for byte accounting. */
function mcpResult(body: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(body) }],
    structuredContent: body
  } as any;
}
const OUTSIDE = resolve('reports/ai-native-02/c3c/frames-outside');

function dev(): HeadlessWorldManager {
  let seed = 424242;
  return new HeadlessWorldManager(true, () => (seed += 1));
}

function icacls(file: string): string {
  const root = process.env.SystemRoot ?? `C:${String.fromCharCode(92)}Windows`;
  const exe = join(root, 'System32', 'icacls.exe');
  return execFileSync(exe, [file], { encoding: 'utf8' });
}

async function snapshotSession(manager: HeadlessWorldManager) {
  const created = body(manager.createSession(424242));
  const drone = body(manager.observe(created.session)).observation.drones[0];
  body(manager.action(created.session, created.epoch, rid(1), [
    { type: 'fire', actionId: aid(1), target: { x: drone.x, y: drone.y }, ticks: 60 }
  ], 600));
  body(manager.step(created.session, created.epoch, rid(2), 60));
  const snap = body(manager.snapshot(created.session));
  expect(snap.ok).toBe(true);
  return { session: created.session as string, epoch: created.epoch as number, ref: snap.ref as string };
}

describe('C3c owner file — A: ACL is current-user only', () => {
  it('frame export and failure export are owner-only', async () => {
    const manager = dev();
    const { session, ref } = await snapshotSession(manager);
    const frame = body(await manager.frameExport(session, { ref }));
    const failure = body(await manager.exportFailure(session, 'acl-test'));
    expect(frame.path).toBeTruthy();
    expect(failure.path).toBeTruthy();
    if (process.platform === 'win32') {
      for (const file of [frame.path, failure.path]) {
        const acl = icacls(file as string);
        expect(acl, `${file} must not inherit broad ACEs`).not.toContain('(I)');
        expect(acl).not.toMatch(/BUILTIN\\Users|Authenticated Users|Everyone/i);
      }
    } else {
      for (const file of [frame.path, failure.path]) {
        const info = await stat(file as string);
        expect(info.mode & 0o777).toBe(0o600);
      }
    }
  }, 120_000);
});

describe('C3c owner file — B: junction/symlink escape is rejected', () => {
  it('rejects a symlink/junction under frames that points outside', async () => {
    const manager = dev();
    const { session } = await snapshotSession(manager);
    await mkdir(FRAMES, { recursive: true });
    await mkdir(OUTSIDE, { recursive: true });
    const outsideFrame = join(OUTSIDE, 'frame.json');
    // A valid-looking frame is not needed: path resolution must reject first.
    await writeFile(outsideFrame, JSON.stringify({ schema: 'x' }), 'utf8');
    const link = join(FRAMES, `escape-${Date.now()}`);
    let created = false;
    try {
      if (process.platform === 'win32') {
        execFileSync('cmd', ['/c', 'mklink', '/J', link, OUTSIDE], { stdio: 'ignore' });
      } else {
        await symlink(OUTSIDE, link);
      }
      created = true;
      const rejected = body(await manager.restoreFile(session, join(link, 'frame.json')));
      expect(rejected.ok).toBe(false);
      expect(rejected.code).toBe('E_PERMISSION');
      expect(rejected.messageKey).toBe('world.frame_path_forbidden');
    } finally {
      if (created) {
        try {
          if (process.platform === 'win32') execFileSync('cmd', ['/c', 'rmdir', link], { stdio: 'ignore' });
          else await rm(link, { force: true });
        } catch { /* best effort cleanup */ }
      }
      await rm(OUTSIDE, { recursive: true, force: true });
    }
  }, 120_000);

  it('a plain file inside frames is accepted, the frames root itself is not', async () => {
    const manager = dev();
    const { session, ref } = await snapshotSession(manager);
    const frame = body(await manager.frameExport(session, { ref }));
    expect(frame.ok).toBe(true);
    const rootRejected = body(await manager.restoreFile(session, FRAMES));
    expect(rootRejected.ok).toBe(false);
    expect(rootRejected.messageKey).toBe('world.frame_path_forbidden');
  }, 120_000);
});

describe('C3c owner file — C: budget is the full MCP result', () => {
  it('counts text + structuredContent + envelope, including non-ASCII', () => {
    const ascii = mcpResult({ message: 'x'.repeat(1000) });
    const cjk = mcpResult({ message: '中'.repeat(1000) });
    const asciiBytes = measureMcpResult(ascii);
    const cjkBytes = measureMcpResult(cjk);
    // The body appears twice (text + structuredContent) plus the envelope.
    expect(asciiBytes).toBeGreaterThan(2000);
    // 1000 CJK chars -> 3000 UTF-8 bytes per copy, so the result is much larger.
    expect(cjkBytes).toBeGreaterThan(asciiBytes + 3000);
    expect(cjkBytes).toBeGreaterThan(6000);
  });

  it('a page near the byte budget is shrunk using the full-result accounting', async () => {
    const manager = dev();
    const created = body(manager.createSession(424242));
    // Sustain a big event history so a max page is large.
    const spawned = body(manager.spawnEnemies(created.session,
      ['drone', 'drone', 'drone', 'drone', 'drone', 'drone', 'drone', 'drone']));
    const epoch = spawned.epoch as number;
    for (let i = 0; i < 4; i += 1) body(manager.step(created.session, epoch, rid(100 + i), 1000));
    const page = body(manager.devEvents(created.session, 0, 512));
    expect(page.ok).toBe(true);
    expect(measureMcpResult(mcpResult(page))).toBeLessThanOrEqual(512 * 1024);
    expect(page.limit).toBeLessThanOrEqual(512);
  }, 120_000);
});

describe('C3c owner file — D: oversized file rejected before read', () => {
  it('rejects a >16MiB frame file with a resource error (no parse)', async () => {
    const manager = dev();
    const { session } = await snapshotSession(manager);
    await mkdir(FRAMES, { recursive: true });
    const big = join(FRAMES, `oversize-${Date.now()}.frame.json`);
    // 17 MiB of filler; must be rejected by stat, not parsed.
    await writeFile(big, 'x'.repeat(17 * 1024 * 1024), 'utf8');
    try {
      const rejected = body(await manager.restoreFile(session, big));
      expect(rejected.ok).toBe(false);
      expect(rejected.code).toBe('E_RESOURCE_LIMIT');
      expect(rejected.messageKey).toBe('world.frame_file_too_large');
      const replayRejected = body(await manager.replayFile(session, big, [{ ticks: 1, intent: { move: { x: 0, y: 0 }, dash: false, fire: false, aim: null, interact: false } }]));
      expect(replayRejected.ok).toBe(false);
      expect(replayRejected.code).toBe('E_RESOURCE_LIMIT');
    } finally {
      await rm(big, { force: true });
    }
  }, 120_000);
});
