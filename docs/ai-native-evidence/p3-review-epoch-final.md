# AI-NATIVE-01 P3 — epoch 残留定向最终验收

> 角色：Reviewer Worker，只读审查。未改源码/测试/配置、未 commit、未切分支、未等待/轮询、未重跑无关浏览器全套。
> 报告：`D:/Project/AI-NATIVE-01-evidence/p3-review-epoch-final.md`；本轮 gate：`D:/Project/AI-NATIVE-01-evidence/p3-epoch-final-reviewer-*.log`。
> 稳定快照：`feat/ai-native-runtime`，HEAD `5d4fe9128f21555997b2c301fe25a20a056f6490`。
> MD5 与 Lead 决策一致：`harness.ts 1db664997f3548df53968138801d93db`、`mcpServer.ts 83f600c92399b7b052acdf91418861b2`、`mcpClient.mts 475b77c7a42f4a1bc8e6572a3bfc3364`、`harness.test.ts 56e0e6d6b0ab496e11287b3987116979`、`sessions.ts b87fe02fa24e4f7d76c7102b7af3a16a`。
> 复核前后全 tracked+untracked 文件 md5 未变；`git diff --check=0`、staged diff=0。`dist-mcp/` 为未跟踪生成产物，未提交。

---

## 结论

**P3 现在可接受（epoch 残留已闭合）。** 新契约 `game_step` / `game_execute_action`（含 advanced）一律必填 `epoch`，校验先于缓存/补默认；fixture 与 restore 递增 epoch（`restore` 取 `max(previous+1, engineEpoch)`）；`create`/`observe` 返回 `epoch`。独立官方 Client 52/52 复验全部通过，原“不传 epoch 的旧请求”反例已消除：缺 epoch 现在直接 `E_SCHEMA`（协议级拒绝），显式旧 epoch `E_STALE_EPOCH`，新 epoch 正常执行。32 harness / 43 P2 sessions / typecheck / MCP build 均 PASS；下层原子事务与签发内容绑定未破坏。

---

## 1. 新契约关键代码点（只读）

- `src/ai-native/harness.ts:366-378` `stepWithCache()`：`epoch` 必填且 `isFiniteInt(0..2^32-1)`；非整数/缺省返回 `E_SCHEMA`；`params.epoch !== currentEpoch` 返回 `E_STALE_EPOCH`；**这两步在缓存命中/补默认之前**。
- `src/ai-native/harness.ts:388-390` `executeStepCore()`：`epoch` 直接来自入参（不再用 currentEpoch 兜底），缺省不会落到新 epoch。
- `src/ai-native/harness.ts:468-473` `executeAdvanced()`：advanced 同样 `epoch` 必填且先校验，旧 epoch `E_STALE_EPOCH`。
- `src/ai-native/mcpServer.ts:184,218,223`：`game_step`/`game_execute_action`（P0 与 advanced 分支）`epoch` 均为 `z.number().int().min(0).max(4294967295)`，协议层强制必填。
- `src/ai-native/sessions.ts:1165` `this.epoch = Math.max(this.epoch + 1, result.value.epoch)`：`restore` 单调递增，绝不回退到旧 epoch。
- `src/ai-native/sessions.ts:1226` `applyDevFixture` 后 `this.epoch += 1`：fixture 也递增 epoch。
- `src/ai-native/sessions.ts:671-672` + `:766-767`：Session 层 `epoch !== active` 仍 `E_STALE_EPOCH`（双层校验）。
- 下层原子事务：`sessions.ts:714-846` 的 `captureInternalState/restoreInternalState` 回滚路径未改动；`harness.ts:459-457` 请求缓存 256 有界、`clearSessionRequests` 在 close/fixture/restore 清理。

---

## 2. 独立官方 Client 复验（52/52，`p3-epoch-final-reviewer-probe.log`）

`node D:/Project/AI-NATIVE-01-evidence/p3-epoch-final-reviewer-probe.mjs` → `P3_EPOCH_PROBE_CHECKS=52 FAILED=0`。

### 2.1 工具面与权限（Player 6 / Dev 16）
PLAYER 仅 6 工具、无 Dev 工具；`game_create_session` 拒绝 `seed/role/kind/devTicket`；`game_snapshot`/`game_observe debug` 在 Player 模式拒绝；create/observe 返回 `epoch`。Dev 16 工具齐全。

### 2.2 step / execute_action / advanced 缺 epoch、NaN、旧 epoch 均拒绝且无状态变化
```text
PLAYER_step_missing_epoch_rejected          ok=true   (E_SCHEMA / 协议级)
PLAYER_step_nan_epoch_rejected              ok=true
PLAYER_execute_action_missing_epoch_rejected ok=true
DEV_step_missing_epoch_E_SCHEMA             ok=true   code=E_SCHEMA
DEV_step_nan_epoch_E_SCHEMA                 ok=true   code=E_SCHEMA
DEV_step_old_epoch_E_STALE_EPOCH            ok=true   code=E_STALE_EPOCH
DEV_step_old_epoch_no_state_change          ok=true   tick/energy 不变
DEV_step_delayed_missing_epoch_E_SCHEMA     ok=true   (fixture 后缺 epoch 仍 E_SCHEMA)
DEV_execute_action_missing_epoch_E_SCHEMA   ok=true
DEV_execute_action_old_epoch_E_STALE_EPOCH  ok=true
DEV_advanced_missing_epoch_E_SCHEMA         ok=true
DEV_advanced_nan_epoch_E_SCHEMA             ok=true
DEV_advanced_old_epoch_E_STALE_EPOCH        ok=true
DEV_advanced_rejected_no_state_change       ok=true   tick 不变
```

### 2.3 fixture / restore 之前旧原请求延迟重发（缺 / 显式旧 epoch）均拒绝，新 epoch 正常
```text
DEV_fixture_epoch_bumped                    ok=true   epoch 0->1
DEV_step_old_epoch_E_STALE_EPOCH            ok=true   (fixture 后旧 epoch=0 拒绝)
DEV_step_delayed_missing_epoch_E_SCHEMA      ok=true   (fixture 后缺 epoch 拒绝，不再误执行)
DEV_step_new_epoch_executes                 ok=true   (新 epoch=1 正常推进 tick=2)
DEV_restore_epoch_monotonic                 ok=true   restore tick=2, epoch=max(1+1,0)=2
DEV_step_old_epoch_after_restore_E_STALE_EPOCH   ok=true
DEV_step_missing_epoch_after_restore_E_SCHEMA   ok=true
DEV_step_new_epoch_after_restore_ok         ok=true   (新 epoch=2 正常)
```
> 先前 P3 残留（缺 epoch 旧请求在 fixture/restore 后按新 epoch 误执行）已闭合：缺 epoch 现在在协议层被 `E_SCHEMA` 拒，显式旧 epoch 被 `E_STALE_EPOCH` 拒。

### 2.4 同 request 缺省 fromTick/actionId 原样重试一致、冲突/失败/domain/session 不退步
```text
PLAYER_same_request_no_tick_advance         ok=true   tick 1->1
DEV_step_same_request_no_advance            ok=true
DEV_domain_isolation_same_requestId         ok=true   execute_action tick=1, step tick=2（同 requestId 跨工具不串）
DEV_conflict_E_ID_PAYLOAD_MISMATCH          ok=true   code=E_ID_PAYLOAD_MISMATCH
DEV_failure_cache_consistent                ok=true   失败请求重放一致
DEV_session_isolation_same_requestId        ok=true   A/B 各自 tick=1（session 隔离）
```

---

## 3. 下层 P2 事务 / 签发内容绑定未破坏

- `npx vitest run src/ai-native/sessions.test.ts` **43/43 PASS**（`p3-epoch-final-reviewer-p2-sessions-vitest.log`）：覆盖 step 原子事务、签名/requestId 绑定、同 id 重试、epoch 不匹配、snapshot/restore 回滚等。
- `npx vitest run src/ai-native/harness.test.ts` **32/32 PASS**（`p3-epoch-final-reviewer-harness-vitest.log`）：覆盖 harness 请求缓存、namespace、epoch、fixture/restore 清缓存、domain 隔离、session 隔离。
- sessions.ts 中 `restore`/`applyDevFixture` 仅递增 `epoch`，未触碰 `idempotency` 签发表或 `captureInternalState/restoreInternalState` 回滚内容；`applyRollback`（`sessions.ts:896-912`）仍原样恢复 game + session 派生状态、清空并重放 idempotency，签发/事务绑定保持。

---

## 4. Gate 汇总（命令 | PASS/FAIL | 日志绝对路径）

```text
npm run typecheck | PASS | D:/Project/AI-NATIVE-01-evidence/p3-epoch-final-reviewer-typecheck.log
npx vitest run src/ai-native/harness.test.ts --reporter=dot | PASS | D:/Project/AI-NATIVE-01-evidence/p3-epoch-final-reviewer-harness-vitest.log
npx vitest run src/ai-native/sessions.test.ts --reporter=dot | PASS | D:/Project/AI-NATIVE-01-evidence/p3-epoch-final-reviewer-p2-sessions-vitest.log
npm run game:mcp:build | PASS | D:/Project/AI-NATIVE-01-evidence/p3-epoch-final-reviewer-mcp-build.log
node D:/Project/AI-NATIVE-01-evidence/p3-epoch-final-reviewer-probe.mjs | PASS | D:/Project/AI-NATIVE-01-evidence/p3-epoch-final-reviewer-probe.log
md5sum all tracked + untracked before/after diff | PASS | D:/Project/AI-NATIVE-01-evidence/p3-epoch-final-reviewer-md5.log
git status / diff --check / HEAD / staged | PASS | D:/Project/AI-NATIVE-01-evidence/p3-epoch-final-reviewer-git.log
```

定向 32 harness / 43 P2 sessions / typecheck / MCP build / 官方 52-probe 全 PASS；无 slice 变更，未跑 E2E/无关全量。Developer 自报 32 harness / 43 sessions / 261 全量 / typecheck / build / MCPbuild / 官方 client（日志 `p3-epoch-developer-*`）仅引用，未重跑。

---

## 5. 可提交结论

**P3 可接受。** 新 epoch 契约（step/execute_action/advanced 必填 epoch，校验先于缓存；fixture/restore 单调递增 epoch；create/observe 返回 epoch）已消除“缺 epoch 旧请求在 fixture/restore 后误执行”的残留；缺 epoch 走协议级 `E_SCHEMA`、显式旧 epoch 走 `E_STALE_EPOCH`、新 epoch 正常；同 request 缺省 fromTick/actionId 重试一致，冲突/失败/domain/session 隔离不退步；下层 P2 原子事务与签发内容绑定未破坏。稳定 md5 见报告顶部；本 Worker 未执行 commit。
