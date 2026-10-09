# 地图系统

## 总览

15 张地图（`MapType`）：`neon`（霓虹都市/星空+城市天际线）、`forest`（森林）、`desert`（沙漠）、`ocean`（海洋）、`volcano`（火山）、`night`（黑夜/星空+月亮+萤火虫+夜色草地）、`snow`（雪原/淡日+雪山+雪松+飘雪）、`prairie`（草原/蓝天白云+缓丘+风车+野花+蝴蝶+草浪）、`glacier`（冰川/极光+冰川崖+远海浮冰+企鹅+冰晶）、`space`（太空/星云+带环行星+陨石+UFO+流星+月面）、`village`（村庄/暖蓝天空+木屋烟囱+尖桩栅栏+母鸡+小鸟）、`sky`（天空/湛蓝天空+旋转太阳+彩虹+多层飘云+热气球+飞鸟+浮空岛）、`summit`（山顶/破晓天空+旭日+雪峰剪影+云海+盘旋雄鹰+山顶旗帜+吹雪）、`mine`（矿井/暗褐岩洞+发光水晶+钟乳石+摇曳矿灯+木支架+蝙蝠+滴水+矿车铁轨）、`city`（城市/白天都市：湛蓝晴空+摩天楼窗格+水塔闪灯天线+摆动塔吊+高架车流+飞机尾烟+街道斑马线）。

每张地图由两部分组成：

1. **平台数组常量**：`NEON_PLATFORMS` / `FOREST_PLATFORMS` / ... （[GameCanvas.tsx:521](../components/GameCanvas.tsx#L521)），类型为 `Platform { x, y, width, height }`，通过 `getPlatforms(map, canvasWidth)` 选取。常量里的坐标是 **1280 × 600 基准坐标系**下的设计值，`getPlatforms` 会按当前画布宽高自动缩放（详见 [architecture.md](architecture.md) 的"世界尺寸自适应"）。
2. **背景绘制函数**：`drawNeonBackground`（neon 星空 + 城市天际线）/ `drawForestBackground` / `drawDesertBackground` / `drawOceanBackground` / `drawVolcanoBackground` / `drawNightBackground`（黑夜）/ `drawSnowBackground`（雪原）/ `drawPrairieBackground`（草原）/ `drawGlacierBackground`（冰川）/ `drawSpaceBackground`（太空）/ `drawVillageBackground`（村庄）/ `drawSkyBackground`（天空）/ `drawSummitBackground`（山顶）/ `drawMineBackground`（矿井）/ `drawCityBackground`（城市），在 `draw()` 中按当前地图调用。

## 每局随机地形

固定平台只是"骨架"，每局开局（`initGame`）会调 `regenerateLayout(map)` 重新掷一次地形：

| 元素 | 数量 | 说明 |
|---|---|---|
| 追加平台 | 1~3 | 落在 `TIERS`（470/400/320/240）四个高度层级上 |
| 伤害陷阱 `spike` | 1~2 | 贴地尖刺，踩到掉 `SPIKE_DAMAGE` 血并被弹开，`SPIKE_COOLDOWN` 帧内不会重复判定 |
| 实心阻挡 `block` | 1~2 | 贴地箱子，顶面可站立，侧面会把人推开 |
| 移动平台 `mover` | 0~2 | 横向或纵向往返，站在上面会被带着走 |

关键约定：

- **一切都在 1280×600 基准坐标系下生成**，取用时由 `syncLayout()` 按画布尺寸等比缩放，和固定平台共用同一套 `sx / sy`。
- **出生点安全区**：`SPAWN_SAFE_X = 210`，随机元素只会落在 `[210, 1070]`，不会骑在双方出生点上。
- **移动平台预留的是整条运动包络**（`w + 2*range` / `20 + 2*range`）而不是平台自身，否则平台扫过去时会穿过固定平台，站在上面的角色也会被顶进平台里。新增会动的元素时必须沿用这一点。
- **贴地障碍的高度要随 `sy` 缩放**（`height: o.height * sy`），否则窗口变矮时底边会浮在地面之上。
- 地形数据通过 `getPlatforms()`（可站立面：固定平台 + 追加平台 + 箱子顶面）和 `getLayout()`（陷阱 / 阻挡 / 移动平台）读取，两者共用 `syncLayout()` 的缓存，靠 `layoutVersion` 在换局时失效。
- 移动平台每帧在动，**不在 `getPlatforms()` 的缓存数组里**，由 `update()` 单独更新位置与载人位移。

## 背景绘制约定

- 静态装饰元素（星星、落叶、沙尘、气泡、火山灰、雪花）用 `mulberry32(seed)` 预生成数组，保证帧间一致；每张地图用不同的种子常量。
- **大面积的静态装饰要画进离屏缓存**：霓虹都市的天际线（几百扇亮窗）由 `getCityLayer()` 画进离屏画布，每帧只 `drawImage` 一次，缓存键含画布宽与 `GROUND_Y`，尺寸变了自动重画。重画时楼的位置不能跟着变，所以楼的排布用固定种子 PRNG。若新增类似的密集静态装饰，沿用同一模式。
- 动态元素（楼顶信号灯、光线、飘浮物）以 `frameRef` / 传入的 `frame` 为时间轴做周期运动。
- 各地图平台的材质绘制集中在 `draw()` 的平台分支里，统一用 `roundRectPath()` 画圆角，霓虹 / 火山额外带辉光（`ctx.shadowBlur`）。

## 新增地图清单

1. [types.ts](../types.ts)：扩展 `MapType` 联合类型。
2. [GameCanvas.tsx](../components/GameCanvas.tsx)：
   - 新增 `XXX_PLATFORMS` 常量并接入 `basePlatformsOf`；
   - 新增 `drawXxxBackground` 函数并在 `draw()` 中分发；
   - 在 `OBSTACLE_PALETTE` 里补一条该地图的障碍配色；
   - 如平台有特殊外观（如岩浆），在平台绘制分支中处理。
3. [MainMenu.tsx](../components/MainMenu.tsx)：在文件顶部的 `MAPS` 数组里加一项（`id / name / icon / active / ring`），选择区会自动多出一个按钮，无需改 JSX。
