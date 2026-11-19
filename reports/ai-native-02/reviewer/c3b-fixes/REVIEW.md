# C3-b 动作/竞态/观察/Agent 租约 修复独立重验（8b9705d）

- **被测提交**：`8b9705d6bce1894b08717c0180e127f26de8e2f5`（HEAD），父 `21c3995`（C3-b 修复），祖父 `8ec8758`
- **分支**：`feat/ai-native-world-integration`；未读/不恢复 stash；未使用 untracked 共享 WIP `src/ai-native/worldHeadless.*`（C3c WIP）
- **复核方式**：`git archive` 冻结精确 hash 快照 `D:/Project/lastsignal-c3bfixes-review-8b9705d`（`node_modules` junction）；`git hash-object` 全量比对 → `ALL_TRACKED_FILES_MATCH`（1707/1707）
- **凭据安全**：所有探针用进程内随机假 token；token 不出现在日志/参数/URL/截图；Windows token 文件用 `icacls` 仅当前 SID（实测 `WIN_ACL_INHERITED=false / WIN_ACL_OTHERS=false`），未假称 chmod 有效
- **结论：上一轮 3 个阻断均已闭环；无新的硬阻断。** 可由 Lead 的真实 Agent 在接口层操作；C3c 可继续。仍有 4 项非阻断限制需 Lead 决策/后续修，真实 LLM 实跑仍是未完成的验收项。

## 一、质量门一行结果（命令 → 结果 → 日志）

| 门 | 命令 | 结果 | 日志 |
|---|---|---|---|
| 类型检查 | `npm run typecheck` | PASS exit=0 | `gate-typecheck.log` |
| 定向 unit（duration/lifecycle/observation/lease/bridge/control） | `npx vitest run ...` | PASS 56/56 | `gate-unit-c3bfixes.log` |
| C2 回归 unit（core/parity/rewiring） | `npx vitest run src/world/sim/{core,parity,rewiring}.test.ts` | PASS 40/40 | `gate-unit-c2.log` |
| C2 node/kill/room/loot parity | `vite-node scripts/c2-*.ts` | 8 / 13 / 220 / PASS | `gate-c2-*.log` |
| MCP build | `npm run game:mcp:build` | PASS | `gate-mcp-build.log` |
| MCP lease smoke | `vite-node src/ai-native/worldMcpLeaseSmoke.mts` | PASS（list_live attached / list_dead not attached / observe_dead fails） | `gate-mcp-lease-smoke.log` |
| C3b E2E（3 specs） | `PORT=5404 npx playwright test c3b-external-link c3b-hard-disconnect c3b-link-form` | PASS 12/12 | `gate-e2e-c3bfixes.log` |
| 独立 projectile 裁剪探针 | `vite-node reviewer-probe-crop.mts` | PASS 9/9 | `gate-probe-crop.log` |
| 独立 Agent lease 探针 | `vite-node reviewer-probe-lease.mts` | PASS 14/14 | `gate-probe-lease.log` |
| Windows token ACL | `vite-node scripts/c3b-token-acl-gate.mts` | PASS（icacls current SID；无继承/其他人；token 未打印） | `gate-token-acl.log` |
| staging build 无 handle | `vite build --mode staging` + grep | 无 `window.__game =` | 见报告 |

## 二、逐项闭环

### 1. ticks 按真实 core tick / 批量多 tick / 跨帧 / TTL 途中到期 / 重复 id —— **已闭环**
- `externalLink.ts` 新增 `durationTicks`（1..MAX_ACTION_TICKS）、`beginExecution`（绑定 epoch + 截止校验）、`advanceExecution(coreTicks, …)`。
- `World.stepFrame` 在 active 时按**真实 core ticks** 消费：若本帧 ticks 超过剩余，先跑 `remaining` 带 intent，再跑 `rest` 带 neutral（绝不超发）；否则跑 `ticks` 并 `advanceExecution(ticks)`。
- E2E：`ticks=1` → `executedTicks=1`，`ticks=120` → `executedTicks=120`，位移 `d1=0.081` vs `d120=6.064`；一帧 15 tick 与 15×1 tick 等价；超发被 neutral 截断；blocked move 仍 `applied` 但无位移；fire 受真实冷却/弹药约束；TTL 中途到期 → `expired`；重复 request/action id 不重执行。
- 定向 unit `externalLinkDuration.test.ts` 11/11 覆盖以上。

### 2. receipt started/completed/executedTicks 精确 —— **已闭环**
- `ExternalActionReceipt` 现含 `startedTick/completedTick/executedTicks/durationTicks`；E2E 日志显示 `started1=11, completed1=12, executed1=1; started120=28, completed120=148, executed120=120`。
- `applied` 语义明确为“合法 intent 已提交 N 个真实 tick”，不保证命中/位移（blocked move 亦可 applied）——与 Lead 要求一致。

### 3. await 后 lifecycle 校验 / before-after 互斥 / takeover 竞态 —— **已闭环**
- 控制器每次异步操作 `capture()` 局部 client+epoch+generation，**每个 await 后 `live()` 复核**（client 同一、未 closed、CONNECTED、epoch 一致、owner=external）；`beforeBusy/afterBusy` 互斥；`degrade()` 先 `generation++`、`yield`、`abortInFlight`、`client=null`。
- E2E：长动作进行中 takeover → **无 pageerror、新 epoch 后无迟到 ACK**；上一轮的 `Cannot read properties of null (reading 'heartbeat')` 已不再出现。
- `externalLinkLifecycle.test.ts` 6/6 覆盖 late continuation 不得 heartbeat/ACK/observation/attach。

### 4. 弹丸与 actor 同感知裁剪 —— **已闭环**
- 新增纯函数 `externalObservation.ts`，用与 actor 相同的 `isPerceivable(x,y)` 过滤 projectiles。
- 独立探针：near 可见；behind-wall / far/other-room / unexplored 全部不返回；drones/targets 亦按 perceivedActors 过滤；payload 无 seed/map/rng/pending/ledger；projectile 无隐藏字段。
- E2E：hidden/far/other-room enemy projectiles 不在 observation。

### 5. Agent lease 独立于 browser heartbeat；第二 agent / 旧 lease / 长推理 / hardkill / list —— **已闭环**
- 新 `agentLease.ts`：每 session 一个 live lease（第二个 attach → 409 `agent_already_attached`）；`renew` 需显式 `leaseId+session+epoch`（未知/旧/错 epoch → 404/409）；`reap` 到 `AGENT_LEASE_MS=4000`（reaper 200ms）过期 → `yieldSession`+`closeSession`；`invalidateSession` 于新授权/yield/close。
- browser `/heartbeat` 不续 lease；lease 过期后返回 503 → 控制器降级 HUMAN/LOST、清 pending。
- `world_list_sessions` 经 `/agent-status` 远程校验，dead 时 **不** `attached:true`；MCP lease smoke 验证 list_live attached=true、list_dead attached=false。
- 独立 lease 探针 14/14：second attach 409、正确续约 200、未知 leaseId 404/409、错 epoch 409、agent-status live/expired、**续约不延长 action `applyByTick`**（tick3+ttl5=8）、过期后 closed/503/不可 re-attach。
- `c3b-hard-disconnect.spec.ts`：独立 MCP 进程 SIGKILL → 期限内 lease 过期、yield、清 pending、禁止自动 re-attach，E2E PASS。

### 6. token-only 新路由权限与 Origin / 无 Agent 自授权 —— **已闭环**
- `/agent-renew`、`/agent-status` 属 agentRoute：无 Origin 的本地进程需 token；带 Origin 必须是精确 allowlist；agent 不能创建 session（仅 `handshake` 且需 `authorized:true`+Origin）。
- 上一轮 auth 探针（错 Origin/错 epoch/无会话 attach/closed re-attach）结论仍成立；本轮 bridge 单测 9/9 覆盖。

### 7. UI 表单凭据生命周期 / 键盘不误操 / staging no handle —— **基本闭环（1 项限制）**
- 表单：`type=password`、`autocomplete=new-password`、提交后立即 `tokenInput.value=''`、仅内存 `__externalLinkConfig`、不落盘/不打印；URL 仅允许本机 `http://127.0.0.1|localhost:PORT`；root 对 keydown/keyup/keypress 与 pointer/click `stopPropagation`，打字不会触发 W/A/S/D/ESC；错误为 code/messageKey（不含 token）。`c3b-link-form.spec.ts` 五视口 PASS。
- staging build：`__LAST_SIGNAL_DEV_TEST__ = mode==='development'||mode==='test'`；staging 构建**无 `window.__game =`**（仅通用字符串表中出现 `__game` 字样）。
- **限制**：授权后 token 仍保留在 `globalThis.__externalLinkConfig` 与控制器 options 中（表单输入已清空）；`closeExternalLinkForm` 只移除 DOM、不删除 global。见第四节。

### 8. C2 writer/tick/存档不回退 —— **已闭环**
- `stepFrame` 的 tick 拆分仅在 external active 时生效；C2 core/parity/rewiring unit 40/40；node 8 / kill 13 / room 220 / loot parity 全 PASS。

## 三、无硬阻断

上一轮 3 个阻断（ticks 忽略、afterFrame/degrade 竞态、projectiles 泄漏）均已修复并有独立探针/单测/E2E 证据。未发现新的硬阻断。

## 四、非阻断限制（需 Lead 决策/后续修）

1. **`stop` 不抢占 active 动作（FIFO）**：`hasActive` 时 `beforeFrame` 不拉取下一个动作，`stop` 只有当前动作完成后才执行；一个 120-tick move 无法被中途 stop。开发者的测试明确“stop 是单次合法提交、FIFO、不自动恢复”。若 Lead 要求“stop 立即抢占”，需增加 preempt 路径（取消 active 并计 executedTicks）。**需 Lead 明确语义**。
2. **`globalThis.__externalLinkConfig` 保留 token**：授权后 token 常驻页面全局（控制器也需持有），`closeExternalLinkForm` 不清除。建议授权成功后从 global 删除（或存 non-enumerable/弱引用），仅控制器持有。
3. **lease 注册表无长期上限**：`leases`/`expiredSessions`/`versionBySession` 只增不删（每个 attach/重新授权新增 lease）。长寿命 bridge + 多次重授权会缓慢增长。建议按 session 只保留 latest + 定期清理 expired。
4. **renderer receipt cache 仍为 32 FIFO**：agent 的 action 去重由 gateway 墓碑保证（`E_RETRY_AFTER_EVICTION`），不会重执行；但页面侧 receipt 可能被淘汰，影响诊断而非安全。可接受。

## 五、判定：真实 Agent 操作 / C3c / 限制

- **可由 Lead 的真实 Agent 在接口层操作**：ticks 真实执行、receipt 精确、租约独立且可 hardkill、观察裁剪、表单/ACL 均通过。真实 LLM/Headless 实跑仍未执行，是下一步验收项（用官方 `--world` MCP + 真实 token/lease，经 observe→action→ack 完成合法路线并归档原始证据）。
- **C3c 可继续**：C3-b 修复无硬阻断；建议先记录/决定第四节 1–3（尤其 stop 抢占语义与 token 全局清理），不阻塞 C3c 启动。
- **C2 维持已放行**，本提交未引入 C2 回退。
- **限制**：stop 非抢占；token 全局残留；lease 注册表无上限；真实 LLM 未跑。

## 六、报告目录

`reports/ai-native-02/reviewer/c3b-fixes/`：`REVIEW.md`、`gate-typecheck.log`、`gate-unit-c3bfixes.log`、`gate-unit-c2.log`、`gate-c2-*.log`、`gate-mcp-build.log`、`gate-mcp-lease-smoke.log`、`gate-e2e-c3bfixes.log`、`gate-probe-crop.log`、`gate-probe-lease.log`、`gate-token-acl.log`、`pw-out-c3bfixes/`；独立探针源在快照根 `reviewer-probe-{crop,lease}.mts`。

所有运行均在冻结快照与独占端口（dev 5404）上进行；未修改生产源码/已有测试/配置；未切换共享分支、未合并/重置；未读取/恢复 stash 或 C3c WIP。
