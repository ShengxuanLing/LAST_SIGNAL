# 门禁逐行（每行 PASS/FAIL + 命令 + 结果 + 路径）

| 行 | 命令 | 结果 | 日志 |
|---|---|---|---|
| PASS | `npm run typecheck` | rc=0 | gate-typecheck.log |
| PASS | `npx vitest run <8 targeted files>` | 8 files / **55 tests** 全 PASS | gate-targeted-unit.log |
| PASS | `npm run game:mcp:build` | rc=0 | gate-mcp-build.log |
| PASS | `npm run build` | rc=0（无 __game 泄漏） | gate-vite-build.log |
| PASS | MCP 工具面静态检查 | Player step 无 intent/echoIntent；无 echo/companion 工具；`NO_MCP_TOOLS` | gate-mcp-surface.log |
| PASS | `npx vite-node reviewer-probe-frames-root.mts` | 9/9；真实 FRAME_DIR 换 junction 后 `restoreFile → E_PERMISSION` | gate-probe-frames-root.log |
| PASS | `npx vite-node reviewer-probe-actor-facade.mts` | 20/20；nearest/tie/death/echo-absent/actorId 消歧/无友伤/echo-hit 只入队 | gate-probe-actor-facade.log |
| PASS | `npx vite-node reviewer-probe-echo-view.mts` | 10/10；targets+Boss 公开数据、LOS/隐藏过滤、零隐藏字段泄漏 | gate-probe-echo-view.log |
| PASS | `npx vite-node reviewer-probe-checkpoint.mts` | 27/27；深验证拒绝非有限/技能/武器注入，正常升级与基础 stats 不误拒；`reset()` 全清 | gate-probe-checkpoint.log |
| PASS | 静态边界检查 | Enemy/Boss 只收 `ActorCombatPort`；facade 只 enqueue+version；echo-hit 仅由 processCommands 提交；`reset()` 4 类调用点 | gate-static-boundaries.log |
| PASS | `PORT=5409 npx playwright test tests/p3a-enemy-target.spec.ts tests/p3a-restore.spec.ts` | **3/3**（hunter 真伤+死后改选、全种类+Boss、restore 清授权） | gate-p3a-e2e.log |
| PASS | `PORT=5409 npx playwright test tests/p3a-echo-parity.spec.ts` | **1/1**；导出 initial/sequence/rendered.json | gate-parity-export.log |
| PASS | `npx vite-node scripts/p3a-echo-rendered-parity.mts` | `P3A_ECHO_RENDERED_PARITY_PASS ticks=215 steps=208 echoHp=86` | gate-parity-node.log |
| PASS | `npm run game:sim:parity`（最小 C2 无 echo 回归） | `PARITY_PASS checks=8 failures=0` | gate-c2-node-parity.log |
| PASS | `npx vite-node src/ai-native/worldConsoleSmoke.mts` | `WORLD_CONSOLE_SMOKE_PASS` 3/3 | gate-console-smoke.log |

- 开发服务器：自有独占端口 5409（strictPort, 127.0.0.1），用完即停；日志 gate-devserver.log。
- Playwright 产物：`pw-out-p3a-fixes/`、`pw-out-p3a-fixes-parity/`。
- 未在共享工作树/WIP/stash 读取任何证据；冻结快照 1945/1945 tracked blob SHA1 全匹配。
