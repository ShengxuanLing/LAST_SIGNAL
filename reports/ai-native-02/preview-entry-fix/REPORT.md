# 生产预览入口修复（独立小提交）

- 问题 1：`tests/checkpoint.spec.ts` 用 `constructor.name === 'LevelUpScene'` 选场景，test-build minify 后类名变成短名 → 找不到升级卡。改为真实 `sys.settings.key`（`checkpoint.spec.ts`、`audit.spec.ts` 全部同类选择器一并改，未放宽断言、未禁 minify）。
- 问题 2：`vite.config.ts` rollup input 缺 `economy.html`，`vite preview` 回退 index → 供给终端 DOM 不存在。补 `economy` 输入；已有 `main`/`station-zero` 输入不动，无新功能。
- 顺带修复 P3-a Actor 端口改造后的旧直调回归：`Enemy.update/doAttack`、`Boss.update/doAttack` 接受**只读 ActorCombatPort** 或旧 `PlayerLike`（共享 `toCombatPort`），仍走 `Player.hurt`→core pending hit，不绕 core、不复制 World；`audit.spec.ts` 的 enemy/boss 直调 E2E 恢复 2/2。
- 同份 test-build preview：`checkpoint/economy` **7/7**、`vs00/vs01` **13/13**（合计 20/20）；生产 `dist` preview 三入口 `/`、`/economy.html`、`/station-zero.html` 均有真实 DOM 且**无 `__game`**（`PREVIEW_ENTRY_SMOKE_PASS`）。
- 只把 dev 通过当参考不算放行：本报告全部关键结论来自 `vite preview --outDir dist-test` 与生产 `dist`。
- 日志：`reports/ai-native-02/preview-entry-fix/logs/gate.log`；未 merge/push/stash。
