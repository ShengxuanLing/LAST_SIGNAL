# C3-c canonical / transport 最后定向验收（冻结 87d6ae0）

- **被测**：`87d6ae026bdafa8fef0350dcc91a84d9974b9db1`（`chore: refresh parity fixtures after transport-budget run`），功能提交链 `f5629ef`（stable canonical JSON）→ `3058348`（exact truncation flag）→ `b3b0e00`（transport-budgeted Dev output：hashes/paging/refs）；父 `b3b0e00`。
- **冻结**：`git archive 87d6ae0` → `D:/Project/AI-NATIVE-02-snapshots/87d6ae0`（`node_modules` junction），MD5 见 `00-frozen-hashes.log`；未读共享 WIP / 未读 stash，未改源码/测试/配置/分支。
  - 复核期间活仓库 HEAD=`87d6ae0`，工作区已有下一轮 WIP（`secureTokenFile.ts`、`worldHeadlessMcpTools.ts`、新 `c3cOwnerFile.test.ts`）；**未读取/未使用**。
- **结论：上一轮剩余的两项（canonical 键序、stdio/20k 传输）均已修复并有独立证据；export 截断语义、ref/file/paging 边界、Player/Dev 权限隔离通过。Signal Combat 仍未实现，不能据此 AI-NATIVE-02 整体 PASS。**

## 1. 质量门（快照）

| 项 | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| typecheck | `npx tsc --noEmit` | PASS | `01-typecheck.log` |
| unit | `npm test` | PASS **43 files / 574 tests** | `02-unit.log` |
| MCP build | `npx vite build --config vite.mcp.config.ts` | PASS | `03-mcp-build.log` |
| Headless smoke | `worldHeadlessMcpSmoke.mts` | PASS（`dev_replay_history baselineEvents=172 historyPreserved=true tamperDivergence=0`） | `04-smoke.log` |
| 20k smoke（开发者） | `worldHeadless20kSmoke.mts` | PASS `HEADLESS_20K_STDIO_PASS eventTotal=101635 maxResponseBytes=69666 wallMs=14990` | `05-20k-smoke.log` |
| Player crop | `worldHeadlessPlayerCrop.mts` | PASS `PLAYER_CROP_NEGATIVE_PASS` | `06-player-crop.log` |
| 我的 transport/canonical 探针 | `node probe-transport.mjs` | PASS **27/27** | `07-transport.log`、`dev.json` |
| Player 负向 | `node probe-player.mjs` | PASS **8/8** | `08-player.log`、`player.json` |
| Parity 16 | spec + `c3c-rendered-headless-parity.mts` | PASS 16/16 `finalTick=26 events=59 kills=1 lootLeft=0 currency=4 xp=8` | `09`/`10` |
| Parity 负向 | 禁用 8 个 fire 步 | 7 FAIL；恢复后 PASS | `11-parity-tamper.log` |
| C2 回归 | resume-no-step + economy storage | PASS 4/4 | `12-resume-storage.log` |

## 2. canonical 键序 / ref / file（上轮 sameState=false 复现与修复验证）

- `dev_snapshot` 返回 **ref**（无 inline frame），同时给 `stateFingerprint`；与 `dev_state` 一致。
- 用 **ref 跨新 session restore**：epoch 1→2，`stateFingerprint` 与快照完全相同。
- 原会话与 restore 会话执行**同一动作序列**（20 down + 15 right）：
  - `stateFingerprint`：`fnv1a32:d37e4aec` = `fnv1a32:d37e4aec`；
  - `eventsFingerprint`：`fnv1a32:86706da1` = `fnv1a32:86706da1`。
- `dev_replay(ref, steps)`：`sameState=true, sameEvents=true, historyPreserved=true, firstDivergence=null` —— 上轮 `sameState=false`（player.data 键序 char 174 差异）**已修复**。
- `frame_export` 写到 `reports/ai-native-02/c3c/frames/`（owner-only path，不 inline）；`restore_file` 新 session：epoch+1、state hash 一致；`replay_file`：sameState/sameEvents 均 true。
- **篡改真实 payload**：
  - 事件 index 7 的真实值（position/stateTimer）→ `historyPreserved=false, firstDivergence=7`；
  - 只改 `sim.player.data.hp` 的真实值 → `sameState=false`（事件不变，诚实报告）。
- **ref 淘汰**：FRAME_REF_MAX=2；连续 3 次 snapshot 后第一个 ref → `E_SNAPSHOT_INVALID`，最新 ref 正常 restore。
- **文件越界**：`failures/x.json`、`package.json`、`frames/../../failures/x.json`、`D:/Windows/win.ini` 全部 `E_PERMISSION`；合法 frames 路径正常。所有写入只落在快照的报告目录。

## 3. 真 stdio >20k 事件（不是只看 tick）

- 80 次 × 300 tick（24,000 tick）后 **eventTotal = 25,840**，连接保持；**单次响应最大 17,484 字节**（不再多 MB）。
- `events_summary`：`eventsRetained=20000, windowStart=5840, eventsTruncated=true, eventTotal=25840`（准确）。
- `events` 分页：
  - 请求 offset=0 → 返回 `offset=5840, lostPrefix=5840`（明确丢失前缀）；
  - 40 页共 **20,000** 条 = retained；末页 `nextCursor=null`；单页最大 **129,725 字节**（有界）。
- 该状态 `snapshot`：返回 ref，`frameBytes=5,992,352`、`eventsTruncated=true`，**响应仅 330 字节**；`restore(ref)` 成功（epoch 2）。
- `frame_export`：文件 5,992,352 字节；`restore_file` 成功（epoch 2）——大帧不再直接导致退出。
- `export_failure`：`boundary=action` 但 **`replayable=false`、`eventsTruncated=true`**，note=`HISTORY TRUNCATED (eventTotal > retained events): the retained window alone is not a full reproduction and cannot be claimed replayable` —— 不假报可复现。
- 结束前 `world_list_sessions` 正常，stdio 未断。
- 20k 事件窗按设计只保留 20,000 条；paging 显式报告 `windowStart/lostPrefix/truncated`，export 因截断而不可 replay，语义正确。

## 4. Player / Dev 权限（首片后台最小）

- Player 工具仍只有：`world_headless_create_session / list_sessions / observe / action / step / close / signal_status`；**无任何 `dev_*`、ref/file 工具**。
- `step` schema 只有 `session/epoch/requestId/ticks`；合法 `intent` 直调 → `MCP -32602 Unrecognized key "intent"`；tick/quota/队列不变；300 次拒绝后 step 仍只执行队列 action 一次；cached replay text/structured 无 canonical。
- Dev 面才拥有 ref/file/paging/export/replay 等 owner 能力，且文件写入被限制在 `reports/ai-native-02/c3c/frames|failures`。
- **判定：首片后台最小 Dev/Player 权限（Player 无 owner 通道/无 seed/fixture/无 ref/file；Dev owner-only）满足。** 但这只是权限面；Signal 未实现、真实 LLM 未跑，不能推成完整 P4/P2。

## 5. 判定

| 项 | 判定 |
| --- | --- |
| canonical 键序（原 sameState=false） | **已修复**（跨 session 同动作 state/events hash 一致；replay same） |
| ref/file 跨 session / 篡改负向 | **PASS**（篡改 payload firstDivergence=7；篡改 state sameState=false） |
| >20k 事件 stdio | **PASS**（25,840 events；max response 17,484B；连接不断） |
| paging / summary / 丢 prefix | **PASS**（retained 20,000、windowStart 5,840、lostPrefix 5,840、40 页） |
| snapshot ref→file→restore | **PASS**（5.99MB 帧，ref 330B 响应；file restore 成功） |
| export 截断语义 | **PASS**（replayable=false + 准确 note） |
| ref 淘汰 / 路径越界 | **PASS**（旧 ref E_SNAPSHOT_INVALID；4 类越界 E_PERMISSION） |
| Player 权限隔离 | **PASS**（无 intent/canonical/dev/ref/file） |
| parity 16 / C2 定向 / 门禁 | PASS |
| **首片后台最小 Dev/Player 权限** | **满足**（仅权限面） |
| **P4 / AI-NATIVE-02 整体** | **不 PASS**：Signal Combat 仍 `E_NOT_APPLICABLE`（未实现）；真实 LLM 实跑未做；20k 事件窗按设计截断（有明确 loss/不可 replay 语义，不是无提示丢失） |
| 全 Run 声明 | 不声称 |

## 6. 复现

```bash
cd D:/Project/AI-NATIVE-02-snapshots/87d6ae0
npx tsc --noEmit && npm test
npx vite build --config vite.mcp.config.ts
npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts
npx vite-node src/ai-native/worldHeadless20kSmoke.mts
node .../probe-transport.mjs
node .../probe-player.mjs
PORT=5351 npx playwright test tests/c3c-headless-parity.spec.ts
npx vite-node scripts/c3c-rendered-headless-parity.mts
PORT=5351 npx playwright test tests/resume-no-step.spec.ts tests/economy.spec.ts --grep "resume|storage"
```

## 7. 文件

`reports/ai-native-02/tester/c3c-transport-final/`：`00-frozen-hashes.log`、`01–06` 门禁/smoke、`07` transport 27/27、`08` Player 8/8、`09–11` parity/负向、`12` C2、`13-evidence-md5.log`、`dev.json`、`player.json`、`initial/sequence/rendered.json`、`probe-*.mjs`。
