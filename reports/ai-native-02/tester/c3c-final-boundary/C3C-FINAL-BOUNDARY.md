# C3-c 最后 Player 通道 / 快照边界 / 事件历史 — 定向复核（冻结 4cb59e9）

- **被测**：`4cb59e9f64456e4434002256bb2e8f24fbc88bfc`（父 `8f1ce6c`，`fix: close headless Player step-intent channel and add snapshot action boundary`）
- **冻结**：`git archive 4cb59e9` → `D:/Project/AI-NATIVE-02-snapshots/4cb59e9`（`node_modules` junction），MD5 见 `00-frozen-hashes.log`；未读共享 WIP / 未读 stash，未改源码/测试/配置/分支。
  - 复核期间活仓库 HEAD=`4cb59e9`，但工作区已有下一轮 WIP（`worldHeadless.ts`、`world/sim/core.ts` 等）；**未读取/未使用**，结论只对冻结快照负责。
- **结论：Player 直连 intent 通道已关闭；快照边界与 incomplete/replayable 导出标记有效；但事件历史仍持有活引用（projectile pos/lifetime 被后续 tick 改写），导致 boundary 导出重放 sameState/sameEvents 失败、快照前缀不 immutable。P4 最低仍不能被该事件历史满足。**

## 1. 质量门（快照）

| 项 | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| typecheck | `npx tsc --noEmit` | PASS exit=0 | `01-typecheck.log` |
| unit | `npm test` | PASS **40 files / 554 tests** | `02-unit.log` |
| MCP build | `npx vite build --config vite.mcp.config.ts` | PASS | `03-mcp-build.log` |
| Headless smoke | `npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts` | PASS（含 `dev_snapshot_boundary: midRejected=true, restoredEpoch=2`） | `04-smoke.log` |
| Player crop negative | `npx vite-node src/ai-native/worldHeadlessPlayerCrop.mts` | PASS `PLAYER_CROP_NEGATIVE_PASS` | `05-player-crop.log` |
| Lease smoke | `npx vite-node src/ai-native/worldMcpLeaseSmoke.mts` | PASS | `06-lease-smoke.log` |
| Player 通道复验 | `node probe-player.mjs` | PASS **8/8** | `07-player.log`、`player.json` |
| Dev 边界/导出 | `node probe-dev.mjs` | 12/14（2 项因事件历史失败，见 §4） | `08-dev.log`、`dev.json` |
| 历史事件探针 | `node probe-history.mjs` | **发现 mutation** | `09-history.log`、`history.json`、`events-snapshot1.json`、`events-snapshot2-prefix.json` |
| Rendered parity 16 | spec + `c3c-rendered-headless-parity.mts` | PASS **16/16** `finalTick=27 events=59 kills=1 lootLeft=0 currency=4 xp=8` | `10-parity-export.log`、`11-parity-compare.log` |
| Parity 负向 | 禁用 8 个 fire 步 | **7 FAIL**；恢复后再次 PASS | `12-parity-tamper.log` |
| C3b 定向 | `tests/c3c-bridge-reclaim + c3b-hard-disconnect + c3b-external-link` | PASS **12/12**（含 stop 抢占） | `13-c3b-targeted.log` |
| C2 回归 | resume-no-step + economy storage | PASS 4/4 | `14-resume-storage.log` |
| 恢复后新事件隔离 | `probe-restore-events.mts` | state 相同、**新增 events 60/60 相同**；历史前缀 1 处不同（index 210） | `15-restore-new-events.log` |

## 2. Player 通道（F2）——已关闭

- `world_headless_step` 的官方 input schema 只有 `session/epoch/requestId/ticks`，**没有 intent**。
- 带合法 intent 直调 → `MCP error -32602 Unrecognized key: "intent"`（schema 层拒绝，未进入 manager）。
- 拒绝前后：tick **0→0**、玩家 x **20.5→20.5**；已排队的 `world_action` 仍在队列。
- 连续 **300 次**带 intent 的拒绝调用后，再用新 requestId `step(120)`：队列动作 **applied 一次、executedTicks=120、位移 6.7192**（quota 未被拒绝调用消耗）。
- `step` cached replay 的 `text` 与 `structuredContent`：无 `canonicalState/canonicalEvents`（递归扫描 0 命中），`replayed:true` 且 `toTick` 不前进。
- 判定：**F2 关闭**（Player 只能 action→step；Dev 才可传 intent）。

## 3. 快照动作边界 / 导出标记——机制正确

- 半执行时 `dev_snapshot` → `E_NOT_APPLICABLE`（`world.snapshot_requires_action_boundary`），**没有 cancel 队列**：随后 `step(110)` 正常 `applied executedTicks=120`。
- 边界快照成功（`boundary:'action'`）；`restore` 成功，epoch **1→2**，tick 回到 120。
- 下一动作（与未 restore 的对照会话）：**canonicalState 相同**；**新增 events 60/60 完全相同**（`probe-restore-events.mts`）。完整 `canonicalEvents` 前缀有 1 处不同（index 210），由 §4 的历史 mutation 导致。
- incomplete 导出（半执行）：`boundary:'mid_execution'`、`replayable:false`、frame **无** `boundary` 标记；用该 frame 去 restore 边界会话 → `E_NOT_APPLICABLE`；导出后动作仍可完成（step110 applied 120）。
- boundary 导出：`boundary:'action'`、`replayable:true`、frame.boundary=`action`；另一会话 restore 成功。
- 失败包已保存：`incomplete-failure-bundle.json`、`boundary-failure-bundle.json`（MD5 见 `16-evidence-md5.log`）。

## 4. 阻断（剩余）：事件历史是活引用，会被后续 tick 改写

独立探针（Dev，真实 fire+step，随后 3×300 neutral tick）：

- tick 120 时 snapshot1：events **172** 条；继续 900 tick 后 snapshot2：**972** 条。
- 同一前缀（前 172 条）比较：**首个不同 index=123**（`projectile-spawned`）；共 4 条 projectile 事件被改写。
- 样例：projectile id=8 的 `pos.x` **28.8125 → 29**、`lifetime` **0.0055555 → -0.0111111**；即历史事件里的 `projectile` 是 core 活对象，后续 tick 继续更新 pos/lifetime（含 `hitIds`）。
- 这不是序列化显示问题：`step` 返回时与 snapshot1 完全一致（`step-events-equal-snapshot1=true`），但**存储的世界历史本身**在后续 tick 后改变。
- 直接后果：
  1. **boundary 导出重放失败**：`dev_replay(frame, steps)` 得到 `sameState=false, firstDivergence=0`（live 历史已 mutation，frame 是导出时的 JSON 副本）。
  2. **恢复后完整 canonicalEvents 与未 restore 会话不同**（前缀 index 210），尽管状态与新增事件相同。
  3. snapshot 前缀不 immutable：审计/回放/对比不可靠；incomplete/boundary 标记之外，历史本身不是冻结的。

建议修复：`world.events.push` 时对事件 payload 做深拷贝/冻结（尤其 `projectile-spawned` 的 `projectile.pos/lifetime/hitIds`、`drone-step` 的 step 对象），或 core 发出不可变快照；并用“snapshot1 前缀在 N tick 后仍逐字节相等”“boundary export replay sameState=true”回归。

## 5. Parity / C3b / 回归

- Parity 16/16 PASS，负向（禁用 fire）7 项 FAIL，恢复后 PASS；证据 `initial/sequence/rendered.json` + MD5 保存在本目录。
- C3b 定向 12/12 PASS（stop 抢占、reload LOST 重授权、SIGKILL 降级）；lease smoke PASS；resume/storage 4/4。
- 未重复 69 全量。

## 6. 判定与 P4

| 项 | 判定 |
| --- | --- |
| Player 直连 intent（F2） | **关闭**（schema + manager 双拒绝；tick/quota/队列不变） |
| 快照动作边界 / incomplete vs replayable 导出 | **机制 PASS** |
| 恢复后状态/新增事件 | state 相同、新增 events 相同；**完整历史前缀**因 mutation 不同 |
| 事件历史 immutable | **FAIL（阻断）**：projectile 历史被后续 tick 改写；boundary replay sameState 失败 |
| Rendered parity 16 / C3b 定向 / 门禁 | PASS |
| **P4 最低** | **仍不满足**：事件历史不 immutable，boundary 导出重放不能 sameState/sameEvents；需修复后再验 |
| 真实 LLM / Signal | 未跑 / 未实现（不在本轮范围） |

## 7. 复现

```bash
cd D:/Project/AI-NATIVE-02-snapshots/4cb59e9
npx tsc --noEmit && npm test
npx vite build --config vite.mcp.config.ts
npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts
npx vite-node src/ai-native/worldHeadlessPlayerCrop.mts
node .../probe-player.mjs && node .../probe-dev.mjs && node .../probe-history.mjs
npx vite-node probe-restore-events.mts
PORT=5331 npx playwright test tests/c3c-headless-parity.spec.ts
npx vite-node scripts/c3c-rendered-headless-parity.mts
PORT=5331 npx playwright test tests/c3c-bridge-reclaim.spec.ts tests/c3b-hard-disconnect.spec.ts tests/c3b-external-link.spec.ts --workers=1
PORT=5331 npx playwright test tests/resume-no-step.spec.ts tests/economy.spec.ts --grep "resume|storage"
```

## 8. 文件

`reports/ai-native-02/tester/c3c-final-boundary/`：`00-frozen-hashes.log`、`01–06` 门禁、`07` Player、`08` Dev、`09` history、`10–12` parity、`13–14` C3b/回归、`15` restore-new-events、`16-evidence-md5.log`、`player.json`、`dev.json`、`history.json`、`events-snapshot1.json`、`events-snapshot2-prefix.json`、`incomplete-failure-bundle.json`、`boundary-failure-bundle.json`、`initial/sequence/rendered.json`、`probe-*.mjs/.mts`。
