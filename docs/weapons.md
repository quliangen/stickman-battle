# 武器系统

## 总览

14 种内置武器（`WeaponType`，见 [types.ts:18](../types.ts#L18)）：

| 类型 | 武器 |
|---|---|
| 近战 | `sword`、`aug`、`gatling`（加特林：射速是 AUG 两倍、单发 4 伤、弹道散射、40 发） |
| 投掷/射击 | `bomb`、`laser`、`zeperion`（哉佩利敖光线） |
| 状态机投射物 | `missile`（追踪导弹）、`dragon`（神龙）、`bomber`（轰炸机）、`pokemon`（闪电）、`c4`（遥控炸弹）、`piercer`（穿地弹）、`gas`（毒气） |
| 超级武器 | `atom_bomb`（核弹） |

另外小朋友可以在**武器库**里做自创武器（见下文「武器库与自创武器」），自创 id 以 `cw_` 开头，和内置类型一起组成 `AnyWeaponId`。

## 生成规则

- 每局最多掉落 `MAX_WEAPONS_PER_GAME = 6` 件；间隔 `WEAPON_SPAWN_INTERVAL = 900` 帧；存在时间 `WEAPON_LIFETIME = 15 * 60` 帧。
- `atom_bomb` / `missile` / `dragon` 是**稀有武器**，各自通过 `atomBombIndexRef` / `missileIndexRef` / `dragonIndexRef` 在洗牌后的生成序列中固定槽位（见 `initGame`）。
- 普通池由 `spawnFallingItem` 从 `weaponService.getDropPool()` 取：未被禁用的内置普通武器 + 自创武器 id。稀有槽位也要过禁用开关（`isBuiltinDisabled`），被禁用就退化成普通掉落。
- 池子为空（全禁用且无自创）时兜底掉长剑，保证天上不会什么都不掉。
- 玩家拾取判定：`update()` 中按实体与落物距离检测，`heldWeapon` 为空或 `ammo <= 0` 时可拾取；自创武器的弹药量在拾取 switch 的 `default` 分支从存档读。

## 状态机模式

复杂投射物用"类型字段 + 状态字段"区分阶段，状态字段定义在 `Projectile` 接口（types.ts）：

- `dragonState: 'enter' | 'hunt'`（神龙：入场动画 → 追踪撕咬，含 `dragonSegments` 龙身数组）
- `bomberState: 'fly_in' | 'bombing' | 'fly_out'`
- `pokemonState: 'seeking' | 'attacking'`
- `zeperionState: 'growing' | 'exploding'`
- `c4State: 'flying' | 'planted'`（再次按攻击键遥控引爆，`detonateC4`）
- `piercerState: 'flying' | 'burrowing' | 'erupting'`
- `gasState: 'flying' | 'cloud'`

新增强行为投射物时沿用此模式，并把可选字段加到 `Projectile` 接口。

## 武器库与自创武器

首页「🧰 武器库」按钮打开 [WeaponArsenal.tsx](../components/WeaponArsenal.tsx)，数据层是 [weaponService.ts](../services/weaponService.ts)：

- **存档**：localStorage key `stickman-battle:weapons`，结构 `WeaponConfig { disabled: WeaponType[]; customs: CustomWeapon[]; overrides: Partial<Record<WeaponType, Partial<WeaponStats>>> }`。**不做版本门**（和局数存档不同，版本升级不清掉小朋友的"作品"）；读写全部 try/catch，存不了就退化成"默认全开、无自创"。
- **内置武器**：可启用/禁用，还能「⚙️ 调一调」改数值（见下节）；元数据（名字/emoji/说明/rare）在 `BUILTIN_WEAPONS` 一张表，HUD（GameUI）和武器库共用，不要在别处另维护 switch。
- **自创武器**：行为不能靠 UI 生成代码，所以是**模板 + 参数**：
  | 模板 | 行为 | 专属参数 |
  |---|---|---|
  | `melee` | 复用近战判定块（命中才耗耐久） | `range`、`knockback` |
  | `gun` | 仿 AUG 直线单发弹 | `bulletSpeed`、`color` |
  | `throw` | 仿 bomb 重力弧线 + 落地爆炸 | `blastRadius`、`color` |
  共用参数：`damage`、`ammo`；贴图就是一个 `emoji`（手持/落物/投射物/HUD 全是它）。
- **数值钳制**：保存时按 `CUSTOM_LIMITS` 钳回安全范围（伤害 ≤ 60、弹药 ≤ 30、半径 ≤ 160 等），防止填出毁平衡的武器。
- **投射物参数挂弹上**：开火时把 `customId / damage / blastRadius / tint` 写到 `Projectile` 可选字段，update/draw 直接读弹，不回查存档（存档里被删了也不影响在飞的弹）。区分枪/投掷：`blastRadius` 有值 = 投掷。
- GameCanvas 接入点：攻击链 `customW` 分发（枪/投掷为独立分支，近战只覆盖数值）、投射物 update（直线弹分支 + 投掷爆炸分支）、`drawHeldWeapon` 与落物/投射物绘制（emoji）、AI 射程（近战用 `range`，其余 700）。

## 内置武器数值层（「调一调」）

内置武器的战斗数值不再是写死在 GameCanvas 分支里的字面量，而是走 weaponService 的数值层：

- **默认值表** `BUILTIN_STATS: Record<WeaponType, WeaponStats>`（`WeaponStats` 定义在 [types.ts](../types.ts)：damage / ammo 必有，cooldown / range / knockback / bulletSpeed / blastRadius 按武器取用子集）。
- **玩家调整**存 `WeaponConfig.overrides`，读取时 `getBuiltinStats(type)` = 默认值合并 override。读写都过 `STAT_LIMITS`（+ `STAT_LIMIT_OVERRIDES`，如毒气伤害上限 10）钳制；调整值等于默认值时自动清键，「恢复默认」就是删掉这件武器的 override。
- **GameCanvas 接入模式**：和自创武器一致——开火/使用时读一次 `getBuiltinStats`，把 damage / blastRadius 等**烘焙到 `Projectile` 可选字段**或局部变量，命中/爆炸分支读 `proj.damage ?? 默认值`（老存档种出的弹没有这些字段，兜底）。拾取弹药统一 `getBuiltinStats(t).ammo`；AI 的 sword 射程用 `st.range`。
- **编辑面板**：`BUILTIN_STAT_FIELDS` 声明每件武器开放哪些滑条（如 atom_bomb 只有弹药；gas 的伤害是「每跳伤害」）。UI 在 [WeaponArsenal.tsx](../components/WeaponArsenal.tsx) 的 `BuiltinStatEditor`，名字/emoji 不可改。

默认数值（伤害/弹药/其他）：

| 武器 | 数值 |
|---|---|
| sword 长剑 | 15 伤 × 8 耐久 / 距离 140 / 击退 12 |
| bomb 手雷 | 25 伤 × 3 / 半径 180 |
| aug | 6 伤 × 20 发 / 间隔 8 / 弹速 22 |
| gatling | 4 伤 × 40 发 / 间隔 4 / 弹速 20（散射） |
| laser 激光 | **30 伤 × 6 发 / 间隔 30（狙击定位，不再一击必杀）** |
| zeperion | 40 伤 × 3 |
| c4 | 40 伤 × 2 / 半径 220 |
| piercer | 30 伤 × 3 / 半径 200 |
| gas | 每跳 1 伤（8 帧一跳）× 2 / 半径 120 |
| bomber | **空投小炸弹 20 伤 / 半径 120 × 3 颗**（与整颗手雷区分） |
| pokemon | 20 伤 × 1（+ 麻痹 40 帧） |
| missile | 35 伤 × 2（追踪） |
| dragon | 每口 5 伤 × 5 口 |
| atom_bomb | 全屏抹除 × 1（只开放弹药） |

## 平衡数值位置

内置武器：默认值集中在 `BUILTIN_STATS`（weaponService），玩家可调值在 localStorage overrides，运行时经 `getBuiltinStats` 烘焙到弹上。剩下写死的只有：普攻 8 伤（拳，无武器基准）、普通投射物 15 伤（通用兜底分支）。自创武器的钳制范围见 `CUSTOM_LIMITS`。

## 新增内置武器清单

1. [types.ts](../types.ts)：扩展 `WeaponType` 联合类型；如需状态机，给 `Projectile` 加可选字段。
2. [GameCanvas.tsx](../components/GameCanvas.tsx)：
   - 攻击链开火分支（按 `entity.heldWeapon` 分发）里 `getBuiltinStats` 读数值并烘焙到弹上（拾取弹药已统一走 `getBuiltinStats(t).ammo`，无需再加 case）；
   - `drawHeldWeapon`（手持贴图）与落物绘制分支；
   - AI 射程链；
   - 投射物的 update 分支（运动/碰撞/伤害，读 `proj.damage ?? 默认`）；
   - `draw()` 投射物渲染分支。
3. [weaponService.ts](../services/weaponService.ts)：`BUILTIN_WEAPONS` 加一行元数据、`BUILTIN_STATS` 加默认数值、`BUILTIN_STAT_FIELDS` 声明「调一调」开放哪些滑条（普通池、HUD 图标/名字、武器库卡片与编辑面板全自动生效）。
4. 可选：[audioService.ts](../services/audioService.ts) 加音效并在开火/命中处调用。
