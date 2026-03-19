import React, { useRef, useEffect, useCallback } from 'react';
import { GameState, Entity, Vector, Particle, GameStats, GameMode, FallingItem, Projectile, WeaponType, Platform } from '../types';
import { playJumpSound, playAttackSound, playHitSound, playShootSound, playExplodeSound, playDragonRoar } from '../services/audioService';

interface GameCanvasProps {
  gameState: GameState;
  setGameState: (state: GameState) => void;
  setStats: React.Dispatch<React.SetStateAction<GameStats>>;
  setPlayers: (players: Entity[]) => void;
  gameMode: GameMode;
}

// === 物理参数 (提速版) ===
const GRAVITY = 0.8; 
const FRICTION = 0.82; 
const MOVE_SPEED = 2; 
const JUMP_FORCE = -22; 
const GROUND_Y = 600;
const ATTACK_COOLDOWN = 18; 
const ATTACK_RANGE = 100;
const ATTACK_DAMAGE = 8;

// === 武器生成配置 ===
const MAX_WEAPONS_PER_GAME = 6; 
const WEAPON_SPAWN_INTERVAL = 900; 
const WEAPON_LIFETIME = 15 * 60; 

// === 关卡设计 ===
const PLATFORMS: Platform[] = [
    { x: 300, y: 450, width: 200, height: 20 },
    { x: 800, y: 450, width: 200, height: 20 },
    { x: 500, y: 250, width: 300, height: 20 } 
];

const drawEntity = (ctx: CanvasRenderingContext2D, entity: Entity) => {
    ctx.save();
    
    const centerX = entity.pos.x;
    const centerY = entity.pos.y; // Feet position

    ctx.translate(centerX, centerY);
    
    if (entity.isDead) {
         ctx.rotate(Math.PI / 2 * (entity.facingRight ? 1 : -1));
         ctx.translate(0, -10);
    }

    if (!entity.facingRight) ctx.scale(-1, 1);

    ctx.scale(1.3, 1.3); // 放大 1.3 倍

    // Draw body
    ctx.fillStyle = entity.color;
    ctx.strokeStyle = entity.color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const crouchOffset = entity.isCrouching ? 20 : 0;
    
    // Head
    ctx.beginPath();
    ctx.arc(0, -entity.height + 20 + crouchOffset, 12, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.moveTo(0, -entity.height + 32 + crouchOffset);
    ctx.lineTo(0, -25 + crouchOffset);
    ctx.stroke();

    // Legs
    ctx.beginPath();
    ctx.moveTo(0, -25 + crouchOffset);
    if (entity.isCrouching) {
        ctx.lineTo(-15, -5);
        ctx.moveTo(0, -25 + crouchOffset);
        ctx.lineTo(15, -5);
    } else if (Math.abs(entity.vel.x) > 0.1 && entity.isGrounded) {
        const walkCycle = Math.sin(Date.now() / 100) * 10;
        ctx.lineTo(-10 + walkCycle, 0);
        ctx.moveTo(0, -25 + crouchOffset);
        ctx.lineTo(10 - walkCycle, 0);
    } else {
        ctx.lineTo(-10, 0);
        ctx.moveTo(0, -25 + crouchOffset);
        ctx.lineTo(10, 0);
    }
    ctx.stroke();

    // Arms
    ctx.beginPath();
    const shoulderY = -entity.height + 40 + crouchOffset;
    ctx.moveTo(0, shoulderY);

    if (entity.isWinner) {
        ctx.lineTo(-20, shoulderY - 30);
        ctx.moveTo(0, shoulderY);
        ctx.lineTo(20, shoulderY - 30);
    } else if (entity.isAttacking) {
        const attackProgress = entity.attackFrame / 15;
        ctx.lineTo(25, shoulderY - 10 + attackProgress * 20);
    } else if (entity.heldWeapon) {
        ctx.lineTo(15, shoulderY + 5);
        
        ctx.save();
        ctx.translate(15, shoulderY + 5);
        
        if (entity.heldWeapon === 'sword') {
            ctx.fillStyle = '#ccc';
            ctx.fillRect(0, -25, 4, 30);
            ctx.fillStyle = '#8B4513';
            ctx.fillRect(-3, 0, 10, 2);
        } else if (entity.heldWeapon === 'bomb' || entity.heldWeapon === 'atom_bomb') {
            ctx.fillStyle = '#000';
            ctx.beginPath();
            ctx.arc(5, 0, 8, 0, Math.PI*2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(5, -8);
            ctx.quadraticCurveTo(10, -15, 15, -10);
            ctx.stroke();
             if (entity.heldWeapon === 'atom_bomb') {
                ctx.fillStyle = 'yellow';
                ctx.font = '10px Arial';
                ctx.fillText('☢', 2, 4);
            }
        } else if (entity.heldWeapon === 'missile') {
             ctx.fillStyle = 'green';
             ctx.fillRect(0, -5, 20, 10);
             ctx.fillStyle = 'red';
             ctx.fillRect(20, -5, 5, 10);
        } else if (entity.heldWeapon === 'dragon') {
             ctx.font = '20px serif';
             ctx.fillText('🐉', 0, 5);
        } else if (entity.heldWeapon === 'bomber') {
             // 无线电/对讲机外观
             ctx.fillStyle = '#333';
             ctx.fillRect(0, -10, 10, 16);
             ctx.fillStyle = '#000';
             ctx.fillRect(2, -15, 2, 5); // 天线
             ctx.fillStyle = '#f00';
             ctx.beginPath(); ctx.arc(5, -5, 2, 0, Math.PI*2); ctx.fill(); // 信号灯
        } else if (entity.heldWeapon === 'pokemon') {
            // 精灵球
            ctx.fillStyle = 'red'; ctx.beginPath(); ctx.arc(0,0,6, Math.PI, 0); ctx.fill();
            ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(0,0,6, 0, Math.PI); ctx.fill();
            ctx.fillStyle = 'black'; ctx.fillRect(-6, -1, 12, 2);
            ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(0,0,2, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = 'black'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0,0,2, 0, Math.PI*2); ctx.stroke();
        } else if (entity.heldWeapon === 'laser') {
            // 激光枪外观
            ctx.fillStyle = '#444';
            ctx.fillRect(0, -5, 15, 8);
            ctx.fillStyle = '#f00';
            ctx.fillRect(15, -4, 3, 6); // 枪口
            ctx.fillStyle = '#666';
            ctx.fillRect(2, 3, 4, 6); // 握把
        } else if (entity.heldWeapon === 'zeperion') {
            // 哉佩利敖光线发射器外观（类似手腕发光装置）
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, -4, 12, 6);
            ctx.fillStyle = '#fbbf24'; // 金色
            ctx.fillRect(12, -3, 4, 4);
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#fbbf24';
            ctx.beginPath(); ctx.arc(14, -1, 3, 0, Math.PI*2); ctx.fill();
            ctx.shadowBlur = 0;
        }
        ctx.restore();

    } else {
        if (Math.abs(entity.vel.x) > 0.1) {
             const armCycle = Math.cos(Date.now() / 100) * 10;
             ctx.lineTo(armCycle, shoulderY + 15);
        } else {
             ctx.lineTo(0, shoulderY + 20);
        }
    }
    ctx.stroke();

    ctx.restore();
};

const GameCanvas: React.FC<GameCanvasProps> = ({ gameState, setGameState, setStats, setPlayers, gameMode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>();
  const frameRef = useRef<number>(0);
  
  const entitiesRef = useRef<Entity[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const fallingItemsRef = useRef<FallingItem[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  
  // 武器生成控制
  const spawnedWeaponCountRef = useRef<number>(0); 
  const atomBombIndexRef = useRef<number>(-1); 
  const missileIndexRef = useRef<number>(-1); 
  const dragonIndexRef = useRef<number>(-1); 
  
  const keysRef = useRef<Set<string>>(new Set());
  const statsRef = useRef<GameStats>({ winner: null, mode: gameMode, duration: 0 });
  const shakeRef = useRef<number>(0);
  const flashRef = useRef<number>(0); 

  // 初始化对决
  const initGame = useCallback(() => {
    const newEntities: Entity[] = [];

    // P1 (左侧)
    newEntities.push({
      id: 'p1', type: 'player', playerIndex: 0,
      pos: { x: 100, y: 100 }, vel: { x: 0, y: 0 }, 
      width: 52, height: 91, color: '#3b82f6', 
      isGrounded: false, isCrouching: false, health: 100, maxHealth: 100, isDead: false,
      facingRight: true, attackCooldown: 0, isAttacking: false, attackFrame: 0,
      heldWeapon: null, ammo: 0, weaponDuration: 0, stunFrames: 0
    });

    // P2/CPU (右侧)
    newEntities.push({
      id: 'p2', type: 'player', playerIndex: 1,
      pos: { x: window.innerWidth - 100, y: 100 }, vel: { x: 0, y: 0 },
      width: 52, height: 91, color: '#facc15',
      isGrounded: false, isCrouching: false, health: 100, maxHealth: 100, isDead: false,
      facingRight: false, attackCooldown: 0, isAttacking: false, attackFrame: 0,
      heldWeapon: null, ammo: 0, weaponDuration: 0, stunFrames: 0
    });

    entitiesRef.current = newEntities;
    particlesRef.current = [];
    fallingItemsRef.current = [];
    projectilesRef.current = [];
    spawnedWeaponCountRef.current = 0; 
    
    const indices = Array.from({length: MAX_WEAPONS_PER_GAME}, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    atomBombIndexRef.current = indices[0];
    missileIndexRef.current = indices[1];
    dragonIndexRef.current = indices[2]; 

    statsRef.current = { winner: null, mode: gameMode, duration: 0 };
    frameRef.current = 0;
    shakeRef.current = 0;
    flashRef.current = 0;
    
    setStats(statsRef.current);
    setPlayers([...entitiesRef.current]);
  }, [gameMode, setStats, setPlayers]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.repeat) return;
        keysRef.current.add(e.code);
        if (e.code === 'KeyR' && gameState === GameState.GAME_OVER) {
             setGameState(GameState.PLAYING);
        }
    };
    const handleKeyUp = (e: KeyboardEvent) => keysRef.current.delete(e.code);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState, setGameState]);

  useEffect(() => {
    if (gameState === GameState.PLAYING) {
      initGame();
    }
  }, [gameState, initGame]);

  const spawnParticles = (x: number, y: number, color: string, count: number, speed = 8, lifeMultiplier = 1, baseSize = 3) => {
      for(let i=0; i<count; i++) {
          particlesRef.current.push({
              id: Math.random().toString(),
              pos: {x, y},
              vel: { x: (Math.random() - 0.5) * speed, y: (Math.random() - 0.5) * speed },
              life: (20 + Math.random() * 20) * lifeMultiplier,
              maxLife: 40 * lifeMultiplier,
              color: color,
              size: Math.random() * baseSize + 1,
              gravity: 0.5 
          });
      }
  };

  const spawnMushroomCloud = (x: number, y: number) => {
    // 1. 蘑菇柄 (上升的烟柱)
    for (let i = 0; i < 20; i++) {
      particlesRef.current.push({
        id: Math.random().toString(),
        pos: { x: x + (Math.random()-0.5)*20, y: y },
        vel: { x: (Math.random()-0.5) * 1, y: -2 - Math.random() * 3 },
        life: 180,
        maxLife: 180,
        color: i % 2 === 0 ? '#555' : '#333',
        size: 15 + Math.random() * 10,
        gravity: -0.05, // 轻微上升
        growth: 0.3, // 膨胀
        alphaDecay: 0.005,
        currentAlpha: 0.8
      });
    }

    // 2. 蘑菇盖 (顶部扩散)
    for (let i = 0; i < 40; i++) {
      const angle = (Math.PI / 40) * i * 2; // 360度
      const speed = 2 + Math.random() * 3;
      particlesRef.current.push({
        id: Math.random().toString(),
        pos: { x: x, y: y - 80 },
        vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed * 0.5 - 1 },
        life: 200,
        maxLife: 200,
        color: Math.random() > 0.5 ? '#ff4500' : '#ff8800', // 橙红火光
        size: 20 + Math.random() * 10,
        gravity: -0.02,
        growth: 0.5, // 快速膨胀
        alphaDecay: 0.008,
        currentAlpha: 0.9
      });
    }
    
    // 3. 底部冲击波 (贴地尘土)
    for (let i = 0; i < 30; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        particlesRef.current.push({
            id: Math.random().toString(),
            pos: { x: x, y: y },
            vel: { x: dir * (5 + Math.random()*10), y: -1 },
            life: 100, maxLife: 100,
            color: '#777',
            size: 10,
            gravity: 0,
            growth: 0.8,
            alphaDecay: 0.02,
            currentAlpha: 0.6
        });
    }
  };

  const spawnConfetti = (width: number) => {
      const colors = ['#FFD700', '#FF6347', '#00BFFF', '#32CD32', '#FF69B4', '#FFFFFF'];
      const x = Math.random() * width;
      const y = -10; 
      const color = colors[Math.floor(Math.random() * colors.length)];
      particlesRef.current.push({
          id: Math.random().toString(),
          pos: { x, y },
          vel: { x: (Math.random() - 0.5) * 2, y: Math.random() * 2 + 1 },
          life: 200, maxLife: 200, color, size: Math.random() * 4 + 3, gravity: 0.02 
      });
  };

  const spawnFallingItem = (canvasWidth: number) => {
      let type: WeaponType;
      
      const count = spawnedWeaponCountRef.current;
      
      if (count === atomBombIndexRef.current) {
          type = 'atom_bomb';
      } else if (count === missileIndexRef.current) {
          type = 'missile';
      } else if (count === dragonIndexRef.current) {
          type = 'dragon';
      } else {
          // 移除 pistol, 加入 pokemon, bomber, laser, zeperion
          const normalPool: WeaponType[] = ['bomb', 'sword', 'bomber', 'pokemon', 'laser', 'zeperion'];
          type = normalPool[Math.floor(Math.random() * normalPool.length)];
      }
      
      fallingItemsRef.current.push({
          id: Math.random().toString() + "_" + Date.now(),
          type,
          pos: { x: 100 + Math.random() * (canvasWidth - 200), y: -50 },
          vel: { x: (Math.random() - 0.5) * 2, y: 2 },
          width: 30, height: 30,
          onGround: false
      });
      spawnedWeaponCountRef.current++;
  };

  const update = () => {
    if (gameState !== GameState.PLAYING && gameState !== GameState.VICTORY_ANIMATION) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    frameRef.current++;
    if (shakeRef.current > 0) shakeRef.current--;
    if (flashRef.current > 0) flashRef.current -= 0.02; 
    if (gameState === GameState.PLAYING) statsRef.current.duration += 1/60;

    const triggerWin = (winnerId: string) => {
        if (statsRef.current.winner) return;
        const winner = entitiesRef.current.find(e => e.id === winnerId);
        if (winner) winner.isWinner = true;
        statsRef.current.winner = winnerId === 'p1' ? 'P1' : 'P2';
        setGameState(GameState.VICTORY_ANIMATION);
        setTimeout(() => setGameState(GameState.GAME_OVER), 4000);
    };

    // === 0. 掉落物生成 ===
    if (gameState === GameState.PLAYING && 
        spawnedWeaponCountRef.current < MAX_WEAPONS_PER_GAME && 
        frameRef.current > 60 && 
        frameRef.current % WEAPON_SPAWN_INTERVAL === 0) {
        spawnFallingItem(canvas.width);
    }

    // === 1. 掉落物逻辑 ===
    fallingItemsRef.current.forEach(item => {
        item.vel.y += 0.2; 
        if (item.vel.y > 8) item.vel.y = 8;
        
        const prevY = item.pos.y;
        item.pos.x += item.vel.x;
        item.pos.y += item.vel.y;

        if (item.pos.y >= GROUND_Y - item.height) {
            item.pos.y = GROUND_Y - item.height;
            item.onGround = true;
            item.vel.y = -item.vel.y * 0.5;
            item.vel.x *= 0.8;
        }

        if (item.vel.y > 0) {
            PLATFORMS.forEach(plat => {
                if (item.pos.x + item.width > plat.x && item.pos.x < plat.x + plat.width) {
                    if (prevY + item.height <= plat.y && item.pos.y + item.height >= plat.y) {
                        item.pos.y = plat.y - item.height;
                        item.onGround = true;
                        item.vel.y = -item.vel.y * 0.5;
                        item.vel.x *= 0.8;
                    }
                }
            });
        }
    });

    // === 2. 投射物逻辑 (炸弹、导弹、神龙、轰炸机、宝可梦、哉佩利敖光线) ===
    projectilesRef.current.forEach(proj => {
        if (!proj.active) return;
        
        // --- 哉佩利敖光线爆炸逻辑 ---
        if (proj.type === 'zeperion') {
            if (proj.zeperionLife === undefined) proj.zeperionLife = 0;
            if (proj.zeperionMaxLife === undefined) proj.zeperionMaxLife = 40;
            
            proj.zeperionLife++;
            
            if (proj.zeperionState === 'growing') {
                if (proj.zeperionLife > 15) {
                    proj.zeperionState = 'exploding';
                    playExplodeSound();
                    shakeRef.current = 40; // 大爆炸抖动
                    // 满天星火
                    for(let i=0; i<50; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const speed = 5 + Math.random() * 15;
                        particlesRef.current.push({
                            id: Math.random().toString(),
                            pos: { x: proj.pos.x, y: proj.pos.y },
                            vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
                            life: 40 + Math.random() * 20,
                            maxLife: 60,
                            color: Math.random() > 0.5 ? '#fbbf24' : '#ef4444',
                            size: 3 + Math.random() * 5,
                            gravity: 0.2
                        });
                    }
                }
            } else if (proj.zeperionState === 'exploding') {
                if (proj.zeperionLife >= proj.zeperionMaxLife) {
                    proj.active = false;
                }
            }
            return;
        }

        // --- 宝可梦逻辑 (Pikachu) ---
        if (proj.type === 'pokemon') {
            const target = entitiesRef.current.find(e => e.id !== proj.ownerId && !e.isDead);
            
            if (proj.pokemonState === 'seeking') {
                if (target) {
                    const dx = target.pos.x - proj.pos.x;
                    const dy = (target.pos.y - 40) - proj.pos.y;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    
                    // 飞向敌人
                    proj.vel.x = (proj.vel.x * 20 + (dx / dist) * 12) / 21;
                    proj.vel.y = (proj.vel.y * 20 + (dy / dist) * 12) / 21;
                    
                    // 靠近后攻击
                    if (dist < 150) {
                        proj.pokemonState = 'attacking';
                        proj.attackTimer = 0;
                        proj.vel = { x: 0, y: 0 }; // 悬停攻击
                    }
                } else {
                    // 没目标就乱跑
                    proj.vel.x *= 0.9;
                    proj.vel.y *= 0.9;
                }
                
                proj.pos.x += proj.vel.x;
                proj.pos.y += proj.vel.y;
            } else if (proj.pokemonState === 'attacking') {
                if (proj.attackTimer === undefined) proj.attackTimer = 0;
                proj.attackTimer++;
                
                // 播放音效
                if (proj.attackTimer % 5 === 0) playDragonRoar(); // 借用龙吼的电流声
                shakeRef.current = 5;

                // 造成一次伤害
                if (proj.attackTimer === 20) {
                     if (target && !target.isDead) {
                         target.health -= 20;
                         target.stunFrames = 40; // 麻痹效果
                         playExplodeSound();
                         shakeRef.current = 10;
                         spawnParticles(target.pos.x, target.pos.y - 30, '#ffff00', 30, 10);
                         
                         if (target.health <= 0) {
                            target.health = 0;
                            target.isDead = true;
                            target.isLoser = true;
                            triggerWin(proj.ownerId);
                         }
                     }
                }

                // 攻击结束
                if (proj.attackTimer > 40) {
                    proj.active = false;
                    spawnParticles(proj.pos.x, proj.pos.y, '#fff', 10, 5); // 消失
                }
            }
            return;
        }

        // --- 轰炸机逻辑 ---
        if (proj.type === 'bomber') {
            const target = entitiesRef.current.find(e => e.id !== proj.ownerId && !e.isDead);
            const targetX = target ? target.pos.x : canvas.width / 2;
            const flyHeight = 150;
            
            // 确保Y轴高度
            proj.pos.y += (flyHeight - proj.pos.y) * 0.1;

            if (proj.bomberState === 'fly_in') {
                // 飞向目标X
                const dx = targetX - proj.pos.x;
                const dir = dx > 0 ? 1 : -1;
                
                // 快速接近
                proj.vel.x = dir * 10; 

                // 到达目标附近，开始投弹
                if (Math.abs(dx) < 60) {
                    proj.bomberState = 'bombing';
                    proj.bombDropCount = 0;
                    proj.lastHitFrame = frameRef.current;
                }
            } else if (proj.bomberState === 'bombing') {
                // 减速投弹
                proj.vel.x = proj.vel.x > 0 ? 5 : -5;

                const interval = 12; // 投弹间隔帧数
                if (frameRef.current - (proj.lastHitFrame || 0) > interval) {
                    proj.lastHitFrame = frameRef.current;
                    // 投掷炸弹
                    projectilesRef.current.push({
                        id: Math.random().toString(),
                        type: 'bomb',
                        pos: { x: proj.pos.x, y: proj.pos.y + 20 },
                        vel: { x: proj.vel.x * 0.5, y: 5 }, // 继承一点惯性
                        ownerId: proj.ownerId,
                        width: 20, height: 20, active: true
                    });
                    if (proj.bombDropCount !== undefined) proj.bombDropCount++;
                    
                    if (proj.bombDropCount && proj.bombDropCount >= 3) {
                         proj.bomberState = 'fly_out';
                    }
                }
            } else if (proj.bomberState === 'fly_out') {
                // 加速飞离
                proj.vel.x = proj.vel.x > 0 ? 15 : -15;
                if (proj.pos.x < -200 || proj.pos.x > canvas.width + 200) {
                    proj.active = false;
                }
            }
            
            proj.pos.x += proj.vel.x;
            return;
        }

        // --- 神龙逻辑 (优化动作) ---
        if (proj.type === 'dragon') {
            const dragonSegmentsCount = 20; // 增加段数，更流畅
            if (!proj.dragonSegments || proj.dragonSegments.length === 0) {
                proj.dragonSegments = Array.from({ length: dragonSegmentsCount }, () => ({ ...proj.pos }));
            }

            if (proj.dragonState === 'enter') {
                if (!proj.dragonPathProgress) proj.dragonPathProgress = 0;
                proj.dragonPathProgress += 0.02;
                
                shakeRef.current = 8;
                if (Math.random() < 0.1) playExplodeSound();

                const w = canvas.width;
                const h = canvas.height;
                const t = proj.dragonPathProgress * Math.PI * 2;
                
                // 更复杂的入场轨迹
                const targetX = w/2 + (w/2 - 50) * Math.cos(t) * Math.sin(t*0.5);
                const targetY = h/3 + (h/4) * Math.sin(2*t);
                
                proj.vel.x = (targetX - proj.pos.x) * 0.2;
                proj.vel.y = (targetY - proj.pos.y) * 0.2;
                proj.pos.x += proj.vel.x;
                proj.pos.y += proj.vel.y;

                if (proj.dragonPathProgress >= 1.5) {
                    proj.dragonState = 'hunt';
                    shakeRef.current = 0;
                }
            } else if (proj.dragonState === 'hunt') {
                const target = entitiesRef.current.find(e => e.id !== proj.ownerId && !e.isDead);
                if (target) {
                    const dx = target.pos.x - proj.pos.x;
                    const dy = (target.pos.y - 40) - proj.pos.y;
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    
                    const speed = 7; // 略微提速
                    // 增加一点惯性，避免转弯太生硬
                    proj.vel.x = (proj.vel.x * 20 + (dx / dist) * speed) / 21;
                    proj.vel.y = (proj.vel.y * 20 + (dy / dist) * speed) / 21;
                    
                    proj.pos.x += proj.vel.x;
                    proj.pos.y += proj.vel.y;

                    if (dist < 50) {
                        const now = frameRef.current;
                        if (!proj.lastHitFrame || now - proj.lastHitFrame > 30) {
                            proj.lastHitFrame = now;
                            if (proj.remainingHits && proj.remainingHits > 0) {
                                proj.remainingHits--;
                                
                                target.health -= 5;
                                target.stunFrames = 20;
                                target.vel.x = (Math.random()-0.5) * 30;
                                target.vel.y = -15;
                                
                                playHitSound();
                                spawnParticles(target.pos.x, target.pos.y, '#FFD700', 20, 8);
                                shakeRef.current = 15;

                                if (target.health <= 0) {
                                    target.health = 0;
                                    target.isDead = true;
                                    target.isLoser = true;
                                    triggerWin(proj.ownerId);
                                }

                                if (proj.remainingHits <= 0) {
                                    proj.active = false;
                                    // 神龙离去特效
                                    spawnParticles(proj.pos.x, proj.pos.y, '#FFD700', 80, 15);
                                }
                            }
                        }
                    }
                } else {
                    proj.vel.y -= 0.5;
                    proj.pos.x += Math.sin(frameRef.current * 0.1) * 5;
                    proj.pos.y += proj.vel.y;
                    if (proj.pos.y < -300) proj.active = false;
                }
            }

            if (proj.dragonSegments && proj.dragonSegments.length > 0) {
                proj.dragonSegments[0] = { ...proj.pos };
                for (let i = 1; i < proj.dragonSegments.length; i++) {
                    const current = proj.dragonSegments[i];
                    const prev = proj.dragonSegments[i-1];
                    const dx = prev.x - current.x;
                    const dy = prev.y - current.y;
                    const d = Math.sqrt(dx*dx + dy*dy);
                    const spacing = 18; 
                    
                    if (d > spacing) {
                        const ratio = (d - spacing) / d;
                        current.x += dx * ratio;
                        current.y += dy * ratio;
                    }
                }
            }
            return; 
        }

        // --- 巡航导弹逻辑 (东风) ---
        if (proj.type === 'missile') {
            if (!proj.trail) proj.trail = [];
            proj.trail.push({ ...proj.pos });
            if (proj.trail.length > 30) proj.trail.shift();

            if (frameRef.current % 2 === 0) {
                // 浓烟尾迹
                particlesRef.current.push({
                    id: Math.random().toString(),
                    pos: { x: proj.pos.x, y: proj.pos.y },
                    vel: { x: -proj.vel.x * 0.1, y: -proj.vel.y * 0.1 }, // 惯性残留
                    life: 40, maxLife: 40, color: '#aaa', size: 6, gravity: 0, growth: 0.2, alphaDecay: 0.05
                });
                // 火焰中心
                particlesRef.current.push({
                    id: Math.random().toString(),
                    pos: { x: proj.pos.x, y: proj.pos.y },
                    vel: { x: -proj.vel.x * 0.5, y: -proj.vel.y * 0.5 },
                    life: 10, maxLife: 10, color: '#ff5500', size: 4, gravity: 0
                });
            }

            const target = entitiesRef.current.find(e => e.id !== proj.ownerId && !e.isDead);
            if (target) {
                const targetX = target.pos.x;
                const targetY = target.pos.y - 35; 
                const dx = targetX - proj.pos.x;
                const dy = targetY - proj.pos.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                if (dist > 10) {
                    const speed = 8; // 导弹速度
                    // 增加追踪惯性
                    proj.vel.x = (proj.vel.x * 30 + (dx / dist) * speed) / 31;
                    proj.vel.y = (proj.vel.y * 30 + (dy / dist) * speed) / 31;
                }
            }
        }

        proj.pos.x += proj.vel.x;
        proj.pos.y += proj.vel.y;

        // --- 炸弹/原子弹落地 ---
        if (proj.type === 'bomb' || proj.type === 'atom_bomb') {
            const isNuke = proj.type === 'atom_bomb';
            proj.vel.y += GRAVITY; 
            let hitGround = false;
             if (proj.pos.y >= GROUND_Y) { hitGround = true; }
             else if (proj.vel.y > 0) {
                 PLATFORMS.forEach(plat => {
                     if (proj.pos.x > plat.x && proj.pos.x < plat.x + plat.width && 
                         proj.pos.y >= plat.y && proj.pos.y <= plat.y + 20) {
                         hitGround = true;
                     }
                 });
             }

            if (hitGround) {
                proj.active = false;
                
                if (isNuke) {
                    // === 核爆逻辑升级 ===
                    shakeRef.current = 120; 
                    flashRef.current = 1.0; 
                    playExplodeSound();
                    
                    // 生成蘑菇云
                    spawnMushroomCloud(proj.pos.x, proj.pos.y - 10);
                    
                    // 冲击波伤害范围极大
                    entitiesRef.current.forEach(target => {
                         if (!target.isDead) {
                             target.health = 0;
                             target.isDead = true;
                             target.isLoser = true;
                             // 被吹飞
                             const dir = target.pos.x - proj.pos.x > 0 ? 1 : -1;
                             target.vel.x = dir * 60;
                             target.vel.y = -60;
                             
                             if (target.id !== proj.ownerId) {
                                 const winner = entitiesRef.current.find(e => e.id === proj.ownerId);
                                 if (winner) triggerWin(winner.id);
                             } else {
                                 const enemy = entitiesRef.current.find(e => e.id !== proj.ownerId);
                                 if (enemy) triggerWin(enemy.id);
                             }
                         }
                    });

                } else {
                    shakeRef.current = 25; 
                    playExplodeSound();
                    spawnParticles(proj.pos.x, proj.pos.y, '#ff4500', 40, 15, 2); 
                    
                    entitiesRef.current.forEach(target => {
                        if (!target.isDead) {
                            const dist = Math.sqrt(Math.pow(target.pos.x - proj.pos.x, 2) + Math.pow(target.pos.y - proj.pos.y, 2));
                            if (dist < 180) {
                                target.health -= 25; 
                                if (target.health <= 0) { target.health = 0; target.isDead = true; target.isLoser = true; }
                                
                                const angle = Math.atan2(target.pos.y - proj.pos.y, target.pos.x - proj.pos.x);
                                target.vel.x = Math.cos(angle) * 30;
                                target.vel.y = Math.sin(angle) * 30;
                                target.stunFrames = 30;
                                
                                if (target.isDead) {
                                    const winner = entitiesRef.current.find(e => e.id === proj.ownerId);
                                    if (winner) triggerWin(winner.id);
                                }
                            }
                        }
                    });
                }
            }
        } else {
            // === 碰撞逻辑 (子弹 & 导弹) ===
            const isMissile = proj.type === 'missile';
            if (proj.pos.x < 0 || proj.pos.x > canvas.width || proj.pos.y > canvas.height + 100 || proj.pos.y < -200) proj.active = false;
            
            entitiesRef.current.forEach(target => {
                if (target.id !== proj.ownerId && !target.isDead && proj.active) {
                    const hitDist = isMissile ? 50 : 30; 
                    if (Math.abs(proj.pos.x - target.pos.x) < hitDist &&
                        proj.pos.y > target.pos.y - 75 && proj.pos.y < target.pos.y + 10) {
                            
                        proj.active = false;
                        const damage = isMissile ? 35 : 15; // 导弹伤害增加
                        target.health -= damage; 
                        target.stunFrames = isMissile ? 40 : 10;
                        shakeRef.current = isMissile ? 25 : 5;
                        
                        isMissile ? playExplodeSound() : playHitSound();
                        
                        // 导弹击中特效
                        if (isMissile) {
                             spawnParticles(target.pos.x, target.pos.y - 35, '#ff5500', 40, 10);
                             spawnParticles(target.pos.x, target.pos.y - 35, '#555', 20, 5);
                        } else {
                             spawnParticles(target.pos.x, target.pos.y - 35, '#ff0000', 10, 8);
                        }
                        
                        target.vel.x += proj.vel.x * (isMissile ? 1.2 : 0.3); 
                        target.vel.y -= isMissile ? 15 : 5;

                        if (target.health <= 0) {
                            target.health = 0; 
                            target.isDead = true;
                            target.isLoser = true;
                            target.vel.x = proj.vel.x * 0.8;
                            const winner = entitiesRef.current.find(e => e.id === proj.ownerId);
                            if (winner) triggerWin(winner.id);
                        }
                    }
                }
            });
        }
    });
    projectilesRef.current = projectilesRef.current.filter(p => p.active);

    // === 3. 实体更新 ===
    entitiesRef.current.forEach(entity => {
      // 检查武器是否过期
      if (entity.heldWeapon) {
          entity.weaponDuration--;
          if (entity.weaponDuration <= 0) {
              entity.heldWeapon = null;
              spawnParticles(entity.pos.x, entity.pos.y - 40, '#888', 5, 5); // 消失特效
          }
      }

      if (gameState === GameState.VICTORY_ANIMATION && entity.isWinner) {
          entity.isAttacking = false; entity.attackFrame = 0; entity.isCrouching = false;
          const targetX = canvas.width / 2;
          const targetY = canvas.height / 3;
          entity.pos.x += (targetX - entity.pos.x) * 0.05;
          entity.pos.y += (targetY - entity.pos.y) * 0.05;
          entity.pos.y += Math.sin(frameRef.current * 0.08) * 0.8;
          entity.vel.x = 0; entity.vel.y = 0;
          if (frameRef.current % 3 === 0) spawnConfetti(canvas.width);
          return;
      }

      // 拾取武器
      if (!entity.isDead) {
          const canPickUp = !entity.heldWeapon || entity.ammo <= 0;
          
          if (canPickUp) {
            const itemIndex = fallingItemsRef.current.findIndex(item => {
                const dx = Math.abs(entity.pos.x - (item.pos.x + item.width/2));
                const dy = Math.abs((entity.pos.y - 35) - (item.pos.y + item.height/2));
                return dx < 50 && dy < 60;
            });
            
            if (itemIndex !== -1) {
                const item = fallingItemsRef.current[itemIndex];
                entity.heldWeapon = item.type;
                entity.weaponDuration = WEAPON_LIFETIME; 
                switch(item.type) {
                    case 'bomb': entity.ammo = 3; break;
                    case 'sword': entity.ammo = 8; break;
                    case 'atom_bomb': entity.ammo = 1; break; 
                    case 'missile': entity.ammo = 2; break; // 导弹只有2发
                    case 'dragon': entity.ammo = 1; break; 
                    case 'bomber': entity.ammo = 1; break; 
                    case 'pokemon': entity.ammo = 1; break; 
                    case 'laser': entity.ammo = 9; break; // 激光增加2倍，现在有9发
                    case 'zeperion': entity.ammo = 3; break; // 哉佩利敖光线3发
                }
                fallingItemsRef.current.splice(itemIndex, 1);
                playJumpSound();
                spawnParticles(entity.pos.x, entity.pos.y - 30, '#fff', 5, 5);
            }
          }
      }

      // 物理引擎
      const prevY = entity.pos.y;
      entity.vel.y += GRAVITY;
      
      if (!entity.isLoser && entity.stunFrames > 0) {
           entity.stunFrames--; 
           entity.vel.x *= 0.95; 
      } else if (!entity.isLoser) {
          const currentFriction = entity.isCrouching && entity.isGrounded ? 0.4 : FRICTION;
          entity.vel.x *= currentFriction;
      } else {
          entity.vel.x *= 0.99; 
      }

      entity.pos.x += entity.vel.x;
      entity.pos.y += entity.vel.y;

      // 碰撞检测
      entity.isGrounded = false;
      if (entity.pos.y >= GROUND_Y) {
          if (!entity.isLoser) {
            entity.pos.y = GROUND_Y;
            entity.vel.y = 0;
            entity.isGrounded = true;
          }
      }
      if (entity.vel.y >= 0 && !entity.isDead) {
          PLATFORMS.forEach(plat => {
              if (entity.pos.x > plat.x - 10 && entity.pos.x < plat.x + plat.width + 10) {
                  if (prevY <= plat.y && entity.pos.y >= plat.y) {
                      entity.pos.y = plat.y;
                      entity.vel.y = 0;
                      entity.isGrounded = true;
                  }
              }
          });
      }

      if (!entity.isLoser) {
        if (entity.pos.x < 10) { entity.pos.x = 10; entity.vel.x *= -0.5; }
        if (entity.pos.x > canvas.width - 10) { entity.pos.x = canvas.width - 10; entity.vel.x *= -0.5; }
      }

      if (gameState === GameState.VICTORY_ANIMATION || entity.isDead || entity.stunFrames > 0) return;

      if (entity.attackCooldown > 0) entity.attackCooldown--;
      if (entity.isAttacking) {
          entity.attackFrame++;
          if (entity.attackFrame > 15) { 
              entity.isAttacking = false;
              entity.attackFrame = 0;
          }
      }

      let moveLeft = false, moveRight = false, jump = false, crouch = false, attack = false;

      // Input P1
      if (entity.playerIndex === 0) {
        if (keysRef.current.has('KeyA')) moveLeft = true;
        if (keysRef.current.has('KeyD')) moveRight = true;
        if (keysRef.current.has('KeyW')) jump = true;
        if (keysRef.current.has('KeyS')) crouch = true;
        if (keysRef.current.has('Space')) attack = true;
      }
      
      // Input P2 / AI
      if (entity.playerIndex === 1) {
          if (gameMode === 'PVP') {
            if (keysRef.current.has('ArrowLeft')) moveLeft = true;
            if (keysRef.current.has('ArrowRight')) moveRight = true;
            if (keysRef.current.has('ArrowUp')) jump = true;
            if (keysRef.current.has('ArrowDown')) crouch = true;
            if (keysRef.current.has('Enter')) attack = true;
          } else {
            // AI Logic
            const p1 = entitiesRef.current.find(e => e.playerIndex === 0);
            if (p1 && !p1.isDead) {
                let targetX = p1.pos.x;
                let targetY = p1.pos.y;
                
                if (!entity.heldWeapon && fallingItemsRef.current.length > 0) {
                    let minDist = 9999;
                    fallingItemsRef.current.forEach(item => {
                        const d = Math.abs(item.pos.x - entity.pos.x) + Math.abs(item.pos.y - entity.pos.y);
                        if (d < minDist) {
                            minDist = d;
                            targetX = item.pos.x;
                            targetY = item.pos.y;
                        }
                    });
                }

                const distX = targetX - entity.pos.x;
                const distY = targetY - entity.pos.y; 
                
                if (Math.abs(distX) > 40) {
                    distX > 0 ? moveRight = true : moveLeft = true;
                } else if (!entity.heldWeapon && Math.abs(distX) < 20) {
                     distX > 0 ? moveLeft = true : moveRight = true;
                }

                if (entity.isGrounded) {
                     if (distY < -100 || (Math.random() < 0.02)) {
                         jump = true;
                     }
                }
                
                const absDistX = Math.abs(p1.pos.x - entity.pos.x);
                entity.facingRight = (p1.pos.x - entity.pos.x) > 0;
                
                // AI 攻击逻辑
                let attackRange = ATTACK_RANGE;
                if (entity.heldWeapon === 'atom_bomb') attackRange = 300; 
                if (entity.heldWeapon === 'missile') attackRange = 700; 
                if (entity.heldWeapon === 'dragon') attackRange = 400; 
                if (entity.heldWeapon === 'bomber') attackRange = 800; 
                if (entity.heldWeapon === 'pokemon') attackRange = 800;
                if (entity.heldWeapon === 'laser') attackRange = 1000;
                if (entity.heldWeapon === 'zeperion') attackRange = 1000;

                if (absDistX < attackRange && Math.abs(p1.pos.y - entity.pos.y) < 100) {
                    if (entity.attackCooldown === 0 && Math.random() < 0.05) attack = true;
                }
            }
          }
      }

      entity.isCrouching = crouch && entity.isGrounded;
      if (!entity.isCrouching) {
          if (moveLeft) { entity.vel.x -= MOVE_SPEED; entity.facingRight = false; }
          if (moveRight) { entity.vel.x += MOVE_SPEED; entity.facingRight = true; }
      }
      if (jump && entity.isGrounded && !entity.isCrouching) {
          entity.vel.y = JUMP_FORCE;
          playJumpSound();
      }

      // === 攻击处理 ===
      if (attack && entity.attackCooldown === 0) {
          entity.attackCooldown = ATTACK_COOLDOWN;
          entity.isAttacking = true;
          entity.attackFrame = 5;

          if (entity.heldWeapon === 'bomb') {
              entity.vel.x += entity.facingRight ? -2 : 2;
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: 'bomb',
                  pos: { x: entity.pos.x, y: entity.pos.y - 60 },
                  vel: { x: entity.facingRight ? 12 : -12, y: -12 },
                  ownerId: entity.id,
                  width: 20, height: 20, active: true
              });
              entity.ammo--;
          } else if (entity.heldWeapon === 'atom_bomb') {
              entity.vel.x += entity.facingRight ? -4 : 4;
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: 'atom_bomb',
                  pos: { x: entity.pos.x, y: entity.pos.y - 70 },
                  vel: { x: entity.facingRight ? 8 : -8, y: -10 },
                  ownerId: entity.id,
                  width: 30, height: 40, active: true
              });
              entity.ammo--; 
          } else if (entity.heldWeapon === 'missile') {
              playShootSound(); 
              entity.vel.x += entity.facingRight ? -10 : 10; 
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: 'missile',
                  pos: { x: entity.pos.x + (entity.facingRight ? 50 : -50), y: entity.pos.y - 50 },
                  vel: { x: entity.facingRight ? 10 : -10, y: -5 }, 
                  ownerId: entity.id,
                  width: 20, height: 8, active: true
              });
              entity.ammo--; 
          } else if (entity.heldWeapon === 'dragon') {
              playDragonRoar();
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: 'dragon',
                  pos: { x: entity.pos.x, y: entity.pos.y - 100 },
                  vel: { x: 0, y: 0 },
                  ownerId: entity.id,
                  width: 40, height: 40, active: true,
                  dragonState: 'enter', 
                  remainingHits: 5,
                  dragonPathProgress: 0,
                  dragonSegments: undefined
              });
              entity.ammo--;
          } else if (entity.heldWeapon === 'bomber') {
              // 呼叫轰炸机
              const startX = entity.facingRight ? -100 : canvas.width + 100;
              playShootSound(); // 使用枪声模拟无线电
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: 'bomber',
                  pos: { x: startX, y: 100 }, // 高空飞行
                  vel: { x: 0, y: 0 },
                  ownerId: entity.id,
                  width: 60, height: 20, active: true,
                  bomberState: 'fly_in',
                  bombDropCount: 0
              });
              entity.ammo--;
          } else if (entity.heldWeapon === 'pokemon') {
              playJumpSound();
              // 召唤皮卡丘
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: 'pokemon',
                  pos: { x: entity.pos.x + (entity.facingRight ? 20 : -20), y: entity.pos.y - 40 },
                  vel: { x: entity.facingRight ? 10 : -10, y: -5 },
                  ownerId: entity.id,
                  width: 20, height: 20, active: true,
                  pokemonState: 'seeking',
                  attackTimer: 0
              });
              entity.ammo--;
          } else if (entity.heldWeapon === 'laser') {
              // === 激光武器逻辑 ===
              playShootSound();
              shakeRef.current = 20;
              
              const beamLength = 2000;
              const startX = entity.pos.x + (entity.facingRight ? 20 : -20);
              const startY = entity.pos.y - 45;
              const endX = entity.facingRight ? startX + beamLength : startX - beamLength;
              
              // 碰撞检测：激光路径上的所有敌人
              entitiesRef.current.forEach(target => {
                  if (target.id !== entity.id && !target.isDead) {
                      const isHit = entity.facingRight 
                          ? (target.pos.x > startX && target.pos.x < endX)
                          : (target.pos.x < startX && target.pos.x > endX);
                      
                      if (isHit && Math.abs((target.pos.y - 35) - startY) < 50) {
                          target.health = 0;
                          target.isDead = true;
                          target.isLoser = true;
                          target.vel.x = entity.facingRight ? 50 : -50;
                          target.vel.y = -30;
                          
                          playExplodeSound();
                          spawnParticles(target.pos.x, target.pos.y - 35, '#ff0000', 30, 15);
                          triggerWin(entity.id);
                      }
                  }
              });

              // 激光束粒子效果
              for(let i=0; i<20; i++) {
                  const px = startX + (endX - startX) * (i / 20);
                  spawnParticles(px, startY, '#ff0000', 2, 2, 0.5);
              }

              entity.ammo--;
          } else if (entity.heldWeapon === 'zeperion') {
              // === 哉佩利敖光线逻辑 ===
              playShootSound();
              shakeRef.current = 30; // 屏幕抖动更剧烈
              
              const beamLength = 2000;
              const startX = entity.pos.x + (entity.facingRight ? 20 : -20);
              const startY = entity.pos.y - 45;
              const endX = entity.facingRight ? startX + beamLength : startX - beamLength;
              
              // 碰撞检测：激光路径上的所有敌人
              entitiesRef.current.forEach(target => {
                  if (target.id !== entity.id && !target.isDead) {
                      const isHit = entity.facingRight 
                          ? (target.pos.x > startX && target.pos.x < endX)
                          : (target.pos.x < startX && target.pos.x > endX);
                      
                      if (isHit && Math.abs((target.pos.y - 35) - startY) < 60) {
                          target.health -= 40; // 高伤害
                          
                          // 击中特效：橘黄色光球从小变大，爆炸，满天星火
                          projectilesRef.current.push({
                              id: Math.random().toString(),
                              type: 'zeperion',
                              pos: { x: target.pos.x, y: target.pos.y - 35 },
                              vel: { x: 0, y: 0 },
                              ownerId: entity.id,
                              width: 0, height: 0, active: true,
                              zeperionState: 'growing',
                              zeperionLife: 0,
                              zeperionMaxLife: 40
                          });

                          target.vel.x = entity.facingRight ? 40 : -40;
                          target.vel.y = -20;
                          target.stunFrames = 40;
                          
                          if (target.health <= 0) {
                              target.health = 0;
                              target.isDead = true;
                              target.isLoser = true;
                              triggerWin(entity.id);
                          }
                      }
                  }
              });

              entity.ammo--;
          } else {
              // == 近战武器 ==
              playAttackSound();
              
              let range = ATTACK_RANGE;
              let dmg = ATTACK_DAMAGE;
              let knockbackX = 15;
              let knockbackY = -8;
              let selfPush = 10;
              let hitEffectSize = 12;

              if (entity.heldWeapon === 'sword') {
                  range = 140; dmg = 15; knockbackX = 12; selfPush = 12; entity.attackCooldown = 20; 
              }

              entity.vel.x = entity.facingRight ? selfPush : -selfPush;

              const hitX = entity.facingRight ? entity.pos.x + range/2 : entity.pos.x - range/2;
              const hitY = entity.isCrouching ? entity.pos.y - 20 : entity.pos.y - 45;
              
              let hitSomething = false;

              entitiesRef.current.forEach(target => {
                  if (target !== entity && !target.isDead) {
                      const dy = (target.pos.y - 35) - hitY;
                      if (Math.abs(target.pos.x - entity.pos.x) < range && Math.abs(dy) < 60 && 
                          ((entity.facingRight && target.pos.x > entity.pos.x) || (!entity.facingRight && target.pos.x < entity.pos.x))) {

                          if (!entity.isCrouching && target.isCrouching) {
                              spawnParticles(target.pos.x, target.pos.y - 40, '#aaa', 2, 2);
                              return; 
                          }

                          target.health -= dmg;
                          hitSomething = true;
                          
                          target.vel.x = entity.facingRight ? knockbackX : -knockbackX; 
                          target.vel.y = knockbackY; 
                          target.stunFrames = 20; 
                          
                          shakeRef.current = Math.floor(dmg / 2);
                          // 修复：不再使用角色颜色作为粒子颜色，改用火花色，并减小尺寸
                          spawnParticles(target.pos.x, target.pos.y - 40, '#ffffff', 5, 8, 0.5, 2);
                          spawnParticles(target.pos.x, target.pos.y - 40, '#ffcc00', 5, 10, 0.5, 2);
                          playHitSound();

                          if (target.health <= 0) {
                              target.health = 0;
                              target.isDead = true;
                              target.isLoser = true;
                              target.vel.x = entity.facingRight ? 30 : -30;
                              target.vel.y = -20;
                              triggerWin(entity.id);
                          }
                      }
                  }
              });

              if (hitSomething && entity.heldWeapon) {
                  entity.ammo--;
              }
          }

          // 弹药耗尽检查
          if (entity.heldWeapon && entity.ammo <= 0) {
              entity.heldWeapon = null;
              spawnParticles(entity.pos.x, entity.pos.y - 40, '#888', 5, 5); 
          }
      }
    });
  };

  const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const shake = shakeRef.current;
      const shakeX = shake > 0 ? (Math.random() - 0.5) * shake : 0;
      const shakeY = shake > 0 ? (Math.random() - 0.5) * shake : 0;

      ctx.save();
      
      // Clear & Background
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.translate(shakeX, shakeY);

      // Draw Platforms
      ctx.fillStyle = '#334155';
      PLATFORMS.forEach(p => {
          ctx.fillRect(p.x, p.y, p.width, p.height);
          ctx.fillStyle = '#475569';
          ctx.fillRect(p.x, p.y, p.width, 5);
          ctx.fillStyle = '#334155';
      });
      // Draw Ground
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);

      // Draw Falling Items
      fallingItemsRef.current.forEach(item => {
        if (!item.onGround) {
             ctx.fillStyle = 'rgba(0,0,0,0.3)';
             ctx.beginPath(); ctx.ellipse(item.pos.x + item.width/2, GROUND_Y, 15, 5, 0, 0, Math.PI*2); ctx.fill();
        }
        
        ctx.save();
        ctx.translate(item.pos.x + item.width/2, item.pos.y + item.height/2);
        
        if (item.type === 'bomb') {
            ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2); ctx.fill();
            ctx.strokeStyle='#fff'; ctx.beginPath(); ctx.moveTo(0,-10); ctx.lineTo(5,-15); ctx.stroke();
        } else if (item.type === 'sword') {
             ctx.fillStyle = '#cbd5e1'; ctx.beginPath(); ctx.moveTo(-2, 10); ctx.lineTo(-2, -15); ctx.lineTo(0,-20); ctx.lineTo(2,-15); ctx.lineTo(2,10); ctx.fill();
             ctx.fillStyle = '#8B4513'; ctx.fillRect(-5, 10, 10, 3);
        } else if (item.type === 'atom_bomb') {
             ctx.fillStyle = '#1e1e1e'; ctx.beginPath(); ctx.arc(0,0,12,0,Math.PI*2); ctx.fill();
             ctx.fillStyle = '#eab308'; ctx.font='12px sans-serif'; ctx.fillText('☢', -5, 4);
        } else if (item.type === 'missile') {
             ctx.fillStyle = '#15803d'; ctx.fillRect(-12, -4, 24, 8);
             ctx.fillStyle = '#dc2626'; ctx.fillRect(12, -4, 4, 8);
        } else if (item.type === 'dragon') {
             ctx.font='24px serif'; ctx.fillText('🐉', -12, 8);
        } else if (item.type === 'bomber') {
             ctx.fillStyle = '#4b5563'; ctx.fillRect(-10, -10, 20, 14); 
             ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(5,-5,3,0,Math.PI*2); ctx.fill(); 
             ctx.fillRect(5, -18, 2, 8); 
        } else if (item.type === 'pokemon') {
             // 精灵球图标
             ctx.fillStyle = 'red'; ctx.beginPath(); ctx.arc(0,0,10, Math.PI, 0); ctx.fill();
             ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(0,0,10, 0, Math.PI); ctx.fill();
             ctx.fillStyle = 'black'; ctx.fillRect(-10, -1, 20, 2);
             ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(0,0,3, 0, Math.PI*2); ctx.fill();
             ctx.strokeStyle = 'black'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0,0,3, 0, Math.PI*2); ctx.stroke();
        } else if (item.type === 'laser') {
             // 激光武器图标
             ctx.fillStyle = '#444'; ctx.fillRect(-10, -4, 20, 8);
             ctx.fillStyle = '#f00'; ctx.fillRect(10, -3, 3, 6);
             ctx.strokeStyle = '#f00'; ctx.lineWidth = 1; ctx.strokeRect(-10, -4, 20, 8);
        } else if (item.type === 'zeperion') {
             // 哉佩利敖光线图标
             ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2); ctx.fill();
             ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.fill();
             ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2;
             ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.stroke();
             ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(0, 15); ctx.stroke();
        }
        ctx.restore();
      });

      // Draw Projectiles
      projectilesRef.current.forEach(proj => {
           if (proj.type === 'dragon' && proj.dragonSegments) {
                ctx.strokeStyle = '#fbbf24'; 
                ctx.lineWidth = 20;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                if (proj.dragonSegments.length > 0) {
                     ctx.moveTo(proj.dragonSegments[0].x, proj.dragonSegments[0].y);
                     for(let i=1; i<proj.dragonSegments.length; i++) {
                         ctx.lineTo(proj.dragonSegments[i].x, proj.dragonSegments[i].y);
                     }
                }
                ctx.stroke();
                ctx.fillStyle = '#ef4444'; 
                ctx.beginPath(); ctx.arc(proj.pos.x, proj.pos.y - 10, 5, 0, Math.PI*2); ctx.fill();
                return;
           }

           if (proj.type === 'zeperion') {
               if (proj.zeperionState === 'growing') {
                   const progress = (proj.zeperionLife || 0) / 15; // 0 to 1
                   const radius = progress * 60; // 爆炸球半径逐渐变大到 60
                   
                   ctx.save();
                   ctx.translate(proj.pos.x, proj.pos.y);
                   
                   // 橘黄色光球
                   const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
                   gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
                   gradient.addColorStop(0.2, 'rgba(254, 240, 138, 0.9)');
                   gradient.addColorStop(0.6, 'rgba(251, 191, 36, 0.8)');
                   gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
                   
                   ctx.fillStyle = gradient;
                   ctx.beginPath();
                   ctx.arc(0, 0, radius, 0, Math.PI * 2);
                   ctx.fill();
                   
                   ctx.restore();
               }
               return;
           }

           if (proj.type === 'pokemon') {
                if (proj.pokemonState === 'attacking') {
                    // 闪电连线 (画在宝可梦后面)
                    const target = entitiesRef.current.find(e => e.id !== proj.ownerId);
                    if (target) {
                        ctx.strokeStyle = '#ffff00';
                        ctx.lineWidth = 3;
                        ctx.beginPath();
                        ctx.moveTo(proj.pos.x, proj.pos.y);
                        // 简单的锯齿闪电
                        const midX = (proj.pos.x + target.pos.x) / 2 + (Math.random() - 0.5) * 50;
                        const midY = (proj.pos.y + (target.pos.y - 40)) / 2 + (Math.random() - 0.5) * 50;
                        ctx.lineTo(midX, midY);
                        ctx.lineTo(target.pos.x, target.pos.y - 40);
                        ctx.stroke();
                    }
                }

                ctx.save();
                ctx.translate(proj.pos.x, proj.pos.y);
                // 皮卡丘
                ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(0,0,12,0,Math.PI*2); ctx.fill(); // 身体
                // 耳朵
                ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(-12, -20); ctx.lineTo(-4, -10); ctx.fill();
                ctx.beginPath(); ctx.moveTo(8, -8); ctx.lineTo(12, -20); ctx.lineTo(4, -10); ctx.fill();
                ctx.fillStyle = 'black'; 
                ctx.beginPath(); ctx.moveTo(-11, -17); ctx.lineTo(-12, -20); ctx.lineTo(-9, -15); ctx.fill(); // 耳尖
                ctx.beginPath(); ctx.moveTo(11, -17); ctx.lineTo(12, -20); ctx.lineTo(9, -15); ctx.fill();
                // 脸
                ctx.fillStyle = 'black'; ctx.beginPath(); ctx.arc(-4, -2, 1.5, 0, Math.PI*2); ctx.fill();
                ctx.beginPath(); ctx.arc(4, -2, 1.5, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = 'red'; ctx.beginPath(); ctx.arc(-7, 2, 2, 0, Math.PI*2); ctx.fill();
                ctx.beginPath(); ctx.arc(7, 2, 2, 0, Math.PI*2); ctx.fill();
                ctx.restore();
                return;
           }

           if (proj.type === 'missile') {
                // 绘制导弹轨迹 (在 translate 之前绘制，使用绝对坐标)
                if (proj.trail && proj.trail.length > 1) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                    ctx.lineWidth = 2;
                    ctx.moveTo(proj.trail[0].x, proj.trail[0].y);
                    for (let i = 1; i < proj.trail.length; i++) {
                        ctx.lineTo(proj.trail[i].x, proj.trail[i].y);
                    }
                    ctx.stroke();
                    
                    // 核心轨迹
                    ctx.beginPath();
                    ctx.strokeStyle = 'rgba(255, 200, 0, 0.4)';
                    ctx.lineWidth = 1;
                    ctx.moveTo(proj.trail[0].x, proj.trail[0].y);
                    for (let i = 1; i < proj.trail.length; i++) {
                        ctx.lineTo(proj.trail[i].x, proj.trail[i].y);
                    }
                    ctx.stroke();
                    ctx.restore();
                }
           }

           ctx.save();
           ctx.translate(proj.pos.x, proj.pos.y);
           
           if (proj.type === 'bomb') {
               ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0,0,8,0,Math.PI*2); ctx.fill();
           } else if (proj.type === 'atom_bomb') {
               ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(0,0,12,0,Math.PI*2); ctx.fill();
               ctx.fillStyle = 'yellow'; ctx.fillText('☢', -4, 4);
           } else if (proj.type === 'missile' && proj.active) {
               const angle = Math.atan2(proj.vel.y, proj.vel.x);
               ctx.rotate(angle);
               ctx.fillStyle = '#166534'; ctx.fillRect(-10, -4, 20, 8);
               ctx.fillStyle = '#ef4444'; ctx.fillRect(10, -4, 4, 8);
           } else if (proj.type === 'bomber') {
               ctx.fillStyle = '#1f2937'; 
               ctx.beginPath(); ctx.moveTo(20,0); ctx.lineTo(-10, -15); ctx.lineTo(-10, 15); ctx.fill();
               ctx.fillStyle = '#374151';
               ctx.fillRect(-5, -30, 10, 60);
           }

           ctx.restore();
      });

      // Draw Particles
      particlesRef.current.forEach(p => {
          ctx.fillStyle = p.color;
          const alpha = p.currentAlpha !== undefined ? p.currentAlpha : (p.life / p.maxLife);
          ctx.globalAlpha = Math.max(0, alpha);
          ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1.0;
      });

      // Draw Entities
      entitiesRef.current.forEach(entity => {
          drawEntity(ctx, entity);
          
          // 绘制激光束
          if (entity.isAttacking && entity.heldWeapon === 'laser') {
              const startX = entity.pos.x + (entity.facingRight ? 20 : -20);
              const startY = entity.pos.y - 45;
              const beamLength = 2000;
              const endX = entity.facingRight ? startX + beamLength : startX - beamLength;

              ctx.save();
              // 外层光晕
              ctx.shadowBlur = 20;
              ctx.shadowColor = '#ff0000';
              ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
              ctx.lineWidth = 12;
              ctx.beginPath();
              ctx.moveTo(startX, startY);
              ctx.lineTo(endX, startY);
              ctx.stroke();

              // 内层核心
              ctx.shadowBlur = 5;
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 4;
              ctx.beginPath();
              ctx.moveTo(startX, startY);
              ctx.lineTo(endX, startY);
              ctx.stroke();
              ctx.restore();
          } else if (entity.isAttacking && entity.heldWeapon === 'zeperion') {
              // 绘制哉佩利敖光线（一道金光）
              const startX = entity.pos.x + (entity.facingRight ? 20 : -20);
              const startY = entity.pos.y - 45;
              const beamLength = 2000;
              const endX = entity.facingRight ? startX + beamLength : startX - beamLength;

              ctx.save();
              // 巨大的金色外层光晕
              ctx.shadowBlur = 40;
              ctx.shadowColor = '#fbbf24';
              ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
              ctx.lineWidth = 30;
              ctx.lineCap = 'round';
              ctx.beginPath();
              ctx.moveTo(startX, startY);
              ctx.lineTo(endX, startY);
              ctx.stroke();

              // 中层亮黄
              ctx.shadowBlur = 10;
              ctx.shadowColor = '#fef08a';
              ctx.strokeStyle = 'rgba(254, 240, 138, 0.9)';
              ctx.lineWidth = 15;
              ctx.beginPath();
              ctx.moveTo(startX, startY);
              ctx.lineTo(endX, startY);
              ctx.stroke();

              // 内层核心白光
              ctx.shadowBlur = 0;
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 6;
              ctx.beginPath();
              ctx.moveTo(startX, startY);
              ctx.lineTo(endX, startY);
              ctx.stroke();
              ctx.restore();
          }
      });
      
      // Flash
      if (flashRef.current > 0) {
          ctx.fillStyle = `rgba(255, 255, 255, ${flashRef.current})`;
          ctx.fillRect(-shakeX, -shakeY, canvas.width, canvas.height); 
      }

      ctx.restore();
  };

  const tick = () => {
    update();
    draw();
    requestRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
    }
    requestRef.current = requestAnimationFrame(tick);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState]);

  return (
    <canvas 
        ref={canvasRef} 
        className="block w-full h-full bg-slate-900"
    />
  );
};

export default GameCanvas;