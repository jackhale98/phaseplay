/** Keep the screen on while recording; the lock is dropped when hidden, so re-acquire on return. */
export function keepAwake(): () => void {
  let lock: WakeLockSentinel | null = null;
  let stopped = false;
  const acquire = async () => {
    if (stopped || document.visibilityState !== 'visible' || lock) return;
    try {
      lock = (await navigator.wakeLock?.request('screen')) ?? null;
      lock?.addEventListener('release', () => (lock = null));
    } catch {
      lock = null; // denied (battery saver) or unsupported: the visual still works
    }
  };
  const onVis = () => void acquire();
  document.addEventListener('visibilitychange', onVis);
  void acquire();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVis);
    void lock?.release().catch(() => {});
    lock = null;
  };
}
