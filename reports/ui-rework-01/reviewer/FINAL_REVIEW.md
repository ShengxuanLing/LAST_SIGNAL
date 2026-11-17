# UI-REWORK-01 · 冻结版最终独立审查（Reviewer）

**结论：PASS（本审查范围内，无阻断项）。** 附 2 条非阻断改进建议 + 明确的证据覆盖边界（见 §6）。
我是独立 reviewer，全程只读 src/tests，未改任何源码或测试；未 push / 未提交 / 未 merge / 未清理。

## 1. 冻结校验（先于一切结论）

Lead 给定的冻结 SHA256 与工作树**逐字节一致**，且在我的三次验证运行前后未变：

| 文件 | SHA256（实算） | 与 Lead 给定 |
|---|---|---|
| `src/scenes/PauseScene.ts` | `3f01ebae1ffb5a4edd158268ba9476262cfb36b492bbc79eaea9dc006ab08e5e` | ✅ 一致 |
| `src/ui/menuKit.ts` | `c20131b2a402db12f1cb590754c4478c73269599f3611b1e1824fdd0f2becffd` | ✅ 一致 |
| `src/scenes/GameScene.ts` | `aec3ff04e443fba87e1b1d52b334e297c62ed9be5670caeeb5c4a2d283a726f0` | ✅ 一致 |

- 浏览器 harness 在运行首尾各取一次 hash：`sourceChangedDuringRun=false`（`audit/ui-audit-summary.json`），即**证据对应的就是冻结版**。
- 分支 `fix/ui-menu-layout-rework` @ `0faf95c` + 上述三文件 dirty + `src/ui/` 新增；`src/world/World.ts` 仍是原有的 `0 13`（-13 行 spawnProjectile 别名删除，未变）。
- 本任务变更范围：`src/scenes/PauseScene.ts`、`src/scenes/GameScene.ts`（+30 行，4 个 hunk：`hudObjects`/`hudVisible`、deck 公告并入 HUD、`setHudVisible`、`refreshHud` 隐藏时短路）、新增 `src/ui/menuKit.ts`。**未触碰** `src/ai-native/**`（Owner 协议/epoch/权限/companion 网关）、`src/main.ts`、相机 / `lockHud()` / `WorldRenderer` 光照（`git diff --name-only 0faf95c` 只命中上述文件 + 既有 `reports/**` 脏文件 + tester 的 `tests/**`）。

## 2. Gate（命令 → 结果 → 日志绝对路径）

| # | 命令 | 结果 | 日志 |
|---|---|---|---|
| G1 | `npx tsc --noEmit` | **PASS**（0 error） | `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/tsc-ff.log` |
| G2 | `PORT=5466 node reports/ui-rework-01/reviewer/audit/ui-audit-800-1024.mjs` | **PASS**（29 checks × 2 视口 = 58，0 失败） | `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/ui-audit-console-ff.log` |
| G3 | `PORT=5466 npx playwright test -c reports/ui-rework-01/reviewer/audit/pw.reviewer.config.ts` | **PASS**（1 test，20.7s，真实 loopback bridge + 真实 Owner 表单） | `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/companion-final.log` |
| G4 | `npx vitest run ownerAuth worldBridgeServer companionGateway companionFacet companionRoomGeneration companionRoomBoundary rewiring signalState` | **PASS**（8 files / 71 tests） | `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/vitest-owner-protocol-ff.log` |

结构化数据：`audit/ui-audit-summary.json`（逐 check 明细、每页几何 findings、每文本 CSS 字号、源码 hash 首尾）；证据截图 `audit/{800x600,1024x768}/*.png`、`audit/companion-{connected,pending,reauthorized,wrongkey}.png`。
按 Lead 要求**未跑**全量 vitest / 全量 Playwright（避免与 tester 争用）。

## 3. B1–B7 闭环（含实测证据）

| # | 状态 | 证据 |
|---|---|---|
| B1/R8 reauth 死分支 | **已闭环** | `openOwnerForm()` 直接传 `openExternalLinkForm('companion-reauth' \| 'companion')`，`linkFormMode` 只在 `openExternalLinkForm` 内赋值一次。实测（G3）：live link 上点「ENABLE / RE-AUTHORIZE (HUMAN)」→ 表单标题 `COMPANION · HUMAN OWNER PAIRING` → 提交后 **同一个 `CompanionLink` 对象**（预置 `__auditMark='same-object'` 仍在）→ `status=CONNECTED` → **旧 pending 被取消**（UI `No pending proposal.`）→ 换 cap 后 agent 新建议仍被接受（`suggest 200`, `createdAtTick=79/80, epoch=1`）。 |
| B2/R7 小屏可读性 | **已闭环** | compact 令牌集（`SMALL 16 / BODY 17 / BTN 20 / TITLE 40 / BTN_W 520 / STRIDE 56`）+ `resolveUITokens()` 与 GameScene F-06 同判据（`scale<0.85`）+ `scale.on('resize')` 触发 compact 翻转重建。实测：800×600 所有菜单文本 **min 10.00 CSS px，below-10 计数 0**；1024×768 min 10.00；resize 到 1200×900 后 `compact=false`、重叠/越界 0、min 11.25 CSS px。 |
| B3 确认对象绑定 | **已闭环（含 fail-closed）** | `selectedSuggestionId = pending[0].suggestionId`、`▶` 标记、footer「CONFIRM ACTS ON THE ▶ LINE ONLY」。实测：两条真实建议 A、B → UI `▶ A`（`selected=sug_aaa…`，B 在第二行）→ 点 CONFIRM 后**只剩 B 且 B 变成 ▶**（证明确认的是 ▶ 那条 A）。把 `selectedSuggestionId` 人为改成不存在的 id 后点确认 → footer `PROPOSAL CHANGED OR EXPIRED — NOT SENT`，**没有任何决定被记录**；随后再点 CONFIRM → `NO SELECTED PROPOSAL`，仍未确认 B。 |
| B4 焦点被定时抢占 | **已闭环** | `setDecideEnabled()` 不再调 `focusButton()`（注释「Never steal focus to CONFIRM」）。实测：有 pending 时焦点 3.2 秒保持 `640,186`（ENABLE 按钮）不变，且不等于 CONFIRM 的位置。 |
| B5 HUD 公告 / tween 恢复 | **已闭环** | `showDeckArrival` 的公告并入 `hudObjects` 并在创建时继承 `hudVisible`；`close()` 不再提前恢复，改由 `shutdown` 恢复。实测：运行中公告 visible=true → 暂停 false → 恢复 true；关闭时 **淡出中途 (`midClose`) HUD 仍 hidden 且 PauseScene 仍 active，淡出结束 (`endClose`) 才 hidden→visible**。 |
| B6 表单 ESC / 敏感数据 | **已闭环** | 表单 root 内新增 `keydown` ESC → 只关表单（`preventDefault+stopPropagation`），`onEsc` 不再可能被穿透；外部分支**不再把 token 写进 `globalThis.__externalLinkConfig`**。实测：35/35 采样点被表单覆盖、z-index 2147483000、点下方不命中 canvas；bridgeUrl=text、token/ownerKey=password；**同长度不同 ownerKey 的元素截图字节完全一致**（换更短则不同）→ 截图只反映长度；`innerText`/console/`globalThis` 无哨兵串；CANCEL 关表单且暂停层保留；**ESC 只关表单、暂停层与当前页面不变**；并有 Phaser `formBlocker` 吸收逃逸指针。 |
| B7 键盘可达性 | **已闭环** | 音量 ◀ ▶ 改为真正的 `p.button`（40×30）。实测 Settings 页 ↑↓ 扫描：`buttons=9 reached=9 stray=0`，4 个箭头全部可达；Inventory 仅 CLOSE 可聚焦（EQUIP 行为指针操作，`x=420, y=186/230/274` 与 `input.enabled` 语义保留）；LLM 禁用态 CONFIRM/REJECT 不可聚焦、ENTER 不触发。 |

## 4. R1–R9 复核

- R1 底部压字 / R2 长标签越界 / R3 入口散落 / R5 Signal 漏容器：六个菜单页在 800×600 与 1024×768 下 **overlaps=0、out-of-bounds=0**，min CSS 字号 ≥10（G2），且截图人工核对（compact Settings / compact LLM / 1280×720 root+LLM+Settings 各一张）。
- R4 惰性 Text / 陈旧引用：页面对象由 `MenuPage` 统一拥有并 `destroy()`，`navigate()`/`shutdown` 重置 `lastStatusSig/lastCompanionSig/lastPendingSig/selectedSuggestionId`；`update()` 不再创建对象。
- R6 HUD 干扰：`setHudVisible(false)` + `refreshHud` 隐藏期短路 + 退出/QUIT/shutdown 恢复 + 公告并入（B5 实测）。
- R7 / R8 / R9：见 §3 B2 / B1 / B3。
- 额外确认：ESC 层级（llm→ai→pause，inventory→root 不 resume，root ESC 才 resume）、`I` 只关背包、Inventory EQUIP 锚点保留、无 console/page error（唯一 403 是**故意用错 Owner key** 的预期协议拒绝）。

## 5. 非阻断改进建议（不影响 PASS）

1. **stale-id 守卫后的 UI 一致性**：守卫触发后 `selectedSuggestionId=null` 但列表仍显示 `▶` 且 CONFIRM/REJECT 仍 enabled（`refreshPending()` 因 `lastPendingSig` 未变而提前返回）。此时点击只会得到 `NO SELECTED PROPOSAL`（**fail-closed，不会误确认**），但视觉上「有 ▶ 却不可确认」。建议：守卫分支里重置 `lastPendingSig` 强制重渲染（或在渲染时把 ▶ 与 `selectedSuggestionId` 一起清）。
2. **证据目录**：`reports/ui-rework-01/developer/` 迁移过来的截图只有 1280×720 七张，**没有 compact 视口截图**；compact 证据目前只在 reviewer 的 `audit/{800x600,1024x768}/`。若最终交付需要「六视口 bbox 截图」留档，建议把 developer 的六视口图也迁进该目录（Lead 转达即可，我未代劳）。

## 6. 证据覆盖与边界（不夸大）

**已实测覆盖**：800×600 与 1024×768 的六个菜单页几何/字号/无重叠/无越界；1200×900（非 compact）resize 翻转；键盘可达性与焦点稳定性；HUD 隐藏/恢复/公告/淡出时序；DOM 表单遮挡、ESC、CANCEL、密码掩码、无密钥泄漏；真实 bridge + 真实 Owner 表单下的 pending 渲染、▶ id 绑定、stale fail-closed、reauth 原子换 cap + 取消旧 pending、错误 Owner key 的诚实降级；针对性 Owner 协议 8 文件 71 测试；typecheck。

**未覆盖（不得据此宣称全绿）**：全量 vitest 基线（743/745）与全量 Playwright 基线（91/93）——属 tester/Lead 的最终 gate，我按要求未跑；1366×768 / 1280×720 / 1600×900 / 1920×1080 四视口的独立 harness 复跑（developer 报告有六视口 bbox，我只独立验了 800×600 / 1024×768 / 1200×900）；Settings 跨刷新持久化重开；wheel 滚动路径（`endRegion` 已修带返回值，但在所有受支持视口内容都放得下，实际未启用滚动，属设计选择而非缺陷）；tester 的 `tests/ui-menu-layout.spec.ts` 与 `tests/uiNav.ts`（tester 领地，我未运行也未修改）。

**错误 OwnerKey 的语义**：按 Lead 说明与实测一致——协议拒绝后 `CompanionLink` 进入 `FALLBACK:NO_MODEL`，UI 如实显示 `STATE FALLBACK:NO_MODEL`、`MODEL OFFLINE · E_PERMISSION companion.owner_capability_required`、表单 `RE-AUTH FAILED — link FALLBACK:NO_MODEL`，**没有**伪称 connected 或「unchanged」。这符合既有协议，本任务未改协议，也不要求改成 CONNECTED。
