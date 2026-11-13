# AI-NATIVE-01 P2 — 事务残留最终验收（可接受结论）

> 角色：Reviewer Worker，只读审查。未改源码/测试/配置、未 commit、未切分支、未等待/轮询、未重跑无关全量旧测试/E2E。
> 报告：`D:/Project/AI-NATIVE-01-evidence/p2-review-transaction-final.md`；本轮 gate：`D:/Project/AI-NATIVE-01-evidence/p2-transaction-final-reviewer-*.log`。
> 稳定快照：`feat/ai-native-runtime`，HEAD `8a5b7c250b6a878c77bfee99b65163ba2c907b5d`。md5 与 Lead 冻结值一致：
> `sessions.ts e6ca754a1a9012dd5920d634b1894879`、`sessions.test.ts e6109981e7a6f0445de200ec143cf1a1`、`runtime.ts 58413a99ad9ca3ded9dae901f3c781fa`、`protocol.ts 7dbbdec07acac1cad71c4e7c1f76914a`、`sessionClient.mts 4800344b58d744546aa5af54738aede5`。
> 复核前后全 tracked+untracked 文件 md5 未变；`git diff --check=0`、staged diff=0。

---

## 结论

**P2 代码可接受，无未关闭阻断。** 上一轮唯一残留（StepResult 出参校验在 `game.step` 提交后失败、状态已推进且 request cache 未写）已通过新的 transactional rollback 关闭；本轮独立 probe 确认：

- bad-hasher 非法结果与 hasher 抛异常均不改变 tick/energy/events/epoch；
- 同一 `requestId` 同 payload 重试返回同一 `E_INTERNAL_TRANSACTION`，不同 payload 为 `E_ID_PAYLOAD_MISMATCH`；
- 依赖修复后，新 request 用同一 action 正常执行且 `replayed:false`；
- 旧签发帧不被回滚驱逐，`restore` 仍成功；失败不改变 session epoch；
- 正常 `postStateHash` 与 `snapshot` 的 canonicalState 完全一致；
- 新增 `captureInternalState/restoreInternalState/canonicalStateInternal/eventLog` 未出现在 Player/Owner/Test closure；
- 10/2 预算、B1–B6、owner/test/player 拆分、泄漏检查均保持通过。

唯一非阻断备注：重复 seed 的两个 session 的 `sessionId`、tick/state 独立，但 `actorId` 仍由 seed 派生而相同（`sessions.ts:441`）；当前未造成跨 session 污染。若要求 actorId 全局唯一，应另立决策，不影响本轮 P2 事务验收。

P2 的 MCP/LLM/ECHO 未实现不单独判失败。

---

## 1. 事务回滚独立复测

### 1.1 bad-hasher：不推进状态、失败可重试

`P2_result_validation_after_commit`（manager 注入 `hasher: () => 'bad-hash'`）：

```text
before       = {tick:0, energy:100, events:1, epoch:0}
first        = E_INTERNAL_TRANSACTION
afterFirst   = {tick:0, energy:100, events:1, epoch:0}
retry        = E_INTERNAL_TRANSACTION（相同 requestId+payload）
afterRetry   = {tick:0, energy:100, events:1, epoch:0}
conflict     = E_ID_PAYLOAD_MISMATCH（相同 requestId 不同 ticks）
afterConflict= {tick:0, energy:100, events:1, epoch:0}
fixed new request = ok，tickAfterFixed=1
```

结论：失败步骤不推进 tick/energy/events/epoch；同一 requestId 重试返回同一失败；同 requestId 不同 payload 冲突；依赖修复后新 request 不沿用失败 step 的 action 缓存，正常执行。

### 1.2 hasher 抛异常：不外泄、不提交

`P2_throwing_hasher`：

```text
threw=false
firstOk=false, firstCode=E_INTERNAL_TRANSACTION
beforeTick=0, afterTick=0
retryOk=false, retryCode=E_INTERNAL_TRANSACTION
```

`executeStep` 的 `catch` + `safeRollback`（`sessions.ts:579-596`）阻止异常外泄，并保持状态未提交。

### 1.3 旧签发帧不被回滚驱逐

`P2_failed_step_keeps_issued_snapshot`：

```text
snapshotOk=true
failedOk=false, failedCode=E_INTERNAL_TRANSACTION
epochUnchangedByFailure=true
restoreOk=true
```

回滚 capture 使用 `runtime.ts:354-390` 的非签发 `captureInternalState/restoreInternalState`，不触碰 `issuedSnapshots`、不改变 epoch；旧帧仍可 restore。

### 1.4 postStateHash 与 snapshot 一致

`P2_post_hash_matches_snapshot`：

```text
stepOk=true
postStateHash = sha256:44b5ebf8e7967cab68c96fe831f889cbe7cea8475d090bf64c9813a08234da8e
expected      = sha256:44b5ebf8e7967cab68c96fe831f889cbe7cea8475d090bf64c9813a08234da8e
matches=true
```

`canonicalStateInternal()`（`runtime.ts:390-407`）与 `canonicalState(snapshot())` 投影一致，未因每步 snapshot 签发产生漂移。

### 1.5 回滚覆盖状态/事件/cache/log 游标

代码：`sessions.ts:579-596` 先 `captureRollback()`，`commitStep` 失败/异常后 `applyRollback()`；`captureRollback()` `:747-764` 覆盖 game internal state、status/runEndReason、events/eventSeq/lastGameEventSeq/droppedEvents、idempotency。`requestCache` 在 `step` 层 `:569-575` 对失败结果也 `cacheRequest`，所以同一 requestId 重试得到同一失败。`syncEvents` 改用 `game.eventLog()`（`:1095-1097`），不再签发快照帧。

---

## 2. 其余 P2 回归（独立 probe）

```text
P2_nonarray_actions / P2_null_actions / P2_step_extra_role_dev_audience /
P2_bad_ticks_nan / P2_step_ticks_undefined / P2_action_extra_role
  -> 全部 E_SCHEMA，无异常、无 tick 推进

P2_fromTick_mismatch -> E_FUTURE_TICK
P2_request_sessionId_mismatch -> E_SESSION_NOT_FOUND
P2_action_sessionId_mismatch -> actionResult E_SESSION_NOT_FOUND（未执行）
P2_action_epoch_mismatch -> actionResult E_STALE_EPOCH（未执行）
P2_action_targetTick_not_exact -> E_FUTURE_TICK

P2_duplicate_same_batch -> [OK, replayed:true]，energy 90（只扣一次）
P2_same_request_retry_and_conflict -> retry no tick advance；conflict E_ID_PAYLOAD_MISMATCH
P2_action_semantics_change -> second actionResult E_ID_PAYLOAD_MISMATCH

P2_budget_10_2 -> maxSessions10=true/maxSessions11=false；maxConcurrent2=true/maxConcurrent3=false
P2_owner_boundary -> Player lifecycle=[]；Owner pause/resume/reset ok
P2_test_to_production -> production 无 snapshot；manager.get(production).testHandle().snapshot()=E_PERMISSION
P2_internal_seams_not_exposed -> Player/Owner/Test closure 均无 captureInternalState/restoreInternalState/canonicalStateInternal/eventLog
P2_step_result_leak_text -> 无 seed/rngState/内部 corridor
```

`P2_same_seed_sessions`：

```text
sessionIdsDistinct=true
actorIdsDistinct=false
tickSeparate=true
```

两个同 seed session 的 sessionId、tick/state 独立；actorId 由 seed 派生相同（`sessions.ts:441`），当前无跨 session 污染，属非阻断设计备注。

---

## 3. Gate 汇总（命令 | PASS/FAIL | 日志绝对路径）

本轮实际执行：

```text
npm run typecheck | PASS | D:/Project/AI-NATIVE-01-evidence/p2-transaction-final-reviewer-typecheck.log
npx vitest run src/ai-native/sessions.test.ts --reporter=dot | PASS | D:/Project/AI-NATIVE-01-evidence/p2-transaction-final-reviewer-targeted-vitest.log
npx vite-node D:/Project/AI-NATIVE-01-evidence/p2-reviewer-probe.mts | PASS | D:/Project/AI-NATIVE-01-evidence/p2-transaction-final-reviewer-probe.log
md5sum all tracked + untracked before/after diff | PASS | D:/Project/AI-NATIVE-01-evidence/p2-transaction-final-reviewer-md5.log
git status / diff --check / HEAD / staged gate | PASS | D:/Project/AI-NATIVE-01-evidence/p2-transaction-final-reviewer-git.log
```

定向 `sessions.test.ts` 43/43 PASS；typecheck PASS；复核前后全文件 md5 一致；`git diff --check=0`、staged diff=0。Developer 的 `p2-residual-developer-*` 日志记录 43 定向 / 229 全量 / typecheck / build / 真实 client PASS，本轮仅引用、不重跑无关全量/E2E。

---

## 4. 可提交结论

**P2 代码可接受，无未关闭阻断。** 事务 rollback 已覆盖非法 result 与 hasher 异常，失败不推进 tick/energy/events/epoch，旧签发帧不被驱逐，失败 request 缓存且同 requestId 重试一致；新 request 的同一 action 正常执行。B1–B6、10/2 预算、owner/test/player 能力拆分、泄漏检查均通过。唯一非阻断备注是重复 seed 的 actorId 相同；若要求全局唯一需后续决策。本 Worker 未执行 commit。
