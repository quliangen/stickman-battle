import React, { useState } from 'react';
import { APP_VERSION, PLAYS_PER_VERSION, bumpPatch, bumpMinor } from '../version';

/**
 * 「版本燃尽」提示卡 —— 主菜单与结算界面共用，文案只在这里维护一份。
 *
 * 设计意图：原来的防沉迷是「每 3 局强制休息 10 分钟」，本质是惩罚；
 * 现在改成「这个版本被你玩透了，去把它变得更好一点点」——
 * 小朋友用 AI 工具真的改点东西、把版本号顶上去，才能接着玩。
 * 所以文案的重点不是「不许玩」，而是「你来做主设计师」。
 */
interface BurnoutCardProps {
  /** 紧凑版：主菜单顶部横幅，只留一句钩子 */
  compact?: boolean;
}

const BurnoutCard: React.FC<BurnoutCardProps> = ({ compact }) => {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const nextPatch = bumpPatch(APP_VERSION);
  const nextMinor = bumpMinor(APP_VERSION);
  const askAi = `帮我给「火柴人大乱斗」修一个 bug，然后把版本号从 ${APP_VERSION} 升到 ${nextPatch}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(askAi);
      setCopied('ok');
    } catch {
      // 非安全上下文（http 局域网访问）下剪贴板不可用，退化成「照着抄」
      setCopied('fail');
    }
    window.setTimeout(() => setCopied('idle'), 2500);
  };

  if (compact) {
    return (
      <div className="w-full max-w-lg bg-gradient-to-b from-amber-300 to-orange-400 border-4 border-white rounded-3xl px-5 py-2.5 text-center shadow-xl">
        <div className="text-lg font-black text-amber-950">🔋 {APP_VERSION} 玩没电啦！</div>
        <div className="font-body text-sm font-bold text-amber-900/90 mt-0.5">
          开动小脑袋帮我升级鸭 —— 让 AI 小伙伴帮你改一改，就能接着玩～
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10 w-full max-w-xl bg-gradient-to-b from-amber-300 to-orange-400 border-4 border-white rounded-[2rem] p-5 shadow-2xl text-amber-950">
      <div className="text-center mb-3">
        <div className="text-2xl font-black">🔋 {APP_VERSION} 玩没电啦！</div>
        <div className="font-body text-sm font-bold text-amber-900/90 mt-0.5">
          这个版本被你玩透了（{PLAYS_PER_VERSION} / {PLAYS_PER_VERSION} 局）· 开动小脑袋，帮我升级鸭！
        </div>
      </div>

      {/* 升级规则：修 bug 顶末位，加功能顶中位 */}
      <div className="bg-white/70 rounded-2xl border-2 border-white px-4 py-2.5 mb-3 font-body text-sm font-bold">
        <div className="flex items-center justify-between">
          <span>🐞 修好一个 bug</span>
          <span className="tabular-nums text-amber-800">{APP_VERSION} → {nextPatch}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span>✨ 加个新玩法</span>
          <span className="tabular-nums text-amber-800">{APP_VERSION} → {nextMinor}</span>
        </div>
      </div>

      {/* 给小朋友一句可以直接交给 AI 的话 */}
      <div className="font-body text-sm font-bold text-amber-900/90 mb-1.5 text-center">
        把这句话讲给你的 AI 小伙伴听 👇
      </div>
      <div className="bg-amber-950/85 rounded-2xl px-4 py-2.5 font-body text-sm font-bold text-amber-50 leading-snug">
        「{askAi}」
      </div>
      <div className="flex items-center justify-center gap-3 mt-2">
        <button
          onClick={copy}
          className="px-4 py-1.5 rounded-full bg-white border-2 border-amber-700 text-sm font-black text-amber-900
            shadow-[0_3px_0_0_rgba(120,53,15,0.5)] active:translate-y-0.5 active:shadow-none transition-all"
        >
          {copied === 'ok' ? '✅ 复制好啦' : copied === 'fail' ? '抄一下也行～' : '📋 复制这句话'}
        </button>
      </div>

      <div className="font-body text-xs font-bold text-amber-900/80 text-center mt-2.5">
        升级完刷新一下页面，就又能玩 {PLAYS_PER_VERSION} 局啦！
      </div>
    </div>
  );
};

export default BurnoutCard;
