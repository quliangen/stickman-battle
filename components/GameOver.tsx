import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { GameStats } from '../types';
import { PLAYS_PER_VERSION } from '../version';
import { Progress } from '../services/progressService';
import BurnoutCard from './BurnoutCard';

interface GameOverProps {
  stats: GameStats;
  onRestart: () => void;
  onMenu: () => void;
  progress: Progress;
  /** 本版本已玩满 PLAYS_PER_VERSION 局：不给重开，必须先升级版本 */
  exhausted: boolean;
  sessionStartTime: number;
  onResetSession: () => void;
}

const GameOver: React.FC<GameOverProps> = ({ stats, onRestart, onMenu, progress, exhausted, sessionStartTime, onResetSession }) => {
  const [canRestart, setCanRestart] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - sessionStartTime) / 60000));

  useEffect(() => {
    // 结算界面刚出现时留 1 秒冷却：小朋友往往还按着上一局的方向键/攻击键，
    // 没有这段缓冲就会「刚看到胜利画面就自己开下一局了」。
    const timer = setTimeout(() => setCanRestart(true), 1000);
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sessionStartTime) / 60000));
    }, 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [sessionStartTime]);

  const restartEnabled = canRestart && !exhausted;

  // 双人闯关：胜者只有"全员通关"与"全军覆没"两种结果，不走 P1/P2 判定
  const isCoop = stats.mode === 'COOP';
  const coopWin = isCoop && stats.winner === 'PLAYERS';
  const isDraw = !isCoop && stats.winner !== 'P1' && stats.winner !== 'P2';
  const winnerText = isCoop
    ? (coopWin ? '闯关成功！' : '闯关失败…')
    : (isDraw ? '平局！' : (stats.winner === 'P1' ? '蓝方 胜利！' : '黄方 胜利！'));
  // 胜利标题按阵营着色：蓝方蓝金、黄方橙金、平局紫粉、通关金红、失败灰蓝
  const winnerGradient = isCoop
    ? (coopWin ? 'from-amber-200 to-orange-600' : 'from-slate-300 to-slate-600')
    : (isDraw
      ? 'from-fuchsia-300 to-violet-700'
      : (stats.winner === 'P1' ? 'from-sky-300 to-blue-700' : 'from-amber-200 to-orange-600'));
  const winnerBadge = isCoop ? (coopWin ? '🏆' : '💦') : (isDraw ? '🤝' : '🏆');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-50 overflow-y-auto text-white
        bg-gradient-to-b from-indigo-600 via-violet-500 to-sky-400"
    >
      {/* 背景装饰 */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,rgba(255,255,255,0.28),transparent_60%)]" />
        {['🎊', '⭐', '✨', '🎊', '⭐'].map((e, i) => (
          <motion.div
            key={i}
            animate={{ y: [0, -18, 0], rotate: [-8, 8, -8] }}
            transition={{ duration: 4 + i, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute text-5xl opacity-40 select-none"
            style={{ left: `${8 + i * 21}%`, top: `${12 + (i % 3) * 22}%` }}
          >
            {e}
          </motion.div>
        ))}
      </div>

      {/* 内容区：窗口够高时居中，窗口偏矮时可滚动（燃尽卡片会让内容高不少） */}
      <div className="relative min-h-full w-full flex flex-col items-center justify-center px-8 py-6">

      {/* 胜利者展示 */}
      <motion.div
        initial={{ scale: 0.8, y: -20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0.5 }}
        className={`relative z-10 text-center ${exhausted ? 'mb-3' : 'mb-6'}`}
      >
        <div className={`inline-flex items-center gap-2 font-black text-amber-900 bg-amber-300 border-4 border-white rounded-full px-6 shadow-lg
          ${exhausted ? 'text-base py-0.5 mb-2' : 'text-lg py-1 mb-4'}`}>
          🎉 比赛结束啦 🎉
        </div>
        <div className="flex items-center justify-center gap-4">
          <motion.span
            animate={{ rotate: [-12, 12, -12], scale: [1, 1.12, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            className={exhausted ? 'text-5xl drop-shadow-lg' : 'text-7xl drop-shadow-lg'}
          >
            {winnerBadge}
          </motion.span>
          <h2
            className={`${exhausted ? 'text-5xl' : 'text-7xl'} font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-b ${winnerGradient}
              drop-shadow-[0_6px_0_rgba(30,27,75,0.45)]`}
            style={{ WebkitTextStroke: '3px #ffffff' }}
          >
            {winnerText}
          </h2>
        </div>
      </motion.div>

      {/* 本局数据 */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className={`relative z-10 flex gap-4 ${exhausted ? 'mb-3' : 'mb-6'}`}
      >
        <div className="min-w-[8rem] bg-white/20 border-4 border-white/70 rounded-2xl px-6 py-3 text-center backdrop-blur-sm shadow-lg">
          <div className="font-body text-sm font-bold text-white/80">本局时长</div>
          <div className="text-3xl font-black tabular-nums">
            {Math.floor(stats.duration / 60).toString().padStart(2, '0')}:{Math.floor(stats.duration % 60).toString().padStart(2, '0')}
          </div>
        </div>
        <div className="min-w-[8rem] bg-white/20 border-4 border-white/70 rounded-2xl px-6 py-3 text-center backdrop-blur-sm shadow-lg">
          <div className="font-body text-sm font-bold text-white/80">游戏模式</div>
          <div className="text-3xl font-black">{stats.mode === 'PVP' ? '双人' : stats.mode === 'COOP' ? '双人闯关' : '单人'}</div>
        </div>
        {/* 双人闯关：显示到达的关卡 */}
        {isCoop && (
          <div className="min-w-[8rem] bg-white/20 border-4 border-white/70 rounded-2xl px-6 py-3 text-center backdrop-blur-sm shadow-lg">
            <div className="font-body text-sm font-bold text-white/80">到达关卡</div>
            <div className="text-3xl font-black tabular-nums">{stats.wave ?? 1} / {stats.totalWaves ?? 3}</div>
          </div>
        )}
      </motion.div>

      {/* 版本燃尽提示：玩满 PLAYS_PER_VERSION 局后出现，同时锁住"再玩一局" */}
      {exhausted && <BurnoutCard />}

      {/* 交互按钮 */}
      <div className="relative z-10 flex gap-6 mt-4">
        <motion.button
          whileHover={{ scale: 1.05, y: -3 }}
          whileTap={{ scale: 0.95, y: 0 }}
          onClick={onMenu}
          className="px-8 py-4 bg-white/25 hover:bg-white/35 border-4 border-white rounded-full text-2xl font-black text-white
            shadow-[0_7px_0_0_rgba(0,0,0,0.3)] transition-all"
        >
          🏠 回到主页
        </motion.button>
        <motion.button
          whileHover={restartEnabled ? { scale: 1.05, y: -3 } : {}}
          whileTap={restartEnabled ? { scale: 0.95, y: 0 } : {}}
          onClick={onRestart}
          disabled={!restartEnabled}
          className={`px-8 py-4 border-4 rounded-full text-2xl font-black transition-all ${
            restartEnabled
              ? 'bg-gradient-to-b from-amber-300 to-yellow-500 border-white text-amber-950 shadow-[0_7px_0_0_rgba(120,53,15,0.6)]'
              : 'bg-slate-500/50 text-white/60 border-white/40 shadow-none cursor-not-allowed'
          }`}
        >
          {exhausted ? '🔋 版本已燃尽' : (canRestart ? '🔄 再玩一局' : '准备中...')}
        </motion.button>
      </div>

      {/* 会话统计（重置需要二次确认，避免小朋友误触） */}
      <div className="relative z-10 mt-5 flex items-center gap-6 font-body text-sm font-bold text-white bg-white/20 border-2 border-white/60 px-6 py-2 rounded-full">
          <div>本版本已玩 <span className="text-lg font-black tabular-nums">{progress.plays} / {PLAYS_PER_VERSION}</span> 局</div>
          <div className="w-px h-5 bg-white/50" />
          <div>游戏时间 <span className="text-lg font-black">{elapsed}</span> 分钟</div>
          <div className="w-px h-5 bg-white/50" />
          {confirmReset ? (
            <span className="flex items-center gap-2">
              <button onClick={() => { onResetSession(); setConfirmReset(false); }} className="px-3 py-0.5 rounded-full bg-red-500 border-2 border-white font-black">确认重置</button>
              <button onClick={() => setConfirmReset(false)} className="px-3 py-0.5 rounded-full bg-white/30 border-2 border-white/70 font-black">取消</button>
            </span>
          ) : (
            <button onClick={() => setConfirmReset(true)} className="hover:text-amber-200 transition-colors underline underline-offset-4">
              家长重置
            </button>
          )}
      </div>
      </div>
    </motion.div>
  );
};

export default GameOver;
