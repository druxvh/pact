/**
 * Tiny synthesised chimes (Web Audio) — no audio files to ship, nothing to download.
 * The old timer called `new Audio('')`, which plays nothing.
 */
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    ctx ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(c: AudioContext, freq: number, start: number, duration: number, gain = 0.16) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** `up` = a focus session ended (resolve upward); `down` = break over (gentle nudge back). */
export function playChime(kind: 'up' | 'down' = 'up'): void {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime + 0.02;
  const notes = kind === 'up' ? [523.25, 659.25, 783.99, 1046.5] : [783.99, 659.25, 523.25];
  notes.forEach((f, i) => tone(c, f, t + i * 0.13, 0.55));
}

/** Soft click for UI feedback (not used yet by default; handy for toggles). */
export function playTick(): void {
  const c = getCtx();
  if (!c) return;
  tone(c, 1200, c.currentTime, 0.05, 0.05);
}
