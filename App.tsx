import React, { useState, useEffect } from 'react';
import GameCanvas from './components/GameCanvas';
import GameUI from './components/GameUI';
import MainMenu from './components/MainMenu';
import GameOver from './components/GameOver';
import { GameState, GameStats, Entity, GameMode } from './types';

function App() {
  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [gameMode, setGameMode] = useState<GameMode>('PVE');
  const [stats, setStats] = useState<GameStats>({ winner: null, mode: 'PVE', duration: 0 });
  const [players, setPlayers] = useState<Entity[]>([]);
  
  // 防沉迷统计
  const [sessionGameCount, setSessionGameCount] = useState<number>(0); 
  const [sessionStartTime, setSessionStartTime] = useState<number>(Date.now());
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);

  // 使用 useEffect 监听游戏结束状态，确保计数逻辑准确执行
  useEffect(() => {
    if (gameState === GameState.GAME_OVER) {
      setSessionGameCount(prevCount => {
        const newCount = prevCount + 1;
        console.log(`当前局数: ${newCount}`); // Debug Log
        
        // 防沉迷检查：每3局休息10分钟
        if (newCount > 0 && newCount % 3 === 0) {
            console.log("触发防沉迷锁定");
            setLockoutUntil(Date.now() + 10 * 60 * 1000); // 10分钟
        }
        return newCount;
      });
    }
  }, [gameState]);

  const handleRestart = () => {
    // 再次检查防沉迷
    if (lockoutUntil && Date.now() < lockoutUntil) return;
    setGameState(GameState.PLAYING);
  };

  const handleMenu = () => {
    setGameState(GameState.MENU);
  };

  const resetSession = () => {
      setSessionGameCount(0);
      setSessionStartTime(Date.now());
      setLockoutUntil(null);
  };

  return (
    <div className="relative w-screen h-screen bg-gray-900 overflow-hidden">
      {/* 游戏渲染层 */}
      <div className="absolute inset-0 z-10">
        <GameCanvas 
          gameState={gameState} 
          setGameState={setGameState}
          setStats={setStats}
          setPlayers={setPlayers}
          gameMode={gameMode}
        />
      </div>

      {/* 游戏 UI 层 (Playing 状态可见) */}
      {(gameState === GameState.PLAYING || gameState === GameState.VICTORY_ANIMATION) && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <GameUI stats={stats} players={players} />
        </div>
      )}

      {/* 菜单层 */}
      {gameState === GameState.MENU && (
        <MainMenu setGameState={setGameState} setGameMode={setGameMode} />
      )}

      {/* 游戏结束层 */}
      {gameState === GameState.GAME_OVER && (
        <GameOver 
          stats={stats} 
          onRestart={handleRestart} 
          onMenu={handleMenu}
          sessionGameCount={sessionGameCount}
          sessionStartTime={sessionStartTime}
          onResetSession={resetSession}
          lockoutUntil={lockoutUntil}
        />
      )}
    </div>
  );
}

export default App;