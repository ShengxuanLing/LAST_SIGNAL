# LAST SIGNAL 补给终端

在项目根目录运行 `npm run dev`，然后打开终端显示的地址加上 `/economy.html`。默认地址为 `http://localhost:5173/economy.html`。

击败敌人可以拾取信用点。首次清理普通房间额外获得 12 点，精英房额外获得 24 点。入口旁的首个战斗房、精英房和商店房会显示补给终端。清理威胁后，按 **G** 或点击 **Supply terminal**。

| 商品 | 价格 | 效果 |
| --- | ---: | --- |
| Repair kit | 16 | 恢复最多 35 点生命。 |
| Weapon calibration | 28 | 当前武器升一级，最高 10 级。 |
| 临时武器 | 40 | 获得并装备终端展示的武器。货品由地图种子和房间决定。 |

购买会立即保存到安全检查点。信用点、已购武器和校准等级都属于当前一局。Boss 奖励的永久核心仍用于主菜单的永久天赋。原版和补给终端入口在相同浏览器地址下共用检查点。

生产构建使用 `npm run build -- --config vite.economy.config.ts`。生成的 `dist` 同时包含 `index.html` 和 `economy.html`。
