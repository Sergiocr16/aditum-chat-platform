'use client';

// Campanita de notificación con WebAudio (sin assets).
let ctx: AudioContext | null = null;
let ultimo = 0;

export function playNotificationSound(): void {
  const now = Date.now();
  if (now - ultimo < 1500) return;
  ultimo = now;
  try {
    ctx ??= new (window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    for (const [freq, start] of [
      [880, 0],
      [1174.66, 0.12],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + start);
      gain.gain.linearRampToValueAtTime(0.12, t0 + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + 0.4);
    }
  } catch {
    // autoplay bloqueado antes de la primera interacción — silencioso
  }
}
