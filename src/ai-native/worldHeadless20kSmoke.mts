/**
 * AI-NATIVE-02 C3c — REAL official-stdio 20k event-window long flow.
 *
 * Drives the Dev MCP server over actual stdio frames until the retained event
 * history (20k) is exceeded, then verifies:
 *  - the connection stays alive (no ~4MB response / no process death);
 *  - every response stays within the transport budget;
 *  - events_summary / paginated events report total, retained, windowStart,
 *    truncated, nextCursor and never silently drop a prefix;
 *  - a boundary snapshot ref + frame export report the exact history window,
 *    `eventsTruncated` and the `replayable` flag;
 *  - the exported (truncated-history) frame restores the complete STATE while
 *    still flagging the incomplete history.
 *
 * This is an interface/perf-boundary probe, NOT an LLM playthrough.
 */
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = resolve(process.cwd(), 'dist-mcp/worldHeadlessMcpServer.mjs');
const TARGET_TICKS = 11_000;
const STEP_TICKS = 1000;
const MAX_RESPONSE_BYTES = 512 * 1024;

function log(message: string, data?: unknown): void {
  process.stdout.write(`${message}${data === undefined ? '' : ` | ${JSON.stringify(data)}`}\n`);
}
function fail(message: string, data?: unknown): never {
  process.stderr.write(`FAIL ${message}${data === undefined ? '' : ` | ${JSON.stringify(data)}`}\n`);
  process.exit(1);
}
function assert(condition: unknown, message: string, data?: unknown): asserts condition {
  if (!condition) fail(message, data);
}

const rid = (n: number) => `req_${n.toString(16).padStart(24, '0')}`;

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [SERVER, '--dev'], env: { ...process.env } as never, stderr: 'pipe'
  });
  const client = new Client({ name: 'headless-20k', version: '0.0.0' });
  await client.connect(transport);
  let maxResponseBytes = 0;
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> => {
    const result = await client.callTool({ name, arguments: args });
    // Budget is the COMPLETE MCP result (text + structuredContent + envelope),
    // UTF-8 bytes, not just the text field.
    const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
    maxResponseBytes = Math.max(maxResponseBytes, bytes);
    if (bytes > MAX_RESPONSE_BYTES) fail(`${name}: full MCP result exceeds transport budget`, bytes);
    return (result.structuredContent as Record<string, any>) ?? { ok: false, code: 'E_SCHEMA' };
  };
  try {
    const created = await call('world_headless_create_session', { seed: 424242 });
    assert(created.ok === true, 'create', created);
    const session = created.session as string;
    const spawned = await call('world_headless_dev_spawn_enemies', {
      session, kinds: ['drone', 'drone', 'drone', 'drone', 'drone', 'drone', 'drone', 'drone']
    });
    assert(spawned.ok === true, 'spawn a real wave', spawned);
    const epoch = spawned.epoch as number;

    const started = Date.now();
    let stepCount = 0;
    for (let tick = 0; tick < TARGET_TICKS; tick += STEP_TICKS) {
      stepCount += 1;
      const step = await call('world_headless_step', { session, epoch, requestId: rid(1000 + stepCount), ticks: STEP_TICKS });
      assert(step.ok === true, `step ${stepCount}`, step);
      // Dev step must NOT inline the full canonical state/events.
      assert(step.canonicalState === undefined && step.canonicalEvents === undefined, 'step has no full canonical');
      assert(typeof step.stateFingerprint === 'string' && typeof step.eventsFingerprint === 'string', 'step has hashes');
      assert(Array.isArray(step.events) && step.events.length <= 64, 'step events are a bounded tail', step.events?.length);
    }
    const wallMs = Date.now() - started;
    log('PASS long_flow_alive', { stepCount, wallMs, maxResponseBytes });

    const summary = await call('world_headless_dev_events_summary', { session });
    assert(summary.ok === true, 'events summary', summary);
    assert(summary.eventTotal > 20_000, 'event history exceeded the 20k window', summary.eventTotal);
    assert(summary.eventsRetained === 20_000, 'retained window is exactly the cap', summary.eventsRetained);
    assert(summary.eventsTruncated === true, 'truncation flag is set', summary);
    assert(summary.windowStart > 0, 'window starts after a lost prefix', summary.windowStart);
    log('PASS window_summary', {
      eventTotal: summary.eventTotal, retained: summary.eventsRetained,
      windowStart: summary.windowStart, truncated: summary.eventsTruncated
    });

    const tailOffset = summary.eventTotal - 32;
    const tail = await call('world_headless_dev_events', { session, offset: tailOffset, limit: 32 });
    assert(tail.ok === true && tail.items.length === 32, 'tail page', tail.items?.length);
    assert(tail.offset === tailOffset, 'tail page offset', tail.offset);
    assert(tail.nextCursor === null, 'tail page is the end', tail.nextCursor);
    assert(tail.truncated === true && tail.lostPrefix === 0, 'tail page does not claim a lost prefix', tail);
    log('PASS tail_page', { offset: tail.offset, items: tail.items.length });

    const early = await call('world_headless_dev_events', { session, offset: 0, limit: 16 });
    assert(early.ok === true && early.offset === summary.windowStart, 'lost prefix is clamped to windowStart', early);
    assert(early.lostPrefix === summary.windowStart, 'lostPrefix reports the exact dropped prefix', early);
    log('PASS lost_prefix_explicit', { requestedOffset: early.requestedOffset, windowStart: early.windowStart, lostPrefix: early.lostPrefix });

    const paged = await call('world_headless_dev_events', { session, offset: summary.windowStart, limit: 256 });
    assert(paged.ok === true && paged.items.length === 256, 'first page of the retained window', paged.items?.length);
    assert(paged.nextCursor === summary.windowStart + 256, 'nextCursor advances', paged.nextCursor);

    const snapshot = await call('world_headless_dev_snapshot', { session });
    assert(snapshot.ok === true && typeof snapshot.ref === 'string', 'boundary snapshot ref', snapshot);
    assert(snapshot.boundary === 'action' && snapshot.eventsTruncated === true, 'snapshot flags the truncated history', snapshot);
    log('PASS boundary_snapshot_truncated', { ref: snapshot.ref, frameBytes: snapshot.frameBytes, truncated: snapshot.eventsTruncated });

    const exported = await call('world_headless_dev_frame_export', { session, ref: snapshot.ref });
    assert(exported.ok === true && typeof exported.path === 'string', 'frame export', exported);
    assert(exported.bytes > 4 * 1024 * 1024, 'full frame is a large local artifact (not a wire payload)', exported.bytes);
    const onDisk = await readFile(exported.path as string, 'utf8');
    assert(onDisk.length === exported.bytes, 'exported file matches the reported byte size');
    log('PASS frame_export_file', { path: exported.path, bytes: exported.bytes });

    const restored = await call('world_headless_dev_restore_file', { session, path: exported.path as string });
    assert(restored.ok === true, 'restore a truncated-history frame (complete STATE)', restored);
    assert(typeof restored.stateFingerprint === 'string', 'restore returns state/events fingerprints', restored);
    log('PASS restore_truncated_state', { epoch: restored.epoch });

    const failure = await call('world_headless_dev_export_failure', { session, reason: '20k-window' });
    assert(failure.ok === true && failure.replayable === false, 'truncated boundary export is NOT replayable', failure);
    assert(failure.eventsTruncated === true && String(failure.diagnostics?.note).includes('HISTORY TRUNCATED'), 'export note is explicit', failure.diagnostics?.note);
    log('PASS export_flag_truncated', { replayable: failure.replayable, note: failure.diagnostics?.note });

    await call('world_close', { session });
    log('HEADLESS_20K_STDIO_PASS', { eventTotal: summary.eventTotal, maxResponseBytes, wallMs });
  } finally {
    await client.close().catch(() => undefined);
    void randomBytes;
  }
}

main().catch((error) => fail('20k stdio long flow', error instanceof Error ? error.message : String(error)));
