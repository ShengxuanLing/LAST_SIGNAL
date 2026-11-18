# GAMEPLAY-01 P3 展示阶段

状态：P3 v2 独立复审在其覆盖范围内通过。完整项目验收未完成；HUMAN ACCEPTANCE PENDING。

本阶段改动仅为反馈纯函数及测试、PauseScene、GameScene、menuKit。P2 的 World、Headless、Owner、队列和恢复规则不属于本次提交。默认页呈现动作、观察依据、成本、确认要求和实际结果；排队时说明恢复游戏后执行，禁用确认和拒绝；完成状态只来自实际回执。玩家主动打开的最近动作详情保留 ID、tick、错误码和房间代次，用于追溯。

来源说明不再将本地建议页面笼统写成模型离线。Signal HUD 压缩为两行，深色文字改为可读颜色。精确错误原因仍受真实返回码限制，不将 E_PERMISSION 编造成射程或视线失败。

## 证据

- Lead 对 v2 manifest 的 5 个源和 2 个文档逐字节检查：7/7 一致，见 `developer/p3/v2/lead-freeze-check.log.txt`。
- Orca Worker reviewer 在 archive 0083e20 + v2 白名单的独立快照中通过 8 条反馈单测与 1 条浏览器会话；实测 1280/800、单 pending、审计往返不改状态、ESC、默认页无原始字段及对比度。见 [P3_V2_REVIEW.md](reviewer/P3_V2_REVIEW.md)。旧 [P3_REVIEW.md](reviewer/P3_REVIEW.md) 的失败结论保留，已由 v2 关闭对应问题。
- Orca Worker developer 六视口矩阵通过，最小字号 10 CSS px。8 条审计记录属于布局夹具，不是 8 次实际行为证明；审计在打开时取快照。原始材料见 [v2 manifest](developer/p3/v2/manifest.json)。
- Orca Worker tester 在另一独立 P3 快照通过未过滤 typecheck、8 条反馈单测、7 条适配后的 P2 测试与 25 条菜单测试。新增 7 条 P3 用例经 Reviewer 发现空转断言后修正，run31 再独立复现 7/7；最终 run32 修正 HUD 逆缩放测量，7/7、未过滤 typecheck 退出码 0。最终测试源码 SHA256 为 `d446a7683560236199638b3a15af92204e31ae781a239255221921bc0b3c254c`，归档见 `tester/p3/run32/source-snapshot`。Lead 核对了 run31 到 run32 的测试差异；Reviewer 的独立重跑对应 run31，不能称 run32 再被独立重跑。不能把这些定向结果称为当前完整项目 E2E 通过。
- v1 曾跑过 794 条单测、build、surface；v2 新增 8 条文案单测。v2 未重新跑完整单测、build 或完整 E2E，不将旧数字拼成 v2 全链结果。

## 限制

800 菜单最小字号恰好 10 CSS px；锁屏 HUD 的 16/17 逻辑字号经对象逆缩放和相机缩放抵消后为 10.0/10.625 CSS px，run31 报告的 8–8.5 是测量错误，不是产品缺陷。8 条审计记录较密；最近窗口测试是内部一致性检查和布局夹具，不是八次真实动作。默认页面覆盖六视口，pending 覆盖 800/1920，Done 仅 1280；真实模型在线变体、完整指针边缘与真人理解度未验。HUD 活跃时非空采样与帧交叠检查通过，不将交叠断言夸大为全部文字完全包含的边界证明。P4 的作者场景、路线 Headless 对等和布局仍是后续工作。模型链另在 P2 固定快照中验证，不能当作本阶段模型回归结果。

执行渠道：Orca Worker developer 实现；Orca Worker reviewer 独立复审；Orca Worker tester 在固定快照中测试。仅本地阶段提交，不推送、创建 PR 或合并 main。
