import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GameState, GameStats } from '../types';
import { getTacticalAnalysis } from '../services/geminiService';

interface GameOverProps {
  stats: GameStats;
  onRestart: () => void;
  onMenu: () => void;
  sessionGameCount: number;
  sessionStartTime: number;
  onResetSession: () => void;
  lockoutUntil: number | null;
}

const GameOver: React.FC<GameOverProps> = ({ stats, onRestart, onMenu, sessionGameCount, sessionStartTime, onResetSession, lockoutUntil }) => {
  const [analysis, setAnalysis] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [canRestart, setCanRestart] = useState(false);
  const [timeLeft, setTimeLeft] = useState<string>("");

  useEffect(() => {
    const timer = setTimeout(() => {
        if (!lockoutUntil || Date.now() > lockoutUntil) {
            setCanRestart(true);
        }
    }, 1000);

    let isMounted = true;
    getTacticalAnalysis(stats).then(text => {
      if (isMounted) {
        setAnalysis(text);
        setLoading(false);
      }
    });

    const interval = setInterval(() => {
        if (lockoutUntil) {
            const diff = lockoutUntil - Date.now();
            if (diff > 0) {
                const m = Math.floor(diff / 60000);
                const s = Math.floor((diff % 60000) / 1000);
                setTimeLeft(`${m}:${s.toString().padStart(2, '0')}`);
                setCanRestart(false);
            } else {
                setTimeLeft("");
                setCanRestart(true);
            }
        }
    }, 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      isMounted = false;
    };
  }, [stats, lockoutUntil]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-sky-400/90 backdrop-blur-md text-white p-8"
    >
      {/* 胜利者展示 */}
      <motion.div 
        initial={{ scale: 0.8, y: -20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", bounce: 0.5 }}
        className="text-center mb-8"
      >
        <div className="text-2xl font-bold text-yellow-300 mb-2 drop-shadow-md">🎉 比赛结束啦 🎉</div>
        <h2 className="text-7xl font-black text-white drop-shadow-[0_5px_5px_rgba(0,0,0,0.2)] tracking-widest" style={{ WebkitTextStroke: '2px #2563eb' }}>
            {stats.winner === 'P1' ? '蓝方 胜利！' : (stats.winner === 'P2' ? '黄方 胜利！' : '平局！')}
        </h2>
      </motion.div>
      
      {/* AI 分析卡片 */}
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="bg-white border-4 border-blue-300 p-6 rounded-3xl max-w-2xl w-full mb-8 shadow-xl relative overflow-hidden"
      >
        <h3 className="text-xl font-bold text-blue-500 mb-3 flex items-center gap-2">
           🤖 裁判点评
           {loading && <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, ease: "linear" }}>⏳</motion.span>}
        </h3>
        <p className={`text-lg leading-relaxed font-medium ${loading ? 'animate-pulse text-gray-400' : 'text-gray-700'}`}>
          {loading ? "正在思考刚才的精彩瞬间..." : analysis}
        </p>
      </motion.div>

      {/* 防沉迷提示 */}
      <AnimatePresence>
        {lockoutUntil && timeLeft && (
            <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mb-8 p-6 bg-red-100 border-4 border-red-400 rounded-3xl text-center w-full max-w-md shadow-lg"
            >
                <h4 className="text-xl font-bold text-red-600 mb-2">⏰ 休息时间到啦！</h4>
                <p className="text-lg text-red-500 mb-2">保护眼睛，去看看远方吧~</p>
                <p className="text-4xl font-black text-red-600 drop-shadow-sm">{timeLeft}</p>
            </motion.div>
        )}
      </AnimatePresence>

      {/* 交互按钮 */}
      <div className="flex gap-6">
        <motion.button 
          whileHover={{ scale: 1.05, y: -2 }}
          whileTap={{ scale: 0.95, y: 0 }}
          onClick={onMenu}
          className="px-8 py-4 bg-blue-500 hover:bg-blue-400 border-4 border-white shadow-[0_6px_0_0] shadow-blue-700 rounded-full text-2xl font-black text-white transition-all"
        >
          🏠 回到主页
        </motion.button>
        <motion.button 
          whileHover={canRestart ? { scale: 1.05, y: -2 } : {}}
          whileTap={canRestart ? { scale: 0.95, y: 0 } : {}}
          onClick={onRestart}
          disabled={!canRestart}
          className={`px-8 py-4 border-4 border-white rounded-full text-2xl font-black transition-all ${
            canRestart 
              ? 'bg-yellow-400 hover:bg-yellow-300 text-white shadow-[0_6px_0_0] shadow-yellow-600' 
              : 'bg-gray-300 text-gray-500 border-gray-400 shadow-none cursor-not-allowed'
          }`}
        >
          {timeLeft ? `休息中 (${timeLeft})` : (canRestart ? '🔄 再玩一局' : '准备中...')}
        </motion.button>
      </div>
      
      {/* 会话统计 */}
      <div className="mt-12 flex gap-8 text-sm font-bold text-blue-800 bg-white/40 px-6 py-2 rounded-full">
          <div>已经玩了: <span className="text-blue-900">{sessionGameCount} 局</span></div>
          <div>游戏时间: <span className="text-blue-900">{Math.floor((Date.now() - sessionStartTime)/60000)} 分钟</span></div>
          <button onClick={onResetSession} className="hover:text-blue-600 transition-colors underline underline-offset-4">重置时间</button>
      </div>
    </motion.div>
  );
};

export default GameOver;
