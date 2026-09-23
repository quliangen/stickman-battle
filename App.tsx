import React, { useState, useEffect, useRef } from 'react';
import GameCanvas from './components/GameCanvas';
import GameUI from './components/GameUI';
import MainMenu from './components/MainMenu';
import GameOver from './components/GameOver';
import { GameState, GameStats, Entity, GameMode, MapType } from './types';
import { isExhausted, loadProgress, recordPlay, resetProgress, Progress } from './services/progressService';

// 结算界面出现后多久才允许重开（毫秒）。
// 比 GameOver 按钮自身的 1 秒冷却略短，保证按钮一亮就能点。
const RESTART_GRACE_MS = 800;

function App() {
  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [gameMode, setGameMode] = useState<GameMode>('PVE');
  const [map, setMap] = useState<MapType>('neon');
  const [stats, setStats] = useState<GameStats>({ winner: null, mode: 'PVE', duration: 0 });
  const [players, setPlayers] = useState<Entity[]>([]);

  // 版本进度（存 localStorage）：记录当前版本已经玩了几局
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const [sessionStartTime] = useState<number>(() => Date.now());

  // 玩满 PLAYS_PER_VERSION 局就「燃尽」：开局按钮锁住，直到版本号被顶上去
  const exhausted = isExhausted(progress);

  // 进入结算界面的时刻。小朋友打完一局时手还按在键盘上，
  // 没有这段缓冲的话，按住的 R / 回车会在胜利画面刚出现的瞬间就把下一局开起来，
  // 看起来就像「游戏自己重置了」。
  const gameOverAtRef = useRef(0);

  // 每打完一局记一次账。燃尽后不再累加（否则版本一升级，计数会带着旧账继续涨）
  useEffect(() => {
    if (gameState !== GameState.GAME_OVER) return;
    gameOverAtRef.current = Date.now();
    // recordPlay() 会读写 localStorage，是有副作用的，必须放在 updater 外面：
    // StrictMode 下 React 会重复调用 updater 来暴露不纯的更新函数，
    // 写在里面会让每局被记两次账（实测打完一局 plays 直接从 0 跳到 2）。
    const next = recordPlay();
    setProgress(prev => (isExhausted(prev) ? prev : next));
  }, [gameState]);

  const handleRestart = () => {
    // 燃尽期间必须先去升级版本，不给重开
    if (exhausted) return;
    // 结算界面出现后的 1 秒内不接受重开，避开小朋友按住不放的按键
    if (Date.now() - gameOverAtRef.current < RESTART_GRACE_MS) return;
    setGameState(GameState.PLAYING);
  };

  // R 键快捷重开（同样受「燃尽」与冷却约束，且只在结算界面生效）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyR' && !e.repeat && gameState === GameState.GAME_OVER) {
        handleRestart();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gameState, exhausted]);

  const handleMenu = () => {
    setGameState(GameState.MENU);
  };

  // 家长重置：清空存档（局数与版本记录），需要二次确认
  const resetSession = () => {
    setProgress(resetProgress());
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
          map={map}
        />
      </div>

      {/* 游戏 UI 层 (Playing 状态可见) */}
      {(gameState === GameState.PLAYING || gameState === GameState.VICTORY_ANIMATION) && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <GameUI stats={stats} players={players} />
        </div>
      )}

      {/* 菜单层（同样受防沉迷约束：休息期间不能开局） */}
      {gameState === GameState.MENU && (
        <MainMenu
          setGameState={setGameState}
          setGameMode={setGameMode}
          map={map}
          setMap={setMap}
          progress={progress}
          exhausted={exhausted}
        />
      )}

      {/* 游戏结束层 */}
      {gameState === GameState.GAME_OVER && (
        <GameOver
          stats={stats}
          onRestart={handleRestart}
          onMenu={handleMenu}
          progress={progress}
          exhausted={exhausted}
          sessionStartTime={sessionStartTime}
          onResetSession={resetSession}
        />
      )}
    </div>
  );
}

export default App;