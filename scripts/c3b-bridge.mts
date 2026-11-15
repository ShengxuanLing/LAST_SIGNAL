/**
 * AI-NATIVE-02 C3-b — start the loopback bridge for a HUMAN-authorized link.
 *
 * Credential safety: the token is generated locally and written to a private
 * file (POSIX chmod 0600 / Windows icacls current-user-only). It is NEVER
 * printed to stdout/stderr, never put in a URL and never shown in a screenshot.
 * Consumers read it from that file via LAST_SIGNAL_WORLD_TOKEN_FILE.
 *
 * Usage:
 *   npm run game:world:bridge
 *   # prints BRIDGE_URL / ORIGIN / TOKEN_FILE / ACL only
 *   # in the rendered game, the HUMAN configures the link and clicks
 *   # AUTHORIZE EXTERNAL AGENT in the Pause menu; then start the MCP --world
 *   # server with LAST_SIGNAL_WORLD_BRIDGE_URL / LAST_SIGNAL_WORLD_TOKEN_FILE.
 */
import { startWorldBridge } from '../src/ai-native/worldBridgeServer';
import { WorldGateway } from '../src/ai-native/worldGateway';
import {
  generateToken, writeSecureTokenFile, deleteSecureTokenFile, type SecureTokenFile
} from '../src/ai-native/secureTokenFile';
import {
  createOwnerCredentialFile, type OwnerCredentialFile
} from '../src/ai-native/ownerCredential';

const PORT = Number(process.env.LAST_SIGNAL_WORLD_PORT ?? 0);
const ORIGIN = process.env.LAST_SIGNAL_WORLD_ORIGIN ?? 'http://localhost:5173';
const token = process.env.LAST_SIGNAL_WORLD_TOKEN ?? generateToken();

async function main(): Promise<void> {
  let tokenFile: SecureTokenFile | null = null;
  let ownerFile: OwnerCredentialFile | null = null;
  try {
    tokenFile = await writeSecureTokenFile(token);
    // INDEPENDENT second credential. Its raw key is written to a current-user
    // private file, printed nowhere, and never placed in MCP env / attach /
    // observation / console. Only a human can read the file and paste it into
    // the masked in-game OWNER PAIRING KEY field.
    ownerFile = await createOwnerCredentialFile();
    const gateway = new WorldGateway();
    const bridge = await startWorldBridge({
      gateway,
      token,
      ownerKeyHash: ownerFile.keyHash,
      allowedOrigins: [ORIGIN],
      ...(PORT > 0 ? { port: PORT } : {})
    });

    // ONLY non-secret values are logged. The token is redacted everywhere.
    process.stdout.write(`BRIDGE_URL=${bridge.url}\n`);
    process.stdout.write(`ORIGIN=${ORIGIN}\n`);
    process.stdout.write(`TOKEN_FILE=${tokenFile.path}\n`);
    process.stdout.write(`TOKEN_ACL=${tokenFile.acl}\n`);
    process.stdout.write(`OWNER_KEY_FILE=${ownerFile.path}\n`);
    process.stdout.write(`OWNER_KEY_ACL=${ownerFile.acl}\n`);
    process.stdout.write('OWNER_KEY=<redacted; read the private file as a human and paste into the masked game form>\n');
    process.stdout.write('TOKEN=<redacted; read from TOKEN_FILE; never logged>\n');
    process.stdout.write('AGENT_LEASE=independent; MCP client renews; browser heartbeat cannot extend it\n');
    process.stdout.write('HUMAN_ACTION_REQUIRED=configure + click AUTHORIZE EXTERNAL AGENT in Pause/Settings\n');

    const stop = async (): Promise<void> => {
      await bridge.close();
      if (tokenFile) await deleteSecureTokenFile(tokenFile);
      if (ownerFile) await import('node:fs/promises').then((fs) => fs.rm(ownerFile!.directory, { recursive: true, force: true }));
      process.exit(0);
    };
    let stopping = false;
    const once = (): void => {
      if (stopping) return;
      stopping = true;
      void stop();
    };
    process.on('SIGINT', once);
    process.on('SIGTERM', once);
    process.stdin.on('end', once);
    await new Promise<void>(() => undefined);
  } catch (error) {
    if (tokenFile) await deleteSecureTokenFile(tokenFile).catch(() => undefined);
    if (ownerFile) await import('node:fs/promises').then((fs) => fs.rm(ownerFile!.directory, { recursive: true, force: true })).catch(() => undefined);
    process.stderr.write(`FAIL bridge: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

main();
