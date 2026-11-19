// Independent probe: old-save compatibility for the purchase ledger and
// deep-copy semantics of cloneCheckpoint (ae72a67).
import { validateCheckpoint, cloneCheckpoint } from './src/systems/RunCheckpoint';
import { basePlayerData } from './src/config/game';
import { PURCHASE_LEDGER_CAP, TRANSACTION_ID_MAX_LENGTH } from './src/config/supplies';
import type { RunCheckpoint } from './src/types';

function makeCheckpoint(): RunCheckpoint {
  return {
    id: 'probe-run', seed: 424242, roomId: 0, position: { x: 5, y: 5 },
    clearedRooms: [0], portalTarget: null, rngState: 0,
    player: {
      ...basePlayerData(), level: 1, xp: 0, xpToNext: 30, currency: 0,
      weaponKey: 'pulse',
      weapons: [{ key: 'pulse', level: 1, ammo: -1, magazine: -1, reloading: false, reloadTimer: 0 }],
      upgrades: [], abilities: []
    },
    loot: [],
    stats: { kills: 0, items: 0, damage: 0, elapsedSeconds: 0 },
    coreState: {
      tick: 0, rngState: 0,
      playerTimers: { dashTimer: 0, invuln: 0, hurtTimer: 0, fireTimer: 0, aimYaw: 0 },
      nextProjectileId: 1
    }
  } as RunCheckpoint;
}

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log('PASS', name);
  else { failures++; console.log('FAIL', name, JSON.stringify(detail)); }
}

// Old save: no purchaseTransactions field must remain valid.
{
  const cp = makeCheckpoint();
  check('old save (no ledger) valid', validateCheckpoint(cp) === true);
}

// Present, well-formed ledger valid.
{
  const cp = makeCheckpoint();
  (cp.coreState as any).purchaseTransactions = ['a', 'b', 'c'];
  check('bounded well-formed ledger valid', validateCheckpoint(cp) === true);
}

// Over cap invalid.
{
  const cp = makeCheckpoint();
  (cp.coreState as any).purchaseTransactions = Array.from({ length: PURCHASE_LEDGER_CAP + 1 }, (_, i) => `t${i}`);
  check('over-cap ledger invalid', validateCheckpoint(cp) === false);
}

// Exactly cap valid.
{
  const cp = makeCheckpoint();
  (cp.coreState as any).purchaseTransactions = Array.from({ length: PURCHASE_LEDGER_CAP }, (_, i) => `t${i}`);
  check('exactly-cap ledger valid', validateCheckpoint(cp) === true);
}

// Duplicates invalid.
{
  const cp = makeCheckpoint();
  (cp.coreState as any).purchaseTransactions = ['dup', 'dup'];
  check('duplicate ledger ids invalid', validateCheckpoint(cp) === false);
}

// Empty / oversized ids invalid.
{
  const cp = makeCheckpoint();
  (cp.coreState as any).purchaseTransactions = [''];
  check('empty id invalid', validateCheckpoint(cp) === false);
}
{
  const cp = makeCheckpoint();
  (cp.coreState as any).purchaseTransactions = ['x'.repeat(TRANSACTION_ID_MAX_LENGTH + 1)];
  check('oversized id invalid', validateCheckpoint(cp) === false);
}

// cloneCheckpoint deep-copies the ledger (mutating clone must not affect source).
{
  const cp = makeCheckpoint();
  (cp.coreState as any).purchaseTransactions = ['keep'];
  const clone = cloneCheckpoint(cp);
  (clone.coreState as any).purchaseTransactions.push('mutated');
  check('cloneCheckpoint deep-copies ledger', (cp.coreState as any).purchaseTransactions.length === 1, {
    original: (cp.coreState as any).purchaseTransactions
  });
}

console.log(`OLD_SAVE_LEDGER_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
