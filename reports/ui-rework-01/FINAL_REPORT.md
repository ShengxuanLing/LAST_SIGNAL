# UI-REWORK-01 最终交付

结论：PASS。统一菜单实现、完整回归与独立审查已通过。

开发分支：`fix/ui-menu-layout-rework`。起点为包含 AI-NATIVE-02 的本地 `main @ 0faf95c`，不是落后 96 个提交的 `origin/main`。仅本地提交，不 push、创建 PR 或合并 main。

## 根因与实现

- 原 PauseScene 各页面分别硬编码坐标：授权和提示仅相隔 3px；340px 按钮无法容纳长标签；ECHO/LLM 入口游离在主列之外。
- Settings 的 Signal 开关遗漏在容器之外；退出设置时对象残留。状态刷新还会动态创建文字并遗留陈旧引用。
- HUD 与菜单同时显示；菜单缺少小屏字号、统一焦点与逐层返回规则。
- 重新授权表单覆盖了 `companion-reauth` 模式，导致原正式重新授权路径不可达。

新增 `src/ui/menuKit.ts`，统一字号、宽度、间距、换行、按钮状态、焦点、对象管理与滚动。`PauseScene.ts` 使用单页导航，离开页面即销毁对象，支持 compact 与 resize 重建。`GameScene.ts` 只增加 HUD 可见性管理和公告归属，不改世界碰撞、相机或暂停运行机制。

暂停根页固定五入口：Resume / Inventory / Settings / AI & Companion / Quit。AI 子页统一承载 Local AI、External Agent、ECHO、LLM；状态区独立。Settings 按真实已有设置分组，Signal 始终读取同一配置。

LLM 页面分连接、待确认建议与操作区域。Token/Owner Key 遮挡，表单阻止输入及点击穿透；ESC 仅关表单。没有建议时 Confirm/Reject 禁用；确认绑定当前显示的 suggestionId，刷新不抢焦点。重新授权使用现有正式路径，复用连接并取消旧建议。

## AI-NATIVE-02 兼容性

未修改 `src/ai-native/**`、Owner 协议、epoch、权限和动作校验。暂停确认仍只入队，恢复后由真实 core tick 提交。独立审查使用真实 Bridge、官方 SDK 和 Owner 表单验证授权、重新授权、确认和拒绝。

错误 Owner Key 后现有连接协议会降级至 `FALLBACK:NO_MODEL`，UI 如实报告失败，不伪称连接成功。本任务不改变该协议行为。

ESC：LLM/ECHO → AI → Pause → 游戏；Settings → Pause；从 Pause 进入 Inventory 时 I/ESC 返回 Pause，直接 I 进入时 I/ESC 恢复。原暂停机制保持不变。

## 测试结果

被测版本为 `0faf95c` 加最终 UI 源码、配套测试，以及原有 `World.ts` 删除 13 行修复。完整结果来自同一工作树；提交只记录这些已测内容，未改变其源码。

| 门禁 | 结果 | 日志 |
|---|---|---|
| `npx tsc --noEmit` | PASS，0 error | [33-typecheck.log](logs/33-typecheck.log) |
| `npx vitest run` | PASS，745/745，65 files | [32-unit.log](logs/32-unit.log) |
| `npm run build` | PASS | [34-build.log](logs/34-build.log) |
| `PORT=5433 npx playwright test --workers=1` | PASS，113/113，37 spec | [37-final-e2e-full-rerun.log](logs/37-final-e2e-full-rerun.log) |
| 独立小屏浏览器审计 | PASS，29 checks × 2 视口 | [Reviewer](reviewer/FINAL_REVIEW.md) |
| 独立 Owner/协议测试 | PASS，71 tests | [Reviewer](reviewer/FINAL_REVIEW.md) |
| 独立测试 diff 审查 | PASS，无断言弱化或阻断 | [TEST_REVIEW.md](reviewer/TEST_REVIEW.md) |

执行者分别为 Orca Worker developer（实现）、Orca Worker tester（完整回归与截图）、Orca Worker reviewer（独立源码、浏览器与测试审查）；Lead 核对冻结 hash、实看截图并整理提交。

完整测试说明与旧测试适配见 [Tester 报告](tester/REPORT.md)。新增 `tests/ui-menu-layout.spec.ts` 与 `tests/uiNav.ts`，适配 11 个旧 spec 的页面导航，保留功能与安全断言。

测试夹具明确限制：原 `Player.invuln = ...` 是无效的只读属性赋值。控制权/覆盖层测试改为 HP 低于 35% 时通过真实 `enqueueHeal` 稳定取证，证据标明人工加血；这些用例不代表无辅助生存验证。P3-a 禁用该辅助，死亡断言仍使用真实 tick 和伤害路径。没有放宽超时或删去断言。

## 视觉与响应式结果

| 视口 | 最终裁切 | 非预期重叠 | 主要页面 |
|---|---:|---:|---|
| 1920×1080 | 0 | 0 | Pause / Settings / Inventory / AI / ECHO / LLM |
| 1600×900 | 0 | 0 | 同上 |
| 1366×768 | 0 | 0 | 同上 |
| 1280×720 | 0 | 0 | 同上 |
| 1024×768 | 0 | 0 | 同上 |
| 800×600 | 0 | 0 | 同上，compact |

Lead 实看最终 800×600 Pause/LLM、1280×720 Settings 及真实 pending 页面；Reviewer 独立实看并操作 800×600、1024×768，验证 resize、最小 CSS 字号不低于 10px、表单遮挡、键盘、HUD 恢复时序。

修复前来自独立干净 `0faf95c` 工作树，避免 HMR 污染；42 张页面图。修复后 48 张页面图，另有 5 张功能图，共 53 张。相同审计器修复前每视口检出 4 clipped / 30 overlaps，修复后全部为零；合法父子包含和同一控件文字属于允许重叠。

对比示例：

| 页面 | 修复前 | 修复后 |
|---|---|---|
| Pause | [before](before/before-1280x720-pause.png) | [after](after/after-1280x720-pause.png) |
| Settings | [before](before/before-1280x720-settings.png) | [after](after/after-1280x720-settings.png) |
| LLM | [before](before/before-1280x720-llm.png) | [after](after/after-1280x720-llm.png) |
| 小屏 | [before](before/before-800x600-pause.png) | [after](after/after-800x600-pause.png) |

本地保留全部原始证据，不清理其他任务产物。Git 收录六视口的主要菜单页面、1280×720 修复前对比、审计 JSON、最终报告和关键日志；完整本地证据索引见 `EVIDENCE_MANIFEST.json`。未收录的原始截图和实验日志仍在本地，不冒充远端已有。

## 冻结源码 SHA256

```text
PauseScene.ts 3f01ebae1ffb5a4edd158268ba9476262cfb36b492bbc79eaea9dc006ab08e5e
menuKit.ts    c20131b2a402db12f1cb590754c4478c73269599f3611b1e1824fdd0f2becffd
GameScene.ts  aec3ff04e443fba87e1b1d52b334e297c62ed9be5670caeeb5c4a2d283a726f0
```

## Git 与已知限制

先单独提交已有 `World.ts` 13 行删除：该未使用的 `spawnProjectile` 别名违反现有 rewiring 测试源契约，所有通过结果都包含此修复；全仓库无调用者，独立 Reviewer 确认可提交。随后将 UI 源码与依赖新导航的测试一起提交，避免拆分成不可用中间版本。

未纳入本次提交：已有 `reports/ai-native-02/**` 脏证据、`Start-LAST-SIGNAL.cmd`、根目录 `developer/` 及其他未跟踪文件。保持 main 不动。

非阻断限制：过期 suggestionId 被安全拒绝后，列表标记和按钮可能暂时未刷新；继续点击仍会拒绝，不会确认另一条建议。旧 docs 仍有删除别名的历史描述，旧测试辅助 interval 为页面生命周期。完整绿色运行不构成所有负载下稳定性证明，也不替代真实玩家可用性反馈。

浏览器与人工看图均为 Agent 执行；没有声称项目所有者已亲自完成视觉验收。
