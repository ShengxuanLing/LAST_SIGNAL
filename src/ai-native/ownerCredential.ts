// AI-NATIVE-02 P3-b Owner-auth fix — HOST-ONLY bootstrap credential.
//
// This module is intentionally Node-only. It is NEVER imported by a browser
// bundle, an MCP server, an attach route, an observation or a console script.
//
// The pairing key is generated on the local host, written to a current-user
// private file (POSIX 0600 / Windows current-SID-only ACL via secureTokenFile)
// and handed to a HUMAN by file path only. The human pastes the raw key into
// the masked in-game form; the bridge verifies sha256(key) against the hash it
// loaded here. An Agent holding the bridge token and a public Origin still has
// no way to learn or guess the key, so it cannot handshake, authorize itself
// or overwrite the human's authority.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hardenOwnerDirectory, hardenOwnerFile } from './secureTokenFile';

/** 32 bytes, lowercase hex. Deliberately a different shape from the bridge token. */
export const OWNER_PAIRING_KEY_PATTERN = /^[0-9a-f]{64}$/;

export interface OwnerCredentialFile {
  /** Path only. The raw key is never part of this object. */
  readonly path: string;
  readonly directory: string;
  readonly acl: string;
  /** sha256(raw key); safe to pass into startWorldBridge / log as metadata. */
  readonly keyHash: string;
}

/** Browser-safe hash helper (the bridge uses the same bytes on the wire). */
export function ownerKeyHash(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Constant-time comparison of two lowercase hex sha256 digests. */
export function ownerHashEquals(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) {
    return false;
  }
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Generate a fresh pairing key. Callers must write it via createOwnerCredentialFile. */
export function generateOwnerPairingKey(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Create a separate, current-user-private file for the Owner pairing key.
 * Returns ONLY metadata + the key hash; the raw key is written to disk and is
 * never returned through a log, an HTTP response, an MCP tool or an env var.
 */
export async function createOwnerCredentialFile(key = generateOwnerPairingKey()): Promise<OwnerCredentialFile> {
  if (!OWNER_PAIRING_KEY_PATTERN.test(key)) throw new Error('owner pairing key must be 32 bytes of hex');
  const directory = await mkdtemp(join(tmpdir(), 'last-signal-owner-'));
  await mkdir(directory, { recursive: true });
  const dirAcl = await hardenOwnerDirectory(directory);
  const path = join(directory, 'owner.key');
  await writeFile(path, key, { encoding: 'utf8', mode: 0o600 });
  const fileAcl = await hardenOwnerFile(path);
  return { path, directory, acl: `${dirAcl}+${fileAcl}`, keyHash: ownerKeyHash(key) };
}

/** Read the raw key from the private file. HOST / BRIDGE STARTUP ONLY. */
export async function readOwnerCredentialFile(path: string): Promise<string> {
  const key = (await readFile(path, 'utf8')).trim();
  if (!OWNER_PAIRING_KEY_PATTERN.test(key)) throw new Error('owner credential file is empty or malformed');
  return key;
}

/**
 * Load the hash from a host-only key file. The bridge accepts a path, never
 * the raw key, so a leaked option object or log line cannot disclose it.
 */
export async function ownerHashFromFile(path: string): Promise<string> {
  return ownerKeyHash(await readOwnerCredentialFile(path));
}
