# GAMEPLAY-01 · 真实模型连接 + 最小游戏链路 smoke（Reviewer）

**结论：本阶段（真实模型 → 合法 observe → 合法动作 → 正式 MCP 执行 → 真实 core 战斗进展）PASS，有完整 trace；不是整体 GAMEPLAY-01 PASS，也不是人类验收。**
连通性与模型路线沿用 Lead 的探测（`reports/gameplay-01/model/`），我只做**一次**真实游戏链路实验，不重复刷探测。

---

## 1. 连接性（沿用 + 我的一次确认）

| 项 | 值 |
|---|---|
| Endpoint | `http://127.0.0.1:3425/v1`（本地 Magpie，无 Authorization header） |
| wireProtocol | openai-chat（标准 `/chat/completions`） |
| 路线 | `group/elisa`（**只声明该路线**，不推断背后 vendor/model） |
| Lead 探测证据 | `reports/gameplay-01/model/magpie-connection-probe.json`（6922ms，`content:"OK"`，`finish_reason:stop`，`credentialsSupplied:false`；`max_tokens:32` 时 reasoning 耗尽 content=null，**只算 transport 不算推理**——该口径已保留不混用） |
| 我的确认 | `GET /v1/models` → HTTP **200**（无凭据）；本次 smoke 中 4 次 `/chat/completions` 全部 HTTP **200**、`returnedModel=group/elisa`、`finish_reason=stop` |

## 2. 运行时与方法（不改 src/tests、不占 tester 端口）

- **Runtime 快照**：`git archive b6a98e5`（= 含 P1 demo + P0 测试修复的固定提交）到 `D:/tmp/gp01-rm-b6a98e5`，`node_modules` 走 junction，**独立构建该快照的 `dist-mcp`**：`npx vite build --config vite.mcp.config.ts` → `BUILD_EXIT=0`（日志 `reviewer/real-model/dist-mcp-build.log`）。共享 P2 工作区未被改动。
- **正式工具面（stdio MCP）**：`world_headless_create_session / world_observe / world_action / world_headless_step / world_close / world_signal_status`（26 个工具中其余为 dev/owner 面，**模型从不接触**）。
- **链路**：`world_observe`（官方感知裁剪投影）→ 组 prompt（仅该投影 + 允许动作 schema）→ Magpie `chat/completions`（`max_tokens=512`、`stream:false`）→ **严格 JSON 解析 + 参数校验**（type ∈ move/stop/aim/fire/interact；move 方向模长 0.05–1.5；坐标有限）→ `world_action`（`aid_`/`req_` 正规 id，`ttlTicks=60`）→ `world_headless_step`（25 真实 tick）→ 再 observe。
- **fixture（已标注）**：`world_headless_dev_spawn_enemies {kinds:['drone','drone']}` + 固定 seed `20261117`。该 dev 工具只用于**初始化可战斗场景**；模型的 prompt 里只有 observation（实测 `leaks=[]`，不含 mapHash/seed/rngState/canonicalState/dev 字段）。
- **预算**：单次实验 `MAX_REQUESTS=6`、`MAX_TOKENS=512`、wall clock 420s；本次共 **4 次模型请求 / 8.8s**。复核期间所有实验累计 **15 次**模型请求（≤20），未重试追绿。

## 3. 关键证据：真实模型驱动的战斗 episode（canonical run）

Run：`reviewer/real-model/console-5.log`、trace `reviewer/real-model/trace-2026-11-17T20-55-14-035Z.json`

| 步 | 模型看到的（官方投影） | 模型选择 | 执行（正式 MCP） | 真实结果（core 事件） |
|---|---|---|---|---|
| 1 | enemies=3（id 1/2/3，hp 27，`availableActions=[move,stop,aim,fire,interact]`） | `fire (23.5,42.5)` = 视野中敌人坐标 | ok，`acceptedTick 0` | `projectile-spawned 4`、`enemy-hit 1`、**`enemy-died 1`**、`loot-dropped 1`、`loot-collected 1`、`xp/currency +1`；player 100→100 |
| 2 | enemies=2（hp 27/27） | `fire (20.507,41.533)`（追踪移动中的敌人） | ok | `enemy-hit 2`；**player 100→93**（被反击） |
| 3 | enemies=2（hp 27/**3**） | `fire (20.507,41.533)`（继续同一目标） | ok | `enemy-died 1`、loot/xp/currency；enemies→1 |
| 4 | enemies=1（hp 27） | `fire (19.525,41.525)` | ok | `enemy-hit 2`、**`enemy-died 1`** → **enemies=0（房间清空）** |

- **非盲**：第 1 步开火坐标 = 投影里敌人 id1 的坐标；后续两步的坐标为小数，对应移动中的同一目标（追踪行为来自观察，不是脚本挑的坐标）。
- **真实战斗进展**：3 次 `enemy-died`、5 次 `enemy-hit`、玩家真实掉血 7、loot/xp/currency 真实增长、tick 0→100。
- **模型延迟/用量**：2076/2012/1545/1719 ms；usage `prompt 402/586/452/363`、`completion 19/27/27/27`、`reasoning 0`；4 个 `chatcmpl-…` id 均已记入 trace。
- **停止条件**：`no_perceived_enemy_left`（清空后停止，不继续刷）。

### 3.1 三个更早的链路 probe（透明度）

`console-1..3`：单步验证「模型动作能被正式 schema 接受并真实推进 tick」。其中**我的 summarizer 一开始读错了字段**（读 `enemies`/`perceivedActors`，而官方投影字段是 `drone`/`drones`），导致前三次日志里 `enemies=0` 的摘要不准确 —— **不是产品缺陷**，观测本身一直包含 `drones`（见 `dev-probe4.mjs` 的原始投影：`drones:[{id:10,hp:27,...}]`、`availableActions`）。修正后即 run 5。

## 4. 这一阶段证到了什么 / 没证到什么

**已证**：
1. 本地 Magpie `group/elisa` 可被用于**真实游戏代理**（非仅 OK 探活）：4 次请求全部合法返回并被正式工具接受。
2. 模型拿到的是**官方感知投影**（perception-cropped；`leaks=[]`），动作走**正式 schema + 正式执行**（不是脚本替模型选动作）；core tick、伤害、死亡、掉血、loot 全部真实。
3. 有完整可复核 trace：可见观察、请求 id、动作、core 事件、HP/伤害/击杀/tick、延迟与 usage；**没有保存任何模型内部 reasoning**（该路线 reasoning_tokens 为 0，我们也只记可见 content）。

**未证 / 明确边界**：
1. **这是 `HeadlessWorld`（同一 core）**，不是 P1 的 Rendered demo：**relay/linked-sentry/route/portal 都不在此链路内**（那些是 Rendered-only 编排）。所以本 smoke 不能替代 P1 的 Signal 因果验收。
2. **ECHO / Companion / Owner / bridge 全未参与**：P2 冻结后才接真实 Bridge；本报告不把任何 ECHO 行为算作已验证。
3. **不是人类验收**：模型是 `group/elisa` 路线，Owner 若出现也只是 fixture；全程 `HUMAN ACCEPTANCE PENDING`。
4. 样本小（单 seed、1 个 episode、4–6 步、单一武器 pulse、25 tick/步），**不构成平衡/难度结论**。
5. 未做 replay/parity、未跑完整 Playwright（按指示）。

## 5. Gate（一行一条）

| 命令 | 结果 | 日志 / 证据 |
|---|---|---|
| `GET http://127.0.0.1:3425/v1/models`（无凭据） | **PASS**（HTTP 200） | 本次同机确认（无敏感信息） |
| `cd D:/tmp/gp01-rm-b6a98e5 && npx vite build --config vite.mcp.config.ts` | **PASS**（BUILD_EXIT=0） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/real-model/dist-mcp-build.log` |
| `DEV=1 FIXTURE_SEED=20261117 MAX_REQUESTS=6 TICKS_PER_STEP=25 node reports/gameplay-01/reviewer/real-model/real-model-smoke.mjs` | **PASS**（4 model requests / 8.8s / 3 kills / player 100→93 / room cleared） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/real-model/console-5.log` + `trace-2026-11-17T20-55-14-035Z.json` |

日志中无密钥/请求头/Owner key/bridge token（grep 仅命中 `MAX_TOKENS` 这个预算字段）。

## 6. 给 P5 的复用建议（不改权限、不新增工具）

1. 直接复用 `reviewer/real-model/real-model-smoke.mjs`：换成有 relay 的场景需要 P4 把 route/relay 规则移入 core（现在 headless 没有 linked sentry），否则 P5 的 Signal 环节仍只能走 Rendered E2E + 真实模型。
2. ECHO 环节等 P2 冻结后接：模型侧只给 `echo_observe/suggest` 的正式投影；Owner 确认用 fixture 点击并**标注 fixture**，仍是 `ENGINEERING`，不是人类。
3. 预算纪律保持：单实验 ≤20 请求、`max_tokens≤1024`、显式 wall clock、失败保留不重试；把 requests/tokens/wall 写进每个 trace 头部，便于 P5 汇总成本。
4. 每次实验固定 seed + 固定 fixture（`dev_spawn_enemies` kinds/seed 记录在 trace），确保跨天可复现。

**本阶段仅 `ENGINEERING PASS（真实模型最小链路）`；GAMEPLAY-01 整体仍 `HUMAN ACCEPTANCE PENDING`，P2–P5 未完成。**
