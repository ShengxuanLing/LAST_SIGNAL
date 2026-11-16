import { describe, expect, it } from 'vitest';
import { ControlAuthority } from './control';

describe('C3-b control ownership', () => {
  it('HUMAN, LOCAL DEMO and EXTERNAL are distinct, explicit states', () => {
    const control = new ControlAuthority();
    expect(control.snapshot().mode).toBe('HUMAN');
    expect(control.snapshot().controllerLabel).toBe('LOCAL DETERMINISTIC');
    expect(control.snapshot().externalAgentConnected).toBe(false);

    control.enableAi();
    expect(control.snapshot().mode).toBe('AI');
    expect(control.snapshot().controllerLabel).toBe('LOCAL DETERMINISTIC');
    expect(control.snapshot().externalAgentConnected).toBe(false);

    control.enableExternal();
    expect(control.snapshot().mode).toBe('EXTERNAL');
    expect(control.snapshot().controllerLabel).toBe('EXTERNAL AGENT');
    expect(control.snapshot().externalAgentConnected).toBe(true);
    // Enabling external disables the local demo so they never fight over a frame.
    expect(control.aiEnabled).toBe(false);
  });

  it('human takeover cancels external control without an automatic re-take', () => {
    const control = new ControlAuthority();
    control.enableExternal();
    control.noteExternalAction('move', 12);
    expect(control.humanTakeover('human-input')).toBe(true);
    expect(control.owner).toBe('human');
    expect(control.externalConnected).toBe(false);
    expect(control.snapshot().controllerLabel).toBe('LOCAL DETERMINISTIC');
    expect(control.snapshot().agentLinkLabel).toContain('EXTERNAL NOT CONNECTED');
    // resume() must NOT silently restore the external owner.
    control.resume();
    expect(control.owner).toBe('human');
  });

  it('resume restores external control only while the link is still connected', () => {
    const control = new ControlAuthority();
    control.enableExternal();
    control.pause();
    control.resume();
    expect(control.owner).toBe('external');
    control.pause();
    control.disableExternal('pause');
    control.resume();
    expect(control.owner).toBe('human');
  });

  it('death / run end / scene exit / run start clear external ownership', () => {
    for (const transition of ['onDeath', 'onRunEnd', 'onSceneExit', 'onRunStart'] as const) {
      const control = new ControlAuthority();
      control.enableExternal();
      control.noteExternalAction('fire', 5);
      (control as any)[transition]();
      expect(control.owner, transition).toBe('human');
      expect(control.externalConnected, transition).toBe(false);
      expect(control.snapshot().externalAgentConnected, transition).toBe(false);
    }
  });

  it('the HUD last-action label comes from the real committed action', () => {
    const control = new ControlAuthority();
    control.enableExternal();
    control.noteExternalAction('move', 42);
    expect(control.snapshot().lastAiAction).toBe('move @42');
    control.disableExternal('heartbeat-loss');
    expect(control.snapshot().lastAiAction).toBeNull();
  });
});
