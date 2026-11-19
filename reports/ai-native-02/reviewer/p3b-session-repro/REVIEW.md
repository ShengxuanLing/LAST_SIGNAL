# P3-b Lead 实际 Companion 会话失败独立定界（ae8b4e2）

- **被测提交**：`ae8b4e22e9d82fc98b295ac52beb5382515446b1`（HEAD，分支 `feat/ai-native-world-integration`，父 `3fb8af9`）
- **冻结**：`git -c core.autocrlf=false -c core.eol=lf archive ae8b4e2 | tar -x -C D:/Project/lastsignal-p3b-session-repro-review-ae8b4e2`；`node_modules` junction；Python 逐文件 git blob SHA1 → **ALL_TRACKED_FILES_MATCH（2032/2032, MISMATCH=0, MISSING=0）**
- **边界**：未改生产源码/已有测试/配置/分支；未 merge/reset；未读/恢复共享 WIP/stash；未先手动 `pushObservation`/`step` 掩盖问题；token/ownerKey 仅进程内随机，未进日志/参数/URL/截图
- **输入证据**：`reports/ai-native-02/lead-echo-model-fixed/FAILURE.md` + `tool-io.jsonl` + `bootstrap.json` + `owner-bootstrap-and-agent-adapter.mts`
- **结论**：**Lead 的失败是真实 runtime 缺陷，可稳定复现；不是 B1 授权漏洞回退（B1 授权链本身 PASS）。根因是 Companion 会话在 Pause 授权态下的“首份观察未推送 + 无真实 renderer heartbeat”，与 5s LOST 超时冲突。**

## 1. 原始错误（Lead 证据，原样）

`reports/ai-native-02/lead-echo-model-fixed/tool-io.jsonl`：
```
{"round":1,"at":"2026-11-15T16:39:15.038Z","tool":"echo_observe","result":{"schema":"last_signal.mcp.companion-result.v1","ok":false,"code":"E_LINK_UNAVAILABLE","messageKey":"companion.no_observation"}}
{"round":2,"at":"2026-11-15T16:39:27.959Z","tool":"echo_observe","result":{"schema":"last_signal.mcp.companion-result.v1","ok":false,"code":"E_STALE_EPOCH","messageKey":"world.stale_epoch"}}
```
- Owner 通过真实全新表单（URL/Agent token/独立 Owner key，无 global 配置注入）授权成功 `CONNECTED`、表单关闭。
- 两次 `echo_observe` 间隔 12.9s；从未到达 `echo_suggest`；无确认/伤害成功证据。
- 该失败**不**是 LLM 建议成功验收；原两份 Player 小遭遇不受影响。

## 2. 源码定界（4 个确认的缺陷点）

| # | 位置 | 缺陷 | 后果 |
|---|---|---|---|
| D1 | `src/ai-native/companionLink.ts` `authorize()` | 成功后只置 `CONNECTED` + `startHeartbeat()`，**不推首份 observation** | `echo_observe` 立即 `E_LINK_UNAVAILABLE companion.no_observation` |
| D2 | `src/scenes/GameScene.ts` `update()` / `onPause()` | 观察推送仅由 `GameScene.update` 的 `companionFrame % 30` 驱动；`onPause()` 置 `this.paused = true` 并 `scene.launch('PauseScene')`，`update()` 立即 return | Pause 面板（Companion 所在处）打开时**永不推观察**；core tick 也冻结 |
| D3 | `src/ai-native/companionLink.ts` `startHeartbeat()` | 默认 5000ms；只 `GET /world-link/companion-status`，**从不 POST `/world-link/heartbeat`**；`companion-status` GET 不刷新 `gateway.lastSeenMs` | `LOST_AFTER_MS=5000` 到期 → `reapExpired` 置 `lost` 且 epoch+1；GET 变 409/stale；Agent 缓存旧 epoch → `E_STALE_EPOCH` |
| D4 | `src/ai-native/companionLink.ts` `get()` / `decide()` | `get()` 把 `ownerCap` 放 **query URL**；`decide()` 用 `suggestion.createdAtTick + 1` 而非真实 core tick | 凭据进 URL（应 header/body）；tick 伪造（应调 `appliedTick()` 真实 tick） |

**关键事实链**：`onPause()` 在授权前已把 GameScene 置 paused（Lead 适配器 `Escape → PauseScene → LLM COMPANION → 填表 → AUTHORIZE`）。因此 authorization 发生在一个**没有 GameScene 帧**的状态：D1 不推首份 obs，D2 永远不推，D3 的 5s GET-only 心跳不续会话 → `lastSeenMs` 停在手握手时刻 → 5s 后 LOST+epoch 跳变 → `stale_epoch`。Agent 自身 lease 续约**不能**替代 renderer heartbeat（`lastSeenMs` 只由 `pushObservation`/`POST heartbeat` 刷新）。

## 3. 独立 15 秒暂停会话 probe（真实桥接 + 官方 Companion MCP，Agent env 仅 token）

探针：`reviewer-probe-session-repro.mts`（未手动 push/step）。流程：真实 HTTP 桥接（token + host ownerKeyHash）→ 人类持 ownerKey 手握手 → ownerCap 授权 `CONNECTED` → 官方 `dist-mcp/companionMcpServer.mjs`（env 仅 `LAST_SIGNAL_WORLD_BRIDGE_URL`+`TOKEN`，无 ownerKey/ownerCap）→ round 1 `echo_observe` → 空闲 15s（仅做 CompanionLink 心跳的 GET companion-status 每 1s）→ round 2 `echo_observe`；同时观测 gateway session status/epoch 与 core tick。

实测（`gate-probe-session-repro.log`）：
```
PASS human handshake with ownerKey -> 200 + ownerCap
PASS companion authorize (ownerCap) -> 200 CONNECTED
INFO gateway right after authorize (Pause open) {"status":"connected","epoch":1,"lastSeenAgoMs":18}
INFO round 1 echo_observe {"ok":false,"code":"E_LINK_UNAVAILABLE","messageKey":"companion.no_observation"}
PASS round 1 echo_observe -> E_LINK_UNAVAILABLE companion.no_observation (no initial push)
INFO idle tick 1s..4s {"gatewayStatus":"connected","gatewayEpoch":1,"heartbeatStatus":200}
INFO idle tick 5s     {"gatewayStatus":"lost","gatewayEpoch":2,"heartbeatStatus":409,"heartbeatOk":false}
INFO idle tick 6s..15s {"gatewayStatus":"lost","gatewayEpoch":2,"heartbeatStatus":409}
PASS gateway session became LOST despite GET-only heartbeat (renderer heartbeat not POSTed)
PASS gateway epoch bumped past the agent-cached epoch
INFO round 2 echo_observe {"ok":false,"code":"E_STALE_EPOCH","messageKey":"world.stale_epoch","gatewayEpoch":2}
PASS round 2 echo_observe -> E_STALE_EPOCH world.stale_epoch (Agent cached old epoch)
SESSION_REPRO_PASS failures=0
```
- 与 Lead 两次原始错误**逐字一致**：round 1 `companion.no_observation` → 5s LOST（epoch 1→2）→ round 2 `world.stale_epoch`。
- 核心 tick 在本探测中保持 0（未 step）；真实浏览器 Pause 态同样冻结 `GameScene.update`（源码 D2），故 core tick 不推进、观察不推送。
- GET-only 心跳（`companion-status`）从 5s 起持续 409，证明它**不**续会话。

## 4. 是否真实 runtime 缺陷

**是**。判定依据：
1. 人类授权链本身完全成功（handshake+ownerCap+authorize 全 200，`CONNECTED`），不是 B1 授权回退（`ownerAuth.test.ts` 8/8、`worldBridgeServer.test.ts` 7/7 全 PASS，见 gate-auth-sanity.log）。
2. 失败由**产品会话生命周期**决定，与适配器自动化无关：Pause 面板是合法授权态，但该态下（a）首份观察从不推送，（b）唯一心跳只 GET 状态、不 POST renderer heartbeat，与 `LOST_AFTER_MS=5000` 冲突 → 5s 必掉线、epoch 跳变，随后 Agent 缓存 epoch 必 `stale_epoch`。
3. 该行为在真实 SPAUI（Pause/Companion 面板）与我的后端探针下**一致**；源码 D1–D3 直接解释 Lead 的 12.9s 间隔与两个错误码。

**不是**：LLM 建议成功验收；不是 B1 漏洞复活；不是适配器/环境顺序问题（FAILURE.md 已把 build ENOENT 与产品会话失败分开）。

## 5. 门禁日志（一行 PASS/FAIL + 命令 + 结果 + 路径）

| 行 | 命令 | 结果 | 日志 |
|---|---|---|---|
| PASS | `git archive ae8b4e2` + 全文件 blob SHA1 | 2032/2032 ALL_TRACKED_FILES_MATCH | `tree.ls`（见命令输出） |
| PASS | `npm run game:mcp:build` | rc=0（companionMcpServer.mjs 产出） | gate-mcp-build.log |
| PASS（复现失败） | `npx vite-node reviewer-probe-session-repro.mts` | `SESSION_REPRO_PASS`：round1 no_observation → 5s LOST/epoch2 → round2 stale_epoch | gate-probe-session-repro.log |
| PASS（授权未回退） | `npx vitest run src/ai-native/ownerAuth.test.ts src/ai-native/worldBridgeServer.test.ts` | 2 文件 / 15 tests PASS | gate-auth-sanity.log |

- 未做全量回归（按 Lead「不重复全量」）；仅必要 probe + 源码审查 + auth sanity。
- 探针日志经复核无 token/ownerKey/ownerCap 值泄漏（仅 status/epoch/code/messageKey）。

## 6. scope / 可发布状态

- **scope**：只定界本次 Pause 授权态 Companion 会话失败；不重开 B1、不做全架构审查、不重跑全量。
- **可发布状态**：**该 functional 会话缺陷不可发布（阻断）**，需先修：① `authorize` 成功后立即推首份 observation（或在 Pause 面板打开时推一份）；② Pause 态下 1s 真实 renderer heartbeat（POST `/world-link/heartbeat`，或经 gateway `heartbeat`），且不与 `LOST_AFTER_MS` 冲突；③ `get` 把 `ownerCap` 从 query URL 移到认证 header 或 POST body；④ `decide` 用真实 core tick（`appliedTick()`）而非 `createdAtTick+1`；⑤ Agent lease 续约不得替代 renderer heartbeat（或 gateway 接受 Agent 心跳刷新 renderer lastSeen，需明确设计）。开发者已派先修这五项。
- **不影响**：B1 授权本身 PASS；原两份 Player 小遭遇不受影响。此不是 LLM 建议成功验收。

报告目录：`reports/ai-native-02/reviewer/p3b-session-repro/`（`REVIEW.md`、`gate-*.log`、`reviewer-probe-session-repro.mts`）。
未修改生产源码/已有测试/配置/分支；未合并/重置；未读取/恢复共享 WIP/stash。
