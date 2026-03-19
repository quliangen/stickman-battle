import React from 'react';
import { motion } from 'motion/react';
import { Entity, GameStats, WeaponType } from '../types';

interface GameUIProps {
  stats: GameStats;
  players: Entity[];
}

const getWeaponIcon = (type: WeaponType | null | undefined) => {
    switch(type) {
        case 'sword': return '⚔️';
        case 'bomb': return '💣';
        case 'atom_bomb': return '☢️';
        case 'missile': return '🚀';
        case 'dragon': return '🐉';
        case 'bomber': return '🛩️';
        case 'pokemon': return '⚡';
        case 'laser': return '🚨';
        case 'zeperion': return '✨';
        default: return '👊';
    }
};

const FighterHUD: React.FC<{ player: Entity; align: 'left' | 'right' }> = ({ player, align }) => {
  if (!player) return null;
  
  const hpPct = Math.max(0, (player.health / player.maxHealth) * 100);
  const isDanger = hpPct < 30;
  const simpleName = player.id === 'p1' ? '蓝方选手' : '黄方选手';
  const keys = player.id === 'p1' ? 'WASD + 空格' : '方向键 + 回车';

  return (
    <div className={`flex flex-col w-80 ${align === 'right' ? 'items-end' : 'items-start'}`}>
      {/* 玩家信息 */}
      <div className={`flex items-center gap-3 mb-2 ${align === 'right' ? 'flex-row-reverse' : 'flex-row'}`}>
        <div 
          className="w-12 h-12 flex items-center justify-center rounded-2xl border-4 border-white bg-black/40 backdrop-blur-sm shadow-lg"
          style={{ boxShadow: `0 0 20px ${player.color}88` }}
        >
            <span className="text-3xl">{getWeaponIcon(player.heldWeapon)}</span>
        </div>
        <div>
            <div className={`text-sm font-bold text-white/80 drop-shadow-md ${align === 'right' ? 'text-right' : 'text-left'}`}>
                {keys}
            </div>
            <div className="text-3xl font-black text-white drop-shadow-lg tracking-wider" style={{ WebkitTextStroke: `1px ${player.color}` }}>
                {simpleName}
            </div>
        </div>
      </div>

      {/* 血条 */}
      <div className="w-full h-8 bg-black/60 border-4 border-white/80 rounded-full overflow-hidden relative shadow-2xl">
         <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${hpPct}%` }}
            className={`h-full transition-colors duration-500 ${isDanger ? 'bg-red-500' : ''}`}
            style={{ 
                backgroundColor: isDanger ? undefined : player.color,
                boxShadow: `0 0 20px ${isDanger ? '#ef4444' : player.color}88`
            }}
         />
         {/* 弹药显示 */}
         {player.heldWeapon && (
             <div className={`absolute top-0 ${align === 'left' ? 'right-3' : 'left-3'} h-full flex items-center gap-1.5`}>
                {Array.from({ length: Math.min(player.ammo, 5) }).map((_, i) => (
                    <div key={i} className="w-3 h-3 rounded-full bg-yellow-300 border border-yellow-600 shadow-[0_0_8px_yellow]" />
                ))}
                {player.ammo > 5 && <span className="text-sm text-white font-black drop-shadow-md">+{player.ammo - 5}</span>}
             </div>
         )}
      </div>
    </div>
  );
};

const GameUI: React.FC<GameUIProps> = ({ stats, players }) => {
  return (
    <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between overflow-hidden">
      {/* 顶部 HUD */}
      <div className="flex justify-between items-start">
        <FighterHUD player={players[0]} align="left" />
        
        {/* VS & Timer */}
        <div className="flex flex-col items-center">
            <motion.div 
                animate={{ scale: [1, 1.2, 1], rotate: [-5, 5, -5] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="text-7xl font-black italic text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 to-red-500 drop-shadow-[0_5px_5px_rgba(239,68,68,0.8)]"
                style={{ WebkitTextStroke: '2px white' }}
            >
                VS
            </motion.div>
            <div className="mt-2 px-6 py-2 bg-white/20 backdrop-blur-md border-4 border-white rounded-full shadow-lg">
                <span className="text-white font-black text-2xl drop-shadow-md">
                    {Math.floor(stats.duration / 60).toString().padStart(2, '0')}:
                    {Math.floor(stats.duration % 60).toString().padStart(2, '0')}
                </span>
            </div>
        </div>

        <FighterHUD player={players[1]} align="right" />
      </div>

      {/* 底部装饰 */}
      <div className="flex justify-between items-end px-4 pb-2">
        <div className="text-sm text-white/60 font-bold drop-shadow-md">✨ 快乐游戏，健康成长 ✨</div>
        <div className="text-sm text-white/60 font-bold drop-shadow-md">🎮 火柴人大乱斗 🎮</div>
      </div>
    </div>
  );
};

export default GameUI;
