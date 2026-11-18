# P3 TEST REVIEW — independent read-only review of the new P3 acceptance spec

Reviewer: independent, read-only. Date: 2026-11-18.
Scope: **the new P3 test spec only** (7 cases) + the final hash. The P3 product source already passed /
was committed as `7007ce2`; I did not re-review it and did not run the full suite, typecheck of the
whole tree, or anything model-related.

## 0. Pinned inputs and my own reproduction

| item | value |
|---|---|
| spec under review | `reports/gameplay-01/tester/p3/run30/source-snapshot/tests/gameplay-03-feedback.spec.ts` |
| sha256 | `7aecf2160a2c5c14981f0f0b1054860388ba8362b6a24cba8a1302b13ffa3a5e` — **matches the Lead's number** |
| product tree | `git archive 7007ce2` (= `ls-p3-accept@0083e20` + 5 P3 v2 sources), my own extraction |
| my workdir | `D:\tmp\gp01-p3r` (own tree, own port **5494**; tester's 5492/5199, their clone and the shared P4 tree untouched) |
| my run | `PORT=5494 npx playwright test tests/gameplay-03-feedback.spec.ts --workers=1 --reporter=line` → **7 passed (1.3m), exit 0** |
| log | `D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p3-spec-run.log` |
| my evidence / shots | `…\reviewer\p3-run\evidence\p3-*.json`, `…\reviewer\p3-run\shots\p3-*.png` |

Two independent trees, two different ports, identical outcome → the 7/7 is **reproducible**, not
load-dependent. The tester's own gate logs agree (`run30/logs/p3-ui.log` 7 passed 1.3m skip 0;
`run30/logs/typecheck.log` 0 `error TS`).

**Verdict: PASS for the evidence that matters, with 2 vacuous assertions and 3 over-broad labels that
must be corrected before the archive wording stands.** Details in §2. No product defect is claimed
anywhere in this review.

## 1. Checklist (the exact items I was asked to check)

| item | result | note |
|---|---|---|
| final hash | **PASS** | `7aecf216…` on both the archive copy and my tree |
| camera-aware click is not a bypass of the real click | **PASS** | real `page.mouse.click` on the canvas box; details §3.1 |
| boot → real ENABLE → settle → echo/alive/human gates | **PASS** | `readyLocalProposal` / `enableEchoAndSettle`; my run recorded `hasEcho:true, alive:true, owner:'human'` |
| Ready before confirm, Waiting after | **PASS (state)**, **FAIL (the "CONFIRM enabled" half is vacuous)** | `F1` |
| same proposalId, queue = 1, second confirm adds nothing, real resume applied | **PASS** | my run: `queue:['signal-scan']` before/after the 2nd click, `pending` identical, `auditApplied` contains the pid, `pending` null |
| keyboard-disabled really not focusable / not activatable (not "page navigated away so no buttons") | **PASS** | evidence: focus cycles exactly the 3 enabled controls; details §3.2 |
| audit: 10 injected entries are layout-only, ≤8 visible, round trip does not change pending | **PASS** | `numbered: 8` from 11 real+injected; `pending`/`queue` identical after ESC + BACK |
| HUD bounding box + font floor are not empty-array green | **FAIL (HUD)**, **PASS-with-a-caveat (font)** | `F2`, `F4` |
| resize object count is not too loose | **PARTIAL** | `F6`: it counts Texts, ±3, and only two compact viewports |
| no-raw / no-OFFLINE use real provenance | **FAIL (OFFLINE)**, **PASS (no-raw)** | `F3`, `F5` |
| LLM footer with a real screenshot | **PASS** | `shots/p3-07-llm-footer.png` exists in both runs; footer text asserted |
| exact coverage wording | **corrected below** | `F5`, §4 |
| old 27-round failures | harness, not product — consistent with the logs; I do not brand them | §5 |

## 2. Findings

### F1 (high — a real assertion is vacuous, and an earlier real assertion was deleted)

`buttons()` maps the handle's flags as `disabled: !!b.disabled` (`spec:193`), but the product handle
exposes **`enabled`** and has no `disabled` field (`src/ui/menuKit.ts:81-93`, `enabled: true`; state
changes go through `setDisabled` → `handle.enabled = !disabled`, `menuKit.ts:130-136`). So the mapper
always reports `disabled: false`.

Consequences:

1. `spec:334` `expect(… 'CONFIRM (HUMAN)').disabled).toBe(false)` — "CONFIRM is enabled while a
   proposal is ready" — **can never fail**. It is listed as coverage in the report ("Ready copy +
   CONFIRM enabled").
2. `run29` contained the real check and it was **removed, not fixed**:
   `expect(queuedButtons.find(b => b.label === label)?.disabled, '${label} is disabled while pending').toBe(true)`
   (see `reports/…/p3/run29/source-snapshot/tests/gameplay-03-feedback.spec.ts:345-346`, whose run
   failed with exactly `Error: CONFIRM (HUMAN) is disabled while pending`). The product *does* disable
   both buttons while pending (`src/scenes/PauseScene.ts:761-763`, `canConfirm = proposal && echo &&
   ownerHuman && !pending`), so the correct repair was `disabled: !b.enabled` (one token) plus a settle
   wait — after which that assertion passes. Today **nothing** asserts the pending-disabled state, while
   the spec title ("WAITING/Queued + disabled") and case list still claim it. My runs' `disabledFlags`
   (`CONFIRM (HUMAN): false`, `REJECT: false` while pending) is an artefact of the same bug and must not
   be read as product evidence.
3. Fix: `spec:193` → `disabled: !b.enabled`; then restore the pending assertion at `spec:344` with a
   settle wait (`waitForFunction(() => !handle.enabled)` via the same UI read), and keep `spec:334`.

### F2 (high — empty-array green, exactly the pattern I was asked to look for)

Test 5's HUD check (`spec:451-464`) walks `GameScene` Text objects and asserts none lies outside the
camera frame. But the pause overlay **hides the HUD** (`src/scenes/PauseScene.ts:172-175`,
`setHudVisible(false)` on open), and the walk filters `c.visible !== false` — so the list is empty:
`hud.texts = 0`, `outside = []`, assertion unreachable. Measured in both runs:
`p3-echo-detail.json → hud.texts: 0, outside: []`. The report line "every HUD text inside the camera
frame (asserted, not just recorded)" is therefore not supportable. Fix: sample while the HUD is visible
(e.g. after `resumeGame`, read the HUD before re-opening pause), or read bounds regardless of
`visible` and assert `texts.length > 0` first.

### F3 (medium — "no fake OFFLINE" has no real source *and* the wrong page)

`spec:481-491` derives `source` from `world.signalView().aiSource / .modelState`. Neither key exists:
`World.signalView()` (`src/world/World.ts:551-567`) returns device/relay/energy/cooldown/evidence/exit
only, and `grep -rn "aiSource|modelState" src/` finds nothing. Both runs recorded
`source: {source: null, model: null}`, so the guard `if (source.model !== 'offline' && …)` is always
true — dead provenance. On top of that, `OFFLINE` is only rendered on the **LLM page**
(`src/scenes/PauseScene.ts:875`, `FALLBACK:NO_MODEL → "MODEL  OFFLINE"`), while test 6 inspects the
**local-coop** body, which cannot contain it. Real provenance for that claim is the companion link
status (or the LLM page text itself). As written, the case cannot catch a fake OFFLINE.

### F4 (medium — the font floor is measured in logical px, not the CSS px its message claims)

`tiny` compares `c.style.fontSize` (`spec:277, 411, 449`) — the Phaser logical size — against `< 10`,
while the message says "no text below 10 CSS px" (`spec:463`). At the six tested viewports the effective
CSS floor does clear 10 px, but only because the compact token set kicks in below FIT scale 0.85
(`menuKit.ts:37-53`: SMALL 12 / compact 16; scales 0.625 / 0.8 / 1.0 / 1.0667 / 1.25 / 1.5 →
**10.0 / 12.8 / 12 / 12.8 / 15 / 18 CSS px**). Below ~0.625 (e.g. 640×480) the same assertion would pass
at 8 CSS px. Fix the wording ("≥10 logical px; ≥10 CSS px at the six covered viewports") or scale by the
canvas factor before comparing.

### F5 (medium — coverage wording; the body is accurate, the name is not)

- Test 1's name says "default / pending / **result** states" (`spec:268`). The rows are 6 × default plus
  pending at **800 and 1920 only** (`spec:304-320`); there is **no result/Done phase anywhere** in the 7
  cases. The report table is accurate; the spec name (and any "six viewports × all states" phrasing) is
  not. Rename to "six viewports × default; pending at 800/1920; no Done state".
- "no raw ids" is asserted for the coop page only (`spec:279-281`); the audit and echo pages check
  `undefined|NaN` only. Say so.
- The report's "10 px font floor" should state logical vs CSS per `F4`.

### F6 (low — resize check is a Text count with a wide tolerance)

`spec:488-489` allows ±3 on `allTexts(page).length`, i.e. the number of **Text** objects on the page,
not "page objects"; the resize loop only visits 1024 and 1366 (both compact, so no token flip/rebuild is
exercised). Counts were 11/11/11 in both runs, so the case is green and the claim "stable" is true — but
the tolerance and the wording should say "texts, ±3, compact→compact".

### F7 (low — test 3 has no page assertion; the Enter sweep ends on a toggle)

Test 3 never asserts which page is open while it presses arrows. It passes because the page stayed open
(evidence `focusOrder: RECENT ACTIONS / BACK / LOW-RISK COOPERATION: OFF` ×3), i.e. exactly the scenario
that would otherwise be a false green. Add `expect(await pausePage(page)).toBe('local-coop')` before and
after the sweep. Also the final `Enter` lands on the enabled LOW-RISK toggle, so "Enter cannot add a
second command" is proven by *unreachability* of the disabled CONFIRM (product nav skips `!enabled`,
`menuKit.ts:246-272`) rather than by hitting it — acceptable, but state it that way.

### F8 (info — the audit fixture is honest, and the cap is genuinely exercised)

10 injected entries are labelled in the comment and in `rec3` (`fixture: 'layout: 10 injected audit
entries'`), the cap is real (`src/scenes/PauseScene.ts:693` `recent(8)`; `numbered: 8` with 11 entries),
and the behavioural assertions (`pending`/`queue` unchanged) use only real state. Only nit: `≤ 8` plus
`> 0` does not prove the **newest** 8 are shown.

### F9 (info — the two load-bearing claims that *are* verified, keep them)

- Keyboard: product nav skips disabled items (`menuKit.ts:246-272`) and the evidence shows focus cycling
  exactly the three enabled controls, so "CONFIRM/REJECT never take focus while pending" is a real
  assertion, not an empty list.
- Auditor page ordering and the ≤8 window are real (`numbered: 8` > 0, ESC/BACK round trip recorded).

## 3. Two specific claims I verified rather than accepted

### 3.1 Camera-aware click is a real click, not a bypass

`clickLogical` (`spec:68-72`) calls `page.mouse.click(box.x + fx*box.w, box.y + fy*box.h)` with
`box = canvas.getBoundingClientRect()` — so letterboxing (e.g. 1024×768, 4:3 in a 16:9 canvas) is handled
correctly, and `clickLabel` converts world → camera via `(c.x - cam.scrollX) / (cam.width / cam.zoom)`
(`spec:102-107`). PauseScene/MainMenuScene use the default camera at `GAME.WINDOW_W/H = 1280×720`
(`src/config/game.ts:3-4`; the spec's header comment "overlay 960×540" is stale but the code does not
depend on it). Every `clickLabel` also asserts the label exists and the caller asserts the resulting page
id, so a mis-aimed click fails loudly. **PASS** — with one gap: the second `CONFIRM` click in test 2
(`spec:344`) is followed only by queue/pending equality, so a click that missed would be
indistinguishable from a disabled control. After `F1` is fixed, assert the handle state there too.

### 3.2 "Page didn't navigate away, so no buttons, so green" — checked and not the case here

The risk scenario (confirm click navigates → `uiButtons` empty → focus list empty → assertion trivially
true) is excluded for this run by the evidence: `focusOrder` contains three real coop-page labels and
repeats cyclically, and `queue`/`pending` are identical before/after. So the case is meaningful **for
these bytes**, but it is not *guarded* by the spec (`F7`).

## 4. Exact coverage wording that the evidence supports

Use this instead of the current title/report phrasing:

- **default state:** 6 viewports — 800×600, 1024×768, 1280×720, 1366×768, 1600×900, 1920×1080 — labels,
  font floor (≥10 logical px; ≥10 CSS px at these six), no raw ids/ticks/hex, no overlapping interactive
  rects.
- **pending state:** **only 800×600 and 1920×1080** — WAITING/QUEUED copy, font floor, overlap.
- **result / Done state:** **not covered at any viewport.**
- **HUD inside the frame:** **not covered** (0 HUD texts sampled while the overlay hides the HUD).
- **pending-disabled:** **not asserted** (see `F1`); keyboard non-focusability *is* asserted.
- **no fake OFFLINE:** asserts the local-coop page never says OFFLINE; the "while the model is not
  offline" condition is dead (`F3`).
- resize/reopen: Text count 11 → 11 → 11 (±3), 1024/1366 only.
- audit: ≤8 window real, exercised with 10 labelled injected entries; 8 newest not asserted.

## 5. On the "27 rounds were harness, not product" framing

What the artefacts actually show: `run28` failed 3× with `page.waitForFunction` timeouts, `run29` failed
1× with the `disabled while pending` assertion (caused by `F1`'s wrong field, and/or by reading before
the page refresh settled), `run30` is 7/7. The three harness repairs the report lists (real
ENABLE + settle before proposing, camera-aware click mapping, idempotent overlay navigation with page
waits instead of fixed sleeps) are exactly the classes of defect those logs point at. Note also that
`run1`'s P2 spec already had `enableEchoAndSettle`, so "missing ENABLE" is not a universal explanation
for every earlier round.

I therefore state: **no evidence in run28/29/30 or in my independent run points to a product defect**, and
the reproducible 7/7 on a fresh tree and a different port is not a load flake. I do **not** claim that all
27 earlier failures were load flakes, and I did not re-run those rounds.

## 6. Recommendation

- **PASS** on the substance: the gates the P3 acceptance actually needs (real ENABLE → real proposal →
  Ready → real CONFIRM → queue = 1 with the same proposalId → real resume → applied → audit window →
  ESC/BACK round trip) are driven through the real UI and reproduce on a second tree.
- **Before archiving the wording**, fix or record: `F1` (one token `disabled: !b.enabled`, then restore
  the pending-disabled assertion — re-running the spec afterwards changes its hash, so it is the Lead's
  call whether to archive `7aecf216` as-is with this gap documented, or fix + re-run; cost is ~1.3 min),
  `F2` (do not claim the HUD is asserted; either cover it with the HUD visible or move it to "not
  covered"), `F3` (drop the dead provenance or point it at the companion-link / LLM-page status and the
  LLM page), `F4`/`F5` wording, `F7` page assertion.
- Keep as explicitly not covered: human-pending / pointer-edge interactions, the Done/result state at any
  viewport, pending at the other four viewports.

## 7. Not verified here

- P3 product source (already accepted at `7007ce2`), full suite, whole-tree typecheck (I only read the
  tester's typecheck log: 0 `error TS`), P2/ui-menu suites, any model chain.
- The 27 earlier rounds were not re-run; `run1`'s P2 spec was only spot-read.
- Anything after `7007ce2` + `7aecf216`: this review is pinned to those bytes. My own tree, port 5494,
  own evidence/shot dirs; I wrote no file under `src/`, `tests/` or `config/`.

---

# §8 增量复核 — run31 / spec `3544ee6e…`（F1–F8 修复）

> 本节在 §0–§7（旧 `7aecf216`）之上**追加**；原 F1–F8 的失败记录原样保留，不删不改。
> 上一节只对 `7aecf216` 有效，本节只对 `3544ee6e…` + `7007ce2` 有效。
> 范围：P3 测试增量复核。不代替 P4；未碰 tester 5492/5199 及其 clone，未热读 P4 正在改的树；
> 无模型、无 `src/`/`tests/`/`config/` 改动、未 commit/push。

## 8.0 固定输入与我自己的整条重跑

| 项 | 值 |
|---|---|
| 受审 spec | `tester/p3/run31/source-snapshot/tests-spec.ts`（与 `tester/p3/spec-src/gameplay-03-feedback.spec.ts` `diff -q` 完全一致） |
| sha256 | **`3544ee6e1b196c85da9cd62b8b0abac00a54e0638bdcf481faa98615a91bd180`**，与 Lead 给的一致；`run31/source-snapshot/HASHES.txt` 的 before/after/spec_src 三字段自洽 |
| 产品字节 | 五源与我自建 `git archive 7007ce2` 逐一相同：GameScene `11af2186…`、PauseScene `ed3a1078…`、menuKit `3fd12585…`、feedback `7c1e9bd9…`、feedback.test `717e87e6…` |
| 我的工作树 | `D:\tmp\gp01-p3r`（7007ce2 全量 + 本节 spec），自有端口 **5494**，`src/` 未改 |
| 我的整条重跑 | `PORT=5494 … npx playwright test tests/gameplay-03-feedback.spec.ts --workers=1 --reporter=line` → **7 passed (1.3m), PLAYWRIGHT_EXIT=0** |
| 我的 typecheck | `npx tsc --noEmit` → **TSC_EXIT=0，0 个 `error TS`** |
| 我的日志 | `D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p3-run31-spec-run.log`；`…\reviewer\p3-run31-typecheck.log` |
| 我的证据 / 实图 | `…\reviewer\p3-run31\evidence\p3-*.json`（15 份）；`…\reviewer\p3-run31\shots\`（7 张） |
| HUD 字号真值探针（非 spec 运行） | `node probe-hud.mjs`（800×600，真实 DEMO 01）→ `…\reviewer\p3-run31-hud-probe.log` |

### Gate 表（命令 → PASS/FAIL → 绝对日志）

| gate | 命令 | 结果 | 日志（绝对路径） |
|---|---|---|---|
| P3 7 条（我独立重跑） | `PORT=5494 npx playwright test tests/gameplay-03-feedback.spec.ts --workers=1 --reporter=line` | **PASS 7/7 (1.3m)** exit 0 | `D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p3-run31-spec-run.log` |
| typecheck（我独立重跑） | `npx tsc --noEmit` | **PASS** exit 0 / 0 `error TS` | `D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p3-run31-typecheck.log` |
| P3 7 条（tester run31） | 同命令，PORT=5492 | PASS 7/7 (1.3m) | `D:\Project\LAST_SIGNAL\reports\gameplay-01\tester\p3\run31\logs\p3-ui.log` |
| typecheck（tester run31） | 归档声称 `tsc --noEmit exit 0` | **证据 FAIL**：`run31\logs\typecheck.log` 是 **0 字节**，`HASHES.txt` 的 `typecheck=` 一行无日志支撑 | 同上目录 |

两棵树、两个端口、同一 spec、同一五源：7/7 与 typecheck 0 均可复现。tester 的 typecheck 是“声称”而非“记录”，
我自己补跑证明门禁成立，但归档不能用空日志承载它（见 G2）。

## 8.1 逐条复核（F1→F8）

| 原发现 | 修复证据（我的重跑） | 判定 |
|---|---|---|
| **F1** `disabled` 假字段 / pending 未断言 | `buttons()` 改为 `enabled: !!b.enabled` + `disabled: !b.enabled`，并加 `waitButtonEnabled()` 绑定真 handle；`p3-ready-before-confirm.json` CONFIRM `enabled:true`；`p3-queued-after-confirm.json` settled 的 CONFIRM/REJECT 均 `{enabled:false, disabled:true}`，二次点击后仍 `enabled:false`，`queue:['signal-scan']` | **FIXED** |
| **F2** HUD 空数组假绿 | `hudSample()` 在 `PauseScene` 不活跃、`GameScene` 活跃时采样；断言 `texts.length>0`、`txtSignal/txtEcho` visible 且有正文、`outsideCss==[]`；开 echo 页后断言 `txtSignal.visible===false`（暂停隐藏，不再读空表）。实测 sample=20、`pausedHud.signalVisible:false` | **FIXED**（除字号换算，见 G1） |
| **F3** 虚构 `signalView.aiSource` + 盯错页 | 不再读虚构字段；改用真实 `GameScene.companionStatus` getter（`GameScene.ts:1193`，返回 `'OFF'`）。coop 页无条件断“永不说 OFFLINE”，LLM 页按真实状态分支断言（`p3-llm-footer.json` `companionStatus:'OFF'`，正文无 COMPANION CONNECTED） | **FIXED** |
| **F4** 字号量逻辑 px | `allTexts()` 现算 `css = logical × cssScale` 并逐行记录，每条 viewport 先断 `sample>0`；六视口 scale=0.625/0.8/1.0/1.067/1.25/1.5，`tiny:[]`×8（默认 6 + pending 2） | **FIXED**（菜单面正确；HUD 面见 G1） |
| **F5** 覆盖口径 | 测试名改为 “six viewports × default state; pending at 800/1920; **no Done state covered**”；Done 只在 test 2 以 1280 捕获（`p3-done-receipt.json`：page `local-coop`，receipt 绑定原 pid，正文无 WAITING） | **FIXED** |
| **F6** resize 只数 Text / ±3 | `countAt()` 递归数全显示列表对象；序列 1280→800→1920→1280 + 重开；我的重跑 **17 / 17 / 17 / 17**，重开 **17**，按钮 5，标签唯一 | **FIXED** |
| **F7** test 3 无页面护栏 | 扫键前与每轮都断 `currentPage==='local-coop'` 且按钮非空；我的重跑 rounds 全为 `local-coop`，`lastFocused:['BACK']`，`afterEnterPage:'echo'`（Enter 只做真实导航，用允许集合断言），queue/pending 前后一致，导航后 pending id 未变 | **FIXED** |
| **F8** ≤8 不证明“最新 8 条” | 布局 fixture 保留并标注；新增 `recent(8) == recent(32).slice(-8)` + `toContain(209)` + `not.toContain(200)` + `numbered === newest.length`。我的重跑：stack ticks `[85,200…209]`（85 为真实一条），窗口 `[202…209]`，页面 numbered=8 | **FIXED** |

原 §2 的 F1–F8 在 `3544ee6e` 上全部落地，且不是“改断言迁就实现”：F1 恢复了 run29 被删的真断言（并绑真 handle + settle 等待），
F2 改成“先证明非空、再证明在框内”，F4 换成 CSS px，F6 收紧到精确相等。

## 8.2 新增发现

### G1（MAJOR — 记录/结论错，非产品错）HUD “8–8.5 CSS px” 是换算 bug，真实 10.0–10.6

`hudSample()` 用 `cssScale = cam.zoom × (rect.width / cam.width)`，把相机 zoom 又乘了一次。
但 GameScene 的 HUD 是**反向缩放**的：`lockHud()` 每帧把每个 HUD 元素 `scaleX/scaleY = 1/zoom`、位置用
`cam.getWorldPoint(screenX, screenY)` 重钉在屏幕上（`src/scenes/GameScene.ts:447-455`，`update()` 每帧调用，
见 `GameScene.ts:581`；父提交 `0083e20` 同一段代码同注释，**非本轮引入**）。渲染尺寸因此是
`fontSize × (1/zoom) × zoom = fontSize`（游戏像素），真实 CSS = `fontSize × canvasScale`，zoom 已被约掉。

**直接实测（决定性，非 spec 运行）**——我在 800×600 真机启动 DEMO 01 后直接读对象，日志
`D:\Project\LAST_SIGNAL\reports\gameplay-01\reviewer\p3-run31-hud-probe.log`（脚本 `…\reviewer\p3-hud-probe.mjs`）：

| 对象 | fontSize | scaleX/scaleY | boundsH | 渲染游戏像素 | 真实 CSS |
|---|---|---|---|---|---|
| txtSignal | 17 | **1.25** | 21.25 | 17 | **10.625** |
| txtEcho | 17 | **1.25** | 21.25 | 17 | **10.625** |
| txtSignalDetail | 17 | **1.25** | 21.25 | 17 | **10.625** |
| txtVitals | 16 | **1.25** | 20.00 | 16 | **10.00** |

`zoom=0.8`、`canvas=800×450`、`canvasScale=0.625`。`scaleX=1/zoom=1.25` 把 zoom 完全约掉，
故 CSS = `fontSize × 0.625`。同一结论也能从 run31 记录反推：`h = b.height × zoom` 对 17px 行给出 **17.0**、
对 16px 行给出 **16.0**；若没有反向缩放应记 13.6 / 12.8。

800×600 的真实值：

| 行 | 逻辑 px | run31 记录（错） | 真实 CSS（canvas 0.625） |
|---|---|---|---|
| 16px 行（VITALS / XP / 计时 / 房间 / 统计 / help / objective） | 16 | 8.0 | **10.0** |
| 17px 行（HP / CREDITS / LV / 武器 / 敌数 / CONTROL / AI ACTION / AI TARGET / link / **txtEcho** / **txtSignal** / **txtSignalDetail**） | 17 | 8.5 | **10.6** |

1280×720（canvas 1.0）：真实 **16.0 / 17.0**，run31 记 13.6。1024×768（0.8）：12.8 / 13.6。1920×1080（1.5）：24 / 25.5。
**没有任何受测视口低于 10。**

按对象定位（我重跑记录里的 `pick` 与实际文本）：

| HUD 对象 | 渲染文本 | 来源 | 是否 P3 改 | 800 真实 CSS |
|---|---|---|---|---|
| `txtSignal` | `RELAY ACTIVE · EXIT OPEN` | `ui/feedback.ts:209 hudSignalLine()` | **是** | 10.6 |
| `txtSignalDetail` | `T SCAN · Y JAM · R TOGGLE · LINK ON` | `ui/feedback.ts:215 hudDetailLines()` | **是**（长块暗色改为两行短句 + 提亮 `#5a7480→#8fb8c8`） | 10.6 |
| `txtEcho` | `ECHO 94/100 · FOLLOW · ASSIST SAFE` | 既有 `refreshEchoHud` | 否（父子同码） | 10.6 |
| `txtObjective` | `CLEAR THE LINKED SENTRY · T SCAN · Y JAM` | P1 目标行 | 否 | 10.0 |
| 其余 16 条（VITALS/HP/XP/CREDITS/LV/计时/武器/房间/敌数/SURVEY/KILLS/CONTROL/AI ACTION/AI TARGET/DEMO 行/ESC 行） | — | 既有美术行 | 否 | 10.0 / 10.6 |

**分类结论：**

1. “部分游戏 HUD 文字 8–8.5 CSS” **不成立**：是测试侧公式把 zoom 重复乘了 0.8×。真实为 16/17 逻辑 px，
   800×600 是 **10.0/10.6 CSS**，已到菜单面的 10px 下限。
2. 因此**不构成 P3 文字过小的 MAJOR 待修产品项**；P3 新增反馈行与既有行同尺寸，且 detail 行由“长块 + 暗色”
   改为“两行短句 + 更亮”，可读性是升。
3. 但**记录与报告句子必须改**：`run31/evidence/p3-hud-live-800.json` 的 `tinyCss` 与 `P3_TEST_REPORT.md:36`
   的 “at 800×600 the HUD sits at 8–8.5 CSS px … excluded from the menu floor claim” 会被下游当产品事实。
4. 风险：这套错公式目前**碰巧安全**——只在 1280 断言 `>=10`（错公式仍给 13.6）。一旦把 800 纳入 HUD 下限，
   错公式会把 10.6 报成 8.5 → 误判产品缺陷，或被迫放宽 `>=10`（正是禁止项）。

修法（择一；两者都改 hash，需再跑 ~1.3min）：

- **(G1-a) 改公式**：`css = logical × (rect.width / cam.width)`（zoom 只用于 `sx/sy` 屏幕矩形），并把 800 的 HUD
  也纳入 `>=10` 断言；报告删掉 “8–8.5 / game art scale 例外” 整段。
- **(G1-b) 只改口径**：保留代码，把 `tinyCss` 加注“按菜单公式计算、未约掉游戏相机 zoom 0.8，真实 10.0–10.6 CSS”，
  报告同步；等价于“8–8.5 只是该公式输出，不是实测字号”。

建议 G1-a（1 行 + 1 条断言），让归档证据与结论一致，800 的 HUD 下限也变成真的。

### G2（LOW — 门禁证据缺失）

`run31/logs/typecheck.log` 为 0 字节，而 `HASHES.txt` 写 `typecheck=tsc --noEmit exit 0`。我已独立补跑
（`…\reviewer\p3-run31-typecheck.log`，TSC_EXIT=0 / 0 error）：**门禁本身成立**，归档需换真日志或去掉该行声称。

### G3（LOW — 半自指比较）

test 4 的“最新 8 条”用 `recent(8)` 对比 `recent(32).slice(-8)`，同出 API；有信息量的是 `numbered === newest.length`、
`toContain(209)`、`not.toContain(200)` 与页面 `#N` 计数。措辞应写成“窗口=栈尾 8 条 + 页面渲染 8 条 + 首尾 tick 校验”。

### G4（INFO — 确认非问题的两处）

- HUD `inFrame` 用 `cam.worldView` **正确**：HUD 不是 `scrollFactor(0)`，而是每帧用 `getWorldPoint` 重钉在世界坐标（`lockHud`），bounds 即世界坐标。
- test 1 菜单面换算（zoom=1）正确：800 视口 16×0.625=10.0，与 `tiny:[]` 自洽。

## 8.3 可提交判定与必要产品补修

**判定：这版 spec 可以提交（替换 `7aecf216` 的空转版），但 G1 必须在文案/证据层落地。**

- 原 F1–F8 的“空转 / 假绿 / 死字段 / 口径错”在 `3544ee6e` 上全部消除；我独立整条重跑 7/7、typecheck 0 均可复现；
  断言方向都是“先证明真实存在，再证明属性”，未再出现“空列表=绿”。
- 唯一实质问题在记录侧 G1：不是断言错（断言只在 1280，结论仍真），而是 HUD 字号换算低估 0.8×，导致
  `p3-hud-live-800.json`、`P3_TEST_REPORT.md:36` 与“新增发现”的 8/8.5 是错的。
- **必要产品补修：无**（HUD 真实 10.0/10.6 CSS ≥10；F1–F8 全在测试侧）。若要让 800 的 HUD 更宽裕属新需求，不是本轮缺陷。
- 保持未测：human pending / 指针边缘；Done 仅 1280；pending 仅 800/1920。

若选 G1-a（改公式 + 800 断言 + 删例外段落），结果是**新 hash**，需 tester 用同一 workdir 重跑并把 `run32` 归档；
若只做 G1-b（口径修正），归档 `3544ee6e` 原字节即可，但报告须写明 8/8.5 是该公式输出、真值 10.0–10.6。

## 8.4 本轮未验证

- P3 产品逻辑（已接受 `7007ce2`）；全量套件；P2/ui-menu；P4 任何东西；模型链。
- tester 的 7 份 `p3-targeted*.log` 仅作过程记录，未当门禁。
- 除我的 5494 重跑外没有第二次整条运行；`run31/shots` 与我的 `p3-run31/shots` 各 7 张，未逐像素比对。
