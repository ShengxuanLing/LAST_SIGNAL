// CLI cold-start readiness + process reclamation check for 59aa852 (StationZero headless CLI).
// Read-only: drives the documented stdin/stdout JSON protocol, then verifies the process exits.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const SNAP = process.argv[2] ?? 'D:/Project/AI-NATIVE-02-snapshots/59aa852';
const out = { meta: { cwd: SNAP, target: '59aa852', note: 'cold start = fresh vite-node process' }, runs: [], findings: [] };
const runOnce = () => new Promise((resolve) => {
  const started = Date.now();
  const proc = spawn(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'src/ai-native/headlessCli.ts', '--run', '--dev'], {
    cwd: SNAP, stdio: ['pipe', 'pipe', 'pipe']
  });
  proc.on('error', (e) => resolve({ readyMs: -1, exitCode: null, signal: null, exitAfterQuitMs: -1, responses: [], stderr: ['spawn error: ' + e.message] }));
  let rawStdout = '';
  let errBuf = '';
  const responses = [];
  proc.stdout.on('data', (d) => { rawStdout += d.toString(); });
  proc.stderr.on('data', (d) => { errBuf += d.toString(); });
  const write = (obj) => proc.stdin.write(JSON.stringify(obj) + '\n');
  write({ cmd: 'create', id: 'ses_cold_01', seed: 424242 });
  setTimeout(() => {
    write({ cmd: 'observe', id: 'ses_cold_01' });
    setTimeout(() => {
      write({ cmd: 'quit' });
      const t0 = Date.now();
      const killTimer = setTimeout(() => { proc.kill(); }, 8000);
      proc.on('exit', (code, signal) => {
        clearTimeout(killTimer);
        resolve({
          readyMs: Date.now() - started,
          exitCode: code, signal,
          exitAfterQuitMs: Date.now() - t0,
          responses: rawStdout.split(String.fromCharCode(10)).filter(Boolean).map((l) => { try { const r = JSON.parse(l); return { ok: r.ok, cmd: r.cmd, tick: r.tick, hasObservation: !!r.observation, code: r.code }; } catch { return { raw: l.slice(0, 60) }; } }),
          rawStdoutLines: rawStdout.split(String.fromCharCode(10)).filter(Boolean).length,
          stderr: errBuf.split('\n').filter(Boolean).slice(0, 4)
        });
      });
    }, 900);
  }, 2500);
});
for (let i = 0; i < 3; i++) {
  const r = await runOnce();
  out.runs.push({ run: i + 1, ...r });
}
const allOk = out.runs.every((r) => r.responses.some((x) => x.ok && x.cmd === 'create') && r.responses.some((x) => x.ok && x.cmd === 'quit') && r.exitCode === 0);
out.findings.push({
  name: 'cli-cold-start-readiness',
  detail: out.runs,
  note: allOk ? 'cold start is ready and the process exits cleanly after quit' : 'cold start had a failure (see runs)'
});
writeFileSync('D:/Project/LAST_SIGNAL/reports/ai-native-02/tester/c2-current-triage/cli-coldstart-log.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
