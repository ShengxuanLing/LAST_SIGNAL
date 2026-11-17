# P0 测试修复证据边界

状态：两项测试层修复获独立审查 PASS；不是 P1 全量验收，更不是整个 GAMEPLAY-01 PASS。

冻结文件：

```text
tests/ai-native-world.spec.ts 23f4961dd0cf076ed92bff6b4730e84c4a9e45fa54687a638925ffbd7c7c2d8e
tests/ui-menu-layout.spec.ts 8aa12c9eda2840c8d696afba114288566dbb18f1d4a2c291398efe0e7b549c20
```

Tester 在独立 `c7e03c5` 树保留修前 P3-a 3/3 失败，冻结修复版 3/3 通过；Reviewer 在含 P1 的工作树独立复跑 1/1 通过。UI 证据目录改为允许仓库 reports 下的隔离子目录，拒绝根本身和越界目录，旧默认兼容。

P3-a 尾部仅为伤害归属隔离：既有 Dev/Test seam 清无关敌人与弹丸、合法摆位、真实帧等待残余 i-frame 结束，再观察核心伤害事件。原先真实跟随、驻守、确认前不开火、确认后真击杀断言全部保留且在隔离前完成。该 tick seam 不推进 ECHO 自身运动和计时，所以只能证明本窗口中的受伤对象，不能证明持续攻击、ECHO 移动或计时正确。

日志代次：`p3a-before-fix-1..3` 是旧版本确定失败；`p3a-after-fix-1..3` 是上述冻结字节的通过记录；`p3a-after-fix-4..7` 是早期淘汰中间版（含 preWindow 断言）的失败记录，标为 SUPERSEDED，不应算入冻结版偶发失败。所有旧文件原样保留，没有清理或覆盖。

执行渠道：Orca Worker tester 修复与重复运行；Orca Worker reviewer 只读审查及独立运行。完整结论见 [P0_TEST_FIX_REVIEW.md](../reviewer/P0_TEST_FIX_REVIEW.md)。无真人试玩。
