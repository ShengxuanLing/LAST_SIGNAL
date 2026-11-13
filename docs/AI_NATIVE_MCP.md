# AI-NATIVE-01 P3 — Developer Harness + official MCP server

This is a **real Model Context Protocol server** built with the official
`@modelcontextprotocol/sdk` (`McpServer` + `StdioServerTransport`), plus a real
official-SDK client (`mcpClient.mts`). It is not a renamed JSON-line CLI.

- Transport: **stdio only**. stdout carries MCP protocol frames; diagnostics go to stderr.
- No network listener is opened. No global MCP config or credentials are modified by this repo.
- All game behaviour is delegated to the P2 `SessionManager` / `HeadlessGame`; no rules are copied.

## Build & direct process commands

```bash
npm run game:mcp:build          # -> dist-mcp/mcpServer.mjs (self-contained SSR bundle)
node dist-mcp/mcpServer.mjs           # PLAYER process (production sessions only)
node dist-mcp/mcpServer.mjs --dev     # DEV harness process (test sessions only)
```

`npm run game:mcp` / `npm run game:mcp:client` are local conveniences; npm prints a
banner, so MCP clients must use the **direct `node` command** above, not the npm script.
The dev-only `--dev` flag is fixed at process start; no tool argument can switch modes.

`SIGINT` / `SIGTERM` / stdin EOF / transport close all dispose the harness and its
`SessionManager` (timers cleared, sessions closed).

## Client configuration (documentation only — do not apply automatically)

Use the absolute path to `dist-mcp/mcpServer.mjs`. Example for clients that accept a
`mcpServers` JSON map:

```json
{
  "mcpServers": {
    "last-signal-player": {
      "command": "node",
      "args": ["D:/Project/LAST_SIGNAL/dist-mcp/mcpServer.mjs"]
    },
    "last-signal-dev": {
      "command": "node",
      "args": ["D:/Project/LAST_SIGNAL/dist-mcp/mcpServer.mjs", "--dev"]
    }
  }
}
```

Codex-style TOML (adapt to your installed client; this repo never edits it):

```toml
[mcp_servers.last_signal_player]
command = "node"
args = ["D:/Project/LAST_SIGNAL/dist-mcp/mcpServer.mjs"]

[mcp_servers.last_signal_dev]
command = "node"
args = ["D:/Project/LAST_SIGNAL/dist-mcp/mcpServer.mjs", "--dev"]
```

## Real tool matrix

| Tool | PLAYER process | DEV process | Notes |
| --- | :---: | :---: | --- |
| `game_create_session` | ✅ production | ✅ test + seed | Player accepts `{}` only; dev requires `seed` |
| `game_observe` | ✅ | ✅ | P0 `ObservationV1` (summary/standard) |
| `game_step` | ✅ | ✅ | P0 closed schema; **epoch required**; idempotency/tick reused |
| `game_execute_action` | ✅ P0 actions | ✅ P0 + advanced | **epoch required**; advanced is dev-only |
| `game_get_events` | ✅ | ✅ | bounded page + truncation notice |
| `game_close_session` | ✅ | ✅ | releases session/timers |
| `game_snapshot` | — | ✅ | returns an opaque handle, never a raw frame |
| `game_restore` | — | ✅ | same-process/same-session issued frame only |
| `game_run_scenario` | — | ✅ | deterministic legal strategy, seed dev-only |
| `game_inspect_state` | — | ✅ | full signal/Guard/collision readings |
| `game_inject_fixture` | — | ✅ | closed fixture schema, audited |
| `game_load_scenario` | — | ✅ | only `station-zero`; no filesystem/exec |
| `game_replay` | — | ✅ | real deterministic re-execution |
| `game_run_batch` | — | ✅ | 1..8 seeds, bounded concurrency |
| `game_compare_runs` | — | ✅ | state hash + ordered gameplay-event diff |
| `game_cancel_action` | — | ✅ | cancel an in-flight advanced action |

`listTools` and `callTool` are both isolated: the player process does not register
dev tools, so a player agent cannot list or call them. Tool input schemas are
strict/closed: `role`, `kind`, `devTicket`, and `seed` (on the player create) are
rejected rather than ignored. Session handles are opaque server-side mappings; the
internal `Session.id` never leaves the process. Responses carry
`structuredContent` with `schema`, `ok`, `code`/`messageKey`, `session` (handle),
`tick`, and a bounded event summary.

## Mandatory epoch (mutation contract)

`game_create_session` and `game_observe` return the current session `epoch`.
**Every** `game_step` and `game_execute_action` call (P0 action or advanced action)
must pass that `epoch`:

- missing / non-integer `epoch` → the strict MCP schema rejects the call (the
  harness path returns a structured `E_SCHEMA`); no tick/resource changes;
- an explicitly old `epoch` → `E_STALE_EPOCH`; no tick/resource changes;
- `game_inject_fixture` and `game_restore` bump the epoch; re-read it from the
  response (or `game_observe`) before the next mutation.

Example mutation:

```json
{
  "name": "game_step",
  "arguments": { "session": "ses_…", "epoch": 1, "ticks": 2, "actions": [] }
}
```

## Developer Harness

`src/ai-native/harness.ts` implements:

- `create_session` / `close_session` (player production or dev test),
- `load_scenario` (only the registered `station-zero` template),
- `step` / `execute_action` / `observe` / `get_events`,
- `inspect_state` (full signal/Guard/collision readings; dev only),
- `inject_fixture` (dev only, closed schema),
- `save_snapshot` / `restore_snapshot` (the `game_snapshot` / `game_restore` tools),
- `replay`, `run_scenario`, `run_batch`, `compare_runs`.

### Fixtures (closed, audited, dev/test only)

Accepted inputs are a small closed union — never an arbitrary full state:

- `named`: `lab_near_door`, `lab_low_energy`, `corridor_ready`, `corridor_guard_low_hp`.
- `player`: finite `x`/`y` (must be standable), `energy` 0..100, corridor `hp` 0..100.
- `door`: `SEALED | JAMMED_OPEN | OPEN | CLOSED | SAFE_PENDING_CLOSE`, optional `jamTicks`.
- `guard`: `hp` 0..1000, optional `jamTicks`, optional standable `x`/`y`.
- `relay`: `enabled`, `powered`, `bridge` (`UNAVAILABLE | STABLE`).

Fixtures apply through the domain `captureFull`/`restoreFull` seam, are re-validated
with the authoritative full-state range/geometry checks, bump the session epoch
(old actions become `E_STALE_EPOCH`), emit a `DEV_FIXTURE_INJECTED` audit event, and
mark the run `devTampered`. A fixture never fabricates an issued snapshot: a later
`snapshot()` issues a real frame whose `stateHash` matches the post-fixture state.
Player sessions cannot call fixtures/inspect (not registered and `E_PERMISSION`).

### Snapshots

Snapshot handles are random, server-side references to frames this process issued.
The registry is capped at **64** (aligned with the P1 issued-frame bound) with FIFO
eviction reported in `evicted`; each frame is bounded by the P2 snapshot-size budget.
`restore` rejects unknown handles, handles from another process, and handles from a
different session. Cross-process `load`/import is intentionally unsupported.

### Scenario / batch / compare

- `route-a` is a deterministic legal strategy (lab → Scan → Jam → door → corridor →
  relay → bridge → east shore). `idle` advances bounded ticks without movement.
- Budgets: max ticks, wall time, events, steps; failures/limits stop with a reason and
  the trace is returned. Sessions are closed in `finally`.
- `run_batch` runs 1..8 seeds with at most 2 concurrent sessions and isolates failures.
- `compare_runs` compares the seed-pinned canonical state hash and a deterministic
  gameplay-event projection (random event/action ids and seed-derived actor ids are
  excluded). Same-seed runs match; different-seed runs differ in state but keep the
  same gameplay event stream.

## MCP request idempotency (harness layer)

Tool calls that omit `fromTick`/`actionId` are still retry-safe. The harness caches
the **original, closed-validated tool arguments and first receipt** by
`(session, epoch, requestId, tool domain)` **before** it fills any default tick or
action id. The epoch is mandatory and is validated before any cache replay. Therefore:

- the same `requestId` + the same original arguments returns the exact first
  `StepResult` — no tick advance, no second resource write;
- the same `requestId` + different arguments is rejected with `E_ID_PAYLOAD_MISMATCH`;
- a failed first receipt (e.g. a stale scheduling tick) is cached and returned
  unchanged on retry;
- `game_step` and `game_execute_action` use separate domains (and a domain-scoped
  internal Session request id), so the same client id cannot be mis-reused across
  tools;
- `game_inject_fixture` / `game_restore` (new epoch) clear that session's request
  cache; a request with no epoch is rejected, an explicitly old-epoch request is
  rejected with `E_STALE_EPOCH`, and neither is ever replayed;
- the cache is bounded (256 entries) and cleared on `game_close_session` / dispose.

The underlying P2 Session request/action idempotency is unchanged; this is an
additional upper-layer guard for MCP tool semantics.

## Unimplemented boundaries (explicit, not faked)

- No P4 real-model playthrough; the deterministic strategies are harness verification.
- No P5 ECHO/Companion entity; the companion surface remains explicitly unavailable.
- No cross-process snapshot import, no arbitrary file loading/exec, no arbitrary
  state injection, no world/main-save migration.

## Integration client

`npx vite-node src/ai-native/mcpClient.mts` (after `npm run game:mcp:build`) spawns the
built server through the official `StdioClientTransport` (`windowsHide` on Windows) and
verifies initialize/listTools/callTool for both the player and dev processes, including
the full door/bridge route, dev-tool rejection, fixture/inspect, snapshot→step→restore→
replay, same/different-seed compare, batch, advanced cancellation/timeout, and clean
process exit.
