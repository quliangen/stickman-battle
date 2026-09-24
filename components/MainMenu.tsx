import React, { useState } from 'react';
import { motion } from 'motion/react';
import { GameState, GameMode, MapType } from '../types';
import { APP_VERSION, PLAYS_PER_VERSION } from '../version';
import { Progress } from '../services/progressService';
import BurnoutCard from './BurnoutCard';
import WeaponArsenal from './WeaponArsenal';

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

// 首页天空装饰配置：云朵都从右往左慢慢飘（负 delay 让打开页面时它们已经散开），
// 纸飞机从左往右飞、比云快。想加减数量直接改表。
// 注意 look 里必须是完整的 Tailwind 类名（JIT 按源码字面量扫描），不要拼字符串。
const CLOUDS: { top: string; look: string; duration: number; delay: number }[] = [
  { top: '3rem',  look: 'text-8xl opacity-70', duration: 85,  delay: 0 },
  { top: '11rem', look: 'text-7xl opacity-60', duration: 120, delay: -55 },
  { top: '6rem',  look: 'text-6xl opacity-50', duration: 100, delay: -30 },
  { top: '17rem', look: 'text-8xl opacity-40', duration: 140, delay: -95 },
];

// 纸飞机两架：速度、浮动、摇晃节奏各不相同（一快一慢），
// 慢的那架小一号，像飞在更远的天上。
const BIRDS: { top: string; duration: number; delay: number; bob: number; tilt: number; scale: number }[] = [
  { top: '5rem',   duration: 36, delay: -8,  bob: 2.2, tilt: 2.8, scale: 1 },
  { top: '9.5rem', duration: 75, delay: -38, bob: 3.4, tilt: 4.2, scale: 0.7 },
];

// 标题「火柴人大战」的糖果贴纸块：一字一块圆角糖果牌，各自微微歪一点更可爱
// （tile 必须是完整 Tailwind 类名字面量，JIT 才扫得到）
const TITLE_CHARS: { ch: string; tile: string; rot: number }[] = [
  { ch: '火', tile: 'from-red-400 to-red-600',     rot: -6 },
  { ch: '柴', tile: 'from-amber-400 to-amber-600', rot: 5 },
  { ch: '人', tile: 'from-sky-400 to-sky-600',     rot: -4 },
  { ch: '大', tile: 'from-violet-400 to-violet-600', rot: 6 },
  { ch: '战', tile: 'from-rose-400 to-rose-600',   rot: -5 },
];

// 草原：三层叠起来的草坡剪影（远浅近深），顶边剪成参差的草浪，
// 用连续的大形状代替一丛丛小草——远看才是真的草原。静止不摆。
const grassEdgePath = (baseY: number, amp: number): string => {
  let d = `M0 ${baseY}`;
  for (let i = 0; i < 16; i++) {
    const x = i * 80;
    const rise = amp * (0.45 + ((i * 7 + 3) % 10) / 18);   // 高低参差的草浪
    const dip = amp * 0.16 * ((i * 5) % 3);                // 浪谷深浅不一
    d += ` Q ${x + 40} ${baseY - rise} ${x + 80} ${baseY - dip}`;
  }
  return `${d} L 1280 170 L 0 170 Z`;
};

// 三层草坡：远层浅亮像蒙了雾，近层深绿最矮也最清楚
// （h-* 必须是完整 Tailwind 类名写在字面量里，JIT 才扫得到）
const GRASS_BANKS: { h: string; baseY: number; amp: number; from: string; to: string }[] = [
  { h: 'h-40', baseY: 58, amp: 22, from: '#86efac', to: '#4ade80' },
  { h: 'h-32', baseY: 40, amp: 28, from: '#4ade80', to: '#22c55e' },
  { h: 'h-24', baseY: 24, amp: 34, from: '#22c55e', to: '#15803d' },
];

const GrassBank: React.FC<{ bank: (typeof GRASS_BANKS)[number]; gid: string }> = ({ bank, gid }) => (
  <div className={`absolute inset-x-0 bottom-0 ${bank.h}`}>
    <svg width="100%" height="100%" viewBox="0 0 1280 170" preserveAspectRatio="none" className="block">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={bank.from} />
          <stop offset="1" stopColor={bank.to} />
        </linearGradient>
      </defs>
      <path d={grassEdgePath(bank.baseY, bank.amp)} fill={`url(#${gid})`} />
    </svg>
  </div>
);

// 纸飞机：经典折纸造型——机头朝右，两片后掠的机翼 + 中间折痕，
// 下翼涂浅灰当阴影面。飞的时候整个机身轻轻摇晃，像在滑翔。
const PaperPlane: React.FC = () => (
  <svg width="66" height="34" viewBox="0 0 66 34" fill="none"
    className="drop-shadow-[0_2px_3px_rgba(30,64,175,0.35)]">
    {/* 上翼（受光面，雪白） */}
    <path d="M64 17 L4 4 L24 16 Z" fill="#ffffff" stroke="#94a3b8" strokeWidth="1.5" strokeLinejoin="round" />
    {/* 下翼（背光面，浅灰） */}
    <path d="M64 17 L4 30 L24 18 Z" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1.5" strokeLinejoin="round" />
    {/* 中缝折痕 */}
    <path d="M64 17 L24 17" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

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
      <span className="inline-flex items-center gap-1.5 text-sm font-black text-slate-700
        bg-white/80 border-2 border-white rounded-full px-3 py-0.5 shadow">
        <span className="text-base">{icon}</span> {title}
      </span>
    </div>
    {children}
  </motion.section>
);

const MainMenu: React.FC<MainMenuProps> = ({ setGameState, setGameMode, map, setMap, progress, exhausted }) => {
  const [showArsenal, setShowArsenal] = useState(false);

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
      style={{ fontFamily: "-apple-system, 'PingFang SC', 'Helvetica Neue', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif" }}
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

        {/* 云朵：从屏幕右侧飘入、左侧飘出，慢慢横越整个屏幕。
            负 delay 错开相位，打开页面时它们已经散布在天空中。 */}
        {CLOUDS.map(cl => (
          <motion.div
            key={cl.top}
            animate={{ x: ['105vw', '-25vw'] }}
            transition={{ duration: cl.duration, repeat: Infinity, ease: 'linear', delay: cl.delay }}
            style={{ top: cl.top }}
            className={`absolute left-0 select-none ${cl.look}`}
          >☁️</motion.div>
        ))}

        {/* 纸飞机：从屏幕左侧飞入、右侧飞出，各自浮动/摇晃节奏不同、一快一慢 */}
        {BIRDS.map(b => (
          <motion.div
            key={b.top}
            animate={{ x: ['-15vw', '105vw'], y: [0, -10, 0], rotate: [2, -3, 2] }}
            transition={{
              x: { duration: b.duration, repeat: Infinity, ease: 'linear', delay: b.delay },
              y: { duration: b.bob, repeat: Infinity, ease: 'easeInOut', delay: -b.bob / 3 },
              rotate: { duration: b.tilt, repeat: Infinity, ease: 'easeInOut', delay: -b.tilt / 2 },
            }}
            style={{ top: b.top, scale: b.scale }}
            className="absolute left-0 select-none"
          >
            <PaperPlane />
          </motion.div>
        ))}

        {/* 草原：远处起伏的丘陵 → 草色雾霭渐变 → 三层草坡剪影 → 冒头的高草 */}
        <div className="absolute bottom-0 inset-x-0">
          {/* 远处圆滚滚的草原丘陵 */}
          <div className="absolute -left-28 bottom-24 w-[40rem] h-16 rounded-[100%] bg-emerald-300/60" />
          <div className="absolute left-1/4 bottom-20 w-[46rem] h-24 rounded-[100%] bg-emerald-400/50" />
          <div className="absolute -right-32 bottom-24 w-[38rem] h-14 rounded-[100%] bg-emerald-300/55" />
          <div className="h-40 bg-gradient-to-t from-emerald-400/70 to-transparent" />
        </div>

        {/* 三层草坡：远层像蒙雾的浅绿，近层深绿最矮最清楚 */}
        {GRASS_BANKS.map((b, i) => (
          <GrassBank key={b.h} bank={b} gid={`grass-${i}`} />
        ))}
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
          className="text-center -mt-10"
        >
          {/* 标题：糖果贴纸块——每个字一块圆角彩色糖果牌，白字白边，
              微微歪着、轻轻上下浮动，像小朋友的积木字母 */}
          <h1
            className="flex items-center justify-center gap-[0.18em] font-black text-7xl
              [@media(max-height:860px)]:text-6xl [@media(max-height:760px)]:text-5xl"
          >
            {TITLE_CHARS.map((t, i) => (
              <motion.span
                key={t.ch}
                animate={{ y: [0, '-0.1em', 0] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.16 }}
                style={{ rotate: t.rot }}
                className={`inline-flex items-center justify-center w-[1.45em] h-[1.45em]
                  rounded-[0.42em] bg-gradient-to-b ${t.tile}
                  border-[0.07em] border-white text-white
                  shadow-[0_0.14em_0_rgba(30,64,175,0.4)]`}
              >{t.ch}</motion.span>
            ))}
          </h1>
          {/* 版本进度：让小朋友看得见「这个版本还能玩几局」 */}
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className="text-xs font-black text-white bg-blue-600/85 border-2 border-white/70 rounded-full px-3 py-0.5 tabular-nums shadow">
              {APP_VERSION}
            </span>
            <span className={`text-xs font-black border-2 rounded-full px-3 py-0.5 tabular-nums shadow ${
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
                    <span className={`text-sm font-bold ${selected ? 'text-white' : 'text-slate-700'}`}>{m.name}</span>
                  </motion.button>
                );
              })}
            </div>
          </MenuCard>

          {/* 右：操作提示 */}
          <MenuCard icon="⌨️" title="操作提示" delay={0.45}>
            <div className="flex flex-col gap-3 flex-1 justify-center">
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-sm font-bold text-white bg-blue-500 border-2 border-white rounded-full px-3 py-0.5 shadow">
                  玩家 1 · 蓝方
                </span>
                <div className="flex gap-1">
                  <KeyCap>W</KeyCap><KeyCap>A</KeyCap><KeyCap>S</KeyCap><KeyCap>D</KeyCap>
                </div>
                <span className="text-sm font-bold text-white/90 drop-shadow-md">空格 攻击</span>
              </div>

              <div className="h-px bg-white/50" />

              <div className="flex flex-col items-center gap-1.5">
                <span className="text-sm font-bold text-white bg-amber-500 border-2 border-white rounded-full px-3 py-0.5 shadow">
                  玩家 2 · 黄方
                </span>
                <div className="flex gap-1">
                  <KeyCap>↑</KeyCap><KeyCap>←</KeyCap><KeyCap>↓</KeyCap><KeyCap>→</KeyCap>
                </div>
                <span className="text-sm font-bold text-white/90 drop-shadow-md">回车 攻击</span>
              </div>
            </div>
          </MenuCard>
        </div>

        {/* 武器库入口：管理天上掉的武器 + 做自创武器 */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          whileHover={{ scale: 1.05, y: -3 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowArsenal(true)}
          className="inline-flex items-center gap-2 rounded-2xl border-4 border-white/70
            bg-gradient-to-b from-violet-400 to-purple-600 px-8 py-3
            text-2xl font-black text-white tracking-wider
            shadow-[0_8px_0_0_rgba(0,0,0,0.25)]"
        >
          🧰 武器库
        </motion.button>
        </div>
      </div>

      {showArsenal && <WeaponArsenal onClose={() => setShowArsenal(false)} />}
    </motion.div>
  );
};

export default MainMenu;
