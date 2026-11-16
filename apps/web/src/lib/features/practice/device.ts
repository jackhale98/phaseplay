/** Runner device helpers: a synthesized chime (no audio files), vibration and Screen Wake Lock. */

let ctx: AudioContext | null = null;

/** Call from a user gesture (Start) so iOS lets us play later. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** Two soft bell tones for "1 minute left", three rising for "time". */
export function chime(kind: 'one-minute' | 'end') {
  try {
    ctx ??= new AudioContext();
    const notes = kind === 'end' ? [660, 880, 1320] : [880, 660];
    const t0 = ctx.currentTime + 0.02;
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const at = t0 + i * 0.22;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.35, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
      o.connect(g).connect(ctx!.destination);
      o.start(at);
      o.stop(at + 0.65);
    });
  } catch {
    /* no audio: the visual and aria-live cues still fire */
  }
}

export function vibrate(kind: 'one-minute' | 'end') {
  try {
    navigator.vibrate?.(kind === 'end' ? [300, 120, 300, 120, 300] : [200, 100, 200]);
  } catch {}
}

/** Keep the screen on while running; re-acquires when the tab becomes visible again. */
export function keepAwake(): () => void {
  let lock: WakeLockSentinel | null = null;
  let alive = true;
  const acquire = async () => {
    if (!alive || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
    try {
      lock = await navigator.wakeLock.request('screen');
      if (!alive) void lock.release();
    } catch {
      lock = null;
    }
  };
  const onVis = () => void (document.visibilityState === 'visible' && acquire());
  document.addEventListener('visibilitychange', onVis);
  void acquire();
  return () => {
    alive = false;
    document.removeEventListener('visibilitychange', onVis);
    void lock?.release().catch(() => {});
    lock = null;
  };
}
