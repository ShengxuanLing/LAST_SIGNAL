# RUN — reproducing the v4 real-ECHO smoke (read-only harness copy)

This directory holds the **exact harness bytes that produced `../trace.json`** (verified by sha256
against the run tree). No token, Owner key, bridge secret or request header is stored here: the
transport token is generated with `randomBytes` at run time and the Owner key comes from the
dev/test fixture module `src/ai-native/ownerAuthFixture.ts`.

| file | sha256 |
|---|---|
| `echo-real-model.echo.spec.ts` | `e88f1d36b9d265992dd201dd94526c71bb42b30e6ab6cf486bd3789935e80773` |
| `pw.echo.config.ts` | `35fbe1a1a5a8f48c93d69a3df89d13fec27aa69c36928f92b5c484c3b14a12a4` |

## 1. Snapshot (must be v4)

```
git archive d55e502 | tar -x -C D:/tmp/gp01-v4-echo      # product v4
# node_modules: same package.json as d55e502 (a junction to an existing install is fine)
cd D:/tmp/gp01-v4-echo && npm run game:mcp:build         # builds dist-mcp/companionMcpServer.mjs
```

Verify before **and** after the run:

```
sha256sum src/world/World.ts      # 349544bf5785dad072fb7bc3c904d0c80bb08f4619d7834a598d7e58ec05dc64
sha256sum src/world/sim/core.ts   # f71523e1ccd04828381ddfa0224db68ccaa890d41a98b3dd100c050e4bc36bf6
```

## 2. Place the harness (verbatim)

The spec imports `../src/ai-native/{worldGateway,worldBridgeServer,ownerAuthFixture}`, so it must
run from a directory one level below the snapshot root (the run used `_review/`):

```
mkdir -p D:/tmp/gp01-v4-echo/_review
cp harness/echo-real-model.echo.spec.ts harness/pw.echo.config.ts D:/tmp/gp01-v4-echo/_review/
```

## 3. Run (own port only — never the tester's 5199/5492)

```
cd D:/tmp/gp01-v4-echo
npx vite --port 5487 --strictPort &            # this game's own dev server
PORT=5487 npx playwright test -c _review/pw.echo.config.ts
```

Result of the recorded run: `1 passed (1.0m)`, `budgetUsed = {requests: 2, wallMs: 51361}`,
`max_tokens = 1024`. Then stop only your own listener (`netstat -ano | grep :5487` → `taskkill /PID …`).

## 4. Env knobs baked into the copy

| knob | value in the run | note |
|---|---|---|
| `PORT` | `5487` | default in the copied spec is 5487 |
| model endpoint | `http://127.0.0.1:3425/v1/chat/completions` | local Magpie; `group/elisa` |
| `maxRequests` | **6** (harness) / used **2** | budget recorded in `trace.json.budgetUsed` |
| `maxTokens` | `1024` | |
| `wallLimitMs` | `5 * 60 * 1000` | |
| `OUT` | `reports/gameplay-01/reviewer/real-model-v4` | screenshots + `trace.json` |

## 5. Not reproducible from this directory alone

- `dist-mcp/` is a **build product** (not stored here); it must be produced by `npm run game:mcp:build`
  in the snapshot. Its hash in the recorded run: `dist-mcp/companionMcpServer.mjs` `a593a40e5cc900f3afde29460e00…`.
- `node_modules/` is not stored here.
- The model server (`127.0.0.1:3425`) is external; the recorded model ids are in `trace.json`.
- `trace.json` still carries the stale `"snapshot": "87a0fac"` literal written by the copied harness;
  use `../PROVENANCE.md` (and the Lead's `../PROVENANCE_ERRATA.md`), **not** that field.
