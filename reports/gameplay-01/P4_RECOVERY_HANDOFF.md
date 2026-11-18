# GAMEPLAY-01 P4 开发会话恢复交接

2026-11-18。Developer 原会话因供应商返回 `input token limit is 1048576` 异常结束，未提交改动仍在。保留该会话与所有文件，不反复重试超限请求。恢复方式待所有者选择；测试与独立 Reviewer 仍各自继续。

## 已知基线

仓库 `D:/Project/LAST_SIGNAL`，分支 `feat/gameplay-01-ai-cooperation`，HEAD `1a6306fdaa41cde05d0505affd38969852015d9b`。P3 展示源已提交 `7007ce2`；P2 v3 源 `87a0fac`；当前 P2 测试 `9b5900aa…` 已随 `1a6306f` 提交。主仓不是 `main @0faf95c`，原 Developer 的该说法已纠正。

共享未提交 P4 输入仅四源：World、worldHeadless、p1Scenario、relay。其来源仍未核实，provenance patch 只能证明保存的字节，不能证明作者或正确性。不要覆盖、reset 或清理。已有独立预审固定这些字节：config `d6dd9a48…`、World `84eac073…`、headless `2ad18443…`、relay `6fc7ba40…`。恢复开发应从独立 archive/clone `1a6306f` 加显式四文件待审 patch 开始，记录实际 cwd、HEAD、hash；不得把无效草稿树结果当正式证据。

## 必须先修

详见 [P4_PRE_REVIEW.md](reviewer/P4_PRE_REVIEW.md)。

- M1：Headless 以存活 drone 数自行判断 cleared，正式 World/core 读 room.cleared，五 seed 已分叉。统一权威清房状态，考虑 spawned/pendingRoomEnters；只读 routeState 不能自行创造通关。
- M2：作者 demo/路线身份在正式 Headless snapshot/fromSimulationState/replay 中保留，恢复不能静默 routeState=null；P2 单 pending、未知来源 restored marker 与 exact queue 不回归。
- M3：无可走布局/设备或双门互异候选时显式失败；不得退回同格设备、重叠敌人或墙内 portal 却报成功。
- M5/M6：起点 ID 在 start 房突变成 combat 前保存；恢复身份一致，说明 demo 与非 demo map hash 差异。
- M7：portal 坐标已是格中心，makePortal 再加半格导致贴图偏移；统一视觉与交互中心。
- 补正式源单测、Headless 真实 runSteps 输入链、三 seed 通关、HumanOnly/HumanEcho 对照事件和度量；目前均未验收。

## 已批准的产品选择

保留门边 Relay，让玩家站门位自然 Jam。Tester 将旧 P1 强制门距大于 Jam 范围的断言改成自然 Jam 的真实费用、portal 消失、F 不换房、到期路线恢复；不得挪回旧缺陷布局或靠瞬移证明可达。Developer 不改 tests/**。

复用正式 DEMO01 入口承载 Demo03 内容，不要求为了名字改冻结 P3 UI。HumanOnly 与 HumanEcho 在 20261117/18/19 都必须有合法解，拒绝或离线不锁通关。先展示单 seed 可玩结果，再完整对照；不预设 ECHO 更优。自动驾驶若读取 canonical 坐标，标为 non-blind；Owner 自动确认是 fixture，不是真人。此轮无新增模型请求。

最小共享 routeTargetFor + buildP1Scenario，不造 LevelRule、第二套模拟或新 MCP 工具。允许必要 sim 状态/内部命令以保持单权威，不改 Owner 安全协议、P2 队列恢复、原超时或断言阈值。复用既有 checkpoint 字段，死亡仍 finishRun→新 R0。

## 交付与保护

当前 P3 新测试 `7aecf216…` 的 7/7 与未过滤 typecheck 已交 Reviewer 独立测试审查；它是固定 P3 树，不能拉 P4。P3 测试尚未本地提交。

P4 交早期真实截图、输入/事件记录、同 seed 两类路线与时间/受伤/能量/Signal/建议接受拒绝失败指标、Headless 对照和恢复测试、最终源码 manifest。所有 gate 在独立 cwd，先后 hash 与源码快照一起归档，保留失败日志；一行命令→PASS/FAIL→绝对日志。禁止共享旧 reports 写入、破坏性清理、push/PR/merge。未经所有者另行许可，仅本地阶段提交。整体 GAMEPLAY 尚未通过；HUMAN ACCEPTANCE PENDING。
