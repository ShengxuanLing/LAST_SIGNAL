# AI-NATIVE-01 P4 — Real Player execution, feedback fix, and replay

This document records the **real** Player-permission execution of LAST SIGNAL by the
current Codex Lead over the official MCP Player surface, the observation-provenance
bugs that run exposed, and the neutral client / replay tooling delivered with the fix.

Model / agent: **the current Codex Lead** (interactive decisions). There was **no
independent provider**, no provider-side call counter and no token accounting
available — token usage is therefore reported as **unavailable**, never invented.
The run was **not blind**: the model had previously authored/reviewed this project;
the transport itself carried no map, route, strategy or game import, and the model
only used legal observations and the public `ActionPayloadV1` shapes (one rejected
`E_SCHEMA` retry was corrected from that public schema).

## Task-book P4 scenarios

All three task-book scenarios occurred in the same live run: A was Scan → rejected ordinary door interaction → Jam → legal passage; B was observing Relay/Bridge evidence, enabling the reachable Relay and waiting the public transition timer before crossing; C used the implemented `shoot_guard` action twice to clear the discovered Guard while its link was disconnected. Generic `fire` remains unsupported. The run is archived in `examples/ai-native/p4-codex-live.jsonl.gz`; decompressed SHA256 is recorded alongside it. This is one live run followed by verification, not three independent model runs.

## Evidence categories

| Scenario | What it is | Evidence |
| --- | --- | --- |
| **A — Immutable live run** | One production Player session driven step by step by the model through the neutral bridge. No Dev tools, fixtures, seed or private snapshots. | `D:/Project/AI-NATIVE-01-evidence/p4-codex-live.jsonl` |
| **B — Neutral replay** | The recorded MCP requests replayed through a fresh official Player MCP process, with session/epoch/requestId/actionId normalized; compares the public trajectory only. | `src/ai-native/replayPlayerTrace.mts`, `examples/ai-native/p4-player-trace.json` |
| **C — Contract negatives** | Missing/stale `epoch`, Dev-tool denial on the Player surface, `E_SCHEMA` payload retry, same-request/action idempotency. | MCP client + harness tests |

Scenario A facts (`p4-codex-live.jsonl`, SHA256
`0ba5cdb4f305527bd9de12e01a987c1dc5d7a2d3bed4c86eb940d418a09aea52`, 600142 bytes,
start `2026-11-12T23:06:59.607Z`, end `23:11:17.534Z`): 22 tool calls + quit
(23 requests / 22 results); total tool round-trip 93.0398 ms; interactive wall clock
≈258 s. Final public state: tick **501**, `crossed/completed = true`, HP 100,
Energy 96, room `station-zero-r2`, 29 public events. The model itself chose to
`interact` (rejected `E_LINK_UNAVAILABLE`), then Jam through the door, fire twice to
clear the guard, enable the relay and wait 89 ticks for the bridge, then explore
north for the exit. It did not call `run_scenario` or a route script.

## Bugs found by the live run (fixed)

1. **R2 scan used the stale R1 observer position.** Corridor evidence was built from
   the last laboratory `playerX/Y`, so `observerPosition` still read
   `(12.09375, 5.5)` while `current.self` was `(2.5, 10.5)` in R2. Fixed: the
   corridor builder uses the corridor avatar position; the lab builder uses the lab
   position.
2. **`sourceActionId` was synthetic.** It was derived from `targetId|tick`, not from
   the scan that produced the evidence. Fixed: the headless step records the actual
   P0 `actionId` into the evidence at scan time.
3. **`observerActorId` differed from `observation.actorId`.** Evidence used the
   engine-derived actor while the public observation used the session actor. Fixed:
   the trusted gateway passes its actor/epoch identity into the step, so the
   evidence and the public observation agree.
4. **Nested `observation.events[].sessionId` leaked the internal session id.**
   The MCP layer only rewrote the top-level `sessionId`. Fixed: observation events
   are recursively sanitized to the opaque MCP session handle.
5. **Corridor `knownConnections` were missing** even though legal relation evidence
   (`rel_corridor_relay_bridge`, `rel_corridor_relay_perception`) existed. Fixed
   with a minimal projection of already-revealed relations only — no speculative or
   hidden connections.

Provenance is recorded **at scan time** and restored verbatim: `restore` never
re-samples a position or fabricates an identity. Older browser saves keep loading
because the new evidence fields are optional; evidence written by the old build
remains valid.

## Neutral replay normalization

The replay is intentionally **not** a claim of full state-hash equality. A fresh
Player session uses a server-generated seed, so opaque identities and hashes differ.
The replayer replaces `session`, `epoch`, `requestId` and `actionId` and compares
only the public trajectory:

- final `tick` (501), `completed`, `hp` (100), `energy` (96), room;
- the ordered public event `type` + `tick` stream (29 events);
- every `ses_*` reference in the public envelope equals the replay's own handle.

`decisionNote` in the sample is provenance only and is never executed.

## Tooling

- `src/ai-native/agentClient.mts` — neutral official-SDK client: `listTools` /
  `callTool` only, JSONL record, no strategy/route/game import. Reads JSONL commands
  from `--script` or stdin (`{"op":"list"}`, `{"op":"call","name":...,"arguments":...}`,
  `{"op":"quit"}`).
- `examples/ai-native/p4-player-trace.json` — portable action-replay sample extracted
  from the immutable trace (requests, compact legal observation summaries, results,
  events, the one `E_SCHEMA` retry, provenance and baseline commit `ddcd7e9580…`).
  The raw JSONL is unchanged and remains the source of truth; a gzip archive plus
  sha256 manifest may be produced without editing it.
- `src/ai-native/replayPlayerTrace.mts` — neutral replayer over a fresh official
  **Player** MCP process.

```bash
npm run game:mcp:build
npx vite-node src/ai-native/agentClient.mts --log p4-agent-session.jsonl
npx vite-node src/ai-native/replayPlayerTrace.mts
node dist-mcp/mcpServer.mjs            # direct Player MCP process for an agent
node dist-mcp/mcpServer.mjs --dev      # trusted Dev harness (never used for P4)
```

## Boundaries

Not P5 (no ECHO/worldbuilding). No change to the main World or the published save
key/version. Dev fixtures/seed/private snapshots were never used for the P4 Player
evidence. The deterministic replay script is verification of MCP integration and of
the recorded decisions, not a second independent model run.
