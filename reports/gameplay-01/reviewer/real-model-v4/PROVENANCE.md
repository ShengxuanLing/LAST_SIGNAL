# PROVENANCE sidecar — v4 real-ECHO smoke (trace.json)

Purpose: `trace.json` in this directory carries a **stale literal** `"snapshot": "87a0fac"` written by
my own reviewer harness (it was copied from the earlier 87a0fac-era file). That field is **not usable**
as provenance for this run. The trace file itself is **not modified**; this sidecar states the real
provenance, verified before and after the run.

| item | value |
|---|---|
| product under test | **v4** — snapshot created by `git archive d55e502` into `D:/tmp/gp01-v4-echo` |
| `src/world/World.ts` | `349544bf5785dad072fb7bc3c904d0c80bb08f4619d7834a598d7e58ec05dc64` (before **and** after the run) |
| `src/world/sim/core.ts` | `f71523e1ccd04828381ddfa0224db68ccaa890d41a98b3dd100c050e4bc36bf6` (before **and** after) |
| own MCP build | `dist-mcp/companionMcpServer.mjs` sha256 `a593a40e5cc900f3afde29460e00…` (built in the snapshot with `npm run game:mcp:build`) |
| node_modules | junction to my earlier echo snapshot; `package.json` identical to d55e502 modulo CRLF |
| dev server | reviewer's own port **5487** (released by PID after the run; tester 5199/5494 never touched, verified still LISTENING) |
| command | `PORT=5487 npx playwright test -c _review/pw.echo.config.ts` (cwd `D:/tmp/gp01-v4-echo`) |
| harness | copy of the 87a0fac ECHO harness; only OUT dir, `maxRequests 12→6`, default port 5488→5487 changed. Product `src/**` and `tests/**` untouched; main repo untouched |
| result | **PASS** — 1 passed / 1.0 m; `budgetUsed = {requests: 2, wallMs: 51361}`; `max_tokens 1024`; no retry |
| model request ids | `chatcmpl-f525a29e45c15be4631c2b1e8b37c7ec` (toggle-relay), `chatcmpl-3836d6c83488e883f1307110cb0d0a08` (scan) — both HTTP 200, `group/elisa` |
| artifacts | `trace.json` sha256 `42426bca84e581a85dfc4b17a74087dff4b3b39182c9d659ceec0d493881d88b`, `run-console-transcript.md`, 5 screenshots (`echo-1..5`) |
| secrets | none: no Authorization/Bearer/api_key/OWNER_KEY/reasoning_content/seed in the trace; screenshots only show pause/LLM pages |

Scope: one bounded smoke on a single run; **not** a stability, balance or human sample. Owner clicks and
the masked Owner form are `autoOwner` fixtures, not a human.
