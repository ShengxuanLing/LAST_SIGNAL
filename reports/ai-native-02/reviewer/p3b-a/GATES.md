# 门禁逐行（每行 PASS/FAIL + 命令 + 结果 + 路径）

| 行 | 命令 | 结果 | 日志 |
|---|---|---|---|
| PASS | `npm run typecheck` | rc=0 | gate-typecheck.log |
| FAIL→PASS | `npx vitest run <6 targeted files>` | 首跑 1 failed（`src/ai-native/companionSurface.test.ts:25` `npm run game:mcp:build must run first`，冷构建前置缺失非回归）；补 `game:mcp:build` 后 **6 files / 49 tests PASS** | gate-targeted-unit.log / gate-mcp-build.log |
| PASS | `npm run game:mcp:build` | rc=0（companionMcpServer.mjs 已产出） | gate-mcp-build.log |
| PASS | `npm run build` | rc=0（3 个 HTML 入口） | gate-vite-build.log |
| PASS | `npx vite-node reviewer-probe-mcp-surface.mts` | `MCP_SURFACE_PASS`（生产 bundle 无 Owner 工厂/confirm/ownerSecret；SDK 工具恰 4 个） | gate-probe-mcp-surface.log |
| PASS | `npx vite-node reviewer-probe-bridge-owner.mts` | `BRIDGE_OWNER_PASS`（token-only/伪 Origin/普通对象/原型/跨 session/错 epoch/错 token 全拒；secret 不入任何响应；单次确认不双执行；receipt 不提前；AI 只读互斥；NO_MODEL） | gate-probe-bridge-owner.log |
| **FAIL（阻断）** | `npx vite-node reviewer-probe-reauth.mts` | `REAUTH_FAIL failures=1`：**Agent 用 token+伪 Origin 重跑 `/companion-authorize` 装自己的 secret，再自 confirm 成功**（`selfConfirm.status=200, ok:true`）；原浏览器 secret 失效 | gate-probe-reauth.log |
| PASS（阻断定界） | `npx vite-node reviewer-probe-reauth-boundary.mts` | `REAUTH_BOUNDARY_PASS`：无 Origin/错 session/错 epoch 均拒；**正确 session+epoch+伪 Origin → 200**；`companionAuthorize` 不校验既有 secret；launcher 明文打印 ORIGIN | gate-probe-reauth-boundary.log |
| **FAIL（阻断，最强形态）** | `npx vite-node reviewer-probe-agent-full.mts` | `AGENT_FULL_PASS`（断言的是漏洞成立）：**Agent 自己伪 Origin 握手→自授权→自观察→自提议→自 confirm，全程无人类**（`dec.status=200, ok:true`） | gate-probe-agent-full.log |
| **FAIL（阻断，最小知识）** | `npx vite-node reviewer-probe-agent-minimal.mts` | `AGENT_MINIMAL_PASS`（断言漏洞成立）：**Agent 空 body `attach()` 即拿到 session/epoch → 覆盖人类 ownerSecretHash → 在人类会话自 confirm + 自报 applied**，只需 token + 公开 ORIGIN | gate-probe-agent-minimal.log |
| PASS（观察伪造缺口） | `npx vite-node reviewer-probe-fake-obs.mts` | `FAKE_OBS_PASS`：裁剪证明只是自声明字符串，Agent 伪 Origin 可推送伪造 Boss target 并作为"感知"回读；额外隐藏字段仍拒 | gate-probe-fake-obs.log |
| PASS | `npx vite-node reviewer-probe-lease.mts` | `LEASE_HARDKILL_PASS`：4s 无续租硬过期、迟到 suggest/status/confirm/renew 全拒、ownerSecretHash 清理、无假连接 | gate-probe-lease.log |
| PASS | `npx vite-node reviewer-probe-contract.mts` | `CONTRACT_PASS`：裁剪证明/raw 拒、TTL、8 未确认硬界、512 dedup 硬界、memory 16、targets 证据、WeakSet 身份、严格枚举、不双执行 | gate-probe-contract.log |
| PASS（契约缺口） | `npx vite-node reviewer-probe-gateway-decide.mts` | `GATEWAY_DECIDE_PASS`（断言缺口）：**生产路径 `CompanionGateway.decide` 不校验 tick≥createdAtTick、不校验 decision 枚举**；`CompanionOwnerLedger` 无生产消费者 | gate-probe-gateway-decide.log |
| PASS（契约缺口） | `npx vite-node reviewer-probe-receipt.mts` | `RECEIPT_PASS`：决策前 applied 拒、confirm 时 applied=false、过期/未决策拒；**被 reject 的 id 仍可标记 applied=true** | gate-probe-receipt.log |
| PASS（契约缺口） | `npx vite-node reviewer-probe-external-mode.mts` | `EXTERNAL_MODE_PASS`：gateway `external` 只读生效；**但 `GameScene.authorizeExternalAgent` 不调用 `setOwnerMode('external')`**（AI toggle 调用了，非对称） | gate-probe-external-mode.log |
| PASS | `npx vite-node reviewer-probe-secrets.mts` | `SECRETS_BOUNDS_PASS`：无日志/全局泄漏、sha256 存储、4 会话硬界、token cleanup、Signal 未接线、console 无 confirm | gate-probe-secrets.log |
| PASS（残余） | `npx vite-node reviewer-probe-serialize.mts` | `SERIALIZE_PASS`：**TS `private` 仅编译期；`ownerSecret` 运行时可枚举且 `JSON.stringify(link)` 会带出**（生产无 `__game` 不可达） | gate-probe-serialize.log |
| PASS | `npx vite-node reviewer-probe-tocombatport.mts` | `TOCOMBATPORT_PASS`：真 port 原样返回（nearest-echo 选择不回退）、PlayerLike 走 `player.hurt`、不直写 HP | gate-probe-tocombatport.log |
| PASS | `npx vite-node reviewer-probe-preview.mts` | `PREVIEW_3ENTRY_PASS`：生产 `/`、`/economy.html`、`/station-zero.html` 三入口真实 DOM 且**无 `__game`**、无 page error | gate-probe-preview.log |
| FAIL→PASS | `npx vite-node reviewer-probe-owner-e2e.mts` | 首跑在 Pause 面板暂停态过早取样（pending=true/shots=0）判 FAIL；改为关面板等下一 core tick 后 `OWNER_E2E_PASS`：**人类 UI 授权→Agent 提议→Agent 自确认拒→人类 CONFIRM 只入队 1 条→下一 tick 真实 echo 开火 1 次→pending 清空→NO_MODEL** | gate-probe-owner-e2e.log |
| PASS | `PORT=5412 npx playwright test tests/p3a-enemy-target.spec.ts tests/audit.spec.ts -g "legacy|enemy|boss|Enemy|Boss"` | **3/3 PASS**（toCombatPort 兼容后 nearest-actor 目标选择/写边界不回退） | gate-targeting-e2e.log |
| PASS | `npx vite-node src/ai-native/companionConsoleSmoke.mts` | `COMPANION_CONSOLE_SMOKE_OK`（官方 REPL 无 confirm 工具、JSONL 脱敏） | gate-companion-console-smoke.log |
| PASS | `npx vite-node src/ai-native/worldHeadlessMcpSmoke.mts` | `HEADLESS_MCP_SMOKE_PASS` | gate-headless-smoke.log |
| PASS | `npx vite-node src/ai-native/worldConsoleSmoke.mts` | `WORLD_CONSOLE_SMOKE_PASS`（3/3） | gate-world-console-smoke.log |

- 关键错误行（如实保留）：
  - `FAIL headless unit | src/ai-native/companionSurface.test.ts:25:18 | npm run game:mcp:build must run first`（冷构建前置，补构建后全绿）
  - `FAIL BLOCKER: Agent CAN install its own secret and self-confirm -> Owner isolation BROKEN | {"reauth":{"ok":true,...},"selfConfirm":{"ok":true,"value":{"decision":"confirm",...}}}`
  - `FAIL Owner confirm committed a real echo intent/projectile | {"pending":true,"shots":0,"tick":6}`（探针取样时机问题，非产品缺陷；改后 PASS）
- 独立端口：dev server / 预览均用自有 **5412 / 5414**（strictPort、127.0.0.1）；bridge 用 `port:0` 临时端口；**5176 被他人进程占用，未触碰、未 kill**。token 全部进程内随机，未进日志/参数/URL/截图。
- 17 个 `reviewer-probe-*.mts` 均为本人只读独立探针；未改生产源/已有测试/配置；未读 WIP/stash；未 merge/reset。
- 未重复无关全量（按 Lead「必要 probe/unit + OwnerE2E」）。
