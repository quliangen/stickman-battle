/**
 * 游戏版本号 —— 它同时也是「防沉迷」的钥匙。
 *
 * 规则（给小朋友看的说法）：
 *   🐞 修好一个 bug   → 最后一位 +1：v1.0.0 → v1.0.1
 *   ✨ 加一个新玩法   → 中间位 +1：v1.0.1 → v1.1.0
 *
 * 每个版本最多玩 {@link PLAYS_PER_VERSION} 局。玩满之后游戏会「燃尽」，
 * 开局按钮被锁住，直到小朋友真的改点东西、把下面这个号往上顶一格才解锁。
 * 也就是说：**想接着玩，就得先让游戏变得更好一点点。**
 *
 * ⚠️ 改完代码记得同步把 APP_VERSION 往上顶，否则小朋友是解不开锁的。
 */
export const APP_VERSION = 'v1.7.0';

/** 同一个版本最多能玩几局，超过就燃尽 */
export const PLAYS_PER_VERSION = 3;

/** v1.2.3 → v1.2.4（修 bug） */
export const bumpPatch = (v: string): string => {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? `v${m[1]}.${m[2]}.${Number(m[3]) + 1}` : v;
};

/** v1.2.3 → v1.3.0（加功能） */
export const bumpMinor = (v: string): string => {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? `v${m[1]}.${Number(m[2]) + 1}.0` : v;
};
