# C3-c 事件历史 / 中途回放 — 最后定向复核（冻结 dcb4f14）

- **被测**：`dcb4f14fffceac0c3ef7c44725256b88e0a00cf9`（父 `4cb59e9`，`fix: immutable event history and baseline-aligned mid-run replay`）
- **冻结**：`git archive dcb4f14` → `D:/Project/AI-NATIVE-02-snapshots/dcb4f14`（`node_modules` junction），MD5 见 `00-frozen-hashes.log`；未读 WIP / 未读 stash，未改源码/测试/配置/分支。
  - 复核期间活仓库 HEAD=`dcb4f14`，但工作区已有下一轮 WIP（`worldHeadless.ts`、`worldHeadlessMcpTools.ts`、新 `c3cExportFlag.test.ts`）；**未读取/未使用**。
- **结论：事件历史 immutable 已修复（原 172→900 tick mutation 不再出现）；中途 20→15 快照的 prefix+suffix 与篡改负向通过；但 boundary 导出回放的 `sameState` 仍失败——原因是 `canonicalSimulationState` 的 `player.data` 键序不稳定（值完全相同、哈希不同）。另发现 Dev 大量事件的工具响应在 ~4.7MB 时连接关闭，20k 事件窗无法通过官方 stdio 实际走完。P4 最低仍差这两项。**

## 1. 质量门（快照，按影响）

| 项 | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| typecheck | `npx tsc --noEmit` | PASS | `01-typecheck.log` |
| unit | `npm test` | PASS **41 files / 563 tests** | `02-unit.log` |
| MCP build | `npx vite build --config vite.mcp.config.ts` | PASS | `03-mcp-build.log` |
| Headless smoke | `npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts` | PASS；`dev_replay_history: baselineEvents=172, historyPreserved=true, tamperDivergence=0` | `04-smoke.log` |
| 历史 mutation 探针 | `node probe-history.mjs`（172 events → 900 tick） | PASS：`firstDiff=null`、projectile mutations=0 | `05-history.log` |
| 边界/中途/隔离 | `node probe-history-boundary.mjs` | 13/14（`boundary-replay-sameState` 失败，见 §3） | `06-boundary.log`、`dev.json` |
| 状态差异定位 | 本地 vs MCP 复算 | 值 diff=0；canonical 字符串键序不同 | `07–12*.log` |
| 20k 事件窗 | `node probe-event-window.mjs` / `probe-window-size.mjs` | **连接关闭**（~4.68MB 响应 / ~17.1k tick） | `13-event-window.log`、`14-window-size.log` |
| Player 负向 | `node probe-player.mjs` | PASS **8/8**（intent 拒绝、tick/quota/队列不变、cached replay 无 canonical） | `15-player.log`、`player.json` |
| Player crop | `npx vite-node src/ai-native/worldHeadlessPlayerCrop.mts` | PASS `PLAYER_CROP_NEGATIVE_PASS` | `16-crop.log` |
| Parity 16 | spec + `c3c-rendered-headless-parity.mts` | PASS **16/16** `finalTick=27 events=59 kills=1 lootLeft=0 currency=4 xp=8` | `17`/`18` |
| Parity 负向 | 禁用 8 个 fire 步 | **7 FAIL**；恢复后 PASS | `19-parity-tamper.log` |
| C2 回归 | resume-no-step + economy storage | PASS 4/4 | `20-resume-storage.log` |

## 2. 事件历史 immutable（已修复）

- 真实 fire+step 后 snapshot1 = **172** events；继续 **900** 真实 tick 后 snapshot2 前缀**完全不变**：
  - `firstDiff=null`、`projectileMutationCount=0`；
  - 172 条前缀逐字节相等（对比 `events-snapshot1.json` 与 `events-snapshot2-prefix.json`）。
- 与上一版（`4cb59e9`：首个 diff index=123、4 条 projectile pos/lifetime 被改写）相比，事件在 emit 时深拷贝、snapshot/restore 深拷贝的修复**有效**。

## 3. 中途 20→15 快照（PASS）与 boundary 导出回放（sameState 仍 FAIL）

### 中途 20→15
- 20 tick 边界快照（41 events）→ 继续 15 tick（共 71 events）：
  - **完整 prefix**（前 41 条）逐字节相等；
  - `dev_replay(frame, 15 tick)`：`sameState=true, sameEvents=true, firstDivergence=null`，新增段 hash 相同（`expectedNewEventsHash == actualNewEventsHash`）；
  - 篡改动作 → `firstDivergence=41`（=baseline，新段首条）；
  - 篡改前缀事件 index 3 → `historyPreserved=false, firstDivergence=3`。

### boundary 导出回放
- `sameEvents=true, historyPreserved=true, firstDivergence=null`；**`sameState=false`**。
- 定位：把导出的 frame 恢复到一个新会话再跑同样 15+20 tick，得到的 live canonical 与 replay actual 相同（`fnv1a32:4159ebd4`）；原 live 会话为 `fnv1a32:68da6db2`。
- 两份 canonical **解析后的值 diff = 0**；字符串在 **char 174** 开始不同：
  - live：`...maxHp,hp,speed,armor,damage...`
  - restored/replay：`...abilities,aimYaw,armor,cooldownReduced...`
  - 即 `canonicalSimulationState` 里 `player.data` 的**键序不稳定**，`payloadFingerprint(JSON.stringify(...))` 对键序敏感 → **值相同但 sameState 判为 false**。
- 影响：boundary/restore 回放的 `sameState` 不可信；这不是状态分叉，而是 canonical 比较器/序列化缺陷。建议对 `player.data`（或整个 canonical 投影）使用排序键的 canonical JSON，再算 fingerprint；并补 “restore+同动作 vs 原会话 canonical 相等” 回归。
- 篡改负向在 boundary 场景仍然正确：篡改动作 → `firstDivergence=243`（baseline）；篡改前缀 index 5 → `historyPreserved=false, firstDivergence=5`。

## 4. 快照双向隔离（PASS）

- snapshot 后深改 frame（player.x、events[0]）→ 活会话 observation/tick/x **不变**；
- 活世界继续 50 tick → 已保存 frame 的 JSON **逐字节不变**；
- restore 已保存 frame → 活 state 回到 frame（tick 30、x 一致、epoch 1→2）。

## 5. 20k 事件窗 / 官方 stdio 限制（实际阻断）

- Dev `world_headless_step` 每步返回完整 `canonicalEvents`，响应随事件数线性增长：
  - 300 tick/步：tick 12,000 时响应 **3.36MB**；tick 15,000 时 **4.14MB**；
  - tick **17,100**（响应 **4,683,481 bytes**）后下一步 **`MCP error -32000: Connection closed`**；服务端进程 exit code **0**（stdin 被关闭），stderr 为空。
  - 1000 tick/步时在 tick ~16,000 同样关闭。
- 结论：**20,000 事件窗在官方 stdio Dev 面上无法实际跑完**；snapshot/export 一个 20k 事件 frame 会是单条 >5MB 消息，预计同样不可用。Player 面（无 canonicalEvents）不受此影响，但 Player 在单 drone 遭遇中约 2.5k tick 死亡，无法自然到 20k。
- 这是工具输出/传输层的现实边界，不是 core 状态错误；建议 Dev step 不返回全量 canonicalEvents（或分页/可选），并验证 20k 截断 flag（`eventsTruncated`）在可达范围内。

## 6. Player / Parity / C2（最小回归）

- Player 8/8：step schema 无 intent；合法 intent 被 MCP schema 拒绝；tick/quota/队列不变；300 次拒绝后 step 仍执行队列 action 一次；cached replay text/structured 无 canonical、不重复推进。
- Parity 16/16（真实 kill+loot，`finalTick=27 events=59 kills=1 currency=4 xp=8`）；禁用 8 个 fire → 7 FAIL；恢复 PASS。
- C2 resume/storage 4/4；Signal 仍未实现（`world.signal_combat_unsupported`），不在本轮改。

## 7. 判定 / P4 最低

| 项 | 判定 |
| --- | --- |
| 事件历史 immutable | **PASS**（172→900 tick 前缀不变） |
| 中途 20→15 prefix+suffix、篡改 index | **PASS**（prefix 相同；tamper 41 / 3） |
| boundary 导出 replay `sameEvents` | PASS |
| boundary 导出 replay `sameState` | **FAIL**：canonical 值相等但 player.data 键序不同 → 哈希不同（char 174） |
| 快照双向隔离 / restore 应用 frame | PASS |
| 20k 事件窗 | **实际不可达**：~4.7MB 响应即连接关闭（~17.1k tick） |
| Player 通道 / 输出 / 时长 / ledger | 此前已通过，本轮 Player 8/8 复验 |
| **P4 最低** | **仍未满足**：snapshot/replay 的 sameState 比较器有缺陷 + 20k 窗口在官方 stdio 不可用；Signal 未实现 |
| 真实 LLM / 全 Run | 未跑；不声称 |

## 8. 复现

```bash
cd D:/Project/AI-NATIVE-02-snapshots/dcb4f14
npx tsc --noEmit && npm test
npx vite build --config vite.mcp.config.ts
npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts
node .../probe-history.mjs
node .../probe-history-boundary.mjs
node .../probe-player.mjs
npx vite-node src/ai-native/worldHeadlessPlayerCrop.mts
PORT=5341 npx playwright test tests/c3c-headless-parity.spec.ts
npx vite-node scripts/c3c-rendered-headless-parity.mts
PORT=5341 npx playwright test tests/resume-no-step.spec.ts tests/economy.spec.ts --grep "resume|storage"
node .../probe-event-window.mjs   # 观察 ~17k tick 时连接关闭
```

## 9. 文件

`reports/ai-native-02/tester/c3c-history-final/`：`00-frozen-hashes.log`、`01–04` 门禁、`05` history、`06` boundary、`07–12` 状态差异/键序定位、`13–14` 20k 窗、`15–16` Player/crop、`17–19` parity/负向、`20` C2、`21-evidence-md5.log`、`player.json`、`dev.json`、`history.json`、`events-snapshot1.json`、`events-snapshot2-prefix.json`、`initial/sequence/rendered.json`、`probe-*.mjs/.mts`。
