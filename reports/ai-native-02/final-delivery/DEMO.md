# 三条用户演示最短操作（`d1f29d1`）

> 本文是给用户/验收者的最短操作，不是自动化脚本。所有端口用你自己的空闲端口；本轮验收示例用 **5411**，不要占用他人 5173/5199。

## 0. 一次性依赖

```powershell
cd D:\Project\LAST_SIGNAL
npm install                 # 若依赖已存在可跳过
npm run game:mcp:build      # dist-mcp/companionMcpServer.mjs / worldMcpServer.mjs / worldHeadlessMcpServer.mjs
```

需要 Node.js、Playwright Chromium（仅自动化验证需要）与官方 MCP SDK（仓库依赖已含）。

---

## A. 正式 World：AI 控制 / 人类接管

### 启动

```powershell
npm run dev -- --port 5411 --strictPort
# 浏览器打开 http://localhost:5411/
```

### 入口 / 按键

1. 主菜单点击 **NEW RUN**。
2. 按 `Escape` 打开暂停菜单。
3. 点击 **`AI CONTROL: OFF`** → 变为 **`ON · LOCAL DEMO`**；再按 `Escape` 返回游戏。
4. 人类随时用 `W/A/S/D`、`SPACE`、鼠标开火、`F` 交互即可接管；底部 HUD 显示 **`CONTROL AI · LOCAL DETERMINISTIC`** 或 **`CONTROL HUMAN`**，以及 **`EXTERNAL NOT CONNECTED`**（真实状态，不伪造连接）。
5. 暂停菜单可再次点击 `AI CONTROL: ON · LOCAL DEMO` 关闭本地 AI。

### 预期可见结果

- AI 在当前房间寻找敌人、移动、瞄准、开火、清理后走向传送门并交互。
- 人类按键立即夺回，AI 不再自抢；暂停/升级/死亡后所有权正确回收。
- 死亡会结束本局（`finishRun`，新的 R0），不是 checkpoint 续局。
- 没有外部模型参与；这是本地确定性控制器。

### 关闭

- 暂停菜单关闭 AI，或直接 `Ctrl+C` 结束 Vite。

---

## B. 同 core 的 Headless 官方 Player MCP

### 启动

```powershell
npm run game:mcp:build
# 直接跑官方 smoke（真实 stdio MCP；非 Dev 语义的 Player 路径）
npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts
```

若要自己接官方 SDK，启动服务端：

```powershell
node dist-mcp/worldHeadlessMcpServer.mjs
# 客户端用 @modelcontextprotocol/sdk 的 stdio Client 连接
```

### 入口 / 调用

1. `world_create`（或 smoke 内的 create）创建真实 Headless 会话。
2. `world_observe` 读取 Player 合法观察（无 seed/map/canonical/隐藏字段）。
3. `world_action` 提交 `fire`/`move` 等意图；**动作 target 必须来自观察**。
4. `world_step` 推进真实 tick；观察后续状态与 `world_close`。
5. 不传 `--dev`、不传 `intent` 绕过 action/TTL、不写 Scene。

### 预期可见结果

- `world_action` 返回 queued/accepted；后续 `world_observe`/`step` 能看到 projectile、命中、HP/击杀变化。
- Player 原始返回没有 `canonicalState`/`canonicalEvents`/`rngState`/`seed`/`map`；Dev 能力只在显式 `--dev`/Owner 权限下。
- 同一 core 规则与正式 World 一致（Rendered↔Headless canonical parity 已有独立门禁）。

### 关闭

- SDK `client.close()`，或 `Ctrl+C` 结束服务端。

---

## C. 真实 ECHO Companion + Signal opt-in / 授权 / 模型建议 / 独立 Owner 确认 / 开门

> **ownerKey 绝不给 Agent。** Agent 子进程只拿 bridge URL 与 token；Owner key 只由人类从本机私有文件读取并填进游戏表单。

### 启动（三个终端）

```powershell
# T1 前端（自有端口，示例 5411）
cd D:\Project\LAST_SIGNAL
npm run dev -- --port 5411 --strictPort

# T2 MCP 产物
npm run game:mcp:build

# T3 桥（只监听 loopback；打印路径，不打印 token/ownerKey 内容）
$env:LAST_SIGNAL_WORLD_ORIGIN="http://localhost:5411"
npm run game:world:bridge
# 记录打印：BRIDGE_URL / TOKEN_FILE / OWNER_KEY_FILE
```

### 游戏内人类操作

1. 主菜单 **NEW RUN**。
2. `Escape` → **SETTINGS** → 点击 **`SIGNAL COLLABORATION · OFF`** → 变为 **`ON`** → **BACK** → `Escape`。
3. `Escape` → **`ECHO COMPANION >`** → **`ENABLE ECHO`**。
4. 走进当前传送门进入下一个房间：真实房间进入后，`relay_main` 以 **`INACTIVE`** 出现，HUD 显示 `RELAY INACTIVE · EXIT CLOSED`（opt-in 之外普通 run 不生成设备）。
5. `Escape` → **`LLM COMPANION >`**：在原生表单中填
   - `BRIDGE URL` = 上面打印的 `BRIDGE_URL`
   - `TOKEN` = 人类读取 `TOKEN_FILE` 的内容
   - `OWNER PAIRING KEY` = 人类读取 `OWNER_KEY_FILE` 的内容（64 hex；一次性；**不交给 Agent**）
   点击 **`ENABLE / RE-AUTHORIZE (HUMAN)`**，直到显示 **`COMPANION CONNECTED`**。
6. 让模型/宿主通过官方 **`companionMcpServer`** 调用 `echo_observe`：
   - 应只看到 ECHO 合法感知（感知到的 relay、drone、自身 energy/cooldowns、objectiveBlocked），无 seed/map/RNG/隐藏状态。
7. 模型据观察提交 `echo_suggest`：
   - `scan`（reason `perceived_relay`/`objective_blocked`）→ 人类在 `LLM COMPANION >` 点击 **`CONFIRM FIRST PROPOSAL (OWNER)`**；
   - `toggle-relay`（reason `perceived_relay`/`objective_blocked`）→ 人类再次确认。
8. 暂停期间确认只入队，不早写；按 `Escape` 恢复后，下一个真实 core tick 提交。
9. 预期：ECHO 扫到设备并扣 ECHO 能量、evidence 增加；toggle 后 HUD **`RELAY ACTIVE · EXIT OPEN`**；人类走门进入下一个房间（真实 room 变化，不用 -1 过渡态冒充）。
10. 人类也可直接按 `T`（扫描）、`Y`（jam）、`R`（切换 Relay）操作自己的设备控制；`R` 在跨房后仍可控制留在旧房的设备（c233 全局控制，已恢复）。

### Agent 环境边界

- `companionMcpServer` 子进程环境只应有 `LAST_SIGNAL_WORLD_BRIDGE_URL` 与 `LAST_SIGNAL_WORLD_TOKEN` / `LAST_SIGNAL_WORLD_TOKEN_FILE`。
- **没有** ownerKey、ownerCap、confirm 工具；Agent 不能自确认、伪造 Origin、冒用 echo 或改 Owner 模式。
- Owner key 只存在于人类读取的本机私有文件与游戏表单内存；不写 URL/日志/截图。

### 预期可见结果

| 阶段 | HUD / 观察 |
|---|---|
| opt-in 后进入房间 | `RELAY INACTIVE · EXIT CLOSED`，设备真实 sprite |
| ECHO scan 确认并恢复 | ECHO 能量下降、evidence 增加；玩家能量不动 |
| ECHO toggle 确认并恢复 | `RELAY ACTIVE · EXIT OPEN`；manual=true |
| jam（人类 Y 或模型建议 + 确认） | `JAMMED`，不会 `ACTIVE`；到期恢复原规则 |
| 跨房人类 R | 旧房设备仍被控制（ACTIVE↔INACTIVE） |
| 人类过门 | 真实 room id 变化；不是过渡态 -1 |

### 关闭

1. 游戏内 `Escape` → 关闭/退出 AI、ECHO、Companion（或直接结束页面）。
2. 桥终端 `Ctrl+C`：脚本会清理本次 `TOKEN_FILE` 与 Owner key 私有目录。
3. Companion/World MCP 客户端 `client.close()`，或结束其进程；不要留下 Agent 子进程。
4. 前端 `Ctrl+C`。
5. 检查端口无残留（示例 `netstat -ano | findstr :5411`），并确认日志/截图中无 token/ownerKey 明文。

---

## D. 三条链路对应的模型证据（精确链接与边界）

| 证据 | 证明 | 不能证明 |
|---|---|---|
| `reports/ai-native-02/reviewer/lead-live/REVIEW.md`（冻结 `8b9705d`） | 真实模型经官方 Player MCP 在 Rendered 正式 World 完成 observe→fire→击杀→move→close 最小遭遇 | 完整 Run、自主路线、Headless、ECHO、Signal；Owner AUTHORIZE 是自动点击 |
| `reports/ai-native-02/reviewer/lead-headless-cropped/REVIEW.md`（冻结 `87d6ae0`） | 真实模型经官方 Player MCP 在 Headless 完成 create→observe→fire120→step10→step110→observe→close 最小遭遇 | 完整 Run、原正式 REPL（`:148` 未闭合字符串）、Signal/ECHO；模型身份只能由 Lead 现场陈述 |
| `reports/ai-native-02/reviewer/lead-echo-model-live/REVIEW.md`（冻结 `d690848`） | 真实模型两轮 ECHO `fire` 建议 → 独立 Owner UI 自动点击确认 → 真实 drone 24→6→死、ECHO94/KILLS1/DMG30 | 真人验收、Signal、长期人格；`status.pending` 旧缺口后来由 receipts 修复 |
| `reports/ai-native-02/reviewer/lead-signal-model-live/REVIEW.md`（冻结 `363eb17`） | 真实模型 Signal 最小回合：observe→scan suggest→Owner UI→echo 扣费/evidence→toggle→ACTIVE→portal room3→5 | 真人、jam、完整 Run、ECHO 当时未跨房；Owner 为自动点击 |

**不可本地复核的旧引用**：`reports/ai-native-02/lead-live-drone/` 在当前离线工作区不存在；旧报告中的该目录不能复核，不删除历史断言，但本轮不把它重新计为证据。

**夹具边界**：模型适配器只透传 tool JSON，不预写策略；Owner 确认按钮是真实 Phaser UI 点击，但点击者是自动夹具，不是真人。E2E 中站到传送门、启用 ECHO 等辅助已在对应报告中标注，不冒充真人寻路。
