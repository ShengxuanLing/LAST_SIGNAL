# ART-02 证据目录

全部截图由 `npx playwright test -c playwright.art02.config.ts`（`scripts/art02/capture.spec.ts`）对本地 dev server 的真实运行画面截取。每一帧都由**真实键盘输入驱动真实 `SliceModel`**，没有预制动画。

## Demo A — 环境升级（同一状态、同一相机、同一 1280×720）

`?vq=off` = 原渲染器（改造前），`?vq=high` = ART-02（改造后）。两张图都在 Esc 暂停后截取。

| 场景 | 改造前 | 改造后 |
|---|---|---|
| R1 观测实验室 | `demoA-lab-before.png` | `demoA-lab-after.png` |
| R2 失稳走廊 | `demoA-corridor-before.png` | `demoA-corridor-after.png` |

## Demo B — Signal 视觉反馈（实际游戏状态驱动）

| # | 文件 | 权威状态 |
|---|---|---|
| 01 | `demoB-01-scan-wave.png` | Scan 传播中（12 格观察范围） |
| 02 | `demoB-02-scan-revealed-link.png` | 揭示：封锁载波 → 门接收器（红色流动 = 敌对控制） |
| 03 | `demoB-03-jam-door-open.png` | Jam 门接收器：光束、干扰、门 `JAMMED_OPEN` |
| 04 | `demoB-04-corridor-scan-relay-links.png` | 走廊扫描：中继器 → 桥承重 / 守卫感知（中继器关闭 = 虚线） |
| 05 | `demoB-05-guard-jammed.png` | Jam 守卫：守卫链路断开 + 剩余时长弧 |
| 06 | `demoB-06-bridge-transitioning.png` | Relay 开启 → 桥 `TRANSITIONING`（线框组装） |
| 07 | `demoB-07-bridge-stable.png` | 桥 `STABLE`（冷蓝导轨脉冲） |
| 08 | `demoB-08-bridge-unstable.png` | Relay 关闭 → 桥 `UNSTABLE`（琥珀、残影、裂纹） |
| 09 | `demoB-09-bridge-recovered.png` | Relay 再开启 → 恢复 `STABLE` |
| 10 | `demoB-10-guard-watching.png` | 守卫 `WATCHING`（红灯、指向玩家） |
| 11 | `demoB-11-guard-hit.png` | 射击命中守卫（闪光、火花） |

`demoB-console-errors.json`：Demo B 期间浏览器控制台错误（应为 `[]`）。

## 分辨率与档位

- `res-1920x1080.png`、`res-1366x768.png`、`res-1280x720.png`、`res-1024x768.png`、`res-800x600.png`
- `tier-low.png`、`tier-medium.png`、`tier-high.png`
- `perf.json`：1920×1080 下各档位 3 秒帧时间采样（无头 Chromium，相对比较，非硬件结论）

## 测试日志（`logs/`）

- `baseline-*.log`：改造前（`origin/main` 860a0dd）
- `after-*.log`：改造后
