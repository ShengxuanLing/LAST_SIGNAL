# AI-NATIVE-02 开发接续（2026-11-15）

原Orca developer会话6cdc9450-a93f-4064-b963-34bbee5d79cc因输入超过1048576 tokens停止，保留不删除。新接续者唯一源码写者；Reviewer/Tester只读冻结提交，无冲突写入。用户已授权随时创建Worker、修改源码、功能分支/PR；禁止合并main。

## 当前精确状态

目录D:/Project/LAST_SIGNAL；功能分支feat/ai-native-world-integration；HEAD c1cc2dd8714ff953e75be70dc3d68349506d50d9。origin/main此时ahead61/behind10（上游期间已变），本单不要rebase/merge/切分支。启动基线是origin/main 860a0dd，非原额外美术分支。

恢复读数见worker-recovery-state.log：未提交修改src/scenes/GameScene.ts、src/signal/signalTuning.ts、src/world/World.ts、src/world/sim/signalState.ts；未跟踪src/world/sim/signalCombat.test.ts；大量reports未跟踪为真实证据，不能清理/覆盖。stash@{0}/@{1}历史保留，禁止读取恢复。不要把现有WIP删掉，先git diff读清。

## 已交付并独立通过（不要重做协议/核心）

- 正式World Human/本地AI/External Player合法PlayerIntent同路径，控制权/暂停/存档，五视口HUD。
- src/world/sim/core.ts为共享权威核心；Rendered/Headless有同规则真实drone/pulse战斗、固定tick/RNG、独立权限MCP、snapshot/replay/分页/ref/Owner文件ACL/路径/大小/envelope预算。Legacy敌人FSM仍Rendered adapter，未承诺全WorldHeadless；不能复制另一套World。
- 正式ECHO独立Actor、HP/位置/伤害/观察/有限memory，fallback与确认前不开火；legacy各敌人/Boss能选echo；restore清旧assist/建议；core-managed actor跨端字节parity。
- Companion官方MCP只有echo_observe/suggest/status/memory，没有Agent confirm；独立Owner pairing key与session capability，Agent只有独立token，伪Origin/自重授权/假观察/模式翻转/自confirm均拒；OwnerCap不进URL，Pause首观察立即发布、1s真实renderer heartbeat/独立Agentlease；同core tick确认。不要回退这些安全边界。
- Lead已真实模型实跑并独立审：reports/ai-native-02/reviewer/lead-live/（Rendered Player单drone）、reviewer/lead-headless-cropped/（权限修复后Headless单drone）、reviewer/lead-echo-model-live/（两轮模型ECHO建议+OwnerUI自动夹具确认，drone24→6→死，player100/echo94）。Owner自动确认不是真人；非完整Run/Signal。
- Signal共享src/signal/*由旧slice真实调用，参数/语义双跑一致；B核心signalState可选设备/独立player-echo energy/scan/jam/relay/toggle事件，默认无Signal时旧core hash不变。v2 schema定义已有，但官方工具通道仍未真正接完。

## 当前任务：Task C 正式Relay协作，未完成

目标真实可玩场景：游戏内显式入口启Signal协作（普通NEW RUN不应自动门控）；一处真实room Relay实体，scan发现→模型建议→Owner确认→echo合法操作消耗能量→Relay ACTIVE出口通行→人类推进→观察与memory更新。jam抑制发射但保留manual/power，到期依原规则恢复，不等于开启。Rendered/Headless同一signal rules。

HEAD阶段已做Signal HUD/设备与门控，但有待查兼容缺口：

1. Q/E仍旧换枪，同时Signal轮询Q/E，双武器会同时换枪+耗能；须保持旧Q/E换枪，改Signal独立按钮/未占用键。Root早先数字键57阶段反馈已被c1 release-latch修过，不要重复修旧长按问题；暂停持键恢复须新release/press。人工Signal操作应先reclaim再合法提交，表单/暂停不能触发。
2. c1默认首次进任何room自动spawn Relay；原批准是显式Signal协作场景，普通run无Signal保持旧行为。补实际可操作入口/flag并存档，不能只测signalExitOpen(undefined)称默认兼容。
3. HUD scanCooldown/jamCooldown实际读echo但不能标player；tick显示t或正确换秒，五视口不得遮挡，真实device sprite/目标线需证据。
4. 官方Rendered/Headless Player MCP面尚未注册真正v2 scan/jam。v1 world_action严格拒新动作，不能声称schema定义=工具接好。保持v1旧语义，显式v2 actor/capabilities协商，Player不能冒充echo/Owner；Companion scan/jam/toggle只有Owner确认才执行。
5. 需完成真实Headless Signal Combat批测、Render↔Headless带echoSignal同snapshot/orderedactorintents/ticks全canonical/events字节parity，含scan扣费/证据TTL、jam到期、toggle门控/转场。
6. 现有674单测+17旧CompanionE2E不能证明新Signal玩法；新增专用core/SDK/E2E/五视口证据。最终完整回归再P5联合演示。

最新Reviewer/Tester正独立审c1cc2dd（signal-scene2），结果会经Lead转发，不读取其会话。Tester报告在tester/signal-scene2-final/已阶段通过，但真实Player v2工具未接、Q在AI时只是忽略不是reclaim。Root已发送上列输入/默认run/HUD纠正；原Worker在执行后触发长度错误。

## 边界与验证

每 changed line对应目标，源码单写，不改无关美术/平衡。不系统键鼠，不LLM每帧，不脚本冒充LLM；旧slice/存档SAVE_VERSION/key/finishRun死亡新R0保持；无flush/同步core旁路、暂停不推进tick。

所有gate完整输出写reports/ai-native-02/continuation/或signal-world/C/专属日志；对话只一行PASS/FAIL+命令+结果+日志路径，失败加最相关错误。新增测试先复现再修，不删原断言/任意放宽超时追绿。合适typecheck/unit/build/build:test/MCP/default兼容/旧slice/Owner攻链/P3a/C2/C3bC3c与五视口，最终full E2E。已知vs01精确坐标和随机死亡fixture时序flaky需保留记录，不能重复跑到绿后掩盖。

分最小commit汇报精确hash、changed files/实现/测试/连续截图/日志/限制。不能仅写计划/报告算完成；不要再次问是否继续，用户已授权。不得merge main/push/stash/rewrite history；不清reports或旧Worker。任务未独立验收前不标AI-NATIVE02整体PASS。
