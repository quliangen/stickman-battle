# 开发指引：常见任务与注意事项

## 常见任务入口

| 任务 | 入口 |
|---|---|
| 新增武器 | 见 [weapons.md](weapons.md) 新增武器清单 |
| 新增地图 | 见 [maps.md](maps.md) 新增地图清单 |
| 调手感 | 改 GameCanvas 顶部物理常量（`GRAVITY` / `FRICTION` / `MOVE_SPEED` / `JUMP_FORCE`） |
| 调平衡 | `update()` 各武器分支内的伤害/冷却（普攻 8 伤、导弹 35 伤等） |
| 改防沉迷 | App.tsx 的 `sessionGameCount` 相关两个 useEffect + GameOver.tsx 倒计时 |
| 加音效 | audioService.ts 照抄现有 Oscillator/噪声函数模式 |

## 易踩的坑

1. **GameCanvas.tsx 极大（约 3000 行）**：修改前先定位到具体武器/系统的分支再动手，避免无关重构；一次只改一个武器的行为。
2. **不要在每帧 setState**：游戏世界状态全走 ref，setState 只用于低频的 UI 同步。
3. **`pos.y` 是脚底坐标**（y 向下为正）：命中判定、平台碰撞都以此为基准，搞反会"头插地里"。
4. **GameCanvas 始终挂载**：菜单时也在后台跑渲染循环，`update()` 内新增逻辑注意按 `gameState` 早退。
5. **粒子走统一 spawn 入口**并受 `MAX_PARTICLES = 1000` 限制，直接 push 前考虑上限。
6. **背景静态装饰用 `mulberry32` 预生成**，不要每帧 `Math.random()`（会闪烁且浪费性能）。
7. **`npm run lint` 实际是类型检查**（tsc --noEmit），没有 ESLint/Prettier；风格对齐现有代码（中文注释、2 空格缩进）。
8. **README.md 已过时**：残留的 AI Studio 模板（GEMINI_API_KEY）不适用于当前代码，项目不需要任何环境变量。
