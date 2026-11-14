// AI-NATIVE-02 C3-b fix — credential-safe local token file.
//
// The bridge token must never appear in a URL, a process argument, a log line
// or a screenshot. Consumers pass ONLY the file path via env.
//
// Platform boundary (documented, not hidden):
//  - POSIX: chmod 0600 is meaningful and enforced by the kernel.
//  - Windows: `chmod(0600)` is a no-op (`-rw-r--r--`). We instead create the
//    file in the current user's temp dir and call the ABSOLUTE System32
//    binaries (Git Bash ships a GNU `whoami` that rejects `/user`):
//    `icacls /inheritance:r` removes inherited ACEs, then `/grant:r *<SID>:F`
//    grants full control ONLY to the current user's SID from `whoami.exe /user`.
//    Verified output: `<user>:(F)` with no `(I)` inherited entries. No large
//    dependency is introduced; the platform boundary is reported, not hidden.

import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function windowsExe(name: string): string {
  // Git Bash / MSYS ships a GNU `whoami` that does not understand `/user`.
  // Always call the Windows binary by its absolute System32 path.
  const root = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:' + String.fromCharCode(92) + 'Windows';
  return join(root, 'System32', name);
}

function currentUserSid(): string | null {
  try {
    const out = execFileSync(windowsExe('whoami.exe'), ['/user'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    });
    return out.match(/S-1-\d[\d-]*/)?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Lock the file to the current user only. Returns a human-readable ACL note. */
async function lockFile(file: string): Promise<string> {
  if (process.platform !== 'win32') {
    await chmod(file, 0o600);
    return 'posix:chmod0600';
  }
  const sid = currentUserSid();
  if (!sid) {
    await chmod(file, 0o600);
    return 'win32:whoami-unavailable(best-effort-chmod0600)';
  }
  try {
    const icacls = windowsExe('icacls.exe');
    execFileSync(icacls, [file, '/inheritance:r'], { stdio: 'ignore' });
    execFileSync(icacls, [file, '/grant:r', `*${sid}:F`], { stdio: 'ignore' });
    return `win32:icacls-inheritance-removed+grant-only-current-user-sid(${sid.slice(0, 12)}…)`;
  } catch {
    await chmod(file, 0o600);
    return 'win32:icacls-failed(best-effort-chmod0600)';
  }
}

export interface SecureTokenFile {
  readonly path: string;
  readonly directory: string;
  readonly acl: string;
}

/** Write a fresh token to a private file. NEVER returns or prints the token. */
export async function writeSecureTokenFile(token: string): Promise<SecureTokenFile> {
  if (!token || token.length < 16) throw new Error('token too short');
  const directory = await mkdtemp(join(tmpdir(), 'last-signal-c3b-'));
  const path = join(directory, 'bridge.token');
  await writeFile(path, token, { encoding: 'utf8', mode: 0o600 });
  const acl = await lockFile(path);
  return { path, directory, acl };
}

export async function readSecureTokenFile(path: string): Promise<string> {
  return (await readFile(path, 'utf8')).trim();
}

export async function deleteSecureTokenFile(info: SecureTokenFile): Promise<void> {
  await rm(info.directory, { recursive: true, force: true });
}

/** Generate a token without ever returning it through a log/response. */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}
