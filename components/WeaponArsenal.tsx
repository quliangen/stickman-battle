import React, { useState } from 'react';
import { motion } from 'motion/react';
import { CustomWeapon, CustomWeaponTemplate, WeaponStats, WeaponStatKey, WeaponType } from '../types';
import {
  BUILTIN_STAT_FIELDS,
  BUILTIN_STATS,
  BUILTIN_WEAPONS,
  CUSTOM_COLORS,
  CUSTOM_EMOJIS,
  CUSTOM_LIMITS,
  TEMPLATE_INFO,
  WeaponConfig,
  addCustom,
  getBuiltinStats,
  isBuiltinModified,
  loadWeapons,
  removeCustom,
  resetBuiltinStats,
  setBuiltinEnabled,
  statLimit,
  updateBuiltinStats,
  updateCustom,
} from '../services/weaponService';

interface WeaponArsenalProps {
  onClose: () => void;
}

/*
  武器库：管理「天上掉什么武器」。
  - 内置 14 种：可启用 / 禁用（禁用后不再掉落，含稀有槽位），还能「调一调」改数值
    （伤害 / 弹药等，按武器开放子集，可恢复默认，存 overrides，见 weaponService）；
  - 自创武器：模板 + 参数，支持增 / 改 / 删，跨版本保留（见 weaponService）。
  这里只改 localStorage 存档，游戏开火 / 拾取时才读数值，所以改完下一局生效。
*/

// ---- 小零件 ----

// 参数滑条：图标 + 名字 + 滑杆 + 当前值
const ParamSlider: React.FC<{
  icon: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}> = ({ icon, label, value, min, max, onChange }) => (
  <div className="flex items-center gap-3">
    <span className="w-28 shrink-0 font-body text-sm font-black text-slate-600">{icon} {label}</span>
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="flex-1 h-2 accent-blue-500 cursor-pointer"
    />
    <span className="w-9 text-right font-body text-lg font-black text-blue-600 tabular-nums">{value}</span>
  </div>
);

// 编辑器里的卡通大按钮
const BigButton: React.FC<{
  onClick: () => void;
  color: 'green' | 'white';
  children: React.ReactNode;
}> = ({ onClick, color, children }) => (
  <motion.button
    whileHover={{ scale: 1.04, y: -2 }}
    whileTap={{ scale: 0.96, y: 2 }}
    onClick={onClick}
    className={`rounded-2xl border-4 px-6 py-2.5 font-body text-xl font-black shadow-[0_6px_0_0_rgba(0,0,0,0.2)]
      ${color === 'green'
        ? 'bg-gradient-to-b from-emerald-400 to-green-600 border-green-200 text-white'
        : 'bg-white border-slate-200 text-slate-600'}`}
  >
    {children}
  </motion.button>
);

// ---- 自创武器编辑器（新增 / 编辑共用）----
const WeaponEditor: React.FC<{
  initial: CustomWeapon | null; // null = 新增
  onSave: (draft: Omit<CustomWeapon, 'id'>) => void;
  onCancel: () => void;
}> = ({ initial, onSave, onCancel }) => {
  const [template, setTemplate] = useState<CustomWeaponTemplate>(initial?.template ?? 'melee');
  const [name, setName] = useState(initial?.name ?? '');
  const [emoji, setEmoji] = useState(initial?.emoji ?? CUSTOM_EMOJIS[0]);
  const [color, setColor] = useState(initial?.color ?? CUSTOM_COLORS[4]);
  const [damage, setDamage] = useState(initial?.damage ?? 12);
  const [ammo, setAmmo] = useState(initial?.ammo ?? 8);
  const [range, setRange] = useState(initial?.range ?? 120);
  const [knockback, setKnockback] = useState(initial?.knockback ?? 12);
  const [bulletSpeed, setBulletSpeed] = useState(initial?.bulletSpeed ?? 16);
  const [blastRadius, setBlastRadius] = useState(initial?.blastRadius ?? 80);

  const L = CUSTOM_LIMITS[template];

  // 换模板时把数值钳进新模板的范围，滑条才不会显示不出当前值
  const switchTemplate = (t: CustomWeaponTemplate) => {
    setTemplate(t);
    const nl = CUSTOM_LIMITS[t];
    const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));
    setDamage(v => clamp(v, nl.damage));
    setAmmo(v => clamp(v, nl.ammo));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <motion.div
        initial={{ scale: 0.85, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0.35 }}
        className="w-full max-w-2xl max-h-full overflow-y-auto rounded-3xl border-4 border-white bg-white/95 p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <span className="font-body text-2xl font-black text-slate-700">
            {initial ? '✏️ 编辑武器' : '➕ 做一把新武器'}
          </span>
          {/* 预览：名字 + emoji 实时联动 */}
          <span className="flex items-center gap-2 rounded-full bg-blue-100 border-2 border-blue-200 px-4 py-1">
            <span className="text-2xl">{emoji}</span>
            <span className="font-body text-lg font-black text-blue-700">{name || '新武器'}</span>
          </span>
        </div>

        {/* 模板三选一 */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {(Object.keys(TEMPLATE_INFO) as CustomWeaponTemplate[]).map(t => {
            const info = TEMPLATE_INFO[t];
            const selected = template === t;
            return (
              <motion.button
                key={t}
                whileTap={{ scale: 0.95 }}
                onClick={() => switchTemplate(t)}
                className={`rounded-2xl border-4 p-2.5 flex flex-col items-center gap-0.5 transition-colors
                  ${selected ? 'border-blue-500 bg-blue-100' : 'border-slate-200 bg-white hover:border-blue-200'}`}
              >
                <span className="text-3xl">{info.emoji}</span>
                <span className="font-body text-sm font-black text-slate-700">{info.name}</span>
                <span className="font-body text-[11px] font-bold text-slate-400 leading-tight text-center">{info.desc}</span>
              </motion.button>
            );
          })}
        </div>

        {/* 名字 */}
        <div className="flex items-center gap-3 mb-4">
          <span className="w-28 shrink-0 font-body text-sm font-black text-slate-600">✏️ 名字</span>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={6}
            placeholder="最多 6 个字"
            className="flex-1 rounded-xl border-2 border-slate-300 px-3 py-1.5 font-body text-lg font-black text-slate-700
              outline-none focus:border-blue-400"
          />
        </div>

        {/* 长相 emoji */}
        <div className="flex items-start gap-3 mb-4">
          <span className="w-28 shrink-0 pt-2 font-body text-sm font-black text-slate-600">😀 长相</span>
          <div className="flex flex-wrap gap-1.5">
            {CUSTOM_EMOJIS.map(e => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`w-10 h-10 rounded-xl border-2 text-2xl flex items-center justify-center transition-all
                  ${emoji === e ? 'border-blue-500 bg-blue-100 scale-110' : 'border-slate-200 bg-white hover:border-blue-200'}`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        {/* 颜色（子弹 / 爆炸用） */}
        {template !== 'melee' && (
          <div className="flex items-center gap-3 mb-4">
            <span className="w-28 shrink-0 font-body text-sm font-black text-slate-600">🎨 颜色</span>
            <div className="flex flex-wrap gap-2">
              {CUSTOM_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-9 h-9 rounded-full border-4 transition-all
                    ${color === c ? 'border-slate-700 scale-110' : 'border-white shadow'}`}
                />
              ))}
            </div>
          </div>
        )}

        {/* 参数滑条：按模板出不同的项 */}
        <div className="flex flex-col gap-2.5 rounded-2xl bg-slate-100 border-2 border-slate-200 p-3 mb-5">
          <ParamSlider icon="💥" label="伤害" value={damage} min={L.damage[0]} max={L.damage[1]} onChange={setDamage} />
          {template === 'melee' && (
            <>
              <ParamSlider icon="📏" label="攻击距离" value={range} min={L.range![0]} max={L.range![1]} onChange={setRange} />
              <ParamSlider icon="💨" label="击退" value={knockback} min={L.knockback![0]} max={L.knockback![1]} onChange={setKnockback} />
            </>
          )}
          {template === 'gun' && (
            <ParamSlider icon="🚀" label="子弹速度" value={bulletSpeed} min={L.bulletSpeed![0]} max={L.bulletSpeed![1]} onChange={setBulletSpeed} />
          )}
          {template === 'throw' && (
            <ParamSlider icon="🎯" label="爆炸范围" value={blastRadius} min={L.blastRadius![0]} max={L.blastRadius![1]} onChange={setBlastRadius} />
          )}
          <ParamSlider icon="🔢" label="使用次数" value={ammo} min={L.ammo[0]} max={L.ammo[1]} onChange={setAmmo} />
        </div>

        <div className="flex justify-center gap-4">
          <BigButton color="white" onClick={onCancel}>取消</BigButton>
          <BigButton
            color="green"
            onClick={() => onSave({
              name, emoji, template, damage, ammo,
              range, knockback, bulletSpeed, blastRadius, color,
            })}
          >
            保存武器！
          </BigButton>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ---- 内置武器「调一调」编辑器 ----
// 名字 / emoji 不改，只调数值（伤害/弹药/间隔等，按武器开放子集），可一键恢复默认。
const BuiltinStatEditor: React.FC<{
  type: WeaponType;
  name: string;
  emoji: string;
  onDone: () => void; // 存好 / 恢复默认 / 取消都从这里关
}> = ({ type, name, emoji, onDone }) => {
  const fields = BUILTIN_STAT_FIELDS[type];
  // 草稿 = 默认值 + 玩家已调的值（getBuiltinStats 就是这个合并结果）
  const [draft, setDraft] = useState<WeaponStats>(() => ({ ...getBuiltinStats(type) }));

  const setValue = (key: WeaponStatKey, v: number) =>
    setDraft(d => ({ ...d, [key]: v }));

  // 有没有动过（和默认值比），决定「存好」按钮是否亮起
  const dirty = fields.some(f => draft[f.key] !== BUILTIN_STATS[type][f.key]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <motion.div
        initial={{ scale: 0.85, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0.35 }}
        className="w-full max-w-md max-h-full overflow-y-auto rounded-3xl border-4 border-white bg-white/95 p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-1">
          <span className="font-body text-2xl font-black text-slate-700">⚙️ 调一调</span>
          <span className="flex items-center gap-2 rounded-full bg-blue-100 border-2 border-blue-200 px-4 py-1">
            <span className="text-2xl">{emoji}</span>
            <span className="font-body text-lg font-black text-blue-700">{name}</span>
          </span>
        </div>
        <p className="font-body text-xs font-bold text-slate-400 mb-4 text-center">调完存好，下一局生效</p>

        <div className="flex flex-col gap-2.5 rounded-2xl bg-slate-100 border-2 border-slate-200 p-3 mb-5">
          {fields.map(f => {
            const [min, max] = statLimit(type, f.key);
            return (
              <ParamSlider
                key={f.key}
                icon={f.icon}
                label={f.label}
                value={draft[f.key] ?? 0}
                min={min}
                max={max}
                onChange={v => setValue(f.key, v)}
              />
            );
          })}
        </div>

        <div className="flex justify-center gap-3 flex-wrap">
          <BigButton
            color="white"
            onClick={() => {
              // 恢复默认：清掉这件武器的全部调整
              resetBuiltinStats(type);
              onDone();
            }}
          >
            ↩️ 恢复默认
          </BigButton>
          <BigButton
            color="green"
            onClick={() => {
              const patch: Partial<WeaponStats> = {};
              fields.forEach(f => { patch[f.key] = draft[f.key]; });
              updateBuiltinStats(type, patch);
              onDone();
            }}
          >
            {dirty ? '💾 存好' : '💾 没动过'}
          </BigButton>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ---- 武器库主面板 ----
const WeaponArsenal: React.FC<WeaponArsenalProps> = ({ onClose }) => {
  const [cfg, setCfg] = useState<WeaponConfig>(() => ({ ...loadWeapons() }));
  // editor === null 关闭；editor.weapon === null 表示「新增」，否则编辑那件
  const [editor, setEditor] = useState<{ weapon: CustomWeapon | null } | null>(null);
  // statEditor：正在「调一调」的内置武器
  const [statEditor, setStatEditor] = useState<WeaponType | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // loadWeapons 返回的是模块级缓存（同一引用），摊平一份才能触发重渲染
  const refresh = () => setCfg({ ...loadWeapons() });

  const toggleBuiltin = (t: WeaponType, currentlyDisabled: boolean) => {
    setBuiltinEnabled(t, currentlyDisabled); // 传 enabled = !disabled
    refresh();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute inset-0 z-[60] flex flex-col text-white overflow-hidden
        bg-gradient-to-b from-sky-500 via-sky-300 to-emerald-200"
    >
      {/* 顶栏：标题 + 返回 */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-5 pb-3">
        <span className="inline-flex items-center gap-2 font-body text-2xl font-black text-slate-700
          bg-white/80 border-4 border-white rounded-full px-5 py-1.5 shadow-lg">
          🧰 武器库
        </span>
        <motion.button
          whileHover={{ scale: 1.06, rotate: 3 }}
          whileTap={{ scale: 0.94 }}
          onClick={onClose}
          className="rounded-2xl border-4 border-white/70 bg-rose-400/90 px-5 py-2 font-body text-xl font-black text-white
            shadow-[0_6px_0_0_rgba(0,0,0,0.25)]"
        >
          ✖️ 回去
        </motion.button>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-6 pb-8">
        <div className="mx-auto w-full max-w-5xl flex flex-col gap-6">

          {/* 内置武器 */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-body text-lg font-black text-white drop-shadow-md">🎁 内置武器</span>
              <span className="font-body text-xs font-bold text-white/80">点按钮决定掉不掉；⚙️ 调一调能改它的伤害和弹药</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {BUILTIN_WEAPONS.map(w => {
                const disabled = cfg.disabled.includes(w.type);
                return (
                  <motion.div
                    key={w.type}
                    layout
                    className={`rounded-2xl border-4 p-3 flex flex-col items-center gap-1 transition-all
                      ${disabled
                        ? 'bg-slate-500/40 border-slate-300/50 grayscale opacity-80'
                        : 'bg-white/70 border-white/80 shadow-lg'}`}
                  >
                    <span className="text-4xl drop-shadow">{w.emoji}</span>
                    <span className="font-body text-sm font-black text-slate-700">
                      {w.name}{w.rare && <span className="ml-1" title="稀有武器">🌟</span>}
                      {isBuiltinModified(w.type) && (
                        <span className="ml-1 rounded-full bg-amber-100 border border-amber-300 px-1.5 py-px align-middle
                          font-body text-[10px] font-black text-amber-600">🔧 已调整</span>
                      )}
                    </span>
                    <span className="font-body text-[11px] font-bold text-slate-500 text-center leading-tight min-h-[2em]">
                      {w.desc}
                    </span>
                    <motion.button
                      whileTap={{ scale: 0.93 }}
                      onClick={() => toggleBuiltin(w.type, disabled)}
                      className={`mt-1 w-full rounded-full border-2 py-1 font-body text-xs font-black transition-colors
                        ${disabled
                          ? 'bg-slate-500 border-slate-400 text-white'
                          : 'bg-emerald-400 border-emerald-200 text-white'}`}
                    >
                      {disabled ? '🚫 已禁用 · 点我启用' : '✅ 上场中'}
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.93 }}
                      onClick={() => setStatEditor(w.type)}
                      className="w-full rounded-full border-2 border-blue-200 bg-blue-400 py-1 font-body text-xs font-black text-white"
                    >
                      ⚙️ 调一调
                    </motion.button>
                  </motion.div>
                );
              })}
            </div>
          </section>

          {/* 自创武器 */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="font-body text-lg font-black text-white drop-shadow-md">🛠️ 我的自创武器</span>
              <span className="font-body text-xs font-bold text-white/80">做好后会混在天上掉下来的武器里</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {cfg.customs.map(w => (
                <motion.div
                  key={w.id}
                  layout
                  className="rounded-2xl border-4 border-amber-200 bg-amber-50/90 p-3 flex flex-col items-center gap-1 shadow-lg"
                >
                  <span className="text-4xl drop-shadow">{w.emoji}</span>
                  <span className="font-body text-sm font-black text-slate-700">{w.name}</span>
                  <span className="font-body text-[11px] font-bold text-slate-500 text-center leading-tight">
                    {TEMPLATE_INFO[w.template].emoji} {TEMPLATE_INFO[w.template].name}
                    <br />
                    💥{w.damage} · 🔢{w.ammo}
                    {w.template === 'melee' && ` · 📏${w.range}`}
                    {w.template === 'throw' && ` · 🎯${w.blastRadius}`}
                  </span>
                  {confirmDelete === w.id ? (
                    <div className="mt-1 flex w-full gap-1.5">
                      <motion.button
                        whileTap={{ scale: 0.93 }}
                        onClick={() => { removeCustom(w.id); setConfirmDelete(null); refresh(); }}
                        className="flex-1 rounded-full border-2 border-rose-300 bg-rose-500 py-1 font-body text-xs font-black text-white"
                      >
                        确定删掉！
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.93 }}
                        onClick={() => setConfirmDelete(null)}
                        className="flex-1 rounded-full border-2 border-slate-200 bg-white py-1 font-body text-xs font-black text-slate-500"
                      >
                        手滑了
                      </motion.button>
                    </div>
                  ) : (
                    <div className="mt-1 flex w-full gap-1.5">
                      <motion.button
                        whileTap={{ scale: 0.93 }}
                        onClick={() => setEditor({ weapon: w })}
                        className="flex-1 rounded-full border-2 border-blue-200 bg-blue-400 py-1 font-body text-xs font-black text-white"
                      >
                        ✏️ 改一改
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.93 }}
                        onClick={() => setConfirmDelete(w.id)}
                        className="flex-1 rounded-full border-2 border-rose-200 bg-rose-400 py-1 font-body text-xs font-black text-white"
                      >
                        🗑️ 删掉
                      </motion.button>
                    </div>
                  )}
                </motion.div>
              ))}

              {/* 新增入口：虚线卡片 */}
              <motion.button
                whileHover={{ scale: 1.03, y: -3 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setEditor({ weapon: null })}
                className="min-h-[10rem] rounded-2xl border-4 border-dashed border-white/80 bg-white/20
                  flex flex-col items-center justify-center gap-1 hover:bg-white/35 transition-colors"
              >
                <span className="text-4xl">➕</span>
                <span className="font-body text-base font-black text-white drop-shadow">做一把新武器</span>
              </motion.button>
            </div>
          </section>
        </div>
      </div>

      {/* 编辑器（新增 / 编辑共用，key 保证切换目标时状态重置） */}
      {editor && (
        <WeaponEditor
          key={editor.weapon?.id ?? 'new'}
          initial={editor.weapon}
          onCancel={() => setEditor(null)}
          onSave={draft => {
            if (editor.weapon) {
              updateCustom({ ...draft, id: editor.weapon.id });
            } else {
              addCustom(draft);
            }
            setEditor(null);
            refresh();
          }}
        />
      )}

      {/* 内置武器「调一调」弹层 */}
      {statEditor && (
        <BuiltinStatEditor
          type={statEditor}
          name={BUILTIN_WEAPONS.find(w => w.type === statEditor)?.name ?? ''}
          emoji={BUILTIN_WEAPONS.find(w => w.type === statEditor)?.emoji ?? '⚙️'}
          onDone={() => { setStatEditor(null); refresh(); }}
        />
      )}
    </motion.div>
  );
};

export default WeaponArsenal;
