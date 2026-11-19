# P3-b Owner 授权漏洞 B1 独立修复重验证（87ab379）

- **被测提交**：`87ab3797d9fbcf08293649cf3137250245ee8ee9`（HEAD，分支 `feat/ai-native-world-integration`）
- **链**：`39a43b2` → `8b2de8e` → `c3e1461` → `b3930c5` → `dd42239` → `5537078` → `593786b/8f1ce6c` → `4cb59e9` → `dcb4f14` → `87d6ae0` → `b3930c5` → `212cd56`（P3-a 放行） → `ab59fe6`（P3-b step 3） → `c0cfdb6`（P3-b step 2） → `77c9294`（P3-b Task0） → `a1e23dd`（preview 入口修复） → `d768f6f`（P3-b A 接线） → `f16741a`（P3-b A 权限收紧） → `87ab379`（**P3-b A B1 Owner 授权修复**，HEAD）
- 注意：`87ab379` 的父提交 `1b0dca0` 已并入 P3-b B（核心 Signal 设备 / v2 能力 / Headless Signal Combat），因此本轮冻结快照**同时包含 P3-b B 核心代码**。本轮审查重点为 B1 Owner 授权修复；Signal C（正式 Relay 协作场景 / UI / 完整 E2E）仍未实施。
- **冻结**：`git -c core.autocrlf=false -c core.eol=lf archive 87ab379 | tar -x -C D:/Project/lastsignal-p3b-owner-auth-fix-review-87ab379`；`node_modules` junction 指向共享依赖；Python 逐文件 git blob SHA1 → **ALL_TRACKED_FILES_MATCH（2030/2030, MISMATCH=0, MISSING=0）**
- **边界**：未改生产源码/已有测试/配置/分支；未 merge/reset；未读/恢复 WIP/stash；未 kill 无关进程（5176 被占用，未触碰）；凭据仅进程内随机，token/ownerKey/ownerCap 无日志/参数/URL/截图；Windows 凭据文件 ACL 经 `icacls` 当前 SID 验证。
- **结论**：**B1 Owner 授权漏洞修复已独立通过，可以进入接线后续阶段；但本轮不能当完整 P3-b，Lead 真实 LLM 建议实跑仍不允许，Signal 接线仍未完整。**

## 1. B1 漏洞修复核心（开发者陈述与独立验证）

开发者修复要点：
- 新增 `src/ai-native/ownerCredential.ts`（HOST-ONLY）：32 字节 Owner 配对密钥写入当前用户私有文件（`mkdtemp` + `hardenOwnerDirectory`/`hardenOwnerFile`，POSIX 0600 / Windows 当前 SID-only `icacls`），仅返回路径 + ACL + `keyHash`，原始密钥不返回/不日志/不暴露。
- 新增 `src/ai-native/ownerPairing.ts`（BROWSER-ONLY）：原始配对密钥 + 桥接颁发的会话能力存在 ES `#private` 字段（不可枚举、`JSON.stringify` 返回 `{}`），由模块私有 `WeakMap` 索引，`stashOwnerPairing`/`peekOwnerPairing`/`clearOwnerPairing`/`swapCap`/`consumeKey`。
- `src/ai-native/worldBridgeServer.ts`：`WorldBridgeOptions.ownerKeyHash`（桥接启动时必须提供，原始密钥从不进入选项/日志）；`handshake` **要求人类持有的 `ownerKey`**（证明持有主机私有密钥），Agent 令牌 + 可伪造 Origin **不足**；成功后桥接颁发**唯一 `ownerCap`（32 字节随机，哈希存储）**，仅在渲染器响应中返回；所有渲染器变更（`companion-authorize` 含原子能力置换、`companion-observation` POST、`companion-suggestions`、`companion-decision`、`companion-applied`、`companion-mode`、`companion-disconnect`、`heartbeat`、`next-action`、`action-ack`、`yield`、`close`）均要求能力通过 `capOk`（常量时间哈希比对）；Origin 仍被校验但**不是认证**；Agent 路由（attach/observe/suggest/status/agent-*）始终 token-only，绝不接收或伪造 Owner 能力。
- `src/ai-native/companionGateway.ts`：`decide` 使用 `validateOwnerDecision`——与 `CompanionOwnerLedger` 共享的**唯一纯校验器**——严格校验 confirm/reject 枚举、当前且单调 epoch、`tick >= createdAtTick`、TTL（`E_ACTION_EXPIRED`）、无重复执行；`markApplied` 仅对 `confirm` 且 `appliedTick >= decidedAtTick` 成功，被拒绝的决定永远不能变成 `applied`。
- `src/ai-native/companionLink.ts`：`ownerSecret`/`capability` 改为 `#private` 字段，`toJSON()` 返回 `{}`；人类配对密钥一次性（握手时消费后清除）。
- `src/ai-native/externalLinkClient.ts` / `externalLinkController.ts`：`handshake(ownerKey)` 一次性发送配对密钥后丢弃；颁发的 `ownerCap` 随后每条渲染器请求携带；`forgetCredentials`/`dispose` 清凭证；密钥不再存入 `globalThis.__externalLinkConfig`。
- `src/scenes/GameScene.ts` / `src/scenes/PauseScene.ts`：Pause 面板新增遮蔽的 `ownerPairingKey` 输入框（提交后立即从 DOM 清除）；`GameScene.authorizeExternalAgent(bridgeUrl, token, ownerKey)`；外部主人公激活在**同一人类动作中**将 companion 置 `READ_ONLY`（G4 修复）；`GameScene.reauthorizeCompanion(ownerKey)` 支持带原子能力置换的重授权。
- `scripts/c3b-bridge.mts`：通过 `createOwnerCredentialFile()` 生成**独立**的 Owner 配对密钥，仅打印 `OWNER_KEY_FILE` / `OWNER_KEY_ACL`（路径 + ACL 元数据，不打印密钥），将 `ownerKeyHash` 传给桥接，停止/出错时清理私有文件；Owner 密钥不进入 MCP env / attach / observation / 控制台。

## 2. 独立验收结果

### 2.1 B1 四条链 + 扩展向量（真实 HTTP 桥接，独立端口，Agent 仅持 token + 公开 Origin）

| 链/向量 | 期望 | 实测 | 结果 |
|---|---|---|---|
| C1 自握手：Agent 无配对密钥 | 403 `world.owner_pairing_required` | 403 `owner_pairing_required` | PASS |
| C1 错误配对密钥 | 403 | 403 | PASS |
| C2 自授权：Agent 无 capability | 403 `owner_capability_required` | 403 `owner_capability_required` | PASS |
| C3 重授权覆盖：Agent 用自己的密钥替换人类能力 | 403 `pairingOk 失败` | 403 `owner_capability_required` | PASS |
| C3 人类能力未被篡改：人类用原 capability 重授权仍成功 | 200 | 200 | PASS |
| C4 重授权原子置换：人类同密钥重授权 → 新 capability ≠ 旧，旧 capability 立即 403 | 200 + 新 cap / 旧 403 | 200 + 新 cap / 旧 403 | PASS |
| Agent 自发布伪造观察（Boss999） | 403 | 403 | PASS |
| Agent 自翻 external→human 模式 | 403 | 403 | PASS |
| Agent 自 confirm / applied | 全部 403，状态不变 | 全部 403 | PASS |
| Agent attach 响应不泄露 ownerCap/ownerKey/ownerKeyHash | 无 | 无 | PASS |
| Agent observe GET 不泄露 capability（代理路由，不要求 capability） | 无泄露 | 无泄露 | PASS |
| null / 缺失 / 错会话 / 错 epoch 的 capability | 403/409 | 全部拒绝 | PASS |
| 重授权要求旧 Owner 证明（无 ownerKey 拒绝） | 403 | 403 | PASS |
| 能力置换竞态：旧 capability 晚确认不能执行 | 403 / 已决定 | 403 | PASS |

四条链及全部扩展向量均 **PASS**。B1 漏洞（Agent 可重授权装自己的 secret 并自 confirm）已修复：现在**必须凭人类持有的配对密钥完成握手，且每次渲染器变更必须携带桥接颁发的 Owner capability**，Agent 令牌 + 公开 Origin 无法自授权、自确认、自 applied。

### 2.2 生产 decide / markApplied 严格校验（共享验证器）

| 检查 | 期望 | 实测 | 结果 |
|---|---|---|---|
| 非法决策枚举 | E_SCHEMA `decision_invalid` | E_SCHEMA | PASS |
| tick < createdAtTick | E_STALE_TICK `tick_before_creation` | E_STALE_TICK | PASS |
| 旧 epoch | E_STALE_EPOCH `stale_epoch` | E_STALE_EPOCH | PASS |
| TTL（tick >= expiresAtTick） | E_ACTION_EXPIRED `suggestion_expired` | E_ACTION_EXPIRED | PASS |
| 已决定的建议再确认 | E_RETRYABLE `decision_exists` | E_RETRYABLE | PASS |
| markApplied 对被拒绝决定 | E_PERMISSION `decision_not_confirmed` | E_PERMISSION | PASS |
| confirm → markApplied appliedTick >= decidedAtTick | applied=true | applied=true | PASS |
| markApplied appliedTick < decidedAtTick | E_STALE_TICK `applied_tick_invalid` | E_STALE_TICK | PASS |
| markApplied 已 applied 的建议 | E_RETRYABLE `decision_already_applied` | E_RETRYABLE | PASS |

生产 `CompanionGateway.decide` 与纯 `CompanionOwnerLedger` 共享同一校验器，未由任何路由重复实现逻辑。确认一次后由下一 core tick 提交（applied=false → 真实 core 提交后 applied=true），receipt 不提前报效果。

### 2.3 外部主人公只读同步

- `gateway.setOwnerMode('external')` → `readOnly=true`，阻止新 suggest 与 confirm ✓
- `GameScene.authorizeExternalAgent(bridgeUrl, token, ownerKey)` 在**同一人类动作中**调用 `companionLink.setOwnerMode('external')`，并 `clearOwnerPairing(this)`（G4 修复，外部主人公与 Companion 权限互斥）✓
- 切回 `'human'` 后 readOnly=false，可新建 suggest 并 confirm ✓

### 2.4 密钥不外泄、内存有界、lease 硬杀毁

- `CompanionLink` / `ExternalLinkClient` / `ExternalLinkController` 的 `ownerSecret`/`capability`/`#token` 均为 `#private` 字段；`toJSON()` 返回 `{}`；`JSON.stringify` / 枚举不泄露密钥 ✓
- 密钥不写入 `globalThis` / URL / 日志；`companionConsoleSmoke.mts` 的 `REDACT_KEYS` 含 `ownerSecret` ✓
- 内存有界：pending suggestions ≤ 8（MAX_UNCONFIRMED）、facet memory ≤ 16（MEMORY_ENTRIES）、dedup records ≤ 512（MAX_DEDUP_RECORDS）✓
- Lease 硬杀毁：4000ms 无续租 → 硬过期；迟到 suggest/status/confirm/renew 全拒；旧 leaseId 不能续期；reaper + `onLeaseExpired` 取消 pending、清 observation/decision；ownerSecretHash 被清理；不假连接 ✓

### 2.5 Owner 配对密钥 ACL / CLI / 环境未误给 MCP

- 凭据文件 ACL（Windows）：`icacls` 移除继承，仅授当前用户 SID `F`，无 `BUILTIN\Users` / `Authenticated Users` / `(I)` 继承；POSIX 0600/0700 ✓
- `c3b-bridge.mts`：通过 `createOwnerCredentialFile()` 生成独立密钥文件，仅打印 `OWNER_KEY_FILE` / `OWNER_KEY_ACL`（路径+ACL 元数据，**不打印密钥**），将 `ownerKeyHash` 传给桥接，停止/出错时清理私有目录 ✓
- 桥接响应（attach/observe/status）不含 ownerCap/ownerKey/ownerKeyHash；`companionMcpTools.ts` / `companionMcpServer.ts` 无 `createOwnerCapability` / `isOwnerCapability` / `OWNER_CAPABILITY` / `mintOwnerAuthority` / `OWNER_AUTHORITIES` / `CompanionOwnerLedger` / `companion-decision` / `companion-applied` / `companion-authorize` / `echo_confirm` / `echo_reject` / `ownerSecretHash` / `ownerSecret`；官方 Companion MCP 仅 `echo_observe/echo_suggest/echo_status/echo_memory` ✓

## 3. 回归

| 门 | 结果 |
|---|---|
| typecheck | PASS |
| 定向 unit（ownerAuth/companionFacet/companionGateway/worldBridgeServer/externalLinkLifecycle/agentLease/c3bBridge/companionBridge） | 8 文件 / 67 tests PASS |
| 全量 unit | 672 / 673 PASS；1 失败：`runtime.test.ts > B7 CLI strict schema > restore requires hashes...` CLI 冷启动超时（>15000ms），属 C3-c frame/restore CLI 冷启动性能问题，**与 B1 Owner 授权无关，非回归** |
| MCP 冷启动 build | PASS |
| 4 个独立负向探针 | 全部 PASS |

## 4. 残留与诚实边界（不掩盖）

1. **测试脚本需配合 B1**：`companionConsoleSmoke.mts` / `worldConsoleSmoke.mts` 的握手请求未携带 `ownerKey`，在 B1 后会返回 `owner_pairing_required`。这是**测试脚本需更新**（在握手体中加入 `ownerKey`），不是产品缺陷；产品握手已由 B1 探针实证通过（持 ownerKey 时 200 + ownerCap）。
2. **Lead 真实 LLM 建议实跑：本轮不允许**。B1 已修复，但 P3-b A 的后续接线（gateway/bridge/官方 MCP/Owner UI）虽已落地，尚未有真实模型逐轮建议的端到端证据；控制台只是工具，不预写策略，不冒充真实 LLM。
3. **Signal 接线仍未完整**：`87ab379` 的父提交 `1b0dca0` 已引入 P3-b B 核心 Signal 设备 / v2 能力 / Headless Signal Combat（`src/world/sim/signalState.ts`、`src/signal/` 纯规则、`src/world/sim/core.ts` Signal 指令、`world_signal_status` 工具），但**正式 Relay 协作场景 / 五视口状态 / 能量建议 / 跨端 echoSignal 字节 parity / 完整 E2E / 真实模型 Signal 遭遇均未实施**。默认旧 run 不挂 Relay 门；Signal 只在显式 `spawn-signal-device` 后存在。不能当完整 P3-b，更不能当 C。
4. 本轮不提供跨端 echoSignal 字节 parity、无真实模型逐轮建议，两份既有真实 LLM 最小玩家遭遇（Rendered `lead-live`、Headless `lead-headless-cropped`）是 P3-a 前证据，不代表 ECHO 已跑 LLM。

## 5. 报告目录

`reports/ai-native-02/reviewer/p3b-owner-auth-fix/`：`REVIEW.md`、`GATES.md`、`gate-*.log`、`reviewer-probe-*.mts`（4 个独立探针）。

未修改生产源码/已有测试/配置/分支；未合并/重置；未读取/恢复共享 WIP/stash。
