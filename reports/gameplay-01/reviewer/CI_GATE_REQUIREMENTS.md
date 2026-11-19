# GAMEPLAY-01 · CI 密闭性最小方案候选（Reviewer，只读评估）

> 本文件只给**要求与候选方案**，不改 `.github/workflows/ci.yml`、不改 `src/`/`tests/`、不跑全量。Lead 已决定「CI 密闭性先修」，developer 提案、tester 锁定 P0 基线后再改。

## 0. 判定标准（什么叫"修好了"）

一条 CI 必须同时满足 4 条，否则不算闭环：

1. **干净环境可复现**：`git clone`（或 `git archive`）一棵树 + `npm ci` + 流程步骤 → 同样的 PASS/FAIL，不依赖任何本机未提交产物（`dist-mcp/`、`reports/**` 残留、`dist-test/`、本地 `.env`）。
2. **顺序正确**：产物在被消费之前产生；不允许"单元测试先跑、却需要 E2E 的产物"。
3. **缺产物 = FAIL（不是 skip）**：门禁的失败信息必须直接点出"缺哪个产物、该跑哪个命令"，不允许 `it.skip` / `if (missing) return` / `catch{}` 静默放行。
4. **失败可归因**：报错先给"缺什么"，再给"断言差多少"，避免把环境问题伪装成产品回归（这次 CI 红就是反例）。

## 1. 现状事实（我已在 P0 阶段实测/实读）

| 事实 | 来源 |
|---|---|
| CI 步骤顺序：`npm ci` → playwright 安装 → `npm run typecheck` → `npm test` → `npm run build` → 双 vite server + `npx playwright test` | `.github/workflows/ci.yml` |
| CI **没有** `npm run game:mcp:build`；`dist-mcp/` 在 `.gitignore:6` | ci.yml / .gitignore |
| `npm test` 在 CI 挂 4 条：`companionSurface`（要 `dist-mcp/companionMcpServer.mjs`）+ `signalRenderedHeadlessParity`（要 `reports/ai-native-02/signal/parity/{initial,sequence}.json`，3 条） | `logs/ci-44144683104-failed.log` |
| 干净归档树（`git archive 7aa8b51`，无 dist-mcp/无 reports）复现同样 4 条失败；本机同两文件 4/4 PASS | `logs/cleansim-two-unit-files.log`、`logs/local-two-unit-files.log` |
| parity 产物体积：`initial.json` **2.4 MB**、`sequence.json` 80 KB、`rendered.json` 108 KB；生产者为 `tests/signal-rendered-parity.spec.ts`（`page.goto` + 180s 超时 → 需浏览器 + dev server） | 实测 `ls -l`、该 spec 源码 |
| `vitest.config.ts` 的 `include` 是 `src/**/*.test.ts`（全量 `npm test` 会带上任何 `*.test.ts`） | vitest.config.ts |
| 7 个 E2E spec 直接 spawn `dist-mcp/{companionMcpServer,worldMcpServer}.mjs` | `grep -rl dist-mcp tests/` |
| `companionFacet.test.ts` 已断言 `ai`/`external` owner 下 `suggest → E_PERMISSION` 且状态 `readOnly` | 该文件 :188-201 |
| `__game` 只在 `__LAST_SIGNAL_DEV_TEST__`（dev/test mode）挂载，生产构建应被 tree-shake | `src/main.ts:41`、`vite.config.ts:11` |

## 2. R1 —— MCP bundle 必须先构建（阻断）

- **问题**：`npm test` 里有门禁要求 `dist-mcp/` 存在；E2E 有 7 个 spec 要 spawn 其中的 server。
- **最小候选**：
  - **A1（推荐）**：CI 在 `npm test` 之前插入一步 `npm run game:mcp:build`；并在 `npm test` 之前缓存 `dist-mcp`（`actions/cache`，key 由 `vite.mcp.config.ts` + `src/ai-native/**` 哈希决定）。
  - A2：把 `game:mcp:build` 合并进 `npm run build`（`build: vite build && vite build --config vite.mcp.config.ts`）。取舍：本地/CI 都自动一致，但把"前端构建"和"MCP 产物"耦合，单跑 `npm run build` 变慢。
- **验收**：干净树执行 `npm ci && npm run game:mcp:build && npm test` → `companionSurface` PASS；且 `dist-mcp/companionMcpServer.mjs`、`worldMcpServer.mjs`、`chunks/` 均存在。反向验收：不跑该步时 `companionSurface` 必须**明确红**并打印"请先 npm run game:mcp:build"。
- **禁止**：把 `dist-mcp/` 提交进库；或把该门禁改成"文件不存在就跳过"。

## 3. R2 —— `npm test` 不得依赖 E2E 残留（阻断）

- **问题**：`signalRenderedHeadlessParity.test.ts` 在 `npm test` 里读取 `reports/ai-native-02/signal/parity/*.json`，而其生产者是 Playwright spec —— 顺序上不可能满足。
- **最小候选**：
  - **B1（推荐：拆 gate，改动最小）**：把该文件从 `*.test.ts` 改为**独立 gate 入口**（例如 `src/ai-native/gates/signalRenderedHeadlessParity.gate.ts`），新增 `vitest.gate.config.ts`（`include: ['src/ai-native/gates/**/*.gate.ts']`）与 `npm run test:gates`；`npm test` 保持只跑 `src/**/*.test.ts`。CI 里 `test:gates` 排在 Playwright 之后（见 R3）。取舍：文件挪位 + 一个 config + 一个 script，逻辑零改动。
  - B2（更彻底但更贵）：为该 export 提供**无浏览器**的 node 侧生产者（现成脚本 `scripts/c3c-rendered-headless-parity.mts`/`p3a-echo-rendered-parity.mts` 都不是这个数据的生产者；需要新写渲染侧导出，成本高，不建议在 P1 之前做）。
  - **B3（不推荐）**：把三个 JSON 提交进库。`initial.json` 2.4 MB、且它是**渲染实例的快照**，与代码版本强耦合，一旦源码改动就变成陈旧门槛（比不提交更危险）。
- **验收**：干净树 `npm ci && npm run game:mcp:build && npm test` → 0 failed（不再依赖 `reports/**`）；`npm run test:gates` 在 E2E 之后跑时 PASS。
- **禁止**：`it.skipIf(!existsSync(...))`、`try { readJson } catch { return }`、放宽 `missing === 0`。

## 4. R3 —— parity 集成 gate 的正确顺序（阻断）

- **问题**：数据生产者（Playwright）必须在消费者（parity vitest）之前；CI 当前顺序相反。
- **最小候选**：
  - **C1（推荐）**：同一 job 内顺序改为 `… → npm test → npm run build → vite 双 server + npx playwright test → npm run test:gates`。Playwright 生成 `reports/.../parity/*.json` 后，gate 立即消费同一棵树。
  - C2：拆成两个 job（`e2e` 与 `gates`），用 `actions/upload-artifact`/`download-artifact` 传递 3 个 JSON。取舍：并行更快、更清晰，但多一套 artifact 配置与失败传播规则。
- **验收**：CI 日志能证明「生成 → 消费」同一次运行内完成（gate 步的输入目录里 3 个文件的 mtime 晚于 Playwright 步开始时间）；并补一条 `test:gates` 的**前置检查**：3 个文件缺失时输出"请先运行 npx playwright test tests/signal-rendered-parity.spec.ts"。
- **禁止**：让 gate 在缺少产物时静默通过；或把 `npm test` 放在 Playwright 之后（会把单测步骤拖到 10+ 分钟，且掩盖真正的问题）。

## 5. R4 —— 缺产物必须 FAIL（阻断，门禁语义）

- 保持 `missing === 0` 的硬断言；把"这条门禁预期产物存在"编码成**入口分离**（`npm test` 不含它；`npm run test:gates` 含它），而不是用 skip 条件。
- 反向验收（必须加）：在**故意删掉** `reports/ai-native-02/signal/parity/` 的干净树上跑 `npm run test:gates` → 必须 **FAIL**，且错误信息包含缺失文件名 + 生成命令。这条反向验收本身就是 R4 的验收用例。

## 6. R5 —— Player / Dev 泄露验收（新增门禁，阻断）

现状：`__game` 由 `__LAST_SIGNAL_DEV_TEST__` 控制（dev/test 才挂），但**没有门禁断言生产构建产物里确实剥离了它**，也没有断言 Player 面不含 dev-only 命令/字段。

- 最小候选（三项都要，成本都低）：
  1. **构建产物门禁**：`npm run build` 后，对新产物做字符串检查：`dist/assets/*.js` 中不得出现 `__LAST_SIGNAL_DEV_TEST__` 的真值分支/`__game` 赋值（可 grep `window.__game`/`globalThis.__game`）。放在 CI 的 build 步骤之后，作为独立 `scripts/gate-prod-strip.mjs`（node，秒级）。
  2. **Player MCP 面门禁**：断言 `dist-mcp/mcpServer.mjs` / `worldMcpServer.mjs` 的**默认（非 `--dev`）**工具清单不含 dev-only 命令（例如 dev signal/step/push 类），且 `--dev` 才注册；同时断言 observation payload 不含 dev-only 字段（如内部 tick 调试、RNG 状态、sim 内部缓存）。参考现有 `worldHeadlessSignal.test.ts` 的 "Dev signal commands" 用例形态，但要在 **bundle 产物**层断言，而不是源码层。
  3. **对 Player 的读取面**：`Player` 观察字段白名单（与 Owner/Agent 面隔离），新增一条负向断言：agent/牌表接口不可读到 Dev 信息（沿用 `companionSurface.test.ts` 的手法，检查 bundle 里是否出现 dev-only 标识）。
- 验收：干净树 `npm run build && npm run game:mcp:build && node scripts/gate-prod-strip.mjs && npx vitest run <player-surface gate>` → PASS；反向：临时把 `__LAST_SIGNAL_DEV_TEST__` 改成真值 → 门禁必须红。

## 7. R6 —— external owner 负向验收（部分已有，需补 e2e）

- 现状：`companionFacet.test.ts:188-210` 已断言 `ai`/`external` owner → `suggest` 返回 `E_PERMISSION`、状态 `readOnly`、pending 被取消（**单测层已覆盖**）。
- 缺口：**e2e 层**没有"external owner 时 agent 的 suggest 不会改变 echo/不会产生队列意图"的断言；UI 层也没有"external owner → LLM 页 READ_ONLY + CONFIRM/REJECT 禁用"的固定用例（UI-REWORK 有 CONNECTED 场景，但没有 external-owner 场景）。
- 最小候选（一条 e2e + 一条 UI 断言）：
  1. e2e：授权外部 agent → 取 `control.owner === 'external'` → agent SDK `echo_suggest` → 期望 `ok:false` 且 `world.hasPendingCompanionIntent === false`、`echoShotsFired` 不增长、relay 状态不变；
  2. UI：同一状态下打开 LLM 页 → `STATE READ_ONLY`（或等价的只读文案）+ CONFIRM/REJECT `enabled === false`，且页面不得显示 `CONNECTED`。
- 验收：两条各自 PASS；反向：把 external 判定临时去掉 → 两条必须红。

## 8. R7 —— 干净环境自检（建议，非阻断但强烈推荐）

- 目的：防止"本机残留绿"再次发生。
- 最小候选：新增 `scripts/gate-clean-tree.sh`（或 CI 里的独立 job）：`git archive HEAD | tar -x -C $(mktemp -d)` → 在临时树里跑 `npm ci && npm run game:mcp:build && npm test`，断言 0 failed。取舍：一次 `npm ci` 约 60–90s，可只在 `workflow_dispatch`/nightly 跑，或给 `src/ai-native/**`/`tests/**` 变更加路径过滤。
- 验收：这次的 4 条失败在临时树里必须消失；若把 `dist-mcp` 或 parity 产物再拿走，必须重新红。

## 9. 与 P2「低风险 allowlist」相关的门禁（设计约束，先记在这里）

Lead 已定：**只有用户显式开启授权模式时**，才允许最小 allowlist 内的动作自动执行，且 allowlist 仅限 `follow / observe / 可验证的安全移动`；其余（资源消耗、重要环境改变、不可逆操作、assist 火焰等）仍走既有 Owner 正式确认，不得自动 confirm、不得向 agent 共享 Dev 信息。

- 门禁要求（P2 实现时落地，各一条正/负向）：
  1. 正向：授权模式 ON + allowlist 内动作 → 自动执行且**记审计事件**（谁授权、何时、什么动作、什么结果）；
  2. 负向：授权模式 OFF → 同样的动作必须被拒或退回 Owner 确认（不得静默执行）；
  3. 负向：allowlist 之外的任何动作（含 assist、能量消耗型）→ 即使授权模式 ON 也必须走 Owner 确认；
  4. 负向：Dev 信息（内部 tick/RNG/未公开状态）不得出现在 agent 可见 observation 或日志中；
  5. 负向：`external`/`ai` owner 下授权模式必须不可用（或自动失效），并保留 readOnly 语义。
- 这些门禁的验收命令形态：`npx vitest run <allowlist gate>`（单测层）+ 一条 e2e（真实 UI 开启授权 → 观察自动执行与审计事件）。

## 10. 建议的最小落地顺序（供 developer 提案）

1. **R1**（加 `game:mcp:build` + cache）：1 步 CI 改动，立刻解掉 `companionSurface`。
2. **R2+R3**（parity 拆 gate + CI 顺序）：2–3 个文件挪位 + 1 个 config + 1 个 script，解掉 3 条 parity 失败并恢复"硬门"意义。
3. **R4 反向验收**（删产物必须红）：几乎零成本，防止后人再 skip。
4. **R5 / R6**（Player/Dev 泄露 + external owner e2e/UI）：都是小门禁，但直接关系 Owner 边界，建议在 P1 动手前补齐。
5. **R7**（干净树自检）：nightly 或 dispatch 触发即可。

## 11. 本文件的边界

- 我**没有**修改 CI、`src/`、`tests/`；没有跑全量；没有提交任何东西。
- 本文件的事实基于：CI 失败日志（`gh run view 44144683104 --log-failed`）、干净归档树复现、`vitest.config.ts`/`vite.mcp.config.ts`/`package.json`/`.gitignore` 实读，以及 `companionFacet.test.ts` 的既有断言。
- 具体实现形态（config 文件名、script 名、job 拆分）留给 developer 提案；我只固定"要求 + 可执行验收标准 + 禁止做法"。