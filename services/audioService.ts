let audioCtx: AudioContext | null = null;

// 获取或初始化 AudioContext
const getContext = () => {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtx;
};

/*
  爆炸白噪声 buffer 缓存（性能）：
  原先 playExplodeSound() 每次调用都要同步跑 0.5s × sampleRate 次 Math.random()
  （44.1kHz 下约 22050 次）填充噪声，而它在炸弹 / 导弹 / 原子弹 / 穿地弹 / C4 /
  宝可梦命中 / 哉佩利敖等大量路径上都会触发，是单帧内的卡顿尖峰。
  现在只生成一次并复用；AudioBuffer 必须由同一个 AudioContext 创建，
  所以记录创建它的 ctx，一旦 ctx 被重建（引用不同）就重新生成。
*/
let noiseBuffer: AudioBuffer | null = null;
let noiseBufferCtx: AudioContext | null = null;

const getNoiseBuffer = (ctx: AudioContext): AudioBuffer => {
    if (noiseBuffer && noiseBufferCtx === ctx) return noiseBuffer;

    const bufferSize = ctx.sampleRate * 0.5; // 0.5秒
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // 白噪声
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }

    noiseBuffer = buffer;
    noiseBufferCtx = ctx;
    return buffer;
};

export const playJumpSound = () => {
    try {
        const ctx = getContext();
        if (ctx.state === 'suspended') ctx.resume();
        
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(500, ctx.currentTime + 0.15);
        
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
    } catch (e) { }
};

export const playAttackSound = () => {
    try {
        const ctx = getContext();
        if (ctx.state === 'suspended') ctx.resume();

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);

        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    } catch (e) { }
};

export const playHitSound = () => {
    try {
        const ctx = getContext();
        if (ctx.state === 'suspended') ctx.resume();

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'square';
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    } catch (e) { }
};

export const playShootSound = () => {
    try {
        const ctx = getContext();
        if (ctx.state === 'suspended') ctx.resume();

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        // 锯齿波模拟枪声
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.1);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2000, ctx.currentTime);
        filter.frequency.linearRampToValueAtTime(500, ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

        osc.start();
        osc.stop(ctx.currentTime + 0.15);
    } catch (e) { }
};

export const playExplodeSound = () => {
    try {
        const ctx = getContext();
        if (ctx.state === 'suspended') ctx.resume();

        const noise = ctx.createBufferSource();
        // 复用模块级缓存的噪声 buffer，不再每次同步生成（见 getNoiseBuffer）
        noise.buffer = getNoiseBuffer(ctx);

        const gain = ctx.createGain();
        // 衰减
        gain.gain.setValueAtTime(0.5, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

        noise.connect(gain);
        gain.connect(ctx.destination);
        noise.start();
    } catch (e) { }
};

export const playDragonRoar = () => {
    try {
        const ctx = getContext();
        if (ctx.state === 'suspended') ctx.resume();

        // 创建两个振荡器模拟复杂的吼叫
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc1.type = 'sawtooth';
        osc2.type = 'square';

        const now = ctx.currentTime;
        
        // 音调从高到低，模拟吼叫的下沉
        osc1.frequency.setValueAtTime(150, now);
        osc1.frequency.exponentialRampToValueAtTime(50, now + 1.5);
        
        osc2.frequency.setValueAtTime(100, now);
        osc2.frequency.exponentialRampToValueAtTime(30, now + 1.5);
        
        // 颤音
        osc1.detune.setValueAtTime(0, now);
        osc1.detune.linearRampToValueAtTime(50, now + 1);

        // 滤波器增加“喷气”感
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, now);
        filter.frequency.linearRampToValueAtTime(200, now + 1.5);
        filter.Q.value = 5;

        // 音量包络
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.4, now + 0.2); // 渐强
        gain.gain.exponentialRampToValueAtTime(0.01, now + 1.5); // 渐弱

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.5);
        osc2.stop(now + 1.5);

    } catch (e) { }
};

/*
  喷气背包持续声：双支路合成
    - 高频支路：白噪声 → 带通 700Hz，"嘶——"的气流声
    - 低频支路：白噪声 → 低通 380Hz，涡轮/气流的低频轰鸣
  两路叠加后音量足够、听感厚实，不再是之前那种单薄的电流嘶声。
  引用计数：两个玩家同时喷气只开一条声轨，最后一人停止才淡出。
*/
let jetNodes: {
    src: AudioBufferSourceNode;
    gain: GainNode;
} | null = null;
let jetRefCount = 0;

export const startJetSound = () => {
    jetRefCount++;
    if (jetNodes) return;
    try {
        const ctx = getContext();
        if (ctx.state === 'suspended') ctx.resume();

        const src = ctx.createBufferSource();
        src.buffer = getNoiseBuffer(ctx);
        src.loop = true;

        // 高频支路：气流嘶嘶声
        const bpFilter = ctx.createBiquadFilter();
        bpFilter.type = 'bandpass';
        bpFilter.frequency.value = 700;
        bpFilter.Q.value = 0.7;

        const hpGain = ctx.createGain();
        hpGain.gain.value = 0.5;

        // 低频支路：涡轮轰鸣
        const lpFilter = ctx.createBiquadFilter();
        lpFilter.type = 'lowpass';
        lpFilter.frequency.value = 380;

        const lpGain = ctx.createGain();
        lpGain.gain.value = 0.7;

        // 总音量：淡入避免爆音
        const master = ctx.createGain();
        master.gain.setValueAtTime(0, ctx.currentTime);
        master.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.06);

        src.connect(bpFilter);
        bpFilter.connect(hpGain);
        hpGain.connect(master);

        src.connect(lpFilter);
        lpFilter.connect(lpGain);
        lpGain.connect(master);

        master.connect(ctx.destination);
        src.start();
        jetNodes = { src, gain: master };
    } catch (e) { }
};

export const stopJetSound = () => {
    jetRefCount = Math.max(0, jetRefCount - 1);
    if (jetRefCount > 0 || !jetNodes) return;
    try {
        const ctx = getContext();
        const { src, gain } = jetNodes;
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
        src.stop(ctx.currentTime + 0.12);
    } catch (e) { }
    jetNodes = null;
};