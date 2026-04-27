// Sensory feedback for kiosk punches: a soft Web Audio chime + a haptic
// pulse on devices that support `navigator.vibrate`. Pure side-effects,
// no state. Both are best-effort: silent failure if blocked.

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

function tone(frequency: number, durationMs: number, gain = 0.06): void {
  const ac = ctx();
  if (!ac) return;
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  g.gain.setValueAtTime(0, ac.currentTime);
  g.gain.linearRampToValueAtTime(gain, ac.currentTime + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + durationMs / 1000);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + durationMs / 1000);
}

export function playPunchSuccess(): void {
  // Two-note ascending major-third — pleasant, not alarming.
  tone(880, 140);
  setTimeout(() => tone(1108.73, 220), 90);
}

export function playPunchError(): void {
  tone(220, 240, 0.05);
}

export function vibrateSuccess(): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([18, 40, 22]);
    } catch {
      /* ignore */
    }
  }
}

export function vibrateError(): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(80);
    } catch {
      /* ignore */
    }
  }
}
