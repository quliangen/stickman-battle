import React from 'react';
import { Entity, GameStats } from '../types';
import { weaponEmoji, weaponName } from '../services/weaponService';

interface GameUIProps {
  stats: GameStats;
  players: Entity[];
}

// 与 GameCanvas 中的 WEAPON_LIFETIME 保持一致（15 秒 × 60 帧）
const WEAPON_LIFETIME_FRAMES = 15 * 60;

/*
  性能约定：HUD 是每帧都在屏幕上的常驻 UI，主线程已经被游戏 rAF 循环占用。
  因此这里：
  1. 不引入 motion —— 常驻动画全部用 CSS keyframes（见 index.html），跑在合成器线程；
  2. 血条用 transform: scaleX() 而非 width —— transform 不触发 layout / paint；
  3. 组件用 React.memo 包裹，配合 GameCanvas 的"值没变就不 setState"，避免无谓重渲染。
*/
// 图标与名字统一查武器库存档的元数据表（内置 14 种 + 小朋友的自创武器），
// 不在这里另维护一份 switch，不然加武器要改两个地方
const getWeaponIcon = (type: Entity['heldWeapon']) => weaponEmoji(type);
const getWeaponName = (type: Entity['heldWeapon']) => weaponName(type);

const FighterHUD: React.FC<{ player: Entity; align: 'left' | 'right' }> = ({ player, align }) => {
  if (!player) return null;

  const hpPct = Math.max(0, Math.min(1, player.health / player.maxHealth));
  const isDanger = hpPct < 0.3;
  const simpleName = player.id === 'p1' ? '蓝方选手' : '黄方选手';
  const keys = player.id === 'p1' ? 'WASD + 空格' : '方向键 + 回车';
  const durationPct = player.heldWeapon
    ? Math.max(0, Math.min(100, (player.weaponDuration / WEAPON_LIFETIME_FRAMES) * 100))
    : 0;

  const reversed = align === 'right';

  return (
    <div className={`flex flex-col w-[22rem] ${reversed ? 'items-end' : 'items-start'}`}>
      {/* 玩家信息 */}
      <div className={`flex items-center gap-3 mb-2 ${reversed ? 'flex-row-reverse' : 'flex-row'}`}>
        {/*
          性能：武器图标框下方是每帧重绘的 canvas，绝不能加 backdrop-blur ——
          backdrop-filter 会强制 GPU 每合成帧重新采样模糊整个 backdrop，
          叠加 hud-danger 缩放动画后每帧还要重算模糊，是低端 GPU 的头号杀手。
          观感靠半透明底色 + 白描边 + 外发光（box-shadow）维持。
        */}
        <div
          className={`relative w-14 h-14 flex items-center justify-center rounded-2xl border-4 border-white bg-slate-900/60
            ${isDanger ? 'hud-danger' : ''}`}
          style={{ boxShadow: `0 0 22px ${player.color}aa` }}
        >
            <span className="text-3xl drop-shadow">{getWeaponIcon(player.heldWeapon)}</span>
            {/* 武器剩余时间：底部细条（同样用 scaleX 避免 layout） */}
            {player.heldWeapon && (
              <div className="absolute inset-x-1 bottom-1 h-1 rounded-full bg-black/50 overflow-hidden">
                <div
                  className="h-full w-full rounded-full bg-amber-300 origin-left transition-transform duration-200 ease-out"
                  style={{ transform: `scaleX(${durationPct / 100})` }}
                />
              </div>
            )}
        </div>
        <div className={reversed ? 'text-right' : 'text-left'}>
            <div className="font-body text-sm font-bold text-white/75 drop-shadow-md">{keys}</div>
            <div
              className="text-2xl font-black text-white drop-shadow-lg tracking-wider leading-tight"
              style={{ WebkitTextStroke: `1px ${player.color}` }}
            >
                {simpleName}
            </div>
            <div className="font-body text-sm font-bold text-amber-200 drop-shadow-md">
              {getWeaponName(player.heldWeapon)}
            </div>
        </div>
      </div>

      {/* 血条：外层负责圆角裁切，内层用 scaleX 缩放，避免逐帧改 width 触发 layout */}
      <div className="relative w-full h-9 bg-black/60 border-4 border-white/85 rounded-full shadow-2xl overflow-hidden">
         <div
            className="absolute inset-0 origin-left transition-transform duration-200 ease-out"
            style={{
                transform: `scaleX(${hpPct})`,
                background: isDanger
                  ? 'linear-gradient(90deg, #b91c1c, #ef4444, #fca5a5)'
                  : `linear-gradient(90deg, ${player.color}bb, ${player.color})`,
                boxShadow: `0 0 18px ${isDanger ? '#ef4444' : player.color}99`
            }}
         />
         {/* 刻度分段 */}
         <div className="absolute inset-0 flex">
           {Array.from({ length: 5 }).map((_, i) => (
             <div key={i} className="flex-1 border-r-2 border-white/25 last:border-r-0" />
           ))}
         </div>
         {/* 血量数字 */}
         <div className={`absolute inset-y-0 ${reversed ? 'left-3' : 'right-3'} flex items-center`}>
            <span className="text-sm font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] tabular-nums">
              {Math.max(0, Math.ceil(player.health))}
            </span>
         </div>
         {/* 弹药显示 */}
         {player.heldWeapon && (
             <div className={`absolute inset-y-0 ${align === 'left' ? 'right-12' : 'left-12'} flex items-center gap-1.5`}>
                {Array.from({ length: Math.min(player.ammo, 5) }).map((_, i) => (
                    <div key={i} className="w-3 h-3 rounded-full bg-yellow-300 border border-yellow-700 shadow-[0_0_8px_rgba(253,224,71,0.9)]" />
                ))}
                {player.ammo > 5 && <span className="text-sm text-white font-black drop-shadow-md">+{player.ammo - 5}</span>}
             </div>
         )}
      </div>
    </div>
  );
};

const GameUI: React.FC<GameUIProps> = ({ stats, players }) => {
  const minutes = Math.floor(stats.duration / 60).toString().padStart(2, '0');
  const seconds = Math.floor(stats.duration % 60).toString().padStart(2, '0');

  return (
    <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between overflow-hidden">
      {/* 顶部 HUD */}
      <div className="flex justify-between items-start">
        <FighterHUD player={players[0]} align="left" />

        {/* VS & Timer */}
        <div className="flex flex-col items-center pt-1">
            <div
                className="hud-bob text-6xl font-black italic text-transparent bg-clip-text bg-gradient-to-b from-yellow-200 via-amber-400 to-red-500 drop-shadow-[0_4px_0_rgba(0,0,0,0.35)]"
                style={{ WebkitTextStroke: '2px white' }}
            >
                VS
            </div>
            {/* 同上：计时器药丸去掉 backdrop-blur-md，靠底色 + 边框 + 阴影撑观感 */}
            <div className="mt-2 px-6 py-1.5 bg-slate-900/45 border-4 border-white rounded-full shadow-lg">
                <span className="text-white font-black text-2xl tabular-nums drop-shadow-md">
                    {minutes}:{seconds}
                </span>
            </div>
            <div className="mt-2 px-4 py-0.5 bg-white/20 border-2 border-white/60 rounded-full font-body text-sm font-bold text-white">
              {stats.mode === 'PVP' ? '双人对战' : '单人闯关'}
            </div>
        </div>

        <FighterHUD player={players[1]} align="right" />
      </div>

      {/* 底部装饰 */}
      <div className="flex justify-between items-end px-4 pb-2">
        <div className="font-body text-sm font-bold text-white/70 bg-black/20 px-4 py-1 rounded-full">✨ 快乐游戏，健康成长 ✨</div>
        <div className="font-body text-sm font-bold text-white/70 bg-black/20 px-4 py-1 rounded-full">🎮 火柴人大乱斗 🎮</div>
      </div>
    </div>
  );
};

// 只在 HUD 真正需要重绘时重渲染（players / stats 由 GameCanvas 保证"值变才换引用"）
export default React.memo(GameUI);
