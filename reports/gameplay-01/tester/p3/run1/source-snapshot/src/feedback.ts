// GAMEPLAY-01 P3 — pure presentation copy for the local ECHO page and the
// Signal HUD. No state, no World/core imports, no translation system: callers
// pass already-real proposal/pending/audit/view data and receive short strings.

import type { EchoLocalProposal, EchoLocalProposalKind, EchoMode } from '../ai-native/echo';
import type { EchoAuditEntry, EchoAuditProvenance } from '../ai-native/echoAudit';
import { SIGNAL_TUNING } from '../signal/signalTuning';

export type FeedbackSource = 'local' | 'model' | 'restored';

export interface LocalPendingView {
  kind: EchoLocalProposalKind;
  target?: { x: number; y: number } | null;
  restored?: boolean;
  proposalId?: string | null;
  acceptedTick?: number | null;
  roomGeneration?: number;
}

export interface LocalStatusInput {
  echo: { hp: number; maxHp: number } | null;
  mode: EchoMode;
  owner: string;
  lowRisk: boolean;
  proposal: EchoLocalProposal | null;
  pending: LocalPendingView | null;
}

export interface ProposalFreshnessInput {
  tick: number;
  scanCooldownTicks: number;
  jamCooldownTicks: number;
}

/** Minimal read-only Signal view used by the Pause/HUD copy. */
export interface FeedbackSignalView {
  relay: string;
  exitOpen: boolean;
  echoEnergy?: number;
  playerEnergy?: number;
  echoScanCD?: number;
  echoJamCD?: number;
  jammedUntilTick?: number;
}

export function sourceLabel(source: FeedbackSource): string {
  if (source === 'model') return 'MODEL · OWNER';
  if (source === 'restored') return 'RESTORED QUEUED ACTION';
  return 'LOCAL ECHO · A HUMAN CONFIRMS';
}

export function sourceOfProvenance(provenance: EchoAuditProvenance): FeedbackSource {
  return provenance === 'owner-external' ? 'model' : 'local';
}

export function actionLabel(kind: EchoLocalProposalKind): string {
  if (kind === 'scan') return 'Scan relay';
  if (kind === 'jam') return 'Jam relay';
  return 'Change relay route';
}

function actionPast(kind: string): string {
  if (kind === 'scan') return 'relay scanned';
  if (kind === 'jam') return 'relay jammed';
  if (kind === 'toggle-relay') return 'relay route changed';
  return 'done';
}

function modeLabel(mode: EchoMode): string {
  if (mode === 'follow') return 'Following';
  if (mode === 'hold') return 'Holding';
  if (mode === 'observe') return 'Observing';
  return 'Moving';
}

export function secondsLabel(ticks: number): string {
  return `${Math.max(0, Math.ceil(ticks / SIGNAL_TUNING.TICK_HZ))}s`;
}

export function localStatus(input: LocalStatusInput): string {
  if (!input.echo) return 'Echo is offline';
  const state = input.pending
    ? (input.pending.restored ? 'Restored queued action' : 'Queued')
    : input.proposal ? 'Ready to confirm' : 'No local suggestion';
  const owner = input.owner === 'human' ? 'Human' : 'AI';
  return `${state} · ${Math.ceil(input.echo.hp)}/${input.echo.maxHp} HP · ${modeLabel(input.mode)} · ${owner} owner`;
}

export function proposalLines(proposal: EchoLocalProposal, input: ProposalFreshnessInput): string[] {
  const kind = proposal.kind;
  const cost = kind === 'scan'
    ? `${SIGNAL_TUNING.SCAN_COST} echo energy`
    : 'no echo energy';
  const range = kind === 'scan'
    ? `${SIGNAL_TUNING.SCAN_RADIUS} tiles`
    : `${SIGNAL_TUNING.JAM_RANGE} tiles`;
  const cooldown = kind === 'scan' ? input.scanCooldownTicks : kind === 'jam' ? input.jamCooldownTicks : 0;
  const expires = proposal.expiresAtTick - input.tick;
  const freshness = expires <= 0
    ? 'This suggestion expired'
    : cooldown > 0 ? `Cooling down · ${secondsLabel(cooldown)}` : 'Ready now';
  const expected = kind === 'scan' ? 'reveal relay details' : kind === 'jam' ? 'silence the relay briefly' : 'change the relay route';
  return [
    actionLabel(kind),
    'Seen: relay in sight',
    `Cost: ${cost} · range ${range}`,
    freshness,
    'A human must confirm',
    `Expect: ${expected}`,
    'Only if still in sight and permitted'
  ];
}

export function waitingLines(pending: LocalPendingView): string[] {
  if (pending.restored) {
    return [
      'Restored queued action',
      'Waiting to resume',
      'No confirmation is recorded for this one'
    ];
  }
  return [
    'Waiting to resume',
    `Queued: ${actionLabel(pending.kind)} · runs after you resume`,
    'Confirm and reject are paused'
  ];
}

export function errorCopy(code?: string): string {
  switch (code) {
    case 'E_USER_REJECTED': return 'not sent';
    case 'E_ALREADY_PENDING': return 'already queued';
    case 'E_OWNER_NOT_HUMAN': return 'only a human can confirm';
    case 'E_STALE_ID': return 'this suggestion changed';
    case 'E_EXPIRED': return 'this suggestion expired';
    case 'E_STALE_ROOM': return 'the room changed';
    case 'E_REJECTED': return 'this suggestion was rejected';
    case 'E_TARGET_NOT_LEGAL': return 'the relay is no longer in sight';
    case 'E_ECHO_UNAVAILABLE': return 'echo is unavailable';
    case 'E_NOT_APPLICABLE': return 'this action is not available';
    case 'E_ECHO_DISABLED':
    case 'E_ECHO_DEAD': return 'echo disabled';
    case 'E_ROOM_CHANGED': return 'room changed';
    case 'E_LOCAL_REVOKED': return 'local action cancelled';
    case 'E_PERMISSION': return 'Not possible right now';
    case 'E_RETRYABLE': return 'try again';
    case 'E_COOLDOWN': return 'not ready yet';
    case 'E_ENERGY_INSUFFICIENT': return 'not enough echo energy';
    case 'E_PAUSED': return 'paused';
    default: return 'no effect';
  }
}

export function receiptLine(audit: EchoAuditEntry | null): string {
  if (!audit) return 'No recent actions';
  const prefix = audit.provenance === 'owner-external' ? 'Model Owner · ' : '';
  if (audit.result === 'enqueued') return `${prefix}Queued · ${actionLabel(audit.action as EchoLocalProposalKind)} · runs after you resume`;
  if (audit.result === 'applied') return `${prefix}Done · ${actionPast(audit.action)}`;
  if (audit.result === 'rejected') return `${prefix}Rejected · ${errorCopy(audit.code)}`;
  return `${prefix}Cancelled · ${errorCopy(audit.code)}`;
}

export function lastLocalAudit(entries: readonly EchoAuditEntry[]): EchoAuditEntry | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].provenance === 'human-local') return entries[i];
  }
  return null;
}

export function auditSummary(entries: readonly EchoAuditEntry[]): string {
  if (entries.length === 0) return 'No recent actions';
  return `Recent actions: ${entries.length}`;
}

export function auditLines(entries: readonly EchoAuditEntry[], roomGeneration?: number): string[] {
  if (entries.length === 0) return ['No recent actions'];
  const out: string[] = [];
  entries.forEach((entry, i) => {
    const source = entry.provenance === 'owner-external' ? 'Model (Owner)' : 'You';
    const action = actionLabel(entry.action as EchoLocalProposalKind);
    const outcome = entry.result === 'enqueued' ? 'Queued'
      : entry.result === 'applied' ? 'Done'
        : entry.result === 'rejected' ? 'Rejected' : 'Cancelled';
    out.push(`#${i + 1} ${source} · ${action} · ${outcome}`);
    if (entry.code) out.push(`  ${errorCopy(entry.code)} (${entry.code})`);
    const id = entry.proposalId ?? 'no local id';
    const target = entry.target ? `target ${entry.target.x.toFixed(1)},${entry.target.y.toFixed(1)}` : 'target none';
    const room = roomGeneration !== undefined ? ` · room gen ${roomGeneration}` : '';
    out.push(`  id ${id} · tick ${entry.tick} · ${target}${room}`);
  });
  return out;
}

export function signalDetailLines(
  view: FeedbackSignalView | null,
  linkFireEnabled: boolean | null,
  remainingJamTicks = 0
): string[] {
  if (!view) return ['No relay device in this run', 'Signal collaboration is off'];
  const scanCd = view.echoScanCD ?? 0;
  const jamCd = view.echoJamCD ?? 0;
  const scan = `Scan ${SIGNAL_TUNING.SCAN_COST} energy · ${SIGNAL_TUNING.SCAN_RADIUS} tiles · ${scanCd > 0 ? `${secondsLabel(scanCd)} cooldown` : 'ready'}`;
  const jam = `Jam ${SIGNAL_TUNING.JAM_COST} energy · ${SIGNAL_TUNING.JAM_RANGE} tiles · ${jamCd > 0 ? `${secondsLabel(jamCd)} cooldown` : view.relay === 'JAMMED' && remainingJamTicks > 0 ? `${secondsLabel(remainingJamTicks)} left` : 'ready'}`;
  const link = linkFireEnabled === null ? 'Link not present'
    : linkFireEnabled ? 'Link: new fire on' : 'Link: new fire off · old shots still live';
  return [scan, jam, link];
}

export function hudSignalLine(view: FeedbackSignalView | null, exit: string, remainingJamTicks = 0): string {
  if (!view) return 'RELAY OFF · NO DEVICE';
  const jam = view.relay === 'JAMMED' && remainingJamTicks > 0 ? ` · ${secondsLabel(remainingJamTicks)}` : '';
  return `RELAY ${view.relay} · ${exit}${jam}`;
}

export function hudDetailLines(linkFireEnabled: boolean | null): string[] {
  const link = linkFireEnabled === null ? '' : linkFireEnabled ? ' · LINK ON' : ' · LINK OFF';
  return [`T SCAN · Y JAM · R TOGGLE${link}`];
}
