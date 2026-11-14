# AI-NATIVE-02 C3-b 阻断修复（Reviewer/Tester 独立复现后）

- 分支 `feat/ai-native-world-integration`；本轮在 C3-b 独立提交上做**修复提交**，不改 C2 核心。
- 冻结被测：`8ec8758`（Reviewer/Tester 的 FAIL 结论针对它）。
- 本轮为**接口/生命周期验证**：不是真实 LLM 实跑，不是“外部 Agent 战斗已接入”。

## 1. 三阻断修复与证据

### 阻断 1：`ticks` 被完全忽略 → 已修复（按真实 core tick 计数）

- `ExternalLinkState` 新增 `beginExecution/advanceExecution`：每个动作带 `durationTicks`（`move`/`fire` 取 `action.ticks`，`aim`/`interact`/`stop` 按定义 1 tick）。
- `World.stepFrame` 核心路径按**实际推进的整数 core tick** 扣减；一帧内 tick 数超过剩余时长时，多余的 tick 用中立意图执行，**不会**多送意图；多帧/单帧都按 tick 计数，不按 RAF。
- Receipt 新增 `startedTick` / `completedTick` / `executedTicks` / `durationTicks`；状态 `queued → executing → applied`（或 `cancelled`/`expired`）。
- `fire` 只让真实 core cooldown 决定射击次数，不绕规则；`aim`/`interact` 一次合法提交。
- 证据（`logs/effects-evidence.log`）：
  - `move ticks=1`：`executed1=1`，位移 `0.0810`；
  - `move ticks=120`：`executed120=120`，位移 `6.0650`；`started120=22 → completed120=142`。
  - 对比 Reviewer 的 `d1 = d120 = 0.0573`：已不再相同。

### 阻断 2：`afterFrame`/`degrade` 异步竞态 → 已修复（generation + 局部 client 引用）

- `ExternalLinkController` 每次异步操作捕获 `LifecycleToken { client, epoch, generation }`，**每个 `await` 之后都重新校验** `disposed/generation/client/lease/epoch/owner`。
- `degrade()`/`dispose()` 先 `generation += 1`、再 `abortInFlight()` 中止所有在途请求、置 `client=null`；迟到回调不能 heartbeat / ACK / push / 重挂。
- `beforeFrame`/`afterFrame` 有 `beforeBusy`/`afterBusy` 守卫，不会重叠提交或读取动作。
- 回归：`src/ai-native/externalLinkLifecycle.test.ts`（6）确定性复现 Reviewer 场景：
  - `pushObservation` await 窗口中 `degrade('takeover')` → 无 `TypeError`、`heartbeats=0`、`acks=0`、`pushes=1`；
  - 迟到 `beforeFrame` 不启动动作；迟到 ACK 不心跳/不推送；
  - 连续 EOF/心跳丢失不自动重挂；重复 `actionId` 只产生一次 completion。

### 阻断 3：`projectiles` 未裁剪 → 已修复（与玩家同一感知谓词）

- 抽出纯函数 `src/ai-native/externalObservation.ts`：`projectiles` 与 `drones/targets` 使用**同一个** `isPerceivable`（有限半径 12 格 + 已探索房间 + LOS 墙体遮挡）。
- 墙后 / 他房 / 远距敌方弹丸不返回；合法近弹丸保留（双方都适用）。
- 回归：
  - 单元 `externalObservation.test.ts`（6）：远/墙后/他房弹丸被裁剪；严格 schema 负向（`seed`/`rngState`/`map`/`hiddenGoal` 多余字段、缺 schema、`NaN` 坐标全部拒绝）。
  - Rendered probe（E2E）：真实核心放入近/远弹丸，agent observation 只含近弹丸，且核心仍保有隐藏弹丸（证明是裁剪而非不存在）。

## 2. 新增：独立 Agent 租约（硬断线 / 陈旧列表）

Reviewer/Tester 新发现：`SIGKILL` agent 后 8s 仍 `external/CONNECTED`；`world_list_sessions` 对死会话仍 `attached:true`。

- 新增 `src/ai-native/agentLease.ts`（纯状态机）：
  - **独立租约**：`leaseId + per-session version + expiresAtMs`；与浏览器→bridge 心跳完全分离。
  - 桥接 `POST /world-link/agent-renew`：只续租约；`POST /world-link/heartbeat`（浏览器）**不能**续 Agent 权限。
  - 期限 4000ms、续约 1000ms、reaper 200ms（`WORLD_LIMITS.AGENT_*`）。
  - 过期 → 取消执行中/排队动作、bump epoch、关闭会话、清 `linkedByOrigin`；浏览器心跳收到 `world.agent_lease_expired` → `HUMAN/LOST`。
  - 同一 session 只允许**一个** live agent 租约；第二个 attach 明确 409 `world.agent_already_attached`。
  - 旧进程持旧 `leaseId`/旧版本续约 → `E_STALE_EPOCH`，**不会**把新授权的租约续给旧 client。
  - 续约只延长租约，**不延长**动作 TTL（`WorldGateway` 的 `queuedAtMs`/`applyByTick` 不变，长推理不会让过期动作复活）。
- `WorldClient`：后台 `unref()` 定时续约；`close()` 释放租约；`status()` 走 `GET /world-link/agent-status` 做**远端**核对；一旦失效立即清本地 attached 缓存并标记 `detached`，**不自动重挂**。
- `worldMcpTools.ensureAttached()` 每次工具调用都做远端核对：closed/dead 不再返回 `attached:true`，不靠“下一次 observe 才纠正”。
- 证据：
  - `src/ai-native/agentLease.test.ts`（8）：一 session 一租约、版本/旧 leaseId、过期、释放、浏览器心跳不续约、死会话不 attached、旧租约不能续新租约。
  - `tests/c3b-hard-disconnect.spec.ts`（真实子进程 **SIGKILL**）：授权→120 tick 动作执行中→`SIGKILL` agent→有界期限内 `owner=human`、`status≠CONNECTED`、`hasActive=false`、`pending=0`、旧 epoch 提交被拒（≥400）、1.5s 后仍 human（不自动重连）、新的人类授权产生**新 session**且可 attach。
  - `src/ai-native/worldMcpLeaseSmoke.mts`：`world_list_sessions` live→`attached:true`；远端关闭后→`ok:false` 且**绝不** `attached:true`；`world_observe` 同样失败。

## 3. ACK 语义（精确，不夸大）

`applied` = **合法意图已被真实 core tick 提交了请求的整数 tick 数**，并有真实 `startedTick/completedTick`。
它**不保证**：位移、命中、击杀、交互成功。墙、冷却、弹药、碰撞规则仍和真人一样决定实际效果。
`queued` ≠ `applied`；`executing` 表示正在按 tick 推进。测试里 `blocked legal move` 明确验证“有 `applied` receipt 但位移接近 0”。

## 4. 部署/模式门禁收紧

- `vite.config.ts`：`__LAST_SIGNAL_DEV_TEST__ = (mode === 'development' || mode === 'test')`。
  任意自定义 mode（如 `staging`）按生产处理，**不暴露** `__game` 与 dev/test 诊断门面。
- `scripts/c3b-f03-gate.mts` 新增 `--mode staging` 静态检查：`PASS custom_mode_no_game_handle`。

## 5. 凭据（token）平台边界

- 新增 `src/ai-native/secureTokenFile.ts`：
  - POSIX：`chmod 0600`。
  - Windows：`chmod` 无效（`-rw-r--r--`）。改为在当前用户临时目录建文件，调用**绝对路径** `System32\icacls.exe`（Git Bash 的 GNU `whoami` 不支持 `/user`）：`/inheritance:r` 去掉继承 ACE，`/grant:r *<SID>:F` 只授予当前用户 SID。
  - 实测 `ICACLS` 只剩 `<user>:(F)`，`WIN_ACL_INHERITED=false`、`WIN_ACL_OTHERS=false`（`logs/token_acl.log`）。
  - 不引入新框架；token 只经 `Authorization` 头，绝不打印/进 URL/进参数。
- 仍如实记录：Windows 上除 POSIX 语义外，系统级管理员理论上仍可读取；这是平台边界，不是“加密存储”。

## 6. 质量门（`reports/ai-native-02/c3b-fixes/logs/gate.log`，一行 PASS/FAIL + 命令 + 结果 + 路径）

| 门 | 结果 |
| --- | --- |
| typecheck | PASS |
| unit | PASS **34 files / 497 tests**（含本轮 25 条 C3-b 回归） |
| build / build:test | PASS |
| MCP 双入口构建 | PASS |
| F-03 双产物 + 自定义 mode | PASS `F03_PRODUCTION_GATE_PASS` |
| token ACL | PASS `ACL_PASS`（Windows 无继承/无他人） |
| StationZero 默认 MCP client | PASS（6 Player 工具，默认面无 world 工具） |
| `--world` MCP smoke / 集成（两种二进制） | PASS |
| Agent lease smoke（stale-list） | PASS |
| C3b 定向 repeat ×3（9 用例） | PASS **27/27** |
| 全量 E2E（五视口 + C2 回归） | PASS **62/62** |
| C2 parity（room/node/kill/loot） | PASS |

## 7. 正式逐轮实跑方法（给 Lead）

前置：`npm run build`（或 `build:test`）+ `npm run game:mcp:build`；`npm run dev`。

1. 起桥接（token 只落安全文件，不打印）：
   `npm run game:world:bridge` → 记下 `BRIDGE_URL` / `TOKEN_FILE` / `TOKEN_ACL`。
2. 人类在游戏内授权：把 `bridgeUrl` 与 token 配到页面（当前仍是开发期注入限制），NEW RUN → ESC → **AUTHORIZE EXTERNAL AGENT** → ESC。
3. 官方 MCP 客户端（真实 stdio 协议帧，逐轮）：
   ```
   LAST_SIGNAL_WORLD_BRIDGE_URL=<URL> LAST_SIGNAL_WORLD_TOKEN_FILE=<TOKEN_FILE> \
     npm run game:world:mcp-console
   ```
   命令：`list` → `observe` → 自己选动作 `act '[{"type":"move","actionId":"aid_<24hex>","dir":{"x":1,"y":0},"ticks":20}]' 600` → `observe` → … → `close`。
   单次 JSON：`-- --json '{"tool":"world_observe","args":{}}'`。
   每次参数/结果写入 `reports/ai-native-02/c3b-fixes/tool-io/session.jsonl`（无 token）。
4. 判定：`status=queued` 不是 applied；等 `observe` 看到新 tick 与 receipt 的 `startedTick/completedTick/executedTicks` 后再判断；**不把 ACK 当命中/位移证明**。
5. 硬断线：直接 kill MCP 进程；≤10s 内 HUD/link 变 HUMAN/LOST；再点 AUTHORIZE 才会新建会话。

## 8. 未实现 / 未声称

- **C3-c（Headless same-core / MCP 实跑）仍暂停**；仓库里未完成的 C3c WIP 未纳入本提交。
- **真实 LLM / 外部 Agent 实跑仍未做**；本轮只证明接口、时长、竞态、裁剪、租约与硬断线。
- **游戏内连接输入 UI 仍是后续小提交**：常规演示目前仍需宿主页/控制台注入配置（已写入限制）。
- 人类授权仍是“同源脚本可持 token 绕过点击”的本地信任模型；无 per-agent 撤销/审计。
- C2 维持放行；未回退其核心。
