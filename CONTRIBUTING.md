# 贡献指南（CONTRIBUTING）

欢迎为 **LAST SIGNAL** 做贡献。本仓库当前是 `0.1.0` 可玩纵向切片。请先读 [`README.md`](README.md) 与 [`docs/STYLE_GUIDE.md`](docs/STYLE_GUIDE.md)。

## 1. 分支与提交规范

### 分支
- 默认长期分支为 `main`；常规贡献请开 Pull Request，维护者可直接提交仓库维护类改动。
- 功能 / 修复分支从最新的 `main` 切出，命名约定：
  - `feat/<简短主题>`：新功能（如 `feat/boss-barrage`）
  - `fix/<简短主题>`：缺陷修复（如 `fix/camera-shake`）
  - `docs/<简短主题>`：文档（如 `docs/readme-badges`）
  - `test/<简短主题>`：测试（如 `test/e2e-portal`）
  - `chore/<简短主题>`：构建/工具/依赖等非代码逻辑改动
  - `ci/<简短主题>`：CI 流程

### 提交信息（Conventional Commits）
格式：`<type>(<scope>): <subject>`，例如：

```text
feat(weapons): 新增 Arc Drone 分解弹道
fix(world): 修复深层房间相机越界
docs: 补充 README 操作表
```

- `type`：`feat` / `fix` / `docs` / `test` / `refactor` / `perf` / `style` / `ci` / `chore`。
- `subject` 使用祈使句、简洁、不超过 72 个字符，**句末不加句号**。
- 正文（如需要）解释「为什么」，并与标题空一行，每行 ≤ 72 字符。
- 关联 issue 时，在正文或末尾写明 `Closes #123` / `Refs #456`。

### PR 要求
- 一次 PR 聚焦一件事，避免无关改动。
- 若改动影响可玩性 / 数值 / 美术，请在 PR 中附截图或录屏。
- 涉及文档或设计文档时，同步更新 [`README.md`](README.md) 的「已有设计文档列表 / 已知限制」与 [`CHANGELOG.md`](CHANGELOG.md)。
- 保持 `0.1.0` 基线诚实：**不要把 `docs/` 中 `0.2.0` 设计提案写成已实现功能**，也不要在不经授权的情况下落地 Signal / Agent Bridge / Human+AI Co-op 相关源码。

## 2. 本地测试命令

```bash
npm ci               # 用 package-lock.json 安装锁定版本依赖
npm run typecheck    # tsc --noEmit 类型检查
npm test             # Vitest 单测（src/core/runtime.test.ts，15 个用例）
npm run test:watch   # Vitest 监听模式
npm run build        # 生产构建（输出 dist/）
npm run playwright   # Playwright 端到端回归
```

> 请从仓库根目录执行以上命令。`tests/runtime-bugs.spec.ts` 会读取项目源码做静态断言；如从其他目录运行 Playwright，请设置 `LAST_SIGNAL_ROOT` 指向仓库根目录。

### 双 Vite dev server（运行 e2e 前必须）
部分 Playwright 用例对端口有硬约束，运行 `npm run playwright` 前**必须同时启动两个 Vite dev server**：

- `tests/audit.spec.ts`、`tests/gameplay.spec.ts`、`tests/checkpoint.spec.ts`、`tests/runtime-bugs.spec.ts` 走 `http://localhost:5173/`（默认 `PORT=5173`）。`tests/checkpoint.spec.ts` 为局内检查点续局 / 永久天赋隔离的端到端回归，务必随其余 5173 用例一起运行。
- `tests/canvas.spec.ts` 硬编码 `http://localhost:5199/`。

```bash
# 终端 1
npm run dev                  # 占用 5173（vite.config.ts server.port 5173）

# 终端 2
npm run dev -- --port 5199   # Vite CLI 覆盖端口为 5199

# 终端 3：把截图产物指向仓库外目录，避免污染仓库
LS_SHOT_DIR=</path/outside/repo> npm run playwright
```

> `PORT` 环境变量用于覆盖 `playwright.config.ts` 的默认 `baseURL`（默认 5173），需要时设置即可；但 `canvas.spec.ts` 的 `5199` 是源码硬编码，无法用 `PORT` 改变。

## 3. 不要提交的内容

以下产物一律**不提交**（已纳入 `.gitignore`）：

- `node_modules/`
- `dist/`（构建产物）
- `test-results/`、`playwright-report/` 以及任何测试生成的 `screens/`、`tests/screens/`、诊断日志（`*.log`）
- 测试截图与中间产物；建议配合 `LS_SHOT_DIR` 把输出放到仓库外

> **唯一例外**：随文档一起提交、人工精选的 `assets/screenshots/*.png` 与 `assets/banner.svg` 属于仓库文档资源，在确认后随文档改动提交。普通测试自动生成的截图不属于此例外。

## 4. 遵守美术与资源约定（docs/STYLE_GUIDE.md）

任何改动渲染 / UI / 美术的代码都必须遵守 [`docs/STYLE_GUIDE.md`](docs/STYLE_GUIDE.md)：

- **暗底 + 单色辉光**：背景接近纯黑（海军蓝 `#05070c`），物体靠描边色与内发光被看见。
- **几何极简**：只用圆 / 菱形 / 菱形星等基础图形，统一描边。
- **青色 `#33e0ff` 为「系统 / 我方」基色**；橙 / 红 / 紫 / 金只用于敌人、威胁、稀有奖励。
- **资源随游戏打包**：场景纹理由 Canvas 程序化生成，音效由 Web Audio 合成。鲸鱼娘的社区素材与许可一起存放在仓库内。[素材与署名](docs/WHALE_CHAN.md)
- HUD 文字使用等宽字体（monospace），保证在小缩放下仍清晰可读。

## 5. 其他约定

- 不引入任何**云端 AI / 外部网络服务依赖**，除非在明确授权的阶段（见 `docs/` 路线图）下进行。
- 改动平衡数值时，优先复用 `src/config/` 下的数据驱动配置，而非硬编码到场景逻辑。
- 保持 Playwright 在无 Bridge / 无 AI 情况下持续通过——这是「无 AI 也能玩」的回归基线。
