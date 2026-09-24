import { AnyWeaponId, CustomWeapon, CustomWeaponId, CustomWeaponTemplate, WeaponType } from '../types';

/**
 * 武器库存档：管理内置武器的启用/禁用 + 小朋友的自创武器。
 *
 * 与 progressService 的局数存档不同，这份数据**不做版本门**：
 * 自创武器是小朋友的"作品"，版本升级不该把它们清掉。
 * localStorage 访问全部包 try（无痕模式会抛异常），存不了就退化成"默认全开、无自创"，
 * 绝不能因此白屏或开不了局。
 */

export interface WeaponConfig {
  disabled: WeaponType[];  // 被禁用的内置武器（不再从天上掉落）
  customs: CustomWeapon[]; // 自创武器
}

const STORAGE_KEY = 'stickman-battle:weapons';

// 内置武器的展示元数据：名字 / 图标 / 一句话说明。
// GameUI 的 HUD 和武器库共用这一张表，不要在两处各维护一份。
// rare: true 的三件走固定槽位掉落（见 GameCanvas.spawnFallingItem），不在普通池里。
export interface BuiltinMeta {
  type: WeaponType;
  name: string;
  emoji: string;
  desc: string;
  rare?: boolean;
}

export const BUILTIN_WEAPONS: BuiltinMeta[] = [
  { type: 'sword',     name: '长剑',       emoji: '⚔️', desc: '近战连砍，命中才耗耐久' },
  { type: 'bomb',      name: '炸弹',       emoji: '💣', desc: '抛出去落地爆炸' },
  { type: 'aug',       name: 'AUG 步枪',   emoji: '🔫', desc: '直线子弹连发' },
  { type: 'gatling',   name: '加特林',     emoji: '🎆', desc: '射速拉满的子弹泼洒，单发刮痧' },
  { type: 'laser',     name: '激光枪',     emoji: '🚨', desc: '一道红激光，命中即倒' },
  { type: 'zeperion',  name: '哉佩利敖',   emoji: '✨', desc: '金色光线，高伤害' },
  { type: 'c4',        name: 'C4 炸药',    emoji: '🧨', desc: '贴上后再按攻击键遥控引爆' },
  { type: 'piercer',   name: '穿地弹',     emoji: '🕳️', desc: '钻进地里再从敌人脚下喷出' },
  { type: 'gas',       name: '毒气弹',     emoji: '☠️', desc: '落地生成一片毒气' },
  { type: 'bomber',    name: '轰炸机',     emoji: '🛩️', desc: '呼叫空袭炸一条线' },
  { type: 'pokemon',   name: '皮卡丘',     emoji: '⚡', desc: '追着敌人放电' },
  { type: 'missile',   name: '巡航导弹',   emoji: '🚀', desc: '追踪敌人，稀有武器', rare: true },
  { type: 'dragon',    name: '神龙',       emoji: '🐉', desc: '召唤神龙撕咬，稀有武器', rare: true },
  { type: 'atom_bomb', name: '原子弹',     emoji: '☢️', desc: '毁天灭地，稀有武器', rare: true },
];

// 普通掉落池（稀有武器不在其中）—— 与 GameCanvas.spawnFallingItem 的池子保持一致
export const BUILTIN_POOL: WeaponType[] = BUILTIN_WEAPONS.filter(w => !w.rare).map(w => w.type);

// ---- 自创武器数值边界：防止填出毁平衡的武器（钳制在保存时做）----
export const CUSTOM_LIMITS: Record<CustomWeaponTemplate, {
  damage: [number, number]; ammo: [number, number];
  range?: [number, number]; knockback?: [number, number];
  bulletSpeed?: [number, number]; blastRadius?: [number, number];
}> = {
  melee: { damage: [3, 30], range: [60, 220], knockback: [0, 30], ammo: [3, 20] },
  gun:   { damage: [2, 20], bulletSpeed: [8, 30], ammo: [3, 30] },
  throw: { damage: [10, 60], blastRadius: [40, 160], ammo: [1, 5] },
};

export const TEMPLATE_INFO: Record<CustomWeaponTemplate, { name: string; emoji: string; desc: string }> = {
  melee: { name: '近战挥砍', emoji: '🗡️', desc: '冲到脸上抡，范围大、命中才耗耐久' },
  gun:   { name: '子弹连发', emoji: '🔫', desc: '直线子弹，远距离消耗' },
  throw: { name: '投掷爆炸', emoji: '💥', desc: '抛个弧线，落地开花' },
};

export const CUSTOM_EMOJIS = ['🍭', '🎃', '🦄', '🌈', '🔥', '⭐', '🍕', '🚀', '🐢', '👾', '💎', '🎸'];

export const CUSTOM_COLORS = ['#f43f5e', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#a78bfa', '#f472b6', '#e2e8f0'];

const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, Math.round(v)));

// 按模板把数值钳回安全范围 + 补齐缺省字段（读档和保存都走这里）
const sanitize = (w: CustomWeapon): CustomWeapon => {
  const L = CUSTOM_LIMITS[w.template] ?? CUSTOM_LIMITS.melee;
  return {
    ...w,
    name: String(w.name ?? '').slice(0, 6) || '新武器',
    emoji: String(w.emoji ?? '🍭'),
    damage: clamp(Number(w.damage) || 5, L.damage),
    ammo: clamp(Number(w.ammo) || 3, L.ammo),
    range: clamp(Number(w.range) || 120, L.range ?? [60, 220]),
    knockback: clamp(Number(w.knockback) || 12, L.knockback ?? [0, 30]),
    bulletSpeed: clamp(Number(w.bulletSpeed) || 16, L.bulletSpeed ?? [8, 30]),
    blastRadius: clamp(Number(w.blastRadius) || 80, L.blastRadius ?? [40, 160]),
    color: /^#[0-9a-fA-F]{6}$/.test(w.color) ? w.color : '#22d3ee',
  };
};

const freshConfig = (): WeaponConfig => ({ disabled: [], customs: [] });

// 模块内缓存：loadWeapons 每帧都可能被间接调用（HUD 图标回退），不能每次都 JSON.parse
let cache: WeaponConfig | null = null;

export const loadWeapons = (): WeaponConfig => {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<WeaponConfig> | null;
      cache = {
        disabled: Array.isArray(saved?.disabled)
          ? saved.disabled.filter((t): t is WeaponType => BUILTIN_POOL.includes(t as WeaponType) || BUILTIN_WEAPONS.some(b => b.type === t))
          : [],
        customs: Array.isArray(saved?.customs)
          ? saved.customs.filter(w => w && typeof w.id === 'string' && w.id.startsWith('cw_')).map(w => sanitize(w as CustomWeapon))
          : [],
      };
      return cache;
    }
  } catch {
    /* 读不了就默认 */
  }
  cache = freshConfig();
  return cache;
};

const save = (cfg: WeaponConfig) => {
  cache = cfg;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* 存不了就算了，本次会话内 cache 仍然生效 */
  }
};

// ---- 查询 ----

export const isCustomId = (id: string | null | undefined): id is CustomWeaponId =>
  typeof id === 'string' && id.startsWith('cw_');

export const getCustom = (id: string | null | undefined): CustomWeapon | undefined =>
  isCustomId(id) ? loadWeapons().customs.find(w => w.id === id) : undefined;

// 任意武器（内置/自创）的展示名与图标：HUD 和武器库共用
export const weaponEmoji = (id: AnyWeaponId | null | undefined): string => {
  if (!id) return '👊';
  const custom = getCustom(id);
  if (custom) return custom.emoji;
  return BUILTIN_WEAPONS.find(b => b.type === id)?.emoji ?? '👊';
};

export const weaponName = (id: AnyWeaponId | null | undefined): string => {
  if (!id) return '赤手空拳';
  const custom = getCustom(id);
  if (custom) return custom.name;
  return BUILTIN_WEAPONS.find(b => b.type === id)?.name ?? '赤手空拳';
};

// 某件内置武器是否被禁用（稀有槽位也要查它，见 GameCanvas.spawnFallingItem）
export const isBuiltinDisabled = (t: WeaponType): boolean => loadWeapons().disabled.includes(t);

// 本局掉落池：未被禁用的内置普通武器 + 自创武器 id
export const getDropPool = (): AnyWeaponId[] => {
  const cfg = loadWeapons();
  const enabled = BUILTIN_POOL.filter(t => !cfg.disabled.includes(t));
  return [...enabled, ...cfg.customs.map(w => w.id)];
};

// ---- 增 / 改 / 删 ----

export const addCustom = (draft: Omit<CustomWeapon, 'id'>): CustomWeapon => {
  const cfg = loadWeapons();
  const w = sanitize({ ...draft, id: `cw_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}` });
  save({ ...cfg, customs: [...cfg.customs, w] });
  return w;
};

export const updateCustom = (w: CustomWeapon): void => {
  const cfg = loadWeapons();
  save({ ...cfg, customs: cfg.customs.map(x => (x.id === w.id ? sanitize(w) : x)) });
};

export const removeCustom = (id: CustomWeaponId): void => {
  const cfg = loadWeapons();
  save({ ...cfg, customs: cfg.customs.filter(x => x.id !== id) });
};

export const setBuiltinEnabled = (type: WeaponType, enabled: boolean): void => {
  const cfg = loadWeapons();
  const disabled = enabled ? cfg.disabled.filter(t => t !== type) : [...new Set([...cfg.disabled, type])];
  save({ ...cfg, disabled });
};
