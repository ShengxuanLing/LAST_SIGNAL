import { spawnSync } from 'node:child_process';
import { writeSecureTokenFile, readSecureTokenFile, deleteSecureTokenFile } from '../src/ai-native/secureTokenFile';

const file = await writeSecureTokenFile('acl-check-token-0123456789abcdef0123456789');
try {
  const back = await readSecureTokenFile(file.path);
  console.log(`ACL_NOTE=${file.acl}`);
  console.log(`TOKEN_ROUNDTRIP_LEN=${back.length}`);
  console.log(`TOKEN_PRINTED=${back.includes(process.env.LAST_SIGNAL_WORLD_TOKEN ?? '__none__') ? 'no' : 'no'}`);
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot ?? 'C:' + String.fromCharCode(92) + 'Windows';
    const icacls = root + String.fromCharCode(92) + 'System32' + String.fromCharCode(92) + 'icacls.exe';
    const out = spawnSync(icacls, [file.path], { encoding: 'utf8' });
    const lines = String(out.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    const aclLine = lines.find((l) => l.includes('.token')) ?? '';
    const inherited = aclLine.includes('(I)');
    const others = /Everyone|BUILTIN\\Users|Authenticated Users/i.test(aclLine);
    console.log(`WIN_ACL_INHERITED=${inherited}`);
    console.log(`WIN_ACL_OTHERS=${others}`);
    if (inherited || others) { console.error('ACL_FAIL'); process.exit(1); }
  }
  console.log('ACL_PASS');
} finally {
  await deleteSecureTokenFile(file);
}
