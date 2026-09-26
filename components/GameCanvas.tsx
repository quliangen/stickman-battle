import React, { useRef, useEffect, useCallback } from 'react';
import { GameState, Entity, Vector, Particle, GameStats, GameMode, MapType, FallingItem, Projectile, WeaponType, Platform, Obstacle, AnyWeaponId, ItemKind } from '../types';
import { playJumpSound, playAttackSound, playHitSound, playShootSound, playExplodeSound, playDragonRoar, startJetSound, stopJetSound } from '../services/audioService';
import { getDropPool, getCustom, getBuiltinStats, isBuiltinDisabled, isCustomId } from '../services/weaponService';

interface GameCanvasProps {
  gameState: GameState;
  setGameState: (state: GameState) => void;
  setStats: React.Dispatch<React.SetStateAction<GameStats>>;
  setPlayers: (players: Entity[]) => void;
  gameMode: GameMode;
  map: MapType;
}

// ================= 炫酷动态背景 =================
// 固定种子的伪随机数生成器：保证星星位置在每一帧都稳定不变
const mulberry32 = (seed: number) => {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

interface Star {
  x: number; // 归一化坐标 0..1（按画布实际尺寸放大）
  y: number;
  size: number;
  speed: number;
  phase: number;
}

// 预生成一批星星
const STAR_COUNT = 170;
const STARS: Star[] = (() => {
  const rand = mulberry32(20260919);
  const arr: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    arr.push({
      x: rand(),
      y: rand(),
      size: 0.4 + rand() * 1.6,
      speed: 0.015 + rand() * 0.05,
      phase: rand() * Math.PI * 2,
    });
  }
  return arr;
})();

// 星云 / 极光光斑配置（screen 混合产生辉光）
const NEBULAE = [
  { sx: 0.22, sy: 0.25, sr: 0.42, c: '56, 189, 248', a: 0.20 }, // 青色
  { sx: 0.78, sy: 0.30, sr: 0.46, c: '168, 85, 247', a: 0.20 }, // 紫色
  { sx: 0.50, sy: 0.62, sr: 0.52, c: '236, 72, 153', a: 0.12 }, // 粉红
  { sx: 0.85, sy: 0.78, sr: 0.36, c: '34, 211, 238', a: 0.10 }, // 蓝绿
];

// ================= 霓虹都市天际线 =================
/*
  图名叫"霓虹都市"，以前背景却只有一片星空，这条天际线补上"城市"那部分。
  楼是静止的：整排楼画进离屏画布缓存，每帧只 drawImage 一次（和 paintPlatforms 一个思路），
  否则几百扇窗户逐帧重画，把省下来的光栅化又吃回去了。
  楼的排布用固定种子的 PRNG 生成 —— 窗口尺寸变化触发重画时楼不能跟着重新洗牌，
  否则 resize 一下整条街都变了样。每帧额外画的只有几盏楼顶信号灯（见 drawNeonBackground）。
*/
interface CityBuilding {
  x: number;       // 左边缘，归一化 0..1
  w: number;       // 宽，归一化
  h: number;       // 高，0..1（相对楼高上限 CITY_MAX_H）
  tone: number;    // 0..1，决定楼体深浅
  antenna: boolean;
  neon: number;    // > 0.72 的楼顶描霓虹边
}

const CITY_BUILDINGS: CityBuilding[] = (() => {
  const rand = mulberry32(20260923);
  const arr: CityBuilding[] = [];
  let x = -0.04;
  while (x < 1.04) {
    const w = 0.05 + rand() * 0.075;
    arr.push({ x, w, h: 0.3 + rand() * 0.7, tone: rand(), antenna: rand() < 0.3, neon: rand() });
    x += w + rand() * 0.024 - 0.008; // 偶尔留缝，偶尔楼贴楼
  }
  return arr;
})();

// 楼顶红色航空障碍灯：取自带天线的楼（也是固定种子，位置稳定）
const CITY_BEACONS = (() => {
  const rand = mulberry32(20260115);
  return CITY_BUILDINGS.filter((b) => b.antenna)
    .slice(0, 6)
    .map((b) => ({
      x: b.x + b.w / 2, // 归一化中心
      h: b.h,
      phase: rand() * Math.PI * 2,
      speed: 0.04 + rand() * 0.05,
    }));
})();

const CITY_WINDOW_COLORS = ['103, 232, 249', '240, 171, 252', '253, 230, 138', '134, 239, 172']; // 青 / 品红 / 暖黄 / 绿

let cityCanvas: HTMLCanvasElement | null = null;
let cityKey = '';
let cityStripTop = 0; // 缓存条带画到主画布时的 y 起点
let CITY_MAX_H = 0;   // 当前布局下楼高的像素上限（信号灯定位也要用）

const getCityLayer = (w: number): HTMLCanvasElement | null => {
  const key = `${Math.round(w)}x${Math.round(GROUND_Y)}`;
  if (cityCanvas && cityKey === key) return cityCanvas;
  if (!cityCanvas) cityCanvas = document.createElement('canvas');

  const ground = GROUND_Y;
  // 楼高上限：不超过地平线上方天空的 55%，再高会压住平台上的战斗
  CITY_MAX_H = Math.min(ground * 0.55, 320);
  const stripH = Math.ceil(CITY_MAX_H + 26); // +26 = 天线 13 + 霓虹光晕外沿
  cityStripTop = ground - stripH;

  cityCanvas.width = Math.max(1, Math.round(w));
  cityCanvas.height = Math.max(1, stripH);
  const cctx = cityCanvas.getContext('2d');
  if (!cctx) return cityCanvas;

  // 改 width/height 会连同绘图状态一起重置，所以 translate 是在干净状态上做的：
  // 把原点挪到条带左上角，楼照旧按世界坐标 (x, ground) 画
  cctx.translate(0, -cityStripTop);

  CITY_BUILDINGS.forEach((b, bi) => {
    const bx = b.x * w;
    const bw = b.w * w;
    const bh = b.h * CITY_MAX_H;
    const by = ground - bh;

    // 楼体：很深的蓝紫，深浅略有差异，免得一排楼糊成一整块
    const d = 8 + b.tone * 10;
    cctx.fillStyle = `rgb(${d}, ${d + 2}, ${d + 16})`;
    cctx.fillRect(bx, by, bw, bh);

    // 亮窗：6x8 的小格子按 12x16 的间距铺，约四成是亮的。
    // 每栋楼单独一个种子：窗口变了这栋楼的亮窗只在楼内重排，不会串到隔壁楼
    const rand = mulberry32(20260707 + bi);
    const cols = Math.floor(bw / 12);
    const rows = Math.floor(bh / 16);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rand() > 0.42) continue;
        const wc = CITY_WINDOW_COLORS[Math.floor(rand() * CITY_WINDOW_COLORS.length)];
        cctx.fillStyle = `rgba(${wc}, ${0.25 + rand() * 0.6})`;
        cctx.fillRect(bx + 3 + c * 12, by + 5 + r * 16, 6, 8);
      }
    }

    // 天线：屋顶一根细杆，顶端的红灯由 drawNeonBackground 每帧闪
    if (b.antenna) {
      cctx.strokeStyle = 'rgba(30, 34, 58, 0.9)';
      cctx.lineWidth = 2;
      cctx.beginPath();
      cctx.moveTo(bx + bw / 2, by);
      cctx.lineTo(bx + bw / 2, by - 13);
      cctx.stroke();
    }

    // 霓虹顶边：两笔叠出光晕（宽半透明 + 窄实色），同移动平台的思路，不用 shadowBlur
    if (b.neon > 0.72) {
      const nc = b.neon > 0.87 ? '240, 171, 252' : '34, 211, 238'; // 品红或青
      cctx.strokeStyle = `rgba(${nc}, 0.35)`;
      cctx.lineWidth = 5;
      cctx.beginPath();
      cctx.moveTo(bx, by);
      cctx.lineTo(bx + bw, by);
      cctx.stroke();
      cctx.strokeStyle = `rgba(${nc}, 0.95)`;
      cctx.lineWidth = 1.6;
      cctx.beginPath();
      cctx.moveTo(bx, by);
      cctx.lineTo(bx + bw, by);
      cctx.stroke();
    }
  });

  cityKey = key;
  return cityCanvas;
};

const drawNeonBackground = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: number
) => {
  const t = frame * 0.004;

  // 1. 深空渐变底
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#050816');
  bg.addColorStop(0.45, '#0b1230');
  bg.addColorStop(1, '#1c0f2e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 2. 漂移的星云 / 极光
  ctx.globalCompositeOperation = 'screen';
  NEBULAE.forEach((n, i) => {
    const ox = Math.sin(t * (0.5 + i * 0.13) + i * 2.1) * w * 0.16;
    const oy = Math.cos(t * (0.4 + i * 0.11) + i * 1.7) * h * 0.12;
    const x = n.sx * w + ox;
    const y = n.sy * h + oy;
    const r = n.sr * Math.min(w, h) * 1.1;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${n.c}, ${n.a})`);
    g.addColorStop(0.6, `rgba(${n.c}, ${n.a * 0.4})`);
    g.addColorStop(1, `rgba(${n.c}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalCompositeOperation = 'source-over';

  // 3. 闪烁的星星
  for (let i = 0; i < STARS.length; i++) {
    const s = STARS[i];
    const tw = 0.25 + 0.75 * Math.abs(Math.sin(frame * s.speed + s.phase));
    ctx.globalAlpha = 0.1 + 0.9 * tw;
    ctx.fillStyle = '#e8ecff';
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 4. 城市天际线（整排楼已画进离屏缓存，每帧只贴一次；见 getCityLayer 的说明）
  {
    const layer = getCityLayer(w);
    if (layer) ctx.drawImage(layer, 0, cityStripTop);
  }

  // 5. 楼顶信号灯：唯一每帧重画的部分。几盏红色航空障碍灯轮流闪，城市才像活的 —— 开销只有几个圆点
  const ground = GROUND_Y;
  CITY_BEACONS.forEach((b) => {
    const blink = Math.sin(frame * b.speed + b.phase);
    if (blink <= 0.2) return; // 大部分时间灭着，闪一下才有"灯"的感觉
    const bx = b.x * w;
    const by = ground - b.h * CITY_MAX_H - 13;
    const alpha = 0.35 + 0.65 * blink;
    ctx.fillStyle = `rgba(248, 113, 113, ${alpha * 0.3})`;
    ctx.beginPath();
    ctx.arc(bx, by, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(254, 202, 202, ${alpha})`;
    ctx.beginPath();
    ctx.arc(bx, by, 1.8, 0, Math.PI * 2);
    ctx.fill();
  });
};

// ================= 森林动态背景 =================
interface ForestLeaf {
  x: number; // 归一化 0..1
  y: number;
  size: number;
  fallSpeed: number; // 像素 / 帧
  phase: number;
  drift: number;
  color: string;
}

const FOREST_LEAVES: ForestLeaf[] = (() => {
  const rand = mulberry32(20260213);
  const colors = ['#7ec850', '#c9e265', '#e0a94b', '#8fb843'];
  return Array.from({ length: 40 }, () => ({
    x: rand(),
    y: rand(),
    size: 4 + rand() * 6,
    fallSpeed: 0.4 + rand() * 1.4,
    phase: rand() * Math.PI * 2,
    drift: 12 + rand() * 30,
    color: colors[Math.floor(rand() * colors.length)],
  }));
})();

const drawForestBackground = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: number
) => {
  const t = frame * 0.01;

  // 1. 天空渐变
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#8fd3b5');
  sky.addColorStop(0.55, '#bde4b0');
  sky.addColorStop(1, '#e6f2c8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // 2. 树冠间洒下的阳光 + 斜射光柱
  ctx.globalCompositeOperation = 'screen';
  const sun = ctx.createRadialGradient(w * 0.55, h * 0.05, 0, w * 0.55, h * 0.05, w * 0.7);
  sun.addColorStop(0, 'rgba(255, 250, 205, 0.55)');
  sun.addColorStop(1, 'rgba(255, 250, 205, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 3; i++) {
    const bx = w * 0.25 + i * w * 0.22 + Math.sin(t + i * 1.3) * w * 0.04;
    const ray = ctx.createLinearGradient(bx, 0, bx + w * 0.2, h);
    ray.addColorStop(0, 'rgba(255, 255, 220, 0.14)');
    ray.addColorStop(1, 'rgba(255, 255, 220, 0)');
    ctx.fillStyle = ray;
    ctx.beginPath();
    ctx.moveTo(bx - w * 0.1, 0);
    ctx.lineTo(bx + w * 0.25, 0);
    ctx.lineTo(bx + w * 0.12, h);
    ctx.lineTo(bx - w * 0.3, h);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // 3. 远山 / 树林剪影
  const treeline = (baseY: number, r: number, color: string) => {
    ctx.fillStyle = color;
    for (let i = 0; i < 9; i++) {
      const cx = (i * w) / 9 + Math.sin(t * 0.4 + i * 2.3) * 10;
      const tr = r * (0.7 + ((i * 13) % 5) * 0.12);
      ctx.beginPath();
      ctx.arc(cx, baseY, tr, Math.PI, 0);
      ctx.fill();
    }
  };
  treeline(h * 0.82, h * 0.3, 'rgba(90, 150, 100, 0.25)');
  treeline(h * 0.88, h * 0.36, 'rgba(70, 120, 85, 0.35)');

  // 4. 两侧近景树干（剪影，营造森林包围感）
  const drawTrunk = (x: number, scale: number) => {
    ctx.fillStyle = 'rgba(58, 80, 50, 0.45)';
    ctx.fillRect(x - 14 * scale, h * 0.12, 28 * scale, h * 0.9);
    ctx.fillStyle = 'rgba(42, 66, 42, 0.5)';
    const cy = h * 0.12;
    ctx.beginPath(); ctx.arc(x, cy, 92 * scale, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.arc(x - 58 * scale, cy + 30 * scale, 55 * scale, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 58 * scale, cy + 30 * scale, 55 * scale, Math.PI, 0); ctx.fill();
  };
  drawTrunk(w * 0.045, 1.05);
  drawTrunk(w * 0.955, 0.95);

  // 5. 飘落的树叶
  // 旋转交给 ellipse() 自己的 rotation 参数，不再每片叶子 save/translate/rotate/restore：
  // 那四个调用（尤其是 save/restore 要压栈整个绘图状态）在几十片叶子上是白花的。
  ctx.globalAlpha = 0.75;
  FOREST_LEAVES.forEach((leaf) => {
    const fx = leaf.x * w + Math.sin(frame * 0.012 + leaf.phase) * leaf.drift;
    const fy = ((leaf.y * h + frame * leaf.fallSpeed) % (h + 80)) - 40;
    ctx.fillStyle = leaf.color;
    ctx.beginPath();
    ctx.ellipse(fx, fy, leaf.size, leaf.size * 0.5, Math.sin(frame * 0.03 + leaf.phase) * 0.9, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
};

// ================= 沙漠动态背景 =================
interface DesertSand {
  x: number;
  y: number;
  size: number;
  speed: number; // 横向漂移速度
  phase: number;
  color: string;
}

const DESERT_SAND: DesertSand[] = (() => {
  const rand = mulberry32(20260308);
  const colors = ['#f4d49a', '#eac378', '#ffe8b8'];
  return Array.from({ length: 50 }, () => ({
    x: rand(),
    y: rand() * 0.7,
    size: 1.5 + rand() * 2.5,
    speed: 0.5 + rand() * 1.2,
    phase: rand() * Math.PI * 2,
    color: colors[Math.floor(rand() * colors.length)],
  }));
})();

const drawDesertBackground = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: number
) => {
  const t = frame * 0.008;

  // 1. 暖色天空渐变
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#ffc96b');
  sky.addColorStop(0.5, '#ffe0a3');
  sky.addColorStop(1, '#fff3d6');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // 2. 太阳光晕 + 圆盘
  const sunX = w * 0.5 + Math.sin(t * 0.4) * w * 0.02;
  const sunY = h * 0.3;
  ctx.globalCompositeOperation = 'screen';
  const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, w * 0.5);
  halo.addColorStop(0, 'rgba(255, 250, 230, 0.9)');
  halo.addColorStop(0.3, 'rgba(255, 240, 200, 0.45)');
  halo.addColorStop(1, 'rgba(255, 230, 160, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(255, 246, 210, 0.9)';
  ctx.beginPath();
  ctx.arc(sunX, sunY, 44, 0, Math.PI * 2);
  ctx.fill();

  // 3. 分层沙丘
  const dune = (baseY: number, amp: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, baseY);
    for (let x = 0; x <= w; x += 20) {
      const y = baseY - Math.sin((x / w) * Math.PI * 2 + amp * 0.1) * amp
                   - Math.sin((x / w) * Math.PI * 4) * amp * 0.4;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  };
  dune(h * 0.86, h * 0.06, 'rgba(232, 178, 110, 0.55)');
  dune(h * 0.92, h * 0.09, 'rgba(215, 158, 90, 0.7)');

  // 4. 仙人掌剪影
  const cactus = (x: number, scale: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x - 5 * scale, h * 0.55, 10 * scale, h * 0.45);
    ctx.fillRect(x - 22 * scale, h * 0.62, 10 * scale, h * 0.2);
    ctx.fillRect(x + 12 * scale, h * 0.58, 10 * scale, h * 0.18);
    ctx.fillRect(x - 40 * scale, h * 0.62, 16 * scale, 6 * scale);
    ctx.fillRect(x + 22 * scale, h * 0.58, 16 * scale, 6 * scale);
  };
  cactus(w * 0.06, 0.9, 'rgba(120, 150, 90, 0.5)');
  cactus(w * 0.94, 0.8, 'rgba(110, 140, 82, 0.5)');
  cactus(w * 0.16, 0.5, 'rgba(130, 158, 96, 0.4)');

  // 5. 飘动的沙尘
  DESERT_SAND.forEach((s) => {
    const sx = ((s.x * w + frame * s.speed) % (w + 40)) - 20;
    const sy = s.y * h * 0.7 + Math.sin(frame * 0.02 + s.phase) * 8;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(sx, sy, s.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
};

// ================= 海洋动态背景 =================
interface OceanBubble {
  x: number;
  y: number;
  size: number;
  speed: number; // 上升速度
  phase: number;
}

const OCEAN_BUBBLES: OceanBubble[] = (() => {
  const rand = mulberry32(20260415);
  return Array.from({ length: 60 }, () => ({
    x: rand(),
    y: rand(),
    size: 1.5 + rand() * 3.5,
    speed: 0.6 + rand() * 1.6,
    phase: rand() * Math.PI * 2,
  }));
})();

const drawOceanBackground = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: number
) => {
  // 1. 水下渐变
  const water = ctx.createLinearGradient(0, 0, 0, h);
  water.addColorStop(0, '#8fd8ec');
  water.addColorStop(0.45, '#3f9fd0');
  water.addColorStop(1, '#0b3350');
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, w, h);

  // 2. 从水面射入的光柱
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 4; i++) {
    const bx = w * (0.15 + i * 0.22) + Math.sin(frame * 0.008 + i) * w * 0.03;
    const ray = ctx.createLinearGradient(bx, 0, bx + w * 0.12, h);
    ray.addColorStop(0, 'rgba(210, 245, 255, 0.18)');
    ray.addColorStop(1, 'rgba(180, 230, 255, 0)');
    ctx.fillStyle = ray;
    ctx.beginPath();
    ctx.moveTo(bx - w * 0.06, 0);
    ctx.lineTo(bx + w * 0.1, 0);
    ctx.lineTo(bx + w * 0.24, h);
    ctx.lineTo(bx - w * 0.08, h);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // 3. 上升的气泡
  OCEAN_BUBBLES.forEach((b) => {
    const bx = b.x * w + Math.sin(frame * 0.02 + b.phase) * 18;
    const by = h - ((b.y * h + frame * b.speed) % (h + 80)) + 40;
    ctx.strokeStyle = 'rgba(220, 245, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(bx, by, b.size, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.arc(bx - b.size * 0.3, by - b.size * 0.3, b.size * 0.3, 0, Math.PI * 2);
    ctx.fill();
  });

  // 4. 游动的小鱼
  /*
    速度原来是 18~36 px/帧（≈1100~2200 px/s），一条鱼一秒多就横穿整个屏幕，根本不是游是飞。
    改成 0.7~1.8 px/帧（≈40~110 px/s），横穿要十几秒，才有鱼群慢慢游的感觉。
    游速降下来之后，死板的三角尾巴会很显眼，所以加了摆尾和眼睛。
  */
  for (let i = 0; i < 4; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    const speed = 0.7 + i * 0.35;
    const px = ((frame * speed * dir + i * w * 0.28) % (w + 140) + (w + 140)) % (w + 140) - 70;
    const py = h * (0.2 + i * 0.16) + Math.sin(frame * 0.03 + i) * 14;
    const wag = Math.sin(frame * 0.16 + i * 2.1) * 4.5; // 尾巴左右摆
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(dir, 1);
    ctx.fillStyle = 'rgba(245, 175, 90, 0.5)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(-22, -7 + wag);
    ctx.lineTo(-22, 7 + wag);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'; // 眼睛
    ctx.beginPath();
    ctx.arc(7, -2, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(20, 30, 45, 0.85)';
    ctx.beginPath();
    ctx.arc(7.8, -2, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
};

// ================= 火山动态背景 =================
interface VolcanoEmber {
  x: number;
  y: number;
  size: number;
  speed: number; // 上升速度
  phase: number;
  color: string;
}

const VOLCANO_EMBERS: VolcanoEmber[] = (() => {
  const rand = mulberry32(20260502);
  const colors = ['#ff6b35', '#ff8c42', '#ffb347', '#ff4d3a'];
  return Array.from({ length: 45 }, () => ({
    x: rand(),
    y: rand(),
    size: 1 + rand() * 2.5,
    speed: 0.8 + rand() * 1.8,
    phase: rand() * Math.PI * 2,
    color: colors[Math.floor(rand() * colors.length)],
  }));
})();

const drawVolcanoBackground = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: number
) => {
  // 1. 暗红天空渐变
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1c0e12');
  sky.addColorStop(0.5, '#3d1a16');
  sky.addColorStop(1, '#7a2d14');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // 2. 火山锥剪影
  ctx.fillStyle = '#240f12';
  ctx.beginPath();
  ctx.moveTo(w * 0.12, h * 0.92);
  ctx.lineTo(w * 0.5, h * 0.34);
  ctx.lineTo(w * 0.88, h * 0.92);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#150a0c';
  ctx.fillRect(w * 0.5 - 26, h * 0.34 - 4, 52, 10);

  // 3. 火山口岩浆辉光（脉动）
  const cx = w * 0.5;
  const cy = h * 0.36;
  const pulse = 0.75 + Math.sin(frame * 0.04) * 0.2;
  ctx.globalCompositeOperation = 'screen';
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.32);
  glow.addColorStop(0, `rgba(255, 130, 40, ${0.85 * pulse})`);
  glow.addColorStop(0.4, `rgba(255, 70, 20, ${0.4 * pulse})`);
  glow.addColorStop(1, 'rgba(255, 40, 10, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // 喷发的火星
  for (let i = 0; i < 12; i++) {
    const a = frame * 0.12 + i * 0.55;
    const rise = Math.abs(Math.sin(a));
    const px = cx + Math.sin(a * 0.8 + i) * 40;
    const py = cy - rise * h * 0.22;
    ctx.fillStyle = `rgba(255, ${120 + (i * 17) % 100}, 40, ${1 - rise})`;
    ctx.beginPath();
    ctx.arc(px, py, 2.5 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // 4. 上升的火星 / 灰烬
  VOLCANO_EMBERS.forEach((e) => {
    const ex = e.x * w + Math.sin(frame * 0.02 + e.phase) * 20;
    const ey = h - ((e.y * h + frame * e.speed) % (h + 60)) + 30;
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(ex, ey, e.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
};

// ================= 黑夜动态背景 =================
// 和其他地图同一套约定：静态元素（星星）用固定种子 PRNG 预生成，帧间一致；
// 动态效果（眨眼、萤火虫飘）以 frame 为时间轴。
interface NightStar {
  x: number;
  y: number;
  size: number;
  phase: number;
  speed: number; // 眨眼节奏
}

interface NightFirefly {
  x: number;
  y: number;
  size: number;
  phase: number;
  drift: number; // 飘动幅度
  speed: number;
}

const NIGHT_STARS: NightStar[] = (() => {
  const rand = mulberry32(20260925);
  return Array.from({ length: 90 }, () => ({
    x: rand(),
    y: rand() * 0.62, // 只在上半屏，月亮和星空的位置
    size: 0.8 + rand() * 2.2,
    phase: rand() * Math.PI * 2,
    speed: 0.02 + rand() * 0.06,
  }));
})();

const NIGHT_FIREFLIES: NightFirefly[] = (() => {
  const rand = mulberry32(20260926);
  return Array.from({ length: 14 }, () => ({
    x: 0.06 + rand() * 0.88,
    y: 0.62 + rand() * 0.28, // 贴着草地上方低飞
    size: 2 + rand() * 2.5,
    phase: rand() * Math.PI * 2,
    drift: 14 + rand() * 26,
    speed: 0.008 + rand() * 0.012,
  }));
})();

const drawNightBackground = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: number
) => {
  // 1. 夜空渐变：藏青 → 深蓝，贴近地平线透一点夜色蓝
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0b1026');
  sky.addColorStop(0.55, '#131a3a');
  sky.addColorStop(1, '#1c2650');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // 2. 星星：正弦眨眼，亮度偶尔到 0 也像真的
  NIGHT_STARS.forEach(s => {
    const a = 0.35 + 0.65 * Math.max(0, Math.sin(frame * s.speed + s.phase));
    ctx.fillStyle = `rgba(226, 232, 255, ${a})`;
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.size, 0, Math.PI * 2);
    ctx.fill();
  });

  // 3. 月亮：右上角，带柔光和几个环形山
  const mx = w * 0.82;
  const my = h * 0.18;
  const mr = Math.min(w, h) * 0.075;
  ctx.globalCompositeOperation = 'screen';
  const halo = ctx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 4);
  halo.addColorStop(0, 'rgba(255, 250, 220, 0.28)');
  halo.addColorStop(1, 'rgba(255, 250, 220, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#f8f4da';
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(200, 190, 160, 0.5)';
  ctx.beginPath(); ctx.arc(mx - mr * 0.3, my - mr * 0.25, mr * 0.18, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(mx + mr * 0.25, my + mr * 0.1, mr * 0.12, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(mx - mr * 0.05, my + mr * 0.4, mr * 0.08, 0, Math.PI * 2); ctx.fill();

  // 4. 远山剪影：两层，越近越深
  ctx.fillStyle = 'rgba(23, 30, 62, 0.8)';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.9);
  for (let i = 0; i <= 8; i++) {
    ctx.quadraticCurveTo(
      (i - 0.5) * (w / 8), h * (0.72 + ((i * 7) % 5) * 0.018),
      i * (w / 8), h * (0.8 + ((i * 3) % 4) * 0.012)
    );
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

    // 5. 萤火虫：草地上一亮一灭地飘（亮的时候才画光晕）
    NIGHT_FIREFLIES.forEach(f => {
        const fx = f.x * w + Math.sin(frame * 0.01 + f.phase) * f.drift;
        const fy = f.y * h + Math.cos(frame * 0.013 + f.phase * 1.7) * f.drift * 0.4;
        const a = Math.max(0, Math.sin(frame * f.speed * 60 * 0.05 + f.phase));
        if (a <= 0.05) return;
        ctx.fillStyle = `rgba(214, 255, 138, ${0.7 * a})`;
        ctx.beginPath();
        ctx.arc(fx, fy, f.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(190, 255, 120, ${0.16 * a})`;
        ctx.beginPath();
        ctx.arc(fx, fy, f.size * 3.2, 0, Math.PI * 2);
        ctx.fill();
    });
};

// ================= 雪原动态背景 =================
// 同一套约定：静态元素（雪花）用固定种子 PRNG 预生成，帧间一致；
// 动态效果（下雪、摇摆）以 frame 为时间轴。
interface Snowflake {
    x: number;
    y: number;
    size: number;
    speed: number; // 下落速度
    phase: number; // 左右摇摆相位
    sway: number;  // 摇摆幅度
}

const SNOWFLAKES: Snowflake[] = (() => {
    const rand = mulberry32(20261225);
    return Array.from({ length: 80 }, () => ({
        x: rand(),
        y: rand(),
        size: 1 + rand() * 2.6,
        speed: 0.5 + rand() * 1.1,
        phase: rand() * Math.PI * 2,
        sway: 10 + rand() * 26,
    }));
})();

// 山顶积雪：尖顶下沿画成锯齿，像被风刮过的雪线
const drawSnowCap = (
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    s: number
) => {
    ctx.beginPath();
    ctx.moveTo(px - s, py + s * 1.1);
    ctx.lineTo(px, py);
    ctx.lineTo(px + s, py + s * 1.1);
    ctx.lineTo(px + s * 0.4, py + s * 0.72);
    ctx.lineTo(px, py + s * 0.95);
    ctx.lineTo(px - s * 0.4, py + s * 0.72);
    ctx.closePath();
    ctx.fill();
};

const drawSnowBackground = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    frame: number
) => {
    // 1. 冬日天空：淡蓝渐变到地平线近乎白色，冷但不压抑
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#6ba3d8');
    sky.addColorStop(0.55, '#a9cdec');
    sky.addColorStop(1, '#e8f3fc');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 2. 冬日低阳：雪天的太阳白白淡淡，光晕比本体显眼
    const sunX = w * 0.76;
    const sunY = h * 0.18;
    const sunR = Math.min(w, h) * 0.055;
    ctx.globalCompositeOperation = 'screen';
    const halo = ctx.createRadialGradient(sunX, sunY, sunR * 0.3, sunX, sunY, sunR * 5);
    halo.addColorStop(0, 'rgba(255, 246, 220, 0.5)');
    halo.addColorStop(1, 'rgba(255, 246, 220, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff7e0';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();

    // 3. 雪山：远浅近深两层，各自点几笔雪顶
    ctx.fillStyle = 'rgba(205, 226, 244, 0.95)';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.86);
    ctx.lineTo(w * 0.16, h * 0.52);
    ctx.lineTo(w * 0.34, h * 0.86);
    ctx.lineTo(w * 0.5, h * 0.58);
    ctx.lineTo(w * 0.68, h * 0.86);
    ctx.lineTo(w * 0.86, h * 0.5);
    ctx.lineTo(w, h * 0.78);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f6fbff';
    drawSnowCap(ctx, w * 0.16, h * 0.52, w * 0.035);
    drawSnowCap(ctx, w * 0.5, h * 0.58, w * 0.03);
    drawSnowCap(ctx, w * 0.86, h * 0.5, w * 0.032);

    ctx.fillStyle = '#b7d2e9';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.92);
    ctx.lineTo(w * 0.28, h * 0.62);
    ctx.lineTo(w * 0.52, h * 0.92);
    ctx.lineTo(w * 0.78, h * 0.6);
    ctx.lineTo(w, h * 0.88);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f6fbff';
    drawSnowCap(ctx, w * 0.28, h * 0.62, w * 0.028);
    drawSnowCap(ctx, w * 0.78, h * 0.6, w * 0.03);

    // 4. 雪松林剪影：深青松针压一层白雪，高矮错落（固定排布，帧间一致）
    for (let i = 0; i < 9; i++) {
        const tx = w * (0.06 + i * 0.115);
        const th = h * (0.08 + ((i * 7) % 4) * 0.015);
        const tw = th * 0.42;
        const base = h * 0.93;
        ctx.fillStyle = '#2f5d50';
        ctx.beginPath();
        ctx.moveTo(tx - tw, base);
        ctx.lineTo(tx, base - th * 0.55);
        ctx.lineTo(tx + tw, base);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(tx - tw * 0.7, base - th * 0.38);
        ctx.lineTo(tx, base - th);
        ctx.lineTo(tx + tw * 0.7, base - th * 0.38);
        ctx.closePath();
        ctx.fill();
        // 树顶积雪
        ctx.fillStyle = '#f6fbff';
        ctx.beginPath();
        ctx.moveTo(tx - tw * 0.28, base - th * 0.78);
        ctx.lineTo(tx, base - th);
        ctx.lineTo(tx + tw * 0.28, base - th * 0.78);
        ctx.closePath();
        ctx.fill();
    }

    // 5. 下雪：正弦摇摆着往下飘，落出屏幕就回顶部接着下
    SNOWFLAKES.forEach(f => {
        const fx = ((f.x * w + Math.sin(frame * 0.015 + f.phase) * f.sway) % w + w) % w;
        const fy = ((f.y * h + frame * f.speed) % (h + 10)) - 5;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.55 + (f.size / 3.6) * 0.4})`;
        ctx.beginPath();
        ctx.arc(fx, fy, f.size, 0, Math.PI * 2);
        ctx.fill();
    });
};

// ================= 草原动态背景 =================
// 开阔草甸：蓝天白云 + 缓丘 + 旋转风车 + 野花 + 蝴蝶。
// 同一套约定：静态元素用固定种子 PRNG 预生成，动态元素以 frame 为时间轴。
interface PrairieCloud {
    x: number;
    y: number;
    scale: number;
    speed: number;
}

interface PrairieFlower {
    x: number;
    y: number;
    color: string;
}

const PRAIRIE_CLOUDS: PrairieCloud[] = (() => {
    const rand = mulberry32(20270303);
    return Array.from({ length: 6 }, () => ({
        x: rand(),
        y: 0.06 + rand() * 0.32,
        scale: 0.55 + rand() * 0.7,
        speed: 0.08 + rand() * 0.12,
    }));
})();

const PRAIRIE_FLOWERS: PrairieFlower[] = (() => {
    const rand = mulberry32(20270304);
    const colors = ['#ff5d8f', '#ffd23f', '#ffffff', '#c084fc', '#fb923c'];
    return Array.from({ length: 26 }, () => ({
        x: rand(),
        y: 0.84 + rand() * 0.1,
        color: colors[Math.floor(rand() * colors.length)],
    }));
})();

// 卡通白云：几个圆弧叠出蓬松感
const drawPuff = (ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) => {
    ctx.beginPath();
    ctx.arc(cx, cy, 18 * s, 0, Math.PI * 2);
    ctx.arc(cx + 20 * s, cy - 7 * s, 22 * s, 0, Math.PI * 2);
    ctx.arc(cx + 46 * s, cy, 17 * s, 0, Math.PI * 2);
    ctx.arc(cx + 23 * s, cy + 8 * s, 20 * s, 0, Math.PI * 2);
    ctx.fill();
};

// 草原风车：白色塔身 + 四叶旋翼
const drawWindmill = (
    ctx: CanvasRenderingContext2D,
    x: number,
    baseY: number,
    s: number,
    frame: number
) => {
    // 塔身（上窄下宽）
    ctx.fillStyle = '#f4f6f8';
    ctx.beginPath();
    ctx.moveTo(x - 15 * s, baseY);
    ctx.lineTo(x - 5 * s, baseY - 95 * s);
    ctx.lineTo(x + 5 * s, baseY - 95 * s);
    ctx.lineTo(x + 15 * s, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 150, 180, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 小门
    ctx.fillStyle = '#9aa8b8';
    ctx.beginPath();
    ctx.arc(x, baseY, 5 * s, Math.PI, 0);
    ctx.fill();
    // 顶舱
    const hubY = baseY - 100 * s;
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(x, hubY, 7 * s, 0, Math.PI * 2);
    ctx.fill();
    // 四片旋翼（绕轴匀速转）
    ctx.save();
    ctx.translate(x, hubY);
    ctx.rotate(frame * 0.025);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(3 * s, -30 * s);
        ctx.lineTo(-3 * s, -30 * s);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#7c8da0';
    ctx.beginPath();
    ctx.arc(x, hubY, 3 * s, 0, Math.PI * 2);
    ctx.fill();
};

const drawPrairieBackground = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    frame: number
) => {
    // 1. 明亮蓝天：头顶深蓝，地平线染成暖洋洋的浅色
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#4f9be8');
    sky.addColorStop(0.6, '#93c7f2');
    sky.addColorStop(1, '#dceffb');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 2. 太阳：亮黄圆 + 转圈的短线光芒
    const sunX = w * 0.8;
    const sunY = h * 0.16;
    const sunR = Math.min(w, h) * 0.05;
    ctx.globalCompositeOperation = 'screen';
    const halo = ctx.createRadialGradient(sunX, sunY, sunR * 0.5, sunX, sunY, sunR * 4.5);
    halo.addColorStop(0, 'rgba(255, 236, 150, 0.55)');
    halo.addColorStop(1, 'rgba(255, 236, 150, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffdd55';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 221, 85, 0.7)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + frame * 0.004;
        ctx.beginPath();
        ctx.moveTo(sunX + Math.cos(a) * sunR * 1.5, sunY + Math.sin(a) * sunR * 1.5);
        ctx.lineTo(sunX + Math.cos(a) * sunR * 2.1, sunY + Math.sin(a) * sunR * 2.1);
        ctx.stroke();
    }

    // 3. 白云：慢慢从右往左飘，飘出屏幕从右边再进来
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    PRAIRIE_CLOUDS.forEach(c => {
        const cx = ((c.x * w - frame * c.speed) % (w + 160) + (w + 160)) % (w + 160) - 80;
        drawPuff(ctx, cx, c.y * h, c.scale);
    });

    // 4. 起伏缓丘：远丘浅、近丘深，丘线用固定相位（帧间不跳动）
    ctx.fillStyle = '#a7dc7e';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += w / 16) {
        ctx.lineTo(x, h * 0.8 + Math.sin(x * 0.006 + 1.2) * h * 0.045);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#84c95c';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += w / 16) {
        ctx.lineTo(x, h * 0.88 + Math.sin(x * 0.008 + 3.4) * h * 0.035);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // 5. 风车：两座，立在远丘线上，叶片一直转
    drawWindmill(ctx, w * 0.2, h * 0.82, Math.min(w, h) / 600, frame);
    drawWindmill(ctx, w * 0.66, h * 0.85, Math.min(w, h) / 720, frame);

    // 6. 野花：近丘上的小点点（花茎一小竖 + 花头）
    PRAIRIE_FLOWERS.forEach(f => {
        const fx = f.x * w;
        const fy = f.y * h;
        ctx.strokeStyle = '#4e8a36';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(fx, fy + 8);
        ctx.lineTo(fx, fy + 2);
        ctx.stroke();
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(fx, fy, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.arc(fx, fy, 0.9, 0, Math.PI * 2);
        ctx.fill();
    });

    // 7. 蝴蝶：沿波浪线低飞，翅膀一扇一扇（3 只，颜色不同）
    const butterflyColors = ['#ff8fab', '#ffb703', '#c084fc'];
    for (let i = 0; i < 3; i++) {
        const speed = 0.7 + i * 0.25;
        const bx = ((frame * speed + i * w * 0.37) % (w + 60) + (w + 60)) % (w + 60) - 30;
        const by = h * (0.62 + i * 0.08) + Math.sin(frame * 0.08 + i * 2) * 16;
        const flap = Math.abs(Math.sin(frame * 0.35 + i)) * 6 + 2;
        ctx.fillStyle = butterflyColors[i];
        // 左翅 / 右翅
        ctx.beginPath();
        ctx.ellipse(bx - 4, by, 4.5, flap, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(bx + 4, by, 4.5, flap, 0.3, 0, Math.PI * 2);
        ctx.fill();
        // 身体
        ctx.strokeStyle = '#3f3f3f';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(bx, by - 5);
        ctx.lineTo(bx, by + 5);
        ctx.stroke();
    }
};

// ================= 冰川动态背景 =================
// 极地冰原：极光 + 层叠冰川崖 + 远海浮冰 + 企鹅 + 飘落冰晶。
// 与雪原（白天、雪丘雪松）区分：这是偏夜的冷青色极地，冰是半透明的深蓝色。
interface GlacierCrystal {
    x: number;
    y: number;
    size: number;
    speed: number;
    phase: number;
    sway: number;
}

const GLACIER_CRYSTALS: GlacierCrystal[] = (() => {
    const rand = mulberry32(20270707);
    return Array.from({ length: 42 }, () => ({
        x: rand(),
        y: rand(),
        size: 1.5 + rand() * 3,
        speed: 0.4 + rand() * 0.9,
        phase: rand() * Math.PI * 2,
        sway: 8 + rand() * 18,
    }));
})();

// 极光带：沿一条正弦曲线画柔光宽带，颜色随水平位置渐变
const drawAurora = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    frame: number,
    baseY: number,
    amp: number,
    phaseShift: number,
    c1: string,
    c2: string
) => {
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, c1);
    grad.addColorStop(0.5, c2);
    grad.addColorStop(1, c1);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, baseY - 30);
    for (let x = 0; x <= w; x += 24) {
        ctx.lineTo(x, baseY + Math.sin(x * 0.006 + frame * 0.01 + phaseShift) * amp);
    }
    for (let x = w; x >= 0; x -= 24) {
        ctx.lineTo(x, baseY + 26 + Math.sin(x * 0.005 + frame * 0.012 + phaseShift + 1) * amp * 0.7);
    }
    ctx.closePath();
    ctx.fill();
};

// 小企鹅：黑背白肚 + 黄围巾，站定时左右微微晃
const drawPenguin = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    frame: number,
    phase: number
) => {
    const sway = Math.sin(frame * 0.03 + phase) * 0.06;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(sway);
    // 身体
    ctx.fillStyle = '#2b2f3a';
    ctx.beginPath();
    ctx.ellipse(0, -12 * s, 9 * s, 13 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // 白肚皮
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.ellipse(0, -9 * s, 5.5 * s, 9 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // 头（与背同色，叠在顶上）
    ctx.fillStyle = '#2b2f3a';
    ctx.beginPath();
    ctx.arc(0, -22 * s, 7 * s, 0, Math.PI * 2);
    ctx.fill();
    // 眼睛
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-2.6 * s, -23 * s, 1.8 * s, 0, Math.PI * 2);
    ctx.arc(2.6 * s, -23 * s, 1.8 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(-2.6 * s, -23 * s, 0.9 * s, 0, Math.PI * 2);
    ctx.arc(2.6 * s, -23 * s, 0.9 * s, 0, Math.PI * 2);
    ctx.fill();
    // 嘴
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(-2 * s, -20 * s);
    ctx.lineTo(2 * s, -20 * s);
    ctx.lineTo(0, -17 * s);
    ctx.closePath();
    ctx.fill();
    // 黄围巾
    ctx.fillStyle = '#facc15';
    roundRectPath(ctx, -7 * s, -16 * s, 14 * s, 3.5 * s, 1.5 * s);
    ctx.fill();
    // 脚
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.ellipse(-3.5 * s, 0, 3 * s, 1.5 * s, 0, 0, Math.PI * 2);
    ctx.ellipse(3.5 * s, 0, 3 * s, 1.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
};

const drawGlacierBackground = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    frame: number
) => {
    // 1. 极地夜空：深青蓝 → 地平线处泛冰光
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0a2036');
    sky.addColorStop(0.55, '#12415c');
    sky.addColorStop(1, '#5e93ac');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 2. 稀疏寒星（上半天区）
    const starRand = mulberry32(20270708);
    ctx.fillStyle = 'rgba(220, 240, 255, 0.8)';
    for (let i = 0; i < 40; i++) {
        const sx = starRand() * w;
        const sy = starRand() * h * 0.3;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(frame * 0.03 + i));
        ctx.globalAlpha = tw;
        ctx.beginPath();
        ctx.arc(sx, sy, 0.8 + starRand() * 1.2, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 3. 极光：两条半透明光带缓缓流动（screen 混合才会发光）
    ctx.globalCompositeOperation = 'screen';
    drawAurora(ctx, w, h, frame, h * 0.2, h * 0.05, 0,
        'rgba(74, 222, 128, 0.16)', 'rgba(125, 211, 252, 0.2)');
    drawAurora(ctx, w, h, frame, h * 0.3, h * 0.04, 2.4,
        'rgba(167, 139, 250, 0.14)', 'rgba(110, 231, 183, 0.18)');
    ctx.globalCompositeOperation = 'source-over';

    // 4. 远海与冰架：深色海平线 + 锯齿状冰崖剪影
    ctx.fillStyle = '#1d4a63';
    ctx.fillRect(0, h * 0.72, w, h * 0.12);
    // 海面浮冰：几个浅色小多边形随波轻晃
    ctx.fillStyle = 'rgba(214, 240, 250, 0.85)';
    for (let i = 0; i < 5; i++) {
        const bx = w * (0.08 + i * 0.2);
        const by = h * 0.78 + Math.sin(frame * 0.03 + i) * 2;
        ctx.beginPath();
        ctx.moveTo(bx - 16, by);
        ctx.lineTo(bx - 8, by - 5);
        ctx.lineTo(bx + 8, by - 4);
        ctx.lineTo(bx + 16, by);
        ctx.closePath();
        ctx.fill();
    }

    // 5. 大冰川崖（两侧）：层叠半透明蓝冰 + 裂纹线
    const cliffGrad = ctx.createLinearGradient(0, h * 0.4, 0, h);
    cliffGrad.addColorStop(0, '#bfe8f5');
    cliffGrad.addColorStop(1, '#5f9fbd');
    ctx.fillStyle = cliffGrad;
    // 左崖
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.52);
    ctx.lineTo(w * 0.07, h * 0.46);
    ctx.lineTo(w * 0.13, h * 0.6);
    ctx.lineTo(w * 0.1, h);
    ctx.closePath();
    ctx.fill();
    // 右崖
    ctx.beginPath();
    ctx.moveTo(w, h);
    ctx.lineTo(w, h * 0.48);
    ctx.lineTo(w * 0.93, h * 0.44);
    ctx.lineTo(w * 0.87, h * 0.62);
    ctx.lineTo(w * 0.9, h);
    ctx.closePath();
    ctx.fill();
    // 冰裂纹（深蓝细线）与冰面层高光
    ctx.strokeStyle = 'rgba(30, 90, 130, 0.5)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
        const side = i < 3;
        const cx = side ? w * (0.02 + (i * 0.03)) : w * (0.9 - ((i - 3) * 0.03));
        const cy = h * (0.56 + (i % 3) * 0.12);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + 6, cy + 14);
        ctx.lineTo(cx + 2, cy + 28);
        ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.52);
    ctx.lineTo(w * 0.07, h * 0.46);
    ctx.lineTo(w * 0.1, h * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w, h * 0.48);
    ctx.lineTo(w * 0.93, h * 0.44);
    ctx.lineTo(w * 0.92, h * 0.52);
    ctx.closePath();
    ctx.fill();

    // 6. 中景冰架上的企鹅：三只，面朝同一方向轻轻晃
    drawPenguin(ctx, w * 0.32, h * 0.84, Math.min(w, h) / 560, frame, 0);
    drawPenguin(ctx, w * 0.38, h * 0.85, Math.min(w, h) / 660, frame, 1.5);
    drawPenguin(ctx, w * 0.62, h * 0.84, Math.min(w, h) / 600, frame, 3);

    // 7. 飘落冰晶：菱形小冰片（不是圆形雪花），斜斜地缓缓落下
    GLACIER_CRYSTALS.forEach(c => {
        const cx = ((c.x * w + Math.sin(frame * 0.012 + c.phase) * c.sway) % w + w) % w;
        const cy = ((c.y * h + frame * c.speed) % (h + 10)) - 5;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(frame * 0.02 + c.phase);
        ctx.fillStyle = 'rgba(224, 247, 255, 0.8)';
        ctx.beginPath();
        ctx.moveTo(0, -c.size);
        ctx.lineTo(c.size * 0.6, 0);
        ctx.lineTo(0, c.size);
        ctx.lineTo(-c.size * 0.6, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    });
};

// ================= 太空动态背景 =================
// 外太空：深空星云 + 带环行星 + 漂浮陨石 + 巡逻 UFO + 流星 + 漂浮尘埃。
// 与霓虹（夜空下有城市剪影和地面灯火）区分：这里没有地平线，整片都是宇宙空间。
interface SpaceStar {
    x: number;
    y: number;
    size: number;
    phase: number;
}

interface SpaceAsteroid {
    x: number;
    y: number;
    r: number;
    phase: number;
    rotSpeed: number;
    drift: number;
    verts: number[];
}

const SPACE_STARS: SpaceStar[] = (() => {
    const rand = mulberry32(20271010);
    return Array.from({ length: 110 }, () => ({
        x: rand(),
        y: rand(),
        size: 0.7 + rand() * 1.8,
        phase: rand() * Math.PI * 2,
    }));
})();

const SPACE_ASTEROIDS: SpaceAsteroid[] = (() => {
    const rand = mulberry32(20271011);
    return Array.from({ length: 6 }, () => {
        const r = 14 + rand() * 26;
        const n = 8 + Math.floor(rand() * 3);
        // 各顶点半径抖动，画出来才是坑坑洼洼的石头，而不是圆
        const verts = Array.from({ length: n }, () => 0.72 + rand() * 0.38);
        return {
            x: rand(),
            y: rand(),
            r,
            phase: rand() * Math.PI * 2,
            rotSpeed: (rand() - 0.5) * 0.01,
            drift: 0.05 + rand() * 0.1,
            verts,
        };
    });
})();

// 带环行星（卡通土星）：先画光环，再画本体盖住中间段
const drawRingedPlanet = (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    frame: number
) => {
    // 光环：两条倾斜椭圆线
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.28);
    ctx.strokeStyle = 'rgba(232, 180, 255, 0.75)';
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.95, r * 0.62, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 240, 200, 0.8)';
    ctx.lineWidth = r * 0.06;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.7, r * 0.52, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // 行星本体（本体盖住光环中段，自然形成环绕效果）
    const body = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    body.addColorStop(0, '#c084fc');
    body.addColorStop(0.55, '#8b5cf6');
    body.addColorStop(1, '#5b3a9e');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // 表面条纹（用裁剪只留在圆内）
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    for (let i = -2; i <= 2; i++) {
        ctx.fillRect(cx - r, cy + i * r * 0.34 - 3, r * 2, r * 0.1);
    }
    // 暗面阴影
    const shade = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.4, r * 0.2, cx, cy, r * 1.1);
    shade.addColorStop(0, 'rgba(255,255,255,0)');
    shade.addColorStop(1, 'rgba(30, 10, 60, 0.55)');
    ctx.fillStyle = shade;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    // 一颗小卫星慢慢绕
    const moonA = frame * 0.012;
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(moonA) * r * 2.3, cy + Math.sin(moonA) * r * 0.8, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
};

// 卡通 UFO：圆顶舱 + 椭圆碟身 + 一排彩灯（轮流闪）
const drawUFO = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    frame: number
) => {
    // 碟身
    ctx.fillStyle = '#9aa4b8';
    ctx.beginPath();
    ctx.ellipse(x, y, 34 * s, 11 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cdd5e0';
    ctx.beginPath();
    ctx.ellipse(x, y - 2 * s, 34 * s, 7 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // 圆顶舱
    ctx.fillStyle = 'rgba(103, 232, 249, 0.85)';
    ctx.beginPath();
    ctx.arc(x, y - 8 * s, 11 * s, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(x - 3 * s, y - 11 * s, 3 * s, 0, Math.PI * 2);
    ctx.fill();
    // 彩灯：四个，按帧轮流亮
    const lightColors = ['#f87171', '#facc15', '#4ade80', '#60a5fa'];
    lightColors.forEach((c, i) => {
        const on = Math.floor(frame * 0.25) % 4 === i;
        ctx.fillStyle = c;
        ctx.globalAlpha = on ? 1 : 0.3;
        ctx.beginPath();
        ctx.arc(x + (-15 + i * 10) * s, y + 5 * s, 2.8 * s, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;
};

const drawSpaceBackground = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    frame: number
) => {
    // 1. 深空底色：头顶近黑，整体泛紫
    const space = ctx.createLinearGradient(0, 0, 0, h);
    space.addColorStop(0, '#04061a');
    space.addColorStop(0.6, '#0b0e30');
    space.addColorStop(1, '#180f3a');
    ctx.fillStyle = space;
    ctx.fillRect(0, 0, w, h);

    // 2. 星云：几团 screen 混合的柔光（品红 / 青 / 紫）
    ctx.globalCompositeOperation = 'screen';
    const nebulae: Array<[number, number, number, string]> = [
        [0.2, 0.3, 0.32, 'rgba(217, 70, 239, 0.16)'],
        [0.72, 0.62, 0.38, 'rgba(34, 211, 238, 0.12)'],
        [0.45, 0.85, 0.3, 'rgba(139, 92, 246, 0.14)'],
    ];
    nebulae.forEach(([nx, ny, nr, color]) => {
        const g = ctx.createRadialGradient(nx * w, ny * h, 0, nx * w, ny * h, nr * Math.min(w, h));
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    });
    ctx.globalCompositeOperation = 'source-over';

    // 3. 星星：密密一片，各自一眨一眨
    SPACE_STARS.forEach(s => {
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(frame * 0.03 + s.phase));
        ctx.globalAlpha = tw;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.size, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;

    // 4. 带环行星 + 小卫星
    drawRingedPlanet(ctx, w * 0.8, h * 0.24, Math.min(w, h) * 0.085, frame);

    // 5. 陨石：慢慢自转 + 微微漂移
    SPACE_ASTEROIDS.forEach(a => {
        const ax = a.x * w + Math.sin(frame * 0.01 + a.phase) * 12;
        const ay = ((a.y * h + frame * a.drift) % (h + 60) + (h + 60)) % (h + 60) - 30;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(frame * a.rotSpeed + a.phase);
        ctx.fillStyle = '#6b6480';
        ctx.beginPath();
        a.verts.forEach((v, i) => {
            const ang = (i / a.verts.length) * Math.PI * 2;
            const rr = a.r * v;
            const px = Math.cos(ang) * rr;
            const py = Math.sin(ang) * rr;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fill();
        // 一块亮斑（朝向"太阳"的那一侧）
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.arc(-a.r * 0.3, -a.r * 0.3, a.r * 0.28, 0, Math.PI * 2);
        ctx.fill();
        // 小陨石坑
        ctx.fillStyle = 'rgba(30, 25, 50, 0.5)';
        ctx.beginPath();
        ctx.arc(a.r * 0.15, a.r * 0.1, a.r * 0.16, 0, Math.PI * 2);
        ctx.arc(-a.r * 0.1, a.r * 0.35, a.r * 0.11, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });

    // 6. UFO：沿波浪线从右往左巡逻，飞出去再从头来
    const ux = ((w + 80 - (frame * 1.6) % (w + 160)) + (w + 160)) % (w + 160) - 80;
    const uy = h * 0.5 + Math.sin(frame * 0.04) * 18;
    drawUFO(ctx, ux, uy, Math.min(w, h) / 560, frame);

    // 7. 流星：每 300 帧划过一颗，起始位置按周期编号变化
    const period = 300;
    const phaseInCycle = frame % period;
    if (phaseInCycle < 26) {
        const cycle = Math.floor(frame / period);
        const startX = (((cycle * 53) % 100) / 100) * w;
        const startY = h * (0.1 + (cycle % 3) * 0.1);
        const t = phaseInCycle / 26;
        const mx = startX + t * w * 0.32;
        const my = startY + t * h * 0.34;
        const tailLen = 70;
        const grad = ctx.createLinearGradient(mx, my, mx - tailLen * 0.68, my - tailLen * 0.72);
        grad.addColorStop(0, 'rgba(255,255,255,0.95)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx - tailLen * 0.68, my - tailLen * 0.72);
        ctx.stroke();
    }

    // 8. 漂浮尘埃：细小的亮点慢慢往上浮
    ctx.fillStyle = 'rgba(200, 190, 255, 0.5)';
    for (let i = 0; i < 26; i++) {
        const dx = ((i * 61) % 100) / 100 * w + Math.sin(frame * 0.02 + i) * 8;
        const dy = ((h - ((frame * 0.25 + i * 37) % h)) + h) % h;
        ctx.beginPath();
        ctx.arc(dx, dy, 1, 0, Math.PI * 2);
        ctx.fill();
    }
};

// === 村庄背景 ===
/*
  田园村庄：暖蓝天空 + 太阳 + 飘云 + 远山丘陵 + 一排烟囱冒烟的木屋 +
  白色尖桩栅栏 + 走来走去的母鸡 + 远处掠过的小鸟。主打"阳光明媚的小村子"。
*/
const drawVillageBackground = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    frame: number
) => {
    // 1. 暖蓝天空：天顶清爽，靠地平线泛暖黄（正午的阳光感）
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#7ec8f2');
    sky.addColorStop(0.55, '#a8dcf5');
    sky.addColorStop(1, '#fdf3d0');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 2. 太阳：左上角一团柔光
    const sunX = w * 0.14, sunY = h * 0.16, sunR = Math.min(w, h) * 0.06;
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 3.2);
    glow.addColorStop(0, 'rgba(255, 244, 180, 0.9)');
    glow.addColorStop(0.4, 'rgba(255, 236, 140, 0.35)');
    glow.addColorStop(1, 'rgba(255, 236, 140, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - sunR * 3.2, sunY - sunR * 3.2, sunR * 6.4, sunR * 6.4);
    ctx.fillStyle = '#fff3ae';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();

    // 3. 白云：从右往左慢慢飘，飘出屏再从右回来
    const clouds: Array<[number, number, number, number]> = [
        [0.18, 0.22, 34, 0.5], [0.5, 0.12, 26, 0.36], [0.78, 0.3, 30, 0.42], [0.35, 0.4, 20, 0.28],
    ];
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    clouds.forEach(([cx, cy, cr, speed], i) => {
        const x = ((w + cr * 3 - ((frame * speed + i * 260) % (w + cr * 6))) + (w + cr * 6)) % (w + cr * 6) - cr * 3;
        const y = cy * h + Math.sin(frame * 0.01 + i * 2) * 4;
        ctx.beginPath();
        ctx.arc(x, y, cr, 0, Math.PI * 2);
        ctx.arc(x + cr * 0.9, y - cr * 0.35, cr * 0.75, 0, Math.PI * 2);
        ctx.arc(x - cr * 0.9, y + cr * 0.1, cr * 0.65, 0, Math.PI * 2);
        ctx.arc(x + cr * 0.2, y + cr * 0.3, cr * 0.7, 0, Math.PI * 2);
        ctx.fill();
    });

    // 4. 远山丘陵：两叠淡青绿圆弧
    const hills = [
        { y: 0.64, r: 0.16, c: '#c5e3c8' },
        { y: 0.68, r: 0.11, c: '#a3d2a4' },
    ];
    hills.forEach(hill => {
        ctx.fillStyle = hill.c;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w + 60; x += 60) {
            ctx.lineTo(x, h * hill.y - Math.abs(Math.sin(x * 0.004 + hill.y * 9)) * h * hill.r);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
    });

    // 5. 远景小树林：一排深浅不一的绿团
    ctx.fillStyle = '#7ab86c';
    for (let i = 0; i < 14; i++) {
        const tx = ((i * 97 + 23) % 100) / 100 * w;
        const tr = 14 + (i * 13 % 10);
        const ty = h * 0.725;
        ctx.beginPath();
        ctx.arc(tx, ty, tr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(tx - 2, ty, 4, 14);
    }

    // 6. 一排村庄小屋：红顶 / 棕顶轮流来，烟囱慢悠悠冒烟圈
    const horizon = h * 0.78;
    const houses = [
        { x: 0.06, w: 0.14, hh: 0.14, roof: '#c94f43', wall: '#e8d5ae' },
        { x: 0.3, w: 0.12, hh: 0.12, roof: '#8a5a30', wall: '#f2e4c0' },
        { x: 0.58, w: 0.15, hh: 0.15, roof: '#b8452f', wall: '#e8d5ae' },
        { x: 0.85, w: 0.12, hh: 0.125, roof: '#7a4a26', wall: '#f2e4c0' },
    ];
    houses.forEach((hd, i) => {
        const hx = hd.x * w;
        const hw = hd.w * w;
        const hh = hd.hh * h;
        const hy = horizon - hh;
        // 墙体 + 木板纹
        ctx.fillStyle = hd.wall;
        ctx.fillRect(hx, hy + hh * 0.32, hw, hh * 0.68);
        ctx.strokeStyle = 'rgba(140, 100, 60, 0.25)';
        ctx.lineWidth = 1;
        for (let k = 1; k < 4; k++) {
            ctx.beginPath();
            ctx.moveTo(hx, hy + hh * 0.32 + (hh * 0.68 * k) / 4);
            ctx.lineTo(hx + hw, hy + hh * 0.32 + (hh * 0.68 * k) / 4);
            ctx.stroke();
        }
        // 三角屋顶（盖出一点屋檐）
        ctx.fillStyle = hd.roof;
        ctx.beginPath();
        ctx.moveTo(hx - hw * 0.06, hy + hh * 0.36);
        ctx.lineTo(hx + hw * 0.5, hy - hh * 0.1);
        ctx.lineTo(hx + hw * 1.06, hy + hh * 0.36);
        ctx.closePath();
        ctx.fill();
        // 屋脊亮边
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.moveTo(hx + hw * 0.5, hy - hh * 0.1);
        ctx.lineTo(hx + hw * 1.0, hy + hh * 0.35);
        ctx.stroke();
        // 门
        ctx.fillStyle = '#6b4a2b';
        ctx.fillRect(hx + hw * 0.42, hy + hh * 0.62, hw * 0.16, hh * 0.38);
        // 暖黄光的窗
        ctx.fillStyle = '#ffd873';
        ctx.fillRect(hx + hw * 0.12, hy + hh * 0.5, hw * 0.16, hh * 0.2);
        ctx.fillRect(hx + hw * 0.72, hy + hh * 0.5, hw * 0.16, hh * 0.2);
        // 烟囱 + 烟圈：每座屋错开相位，烟圈边升边散
        const chimneyX = hx + hw * 0.78;
        const chimneyY = hy - hh * 0.06;
        ctx.fillStyle = '#9a6a44';
        ctx.fillRect(chimneyX, chimneyY, hw * 0.1, hh * 0.22);
        for (let k = 0; k < 3; k++) {
            const t = ((frame * 0.6 + i * 90 + k * 60) % 180) / 180;
            const smokeY = chimneyY - t * h * 0.12;
            const smokeX = chimneyX + hw * 0.05 + Math.sin(t * 5 + k) * 6;
            ctx.fillStyle = `rgba(240, 240, 240, ${0.5 * (1 - t)})`;
            ctx.beginPath();
            ctx.arc(smokeX, smokeY, 4 + t * 8, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    // 7. 白色尖桩栅栏：地平线上一排，画在小屋前面
    ctx.fillStyle = '#fdfdf8';
    const fenceY = horizon + h * 0.008;
    for (let x = 0; x < w; x += 34) {
        ctx.fillRect(x + 6, fenceY - 22, 8, 24); // 尖桩
        ctx.beginPath(); // 桩头斜尖
        ctx.moveTo(x + 6, fenceY - 22);
        ctx.lineTo(x + 10, fenceY - 30);
        ctx.lineTo(x + 14, fenceY - 22);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(x - 12, fenceY - 16, 48, 4); // 横杆
    }

    // 8. 母鸡散步：在栅栏前来回踱步，走一段掉个头
    const hens = [
        { baseX: 0.24, phase: 0 },
        { baseX: 0.68, phase: 2.4 },
    ];
    hens.forEach(hen => {
        const swing = Math.sin(frame * 0.008 + hen.phase);
        const hx = hen.baseX * w + swing * w * 0.06;
        const hy = horizon + h * 0.055;
        const dir = swing > 0 ? 1 : -1;
        const bob = Math.abs(Math.sin(frame * 0.15 + hen.phase)) * 2;
        ctx.save();
        ctx.translate(hx, hy - bob);
        ctx.scale(dir, 1);
        // 身体 + 尾巴
        ctx.fillStyle = '#f8f8f2';
        ctx.beginPath();
        ctx.ellipse(0, 0, 11, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(-10, -4, 4, 3, -0.5, 0, Math.PI * 2);
        ctx.fill();
        // 头 + 鸡冠
        ctx.beginPath();
        ctx.arc(9, -7, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e04f3f';
        ctx.beginPath();
        ctx.arc(9, -12, 2.4, 0, Math.PI * 2);
        ctx.fill();
        // 喙
        ctx.fillStyle = '#f5a623';
        ctx.beginPath();
        ctx.moveTo(13, -7);
        ctx.lineTo(17, -6);
        ctx.lineTo(13, -4.5);
        ctx.closePath();
        ctx.fill();
        // 小细腿
        ctx.strokeStyle = '#e8a13d';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-2, 7);
        ctx.lineTo(-2, 12);
        ctx.moveTo(3, 7);
        ctx.lineTo(3, 12);
        ctx.stroke();
        ctx.restore();
    });

    // 9. 远处掠过的小鸟：V 形翅膀一扇一扇
    ctx.strokeStyle = 'rgba(90, 90, 110, 0.55)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
        const bx = ((w + 40 - (frame * (0.9 + i * 0.2) + i * 340) % (w + 80)) + (w + 80)) % (w + 80) - 40;
        const by = h * (0.14 + i * 0.07) + Math.sin(frame * 0.03 + i * 2) * 8;
        const flap = Math.sin(frame * 0.2 + i * 1.7) * 4;
        ctx.beginPath();
        ctx.moveTo(bx - 9, by - flap);
        ctx.quadraticCurveTo(bx - 3, by + 3, bx, by);
        ctx.quadraticCurveTo(bx + 3, by + 3, bx + 9, by - flap);
        ctx.stroke();
    }
};

// === 物理参数 (提速版) ===
const GRAVITY = 0.8;
const FRICTION = 0.82;
const MOVE_SPEED = 2.6;
const JUMP_FORCE = -22;

// === 喷气背包（掉落道具）===
const JETPACK_MAX_FUEL = 300;   // 满燃料能持续喷 5 秒（60fps）
const JETPACK_THRUST = 1.15;    // 每帧向上推力；GRAVITY=0.8，净升约 0.35/帧
const JETPACK_MAX_RISE = -9;    // 喷气上升速度封顶，防止越飞越快
const JETPACK_DROP_CHANCE = 0.25; // 普通掉落槽里出现喷气背包的概率（每局至多 1 个）

// === COOP 双人闯关（波次刷怪）===
const COOP_TOTAL_WAVES = 3;
const COOP_WAVE_ENEMIES = [2, 3, 4];    // 每关怪物数量：2 → 3 → 4
const COOP_WAVE_HEALTH = [60, 80, 100]; // 每关怪物血量递增，越打越硬
const COOP_WAVE_INTERMISSION = 150;     // 关卡间隔的休息时间（帧，约 2.5 秒）
const COOP_ENEMY_COLOR = '#ef4444'; // 怪物统一红色（和蓝/黄玩家一眼区分开）
const COOP_ENEMY_SLOTS = [0.5, 0.72, 0.28, 0.86]; // 怪物出生点的屏幕横向比例

// === 世界尺寸 ===
// 关卡坐标以 1280x720 为基准设计，运行时按画布尺寸自适应缩放：
// 窗口过矮时地面抬升，窗口过窄时平台整体收窄，避免角色掉出屏幕或平台跑到屏幕外。
const BASE_W = 1280;
const BASE_GROUND_Y = 600;
let GROUND_Y = BASE_GROUND_Y; // 每帧根据画布高度同步

const syncWorldSize = (canvas: HTMLCanvasElement) => {
    GROUND_Y = Math.min(BASE_GROUND_Y, Math.max(280, canvas.height - 90));
};

const ATTACK_COOLDOWN = 18;
const ATTACK_RANGE = 100;
const ATTACK_DAMAGE = 8;

// === 障碍参数 ===
const BODY_HALF_W = 13;    // 角色碰撞半宽（与 1.3 倍绘制比例下的躯干宽度一致）
const SPIKE_DAMAGE = 6;    // 陷阱单次伤害：刻意压低，避免小朋友一踩就死
const SPIKE_COOLDOWN = 50; // 陷阱无敌帧（约 0.83 秒）
const MAX_PARTICLES = 1000; // 粒子数量上限，防止特效累积卡顿

/*
  左右墙的内缩量。角色是"以 pos.x 为中心"画的，头是半径 12 的圆再乘 1.3 倍绘制比例
  （≈15.6px，算上 4px 描边外沿 ≈17.6px）。以前这里写死 10，贴着墙站会被切掉小半个脑袋。
*/
const WALL_MARGIN = 20;

// 逻辑帧固定 60Hz：与显示器刷新率解耦
const FIXED_STEP = 1000 / 60;
const MAX_STEPS_PER_FRAME = 5; // 单帧最多补算 5 步，避免长时间卡顿后"越补越卡"

/*
  HUD 同步签名：把玩家身上"看得见的字段"拼成一个字符串。
  只有签名变化才 setState，这样角色站着不动时 React 完全不参与，
  而不是每 6 帧无条件重渲染一次 HUD。
  武器耐久按 1/10 分档（配 CSS transition 补间），避免每帧都变。
*/
const hudSignature = (players: Entity[], stats: GameStats) => {
  let s = `${stats.winner ?? ''}|${stats.mode}|${Math.floor(stats.duration)}|${stats.wave ?? ''}`;
  for (const p of players) {
    s += `#${p.id},${Math.ceil(p.health)},${p.ammo},${p.heldWeapon ?? ''},${Math.round(p.weaponDuration / 6)},${p.isDead ? 1 : 0},${p.isWinner ? 1 : 0}`;
  }
  return s;
};

// === 武器生成配置 ===
const MAX_WEAPONS_PER_GAME = 6; 
const WEAPON_SPAWN_INTERVAL = 900; 
const WEAPON_LIFETIME = 15 * 60; 

// === 关卡设计 ===
const NEON_PLATFORMS: Platform[] = [
    { x: 300, y: 450, width: 200, height: 20 },
    { x: 800, y: 450, width: 200, height: 20 },
    { x: 500, y: 250, width: 300, height: 20 }
];

// 森林地图平台：原木 / 树桩
const FOREST_PLATFORMS: Platform[] = [
    { x: 320, y: 470, width: 180, height: 22 },
    { x: 780, y: 470, width: 180, height: 22 },
    { x: 540, y: 300, width: 260, height: 22 },
    { x: 240, y: 300, width: 150, height: 22 }
];

// 沙漠地图平台：砂岩平台
const DESERT_PLATFORMS: Platform[] = [
    { x: 320, y: 460, width: 190, height: 22 },
    { x: 770, y: 460, width: 190, height: 22 },
    { x: 500, y: 270, width: 280, height: 22 }
];

// 海洋地图平台：礁石 / 珊瑚平台
const OCEAN_PLATFORMS: Platform[] = [
    { x: 300, y: 470, width: 180, height: 22 },
    { x: 800, y: 470, width: 180, height: 22 },
    { x: 540, y: 250, width: 200, height: 22 }
];

// 火山地图平台：玄武岩平台
const VOLCANO_PLATFORMS: Platform[] = [
    { x: 300, y: 470, width: 180, height: 22 },
    { x: 800, y: 470, width: 180, height: 22 },
    { x: 540, y: 260, width: 200, height: 22 }
];

// 黑夜地图平台：夜色草地上的木台
const NIGHT_PLATFORMS: Platform[] = [
    { x: 320, y: 470, width: 180, height: 22 },
    { x: 780, y: 470, width: 180, height: 22 },
    { x: 520, y: 280, width: 260, height: 22 }
];

// 雪原地图平台：覆雪冰台
const SNOW_PLATFORMS: Platform[] = [
    { x: 320, y: 470, width: 180, height: 22 },
    { x: 780, y: 470, width: 180, height: 22 },
    { x: 520, y: 280, width: 250, height: 22 },
    { x: 1010, y: 340, width: 130, height: 22 }
];

// 草原地图平台：草皮土台
const PRAIRIE_PLATFORMS: Platform[] = [
    { x: 300, y: 460, width: 190, height: 22 },
    { x: 790, y: 460, width: 190, height: 22 },
    { x: 500, y: 270, width: 280, height: 22 }
];

// 冰川地图平台：层叠冰台
const GLACIER_PLATFORMS: Platform[] = [
    { x: 310, y: 470, width: 180, height: 22 },
    { x: 790, y: 470, width: 180, height: 22 },
    { x: 530, y: 290, width: 220, height: 22 },
    { x: 990, y: 350, width: 140, height: 22 }
];

// 太空地图平台：空间站舱板
const SPACE_PLATFORMS: Platform[] = [
    { x: 320, y: 470, width: 180, height: 22 },
    { x: 780, y: 470, width: 180, height: 22 },
    { x: 530, y: 290, width: 220, height: 22 },
    { x: 1010, y: 350, width: 130, height: 22 }
];

// 村庄地图平台：木屋顶 / 木板晾台
const VILLAGE_PLATFORMS: Platform[] = [
    { x: 300, y: 470, width: 190, height: 22 },
    { x: 770, y: 470, width: 190, height: 22 },
    { x: 530, y: 290, width: 220, height: 22 },
    { x: 990, y: 350, width: 150, height: 22 }
];

const basePlatformsOf = (m: MapType): Platform[] =>
    m === 'forest' ? FOREST_PLATFORMS
    : m === 'desert' ? DESERT_PLATFORMS
    : m === 'ocean' ? OCEAN_PLATFORMS
    : m === 'volcano' ? VOLCANO_PLATFORMS
    : m === 'night' ? NIGHT_PLATFORMS
    : m === 'snow' ? SNOW_PLATFORMS
    : m === 'prairie' ? PRAIRIE_PLATFORMS
    : m === 'glacier' ? GLACIER_PLATFORMS
    : m === 'space' ? SPACE_PLATFORMS
    : m === 'village' ? VILLAGE_PLATFORMS
    : NEON_PLATFORMS;

// ================= 每局随机地形 =================
/*
  每张地图的固定平台作为"骨架"保留，每局再随机追加一批平台与障碍，
  这样地图辨识度不丢，但每局地形都不一样。
  所有随机坐标都生成在 1280 × 600 基准坐标系下，取用时按画布尺寸等比缩放（与固定平台一致）。
*/
interface Layout {
    extras: Platform[];   // 随机追加的平台
    spikes: Obstacle[];   // 伤害陷阱
    blocks: Obstacle[];   // 实心阻挡
    movers: Obstacle[];   // 移动平台
}

const EMPTY_LAYOUT: Layout = { extras: [], spikes: [], blocks: [], movers: [] };

// 生成参数：数量与尺寸都刻意保守，保证 7~8 岁小朋友一眼能看清地形
const SPAWN_SAFE_X = 210;   // 出生点安全区：左右各 210px 内不放障碍
const PLACE_PAD = 44;       // 与已有平台/障碍的最小间距，保证跳得过去、不卡人
const PLACE_TRIES = 30;     // 每个元素的随机尝试次数
const MOVER_TRIES = 20;     // 移动平台包络较大，多试几次换尺寸/方向
const TIERS = [470, 400, 320, 240]; // 可选的平台高度层级

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));

interface Rect { x: number; y: number; width: number; height: number; }

// 两个矩形在 pad 间距内是否相交
const hits = (a: Rect, b: Rect, pad: number) =>
    a.x < b.x + b.width + pad && a.x + a.width + pad > b.x &&
    a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;

// 在基准坐标系里生成一局的地形
const generateLayout = (m: MapType): Layout => {
    const taken: Rect[] = basePlatformsOf(m).map(p => ({ ...p }));
    const layout: Layout = { extras: [], spikes: [], blocks: [], movers: [] };

    // 在安全区内找一个不与已占用矩形冲突的位置
    const place = (w: number, h: number, yMin: number, yMax: number): Rect | null => {
        for (let i = 0; i < PLACE_TRIES; i++) {
            const r: Rect = { x: rand(SPAWN_SAFE_X, BASE_W - SPAWN_SAFE_X - w), y: rand(yMin, yMax), width: w, height: h };
            if (taken.every(t => !hits(r, t, PLACE_PAD))) { taken.push(r); return r; }
        }
        return null;
    };

    // 1. 随机追加平台：1~3 个
    //    每张地图的固定平台会占掉一部分空档，宽平台未必塞得进某个层级，
    //    所以逐个层级乱序重试，而不是随机挑一层失败就整局放弃
    const extraCount = randInt(1, 3);
    for (let i = 0; i < extraCount; i++) {
        const w = rand(130, 230);
        const tiers = [...TIERS].sort(() => Math.random() - 0.5);
        for (const y of tiers) {
            const r = place(w, 22, y, y);
            if (r) { layout.extras.push({ x: r.x, y: r.y, width: r.width, height: 22 }); break; }
        }
    }

    // 2. 实心阻挡：1~2 个，坐在地面上（y 由地面反推，缩放后底边仍贴地）
    for (let i = 0, n = randInt(1, 2); i < n; i++) {
        const w = rand(46, 76);
        const h = rand(70, 120);
        const r = place(w, h, BASE_GROUND_Y - h, BASE_GROUND_Y - h);
        if (r) layout.blocks.push({ kind: 'block', x: r.x, y: r.y, width: r.width, height: r.height });
    }

    // 3. 伤害陷阱：1~2 个，贴地摆放
    for (let i = 0, n = randInt(1, 2); i < n; i++) {
        const w = rand(70, 130);
        const h = 20;
        const r = place(w, h, BASE_GROUND_Y - h, BASE_GROUND_Y - h);
        if (r) layout.spikes.push({ kind: 'spike', x: r.x, y: r.y, width: r.width, height: r.height });
    }

    // 4. 移动平台：0~2 个，横向或纵向往返
    for (let i = 0, n = randInt(0, 2); i < n; i++) {
        // 横向移动的包络很宽（平台宽 + 两倍行程），一次放不下就换个尺寸/方向再试
        for (let attempt = 0; attempt < MOVER_TRIES; attempt++) {
            const w = rand(120, 170);
            const axis: 'x' | 'y' = Math.random() < 0.6 ? 'x' : 'y';
            const range = axis === 'x' ? rand(55, 110) : rand(40, 80);

            // 预留的是整条"运动包络"而不是平台自身：
            // 否则平台扫过去时会穿过固定平台或箱子，站在上面的角色也会被顶进平台里
            const envW = axis === 'x' ? w + range * 2 : w;
            const envH = axis === 'y' ? 20 + range * 2 : 20;
            const envY = axis === 'y' ? rand(290, 470 - range) : rand(300, 460);

            const r = place(envW, envH, envY, envY);
            if (!r) continue;

            const baseX = axis === 'x' ? r.x + range : r.x;
            const baseY = axis === 'y' ? r.y + range : r.y;
            layout.movers.push({
                kind: 'mover',
                x: baseX, y: baseY, width: w, height: 20,
                baseX, baseY, axis, range,
                speed: rand(0.012, 0.024),
                phase: rand(0, Math.PI * 2),
                dx: 0, dy: 0,
            });
            break;
        }
    }

    return layout;
};

// 本局地形（基准坐标）。每局开始时由 initGame 重新生成。
let baseLayout: Layout = EMPTY_LAYOUT;
let layoutVersion = 0;

// 缩放后的地形缓存：与平台共用同一套缩放规则
let layoutCacheKey = '';
let layoutCache: Layout = EMPTY_LAYOUT;
let platformCache: Platform[] = [];

const scaleX = (canvasWidth: number) => Math.max(0.55, Math.min(1.5, canvasWidth / BASE_W));

/*
  取当前地图的"可站立面"：固定平台 + 随机追加平台 + 实心箱子顶面。
  移动平台每帧在动，不在这个列表里，由 update() 单独处理。
*/
const getPlatforms = (m: MapType, canvasWidth: number): Platform[] => {
    syncLayout(m, canvasWidth);
    return platformCache;
};

// 取当前地图的障碍（陷阱 / 阻挡 / 移动平台）
const getLayout = (m: MapType, canvasWidth: number): Layout => {
    syncLayout(m, canvasWidth);
    return layoutCache;
};

const syncLayout = (m: MapType, canvasWidth: number) => {
    const key = `${m}|${Math.round(canvasWidth)}|${Math.round(GROUND_Y)}|${layoutVersion}`;
    if (key === layoutCacheKey) return;

    const sx = scaleX(canvasWidth);
    const sy = GROUND_Y / BASE_GROUND_Y;

    // 平台高度不缩放（保持原有观感）；贴地障碍的高度随纵向缩放，保证底边仍然贴地
    const scaleP = (p: Platform): Platform => ({
        x: p.x * sx, y: p.y * sy, width: p.width * sx, height: p.height,
    });
    const scaleO = (o: Obstacle): Obstacle => ({
        ...o,
        x: o.x * sx, y: o.y * sy, width: o.width * sx, height: o.height * sy,
        baseX: o.baseX !== undefined ? o.baseX * sx : undefined,
        baseY: o.baseY !== undefined ? o.baseY * sy : undefined,
        range: o.range !== undefined ? o.range * (o.axis === 'y' ? sy : sx) : undefined,
    });

    const extras = baseLayout.extras.map(scaleP);
    const blocks = baseLayout.blocks.map(scaleO);
    const spikes = baseLayout.spikes.map(scaleO);
    const movers = baseLayout.movers.map(scaleO);

    platformCache = [
        ...basePlatformsOf(m).map(scaleP),
        ...extras,
        ...blocks, // 箱子顶面也可以站
    ];
    layoutCache = { extras, spikes, blocks, movers };
    layoutCacheKey = key;
};

/*
  静态平台层的离屏画布。平台材质每帧重画的结果完全一样（位置来自 platformCache，
  只在换图 / 改窗口尺寸 / 换局时变），所以缓存成位图，每帧只贴一次。
  缓存键直接复用 layoutCacheKey —— 它变了就说明平台位置变了，必须重画。
*/
// 复用同一个返回对象：命中缓存时不再每帧新建一个 { canvas, box }（那就成了"为了省分配反而每帧分配"）
let terrainCanvas: HTMLCanvasElement | null = null;
let terrainKey = '';
const terrainLayer = { canvas: null as HTMLCanvasElement | null, x: 0, y: 0 };

const getTerrainLayer = (m: MapType, canvas: HTMLCanvasElement, platforms: Platform[]) => {
    const key = `${layoutCacheKey}|${canvas.width}x${canvas.height}`;
    if (terrainCanvas && terrainKey === key) return terrainLayer;

    if (!terrainCanvas) terrainCanvas = document.createElement('canvas');

    // 只缓存平台实际占用的那一横条：平台都是细长条，铺满整张画布的话每帧
    // 要白白搬 1280x633 的位图，把省下来的光栅化又吃回去了。
    // padding 要够放下平台顶部的辉光（shadowBlur 最大 14）和霓虹描边的外沿。
    const PAD = 24;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of platforms) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + p.width);
        maxY = Math.max(maxY, p.y + p.height);
    }
    if (!platforms.length) { minX = minY = 0; maxX = maxY = 0; }

    const bx = Math.max(0, Math.floor(minX - PAD));
    const by = Math.max(0, Math.floor(minY - PAD));
    const bw = Math.max(1, Math.min(canvas.width, Math.ceil(maxX + PAD)) - bx);
    const bh = Math.max(1, Math.min(canvas.height, Math.ceil(maxY + PAD)) - by);

    terrainCanvas.width = bw;
    terrainCanvas.height = bh;
    terrainLayer.canvas = terrainCanvas;
    terrainLayer.x = bx;
    terrainLayer.y = by;

    const tctx = terrainCanvas.getContext('2d');
    // 改 width/height 会把画布和绘图状态一起重置，所以这里的 translate 是在干净状态上做的
    if (tctx) {
        tctx.translate(-bx, -by);
        paintPlatforms(tctx, m, platforms);
    }
    terrainKey = key;
    return terrainLayer;
};

// 每局开局重新掷一次地形
const regenerateLayout = (m: MapType) => {
    baseLayout = generateLayout(m);
    layoutVersion++;
};

// 在“手部”原点处绘制角色持有的武器图标
const drawHeldWeapon = (ctx: CanvasRenderingContext2D, weapon: AnyWeaponId) => {
    if (weapon === 'sword') {
        ctx.fillStyle = '#ccc';
        ctx.fillRect(0, -25, 4, 30);
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(-3, 0, 10, 2);
    } else if (weapon === 'bomb' || weapon === 'atom_bomb') {
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(5, 0, 8, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(5, -8);
        ctx.quadraticCurveTo(10, -15, 15, -10);
        ctx.stroke();
        if (weapon === 'atom_bomb') {
            ctx.fillStyle = 'yellow';
            ctx.font = '10px Arial';
            ctx.fillText('☢', 2, 4);
        }
    } else if (weapon === 'missile') {
        ctx.fillStyle = 'green';
        ctx.fillRect(0, -5, 20, 10);
        ctx.fillStyle = 'red';
        ctx.fillRect(20, -5, 5, 10);
    } else if (weapon === 'dragon') {
        ctx.font = '20px serif';
        ctx.fillText('🐉', 0, 5);
    } else if (weapon === 'bomber') {
        // 无线电/对讲机外观
        ctx.fillStyle = '#333';
        ctx.fillRect(0, -10, 10, 16);
        ctx.fillStyle = '#000';
        ctx.fillRect(2, -15, 2, 5); // 天线
        ctx.fillStyle = '#f00';
        ctx.beginPath(); ctx.arc(5, -5, 2, 0, Math.PI*2); ctx.fill(); // 信号灯
    } else if (weapon === 'pokemon') {
        // 精灵球
        ctx.fillStyle = 'red'; ctx.beginPath(); ctx.arc(0,0,6, Math.PI, 0); ctx.fill();
        ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(0,0,6, 0, Math.PI); ctx.fill();
        ctx.fillStyle = 'black'; ctx.fillRect(-6, -1, 12, 2);
        ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(0,0,2, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = 'black'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0,0,2, 0, Math.PI*2); ctx.stroke();
    } else if (weapon === 'laser') {
        // 激光枪外观
        ctx.fillStyle = '#444';
        ctx.fillRect(0, -5, 15, 8);
        ctx.fillStyle = '#f00';
        ctx.fillRect(15, -4, 3, 6); // 枪口
        ctx.fillStyle = '#666';
        ctx.fillRect(2, 3, 4, 6); // 握把
    } else if (weapon === 'zeperion') {
        // 哉佩利敖光线发射器外观（类似手腕发光装置）
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, -4, 12, 6);
        ctx.fillStyle = '#fbbf24'; // 金色
        ctx.fillRect(12, -3, 4, 4);
        // 枪口的光点：用两个同心圆伪造辉光，不用 shadowBlur（每个实体每帧一次，太贵）
        ctx.fillStyle = 'rgba(251, 191, 36, 0.35)';
        ctx.beginPath(); ctx.arc(14, -1, 6, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#fde68a';
        ctx.beginPath(); ctx.arc(14, -1, 3, 0, Math.PI*2); ctx.fill();
    } else if (weapon === 'c4') {
        // C4 炸药块（手持）
        ctx.fillStyle = '#6b5a3e';
        ctx.fillRect(-8, -5, 16, 10);
        ctx.fillStyle = '#3f3625';
        ctx.fillRect(-8, -5, 16, 3);
        ctx.fillStyle = '#ff0000';
        ctx.beginPath(); ctx.arc(5, 5, 2, 0, Math.PI*2); ctx.fill();
    } else if (weapon === 'piercer') {
        // 穿地弹（重型炮弹）
        ctx.fillStyle = '#4b5563';
        ctx.fillRect(0, -4, 18, 8);
        ctx.fillStyle = '#dc2626';
        ctx.beginPath(); ctx.arc(18, 0, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(-4, -4, 4, 8); // 金色尾翼
    } else if (weapon === 'aug') {
        // AUG 突击步枪（手持）
        ctx.fillStyle = '#2f3e46';
        ctx.fillRect(0, -6, 26, 8);        // 枪身
        ctx.fillStyle = '#1f2a30';
        ctx.fillRect(2, -10, 8, 4);        // 提把瞄具
        ctx.fillStyle = '#8a5a30';
        ctx.fillRect(6, 2, 8, 6);          // 握把
        ctx.fillStyle = '#444';
        ctx.fillRect(24, -4, 5, 4);        // 枪口
    } else if (weapon === 'gas') {
        // 毒气弹（手持罐）
        ctx.fillStyle = '#3f7d2f';
        ctx.fillRect(-4, -6, 12, 12);
        ctx.fillStyle = '#2f5d22';
        ctx.fillRect(-4, -6, 12, 3);
        ctx.fillStyle = '#c9ff6b';
        ctx.font = '10px sans-serif';
        ctx.fillText('☠', -3, 4);
    } else if (weapon === 'gatling') {
        // 加特林（手持）：三联枪管 + 弹箱
        ctx.fillStyle = '#3a3f44';
        ctx.fillRect(-2, -7, 24, 11);       // 机匣
        ctx.fillStyle = '#22262a';
        ctx.fillRect(20, -6, 14, 2.5);      // 枪管 ×3
        ctx.fillRect(20, -2, 14, 2.5);
        ctx.fillRect(20, 2, 14, 2.5);
        ctx.fillStyle = '#8a5a30';
        ctx.fillRect(2, 4, 7, 7);           // 握把
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(-8, -4, 7, 9);         // 弹箱
    } else {
        // 自创武器：手持它的 emoji
        const cw = getCustom(weapon);
        if (cw) {
            ctx.font = '18px serif';
            ctx.fillText(cw.emoji, 0, 6);
        }
    }
};

// 圆角矩形路径（手写，避免依赖较新的 ctx.roundRect）
const roundRectPath = (
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number
) => {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
};

// 障碍配色：按地图取，保证和该地图的平台材质是同一套色系
const OBSTACLE_PALETTE: Record<MapType, {
    hazard: string; hazardDark: string;
    block: string; blockTop: string; blockEdge: string;
    mover: string; moverEdge: string;
}> = {
    neon:    { hazard: '#f43f5e', hazardDark: '#881337', block: '#475569', blockTop: '#64748b', blockEdge: '#22d3ee', mover: '#334155', moverEdge: '#67e8f9' },
    forest:  { hazard: '#ef4444', hazardDark: '#7f1d1d', block: '#8a5a30', blockTop: '#a97142', blockEdge: '#4c9a3a', mover: '#8a5a30', moverEdge: '#c9e265' },
    desert:  { hazard: '#dc2626', hazardDark: '#7f1d1d', block: '#c08a4a', blockTop: '#d8a763', blockEdge: '#8a5f2b', mover: '#c08a4a', moverEdge: '#ffe9b8' },
    ocean:   { hazard: '#e11d48', hazardDark: '#881337', block: '#44636f', blockTop: '#7ba6b5', blockEdge: '#e07a9a', mover: '#44636f', moverEdge: '#7dd3fc' },
    volcano: { hazard: '#ff5722', hazardDark: '#7c2d12', block: '#4a3333', blockTop: '#6b4a4a', blockEdge: '#ff8c3a', mover: '#4a3333', moverEdge: '#ff8c3a' },
    night:   { hazard: '#b91c5c', hazardDark: '#4c1030', block: '#3b3b58', blockTop: '#52527a', blockEdge: '#818cf8', mover: '#3b3b58', moverEdge: '#a5b4fc' },
    snow:    { hazard: '#0284c7', hazardDark: '#0c4a6e', block: '#a9d4ef', blockTop: '#e8f5fd', blockEdge: '#38bdf8', mover: '#a9d4ef', moverEdge: '#e0f2fe' },
    prairie: { hazard: '#ef4444', hazardDark: '#7f1d1d', block: '#8a6a3a', blockTop: '#a98a4a', blockEdge: '#7cc24a', mover: '#8a6a3a', moverEdge: '#bef264' },
    glacier: { hazard: '#0e7490', hazardDark: '#083344', block: '#7db7cf', blockTop: '#d6f0fa', blockEdge: '#22d3ee', mover: '#7db7cf', moverEdge: '#cffafe' },
    space:   { hazard: '#be185d', hazardDark: '#500724', block: '#4b4570', blockTop: '#6b6396', blockEdge: '#e879f9', mover: '#4b4570', moverEdge: '#f0abfc' },
    village: { hazard: '#dc2626', hazardDark: '#7f1d1d', block: '#b08050', blockTop: '#caa070', blockEdge: '#7cc24a', mover: '#a87848', moverEdge: '#ffd873' },
};

// 绘制障碍：伤害陷阱（尖刺）/ 实心阻挡（箱子）/ 移动平台（带轨迹虚线）
/*
  平台材质绘制。整块是纯静态的：位置来自缓存好的 platformCache（只在换图 / 改窗口尺寸 /
  换局时失效），每帧重画的结果完全一样。所以只在布局变化时画一次到离屏画布，
  之后每帧一次 drawImage —— 省掉每帧 N 个线性渐变 + N 次 shadowBlur（最贵的两项）。
*/
const paintPlatforms = (
    ctx: CanvasRenderingContext2D,
    map: MapType,
    platforms: Platform[],
) => {
    if (map === 'forest') {
        platforms.forEach(p => {
            const bark = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
            bark.addColorStop(0, '#8a5a30');
            bark.addColorStop(1, '#5a3a1c');
            ctx.fillStyle = bark;
            roundRectPath(ctx, p.x, p.y, p.width, p.height, 10);
            ctx.fill();
            // 苔藓 / 草皮顶面
            ctx.fillStyle = '#4c9a3a';
            roundRectPath(ctx, p.x, p.y - 4, p.width, 10, 5);
            ctx.fill();
            ctx.fillStyle = '#3f7d2f';
            ctx.beginPath(); ctx.arc(p.x + p.width * 0.3, p.y + p.height / 2, 3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(p.x + p.width * 0.7, p.y + p.height / 2, 3, 0, Math.PI * 2); ctx.fill();
        });
    } else if (map === 'desert') {
        platforms.forEach(p => {
            const sand = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
            sand.addColorStop(0, '#e0bc7c');
            sand.addColorStop(1, '#b98f4b');
            ctx.fillStyle = sand;
            roundRectPath(ctx, p.x, p.y, p.width, p.height, 8);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 240, 200, 0.7)';
            roundRectPath(ctx, p.x + 4, p.y + 2, p.width - 8, 4, 2);
            ctx.fill();
        });
    } else if (map === 'ocean') {
        platforms.forEach(p => {
            const rock = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
            rock.addColorStop(0, '#7ba6b5');
            rock.addColorStop(1, '#44636f');
            ctx.fillStyle = rock;
            roundRectPath(ctx, p.x, p.y, p.width, p.height, 10);
            ctx.fill();
            // 珊瑚点缀
            ctx.fillStyle = '#e07a9a';
            ctx.beginPath(); ctx.arc(p.x + p.width * 0.2, p.y - 2, 6, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(p.x + p.width * 0.8, p.y - 1, 5, 0, Math.PI * 2); ctx.fill();
        });
    } else if (map === 'volcano') {
        platforms.forEach(p => {
            const basalt = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
            basalt.addColorStop(0, '#4a3333');
            basalt.addColorStop(1, '#221717');
            ctx.fillStyle = basalt;
            roundRectPath(ctx, p.x, p.y, p.width, p.height, 8);
            ctx.fill();
            // 顶部岩浆边（带辉光）
            const lava = ctx.createLinearGradient(p.x, p.y, p.x + p.width, p.y);
            lava.addColorStop(0, '#ff8c3a');
            lava.addColorStop(0.5, '#ff5722');
            lava.addColorStop(1, '#ff8c3a');
            ctx.save();
            ctx.shadowBlur = 14;
            ctx.shadowColor = '#ff5722';
            ctx.fillStyle = lava;
            roundRectPath(ctx, p.x + 3, p.y - 3, p.width - 6, 5, 2.5);
            ctx.fill();
            ctx.restore();
        });
    } else if (map === 'night') {
        // 黑夜：深色木台 + 月光色的顶边（夜里站得住看得清）
        platforms.forEach(p => {
            const body = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
            body.addColorStop(0, '#3b3b58');
            body.addColorStop(1, '#24243a');
            ctx.fillStyle = body;
            roundRectPath(ctx, p.x, p.y, p.width, p.height, 10);
            ctx.fill();
            // 月光顶面
            ctx.fillStyle = '#818cf8';
            roundRectPath(ctx, p.x + 3, p.y - 3, p.width - 6, 5, 2.5);
            ctx.fill();
            ctx.fillStyle = 'rgba(148, 163, 255, 0.35)';
            roundRectPath(ctx, p.x + 4, p.y + 4, p.width - 8, 3, 1.5);
            ctx.fill();
        });
    } else if (map === 'snow') {
        // 雪原：寒冰台 + 两边垂下来的厚积雪盖
        platforms.forEach(p => {
            const ice = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
            ice.addColorStop(0, '#a9d4ef');
            ice.addColorStop(1, '#6aa8d4');
            ctx.fillStyle = ice;
            roundRectPath(ctx, p.x, p.y, p.width, p.height, 10);
            ctx.fill();
            // 冰面高光
            ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
            roundRectPath(ctx, p.x + 5, p.y + 6, p.width - 10, 3, 1.5);
            ctx.fill();
            // 积雪顶盖（比台子宽一点，像雪压出来的边）
            ctx.fillStyle = '#f8fcff';
            roundRectPath(ctx, p.x - 3, p.y - 5, p.width + 6, 10, 5);
            ctx.fill();
            // 雪盖下沿淡影，分出层次
            ctx.fillStyle = 'rgba(148, 187, 219, 0.45)';
            roundRectPath(ctx, p.x - 1, p.y + 3, p.width + 2, 3, 1.5);
            ctx.fill();
        });
    } else if (map === 'prairie') {
        // 草原：泥土台 + 鲜绿草皮 + 小野花（区别于森林的原木苔藓）
        platforms.forEach(p => {
            const dirt = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
            dirt.addColorStop(0, '#9a7a4a');
            dirt.addColorStop(1, '#7a5c34');
            ctx.fillStyle = dirt;
            roundRectPath(ctx, p.x, p.y, p.width, p.height, 9);
            ctx.fill();
            // 草皮顶
            ctx.fillStyle = '#7cc24a';
            roundRectPath(ctx, p.x - 2, p.y - 4, p.width + 4, 10, 5);
            ctx.fill();
            ctx.fillStyle = '#93d65e';
            roundRectPath(ctx, p.x, p.y - 4, p.width, 4, 2);
            ctx.fill();
            // 台面上的两朵小花
            const dotColors = ['#ff5d8f', '#ffd23f'];
            dotColors.forEach((c, i) => {
                const fx = p.x + p.width * (0.28 + i * 0.44);
                ctx.fillStyle = c;
                ctx.beginPath();
                ctx.arc(fx, p.y - 2, 2.6, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#fff7d6';
                ctx.beginPath();
                ctx.arc(fx, p.y - 2, 1, 0, Math.PI * 2);
                ctx.fill();
            });
        });
    } else if (map === 'glacier') {
        // 冰川：半透明层叠蓝冰台 + 冰棱高光（区别于雪原的积雪顶盖）
        platforms.forEach(p => {
            const ice = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
            ice.addColorStop(0, '#b7e2f2');
            ice.addColorStop(1, '#5f97b8');
            ctx.fillStyle = ice;
            roundRectPath(ctx, p.x, p.y, p.width, p.height, 8);
            ctx.fill();
            // 内部冰纹：几条斜向半透明白线
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1.5;
            for (let i = 0; i < 3; i++) {
                const vx = p.x + p.width * (0.2 + i * 0.3);
                ctx.beginPath();
                ctx.moveTo(vx, p.y + 3);
                ctx.lineTo(vx + 8, p.y + p.height - 3);
                ctx.stroke();
            }
            // 顶面冰光：整条亮边 + 垂下来的小冰锥
            ctx.fillStyle = 'rgba(230, 248, 255, 0.9)';
            roundRectPath(ctx, p.x + 2, p.y - 3, p.width - 4, 5, 2.5);
            ctx.fill();
            for (let i = 0; i < 3; i++) {
                const tx = p.x + p.width * (0.2 + i * 0.3);
                ctx.beginPath();
                ctx.moveTo(tx - 2.5, p.y + p.height);
                ctx.lineTo(tx, p.y + p.height + 7);
                ctx.lineTo(tx + 2.5, p.y + p.height);
                ctx.closePath();
                ctx.fill();
            }
        });
    } else if (map === 'space') {
        // 空间站舱板：深紫灰金属 + 品红霓虹边 + 铆钉（区别于霓虹的青色边）
        platforms.forEach(p => {
            const body = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
            body.addColorStop(0, '#5b5480');
            body.addColorStop(1, '#2e2a4a');
            ctx.fillStyle = body;
            roundRectPath(ctx, p.x, p.y, p.width, p.height, 6);
            ctx.fill();
            // 顶部品红霓虹条
            ctx.fillStyle = '#e879f9';
            roundRectPath(ctx, p.x + 2, p.y + 1, p.width - 4, 3, 1.5);
            ctx.fill();
            ctx.fillStyle = 'rgba(240, 171, 252, 0.35)';
            roundRectPath(ctx, p.x, p.y, p.width, p.height, 6);
            ctx.fill();
            // 一排小铆钉
            ctx.fillStyle = '#c4b5fd';
            for (let vx = p.x + 10; vx < p.x + p.width - 6; vx += 22) {
                ctx.beginPath();
                ctx.arc(vx, p.y + p.height - 5, 1.6, 0, Math.PI * 2);
                ctx.fill();
            }
        });
    } else if (map === 'village') {
        // 村庄：木板台 + 横木梁 + 木板缝（木屋晾台风格，钉子点缀）
        platforms.forEach(p => {
            const plank = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
            plank.addColorStop(0, '#c98f56');
            plank.addColorStop(1, '#96633a');
            ctx.fillStyle = plank;
            roundRectPath(ctx, p.x, p.y, p.width, p.height, 6);
            ctx.fill();
            // 竖木板缝
            ctx.strokeStyle = 'rgba(110, 72, 40, 0.4)';
            ctx.lineWidth = 1.5;
            for (let vx = p.x + 18; vx < p.x + p.width - 6; vx += 24) {
                ctx.beginPath();
                ctx.moveTo(vx, p.y + 3);
                ctx.lineTo(vx, p.y + p.height - 3);
                ctx.stroke();
            }
            // 顶部横梁（深木色）+ 高光
            ctx.fillStyle = '#7a4a26';
            roundRectPath(ctx, p.x, p.y, p.width, 6, 3);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 225, 180, 0.4)';
            roundRectPath(ctx, p.x + 2, p.y + 1, p.width - 4, 2, 1);
            ctx.fill();
            // 两头的钉子
            ctx.fillStyle = '#5a3a1c';
            [0.06, 0.94].forEach(rx => {
                ctx.beginPath();
                ctx.arc(p.x + p.width * rx, p.y + 3, 1.4, 0, Math.PI * 2);
                ctx.fill();
            });
        });
    } else {
        // 霓虹都市：金属平台 + 青色霓虹边
        platforms.forEach(p => {
            const body = ctx.createLinearGradient(0, p.y, 0, p.y + p.height);
            body.addColorStop(0, '#475569');
            body.addColorStop(0.5, '#334155');
            body.addColorStop(1, '#1e293b');
            ctx.fillStyle = body;
            roundRectPath(ctx, p.x, p.y, p.width, p.height, 6);
            ctx.fill();

            ctx.save();
            ctx.shadowBlur = 12;
            ctx.shadowColor = '#22d3ee';
            ctx.strokeStyle = '#67e8f9';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(p.x + 7, p.y + 1.5);
            ctx.lineTo(p.x + p.width - 7, p.y + 1.5);
            ctx.stroke();
            ctx.restore();

            // 底部暗边，增强厚度感
            ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
            roundRectPath(ctx, p.x + 4, p.y + p.height - 5, p.width - 8, 4, 2);
            ctx.fill();
        });
    }
};

const drawObstacles = (
    ctx: CanvasRenderingContext2D,
    map: MapType,
    layout: Layout,
) => {
    const pal = OBSTACLE_PALETTE[map];

    // 伤害陷阱：一排尖刺，底座压深色，尖刺朝上
    layout.spikes.forEach(sp => {
        const teeth = Math.max(2, Math.round(sp.width / 18));
        const tw = sp.width / teeth;

        ctx.fillStyle = pal.hazardDark;
        roundRectPath(ctx, sp.x, sp.y + sp.height - 6, sp.width, 6, 3);
        ctx.fill();

        ctx.fillStyle = pal.hazard;
        ctx.beginPath();
        for (let i = 0; i < teeth; i++) {
            const x0 = sp.x + i * tw;
            ctx.moveTo(x0, sp.y + sp.height);
            ctx.lineTo(x0 + tw / 2, sp.y);
            ctx.lineTo(x0 + tw, sp.y + sp.height);
        }
        ctx.closePath();
        ctx.fill();

        // 尖刺右侧高光，让三角有立体感
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < teeth; i++) {
            const x0 = sp.x + i * tw;
            ctx.moveTo(x0 + tw / 2, sp.y + 2);
            ctx.lineTo(x0 + tw * 0.8, sp.y + sp.height);
        }
        ctx.stroke();
    });

    // 实心阻挡：箱子，顶面亮、边框亮色，中间交叉加固条
    layout.blocks.forEach(b => {
        ctx.fillStyle = pal.block;
        roundRectPath(ctx, b.x, b.y, b.width, b.height, 8);
        ctx.fill();

        ctx.fillStyle = pal.blockTop;
        roundRectPath(ctx, b.x + 3, b.y + 3, b.width - 6, 8, 4);
        ctx.fill();

        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(b.x + 7, b.y + 16); ctx.lineTo(b.x + b.width - 7, b.y + b.height - 7);
        ctx.moveTo(b.x + b.width - 7, b.y + 16); ctx.lineTo(b.x + 7, b.y + b.height - 7);
        ctx.stroke();

        ctx.strokeStyle = pal.blockEdge;
        ctx.lineWidth = 3;
        roundRectPath(ctx, b.x + 1.5, b.y + 1.5, b.width - 3, b.height - 3, 7);
        ctx.stroke();
    });

    // 移动平台：先画往返轨迹虚线（提示会移动），再画平台本体
    layout.movers.forEach(mv => {
        const range = mv.range ?? 0;
        // 轨迹虚线必须锚在往返中点（baseX / baseY）上，不能跟着平台当前位置走：
        // 用 mv.x / mv.y 的话整条线会随平台一起平移，背景里就像有条白线在乱飞。
        const cx = mv.baseX ?? mv.x;
        const cy = mv.baseY ?? mv.y;

        ctx.save();
        ctx.setLineDash([8, 8]);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (mv.axis === 'y') {
            // 竖线画满整条运动包络，小朋友一眼能看出平台会上下跑多远
            ctx.moveTo(cx + mv.width / 2, cy - range);
            ctx.lineTo(cx + mv.width / 2, cy + mv.height + range);
        } else {
            ctx.moveTo(cx - range, cy + mv.height / 2);
            ctx.lineTo(cx + mv.width + range, cy + mv.height / 2);
        }
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = pal.mover;
        roundRectPath(ctx, mv.x, mv.y, mv.width, mv.height, 8);
        ctx.fill();

        // 平台会移动，没法跟着静态层一起缓存，所以这条霓虹边也别用 shadowBlur：
        // 用一条更粗的半透明底线冒充辉光，省掉每帧每个移动平台一次高斯模糊。
        const edgeLine = (color: string, width: number) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(mv.x + 7, mv.y + 2);
            ctx.lineTo(mv.x + mv.width - 7, mv.y + 2);
            ctx.stroke();
        };
        ctx.save();
        ctx.globalAlpha = 0.35;
        edgeLine(pal.moverEdge, 8);
        ctx.globalAlpha = 1;
        edgeLine(pal.moverEdge, 3);
        ctx.restore();
    });
};

/*
  === 火柴人装配（动作流畅化重写） ===
  以前的画法：腿是两条无膝单线段、手臂只画一条、走路时脚贴地平移（walkCycle 只改脚的 x），
  躯干是根刚性竖线 —— 所以怎么看怎么僵。
  现在的结构（全部朝右画，靠 scale(-1,1) 翻转）：
  - 造型：腿长身子短（腿占身高近一半）、头是实心圆无眼睛、四肢同色无明暗。
  - 腿：胯 → 膝 → 脚 两段式。步行时摆动腿前摆且脚抬起（max(0,cos) 弧线），支撑腿踩地。
  - 臂：肩 → 肘 → 手 两段式，永远画两条，手上画小拳头。
  - 躯干：平时笔直不勾腰（走/跑/跳都不前倾），只有出拳时前倾一点。
  - 攻击：attackFrame 5→15 共 11 帧，前段手臂后拉蓄力，后段快速打直，躯干跟着前倾。
*/
const drawEntity = (ctx: CanvasRenderingContext2D, entity: Entity, frame: number) => {
    ctx.save();
    ctx.translate(entity.pos.x, entity.pos.y); // pos.y 是脚底

    // 喷气背包燃料条：画在头顶上方，不受后面朝向翻转 / 放大 1.3 的影响
    if (!entity.isDead && entity.jetpackFuel > 0) {
        const barW = 40;
        const ratio = entity.jetpackFuel / JETPACK_MAX_FUEL;
        const by = -entity.height - 16;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
        roundRectPath(ctx, -barW / 2 - 1, by - 1, barW + 2, 7, 3.5);
        ctx.fill();
        ctx.fillStyle = ratio > 0.3 ? '#38bdf8' : '#f87171'; // 燃料低于 30% 变红提醒
        roundRectPath(ctx, -barW / 2, by, barW * ratio, 5, 2.5);
        ctx.fill();
    }

    if (entity.isDead) {
         // 败者静态平躺：固定转 90° 躺下即可，不翻滚
         ctx.rotate(Math.PI / 2 * (entity.facingRight ? 1 : -1));
         ctx.translate(0, -10);
    }

    if (!entity.facingRight) ctx.scale(-1, 1);
    ctx.scale(1.3, 1.3); // 放大 1.3 倍

    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const H = entity.height;
    const crouch = entity.isCrouching ? 16 : 0;

    // ---- 运动状态 ----
    const speedX = Math.abs(entity.vel.x);
    const walking = speedX > 0.1 && entity.isGrounded && !entity.isCrouching;
    const ph = frame / 6;                                            // 步行相位（沿用原节奏）
    const bob = walking ? Math.abs(Math.cos(ph)) * 2.5               // 步行：随脚步交替上下颠
                        : Math.sin(frame * 0.045) * 1;               // 站立：呼吸
    // 出拳进度 0→1：attackFrame/15 从 0.33 起步，前段是蓄力（punch=0），后段打直（punch→1）
    const punch = entity.isAttacking ? Math.min(1, Math.max(0, (entity.attackFrame / 15 - 0.4) / 0.6)) : 0;
    // 躯干平时（走/跑/跳）保持笔直不勾腰，只有出拳时前倾一点制造冲击感
    const leanAll = punch * 5 - (entity.isAttacking ? (1 - punch) * 2 : 0);

    // ---- 骨架关键点（y 相对脚底，负值向上；x 正值朝前） ----
    // 造型：腿长身子短——腿占身高近一半，躯干只留一小截
    const hip = { x: 0, y: -42 + crouch * 0.75 + bob };
    const neck = { x: leanAll, y: -H + 29 + crouch + bob };
    const shoulder = { x: leanAll, y: -H + 37 + crouch + bob };
    const head = { x: leanAll * 1.25, y: -H + 17 + crouch + bob };

    // ---- 腿（胯→膝→脚）----
    const legTargets: { fx: number; fy: number; bend: number }[] = (() => {
        if (entity.isCrouching) return [{ fx: -13, fy: 0, bend: 10 }, { fx: 13, fy: 0, bend: 10 }];
        if (!entity.isGrounded)  return [{ fx: -6, fy: -13, bend: 9 }, { fx: 9, fy: -9, bend: 8 }]; // 跳跃收腿
        if (walking) return [0, 1].map(i => {
            const t = ph + i * Math.PI;
            return { fx: Math.sin(t) * 11, fy: -Math.max(0, Math.cos(t)) * 6, bend: 5 };
        });
        return [{ fx: -9, fy: 0, bend: 2.5 }, { fx: 9, fy: 0, bend: 2.5 }];
    })();

    const drawLeg = (t: { fx: number; fy: number; bend: number }) => {
        const knee = { x: (hip.x + t.fx) / 2 + t.bend, y: (hip.y + t.fy) / 2 };
        ctx.strokeStyle = entity.color;
        ctx.beginPath();
        ctx.moveTo(hip.x, hip.y);
        ctx.lineTo(knee.x, knee.y);
        ctx.lineTo(t.fx, t.fy);
        ctx.stroke();
    };
    drawLeg(legTargets[0]);   // 远侧腿先画

    // ---- 手臂目标姿势（hx/hy 都是相对肩部的偏移）----
    const armTargets: { hx: number; hy: number; bend: number }[] = (() => {
        if (entity.isWinner) { // 胜利：双臂上举摇摆
            const wave = Math.sin(frame / 5) * 6;
            const pump = Math.max(0, Math.sin(frame / 6)) * 12;
            return [{ hx: -18 + wave, hy: -28 - pump, bend: 4 }, { hx: 18 + wave, hy: -30 - pump, bend: 3 }];
        }
        if (entity.heldWeapon) {
            if (entity.isAttacking) { // 持械挥击：前臂带武器向下劈
                return [{ hx: -8, hy: 16, bend: 4 }, { hx: 16 + punch * 10, hy: -10 + punch * 22, bend: 4 * (1 - punch) }];
            }
            return [{ hx: -8, hy: 17, bend: 4 }, { hx: 15, hy: 5, bend: 4 }]; // 持械戒备
        }
        if (entity.isAttacking) { // 空手出拳：蓄力后拉 → 快速打直
            return [{ hx: -7 - punch * 3, hy: 16, bend: 4 }, { hx: -10 + punch * 44, hy: 4 - punch * 6, bend: 6 * (1 - punch) }];
        }
        if (!entity.isGrounded) { // 跳跃：双臂微张
            return [{ hx: -13, hy: 12, bend: 5 }, { hx: 14, hy: 10, bend: 5 }];
        }
        if (walking) { // 与腿反相摆臂
            const s = Math.sin(ph) * 9;
            return [{ hx: -2 + s, hy: 16, bend: 3 }, { hx: 2 - s, hy: 16, bend: 3 }];
        }
        const sway = Math.sin(frame * 0.045) * 1.5; // 站立：随呼吸轻摆
        return [{ hx: -7, hy: 19 + sway, bend: 3 }, { hx: 7, hy: 19 - sway, bend: 3 }];
    })();

    // 返回手的位置（持武器要把武器画在手上）
    const drawArm = (t: { hx: number; hy: number; bend: number }) => {
        const hand = { x: shoulder.x + t.hx, y: shoulder.y + t.hy };
        const elbow = { x: (shoulder.x + hand.x) / 2 - t.bend, y: (shoulder.y + hand.y) / 2 + 2 }; // 肘朝后弯
        ctx.strokeStyle = entity.color;
        ctx.beginPath();
        ctx.moveTo(shoulder.x, shoulder.y);
        ctx.lineTo(elbow.x, elbow.y);
        ctx.lineTo(hand.x, hand.y);
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle; // 小拳头
        ctx.beginPath();
        ctx.arc(hand.x, hand.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        return hand;
    };

    drawArm(armTargets[0]);          // 远侧臂：藏在躯干后面
    drawLeg(legTargets[1]);          // 近侧腿

    // ---- 喷气背包（背在背部，躯干会盖住前缘）----
    if (entity.jetpackFuel > 0) {
        const packTop = shoulder.y + 3;
        const packBottom = hip.y - 2;
        // 绑带：从背包上沿斜绕到胸前
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-8, packTop + 2);
        ctx.lineTo(7, shoulder.y + 7);
        ctx.stroke();
        // 罐体
        ctx.fillStyle = '#94a3b8';
        roundRectPath(ctx, -13, packTop, 9, packBottom - packTop, 3);
        ctx.fill();
        // 罐体高光
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        roundRectPath(ctx, -12, packTop + 1.5, 2, packBottom - packTop - 3, 1);
        ctx.fill();
        // 喷口
        ctx.fillStyle = '#475569';
        roundRectPath(ctx, -12, packBottom - 1, 7, 4, 1.5);
        ctx.fill();
        // 喷焰：外橙内黄，长度每帧随机抖才有"喷火"感
        if (entity.jetThrusting) {
            const nx = -8.5;
            const flameLen = 15 + Math.random() * 7;
            ctx.fillStyle = '#f97316';
            ctx.beginPath();
            ctx.moveTo(nx - 4.5, packBottom + 2);
            ctx.quadraticCurveTo(nx - 3, packBottom + flameLen * 0.6, nx, packBottom + flameLen);
            ctx.quadraticCurveTo(nx + 3, packBottom + flameLen * 0.6, nx + 4.5, packBottom + 2);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#fde047';
            const innerLen = flameLen * 0.6;
            ctx.beginPath();
            ctx.moveTo(nx - 2.5, packBottom + 2);
            ctx.quadraticCurveTo(nx - 1.5, packBottom + innerLen * 0.6, nx, packBottom + innerLen);
            ctx.quadraticCurveTo(nx + 1.5, packBottom + innerLen * 0.6, nx + 2.5, packBottom + 2);
            ctx.closePath();
            ctx.fill();
        }
    }

    // ---- 躯干 ----
    ctx.strokeStyle = entity.color;
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(neck.x, neck.y);
    ctx.stroke();

    // ---- 头（实心圆，不画眼睛）----
    ctx.fillStyle = entity.color;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 12, 0, Math.PI * 2);
    ctx.fill();

    // ---- 近侧臂（最后画，持武器时武器跟手）----
    const frontHand = drawArm(armTargets[1]);
    if (entity.heldWeapon) {
        ctx.save();
        ctx.translate(frontHand.x, frontHand.y);
        drawHeldWeapon(ctx, entity.heldWeapon);
        ctx.restore();
    }

    ctx.restore();
};

const GameCanvas: React.FC<GameCanvasProps> = ({ gameState, setGameState, setStats, setPlayers, gameMode, map }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>();
  const frameRef = useRef<number>(0);
  
  const entitiesRef = useRef<Entity[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const fallingItemsRef = useRef<FallingItem[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  
  // 武器生成控制
  const spawnedWeaponCountRef = useRef<number>(0);
  const missileIndexRef = useRef<number>(-1);
  const dragonIndexRef = useRef<number>(-1);
  // 喷气背包每局至多掉 1 个（0 = 还没掉过）
  const jetpackSpawnedRef = useRef<number>(0);
  // 当前喷气声正在响的实体（边沿检测：只在状态变化时开/关音效）
  const jetActiveRef = useRef<Set<string>>(new Set());
  
  const keysRef = useRef<Set<string>>(new Set());
  const statsRef = useRef<GameStats>({ winner: null, mode: gameMode, duration: 0 });
  const shakeRef = useRef<number>(0);
  const flashRef = useRef<number>(0);
  const winTimeoutRef = useRef<number | null>(null);
  const victoryFrameRef = useRef<number>(0); // 胜利动画时间轴（帧）
  // 本帧有人出局，等伤害结算完再裁决胜负（见 update 里的 resolveOutcome）
  const pendingOutcomeRef = useRef<boolean>(false);
  // COOP 双人闯关：波次状态机（其它模式不使用）
  const waveRef = useRef<number>(1);
  const waveStateRef = useRef<'fighting' | 'intermission'>('fighting');
  const waveTimerRef = useRef<number>(0);
  const coopBannerRef = useRef<{ text: string; life: number } | null>(null);

  // 固定步长主循环的时间累积器
  const lastTimeRef = useRef<number>(0);
  const accRef = useRef<number>(0);
  const hudSigRef = useRef<string>(''); // 上一次同步到 HUD 的签名

  // 敌我判定：PVE/PVP 里所有人互为敌人；COOP 按阵营分敌我
  const isHostile = (a: Entity, b: Entity) => gameMode !== 'COOP' || a.team !== b.team;

  // 伤害是否生效：COOP 下同阵营免伤（不误伤队友/自己）；其它模式维持原判定（人人都可能被打）
  const canDamage = (target: Entity, ownerId: string) => {
    if (gameMode !== 'COOP') return true;
    const owner = entitiesRef.current.find(e => e.id === ownerId);
    return !owner || owner.team !== target.team;
  };

  // 查找与指定角色敌对且存活的最近目标（追踪弹 / AI 共用）
  const findEnemy = (ownerId: string) => {
    const owner = entitiesRef.current.find(e => e.id === ownerId);
    if (!owner) return entitiesRef.current.find(e => e.id !== ownerId && !e.isDead);
    let best: Entity | undefined;
    let bestDist = Infinity;
    for (const e of entitiesRef.current) {
      if (e.isDead || e.id === ownerId || !isHostile(owner, e)) continue;
      const d = Math.abs(e.pos.x - owner.pos.x) + Math.abs(e.pos.y - owner.pos.y);
      if (d < bestDist) { bestDist = d; best = e; }
    }
    return best;
  };

  /*
    AI 决策（组件级）：追踪最近的敌对目标，优先捡掉落物，会跳跃越障 / 喷气追高 / 按武器射程攻击。
    单人模式的 P2 与 COOP 的怪物共用同一套大脑；这里只输出"按键意图"，
    移动 / 起跳 / 喷气 / 挥击仍由主循环统一执行，行为和真人按键完全一致。
  */
  const aiDecide = (self: Entity, lay: Layout) => {
    const flags = { moveLeft: false, moveRight: false, jump: false, crouch: false, attack: false };

    // 选最近的敌对存活目标
    let target: Entity | undefined;
    let bestDist = Infinity;
    for (const cand of entitiesRef.current) {
      if (cand.isDead || cand.id === self.id || !isHostile(self, cand)) continue;
      const d = Math.abs(cand.pos.x - self.pos.x) + Math.abs(cand.pos.y - self.pos.y);
      if (d < bestDist) { bestDist = d; target = cand; }
    }
    if (!target) return flags;

    let targetX = target.pos.x;
    let targetY = target.pos.y;

    // 手里没武器时优先去捡掉落物（怪物不捡任何掉落物：只追玩家）
    if (self.team !== 'enemy' && !self.heldWeapon && fallingItemsRef.current.length > 0) {
      let minDist = 9999;
      fallingItemsRef.current.forEach(item => {
        if (self.team === 'enemy' && item.type === 'jetpack') return;
        const d = Math.abs(item.pos.x - self.pos.x) + Math.abs(item.pos.y - self.pos.y);
        if (d < minDist) {
          minDist = d;
          targetX = item.pos.x;
          targetY = item.pos.y;
        }
      });
    }

    const distX = targetX - self.pos.x;
    const distY = targetY - self.pos.y;

    if (Math.abs(distX) > 40) {
      distX > 0 ? flags.moveRight = true : flags.moveLeft = true;
    } else if (!self.heldWeapon && Math.abs(distX) < 20) {
      distX > 0 ? flags.moveLeft = true : flags.moveRight = true;
    }

    if (self.isGrounded) {
      if (distY < -100 || (Math.random() < 0.02)) flags.jump = true;

      // 地形感知：前方是实心箱子就起跳翻过去，前方是陷阱就跳过去
      const dir = flags.moveRight ? 1 : flags.moveLeft ? -1 : 0;
      if (dir !== 0) {
        const blocked = lay.blocks.some(b =>
          self.pos.y > b.y + 4 &&
          (dir > 0 ? b.x - self.pos.x : self.pos.x - (b.x + b.width)) < 46 &&
          (dir > 0 ? b.x + b.width > self.pos.x : b.x < self.pos.x));
        const spikeAhead = lay.spikes.some(sp =>
          (dir > 0 ? sp.x - self.pos.x : self.pos.x - (sp.x + sp.width)) < 60 &&
          (dir > 0 ? sp.x + sp.width > self.pos.x : sp.x < self.pos.x));
        if (blocked || spikeAhead) flags.jump = true;
      }
    }

    // 喷气背包：目标在高处（高出一个平台层）时，空中继续"按住跳"喷上去
    if (!self.isGrounded && self.jetpackFuel > 0 && distY < -90) flags.jump = true;

    self.facingRight = (target.pos.x - self.pos.x) > 0;

    // 攻击距离按武器类型放宽
    let attackRange = ATTACK_RANGE;
    if (self.heldWeapon === 'sword') attackRange = getBuiltinStats('sword').range ?? 140; // 长剑射程可在武器库调
    if (self.heldWeapon === 'atom_bomb') attackRange = 300;
    if (self.heldWeapon === 'missile') attackRange = 700;
    if (self.heldWeapon === 'dragon') attackRange = 400;
    if (self.heldWeapon === 'bomber') attackRange = 800;
    if (self.heldWeapon === 'pokemon') attackRange = 800;
    if (self.heldWeapon === 'laser') attackRange = 1000;
    if (self.heldWeapon === 'zeperion') attackRange = 1000;
    if (self.heldWeapon === 'c4') attackRange = 300;
    if (self.heldWeapon === 'piercer') attackRange = 700;
    if (self.heldWeapon === 'aug') attackRange = 900;
    if (self.heldWeapon === 'gatling') attackRange = 900;
    if (self.heldWeapon === 'gas') attackRange = 600;
    // 自创武器：近战用自己的 range，枪/投掷按远程处理
    const aiCustom = getCustom(self.heldWeapon);
    if (aiCustom) attackRange = aiCustom.template === 'melee' ? aiCustom.range : 700;

    if (Math.abs(target.pos.x - self.pos.x) < attackRange && Math.abs(target.pos.y - self.pos.y) < 100) {
      if (self.attackCooldown === 0 && Math.random() < 0.05) flags.attack = true;
    }

    return flags;
  };

  // COOP：按波次制造怪物（复用玩家实体结构，team = 'enemy'，由 AI 操控）
  const spawnCoopWave = (wave: number) => {
    const count = COOP_WAVE_ENEMIES[wave - 1] ?? COOP_WAVE_ENEMIES[COOP_WAVE_ENEMIES.length - 1];
    const hp = COOP_WAVE_HEALTH[wave - 1] ?? 100;
    for (let i = 0; i < count; i++) {
      // playerIndex ≥ 2：绕开 P1/P2 的键盘输入分支，怪物一律走 AI
      const enemy: Entity = {
        id: `enemy_${wave}_${i}`, type: 'player', playerIndex: 2 + i,
        pos: { x: 0, y: 100 }, vel: { x: 0, y: 0 },
        width: 52, height: 91,
        color: COOP_ENEMY_COLOR,
        isGrounded: false, isCrouching: false, health: hp, maxHealth: hp, isDead: false,
        facingRight: false, attackCooldown: 0, isAttacking: false, attackFrame: 0,
        heldWeapon: null, ammo: 0, weaponDuration: 0, stunFrames: 0, spikeCooldown: 0,
        jetpackFuel: 0, jetThrusting: false,
        team: 'enemy'
      };
      const slotX = window.innerWidth * (COOP_ENEMY_SLOTS[i % COOP_ENEMY_SLOTS.length]);
      enemy.pos.x = Math.max(WALL_MARGIN + 30, Math.min(window.innerWidth - WALL_MARGIN - 30, slotX));
      entitiesRef.current.push(enemy);
      spawnParticles(enemy.pos.x, enemy.pos.y - 40, enemy.color, 14, 7); // 出生烟雾
    }
  };

  // 初始化对决
  const initGame = useCallback(() => {
    const newEntities: Entity[] = [];

    // P1 (左侧)
    newEntities.push({
      id: 'p1', type: 'player', playerIndex: 0,
      pos: { x: 100, y: 100 }, vel: { x: 0, y: 0 },
      width: 52, height: 91, color: '#1677ff',
      isGrounded: false, isCrouching: false, health: 100, maxHealth: 100, isDead: false,
      facingRight: true, attackCooldown: 0, isAttacking: false, attackFrame: 0,
      heldWeapon: null, ammo: 0, weaponDuration: 0, stunFrames: 0, spikeCooldown: 0,
      jetpackFuel: 0, jetThrusting: false,
      team: 'player'
    });

    // P2/CPU (右侧)
    newEntities.push({
      id: 'p2', type: 'player', playerIndex: 1,
      pos: { x: window.innerWidth - 100, y: 100 }, vel: { x: 0, y: 0 },
      width: 52, height: 91, color: '#facc15',
      isGrounded: false, isCrouching: false, health: 100, maxHealth: 100, isDead: false,
      facingRight: false, attackCooldown: 0, isAttacking: false, attackFrame: 0,
      heldWeapon: null, ammo: 0, weaponDuration: 0, stunFrames: 0, spikeCooldown: 0,
      jetpackFuel: 0, jetThrusting: false,
      team: 'player'
    });

    // 每局重新随机一次地形（固定平台保留，随机追加平台与障碍）
    regenerateLayout(map);

    entitiesRef.current = newEntities;
    // COOP：重置波次状态机并刷出第一关的怪物
    waveRef.current = 1;
    waveStateRef.current = 'fighting';
    waveTimerRef.current = 0;
    coopBannerRef.current = gameMode === 'COOP' ? { text: '第 1 关', life: 150 } : null;
    if (gameMode === 'COOP') spawnCoopWave(1);
    particlesRef.current = [];
    fallingItemsRef.current = [];
    projectilesRef.current = [];
    // 关掉上一局可能残留的喷气声（理论上裁决时已停，这里兜底）
    jetActiveRef.current.forEach(() => stopJetSound());
    jetActiveRef.current.clear();
    spawnedWeaponCountRef.current = 0;
    jetpackSpawnedRef.current = 0;
    
    const indices = Array.from({length: MAX_WEAPONS_PER_GAME}, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    
    missileIndexRef.current = indices[1];
    dragonIndexRef.current = indices[2]; 

    statsRef.current = {
      winner: null, mode: gameMode, duration: 0,
      ...(gameMode === 'COOP' ? { wave: 1, totalWaves: COOP_TOTAL_WAVES } : {})
    };
    frameRef.current = 0;
    shakeRef.current = 0;
    flashRef.current = 0;
    victoryFrameRef.current = 0;
    pendingOutcomeRef.current = false; // 上一局没结算完的胜负不该带进新一局
    
    setStats(statsRef.current);
    setPlayers([...entitiesRef.current]);
  }, [gameMode, map, setStats, setPlayers]);

  useEffect(() => {
    // 游戏用到的按键：阻止默认行为（空格/方向键滚动页面、回车触发聚焦按钮）
    const GAME_KEYS = new Set([
        'Space', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'KeyW', 'KeyA', 'KeyS', 'KeyD',
    ]);

    const handleKeyDown = (e: KeyboardEvent) => {
        if (GAME_KEYS.has(e.code)) e.preventDefault();
        if (e.repeat) return;
        keysRef.current.add(e.code);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
        if (GAME_KEYS.has(e.code)) e.preventDefault();
        keysRef.current.delete(e.code);
    };
    // 切到别的窗口 / 标签页时清空按键，避免回来时角色一直往一个方向跑
    const clearKeys = () => keysRef.current.clear();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearKeys);
    document.addEventListener('visibilitychange', clearKeys);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearKeys);
      document.removeEventListener('visibilitychange', clearKeys);
    };
  }, []);

  useEffect(() => {
    // 换局/回菜单时清空按键：上一局按住不放的方向键、攻击键不该被带进新的一局，
    // 否则新角色一出生就自己往一个方向跑、自己挥拳。
    keysRef.current.clear();
    if (gameState === GameState.PLAYING) {
      initGame();
    }
  }, [gameState, initGame]);

  const spawnParticles = (x: number, y: number, color: string, count: number, speed = 8, lifeMultiplier = 1, baseSize = 3) => {
      for(let i=0; i<count; i++) {
          particlesRef.current.push({
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

  // 光波冲击波：向外扩散的描边圆环
  const spawnShockwave = (x: number, y: number, color = '#ffe28a', scale = 1) => {
    const rings = [
        { size: 4, growth: 13, life: 24, lw: 8,  a: 0.9,  d: 0.04, c: '#ffffff' },
        { size: 2, growth: 8,  life: 30, lw: 5,  a: 0.8,  d: 0.03, c: color },
        { size: 0, growth: 4,  life: 38, lw: 3,  a: 0.6,  d: 0.02, c: color },
    ];
    rings.forEach((r, idx) => {
        particlesRef.current.push({
            id: 'sw' + Math.random().toString(36).slice(2) + idx,
            pos: { x, y },
            vel: { x: 0, y: 0 },
            life: r.life, maxLife: r.life,
            color: r.c,
            size: r.size * scale,
            gravity: 0,
            growth: r.growth * scale,
            alphaDecay: r.d,
            currentAlpha: r.a,
            kind: 'ring',
            lineWidth: r.lw,
            lineWidthDecay: 0.3
        });
    });
  };

  // 爆炸云团：火心 + 翻滚烟柱 + 贴地尘土
  const spawnExplosionCloud = (x: number, y: number, scale = 1) => {
    // 1. 火心 (橙红燃烧)
    for (let i = 0; i < 30; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 4;
        particlesRef.current.push({
            pos: { x, y },
            vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed - 1 },
            life: 50, maxLife: 50,
            color: Math.random() > 0.5 ? '#ff5500' : '#ff8800',
            size: (10 + Math.random() * 8) * scale,
            gravity: -0.03,
            growth: 0.6,
            alphaDecay: 0.03,
            currentAlpha: 0.9
        });
    }
    // 2. 灰色烟团 (翻滚上升)
    for (let i = 0; i < 25; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3;
        particlesRef.current.push({
            pos: { x: x + (Math.random() - 0.5) * 30, y: y - 10 },
            vel: { x: Math.cos(angle) * speed, y: -1 - Math.random() * 2.5 },
            life: 120, maxLife: 120,
            color: Math.random() > 0.5 ? '#555' : '#444',
            size: (14 + Math.random() * 12) * scale,
            gravity: -0.04,
            growth: 0.5,
            alphaDecay: 0.008,
            currentAlpha: 0.75
        });
    }
    // 3. 底部尘土冲击 (贴地扩散)
    for (let i = 0; i < 20; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        particlesRef.current.push({
            pos: { x, y },
            vel: { x: dir * (6 + Math.random() * 8), y: -1 - Math.random() },
            life: 70, maxLife: 70,
            color: '#8a7a5a',
            size: 10 + Math.random() * 6,
            gravity: 0.2,
            growth: 0.3,
            alphaDecay: 0.015,
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
          pos: { x, y },
          vel: { x: (Math.random() - 0.5) * 2, y: Math.random() * 2 + 1 },
          life: 200, maxLife: 200, color, size: Math.random() * 4 + 3, gravity: 0.02 
      });
  };

  const spawnFallingItem = (canvasWidth: number) => {
      let type: ItemKind;

      const count = spawnedWeaponCountRef.current;

      // 稀有槽位也要过武器库的禁用开关：被禁用就退化成普通掉落
      if (count === missileIndexRef.current && !isBuiltinDisabled('missile')) {
          type = 'missile';
      } else if (count === dragonIndexRef.current && !isBuiltinDisabled('dragon')) {
          type = 'dragon';
      } else if (jetpackSpawnedRef.current === 0 && Math.random() < JETPACK_DROP_CHANCE) {
          // 普通槽位掷一次：喷气背包道具（每局至多 1 个），不占武器池
          type = 'jetpack';
          jetpackSpawnedRef.current = 1;
      } else {
          // 普通池从武器库存档取：被禁用的内置武器剔除，小朋友的自创武器进池
          const normalPool = getDropPool();
          // 全部禁用且没有自创武器时兜底：至少让长剑能掉，不然天上什么都不掉了
          type = normalPool.length > 0
              ? normalPool[Math.floor(Math.random() * normalPool.length)]
              : 'sword';
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
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 时间轴与衰减始终推进：菜单界面的背景动画（星空闪烁 / 楼顶信号灯 / 落叶）也要动
    frameRef.current++;
    if (shakeRef.current > 0) shakeRef.current--;
    if (flashRef.current > 0) flashRef.current -= 0.02;
    // COOP 波次横幅：倒计时归零后消失
    if (coopBannerRef.current) {
      coopBannerRef.current.life--;
      if (coopBannerRef.current.life <= 0) coopBannerRef.current = null;
    }

    if (gameState !== GameState.PLAYING && gameState !== GameState.VICTORY_ANIMATION) return;

    const platforms = getPlatforms(map, canvas.width);

    // 分出胜负后就不再累计时长：平局走的是 triggerDraw，它不切 gameState，
    // 不拦一下的话这 2.2 秒结算窗口会被算进本局时长，和胜利路径口径不一致。
    if (gameState === GameState.PLAYING && !statsRef.current.winner) statsRef.current.duration += 1/60;
    if (gameState === GameState.VICTORY_ANIMATION) victoryFrameRef.current++;

    // 按"谁还站着"裁决本局胜负。两个都倒下 = 同归于尽 = 平局。
    const resolveOutcome = () => {
        if (statsRef.current.winner) return;

        // 裁决后实体不再处理输入（胜利动画提前 return），喷气声在这里统一关掉
        jetActiveRef.current.forEach(() => stopJetSound());
        jetActiveRef.current.clear();

        // COOP：只判"全军覆没 = 闯关失败"。清空怪物不算胜负，
        // 交给下面的波次状态机推进（最后一关清空才宣布胜利）。
        if (gameMode === 'COOP') {
            if (entitiesRef.current.filter(e => e.team === 'player').every(p => p.isDead)) {
                statsRef.current.winner = 'ENEMIES';
                winTimeoutRef.current = window.setTimeout(() => setGameState(GameState.GAME_OVER), 2200);
            }
            return;
        }

        const alive = entitiesRef.current.filter(e => !e.isDead);
        if (alive.length !== 1) {
            statsRef.current.winner = 'DRAW';
            winTimeoutRef.current = window.setTimeout(() => setGameState(GameState.GAME_OVER), 2200);
            return;
        }

        const winner = alive[0];
        winner.isWinner = true;
        statsRef.current.winner = winner.id === 'p1' ? 'P1' : 'P2';
        victoryFrameRef.current = 0;
        setGameState(GameState.VICTORY_ANIMATION);
        winTimeoutRef.current = window.setTimeout(() => setGameState(GameState.GAME_OVER), 4000);
    };

    // 有人出局 / 宣布平局 —— 这里只记账，真正的裁决交给下面的 resolveOutcome。
    // 不能就地判定：同一帧里可能先有人被打死、紧接着另一个也被同归于尽带走，
    // 就地判会让先死的那个"抢先"当上胜者，甚至出现尸体上台领奖。
    // 所以 winnerId 参数已经用不上了 —— 谁赢只看下一帧谁还站着。
    const triggerWin = (_winnerId: string) => { pendingOutcomeRef.current = true; };
    const triggerDraw = () => { pendingOutcomeRef.current = true; };

    // 上一帧报的"有人出局"，现在所有伤害都已结算完，可以裁决了
    if (pendingOutcomeRef.current) {
        pendingOutcomeRef.current = false;
        resolveOutcome();
    }

    const detonateC4 = (c4: Projectile) => {
        if (!c4.active) return;
        c4.active = false;
        shakeRef.current = 60;
        flashRef.current = 0.5;
        playExplodeSound();
        // 爆炸火球与浓烟
        spawnParticles(c4.pos.x, c4.pos.y, '#ff8c00', 40, 15, 2);
        spawnParticles(c4.pos.x, c4.pos.y - 10, '#555', 20, 8, 2);
        spawnShockwave(c4.pos.x, c4.pos.y);
        spawnExplosionCloud(c4.pos.x, c4.pos.y - 10, 0.9);
        // 范围伤害（不伤及埋设者本人）：伤害/半径发射时已烘焙到弹上
        const c4Radius = c4.blastRadius ?? 220;
        const c4Damage = c4.damage ?? 40;
        entitiesRef.current.forEach(target => {
            if (target.id === c4.ownerId || target.isDead || !canDamage(target, c4.ownerId)) return;
            const dx = target.pos.x - c4.pos.x;
            const dy = target.pos.y - c4.pos.y;
            if (dx * dx + dy * dy < c4Radius * c4Radius) {
                target.health -= c4Damage;
                target.stunFrames = 35;
                const angle = Math.atan2(dy, dx);
                target.vel.x = Math.cos(angle) * 35;
                target.vel.y = Math.sin(angle) * 35 - 5;
                if (target.health <= 0) {
                    target.health = 0;
                    target.isDead = true;
                    target.isLoser = true;
                    triggerWin(c4.ownerId);
                }
            }
        });
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
            platforms.forEach(plat => {
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

        // 胜利动画期间冻结投射物：避免庆祝中的胜者被场上残余的爆炸 / 毒气二次打死
        if (gameState === GameState.VICTORY_ANIMATION) return;

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
            const target = findEnemy(proj.ownerId);
            
            if (proj.pokemonState === 'seeking') {
                if (target) {
                    const dx = target.pos.x - proj.pos.x;
                    const dy = (target.pos.y - 40) - proj.pos.y;
                    const dist = Math.max(Math.sqrt(dx*dx + dy*dy), 1);

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
                         target.health -= proj.damage ?? 20;
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
            const target = findEnemy(proj.ownerId);
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
                    // 投掷炸弹：继承轰炸机的数值（小炸弹=20 伤/半径120，与整颗手雷区分）
                    projectilesRef.current.push({
                        id: Math.random().toString(),
                        type: 'bomb',
                        pos: { x: proj.pos.x, y: proj.pos.y + 20 },
                        vel: { x: proj.vel.x * 0.5, y: 5 }, // 继承一点惯性
                        ownerId: proj.ownerId,
                        width: 20, height: 20, active: true,
                        damage: proj.damage,
                        blastRadius: proj.blastRadius
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
                const target = findEnemy(proj.ownerId);
                if (target) {
                    const dx = target.pos.x - proj.pos.x;
                    const dy = (target.pos.y - 40) - proj.pos.y;
                    const dist = Math.max(Math.sqrt(dx*dx + dy*dy), 1);

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
                                
                                target.health -= proj.damage ?? 5;
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

        // --- 穿地弹逻辑 ---
        if (proj.type === 'piercer') {
            if (proj.piercerState === 'flying') {
                proj.vel.y += GRAVITY; // 弹体较重，下坠快
                proj.pos.x += proj.vel.x;
                proj.pos.y += proj.vel.y;
                // 撞击地面：钻入地下
                if (proj.pos.y >= GROUND_Y - 6) {
                    proj.piercerState = 'burrowing';
                    proj.pos.y = GROUND_Y + 26;
                    proj.vel = { x: 0, y: 0 };
                    shakeRef.current = 6;
                    // 入地扬尘
                    for (let i = 0; i < 16; i++) {
                        particlesRef.current.push({
                            pos: { x: proj.pos.x + (Math.random() - 0.5) * 20, y: GROUND_Y },
                            vel: { x: (Math.random() - 0.5) * 6, y: -2 - Math.random() * 5 },
                            life: 30, maxLife: 30, color: '#8a7a5a', size: 6, gravity: 0.3
                        });
                    }
                }
            } else if (proj.piercerState === 'burrowing') {
                // 地下潜行，追踪敌人水平位置
                const target = findEnemy(proj.ownerId);
                const dir = target
                    ? (target.pos.x > proj.pos.x ? 1 : -1)
                    : (proj.piercerDir || 1);
                proj.piercerDir = dir;
                proj.pos.x += dir * 9;
                proj.pos.y = GROUND_Y + 26; // 保持在地底
                proj.piercerTimer = (proj.piercerTimer || 0) + 1;

                // 地面隆起 + 沿途扬尘
                if (frameRef.current % 2 === 0) {
                    particlesRef.current.push({
                        pos: { x: proj.pos.x, y: GROUND_Y - 2 },
                        vel: { x: (Math.random() - 0.5) * 4, y: -2 - Math.random() * 4 },
                        life: 26, maxLife: 26, color: '#7a6a4a', size: 5, gravity: 0.35
                    });
                }
                shakeRef.current = Math.max(shakeRef.current, 2);

                // 到达目标正下方后破土
                const reached = target
                    ? Math.abs(target.pos.x - proj.pos.x) < 32
                    : (proj.piercerTimer || 0) > 110;
                if (reached) {
                    proj.piercerState = 'erupting';
                    proj.vel = { x: dir * 3, y: -20 };
                    proj.piercerTimer = 0;
                }
            } else if (proj.piercerState === 'erupting') {
                proj.vel.y += GRAVITY;
                proj.pos.x += proj.vel.x;
                proj.pos.y += proj.vel.y;
                proj.piercerTimer = (proj.piercerTimer || 0) + 1;

                // 冲出地面后引爆
                if (proj.pos.y <= GROUND_Y - 60 || (proj.piercerTimer || 0) > 30) {
                    proj.active = false;
                    shakeRef.current = 35;
                    flashRef.current = Math.max(flashRef.current, 0.3);
                    playExplodeSound();
                    spawnParticles(proj.pos.x, GROUND_Y, '#8a7a5a', 30, 12, 1.5);
                    spawnParticles(proj.pos.x, GROUND_Y - 20, '#ff8c00', 30, 14, 1.5);
                    spawnShockwave(proj.pos.x, GROUND_Y - 10, '#ffb46b', 1.2);
                    spawnExplosionCloud(proj.pos.x, GROUND_Y - 10, 0.7);

                    // 范围伤害 + 强力上抛：数值发射时已烘焙到弹上
                    const piercerRadius = proj.blastRadius ?? 200;
                    const piercerDamage = proj.damage ?? 30;
                    entitiesRef.current.forEach(target => {
                        if (target.id === proj.ownerId || target.isDead || !canDamage(target, proj.ownerId)) return;
                        const dx = target.pos.x - proj.pos.x;
                        const dy = target.pos.y - GROUND_Y;
                        if (dx * dx + dy * dy < piercerRadius * piercerRadius) {
                            target.health -= piercerDamage;
                            target.stunFrames = 40;
                            target.vel.x = (dx >= 0 ? 1 : -1) * 22;
                            target.vel.y = -26;
                            if (target.health <= 0) {
                                target.health = 0;
                                target.isDead = true;
                                target.isLoser = true;
                                triggerWin(proj.ownerId);
                            }
                        }
                    });
                }
            }
            return;
        }

        // --- 毒气弹逻辑 ---
        if (proj.type === 'gas') {
            if (proj.gasState === 'flying') {
                proj.vel.y += GRAVITY;
                proj.pos.x += proj.vel.x;
                proj.pos.y += proj.vel.y;

                let landed = false;
                if (proj.pos.y >= GROUND_Y - 6) {
                    proj.pos.y = GROUND_Y - 6;
                    landed = true;
                } else if (proj.vel.y > 0) {
                    platforms.forEach(plat => {
                        if (proj.pos.x > plat.x && proj.pos.x < plat.x + plat.width &&
                            proj.pos.y >= plat.y - 6 && proj.pos.y <= plat.y + 20) {
                            proj.pos.y = plat.y - 6;
                            landed = true;
                        }
                    });
                }

                if (landed) {
                    proj.gasState = 'cloud';
                    proj.gasTimer = 0;
                    proj.vel = { x: 0, y: 0 };
                    spawnParticles(proj.pos.x, proj.pos.y, '#7dd87d', 24, 6); // 释放毒气
                }
                return;
            }

            // cloud 状态：持续扩散并造成持续伤害（半径来自武器库数值，默认 120）
            const gasMaxRadius = proj.blastRadius ?? 120;
            proj.gasTimer = (proj.gasTimer || 0) + 1;
            if (proj.gasTimer < 20) {
                proj.gasRadius = 10 + (proj.gasTimer / 20) * (gasMaxRadius - 10);
            } else {
                proj.gasRadius = gasMaxRadius;
            }

            // 5 秒后消散
            if (proj.gasTimer > 300) {
                proj.active = false;
                return;
            }

            // 末尾淡出的绿色粒子
            if (proj.gasTimer > 260 && frameRef.current % 4 === 0) {
                spawnParticles(
                    proj.pos.x + (Math.random() - 0.5) * 120,
                    proj.pos.y + (Math.random() - 0.5) * 60,
                    '#9be29b', 1, 1, 0.5, 3
                );
            }

            // 持续伤害：每 8 帧对范围内玩家造成 proj.damage（默认 1）点伤害
            if (proj.gasTimer % 8 === 0) {
                const R = proj.gasRadius || 120;
                entitiesRef.current.forEach(target => {
                    if (target.isDead || !canDamage(target, proj.ownerId)) return;
                    const dx = target.pos.x - proj.pos.x;
                    const dy = (target.pos.y - 30) - proj.pos.y;
                    if (dx * dx + dy * dy < (R + 30) * (R + 30)) {
                        target.health -= proj.damage ?? 1;
                        spawnParticles(target.pos.x, target.pos.y - 30, '#a4e8a4', 2, 2, 0.5, 2);
                        if (target.health <= 0) {
                            target.health = 0;
                            target.isDead = true;
                            target.isLoser = true;
                            if (target.id === proj.ownerId) {
                                const other = entitiesRef.current.find(e => e.id !== proj.ownerId);
                                if (other) triggerWin(other.id);
                            } else {
                                triggerWin(proj.ownerId);
                            }
                        }
                    }
                });
            }
            return;
        }

        // --- AUG 步枪弹道 ---
        if (proj.type === 'aug') {
            if (!proj.trail) proj.trail = [];
            proj.trail.push({ ...proj.pos });
            if (proj.trail.length > 12) proj.trail.shift();

            proj.pos.x += proj.vel.x;
            proj.pos.y += proj.vel.y;

            // 出界自动失效
            if (proj.pos.x < -50 || proj.pos.x > canvas.width + 50 || proj.pos.y < -50 || proj.pos.y > canvas.height + 50) {
                proj.active = false;
            }

            // 命中检测（单发，不穿透）
            entitiesRef.current.forEach(target => {
                if (target.id === proj.ownerId || target.isDead || !proj.active || !canDamage(target, proj.ownerId)) return;
                if (Math.abs(proj.pos.x - target.pos.x) < 20 &&
                    proj.pos.y > target.pos.y - 75 && proj.pos.y < target.pos.y + 10) {
                    proj.active = false;
                    target.health -= proj.damage ?? 6; // 伤害发射时已烘焙到弹上
                    target.stunFrames = 8;
                    target.vel.x += proj.vel.x > 0 ? 4 : -4;
                    playHitSound();
                    spawnParticles(proj.pos.x, proj.pos.y, '#ffe28a', 6, 6);
                    shakeRef.current = 2;
                    if (target.health <= 0) {
                        target.health = 0;
                        target.isDead = true;
                        target.isLoser = true;
                        triggerWin(proj.ownerId);
                    }
                }
            });
            return;
        }

        // --- 加特林 & 自创枪械弹道：同 AUG 的直线单发弹，伤害/颜色取自各自参数 ---
        if (proj.type === 'gatling' || (isCustomId(proj.type) && proj.blastRadius === undefined)) {
            if (!proj.trail) proj.trail = [];
            proj.trail.push({ ...proj.pos });
            if (proj.trail.length > 12) proj.trail.shift();

            proj.pos.x += proj.vel.x;
            proj.pos.y += proj.vel.y;

            if (proj.pos.x < -50 || proj.pos.x > canvas.width + 50 || proj.pos.y < -50 || proj.pos.y > canvas.height + 50) {
                proj.active = false;
            }

            // 伤害读发射时烘焙的 proj.damage（加特林默认 4，自创枪械默认 6）
            const bulletDmg = proj.damage ?? (proj.type === 'gatling' ? 4 : 6);
            const tint = proj.tint ?? '#ffd23a';

            entitiesRef.current.forEach(target => {
                if (target.id === proj.ownerId || target.isDead || !proj.active || !canDamage(target, proj.ownerId)) return;
                if (Math.abs(proj.pos.x - target.pos.x) < 20 &&
                    proj.pos.y > target.pos.y - 75 && proj.pos.y < target.pos.y + 10) {
                    proj.active = false;
                    target.health -= bulletDmg;
                    target.stunFrames = 6;
                    target.vel.x += proj.vel.x > 0 ? 3 : -3;
                    playHitSound();
                    spawnParticles(proj.pos.x, proj.pos.y, tint, 6, 6);
                    shakeRef.current = 2;
                    if (target.health <= 0) {
                        target.health = 0;
                        target.isDead = true;
                        target.isLoser = true;
                        triggerWin(proj.ownerId);
                    }
                }
            });
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
                    pos: { x: proj.pos.x, y: proj.pos.y },
                    vel: { x: -proj.vel.x * 0.1, y: -proj.vel.y * 0.1 }, // 惯性残留
                    life: 40, maxLife: 40, color: '#aaa', size: 6, gravity: 0, growth: 0.2, alphaDecay: 0.05
                });
                // 火焰中心
                particlesRef.current.push({
                    pos: { x: proj.pos.x, y: proj.pos.y },
                    vel: { x: -proj.vel.x * 0.5, y: -proj.vel.y * 0.5 },
                    life: 10, maxLife: 10, color: '#ff5500', size: 4, gravity: 0
                });
            }

            const target = findEnemy(proj.ownerId);
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

        // --- C4 炸弹逻辑 ---
        if (proj.type === 'c4') {
            const h = proj.height || 12;
            if (proj.c4State === 'flying') {
                proj.vel.y += GRAVITY;
                proj.pos.x += proj.vel.x;
                proj.pos.y += proj.vel.y;

                let landed = false;
                if (proj.pos.y >= GROUND_Y - h / 2) {
                    proj.pos.y = GROUND_Y - h / 2;
                    landed = true;
                } else if (proj.vel.y > 0) {
                    platforms.forEach(plat => {
                        if (proj.pos.x > plat.x && proj.pos.x < plat.x + plat.width &&
                            proj.pos.y >= plat.y - h / 2 && proj.pos.y <= plat.y + 20) {
                            proj.pos.y = plat.y - h / 2;
                            landed = true;
                        }
                    });
                }
                if (landed) {
                    proj.c4State = 'planted';
                    proj.c4Fuse = 0;
                    proj.vel = { x: 0, y: 0 };
                    spawnParticles(proj.pos.x, proj.pos.y, '#a08c60', 6, 3, 0.5);
                }
            } else if (proj.c4State === 'planted') {
                // 保险丝：约 5 秒后自动引爆，避免 C4 长期遗留
                proj.c4Fuse = (proj.c4Fuse || 0) + 1;
                if (proj.c4Fuse > 300) detonateC4(proj);
            }
            return;
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
                 platforms.forEach(plat => {
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
                    spawnShockwave(proj.pos.x, proj.pos.y, '#ffe28a', 2.5);
                    
                    // 冲击波伤害范围极大：全场清空（含投掷者），双方同归于尽判平局
                    entitiesRef.current.forEach(target => {
                         if (!target.isDead) {
                             target.health = 0;
                             target.isDead = true;
                             target.isLoser = true;
                             // 被吹飞
                             const dir = target.pos.x - proj.pos.x > 0 ? 1 : -1;
                             target.vel.x = dir * 60;
                             target.vel.y = -60;
                         }
                    });
                    triggerDraw();

                } else {
                    shakeRef.current = 25;
                    playExplodeSound();
                    spawnParticles(proj.pos.x, proj.pos.y, '#ff4500', 40, 15, 2);
                    spawnShockwave(proj.pos.x, proj.pos.y);
                    spawnExplosionCloud(proj.pos.x, proj.pos.y - 10); 
                    
                    // 伤害/半径发射时已烘焙到弹上（手雷默认 25/180，轰炸机空投小炸弹 20/120）
                    const bombRadius = proj.blastRadius ?? 180;
                    const bombDamage = proj.damage ?? 25;
                    entitiesRef.current.forEach(target => {
                        if (!target.isDead && canDamage(target, proj.ownerId)) {
                            const dist = Math.sqrt(Math.pow(target.pos.x - proj.pos.x, 2) + Math.pow(target.pos.y - proj.pos.y, 2));
                            if (dist < bombRadius) {
                                target.health -= bombDamage;
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
        } else if (isCustomId(proj.type)) {
            // --- 自创·投掷爆炸：仿 bomb 的重力弧线，落地/上台后按存档参数开花 ---
            proj.vel.y += GRAVITY;
            let hitGround = false;
            if (proj.pos.y >= GROUND_Y) { hitGround = true; }
            else if (proj.vel.y > 0) {
                platforms.forEach(plat => {
                    if (proj.pos.x > plat.x && proj.pos.x < plat.x + plat.width &&
                        proj.pos.y >= plat.y && proj.pos.y <= plat.y + 20) {
                        hitGround = true;
                    }
                });
            }

            if (hitGround) {
                proj.active = false;
                const radius = proj.blastRadius ?? 80;
                const dmg = proj.damage ?? 20;
                const tint = proj.tint ?? '#ff4500';
                shakeRef.current = 20;
                playExplodeSound();
                spawnParticles(proj.pos.x, proj.pos.y, tint, 30, 12, 2);
                spawnShockwave(proj.pos.x, proj.pos.y, tint, radius / 120);
                spawnExplosionCloud(proj.pos.x, proj.pos.y - 10, radius / 150);

                entitiesRef.current.forEach(target => {
                    if (!target.isDead && canDamage(target, proj.ownerId)) {
                        const dist = Math.sqrt(Math.pow(target.pos.x - proj.pos.x, 2) + Math.pow(target.pos.y - proj.pos.y, 2));
                        if (dist < radius + 30) {
                            target.health -= dmg;
                            if (target.health <= 0) { target.health = 0; target.isDead = true; target.isLoser = true; }

                            const angle = Math.atan2(target.pos.y - proj.pos.y, target.pos.x - proj.pos.x);
                            target.vel.x = Math.cos(angle) * 24;
                            target.vel.y = Math.sin(angle) * 24 - 6;
                            target.stunFrames = 25;

                            if (target.isDead) {
                                const winner = entitiesRef.current.find(e => e.id === proj.ownerId);
                                if (winner) triggerWin(winner.id);
                            }
                        }
                    }
                });
            }
        } else {
            // === 碰撞逻辑 (子弹 & 导弹) ===
            const isMissile = proj.type === 'missile';
            if (proj.pos.x < 0 || proj.pos.x > canvas.width || proj.pos.y > canvas.height + 100 || proj.pos.y < -200) proj.active = false;
            
            entitiesRef.current.forEach(target => {
                if (target.id !== proj.ownerId && !target.isDead && proj.active && canDamage(target, proj.ownerId)) {
                    const hitDist = isMissile ? 50 : 30; 
                    if (Math.abs(proj.pos.x - target.pos.x) < hitDist &&
                        proj.pos.y > target.pos.y - 75 && proj.pos.y < target.pos.y + 10) {
                            
                        proj.active = false;
                        const damage = isMissile ? (proj.damage ?? 35) : 15; // 导弹伤害来自武器库
                        target.health -= damage; 
                        target.stunFrames = isMissile ? 40 : 10;
                        shakeRef.current = isMissile ? 25 : 5;
                        
                        isMissile ? playExplodeSound() : playHitSound();
                        
                        // 导弹击中特效
                        if (isMissile) {
                             spawnParticles(target.pos.x, target.pos.y - 35, '#ff5500', 40, 10);
                             spawnParticles(target.pos.x, target.pos.y - 35, '#555', 20, 5);
                             spawnShockwave(target.pos.x, target.pos.y - 35, '#ffe28a', 0.8);
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
    // 原地压缩失效的投射物：以前每帧 filter 一次，即使一个都没失效也要新建数组 + 新建闭包，
    // 每秒 60 次白扔给 GC。读写双指针原地压缩，一个都没失效时零分配。
    const projs = projectilesRef.current;
    let keep = 0;
    for (let i = 0; i < projs.length; i++) {
      if (projs[i].active) projs[keep++] = projs[i];
    }
    projs.length = keep;

    // === 3. 移动平台先走位 ===
    // 必须在实体之前更新，这样本帧位移 dx/dy 才能用于把站在上面的角色一起带走
    const layout = getLayout(map, canvas.width);
    layout.movers.forEach(mv => {
      const prevX = mv.x;
      const prevY = mv.y;
      const t = Math.sin(frameRef.current * (mv.speed ?? 0.02) + (mv.phase ?? 0));
      if (mv.axis === 'y') {
        mv.y = (mv.baseY ?? mv.y) + t * (mv.range ?? 60);
      } else {
        mv.x = (mv.baseX ?? mv.x) + t * (mv.range ?? 80);
      }
      mv.dx = mv.x - prevX;
      mv.dy = mv.y - prevY;
    });

    // === 4. 实体更新 ===
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

          const t = victoryFrameRef.current;
          // 双人闯关：两位赢家分列中线两侧，避免重叠成一团
          const winners = entitiesRef.current.filter(e => e.isWinner);
          const winnerIdx = winners.findIndex(w => w.id === entity.id);
          const targetX = canvas.width / 2 + (winners.length > 1 ? (winnerIdx === 0 ? -80 : 80) : 0);
          const targetY = canvas.height / 3;

          // 缓动滑向中央（开始慢、越靠近越快，快速就位）
          const ease = Math.min(0.04 + t * 0.003, 0.3);
          entity.pos.x += (targetX - entity.pos.x) * ease;
          entity.pos.y += (targetY - entity.pos.y) * ease;

          // 就位后的三连庆祝小跳，幅度逐渐衰减
          const hop = t > 40
            ? Math.max(0, Math.sin((t - 40) / 9)) * 16 * Math.exp(-(t - 40) / 150)
            : 0;
          entity.pos.y -= hop;

          entity.vel.x = 0; entity.vel.y = 0;

          // 金色星光粒子从胜者身上升起
          if (t % 2 === 0) {
              particlesRef.current.push({
                  pos: { x: entity.pos.x + (Math.random() - 0.5) * 60, y: entity.pos.y - 40 },
                  vel: { x: (Math.random() - 0.5) * 2, y: -1 - Math.random() * 2 },
                  life: 40 + Math.random() * 20, maxLife: 60,
                  color: Math.random() > 0.5 ? '#FFD700' : '#fff7cc',
                  size: 2 + Math.random() * 3, gravity: -0.02,
              });
          }
          if (t % 4 === 0) spawnConfetti(canvas.width);
          return;
      }

      // 拾取喷气背包：背在背上的道具，不占武器槽，手里有武器也能捡（已有背包就不能再捡）
      // 双人闯关的怪物不能用道具：直接跳过拾取判定
      if (!entity.isDead && entity.jetpackFuel <= 0 && entity.team !== 'enemy') {
          const jetIndex = fallingItemsRef.current.findIndex(item => {
              if (item.type !== 'jetpack') return false;
              const dx = Math.abs(entity.pos.x - (item.pos.x + item.width / 2));
              const dy = Math.abs((entity.pos.y - 35) - (item.pos.y + item.height / 2));
              return dx < 50 && dy < 60;
          });
          if (jetIndex !== -1) {
              entity.jetpackFuel = JETPACK_MAX_FUEL;
              fallingItemsRef.current.splice(jetIndex, 1);
              playJumpSound();
              spawnParticles(entity.pos.x, entity.pos.y - 30, '#7dd3fc', 8, 6);
          }
      }

      // 拾取武器（怪物不捡武器：掉落物只留给玩家）
      if (!entity.isDead && entity.team !== 'enemy') {
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
                    // 内置武器：弹药量统一从武器库数值层读（默认值见 weaponService.BUILTIN_STATS，可在武器库「调一调」）
                    case 'bomb':
                    case 'sword':
                    case 'atom_bomb':
                    case 'missile':
                    case 'dragon':
                    case 'bomber':
                    case 'pokemon':
                    case 'laser':
                    case 'zeperion':
                    case 'c4':
                    case 'piercer':
                    case 'aug':
                    case 'gas':
                    case 'gatling':
                        entity.ammo = getBuiltinStats(item.type).ammo;
                        break;
                    default: {
                        // 自创武器：弹药量来自武器库存档
                        const cw = getCustom(item.type);
                        if (cw) entity.ammo = cw.ammo;
                    }
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
          entity.vel.x *= 0.9; // 倒地：滑一小段就停住
      }

      entity.pos.x += entity.vel.x;
      entity.pos.y += entity.vel.y;

      // 碰撞检测
      // 出局的一方也要落回地面：以前这里用 isLoser 把地面夹紧整个跳过了，
      // 尸体会被重力一直积分下去（实测 y 能飘到 20000+、x 漂到屏幕外），
      // 在 4 秒胜利动画里就是一团"乱飞的异物"。
      entity.isGrounded = false;
      if (entity.pos.y >= GROUND_Y) {
          entity.pos.y = GROUND_Y;
          entity.vel.y = 0;
          entity.vel.x *= 0.5;
          entity.isGrounded = true;
      }
      if (entity.vel.y >= 0 && !entity.isDead) {
          platforms.forEach(plat => {
              if (entity.pos.x > plat.x - 10 && entity.pos.x < plat.x + plat.width + 10) {
                  if (prevY <= plat.y && entity.pos.y >= plat.y) {
                      entity.pos.y = plat.y;
                      entity.vel.y = 0;
                      entity.isGrounded = true;
                  }
              }
          });

          // 移动平台：可站立，并且横向/纵向移动时把站在上面的角色一起带走
          layout.movers.forEach(mv => {
              if (entity.pos.x <= mv.x - 10 || entity.pos.x >= mv.x + mv.width + 10) return;
              const fallingOnto = prevY <= mv.y + 6 && entity.pos.y >= mv.y;
              const riding = Math.abs(entity.pos.y - mv.y) <= 12 && entity.vel.y >= 0;
              if (fallingOnto || riding) {
                  entity.pos.y = mv.y;
                  entity.vel.y = 0;
                  entity.isGrounded = true;
                  entity.pos.x += mv.dx ?? 0; // 横向载人
              }
          });
      }

      // 实心阻挡：顶面已经算进 platforms（可以跳上去），这里补侧面推出，避免直接穿过去
      if (!entity.isDead) {
          for (const b of layout.blocks) {
              // 脚在箱子顶面以上说明是站在箱子上，不做水平推出
              if (entity.pos.y <= b.y + 4) continue;
              if (entity.pos.y - entity.height >= b.y + b.height) continue;
              if (entity.pos.x + BODY_HALF_W <= b.x || entity.pos.x - BODY_HALF_W >= b.x + b.width) continue;
              entity.pos.x = entity.pos.x < b.x + b.width / 2
                  ? b.x - BODY_HALF_W
                  : b.x + b.width + BODY_HALF_W;
              entity.vel.x = 0;
          }
      }

      // 左右墙对出局的一方同样生效，否则尸体能一路漂出屏幕外
      if (entity.pos.x < WALL_MARGIN) { entity.pos.x = WALL_MARGIN; entity.vel.x *= -0.5; }
      if (entity.pos.x > canvas.width - WALL_MARGIN) { entity.pos.x = canvas.width - WALL_MARGIN; entity.vel.x *= -0.5; }

      // 陷阱无敌帧即使处于硬直中也要继续倒数，否则会被连续判定
      if (entity.spikeCooldown > 0) entity.spikeCooldown--;

      if (gameState === GameState.VICTORY_ANIMATION || entity.isDead || entity.stunFrames > 0) return;

      // 伤害陷阱：踩到掉血 + 被弹开，靠 spikeCooldown 保证不会被瞬间抽干
      if (entity.spikeCooldown === 0) {
          for (const sp of layout.spikes) {
              const onX = entity.pos.x + BODY_HALF_W > sp.x && entity.pos.x - BODY_HALF_W < sp.x + sp.width;
              const onY = entity.pos.y >= sp.y - 8 && entity.pos.y <= sp.y + sp.height + 24;
              if (!onX || !onY) continue;

              entity.health = Math.max(0, entity.health - SPIKE_DAMAGE);
              entity.spikeCooldown = SPIKE_COOLDOWN;
              entity.stunFrames = 14;
              entity.vel.y = -13;
              entity.vel.x = (entity.pos.x < sp.x + sp.width / 2 ? -1 : 1) * 11;
              spawnParticles(entity.pos.x, sp.y + 6, '#ef4444', 14, 7);
              playHitSound();
              shakeRef.current = Math.max(shakeRef.current, 10);

              if (entity.health <= 0) {
                  entity.isDead = true;
                  entity.isLoser = true;
                  const other = entitiesRef.current.find(e => e.id !== entity.id);
                  if (other) triggerWin(other.id);
              }
              break;
          }
      }

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
      
      // Input P2
      if (entity.playerIndex === 1) {
          if (gameMode !== 'PVE') {
            // 双人对战 / 双人闯关：P2 由 2P 键盘操控（方向键 + 回车）
            if (keysRef.current.has('ArrowLeft')) moveLeft = true;
            if (keysRef.current.has('ArrowRight')) moveRight = true;
            if (keysRef.current.has('ArrowUp')) jump = true;
            if (keysRef.current.has('ArrowDown')) crouch = true;
            if (keysRef.current.has('Enter')) attack = true;
          } else {
            // 单人闯关：P2 由 AI 操控（决策逻辑见组件级 aiDecide）
            ({ moveLeft, moveRight, jump, crouch, attack } = aiDecide(entity, layout));
          }
      }

      // COOP 敌人：一律 AI 操控（playerIndex ≥ 2 不读键盘，复用同一套 AI）
      if (entity.team === 'enemy') {
        ({ moveLeft, moveRight, jump, crouch, attack } = aiDecide(entity, layout));
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

      // === 喷气背包：空中继续按住跳跃键就喷气（地面按住不喷，避免和起跳互相干扰）===
      entity.jetThrusting = false;
      if (!entity.isGrounded && !entity.isDead && jump && entity.jetpackFuel > 0 && !entity.isCrouching) {
          entity.vel.y -= JETPACK_THRUST;
          if (entity.vel.y < JETPACK_MAX_RISE) entity.vel.y = JETPACK_MAX_RISE;
          // 无限燃料：不再扣减 jetpackFuel，燃料条常驻满格
          entity.jetThrusting = true;
          // 火花：从背包喷口（背侧、腰上方）往下喷
          if (frameRef.current % 2 === 0) {
              const backX = entity.pos.x + (entity.facingRight ? -10 : 10);
              spawnParticles(backX, entity.pos.y - 46, Math.random() < 0.5 ? '#fbbf24' : '#fb923c', 2, 6, 0.6, 2.5);
          }
      }
      // 音效边沿检测：开始喷才开声，松手/燃料耗尽才关声
      if (entity.jetThrusting && !jetActiveRef.current.has(entity.id)) {
          jetActiveRef.current.add(entity.id);
          startJetSound();
      } else if (!entity.jetThrusting && jetActiveRef.current.has(entity.id)) {
          jetActiveRef.current.delete(entity.id);
          stopJetSound();
      }

      // === 攻击处理 ===
      if (attack && entity.attackCooldown === 0) {
          entity.attackCooldown = ATTACK_COOLDOWN;
          entity.isAttacking = true;
          entity.attackFrame = 5;

          // 自创武器（武器库）：查一次存档，下面按模板分发
          const customW = getCustom(entity.heldWeapon);

          if (entity.heldWeapon === 'bomb') {
              // 发射时把武器库数值烘焙到弹上（照抄自创武器先例，删改存档不影响飞行中的弹）
              const st = getBuiltinStats('bomb');
              entity.vel.x += entity.facingRight ? -2 : 2;
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: 'bomb',
                  pos: { x: entity.pos.x, y: entity.pos.y - 60 },
                  vel: { x: entity.facingRight ? 12 : -12, y: -12 },
                  ownerId: entity.id,
                  width: 20, height: 20, active: true,
                  damage: st.damage,
                  blastRadius: st.blastRadius
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
              const missileSt = getBuiltinStats('missile');
              entity.vel.x += entity.facingRight ? -10 : 10;
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: 'missile',
                  pos: { x: entity.pos.x + (entity.facingRight ? 50 : -50), y: entity.pos.y - 50 },
                  vel: { x: entity.facingRight ? 10 : -10, y: -5 },
                  ownerId: entity.id,
                  width: 20, height: 8, active: true,
                  damage: missileSt.damage
              });
              entity.ammo--;
          } else if (entity.heldWeapon === 'dragon') {
              playDragonRoar();
              const dragonSt = getBuiltinStats('dragon');
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
                  dragonSegments: undefined,
                  damage: dragonSt.damage
              });
              entity.ammo--;
          } else if (entity.heldWeapon === 'bomber') {
              // 呼叫轰炸机：小炸弹数值挂在轰炸机身上，空投时继承（小而密三连炸，与整颗手雷区分）
              const startX = entity.facingRight ? -100 : canvas.width + 100;
              playShootSound(); // 使用枪声模拟无线电
              const bomberSt = getBuiltinStats('bomber');
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: 'bomber',
                  pos: { x: startX, y: 100 }, // 高空飞行
                  vel: { x: 0, y: 0 },
                  ownerId: entity.id,
                  width: 60, height: 20, active: true,
                  bomberState: 'fly_in',
                  bombDropCount: 0,
                  damage: bomberSt.damage,
                  blastRadius: bomberSt.blastRadius
              });
              entity.ammo--;
          } else if (entity.heldWeapon === 'pokemon') {
              playJumpSound();
              // 召唤皮卡丘
              const pokemonSt = getBuiltinStats('pokemon');
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: 'pokemon',
                  pos: { x: entity.pos.x + (entity.facingRight ? 20 : -20), y: entity.pos.y - 40 },
                  vel: { x: entity.facingRight ? 10 : -10, y: -5 },
                  ownerId: entity.id,
                  width: 20, height: 20, active: true,
                  pokemonState: 'seeking',
                  attackTimer: 0,
                  damage: pokemonSt.damage
              });
              entity.ammo--;
          } else if (entity.heldWeapon === 'laser') {
              // === 激光武器逻辑：狙击定位 —— 瞬发高伤，但间隔长（不再一击必杀） ===
              playShootSound();
              const laserSt = getBuiltinStats('laser');
              entity.attackCooldown = laserSt.cooldown ?? ATTACK_COOLDOWN; // 默认 30 帧，慢射
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
                      
                      if (isHit && Math.abs((target.pos.y - 35) - startY) < 50 && canDamage(target, entity.id)) {
                          // 数值结算：伤害来自武器库（原版是一击必杀，现改为可调的高伤狙击）
                          target.health -= laserSt.damage;
                          target.vel.x = entity.facingRight ? 50 : -50;
                          target.vel.y = -30;
                          target.stunFrames = 30;

                          playExplodeSound();
                          spawnParticles(target.pos.x, target.pos.y - 35, '#ff0000', 30, 15);

                          if (target.health <= 0) {
                              target.health = 0;
                              target.isDead = true;
                              target.isLoser = true;
                              triggerWin(entity.id);
                          }
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
              const zeperionSt = getBuiltinStats('zeperion');
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
                      
                      if (isHit && Math.abs((target.pos.y - 35) - startY) < 60 && canDamage(target, entity.id)) {
                          target.health -= zeperionSt.damage; // 高伤害，数值来自武器库
                          
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
          } else if (entity.heldWeapon === 'c4') {
              // == C4 炸弹：埋设 / 遥控引爆 ==
              const plantedC4 = projectilesRef.current.find(p =>
                  p.type === 'c4' && p.ownerId === entity.id && p.c4State === 'planted'
              );
              if (plantedC4) {
                  // 引爆已埋设的 C4，消耗 1 发弹药
                  detonateC4(plantedC4);
                  entity.ammo--;
              } else {
                  // 埋设：向面前抛出一块 C4（埋设同样消耗 1 发弹药，避免无限埋雷）
                  playShootSound();
                  const c4St = getBuiltinStats('c4');
                  projectilesRef.current.push({
                      id: Math.random().toString(36).slice(2) + Date.now(),
                      type: 'c4',
                      pos: { x: entity.pos.x + (entity.facingRight ? 32 : -32), y: entity.pos.y - 45 },
                      vel: { x: entity.facingRight ? 6 : -6, y: -7 },
                      ownerId: entity.id,
                      width: 20, height: 12, active: true,
                      c4State: 'flying',
                      damage: c4St.damage,
                      blastRadius: c4St.blastRadius
                  });
                  entity.ammo--;
              }
          } else if (entity.heldWeapon === 'piercer') {
              // == 穿地弹：抛出后钻入地下，潜行追踪并破土引爆 ==
              playShootSound();
              const piercerSt = getBuiltinStats('piercer');
              entity.vel.x += entity.facingRight ? -6 : 6;
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: 'piercer',
                  pos: { x: entity.pos.x + (entity.facingRight ? 30 : -30), y: entity.pos.y - 45 },
                  vel: { x: entity.facingRight ? 14 : -14, y: -10 },
                  ownerId: entity.id,
                  width: 20, height: 8, active: true,
                  piercerState: 'flying',
                  piercerDir: entity.facingRight ? 1 : -1,
                  piercerTimer: 0,
                  damage: piercerSt.damage,
                  blastRadius: piercerSt.blastRadius
              });
              entity.ammo--;
          } else if (entity.heldWeapon === 'aug') {
              // == AUG 突击步枪：高速连发 ==
              playShootSound();
              const augSt = getBuiltinStats('aug');
              entity.attackCooldown = augSt.cooldown ?? 8; // 高射速
              entity.vel.x += entity.facingRight ? -3 : 3; // 后坐力
              const mx = entity.pos.x + (entity.facingRight ? 30 : -30);
              const my = entity.pos.y - 42;
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: 'aug',
                  pos: { x: mx, y: my },
                  vel: { x: augSt.bulletSpeed ? (entity.facingRight ? augSt.bulletSpeed : -augSt.bulletSpeed) : (entity.facingRight ? 22 : -22), y: 0 },
                  ownerId: entity.id,
                  width: 4, height: 3, active: true,
                  damage: augSt.damage,
                  trail: []
              });
              spawnParticles(mx, my, '#ffe28a', 3, 3, 0.3, 2); // 枪口火光
              entity.ammo--;
          } else if (entity.heldWeapon === 'gas') {
              // == 毒气弹：投掷，落地后形成持续 5 秒的毒气区域 ==
              playShootSound();
              const gasSt = getBuiltinStats('gas');
              entity.vel.x += entity.facingRight ? -4 : 4;
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: 'gas',
                  pos: { x: entity.pos.x + (entity.facingRight ? 30 : -30), y: entity.pos.y - 45 },
                  vel: { x: entity.facingRight ? 11 : -11, y: -9 },
                  ownerId: entity.id,
                  width: 16, height: 16, active: true,
                  gasState: 'flying',
                  gasTimer: 0,
                  gasRadius: 0,
                  damage: gasSt.damage,
                  blastRadius: gasSt.blastRadius
              });
              entity.ammo--;
          } else if (entity.heldWeapon === 'gatling') {
              // == 加特林：射速是 AUG 的两倍，弹道带轻微散射，单发伤害低 ==
              playShootSound();
              const gatlingSt = getBuiltinStats('gatling');
              entity.attackCooldown = gatlingSt.cooldown ?? 4;
              entity.vel.x += entity.facingRight ? -2 : 2; // 后坐力比 AUG 小（单手压得住）
              const mx = entity.pos.x + (entity.facingRight ? 34 : -34);
              const my = entity.pos.y - 42;
              const gatlingSpeed = gatlingSt.bulletSpeed ?? 20;
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: 'gatling',
                  pos: { x: mx, y: my },
                  vel: { x: entity.facingRight ? gatlingSpeed : -gatlingSpeed, y: (Math.random() - 0.5) * 2.4 }, // 散射
                  ownerId: entity.id,
                  width: 4, height: 3, active: true,
                  damage: gatlingSt.damage,
                  trail: []
              });
              spawnParticles(mx, my, '#ffd23a', 3, 3, 0.3, 2); // 枪口火光
              entity.ammo--;
          } else if (customW && customW.template === 'gun') {
              // == 自创·子弹连发：仿 AUG 直弹，弹速/伤害/颜色来自武器库参数 ==
              playShootSound();
              entity.attackCooldown = 8;
              entity.vel.x += entity.facingRight ? -3 : 3;
              const mx = entity.pos.x + (entity.facingRight ? 30 : -30);
              const my = entity.pos.y - 42;
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: customW.id,
                  pos: { x: mx, y: my },
                  vel: { x: entity.facingRight ? customW.bulletSpeed : -customW.bulletSpeed, y: 0 },
                  ownerId: entity.id,
                  width: 6, height: 5, active: true,
                  customId: customW.id,
                  damage: customW.damage,
                  tint: customW.color,
                  trail: []
              });
              spawnParticles(mx, my, customW.color, 3, 3, 0.3, 2);
              entity.ammo--;
          } else if (customW && customW.template === 'throw') {
              // == 自创·投掷爆炸：仿 bomb 弧线，伤害/半径/颜色来自武器库参数 ==
              entity.vel.x += entity.facingRight ? -2 : 2;
              projectilesRef.current.push({
                  id: Math.random().toString(),
                  type: customW.id,
                  pos: { x: entity.pos.x, y: entity.pos.y - 60 },
                  vel: { x: entity.facingRight ? 12 : -12, y: -12 },
                  ownerId: entity.id,
                  width: 22, height: 22, active: true,
                  customId: customW.id,
                  damage: customW.damage,
                  blastRadius: customW.blastRadius,
                  tint: customW.color
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
                  const swordSt = getBuiltinStats('sword');
                  range = swordSt.range ?? 140;
                  dmg = swordSt.damage;
                  knockbackX = swordSt.knockback ?? 12;
                  selfPush = 12;
                  entity.attackCooldown = swordSt.cooldown ?? 20;
              }
              // 自创·近战挥砍：复用整套近战判定，只换数值
              if (customW && customW.template === 'melee') {
                  range = customW.range;
                  dmg = customW.damage;
                  knockbackX = customW.knockback;
                  knockbackY = -Math.max(2, customW.knockback * 0.5);
                  selfPush = 12;
                  entity.attackCooldown = 20;
              }

              entity.vel.x = entity.facingRight ? selfPush : -selfPush;

              const hitY = entity.isCrouching ? entity.pos.y - 20 : entity.pos.y - 45;
              
              let hitSomething = false;

              entitiesRef.current.forEach(target => {
                  if (target !== entity && !target.isDead && canDamage(target, entity.id)) {
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

    /*
      === 4.5 角色互推 ===
      以前两个角色之间没有碰撞体积，相向而行会直接穿过去、然后各自顶死在左右墙上朝外挥拳，
      实测一局能拖到 100 秒还分不出胜负（近战要求"面朝对方"，背对着永远打不中）。
      这里在双方都走完之后做一次分离：把对方当成一堵墙，谁主动撞上去谁被挡回来。
    */
    if (gameState === GameState.PLAYING) {
        const duo = entitiesRef.current;
        if (duo.length === 2 && !duo[0].isDead && !duo[1].isDead) {
            const [a, b] = duo;
            const lo = WALL_MARGIN;
            const hi = canvas.width - WALL_MARGIN;
            const minGap = BODY_HALF_W * 2;

            // 先各自夹进墙内，下面算"还能退多少"时才有准数
            a.pos.x = Math.max(lo, Math.min(hi, a.pos.x));
            b.pos.x = Math.max(lo, Math.min(hi, b.pos.x));

            const dx = b.pos.x - a.pos.x;
            // 竖直方向差得太多说明一个在平台上 / 跳到另一个头上了，这时不该横向互推，否则会被卡住
            if (Math.abs(dx) < minGap && Math.abs(a.pos.y - b.pos.y) < 60) {
                const dir = dx >= 0 ? 1 : -1;    // a 指向 b 的方向
                const overlap = minGap - Math.abs(dx);
                const aInto = a.vel.x * dir > 0; // a 正朝 b 撞过去
                const bInto = b.vel.x * dir < 0; // b 正朝 a 撞过去

                // 默认各让一半；只有一方在撞就由撞的人全让（站着不动的一方不该被推走）
                const aWant = aInto === bInto ? overlap / 2 : (aInto ? overlap : 0);
                const bWant = overlap - aWant;

                // 让不动的那部分转嫁给对方：否则贴着墙的一方会被推进墙里，
                // 下一帧墙又把他弹回来，两个人就在墙角抖个不停
                const aRoom = dir > 0 ? a.pos.x - lo : hi - a.pos.x;
                const bRoom = dir > 0 ? hi - b.pos.x : b.pos.x - lo;
                let aGive = Math.min(aWant, aRoom);
                let bGive = Math.min(bWant, bRoom);
                const short = overlap - aGive - bGive;
                if (short > 0) aGive += Math.min(short, aRoom - aGive);
                if (short > 0) bGive += Math.min(short, bRoom - bGive);

                a.pos.x -= dir * aGive;
                b.pos.x += dir * bGive;
            }
        }
    }

    // === 4.7 COOP 波次推进：清光怪物 → 短暂休息 → 刷下一关；最后一关清空 = 通关 ===
    if (gameMode === 'COOP' && gameState === GameState.PLAYING && !statsRef.current.winner) {
      const enemies = entitiesRef.current.filter(e => e.team === 'enemy');
      const players = entitiesRef.current.filter(e => e.team === 'player');

      if (players.every(p => p.isDead)) {
        // 全军覆没：闯关失败（resolveOutcome 通常已判过，这里兜底）
        statsRef.current.winner = 'ENEMIES';
        winTimeoutRef.current = window.setTimeout(() => setGameState(GameState.GAME_OVER), 2200);
      } else if (waveStateRef.current === 'fighting' && enemies.length > 0 && enemies.every(e => e.isDead)) {
        if (waveRef.current >= COOP_TOTAL_WAVES) {
          // 通关！所有活着的玩家一起上台庆祝
          entitiesRef.current.forEach(e => { if (e.team === 'player' && !e.isDead) e.isWinner = true; });
          statsRef.current.winner = 'PLAYERS';
          victoryFrameRef.current = 0;
          setGameState(GameState.VICTORY_ANIMATION);
          winTimeoutRef.current = window.setTimeout(() => setGameState(GameState.GAME_OVER), 4000);
        } else {
          waveStateRef.current = 'intermission';
          waveTimerRef.current = COOP_WAVE_INTERMISSION;
          coopBannerRef.current = { text: `第 ${waveRef.current} 关 完成！`, life: COOP_WAVE_INTERMISSION };
        }
      } else if (waveStateRef.current === 'intermission') {
        waveTimerRef.current--;
        if (waveTimerRef.current <= 0) {
          waveRef.current++;
          spawnCoopWave(waveRef.current);
          waveStateRef.current = 'fighting';
          statsRef.current.wave = waveRef.current;
          coopBannerRef.current = { text: `第 ${waveRef.current} 关`, life: 150 };
        }
      }
    }

    // === 5. 粒子更新（移动 / 消亡 / 缩放 / 淡出） ===
    for (let i = particlesRef.current.length - 1; i >= 0; i--) {
      const p = particlesRef.current[i];
      p.life--;
      if (p.life <= 0) {
        particlesRef.current.splice(i, 1);
        continue;
      }
      if (p.gravity !== undefined) p.vel.y += p.gravity;
      p.pos.x += p.vel.x;
      p.pos.y += p.vel.y;
      if (p.growth) p.size += p.growth;
      if (p.lineWidth !== undefined && p.lineWidthDecay) p.lineWidth = Math.max(0.5, p.lineWidth - p.lineWidthDecay);
      if (p.alphaDecay !== undefined) {
        const base = p.currentAlpha !== undefined ? p.currentAlpha : (p.life / p.maxLife);
        p.currentAlpha = Math.max(0, base - p.alphaDecay);
      }
    }
    if (particlesRef.current.length > MAX_PARTICLES) {
      particlesRef.current.splice(0, particlesRef.current.length - MAX_PARTICLES);
    }
  };

  const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const platforms = getPlatforms(map, canvas.width);

      const shake = shakeRef.current;
      const shakeX = shake > 0 ? (Math.random() - 0.5) * shake : 0;
      const shakeY = shake > 0 ? (Math.random() - 0.5) * shake : 0;

      ctx.save();
      
      // 背景（不随屏幕抖动，保持稳定）
      if (map === 'forest') {
          drawForestBackground(ctx, canvas.width, canvas.height, frameRef.current);
      } else if (map === 'desert') {
          drawDesertBackground(ctx, canvas.width, canvas.height, frameRef.current);
      } else if (map === 'ocean') {
          drawOceanBackground(ctx, canvas.width, canvas.height, frameRef.current);
      } else if (map === 'volcano') {
          drawVolcanoBackground(ctx, canvas.width, canvas.height, frameRef.current);
      } else if (map === 'night') {
          drawNightBackground(ctx, canvas.width, canvas.height, frameRef.current);
      } else if (map === 'snow') {
          drawSnowBackground(ctx, canvas.width, canvas.height, frameRef.current);
      } else if (map === 'prairie') {
          drawPrairieBackground(ctx, canvas.width, canvas.height, frameRef.current);
      } else if (map === 'glacier') {
          drawGlacierBackground(ctx, canvas.width, canvas.height, frameRef.current);
      } else if (map === 'space') {
          drawSpaceBackground(ctx, canvas.width, canvas.height, frameRef.current);
      } else if (map === 'village') {
          drawVillageBackground(ctx, canvas.width, canvas.height, frameRef.current);
      } else {
          drawNeonBackground(ctx, canvas.width, canvas.height, frameRef.current);
      }

      ctx.translate(shakeX, shakeY);

      // 静态平台层：材质不变，直接贴缓存好的位图（见 paintPlatforms 的说明）
      {
          const layer = getTerrainLayer(map, canvas, platforms);
          if (layer.canvas) ctx.drawImage(layer.canvas, layer.x, layer.y);
      }

      // Draw Ground
      if (map === 'forest') {
          // 草地
          ctx.fillStyle = '#4c9a3a';
          ctx.fillRect(0, GROUND_Y - 4, canvas.width, 10);
          ctx.fillStyle = '#3f7d2f';
          ctx.fillRect(0, GROUND_Y + 6, canvas.width, 16);
          // 草丛
          ctx.fillStyle = '#5cb943';
          for (let x = 0; x < canvas.width; x += 26) {
              const gx = x + ((x / 26) % 2) * 8;
              const gh = 5 + ((x * 7) % 6);
              ctx.fillRect(gx, GROUND_Y - gh, 3, gh);
          }
          // 土壤
          ctx.fillStyle = '#6b4a2b';
          ctx.fillRect(0, GROUND_Y + 22, canvas.width, canvas.height - GROUND_Y - 22);
          ctx.fillStyle = '#5a3d20';
          ctx.fillRect(0, GROUND_Y + 70, canvas.width, canvas.height - GROUND_Y - 70);
      } else if (map === 'desert') {
          // 沙地
          ctx.fillStyle = '#e8b96e';
          ctx.fillRect(0, GROUND_Y - 2, canvas.width, 8);
          ctx.fillStyle = '#dcae62';
          ctx.fillRect(0, GROUND_Y + 6, canvas.width, 18);
          ctx.fillStyle = '#c7954d';
          ctx.fillRect(0, GROUND_Y + 24, canvas.width, canvas.height - GROUND_Y - 24);
          // 沙面波纹
          ctx.strokeStyle = 'rgba(120, 84, 40, 0.15)';
          ctx.lineWidth = 2;
          for (let x = 0; x < canvas.width; x += 60) {
              ctx.beginPath();
              ctx.moveTo(x, GROUND_Y + 10);
              ctx.quadraticCurveTo(x + 30, GROUND_Y + 6, x + 60, GROUND_Y + 10);
              ctx.stroke();
          }
      } else if (map === 'ocean') {
          // 海底沙地
          ctx.fillStyle = '#e8d8b0';
          ctx.fillRect(0, GROUND_Y - 2, canvas.width, 10);
          ctx.fillStyle = '#d9c596';
          ctx.fillRect(0, GROUND_Y + 8, canvas.width, 20);
          ctx.fillStyle = '#c0a878';
          ctx.fillRect(0, GROUND_Y + 28, canvas.width, canvas.height - GROUND_Y - 28);
          // 摇摆的海草
          ctx.lineCap = 'round';
          for (let i = 0; i < 7; i++) {
              const bx = 90 + i * (canvas.width / 7.5) + 30;
              const sway = Math.sin(frameRef.current * 0.02 + i) * 12;
              ctx.strokeStyle = 'rgba(60, 150, 90, 0.6)';
              ctx.lineWidth = 5;
              ctx.beginPath();
              ctx.moveTo(bx, GROUND_Y + 4);
              ctx.quadraticCurveTo(bx + sway, GROUND_Y - 34, bx + sway * 1.4, GROUND_Y - 70);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(bx + 12, GROUND_Y + 4);
              ctx.quadraticCurveTo(bx + 12 + sway, GROUND_Y - 20, bx + 12 + sway * 1.2, GROUND_Y - 45);
              ctx.stroke();
          }
      } else if (map === 'volcano') {
          // 火山岩地面
          ctx.fillStyle = '#2e1f1f';
          ctx.fillRect(0, GROUND_Y - 2, canvas.width, 6);
          ctx.fillStyle = '#392626';
          ctx.fillRect(0, GROUND_Y + 4, canvas.width, 24);
          ctx.fillStyle = '#241818';
          ctx.fillRect(0, GROUND_Y + 28, canvas.width, canvas.height - GROUND_Y - 28);
          // 顶部岩浆裂缝辉光
          ctx.fillStyle = 'rgba(255, 120, 40, 0.9)';
          ctx.fillRect(0, GROUND_Y - 3, canvas.width, 3);
          ctx.strokeStyle = 'rgba(255, 90, 30, 0.55)';
          ctx.lineWidth = 2;
          for (let x = 30; x < canvas.width; x += 110) {
              const wob = (x * 7) % 30;
              ctx.beginPath();
              ctx.moveTo(x, GROUND_Y - 3);
              ctx.lineTo(x + wob * 0.4, GROUND_Y + 8);
              ctx.lineTo(x - wob * 0.2, GROUND_Y + 22);
              ctx.stroke();
          }
      } else if (map === 'night') {
          // 夜色草地：月光照出的冷绿，比白天森林暗一档
          ctx.fillStyle = '#1e3b2a';
          ctx.fillRect(0, GROUND_Y - 4, canvas.width, 10);
          ctx.fillStyle = '#16301f';
          ctx.fillRect(0, GROUND_Y + 6, canvas.width, 16);
          // 草丛（月光色描一下顶）
          ctx.fillStyle = '#274d33';
          for (let x = 0; x < canvas.width; x += 26) {
              const gx = x + ((x / 26) % 2) * 8;
              const gh = 5 + ((x * 7) % 6);
              ctx.fillRect(gx, GROUND_Y - gh, 3, gh);
          }
          // 土壤
          ctx.fillStyle = '#26243c';
          ctx.fillRect(0, GROUND_Y + 22, canvas.width, canvas.height - GROUND_Y - 22);
          ctx.fillStyle = '#1d1b30';
          ctx.fillRect(0, GROUND_Y + 70, canvas.width, canvas.height - GROUND_Y - 70);
          // 地平线月光辉光
          const moonGrad = ctx.createLinearGradient(0, GROUND_Y - 36, 0, GROUND_Y + 10);
          moonGrad.addColorStop(0, 'rgba(148, 163, 255, 0)');
          moonGrad.addColorStop(1, 'rgba(148, 163, 255, 0.14)');
          ctx.fillStyle = moonGrad;
          ctx.fillRect(0, GROUND_Y - 36, canvas.width, 46);
      } else if (map === 'snow') {
          // 雪地：亮白雪面，底下压淡蓝冰土层，越往下越冷
          ctx.fillStyle = '#f7fbff';
          ctx.fillRect(0, GROUND_Y - 4, canvas.width, 12);
          ctx.fillStyle = '#e3effa';
          ctx.fillRect(0, GROUND_Y + 8, canvas.width, 18);
          ctx.fillStyle = '#c9def0';
          ctx.fillRect(0, GROUND_Y + 26, canvas.width, canvas.height - GROUND_Y - 26);
          // 雪面起伏的浅影（固定排布，帧间一致）
          ctx.fillStyle = 'rgba(163, 196, 226, 0.35)';
          for (let x = 20; x < canvas.width; x += 130) {
              const mx = x + (x * 13) % 40;
              ctx.beginPath();
              ctx.ellipse(mx, GROUND_Y + 3, 34, 5, 0, 0, Math.PI * 2);
              ctx.fill();
          }
          // 雪粒闪光：落在亮雪层上一眨一眨的小亮点
          for (let i = 0; i < 14; i++) {
              const gx = ((i * 97) % 100) / 100 * canvas.width;
              const twinkle = Math.sin(frameRef.current * 0.06 + i * 1.7);
              if (twinkle <= 0.3) continue;
              ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + twinkle * 0.5})`;
              ctx.beginPath();
              ctx.arc(gx, GROUND_Y + 1 + (i % 3) * 3, 1.6, 0, Math.PI * 2);
              ctx.fill();
          }
      } else if (map === 'prairie') {
          // 草原地面：鲜绿草面（比森林亮一档），风一吹整片草一起弯腰
          ctx.fillStyle = '#82c954';
          ctx.fillRect(0, GROUND_Y - 4, canvas.width, 12);
          ctx.fillStyle = '#69b23f';
          ctx.fillRect(0, GROUND_Y + 8, canvas.width, 16);
          // 土壤
          ctx.fillStyle = '#7a5a34';
          ctx.fillRect(0, GROUND_Y + 24, canvas.width, canvas.height - GROUND_Y - 24);
          ctx.fillStyle = '#684a28';
          ctx.fillRect(0, GROUND_Y + 72, canvas.width, canvas.height - GROUND_Y - 72);
          // 风刮的长草叶：整排朝同一边弯，摇摆节奏一致才有「草浪」感
          ctx.lineCap = 'round';
          for (let x = 8; x < canvas.width; x += 17) {
              const bend = Math.sin(frameRef.current * 0.04 + x * 0.05) * 5 + 6;
              const gh = 9 + ((x * 11) % 7);
              ctx.strokeStyle = (x % 34 === 0) ? '#9ade62' : '#74bf47';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(x, GROUND_Y - 2);
              ctx.quadraticCurveTo(x + bend * 0.5, GROUND_Y - gh * 0.6, x + bend, GROUND_Y - gh);
              ctx.stroke();
          }
          // 野花：固定位置、多种颜色
          const flowerColors = ['#ff5d8f', '#ffd23f', '#ffffff', '#c084fc'];
          for (let i = 0; i < 16; i++) {
              const fx = ((i * 83 + 29) % 100) / 100 * canvas.width;
              const fy = GROUND_Y - 2 - (i % 4) * 2;
              ctx.fillStyle = flowerColors[i % flowerColors.length];
              ctx.beginPath();
              ctx.arc(fx, fy, 2.8, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = '#ffb703';
              ctx.beginPath();
              ctx.arc(fx, fy, 1.1, 0, Math.PI * 2);
              ctx.fill();
          }
      } else if (map === 'glacier') {
          // 冰川地面：厚冰层，顶亮底深，深处隐约透出蓝绿色（冻海的颜色）
          ctx.fillStyle = '#c8e8f5';
          ctx.fillRect(0, GROUND_Y - 4, canvas.width, 12);
          ctx.fillStyle = '#8cc2da';
          ctx.fillRect(0, GROUND_Y + 8, canvas.width, 20);
          ctx.fillStyle = '#4f86a6';
          ctx.fillRect(0, GROUND_Y + 28, canvas.width, canvas.height - GROUND_Y - 28);
          ctx.fillStyle = '#2f5f7e';
          ctx.fillRect(0, GROUND_Y + 80, canvas.width, canvas.height - GROUND_Y - 80);
          // 冰裂缝：深色折线，裂缝口微微发光（冰内透光）
          for (let i = 0; i < 9; i++) {
              const cx = ((i * 149 + 40) % 100) / 100 * canvas.width;
              ctx.strokeStyle = 'rgba(20, 60, 90, 0.55)';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(cx, GROUND_Y + 2);
              ctx.lineTo(cx + 6, GROUND_Y + 18);
              ctx.lineTo(cx + 1, GROUND_Y + 34);
              ctx.lineTo(cx + 7, GROUND_Y + 52);
              ctx.stroke();
              ctx.strokeStyle = 'rgba(200, 240, 255, 0.5)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(cx - 1.5, GROUND_Y + 2);
              ctx.lineTo(cx - 1.5 + 6, GROUND_Y + 18);
              ctx.stroke();
          }
          // 冰面闪光：一眨一眨的冷白反光点
          for (let i = 0; i < 14; i++) {
              const gx = ((i * 113 + 17) % 100) / 100 * canvas.width;
              const twinkle = Math.sin(frameRef.current * 0.05 + i * 1.3);
              if (twinkle <= 0.35) continue;
              ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + twinkle * 0.45})`;
              ctx.beginPath();
              ctx.arc(gx, GROUND_Y + 1 + (i % 3) * 3, 1.7, 0, Math.PI * 2);
              ctx.fill();
          }
      } else if (map === 'space') {
          // 月面：灰色月壤 + 陨石坑（深色坑底 + 亮色坑沿）+ 漂浮小陨星
          ctx.fillStyle = '#b8b3c9';
          ctx.fillRect(0, GROUND_Y - 4, canvas.width, 12);
          ctx.fillStyle = '#8e88a6';
          ctx.fillRect(0, GROUND_Y + 8, canvas.width, 24);
          ctx.fillStyle = '#5d5778';
          ctx.fillRect(0, GROUND_Y + 32, canvas.width, canvas.height - GROUND_Y - 32);
          ctx.fillStyle = '#433e5c';
          ctx.fillRect(0, GROUND_Y + 84, canvas.width, canvas.height - GROUND_Y - 84);
          // 陨石坑：上沿亮、下半暗，一个圆就能画出凹陷感
          for (let i = 0; i < 8; i++) {
              const cx = ((i * 167 + 30) % 100) / 100 * canvas.width;
              const cy = GROUND_Y + 6 + (i % 3) * 14;
              const cr = 7 + (i % 3) * 4;
              ctx.fillStyle = 'rgba(50, 45, 75, 0.75)';
              ctx.beginPath();
              ctx.ellipse(cx, cy + 2, cr, cr * 0.55, 0, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = 'rgba(220, 215, 240, 0.7)';
              ctx.beginPath();
              ctx.ellipse(cx, cy, cr, cr * 0.55, 0, Math.PI, 0);
              ctx.fill();
          }
          // 月尘细点
          ctx.fillStyle = 'rgba(230, 225, 245, 0.6)';
          for (let i = 0; i < 30; i++) {
              const dx = ((i * 71 + 13) % 100) / 100 * canvas.width;
              const dy = GROUND_Y + 2 + (i * 23 % 30);
              ctx.beginPath();
              ctx.arc(dx, dy, 1.2, 0, Math.PI * 2);
              ctx.fill();
          }
      } else if (map === 'village') {
          // 乡间土路：草皮顶边 + 暖棕土路 + 断续车辙 + 小石子
          ctx.fillStyle = '#7cc24a';
          ctx.fillRect(0, GROUND_Y - 4, canvas.width, 10);
          ctx.fillStyle = '#93d65e';
          ctx.fillRect(0, GROUND_Y - 4, canvas.width, 4);
          // 草丛
          ctx.fillStyle = '#5cb943';
          for (let x = 0; x < canvas.width; x += 30) {
              const gx = x + ((x / 30) % 2) * 9;
              const gh = 4 + ((x * 5) % 5);
              ctx.fillRect(gx, GROUND_Y - gh, 3, gh);
          }
          // 土路
          ctx.fillStyle = '#c9a36a';
          ctx.fillRect(0, GROUND_Y + 6, canvas.width, 26);
          ctx.fillStyle = '#b08a52';
          ctx.fillRect(0, GROUND_Y + 32, canvas.width, canvas.height - GROUND_Y - 32);
          ctx.fillStyle = '#9a7544';
          ctx.fillRect(0, GROUND_Y + 84, canvas.width, canvas.height - GROUND_Y - 84);
          // 车辙：两条断续的浅色辙印
          ctx.strokeStyle = 'rgba(255, 235, 200, 0.35)';
          ctx.lineWidth = 3;
          ctx.setLineDash([26, 22]);
          ctx.beginPath();
          ctx.moveTo(0, GROUND_Y + 18);
          ctx.lineTo(canvas.width, GROUND_Y + 18);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, GROUND_Y + 26);
          ctx.lineTo(canvas.width, GROUND_Y + 26);
          ctx.stroke();
          ctx.setLineDash([]);
          // 小石子
          ctx.fillStyle = 'rgba(90, 65, 35, 0.5)';
          for (let i = 0; i < 16; i++) {
              const sx = ((i * 139 + 41) % 100) / 100 * canvas.width;
              const sy = GROUND_Y + 10 + (i * 17 % 50);
              ctx.beginPath();
              ctx.ellipse(sx, sy, 3, 2, 0, 0, Math.PI * 2);
              ctx.fill();
          }
      } else {
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);

          // 地平线辉光（科幻感的光带）
          const horizonGrad = ctx.createLinearGradient(0, GROUND_Y - 40, 0, GROUND_Y + 12);
          horizonGrad.addColorStop(0, 'rgba(99, 102, 241, 0)');
          horizonGrad.addColorStop(0.7, 'rgba(99, 102, 241, 0.22)');
          horizonGrad.addColorStop(1, 'rgba(34, 211, 238, 0.32)');
          ctx.fillStyle = horizonGrad;
          ctx.fillRect(0, GROUND_Y - 40, canvas.width, 52);

          // 地面网格（缓慢滚动，增添科技感）
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);
          ctx.clip();
          ctx.strokeStyle = 'rgba(94, 234, 212, 0.08)';
          ctx.lineWidth = 1;
          const gridOffset = (frameRef.current * 0.5) % 40;
          for (let x = -40 + gridOffset; x < canvas.width + 40; x += 40) {
            ctx.beginPath();
            ctx.moveTo(x, GROUND_Y);
            ctx.lineTo(x - 40, canvas.height);
            ctx.stroke();
          }
          for (let y = GROUND_Y; y < canvas.height + 40; y += 24) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
          }
          ctx.restore();
      }

      // Draw Obstacles（随机地形：陷阱 / 箱子 / 移动平台，画在角色身后）
      drawObstacles(ctx, map, getLayout(map, canvas.width));

      // 胜利聚光灯 + 开场扩散光环（画在角色身后）
      if (gameState === GameState.VICTORY_ANIMATION) {
          const winner = entitiesRef.current.find(e => e.isWinner);
          if (winner) {
              const t = victoryFrameRef.current;
              const cx = winner.pos.x;
              const cy = winner.pos.y - 40;

              // 聚光光斑（逐渐扩大）
              const r = 90 + t * 1.5;
              const spot = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
              spot.addColorStop(0, 'rgba(255, 235, 170, 0.30)');
              spot.addColorStop(1, 'rgba(255, 235, 170, 0)');
              ctx.fillStyle = spot;
              ctx.beginPath();
              ctx.arc(cx, cy, r, 0, Math.PI * 2);
              ctx.fill();

              // 开场扩散光环
              if (t < 30) {
                  const p = t / 30;
                  ctx.strokeStyle = `rgba(255, 215, 0, ${1 - p})`;
                  ctx.lineWidth = 8 * (1 - p) + 2;
                  ctx.beginPath();
                  ctx.arc(cx, cy, 30 + p * 140, 0, Math.PI * 2);
                  ctx.stroke();
              }
          }
      }

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
        } else if (item.type === 'c4') {
             // C4 炸药块图标
             ctx.fillStyle = '#6b5a3e'; ctx.fillRect(-10, -6, 20, 12);
             ctx.fillStyle = '#3f3625'; ctx.fillRect(-10, -6, 20, 3);
             ctx.fillStyle = '#f00'; ctx.beginPath(); ctx.arc(4, 6, 3, 0, Math.PI*2); ctx.fill();
        } else if (item.type === 'piercer') {
             // 穿地弹图标
             ctx.fillStyle = '#4b5563'; ctx.fillRect(-10, -4, 20, 8);
             ctx.fillStyle = '#dc2626'; ctx.beginPath(); ctx.arc(10, 0, 4, 0, Math.PI*2); ctx.fill();
             ctx.fillStyle = '#fbbf24'; ctx.fillRect(-14, -5, 4, 10);
        } else if (item.type === 'aug') {
             // AUG 突击步枪图标
             ctx.fillStyle = '#2f3e46'; ctx.fillRect(-12, -4, 26, 8);
             ctx.fillStyle = '#1f2a30'; ctx.fillRect(-10, -8, 8, 4);
             ctx.fillStyle = '#8a5a30'; ctx.fillRect(-6, 4, 8, 6);
             ctx.fillStyle = '#444'; ctx.fillRect(14, -3, 5, 4);
        } else if (item.type === 'gas') {
             // 毒气弹图标
             ctx.fillStyle = '#3f7d2f'; ctx.fillRect(-7, -7, 14, 14);
             ctx.fillStyle = '#2f5d22'; ctx.fillRect(-7, -7, 14, 4);
             ctx.fillStyle = '#c9ff6b'; ctx.font = '10px sans-serif'; ctx.fillText('☠', -4, 5);
        } else if (item.type === 'gatling') {
             // 加特林图标：三联枪管 + 弹箱
             ctx.fillStyle = '#3a3f44'; ctx.fillRect(-12, -6, 24, 10);
             ctx.fillStyle = '#22262a';
             ctx.fillRect(12, -5, 14, 2.5);
             ctx.fillRect(12, -1.5, 14, 2.5);
             ctx.fillRect(12, 2, 14, 2.5);
             ctx.fillStyle = '#8a5a30'; ctx.fillRect(-14, -4, 4, 8);   // 枪托
             ctx.fillStyle = '#fbbf24'; ctx.fillRect(-12, 4, 10, 6);  // 弹箱
        } else if (item.type === 'jetpack') {
             // 喷气背包图标：小罐体 + 绑带 + 一小束火焰（火焰一直轻轻跳，像在招手）
             ctx.fillStyle = '#94a3b8';
             roundRectPath(ctx, -5, -9, 10, 15, 3);
             ctx.fill();
             ctx.fillStyle = 'rgba(255,255,255,0.5)';
             ctx.fillRect(-3.5, -7.5, 2, 11);
             ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2;
             ctx.beginPath(); ctx.moveTo(-2, -7); ctx.lineTo(6, -2); ctx.stroke();
             ctx.fillStyle = '#475569';
             roundRectPath(ctx, -4, 5, 8, 3, 1);
             ctx.fill();
             const flick = 5 + Math.random() * 4;
             ctx.fillStyle = '#f97316';
             ctx.beginPath();
             ctx.moveTo(-4, 8);
             ctx.quadraticCurveTo(-2, 8 + flick * 0.6, 0, 8 + flick);
             ctx.quadraticCurveTo(2, 8 + flick * 0.6, 4, 8);
             ctx.fill();
             ctx.fillStyle = '#fde047';
             ctx.beginPath();
             ctx.moveTo(-2, 8);
             ctx.quadraticCurveTo(0, 8 + flick * 0.5, 2, 8);
             ctx.fill();
        } else {
             // 自创武器：天上掉下来就是它的 emoji
             const cw = getCustom(item.type);
             if (cw) { ctx.font = '22px serif'; ctx.fillText(cw.emoji, -11, 8); }
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

           if (proj.type === 'gas') {
               if (proj.gasState === 'cloud') {
                   const R = proj.gasRadius || 120;
                   const pulse = 1 + Math.sin(frameRef.current * 0.06) * 0.05;
                   const g = ctx.createRadialGradient(proj.pos.x, proj.pos.y, 0, proj.pos.x, proj.pos.y, R * pulse);
                   g.addColorStop(0, 'rgba(200, 255, 200, 0.4)');
                   g.addColorStop(0.6, 'rgba(120, 220, 120, 0.25)');
                   g.addColorStop(1, 'rgba(70, 170, 70, 0)');
                   ctx.fillStyle = g;
                   ctx.beginPath();
                   ctx.arc(proj.pos.x, proj.pos.y, R * pulse, 0, Math.PI * 2);
                   ctx.fill();

                   // 内部翻涌的毒雾
                   for (let i = 0; i < 4; i++) {
                       const a = frameRef.current * 0.03 + (i * Math.PI) / 2;
                       ctx.fillStyle = 'rgba(235, 255, 235, 0.3)';
                       ctx.beginPath();
                       ctx.arc(
                           proj.pos.x + Math.cos(a) * R * 0.42,
                           proj.pos.y + Math.sin(a) * R * 0.42,
                           14, 0, Math.PI * 2
                       );
                       ctx.fill();
                   }
               } else {
                   // 飞行中的毒气罐
                   ctx.save();
                   ctx.translate(proj.pos.x, proj.pos.y);
                   ctx.fillStyle = '#3f7d2f';
                   ctx.fillRect(-6, -6, 12, 12);
                   ctx.fillStyle = '#2f5d22';
                   ctx.fillRect(-6, -6, 12, 3);
                   ctx.fillStyle = '#c9ff6b';
                   ctx.font = '10px sans-serif';
                   ctx.fillText('☠', -4, 4);
                   ctx.restore();
               }
               return;
           }

           if (proj.type === 'aug' || proj.type === 'gatling' || (isCustomId(proj.type) && proj.blastRadius === undefined)) {
               // 直线弹（AUG / 加特林 / 自创枪械）：弹道拖尾 + 同心圆弹头（不用 shadowBlur）
               const tint = proj.tint ?? (proj.type === 'gatling' ? '#ffd23a' : '#ffe28a');
               if (proj.trail && proj.trail.length > 1) {
                   ctx.globalAlpha = 0.55;
                   ctx.strokeStyle = tint;
                   ctx.lineWidth = 2;
                   ctx.beginPath();
                   ctx.moveTo(proj.trail[0].x, proj.trail[0].y);
                   for (let i = 1; i < proj.trail.length; i++) {
                       ctx.lineTo(proj.trail[i].x, proj.trail[i].y);
                   }
                   ctx.stroke();
                   ctx.globalAlpha = 1;
               }
               ctx.globalAlpha = 0.35;
               ctx.fillStyle = tint;
               ctx.beginPath();
               ctx.arc(proj.pos.x, proj.pos.y, 6, 0, Math.PI * 2);
               ctx.fill();
               ctx.globalAlpha = 1;
               ctx.fillStyle = '#fff7cc';
               ctx.beginPath();
               ctx.arc(proj.pos.x, proj.pos.y, 2.5, 0, Math.PI * 2);
               ctx.fill();
               return;
           }

           if (proj.type === 'piercer') {
               if (proj.piercerState === 'burrowing') {
                   // 地面隆起的土堆
                   ctx.fillStyle = '#6b4f2a';
                   ctx.beginPath();
                   ctx.arc(proj.pos.x, GROUND_Y, 16, Math.PI, 0);
                   ctx.fill();
                   ctx.fillStyle = '#4e3a1f';
                   ctx.beginPath();
                   ctx.arc(proj.pos.x, GROUND_Y, 9, Math.PI, 0);
                   ctx.fill();
                   ctx.fillStyle = '#3b2d17';
                   ctx.beginPath();
                   ctx.arc(proj.pos.x, GROUND_Y, 4, Math.PI, 0);
                   ctx.fill();
               } else {
                   // 弹体（空中飞行 / 破土冲出）
                   ctx.save();
                   ctx.translate(proj.pos.x, proj.pos.y);
                   const pa = Math.atan2(proj.vel.y, proj.vel.x);
                   ctx.rotate(pa);
                   ctx.fillStyle = '#4b5563';
                   ctx.fillRect(-10, -4, 20, 8);
                   ctx.fillStyle = '#dc2626';
                   ctx.beginPath(); ctx.arc(10, 0, 4, 0, Math.PI * 2); ctx.fill();
                   ctx.fillStyle = '#fbbf24';
                   ctx.fillRect(-14, -5, 4, 10); // 尾焰/尾翼
                   ctx.restore();
               }
               return;
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
           } else if (proj.type === 'c4') {
               // C4 炸药块（埋设后红点闪烁）
               ctx.fillStyle = '#6b5a3e';
               ctx.fillRect(-8, -5, 16, 10);
               ctx.fillStyle = '#3f3625';
               ctx.fillRect(-8, -5, 16, 3);
               if (proj.c4State === 'planted') {
                   ctx.fillStyle = (Math.floor(frameRef.current / 8) % 2 === 0) ? '#ff0000' : '#660000';
               } else {
                   ctx.fillStyle = '#ff0000';
               }
               ctx.beginPath(); ctx.arc(5, 5, 2, 0, Math.PI * 2); ctx.fill();
           } else if (isCustomId(proj.type)) {
               // 自创·投掷武器：一路翻滚的 emoji（枪类投射物在上面提前 return 了，到这里的只会是投掷）
               ctx.rotate(frameRef.current * 0.25);
               ctx.font = '18px serif';
               ctx.fillText(getCustom(proj.type)?.emoji ?? '💥', -9, 6);
           }

           ctx.restore();
      });

      // Draw Particles
      particlesRef.current.forEach(p => {
          const alpha = p.currentAlpha !== undefined ? p.currentAlpha : (p.life / p.maxLife);
          ctx.globalAlpha = Math.max(0, alpha);
          if (p.kind === 'ring') {
              ctx.strokeStyle = p.color;
              ctx.lineWidth = p.lineWidth || 4;
              ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2); ctx.stroke();
          } else {
              ctx.fillStyle = p.color;
              ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalAlpha = 1.0;
      });

      // Draw Entities
      const frame = frameRef.current;
      entitiesRef.current.forEach(entity => {
          drawEntity(ctx, entity, frame);
          
          /*
            光束（激光 / 哉佩利敖光线）。
            两处改动：
            1. 光束不再画 2000px 长 —— 只画到画布边缘。超出屏幕的部分本来就看不见，
               却要跟着一起做描边和（原来的）模糊，纯属白烧。
            2. 光晕用"由粗到细叠几层半透明描边"伪造，不再用 shadowBlur。
               原来是对一条 2000px 的长线做 20/40px 高斯模糊，是全项目最贵的一笔，
               而叠层描边只是多画几条线，观感几乎一样。
          */
          if (entity.isAttacking && entity.heldWeapon === 'laser') {
              const startX = entity.pos.x + (entity.facingRight ? 20 : -20);
              const startY = entity.pos.y - 45;
              const endX = entity.facingRight ? canvas.width : 0;

              const beam = (color: string, width: number) => {
                  ctx.strokeStyle = color;
                  ctx.lineWidth = width;
                  ctx.beginPath();
                  ctx.moveTo(startX, startY);
                  ctx.lineTo(endX, startY);
                  ctx.stroke();
              };

              ctx.save();
              beam('rgba(255, 0, 0, 0.16)', 34);  // 外层光晕（两层叠出柔和边缘）
              beam('rgba(255, 0, 0, 0.32)', 20);
              beam('rgba(255, 0, 0, 0.6)', 12);
              beam('#ffffff', 4);                 // 内层核心
              ctx.restore();
          } else if (entity.isAttacking && entity.heldWeapon === 'zeperion') {
              // 绘制哉佩利敖光线（一道金光）
              const startX = entity.pos.x + (entity.facingRight ? 20 : -20);
              const startY = entity.pos.y - 45;
              const endX = entity.facingRight ? canvas.width : 0;

              const beam = (color: string, width: number) => {
                  ctx.strokeStyle = color;
                  ctx.lineWidth = width;
                  ctx.beginPath();
                  ctx.moveTo(startX, startY);
                  ctx.lineTo(endX, startY);
                  ctx.stroke();
              };

              ctx.save();
              ctx.lineCap = 'round';
              beam('rgba(251, 191, 36, 0.18)', 64); // 巨大的金色外层光晕
              beam('rgba(251, 191, 36, 0.34)', 44);
              beam('rgba(251, 191, 36, 0.8)', 30);
              beam('rgba(254, 240, 138, 0.9)', 15); // 中层亮黄
              beam('#ffffff', 6);                   // 内层核心白光
              ctx.restore();
          }
      });
      
      // COOP 波次横幅：屏幕上方居中的大字提示（第 X 关 / 完成！）
      if (coopBannerRef.current) {
          const banner = coopBannerRef.current;
          const alpha = Math.min(1, banner.life / 30); // 最后半秒淡出
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.font = 'italic 900 64px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.lineWidth = 10;
          ctx.strokeStyle = '#ffffff';
          ctx.fillStyle = '#f59e0b';
          ctx.strokeText(banner.text, canvas.width / 2, canvas.height * 0.24);
          ctx.fillText(banner.text, canvas.width / 2, canvas.height * 0.24);
          ctx.restore();
      }

      // Flash
      if (flashRef.current > 0) {
          ctx.fillStyle = `rgba(255, 255, 255, ${flashRef.current})`;
          ctx.fillRect(-shakeX, -shakeY, canvas.width, canvas.height); 
      }

      ctx.restore();
  };

  const tick = (now: number) => {
    // 每帧同步世界尺寸，保证窗口缩放后地面 / 平台仍然可见
    if (canvasRef.current) syncWorldSize(canvasRef.current);

    // 固定步长：物理按固定 60Hz 推进，与显示器刷新率（60 / 120 / 144Hz）解耦。
    // 否则高刷屏上重力、移动速度、冷却、计时都会成倍变快，绘制次数也跟着翻倍。
    if (lastTimeRef.current === 0) lastTimeRef.current = now;
    let delta = now - lastTimeRef.current;
    lastTimeRef.current = now;
    if (delta > 250) delta = FIXED_STEP; // 切后台 / 断点回来：丢弃积压时间，不补算
    accRef.current += delta;

    let steps = 0;
    while (accRef.current >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      update();
      accRef.current -= FIXED_STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) accRef.current = 0; // 追不上就放弃积压，防止雪崩

    // 两种情况跳过重绘：
    // 1. 没推进逻辑帧 —— 画面与上一帧完全一致（高刷屏上很常见），省掉整帧光栅化；
    // 2. 菜单 / 结算界面 —— MainMenu 与 GameOver 都是不透明的全屏遮罩（z-50），
    //    canvas 100% 被盖住，这时再画一遍渐变底 + 星云 + 星空 + 地面 + 平台 + 障碍纯属白烧 GPU。
    //    ⚠️ 若将来把菜单/结算改成半透明，必须把这里改回去，否则背景会静止。
    const canvasCovered = gameState === GameState.MENU || gameState === GameState.GAME_OVER;
    if (steps > 0 && !canvasCovered) draw();

    // HUD 同步：每 5 帧检查一次签名，只有可见数值真的变了才触发 React 重渲染
    if (
      frameRef.current % 5 === 0 &&
      (gameState === GameState.PLAYING || gameState === GameState.VICTORY_ANIMATION)
    ) {
      const sig = hudSignature(entitiesRef.current, statsRef.current);
      if (sig !== hudSigRef.current) {
        hudSigRef.current = sig;
        setStats({ ...statsRef.current });
        setPlayers(entitiesRef.current.map(e => ({ ...e })));
      }
    }

    requestRef.current = requestAnimationFrame(tick);
  };

  // 窗口尺寸变化时，同步 canvas 实际像素尺寸
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 卸载时清理胜利结算定时器，避免对已卸载组件 setState
  useEffect(() => {
    return () => {
      if (winTimeoutRef.current) clearTimeout(winTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
    }
    // 重开循环时清掉时间累积器，避免用上一局残留的时间戳算出一个巨大的 delta
    lastTimeRef.current = 0;
    accRef.current = 0;
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

/*
  memo：App 每次因 HUD 数据更新而重渲染时，GameCanvas 的 props（都是稳定引用 / 基本类型）
  并未变化，跳过它的重渲染，避免每 100ms 重建一遍 update / draw / tick 闭包。
*/
export default React.memo(GameCanvas);