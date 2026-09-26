# 架构详解

## 分层渲染（App.tsx）

```
GameCanvas (z-10, 始终挂载) → GameUI (z-20, 战斗中) → MainMenu / GameOver (z-50)
```

MainMenu 是**三栏布局**：游戏模式居左、选择地图居中、操作提示居右（窄于 `lg` 时自动堆叠成一列）。
三栏共用一个 `MenuCard` 外壳，卡片标题用白底药丸——卡片本身是半透明白，纯白字在浅色天空上几乎看不清。

游戏状态由 `GameState` 枚举驱动：`MENU → PLAYING → VICTORY_ANIMATION → GAME_OVER`。模式为 `'PVE'`（对 AI）、`'PVP'`（双人同屏）或 `'COOP'`（双人闯关：波次刷怪连闯 3 关，怪物 2→3→4 只、血量递增，玩家同阵营免伤，全灭判负、通关第三关判胜）。

注意：`GameCanvas` 始终挂载，菜单界面也在后台跑循环渲染背景——不要在 `PLAYING` 之外的状态执行消耗性逻辑，`update()` 内已有按状态的早退分支，新增逻辑时注意位置。

## 游戏引擎（components/GameCanvas.tsx）

这是全项目最重要的文件（约 3000 行），几乎所有玩法改动都发生在这里。关键设计：

- **Ref 驱动而非 State**：游戏世界（entities / particles / projectiles / fallingItems）全部存于 `useRef`，React state 只用于向 UI 层同步（`setPlayers` / `setStats` / `setGameState`）。不要在每帧 setState。
- **主循环**：`tick()` → `requestAnimationFrame`，每帧先 `update()`（物理/输入/AI/投射物/碰撞）再 `draw()`（背景 → 平台 → 地面 → 障碍 → 投射物 → 实体 → 粒子）。
- **固定步长**：逻辑固定 60Hz，`tick()` 用时间累积器（`lastTimeRef` / `accRef`）决定这一帧要跑几步 `update()`，单帧最多 `MAX_STEPS_PER_FRAME` 步，超过就丢弃积压。**物理常量（`GRAVITY` / `MOVE_SPEED` / 各种 `*_COOLDOWN`）都是"每逻辑帧"的量，新增时必须按 60Hz 来定**，不要再按显示器刷新率推算。没有推进逻辑帧时直接跳过 `draw()`（高刷屏上很常见），省掉整帧光栅化。
- **帧计数** `frameRef` 是全局时间轴，所有动画/冷却/武器生命周期都以"帧"为单位。它在 `update()` 开头自增，**早于 PLAYING 状态的早退分支**，这样菜单界面的背景动画（星空 / 楼顶信号灯 / 落叶）也会动。
- **HUD 同步**：每 5 帧算一次 `hudSignature()`（玩家身上所有可见字段拼成的字符串），只有签名变了才 `setStats` / `setPlayers`。角色站着不动时 React 完全不参与。**新增 HUD 字段时记得加进签名**，否则界面不会更新。
- **坐标系**：`pos.y` 是**脚底**位置（y 向下为正），命中判定、平台碰撞都以脚底为基准——画错方向会"头插地里"。
- **世界尺寸自适应**：关卡坐标以 `BASE_W = 1280` × `BASE_GROUND_Y = 600` 为基准设计；每帧 `tick()` 开头的 `syncWorldSize(canvas)` 会按窗口高度调整 `GROUND_Y`（`min(600, max(280, 画布高 - 90))`），`getPlatforms(map, canvasWidth)` 再按 `GROUND_Y` 与画布宽度等比缩放平台（结果按尺寸缓存）。**新增平台 / 硬编码地面高度时不要直接写 600**，要用 `GROUND_Y` 或基准坐标，否则小窗口下角色会掉出屏幕。
- **物理常量**集中在文件顶部（[GameCanvas.tsx:505](../components/GameCanvas.tsx#L505)）：

  | 常量 | 值 | 说明 |
  |---|---|---|
  | `GRAVITY` | 0.8 | 重力 |
  | `FRICTION` | 0.82 | 摩擦（下蹲落地时为 0.4） |
  | `MOVE_SPEED` | 2.6 | 移动速度 |
  | `JUMP_FORCE` | -22 | 跳跃力 |
  | `ATTACK_COOLDOWN` | 18 | 普攻冷却（帧） |
  | `ATTACK_RANGE` / `ATTACK_DAMAGE` | 100 / 8 | 普攻范围/伤害 |
  | `MAX_PARTICLES` | 1000 | 粒子上限，防特效累积卡顿 |

- **确定性随机**：装饰元素（星空、落叶、沙尘、气泡、火山灰）用 `mulberry32` 带种子 PRNG 预生成数组，保证每帧重绘结果一致。**新增背景装饰时沿用此模式**，不要每帧 `Math.random()` 生成静态元素。
- **粒子上限**：生成粒子务必走 `spawnParticles` / `spawnMushroomCloud` / `spawnShockwave` / `spawnExplosionCloud` 等统一入口并受 `MAX_PARTICLES` 限制；直接 push 进 `particlesRef` 前要考虑上限。
- **静态地形层缓存**：平台材质由 `paintPlatforms` 画进离屏画布（`getTerrainLayer`），每帧只贴一次位图。
  平台位置来自缓存好的 `platformCache`，缓存键复用 `layoutCacheKey`，所以换图 / 改窗口尺寸 / 换局会自动失效。
  **新增平台材质直接改 `paintPlatforms` 即可，它已经不在每帧路径上**；但若新增的是会动的东西（像移动平台那样），
  必须画在 `drawObstacles` 里，不能进静态层。
- **不要在每帧路径上用 `shadowBlur`**：它是对整块区域做高斯模糊，是全项目最贵的一笔。辉光一律用
  「由粗到细叠几层半透明描边/同心圆」伪造（见光束、枪口光点、移动平台霓虹边）。目前每帧路径上已无 `shadowBlur`，
  仅 `paintPlatforms`（缓存，每次布局变化才跑一次）里还有两处。
- **光束只画到画布边缘**：激光 / 哉佩利敖光线原本画 2000px 长，屏幕外的部分照样要描边和模糊，纯属白烧。
- **地形与障碍**：固定平台只是骨架，每局开局会随机追加平台与障碍（陷阱 / 箱子 / 移动平台），详见 [maps.md](maps.md) 的"每局随机地形"。碰撞顺序是：重力 → 位移 → 地面 → 可站立面（含箱子顶面）→ 移动平台（含载人）→ 箱子侧面推出 → 左右墙 → 陷阱伤害。
- **角色互推**：两个角色之间**有碰撞体积**（`update()` 里的「=== 4.5 角色互推 ===」），在双方都走完之后做一次分离。
  谁主动往对方身上撞谁被挡回来，站着不动的一方不会被推走；竖直方向差超过 60px（一个跳起来了）就不互推，免得被卡住。
  **这条不能删**：没有它两个角色会直接穿过去、各自顶死在左右墙上朝外挥拳，而近战要求"面朝对方"，于是永远打不中，一局能拖到 100 秒以上。
- **左右墙内缩量是 `WALL_MARGIN`，不是硬编码的 10**：角色以 `pos.x` 为中心绘制，头是半径 12 的圆乘 1.3 倍绘制比例，
  贴墙站时若内缩量太小会被切掉小半个脑袋。

## HUD 性能约定

游戏主循环已经占着主线程的 rAF，HUD 若再用 JS 逐帧改样式就会直接抢帧。因此：

- **常驻动画一律用 CSS keyframes**（`index.html` 里的 `.hud-bob` / `.hud-danger`），跑在合成器线程，不占主线程。**不要在游戏内 HUD 里用 motion 的 `repeat: Infinity` 动画。**
- **不要动画 `width` / `height` / `top` / `left`**——这些属性会触发 layout + paint。进度条一律用 `transform: scaleX()`（外层容器负责圆角裁切，避免缩放把圆角压扁）。
- `GameCanvas` 与 `GameUI` 都用 `React.memo` 包裹，配合"值没变就不 setState"，避免父组件重渲染时连带重建整个游戏循环的闭包。

## AI（PVE / COOP 模式）

AI 决策在组件级 `aiDecide()`（输出 moveLeft/right、jump、crouch、attack 的"按键意图"，移动与起跳仍由主循环统一执行）：追踪最近的敌对目标、优先捡掉落物、跳跃越障、喷气追高、按武器射程攻击。单人模式下 playerIndex 1 的 P2 由它控制；COOP 模式下 `team: 'enemy'` 的怪物（playerIndex ≥ 2，不读键盘）也由它控制。PVP / COOP 时 P2 改由方向键控制。敌我判定统一走 `isHostile`（非 COOP 全员互敌，COOP 按阵营），伤害入口统一过 `canDamage`（COOP 同阵营免伤），追踪弹目标用 `findEnemy`（按阵营找最近敌人）。键位：P1 = WASD + 空格，P2 = 方向键 + 回车；游戏结束后可按 R 快捷重开（受防沉迷约束）。

## 防沉迷：版本燃尽

**不是时间锁，是版本锁。** 同一个版本最多玩 `PLAYS_PER_VERSION`（3）局，玩满就「燃尽」，
开局按钮全部锁住，直到 [version.ts](../version.ts) 的 `APP_VERSION` 被顶上去才解锁。
小朋友的解锁方式就是找 AI 改代码 —— 详见 [AGENTS.md](../AGENTS.md) 的「改完代码必须顶版本号」。

数据流：

- [version.ts](../version.ts) — `APP_VERSION` 常量 + `bumpPatch` / `bumpMinor`（升级规则）。
- [services/progressService.ts](../services/progressService.ts) — 存档 `{ version, plays }` 存 localStorage。
  **`loadProgress()` 发现存档里的 version 和 `APP_VERSION` 对不上就返回全新存档**，
  这就是「升级即解锁」的全部实现，不需要后端也不需要密码。localStorage 访问全部包了 `try`
  （无痕模式会抛异常），存不了就退化成"每次全新"，绝不能因此白屏。
- App.tsx — 进入 `GAME_OVER` 时 `recordPlay()` 记账；`exhausted` 下发给 MainMenu / GameOver。
  ⚠️ `recordPlay()` 有副作用，**必须写在 setState 的 updater 外面**：StrictMode 会重复调用
  updater 来暴露不纯的更新函数，写在里面每局会被记两次账。
- [components/BurnoutCard.tsx](../components/BurnoutCard.tsx) — 燃尽提示卡（`compact` 变体给主菜单用），
  文案只在这里维护一份。卡片里会给出可直接复制给 AI 的升级指令。
- GameOver 的"家长重置"需二次确认后清空存档。

## 音效

[services/audioService.ts](../services/audioService.ts) 用 Oscillator / 白噪声程序化合成（跳跃/攻击/命中/射击/爆炸/龙吼），无音频资源文件。全部函数 try/catch 包裹（浏览器自动播放策略可能拒绝）。新增音效照抄现有函数模式即可。
