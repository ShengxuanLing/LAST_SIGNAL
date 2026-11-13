# AI-NATIVE-01 P0 — 最终阻断关闭验证（可提交结论）

> 角色：Reviewer Worker，只读复核。未写 `src/`、未改测试/文档、未切分支、未 `git add`、未 commit；未等待/轮询；未重跑无关浏览器全套。
> 报告：`D:/Project/AI-NATIVE-01-evidence/p0-protocol-review-final.md`；`p0-protocol-review-final-*.log` 为本轮 gate 完整输出；`p0-fix-*.log` 为 Lead/Developer 提供的修复 gate 日志，本轮引用、不重跑。

## 结论

**P0 代码可接受，无未关闭阻断。**

冻结快照与 Lead 一致：

- `src/ai-native/protocol.ts` md5 `b99eb7011b148c055e14e70fb87e3d0e`（2336 行 / 101318 bytes）
- `src/ai-native/protocol.test.ts` md5 `79359f01439ccecf063720a23ee40f66`（1079 行 / 52023 bytes）
- 分支 `feat/ai-native-runtime`，HEAD `c656f788227f44efec993315bfb65a323e398377`。
- 复核前后两份文件 md5 未变；全 tracked 文件 md5 未变；`git diff --exit-code` / `git diff --cached --exit-code` 均 0。

P0 预审报告 `p0-protocol-review.md` 中的 **P0-1 / P0-2 两项阻断均已关闭**；3 条拒绝测试与 Dev/test 独立帧正向测试已补齐；定向 72 协议测试 PASS；36 项最小反例/回归探针全部 PASS；未发现新增 schema/纯授权漏洞或范围外运行时修改。

> 注：文档状态表中旧 md5 / 68 / 131 为前轮快照，Leader 提交前自行更新为最新值（`b99eb…` / `7935…` / 72 / 135）；本轮不据此要求源码再改。

---

## 1. P0-1 关闭验证：private Snapshot/Replay 不再进入 public response

代码证据：

- `src/ai-native/protocol.ts:712-719`：`ResponseV1` 注释明确 `SnapshotV1 / ReplayV1` 是服务端私有帧，不得嵌入 public `AiNativeEnvelopeV1` response；联合体现为
  `StepResultV1 | ObservationV1 | DebugInspectionV1 | ActionResultV1 | ErrorV1`，已无 `SnapshotV1 | ReplayV1`。
- `src/ai-native/protocol.ts:1632-1634`：`RESPONSE_UNION.variants` 仅 `[STEP_RESULT, OBSERVATION, DEBUG_INSPECTION, ACTION_RESULT, ERROR]`，已无 `SNAPSHOT, REPLAY`。
- `src/ai-native/protocol.ts:1768-1783`：`envelopeExtras()` 的 `kind:'response'` 检查列表已移除 `validateSnapshotDetailed` / `validateReplayDetailed`。

测试证据：

- `src/ai-native/protocol.test.ts:1005-1016`：两条新负向测试
  - `REJECTS a response envelope carrying a private SnapshotV1`
  - `REJECTS a response envelope carrying a private ReplayV1`
  - 同时断言独立 `validateSnapshot(snapshot())` / `validateReplay(replay())` 仍为 `true`。
- `src/ai-native/protocol.test.ts:1026-1031`：`Dev/test independent private frames remain valid outside public envelopes`，断言 `authorizeRawFrame({role:'DEVELOPER',sessionKind:'test'},'snapshot').ok === true` 且 Player production 被 `E_PERMISSION` 拒绝。

最小反例复跑（`p0-protocol-review-final-final-audit.log` A1–A4、P4/P5、Z1–Z4）：

```text
validateEnvelope(response+snapshot)            = false   (原 true -> 已关闭)
validateEnvelope(response+replay)              = false   (原 true -> 已关闭)
validateEnvelopeDetailed(response+snapshot)    = E_SCHEMA
validateEnvelopeDetailed(response+replay)      = E_SCHEMA
validateSnapshot(snapshot())                  = true    (独立私有帧仍合法)
validateReplay(replay())                      = true    (独立私有帧仍合法)
authorizeRawFrame(PLAYER, production)          = E_PERMISSION
authorizeRawFrame(PLAYER, test, devRemoved)    = E_PERMISSION
authorizeRawFrame(DEVELOPER, production)       = E_PERMISSION
authorizeRawFrame(DEVELOPER, test)             = ok
```

结论：public envelope 出口已收口；内部生产快照结构合法本身不等于泄漏，`authorizeRawFrame` 纯 audience gate 保持正确，真实 Gateway 仍在 P1+ 强制授权。

---

## 2. P0-2 关闭验证：`notification` 删除且显式 event 分支

代码证据：

- `src/ai-native/protocol.ts:631`：`EnvelopeKindV1 = 'request' | 'response' | 'event'`，无 `'notification'`。
- `src/ai-native/protocol.ts:1636-1643`：`ENVELOPE.kind = ENUM(['request','response','event'])`，无 `'notification'`。
- `src/ai-native/protocol.ts:1768-1789`：`envelopeExtras()` 改为显式分支：`request` / `response` / `event`，其余 `return issue('E_SCHEMA','$.kind')`，不再靠 fall-through 按 event 放行。
- `p0-protocol-review-final-static-audit.log`：残留标记扫描 `notification` / `SnapshotV1 | ReplayV1` / `SNAPSHOT, REPLAY` / `validateSnapshotDetailed(payload)` / `validateReplayDetailed(payload)` 均为 0 命中；显式 `if (kind === 'event')` 与 `E_SCHEMA $.kind` 均命中。

测试证据：

- `src/ai-native/protocol.test.ts:1018-1023`：`REJECTS a notification envelope even with a valid EventV1 payload`，断言 `validateEnvelope(...) === false` 且 `validateEnvelopeDetailed(...) = E_SCHEMA`。

最小反例复跑（`p0-protocol-review-final-final-audit.log` E1–E3、P1–P3）：

```text
validateEnvelope(notification+event)  = false   (原 true -> 已关闭)
validateEnvelope(bogus+event)         = false
validateEnvelopeDetailed(notification+event) = E_SCHEMA
validateEnvelope(request+actionRequest) = true
validateEnvelope(response+stepResult)   = true
validateEnvelope(event+event)           = true
```

结论：会话内 envelope 判别式已与 `docs/AI_NATIVE_PROTOCOL.md:210,246` 一致，且合法 request/response/event 路径未回归。

---

## 3. 无新增漏洞 / 无范围外修改

- `p0-protocol-review-final-static-audit.log`：无 `Date.now` / `performance.now` / `Math.random` / timers / `phaser` / DOM / `localStorage` / `node:crypto` / `Buffer` 实际使用，无模块级 `let`；无新增运行时、Session Manager、缓存、日志、真实 tick/restore/replay 执行器。
- `p0-protocol-review-final-final-audit.log`：36 项动态探针全部 PASS，覆盖：
  - 严格未知字段 / 隐藏字段：`role` 注入 `E_SCHEMA`、`seed` 隐藏字段 `E_SCHEMA`、`hasHiddenField` 命中/白名单；
  - 证据：`ObservationEvidenceV1.protocolVersion=1` 通过、v2 拒绝、`validateRestoredEvidence` 合法通过/过期与错 epoch 拒绝；
  - 权限：production `seed` / `DEVELOPER` 创建被 `E_PERMISSION` 拒绝；`kind:'test'+DEVELOPER` 的 CreateSessionRequest 仅**结构校验通过**（F3），按冻结口径属于“结构校验不代授权设计”，devTicket / AuthContext / Gateway 内部命令为 P1–P3，真实 Gateway 必须强制授权，不构成 P0 新漏洞；
  - 冻结口径内行为：`isCompatibleVersion(1)` 接受裸 `1`、`DEVELOPER+debug` 返回 `E_SCHEMA`、`compareActionOrder` 第三参、7 键 `AI_NATIVE_SCHEMA_V1`、无 legacy `ACTORS` / role map 导出；
  - `response+DebugInspectionV1` 仍按文档 `ResponseV1` 类型通过（P6），但这是类型/结构校验，不是授权；P1 Gateway 必须只对显式 `inspect_state` 返回，不下发 Player/Companion。
- `p0-protocol-review-final-md5.log`：两份稳定文件与全 tracked 文件复核前后 md5 完全一致。
- `p0-protocol-review-final-git.log`：`git status` 仅显示其他 Worker 的 P0 未跟踪交付物；tracked diff / staged diff 均为 0。
- `p0-fix-gate-summary.log`（引用）：Developer 修复 gate 记录 `72/72` 定向、`135/135` 全单测、typecheck、build、LSP、smoke、probe `12/12`、md5、git gate 全部 PASS，且 md5 与当前一致。

---

## 4. Gate 汇总（命令 | PASS/FAIL | 日志绝对路径）

本轮实际复跑：

```text
npm run typecheck | PASS | D:/Project/AI-NATIVE-01-evidence/p0-protocol-review-final-typecheck.log
npx vitest run src/ai-native/protocol.test.ts --reporter=verbose | PASS | D:/Project/AI-NATIVE-01-evidence/p0-protocol-review-final-protocol-vitest.log
./node_modules/.bin/esbuild src/ai-native/protocol.ts --bundle --platform=node --format=esm --outfile=<temp>/protocol-final-audit.mjs | PASS | D:/Project/AI-NATIVE-01-evidence/p0-protocol-review-final-esbuild.log
node <temp>/p0_protocol_final_audit.mjs <temp>/protocol-final-audit.mjs | PASS | D:/Project/AI-NATIVE-01-evidence/p0-protocol-review-final-final-audit.log
static fix audit + purity scan | PASS | D:/Project/AI-NATIVE-01-evidence/p0-protocol-review-final-static-audit.log
md5sum two stable files + all tracked files before/after diff | PASS | D:/Project/AI-NATIVE-01-evidence/p0-protocol-review-final-md5.log
git status / diff / HEAD / untracked gate | PASS | D:/Project/AI-NATIVE-01-evidence/p0-protocol-review-final-git.log
```

引用 Lead/Developer 修复日志（本轮未重跑，避免无关全套旧构建/浏览器套件）：

```text
npm test -- --reporter=dot (135/135 full unit regression) | PASS | D:/Project/AI-NATIVE-01-evidence/p0-fix-full-vitest.log
npm run build | PASS | D:/Project/AI-NATIVE-01-evidence/p0-fix-build.log
npx vite-node p0-fix-probe.mts (12/12 reviewer counterexamples) | PASS | D:/Project/AI-NATIVE-01-evidence/p0-fix-probe.log
npm run typecheck (p0-fix) | PASS | D:/Project/AI-NATIVE-01-evidence/p0-fix-typecheck.log
```

定向 72 测试本轮结果：`Test Files 1 passed (1)` / `Tests 72 passed (72)`。最终审计：`FINAL_AUDIT_CHECKS=36 FAILED=0`。所有 gate 均 PASS，无失败关键行。

---

## 5. 可提交结论

**P0 代码可接受，无未关闭阻断。** `protocol.ts` / `protocol.test.ts` 当前 md5 分别为 `b99eb7011b148c055e14e70fb87e3d0e` / `79359f01439ccecf063720a23ee40f66`；P0-1、P0-2 已按最小修复关闭，未引入新增漏洞或范围外运行时能力。Leader 可在提交前自行更新文档状态表中的旧 md5 / 68 / 131 为最新值，并整合阶段提交；本 Worker 未执行 commit。
