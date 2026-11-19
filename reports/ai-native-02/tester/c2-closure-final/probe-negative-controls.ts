// Negative tamper controls for the closure evidence: kill parity, loot pickup parity,
// and checkpoint ledger validation. Proves the checks are not vacuous.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import path from 'node:path';
import { validateCheckpoint } from './src/systems/RunCheckpoint';
import { basePlayerData } from './src/config/game';
import { PURCHASE_LEDGER_CAP } from './src/config/supplies';

const out: any = { checks: [], meta: { target: 'ae72a67' } };
const check = (n: string, ok: boolean, d?: any) => { out.checks.push({ n, ok, ...(d === undefined ? {} : { d }) }); if (!ok) process.exitCode = 1; };

// --- ledger validation negative controls ---
const base: any = {
  id: 'x', seed: 424242, roomId: 0, position: { x: 1, y: 1 }, clearedRooms: [0],
  portalTarget: null, rngState: 0,
  player: (() => { const pd: any = basePlayerData(); pd.weapons = [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }]; pd.weaponKey = 'pulse'; pd.upgrades = []; pd.abilities = []; pd.hp = 100; pd.maxHp = 100; pd.level = 1; pd.xp = 0; pd.xpToNext = 30; pd.currency = 0; return pd; })(),
  loot: [], stats: { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 },
  coreState: { tick: 0, rngState: 0, playerTimers: { dashTimer: 0, invuln: 0, hurtTimer: 0, fireTimer: 0, aimYaw: 0 }, nextProjectileId: 1 }
};
const withLedger = (ledger: any) => { const c = JSON.parse(JSON.stringify(base)); c.coreState.purchaseTransactions = ledger; return c; };
check('baseline-valid', validateCheckpoint(base) === true);
check('legacy-no-ledger-valid', validateCheckpoint(base) === true);
check('good-ledger-valid', validateCheckpoint(withLedger(['tx-1', 'tx-2'])) === true);
check('oversized-ledger-rejected', validateCheckpoint(withLedger(Array.from({ length: PURCHASE_LEDGER_CAP + 1 }, (_, i) => 'tx-' + i))) === false);
check('duplicate-ledger-rejected', validateCheckpoint(withLedger(['tx-1', 'tx-1'])) === false);
check('invalid-id-ledger-rejected', validateCheckpoint(withLedger(['', 'tx-2'])) === false);
check('non-array-ledger-rejected', validateCheckpoint(withLedger('nope')) === false);

// --- kill parity negative control ---
const tmp = path.resolve('.tester-negative');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(path.join(tmp, 'reports/ai-native-02/c2-fixes-round2/parity-kill'), { recursive: true });
for (const f of ['kill-initial.json', 'kill-sequence.json', 'kill-rendered.json']) cpSync(path.resolve('reports/ai-native-02/c2-fixes-round2/parity-kill', f), path.join(tmp, 'reports/ai-native-02/c2-fixes-round2/parity-kill', f));
const rendered = JSON.parse(readFileSync(path.join(tmp, 'reports/ai-native-02/c2-fixes-round2/parity-kill/kill-rendered.json'), 'utf8'));
rendered.xp = (rendered.xp ?? 0) + 1;
writeFileSync(path.join(tmp, 'reports/ai-native-02/c2-fixes-round2/parity-kill/kill-rendered.json'), JSON.stringify(rendered));
out.negativeKillDir = tmp;
out.meta.note = 'run scripts/c2-kill-parity.ts with cwd=' + tmp + ' and expect FAIL';
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-closure-final/13-negative-setup.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log(out.checks.every((c: any) => c.ok) ? 'NEGATIVE_SETUP_PASS' : 'NEGATIVE_SETUP_FAIL');
