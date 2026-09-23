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