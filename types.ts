export enum GameState {
  MENU,
  PLAYING,
  GAME_OVER,
  VICTORY_ANIMATION
}

export type GameMode = 'PVE' | 'PVP';

export interface Vector {
  x: number;
  y: number;
}

// 移除了 stick, blade, pistol，新增 bomber, pokemon, zeperion
export type WeaponType = 'bomb' | 'sword' | 'atom_bomb' | 'missile' | 'dragon' | 'bomber' | 'pokemon' | 'laser' | 'zeperion';

export interface Platform {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Entity {
  id: string;
  pos: Vector;
  vel: Vector;
  width: number;
  height: number;
  color: string;
  isGrounded: boolean;
  isCrouching: boolean;
  health: number;
  maxHealth: number;
  isDead: boolean;
  facingRight: boolean;
  attackCooldown: number;
  isAttacking: boolean;
  attackFrame: number;
  type: 'player'; 
  playerIndex: number; 
  isWinner?: boolean;
  isLoser?: boolean;
  heldWeapon?: WeaponType | null;
  ammo: number; // 弹药量 或 近战武器耐久度
  weaponDuration: number; // 新增：武器剩余存在时间 (帧)
  stunFrames: number; // 受击硬直/击飞状态
}

export interface FallingItem {
  id: string;
  type: WeaponType;
  pos: Vector;
  vel: Vector;
  width: number;
  height: number;
  onGround: boolean;
}

export interface Projectile {
  id: string;
  type: WeaponType;
  pos: Vector;
  vel: Vector;
  ownerId: string;
  width: number;
  height: number;
  active: boolean;
  targetId?: string; // 追踪目标ID
  
  // 神龙特有属性
  dragonState?: 'enter' | 'hunt';
  dragonPathProgress?: number; // 入场动画进度
  dragonSegments?: Vector[]; // 龙身位置数组
  remainingHits?: number; // 剩余攻击次数
  lastHitFrame?: number; // 上次攻击时间

  // 轰炸机特有属性
  bomberState?: 'fly_in' | 'bombing' | 'fly_out';
  bombDropCount?: number;

  // 宝可梦特有属性
  pokemonState?: 'seeking' | 'attacking';
  attackTimer?: number;

  // 哉佩利敖光线特有属性
  zeperionState?: 'growing' | 'exploding';
  zeperionLife?: number;
  zeperionMaxLife?: number;

  // 轨迹
  trail?: Vector[]; 
}

export interface Particle {
  id: string;
  pos: Vector;
  vel: Vector;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  gravity?: number; 
  
  // 新增属性用于高级特效 (蘑菇云等)
  growth?: number; // 尺寸增长速率
  alphaDecay?: number; // 透明度衰减速率 (默认是 life/maxLife，此项可覆盖)
  currentAlpha?: number;
}

export interface GameStats {
  winner: string | null;
  mode: GameMode;
  duration: number;
}