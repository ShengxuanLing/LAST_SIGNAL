# Lead 亲自逐轮模型 Signal 遭遇 —— 运行手册（RUNBOOK）

> 这两个脚本只提供**运行通道**：不代替模型、不写策略、不碰 core/HP/资源/无敌。
> 模型每轮的决定、建议、目标全部由 Lead 自己写 JSON 传入。
>
> 冻结源码：`363eb173207bb5adaa0a21cd1af348dc92f29827`（本轮未改任何源码/测试/配置）
> 本轮产物全部在 `reports/ai-native-02/lead-signal-model-live/`，**untracked**，不随提交交付。

---

## 1. 文件

| 文件 | 绝对路径 | 作用 |
|---|---|---|
| Owner bootstrap | `D:\Project\LAST_SIGNAL\reports\ai-native-02\lead-signal-model-live\owner-bootstrap.mts` | 起自有 Vite + 真 bridge + 真浏览器；完成 opt-in / ECHO / 过门 / 真实表单授权；暴露本地 control 端点执行 Owner 命令 |
| 纯透传适配器 | `D:\Project\LAST_SIGNAL\reports\ai-native-02\lead-signal-model-live\signal-agent-adapter.mts` | 官方 `companionMcpServer` 的 stdin JSON 透传；`tool` 行原样 `callTool`；下划线命令转成真实 UI 点击/真实帧 |
| 本次演练证据 | `…\lead-signal-model-live\_smoke\` | 一次完整启动→观察→Owner 命令→清理的实跑产物（截图/视频/JSONL） |

两个脚本都在 `reports/` 下，因此 `git archive 363eb17` 的冻结快照里**看不到它们**；Reviewer 若要看，须从工作区取或复制到自己的环境。

---

## 2. 启动（仓库根目录，2 个终端）

```powershell
# T1 —— 唯一需要先做的：构建 MCP 产物（companionMcpServer.mjs 在 dist-mcp）
npm run game:mcp:build

# T2 —— Owner bootstrap（自己的端口 5301/5302；绝不碰原 5173）
npx vite-node reports/ai-native-02/lead-signal-model-live/owner-bootstrap.mts
# 可选：SIGNAL_RUN_PORT=5301 SIGNAL_RUN_CONTROL_PORT=5302 SIGNAL_RUN_HEADED=1
#       SIGNAL_RUN_ECHO_WAIT_MS=4000
```

看到下面两行即就绪：

```
[boot] READY. 服务只属于本次运行；用 adapter 发 echo_* 或 _owner_* 命令。
[boot] 结束时务必发送 {"_shutdown":true}（会关浏览器/桥/vite 并删除私有凭据文件）。
```

bootstrap 会打印（只打印路径与 ACL，**不打印内容**）：

```
TOKEN_FILE=…\bridge.token            OWNER_KEY_FILE=…\owner.key
CONTROL_TOKEN_FILE=…\bridge.token    BRIDGE_URL=http://127.0.0.1:<port>
```

`bootstrap.json` 里记录 `urls` / `credentials`（仅路径）/ `fixtures` / `milestones` / `stateAtEndOfBootstrap` / `observationProof`。

### bootstrap 到底做了什么（全部真实 UI）
1. 自己的端口起 Vite（`--strictPort`），起 loopback bridge（`allowedOrigins` 只含本次 5301）。
2. 真浏览器：清本地存档 → 点 `NEW RUN` → 断言默认 run **没有** relay（legacy）。
3. `Escape → SETTINGS → SIGNAL COLLABORATION · OFF → ON → BACK → Escape`（持久化 opt-in）。
4. 传送门交互进入下一个房间 → **World 自己** spawn `relay_main`（`INACTIVE`，门锁上）。
5. 在该房间里 `ECHO COMPANION > → ENABLE ECHO`（spawn 由真实帧提交）。
6. 等 `echoView().relay` 非空（真感知；不够近时用真实 W/A/S/D 走向设备）。
7. 真实 masked 表单填 `BRIDGE URL` / `TOKEN` / `OWNER PAIRING KEY · from host private OWNER_KEY_FILE` → `ENABLE / RE-AUTHORIZE (HUMAN)` → `COMPANION CONNECTED`。
8. **保持 Pause 打开**，并断言：relay `INACTIVE`、`manualEnabled=false`、`powered=true`、未 jam、无 evidence、两账户 100/100、无排队命令、门关。
9. 用只读 `companion-status` 读 `lastObservationTick` 证明“已有一份已提交的 echo 观察”（**不** attach、**不** suggest、**不**断开）。
10. 起 control 端点（127.0.0.1:5302，Bearer control token 仅存在于私有文件）。

### 夹具（逐项披露，也写进 `bootstrap.json.fixtures`）
| 夹具 | 为什么 | 说明 |
|---|---|---|
| `player.reset(portal.wx, portal.wy)` | 把主角摆到传送门上，避免脚本寻路 | 不是 AI 移动；过门仍是真实 interact + 真实帧 |
| 清当前房间普通敌人（仅当存在） | 让遭遇可控、避免模型回合间被围殴 | 只 `sprite.destroy()` + `world.enemies = []`；**不改 HP/资源/伤害/无敌**；drones 不清，逐条记录数量 |
| 先过门再 `ENABLE ECHO` | 若先在上一房间启用，echo 会被墙卡住（steering 无寻路），永远感知不到继电器 | 用的是真实 UI 按钮，echo 仍 spawn 在主角旁边（无 teleport） |
| 必要时真实 W/A/S/D 走向设备 | 让 echo 跟着主角进入 12 格感知半径 | 真键盘输入，不写坐标 |

---

## 3. 适配器（官方 Companion MCP 纯透传）

```powershell
# T3 —— 另开一个终端
npx vite-node reports/ai-native-02/lead-signal-model-live/signal-agent-adapter.mts
```

- 它会读 `bootstrap.json` 自动找到 `bridge` / `control` / token 文件路径（也可用 env 覆盖）。
- 启动即打印 `childEnvKeys=PATH,SystemRoot,TEMP,TMP,LAST_SIGNAL_WORLD_BRIDGE_URL,LAST_SIGNAL_WORLD_TOKEN_FILE`
  → **Agent 子进程环境里没有 Owner key、没有 ownerCap、没有 confirm 能力**。
- 每行一条 JSON（UTF-8）；输出也是每行一条 JSON（原始响应 + 脱敏）。

### 3.1 工具行（原样透传，没有任何策略/重试/默认值）
```json
{"tool":"echo_observe","args":{}}
{"tool":"echo_status","args":{}}
{"tool":"echo_memory","args":{}}
{"tool":"echo_suggest","args":{"requestId":"req_000000000000000000000201","suggestionId":"sug_000000000000000000000201","kind":"toggle-relay","reason":"perceived_relay","ttlTicks":600}}
```
`echo_suggest` 的合法取值（服务端 strict schema）：
- `kind ∈ {move, aim, fire, scan, jam, toggle-relay}`
- `reason ∈ {perceived_hostile, perceived_relay, no_perceived_target, objective_blocked}`
- `requestId = /^req_[0-9a-f]{24}$/`，`suggestionId = /^sug_[0-9a-f]{24}$/`
- 可选 `target{x,y}`（必须在 echo 自身感知内）、`confidence ∈ [0,1]`、`ttlTicks`
- ⚠️ Signal 建议的 `reason` 必须被真实感知支撑：设备已被感知时 **不能** 用 `no_perceived_target`（会 `E_SCHEMA companion.reason_unobserved`）；用 `perceived_relay`（或设备未 ACTIVE 时 `objective_blocked`）。`jam` 需要严格 < 6 格。

### 3.2 Owner 命令（人类动作；不写 state）
```json
{"_owner_confirm":true}
{"_owner_reject":true}
{"_owner_resume":{"milliseconds":600}}
{"_owner_enter_portal":{"roomId":5}}
{"_owner_pause":true}
{"_screenshot":"label"}
{"_shutdown":true}
```
语义：
- `_owner_confirm` / `_owner_reject`：先确保停在 Owner 面板，然后**真实点击** `CONFIRM FIRST PROPOSAL (OWNER)` / `REJECT FIRST PROPOSAL`；返回 `pendingBefore/pendingAfter`、`receipts[]`、`queuedCommands`。
- **确认不会立刻改状态**：Signal 命令先入队（暂停期 tick 冻结，无 flush）。必须再发 `_owner_resume`。
- `_owner_resume{milliseconds}`：关 Pause → 真实帧跑 N ms → 再开 Pause；返回 `tickBefore/tickDuring/tickAfter`、`relay`、两账号能量、`receipts[]`、`queuedCommands`。
- `_owner_enter_portal{roomId?}`：过门；需要摆位时用 `player.reset(portal.wx, portal.wy)`（会追加到 `fixtures-final.json` 披露）；**等待具体 `roomId`（不是 -1）**，超时返回 `ROOM_ID_TIMEOUT`。
- `_owner_pause`：确保停在 Owner 面板。`_screenshot`：随手截一张。
- `_shutdown`：关浏览器（冲刷视频）→ 关 control → 关 bridge → 删除 TOKEN / OWNER KEY / CONTROL TOKEN 私有文件 → 关自己 spawn 的 Vite。**只碰本次自有进程**。

### 3.3 每轮产物（自动脱敏）
| 文件 | 内容 |
|---|---|
| `tool-io.jsonl` | 每轮 `round/tool/args/ms/error/raw{content,structuredContent,isError}` + 启动时的 `attach`（含 `childEnvKeys`） |
| `owner-ui.jsonl` | 每条 Owner 命令的 `stateBefore/stateAfter`（真实 tick / relay / 两账号能量 / 排队命令 / receipts / 房间） |
| `screenshots/` | bootstrap 里程碑 + 每个 tool 轮次的截图（`NN-tool-<round>-<tool>.png`） |
| `video/` | 整轮浏览器录像（webm，`_shutdown` 时冲刷落盘） |
| `bootstrap.log` | 时间戳操作日志 |
| `fixtures-final.json` | 运行中新增的夹具披露（如过门摆位） |
| `bootstrap-observation-proof.json` | `lastObservationTick`（证明已有已提交观察） |

脱敏：TOKEN / OWNER KEY / CONTROL TOKEN / `ownerCap` 一律替换为 `<redacted>`；实测对产物做 64-hex 扫描命中 **0**。

---

## 4. 推荐的一轮流程（Lead 自己执行）

1. `bootstrap` 就绪（Pause 停在 Owner 面板）。
2. 发 `{"tool":"echo_observe","args":{}}` —— 你会看到 echo 自身位置/HP、`relay{id,x,y,state:"INACTIVE"}`、`energy{current:100,max:100}`、`objectiveBlocked:true`。
3. 你自己决定建议：例如 `{"tool":"echo_suggest","args":{"requestId":"req_…","suggestionId":"sug_…","kind":"toggle-relay","reason":"perceived_relay","ttlTicks":600}}`。
4. `{"_owner_confirm":true}` → 回执里 `queuedCommands:["toggle-relay"]`（还没生效）。
5. `{"_owner_resume":{"milliseconds":600}}` → `relay` 变 `ACTIVE`，`tickAfter` 前进，`receipts` 出现 `confirmed`/`applied`。
6. 再来一轮 `echo_observe`（看到 `relay.state:"ACTIVE"`、`exitOpen` 场景）→ 你自己决定 `scan`（`perceived_relay`）→ confirm → resume（echo 账号 100→90，玩家账号不变）。
7. 需要过门：`{"_owner_enter_portal":{}}`（或指定 `roomId`），会返回 `roomBefore/roomAfter`。
8. 结束：`{"_shutdown":true}`。

> 断线/异常：bootstrap 进程若被强杀（Windows `kill` 不发 SIGINT），端口与私有凭据文件可能残留 → 用 `_shutdown`，或在终端里 **Ctrl+C**（Windows 控制台会触发 SIGINT 分支）。

---

## 5. 清理

```powershell
# 正常：在 adapter 里发
{"_shutdown":true}
# 它会：关浏览器(冲刷视频) → 关 control → 关 bridge → 删除 TOKEN/OWNER/CONTROL 私有文件 → 关自己 spawn 的 Vite
# 校验（应无输出）：
netstat -ano | Select-String ":5301|:5302"
```
`_shutdown` **只**关本次脚本自己启动的进程；原先 5173 的 dev server 与任何其他会话都不受影响。

---

## 6. 本次演练结果（`_smoke/`，已结束、当前未驻留运行）

| 门 | 命令 | 结果 | 证据 |
|---|---|---|---|
| 1 | `npx vite-node …owner-bootstrap.mts` | PASS — 自有 5301/5302 + 真 bridge 起来，7 张 bootstrap 里程碑截图 | `_smoke/bootstrap.log`、`_smoke/bootstrap.json` |
| 2 | 真实 UI 链路（NEW RUN→optin→过门→relay INACTIVE→ECHO→感知→masked 表单授权） | PASS — `relay=INACTIVE`、`playerEnergy=100`、`echoEnergy=100`、`lastObservationTick=172` | `_smoke/screenshots/01..07`、`_smoke/owner-ui.jsonl`、`_smoke/bootstrap-observation-proof.json` |
| 3 | 官方 Companion SDK 透传 `echo_observe` / `echo_status` | PASS — 均 `ok:true`，观察里含 `relay`（INACTIVE）+ 自身能量 | `_smoke/tool-io.jsonl`、`_smoke/screenshots/08..09` |
| 4 | Owner 命令真实帧 `_owner_resume{400}` | PASS — `tickBefore=172 → tickAfter=211`，`relay=INACTIVE`，两账号 100/100，无排队命令 | `_smoke/owner-ui.jsonl` |
| 5 | `_shutdown` 清理（仅自有进程） | PASS — 5301/5302 无监听、私有凭据已删、录像 12 MB 落盘 | `_smoke/shutdown.json`、`_smoke/adapter-shutdown.json`、`_smoke/fixtures-final.json`、`_smoke/video/*.webm` |
| 6 | 密文不泄漏扫描 | PASS — 8 个产物文件 `[0-9a-f]{64}` 命中均为 **0** | 见 §3.3 命令 |
| 7 | 冻结源码未被改动 | PASS — `git status` 无 tracked 修改；`npx tsc --noEmit` exit 0（0 字节输出） | `_smoke/frozen-head.txt`、`_smoke/tsc-frozen.log` |

**NOT RUN（由 Lead 执行）**：真实的逐轮模型 Signal 遭遇（observe → 模型自选建议 → Owner 确认 → 真实 tick → 再观察）。脚本里**没有任何**预写建议/策略。

---

## 7. 非阻断待办（Reviewer 提出，本轮不在冻结上改）

1. **Headless echo actor 纵深**：Reviewer 指出的 headless 侧 echo actor 处理深度问题（`worldHeadless` 的 echo 分支），属非阻断，需在解冻后单独小提交补强 + 补测。
2. **v1 错误注释**：`worldProtocol` v1 schema 附近注释与实际错误码（`E_VERSION_UNSUPPORTED` 路径）不一致的注释问题，属非阻断、纯注释/文档修正。

两项都**没有**在 `363eb17` 冻结上修改；记录在此，等解冻后再处理。
