# Signal 场景2 口径更正与补充（patch-notes，独立探针 probe-patch-notes.mts）

## 口径更正（按 Lead 指示，不改源码，只读 c1cc2dd 冻结）

原报告中「AI/External按Signal键安全接管」表述过强。独立复测确认：

| 检查 | 结论 | 证据 |
|---|---|---|
| PN04 owner=ai 时 Q 按压 | **不触发信号（忽略/只读）**，energy 100→100 | `04-patch-notes.log` PN04 |
| PN05 owner→human 恢复后 Q | **再次触发信号**，energy 100→97（扫描扣费+再生） | `04-patch-notes.log` PN05 |
| PN03 普通 NEW RUN 武器 | **仅 pulse 一把**（weapon count=1），无实际换枪冲突 | `04-patch-notes.log` PN03 |
| PN02 普通 NEW RUN relay | **自动装载** deviceId `relay_main`（首次房间进入即生成），**非显式 opt-in** | `04-patch-notes.log` PN02 |

**更正后表述：** AI/External 对 Signal 键（Q/E/R 中的 Q/E 扫描/干扰）是 **“忽略/只读，不接管、不发射”**；`toggleAiControl()` 把 owner 改回 `human` 后，信号权限**真实可逆地重新生效**。不应表述为“安全接管”。

## 代码级观察（Q/E 与 switchWeapon 双绑定）

- `keydown-Q/E` 同时绑定 `switchWeapon(-1/1)`（`src/scenes/GameScene.ts` keydown 注册）与 `update` 期 `Q.isDown/E.isDown` → `playerSignalScan/Jam`（`src/scenes/GameScene.ts` 第 416-420 行）。
- 普通运行仅 1 把武器，`switchWeapon` 因 `owned.length <= 1` 提前返回（无实际换枪），信号正常消耗。
- **若给第二把武器（如已解锁 scatter），Q/E 会“一按同时换枪 + 耗 Signal/Jam”**，为真实的代码级交互。建议后续在 Owner fixture（第二把武器）下完整覆盖；本阶段未作为阻塞项，因普通 NEW RUN 不触发。

## 独立结论（c1cc2dd 当前状态，阶段状态，非最终 P3/P4）

- AI/External 不接管 Signal 发射权（只读忽略）；owner→human 可逆且恢复后信号重新生效。
- 普通 NEW RUN 自动装 relay（无 opt-in）且仅 1 把武器（无 Q/E 换枪冲突）。
- 与 2 把武器时的 Q/E 双触发为代码级已验证交互，非普通运行表现。
- 以上不改变原报告 `SIGNAL-SCENE2-FINAL.md` PASS 结论。

## 路径

`reports/ai-native-02/tester/signal-scene2-final/patch-notes.md`
`04-patch-notes.log` / `03-patch-notes.json` / `probe-patch-notes.mts`
