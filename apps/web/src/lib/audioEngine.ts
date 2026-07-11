/**
 * 环境音引擎（Phase 6B 目标 10）：WebAudio 程序化生成，零音频资产零版权。
 *
 * 音频图（一次构建，start/stop 只控 masterGain + ctx.resume/suspend）：
 *   [棕噪声 loop] → [lowpass 220Hz] → [gain 0.5] ─┐
 *   [sine 54Hz] → [gain 0.16] ─┐                   ├→ [masterGain] → destination
 *   [sine 81Hz] → [gain 0.10] ─┴←(gain.gain)← [lfoGain ±0.05] ← [LFO sine 0.045Hz]
 *
 * 音量红线：masterGain = 用户音量 × CEIL(0.06)，「极低可调」硬编码上限防炸耳。
 * AudioContext 懒创建于首次 startAmbient（必须处于用户手势栈内，满足自动播放政策）。
 * 页面隐藏时 suspend、回前台且开关仍开时 resume。
 */
'use client';

/** 音量硬上限：用户音量 1.0 时的实际增益。 */
const CEIL = 0.06;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** 用户期望状态（visibilitychange 回前台时据此决定是否 resume）。 */
let wantRunning = false;
let stopTimer: number | undefined;

/** 生成 4 秒可无缝循环的棕噪声 buffer（随机游走 + 首尾交叉淡化去咔哒）。 */
function buildBrownNoiseBuffer(ac: AudioContext): AudioBuffer {
  const len = ac.sampleRate * 4;
  const buffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = buffer.getChannelData(0);
  let b = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    b = (b + 0.02 * white) / 1.02; // 经典 brown noise 递推
    data[i] = b * 3.5;
  }
  // 循环无缝：最后 FADE 个样本与开头 FADE 个样本线性交叉淡化写回。
  const FADE = 2048;
  for (let i = 0; i < FADE; i++) {
    const t = i / FADE;
    const tail = data[len - FADE + i] ?? 0;
    const head = data[i] ?? 0;
    data[len - FADE + i] = tail * (1 - t) + head * t;
  }
  return buffer;
}

/** 懒构建整张音频图（幂等）。返回 null 表示环境不支持。 */
function ensureGraph(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const ac = new Ctor();
  ctx = ac;

  master = ac.createGain();
  master.gain.value = 0;
  master.connect(ac.destination);

  // 棕噪声 → 低通 → 定量增益
  const noise = ac.createBufferSource();
  noise.buffer = buildBrownNoiseBuffer(ac);
  noise.loop = true;
  const lowpass = ac.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 220;
  lowpass.Q.value = 0.7;
  const noiseGain = ac.createGain();
  noiseGain.gain.value = 0.5;
  noise.connect(lowpass).connect(noiseGain).connect(master);
  noise.start();

  // 两路低频正弦泛音垫
  const osc1 = ac.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = 54;
  const osc1Gain = ac.createGain();
  osc1Gain.gain.value = 0.16;
  osc1.connect(osc1Gain).connect(master);
  osc1.start();

  const osc2 = ac.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = 81;
  const osc2Gain = ac.createGain();
  osc2Gain.gain.value = 0.1;
  osc2.connect(osc2Gain).connect(master);
  osc2.start();

  // LFO 慢呼吸：±0.05 调制两路泛音增益（54Hz 路 0.11–0.21 摆动）
  const lfo = ac.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.045;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 0.05;
  lfo.connect(lfoGain);
  lfoGain.connect(osc1Gain.gain);
  lfoGain.connect(osc2Gain.gain);
  lfo.start();

  // 页面隐藏省电静音；回前台且用户开关仍开 → 恢复
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) {
      void ctx.suspend();
    } else if (wantRunning) {
      void ctx.resume();
    }
  });

  return ac;
}

/** 启动环境音（首次调用需处于用户手势调用栈内）。volume ∈ [0,1]。 */
export function startAmbient(volume: number): void {
  const ac = ensureGraph();
  if (!ac || !master) return;
  wantRunning = true;
  if (stopTimer !== undefined) {
    window.clearTimeout(stopTimer);
    stopTimer = undefined;
  }
  void ac.resume();
  const v = Math.min(1, Math.max(0, volume)) * CEIL;
  const now = ac.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.setTargetAtTime(v, now, 0.5); // 0.5s 时间常数淡入
}

/** 停止环境音：0.8s 淡出后 suspend（不 close，可复开）。 */
export function stopAmbient(): void {
  wantRunning = false;
  if (!ctx || !master) return;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.setTargetAtTime(0, now, 0.2);
  if (stopTimer !== undefined) window.clearTimeout(stopTimer);
  stopTimer = window.setTimeout(() => {
    stopTimer = undefined;
    if (!wantRunning && ctx) void ctx.suspend();
  }, 800);
}

/** 即时调整音量（引擎未启动时静默忽略；实际增益 = v × 0.06 上限）。 */
export function setAmbientVolume(v: number): void {
  if (!ctx || !master || !wantRunning) return;
  const vol = Math.min(1, Math.max(0, v)) * CEIL;
  master.gain.setTargetAtTime(vol, ctx.currentTime, 0.1);
}

export function isAmbientRunning(): boolean {
  return wantRunning;
}
