import React from 'react';
import { motion } from 'motion/react';
import { GameState, GameMode, MapType } from '../types';
import { APP_VERSION, PLAYS_PER_VERSION } from '../version';
import { Progress } from '../services/progressService';
import BurnoutCard from './BurnoutCard';

interface MainMenuProps {
  setGameState: (state: GameState) => void;
  setGameMode: (mode: GameMode) => void;
  map: MapType;
  setMap: (map: MapType) => void;
  progress: Progress;
  /** 本版本已玩满 PLAYS_PER_VERSION 局：锁住开局，必须先升级版本 */
  exhausted: boolean;
}

// 地图列表：颜色 / 图标 / 名称集中配置，新增地图只需在这里加一项
const MAPS: { id: MapType; name: string; icon: string; active: string; ring: string }[] = [
  { id: 'neon', name: '霓虹都市', icon: '🌆', active: 'from-blue-500 to-indigo-500 shadow-blue-700', ring: 'border-blue-200' },
  { id: 'forest', name: '森林', icon: '🌲', active: 'from-green-500 to-emerald-500 shadow-green-700', ring: 'border-green-200' },
  { id: 'desert', name: '沙漠', icon: '🏜️', active: 'from-amber-500 to-orange-500 shadow-amber-700', ring: 'border-amber-200' },
  { id: 'ocean', name: '海洋', icon: '🌊', active: 'from-cyan-500 to-sky-500 shadow-cyan-700', ring: 'border-cyan-200' },
  { id: 'volcano', name: '火山', icon: '🌋', active: 'from-red-500 to-rose-500 shadow-red-700', ring: 'border-rose-200' },
];

// 键盘按键帽
const KeyCap: React.FC<{ children: React.ReactNode; wide?: boolean }> = ({ children, wide }) => (
  <span className={`inline-flex items-center justify-center ${wide ? 'px-3' : 'w-8'} h-8 rounded-lg bg-white text-slate-700 text-base font-black border-b-4 border-slate-300 shadow-sm`}>
    {children}
  </span>
);

const KidButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  color: 'blue' | 'yellow';
  children: React.ReactNode;
  subText: string;
  icon: string;
}> = ({ onClick, disabled, color, children, subText, icon }) => {
  const palette = color === 'blue'
    ? 'from-sky-400 to-blue-600 border-blue-200 shadow-blue-900/40'
    : 'from-amber-300 to-yellow-500 border-yellow-200 shadow-yellow-900/40';

  return (
    <motion.button
      whileHover={disabled ? {} : { scale: 1.04, y: -6 }}
      whileTap={disabled ? {} : { scale: 0.96, y: 2 }}
      onClick={onClick}
      disabled={disabled}
      className={`group relative w-full h-24 [@media(max-height:820px)]:h-20 rounded-[2rem]
        flex items-center justify-center gap-4
        bg-gradient-to-b ${palette} border-4
        shadow-[0_10px_0_0_rgba(0,0,0,0.25)]
        transition-all overflow-hidden
        ${disabled ? 'opacity-50 grayscale cursor-not-allowed' : ''}`}
    >
      {/* 顶部高光 */}
      <div className="absolute inset-x-0 top-0 h-1/2 bg-white/20 rounded-t-[1.8rem] pointer-events-none" />
      <div className="relative z-10 w-14 h-14 [@media(max-height:820px)]:w-12 [@media(max-height:820px)]:h-12 rounded-2xl bg-white/25 border-2 border-white/60 flex items-center justify-center text-4xl [@media(max-height:820px)]:text-3xl backdrop-blur-sm">
        {icon}
      </div>
      <div className="relative z-10 flex flex-col items-start">
        <span className="text-3xl xl:text-4xl font-black text-white tracking-wider drop-shadow-[0_3px_0_rgba(0,0,0,0.25)]">
          {children}
        </span>
        <span className="text-sm xl:text-base font-bold text-white/90 mt-0.5">
          {subText}
        </span>
      </div>
    </motion.button>
  );
};

// 三栏卡片的统一外壳：白描边 + 半透明底 + 标题
const MenuCard: React.FC<{
  icon: string;
  title: string;
  delay: number;
  className?: string;
  children: React.ReactNode;
}> = ({ icon, title, delay, className, children }) => (
  <motion.section
    initial={{ opacity: 0, y: 24 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    className={`flex flex-col bg-white/25 backdrop-blur-sm border-4 border-white/60 rounded-3xl p-4 shadow-lg ${className ?? ''}`}
  >
    {/* 标题用白底药丸：卡片本身是半透明白，纯白字在浅色天空上几乎看不清 */}
    <div className="flex items-center justify-center mb-3">
      <span className="inline-flex items-center gap-1.5 font-body text-sm font-black text-slate-700
        bg-white/80 border-2 border-white rounded-full px-3 py-0.5 shadow">
        <span className="text-base">{icon}</span> {title}
      </span>
    </div>
    {children}
  </motion.section>
);

const MainMenu: React.FC<MainMenuProps> = ({ setGameState, setGameMode, map, setMap, progress, exhausted }) => {
  const startGame = (mode: GameMode) => {
    if (exhausted) return;
    setGameMode(mode);
    setGameState(GameState.PLAYING);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-50 flex flex-col items-center justify-center text-white overflow-hidden
        bg-gradient-to-b from-sky-500 via-sky-300 to-emerald-200"
    >
      {/* 背景装饰：太阳 / 云朵 / 远山 / 草地 */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
          className="absolute -top-24 -right-24 w-[22rem] h-[22rem]"
        >
          <div className="w-full h-full rounded-full bg-yellow-200/70 blur-2xl" />
          <div className="absolute inset-16 rounded-full bg-yellow-100/80 blur-xl" />
        </motion.div>

        <motion.div
          animate={{ x: [0, 120, 0] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-12 left-8 text-8xl opacity-70 select-none"
        >☁️</motion.div>
        <motion.div
          animate={{ x: [0, -140, 0] }}
          transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-44 right-24 text-7xl opacity-60 select-none"
        >☁️</motion.div>

        {/* 远山与草地 */}
        <div className="absolute bottom-0 inset-x-0">
          <div className="h-40 bg-gradient-to-t from-emerald-400/70 to-transparent" />
          <div className="h-16 bg-emerald-500/80" />
          <div className="h-6 bg-emerald-600" />
        </div>
      </div>

      {/* 内容区：窗口够高时居中，窗口偏矮时可滚动，避免标题 / 提示被裁掉 */}
      <div className="relative z-10 w-full h-full overflow-y-auto flex">
        <div className="m-auto w-full max-w-6xl flex flex-col items-center gap-6
          [@media(max-height:860px)]:gap-4 px-6 py-10 [@media(max-height:860px)]:py-5">
        {/* 标题 */}
        <motion.div
          initial={{ y: -60, opacity: 0, scale: 0.85 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ type: 'spring', bounce: 0.5, delay: 0.15 }}
          className="text-center"
        >
          <div className="inline-flex items-center gap-2 text-base font-bold text-white bg-orange-400/90 border-2 border-white/70 rounded-full px-5 py-1 mb-2 shadow-lg">
            ✨ 超级好玩的 ✨
          </div>
          <h1
            className="whitespace-nowrap text-7xl [@media(max-height:860px)]:text-6xl [@media(max-height:760px)]:text-5xl
              font-black tracking-wider drop-shadow-[0_8px_0_rgba(30,64,175,0.55)]"
            style={{ WebkitTextStroke: '3px #1d4ed8' }}
          >
            火柴人大乱斗
          </h1>
          {/* 版本进度：让小朋友看得见「这个版本还能玩几局」 */}
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className="font-body text-xs font-black text-white bg-blue-600/85 border-2 border-white/70 rounded-full px-3 py-0.5 tabular-nums shadow">
              {APP_VERSION}
            </span>
            <span className={`font-body text-xs font-black border-2 rounded-full px-3 py-0.5 tabular-nums shadow ${
              exhausted
                ? 'text-amber-950 bg-amber-300 border-white'
                : 'text-white bg-blue-600/85 border-white/70'
            }`}>
              本版本已玩 {progress.plays} / {PLAYS_PER_VERSION} 局
            </span>
          </div>
        </motion.div>

        {/* 版本燃尽提示（玩满 PLAYS_PER_VERSION 局后出现，同时锁住下面的开局按钮） */}
        {exhausted && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-lg flex justify-center"
          >
            <BurnoutCard compact />
          </motion.div>
        )}

        {/* 三栏：游戏模式（居左）/ 选择地图（居中）/ 操作提示（居右）
            窗口窄于 lg 时自动堆叠成一列，避免按钮被挤扁。 */}
        <div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">

          {/* 左：游戏模式 */}
          <MenuCard icon="🎮" title="游戏模式" delay={0.25}>
            <div className="flex flex-col gap-3 flex-1 justify-center">
              <KidButton
                color="blue"
                icon="🤖"
                disabled={exhausted}
                subText={exhausted ? '先去升级版本，回来就能玩啦' : '一个人玩，打败电脑！'}
                onClick={() => startGame('PVE')}
              >
                单人闯关
              </KidButton>

              <KidButton
                color="yellow"
                icon="🧑‍🤝‍🧑"
                disabled={exhausted}
                subText={exhausted ? '先去升级版本，回来就能玩啦' : '和小伙伴一起玩！'}
                onClick={() => startGame('PVP')}
              >
                双人对战
              </KidButton>
            </div>
          </MenuCard>

          {/* 中：选择地图 */}
          <MenuCard icon="🗺️" title="选择地图" delay={0.35}>
            {/* 5 张地图按 3 + 2 排布，最后一行居中 */}
            <div className="flex flex-wrap justify-center content-center gap-2 flex-1">
              {MAPS.map(m => {
                const selected = map === m.id;
                return (
                  <motion.button
                    key={m.id}
                    whileHover={{ scale: 1.06, y: -3 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => setMap(m.id)}
                    className={`basis-[calc(33.333%-0.34rem)] flex flex-col items-center gap-1 py-2 rounded-2xl border-4 transition-all
                      ${selected
                        ? `bg-gradient-to-b ${m.active} ${m.ring} shadow-[0_5px_0_0_rgba(0,0,0,0.25)]`
                        : 'bg-white/40 border-white/40 hover:bg-white/60'}`}
                  >
                    <span className="text-3xl">{m.icon}</span>
                    <span className={`font-body text-sm font-bold ${selected ? 'text-white' : 'text-slate-700'}`}>{m.name}</span>
                  </motion.button>
                );
              })}
            </div>
          </MenuCard>

          {/* 右：操作提示 */}
          <MenuCard icon="⌨️" title="操作提示" delay={0.45}>
            <div className="flex flex-col gap-3 flex-1 justify-center">
              <div className="flex flex-col items-center gap-1.5">
                <span className="font-body text-sm font-bold text-white bg-blue-500 border-2 border-white rounded-full px-3 py-0.5 shadow">
                  玩家 1 · 蓝方
                </span>
                <div className="flex gap-1">
                  <KeyCap>W</KeyCap><KeyCap>A</KeyCap><KeyCap>S</KeyCap><KeyCap>D</KeyCap>
                </div>
                <span className="font-body text-sm font-bold text-white/90 drop-shadow-md">空格 攻击</span>
              </div>

              <div className="h-px bg-white/50" />

              <div className="flex flex-col items-center gap-1.5">
                <span className="font-body text-sm font-bold text-white bg-amber-500 border-2 border-white rounded-full px-3 py-0.5 shadow">
                  玩家 2 · 黄方
                </span>
                <div className="flex gap-1">
                  <KeyCap>↑</KeyCap><KeyCap>←</KeyCap><KeyCap>↓</KeyCap><KeyCap>→</KeyCap>
                </div>
                <span className="font-body text-sm font-bold text-white/90 drop-shadow-md">回车 攻击</span>
              </div>
            </div>
          </MenuCard>
        </div>
        </div>
      </div>
    </motion.div>
  );
};

export default MainMenu;
