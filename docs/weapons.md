# 武器系统

## 总览

13 种武器（`WeaponType`，见 [types.ts:18](../types.ts#L18)）：

| 类型 | 武器 |
|---|---|
| 近战 | `sword`、`aug` |
| 投掷/射击 | `bomb`、`laser`、`zeperion`（哉佩利敖光线） |
| 状态机投射物 | `missile`（追踪导弹）、`dragon`（神龙）、`bomber`（轰炸机）、`pokemon`（闪电）、`c4`（遥控炸弹）、`piercer`（穿地弹）、`gas`（毒气） |
| 超级武器 | `atom_bomb`（核弹） |

## 生成规则

- 每局最多掉落 `MAX_WEAPONS_PER_GAME = 6` 件；间隔 `WEAPON_SPAWN_INTERVAL = 900` 帧；存在时间 `WEAPON_LIFETIME = 15 * 60` 帧。
- `atom_bomb` / `missile` / `dragon` 是**稀有武器**，各自通过 `atomBombIndexRef` / `missileIndexRef` / `dragonIndexRef` 在洗牌后的生成序列中固定槽位（见 `initGame`）。
- 普通池在 `spawnFallingItem` 的 `normalPool` 中。
- 玩家拾取判定：`update()` 中按实体与落物距离检测，`heldWeapon` 为空或 `ammo <= 0` 时可拾取。

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

## 平衡数值位置

武器伤害/冷却散落在 `update()` 各武器分支内，例如：普攻 8 伤、导弹 35 伤、普通投射物 15 伤、核弹即死。调平衡时先定位到对应武器分支。

## 新增武器清单

1. [types.ts](../types.ts)：扩展 `WeaponType` 联合类型；如需状态机，给 `Projectile` 加可选字段。
2. [GameCanvas.tsx](../components/GameCanvas.tsx)：
   - `spawnFallingItem` 的生成池（或稀有槽位逻辑）；
   - `drawHeldWeapon`（手持贴图）；
   - `update()` 开火分支（按 `entity.heldWeapon` 分发）；
   - 投射物的 update 分支（运动/碰撞/伤害）；
   - `draw()` 投射物渲染分支。
3. [GameUI.tsx](../components/GameUI.tsx)：`getWeaponIcon` 加 emoji 图标。
4. 可选：[audioService.ts](../services/audioService.ts) 加音效并在开火/命中处调用。
