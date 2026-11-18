# GAMEPLAY-01 · P3 展示冻结候选 · 独立审查（只读 + 独立快照）

**结论：不能给 P3 PASS —— 存在 1 个 BLOCKER（冻结节↔工作树不一致），另有 1 个 MAJOR（玩家面仍暴露实现术语/原始 id/code）。**
P3 的**行为**部分（纯文案、刷新不重生建议、WAITING 禁用、"Done 仅真实 receipt"、来源诚实、ESC/缩放/字号/重叠）**在我实测范围内通过**；但"冻结候选"这个前提不成立。

- 0 次模型请求；未改 src/tests/config；未提交/推送；未用 tester 5491/5199 或克隆。
- 平台：`git archive 0083e20` + `reports/gameplay-01/developer/p3/final/manifest.json` 的 4 源 → 独立快照 `D:/tmp/gp01-p3`（自有 node_modules junction），cwd/devRoot 均在该快照；运行前后 4 源 hash **不变**（`/tmp/p3-before.txt` vs `p3-after.txt` 一致）。

## 0. BLOCKER：manifest 与工作树不一致（"冻结候选"不成立）

| 源 | manifest sha256（前 16） | 工作树/快照（前 16） | 字节 |
|---|---|---|---|
| `src/scenes/GameScene.ts` | `11af218697007584` | **一致** | 62760 ✓ |
| `src/ui/menuKit.ts` | `3fd1258255796b34` | **一致** | 12054 ✓ |
| `src/ui/feedback.ts` | `303ebd661cb43bfd` | **`fe023e3a900574cf`** | 8894 → **8823** |
| `src/scenes/PauseScene.ts` | `4dfc186514df5e06` | **`eb0d3cdde7248724`** | 60960 → **60948** |

旁证：manifest 自己的 `copy_table.waiting` 写的是 `"Queued status; **Waiting for the next core tick**; …"`，而工作树 `feedback.ts` 的 `waitingLines()` 已是 `'Waiting to resume'`（无 "core tick"）—— **manifest 记录的是更早的文案版本**。
→ 在重新出具 manifest（或确认采用哪一份）之前，本次结果只能标注为"对工作树 `feedback fe023e3a` / `PauseScene eb0d3cdd` 的审查"，**不能称为冻结版 PASS**。

## 1. 已实测通过（行为层）

| 检查 | 实测（`reviewer/p3-browser.log`） |
|---|---|
| 纯文案函数无副作用 | `src/ui/feedback.ts` 只 import **type** 与 `SIGNAL_TUNING` 常量；无 World/core/state 访问、无 Date/Math.random、无写入 ✓ |
| page refresh **不**重生建议/清 guard | `refreshLocalCoop()`（PauseScene:707-780）只**读** `echoPendingLocal/echoLocalProposal` 并渲染；`world.proposeLocalEcho()` 只在 `buildLocalCoop()` 打开页面时调一次（:624 注释明确）✓ |
| WAITING 禁用、无输入穿透 | 实测暂停确认后 `localConfirm.enabled=false`、`localReject` 同样禁用（截图 `p3-waiting-1280x720.png`）；按钮 `activate()` 受 `enabled` 门控，键盘 ENTER 不会触发 ✓ |
| **Done 仅真实 receipt** | 暂停中 notice = `Queued · Scan relay · runs after you resume`（**不是 Done**）；resume 后实测 `Done · relay scanned`（`L2` vs `L3`）✓ |
| 来源诚实 | `receiptLine`：`enqueued→Queued` / `applied→Done` / `rejected→Rejected`；`provenance==='owner-external'` 前缀 `Model Owner · `，human-local 无前缀；`localStatus` 标注 owner ✓ |
| ESC 逐层 | 实测 `local-audit → local-coop → echo`（两次 ESC）✓ |
| 缩放/重开销毁 | 800/1024/1280 三档重开页面无残留对象；测量 `outside=[]`、`overlaps=[]`（合法父子除外）✓ |
| 字号 ≥10 CSS px | 1280：12；1024：12.8；800：local 文本 **10.00**、状态行 10.63（均 ≥10）✓ |
| HUD 两行 | `txtSignal`（`RELAY …`）+ `txtSignalDetail`（`T SCAN · Y JAM · R TOGGLE · LINK ON`），**单行不换行、截图无裁切**；颜色 `#8fb8c8` 对比度 **9.46:1 ≥ 4.5**，12 CSS px ✓；旧 HUD 隐藏/恢复仍走 `setHudVisible`（`txtSignalDetail` 在 `hudObjects` 内）✓ |
| 旧 HUD 隐藏/恢复 | 本地页截图里 GameScene HUD 已隐藏（`p3-waiting-1280x720.png`）✓ |

## 2. MAJOR：玩家面仍暴露实现术语 / 原始 id / code（按 P3 目标给最小修正）

`LOCAL AUDIT` 页（`buildLocalAudit`）逐行渲染 `auditLines()`（`src/ui/feedback.ts:176-183`），实测输出：

```
#1 human-local · scan · rejected · E_PERMISSION · tick 1000 · local_1000_0 · target 8.0,45.0 · room gen 1
#2 model-owner · toggle-relay · applied · tick 1001 · local_1001_1 · target 8.0,45.0 · room gen 1
```

问题：原始 `proposalId`、`tick`、核心错误码 `E_PERMISSION`、浮点坐标、`room gen`、内部 provenance 词（`human-local`/`model-owner`）全部直出。
**最小修正（仅文案/格式化，不动协议）**：
1. `feedback.ts:181` 改为：`source` → `'You'` / `'Model (Owner)'`；去掉 `proposalId`；把 `tick N` 换成相对序号（如 `#3`，已有）或"最近"；`entry.code` 先过 `errorCopy()`；`target` 四舍五入到 1 位或省略，`room gen` 仅在**不匹配**时显示（或整体去掉）。
2. `feedback.ts:129` `E_PERMISSION` → `'Not possible right now'`（现在是 `Action not permitted · check the target and permission`，实测出现在 800 页 notice）。
3. `PauseScene.ts:814`（LLM 页 footer）`COMMIT ON THE NEXT CORE TICK` → `Takes effect when you resume`（"core tick" 是内部术语）。
4. `PauseScene.ts:623` 副标题 `LOCAL ECHO · OFFLINE · A HUMAN CONFIRMS`：该页是**本地通道**，模型链路同时在线时写 "OFFLINE" 不准确 → `LOCAL ECHO · A HUMAN CONFIRMS`（或仅在 `companionLink===null` 时加 OFFLINE）。

以上 4 条都是纯展示改动，不涉及 P2 队列/授权/恢复与 Owner 路径。

## 3. 非阻断

1. **`feedback.ts` 无单测**（`src/ui/*.test.ts` 不存在）：纯函数极易测（错误码映射、waiting/receipt 文案），建议补 6–10 条，防后续回归。
2. **LOCAL AUDIT 是静态快照**：`buildLocalAudit` 只在进入页面时 `echoAudit.recent(8)` 取一次，无 `p.refresh` → 页面打开期间新增动作不会自动出现（需退出重进）。属设计选择，建议在副标题注明 "as of opening" 或加 1 秒刷新。
3. **800 密度**：8 行在 800×600 会折成 2 行/条（`localAuditText` 546×256，`outside=0` 无重叠），可读但密；与 developer `limitations` 自述一致。
4. 我的第一版 HUD 裁切测量用世界坐标 `getBounds()` 得出 `clipped:true` 是**测量口误**（HUD 经相机逆变换屏幕锁定）；已改用截图核对，HUD 无裁切。
5. 本地页副标题/状态与提案正文**对齐方式混用**（状态居中、提案左对齐 x=400），视觉上略偏；非缺陷。

## 4. 未验证（不计入 PASS）

- **6 视口证据**：我只独立跑了 1920 未跑；实测档为 **800/1024/1280**；1600/1366/1920 采信 developer `viewport_summary`（minCss 15/12.8/18、contrast 9.46、outside/overlaps 0），**未独立复跑**。
- **纯键盘矩阵**：只验证 ESC 链与"禁用按钮不被 ENTER 触发"，未做完整 ↑↓ 焦点遍历/焦点环可见性。
- 指针边缘（拖拽/滚轮/触摸）、真实人类可读性/理解度（`HUMAN ACCEPTANCE PENDING`）。
- 完整 794 / 全量 Playwright（Tester 负责）；未跑 P2 队列/授权/恢复的回归（P3 不改这些，但未实测）。

## 5. Gate（一行一条）

| 命令/检查（cwd = 快照 `D:/tmp/gp01-p3`） | 结果 | 绝对日志 |
|---|---|---|
| manifest 4 源 hash vs 快照/工作树 | **FAIL**（2/4 不一致：feedback.ts、PauseScene.ts） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/developer/p3/final/manifest.json`；本次 `/tmp/p3-before.txt` |
| `npx tsc --noEmit` | **PASS**（0 error） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/p3-typecheck.log` |
| `PORT=5489 npx playwright test -c _review/pw.p3.config.ts --workers=1`（真实 DEMO01 + 本地确认/等待/Done/audit/ESC/缩放/HUD） | **PASS**（1 passed / 1.3m） | `D:/Project/LAST_SIGNAL/reports/gameplay-01/reviewer/p3-browser.log` |
| 快照 4 源 hash 运行前后 | **PASS**（未改动） | `/tmp/p3-before.txt` = `/tmp/p3-after.txt` |

## 6. 复跑与证据

- harness（已脱敏复制，无密钥）：`reports/gameplay-01/reviewer/p3-harness.p3.spec.ts`、`pw.p3.config.ts`；复跑：`git archive 0083e20 → 快照 + 4 源 → npx vite build? (无需 mcp) → npx vite --port 5489 → PORT=5489 npx playwright test -c _review/pw.p3.config.ts`，**cwd 必须是独立快照**。
- 截图：`reports/gameplay-01/reviewer/p3-shots/`（提案、WAITING、audit-1280、audit-800）。
- 依据行号：`feedback.ts:76-92`(status/proposal)、`:152-162`(waiting/receipt)、`:129-149`(errorCopy)、`:176-183`(auditLines)、`PauseScene.ts:614-682`(buildLocalCoop)、`:707-780`(refresh)、`:686-704`(buildLocalAudit)、`:814`(llm footer)。
