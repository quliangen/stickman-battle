export enum GameState {
  MENU,
  PLAYING,
  GAME_OVER,
  VICTORY_ANIMATION
}

export type GameMode = 'PVE' | 'PVP' | 'COOP';

export type MapType = 'neon' | 'forest' | 'desert' | 'ocean' | 'volcano' | 'night' | 'snow' | 'prairie' | 'glacier' | 'space' | 'village';

export interface Vector {
  x: number;
  y: number;
}

// 移除了 stick, blade, pistol，新增 bomber, pokemon, zeperion, gatling
export type WeaponType = 'bomb' | 'sword' | 'atom_bomb' | 'missile' | 'dragon' | 'bomber' | 'pokemon' | 'laser' | 'zeperion' | 'c4' | 'piercer' | 'aug' | 'gas' | 'gatling';

/*
  武器库（WeaponArsenal）里小朋友自创的武器。
  行为不能靠 UI 生成代码，所以自创武器 = 行为模板 + 参数：
  - melee：近战挥砍（复用近战判定块，range/damage/knockback 可调）
  - gun：  子弹连发（仿 aug 直弹，bulletSpeed/damage/tint 可调）
  - throw：投掷爆炸（仿 bomb 弧线+爆炸，blastRadius/damage/tint 可调）
  数据存 localStorage（见 services/weaponService.ts），跨版本保留。
*/
export type CustomWeaponTemplate = 'melee' | 'gun' | 'throw';

export interface CustomWeapon {
  id: CustomWeaponId;       // 'cw_' 前缀
  name: string;             // ≤ 6 字
  emoji: string;            // 手持贴图 / 落物贴图 / HUD 图标都是它
  template: CustomWeaponTemplate;
  damage: number;           //  melee/gun/throw 共用
  ammo: number;             // 使用次数
  range: number;            // melee 专用：攻击距离
  knockback: number;        // melee 专用：击退
  bulletSpeed: number;      // gun 专用：弹速 px/帧
  blastRadius: number;      // throw 专用：爆炸半径
  color: string;            // gun 子弹 / throw 爆炸的粒子颜色（#rrggbb）
}

// 自创武器 id：'cw_' 前缀的字符串（如 cw_1719123456789）
export type CustomWeaponId = `cw_${string}`;

/*
  内置武器的可调数值（武器库「调一调」）。
  每件武器只用其中一部分字段（damage/ammo 必有），存全量方便 UI 遍历。
  默认值在 weaponService.BUILTIN_STATS，玩家调整存 overrides。
*/
export interface WeaponStats {
  damage: number;        // 单次命中伤害
  ammo: number;          // 拾取弹药 / 耐久 / 使用次数
  cooldown?: number;     // 攻击间隔（帧）
  range?: number;        // 近战攻击距离
  knockback?: number;    // 近战击退
  bulletSpeed?: number;  // 子弹速度 px/帧
  blastRadius?: number;  // 爆炸半径
}
export type WeaponStatKey = keyof WeaponStats;


// 任何能拿在手上的武器：内置 13 种 + 自创
export type AnyWeaponId = WeaponType | CustomWeaponId;

export interface Platform {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 障碍类型：spike = 伤害陷阱（尖刺/岩浆）/ block = 实心阻挡（箱子、柱子）/ mover = 移动平台
export type ObstacleKind = 'spike' | 'block' | 'mover';

export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  y: number;
  width: number;
  height: number;
  // 移动平台专用：往返运动参数，以及本帧位移（用于把站在上面的角色一起带走）
  baseX?: number;
  baseY?: number;
  axis?: 'x' | 'y';
  range?: number;
  speed?: number;
  phase?: number;
  dx?: number;
  dy?: number;
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
  heldWeapon?: AnyWeaponId | null;
  ammo: number; // 弹药量 或 近战武器耐久度
  weaponDuration: number; // 新增：武器剩余存在时间 (帧)
  stunFrames: number; // 受击硬直/击飞状态
  spikeCooldown: number; // 踩到陷阱后的无敌帧，避免站在尖刺上被瞬间抽干血
  jetpackFuel: number; // 喷气背包剩余燃料（帧）；0 = 没背包
  jetThrusting: boolean; // 瞬态：本帧是否正在喷气（只供绘制读，不参与存档）
  team: 'player' | 'enemy'; // 阵营：玩家（p1/p2 同队）与敌人（COOP 模式刷出的怪）
}

// 天上掉落的东西：武器 + 道具（喷气背包）
export type ItemKind = AnyWeaponId | 'jetpack';

export interface FallingItem {
  id: string;
  type: ItemKind;
  pos: Vector;
  vel: Vector;
  width: number;
  height: number;
  onGround: boolean;
}

export interface Projectile {
  id: string;
  type: AnyWeaponId;
  pos: Vector;
  vel: Vector;
  ownerId: string;
  width: number;
  height: number;
  active: boolean;
  targetId?: string; // 追踪目标ID

  // 自创武器（武器库）投射物：参数挂在弹上，update/draw 直接读，不用回查存档
  customId?: CustomWeaponId;
  damage?: number;
  blastRadius?: number;
  tint?: string;

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
  // C4 炸弹特有属性
  c4State?: 'flying' | 'planted';
  c4Fuse?: number;

  // 穿地弹特有属性
  piercerState?: 'flying' | 'burrowing' | 'erupting';
  piercerDir?: number; // 潜行水平方向 1 / -1
  piercerTimer?: number;

  // 毒气弹特有属性
  gasState?: 'flying' | 'cloud';
  gasTimer?: number;
  gasRadius?: number;

  // 轨迹
  trail?: Vector[]; 
}

export interface Particle {
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

  // 环形冲击波特效
  kind?: 'circle' | 'ring'; // ring = 描边圆环（冲击波光波）
  lineWidth?: number; // 环线宽
  lineWidthDecay?: number; // 环线宽衰减速率
}

export interface GameStats {
  winner: string | null;
  mode: GameMode;
  duration: number;
  // COOP 闯关专用：当前波次 / 总波次（其它模式不填）
  wave?: number;
  totalWaves?: number;
}