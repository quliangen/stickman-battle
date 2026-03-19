import React from 'react';
import { motion } from 'motion/react';
import { GameState, GameMode } from '../types';

interface MainMenuProps {
  setGameState: (state: GameState) => void;
  setGameMode: (mode: GameMode) => void;
}

const KidButton: React.FC<{ onClick: () => void; color: 'blue' | 'yellow'; children: React.ReactNode; subText: string; icon: string }> = ({ onClick, color, children, subText, icon }) => {
  const bgColors = color === 'blue' ? 'bg-blue-500 hover:bg-blue-400' : 'bg-yellow-500 hover:bg-yellow-400';
  const shadowColors = color === 'blue' ? 'shadow-blue-600' : 'shadow-yellow-600';

  return (
    <motion.button 
      whileHover={{ scale: 1.05, y: -5 }}
      whileTap={{ scale: 0.95, y: 0 }}
      onClick={onClick} 
      className={`group relative w-full h-28 ${bgColors} rounded-3xl mb-6 flex items-center justify-center border-4 border-white shadow-[0_8px_0_0] ${shadowColors} transition-all`}
    >
      <div className="flex items-center gap-4">
        <span className="text-5xl">{icon}</span>
        <div className="flex flex-col items-start">
          <span className="text-4xl font-black text-white tracking-wider drop-shadow-md">
            {children}
          </span>
          <span className="text-lg font-bold text-white/90 mt-1">
            {subText}
          </span>
        </div>
      </div>
    </motion.button>
  );
};

const MainMenu: React.FC<MainMenuProps> = ({ setGameState, setGameMode }) => {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-sky-300 text-white overflow-hidden p-8"
    >
      {/* 背景装饰：云朵和星星 */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div 
          animate={{ x: [0, 100, 0] }} 
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-10 left-10 text-8xl opacity-50"
        >☁️</motion.div>
        <motion.div 
          animate={{ x: [0, -100, 0] }} 
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-40 right-20 text-8xl opacity-50"
        >☁️</motion.div>
        <motion.div 
          animate={{ rotate: 360 }} 
          transition={{ duration: 50, repeat: Infinity, ease: "linear" }}
          className="absolute -top-20 -right-20 text-[200px] opacity-80"
        >☀️</motion.div>
      </div>

      <div className="relative z-10 w-full max-w-2xl flex flex-col items-center">
        <motion.div
          initial={{ y: -50, opacity: 0, scale: 0.8 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ type: "spring", bounce: 0.5, delay: 0.2 }}
          className="text-center mb-12"
        >
          <div className="text-2xl font-bold text-yellow-300 mb-2 drop-shadow-md">✨ 超级好玩的 ✨</div>
          <h1 className="text-7xl font-black text-white drop-shadow-[0_8px_8px_rgba(0,0,0,0.3)] tracking-widest mb-4" style={{ WebkitTextStroke: '3px #2563eb' }}>
            火柴人<br/>大乱斗
          </h1>
        </motion.div>

        <div className="flex flex-col w-full max-w-md gap-4">
          <KidButton 
            color="blue" 
            icon="🤖"
            subText="一个人玩，打败电脑！"
            onClick={() => { setGameMode('PVE'); setGameState(GameState.PLAYING); }}
          >
            单人闯关
          </KidButton>

          <KidButton 
            color="yellow" 
            icon="🧑‍🤝‍🧑"
            subText="和小伙伴一起玩！"
            onClick={() => { setGameMode('PVP'); setGameState(GameState.PLAYING); }}
          >
            双人对战
          </KidButton>
        </div>

        {/* 底部按键提示 */}
        <motion.div 
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-12 flex gap-12 bg-white/20 p-6 rounded-3xl backdrop-blur-sm border-2 border-white/50"
        >
          <div className="flex flex-col items-center gap-2">
            <div className="text-xl font-bold text-blue-900 bg-blue-200 px-4 py-1 rounded-full">玩家 1 (蓝)</div>
            <div className="text-lg font-black text-white drop-shadow-md">移动: W A S D</div>
            <div className="text-lg font-black text-white drop-shadow-md">攻击: 空格键</div>
          </div>
          <div className="w-1 bg-white/30 rounded-full"></div>
          <div className="flex flex-col items-center gap-2">
            <div className="text-xl font-bold text-yellow-900 bg-yellow-200 px-4 py-1 rounded-full">玩家 2 (黄)</div>
            <div className="text-lg font-black text-white drop-shadow-md">移动: ⬆️ ⬇️ ⬅️ ➡️</div>
            <div className="text-lg font-black text-white drop-shadow-md">攻击: 回车键</div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

export default MainMenu;
