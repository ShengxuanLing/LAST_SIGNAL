# AI-NATIVE-01 P1 — 最终残留 B3-1/B4 验收（可提交结论）

> 角色：Reviewer Worker，只读审查。未改源码/测试/配置、未 commit、未切分支、未等待/轮询、未重跑无关全量旧测试/浏览器全套。
> 报告：`D:/Project/AI-NATIVE-01-evidence/p1-review-residual-final.md`；本轮 gate：`D:/Project/AI-NATIVE-01-evidence/p1-residual-reviewer-*.log`。
> 稳定快照：分支 `feat/ai-native-runtime`，HEAD `95e8da35dcaff9000ae0147ef3ec80b0e0a085fc`。源码 md5 与 Lead 冻结值一致：
> `runtime.ts b6a5474a2d456bd84651dab5823c574f`、`rules.ts 55fb1552845c770e59bef27a23a6f093`、`storage.ts addd69bd1af496131398ed2efe851d2c`、`corridor.ts 68a22ecad9ac8a16bd7a5e4a23f6068a`、`runtime.test.ts 42609841a7bbff5a6061228ca758df61`、`evidence.test.ts c9ad354c0d68c7811f7621c6514799a1`、`headlessCli.ts 6aca053bb3614874bd9c04642aac234c`。
> 复核前后全 tracked+untracked 文件 md5 未变；`git diff --check=0`、staged diff=0。本轮未发现新的源码并发变化。

---

## 结论

**P1 代码可接受，无未关闭阻断。** B1/B2/B5/B6/B7 维持关闭；B3-1 已关闭；B4 的 same-session 位置篡改、corridor 删除 DOOR_PASSED、跨 seed/session、失败原子、重复恢复、0/非零 replay 哈希、64 签发淘汰均已独立复测通过。

关键结论：

- **B3-1 已关闭**：走廊清 Guard 安全点 Scan → `serialize` → `save` → `load` → `newModel` 后，走廊 evidence 的 target/room/TTL 保持不变、`scanRevealTicks` 不变、`evidenceRescanRequired=false`，不发生重扫；错误 room/TTL 仍被拒绝，过期证据被安全丢弃并提示重扫。
- **B4 已关闭**：`snapshotIdentity` 覆盖完整签发 payload（仅排除公开 hash），`restore` 必须命中本实例已签发的 `snapshotId` 且完整 canonical payload 一致；same-session 仅改合法位置并重算公开 hash 仍 `E_SNAPSHOT_INVALID`；corridor + passed 删除 DOOR_PASSED 仍拒绝；跨 seed/session 拒绝；失败不污染；原样多次恢复、0/非零 replay 哈希不漂移；64 签发 FIFO 淘汰行为明确。
- 公开 hash 仅完整性，不作为授权；Dev fixture 权限不绕过 restore 签发内容绑定。跨进程任意导入不宣称支持，符合 Lead 口径。

因此可提交 **P1 代码可接受**。本 Worker 未执行 commit；P2 Gateway/MCP 未实现本身不判 P1 失败。

---

## 1. B3-1：走廊安全点 Scan/存档/恢复

代码证据：

- `src/slice/rules.ts:452-474`：`serialize()` 在走廊内把 `this.evidence` 作为第四参传给 `corridor.capture(...)`，不再把 R2 evidence 塞进 top-level lab `evidence`。
- `src/slice/corridor.ts:288-297`：`Corridor.capture(..., evidence)` 在 `scanRemaining > 0 && evidence.length > 0` 时把 R2 evidence 写入 `corridor.evidence`，含 target/relation/position/observedAtTick/expiresAtTick/stateLabel/roomId。
- `src/slice/storage.ts:38-65`：`isCorridorCheckpoint()` 对 `corridor.evidence` 要求 `roomId==='station-zero-r2'`、`observedAtTick <= savedTick < expiresAtTick`、`expiresAtTick===savedTick+scanRemaining`；`storage.ts:100-105` 对 top-level evidence 仍要求 `roomId===v.roomId`。
- `src/slice/rules.ts:663-707`：`SliceModel.restore()` 从 `p.corridor.evidence` 按 `roomId==='station-zero-r2'` 与绝对 TTL 窗口恢复，不重新调用 Scan/LOS；仅当证据丢失/过期时置 `evidenceRescanRequired`。

独立探针（`p1-residual-reviewer-probe.log` `B3_corridor_safe_scan_save_load`）：

```text
beforeRoom=station-zero-r2, guardHp=0, beforeScanRevealTicks=480
beforeEvidence=[tgt_corridor_relay, tgt_corridor_bridge, tgt_corridor_guard]
  observedAtTick=40, expiresAtTick=520, roomId=station-zero-r2
savedTopLevelEvidence=null
savedCorridorEvidence=[同三目标, roomId=station-zero-r2, TTL 40/520]
saveOk=true
loadStatus=ok
restoredScanRevealTicks=480
restoredEvidence=[同三目标, TTL 40/520]
restoredEvidenceRescanRequired=false
```

B3 反向拒绝（`B3_storage_ttl_room_rejects`）：

```text
过期证据: loadStatus=ok, evidenceCount=0, reveal=null, evidenceRescanRequired=true
未来证据: loadStatus=rejected
错误 room evidence: loadStatus=rejected
```

**B3-1 关闭。** 正常走廊安全点存档可用；证据 room/TTL 不变、不重扫；错误证据仍拒绝/降级。

---

## 2. B4：签发内容绑定与 restore 残留

### 2.1 `snapshotIdentity` 覆盖完整权威 payload

代码证据（稳定快照）：

- `src/ai-native/runtime.ts:558-584`：`snapshot()` 每次签发新的 `snapshotId`，并把 `snapshotIdentity(frame)` 写入本实例 `issuedSnapshots`；超过 `RUNTIME_LIMITS.MAX_ISSUED_SNAPSHOTS`（`:66`，64）按插入顺序 FIFO 淘汰最旧。
- `src/ai-native/runtime.ts:642-646`：`issuedProblem()` 先查 `snapshotId` 是否本实例已签发，再对**完整 frame** 做 `snapshotIdentity` 精确比对；仅 `snapshotId` 不足以通过。
- `src/ai-native/runtime.ts:856-861`：`snapshotIdentity()` 只解构排除 `stateHash/eventsHash`，其余 `schema/protocolVersion/kernelVersion/scenario/snapshotId/sessionId/seed/rngState/status/epoch/tick/movement/model/events/eventSeq/droppedEvents/actionSeq/actionLog` 全部进入 canonical JSON。
- `src/ai-native/runtime.ts:1019-1030`：`validateRestoreFrame()` 额外绑定 `seed/sessionId/rngState`，并要求 `passed=true` 必须有 `DOOR_PASSED` 事件（不再有 `&& !corridor` 短路）。

### 2.2 独立反例复测（全部拒绝/符合）

`p1-residual-reviewer-probe.log`：

```text
B4_position_only_recomputed_hash:
  same-session 仅改 model.playerX/Y=(12.5,5.5)，并重算公开 stateHash/eventsHash
  restoreOk=false, code=E_SNAPSHOT_INVALID
  tickUnchanged=true, energyUnchanged=true, room=station-zero-r1, x=3.5,y=5.5

B4_corridor_passed_without_door_event:
  corridor=true, passed=true, 删除全部 DOOR_PASSED/事件
  restoreOk=false, code=E_SNAPSHOT_INVALID

B4_cross_seed_restore:
  seed 11 帧 -> seed 22 实例
  restoreOk=false, code=E_SNAPSHOT_INVALID

B4_snapshot_eviction_64:
  count=65
  firstRestoreOk=false (firstCode=E_SNAPSHOT_INVALID)
  lastRestoreOk=true

B4_repeat_restore_and_zero_step:
  first=true, second=true, replay0=true, canonical0=true

B4_nonzero_replay_with_issued_snapshot:
  replayOk=true, canonicalEqual=true
```

结论：

- same-session 仅改合法位置（并重算公开 hash）仍拒绝，失败不污染旧态（tick/energy/room/pos 未变）。
- corridor + passed 删除 DOOR_PASSED 拒绝，`passed` 不再能脱离签发事件。
- 跨 seed/session 拒绝。
- 64 签发 FIFO：第 65 个快照淘汰第 1 个，第 1 个 restore 拒绝、第 65 个 restore 成功；行为明确。
- 原样同一签发帧可重复 restore；0 步与非常规步 replay 的 canonical state 与源/逐步执行一致，hash 不漂移。
- 公开 `stateHash/eventsHash` 不参与 `snapshotIdentity` 授权，`snapshotId` 单独伪造不可过；Dev fixture 不绕过签发内容绑定。跨进程任意导入不宣称支持。

**B4 关闭。**

---

## 3. 其余已关闭项（维持）

- **B1**：生产 Scene 与 Node 都走每 tick `onCommit(preTickSnapshot)`；上轮独立探针 batch/perTick 均 `enteredAt=1` 同位置，本轮源码未回退该接缝。
- **B2**：`observe()` 为 P0 `ObservationV1`；上轮独立探针 `validateObservationDetailed=OK`、`hasHiddenField(obs,['role'])=null`，无 `behavior/reveal/seed/rngState`。
- **B5**：上轮 0/非零 replay canonical 一致；本轮 `B4_repeat_restore_and_zero_step` / `B4_nonzero_replay_with_issued_snapshot` 再确认。
- **B6**：`game:headless` 固定 `--dev`，restricted 的 snapshot/replay 均 `E_PERMISSION`；`headlessCli.ts` md5 未变，仍明确“not MCP / not AI playthrough”。
- **B7**：坏 actions/steps `E_SCHEMA`、实例 16/行 16 KiB 上限、quit 无 EOF exit 0；上一轮独立 CLI 证据仍有效，且本轮未改 `headlessCli.ts`。

---

## 4. Gate 汇总（命令 | PASS/FAIL | 日志绝对路径）

```text
npm run typecheck | PASS | D:/Project/AI-NATIVE-01-evidence/p1-residual-reviewer-typecheck.log
npx vitest run src/ai-native/runtime.test.ts src/slice/evidence.test.ts --reporter=dot | PASS | D:/Project/AI-NATIVE-01-evidence/p1-residual-reviewer-targeted-vitest.log
npx vite-node D:/Project/AI-NATIVE-01-evidence/p1-residual-reviewer-probe.mts | PASS | D:/Project/AI-NATIVE-01-evidence/p1-residual-reviewer-probe.log
md5sum all tracked + untracked files before/after diff | PASS | D:/Project/AI-NATIVE-01-evidence/p1-residual-reviewer-md5.log
git status / diff --check / HEAD / staged gate | PASS | D:/Project/AI-NATIVE-01-evidence/p1-residual-reviewer-git.log
```

定向 2 test files / 51 tests PASS。Developer 的 `p1-residual-developer-gate-summary.log` 记录 target 51 / full 186 / build / 13 E2E / typecheck PASS，本轮仅引用，不重跑无关全量旧构建。`p1-residual-reviewer-md5.log` 显示复核前后全文件 md5 一致；`git diff --check=0`，staged diff=0。

---

## 5. 可提交结论

**P1 代码可接受，无未关闭阻断。** B3-1 正常走廊 Scan/存档/恢复证据 room/TTL 不变且不重扫；B4 签发内容绑定覆盖完整权威 payload，same-session 位置篡改、corridor 删除 DOOR_PASSED、跨 seed/session、失败污染、重复恢复、0/非零 replay 哈希、64 FIFO 签发淘汰均已独立复测符合。当前稳定 md5 以本报告顶部为准；本 Worker 未执行 commit，P2 Gateway/MCP 未实现不单独判 P1 失败。
