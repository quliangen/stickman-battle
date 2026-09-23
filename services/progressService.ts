import { APP_VERSION, PLAYS_PER_VERSION } from '../version';

/**
 * 存档：记录「当前版本已经玩了几局」。
 *
 * 只存一个版本号 + 一个局数就够了 —— 因为一旦代码里的 `APP_VERSION` 被顶上去，
 * 存档里的 version 就对不上，局数自动清零。这正是「升级才能接着玩」的实现方式：
 * 不需要任何后端，也不需要小朋友输密码，改代码本身就是钥匙。
 */
export interface Progress {
  version: string; // 这份局数记录属于哪个版本
  plays: number; // 该版本已经玩了几局
}

const STORAGE_KEY = 'stickman-battle:progress';

/** 全新存档：当前版本、0 局 */
export const freshProgress = (): Progress => ({ version: APP_VERSION, plays: 0 });

/**
 * 读存档。localStorage 在无痕模式 / 禁用存储时会直接抛异常，
 * 所以所有访问都必须包 try —— 存不了就退化成「每次都是全新存档」，
 * 大不了防沉迷失效，绝不能因此白屏。
 */
export const loadProgress = (): Progress => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshProgress();

    const saved = JSON.parse(raw) as Partial<Progress> | null;
    const plays = saved?.plays;
    if (typeof plays !== 'number' || !Number.isFinite(plays) || plays < 0) return freshProgress();

    // 版本号对不上 = 小朋友真的升级过游戏 → 局数清零，重新开始数
    if (saved?.version !== APP_VERSION) return freshProgress();

    return { version: APP_VERSION, plays: Math.floor(plays) };
  } catch {
    return freshProgress();
  }
};

const save = (p: Progress) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* 存不了就算了，不影响这一局玩 */
  }
};

/** 一局结束时记账：本版本局数 +1 */
export const recordPlay = (): Progress => {
  const next: Progress = { version: APP_VERSION, plays: loadProgress().plays + 1 };
  save(next);
  return next;
};

/** 家长重置：清空存档，回到全新状态 */
export const resetProgress = (): Progress => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return freshProgress();
};

/** 这个版本是不是已经玩到燃尽了 */
export const isExhausted = (p: Progress): boolean => p.plays >= PLAYS_PER_VERSION;
