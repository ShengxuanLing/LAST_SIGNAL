import { describe, expect, it } from 'vitest';
import {
  auditLines, errorCopy, localStatus, proposalLines, receiptLine, sourceLabel, waitingLines,
  type LocalPendingView
} from './feedback';
import type { EchoAuditEntry } from '../ai-native/echoAudit';
import type { EchoLocalProposal } from '../ai-native/echo';

const proposal: EchoLocalProposal = {
  id: 'local_100_1', kind: 'scan', target: { x: 8, y: 45 }, reason: 'perceived_relay',
  evidenceRef: 'relay:relay_main', observedTick: 100, expiresAtTick: 220,
  roomGeneration: 1, provenance: 'local-echo', expectation: 'reveal relay facts',
  uncertainty: 'only if still in sight', cost: { energy: 10, resource: 'echo-energy' },
  needsConfirm: true
};
const enqueued: EchoAuditEntry = {
  tick: 100, provenance: 'human-local', action: 'scan', target: { x: 8, y: 45 },
  result: 'enqueued', proposalId: 'local_100_1'
};
const applied: EchoAuditEntry = { ...enqueued, tick: 101, result: 'applied' };
const rejected: EchoAuditEntry = {
  tick: 102, provenance: 'owner-external', action: 'toggle-relay', target: null,
  result: 'rejected', code: 'E_PERMISSION', proposalId: 'local_102_1'
};
const restored: LocalPendingView = { kind: 'scan', restored: true, proposalId: null, acceptedTick: null };

describe('P3 feedback copy branches', () => {
  it('enqueued is Queued, never Done (receipt only after core)', () => {
    expect(receiptLine(enqueued)).toMatch(/^Queued · Scan relay · runs after you resume$/);
    expect(receiptLine(enqueued)).not.toContain('Done');
    expect(receiptLine({ ...enqueued, provenance: 'owner-external' })).toBe('Model Owner · Queued · Scan relay · runs after you resume');
  });

  it('applied is Done only for the real receipt', () => {
    expect(receiptLine(applied)).toBe('Done · relay scanned');
    expect(receiptLine({ ...applied, provenance: 'owner-external' })).toBe('Model Owner · Done · relay scanned');
  });

  it('rejected/cancelled keep the real result and an explanation', () => {
    expect(receiptLine(rejected)).toBe('Model Owner · Rejected · Not possible right now');
    expect(receiptLine({ ...rejected, result: 'cancelled', code: 'E_ECHO_DISABLED' })).toBe('Model Owner · Cancelled · echo disabled');
    expect(receiptLine(null)).toBe('No recent actions');
  });

  it('E_PERMISSION is generic and never invents range/LOS; retry is not cooldown', () => {
    expect(errorCopy('E_PERMISSION')).toBe('Not possible right now');
    expect(errorCopy('E_PERMISSION')).not.toMatch(/range|line of sight|LOS/i);
    expect(errorCopy('E_RETRYABLE')).toBe('try again');
    expect(errorCopy('E_RETRYABLE').toLowerCase()).not.toContain('cooldown');
  });

  it('restored busy is honest and never labeled human-local', () => {
    const text = waitingLines(restored).join(' | ');
    expect(text).toContain('Restored queued action');
    expect(text).toContain('Waiting to resume');
    expect(text).not.toMatch(/human-local|proposalId|local_\d/i);
  });

  it('default waiting/proposal/status contain no raw id/tick/code/room generation', () => {
    const local: LocalPendingView = { kind: 'scan', proposalId: 'local_100_1', acceptedTick: 100, roomGeneration: 1 };
    const waiting = waitingLines(local).join(' | ');
    expect(waiting).toContain('Waiting to resume');
    expect(waiting).toContain('Queued: Scan relay · runs after you resume');
    expect(waiting).not.toMatch(/local_100_1|tick 100|room gen|E_[A-Z]+/);
    const lines = proposalLines(proposal, { tick: 100, scanCooldownTicks: 0, jamCooldownTicks: 0 }).join(' | ');
    expect(lines).toContain('Ready now');
    expect(lines).not.toMatch(/local_100_1|tick 100|room gen|E_[A-Z]+|expires/i);
    const status = localStatus({ echo: { hp: 94, maxHp: 100 }, mode: 'follow', owner: 'human', lowRisk: false, proposal, pending: local });
    expect(status).toContain('Queued');
    expect(status).not.toMatch(/local_100_1|tick 100|room gen|E_[A-Z]+/);
  });

  it('audit keeps friendly source/result/explanation before raw traceability', () => {
    const lines = auditLines([enqueued, rejected], 1);
    expect(lines[0]).toBe('#1 You · Scan relay · Queued');
    expect(lines[1]).toMatch(/^  id local_100_1 · tick 100 · target 8\.0,45\.0 · room gen 1$/);
    expect(lines[2]).toBe('#2 Model (Owner) · Change relay route · Rejected');
    expect(lines[3]).toBe('  Not possible right now (E_PERMISSION)');
    expect(lines[4]).toMatch(/^  id local_102_1 · tick 102 · target none · room gen 1$/);
    expect(auditLines([])).toEqual(['No recent actions']);
  });

  it('source labels are honest: local is not model, model is explicit', () => {
    expect(sourceLabel('local')).toBe('LOCAL ECHO · A HUMAN CONFIRMS');
    expect(sourceLabel('local')).not.toContain('OFFLINE');
    expect(sourceLabel('model')).toBe('MODEL · OWNER');
    expect(sourceLabel('restored')).toContain('RESTORED');
  });
});
