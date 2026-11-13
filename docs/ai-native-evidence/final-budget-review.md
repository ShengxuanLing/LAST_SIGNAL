# AI-NATIVE-01 最终混合预算小修 — 独立验收

> 角色：Reviewer Worker，只读审查。不改源码/仓库 tests、未 commit/切分支、不扩新功能、未改 Lead 未提交材料。
> 报告：`D:/Project/AI-NATIVE-01-evidence/final-budget-review.md`；本轮 gate：`D:/Project/AI-NATIVE-01-evidence/final-budget-reviewer-*.log`。
> 快照：`feat/ai-native-runtime`，HEAD `903096ddd1402658d1bf662af2cb9c2b41f04015`（developer 停写）。
> MD5 与 Lead 一致：`sessions.ts 409f1f1a100f02193da594a649da0b37`、`coop.ts f10d1dc489cd631db30927daf0b288ab`、`harness.ts 87e64a008e46913652d440d37e49992c`、`mcpServer.ts c35de76ee3a377963e6de660960c108a`、`budget.test.ts 81fc9161ade605f858580f690933b63f`、`budgetClient.mts 5ee666ac66d6a973b766f728e9d4b640`；`rules.ts`/`sharedCore.ts` 同上轮（`96947c32…`/`f8ee3a30…`）。

---

## 结论

**最终代码可接受，无具体阻断项。** 普通 Session 与 coop 世界共用**同一个** `ProcessSessionBudget`（`createProcessSessionBudget(10)` 实例注入 `SessionManager` 与 `CoopManager`），同进程总 10 slots；`tryAcquire/release` 覆盖 creation / close / idle / dispose / 构造失败 / 异常路径，无 double release、无负 `used`、无构造 throw 泄漏；`runScenario`/`runBatch` 走真实 slot 并在结束/异常时释放，满额时不能绕过；默认 Player 仍恰好 6 工具。定向 5 budget / 43 sessions / 21 coop / 32 harness、官方 budgetClient、12 项异常/清理探针、工具面、typecheck / MCP build 全 PASS；复核前后全文件 md5 未变。

---

## 1. 预算模型：同一对象、非全局注入

- `sessions.ts:119-133` `createProcessSessionBudget(max=10)` 返回普通对象（`used` getter + `tryAcquire`/`release`），**不是全局单例**；`release()` 有 `if (used > 0) used -= 1` 下限保护。
- `mcpServer.ts:533-539`：`const budget = createProcessSessionBudget(10)`；`createSessionManager({..., budget})` 与 `new CoopManager(10, budget)` **共用一个 `budget` 引用**；cleanup 同时 `harness.dispose()` + `coopManager.dispose()`。
- `SessionManager.constructor` 未注入 budget 时才 `createProcessSessionBudget(this.maxSessions)`（各 manager 各自默认，不跨进程共享）——`budget.test.ts` 已验证。

## 2. creation / close / idle / dispose / 异常路径（逐项）

- **creation**：`SessionManager.createSessionInternal`（`:505-531`）先 `budget.tryAcquire()`，再 `new Session(...)` + `register()`；`try/catch` 在构造/注册失败时 `budget.release()` 并重抛。`createProductionSession/createTestSession/createCompanionSession` 均走此单一路径。`CoopManager.create`（`coop.ts:884-897`）同样先 `tryAcquire`，`new CoopSession` 失败 catch 释放。探针用 `clock` 在 Session 构造内抛错验证 `used` 回到 0。
- **close**：`Harness.closeSession` → `record.owner.close()` → `Session.close` → `forceClose`（`sessions.ts:1450-1461`）以 `status==='closed'` 守卫防重复，并 `manager.remove(id)`；`remove` 用 `this.sessions.delete(id)` 布尔结果决定是否 `release()`，二次删除不再减。`game_coop_close` → `coop.close(handle)` 同样 `Map.delete` 成功才 `release()`。
- **idle**：`Session.scheduleClose()` → `forceClose()` → `remove()` 释放；探针 `idleTimeoutMs=10` 验证 60ms 后 `used` 由 1 归 0。
- **dispose**：`SessionManager.dispose()` 对每个 session `forceClose()`（→ release）后 `sessions.clear()`；`CoopManager.dispose()` 对 Map 内每个剩余 session `release()` 后 `clear()`，已 close 的不在 Map 中故不双减。`Harness.dispose()` 先逐 record `owner.close()` 再 `manager.dispose()`。探针 5 普通 + 5 coop 满额后双重 dispose，`used===0` 且非负。
- **失败/异常**：`register` 的异常 handler 把 `E_RESOURCE_LIMIT` 转成协议错误；`runScenario` 的 `createTestSession` 用 try/catch 把预算耗尽转 `E_RESOURCE_LIMIT`；`runBatch` 每个 worker 包 try/catch 且单 run 失败记录为失败 run（不抛出、不泄漏）。`runScenario` 在正常结束与 catch 两条路径都 `owner.close()` 释放 slot；探针 `runScenario`/`runBatch` 后 `used===0`。
- **未发现具体泄漏**：`runScenario` 中 `manager.get(test.sessionId)` 返回 undefined 的理论分支在当前单线程 create→get 之间不可达；`ownerHandle()` 对活 session 恒返回对象，`owner.start()` 不抛。无 double release / negative used 反例。

## 3. runScenario / runBatch 无绕过

- `harness.ts:615-625` 明确注释并使用 `this.manager.createTestSession({seed})`（走共享 budget），满额返回 `E_RESOURCE_LIMIT`；`:681` / `:696` 正常与异常均 `owner.close()`。
- `harness.ts:727-760` `runBatch` 并发调用 `runScenario`，每个 run 独立占用/释放真实 slot；不预分配、不绕过 budget。
- 探针（满 10 coop）：`full_coop_blocks_runScenario | ok:false code:E_RESOURCE_LIMIT`；`full_coop_blocks_runBatch | batch.ok:true runs[0].ok:false code:E_RESOURCE_LIMIT`——与官方 budgetClient 一致（batch 返回 run 列表，逐 run 报告拒绝，不是整体绕过）。

## 4. 官方 MCP 探针与工具面

`final-budget-reviewer-budget-client.log`：
```text
created 5 Player + 5 Coop sessions (budget cap 10 reached)
rejected creation does not consume budget; the next valid create succeeds
close releases budget; re-create succeeds
a full process budget blocks create/run_scenario/run_batch with E_RESOURCE_LIMIT
budget client done - all assertions passed
```
工具面（`final-budget-reviewer-tools-probe.log`）：`PLAYER_COUNT=6`、`PLAYER_HAS_COOP=false`，Player 恰 `[close,create,execute_action,get_events,observe,step]`；Dev 含 9 个 `game_coop_*`。

## 5. 独立异常/清理探针（12/12）

`final-budget-reviewer-probe.log`：`release_guard_nonnegative`、`double_remove_no_negative`、`constructor_throw_releases`、`idle_close_releases`、`dispose_double_safe`、`runScenario_cleans_slot`、`runBatch_cleans_slots`、`full_coop_blocks_runScenario`、`full_coop_blocks_runBatch` 等全部 PASS。

## 6. 顺读 `docs/AI_NATIVE_FINAL_REPORT.md`（只读）

- 未发现需要重开既验收范围的事实性重大错误。
- 报告内 `最终287单测` / `最终287/287`（`:32,:35`）与 Lead 本轮自报 292 不一致，但 Lead 已说明“287 计数待 Lead 更新 292，不用判错”，此处仅记录为**待更新计数**，不判为错误、不修改材料。
- P0–P5 阶段哈希、Player6/Dev+9coop、tick501/HP100/E96/29 事件、10 会话/2 并发、64/256 界等与代码/证据一致。

---

## 7. Gate 汇总（命令 | PASS/FAIL | 绝对日志路径）

```text
npm run typecheck | PASS | D:/Project/AI-NATIVE-01-evidence/final-budget-reviewer-typecheck.log
npm run game:mcp:build | PASS | D:/Project/AI-NATIVE-01-evidence/final-budget-reviewer-mcp-build.log
npx vitest run src/ai-native/budget.test.ts --reporter=dot | PASS | D:/Project/AI-NATIVE-01-evidence/final-budget-reviewer-budget-vitest.log
npx vitest run src/ai-native/sessions.test.ts --reporter=dot | PASS | D:/Project/AI-NATIVE-01-evidence/final-budget-reviewer-sessions-vitest.log
npx vitest run src/ai-native/coop.test.ts --reporter=dot | PASS | D:/Project/AI-NATIVE-01-evidence/final-budget-reviewer-coop-vitest.log
npx vitest run src/ai-native/harness.test.ts --reporter=dot | PASS | D:/Project/AI-NATIVE-01-evidence/final-budget-reviewer-harness-vitest.log
npx vite-node src/ai-native/budgetClient.mts | PASS | D:/Project/AI-NATIVE-01-evidence/final-budget-reviewer-budget-client.log
npx vite-node final-budget-probe.mts | PASS | D:/Project/AI-NATIVE-01-evidence/final-budget-reviewer-probe.log
node tools-probe (player=6 / dev coop only) | PASS | D:/Project/AI-NATIVE-01-evidence/final-budget-reviewer-tools-probe.log
md5sum all tracked + untracked before/after diff | PASS | D:/Project/AI-NATIVE-01-evidence/final-budget-reviewer-md5.log
git status / diff --check / HEAD / staged | PASS | D:/Project/AI-NATIVE-01-evidence/final-budget-reviewer-git.log
```

定向 5/43/21/32 全 PASS；官方 budgetClient 与 12 项探针全 PASS；无 slice/浏览器变更、未重跑 23 E2E；复核前后全文件 md5 未变（含 `dist-mcp/` 生成物不提交）；`docs/AI_NATIVE_FINAL_REPORT.md`/receipts/examples 未改。

---

## 8. 可提交结论

**最终混合预算小修代码可接受，稳定 MD5 见报告顶部；无具体阻断。** 普通/coop 共享同一 `ProcessSessionBudget(10)`，tryAcquire/release 全路径闭合，runScenario/runBatch 走真实 slot 且满额拒绝，默认 Player 6 工具不变。此后仅剩最终材料/PR 交付。本 Worker 未改动任何源码、未 commit。
