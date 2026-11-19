# C3-c 同核心 Headless MCP / P4 最低 Harness — 独立验收（冻结 82734f6）

- **被测**：`82734f639b5efa6683fd0ac046fa10ac93d9516a`（父 `122cafef865d4e7e6b8d93fcfe18fbdc1ab4962b`，祖父 `da7c169`），分支 `feat/ai-native-world-integration`
- **冻结**：`git archive 82734f6` → `D:/Project/AI-NATIVE-02-snapshots/82734f6`（`node_modules` junction），关键文件 MD5 见 `00-frozen-hashes.log`；未读共享 WIP / 未读 stash，未改源码/测试/配置/分支
  - 复核结束时活仓库 HEAD 已推进到 `9e67d0`，并出现新的 WIP（`externalLink.ts`、`worldHeadlessMcpTools.ts` 修改、`actionExecution.ts` 等）；**本轮未读取/未使用**，结论只对 `82734f6` 快照负责。
- **结论：Headless 同核心/Dev harness/Parity 主体能力 PASS；但 Player 权限面存在硬阻断，P4 不能 PASS，首片后台 MCP 测试尚不达标。**
  - Lead 已亲自用官方 MCP（非 Dev）完成 create→observe→fire120→step→cleared→close 的执行事实（`reports/ai-native-02/lead-headless/`）保留；但该路径的原始 Player 结果包含 Owner 状态，权限面不成立。

## 1. 质量门（命令 → 结果 → 日志）

| 项 | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| typecheck | `npx tsc --noEmit`（快照） | PASS exit=0 | `01-typecheck.log` |
| unit | `npm test`（快照） | 首跑 **1 failed / 521 passed**（`worldBridgeServer.test.ts` 心跳用例，期望 409 收到 200）；单文件重跑 **7/7 PASS**；整跑复跑 **522/522 PASS**（flaky，非稳定失败） | `02-unit.log`、`02b-unit-bridge-retest.log`、`02c-unit-rerun.log` |
| build | `npx vite build` / `--mode test` | PASS | `03-prod-build.log`、`03b-test-build.log` |
| MCP build | `npx vite build --config vite.mcp.config.ts` | PASS（`mcpServer.mjs` / `worldMcpServer.mjs` / `worldHeadlessMcpServer.mjs`） | `03c-mcp-build.log` |
| Headless smoke（官方 Player+Dev） | `npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts` | PASS `HEADLESS_MCP_SMOKE_PASS` | `04-headless-smoke.log` |
| Player surface（官方 SDK，无浏览器） | `node probe-headless-player.mjs` | 15 项中 10 PASS / 4 FAIL（全部为真实缺陷，见 §3）+ 1 项已知 | `05-player.log`、`player.json` |
| Dev harness（官方 SDK，无浏览器） | `node probe-headless-dev.mjs` | PASS **17/17** | `06-dev.log`、`dev.json` |
| Rendered parity（官方 spec） | `PORT=5312 npx playwright test tests/c3c-headless-parity.spec.ts` + `vite-node scripts/c3c-rendered-headless-parity.mts` | PASS 8/8 `finalTick=64 events=126` | `07-parity-export.log`、`08-parity-compare.log` |
| Rendered parity（我重生，含 kill+loot） | 自写导出 + same-core 重放 | PASS 10/10 `tick=197 events=216`，`enemy-died`+`loot-collected`；篡改动作后 state/events 均背离，首个事件分歧 index=1 | `09-parity-kill-export.log`、`10-parity-kill-compare.log`、`parity-kill/` |
| Task0 桥接回收 + 硬断线 | `PORT=5312 … tests/c3c-bridge-reclaim.spec.ts tests/c3b-hard-disconnect.spec.ts` | PASS 3/3（reload→LOST→新授权成功、新 session；SIGKILL 降级） | `11-reclaim-hardkill.log` |
| C3b 回归（含 stop 抢占） | `PORT=5312 … tests/c3b-external-link.spec.ts --repeat-each=2` | PASS **18/18**（含 “queued stop preempts ACTIVE long action”） | `12-external-link-repeat.log` |
| 五视口 | `PORT=5312 … tests/ai-native-world.spec.ts` | 8/9；`ai-native-world:257` 失败于 `PauseScene open` 期望、收到 `GameOverScene`（已知随机死亡 flake，本轮复跑仍失败，未追绿） | `13-p1-5viewport.log`、`13b-p1-rerun.log` |
| C2 回归 | resume-no-step 3 + economy storage 重试 1 | PASS 4/4 | `14-resume-storage.log` |
| StationZero 默认 MCP | 官方 SDK 连 `dist-mcp/mcpServer.mjs`（无 flag） | PASS 6 Player 工具 + production create/observe | `15-stationzero-default.log` |
| Player 负向 schema | `probe-player-negative.mjs` | PASS 5/5（seed/HP/dev tool 均被拒） | `16-player-negative.log` |
| 部分时长复核 | `probe-partial-trace.mjs` | 确认 120-tick 动作在 10-tick step 后 `applied`，后续 110 tick 不再出现在 `applied` | `17-partial-trace.log` |

## 2. Player 面真实流程（官方 MCP SDK，无浏览器）

- create（服务端 seed）→ observe（perception 裁剪，无 seed/map/rng）→ 真实 drone 可见。
- **hit**：fire（action）→ step 120 → 观察 drone **HP 27 → 0**，status `cleared`（tick 130）。
- **encounter finish**：清场后再 `world_headless_step` → `E_NOT_APPLICABLE`（非 Dev 拒绝推进）。
- **collision**：step 带 move intent 顶到墙后位置停止（400 tick 内不再移动）。
- **death**：真实 drone 攻击下 **tick 2480 / HP 0 / status dead**。
- **close**：close 成功，之后 observe → `E_SESSION_NOT_FOUND`。
- **权限负向**：Player create 不接受 seed；`world_headless_step` 不接受 seed/HP 字段；`world_action` 不接受 HP 字段；Dev 工具不存在（`Tool not found`）。

## 3. 阻断 / 发现（Player 面）

### F1（硬阻断）Player 原始 step 结果泄漏 Owner canonical state/events
- `world_headless_step`（非 Dev）的 **text 与 structuredContent** 均含 `canonicalState` / `canonicalEvents`（本次 canonicalState 1460 bytes、canonicalEvents 3754 bytes），另有 `observation`。
- 这正是 Lead 已发现的硬阻断；REPL 隐藏显示并不能改变 SDK/JSONL 可见性。**P4 权限不能 PASS**。
- 修复方向：Player 结果只返回法律 observation + receipt/status；canonical 仅 Dev。

### F2（阻断）`world_headless_step` 的 `intent` 可绕过 action/TTL/幂等直接控制 Player
- 未提交任何 `world_action`，仅 `step(ticks=30, intent.move)` → 玩家真实位移 **1.9755 格**（`applied=[]`）。
- 该通道不受 action requestId/actionId 去重、TTL、`applyByTick` 约束，也不产生 action 日志；与“Player 只能通过合法 action 队列”不一致。

### F3（阻断）动作请求 ticks=120 但 step=10：提前 ACK，剩余 110 tick 丢失
- 提交 `move ticks=120` → `step(10)`：`applied:[{startedTick:0, appliedTick:10, executedTicks:10}]`。
- 后续 `step(60)`、`step(60)` 的 `applied=[]`，动作不再续；位置仅在下一步有 0.375 格的位置修正（非动作再执行）。
- 对照 rendered 面已修复的 duration 语义，headless step 仍把“部分执行”标成 applied。

### F4（阻断）stepCache 128 淘汰后，同一 requestId 会再次推进
- 同一 requestId 首次 `0→1`；立即重放 `replayed:true` 且不推进（正确）。
- 再执行 130 个不同 step（每步 1 tick）后，重放同一 requestId → `replayed:false`，**131→132 再次推进**（幂等被绕过）；长会话必然触发。

### 其他
- F5（观察项）：Player 的 `world_headless_step` 结果同时含 `observation`（合法）与 canonical（非法），且 canonical 是字符串数组形式（`keys 0..N`）——SDK 客户端可直接解析。
- Player 负向 schema 全部 PASS（seed/HP/dev 工具拒绝），说明阻断不是 schema 漏检，而是 step 返回值与 step intent 设计问题。

## 4. Dev harness（官方 SDK，`--dev`）

- create（显式 seed 424242）→ snapshot（frame）→ step 20 → restore：tick 回 0、**epoch 1→2**（原子递增）。
- replay：先在活会话用同一序列推进到同态，再 `dev_replay(frame, steps)` → `sameState=true, sameEvents=true, firstDivergence=null`；篡改一个 intent → `sameState=false, firstDivergence=46`。
- export_failure：自造失败 bundle，`bytes=989356`，文件存在；已复制到 `self-failure-bundle.json`（MD5 `cf8029d7c053054656c58cf0aa0762f1`），含 `frame/actionLog/tailEvents/observation/atTick`。
- load_room（room 2 + drone/hunter）、spawn_enemies（hunter/sentinel）均 OK。
- batch（seeds 11/22/33）：全部 `cleared`, ticks 25, kills 1；compare：`hold` vs `seek-and-fire` 明确标注 deterministic baselines（不是 AI/不是 Signal）。
- perf（真实战斗，清场用真实波次续场）：
  - 1000×10：wall **5084.54ms**，cpuUser **4750ms**，cpuSys 453ms，events **30340**，liveCombatTicks **9200**，kills 320。
  - 10000×10：wall **14680.07ms**，cpuUser 7454ms，cpuSys 2375ms，heap 增量 **110,555,256 B**，events **304610**，liveCombatTicks **91900/100000**，kills 3230。
  - 全部会话清理后 `world_list_sessions=[]`，旧 session inspect → 拒绝；无残留会话。

## 5. Rendered ↔ Headless parity

- 官方 spec 重生：PASS 8/8，`finalTick=64`、`events=126`（开发者报告 63/126；本轮运行是 64，属同流程不同首帧，不影响逐项比较）。
- 我的独立重生（真实 drone，含击杀与掉落）：事件含 `enemy-died`、`loot-dropped`、`loot-collected`、`currency-gained`；headless `fromSimulationState` 重放 10/10 PASS：state/events/tick/drones/projectiles 全等（`tick=197 events=216`）。
- 负向：改动第 2 段 intent 后，state/events 均不相等，首个事件分歧 **index=1**；不是“只看最终 tick”通关。

## 6. 判定

| 项 | 判定 |
| --- | --- |
| Headless 同核心（create/observe/action/step/collision/hit/death/finish） | 功能 PASS（真实 core，真实 drone） |
| Player 权限边界 | **FAIL**：F1 canonical 泄漏、F2 step-intent 绕过、F3 提前 ACK、F4 缓存淘汰重放 |
| Dev harness（snapshot/restore/replay/export/batch/compare/perf/load/spawn） | PASS（17/17；篡改分歧 46；清理 OK） |
| 10×1000 / 10×10000 真实战斗 perf | PASS（数值见 §4；未做长压测/内存剖析） |
| Rendered parity（含 kill/loot） | PASS；负向篡改失败 |
| Task0（stop 抢占、reload LOST 回收、hardkill 降级） | PASS（定向 E2E 3/3、C3b 18/18 含 stop 抢占） |
| 五视口 / C2 | 五视口 8/9（已知 flake 本轮仍现，未追绿）；C2 4/4 |
| **P4（权限/后台 MCP 首片）** | **不 PASS**：Player 原始输出含 Owner canonical；F2/F3/F4 未修 |
| **首片后台 MCP 测试是否达标** | **不达标**：执行链路可用，但权限/幂等/时长语义不足以作为可信后台测试面；修复 F1–F4 后需重验 |
| 真实 LLM / Agent | 未跑；Lead 的真实单 drone 执行事实保留，但不能掩盖 Player 输出泄漏 |
| P3 | 仅 scope，未实施 |

## 7. 复现

```bash
cd D:/Project/AI-NATIVE-02-snapshots/82734f6
npx tsc --noEmit && npm test
npx vite build && npx vite build --mode test
npx vite build --config vite.mcp.config.ts
npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts
node .../probe-headless-player.mjs            # F1–F4 复现
node .../probe-headless-dev.mjs               # 17/17
node .../probe-player-negative.mjs            # 负向 schema
npx vite-node probe-kill-parity-compare.mts   # kill+loot parity + tamper
PORT=5312 npx playwright test tests/c3c-headless-parity.spec.ts
npx vite-node scripts/c3c-rendered-headless-parity.mts
PORT=5312 npx playwright test tests/c3c-bridge-reclaim.spec.ts tests/c3b-hard-disconnect.spec.ts
PORT=5312 npx playwright test tests/c3b-external-link.spec.ts --repeat-each=2
PORT=5312 npx playwright test tests/ai-native-world.spec.ts
PORT=5312 npx playwright test tests/resume-no-step.spec.ts tests/economy.spec.ts --grep "resume|storage"
```

## 8. 报告文件

`reports/ai-native-02/tester/c3c-final/`：`00-frozen-hashes.log`、`01–06`（门禁/Player/Dev）、`07–10`（parity 与 kill+loot parity）、`11–16`（Task0/回归/StationZero/负向）、`17-partial-trace.log`、`player.json`、`dev.json`、`self-failure-bundle.json`（含 MD5）、`parity-kill/`、`evidence-p1-5v/`、`probe-*.mjs`。
