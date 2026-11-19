import { SIGNAL_TUNING } from './src/signal/signalTuning';
import { createSignalResources, validSignalResources, jamBlocker, scanBlocker, withinScanRange } from './src/signal/signalCore';
import { SliceModel } from './src/slice/rules';
import { CompanionFacet, COMPANION_LIMITS, type CompanionObservationView } from './src/ai-native/companionFacet';

let failures = 0;
const check = (n: string, c: boolean, d?: unknown) => { if (c) console.log('PASS', n); else { failures++; console.log('FAIL', n, JSON.stringify(d)); } };
const info = (n: string, d?: unknown) => console.log('INFO', n, JSON.stringify(d));

// 1. validSignalResources is a DENYLIST, not an allowlist: unknown extra keys survive
const withHidden = { ...createSignalResources('echo'), hiddenTarget: { x: 99, y: 99, hp: 999 } };
info('validSignalResources with extra hiddenTarget key', { accepted: validSignalResources(withHidden) });
const withFreeEnergy = { ...createSignalResources('echo'), energy: { energy: 100, regenAcc: 0, free: 1e9 } };
info('validSignalResources with extra nested energy.free key', { accepted: validSignalResources(withFreeEnergy) });

// 2. TWO jam gates exist: shared signalCore.jamBlocker vs SliceModel PRIVATE jamBlocker
const sharedGate = jamBlocker(createSignalResources('echo'), false, false);
const m = new SliceModel();
// Shared gate order: paused>failed>active>cooldown>energy. Slice order:
// active > (inCorridor && low energy) > cooldown > energy; paused/failed checked by jam() first.
check('shared jamBlocker legal at full resources', sharedGate === null);
const lowCd = {
  ...createSignalResources('echo'),
  energy: { energy: 5, regenAcc: 0 },
  cooldowns: { scanCooldownTicks: 0, scanRevealTicks: 0, jamCooldownTicks: 10, jamRemainingTicks: 0 }
};
info('shared jamBlocker with low energy AND cooldown returns', { code: jamBlocker(lowCd, false, false) });
// Slice private gate with same shape (lab, not corridor): cooldown wins over energy.
(m as any).energyValue = 5; (m as any).jamCooldownTicks = 10; (m as any).jamRemainingTicks = 0;
const slicePrivate = (m as any).jamBlocker();
info('slice PRIVATE jamBlocker with low energy AND cooldown returns', { code: slicePrivate?.code });
check('both gates agree on E_COOLDOWN for lab low-energy+cooldown', jamBlocker(lowCd, false, false) === 'E_COOLDOWN' && slicePrivate?.code === 'E_COOLDOWN');
// In CORRIDOR the slice gate checks energy BEFORE cooldown -> divergence vs shared gate
(m as any).corridor = {} as any; // make inCorridor true for the private gate only
const sliceCorridor = (m as any).jamBlocker();
info('slice PRIVATE jamBlocker in CORRIDOR with low energy+cooldown', { code: sliceCorridor?.code });
info('DUPLICATED JAM RULE: shared gate always cooldown-first; slice gate energy-first in corridor', {
  shared: jamBlocker(lowCd, false, false), sliceInCorridor: sliceCorridor?.code
});

// 3. '<' vs '<=' across modules: shared Signal is STRICT '<', companion perception is '<='
check('shared scan at exactly 12 excluded', !withinScanRange({ x: 0, y: 0 }, { x: SIGNAL_TUNING.SCAN_RADIUS, y: 0 }, () => true));
let idc = 0;
const f = new CompanionFacet({ session: 'ses_x', epoch: 1, suggestionIdFactory: () => `sug_${(++idc).toString(16).padStart(24, '0')}` });
const at12: CompanionObservationView = {
  epoch: 1, tick: 1, echo: { x: 0, y: 0, hp: 100, maxHp: 100, aimYaw: 0 }, player: { x: 2, y: 0 },
  drones: [{ id: 1, x: COMPANION_LIMITS.PERCEPTION_TILES, y: 0, hp: 10 }]
} as CompanionObservationView;
const obs = f.observe(at12);
info('companion facet at exactly 12 tiles (uses <=)', { ok: obs.ok, drones: obs.ok ? obs.value.drones.length : null });
check('boundary divergence visible: shared Signal excludes 12, companion perception includes 12',
  !withinScanRange({ x: 0, y: 0 }, { x: 12, y: 0 }, () => true) && obs.ok && obs.value.drones.length === 1);

// 4. scanBlocker / chargeScan are shared by slice (single gate for scan)
check('scanBlocker shared gate legal at full resources', scanBlocker(createSignalResources('echo'), false, false) === null);
check('scanBlocker paused', scanBlocker(createSignalResources('echo'), true, false) === 'E_PAUSED');
check('scanBlocker failed', scanBlocker(createSignalResources('echo'), false, true) === 'E_PERMISSION');

console.log(`BOUNDARY_${failures === 0 ? 'PASS' : 'FAIL'} failures=${failures}`);
if (failures > 0) process.exit(1);
