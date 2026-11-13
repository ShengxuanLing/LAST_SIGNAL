# AI-NATIVE-01 P4 — 反馈修复 / 交付最终独立验收

> 角色：Reviewer Worker，只读审查。不改源码/仓库 tests、未 commit/切分支、未重跑无关全套、未改原 trace。
> 报告：`D:/Project/AI-NATIVE-01-evidence/p4-review-final.md`；本轮 gate 日志：`D:/Project/AI-NATIVE-01-evidence/p4-final-reviewer-*.log`。
> 稳定快照：`feat/ai-native-runtime`，HEAD `ddcd7e9580346a2411e3b10c369dd3bfc1ef4edd`（修复版停写，未 commit，工作树含修复）。
> MD5 与 Lead 决策一致：`runtime.ts ca54151017a6ffac3fdb28310af794c1`、`sessions.ts b55541f76ab9f9a24f186a8adf06bf5f`、`mcpServer.ts 0f7e5876a132a69e64d455a19fa608e7`、`p4.test.ts 6a92c0e5a7635d50d9c66d646fd95abf`、`rules.ts 5f527b780358b0ec64eef3b2fd69278a`、`fullState.ts be780b90bb6caa90616fd168796bef3d`。
> 原始不可变记录 `p4-codex-live.jsonl` SHA256 `0ba5cdb4f305527bd9de12e01a987c1dc5d7a2d3bed4c86eb940d418a09aea52` 未变；示例归档 `examples/ai-native/p4-player-trace.json` 的 `provenance.sourceSha256` 与之相同。

---

## 结论

**P4 可接受（反馈修复已闭合，无阻断项）。** 本轮只做差异复核，覆盖 Lead 点名的每一项：scan 真实 R1/R2 来源、sourceActionId/observerActorId/epoch 在采样时绑定而非观察时伪造、restore 不重采样/证据原样、Player 不能通过新 context 参数伪造身份、嵌套 MCP sessionId 归一化覆盖 observe/step/execute 结果 events、knownConnections 仅已揭示合法边、中立客户端无策略、trace/GZ/SHA 对原文一致、replay 仅动态替 session/epoch/ID 比较公开轨迹且不执行决策文字/不调用 Dev。typecheck / MCP build / `p4.test.ts` 5/5 / 官方动态 replay 全部 PASS；复核前后全文件 md5 未变，未 commit。

---

## 1. 差异复核（只读源码）

### 1.1 scan 真实 R1/R2 来源 + sourceActionId/observerActorId/epoch 采样时绑定
- `src/ai-native/runtime.ts:538-548`：扫描证据从 `this.model.evidenceSnapshot`（扫描时落库的条目）派生；若条目已带 `sourceActionId`/`observerActorId` 则原样使用，否则由 `targetId + observedAtTick` / `actorId` 确定性派生——**绑定在扫描采样时刻，不是观察时伪造**。
- `runtime.ts:826-829`：扫描动作把真实 `actionId`（正则 `aid_[0-9a-f]{24}`）与 `identity.actorId` 写入证据条目，故 `sourceActionId`/`observerActorId` 来自真实扫描动作。
- `runtime.ts:543-548` 同时写入 `sceneEpoch = item.sceneEpoch ?? sceneEpoch`，`observerPosition = {x,y}` 取自该条证据的采样位置（R1 实验室 / R2 走廊分别落到 `station-zero-r1` / `station-zero-r2`，见 `evidence[].roomId` 与 `obs.roomId`）。
- `p4.test.ts`（5 case）：R2 扫描记录走廊观察者位置/房间、真实 scanId/actorId/epoch；R1 扫描证据归因自身动作；`SliceModel.scan({sourceActionId, observerActorId, sceneEpoch})` 落库并在 `restoreFull` 后逐字节相等（`restored.evidenceSnapshot` toEqual 原值）——证明采样绑定且可恢复。

### 1.2 restore 不重采样 / 证据原样
- `src/slice/rules.ts:760`（注释）“Restore full private state verbatim; no scan, no bridge/relay re-resolve.”；`rules.ts:783` 恢复 `lastRelayInteractTick` 等全部私有态；`fullState.ts` 的 `captureFull/restoreFull` 深拷贝证据数组。
- `p4.test.ts` “restore keeps the recorded provenance” 断言 `after.value.evidence` toEqual `before.value.evidence`——无重采样、无身份捏造。

### 1.3 Player 不能通过新 context 参数伪造身份
- `src/ai-native/mcpServer.ts:159` 仅 `harness.createSession(dev ? seed : undefined)`；Player 创建不含任何 `actorId`/`context`/`identity` 入参。
- `src/ai-native/sessions.ts:581-583`：`actorId = act_${deriveActorHex(seed)}`，由会话派生，外部不可注入。无新 context 形参可伪造。

### 1.4 嵌套 MCP sessionId 归一化覆盖所有路径
- `src/ai-native/mcpServer.ts:57` `sanitizeEvent` 把 `event.sessionId` 归一到真实 `session`；`:62-64` `sanitizeObservation` 归一顶层 `sessionId` 并 `obs.events.map(sanitizeEvent)`；`:70-76` `sanitizeStepResult` 对 `result.events` 与（若存在）`result.observation` 一并归一；`:204,253` 的 step/execute_action 均走 `sanitizeStepResult`；`:172-173` observe 走 `sanitizeObservation`。**observe / step / execute_action 三条结果路径的 events（含观察内嵌 events）都被归一**。
- 新 runtime `runtime.ts:646` 返回的观察 `events: []`（观察不再内嵌事件），从源头消除此前“观察内事件 sessionId 错位”的缺陷；step 结果顶层 events 经 `sanitizeEvent` 保证一致。replay 亦断言 `foreign session id` 不泄露（见 §2）。

### 1.5 knownConnections 仅已揭示合法边
- `runtime.ts:562-589`：仅由已揭示证据派生；白名单 `relationTargets` 仅 `rel_corridor_relay_bridge` / `rel_corridor_relay_perception`（from `tgt_corridor_relay`），外加实验室 `rel_lab_seal_link`；未知 `relationId` 直接跳过，不做推测。`p4.test.ts` 断言走廊扫描后出现这两条 relation，且 R1 阶段不出现走廊边。

### 1.6 旧 browser save 可选扩展校验闭合不泄漏
- `src/ai-native/protocol.ts:2267` R9 restore 校验：不重扫、不延长 TTL、旧存无 evidence 直接清空；`protocol.test.ts` “old saves with no evidence simply clear (empty array), without inventing any” 覆盖。只读确认该契约未改、无隐藏字段透出。

---

## 2. 中立性与 replay（官方动态探针）

- `src/ai-native/agentClient.mts`：仅 `listTools()`/`callTool()` + JSONL 记录，**无 route/policy/scenario/游戏 import**，与先前 bridge 同构（中性）。
- `src/ai-native/replayPlayerTrace.mts`：读 `examples/ai-native/p4-player-trace.json`，经**全新 Player MCP server（绝不 --dev）** 重放；`normalize()` 动态替换 `session/epoch/requestId/actionId`，**不执行任何决策文字**（trace 仅含录制请求，`decisionNote` 为 provenance 不执行）；断言无 Dev 工具、无 foreign session id 泄露、server 退出。仅比较**公开轨迹**（finalTick/completed/hp/energy/roomId/有序事件流）。
- replay 结果（`p4-final-reviewer-replay.log`）：`replay match { tick:501, completed:true, hp:100, energy:96, room:"station-zero-r2", events:29, sessionRefsConsistent:true, serverExited:true }`；18 请求重放、1 次预期 `E_SCHEMA` 一致失败。**回放只证明原始公开轨迹可复现，不等于第二次真实 AI。**

---

## 3. 文档非盲测 / Token / 计数边界（如实声明）

- `examples/ai-native/p4-player-trace.json` `provenance`：`agent:"current Codex lead"`、`strategy:"interactive decisions by model; transport has no policy"`、`modelTokenUsage: null`、`toolCallCount: 22`、`note` 明示决策文字仅 provenance、replayer 不执行。
- 原始 `p4-codex-live.jsonl`：`start` 记 `agent:"current Codex lead"`，**非盲测**（Lead 已审项目、带既有知识），不得包装为独立外部模型 API 盲测；token/内部推理不可得，禁止杜撰；23 请求 / 22 结果 / 1 quit，工具往返 93.0398ms ≠ 推理延迟，墙钟 ~258s 为交互间隔。

---

## 4. Gate 汇总（命令 | PASS/FAIL | 日志绝对路径）

```text
npm run typecheck | PASS | D:/Project/AI-NATIVE-01-evidence/p4-final-reviewer-typecheck.log
npm run game:mcp:build | PASS | D:/Project/AI-NATIVE-01-evidence/p4-final-reviewer-mcp-build.log
npx vitest run src/ai-native/p4.test.ts --reporter=dot | PASS | D:/Project/AI-NATIVE-01-evidence/p4-final-reviewer-p4-vitest.log
npx vite-node src/ai-native/replayPlayerTrace.mts | PASS | D:/Project/AI-NATIVE-01-evidence/p4-final-reviewer-replay.log
md5sum all tracked + untracked before/after diff | PASS | D:/Project/AI-NATIVE-01-evidence/p4-final-reviewer-md5.log
git status / diff --check / HEAD / staged | PASS | D:/Project/AI-NATIVE-01-evidence/p4-final-reviewer-git.log
```

定向 `p4.test.ts` 5/5、官方动态 replay 全 PASS；typecheck / MCP build 通过；复核前后全文件 md5 未变（含 `dist-mcp/` 生成物不提交）；原始 SHA256 与示例归档 provenance 一致。Developer 自报 266 全量 / 16 target / 13 E2E / typecheck / build / MCPbuild / replay（日志 `p4-developer-*`）仅引用，未重跑。

---

## 5. 可提交结论

**P4 可接受。** 反馈修复已闭合：观察溯源（R1/R2 真实来源、sourceActionId/observerActorId/epoch 采样时绑定）、restore 不重采样、Player 身份不可伪造、嵌套 sessionId 全路径归一、knownConnections 仅合法边、旧 save 校验闭合；中立客户端与 replay 均不执行决策文字、不使用 Dev、不泄露 foreign session。原始 `p4-codex-live.jsonl` 仍为当前 Codex 经标准 Player MCP 真实游玩至完成的不可变证据（非盲测、token 不可得边界已声明）。本 Worker 未改动任何源码、未 commit。
