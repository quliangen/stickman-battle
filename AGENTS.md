# AGENTS.md — 火柴人传说：双重乱斗

本文件为 AI 编码助手（Claude Code 等）提供本项目的开发指引。

## 项目简介

纯前端 2D 火柴人双人对战小游戏：Canvas 2D 逐帧渲染（自研游戏循环，无游戏引擎），React 负责 UI 层。完全离线可运行，无后端与 API 依赖（README.md 残留的 AI Studio / GEMINI_API_KEY 内容已过时）。

**目标用户是儿童**：卡通 UI，内置「版本燃尽」防沉迷机制（见下），改动请保持这一定位。

## ⚠️ 改完代码必须顶版本号

防沉迷不是时间锁，而是**版本锁**：同一个版本最多玩 3 局，玩满就「燃尽」，
开局按钮被锁住，直到 [version.ts](version.ts) 里的 `APP_VERSION` 被改掉才解锁。
小朋友的解锁方式就是**找你（AI）改代码**——所以：

> **只要你动了游戏内容（修 bug 或加功能），就必须同步把 `APP_VERSION` 往上顶一格。**

规则：

| 改动类型 | 顶哪一位 | 例子 |
|---|---|---|
| 🐞 修 bug | 最后一位 +1 | `v1.0.0` → `v1.0.1` |
| ✨ 加功能 | 中间位 +1 | `v1.0.1` → `v1.1.0` |

忘了顶版本号，小朋友改完刷新页面会发现**还是锁着**——这是最常见的坑。

## 技术栈

React 19 + TypeScript · Vite 6 · Canvas 2D · motion (`motion/react`) · Tailwind CSS 3 · Web Audio 合成音效

## 常用命令

**包管理器统一使用 yarn v1**（lockfile 为 `yarn.lock`，勿使用 npm / pnpm，二者已被 .gitignore 屏蔽）。

```bash
yarn             # 安装依赖
yarn dev         # 开发服务器 http://localhost:3000
yarn build       # 生产构建（输出 dist/）
yarn lint        # 类型检查（tsc --noEmit），提交前必跑；无测试框架、无 ESLint
```

## 目录结构

```
├── index.tsx / index.html / index.css   # 入口
├── App.tsx                              # 顶层状态机 + 版本进度 + 分层渲染
├── version.ts                           # ★ 版本号与升级规则（防沉迷的钥匙，改完代码要顶）
├── types.ts                             # 全部共享类型
├── components/
│   ├── GameCanvas.tsx                   # ★ 核心：约 4000 行游戏引擎，几乎所有玩法改动在此
│   ├── GameUI.tsx                       # 战斗 HUD
│   ├── MainMenu.tsx                     # 主菜单（模式/地图选择 + 武器库入口）
│   ├── WeaponArsenal.tsx                # 武器库（内置启停 + 内置数值「调一调」 + 自创武器增改删）
│   ├── GameOver.tsx                     # 结算
│   └── BurnoutCard.tsx                  # 「版本燃尽」提示卡（文案只在这里维护）
├── services/
│   ├── audioService.ts                  # Web Audio 程序化音效
│   ├── progressService.ts               # 版本进度存档（localStorage，带版本门）
│   └── weaponService.ts                 # 武器库存档（localStorage，跨版本保留）+ 内置武器数值层（BUILTIN_STATS / overrides / 调一调）
└── docs/                                # 详细文档（见下）
```

## 核心约定

- 游戏世界状态存 `useRef`，**绝不在每帧 setState**；React state 只用于向 UI 层同步。
- 时间以"帧"为单位（`frameRef`，60fps 假设）；实体 `pos.y` 是**脚底**坐标，y 向下为正。
- 共享类型一律放 [types.ts](types.ts)；注释与 UI 文案用中文；样式只写 Tailwind 工具类。
- 提交前运行 `yarn lint` 确保无类型错误。

## 详细文档

- [docs/architecture.md](docs/architecture.md) — 架构详解：分层渲染、游戏循环、物理常量、AI、音效
- [docs/weapons.md](docs/weapons.md) — 武器系统与新增武器指引
- [docs/maps.md](docs/maps.md) — 地图系统与新增地图指引
- [docs/development.md](docs/development.md) — 常见任务指引与易踩的坑
