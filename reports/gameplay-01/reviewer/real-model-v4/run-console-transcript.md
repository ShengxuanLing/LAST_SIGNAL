# v4 real-ECHO smoke — console transcript (reviewer transcription)

This file is a **transcription of the run's console output** captured by the reviewer tool output.
It is NOT the raw playwright log file (none was written to disk). The authoritative artifacts of
this run are `trace.json` (sha256 `42426bca84e581a85dfc4b17a74087dff4b3b39182c9d659ceec0d493881d88b`)
and the five screenshots in this directory.

- snapshot: `D:/tmp/gp01-v4-echo` = `git archive d55e502`
  (`src/world/World.ts 349544bf…`, `src/world/sim/core.ts f71523e1…`, verified before and after the run)
- own dist-mcp build: `dist-mcp/companionMcpServer.mjs` sha256 `a593a40e5cc900f3afde29460e00…`
- dev server: reviewer's own port **5487** (released after the run; tester 5199/5494 untouched, verified still LISTENING)
- command: `PORT=5487 npx playwright test -c _review/pw.echo.config.ts`
- model: local Magpie `http://127.0.0.1:3425/v1/chat/completions`, `group/elisa`, `max_tokens=1024`
- budget: `maxRequests=6` (harness), **used 2**, wall **51.4 s** (limit 5 min), no retry

```
[1/1] [chromium] › _review\echo-real-model.echo.spec.ts:123:1 › real Magpie ECHO chain: observe -> suggest -> Owner fixture confirm/reject -> disconnect fallback

[T1] echo landed {"seq":0,"page":"pause","paused":false,"tick":95,"hp":100,"echo":{"hp":94,"x":9.390557030091752,"y":45.85867427610251},"echoEnergy":100,"playerEnergy":100,"relay":"ACTIVE","evidence":0,"link":null,"comStatus":"OFF","pendingIntent":false}
[T1] companion connected {"seq":0,"page":"llm","paused":true,"tick":99,...,"comStatus":"CONNECTED","pendingIntent":false}
[T2] official observation {"ok":true,"observation":{"schema":"last_signal.companion.v1","epoch":1,"tick":99,"echo":{...hp 94},"player":{"x":8.5,"y":45.5},"drones":[{"id":1,...,"hp":24},{"id":2,...,"hp":24}],"targets":[],"relay":{"id":"relay_main","x":11.5,"y":48.5,"state":"ACTIVE"},"objectiveBlocked":false,"energy":{"current":100,"max":100},"cooldowns":{"scanTicks":0,"jamTicks":0},"memory":[...]}}
[T2] model response {"requestIndex":1,"httpStatus":200,"id":"chatcmpl-f525a29e45c15be4631c2b1e8b37c7ec","returnedModel":"group/elisa","finishReason":"stop","latencyMs":2537,"usage":{"completion_tokens":28,"completion_tokens_details":{"reasoning_tokens":0},"prompt_tokens":455,"total_tokens":483},"visibleContent":"{\"kind\":\"toggle-relay\",\"reason\":\"perceived_relay\",\"target\":{\"x\":11.5,\"y\":48.5}}"}
[T2] decision {"kind":"toggle-relay","reason":"perceived_relay","target":{"x":11.5,"y":48.5}},"validDecision":true}
[T2] suggest {"ok":true,"suggestion":{"suggestionId":"sug_d0565408c78ecc95b2e510a1","actorId":1,"kind":"toggle-relay","reason":"perceived_relay","target":{"x":11.5,"y":48.5},"createdAtTick":99,"expiresAtTick":219,"roomId":0,"generation":1,"status":"proposed"}}
[T3] confirmed while paused {"paused":true,"pendingIntent":false,"echoEnergy":100,"playerEnergy":100}
[T3] queue after second confirm 1
[T3] after resume {"tick":243,"echoEnergy":100,"playerEnergy":100,"relay":"INACTIVE","evidence":0,"pendingIntent":false}
[T3] toggle events [{"type":"signal-relay-changed","relay":"INACTIVE","manualEnabled":false,"powered":true}]
[T4] model attempt 2 {"requestIndex":2,"httpStatus":200,"id":"chatcmpl-3836d6c83488e883f1307110cb0d0a08","returnedModel":"group/elisa","latencyMs":1792,"usage":{"completion_tokens":11,"reasoning_tokens":0,"prompt_tokens":876,"total_tokens":887},"visibleContent":"{\"kind\":\"scan\",\"reason\":\"objective_blocked\"}"}
[T4] suggest2 {"ok":true,"suggestion":{"suggestionId":"sug_4be7996e3715860411b65160","kind":"scan","target":null,...}}
[T4] rejected {"pendingIntent":false,"echoEnergyBefore":100,"echoEnergyAfter":100,"evidenceBefore":0,"evidenceAfter":0,"tickBefore":267,"tickAfter":267}
[T4] resurrect attempt {"stillPending":false,"count":0}
[T5] disconnected {"comStatus":"FALLBACK:NO_MODEL","link":null,"echo":{...},"honestUi":true,"ui":["LLM COMPANION","ONLY A HUMAN HERE CAN CONFIRM · THE AGENT HAS NO CONFIRM TOOL","CONNECTION","STATE  FALLBACK:NO_MODEL","MODEL  OFFLINE","ENABLE / RE-AUTHORIZE (HUMAN)","PENDING PROPOSAL","No pending proposal."]}
[T5] offline local proposal {"id":"local_267_1","kind":"scan"}
[T5] offline local confirm queued 1
[BUDGET] {"requests":2,"wallMs":51332}

  1 passed (1.0m)
```

Notes / honesty markers
- Owner clicks and the masked Owner form are **autoOwner FIXTURE**, not a human (same harness as the 87a0fac run).
- The model's `target` values come from the official observation projection (relay `11.5,48.5`); no seed / dev id / Owner key is exposed to it.
- `trace.json.snapshot` contains the **stale literal** `"87a0fac"` written by my own harness (copy of the 87a0fac-era file). The real provenance is the archive + the verified source hashes above — do not cite that field.
- One run only: this is a bounded smoke, not a stability or balance sample.
