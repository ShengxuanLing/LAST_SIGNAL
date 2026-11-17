# UI-ART-01 · 界面美术统一（Survey Ink UI）

把所有显示界面并入已确认的方向 A「观测墨线」：石墨底、骨白墨线、发丝框 + 角标、等宽字。世界与界面共用同一套语义色，不再使用旧版霓虹青 / 橙色。

## 语义色（`src/ui/palette.ts`）

| Token | 颜色 | 含义 |
| --- | --- | --- |
| text / textMid / muted / dim / faint | `#E8E2D0` → `#6C685D` | 骨白墨，按优先级递减；faint 只用于装饰性说明 |
| accent | `#4FE3D6` | 可交互：焦点、主操作 |
| signal | `#7FB7FF` | 稳定连接：CONNECTED、ACTIVE、已装备 |
| warn | `#F2A93B` | 未知 / 不稳定 / 未连接 / 处理中 / 需谨慎（退出、替换存档） |
| rare | `#9FE870` | 永久核心等稀有奖励 |
| hostile | `#FF4A3D` | 只用于敌对，不用于 UI 装饰 |

## 绘图原语（`src/ui/sheet.ts`）

`frame` / `ticks` / `rule` / `dashed` / `sheetChrome` / `diamond`。全部画在 Graphics 上：Graphics 没有 `getBounds()`，所以装饰不会参与点击、焦点或布局审计（`tests/ui-menu-layout.spec.ts`）。

## 约束

- 所有可交互控件的位置、尺寸、文本保持不变，测试中的坐标点击与文本定位继续有效。
- 焦点用形状表达（外角标 + 三角光标），不只靠颜色。
- 覆盖范围：HTML 加载页、Preload、主菜单（含天赋 / 检查点 / 替换存档页）、HUD、升级、暂停全部子页与 Owner 表单、结算 / 胜利、补给终端（economy）。Station Zero 已在 AR-05 使用同一套 Token。
