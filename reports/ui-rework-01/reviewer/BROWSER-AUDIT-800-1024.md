# UI-REWORK-01 · 真实浏览器小视口 audit（800×600 / 1024×768）

**这是修复前失败证据，不是 PASS。** 我是独立 reviewer，只读 src/tests，未改任何源码/测试。

## 0. 证据范围与版本（重要）

| 项 | 值 |
|---|---|
| 运行时间 | 2026-11-16 约 19:5x（见 `audit/ui-audit-summary.json` 的 `startedAt`/`finishedAt`） |
| 审计脚本 | `reports/ui-rework-01/reviewer/audit/ui-audit-800-1024.mjs`（独立 harness，非 tester 的 spec） |
| `src/scenes/PauseScene.ts` | sha256 `f3b679aa926697df…` |
| `src/ui/menuKit.ts` | sha256 `dd8c58f600dc4a0b…` |
| `src/scenes/GameScene.ts` | sha256 `58b9f53beed71b25…` |
| `tests/ui-menu-layout.spec.ts` | sha256 `e1bb64970ecdbb54…`（未运行、未修改） |
| 运行期间源码是否变动 | **否**（`sourceChangedDuringRun=false`，脚本首尾各取一次 hash） |
| ⚠️ 但此前/之后版本在持续变动 | 我上一轮 REVIEW-01 读到的 PauseScene 是 `f14643bc…`，本轮已是 `f3b679aa…`；menuKit 也在变。**本报告结论只对上述 hash 有效**，冻结版需重跑。 |

Dev server：`npx vite --port 5466 --strictPort`（我自己起的，审计后已 kill）。浏览器：本机 Chromium 158.0.8127.18（Playwright）。

## 1. 命令与结果（一行）

- `PORT=5466 node reports/ui-rework-01/reviewer/audit/ui-audit-800-1024.mjs` → **FAIL**（26 checks × 2 视口，**每视口 23/26 ok，共 6 项 FAIL**）→ 日志 `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/logs/ui-audit-console.log`，结构化数据 `D:/Project/LAST_SIGNAL/reports/ui-rework-01/reviewer/audit/ui-audit-summary.json`
- （上一轮已跑、本次未重跑：`npx tsc --noEmit` PASS → `reviewer/logs/tsc.log`；针对性 vitest 7 files/69 tests PASS → `reviewer/logs/vitest-owner-protocol.log`）

## 2. 3 项 FAIL（两个视口一致）— 按 Lead 要求作为修复前失败证据

| # | FAIL 项 | 实测 | 判定 |
|---|---|---|---|
| F1 | `all menu text >= 10 CSS px` | 800×600：**min 7.50 CSS px**，54 个文本低于 10（pause/settings/ai/echo/llm 均 7.50，inventory 8.13）；1024×768：**min 9.60**，22 个低于 10（inventory 10.4） | **R7 仍未修**：`menuKit.ts` 只有 `SMALL_FONT:12 / BODY_FONT:14 / BTN_FONT:18`，无 compact 分支。据此 800×600 的 STATUS 行/footer 只有 7.5 CSS px |
| F2 | `ESC closes the pairing form` | ESC 按下后表单仍在、暂停层仍在 | **B6 仍未修**：DOM 表单只能点 CANCEL；`onEsc` 的 `domForm` 提前 return 是死代码（表单 root `stopPropagation` 使 Phaser 收不到 ESC） |
| F3 | `settings volume arrows keyboard-reachable` | 在 Settings 页连按 14 次 ↑↓，焦点只经过 `[SCREEN SHAKE: ON, SIGNAL COLLABORATION · OFF, EXTERNAL LINK SETUP, BACK, RESET AUDIO]`，**从未**到 (700,148)/(860,148)/(700,180)/(860,180) 的音量 ◀▶ | **B7 键盘可达性**：页脚写「↑↓ SELECT · ENTER ACTIVATE」，但音量只能鼠标（Inventory 的 EQUIP 行同理，只能鼠标） |

## 3. 已通过的真实浏览器检查（同版本、两个视口均 ok）

- **布局无重叠/无越界**：`overlaps=0`、`oob=0`，覆盖 pause / settings / inventory / ai / echo / llm 六个页面，逐元素 `getBounds()` 两两求交 + 1280×720 边界检查（按钮 label 与其自身 hit 矩形不算重叠）。→ R1/R2/R3/R5 在小视口下同样成立。
- **HUD 隐藏与恢复**：暂停时 `GameScene.hudVisible=false`，ESC 恢复后 `true` → R6 成立。
- **ESC 层级**：inventory ESC 回 root（不 resume）；llm → ai → pause 逐层回退；root ESC 才 resume。
- **键盘焦点只在按钮之间**，且 **3 秒静置焦点不漂移**（pause/settings/echo/llm 四个页面各测一次）→ 在**无 pending 建议**的状态下没有定时抢焦点；**有 pending 建议时的 B4 抢焦点只能用静态证据**（见 §5）。
- **LLM 页禁用项不可聚焦**：`CONFIRM FIRST PROPOSAL`/`REJECT FIRST PROPOSAL` 在无会话时为 disabled，↑↓ 无法到达，`ENTER` 不会触发 → 与「禁空确认」一致。
- **DOM 表单遮挡**：35/35 采样点 `elementFromPoint` 都落在表单内，表单 `z-index 2147483000` 覆盖整视口；点击表单下方（PauseScene 按钮中心）不会命中 canvas，页面不变 → 不会误触暂停菜单。
- **DOM 表单保密性**：bridgeUrl=`text`、token/ownerKey=`password`；**同长度不同内容的 ownerKey 元素截图字节完全一致**（`sameLen=true`），换成更短内容则不同（`lenDiffers=true`）→ 截图像素只反映长度、不泄露字符；`document.body.innerText` 与 console 均不含哨兵串；`globalThis` 无 `ownerKey/token/externalLinkConfig` 残留 → 我不会把任何密钥写入证据。
- **无 console/page 错误**（两视口）。
- Inventory 的 `EQUIP` 行仍保留 `x=420, y=186/230/274` 与 `input.enabled` 语义（`checkpoint.spec.ts` 依赖），小视口下未被破坏。

## 4. 证据文件

- 截图（每视口一套，含 `pause/ai/echo/llm/settings/inventory/run-hud/after-resume` + `form-secret-typed.png`，800×600 与 1024×768 各一目录）：`reports/ui-rework-01/reviewer/audit/{800x600,1024x768}/`
- 结构化结果（每项 check 的 ok/detail、每页面几何 findings、每文本 CSS 字号、源码 hash 首尾）：`reports/ui-rework-01/reviewer/audit/ui-audit-summary.json`
- 原始 stdout：`reports/ui-rework-01/reviewer/logs/ui-audit-console.log`；harness 自带日志 `audit/ui-audit-run.log`
- dev server 日志：`reviewer/logs/vite-dev-5466.log`

## 5. 本 audit **未覆盖**（不得当作 PASS 依据）

1. **有 pending 建议时的焦点行为（B4）与「确认哪一条」（B3）**：需要真实 bridge 会话（pending proposals），本轮没有起 bridge，故只有静态证据（`setDecideEnabled()` → `focusButton(llmConfirm)` 在有建议时每 ~60 帧执行）。
2. **R8（reauth 被覆盖成死分支）**：在本轮 hash (`f3b679aa`) 上**仍然存在**（`:545/:549` 都传 `'companion'`，`:832` `linkFormMode = mode` 覆盖），静态确定，无需浏览器；修好后需实测「原子换 cap + 取消旧建议」。
3. 视口矩阵只覆盖 800×600 与 1024×768；1366×768 / 1280×720 / 1600×900 / 1920×1080 未在本轮跑。
4. 全量 vitest / 全量 Playwright 基线（743/745、91/93）未跑。
5. 表单「提交失败/成功」全链路、Settings 持久化重开验证未跑（本轮只测 ESC/遮挡/保密/取消）。

**结论：版面（R1–R6）在小视口下也无重叠、无越界，HUD/ESC/禁空确认行为正确；但 F1(R7)/F2(B6)/F3(B7键盘) 三项在小视口实测失败，且 R8/B4 在本轮 hash 上仍未修 —— 不能标 PASS。** 冻结版本请重跑本 harness 作为最终复核的输入。
