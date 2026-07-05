// Sonido de notificación generado con WebAudio (sin assets externos):
// campanita de dos tonos, suave, estilo mensajería.

let ctx: AudioContext | null = null;
let ultimoSonido = 0;

export function playNotificationSound(): void {
  const now = Date.now();
  if (now - ultimoSonido < 1500) return; // no spamear con ráfagas de mensajes
  ultimoSonido = now;
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
    // sin audio (autoplay bloqueado antes de interacción) — silencioso
  }
}
