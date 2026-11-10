## 变更说明
简述本次改动的目的与主要内容；只提交必要文件，避免夹带无关改动。

关联 Issue：#（填写编号，可用 `Closes #编号` 自动关闭）

## 复现步骤（验证路径）
1. `npm ci`
2. `npm run dev`（默认 5173；涉及 `tests/canvas.spec.ts` 时还需同时启动 5199）
3. 打开 `http://localhost:5173/`，按以下步骤验证：
4. 运行 `npx playwright test --reporter=line --workers=1`

## 期望行为
改动后应达到的效果、具体表现与可验证的验收标准。

## 实际行为（改动前）
改动前的行为或缺陷表现，便于对比；若为新增能力，请写「新增能力，原行为为无」。

## 环境
- 操作系统 / 浏览器及版本：
- Node.js / npm 版本：
- 分支 / commit SHA：
- 运行方式（dev 5173 / 5199、`npm run preview`、静态托管）、固定种子与存档：
- Playwright 截图目录：CI 中由 `LS_SHOT_DIR`（`${{ runner.temp }}/screens`）指定：

## 截图 / 日志
- 改动前后的界面对比截图或录屏（拖入附件，敏感信息请打码）：
- 关键日志：`npm run typecheck`、`npm test`、`npm run build`、Playwright 结果、`errors.json`：
- 控制台报错 / `pageerror`（应为 0）：

## 验收清单
- [ ] 代码仅包含本次变更，未提交 `dist/`、`node_modules/`、`test-results/`、`tests/screens/` 等产物
- [ ] `npm run typecheck` 通过
- [ ] `npm test` 通过
- [ ] `npm run build` 通过
- [ ] 5173 与 5199 两个 Vite dev server 同时就绪后，`npx playwright test --reporter=line --workers=1` 通过
- [ ] 端到端测试无 `pageerror` / 控制台错误，`errors.json` 记录 0 错误
- [ ] 截图 / 日志输出到 `LS_SHOT_DIR` 或附件，未写入仓库产物目录
- [ ] 文档、配置与测试随代码同步更新，未引入未在 `package.json` 声明的额外依赖（就绪等待类依赖等）
- [ ] 未包含密钥、凭据或敏感信息；已自审 diff 并关联 Issue
