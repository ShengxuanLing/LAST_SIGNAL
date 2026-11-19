# C3-b 真实 Rendered MCP 接线 独立验收（冻结 8ec8758）— tester 补充证据

- **被测**：`8ec87587b0b4dba3146016e53bd6592ccb41be96`（父 `a25f140f4a412a025668b96518256e7cdfa4e557`），分支 `feat/ai-native-world-integration`
- **冻结**：`git archive 8ec8758` → `D:/Project/AI-NATIVE-02-snapshots/8ec8758`（`node_modules` junction），关键文件 MD5 见 `00-frozen-hashes.log`；未读 WIP / 未读 stash，未改源码/测试/配置/分支
  - 复核结束时活仓库 HEAD 仍为 `8ec8758`，但工作区存在开发者 C3c 修复 WIP（`src/ai-native/externalLink*.ts`、`tests/c3b-external-link.spec.ts` 等为 `M`）。**本轮全程未读取、未使用这些 WIP**，结论只对冻结快照负责。
- **端口**：dev 5299、prod 静态 5297、test 静态 5298、bridge 8787/8788（全部自启自停，收尾已确认 free）
- **凭据**：token 由 bridge 本地随机生成，写入仓库外临时目录 `D:/Project/AI-NATIVE-02-snapshots/.tokens/`；仅在 `Authorization` 头/内存中使用，不打印、不进 URL/进程参数/日志/截图（grep 全部日志 0 命中）。**Windows 上 `chmod 0600` 不退化为 POSIX mode（实际显示 `-rw-r--r--`），只能做到“独立临时目录 + 尽力 0600”**，这是平台限制，如实记录。
- **结论：C3-b 不能独立接受（FAIL）。** 与独立 Reviewer 一致；我另外用独立探针复现了全部 3 个阻断，并新增 2 项行为问题。C2 维持此前放行（本提交未触碰 C2 行为，回归见 §5）。本轮**不是真实 LLM/Agent 实跑**，只是脚本/接口级验证。

## 1. 质量门（命令 → 结果 → 日志）

| 项 | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| typecheck | `npx tsc --noEmit`（快照） | PASS exit=0 | `01-typecheck.log` |
| unit | `npm test`（快照） | PASS **29 files / 454 tests** | `02-unit.log` |
| 生产构建 | `npx vite build --outDir …/prod-dist` | PASS（20.77s） | `03-prod-build.log` |
| 测试构建 | `npx vite build --mode test --outDir …/test-dist` | PASS（19.30s） | `03b-test-build.log` |
| MCP 构建 | `npx vite build --config vite.mcp.config.ts` | PASS（`mcpServer.mjs` + `worldMcpServer.mjs`） | `03c-mcp-build.log` |
| F-03 双产物门禁 | Playwright 真浏览器 | PASS：prod `__game === undefined`、test 有 `__game`，两产物均无控制台错误 | `04-build-gate.log` |
| World MCP bundle 无 core | `grep createSimulationState\|stepSimulationTicks\|processCommands\|class World dist-mcp/worldMcpServer.mjs` | PASS 0 命中 | 见本报告 |
| StationZero 默认 MCP 兼容 | 官方 SDK client 连接 `dist-mcp/mcpServer.mjs`（不带 `--world`） | PASS 6 个 Player 工具；`game_create_session`（production kind）→ `game_observe` OK | `10-stationzero-default-mcp.log` |
| C3b 官方 E2E | `PORT=5299 npx playwright test tests/c3b-external-link.spec.ts --repeat-each=3/5` | 我 2 轮：**6/6、10/10 passed**；Reviewer 同样用例 **3/3 failed** | `11-c3b-e2e-repeat3.log`、`11b-c3b-e2e-repeat5.log` |
| P1 回归 + 五视口 | `PORT=5299 … tests/ai-native-world.spec.ts` | PASS **9/9**（含 5 视口）；已实际查看 `hud-ai-800x600.png` | `12-p1-5viewport.log`、`evidence-p1-5v/` |
| resume/storage 回归 | `PORT=5299 … tests/resume-no-step.spec.ts tests/economy.spec.ts --grep …` | PASS **4/4**（含 storage 失败重试） | `13-resume-storage.log` |
| 真实链路（生产构建） | 浏览器(5297) ↔ bridge(8787) ↔ 官方 MCP SDK client → `worldMcpServer.mjs` | 授权/观察/移动/aim/interact/暂停/接管/关闭 PASS；**SIGKILL 断线不降级 FAIL** | `06-prod-chain.log`、`prod-chain.json`、`evidence-prod/`（含录屏） |
| 阻断专项（测试构建） | 同上链路 + 仅用 `__game` 读回执/HUD | 3 阻断全部复现 | `08-blockers.log`、`blockers.json`、`evidence-blockers/` |
| 隐藏弹丸（单元级合成世界） | `npx vite-node probe-c3b-projection-leak.mts` | **LEAK_REPRODUCED** | `09-projection-leak.log` |

## 2. 阻断复现（独立证据）

### 阻断 1：`ticks` 被完全忽略（不是“少一点”，是 120 倍时长无效）

真实链路（生产构建，无 `__game` 读取；动作经 MCP `world_action`）：
- `move dir(1,0) ticks=1`：位移 **0.162045** 格；
- `move dir(-1,0) ticks=120`：位移 **0.162045** 格（**与 ticks=1 完全相同**）；
- 对照：24 个独立 `ticks=1` 动作（8/批 ×3，真实 24 个 core tick）→ 位移 **2.268634** 格。
- 若 `ticks=120` 被兑现，应约 **12–14 格**；实际只有约 **1.2 个 tick** 的移动，差 **~80–120 倍**。
- `fire ticks=1` 与 `fire ticks=120`：观测到的最大弹丸数均为 **2**，无持续时间差异。

代码面：`externalLinkController.intentFromExternalAction()` 只读 `type/dir/target`，**从不读 `ticks`**；`applyByTick` 来自批量 `ttlTicks`，与动作时长无关。`receipt.applied` 只说明“意图被某一 tick 收到”，**不能证明动作时长或效果**（与 Reviewer 限制 1 一致）。

### 阻断 2：`degrade()` 与 `afterFrame()` 异步竞态（可确定性复现 3/3）

用真实 controller + 真实 bridge client，在 `pushObservation` 的 await 窗口内触发人类 takeover（`degrade('takeover')`），并把 `heartbeatMs` 设为 0 让 await 后必然进入心跳分支：
- **3/3 复现** `TypeError: Cannot read properties of null (reading 'heartbeat')`，栈在 `dp.afterFrame`，同时产生未处理 Promise rejection（`console: REJECTION …`）；
- 每次 owner 变 `human`、link `YIELDED`，但异常已抛出。
- 说明：这是代码路径缺陷，不是“偶发测试噪音”。开发者 E2E 我这边 6/6、10/10 通过、Reviewer 3/3 失败，**结果依赖时序**，不能作为“稳定绿”依据。

### 阻断 3：Observation 的 `projectiles` 未做感知裁剪（隐藏弹丸泄漏）

单元级合成世界（明确声明为合成，不冒充渲染证据）：玩家位于 (8,45)、`perceivedActors=[]`、感知半径 12 格，核心中放入 1 格处玩家弹丸与 **60 格处敌方弹丸**：
- `observation()` 返回 **两个** 弹丸，`far_60_tiles` 被包含（`leak: true`）；
- 代码：`projectiles: world.sim.projectiles.map(...)` 无过滤，而 `drones/targets` 用 `perceivedActors` 过滤。
- 影响：Agent 可从弹丸位置/速度推断未见区域敌人/Boss，违反“观察裁剪”。

## 3. 真实链路行为（生产构建，无 `__game`）

按顺序（`prod-chain.json`，录屏 `evidence-prod/video/`）：
- **授权前**：`world_list_sessions` / `world_observe` / `world_action` 全部 `E_PERMISSION`；agent 自授权（token + `authorized:true`，无浏览器 Origin）→ **403**；token 不在 DOM。
- **人类在真实 Pause 菜单点击 AUTHORIZE** 后，agent 才能 attach；`observation` 携带真实 post-commit tick（149），键仅 `schema/protocolVersion/epoch/tick/roomId/player/drones/projectiles/availableActions`，**无 seed/map/rooms/rng**。
- **move**：批量 8 个动作 accepted `queued`，随后观察 x 8 → 8.401（真实位移）；**aim** 后 `aimYaw` 改变（−2.356 → 0.785 量级）；**interact** accepted。
- **暂停**：提交 pending 后按 ESC → 旧会话 `E_SESSION_NOT_FOUND`、新 agent attach 被拒；resume 后仍拒绝（**无自动夺回**）。
- **人类按键接管**：旧会话失效、agent 观察失败。
- **agent 主动 `world_close`**：ACK `ok`，1–2s 内渲染侧降级、新 attach 被拒。
- **SIGKILL agent 进程（硬断线）**：8 秒内 owner **仍是 external、link 仍 CONNECTED**，没有心跳丢失降级（F-hard-disconnect）。开发者“EOF/SIGINT/心跳丢失 → 降级”只对软关闭成立。
- **附加发现（F-stale-list）**：同一 MCP 进程在会话死亡后，`world_list_sessions` 仍返回 `attached:true`（缓存 sessionId），只有 `world_observe` 报 `E_SESSION_NOT_FOUND`；agent 无法从 list 判断链路已死，也没有自动 re-attach。

## 4. 实际效果 vs ACK（不以 applied tick 代替效果）

- 真实位移：有（生产构建观测；单 tick 约 0.115 格）。
- 真实弹丸：有（测试构建 fire 后 `projectiles` 峰值 2；生产构建观察链路上 fire 未能在首房间找到敌人，故未取得机伤证据）。
- **真实伤害：本轮未取得独立证据**。在测试构建进入敌房后对感知目标连续 fire/kite，未观察到 drone HP 下降（同时玩家可能被击杀/场景结束），不能据此声称“已验证伤害”。这一点如实记录，不用 `applied` 顶替。
- 因此 ACK 语义应表述为“意图已投递并在某 tick 被消费”，**不是**“位移/弹丸/伤害已发生”。

## 5. 五视口与回归

- 五视口 HUD（测试构建，P1 用例产出）：`evidence-p1-5v/hud-ai-{1920x1080,1366x768,1280x720,1024x768,800x600}.png`；已实际查看 **800×600**：控制行 4 行、右上状态、底部提示均完整可读，无裁切/重叠。
- 生产构建五视口菜单截图：`evidence-prod-5v/menu-*.png`（无 `__game`，仅视觉证据）。
- P1 9/9、resume/storage 4/4 通过；C2 行为未回归，维持放行。

## 6. 可用性与限制（真实连接操作）

- **可用**：一个能注入宿主配置的人类，可以完成 NEW RUN → ESC → AUTHORIZE → ESC，之后官方 `--world` MCP（或真实 MCP 客户端）即可 observe/action/close。生产构建确实移除了 `__game`，agent 侧无 SimulationState。
- **当前限制（应写入文档）**：授权所需的 `bridgeUrl`、`token` **只能通过页面控制台/宿主页注入 `window.__externalLinkConfig`**，UI 没有输入框；普通玩家无法自行完成配置。这就是“目前需要 console 配置”的实际可用性限制。
- 其他限制：token-only 信任模型（任何持 token 的本地进程可 attach 唯一 live 会话，无 per-agent 身份/审计）；`mode !== 'production'` 的任意部署都会暴露 `__game`（staging/test 必须强制 production）；没有真实 LLM/Headless 实跑。
- **断线 Owner 行为**：软关闭（`world_close`/MCP stdin EOF/SIGINT）→ 渲染侧降级 HUMAN、需人类重新点击授权；**硬杀进程 → 保持 EXTERNAL/CONNECTED（缺陷）**，人类输入仍可接管，但没有自动降级。

## 7. 判定

| 项 | 判定 |
| --- | --- |
| C3-b 独立接受 | **FAIL / 不能接受**（3 阻断全部独立复现；另有 2 项行为问题） |
| 阻断 1 `ticks` | 未修复，已复现（1 vs 120 位移相同；24 真实 tick 才对 2.27 格） |
| 阻断 2 async race | 未修复，已确定性复现 3/3（heartbeat null）；E2E 时序相关，非稳定绿 |
| 阻断 3 弹丸泄漏 | 未修复，已复现（60 格外敌弹丸进入 observation） |
| F-hard-disconnect / F-stale-list | 新发现，建议同轮修复（硬断线不降级；list 缓存误导） |
| C2 | 维持放行（回归 4/4、P1 9/9；本提交未改 C2 行为） |
| 真实 LLM/Agent | **仍不能宣称接入完成**；修复阻断后需真实 MCP 客户端 + 原始调用归档再验收 |

## 8. 复现命令（全部对冻结快照）

```bash
cd D:/Project/AI-NATIVE-02-snapshots/8ec8758
npx tsc --noEmit && npm test
npx vite build --outDir .../c3b-final/prod-dist
npx vite build --mode test --outDir .../c3b-final/test-dist
npx vite build --config vite.mcp.config.ts
npx vite-node probe-c3b-projection-leak.mts          # LEAK_REPRODUCED
# 静态服务 5297/5298、dev 5299；bridge 8787(prod)/8788(test)
node .../probe-c3b-prod.mjs        # 生产真实链路（无 __game）
node .../probe-c3b-blockers.mjs    # ticks / race / hard-disconnect
PORT=5299 npx playwright test tests/c3b-external-link.spec.ts --repeat-each=5
PORT=5299 npx playwright test tests/ai-native-world.spec.ts
```

## 9. 报告文件

`reports/ai-native-02/tester/c3b-final/`：`00-frozen-hashes.log`、`01–04` 门禁、`05*–06` bridge/生产链路、`08-blockers.log`+`blockers.json`、`09-projection-leak.log`、`10` StationZero、`11*` E2E、`12` 五视口、`13` 回归、`prod-chain.json`、`test-chain.json`、`probe-*.mjs`、`probe-c3b-projection-leak.mts`（快照内）、`evidence-prod/`（含 webm 录屏）、`evidence-test/`、`evidence-blockers/`、`evidence-p1-5v/`、`evidence-prod-5v/`。
