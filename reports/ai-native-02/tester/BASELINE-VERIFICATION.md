# AI-NATIVE-02 P1 — 独立测试环境与基线核查（Tester / 只读）

- Worker: `y6en9ua8phanll8cqi8dd8ru`
- 本单边界：只读源码；不修改生产代码 / 已有测试 / 配置；不切分支、不提交、不合并、不重置。
- 报告目录：`reports/ai-native-02/tester/`（`*.log` 已被 `.gitignore` 覆盖；`reports/` 未跟踪，仅本 Worker 使用）
- 结论口径：日志里的是命令原始输出；本文正文只给结论。

---

## 1. 基线事实（gate 时刻）

| 项 | 值 |
| --- | --- |
| commit | `860a0dd78fb741896c2f1433742603dd91e37fc8` |
| 分支 | `feat/ai-native-world-integration` |
| origin/main | `860a0dd78fb741896c2f1433742603dd91e37fc8`（与 HEAD 一致） |
| 工作树 | **clean**（gate 执行时无 M/?? 条目） |
| 记录 | `00-git-state.log` |

> 说明：gate 之后 Developer 已开始 AI-NATIVE-02 P1 开发（工作树出现 `M src/entities/Player.ts`、`src/scenes/GameScene.ts`、`src/scenes/PauseScene.ts`、`src/world/World.ts`，新增 `src/ai-native/control.ts`、`localController.ts`、`worldObservation.ts`、`control.test.ts`、`tests/ai-native-world.spec.ts`）。**开发中快照不算最终验收**，最终验收必须重新记录 commit + 工作树状态。

## 2. 基线 gate（在 clean 860a0dd 上执行）

| Gate | 命令 | 结果 | 关键数字 | 日志 |
| --- | --- | --- | --- | --- |
| typecheck | `npm run typecheck` | **PASS** | 退出码 0 | `01-typecheck.log` |
| unit | `npm test` | **PASS** | 13 files / **292 tests** | `02-unit.log` |
| build | `npm run build` | **PASS** | 退出码 0，`✓ built in 13.08s`（保留 enemies chunk 1.49MB 既有警告） | `03-build.log` |
| mcp build | `npm run game:mcp:build` | **PASS** | `dist-mcp/mcpServer.mjs 300.99 kB` | `06-mcp-build.log` |

## 3. npm scripts 核查

| script | 入口 | 存在 | 验证 | 备注 |
| --- | --- | --- | --- | --- |
| `dev` | `vite` | ✅ | 实测：5173（既有）+ 自建 5280/5281/5290 | 端口由 `vite.config.ts`（5173）或 `--port` 控制 |
| `build` | `vite build` → `dist/` | ✅ | PASS | 入口 `index.html` + `station-zero.html` |
| `preview` | `vite preview` | ✅ | 实测 5290 `200`（root/slice） | 服务的是**已构建 dist**，不含 HMR；但 audit 用例需要 dev server（`await import('/src/...')`），故 preview 不能跑全量 E2E |
| `typecheck` | `tsc --noEmit` | ✅ | PASS | — |
| `test` | `vitest run` | ✅ | PASS 292/292 | `vitest.config.ts` include `src/**/*.test.ts` |
| `test:watch` | `vitest` | ✅ | 未执行（watch 模式） | — |
| `playwright` | `playwright test` | ✅ | 实测多组通过（见 §5） | **无 `webServer`**，须手动起 5173/5199 |
| `game:headless` | `vite-node src/ai-native/headlessCli.ts --run --dev` | ✅ | smoke PASS：create/observe/step/quit（`05-headless-smoke.log`） | 驱动的是 Station Zero 纯规则核心（非正式 World、不可见）；npm 横幅写 stdout，协议入口建议直接 `npx vite-node ... --run --dev` |
| `game:mcp` | `vite-node src/ai-native/mcpServer.ts --dev` | ✅ | 直连 smoke PASS：initialize + tools/list = **6 个 Player 工具**（`11-mcp-smoke.log`） | stdio JSON-RPC；**不要**用 `npm run` 走协议，npm 横幅会污染 stdout |
| `game:mcp:client` | `mcpClient.mts` | ✅ | 未执行 | 依赖 `npm run game:mcp:build` 产物 + 实时 MCP server |
| `game:agent-client` | `agentClient.mts` | ✅ | 未执行 | `[--dev] [--log FILE] [--script FILE]`，依赖 built MCP server |
| `game:replay-p4` | `replayPlayerTrace.mts` | ✅ | 未执行 | 依赖 P4 trace + built MCP server |
| `game:coop-demo` | `coopDemo.mts` | ✅ | 未执行 | dev-only coop demo |
| `game:budget-client` | `budgetClient.mts` | ✅ | 未执行 | 依赖 built MCP server |

未执行项均为“需要实时 MCP/agent 会话或历史 trace”的 Node 侧脚本，不属于本单浏览器验收范围；进入验收前应由实际运行验证，而不是引用开发者自测。

## 4. 正式 World 的 Playwright 入口盘点

**正式 World** = `index.html` / `src/main.ts` 的 Phaser 世界（`GameScene` + `src/world/World.ts`）；`station-zero.html` 是 Station Zero 切片，两者不可混称。

| 文件 | 目标页面 | 测试数 | 是否正式 World | 端口 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `tests/audit.spec.ts` | `/` | 2 | ✅ | `PORT`（默认 5173） | 动态 `import('/src/config/upgrades.ts')` → **必须 dev server** |
| `tests/gameplay.spec.ts` | `/` | 1 | ✅ | `PORT` | 零 console error 断言 |
| `tests/checkpoint.spec.ts` | `/` | 5 | ✅ | `PORT` | 存档/死亡/续局，最贴近 P1 家族 |
| `tests/runtime-bugs.spec.ts` | `/` | 2 | ✅ | `PORT` | 读源码静态断言（`LAST_SIGNAL_ROOT`） |
| `tests/whale-character.spec.ts` | `/` | 1 | ✅ | `/`(默认) | 角色外观 |
| `tests/boss-room.spec.ts` | `http://localhost:5173/` | 1 | ✅ | **硬编码 5173** | `test.use({viewport:1440x900})` |
| `tests/canvas.spec.ts` | `http://localhost:5199/` | 1 | ✅ | **硬编码 5199** | HUD 像素采样 |
| `tests/vs00.spec.ts` | `/station-zero.html` | 9 | ❌ 切片 | `PORT` | — |
| `tests/vs01.spec.ts` | `/station-zero.html` | 4 | ❌ 切片 | `PORT` | — |
| `tests/economy.spec.ts` | `/economy.html` | 1 | ❌ 经济 | `/`(默认) | — |
| `tests/ai-native-world.spec.ts`（开发中新增，未跟踪） | `/` | 3 | ✅ | `PORT` | P1 接管/暂停/死亡/重启 + 3 分辨率 HUD，见 §7 |

`playwright.config.ts`：`testDir:'./tests'`、`timeout:60000`、`fullyParallel:false`、`viewport 1280x720`、`baseURL=http://localhost:${PORT ?? 5173}/`、`launchOptions.args=['--no-sandbox','--disable-dev-shm-usage']`、**无 `webServer`**。

全库 grep 未发现任何 OS 级输入 API（`nut-js`/`robotjs`/`SendKeys`/`keybd_event`/`mouse_event`/`pyautogui`/`SetCursorPos`）；E2E 只用 `page.keyboard`/`page.mouse`/`page.evaluate` —— 符合“不能用系统键鼠替代 Agent 接口”。

## 5. 可运行测试环境与端口隔离（实测）

环境：node `v24.20.0`、npm `11.19.0`、`@playwright/test 1.65.0`、浏览器 `chromium-1254` / `chromium_headless_shell-1254`（无头，不占桌面）。

既有 5173 / 5199 由当前仓库 `node_modules/vite/bin/vite.js --port <N> --strictPort` 提供（本工作树），可直接复用。

| 验证 | 命令（要点） | 结果 | 日志 |
| --- | --- | --- | --- |
| 自建端口可服务 | `vite --port 5280 --strictPort` | root/slice/economy 均 200 | `dev-5280.*.log` |
| `PORT` 隔离生效 | `PORT=5280 npx playwright test tests/checkpoint.spec.ts` | **5 passed** | `04-pw-checkpoint-5280.log` |
| `PORT` 隔离生效（正式 World 4 文件） | `PORT=5280 ... audit/gameplay/runtime-bugs/whale-character` | **6 passed** | `07-pw-world-5280.log` |
| 硬编码端口不受 `PORT` 影响 | `PORT=5280 ... boss-room + canvas` | canvas PASS（走 5199）；boss-room 失败：`Execution context was destroyed, most likely because of a navigation`（页面被 HMR 整页刷新，见下） | `08-pw-hardcoded-port.log` |

**关键结论**
1. `PORT` 只能隔离 **PORT 感知** 的用例；`boss-room.spec.ts:20`（5173）与 `canvas.spec.ts:7`（5199）硬编码，**无法**与开发者实例并发隔离。新实例并发跑全量套件不可行，除非改测试（本单不可动）/由 Lead 决定是否改配置。
2. **共享 dev server + 开发中编辑 = HMR 整页刷新**：实测 18:30 前后 Developer 正在写 `src/`，boss-room 在 `waitForFunction` 成功后被整页 reload，报 “Execution context was destroyed”。这就是它失败的根因，不是产品回归。**验收必须在代码冻结后、安静的工作树上跑**。
3. **冻结快照流程（已验证，推荐给最终验收）**：
   - `robocopy` 复制工作树到仓库外目录（排除 `node_modules/.git/dist/dist-mcp/reports/test-results/screens/tests/screens`）；
   - `New-Item -ItemType Junction` 把 `node_modules` 指向原仓库（避免重复安装）；
   - 在快照目录起 `vite --port 5281 --strictPort`；
   - `PORT=5281 LS_SHOT_DIR=<仓库外> LAST_SIGNAL_ROOT=<快照> npx playwright test ...`；
   - 实测 `checkpoint + audit` **7 passed**（`10-pw-snapshot-5281.log`），dev server 无 watch 干扰，且 `audit` 的 `/src` 动态导入可用。
   - 每次验收记录：快照来源 commit + 工作树 `git status --porcelain` + 被验收文件 MD5。

**资源/稳定性提醒（实测）**：本机 15.8GB 内存，连续大量 Chromium 启动后仅剩 ~5.1GB；一次 WIP 预检出现 `worker-0 process did not exit within 300000ms`（挂 5 分钟被强杀）与 `worker process exited unexpectedly (code=3221225794 / 0xC0000142)`。验收时：`--workers=1`、一次只跑一个 spec、跑前确认无游离 chromium、单 spec 超时 ≥300s、异常时先清理进程再重试，并在日志中保留完整输出。

## 6. 数据与采样口径（供分辨率/HUD 断言）

正式 World 用 `Phaser.Scale.FIT + CENTER_BOTH`，逻辑分辨率恒为 `1280x720`；CSS 画布按视口缩放并可能上下/左右留黑边。实测（WIP 快照 `12-resolution-probe-wip.log`）：

| 视口 | canvas CSS | 内部 | 缩放 | 备注 |
| --- | --- | --- | --- | --- |
| 1920x1080 | 1920x1080 | 1280x720 | 1.5 | — |
| 1366x768 | 1365.33x768 | 1280x720 | ~1.067 | — |
| 1280x720 | 1280x720 | 1280x720 | 1.0 | 配置默认 |
| 1024x768 | 1024x576 | 1280x720 | 0.8 | 上下留黑边各 96px |
| 800x600 | 800x450 | 1280x720 | 0.625 | 13px 逻辑字 ≈ 8.1px 物理 |

因此：
- 采样/点击必须用 `canvas.getBoundingClientRect()` + `rect.x + logicalX * (rect.w/1280)` 变换，不能直接点逻辑坐标；
- 800x600 下 13px 控制行物理高 ~8.1px，是**可读性下限**，需人工看截图 + 记录物理字号；
- 内部相机是 1280x720，HUD 逻辑坐标不变，但像素采样要按缩放换算。

## 7. 开发中快照的前置观察（**不是验收结论**）

以下都在 `reports/ai-native-02/tester/` 的探针里，针对 18:38 的 WIP 快照（含未完成的 `control.ts`/`localController.ts` 集成）：

- 接管探针（`13-takeover-probe-wip.log`）：ESC 暂停 → `mode=PAUSED`；暂停菜单开 AI → `owner=ai, paused=true`；ESC 恢复 → `mode=AI · LOCAL DETERMINISTIC`、`lastAiAction=ENGAGE`、目标 `HOSTILE #3 hunter`、玩家真实移动、无 console/page error；随后 AI 升级触发 `LevelUpScene`，导致注入的 `KeyW` 落到 `LevelUpScene` 而非 `GameScene`，**未完成安全夺回采样** → 验收必须在无 LevelUp 覆盖时做夺回，否则会误判。
- P1 WIP spec 预检（`14-pw-wip-p1-precheck.log`）：test 1 在 `AI actually moved (>2 distinct positions)` 失败（收到 2），随后 worker 挂起被强杀、1920x1080 用例 `0xC0000142` 崩溃。该结果只说明 **WIP 代码/环境当时不稳定**，不能作为最终判定；最终验收需在冻结快照上重跑。

## 8. 一行式回报格式（本单约定）

gate 类命令只在对话里报：`PASS/FAIL + 命令 + 结果 + 日志路径`；失败追加最相关一行错误。完整输出全部落 `reports/ai-native-02/tester/*.log`。
