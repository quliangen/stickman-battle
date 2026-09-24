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

- **存档**：localStorage key `stickman-battle:weapons`，结构 `WeaponConfig { disabled: WeaponType[]; customs: CustomWeapon[] }`。**不做版本门**（和局数存档不同，版本升级不清掉小朋友的"作品"）；读写全部 try/catch，存不了就退化成"默认全开、无自创"。
- **内置武器**：只能启用/禁用，元数据（名字/emoji/说明/rare）在 `BUILTIN_WEAPONS` 一张表，HUD（GameUI）和武器库共用，不要在别处另维护 switch。
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

## 平衡数值位置

武器伤害/冷却散落在 `update()` 各武器分支内，例如：普攻 8 伤、AUG 单发 6 伤、加特林单发 4 伤、导弹 35 伤、普通投射物 15 伤、核弹即死。调平衡时先定位到对应武器分支。

## 新增内置武器清单

1. [types.ts](../types.ts)：扩展 `WeaponType` 联合类型；如需状态机，给 `Projectile` 加可选字段。
2. [GameCanvas.tsx](../components/GameCanvas.tsx)：
   - 拾取 switch 的弹药量（`case 'xxx': entity.ammo = ...`）；
   - `drawHeldWeapon`（手持贴图）与落物绘制分支；
   - `update()` 开火分支（按 `entity.heldWeapon` 分发）与 AI 射程链；
   - 投射物的 update 分支（运动/碰撞/伤害）；
   - `draw()` 投射物渲染分支。
3. [weaponService.ts](../services/weaponService.ts)：`BUILTIN_WEAPONS` 加一行元数据（普通池、HUD 图标/名字、武器库卡片全自动生效）。
4. 可选：[audioService.ts](../services/audioService.ts) 加音效并在开火/命中处调用。
