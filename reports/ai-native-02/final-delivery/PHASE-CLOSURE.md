# AI-NATIVE-02 PHASE-CLOSURE — 验收映射与最终范围

- 最终代码：`d1f29d1aa25ecf0fb461e756948de979019b3a26`（tree `aff25064cf9922ba3cf333ef4fd0dabed65e6972`）；`0faf95cc` 为 Task C 功能与双复核基线
- 分支：`feat/ai-native-world-integration`
- 状态：Task C 已知功能阻断已由 Reviewer + Tester 在 `0faf95cc` 双放行；`d1f29d1` 仅修最终 E2E 暴露的 `World.sim` 缓存失效与 PORT 硬编码，**最终真人验收未发生**。
- 本文只描述当前可复核事实，不把历史阶段快照当作现状，也不把“未迁移的 legacy 非 drone FSM”升级为本轮新增硬任务。

## 0. 先定口径：哪份文档是什么

| 文档 | 性质 | 本轮如何使用 |
|---|---|---|
| `docs/AI_NATIVE_ARCHITECTURE.md` | AI-NATIVE-01 的 P0 技术契约（DTO/权限/生命周期） | 只作架构边界引用，不作功能完成清单 |
| `docs/AI_NATIVE_PHASE_REPORTS.md` 的 C1/C2/C3 段 | 当时提交的阶段快照 | 只作历史证据；其中“C3 无 Signal / 仍是 P2 条件”是当时状态，**不是 `d1f29d1` 现状** |
| `docs/IMPLEMENTATION_TASKS.md` | 0.2.0 设计审计后的工单草案，明确未授权执行 | 不作本轮验收依据 |
| `reports/ai-native-02/WORKER-RECOVERY-HANDOFF.md` | 原错误会话后的 Task C 接续说明 | Task C 的真实任务口径 |
| `reports/ai-native-02/signal/REPORT-FINAL.md` | Task C 冻结 `363eb17` 的交付清单 | 历史基线；后续修复见 `signal-fix/FIX-REPORT-*.md` |
| 本文 | `d1f29d1` 的最终验收映射 | 以本表和独立报告为准 |

## 1. 验收映射（已实现 + 精确 hash + 独立报告）

| 能力 | 当前状态 | 关键提交 | 独立报告 | 明确范围 / 不证明 |
|---|---|---|---|---|
| 正式 World 人类/本地 AI 共用 `PlayerIntent` 控制路径、暂停/升级/死亡/接管/五视口 HUD | 已实现并独立验收 | `2d78e80`（P1）、`1aadd2e`（P1 修复） | `reports/ai-native-02/reviewer/REVIEW_P1_IMPLEMENTATION.md`、`reports/ai-native-02/tester/p1-final/P1-FINAL-ACCEPTANCE.md` | 本地 `LOCAL DETERMINISTIC`，不是外部模型；五视口为几何+人工判读 |
| 共享纯规则 `src/world/sim/rules.ts`、固定 60Hz core、Rendered/Headless canonical parity | 已实现并独立验收 | `cdb594e`（C1）、`4cf1bc8`（C2）、`a8232c8`、`c2b0215`/`6eb2ba0`（C2 修复） | `reports/ai-native-02/reviewer/c1/REVIEW_C1.md`、`reviewer/c2-closure-final/REVIEW.md`，及后续 `reviewer/c2-*` | 未迁移的 legacy 非 drone FSM 决策仍在 Rendered adapter；不宣称全 World 单核迁移 |
| 正式 World External Link / 官方 Player MCP（Player 最小合法遭遇） | 已实现并独立验收（最小子项） | `8ec8758`（C3-b）、`82734f6`（C3-c）、`593786b`/`4cb59e9`/`dcb4f14`/`87d6ae0`（后续 Player/边界修复） | `reports/ai-native-02/reviewer/lead-live/REVIEW.md`（冻结 `8b9705d`）、`reviewer/lead-headless-cropped/REVIEW.md`（冻结 `87d6ae0`）、`reviewer/c3b/REVIEW.md`、`reviewer/c3c-transport-final/REVIEW.md`、`tester/c3c-*` | 单 drone 最小遭遇；不是完整 Run、自主路线或跨平台稳定性；Owner 授权在证据中是自动点击 |
| ECHO 独立 Actor、HP/位置/伤害/观察/有限 memory、legacy 敌人可选中 ECHO | 已实现并独立验收 | `8b2de8e`、`c3e1461`、`b3930c5`（P3-a） | `reports/ai-native-02/reviewer/p3a/REVIEW.md`、`tester/p3a-final/` | fallback/确认边界保留；长期人格/完整玩法不在范围 |
| Companion 官方 MCP（observe/suggest/status/memory，无 confirm 工具）、独立 Owner pairing key/capability、Agent token 隔离、暂停存活/真实心跳 | 已实现并独立验收 | `dd42239`、`d768f6f`、`87ab379`、`ae8b4e2`、`d690848`、`a1188c2` | `reports/ai-native-02/tester/p3b-owner-auth-final/`、`tester/p3b-session-final/`、`reviewer/p3b-owner-functional/REVIEW.md`、`reviewer/lead-echo-model-live/REVIEW.md` | Agent 无 Owner key/cap；Owner 自动化点击不是真人验收 |
| 真实模型 ECHO 两轮建议 → Owner UI 确认 → 真实伤害/击杀 | 已独立核验（最小子项） | `d690848`（冻结） | `reports/ai-native-02/reviewer/lead-echo-model-live/REVIEW.md`、`reports/ai-native-02/lead-echo-model-live/` | 不是 Signal；不是真人；`status.pending` 的旧缺口后来由 receipts 修复 |
| Signal 共享纯规则、可选设备、独立 player/echo 能量、Headless Signal Combat | 已实现 | `c0cfdb6`、`1b0dca0`、`3fb8af9`、`c1cc2dd` | `reports/ai-native-02/reviewer/signal-scene2/REVIEW.md`、`tester/signal-scene2-final/` | 默认 NEW RUN 无设备；opt-in 才 spawn |
| Task C 正式 Relay 协作链（T/Y/R、opt-in、Relay 实体/门控、v1/v2 权限、真实 E2E、parity、官方 SDK 负向） | 已实现 | `5037c82`、`50e1ce8`、`4b2ab0d`、`363eb17` | `reports/ai-native-02/reviewer/signal-taskc-final/`、`tester/signal-taskc-final/`、`reports/ai-native-02/signal/REPORT-FINAL.md`（冻结 `363eb17`） | 该冻结点之后还有 field fix 链，见下一行 |
| Task C field fixes：ECHO 跨房迁移、memory kind、可用动作、房间世代、notify 竞态、stale applied、人类 R 跨房全局控制 | 已实现并由 Reviewer/Tester 双放行 | `246469b`、`7c0068f`、`c233e5c`、`4b938a5`、`0faf95cc` | `reports/ai-native-02/reviewer/signal-origin-final/REVIEW.md`、`reports/ai-native-02/tester/signal-origin-final/SIGNAL-ORIGIN-FINAL.md`，以及 `reviewer/companion-room-race-final/`、`tester/companion-room-race-final/`；开发者逐项定位 `reports/ai-native-02/signal-fix/FIX-REPORT-5.md` | stale/applied 证据与 origin 绑定已闭环；toggle 拒绝暂无事件、parity 未覆盖 origin 绑定属非阻断限制 |
| 最终交付修复：`World.sim` 在直接 `spawnEnemy`/`spawnBoss` 后正确失效；c3c Rendered 导出恢复真实 kill/loot；boss-room/canvas 支持 `PORT`（保留旧默认） | 已修复并验证 | `d1f29d1` | 本目录 `GATES.md`、`RED-world-sim-cache.log`、`GREEN-world-sim-cache.log`、`POSTFIX-c3c-node-parity.log`、`GREEN-boss-room-5411.log`、`GREEN-canvas-5411.log` | 测试锁定的缓存失效漏洞；非产品规则调整，不改 core 规则/伤害/断言；`c3c` 的旧 83/85 日志保留为历史 |
| 真实模型 Signal 最小回合（observe → scan suggest → Owner UI → echo 扣费/evidence → toggle → ACTIVE → portal） | 已独立核验（最小子项） | `363eb17`（冻结运行时） | `reports/ai-native-02/reviewer/lead-signal-model-live/REVIEW.md`、`reports/ai-native-02/lead-signal-model-live/REPORT-LEAD.md` | Owner 为自动点击；echo 当时留旧房；未覆盖 jam；不是完整 Run / 真人 |

## 2. 最终验收边界（必须保留）

### 2.1 已关闭

- Task C 已知功能阻断：旧房建议执行、notify in-flight、echo portal migration、memory/availability、房间世代、stale applied、人类 R 跨房控制。
- `0faf95cc` Reviewer 定向复核与 Tester 独立复验均 PASS；见 `reviewer/signal-origin-final/REVIEW.md`、`tester/signal-origin-final/SIGNAL-ORIGIN-FINAL.md`。
- `d1f29d1` 修复最终 E2E 暴露的 `World.sim` 缓存失效；最终完整 E2E 93/93，全绿。
- 最终同 tree 全量单测 743/743。
- 默认 MCP / Headless / Companion smoke、F-03、typecheck/build 全 PASS（见 `GATES.md`）。

### 2.2 仍需用户真人操作（NOT RUN）

1. **真人 Owner 最终确认**：现有模型证据的 CONFIRM/AUTHORIZE 都是 UI 自动点击夹具，不是真人验收。
2. **真人完整试玩**：没有真实人类从 NEW RUN 完成一次 Player/ECHO/Signal 的完整链路；所有“完整链”为 Playwright/fixture 或 Lead 最小回合。
3. **真人跨房判断**：人类 R 跨房控制已由真实浏览器自动化覆盖，但没有真人操作录像/签字。
4. **真实人类可读性/理解验收**：五视口截图与 HUD 文字为开发者/Tester 查看，不等于用户理解验收。

### 2.3 明确不在本轮范围

- 完整 Run/长期稳定性、跨机器/跨系统、多人并发。
- 非 drone legacy FSM 的 Headless 全量迁移（既有 adapter 边界，不升级为 Task C 硬任务）。
- 新模型策略/SDK 预设、自动代替 Owner、Agent 持有 Owner key。
- 除 `d1f29d1` 的最小缓存/PORT 修复外，不扩大设计、不改 core 规则/伤害/断言；其余最终交付为 `reports/` 文档。

## 3. 最终 E2E 事实

- 自有端口 **5411**，全部 **32 个 spec、88 tests**：**88 passed / 0 failed（8.0m）**，见 `final-e2e-5411-fixed.log`。
- 首跑即绿；未使用反复重跑追绿。
- 历史 `final-e2e-5411.log`（修复前 83/85）与 `retry-*`、RED 日志保留，不删除、不覆盖。
- `boss-room`/`canvas` 已改为 `PORT ?? 旧默认`，在 5411 真实页面/DOM 上通过；未触碰他人 5173/5199。
- `c3c-headless-parity` 在 `d1f29d1` 上真实重生 initial/sequence/rendered，Node 16/16 PASS；Signal/ECHO parity 导出 + 重放仍 PASS。

## 4. 结论

`d1f29d1` 是当前最终交付代码：**Task C 功能完成 + Reviewer/Tester 双复核通过 + 最终完整 E2E 93/93，全绿**。但 **AI-NATIVE-02 的人类最终验收仍未发生**。交付给用户的范围是：

- 可演示、可复核的 Player / ECHO Companion / Signal 三条链路；
- 已有模型证据的最小回合；
- 已知测试与平台限制；
- 待用户真人完成 Owner CONFIRM、完整试玩与最终接受。
