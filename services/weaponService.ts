import { AnyWeaponId, CustomWeapon, CustomWeaponId, CustomWeaponTemplate, WeaponStatKey, WeaponStats, WeaponType } from '../types';

/**
 * 武器库存档：管理内置武器的启用/禁用 + 数值调整 + 小朋友的自创武器。
 *
 * 与 progressService 的局数存档不同，这份数据**不做版本门**：
 * 自创武器是小朋友的"作品"，版本升级不该把它们清掉。
 * localStorage 访问全部包 try（无痕模式会抛异常），存不了就退化成"默认全开、无自创"，
 * 绝不能因此白屏或开不了局。
 */

export interface WeaponConfig {
  disabled: WeaponType[];   // 被禁用的内置武器（不再从天上掉落）
  customs: CustomWeapon[];  // 自创武器
  overrides: Partial<Record<WeaponType, Partial<WeaponStats>>>; // 内置武器的数值调整（缺省 = 全默认）
}

const STORAGE_KEY = 'stickman-battle:weapons';

// 内置武器的展示元数据：名字 / 图标 / 一句话说明。
// GameUI 的 HUD 和武器库共用这一张表，不要在两处各维护一份。
// rare: true 的两件走固定槽位掉落（见 GameCanvas.spawnFallingItem），不在普通池里。
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
  { type: 'revolver',  name: '双持左轮',   emoji: '🤠', desc: '双手各一把，同时射出两发子弹' },
  { type: 'sniper',    name: '狙击枪',     emoji: '🎯', desc: '高速穿透弹，一枪穿一串，单发超高伤' },
  { type: 'sk12',      name: 'SK12 散弹枪', emoji: '💥', desc: '一枪喷出六颗鹿弹，贴脸爆发之王' },
  { type: 'laser',     name: '激光枪',     emoji: '🚨', desc: '一道红激光，狙击高伤' },
  { type: 'zeperion',  name: '哉佩利敖',   emoji: '✨', desc: '金色光线，高伤害' },
  { type: 'c4',        name: 'C4 炸药',    emoji: '🧨', desc: '贴上后再按攻击键遥控引爆' },
  { type: 'piercer',   name: '穿地弹',     emoji: '🕳️', desc: '钻进地里再从敌人脚下喷出' },
  { type: 'gas',       name: '毒气弹',     emoji: '☠️', desc: '落地生成一片毒气' },
  { type: 'bomber',    name: '轰炸机',     emoji: '🛩️', desc: '呼叫空袭炸一条线' },
  { type: 'pokemon',   name: '皮卡丘',     emoji: '⚡', desc: '追着敌人放电' },
  { type: 'missile',   name: '巡航导弹',   emoji: '🚀', desc: '追踪敌人，稀有武器', rare: true },
  { type: 'dragon',    name: '神龙',       emoji: '🐉', desc: '召唤神龙撕咬，稀有武器', rare: true },
];

// 普通掉落池（稀有武器不在其中）—— 与 GameCanvas.spawnFallingItem 的池子保持一致
export const BUILTIN_POOL: WeaponType[] = BUILTIN_WEAPONS.filter(w => !w.rare).map(w => w.type);

/*
  掉落权重：默认每件武器在池里只出现 1 次（等概率）。
  给新武器 / 强武器加权重 = 在池里放多份，提高被随机到的概率。
  例：sniper 权重 3 ⇒ 池里有 3 份 sniper，被抽中的概率是其他武器的 3 倍。
*/
const DROP_WEIGHTS: Partial<Record<WeaponType, number>> = {
  sniper: 3,
  sk12: 3, // 散弹枪手感爽，提高出现频率让小朋友更容易摸到
};

/*
  ---- 内置武器数值层 ----
  以前所有伤害/弹药/冷却都硬编码在 GameCanvas 的分支里，武器库改不了。
  现在默认值集中在这一张表，GameCanvas 分支读 getBuiltinStats；
  玩家在武器库「调一调」的修改存进 WeaponConfig.overrides（只存和默认不同的字段）。
  每件武器的定位（差异化）：
  - 长剑 = 近战持续；AUG = 基准射手；加特林 = 泼洒压制；SK12 = 近距霰弹爆发
  - 炸弹 = 爆发 AoE；激光 = 狙击（瞬发高伤但射得慢，不再是即死）；哉佩利敖 = 重型光束+爆点
  - C4 = 遥控陷阱；穿地弹 = 反蹲；毒气弹 = 区域封锁
  - 轰炸机 = 三连小炸（区别于手雷的大单发）；皮卡丘 = 刺客单次+瘫痪
  - 导弹/神龙 = 稀有追踪（原子弹已在 v1.9.0 从游戏移除，类型与休眠数值保留兜底）
*/
export const BUILTIN_STATS: Record<WeaponType, WeaponStats> = {
  sword:     { damage: 15, ammo: 8,  range: 140, knockback: 12 },
  bomb:      { damage: 25, ammo: 3,  blastRadius: 180 },
  aug:       { damage: 6,  ammo: 20, cooldown: 8,  bulletSpeed: 22 },
  gatling:   { damage: 4,  ammo: 40, cooldown: 4,  bulletSpeed: 20 },
  revolver:  { damage: 12, ammo: 12, cooldown: 20, bulletSpeed: 24 }, // 双持：一次射两发，单发高伤、射速慢
  sniper:    { damage: 100, ammo: 5, cooldown: 45, bulletSpeed: 40 }, // 穿透：高速弹丸穿一串敌人，单发超高伤、射速极慢
  sk12:      { damage: 7,  ammo: 8,  cooldown: 40, bulletSpeed: 26 }, // 霰弹：一次 6 颗鹿弹锥形散射，贴脸全中 42 伤，远了打不全
  laser:     { damage: 30, ammo: 6,  cooldown: 30 },   // 狙击：慢射高伤（原版即死×9发太离谱）
  zeperion:  { damage: 40, ammo: 3 },
  c4:        { damage: 40, ammo: 2,  blastRadius: 220 },
  piercer:   { damage: 30, ammo: 3,  blastRadius: 200 },
  gas:       { damage: 1,  ammo: 2,  blastRadius: 120 }, // damage = 每 8 帧掉 1 血
  bomber:    { damage: 20, ammo: 1,  blastRadius: 120 }, // damage/blastRadius = 空投小炸弹的
  pokemon:   { damage: 20, ammo: 1 },
  missile:   { damage: 35, ammo: 2 },
  dragon:    { damage: 5,  ammo: 1 },                    // damage = 每口咬伤（共 5 口）
  atom_bomb: { damage: 100, ammo: 1 },                   // 全屏抹除不看伤害，只开放弹药
};

// 「调一调」滑条的通用边界（个别武器再单独收紧，见 STAT_LIMIT_OVERRIDES）
export const STAT_LIMITS: Record<WeaponStatKey, [number, number]> = {
  damage: [1, 80],
  ammo: [1, 99],
  cooldown: [4, 60],
  range: [60, 260],
  knockback: [0, 30],
  bulletSpeed: [8, 30],
  blastRadius: [40, 260],
};

// 个别武器的收紧边界：毒气是持续掉血，单跳伤害放到 60 会直接秒人
// 狙击枪默认伤害就是 100，滑条上限单独放宽到 120
const STAT_LIMIT_OVERRIDES: Partial<Record<WeaponType, Partial<Record<WeaponStatKey, [number, number]>>>> = {
  gas: { damage: [1, 10] },
  sniper: { damage: [1, 120] },
};

// 每件武器「调一调」面板显示哪些滑条（顺序即显示顺序）
export const BUILTIN_STAT_FIELDS: Record<WeaponType, { key: WeaponStatKey; label: string; icon: string }[]> = {
  sword:     [{ key: 'damage', label: '伤害', icon: '💥' }, { key: 'range', label: '攻击距离', icon: '📏' }, { key: 'knockback', label: '击退', icon: '💨' }, { key: 'ammo', label: '耐久', icon: '🔢' }],
  bomb:      [{ key: 'damage', label: '伤害', icon: '💥' }, { key: 'blastRadius', label: '爆炸半径', icon: '🎯' }, { key: 'ammo', label: '数量', icon: '🔢' }],
  aug:       [{ key: 'damage', label: '伤害', icon: '💥' }, { key: 'bulletSpeed', label: '子弹速度', icon: '🚀' }, { key: 'cooldown', label: '攻击间隔', icon: '⏱️' }, { key: 'ammo', label: '弹药', icon: '🔢' }],
  gatling:   [{ key: 'damage', label: '伤害', icon: '💥' }, { key: 'bulletSpeed', label: '子弹速度', icon: '🚀' }, { key: 'cooldown', label: '攻击间隔', icon: '⏱️' }, { key: 'ammo', label: '弹药', icon: '🔢' }],
  revolver:  [{ key: 'damage', label: '伤害', icon: '💥' }, { key: 'bulletSpeed', label: '子弹速度', icon: '🚀' }, { key: 'cooldown', label: '攻击间隔', icon: '⏱️' }, { key: 'ammo', label: '弹药', icon: '🔢' }],
  sniper:    [{ key: 'damage', label: '伤害', icon: '💥' }, { key: 'bulletSpeed', label: '子弹速度', icon: '🚀' }, { key: 'cooldown', label: '攻击间隔', icon: '⏱️' }, { key: 'ammo', label: '弹药', icon: '🔢' }],
  sk12:      [{ key: 'damage', label: '单颗伤害', icon: '💥' }, { key: 'bulletSpeed', label: '弹丸速度', icon: '🚀' }, { key: 'cooldown', label: '攻击间隔', icon: '⏱️' }, { key: 'ammo', label: '弹药', icon: '🔢' }],
  laser:     [{ key: 'damage', label: '伤害', icon: '💥' }, { key: 'cooldown', label: '攻击间隔', icon: '⏱️' }, { key: 'ammo', label: '弹药', icon: '🔢' }],
  zeperion:  [{ key: 'damage', label: '伤害', icon: '💥' }, { key: 'ammo', label: '弹药', icon: '🔢' }],
  c4:        [{ key: 'damage', label: '伤害', icon: '💥' }, { key: 'blastRadius', label: '爆炸半径', icon: '🎯' }, { key: 'ammo', label: '数量', icon: '🔢' }],
  piercer:   [{ key: 'damage', label: '伤害', icon: '💥' }, { key: 'blastRadius', label: '爆炸半径', icon: '🎯' }, { key: 'ammo', label: '数量', icon: '🔢' }],
  gas:       [{ key: 'damage', label: '每跳伤害', icon: '💥' }, { key: 'blastRadius', label: '毒气半径', icon: '🎯' }, { key: 'ammo', label: '数量', icon: '🔢' }],
  bomber:    [{ key: 'damage', label: '每颗伤害', icon: '💥' }, { key: 'blastRadius', label: '爆炸半径', icon: '🎯' }, { key: 'ammo', label: '次数', icon: '🔢' }],
  pokemon:   [{ key: 'damage', label: '伤害', icon: '💥' }, { key: 'ammo', label: '次数', icon: '🔢' }],
  missile:   [{ key: 'damage', label: '伤害', icon: '💥' }, { key: 'ammo', label: '数量', icon: '🔢' }],
  dragon:    [{ key: 'damage', label: '每口伤害', icon: '💥' }, { key: 'ammo', label: '次数', icon: '🔢' }],
  atom_bomb: [{ key: 'ammo', label: '数量', icon: '🔢' }],
};

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

const freshConfig = (): WeaponConfig => ({ disabled: [], customs: [], overrides: {} });

// 内置武器数值的有效边界（个别武器收紧过）
export const statLimit = (type: WeaponType, key: WeaponStatKey): [number, number] =>
  STAT_LIMIT_OVERRIDES[type]?.[key] ?? STAT_LIMITS[key];

// 把 override 补丁钳回安全范围（只保留该武器开放的字段）
const clampStats = (type: WeaponType, patch: Partial<WeaponStats>): Partial<WeaponStats> => {
  const out: Partial<WeaponStats> = {};
  for (const f of BUILTIN_STAT_FIELDS[type]) {
    const v = patch[f.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[f.key] = clamp(v, statLimit(type, f.key));
  }
  return out;
};

// 读档时清洗 overrides：只认内置武器白名单里的数值字段，钳制后剔除与默认相同的
const sanitizeOverrides = (o: unknown): WeaponConfig['overrides'] => {
  if (!o || typeof o !== 'object') return {};
  const out: WeaponConfig['overrides'] = {};
  for (const b of BUILTIN_WEAPONS) {
    const patch = (o as Record<string, unknown>)[b.type];
    if (!patch || typeof patch !== 'object') continue;
    const clean = clampStats(b.type, patch as Partial<WeaponStats>);
    const defaults = BUILTIN_STATS[b.type];
    const hasDiff = (Object.keys(clean) as WeaponStatKey[]).some(k => clean[k] !== defaults[k]);
    if (hasDiff) out[b.type] = clean;
  }
  return out;
};

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
        overrides: sanitizeOverrides(saved?.overrides),
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

// 本局掉落池：未被禁用的内置普通武器（按权重展开）+ 自创武器 id
export const getDropPool = (): AnyWeaponId[] => {
  const cfg = loadWeapons();
  const pool: AnyWeaponId[] = [];
  for (const t of BUILTIN_POOL) {
    if (cfg.disabled.includes(t)) continue;
    const w = DROP_WEIGHTS[t] ?? 1;
    for (let i = 0; i < w; i++) pool.push(t);
  }
  return [...pool, ...cfg.customs.map(w => w.id)];
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

// ---- 内置武器数值：查 / 改 / 重置 ----

// 某件内置武器的完整数值 = 默认值 + 玩家调整（GameCanvas 各分支统一从这里拿数）
export const getBuiltinStats = (type: WeaponType): WeaponStats => ({
  ...BUILTIN_STATS[type],
  ...loadWeapons().overrides[type],
});

// 修改数值（钳制；只存和默认不同的字段，调回默认就整条清掉）
export const updateBuiltinStats = (type: WeaponType, patch: Partial<WeaponStats>): void => {
  const cfg = loadWeapons();
  const defaults = BUILTIN_STATS[type];
  const merged = clampStats(type, { ...cfg.overrides[type], ...patch });
  const diff: Partial<WeaponStats> = {};
  (Object.keys(merged) as WeaponStatKey[]).forEach(k => {
    if (merged[k] !== defaults[k]) diff[k] = merged[k];
  });
  const overrides = { ...cfg.overrides };
  if (Object.keys(diff).length) overrides[type] = diff;
  else delete overrides[type];
  save({ ...cfg, overrides });
};

// 恢复某件武器的默认数值
export const resetBuiltinStats = (type: WeaponType): void => {
  const cfg = loadWeapons();
  if (!cfg.overrides[type]) return;
  const overrides = { ...cfg.overrides };
  delete overrides[type];
  save({ ...cfg, overrides });
};

// 武器库卡片显示「已调整」角标用
export const isBuiltinModified = (type: WeaponType): boolean => Boolean(loadWeapons().overrides[type]);
