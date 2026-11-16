# AI-NATIVE-02 / C3-b — 人类显式授权的 ExternalLink + 官方 `--world` MCP

分支 `feat/ai-native-world-integration`。本报告只描述**真实实现与真实验证**，不把本地 demo、Playwright 脚本或 MCP 接口探针冒充成「真实 LLM 战斗」。

## 1. 交付内容

### 1.1 人类显式授权（游戏内）
- `PauseScene` 的 **AUTHORIZE EXTERNAL AGENT** 是唯一创建外部会话的入口；只有真人点击才会调用 `GameScene.authorizeExternalAgent(bridgeUrl, token)`。
- 桥接地址/token 由宿主页面通过 `globalThis.__externalLinkConfig` 注入，不写死在场景里、不进日志、不进截图。
- `ExternalLinkState.authorize(false)` 返回 `E_PERMISSION`；AI/MCP 侧只有 `/world-link/attach`（附加到已存在会话），**不能自己建会话**。
- 未连接时 HUD/Pause 显示 `EXTERNAL NOT CONNECTED`。

### 1.2 F-03 生产构建移除 `__game`
- `vite.config.ts` 定义编译期常量 `__LAST_SIGNAL_DEV_TEST__ = (mode !== 'production')`。
- `src/main.ts` 用该常量包裹 `window.__game = game`；生产构建（`npm run build`）把条件与赋值一起消除。
- dev server 与 `npm run build:test`（`--mode test`，供冻结 E2E 证据用）保留句柄。
- `World.assertDevTest()` / `stepSimulationTicksForTest()` 也改用同一常量，生产构建无法开启测试入口。
- `scripts/c3b-f03-gate.mts` 真实起 HTTP 服务 + 真浏览器检查两个产物：`F03_PRODUCTION_GATE_PASS`。

### 1.3 官方 `--world` MCP Player 工具
- `node dist-mcp/mcpServer.mjs --world` → 注册 `world_list_sessions` / `world_observe` / `world_action` / `world_close`。
- 不带 `--world` 的默认进程与 C3-a/P3 完全一致（StationZero 兼容）：无 world 工具、无桥接。
- 另有 **无 core 导入** 的独立二进制 `dist-mcp/worldMcpServer.mjs`（`vite.mcp.config.ts` 双入口）。`grep stepFrame|processCommands|MapGenerator` 在该产物中为 0。
- MCP 侧只有 `WorldClient`（`src/ai-native/worldClient.ts`）：不 import core、不 `stepFrame`、不写 Scene；渲染中的浏览器是唯一 SimulationState。

### 1.4 127.0.0.1 桥接（保留 C3-a 契约）
- 原 `/world-link/handshake`（精确 Origin + token + 一次性会话）不变；重复握手仍 409。
- 新增 agent 侧路由（token-only 本地进程；带 Origin 时仍精确匹配）：
  - `POST /world-link/attach`：附加到真人已授权的**唯一存活**会话；无会话 → 403 `world.authorization_required`。
  - `GET /world-link/observation`：读最新 post-commit、感知裁剪的观察。
  - `POST /world-link/action-submit`：转发 `WorldGateway.submitActions`，队列化、幂等、TTL、硬配额。
  - `POST /world-link/agent-disconnect`：agent 断开 → 关闭会话 + 取消 pending，渲染侧心跳失败后降级为 HUMAN。
- token 只在 `Authorization: Bearer` 头里，不在 URL/query/日志/截图中。

### 1.5 唯一提交边界与真实 ACK
- `World.enqueueExternalIntent()` 只入队 `PlayerIntent`；`Player.resolveIntent()` 在 `owner==='external'` 时调用 `takeExternalIntent()`，由既有 `core.processCommands` 在真实 tick 提交。
- `ExternalLinkController.afterFrame()` 仅当 `world.sim.tick > issuedAtTick` 才 `commitExternalIntent(actionId, realTick)` 并 ACK `applied` + 真实 `appliedTick`；否则 `rejected E_STALE_TICK`。
- `status=queued` 永远不等于 applied；HUD 的 LAST 动作来自 `control.noteExternalAction(action, appliedTick)`。
- 观察只含 `visibilityBasis` 感知到的 actors、sim projectiles、玩家合法字段；无全图/seed/RNG/隐藏目标。schema 追加不破坏既有协议字段。

### 1.6 控制态与取消路径
- `ControlOwner = human | ai | external`，`ControlMode = HUMAN | AI | EXTERNAL | PAUSED`；`controllerLabel` 区分 `LOCAL DETERMINISTIC` / `EXTERNAL AGENT`。
- 真人接管 / 暂停 / 升级 / 背包 / 死亡 / 场景退出 / 断开 / EOF / SIGINT / 心跳丢失 → `degrade()`：取消全部 pending intent（receipt=cancelled）、epoch +1、状态 YIELDED/LOST、`disableExternal()`、关闭桥接会话。
- **不会自动重新接管**；必须真人再次点击 AUTHORIZE（新会话）。`c3b-external-link.spec.ts` 第二条用例验证。
- UI 点击（AUTHORIZE / EQUIP / 菜单按钮）走 `pointerDownOnUi`，不会被当成 fire / takeover。
- `void externalLink.beforeFrame()/afterFrame()` 不 await，外部 pending 不阻塞主线程。

### 1.7 恢复不强制 tick
- `GameScene.onResume()` / `onLevelUpClosed()` 保持 C2 修复：不调用 `stepFrame`。外部 intent 只在真实 `update(delta)` 累计到完整 tick 时提交。

## 2. 运行方式（Lead 逐回合 observe → 选动作 → 战斗）

> 以下是**接口与操作工具**，不是预写策略；真实 LLM 战斗由 Lead 后续自己驱动。

### 步骤 0：前置
```bash
npm install
npm run dev                       # 终端 A：http://localhost:5173（dev，保留 __game）
npm run game:mcp:build             # 生成 dist-mcp/mcpServer.mjs + worldMcpServer.mjs
```

### 步骤 1：启动桥接（token 不外泄）
```bash
npm run game:world:bridge          # 终端 B
# 只打印 BRIDGE_URL / ORIGIN / TOKEN_FILE；打印 TOKEN=<redacted>
# token 写入 reports/ai-native-02/c3b/.bridge-token（0600，已 gitignore）
```
也可用固定端口：`LAST_SIGNAL_WORLD_PORT=8787 npm run game:world:bridge`。

### 步骤 2：真人（在浏览器里）显式授权
在终端 A 打开的页面控制台注入（**不要把 token 贴到聊天/日志/截图**）：
```js
window.__externalLinkConfig = {
  bridgeUrl: '<终端 B 打印的 BRIDGE_URL>',
  token: '<从 TOKEN_FILE 读取的值>'
};
```
然后：**NEW RUN → ESC 打开暂停菜单 → 点击 AUTHORIZE EXTERNAL AGENT**（菜单显示 `EXTERNAL AGENT CONNECTED`）→ ESC 返回游戏。此时 `CONTROL EXTERNAL`。

### 步骤 3：启动官方 `--world` MCP（给 Agent 用）
```bash
LAST_SIGNAL_WORLD_BRIDGE_URL='<BRIDGE_URL>' \
LAST_SIGNAL_WORLD_TOKEN_FILE=reports/ai-native-02/c3b/.bridge-token \
node dist-mcp/worldMcpServer.mjs
# 等价的 flag 形式（默认二进制）：
LAST_SIGNAL_WORLD_BRIDGE_URL='<BRIDGE_URL>' \
LAST_SIGNAL_WORLD_TOKEN_FILE=reports/ai-native-02/c3b/.bridge-token \
node dist-mcp/mcpServer.mjs --world
```
MCP 工具：`world_list_sessions` → `world_observe` → `world_action({requestId, actions, ttlTicks})` → `world_close`。
`requestId` 必须 `req_<24hex>`，`actionId` 必须 `aid_<24hex>`。动作类型：`move/stop/aim/fire/interact`。

### 步骤 4：最小操作控制台（可逐回合手工驱动）
```bash
LAST_SIGNAL_WORLD_BRIDGE_URL='<BRIDGE_URL>' \
LAST_SIGNAL_WORLD_TOKEN_FILE=reports/ai-native-02/c3b/.bridge-token \
npm run game:world:console
```
```
observe                 # 打印真实 post-commit tick / HP / 感知到的敌人
move 1 0 10             # 只是 queued，不是 applied
observe                 # 看到新 tick 才是真的提交
fire 7 5 10
close                   # 断开，渲染侧回到 HUMAN
```
`world_action` 回执里 `status=queued` **不是** applied；真实 ACK 的 `appliedTick` 只能在渲染侧 core 提交后产生。

### 凭据安全
- token 由 `scripts/c3b-bridge.mts` 本地生成并写入 0600 文件；进程只打印路径与 URL。
- MCP 与控制台支持 `LAST_SIGNAL_WORLD_TOKEN_FILE`，从文件读取，不进进程参数/日志。
- 宿主页面注入需要人工一次性粘贴；不写入任何源码、报告或截图。

## 3. 验证结果

全部日志在 `reports/ai-native-02/c3b/logs/`；汇总 `gate.log` 每行 `PASS|FAIL + 命令 + 结果 + 路径`。

| 项 | 结果 |
| --- | --- |
| typecheck | PASS |
| unit | 29 files / **454 tests** PASS |
| `npm run build` / `npm run build:test` | PASS |
| `npm run game:mcp:build`（双入口） | PASS |
| default MCP client smoke（StationZero） | PASS（见下方 flake 说明） |
| `--world` MCP smoke（worldMcpServer + flag 形式 + 默认面隔离） | PASS |
| `--world` MCP 真实桥接集成 list→observe→action→close | PASS（两个二进制各一次） |
| F-03 生产无句柄 / test 模式保留句柄 | PASS `F03_PRODUCTION_GATE_PASS` |
| C2 parity（room 220 seed / node / kill / loot） | PASS |
| 全量 E2E（含五视口 1920/1366/1280/1024/800） | **55/55 PASS** |

新增回归：`src/ai-native/externalLink.test.ts`(11)、`c3bBridge.test.ts`(9)、`c3bControl.test.ts`(5)、`tests/c3b-external-link.spec.ts`(2 条真实浏览器↔桥接↔agent)。

**已知环境 flake**：`mcpClient.mts` 的 "advanced timeout" 段在机器高负载时偶发 `E_RETRYABLE another advanced action is already in flight`（`sessions.ts` 的 cancel 与后台 loop `finally` 之间的既有竞态，与本轮改动无关：用 `git show HEAD:vite.mcp.config.ts` 原配置同样复现）。随后连续 3 次独立冷启动全部 PASS，未改断言、未放宽 timeout、未改 C3-a 语义。

## 4. 限制与明确不做的事

- **C3-c Headless same-core / MCP 接真实 LLM 战斗 / 独立复核仍未做**；本轮没有跑过任何真实 LLM 回合。
- 没有 Signal tooling，标记为 unsupported；没有 ECHO 冒充、没有预写战斗策略、没有凭空发明玩法。
- `worldMcpServer.mjs` 与 `--world` 都只是 agent 侧的读/提交；不复制 core、不推进渲染、不写 Scene。
- 未 merge main、未 push、未恢复任何 stash（`stash@{0}` C3a extra tests / `stash@{1}` C3-b prep 均保持原样）。
- 未做平衡调整、未手工 flush、未改 C1 生成分布与 C2 存档契约。
