# LAST SIGNAL 0.2.0 实施工单拆解（IMPLEMENTATION TASKS）

本文件是设计审计产物，PHASE 0–5 的所有任务**本阶段均未授权执行**，需用户确认 6 个设计文档后，再逐阶段授权

> 本阶段只完成设计审计，未授权实现

> **本阶段未授权执行任何任务。** 本文是后续实施阶段的工单拆解，**不是本阶段（0.2.0 技术设计与架构审计）的执行清单**。本阶段唯一交付物是 `docs/` 下 6 个新建设计文档：`PROJECT_ROADMAP.md`、`SIGNAL_SYSTEM_DESIGN.md`、`AGENT_BRIDGE_ARCHITECTURE.md`、`HUMAN_AGENT_COOP_DESIGN.md`、`IMPLEMENTATION_TASKS.md`、`ARCHITECTURE_DECISIONS.md`。

---

## 0. 文档定位、授权边界与统一约定

### 0.1 定位

- 当前代码版本 `0.1.0`；目标计划版本 `0.2.0`；技术栈 Vite 5 + TypeScript 5 + Phaser 3.90（CANVAS 渲染）。
- 本文件把 `0.2.0` 的设计拆成 PHASE 0–5 的可执行工单；阶段名称与顺序严格按统一事实基座 FACTS §7.1。
- 本文任何任务的「最小实现方案」「验收标准」「测试命令」都只描述**后续逐阶段授权之后**的工作，**不构成对当前阶段的任何执行要求**。
- 本阶段唯一交付物为 `docs/` 下 6 个新建设计文档；本文只写自身，不写 6 个文档之外的任何文件；不改源码、不装依赖、不初始化 Git、不提交 commit。
- **本阶段明确禁止**：修改任何游戏源码、修改 `docs/STYLE_GUIDE.md`、写 6 个文档之外的任何文件、写项目 `dist/`、`test-results/`、`tests/screens/`、`node_modules/`、安装依赖、删除文件、初始化 Git、创建 `.gitignore`、提交 commit。

### 0.2 状态标签（全文统一）

| 标签 | 含义 |
|---|---|
| `【已实现】` | `0.1.0` 中已经存在的源码、符号、测试或行为 |
| `【需扩展】` | 在真实存在的文件上增加能力 |
| `【需新建】` | `0.1.0` 中不存在、需要在后续授权阶段新建的文件 / 目录 / 进程 / 测试 |
| `TBD — Requires User Decision` | 涉及核心玩法 / 协议 / 安全 / 存档格式的重大未定决策，必须由用户拍板 |

> 「允许修改的文件范围」只引用真实存在的路径；任何新文件路径一律显式标注 `【需新建】`。`src/systems/signal/`、`src/bridge/`、`src/agent/`、`src/mcp/`、`server/`、`tools/`、`src/signal/` 等目录在 `0.1.0` 中均不存在，只能作为 `【需新建】` 提案路径出现。

### 0.3 测试命令统一约定（**只能用下列 4 个真实脚本**）

`package.json` 的真实脚本为 `dev=vite`、`build=vite build`、`preview=vite preview`、`typecheck=tsc --noEmit`、`test=vitest run`、`test:watch=vitest`、`playwright=playwright test`。本文所有任务的「测试命令」字段**只使用**下面四条命令，不引入任何其它命令名：

| 代号 | 命令 | 强制约束 |
|---|---|---|
| C1 | `npm run typecheck` | 退出码必须为 0 |
| C2 | `npm test` | 退出码必须为 0；`src/core/runtime.test.ts` 的 7 个单测逐字核对 |
| C3 | `npx vite build --outDir <workspace>/verify/build --emptyOutDir` | **必须用 `--outDir` 指到 workspace**，避免写项目 `dist/`；`<workspace>` = `C:/Users/Rafae/AppData/Roaming/CindyGlobal/owners/c03ae4f95c31b1567007/bots/bot_1794172471377_k067bc/workspace/` |
| C4 | `npx playwright test` | **执行前必须同时启动 5173 与 5199 两个 Vite dev server**（`tests/canvas.spec.ts` 硬编码 `http://localhost:5199/`，其余用 5173），**必须设置 `LS_SHOT_DIR`**，并把 `LS_SHOT_DIR` 与 `--output` 指向 workspace，禁止写项目 `test-results/`、`tests/screens/` |

> 下文各任务「测试命令」字段中的 C1/C2/C3/C4 即上表四条真实脚本；任何任务都不得追加未列出的命令（例如额外的 lint 脚本、直接调用 tsc、或任何依赖安装命令）。各 PHASE「任务总表」的 `测试命令` 列是这四条命令的简写：**C3 一律带 `--outDir <workspace>/verify/build --emptyOutDir`；C4 一律需同时启动 5173 与 5199 两个 Vite dev server、设置 `LS_SHOT_DIR` 且 `--output` 指向 workspace**；完整写法以「逐任务详情」的 `测试命令` 字段为准。

### 0.4 基线事实（FACTS §4.10，全部退出码 0）

- `npm run typecheck` → 0；`npm test` → 0（1 文件 / **7 tests passed**，2.29s）。
- `npx vite build --outDir <workspace>/verify/build --emptyOutDir` → 0（31 modules、`assets/index-BREKIYzd.js` **1555.58 kB**、gzip 364.00 kB、存在 chunk >500kB 警告）。
- `npx playwright test`（双端口 5173 + 5199、`LS_SHOT_DIR` 与 `--output` 指向 workspace）→ 0，**4 passed (33.8s)**、`CONSOLE ERRORS: 0`、无 `pageerror`。
- 验证产物全部落在 workspace；项目 `dist/`、`test-results/`、`tests/screens/` 未被写入；验证前后项目文件 **SHA256 清单完全一致（62 个文件，无差异）**。
- 当前 `git -C D:/Project/LAST_SIGNAL status --short --branch` → `fatal: not a git repository`（退出码 **128**）；`D:/Project/LAST_SIGNAL/.git` 与 `D:/Project/.git` 均不存在；无 commit 历史。

---

## 1. 阶段总览与版本节奏

阶段名称 / 顺序严格采用 FACTS §7.1：

| 阶段 | 名称 | 主要内容 | 任务数 |
|---|---|---|---|
| PHASE 0 | **PHASE 0 — 工程基线** | Git 初始化（Task 0.1，本阶段未授权）、CI/脚本与基线回归固化、坐标/半径/屏震根因修复、生产包分包 | 6 |
| PHASE 1 | **PHASE 1 — 可玩闭环与内容深度** | 真实读档与局内快照、从首房到 Boss 胜利的 E2E 验收、8 种房间类型玩法差异、4 把武器/12 项升级差异化、世界观设定 | 6 |
| PHASE 2 | **PHASE 2 — Signal 系统核心** | Signal 数据模型、确定性传播/falloff、Scan/Jam/Decoy、Signal Energy、敌人感知接入 FSM、环境设施状态、Signal 专属测试房间、单元与运行时测试 | 7 |
| PHASE 3 | **PHASE 3 — Agent Bridge 与本机 Harness 接入** | Local WebSocket Bridge、独立 Node stdio MCP Server、Observation/Action API、协议与 schema 验证、安全边界、测试客户端 | 7 |
| PHASE 4 | **PHASE 4 — Human–Agent Co-op** | Mode A/B/C、Input Arbitration、AI 状态面板、Physical Core / Signal Core 权限分工、协作专属内容、接管与断线降级 | 6 |
| PHASE 5 | **PHASE 5 — 0.2.0 集成、加固与发布验收** | 集成回归矩阵、性能/分包、文档同步、0.2.0 发布验收 | 4 |

版本交付节奏（FACTS §7.1）：`0.2.0-alpha` = PHASE 0–1，`0.2.0-beta` = PHASE 2，`0.2.0-rc` = PHASE 3–4，`0.2.0` = PHASE 5。

> `TBD — Requires User Decision`：需用户决定是否已有既定的 PHASE 定义（若有，请以总计划书原文为准重新对齐阶段编号），并决定 `0.2.0-alpha/beta/rc/0.2.0` 的具体日期（见 U-01）。

---

## 2. PHASE 0 — 工程基线

### 2.1 任务总表

| 任务 ID | 目标 | 前置依赖 | 允许修改的文件范围 | 禁止改动 | 最小实现方案 | 验收标准 | 测试命令 | 需要回传的证据 |
|---|---|---|---|---|---|---|---|---|
| Task 0.1 | Git 初始化；**本阶段未授权，需用户确认后执行** | 无；需先确认 6 个设计文档并单独授权 PHASE 0 | `D:/Project/LAST_SIGNAL/`（真实仓库根）、`.git/`【需新建】、`.gitignore`【需新建】（仅后续工单内容） | 本阶段禁初始化 Git、禁建 `.gitignore`、禁提交 commit、禁改源码 | 后续 `git init`、基线 SHA256 清单、首个 commit 方案 | `fatal: not a git repository` 消失；7 单测与 4 Playwright 测试仍通过 | `npm run typecheck`；`npm test` | `git status`/`git log` 原始输出与退出码、`.git` 存在性、SHA256 62 文件对比 |
| Task 0.2 | 基线回归固化：逐字登记 4 个 Playwright 测试与 7 个单测名 | Task 0.1 | `package.json`、`vite.config.ts`、`vitest.config.ts`、`playwright.config.ts`、`tests/audit.spec.ts`、`tests/canvas.spec.ts`、`tests/gameplay.spec.ts`、`src/core/runtime.test.ts`；CI 配置【需新建】 | 禁改断言语义、禁装依赖、禁把输出写到项目 `dist/`/`test-results/`/`tests/screens/` | 固化双端口 5173+5199、`LS_SHOT_DIR`、C3 的 `--outDir`、SHA256 门禁 | 四命令退出码均 0；`7 tests passed` + `4 passed`；SHA256 一致 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 四命令日志与退出码、逐字测试名清单、构建 chunk 日志、`errors.json`、SHA256 表 |
| Task 0.3 | 屏震根因：`GameScene.update()` 的 `cam.shake(100, world.shakeAmount * 8)` 与 `WorldRenderer._clampCameraShake()` 兜底 | Task 0.1、0.2 | `src/scenes/GameScene.ts`、`src/world/WorldRenderer.ts`、`src/world/World.ts`、`src/config/game.ts`、`src/types/index.ts`、`tests/audit.spec.ts`、`tests/canvas.spec.ts` | 禁删 `prerender` 监听导致光照失锁；禁改 `docs/STYLE_GUIDE.md` | intensity 归一为视口比例，评估是否保留 ±8px 兜底 | HUD 在抖动时仍锁定；4 passed；`CONSOLE ERRORS: 0` | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | intensity 数值日志、抖动截图路径、`4 passed` + 测试名、退出码、SHA256 对比 |
| Task 0.4 | 碰撞半径单位混用：`Player/Enemy/Boss.getRadius()` vs `ProjectileData.radius` | Task 0.1、0.2 | `src/world/World.ts`、`src/entities/Player.ts`、`src/entities/Enemy.ts`、`src/entities/Boss.ts`、`src/types/index.ts`、`src/config/game.ts`、`src/core/runtime.test.ts` | 禁改 `wx/wy` 网格坐标系与 `isoToScreen()`/`screenToIso()` 语义 | 统一为网格单位并补纯逻辑单测 | 7 单测 + 新单测通过；固定 seed kill/loot 链路不回归 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 半径数值日志、新单测名与退出码、`4 passed`、SHA256 对比 |
| Task 0.5 | `gameBus` 无消费者清理与事件通道收敛 | Task 0.1、0.2 | `src/core/eventbus.ts`、`src/types/index.ts`、`src/world/World.ts`、`src/scenes/GameScene.ts`、`src/core/runtime.test.ts` | 禁写成「已有消费者」；禁新增 `emit('signal:*')`；禁改 `WorldCallbacks` 7 个回调签名 | 复用 `on()` 返回的 off 与 `clear()`，shutdown 注销 | `has(type)` 注销后为 false；7 单测 + 4 passed | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | `grep -rn "gameBus" src tests` 输出、订阅/注销日志、退出码、SHA256 对比 |
| Task 0.6 | 生产包 1.56MB 单 chunk 分包 | Task 0.1、0.2 | `vite.config.ts`、`package.json`、`src/main.ts`、`index.html`；`<workspace>/verify/build/`【需新建】临时输出 | 禁写项目 `dist/`；禁引入新依赖；禁改 `docs/STYLE_GUIDE.md` | `build.rollupOptions.output.manualChunks` 拆 phaser vendor / game chunk | C3 退出码 0；chunk 达阈值；项目 `dist/` 未写入 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | chunk 文件名与 kB/gzip 日志、警告清单、`dist/` 哈希对比、`4 passed`、SHA256 对比 |

### 2.2 逐任务详情

#### Task 0.1 — Git 初始化 【需新建】

**任务 ID**：`Task 0.1`

**目标**：为 `D:/Project/LAST_SIGNAL` 建立版本控制基线，使 PHASE 0–5 的改动可追溯、可回滚。逐字标注：**本阶段未授权，需用户确认后执行**。当前事实：`git -C D:/Project/LAST_SIGNAL status --short --branch` 返回 `fatal: not a git repository`（退出码 128）；`.git` 不存在（`D:/Project/LAST_SIGNAL/.git` 与 `D:/Project/.git` 均不存在）；无 commit 历史。Git 初始化属于后续 PHASE 0 Task 0.1，本阶段未授权，需用户确认后执行。

**前置依赖**：无源码依赖；但必须先由用户确认 6 个设计文档，并单独授权 PHASE 0。

**允许修改的文件范围**：`D:/Project/LAST_SIGNAL/`（真实存在的仓库根目录）；`.git/`【需新建】（`git init` 产物，非游戏源码）；`.gitignore`【需新建】（**仅作为本工单在后续授权执行时的内容列出，本阶段不得创建**）。

**禁止改动**：**本阶段禁止初始化 Git、禁止创建 `.gitignore`、禁止提交 commit**；`.gitignore` 可作为 Task 0.1 的后续内容写入工单，但不得要求现在做。禁止修改任何游戏源码、禁止安装依赖、禁止删除文件、禁止写项目 `dist/`、`test-results/`、`tests/screens/`、`node_modules/`、禁止修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：`git init` → 拟定 `.gitignore`（忽略 `node_modules/`、`dist/`、`test-results/`、`tests/screens/` 与 workspace 临时产物）→ 确定首个 commit 的基线文件清单（`package.json`、29 个 TS 文件、3 个 Playwright 文件、4 个配置、`docs/STYLE_GUIDE.md` 与本阶段 6 个设计文档）→ 记录初始 SHA256 清单 → 确定分支与远端策略。`TBD — Requires User Decision`：需用户决定仓库根目录、`.gitignore` 忽略项、首个 commit 内容、分支命名与远端地址（见 U-02）。

**验收标准**：`git -C D:/Project/LAST_SIGNAL status --short --branch` 不再返回 `fatal: not a git repository` 且退出码为 0；`.git` 目录存在；`git log --oneline` 可见至少 1 条 commit（仅后续授权后产生）；既有 4 个测试文件与 7 个单测仍全部通过；除 `.git/` 与 `.gitignore` 外，项目文件 SHA256 清单与基线一致。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（执行前同时启动 5173 与 5199 两个 Vite dev server、设置 LS_SHOT_DIR、--output 指向 workspace；Git 初始化本身不改动 TS 源码，四条命令仅用于回归确认，门禁细节见 Task 0.2）。

**需要回传的证据**：`git status` / `git log --oneline` / `git show --stat` 的原始输出与退出码；`.git` 目录存在性清单；初始 SHA256 清单与执行后对比表（62 个文件，除新增项外 0 差异）；`npm run typecheck` 与 `npm test` 的退出码与日志；7 个单测名清单。

#### Task 0.2 — 基线回归固化（CI/脚本与真实测试名清单） 【需扩展】

**任务 ID**：`Task 0.2`

**目标**：把 FACTS §4.10 的基线结果固化为可复现的回归门禁，**逐字**登记已有测试名：`tests/audit.spec.ts` 的 `fixed-seed playability regression: menu -> movement -> fire -> kill -> loot -> upgrade -> pause -> teleport` 与 `P2 regression: boss bullets, screen-locked light, unlocked weapons, single UI sound`；`tests/canvas.spec.ts` 的 `full HUD renders and stays locked during camera movement`；`tests/gameplay.spec.ts` 的 `menu + gameplay render`；`src/core/runtime.test.ts` 的 7 个单测。`tests/audit.spec.ts` 使用 `PORT=5173` / `SEED=424242` / `LS_SHOT_DIR`，`tests/canvas.spec.ts` 硬编码 `http://localhost:5199/`，因此 C4 必须双端口启动。

**前置依赖**：Task 0.1（Git 基线用于 SHA256 对比）。

**允许修改的文件范围**：`package.json`、`vite.config.ts`、`vitest.config.ts`、`playwright.config.ts`、`tests/audit.spec.ts`、`tests/canvas.spec.ts`、`tests/gameplay.spec.ts`、`src/core/runtime.test.ts`；CI 配置文件 `.github/workflows/ci.yml`【需新建】。

**禁止改动**：不得修改 `docs/STYLE_GUIDE.md`；不得安装依赖；不得改动既有测试断言语义或伪造测试名；不得把 `LS_SHOT_DIR`、`--output`、构建 `--outDir` 指到项目 `dist/`、`test-results/`、`tests/screens/`；**本阶段不得执行任何脚本**。

**最小实现方案**（仅后续授权执行）：以注释或 CI 配置固化逐字测试名清单；约定 C3 强制 `--outDir <workspace>/verify/build --emptyOutDir`；约定 C4 执行前同时启动 5173 与 5199 两个 Vite dev server、设置 `LS_SHOT_DIR` 与 `--output` 指向 workspace；把 `CONSOLE ERRORS: 0`、无 `pageerror`、SHA256 62 文件一致、`4 passed` / `7 tests passed` 作为门禁。

**验收标准**：C1/C2/C3/C4 退出码均为 0；7 个单测名与 4 个 Playwright 测试名逐字匹配 FACTS §4.10；`CONSOLE ERRORS: 0`、无 `pageerror`；验证前后项目 62 个文件 SHA256 完全一致。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（执行前同时启动 5173 与 5199 两个 Vite dev server，设置 LS_SHOT_DIR，--output 指向 workspace）。

**需要回传的证据**：四条命令的退出码与完整日志；`7 tests passed` 与 `4 passed` 的逐字测试名清单；构建日志（31 modules、`assets/index-BREKIYzd.js` 1555.58 kB、gzip 364.00 kB、chunk >500kB 警告）；workspace 内 `LS_SHOT_DIR` 截图路径清单；`errors.json` 中 `CONSOLE ERRORS: 0`；SHA256 对比表（62 文件，0 差异）。

#### Task 0.3 — 屏震根因修复 【需扩展】

**任务 ID**：`Task 0.3`

**目标**：修复【已实现】的历史遗留：`GameScene.update()` 中 `cam.shake(100, world.shakeAmount * 8)`（`src/scenes/GameScene.ts` 第 226–227 行，受 `saveSystem.load().settings.screenShake` 控制）把 Phaser 期望的视口比例 intensity（约 0.05）当成像素量级（最大约 144）传入；当前由 `WorldRenderer._clampCameraShake()` 在 `prerender` 钩子里把偏移裁剪到 ±8px 兜底，`src/world/WorldRenderer.ts` 第 43–53 行注释明确说明**根因未修**。

**前置依赖**：Task 0.1、Task 0.2。

**允许修改的文件范围**：`src/scenes/GameScene.ts`、`src/world/WorldRenderer.ts`、`src/world/World.ts`、`src/config/game.ts`、`src/types/index.ts`、`tests/audit.spec.ts`、`tests/canvas.spec.ts`。

**禁止改动**：不得修改 `docs/STYLE_GUIDE.md`；不得把 `DEFAULT_SETTINGS.screenShake` 语义改成静默忽略；不得删除 `WorldRenderer` 的 `prerender` / `shutdown` 监听导致屏幕固定光照层失锁（除非同步给出替代并验证）；不得写项目 `dist/` 等目录；不得新增依赖。

**最小实现方案**（仅后续授权执行）：把 `world.shakeAmount` 归一为视口比例 intensity（量级如除以 `GAME.WINDOW_W=1280`），上限受 `GAME.SHAKE_MAX=18` 与 `GAME.SHAKE_DECAY=6` 约束；评估是否保留 `WorldRenderer._clampCameraShake()` 作为防御层；用 `tests/canvas.spec.ts` 的 `full HUD renders and stays locked during camera movement` 与 `tests/audit.spec.ts` 的 `P2 regression: boss bullets, screen-locked light, unlocked weapons, single UI sound` 验证抖动时 HUD / 光照仍锁定。`TBD — Requires User Decision`：需用户决定是改 `GameScene.update()` 归一 intensity 还是仅保留 `_clampCameraShake()` 兜底，以及 `SHAKE_MAX` / `screenShake` 的最终数值（见 U-03）。

**验收标准**：`npm run typecheck` 退出码 0；`npx playwright test` 得到 `4 passed`；抖动场景下 HUD 与光照仍屏幕锁定；`CONSOLE ERRORS: 0`；`P2 regression: boss bullets, screen-locked light, unlocked weapons, single UI sound` 通过。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR、--output 指向 workspace）。

**需要回传的证据**：抖动前后截图路径（workspace）；`cam.shake` intensity 数值日志；`_clampCameraShake()` 是否触发的日志；逐字测试名与退出码；`errors.json`；SHA256 62 文件对比表。

#### Task 0.4 — 碰撞半径单位统一 【需扩展】

**任务 ID**：`Task 0.4`

**目标**：修复【已实现】的单位混用：`Player.getRadius()=0.5`、`Enemy.getRadius()=0.5`、`Boss.getRadius()=3.0` 是 `wx/wy` 网格单位；而 `World.spawnProjectile()` 把 `ProjectileData.radius` 设为 `5` / `6`（`scatter` 为 5），`World.spawnEnemyProjectile()` 设为 `6`（像素量级），`World.updateProjectiles()` 直接比较 `e.getRadius() + p.data.radius`（及 `boss.getRadius() + p.data.radius + 1`、`player.getRadius() + p.data.radius`）。

**前置依赖**：Task 0.1、Task 0.2（Task 0.3 可并行）。

**允许修改的文件范围**：`src/world/World.ts`、`src/entities/Player.ts`、`src/entities/Enemy.ts`、`src/entities/Boss.ts`、`src/types/index.ts`、`src/config/game.ts`、`src/core/runtime.test.ts`、`tests/gameplay.spec.ts`。

**禁止改动**：不得把 `wx/wy` 网格坐标改成屏幕像素；不得改变 `isoToScreen()` / `screenToIso()` 纯函数语义（`uses the 64x32 isometric grid` 与 `round-trips a grid point through screen space` 必须继续通过）；不得改 `World.worldToScreen()` / `screenToWorld()` / `tileAt()` / `isWalkable()` 的坐标系；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：统一为网格单位（如把 `ProjectileData.radius` 改为 `5/64`、`6/64`，或在 `updateProjectiles()` 比较处按 `GAME.PIXEL_TO_TILE=64` 换算），在 `src/types/index.ts` 的 `ProjectileData.radius` 处标明单位；在 `src/core/runtime.test.ts` 补一条纯逻辑单测断言半径量级一致。`TBD — Requires User Decision`：需用户决定是改 `ProjectileData.radius` 为网格单位还是保留像素并在比较处换算，以及是否接受由此带来的命中手感 / 平衡变化（见 U-04）。

**验收标准**：7 个 Vitest 单测全部通过且新增单测通过；`npm run typecheck` 0；`4 passed`；`tests/audit.spec.ts` 固定 seed 的 kill / loot 链路不回归。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：新增单测名与 `npm test` 日志 / 退出码；`updateProjectiles()` 半径数值日志；`4 passed` 测试名清单；SHA256 62 文件对比表。

#### Task 0.5 — `gameBus` 无消费者清理与事件通道收敛 【需扩展】

**任务 ID**：`Task 0.5`

**目标**：`src/core/eventbus.ts`【已实现】导出 `class EventBus`（`on()` 返回 off、`emit()`、`emitDeferred()`、`flush()`、`has()`、`clear()`）与单例 `gameBus = new EventBus()`；经 grep 复核，`gameBus` 在整个 `src/` 与 `tests/` 中**只有定义处一次出现，全项目无消费者**，`emitDeferred()` / `flush()` 亦无外部调用者；`src/types/index.ts` 的 `GameEventType`（15 个字面量/事件名）与 `GameEvent` 同样无任何使用点。当前真正解耦机制是 `WorldCallbacks`（`onLevelUp` / `onDeath` / `onRoomCleared` / `onRoomEntered` / `onLoot` / `onStats` / `onBossWin`）。另有 `World.roomClearedHandlers`、`World.statsSnapshot()`（返回全 0）未使用，`GameScene` 的 `onLoot: () => {}` 为空实现。本任务决定复用或清理，并补消费者注销策略。

**前置依赖**：Task 0.1、Task 0.2。

**允许修改的文件范围**：`src/core/eventbus.ts`、`src/types/index.ts`、`src/world/World.ts`、`src/scenes/GameScene.ts`、`src/core/runtime.test.ts`。

**禁止改动**：不得把 `gameBus` 写成「已有消费者」；不得新增 `emit('signal:*')` 之类未定义事件（Signal 系统在 PHASE 2 才设计）；不得改动 `WorldCallbacks` 现有 7 个回调签名导致场景断裂；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：保留 `EventBus` 实现，利用 `on()` 返回的 off 函数与 `clear()` 在 `GameScene` shutdown 时注销订阅，避免消费者累积；对 `roomClearedHandlers`、`statsSnapshot()`、`onLoot` 空实现登记「保留 / 删除」结论；把 15 个 `GameEventType` 的归属写入设计说明。`TBD — Requires User Decision`：需用户决定 `gameBus` 是作为 PHASE 2/3 统一事件通道复用，还是移除 `emitDeferred()` / `flush()` 等未使用能力并只保留 `WorldCallbacks`（见 U-06）。

**验收标准**：`npm run typecheck` 0；7 个单测 + 4 个 Playwright 测试通过；grep 证据显示 `gameBus` 使用点来自本任务受控接入，或明确登记为「仍无消费者，待 PHASE 2」；场景 shutdown 后 `has(type)` 为 false（无消费者残留）。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：`grep -rn "gameBus" src tests` 原始输出；订阅 / 注销日志；`has(type)` 断言结果；四命令退出码；SHA256 62 文件对比表。

#### Task 0.6 — 生产包 1.56MB 单 chunk 分包 【需扩展】

**任务 ID**：`Task 0.6`

**目标**：基线构建 31 modules 产出单个 `assets/index-BREKIYzd.js`（**1555.58 kB**，gzip 364.00 kB）并触发 chunk >500kB 警告；把它拆成可缓存的 vendor / game chunk。

**前置依赖**：Task 0.1、Task 0.2。

**允许修改的文件范围**：`vite.config.ts`、`package.json`、`src/main.ts`、`index.html`；`<workspace>/verify/build/`【需新建】（临时构建输出，不属于项目写入）。

**禁止改动**：禁止写项目 `dist/`；未经用户确认不得改 `base:'./'`、`target:'es2020'`、`sourcemap:false` 的对外行为；禁止引入新依赖；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：在 `vite.config.ts` 的 `build.rollupOptions.output.manualChunks` 把 `phaser` 拆为 vendor chunk、游戏代码拆为 game chunk；`build.outDir` 的配置值 `'dist'` 保持不变，但**验证命令强制 `--outDir` 指向 workspace**。`TBD — Requires User Decision`：需用户决定分包阈值、是否允许改 `vite.config.ts` 的 `build` 段、以及各 chunk 的体积预算（见 U-05）。

**验收标准**：`npx vite build --outDir <workspace>/verify/build --emptyOutDir` 退出码 0，每个 chunk ≤ 用户确认阈值；`npm run typecheck` 0；`4 passed` 且无运行时加载错误；项目 `dist/` 未被写入。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：构建日志（各 chunk 文件名与 kB / gzip kB）；chunk >500kB 警告是否消失；项目 `dist/` 目录哈希前后对比；四命令退出码；Playwright `CONSOLE ERRORS: 0`；SHA256 62 文件对比表。

---

## 3. PHASE 1 — 可玩闭环与内容深度

### 3.1 任务总表

| 任务 ID | 目标 | 前置依赖 | 允许修改的文件范围 | 禁止改动 | 最小实现方案 | 验收标准 | 测试命令 | 需要回传的证据 |
|---|---|---|---|---|---|---|---|---|
| Task 1.1 | 真实读档与局内快照；`SaveData` 无快照字段、`SAVE_VERSION=1`、`LOAD RUN`/`CONTINUE` 禁用态 | PHASE 0 全通过 | `src/types/index.ts`、`src/systems/SaveSystem.ts`、`src/config/game.ts`、`src/scenes/MainMenuScene.ts`、`src/scenes/GameScene.ts`、`src/scenes/GameOverScene.ts`、`src/scenes/PauseScene.ts`、`src/world/World.ts`、`src/core/runtime.test.ts`、`tests/audit.spec.ts` | 禁把提案写成 0.1.0 已实现；禁破坏 `validate()` 3 个单测；禁改 `docs/STYLE_GUIDE.md` | 扩展 `SaveData` 快照 + `validate()`/`_upgrade()`/`load()`/`save()` + 启用两个按钮 | 旧 v1 与新格式均通过；`LOAD RUN`/`CONTINUE` 可启动 `GameScene`；4 passed | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | localStorage 快照 JSON 前后对比、迁移日志、7 单测名 + 新单测名、按钮截图路径、SHA256 对比 |
| Task 1.2 | 从首房到 Boss 胜利 E2E 验收 | Task 1.1 | `src/world/World.ts`、`src/world/MapGenerator.ts`、`src/entities/Boss.ts`、`src/scenes/GameScene.ts`、`src/scenes/GameOverScene.ts`、`tests/audit.spec.ts`、`tests/gameplay.spec.ts`；`tests/e2e-win.spec.ts`【需新建】 | 禁虚构已有 E2E 测试；禁改 Boss 三阶段阈值 0.66/0.33 | 固定 seed 串起 spawn→传送→Boss→`EXTRACT COMPLETE`；新建 E2E 测试 | 固定 seed 下链路一致；`EXTRACT COMPLETE` 与 `bossesDefeated` 可见；4 passed + 新测试通过 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 新 E2E 测试名与逐步骤日志、Boss phase 1/2/3 截图、`EXTRACT COMPLETE` 截图、`errors.json`、SHA256 对比 |
| Task 1.3 | 8 种 `RoomKind` 玩法差异（`extraction` 未分配、`event` 与 `combat` 无差异） | Task 1.1、1.2 | `src/types/index.ts`、`src/world/MapGenerator.ts`、`src/world/World.ts`、`src/world/roomdepth.ts`、`src/scenes/GameScene.ts`、`src/scenes/GameOverScene.ts`、`src/config/items.ts`、`tests/audit.spec.ts` | 禁把 `extraction` 写成已有逻辑；禁破坏 `guaranteeReachable()` | `assignRoles()` 分配 8 种；`event`/`extraction` 分支；清理重复 `assignRoles()` | 8 种 kind 可观测且行为可区分；可达性仍为 true；4 passed | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 8 种 kind 分配日志、各房间截图路径、`assignRoles()` 调用次数日志、退出码、SHA256 对比 |
| Task 1.4 | 4 把武器玩法差异化 | Task 1.1、1.3 | `src/config/weapons.ts`、`src/entities/Player.ts`、`src/world/World.ts`、`src/types/index.ts`、`src/core/runtime.test.ts`、`tests/audit.spec.ts` | 禁假设 `WEAPONS` 已有 signal 字段；禁改 `weaponDps()`/`clampLevel()` 签名 | 复用 `WeaponDef` 与 `Player.tryFire()` 的 `spec` 补弹道/装填差异 | 4 把武器可量化差异；7 单测 + 4 passed | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | DPS/弹道对比表与日志、新单测名与退出码、截图路径、SHA256 对比 |
| Task 1.5 | 12 项升级玩法差异化 | Task 1.4、1.1 | `src/config/upgrades.ts`、`src/scenes/LevelUpScene.ts`、`src/entities/Player.ts`、`src/types/index.ts`、`src/core/runtime.test.ts`、`tests/audit.spec.ts` | 禁破坏 12 项 `applyUpgrade` 单测；禁改 `docs/STYLE_GUIDE.md` | 调整 `weight`/`maxLevel`/`apply()` 曲线；选卡随机源评估 | 7 单测通过；upgrade 步骤仍通过；4 passed | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 12 项数值对比表、升级卡截图、7 单测名与退出码、SHA256 对比 |
| Task 1.6 | 世界观设定成体系 | Task 1.2、1.3 | `src/scenes/MainMenuScene.ts`、`src/scenes/PreloadScene.ts`、`src/scenes/PauseScene.ts`、`src/scenes/GameScene.ts`、`src/scenes/GameOverScene.ts`、`src/config/game.ts` | 禁改 `docs/STYLE_GUIDE.md`；禁改 HUD 布局导致 `canvas.spec.ts` 失败 | 名词表统一到场景文案常量，保留现有文案锚点 | 4 passed；`CONSOLE ERRORS: 0`；HUD 仍锁定 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 文案清单 diff、菜单/结算截图路径、`4 passed`、退出码、SHA256 对比 |

### 3.2 逐任务详情

#### Task 1.1 — 真实读档与局内快照 【需扩展】

**任务 ID**：`Task 1.1`

**目标**：`MainMenuScene.create()` 的 `LOAD RUN · 暂未实现` 与 `CONTINUE · 暂未实现` 为 dim 态，回调只调 `_flash('暂未实现：读档尚未实现 (NOT IMPLEMENTED)')`；`tests/audit.spec.ts` 明确断言两个按钮不启动 `GameScene` 且显示 `暂未实现`。`src/systems/SaveSystem.ts`【已实现】：导出纯函数 `validate(data)`、`SaveSystem` 类的 `load()` / `private _upgrade(parsed)` / `save(data): boolean` / `clear()` / `canPersist()`；模块内 `const STORAGE_KEY = 'last_signal_save_v1'`（未导出），`src/config/game.ts` 另有同值导出常量 `SAVE_KEY`（两处重复定义）。`SaveData`（`src/types/index.ts`）只有 `version / createdAt / updatedAt / permanent / settings / stats`，**不含任何局内快照字段**（无 seed / 房间 / 玩家 HP / 敌人状态）；`SAVE_VERSION = 1`。`_upgrade()` 当前只是字段修补，没有真正的版本分级迁移。

**前置依赖**：PHASE 0 全部任务通过（Task 0.1–0.6）。

**允许修改的文件范围**：`src/types/index.ts`、`src/systems/SaveSystem.ts`、`src/config/game.ts`、`src/scenes/MainMenuScene.ts`、`src/scenes/GameScene.ts`、`src/scenes/GameOverScene.ts`、`src/scenes/PauseScene.ts`、`src/world/World.ts`、`src/core/runtime.test.ts`、`tests/audit.spec.ts`。

**禁止改动**：不得把 0.2.0 提案写成 0.1.0 已实现；未经用户确认不得改 `SAVE_VERSION = 1`；不得破坏 `validate` 的 3 个既有单测（`accepts a complete save`、`rejects malformed permanent numbers and non-array unlocks`、`rejects missing settings / stats instead of silently passing`）；不得修改 `docs/STYLE_GUIDE.md`；不得写项目 `dist/` 等目录。

**最小实现方案**（仅后续授权执行）：在 `SaveData` 增加局内快照字段，`SaveSystem.validate()` 覆盖新字段、`_upgrade()` 补版本分级迁移、`load()` / `save()` 读写快照；`GameScene.create(config: {seed?, isNewRun?})` 支持从快照恢复；把 `LOAD RUN` / `CONTINUE` 改为可用按钮并移除 `_flash` 占位；`World.saveProgress()` / `playerDataSave()` 保持永久进度语义。`TBD — Requires User Decision`：需用户决定 `SaveData` 快照字段命名与粒度、`SAVE_VERSION` 是否由 1 升到 2、`SAVE_KEY` / `STORAGE_KEY` 是否变更与两处重复常量是否合并、旧存档迁移与回滚策略（见 U-07）。`TBD — Requires User Decision`：需用户决定 `LOAD RUN` 与 `CONTINUE` 的语义差异、快照写入时机（自动保存点）与跨版本行为（见 U-08）。

**验收标准**：`validate()` 同时兼容旧 v1 存档与新格式；7 个 Vitest 单测全通过，新增读档单测【需新建】通过（测试名由实施时确定并回传，不得虚构已有测试）；`LOAD RUN` / `CONTINUE` 可启动 `GameScene` 并恢复快照；既有 4 个 Playwright 测试按新语义更新后仍通过。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR、--output 指向 workspace）。

**需要回传的证据**：`localStorage` 快照 JSON 读档前后对比；`validate()` / `_upgrade()` 迁移日志；7 个逐字单测名 + 新单测名与退出码；两个按钮点击后的截图路径（workspace）；`4 passed` 测试名清单；SHA256 62 文件对比表。

#### Task 1.2 — 从首房到 Boss 胜利 E2E 验收 【需扩展】

**任务 ID**：`Task 1.2`

**目标**：验收【已实现】但**未做端到端验收**的通关链路：`MapGenerator.generate()` 的 `rooms[0]` 中心 `spawn` → `World.updateRoom()` / `currentRoom()` / `onEnterRoom()` / `placePortal()` → `GameScene` 的 `F` 键 `world.tryInteract(player)` → `assignRoles()` 分配的最深 `boss` 房 → `World.spawnBoss(r)` → `Boss` 三阶段（`ratio > 0.66 / > 0.33`）→ `World.killBoss()` 设 `won=true` 并调 `callbacks.onBossWin()` → `GameScene.onBossWin()` → `GameOverScene.create()` 的 `EXTRACT COMPLETE` 与 `bossesDefeated += 1`。

**前置依赖**：Task 1.1（快照可复现 seed）；PHASE 0。

**允许修改的文件范围**：`src/world/World.ts`、`src/world/MapGenerator.ts`、`src/entities/Boss.ts`、`src/scenes/GameScene.ts`、`src/scenes/GameOverScene.ts`、`tests/audit.spec.ts`、`tests/gameplay.spec.ts`；`tests/e2e-win.spec.ts`【需新建】。

**禁止改动**：不得虚构已有 E2E 测试；未经用户确认不得改 `Boss.getRadius()=3.0` 与三阶段阈值；若把 `Boss.summonDrones()` 的 `Math.random()` 改为确定性随机源必须显式登记；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：用固定 seed 驱动 `window.__game` 与 `tests/audit.spec.ts` 的 `worldState(page)` / `gridToScreen(page,gx,gy)` 辅助函数，串起菜单 → 移动 → 清房 → 传送 → Boss 三阶段 → 胜利；新建 `tests/e2e-win.spec.ts`【需新建】记录每阶段断言。`TBD — Requires User Decision`：需用户决定 E2E 的通关判定标准、固定 seed 策略，以及是否允许为可复现性调整 `Boss.summonDrones()` 的随机源（见 U-09）。

**验收标准**：固定 seed 下连续多次通关链路一致；`EXTRACT COMPLETE` 与 `bossesDefeated += 1` 可观测；既有 4 个 Playwright 测试 + 新 E2E 测试通过；`CONSOLE ERRORS: 0`、无 `pageerror`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR、--output 指向 workspace）。

**需要回传的证据**：新 E2E 测试名与逐步骤日志；Boss phase 1 / 2 / 3 截图路径（workspace）；`EXTRACT COMPLETE` 截图路径；`4 passed` + 新增测试的退出码；`errors.json`；SHA256 62 文件对比表。

#### Task 1.3 — 8 种 `RoomKind` 玩法差异 【需扩展】

**任务 ID**：`Task 1.3`

**目标**：`RoomKind`（`src/types/index.ts`）【已实现】声明 8 种：`start | combat | resource | elite | shop | event | boss | extraction`。但 `assignRoles()`（`src/world/MapGenerator.ts`）只赋 7 种，**`extraction` 从未被赋值且没有任何游戏逻辑**（`GameOverScene.ts` 只有文案 `'EXTRACT COMPLETE'`）；`World.spawnForRoom()` 只对 `elite`（`4+depth` 敌人）、`shop`（1 敌人）与其他（`2+depth`）区分数量；`World.onEnterRoom()` 只对 `resource` / `shop` 调 `spawnResourceLoot()`、对 `boss` 调 `spawnBoss()`；**`event` 与 `combat` 玩法无差异**；`GameScene.buildMap()` 在 `generate()` 内部已调用 `assignRoles` 之后**又显式调用了一次**（重复调用）。

**前置依赖**：Task 1.1、Task 1.2；PHASE 0。

**允许修改的文件范围**：`src/types/index.ts`、`src/world/MapGenerator.ts`、`src/world/World.ts`、`src/world/roomdepth.ts`、`src/scenes/GameScene.ts`、`src/scenes/GameOverScene.ts`、`src/config/items.ts`、`tests/audit.spec.ts`。

**禁止改动**：不得把 `extraction` 写成「已有逻辑」；不得破坏 `guaranteeReachable()` / `roomDepth()` 的可达性保证（BFS `depth.size === map.rooms.length`）；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：给 `assignRoles()` 增加 `extraction` 分配规则并与结算语义一致；为 `event` 增加事件池分支、为 `extraction` 增加撤离交互（复用 `F` 键 `tryInteract()` / `placePortal()`）；清理 `GameScene.buildMap()` 的重复 `assignRoles()` 调用；`World.spawnForRoom()` / `onEnterRoom()` 按 8 种 kind 分支。`TBD — Requires User Decision`：需用户决定 `extraction` 的胜利 / 结算语义、`event` 事件池内容、以及 8 种房间在生成树中的权重（见 U-10）。

**验收标准**：固定 seed 下 8 种 `RoomKind` 均可被观测且行为可区分；`guaranteeReachable()` 仍为 true；7 个单测 + 4 个 Playwright 测试通过；`npm run typecheck` 0。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：8 种 kind 的角色分配 / `roomDepth()` 日志；每种房间的状态截图路径（workspace）；`assignRoles()` 调用次数日志；`4 passed` 测试名清单；四命令退出码；SHA256 62 文件对比表。

#### Task 1.4 — 4 把武器差异化 【需扩展】

**任务 ID**：`Task 1.4`

**目标**：`WEAPONS`（`src/config/weapons.ts`）【已实现】4 把：`pulse` / `scatter`（`magazine:8, reloadTime:1.1`）/ `plasma` / `arc`；`Player.tryFire()` 目前只有 `scatter` 的 `shots:5` 与 `plasma` 的 `pierce +2` 特殊处理，玩法差异不明显。另有 `WEAPON_LIST`、`weaponDps(def,level,cooldownReduction)`、`clampLevel(l)`。

**前置依赖**：Task 1.1、Task 1.3；PHASE 0。

**允许修改的文件范围**：`src/config/weapons.ts`、`src/entities/Player.ts`、`src/world/World.ts`、`src/types/index.ts`、`src/core/runtime.test.ts`、`tests/audit.spec.ts`。

**禁止改动**：**不得假设 `WEAPONS` 已有 signal 相关字段或 `Player.tryFire()` 已有 signal 能力**（武器-Signal 映射属于 PHASE 2，见 Task 2.4 / U-15）；不得改 `weaponDps()` / `clampLevel()` 对外签名导致单测回归；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：复用 `WeaponDef` 现有字段与 `Player.tryFire()` 传给 `world.spawnProjectile()` 的 `spec`，为 4 把武器补可观测的弹道 / 命中 / 装填差异；在 `src/core/runtime.test.ts` 补纯逻辑单测断言差异。`TBD — Requires User Decision`：需用户决定 4 把武器的差异化方向与具体平衡数值（见 U-11）。

**验收标准**：4 把武器在固定 seed 下有可量化差异；`actually mutates PlayerData for every one of the 12 definitions` 等 7 个单测通过；`4 passed`；`CONSOLE ERRORS: 0`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：4 把武器的 DPS / 弹道对比表与日志；新增单测名与退出码；武器表现截图路径（workspace）；`4 passed` 测试名清单；SHA256 62 文件对比表。

#### Task 1.5 — 12 项升级差异化 【需扩展】

**任务 ID**：`Task 1.5`

**目标**：`UPGRADES`（`src/config/upgrades.ts`）【已实现】12 项：`vitality, speed, power, critical, critDamage, rapid, magnet, datapad, armor, quickdash, pierce, regen`；`applyUpgrade(def,state,level)` 已逐项生效（单测 `actually mutates PlayerData for every one of the 12 definitions` 与 `power raises damage, vitality raises maxHp and heals the delta` 覆盖），但局内体感差异不明显；`LevelUpScene` 用 `Math.random()` 按 `weight` 选 3 张卡。

**前置依赖**：Task 1.4、Task 1.1；PHASE 0。

**允许修改的文件范围**：`src/config/upgrades.ts`、`src/scenes/LevelUpScene.ts`、`src/entities/Player.ts`、`src/types/index.ts`、`src/core/runtime.test.ts`、`tests/audit.spec.ts`。

**禁止改动**：不得破坏 `applyUpgrade` 的 12 项单测与 `power raises damage, vitality raises maxHp and heals the delta`；若把 `Math.random()` 换成 `src/core/random.ts` 的 `RNG` 必须显式登记确定性影响；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：调整 `weight` / `maxLevel` / `apply()` 曲线，使 12 项在 HUD 与战斗中可观测差异；评估 `LevelUpScene` 选卡改为复用 `RNG` 与固定 seed。`TBD — Requires User Decision`：需用户决定 12 项升级的差异化方向与数值，以及是否把选卡随机源改为确定性 `RNG`（见 U-11）。

**验收标准**：7 个单测全部通过；`tests/audit.spec.ts` 的 `fixed-seed playability regression: menu -> movement -> fire -> kill -> loot -> upgrade -> pause -> teleport` 中 upgrade 步骤仍通过；`4 passed`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：12 项升级前后数值对比表；升级卡截图路径（workspace）；7 个逐字单测名与退出码；`4 passed` 测试名清单；SHA256 62 文件对比表。

#### Task 1.6 — 世界观设定 【需扩展】

**任务 ID**：`Task 1.6`

**目标**：现状世界观未成体系，只有 UI 文案碎片：`SIGNAL LOST. SIGNAL REMAINS.`、`THE WARDEN`、`EXTRACT COMPLETE`、`SIGNAL LOST`、`You uncovered another truth.`、`The city keeps its secrets.`，分布在 `MainMenuScene` / `GameScene` / `GameOverScene` / `PreloadScene`。

**前置依赖**：Task 1.2、Task 1.3；PHASE 0。

**允许修改的文件范围**：`src/scenes/MainMenuScene.ts`、`src/scenes/PreloadScene.ts`、`src/scenes/PauseScene.ts`、`src/scenes/GameScene.ts`、`src/scenes/GameOverScene.ts`、`src/config/game.ts`。术语表由 PHASE 5 的文档同步任务（Task 5.3）写入 `docs/`（真实存在的目录）。

**禁止改动**：不得修改 `docs/STYLE_GUIDE.md`；不得把现有文案碎片写成「已实现的世界观体系」；不得改动 HUD 布局导致 `tests/canvas.spec.ts` 的 `full HUD renders and stays locked during camera movement` 失败。

**最小实现方案**（仅后续授权执行）：整理名词表（LAST SIGNAL / THE WARDEN / EXTRACT / SIGNAL 等），统一到各场景的文案常量，保留现有文案锚点以便既有测试断言；世界观术语与 6 个设计文档的措辞保持一致。`TBD — Requires User Decision`：需用户决定世界观 canon（名词、阵营、Warden 来源、Signal 设定）与文案风格（见 U-12）。

**验收标准**：`4 passed`（含 `menu + gameplay render` 与 `full HUD renders and stays locked during camera movement`）；`CONSOLE ERRORS: 0`；`npm run typecheck` 0。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：文案清单 diff；菜单 / 结算截图路径（workspace）；`4 passed` 逐字测试名；四命令退出码；SHA256 62 文件对比表。

---

## 4. PHASE 2 — Signal 系统核心

### 4.1 真实接入点逐条对照与三条铁律

> **PHASE 2 的所有 Signal 专属文件均为【需新建】**：`0.1.0` 中不存在任何 Signal 实现、配置、类型、房间或测试。对既有文件的接入一律为 `【需扩展】`。严禁把 `SignalSystem`、`SignalBus`、`SignalManager`、`SignalComponent`、`MCPServer`、`AgentBridge`、`InputArbitrator`、`ObservationAPI`（作为已存在的类）、`ActionAPI`、`SignalEnergy`、`ScanAbility`、`JamAbility`、`DecoyAbility`、`HarnessAdapter`、`ObservationDTO`（作为已存在的类型）、`SIGNALS` / `SIGNAL_TYPES` / `SIGNAL_ENERGY` 配置、任何 `emit('signal:*')` 事件、`tests/signal.spec.ts`、`src/systems/signal/*.test.ts` 写成已有。

| # | 真实接入点（逐条引用） | 现状（FACTS 复核） | 对应任务 |
|---|---|---|---|
| 1 | `src/core/eventbus.ts` — `EventBus` / `gameBus` | 【已实现】`EventBus`（`on/emit/emitDeferred/flush/has/clear`）与 `gameBus` 单例；**全项目无消费者**，`emitDeferred()` / `flush()` 无外部调用者 | Task 2.3 |
| 2 | `src/world/World.ts` — `worldToScreen` / `screenToWorld` / `tileAt` / `isWalkable` / `WorldCallbacks` / `spawnProjectile` / `updateProjectiles` | 【已实现】统一网格坐标投影与碰撞入口；`WorldCallbacks` 7 个回调；弹丸生成与每帧重投影 | Task 2.2、Task 2.6 |
| 3 | `src/entities/Enemy.ts` — `detects()` / `stateMachine()` / `enterDetect()` / `EnemyData` | 【已实现】`detects()` 是唯一感知入口（纯欧氏距离，网格坐标）；FSM 只有 7 个 case，`'dead'` 仅类型声明；`EnemyData` 含 `state/stateTimer/targetId/stunTimer/spawnRoom` | Task 2.5 |
| 4 | `src/config/*` — `WEAPONS` / `ENEMY_STATS` / `UPGRADES` / `ITEMS` / `GAME` | 【已实现】`src/config/weapons.ts` / `enemies.ts` / `upgrades.ts` / `items.ts` / `game.ts`；**`WEAPONS` 没有任何 signal 字段** | Task 2.4、Task 2.6 |
| 5 | `src/scenes/GameScene.ts` — `create()` 输入注册 / `update()` / HUD | 【已实现】`create()` 注册 `keydown-ESC/I/F/Q/E` 与 `pointerdown`/`pointerup`；`update()` 驱动 `world.update(dt)`、相机、屏震；`setupHud()` / `lockHud()` / `refreshHud()` | Task 2.4、Task 2.6 |
| 6 | `src/core/random.ts` — `RNG` | 【已实现】Mulberry32 确定性 RNG + `dist` / `normalize` / `clamp` / `lerp` 等数学工具 | Task 2.2 |
| 7 | `src/types/index.ts` | 【已实现】全部共享领域类型与 `SAVE_VERSION=1`、`RoomKind`、`EnemyStateName`、`GameEventType`、`ProjectileData`；**无任何 Signal 类型** | Task 2.1 |

**铁律一 — 统一网格坐标 `wx/wy`**：所有 Signal 距离、传播、`falloff`、半径、感知阈值**一律使用 `wx/wy` 网格坐标（tile-world units）**，与 `World.worldToScreen()` / `screenToWorld()` / `tileAt()` / `isWalkable()` 同一坐标系；**禁止混用屏幕像素、等距投影坐标或 `worldToScreen()` 的输出**。`Player` / `Enemy` / `Boss` 都持有 `wx/wy`，`get x()` / `get y()` 返回它们。

**铁律二 — 武器-Signal 映射不能假设已有能力**：现有 `WEAPONS`（`src/config/weapons.ts`）与 `Player.tryFire()`（`src/entities/Player.ts`）**没有任何 signal 相关字段与能力**；武器-Signal 映射属于 `【需扩展】` + `TBD — Requires User Decision`：需用户决定是扩展 `WeaponDef` 还是建立独立映射表，以及 4 把武器各自产生的信号类型（见 U-15），不得假设能力已存在。

**铁律三 — 所有 Signal 相关文件均为【需新建】**：`src/systems/signal/` 下的实现、Signal 专属测试房间、Signal 专属测试文件、Signal 配置与类型的新增段落，全部标 `【需新建】`；`0.1.0` 中不存在任何 Signal 文件 / 类 / 接口 / 配置 / 测试。Signal 统一口径：数据模型字段 `id / sourceId / type / position / intensity / radius / createdAt / duration / faction / metadata`；7 类候选信号 `player-noise` / `weapon-discharge` / `scan` / `jam` / `decoy` / `enemy-emission` / `environment-beacon`；Signal Energy 上限 `100`、恢复 `5`；三大能力 `Scan`（扫描）/ `Jam`（干扰）/ `Decoy`（诱饵）。

### 4.2 任务总表

| 任务 ID | 目标 | 前置依赖 | 允许修改的文件范围 | 禁止改动 | 最小实现方案 | 验收标准 | 测试命令 | 需要回传的证据 |
|---|---|---|---|---|---|---|---|---|
| Task 2.1 | Signal 数据模型与类型【需新建】 | PHASE 0–1 全通过 | `src/types/index.ts`、`src/config/index.ts`；`src/systems/signal/` 下 3 个实现文件【需新建】 | 禁把 Signal 类写成已有；禁改 `SAVE_VERSION`/`RoomKind`/`EnemyStateName`/`GameEventType` | 定义 10 字段模型与 7 类候选信号 | typecheck 0；7 单测 + 新单测通过；4 passed | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 类型 diff、新单测名与退出码、`7 tests passed`、`4 passed`、构建日志、SHA256 对比 |
| Task 2.2 | `wx/wy` 铁律与确定性传播 / falloff | Task 2.1 | `src/core/random.ts`、`src/world/World.ts`、`src/world/roomdepth.ts`、`src/types/index.ts`；`src/systems/signal/` 下传播 / 场 / 单测文件【需新建】 | 禁混用屏幕像素或 `worldToScreen()` 输出；禁改 `isoToScreen()`/`screenToIso()` | 复用 `RNG` + 固定 seed，墙壁用 `tileAt()`/`isWalkable()` | 同 seed 两次传播哈希一致；2 个 iso 单测仍通过；4 passed | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 两次传播哈希对比、falloff 数值表、新单测名与退出码、SHA256 对比 |
| Task 2.3 | Signal 事件通道接入（TBD-01 / U-06 二选一） | Task 2.1、Task 0.5 | `src/core/eventbus.ts`、`src/types/index.ts`、`src/world/World.ts`、`src/scenes/GameScene.ts`、`src/core/runtime.test.ts`；`src/systems/signal/SignalEvents.ts`【需新建】（仅选定新建专线时） | 禁写成已有消费者；禁预决复用 `gameBus`；禁改 `WorldCallbacks` 7 个回调签名 | 依用户决定二选一：复用 `gameBus` 或新建专线；`on()` 的 off + `clear()` 生命周期 | `has(type)` 注销后 false；7 单测 + 4 passed | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | grep `gameBus` 输出、派发顺序日志、订阅/注销日志、退出码、SHA256 对比 |
| Task 2.4 | Scan/Jam/Decoy + Signal Energy + `GameScene.create()` 输入与 HUD | Task 2.1、2.2、2.3 | `src/scenes/GameScene.ts`、`src/entities/Player.ts`、`src/config/game.ts`、`src/config/weapons.ts`、`src/config/upgrades.ts`、`src/config/items.ts`、`src/world/World.ts`、`src/types/index.ts`；`src/systems/signal/` 下 3 个实现文件【需新建】 | 禁假设 `WEAPONS` / `Player.tryFire()` 已有 signal 能力；禁破坏 `lockHud()` 屏幕锚定 | 三能力走输入层 →【需新建】Signal 能力层（与开火共用输入层语义，但不调用 `World.spawnProjectile()`、不把 Signal 当弹丸）；HUD 加 Energy 条 | Energy 上限 `100`、恢复 `5`，单位/恢复规则 `TBD — Requires User Decision`；`full HUD renders and stays locked during camera movement` 通过 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | Energy 数值日志、三能力截图路径、HUD 锁定截图、`4 passed`、SHA256 对比 |
| Task 2.5 | 敌人感知接入 FSM：`detects()`/`stateMachine()`/`enterDetect()`/`EnemyData` | Task 2.1、2.2、2.4 | `src/entities/Enemy.ts`、`src/config/enemies.ts`、`src/world/World.ts`、`src/types/index.ts`、`src/core/runtime.test.ts`；`src/systems/signal/` 下 2 个文件【需新建】 | 禁把 `detects()` 换成像素距离；禁宣称 `'dead'` 已有 FSM case | 在唯一感知入口并入信号阈值；复用 `detect`/`stun`/`reposition` | 同 seed 状态转移可复现；7 单测 + 新单测 + 4 passed | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | FSM 状态转移日志、`detects()` 数值表、新单测名与退出码、SHA256 对比 |
| Task 2.6 | 环境设施状态与 `World` / HUD / `src/config/*` 接入 | Task 2.1–2.5 | `src/world/World.ts`、`src/world/WorldRenderer.ts`、`src/scenes/GameScene.ts`、`src/config/game.ts`、`src/config/weapons.ts`、`src/config/enemies.ts`、`src/config/upgrades.ts`、`src/config/items.ts`、`src/types/index.ts`；`src/systems/signal/` 下 2 个文件【需新建】 | 禁把 `worldToScreen()` 输出当信号坐标；禁混用像素半径；禁改 `WorldCallbacks` 签名 | 设施作为 `wx/wy` 信号源，`update()` 每帧按 `updateProjectiles()` 链路刷新 | 设施状态在 HUD 与 `worldState(page)` 可观测；4 passed | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 设施状态日志、截图路径、`worldState(page)` JSON 片段、`4 passed`、SHA256 对比 |
| Task 2.7 | Signal 专属测试房间与单元/运行时测试【需新建】 | Task 2.1–2.6 | `tests/audit.spec.ts`、`src/core/runtime.test.ts`、`src/world/MapGenerator.ts`、`src/world/World.ts`、`playwright.config.ts`；`tests/signal.spec.ts`【需新建】、`src/systems/signal/SignalTestRoom.ts`【需新建】、`src/systems/signal/*.test.ts`【需新建】 | 禁虚构已有 Signal 测试名；禁改既有 4 个测试断言语义；禁写项目 `tests/screens/` | 固定 seed 测试房间 + `wx/wy`/falloff/FSM/Energy 单测与运行时测试 | 新测试通过；7 单测 + 4 passed；输出全在 workspace | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 新测试名与逐项日志、截图路径（workspace）、`4 passed`、`7 tests passed`、SHA256 对比 |

### 4.3 逐任务详情

#### Task 2.1 — Signal 数据模型与类型 【需新建】

**任务 ID**：`Task 2.1`

**目标**：定义统一数据模型字段（逐字）：`id / sourceId / type / position / intensity / radius / createdAt / duration / faction / metadata`，其中 `position` 必须是 `wx/wy` 网格坐标；定义 7 类候选信号 `player-noise` / `weapon-discharge` / `scan` / `jam` / `decoy` / `enemy-emission` / `environment-beacon`（审计推导的**候选**分类）；`src/types/index.ts` 目前【已实现】但无任何 Signal 类型。

**前置依赖**：PHASE 0、PHASE 1 全部任务通过；本任务为 PHASE 2 起点。

**允许修改的文件范围**：`src/types/index.ts`、`src/config/index.ts`；`src/systems/signal/SignalTypes.ts`【需新建】、`src/systems/signal/SignalConfig.ts`【需新建】、`src/systems/signal/SignalModel.ts`【需新建】。

**禁止改动**：不得虚构 `SignalSystem` / `SignalBus` / `SignalManager` / `SignalComponent` / `ObservationDTO` 等已存在；不得改写 `src/types/index.ts` 中 `SAVE_VERSION=1`、`RoomKind`、`EnemyStateName`、`ProjectileData`、`GameEventType` 的现有语义；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：在 `src/types/index.ts` 增加 Signal 相关类型导出【需扩展】，在 `src/systems/signal/` 下新建模型 / 配置 / 类型文件【需新建】；所有字段以 `wx/wy` 为坐标单位；`faction` 与 `metadata` 的取值先给最小枚举。`TBD — Requires User Decision`：需用户决定 7 类信号的最终命名与枚举、数据模型是否扩充字段（如 `falloff` 参数、遮挡标记）（见 U-13）。

**验收标准**：`npm run typecheck` 0；`npm test` 0（7 个既有单测 + 新增单测【需新建】）；`npx vite build --outDir <workspace>/verify/build --emptyOutDir` 0；`npx playwright test` `4 passed`；所有 Signal 新路径均带 `【需新建】` 标注。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR、--output 指向 workspace）。

**需要回传的证据**：`src/types/index.ts` 类型 diff；新增单测名与 `npm test` 退出码 / 日志；`7 tests passed` 与 `4 passed` 逐字测试名；构建日志（chunk 清单）；四命令退出码；SHA256 62 文件对比表。

#### Task 2.2 — 统一网格坐标 `wx/wy` 与确定性传播 / falloff 【需新建】

**任务 ID**：`Task 2.2`

**目标**：在铁律一下实现**确定性**传播与明确 falloff 函数；复用 `src/core/random.ts` 的 `RNG`（Mulberry32）与固定 seed 思路；墙壁影响通过 `World.tileAt()` / `World.isWalkable()` 判定 `wall` / `lava` / `water`；`World.isWalkable(worldX, worldY, radius=0.5)` 采样实体外接方 4 个角点。

**前置依赖**：Task 2.1。

**允许修改的文件范围**：`src/core/random.ts`、`src/world/World.ts`、`src/world/roomdepth.ts`、`src/types/index.ts`；`src/systems/signal/SignalPropagation.ts`【需新建】、`src/systems/signal/SignalField.ts`【需新建】、`src/systems/signal/signal.test.ts`【需新建】。

**禁止改动**：**禁止使用屏幕像素、等距投影坐标或 `World.worldToScreen()` 的输出做距离 / 半径 / 阈值计算**；禁止改 `isoToScreen()` / `screenToIso()`（`round-trips a grid point through screen space` 与 `uses the 64x32 isometric grid` 必须继续通过）；禁止改变 `worldToScreen()` / `screenToWorld()` / `tileAt()` / `isWalkable()` 的坐标系语义；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：实现 falloff 函数 + 固定 seed 传播 + 墙壁遮挡；新增纯逻辑单测断言「同 seed 同结果」「坐标单位一致」「wall/lava/water 阻挡」；`RNG` 只在 `src/core/random.ts` 复用，不引入新随机源。`TBD — Requires User Decision`：需用户决定 falloff 函数形式、墙壁衰减系数、传播 seed 来源与感知阈值（见 U-16）。

**验收标准**：同 seed 两次传播结果哈希一致；`uses the 64x32 isometric grid` 与 `round-trips a grid point through screen space` 仍通过；新增单测通过；`4 passed`；`npm run typecheck` 0。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：两次传播的哈希对比结果；falloff 数值表；墙壁遮挡判定日志；新增单测名与退出码；`7 tests passed` / `4 passed` 逐字清单；SHA256 62 文件对比表。

#### Task 2.3 — Signal 事件通道接入（按 TBD-01 / U-06 二选一）【需扩展】

**任务 ID**：`Task 2.3`

**目标**：`src/core/eventbus.ts`【已实现】的 `EventBus` / `gameBus` 全项目无消费者，`emitDeferred()` / `flush()` 无外部调用者；`GameEventType`（15 个字面量/事件名）与 `GameEvent` 在 `src/types/index.ts` 声明但无使用点。本任务按 `TBD — Requires User Decision`（TBD-01 / U-06）的用户决定二选一：复用 `gameBus` 或新建 Signal 事件专线；无论哪种都落实 `clear()` / `on()` 返回的 off 的消费者清理。本工单不预设结论。

**前置依赖**：Task 2.1、Task 0.5。

**允许修改的文件范围**：`src/core/eventbus.ts`、`src/types/index.ts`、`src/world/World.ts`、`src/scenes/GameScene.ts`、`src/core/runtime.test.ts`；`src/systems/signal/SignalEvents.ts`【需新建】（仅在用户选定「新建 Signal 事件专线」时；复用 `gameBus` 时不建）。

**禁止改动**：不得写成 `gameBus` 已有消费者；不得新增 `emit('signal:*')` 这类未定义事件名（除非本任务明确定义并登记）；不得改动 `WorldCallbacks` 的 7 个回调签名；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：依 `TBD — Requires User Decision`（TBD-01 / U-06）的用户决定二选一：(a) 复用 `gameBus`，用 `on()` 返回的 off 在 `GameScene` shutdown 注销、`emitDeferred()`+`flush()` 承担帧内确定性派发；(b) 新建 Signal 事件专线【需新建】（含 `SignalEvents.ts`）。补 `src/core/runtime.test.ts` 的订阅 / 注销单测。不得把任一方案写成已选定。`TBD — Requires User Decision`：需用户决定 `gameBus` 是否复用为 Signal 事件通道、`emitDeferred()` / `flush()` 的派发时机，以及 `GameEventType` 是否扩充（见 U-06、U-17）。

**验收标准**：`has(type)` 在订阅 / 注销后正确；`clear()` 无残留；7 个单测 + 4 个 Playwright 测试通过；`CONSOLE ERRORS: 0`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：`grep -rn "gameBus" src tests` 输出；订阅 / 注销日志；`emitDeferred()` / `flush()` 派发顺序日志；`has(type)` 断言结果；四命令退出码；SHA256 62 文件对比表。

#### Task 2.4 — Scan / Jam / Decoy、Signal Energy、输入与 HUD 【需新建】

**任务 ID**：`Task 2.4`

**目标**：实现 `Scan`（扫描）/ `Jam`（干扰）/ `Decoy`（诱饵）与 Signal Energy（上限 `100`、恢复 `5`）。接入点：`src/scenes/GameScene.ts` 的 `create()` 输入注册（现已注册 `keydown-ESC` / `keydown-I` / `keydown-F` / `keydown-Q` / `keydown-E` 与 `pointerdown` / `pointerup`）、`update()`、HUD（`setupHud()` / `lockHud()` / `refreshHud()`）；`src/entities/Player.ts` 的 `registerInput()` / `setFireHeld()` / `tryFire()`；`src/config/game.ts` 的 `GAME`；`src/config/weapons.ts` 的 `WEAPONS`、`src/config/upgrades.ts` 的 `UPGRADES`、`src/config/items.ts` 的 `ITEMS`。

**前置依赖**：Task 2.1、Task 2.2、Task 2.3。

**允许修改的文件范围**：`src/scenes/GameScene.ts`、`src/entities/Player.ts`、`src/config/game.ts`、`src/config/weapons.ts`、`src/config/upgrades.ts`、`src/config/items.ts`、`src/world/World.ts`、`src/types/index.ts`；`src/systems/signal/SignalAbilities.ts`【需新建】、`src/systems/signal/SignalEnergy.ts`【需新建】、`src/systems/signal/SignalHud.ts`【需新建】。

**禁止改动**：**不得假设 `WEAPONS` 已有 signal 相关字段，也不得假设 `Player.tryFire()` 已有 signal 能力**；不得改 `HUD_DEPTH=500` 与 `lockHud()` 的屏幕锚定语义导致 `tests/canvas.spec.ts` 的 `full HUD renders and stays locked during camera movement` 失败；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：三能力以 `wx/wy` 释放信号、消耗 / 恢复 Signal Energy；走 `GameScene.create()` 新增按键 → `Player` 输入层 →【需新建】Signal 能力层（与武器开火共用输入层语义，但**不调用 `World.spawnProjectile()`、不把 Signal 当弹丸**；不直接操作 Phaser 内部对象，为 PHASE 3 的 Action API 预留同层入口）；HUD 增加 Energy 条并复用 `lockHud()`。武器-Signal 映射属于 `【需扩展】` + `TBD — Requires User Decision`：需用户决定是扩展 `WeaponDef` 还是建立独立映射表，以及 4 把武器各自产生的信号类型（见 U-15）。`TBD — Requires User Decision`：需用户决定 Signal Energy 的单位 / 恢复规则与 `Scan` / `Jam` / `Decoy` 的消耗、半径、持续、冷却（见 U-14）。

**验收标准**：三能力可触发且 Energy 上限 `100`、恢复 `5`（单位/恢复规则 `TBD — Requires User Decision`）；`full HUD renders and stays locked during camera movement` 仍通过；7 个单测 + 4 个 Playwright 测试通过；`CONSOLE ERRORS: 0`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：Energy 数值日志；三能力截图路径（workspace）；HUD 锁定截图路径；`4 passed` 与 `7 tests passed` 逐字测试名；四命令退出码；SHA256 62 文件对比表。

#### Task 2.5 — 敌人感知接入 FSM 【需扩展】

**任务 ID**：`Task 2.5`

**目标**：以 `src/entities/Enemy.ts` 的 `detects()` 为**唯一感知入口**引入信号强度 / 阈值（现状 `private detects(player: Player): boolean` 返回 `this.distanceTo(player) <= this.data.stats.aggroRange`，纯欧氏距离、网格坐标、无视线 / 遮挡 / 信号 / 噪声概念）；复用 `stateMachine()` 的 `idle` / `patrol` / `detect` / `chase` / `attack` / `reposition` / `stun` 七个 case（`'dead'` 仅类型声明、FSM 无 case、无任何赋值）、`enterDetect()`（`targetId=0`、`state='detect'`、`stateTimer=0.5`）、`EnemyData`（`state/stateTimer/targetId/patrolPoints/patrolIndex/hitFlash/stunTimer/spawnRoom`）、`stun()`；接入 `ENEMY_STATS.aggroRange`（`src/config/enemies.ts`）、`World.spawnEnemy()`、`World.updateRoom()`（按 `spawnRoom` 统计房间存活敌人）、`WorldCallbacks.onRoomEntered` / `onRoomCleared`。

**前置依赖**：Task 2.1、Task 2.2、Task 2.4。

**允许修改的文件范围**：`src/entities/Enemy.ts`、`src/config/enemies.ts`、`src/world/World.ts`、`src/types/index.ts`、`src/core/runtime.test.ts`；`src/systems/signal/SignalPerception.ts`【需新建】、`src/systems/signal/enemy-perception.test.ts`【需新建】。

**禁止改动**：不得把 `detects()` 换成屏幕像素距离；不得给 `stateMachine()` 增加 `'dead'` case 并宣称 `0.1.0` 已有；不得改写「`data.targetId` 目前只被写成 0」这一事实陈述；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：`detects(player)` 在距离之外并入信号强度 / 阈值与 `World.tileAt()` / `isWalkable()` 遮挡；`enterDetect()` 记录 `targetId` / `stateTimer`；复用 `reposition` / `stun` 与 `data.stunTimer`；新增纯逻辑单测断言阈值行为。`TBD — Requires User Decision`：需用户决定感知阈值、信号与距离的合成权重、遮挡判定与 `ENEMY_STATS.aggroRange` 的调整（见 U-16）。

**验收标准**：同 seed 下敌人状态转移可复现；7 个单测 + 新增单测通过；`4 passed`（含 `P2 regression: boss bullets, screen-locked light, unlocked weapons, single UI sound`）；`npm run typecheck` 0。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：FSM 状态转移日志（`idle`→`patrol`→`detect`→`chase`→`attack` 等）；`detects()` 输入 / 输出数值表；新增单测名与退出码；`4 passed` 逐字清单；SHA256 62 文件对比表。

#### Task 2.6 — 环境设施状态与 `World` / HUD / `src/config/*` 接入 【需新建】

**任务 ID**：`Task 2.6`

**目标**：把 `environment-beacon` 与设施状态接入 `src/world/World.ts` 的 `worldToScreen` / `screenToWorld` / `tileAt` / `isWalkable` / `WorldCallbacks` / `spawnProjectile` / `updateProjectiles`；`src/config/*` 的 `WEAPONS` / `ENEMY_STATS` / `UPGRADES` / `ITEMS` / `GAME` 作为数值与道具来源；`src/scenes/GameScene.ts` 的 `update()` 每帧推进、HUD 显示设施状态。

**前置依赖**：Task 2.1–2.5。

**允许修改的文件范围**：`src/world/World.ts`、`src/world/WorldRenderer.ts`、`src/scenes/GameScene.ts`、`src/config/game.ts`、`src/config/weapons.ts`、`src/config/enemies.ts`、`src/config/upgrades.ts`、`src/config/items.ts`、`src/types/index.ts`；`src/systems/signal/EnvironmentBeacon.ts`【需新建】、`src/systems/signal/SignalRoom.ts`【需新建】。

**禁止改动**：不得把 `worldToScreen()` 的输出当作信号坐标；不得让 `spawnProjectile()` / `updateProjectiles()` 继续混用像素半径（见 Task 0.4）；不得改 `WorldCallbacks` 7 个回调签名；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：设施作为 `wx/wy` 坐标上的信号源，`GameScene.update()` 每帧按 `updateProjectiles()` 相同的投影链路刷新显示（`worldToScreen()` 仅用于渲染，不参与距离计算）；`ITEMS` / `UPGRADES` 只提供数值，是否新增 signal 字段需用户确认。

**验收标准**：设施状态在 HUD 与 `tests/audit.spec.ts` 的 `worldState(page)` 中可观测；7 个单测 + 4 个 Playwright 测试通过；`CONSOLE ERRORS: 0`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：设施状态日志；设施截图路径（workspace）；`worldState(page)` JSON 片段；`4 passed` 逐字清单；四命令退出码；SHA256 62 文件对比表。

#### Task 2.7 — Signal 专属测试房间与单元 / 运行时测试 【需新建】

**任务 ID**：`Task 2.7`

**目标**：补 Signal 专属测试房间与测试。`0.1.0` 中 `tests/signal.spec.ts`、`src/systems/signal/*.test.ts` 以及任何 Signal / Agent / Co-op 测试**都不存在**，全部为 `【需新建】`；既有真实测试只有 `tests/audit.spec.ts`（2 个）、`tests/canvas.spec.ts`（1 个）、`tests/gameplay.spec.ts`（1 个）与 `src/core/runtime.test.ts`（7 个）。

**前置依赖**：Task 2.1–2.6。

**允许修改的文件范围**：`tests/audit.spec.ts`、`src/core/runtime.test.ts`、`src/world/MapGenerator.ts`、`src/world/World.ts`、`playwright.config.ts`；`tests/signal.spec.ts`【需新建】、`src/systems/signal/SignalTestRoom.ts`【需新建】、`src/systems/signal/*.test.ts`【需新建】。

**禁止改动**：不得虚构已有 Signal 测试名；不得改既有 4 个 Playwright 测试的断言语义；不得把测试截图 / 输出写到项目 `tests/screens/` / `test-results/`；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：用固定 seed（复用 `src/core/random.ts` 的 `RNG`）生成含全部 Signal 要素的专属测试房间；补 `wx/wy` 单位、falloff 确定性、FSM 阈值、Energy 上限、三能力冷却的纯逻辑单测与运行时测试；所有截图与输出指向 workspace。`TBD — Requires User Decision`：需用户决定 Signal 专属测试房间的生成规则与新测试文件的命名（见 U-16）。

**验收标准**：新增测试全部通过；7 个既有单测 + 4 个既有 Playwright 测试仍通过；所有验证产物落在 workspace；`CONSOLE ERRORS: 0`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR、--output 指向 workspace）。

**需要回传的证据**：新测试名与逐项断言日志；workspace 内截图路径清单；`4 passed` + `7 tests passed` 逐字清单；`errors.json`；四命令退出码；SHA256 62 文件对比表。

---

## 5. PHASE 3 — Agent Bridge 与本机 Harness 接入

统一口径（FACTS §7.3）：三层架构 **Game Client / Local Agent Bridge / Harness Adapter**；链路 `Phaser Game <-> Local WebSocket Bridge <-> MCP Server <-> Local Harness`；MCP Server 为本地独立 Node **stdio** 进程；浏览器 WebSocket **只连 localhost**；双通道 = **MCP stdio + WebSocket**；协议为 JSON 消息 + schema 验证；统一候选消息类型 `hello / observation / action_request / action_result / event / error / takeover / ping`。

### 5.1 任务总表

| 任务 ID | 目标 | 前置依赖 | 允许修改的文件范围 | 禁止改动 | 最小实现方案 | 验收标准 | 测试命令 | 需要回传的证据 |
|---|---|---|---|---|---|---|---|---|
| Task 3.1 | Local WebSocket Bridge 与三层架构【需新建】 | PHASE 0–2 全通过 | `src/main.ts`、`src/scenes/GameScene.ts`、`src/core/eventbus.ts`、`src/types/index.ts`、`package.json`、`vite.config.ts`；`src/bridge/` 与 `server/` 下实现文件【需新建】 | 禁把 MCP 塞进 Phaser 核心；禁 Agent 直接操作 Phaser 内部对象 | 浏览器侧只收发 DTO，Bridge 双向转发 | 无 Bridge 时 4 passed + 7 单测；`hello`/`ping` 可往返 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | `hello`/`ping` 消息日志、仅 localhost 连接地址、退出码、SHA256 对比 |
| Task 3.2 | 独立 Node stdio MCP Server 进程【需新建】 | Task 3.1 | `package.json`；`server/mcp/` 与 `tools/` 下实现文件【需新建】 | 禁把 API Key 放前端；禁把 MCP 打进浏览器 bundle | Node stdin/stdout 承载 MCP 帧，Harness 启动 | stdio 可启停；bundle 不含 MCP 代码；4 passed | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | stdio 进程启停日志与退出码、握手帧、chunk 清单、`4 passed`、SHA256 对比 |
| Task 3.3 | Observation API 6 工具 | Task 3.1、3.2、PHASE 2 | `src/types/index.ts`、`src/world/World.ts`、`src/scenes/GameScene.ts`；`server/mcp/observation.ts`【需新建】、`src/bridge/ObservationDto.ts`【需新建】 | 禁暴露隐藏信息；禁序列化 `Phaser.Scene`/`World` 内部对象 | 公开 DTO 字段白名单 + schema 出参校验 | 6 工具逐个可调；返回不含 seed/巡逻点/RNG 状态 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 6 个工具名与返回 JSON 片段、白名单 diff、schema 日志、退出码、SHA256 对比 |
| Task 3.4 | Action API 9 工具 | Task 3.3、PHASE 2 三能力 | `src/entities/Player.ts`、`src/scenes/GameScene.ts`、`src/world/World.ts`、`src/types/index.ts`；`server/mcp/action.ts`【需新建】、`src/bridge/ActionDto.ts`【需新建】 | 禁绕过 `Player` 输入层；禁直接操作 Phaser 内部对象 | DTO → Bridge → `Player` 输入层；覆盖持续时间/超时/取消/接管 | 9 工具逐个可调；固定 seed 回归仍通过 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 9 个工具名与请求/结果 JSON、超时/取消日志、输入层调用栈、`4 passed`、SHA256 对比 |
| Task 3.5 | JSON 消息协议与 schema 验证【需新建】 | Task 3.1–3.4 | `src/types/index.ts`、`package.json`；`src/bridge/schema.ts`【需新建】、`server/mcp/schema.ts`【需新建】、`src/bridge/protocol.test.ts`【需新建】 | 禁虚构已有协议文件；禁写项目 `dist/` | 8 类消息 envelope + 入参/出参双向校验 | 8 类正例通过、非法消息返回 `error`；新单测通过 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 8 类消息样例 JSON、校验通过/拒绝日志、新单测名与退出码、SHA256 对比 |
| Task 3.6 | 安全边界【需新建】 | Task 3.1–3.5 | `src/bridge/`【需新建】、`server/mcp/`【需新建】、`src/types/index.ts`、`src/scenes/GameScene.ts`；`src/bridge/security.test.ts`【需新建】 | 禁把凭据写入 `index.html`/`src/main.ts`/Vite `define`/前端 bundle | 白名单 + 出参 schema + 凭据仅在 Harness/MCP + 日志脱敏 | bundle 无密钥字样；越权被拒；4 passed + 7 单测 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | bundle 字符串扫描结果、越权拒绝日志、脱敏日志样例、新单测名、SHA256 对比 |
| Task 3.7 | 测试客户端（Harness Adapter 模拟）与联调【需新建】 | Task 3.1–3.6 | `package.json`、`playwright.config.ts`；`tools/test-client.ts`【需新建】、`tests/bridge.spec.ts`【需新建】、`server/mcp/harness-adapter.ts`【需新建】 | 禁虚构已有 Bridge 测试；禁写项目 `tests/screens/` | stdio 启动 MCP + WebSocket 全链路 + 断线/超时 | 全链路往返成功；断线不影响主循环；新测试 + 4 passed | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 链路时序日志、往返时延表、断线/超时日志、新测试名与退出码、SHA256 对比 |

### 5.2 逐任务详情

#### Task 3.1 — Local WebSocket Bridge 与三层架构 【需新建】

**任务 ID**：`Task 3.1`

**目标**：建立 **Game Client / Local Agent Bridge / Harness Adapter** 三层与 `Phaser Game <-> Local WebSocket Bridge <-> MCP Server <-> Local Harness` 链路；浏览器 WebSocket 只连 localhost；MCP stdio + WebSocket 双通道。`0.1.0` 中无任何 WebSocket / MCP / Agent 相关代码。

**前置依赖**：PHASE 0–2 全部任务通过（尤其 PHASE 2 的 Signal 事件通道）。

**允许修改的文件范围**：`src/main.ts`、`src/scenes/GameScene.ts`、`src/core/eventbus.ts`、`src/types/index.ts`、`package.json`、`vite.config.ts`；`src/bridge/BridgeClient.ts`【需新建】、`src/bridge/BridgeProtocol.ts`【需新建】、`server/ws-bridge.ts`【需新建】。

**禁止改动**：**不把 MCP 塞进 Phaser 核心**；**不允许 Agent 直接操作 Phaser 内部对象**；`GameScene` / `World` / `Player` 对 Bridge 零依赖（保证 Mode A 独立运行）；不得修改 `docs/STYLE_GUIDE.md`；不得写项目 `dist/` 等目录。

**最小实现方案**（仅后续授权执行）：浏览器侧只做公开 DTO 收发，Bridge 负责双向转发；MCP Server 由 Harness 以 stdio 启动；`GameScene` 保持现有 `create()` / `update()` 主循环不变，Bridge 作为可选旁路挂载。`TBD — Requires User Decision`：需用户决定 WebSocket 绑定端口、握手 / 鉴权方式、并发连接数与心跳间隔（见 U-18）。

**验收标准**：无 Bridge 时 4 个 Playwright 测试 + 7 个单测仍全部通过；Bridge 启动后 `hello` / `ping` 消息可往返；连接地址仅为 localhost；`npm run typecheck` 0。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：`hello` / `ping` 消息日志；连接地址清单（仅 localhost）；四命令退出码；`4 passed` 与 `7 tests passed` 逐字清单；SHA256 62 文件对比表。

#### Task 3.2 — 独立 Node stdio MCP Server 进程 【需新建】

**任务 ID**：`Task 3.2`

**目标**：MCP Server 为本地独立 Node **stdio** 进程，由 Harness 启动；双通道 = **MCP stdio + WebSocket**；Agent 凭据只在 Harness / MCP 侧。

**前置依赖**：Task 3.1。

**允许修改的文件范围**：`package.json`；`server/mcp/index.ts`【需新建】、`server/mcp/tools.ts`【需新建】、`server/mcp/stdio.ts`【需新建】。

**禁止改动**：**不把 API Key 放前端**；不把 MCP Server 代码打进浏览器 bundle；未经用户确认不新增依赖；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：用 Node 进程 stdin / stdout 承载 MCP 帧，Bridge 侧 WebSocket 转发；工具注册在 Task 3.3 / 3.4 完成；进程生命周期由 Harness 控制。`TBD — Requires User Decision`：需用户决定 MCP Server 进程目录、启动命令、Harness 具体产品与 stdio 启动约定，以及是否允许新增 MCP / WebSocket 依赖（见 U-17）。

**验收标准**：stdio 进程可由 Harness 启停且 `hello` 握手成功；浏览器 bundle 不含 MCP 代码；`npx vite build --outDir <workspace>/verify/build --emptyOutDir` 0；`4 passed`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：stdio 进程启动 / 退出日志与退出码；握手帧日志；构建 chunk 清单（证明无 MCP 代码）；`4 passed` 逐字清单；SHA256 62 文件对比表。

#### Task 3.3 — Observation API（6 个工具） 【需新建】

**任务 ID**：`Task 3.3`

**目标**：实现统一命名的 6 个工具（逐字）：`observe_state`、`observe_entities`、`observe_map`、`observe_signals`、`observe_inventory`、`observe_events`。观察数据必须由**公开 DTO** 生成，不得序列化 `Phaser.Scene` / `World` 内部对象。

**前置依赖**：Task 3.1、Task 3.2、PHASE 2 的 Signal 数据模型。

**允许修改的文件范围**：`src/types/index.ts`、`src/world/World.ts`、`src/scenes/GameScene.ts`；`server/mcp/observation.ts`【需新建】、`src/bridge/ObservationDto.ts`【需新建】。

**禁止改动**：**不暴露隐藏信息**（未探索房间、敌人内部计时 / 巡逻点 / 状态、RNG 内部状态、种子与存档内部字段）；不得把 `World.statsSnapshot()`（现状返回全 0、未使用）写成已有完整实现；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：以字段白名单生成 DTO，每个工具做 schema 出参校验（由 Task 3.5 提供）；`observe_signals` 只输出 `wx/wy` 网格坐标与公开信号字段。`TBD — Requires User Decision`：需用户决定 6 个工具的 DTO 字段白名单与「隐藏信息」判定边界（见 U-19）。

**验收标准**：6 个工具逐个可调且返回通过 schema；返回体中不含 seed / `patrolPoints` / `stateTimer` / RNG 内部状态；7 个单测 + 4 个 Playwright 测试通过。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：6 个工具名与返回 JSON 片段；DTO 字段白名单 diff；schema 校验日志；四命令退出码；`4 passed` 逐字清单；SHA256 62 文件对比表。

#### Task 3.4 — Action API（9 个工具） 【需新建】

**任务 ID**：`Task 3.4`

**目标**：实现统一命名的 9 个工具（逐字）：`action_move`、`action_aim`、`action_fire`、`action_dash`、`action_reload`、`action_switch_weapon`、`action_interact`、`action_signal`、`action_wait`。Action 只发 DTO → Local Bridge → 落到 `Player` 输入层（与人类输入同层）。

**前置依赖**：Task 3.3、PHASE 2 的 Scan / Jam / Decoy 三能力（为 `action_signal`）。

**允许修改的文件范围**：`src/entities/Player.ts`、`src/scenes/GameScene.ts`、`src/world/World.ts`、`src/types/index.ts`；`server/mcp/action.ts`【需新建】、`src/bridge/ActionDto.ts`【需新建】。

**禁止改动**：**不允许 Agent 直接操作 Phaser 内部对象**；不得绕过 `Player.registerInput()` / `setFireHeld()` / `aimFromPointer()` 的输入层；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：动作语义必须覆盖**持续时间 / 超时 / 取消 / 人类接管**；`action_fire` 走 `Player.setFireHeld()`，`action_interact` 走 `World.tryInteract()`，`action_signal` 走 PHASE 2 的三能力，`action_wait` 只推进时间。`TBD — Requires User Decision`：需用户决定每个动作的持续时间 / 超时 / 取消语义与 `takeover` 触发条件（见 U-18）。

**验收标准**：9 个工具逐个可调；代码审查 + 日志证据显示动作不直接触碰 Phaser 对象；`tests/audit.spec.ts` 的 `fixed-seed playability regression: menu -> movement -> fire -> kill -> loot -> upgrade -> pause -> teleport` 仍通过；`CONSOLE ERRORS: 0`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：9 个工具名与动作请求 / 结果 JSON；动作持续时间 / 超时 / 取消日志；输入层调用栈证据；`4 passed` 逐字清单；四命令退出码；SHA256 62 文件对比表。

#### Task 3.5 — JSON 消息协议与 schema 验证 【需新建】

**任务 ID**：`Task 3.5`

**目标**：统一候选消息类型（逐字）：`hello / observation / action_request / action_result / event / error / takeover / ping`；协议为 JSON 消息 + schema 验证。

**前置依赖**：Task 3.1–3.4。

**允许修改的文件范围**：`src/types/index.ts`、`package.json`；`src/bridge/schema.ts`【需新建】、`server/mcp/schema.ts`【需新建】、`src/bridge/protocol.test.ts`【需新建】。

**禁止改动**：不得虚构已有协议文件；不得修改 `docs/STYLE_GUIDE.md`；不得写项目 `dist/` 等目录。

**最小实现方案**（仅后续授权执行）：定义消息 envelope（类型、序号、时间戳、错误码），入参 / 出参双向 schema 校验；非法消息返回 `error` 且不影响 `GameScene.update()` 主循环；新增协议单测【需新建】。`TBD — Requires User Decision`：需用户决定消息类型是否扩充、协议版本号与 schema 技术选型（是否允许新增依赖）（见 U-17）。

**验收标准**：8 类消息均通过 schema 正例；非法消息被拒且返回 `error`；新增协议单测通过；7 个单测 + 4 个 Playwright 测试通过。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：8 类消息样例 JSON；schema 校验通过 / 拒绝日志；新增单测名与退出码；`4 passed` 逐字清单；SHA256 62 文件对比表。

#### Task 3.6 — 安全边界 【需新建】

**任务 ID**：`Task 3.6`

**目标**：落实四条安全铁律（逐字）：**不把 MCP 塞进 Phaser 核心**；**不允许 Agent 直接操作 Phaser 内部对象**；**不暴露隐藏信息**；**不把 API Key 放前端**。

**前置依赖**：Task 3.1–3.5。

**允许修改的文件范围**：`src/bridge/`【需新建】目录内文件、`server/mcp/`【需新建】目录内文件、`src/types/index.ts`、`src/scenes/GameScene.ts`；`src/bridge/security.test.ts`【需新建】。

**禁止改动**：不得把凭据写入 `index.html` / `src/main.ts` / Vite `define` / 前端 bundle；不得让 Observation 越权输出；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：字段白名单 + 出参 schema + 凭据仅在 Harness / MCP 侧 + 日志脱敏 + 前端 bundle 字符串扫描；新增安全单测【需新建】。`TBD — Requires User Decision`：需用户决定 DTO 白名单、隐藏信息判定、API Key 存放位置与日志脱敏规则（见 U-19）。

**验收标准**：前端 bundle 不含密钥字样；越权观察 / 动作被拒并返回 `error`；4 个 Playwright 测试 + 7 个单测通过；`CONSOLE ERRORS: 0`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：bundle 字符串扫描结果；越权请求拒绝日志；脱敏日志样例；新增安全单测名与退出码；`4 passed` 逐字清单；SHA256 62 文件对比表。

#### Task 3.7 — 测试客户端（Harness Adapter 模拟）与联调 【需新建】

**任务 ID**：`Task 3.7`

**目标**：提供本机测试客户端模拟 Harness Adapter，验证 `Phaser Game <-> Local WebSocket Bridge <-> MCP Server <-> Local Harness` 全链路与断线 / 超时行为。

**前置依赖**：Task 3.1–3.6。

**允许修改的文件范围**：`package.json`、`playwright.config.ts`；`tools/test-client.ts`【需新建】、`tests/bridge.spec.ts`【需新建】、`server/mcp/harness-adapter.ts`【需新建】。

**禁止改动**：不得虚构已有 Bridge 测试；不得把新测试输出写到项目 `tests/screens/` / `test-results/`；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：测试客户端以 stdio 启动 MCP Server、经 WebSocket 发 `hello` / `action_request` / `action_result` / `takeover` / `ping`，记录往返时延与错误；所有产物指向 workspace。

**验收标准**：全链路往返成功；断线时 `GameScene.update()` 主循环不受影响；新测试 + 既有 4 个 Playwright 测试通过；`CONSOLE ERRORS: 0`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR、--output 指向 workspace）。

**需要回传的证据**：链路时序日志；往返时延表；断线 / 超时场景日志；新测试名与退出码；`4 passed` 逐字清单；SHA256 62 文件对比表。

---

## 6. PHASE 4 — Human–Agent Co-op

统一口径（FACTS §7.4）：**Mode A Human / Mode B Agent / Mode C Co-op**；**Mode A 为默认且无 AI 时可独立运行**；控制权分配与 **Input Arbitration** 为**人类最高优先级**；AI 状态面板 7 种状态（逐字）`OFFLINE`（未连接）、`OBSERVING`（观察中）、`PLANNING`（规划中）、`EXECUTING`（执行动作中）、`SIGNALING`（信号作业中）、`YIELDED`（已让权/人类接管）、`FAULT`（故障/超时/断线）；**Physical Core / Signal Core 只做权限分工，不做人格**；没有 AI 时游戏必须正常运行，Agent Bridge 是可选旁路。

### 6.1 任务总表

| 任务 ID | 目标 | 前置依赖 | 允许修改的文件范围 | 禁止改动 | 最小实现方案 | 验收标准 | 测试命令 | 需要回传的证据 |
|---|---|---|---|---|---|---|---|---|
| Task 4.1 | Mode A / Mode B / Mode C 模式框架【需新建】 | PHASE 0–3 全通过 | `src/scenes/GameScene.ts`、`src/scenes/MainMenuScene.ts`、`src/scenes/PauseScene.ts`、`src/config/game.ts`、`src/types/index.ts`；`src/bridge/ModeController.ts`【需新建】 | 禁破坏 `GameScene`/`World`/`Player` 对 Bridge 零依赖；禁改 `create(config)` 启动流程 | 模式枚举 + 切换入口，Mode A 默认，无 Bridge 自动回落 | 无 Bridge 时 4 passed + 7 单测；Mode A 默认值可断言 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 模式状态日志、无 Bridge 截图、`4 passed`+`7 tests passed`、SHA256 对比 |
| Task 4.2 | Input Arbitration（人类最高优先级）：Player 输入层合并器【需扩展】 | Task 4.1、3.4 | `src/entities/Player.ts`、`src/scenes/GameScene.ts`、`src/types/index.ts`；独立 `src/bridge/InputArbitrator.ts` 仅备选，是否新建 `TBD — Requires User Decision` | 禁让 Agent 覆盖同时刻人类输入；禁绕过 `Player.registerInput()` | 动作队列 + 优先级仲裁，人类输入触发 `takeover` | 并发输入下人类动作生效；pause 步骤仍通过 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 并发输入时序日志、`takeover` 帧 JSON、仲裁断言、新单测名、SHA256 对比 |
| Task 4.3 | AI 状态面板 7 状态【需新建】 | Task 4.1、4.2、PHASE 3 | `src/scenes/GameScene.ts`、`src/config/game.ts`、`src/types/index.ts`；`src/bridge/AgentStatusPanel.ts`【需新建】 | 禁改 `HUD_DEPTH=500`/`lockHud()` 锚定；禁虚构第 8 状态 | 状态机驱动面板，复用 `lockHud()` | 7 状态逐个可复现；`full HUD renders and stays locked during camera movement` 通过 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 7 状态截图路径、状态迁移日志、`4 passed`、SHA256 对比 |
| Task 4.4 | Physical Core / Signal Core 权限分工【需新建】 | Task 4.2、PHASE 2、PHASE 3 | `src/bridge/CorePermissions.ts`【需新建】、`server/mcp/permissions.ts`【需新建】、`src/types/index.ts`、`src/scenes/GameScene.ts` | 禁写成「人格」；禁越权调用 `World` 内部对象 | 权限清单映射到 9 个 Action + 6 个 Observation 工具 | 越权动作被拒；9 工具按清单可达；4 passed | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 权限清单表、越权拒绝日志、schema 日志、`4 passed`、SHA256 对比 |
| Task 4.5 | 协作专属内容【需新建】 | Task 4.1–4.4、PHASE 1、PHASE 2 | `src/world/MapGenerator.ts`、`src/world/World.ts`、`src/config/items.ts`、`src/config/upgrades.ts`、`src/scenes/GameScene.ts`、`src/types/index.ts`；`src/bridge/CoopContent.ts`【需新建】、`tests/coop.spec.ts`【需新建】 | 禁破坏 `guaranteeReachable()`；禁让 Mode A 无法通关 | 协作目标以 DTO 可观测、以 Action API 可完成 | Mode A 下 4 passed；Mode C 协作目标可完成 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 协作完成日志、新测试名与退出码、Mode A 降级截图、SHA256 对比 |
| Task 4.6 | 接管与断线降级【需新建】 | Task 4.1–4.5 | `src/scenes/GameScene.ts`、`src/scenes/PauseScene.ts`、`src/bridge/`【需新建】、`src/types/index.ts`；`tests/coop-fallback.spec.ts`【需新建】 | 禁在断线时冻结 `update()`；禁改既有 4 个测试断言语义 | 心跳超时 / 断线 → `FAULT` → `OFFLINE` + Mode A；人类 `takeover` 另行走 `YIELDED`，且 `YIELDED` 不改变模式；未决动作取消 | 断线后可继续人类操作；无 Bridge 时 4 passed + 7 单测 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 心跳/超时日志、降级时序、7 态迁移日志、无 Bridge 的 `4 passed`、SHA256 对比 |

### 6.2 逐任务详情

#### Task 4.1 — Mode A / Mode B / Mode C 模式框架 【需新建】

**任务 ID**：`Task 4.1`

**目标**：实现 **Mode A Human / Mode B Agent / Mode C Co-op** 三种模式；**Mode A 为默认且无 AI 时可独立运行**；**没有 AI 时游戏必须正常运行**；Agent Bridge 是可选旁路，现有 `tests/audit.spec.ts` / `tests/canvas.spec.ts` / `tests/gameplay.spec.ts` / `src/core/runtime.test.ts` 在无 Bridge 情况下必须继续通过。

**前置依赖**：PHASE 0–3 全部任务通过。

**允许修改的文件范围**：`src/scenes/GameScene.ts`、`src/scenes/MainMenuScene.ts`、`src/scenes/PauseScene.ts`、`src/config/game.ts`、`src/types/index.ts`；`src/bridge/ModeController.ts`【需新建】。

**禁止改动**：`GameScene` / `World` / `Player` 对 Bridge 零依赖不得被破坏；不得改 `GameScene.create(config: {seed?, isNewRun?})` 的现有启动流程（`buildMap` → `saveSystem.load()` → `WorldCallbacks` → `new World(...)`）；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：模式枚举与切换入口，Mode A 为默认；无 Bridge 时所有模式自动回落 Mode A；`MainMenuScene` 提供模式入口但不影响 `NEW RUN` 现有行为。`TBD — Requires User Decision`：需用户决定 Mode A/B/C 的切换入口、默认策略，以及是否需要在存档中记录模式（见 U-20）。

**验收标准**：无 Bridge 时 4 个 Playwright 测试 + 7 个单测全部通过；Mode A 默认值可被断言；`CONSOLE ERRORS: 0`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：模式状态日志；无 Bridge 启动截图路径（workspace）；`4 passed` 与 `7 tests passed` 逐字清单；四命令退出码；SHA256 62 文件对比表。

#### Task 4.2 — Input Arbitration（人类最高优先级）：Player 输入层合并器【需扩展】

**任务 ID**：`Task 4.2`

**目标**：实现 **Input Arbitration**：**人类最高优先级**；冲突处理、接管、暂停、恢复、断线降级必须写明并实现——冲突即覆盖、人类输入立即触发 `takeover`、暂停 / 恢复 / 断线自动降级到 Mode A。

**前置依赖**：Task 4.1、Task 3.4（Action API 动作语义）。

**允许修改的文件范围**：`src/entities/Player.ts`、`src/scenes/GameScene.ts`、`src/types/index.ts`（Player 输入层合并器 = `【需扩展】`）；独立 `src/bridge/InputArbitrator.ts` / 新服务仅为备选方案，是否新建 `TBD — Requires User Decision`（`InputArbitrator` 在 `0.1.0` 中不存在，仅为提案路径，非既定任务）。

**禁止改动**：不得让 Agent 动作覆盖同时刻人类输入；不得绕过 `Player.registerInput()` 的输入层；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：动作队列 + 优先级仲裁，人类输入置顶并触发 `takeover` 消息；与 `GameScene.onPause()` / `onResume()`（ESC → `PauseScene` → `parent.onResume()`）联动；新增仲裁单测【需新建】。`TBD — Requires User Decision`：需用户决定冲突判定窗口、接管冷却、暂停 / 恢复时未决动作的处理方式（见 U-20）。

**验收标准**：并发输入下人类动作始终生效；`takeover` 消息可观测；`tests/audit.spec.ts` 的 pause 步骤仍通过；4 个 Playwright 测试 + 7 个单测通过。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：并发输入时序日志；`takeover` 帧 JSON；仲裁结果断言；新增单测名与退出码；`4 passed` 逐字清单；SHA256 62 文件对比表。

#### Task 4.3 — AI 状态面板 7 状态 【需新建】

**任务 ID**：`Task 4.3`

**目标**：HUD 增加 AI 状态面板 7 种状态（逐字统一命名）：`OFFLINE`（未连接）、`OBSERVING`（观察中）、`PLANNING`（规划中）、`EXECUTING`（执行动作中）、`SIGNALING`（信号作业中）、`YIELDED`（已让权/人类接管）、`FAULT`（故障/超时/断线）。

**前置依赖**：Task 4.1、Task 4.2、PHASE 3。

**允许修改的文件范围**：`src/scenes/GameScene.ts`（`setupHud()` / `lockHud()` / `refreshHud()`）、`src/config/game.ts`、`src/types/index.ts`；`src/bridge/AgentStatusPanel.ts`【需新建】。

**禁止改动**：不得改 `HUD_DEPTH=500` 与 `lockHud()` 的屏幕锚定语义导致 `tests/canvas.spec.ts` 的 `full HUD renders and stays locked during camera movement` 失败；不得虚构第 8 个状态；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：状态机驱动面板文案与颜色，复用 `lockHud()`（`cam.getWorldPoint` 反投影 + `scale = 1/zoom`）；7 状态与 Bridge 生命周期事件一一映射。`TBD — Requires User Decision`：需用户决定 7 状态的展示位置、文案与颜色，以及 `FAULT` 的自动恢复条件（见 U-21）。

**验收标准**：7 状态逐个可复现并可截图；`full HUD renders and stays locked during camera movement` 通过；4 个 Playwright 测试 + 7 个单测通过；`CONSOLE ERRORS: 0`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：7 状态截图路径（workspace）；状态迁移日志；`4 passed` 逐字清单；四命令退出码；SHA256 62 文件对比表。

#### Task 4.4 — Physical Core / Signal Core 权限分工 【需新建】

**任务 ID**：`Task 4.4`

**目标**：**Physical Core / Signal Core 只做权限分工，不做人格**（逐字统一）；Physical Core 管移动 / 瞄准 / 开火 / 装填 / 冲刺 / 交互，Signal Core 管 `Scan` / `Jam` / `Decoy` 与信号作业；**不引入任何人格设定**。

**前置依赖**：Task 4.2、PHASE 2、PHASE 3。

**允许修改的文件范围**：`src/bridge/CorePermissions.ts`【需新建】、`server/mcp/permissions.ts`【需新建】、`src/types/index.ts`、`src/scenes/GameScene.ts`。

**禁止改动**：不得把权限分工写成「人格 / 角色设定」；不得越权调用 `World` 内部对象；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：权限清单映射到 9 个 Action API 工具与 6 个 Observation API 工具，schema 入参校验拒绝越权；Physical Core 对应 `action_move` / `action_aim` / `action_fire` / `action_dash` / `action_reload` / `action_switch_weapon` / `action_interact` / `action_wait`，Signal Core 对应 `action_signal`。`TBD — Requires User Decision`：需用户决定 Physical Core / Signal Core 的权限清单与是否允许运行时转移权限（见 U-21）。

**验收标准**：越权动作被拒并返回 `error`；9 个 Action 工具按清单可达；4 个 Playwright 测试 + 7 个单测通过。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：权限清单表；越权拒绝日志；schema 校验日志；`4 passed` 逐字清单；四命令退出码；SHA256 62 文件对比表。

#### Task 4.5 — 协作专属内容 【需新建】

**任务 ID**：`Task 4.5`

**目标**：设计 Human–Agent 协作专属内容（需同时有人类与 Agent 才能完成的房间 / 事件 / 目标），不与 PHASE 1 的 8 种 `RoomKind` 冲突。

**前置依赖**：Task 4.1–4.4、PHASE 1、PHASE 2。

**允许修改的文件范围**：`src/world/MapGenerator.ts`、`src/world/World.ts`、`src/config/items.ts`、`src/config/upgrades.ts`、`src/scenes/GameScene.ts`、`src/types/index.ts`；`src/bridge/CoopContent.ts`【需新建】、`tests/coop.spec.ts`【需新建】。

**禁止改动**：不得破坏 `guaranteeReachable()`；不得让协作内容使 Mode A 无法通关；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：协作目标以公开 DTO 可观测、以 Action API 可完成，Mode A 下提供等价单人或自动降级。`TBD — Requires User Decision`：需用户决定协作专属内容的范围、奖励与 Mode A 下的等价替代方案（见 U-21）。

**验收标准**：Mode A 下 4 个 Playwright 测试仍通过；协作内容在 Mode C 可完成；新测试通过；`CONSOLE ERRORS: 0`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：协作目标完成日志；新测试名与退出码；Mode A 降级截图路径（workspace）；`4 passed` 逐字清单；SHA256 62 文件对比表。

#### Task 4.6 — 接管与断线降级 【需新建】

**任务 ID**：`Task 4.6`

**目标**：接管、暂停、恢复、断线自动降级到 Mode A；**没有 AI 时游戏必须正常运行**；现有 `tests/audit.spec.ts` / `tests/canvas.spec.ts` / `tests/gameplay.spec.ts` / `src/core/runtime.test.ts` 在无 Bridge 情况下必须继续通过。

**前置依赖**：Task 4.1–4.5。

**允许修改的文件范围**：`src/scenes/GameScene.ts`、`src/scenes/PauseScene.ts`、`src/bridge/`【需新建】目录内文件、`src/types/index.ts`；`tests/coop-fallback.spec.ts`【需新建】。

**禁止改动**：不得在断线时冻结 `GameScene.update()`；不得改动既有 4 个测试文件断言语义；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：心跳超时 / 断线 → `FAULT` → `OFFLINE` + Mode A；人类 `takeover` 另行走 `YIELDED`，且 `YIELDED` 不改变模式；未决动作取消；人类接管立即可玩；状态迁移与 7 状态面板（Task 4.3）联动。`TBD — Requires User Decision`：需用户决定心跳超时 / 重试次数、断线降级阈值与恢复策略（见 U-20）。

**验收标准**：断线后可继续人类操作；无 Bridge 时 4 个 Playwright 测试 + 7 个单测通过；`CONSOLE ERRORS: 0`、无 `pageerror`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR、--output 指向 workspace）。

**需要回传的证据**：心跳 / 超时日志；降级时序记录；7 态迁移日志；无 Bridge 的 `4 passed` + `7 tests passed` 逐字清单；四命令退出码；SHA256 62 文件对比表。

---

## 7. PHASE 5 — 0.2.0 集成、加固与发布验收

### 7.1 任务总表

| 任务 ID | 目标 | 前置依赖 | 允许修改的文件范围 | 禁止改动 | 最小实现方案 | 验收标准 | 测试命令 | 需要回传的证据 |
|---|---|---|---|---|---|---|---|---|
| Task 5.1 | 集成回归矩阵（PHASE 0–4） | PHASE 0–4 全部 DoD 达成 | `playwright.config.ts`、`vitest.config.ts`、`package.json`、`tests/audit.spec.ts`、`tests/canvas.spec.ts`、`tests/gameplay.spec.ts`、`src/core/runtime.test.ts`；`tests/matrix.spec.ts`【需新建】（如需要） | 禁虚构测试名或伪造通过结果；禁写项目 `test-results/`/`tests/screens/`；禁改 `docs/STYLE_GUIDE.md` | 模式 × 有无 Bridge × 固定 seed × 通关链路矩阵 | 矩阵全绿；四命令退出码 0；`CONSOLE ERRORS: 0` | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 矩阵结果表（逐测试名+退出码）、`4 passed`/新测试数、`7 tests passed`、截图路径清单、`errors.json`、SHA256 对比表 |
| Task 5.2 | 性能与分包复核 | Task 5.1 | `vite.config.ts`、`src/main.ts`、`src/scenes/GameScene.ts`、`src/world/WorldRenderer.ts`、`package.json`；`<workspace>/verify/build/`【需新建】临时输出 | 禁写项目 `dist/`；禁改 `docs/STYLE_GUIDE.md` | 拆 vendor/game/signal/bridge chunk，测量首屏与稳定帧率 | 所有 chunk ≤ 阈值；无 >500kB 警告；4 passed + 7 单测 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | chunk kB/gzip 日志、警告清单、帧率采样表、`4 passed`、`dist/` 哈希对比、SHA256 对比 |
| Task 5.3 | 文档同步与术语表 | Task 5.1、5.2 | `docs/`（真实存在的目录，含本阶段 6 个设计文档）、`docs/IMPLEMENTATION_TASKS.md`（本文件）、`package.json`、`vite.config.ts` | 禁改 `docs/STYLE_GUIDE.md`；禁虚构已有文档内容 | 6 个设计文档与实现结果对齐，术语表与场景文案一致 | 术语/阶段编号/工具名/状态名全文一致；四命令退出码 0 | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 6 个设计文档 diff、术语一致性检查表、阶段编号对照表、`4 passed`、SHA256 对比 |
| Task 5.4 | 0.2.0 发布验收 | Task 5.1–5.3、PHASE 0–4 全部 DoD | `package.json`、`index.html`、`docs/`（真实存在的目录）、`vite.config.ts`、`playwright.config.ts`；`docs/RELEASE_NOTES.md`【需新建】 | 禁写项目 `dist/`/`test-results/`/`tests/screens/`/`node_modules/`；禁装依赖；禁删文件；禁改 `docs/STYLE_GUIDE.md`；禁未授权提交 commit | 四命令 + 回归矩阵 + 构建日志 + SHA256 清单作为发布门禁 | 四命令退出码 0；`7 tests passed` + `4 passed`；`package.json` version = `0.2.0` | `npm run typecheck`；`npm test`；`npx vite build`；`npx playwright test` | 四命令退出码与完整日志、逐字测试名清单、chunk 清单、截图路径清单、`errors.json`、SHA256 对比表、版本号 diff、发布清单 |

### 7.2 逐任务详情

#### Task 5.1 — 集成回归矩阵 【需扩展】

**任务 ID**：`Task 5.1`

**目标**：建立 PHASE 0–4 的集成回归矩阵，覆盖 4 个真实测试文件（2 + 1 + 1 个 Playwright 测试）与 7 个真实单测名、PHASE 2 的 Signal 测试、PHASE 3 的 Bridge 测试、PHASE 4 的 Co-op 测试与无 AI 降级。

**前置依赖**：PHASE 0–4 全部 DoD 达成。

**允许修改的文件范围**：`playwright.config.ts`、`vitest.config.ts`、`package.json`、`tests/audit.spec.ts`、`tests/canvas.spec.ts`、`tests/gameplay.spec.ts`、`src/core/runtime.test.ts`；`tests/matrix.spec.ts`【需新建】（如需要）。

**禁止改动**：不得虚构测试名或伪造通过结果；不得写项目 `test-results/` / `tests/screens/`；不得修改 `docs/STYLE_GUIDE.md`。

**最小实现方案**（仅后续授权执行）：矩阵 = 模式（Mode A / Mode B / Mode C）× 有无 Bridge × 固定 seed × 通关链路；所有 Playwright 输出（截图、`--output`）指向 workspace，构建 `--outDir` 指向 workspace。

**验收标准**：矩阵全绿；`npm run typecheck` 0、`npm test` 0、`npx vite build --outDir <workspace>/verify/build --emptyOutDir` 0、`npx playwright test` 0；`CONSOLE ERRORS: 0`、无 `pageerror`；项目 62 文件 SHA256 与基线一致（除已授权改动）。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR、--output 指向 workspace）。

**需要回传的证据**：矩阵结果表（逐测试名 + 退出码）；`4 passed` / 新增测试数；`7 tests passed` 逐字清单；workspace 内截图路径清单；`errors.json`；四命令退出码；SHA256 62 文件对比表。

#### Task 5.2 — 性能与分包复核 【需扩展】

**任务 ID**：`Task 5.2`

**目标**：复核 PHASE 0 分包效果与 PHASE 2–4 引入后的体积 / 帧率；基线为 31 modules、`assets/index-BREKIYzd.js` **1555.58 kB** / gzip 364.00 kB / 单 chunk 且存在 chunk >500kB 警告。

**前置依赖**：Task 5.1。

**允许修改的文件范围**：`vite.config.ts`、`src/main.ts`、`src/scenes/GameScene.ts`、`src/world/WorldRenderer.ts`、`package.json`；`<workspace>/verify/build/`【需新建】临时构建输出。

**禁止改动**：禁止写项目 `dist/`；不得修改 `docs/STYLE_GUIDE.md`；未确认不得引入新依赖。

**最小实现方案**（仅后续授权执行）：按用户确认阈值拆分 vendor / game / signal / bridge chunk，测量首屏加载与稳定帧率；`vite.config.ts` 的 `base:'./'` / `target:'es2020'` / `sourcemap:false` 保持既有对外行为。`TBD — Requires User Decision`：需用户决定 chunk 体积预算、帧率阈值与可接受的性能回退（见 U-22）。

**验收标准**：所有 chunk ≤ 用户确认阈值；无 chunk >500kB 警告；4 个 Playwright 测试 + 7 个单测通过；项目 `dist/` 未被写入。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：构建日志（各 chunk 文件名与 kB / gzip kB）；警告清单；帧率采样表；`4 passed` 逐字清单；项目 `dist/` 目录哈希前后对比；SHA256 62 文件对比表。

#### Task 5.3 — 文档同步与术语表 【需扩展】

**任务 ID**：`Task 5.3`

**目标**：把 0.2.0 实现结果同步到本阶段 6 个设计文档（`PROJECT_ROADMAP.md`、`SIGNAL_SYSTEM_DESIGN.md`、`AGENT_BRIDGE_ARCHITECTURE.md`、`HUMAN_AGENT_COOP_DESIGN.md`、`IMPLEMENTATION_TASKS.md`、`ARCHITECTURE_DECISIONS.md`）与 `package.json` 的版本号 `0.1.0` → `0.2.0`；统一术语、阶段编号、工具名与状态名。

**前置依赖**：Task 5.1、Task 5.2。

**允许修改的文件范围**：`docs/`（真实存在的目录，含本阶段 6 个设计文档；**`docs/STYLE_GUIDE.md` 除外**）、`docs/IMPLEMENTATION_TASKS.md`（本文件）、`package.json`、`vite.config.ts`。

**禁止改动**：**不得修改 `docs/STYLE_GUIDE.md`**；不得把设计提案写成已实现；不得虚构已有文档内容；不得写项目 `dist/` 等目录。

**最小实现方案**（仅后续授权执行）：把 PHASE 0–4 的实际落地范围、Signal 7 类命名、Observation 6 工具 / Action 9 工具、AI 7 状态、Mode A/B/C 与版本节奏回填到 6 个设计文档；术语表与 Task 1.6 的场景文案一致；`package.json` 版本号在 Task 5.4 发布门禁时确认。

**验收标准**：6 个设计文档的术语 / 阶段编号 / 工具名 / 状态名全文一致；`docs/STYLE_GUIDE.md` 字节数与基线（9791 字节）一致；四命令退出码 0；`4 passed` + `7 tests passed`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR）。

**需要回传的证据**：6 个设计文档 diff；术语一致性检查表；PHASE 0–5 阶段编号对照表；`docs/STYLE_GUIDE.md` 哈希对比；`4 passed` 逐字清单；SHA256 62 文件对比表。

#### Task 5.4 — 0.2.0 发布验收 【需扩展】

**任务 ID**：`Task 5.4`

**目标**：`0.2.0` 发布验收。版本节奏：`0.2.0-alpha` = PHASE 0–1，`0.2.0-beta` = PHASE 2，`0.2.0-rc` = PHASE 3–4，`0.2.0` = PHASE 5；`package.json` 版本从 `0.1.0` 升到 `0.2.0`。

**前置依赖**：Task 5.1–5.3、PHASE 0–4 全部 DoD。

**允许修改的文件范围**：`package.json`、`index.html`、`docs/`（真实存在的目录）、`vite.config.ts`、`playwright.config.ts`；`docs/RELEASE_NOTES.md`【需新建】。

**禁止改动**：不得写项目 `dist/`、`test-results/`、`tests/screens/`、`node_modules/`；不得安装依赖；不得删除文件；不得修改 `docs/STYLE_GUIDE.md`；不得在未授权情况下提交 commit（Task 0.1 后续已授权者除外）。

**最小实现方案**（仅后续授权执行）：以四条测试命令 + 回归矩阵 + 构建日志 + SHA256 清单作为发布门禁；版本号与变更日志同步；所有验证产物落在 workspace。`TBD — Requires User Decision`：需用户决定 0.2.0 发布验收标准、发布渠道与各里程碑日期（见 U-01、U-22）。

**验收标准**：四命令退出码 0；`7 tests passed` 与 `4 passed`（含新增测试）；`CONSOLE ERRORS: 0`、无 `pageerror`；项目 62 文件 SHA256 与授权改动一致；`package.json` 的 `version` = `0.2.0`。

**测试命令**：`npm run typecheck`；`npm test`；`npx vite build --outDir <workspace>/verify/build --emptyOutDir`；`npx playwright test`（双端口 5173 + 5199、设置 LS_SHOT_DIR、--output 指向 workspace）。

**需要回传的证据**：四命令退出码与完整日志；逐字测试名清单；构建产物 chunk 清单；workspace 内截图路径清单；`errors.json`；SHA256 62 文件对比表；版本号 diff；发布清单。

---

## 8. 跨阶段依赖矩阵

### 8.1 PHASE 级矩阵

`●` = 强前置（必须完成并通过 DoD）；`○` = 弱 / 可选依赖（设计对齐或回归约束）；`—` = 无直接依赖。行列均为 FACTS §7.1 的真实阶段编号与名称。

| 依赖方 ↓ / 被依赖方 → | PHASE 0 — 工程基线 | PHASE 1 — 可玩闭环与内容深度 | PHASE 2 — Signal 系统核心 | PHASE 3 — Agent Bridge 与本机 Harness 接入 | PHASE 4 — Human–Agent Co-op | PHASE 5 — 0.2.0 集成、加固与发布验收 |
|---|---|---|---|---|---|---|
| **PHASE 0 — 工程基线** | — | — | — | — | — | — |
| **PHASE 1 — 可玩闭环与内容深度** | ● | — | — | — | — | — |
| **PHASE 2 — Signal 系统核心** | ● | ● | — | — | — | — |
| **PHASE 3 — Agent Bridge 与本机 Harness 接入** | ● | ○ | ● | — | — | — |
| **PHASE 4 — Human–Agent Co-op** | ● | ○ | ● | ● | — | — |
| **PHASE 5 — 0.2.0 集成、加固与发布验收** | ● | ● | ● | ● | ● | — |

关键依赖说明：

- **PHASE 0 → 全阶段**：Task 0.1 的 Git 基线、Task 0.2 的四命令回归门禁、Task 0.4 的 `wx/wy` 半径单位统一、Task 0.5 的 `gameBus` 消费者清理是所有后续阶段的可追溯性与坐标一致性前提。
- **PHASE 1 → PHASE 2**：Task 1.1 的 `SaveData` 快照字段与 `SAVE_VERSION` 决定 Signal 状态是否入档；Task 1.3 的 8 种 `RoomKind` 决定 PHASE 2 的 Signal 专属测试房间如何挂到 `assignRoles()`。
- **PHASE 2 → PHASE 3**：`observe_signals` 与 `action_signal` 必须建立在 Signal 数据模型、`wx/wy` 铁律与三能力之上。
- **PHASE 3 → PHASE 4**：Mode B/C、Input Arbitration、AI 状态面板依赖 6 个 Observation 工具 / 9 个 Action 工具与 `hello / observation / action_request / action_result / event / error / takeover / ping` 协议。
- **无 AI 回归贯穿 PHASE 3–5**：`GameScene` / `World` / `Player` 对 Bridge 零依赖；`tests/audit.spec.ts` / `tests/canvas.spec.ts` / `tests/gameplay.spec.ts` / `src/core/runtime.test.ts` 在无 Bridge 情况下必须继续通过。
- **PHASE 5 → 全部**：回归矩阵、性能 / 分包、文档同步、发布验收必须复核 PHASE 0–4 的全部 DoD。

### 8.2 关键任务级依赖边

| 起点 | 终点 | 依赖理由 |
|---|---|---|
| Task 0.1 | Task 0.2 / 0.3 / 0.4 / 0.5 / 0.6 | Git 基线与 SHA256 清单用于所有回归对比 |
| Task 0.2 | Task 0.3–0.6、PHASE 1–5 | 四命令门禁与逐字测试名清单是统一验收口径 |
| Task 0.4 | Task 2.2 / 2.6 | `wx/wy` 网格单位统一后 Signal 距离与半径才不会混用像素 |
| Task 0.5 | Task 2.3 | Signal 事件通道复用方式由 `TBD — Requires User Decision`（TBD-01 / U-06）的用户决定确定 |
| Task 1.1 | Task 1.2 / 1.3 | 快照与 seed 可复现是 E2E 与房间差异验证的前提 |
| Task 1.2 | Task 1.3 / 1.6 | 通关链路与世界名词表 |
| Task 1.3 | Task 1.4 / 1.5 / 2.7 | 房间结构、武器 / 升级差异与 Signal 测试房间 |
| Task 2.1 | Task 2.2 / 2.3 / 2.4 | 数据模型是所有 Signal 能力的起点 |
| Task 2.2 / 2.3 | Task 2.4 → 2.5 → 2.6 → 2.7 | 确定性传播、事件通道、三能力、FSM、设施、测试逐层叠加 |
| Task 3.1 → 3.2 | Task 3.3 / 3.4 → 3.5 → 3.6 → 3.7 | 链路与进程就绪后才能注册工具、校验协议、落实安全、联调 |
| Task 4.1 → 4.2 | Task 4.3 / 4.4 → 4.5 → 4.6 | 模式与仲裁就绪后才能做面板、权限、协作内容与降级 |
| Task 5.1 → 5.2 → 5.3 → 5.4 | `0.2.0` 发布 | 回归矩阵 → 性能 → 文档 → 发布门禁 |

---

## 9. 每阶段完成定义（DoD）

### 9.1 真实测试名基线（逐字，FACTS §4.10）

| 文件 | 数量 | 逐字测试名 |
|---|---|---|
| `src/core/runtime.test.ts`（Vitest） | 7 | `iso projection` → `round-trips a grid point through screen space`；`iso projection` → `uses the 64x32 isometric grid`；`applyUpgrade` → `actually mutates PlayerData for every one of the 12 definitions`；`applyUpgrade` → `power raises damage, vitality raises maxHp and heals the delta`；`validate` → `accepts a complete save`；`validate` → `rejects malformed permanent numbers and non-array unlocks`；`validate` → `rejects missing settings / stats instead of silently passing` |
| `tests/audit.spec.ts`（Playwright，`PORT=5173`、`SEED=424242`、`LS_SHOT_DIR`） | 2 | `fixed-seed playability regression: menu -> movement -> fire -> kill -> loot -> upgrade -> pause -> teleport`；`P2 regression: boss bullets, screen-locked light, unlocked weapons, single UI sound` |
| `tests/canvas.spec.ts`（Playwright，硬编码 `http://localhost:5199/`） | 1 | `full HUD renders and stays locked during camera movement` |
| `tests/gameplay.spec.ts`（Playwright，`PORT=5173`） | 1 | `menu + gameplay render` |

合计：**4 个 Playwright 测试**（`4 passed`）+ **7 个 Vitest 单测**（`7 tests passed`）。这些名称在所有阶段的 DoD 中必须逐字引用，不得改写、缩写或新增为「已有测试」。PHASE 2–4 新增的测试一律为 `【需新建】`，其名称由实施时确定并回传。

### 9.2 统一门禁（每个 PHASE 均须满足）

1. `npm run typecheck` 退出码 0；`npm test` 退出码 0（`7 tests passed` 逐字核对）；`npx vite build --outDir <workspace>/verify/build --emptyOutDir` 退出码 0；`npx playwright test` 退出码 0（`4 passed`，`CONSOLE ERRORS: 0`、无 `pageerror`）。
2. `npx playwright test` 执行前**同时启动 5173 与 5199 两个 Vite dev server**，设置 `LS_SHOT_DIR`，`LS_SHOT_DIR` / `--output` 指向 workspace；构建 `--outDir` 指向 workspace。
3. 项目 `dist/`、`test-results/`、`tests/screens/`、`node_modules/` 未被写入；验证前后项目文件 SHA256 清单一致（基线 62 个文件，除已授权改动外 0 差异）。
4. 不修改 `docs/STYLE_GUIDE.md`；不安装依赖；不删除文件；本阶段不初始化 Git、不创建 `.gitignore`、不提交 commit。
5. 每项任务的「需要回传的证据」全部齐备，含退出码、日志、逐字测试名、截图路径（workspace）、哈希对比。

### 9.3 各阶段 DoD

| 阶段 | 完成定义（除 §9.2 统一门禁外） |
|---|---|
| **PHASE 0 — 工程基线** | Task 0.1 的 `fatal: not a git repository` 消失（仅在后续授权后）、`.git` 存在、无未授权 commit；`7 tests passed` 与 `4 passed` 逐字清单固化；`cam.shake(100, world.shakeAmount * 8)` 的 intensity 归一或兜底方案经用户确认；`ProjectileData.radius` 与 `getRadius()` 单位统一；`gameBus` 消费者清理结论登记；单 chunk 1555.58 kB 已按阈值拆分且项目 `dist/` 未写入 |
| **PHASE 1 — 可玩闭环与内容深度** | `SaveData` 快照与 `SaveSystem.validate()/_upgrade()/load()/save()` 通过 `validate` 的 3 个既有单测（`accepts a complete save`、`rejects malformed permanent numbers and non-array unlocks`、`rejects missing settings / stats instead of silently passing`）；`LOAD RUN` / `CONTINUE` 启用；固定 seed 首房→Boss 胜利 E2E 通过；8 种 `RoomKind` 行为可区分且 `guaranteeReachable()` 仍为 true；4 把武器 / 12 项升级（单测 `actually mutates PlayerData for every one of the 12 definitions`、`power raises damage, vitality raises maxHp and heals the delta`）差异可量化；世界观术语统一 |
| **PHASE 2 — Signal 系统核心** | 10 字段数据模型与 7 类候选信号定稿；`wx/wy` 铁律无违例（单测 `round-trips a grid point through screen space`、`uses the 64x32 isometric grid` 仍通过）；确定性传播同 seed 哈希一致；`Scan` / `Jam` / `Decoy` 与 Energy（100 / 5）可验收；`Enemy.detects()` / `stateMachine()` / `enterDetect()` / `EnemyData` 接入完成；环境设施状态可观测；Signal 专属测试房间与新测试【需新建】通过；武器-Signal 映射经用户确认且未假设已有能力 |
| **PHASE 3 — Agent Bridge 与本机 Harness 接入** | 三层架构与 `Phaser Game <-> Local WebSocket Bridge <-> MCP Server <-> Local Harness` 链路打通；MCP Server 为独立 Node stdio 进程、浏览器只连 localhost；6 个 `observe_*` 工具与 9 个 `action_*` 工具逐个可调；8 类消息 schema 双向校验通过；四条安全铁律落地；测试客户端联调通过；**无 Bridge 时** `tests/audit.spec.ts` 2 个、`tests/canvas.spec.ts` 1 个、`tests/gameplay.spec.ts` 1 个与 `src/core/runtime.test.ts` 7 个全部仍通过 |
| **PHASE 4 — Human–Agent Co-op** | Mode A / Mode B / Mode C 可用且 Mode A 为默认；Input Arbitration 人类最高优先级、冲突即覆盖、`takeover` 可观测；AI 状态面板 7 状态 `OFFLINE` / `OBSERVING` / `PLANNING` / `EXECUTING` / `SIGNALING` / `YIELDED` / `FAULT` 逐个可复现；Physical Core / Signal Core **只做权限分工，不做人格**；协作专属内容在 Mode C 可完成且 Mode A 可降级；断线自动降级；**没有 AI 时游戏必须正常运行**，4 个真实测试文件与 7 个单测在无 Bridge 情况下继续通过（`full HUD renders and stays locked during camera movement` 尤其需验证 HUD 锁定） |
| **PHASE 5 — 0.2.0 集成、加固与发布验收** | 集成回归矩阵全绿；所有 chunk ≤ 用户确认阈值、无 chunk >500kB 警告；6 个设计文档术语 / 阶段编号 / 工具名 / 状态名一致且 `docs/STYLE_GUIDE.md` 哈希不变；`package.json` version = `0.2.0`；四命令退出码 0、`7 tests passed` + `4 passed`（含新增测试）、`CONSOLE ERRORS: 0`、无 `pageerror`；SHA256 62 文件对比表齐备；发布清单经用户确认 |

---

## 本文件依据的源码文件

以下路径均为本文件写作前逐一核对过的**真实存在**路径（对应 FACTS §6.1 白名单）；本文件出现的所有 `【需新建】` 路径均**不在**此清单中，`0.1.0` 中不存在。

- 根目录与配置：`index.html`、`package.json`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`playwright.config.ts`、`src/main.ts`。
- `src/config/`：`src/config/index.ts`、`src/config/game.ts`、`src/config/weapons.ts`、`src/config/enemies.ts`、`src/config/upgrades.ts`、`src/config/items.ts`（真实符号 `GAME` / `DEFAULT_SETTINGS` / `SAVE_KEY` / `xpForLevel()` / `basePlayerData()`、`WEAPONS` / `WEAPON_LIST` / `weaponDps()` / `clampLevel()`、`ENEMY_STATS` / `ENEMY_TIERS` / `pickEnemyKind()` / `scaleStats()` / `clampInt()`、`UPGRADES` / `UPGRADE_LIST` / `applyUpgrade()` / `STARTING_WEAPONS`、`ITEMS` / `ITEM_LIST` / `kindWeights()`）。
- `src/core/`：`src/core/eventbus.ts`（`EventBus` / `gameBus`）、`src/core/iso.ts`（`IsoMath` / `isoToScreen()` / `screenToIso()`）、`src/core/random.ts`（`RNG` / `dist()` / `normalize()` / `clamp()` / `lerp()`）、`src/core/GraphicsFactory.ts`、`src/core/runtime.test.ts`（7 个单测）。
- `src/entities/`：`src/entities/Player.ts`（`registerInput()` / `aimFromPointer()` / `tryFire()` / `setFireHeld()` / `getRadius()` / `hurt()` / `heal()`）、`src/entities/Enemy.ts`（`detects()` / `stateMachine()` / `enterDetect()` / `stun()` / `EnemyData`）、`src/entities/Boss.ts`（三阶段 / `fireLaser()` / `shockwave()` / `summonDrones()` / `toTilesPerSecond()` / `getRadius()`）。
- `src/world/`：`src/world/World.ts`（`WorldCallbacks` / `worldToScreen()` / `screenToWorld()` / `tileAt()` / `isWalkable()` / `spawnProjectile()` / `spawnEnemyProjectile()` / `updateProjectiles()` / `spawnEnemy()` / `spawnBoss()` / `killBoss()` / `updateRoom()` / `onEnterRoom()` / `spawnForRoom()` / `placePortal()` / `tryInteract()` / `saveProgress()` / `playerDataSave()` / `statsSnapshot()`）、`src/world/WorldRenderer.ts`（`_clampCameraShake()` / `_lockLightToScreen()` / `prerender`）、`src/world/MapGenerator.ts`（`generate()` / `assignRoles()` / `roomDepth()` / `guaranteeReachable()`）、`src/world/roomdepth.ts`（`RoomDepth`）。
- `src/scenes/`：`src/scenes/BootScene.ts`、`src/scenes/PreloadScene.ts`、`src/scenes/MainMenuScene.ts`、`src/scenes/GameScene.ts`、`src/scenes/LevelUpScene.ts`、`src/scenes/PauseScene.ts`、`src/scenes/GameOverScene.ts`。
- `src/systems/`：`src/systems/SaveSystem.ts`（`validate()` / `_upgrade()` / `load()` / `save()` / `clear()` / `canPersist()` / `saveSystem`）、`src/systems/AudioSystem.ts`。
- 类型：`src/types/index.ts`（`Vec2` / `Stats` / `PlayerData` / `WeaponState` / `WeaponDef` / `EnemyKind` / `EnemyStateName` / `EnemyStats` / `EnemyData` / `TileType` / `Tile` / `RoomKind` / `Room` / `MapData` / `ItemDef` / `UpgradeDef` / `UpgradeProgress` / `HudData` / `SaveData` / `SAVE_VERSION=1` / `ProjectileData` / `HitFx` / `GameEventType` / `GameEvent`）。
- 测试：`tests/audit.spec.ts`（2 个）、`tests/canvas.spec.ts`（1 个）、`tests/gameplay.spec.ts`（1 个）、`src/core/runtime.test.ts`（7 个）。
- 文档目录与既有文档：`docs/`（真实存在目录）、`docs/STYLE_GUIDE.md`（9791 字节，本阶段禁止修改）。

事实基座（workspace，非项目源码）：`C:/Users/Rafae/AppData/Roaming/CindyGlobal/owners/c03ae4f95c31b1567007/bots/bot_1794172471377_k067bc/workspace/audit/FACTS.md`，其 §6.1 路径白名单、§7.1 阶段编号、§7.3/§7.4 工具与状态命名、§7.5 的 7 问、§4.10 测试名与命令均由本文件严格采用。

## 待用户确认事项

> 前置条件：**需用户确认 6 个设计文档后，再逐阶段授权**；**本阶段未授权执行任何任务**。以下每一项均逐字标注 `TBD — Requires User Decision` 并写明需要用户决定的具体问题；未确认前不得进入对应任务的最小实现方案。

1. **U-01 阶段编号与版本节奏** — `TBD — Requires User Decision`：需用户决定是否已有既定的 PHASE 定义（若有，请以总计划书原文为准重新对齐阶段编号），并决定 `0.2.0-alpha`（PHASE 0–1）、`0.2.0-beta`（PHASE 2）、`0.2.0-rc`（PHASE 3–4）、`0.2.0`（PHASE 5）的具体日期。
2. **U-02 Git 初始化范围** — `TBD — Requires User Decision`：需用户决定仓库根目录、`.gitignore` 的忽略项、首个 commit 的文件清单、分支命名与远端地址；并确认 `.gitignore` 与 commit 只能在后续授权阶段产生。
3. **U-03 屏震根因方案** — `TBD — Requires User Decision`：需用户决定是修改 `GameScene.update()` 把 intensity 归一为视口比例，还是仅保留 `WorldRenderer._clampCameraShake()` 的 ±8px 兜底；并决定 `GAME.SHAKE_MAX`、`SHAKE_DECAY` 与 `DEFAULT_SETTINGS.screenShake` 的最终数值。
4. **U-04 碰撞半径单位口径** — `TBD — Requires User Decision`：需用户决定把 `ProjectileData.radius` 改为 `wx/wy` 网格单位，还是保留像素值并在 `World.updateProjectiles()` 比较处按 `GAME.PIXEL_TO_TILE=64` 换算；并决定是否接受由此带来的命中手感 / 平衡变化。
5. **U-05 生产包分包策略** — `TBD — Requires User Decision`：需用户决定是否允许修改 `vite.config.ts` 的 `build` 段、chunk 拆分阈值与各 chunk 的体积预算（基线单 chunk 1555.58 kB / gzip 364.00 kB）。
6. **U-06 `gameBus` 归属** — `TBD — Requires User Decision`：需用户决定 `src/core/eventbus.ts` 的 `EventBus` / `gameBus` 是复用为 PHASE 2/3 的统一事件通道，还是移除 `emitDeferred()` / `flush()` 等未使用能力并只保留 `WorldCallbacks`；以及 `GameEventType` 是否扩充。
7. **U-07 存档格式（重大）** — `TBD — Requires User Decision`：需用户决定 `SaveData` 局内快照字段的命名与粒度（seed / 房间 / 玩家 HP / 敌人 / Signal 状态）、`SAVE_VERSION` 是否由 1 升到 2、`SAVE_KEY` 与 `STORAGE_KEY` 是否变更及两处重复常量是否合并、旧存档迁移与回滚策略。
8. **U-08 读档语义** — `TBD — Requires User Decision`：需用户决定 `LOAD RUN` 与 `CONTINUE` 的语义差异、快照写入时机（自动保存点）与跨版本读档行为。
9. **U-09 首房到 Boss 胜利 E2E** — `TBD — Requires User Decision`：需用户决定通关判定标准、固定 seed 策略，以及是否允许为可复现性调整 `Boss.summonDrones()` 的 `Math.random()` 随机源。
10. **U-10 房间玩法** — `TBD — Requires User Decision`：需用户决定 `extraction` 的胜利 / 结算语义、`event` 事件池内容、8 种 `RoomKind` 在 `assignRoles()` 生成树中的权重，以及是否清理 `GameScene.buildMap()` 的重复 `assignRoles()` 调用。
11. **U-11 武器 / 升级差异化** — `TBD — Requires User Decision`：需用户决定 4 把武器与 12 项升级的差异化方向和具体平衡数值，以及是否把 `LevelUpScene` 选卡的 `Math.random()` 改为 `src/core/random.ts` 的确定性 `RNG`。
12. **U-12 世界观 canon** — `TBD — Requires User Decision`：需用户决定世界观名词表、阵营、THE WARDEN 来源、SIGNAL 设定与文案风格。
13. **U-13 Signal 分类与数据模型** — `TBD — Requires User Decision`：需用户决定 7 类候选信号（`player-noise` / `weapon-discharge` / `scan` / `jam` / `decoy` / `enemy-emission` / `environment-beacon`）的最终命名与枚举，以及 10 字段模型是否扩充（如 falloff 参数、遮挡标记）。
14. **U-14 Signal Energy 与三能力参数** — `TBD — Requires User Decision`：需用户决定 Signal Energy 的单位与恢复规则（上限 100 / 恢复 5 的口径），以及 `Scan` / `Jam` / `Decoy` 的消耗、半径、持续、冷却与按键绑定。
15. **U-15 武器-Signal 映射** — `TBD — Requires User Decision`：需用户决定是扩展 `WeaponDef`（`src/config/weapons.ts`）还是建立独立映射表，以及 `pulse` / `scatter` / `plasma` / `arc` 各自产生的信号类型；**不得假设 `WEAPONS` 或 `Player.tryFire()` 已有 signal 能力**。
16. **U-16 传播 / 阈值 / 测试命名** — `TBD — Requires User Decision`：需用户决定确定性传播的 falloff 函数形式、墙壁衰减系数、固定 seed 来源、敌人感知阈值与信号 / 距离合成权重，以及 Signal 专属测试房间的生成规则与新测试文件命名。
17. **U-17 Bridge 协议 / schema / 依赖** — `TBD — Requires User Decision`：需用户决定 JSON 消息类型是否扩充、协议版本号、schema 技术选型（是否允许新增依赖）、MCP Server 进程目录 / 启动命令与 Harness 具体产品及 stdio 启动约定。
18. **U-18 WebSocket 与动作语义** — `TBD — Requires User Decision`：需用户决定 WebSocket 绑定端口（只连 localhost）、握手 / 鉴权方式、并发连接数与心跳间隔，以及 9 个 `action_*` 工具的持续时间 / 超时 / 取消语义与 `takeover` 触发条件。
19. **U-19 安全边界** — `TBD — Requires User Decision`：需用户决定 Observation DTO 字段白名单、「隐藏信息」的判定边界、API Key 的存放位置（仅 Harness / MCP 侧）与日志脱敏规则。
20. **U-20 模式 / 仲裁 / 降级** — `TBD — Requires User Decision`：需用户决定 Mode A/B/C 的切换入口与默认策略、是否把模式写入存档、Input Arbitration 的冲突窗口与接管冷却、暂停 / 恢复时未决动作处理，以及断线降级的心跳超时 / 重试次数 / 恢复策略。
21. **U-21 状态面板 / 权限分工 / 协作内容** — `TBD — Requires User Decision`：需用户决定 AI 状态面板 7 状态（`OFFLINE` / `OBSERVING` / `PLANNING` / `EXECUTING` / `SIGNALING` / `YIELDED` / `FAULT`）的展示位置 / 文案 / 颜色与 `FAULT` 自动恢复条件、Physical Core / Signal Core 的权限清单（只做权限分工、不做人格）与运行时权限转移规则，以及协作专属内容范围、奖励与 Mode A 等价替代方案。
22. **U-22 性能 / 回归 / 发布验收** — `TBD — Requires User Decision`：需用户决定 chunk 体积预算与帧率阈值、集成回归矩阵的覆盖范围、以及 `0.2.0` 的发布验收标准、发布渠道与各里程碑日期。
