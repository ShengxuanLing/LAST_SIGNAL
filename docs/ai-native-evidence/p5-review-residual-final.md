# AI-NATIVE-01 P5 — R1/R2 残留修复最终定向验收

> 角色：Reviewer Worker，只读审查。不改源码/仓库 tests、未 commit/切分支、未扩正式 ECHO/World/key/version、未等轮询。
> 报告：`D:/Project/AI-NATIVE-01-evidence/p5-review-residual-final.md`；本轮 gate：`D:/Project/AI-NATIVE-01-evidence/p5-residual-final-reviewer-*.log`。
> 快照：`feat/ai-native-runtime`，HEAD `56e4902044a3dae94c6b7cca1d7eceb46b29a947`（developer 停写）。
> MD5 与 Lead 一致：`coop.ts f2dfe8b1b6b521916fdf25038e33a504`、`coop.test.ts 40de8152c8e248eadc058c7f0fab7829`、`docs/AI_NATIVE_ECHO.md 6afc104d5f22bea44b12225169956169`、`mcpServer.ts 5a6f369d2edbd7286aa7f3ab3a667f0c`、`rules.ts 96947c32b5879b7c4eeeb327efa38761`、`sharedCore.ts f8ee3a302a6ebc4abb492ba9c428fa32`。

---

## 结论

**P5 现在可接受。** R1（跨 instance frame）与 R2（完整性只比 32bit fingerprint）已真正关闭：每个 `CoopSession` 在 Node 协作边界用 `node:crypto` `randomBytes` 生成 per-instance `instanceId`/`sessionId`，快照内嵌并强制校验 `instanceId`/`sessionId`/`snapshotId`，`issued` 保存**完整 canonical payload** 并在 restore 做全量相等比较；`publicHash`（`fnv1a32`）仅为对外完整性元数据，**不参与授权**。两同 seed 实例各自签发后交换 frame 必拒；篡改 confirm/budget/位置/instance/session/snapshotId 即使重算 `publicHash` 也拒绝且状态原子不变。合法多次 restore、64 淘汰、epoch 单调、旧 confirm 不复活、双 actor 完整恢复无 alias 均通过；V1/V2/V3/V5 回归无退步；R3 文档已明确；`node:crypto` 仅在 `coop.ts`（Node 协作边界），纯 `Slice`/`sharedCore` 无 node/Phaser；生产 Player 仍 6 工具。

---

## 1. R1 — instance/session/snapshot 全绑定（关闭）

- `coop.ts` 构造：`const capability = randomBytes(12).toString('hex')`；`instanceId = inst_<cap16>`、`sessionId = ses_<cap24>`；`instSeed = seed ^ capability` 参与 actorId 派生，故两同 seed 实例的 `instanceId`/`sessionId`/actorId 均不同。
- `snapshotPayload()` 内嵌 `instanceId`、`sessionId`；`nextSnapshotId()` 为 `csnap_<instanceSalt12><counter36>`（含实例 salt）。
- `restore()` 先校验 `frame.instanceId === this.instanceId` 与 `frame.sessionId === this.sessionId`，再查 `issued`。
- 独立 probe（`p5-residual-final-reviewer-probe.log`）：
```text
R1_cross_instance_swap_rejected | ok:true | ab:E_SNAPSHOT_INVALID ba:E_SNAPSHOT_INVALID
  aInst=inst_e044d109f4e5d776 bInst=inst_db6822a866455195
  aSes=ses_e044d109f4e5d776cb4406e6 bSes=ses_db6822a866455195930a12a1
```
两同 seed 实例各自 scan+snapshot 后 `b.restore(af)`、`a.restore(bf)` 均拒绝。

## 2. R2 — 完整 canonical payload 授权，非 32bit（关闭）

- `snapshot()`：`this.issued.set(snapshotId, canonicalJson(payload))`；返回 `publicHash: payloadFingerprint(payload)` 仅作元数据。
- `restore()`：解构丢弃 `snapshotId`/`publicHash`，`actualIdentity = canonicalJson(payload)` 与 `issued` 的完整字符串比较；不等即 `E_SNAPSHOT_INVALID`。**重算 `publicHash` 不影响授权**。
- 独立 probe：
```text
R2_tamper_confirm_rejected / budget / position / instanceId / sessionId / snapshotId
  -> 全部 E_SNAPSHOT_INVALID（publicHash 已按篡改内容重算）
R2_atomic_state_unchanged | ok:true
R2_publicHash_ignored_valid_frame_ok | ok:true
R2_multi_restore_epoch_monotonic | ok:true e1=1 e2=2
R2_old_confirm_removed | ok:true status=proposed exec=false
R2_64_eviction | ok:true first=false last=true
R2_restore_no_alias | ok:true
```
- 提交仍为“先候选校验、后原子写入”；失败路径不触碰当前状态。
- `epoch = max(current+1, frame.epoch+1)` 单调；快照之后产生的 confirm 在 restore 后回到 `proposed` 且不可执行。

## 3. V1/V2/V3/V5 回归（无退步）

- `V1_share_trim_regression` PASS：`fields` 可选仅 `relationId/stateLabel/position`；`stateLabel`-only 共享投影含 `stateLabel`、`observerPosition` 被脱敏为 `{0,0}`，未共享字段不投影。
- `V2_echo_status_regression` PASS：`companionHandle().status()` 键仅 `scenario/testFixture/tick/epoch/paused/takenOver/echoCancelled/echoLinkLost/echoBudget/humanActorId/echo`，无 `human` 私有块。
- `V3_snapshot_no_live_ref_regression` PASS：snapshot 后运行时 scan 不改 frame 内容。
- `V5_plan_deep_freeze_regression` PASS：deep-freeze 的 `action`/`targetIds`，外部改原 plan 不影响 hypothesis。

## 4. R3 文档 & 边界

- `docs/AI_NATIVE_ECHO.md:28-36` 已明确：可选白名单仅 `relationId/stateLabel/position`；`targetId`、`observedAtTick`/`expiresAtTick`（TTL）、`roomId`、`sourceActionId`、`observerActorId` 为固定身份/来源元数据始终携带；未选字段不进入 recipient 的证据/可见目标/连接/假设基础。
- 快照隔离段（`:80-92`）明确 per-instance 随机 `instanceId`/`sessionId`、`snapshotId`、完整 canonical payload 授权、64 上限、跨实例拒绝、epoch 单调、旧 confirm 移除。
- `node:crypto` 仅 `coop.ts:21`（Node 协作边界）；`rules.ts`/`sharedCore.ts`/`fullState.ts` 为纯 TS，无 node/Phaser import；`protocol.ts` 仍声明无 Node crypto。

## 5. 生产不退步

工具面探针（`p5-residual-final-reviewer-tools-probe.log`）：`PLAYER_COUNT=6`、`PLAYER_HAS_COOP=false`、`PLAYER_TOOLS=[close,create,execute_action,get_events,observe,step]`；Dev 含 9 个 `game_coop_*`。正式 `station-zero`/P4 路径不变；coop 仅隔离测试。

---

## 6. Gate 汇总（命令 | PASS/FAIL | 绝对日志路径）

```text
npm run typecheck | PASS | D:/Project/AI-NATIVE-01-evidence/p5-residual-final-reviewer-typecheck.log
npm run game:mcp:build | PASS | D:/Project/AI-NATIVE-01-evidence/p5-residual-final-reviewer-mcp-build.log
npx vitest run src/ai-native/coop.test.ts --reporter=dot | PASS | D:/Project/AI-NATIVE-01-evidence/p5-residual-final-reviewer-coop-vitest.log
npx vite-node p5-residual-final-probe.mts | PASS | D:/Project/AI-NATIVE-01-evidence/p5-residual-final-reviewer-probe.log
node tools-probe (player=6 / dev coop only) | PASS | D:/Project/AI-NATIVE-01-evidence/p5-residual-final-reviewer-tools-probe.log
md5sum all tracked + untracked before/after diff | PASS | D:/Project/AI-NATIVE-01-evidence/p5-residual-final-reviewer-md5.log
git status / diff --check / HEAD / staged | PASS | D:/Project/AI-NATIVE-01-evidence/p5-residual-final-reviewer-git.log
```

定向 21 coop tests / typecheck / MCP build / 18-check probe / 工具面全 PASS；复核前后全文件 md5 未变（含 `dist-mcp/` 生成物不提交）。Developer 自报 21 target / 287 full / typecheck / build / MCPbuild / demo / P4replay（日志 `p5-residual-developer-*`）仅引用，未重跑。

---

## 7. 可提交结论

**P5 可接受，无残留阻断。** R1/R2 已按要求关闭（随机 per-instance 身份 + 完整 canonical payload 授权，跨同 seed 实例 frame 拒绝，篡改即便重算 publicHash 亦拒绝且原子），V1/V2/V3/V5 回归无退步，R3 文档已明确，Node crypto 仅在协作边界，生产 Player/正式路径不变。本 Worker 未改动任何源码、未 commit。
